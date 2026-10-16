/**
 * The host-plane `remoteWorkspaces` service.
 *
 * It owns everything the realm must not see: `ssh2`, host-key decisions, profile
 * provisioning, the wizard's progress stream, the target and workspace records,
 * preset registration, and session creation with a remote working directory.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { SshRpcPeer, SSH_PROTOCOL_VERSION } from '@deepseek-ai/dsh-ssh/protocol'
import { entriesSchema, helloSchema, targetSchema } from '@deepseek-ai/dsh-ssh/schemas'
import { DEFAULT_MAX_FRAME_BYTES } from '../frame/codec.ts'
import { FrameMux, streamTransport } from '../frame/mux.ts'
import { HostKeyMismatchError, HostKeyUnknownError } from '../ssh/hostkey.ts'
import { connectSsh, execRemote } from '../ssh/connect.ts'
import { remotePresetDefinition, remotePresetId } from '../preset/world.ts'
import { openRemoteSession } from '../session/open.ts'
import { shellQuote } from './profile.ts'
import { authFor, provisionTarget, readPrivateKey, type ProvisionEvent, type ProvisionStep } from './channel.ts'
import { scrubSecrets, type PackagePolicySettings, type PublicTarget, type RemoteAuthKind, type RemoteChannel, type RemoteRuntimeRecord, type RemoteTargetRecord, type RemoteWorkspaceRecord } from '../targets/types.ts'
import { TargetStore } from '../targets/store.ts'
import type { WorkspaceId, RemoteWorkspaceSummary } from '../protocol.ts'

/** One browser-facing connection attempt, driven by an SSE stream. */
export interface ConnectTicket {
  readonly id: string
  readonly request: ConnectRequest
  /** Events already emitted, replayed to a late stream subscriber. */
  readonly events: ProvisionEvent[]
  /** Resolved by `confirmHostKey`. */
  confirm: ((fingerprint: string) => void) | undefined
  fingerprint: string | undefined
  closed: boolean
}

/** The wizard's step-2 payload. */
export interface ConnectRequest {
  readonly label: string
  readonly host: string
  readonly port: number
  readonly username: string
  readonly authKind: RemoteAuthKind
  readonly secret?: string
  readonly privateKeyPath?: string
  readonly sshConfigAlias?: string
  readonly hostKeyFingerprint?: string
  readonly packageSource?: 'auto' | 'download' | 'upload'
  readonly remote?: Partial<RemoteRuntimeRecord>
}

/** One directory listing entry as the browser needs it. */
export interface DirEntry {
  readonly name: string
  readonly type: 'file' | 'directory' | 'other'
  readonly path: string
}

/** A directory listing with its breadcrumb inputs. */
export interface DirListing {
  readonly home: string
  readonly path: string
  readonly parent?: string
  readonly entries: DirEntry[]
}

/** A one-shot RPC client over a provisioned channel, used for browsing. */
class RemoteClient {
  private constructor(
    private readonly mux: FrameMux,
    private readonly peer: SshRpcPeer,
    private readonly channel: RemoteChannel,
    readonly home: string,
    readonly serverInfo: { serverId: string; installationId: string; version: string } | undefined,
    private readonly heartbeat: NodeJS.Timeout,
  ) {}

  static async open(channel: RemoteChannel, workspace: string, leaseMs = 30_000): Promise<RemoteClient> {
    const mux = new FrameMux({
      transport: streamTransport(channel.input, channel.output),
      role: 'client',
      label: 'remote-browser',
    })
    const peer = new SshRpcPeer(mux.jsonInput(), mux.jsonOutput(), DEFAULT_MAX_FRAME_BYTES, 128)
    try {
      const hello = await peer.request('hello', {
        protocol: SSH_PROTOCOL_VERSION,
        workspace,
        leaseMs,
      }, helloSchema, AbortSignal.timeout(20_000))
      const serverInfo = await peer.request('server.hello', { protocol: 2, clientVersion: '0.4.0-dev' }, z.object({
        protocol: z.literal(2), serverId: z.string(), installationId: z.string(), version: z.string(), workspacesRoot: z.string(),
      }), AbortSignal.timeout(20_000)).catch(() => undefined)
      const client = new RemoteClient(mux, peer, channel, hello.workspace, serverInfo, startHeartbeat())
      return client
    } catch (error) {
      peer.close()
      mux.close()
      await channel.close().catch(() => {})
      throw error
    }

    /** Refresh the server lease periodically so an idle panel never triggers a full reprovision. */
    function startHeartbeat(): NodeJS.Timeout {
      const timer = setInterval(() => {
        void peer
          .request('heartbeat', {}, z.null(), AbortSignal.timeout(5_000))
          .catch(() => {})
      }, 10_000)
      timer.unref()
      return timer
    }
  }

