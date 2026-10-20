/**
 * Typed client for this plugin's frozen host HTTP contract.
 *
 * Every route lives under {@link API_PREFIX}: POST + JSON body for commands,
 * one GET SSE stream for connection progress (EventSource cannot POST, so the
 * one-shot `ticket` travels in the query string). Responses are always
 * `{ ok: true, value }` or `{ ok: false, error: { code, message } }`; a
 * non-envelope body (a fence rejection, a proxy error page) is surfaced as
 * {@link RemoteApiError} carrying the HTTP status.
 *
 * No secret ever enters a URL: `secret`/`privateKeyPath` ride the
 * `/api/connect/start` JSON body only, and {@link api.connectStart} is the
 * only method that takes them.
 */
import { t } from './locales.ts'

/** Route prefix owned by the plugin's host half. */
export const API_PREFIX = '/dsh-remote-workspace'

/** SSH authentication kind, as the host models it. */
export type AuthKind = 'password' | 'privateKey' | 'agent'

/** Connection status of a saved target. */
export type TargetStatus = 'unknown' | 'ready' | 'failed' | 'stopped'

/** Remote runtime knobs (advanced section of the wizard). */
export interface RemoteRuntimeConfig {
  nodePath: string
  dshCommand: string
  profile: string
  dshHome: string
  plugins: string[]
}

/** A host the plugin has connected to before. */
export interface PublicTarget {
  id: string
  label: string
  /** `ssh`, or `wsl` for a local Windows distribution. */
  kind: 'ssh' | 'wsl'
  host: string
  port: number
  username: string
  authKind: AuthKind
  hasStoredSecret: boolean
  /**
   * Pinned host key. Empty for a draft and *always* empty for a `wsl` target:
   * a local distribution has no host key to verify.
   */
  hostKeyFingerprint: string
  sshConfigAlias?: string
  /** `wsl` targets: the distribution and its optional user. */
  wslDistro?: string
  wslUser?: string
  remote: RemoteRuntimeConfig
  status: TargetStatus
  /** How this target's server package was last obtained, when the host knows. */
  packageSource?: 'auto' | 'download' | 'upload' | 'reuse'
  /** The remote dsh the user picked last time (reuse), for a future preset. */
  reuseDsh?: { path: string; version: string; nodePath?: string; scannedAt: string }
  /** Last probed architecture — a hint only; the pipeline probes again. */
  platformProbe?: {
    platform: 'linux' | 'darwin'
    arch: 'x64' | 'arm64'
    libc: '' | 'gnu' | 'musl'
    tag: string
    probedAt: string
  }
  lastError?: string
  lastConnectedAt?: string
}

/**
 * **Server-authoritative** workspace list item (`reg.list`, api-contract §14.1).
 *
 * `path`/`title`/`createdAt`/`sessionCount` live on the server; this client only
 * keeps a {@link WorkspaceRef} pointing at one. `createdAt`/`sessionCount` are
 * optional because a v2 server omits them (and `updatedAt` exists only when the
 * list was read with `includeActivity`) — a row must still render, with `—`.
 */
export interface ServerWorkspace {
  /** 16 lowercase hex: `sha256(serverId \0 path)[0..16]`. */
  id: string
  /** Absolute remote path. */
  path: string
  /** Server-authoritative title (`reg.rename` writes it). */
  title: string
  createdAt?: string
  sessionCount?: number
  /** Latest activity of any session in the workspace; omitted without activity. */
  updatedAt?: string
}

/**
 * The **local** half of a workspace row (api-contract §15.1).
 *
 * Only local materialization and view state: no `path`/`title` (the server owns
 * those). A ref whose `remoteWorkspaceId` is still missing is a record waiting
 * for the host-side migration and contributes no row.
 */
