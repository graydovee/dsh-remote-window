/**
 * v1 profile service: connect one SSH host, install/start its per-client profile
 * server, handshake the server plugin and expose the P1/portal surfaces the host
 * routes need.
 *
 * This is the vertical slice behind `v1/connect` and `/api/state`:
 *
 *   SSH + host key → read-only scan → global dsh (verified runtime)
 *   → offline server-plugin install (+ 4 profile files) → detached profile server
 *   → token → official cookie (host memory only) → P1 handshake
 *   → portal proxy + P1 client for workspace/session reads.
 *
 * The SSH connector is injectable (`ProfileConnector`) so host API integration
 * tests can drive the whole service with a fake remote; production uses
 * {@link createSshProfileConnector} over ssh2.
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { execRemote, connectSsh, openSftp, uploadRemoteFile, type SshAuth } from '../ssh/connect.ts'
import { HostKeyUnknownError, lookupKnownHost } from '../ssh/hostkey.ts'
import { shellQuote } from './profile.ts'
import { SshForwarder, sendForwardedHttp, type ForwardStream } from '../ssh/forward.ts'
import { scrubSecrets, type PublicTarget, type RemoteTargetRecord } from '../targets/types.ts'
import { TargetStore } from '../targets/store.ts'
import { generateInstanceId } from '../targets/client-id.ts'
import { isCompatibleDsh, DSH_VERIFIED_RUNTIMES } from './version-range.ts'
import { describeLocalPackage, platformArch, sha256File } from './assets.ts'
import { parseDshScanOutput, scanDshScript, type DshScan } from './dsh-scan.ts'
import { probeFactsFrom } from './platform.ts'
import { buildRuntimeArtifact } from './runtime-artifact.ts'
import {
  installIsolatedRuntime,
  planRuntime,
  resolveRuntimeArtifact,
  readRuntimeMarker,
  runtimeAddonProbeCommand,
  runtimeArtifactName,
  runtimePathAssignment,
  runtimePathPrefixes,
  runtimePaths,
  RuntimeError,
  type RuntimePaths,
} from './runtime.ts'
import {
  installProfilePeerPackage,
  installServerPlugin,
  decideServerPluginInstall,
  readServerPluginMarker,
  resolveServerPluginTarball,
  verifyServerPluginTarball,
  SERVER_PLUGIN_PROTOCOL,
  type ServerPluginTarball,
} from './server-plugin.ts'
import {
  PROFILE_STARTUP_TIMEOUT_MS,
  profilePaths,
  startProfileServer,
  stopProfileServer,
  waitForProfileStopped,
  type ProfilePaths,
  type ProfileRemote,
  type ProfileServerHandle,
} from './profile-lifecycle.ts'
import { TunnelPluginTransport } from '../remote/tunnel-transport.ts'
import { RemotePluginClient, type PluginHandshakeResponse } from '../remote/plugin-client.ts'
import { PortalProxy, portalMuxPath, portalPath, type PortalUpstream } from '../portal/proxy.ts'
import { createHostLocalRuntime, type HostLocalRuntime } from '../session/local-runtime.ts'
import { WsMuxBackend } from '../remote/ws-mux.ts'
import type { RemoteMuxBackend } from '../remote/mux-client.ts'
import { remotePresetDefinition, remotePresetId } from '../preset/world.ts'
import { LocalSessionError } from '../session/local-session.ts'
import { applyModeSwitch } from '../session/mode-apply.ts'

/** Read a local private-key file (expanding `~/`) for the SSH connector. */
export async function readPrivateKeyFile(path: string): Promise<Buffer> {
  return await readFile(path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : resolve(path))
}

/** The SSH connection facts a connect request carries. */
export interface ConnectProfileRequest {
  readonly label: string
  readonly host: string
  readonly port: number
  readonly username: string
  readonly authKind: 'password' | 'privateKey' | 'agent'
  readonly secret?: string
  readonly privateKey?: Buffer
  readonly privateKeyPath?: string
  readonly hostKeyFingerprint?: string
  /** Optional explicit server DSH_HOME; defaults to `~/.dsh` from the scan. */
  readonly dshHome?: string
  /** `isolated` refuses the host's shared global dsh and installs a per-client runtime. */
  readonly runtimePolicy?: 'auto' | 'isolated'
}

/** One visible phase of a connect attempt (the wizard's progress rows). */
export type ConnectProgressStep = 'connect' | 'probe' | 'runtime' | 'upload' | 'start'

/** One progress event emitted while a connect attempt runs. */
export interface ConnectProgressEvent {
  readonly step: ConnectProgressStep
  readonly status: 'running' | 'ok' | 'failed' | 'skipped'
  readonly message: string
  readonly at: string
}

/** Optional listener; the route buffers these for the polling UI. */
export type ConnectProgressListener = (event: ConnectProgressEvent) => void

/** One reachable SSH target plus the seams the service needs. */
export interface ProfileConnection {
  readonly remote: ProfileRemote
  readonly forwarder: SshForwarder
  /** Host key actually used (the caller pins it on success). */
  readonly fingerprint: string
  close(): Promise<void>
  /** Called when the underlying SSH connection closes unexpectedly. */
  onClose?(listener: () => void): () => void
}

/** Injectable SSH connector (production ssh2; tests use a fake). */
export interface ProfileConnector {
  connect(request: ConnectProfileRequest): Promise<ProfileConnection>
}

/** Deployment/confirmation facts the P3 UI needs for one target. */
export interface DeploymentStateV1 {
  readonly runtime: {
    readonly kind: 'isolated' | 'global'
    readonly installedVersion?: string
    readonly expectedVersion: string
    readonly action: 'reuse' | 'install' | 'upgrade'
    readonly requiresConfirmation: boolean
    readonly mode: 'auto' | 'confirm'
    readonly reason?: string
  }
  readonly plugin: {
    readonly profile: string
    readonly dedicated: boolean
    readonly installedVersion?: string
    readonly expectedVersion: string
    readonly action: 'reuse' | 'install' | 'upgrade'
    /** Dedicated profiles install/restart automatically; other profiles confirm. */
    readonly requiresConfirmation: boolean
  }
}

/** What the host `/api/state` needs for one target. */
export interface ConnectionStateV1 {
  readonly targetId: string
  readonly phase: 'connecting' | 'ready' | 'degraded' | 'stopped' | 'failed'
  readonly profile: { readonly name: string; readonly port?: number; readonly pid?: number; readonly startedAt?: string } | null
  readonly runtime: { readonly kind: 'isolated' | 'global'; readonly version?: string; readonly dshVersion?: string; readonly launcher?: string } | null
  readonly plugin: { readonly version?: string; readonly protocol?: number; readonly installed: boolean } | null
  readonly capabilities?: PluginHandshakeResponse['capabilities']
  readonly embed?: { readonly storagePrefix: string; readonly mode: 'reload' | 'client-half'; readonly parentOrigin?: string }
  readonly portal: { readonly base: string; readonly muxPath: string }
  readonly registry?: { readonly revision?: string; readonly epoch?: string; readonly stale?: boolean }
  readonly deployment?: DeploymentStateV1
  readonly error?: { readonly code: string; readonly message: string; readonly details?: unknown }
}

/** The deployment decision the probe step makes for one connect attempt. */
type SetupAction = 'reuse' | 'install' | 'upgrade'

interface RemoteSetupInspection {
  readonly runtime: {
    readonly kind: 'isolated' | 'global'
    readonly action: SetupAction
    readonly version: string
    readonly installedVersion?: string
    readonly nodeVersion?: string
    readonly detail: string
  }
  readonly plugin: {
    readonly action: SetupAction
    readonly version: string
    readonly installedVersion?: string
    readonly detail: string
  }
  /** One log/progress line, e.g. `运行时 跳过：…；server 插件 部署：…`. */
  readonly summary: string
}

/** The runtime facts resolved immediately before a profile start. */
interface ResolvedRuntime {
  readonly kind: 'isolated' | 'global'
  readonly action: SetupAction
  readonly launcher: string
  readonly pathPrefixes: readonly string[]
  readonly dshVersion: string
  readonly runtimeDir: string
}

/** Options for {@link ProfileService}. */
export interface ProfileServiceOptions {
  /** Host context carrying agents/presets/persistence (local mode). */
  readonly ctx?: Context
  readonly store: TargetStore
  readonly packageRoot: string
  readonly pluginVersion: string
  readonly connector: ProfileConnector
  /** Host-side cache/staging directory for downloaded tarballs. */
  readonly cacheDir: string
  /** Register the per-target WebSocket upgrade route; returns its disposer. */
  readonly registerPortalUpgrade?: (targetId: string, proxy: PortalProxy) => () => void
  readonly onPortalClosed?: (targetId: string) => void
  readonly now?: () => Date
}

/** One live profile server + its in-memory-only secrets. */
interface LiveProfile {
  readonly targetId: string
  readonly connection: ProfileConnection
  readonly paths: ProfilePaths
  readonly launcher: string
  readonly pathPrefixes: readonly string[]
  readonly dshVersion: string
  readonly runtimeKind: 'isolated' | 'global'
  readonly runtimeDir: string
  readonly pluginVersion: string
  readonly handle: ProfileServerHandle
  readonly cookie: string
  readonly transport: TunnelPluginTransport
  readonly plugin: RemotePluginClient
  readonly portal: PortalProxy
  readonly disposeUpgrade: () => void
  readonly startedAt: string
}

/** Default SSH connector: ssh2 + SFTP uploads, one connection per target. */
export function createSshProfileConnector(): ProfileConnector {
  return {
    async connect(request: ConnectProfileRequest): Promise<ProfileConnection> {
      const privateKey = request.privateKey ?? (
        request.privateKeyPath === undefined
          ? undefined
          : await readFile(request.privateKeyPath.startsWith('~/') ? resolve(homedir(), request.privateKeyPath.slice(2)) : resolve(request.privateKeyPath))
      )
      const auth: SshAuth = request.authKind === 'password'
        ? { kind: 'password', password: request.secret ?? '' }
        : request.authKind === 'privateKey'
          ? { kind: 'privateKey', privateKey: privateKey ?? Buffer.alloc(0), ...(request.secret === undefined ? {} : { passphrase: request.secret }) }
          : { kind: 'agent' }
      // Respect the user's existing OpenSSH trust store: a host already in
      // known_hosts must not trigger a second explicit confirmation here.
      const known = request.hostKeyFingerprint === undefined || request.hostKeyFingerprint === ''
        ? await lookupKnownHost(request.host, request.port)
        : request.hostKeyFingerprint
      const client = await connectSsh({
        host: request.host,
        port: request.port,
        username: request.username,
        auth,
        ...(known === undefined || known === '' ? {} : { hostKeyFingerprint: known }),
      })
      let sftp: Awaited<ReturnType<typeof openSftp>> | undefined
      let closing = false
      const closeListeners = new Set<() => void>()
      client.once('close', () => {
        if (closing) return
        for (const listener of closeListeners) {
          try { listener() } catch {}
        }
      })
      const remote: ProfileRemote = {
        exec: async (body, options) => await execRemote(client, body, {
          maxBytes: options?.maxBytes ?? 1024 * 1024,
          timeoutMs: options?.timeoutMs ?? 60_000,
        }).then(result => ({ code: result.code, stdout: result.stdout, stderr: result.stderr })),
        writeFile: async (path, content) => {
          if (sftp === undefined) sftp = await openSftp(client)
          await uploadRemoteFile(sftp, { path, content })
        },
      }
      return {
        remote,
        forwarder: new SshForwarder(client),
        fingerprint: known ?? '',
        close: async () => {
          closing = true
          try { sftp?.end() } catch {}
          client.end()
        },
        onClose: (listener: () => void) => {
          if (closing) return () => {}
          closeListeners.add(listener)
          return () => { closeListeners.delete(listener) }
        },
      }
    },
  }
}

