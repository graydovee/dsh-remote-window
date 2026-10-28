/**
 * Loopback HTTP bridge between a server profile's `client-local` model route and
 * the user's OpenAI-compatible endpoint on the client host.
 *
 * The profile server talks to this bridge through an SSH reverse tunnel (see
 * `tunnel.ts`); the bridge forwards only `/v1/...` requests to the configured
 * endpoint and replaces any inbound `Authorization` header with the saved key.
 * The real key therefore never leaves the client host, and the profile only
 * carries a placeholder (`DSH_RW_LOCAL_LLM_KEY=local-bridge`).
 *
 * Everything is bound to `127.0.0.1` on an OS-assigned port; responses stream
 * through unbuffered, client aborts tear the upstream request down and an
 * upstream stall past the configured timeout becomes a JSON 504.
 */
import {
  createServer,
  request as httpRequest,
  type ClientRequest,
  type IncomingHttpHeaders,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { Socket } from 'node:net'
import { normalizeLocalBaseUrl } from './settings.ts'
import { scrubSecrets } from '../targets/types.ts'

/** Only request paths under this prefix are proxied to the local endpoint. */
export const LOCAL_LLM_ALLOWED_PATH_PREFIX = '/v1/'

/** Headers that must not be forwarded in either direction (RFC 9110 §7.6.1, plus Host/Authorization). */
export const LOCAL_LLM_HOP_BY_HOP_HEADERS: readonly string[] = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
]

/** Options for one bridge instance. */
export interface LocalLlmBridgeOptions {
  /** The user's endpoint base URL (`http(s)://host[:port][/path]`, optional `/v1`). */
  readonly baseUrl: string
  /** API key injected as `Authorization: Bearer <key>`; omitted when the endpoint needs none. */
  readonly apiKey?: string
  /** Upstream inactivity timeout in milliseconds. */
  readonly timeoutMs: number
}

/** A running bridge. */
export interface LocalLlmBridge {
  /** The loopback host the bridge is bound to (always `127.0.0.1`). */
  readonly host: '127.0.0.1'
  /** The ephemeral loopback port. */
  readonly port: number
  /** `http://127.0.0.1:<port>` (what the reverse tunnel targets). */
  readonly url: string
  /** Stop listening and destroy open connections; idempotent. */
  close(): Promise<void>
}

/** The bridge's stream timeout is intentionally bounded; validate it once. */
function assertTimeout(timeoutMs: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new Error(`invalid local model timeout ${String(timeoutMs)}`)
  }
}

/** Copy the headers worth forwarding, dropping hop-by-hop ones (and optionally content-length). */
function forwardableHeaders(
  headers: IncomingHttpHeaders,
  options: { readonly dropAuthorization: boolean; readonly dropContentLength: boolean },
): OutgoingHttpHeaders {
  const hops = new Set(LOCAL_LLM_HOP_BY_HOP_HEADERS)
  const out: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (value === undefined || hops.has(lower)) continue
    if (options.dropAuthorization && lower === 'authorization') continue
    if (options.dropContentLength && lower === 'content-length') continue
    out[name] = value
  }
  return out
}

/** Send a scrubbed JSON error body (or destroy the response once streaming began). */
function sendJsonError(response: ServerResponse, status: number, code: string, message: string): void {
  if (response.headersSent) {
    response.destroy()
    return
  }
  const body = JSON.stringify({ error: { code, message: scrubSecrets(message) } })
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

/**
 * Start the loopback bridge.
 * @param options - endpoint base, optional key and timeout.
 * @returns the running bridge (call {@link LocalLlmBridge.close} to stop it).
 */
export async function startLocalLlmBridge(options: LocalLlmBridgeOptions): Promise<LocalLlmBridge> {
  assertTimeout(options.timeoutMs)
  const base = normalizeLocalBaseUrl(options.baseUrl)
  const target = new URL(base)
  const requestFn = target.protocol === 'https:' ? httpsRequest : httpRequest
  const sockets = new Set<Socket>()
  const inflight = new Set<ClientRequest>()

  const server: Server = createServer((request, response) => {
    let requestUrl: URL
    try {
      requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    } catch {
      sendJsonError(response, 400, 'local-llm-bad-request', 'malformed request URL')
      return
    }
    if (!requestUrl.pathname.startsWith(LOCAL_LLM_ALLOWED_PATH_PREFIX)) {
      sendJsonError(
        response,
        404,
        'local-llm-not-found',
        `the local model bridge only forwards ${LOCAL_LLM_ALLOWED_PATH_PREFIX} paths`,
      )
      return
    }

    const headers = forwardableHeaders(request.headers, { dropAuthorization: true, dropContentLength: false })
    if (options.apiKey !== undefined && options.apiKey !== '') headers.authorization = `Bearer ${options.apiKey}`
    let upstream: ClientRequest
    try {
      upstream = requestFn(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port === '' ? undefined : Number(target.port),
          method: request.method ?? 'GET',
          path: `${base.slice(`${target.protocol}//${target.host}`.length)}${requestUrl.pathname}${requestUrl.search}`,
          headers,
        },
        upstreamResponse => {
          const responseHeaders = forwardableHeaders(upstreamResponse.headers, {
            dropAuthorization: false,
            dropContentLength: true,
          })
          response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders)
          upstreamResponse.pipe(response)
          upstreamResponse.on('error', () => {
            response.destroy()
          })
          response.on('close', () => {
            if (!upstreamResponse.complete) upstreamResponse.destroy()
          })
        },
      )
    } catch (error) {
      sendJsonError(
        response,
        502,
        'local-llm-upstream-failed',
        `the local model endpoint could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      )
      return
    }

    inflight.add(upstream)
    upstream.on('close', () => {
      inflight.delete(upstream)
    })
    let timedOut = false
    upstream.setTimeout(options.timeoutMs, () => {
      timedOut = true
      if (!response.headersSent) {
        sendJsonError(
          response,
          504,
          'local-llm-upstream-timeout',
          `the local model endpoint did not answer within ${options.timeoutMs} ms`,
        )
      } else {
        response.destroy()
      }
      upstream.destroy()
    })
    upstream.on('error', (error: Error) => {
      if (timedOut) return
      sendJsonError(
        response,
        502,
        'local-llm-upstream-failed',
        `the local model endpoint request failed: ${error.message}`,
      )
    })
    // Client aborts (the profile canceled the turn) tear the upstream down.
    request.on('aborted', () => {
      upstream.destroy()
    })
    response.on('close', () => {
      if (!response.writableEnded) upstream.destroy()
    })
    request.on('error', () => {
      upstream.destroy()
    })
    request.pipe(upstream)
  })

  server.on('connection', (socket: Socket) => {
    sockets.add(socket)
    socket.on('close', () => {
      sockets.delete(socket)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    await new Promise<void>(resolve => {
      server.close(() => {
        resolve()
      })
    })
    throw new Error('the local model bridge failed to bind a loopback port')
  }

  let closing: Promise<void> | undefined
  return {
    host: '127.0.0.1',
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    close(): Promise<void> {
      closing ??= (async () => {
        for (const upstream of inflight) upstream.destroy()
        for (const socket of sockets) socket.destroy()
        await new Promise<void>(resolve => {
          server.close(() => {
            resolve()
          })
        })
      })()
      return closing
    },
  }
}