export interface WorkspaceRef {
  /** Local ref id (`wr-…`): the UI node key and the `workspaceId` of session routes. */
  id: string
  targetId: string
  /** Server workspace id; absent until the legacy record was migrated. */
  remoteWorkspaceId?: string
  /** Local stub directory (non-authoritative, rebuildable). */
  stubPath?: string
  /** Official shell-workspace entry id (non-authoritative; what the sweep removes). */
  officialWorkspaceId?: string
  /** Session ids this plugin's user pinned in this workspace, most recent first. */
  pinnedSessions?: string[]
  /** Session ids this plugin's user archived (grayed, not openable). */
  archivedSessions?: string[]
  lastOpenedAt?: string
  sessionId?: string
}

/** One alias read from the local `~/.ssh/config`. */
export interface SshAlias {
  alias: string
  hostName?: string
  port?: number
  user?: string
  identityFile?: string
  source: string
}

/** One session stored on the remote server for a workspace (`persist.list`). */
export interface RemoteSession {
  id: string
  /** Creation time from the stored header (epoch milliseconds). */
  createdAt?: number
  sizeBytes?: number
  /** Log title (`session/title`), absent when the session has none. */
  title?: string
  /** Last activity in the log (epoch milliseconds), for the row's time column. */
  updatedAt?: number
  /**
   * The log holds **no `turn/start`** yet: a saved draft, not a conversation.
   *
   * `prepare-workspace` plus the shell's own `startSession` create and persist
   * that log (a few hundred bytes of session/permission/sandbox headers), so the
   * draft is *reusable* — the next 新会话 click reopens the same blank instead of
   * minting another one — but it is still not a row: the tree hides it and shows
   * one temporary 「新会话」 row above the list instead.
   *
   * Absent from hosts that predate the flag; `undefined` means "no evidence it is
   * a draft", so it is treated as a stored conversation (never hide a real one).
   */
  draft?: boolean
}

/** Response of `/api/ssh-aliases`. */
export interface SshAliasesResult {
  aliases: SshAlias[]
  warnings: string[]
}

/** Response of `/api/alias-prefill`. */
export interface AliasPrefill {
  alias: string
  host: string
  port: number
  username?: string
  identityFile?: string
  source: 'ssh -G' | 'config-file'
}

/** Optional remote runtime overrides sent with `/api/connect/start`. */
export interface RemoteRuntimeInput {
  nodePath?: string
  dshCommand?: string
  profile?: string
  dshHome?: string
}

/** Body of `/api/connect/start`. `secret` never leaves this request. */
export interface ConnectStartRequest {
  label: string
  /** Omitted means `ssh`. A `wsl` request carries no host/port/credentials. */
  kind?: 'ssh' | 'wsl'
  host?: string
  port?: number
  username?: string
  authKind?: AuthKind
  secret?: string
  privateKeyPath?: string
  sshConfigAlias?: string
  /** Present only when retrying after the user confirmed a fingerprint. */
  hostKeyFingerprint?: string
  /** `wsl` only: the distribution to enter and its optional user. */
  wslDistro?: string
  wslUser?: string
  /** Per-target server-package source; omitted = follow the global policy. */
  packageSource?: 'auto' | 'download' | 'upload' | 'reuse'
  /** Required when `packageSource: 'reuse'`: the launcher the user picked. */
  reuseLauncherPath?: string
  remote?: RemoteRuntimeInput
}

/* ------------------------------------------------------- connection method */

/**
 * The three-way choice of wizard step 3.
 *
 * All three are selectable now that server-package releases exist:
 * `reuse` (an existing dsh on the host), `upload` (this machine's package) and
 * `download` (fetch the release for the remote architecture).
 */
export type ConnectionMode = 'reuse' | 'upload' | 'download'

/** Per-target package source; `''` = follow the global policy. */
export type PackageSourceInput = '' | 'upload' | 'reuse' | 'download'

/* --------------------------------------------------------------- dsh scan */

/** Body of `/api/dsh-scan`: the same identity fields a connect request carries. */
export interface DshScanRequest {
  kind?: 'ssh' | 'wsl'
  host?: string
  port?: number
  username?: string
  authKind?: AuthKind
  /** Only ever in this request body; never echoed back. */
  secret?: string
  privateKeyPath?: string
  sshConfigAlias?: string
  hostKeyFingerprint?: string
  wslDistro?: string
  wslUser?: string
  profile?: string
  dshHome?: string
}

