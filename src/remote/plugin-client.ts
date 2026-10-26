/**
 * P1 client: the client host's typed view of the **server plugin** API.
 *
 * One instance belongs to one target and one client DSH process (`instanceId`).
 * It owns:
 * - the handshake/lease headers every P1 call carries (`x-dsh-rw-*`);
 * - JSON envelope parsing and the protocol's error-code mapping (§12);
 * - the SSE event stream (profile/registry changes, §6);
 * - the raw WebSocket upgrade for the execution-world mux (§7/§16.9).
 *
 * The transport is injected. Production uses SSH `forwardOut` channels through
 * `src/ssh/forward.ts`; tests use a fake transport and never touch a network.
 * Tokens/cookies stay in the transport/caller: this module only knows the
 * cookie header value it is given and never prints it.
 */
import type { Duplex } from 'node:stream'
import { scrubSecrets } from '../targets/types.ts'

/** The v1 plugin wire protocol; server accepts exact equality only. */
export const REMOTE_WORKSPACE_PLUGIN_PROTOCOL = 1 as const

/** Server plugin route prefix (protocol §4.1). */
export const PLUGIN_ROUTE_PREFIX = '/dsh-remote-workspace-server'

/** P1 route table. */
export const PLUGIN_ROUTES = {
  handshake: `${PLUGIN_ROUTE_PREFIX}/api/handshake`,
  rpc: `${PLUGIN_ROUTE_PREFIX}/api/rpc`,
  events: `${PLUGIN_ROUTE_PREFIX}/api/events`,
  sessionEvents: `${PLUGIN_ROUTE_PREFIX}/api/session/events`,
  mux: `${PLUGIN_ROUTE_PREFIX}/api/mux`,
  bootstrap: `${PLUGIN_ROUTE_PREFIX}/embed/bootstrap.js`,
  embedCss: `${PLUGIN_ROUTE_PREFIX}/embed/embed.css`,
} as const

/** One HTTP response as the transport reports it. */
export interface PluginHttpResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>
  readonly body: Buffer
}

/** One streaming (SSE) response. */
export interface PluginStreamResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>
  readonly body: AsyncIterable<Buffer | string>
}

/** One successful WebSocket upgrade, with any bytes that arrived with it. */
export interface PluginUpgradeResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>
  readonly socket: Duplex
  readonly head: Buffer
}

/** One HTTP request the transport must perform on the profile server. */
export interface PluginHttpRequest {
  readonly method: string
  readonly path: string
  readonly headers: Readonly<Record<string, string>>
  readonly body?: Buffer
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

/** The injectable transport seam (SSH tunnel in production, fake in tests). */
export interface PluginTransport {
  request(request: PluginHttpRequest): Promise<PluginHttpResponse>
  /** Optional streaming request, required for `events()`. */
  stream?(request: PluginHttpRequest): Promise<PluginStreamResponse>
  /** Optional upgrade request, required for `openMux()`. */
  upgrade?(request: PluginHttpRequest): Promise<PluginUpgradeResponse>
}

/** A coded P1 failure; `code` is the stable wire code (protocol §12). */
export class RemotePluginError extends Error {
  readonly status: number
  readonly details: unknown
  constructor(code: string, message: string, options: { readonly status?: number; readonly details?: unknown } = {}) {
    super(scrubSecrets(message))
    this.name = 'RemotePluginError'
    this.code = code
    this.status = options.status ?? 500
    this.details = options.details
  }

