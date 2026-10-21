/**
 * The host-plane `remoteWorkspaces` service.
 *
 * It owns everything the realm must not see: `ssh2`, host-key decisions, profile
 * provisioning, the wizard's progress stream, the target and workspace records,
 * preset registration, and session creation with a remote working directory.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises'
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
import { REMOTE_SESSION_PROTOCOL, type WorkspaceId, type RemoteSessionSummary, type RemoteSessionTitle, type RemoteWorkspaceSummary } from '../protocol.ts'

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

/**
 * Largest log worth reading to decide whether a session is still a draft.
 *
 * A freshly opened draft is a handful of events: `session`, `permission/preset`,
 * `sandbox/mode`, `approval/policy` — about 324 B, and it carries no `turn/start`.
 * Once a turn starts the title service writes a title with it, so the session stops
 * being a scan candidate anyway; this ceiling only keeps a pathological
 * untitled-but-huge log from being read over SSH. Past it the answer is
 * `draft = false`, which only ever shows a row we would otherwise hide.
 */
const DRAFT_SCAN_MAX_BYTES = 262_144

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

/**
 * One `reg.list` / `reg.create` item, parsed tolerantly (contract §14.1).
 *
 * `createdAt`/`sessionCount` are optional in the wire contract, and `updatedAt`
 * exists only with `includeActivity: true` — so a row must never be dropped (or
 * the whole call failed) just because a server of another version left one out.
 */
