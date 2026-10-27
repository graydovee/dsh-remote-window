/**
 * The v1 remote sidebar's app model (P3-facing).
 *
 * This is the successor to `store.ts`'s remote-tree half: server-authoritative
 * workspace/session data comes from `/api/state` + `/api/sessions`, every verb
 * is one P3 command, and view state (pin/archive/order) is written through the
 * official registry contract rather than a local copy. The legacy connection
 * wizard still uses `store.ts`; the two stores only share the client context.
 */
import { useSyncExternalStore } from 'react'
import { api, RemoteApiError, toWireError } from './api.ts'
import type { DirEntry, ListDirResult, WireError } from './api.ts'
import type {
  ConnectionStateV1, DeploymentApplyResult, DeploymentStateV1, LocalSessionResult, ProfileRestartPreview,
  PublicTargetV1, StateRefreshResult, StateResultV1,
} from './remote-api.ts'
import { openRemoteStateStream, openSessionEvents, remoteApi } from './remote-api.ts'
import type { RemoteStateEvent, SessionCommandResult } from './remote-api.ts'
import { deriveWorkspaceGroups, searchRemoteGroups } from './remote-data.ts'
import type {
  RemoteSession, RemoteSessionList, RemoteSearchResult, RemoteWorkspace, RemoteWorkspaceGroup,
  RemoteWorkspaceList,
} from './remote-data.ts'
import {
  executorErrorView, IDLE_MODE_SWITCH, modeSwitchApplyRequest, modeSwitchReducer,
} from './executor.ts'
import type {
  ExecutorErrorView, ExecutorMode, ModeSwitchState,
} from './executor.ts'
import type { ClientContext } from './context.ts'
import {
  NATIVE_MAIN_ID, closeNativeSession, openNativeSession,
} from './session-main.tsx'
import type {
  NativeSessionMainProps, NativeSessionRequest, NativeSessionStatus,
} from './session-main.tsx'
import type { ComposerAttachment, ComposerCommand, ComposerFileRef, ComposerModelGroup } from './session-composer.tsx'
import {
  adaptServerTimelineEntry, appendOptimisticUser, applyTimelineEvent, prependTimelinePage,
  timelineAfterSeq, timelineOldestSeq, upsertTimelineEntry,
} from './session-timeline.ts'
import type {
  SessionTimelineEntry, SessionTimelineUserEntry, SessionTimelineState,
} from './session-timeline.ts'
import type { ServerTimelineEntry } from './session-timeline.ts'
import { t } from './locales.ts'

/**
 * Local-mode rollout gate.
 *
 * The host's `mode/apply` runtime (executor switch + optional profile restart)
 * and the local `session/create|open` catalog/reveal wiring are not deployed
 * yet. Until they are, the settings UI may show the current execution end and
 * credentials, but must not switch modes or write `target.executor`; server-mode
 * iframe/tree are unaffected.
 */
export const LOCAL_MODE_READY = true

/** One loaded-or-loading slice. */
export interface LoadState {
  readonly loading: boolean
  readonly loaded: boolean
  readonly error?: WireError
}

/** A D20 restart flow of one connection. */
export interface RestartFlowState {
  readonly phase: 'idle' | 'previewing' | 'confirming' | 'restarting' | 'done' | 'failed'
  readonly preview?: ProfileRestartPreview
  readonly error?: ExecutorErrorView
}

/** Add-workspace dialog state (server directory browse). */
export interface AddWorkspaceState {
  readonly targetId: string
  readonly targetLabel: string
  readonly title: string
  readonly path?: string
  readonly listing?: ListDirResult
  readonly loading: boolean
  readonly creating: boolean
  readonly error?: WireError
}

/** Rename-workspace dialog state. */
export interface RenameWorkspaceState {
  readonly targetId: string
  readonly workspaceId: string
  readonly currentTitle: string
  readonly value: string
}

/** Rename-session dialog state. */
export interface RenameSessionState {
  readonly targetId: string
  readonly workspaceId: string
  readonly sessionId: string
  readonly currentTitle: string
  readonly value: string
}

/** Remove-workspace confirmation (409 retry carries `force`). */
export interface DeleteWorkspaceState {
  readonly targetId: string
  readonly workspaceId: string
  readonly title: string
  readonly path: string
  readonly force: boolean
  readonly sessionCount?: number
}

/** Archive blocked by a running turn: the official "stop and archive" retry. */
export interface ArchiveActivityState {
  readonly targetId: string
  readonly sessionId: string
  readonly title: string
  readonly activities?: readonly string[]
}

/** One connection's rendered state. */
export interface RemoteConnectionView {
  readonly target: PublicTargetV1
  readonly connection?: ConnectionStateV1
  readonly workspaces?: RemoteWorkspaceList
  readonly sessions?: RemoteSessionList
  /** Server-order groups joined with the loaded sessions (remote-data). */
  readonly groups: readonly RemoteWorkspaceGroup[]
  readonly stateLoad: LoadState
  readonly sessionsLoad: LoadState
  /** A user-initiated connect is in flight (row spins independently of state reads). */
  readonly connecting?: boolean
  /** The last user-initiated connect failed; startup must not inherit this. */
  readonly connectFailed?: boolean
  readonly expanded: Readonly<Record<string, boolean>>
  readonly mode: ExecutorMode
  readonly modeSwitch: ModeSwitchState
  readonly restart: RestartFlowState
  readonly stale: boolean
  readonly reloadError?: ExecutorErrorView
  readonly error?: WireError
}

/** The remote sidebar's complete snapshot. */
export interface RemoteAppState {
  readonly loaded: boolean
  readonly loading: boolean
  readonly error?: WireError
  readonly clientId?: string
  readonly pluginVersion: string
  readonly order: readonly string[]
  readonly connections: Readonly<Record<string, RemoteConnectionView>>
  readonly search: string
  /** The remote conversation chosen in the client sidebar. */
  readonly selection?: { readonly targetId: string; readonly workspaceId?: string; readonly sessionId?: string }
  readonly pending: boolean
  readonly notice?: { readonly kind: 'success' | 'error'; readonly text: string }
  readonly addWorkspace?: AddWorkspaceState
  readonly renameWorkspace?: RenameWorkspaceState
  readonly renameSession?: RenameSessionState
  readonly deleteWorkspace?: DeleteWorkspaceState
  readonly archiveActivity?: ArchiveActivityState
  readonly forgetTarget?: { readonly targetId: string; readonly label: string }
  /** Execution-end settings dialog target. */
  readonly modeDialog?: { readonly targetId: string }
  /** Minimal v1 connection entry (M1). */
  readonly connectDialog?: ConnectDialogState
  /** A new-session draft is being created/prepared (sidebar feedback). */
  readonly openingDraft?: { readonly targetId: string; readonly workspaceId: string }
  /** Local-mode session created/resumed but not yet visible in the client catalog. */
  readonly pendingLocalReveal?: {
    readonly targetId: string
    readonly sessionId: string
    readonly workspaceId?: string
  }
  /** v2 native server conversation (one at a time; absent when local/closed). */
  readonly native?: NativeSessionState
}

/** One open native conversation and its P3 timeline/SSE state. */
export interface NativeSessionState {
  readonly request: NativeSessionRequest
  readonly entries: readonly SessionTimelineEntry[]
  readonly status: NativeSessionStatus
  readonly hasMoreBefore: boolean
  readonly loadingBefore: boolean
  readonly reconnecting: boolean
  readonly error?: { readonly code?: string; readonly message: string }
  readonly approvalPrompt?: string
}

/** Fields and progress of the minimal v1 connect dialog. */
export interface ConnectDialogState {
  readonly phase: 'idle' | 'submitting' | 'hostkey' | 'failed'
  readonly label: string
  readonly host: string
  readonly port: string
  readonly username: string
  readonly authKind: 'password' | 'privateKey' | 'agent'
  readonly secret: string
  readonly privateKeyPath: string
  readonly dshHome: string
  /** Per-connection runtime policy; isolated never touches the shared global dsh. */
  readonly runtimePolicy: 'auto' | 'isolated'
  /** Host key awaiting explicit confirmation (`host-key-unknown`). */
  readonly fingerprint?: string
  /** Stable id for polling host-side connect progress. */
  readonly attemptId?: string
  readonly error?: WireError
}

function emptyLoad(): LoadState {
  return { loading: false, loaded: false }
}

function initialState(): RemoteAppState {
  return {
    loaded: false,
    loading: false,
    pluginVersion: '',
    order: [],
    connections: {},
    search: '',
    pending: false,
  }
}

let state: RemoteAppState = initialState()
const listeners = new Set<() => void>()
let clientContext: ClientContext | undefined
let stopStateStream: (() => void) | undefined
let stopPortalSelection: (() => void) | undefined
let stopOfficialSelection: (() => void) | undefined
/** Local-mode sessions this device revealed to the official client catalog. */
const revealedLocal = new Map<string, string>()
/** Coalesced per-target refreshes driven by the state stream. */
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** Pending local-mode reveal after a host create/resume (`session/revealed`). */
let pendingReveal: { targetId: string; sessionId: string; workspaceId?: string } | undefined

