/**
 * The v1 P3 client API (protocol §16), separate from the legacy connection
 * wizard calls still living in `api.ts`.
 *
 * Every route here is the browser → client-host face; it never talks to the
 * profile server directly. The envelope, error normalizer and trust fence are
 * the same as `api.ts` (`call`), so a failed request still arrives as a
 * {@link RemoteApiError} with a stable code.
 */
import { API_PREFIX, call } from './api.ts'
import type { ListDirResult, PublicTarget, SshAlias, SshAliasesResult, WireError } from './api.ts'
import type { ExecutorMode, ModeSwitchFailedCancellation, ModeSwitchPreview } from './executor.ts'
import { parseModeSwitchEvent, type ModeSwitchEvent } from './executor.ts'
import type { RemoteSessionList, RemoteWorkspace, RemoteWorkspaceList } from './remote-data.ts'

/** Connection phase reported by the client host. */
export type ConnectionPhase = 'disconnected' | 'connecting' | 'ready' | 'degraded' | 'failed' | 'stopped'

/** Live profile-server process facts. */
export interface ConnectionProfileState {
  readonly name: string
  readonly port?: number
  readonly pid?: number
  readonly leaseInstanceId?: string
  readonly startedAt?: string
}

/** Which runtime the profile server was started from. */
export interface ConnectionRuntimeState {
  readonly kind: 'isolated' | 'global'
  readonly version?: string
  readonly dshVersion?: string
  readonly launcher?: string
}

/** Installed server-plugin facts. */
export interface ConnectionPluginState {
  readonly version?: string
  readonly protocol?: number
  readonly installed: boolean
}

/** Server capability bits the client must tolerate when absent (protocol §2.3). */
export interface ServerCapabilitiesV1 {
  readonly workspaceApi?: 1
  readonly sessionApi?: 1
  readonly persistRpc?: 1
  readonly executor?: 1
  readonly eventsSse?: 1
  readonly muxWs?: 1
  readonly embed?: { readonly storagePrefix: string; readonly mode: 'reload' | 'client-half' }
  readonly registryReload?: 'loader-disable-enable' | 'none'
  readonly registryWriteGuard?: 'prototype' | 'none'
}

/** Embed hints resolved by the handshake. */
export interface EmbedCapabilities {
  readonly storagePrefix: string
  readonly mode: 'reload' | 'client-half'
  readonly parentOrigin?: string
}

/** Portal endpoints for one connected target. */
export interface PortalState {
  readonly base: string
  readonly muxPath: string
}

/** Deployment preview for one connection (M3). */
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
    readonly requiresConfirmation: boolean
  }
}

/** `POST /api/deployment/apply` value. */
export interface DeploymentApplyResult {
  readonly applied: boolean
  readonly restarted: boolean
  readonly version?: string
  readonly requiresConfirmation?: boolean
}

/** Registry revision bookkeeping (protocol §10). */
export interface RegistryStatus {
  readonly revision: string
  readonly loadedRevision: string
  readonly stale: boolean
}

/** One target's P3 connection state (`state` / `state/refresh`). */
export interface ConnectionStateV1 {
  readonly targetId: string
  readonly phase: ConnectionPhase
  readonly profile: ConnectionProfileState | null
  readonly runtime: ConnectionRuntimeState | null
  readonly plugin: ConnectionPluginState | null
  readonly capabilities?: ServerCapabilitiesV1
  readonly embed?: EmbedCapabilities
  readonly portal: PortalState
  readonly registry?: RegistryStatus
  readonly deployment?: DeploymentStateV1
  readonly error?: WireError
}

/** Target row as the v1 state carries it (legacy transport fields + v1 additions). */
export interface PublicTargetV1 extends PublicTarget {
  /** Stable client id (profile/runtime isolation). */
  readonly clientId?: string
  /** Default execution end for new sessions on this connection. */
  readonly executor?: ExecutorMode
  /** per-client profile name. */
  readonly profileName?: string
}

