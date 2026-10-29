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
  api, openConnectStream, toWireError, RemoteApiError,
} from './api.ts'
import type {
  AuthKind, ConnectFrame, ConnectStartRequest, ConnectStep, DirEntry, DshCandidate,
  DshScanRequest, ListDirResult, PublicTarget, RemoteRuntimeInput,
  RemoteRuntimeProbe, RemoteSession, ServerPackageState, ServerWorkspace, SshAlias, WireError,
  WorkspaceRef, WslDistro,
} from './api.ts'
import type { ClientContext } from './context.ts'
import { draftFromAlias } from './alias-prefill.ts'
import { choiceFromScan, choiceReady, packageSourceOf, reusePathOf, type RuntimeChoice } from './runtime-choice.ts'
import { joinWorkspaces } from './workspace-join.ts'
import type { WorkspaceRow } from './workspace-join.ts'
import { methodAvailable } from '../targets/methods.ts'
import { remotePresetId } from '../preset/world.ts'
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
   * Step 3's runtime choice: a scanned dsh install to reuse, or a new runtime
   * that is uploaded / downloaded. `null` = nothing picked yet (连接 disabled).
   *
   * The wire carries exactly one `ConnectRequest.packageSource`;
   * `runtime-choice.ts` is the only mapping (architecture A3: no second,
   * parallel mode concept).
   */
  runtimeChoice: RuntimeChoice
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
  /** Remote `DSH_HOME` the scan ran against (absolute); shown above the runtime list. */
  dshHome?: string
  /** Profile names that already exist under that `DSH_HOME` (`dsh-remote-server` is ours). */
  profiles?: string[]
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

/**
 * What one connection row shows about its own connect attempt.
 *
 * The row is where 连接 is clicked, so it is where the attempt has to be
 * visible. The global `pending`/`error` pair alone only disabled toolbar
 * buttons and printed one line at the bottom of the section: while a slow SSH
 * attempt was still running the row looked inert, and a failed attempt left no
 * trace next to the button that failed.
 */
export interface ConnectFeedback {
  /** This target's connect attempt is in flight (the row spins). */
  connecting: boolean
  /** Why the last attempt failed; cleared when a new attempt starts. */
  error?: WireError
}

/** Remote sessions of one workspace, as the tree shows them. */
export interface SessionListState {
  loading: boolean
  loaded: boolean
  items: RemoteSession[]
  error?: WireError
}

/**
 * A destructive row verb waiting for the user's confirmation.
 *
 * `workspace-delete` is the server-authoritative delete; when the server refuses
 * because sessions remain (HTTP 409 `workspace-not-empty`) the host re-raises the
 * same dialog as `workspace-delete-force`, which retries with `force: true` and
 * spells out that the session logs stay on the remote.
 */
export interface ConfirmState {
  readonly kind: 'forget-connection' | 'workspace-delete' | 'workspace-delete-force'
  /** The dialog's **heading** — copy, not data (see `workspaceTitle`). */
  readonly title: string
  readonly message: string
  readonly confirmLabel: string
  readonly targetId: string
  /** Local ref id, when the verb acts on one workspace. */
  readonly workspaceId?: string
  /** Server workspace id — what `workspace-delete` addresses. */
  readonly remoteWorkspaceId?: string
  /**
   * The workspace's own title, carried as **data**.
   *
   * `title` above is the dialog heading ("该工作区还有会话，仍要移除？"); using it as a
   * name produced `已从远端清单移除工作区「该工作区还有会话，仍要移除？」` (alpha59).
   * Every sentence about the workspace itself takes this field instead.
   */
  readonly workspaceTitle?: string
  /** Sessions the server reported for that workspace (the 409 body carries it). */
  readonly sessionCount?: number
}

/**
 * The 添加工作区 dialog.
 *
 * One tab only (浏览目录): after P0 the tree renders every server workspace (the
 * host keeps a local ref for each), so a "server has it, this client has not
 * added it" list would always be empty. Adding one means browsing a directory.
 */
export interface AddWorkspaceState {
  targetId: string
  targetLabel: string
}

/** The 重命名工作区 dialog's pending request. */
export interface WorkspaceRenameState {
  readonly workspace: WorkspaceRow
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
  /** Local refs, straight from `/api/state`; never authored here. */
  workspaceRefs: WorkspaceRef[]
  /**
   * Per-target server lists, straight from `/api/state`.
   *
   * A missing key means "could not be read" (offline target / failed `reg.list`),
   * which the UI must not confuse with an empty list.
   */
  serverWorkspaces: Record<string, ServerWorkspace[]>
  /**
   * **Derived** rows: `serverWorkspaces` ⋈ `workspaceRefs` (see
   * `workspace-join.ts`). Recomputed by {@link commit} so no action can put the
   * tree out of step with its two sources.
   */
  workspaces: WorkspaceRow[]
  pluginVersion: string
  /** The remote launcher runtimes this client accepts, straight from `/api/state`. */
  verifiedRuntimes: string[]
  defaultProfile: string
  stateLoaded: boolean
  stateLoading: boolean
  /** A primary command is in flight (primary buttons disable). */
  pending: boolean
  /** Whether a submitted secret is still held for a retry (never the secret itself). */
  secretPending: boolean
  /** Tree nodes the user expanded, keyed `target:<id>` / `workspace:<id>`. */
  expanded: Record<string, boolean>
  /**
   * Connect progress and the last failure, keyed by target id.
   *
   * Kept beside `expanded` rather than folded into `targets`: the host's
   * `status` is the *channel's* truth and only changes after the attempt
   * settles, so it cannot represent "an attempt is running right now".
   */
  connectFeedback: Record<string, ConnectFeedback>
  /** Lazily loaded remote session lists, keyed by the plugin's workspace id. */
  sessions: Record<string, SessionListState>
  /** The 添加工作区 picker, when it is open. */
  addWorkspace?: AddWorkspaceState
  /** The session this device most recently opened (row selection state). */
  currentSessionId?: string
  /**
   * The **unsent draft** the shell currently shows, when it belongs to one of our
   * stubs: which workspace it belongs to and which session id it already has.
   *
   * A draft is a real, persisted session (the shell creates it on 新会话 and reuses
   * the same blank on the next click), but it holds no turn, so it is not a row.
   * This state is what renders the single temporary 「新会话」 row at the top of
   * that workspace — and only there: selecting any other conversation clears it.
   * Recomputed from the shell, never authored locally ({@link refreshDraftFromShell}).
   */
  currentDraft?: { workspaceId: string; sessionId: string }
  /** The rename dialog's target, when it is open. */
  renameTarget?: { workspace: WorkspaceRow; session: RemoteSession; title: string }
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
    runtimeChoice: null,
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
    workspaceRefs: [],
    serverWorkspaces: {},
    workspaces: [],
    pluginVersion: '',
    verifiedRuntimes: [],
    defaultProfile: '',
    stateLoaded: false,
    stateLoading: false,
    pending: false,
    secretPending: false,
    expanded: {},
    connectFeedback: {},
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
  const next: AppState = { ...state, ...changes }
  // The rows are a pure function of their two sources, so they are recomputed
  // here rather than remembered: no action can leave the tree showing a row the
  // join would not produce (e.g. a row of a connection that just went down).
  next.workspaces = joinWorkspaces({
    targets: next.targets,
    refs: next.workspaceRefs,
    serverWorkspaces: next.serverWorkspaces,
  })
  state = next
  for (const listener of listeners) listener()
}

