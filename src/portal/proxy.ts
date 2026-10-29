/**
 * P2 portal: the client host's same-origin reverse proxy to one profile server.
 *
 * The browser only ever talks to the client's own origin:
 *
 *   /dsh-remote-window/portal/<targetId>/…        → 127.0.0.1:<profilePort>/…
 *   /dsh-remote-window/portal/<targetId>/api/remote.mux (WS, exact) → /api/remote.mux
 *
 * The rules in protocol §8.2 are all load-bearing and live in pure helpers so
 * they can be asserted without a browser or an SSH server:
 *
 * - the upstream `Host` is rewritten to `127.0.0.1:<profilePort>`; forwarding the
 *   browser authority would make the official cookie's authority equal the client
 *   origin and collide with the client GUI's own `dsh-auth-*` cookie;
 * - `Origin` and `Referer` are dropped;
 * - the browser's cookies are dropped and the official cookie is injected;
 * - `Set-Cookie` is never sent back to the browser;
 * - bodies and SSE are streamed, not buffered;
 * - the upstream WebSocket upgrade is connected through the same tunnel.
 *
 * The SSH/HTTP transport is injected ({@link PortalUpstream}); production wires
 * `SshForwarder` from `src/ssh/forward.ts`, tests use a loopback server.
 */
import { Agent, request as httpRequest } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { randomBytes } from 'node:crypto'
import { scrubSecrets } from '../targets/types.ts'

/** Portal route base (protocol §8.1). */
export const PORTAL_BASE = '/dsh-remote-window/portal'

/** Where the official UI's execution-world WebSocket lives, relative to a portal mount. */
export const PORTAL_MUX_PATH = 'api/remote.mux'

/** Upstream connection budget (protocol §8.3). */
export const PORTAL_UPSTREAM_TIMEOUT_MS = 10_000

/** The official cookie the profile server issued for this run (kept in host memory). */
export interface PortalCookie {
  /** `dsh-auth-<authorityHash>=v1.…`, exactly as set by the profile server. */
  readonly header: string
}

/** The tunnel/HTTP seam the portal forwards through. */
export interface PortalUpstream {
  /** The upstream authority the portal reports to Node's HTTP client. */
  readonly host: string
  readonly port: number
  /** Agent whose sockets reach the profile server (forwarded channels in production). */
  readonly agent: Agent
  /** Raw socket for the WebSocket upgrade (one forwarded channel). */
  connect(signal?: AbortSignal): Promise<Duplex>
}

/** A coded portal failure (protocol §8.3/§12). */
export class PortalError extends Error {
  constructor(
    readonly code: 'target-not-connected' | 'tunnel-unavailable' | 'upstream-timeout' | 'bad-request',
    message: string,
    readonly status: number,
  ) {
    super(scrubSecrets(message))
    this.name = 'PortalError'
  }
}

/** The mount path for one target: always ends with `/`. */
export function portalPath(targetId: string): string {
  return `${PORTAL_BASE}/${encodeURIComponent(targetId)}/`
}

/** The exact WebSocket upgrade path for one target. */
export function portalMuxPath(targetId: string): string {
  return `${portalPath(targetId)}${PORTAL_MUX_PATH}`
}

/** Whether a URL belongs to this portal mount (only used for diagnostics/tests). */
export function isPortalPath(url: string, targetId: string): boolean {
  return url === portalPath(targetId).slice(0, -1) || url.startsWith(portalPath(targetId))
}

/**
 * Strip one mount prefix and keep the query string untouched (protocol §8.1).
 * @returns the upstream request path (`/` for the mount root), or undefined when
 *   the URL is not this mount.
 */
