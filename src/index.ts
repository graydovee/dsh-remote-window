/**
 * `dsh-remote-window` host row (v1).
 *
 * It owns the target store, the per-client profile/runtime lifecycle, the P1
 * client/portal and the browser-facing API. The browser UI lives in `./client`;
 * the realm is mounted per target by `preset/world.ts`.
 */
import { readFileSync } from 'node:fs'
import { once } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'
import Schema from '@deepseek-ai/schemastery'
import { createRoutingPersistence, localSessionRoot, type RoutingRemoteService, type SessionRoute } from './session-persistence/routing.ts'
import { assertRemoteSessionPreset } from './session/remote-guard.ts'
import { listSshAliases } from './ssh-config.ts'
import { TargetStore } from './targets/store.ts'
import { reconnectDshHome } from './targets/methods.ts'
import { scrubSecrets, toPublicTarget } from './targets/types.ts'
import { HostKeyMismatchError, HostKeyUnknownError } from './ssh/hostkey.ts'
import { DSH_VERIFIED_RUNTIMES } from './provision/version-range.ts'
import { REMOTE_WORKSPACE_PLUGIN_PROTOCOL } from './remote/plugin-client.ts'
import { PORTAL_BASE, portalMuxPath } from './portal/proxy.ts'
import { ProfileService, createSshProfileConnector, readPrivateKeyFile, type ConnectProgressEvent } from './provision/profile-service.ts'
import { RemoteMuxRouter } from './remote/mux-client.ts'
import { dispatchLocalLlmApi, parseModelSource } from './local-llm/routes.ts'
import type { NativeLlmRuntime } from './local-llm/native.ts'

/** Route prefix for the plugin's own API and SSE channel. */
export const ROUTE_PREFIX = '/dsh-remote-window'

/** Plugin row name. */
export const name = 'dsh-remote-window'

/** Host-plane services this row needs before it can register anything. */
export const inject = ['agentPresets', 'storageDomain', 'credentials', 'agents', 'webServer']

/** Tunables; every one of them is also settable from `cordis.yml`. */
export interface Config {
  /** Remote profile name to generate (legacy; v1 derives it from clientId). */
  serverProfile: string
  /** Lease offered to remote servers (legacy). */
  leaseMs: number
  /** Maximum remote process handles (legacy). */
  maxProcesses: number
  /** Whether to register presets for stored targets at startup (legacy). */
  restoreTargets: boolean
}

/** Validated configuration. */
export const Config: Schema<Config> = Schema.object({
  serverProfile: Schema.string().default('dsh-remote-server').description('Legacy remote profile name; v1 uses per-client profiles.'),
  leaseMs: Schema.number().default(30_000).description('Legacy remote server lease in milliseconds.'),
  maxProcesses: Schema.number().default(128).description('Legacy maximum remote process handles.'),
  restoreTargets: Schema.boolean().default(true).description('Legacy startup preset registration flag.'),
})

/** JSON request body, bounded like every other plugin route in this app. */
const MAX_BODY_BYTES = 1 << 20

/** Per-attempt connect progress, polled by the wizard (bounded; ephemeral). */
const CONNECT_PROGRESS = new Map<string, ConnectProgressEvent[]>()

/** Error codes the browser distinguishes; everything unmapped stays 500. */
const STATUS_BY_CODE: Record<string, number> = {
  'bad-request': 400,
  'not-found': 404,
  'unsupported': 400,
  'forbidden': 403,
  'ssh-auth-failed': 401,
}

/** A coded route failure whose status and details reach the browser. */
class RouteError extends Error {
  constructor(readonly code: string, message: string, readonly status = 500, readonly details?: unknown) {
    super(message)
    this.name = 'RouteError'
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new RouteError('bad-request', 'request body too large', 400)
    chunks.push(buffer)
  }
  if (total === 0) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new RouteError('bad-request', 'request body is not valid JSON', 400)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RouteError('bad-request', 'request body must be a JSON object', 400)
  }
  return parsed as Record<string, unknown>
}

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== 'string' || value.trim() === '') throw new RouteError('bad-request', `"${field}" is required`, 400)
  return value
}

function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new RouteError('bad-request', `"${field}" must be a string`, 400)
  return value
}

function trustedRequest(ctx: Context, req: IncomingMessage): boolean {
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  const runtime = ctx.get('webRuntime') as { trustedHosts?: readonly string[] } | undefined
  const trustedHosts = runtime?.trustedHosts ?? []
  const hostname = hostUrl.hostname
  const loopback = hostname === 'localhost' || hostname === '[::1]' || hostname === '::1' || /^127\./.test(hostname)
  const allowed = loopback || trustedHosts.some(entry => entry === host || entry === hostname)
  if (!allowed) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    try {
      if (new URL(origin).host !== hostUrl.host) return false
    } catch {
      return false
    }
  }
  return true
}

