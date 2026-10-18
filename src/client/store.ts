/**
 * The plugin's browser app model: one module-level `useSyncExternalStore`
 * store shared by the sidebar panel row and the inline wizard page.
 *
 * Slot entries are registered independently, so React context cannot carry
 * state between them; a module-level store can (and it survives a hot-reload
 * `apply`, while every side effect it owns is still disposed through
 * `ctx.effect` → {@link dispose}).
 *
 * Secret handling: a submitted secret lives only in the module-level
 * {@link pendingSecret} closure (never in the rendered snapshot, never in a
 * URL) so a retry can reuse it while an input can never render it back.
 */
import { useSyncExternalStore } from 'react'
import {
  api, openConnectStream, toWireError,
} from './api.ts'
import type {
  AuthKind, ConnectFrame, ConnectStartRequest, ConnectStep, ConnectionMode, DirEntry, DshCandidate,
  DshScanRequest, ListDirResult, PublicTarget, RemoteRegistryWorkspace, RemoteRuntimeInput,
  RemoteRuntimeProbe, RemoteSession, RemoteWorkspace, ServerPackageState, SshAlias, WireError,
  WslDistro,
} from './api.ts'
import type { ClientContext } from './context.ts'
import { draftFromAlias } from './alias-prefill.ts'
import { methodAvailable } from '../targets/methods.ts'
import type { ConnectionMethod } from '../targets/methods.ts'
import { t } from './locales.ts'
import type { LocaleKey } from './locales.ts'

/**
 * Which wizard step is showing.
 *
 * Three steps, not four: the remote-directory browser is no longer a wizard
 * step — it is the default tab of the 添加工作区 dialog (`directory-picker.tsx`),
 * which is reachable from a connection row instead of from a just-finished
 * connect. Step 3 therefore owns *both* the connection-method choice and the
 * progress/log/host-key surface it drives.
 */
export type WizardStep = 'method' | 'config' | 'connect'

/** Which surface the overlay shows. */
export type WizardView = 'list' | 'wizard'

/**
 * Connection-method card. Availability is platform-dependent and decided by
 * {@link methodAvailable} — the same predicate the host validates with.
 */
export type { ConnectionMethod }

/** The four progress rows, in server order. */
export const CONNECT_STEPS: readonly ConnectStep[] = ['connect', 'probe', 'runtime', 'upload', 'start']

/** Editable connection draft (step 2) plus the step-3 choice. */
export interface ConnectDraft {
  label: string
  /** `ssh` fields; unused (and not rendered) for a `wsl` method. */
  host: string
  port: string
  username: string
  authKind: AuthKind
  /** Password / key passphrase. Cleared from the snapshot right after submit. */
  secret: string
  privateKeyPath: string
  sshConfigAlias?: string
  /** `wsl` fields: the chosen distribution and its optional user. */
  wslDistro: string
  wslUser: string
  nodePath: string
  dshCommand: string
  profile: string
  dshHome: string
  /**
   * Step 3's three-way choice; `''` = nothing chosen yet (连接 stays disabled).
   *
   * This is the only package-source control in the wizard: the step-2 advanced
   * section used to carry a second `packageSource` selector, which could say
   * "download" while step 3 said "upload". The wire field is still
   * `ConnectRequest.packageSource` — {@link startConnect} maps this choice onto
   * it (architecture A3: no second, parallel mode concept).
   */
  connectionMode: '' | ConnectionMode
  /** The launcher picked from the scan's candidates; required for `reuse`. */
  reuseLauncherPath: string
}

/** One discovery pass over the installed WSL distributions. */
export interface WslProbeState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  distros: WslDistro[]
  /** Scrubbed reason from `wsl.exe` (e.g. WSL not enabled); shown inline. */
  error?: string
}

/**
 * The read-only pre-connection scan (`/api/dsh-scan`).
 *
 * `status: 'idle'` with a `fingerprint` is the *host-key pending* state: the
 * scan stopped before it could read anything and the same fingerprint panel the
 * connect flow uses is showing (`scanDsh` re-runs with that fingerprint). The
 * four states the UI must render are therefore scanning / empty / candidates /
 * host-key, and they are all derivable from this record.
 */
export interface DshScanState {
  status: 'idle' | 'scanning' | 'ready' | 'unavailable'
  candidates: DshCandidate[]
  probe?: RemoteRuntimeProbe
  package?: ServerPackageState
  /** Set while the host answered `stage: 'host-key'`; cleared by a good scan. */
  fingerprint?: string
  error?: string
}

/** One progress row's state. */
export interface StepState {
  status: 'pending' | 'running' | 'ok' | 'failed'
  message?: string
  detail?: string
}

/** The host-key confirmation the server is waiting on. */
export interface HostKeyPrompt {
  fingerprint: string
  algorithm?: string
  answering: boolean
  trusted: boolean
}

/** One timestamped line of the connection log (ZCode-style live log). */
export interface ConnectLogLine {
  readonly time: string
  readonly level: 'info' | 'ok' | 'error'
  readonly text: string
}

/** Connection attempt state (step 3). */
export interface ConnectState {
  phase: 'idle' | 'running' | 'awaiting-hostkey' | 'failed' | 'succeeded'
  ticket?: string
  steps: Record<ConnectStep, StepState>
  /** Live connection log, oldest first, capped. */
  readonly log: ConnectLogLine[]
  hostKey?: HostKeyPrompt
  target?: PublicTarget
  error?: WireError
}

/** Remote directory browser state (the 添加工作区 dialog's default tab). */
export interface DirectoryState {
  /**
   * Whether the browse dialog is open. This used to be implied by the wizard
   * being on its `directory` step; the dialog owns its own lifetime now, so the
   * flag lives with the state it gates.
   */
  open: boolean
  targetId?: string
  listing?: ListDirResult
  loading: boolean
  /** Slow operation: the channel is being (re)established — show 连接中. */
  connecting: boolean
  creating: boolean
  error?: WireError
  newDirName: string
  title: string
  /** Whether the user edited the workspace title (navigation then keeps it). */
  titleTouched: boolean
  pathInput: string
}

/** A transient success/failure notice rendered as the official `Toast`. */
export interface Notice {
  kind: 'success' | 'error'
  text: string
}

/** Remote sessions of one workspace, as the tree shows them. */
export interface SessionListState {
  loading: boolean
  loaded: boolean
  items: RemoteSession[]
  error?: WireError
}

/** The 添加工作区 picker: workspaces the remote dsh itself has registered. */
/** A destructive row verb waiting for the user's confirmation. */
export interface ConfirmState {
  readonly kind: 'forget-connection' | 'forget-workspace'
  readonly title: string
  readonly message: string
  readonly confirmLabel: string
  readonly targetId: string
  readonly workspaceId?: string
}

export interface AddWorkspaceState {
  targetId: string
  targetLabel: string
  /** Which tab of the dialog is showing; the browse tab is the default. */
  tab: 'browse' | 'registry'
  loading: boolean
  items: RemoteRegistryWorkspace[]
  error?: WireError
}

/** The 重命名工作区 dialog's pending request. */
export interface WorkspaceRenameState {
  readonly workspace: RemoteWorkspace
  readonly title: string
}

/** The complete rendered snapshot. */
export interface AppState {
  open: boolean
  view: WizardView
  step: WizardStep
  method: ConnectionMethod
  config: ConnectDraft
  aliases: SshAlias[]
  aliasWarnings: string[]
  aliasesLoading: boolean
  aliasesLoaded: boolean
  prefilling: boolean
  /** Harness host platform (`process.platform`); gates the WSL method. */
  platform: string
  /** WSL distribution discovery, driven by the wizard's WSL config step. */
  wslProbe: WslProbeState
  /** The step-3 read-only scan: remote architecture, package state, dsh candidates. */
  dshScan: DshScanState
  targets: PublicTarget[]
  workspaces: RemoteWorkspace[]
  pluginVersion: string
  defaultProfile: string
  stateLoaded: boolean
  stateLoading: boolean
  /** A primary command is in flight (primary buttons disable). */
  pending: boolean
  /** Whether a submitted secret is still held for a retry (never the secret itself). */
  secretPending: boolean
  /** Tree nodes the user expanded, keyed `target:<id>` / `workspace:<id>`. */
  expanded: Record<string, boolean>
  /** Lazily loaded remote session lists, keyed by the plugin's workspace id. */
  sessions: Record<string, SessionListState>
  /** The 添加工作区 picker, when it is open. */
  addWorkspace?: AddWorkspaceState
  /** The session this device most recently opened (row selection state). */
  currentSessionId?: string
  /** The rename dialog's target, when it is open. */
  renameTarget?: { workspace: RemoteWorkspace; session: RemoteSession; title: string }
  /** The 重命名工作区 dialog's target, when it is open. */
  renameWorkspace?: WorkspaceRenameState
  /** A destructive row verb waiting for confirmation, when one is open. */
  confirm?: ConfirmState
  error?: WireError
  notice?: Notice
  connect: ConnectState
  directory: DirectoryState
  /** Fingerprint the user trusted, scoped to the host it was confirmed for. */
  trusted?: { host: string; port: number; username: string; fingerprint: string }
}

/** Log lines kept per attempt; older lines fall off the head. */
const CONNECT_LOG_LIMIT = 400

/** Lines that report continuous progress (`upload progress (node): 42.0% …`)
 *  collapse into one live row per key instead of flooding the log. */
const PROGRESS_PREFIX = /^(upload progress \([^)]*\)|download progress):/

/**
 * Run a directory-plane operation, flipping `connecting` when it outlives
 * `delay` — the point where a plain read has become a channel (re)build, which
 * can take seconds. The UI then shows 连接中 instead of a bare reading line.
 */
async function withConnecting<T>(run: () => Promise<T>): Promise<T> {
  const timer = setTimeout(() => {
    commit(previous => ({ directory: { ...previous.directory, connecting: true } }))
  }, 1_200)
  try {
    return await run()
  } finally {
    clearTimeout(timer)
    commit(previous => previous.directory.connecting ? { directory: { ...previous.directory, connecting: false } } : {})
  }
}

