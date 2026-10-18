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
import { normalizeSessionTitle } from '@deepseek-ai/dsh-session-title'
import { remotePresetDefinition, remotePresetId } from '../preset/world.ts'
import { openRemoteSession, resumeRemoteSession } from '../session/open.ts'
import { shellQuote } from './profile.ts'
import { dshReleaseVersion, expandRemoteHome, openTransport, profileDirFor, profileFileSet, provisionTarget, readPrivateKey, type ProvisionEvent, type ProvisionResult, type ProvisionStep } from './channel.ts'
import { artifactTag, describeLocalPackage, platformArch as platformArchOf, sha256OfFiles } from './assets.ts'
import { assembleCandidates, parseDshScanOutput, scanDshScript, scanTools, type DshScanResult } from './dsh-scan.ts'
import { probeFactsFrom, sh } from './deploy.ts'
import type { RemoteTransport } from './transport.ts'
import { methodAvailable } from '../targets/methods.ts'
import { scrubSecrets, type PackagePolicySettings, type PublicTarget, type RemoteAuthKind, type RemoteChannel, type RemotePackageSource, type RemoteRuntimeRecord, type RemoteTargetKind, type RemoteTargetRecord, type RemoteWorkspaceRecord } from '../targets/types.ts'
import { TargetStore } from '../targets/store.ts'
import type { WorkspaceId, RemoteSessionSummary, RemoteSessionTitle, RemoteWorkspaceSummary } from '../protocol.ts'

/**
 * How long a browsing client may sit idle before it is retired.
 *
 * The wizard's directory picker issues several RPCs per navigation, so the
 * client has to survive between them — but a dedicated in-distro `dsh` process
 * must not linger after the user stops browsing (a WSL child keeps the
 * distribution running and holds its own lease). 120s covers a slow browse
 * session and still returns the target to its idle state.
 */
const BROWSE_IDLE_MS = 120_000

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
  /** `ssh` (default) or `wsl`; `wsl` is only accepted on a Windows host. */
  readonly kind?: RemoteTargetKind
  readonly host: string
  readonly port: number
  readonly username: string
  readonly authKind: RemoteAuthKind
  readonly secret?: string
  readonly privateKeyPath?: string
  readonly sshConfigAlias?: string
  readonly hostKeyFingerprint?: string
  /** `wsl` only: the distribution to enter. */
  readonly wslDistro?: string
  /** `wsl` only: the distro user; absent means the distribution's default user. */
  readonly wslUser?: string
  /**
   * How the server package is obtained. `'reuse'` is not a package source: it
   * names the dsh the host already has (`reuseLauncherPath`), so nothing is
   * uploaded for the runtime at all.
   */
  readonly packageSource?: RemotePackageSource
  /** Required when `packageSource` is `'reuse'`. */
  readonly reuseLauncherPath?: string
  readonly remote?: Partial<RemoteRuntimeRecord>
}

/**
 * The wizard's `dsh-scan` request: one host (or distro) plus optional
 * credentials, *before* any target record exists.
 *
 * Everything here is transient. `secret` lives only in this object for the
 * length of the request — it is never stored, never logged, and scrubbed from
 * every error the route returns.
 */
export interface DshScanRequest {
  readonly kind?: RemoteTargetKind
  readonly host?: string
  readonly port?: number
  readonly username?: string
  readonly authKind?: RemoteAuthKind
  /** Password or key passphrase; absent for agent auth / an already-trusted host. */
  readonly secret?: string
  readonly privateKeyPath?: string
  readonly sshConfigAlias?: string
  readonly hostKeyFingerprint?: string
  readonly wslDistro?: string
  readonly wslUser?: string
  /** Profile to inspect for this plugin; defaults to the remote profile name. */
  readonly profile?: string
  /** Remote `DSH_HOME` (`~/.dsh` by default), expanded on the far side. */
  readonly dshHome?: string
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

/** One stored remote session as the panel lists it. */
export interface RemoteSessionEntry {
  readonly id: string
  /** Creation time as stored in the session header (epoch milliseconds). */
  readonly createdAt?: number
  readonly sizeBytes?: number
  /**
   * The session's title, read from the log's latest `session/title` event.
   *
   * Empty/absent when the log carries none (a session that never got far enough
   * to be titled) or when the remote server predates `persist.titles`; the tree
   * then renders the localized 未命名 placeholder, exactly like the shell does.
   */
  readonly title?: string
  /** Time of the log's last event (epoch ms): what the row's time column shows. */
  readonly updatedAt?: number
}

/**
 * Build the one RPC client of a channel.
 *
 * Exported for the conformance suite, which runs the official SSH providers (and
 * this plugin's `ctx.ssh` adapter) against an in-memory transport.
 * @param channel - protocol channel to the remote server.
 * @param workspace - initial remote workspace for `hello`.
 * @param leaseMs - lease offered to the remote server.
 * @returns the attached client.
 */
export async function openRemoteClient(channel: import('../targets/types.ts').RemoteChannel, workspace = '/', leaseMs = 30_000): Promise<RemoteClient> {
  return await RemoteClient.open(channel, workspace, leaseMs)
}

/** A remote directory fully anchored on this machine, ready for a session. */
interface MaterializedWorkspace {
  readonly record: RemoteWorkspaceRecord
  readonly official: OfficialWorkspace | undefined
  /** Canonical local stub directory standing in for the remote path. */
  readonly stub: string
  readonly now: string
}

/**
 * The one RPC client a target has.
 *
 * Exactly **one** multiplexer/peer pair may own a channel: the remote server is
 * a single process holding the session handles and the workspace index in
 * memory, so two peers on one stream would (a) hand `persist.*` calls to a
 * server that cannot see them and (b) steal each other's responses — the realm's
 * `hello` answer landing in this peer's decoder is what killed an idle session
 * (`SSH connection lost` after the lease lapsed). Browsing and the realm both go
 * through the cached instance below.
 */
class RemoteClient {
  private constructor(
    private readonly mux: FrameMux,
    private readonly peer: SshRpcPeer,
    private readonly channel: RemoteChannel,
    readonly home: string,
    readonly serverInfo: { serverId: string; installationId: string; version: string } | undefined,
    private readonly heartbeat: NodeJS.Timeout,
    readonly hello: { readonly hash: string; readonly root: string; readonly workspace: string },
  ) {}

  /**
   * Pin the client while a realm (a live session) is attached.
   *
   * The idle retirement below must not close the peer out from under a running
   * agent: the heartbeat it owns is what keeps the remote server's lease alive
   * between turns.
   */
  pin(): void {
    this.held += 1
  }

  /** Release one pin; idle retirement may resume when the last one is gone. */
  unpin(): void {
    if (this.held > 0) this.held -= 1
  }

  /** Whether an attached realm still needs this client. */
  get pinned(): boolean {
    return this.held > 0
  }

  private held = 0

  /** Attach one authenticated logical stream (official `ctx.ssh.connectStream`). */
  async openStream(endpoint: { readonly path: string }, signal?: AbortSignal): Promise<import('node:net').Socket> {
    const remote = endpoint.path
    if (!remote.startsWith(`${this.hello.root}/`) || /[:\r\n\0]/u.test(remote)) {
      throw new Error('the remote server returned an invalid stream path')
    }
    const stream = await this.mux.open(endpoint as never, signal)
    return stream as unknown as import('node:net').Socket
  }