  request<T>(method: string, params: unknown, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    return this.peer.request(method, params, schema, signal)
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat)
    await this.peer.request('close', {}, z.null(), AbortSignal.timeout(5000)).catch(() => {})
    this.peer.close()
    this.mux.close()
    await this.channel.close().catch(() => {})
  }
}

/** Everything the plugin needs from the provisioning layer. */
export interface RemoteWorkspacesOptions {
  /** Absolute plugin package root whose `lib/` is uploaded. */
  readonly packageRoot: string
  /** Lease offered to remote servers. */
  readonly leaseMs: number
  /** Maximum remote process handles. */
  readonly maxProcesses: number
  /** Idle lifetime of a wizard browsing session. */
  readonly browseIdleMs?: number
}

/** Host-plane service implementation. */
/** The official shell workspace registry, host-plane, loose face. */
interface OfficialWorkspace {
  readonly id: string
  readonly path: string
  attachSession(sessionId: string): Promise<void>
}

interface WorkspaceRegistryLike {
  create(path: string, title?: string): Promise<OfficialWorkspace>
  resolveByPath(path: string): OfficialWorkspace | undefined
  delete(id: string): Promise<void>
}

export class RemoteWorkspaces {
  private readonly tickets = new Map<string, ConnectTicket>()
  private readonly channels = new Map<string, RemoteChannel>()
  private readonly connecting = new Map<string, Promise<RemoteChannel>>()
  private readonly browsers = new Map<string, { client: RemoteClient }>()
  private readonly presetDisposers = new Map<string, () => Promise<void>>()
  private readonly options: Required<RemoteWorkspacesOptions>
  private bootstrap: Promise<void> | undefined

  constructor(private readonly ctx: Context, private readonly store: TargetStore, options: RemoteWorkspacesOptions) {
    this.options = { browseIdleMs: 0, ...options }
  }

  /** Register presets for every stored target; safe to call more than once. */
  ensureWorlds(): Promise<void> {
    this.bootstrap ??= (async () => {
      for (const target of this.store.listTargets()) {
        await this.registerPreset(target).catch(() => {})
      }
    })()
    return this.bootstrap
  }

  /** Register (or re-register) one target's preset so a session can be composed. */
  async registerPreset(target: RemoteTargetRecord): Promise<void> {
    const id = remotePresetId(target.id)
    const existing = this.presetDisposers.get(id)
    if (existing !== undefined) {
      await existing().catch(() => {})
      this.presetDisposers.delete(id)
    }
    const dispose = await this.ctx.agentPresets.register(remotePresetDefinition(target))
    this.presetDisposers.set(id, dispose)
  }

  /** Open a protocol channel to a target, starting its server when needed. */
  async connectChannel(targetId: string, signal?: AbortSignal): Promise<RemoteChannel> {
    const live = this.channels.get(targetId)
    if (live !== undefined && !isClosed(live)) return live
    const pending = this.connecting.get(targetId)
    if (pending !== undefined) return await pending
    const attempt = this.connectOnce(targetId, signal)
    this.connecting.set(targetId, attempt)
    try {
      return await attempt
    } finally {
      this.connecting.delete(targetId)
    }
  }