/** Append one line to the current attempt's live log. */
function appendLog(level: ConnectLogLine['level'], text: string): void {
  const line: ConnectLogLine = {
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    level,
    text,
  }
  const previous = state.connect.log
  const last = previous[previous.length - 1]
  const progressKey = PROGRESS_PREFIX.exec(text)?.[0]
  if (progressKey !== undefined && last !== undefined && PROGRESS_PREFIX.exec(last.text)?.[0] === progressKey) {
    // Same progress stream: replace the previous row (ZCode collapses these too).
    const log = [...previous.slice(0, -1), line]
    commit({ connect: { ...state.connect, log } })
    return
  }
  const log = [...previous, line]
  commit({ connect: { ...state.connect, log: log.length > CONNECT_LOG_LIMIT ? log.slice(log.length - CONNECT_LOG_LIMIT) : log } })
}

function emptySteps(): Record<ConnectStep, StepState> {
  return {
    connect: { status: 'pending' },
    probe: { status: 'pending' },
    runtime: { status: 'pending' },
    upload: { status: 'pending' },
    start: { status: 'pending' },
  }
}

function idleConnect(): ConnectState {
  return { phase: 'idle', steps: emptySteps(), log: [] }
}

function emptyDshScan(): DshScanState {
  return { status: 'idle', candidates: [] }
}

function emptyDirectory(): DirectoryState {
  return {
    open: false,
    loading: false,
    creating: false,
    newDirName: '',
    title: '',
    titleTouched: false,
    pathInput: '',
    connecting: false,
  }
}

function emptyDraft(): ConnectDraft {
  return {
    label: '',
    host: '',
    port: '22',
    username: '',
    authKind: 'password',
    secret: '',
    privateKeyPath: '',
    wslDistro: '',
    wslUser: '',
    nodePath: '',
    dshCommand: '',
    profile: '',
    dshHome: '',
    connectionMode: '',
    reuseLauncherPath: '',
  }
}

function initialState(): AppState {
  return {
    open: false,
    view: 'list',
    step: 'method',
    method: 'ssh',
    config: emptyDraft(),
    aliases: [],
    aliasWarnings: [],
    aliasesLoading: false,
    aliasesLoaded: false,
    prefilling: false,
    platform: '',
    wslProbe: { status: 'idle', distros: [] },
    dshScan: emptyDshScan(),
    targets: [],
    workspaces: [],
    pluginVersion: '',
    defaultProfile: '',
    stateLoaded: false,
    stateLoading: false,
    pending: false,
    secretPending: false,
    expanded: {},
    sessions: {},
    connect: idleConnect(),
    directory: emptyDirectory(),
  }
}

/* ------------------------------------------------------------------ store */

let state: AppState = initialState()
const listeners = new Set<() => void>()

/**
 * Monotonic id of the current overlay session. Every asynchronous action
 * captures it and drops its result when the session moved on (overlay closed,
 * new connection started, plugin disposed), so a late response can never
 * resurrect a dialog the user already left.
 */
let generation = 0

/** In-flight attempt's secret: deliberately outside the rendered snapshot. */
let pendingSecret: string | undefined

/** Closer of the live SSE stream, when one is open. */
let closeStream: (() => void) | undefined

function commit(patch: Partial<AppState> | ((previous: AppState) => Partial<AppState>)): void {
  const changes = typeof patch === 'function' ? patch(state) : patch
  if (changes === undefined || Object.keys(changes).length === 0) return
  state = { ...state, ...changes }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot(): AppState {
  return state
}

/** Snapshot hook for the button and the overlay. */
export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Whether the overlay is open. The footer button only needs this bit, and a
 * primitive snapshot keeps it from re-rendering on every SSE progress frame.
 */
export function useOverlayOpen(): boolean {
  return useSyncExternalStore(subscribe, () => state.open, () => state.open)
}

/** Number of saved remote items (badge on the footer button). */
export function useRemoteItemCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => state.targets.length + state.workspaces.length,
    () => state.targets.length + state.workspaces.length,
  )
}

/* ------------------------------------------------------------- derivations */

/**
 * Whether the overlay refuses to close right now: a connection attempt is
 * running or waiting for a host-key decision, and closing would orphan it.
 * @param current - the snapshot to inspect.
 */
export function isConnectBlocking(current: AppState): boolean {
  if (current.view !== 'wizard' || current.step !== 'connect') return false
  return current.connect.phase === 'running' || current.connect.phase === 'awaiting-hostkey'
}

/** Sort directories first, then files, each alphabetically. */
export function sortEntries(entries: readonly DirEntry[]): DirEntry[] {
  return [...entries].sort((left, right) => {
    const leftDirectory = left.type === 'directory' ? 0 : 1
    const rightDirectory = right.type === 'directory' ? 0 : 1
    if (leftDirectory !== rightDirectory) return leftDirectory - rightDirectory
    return left.name.localeCompare(right.name, 'zh-Hans-CN')
  })
}

/** Last path segment, for a default workspace title. */
export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  const name = index === -1 ? trimmed : trimmed.slice(index + 1)
  return name === '' ? '/' : name
}

/** Join a directory path with one child name. */
export function joinPath(base: string, name: string): string {
  return base === '' || base === '/' ? `/${name}` : `${base.replace(/\/+$/, '')}/${name}`
}

/* ---------------------------------------------------------------- helpers */

function validation(messageKey: LocaleKey): WireError {
  return { code: 'invalid', message: t(messageKey) }
}

/** Validate everything but the secret; the secret is resolved separately. */
function validateDraft(draft: ConnectDraft, method: ConnectionMethod): WireError | undefined {
  if (draft.label.trim() === '') return validation('config.alias.required')
  // A WSL draft has no host/port/user of its own: it names a distribution.
  if (method === 'wsl') {
    if (draft.wslDistro.trim() === '') return validation('config.wslDistro.required')
    return undefined
  }
  if (draft.host.trim() === '') return validation('config.host.required')
  const port = Number(draft.port.trim())
  if (!Number.isInteger(port) || port < 1 || port > 65535) return validation('config.port.invalid')
  if (draft.username.trim() === '') return validation('config.username.required')
  return undefined
}

/** Resolve the secret to send, reusing the in-flight one on a retry. */
function resolveSecret(draft: ConnectDraft): { ok: true; secret?: string } | { ok: false; error: WireError } {
  if (draft.authKind === 'agent') return { ok: true }
  if (draft.authKind === 'privateKey') {
    if (draft.privateKeyPath.trim() === '') return { ok: false, error: validation('config.secret.privateKey.required') }
    const passphrase = draft.secret !== '' ? draft.secret : pendingSecret
    return passphrase === undefined || passphrase === '' ? { ok: true } : { ok: true, secret: passphrase }
  }
  const password = draft.secret !== '' ? draft.secret : pendingSecret
  if (password === undefined || password === '') return { ok: false, error: validation('config.secret.password.required') }
  return { ok: true, secret: password }
}

/** Non-empty remote-runtime overrides only. */
function buildRemote(draft: ConnectDraft): RemoteRuntimeInput | undefined {
  const remote: RemoteRuntimeInput = {}
  if (draft.nodePath.trim() !== '') remote.nodePath = draft.nodePath.trim()
  if (draft.dshCommand.trim() !== '') remote.dshCommand = draft.dshCommand.trim()
  if (draft.profile.trim() !== '') remote.profile = draft.profile.trim()
  if (draft.dshHome.trim() !== '') remote.dshHome = draft.dshHome.trim()
  return Object.keys(remote).length === 0 ? undefined : remote
}

function stopStream(): void {
  const close = closeStream
  closeStream = undefined
  if (close !== undefined) close()
}

/**
 * Hold (or drop) the submitted secret outside the rendered snapshot.
 * @param value - the secret to reuse on a retry, or undefined to drop it.
 */
function setPendingSecret(value: string | undefined): void {
  pendingSecret = value
  commit({ secretPending: value !== undefined })
}

/** Localized time text for a saved row, or undefined when absent/unparseable. */
export function formatTimestamp(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

/* ---------------------------------------------------------------- actions */

/** The client context, bound in `apply`, for shell-owned services. */
let clientContext: ClientContext | undefined

/** Capture the client context for {@link revealSession}. */
export function bindClientContext(ctx: ClientContext): void {
  clientContext = ctx
}

/**
 * Sessions this plugin has put on the shell's screen, mapped to the target each
 * one belongs to.
 *
 * A disconnect destroys the *remote* session, and the shell has no idea: it
 * keeps the session selected (`dsh.sessions.current`), keeps a `mainView`
 * retention and keeps the right-bar view bound to it. Answering "is the shell's
 * current conversation one of ours for this target?" is what lets us deselect
 * before tearing the session down (see {@link releaseShellSelection}).
 */
const revealedSessions = new Map<string, string>()

/** The shell service fields this file reads / calls (see context.ts). */
interface ShellWorkspaceService {
  openSession?(id: string): void
  /** Releases the selected conversation (ui-workspace `clearMain`). */
  clearMain?(): void
  /** Persisted selection snapshot: `dsh.sessions.current`. */
  selection?: { getSnapshot?(): { sessionId?: unknown } }
}

function shellWorkspace(): ShellWorkspaceService | undefined {
  try {
    return clientContext?.get('uiWorkspace') as ShellWorkspaceService | undefined
  } catch {
    return undefined
  }
}

/**
 * The session the shell currently shows, read through the official service.
 * @returns the session id, or undefined when nothing is selected.
 */
function shellSelectedSessionId(): string | undefined {
  try {
    const selected = shellWorkspace()?.selection?.getSnapshot?.()?.sessionId
    if (typeof selected === 'string' && selected !== '') return selected
  } catch {
    // Fall through to the retention scan: a shape change must not disable the
    // deselect guard silently.
  }
  return mainViewRetainedSessionId()
}

/**
 * Fallback for {@link shellSelectedSessionId}: the row carrying a `mainView`
 * retention.
 *
 * That is the same predicate the shell's own `mainSessionId()` uses over the
 * Session list snapshot, i.e. a published `retainedBy.mainView` counter rather
 * than a private field.
 * @returns the selected session id, or undefined when there is none.
 */
function mainViewRetainedSessionId(): string | undefined {
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
    // Nothing to do: without a readable selection the guard simply stays off.
  }
  return undefined
}