const workspaceSummarySchema = z.object({
  id: z.string().length(16),
  path: z.string(),
  title: z.string(),
  createdAt: z.string().optional(),
  sessionCount: z.number().optional(),
  updatedAt: z.string().optional(),
})

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
  /**
   * The session is a **saved draft**, not a conversation: its log has no
   * `turn/start`, which is the official definition of a blank session.
   *
   * Present only when true — an absent field means "not a draft" (or that the check
   * could not be read, which degrades to the same thing). The tree keeps drafts
   * out of the session rows but shows the open one as a temporary 新会话 row, so a
   * draft is reusable without ever posing as a conversation.
   */
  readonly draft?: boolean
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
      // Protocol v3 (doc/api-contract.md §14.4): the server speaks 3 and rejects
      // a 2 client with a readable sentence. A mismatch is surfaced, never
      // silently downgraded — a downgraded client would turn `reg.rename` into a
      // fake success/failure.
      const serverInfo = await peer.request('server.hello', { protocol: REMOTE_SESSION_PROTOCOL, clientVersion: '0.1.0-alpha50' }, z.object({
        protocol: z.literal(REMOTE_SESSION_PROTOCOL), serverId: z.string(), installationId: z.string(), version: z.string(), workspacesRoot: z.string(), home: z.string().optional(),
      }), AbortSignal.timeout(20_000)).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        if (/unsupported remote session protocol/i.test(message)) {
          throw codedError(
            'server-protocol-mismatch',
            `${message}; the remote server plugin is older than this client — reconnect the target (the plugin is redeployed automatically) or use 「上传 server 包」`,
          )
        }
        // Any other failure keeps the old tolerant behaviour: the browsing plane
        // works without `server.hello` (a server that predates it).
        return undefined
      })
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
  /**
   * Connect + provision pipeline. A seam for tests that must prove nothing is
   * written when a connection fails; production always uses {@link provisionTarget}.
   */
  readonly provision?: typeof provisionTarget
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
  /**
   * The official registry's `resolveByPath` is **async**.
   *
   * Declared as possibly-async on purpose: alpha57 shipped without `await` here,
   * so `entry` was a Promise, `entry.id` was `undefined`, and the Gate 0 sweep
   * answered `removed: [null, null]` while deleting nothing. With this type a
   * missing `await` is a compile error instead of a silent no-op.
   */
  resolveByPath(path: string): OfficialWorkspace | undefined | Promise<OfficialWorkspace | undefined>
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
  /**
   * Draft verdicts by `targetId \0 workspaceId \0 sessionId`, keyed on log size.
   *
   * Same idea as a title memo: a session's log only ever grows, so the stored
   * `sizeBytes` is the version stamp — the first message changes it and the entry
   * is recomputed on the next list. Only *successful* reads are stored, so a
   * transient channel failure is retried rather than remembered as "not a draft".
   */
  private readonly draftCache = new Map<string, { readonly sizeBytes: number | undefined; readonly draft: boolean }>()
  /** Per-target `reg.list` cache (memory only, ≤ SERVER_LIST_TTL_MS; architecture A38). */
  private readonly serverWorkspaceCache = new Map<string, { readonly items: readonly RemoteWorkspaceSummary[]; readonly at: number }>()
  /** Remote path per `${targetId}\0${remoteWorkspaceId}`, for the realm's stub→remote alias. */
  private readonly workspacePaths = new Map<string, string>()
  private readonly options: Required<RemoteWorkspacesOptions>
  private bootstrap: Promise<void> | undefined
  /** Set once a shell-row sweep actually ran in this process (see `scrubShellWorkspacesOnce`). */
  private sweptShellWorkspaces = false
  /** The in-flight sweep, shared by concurrent callers. */
  private sweepingShellWorkspaces: Promise<{ removed: string[]; kept: string[] }> | undefined

  constructor(private readonly ctx: Context, private readonly store: TargetStore, options: RemoteWorkspacesOptions) {
    this.options = { browseIdleMs: 0, provision: provisionTarget, ...options }
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
    // A record can predate the "persist only after success" rule (or its
    // credential can be gone from the store). Refuse before opening a socket so
    // the row gets an actionable `secret-missing` instead of a raw ssh2 failure.
    if (target.authKind === 'password' && (secret === undefined || secret === '')) {
      throw codedError('secret-missing', `remote target "${target.label}" has no stored password; delete the connection and add it again from the wizard`)
    }
    if (target.authKind === 'privateKey' && (target.privateKeyPath === undefined || target.privateKeyPath === '')) {
      throw codedError('key-missing', `remote target "${target.label}" has no private key path; delete the connection and add it again from the wizard`)
    }
    const privateKey = target.privateKeyPath === undefined
      ? undefined
      : await readPrivateKey(target.privateKeyPath).catch((error: unknown) => {
          throw codedError('key-missing', `cannot read the private key ${target.privateKeyPath ?? ''}: ${error instanceof Error ? error.message : String(error)}`)
        })
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
    // A fresh connection invalidates the server workspace list (contract §15.2):
    // the next /api/state must read it from THIS server, not a stale copy.
    this.invalidateServerWorkspaces(targetId)
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

  /**
   * Every local workspace reference (P0 model, architecture §15.1).
   *
   * A ref carries only this client's materialization and view state; the path and
   * title come from the server list (`serverWorkspaceLists`).
   */
  listWorkspaceRefs(): RemoteWorkspaceRecord[] {
    return this.store.listWorkspaces()
  }

  /** @deprecated P0: use {@link listWorkspaceRefs}; kept for internal call sites. */
  listWorkspaces(): RemoteWorkspaceRecord[] {
    return this.store.listWorkspaces()
  }

  /**
   * The server-authoritative workspace list for every **connected** target.
   *
   * Keys are present only when the list could actually be read: a missing key
   * means "unknown", which the UI must not render as "server has no workspaces"
   * (contract §15.2).
   */
  async serverWorkspaceLists(): Promise<Record<string, RemoteWorkspaceSummary[]>> {
    const out: Record<string, RemoteWorkspaceSummary[]> = {}
    for (const targetId of [...this.channels.keys()]) {
      try {
        // `/api/state` is polled by the tree, so a target whose channel died must
        // not stall the whole response while it reprovisions. A timed-out target
        // simply omits its key (same meaning as "unreadable").
        out[targetId] = await Promise.race([
          this.serverWorkspacesOf(targetId),
          new Promise<never>((_resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('reg.list timed out')), STATE_LIST_TIMEOUT_MS)
            timer.unref?.()
          }),
        ])
      } catch (error) {
        console.error(`[dsh-remote-workspace] reg.list failed for "${targetId}": ${scrubSecrets(error instanceof Error ? error.message : String(error))}`)
      }
    }
    return out
  }

  /**
   * One target's `reg.list`, memoized for {@link SERVER_LIST_TTL_MS}.
   *
   * Never persisted: the server is the authority, this is a short-lived copy so
   * `/api/state` polling does not issue one RPC per target per frame (A38). Every
   * workspace write invalidates it explicitly.
   */
  private async serverWorkspacesOf(targetId: string, options: { refresh?: boolean } = {}): Promise<RemoteWorkspaceSummary[]> {
    const cached = this.serverWorkspaceCache.get(targetId)
    if (options.refresh !== true && cached !== undefined && Date.now() - cached.at < SERVER_LIST_TTL_MS) return [...cached.items]
    const items = await this.listRemoteWorkspaces(targetId)
    this.serverWorkspaceCache.set(targetId, { items, at: Date.now() })
    for (const item of items) this.workspacePaths.set(`${targetId}\u0000${String(item.id)}`, item.path)
    // Keep the local refs in step with what the server says exists: this is where
    // another client's workspace becomes visible here, and where its deletion
    // here follows the server (architecture §7.5 as revised by the Leader).
    await this.reconcileWorkspaceRefs(targetId, items).catch((error: unknown) => {
      console.error(`[dsh-remote-workspace] reconciling workspace refs for "${targetId}" failed: ${scrubSecrets(error instanceof Error ? error.message : String(error))}`)
    })
    return [...items]
  }

  /**
   * One local ref by **local id or server workspace id**.
   *
   * Since P0 the visible identity of a workspace is the server's 16-hex id, while
   * the ref keeps its own `wr-…` id for the tree, so both are legal keys on the
   * wire — resolving here keeps every caller (sessions, flags, delete) honest
   * without depending on which one the client happened to send.
   */
  private refOf(key: string): RemoteWorkspaceRecord | undefined {
    const direct = this.store.workspace(key)
    if (direct !== undefined) return direct
    return this.store.listWorkspaces().find(record => record.remoteWorkspaceId === key)
  }
  /** Drop one target's cached server list after any workspace write. */
  private invalidateServerWorkspaces(targetId: string): void {
    this.serverWorkspaceCache.delete(targetId)
  }

  /**
   * Align this client's refs with one target's server list.
   *
   * Three cases, all required by "two clients see each other's workspaces":
   *
   * 1. **server has it, this client does not** → create a bare ref
   *    (`targetId` + `remoteWorkspaceId` only): no stub, no shell row, nothing
   *    fetched — opening it later materializes those.
   * 2. **this client has it, the server does not** → the workspace was deleted
   *    elsewhere; drop the ref and its stub directory (the session logs on the
   *    server are untouched by design).
   * 3. **legacy ref** (`remoteWorkspaceId` absent but `path` present) → adopt the
   *    server's id for that path, or `reg.create` it once, then clear the legacy
   *    fields. This is the P0 migration; it runs only when a connection exists, so
   *    startup never dials a host just to migrate.
   * @param targetId - connected target.
   * @param items - its freshly read `reg.list`.
   */
  async reconcileWorkspaceRefs(targetId: string, items: readonly RemoteWorkspaceSummary[]): Promise<void> {
    const refs = this.store.listWorkspaces(targetId)
    const idByPath = new Map(items.map(item => [item.path, String(item.id)] as const))
    const serverIds = new Set(items.map(item => String(item.id)))
    for (const ref of refs) {
      // Resolve the server id first: adopted from the list, or registered once.
      let remoteWorkspaceId = ref.remoteWorkspaceId
      if (remoteWorkspaceId === undefined && ref.path !== undefined) {
        let id = idByPath.get(ref.path)
        if (id === undefined) {
          const created = await this.ensureRemoteWorkspace(targetId, ref.path, ref.title)
          id = String(created.id)
          idByPath.set(ref.path, id)
          serverIds.add(id)
          this.workspacePaths.set(`${targetId}\u0000${id}`, ref.path)
        }
        remoteWorkspaceId = id
      }
      if (remoteWorkspaceId === undefined) {
        // Neither an id nor a path: nothing can ever resolve this ref.
        await this.store.deleteWorkspace(ref.id)
        continue
      }
      // A ref with a server id must not keep the pre-P0 copies of what the server
      // now owns. This runs for EVERY such ref, not only freshly migrated ones —
      // one leftover row (alpha59, `rw-1a2b3c4d`) kept showing a stale `path`.
      const cleaned = stripLegacyRefFields(ref, remoteWorkspaceId)
      if (cleaned !== undefined) await this.store.putWorkspace(cleaned)
      if (serverIds.has(String(remoteWorkspaceId))) continue
      // Deleted on the server (possibly by another client).
      await this.store.deleteWorkspace(ref.id)
      this.workspacePaths.delete(`${targetId}\u0000${String(remoteWorkspaceId)}`)
      if (ref.stubPath !== undefined) await rm(ref.stubPath, { recursive: true, force: true }).catch(() => {})
    }
    // Workspaces this client has never seen.
    const known = new Set(this.store.listWorkspaces(targetId).map(ref => String(ref.remoteWorkspaceId ?? '')))
    for (const item of items) {
      if (known.has(String(item.id))) continue
      await this.store.putWorkspace({ id: `wr-${randomUUID().slice(0, 8)}`, targetId, remoteWorkspaceId: String(item.id) })
    }
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
        provisioned = await this.options.provision({
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
          // The pin is kept for this attempt only. Nothing is written before the
          // whole attempt succeeds: a failed connect must not leave a target
          // (nor a credential-less row) behind — see api-contract §2.1.
          draft = { ...draft, hostKeyFingerprint: fingerprint }
          continue
        }
        throw error
      }
    }
    if (provisioned === undefined) throw new Error('the remote server could not be started')
    // The first successful connection is the only write: it pins the key and
    // stores the secret together. A WSL target keeps an empty fingerprint
    // forever (there is no key to pin) and never holds a credential.
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
    this.invalidateServerWorkspaces(draft.id)
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
        candidates: assembleCandidates(scan, { profile, dshHome, ...(expectedPluginSha === undefined ? {} : { expectedPluginSha }) }),
      }
    } finally {
      await transport.close().catch(() => {})
    }
  }

  /**
   * Rename one workspace **on the server** (`reg.rename`, contract §14.2).
   *
   * P0 reversal (A34): the title is server-authoritative, so another client sees
   * the new name, and the id/path never change. Nothing is moved on disk — the
   * remote directory keeps its name and the session logs keep their cwd, so
   * history stays reachable.
   * @param targetId - stored target (must be connected).
   * @param remoteWorkspaceId - server workspace id (16 hex).
   * @param title - raw user input; normalized with the official rules.
   */
  async renameWorkspace(targetId: string, remoteWorkspaceId: string, title: string): Promise<{ workspace: RemoteWorkspaceSummary }> {
    const normalized = this.normalizeTitle(title)
    if (normalized === '') throw codedError('bad-request', 'workspace title must contain visible characters')
    this.requireConnectedForWrite(targetId, 'renaming a workspace')
    const renamed = await this.withBrowser(targetId, async client =>
      await client.request(
        'reg.rename',
        { id: remoteWorkspaceId, title: normalized },
        z.object({ id: z.string().length(16), title: z.string() }),
        AbortSignal.timeout(20_000),
      ))
    this.invalidateServerWorkspaces(targetId)
    // Answer with the **same item shape `reg.list` reports**. Building a
    // placeholder here (empty `createdAt`, `sessionCount: 0`) made the renamed row
    // jump to the bottom of the tree — the client sorts on
    // `updatedAt ?? createdAt`, and an empty createdAt is skipped — and briefly
    // displayed "0 sessions" (alpha57).
    const items = await this.serverWorkspacesOf(targetId, { refresh: true })
    const found = items.find(item => String(item.id) === String(remoteWorkspaceId))
    return {
      workspace: found ?? {
        id: renamed.id as WorkspaceId,
        path: this.workspacePaths.get(`${targetId}\u0000${String(remoteWorkspaceId)}`) ?? '',
        title: renamed.title,
        createdAt: '',
        sessionCount: 0,
      },
    }
  }

  /**
   * Remove one workspace **from the server registry** (`reg.delete`, A35).
   *
   * `force: false` refuses a workspace that still has sessions
   * (`workspace-not-empty <n>`, mapped to HTTP 409); `force: true` removes the
   * entry only — the session logs stay on the server, so re-adding the path
   * brings its history back. This client's ref and stub directory go away either
   * way.
   * @param targetId - stored target (must be connected).
   * @param remoteWorkspaceId - server workspace id (16 hex).
   * @param force - delete even when the workspace still has sessions.
   */
  async deleteWorkspace(
    targetId: string,
    remoteWorkspaceId: string,
    force = false,
  ): Promise<{ removed: boolean; sessionCount: number; refsDropped: string[] }> {
    this.requireConnectedForWrite(targetId, 'removing a workspace')
    let result: { removed: boolean; sessionCount: number }
    try {
      result = await this.withBrowser(targetId, async client =>
        await client.request(
          'reg.delete',
          { id: remoteWorkspaceId, ...(force ? { force: true } : {}) },
          z.object({ removed: z.boolean(), sessionCount: z.number() }),
          AbortSignal.timeout(20_000),
        ))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // The transport carries whole sentences; the actionable one gets its own
      // code so the route can answer 409 instead of a generic 500.
      const notEmpty = /workspace-not-empty (\d+)/.exec(message)
      if (notEmpty !== null) throw codedError('workspace-not-empty', `workspace-not-empty ${notEmpty[1] ?? '0'}`)
      throw error
    }
    this.invalidateServerWorkspaces(targetId)
    this.workspacePaths.delete(`${targetId}\u0000${String(remoteWorkspaceId)}`)
    const refsDropped: string[] = []
    for (const ref of this.store.listWorkspaces(targetId)) {
      if (String(ref.remoteWorkspaceId ?? '') !== String(remoteWorkspaceId)) continue
      await this.dropRefLocally(ref)
      refsDropped.push(ref.id)
    }
    return { ...result, refsDropped }
  }

  /** Drop one local ref and its stub directory (never the server's session logs). */
  private async dropRefLocally(ref: RemoteWorkspaceRecord): Promise<void> {
    const registry = this.ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined
    if (ref.officialWorkspaceId !== undefined) await Promise.resolve(registry?.delete?.(ref.officialWorkspaceId)).catch(() => {})
    if (ref.stubPath !== undefined) await rm(ref.stubPath, { recursive: true, force: true }).catch(() => {})
    await this.store.deleteWorkspace(ref.id)
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
      const existing = (await client.request('reg.list', {}, z.array(workspaceSummarySchema), AbortSignal.timeout(20_000))).find(item => item.path === path)
      const created = existing ?? await client.request('reg.create', { path, ...(title === undefined ? {} : { title }) }, workspaceSummarySchema, AbortSignal.timeout(20_000))
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

  /**
   * stub → remote aliases for every materialized workspace of one target.
   *
   * The remote path is **not** stored on the ref any more (the server owns it), so
   * it comes from the path this process learned — `reg.list`, or the
   * `openWorkspace`/session call that carried it. A ref with an unknown path is
   * absent from the alias list on purpose: rewriting a stub path into a path that
   * does not exist on the remote would run tools in the wrong directory.
   */
  pathAliases(targetId: string): { stub: string; remote: string }[] {
    const aliases: { stub: string; remote: string }[] = []
    for (const record of this.store.listWorkspaces(targetId)) {
      if (record.stubPath === undefined) continue
      const remote = this.remotePathOf(targetId, record)
      if (remote === undefined) continue
      aliases.push({ stub: record.stubPath, remote })
    }
    return aliases
  }

  /** The remote path of one ref: learned this process, or the legacy field. */
  private remotePathOf(targetId: string, record: RemoteWorkspaceRecord): string | undefined {
    if (record.remoteWorkspaceId !== undefined) {
      const known = this.workspacePaths.get(`${targetId}\u0000${String(record.remoteWorkspaceId)}`)
      if (known !== undefined) return known
    }
    return record.path
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
  async listRemoteWorkspaces(targetId: string, includeActivity = true): Promise<RemoteWorkspaceSummary[]> {
    return await this.withBrowser(targetId, async client => {
      // `includeActivity` makes the server fold each workspace's latest session
      // activity (`updatedAt`, memoized by log size there) so the tree can sort by
      // recency; the plain list is one RPC cheaper.
      const rows = await client.request('reg.list', includeActivity ? { includeActivity: true } : {}, z.array(workspaceSummarySchema), AbortSignal.timeout(20_000))
      return rows.map(row => ({
        id: row.id as WorkspaceId,
        path: row.path,
        title: row.title,
        createdAt: row.createdAt ?? '',
        sessionCount: row.sessionCount ?? 0,
        ...(row.updatedAt === undefined ? {} : { updatedAt: row.updatedAt }),
      }))
    })
  }

  /**
   * Sessions stored on the remote server for one workspace (`persist.list`).
   * @param targetId - stored target.
   * @param workspaceRecordId - the plugin's own workspace record id.
   */
  async listRemoteSessions(targetId: string, workspaceRecordId: string): Promise<RemoteSessionEntry[]> {
    const record = this.refOf(workspaceRecordId)
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
    // Draft detection. The official definition of a blank session is "the log has
    // no `turn/start`": a draft opened in the editor is ~324 B of session /
    // permission/preset / sandbox/mode / approval/policy events and no turn. Only
    // **untitled** sessions are candidates — the title service writes a title
    // together with the first turn — so real conversations cost no RPC here, and a
    // candidate costs one read open. Verdicts are memoized by log size
    // (`draftCache`), so a workspace full of old drafts pays for the scan once and
    // only for the ones that grow afterwards.
    const drafts = new Map<string, boolean>()
    for (const summary of summaries) {
      const meta = titles.get(String(summary.id))
      if (meta !== undefined && meta.title !== '') continue
      drafts.set(String(summary.id), await this.draftOf(targetId, workspaceId, String(summary.id), summary.sizeBytes))
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
          ...(drafts.get(String(summary.id)) === true ? { draft: true } : {}),
        }
      })
      // Newest activity first, like the shell's own session list.
      .sort((left, right) => (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0))
  }

  /**
   * Whether one stored session is still a **draft** — its log has no `turn/start`.
   *
   * The verdict comes from the session's own log, never from its title or size: the
   * routing/session planes already treat "no turn" as blank, and this is the same
   * fact read through `persist.open(mode: 'read')`.
   *
   * The read open is deliberately used instead of a write open: the official backend
   * only claims write ownership on a write open (`session-persistence-jsonl`
   * `open()` — the read branch adopts a handle without a lease), so a draft the
   * shell is holding open right now can still be inspected, and this check can never
   * steal the shell's handle. The handle is closed in `finally` because the server
   * keeps its handle table in memory until then.
   *
   * **Fails open**: any error (unreadable log, an unexpected payload, a server that
   * predates the plane) answers `false` with a warning. Showing one extra row is
   * recoverable; hiding a real conversation is not.
   * @param targetId - connected target holding the log.
   * @param workspaceId - the server workspace the session belongs to; the server
   *   verifies the log's cwd against it, so it must be the id `persist.list` used.
   * @param sessionId - stored session id.
   * @param sizeBytes - log size from `persist.list`, the memo's version stamp.
   * @returns true only when the log was read and contains no `turn/start`.
   */
  private async draftOf(
    targetId: string,
    workspaceId: string,
    sessionId: string,
    sizeBytes: number | undefined,
  ): Promise<boolean> {
    if (sizeBytes !== undefined && sizeBytes > DRAFT_SCAN_MAX_BYTES) return false
    const key = `${targetId}\u0000${workspaceId}\u0000${sessionId}`
    const cached = this.draftCache.get(key)
    if (cached !== undefined && cached.sizeBytes === sizeBytes) return cached.draft
    let handleId: string | undefined
    try {
      const payload = await this.sessionRequest<{ handleId?: unknown; events?: unknown }>(
        targetId,
        'persist.open',
        { workspaceId, sessionId, mode: 'read' },
      )
      // Record the handle the moment it exists: everything after this point can
      // fail, and the server keeps the handle in memory until it is closed.
      if (typeof payload.handleId !== 'string') throw new Error('persist.open did not return a handle id')
      handleId = payload.handleId
      if (!Array.isArray(payload.events)) throw new Error('persist.open did not return the session events')
      const draft = !payload.events.some(event => (event as { type?: unknown }).type === 'turn/start')
      // Successful reads are memoized in both directions; failures are not, so a
      // transient channel problem is retried on the next list instead of pinning the
      // session as a conversation forever.
      this.draftCache.set(key, { sizeBytes, draft })
      return draft
    } catch (error) {
      console.warn(
        `[dsh-remote-workspace] draft check for session "${sessionId}" failed (treated as a conversation): `
        + scrubSecrets(error instanceof Error ? error.message : String(error)),
      )
      return false
    } finally {
      if (handleId !== undefined) {
        // Never mask the verdict or the error above: a leaked handle only costs the
        // server memory, but a thrown close would fail the whole session list.
        await this.sessionRequest(targetId, 'persist.close', { handleId }).catch((error: unknown) => {
          console.warn(`[dsh-remote-workspace] closing the draft-check handle for "${sessionId}" failed: ${
            scrubSecrets(error instanceof Error ? error.message : String(error))}`)
        })
      }
    }
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
      const path = this.remotePathOf(targetId, record)
      if (path === undefined) throw error
      await this.ensureRemoteWorkspace(targetId, path, record.title).catch(() => {})
      this.invalidateServerWorkspaces(targetId)
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
    // Validate the directory on the remote host before any session exists, then
    // register it on the server (idempotent) so the id is server-authoritative.
    const listing = await this.listDirectory(targetId, path)
    const remote = await this.ensureRemoteWorkspace(targetId, listing.path, title)
    this.workspacePaths.set(`${targetId}\u0000${String(remote.id)}`, listing.path)
    this.invalidateServerWorkspaces(targetId)
    const materialized = await this.materializeWorkspace(target, { path: listing.path, remoteWorkspaceId: String(remote.id) })
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
   * Prepare one remote directory for the **official new-conversation draft**.
   *
   * This is {@link openWorkspace} minus the session. The shell's draft page binds
   * itself to a workspace and only creates the session when the first message is
   * sent (client `uiWorkspace.startSession(workspaceId)` → host `sessions.create`
   * → `sessionPersistence.create`), so everything a session needs must already
   * exist *before* any session does:
   *
   * - the server-side workspace entry (`reg.create`, idempotent): the routing
   *   persistence sends `create(header.cwd = <stub>)` to that workspace, and the
   *   server rewrites the header cwd to the remote path;
   * - the local stub directory **and** the record carrying `stubPath` +
   *   `remoteWorkspaceId`: without them `routeForCwd` misses and the shell's
   *   session would be written to this machine's JSONL store instead of the
   *   remote host — silently, which is the one outcome that must not happen;
   * - the official **shell workspace row**: the draft page resolves its workspace
   *   from the shell's own list, so the row is what makes the draft bindable. That
   *   is why this path forces registration while Gate 0 keeps it off elsewhere
   *   (see `officialWorkspaceFor`). The row stays invisible: the client hides
   *   `[data-slot="sidebar.workspaces"]` stub rows and `watchShellRows` drops the
   *   sessions that belong to this plugin.
   *
   * Nothing here creates, resumes or references a session: `ctx.agents` is never
   * touched and no new session id is written (`record.sessionId` keeps whatever
   * pointer it already had — a prepared workspace is still "the same row"). The
   * session appears later, through the shell's own create, and the server assigns
   * it to this workspace by `header.cwd`.
   *
   * **Idempotent by contract** — the client calls it right before *every* draft,
   * which also re-creates a shell row the sweep removed (see the risk note below):
   * an existing server entry is reused, an existing record keeps its id and stub,
   * an existing shell row is resolved by path, and no session appears.
   *
   * Risk the caller must handle: `POST /api/cleanup-shell-workspaces` (the tree's
   * 刷新) and the startup sweep delete every registry row under the stub root, so a
   * row prepared earlier can be gone. Calling this again restores it; a draft
   * opened with a stale `officialWorkspaceId` fails in the shell, not here.
   * @param targetId - stored target; must already be connected.
   * @param path - absolute remote directory.
   * @param title - display title; defaults to the last path segment.
   * @returns the materialized record (with its shell row id) and the stub path.
   */
  async prepareWorkspace(
    targetId: string,
    path: string,
    title?: string,
  ): Promise<{ workspace: RemoteWorkspaceRecord; stubPath: string; officialWorkspaceId: string }> {
    // Connection first: a stopped target is the client's own recovery case
    // (`target-not-connected` → "connect this host first"), and it must not be
    // reported as a realm problem while `ensureWorlds` has not run.
    const target = this.requireConnectedForWrite(targetId, 'preparing a workspace')
    // Same realm gate as `openWorkspace`, minus the session: a draft whose first
    // message would compose the *local* execution world writes into the stub on
    // this machine (defect B), and the client would only notice afterwards.
    await assertRemoteRealm(this.ctx, targetId)
    // Validate the directory on the remote host before registering it, then
    // register it server-side (idempotent: `reg.list` first, `reg.create` only on
    // a miss), so the id stays server-authoritative.
    const listing = await this.listDirectory(targetId, path)
    const remote = await this.ensureRemoteWorkspace(targetId, listing.path, title)
    this.workspacePaths.set(`${targetId}\u0000${String(remote.id)}`, listing.path)
    this.invalidateServerWorkspaces(targetId)
    const materialized = await this.materializeWorkspace(target, {
      path: listing.path,
      remoteWorkspaceId: String(remote.id),
      // The official draft page needs the shell row — see this method's doc.
      forceShellWorkspace: true,
    })
    const officialWorkspaceId = materialized.record.officialWorkspaceId
    if (officialWorkspaceId === undefined) {
      // Fail here instead of handing the client a workspace it cannot bind a
      // draft to: `startSession` would fail later with "unknown workspace", far
      // from the cause (a missing or refusing workspace registry).
      throw codedError(
        'shell-workspace-unavailable',
        `remote workspace "${targetId}": the shell workspace row for "${materialized.stub}" could not be registered, so the new-conversation draft cannot be bound to it; this needs the dsh workspace registry`,
      )
    }
    // A view-state touch, not an open: the prepared row sorts as most recent
    // without gaining a session pointer (the record keeps its previous one).
    const record: RemoteWorkspaceRecord = { ...materialized.record, lastOpenedAt: materialized.now }
    await this.store.putWorkspace(record)
    // `stubPath` is what `routeForCwd` compares a session's cwd against, so report
    // the **stored** value (the shell row's path whenever one exists) rather than
    // the raw stub: the shell derives the header cwd from its own row, and the two
    // must stay the same string or the create would fall back to the local store.
    return { workspace: record, stubPath: record.stubPath ?? materialized.stub, officialWorkspaceId }
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
    // The id is server-authoritative: resolve it by path (create only when the
    // server genuinely does not know the directory any more).
    const remote = await this.ensureRemoteWorkspace(targetId, listing.path, title)
    this.workspacePaths.set(`${targetId}\u0000${String(remote.id)}`, listing.path)
    this.invalidateServerWorkspaces(targetId)
    const materialized = await this.materializeWorkspace(target, { path: listing.path, remoteWorkspaceId: String(remote.id) })
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
   * Same gate for a **workspace write** (`reg.rename` / `reg.delete`).
   *
   * These go to the server, so a stopped target cannot serve them; answering a
   * bare 500 ("internal") gave the user nothing to act on (alpha58). The client
   * gets `409 target-not-connected` and can say "connect this host first".
   * @param targetId - stored target.
   * @param action - what was refused, for the message.
   */
  private requireConnectedForWrite(targetId: string, action: string): RemoteTargetRecord {
    try {
      return this.requireConnectedTarget(targetId, action)
    } catch (error) {
      if ((error as { code?: string }).code !== 'not-connected') throw error
      throw codedError(
        'target-not-connected',
        `remote target "${targetId}" is not connected; connect the host first (请先连接该主机) before ${action}`,
      )
    }
  }

  /**
   * Everything a session needs to exist for a remote directory: the server-side
   * workspace entry, the local stub directory, the shell-tree workspace and the
   * plugin's own record — in that order, and **persisted before any session is
   * created** (the routing persistence resolves `create(header.cwd)` and
   * re-anchors `open()` headers through this record, so an unmaterialized stub
   * would leave the session unroutable).
   */
  private async materializeWorkspace(
    target: RemoteTargetRecord,
    options: {
      readonly path: string
      readonly remoteWorkspaceId: string
      /**
       * Register the official shell row even while Gate 0 keeps it off.
       *
       * Only `prepareWorkspace` sets it: the official draft page resolves its
       * workspace from the shell's own list, so the row is what makes the draft
       * bindable at all (see `prepareWorkspace`).
       */
      readonly forceShellWorkspace?: boolean
    },
  ): Promise<MaterializedWorkspace> {
    // P0: the caller has already asked the server (idempotent `reg.create`) for
    // this workspace, so the ref is keyed by the server id and stores no
    // path/title of its own.
    const { path, remoteWorkspaceId } = options
    const existing = this.store.listWorkspaces(target.id).find(record => record.remoteWorkspaceId === remoteWorkspaceId)
    const now = new Date().toISOString()
    const displayTitle = path === '/' ? target.label : path.split('/').filter(Boolean).at(-1) ?? target.label

    // A *local stub directory* stands in for the remote path: official workspaces
    // are local-realpath'd, so this is the only way a remote path could appear in
    // the shell's tree at all. Whether we ALSO register it as an official shell
    // workspace is decided by `shouldRegisterShellWorkspaces()` — **off by
    // default** (Gate 0 branch A: the row is not needed and it leaks through the
    // shared registry file) — unless the caller forces it for the official draft
    // page (`prepareWorkspace`).
    // `ctx.get`, not `ctx.workspaceRegistry`: property access on a cordis context
    // requires the service in `inject`, and the plugin deliberately does not
    // inject workspaceRegistry (that edge deadlocks against sessionPersistence).
    const registry = this.ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined
    const key = createHash('sha1').update(`${target.id}\u0000${path}`).digest('hex').slice(0, 8)
    const stubRoot = join(homedir(), '.dsh', 'remote-workspaces', target.id)
    const stub = join(stubRoot, key)
    await mkdir(stub, { recursive: true })
    const canonicalStub = await realpath(stub)
    const official = await officialWorkspaceFor({
      registry,
      canonicalStub,
      shellTitle: `${displayTitle} · ${target.label}`,
      ...(options.forceShellWorkspace === true ? { force: true } : {}),
    })

    const record: RemoteWorkspaceRecord = {
      id: existing?.id ?? `wr-${randomUUID().slice(0, 8)}`,
      targetId: target.id,
      remoteWorkspaceId,
      // `stubPath` is ours, not the shell's: the routing persistence resolves a
      // session's cwd against it, and `forgetWorkspace` removes the directory.
      // It used to be copied from the official entry, so a *failed* shell
      // registration silently produced a workspace whose sessions could never be
      // routed; now it is always the stub we just materialized.
      stubPath: official?.path ?? canonicalStub,
      ...(official === undefined ? {} : { officialWorkspaceId: official.id }),
      ...(existing?.pinnedSessions === undefined ? {} : { pinnedSessions: existing.pinnedSessions }),
      ...(existing?.archivedSessions === undefined ? {} : { archivedSessions: existing.archivedSessions }),
      ...(existing?.lastOpenedAt === undefined ? {} : { lastOpenedAt: existing.lastOpenedAt }),
      ...(existing?.sessionId === undefined ? {} : { sessionId: existing.sessionId }),
    }
    await this.store.putWorkspace(record)
    return { record, official, stub: canonicalStub, now }
  }

  /** Attach the session to the shell workspace, remember it, and report it back. */
  private async finishOpen(materialized: MaterializedWorkspace, sessionId: string): Promise<{ workspace: RemoteWorkspaceRecord; sessionId: string }> {
    // No shell entry (Gate 0 switch, or a registration that failed) simply means
    // there is nothing to attach to; the session is complete either way.
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
    const record = this.refOf(workspaceId)
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

  /**
   * Forget one workspace **locally only**.
   *
   * P2: the `forget-workspace` route is an alias of `workspace-delete`, so this
   * method is the fallback used when the server cannot be asked (offline target,
   * or a legacy ref with no server id): drop the ref and its stub, never the
   * server's session logs.
   */
  async forgetWorkspace(workspaceId: string): Promise<boolean> {
    const record = this.refOf(workspaceId)
    if (record === undefined) return false
    await this.dropRefLocally(record)
    return true
  }

  /** Close every channel and browsing session, then scrub leaked shell rows. */
  async dispose(): Promise<void> {
    for (const targetId of [...this.browsers.keys()]) await this.retireBrowser(targetId)
    for (const channel of this.channels.values()) await channel.close().catch(() => {})
    this.channels.clear()
    for (const ticket of this.tickets.values()) ticket.confirm?.('')
    this.tickets.clear()
    // Branch A never creates shell rows; this catches rows older builds left in
    // the shared registry (Gate 0). Best effort — unload must not fail on it.
    await scrubShellWorkspaces(this.ctx).catch(() => {})
  }

  /**
   * Run the shell-row sweep on demand (`POST /api/cleanup-shell-workspaces`).
   *
   * Always runs: it is the operator's explicit repair action, so the
   * once-per-process flag must not suppress it.
   */
  async scrubShellWorkspaces(options: { root?: string } = {}): Promise<{ removed: string[]; kept: string[] }> {
    return await scrubShellWorkspaces(this.ctx, options)
  }

  /**
   * Sweep **at most once per process**, and only when the shell registry exists.
   *
   * This is the startup / first-`/api/state` safety net (alpha59).
   * `workspaceRegistry` is deliberately not injected (AGENTS 3: that edge
   * deadlocks against `sessionPersistence`), so at `storageReady` time it can still
   * be `undefined` — alpha58's startup sweep silently took the no-op branch and the
   * leaked rows survived until someone hit the route. The flag is set only after a
   * sweep actually ran, so a missing registry leaves the work for a later caller
   * (and a second caller in the same process never re-scans).
   */
  async scrubShellWorkspacesOnce(options: { root?: string } = {}): Promise<{ removed: string[]; kept: string[] }> {
    if (this.sweptShellWorkspaces) return { removed: [], kept: [] }
    if (this.ctx.get('workspaceRegistry') === undefined) return { removed: [], kept: [] }
    // One in-flight sweep shared by concurrent callers (startup poll + first state).
    const run = this.sweepingShellWorkspaces ?? (async () => {
      try {
        const result = await scrubShellWorkspaces(this.ctx, options)
        this.sweptShellWorkspaces = true
        return result
      } finally {
        this.sweepingShellWorkspaces = undefined
      }
    })()
    this.sweepingShellWorkspaces = run
    return await run
  }

  /**
   * Wait (bounded) for the shell registry, then sweep once.
   *
   * The registry service finishes activating *after* this row, so the startup
   * sweep has to wait for it rather than give up on the first look. Polling beats
   * `inject`: declaring that edge deadlocks the boot tree (AGENTS 3).
   * @param options - poll budget; tests shrink both numbers.
   * @returns the sweep result, or undefined when the registry never appeared.
   */
  async scrubWhenRegistryReady(options: { timeoutMs?: number; intervalMs?: number; root?: string } = {}): Promise<{ removed: string[]; kept: string[] } | undefined> {
    const timeoutMs = options.timeoutMs ?? 20_000
    const intervalMs = options.intervalMs ?? 500
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (this.ctx.get('workspaceRegistry') !== undefined) return await this.scrubShellWorkspacesOnce(options)
      if (Date.now() >= deadline) return undefined
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, intervalMs)
        timer.unref?.()
      })
    }
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