/** The remote `dsh-remote-workspace` profile found next to one dsh. */
export interface ScannedDshProfile {
  name: string
  pluginVersion?: string
  pluginSha256?: string
  /** The scanned plugin file set matches this machine's (sha256 equal). */
  upToDate: boolean
}

/** One dsh installation the scan found on the remote host. */
export interface DshCandidate {
  /** The launcher the user sees and we would start. */
  path: string
  /** `readlink -f` target; the scan's de-duplication key. */
  realPath: string
  /** First line of `<launcher> --version`; `''` when it failed. */
  version: string
  compatible: boolean
  executable: boolean
  /** `node` the launcher's shebang needs; absent for a self-contained binary. */
  nodePath?: string
  selfContained: boolean
  profile?: ScannedDshProfile
  /** Why it is incompatible, already scrubbed by the host. */
  reason?: string
}

/** What the remote host needs: platform, arch and the package tag that matches. */
export interface RemoteRuntimeProbe {
  platform: 'linux' | 'darwin'
  arch: 'x64' | 'arm64'
  libc: '' | 'gnu' | 'musl'
  platformArch: string
  tag: string
  home: string
  tools: { tar: boolean; sha256sum: boolean; curl: boolean; wget: boolean }
}

/** The server package that would be uploaded, and whether it is already local. */
export interface ServerPackageState {
  artifact: string
  version: string
  /** Local `~/.dsh/remote-assets` hit whose sha256 verified. */
  cached: boolean
  sha256?: string
  sizeBytes?: number
}

/**
 * `/api/dsh-scan`'s two outcomes.
 *
 * `host-key` means the scan is read-only *and* still unauthenticated-host: the
 * wizard shows the same fingerprint panel a connect shows and re-scans with the
 * confirmed fingerprint. Nothing is pinned or stored by a scan.
 */
export type DshScanResult =
  | { stage: 'host-key'; fingerprint: string }
  | {
      stage: 'done'
      probe: RemoteRuntimeProbe
      package: ServerPackageState
      dshHome: string
      profiles: string[]
      candidates: DshCandidate[]
    }

/** One installed WSL distribution, as `/api/wsl-distros` reports it. */
export interface WslDistro {
  name: string
  /** wsl.exe's own wording, e.g. `Running` / `Stopped` / `Installing`. */
  state?: string
  version?: number
  default: boolean
}

/** Response of `/api/wsl-distros`; `available: false` carries the reason. */
export interface WslProbeResult {
  available: boolean
  distros: WslDistro[]
  error?: string
}

/** Response of `/api/state` (api-contract §15.2). */
export interface StateResult {
  targets: PublicTarget[]
  /** Every target's local refs; the rows are joined with `serverWorkspaces`. */
  workspaceRefs: WorkspaceRef[]
  /**
   * Per-target server workspace lists (`reg.list`), keyed by target id.
   *
   * **A missing key is not an empty array**: absent means "this connected
   * target's list could not be read", while `[]` means "the server says there is
   * no workspace". The UI words those two states differently.
   */
  serverWorkspaces: Record<string, ServerWorkspace[]>
  pluginVersion: string
  defaultProfile: string
  /** The harness host's `process.platform`; the WSL method is gated on it. */
  platform?: string
}

/** One directory entry of `/api/list-dir`. */
export interface DirEntry {
  name: string
  type: 'file' | 'directory' | 'other'
  path: string
}

/** Response of `/api/list-dir`. */
export interface ListDirResult {
  home: string
  path: string
  parent?: string
  entries: DirEntry[]
}

/**
 * Response of `/api/open-workspace`.
 *
 * After P0 the returned `workspace` is the local ref (the server owns the
 * `path`/`title`), so only `id`/`targetId` are consumed here — the row itself is
 * re-joined from `/api/state`.
 */
export interface OpenWorkspaceResult {
  workspace: WorkspaceRef
  sessionId: string
}