/** `GET /api/state` v1 (additive over the legacy shape). */
export interface StateResultV1 {
  readonly clientId?: string
  readonly pluginVersion: string
  readonly protocol?: 1
  readonly targets: readonly PublicTargetV1[]
  /** Per-target connection state; a missing key means "not connected/never read". */
  readonly connections: Readonly<Record<string, ConnectionStateV1>>
  /** Per-target workspace list; only connected targets appear. */
  readonly workspaces: Readonly<Record<string, RemoteWorkspaceList>>
  /** Per-target session list snapshot (M1: rendered without a second round trip). */
  readonly sessions?: Readonly<Record<string, RemoteSessionList>>
  /** Client-host portal root; per-target paths are in `connections[].portal`. */
  readonly portalBase?: string
  readonly verifiedRuntimes?: readonly string[]
  readonly defaultProfile: string
  readonly platform?: string
}

/** `POST /api/sessions` (workspaceId omitted = all sessions). */
export interface SessionListResult extends RemoteSessionList {}

/** `POST /api/state/refresh` value (host shape: both raw lists + stale flag). */
export interface StateRefreshResult {
  readonly workspaces: RemoteWorkspaceList
  readonly sessions: RemoteSessionList
  readonly stale: boolean
  /** Host additive: current connection state, when the implementation provides it. */
  readonly connection?: ConnectionStateV1
  /** Host additive: the registry status read with the refresh. */
  readonly registry?: RegistryStatus | null
}

/** `POST /api/registry/refresh` value. */
export interface RegistryRefreshResult {
  readonly revision: string
  readonly serviceReplaced: true
}

/** One active turn from `profile/restart-preview`. */
export interface RestartActiveTurn {
  readonly sessionId: string
  readonly title?: string
}

/** `POST /api/profile/restart-preview` value. */
export interface ProfileRestartPreview {
  readonly activeTurns: readonly RestartActiveTurn[]
  readonly requiresConfirmation: boolean
  readonly previewRevision: string
}

/** `POST /api/profile/restart` value. */
export interface ProfileRestartResult {
  readonly restarted: boolean
  readonly cancelledTurnIds?: readonly string[]
  readonly failedCancellations?: readonly ModeSwitchFailedCancellation[]
}

/** `POST /api/mode/apply` value. */
export interface ModeApplyResult {
  readonly switched: boolean
  readonly cancelledTurnIds: readonly string[]
  readonly failedCancellations: readonly ModeSwitchFailedCancellation[]
}

/** `POST /api/session/create|open` value (host-side create/resume + reveal). */
export interface LocalSessionResult {
  readonly sessionId: string
  readonly workspaceId: string
  readonly executor: ExecutorMode
  readonly revealed: boolean
}

/** `POST /api/session/prepare-server` value. */
export type PrepareServerResult =
  | { readonly managed: true; readonly agentPreset?: string }
  | { readonly managed: false; readonly fallback: 'restart' }

/** v2 server conversation timeline (planned P1 shape; fields are additive). */
export interface SessionTimelineResult {
  readonly sessionId?: string
  /** Raw `RwTimelineValue` shape from the server (thin UI mapping owns rows). */
  readonly entries?: SessionTimelineEvent[]
  readonly eventCount?: number
  readonly beforeSeq?: number
  readonly nextBeforeSeq?: number | null
  readonly afterSeq?: number
  readonly nextAfterSeq?: number | null
  /** Compatibility aliases some server builds use. */
  readonly events?: SessionTimelineEvent[]
  readonly nextSeq?: number
  readonly cursor?: string
  readonly [key: string]: unknown
}

/** One pending approval from `session/status`. */
export interface SessionPendingApproval {
  readonly approvalId: string
  readonly sessionId: string
  readonly toolName: string
  readonly callId?: string
  readonly reason?: string
  readonly displayReason?: Record<string, string>
  readonly requestedAt: number
}

/** One timeline/stream row; the adapter keeps unknown fields for official components. */
export interface SessionTimelineEvent {
  readonly seq?: number
  readonly type?: string
  readonly at?: string
  readonly role?: string
  readonly [key: string]: unknown
}