/** How long /api/state waits for one target's `reg.list` before omitting its key. */
const STATE_LIST_TIMEOUT_MS = 3_000

/** How long one target's `reg.list` answer is reused by `/api/state` (A38: memory only). */
const SERVER_LIST_TTL_MS = 2_000

/**
 * Delete the official shell workspace rows this plugin's stubs created.
 *
 * Gate 0 left them in the **shared** `~/.dsh/storages/workspace.json` (every dsh on
 * the machine reads that file, so an unpatched desktop displayed rows like
 * `…\.dsh\remote-workspaces\rt-…\…`). Branch A stopped creating them; this removes
 * the historical ones and any a forced run left behind.
 *
 * Scope is deliberately narrow: only the entries whose path is a stub under
 * `<root>/<targetId>/<key>` are touched. Other workspaces, the stub directories
 * and our own refs are never modified; a failure on one entry never stops the
 * rest (best effort, startup and unload both call it).
 * @param ctx - host context (only `workspaceRegistry` is used).
 * @param options - stub root override (tests); defaults to `~/.dsh/remote-workspaces`.
 * @returns the removed entry ids and the stub paths that had no entry.
 */
export async function scrubShellWorkspaces(
  ctx: Context,
  options: { readonly root?: string } = {},
): Promise<{ removed: string[]; kept: string[] }> {
  const removed: string[] = []
  const kept: string[] = []
  const registry = ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined
  if (registry === undefined) return { removed, kept }
  const root = options.root ?? join(homedir(), '.dsh', 'remote-workspaces')
  const targets = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const target of targets) {
    if (!target.isDirectory()) continue
    const targetDir = join(root, target.name)
    const stubs = await readdir(targetDir, { withFileTypes: true }).catch(() => [])
    for (const stub of stubs) {
      if (!stub.isDirectory()) continue
      let canonical: string
      try {
        canonical = await realpath(join(targetDir, stub.name))
      } catch {
        continue
      }
      // The official resolveByPath is async; awaiting it is the whole point of
      // the union return type below (alpha57 shipped without this await and the
      // sweep answered `removed: [null, null]` while deleting nothing).
      const entry = await registry.resolveByPath(canonical)
      if (entry === undefined) {
        kept.push(canonical)
        continue
      }
      try {
        await registry.delete(entry.id)
        removed.push(entry.id)
      } catch (error) {
        // Leave it for the next pass rather than aborting the sweep.
        console.error('[dsh-remote-workspace] removing a leaked shell workspace failed', scrubSecrets(error instanceof Error ? error.message : String(error)))
        kept.push(canonical)
      }
    }
  }
  return { removed, kept }
}