/**
 * Response of `/api/prepare-workspace`: a **materialized workspace without a
 * session**.
 *
 * This is what the official new-conversation draft needs and `open-workspace`
 * deliberately is not: the row (server `reg.create`, local stub, plugin record
 * and — for this path only — the official shell workspace row) must exist before
 * the shell can bind a draft to it, but no remote session may be created. The
 * shell creates that session itself on the first message
 * (`uiWorkspace.startSession` → `sessions.create` → routing `create(header.cwd)`).
 *
 * The route is **idempotent** (same `(targetId, path)` keeps the record id, does
 * not re-register, creates no session) and only refreshes `lastOpenedAt`, so the
 * client calls it before *every* draft: the startup sweep and 刷新
 * (`cleanup-shell-workspaces`) delete the shell rows under the stubs, which
 * invalidates a cached `officialWorkspaceId`.
 */
export interface PrepareWorkspaceResult {
  /** The plugin's own row id (`wr-…`): `/api/sessions`, flags and pin/archive take it. */
  workspaceId: string
  /** Server-authoritative workspace id (16 hex). */
  remoteWorkspaceId: string
  /**
   * Local stub directory — exactly the `header.cwd` of the draft session the
   * shell creates (the realm rewrites it to the remote path).
   */
  stubPath: string
  /**
   * Official shell workspace id, the argument
   * `uiWorkspace.startSession(workspaceId, …)` takes. Always present on
   * success: a missing row fails the route with `shell-workspace-unavailable`
   * rather than handing back an unbindable draft.
   */
  officialWorkspaceId: string
  /** Echo of the request. */
  targetId: string
}

/** The four progress steps the server reports over SSE. */
export type ConnectStep = 'connect' | 'probe' | 'runtime' | 'upload' | 'start'

/** Status a step frame may carry. */
export type ConnectStepStatus = 'running' | 'ok' | 'failed'

/** One frame of the `/stream/connect` SSE stream. */
export type ConnectFrame =
  | { type: 'step'; step: ConnectStep; status: ConnectStepStatus; message?: string; detail?: string }
  | { type: 'host-key'; fingerprint: string; algorithm?: string }
  | { type: 'done'; target: PublicTarget }
  | { type: 'error'; code: string; message: string }

/** A wire failure reduced to what the UI renders inline. */
export interface WireError {
  code: string
  message: string
}

/** One failed call, with the host's error code and the HTTP status. */
export class RemoteApiError extends Error {
  readonly code: string
  readonly status: number

  /**
   * @param code - the host's error code (`network` and `invalid-response` are client-side).
   * @param message - human-readable message, already localized where the client produced it.
   * @param status - HTTP status, 0 for a transport failure.
   */
  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'RemoteApiError'
    this.code = code
    this.status = status
  }
}

/** Reduce any thrown value to a {@link WireError} for inline rendering. */
export function toWireError(error: unknown): WireError {
  if (error instanceof RemoteApiError) return { code: error.code, message: error.message }
  if (error instanceof Error) return { code: 'client', message: error.message }
  return { code: 'client', message: String(error) }
}

interface Envelope {
  ok?: unknown
  value?: unknown
  error?: { code?: unknown; message?: unknown }
}

/**
 * Parse one JSON envelope, throwing {@link RemoteApiError} for anything else.
 * The body is read as text first so a non-JSON rejection (the host's trust
 * fence, a proxy) still produces a readable message.
 */
async function readEnvelope<T>(response: Response): Promise<T> {
  const raw = await response.text().catch(() => '')
  let parsed: Envelope | null = null
  if (raw !== '') {
    try {
      parsed = JSON.parse(raw) as Envelope
    } catch {
      parsed = null
    }
  }
  if (parsed !== null && parsed.ok === true) return parsed.value as T
  const code = typeof parsed?.error?.code === 'string' ? parsed.error.code : `http-${response.status}`
  const envelopeMessage = typeof parsed?.error?.message === 'string' ? parsed.error.message : undefined
  const fallback = raw === '' ? `HTTP ${response.status}` : raw.slice(0, 300)
  throw new RemoteApiError(code, envelopeMessage ?? fallback, response.status)
}