/** v2 session command values are opaque today; the UI reads known fields only. */
export interface SessionCommandResult {
  readonly sessionId?: string
  readonly accepted?: boolean
  readonly canceled?: boolean
  readonly running?: boolean
  readonly agentAvailable?: boolean
  readonly status?: string
  readonly pendingApprovals?: SessionPendingApproval[]
  /** Additive server diagnostic: `qa` when the QA approval gate is active. */
  readonly approvalGate?: string
  readonly decision?: 'allowed-once' | 'rejected' | 'cancelled'
  /** `session/commands` result. */
  readonly commands?: readonly { readonly name: string; readonly description: string; readonly input?: unknown }[]
  /** `session/command` result. */
  readonly executed?: boolean
  readonly commandId?: string
  readonly [key: string]: unknown
}

export interface SessionApprovalRequest {
  readonly sessionId: string
  readonly approvalId: string
  readonly decision: 'allowed-once' | 'rejected' | 'cancelled' | 'allow' | 'deny'
  readonly [key: string]: unknown
}

/** P1 `fs/list` value (M2c): server canonical path + name/type entries. */
export interface ServerFsList {
  readonly home: string
  readonly path: string
  readonly parent: string | null
  readonly entries: readonly { readonly name: string; readonly type: 'file' | 'directory' | 'other' }[]
}

/** POSIX join used for one listed child (server paths only). */
function joinServerPath(base: string, name: string): string {
  return base === '' || base === '/' ? `/${name}` : `${base.replace(/\/+$/, '')}/${name}`
}

/** Normalize the P1 listing to the dialog's `ListDirResult` shape. */
export function normalizeFsList(value: ServerFsList): ListDirResult {
  return {
    home: value.home,
    path: value.path,
    ...(value.parent === null ? {} : { parent: value.parent }),
    entries: value.entries.map(entry => ({
      name: entry.name,
      type: entry.type,
      path: joinServerPath(value.path, entry.name),
    })),
  }
}

/** One model exposed by the server's model catalog. */
export interface SessionModelInfo {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly reasoning?: { readonly efforts: readonly { readonly id: string; readonly name: string }[]; readonly defaultEffort?: string }
}

/** One provider group in the server model catalog. */
export interface SessionModelGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly SessionModelInfo[]
}

/** `session/modelCatalog` value (provider groups + isolated failures). */
export interface SessionModelCatalog {
  readonly default: { readonly provider: string; readonly model: string }
  readonly groups: readonly SessionModelGroup[]
  readonly failures?: readonly { readonly id: string; readonly message: string }[]
}

/** `POST /api/session/fork` value. */
export interface ForkResult {
  readonly sessionId: string
}

/** `POST /api/session/rename` value. */
export interface RenameResult {
  readonly title: string
  readonly seq?: number
}

/** Request body used by the mode endpoints. */
export interface ModeApplyRequest {
  readonly targetId: string
  readonly nextMode: ExecutorMode
  readonly cancelActiveTurns: true
  readonly previewRevision: string
  /** Current sidebar selection; lets the host apply D20 to the right turn. */
  readonly targetSessionId?: string
}

/* ------------------------------------------------------------- SSE events */

/** One P3 state event (`/stream/state`, protocol §16 + dev-core framing). */
export type RemoteStateEvent =
  | {
    readonly v: 1
    readonly type: 'change'
    readonly targetId: string
    readonly kind: 'workspace' | 'session' | 'executor'
    readonly reason?: 'local' | 'external'
    readonly revision?: string
    readonly workspaceId?: string
    readonly sessionId?: string
  }
  | (ModeSwitchEvent & { readonly v: 1 })
  | {
    readonly v: 1
    readonly type: 'session/revealed'
    readonly targetId: string
    readonly sessionId: string
  }