/**
 * Drop the shell's selected conversation — the official deselect hop.
 *
 * `uiWorkspace.clearMain()` is exactly what the shell itself runs when the open
 * session is archived (`archiveSession` → `clearMain`): it releases the
 * `mainView` retention, clears the persisted selection and retires the right-bar
 * view bound to that session.
 */
function clearShellSelection(): void {
  try {
    const workspace = shellWorkspace()
    if (workspace !== undefined && typeof workspace.clearMain === 'function') workspace.clearMain()
  } catch (error) {
    console.error('[dsh-remote-workspace] clearing the shell selection failed', error)
  }
}

/**
 * Deselect the shell's conversation when it shows one of *this* target's sessions.
 *
 * **Why this exists (measured in alpha52, white-page defect):** 断开 destroys the
 * remote session, but nothing told the shell to stop showing it. The session
 * record stops being live, and the next render of a session-scoped slot runs
 * `ui-session.bindingSource(reference)` → `reference.binding`, which throws
 * `Session reference "session-…" is released`; with no error boundary React then
 * unmounts the entire app (blank `body`, no rows, only a reload recovers).
 * The same stale id also trips `uiConversation.binding: unknown session` on the
 * next locale refresh. Deselecting *before* the teardown removes both: the
 * `mainView` reference is released while it is still valid, and the right-bar
 * view for that session is pruned with the selection.
 *
 * Only a session this plugin revealed for this target is deselected — the
 * user's own local conversation is never touched.
 * @param targetId - the target whose remote sessions are about to go away.
 */
function releaseShellSelection(targetId: string): void {
  const selected = shellSelectedSessionId()
  if (selected === undefined) return
  const known = revealedSessions.get(selected)
  const mine = known === undefined ? targetOwnsSession(targetId, selected) : known === targetId
  if (!mine) return
  clearShellSelection()
  revealedSessions.delete(selected)
  if (state.currentSessionId === selected) commit({ currentSessionId: undefined })
}

/**
 * Whether one session id belongs to this target according to our own records.
 *
 * The revealed map is module state and a hot reload loses it, while the shell
 * keeps its selection; the workspace records (and the cached remote session
 * lists they hang off) do not. A session id can only appear under one target,
 * so a match cannot be a false positive.
 * @param targetId - the target being torn down.
 * @param sessionId - the shell's selected session.
 * @returns true when the id is one of this target's remote sessions.
 */
function targetOwnsSession(targetId: string, sessionId: string): boolean {
  for (const workspace of state.workspaces) {
    if (workspace.targetId !== targetId) continue
    if (workspace.sessionId === sessionId) return true
    if (state.sessions[workspace.id]?.items.some(item => item.id === sessionId) === true) return true
  }
  return false
}

/**
 * Ask the shell to bring a just-opened session to the front. The shell owns
 * session navigation: `uiWorkspace.openSession` is how its own UI switches
 * conversations; without this the workspace opens silently and the user stays
 * on the plugin panel with only a toast.
 *
 * **Why it waits (alpha55 defect):** `uiWorkspace.openSession` → `replaceMain` →
 * `sessions.retain(id)`, and the shell's client catalog rejects an id it has not
 * seen yet with `sessions.retain: unknown session <id>` (thrown from the
 * SessionManager's `resolveTarget`). A remote session is in that catalog only
 * because the *host* forwarded its "session added" summary — a frame that is not
 * ordered before the `POST /api/open-session` response. Before the first
 * disconnect the row was already there, so the reveal happened to win; right
 * after a reconnect (our teardown had dropped the host session, so the click's
 * resume re-creates it) the reveal could beat the frame, the throw was
 * swallowed, and the click visibly did nothing at all.
 * @param sessionId - the session to show.
 * @param targetId - the target owning it, remembered so a disconnect can
 *   deselect it ({@link releaseShellSelection}).
 */
async function revealSession(sessionId: string, targetId?: string): Promise<void> {
  if (targetId !== undefined) revealedSessions.set(sessionId, targetId)
  const workspace = shellWorkspace()
  if (workspace === undefined || typeof workspace.openSession !== 'function') return
  await waitForShellSession(sessionId)
  try {
    workspace.openSession(sessionId)
  } catch (error) {
    // Never swallow: a failed reveal leaves the main column on
    // 选择一个工作区开始 with no explanation anywhere (the plugin's error banner
    // lives in a panel that is not showing) — exactly the silent dead click.
    console.error('[dsh-remote-workspace] revealSession failed', error)
    notifyError(t('tree.session.revealFailed', { message: error instanceof Error ? error.message : String(error) }))
  }
}

/** How long the shell's client catalog may take to learn a just-resumed session. */
const REVEAL_WAIT_MS = 4_000

/** Poll interval while waiting for that catalog row. */
const REVEAL_POLL_MS = 250

/** The shell's client `sessions` service, as this file reads it. */
interface ShellSessionsService {
  list?: { getSnapshot?(): { byId?: Record<string, unknown> } }
  /** Authoritative baseline re-pull (the shell's own public method). */
  refresh?(): Promise<unknown>
}

function shellSessions(): ShellSessionsService | undefined {
  try {
    return clientContext?.get('sessions') as ShellSessionsService | undefined
  } catch {
    return undefined
  }
}

/**
 * Whether the shell's client catalog knows this session id.
 *
 * That is exactly the observable `sessions.retain(id)` checks before throwing
 * `unknown session`, so the reveal is safe once it reads true.
 * @param sessions - the shell's sessions service.
 * @param sessionId - the session about to be revealed.
 * @returns true when the id has a row in the shell's session list snapshot.
 */
function shellSessionKnown(sessions: ShellSessionsService, sessionId: string): boolean {
  try {
    const byId = sessions.list?.getSnapshot?.()?.byId
    return byId !== undefined && byId[sessionId] !== undefined
  } catch {
    return false
  }
}

/**
 * Wait (bounded) until the shell can select this session.
 *
 * Returns immediately when the service is not reachable at all: the wait must
 * only ever postpone a reveal it can actually help, never delay every click by
 * the timeout.
 * @param sessionId - the session about to be revealed.
 */
async function waitForShellSession(sessionId: string): Promise<void> {
  const sessions = shellSessions()
  if (sessions === undefined) return
  if (shellSessionKnown(sessions, sessionId)) return
  // The forwarded "session added" frame can be late; ask for one authoritative
  // baseline pull as well as polling the snapshot it feeds.
  try {
    if (typeof sessions.refresh === 'function') void Promise.resolve(sessions.refresh()).catch(() => {})
  } catch {
    // Polling below is enough.
  }
  const deadline = Date.now() + REVEAL_WAIT_MS
  while (!shellSessionKnown(sessions, sessionId) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, REVEAL_POLL_MS))
  }
}

/** Open one session in the shell's main column (the official navigation hop). */
function revealSessionId(sessionId: string, targetId?: string): void {
  void revealSession(sessionId, targetId)
}

/**
 * Pin/unpin or archive/unarchive one remote session.
 *
 * The sets live on the plugin's own workspace record (the host owns them), so
 * the action is a host call followed by a state refresh; the row's pinned /
 * archived look, its ordering and its openability all read from that record.
 * @param workspace - the workspace the session belongs to.
 * @param sessionId - the stored remote session id.
 * @param flag - which set to change.
 * @param on - add or drop the id.
 */
async function setSessionFlag(workspace: RemoteWorkspace, sessionId: string, flag: 'pinned' | 'archived', on: boolean): Promise<void> {
  if (state.pending) return
  const gen = generation
  commit({ pending: true, error: undefined })
  try {
    await api.sessionFlag(workspace.id, sessionId, flag, on)
    if (gen !== generation) return
    commit({
      pending: false,
      notice: {
        kind: 'success',
        text: flag === 'pinned'
          ? t(on ? 'tree.session.pinned' : 'tree.session.unpinned')
          : t(on ? 'tree.session.archived' : 'tree.session.unarchived'),
      },
    })
    await refreshState()
  } catch (error) {
    if (gen !== generation) return
    commit({ pending: false, error: toWireError(error) })
  }
}

/**
 * Reload one workspace's session list now, whatever its cache says.
 *
 * Used by verbs that change the list from *outside* the panel (a fork creates a
 * session that only appears on the next read).
 * @param workspace - the workspace whose list changed.
 */
async function refreshSessions(workspace: RemoteWorkspace): Promise<void> {
  invalidateSessions(workspace.id)
  await loadSessions(workspace, true)
}

/**
 * Rename one remote session through the plugin's own host hop.
 * @param workspace - the workspace the session belongs to.
 * @param sessionId - the stored remote session id.
 * @param title - the new title.
 */
async function renameSession(workspace: RemoteWorkspace, sessionId: string, title: string): Promise<void> {
  const gen = generation
  commit({ pending: true, error: undefined })
  try {
    await api.sessionRename(workspace.targetId, workspace.path, sessionId, title)
    if (gen !== generation) return
    commit({ pending: false, notice: { kind: 'success', text: t('tree.session.renamed') } })
    await refreshState()
    // The rename is an append on the live session; its durability barrier runs
    // on the host, so the very next list read can still observe the previous
    // title (measured). Re-read until the new title is visible, bounded.
    for (const delay of [0, 400, 900, 1800]) {
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
      if (gen !== generation) return
      await refreshSessions(workspace)
      const listed = state.sessions[workspace.id]?.items.find(item => item.id === sessionId)
      if (listed?.title === title) return
    }
  } catch (error) {
    if (gen !== generation) return
    commit({ pending: false })
    throw error
  }
}