/** POST one command route and unwrap its envelope. */
async function call<T>(route: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_PREFIX}/api/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  } catch (error) {
    throw new RemoteApiError('network', t('error.network', { message: error instanceof Error ? error.message : String(error) }), 0)
  }
  return readEnvelope<T>(response)
}

/** One command per frozen host route. */
export const api = {
  /** Saved targets, saved workspaces, plugin version and the default profile. */
  state(): Promise<StateResult> {
    return call<StateResult>('state', {})
  },

  /**
   * Installed WSL distributions (`wsl.exe -l -v`).
   *
   * Windows hosts only; elsewhere the route answers 400 and the caller never
   * asks, because the WSL method is not offered there at all.
   */
  wslDistros(): Promise<WslProbeResult> {
    return call<WslProbeResult>('wsl-distros', {})
  },

  /** Aliases parsed from the local `~/.ssh/config`, plus parser warnings. */
  sshAliases(): Promise<SshAliasesResult> {
    return call<SshAliasesResult>('ssh-aliases', {})
  },

  /** Resolved connection fields for one alias (host/port/user/identity). */
  aliasPrefill(alias: string): Promise<AliasPrefill> {
    return call<AliasPrefill>('alias-prefill', { alias })
  },

  /**
   * Start a connection attempt; the returned ticket addresses the SSE stream.
   * @param request - connection fields; `secret` is sent here and nowhere else.
   */
  connectStart(request: ConnectStartRequest): Promise<{ ticket: string }> {
    return call<{ ticket: string }>('connect/start', request)
  },

  /** Accept one host-key fingerprint for a running attempt (never automatic). */
  hostkeyConfirm(ticket: string, fingerprint: string): Promise<{ accepted: true }> {
    return call<{ accepted: true }>('hostkey-confirm', { ticket, fingerprint })
  },

  /** List one remote directory. */
  listDir(targetId: string, path: string): Promise<ListDirResult> {
    return call<ListDirResult>('list-dir', { targetId, path })
  },

  /** Create one remote directory. */
  mkdir(targetId: string, path: string): Promise<{ path: string }> {
    return call<{ path: string }>('mkdir', { targetId, path })
  },

  /** Open a remote directory as a workspace and create its session. */
  openWorkspace(targetId: string, path: string, title?: string): Promise<OpenWorkspaceResult> {
    return call<OpenWorkspaceResult>('open-workspace', title === undefined ? { targetId, path } : { targetId, path, title })
  },

  /**
   * Materialize one remote directory as a workspace **without creating a
   * session** (the official new-conversation draft).
   *
   * The row must exist before the shell can bind a draft to it — the official
   * `uiWorkspace.startSession(workspaceId)` resolves its workspace from the
   * shell's own list — but this call must not create the remote session: the
   * shell's own `sessions.create` does that lazily, and the plugin's routing
   * turns that into `persist.create` on the target (`header.cwd` is the stub
   * returned here).
   * @param targetId - the connected host owning the directory.
   * @param path - absolute remote directory.
   * @param title - display title; the server normalizes it and defaults to the
   *   last path segment.
   */
  prepareWorkspace(targetId: string, path: string, title?: string): Promise<PrepareWorkspaceResult> {
    return call<PrepareWorkspaceResult>(
      'prepare-workspace',
      title === undefined ? { targetId, path } : { targetId, path, title },
    )
  },

  /**
   * Adopt a session that already exists on the remote server (换设备续聊).
   * @param targetId - the host owning the session.
   * @param path - the remote workspace directory.
   * @param sessionId - stored remote session id.
   */
  openSession(targetId: string, path: string, sessionId: string, title?: string): Promise<OpenWorkspaceResult> {
    return call<OpenWorkspaceResult>('open-session', {
      targetId,
      path,
      sessionId,
      ...(title === undefined ? {} : { title }),
    })
  },

  /** The workspaces the remote dsh has registered (添加工作区 source). */
  remoteWorkspaces(targetId: string): Promise<{ workspaces: ServerWorkspace[] }> {
    return call<{ workspaces: ServerWorkspace[] }>('remote-workspaces', { targetId })
  },

  /** Sessions stored on the remote server for one local workspace record. */
  sessions(targetId: string, workspaceId: string): Promise<{ sessions: RemoteSession[] }> {
    return call<{ sessions: RemoteSession[] }>('sessions', { targetId, workspaceId })
  },

  /**
   * Read-only pre-connection scan: the remote architecture, the server package
   * state and every dsh already installed there.
   *
   * Takes the same identity fields as {@link api.connectStart} (including the
   * secret, which is used once and never stored), but pins nothing and creates
   * no record — a `host-key` stage only asks for a confirmation.
   */
  dshScan(request: DshScanRequest): Promise<DshScanResult> {
    return call<DshScanResult>('dsh-scan', request)
  },

  /**
   * Rename one remote workspace **on the server** (api-contract §4.1).
   *
   * The id and the remote directory name never change; the server persists the
   * title in its own index and the host re-reads `reg.list` afterwards.
   * @param targetId - the connection owning the workspace.
   * @param remoteWorkspaceId - server workspace id (16 hex).
   * @param title - normalized new title.
   */
  workspaceRename(targetId: string, remoteWorkspaceId: string, title: string): Promise<{ workspace: ServerWorkspace }> {
    return call<{ workspace: ServerWorkspace }>('workspace-rename', { targetId, remoteWorkspaceId, title })
  },

  /**
   * Delete one workspace **from the server's list** (api-contract §4.1).
   *
   * Without `force` a workspace that still has sessions answers HTTP 409
   * `workspace-not-empty`; the UI then asks again and retries with `force: true`.
   * Session logs on the remote are never deleted — only the list entry and this
   * machine's ref.
   * @param targetId - the connection owning the workspace.
   * @param remoteWorkspaceId - server workspace id (16 hex).
   * @param force - delete even when sessions remain.
   */
  workspaceDelete(targetId: string, remoteWorkspaceId: string, force?: boolean): Promise<{ removed: boolean; sessionCount: number; refsDropped: string[] }> {
    return call<{ removed: boolean; sessionCount: number; refsDropped: string[] }>(
      'workspace-delete',
      force === undefined ? { targetId, remoteWorkspaceId } : { targetId, remoteWorkspaceId, force },
    )
  },

  /**
   * Sweep this plugin's leftover stub entries out of the **shared** shell
   * workspace registry (api-contract §4.2). Idempotent.
   *
   * `kept` lists entries that still have an active session and therefore stay.
   */
  cleanupShellWorkspaces(): Promise<{ removed: string[]; kept: string[] }> {
    return call<{ removed: string[]; kept: string[] }>('cleanup-shell-workspaces', {})
  },

  /** Drop one saved target (and everything derived from it). */
  forgetTarget(targetId: string): Promise<{ forgotten: true }> {
    return call<{ forgotten: true }>('forget-target', { targetId })
  },

  /** Rename one stored remote session (the plugin's own host hop). */
  sessionRename(targetId: string, path: string, sessionId: string, title: string): Promise<{ renamed: true }> {
    return call<{ renamed: true }>('session-rename', { targetId, path, sessionId, title })
  },

  /** Pin/unpin or archive/unarchive one stored remote session. */
  sessionFlag(workspaceId: string, sessionId: string, flag: 'pinned' | 'archived', on: boolean): Promise<{ workspace: WorkspaceRef }> {
    return call<{ workspace: WorkspaceRef }>('session-flag', { workspaceId, sessionId, flag, on })
  },

  /** Open (or reuse) the execution channel of a saved host, without a session. */
  connect(targetId: string): Promise<{ target: PublicTarget }> {
    return call<{ target: PublicTarget }>('connect', { targetId })
  },

  /** Stop the target's remote execution-world session. */
  stopTarget(targetId: string): Promise<{ stopped: boolean }> {
    return call<{ stopped: boolean }>('stop-target', { targetId })
  },
}