/** Narrow one `/stream/state` payload. */
export function parseRemoteStateEvent(data: unknown): RemoteStateEvent | undefined {
  if (data === null || typeof data !== 'object') return undefined
  const raw = data as { v?: unknown; type?: unknown }
  if (raw.v !== 1) return undefined
  if (raw.type === 'change') {
    const event = data as {
      targetId?: unknown; kind?: unknown; reason?: unknown; revision?: unknown
      workspaceId?: unknown; sessionId?: unknown
    }
    if (typeof event.targetId !== 'string' || event.targetId === '') return undefined
    if (event.kind !== 'workspace' && event.kind !== 'session' && event.kind !== 'executor') return undefined
    return {
      v: 1,
      type: 'change',
      targetId: event.targetId,
      kind: event.kind,
      ...(event.reason === 'local' || event.reason === 'external' ? { reason: event.reason } : {}),
      ...(typeof event.revision === 'string' ? { revision: event.revision } : {}),
      ...(typeof event.workspaceId === 'string' ? { workspaceId: event.workspaceId } : {}),
      ...(typeof event.sessionId === 'string' ? { sessionId: event.sessionId } : {}),
    }
  }
  if (raw.type === 'session/revealed') {
    const event = data as { targetId?: unknown; sessionId?: unknown }
    if (typeof event.targetId !== 'string' || event.targetId === '') return undefined
    if (typeof event.sessionId !== 'string' || event.sessionId === '') return undefined
    return { v: 1, type: 'session/revealed', targetId: event.targetId, sessionId: event.sessionId }
  }
  const modeEvent = parseModeSwitchEvent(data)
  return modeEvent === undefined ? undefined : { ...modeEvent, v: 1 }
}

/** Handlers for one `/stream/state` connection. */
export interface RemoteStateStreamHandlers {
  readonly onEvent: (event: RemoteStateEvent) => void
  /** Transport failure; the caller owns reconnect/backoff. */
  readonly onTransportError: (message: string) => void
}

/** Open the single P3 state stream (no target query; frames carry targetId). */
export function openRemoteStateStream(handlers: RemoteStateStreamHandlers): () => void {
  if (typeof EventSource === 'undefined') {
    throw new Error('EventSource is unavailable in this browser')
  }
  const source = new EventSource(`${API_PREFIX}/stream/state`)
  let closed = false
  let failed = false
  const close = (): void => {
    if (closed) return
    closed = true
    source.close()
  }
  source.onmessage = (event: MessageEvent): void => {
    if (closed) return
    let parsed: unknown
    try {
      parsed = JSON.parse(String(event.data))
    } catch {
      return
    }
    const remoteEvent = parseRemoteStateEvent(parsed)
    if (remoteEvent !== undefined) handlers.onEvent(remoteEvent)
  }
  source.onerror = (): void => {
    if (closed || failed) return
    failed = true
    handlers.onTransportError('state stream closed')
  }
  return close
}

/** Same-origin URL for one v2 session event stream (EventSource). */
export function sessionEventsUrl(options: {
  readonly targetId: string
  readonly sessionId: string
  readonly afterSeq?: number
}): string {
  const query = new URLSearchParams({ targetId: options.targetId, sessionId: options.sessionId })
  if (options.afterSeq !== undefined && Number.isFinite(options.afterSeq)) query.set('afterSeq', String(Math.trunc(options.afterSeq)))
  return `${API_PREFIX}/api/session/events?${query.toString()}`
}

/** Handlers for one v2 session event stream. */
export interface SessionEventStreamHandlers {
  /** A decoded P1 SSE frame (`event` is the server event name, `message` when absent). */
  readonly onEvent: (event: { readonly event: string; readonly data: string }) => void
  /** The stream closed; the caller owns reconnect/backoff and afterSeq. */
  readonly onTransportError?: (message: string) => void
}

/**
 * Bridge one server session's SSE stream to the browser.
 *
 * The host re-emits P1 frames with their original event names, so we listen to
 * the common names explicitly (EventSource has no wildcard) plus the default
 * `message`; unknown named frames are still delivered through `message` only if
 * the host omitted the name.
 */
export function openSessionEvents(options: {
  readonly targetId: string
  readonly sessionId: string
  readonly afterSeq?: number
}, handlers: SessionEventStreamHandlers): () => void {
  if (typeof EventSource === 'undefined') throw new Error('EventSource is unavailable in this browser')
  const source = new EventSource(sessionEventsUrl(options))
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    source.close()
  }
  const dispatch = (event: MessageEvent): void => {
    if (closed) return
    const name = event.type === 'message' ? 'message' : event.type
    handlers.onEvent({ event: name, data: String(event.data) })
  }
  for (const name of ['message', 'ready', 'timeline', 'status', 'approval', 'error']) {
    source.addEventListener(name, dispatch as EventListener)
  }
  source.onerror = (): void => {
    if (closed) return
    handlers.onTransportError?.('session event stream closed')
  }
  return close
}