  /** The stable code (separate field so `instanceof` across bundles is unnecessary). */
  readonly code: string
}

/** Whether an unknown error is a coded P1 failure. */
export function isRemotePluginError(error: unknown): error is RemotePluginError {
  return error instanceof RemotePluginError
}

/** Handshake request (protocol §3.5). */
export interface PluginHandshakeRequest {
  readonly protocol: typeof REMOTE_WORKSPACE_PLUGIN_PROTOCOL
  readonly pluginVersion: string
  readonly clientId: string
  readonly instanceId: string
  readonly profile: string
  readonly capabilities?: readonly string[]
}

/** Server capabilities (protocol §2.3); unknown keys are tolerated. */
export interface ServerCapabilities {
  readonly workspaceApi?: 1
  readonly sessionApi?: 1
  readonly persistRpc?: 1
  readonly executor?: 1
  readonly eventsSse?: 1
  readonly muxWs?: 1
  readonly embed?: { readonly storagePrefix: string; readonly mode: 'reload' | 'client-half' }
  readonly registryReload?: 'process-restart' | 'loader-disable-enable' | 'none'
  readonly registryWriteGuard?: 'prototype' | 'none'
}

/** Handshake response (protocol §3.5). */
export interface PluginHandshakeResponse {
  readonly protocol: typeof REMOTE_WORKSPACE_PLUGIN_PROTOCOL
  readonly pluginVersion: string
  readonly dshVersion: string
  readonly profile: string
  readonly clientId: string
  readonly lease: { readonly instanceId: string; readonly expiresAt: string }
  readonly staleTakeover?: boolean
  readonly registry?: {
    readonly initialized?: boolean
    readonly revision?: string
    readonly epoch?: string
  }
  readonly capabilities?: ServerCapabilities
  readonly activeAgents?: readonly { readonly sessionId: string; readonly running: boolean; readonly status: string }[]
}

/** The JSON envelope (protocol §2.1). */
interface Envelope<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: { readonly code?: string; readonly message?: string; readonly details?: unknown }
}

/** Parse and validate one envelope, throwing a coded error for failures. */
export function parsePluginEnvelope<T>(status: number, text: string, context: string): T {
  let parsed: unknown
  try {
    parsed = text === '' ? undefined : JSON.parse(text)
  } catch {
    // A non-JSON answer is how the official UI says "this route does not
    // exist": the server plugin is not installed/loaded (protocol §2.3).
    if (status === 404) throw new RemotePluginError('plugin-missing', `the server plugin is not installed on the remote profile (${context})`, { status: 404 })
    throw new RemotePluginError('internal', `the server plugin answered with non-JSON (${context}, HTTP ${status})`, { status })
  }
  const envelope = parsed as Envelope<T> | undefined
  if (envelope === undefined || typeof envelope !== 'object' || typeof envelope.ok !== 'boolean') {
    throw new RemotePluginError('internal', `the server plugin answered with an invalid envelope (${context})`, { status })
  }
  if (envelope.ok) {
    if (!('value' in envelope)) throw new RemotePluginError('internal', `the server plugin answered ok without a value (${context})`, { status })
    return envelope.value as T
  }
  const error = envelope.error ?? {}
  const code = typeof error.code === 'string' && error.code !== '' ? error.code : 'internal'
  const message = typeof error.message === 'string' && error.message !== '' ? error.message : `${code} (${context})`
  throw new RemotePluginError(code, message, { status, ...(error.details === undefined ? {} : { details: error.details }) })
}

/** Map a transport failure onto the protocol's error vocabulary. */
export function mapTransportFailure(error: unknown, context: string): RemotePluginError {
  if (isRemotePluginError(error)) return error
  const coded = error as { code?: unknown; name?: unknown; message?: unknown }
  if (coded.name === 'AbortError') return new RemotePluginError('timeout', `${context} was cancelled or timed out`, { status: 504 })
  if (coded.code === 'upstream-timeout') return new RemotePluginError('timeout', `${context} timed out`, { status: 504 })
  const message = typeof coded.message === 'string' && coded.message !== '' ? coded.message : String(error)
  return new RemotePluginError('tunnel-unavailable', `${context} failed: ${message}`, { status: 503 })
}

/** First value of a possibly multi-valued response header. */
export function headerValue(headers: PluginHttpResponse['headers'], name: string): string | undefined {
  const value = headers[name.toLowerCase()]
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0]
  return undefined
}

/** One decoded SSE frame. */
export interface PluginSseEvent {
  /** `hello`, `change`, or `message` when the stream omits `event:`. */
  readonly event: string
  readonly data: string
}

/**
 * Incremental SSE decoder (text/event-stream).
 *
 * Kept as a class rather than a generator so tests can feed arbitrary chunk
 * boundaries; `data:` lines are joined with `\n`, comments (`: ping`) are
 * ignored, and a final unterminated frame is dropped (the stream ended).
 */
export class SseDecoder {
  private buffer = ''

