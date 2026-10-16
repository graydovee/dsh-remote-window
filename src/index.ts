/**
 * `dsh-remote-workspace` host row.
 *
 * It owns the target store, the per-target agent presets, the provisioning
 * service and the wizard's HTTP surface. Nothing official is patched: the
 * workspace button in the sidebar keeps its behaviour, and the remote-connection
 * button is added as a new occupant of the declared `sidebar.footer.action` list
 * slot (client half, `./client`).
 */
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-host-webserver'
import Schema from '@deepseek-ai/schemastery'
import RoutingSessionPersistence from './session-persistence/routing.ts'
import { listSshAliases, prefillFromResolution, resolveSshAlias } from './ssh-config.ts'
import { TargetStore } from './targets/store.ts'
import { scrubSecrets , type PackagePolicySettings } from './targets/types.ts'
import { RemoteWorkspaces, packageRootFrom, type ConnectRequest, type ProvisionEvent } from './provision/service.ts'

/** Route prefix for the plugin's own API and SSE channel. */
export const ROUTE_PREFIX = '/dsh-remote-workspace'

/** Plugin row name. */
export const name = 'dsh-remote-workspace'

/** Host-plane services this row needs before it can register anything. */
// NO `workspaceRegistry` here: dsh-workspace consumes `sessionPersistence`,
// which this plugin provides (the routing row). Declaring the edge would make
// our activation wait on a service that waits on ours — a start-up deadlock
// observed 2026-10-16 (7 entries pending). The registry is resolved lazily in
// RemoteWorkspaces instead.
export const inject = ['agentPresets', 'storageDomain', 'credentials', 'agents', 'agentDefaultModel', 'webServer']

/** Tunables; every one of them is also settable from `cordis.yml`. */
export interface Config {
  /** Remote profile name to generate. */
  serverProfile: string
  /** Lease offered to remote servers. */
  leaseMs: number
  /** Maximum remote process handles. */
  maxProcesses: number
  /** Whether to register presets for stored targets at startup. */
  restoreTargets: boolean
}

/** Validated configuration. */
export const Config: Schema<Config> = Schema.object({
  serverProfile: Schema.string().default('dsh-remote-server').description('Remote profile name generated on the target host.'),
  leaseMs: Schema.number().default(30_000).description('Remote server lease in milliseconds.'),
  maxProcesses: Schema.number().default(128).description('Maximum remote process handles.'),
  restoreTargets: Schema.boolean().default(true).description('Register presets for stored targets during startup.'),
})

/** JSON request body, bounded like every other plugin route in this app. */
const MAX_BODY_BYTES = 1 << 20

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(payload)
}

/** A refusal the browser can act on. */
class RouteError extends Error {
  constructor(readonly code: string, message: string, readonly status = 500) {
    super(message)
    this.name = 'RouteError'
  }
}

/** Read and parse a bounded JSON body. */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Buffer)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new RouteError('bad-request', 'request body too large', 400)
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new RouteError('bad-request', 'request body must be a JSON object', 400)
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof RouteError) throw error
    throw new RouteError('bad-request', 'request body is not valid JSON', 400)
  }
}

/** Required string field. */
function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== 'string' || value.trim() === '') throw new RouteError('bad-request', `"${field}" is required`, 400)
  return value.trim()
}

/** Optional string field. */
function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new RouteError('bad-request', `"${field}" must be a string`, 400)
  return value.trim() === '' ? undefined : value.trim()
}

/**
 * Local trust fence.
 *
 * The webserver service itself enforces nothing, so a plugin route must repeat
 * the `/api` gateway's DNS-rebinding and cross-site checks (see DSH
 * `packages/client/connection/src/api-request-trust.ts`). This is not
 * authentication: it keeps a hostile page on another origin from driving the
 * plugin's privileged routes through the loopback interface.
 */
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