/* --------------------------------------------------------------- commands */

/** One command per v1 P3 route (protocol §16). */
/** One connect progress event (host v1/connect/progress). */
export type ConnectProgressStep = 'connect' | 'probe' | 'runtime' | 'upload' | 'start'

export interface ConnectProgressEvent {
  readonly step: ConnectProgressStep
  readonly status: 'running' | 'ok' | 'failed' | 'skipped'
  readonly message: string
  readonly at: string
}

/** How the local model source reaches this machine's models. */
export type LocalLlmMode = 'auto' | 'manual'

/** One model offered by a provider of the client DSH installation. */
export interface LocalProviderModel {
  readonly id: string
  readonly name: string
}

/** One model provider of the client DSH installation (`local-llm/discover`). */
export interface LocalProviderSummary {
  readonly id: string
  readonly name: string
  readonly models: readonly LocalProviderModel[]
}

/**
 * One provider's selected model ids for the local `auto` source.
 *
 * The host exposes only these models through the SSH reverse tunnel; the ids
 * are the provider's own `models[].id` values from `local-llm/discover`.
 */
export interface LocalModelSelection {
  readonly providerId: string
  readonly models: readonly string[]
}

/** Browser-facing local-model settings; the key itself never leaves the host. */
export interface LocalLlmReadState {
  /** `auto` proxies the DSH's own providers; `manual` uses `baseUrl`. */
  readonly mode?: LocalLlmMode
  readonly baseUrl: string
  readonly models: readonly string[]
  readonly timeoutMs: number
  readonly hasApiKey: boolean
  readonly modelSource?: 'local' | 'server'
  /** Persisted per-provider selection (`auto` mode only). */
  readonly selection?: readonly LocalModelSelection[]
}