/**
 * Replace one connection's feedback without touching the others.
 *
 * `undefined` drops the entry, so a connected target carries no leftover row
 * affordance at all.
 * @param all - the current per-target map.
 * @param targetId - the connection whose feedback changes.
 * @param next - the new feedback, or `undefined` to forget it.
 * @returns a new map (the previous one is never mutated).
 */
function withConnectFeedback(
  all: Record<string, ConnectFeedback>,
  targetId: string,
  next: ConnectFeedback | undefined,
): Record<string, ConnectFeedback> {
  const copy = { ...all }
  if (next === undefined) delete copy[targetId]
  else copy[targetId] = next
  return copy
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

/** Current store snapshot for non-React consumers (slot registration). */
export function appStateSnapshot(): AppState {
  return state
}

/** Subscribe to store changes outside React; returns the unsubscribe. */
export function subscribeAppState(listener: () => void): () => void {
  return subscribe(listener)
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

/**
 * Capture the client context for {@link revealSession} and the draft path.
 *
 * The shell's session-list subscription is installed here as well: a session the
 * *shell* creates (the first message of a draft) has to reach the plugin's tree,
 * and that list is the only place it announces itself. The shell services may not
 * be mounted yet when this runs, in which case {@link startShellSessionWatch}
 * declines and the next draft request tries again (it is idempotent).
 * @param ctx - the client context.
 */
export function bindClientContext(ctx: ClientContext): void {
  clientContext = ctx
  startShellSessionWatch()
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
  /**
   * Enter the shell's **new-conversation draft** bound to one workspace — the
   * official 新会话 (workspace row `onCreate` → `startSession(workspaceId)`,
   * sidebar `new session` → `startSession(workspaceId, { clearPreviousDraft })`).
   *
   * Naming trap, measured in the shipped bundle (`UiWorkspaceService.startSession`):
   * despite the name it *creates* the shell session as soon as it is called —
   * `sessions.create({ workspaceId })` through `openWorkspaceSession` — and simply
   * shows the draft page for it. What it does **not** do is send a turn, and when
   * `options.agentPreset` is passed it first looks for an existing **blank**
   * session with this workspace's `cwd` and reuses it (`createInWorkspace`), so
   * repeated clicks do not pile up empty conversations.
   *
   * `options.agentPreset` is mandatory here: without it the shell composes the
   * shipped (local) preset while the routing persistence still writes to the
   * remote — the α54 "defect B" silent-local-execution shape.
   */
  startSession?(workspaceId: string, options?: { agentPreset?: string; clearPreviousDraft?: boolean }): void
  /** Releases the selected conversation (ui-workspace `clearMain`). */
  clearMain?(): void
  /**
   * Persisted selection snapshot: `dsh.sessions.current`.
   *
   * `replaceMain` writes it on every navigation (open a stored session, start a
   * draft, `restoreSelection` at boot) and `clearMain` empties it, so subscribing
   * here is the shell's own answer to "which conversation is on screen" — the
   * signal the temporary 新会话 row appears and disappears on.
   */
  selection?: {
    getSnapshot?(): { sessionId?: unknown }
    subscribe?(listener: () => void): () => void
  }
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
    console.error('[dsh-remote-window] clearing the shell selection failed', error)
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
  // The temporary 新会话 row belongs to the same selection: clearing it above is
  // the moment the draft stops being on screen.
  refreshDraftFromShell()
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
  for (const ref of state.workspaceRefs) {
    if (ref.targetId !== targetId) continue
    if (ref.sessionId === sessionId) return true
    if (state.sessions[ref.id]?.items.some(item => item.id === sessionId) === true) return true
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
    console.error('[dsh-remote-window] revealSession failed', error)
    notifyError(t('tree.session.revealFailed', { message: error instanceof Error ? error.message : String(error) }))
  }
}

/** How long the shell's client catalog may take to learn a just-resumed session. */
const REVEAL_WAIT_MS = 4_000

/** Poll interval while waiting for that catalog row. */
const REVEAL_POLL_MS = 250

/**
 * One Session summary in the shell's client list, as far as this file reads it.
 *
 * `cwd` is the join key for "did a shell-created session land in one of our
 * stubs?" — the shell anchors a draft at the official workspace's `path`, which
 * for a prepared remote workspace *is* the local stub. `blank` mirrors the
 * shell's own draft notion (no turn yet); the plugin also has the portable
 * artifact signal (`sizeBytes`) for the tree, see `tree.tsx::isStoredSession`.
 */
interface ShellSessionSummary {
  cwd?: unknown
  blank?: unknown
}

/** The shell's client `sessions` service, as this file reads it. */
interface ShellSessionsService {
  list?: {
    getSnapshot?(): { byId?: Record<string, ShellSessionSummary> }
    /** Snapshot-store subscription: fires on every session list change. */
    subscribe?(listener: () => void): () => void
  }
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

/* ------------------------------------------- the official new-conversation draft */

/** The shell's Workspace Controller, as this file reads it (`ctx.get('workspaces')`). */
interface ShellWorkspacesService {
  /**
   * The controller's snapshot store. `items[].workspaceId` is the id
   * `uiWorkspace.startSession` resolves, so membership here is exactly the
   * precondition that call silently requires.
   */
  list?: {
    getSnapshot?(): { items?: Array<{ workspaceId?: unknown }> }
    subscribe?(listener: () => void): () => void
  }
  /** Authoritative re-pull, when the shipped controller exposes one. */
  refresh?(): Promise<unknown> | unknown
}

function shellWorkspaces(): ShellWorkspacesService | undefined {
  try {
    return clientContext?.get('workspaces') as ShellWorkspacesService | undefined
  } catch {
    return undefined
  }
}

/** How long the shell's workspace list may take to learn a just-registered row. */
const DRAFT_WORKSPACE_WAIT_MS = 2_500

/** Poll interval while waiting for that row. */
const DRAFT_WORKSPACE_POLL_MS = 150

/** Delay before re-reading the session list once a draft was requested. */
const DRAFT_SESSION_REFRESH_MS = 900

/**
 * Wait (bounded) until the shell's own workspace list carries this id.
 *
 * `uiWorkspace.startSession(workspaceId)` resolves its workspace with
 * `workspaces.list.getSnapshot().items.find(item => item.workspaceId === id)` and
 * throws `unknown workspace` when it is absent — an *async* rejection the service
 * then swallows into `console.warn('new session failed:')`, i.e. a click that
 * visibly does nothing.
 *
 * The row does reach this list: the host's workspace controller follows
 * `domain/changed` for `table: "workspaces"` and publishes an `upsert` increment
 * (measured in `@deepseek-ai/dsh-api-workspace-controller`, host side), which the
 * client model merges into `items`. That is an asynchronous hop, so the wait is
 * what turns "usually works" into a deterministic draft — and a row that never
 * arrives (swept by 刷新 just before the click) is reported instead of becoming a
 * dead click.
 * @param workspaceId - the official shell workspace id.
 * @returns true when the row is visible, false when it never showed up, and
 *   `undefined` when the shell exposes no readable list (no answer available —
 *   the caller then proceeds best-effort instead of failing a click it cannot
 *   judge).
 */
async function waitForShellWorkspace(workspaceId: string): Promise<boolean | undefined> {
  const workspaces = shellWorkspaces()
  const list = workspaces?.list
  if (workspaces === undefined || list === undefined || typeof list.getSnapshot !== 'function') return undefined
  const known = (): boolean => {
    try {
      const items = list.getSnapshot?.()?.items
      if (items === undefined) return false
      return items.some(item => item?.workspaceId === workspaceId)
    } catch {
      return false
    }
  }
  if (known()) return true
  // A controller that ever exposes a re-pull gets asked once before polling; today
  // the increment above is the only feed, so the guard simply never fires.
  try {
    if (typeof workspaces.refresh === 'function') void Promise.resolve(workspaces.refresh()).catch(() => {})
  } catch {
    // Polling below is enough.
  }
  const deadline = Date.now() + DRAFT_WORKSPACE_WAIT_MS
  while (!known() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, DRAFT_WORKSPACE_POLL_MS))
  }
  return known()
}

/**
 * One shell session summary reduced to the two facts this file compares.
 *
 * A change here is the only signal that a conversation created by the *shell*
 * landed in one of our stubs: the plugin's own opens refresh explicitly, and the
 * host pushes no remote session list (task-2 audit §2.3).
 */
interface ShellSessionFacts {
  /** Session cwd; the shell anchors a draft at its workspace's `path` (= our stub). */
  cwd: string
  /** The shell's own draft flag: no turn yet. */
  blank: boolean
}

/** The shell summaries seen so far, so a change is a delta and not a rescan. */
let knownShellSessions = new Map<string, ShellSessionFacts>()

/** Workspace row ids whose remote lists are due for a reload. */
const pendingDraftRefreshes = new Set<string>()

/** One timer for the whole batch (the shell can emit several frames in a row). */
let draftRefreshTimer: ReturnType<typeof setTimeout> | undefined

/** Unsubscribe from the shell's session list, once bound. */
let stopShellSessionWatch: (() => void) | undefined

/**
 * Re-read the given workspaces' remote session lists, coalesced.
 *
 * The shell writes the session on send, so the row is worth showing as soon as it
 * exists; the host has no push for the remote list, which is why this is a pull.
 * The workspace node is opened as part of the same commit: a reload behind a
 * collapsed node would only invalidate the cache, and the user's new conversation
 * would still be invisible until they expanded it by hand.
 * @param workspaceIds - plugin row ids (`wr-…`) that gained a session.
 */
function scheduleDraftRefresh(workspaceIds: readonly string[]): void {
  for (const id of workspaceIds) pendingDraftRefreshes.add(id)
  if (draftRefreshTimer !== undefined) return
  draftRefreshTimer = setTimeout(() => {
    draftRefreshTimer = undefined
    const ids = [...pendingDraftRefreshes]
    pendingDraftRefreshes.clear()
    const expanded = { ...state.expanded }
    for (const id of ids) expanded[workspaceNodeKey(id)] = true
    commit({ expanded })
    for (const id of ids) refreshSessionsById(id)
    void refreshState()
  }, DRAFT_SESSION_REFRESH_MS)
}

/** Path comparison for a stub cwd: the trailing separator is the only real difference. */
function sameStubPath(left: string, right: string): boolean {
  const trim = (value: string): string => (value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value)
  return trim(left) === trim(right)
}

/**
 * Map the shell's session summaries onto our workspace rows by stub cwd.
 *
 * The shell anchors a draft session at the official workspace's `path`, which for
 * a prepared remote workspace *is* the local stub (that is what makes the routing
 * persistence treat `create(header.cwd)` as remote — the realm rewrites it to the
 * real directory). So a `cwd` that equals a row's `stubPath` identifies the row
 * without guessing from titles.
 * @param cwd - the shell summary's `cwd`.
 * @returns every plugin row id whose stub is that path.
 */
function workspaceIdsForStub(cwd: string): string[] {
  const ids: string[] = []
  for (const ref of state.workspaceRefs) {
    if (ref.stubPath === undefined || ref.stubPath === '') continue
    if (sameStubPath(ref.stubPath, cwd)) ids.push(ref.id)
  }
  return ids
}

/** Reduce one shell summary to the facts this file compares. */
function shellSessionFacts(summary: ShellSessionSummary): ShellSessionFacts {
  return {
    cwd: typeof summary.cwd === 'string' ? summary.cwd : '',
    blank: summary.blank === true,
  }
}

/**
 * Which of our workspaces one shell session belongs to, if any.
 *
 * @param sessionId - a shell catalog session id.
 * @returns the id of the (first) plugin workspace whose stub is that session's
 *   `cwd`, or undefined when the session is not one of ours at all.
 */
function workspaceIdForSession(sessionId: string): string | undefined {
  const summary = shellSessions()?.list?.getSnapshot?.()?.byId?.[sessionId]
  if (summary === undefined) return undefined
  const facts = shellSessionFacts(summary)
  if (facts.cwd === '') return undefined
  return workspaceIdsForStub(facts.cwd)[0]
}

/**
 * The draft the shell currently shows, computed from the shell itself.
 *
 * A session is **our draft row** exactly when all three hold:
 *
 *  1. it is the shell's selected conversation (`dsh.sessions.current`), which is
 *     what `replaceMain` writes on every navigation and `clearMain` empties;
 *  2. the shell still reports it `blank` — no turn yet. `sessions` folds this from
 *     the log (the manager's blank state flips on the first prompt), so sending
 *     the first message retires the row by itself; and
 *  3. its `cwd` is one of our stubs — a local draft (a shipped workspace's own new
 *     conversation) must never grow a row in this plugin's tree.
 *
 * Everything else — a stored remote session, a local conversation, nothing
 * selected — yields no draft, which is what makes the temporary row disappear
 * when the user switches away.
 * @returns the draft identity, or undefined when the selection is not our draft.
 */
function currentDraftFromShell(): { workspaceId: string; sessionId: string } | undefined {
  const sessionId = shellSelectedSessionId()
  if (sessionId === undefined) return undefined
  const summary = shellSessions()?.list?.getSnapshot?.()?.byId?.[sessionId]
  if (summary === undefined) return undefined
  if (shellSessionFacts(summary).blank !== true) return undefined
  const workspaceId = workspaceIdForSession(sessionId)
  return workspaceId === undefined ? undefined : { workspaceId, sessionId }
}

/**
 * Recompute {@link AppState.currentDraft} from the shell and store it.
 *
 * Called after every event that can move the shell's selection or a session's
 * blank state: the session-list subscription, the selection subscription, a draft
 * request, opening a stored session, and a disconnect. Idempotent: a no-op when
 * the answer did not change, so a chatty shell cannot churn the tree.
 */
function refreshDraftFromShell(): void {
  const next = currentDraftFromShell()
  const previous = state.currentDraft
  const same = previous === undefined
    ? next === undefined
    : next !== undefined && previous.workspaceId === next.workspaceId && previous.sessionId === next.sessionId
  if (!same) commit({ currentDraft: next })
  if (next === undefined) return
  // The temporary row lives inside its workspace node, so an open draft whose node
  // is collapsed would be invisible: open it. This is also what makes the row
  // show up after a reload that restored a draft.
  const key = workspaceNodeKey(next.workspaceId)
  if (state.expanded[key] === true) return
  commit({ expanded: { ...state.expanded, [key]: true } })
}

/** Unsubscribe from the shell's selection store, once bound. */
let stopShellSelectionWatch: (() => void) | undefined

/**
 * Subscribe to the shell's session list and selection store.
 *
 * Two subscriptions, because they answer different questions:
 *
 *  - the **session list** says a draft appeared or stopped being blank (a shell
 *    `sessions.create`, the first message of a draft) — the row's content events;
 *  - the **selection** says which conversation is on screen, which changes without
 *    any session row changing (switching between two known conversations is
 *    exactly when the temporary 新会话 row must vanish).
 *
 * Idempotent and never throwing; each half installs independently, because the
 * shell services may not be reachable yet when the plugin activates (callers retry
 * through `bindClientContext` and every draft request).
 */
function startShellSessionWatch(): void {
  const list = shellSessions()?.list
  if (
    stopShellSessionWatch === undefined
    && list !== undefined
    && typeof list.subscribe === 'function'
    && typeof list.getSnapshot === 'function'
  ) {
    const read = (): Record<string, ShellSessionSummary> => {
      try {
        return list.getSnapshot?.()?.byId ?? {}
      } catch {
        return {}
      }
    }
    // Baseline: everything already known is not a change.
    knownShellSessions = factsOf(read())
    try {
      stopShellSessionWatch = list.subscribe(() => { onShellSessionsChanged(read()) })
    } catch (error) {
      stopShellSessionWatch = undefined
      console.error('[dsh-remote-window] subscribing to the shell session list failed', error)
    }
  }
  const selection = shellWorkspace()?.selection
  if (
    stopShellSelectionWatch === undefined
    && selection !== undefined
    && typeof selection.subscribe === 'function'
  ) {
    try {
      stopShellSelectionWatch = selection.subscribe(() => { refreshDraftFromShell() })
    } catch (error) {
      stopShellSelectionWatch = undefined
      console.error('[dsh-remote-window] subscribing to the shell selection failed', error)
    }
  }
  if (stopShellSessionWatch === undefined && stopShellSelectionWatch === undefined) return
  // A page reload (or a hot-reloaded plugin) starts with no draft; the shell may
  // still be showing one, so take the current answer once.
  refreshDraftFromShell()
}

/** @param byId - the shell's current summaries. @returns their reduced facts. */
function factsOf(byId: Record<string, ShellSessionSummary>): Map<string, ShellSessionFacts> {
  const facts = new Map<string, ShellSessionFacts>()
  for (const [id, summary] of Object.entries(byId)) {
    if (summary === undefined) continue
    facts.set(id, shellSessionFacts(summary))
  }
  return facts
}

/**
 * Turn one session-list snapshot into a delta and schedule the matching rows.
 *
 * Two deltas matter, and they are different moments on the draft path:
 *
 *  - a **new id** anchored at one of our stubs — the shell just created the draft
 *    session (`startSession` → `sessions.create`). The remote store may list it
 *    already, but with no turn it is a draft, not a row
 *    (`tree.tsx::isStoredSession`).
 *  - a known id whose `blank` flag **cleared** — the first message went out, so it
 *    is a conversation now and its row must appear. Watching only for new ids
 *    missed exactly this, which is why a sent draft stayed invisible until a
 *    manual refresh.
 *
 * Either way the draft answer is recomputed first: the blank transition is also
 * what retires the temporary 新会话 row.
 * @param byId - the shell's current summaries.
 */
function onShellSessionsChanged(byId: Record<string, ShellSessionSummary>): void {
  const next = factsOf(byId)
  const touched = new Set<string>()
  let selectedArrived = false
  const selected = shellSelectedSessionId()
  for (const [id, facts] of next) {
    if (facts.cwd === '') continue
    const previous = knownShellSessions.get(id)
    const arrived = previous === undefined
    const stored = previous !== undefined && previous.blank && !facts.blank
    if (!arrived && !stored) continue
    const owners = workspaceIdsForStub(facts.cwd)
    if (owners.length === 0) continue
    for (const owner of owners) touched.add(owner)
    if (id === selected) selectedArrived = true
  }
  knownShellSessions = next
  // The draft row's lifetime follows the shell's blank flag, so recompute it on
  // every session-list change, not only on the deltas above (a reused blank that
  // is already known still has to read as the open draft).
  refreshDraftFromShell()
  if (touched.size === 0) return
  // The shell already switched the main column to the draft; keep our row
  // highlight in step so the tree and the conversation agree again. Only a
  // session of *ours* may be adopted — a local conversation stays untouched.
  if (selectedArrived && selected !== undefined && state.currentSessionId !== selected) {
    commit({ currentSessionId: selected })
  }
  scheduleDraftRefresh([...touched])
}

/**
 * Materialize one remote directory as a workspace and open the official
 * new-conversation draft for it — **without creating a remote session**.
 *
 * This is the client half of the official 新会话 semantics and replaces the old
 * `POST /api/open-workspace` call, which resumed/created a session immediately
 * (the source of the empty conversations):
 *
 *  1. `prepare-workspace` (idempotent) guarantees the row, its stub *and* the
 *     official shell workspace row exist. Nothing is created on the remote.
 *  2. The shell's list must carry that row, or `startSession` fails invisibly.
 *     A swept row (启动 sweep / 刷新) is rebuilt by simply preparing again, which
 *     is why this is called before *every* draft.
 *  3. `startSession(officialWorkspaceId, { agentPreset: remotePresetId(targetId) })`
 *     → the shell creates the session (reusing an existing blank one) and renders
 *     the welcome page + composer + workspace chip. The preset is what keeps the
 *     execution world remote: omitting it composes the local one and silently
 *     writes on this machine (defect B).
 * @param targetId - the connected host.
 * @param path - absolute **remote** directory.
 * @param title - display title for a workspace created here; undefined keeps the
 *   server's default (last path segment).
 */
async function enterDraft(targetId: string, path: string, title: string | undefined): Promise<void> {
  const workspace = shellWorkspace()
  if (workspace === undefined || typeof workspace.startSession !== 'function') {
    // A shell without ui-workspace cannot render a draft at all. Say so instead of
    // falling back to the session-creating route: that fallback is the defect.
    throw new Error(t('tree.draft.shellUnavailable'))
  }
  startShellSessionWatch()
  let prepared = await api.prepareWorkspace(targetId, path, title)
  // The prepared row must be visible in our own tree too (it is a real workspace
  // from now on). `/api/state` joins the ref with the server list the prepare
  // just registered.
  await refreshState()
  let visible = await waitForShellWorkspace(prepared.officialWorkspaceId)
  if (visible === false) {
    // The hook was swept between registrations (`cleanup-shell-workspaces` deletes
    // every row under `~/.dsh/remote-windows/**`); preparing again rebuilds it.
    prepared = await api.prepareWorkspace(targetId, path, title)
    await refreshState()
    visible = await waitForShellWorkspace(prepared.officialWorkspaceId)
  }
  if (visible === false) {
    throw new Error(t('tree.draft.workspaceUnavailable'))
  }
  workspace.startSession(prepared.officialWorkspaceId, { agentPreset: remotePresetId(targetId) })
  // Safety net for the arrival watcher: the shell creates the session inside an
  // async chain whose failures it swallows, so a pull shortly after the click is
  // what makes the new row appear even if the list subscription is unavailable.
  scheduleDraftRefresh([prepared.workspaceId])
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
async function setSessionFlag(workspace: WorkspaceRow, sessionId: string, flag: 'pinned' | 'archived', on: boolean): Promise<void> {
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
async function refreshSessions(workspace: WorkspaceRow): Promise<void> {
  invalidateSessions(workspace.id)
  await loadSessions(workspace, true)
}

/**
 * Rename one remote session through the plugin's own host hop.
 * @param workspace - the workspace the session belongs to.
 * @param sessionId - the stored remote session id.
 * @param title - the new title.
 */
async function renameSession(workspace: WorkspaceRow, sessionId: string, title: string): Promise<void> {
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
      message: t('tree.forget.confirm.message', { label: target.label, count: state.workspaceRefs.filter(ref => ref.targetId === target.id).length }),
      confirmLabel: t('list.forget'),
      targetId: target.id,
    },
  })
}

