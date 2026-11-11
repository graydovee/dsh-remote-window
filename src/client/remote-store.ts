/**
 * The v3 client's connection model: targets, their live phase, the connect /
 * stop / forget verbs and the full-screen portal deep link.
 *
 * The official UI owns every workspace and session surface now, so this store
 * keeps only what the connection panel and the dialogs need: the target order,
 * one view per target, the connect dialog, the forget confirmation and the
 * notice toast. Every verb is one host route; nothing here caches server data
 * beyond the snapshot the portal deep link and the panel rows read.
 */
import { useSyncExternalStore } from 'react'
import { RemoteApiError, toWireError } from './api.ts'
import type { WireError } from './api.ts'
import type {
  ConnectionStateV1, PublicTargetV1, StateRefreshResult, StateResultV1,
} from './remote-api.ts'
import { remoteApi } from './remote-api.ts'
import type { RemoteSessionList, RemoteWorkspaceList } from './remote-data.ts'
import type { ClientContext } from './context.ts'
import { t } from './locales.ts'
import {
  closeServerMainPanel, openServerMain, serverMainRequest, SERVER_MAIN_ID,
} from './portal-main.tsx'

/** One loaded-or-loading slice. */
export interface LoadState {
  readonly loading: boolean
  readonly loaded: boolean
  readonly error?: WireError
}

/** One connection's rendered state. */
export interface RemoteConnectionView {
  readonly target: PublicTargetV1
  readonly connection?: ConnectionStateV1
  readonly workspaces?: RemoteWorkspaceList
  readonly sessions?: RemoteSessionList
  readonly stateLoad: LoadState
  readonly sessionsLoad: LoadState
  /** A user-initiated connect is in flight (row spins independently of state reads). */
  readonly connecting?: boolean
  /** The last user-initiated connect failed; startup must not inherit this. */
  readonly connectFailed?: boolean
  readonly error?: WireError
}

/** Fields and progress of the v3 connect dialog. */
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
  /**
   * Set when this dialog is a reconnect of a saved target: the wizard steps are
   * skipped and the dialog is the progress surface for that attempt.
   */
  readonly reconnectTargetId?: string
  /** Where the server agent's model requests are served. */
  readonly modelSource: 'local' | 'server'
  readonly error?: WireError
}

/** The rail's complete snapshot. */
export interface RemoteAppState {
  readonly loaded: boolean
  readonly loading: boolean
  readonly error?: WireError
  readonly pluginVersion: string
  /**
   * The harness host's `process.platform` (`'win32'`, `'darwin'`, …), straight
   * from `GET /api/state`. The connect dialog gates its method cards on it.
   */
  readonly platform?: string
  readonly order: readonly string[]
  readonly connections: Readonly<Record<string, RemoteConnectionView>>
  readonly pending: boolean
  readonly notice?: { readonly kind: 'success' | 'error'; readonly text: string }
  readonly forgetTarget?: { readonly targetId: string; readonly label: string }
  readonly connectDialog?: ConnectDialogState
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
    pending: false,
  }
}

let state: RemoteAppState = initialState()
const listeners = new Set<() => void>()
let clientContext: ClientContext | undefined

function commit(patch: Partial<RemoteAppState>): void {
  const merged: RemoteAppState = { ...state, ...patch }
  state = merged
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function snapshot(): RemoteAppState {
  return state
}

/** Snapshot hook for the connection panel and the dialogs. */
export function useRemoteAppState(): RemoteAppState {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
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
    stateLoad: { loading: false, loaded: connection !== undefined },
    sessionsLoad: sessions === undefined ? emptyLoad() : { loading: false, loaded: true },
    ...(connection?.error === undefined ? {} : { error: connection.error }),
  }
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
 * message.
 */
function describeFailure(error: unknown): string {
  const wire = describe(error)
  switch (wire.code) {
    case 'profile-locked':
    case 'profile-in-use':
      return t('remote.error.profileLocked')
    case 'tunnel-unavailable':
    case 'target-not-connected':
      return t('remote.error.tunnel')
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

/* ------------------------------------------------------------- initial read */

/**
 * A per-target list value; the host substitutes `{ error }` for a failed read.
 * The rest of the client consumes only real lists, so failures degrade to
 * "nothing loaded" and the connection's own error stays visible.
 */
function readableList<T>(value: T | undefined): T | undefined {
  if (value === undefined || value === null || typeof value !== 'object') return undefined
  return 'error' in (value as Record<string, unknown>) ? undefined : value
}

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
      connections[target.id] = viewFor(
        target,
        value.connections[target.id],
        readableList(value.workspaces[target.id]),
        readableList(value.sessions?.[target.id]),
      )
    }
    commit({
      loaded: true,
      loading: false,
      pluginVersion: value.pluginVersion,
      // The host platform gates which connection methods may be offered; it
      // must ride the successful commit so the dialog never loses it.
      platform: value.platform,
      order,
      connections,
    })
    for (const target of value.targets) {
      const phase = value.connections[target.id]?.phase
      const ready = phase === 'ready' || phase === 'degraded'
      if (ready && readableList(value.sessions?.[target.id]) === undefined) void loadRemoteSessions(target.id)
    }
  } catch (error) {
    commit({ loading: false, loaded: true, error: describe(error) })
  }
}