export function stripPortalPrefix(rawUrl: string, targetId: string): string | undefined {
  const base = `${PORTAL_BASE}/${encodeURIComponent(targetId)}`
  const url = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`
  if (url === base || url === `${base}/`) return '/'
  if (!url.startsWith(`${base}/`)) return undefined
  return url.slice(base.length)
}

/** Hop-by-hop headers Node's HTTP client must not forward between connections. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/** Browser request headers that must never reach the profile server unchanged. */
export interface PortalHeaderInput {
  readonly host?: string | undefined
  readonly origin?: string | undefined
  readonly referer?: string | undefined
  readonly cookie?: string | undefined
  readonly [name: string]: string | string[] | undefined
}

/**
 * Build the upstream request headers.
 *
 * `Host` is the profile server's own authority, `Origin`/`Referer` disappear, the
 * browser cookie is replaced by the official one, and hop-by-hop headers are
 * dropped. `sec-fetch-site` is passed through on purpose (the official fence only
 * refuses `cross-site`, and the browser's same-origin value is truthful).
 */
export function portalUpstreamHeaders(input: PortalHeaderInput, options: {
  readonly upstreamPort: number
  readonly cookie?: string
}): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(input)) {
    if (value === undefined) continue
    const lower = name.toLowerCase()
    if (lower === 'host' || lower === 'origin' || lower === 'referer' || lower === 'cookie') continue
    if (HOP_BY_HOP.has(lower)) continue
    out[lower] = value
  }
  out.host = `127.0.0.1:${options.upstreamPort}`
  if (options.cookie !== undefined && options.cookie !== '') out.cookie = options.cookie
  return out
}

/**
 * Build the downstream response headers: everything except `Set-Cookie`.
 *
 * The browser must never hold the profile server's cookie; the portal injects it
 * on the upstream leg instead (§8.2).
 */
export function portalResponseHeaders(input: Readonly<Record<string, string | readonly string[] | undefined>>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(input)) {
    if (value === undefined) continue
    if (name.toLowerCase() === 'set-cookie') continue
    out[name] = typeof value === 'string' ? value : [...value]
  }
  return out
}

/**
 * The browser-side trust guard for a portal request.
 *
 * The route layer already ran the client's `trustedRequest`; this is the second,
 * portal-specific fence: a cross-site fetch or an attached foreign Origin is
 * refused even if it somehow reached the handler.
 */
export function portalRequestAllowed(req: Pick<IncomingMessage, 'headers'>, expectedOrigin?: string): { ok: true } | { ok: false; code: 'forbidden'; message: string } {
  if (req.headers['sec-fetch-site'] === 'cross-site') return { ok: false, code: 'forbidden', message: 'cross-site portal requests are refused' }
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null' && expectedOrigin !== undefined && origin !== expectedOrigin) {
    return { ok: false, code: 'forbidden', message: 'portal requests must come from the client origin' }
  }
  return { ok: true }
}

/** Write the plugin JSON error envelope for a portal failure. */
export function writePortalError(res: ServerResponse, error: PortalError): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  const body = JSON.stringify({ ok: false, error: { code: error.code, message: error.message } })
  res.writeHead(error.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

/** One target's portal proxy. */
export class PortalProxy {
  private closed = false
  private readonly timeoutMs: number

  constructor(
    readonly targetId: string,
    private readonly upstream: PortalUpstream,
    private readonly cookie: string | undefined,
    options: { readonly timeoutMs?: number } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? PORTAL_UPSTREAM_TIMEOUT_MS
  }

  /** Forward one HTTP request (all methods; body and response are streamed). */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.closed) {
      writePortalError(res, new PortalError('target-not-connected', `remote target "${this.targetId}" is not connected`, 404))
      return
    }
    const path = stripPortalPrefix(req.url ?? '/', this.targetId)
    if (path === undefined) {
      writePortalError(res, new PortalError('bad-request', `not a portal mount for "${this.targetId}"`, 400))
      return
    }
    const headers = portalUpstreamHeaders(req.headers, {
      upstreamPort: this.upstream.port,
      ...(this.cookie === undefined ? {} : { cookie: this.cookie }),
    })
    const upstreamRequest = httpRequest({
      host: this.upstream.host,
      port: this.upstream.port,
      method: req.method ?? 'GET',
      path,
      headers,
      agent: this.upstream.agent,
    })
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const fail = (error: PortalError): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      upstreamRequest.destroy()
      if (!res.headersSent) writePortalError(res, error)
      else res.destroy()
    }
    timer = setTimeout(() => {
      fail(new PortalError('upstream-timeout', `the profile server did not answer within ${this.timeoutMs} ms`, 502))
    }, this.timeoutMs)
    timer.unref?.()
    req.once('error', () => { fail(new PortalError('tunnel-unavailable', 'the downstream request failed', 503)) })
    req.once('aborted', () => { fail(new PortalError('tunnel-unavailable', 'the downstream request was aborted', 503)) })
    res.once('close', () => {
      // The browser navigated away: do not keep the upstream request alive.
      if (!res.writableEnded) upstreamRequest.destroy()
    })
    upstreamRequest.once('error', (error: Error) => {
      const code = (error as { code?: unknown }).code
      if (code === 'upstream-timeout') fail(new PortalError('upstream-timeout', this.timeoutMsMessage(), 502))
      else fail(new PortalError('tunnel-unavailable', `the tunnel to the profile server failed: ${error.message}`, 503))
    })
    upstreamRequest.once('response', (upstreamResponse) => {
      if (settled) {
        upstreamResponse.destroy()
        return
      }
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      res.writeHead(upstreamResponse.statusCode ?? 502, portalResponseHeaders(upstreamResponse.headers))
      upstreamResponse.once('error', () => { res.destroy() })
      upstreamResponse.pipe(res)
    })
    // Streaming request body: no 1 MiB plugin limit here (§8.2).
    req.pipe(upstreamRequest)
  }

  /**
   * Forward the exact WebSocket upgrade path.
   *
   * A manual upgrade request is written to a fresh forwarded channel because the
   * official UI's WS endpoint is not an HTTP resource Node's client can upgrade
   * through an agent without buffering semantics; then the two sockets are piped
   * byte-for-byte.
   */
  async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const fail = (error: PortalError): void => {
      // Before the response line, answer with a small failure; afterwards the
      // only safe act is to destroy the socket.
      if (!socket.destroyed && !socket.writableEnded) {
        socket.end(`HTTP/1.1 ${error.status} ${error.code}\r\ncontent-type: application/json; charset=utf-8\r\ncontent-length: ${Buffer.byteLength(JSON.stringify({ ok: false, error: { code: error.code, message: error.message } }))}\r\nconnection: close\r\n\r\n${JSON.stringify({ ok: false, error: { code: error.code, message: error.message } })}`)
      } else {
        socket.destroy()
      }
    }
    if (this.closed) {
      fail(new PortalError('target-not-connected', `remote target "${this.targetId}" is not connected`, 404))
      return
    }
    const rawUrl = req.url ?? '/'
    if (rawUrl !== portalMuxPath(this.targetId)) {
      fail(new PortalError('bad-request', `unknown portal upgrade path ${JSON.stringify(rawUrl)}`, 400))
      return
    }
    let upstream: Duplex
    try {
      upstream = await this.upstream.connect()
    } catch (error) {
      fail(new PortalError('tunnel-unavailable', `the tunnel to the profile server failed: ${error instanceof Error ? error.message : String(error)}`, 503))
      return
    }
    upstream.once('error', () => socket.destroy())
    upstream.once('close', () => socket.destroy())
    socket.once('error', () => upstream.destroy())
    socket.once('close', () => upstream.destroy())
    const headers: Record<string, string> = {
      host: `127.0.0.1:${this.upstream.port}`,
      connection: 'Upgrade',
      upgrade: 'websocket',
      'sec-websocket-version': '13',
      ...(typeof req.headers['sec-websocket-key'] === 'string' ? { 'sec-websocket-key': req.headers['sec-websocket-key'] } : {}),
      ...(typeof req.headers['sec-websocket-protocol'] === 'string' ? { 'sec-websocket-protocol': req.headers['sec-websocket-protocol'] } : {}),
      ...(this.cookie === undefined || this.cookie === '' ? {} : { cookie: this.cookie }),
    }
    const requestText = [`GET /${PORTAL_MUX_PATH} HTTP/1.1`, ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`), '', ''].join('\r\n')
    upstream.write(requestText)
    if (head.length > 0) upstream.write(head)

    // Parse the upstream response head before handing the socket to the browser,
    // so a non-101 answer becomes a real error instead of a broken iframe.
    let received = Buffer.alloc(0)
    const timer = setTimeout(() => {
      fail(new PortalError('upstream-timeout', `the mux upgrade did not answer within ${this.timeoutMs} ms`, 502))
      upstream.destroy()
      socket.destroy()
    }, this.timeoutMs)
    timer.unref?.()
    const onUpstreamData = (chunk: Buffer): void => {
      received = Buffer.concat([received, chunk])
      const end = received.indexOf('\r\n\r\n')
      if (end === -1) {
        if (received.length > 32 * 1024) {
          clearTimeout(timer)
          fail(new PortalError('tunnel-unavailable', 'the mux upgrade response headers are too large', 503))
          upstream.destroy()
        }
        return
      }
      clearTimeout(timer)
      upstream.off('data', onUpstreamData)
      const statusLine = received.subarray(0, received.indexOf('\r\n')).toString('utf8')
      const status = Number.parseInt(statusLine.split(' ')[1] ?? '0', 10)
      const rest = received.subarray(end + 4)
      if (status !== 101) {
        fail(new PortalError('tunnel-unavailable', `the mux upgrade was refused (HTTP ${status})`, 502))
        upstream.destroy()
        return
      }
      // Forward the 101 head unchanged (including Sec-WebSocket-Accept) and then
      // every byte in both directions; no frame caching or re-framing.
      socket.write(received.subarray(0, end + 4))
      if (rest.length > 0) socket.write(rest)
      upstream.pipe(socket)
      socket.pipe(upstream)
    }
    upstream.on('data', onUpstreamData)
  }

  /** Mark the portal closed; subsequent requests answer `target-not-connected`. */
  close(): void {
    this.closed = true
  }

  /** Whether this proxy still forwards. */
  get live(): boolean {
    return !this.closed
  }

  private timeoutMsMessage(): string {
    return `the profile server did not answer within ${this.timeoutMs} ms`
  }
}

/** A tiny helper for the portal's tests and diagnostics: one random WS key. */
export function randomWebSocketKey(): string {
  return randomBytes(16).toString('base64')
}