export const remoteApi = {
  /** Full first-paint snapshot (targets + connection states + workspace lists). */
  state(): Promise<StateResultV1> {
    return call<StateResultV1>('state', {})
  },

  /** Session list for one target; `workspaceId` omitted returns the whole account. */
  async sessions(targetId: string, workspaceId?: string): Promise<SessionListResult> {
    const value = await call<SessionListResult | { sessions: SessionListResult }>('v1/sessions', {
      targetId,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    })
    const raw = value as SessionListResult
    const wrapped = value as { sessions: SessionListResult }
    return Array.isArray(raw.sessions) ? raw : wrapped.sessions
  },

  /** The server's authoritative workspace list (host wraps the P1 value). */
  async workspaces(targetId: string): Promise<RemoteWorkspaceList> {
    const value = await call<RemoteWorkspaceList | { workspaces: RemoteWorkspaceList }>('v1/workspaces', { targetId })
    const raw = value as RemoteWorkspaceList
    const wrapped = value as { workspaces: RemoteWorkspaceList }
    return Array.isArray(raw.workspaces) ? raw : wrapped.workspaces
  },

  /** Connect one identity through the v1 host route (the minimal M1 entry). */
  connectV1(request: {
    readonly label: string
    readonly host: string
    readonly port: number
    readonly username: string
    readonly authKind: 'password' | 'privateKey' | 'agent'
    readonly secret?: string
    readonly privateKeyPath?: string
    readonly hostKeyFingerprint?: string
    readonly dshHome?: string
    readonly runtimePolicy?: 'auto' | 'isolated'
    readonly attemptId?: string
    /** Where the server agent's model requests are served. */
    readonly modelSource?: 'local' | 'server'
  }): Promise<{ target: PublicTargetV1; state: ConnectionStateV1 }> {
    return call<{ target: PublicTargetV1; state: ConnectionStateV1 }>('v1/connect', request)
  },

  /** Read the saved local-model settings (never the API key; only `hasApiKey`). */
  localLlmRead(targetId?: string): Promise<LocalLlmReadState> {
    return call<LocalLlmReadState>('local-llm/read', targetId === undefined ? {} : { targetId })
  },

  /** Save the local-model mode and (auto) selected models; optionally an API key. */
  localLlmSave(request: {
    readonly mode: LocalLlmMode
    readonly baseUrl?: string
    readonly models?: readonly string[]
    readonly timeoutMs?: number
    readonly apiKey?: string
    /** Auto mode: which discovered provider models the host may expose. */
    readonly selection?: readonly LocalModelSelection[]
    readonly targetId?: string
  }): Promise<LocalLlmReadState> {
    return call<LocalLlmReadState>('local-llm/save', request)
  },

  /**
   * Discover the model providers the client DSH exposes (`local-llm/discover`).
   * The host answers `local-llm-providers-unavailable` when none is usable.
   */
  localLlmDiscover(): Promise<{ providers: readonly LocalProviderSummary[] }> {
    return call<{ providers: readonly LocalProviderSummary[] }>('local-llm/discover', {})
  },

  /** Probe the local OpenAI-compatible endpoint and return its model ids. */
  localLlmProbe(request: {
    readonly baseUrl?: string
    readonly apiKey?: string
    readonly timeoutMs?: number
  }): Promise<{ models: string[] }> {
    return call<{ models: string[] }>('local-llm/probe', request)
  },

  /** Remove the stored local-model API key. */
  localLlmClearKey(): Promise<LocalLlmReadState> {
    return call<LocalLlmReadState>('local-llm/clear-key', {})
  },

  /** Read the progress buffer for one connect attempt. */
  connectProgress(attemptId: string): Promise<{ events: ConnectProgressEvent[] }> {
    return call<{ events: ConnectProgressEvent[] }>('v1/connect/progress', { attemptId })
  },

  /** Aliases parsed from the client host's `~/.ssh/config`. */
  sshAliases(): Promise<SshAliasesResult> {
    return call<SshAliasesResult>('ssh-aliases', {})
  },

  /** Reconnect one saved target using the host-side pinned record and secret. */
  reconnect(targetId: string): Promise<{ target: PublicTargetV1; state: ConnectionStateV1 }> {
    return call<{ target: PublicTargetV1; state: ConnectionStateV1 }>('v1/connect', { targetId })
  },

  /** Delete one saved target (profile stopped, local record and secret removed). */
  forget(targetId: string): Promise<{ forgotten: true }> {
    return call<{ forgotten: true }>('forget-target', { targetId })
  },

  /** Stop one profile server through the v1 host route. */
  stop(targetId: string): Promise<{ stopped: boolean }> {
    return call<{ stopped: boolean }>('v1/stop', { targetId })
  },

  /** Register one server directory as an official workspace. */
  workspaceCreate(targetId: string, path: string, title?: string): Promise<RemoteWorkspace> {
    return call<RemoteWorkspace>('workspace/create', {
      targetId,
      path,
      ...(title === undefined ? {} : { title }),
    })
  },

  /** Rename a server workspace (title only; never the directory). */
  workspaceRename(targetId: string, workspaceId: string, title: string): Promise<RemoteWorkspace> {
    return call<RemoteWorkspace>('workspace/rename', { targetId, workspaceId, title })
  },

  /** Remove one workspace registration; 409 when sessions remain and no force. */
  workspaceDelete(targetId: string, workspaceId: string, force?: boolean): Promise<{ deleted: boolean }> {
    return call<{ deleted: boolean }>('workspace/delete', {
      targetId,
      workspaceId,
      ...(force === undefined ? {} : { force }),
    })
  },

  /** Persist the official workspace order (`beforeWorkspaceId` omitted = append). */
  workspaceReorder(targetId: string, workspaceId: string, beforeWorkspaceId?: string): Promise<{ order: readonly string[] }> {
    return call<{ order: readonly string[] }>('workspace/reorder', {
      targetId,
      workspaceId,
      ...(beforeWorkspaceId === undefined ? {} : { beforeWorkspaceId }),
    })
  },

  /** Server-mode new session: create/reuse a blank, then prepare the managed agent. */
  sessionCreate(params: {
    readonly targetId: string
    readonly workspaceId: string
    readonly executor: ExecutorMode
    readonly sessionId?: string
  }): Promise<LocalSessionResult> {
    return call<LocalSessionResult>('session/create', {
      targetId: params.targetId,
      workspaceId: params.workspaceId,
      executor: params.executor,
      ...(params.sessionId === undefined ? {} : { sessionId: params.sessionId }),
    })
  },

  /** Open/resume one session through the host bridge (local mode reveal). */
  sessionOpen(params: {
    readonly targetId: string
    readonly workspaceId?: string
    readonly sessionId: string
    /** Omitted on purpose: the host resolves the session's own executor record. */
    readonly executor?: ExecutorMode
  }): Promise<LocalSessionResult> {
    return call<LocalSessionResult>('session/open', {
      targetId: params.targetId,
      ...(params.workspaceId === undefined ? {} : { workspaceId: params.workspaceId }),
      sessionId: params.sessionId,
      ...(params.executor === undefined ? {} : { executor: params.executor }),
    })
  },

  /** Ensure the profile server holds the managed agent handle (server mode). */
  sessionPrepareServer(targetId: string, sessionId: string): Promise<PrepareServerResult> {
    return call<PrepareServerResult>('session/prepare-server', { targetId, sessionId })
  },

  /** Rename a session (server-authoritative title). */
  sessionRename(targetId: string, sessionId: string, title: string): Promise<RenameResult> {
    return call<RenameResult>('session/rename', { targetId, sessionId, title })
  },

  /** Fork a session (source must be opened/migrated when the server says so). */
  sessionFork(targetId: string, sessionId: string, options: { readonly atSeq?: number; readonly increaseTitle?: boolean } = {}): Promise<ForkResult> {
    return call<ForkResult>('session/fork', {
      targetId,
      sessionId,
      ...(options.atSeq === undefined ? {} : { atSeq: options.atSeq }),
      ...(options.increaseTitle === undefined ? {} : { increaseTitle: options.increaseTitle }),
    })
  },

  /** Pin/unpin through the official registry set. */
  sessionPin(targetId: string, sessionId: string, pinned: boolean): Promise<{ pinned: readonly string[] }> {
    return call<{ pinned: readonly string[] }>('session/pin', { targetId, sessionId, pinned })
  },

  /** Archive/unarchive; `stopActivity` is the official "stop and archive" retry. */
  sessionArchive(
    targetId: string,
    sessionId: string,
    archived: boolean,
    stopActivity?: boolean,
  ): Promise<{ archived: readonly string[] }> {
    return call<{ archived: readonly string[] }>('session/archive', {
      targetId,
      sessionId,
      archived,
      ...(stopActivity === undefined ? {} : { stopActivity }),
    })
  },

  /** Persist the official session order inside one workspace. */
  sessionReorder(
    targetId: string,
    workspaceId: string,
    sessionId: string,
    beforeSessionId?: string,
  ): Promise<{ order: readonly string[] }> {
    return call<{ order: readonly string[] }>('session/reorder', {
      targetId,
      workspaceId,
      sessionId,
      ...(beforeSessionId === undefined ? {} : { beforeSessionId }),
    })
  },

  /** Read-only server directory listing for the add-workspace dialog. */
  /** Create one directory below a connected target. */
  mkdir(targetId: string, path: string): Promise<{ path: string }> {
    return call<{ path: string }>('mkdir', { targetId, path })
  },

  async fsList(targetId: string, path?: string): Promise<ListDirResult> {
    const value = await call<ServerFsList>('fs/list', { targetId, ...(path === undefined ? {} : { path }) })
    return normalizeFsList(value)
  },

  /** v2 server timeline for one session (P1 session/timeline adapter). */
  sessionTimeline(
    targetId: string,
    sessionId: string,
    options: { readonly afterSeq?: number; readonly beforeSeq?: number; readonly limit?: number } = {},
  ): Promise<SessionTimelineResult> {
    return call<SessionTimelineResult>('session/timeline', {
      targetId,
      sessionId,
      ...(options.afterSeq === undefined ? {} : { afterSeq: options.afterSeq }),
      ...(options.beforeSeq === undefined ? {} : { beforeSeq: options.beforeSeq }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
    })
  },

  /** Send one prompt to the server-side agent (server execution mode). */
  sessionPrompt(targetId: string, sessionId: string, text: string, extra: Record<string, unknown> = {}): Promise<SessionCommandResult> {
    return call<SessionCommandResult>('session/prompt', { targetId, sessionId, text, ...extra })
  },

  /** List the official slash commands available in a server session. */
  sessionCommands(targetId: string, sessionId: string): Promise<SessionCommandResult> {
    return call<SessionCommandResult>('session/commands', { targetId, sessionId })
  },

  /** Execute one official slash command against a server session. */
  sessionCommand(targetId: string, sessionId: string, line: string): Promise<SessionCommandResult> {
    return call<SessionCommandResult>('session/command', { targetId, sessionId, line })
  },

  /** List routable server models for the model seat. */
  sessionModelCatalog(targetId: string, sessionId: string): Promise<SessionModelCatalog> {
    return call<SessionModelCatalog>('session/modelCatalog', { targetId, sessionId })
  },

  /** Persist one model selection on the server session. */
  sessionSelectModel(targetId: string, sessionId: string, provider: string, model: string, reasoningEffort?: string): Promise<unknown> {
    return call('session/selectModel', { targetId, sessionId, provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) })
  },

  /** Cancel the session's current turn. */
  sessionCancel(targetId: string, sessionId: string): Promise<SessionCommandResult> {
    return call<SessionCommandResult>('session/cancel', { targetId, sessionId })
  },

  /** Allow/deny one pending approval (server-side agent). */
  sessionApproval(request: SessionApprovalRequest & { readonly targetId: string }): Promise<SessionCommandResult> {
    const { targetId, ...body } = request
    return call<SessionCommandResult>('session/approval', { targetId, ...body })
  },

  /** Running/approval/status snapshot; polls the same authoritative server. */
  sessionStatus(targetId: string, sessionId: string): Promise<SessionCommandResult> {
    return call<SessionCommandResult>('session/status', { targetId, sessionId })
  },

  /** Light refresh: reread workspace/session data; never restarts the profile. */
  stateRefresh(targetId: string): Promise<StateRefreshResult> {
    return call<StateRefreshResult>('state/refresh', { targetId })
  },

  /** Reload the official workspace registry rows without stopping the process. */
  registryRefresh(targetId: string): Promise<RegistryRefreshResult> {
    return call<RegistryRefreshResult>('registry/refresh', { targetId })
  },

  /** D20 preview for a profile restart (active turns + revision). */
  profileRestartPreview(targetId: string): Promise<ProfileRestartPreview> {
    return call<ProfileRestartPreview>('profile/restart-preview', { targetId })
  },

  /** Restart the profile server after the preview was confirmed. */
  profileRestart(targetId: string, previewRevision: string): Promise<ProfileRestartResult> {
    return call<ProfileRestartResult>('profile/restart', {
      targetId,
      confirmActiveTurns: true,
      previewRevision,
    })
  },

  /** What would auto-install vs require a button for one connection (M3). */
  deploymentPreview(targetId: string): Promise<DeploymentStateV1> {
    return call<DeploymentStateV1>('deployment/preview', { targetId })
  },

  /** Apply a deployment change; `confirm` is only ever set by the button. */
  deploymentApply(
    targetId: string,
    kind: 'runtime' | 'plugin',
    confirm?: boolean,
  ): Promise<DeploymentApplyResult> {
    return call<DeploymentApplyResult>('deployment/apply', {
      targetId,
      kind,
      ...(confirm === undefined ? {} : { confirm }),
    })
  },

  /** D20 preview for an execution-end switch. */
  modePreview(targetId: string, nextMode: ExecutorMode, targetSessionId?: string): Promise<ModeSwitchPreview> {
    return call<ModeSwitchPreview>('mode/preview', {
      targetId,
      nextMode,
      ...(targetSessionId === undefined ? {} : { targetSessionId }),
    })
  },

  /** Apply a execution-end switch; must echo the preview revision. */
  modeApply(request: ModeApplyRequest): Promise<ModeApplyResult> {
    return call<ModeApplyResult>('mode/apply', request)
  },
}