/** Read every connected target again (the rail's refresh button). */
export async function refreshAllRemote(): Promise<void> {
  const targets = state.order.filter(targetId => {
    const view = state.connections[targetId]
    return view?.connection?.phase === 'ready' || view?.connection?.phase === 'degraded'
  })
  await Promise.all(targets.map(targetId => refreshRemoteTarget(targetId)))
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
    ...(value.connection?.error === undefined ? {} : { error: value.connection.error }),
  })
}

/** Light refresh of one target; never restarts the profile (protocol §16.3). */
async function refreshRemoteTarget(targetId: string): Promise<void> {
  const current = state.connections[targetId]
  if (current === undefined || current.stateLoad.loading) return
  if (current.connection?.phase !== 'ready' && current.connection?.phase !== 'degraded') return
  patchConnection(targetId, { stateLoad: { ...current.stateLoad, loading: true } })
  try {
    const value = await remoteApi.stateRefresh(targetId)
    mergeRefresh(targetId, value)
  } catch (error) {
    patchConnection(targetId, {
      stateLoad: { loading: false, loaded: true, error: describe(error) },
      error: describe(error),
    })
  }
}

/** Load the full session list for one target on demand. */
async function loadRemoteSessions(targetId: string, force = false): Promise<void> {
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

/* -------------------------------------------------------------- selection */

/**
 * A user-initiated connect must not hang the row forever. Reconnect can also
 * trigger the one-time isolated-runtime build/upload, which is much slower than
 * an ordinary profile start, so the safety net is generous.
 */
const CONNECT_TIMEOUT_MS = 10 * 60_000

/** Settle with the connect promise, or reject with a readable timeout. */
async function reconnectWithTimeout(targetId: string, attemptId?: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      remoteApi.reconnect(targetId, attemptId === undefined ? {} : { attemptId }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error(t('remote.connect.timeout'))) }, CONNECT_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Whether the host reports a live profile for a view (ready or degraded). */
function connectionIsLive(view: RemoteConnectionView): boolean {
  const phase = view.connection?.phase
  return phase === 'ready' || phase === 'degraded'
}

/**
 * Ask the official layout to show one panel id (`null` = the conversation).
 * @param id - a `main` slot key, or `null` for the shell's own conversation.
 */
export function selectPanel(id: string | null): void {
  try {
    const layout = clientContext?.get('layout') as { selectPanel?(panelId: string | null): void } | undefined
    layout?.selectPanel?.(id)
  } catch (error) {
    console.error('[dsh-remote-workspace] layout.selectPanel failed', error)
  }
}

/**
 * Close the full-screen official UI when it currently shows one target.
 *
 * Called from every path that makes a target unusable (disconnect, forget,
 * connection lost): the frame must never keep showing a profile the host has
 * already stopped.
 * @param targetId - target whose frame must be torn down.
 */
function closePortalFor(targetId: string): void {
  const request = serverMainRequest()
  if (request?.targetId !== targetId) return
  closeServerMainPanel()
}

/**
 * The session the full-screen official UI should open on its first load.
 *
 * A bare portal boot lands on the official first-run composer seat ("选择一个
 * 工作区开始"), which inside an iframe cannot recover, so the client always
 * deep-links one session (`dshRwSession`). The most recent conversation wins;
 * when the profile has none yet the client creates the workspace's blank
 * session through the host bridge.
 * @param targetId - connected target.
 * @param view - that target's loaded connection view.
 * @returns the session id to embed, or undefined when none can be resolved.
 */
async function portalSessionFor(targetId: string, view: RemoteConnectionView): Promise<string | undefined> {
  const rows = view.sessions?.sessions ?? []
  const conversation = [...rows]
    .filter(row => !row.blank && row.archived !== true && row.origin !== 'subagent')
    .sort((left, right) => right.updatedAt - left.updatedAt)[0]
  if (conversation !== undefined) return conversation.sessionId
  const workspaceId = view.workspaces?.workspaces[0]?.workspaceId
  if (workspaceId === undefined) return undefined
  try {
    const created = await remoteApi.sessionCreate({ targetId, workspaceId })
    return created.sessionId
  } catch {
    return undefined
  }
}

/**
 * Activate one saved target.
 *
 * The rail's single verb: a stopped target starts its profile and opens the
 * full-screen official UI once it is ready; a live target just (re)mounts the
 * frame. Re-activating the already active target is a no-op so a stray click
 * cannot reload the conversation under the user.
 * @param targetId - saved target id.
 */
export async function activateRemoteTarget(targetId: string): Promise<void> {
  const view = state.connections[targetId]
  if (view === undefined || view.connecting === true) return
  if (!connectionIsLive(view)) {
    await connectRemoteTarget(targetId)
    return
  }
  const active = serverMainRequest()
  if (active?.targetId === targetId) return
  const sessionId = await portalSessionFor(targetId, view)
  if (serverMainRequest()?.targetId === targetId) return
  closePortalFor(targetId)
  openServerMain({
    targetId,
    targetLabel: view.target.label,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(view.connection?.embed?.storagePrefix === undefined
      ? {}
      : { storagePrefix: view.connection.embed.storagePrefix }),
    ...(view.connection?.embed?.mode === undefined
      ? {}
      : { embedMode: view.connection.embed.mode }),
  })
  selectPanel(SERVER_MAIN_ID)
}

/**
 * Switch the full-screen official UI to another saved target.
 *
 * This is the `dsh-rw/switch-target` handler used by the mirrored server-side
 * connection list. An unknown target, the already active target, and a pending
 * verb are no-ops; a failed switch leaves the current frame mounted and only
 * reports the failure, so the user keeps the conversation they were reading.
 * @param targetId - the target the embedded UI asked for.
 */
export async function switchRemoteTarget(targetId: string): Promise<void> {
  const view = state.connections[targetId]
  if (view === undefined || state.pending || view.connecting === true) return
  if (serverMainRequest()?.targetId === targetId) return
  try {
    await activateRemoteTarget(targetId)
  } catch (error) {
    notify('error', t('remote.connect.failed', { message: describeFailure(error) }))
  }
}

/** A fresh id for one connect attempt (progress polling keys on it). */
function newAttemptId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `connect-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Connect one saved target and show the progress dialog for the attempt.
 *
 * A connect is slow (runtime/plugin deployment on a cold host), so it must not
 * be a silent row spinner: the dialog opens on its progress step with the same
 * step rows a first connection shows, and closes itself once the official UI
 * opens. Failures stay in the dialog with a retry button.
 * @param targetId - saved target id.
 */
export async function connectRemoteTarget(targetId: string): Promise<void> {
  const view = state.connections[targetId]
  if (view === undefined || view.connecting === true) return
  const attemptId = newAttemptId()
  commit({
    connectDialog: {
      phase: 'submitting',
      reconnectTargetId: targetId,
      attemptId,
      label: view.target.label,
      host: view.target.host,
      port: String(view.target.port),
      username: view.target.username,
      // The host reuses the stored credential/private key: the dialog is a
      // progress surface, not an editable form.
      authKind: 'agent',
      secret: '',
      privateKeyPath: '',
      dshHome: '',
      runtimePolicy: 'auto',
      modelSource: 'local',
    },
  })
  await runReconnectAttempt(targetId, attemptId)
}

/**
 * Retry the reconnect the progress dialog is currently showing.
 *
 * Failed attempts keep the dialog open; retrying starts a fresh host attempt
 * with a new id so the progress buffer starts empty.
 */
export async function retryReconnectTarget(): Promise<void> {
  const dialog = state.connectDialog
  const targetId = dialog?.reconnectTargetId
  if (dialog === undefined || targetId === undefined || dialog.phase === 'submitting') return
  const attemptId = newAttemptId()
  commit({ connectDialog: { ...dialog, phase: 'submitting', attemptId, error: undefined } })
  await runReconnectAttempt(targetId, attemptId)
}

/** One reconnect attempt: host call, progress dialog lifecycle, activation. */
async function runReconnectAttempt(targetId: string, attemptId: string): Promise<void> {
  const view = state.connections[targetId]
  if (view === undefined) return
  patchConnection(targetId, { connecting: true, connectFailed: false, error: undefined })
  commit({ pending: true })
  try {
    await reconnectWithTimeout(targetId, attemptId)
    patchConnection(targetId, { connecting: false })
    // Only close the dialog this attempt owns: the user may have closed it, or
    // started a different connection while this one ran.
    if (state.connectDialog?.attemptId === attemptId) commit({ connectDialog: undefined })
    notify('success', t('remote.connect.done', { label: view.target.label }))
    await loadRemoteState()
    await loadRemoteSessions(targetId, true)
    // The connection is live: open the server's own full UI.
    await activateRemoteTarget(targetId)
  } catch (error) {
    await refreshRemoteTarget(targetId).catch(() => undefined)
    patchConnection(targetId, { connecting: false, connectFailed: true, error: describe(error) })
    const wire = describe(error)
    const dialog = state.connectDialog
    if (dialog?.attemptId === attemptId) {
      commit({
        connectDialog: {
          ...dialog,
          phase: 'failed',
          error: { code: wire.code, message: describeFailure(error) },
        },
      })
    }
    notify('error', t('remote.connect.failed', { message: describeFailure(error) }))
  } finally {
    patchConnection(targetId, { connecting: false })
    commit({ pending: false })
  }
}

/** Stop one target's profile and drop its portal. */
export async function disconnectRemoteTarget(targetId: string): Promise<void> {
  commit({ pending: true })
  try {
    await remoteApi.stop(targetId)
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

/* --------------------------------------------------- v3 connect dialog */

/** Open (or reset) the connection dialog. */
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
      modelSource: 'local',
    },
  })
}

/** Close the connection dialog and drop its secret. */
export function closeConnectDialog(): void {
  commit({ connectDialog: undefined })
}

/** Patch one field of the connect dialog. */
export function patchConnectDialog(patch: Partial<ConnectDialogState>): void {
  const current = state.connectDialog
  if (current === undefined) return
  commit({ connectDialog: { ...current, ...patch, error: undefined } })
}

/**
 * Submit the connection request.
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
  const attemptId = newAttemptId()
  commit({ connectDialog: { ...dialog, phase: 'submitting', attemptId, error: undefined } })
  try {
    const connected = await remoteApi.connectV1({
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
      modelSource: dialog.modelSource,
      attemptId,
      ...(dialog.fingerprint === undefined ? {} : { hostKeyFingerprint: dialog.fingerprint }),
    })
    commit({ connectDialog: undefined })
    notify('success', t('remote.connect.done', { label }))
    await loadRemoteState()
    // A brand-new connection opens its official UI immediately; the rail stays
    // the fallback when the frame reports an error later.
    await activateRemoteTarget(connected.target.id)
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

/* ---------------------------------------------------------------- notices */

export function dismissRemoteNotice(): void {
  commit({ notice: undefined })
}

/* ------------------------------------------------------------- lifecycle */

/** Called when a connection leaves ready: drop its portal and cached rows. */
function releaseTarget(targetId: string): void {
  closePortalFor(targetId)
  patchConnection(targetId, {
    ...(state.connections[targetId]?.connection === undefined
      ? {}
      : { connection: { ...state.connections[targetId]!.connection!, phase: 'stopped', error: undefined } }),
    connecting: false,
    connectFailed: false,
    error: undefined,
    sessions: undefined,
    sessionsLoad: { loading: false, loaded: false },
  })
}

/** Bind the client context; called once from `apply`. */
export function bindRemoteStoreContext(ctx: ClientContext): void {
  clientContext = ctx
}

/** Dispose the store's context binding (hot reload). */
export function disposeRemoteStore(): void {
  clientContext = undefined
}