  private async connectOnce(targetId: string, signal?: AbortSignal): Promise<RemoteChannel> {
    const target = this.store.target(targetId)
    if (target === undefined) throw new Error(`unknown remote target "${targetId}"`)
    if (target.hostKeyFingerprint === '') {
      throw new Error(`remote target "${target.label}" has no confirmed host key; connect it from the wizard first`)
    }
    const secret = await this.store.secretOf(target)
    const privateKey = target.privateKeyPath === undefined ? undefined : await readPrivateKey(target.privateKeyPath)
    const result = await provisionTarget({
      target,
      ...(secret === undefined ? {} : { secret }),
      ...(privateKey === undefined ? {} : { privateKey }),
      packageRoot: this.options.packageRoot,
      packagePolicy: this.store.packagePolicy(),
      ...(signal === undefined ? {} : { signal }),
    })
    if (result.fingerprint !== target.hostKeyFingerprint) {
      await this.store.updateTarget(targetId, current => ({
        ...current,
        hostKeyFingerprint: result.fingerprint,
        status: 'ready',
        lastConnectedAt: new Date().toISOString(),
      }))
    } else {
      await this.store.updateTarget(targetId, current => ({
        ...current,
        status: 'ready',
        lastConnectedAt: new Date().toISOString(),
        ...(current.lastError === undefined ? {} : { lastError: undefined as unknown as string }),
      })).catch(() => {})
    }
    this.channels.set(targetId, result.channel)
    await this.store
      .updateTarget(targetId, record => ({ ...record, status: 'ready', lastConnectedAt: new Date().toISOString() }))
      .catch(() => {})
    return result.channel
  }

  /** SHA-256 of the local server entry, compared with the remote handshake digest. */
  async expectedDigest(_targetId: string): Promise<string | undefined> {
    try {
      return createHash('sha256').update(await readFile(join(this.options.packageRoot, 'lib', 'server.js'))).digest('hex')
    } catch {
      // A source checkout without a build has no artifact to compare, so the
      // handshake digest is reported instead of enforced.
      return undefined
    }
  }

  /** Forget a target, its secret, its preset and any live channel. */
  async forgetTarget(targetId: string): Promise<void> {
    const live = this.channels.get(targetId)
    if (live !== undefined) {
      this.channels.delete(targetId)
      await live.close().catch(() => {})
    }
    const browser = this.browsers.get(targetId)
    if (browser !== undefined) {
      this.browsers.delete(targetId)
      await browser.client.close().catch(() => {})
    }
    const dispose = this.presetDisposers.get(remotePresetId(targetId))
    if (dispose !== undefined) {
      this.presetDisposers.delete(remotePresetId(targetId))
      await dispose().catch(() => {})
    }
    // forgetWorkspace (not deleteWorkspace): it also removes the shell
    // 工作区 tree entry and the stub directory — skipping that is exactly how
    // orphaned folder-icon rows lingered in the sidebar after 忘记主机.
    for (const workspace of this.store.listWorkspaces(targetId)) await this.forgetWorkspace(workspace.id)
    await this.store.deleteTarget(targetId)
  }

  /** Close any live channel for a target, leaving its records in place. */
  async stopTarget(targetId: string): Promise<boolean> {
    let stopped = false
    const live = this.channels.get(targetId)
    if (live !== undefined) {
      this.channels.delete(targetId)
      await live.close().catch(() => {})
      stopped = true
    }
    // An explicit 停止 must also retire the browse channel; otherwise the next
    // directory operation would silently rebuild (and restart) what the user
    // just stopped.
    const browser = this.browsers.get(targetId)
    if (browser !== undefined) {
      this.browsers.delete(targetId)
      await browser.client.close().catch(() => {})
      stopped = true
    }
    if (stopped) {
      await this.store
        .updateTarget(targetId, record => ({ ...record, status: 'stopped' }))
        .catch(() => {})
    }
    return stopped
  }

  /** Every public target, newest state first. */
  listTargets(): PublicTarget[] {
    return this.store.listTargets().map(record => publicTarget(record, this.store))
  }

  /** Every stored remote workspace. */
  listWorkspaces(): RemoteWorkspaceRecord[] {
    return this.store.listWorkspaces()
  }

  /** The plugin-wide package-source policy and release mirror. */
  getPackagePolicy(): PackagePolicySettings {
    return this.store.packagePolicy()
  }

  /** Replace the plugin-wide package-source policy. */
  async setPackagePolicy(settings: PackagePolicySettings): Promise<void> {
    await this.store.setPackagePolicy(settings)
  }