/**
 * Ask before forgetting a connection.
 *
 * Forgetting is not undoable: the target record, its stored secret, its
 * workspaces, their shell-tree entries and the stub directories all go with it.
 * `断开` is the non-destructive verb and sits in the same row menu, so a
 * misclick that silently deleted a connection is exactly what this prevents.
 * @param target - the connection row's target.
 */
function requestForgetTarget(target: PublicTarget): void {
  commit({
    confirm: {
      kind: 'forget-connection',
      title: t('tree.forget.confirm.title'),
      message: t('tree.forget.confirm.message', { label: target.label, count: state.workspaces.filter(w => w.targetId === target.id).length }),
      confirmLabel: t('list.forget'),
      targetId: target.id,
    },
  })
}

/**
 * Ask before removing a remote workspace (its record, tree entry and stub).
 * @param workspace - the workspace row's record.
 */
function requestForgetWorkspace(workspace: RemoteWorkspace): void {
  commit({
    confirm: {
      kind: 'forget-workspace',
      title: t('tree.forget.workspace.title'),
      message: t('tree.forget.workspace.message', { title: workspace.title, path: workspace.path }),
      confirmLabel: t('tree.workspace.forget'),
      targetId: workspace.targetId,
      workspaceId: workspace.id,
    },
  })
}

/** Close the confirmation without acting. */
function settleConfirm(): void {
  commit({ confirm: undefined })
}

/** Run the confirmed destructive verb, then close the dialog. */
async function acceptConfirm(): Promise<void> {
  const pending = state.confirm
  if (pending === undefined) return
  commit({ confirm: undefined })
  if (pending.kind === 'forget-connection') {
    const target = state.targets.find(candidate => candidate.id === pending.targetId)
    if (target !== undefined) await forgetTarget(target)
    return
  }
  const workspace = state.workspaces.find(candidate => candidate.id === pending.workspaceId)
  if (workspace !== undefined) await forgetWorkspace(workspace)
}

/** Open the rename dialog for one remote session. */
function requestRename(workspace: RemoteWorkspace, session: RemoteSession): void {
  commit({ renameTarget: { workspace, session, title: session.title ?? '' } })
}

/** Close the rename dialog. */
function settleRename(): void {
  commit({ renameTarget: undefined })
}

/** Read saved targets/workspaces (and auto-enter the wizard on a first run). */
async function refreshState(): Promise<void> {
  const gen = generation
  const firstLoad = !state.stateLoaded
  // Compared after the commit, so it has to be captured here: the loop below
  // needs "was this target ready before this refresh?".
  const before = state.targets
  commit({ stateLoading: true })
  try {
    const value = await api.state()
    if (gen !== generation) return
    const hasSaved = value.targets.length > 0 || value.workspaces.length > 0
    commit({
      targets: value.targets,
      workspaces: value.workspaces,
      pluginVersion: value.pluginVersion,
      defaultProfile: value.defaultProfile,
      // The host platform gates the WSL method; it must ride the *successful*
      // commit too (the retry branch below is only reached on a first-load
      // error, so persisting it there alone left `platform` empty on every
      // normal load and silently filtered the WSL card out).
      platform: value.platform ?? '',
      stateLoaded: true,
      stateLoading: false,
    })
    if (firstLoad && state.open && state.view === 'list' && !hasSaved) commit({ view: 'wizard', step: 'method' })
    // The status is computed from live channels, so this also folds a subtree
    // whose channel died in the background — not only an explicit 断开.
    for (const target of value.targets) {
      if (target.status !== 'ready') {
        collapseTarget(target.id)
        // A channel that died under an open conversation takes its sessions with
        // it: deselect before the shell renders a released reference (same
        // white-page chain as stopTarget — see releaseShellSelection).
        if (before.find(candidate => candidate.id === target.id)?.status === 'ready') releaseShellSelection(target.id)
      }
    }
  } catch (error) {
    if (gen !== generation) return
    // A first frame can arrive while the plugin host is still opening its
    // storage; retry briefly instead of showing an empty panel that only a
    // manual 刷新 fixes.
    if (firstLoad) {
      for (let attempt = 1; attempt <= 4; attempt++) {
        await new Promise(resolve => setTimeout(resolve, attempt * 750))
        if (gen !== generation) return
        try {
          const value = await api.state()
          if (gen !== generation) return
          commit({
            targets: value.targets,
            workspaces: value.workspaces,
            pluginVersion: value.pluginVersion,
            defaultProfile: value.defaultProfile,
            platform: value.platform ?? '',
            stateLoaded: true,
            stateLoading: false,
          })
          return
        } catch {}
      }
    }
    commit({ stateLoading: false, stateLoaded: true, error: toWireError(error) })
  }
}

/**
 * Leave the wizard and return to the saved-items list; refused while a
 * connection attempt owns the flow.
 *
 * Named for the overlay days: the panel's 取消/关闭 buttons land here, so
 * leaving now also rewinds the view.
 */
function closeOverlay(): void {
  if (isConnectBlocking(state)) return
  generation += 1
  stopStream()
  setPendingSecret(undefined)
  commit({
    open: false,
    view: 'list',
    error: undefined,
    notice: undefined,
    prefilling: false,
    pending: false,
    addWorkspace: undefined,
    renameWorkspace: undefined,
    directory: emptyDirectory(),
  })
}

/**
 * Open the connection wizard: switch the main column to this plugin's panel
 * (the wizard's home) and enter the wizard view. Called from the sidebar
 * section's 新建连接 button, which lives outside the main panel.
 * @param panelId - this plugin's main-panel key.
 */
function openConnectionWizard(panelId: string): void {
  try {
    const layout = clientContext?.get('layout') as { selectPanel?(id: string): void } | undefined
    layout?.selectPanel?.(panelId)
  } catch (error) {
    console.error('[dsh-remote-workspace] selectPanel failed', error)
  }
  newConnection()
}

/** Leave the list and start a fresh wizard run. */
function newConnection(): void {
  generation += 1
  stopStream()
  setPendingSecret(undefined)
  commit({
    view: 'wizard',
    step: 'method',
    error: undefined,
    notice: undefined,
    // A fresh run also releases any flag an abandoned request left behind.
    prefilling: false,
    pending: false,
    stateLoading: false,
    addWorkspace: undefined,
    renameWorkspace: undefined,
    connect: idleConnect(),
    dshScan: emptyDshScan(),
    directory: emptyDirectory(),
  })
}

/** Switch the wizard to a step, loading that step's data. */
function setStep(step: WizardStep): void {
  commit({ step, error: undefined })
  if (step === 'config') {
    if (state.method === 'wsl') void loadWslDistros()
    else void loadAliases()
    return
  }
  if (step === 'connect') {
    // Step 3 opens with what the scan knows: the reuse candidate list and the
    // upload card's "which package does the remote need" line both come from it,
    // for either method. The scan runs on this user action only (hard
    // constraint 10: never from render), and never twice for one identity.
    if (state.dshScan.status === 'idle' && state.dshScan.fingerprint === undefined) void scanDsh()
  }
}

function setMethod(method: ConnectionMethod): void {
  // Hidden methods cannot be selected even if some stale node still calls this.
  if (!methodAvailable(method, state.platform)) return
  // The scan is a fact about one identity on one method: switching method makes
  // it stale, and a stale candidate list is worse than none.
  commit({ method, dshScan: emptyDshScan() })
  if (method === 'wsl') void loadWslDistros()
}

/**
 * Detect the installed WSL distributions.
 *
 * Called when the WSL config step is entered (never at activation: it spawns
 * `wsl.exe`, and `wsl -l` is the one subcommand that does not start a distro).
 * The default distribution is preselected so the common case needs no click.
 * @param force - re-run even when a result is already cached.
 */
async function loadWslDistros(force = false): Promise<void> {
  if (state.wslProbe.status === 'loading') return
  if (state.wslProbe.status === 'ready' && !force) return
  const gen = generation
  commit({ wslProbe: { status: 'loading', distros: state.wslProbe.distros } })
  try {
    const value = await api.wslDistros()
    if (gen !== generation) return
    if (!value.available) {
      commit({ wslProbe: { status: 'unavailable', distros: [], ...(value.error === undefined ? {} : { error: value.error }) } })
      return
    }
    commit((previous) => {
      // Preselect: keep a still-valid choice, else the default distro, else the first.
      const names = value.distros.map(distro => distro.name)
      const current = previous.config.wslDistro
      const keep = names.includes(current) ? current : undefined
      const preferred = keep ?? value.distros.find(distro => distro.default)?.name ?? value.distros[0]?.name ?? ''
      return {
        wslProbe: { status: 'ready', distros: value.distros },
        config: { ...previous.config, wslDistro: preferred },
      }
    })
  } catch (error) {
    if (gen !== generation) return
    const wire = toWireError(error)
    commit({ wslProbe: { status: 'unavailable', distros: [], error: wire.message } })
  }
}

function patchConfig(patch: Partial<ConnectDraft>): void {
  setPendingSecret(undefined)
  // Editing the fields the alias resolved means the alias no longer describes
  // this connection (its ProxyJump/IdentityFile may not apply), so the marker
  // is dropped; picking the alias again re-establishes it.
  const clearsAlias = patch.host !== undefined || patch.port !== undefined || patch.username !== undefined
  // The scan describes one identity (and one remote DSH_HOME): any edit that
  // changes who/where we would connect to invalidates it.
  const clearsScan = SCAN_IDENTITY_FIELDS.some(field => patch[field] !== undefined)
  commit((previous) => {
    const config: ConnectDraft = { ...previous.config, ...patch }
    if (clearsAlias) delete config.sshConfigAlias
    // A live attempt keeps its own log: editing a field mid-flight must not
    // pull the record of what the host is actually doing out from under it.
    const live = previous.connect.phase === 'running' || previous.connect.phase === 'awaiting-hostkey'
    return {
      config,
      ...(clearsScan ? { dshScan: emptyDshScan() } : {}),
      ...(clearsScan && !live ? { connect: idleConnect() } : {}),
    }
  })
}