/** Register the plugin's routes and return a disposer. */
function registerRoutes(ctx: Context, workspaces: RemoteWorkspaces): () => void {
  const disposers: Array<() => void> = []

  disposers.push(ctx.webServer.register({
    kind: 'prefix',
    path: `${ROUTE_PREFIX}/api`,
    handler: (req, res) => { void handleApi(ctx, workspaces, req, res) },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/stream/connect`,
    handler: (req, res) => { handleConnectStream(workspaces, req, res) },
  }))

  return () => { for (const dispose of disposers.reverse()) dispose() }
}

/** Dispatch one API call. */
async function handleApi(ctx: Context, workspaces: RemoteWorkspaces, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (!trustedRequest(ctx, req)) throw new RouteError('forbidden', 'forbidden', 403)
    if (req.method !== 'POST') throw new RouteError('method-error', 'method not allowed', 405)
    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
    const method = pathname.startsWith(`${ROUTE_PREFIX}/api/`) ? pathname.slice(`${ROUTE_PREFIX}/api/`.length) : undefined
    // Note: method names may contain a slash by design (`connect/start`), so a
    // stray-slash guard here would reject a real API call; unknown names are
    // rejected by the dispatcher with the name in the message.
    if (method === undefined || method === '') throw new RouteError('not-found', 'unknown remote workspace method', 404)
    const body = await readJsonBody(req)
    const value = await dispatchApi(ctx, workspaces, method, body)
    writeJson(res, 200, { ok: true, value })
  } catch (error) {
    if (error instanceof RouteError) {
      writeJson(res, error.status, { ok: false, error: { code: error.code, message: scrubSecrets(error.message) } })
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    const code = (error as { code?: string }).code
    writeJson(res, 500, { ok: false, error: { code: typeof code === 'string' ? code : 'internal', message: scrubSecrets(message) } })
  }
}

/** The API surface the browser calls. */
/** This plugin's own package version, read once. */
let cachedPluginVersion = ''
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

/** Set when the storage domain failed to open at startup; /api/state reports it. */
let storageFailure = ''
/** Resolves once the storage domain is open (or failed); every API call awaits it
 *  so a first-frame request can never race the plugin's own startup. */
let storageReady: Promise<void> = Promise.resolve()

async function dispatchApi(
  ctx: Context,
  workspaces: RemoteWorkspaces,
  method: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  await storageReady
  switch (method) {
    case 'state':
      if (storageFailure !== '') {
        throw new RouteError('storage-unavailable', `plugin storage failed to open: ${storageFailure}`, 500)
      }
      return {
        targets: workspaces.listTargets(),
        workspaces: workspaces.listWorkspaces(),
        pluginVersion: pluginVersion(),
        defaultProfile: 'dsh-remote-server',
      }
    case 'ssh-aliases': {
      const { aliases, warnings } = await listSshAliases()
      return { aliases, warnings: warnings.map(scrubSecrets) }
    }
    case 'alias-prefill': {
      const alias = requireString(body, 'alias')
      const { aliases } = await listSshAliases()
      const host = aliases.find(entry => entry.alias.toLowerCase() === alias.toLowerCase())
      const resolution = await resolveSshAlias(alias)
      if (host === undefined && resolution === undefined) throw new RouteError('not-found', `no ssh alias named "${alias}"`, 404)
      if (host === undefined) {
        return {
          alias,
          host: resolution?.hostName ?? alias,
          port: resolution?.port ?? 22,
          ...(resolution?.user === undefined ? {} : { username: resolution.user }),
          ...(resolution?.identityFile === undefined ? {} : { identityFile: resolution.identityFile }),
          source: resolution?.origin ?? 'config-file',
        }
      }
      return prefillFromResolution(host, resolution)
    }
    case 'connect/start': {
      const request: ConnectRequest = {
        label: requireString(body, 'label'),
        host: requireString(body, 'host'),
        port: typeof body.port === 'number' ? body.port : Number.parseInt(requireString(body, 'port'), 10),
        username: requireString(body, 'username'),
        authKind: (optionalString(body, 'authKind') ?? 'agent') as ConnectRequest['authKind'],
        ...(optionalString(body, 'secret') === undefined ? {} : { secret: optionalString(body, 'secret') as string }),
        ...(optionalString(body, 'privateKeyPath') === undefined ? {} : { privateKeyPath: optionalString(body, 'privateKeyPath') as string }),
        ...(optionalString(body, 'sshConfigAlias') === undefined ? {} : { sshConfigAlias: optionalString(body, 'sshConfigAlias') as string }),
        ...(optionalString(body, 'hostKeyFingerprint') === undefined ? {} : { hostKeyFingerprint: optionalString(body, 'hostKeyFingerprint') as string }),
        ...(optionalString(body, 'packageSource') === undefined ? {} : { packageSource: optionalString(body, 'packageSource') as ConnectRequest['packageSource'] }),
        ...(body.remote === undefined || typeof body.remote !== 'object' ? {} : { remote: body.remote as ConnectRequest['remote'] }),
      }
      if (!Number.isInteger(request.port) || request.port < 1 || request.port > 65_535) {
        throw new RouteError('bad-request', '"port" must be between 1 and 65535', 400)
      }
      return { ticket: workspaces.beginConnect(request) }
    }
    case 'hostkey-confirm': {
      const ticket = requireString(body, 'ticket')
      const fingerprint = requireString(body, 'fingerprint')
      return { accepted: workspaces.confirmHostKey(ticket, fingerprint) }
    }
    case 'package-policy-get':
      return { policy: workspaces.getPackagePolicy() }
    case 'package-policy-set': {
      const raw = body.policy
      if (raw === null || typeof raw !== 'object') throw new RouteError('bad-request', '"policy" object is required', 400)
      const policy = raw as { policy?: unknown; mirror?: unknown }
      if (policy.policy !== undefined && !['auto', 'download', 'upload', 'ask'].includes(policy.policy as string)) {
        throw new RouteError('bad-request', '"policy.policy" must be auto|download|upload|ask', 400)
      }
      if (policy.mirror !== undefined && typeof policy.mirror !== 'string') {
        throw new RouteError('bad-request', '"policy.mirror" must be a string', 400)
      }
      const current = workspaces.getPackagePolicy()
      const next = {
        policy: (policy.policy as 'auto' | 'download' | 'upload' | 'ask' | undefined) ?? current.policy,
        mirror: typeof policy.mirror === 'string' ? policy.mirror : current.mirror,
      }
      await workspaces.setPackagePolicy(next)
      return { policy: next }
    }
    case 'list-dir':
      // `path: ''` means "the target's home" everywhere in this plugin, so the
      // field is optional rather than required-nonempty.
      return await workspaces.listDirectory(requireString(body, 'targetId'), typeof body.path === 'string' ? body.path : '')
    case 'mkdir': {
      const path = requireString(body, 'path')
      await workspaces.createDirectory(requireString(body, 'targetId'), path)
      return { path }
    }
    case 'open-workspace': {
      const opened = await workspaces.openWorkspace(
        requireString(body, 'targetId'),
        requireString(body, 'path'),
        optionalString(body, 'title'),
      )
      return { workspace: opened.workspace, sessionId: opened.sessionId }
    }
    case 'open-session': {
      // 换设备续聊: adopt a session that already exists on the remote server.
      const opened = await workspaces.resumeSession(
        requireString(body, 'targetId'),
        requireString(body, 'path'),
        requireString(body, 'sessionId'),
        optionalString(body, 'title'),
      )
      return { workspace: opened.workspace, sessionId: opened.sessionId }
    }
    case 'remote-workspaces':
      // The remote dsh's own workspace registry — the 添加工作区 source.
      return { workspaces: await workspaces.listRemoteWorkspaces(requireString(body, 'targetId')) }
    case 'sessions':
      return {
        sessions: await workspaces.listRemoteSessions(
          requireString(body, 'targetId'),
          requireString(body, 'workspaceId'),
        ),
      }
    case 'forget-target': {
      await workspaces.forgetTarget(requireString(body, 'targetId'))
      return { forgotten: true }
    }
    case 'forget-workspace': {
      const id = requireString(body, 'workspaceId')
      return { forgotten: await workspaces.forgetWorkspace(id) }
    }
    case 'connect': {
      // The connection node's own action: bring the channel up and report the
      // recomputed status. No session, no directory browsing — the tree stays
      // where it is, which is what "先连接才能建会话" looks like in the UI.
      const targetId = requireString(body, 'targetId')
      await workspaces.connectChannel(targetId)
      const target = workspaces.listTargets().find(candidate => candidate.id === targetId)
      if (target === undefined) throw new RouteError('not-found', `unknown remote target "${targetId}"`, 404)
      return { target }
    }
    case 'stop-target':
      return { stopped: await workspaces.stopTarget(requireString(body, 'targetId')) }
    default:
      throw new RouteError('not-found', `unknown remote workspace method "${method}"`, 404)
  }
}

/** Server-sent events for one connection attempt. */
function handleConnectStream(workspaces: RemoteWorkspaces, req: IncomingMessage, res: ServerResponse): void {
  const ticketId = new URL(req.url ?? '/', 'http://dsh.internal').searchParams.get('ticket')
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    res.end()
    return
  }
  if (ticketId === null || ticketId === '') {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: { code: 'bad-request', message: 'ticket is required' } }))
    return
  }
  const ticket = workspaces.ticket(ticketId)
  if (ticket === undefined) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: { code: 'not-found', message: 'the connection attempt expired' } }))
    return
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  res.write(': connected\n\n')
  const send = (event: unknown): void => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  for (const event of ticket.events) send(event)
  const keepAlive = setInterval(() => { if (!res.writableEnded) res.write(': keep-alive\n\n') }, 15_000)
  keepAlive.unref()
  let finished = false
  const finish = (): void => {
    if (finished) return
    finished = true
    clearInterval(keepAlive)
    if (!res.writableEnded) res.end()
  }
  res.on('close', () => { finish() })
  void workspaces.runConnect(ticketId, (event: ProvisionEvent) => {
    send(event)
  }).then(
    (target) => { send({ type: 'done', target }); finish() },
    (error: unknown) => {
      const code = (error as { code?: string }).code
      send({
        type: 'error',
        code: typeof code === 'string' ? code : 'connect-failed',
        message: scrubSecrets(error instanceof Error ? error.message : String(error)),
      })
      finish()
    },
  ).finally(() => {
    workspaces.releaseTicket(ticketId)
  })
}

/**
 * Wire the plugin.
 * @param ctx - host context with `webServer`, storage and preset registry.
 * @param config - tunables.
 */
export function apply(ctx: Context, config: Config): void {
  const store = new TargetStore(ctx)
  const workspaces = new RemoteWorkspaces(ctx, store, {
    packageRoot: packageRootFrom(import.meta.url),
    leaseMs: config.leaseMs,
    maxProcesses: config.maxProcesses,
  })
  ctx.provide('remoteWorkspaces', {
    connectChannel: (targetId: string, signal?: AbortSignal) => workspaces.connectChannel(targetId, signal),
    expectedDigest: (targetId: string) => workspaces.expectedDigest(targetId),
    getPackagePolicy: () => workspaces.getPackagePolicy(),
    pathAliases: (targetId: string) => workspaces.pathAliases(targetId),
    setPackagePolicy: (settings: PackagePolicySettings) => workspaces.setPackagePolicy(settings),
    routeForCwd: (cwd: string | undefined) => workspaces.routeForCwd(cwd),
    stubForWorkspace: (workspaceId: string) => workspaces.stubForWorkspace(workspaceId),
    locateRemoteSession: (sessionId: string) => workspaces.locateRemoteSession(sessionId),
    sessionRequest: <T,>(targetId: string, method: string, params: unknown, signal?: AbortSignal) =>
      workspaces.sessionRequest<T>(targetId, method, params, signal),
  })
  // The routing persistence (deviation d13): the official JSONL row is
  // disabled by this bundle's patch, freeing the service name; providing here
  // — in the root tree every consumer (agent loop, session controller,
  // workspace registry) resolves against — is guaranteed.
  new RoutingSessionPersistence(ctx, { root: join(homedir(), 'sessions') })
  ctx.effect(() => () => { void workspaces.dispose() }, 'dsh-remote-workspace: provisioning')
  ctx.effect(() => () => { void store.close() }, 'dsh-remote-workspace: storage')
  ctx.effect(() => registerRoutes(ctx, workspaces), 'dsh-remote-workspace: routes')

  // /api/state must never wait on preset restoration: ensureWorlds may open
  // SSH channels for every stored target, which can take tens of seconds.
  storageReady = store.open().then(async () => {
    // Self-check for the JSONL row override (cordis.patch.yml, deviation d13):
    // if a future dsh renames or re-orders the base row, the overlay silently
    // stops applying and remote sessions would land in the local store —
    // detectable, so detect it. Chained on the SAME open promise: calling
    // store.open() twice fails the domain with 'already open'.
    const persistence = ctx.get('sessionPersistence') as { routingMarker?: symbol } | undefined
    if (persistence?.routingMarker !== Symbol.for('dsh-remote-workspace.routing-persistence')) {
      ctx.logger.error('dsh-remote-workspace: the `session-persistence-jsonl` row override did not apply; remote sessions would be stored locally (see cordis.patch.yml deviation d13)')
    }
  }).catch((error: unknown) => {
    storageFailure = scrubSecrets(error instanceof Error ? error.message : String(error))
    ctx.logger.error(`dsh-remote-workspace: startup failed: ${storageFailure}`)
  })
  void storageReady.then(() => {
    if (config.restoreTargets) return workspaces.ensureWorlds()
  }).catch((error: unknown) => {
    ctx.logger.error(`dsh-remote-workspace: target restore failed: ${scrubSecrets(error instanceof Error ? error.message : String(error))}`)
  })

  // Diagnostics for the local machine: the wizard reads these through the API,
  // and a failing path here is reported instead of guessed at.
  ctx.logger.debug(`dsh-remote-workspace: home=${homedir()} routes=${join(ROUTE_PREFIX, 'api')}`)
}