  /** Feed one chunk; returns every frame completed by it. */
  push(chunk: string): PluginSseEvent[] {
    this.buffer += chunk.replace(/\r\n/gu, '\n')
    const events: PluginSseEvent[] = []
    for (;;) {
      const boundary = this.buffer.indexOf('\n\n')
      if (boundary === -1) break
      const raw = this.buffer.slice(0, boundary)
      this.buffer = this.buffer.slice(boundary + 2)
      const event = decodeSseFrame(raw)
      if (event !== undefined) events.push(event)
    }
    return events
  }

  /** Whether an unterminated frame is buffered (for diagnostics/tests). */
  get pending(): string {
    return this.buffer
  }
}

/** Decode one `\n`-separated SSE frame, ignoring comments/empty frames. */
export function decodeSseFrame(raw: string): PluginSseEvent | undefined {
  let event = 'message'
  const data: string[] = []
  for (const line of raw.split('\n')) {
    if (line === '' || line.startsWith(':')) continue
    const at = line.indexOf(':')
    const field = at === -1 ? line : line.slice(0, at)
    let value = at === -1 ? '' : line.slice(at + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  if (data.length === 0) return undefined
  return { event, data: data.join('\n') }
}

/** Iterate decoded SSE frames from a byte/string stream. */
export async function* iterateSse(body: AsyncIterable<Buffer | string>): AsyncGenerator<PluginSseEvent> {
  const decoder = new SseDecoder()
  for await (const chunk of body) {
    for (const event of decoder.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))) yield event
  }
}

/** Planned v2 P1 session RPC names (adapters may rename them later). */
export const SESSION_RPC = {
  timeline: 'session/timeline',
  prompt: 'session/prompt',
  cancel: 'session/cancel',
  approval: 'session/approval',
  status: 'session/status',
} as const

/** Query one v2 session event stream (afterSeq is exclusive/inclusive per server). */
export function sessionEventsPath(options: { readonly sessionId: string; readonly afterSeq?: number }): string {
  const query = new URLSearchParams({ sessionId: options.sessionId })
  if (options.afterSeq !== undefined && Number.isFinite(options.afterSeq)) query.set('afterSeq', String(Math.trunc(options.afterSeq)))
  return `${PLUGIN_ROUTES.sessionEvents}?${query.toString()}`
}

/** One session-event stream call; the frames stay decoded SSE frames. */
export interface SessionEventStreamOptions {
  readonly sessionId: string
  readonly afterSeq?: number
  readonly signal?: AbortSignal
}

/** Headers every P1 request carries (protocol §4.1). */
export function pluginRequestHeaders(options: {
  readonly clientId: string
  readonly instanceId: string
  readonly protocol?: number
  readonly cookie?: string
  readonly contentType?: string
}): Record<string, string> {
  return {
    ...(options.cookie === undefined || options.cookie === '' ? {} : { cookie: options.cookie }),
    ...(options.contentType === undefined ? {} : { 'content-type': options.contentType }),
    'x-dsh-rw-client': options.clientId,
    'x-dsh-rw-instance': options.instanceId,
    'x-dsh-rw-protocol': String(options.protocol ?? REMOTE_WORKSPACE_PLUGIN_PROTOCOL),
  }
}

/** The upgrade request headers for the execution-world mux (protocol §7.1). */
export function muxUpgradeHeaders(options: {
  readonly clientId: string
  readonly instanceId: string
  readonly cookie?: string
  readonly key: string
}): Record<string, string> {
  return {
    connection: 'Upgrade',
    upgrade: 'websocket',
    'sec-websocket-version': '13',
    'sec-websocket-key': options.key,
    'x-dsh-rw-client': options.clientId,
    'x-dsh-rw-instance': options.instanceId,
    'x-dsh-rw-protocol': String(REMOTE_WORKSPACE_PLUGIN_PROTOCOL),
    ...(options.cookie === undefined || options.cookie === '' ? {} : { cookie: options.cookie }),
  }
}

/** Options for {@link RemotePluginClient}. */
export interface RemotePluginClientOptions {
  readonly transport: PluginTransport
  readonly clientId: string
  readonly instanceId: string
  /** Diagnostic only; never used for compatibility decisions. */
  readonly pluginVersion?: string
  readonly requestTimeoutMs?: number
  readonly cookie?: string
}

/**
 * One target's P1 client.
 *
 * Stateless with respect to leases: `handshake()` records the latest lease for
 * diagnostics, but every call sends the identity headers and the server decides.
 */