/** Draft fields a scan result depends on. */
const SCAN_IDENTITY_FIELDS: readonly (keyof ConnectDraft)[] = [
  'host', 'port', 'username', 'authKind', 'privateKeyPath',
  'wslDistro', 'wslUser', 'profile', 'dshHome',
]

function dismissError(): void {
  commit({ error: undefined })
}

/** Report one success notice (used by row verbs that own no panel chrome). */
function notifySuccess(text: string): void {
  commit({ notice: { kind: 'success', text } })
}

/** Report one failure notice. */
function notifyError(text: string): void {
  commit({ notice: { kind: 'error', text } })
}

function dismissNotice(): void {
  commit({ notice: undefined })
}

/**
 * Observe the rows this plugin must keep out of the shell's own 工作区 section:
 * the official workspace ids of its stubs, plus every remote session id it knows
 * about. Fires immediately and on every change.
 * @param apply - sink for the two id lists.
 * @returns a disposer removing the subscription.
 */
export function watchShellRows(apply: (workspaceIds: readonly string[], sessionIds: readonly string[]) => void): () => void {
  const run = (): void => {
    const workspaceIds = state.workspaces
      .map(workspace => workspace.officialWorkspaceId ?? '')
      .filter(id => id !== '')
    const sessionIds = new Set<string>()
    for (const workspace of state.workspaces) {
      if (workspace.sessionId !== undefined && workspace.sessionId !== '') sessionIds.add(workspace.sessionId)
    }
    for (const list of Object.values(state.sessions)) {
      for (const session of list.items) sessionIds.add(session.id)
    }
    apply(workspaceIds, [...sessionIds])
  }
  run()
  return subscribe(run)
}

/** Load `~/.ssh/config` aliases once per overlay session. */
async function loadAliases(force = false): Promise<void> {
  if (state.aliasesLoading) return
  if (state.aliasesLoaded && !force) return
  const gen = generation
  commit({ aliasesLoading: true })
  try {
    const value = await api.sshAliases()
    if (gen !== generation) return
    commit({ aliases: value.aliases, aliasWarnings: value.warnings, aliasesLoading: false, aliasesLoaded: true })
  } catch (error) {
    if (gen !== generation) return
    commit({ aliasesLoading: false, aliasesLoaded: true, error: toWireError(error) })
  }
}

/**
 * Prefill host/port/user/key from one `~/.ssh/config` alias.
 *
 * The patch comes from `alias-prefill.ts`, which never touches `authKind`: an
 * alias states *where* to connect and which identity file it names, not *how*
 * the user wants to authenticate. Forcing 私钥 off an `IdentityFile` made a
 * password-only host fail with "All configured authentication methods failed"
 * (alpha55 defect).
 */
async function chooseAlias(alias: string): Promise<void> {
  const gen = generation
  commit({ prefilling: true, error: undefined })
  try {
    const value = await api.aliasPrefill(alias)
    if (gen !== generation) {
      commit({ prefilling: false })
      return
    }
    setPendingSecret(undefined)
    commit(previous => ({
      prefilling: false,
      // Picking an alias re-points the connection at another identity, so the
      // scan (architecture, candidates) belongs to the previous one and goes.
      dshScan: emptyDshScan(),
      config: {
        ...previous.config,
        ...draftFromAlias(value, previous.config),
        secret: '',
      },
    }))
  } catch (error) {
    if (gen !== generation) return
    commit({ prefilling: false, error: toWireError(error) })
  }
}

/** Choose one of step 3's three connection methods. */
function setConnectionMode(mode: '' | ConnectionMode): void {
  // NOT `patchConfig`: that drops the held secret, and switching reuse→upload
  // after the password was entered would then demand it again for no reason.
  commit(previous => ({ config: { ...previous.config, connectionMode: mode }, error: undefined }))
  // Both remaining methods need the scan: reuse lists the candidates, upload
  // shows the architecture and whether the package is already cached locally.
  if ((mode === 'reuse' || mode === 'upload') && state.dshScan.status === 'idle' && state.dshScan.fingerprint === undefined) {
    void scanDsh()
  }
}

/**
 * The fingerprint this device already confirmed for the draft's identity.
 * @param host - the draft's host.
 * @param port - the draft's port.
 * @param username - the draft's user.
 * @returns the confirmed fingerprint, or undefined when this identity is new.
 */
function trustedFingerprint(host: string, port: number, username: string): string | undefined {
  const trusted = state.trusted
  if (trusted === undefined) return undefined
  return trusted.host === host && trusted.port === port && trusted.username === username ? trusted.fingerprint : undefined
}

/** Assemble the read-only scan request from the step-2 draft. */
function buildScanRequest(
  draft: ConnectDraft,
  method: ConnectionMethod,
  secret: string | undefined,
  fingerprint: string | undefined,
): DshScanRequest {
  const request: DshScanRequest = {}
  if (method === 'wsl') {
    request.kind = 'wsl'
    request.wslDistro = draft.wslDistro.trim()
    const wslUser = draft.wslUser.trim()
    if (wslUser !== '') request.wslUser = wslUser
  } else {
    const host = draft.host.trim()
    const port = Number(draft.port.trim())
    const username = draft.username.trim()
    request.kind = 'ssh'
    request.host = host
    request.port = port
    request.username = username
    request.authKind = draft.authKind
    if (secret !== undefined) request.secret = secret
    if (draft.authKind === 'privateKey') request.privateKeyPath = draft.privateKeyPath.trim()
    if (draft.sshConfigAlias !== undefined && draft.sshConfigAlias !== '') request.sshConfigAlias = draft.sshConfigAlias
    const confirmed = fingerprint ?? trustedFingerprint(host, port, username)
    if (confirmed !== undefined) request.hostKeyFingerprint = confirmed
  }
  if (draft.profile.trim() !== '') request.profile = draft.profile.trim()
  if (draft.dshHome.trim() !== '') request.dshHome = draft.dshHome.trim()
  return request
}

/**
 * Pick the candidate to preselect after a scan: keep a still-present choice,
 * else the best usable one (`compatible && upToDate` first, then any
 * compatible — the host already sorts them), else nothing.
 * @param candidates - the scan's candidates.
 * @param current - the launcher currently selected in the draft.
 * @returns the path to select, or `''` when nothing is usable.
 */
function pickCandidate(candidates: readonly DshCandidate[], current: string): string {
  if (current !== '' && candidates.some(candidate => candidate.path === current)) return current
  const best = candidates.find(candidate => candidate.compatible && candidate.profile?.upToDate === true)
    ?? candidates.find(candidate => candidate.compatible)
  return best?.path ?? ''
}

/**
 * Run the read-only pre-connection scan (`/api/dsh-scan`).
 *
 * Nothing is pinned or recorded: a `host-key` stage only stores the fingerprint
 * so step 3 can show the same confirmation panel the connect flow uses, and the
 * next scan carries that fingerprint.
 * @param force - scan again even when a result is already cached.
 */
async function scanDsh(force = false): Promise<void> {
  if (state.dshScan.status === 'scanning') return
  if (state.dshScan.status === 'ready' && !force && state.dshScan.fingerprint === undefined) return
  const draft = state.config
  const method = state.method
  const invalid = validateDraft(draft, method)
  if (invalid !== undefined) {
    commit({ error: invalid })
    return
  }
  // A WSL distribution has no credentials at all (see `startConnect`).
  const resolved = method === 'wsl' ? { ok: true as const, secret: undefined } : resolveSecret(draft)
  if (!resolved.ok) {
    commit({ error: resolved.error })
    return
  }
  const request = buildScanRequest(draft, method, resolved.secret, state.dshScan.fingerprint)
  // Remember the fingerprint this scan was sent with: a `done` stage means the
  // host accepted it, so the connect that follows can skip a second identical
  // prompt. It stays in memory for this session only — a scan pins nothing.
  const sentFingerprint = state.dshScan.fingerprint
  const gen = generation
  commit(previous => ({ dshScan: { ...previous.dshScan, status: 'scanning', error: undefined } }))
  try {
    const result = await api.dshScan(request)
    if (gen !== generation) return
    if (result.stage === 'host-key') {
      commit({ dshScan: { status: 'idle', candidates: [], fingerprint: result.fingerprint } })
      return
    }
    commit(previous => ({
      dshScan: {
        status: 'ready',
        candidates: result.candidates,
        probe: result.probe,
        package: result.package,
      },
      config: {
        ...previous.config,
        reuseLauncherPath: pickCandidate(result.candidates, previous.config.reuseLauncherPath),
      },
      ...(sentFingerprint === undefined || method === 'wsl'
        ? {}
        : {
          trusted: {
            host: draft.host.trim(),
            port: Number(draft.port.trim()),
            username: draft.username.trim(),
            fingerprint: sentFingerprint,
          },
        }),
    }))
  } catch (error) {
    if (gen !== generation) return
    const wire = toWireError(error)
    commit({ dshScan: { status: 'unavailable', candidates: [], error: wire.message } })
  }
}

/**
 * Select one scanned dsh as the one to reuse.
 *
 * Pure local state: the path is not a `patchConfig` edit (that would clear the
 * held secret) and nothing is sent to the host until 连接.
 * @param path - the candidate's launcher path.
 */
function selectDshCandidate(path: string): void {
  commit(previous => ({ config: { ...previous.config, reuseLauncherPath: path } }))
}