function pluginVersion(): string {
  if (cachedPluginVersion === '') {
    const here = fileURLToPath(new URL('.', import.meta.url))
    for (const candidate of [join(here, '..', 'package.json'), join(here, 'package.json')]) {
      try {
        cachedPluginVersion = JSON.parse(readFileSync(candidate, 'utf8')).version ?? ''
        if (cachedPluginVersion !== '') break
      } catch {}
    }
  }
  return cachedPluginVersion
}


/** Absolute local plugin package root, derived from this module's location. */
function packageRootFrom(moduleUrl: string): string {
  return join(fileURLToPath(new URL('..', moduleUrl)))
}


/** Serve one vendored official UI bundle (static, no secrets). */
function serveOfficialUi(req: IncomingMessage, res: ServerResponse, file = 'conversation-client.js'): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.end()
    return
  }
  try {
    const body = readFileSync(join(packageRootFrom(import.meta.url), 'assets/official-ui', file))
    res.statusCode = 200
    res.setHeader('content-type', 'text/javascript; charset=utf-8')
    res.setHeader('cache-control', 'no-cache')
    res.setHeader('x-content-type-options', 'nosniff')
    if (req.method === 'HEAD') { res.end(); return }
    res.end(body)
  } catch (error) {
    res.statusCode = 500
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.end(`official ui bundle unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Register the plugin's routes and return a disposer. */
function registerRoutes(ctx: Context, profiles: ProfileService): () => void {
  const disposers: Array<() => void> = []
  disposers.push(ctx.webServer.register({
    kind: 'prefix',
    path: `${ROUTE_PREFIX}/api`,
    handler: (req, res) => { void handleApi(ctx, profiles, req, res) },
  }))
  // Vendored official conversation bundle. Served from this plugin's own
  // origin so the browser can evaluate the exact rc.3 component code; the
  // route is static and contains no target data or secrets.
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/official-ui.js`,
    handler: (req, res) => { serveOfficialUi(req, res) },
  }))
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/official-ui-chat.js`,
    handler: (req, res) => { serveOfficialUi(req, res, 'chat-client.js') },
  }))
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/official-ui-approval.js`,
    handler: (req, res) => { serveOfficialUi(req, res, 'approval-client.js') },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/official-ui-model.js`,
    handler: (req, res) => { serveOfficialUi(req, res, 'model-client.js') },
  }))
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/official-ui-tool.js`,
    handler: (req, res) => { serveOfficialUi(req, res, 'tool-client.js') },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/official-ui-trajectory.js`,
    handler: (req, res) => { serveOfficialUi(req, res, 'trajectory-client.js') },
  }))
  // v2 same-origin session event stream (native conversation, no iframe).
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/api/session/events`,
    handler: (req, res) => { void handleSessionEvents(ctx, profiles, req, res) },
  }))
  // Same-origin portal (protocol §8): HTTP is a prefix route, the WebSocket
  // upgrade is registered exactly per connected target by ProfileService.
  disposers.push(ctx.webServer.register({
    kind: 'prefix',
    path: `${ROUTE_PREFIX}/portal`,
    handler: (req, res) => { void handlePortal(ctx, profiles, req, res) },
  }))
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

/** Extract the first targetId segment of a portal URL, when it is one. */
function portalTargetId(url: string | undefined): string | undefined {
  const path = new URL(url ?? '/', 'http://dsh.internal').pathname
  const base = `${ROUTE_PREFIX}/portal/`
  if (!path.startsWith(base)) return undefined
  const segment = path.slice(base.length).split('/')[0]
  return segment === undefined || segment === '' ? undefined : decodeURIComponent(segment)
}

/** Answer one portal HTTP request (unmounted targets are a coded 404). */
async function handlePortal(ctx: Context, profiles: ProfileService, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (!trustedRequest(ctx, req)) throw new RouteError('forbidden', 'forbidden', 403)
    const targetId = portalTargetId(req.url)
    const proxy = targetId === undefined ? undefined : profiles.portalFor(targetId)
    if (proxy === undefined) throw new RouteError('target-not-connected', `remote target ${JSON.stringify(targetId ?? '')} is not connected`, 404)
    await proxy.handleRequest(req, res)
  } catch (error) {
    if (error instanceof RouteError) {
      writeJson(res, error.status, { ok: false, error: { code: error.code, message: scrubSecrets(error.message), ...(error.details === undefined ? {} : { details: error.details }) } })
      return
    }
    writeJson(res, 500, { ok: false, error: { code: 'internal', message: scrubSecrets(error instanceof Error ? error.message : String(error)) } })
  }
}