/** The SSE URL for one attempt (one-shot ticket, no secret). */
export function connectStreamUrl(ticket: string): string {
  return `${API_PREFIX}/stream/connect?ticket=${encodeURIComponent(ticket)}`
}

/** Frame-name fallback: the host may name its SSE events after the frame type. */
const FRAME_EVENT_NAMES = ['step', 'host-key', 'done', 'error'] as const

/** Narrow one parsed JSON value to a {@link ConnectFrame}. */
function asConnectFrame(value: unknown): ConnectFrame | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const frame = value as { type?: unknown }
  switch (frame.type) {
    case 'step': {
      const step = (value as { step?: unknown }).step
      const status = (value as { status?: unknown }).status
      if (step !== 'connect' && step !== 'probe' && step !== 'runtime' && step !== 'upload' && step !== 'start') return undefined
      if (status !== 'running' && status !== 'ok' && status !== 'failed') return undefined
      const message = (value as { message?: unknown }).message
      const detail = (value as { detail?: unknown }).detail
      return {
        type: 'step',
        step,
        status,
        ...(typeof message === 'string' ? { message } : {}),
        ...(typeof detail === 'string' ? { detail } : {}),
      }
    }
    case 'host-key': {
      const fingerprint = (value as { fingerprint?: unknown }).fingerprint
      if (typeof fingerprint !== 'string') return undefined
      const algorithm = (value as { algorithm?: unknown }).algorithm
      return {
        type: 'host-key',
        fingerprint,
        ...(typeof algorithm === 'string' ? { algorithm } : {}),
      }
    }
    case 'done': {
      const target = (value as { target?: unknown }).target
      if (target === null || typeof target !== 'object') return undefined
      return { type: 'done', target: target as PublicTarget }
    }
    case 'error': {
      const code = (value as { code?: unknown }).code
      const message = (value as { message?: unknown }).message
      return {
        type: 'error',
        code: typeof code === 'string' ? code : 'stream',
        message: typeof message === 'string' ? message : t('connect.stream.closed'),
      }
    }
    default:
      return undefined
  }
}