function commit(patch: Partial<RemoteAppState> | ((previous: RemoteAppState) => Partial<RemoteAppState>)): void {
  const changes = typeof patch === 'function' ? patch(state) : patch
  if (changes === undefined || Object.keys(changes).length === 0) return
  const merged: RemoteAppState = { ...state, ...changes }
  state = { ...merged, connections: deriveConnections(merged) }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function snapshot(): RemoteAppState {
  return state
}

/** Snapshot hook for the tree/sidebar. */
export function useRemoteAppState(): RemoteAppState {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** Snapshot for non-React callers. */
export function remoteAppSnapshot(): RemoteAppState {
  return state
}

/** Subscribe outside React. */
export function subscribeRemoteApp(listener: () => void): () => void {
  return subscribe(listener)
}

/** Recompute every connection's server-order groups from its two lists. */
function deriveConnections(next: RemoteAppState): RemoteAppState['connections'] {
  const out: Record<string, RemoteConnectionView> = {}
  for (const [targetId, view] of Object.entries(next.connections)) {
    const selected = next.selection?.targetId === targetId ? next.selection.sessionId : undefined
    const groups = view.workspaces === undefined
      ? []
      : deriveWorkspaceGroups(view.workspaces, view.sessions, {
        currentSessionId: selected,
      })
    out[targetId] = { ...view, groups }
  }
  return out
}

/** One writable view (the snapshot's entries are readonly). */
function patchConnection(targetId: string, patch: Partial<RemoteConnectionView>): void {
  const current = state.connections[targetId]
  if (current === undefined) return
  commit({ connections: { ...state.connections, [targetId]: { ...current, ...patch } } })
}

/** Build the initial view for one target. */
function viewFor(
  target: PublicTargetV1,
  connection: ConnectionStateV1 | undefined,
  workspaces: RemoteWorkspaceList | undefined,
  sessions: RemoteSessionList | undefined,
): RemoteConnectionView {
  return {
    target,
    ...(connection === undefined ? {} : { connection }),
    ...(workspaces === undefined ? {} : { workspaces }),
    ...(sessions === undefined ? {} : { sessions }),
    groups: [],
    stateLoad: { loading: false, loaded: connection !== undefined },
    sessionsLoad: sessions === undefined ? emptyLoad() : { loading: false, loaded: true },
    expanded: {},
    mode: target.executor ?? 'local',
    modeSwitch: IDLE_MODE_SWITCH,
    restart: { phase: 'idle' },
    stale: connection?.registry?.stale ?? false,
    ...(connection?.error === undefined ? {} : { error: connection.error }),
  }
}

/** Merge one `state/refresh` value into a connection view. */
function mergeRefresh(targetId: string, value: StateRefreshResult): void {
  const current = state.connections[targetId]
  if (current === undefined) return
  if (value.connection !== undefined && value.connection.phase !== 'ready' && current.connection?.phase === 'ready') {
    releaseTarget(targetId)
  }
  patchConnection(targetId, {
    ...(value.connection === undefined ? {} : { connection: value.connection }),
    workspaces: value.workspaces,
    sessions: value.sessions,
    stateLoad: { loading: false, loaded: true },
    stale: value.stale || value.workspaces.registry.stale === true || value.registry?.stale === true,
    ...(value.connection?.error === undefined ? {} : { error: value.connection.error }),
  })
}

function notify(kind: 'success' | 'error', text: string): void {
  commit({ notice: { kind, text } })
}

function describe(error: unknown): WireError {
  return toWireError(error)
}

/**
 * One actionable sentence for a failed verb.
 *
 * The host sends stable codes; the generic fallback keeps the scrubbed server
 * message. Occupancy/stale/lock codes get product copy that says what the user
 * can do next (protocol §12).
 */
function describeFailure(error: unknown): string {
  const wire = describe(error)
  switch (wire.code) {
    case 'registry-stale':
      return t('remote.error.registryStale')
    case 'session/writer-held':
      return t('remote.error.writerHeld')
    case 'session/agent-busy':
      return t('remote.error.agentBusy')
    case 'session/archived-pin':
      return t('remote.error.archivedPin')
    case 'profile-locked':
    case 'profile-in-use':
      return t('remote.error.profileLocked')
    case 'tunnel-unavailable':
    case 'target-not-connected':
      return t('remote.error.tunnel')
    case 'session-not-found':
      return t('remote.error.sessionMissing')
    case 'agent-compose-failed':
      return t('remote.error.agentCompose')
    case 'workspace-unknown':
      return t('remote.error.workspaceMissing')
    case 'session-reveal-timeout':
      return t('remote.session.revealTimeout')
    case 'runtime-confirmation-required':
      return t('remote.error.runtimeConfirmRequired')
    case 'runtime-incompatible':
      return t('remote.error.runtimeIncompatible')
    case 'plugin-missing':
      return t('remote.error.pluginMissing')
    case 'plugin-protocol-mismatch':
      return t('remote.error.pluginProtocol')
    case 'profile-start-failed':
    case 'profile-start-timeout':
      return t('remote.error.profileStart')
    case 'bootstrap-timeout':
      return t('remote.error.bootstrap')
    case 'plugin-install-confirmation-required':
      return t('remote.deploy.pluginConfirmRequired')
    case 'plugin-profile-not-managed':
      return t('remote.deploy.pluginNotManaged')
    case 'runtime-global-unsupported':
      return t('remote.deploy.globalUnsupported')
    case 'deployment-confirmation-required':
      return t('remote.error.runtimeConfirmRequired')
    default:
      return wire.message
  }
}

/**
 * A `registry-stale` write failure means another process changed the shared
 * workspace file since this profile loaded it. Surface the reload affordance
 * immediately; otherwise the user sees only a toast and has no banner button.
 */
function markStaleOnError(targetId: string, error: unknown): void {
  if (describe(error).code !== 'registry-stale') return
  const current = state.connections[targetId]
  if (current === undefined) return
  patchConnection(targetId, { stale: true })
}

/** Map any thrown value to the executor error surface (keeps public details). */
function executorWireError(error: unknown): ExecutorErrorView {
  if (error instanceof RemoteApiError) {
    return executorErrorView({ code: error.code, message: error.message, details: error.details })
  }
  return executorErrorView({ code: 'internal', message: error instanceof Error ? error.message : String(error) })
}

/* ------------------------------------------------------------- initial read */

/** First-paint load: targets, connection states and workspace lists. */
export async function loadRemoteState(): Promise<void> {
  if (state.loading) return
  commit({ loading: true, error: undefined })
  try {
    const value: StateResultV1 = await remoteApi.state()
    const connections: Record<string, RemoteConnectionView> = {}
    const order: string[] = []
    for (const target of value.targets) {
      order.push(target.id)
      const sessions = value.sessions?.[target.id]
      connections[target.id] = viewFor(
        target,
        value.connections[target.id],
        value.workspaces[target.id],
        sessions,
      )
    }
    // A legacy target that is already ready still opens its connection row
    // while the host has not yet added `connections` to `/api/state`.
    const expanded: Record<string, boolean> = {}
    for (const target of value.targets) {
      const connectionPhase = value.connections[target.id]?.phase
      if (connectionPhase === 'ready' || connectionPhase === 'degraded') {
        expanded[targetNodeKey(target.id)] = true
      }
    }
    const mappedConnections = Object.fromEntries(Object.entries(connections).map(([id, view]) => [
      id,
      { ...view, expanded: expanded[targetNodeKey(id)] === true ? { [targetNodeKey(id)]: true } : {} },
    ]))
    commit({
      loaded: true,
      loading: false,
      clientId: value.clientId,
      pluginVersion: value.pluginVersion,
      order,
      connections: mappedConnections,
    })
    for (const target of value.targets) {
      const phase = value.connections[target.id]?.phase
      const ready = phase === 'ready' || phase === 'degraded'
      if (ready && value.sessions?.[target.id] === undefined) void loadRemoteSessions(target.id)
    }
  } catch (error) {
    commit({ loading: false, loaded: true, error: describe(error) })
  }
}

/** Read every connected target again (the toolbar's lightweight refresh). */
export async function refreshAllRemote(): Promise<void> {
  const targets = state.order.filter(targetId => {
    const view = state.connections[targetId]
    return view?.connection?.phase === 'ready' || view?.connection?.phase === 'degraded'
  })
  await Promise.all(targets.map(targetId => refreshTargetComplete(targetId)))
}

/**
 * One user refresh: light reread, then load external registry changes when the
 * first read reports stale. `registry/refresh` does not cancel turns, so this
 * keeps the single-click refresh honest (D12) without changing the protocol's
 * lightweight `state/refresh` semantics.
 */
export async function refreshTargetComplete(targetId: string): Promise<void> {
  await refreshRemoteTarget(targetId)
  if (state.connections[targetId]?.stale === true) await loadRegistryChanges(targetId)
}

/** Light refresh of one target; never restarts the profile (protocol §16.3). */
export async function refreshRemoteTarget(targetId: string): Promise<void> {
  const current = state.connections[targetId]
  if (current === undefined || current.stateLoad.loading) return
  if (current.connection?.phase !== 'ready' && current.connection?.phase !== 'degraded') return
  patchConnection(targetId, { stateLoad: { ...current.stateLoad, loading: true } })
  try {
    const value = await remoteApi.stateRefresh(targetId)
    mergeRefresh(targetId, value)
    if (value.stale) {
      commit(previous => ({
        connections: {
          ...previous.connections,
          [targetId]: { ...previous.connections[targetId]!, stale: true },
        },
      }))
    }
  } catch (error) {
    patchConnection(targetId, {
      stateLoad: { loading: false, loaded: true, error: describe(error) },
      error: describe(error),
    })
  }
}

/** Load the full session list for one target on demand. */
export async function loadRemoteSessions(targetId: string, force = false): Promise<void> {
  const current = state.connections[targetId]
  if (current === undefined) return
  if (current.connection?.phase !== 'ready' && current.connection?.phase !== 'degraded') return
  if (current.sessionsLoad.loading || (current.sessionsLoad.loaded && !force)) return
  patchConnection(targetId, { sessionsLoad: { ...current.sessionsLoad, loading: true } })
  try {
    const value = await remoteApi.sessions(targetId)
    patchConnection(targetId, { sessions: value, sessionsLoad: { loading: false, loaded: true } })
  } catch (error) {
    patchConnection(targetId, {
      sessionsLoad: { loading: false, loaded: true, error: describe(error) },
    })
  }
}

/* --------------------------------------------------------------- expansion */

/** Tree node keys; the tree keeps expansion local to the client. */
export function targetNodeKey(targetId: string): string {
  return `target:${targetId}`
}

/** @see targetNodeKey */
export function workspaceNodeKey(workspaceId: string): string {
  return `workspace:${workspaceId}`
}

/** Toggle one node; expanding a connection also lazy-loads its sessions. */
export function toggleRemoteNode(targetId: string, key: string): void {
  const current = state.connections[targetId]
  if (current === undefined) return
  const expanded = !(current.expanded[key] ?? false)
  patchConnection(targetId, { expanded: { ...current.expanded, [key]: expanded } })
  if (!expanded) return
  if (key.startsWith('target:') || key.startsWith('workspace:')) void loadRemoteSessions(targetId)
}

/** Collapse one connection's whole subtree (disconnect/refresh). */
export function collapseRemoteTarget(targetId: string): void {
  const current = state.connections[targetId]
  if (current === undefined) return
  patchConnection(targetId, { expanded: {} })
}

/* --------------------------------------------------------------- selection */

/**
 * A user-initiated connect must not hang the row forever. Reconnect can also
 * trigger the one-time isolated-runtime build/upload, which is much slower than
 * an ordinary profile start, so the safety net is generous.
 */
const CONNECT_TIMEOUT_MS = 10 * 60_000

/** Settle with the connect promise, or reject with a readable timeout. */
async function reconnectWithTimeout(targetId: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      remoteApi.reconnect(targetId),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error(t('remote.connect.timeout'))) }, CONNECT_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Connect one saved target through the v1 route, then reread it. */
export async function connectRemoteTarget(targetId: string): Promise<void> {
  const view = state.connections[targetId]
  if (view === undefined || view.connecting === true) return
  patchConnection(targetId, { connecting: true, connectFailed: false, error: undefined })
  commit({ pending: true })
  try {
    await reconnectWithTimeout(targetId)
    patchConnection(targetId, { connecting: false })
    await loadRemoteState()
    await loadRemoteSessions(targetId, true)
  } catch (error) {
    await refreshRemoteTarget(targetId).catch(() => undefined)
    patchConnection(targetId, { connecting: false, connectFailed: true, error: describe(error) })
    notify('error', t('remote.connect.failed', { message: describeFailure(error) }))
  } finally {
    patchConnection(targetId, { connecting: false })
    commit({ pending: false })
  }
}

/** Stop one target's profile and fold its subtree away. */
export async function disconnectRemoteTarget(targetId: string): Promise<void> {
  commit({ pending: true })
  try {
    await remoteApi.stop(targetId)
    const view = state.connections[targetId]
    if (view !== undefined) {
      patchConnection(targetId, {
        connection: view.connection === undefined ? undefined : { ...view.connection, phase: 'stopped', error: undefined },
        connecting: false,
        connectFailed: false,
        error: undefined,
        sessions: undefined,
        sessionsLoad: { loading: false, loaded: false },
        expanded: {},
      })
    }
    releaseTarget(targetId)
    await loadRemoteState()
  } catch (error) {
    patchConnection(targetId, { error: describe(error) })
  } finally {
    commit({ pending: false })
  }
}

/** Ask before forgetting a connection (destructive). */
export function requestForgetTarget(targetId: string): void {
  const view = state.connections[targetId]
  if (view === undefined) return
  commit({ forgetTarget: { targetId, label: view.target.label } })
}

export function closeForgetTarget(): void {
  commit({ forgetTarget: undefined })
}

/** Forget one connection after the dialog. */
export async function submitForgetTarget(): Promise<void> {
  const request = state.forgetTarget
  if (request === undefined) return
  commit({ pending: true })
  try {
    await remoteApi.forget(request.targetId)
    releaseTarget(request.targetId)
    commit({ forgetTarget: undefined })
    notify('success', t('list.forgotTarget', { label: request.label }))
    await loadRemoteState()
  } catch (error) {
    notify('error', t('remote.verb.failed', { action: t('tree.forgetConnection'), message: describeFailure(error) }))
  } finally {
    commit({ pending: false })
  }
}

/** Set the local search query (never sent to the server). */
export function setRemoteSearch(query: string): void {
  commit({ search: query })
}

/** Derived search over one connection's groups (local, not persisted). */
export function remoteSearchFor(targetId: string, query: string = state.search): RemoteSearchResult | undefined {
  const view = state.connections[targetId]
  if (view === undefined) return undefined
  return searchRemoteGroups(view.groups, query)
}

/** Find a workspace row in the snapshot. */
function findWorkspace(targetId: string, workspaceId: string): RemoteWorkspace | undefined {
  return state.connections[targetId]?.workspaces?.workspaces.find(row => row.workspaceId === workspaceId)
}

/** Find a session row in the snapshot. */
function findSession(targetId: string, sessionId: string): RemoteSession | undefined {
  return state.connections[targetId]?.sessions?.sessions.find(row => row.sessionId === sessionId)
}

function selectPanel(id: string | null): void {
  try {
    const layout = clientContext?.get('layout') as { selectPanel?(panelId: string | null): void } | undefined
    layout?.selectPanel?.(id)
  } catch (error) {
    console.error('[dsh-remote-workspace] layout.selectPanel failed', error)
  }
}

/**
 * Prepare the profile server's managed agent for one session.
 *
 * M1 fallback: while the P3 prepare route is not deployed yet, opening the
 * configured session must still reach the native main area (the server agent
 * resumes lazily; the later switch falls back to a restart). A real composition
 * failure (`agent-compose-failed`) is still fatal: the conversation must not
 * open onto a broken agent.
 * @returns `managed` when the plugin holds the handle, `unmanaged` when the
 *   server explicitly says it could not, and `unavailable` when the route is
 *   missing on the current host.
 */
async function prepareServerSession(targetId: string, sessionId: string): Promise<'managed' | 'unmanaged' | 'unavailable'> {
  try {
    const prepared = await remoteApi.sessionPrepareServer(targetId, sessionId)
    return prepared.managed ? 'managed' : 'unmanaged'
  } catch (error) {
    const wire = describe(error)
    if (wire.code === 'agent-compose-failed') throw error
    console.warn('[dsh-remote-workspace] session/prepare-server unavailable; opening the native main without a managed handle', wire)
    return 'unavailable'
  }
}


/* ------------------------------------------------------- v2 native session */

/** Tear down the native conversation's SSE stream and retry timer. */
let stopNativeEvents: (() => void) | undefined
let nativeReconnectTimer: ReturnType<typeof setTimeout> | undefined
let nativeReconnectAttempt = 0
/** Monotonic generation: stale async callbacks must not patch a newer session. */
let nativeGeneration = 0

/** Map one timeline page payload; both v2 fields and loose aliases are accepted. */
function parseTimelinePage(value: unknown): { entries: SessionTimelineEntry[]; nextBeforeSeq: number | null } {
  if (value === null || typeof value !== 'object') return { entries: [], nextBeforeSeq: null }
  const row = value as { entries?: unknown; events?: unknown; nextBeforeSeq?: unknown; beforeSeq?: unknown }
  const raw = Array.isArray(row.entries) ? row.entries : Array.isArray(row.events) ? row.events : []
  const entries = raw.map(item => adaptServerTimelineEntry(item as ServerTimelineEntry))
  const next = row.nextBeforeSeq
  return {
    entries,
    nextBeforeSeq: typeof next === 'number' ? next : typeof row.beforeSeq === 'number' && entries.length > 0 ? null : null,
  }
}

/** Read one page of the server timeline. */
async function fetchNativePage(
  targetId: string,
  sessionId: string,
  options: { readonly beforeSeq?: number; readonly limit?: number } = {},
): Promise<{ entries: SessionTimelineEntry[]; hasMoreBefore: boolean }> {
  const value = await remoteApi.sessionTimeline(targetId, sessionId, options)
  const page = parseTimelinePage(value)
  return { entries: page.entries, hasMoreBefore: page.nextBeforeSeq !== null && page.nextBeforeSeq !== undefined }
}

/** Map a `session/status` result to the native header/composer state. */
function nativeStatusOf(result: SessionCommandResult | undefined): NativeSessionStatus {
  if (result === undefined) return 'idle'
  const approvals = result['pendingApprovals']
  if (Array.isArray(approvals) && approvals.length > 0) return 'waiting-approval'
  return result.running === true ? 'running' : 'idle'
}

/** Pending approvals as timeline rows (so the approval card renders immediately). */
function nativeApprovalEntries(result: SessionCommandResult | undefined): SessionTimelineEntry[] {
  const approvals = result?.['pendingApprovals']
  if (!Array.isArray(approvals)) return []
  const entries: SessionTimelineEntry[] = []
  for (const raw of approvals) {
    if (raw === null || typeof raw !== 'object') continue
    const approval = raw as { approvalId?: unknown; toolName?: unknown; reason?: unknown; callId?: unknown }
    if (typeof approval.approvalId !== 'string' || approval.approvalId === '') continue
    entries.push({
      id: `approval:${approval.approvalId}`,
      kind: 'approval',
      approvalId: approval.approvalId,
      status: 'pending',
      ...(typeof approval.toolName === 'string' ? { toolName: approval.toolName } : {}),
      ...(typeof approval.callId === 'string' ? { callId: approval.callId } : {}),
      ...(typeof approval.reason === 'string' ? { reason: approval.reason } : {}),
    })
  }
  return entries
}

/** First pending approval's human reason, when the server exposes one. */
function nativeApprovalPrompt(result: SessionCommandResult | undefined): string | undefined {
  const approvals = result?.['pendingApprovals']
  if (!Array.isArray(approvals) || approvals.length === 0) return undefined
  const first = approvals[0] as { reason?: unknown; displayReason?: unknown; toolName?: unknown }
  if (typeof first.reason === 'string' && first.reason !== '') return first.reason
  if (first.displayReason !== null && typeof first.displayReason === 'object') {
    const label = Object.values(first.displayReason as Record<string, unknown>).find(value => typeof value === 'string')
    if (typeof label === 'string') return label
  }
  return typeof first.toolName === 'string' ? first.toolName : undefined
}

/** Patch the open native state (no-op after the conversation was closed). */
function patchNative(patch: Partial<NativeSessionState> | ((previous: NativeSessionState) => Partial<NativeSessionState>)): void {
  const previous = state.native
  if (previous === undefined) return
  const changes = typeof patch === 'function' ? patch(previous) : patch
  if (Object.keys(changes).length === 0) return
  commit({ native: { ...previous, ...changes } })
}

/** Stop the SSE stream and schedule no further reconnects. */
function stopNativeStream(): void {
  if (nativeReconnectTimer !== undefined) {
    clearTimeout(nativeReconnectTimer)
    nativeReconnectTimer = undefined
  }
  stopNativeEvents?.()
  stopNativeEvents = undefined
  nativeReconnectAttempt = 0
}

/** Close the native conversation (SSE + request + state). */
function closeNativeView(): void {
  nativeGeneration += 1
  stopNativeStream()
  closeNativeSession()
  if (state.native !== undefined) commit({ native: undefined })
}

/** Merge server timeline rows, dropping an optimistic user row when its echo lands. */
function mergeNativeEntries(current: readonly SessionTimelineEntry[], incoming: readonly SessionTimelineEntry[]): readonly SessionTimelineEntry[] {
  let next: readonly SessionTimelineEntry[] = [...current]
  for (const entry of incoming) {
    if (entry.kind === 'user') {
      const text = entry.text.trim()
      const pending = next.find(candidate =>
        candidate.kind === 'user' && candidate.clientId !== undefined && candidate.pending === true
        && candidate.text.trim() === text)
      if (pending !== undefined && pending.kind === 'user' && pending.clientId !== undefined) {
        next = applyTimelineEvent(
          { entries: next, hasMoreBefore: state.native?.hasMoreBefore ?? false },
          { type: 'replace-user', clientId: pending.clientId, entry: entry as SessionTimelineUserEntry },
        ).entries
        continue
      }
    }
    next = upsertTimelineEntry(next, entry)
  }
  return next
}

/** Handle one decoded P1 SSE frame for the open native conversation. */
function handleNativeFrame(generation: number, frame: { readonly event: string; readonly data: string }): void {
  if (generation !== nativeGeneration || state.native === undefined) return
  let parsed: unknown
  try { parsed = JSON.parse(frame.data) } catch { return }
  let name = frame.event
  if (parsed !== null && typeof parsed === 'object' && typeof (parsed as { event?: unknown }).event === 'string') {
    name = (parsed as { event: string }).event
  }
  const payload = parsed !== null && typeof parsed === 'object' && 'data' in (parsed as Record<string, unknown>)
    && typeof (parsed as { data?: unknown }).data === 'object'
    ? (parsed as { data: unknown }).data
    : parsed
  if (payload === null || typeof payload !== 'object') return
  const value = payload as Record<string, unknown>
  switch (name) {
    case 'timeline': {
      const entries = Array.isArray(value['entries'])
        ? value['entries'].map(item => adaptServerTimelineEntry(item as ServerTimelineEntry))
        : []
      if (entries.length > 0) patchNative(previous => ({ entries: mergeNativeEntries(previous.entries, entries) }))
      return
    }
    case 'status': {
      const statusValue = value as SessionCommandResult
      const status = nativeStatusOf(statusValue)
      const prompt = nativeApprovalPrompt(statusValue)
      patchNative(previous => ({
        entries: mergeNativeEntries(previous.entries, nativeApprovalEntries(statusValue)),
        status,
        ...(prompt === undefined ? { approvalPrompt: undefined } : { approvalPrompt: prompt }),
      }))
      return
    }
    case 'approval': {
      const summary = value as { approvalId?: unknown; toolName?: unknown; reason?: unknown; requestedAt?: unknown }
      if (typeof summary.approvalId !== 'string') return
      const entry: SessionTimelineEntry = {
        id: `approval:${summary.approvalId}`,
        kind: 'approval',
        approvalId: summary.approvalId,
        status: 'pending',
        ...(typeof summary.toolName === 'string' ? { toolName: summary.toolName } : {}),
        ...(typeof summary.reason === 'string' ? { reason: summary.reason } : {}),
      }
      patchNative(previous => ({
        entries: upsertTimelineEntry(previous.entries, entry),
        status: 'waiting-approval',
        ...(typeof summary.reason === 'string' ? { approvalPrompt: summary.reason } : {}),
      }))
      return
    }
    case 'error': {
      const code = typeof value['code'] === 'string' ? value['code'] : undefined
      const message = typeof value['message'] === 'string' ? value['message'] : t('remote.connect.failed', { message: '' })
      patchNative({ status: 'error', error: { message, ...(code === undefined ? {} : { code }) } })
      return
    }
    case 'ready': {
      patchNative({ reconnecting: false })
      return
    }
    default:
      return
  }
}

/** Open (or re-open) the session SSE stream at the newest known cursor. */
function openNativeStream(generation: number): void {
  const native = state.native
  if (native === undefined || generation !== nativeGeneration) return
  stopNativeStream()
  try {
    stopNativeEvents = openSessionEvents({
      targetId: native.request.targetId,
      sessionId: native.request.sessionId,
      afterSeq: timelineAfterSeq(native.entries),
    }, {
      onEvent: frame => handleNativeFrame(generation, frame),
      onTransportError: () => {
        if (generation !== nativeGeneration || state.native === undefined) return
        patchNative({ reconnecting: true })
        const delay = Math.min(5_000, 500 * 2 ** Math.min(nativeReconnectAttempt, 4))
        nativeReconnectAttempt += 1
        nativeReconnectTimer = setTimeout(() => {
          nativeReconnectTimer = undefined
          openNativeStream(generation)
        }, delay)
      },
    })
    patchNative({ reconnecting: false })
  } catch (error) {
    patchNative({ reconnecting: true, error: { message: describeFailure(error) } })
  }
}

/** Load the newest page and the live status, then attach the SSE stream. */
async function hydrateNative(generation: number): Promise<void> {
  const native = state.native
  if (native === undefined || generation !== nativeGeneration) return
  patchNative({ status: 'loading', error: undefined })
  try {
    const [page, status] = await Promise.all([
      fetchNativePage(native.request.targetId, native.request.sessionId, { limit: 80 }),
      remoteApi.sessionStatus(native.request.targetId, native.request.sessionId).catch(() => undefined),
    ])
    if (generation !== nativeGeneration || state.native === undefined) return
    const prompt = nativeApprovalPrompt(status)
    patchNative({
      entries: mergeNativeEntries(page.entries, nativeApprovalEntries(status)),
      hasMoreBefore: page.hasMoreBefore,
      status: nativeStatusOf(status),
      ...(prompt === undefined ? { approvalPrompt: undefined } : { approvalPrompt: prompt }),
    })
  } catch (error) {
    if (generation !== nativeGeneration) return
    patchNative({ status: 'error', error: { code: describe(error).code, message: describeFailure(error) } })
  }
  openNativeStream(generation)
}

/** Open one server-mode session in the native main area. */
async function openNativeSessionView(targetId: string, workspaceId: string | undefined, sessionId: string): Promise<void> {
  const view = state.connections[targetId]
  if (view === undefined) return
  const group = workspaceId === undefined
    ? view.groups.find(candidate => candidate.sessions.some(session => session.id === sessionId))
    : view.groups.find(candidate => candidate.workspace.workspaceId === workspaceId)
  const session = view.sessions?.sessions.find(row => row.sessionId === sessionId)
  const request: NativeSessionRequest = {
    targetId,
    targetLabel: view.target.label,
    sessionId,
    ...(group === undefined ? {} : { workspaceId: group.workspace.workspaceId, workspaceTitle: group.workspace.title }),
    ...(session?.title === undefined ? {} : { title: session.title }),
    ...(session?.cwd === undefined ? {} : { cwd: session.cwd }),
  }
  closeNativeView()
  const generation = nativeGeneration
  openNativeSession(request)
  ensureExpanded(targetId, request.workspaceId)
  selectPanel(NATIVE_MAIN_ID)
  commit({
    selection: {
      targetId,
      ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
      sessionId,
    },
    native: {
      request,
      entries: [],
      status: 'loading',
      hasMoreBefore: false,
      loadingBefore: false,
      reconnecting: false,
    },
  })
  await hydrateNative(generation)
}


/** Load one older timeline page for the open native conversation. */
async function loadNativeBefore(): Promise<void> {
  const native = state.native
  if (native === undefined || native.loadingBefore || !native.hasMoreBefore) return
  const cursor = timelineOldestSeq(native.entries)
  if (cursor === undefined) return
  const generation = nativeGeneration
  patchNative({ loadingBefore: true })
  try {
    const page = await fetchNativePage(native.request.targetId, native.request.sessionId, { beforeSeq: cursor, limit: 80 })
    if (generation !== nativeGeneration || state.native === undefined) return
    const merged = prependTimelinePage(
      { entries: state.native.entries, hasMoreBefore: state.native.hasMoreBefore },
      page.entries,
      page.hasMoreBefore,
    )
    patchNative({ entries: merged.entries, hasMoreBefore: merged.hasMoreBefore, loadingBefore: false })
  } catch (error) {
    if (generation !== nativeGeneration) return
    patchNative({ loadingBefore: false, error: { code: describe(error).code, message: describeFailure(error) } })
  }
}

/** Send one prompt and keep the optimistic user row until the server echoes it. */
async function sendNativePrompt(text: string, clientId: string, attachments: readonly ComposerAttachment[] = []): Promise<void> {
  const native = state.native
  if (native === undefined) return
  const optimistic = appendOptimisticUser(
    { entries: native.entries, hasMoreBefore: native.hasMoreBefore },
    { clientId, text, createdAt: Date.now() },
  )
  patchNative({ entries: optimistic.state.entries, status: 'running', error: undefined })
  try {
    await remoteApi.sessionPrompt(native.request.targetId, native.request.sessionId, text, {
      requestId: clientId,
      mode: 'followup',
      ...(attachments.length === 0 ? {} : {
        attachments: attachments.map(attachment => ({
          name: attachment.name,
          mediaType: attachment.mediaType,
          data: attachment.dataUrl.slice(attachment.dataUrl.indexOf(',') + 1),
        })),
      }),
    })
  } catch (error) {
    patchNative(previous => ({
      entries: previous.entries.filter(entry => !(entry.kind === 'user' && entry.clientId === clientId)),
      status: 'idle',
      error: { code: describe(error).code, message: describeFailure(error) },
    }))
  }
}

/** Cancel the running server turn. */
async function stopNativeSession(): Promise<void> {
  const native = state.native
  if (native === undefined) return
  try {
    await remoteApi.sessionCancel(native.request.targetId, native.request.sessionId)
    const status = await remoteApi.sessionStatus(native.request.targetId, native.request.sessionId).catch(() => undefined)
    patchNative({ status: nativeStatusOf(status), error: undefined })
  } catch (error) {
    patchNative({ error: { code: describe(error).code, message: describeFailure(error) } })
  }
}

/** Answer one pending approval request. */
async function answerNativeApproval(approvalId: string, decision: 'allow' | 'deny'): Promise<void> {
  const native = state.native
  if (native === undefined) return
  try {
    await remoteApi.sessionApproval({
      targetId: native.request.targetId,
      sessionId: native.request.sessionId,
      approvalId,
      decision,
    })
    patchNative(previous => ({
      entries: previous.entries.map(entry =>
        entry.kind === 'approval' && entry.approvalId === approvalId
          ? { ...entry, status: decision === 'allow' ? 'allowed' as const : 'denied' as const }
          : entry),
      approvalPrompt: undefined,
    }))
    const status = await remoteApi.sessionStatus(native.request.targetId, native.request.sessionId).catch(() => undefined)
    patchNative({ status: nativeStatusOf(status), ...(nativeApprovalPrompt(status) === undefined ? {} : { approvalPrompt: nativeApprovalPrompt(status) as string }) })
  } catch (error) {
    patchNative({ error: { code: describe(error).code, message: describeFailure(error) } })
  }
}

/** Reload timeline/status and reattach after a transport failure. */
async function retryNativeSession(): Promise<void> {
  if (state.native === undefined) return
  await hydrateNative(nativeGeneration)
}

/** List official slash commands for the open server session. */
async function listNativeCommands(): Promise<readonly ComposerCommand[]> {
  const native = state.native
  if (native === undefined) return []
  const result = await remoteApi.sessionCommands(native.request.targetId, native.request.sessionId)
  return (result.commands ?? []).map(command => ({ name: command.name, description: command.description }))
}

/** List the server session's routable model catalog. */
async function listNativeModels(): Promise<readonly ComposerModelGroup[]> {
  const native = state.native
  if (native === undefined) return []
  const result = await remoteApi.sessionModelCatalog(native.request.targetId, native.request.sessionId)
  return result.groups.map(group => ({ id: group.id, name: group.name, models: group.models }))
}

/** Persist one server model selection. */
async function selectNativeModel(provider: string, model: string, reasoningEffort?: string): Promise<void> {
  const native = state.native
  if (native === undefined) return
  try {
    await remoteApi.sessionSelectModel(native.request.targetId, native.request.sessionId, provider, model, reasoningEffort)
  } catch (error) {
    patchNative({ error: { code: describe(error).code, message: describeFailure(error) } })
  }
}

/** Run one official slash command (including /permission and /model). */
async function runNativeCommand(line: string): Promise<void> {
  const native = state.native
  if (native === undefined) return
  try {
    await remoteApi.sessionCommand(native.request.targetId, native.request.sessionId, line)
  } catch (error) {
    patchNative({ error: { code: describe(error).code, message: describeFailure(error) } })
  }
}

/** Resolve `@` suggestions from the session cwd. */
async function searchNativeFiles(query: string): Promise<readonly ComposerFileRef[]> {
  const native = state.native
  if (native === undefined) return []
  const listing = await remoteApi.fsList(native.request.targetId, native.request.cwd)
  const needle = query.toLowerCase()
  return listing.entries
    .filter(entry => entry.name.toLowerCase().includes(needle))
    .slice(0, 20)
    .map(entry => ({ name: entry.name, path: entry.path, directory: entry.type === 'directory' }))
}

/**
 * Props for the controlled native main area.
 *
 * The component is pure; all P3 state, SSE and command dispatch live here so the
 * view can be tested without a network.
 */
export function useNativeSessionMainProps(): NativeSessionMainProps | undefined {
  const snapshot = useRemoteAppState()
  const native = snapshot.native
  if (native === undefined) return undefined
  return {
    request: native.request,
    entries: native.entries,
    status: native.status,
    hasMoreBefore: native.hasMoreBefore,
    loadingBefore: native.loadingBefore,
    reconnecting: native.reconnecting,
    ...(native.error === undefined ? {} : { error: native.error }),
    ...(native.approvalPrompt === undefined ? {} : { approvalPrompt: native.approvalPrompt }),
    attachmentReason: t('session.composer.attachmentsDisabled'),
    onLoadBefore: () => loadNativeBefore(),
    onSend: (text, clientId, attachments) => sendNativePrompt(text, clientId, attachments),
    onCommand: line => runNativeCommand(line),
    onListCommands: () => listNativeCommands(),
    onListModels: () => listNativeModels(),
    onSelectModel: (provider, model, reasoningEffort) => selectNativeModel(provider, model, reasoningEffort),
    onSearchFiles: query => searchNativeFiles(query),
    onPermission: preset => runNativeCommand(`/permission ${preset}`),
    onStop: () => stopNativeSession(),
    onApproval: (approvalId, decision) => answerNativeApproval(approvalId, decision),
    onRetry: () => retryNativeSession(),
  }
}

/** Close the remote main area and return to the official conversation. */
export function clearRemoteSelection(closeLocal = false): void {
  if (closeLocal) releaseLocalSelection()
  closeNativeView()
  commit({ selection: undefined })
  selectPanel(null)
}

/** Open the connection/workspace nodes around one row (tree selection). */
function ensureExpanded(targetId: string, workspaceId: string | undefined): void {
  const view = state.connections[targetId]
  if (view === undefined) return
  patchConnection(targetId, {
    expanded: {
      ...view.expanded,
      [targetNodeKey(targetId)]: true,
      ...(workspaceId === undefined ? {} : { [workspaceNodeKey(workspaceId)]: true }),
    },
  })
}

/** Open one server-mode session in the native main area (prepared agent first). */
async function openServerSession(targetId: string, workspaceId: string | undefined, sessionId: string): Promise<void> {
  const view = state.connections[targetId]
  if (view === undefined) return
  const prepared = await prepareServerSession(targetId, sessionId)
  if (prepared === 'unmanaged') notify('error', t('remote.prepare.unmanaged'))
  await openNativeSessionView(targetId, workspaceId, sessionId)
}

/** Open one stored session in the mode-appropriate main area. */
export async function openRemoteSession(targetId: string, sessionId: string): Promise<void> {
  const view = state.connections[targetId]
  if (view === undefined) return
  if (view.mode === 'local' && !LOCAL_MODE_READY) {
    notify('error', t('remote.error.localPending'))
    return
  }
  const workspaceId = view.groups.find(group => group.sessions.some(session => session.id === sessionId))?.workspace.workspaceId
    ?? (state.selection?.targetId === targetId ? state.selection.workspaceId : undefined)
  // D5: an existing session keeps the execution end recorded on the server;
  // M2g exposes it on the row. Older servers have no field: fall back to the
  // connection mode so a whole-connection local run still opens locally.
  const sessionExecutor = view.sessions?.sessions.find(row => row.sessionId === sessionId)?.executor ?? view.mode
  commit({ pending: true })
  try {
    if (sessionExecutor === 'server') {
      await openServerSession(targetId, workspaceId, sessionId)
    } else {
      await openLocalSession(targetId, sessionId, workspaceId)
    }
  } catch (error) {
    notify('error', t('remote.connect.failed', { message: describeFailure(error) }))
  } finally {
    commit({ pending: false })
  }
}

/** The workspace's existing blank session, if the server list exposes one. */
function existingBlankSession(
  view: RemoteConnectionView,
  workspaceId: string,
): RemoteSession | undefined {
  return view.sessions?.sessions.find(row =>
    row.blank === true
    && (row.workspaceId === workspaceId || view.groups.some(group =>
      group.workspace.workspaceId === workspaceId && group.workspace.sessionIds.includes(row.sessionId))),
  )
}

/** Enter the official draft for one workspace, reusing its existing blank. */
export async function openRemoteDraft(targetId: string, workspaceId: string): Promise<void> {
  const view = state.connections[targetId]
  if (view === undefined) return
  if (view.mode === 'local' && !LOCAL_MODE_READY) {
    notify('error', t('remote.error.localPending'))
    return
  }
  commit({ openingDraft: { targetId, workspaceId } })
  const pendingLocal = state.pendingLocalReveal
  if (view.mode === 'local' && pendingLocal?.targetId === targetId && pendingLocal.workspaceId === workspaceId) {
    // A retry must not create a second blank: the first one already exists.
    await retryPendingLocalReveal()
    return
  }
  commit({ pending: true })
  try {
    // A workspace has at most one unrevealed draft; clicking "new session"
    // again must open that stored blank, never mint a second session.
    const existingDraft = existingBlankSession(view, workspaceId)
    if (existingDraft !== undefined) {
      const executor = existingDraft.executor ?? view.mode
      if (executor === 'server') {
        await openServerSession(targetId, workspaceId, existingDraft.sessionId)
      } else {
        try {
          await revealLocalSession(targetId, existingDraft.sessionId, workspaceId)
          commit({ pendingLocalReveal: undefined })
        } catch (error) {
          commit({ pendingLocalReveal: { targetId, workspaceId, sessionId: existingDraft.sessionId } })
          throw error
        }
      }
      return
    }
    if (view.mode === 'server') {
      const created = await remoteApi.sessionCreate({ targetId, workspaceId, executor: 'server' })
      if (created.sessionId === '') {
        throw new RemoteApiError('session-create-failed', t('remote.draft.failed', { message: '' }), 500)
      }
      await refreshRemoteTarget(targetId)
      await loadRemoteSessions(targetId, true)
      await openServerSession(targetId, workspaceId, created.sessionId)
    } else {
      const created = await remoteApi.sessionCreate({ targetId, workspaceId, executor: 'local' })
      if (created.sessionId === '') {
        throw new RemoteApiError('session-create-failed', t('remote.draft.failed', { message: '' }), 500)
      }
      if (created.executor === 'server') {
        // The host record wins over the connection default; never force a
        // server session into the client execution UI.
        await openServerSession(targetId, workspaceId, created.sessionId)
        return
      }
      try {
        await revealLocalSession(targetId, created.sessionId, workspaceId)
        commit({ pendingLocalReveal: undefined })
      } catch (error) {
        commit({ pendingLocalReveal: { targetId, workspaceId, sessionId: created.sessionId } })
        throw error
      }
    }
    await refreshRemoteTarget(targetId)
    await loadRemoteSessions(targetId, true)
  } catch (error) {
    if (describe(error).code === 'session-reveal-timeout') {
      notify('error', t('remote.session.revealTimeout'))
    } else {
      notify('error', t('remote.draft.failed', { message: describeFailure(error) }))
    }
  } finally {
    commit({ pending: false, openingDraft: undefined })
  }
}

/** Reload and re-open the remote session after a mode switch (best effort). */
async function reopenAfterModeSwitch(targetId: string): Promise<void> {
  const selection = state.selection
  if (selection === undefined || selection.targetId !== targetId || selection.sessionId === undefined) return
  await openRemoteSession(targetId, selection.sessionId)
}

/* --------------------------------------------------------- session actions */

export function requestRenameSession(targetId: string, sessionId: string): void {
  const session = findSession(targetId, sessionId)
  if (session === undefined) return
  const workspaceId = state.connections[targetId]?.groups
    .find(group => group.sessions.some(row => row.id === sessionId))?.workspace.workspaceId ?? ''
  commit({
    renameSession: {
      targetId,
      workspaceId,
      sessionId,
      currentTitle: session.title ?? '',
      value: session.title ?? '',
    },
  })
}

export function setRenameSessionValue(value: string): void {
  if (state.renameSession === undefined) return
  commit({ renameSession: { ...state.renameSession, value } })
}

export function closeRenameSession(): void {
  commit({ renameSession: undefined })
}

/** Rename one session through P1 (server-authoritative title). */
export async function submitRenameSession(): Promise<void> {
  const request = state.renameSession
  if (request === undefined) return
  const title = request.value.trim()
  if (title === '') return
  commit({ pending: true })
  try {
    await remoteApi.sessionRename(request.targetId, request.sessionId, title)
    commit({ renameSession: undefined, pending: false })
    notify('success', t('remote.session.renamed'))
    await refreshRemoteTarget(request.targetId)
    await loadRemoteSessions(request.targetId, true)
  } catch (error) {
    markStaleOnError(request.targetId, error)
    notify('error', t('remote.session.renameFailed', { message: describeFailure(error) }))
    commit({ pending: false })
  }
}

/** Pin/unpin through the official registry set. */
export async function toggleSessionPin(targetId: string, sessionId: string): Promise<void> {
  const session = findSession(targetId, sessionId)
  if (session === undefined) return
  commit({ pending: true })
  try {
    await remoteApi.sessionPin(targetId, sessionId, !session.pinned)
    notify('success', t(session.pinned ? 'remote.session.unpinned' : 'remote.session.pinned'))
    await refreshRemoteTarget(targetId)
    await loadRemoteSessions(targetId, true)
  } catch (error) {
    markStaleOnError(targetId, error)
    notify('error', t('remote.verb.failed', { action: t('remote.session.pin'), message: describeFailure(error) }))
  } finally {
    commit({ pending: false })
  }
}

/** Archive/unarchive; a running turn moves to the official confirm-retry. */
export async function toggleSessionArchive(targetId: string, sessionId: string, stopActivity = false): Promise<void> {
  const session = findSession(targetId, sessionId)
  if (session === undefined) return
  const archived = !session.archived
  commit({ pending: true })
  try {
    await remoteApi.sessionArchive(targetId, sessionId, archived, stopActivity || undefined)
    commit({ archiveActivity: undefined })
    if (archived && state.selection?.targetId === targetId && state.selection.sessionId === sessionId) {
      // The official archive action clears the current conversation; keep the
      // main area from showing a conversation the sidebar just removed.
      clearRemoteSelection()
    }
    notify('success', t(archived ? 'remote.session.archived' : 'remote.session.unarchived'))
    await refreshRemoteTarget(targetId)
    await loadRemoteSessions(targetId, true)
  } catch (error) {
    markStaleOnError(targetId, error)
    const wire = describe(error)
    if (archived && wire.code === 'session/archive-activity') {
      const details = error instanceof RemoteApiError ? error.details : undefined
      const raw = details !== null && typeof details === 'object'
        ? (details as { activities?: unknown; activity?: unknown }).activities
          ?? (details as { activities?: unknown; activity?: unknown }).activity
        : undefined
      const activities = Array.isArray(raw)
        ? raw.filter((item): item is string => typeof item === 'string')
        : typeof raw === 'string' ? [raw] : undefined
      commit({
        archiveActivity: {
          targetId,
          sessionId,
          title: session.title ?? sessionId,
          ...(activities === undefined ? {} : { activities }),
        },
      })
    } else {
      notify('error', t('remote.verb.failed', { action: t('remote.session.archive'), message: describeFailure(error) }))
    }
  } finally {
    commit({ pending: false })
  }
}

/** Fork a session; a migration-required failure offers "open the source". */
export async function forkRemoteSession(targetId: string, sessionId: string): Promise<void> {
  commit({ pending: true })
  try {
    const created = await remoteApi.sessionFork(targetId, sessionId)
    notify('success', t('remote.session.forked'))
    await refreshRemoteTarget(targetId)
    await loadRemoteSessions(targetId, true)
    await openRemoteSession(targetId, created.sessionId)
  } catch (error) {
    markStaleOnError(targetId, error)
    const wire = describe(error)
    if (wire.code === 'session/migration-required') {
      notify('error', t('remote.session.forkNeedsOpen'))
    } else {
      notify('error', t('remote.verb.failed', { action: t('remote.session.fork'), message: describeFailure(error) }))
    }
  } finally {
    commit({ pending: false })
  }
}

/** Persist one drag result through the official reorder route. */
export async function reorderSessions(
  targetId: string,
  workspaceId: string,
  sessionId: string,
  beforeSessionId: string | undefined,
): Promise<void> {
  try {
    await remoteApi.sessionReorder(targetId, workspaceId, sessionId, beforeSessionId)
    await refreshRemoteTarget(targetId)
    await loadRemoteSessions(targetId, true)
  } catch (error) {
    markStaleOnError(targetId, error)
    notify('error', t('remote.verb.failed', { action: t('remote.session.reorder'), message: describeFailure(error) }))
  }
}

/** Persist one workspace drag result. */
export async function reorderWorkspaces(targetId: string, workspaceId: string, beforeWorkspaceId: string | undefined): Promise<void> {
  try {
    await remoteApi.workspaceReorder(targetId, workspaceId, beforeWorkspaceId)
    await refreshRemoteTarget(targetId)
  } catch (error) {
    markStaleOnError(targetId, error)
    notify('error', t('remote.verb.failed', { action: t('remote.workspace.reorder'), message: describeFailure(error) }))
  }
}

/* ------------------------------------------------------- workspace actions */

/** Open the add-workspace directory browser for one connection. */
export async function openAddWorkspace(targetId: string): Promise<void> {
  const view = state.connections[targetId]
  if (view === undefined) return
  commit({
    addWorkspace: {
      targetId,
      targetLabel: view.target.label,
      title: '',
      loading: true,
      creating: false,
    },
  })
  try {
    const listing = await remoteApi.fsList(targetId)
    commit(previous => previous.addWorkspace === undefined ? {} : {
      addWorkspace: {
        ...previous.addWorkspace,
        listing,
        path: listing.path,
        title: previous.addWorkspace.title === '' ? basename(listing.path) : previous.addWorkspace.title,
        loading: false,
      },
    })
  } catch (error) {
    commit(previous => previous.addWorkspace === undefined ? {} : {
      addWorkspace: { ...previous.addWorkspace, loading: false, error: describe(error) },
    })
  }
}

/** Navigate the add-workspace browser. */
export async function browseAddWorkspace(path: string, options: { preservePath?: boolean } = {}): Promise<void> {
  const request = state.addWorkspace
  if (request === undefined || request.loading) return
  commit({ addWorkspace: { ...request, loading: true, error: undefined } })
  try {
    const listing = await remoteApi.fsList(request.targetId, path)
    commit(previous => previous.addWorkspace === undefined ? {} : {
      addWorkspace: {
        ...previous.addWorkspace,
        listing,
        ...(options.preservePath === true
          ? {}
          : { path: listing.path, title: basename(listing.path) }),
        loading: false,
      },
    })
  } catch (error) {
    commit(previous => previous.addWorkspace === undefined ? {} : {
      addWorkspace: { ...previous.addWorkspace, loading: false, error: describe(error) },
    })
  }
}

/** Manually set the server path (fs/list may not be deployed yet). */
export function setAddWorkspacePath(path: string): void {
  const request = state.addWorkspace
  if (request === undefined) return
  commit({ addWorkspace: { ...request, path, error: undefined } })
}

export function setAddWorkspaceTitle(title: string): void {
  const request = state.addWorkspace
  if (request === undefined) return
  commit({ addWorkspace: { ...request, title } })
}

export function closeAddWorkspace(): void {
  commit({ addWorkspace: undefined })
}

/** Register the browsed directory as an official workspace. */
export async function submitAddWorkspace(): Promise<void> {
  const request = state.addWorkspace
  if (request === undefined || request.path === undefined) return
  commit({ addWorkspace: { ...request, creating: true } })
  try {
    await remoteApi.workspaceCreate(request.targetId, request.path, request.title.trim() === '' ? undefined : request.title.trim())
    commit({ addWorkspace: undefined })
    notify('success', t('remote.workspace.added', { title: request.title || basename(request.path) }))
    await refreshRemoteTarget(request.targetId)
    await loadRemoteSessions(request.targetId, true)
  } catch (error) {
    markStaleOnError(request.targetId, error)
    commit(previous => previous.addWorkspace === undefined ? {} : {
      addWorkspace: { ...previous.addWorkspace, creating: false, error: describe(error) },
    })
  }
}

export function requestRenameWorkspace(targetId: string, workspaceId: string): void {
  const workspace = findWorkspace(targetId, workspaceId)
  if (workspace === undefined) return
  commit({
    renameWorkspace: {
      targetId,
      workspaceId,
      currentTitle: workspace.title,
      value: workspace.title,
    },
  })
}

export function setRenameWorkspaceValue(value: string): void {
  if (state.renameWorkspace === undefined) return
  commit({ renameWorkspace: { ...state.renameWorkspace, value } })
}

export function closeRenameWorkspace(): void {
  commit({ renameWorkspace: undefined })
}

export async function submitRenameWorkspace(): Promise<void> {
  const request = state.renameWorkspace
  if (request === undefined) return
  const title = request.value.trim()
  if (title === '') return
  commit({ pending: true })
  try {
    await remoteApi.workspaceRename(request.targetId, request.workspaceId, title)
    commit({ renameWorkspace: undefined, pending: false })
    notify('success', t('remote.workspace.renamed', { title }))
    await refreshRemoteTarget(request.targetId)
  } catch (error) {
    markStaleOnError(request.targetId, error)
    notify('error', t('remote.workspace.renameFailed', { message: describeFailure(error) }))
    commit({ pending: false })
  }
}

export function requestDeleteWorkspace(targetId: string, workspaceId: string): void {
  const workspace = findWorkspace(targetId, workspaceId)
  if (workspace === undefined) return
  commit({
    deleteWorkspace: {
      targetId,
      workspaceId,
      title: workspace.title,
      path: workspace.path,
      force: false,
    },
  })
}

export function closeDeleteWorkspace(): void {
  commit({ deleteWorkspace: undefined })
}

/** Delete (or force-delete after the 409 confirmation) one workspace. */
export async function submitDeleteWorkspace(): Promise<void> {
  const request = state.deleteWorkspace
  if (request === undefined) return
  commit({ pending: true })
  try {
    await remoteApi.workspaceDelete(request.targetId, request.workspaceId, request.force || undefined)
    commit({ deleteWorkspace: undefined, pending: false })
    if (state.selection?.targetId === request.targetId && state.selection.workspaceId === request.workspaceId) {
      clearRemoteSelection()
    }
    notify('success', t('remote.workspace.deleted', { title: request.title }))
    await refreshRemoteTarget(request.targetId)
  } catch (error) {
    const wire = describe(error)
    markStaleOnError(request.targetId, error)
    if (!request.force && wire.code === 'workspace-not-empty') {
      const details = error instanceof RemoteApiError ? error.details : undefined
      const detailCount = details !== null && typeof details === 'object'
        ? (details as { sessionCount?: unknown }).sessionCount
        : undefined
      const count = typeof detailCount === 'number' ? detailCount : sessionCountOf(wire.message)
      commit({
        deleteWorkspace: {
          ...request,
          force: true,
          ...(count === undefined ? {} : { sessionCount: count }),
        },
        pending: false,
      })
      return
    }
    notify('error', t('remote.workspace.deleteFailed', { message: describeFailure(error) }))
    commit({ pending: false })
  }
}

/** Confirm the official "stop activity and archive" retry. */
export async function confirmArchiveActivity(): Promise<void> {
  const request = state.archiveActivity
  if (request === undefined) return
  await toggleSessionArchive(request.targetId, request.sessionId, true)
}

export function closeArchiveActivity(): void {
  commit({ archiveActivity: undefined })
}

/* -------------------------------------------------------- executor / mode */

/* --------------------------------------------------- v1 connect dialog */

/** Open (or reset) the minimal v1 connection dialog. */
export function openConnectDialog(): void {
  commit({
    connectDialog: {
      phase: 'idle',
      label: '',
      host: '',
      port: '22',
      username: '',
      authKind: 'password',
      secret: '',
      privateKeyPath: '',
      dshHome: '',
      runtimePolicy: 'auto',
    },
  })
}

/** Close the v1 connect dialog and drop its secret. */
export function closeConnectDialog(): void {
  commit({ connectDialog: undefined })
}

/** Patch one field of the connect dialog. */
export function patchConnectDialog(patch: Partial<ConnectDialogState>): void {
  const current = state.connectDialog
  if (current === undefined) return
  commit({ connectDialog: { ...current, ...patch, error: undefined } })
}

/** Confirm the shown host-key fingerprint and retry the same connection. */
export async function confirmConnectHostKey(): Promise<void> {
  const current = state.connectDialog
  if (current === undefined || current.fingerprint === undefined) return
  await submitConnectDialog()
}

/**
 * Submit the minimal connection request.
 *
 * A first unknown host key returns `host-key-unknown` with a fingerprint; the
 * dialog shows the SHA-256 and only a second submit (with that fingerprint)
 * trusts it. `host-key-changed` is terminal: the pinned identity no longer
 * matches and there is no retry.
 */
export async function submitConnectDialog(): Promise<void> {
  const dialog = state.connectDialog
  if (dialog === undefined || dialog.phase === 'submitting') return
  const label = dialog.label.trim()
  const host = dialog.host.trim()
  const username = dialog.username.trim()
  const port = Number(dialog.port.trim())
  const invalid: WireError | undefined = label === ''
    ? { code: 'invalid', message: t('remote.connect.labelRequired') }
    : host === ''
      ? { code: 'invalid', message: t('remote.connect.hostRequired') }
      : !Number.isInteger(port) || port < 1 || port > 65535
        ? { code: 'invalid', message: t('remote.connect.portInvalid') }
        : username === ''
          ? { code: 'invalid', message: t('remote.connect.userRequired') }
          : dialog.authKind === 'password' && dialog.secret === '' && dialog.fingerprint === undefined
            ? { code: 'invalid', message: t('remote.connect.secretRequired') }
            : dialog.authKind === 'privateKey' && dialog.privateKeyPath.trim() === ''
              ? { code: 'invalid', message: t('remote.connect.keyRequired') }
              : undefined
  if (invalid !== undefined) {
    commit({ connectDialog: { ...dialog, error: invalid } })
    return
  }
  const attemptId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `connect-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  commit({ connectDialog: { ...dialog, phase: 'submitting', attemptId, error: undefined } })
  try {
    await remoteApi.connectV1({
      label,
      host,
      port,
      username,
      authKind: dialog.authKind,
      ...(dialog.secret === '' ? {} : { secret: dialog.secret }),
      ...(dialog.authKind === 'privateKey' && dialog.privateKeyPath.trim() !== ''
        ? { privateKeyPath: dialog.privateKeyPath.trim() }
        : {}),
      ...(dialog.dshHome.trim() === '' ? {} : { dshHome: dialog.dshHome.trim() }),
      runtimePolicy: dialog.runtimePolicy,
      attemptId,
      ...(dialog.fingerprint === undefined ? {} : { hostKeyFingerprint: dialog.fingerprint }),
    })
    commit({ connectDialog: undefined })
    notify('success', t('remote.connect.done', { label }))
    await loadRemoteState()
  } catch (error) {
    const wire = describe(error)
    if (error instanceof RemoteApiError && error.code === 'host-key-unknown') {
      const details = error.details
      const fingerprint = details !== null && typeof details === 'object'
        ? (details as { fingerprint?: unknown }).fingerprint
        : undefined
      commit({
        connectDialog: {
          ...dialog,
          phase: 'hostkey',
          attemptId,
          secret: dialog.authKind === 'password' ? dialog.secret : '',
          ...(typeof fingerprint === 'string' ? { fingerprint } : {}),
          error: undefined,
        },
      })
      return
    }
    commit({
      connectDialog: {
        ...dialog,
        phase: 'failed',
        attemptId,
        error: { code: wire.code, message: describeFailure(error) },
      },
    })
  }
}

/** The connection whose execution-end dialog is open, if any. */
export function modeDialogFor(snapshot: RemoteAppState): RemoteConnectionView | undefined {
  return snapshot.modeDialog === undefined ? undefined : snapshot.connections[snapshot.modeDialog.targetId]
}

/** Open the execution-end settings dialog for one connection. */
export function openModeDialog(targetId: string): void {
  commit({ modeDialog: { targetId } })
}

/** Close the execution-end settings dialog (and discard a pending preview). */
export function closeModeDialog(targetId: string): void {
  const view = state.connections[targetId]
  // Closing mid-apply would lose the only state that knows the host is
  // switching; the modal stays until the result arrives.
  if (view?.modeSwitch.phase === 'applying') return
  cancelModeSwitch(targetId)
  commit({ modeDialog: undefined })
}

/** Report one failure through the shared toast host. */
export function notifyRemoteError(text: string): void {
  notify('error', text)
}

/** Report one success through the shared toast host. */
export function notifyRemoteSuccess(text: string): void {
  notify('success', text)
}

/** D20 preview for one connection's execution-end switch. */
export async function previewModeSwitch(targetId: string, nextMode: ExecutorMode): Promise<void> {
  const view = state.connections[targetId]
  if (view === undefined || view.mode === nextMode) return
  const targetSessionId = state.selection?.targetId === targetId ? state.selection.sessionId : undefined
  patchConnection(targetId, {
    modeSwitch: modeSwitchReducer(view.modeSwitch, {
      type: 'preview',
      nextMode,
      ...(targetSessionId === undefined ? {} : { targetSessionId }),
    }),
  })
  try {
    const preview = await remoteApi.modePreview(targetId, nextMode, targetSessionId)
    const current = state.connections[targetId]
    if (current === undefined) return
    patchConnection(targetId, {
      modeSwitch: modeSwitchReducer({ ...current.modeSwitch, nextMode }, { type: 'planned', preview }),
    })
  } catch (error) {
    markStaleOnError(targetId, error)
    const current = state.connections[targetId]
    if (current === undefined) return
    patchConnection(targetId, {
      modeSwitch: modeSwitchReducer(current.modeSwitch, { type: 'failed', error: executorWireError(error) }),
    })
  }
}

/** Confirm the D20 list and apply the switch. */
export async function applyModeSwitch(targetId: string): Promise<void> {
  const view = state.connections[targetId]
  if (view === undefined) return
  const selected = state.selection?.targetId === targetId ? state.selection.sessionId : undefined
  if (selected === undefined) {
    patchConnection(targetId, {
      modeSwitch: modeSwitchReducer(view.modeSwitch, {
        type: 'failed',
        error: executorErrorView({ code: 'mode-switch/preview-failed', message: t('remote.mode.selectSessionFirst') }),
      }),
    })
    return
  }
  // Two legal entry points into applying: the D20 confirm path
  // (`confirming` → explicit confirm) and the auto-cancel-current path
  // (`ready` → begin-apply). The request guard is shared.
  const confirmed = view.modeSwitch.phase === 'ready'
    ? modeSwitchReducer(view.modeSwitch, { type: 'begin-apply' })
    : modeSwitchReducer(view.modeSwitch, { type: 'confirm' })
  patchConnection(targetId, { modeSwitch: confirmed })
  const request = modeSwitchApplyRequest(confirmed)
  if (!request.ok) {
    patchConnection(targetId, {
      modeSwitch: modeSwitchReducer(confirmed, {
        type: 'failed',
        error: executorErrorView({ code: 'mode-switch/preview-failed', message: request.reason }),
      }),
    })
    return
  }
  try {
    const result = await remoteApi.modeApply({
      targetId,
      nextMode: request.nextMode,
      cancelActiveTurns: true,
      previewRevision: request.previewRevision,
      targetSessionId: selected,
    })
    if (result.switched !== true) {
      throw new RemoteApiError('mode-switch/preview-failed', t('remote.mode.previewFailed', { message: '' }), 500)
    }
    const afterApply = modeSwitchReducer(confirmed, {
      type: 'applied',
      cancelledTurnIds: result.cancelledTurnIds,
      failedCancellations: result.failedCancellations,
    })
    patchConnection(targetId, { modeSwitch: afterApply })
    if (afterApply.phase === 'done') {
      patchConnection(targetId, { mode: request.nextMode, modeSwitch: IDLE_MODE_SWITCH })
      // The switch succeeded; the settings dialog has nothing left to ask.
      commit({ modeDialog: undefined })
      notify('success', t('remote.mode.switched', { mode: t(request.nextMode === 'server' ? 'remote.mode.server' : 'remote.mode.local') }))
      await refreshRemoteTarget(targetId)
      // Local-mode rollout gate: the UI never reaches this apply while local is
      // gated, and reopening a local session before the host runtime is wired
      // would only produce an error notice.
      if (LOCAL_MODE_READY) await reopenAfterModeSwitch(targetId)
    }
  } catch (error) {
    markStaleOnError(targetId, error)
    const current = state.connections[targetId]
    if (current === undefined) return
    patchConnection(targetId, {
      modeSwitch: modeSwitchReducer(current.modeSwitch, { type: 'failed', error: executorWireError(error) }),
    })
  }
}

/** Cancel the switch dialog without a write. */
export function cancelModeSwitch(targetId: string): void {
  const view = state.connections[targetId]
  if (view === undefined) return
  patchConnection(targetId, { modeSwitch: modeSwitchReducer(view.modeSwitch, { type: 'cancel' }) })
}

/** D20 preview for a profile restart (refresh/registry fallback). */
export async function previewProfileRestart(targetId: string): Promise<void> {
  const view = state.connections[targetId]
  if (view === undefined) return
  patchConnection(targetId, { restart: { phase: 'previewing' } })
  try {
    const preview = await remoteApi.profileRestartPreview(targetId)
    patchConnection(targetId, { restart: { phase: 'confirming', preview } })
  } catch (error) {
    patchConnection(targetId, { restart: { phase: 'failed', error: executorWireError(error) } })
  }
}

/** Confirm and perform the restart after its preview. */
export async function confirmProfileRestart(targetId: string): Promise<void> {
  const view = state.connections[targetId]
  const preview = view?.restart.preview
  if (view === undefined || preview === undefined) return
  patchConnection(targetId, { restart: { ...view.restart, phase: 'restarting' } })
  try {
    await remoteApi.profileRestart(targetId, preview.previewRevision)
    patchConnection(targetId, { restart: { phase: 'done' } })
    notify('success', t('remote.restart.done'))
    const selection = state.selection
    await loadRemoteState()
    // The profile process was replaced: rebuild the native stream/timeline at
    // the session the user had open instead of leaving a dead selection.
    if (selection?.targetId === targetId && selection.sessionId !== undefined) {
      closeNativeView()
      await openRemoteSession(targetId, selection.sessionId)
    }
  } catch (error) {
    patchConnection(targetId, { restart: { phase: 'failed', error: executorWireError(error) } })
  }
}

export function cancelProfileRestart(targetId: string): void {
  patchConnection(targetId, { restart: { phase: 'idle' } })
}

/** Load external registry changes without a process restart. */
export async function loadRegistryChanges(targetId: string): Promise<void> {
  const view = state.connections[targetId]
  if (view === undefined) return
  try {
    await remoteApi.registryRefresh(targetId)
    patchConnection(targetId, { stale: false, reloadError: undefined })
    await refreshRemoteTarget(targetId)
    notify('success', t('remote.registry.loaded'))
  } catch (error) {
    patchConnection(targetId, {
      reloadError: executorErrorView({ code: 'registry-reload-failed', message: describe(error).message }),
    })
  }
}

/* ------------------------------------------------------------- deployment */

/**
 * Apply one deployment change after the user pressed the explicit button.
 *
 * Dedicated-profile plugin changes and isolated-runtime changes are automatic in
 * the host; only a global runtime or a non-dedicated plugin install requires the
 * button. `confirm: true` is passed only from that button, never from a preview.
 */
export async function applyDeployment(targetId: string, kind: 'runtime' | 'plugin'): Promise<void> {
  commit({ pending: true })
  try {
    const result: DeploymentApplyResult = await remoteApi.deploymentApply(targetId, kind, true)
    notify('success', t(result.restarted ? 'remote.deploy.doneRestarted' : 'remote.deploy.done'))
    await refreshRemoteTarget(targetId)
  } catch (error) {
    const wire = describe(error)
    notify('error', t('remote.deploy.failed', { message: describeFailure(error) }))
    console.warn('[dsh-remote-workspace] deployment apply failed', wire.code)
  } finally {
    commit({ pending: false })
  }
}

/** Re-read the deployment preview for one connection. */
export async function refreshDeployment(targetId: string): Promise<void> {
  try {
    const deployment: DeploymentStateV1 = await remoteApi.deploymentPreview(targetId)
    const current = state.connections[targetId]
    if (current === undefined || current.connection === undefined) return
    patchConnection(targetId, { connection: { ...current.connection, deployment } })
  } catch (error) {
    notify('error', t('remote.deploy.previewFailed', { message: describeFailure(error) }))
  }
}

/* ---------------------------------------------------------------- notices */

export function dismissRemoteNotice(): void {
  commit({ notice: undefined })
}

export function dismissRemoteError(): void {
  commit({ error: undefined })
}

function sessionCountOf(message: string): number | undefined {
  const match = /(\d+)/.exec(message)
  return match === null ? undefined : Number.parseInt(match[1] ?? '', 10)
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  return index === -1 ? trimmed : trimmed.slice(index + 1) || '/'
}

/* -------------------------------------------------------------- local mode */

/** The shell's client `sessions` service, as the reveal wait reads it. */
interface ShellSessions {
  list?: {
    getSnapshot?(): { byId?: Record<string, unknown> }
  }
  refresh?(): Promise<unknown>
}

function shellSessions(): ShellSessions | undefined {
  try {
    return clientContext?.get('sessions') as ShellSessions | undefined
  } catch {
    return undefined
  }
}

/** Wait until the host's create/resume summary reaches the client catalog. */
async function waitForCatalog(sessionId: string): Promise<boolean> {
  const sessions = shellSessions()
  const known = (): boolean => sessions?.list?.getSnapshot?.()?.byId?.[sessionId] !== undefined
  if (known()) return true
  try {
    if (typeof sessions?.refresh === 'function') void Promise.resolve(sessions.refresh()).catch(() => {})
  } catch {
    // Polling below is enough.
  }
  const deadline = Date.now() + 4_000
  while (!known() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return known()
}

/** Reveal one already-created/resumed local-mode session in the official UI. */
async function revealLocalSession(targetId: string, sessionId: string, workspaceId: string | undefined): Promise<void> {
  const visible = await waitForCatalog(sessionId)
  if (!visible) throw new RemoteApiError('session-reveal-timeout', t('remote.session.revealTimeout'), 0)
  const workspace = clientContext?.get('uiWorkspace') as {
    openSession?(target: string): void
    selection?: { getSnapshot?(): { sessionId?: unknown } }
  } | undefined
  if (workspace?.openSession === undefined) {
    throw new RemoteApiError('ui-workspace-unavailable', t('remote.session.shellUnavailable'), 0)
  }
  closeNativeView()
  workspace.openSession(sessionId)
  revealedLocal.set(sessionId, targetId)
  ensureExpanded(targetId, workspaceId)
  commit({
    selection: {
      targetId,
      ...(workspaceId === undefined ? {} : { workspaceId }),
      sessionId,
    },
  })
}

/** Open one existing local-mode session through the host bridge, then reveal it. */
async function openLocalSession(targetId: string, sessionId: string, workspaceId: string | undefined): Promise<void> {
  // Do not send the connection mode here: the host must use the session's own
  // executor record (a session created under the other mode keeps its mode).
  const result: LocalSessionResult = await remoteApi.sessionOpen({
    targetId,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    sessionId,
  })
  if (result.executor === 'server') {
    // A session created under the server end keeps its mode; route it back to
    // the official-UI iframe instead of the client conversation.
    await openServerSession(targetId, workspaceId, result.sessionId)
    return
  }
  await revealLocalSession(targetId, result.sessionId, workspaceId)
}

/** Retry the reveal of a local session whose catalog row was late. */
export async function retryPendingLocalReveal(): Promise<void> {
  const pending = state.pendingLocalReveal
  if (pending === undefined) return
  try {
    await revealLocalSession(pending.targetId, pending.sessionId, pending.workspaceId)
    commit({ pendingLocalReveal: undefined })
  } catch (error) {
    notify('error', t('remote.session.revealTimeout'))
    console.warn('[dsh-remote-workspace] local reveal retry failed', describeFailure(error))
  }
}

/** Official deselect for a local remote session (protocol §16.11, guarded). */
function releaseLocalSelection(): void {
  const selected = state.selection
  if (selected === undefined || selected.sessionId === undefined) return
  const revealed = revealedLocal.get(selected.sessionId)
  if (revealed !== selected.targetId) return
  try {
    const workspace = clientContext?.get('uiWorkspace') as { clearMain?(): void } | undefined
    if (typeof workspace?.clearMain === 'function') workspace.clearMain()
  } catch (error) {
    console.error('[dsh-remote-workspace] clearMain failed; falling back to layout.selectPanel(null)', error)
    selectPanel(null)
  }
  revealedLocal.delete(selected.sessionId)
}

/** Called when a connection leaves ready: drop its local selection/iframe. */
function releaseTarget(targetId: string): void {
  const selection = state.selection
  if (selection?.targetId === targetId) {
    releaseLocalSelection()
    closeNativeView()
    commit({ selection: undefined })
    selectPanel(null)
  }
  collapseRemoteTarget(targetId)
}

/* ------------------------------------------------------------ event stream */

/** Start the single P3 state stream and coalesce refreshes per target. */
function startStateStream(): void {
  if (stopStateStream !== undefined) return
  try {
    stopStateStream = openRemoteStateStream({
      onEvent: event => handleStateEvent(event),
      onTransportError: message => {
        console.warn('[dsh-remote-workspace] state stream closed', message)
      },
    })
  } catch (error) {
    console.error('[dsh-remote-workspace] state stream failed to open', error)
  }
}

function scheduleRefresh(targetId: string): void {
  if (refreshTimers.has(targetId)) return
  refreshTimers.set(targetId, setTimeout(() => {
    refreshTimers.delete(targetId)
    void refreshRemoteTarget(targetId).then(() => {
      const view = state.connections[targetId]
      if (view?.connection?.phase === 'ready' || view?.connection?.phase === 'degraded') {
        void loadRemoteSessions(targetId, true)
      }
    })
  }, 250))
}

function handleStateEvent(event: RemoteStateEvent): void {
  switch (event.type) {
    case 'change': {
      if (event.reason === 'external') {
        patchConnection(event.targetId, { stale: true })
        return
      }
      scheduleRefresh(event.targetId)
      return
    }
    case 'session/revealed': {
      if (pendingReveal?.targetId === event.targetId && pendingReveal.sessionId === event.sessionId) {
        pendingReveal = undefined
        void refreshRemoteTarget(event.targetId)
      }
      return
    }
    case 'mode-switch/progress': {
      const view = state.connections[event.targetId]
      if (view === undefined) return
      patchConnection(event.targetId, {
        modeSwitch: modeSwitchReducer(view.modeSwitch, { type: 'progress', phase: event.phase }),
      })
      return
    }
    case 'turn/cancelled':
      scheduleRefresh(event.targetId)
      return
    case 'mode/changed': {
      const view = state.connections[event.targetId]
      if (view === undefined) return
      patchConnection(event.targetId, { mode: event.mode })
      scheduleRefresh(event.targetId)
      return
    }
  }
}

/** Bind the client context and start the stream; called once from `apply`. */
export function bindRemoteStoreContext(ctx: ClientContext): void {
  clientContext = ctx
  startStateStream()
  startOfficialSelectionWatch()
}

/** The layout's active panel id: null means the official conversation. */
function activePanelId(): string | null | undefined {
  try {
    const layout = clientContext?.get('layout') as {
      panelInfo?: { getSnapshot?(): { activePanelId?: string | null } }
    } | undefined
    return layout?.panelInfo?.getSnapshot?.().activePanelId
  } catch {
    return undefined
  }
}

/** The official UI's selected session id (public retention fallback included). */
function officialSelectedSessionId(): string | undefined {
  try {
    const workspace = clientContext?.get('uiWorkspace') as {
      selection?: { getSnapshot?(): { sessionId?: unknown } }
    } | undefined
    const selected = workspace?.selection?.getSnapshot?.()?.sessionId
    if (typeof selected === 'string' && selected !== '') return selected
  } catch {
    // Fall through to the public retention scan.
  }
  try {
    const sessions = clientContext?.get('sessions') as {
      list?: { getSnapshot?(): { byId?: Record<string, { retainedBy?: { mainView?: number } }> } }
    } | undefined
    const byId = sessions?.list?.getSnapshot?.()?.byId
    if (byId !== undefined) {
      for (const [id, row] of Object.entries(byId)) {
        if ((row?.retainedBy?.mainView ?? 0) > 0) return id
      }
    }
  } catch {
    // No readable selection: the guard stays off.
  }
  return undefined
}

/**
 * Keep the remote highlight from surviving a switch to a **local** conversation.
 *
 * When the official conversation panel is active and its selected session is
 * not one this plugin revealed (local mode), the remote tree must not keep a
 * second, stale highlight (requirement: the two highlight sources never show
 * together). A selected remote/local-mode session stays highlighted because it
 * is in `revealedLocal`.
 */
function syncOfficialSelection(): void {
  if (activePanelId() !== null) return
  const selected = officialSelectedSessionId()
  if (selected === undefined) return
  if (revealedLocal.get(selected) !== undefined) return
  if (state.selection === undefined) return
  closeNativeView()
  commit({ selection: undefined })
}

/** Subscribe to the shell selection signals once; cheap and idempotent. */
function startOfficialSelectionWatch(): void {
  if (stopOfficialSelection !== undefined) return
  const disposers: Array<() => void> = []
  try {
    const layout = clientContext?.get('layout') as {
      panelInfo?: { subscribe?(listener: () => void): () => void }
    } | undefined
    if (typeof layout?.panelInfo?.subscribe === 'function') {
      disposers.push(layout.panelInfo.subscribe(syncOfficialSelection))
    }
  } catch {
    // optional
  }
  try {
    const workspace = clientContext?.get('uiWorkspace') as {
      selection?: { subscribe?(listener: () => void): () => void }
    } | undefined
    if (typeof workspace?.selection?.subscribe === 'function') {
      disposers.push(workspace.selection.subscribe(syncOfficialSelection))
    }
  } catch {
    // optional
  }
  try {
    const sessions = clientContext?.get('sessions') as {
      list?: { subscribe?(listener: () => void): () => void }
    } | undefined
    if (typeof sessions?.list?.subscribe === 'function') {
      disposers.push(sessions.list.subscribe(syncOfficialSelection))
    }
  } catch {
    // optional
  }
  if (disposers.length === 0) return
  stopOfficialSelection = () => { for (const dispose of disposers) dispose() }
}

/** Dispose the stream subscription and timers (hot reload). */
export function disposeRemoteStore(): void {
  closeNativeView()
  stopStateStream?.()
  stopStateStream = undefined
  stopPortalSelection?.()
  stopPortalSelection = undefined
  stopOfficialSelection?.()
  stopOfficialSelection = undefined
  pendingReveal = undefined
  for (const timer of refreshTimers.values()) clearTimeout(timer)
  refreshTimers.clear()
  revealedLocal.clear()
}

/** Track a host-side reveal that the SSE may announce before our poll sees it. */
export function expectRemoteReveal(targetId: string, sessionId: string, workspaceId?: string): void {
  pendingReveal = { targetId, sessionId, ...(workspaceId === undefined ? {} : { workspaceId }) }
}