/** Query parameters of the v2 session-event SSE route. */
export function sessionEventsQuery(url: string | undefined): { targetId: string; sessionId: string; afterSeq?: number } {
  const query = new URL(url ?? '/', 'http://dsh.internal').searchParams
  const targetId = query.get('targetId') ?? ''
  const sessionId = query.get('sessionId') ?? ''
  if (targetId === '') throw new RouteError('bad-request', '"targetId" is required', 400)
  if (sessionId === '') throw new RouteError('bad-request', '"sessionId" is required', 400)
  const rawAfter = query.get('afterSeq')
  let afterSeq: number | undefined
  if (rawAfter !== null && rawAfter !== '') {
    const parsed = Number(rawAfter)
    if (!Number.isInteger(parsed) || parsed < -1) throw new RouteError('bad-request', '"afterSeq" must be -1 or a non-negative integer', 400)
    afterSeq = parsed
  }
  return { targetId, sessionId, ...(afterSeq === undefined ? {} : { afterSeq }) }
}

/** Official approval decisions accepted by `session/approval`. */
export const APPROVAL_DECISIONS = ['allowed-once', 'rejected', 'cancelled', 'allow', 'deny'] as const

/** Validate one approval decision (allow/deny are UI aliases). */
export function approvalDecision(value: unknown): (typeof APPROVAL_DECISIONS)[number] {
  if (typeof value !== 'string' || !(APPROVAL_DECISIONS as readonly string[]).includes(value)) {
    throw new RouteError('bad-request', `"decision" must be one of ${APPROVAL_DECISIONS.join('|')}`, 400)
  }
  return value as (typeof APPROVAL_DECISIONS)[number]
}

/** Long-lived same-origin SSE bridge for one v2 server session. */
export async function handleSessionEvents(ctx: Context, profiles: ProfileService, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (!trustedRequest(ctx, req)) throw new RouteError('forbidden', 'forbidden', 403)
    if (req.method !== 'GET') throw new RouteError('method-error', 'only GET is allowed', 405)
    const query = sessionEventsQuery(req.url)
    const state = profiles.connectionState(query.targetId)
    if (state === undefined || state.phase !== 'ready') {
      throw new RouteError('target-not-connected', `remote target ${JSON.stringify(query.targetId)} is not connected`, 404)
    }
    const controller = new AbortController()
    const abort = (): void => { if (!controller.signal.aborted) controller.abort(new Error('SSE client disconnected')) }
    // `IncomingMessage` 'close' can fire when the GET message itself is
    // complete; only the response/socket close means the SSE consumer left.
    req.on('aborted', abort)
    res.on('close', abort)
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-store, must-revalidate',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.flushHeaders?.()
    res.write(': connected\n\n')
    const keepalive = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) res.write(': keepalive\n\n')
    }, 15_000)
    keepalive.unref?.()
    try {
      for await (const event of profiles.sessionEvents(query.targetId, {
        sessionId: query.sessionId,
        ...(query.afterSeq === undefined ? {} : { afterSeq: query.afterSeq }),
        signal: controller.signal,
      })) {
        if (res.writableEnded || res.destroyed) break
        const name = event.event === '' ? 'message' : event.event.replace(/[\r\n]/gu, '')
        const data = event.data.split('\n').map(line => `data: ${line}`).join('\n')
        const frame = `event: ${name}\n${data}\n\n`
        if (!res.write(frame)) {
          await Promise.race([
            once(res, 'drain').then(() => undefined).catch(() => undefined),
            new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve(), { once: true })),
          ])
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = scrubSecrets(error instanceof Error ? error.message : String(error))
        const code = typeof (error as { code?: unknown }).code === 'string' ? String((error as { code?: unknown }).code) : 'session-events-failed'
        if (!res.writableEnded && !res.destroyed) {
          res.write(`event: error\ndata: ${JSON.stringify({ code, message })}\n\n`)
        }
      }
    } finally {
      clearInterval(keepalive)
      if (!res.writableEnded) res.end()
    }
  } catch (error) {
    if (res.headersSent) {
      if (!res.writableEnded) res.end()
      return
    }
    if (error instanceof RouteError) {
      writeJson(res, error.status, { ok: false, error: { code: error.code, message: scrubSecrets(error.message), ...(error.details === undefined ? {} : { details: error.details }) } })
      return
    }
    writeJson(res, 500, { ok: false, error: { code: 'internal', message: scrubSecrets(error instanceof Error ? error.message : String(error)) } })
  }
}