export class RemotePluginClient {
  private cookieHeader: string | undefined
  private lease: PluginHandshakeResponse['lease'] | undefined
  private profileName = ''
  private capabilitiesValue: ServerCapabilities | undefined

  constructor(private readonly options: RemotePluginClientOptions) {
    this.cookieHeader = options.cookie
  }

  /** Replace the official cookie (after a profile restart the port/authority changes). */
  setCookie(cookie: string | undefined): void {
    this.cookieHeader = cookie
  }

  /** The lease last returned by `handshake` (diagnostics only). */
  get leaseState(): PluginHandshakeResponse['lease'] | undefined {
    return this.lease
  }

  /** The capabilities advertised by the last handshake. */
  get capabilities(): ServerCapabilities | undefined {
    return this.capabilitiesValue
  }

  /** The server profile this client handshook with. */
  get profile(): string {
    return this.profileName
  }

  private get timeoutMs(): number {
    return this.options.requestTimeoutMs ?? 30_000
  }

  private headers(contentType?: string): Record<string, string> {
    return pluginRequestHeaders({
      clientId: this.options.clientId,
      instanceId: this.options.instanceId,
      ...(this.cookieHeader === undefined ? {} : { cookie: this.cookieHeader }),
      ...(contentType === undefined ? {} : { contentType }),
    })
  }

  /** `POST /api/handshake`; on success the lease and capabilities are recorded. */
  async handshake(request: { readonly profile: string; readonly capabilities?: readonly string[] }, signal?: AbortSignal): Promise<PluginHandshakeResponse> {
    const body: PluginHandshakeRequest = {
      protocol: REMOTE_WORKSPACE_PLUGIN_PROTOCOL,
      pluginVersion: this.options.pluginVersion ?? '',
      clientId: this.options.clientId,
      instanceId: this.options.instanceId,
      profile: request.profile,
      ...(request.capabilities === undefined ? {} : { capabilities: request.capabilities }),
    }
    const response = await this.call('POST', PLUGIN_ROUTES.handshake, body, signal)
    const parsed = parseHandshakeResponse(response)
    this.profileName = parsed.profile
    this.lease = parsed.lease
    this.capabilitiesValue = parsed.capabilities
    return parsed
  }

  /** One P1 RPC (protocol §4.1/§4.2). */
  async rpc<T>(method: string, params: unknown = {}, signal?: AbortSignal): Promise<T> {
    const response = await this.call('POST', PLUGIN_ROUTES.rpc, {
      protocol: REMOTE_WORKSPACE_PLUGIN_PROTOCOL,
      method,
      params,
    }, signal)
    return parsePluginEnvelope<T>(response.status, response.body.toString('utf8'), `P1 ${method}`)
  }

  /** `profile/heartbeat`; returns the lease expiry and registry revision facts. */
  async heartbeat(signal?: AbortSignal): Promise<{ expiresAt: string; registry?: PluginHandshakeResponse['registry'] }> {
    return await this.rpc('profile/heartbeat', {}, signal)
  }

  /** `profile/release`; best effort on disconnect. */
  async release(signal?: AbortSignal): Promise<void> {
    await this.rpc('profile/release', {}, signal)
  }

  /** `profile/cancel-all`; the disconnect path cancels every live turn (protocol §3.6). */
  async cancelAll(signal?: AbortSignal): Promise<{ canceled: readonly string[] }> {
    return await this.rpc('profile/cancel-all', {}, signal)
  }