/** The scan's overall budget (api-contract §2.4: `scan-timeout` past 60 s). */
const SCAN_TIMEOUT_MS = 60_000

/**
 * Drop the pre-P0 copies of server-owned fields from one ref.
 *
 * `path`/`title`/`createdAt`/`serverId` are legacy: as soon as a ref carries a
 * `remoteWorkspaceId`, the server owns those values and a stale local copy is
 * worse than none — one migrated row (`rw-1a2b3c4d`) kept reporting
 * `path: "/home/user"` in `/api/state` (alpha59). Materialization and view
 * state (`stubPath`, `officialWorkspaceId`, `sessionId`, pins, `lastOpenedAt`)
 * are kept.
 * @param ref - the stored ref.
 * @param remoteWorkspaceId - the server id it must carry.
 * @returns the cleaned record, or undefined when there was nothing to clean (so
 *   the caller does not rewrite an untouched row on every refresh).
 */
export function stripLegacyRefFields(ref: RemoteWorkspaceRecord, remoteWorkspaceId: string): RemoteWorkspaceRecord | undefined {
  const hasLegacy =
    ref.path !== undefined ||
    ref.title !== undefined ||
    ref.createdAt !== undefined ||
    ref.serverId !== undefined ||
    ref.remoteWorkspaceId !== remoteWorkspaceId
  if (!hasLegacy) return undefined
  const { path: _path, title: _title, createdAt: _createdAt, serverId: _serverId, ...rest } = ref
  return { ...rest, remoteWorkspaceId }
}