async function handleApi(ctx: Context, profiles: ProfileService, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (!trustedRequest(ctx, req)) throw new RouteError('forbidden', 'forbidden', 403)
    if (req.method !== 'POST') throw new RouteError('method-error', 'only POST is allowed', 405)
    const method = new URL(req.url ?? '/', 'http://dsh.internal').pathname.slice(`${ROUTE_PREFIX}/api/`.length)
    const body = await readJsonBody(req)
    const value = await dispatchApi(ctx, profiles, method, body)
    writeJson(res, 200, { ok: true, value })
  } catch (error) {
    if (error instanceof RouteError) {
      writeJson(res, error.status, { ok: false, error: { code: error.code, message: scrubSecrets(error.message), ...(error.details === undefined ? {} : { details: error.details }) } })
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    const code = (error as { code?: string }).code
    const explicitStatus = (error as { status?: unknown }).status
    const status = typeof explicitStatus === 'number' ? explicitStatus : typeof code === 'string' ? STATUS_BY_CODE[code] : undefined
    writeJson(res, status ?? 500, {
      ok: false,
      error: {
        code: typeof code === 'string' ? code : 'internal',
        message: scrubSecrets(message),
        ...((error as { details?: unknown }).details === undefined ? {} : { details: (error as { details?: unknown }).details }),
      },
    })
  }
}

