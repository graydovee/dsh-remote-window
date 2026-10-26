/**
 * ssh2 local forwarding (`direct-tcpip`) for the v1 client host.
 *
 * The v1 architecture keeps **one SSH connection per target** and carries every
 * byte of both P1 (client host → server plugin API) and P2 (browser → portal →
 * official UI) through `forwardOut` channels on it:
 *
 * - HTTP: `ForwardHttpAgent` is an `http.Agent` whose `createConnection` opens a
 *   forwarded channel instead of a TCP socket, so Node's own HTTP client (with
 *   its request/response, streaming and upgrade semantics) can be reused.
 * - WebSocket: {@link SshForwarder.open} returns the raw duplex; the portal
 *   writes the HTTP upgrade request itself and then pipes both directions.
 *
 * Nothing here knows about DSH, profiles or cookies: this module is the single
 * place that turns "an open SSH client" into "a socket to the server's loopback".
 * Errors are coded so the portal/plugin layer can map them onto the protocol's
 * `tunnel-unavailable` / `upstream-timeout` responses.
 */
import { Agent as HttpAgent } from 'node:http'
import type { AgentOptions, ClientRequest, IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Client, ClientChannel } from 'ssh2'
import { scrubSecrets } from '../targets/types.ts'

/** Default place the closed end of a forwarded channel lives. */
export const DEFAULT_FORWARD_HOST = '127.0.0.1'

/** How long an ssh2 `forwardOut` may take before it is reported as timed out. */
export const DEFAULT_FORWARD_TIMEOUT_MS = 10_000

/** One forwarded channel: a duplex byte stream to the far-side socket. */
export type ForwardStream = Duplex

/** The far end of a forward (the profile server's loopback listener). */
export interface ForwardDestination {
  readonly host?: string
  readonly port: number
}

/** The source address the SSH server sees for the forwarded connection. */
export interface ForwardSource {
  readonly host?: string
  readonly port?: number
}

/** A coded forwarding failure (`tunnel-unavailable` / `upstream-timeout`). */
export class ForwardError extends Error {
  constructor(
    readonly code: 'tunnel-unavailable' | 'upstream-timeout',
    message: string,
    readonly cause?: unknown,
  ) {
    super(scrubSecrets(message))
    this.name = 'ForwardError'
  }
}

/** Whether an unknown error is a coded forward failure. */
export function isForwardError(error: unknown): error is ForwardError {
  return error instanceof ForwardError
}

/**
 * Open one `direct-tcpip` channel on an already-connected ssh2 client.
 *
 * The ssh2 callback API is bridged onto a promise; a timeout or an abort closes
 * a channel that arrives late, so a cancelled request cannot leak a forward.
 * @param client - connected ssh2 client (its lifetime stays with the caller).
 * @param destination - far-side host/port; host defaults to loopback.
 * @param options - source address and open deadline.
 * @param signal - cancellation of the open (does not undo a completed open).
 * @returns the forwarded duplex.
 */