  /** Subscribe to the P1 SSE stream (protocol §6). */
  async *events(signal?: AbortSignal): AsyncGenerator<PluginSseEvent> {
    if (this.options.transport.stream === undefined) throw new RemotePluginError('internal', 'the P1 transport does not support streaming')
    let response: PluginStreamResponse
    try {
      response = await this.options.transport.stream({
        method: 'GET',
        path: PLUGIN_ROUTES.events,
        headers: this.headers(),
        timeoutMs: this.timeoutMs,
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      throw mapTransportFailure(error, 'P1 events')
    }
    if (response.status !== 200) {
      const chunks: Buffer[] = []
      for await (const chunk of response.body) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
      parsePluginEnvelope(response.status, Buffer.concat(chunks).toString('utf8'), 'P1 events')
      return
    }
    yield* iterateSse(response.body)
  }

  /**
   * v2 session event SSE (`GET /api/session/events`).
   *
   * The host forwards these frames to its own same-origin EventSource. A
   * reconnect with `afterSeq` is the caller's job: this method only exposes the
   * exact frames the server sent, in order.
   */
  async *sessionEvents(options: SessionEventStreamOptions): AsyncGenerator<PluginSseEvent> {
    if (this.options.transport.stream === undefined) throw new RemotePluginError('internal', 'the P1 transport does not support streaming')
    let response: PluginStreamResponse
    try {
      response = await this.options.transport.stream({
        method: 'GET',
        path: sessionEventsPath(options),
        headers: this.headers(),
        timeoutMs: this.timeoutMs,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
    } catch (error) {
      throw mapTransportFailure(error, 'P1 session events')
    }
    if (response.status !== 200) {
      const chunks: Buffer[] = []
      for await (const chunk of response.body) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
      parsePluginEnvelope(response.status, Buffer.concat(chunks).toString('utf8'), 'P1 session events')
      return
    }
    yield* iterateSse(response.body)
  }

  /** Open the raw execution-world WebSocket upgrade (protocol §7). */
  async openMux(options: { readonly key: string; readonly signal?: AbortSignal }): Promise<PluginUpgradeResponse> {
    if (this.options.transport.upgrade === undefined) throw new RemotePluginError('internal', 'the P1 transport does not support upgrades')
    try {
      const response = await this.options.transport.upgrade({
        method: 'GET',
        path: PLUGIN_ROUTES.mux,
        headers: muxUpgradeHeaders({
          clientId: this.options.clientId,
          instanceId: this.options.instanceId,
          ...(this.cookieHeader === undefined ? {} : { cookie: this.cookieHeader }),
          key: options.key,
        }),
        timeoutMs: this.timeoutMs,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      if (response.status !== 101) {
        throw new RemotePluginError('tunnel-unavailable', `the execution-world mux upgrade was refused (HTTP ${response.status})`, { status: response.status })
      }
      return response
    } catch (error) {
      throw mapTransportFailure(error, 'P1 mux upgrade')
    }
  }

  /** Perform one raw HTTP call through the transport with the shared headers. */
  private async call(method: string, path: string, body: unknown, signal?: AbortSignal): Promise<PluginHttpResponse> {
    let response: PluginHttpResponse
    try {
      response = await this.options.transport.request({
        method,
        path,
        headers: this.headers('application/json'),
        body: Buffer.from(JSON.stringify(body), 'utf8'),
        timeoutMs: this.timeoutMs,
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      throw mapTransportFailure(error, `P1 ${method} ${path}`)
    }
    return response
  }
}

/** Validate a handshake response enough to fail closed on a wrong shape. */
export function parseHandshakeResponse(response: PluginHttpResponse): PluginHandshakeResponse {
  const text = response.body.toString('utf8')
  const value = parsePluginEnvelope<unknown>(response.status, text, 'P1 handshake')
  if (value === null || typeof value !== 'object') throw new RemotePluginError('internal', 'the handshake value is not an object', { status: response.status })
  const parsed = value as Partial<PluginHandshakeResponse>
  if (parsed.protocol !== REMOTE_WORKSPACE_PLUGIN_PROTOCOL) {
    throw new RemotePluginError(
      'plugin-protocol-mismatch',
      `the server plugin speaks protocol ${String(parsed.protocol)}, this client requires ${REMOTE_WORKSPACE_PLUGIN_PROTOCOL}`,
      { status: response.status, details: { clientProtocol: REMOTE_WORKSPACE_PLUGIN_PROTOCOL, serverProtocol: parsed.protocol } },
    )
  }
  if (
    typeof parsed.pluginVersion !== 'string' ||
    typeof parsed.dshVersion !== 'string' ||
    typeof parsed.profile !== 'string' ||
    typeof parsed.clientId !== 'string' ||
    parsed.lease === undefined ||
    typeof parsed.lease !== 'object' ||
    typeof parsed.lease.instanceId !== 'string' ||
    typeof parsed.lease.expiresAt !== 'string'
  ) {
    throw new RemotePluginError('internal', 'the handshake response is missing required fields', { status: response.status })
  }
  return parsed as PluginHandshakeResponse
}