/**
 * Ask before deleting a remote workspace.
 *
 * After P0 the list lives on the **server**, so this deletes the list entry
 * (`reg.delete`); the remote session logs are never touched, and the copy says
 * so — "删除工作区" reads like "delete the data" to a user (architecture A35).
 * When sessions remain the server answers 409 and this dialog comes back once
 * more as the explicit `force` confirmation ({@link acceptConfirm}).
 * @param workspace - the joined row.
 */
function requestDeleteWorkspace(workspace: WorkspaceRow): void {
  commit({
    confirm: {
      kind: 'workspace-delete',
      title: t('tree.forget.workspace.title'),
      message: t('tree.forget.workspace.message', { title: workspace.title, path: workspace.path }),
      confirmLabel: t('tree.workspace.forget'),
      targetId: workspace.targetId,
      workspaceId: workspace.id,
      remoteWorkspaceId: workspace.remoteWorkspaceId,
      workspaceTitle: workspace.title,
      ...(workspace.sessionCount === undefined ? {} : { sessionCount: workspace.sessionCount }),
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
  if (pending.remoteWorkspaceId === undefined) return
  await deleteWorkspace(
    pending.targetId,
    pending.remoteWorkspaceId,
    pending.kind === 'workspace-delete-force',
    // The workspace's OWN title — never `pending.title`, which is the dialog
    // heading (alpha59: the toast named the workspace
    // 「该工作区还有会话，仍要移除？」). Fall back to the joined row, then to the ids.
    pending.workspaceTitle ?? workspaceTitleOf(pending.targetId, pending.remoteWorkspaceId) ?? pending.workspaceId ?? pending.remoteWorkspaceId,
    pending.workspaceId,
    pending.sessionCount,
  )
}

/**
 * The title of one workspace from the current row data.
 * @param targetId - the connection owning it.
 * @param remoteWorkspaceId - server workspace id.
 * @returns the joined row's title, or undefined when the row is gone.
 */
function workspaceTitleOf(targetId: string, remoteWorkspaceId: string): string | undefined {
  return state.workspaces.find(
    row => row.targetId === targetId && row.remoteWorkspaceId === remoteWorkspaceId,
  )?.title
}

/** The session count the 409 body carries (`workspace-not-empty 5 …`), if any. */
function sessionCountOf(message: string): number | undefined {
  const match = /(\d+)/.exec(message)
  if (match === null) return undefined
  const parsed = Number.parseInt(match[1] ?? '', 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Delete one workspace from the server's list, and its local ref.
 *
 * `force` is what the user's second confirmation turns on; without it a
 * workspace that still has sessions answers 409 `workspace-not-empty`, which this
 * function turns into that second confirmation instead of a dead error.
 * @param targetId - the connection owning the workspace.
 * @param remoteWorkspaceId - server workspace id.
 * @param force - delete even though sessions remain (logs stay on the remote).
 * @param title - display title for the messages.
 * @param workspaceId - local ref id, used to drop the cached session list.
 * @param knownCount - session count already known from the row, for the copy.
 */
async function deleteWorkspace(
  targetId: string,
  remoteWorkspaceId: string,
  force: boolean,
  workspaceTitle: string,
  workspaceId: string | undefined,
  knownCount: number | undefined,
): Promise<void> {
  if (state.pending) return
  const gen = generation
  commit({ pending: true, error: undefined })
  try {
    const result = await api.workspaceDelete(targetId, remoteWorkspaceId, force)
    if (gen !== generation) return
    if (workspaceId !== undefined) invalidateSessions(workspaceId)
    commit({
      pending: false,
      notice: {
        kind: 'success',
        text: force
          ? t('tree.workspace.deletedWithSessions', { title: workspaceTitle, count: result.sessionCount })
          : t('tree.workspace.deleted', { title: workspaceTitle }),
      },
    })
    await refreshState()
  } catch (error) {
    if (gen !== generation) return
    const wire = toWireError(error)
    // 409 workspace-not-empty: the server refused because sessions remain. That
    // is not a failure to report — it is the question "delete the entry anyway?"
    // and the copy has to say that the logs stay.
    if (!force && (error instanceof RemoteApiError && error.code === 'workspace-not-empty')) {
      const count = sessionCountOf(wire.message) ?? knownCount
      commit({
        pending: false,
        confirm: {
          kind: 'workspace-delete-force',
          title: t('tree.workspace.delete.force.title'),
          message: t('tree.workspace.delete.force.message', {
            title: workspaceTitle,
            count: count === undefined ? t('common.unknown') : count,
          }),
          confirmLabel: t('tree.workspace.delete.force.confirm'),
          targetId,
          remoteWorkspaceId,
          workspaceTitle,
          ...(count === undefined ? {} : { sessionCount: count }),
          ...(workspaceId === undefined ? {} : { workspaceId }),
        },
      })
      return
    }
    commit({
      pending: false,
      error: wire,
      notice: { kind: 'error', text: t('tree.workspace.deleteFailed', { message: wire.message }) },
    })
  }
}

/** Open the rename dialog for one remote session. */
function requestRename(workspace: WorkspaceRow, session: RemoteSession): void {
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
    const hasSaved = value.targets.length > 0 || value.workspaceRefs.length > 0
    commit({
      targets: value.targets,
      workspaceRefs: value.workspaceRefs,
      serverWorkspaces: value.serverWorkspaces,
      pluginVersion: value.pluginVersion,
      verifiedRuntimes: value.verifiedRuntimes ?? [],
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
    // Refs are what ties a shell draft to a workspace row (`stubPath`), so the
    // draft answer is only computable once this state landed — that is what
    // restores the temporary 新会话 row after a reload.
    refreshDraftFromShell()
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
            workspaceRefs: value.workspaceRefs,
            serverWorkspaces: value.serverWorkspaces,
            pluginVersion: value.pluginVersion,
            verifiedRuntimes: value.verifiedRuntimes ?? [],
            defaultProfile: value.defaultProfile,
            platform: value.platform ?? '',
            stateLoaded: true,
            stateLoading: false,
          })
          refreshDraftFromShell()
          return
        } catch {}
      }
    }
    commit({ stateLoading: false, stateLoaded: true, error: toWireError(error) })
    refreshDraftFromShell()
  }
}

/**
 * The 刷新 button: re-read `/api/state` and then sweep this plugin's leftovers.
 *
 * `/api/state` is what carries the authoritative server lists (the host re-runs
 * `reg.list` for the connected targets), so the list refresh comes first and the
 * sweep after it; there is no ordering hazard between them.
 */
async function refreshAll(): Promise<void> {
  await refreshState()
  await cleanupShellWorkspaces()
}

/**
 * Sweep this plugin's stub entries out of the **shared** shell workspace
 * registry (api-contract §4.2) and report what was removed.
 *
 * Failures are deliberately silent: this is housekeeping that rides along with a
 * refresh, so a failing sweep must not replace the refresh result with an error.
 * `kept` entries still have an active session and stay until it closes.
 */
async function cleanupShellWorkspaces(): Promise<void> {
  try {
    const result = await api.cleanupShellWorkspaces()
    if (result.removed.length === 0) return
    commit({ notice: { kind: 'success', text: t('tree.cleanup.removed', { count: result.removed.length }) } })
  } catch (error) {
    console.warn('[dsh-remote-window] cleanup-shell-workspaces failed', error)
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
    console.error('[dsh-remote-window] selectPanel failed', error)
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
      config: clearsScan ? { ...config, runtimeChoice: null } : config,
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
    const workspaceIds = state.workspaceRefs
      .map(ref => ref.officialWorkspaceId ?? '')
      .filter(id => id !== '')
    const sessionIds = new Set<string>()
    for (const ref of state.workspaceRefs) {
      if (ref.sessionId !== undefined && ref.sessionId !== '') sessionIds.add(ref.sessionId)
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

/** Choose one scanned dsh install to reuse (the runtime list's click action). */
function chooseRuntime(choice: RuntimeChoice): void {
  // NOT `patchConfig`: that drops the held secret, and picking another runtime
  // after the password was entered would then demand it again for no reason.
  commit(previous => ({ config: { ...previous.config, runtimeChoice: choice }, error: undefined }))
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
        dshHome: result.dshHome,
        profiles: [...result.profiles],
      },
      config: {
        ...previous.config,
        runtimeChoice: choiceFromScan(result.candidates, previous.config.runtimeChoice),
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
  commit(previous => ({ config: { ...previous.config, runtimeChoice: { kind: 'reuse', path } } }))
}

/**
 * Pick how a **new** runtime travels: upload this machine's package, or fetch
 * the release built for the remote architecture. Deploy choices are always
 * ready — the connect pipeline probes the host itself.
 * @param kind - `upload` or `download`.
 */
function chooseDeploy(kind: 'upload' | 'download'): void {
  commit(previous => ({ config: { ...previous.config, runtimeChoice: { kind } }, error: undefined }))
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
  // Step 3's runtime choice is the only thing that decides how the server side
  // is provisioned; it becomes exactly one `packageSource` value
  // (`runtime-choice.ts`). A reuse choice also needs its candidate to still be
  // usable after the last scan.
  if (!choiceReady(draft.runtimeChoice, state.dshScan.candidates)) {
    const key: LocaleKey = draft.runtimeChoice !== null && draft.runtimeChoice.kind === 'reuse'
      ? 'connect.runtime.reuse.required'
      : 'connect.runtime.required'
    commit({ view: 'wizard', step: 'connect', error: validation(key) })
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
  // One choice, one wire value. `reuse` also carries the launcher the user
  // picked; `upload`/`download` are fully described by the source itself.
  const packageSource = packageSourceOf(draft.runtimeChoice)
  if (packageSource !== undefined) {
    request.packageSource = packageSource
    const reusePath = reusePathOf(draft.runtimeChoice)
    if (reusePath !== undefined) request.reuseLauncherPath = reusePath.trim()
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
 * Open the 添加工作区 dialog (browse-only), connecting the target first if its
 * channel is down.
 *
 * `list-dir` runs through the host's cached browser client, which re-provisions
 * a cold target on its own — seconds to tens of seconds. The dialog therefore
 * has to show a 连接中 state while that call is in flight; the wizard used to
 * express this with an entire step, and without it the pane just sits empty.
 *
 * There is only one tab: the server list is what the tree shows (the host keeps
 * a ref for every server workspace), so a "已注册但未添加" list would always be
 * empty — browsing a directory is the only way to *add* one.
 * @param target - the connection row's target.
 */
async function openBrowseDirectory(target: PublicTarget): Promise<void> {
  const gen = generation
  commit({
    addWorkspace: { targetId: target.id, targetLabel: target.label },
    error: undefined,
    directory: { ...emptyDirectory(), open: true, targetId: target.id },
  })
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

/**
 * Enter the browsed directory's workspace as a **new conversation draft**.
 *
 * This is the same semantics as a click on a workspace row (or its 新会话 row):
 * the directory becomes a workspace, and the shell opens the official welcome
 * page bound to it. No session is created here — the shell creates one when the
 * first message is sent, which the plugin's routing turns into `persist.create`
 * on the target. The old behaviour (`POST /api/open-workspace`) seeded a full
 * turn, which is exactly why every abandoned click left a named empty
 * conversation behind.
 */
async function openWorkspace(): Promise<void> {
  return await withConnecting(async () => {
  const { targetId, listing, title } = state.directory
  if (targetId === undefined || listing === undefined || state.pending) return
  const gen = generation
  commit({ pending: true, error: undefined })
  try {
    const trimmed = title.trim()
    await enterDraft(targetId, listing.path, trimmed === '' ? undefined : trimmed)
    if (gen !== generation) return
    // Silent on purpose: the draft page that just opened *is* the result. The
    // dialog closing and the new workspace row appearing say the rest.
    refreshDraftFromShell()
    commit(previous => ({
      pending: false,
      view: 'list',
      step: 'method',
      addWorkspace: undefined,
      directory: emptyDirectory(),
      connect: idleConnect(),
      // The new workspace row is only visible under an open connection node.
      expanded: { ...previous.expanded, [targetNodeKey(targetId)]: true },
    }))
    // No reveal: the shell's `startSession` already switched the main column to
    // the draft page (calling `layout.selectPanel`/another navigation here would
    // abort that navigation and leave the session created but not shown).
  } catch (error) {
    if (gen !== generation) return
    const wire = toWireError(error)
    // The dialog's inline banner is not what the user is looking at: a failed
    // 打开 must be said out loud.
    commit({
      pending: false,
      error: wire,
      notice: { kind: 'error', text: t('directory.draftFailed', { message: wire.message }) },
    })
  }
  })
}

/**
 * Ask for a new title for one remote workspace.
 *
 * The **server** owns the title now (architecture A34): the host forwards this to
 * `reg.rename`, which keeps the id and the remote directory name — every stored
 * session header keeps pointing at the same path, and the pin/archive sets (keyed
 * by the server id) survive a rename.
 * @param workspace - the joined row.
 */
function requestWorkspaceRename(workspace: WorkspaceRow): void {
  commit({ renameWorkspace: { workspace, title: workspace.title } })
}

/** Close the 重命名工作区 dialog without acting. */
function settleWorkspaceRename(): void {
  commit({ renameWorkspace: undefined })
}

/**
 * Rename one workspace **on the server** and re-read the list.
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
    await api.workspaceRename(pending.workspace.targetId, pending.workspace.remoteWorkspaceId, trimmed)
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
  commit(previous => ({
    pending: true,
    error: undefined,
    // The row disappears, and its failure reason must not outlive it.
    connectFeedback: withConnectFeedback(previous.connectFeedback, target.id, undefined),
  }))
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
    commit({ notice: { kind: 'success', text: t('list.forgotTarget', { label: target.label }) } })
    await refreshState()
  } catch (error) {
    if (gen !== generation) return
    commit({ error: toWireError(error) })
  } finally {
    if (gen === generation) commit({ pending: false })
  }
}

async function stopTarget(target: PublicTarget): Promise<void> {
  if (state.pending) return
  const gen = generation
  commit(previous => ({
    pending: true,
    error: undefined,
    // A deliberate disconnect answers the last failure: the row goes back to
    // plain 连接 instead of keeping a reason that no longer applies.
    connectFeedback: withConnectFeedback(previous.connectFeedback, target.id, undefined),
  }))
  // Deselect BEFORE the host closes the channel: once the remote session is
  // gone its client record stops being live, and a shell conversation still
  // pointing at it throws during render — which unmounts the whole app
  // (the alpha52 white page). See releaseShellSelection for the full chain.
  releaseShellSelection(target.id)
  let stopped = false
  try {
    stopped = (await api.stopTarget(target.id)).stopped
  } catch (error) {
    if (gen === generation) commit({ error: toWireError(error) })
    return
  } finally {
    // Same rule as 连接: the flag this attempt set never outlives it, or the
    // row's 连接/断开 stops answering altogether.
    if (gen === generation) commit({ pending: false })
  }
  if (gen !== generation) return
  commit({
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
}

/**
 * Start (or re-enter) the new conversation of one saved remote workspace — the
 * shared target of the row's 新会话 action, the temporary draft row and a click on
 * the workspace row itself.
 *
 * It is the official draft: welcome page + composer + workspace chip, bound to the
 * prepared shell workspace, with the remote preset so the execution world stays on
 * the target. Nothing is sent to the remote until the first message, and a second
 * click reuses the same blank (`startSession` → `createInWorkspace`), which is why
 * re-clicking the temporary row is idempotent.
 *
 * The success path is deliberately **silent**: the draft page itself is the
 * feedback, and a toast on every 新会话 click is noise.
 * @param workspace - the joined row (its remote `path` is what `prepare-workspace`
 *   takes; `title` only affects a workspace created by this call).
 */
async function startDraftSession(workspace: WorkspaceRow): Promise<void> {
  return await withConnecting(async () => {
  if (state.pending) return
  const gen = generation
  commit({ pending: true, error: undefined })
  try {
    await enterDraft(workspace.targetId, workspace.path, workspace.title)
    if (gen !== generation) return
    // The shell has switched the main column by now; take the draft straight from
    // it so the temporary row exists without waiting for the catalog round trip
    // (the subscription corrects it either way).
    refreshDraftFromShell()
    commit({ pending: false })
  } catch (error) {
    if (gen !== generation) return
    const wire = toWireError(error)
    // The inline banner lives in the plugin panel, which is not what the user is
    // looking at when clicking a sidebar row: a silent failure reads as a dead
    // row (alpha55 defect A).
    commit({
      pending: false,
      error: wire,
      notice: { kind: 'error', text: t('tree.draft.failed', { message: wire.message }) },
    })
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
 * @param workspace - the joined row.
 */
function refreshSessionsFor(workspace: WorkspaceRow): void {
  refreshSessionsById(workspace.id)
}

/**
 * Same, addressed by the local ref id — the shape a freshly opened workspace
 * gives us before the rows have been re-joined from `/api/state`.
 * @param workspaceId - the local ref id.
 */
function refreshSessionsById(workspaceId: string): void {
  invalidateSessions(workspaceId)
  if (state.expanded[workspaceNodeKey(workspaceId)] !== true) return
  const row = state.workspaces.find(candidate => candidate.id === workspaceId)
  if (row !== undefined) void loadSessions(row, true)
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
async function loadSessions(workspace: WorkspaceRow, force = false): Promise<void> {
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
async function openSession(workspace: WorkspaceRow, session: RemoteSession): Promise<void> {
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
    // Opening a stored conversation is the other way the draft leaves the screen:
    // the shell's selection no longer points at a blank session, so the temporary
    // 新会话 row must go (the selection subscription also covers it; this keeps the
    // common path immediate).
    refreshDraftFromShell()
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
 * The dialog has one tab (浏览目录): adding a workspace means picking a remote
 * directory, and the dialog's own connect-first step handles a cold channel.
 * @param target - the connection row's target.
 */
async function openAddWorkspace(target: PublicTarget): Promise<void> {
  await openBrowseDirectory(target)
}

function closeAddWorkspace(): void {
  commit({ addWorkspace: undefined, directory: emptyDirectory() })
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
 *
 * Two invariants make the row honest, and both were missing before: the attempt
 * marks **its own target** as connecting (so the row can spin) and records why it
 * failed (so the row can explain itself), and neither flag can outlive the
 * attempt. A stranded `pending` was the reason 连接 became a dead button: the
 * row kept rendering, but every later click hit the guard below and returned
 * without sending anything, so nothing moved and nothing was reported.
 * @param target - the row's connection (only `id` and `label` are read).
 */
async function connectTarget(target: PublicTarget): Promise<void> {
  if (state.pending) return
  // A password target without a stored secret cannot ever connect. Say so on
  // the row instead of opening a socket (or rendering a raw ssh2 error).
  if (target.authKind === 'password' && !target.hasStoredSecret) {
    commit(previous => ({
      connectFeedback: withConnectFeedback(previous.connectFeedback, target.id, {
        connecting: false,
        error: { code: 'secret-missing', message: t('tree.conn.secretMissing', { label: target.label }) },
      }),
    }))
    return
  }
  const gen = generation
  commit(previous => ({
    pending: true,
    error: undefined,
    connectFeedback: withConnectFeedback(previous.connectFeedback, target.id, { connecting: true }),
  }))
  let connected: PublicTarget | undefined
  let failure: WireError | undefined
  try {
    connected = (await api.connect(target.id)).target
  } catch (error) {
    failure = toWireError(error)
  } finally {
    // Clear exactly what this attempt set. The overlay may also have moved on
    // (关闭 / 新建连接 bump the generation and reset `pending` themselves), in
    // which case `pending` belongs to whoever came next and is left alone.
    commit(previous => ({
      ...(gen === generation ? { pending: false } : {}),
      connectFeedback: withConnectFeedback(
        previous.connectFeedback,
        target.id,
        failure === undefined ? undefined : { connecting: false, error: failure },
      ),
    }))
  }
  if (gen !== generation) return
  if (connected === undefined) commit({ error: failure })
  else {
    commit(previous => ({
      notice: { kind: 'success', text: t('tree.conn.connectedNotice', { label: connected.label }) },
      // The channel is up: its node is worth showing.
      expanded: { ...previous.expanded, [targetNodeKey(target.id)]: true },
    }))
  }
  // The host records the attempt either way, so the tree and the rows behind it
  // are re-read once it settles.
  await withConnecting(refreshState)
}

/**
 * Open a saved remote workspace (click / double-click on its row).
 *
 * **A workspace row means "start a new conversation here"**, exactly like the
 * official shell's own workspace row: it enters the new-conversation draft rather
 * than resuming anything. Resuming is what a *session* row does
 * ({@link openSession}), and guessing from the record was never right:
 *
 *  - `record.sessionId` is the session the old `open-workspace` route created, and
 *    the draft path never writes it (the shell creates the session, and only the
 *    host's open/resume path knows the id), so it is permanently stale;
 *  - resuming it re-created a *seeded* remote session on every click (the empty
 *    conversations), and with the lazy path it could resurrect an unrelated old
 *    log instead of a new conversation.
 */
async function openWorkspaceRecord(workspace: WorkspaceRow): Promise<void> {
  await startDraftSession(workspace)
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
  for (const ref of state.workspaceRefs.filter(candidate => candidate.targetId === targetId)) {
    const key = workspaceNodeKey(ref.id)
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
  chooseRuntime,
  chooseDeploy,
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
  stopTarget,
  // 新会话 / workspace row / blank session row: the official draft page.
  startDraftSession,
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
  requestDeleteWorkspace,
  settleConfirm,
  acceptConfirm,
  openAddWorkspace,
  closeAddWorkspace,
  openBrowseDirectory,
  requestWorkspaceRename,
  settleWorkspaceRename,
  acceptWorkspaceRename,
  expandTarget,
  connectTarget,
  refreshAll,
  cleanupShellWorkspaces,
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
  // The shell subscription and the coalescing timer belong to this plugin's
  // lifetime too; a hot reload must not leave a second listener behind.
  if (stopShellSessionWatch !== undefined) {
    try {
      stopShellSessionWatch()
    } catch (error) {
      console.error('[dsh-remote-window] unsubscribing from the shell session list failed', error)
    }
    stopShellSessionWatch = undefined
  }
  if (stopShellSelectionWatch !== undefined) {
    try {
      stopShellSelectionWatch()
    } catch (error) {
      console.error('[dsh-remote-window] unsubscribing from the shell selection failed', error)
    }
    stopShellSelectionWatch = undefined
  }
  if (draftRefreshTimer !== undefined) {
    clearTimeout(draftRefreshTimer)
    draftRefreshTimer = undefined
  }
  pendingDraftRefreshes.clear()
  knownShellSessions = new Map()
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