/** Start (or retry) the connection attempt behind `/api/connect/start`. */
async function startConnect(): Promise<void> {
  const draft = state.config
  const method = state.method
  const wsl = method === 'wsl'
  const invalid = validateDraft(draft, method)
  if (invalid !== undefined) {
    commit({ view: 'wizard', step: 'config', error: invalid })
    return
  }
  // Step 3's choice is the only thing that decides how the server side is
  // provisioned; `download` never reaches here (its card is disabled).
  if (draft.connectionMode === '' || draft.connectionMode === 'download') {
    commit({ view: 'wizard', step: 'connect', error: validation('connect.mode.required') })
    return
  }
  if (draft.connectionMode === 'reuse' && draft.reuseLauncherPath.trim() === '') {
    commit({ view: 'wizard', step: 'connect', error: validation('connect.mode.reuse.required') })
    return
  }
  // A WSL target has no credentials at all: the transport is a local process.
  const resolved = wsl ? { ok: true as const, secret: undefined } : resolveSecret(draft)
  if (!resolved.ok) {
    commit({ view: 'wizard', step: 'config', error: resolved.error })
    return
  }

  let request: ConnectStartRequest
  let endpoint: string
  if (wsl) {
    const distro = draft.wslDistro.trim()
    const wslUser = draft.wslUser.trim()
    request = {
      kind: 'wsl',
      label: draft.label.trim(),
      wslDistro: distro,
      ...(wslUser === '' ? {} : { wslUser }),
    }
    endpoint = `${distro}${wslUser === '' ? '' : ` as ${wslUser}`}`
  } else {
    const host = draft.host.trim()
    const port = Number(draft.port.trim())
    const username = draft.username.trim()
    request = {
      label: draft.label.trim(),
      host,
      port,
      username,
      authKind: draft.authKind,
    }
    if (resolved.secret !== undefined) request.secret = resolved.secret
    if (draft.authKind === 'privateKey') request.privateKeyPath = draft.privateKeyPath.trim()
    if (draft.sshConfigAlias !== undefined && draft.sshConfigAlias !== '') request.sshConfigAlias = draft.sshConfigAlias
    const confirmed = trustedFingerprint(host, port, username)
    if (confirmed !== undefined) request.hostKeyFingerprint = confirmed
    endpoint = `${host}:${port} as ${username}`
  }
  const remote = buildRemote(draft)
  if (remote !== undefined) request.remote = remote
  if (draft.connectionMode === 'reuse') {
    request.packageSource = 'reuse'
    request.reuseLauncherPath = draft.reuseLauncherPath.trim()
  } else if (draft.connectionMode === 'upload') {
    request.packageSource = 'upload'
  }

  setPendingSecret(resolved.secret)
  const gen = generation
  commit(previous => ({
    pending: true,
    view: 'wizard',
    step: 'connect',
    error: undefined,
    notice: undefined,
    connect: { ...idleConnect(), phase: 'running', log: [{ time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), level: 'info' as const, text: `connecting to ${endpoint}` }] },
    config: { ...previous.config, secret: '' },
  }))

  try {
    const { ticket } = await api.connectStart(request)
    if (gen !== generation) {
      commit({ pending: false })
      return
    }
    commit(previous => ({ pending: false, connect: { ...previous.connect, phase: 'running', ticket } }))
    startStream(ticket, gen)
  } catch (error) {
    if (gen !== generation) return
    commit(previous => ({
      pending: false,
      connect: { ...previous.connect, phase: 'failed', error: toWireError(error) },
    }))
  }
}

function startStream(ticket: string, gen: number): void {
  stopStream()
  try {
    closeStream = openConnectStream(ticket, {
      onFrame: (frame) => {
        if (gen !== generation) return
        handleFrame(frame)
      },
      onTransportError: (message) => {
        if (gen !== generation) return
        stopStream()
        const phase = state.connect.phase
        if (phase === 'failed' || phase === 'succeeded') return
        commit(previous => ({
          connect: { ...previous.connect, phase: 'failed', error: { code: 'stream', message } },
        }))
      },
    })
  } catch (error) {
    commit(previous => ({
      connect: { ...previous.connect, phase: 'failed', error: toWireError(error) },
    }))
  }
}

function handleFrame(frame: ConnectFrame): void {
  switch (frame.type) {
    case 'step': {
      appendLog(frame.status === 'failed' ? 'error' : 'info', frame.message === undefined ? `${frame.step} ${frame.status}` : frame.message)
      commit(previous => ({
        connect: {
          ...previous.connect,
          steps: {
            ...previous.connect.steps,
            [frame.step]: {
              status: frame.status,
              ...(frame.message === undefined ? {} : { message: frame.message }),
              ...(frame.detail === undefined ? {} : { detail: frame.detail }),
            },
          },
        },
      }))
      return
    }
    case 'host-key': {
      appendLog('info', t('connect.log.hostKey', { fingerprint: frame.fingerprint }))
      commit(previous => ({
        connect: {
          ...previous.connect,
          phase: 'awaiting-hostkey',
          hostKey: {
            fingerprint: frame.fingerprint,
            ...(frame.algorithm === undefined ? {} : { algorithm: frame.algorithm }),
            answering: false,
            trusted: false,
          },
        },
      }))
      return
    }
    case 'done': {
      stopStream()
      setPendingSecret(undefined)
      const target = frame.target
      appendLog('ok', t('connect.log.done', { label: target.label }))
      const trusted = target.hostKeyFingerprint === ''
        ? state.trusted
        : { host: target.host, port: target.port, username: target.username, fingerprint: target.hostKeyFingerprint }
      commit(previous => ({
        // Landing spot after a successful connect: the saved-items list, with
        // this connection expanded so 添加工作区 is one click away (this is the
        // requirement's "don't jump into a directory page"). It is also why the
        // step rewinds to `method`: the next 新建连接 starts from step 1.
        view: 'list',
        step: 'method',
        notice: { kind: 'success', text: t('connect.succeeded.list') },
        connect: { ...idleConnect(), phase: 'succeeded', target },
        directory: emptyDirectory(),
        expanded: { ...previous.expanded, [targetNodeKey(target.id)]: true },
        trusted: trusted ?? previous.trusted,
      }))
      void refreshState()
      return
    }
    case 'error': {
      appendLog('error', `${frame.code}: ${frame.message}`)
      stopStream()
      commit(previous => ({
        connect: { ...previous.connect, phase: 'failed', hostKey: undefined, error: { code: frame.code, message: frame.message } },
      }))
    }
  }
}

/** Accept the shown host-key fingerprint (never automatic). */
async function confirmHostKey(): Promise<void> {
  const { ticket, hostKey } = state.connect
  if (ticket === undefined || hostKey === undefined || hostKey.answering || hostKey.trusted) return
  commit(previous => ({
    connect: { ...previous.connect, hostKey: { ...hostKey, answering: true } },
    error: undefined,
  }))
  try {
    await api.hostkeyConfirm(ticket, hostKey.fingerprint)
    const draft = state.config
    commit(previous => ({
      trusted: {
        host: draft.host.trim(),
        port: Number(draft.port.trim()),
        username: draft.username.trim(),
        fingerprint: hostKey.fingerprint,
      },
      connect: {
        ...previous.connect,
        phase: 'running',
        hostKey: { ...hostKey, answering: false, trusted: true },
      },
    }))
  } catch (error) {
    commit(previous => ({
      error: toWireError(error),
      connect: { ...previous.connect, hostKey: { ...hostKey, answering: false } },
    }))
  }
}

/**
 * Abandon a pending attempt and stay on step 3.
 *
 * Step 3 owns the whole attempt (method choice, progress, host-key), so
 * cancelling rewinds the attempt — not the step: the user is exactly where they
 * choose another mode or retry. The held secret stays (only leaving the wizard
 * drops it), so 重试 works without typing the password again.
 */
function cancelConnect(): void {
  stopStream()
  commit({
    step: 'connect',
    error: undefined,
    notice: undefined,
    connect: idleConnect(),
    directory: emptyDirectory(),
  })
}

/** Browse one remote directory of the connected (or saved) target. */
async function loadDirectory(targetId: string, path: string): Promise<void> {
  return await withConnecting(async () => {
    const gen = generation
    commit(previous => ({
      directory: { ...previous.directory, open: true, targetId, loading: true, error: undefined },
    }))
    try {
      const listing = await api.listDir(targetId, path)
      if (gen !== generation) return
      commit(previous => ({
        directory: {
          ...previous.directory,
          listing,
          loading: false,
          connecting: false,
          error: undefined,
          pathInput: listing.path,
          newDirName: '',
          title: previous.directory.titleTouched && previous.directory.title !== ''
            ? previous.directory.title
            : basename(listing.path),
        },
      }))
    } catch (error) {
      if (gen !== generation) return
      commit(previous => ({
        directory: { ...previous.directory, loading: false, connecting: false, error: toWireError(error) },
      }))
    }
  })
}

/**
 * Open the 添加工作区 dialog on its browse tab, connecting the target first if
 * its channel is down.
 *
 * `list-dir` runs through the host's cached browser client, which re-provisions
 * a cold target on its own — seconds to tens of seconds. The dialog therefore
 * has to show a 连接中 state while that call is in flight; the wizard used to
 * express this with an entire step, and without it the pane just sits empty.
 * @param target - the connection row's target.
 */
async function openBrowseDirectory(target: PublicTarget): Promise<void> {
  const gen = generation
  commit(previous => ({
    addWorkspace: {
      targetId: target.id,
      targetLabel: target.label,
      tab: 'browse',
      loading: previous.addWorkspace?.loading ?? false,
      items: previous.addWorkspace?.items ?? [],
    },
    error: undefined,
    directory: { ...emptyDirectory(), open: true, targetId: target.id },
  }))
  if (target.status !== 'ready') {
    commit(previous => ({ directory: { ...previous.directory, connecting: true } }))
    try {
      await api.connect(target.id)
      if (gen !== generation) return
      await refreshState()
      if (gen !== generation) return
    } catch (error) {
      if (gen !== generation) return
      commit(previous => ({
        directory: { ...previous.directory, connecting: false, error: toWireError(error) },
      }))
      return
    }
    commit(previous => ({ directory: { ...previous.directory, connecting: false } }))
  }
  await loadDirectory(target.id, '')
}

/** Switch the 添加工作区 dialog between its two tabs, loading what the tab needs. */
function setAddWorkspaceTab(tab: 'browse' | 'registry'): void {
  const dialog = state.addWorkspace
  if (dialog === undefined || dialog.tab === tab) return
  commit(previous => ({
    addWorkspace: previous.addWorkspace === undefined ? undefined : { ...previous.addWorkspace, tab },
  }))
  if (tab === 'registry') {
    void refreshAddWorkspace()
    return
  }
  const target = state.targets.find(candidate => candidate.id === dialog.targetId)
  if (target === undefined) return
  if (state.directory.targetId === target.id && state.directory.listing !== undefined) return
  void openBrowseDirectory(target)
}