/** One P3 call; every branch is a v1 host API over ProfileService/P1. */
async function dispatchApi(ctx: Context, profiles: ProfileService, method: string, body: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case 'ssh-aliases': {
      const { aliases, warnings } = await listSshAliases()
      return {
        aliases: aliases.map(alias => ({
          alias: alias.alias,
          ...(alias.hostName === undefined ? {} : { hostName: alias.hostName }),
          ...(alias.port === undefined ? {} : { port: alias.port }),
          ...(alias.user === undefined ? {} : { user: alias.user }),
          ...(alias.identityFile === undefined ? {} : { identityFile: alias.identityFile }),
          source: alias.source,
        })),
        warnings,
      }
    }
    case 'state': {
      if (storageFailure !== '') throw new RouteError('storage-unavailable', `plugin storage failed to open: ${storageFailure}`, 500)
      const clientId = await store.ensureClientId()
      const connections = profiles.connections()
      const v1Workspaces: Record<string, unknown> = {}
      const v1Sessions: Record<string, unknown> = {}
      for (const [targetId, state] of Object.entries(connections)) {
        if (state.phase !== 'ready') continue
        try {
          const [workspacesValue, sessionsValue] = await Promise.race([
            Promise.all([profiles.workspaceList(targetId), profiles.sessionList(targetId)]),
            new Promise<never>((_resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('P1 state read timed out')), 3_000)
              timer.unref?.()
            }),
          ])
          v1Workspaces[targetId] = workspacesValue
          v1Sessions[targetId] = sessionsValue
          const registry = (workspacesValue as { registry?: { revision?: unknown; epoch?: unknown } }).registry
          const previous = connections[targetId]
          if (previous !== undefined && typeof registry?.revision === 'string' && registry.revision !== '') {
            connections[targetId] = {
              ...previous,
              registry: {
                revision: registry.revision,
                ...(typeof registry.epoch === 'string' ? { epoch: registry.epoch } : {}),
                stale: false,
              },
            }
          }
        } catch (error) {
          const message = scrubSecrets(error instanceof Error ? error.message : String(error))
          v1Workspaces[targetId] = { error: { code: 'p1-read-failed', message } }
          const previous = connections[targetId]
          if (previous !== undefined) {
            connections[targetId] = { ...previous, phase: 'degraded', error: { code: 'p1-read-failed', message } }
          }
        }
      }
      return {
        clientId,
        protocol: REMOTE_WORKSPACE_PLUGIN_PROTOCOL,
        portalBase: PORTAL_BASE,
        connections,
        workspaces: v1Workspaces,
        sessions: v1Sessions,
        targets: store.listTargets().map(toPublicTarget),
        pluginVersion: pluginVersion(),
        verifiedRuntimes: [...DSH_VERIFIED_RUNTIMES],
        platform: process.platform,
      }
    }
    case 'v1/connect': {
      const kind = optionalString(body, 'kind') ?? 'ssh'
      if (kind !== 'ssh') throw new RouteError('unsupported', 'v1 connections are SSH-only', 400)
      const requestedModelSource = parseModelSource(body)
      const targetId = optionalString(body, 'targetId')
      const attemptId = optionalString(body, 'attemptId')
      if (attemptId !== undefined) {
        if (CONNECT_PROGRESS.size >= 32) {
          const oldest = CONNECT_PROGRESS.keys().next().value
          if (oldest !== undefined) CONNECT_PROGRESS.delete(oldest)
        }
        CONNECT_PROGRESS.set(attemptId, [])
      }
      const reportProgress = attemptId === undefined
        ? undefined
        : (event: ConnectProgressEvent): void => {
          const events = CONNECT_PROGRESS.get(attemptId)
          if (events === undefined) return
          events.push(event)
          if (events.length > 300) events.splice(0, events.length - 300)
        }
      const saved = targetId === undefined ? undefined : store.target(targetId)
      if (targetId !== undefined && saved === undefined) {
        throw new RouteError('not-found', `remote target "${targetId}" does not exist`, 404)
      }
      if (saved !== undefined) {
        if (saved.kind !== 'ssh') throw new RouteError('unsupported', 'v1 connections are SSH-only', 400)
        const secret = await store.secretOf(saved)
        const savedKey = saved.authKind === 'privateKey' && saved.privateKeyPath !== undefined
          ? await readPrivateKeyFile(saved.privateKeyPath)
          : undefined
        // A reconnect carries no wizard body: reuse the DSH_HOME resolved by the
        // original connect, otherwise the profile patch lands in a different
        // directory and the server keeps calling the previous bridge port.
        const reconnectHome = reconnectDshHome(saved.remote.dshHome, optionalString(body, 'dshHome'))
        try {
          return await profiles.connect({
            label: optionalString(body, 'label') ?? saved.label,
            host: saved.host,
            port: saved.port,
            username: saved.username,
            authKind: saved.authKind,
            ...(secret === undefined ? {} : { secret }),
            ...(savedKey === undefined ? {} : { privateKey: savedKey }),
            ...(saved.privateKeyPath === undefined ? {} : { privateKeyPath: saved.privateKeyPath }),
            ...(saved.hostKeyFingerprint === '' ? {} : { hostKeyFingerprint: saved.hostKeyFingerprint }),
            ...(reconnectHome === undefined ? {} : { dshHome: reconnectHome }),
            runtimePolicy: 'auto',
            ...(requestedModelSource === undefined ? {} : { modelSource: requestedModelSource }),
          }, reportProgress)
        } catch (error) {
          if (error instanceof HostKeyUnknownError) {
            throw new RouteError('host-key-unknown', error.message, 409, { fingerprint: error.fingerprint })
          }
          if (error instanceof HostKeyMismatchError) {
            throw new RouteError('host-key-changed', error.message, 409, { expected: error.expected, actual: error.actual })
          }
          throw error
        }
      }
      const label = optionalString(body, 'label') ?? requireString(body, 'host')
      const privateKeyPath = optionalString(body, 'privateKeyPath')
      const privateKey = privateKeyPath === undefined ? undefined : await readPrivateKeyFile(privateKeyPath)
      const port = typeof body.port === 'number' ? body.port : Number.parseInt(requireString(body, 'port'), 10)
      if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new RouteError('bad-request', '"port" must be between 1 and 65535', 400)
      try {
        return await profiles.connect({
          label,
          host: requireString(body, 'host'),
          port,
          username: requireString(body, 'username'),
          authKind: (optionalString(body, 'authKind') ?? 'agent') as 'password' | 'privateKey' | 'agent',
          ...(optionalString(body, 'secret') === undefined ? {} : { secret: optionalString(body, 'secret') as string }),
          ...(privateKey === undefined ? {} : { privateKey }),
          ...(privateKeyPath === undefined ? {} : { privateKeyPath }),
          ...(optionalString(body, 'hostKeyFingerprint') === undefined ? {} : { hostKeyFingerprint: optionalString(body, 'hostKeyFingerprint') as string }),
          ...(optionalString(body, 'dshHome') === undefined ? {} : { dshHome: optionalString(body, 'dshHome') as string }),
          ...(optionalString(body, 'runtimePolicy') === 'isolated' ? { runtimePolicy: 'isolated' as const } : {}),
          ...(requestedModelSource === undefined ? {} : { modelSource: requestedModelSource }),
        }, reportProgress)
      } catch (error) {
        // The wizard needs the fingerprint to render its confirmation panel;
        // a changed key is terminal and never retried silently.
        if (error instanceof HostKeyUnknownError) {
          throw new RouteError('host-key-unknown', error.message, 409, { fingerprint: error.fingerprint })
        }
        if (error instanceof HostKeyMismatchError) {
          throw new RouteError('host-key-changed', error.message, 409, { expected: error.expected, actual: error.actual })
        }
        throw error
      }
    }
    case 'v1/connect/progress': {
      const id = requireString(body, 'attemptId')
      return { events: CONNECT_PROGRESS.get(id) ?? [] }
    }
    case 'local-llm/read':
    case 'local-llm/save':
    case 'local-llm/probe':
    case 'local-llm/discover':
    case 'local-llm/clear-key': {
      const value = await dispatchLocalLlmApi(store, method, body, () => ctx.get('llm') as NativeLlmRuntime | undefined)
      if (value === undefined) throw new RouteError('not-found', `unknown method ${JSON.stringify(method)}`, 404)
      return value
    }
    case 'forget-target': {
      const id = requireString(body, 'targetId')
      await profiles.stop(id).catch(() => false)
      for (const workspace of store.listWorkspaces(id)) await store.deleteWorkspace(workspace.id).catch(() => false)
      await store.deleteTarget(id)
      return { forgotten: true }
    }
    case 'v1/stop':
      return { stopped: await profiles.stop(requireString(body, 'targetId')) }
    case 'v1/workspaces':
      // The envelope's `value` is the P1 WorkspaceListValue itself (not a
      // second wrapper): the UI adapter reads `value.workspaces`/`value.registry`.
      return await profiles.workspaceList(requireString(body, 'targetId'))
    case 'v1/sessions':
      return await profiles.sessionList(requireString(body, 'targetId'), optionalString(body, 'workspaceId'))
    case 'session/timeline': {
      const sessionId = requireString(body, 'sessionId')
      const sequence = (field: 'afterSeq' | 'beforeSeq'): number | undefined => {
        if (body[field] === undefined) return undefined
        const value = Number(body[field])
        if (!Number.isInteger(value) || value < 0) throw new RouteError('bad-request', `"${field}" must be a non-negative integer`, 400)
        return value
      }
      const afterSeq = sequence('afterSeq')
      const beforeSeq = sequence('beforeSeq')
      if (afterSeq !== undefined && beforeSeq !== undefined) throw new RouteError('bad-request', 'timeline accepts afterSeq or beforeSeq, not both', 400)
      const limit = body.limit === undefined ? undefined : (() => {
        const value = Number(body.limit)
        if (!Number.isInteger(value) || value < 1) throw new RouteError('bad-request', '"limit" must be a positive integer', 400)
        return value
      })()
      return await profiles.sessionTimeline(requireString(body, 'targetId'), {
        sessionId,
        ...(afterSeq === undefined ? {} : { afterSeq }),
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
        ...(limit === undefined ? {} : { limit }),
      })
    }
    case 'session/prompt': {
      const targetId = requireString(body, 'targetId')
      requireString(body, 'sessionId')
      const text = body.text
      if (typeof text !== 'string' || text.trim() === '') throw new RouteError('bad-request', '"text" is required', 400)
      const mode = body.mode
      if (mode !== undefined && mode !== 'followup' && mode !== 'steer') throw new RouteError('bad-request', '"mode" must be followup|steer', 400)
      const { targetId: _targetId, ...params } = body
      return await profiles.sessionPrompt(targetId, params)
    }
    case 'session/cancel': {
      const targetId = requireString(body, 'targetId')
      requireString(body, 'sessionId')
      const { targetId: _targetId, ...params } = body
      return await profiles.sessionCancel(targetId, params)
    }
    case 'session/approval': {
      const targetId = requireString(body, 'targetId')
      requireString(body, 'sessionId')
      requireString(body, 'approvalId')
      approvalDecision(body.decision)
      const { targetId: _targetId, ...params } = body
      return await profiles.sessionApproval(targetId, params)
    }
    case 'session/commands': {
      const targetId = requireString(body, 'targetId')
      requireString(body, 'sessionId')
      const { targetId: _targetId, ...params } = body
      return await profiles.sessionCommands(targetId, params)
    }
    case 'session/command': {
      const targetId = requireString(body, 'targetId')
      requireString(body, 'sessionId')
      requireString(body, 'line')
      const { targetId: _targetId, ...params } = body
      return await profiles.sessionCommand(targetId, params)
    }
    case 'session/modelCatalog': {
      const targetId = requireString(body, 'targetId')
      requireString(body, 'sessionId')
      const { targetId: _targetId, ...params } = body
      return await profiles.sessionModelCatalog(targetId, params)
    }
    case 'session/selectModel': {
      const targetId = requireString(body, 'targetId')
      requireString(body, 'sessionId')
      requireString(body, 'provider')
      requireString(body, 'model')
      const { targetId: _targetId, ...params } = body
      return await profiles.sessionSelectModel(targetId, params)
    }
    case 'session/status': {
      const targetId = requireString(body, 'targetId')
      requireString(body, 'sessionId')
      const { targetId: _targetId, ...params } = body
      return await profiles.sessionStatus(targetId, params)
    }
    case 'state/refresh': {
      const targetId = requireString(body, 'targetId')
      const refreshed = await profiles.refresh(targetId)
      const workspaces = refreshed.workspaces as { registry?: unknown } | undefined
      const connection = profiles.connectionState(targetId)
      const registry = workspaces?.registry as { revision?: unknown; epoch?: unknown } | undefined
      return {
        ...refreshed,
        connection: connection === undefined
          ? undefined
          : {
              ...connection,
              ...(typeof registry?.revision !== 'string'
                ? {}
                : {
                    registry: {
                      revision: registry.revision,
                      ...(typeof registry.epoch === 'string' ? { epoch: registry.epoch } : {}),
                      stale: false,
                    },
                  }),
            },
        registry: workspaces?.registry ?? null,
      }
    }
    case 'registry/refresh':
      return await profiles.registryRefresh(requireString(body, 'targetId'))
    case 'profile/restart-preview':
      return await profiles.restartPreview(requireString(body, 'targetId'))
    case 'profile/restart': {
      return await profiles.restart(requireString(body, 'targetId'), {
        confirmActiveTurns: body.confirmActiveTurns === true,
        previewRevision: requireString(body, 'previewRevision'),
      })
    }
    // ── P3 write actions (forwarded to P1; dev-ui owns the presentation) ───
    case 'workspace/create':
      return await profiles.workspaceCreate(requireString(body, 'targetId'), requireString(body, 'path'), optionalString(body, 'title'))
    case 'workspace/rename':
      return await profiles.workspaceRename(requireString(body, 'targetId'), requireString(body, 'workspaceId'), requireString(body, 'title'))
    case 'workspace/delete':
      return await profiles.workspaceDelete(requireString(body, 'targetId'), requireString(body, 'workspaceId'), body.force === true)
    case 'workspace/reorder':
      return await profiles.workspaceReorder(requireString(body, 'targetId'), requireString(body, 'workspaceId'), optionalString(body, 'beforeWorkspaceId'))
    case 'session/create': {
      const executor = optionalString(body, 'executor')
      if (executor !== undefined && executor !== 'server' && executor !== 'local') throw new RouteError('bad-request', '"executor" must be server|local', 400)
      return await profiles.sessionCreate(requireString(body, 'targetId'), {
        ...(optionalString(body, 'workspaceId') === undefined ? {} : { workspaceId: optionalString(body, 'workspaceId') as string }),
        ...(optionalString(body, 'cwd') === undefined ? {} : { cwd: optionalString(body, 'cwd') as string }),
        ...(optionalString(body, 'sessionId') === undefined ? {} : { sessionId: optionalString(body, 'sessionId') as string }),
        ...(optionalString(body, 'agentPreset') === undefined ? {} : { agentPreset: optionalString(body, 'agentPreset') as string }),
        ...(executor === undefined ? {} : { executor: executor as 'server' | 'local' }),
      })
    }
    case 'session/rename':
      return await profiles.sessionRename(requireString(body, 'targetId'), requireString(body, 'sessionId'), requireString(body, 'title'))
    case 'session/fork':
      return await profiles.sessionFork(requireString(body, 'targetId'), requireString(body, 'sessionId'), {
        ...(typeof body.atSeq === 'number' ? { atSeq: body.atSeq } : {}),
        ...(typeof body.increaseTitle === 'boolean' ? { increaseTitle: body.increaseTitle } : {}),
      })
    case 'session/pin':
      return await profiles.sessionPin(requireString(body, 'targetId'), requireString(body, 'sessionId'), body.pinned === true)
    case 'session/archive':
      return await profiles.sessionArchive(requireString(body, 'targetId'), requireString(body, 'sessionId'), body.archived === true, body.stopActivity === true)
    case 'session/reorder':
      return await profiles.sessionReorder(requireString(body, 'targetId'), requireString(body, 'workspaceId'), requireString(body, 'sessionId'), optionalString(body, 'beforeSessionId'))
    case 'session/open': {
      const executor = optionalString(body, 'executor')
      if (executor !== undefined && executor !== 'server' && executor !== 'local') throw new RouteError('bad-request', '"executor" must be server|local', 400)
      return await profiles.sessionOpen(requireString(body, 'targetId'), {
        sessionId: requireString(body, 'sessionId'),
        ...(optionalString(body, 'workspaceId') === undefined ? {} : { workspaceId: optionalString(body, 'workspaceId') as string }),
        ...(executor === undefined ? {} : { executor: executor as 'server' | 'local' }),
      })
    }
    case 'session/prepare-server':
      return await profiles.sessionPrepareServer(requireString(body, 'targetId'), requireString(body, 'sessionId'))
    case 'mkdir':
      return await profiles.makeDirectory(requireString(body, 'targetId'), requireString(body, 'path'))
    case 'fs/list':
      return await profiles.fsList(requireString(body, 'targetId'), typeof body.path === 'string' ? body.path : '')
    case 'deployment/preview':
      return profiles.deploymentPreview(requireString(body, 'targetId'))
    case 'deployment/apply': {
      const kind = requireString(body, 'kind')
      if (kind !== 'runtime' && kind !== 'plugin') throw new RouteError('bad-request', '"kind" must be runtime|plugin', 400)
      return await profiles.deploymentApply(requireString(body, 'targetId'), {
        kind,
        ...(typeof body.confirm === 'boolean' ? { confirm: body.confirm } : {}),
      })
    }
    case 'mode/preview': {
      const nextMode = requireString(body, 'nextMode')
      if (nextMode !== 'server' && nextMode !== 'local') throw new RouteError('bad-request', '"nextMode" must be server|local', 400)
      return await profiles.modePreview(requireString(body, 'targetId'), nextMode, optionalString(body, 'targetSessionId'))
    }
    case 'mode/apply': {
      const nextMode = requireString(body, 'nextMode')
      if (nextMode !== 'server' && nextMode !== 'local') throw new RouteError('bad-request', '"nextMode" must be server|local', 400)
      // `previewRevision` is opaque and may be the `idle` sentinel; accept the
      // exact string the preview returned (empty is still compared as stale).
      const previewRevision = typeof body.previewRevision === 'string' ? body.previewRevision : requireString(body, 'previewRevision')
      return await profiles.modeApply(requireString(body, 'targetId'), nextMode, {
        cancelActiveTurns: body.cancelActiveTurns === true,
        previewRevision,
        ...(optionalString(body, 'targetSessionId') === undefined ? {} : { targetSessionId: optionalString(body, 'targetSessionId') as string }),
      })
    }
    default:
      throw new RouteError('not-found', `unknown method ${JSON.stringify(method)}`, 404)
  }
}