/** Handlers for one connection stream. */
export interface ConnectStreamHandlers {
  /** One validated frame, in arrival order. */
  onFrame: (frame: ConnectFrame) => void
  /** Transport failure (reported once; the caller owns closing). */
  onTransportError: (message: string) => void
}

/**
 * Open the SSE progress stream for one attempt.
 *
 * The stream is closed by the returned disposer only: the caller closes it on
 * a terminal frame (`done`/`error`) or on a transport failure, because the
 * ticket is one-shot and the browser's automatic reconnect would re-open a
 * dead attempt. Frames are read from the default `message` event and, as a
 * fallback, from events named after the frame type.
 *
 * @param ticket - the one-shot ticket from {@link api.connectStart}.
 * @param handlers - frame and transport callbacks.
 * @returns an idempotent close function.
 */
export function openConnectStream(ticket: string, handlers: ConnectStreamHandlers): () => void {
  if (typeof EventSource === 'undefined') {
    throw new RemoteApiError('no-eventsource', t('error.streamUnsupported'), 0)
  }
  const source = new EventSource(connectStreamUrl(ticket))
  let closed = false
  let failed = false

  const close = (): void => {
    if (closed) return
    closed = true
    source.close()
  }

  const deliver = (event: MessageEvent): void => {
    if (closed) return
    let parsed: unknown
    try {
      parsed = JSON.parse(String(event.data))
    } catch {
      return
    }
    const frame = asConnectFrame(parsed)
    if (frame !== undefined) handlers.onFrame(frame)
  }

  source.onmessage = deliver
  for (const name of FRAME_EVENT_NAMES) {
    source.addEventListener(name, deliver as EventListener)
  }
  source.onerror = (): void => {
    if (closed || failed) return
    failed = true
    handlers.onTransportError(t('connect.stream.closed'))
  }

  return close
}