function setNewDirName(name: string): void {
  commit(previous => ({ directory: { ...previous.directory, newDirName: name } }))
}

function setDirectoryTitle(title: string): void {
  commit(previous => ({ directory: { ...previous.directory, title, titleTouched: true } }))
}

function setPathInput(path: string): void {
  commit(previous => ({ directory: { ...previous.directory, pathInput: path } }))
}

/** Create a directory under the current one, then enter it. */
async function createDirectory(): Promise<void> {
  const { targetId, listing, newDirName, creating } = state.directory
  const name = newDirName.trim()
  if (targetId === undefined || listing === undefined || name === '' || creating) return
  const path = joinPath(listing.path, name)
  const gen = generation
  commit(previous => ({ directory: { ...previous.directory, creating: true, error: undefined } }))
  try {
    await api.mkdir(targetId, path)
    if (gen !== generation) return
    commit({
      directory: { ...state.directory, creating: false, newDirName: '' },
      notice: { kind: 'success', text: t('directory.newDir.created', { path }) },
    })
    await loadDirectory(targetId, path)
  } catch (error) {
    if (gen !== generation) return
    commit(previous => ({ directory: { ...previous.directory, creating: false, error: toWireError(error) } }))
  }
}

/** Open the browsed directory as a workspace; the dialog closes on success. */
async function openWorkspace(): Promise<void> {
  return await withConnecting(async () => {
  const { targetId, listing, title } = state.directory
  if (targetId === undefined || listing === undefined || state.pending) return
  const gen = generation
  commit({ pending: true, error: undefined })
  try {
    const trimmed = title.trim()
    const result = await api.openWorkspace(targetId, listing.path, trimmed === '' ? undefined : trimmed)
    if (gen !== generation) return
    commit(previous => ({
      pending: false,
      view: 'list',
      step: 'method',
      addWorkspace: undefined,
      directory: emptyDirectory(),
      connect: idleConnect(),
      notice: { kind: 'success', text: t('directory.opened', { title: result.workspace.title }) },
      // The new workspace row is only visible under an open connection node.
      expanded: { ...previous.expanded, [targetNodeKey(targetId)]: true },
    }))
    void revealSession(result.sessionId, targetId)
    void refreshState()
  } catch (error) {
    if (gen !== generation) return
    commit({ pending: false, error: toWireError(error) })
  }
  })
}

/**
 * Ask for a new title for one remote workspace.
 *
 * Only the plugin's own record changes (the host rewrites `title`), never the
 * remote directory: the directory is what every stored session's header points
 * at, and a network `mv` has no rollback (architecture A7).
 * @param workspace - the workspace row's record.
 */
function requestWorkspaceRename(workspace: RemoteWorkspace): void {
  commit({ renameWorkspace: { workspace, title: workspace.title } })
}

/** Close the 重命名工作区 dialog without acting. */
function settleWorkspaceRename(): void {
  commit({ renameWorkspace: undefined })
}

/**
 * Apply one workspace rename through the host and refresh the tree.
 *
 * Like the session rename, the dialog owns its own lifetime: this action keeps
 * `renameWorkspace` set so the form can show a failure inline, and the caller
 * closes it on success (`settleWorkspaceRename`).
 * @param title - the new title (the host normalizes it too).
 */
async function acceptWorkspaceRename(title: string): Promise<void> {
  const pending = state.renameWorkspace
  const trimmed = title.trim()
  if (pending === undefined || trimmed === '') return
  const gen = generation
  commit({ pending: true, error: undefined })
  try {
    await api.workspaceRename(pending.workspace.id, trimmed)
    if (gen !== generation) return
    commit({ pending: false, notice: { kind: 'success', text: t('tree.workspace.renamed', { title: trimmed }) } })
    await refreshState()
  } catch (error) {
    if (gen !== generation) return
    commit({ pending: false })
    throw error
  }
}

async function forgetTarget(target: PublicTarget): Promise<void> {
  if (state.pending) return
  const gen = generation
  commit({ pending: true, error: undefined })
  // Deleting the connection closes its channel and disposes its preset, which
  // takes every session of it with it — so the shell must stop showing one of
  // them *first* (see releaseShellSelection).
  releaseShellSelection(target.id)
  try {
    await api.forgetTarget(target.id)
    if (gen !== generation) return
    for (const [sessionId, owner] of revealedSessions) {
      if (owner === target.id) revealedSessions.delete(sessionId)
    }
    commit({ pending: false, notice: { kind: 'success', text: t('list.forgotTarget', { label: target.label }) } })
    await refreshState()
  } catch (error) {
    if (gen !== generation) return
    commit({ pending: false, error: toWireError(error) })
  }
}

async function forgetWorkspace(workspace: RemoteWorkspace): Promise<void> {
  if (state.pending) return
  const gen = generation
  commit({ pending: true, error: undefined })
  try {
    await api.forgetWorkspace(workspace.id)
    if (gen !== generation) return
    commit({ pending: false, notice: { kind: 'success', text: t('list.forgotWorkspace', { title: workspace.title }) } })
    await refreshState()
  } catch (error) {
    if (gen !== generation) return
    commit({ pending: false, error: toWireError(error) })
  }
}

async function stopTarget(target: PublicTarget): Promise<void> {
  if (state.pending) return
  const gen = generation
  commit({ pending: true, error: undefined })
  // Deselect BEFORE the host closes the channel: once the remote session is
  // gone its client record stops being live, and a shell conversation still
  // pointing at it throws during render — which unmounts the whole app
  // (the alpha52 white page). See releaseShellSelection for the full chain.
  releaseShellSelection(target.id)
  try {
    const { stopped } = await api.stopTarget(target.id)
    if (gen !== generation) return
    commit({
      pending: false,
      notice: stopped
        ? { kind: 'success', text: t('list.stopped', { label: target.label }) }
        : { kind: 'error', text: t('list.stopUnsupported', { label: target.label }) },
    })
    // A stopped host has no channel to read from: leave its directory view so
    // no operation dangles in the connecting state against a dead channel, and
    // fold its subtree away (工作区/会话收起).
    if (stopped) collapseTarget(target.id)
    if (stopped && state.directory.targetId === target.id) {
      commit({ directory: emptyDirectory(), addWorkspace: undefined })
    }
    await refreshState()
  } catch (error) {
    if (gen !== generation) return
    commit({ pending: false, error: toWireError(error) })
  }
}

/** Re-open a saved remote workspace (the host recreates its session). */
async function reopenWorkspace(workspace: RemoteWorkspace): Promise<void> {
  return await withConnecting(async () => {
  if (state.pending) return
  const gen = generation
  commit({ pending: true, error: undefined })
  try {
    const result = await api.openWorkspace(workspace.targetId, workspace.path, workspace.title)
    if (gen !== generation) return
    commit({
      pending: false,
      notice: { kind: 'success', text: t('directory.opened', { title: result.workspace.title }) },
    })
    void revealSession(result.sessionId, workspace.targetId)
    await refreshState()
    refreshSessionsFor(result.workspace)
  } catch (error) {
    if (gen !== generation) return
    commit({ pending: false, error: toWireError(error) })
  }
  })
}

/* ------------------------------------------------------- the remote tree */

/** Tree-node key for one connection node. */
export function targetNodeKey(targetId: string): string {
  return `target:${targetId}`
}

/** Tree-node key for one workspace node. */
export function workspaceNodeKey(workspaceId: string): string {
  return `workspace:${workspaceId}`
}

/** Drop one workspace's cached session list so the next expand reloads it. */
function invalidateSessions(workspaceId: string): void {
  commit(previous => {
    const sessions = { ...previous.sessions }
    delete sessions[workspaceId]
    return { sessions }
  })
}

/**
 * Reload one workspace's session list, but only while its node is open.
 *
 * Starting or continuing a session changes that list, so an open node must not
 * keep showing the pre-action contents; a collapsed node simply drops its cache
 * and loads again on the next expand.
 */
function refreshSessionsFor(workspace: RemoteWorkspace): void {
  invalidateSessions(workspace.id)
  if (state.expanded[workspaceNodeKey(workspace.id)] === true) void loadSessions(workspace, true)
}

/** Expand or collapse one tree node; expanding a workspace loads its sessions. */
function toggleNode(key: string): void {
  const expanded = { ...state.expanded, [key]: !(state.expanded[key] ?? false) }
  commit({ expanded })
  if (!expanded[key]) return
  const workspaceId = key.startsWith('workspace:') ? key.slice('workspace:'.length) : undefined
  if (workspaceId === undefined) return
  const workspace = state.workspaces.find(candidate => candidate.id === workspaceId)
  if (workspace !== undefined) void loadSessions(workspace)
}

/** Load (or reload) the remote session list of one saved workspace. */
async function loadSessions(workspace: RemoteWorkspace, force = false): Promise<void> {
  const cached = state.sessions[workspace.id]
  if (cached !== undefined && (cached.loading || (cached.loaded && !force))) return
  const gen = generation
  commit(previous => ({
    sessions: {
      ...previous.sessions,
      [workspace.id]: { loading: true, loaded: cached?.loaded ?? false, items: cached?.items ?? [] },
    },
  }))
  try {
    const value = await api.sessions(workspace.targetId, workspace.id)
    if (gen !== generation) return
    commit(previous => ({
      sessions: {
        ...previous.sessions,
        [workspace.id]: { loading: false, loaded: true, items: value.sessions },
      },
    }))
  } catch (error) {
    if (gen !== generation) return
    commit(previous => ({
      sessions: {
        ...previous.sessions,
        [workspace.id]: {
          loading: false,
          loaded: true,
          items: cached?.items ?? [],
          error: toWireError(error),
        },
      },
    }))
  }
}