/**
 * Whether this process may register official **shell** workspace rows for remote
 * stubs.
 *
 * **Default: off (Gate 0 branch A).** `DSH_RW_FORCE_SHELL_WORKSPACES=1` restores
 * the old behaviour (register the stub in the shell registry and attach sessions
 * to it).
 *
 * Why off by default:
 *
 * 1. **Nothing needs the row.** `attachSession` is the only official call on our
 *    open path and it is skipped when the row is absent; registry membership is a
 *    *filter* (`candidateMatches` warns and drops a session, it never throws);
 *    `ctx.agents.create`/`resume` never read `workspaceRegistry` (grep of the
 *    shipped tree: `dsh-api-workspace-controller`, `dsh-workspace`,
 *    `dsh-api-session-controller` — none of which is on our path, since
 *    `openRemoteSession` composes through `ctx.agents.create` directly). The row
 *    buys exactly one thing: a row in the shell's own workspace tree.
 * 2. **The row leaks.** The registry is one shared file
 *    (`~/.dsh/storages/workspace.json`) that every dsh on the machine reads —
 *    including a desktop install with no plugin, which then shows
 *    `…\.dsh\remote-workspaces\rt-…\…` rows that nothing ever removes. The
 *    server-authoritative refactor makes the remote the workspace authority, so
 *    these stub rows must not be created at all.
 *
 * Why the escape hatch stays: the shell could start treating registry membership
 * as enforcement (or a machine could carry a registry that demands the row). The
 * variable flips all of it back in one restart without a code change.
 *
 * Cost when off: only the shell's own tree row. Sessions, remote logs, routing,
 * rename/pin/archive and resume are unaffected — see
 * `tests/gate0-shell-workspaces.test.ts`.
 * @param env - environment to read (injectable for tests).
 */