let storageReady: Promise<void> = Promise.resolve()
let storageFailure = ''
let store: TargetStore
let cachedPluginVersion = ''

export function apply(ctx: Context, config: Config): void {
  void config
  store = new TargetStore(ctx)
  const profiles = new ProfileService({
    ctx,
    store,
    packageRoot: packageRootFrom(import.meta.url),
    pluginVersion: pluginVersion(),
    connector: createSshProfileConnector(),
    cacheDir: join(homedir(), '.dsh', 'remote-assets', 'server-plugin'),
    registerPortalUpgrade: (targetId, proxy) => ctx.webServer.registerUpgrade({
      path: portalMuxPath(targetId),
      handler: (req, socket, head) => { void proxy.handleUpgrade(req, socket, head) },
    }),
  })
  ctx.provide('remoteMux', new RemoteMuxRouter({ get: targetId => profiles.muxFor(targetId) }))
  const sessionRoot = localSessionRoot(ctx)
  const routingFacade: RoutingRemoteService = {
    routeForCwd: cwd => profiles.routeForCwd(cwd) as SessionRoute | undefined,
    locateRemoteSession: async sessionId => await profiles.locateRemoteSession(sessionId) as SessionRoute | undefined,
    sessionRequest: async <T,>(targetId: string, method: string, params: unknown, signal?: AbortSignal): Promise<T> =>
      await profiles.rpc<T>(targetId, method, params, signal),
    stubForWorkspace: workspaceId => profiles.anchorForWorkspace(workspaceId),
    remotePathForWorkspace: workspaceId => profiles.remotePathForWorkspace(workspaceId),
  }
  createRoutingPersistence(ctx, { root: sessionRoot }, routingFacade)
  ctx.logger.debug(`dsh-remote-window: local session root=${sessionRoot}`)
  ctx.on('session/created', (session) => { assertRemoteSessionPreset(session.header) }, { global: true })
  ctx.effect(() => () => { void store.close() }, 'dsh-remote-window: storage')
  ctx.effect(() => registerRoutes(ctx, profiles), 'dsh-remote-window: routes')
  ctx.effect(() => () => { void profiles.dispose() }, 'dsh-remote-window: v1 profiles')

  storageReady = store.open().then(async () => {
    await store.ensureClientId()
    const persistence = ctx.get('sessionPersistence') as { routingMarker?: symbol } | undefined
    if (persistence?.routingMarker !== Symbol.for('dsh-remote-window.routing-persistence')) {
      ctx.logger.error('dsh-remote-window: the `session-persistence-jsonl` row override did not apply; remote sessions would be stored locally (see cordis.patch.yml deviation d13)')
    }
  }).catch((error: unknown) => {
    storageFailure = scrubSecrets(error instanceof Error ? error.message : String(error))
    ctx.logger.error(`dsh-remote-window: startup failed: ${storageFailure}`)
  })
  void storageReady.then(() => {
    ctx.logger.debug(`dsh-remote-window: home=${homedir()} routes=${join(ROUTE_PREFIX, 'api')}`)
  })
}