  beginConnect(request: ConnectRequest): string {
    const id = randomUUID()
    this.tickets.set(id, {
      id,
      request,
      events: [],
      confirm: undefined,
      fingerprint: undefined,
      closed: false,
    })
    return id
  }

  /** Read a ticket for the SSE stream, or undefined when it expired. */
  ticket(id: string): ConnectTicket | undefined {
    return this.tickets.get(id)
  }

  /** Drop a ticket; an open SSE stream observes `closed`. */
  releaseTicket(id: string): void {
    const ticket = this.tickets.get(id)
    if (ticket === undefined) return
    ticket.closed = true
    ticket.confirm?.(ticket.fingerprint ?? '')
    this.tickets.delete(id)
  }

  /** Resolve a pending host-key confirmation. */
  confirmHostKey(id: string, fingerprint: string): boolean {
    const ticket = this.tickets.get(id)
    if (ticket === undefined || ticket.confirm === undefined) return false
    if (ticket.fingerprint !== fingerprint) return false
    const confirm = ticket.confirm
    ticket.confirm = undefined
    confirm(fingerprint)
    return true
  }

  /**
   * Run one connection attempt, reporting progress.
   * @param id - ticket id.
   * @param emit - sink for progress events (an SSE writer).
   * @returns the stored target on success.
   */
  async runConnect(id: string, emit: (event: ProvisionEvent) => void): Promise<PublicTarget> {
    const ticket = this.tickets.get(id)
    if (ticket === undefined) throw new Error('the connection attempt has expired')
    const request = ticket.request
    const existing = this.store.listTargets().find(record => record.label.toLowerCase() === request.label.toLowerCase())
    const remote: RemoteRuntimeRecord = {
      nodePath: request.remote?.nodePath ?? 'node',
      dshCommand: request.remote?.dshCommand ?? 'dsh',
      profile: request.remote?.profile ?? 'dsh-remote-server',
      dshHome: request.remote?.dshHome ?? '~/.dsh',
      plugins: request.remote?.plugins ?? [],
    }
    let draft: RemoteTargetRecord = {
      id: existing?.id ?? `rt-${randomUUID().slice(0, 8)}`,
      label: request.label,
      kind: 'ssh',
      host: request.host,
      port: request.port,
      username: request.username,
      authKind: request.authKind,
      ...(request.privateKeyPath === undefined ? {} : { privateKeyPath: request.privateKeyPath }),
      ...(request.sshConfigAlias === undefined ? {} : { sshConfigAlias: request.sshConfigAlias }),
      ...(request.packageSource === undefined ? {} : { packageSource: request.packageSource }),
      hostKeyFingerprint: request.hostKeyFingerprint ?? existing?.hostKeyFingerprint ?? '',
      remote,
      status: 'unknown',
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    }
    const privateKey = draft.privateKeyPath === undefined ? undefined : await readPrivateKey(draft.privateKeyPath)
    let fingerprint = draft.hostKeyFingerprint
    let provisioned: Awaited<ReturnType<typeof provisionTarget>> | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        provisioned = await provisionTarget({
          target: draft,
          ...(request.secret === undefined ? {} : { secret: request.secret }),
          ...(privateKey === undefined ? {} : { privateKey }),
          packageRoot: this.options.packageRoot,
          packagePolicy: this.store.packagePolicy(),
          ...(fingerprint === '' ? {} : { hostKeyFingerprint: fingerprint }),
          onEvent: (event: ProvisionEvent) => {
            ticket.events.push(event)
            emit(event)
          },
        })
        break
      } catch (error) {
        if (error instanceof HostKeyUnknownError && attempt === 0) {
          ticket.fingerprint = error.fingerprint
          emit({ type: 'host-key', fingerprint: error.fingerprint })
          const confirmed = await new Promise<string>((resolve) => {
            ticket.confirm = resolve
            if (ticket.closed) resolve('')
          })
          if (ticket.closed || confirmed === '') throw new Error('host key was not confirmed')
          fingerprint = confirmed
          // Trust is durable the moment the user confirms: the pin survives a
          // failed later stage, a retry and a client restart, and the target
          // becomes visible in the saved list even before a success.
          draft = { ...draft, hostKeyFingerprint: fingerprint }
          await this.store.putTarget(draft)
          continue
        }
        throw error
      }
    }
    if (provisioned === undefined) throw new Error('the remote server could not be started')
    // The first successful connection pins the key and stores the secret.
    draft = {
      ...draft,
      hostKeyFingerprint: provisioned.fingerprint === '' ? fingerprint : provisioned.fingerprint,
      status: 'ready',
      lastConnectedAt: new Date().toISOString(),
    }
    if (request.secret !== undefined) draft = await this.store.storeSecret(draft, request.secret)
    else if (existing !== undefined) draft = await this.store.storeSecret(draft, '') as RemoteTargetRecord
    await this.store.putTarget(draft)
    this.channels.set(draft.id, provisioned.channel)
    await this.registerPreset(draft)
    // A successful connection records the alias for next time.
    return publicTarget(draft, this.store)
  }

  /**
   * Run a command on a target over a dedicated SSH connection.
   * @param targetId - stored target.
   * @param command - POSIX command; interpolations must already be quoted.
   * @returns the exit facts and bounded output.
   */
  private async runCommand(targetId: string, command: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const target = this.store.target(targetId)
    if (target === undefined) throw new Error(`unknown remote target "${targetId}"`)
    const secret = await this.store.secretOf(target)
    const privateKey = target.privateKeyPath === undefined ? undefined : await readPrivateKey(target.privateKeyPath)
    const client = await connectSsh({
      host: target.host,
      port: target.port,
      username: target.username,
      auth: authFor(target, secret, privateKey),
      ...(target.hostKeyFingerprint === '' ? {} : { hostKeyFingerprint: target.hostKeyFingerprint }),
    })
    try {
      return await execRemote(client, command, { maxBytes: 256 * 1024, timeoutMs: 20_000 })
    } finally {
      client.end()
    }
  }

  /** Create a directory on a target, for step 4's "new folder". */
  async createDirectory(targetId: string, path: string): Promise<void> {
    if (!path.startsWith('/')) throw new Error('remote directories need an absolute path')
    const result = await this.runCommand(targetId, `mkdir -p ${shellQuote(path)}`)
    if (result.code !== 0) throw new Error(scrubSecrets(result.stderr.trim() || `mkdir failed with exit code ${result.code}`))
  }

  /**
   * List one remote directory through a browsing session.
   * @param targetId - stored target.
   * @param path - absolute remote path.
   * @returns the listing with its parent.
   */
  async listDirectory(targetId: string, path: string): Promise<DirListing> {
    // An empty path means "the target's home" — the server's handshake reports it.
    return await this.withBrowser(targetId, async client => {
      const directory = await client.request(
        'fs.resolve',
        { path: path === '' ? client.home : path },
        targetSchema,
        AbortSignal.timeout(20_000),
      )
      const entries = await client.request('fs.list', { target: directory }, entriesSchema, AbortSignal.timeout(20_000))
      const listing: DirEntry[] = entries
        .map(entry => ({
          name: entry.name,
          type: entry.type,
          path: entry.target.targetKey,
        }))
        .sort((left, right) => (left.type === right.type ? left.name.localeCompare(right.name) : left.type === 'directory' ? -1 : 1))
      const parent = path === '/' ? undefined : leafParent(path)
      return { home: client.home, path: directory.targetKey, ...(parent === undefined ? {} : { parent }), entries: listing }
    })
  }

  /** Discover or create the official remote workspace record for a path. */
  async ensureRemoteWorkspace(targetId: string, path: string, title?: string): Promise<{ id: WorkspaceId; serverId?: string }> {
    return await this.withBrowser(targetId, async client => {
      const schema = z.array(z.object({ id: z.string().length(16), path: z.string(), title: z.string(), sessionCount: z.number(), createdAt: z.string() }))
      const existing = (await client.request('reg.list', {}, schema, AbortSignal.timeout(20_000))).find(item => item.path === path)
      const created = existing ?? await client.request('reg.create', { path, ...(title === undefined ? {} : { title }) }, schema.element, AbortSignal.timeout(20_000))
      return { id: created.id as WorkspaceId, ...(client.serverInfo === undefined ? {} : { serverId: client.serverInfo.serverId }) }
    })
  }

  /**
   * Run one browse operation on the cached session, retrying once on a
   * channel that died while idle: the remote server's lease outlives nothing,
   * so a >leaseMs pause can invalidate the cached client between calls. The
   * retry rebuilds the channel (marker-fast) and the user sees one slow
   * operation instead of an error toast.
   */
  private async withBrowser<T>(targetId: string, operation: (client: RemoteClient) => Promise<T>): Promise<T> {
    try {
      return await operation(await this.browserFor(targetId))
    } catch (first) {
      const entry = this.browsers.get(targetId)
      if (entry === undefined) throw first
      this.browsers.delete(targetId)
      await entry.client.close().catch(() => {})
      return await operation(await this.browserFor(targetId))
    }
  }

  /**
   * Reuse or open the wizard's browsing session for one target.
   *
   * Deliberately NO idle teardown (ZCode parity: `windowRemoteConnectionRegistry`
   * never idle-disposes SSH entries — only its WSL flavour had one). The
   * channel and its remote server live until 停止/忘记/host exit/channel
   * failure; the client heartbeat only renews the process lease.
   */
  private async browserFor(targetId: string): Promise<RemoteClient> {
    const cached = this.browsers.get(targetId)
    if (cached !== undefined) return cached.client
    const channel = await this.connectChannel(targetId)
    const client = await RemoteClient.open(channel, '/', this.options.leaseMs)
    this.browsers.set(targetId, { client })
    return client
  }

  /** stub → remote aliases for every opened workspace of one target. */
  pathAliases(targetId: string): { stub: string; remote: string }[] {
    return this.store
      .listWorkspaces(targetId)
      .filter(record => record.stubPath !== undefined)
      .map(record => ({ stub: record.stubPath as string, remote: record.path }))
  }

  /**
   * Create or resume the workspace record and its session.
   * @param targetId - stored target.
   * @param path - absolute remote directory.
   * @param title - display title; defaults to the last path segment.
   * @returns the workspace record and the session that now runs in it.
   */
  async openWorkspace(targetId: string, path: string, title?: string): Promise<{ workspace: RemoteWorkspaceRecord; sessionId: string }> {
    const target = this.store.target(targetId)
    if (target === undefined) throw new Error(`unknown remote target "${targetId}"`)
    if (!this.channels.has(targetId)) {
      const error = new Error(`remote target "${targetId}" is not connected; connect before creating a session`)
      ;(error as { code?: string }).code = 'not-connected'
      throw error
    }
    // Validate the directory on the remote host before any session exists.
    const listing = await this.listDirectory(targetId, path)
    const existing = this.store.listWorkspaces(targetId).find(record => record.path === listing.path)
    const now = new Date().toISOString()
    const displayTitle = title ?? (listing.path === '/' ? target.label : listing.path.split('/').filter(Boolean).at(-1) ?? target.label)
    const remoteWorkspace = await this.ensureRemoteWorkspace(targetId, listing.path, displayTitle)

    // Anchor the remote path in the shell's workspace tree: official
    // workspaces are local-realpath'd, so a *local stub directory* stands in
    // for the remote path and the tree shows the entry like any local one.
    const registry = (this.ctx as unknown as { workspaceRegistry?: WorkspaceRegistryLike }).workspaceRegistry
    const key = createHash('sha1').update(`${target.id}\u0000${listing.path}`).digest('hex').slice(0, 8)
    const stubRoot = join(homedir(), '.dsh', 'remote-workspaces', target.id)
    const stub = join(stubRoot, key)
    await mkdir(stub, { recursive: true })
    const canonicalStub = await realpath(stub)
    let official = await registry?.resolveByPath(canonicalStub)
    official ??= registry === undefined
      ? undefined
      : await registry.create(canonicalStub, `${displayTitle} · ${target.label}`).catch((error: unknown) => {
          console.error('[dsh-remote-workspace] registering the workspace in the shell tree failed', error)
          return undefined
        })

    const workspace: RemoteWorkspaceRecord = existing === undefined
      ? {
          id: `rw-${randomUUID().slice(0, 8)}`,
          targetId,
          path: listing.path,
          title: displayTitle,
          createdAt: now,
        }
      : existing
    console.error(`[rw] openWorkspace: ensureRemoteWorkspace.id=${remoteWorkspace.id}`)
    const opened = await openRemoteSession(this.ctx, {
      targetId,
      target,
      // The session's shell-side cwd is the stub (official attachSession
      // requires realpath(cwd) === workspace.path); the stub→remote rewrite in
      // the realm connection points every tool call at the real directory.
      path: canonicalStub,
      remoteWorkspaceId: remoteWorkspace.id,
      // No sessionId: opening a workspace always starts a fresh (seeded)
      // session. Adopting the stored one would reuse a pre-fix blank session
      // the shell can never chat in; its history stays in the sidebar.
    })
    await official?.attachSession(opened.sessionId).catch((error: unknown) => {
      console.error('[dsh-remote-workspace] attaching the session to the shell workspace failed', error)
    })
    const stored: RemoteWorkspaceRecord = {
      ...workspace,
      ...(official === undefined ? {} : { stubPath: official.path, officialWorkspaceId: official.id }),
      remoteWorkspaceId: remoteWorkspace.id,
      ...(remoteWorkspace.serverId === undefined ? {} : { serverId: remoteWorkspace.serverId }),
      lastOpenedAt: now,
      sessionId: opened.sessionId,
    }
    await this.store.putWorkspace(stored)
    return { workspace: stored, sessionId: opened.sessionId }
  }

  /** Forget one stored remote workspace record (and its shell-tree entry). */
  async forgetWorkspace(workspaceId: string): Promise<boolean> {
    const record = this.store.workspace(workspaceId)
    const registry = (this.ctx as unknown as { workspaceRegistry?: WorkspaceRegistryLike }).workspaceRegistry
    if (record?.officialWorkspaceId !== undefined) {
      await registry?.delete(record.officialWorkspaceId).catch(() => {})
    }
    if (record?.stubPath !== undefined) {
      await rm(record.stubPath, { recursive: true, force: true }).catch(() => {})
    }
    return await this.store.deleteWorkspace(workspaceId)
  }

  /** Close every channel and browsing session. */
  async dispose(): Promise<void> {
    for (const browser of this.browsers.values()) {
      await browser.client.close().catch(() => {})
    }
    this.browsers.clear()
    for (const channel of this.channels.values()) await channel.close().catch(() => {})
    this.channels.clear()
    for (const ticket of this.tickets.values()) ticket.confirm?.('')
    this.tickets.clear()
  }
}