export function shouldRegisterShellWorkspaces(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.DSH_RW_FORCE_SHELL_WORKSPACES ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

/**
 * The official shell workspace standing for one stub, when shell rows are enabled
 * (`DSH_RW_FORCE_SHELL_WORKSPACES=1`; off by default — see
 * `shouldRegisterShellWorkspaces`) **or the caller forces it**.
 *
 * Gate 0 finding: nothing in the **open** path needs it. `attachSession` is the
 * only official call we make, it validates `realpath(header.cwd) === path` and is
 * skipped entirely when absent; membership is a *filter* on the registry side
 * (`candidateMatches` warns and drops a session, never throws); and the
 * thin-client session-controller — the only other `workspaceRegistry` consumer —
 * is not on our path because `openRemoteSession` composes through
 * `ctx.agents.create` directly. So the entry buys exactly one thing: a row in the
 * shell's workspace tree (which is also the thing that leaks into unrelated
 * clients through the shared `storages/workspace.json`).
 * **One caller overrides the switch: `prepareWorkspace` passes `force: true`.**
 * The official new-conversation draft resolves its workspace from the shell's own
 * list (`uiWorkspace.startSession(workspaceId)`), so a prepared workspace has to
 * own a registry row or there is no id to bind the draft to — on that path the row
 * is a *functional* requirement, not a tree entry. Gate 0 is therefore unchanged
 * everywhere else: `openWorkspace`/`resumeSessionOnce` still pass no `force` and
 * still skip the row, and even a forced row stays invisible in the UI (the client
 * hides `[data-slot="sidebar.workspaces"]` stub rows and `watchShellRows` drops
 * their sessions).
 * @param options - registry (may be absent), the canonical stub, its row title and
 *   an explicit override of the process-wide switch.
 * @returns the entry, or undefined when rows are disabled or registration failed.
 */
export async function officialWorkspaceFor(options: {
  readonly registry: WorkspaceRegistryLike | undefined
  readonly canonicalStub: string
  readonly shellTitle: string
  /** Register even while `shouldRegisterShellWorkspaces()` is off; only `prepareWorkspace` does. */
  readonly force?: boolean
}): Promise<OfficialWorkspace | undefined> {
  if (options.force !== true && !shouldRegisterShellWorkspaces()) return undefined
  const { registry } = options
  if (registry === undefined) return undefined
  const existing = await registry.resolveByPath(options.canonicalStub)
  if (existing !== undefined) return existing
  return await registry.create(options.canonicalStub, options.shellTitle).catch((error: unknown) => {
    // Best effort by design: a registry that refuses the row must not stop a
    // remote session from opening (that is the whole point of the switch).
    console.error('[dsh-remote-workspace] registering the workspace in the shell tree failed', error)
    return undefined
  })
}

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