/** The v1 profile lifecycle and P1/portal state for every target. */
export class ProfileService {
  private readonly live = new Map<string, LiveProfile>()
  private readonly failures = new Map<string, { code: string; message: string; details?: unknown }>()
  /** workspaceId → server path, learned from P1 lists (local-mode header anchoring). */
  private readonly workspacePaths = new Map<string, string>()
  /** One local-mode runtime per target (owned handles + private anchors). */
  private readonly localRuntimes = new Map<string, HostLocalRuntime>()
  private readonly muxes = new Map<string, WsMuxBackend>()
  private readonly reconnectClose = new Map<string, () => void>()
  private readonly reconnecting = new Set<string>()
  /** Remote execution-world presets registered for live v1 targets. */
  private readonly presetDisposers = new Map<string, () => Promise<void> | void>()
  /** Last registry revision this host read for each target (state badge). */
  private readonly registryRevisions = new Map<string, { revision: string; epoch?: string }>()
  /** Shared view state read from workspace/list, merged into session rows. */
  private readonly registryViewState = new Map<string, { pinned: readonly string[]; archived: readonly string[] }>()
  private readonly instanceId = generateInstanceId()
  /** Serializes connects: one profile server may be started at a time. */
  private connectChain: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: ProfileServiceOptions) {}

  /** The installation's stable clientId (also used by the old state route). */
  async clientId(): Promise<string> {
    return await this.options.store.ensureClientId()
  }

  /** Anchor paths of one target mapped to their server-real workspace paths. */
  private pathAliasesFor(targetId: string): { stub: string; remote: string }[] {
    const runtime = this.localRuntimes.get(targetId)
    if (runtime === undefined) return []
    const aliases: { stub: string; remote: string }[] = []
    for (const entry of runtime.anchors.entries()) {
      const remote = this.remotePathForWorkspace(entry.workspaceId)
      if (remote !== undefined && remote !== '' && entry.path !== remote) aliases.push({ stub: entry.path, remote })
    }
    return aliases
  }

  /** One target's execution-world mux, created lazily from its live profile. */
  muxFor(targetId: string): RemoteMuxBackend | undefined {
    const live = this.live.get(targetId)
    if (live === undefined) return undefined
    const existing = this.muxes.get(targetId)
    if (existing !== undefined) return existing
    const mux = new WsMuxBackend({
      forwarder: live.connection.forwarder,
      port: live.handle.port,
      cookie: live.cookie,
      clientId: this.options.store.clientId() ?? '',
      instanceId: this.instanceId,
      aliases: () => this.pathAliasesFor(targetId),
    })
    this.muxes.set(targetId, mux)
    return mux
  }

  /** Drop one target's mux (profile restart/disconnect invalidates it). */
  private async closeMux(targetId: string): Promise<void> {
    const mux = this.muxes.get(targetId)
    if (mux === undefined) return
    this.muxes.delete(targetId)
    await mux.close().catch(() => undefined)
  }

  /** One target's portal proxy, when its profile is live. */
  portalFor(targetId: string): PortalProxy | undefined {
    return this.live.get(targetId)?.portal
  }

  /** One target's P1 client, when connected. */
  pluginFor(targetId: string): RemotePluginClient | undefined {
    return this.live.get(targetId)?.plugin
  }

  /** All live connection states, keyed by target id. */
  connections(): Record<string, ConnectionStateV1> {
    const out: Record<string, ConnectionStateV1> = {}
    for (const target of this.options.store.listTargets()) {
      const state = this.connectionState(target.id)
      if (state !== undefined) out[target.id] = state
    }
    for (const [targetId, error] of this.failures) {
      if (out[targetId] !== undefined) continue
      out[targetId] = this.failedState(targetId, error)
    }
    return out
  }

  /** Describe one target's connection/profile state (or undefined when unknown). */
  connectionState(targetId: string): ConnectionStateV1 | undefined {
    const live = this.live.get(targetId)
    if (live !== undefined) return this.readyState(live)
    const target = this.options.store.target(targetId)
    if (target === undefined) return undefined
    if (this.reconnecting.has(targetId)) {
      return {
        targetId,
        phase: 'connecting',
        profile: null,
        runtime: null,
        plugin: null,
        portal: { base: portalPath(targetId), muxPath: portalMuxPath(targetId) },
        error: { code: 'ssh-reconnecting', message: 'the SSH connection was lost; reconnecting (up to 5 attempts)' },
      }
    }
    return {
      targetId,
      phase: 'stopped',
      profile: target.profileName === undefined ? null : { name: target.profileName },
      runtime: target.runtimeKind === undefined ? null : {
        kind: target.runtimeKind,
        ...(target.pluginVersion === undefined ? {} : { version: target.pluginVersion }),
        ...(target.serverDshVersion === undefined ? {} : { dshVersion: target.serverDshVersion }),
        ...(target.runtimeDir === undefined ? {} : { launcher: target.runtimeDir }),
      },
      plugin: { installed: target.pluginVersion !== undefined, ...(target.pluginVersion === undefined ? {} : { version: target.pluginVersion }) },
      portal: { base: portalPath(targetId), muxPath: portalMuxPath(targetId) },
      ...(this.deploymentState(targetId) === undefined ? {} : { deployment: this.deploymentState(targetId) }),
      ...(target.lastError === undefined ? {} : { error: { code: 'last-error', message: target.lastError } }),
    }
  }

  /** Deployment status for the UI (no claim that a confirmation was obtained). */
  deploymentState(targetId: string): DeploymentStateV1 | undefined {
    const record = this.options.store.target(targetId)
    if (record === undefined) return undefined
    const live = this.live.get(targetId)
    const expectedRuntime = DSH_VERIFIED_RUNTIMES[0] ?? '0.2.1-rc.3'
    const runtimeKind = live?.runtimeKind ?? record.runtimeKind ?? 'global'
    const installedRuntime = live?.dshVersion ?? record.serverDshVersion
    const runtimeAction = installedRuntime === undefined ? 'install' : installedRuntime === expectedRuntime ? 'reuse' : 'upgrade'
    const expectedPlugin = this.options.pluginVersion
    const installedPlugin = live?.pluginVersion ?? record.pluginVersion
    const pluginAction = installedPlugin === undefined ? 'install' : installedPlugin === expectedPlugin ? 'reuse' : 'upgrade'
    const dedicated = record.profileName === undefined || record.profileName === this.profileForClient(record.clientId)
    return {
      runtime: {
        kind: runtimeKind,
        ...(installedRuntime === undefined ? {} : { installedVersion: installedRuntime }),
        expectedVersion: expectedRuntime,
        action: runtimeAction,
        requiresConfirmation: runtimeKind === 'global' && runtimeAction !== 'reuse',
        mode: runtimeKind === 'global' ? 'confirm' : 'auto',
        reason: runtimeKind === 'global' ? 'changing the shared global DSH affects every profile on the server' : 'per-client isolated runtime installs/upgrades automatically',
      },
      plugin: {
        profile: record.profileName ?? '',
        dedicated,
        ...(installedPlugin === undefined ? {} : { installedVersion: installedPlugin }),
        expectedVersion: expectedPlugin,
        action: pluginAction,
        requiresConfirmation: !dedicated,
      },
    }
  }

  private profileForClient(clientId: string | undefined): string {
    return clientId === undefined ? '' : `graydovee-remote-workspace-${clientId}`
  }

  private readyState(live: LiveProfile): ConnectionStateV1 {
    const capabilities = live.plugin.capabilities
    return {
      targetId: live.targetId,
      phase: 'ready',
      profile: { name: live.paths.profile, port: live.handle.port, pid: live.handle.pid, startedAt: live.startedAt },
      runtime: { kind: live.runtimeKind, dshVersion: live.dshVersion, launcher: live.launcher, ...(live.runtimeDir === '' ? {} : { version: live.pluginVersion }) },
      plugin: {
        installed: true,
        version: live.pluginVersion,
        protocol: 1,
      },
      ...(capabilities === undefined ? {} : { capabilities }),
      ...(capabilities?.embed === undefined ? {} : { embed: { storagePrefix: capabilities.embed.storagePrefix, mode: capabilities.embed.mode } }),
      portal: { base: portalPath(live.targetId), muxPath: portalMuxPath(live.targetId) },
      ...(this.deploymentState(live.targetId) === undefined ? {} : { deployment: this.deploymentState(live.targetId) }),
      ...(this.registryRevisions.get(live.targetId) === undefined
        ? {}
        : { registry: { ...this.registryRevisions.get(live.targetId) as { revision: string; epoch?: string }, stale: false } }),
    }
  }

  private failedState(targetId: string, error: { code: string; message: string; details?: unknown }): ConnectionStateV1 {
    return {
      targetId,
      phase: 'failed',
      profile: null,
      runtime: null,
      plugin: null,
      portal: { base: portalPath(targetId), muxPath: portalMuxPath(targetId) },
      error,
    }
  }

  /**
   * Connect + install + start + handshake one target.
   *
   * Nothing becomes visible in `/api/state` until the handshake succeeds; a
   * failure stops the started process/channel and records a scrubbed error.
   */
  async connect(request: ConnectProfileRequest, onProgress?: ConnectProgressListener): Promise<{ target: PublicTarget; state: ConnectionStateV1 }> {
    const run = this.connectChain.then(
      async () => await this.connectOnce(request, onProgress),
      async () => await this.connectOnce(request, onProgress),
    )
    this.connectChain = run.then(() => undefined, () => undefined)
    return await run
  }

  private async connectOnce(request: ConnectProfileRequest, onProgress?: ConnectProgressListener): Promise<{ target: PublicTarget; state: ConnectionStateV1 }> {
    const clientId = await this.options.store.ensureClientId()
    let connection: ProfileConnection | undefined
    let handle: ProfileServerHandle | undefined
    let transport: TunnelPluginTransport | undefined
    // Reconnect by label keeps the target id stable, so the live-map key, the
    // persisted record and the portal URL all name the same connection.
    const existing = this.options.store.listTargets().find(target => target.label.toLowerCase() === request.label.toLowerCase())
    const targetId = existing?.id ?? `rt-${randomUUID().slice(0, 8)}`
    let activeStep: ConnectProgressStep = 'connect'
    const emit = (step: ConnectProgressStep, status: ConnectProgressEvent['status'], message: string): void => {
      try { onProgress?.({ step, status, message, at: new Date().toISOString() }) } catch {}
    }
    const begin = (step: ConnectProgressStep, message: string): void => { activeStep = step; emit(step, 'running', message) }
    // A retry/reconnect for the same label must not leave the previous profile
    // server running: one target owns at most one SSH/profile process.
    if (this.live.has(targetId)) await this.stop(targetId).catch(() => false)
    // A reconnect usually carries no secret/fingerprint: reuse the pinned key
    // and the stored credential so the user is not asked to trust the host again.
    const storedSecret = existing === undefined || request.secret !== undefined ? undefined : await this.options.store.secretOf(existing)
    const effectiveRequest: ConnectProfileRequest = {
      ...request,
      ...(request.hostKeyFingerprint !== undefined || existing?.hostKeyFingerprint === undefined
        ? {}
        : { hostKeyFingerprint: existing.hostKeyFingerprint }),
      ...(request.privateKeyPath !== undefined || existing?.privateKeyPath === undefined
        ? {}
        : { privateKeyPath: existing.privateKeyPath }),
      ...(request.secret !== undefined || storedSecret === undefined ? {} : { secret: storedSecret }),
    }
    try {
      begin('connect', `正在建立 SSH 连接 ${effectiveRequest.username}@${effectiveRequest.host}:${effectiveRequest.port}…`)
      connection = await this.options.connector.connect(effectiveRequest)
      emit('connect', 'ok', `SSH 已连接 ${effectiveRequest.username}@${effectiveRequest.host}`)
      begin('probe', '正在探测远端环境…')
      const scan = await this.scan(connection.remote)
      const dshHome = request.dshHome ?? scan.dshHome ?? `${scan.home ?? ''}/.dsh`
      const paths = profilePaths(dshHome, clientId)
      const tarball = await this.resolvePluginTarball()
      const setup = await this.inspectRemoteSetup(connection, scan, dshHome, clientId, request, tarball)
      emit('probe', 'ok', `远端环境 ${scan.platform ?? ''} ${scan.machine ?? ''}；${setup.summary}`.trim())
      // One profile directory has exactly one profile server. Stop any survivor
      // from a previous attempt **before** touching files/starting a new one,
      // and wait until its pid is really gone so the next start cannot race it.
      await stopProfileServer(connection.remote, paths).catch(() => false)
      await waitForProfileStopped(connection.remote, paths).catch(() => false)
      let runtime: ResolvedRuntime
      if (setup.runtime.action === 'reuse') {
        activeStep = 'runtime'
        runtime = await this.resolveRuntime(connection, scan, dshHome, clientId, request, message => {
          emit('runtime', 'running', message)
        })
        if (runtime.action === 'reuse') {
          emit('runtime', 'skipped', setup.runtime.detail)
        } else {
          emit('runtime', 'ok', runtime.kind === 'global' ? '复用 server 全局 DSH' : runtime.action === 'upgrade' ? '隔离 runtime 已更新' : '隔离 runtime 已部署')
        }
      } else {
        begin('runtime', setup.runtime.action === 'install' ? '正在部署 DSH 运行时…' : '正在更新 DSH 运行时…')
        runtime = await this.resolveRuntime(connection, scan, dshHome, clientId, request, message => {
          emit('runtime', 'running', message)
        })
        emit('runtime', 'ok', runtime.kind === 'global' ? '复用 server 全局 DSH' : runtime.action === 'upgrade' ? '隔离 runtime 已更新' : '隔离 runtime 已部署')
      }
      activeStep = 'upload'
      const pluginInstall = await installServerPlugin({ remote: connection.remote, paths, tarball, dshVersion: runtime.dshVersion })
      // The server plugin imports @deepseek-ai/schemastery (a peer). A global
      // DSH installed via npm is not an ancestor of the profile's node_modules,
      // so provide the peer offline from this client's own resolution.
      if (pluginInstall.installed) {
        // The peer copy is part of installing the profile; a reused plugin
        // already has it. Skipping the copy is what makes the probe's "skip"
        // decision a real no-op rather than a silent second install.
        const schemastery = this.resolvePeerPackage('@deepseek-ai/schemastery')
        if (schemastery !== undefined) {
          await installProfilePeerPackage(connection.remote, paths, { name: '@deepseek-ai/schemastery', packageDir: schemastery })
        } else {
          // Newer server tarballs inline/drop schemastery; only the older ones
          // need this peer copy. Do not fail the deploy when it cannot be found —
          // the handshake/start error will name the missing module if it is needed.
          console.warn('[dsh-remote-workspace] @deepseek-ai/schemastery is not resolvable on the client; skipping the offline peer copy')
        }
        emit('upload', 'ok', setup.plugin.action === 'upgrade' ? 'server 插件已更新' : 'server 插件已安装')
      } else {
        emit('upload', 'skipped', setup.plugin.detail)
      }
      begin('start', `正在启动 profile ${paths.profile}…`)
      handle = await startProfileServer(connection.remote, paths, {
        launcher: runtime.launcher,
        pathPrefixes: runtime.pathPrefixes,
        timeoutMs: PROFILE_STARTUP_TIMEOUT_MS,
        probe: async startup => await this.probeRoot(connection as ProfileConnection, startup.port, startup.token),
      })
      const cookie = await this.exchangeToken(connection, handle.port, handle.token)
      transport = new TunnelPluginTransport(connection.forwarder, handle.port)
      const plugin = new RemotePluginClient({
        transport,
        clientId,
        instanceId: this.instanceId,
        pluginVersion: this.options.pluginVersion,
        cookie,
      })
      const handshake = await plugin.handshake({ profile: paths.profile })
      emit('start', 'ok', `profile ${paths.profile} 已就绪，SSH 隧道已建立`)
      if (typeof handshake.registry?.revision === 'string' && handshake.registry.revision !== '') {
        this.registryRevisions.set(targetId, {
          revision: handshake.registry.revision,
          ...(typeof handshake.registry.epoch === 'string' ? { epoch: handshake.registry.epoch } : {}),
        })
      }
      const portal = new PortalProxy(targetId, this.portalUpstream(connection, handle.port), cookie)
      const disposeUpgrade = this.options.registerPortalUpgrade?.(targetId, portal) ?? (() => {})
      const startedAt = (this.options.now?.() ?? new Date()).toISOString()
      const target = await this.persistTarget(effectiveRequest, {
        targetId,
        clientId,
        profileName: paths.profile,
        profilePort: handle.port,
        pluginVersion: handshake.pluginVersion,
        launcher: runtime.launcher,
        runtimeDir: runtime.runtimeDir,
        runtimeKind: runtime.kind,
        serverDshVersion: runtime.dshVersion,
        dshHome,
      })
      await this.registerTargetPreset(target)
      const live: LiveProfile = {
        targetId,
        connection,
        paths,
        launcher: runtime.launcher,
        pathPrefixes: runtime.pathPrefixes,
        dshVersion: handshake.dshVersion,
        runtimeKind: runtime.kind,
        runtimeDir: runtime.runtimeDir,
        pluginVersion: handshake.pluginVersion,
        handle,
        cookie,
        transport,
        plugin,
        portal,
        disposeUpgrade,
        startedAt,
      }
      this.live.set(targetId, live)
      this.failures.delete(targetId)
      const detachClose = connection.onClose?.(() => { void this.reconnectLost(targetId) })
      if (detachClose !== undefined) this.reconnectClose.set(targetId, detachClose)
      return { target, state: this.readyState(live) }
    } catch (error) {
      if (error instanceof HostKeyUnknownError) {
        emit('connect', 'running', '等待确认主机指纹')
      } else {
        emit(activeStep, 'failed', scrubSecrets(error instanceof Error ? error.message : String(error)))
      }
      // No phantom failure row: a connect that never succeeded has no target id
      // in the store, and `/api/state` must not surface a connection the user
      // cannot act on. The error itself goes back through the route envelope.
      await transport?.dispose()
      if (handle !== undefined && connection !== undefined) {
        await stopProfileServer(connection.remote, handle.paths).catch(() => false)
        await waitForProfileStopped(connection.remote, handle.paths).catch(() => false)
      }
      await connection?.close().catch(() => undefined)
      await this.disposeTargetPreset(targetId).catch(() => undefined)
      // Keep the row explainable: a failed reconnect leaves the previous target
      // record (if any) with a scrubbed, human-actionable error instead of a
      // silently deleted connection.
      if (existing !== undefined) {
        await this.options.store.updateTarget(targetId, current => ({
          ...current,
          status: 'failed',
          lastError: scrubSecrets(error instanceof Error ? error.message : String(error)),
        })).catch(() => undefined)
      }
      throw error
    }
  }

  /** Retry an unexpectedly closed SSH link five times, then leave the row failed. */
  private async reconnectLost(targetId: string): Promise<void> {
    if (this.reconnecting.has(targetId)) return
    const record = this.options.store.target(targetId)
    if (record === undefined) return
    this.reconnecting.add(targetId)
    try {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        if (attempt > 1) await new Promise<void>(resolve => { setTimeout(resolve, Math.min(8_000, 400 * 2 ** (attempt - 2))) })
        const secret = await this.options.store.secretOf(record).catch(() => undefined)
        try {
          const result = await this.connect({
            label: record.label,
            host: record.host,
            port: record.port,
            username: record.username,
            authKind: record.authKind,
            ...(record.privateKeyPath === undefined ? {} : { privateKeyPath: record.privateKeyPath }),
            ...(secret === undefined || secret === '' ? {} : { secret }),
            ...(record.hostKeyFingerprint === '' ? {} : { hostKeyFingerprint: record.hostKeyFingerprint }),
            ...(record.remote.dshHome === '' ? {} : { dshHome: record.remote.dshHome }),
          })
          if (result.state.phase === 'ready' || result.state.phase === 'degraded') return
        } catch (error) {
          const code = (error as { code?: unknown })?.code
          // Credentials/host identity cannot be fixed by retrying; stop early.
          if (code === 'ssh-auth-failed' || code === 'hostkey-mismatch' || code === 'HOST_KEY_MISMATCH') return
        }
      }
      this.failures.set(targetId, { code: 'ssh-reconnect-failed', message: 'the SSH connection closed and five reconnect attempts failed' })
      await this.options.store.updateTarget(targetId, current => ({ ...current, status: 'failed', lastError: 'the SSH connection closed and five reconnect attempts failed' })).catch(() => undefined)
    } finally {
      this.reconnecting.delete(targetId)
    }
  }

  /** Stop one target: cancel turns, stop the profile server, close the tunnel. */
  async stop(targetId: string): Promise<boolean> {
    const live = this.live.get(targetId)
    if (live === undefined) return false
    this.live.delete(targetId)
    this.reconnectClose.get(targetId)?.()
    this.reconnectClose.delete(targetId)
    await this.disposeTargetPreset(targetId)
    await this.closeMux(targetId)
    const local = this.localRuntimes.get(targetId)
    if (local !== undefined) {
      this.localRuntimes.delete(targetId)
      await local.dispose().catch(() => undefined)
    }
    live.disposeUpgrade()
    live.portal.close()
    live.transport.dispose()
    await live.plugin.cancelAll().catch(() => undefined)
    await stopProfileServer(live.connection.remote, live.paths).catch(() => false)
    await waitForProfileStopped(live.connection.remote, live.paths).catch(() => false)
    await live.connection.close().catch(() => undefined)
    this.options.onPortalClosed?.(targetId)
    await this.options.store.updateTarget(targetId, current => ({ ...current, status: 'stopped' })).catch(() => undefined)
    return true
  }

  /** Stop every live profile (plugin unload). */
  async dispose(): Promise<void> {
    for (const targetId of [...this.live.keys()]) await this.stop(targetId).catch(() => false)
    for (const [targetId, runtime] of [...this.localRuntimes]) {
      this.localRuntimes.delete(targetId)
      await runtime.dispose().catch(() => undefined)
    }
    for (const targetId of [...this.muxes.keys()]) await this.closeMux(targetId)
    for (const targetId of [...this.presetDisposers.keys()]) await this.disposeTargetPreset(targetId)
  }

  /** P1 read: workspace list. */
  async workspaceList(targetId: string): Promise<unknown> {
    const value = await this.pluginFor(targetId)?.rpc('workspace/list', {}) ?? { workspaces: [] }
    this.rememberWorkspacePaths(value)
    const registry = (value as { registry?: { revision?: unknown; epoch?: unknown } }).registry
    if (typeof registry?.revision === 'string' && registry.revision !== '') {
      const list = value as { pinnedSessionIds?: unknown; archivedSessionIds?: unknown }
      this.registryRevisions.set(targetId, {
        revision: registry.revision,
        ...(typeof registry.epoch === 'string' ? { epoch: registry.epoch } : {}),
      })
      this.registryViewState.set(targetId, {
        pinned: Array.isArray(list.pinnedSessionIds) ? list.pinnedSessionIds.filter((id): id is string => typeof id === 'string') : [],
        archived: Array.isArray(list.archivedSessionIds) ? list.archivedSessionIds.filter((id): id is string => typeof id === 'string') : [],
      })
    }
    return value
  }

  /** P1 read: session list for one workspace (or all). */
  async sessionList(targetId: string, workspaceId?: string): Promise<unknown> {
    const value = await this.pluginFor(targetId)?.rpc<Record<string, unknown>>('session/list', workspaceId === undefined ? {} : { workspaceId }) ?? { sessions: [] }
    // D12: pin/archive are registry-global server state. The server plugin may
    // not stamp every row yet (M2g rows often miss it); merge workspace/list's
    // authoritative id arrays here so a second client sees the same flags after
    // refresh without a client-local pin store.
    let view = this.registryViewState.get(targetId)
    if (view === undefined) {
      try { await this.workspaceList(targetId) } catch {}
      view = this.registryViewState.get(targetId)
    }
    const sessions = (value as { sessions?: unknown }).sessions
    if (view === undefined || !Array.isArray(sessions)) return value
    const pinned = new Set(view.pinned)
    const archived = new Set(view.archived)
    return {
      ...value,
      sessions: sessions.map(row => {
        if (row === null || typeof row !== 'object') return row
        const record = row as Record<string, unknown>
        const id = typeof record.sessionId === 'string' ? record.sessionId : ''
        return { ...record, pinned: pinned.has(id) || record.pinned === true, archived: archived.has(id) || record.archived === true }
      }),
    }
  }

  /**
   * UI refresh (D12): reload the official workspace row first when possible,
   * then read both lists.
   *
   * A profile server keeps the registry in memory; another client's pin/archive
   * write lands in the shared `workspace.json` and is only visible to this
   * process after the loader disable/enable. Without this step a plain
   * `/api/state/refresh` shows stale pin/archive flags until the user presses the
   * separate "load server changes" action. The reload does not touch turns or
   * the process; a reload failure degrades to the read-only path and is reported.
   */
  async refresh(targetId: string): Promise<{ workspaces: unknown; sessions: unknown; stale: boolean; registryReloaded: boolean; registryReloadError?: { code: string; message: string } }> {
    const plugin = this.pluginFor(targetId)
    if (plugin === undefined) throw new Error(`remote target "${targetId}" is not connected`)
    let registryReloaded = false
    let registryReloadError: { code: string; message: string } | undefined
    try {
      await plugin.rpc('registry/refresh', {})
      registryReloaded = true
    } catch (error) {
      registryReloadError = {
        code: typeof (error as { code?: unknown }).code === 'string' ? String((error as { code?: unknown }).code) : 'registry-reload-failed',
        message: error instanceof Error ? error.message : String(error),
      }
    }
    // Route through `workspaceList` on purpose: it records the registry id
    // arrays (`pinnedSessionIds`/`archivedSessionIds`) and workspace paths used
    // by the row merge and by local-mode aliases.
    const workspaces = await this.workspaceList(targetId) as { registry?: { revision?: string; stale?: boolean } }
    const sessions = this.sessionFlags(targetId, await plugin.rpc('session/list', {}))
    return {
      workspaces,
      // Keep the P1 SessionListValue shape `{ registry?, sessions }`: dev-ui's
      // state merge reads `sessions.sessions`, not a bare row array.
      sessions: this.sessionFlags(targetId, sessions),
      stale: workspaces.registry?.stale === true || registryReloadError !== undefined,
      registryReloaded,
      ...(registryReloadError === undefined ? {} : { registryReloadError }),
    }
  }

  /** Merge already-cached registry pin/archive flags into one session/list value. */
  private sessionFlags(targetId: string, value: unknown): { sessions: unknown } {
    const view = this.registryViewState.get(targetId)
    const sessions = (value as { sessions?: unknown } | undefined)?.sessions
    if (view === undefined || !Array.isArray(sessions)) return { sessions }
    const pinned = new Set(view.pinned)
    const archived = new Set(view.archived)
    return {
      sessions: sessions.map(row => {
        if (row === null || typeof row !== 'object') return row
        const record = row as Record<string, unknown>
        const id = typeof record.sessionId === 'string' ? record.sessionId : ''
        return { ...record, pinned: pinned.has(id) || record.pinned === true, archived: archived.has(id) || record.archived === true }
      }),
    }
  }

  /** Server path of a workspace learned from P1 (for local-mode anchors). */
  remotePathForWorkspace(workspaceId: string): string | undefined {
    return this.workspacePaths.get(workspaceId)
  }

  /** Public alias view for the realm's `ctx.ssh` and the mux backend. */
  pathAliases(targetId: string): { stub: string; remote: string }[] {
    return this.pathAliasesFor(targetId)
  }

  /** The private local anchor standing for one workspace (local mode). */
  anchorForWorkspace(workspaceId: string): string | undefined {
    for (const runtime of this.localRuntimes.values()) {
      const path = runtime.anchorForWorkspace(workspaceId)
      if (path !== undefined) return path
    }
    return undefined
  }

  /** Resolve a session cwd that is one of this process's private anchors. */
  routeForCwd(cwd: string | undefined): { targetId: string; workspaceId: string; remoteCwd?: string } | undefined {
    for (const runtime of this.localRuntimes.values()) {
      const route = runtime.routeForCwd(cwd)
      if (route !== undefined) {
        const remoteCwd = this.remotePathForWorkspace(route.workspaceId)
        return { targetId: route.targetId, workspaceId: route.workspaceId, ...(remoteCwd === undefined ? {} : { remoteCwd }) }
      }
    }
    return undefined
  }

  /** Find the target/workspace owning a stored session through P1 `persist/locate`. */
  async locateRemoteSession(sessionId: string): Promise<{ targetId: string; workspaceId: string; remoteCwd?: string } | undefined> {
    for (const targetId of this.live.keys()) {
      try {
        const located = await this.rpc<{ workspaceId?: unknown; remoteCwd?: unknown }>(targetId, 'persist/locate', { sessionId })
        const remoteCwd = typeof located?.remoteCwd === 'string' ? located.remoteCwd : undefined
        const workspaceId = typeof located?.workspaceId === 'string'
          ? located.workspaceId
          : remoteCwd === undefined ? undefined : [...this.workspacePaths].find(([, path]) => path === remoteCwd)?.[0]
        if (workspaceId !== undefined && workspaceId !== '') {
          return { targetId, workspaceId, ...(remoteCwd === undefined ? {} : { remoteCwd }) }
        }
      } catch {
        // A target that cannot answer is not the owner.
      }
    }
    return undefined
  }

  /** One administrative P1 write/read (workspace, session, fs, executor). */
  async rpc<T>(targetId: string, method: string, params: unknown = {}, signal?: AbortSignal): Promise<T> {
    const plugin = this.pluginFor(targetId)
    if (plugin === undefined) throw Object.assign(new Error(`remote target "${targetId}" is not connected`), { code: 'target-not-connected', status: 404 })
    const value = await plugin.rpc<T>(method, params, signal)
    this.rememberWorkspacePaths(value)
    return value
  }

  private rememberWorkspacePaths(value: unknown): void {
    if (value === null || typeof value !== 'object') return
    const record = value as { workspaces?: { workspaceId?: unknown; path?: unknown }[]; workspace?: { workspaceId?: unknown; path?: unknown } }
    const rows = Array.isArray(record.workspaces) ? record.workspaces : record.workspace === undefined ? [] : [record.workspace]
    for (const row of rows) {
      if (typeof row.workspaceId === 'string' && typeof row.path === 'string') this.workspacePaths.set(row.workspaceId, row.path)
    }
  }

  /** P3 workspace/session/fs write operations, forwarded to P1 unchanged. */
  workspaceCreate(targetId: string, path: string, title?: string): Promise<unknown> {
    return this.rpc(targetId, 'workspace/create', { path, ...(title === undefined ? {} : { title }) })
  }

  workspaceRename(targetId: string, workspaceId: string, title: string): Promise<unknown> {
    return this.rpc(targetId, 'workspace/rename', { workspaceId, title })
  }

  workspaceDelete(targetId: string, workspaceId: string, force = false): Promise<unknown> {
    return this.rpc(targetId, 'workspace/delete', { workspaceId, ...(force ? { force: true } : {}) })
  }

  workspaceReorder(targetId: string, workspaceId: string, beforeWorkspaceId?: string): Promise<unknown> {
    return this.rpc(targetId, 'workspace/reorder', { workspaceId, ...(beforeWorkspaceId === undefined ? {} : { beforeWorkspaceId }) })
  }

  /** P3 new session: server mode forwards P1; local mode uses the host runtime. */
  async sessionCreate(targetId: string, params: { workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string; executor?: 'server' | 'local' }): Promise<unknown> {
    if (params.executor !== 'local') {
      const result = await this.rpc<{ sessionId?: unknown; agentPreset?: unknown }>(targetId, 'session/create', params)
      return {
        ...result,
        sessionId: typeof result.sessionId === 'string' ? result.sessionId : '',
        workspaceId: params.workspaceId,
        executor: 'server',
        revealed: true,
      }
    }
    if (params.workspaceId === undefined || params.workspaceId === '') {
      throw Object.assign(new Error('a local-mode session needs a workspaceId'), { code: 'bad-request', status: 400 })
    }
    const runtime = this.localRuntimeFor(targetId)
    if (runtime === undefined) throw Object.assign(new Error('local mode is not available for this target'), { code: 'local-runtime-unavailable', status: 500 })
    try {
      // The routing persistence needs the server-real workspace path to write
      // `persist/create { remoteCwd, executor:'local' }`; make sure this process
      // has learned it (first local create can precede any workspace read).
      if (this.remotePathForWorkspace(params.workspaceId) === undefined) await this.workspaceList(targetId)
      const created = await runtime.create({ workspaceId: params.workspaceId })
      return { sessionId: created.sessionId, workspaceId: created.workspaceId, executor: 'local', revealed: created.revealed }
    } catch (error) {
      if (error instanceof LocalSessionError) throw Object.assign(new Error(error.message), { code: error.code, status: 409, details: error.details })
      throw error
    }
  }

  /**
   * P3 open: local mode resumes/attaches a client-owned handle; server mode is
   * iframe. When the caller omits `executor`, infer it from the server's
   * authoritative executor record: a session created in local mode must not be
   * reopened as server mode just because the UI did not repeat the choice.
   */
  async sessionOpen(targetId: string, params: { workspaceId?: string; sessionId: string; executor?: 'server' | 'local' }): Promise<unknown> {
    // The server-side executor record is authoritative: a session created in
    // local mode must reopen locally even if the UI still sends the connection's
    // old default (`server`). The explicit value is only a fallback for sessions
    // without a record (legacy/blank).
    const lookup = await this.executorModeOf(targetId, params.sessionId)
    const recorded = lookup.mode
    const executor = recorded ?? params.executor ?? 'server'
    const diagnostics = {
      executorSource: recorded === undefined ? 'fallback' : 'record',
      ...(recorded === undefined ? {} : { recordedExecutor: recorded }),
      ...(lookup.error === undefined ? {} : { executorLookupError: lookup.error }),
    }
    if (executor !== 'local') return { sessionId: params.sessionId, workspaceId: params.workspaceId, executor: 'server', revealed: true, ...diagnostics }
    if (params.workspaceId === undefined || params.workspaceId === '') throw Object.assign(new Error('a local-mode session needs a workspaceId'), { code: 'bad-request', status: 400 })
    const runtime = this.localRuntimeFor(targetId)
    if (runtime === undefined) throw Object.assign(new Error('local mode is not available for this target'), { code: 'local-runtime-unavailable', status: 500 })
    // The mux/`ctx.ssh` alias list needs the workspace's server path; make sure
    // it was learned even when the caller opens a session without a prior list.
    if (this.remotePathForWorkspace(params.workspaceId) === undefined) {
      await this.workspaceList(targetId).catch(() => undefined)
    }
    try {
      const opened = await runtime.open({ workspaceId: params.workspaceId, sessionId: params.sessionId })
      return { sessionId: opened.sessionId, workspaceId: opened.workspaceId, executor: 'local', revealed: opened.revealed, ...diagnostics }
    } catch (error) {
      if (error instanceof LocalSessionError) throw Object.assign(new Error(error.message), { code: error.code, status: 409, details: error.details })
      throw error
    }
  }

  /* ------------------------------------------------------- v2 P3 session -- */

  /** Planned v2 P1: the session timeline (messages/tool/status rows). */
  async sessionTimeline(targetId: string, params: { readonly sessionId: string; readonly afterSeq?: number; readonly beforeSeq?: number; readonly limit?: number }): Promise<unknown> {
    return await this.rpc(targetId, 'session/timeline', params)
  }

  /** Planned v2 P1: send one user prompt to the server-side agent. */
  async sessionPrompt(targetId: string, params: Record<string, unknown>): Promise<unknown> {
    return await this.rpc(targetId, 'session/prompt', params)
  }

  /** Planned v2 P1: cancel the current turn. */
  async sessionCancel(targetId: string, params: Record<string, unknown>): Promise<unknown> {
    return await this.rpc(targetId, 'session/cancel', params)
  }

  /** Planned v2 P1: allow/deny one pending approval. */
  async sessionApproval(targetId: string, params: Record<string, unknown>): Promise<unknown> {
    return await this.rpc(targetId, 'session/approval', params)
  }

  /** P1: list official slash commands for a server session. */
  async sessionCommands(targetId: string, params: Record<string, unknown>): Promise<unknown> {
    return await this.rpc(targetId, 'session/commands', params)
  }

  /** P1: execute one official slash command in a server session. */
  async sessionCommand(targetId: string, params: Record<string, unknown>): Promise<unknown> {
    return await this.rpc(targetId, 'session/command', params)
  }

  /** P1: routable model catalog for a server session. */
  async sessionModelCatalog(targetId: string, params: Record<string, unknown>): Promise<unknown> {
    return await this.rpc(targetId, 'session/modelCatalog', params)
  }

  /** P1: persist one model selection on a server session. */
  async sessionSelectModel(targetId: string, params: Record<string, unknown>): Promise<unknown> {
    return await this.rpc(targetId, 'session/selectModel', params)
  }

  /** Planned v2 P1: running/approval/status snapshot for one session. */
  async sessionStatus(targetId: string, params: Record<string, unknown>): Promise<unknown> {
    return await this.rpc(targetId, 'session/status', params)
  }

  /**
   * v2 session event stream (SSE). The caller is the host HTTP bridge; it
   * forwards the exact frames and owns reconnect (afterSeq) and keepalive.
   */
  async *sessionEvents(
    targetId: string,
    params: { readonly sessionId: string; readonly afterSeq?: number; readonly signal?: AbortSignal },
  ): AsyncGenerator<import('../remote/plugin-client.ts').PluginSseEvent> {
    const plugin = this.pluginFor(targetId)
    if (plugin === undefined) throw Object.assign(new Error(`remote target "${targetId}" is not connected`), { code: 'target-not-connected', status: 404 })
    yield* plugin.sessionEvents(params)
  }

  /** Read the server-authoritative executor mode for one session. */
  private async executorModeOf(targetId: string, sessionId: string): Promise<{ mode?: 'server' | 'local'; error?: { code: string; message: string } }> {
    try {
      const record = await this.rpc<{ mode?: unknown } | null>(targetId, 'executor/get', { sessionId })
      return record?.mode === 'local' || record?.mode === 'server' ? { mode: record.mode } : {}
    } catch (error) {
      // Do not silently degrade to the connection default; the caller includes
      // this in the session/open response so a lease/method failure is visible.
      return {
        error: {
          code: typeof (error as { code?: unknown }).code === 'string' ? String((error as { code?: unknown }).code) : 'executor-get-failed',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }

  /**
   * One target's local-mode runtime, created on demand.
   *
   * `ctx` is optional so unit tests can drive the service without a Cordis tree;
   * routes that need local mode without it report `local-runtime-unavailable`.
   */
  private localRuntimeFor(targetId: string): HostLocalRuntime | undefined {
    const cached = this.localRuntimes.get(targetId)
    if (cached !== undefined) return cached
    const ctx = this.options.ctx
    const clientId = this.options.store.clientId()
    if (ctx === undefined || clientId === undefined) return undefined
    const record = this.options.store.target(targetId)
    const runtime = createHostLocalRuntime({
      ctx,
      clientId,
      targetId,
      ...(record === undefined ? {} : { target: { label: record.label, host: record.host, port: record.port, username: record.username } }),
      remotePathForWorkspace: workspaceId => this.remotePathForWorkspace(workspaceId),
      rpc: {
        request: async <T,>(method: string, params: unknown, signal?: AbortSignal): Promise<T> =>
          await this.rpc<T>(targetId, method, params, signal),
      },
      flush: async () => {
        const persistence = ctx.get('sessionPersistence') as { flush?: () => Promise<void> } | undefined
        await persistence?.flush?.()
      },
      restartProfile: async () => {
        const preview = await this.restartPreview(targetId)
        await this.restart(targetId, { confirmActiveTurns: true, previewRevision: preview.previewRevision })
      },
    })
    this.localRuntimes.set(targetId, runtime)
    return runtime
  }

  sessionRename(targetId: string, sessionId: string, title: string): Promise<unknown> {
    return this.rpc(targetId, 'session/rename', { sessionId, title })
  }

  sessionFork(targetId: string, sessionId: string, params: { atSeq?: number; increaseTitle?: boolean } = {}): Promise<unknown> {
    return this.rpc(targetId, 'session/fork', { sessionId, ...params })
  }

  sessionPin(targetId: string, sessionId: string, pinned: boolean): Promise<unknown> {
    return this.rpc(targetId, 'session/pin', { sessionId, pinned })
  }

  sessionArchive(targetId: string, sessionId: string, archived: boolean, stopActivity = false): Promise<unknown> {
    return this.rpc(targetId, 'session/archive', { sessionId, archived, ...(stopActivity ? { stopActivity: true } : {}) })
  }

  sessionReorder(targetId: string, workspaceId: string, sessionId: string, beforeSessionId?: string): Promise<unknown> {
    return this.rpc(targetId, 'session/reorder', { workspaceId, sessionId, ...(beforeSessionId === undefined ? {} : { beforeSessionId }) })
  }

  sessionPrepareServer(targetId: string, sessionId: string): Promise<unknown> {
    return this.rpc(targetId, 'session/prepare-server', { sessionId })
  }

  fsList(targetId: string, path: string): Promise<unknown> {
    return this.rpc(targetId, 'fs/list', { path })
  }

  /** Create a directory through the live SSH execution world. */
  async makeDirectory(targetId: string, path: string): Promise<{ path: string }> {
    const live = this.live.get(targetId)
    if (live === undefined) {
      throw Object.assign(new Error(`remote target "${targetId}" is not connected`), { code: 'target-not-connected' })
    }
    const result = await live.connection.remote.exec(`command mkdir -p ${shellQuote(path)}`, { maxBytes: 16 * 1024, timeoutMs: 30_000 })
    if (result.code !== 0) throw new Error(`cannot create remote directory "${path}": ${scrubSecrets(result.stderr.trim().slice(-500))}`)
    return { path }
  }

  /** P3 mode preview (D20): all running turns in this profile's process. */
  async modePreview(targetId: string, _nextMode: 'server' | 'local', targetSessionId?: string): Promise<{
    readonly currentTurn?: { readonly sessionId: string; readonly running: boolean }
    readonly otherActiveTurns: readonly { readonly sessionId: string; readonly title?: string }[]
    readonly requiresConfirm: boolean
    readonly previewRevision: string
  }> {
    const plugin = this.pluginFor(targetId)
    if (plugin === undefined) throw Object.assign(new Error(`remote target "${targetId}" is not connected`), { code: 'target-not-connected', status: 404 })
    const status = await plugin.rpc<{ activeAgents?: readonly { sessionId: string; running: boolean; status: string }[] }>('profile/status', {})
    const active = (status.activeAgents ?? []).filter(agent => agent.running)
    // Protocol §5.4: the *target* session's turn is cancelled automatically;
    // a running turn of any other session needs D20 confirmation. Without a
    // targetSessionId the host cannot know which one the user is looking at, so
    // it asks for confirmation for every active turn (safe direction).
    const current = targetSessionId === undefined ? undefined : active.find(agent => agent.sessionId === targetSessionId)
    const others = active.filter(agent => agent.sessionId !== current?.sessionId).map(agent => ({ sessionId: agent.sessionId }))
    return {
      ...(current === undefined ? {} : { currentTurn: { sessionId: current.sessionId, running: true } }),
      otherActiveTurns: others,
      requiresConfirm: targetSessionId === undefined ? active.length > 0 : others.length > 0,
      // An idle switch is a normal case; use a stable non-empty sentinel so the
      // P3 route's `previewRevision` validation never rejects an empty body.
      previewRevision: active.length === 0 ? 'idle' : active.map(agent => agent.sessionId).sort().join(','),
    }
  }

  /** P3 mode apply: cancel turns (after D20 confirmation) and persist the setting. */
  async modeApply(targetId: string, nextMode: 'server' | 'local', options: { readonly cancelActiveTurns: boolean; readonly previewRevision: string; readonly targetSessionId?: string }): Promise<{
    readonly switched: boolean
    readonly cancelledTurnIds: readonly string[]
    readonly failedCancellations: readonly { readonly sessionId: string; readonly message: string }[]
    readonly restartRequired?: boolean
    readonly openSessionId?: string
  }> {
    const preview = await this.modePreview(targetId, nextMode, options.targetSessionId)
    if (nextMode === 'local' && options.targetSessionId === undefined) {
      throw Object.assign(new Error('switching to local needs targetSessionId (the session the user is looking at)'), {
        code: 'mode-switch/target-session-required',
        status: 400,
        details: { targetSessionId: null, requires: 'targetSessionId' },
      })
    }
    if (preview.requiresConfirm && !options.cancelActiveTurns) {
      throw Object.assign(new Error('switching the executor cancels running turns and requires confirmation'), {
        code: 'mode-switch/other-turns-cancelled-required',
        status: 409,
        details: { otherActiveTurns: preview.otherActiveTurns },
      })
    }
    if (preview.previewRevision !== options.previewRevision) {
      throw Object.assign(new Error('the active-turn set changed; preview again'), { code: 'mode-switch/preview-stale', status: 409 })
    }
    const runtime = this.localRuntimeFor(targetId)
    if (runtime === undefined) {
      throw Object.assign(new Error('local mode is not available for this target'), { code: 'local-runtime-unavailable', status: 500 })
    }
    let result
    try {
      result = await applyModeSwitch(
        {
          executor: runtime.executor,
          local: {
            list: () => runtime.manager.list().map(session => session.sessionId),
            release: async (sessionId: string) => { await runtime.manager.release(sessionId) },
          },
          restartProfile: async () => {
            const restartPreview = await this.restartPreview(targetId)
            await this.restart(targetId, { confirmActiveTurns: true, previewRevision: restartPreview.previewRevision })
          },
        },
        {
          nextMode,
          ...(options.targetSessionId === undefined ? {} : { targetSessionId: options.targetSessionId }),
          confirmOtherTurns: options.cancelActiveTurns,
          previewRevision: options.previewRevision,
        },
      )
    } catch (error) {
      throw Object.assign(
        new Error(error instanceof Error ? error.message : String(error)),
        {
          code: (error as { code?: string }).code ?? 'mode-switch/cancel-failed',
          status: (error as { status?: number }).status ?? 409,
          details: (error as { details?: unknown }).details,
        },
      )
    }
    // Only a successful apply flips the connection default; on any failure the
    // target keeps its previous mode (protocol §16.13).
    await this.options.store.updateTarget(targetId, current => ({ ...current, executor: nextMode })).catch(() => undefined)
    return result
  }

  /** P1 registry reload (loader disable/enable). */
  async registryRefresh(targetId: string): Promise<unknown> {
    const plugin = this.pluginFor(targetId)
    if (plugin === undefined) throw new Error(`remote target "${targetId}" is not connected`)
    return await plugin.rpc('registry/refresh', {})
  }

  /** P3 deployment preview: what would auto-install vs require a button. */
  deploymentPreview(targetId: string): DeploymentStateV1 {
    const state = this.deploymentState(targetId)
    if (state === undefined) throw Object.assign(new Error(`unknown remote target "${targetId}"`), { code: 'not-found', status: 404 })
    return state
  }

  /**
   * P3 deployment apply.
   *
   * Dedicated profile plugin changes and isolated-runtime changes are automatic;
   * a global runtime mutation is refused without `confirm`, and is reported as
   * unsupported when confirmed because v1 has no safe shared-install mutation.
   */
  async deploymentApply(targetId: string, request: { readonly kind: 'runtime' | 'plugin'; readonly confirm?: boolean }): Promise<{ applied: boolean; restarted: boolean; version?: string; requiresConfirmation?: boolean }> {
    const state = this.deploymentPreview(targetId)
    if (request.kind === 'plugin') {
      if (state.plugin.requiresConfirmation && request.confirm !== true) {
        throw Object.assign(new Error('installing the plugin outside the dedicated profile requires confirmation'), {
          code: 'plugin-install-confirmation-required', status: 409, details: state.plugin,
        })
      }
      if (state.plugin.requiresConfirmation) {
        throw Object.assign(new Error('v1 only manages the per-client dedicated profile; refusing to modify another profile'), {
          code: 'plugin-profile-not-managed', status: 501, details: state.plugin,
        })
      }
      const live = this.live.get(targetId)
      if (live === undefined) throw Object.assign(new Error(`remote target "${targetId}" is not connected`), { code: 'target-not-connected', status: 404 })
      const tarball = await this.resolvePluginTarball()
      await installServerPlugin({ remote: live.connection.remote, paths: live.paths, tarball, dshVersion: state.runtime.expectedVersion })
      await this.restart(targetId, { confirmActiveTurns: true, previewRevision: (await this.restartPreview(targetId)).previewRevision })
      return { applied: true, restarted: true, version: tarball.version }
    }
    if (state.runtime.kind === 'global') {
      if (request.confirm !== true) {
        throw Object.assign(new Error('installing/upgrading the server global DSH runtime requires explicit confirmation'), {
          code: 'runtime-confirmation-required', status: 409, details: state.runtime,
        })
      }
      throw Object.assign(new Error('v1 does not mutate the shared global DSH runtime; install the isolated runtime artifact instead'), {
        code: 'runtime-global-unsupported', status: 501, details: state.runtime,
      })
    }
    // Isolated runtime: use the client cache/env artifact; missing is an
    // actionable error, never a silent fallback to the client's local dsh.
    const record = this.options.store.target(targetId)
    const live = this.live.get(targetId)
    if (record === undefined || live === undefined) throw Object.assign(new Error(`remote target "${targetId}" is not connected`), { code: 'target-not-connected', status: 404 })
    const tag = record.platformProbe?.tag ?? ''
    const platformArch = tag.split('-').slice(0, 2).join('-') || 'linux-x64'
    const artifactPath = await resolveRuntimeArtifact({
      version: state.runtime.expectedVersion,
      platformArch,
      cacheDir: join(homedir(), '.dsh', 'remote-assets'),
      env: process.env,
    })
    if (artifactPath === undefined) {
      throw Object.assign(new Error(`no isolated runtime artifact for ${state.runtime.expectedVersion} ${platformArch} in the client cache; set DSH_RW_RUNTIME_ARTIFACT or seed the cache`), {
        code: 'runtime-missing', status: 500, details: { expectedVersion: state.runtime.expectedVersion, platformArch },
      })
    }
    const paths = runtimePaths(live.paths.dshHome, live.paths.clientId)
    const content = await readFile(artifactPath)
    const sha256 = await sha256File(artifactPath)
    const info = await stat(artifactPath)
    await installIsolatedRuntime({
      remote: live.connection.remote,
      paths,
      artifact: { path: artifactPath, name: basename(artifactPath), sha256, size: info.size, version: state.runtime.expectedVersion, platformArch },
      content,
    })
    this.live.set(targetId, {
      ...live,
      launcher: paths.launcher,
      pathPrefixes: runtimePathPrefixes(paths),
      runtimeKind: 'isolated',
      runtimeDir: paths.root,
    })
    const preview = await this.restartPreview(targetId)
    await this.restart(targetId, { confirmActiveTurns: true, previewRevision: preview.previewRevision })
    return { applied: true, restarted: true, version: state.runtime.expectedVersion }
  }

  /** Preview the turns a profile restart would cancel (D20). */
  async restartPreview(targetId: string): Promise<{ activeTurns: readonly unknown[]; requiresConfirmation: boolean; previewRevision: string }> {
    const plugin = this.pluginFor(targetId)
    if (plugin === undefined) throw new Error(`remote target "${targetId}" is not connected`)
    const status = await plugin.rpc<{ activeAgents?: readonly { sessionId: string; running: boolean; status: string }[] }>('profile/status', {})
    const activeTurns = (status.activeAgents ?? []).filter(agent => agent.running)
    return { activeTurns, requiresConfirmation: activeTurns.length > 0, previewRevision: `${activeTurns.length}:${activeTurns.map(agent => agent.sessionId).join(',')}` }
  }

  /** Restart the profile server, keeping the SSH connection (cookie/P1 recreated). */
  async restart(targetId: string, options: { readonly confirmActiveTurns: boolean; readonly previewRevision: string }): Promise<{ restarted: boolean; cancelledTurnIds: readonly string[] }> {
    const live = this.live.get(targetId)
    if (live === undefined) throw new Error(`remote target "${targetId}" is not connected`)
    const preview = await this.restartPreview(targetId)
    if (preview.requiresConfirmation && !options.confirmActiveTurns) {
      throw Object.assign(new Error('restarting cancels running turns and requires confirmation'), { code: 'profile-restart-preview-failed', status: 409 })
    }
    if (preview.previewRevision !== options.previewRevision) {
      throw Object.assign(new Error('the active-turn set changed; preview again'), { code: 'mode-switch/preview-stale', status: 409 })
    }
    const cancelled = await live.plugin.cancelAll().catch(() => ({ canceled: [] as string[] }))
    this.live.delete(targetId)
    this.reconnectClose.get(targetId)?.()
    this.reconnectClose.delete(targetId)
    await this.disposeTargetPreset(targetId)
    await this.closeMux(targetId)
    const local = this.localRuntimes.get(targetId)
    if (local !== undefined) {
      this.localRuntimes.delete(targetId)
      await local.dispose().catch(() => undefined)
    }
    live.disposeUpgrade()
    live.portal.close()
    live.transport.dispose()
    await stopProfileServer(live.connection.remote, live.paths)
    const handle = await startProfileServer(live.connection.remote, live.paths, {
      launcher: live.launcher,
      pathPrefixes: live.pathPrefixes,
      probe: async startup => await this.probeRoot(live.connection, startup.port, startup.token),
    })
    const cookie = await this.exchangeToken(live.connection, handle.port, handle.token)
    const transport = new TunnelPluginTransport(live.connection.forwarder, handle.port)
    const plugin = new RemotePluginClient({
      transport,
      clientId: await this.options.store.ensureClientId(),
      instanceId: this.instanceId,
      pluginVersion: this.options.pluginVersion,
      cookie,
    })
    await plugin.handshake({ profile: live.paths.profile })
    const portal = new PortalProxy(targetId, this.portalUpstream(live.connection, handle.port), cookie)
    const disposeUpgrade = this.options.registerPortalUpgrade?.(targetId, portal) ?? (() => {})
    this.live.set(targetId, {
      ...live,
      handle,
      cookie,
      transport,
      plugin,
      portal,
      disposeUpgrade,
      startedAt: (this.options.now?.() ?? new Date()).toISOString(),
    })
    const record = this.options.store.target(targetId)
    if (record !== undefined) await this.registerTargetPreset(record)
    return { restarted: true, cancelledTurnIds: cancelled.canceled }
  }

  /**
   * Register (or re-register) the remote execution-world preset for a v1 target.
   *
   * The realm's `connection` row resolves `ctx.remoteMux`; without the preset a
   * local-mode `ctx.agents.create/resume` fails with `agent-preset/not-found`
   * even though the profile server and P1 are healthy.
   */
  private async registerTargetPreset(target: { readonly id: string; readonly label: string; readonly host: string; readonly port: number; readonly username: string }): Promise<void> {
    const agentPresets = this.options.ctx?.get('agentPresets') as { register?: (definition: unknown) => Promise<() => Promise<void> | void> } | undefined
    if (agentPresets?.register === undefined) return
    const existing = this.presetDisposers.get(target.id)
    if (existing !== undefined) {
      this.presetDisposers.delete(target.id)
      await Promise.resolve(existing()).catch(() => undefined)
    } else {
      // The legacy `RemoteWorkspaces.ensureWorlds()` may already have registered
      // this id for a pre-v1 target (client upgrade/reconnect). Registering again
      // throws `Duplicate agent preset`; reuse the existing declaration, which
      // now runs the v1 `remoteMux` connection through the same target id.
      const listPresets = (agentPresets as { list?: () => Promise<readonly { id?: unknown }[]> }).list
      if (listPresets !== undefined) {
        try {
          const listed = await listPresets.call(agentPresets)
          if (Array.isArray(listed) && listed.some(preset => preset.id === remotePresetId(target.id))) return
        } catch {
          // A registry that cannot list still allows the register attempt.
        }
      }
    }
    const dispose = await agentPresets.register(remotePresetDefinition(target))
    this.presetDisposers.set(target.id, dispose)
  }

  /** Drop one target's preset registration (disconnect/forget). */
  private async disposeTargetPreset(targetId: string): Promise<void> {
    const dispose = this.presetDisposers.get(targetId)
    if (dispose === undefined) return
    this.presetDisposers.delete(targetId)
    await Promise.resolve(dispose()).catch(() => undefined)
  }

  private portalUpstream(connection: ProfileConnection, port: number): PortalUpstream {
    return {
      host: '127.0.0.1',
      port,
      agent: connection.forwarder.httpAgent({ port }),
      connect: async (signal?: AbortSignal): Promise<ForwardStream> => await connection.forwarder.open({ port }, signal),
    }
  }

  private async probeRoot(connection: ProfileConnection, port: number, token: string): Promise<boolean> {
    // The startup line and the listener can be a few milliseconds apart (and a
    // forwarded channel opened too early is refused). Retry inside the protocol's
    // 15 s readiness budget instead of failing on the first connection error.
    const deadline = Date.now() + PROFILE_STARTUP_TIMEOUT_MS
    for (;;) {
      let stream: ForwardStream | undefined
      try {
        stream = await connection.forwarder.open({ port })
        const result = await sendForwardedHttp(stream, {
          method: 'GET',
          path: `/?token=${encodeURIComponent(token)}`,
          headers: { host: `127.0.0.1:${port}` },
        }, { maxBytes: 4096, timeoutMs: 5_000 })
        if (result.status === 303 || result.status === 200) return true
      } catch {
        // keep retrying until the budget is exhausted; the caller reports the
        // profile log tail and pid/port on failure.
      } finally {
        stream?.destroy()
      }
      if (Date.now() >= deadline) return false
      await new Promise<void>(resolve => { setTimeout(resolve, 250) })
    }
  }

  private async exchangeToken(connection: ProfileConnection, port: number, token: string): Promise<string> {
    const stream = await connection.forwarder.open({ port })
    try {
      const result = await sendForwardedHttp(stream, {
        method: 'GET',
        path: `/?token=${encodeURIComponent(token)}`,
        headers: { host: `127.0.0.1:${port}` },
      }, { maxBytes: 8192, timeoutMs: 10_000 })
      if (result.status !== 303 && result.status !== 200) throw new Error(`the profile server token exchange answered HTTP ${result.status}`)
      const setCookie = result.headers['set-cookie']
      const line = Array.isArray(setCookie) ? setCookie[0] : setCookie
      if (typeof line !== 'string' || line === '') throw new Error('the profile server token exchange returned no cookie')
      return line.split(';')[0] ?? line
    } finally {
      stream.destroy()
    }
  }

  private async scan(remote: ProfileRemote): Promise<DshScan> {
    const result = await remote.exec(scanDshScript(), { maxBytes: 128 * 1024, timeoutMs: 60_000 })
    if (result.code !== 0) throw new Error(`the remote dsh scan failed (exit ${result.code ?? 'signal'}): ${scrubSecrets(result.stderr.trim().slice(-1000))}`)
    const scan = parseDshScanOutput(result.stdout)
    if (scan.home === undefined || scan.home === '') throw new Error('the remote scan did not report a home directory')
    return scan
  }

  /** The verified global dsh candidate, if the host has one. */
  private pickGlobal(scan: DshScan, request: ConnectProfileRequest): { path: string; nodePath?: string } | undefined {
    const override = process.env['DSH_RW_DSH_LAUNCHER']
    if (override !== undefined && override !== '') return { path: override }
    const candidates = scan.launchers.filter(candidate => candidate.version !== '' && isCompatibleDsh(candidate.version))
    const chosen = candidates[0]
    return chosen === undefined ? undefined : { path: chosen.path, ...(chosen.nodePath === undefined ? {} : { nodePath: chosen.nodePath }) }
  }

  /**
   * Inspect the runtime and server-plugin markers in the probe step.
   *
   * This is deliberately read-only on the remote: it tells the following steps
   * whether they will deploy, update or skip. The isolated runtime's Node is
   * executed (still read-only) because a marker alone can describe a runtime
   * whose native addons no longer load; a failed check forces a clean redeploy.
   */
  private async inspectRemoteSetup(
    connection: ProfileConnection,
    scan: DshScan,
    dshHome: string,
    clientId: string,
    request: ConnectProfileRequest,
    tarball: ServerPluginTarball,
  ): Promise<RemoteSetupInspection> {
    const expectedDsh = DSH_VERIFIED_RUNTIMES[0] ?? '0.2.1-rc.3'
    const global = request.runtimePolicy === 'isolated' || process.env['DSH_RW_FORCE_ISOLATED_RUNTIME'] === '1'
      ? undefined
      : this.pickGlobal(scan, request)
    let runtime: RemoteSetupInspection['runtime']
    if (global !== undefined) {
      const node = global.nodePath === undefined ? undefined : scan.nodes.find(candidate => candidate.path === global.nodePath)
      runtime = {
        kind: 'global',
        action: 'reuse',
        version: expectedDsh,
        ...(node?.version === undefined || node.version === '' ? {} : { nodeVersion: node.version }),
        detail: `复用 server 全局 DSH ${expectedDsh}${node?.version === undefined || node.version === '' ? '' : `（Node ${node.version}）`}`,
      }
    } else {
      const paths = runtimePaths(dshHome, clientId)
      const marker = await readRuntimeMarker(connection.remote, paths)
      const plan = planRuntime({ kind: 'isolated', expectedVersion: expectedDsh, marker })
      let action: SetupAction = plan.action
      let nodeVersion: string | undefined
      let runtimeUnhealthy = false
      if (plan.action === 'reuse') {
        const probe = await this.probeRuntimeHealth(connection.remote, paths)
        if (probe.ok) nodeVersion = probe.version
        else {
          runtimeUnhealthy = true
          action = marker === undefined ? 'install' : 'upgrade'
        }
      }
      const installedVersion = marker?.version
      runtime = {
        kind: 'isolated',
        action,
        version: expectedDsh,
        ...(installedVersion === undefined ? {} : { installedVersion }),
        ...(nodeVersion === undefined ? {} : { nodeVersion }),
        detail: action === 'reuse'
          ? `复用隔离运行时 ${expectedDsh}${nodeVersion === undefined ? '' : `（Node ${nodeVersion}）`}`
          : action === 'install'
            ? `部署隔离运行时 ${expectedDsh}（含 Node）`
            : runtimeUnhealthy
              ? `修复隔离运行时 ${installedVersion ?? expectedDsh}（原生模块健康检查失败）`
              : `更新隔离运行时 ${installedVersion ?? '旧版本'} → ${expectedDsh}`,
      }
    }
    const paths = profilePaths(dshHome, clientId)
    const pluginMarker = await readServerPluginMarker(connection.remote, paths)
    const pluginAction: SetupAction = decideServerPluginInstall(pluginMarker, {
      version: tarball.version,
      sha256: tarball.sha256,
      protocol: SERVER_PLUGIN_PROTOCOL,
      dshVersion: expectedDsh,
    }) === 'skip' ? 'reuse' : pluginMarker === undefined ? 'install' : 'upgrade'
    const installedPlugin = pluginMarker?.version
    const plugin = {
      action: pluginAction,
      version: tarball.version,
      ...(installedPlugin === undefined ? {} : { installedVersion: installedPlugin }),
      detail: pluginAction === 'reuse'
        ? `复用 server 插件 ${tarball.version}`
        : pluginAction === 'install'
          ? `安装 server 插件 ${tarball.version}`
          : `更新 server 插件 ${installedPlugin ?? '旧版本'} → ${tarball.version}`,
    }
    const actionLabel: Record<SetupAction, string> = { reuse: '跳过', install: '部署', upgrade: '更新' }
    return {
      runtime,
      plugin,
      summary: `运行时 ${actionLabel[runtime.action]}（${runtime.detail}）；server 插件 ${actionLabel[plugin.action]}（${plugin.detail}）`,
    }
  }

  /**
   * Prove the isolated runtime can actually run: Node prints a version and the
   * dsh launcher answers through the runtime's own PATH. A marker alone is not
   * enough — it can describe a runtime whose files were removed or corrupted.
   */
  private async probeRuntimeHealth(remote: ProfileRemote, paths: RuntimePaths): Promise<{ ok: boolean; version?: string }> {
    try {
      const node = await remote.exec(`${shellQuote(paths.nodeBin)} -v`, { maxBytes: 4096, timeoutMs: 10_000 })
      const version = (node.stdout ?? '').trim().split('\n')[0] ?? ''
      if (node.code !== 0 || !/^v\d+\./u.test(version)) return { ok: false }
      const launcher = await remote.exec(
        `DSH_HOME=${shellQuote(paths.dshHome)} ${runtimePathAssignment(paths)} ${shellQuote(paths.launcher)} --version`,
        { maxBytes: 4096, timeoutMs: 20_000 },
      )
      if (launcher.code !== 0) return { ok: false, version }
      const addon = await remote.exec(runtimeAddonProbeCommand(paths), { maxBytes: 4096, timeoutMs: 20_000 })
      return { ok: addon.code === 0, version }
    } catch {
      return { ok: false }
    }
  }

  /**
   * Pick the runtime before the profile install: a verified global dsh if the
   * host has one, otherwise the per-client isolated runtime (auto install or
   * upgrade from the injected artifact). Failing to find either is a coded
   * `runtime-missing`; the connect never silently falls back to a local world.
   */
  private async resolveRuntime(
    connection: ProfileConnection,
    scan: DshScan,
    dshHome: string,
    clientId: string,
    request: ConnectProfileRequest,
    onRuntimeProgress?: (message: string) => void,
  ): Promise<ResolvedRuntime> {
    const expectedDsh = DSH_VERIFIED_RUNTIMES[0] ?? '0.2.1-rc.3'
    const global = request.runtimePolicy === 'isolated' || process.env['DSH_RW_FORCE_ISOLATED_RUNTIME'] === '1'
      ? undefined
      : this.pickGlobal(scan, request)
    if (global !== undefined) {
      const prefixes: string[] = []
      if (global.nodePath !== undefined) prefixes.push(dirname(global.nodePath))
      if (global.path.includes('/')) prefixes.push(dirname(global.path))
      return { kind: 'global', action: 'reuse', launcher: global.path, pathPrefixes: prefixes, dshVersion: expectedDsh, runtimeDir: '' }
    }
    const paths = runtimePaths(dshHome, clientId)
    const marker = await readRuntimeMarker(connection.remote, paths)
    const plan = planRuntime({ kind: 'isolated', expectedVersion: expectedDsh, marker })
    if (plan.action === 'reuse') {
      const probe = await this.probeRuntimeHealth(connection.remote, paths)
      if (probe.ok) {
        return { kind: 'isolated', action: 'reuse', launcher: paths.launcher, pathPrefixes: runtimePathPrefixes(paths), dshVersion: expectedDsh, runtimeDir: paths.root }
      }
      onRuntimeProgress?.('隔离 runtime 不可用，正在重新部署…')
    }
    const action: SetupAction = marker === undefined ? 'install' : 'upgrade'
    const facts0 = probeFactsFrom({ uname: scan.platform ?? '', machine: scan.machine ?? '', ostype: scan.ostype ?? '', ldd: scan.ldd ?? '' })
    const archKey0 = `${facts0.platform}-${facts0.arch}`
    let artifactPath = await resolveRuntimeArtifact({
      version: expectedDsh,
      platformArch: archKey0,
      cacheDir: join(homedir(), '.dsh', 'remote-assets'),
      env: process.env,
    })
    if (artifactPath === undefined) {
      // The published runtime tarball is not always available for a just-released
      // dsh. Build the same node+dsh layout locally instead of failing the
      // connection; this is the only way a new dsh can auto-upgrade the isolated
      // runtime before the server release job has produced its artifact.
      try {
        const built = await buildRuntimeArtifact({
          version: expectedDsh,
          platform: facts0.platform,
          arch: facts0.arch,
          onProgress: onRuntimeProgress,
        })
        artifactPath = built.path
      } catch (error) {
        throw new RuntimeError(
          'runtime-missing',
          `the server has no verified dsh ${expectedDsh} and the isolated runtime artifact could not be built: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    const content = await readFile(artifactPath)
    const info = await stat(artifactPath)
    const sha256 = await sha256File(artifactPath)
    const artifact = {
      path: artifactPath,
      name: basename(artifactPath) === '' ? runtimeArtifactName(expectedDsh, archKey0) : basename(artifactPath),
      sha256,
      size: info.size,
      version: expectedDsh,
      platformArch: archKey0,
    }
    await installIsolatedRuntime({ remote: connection.remote, paths, artifact, content })
    const health = await this.probeRuntimeHealth(connection.remote, paths)
    if (!health.ok) {
      throw new RuntimeError(
        'runtime-install-failed',
        `the isolated runtime for ${clientId} was installed but failed its Node/native-addon health check; the profile server would exit before its startup line`,
      )
    }
    return { kind: 'isolated', action, launcher: paths.launcher, pathPrefixes: runtimePathPrefixes(paths), dshVersion: expectedDsh, runtimeDir: paths.root }
  }

  /**
   * Locate one of this plugin's own installed packages (peer fallback).
   *
   * `createRequire(import.meta.url)` resolves from the installed client plugin,
   * which is the same profile that provides the peer to this host. A package
   * whose `exports` hides `package.json` is found through its entry file and a
   * walk up to the manifest.
   */
  private resolvePeerPackage(name: string): string | undefined {
    const override = process.env['DSH_RW_PEER_SCHEMASTERY']
    if (name === '@deepseek-ai/schemastery' && override !== undefined && override !== '') return override
    let resolved: string
    try {
      resolved = createRequire(import.meta.url).resolve(`${name}/package.json`)
    } catch {
      try { resolved = createRequire(import.meta.url).resolve(name) } catch { return undefined }
    }
    let directory = dirname(resolved)
    for (let depth = 0; depth < 8; depth++) {
      let manifest: { name?: unknown }
      try { manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name?: unknown } } catch { manifest = {} }
      if (manifest.name === name) return directory
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    return undefined
  }

  private async resolvePluginTarball(): Promise<ServerPluginTarball> {
    const override = process.env['DSH_RW_SERVER_PLUGIN_TARBALL']
    if (override !== undefined && override !== '') return await verifyServerPluginTarball(override, this.options.pluginVersion)
    return await resolveServerPluginTarball({
      packageRoot: this.options.packageRoot,
      version: this.options.pluginVersion,
      cacheDir: this.options.cacheDir,
      downloader: { download: async () => { throw new Error('the server plugin tarball is not bundled in this build') } },
    })
  }

  private async persistTarget(
    request: ConnectProfileRequest,
    hints: {
      readonly targetId: string
      readonly clientId: string
      readonly profileName: string
      readonly profilePort: number
      readonly pluginVersion: string
      readonly serverDshVersion: string
      readonly launcher: string
      readonly runtimeDir: string
      readonly runtimeKind: 'isolated' | 'global'
      readonly dshHome: string
    },
  ): Promise<PublicTarget> {
    const existing = this.options.store.listTargets().find(target => target.label.toLowerCase() === request.label.toLowerCase())
    const now = (this.options.now?.() ?? new Date()).toISOString()
    let record: RemoteTargetRecord = {
      id: existing?.id ?? hints.targetId,
      label: request.label,
      kind: 'ssh',
      host: request.host,
      port: request.port,
      username: request.username,
      authKind: request.authKind,
      ...(request.privateKeyPath === undefined ? {} : { privateKeyPath: request.privateKeyPath }),
      hostKeyFingerprint: request.hostKeyFingerprint ?? existing?.hostKeyFingerprint ?? '',
      clientId: hints.clientId,
      executor: existing?.executor ?? 'local',
      profileName: hints.profileName,
      profilePort: hints.profilePort,
      runtimeKind: hints.runtimeKind,
      ...(hints.runtimeDir === '' ? {} : { runtimeDir: hints.runtimeDir }),
      pluginVersion: hints.pluginVersion,
      serverDshVersion: hints.serverDshVersion,
      remote: {
        nodePath: 'node',
        dshCommand: hints.launcher,
        profile: hints.profileName,
        dshHome: hints.dshHome,
        plugins: [],
      },
      status: 'ready',
      lastConnectedAt: now,
      createdAt: existing?.createdAt ?? now,
    }
    if (request.secret !== undefined && request.secret !== '') record = await this.options.store.storeSecret(record, request.secret)
    await this.options.store.putTarget(record)
    return {
      id: record.id,
      label: record.label,
      kind: record.kind,
      host: record.host,
      port: record.port,
      username: record.username,
      authKind: record.authKind,
      hasStoredSecret: record.credentialKey !== undefined,
      hostKeyFingerprint: record.hostKeyFingerprint,
      clientId: hints.clientId,
      executor: record.executor,
      profileName: record.profileName,
      profilePort: record.profilePort,
      runtimeKind: record.runtimeKind,
      runtimeDir: record.runtimeDir,
      pluginVersion: record.pluginVersion,
      serverDshVersion: record.serverDshVersion,
      remote: record.remote,
      status: record.status,
      ...(record.lastConnectedAt === undefined ? {} : { lastConnectedAt: record.lastConnectedAt }),
    }
  }
}