/** Public projection of a target record, with the stored-secret flag resolved. */
function publicTarget(record: RemoteTargetRecord, store: TargetStore): PublicTarget {
  return {
    id: record.id,
    label: record.label,
    kind: record.kind,
    host: record.host,
    port: record.port,
    username: record.username,
    authKind: record.authKind,
    hasStoredSecret: store.credentialKeyOf(record) !== undefined,
    hostKeyFingerprint: record.hostKeyFingerprint,
    ...(record.sshConfigAlias === undefined ? {} : { sshConfigAlias: record.sshConfigAlias }),
    remote: record.remote,
    status: record.status,
    ...(record.lastError === undefined ? {} : { lastError: scrubSecrets(record.lastError) }),
    ...(record.lastConnectedAt === undefined ? {} : { lastConnectedAt: record.lastConnectedAt }),
  }
}

/** Parent directory of an absolute POSIX path. */
function leafParent(path: string): string | undefined {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path
  const index = trimmed.lastIndexOf('/')
  return index <= 0 ? '/' : trimmed.slice(0, index)
}

/** A channel that already reported itself closed. */
function isClosed(channel: RemoteChannel): boolean {
  return (channel as unknown as { closed?: boolean }).closed === true
}

/** Re-export so the wizard can render failures with the same wording. */
export { HostKeyMismatchError, HostKeyUnknownError }
export type { ProvisionEvent, ProvisionStep }

/** Absolute local plugin package root, derived from this module's location. */
export function packageRootFrom(moduleUrl: string): string {
  return resolvePath(dirname(fileURLToPath(moduleUrl)), '..')
}

/** Convenience used by the plugin row. */
export { join }