  static async open(channel: RemoteChannel, workspace: string, leaseMs = 30_000): Promise<RemoteClient> {
    const startedAt = Date.now()
    if (process.env.DSH_RW_DEBUG === '1') console.error(`[dsh-rw] browse attach begin closed=${String((channel as { closed?: boolean }).closed)}`)
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
      if (process.env.DSH_RW_DEBUG === '1') console.error(`[dsh-rw] browse attach hello in +${Date.now() - startedAt}ms`)
      const serverInfo = await peer.request('server.hello', { protocol: 2, clientVersion: '0.1.0-alpha50' }, z.object({
        protocol: z.literal(2), serverId: z.string(), installationId: z.string(), version: z.string(), workspacesRoot: z.string(), home: z.string().optional(),
      }), AbortSignal.timeout(20_000)).catch(() => undefined)
      const client = new RemoteClient(mux, peer, channel, serverInfo?.home ?? hello.workspace, serverInfo, startHeartbeat(), {
        hash: hello.hash,
        root: hello.root,
        workspace: hello.workspace,
      })
      return client
    } catch (error) {
      // The channel is NOT ours: it is the target's single server process and
      // the realm (or another browse caller) may be about to use it. Closing it
      // here used to answer the *next* call with `SSH connection lost` and, on a
      // WSL target, SIGTERM the in-distro server.
      console.error(`[dsh-rw] browse client open failed +${Date.now() - startedAt}ms`,
        error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        `cause=${String((error as { cause?: unknown }).cause)}`,
        `in:ended=${String((channel.input as { readableEnded?: boolean }).readableEnded)} destroyed=${String(channel.input.destroyed)}`,
        `out:destroyed=${String(channel.output.destroyed)} ended=${String((channel.output as { writableEnded?: boolean }).writableEnded)}`,
        String((error as Error).stack).split('\n').slice(1, 4).join(' | '))
      peer.close()
      mux.close()
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

  /**
   * Release this client's own peer.
   *
   * The browsing client deliberately does **not** own the channel: the channel
   * is the target's single server process (its in-memory handles and workspace
   * index are the source of truth for `persist.*`, and a second server process
   * cannot see a session whose log is not flushed yet).
   *
   * `mux.close()` is a *transport* teardown — it destroys the child's stdio — so
   * calling it here killed the very stream the realm and the next browse call
   * needed. That surfaced as `SSH connection lost` at the next attach; the
   * failure diagnostics measured `in.destroyed=true out.destroyed=true`. Only the
   * peer is dropped; the mux dies with the channel.
   */
  async close(): Promise<void> {
    clearInterval(this.heartbeat)
    this.peer.close()
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
  /**
   * Optional: the official registry may expose a rename. It only changes the
   * *display title* of the shell row (the stub directory keeps its name), which
   * is exactly what `workspace-rename` wants — hence the `try/catch` and the
   * optionality rather than a hard dependency.
   */
  rename?(id: string, title: string): Promise<void> | void
}

export class RemoteWorkspaces {
  private readonly tickets = new Map<string, ConnectTicket>()
  private readonly channels = new Map<string, RemoteChannel>()
  private readonly connecting = new Map<string, Promise<RemoteChannel>>()
  private readonly browsers = new Map<string, { client: RemoteClient; idle: NodeJS.Timeout }>()
  /** Serializes browsing operations per target; see {@link withBrowser}. */
  private readonly browserQueue = new Map<string, Promise<void>>()
  /** Serializes resumes per session id; see {@link resumeSession}. */
  private readonly resumeQueue = new Map<string, Promise<void>>()
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
    // Only an ssh2 session has a host key to confirm. A WSL target is a local
    // distribution driven by `wsl.exe`, so an empty fingerprint is its normal
    // state and must not read as "not yet trusted".
    if (target.kind === 'ssh' && target.hostKeyFingerprint === '') {
      throw new Error(`remote target "${target.label}" has no confirmed host key; connect it from the wizard first`)
    }
    const secret = await this.store.secretOf(target)
    const privateKey = target.privateKeyPath === undefined ? undefined : await readPrivateKey(target.privateKeyPath)
    // A tree 连接 of a reuse target has no wizard payload: the remembered
    // launcher is the whole selection.
    const reuseLauncherPath = target.packageSource === 'reuse' ? target.reuseDsh?.path : undefined
    const result = await provisionTarget({
      target,
      ...(secret === undefined ? {} : { secret }),
      ...(privateKey === undefined ? {} : { privateKey }),
      packageRoot: this.options.packageRoot,
      packagePolicy: this.store.packagePolicy(),
      ...(reuseLauncherPath === undefined ? {} : { reuseLauncherPath }),
      ...(signal === undefined ? {} : { signal }),
    })
    // Keep the record's hints current (they are display/next-time values only —
    // every connect measures the architecture again).
    const provisionedAt = new Date().toISOString()
    const hints = provisionedHints(result, provisionedAt)
    if (result.fingerprint !== target.hostKeyFingerprint) {
      await this.store.updateTarget(targetId, current => ({
        ...current,
        hostKeyFingerprint: result.fingerprint,
        status: 'ready',
        lastConnectedAt: provisionedAt,
        ...hints,
      }))
    } else {
      await this.store.updateTarget(targetId, current => ({
        ...current,
        status: 'ready',
        lastConnectedAt: provisionedAt,
        ...hints,
        ...(current.lastError === undefined ? {} : { lastError: undefined as unknown as string }),
      })).catch(() => {})
    }
    this.channels.set(targetId, result.channel)
    // Attach the browsing client immediately: nothing renews this channel's
    // lease between 连接 and the first directory/session operation, and the
    // remote server exits when the lease lapses — which the next operation then
    // reports as `SSH connection lost` (measured: connect → open-workspace one
    // second later failed on a channel whose child was already gone). The
    // client heartbeats every 10 s, so the server now stays up, and the
    // wizard's first list-dir no longer pays a channel build.
    await this.browserFor(targetId).catch(() => {})
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
    await this.retireBrowser(targetId)
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
    if (this.browsers.has(targetId)) {
      await this.retireBrowser(targetId)
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
    // The status is computed, not stored: a restart drops every channel, and a
    // stale persisted 'ready' would show 已连接 for a host nothing is connected
    // to (observed 2026-10-15 on the routing-persistence round).
    return this.store.listTargets().map(record => {
      const live = this.channels.get(record.id)
      const status = live !== undefined && !isClosed(live) ? 'ready' : record.status === 'ready' ? 'stopped' : record.status
      return publicTarget({ ...record, status }, this.store)
    })
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
    const kind: RemoteTargetKind = request.kind ?? 'ssh'
    const wsl = kind === 'wsl'
    // Defence in depth: the route already refuses a `wsl` request off Windows,
    // and the method predicate is the same answer the client gates its card on.
    if (!methodAvailable(wsl ? 'wsl' : 'ssh', process.platform)) {
      throw new Error(`the "${kind}" connection method is not available on ${process.platform}`)
    }
    const distro = (request.wslDistro ?? '').trim()
    if (wsl && distro === '') throw new Error('a WSL target needs a distribution name')
    const existing = this.store.listTargets().find(record => record.label.toLowerCase() === request.label.toLowerCase())
    let draft: RemoteTargetRecord = targetDraftFrom({ request, existing })
    const privateKey = !wsl && draft.privateKeyPath !== undefined ? await readPrivateKey(draft.privateKeyPath) : undefined
    let fingerprint = draft.hostKeyFingerprint
    let provisioned: Awaited<ReturnType<typeof provisionTarget>> | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        provisioned = await provisionTarget({
          target: draft,
          ...(wsl || request.secret === undefined ? {} : { secret: request.secret }),
          ...(privateKey === undefined ? {} : { privateKey }),
          packageRoot: this.options.packageRoot,
          packagePolicy: this.store.packagePolicy(),
          ...(fingerprint === '' ? {} : { hostKeyFingerprint: fingerprint }),
          // Reuse selections travel only here; they are never inferred on the
          // remote side (a wrong guess would start a dsh the user did not pick).
          ...(request.reuseLauncherPath === undefined || request.reuseLauncherPath.trim() === ''
            ? {}
            : { reuseLauncherPath: request.reuseLauncherPath.trim() }),
          onEvent: (event: ProvisionEvent) => {
            ticket.events.push(event)
            emit(event)
          },
        })
        break
      } catch (error) {
        // A WSL target has no host key, so only ssh2 can ask for confirmation.
        if (!wsl && error instanceof HostKeyUnknownError && attempt === 0) {
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
    // The first successful connection pins the key and stores the secret. A WSL
    // target keeps an empty fingerprint forever (there is no key to pin) and
    // never holds a credential.
    const provisionedAt = new Date().toISOString()
    draft = {
      ...draft,
      ...(wsl ? {} : { hostKeyFingerprint: provisioned.fingerprint === '' ? fingerprint : provisioned.fingerprint }),
      status: 'ready',
      lastConnectedAt: provisionedAt,
      // Hints for the wizard/UI only: correctness never reads them back (every
      // connect probes the architecture and re-checks the launcher itself).
      ...provisionedHints(provisioned, provisionedAt),
    }
    if (!wsl) {
      if (request.secret !== undefined) draft = await this.store.storeSecret(draft, request.secret)
      else if (existing !== undefined) draft = await this.store.storeSecret(draft, '') as RemoteTargetRecord
    }
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
    // One throwaway transport per admin command, whatever the target kind —
    // the realm's own channel is not reused for wizard-time browsing.
    const transport = await openTransport({
      target,
      ...(secret === undefined ? {} : { secret }),
      ...(privateKey === undefined ? {} : { privateKey }),
      packageRoot: this.options.packageRoot,
    })
    try {
      return await transport.exec(command, { maxBytes: 256 * 1024, timeoutMs: 20_000 })
    } finally {
      await transport.close().catch(() => {})
    }
  }

  /**
   * The stored target that already stands for the host a scan was asked about.
   *
   * Only used to reuse its pinned host-key fingerprint, so rescanning a known
   * host does not ask the user to trust it again. `undefined` = first contact
   * with this host, and the scan answers `stage: 'host-key'`.
   */
  private storedTargetFor(kind: RemoteTargetKind, request: DshScanRequest): RemoteTargetRecord | undefined {
    const targets = this.store.listTargets()
    if (kind === 'wsl') {
      const distro = (request.wslDistro ?? '').trim()
      return targets.find(record => record.kind === 'wsl' && record.wslDistro === distro)
    }
    const host = (request.host ?? '').trim().toLowerCase()
    const port = request.port ?? 22
    const username = (request.username ?? '').trim()
    return targets.find(record =>
      record.kind === 'ssh' &&
      record.host.toLowerCase() === host &&
      record.port === port &&
      record.username === username,
    )
  }

  /**
   * Scan one host/distro **before** connecting (api-contract §2).
   *
   * Answer two wizard questions with one throwaway transport and one read-only
   * script: which architecture a server package would have to target (plus
   * whether the local cache already holds it), and which dsh launchers exist
   * (plus whether this plugin is installed and current in the target profile).
   *
   * Like {@link runCommand}, nothing here is stored or kept: no channel, no
   * record, no file written on the far side. The host key is *not* pinned —
   * that happens on the first successful connect (`runConnect`); an unconfirmed
   * key answers `stage: 'host-key'` so the wizard shows the same trust panel.
   * @param request - host/distro plus transient credentials.
   * @returns the architecture/package/candidate report, or the fingerprint to confirm.
   */
  async scanDsh(request: DshScanRequest): Promise<DshScanResult> {
    const kind: RemoteTargetKind = request.kind ?? 'ssh'
    const wsl = kind === 'wsl'
    // Same predicate as `connect/start`: a `wsl` scan off Windows is refused, not
    // silently treated as ssh.
    if (!methodAvailable(wsl ? 'wsl' : 'ssh', process.platform)) {
      throw codedError('unsupported', `the "${kind}" connection method is not available on ${process.platform}`)
    }
    const draft = scanDraft(request)
    const where = wsl ? `WSL ${draft.wslDistro ?? ''}` : `${draft.host}:${draft.port}`
    const privateKey = draft.privateKeyPath === undefined
      ? undefined
      : await readPrivateKey(draft.privateKeyPath).catch((error: unknown) => {
          // Only the path may appear in the message — never the key material.
          throw codedError('scan-failed', `cannot read the private key ${draft.privateKeyPath ?? ''}: ${error instanceof Error ? error.message : String(error)}`)
        })
    // A host whose key a stored target already pinned needs no confirmation
    // dance; the pin itself is only ever written by a successful connect.
    const stored = this.storedTargetFor(kind, request)
    const pinned = request.hostKeyFingerprint ?? stored?.hostKeyFingerprint ?? ''
    let transport: RemoteTransport
    try {
      transport = await openTransport({
        target: draft,
        ...(wsl || request.secret === undefined ? {} : { secret: request.secret }),
        ...(privateKey === undefined ? {} : { privateKey }),
        packageRoot: this.options.packageRoot,
        ...(pinned === '' ? {} : { hostKeyFingerprint: pinned }),
      })
    } catch (error) {
      if (!wsl && error instanceof HostKeyUnknownError) return { stage: 'host-key', fingerprint: error.fingerprint }
      throw codedError('scan-failed', `cannot reach ${where}: ${scrubSecrets(error instanceof Error ? error.message : String(error))}`)
    }
    try {
      const configuredHome = (request.dshHome ?? draft.remote.dshHome ?? '').trim()
      const result = await withScanDeadline(
        transport.exec(sh(scanDshScript(configuredHome === '' ? {} : { dshHome: configuredHome })), { maxBytes: 64 * 1024, timeoutMs: 55_000 }),
        SCAN_TIMEOUT_MS,
      )
      if (result.code !== 0) {
        const tail = scrubSecrets(result.stderr.trim().slice(-2000))
        throw codedError('scan-failed', `the dsh scan on ${where} failed (exit ${result.code ?? 'signal'}): ${tail !== '' ? tail : 'no stderr output'}`)
      }
      let scan
      try {
        scan = parseDshScanOutput(result.stdout)
      } catch (error) {
        throw codedError('scan-failed', `the dsh scan on ${where} produced unreadable output: ${error instanceof Error ? error.message : String(error)}`)
      }
      const home = scan.home ?? ''
      if (home === '' || !home.startsWith('/')) {
        throw codedError('scan-failed', `cannot determine the remote home directory on ${where}`)
      }
      // One rule for platform/arch/libc, shared with the pipeline probe.
      const facts = probeFactsFrom({ uname: scan.platform ?? '', machine: scan.machine ?? '', ostype: scan.ostype ?? '', ldd: scan.ldd ?? '' })
      const { platform, arch, libc } = facts
      const tag = artifactTag(platform, arch, libc)
      const dshHome = expandRemoteHome(scan.dshHome ?? configuredHome, home)
      const profile = (request.profile ?? draft.remote.profile).trim()
      // The digest the wizard compares against the installed marker: the exact
      // file set a connect would write, built by the same helper.
      const profileDir = profileDirFor(dshHome, home, profile)
      let expectedPluginSha: string | undefined
      try {
        expectedPluginSha = await sha256OfFiles(await profileFileSet(this.options.packageRoot, profileDir, profile))
      } catch {
        // A source checkout without a build has no lib/ to hash; the candidate
        // list then reports `upToDate: false` rather than failing the scan.
        expectedPluginSha = undefined
      }
      return {
        stage: 'done',
        probe: {
          platform,
          arch,
          libc,
          platformArch: platformArchOf(platform, arch),
          tag,
          home,
          // One mapping from the scan's `TOOL` records (`shasum` ⇒ sha256sum),
          // so the wizard and the pipeline answer "can I verify an artifact here"
          // identically.
          tools: scanTools(scan.tools),
        },
        package: await describeLocalPackage({ version: dshReleaseVersion(this.options.packageRoot), platform, arch, libc }),
        dshHome,
        profiles: scan.profiles.map(entry => entry.name),
        candidates: assembleCandidates(scan, { profile, ...(expectedPluginSha === undefined ? {} : { expectedPluginSha }) }),
      }
    } finally {
      await transport.close().catch(() => {})
    }
  }

  /**
   * Rename one stored remote workspace (api-contract §4, architecture A7).
   *
   * Only the plugin's own `title` changes, plus a best-effort retitle of the
   * shell's row. The remote directory is **never** moved: the remote log headers
   * carry the remote path, and an `mv` across the network has no rollback story.
   * @param workspaceId - the plugin's workspace record id.
   * @param title - raw user input; normalized with the official rules.
   * @returns the updated record.
   */
  async renameWorkspace(workspaceId: string, title: string): Promise<RemoteWorkspaceRecord> {
    const record = this.store.workspace(workspaceId)
    if (record === undefined) throw codedError('not-found', `unknown remote workspace "${workspaceId}"`)
    const normalized = this.normalizeTitle(title)
    if (normalized === '') throw codedError('bad-request', 'workspace title must contain visible characters')
    // Best effort: keep the official shell row in step so a future unhide of our
    // rows cannot show two different names. Swallowed by design — the shell is
    // free not to expose `rename`.
    if (record.officialWorkspaceId !== undefined) {
      const registry = this.ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined
      const label = this.store.target(record.targetId)?.label ?? ''
      const shellTitle = label === '' ? normalized : `${normalized} · ${label}`
      try {
        await registry?.rename?.(record.officialWorkspaceId, shellTitle)
      } catch {}
    }
    return await this.store.updateWorkspace(workspaceId, current => ({ ...current, title: normalized }))
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
   * Run one browse operation on a **dedicated, cached** channel.
   *
   * One `FrameMux`/`SshRpcPeer` pair owns a byte stream, and the realm's
   * `RemoteConnection` installs its own pair on the target's cached channel the
   * moment a session opens. Sharing that channel here therefore put two
   * independent de-multiplexers on one stream — an RPC id collision either side
   * corrupts the other, and the old retry closed the *shared* channel, which on
   * a WSL target kills the in-distro process an agent is using ("SSH connection
   * lost; remote operation outcome and cleanup are unknown").
   *
   * So browsing keeps its **own** client per target: the first operation pays
   * one marker-fast provisioning pass, every later one is a single RPC. It is
   * retired after {@link BROWSE_IDLE_MS} of silence (the remote server also has
   * its own lease), on a failure, on 停止/忘记 and on dispose.
   */
  private async withBrowser<T>(targetId: string, operation: (client: RemoteClient) => Promise<T>): Promise<T> {
    const previous = this.browserQueue.get(targetId) ?? Promise.resolve()
    const attempt = previous.then(async (): Promise<T> => {
      const client = await this.browserFor(targetId)
      try {
        return await operation(client)
      } catch (error) {
        // A cached client can die under us (server lease, WSL distro stopped);
        // drop it and retry the operation once on a fresh one.
        await this.retireBrowser(targetId)
        const retried = await this.browserFor(targetId)
        try {
          return await operation(retried)
        } catch (second) {
          await this.retireBrowser(targetId)
          throw second
        }
      } finally {
        this.touchBrowser(targetId)
      }
    })
    // The queue tail never rejects: a failed call must not poison the next one.
    this.browserQueue.set(targetId, attempt.then(() => undefined, () => undefined))
    return await attempt
  }

  /** Reuse the target's client (browsing and the realm share it). */
  private async browserFor(targetId: string): Promise<RemoteClient> {
    const cached = this.browsers.get(targetId)
    if (cached !== undefined) {
      this.touchBrowser(targetId)
      return cached.client
    }
    const client = await this.openBrowser(targetId)
    const timer = setTimeout(() => { void this.retireBrowser(targetId) }, BROWSE_IDLE_MS)
    timer.unref()
    this.browsers.set(targetId, { client, idle: timer })
    return client
  }

  /**
   * The target's shared client, for the realm-scoped `ctx.ssh` adapter.
   *
   * Pinned for the caller so idle retirement cannot pull the peer out from under
   * a live session; the adapter releases it in `dispose()`.
   * @param targetId - stored target.
   * @returns the one RPC client of this target.
   */
  async remoteClient(targetId: string): Promise<RemoteClient> {
    const client = await this.browserFor(targetId)
    client.pin()
    return client
  }

  /** Drop one pin taken by {@link remoteClient} and restart the idle clock. */
  releaseRemoteClient(targetId: string): void {
    const entry = this.browsers.get(targetId)
    if (entry === undefined) return
    entry.client.unpin()
    this.touchBrowser(targetId)
  }

  /** Restart the idle countdown for one browsing client. */
  private touchBrowser(targetId: string): void {
    const entry = this.browsers.get(targetId)
    if (entry === undefined) return
    clearTimeout(entry.idle)
    const timer = setTimeout(() => { void this.retireBrowser(targetId) }, BROWSE_IDLE_MS)
    timer.unref()
    this.browsers.set(targetId, { client: entry.client, idle: timer })
  }

  /** Close and forget one browsing client; safe when none is cached. */
  private async retireBrowser(targetId: string): Promise<void> {
    const entry = this.browsers.get(targetId)
    if (entry === undefined) return
    // A pinned client belongs to a live session: closing its peer would stop the
    // heartbeats that hold the remote server's lease, and the next turn would
    // answer `SSH connection lost`.
    if (entry.client.pinned) {
      this.touchBrowser(targetId)
      return
    }
    this.browsers.delete(targetId)
    clearTimeout(entry.idle)
    await entry.client.close().catch(() => {})
  }

  /**
   * Attach a browsing client to the target's **single** server channel.
   *
   * One remote server process per target is a hard requirement, not a
   * preference: `persist.create` answers with an in-memory handle and the log
   * stays off disk until it is flushed (`session.lock` only), so a `persist.*`
   * call that lands on a *second* server process answers `session "…" not
   * found`. That is exactly what happened when browsing was given its own
   * transport — `sessionRequest()` goes through this client, so it must reach
   * the same process the realm talks to (`connectChannel`).
   *
   * Consequence: the browsing client never closes the channel (see
   * `RemoteClient.close`); 停止/忘记 close it explicitly.
   * @param targetId - stored target.
   * @returns an open browsing client; owned by {@link browsers} afterwards.
   */
  private async openBrowser(targetId: string): Promise<RemoteClient> {
    const channel = await this.connectChannel(targetId)
    return await RemoteClient.open(channel, '/', this.options.leaseMs)
  }

  /** stub → remote aliases for every opened workspace of one target. */
  pathAliases(targetId: string): { stub: string; remote: string }[] {
    return this.store
      .listWorkspaces(targetId)
      .filter(record => record.stubPath !== undefined)
      .map(record => ({ stub: record.stubPath as string, remote: record.path }))
  }

  /**
   * The local stub a remote workspace is represented by.
   *
   * The routing persistence re-anchors every header it hands out on this path
   * (see `RemotePersistence`): consumers realpath/`stat` a session's cwd, so a
   * remote path would make the session unattachable and unreopenable locally.
   */
  stubForWorkspace(workspaceId: string): string | undefined {
    return this.store
      .listWorkspaces()
      .find(candidate => candidate.remoteWorkspaceId === workspaceId)
      ?.stubPath
  }

  /**
   * Workspaces the *remote* dsh already has registered (`reg.list`).
   *
   * This is the 添加工作区 source for a host whose dsh installation carries the
   * server plugin: every workspace that dsh knows about can be adopted here
   * without browsing the filesystem.
   */
  async listRemoteWorkspaces(targetId: string): Promise<RemoteWorkspaceSummary[]> {
    return await this.withBrowser(targetId, async client =>
      await client.request(
        'reg.list',
        {},
        z.array(z.object({
          id: z.string().length(16),
          path: z.string(),
          title: z.string(),
          sessionCount: z.number(),
          createdAt: z.string(),
        })),
        AbortSignal.timeout(20_000),
      ) as RemoteWorkspaceSummary[])
  }

  /**
   * Sessions stored on the remote server for one workspace (`persist.list`).
   * @param targetId - stored target.
   * @param workspaceRecordId - the plugin's own workspace record id.
   */
  async listRemoteSessions(targetId: string, workspaceRecordId: string): Promise<RemoteSessionEntry[]> {
    const record = this.store.workspace(workspaceRecordId)
    if (record === undefined) throw new Error(`unknown remote workspace "${workspaceRecordId}"`)
    const workspaceId = record.remoteWorkspaceId
    // Never opened on this machine: the remote has no workspace id to list yet.
    if (workspaceId === undefined) return []
    const summaries = await this.sessionRequest<readonly RemoteSessionSummary[]>(
      targetId,
      'persist.list',
      { workspaceId },
    )
    // Titles are a second, additive call: a remote server that predates
    // `persist.titles` still lists sessions, so a failure here degrades the row
    // label (未命名) instead of failing the list.
    const titles = new Map<string, { title: string; updatedAt?: number }>()
    try {
      const rows = await this.sessionRequest<readonly RemoteSessionTitle[]>(
        targetId,
        'persist.titles',
        { workspaceId },
      )
      for (const row of rows) titles.set(String(row.id), { title: row.title, ...(row.updatedAt === undefined ? {} : { updatedAt: row.updatedAt }) })
    } catch {
      // Older server bundle: no titles plane yet.
    }
    return summaries
      .map(summary => {
        const meta = titles.get(String(summary.id))
        return {
          id: String(summary.id),
          ...(summary.createdAt === undefined ? {} : { createdAt: summary.createdAt }),
          ...(summary.sizeBytes === undefined ? {} : { sizeBytes: summary.sizeBytes }),
          ...(meta === undefined || meta.title === '' ? {} : { title: meta.title }),
          ...(meta?.updatedAt === undefined ? {} : { updatedAt: meta.updatedAt }),
        }
      })
      // Newest activity first, like the shell's own session list.
      .sort((left, right) => (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0))
  }

  /** The remote workspace a stub-cwd session belongs to (routing persistence). */
  routeForCwd(cwd: string | undefined): { targetId: string; workspaceId: string } | undefined {
    if (cwd === undefined) return undefined
    const record = this.store
      .listWorkspaces()
      .find(candidate => candidate.stubPath === cwd)
    const workspaceId = record?.remoteWorkspaceId
    if (record === undefined || workspaceId === undefined) return undefined
    return { targetId: record.targetId, workspaceId }
  }

  /**
   * Which remote workspace owns one stored session. Only targets with a live
   * channel are probed: an offline server must not be spun up by a read.
   */
  async locateRemoteSession(sessionId: string): Promise<{ targetId: string; workspaceId: string } | undefined> {
    for (const targetId of this.channels.keys()) {
      try {
        const result = await this.withBrowser(targetId, client => client.request(
          'persist.locate',
          { sessionId },
          z.object({ workspaceId: z.string().nullable() }),
          AbortSignal.timeout(20_000),
        ))
        if (result.workspaceId !== null && result.workspaceId !== '') {
          return { targetId, workspaceId: result.workspaceId }
        }
      } catch {
        // A target that cannot answer is simply not the owner.
      }
    }
    return undefined
  }

  /** One administrative RPC to the target's server (persist.* plane). */
  async sessionRequest<T>(targetId: string, method: string, params: unknown, signal?: AbortSignal): Promise<T> {
    const call = async (): Promise<T> => await this.withBrowser(targetId, async client =>
      await client.request(method, params, z.unknown() as never, signal) as T)
    try {
      return await call()
    } catch (error) {
      // A server restart can lose its workspace index while the client keeps
      // the workspace id (its own store still has the remote path). Re-create
      // the server-side entry once and retry, instead of failing the session.
      const message = error instanceof Error ? error.message : String(error)
      const workspaceId = (params as { workspaceId?: unknown }).workspaceId
      if (!/unknown remote workspace/i.test(message) || typeof workspaceId !== 'string') throw error
      const record = this.store.listWorkspaces(targetId).find(candidate => candidate.remoteWorkspaceId === workspaceId)
      if (record === undefined) throw error
      await this.ensureRemoteWorkspace(targetId, record.path, record.title).catch(() => {})
      return await call()
    }
  }

  /**
   * Create a fresh session in a remote directory.
   * @param targetId - stored target.
   * @param path - absolute remote directory.
   * @param title - display title; defaults to the last path segment.
   * @returns the workspace record and the session that now runs in it.
   */
  async openWorkspace(targetId: string, path: string, title?: string): Promise<{ workspace: RemoteWorkspaceRecord; sessionId: string }> {
    // Before any session exists: the target's remote realm must be registrable.
    // A session that would run in the *local* execution world instead (alpha54,
    // defect B) writes files on this machine under the stub path, so opening one
    // is refused outright rather than degraded.
    await assertRemoteRealm(this.ctx, targetId)
    const target = this.requireConnectedTarget(targetId, 'creating a session')
    // Validate the directory on the remote host before any session exists.
    const listing = await this.listDirectory(targetId, path)
    const materialized = await this.materializeWorkspace(target, listing.path, title)
    const opened = await openSessionInRealm('create', targetId, () => openRemoteSession(this.ctx, {
      targetId,
      // The session's shell-side cwd is the stub (official attachSession
      // requires realpath(cwd) === workspace.path); the stub→remote rewrite in
      // the realm connection points every tool call at the real directory.
      path: materialized.stub,
      // No sessionId: opening a workspace always starts a fresh (seeded)
      // session. Continuing an existing one goes through `resumeSession`.
    }))
    // Post-condition: the live session really was composed with our preset and
    // really carries the realm's `ssh`. Nothing user-visible has happened yet
    // (the shell has not attached it), so failing here still prevents the
    // silent-local-execution state.
    assertRealmComposed(this.ctx, targetId, opened.sessionId)
    return await this.finishOpen(materialized, opened.sessionId)
  }

  /**
   * Adopt one *stored* remote session — the 换设备续聊 path.
   *
   * Nothing is seeded: the authoritative log lives on the remote server and the
   * official resume flow reads it back through the routing persistence. The
   * workspace record (and its stub) must exist first, because the resumed
   * header is re-anchored on that stub and the official workspace validates it
   * against its own path.
   *
   * @param targetId - stored target.
   * @param path - absolute remote workspace directory.
   * @param sessionId - stored remote session id.
   * @param title - display title; defaults to the last path segment.
   */
  async resumeSession(targetId: string, path: string, sessionId: string, title?: string): Promise<{ workspace: RemoteWorkspaceRecord; sessionId: string }> {
    // One resume per session at a time. Two concurrent resumes both pass the
    // "is it already live?" check and then race the same write claim; the
    // second one loses (`already owned by an active write handle`) and the
    // failure lands on a *turn* in a conversation that was actually working.
    // Queued, the second call finds the session live and returns immediately.
    const previous = this.resumeQueue.get(sessionId) ?? Promise.resolve()
    const attempt = previous.then(
      async () => await this.resumeSessionOnce(targetId, path, sessionId, title),
      async () => await this.resumeSessionOnce(targetId, path, sessionId, title),
    )
    // The queue tail never rejects: a failed resume must not poison the next.
    const tail = attempt.then(() => undefined, () => undefined)
    this.resumeQueue.set(sessionId, tail)
    try {
      return await attempt
    } finally {
      if (this.resumeQueue.get(sessionId) === tail) this.resumeQueue.delete(sessionId)
    }
  }

  private async resumeSessionOnce(targetId: string, path: string, sessionId: string, title?: string): Promise<{ workspace: RemoteWorkspaceRecord; sessionId: string }> {
    // Same gate as `openWorkspace`, plus the live-session case: a stored remote
    // session can already be *live* because the shell opened it through its own
    // row (the hidden official one under the stub workspace), which composes the
    // shipped preset and never mounts our realm. `resumeRemoteSession` then
    // returns that agent as-is, so the check has to happen before the call.
    await assertRemoteRealm(this.ctx, targetId)
    assertLiveSessionInRealm(this.ctx, targetId, sessionId)
    const target = this.requireConnectedTarget(targetId, 'continuing a session')
    const listing = await this.listDirectory(targetId, path)
    const materialized = await this.materializeWorkspace(target, listing.path, title)
    const opened = await openSessionInRealm('resume', targetId, () => resumeRemoteSession(this.ctx, { targetId, sessionId }))
    assertRealmComposed(this.ctx, targetId, opened.sessionId)
    return await this.finishOpen(materialized, opened.sessionId)
  }

  /** A target that must already have a live channel before a session can exist. */
  private requireConnectedTarget(targetId: string, action: string): RemoteTargetRecord {
    const target = this.store.target(targetId)
    if (target === undefined) throw new Error(`unknown remote target "${targetId}"`)
    if (!this.channels.has(targetId)) {
      const error = new Error(`remote target "${targetId}" is not connected; connect before ${action}`)
      ;(error as { code?: string }).code = 'not-connected'
      throw error
    }
    return target
  }

  /**
   * Everything a session needs to exist for a remote directory: the server-side
   * workspace entry, the local stub directory, the shell-tree workspace and the
   * plugin's own record — in that order, and **persisted before any session is
   * created** (the routing persistence resolves `create(header.cwd)` and
   * re-anchors `open()` headers through this record, so an unmaterialized stub
   * would leave the session unroutable).
   */
  private async materializeWorkspace(target: RemoteTargetRecord, path: string, title?: string): Promise<MaterializedWorkspace> {
    const existing = this.store.listWorkspaces(target.id).find(record => record.path === path)
    const now = new Date().toISOString()
    const displayTitle = title ?? (path === '/' ? target.label : path.split('/').filter(Boolean).at(-1) ?? target.label)
    const remoteWorkspace = await this.ensureRemoteWorkspace(target.id, path, displayTitle)

    // Anchor the remote path in the shell's workspace tree: official
    // workspaces are local-realpath'd, so a *local stub directory* stands in
    // for the remote path and the tree shows the entry like any local one.
    // `ctx.get`, not `ctx.workspaceRegistry`: property access on a cordis context
    // requires the service in `inject`, and the plugin deliberately does not
    // inject workspaceRegistry (that edge deadlocks against sessionPersistence).
    const registry = this.ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined
    const key = createHash('sha1').update(`${target.id}\u0000${path}`).digest('hex').slice(0, 8)
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

    const base: RemoteWorkspaceRecord = existing === undefined
      ? {
          id: `rw-${randomUUID().slice(0, 8)}`,
          targetId: target.id,
          path,
          title: displayTitle,
          createdAt: now,
        }
      : existing
    const record: RemoteWorkspaceRecord = {
      ...base,
      ...(official === undefined ? {} : { stubPath: official.path, officialWorkspaceId: official.id }),
      remoteWorkspaceId: remoteWorkspace.id,
      ...(remoteWorkspace.serverId === undefined ? {} : { serverId: remoteWorkspace.serverId }),
    }
    await this.store.putWorkspace(record)
    return { record, official, stub: canonicalStub, now }
  }

  /** Attach the session to the shell workspace, remember it, and report it back. */
  private async finishOpen(materialized: MaterializedWorkspace, sessionId: string): Promise<{ workspace: RemoteWorkspaceRecord; sessionId: string }> {
    await materialized.official?.attachSession(sessionId).catch((error: unknown) => {
      console.error('[dsh-remote-workspace] attaching the session to the shell workspace failed', error)
    })
    const stored: RemoteWorkspaceRecord = {
      ...materialized.record,
      lastOpenedAt: materialized.now,
      sessionId,
    }
    await this.store.putWorkspace(stored)
    return { workspace: stored, sessionId }
  }

  /**
   * Rename one stored remote session.
   *
   * **No session is opened.** The official rename is one `session/title` append
   * with `source: {kind:'user'}`; the shell's title service is session-scoped, so
   * it needs a live session, but on the remote plane the log is appendable
   * directly — so this normalizes the text with the official normalizer and asks
   * the target's server to append the event (`persist.rename`). Nothing is
   * resumed, no agent is created, and no conversation is revealed.
   *
   * The one case that does go through the title service is a session that is
   * *already live in this process*: it holds the log's write lease, so the
   * server would refuse the open, and the in-memory session is the right place
   * to append anyway.
   *
   * @param targetId - stored target.
   * @param path - absolute remote workspace directory.
   * @param sessionId - stored remote session id.
   * @param title - raw user input; normalized here.
   */
  async renameSession(targetId: string, path: string, sessionId: string, title: string): Promise<void> {
    const normalized = this.normalizeTitle(title)
    if (normalized === '') throw new Error('session title must contain visible characters')

    const liveSessions = this.ctx.get('sessions') as {
      get(id: string): unknown
      flush?(session: never): Promise<boolean>
    } | undefined
    const live = liveSessions?.get(sessionId)
    if (live !== undefined) {
      const titles = this.ctx.get('sessionTitle') as { rename(session: never, title: string): unknown } | undefined
      if (titles === undefined) throw new Error('the session title service is unavailable')
      titles.rename(live as never, normalized)
      await liveSessions?.flush?.(live as never).catch(() => {})
      return
    }

    // Not live: append straight to the stored log, without opening anything.
    this.requireConnectedTarget(targetId, 'renaming a session')
    const workspaceId = await this.remoteWorkspaceIdFor(targetId, path)
    await this.sessionRequest(targetId, 'persist.rename', { workspaceId, sessionId, title: normalized })
  }

  /** Normalize user title text with the official normalizer (same rules, same cap). */
  private normalizeTitle(title: string): string {
    const titles = this.ctx.get('sessionTitle') as { config?: { maxTitleBytes?: number } } | undefined
    const maxBytes = titles?.config?.maxTitleBytes ?? 200
    return normalizeSessionTitle(title, maxBytes)
  }

  /**
   * The server-side workspace id for one remote directory, discovering the
   * workspace when this machine has never opened it (no stub, no session).
   */
  private async remoteWorkspaceIdFor(targetId: string, path: string): Promise<WorkspaceId> {
    const record = this.store.listWorkspaces(targetId).find(candidate => candidate.path === path)
    if (record?.remoteWorkspaceId !== undefined) return record.remoteWorkspaceId as WorkspaceId
    const listing = await this.listDirectory(targetId, path)
    const discovered = await this.ensureRemoteWorkspace(targetId, listing.path)
    return discovered.id
  }

  /**
   * Pin/unpin or archive/unarchive one stored session of a remote workspace.
   *
   * Both sets live on the plugin's own workspace record (see
   * `RemoteWorkspaceRecord.pinnedSessions`): the shell's registry-global sets
   * cannot hold a remote session, because its pin/archive APIs resolve the id
   * against the local session index and answer `session/not-found`.
   *
   * @param workspaceId - the plugin's workspace record id.
   * @param sessionId - the stored remote session id.
   * @param flag - which set to change.
   * @param on - add (`true`) or drop (`false`) the id.
   * @returns the updated record.
   */
  async setSessionFlag(workspaceId: string, sessionId: string, flag: 'pinned' | 'archived', on: boolean): Promise<RemoteWorkspaceRecord> {
    const record = this.store.workspace(workspaceId)
    if (record === undefined) throw new Error(`unknown remote workspace "${workspaceId}"`)
    const key = flag === 'pinned' ? 'pinnedSessions' : 'archivedSessions'
    const current = record[key] ?? []
    const next = on
      // A fresh pin leads; a fresh archive trails (the shell shows archived
      // rows last, and its pin set is "most recently pinned first").
      ? (flag === 'pinned' ? [sessionId, ...current.filter(id => id !== sessionId)] : [...current.filter(id => id !== sessionId), sessionId])
      : current.filter(id => id !== sessionId)
    // The two sets are mutually exclusive, exactly like the shell's: pinning an
    // archived session unarchives it and vice versa.
    const otherKey = flag === 'pinned' ? 'archivedSessions' : 'pinnedSessions'
    const other = (record[otherKey] ?? []).filter(id => id !== sessionId)
    const updated: RemoteWorkspaceRecord = {
      ...record,
      [key]: next.length === 0 ? undefined : next,
      [otherKey]: other.length === 0 ? undefined : other,
    }
    await this.store.putWorkspace(updated)
    return updated
  }

  /** Forget one stored remote workspace record (and its shell-tree entry). */
  async forgetWorkspace(workspaceId: string): Promise<boolean> {
    const record = this.store.workspace(workspaceId)
    // `ctx.get`, not `ctx.workspaceRegistry`: property access on a cordis context
    // requires the service in `inject`, and the plugin deliberately does not
    // inject workspaceRegistry (that edge deadlocks against sessionPersistence).
    const registry = this.ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined
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
    for (const targetId of [...this.browsers.keys()]) await this.retireBrowser(targetId)
    for (const channel of this.channels.values()) await channel.close().catch(() => {})
    this.channels.clear()
    for (const ticket of this.tickets.values()) ticket.confirm?.('')
    this.tickets.clear()
  }
}

/**
 * Build (or rebuild) the target record a connect attempt runs against.
 *
 * Extracted from `runConnect` and exported so its precedence rules are unit-tested
 * instead of only observable through a live connect. The rule that matters:
 *
 * **an absent request field never resets what the record already holds.** The
 * record is rebuilt from the wizard payload on every connect, so
 * `request.remote?.x ?? default` silently threw away a configured `dshHome`
 * (`DSH_HOME` decides where remote sessions live, so a reset makes history look
 * lost) along with `profile`/`nodePath`/`dshCommand`/`plugins`. The order is
 * request → existing record → default, and an explicitly sent value still wins.
 * @param options - the wire request, the record found by label (if any) and the clock/id seams.
 */
export function targetDraftFrom(options: {
  readonly request: ConnectRequest
  readonly existing?: RemoteTargetRecord
  /** ISO timestamp for a brand-new record; defaults to now. */
  readonly now?: string
  /** Id for a brand-new record; defaults to a fresh `rt-…`. */
  readonly id?: string
}): RemoteTargetRecord {
  const { request, existing } = options
  const kind: RemoteTargetKind = request.kind ?? 'ssh'
  const wsl = kind === 'wsl'
  const distro = (request.wslDistro ?? '').trim()
  if (wsl && distro === '') throw new Error('a WSL target needs a distribution name')
  const remote: RemoteRuntimeRecord = {
    // request → existing record → default: see the note above about `dshHome`.
    nodePath: request.remote?.nodePath ?? existing?.remote.nodePath ?? 'node',
    dshCommand: request.remote?.dshCommand ?? existing?.remote.dshCommand ?? 'dsh',
    profile: request.remote?.profile ?? existing?.remote.profile ?? 'dsh-remote-server',
    dshHome: request.remote?.dshHome ?? existing?.remote.dshHome ?? '~/.dsh',
    plugins: request.remote?.plugins ?? existing?.remote.plugins ?? [],
  }
  return {
    id: existing?.id ?? options.id ?? `rt-${randomUUID().slice(0, 8)}`,
    label: request.label,
    kind,
    // A WSL target is identified by its distribution; `host` mirrors it so a
    // row/preview never has to special-case an empty string.
    host: wsl ? distro : request.host,
    port: wsl ? 22 : request.port,
    // `username` is schema-required and unused by the WSL transport; the
    // distro user (when given) is what the shell runs as.
    username: wsl ? (request.wslUser ?? 'default') : request.username,
    authKind: wsl ? 'agent' : request.authKind,
    ...(wsl
      ? { wslDistro: distro, ...(request.wslUser === undefined ? {} : { wslUser: request.wslUser }) }
      : {
          ...(request.privateKeyPath === undefined ? {} : { privateKeyPath: request.privateKeyPath }),
          ...(request.sshConfigAlias === undefined ? {} : { sshConfigAlias: request.sshConfigAlias }),
        }),
    ...(request.packageSource === undefined ? {} : { packageSource: request.packageSource }),
    // Hints from an earlier run survive a reconnect: without this a wizard
    // re-connect would forget which dsh the user chose (and a remembered
    // `packageSource: 'reuse'` would then have no launcher).
    ...(existing?.reuseDsh === undefined ? {} : { reuseDsh: existing.reuseDsh }),
    ...(existing?.platformProbe === undefined ? {} : { platformProbe: existing.platformProbe }),
    ...(existing?.serverPackage === undefined ? {} : { serverPackage: existing.serverPackage }),
    // A local distribution has no host key at all; ssh keeps the pinned one.
    hostKeyFingerprint: wsl ? '' : request.hostKeyFingerprint ?? existing?.hostKeyFingerprint ?? '',
    remote,
    status: 'unknown',
    createdAt: existing?.createdAt ?? options.now ?? new Date().toISOString(),
  }
}

/**
 * The record fields one successful provisioning pass produces.
 *
 * Pure, and shared by both connect paths (`runConnect` from the wizard,
 * `connectOnce` from the tree) so a hint can never be written by one and
 * forgotten by the other. `serverPackage` has a producer *here* specifically:
 * it sat in the schema with nobody ever writing it (F1).
 * @param result - the provisioning outcome.
 * @param connectedAt - ISO timestamp of this connection.
 */
export function provisionedHints(
  result: Pick<ProvisionResult, 'probe' | 'reuse' | 'package'>,
  connectedAt: string,
): Pick<RemoteTargetRecord, 'platformProbe' | 'reuseDsh' | 'serverPackage'> {
  return {
    platformProbe: { ...result.probe, probedAt: connectedAt },
    ...(result.reuse === undefined
      ? {}
      : {
          reuseDsh: {
            path: result.reuse.path,
            version: result.reuse.version,
            ...(result.reuse.nodePath === undefined ? {} : { nodePath: result.reuse.nodePath }),
            scannedAt: connectedAt,
          },
        }),
    // Reuse ships no archive, so no package is recorded rather than a hollow one.
    ...(result.package === undefined ? {} : { serverPackage: result.package }),
  }
}

/** Public projection of a target record, with the stored-secret flag resolved. */
export function publicTarget(record: RemoteTargetRecord, store: TargetStore): PublicTarget {
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
    ...(record.wslDistro === undefined ? {} : { wslDistro: record.wslDistro }),
    ...(record.wslUser === undefined ? {} : { wslUser: record.wslUser }),
    ...(record.packageSource === undefined ? {} : { packageSource: record.packageSource }),
    ...(record.reuseDsh === undefined ? {} : { reuseDsh: record.reuseDsh }),
    ...(record.platformProbe === undefined ? {} : { platformProbe: record.platformProbe }),
    ...(record.serverPackage === undefined ? {} : { serverPackage: record.serverPackage }),
    remote: record.remote,
    status: record.status,
    ...(record.lastError === undefined ? {} : { lastError: scrubSecrets(record.lastError) }),
    ...(record.lastConnectedAt === undefined ? {} : { lastConnectedAt: record.lastConnectedAt }),
  }
}

/** The scan's overall budget (api-contract §2.4: `scan-timeout` past 60 s). */
const SCAN_TIMEOUT_MS = 60_000

/**
 * The preset-registry face the realm guards below use.
 *
 * Structural on purpose (`ctx.get('agentPresets')`), so a test can hand in a
 * fake without constructing a cordis tree.
 */
interface PresetRegistryLike {
  resolve(id: string): Promise<{ readonly id: string; readonly broken?: string }>
  composedPreset(ctx: Context): string | undefined
  serviceFor(agent: { ctx: Context }, name: string): unknown
}

/** The agent registry face the guards need. */
interface AgentRegistryLike {
  get(id: string): unknown
}

/** `ctx.get` a service by name, typed loosely. */
function serviceOf<T>(ctx: Context, name: string): T | undefined {
  return ctx.get(name as never) as T | undefined
}

/**
 * Refuse to open a remote session unless the target's realm preset is registered
 * and usable.
 *
 * Alpha54, defect B: an older connection's session ended up composed with the
 * **shipped** preset — the model got the local `pwsh` tool, `pwd` answered the
 * local stub directory and the proof file was written on *this* machine while the
 * remote never saw it. A remote workspace whose realm is missing must fail
 * loudly; silently running on the local world is the one outcome that must not
 * happen, because it looks like success.
 * @param ctx - host context.
 * @param targetId - stored target; its preset id is derived, never guessed.
 * @returns the preset id that was verified.
 */
export async function assertRemoteRealm(ctx: Context, targetId: string): Promise<string> {
  const presetId = remotePresetId(targetId)
  const presets = serviceOf<PresetRegistryLike>(ctx, 'agentPresets')
  if (presets === undefined) {
    throw codedError('realm-unavailable', `remote workspace "${targetId}": the agent preset registry is not available, so preset "${presetId}" cannot be mounted; refusing to open a session that would run on this machine`)
  }
  let resolved: { id: string; broken?: string }
  try {
    resolved = await presets.resolve(presetId)
  } catch (error) {
    throw codedError('realm-unavailable', `remote workspace "${targetId}": preset "${presetId}" is not registered (${errorReason(error)}); reconnect the target so its execution world is restored`)
  }
  if (resolved.id !== presetId) {
    // `resolve` throws for unknown ids today; pin it anyway, because a silent
    // substitution with the default (local) preset is exactly defect B.
    throw codedError('realm-unavailable', `remote workspace "${targetId}": preset "${presetId}" resolved to "${resolved.id}"; refusing to open a session in a different execution world`)
  }
  if (resolved.broken !== undefined) {
    throw codedError('realm-unavailable', `remote workspace "${targetId}": preset "${presetId}" failed to activate: ${resolved.broken}; reconnect the target and try again`)
  }
  return presetId
}

/**
 * Refuse to *resume* a session that is already live in this process but composed
 * with another preset.
 *
 * This is the second half of defect B: `resumeRemoteSession` returns a live agent
 * as-is (it must — resuming twice collides on the write lease), so a session the
 * shell opened locally through its own row would be handed back as if it were a
 * remote session.
 * @param ctx - host context.
 * @param targetId - stored target.
 * @param sessionId - the session about to be resumed.
 */
export function assertLiveSessionInRealm(ctx: Context, targetId: string, sessionId: string): void {
  const live = serviceOf<AgentRegistryLike>(ctx, 'agents')?.get(sessionId) as { ctx?: Context } | undefined
  if (live === undefined || live.ctx === undefined) return
  const composed = serviceOf<PresetRegistryLike>(ctx, 'agentPresets')?.composedPreset(live.ctx)
  const expected = remotePresetId(targetId)
  if (composed !== expected) {
    throw codedError(
      'realm-unavailable',
      `remote workspace "${targetId}": session "${sessionId}" is already live with preset "${composed ?? '(none)'}" instead of "${expected}", so its tools run on this machine instead of the remote host; close that session and reconnect the target`,
    )
  }
}

/**
 * Verify a just-created/resumed session really runs in the remote realm.
 * @param ctx - host context.
 * @param targetId - stored target.
 * @param sessionId - the session that was just composed.
 */
export function assertRealmComposed(ctx: Context, targetId: string, sessionId: string): void {
  const presets = serviceOf<PresetRegistryLike>(ctx, 'agentPresets')
  const live = serviceOf<AgentRegistryLike>(ctx, 'agents')?.get(sessionId) as { ctx?: Context } | undefined
  if (presets === undefined || live?.ctx === undefined) return
  const expected = remotePresetId(targetId)
  const composed = presets.composedPreset(live.ctx)
  const realmSsh = presets.serviceFor({ ctx: live.ctx }, 'ssh')
  if (composed !== expected || realmSsh === undefined) {
    throw codedError(
      'realm-unavailable',
      `remote workspace "${targetId}": session "${sessionId}" was composed with preset "${composed ?? '(none)'}" and no realm ssh service, so it would run on this machine; refusing to use it`,
    )
  }
}

/**
 * Run one session open/resume, adding the target, the preset id and the original
 * cause to a mount failure.
 *
 * `presets.mount()` failures surface from `agents.create/resume` as whatever the
 * preset loader threw; without this wrapper the user sees an error that names
 * neither the target nor the preset (alpha54, defect B).
 * @param action - which flow failed, for the message.
 * @param targetId - stored target.
 * @param work - the open/resume call.
 */
export async function openSessionInRealm<T>(action: 'create' | 'resume', targetId: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw codedError(
      'realm-unavailable',
      `remote workspace "${targetId}": mounting preset "${remotePresetId(targetId)}" failed while ${action === 'create' ? 'creating' : 'resuming'} the session: ${errorReason(error)}`,
    )
  }
}

/** The most informative line an unknown error can give (never empty). */
function errorReason(error: unknown): string {
  if (error instanceof Error) return error.message !== '' ? error.message : error.name
  return String(error)
}


/** An error carrying the code the route maps to an HTTP status (api-contract §10). */
function codedError(code: string, message: string): Error {
  const error = new Error(scrubSecrets(message))
  ;(error as { code?: string }).code = code
  return error
}

/** Reject with `scan-timeout` when one scan pass outlives its budget. */
async function withScanDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(codedError('scan-timeout', 'the dsh scan did not finish within 60 s')), Math.max(1_000, ms))
        timer.unref()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * The transient target record a scan runs against.
 *
 * A scan happens *before* any record exists (that is the point of the wizard
 * step), so the transport is handed a draft that is never stored — and it carries
 * nothing but addressing: no credential reference, no secret.
 */
function scanDraft(request: DshScanRequest): RemoteTargetRecord {
  const kind: RemoteTargetKind = request.kind ?? 'ssh'
  const wsl = kind === 'wsl'
  const distro = (request.wslDistro ?? '').trim()
  const profile = (request.profile ?? '').trim()
  const dshHome = (request.dshHome ?? '').trim()
  return {
    id: `scan-${randomUUID().slice(0, 8)}`,
    label: wsl ? distro : (request.host ?? '').trim(),
    kind,
    host: wsl ? distro : (request.host ?? '').trim(),
    port: wsl ? 22 : (request.port ?? 22),
    username: wsl ? (request.wslUser ?? 'default') : (request.username ?? ''),
    authKind: wsl ? 'agent' : (request.authKind ?? 'agent'),
    ...(wsl
      ? { wslDistro: distro, ...(request.wslUser === undefined ? {} : { wslUser: request.wslUser }) }
      : {
          ...(request.privateKeyPath === undefined ? {} : { privateKeyPath: request.privateKeyPath }),
          ...(request.sshConfigAlias === undefined ? {} : { sshConfigAlias: request.sshConfigAlias }),
        }),
    hostKeyFingerprint: wsl ? '' : (request.hostKeyFingerprint ?? ''),
    remote: {
      nodePath: 'node',
      dshCommand: 'dsh',
      profile: profile === '' ? 'dsh-remote-server' : profile,
      dshHome: dshHome === '' ? '~/.dsh' : dshHome,
      plugins: [],
    },
    status: 'unknown',
    createdAt: new Date().toISOString(),
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