export async function forwardOut(
  client: Client,
  destination: ForwardDestination,
  options: { readonly source?: ForwardSource; readonly timeoutMs?: number } = {},
  signal?: AbortSignal,
): Promise<ForwardStream> {
  if (signal?.aborted === true) throw new ForwardError('tunnel-unavailable', 'the tunnel request was cancelled')
  const timeoutMs = options.timeoutMs ?? DEFAULT_FORWARD_TIMEOUT_MS
  const sourceHost = options.source?.host ?? DEFAULT_FORWARD_HOST
  const sourcePort = options.source?.port ?? 0
  const destHost = destination.host ?? DEFAULT_FORWARD_HOST
  return await new Promise<ForwardStream>((resolve, reject) => {
    let settled = false
    let stream: ClientChannel | undefined
    const timer = setTimeout(() => {
      finish(new ForwardError('upstream-timeout', `opening a tunnel to ${destHost}:${destination.port} timed out after ${timeoutMs} ms`))
    }, timeoutMs)
    timer.unref?.()
    const onAbort = (): void => {
      finish(new ForwardError('tunnel-unavailable', 'the tunnel request was cancelled'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const cleanup = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (error: ForwardError | undefined): void => {
      if (settled) return
      settled = true
      cleanup()
      if (error !== undefined) {
        stream?.destroy()
        reject(error)
        return
      }
      resolve(stream as ForwardStream)
    }
    try {
      client.forwardOut(sourceHost, sourcePort, destHost, destination.port, (error, channel) => {
        if (error != null) {
          finish(new ForwardError('tunnel-unavailable', `cannot open a tunnel to ${destHost}:${destination.port}: ${error.message}`, error))
          return
        }
        if (settled) {
          // The deadline/abort won the race: a late channel must not leak.
          channel.destroy()
          return
        }
        stream = channel
        finish(undefined)
      })
    } catch (error) {
      finish(new ForwardError('tunnel-unavailable', `cannot open a tunnel to ${destHost}:${destination.port}: ${error instanceof Error ? error.message : String(error)}`, error))
    }
  })
}

/**
 * One target's forwarding facade over a shared ssh2 client.
 *
 * Creating an agent per target is free; `close()` only destroys the agents this
 * instance handed out. It never calls `client.end()` — the SSH connection is
 * owned by the target channel, not by a proxy facade.
 */
export class SshForwarder {
  private readonly agents = new Set<ForwardHttpAgent>()

  constructor(
    private readonly client: Client,
    private readonly defaults: { readonly timeoutMs?: number; readonly source?: ForwardSource } = {},
  ) {}

  /** Open a raw forwarded channel (WebSocket / manual HTTP upgrade). */
  async open(destination: ForwardDestination, signal?: AbortSignal): Promise<ForwardStream> {
    return await forwardOut(this.client, destination, {
      ...(this.defaults.source === undefined ? {} : { source: this.defaults.source }),
      ...(this.defaults.timeoutMs === undefined ? {} : { timeoutMs: this.defaults.timeoutMs }),
    }, signal)
  }

  /** An `http.Agent` whose sockets are forwarded channels to `destination`. */
  httpAgent(destination: ForwardDestination): ForwardHttpAgent {
    const agent = new ForwardHttpAgent(this, destination)
    this.agents.add(agent)
    return agent
  }

  /** Destroy every agent created by this facade (its sockets die with them). */
  close(): void {
    for (const agent of this.agents) agent.destroy()
    this.agents.clear()
  }
}

/**
 * `http.Agent` backed by {@link SshForwarder}.
 *
 * `keepAlive` stays off: the far side is a loopback HTTP server behind one SSH
 * channel, and an idle forwarded channel would outlive the request that opened
 * it while the profile server may restart underneath. WebSocket frames do not
 * use this agent (they need the raw upgrade socket).
 */
export class ForwardHttpAgent extends HttpAgent {
  constructor(
    private readonly forwarder: SshForwarder,
    private readonly destination: ForwardDestination,
  ) {
    super({ keepAlive: false })
  }

  override createConnection(_options: AgentOptions, callback: (error: Error | null, stream?: Duplex) => void): undefined {
    void this.forwarder.open(this.destination).then(
      stream => { callback(null, stream) },
      (error: unknown) => { callback(error instanceof Error ? error : new ForwardError('tunnel-unavailable', String(error))) },
    )
    return undefined
  }
}

/** Decode one HTTP/1.1 chunked body (headers already stripped). */
export function decodeChunkedBody(input: Buffer): Buffer {
  const chunks: Buffer[] = []
  let offset = 0
  for (;;) {
    const lineEnd = input.indexOf('\r\n', offset)
    if (lineEnd === -1) break
    const sizeText = input.subarray(offset, lineEnd).toString('ascii').split(';')[0]?.trim() ?? ''
    const size = Number.parseInt(sizeText, 16)
    if (!Number.isFinite(size)) break
    offset = lineEnd + 2
    if (size === 0) break
    chunks.push(input.subarray(offset, offset + size))
    offset += size + 2
  }
  return Buffer.concat(chunks)
}

/** Whether a chunked body contains its terminating zero-size chunk. */
export function chunkedBodyComplete(input: Buffer): boolean {
  let offset = 0
  for (;;) {
    const lineEnd = input.indexOf('\r\n', offset)
    if (lineEnd === -1) return false
    const sizeText = input.subarray(offset, lineEnd).toString('ascii').split(';')[0]?.trim() ?? ''
    const size = Number.parseInt(sizeText, 16)
    if (!Number.isFinite(size)) return false
    offset = lineEnd + 2
    if (size === 0) {
      // The terminal chunk is `0\r\n` + an empty trailer block (`\r\n`).
      const trailerEnd = input.indexOf('\r\n', offset)
      return trailerEnd !== -1 && trailerEnd === offset
    }
    if (input.length < offset + size + 2) return false
    offset += size + 2
  }
}

/** A minimal HTTP request/response shape used by the portal tests and helpers. */
export interface ForwardedHttpResult {
  readonly status: number
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>
  readonly body: Buffer
}

/**
 * One bounded HTTP request through a forwarded channel, without Node's HTTP stack.
 *
 * Used for the profile server's **startup probe** (`GET /?token=…` must answer
 * 303) where a full `http.request` through the agent would be more machinery
 * than needed, and by tests that assert the exact bytes on the far side.
 * The caller supplies the raw forwarded stream; this helper writes a minimal
 * HTTP/1.1 request and parses the status line, headers and body until the
 * connection closes.
 * @param stream - an open forwarded channel.
 * @param request - method, path, headers and optional body.
 * @param options - byte ceiling and deadline.
 * @returns the parsed response.
 */
export async function sendForwardedHttp(
  stream: ForwardStream,
  request: {
    readonly method: string
    readonly path: string
    readonly headers?: Readonly<Record<string, string>>
    readonly body?: Buffer
  },
  options: { readonly maxBytes?: number; readonly timeoutMs?: number } = {},
): Promise<ForwardedHttpResult> {
  const maxBytes = options.maxBytes ?? 64 * 1024
  const timeoutMs = options.timeoutMs ?? DEFAULT_FORWARD_TIMEOUT_MS
  const headers = { ...(request.headers ?? {}) }
  const body = request.body
  if (body !== undefined && headers['content-length'] === undefined) headers['content-length'] = String(body.length)
  if (headers.host === undefined) headers.host = DEFAULT_FORWARD_HOST
  const requestBytes = Buffer.from([
    `${request.method} ${request.path} HTTP/1.1`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    'connection: close',
    '',
    '',
  ].join('\r\n'), 'utf8')
  return await new Promise<ForwardedHttpResult>((resolve, reject) => {
    let settled = false
    let received = Buffer.alloc(0)
    const timer = setTimeout(() => {
      finish(new ForwardError('upstream-timeout', `the forwarded request did not answer within ${timeoutMs} ms`))
    }, timeoutMs)
    timer.unref?.()
    const finish = (error: ForwardError | undefined, result?: ForwardedHttpResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stream.destroy()
      if (error !== undefined) reject(error)
      else resolve(result as ForwardedHttpResult)
    }
    stream.on('data', (chunk: Buffer) => {
      received = Buffer.concat([received, chunk])
      const end = received.indexOf('\r\n\r\n')
      if (end === -1) {
        if (received.length > maxBytes) finish(new ForwardError('tunnel-unavailable', 'the forwarded response headers are too large'))
        return
      }
      const head = received.subarray(0, end).toString('utf8')
      const [statusLine, ...rawHeaders] = head.split('\r\n')
      const status = Number.parseInt((statusLine ?? '').split(' ')[1] ?? '0', 10)
      const parsedHeaders: Record<string, string> = {}
      for (const line of rawHeaders) {
        const at = line.indexOf(':')
        if (at > 0) parsedHeaders[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim()
      }
      const contentLength = Number.parseInt(parsedHeaders['content-length'] ?? '', 10)
      const bodyBytes = received.subarray(end + 4)
      if (String(parsedHeaders['transfer-encoding'] ?? '').toLowerCase().includes('chunked')) {
        // DSH's tokenized 303 has no content-length and may keep the connection
        // open; settle as soon as the terminating chunk arrived instead of
        // waiting for a socket close that never comes.
        if (chunkedBodyComplete(bodyBytes)) {
          finish(undefined, { status, headers: parsedHeaders, body: decodeChunkedBody(bodyBytes) })
          return
        }
        if (bodyBytes.length > maxBytes) finish(new ForwardError('tunnel-unavailable', 'the forwarded response is too large'))
        return
      }
      if (Number.isNaN(contentLength)) {
        // No length (connection-close): wait for `close` to settle.
        if (bodyBytes.length > maxBytes) finish(new ForwardError('tunnel-unavailable', 'the forwarded response is too large'))
        return
      }
      if (bodyBytes.length >= contentLength) {
        finish(undefined, { status, headers: parsedHeaders, body: bodyBytes.subarray(0, contentLength) })
      }
    })
    stream.once('error', (error: Error) => { finish(new ForwardError('tunnel-unavailable', `forwarded connection failed: ${error.message}`, error)) })
    stream.once('close', () => {
      if (settled) return
      const end = received.indexOf('\r\n\r\n')
      if (end === -1) {
        finish(new ForwardError('tunnel-unavailable', 'the forwarded connection closed before a response arrived'))
        return
      }
      const head = received.subarray(0, end).toString('utf8')
      const [statusLine, ...rawHeaders] = head.split('\r\n')
      const status = Number.parseInt((statusLine ?? '').split(' ')[1] ?? '0', 10)
      const parsedHeaders: Record<string, string> = {}
      for (const line of rawHeaders) {
        const at = line.indexOf(':')
        if (at > 0) parsedHeaders[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim()
      }
      const bodyBytes = received.subarray(end + 4)
      finish(undefined, {
        status,
        headers: parsedHeaders,
        body: String(parsedHeaders['transfer-encoding'] ?? '').includes('chunked') ? decodeChunkedBody(bodyBytes) : bodyBytes,
      })
    })
    stream.write(requestBytes)
    if (body !== undefined) stream.write(body)
  })
}

/** Re-export the Node request/response types the portal shares. */
export type { ClientRequest, IncomingMessage }