/**
 * Open one stored remote session — what a click on a session row does.
 *
 * The host resumes it through the official agent-resume path, so the history
 * comes back from the remote log; the shell then adopts the live session like
 * any local one.
 */
async function openSession(workspace: RemoteWorkspace, session: RemoteSession): Promise<void> {
  return await withConnecting(async () => {
  if (state.pending) return
  const gen = generation
  commit({ pending: true, error: undefined })
  try {
    const result = await api.openSession(workspace.targetId, workspace.path, session.id, workspace.title)
    if (gen !== generation) return
    commit({
      pending: false,
      currentSessionId: result.sessionId,
      notice: {
        kind: 'success',
        text: t('tree.session.opened', { title: session.title ?? shortSessionId(session.id) }),
      },
    })
    void revealSession(result.sessionId, workspace.targetId)
    await refreshState()
    refreshSessionsFor(workspace)
  } catch (error) {
    if (gen !== generation) return
    // A failed click must say why: the inline banner below lives in the plugin
    // panel, which is not the surface the user is looking at (alpha55 defect A
    // read as "the row does nothing at all").
    const wire = toWireError(error)
    commit({
      pending: false,
      error: wire,
      notice: { kind: 'error', text: t('tree.session.openFailed', { message: wire.message }) },
    })
  }
  })
}

/** Short, human-scannable form of a session id. */
export function shortSessionId(id: string): string {
  const trimmed = id.startsWith('session-') ? id.slice('session-'.length) : id
  return trimmed.length <= 8 ? trimmed : trimmed.slice(0, 8)
}

/**
 * Open the 添加工作区 dialog for one connection.
 *
 * The default tab is 浏览目录 (the requirement: adding a workspace means picking
 * a remote directory), so opening the dialog is opening the browser — including
 * its connect-first step when the channel is down.
 * @param target - the connection row's target.
 */
async function openAddWorkspace(target: PublicTarget): Promise<void> {
  await openBrowseDirectory(target)
}

function closeAddWorkspace(): void {
  commit({ addWorkspace: undefined, directory: emptyDirectory() })
}

/** (Re)read the remote dsh's own workspace registry for the open picker. */
async function refreshAddWorkspace(): Promise<void> {
  const dialog = state.addWorkspace
  if (dialog === undefined) return
  const gen = generation
  commit(previous => ({
    addWorkspace: previous.addWorkspace === undefined
      ? undefined
      : { ...previous.addWorkspace, loading: true, error: undefined },
  }))
  try {
    const value = await api.remoteWorkspaces(dialog.targetId)
    if (gen !== generation) return
    commit(previous => ({
      addWorkspace: previous.addWorkspace === undefined
        ? undefined
        : { ...previous.addWorkspace, loading: false, items: value.workspaces },
    }))
  } catch (error) {
    if (gen !== generation) return
    commit(previous => ({
      addWorkspace: previous.addWorkspace === undefined
        ? undefined
        : { ...previous.addWorkspace, loading: false, error: toWireError(error) },
    }))
  }
}

/** Adopt one workspace the remote dsh has registered (reg.list → open). */
async function adoptRemoteWorkspace(entry: RemoteRegistryWorkspace): Promise<void> {
  const dialog = state.addWorkspace
  if (dialog === undefined || state.pending) return
  return await withConnecting(async () => {
    const gen = generation
    commit({ pending: true, error: undefined })
    try {
      const result = await api.openWorkspace(dialog.targetId, entry.path, entry.title)
      if (gen !== generation) return
      commit(previous => ({
        pending: false,
        addWorkspace: undefined,
        directory: emptyDirectory(),
        notice: { kind: 'success', text: t('directory.opened', { title: result.workspace.title }) },
        expanded: { ...previous.expanded, [targetNodeKey(dialog.targetId)]: true },
      }))
      void revealSession(result.sessionId, dialog.targetId)
      await refreshState()
    } catch (error) {
      if (gen !== generation) return
      commit({ pending: false, error: toWireError(error) })
    }
  })
}

/** Open one connected host's node, keeping its children visible. */
function expandTarget(targetId: string): void {
  commit(previous => ({ expanded: { ...previous.expanded, [targetNodeKey(targetId)]: true } }))
}

/**
 * Bring one connection up (or back up) without leaving the tree.
 *
 * This is the gate the product requires — a connection has a state, and only a
 * *connected* connection can have workspaces or sessions. It is deliberately
 * narrower than the 添加工作区 dialog's own connect-first step, which additionally
 * lists a directory afterwards.
 */
async function connectTarget(target: PublicTarget): Promise<void> {
  return await withConnecting(async () => {
    if (state.pending) return
    const gen = generation
    commit({ pending: true, error: undefined })
    try {
      const { target: connected } = await api.connect(target.id)
      if (gen !== generation) return
      commit({
        pending: false,
        notice: { kind: 'success', text: t('tree.conn.connectedNotice', { label: connected.label }) },
        // The channel is up: its node is worth showing.
        expanded: { ...state.expanded, [targetNodeKey(target.id)]: true },
      })
      await refreshState()
    } catch (error) {
      if (gen !== generation) return
      commit({ pending: false, error: toWireError(error) })
      // A failed attempt is a state worth reporting, and the host records it.
      await refreshState()
    }
  })
}

/**
 * Open a saved remote workspace: continue its last session when it has one,
 * otherwise start a fresh one.
 *
 * A recorded session can be unreadable (a log written by a pre-0.1.0 build, or
 * a session another device is writing right now). That is a recoverable state,
 * not a dead end: the workspace falls back to a new session and the reason is
 * reported instead of leaving the user with a stuck row.
 */
async function openWorkspaceRecord(workspace: RemoteWorkspace): Promise<void> {
  const sessionId = workspace.sessionId
  if (sessionId === undefined || sessionId === '') {
    await reopenWorkspace(workspace)
    return
  }
  return await withConnecting(async () => {
    if (state.pending) return
    const gen = generation
    commit({ pending: true, error: undefined })
    try {
      const result = await api.openSession(workspace.targetId, workspace.path, sessionId, workspace.title)
      if (gen !== generation) return
      commit({
        pending: false,
        currentSessionId: result.sessionId,
        notice: {
          kind: 'success',
          text: t('tree.session.opened', { title: workspace.title }),
        },
      })
      void revealSession(result.sessionId, workspace.targetId)
      await refreshState()
      refreshSessionsFor(workspace)
    } catch (error) {
      if (gen !== generation) return
      commit({
        pending: false,
        notice: {
          kind: 'error',
          text: t('tree.session.fallback', {
            message: toWireError(error).message,
          }),
        },
      })
      await reopenWorkspace(workspace)
    }
  })
}

/**
 * Fold a connection's whole subtree away.
 *
 * A connection that is down has nothing to show: its workspace rows and their
 * session rows were reachable only through the channel that just went away, so
 * they collapse with it. The flags are cleared rather than merely hidden, so the
 * tree's own state agrees with what is rendered.
 *
 * Connecting again is a separate event and does expand the node again
 * ({@link connectTarget}): a fresh channel is exactly when its workspaces are
 * worth showing. Only the *disconnect* folds the subtree away.
 * @param targetId - the connection whose subtree collapses.
 */
function collapseTarget(targetId: string): void {
  const collapsed: string[] = []
  if (state.expanded[targetNodeKey(targetId)] === true) collapsed.push(targetNodeKey(targetId))
  for (const workspace of state.workspaces.filter(candidate => candidate.targetId === targetId)) {
    const key = workspaceNodeKey(workspace.id)
    if (state.expanded[key] === true) collapsed.push(key)
  }
  if (collapsed.length === 0) return
  commit(previous => {
    const expanded = { ...previous.expanded }
    for (const key of collapsed) delete expanded[key]
    return { expanded }
  })
}

/** Table of the store's actions, as the components consume them. */
export const store = {
  closeOverlay,
  newConnection,
  openConnectionWizard,
  setStep,
  setMethod,
  patchConfig,
  dismissError,
  dismissNotice,
  notifySuccess,
  notifyError,
  loadAliases,
  loadWslDistros,
  chooseAlias,
  setConnectionMode,
  scanDsh,
  selectDshCandidate,
  startConnect,
  confirmHostKey,
  cancelConnect,
  loadDirectory,
  setNewDirName,
  setDirectoryTitle,
  setPathInput,
  createDirectory,
  openWorkspace,
  forgetTarget,
  forgetWorkspace,
  stopTarget,
  reopenWorkspace,
  openWorkspaceRecord,
  refreshState,
  isConnectBlocking: (): boolean => isConnectBlocking(state),
  // The remote tree (P4): connections → workspaces → stored sessions.
  toggleNode,
  loadSessions,
  openSession,
  setSessionFlag,
  renameSession,
  refreshSessions,
  revealSessionId,
  requestRename,
  settleRename,
  requestForgetTarget,
  requestForgetWorkspace,
  settleConfirm,
  acceptConfirm,
  openAddWorkspace,
  closeAddWorkspace,
  setAddWorkspaceTab,
  refreshAddWorkspace,
  adoptRemoteWorkspace,
  openBrowseDirectory,
  requestWorkspaceRename,
  settleWorkspaceRename,
  acceptWorkspaceRename,
  expandTarget,
  connectTarget,
} as const

/** The store's actions (the object above), for prop-free components. */
export type Store = typeof store

/**
 * Dispose every side effect the store owns: close the live SSE stream (its
 * ticket is one-shot, so a hot reload cannot resume it) and drop the
 * in-flight secret. The rendered snapshot stays, so a hot-reloaded overlay
 * shows the attempt as failed and offers a retry.
 */
export function dispose(): void {
  stopStream()
  setPendingSecret(undefined)
  const phase = state.connect.phase
  if (phase === 'running' || phase === 'awaiting-hostkey') {
    commit(previous => ({
      connect: {
        ...previous.connect,
        phase: 'failed',
        hostKey: undefined,
        error: { code: 'disposed', message: t('connect.stream.closed') },
      },
    }))
  }
}
