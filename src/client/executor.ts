/**
 * Pure execution-end (`executor`) state for the v1 connection settings.
 *
 * Mirrors `doc/refactor-v1-protocol.md` §5.4 and the D20 product decision:
 *
 *  - a connection stores its default execution end (`server` / `local`);
 *  - every **session** carries its own server-side executor record;
 *  - before switching, the UI asks the server for a plan
 *    (`executor/plan-switch`). When other sessions in this profile are still
 *    running, the switch must list them and wait for a second, explicit
 *    confirmation — never silently cancel another turn;
 *  - the current session's turn is always cancelled as part of the switch
 *    (D2), so it is listed for information but does not by itself require a
 *    confirmation dialog.
 *
 * Nothing here performs host calls or renders React: the functions return the
 * exact state a dialog needs, which keeps the D20 flow unit-testable.
 */

/** Where a Session's agent loop and model credentials live. */
export type ExecutorMode = 'server' | 'local'

/** New connections default to the local end: a fresh server usually has no model key. */
export const DEFAULT_EXECUTOR_MODE: ExecutorMode = 'local'

/** Narrow a wire value to {@link ExecutorMode}. */
export function isExecutorMode(value: unknown): value is ExecutorMode {
  return value === 'server' || value === 'local'
}

/** One running agent from the server's `activeTurns` list. */
export interface ActiveTurn {
  readonly sessionId: string
  /** Display title, when the server folded one (protocol §16.8). */
  readonly title?: string
  readonly running: boolean
  /** Official agent status (diagnostic; the row shows the session title). */
  readonly status: string
}

/** Plan returned by `executor/plan-switch` (protocol §5.4). */
export interface ExecutorSwitchPlan {
  readonly currentMode: ExecutorMode
  readonly to: ExecutorMode
  /** `true` when switching to `local`: the profile server must restart. */
  readonly restartRequired: boolean
  /** Every running agent in this profile, including the target session. */
  readonly activeTurns: readonly ActiveTurn[]
  /** Server-derived flag: some non-target session is running. */
  readonly requiresConfirmation: boolean
  /** The target session itself is running (D2: auto-cancelled). */
  readonly targetTurnRunning: boolean
}

/** Why a mode switch could not be started or completed. */
export type ExecutorErrorKind =
  | 'confirm-required'
  | 'busy'
  | 'held'
  | 'writer-held'
  | 'profile-in-use'
  | 'profile-locked'
  | 'preview-stale'
  | 'mode-conflict'
  | 'registry-stale'
  | 'failed'

/** Owner of a local-mode executor lock, as reported in `executor-held` details. */
export interface ExecutorOwner {
  readonly clientId: string
  readonly instanceId?: string
  /** ISO-8601 heartbeat; the lock is stale after 20 s without one. */
  readonly heartbeatAt?: string
}

/** A wire failure reduced to the state the settings UI needs. */
export interface ExecutorErrorView {
  readonly kind: ExecutorErrorKind
  readonly code: string
  readonly message: string
  /** True when an immediate retry is meaningful. */
  readonly retryable: boolean
  /** Present for `confirm-required`: the turns the retry must cancel. */
  readonly activeTurns?: readonly ActiveTurn[]
  /** Present for `held`: who holds the session. */
  readonly owner?: ExecutorOwner
  /** Present for a partially failed cancellation (`mode-switch/cancel-failed`). */
  readonly failedCancellations?: readonly ModeSwitchFailedCancellation[]
}

/** The switch dialog's call-to-action state. */
export type ExecutorSwitchPhase =
  | 'idle'
  | 'previewing'
  | 'ready'
  | 'confirming'
  | 'switching'
  | 'done'
  | 'failed'

/** Complete UI state for one connection's pending mode switch. */
export interface ExecutorSwitchState {
  readonly phase: ExecutorSwitchPhase
  /** Requested mode, once a preview or plan exists. */
  readonly to?: ExecutorMode
  /** Session the switch was requested from; identifies the "target" turn. */
  readonly targetSessionId?: string
  /** Server plan, kept from preview through failure for a retry. */
  readonly plan?: ExecutorSwitchPlan
  /** True only after the user explicitly confirmed the D20 dialog. */
  readonly confirmed: boolean
  /** Ids the server reported as cancelled after a successful switch. */
  readonly cancelledSessionIds?: readonly string[]
  /** Turns the server could not cancel; the switch must not claim success. */
  readonly failedSessionIds?: readonly string[]
  readonly error?: ExecutorErrorView
}

/** Actions the settings UI dispatches into {@link executorSwitchReducer}. */
export type ExecutorSwitchAction =
  | { readonly type: 'preview'; readonly to: ExecutorMode; readonly targetSessionId: string }
  | { readonly type: 'plan'; readonly plan: ExecutorSwitchPlan; readonly targetSessionId: string }
  | { readonly type: 'confirm' }
  | { readonly type: 'begin-switch' }
  | {
    readonly type: 'switched'
    readonly mode: ExecutorMode
    readonly cancelledSessionIds?: readonly string[]
    readonly failedSessionIds?: readonly string[]
    readonly restartRequired?: boolean
  }
  | { readonly type: 'failed'; readonly error: ExecutorErrorView }
  | { readonly type: 'cancel' }
  | { readonly type: 'reset' }

/** Initial idle switch state. */
export const IDLE_EXECUTOR_SWITCH: ExecutorSwitchState = { phase: 'idle', confirmed: false }

/** Turns that belong to sessions other than the one the switch started from. */
export function otherActiveTurns(plan: ExecutorSwitchPlan, targetSessionId: string): ActiveTurn[] {
  return plan.activeTurns.filter(turn => turn.sessionId !== targetSessionId && turn.running)
}

/** The target session's own running turn, when the plan reports it. */
export function targetActiveTurn(plan: ExecutorSwitchPlan, targetSessionId: string): ActiveTurn | undefined {
  return plan.activeTurns.find(turn => turn.sessionId === targetSessionId && turn.running)
}

/** What the confirmation dialog must show, derived only from the plan. */
export interface ExecutorSwitchSummary {
  /** Other sessions whose running turns would be cancelled by the switch. */
  readonly otherActiveTurns: readonly ActiveTurn[]
  /** The target session's own turn (auto-cancelled, listed for transparency). */
  readonly targetTurn?: ActiveTurn
  /** True when D20 requires the explicit confirm step. */
  readonly needsConfirmation: boolean
  /** True when the profile server must restart after the switch. */
  readonly restartRequired: boolean
}

/**
 * Reduce a plan to the dialog's facts.
 *
 * A server may omit `requiresConfirmation` (older plugin) while still returning
 * other running turns; the local rule is therefore authoritative for the UI:
 * any other running turn needs confirmation.
 * @param plan - `executor/plan-switch` result.
 * @param targetSessionId - the session the user is switching from.
 */
export function summarizeExecutorSwitch(
  plan: ExecutorSwitchPlan,
  targetSessionId: string,
): ExecutorSwitchSummary {
  const others = otherActiveTurns(plan, targetSessionId)
  const target = targetActiveTurn(plan, targetSessionId)
  return {
    otherActiveTurns: others,
    ...(target === undefined ? {} : { targetTurn: target }),
    needsConfirmation: plan.requiresConfirmation || others.length > 0,
    restartRequired: plan.restartRequired || plan.to === 'local',
  }
}

/**
 * Reduce the switch state machine.
 *
 * Guards make every illegal transition a no-op so a late response (e.g. a
 * duplicate `switched` after `failed`) cannot move the UI into a state the
 * server never reached. `cancel` returns to idle with no side effect: the user
 * cancelled before anything was written.
 * @param state - current state.
 * @param action - UI action.
 * @returns the next state.
 */
export function executorSwitchReducer(
  state: ExecutorSwitchState,
  action: ExecutorSwitchAction,
): ExecutorSwitchState {
  switch (action.type) {
    case 'preview':
      if (state.phase === 'switching') return state
      return {
        phase: 'previewing',
        to: action.to,
        targetSessionId: action.targetSessionId,
        confirmed: false,
      }
    case 'plan': {
      if (state.phase !== 'previewing' && state.phase !== 'failed') return state
      const summary = summarizeExecutorSwitch(action.plan, action.targetSessionId)
      return {
        phase: summary.needsConfirmation ? 'confirming' : 'ready',
        to: action.plan.to,
        targetSessionId: action.targetSessionId,
        plan: action.plan,
        confirmed: false,
      }
    }
    case 'confirm':
      if (state.phase !== 'confirming' || state.plan === undefined) return state
      return { ...state, phase: 'switching', confirmed: true }
    case 'begin-switch':
      // The no-other-turn path: the current turn is auto-cancelled, so no
      // second confirmation exists; only a planned switch may advance.
      if (state.phase !== 'ready' || state.plan === undefined) return state
      return { ...state, phase: 'switching', confirmed: state.confirmed }
    case 'switched': {
      if (state.phase !== 'switching') return state
      const failed = action.failedSessionIds ?? []
      return {
        phase: failed.length === 0 ? 'done' : 'failed',
        to: action.mode,
        ...(state.targetSessionId === undefined ? {} : { targetSessionId: state.targetSessionId }),
        ...(state.plan === undefined ? {} : { plan: state.plan }),
        confirmed: state.confirmed,
        ...(action.cancelledSessionIds === undefined ? {} : { cancelledSessionIds: action.cancelledSessionIds }),
        ...(action.failedSessionIds === undefined ? {} : { failedSessionIds: action.failedSessionIds }),
        ...(failed.length === 0
          ? {}
          : { error: switchFailure('executor-switch-cancel-failed', 'Some turns could not be cancelled') }),
      }
    }
    case 'failed':
      if (state.phase === 'done') return state
      return { ...state, phase: 'failed', error: action.error }
    case 'cancel':
    case 'reset':
      return IDLE_EXECUTOR_SWITCH
    default:
      // Runtime-only backstop: a stale/foreign action must not produce a
      // half-applied state.
      return state
  }
}

/** Build a failure view for a partially-cancelled switch. */
function switchFailure(code: string, message: string): ExecutorErrorView {
  return { kind: 'failed', code, message, retryable: true }
}

/** Details shape the error mapper tolerates without trusting it. */
interface WireErrorDetails {
  readonly activeTurns?: unknown
  readonly otherActiveTurns?: unknown
  readonly failedCancellations?: unknown
  readonly failures?: unknown
  readonly ownerClientId?: unknown
  readonly ownerInstanceId?: unknown
  readonly heartbeatAt?: unknown
}

/** Narrow one unknown array item to {@link ActiveTurn}. */
function asActiveTurn(value: unknown): ActiveTurn | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const row = value as { sessionId?: unknown; title?: unknown; running?: unknown; status?: unknown }
  if (typeof row.sessionId !== 'string' || row.sessionId === '') return undefined
  return {
    sessionId: row.sessionId,
    ...(typeof row.title === 'string' && row.title !== '' ? { title: row.title } : {}),
    running: row.running === true,
    status: typeof row.status === 'string' ? row.status : 'unknown',
  }
}

/** Narrow the `activeTurns` detail list, dropping malformed entries. */
export function parseActiveTurns(value: unknown): ActiveTurn[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const turn = asActiveTurn(item)
    return turn === undefined ? [] : [turn]
  })
}

/** Narrow `executor-held` details into the lock owner. */
export function parseExecutorOwner(value: unknown): ExecutorOwner | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const details = value as WireErrorDetails
  if (typeof details.ownerClientId !== 'string' || details.ownerClientId === '') return undefined
  return {
    clientId: details.ownerClientId,
    ...(typeof details.ownerInstanceId === 'string' ? { instanceId: details.ownerInstanceId } : {}),
    ...(typeof details.heartbeatAt === 'string' ? { heartbeatAt: details.heartbeatAt } : {}),
  }
}

/**
 * Map one P1/P3 failure to the settings surface.
 *
 * Codes come from protocol §12; the message is already scrubbed by the host.
 * `details` is only read for the stable, public fields the contract names.
 * @param error - wire failure shape; extra fields are ignored.
 * @returns the view the dialog renders.
 */
export function executorErrorView(error: {
  readonly code: string
  readonly message: string
  readonly details?: unknown
}): ExecutorErrorView {
  const details = error.details
  switch (error.code) {
    case 'executor-switch-confirm-required':
    case 'mode-switch/other-turns-cancelled-required':
      return {
        kind: 'confirm-required',
        code: error.code,
        message: error.message,
        retryable: false,
        activeTurns: parseActiveTurns(
          (details as WireErrorDetails | undefined)?.activeTurns
            ?? (details as WireErrorDetails | undefined)?.otherActiveTurns,
        ),
      }
    case 'executor-switch-busy':
      return { kind: 'busy', code: error.code, message: error.message, retryable: true }
    case 'executor-held': {
      const owner = parseExecutorOwner(details)
      return {
        kind: 'held',
        code: error.code,
        message: error.message,
        retryable: owner !== undefined && owner.heartbeatAt !== undefined,
        ...(owner === undefined ? {} : { owner }),
      }
    }
    case 'session/writer-held':
      return { kind: 'writer-held', code: error.code, message: error.message, retryable: false }
    case 'profile-in-use':
      return { kind: 'profile-in-use', code: error.code, message: error.message, retryable: true }
    case 'profile-locked':
      return { kind: 'profile-locked', code: error.code, message: error.message, retryable: true }
    case 'mode-switch/preview-stale':
      return { kind: 'preview-stale', code: error.code, message: error.message, retryable: true }
    case 'mode-switch/preview-failed':
      return { kind: 'failed', code: error.code, message: error.message, retryable: true }
    case 'mode-switch/cancel-failed':
      return {
        kind: 'failed',
        code: error.code,
        message: error.message,
        retryable: true,
        failedCancellations: parseFailedCancellations(details),
      }
    case 'executor-mode-conflict':
      return { kind: 'mode-conflict', code: error.code, message: error.message, retryable: false }
    case 'registry-stale':
      return { kind: 'registry-stale', code: error.code, message: error.message, retryable: true }
    default:
      return { kind: 'failed', code: error.code, message: error.message, retryable: true }
  }
}

/** Owner heartbeat age after which protocol allows another client to take over. */
export const EXECUTOR_OWNER_TTL_MS = 20_000

/**
 * Whether a local-mode executor owner is stale enough to take over.
 * @param heartbeatAt - owner heartbeat in ISO-8601.
 * @param now - current epoch milliseconds.
 * @param ttlMs - protocol TTL (20 s).
 * @returns true when the timestamp parses and is older than the TTL.
 */
export function executorOwnerExpired(
  heartbeatAt: string,
  now: number,
  ttlMs: number = EXECUTOR_OWNER_TTL_MS,
): boolean {
  const parsed = Date.parse(heartbeatAt)
  if (Number.isNaN(parsed)) return false
  return now - parsed > ttlMs
}

/** Whether switching to this mode requires the profile server restart step. */
export function requiresProfileRestart(plan: ExecutorSwitchPlan): boolean {
  return plan.to === 'local' || plan.restartRequired
}

/** Whether the connection's current mode already equals the requested mode. */
export function isSameExecutorMode(current: ExecutorMode, requested: ExecutorMode): boolean {
  return current === requested
}

/** A connection's persisted execution-end setting (client-owned, protocol §5.4). */
export interface ConnectionExecutorSetting {
  readonly targetId: string
  readonly mode: ExecutorMode
}

/** Parse a stored setting, falling back to the protocol default. */
export function executorModeOf(value: unknown): ExecutorMode {
  return isExecutorMode(value) ? value : DEFAULT_EXECUTOR_MODE
}

/* ------------------------------------------------------------------------- */
/* P3 connection mode switch (protocol §16.13, the dev-ui D20 surface)        */
/* ------------------------------------------------------------------------- */

/**
 * One other running turn from `mode/preview`.
 *
 * The P3 preview only guarantees identity and an optional folded title; the
 * running flag is informational for a session-level plan, not a filter here.
 */
export interface ModeSwitchTurn {
  readonly sessionId: string
  readonly title?: string
  readonly running?: boolean
}

/** The target session's own turn from `mode/preview`. */
export interface ModeSwitchCurrentTurn {
  readonly sessionId: string
  readonly title?: string
  readonly running: boolean
}

/** `POST /api/mode/preview` value (protocol §16.13). */
export interface ModeSwitchPreview {
  readonly currentTurn?: ModeSwitchCurrentTurn
  /** Every **other** running turn in the profile; never empty when confirm is required. */
  readonly otherActiveTurns: readonly ModeSwitchTurn[]
  readonly requiresConfirm: boolean
  /** Opaque server revision; `mode/apply` must echo it. */
  readonly previewRevision: string
}

/** One turn the server failed to cancel during `mode/apply`. */
export interface ModeSwitchFailedCancellation {
  readonly sessionId: string
  readonly message?: string
}

/** P3 SSE progress phases (protocol §16.13). */
export type ModeSwitchProgressPhase =
  | 'preview'
  | 'cancelling'
  | 'disposing'
  | 'stopping'
  | 'starting'
  | 'handshake'
  | 'ready'
  | 'failed'

/** One event on the shared `/stream/state` channel while a switch runs. */
export type ModeSwitchEvent =
  | { readonly type: 'mode-switch/progress'; readonly targetId: string; readonly phase: ModeSwitchProgressPhase }
  | { readonly type: 'turn/cancelled'; readonly targetId: string; readonly sessionId: string }
  | {
    readonly type: 'mode/changed'
    readonly targetId: string
    readonly sessionId?: string
    readonly mode: ExecutorMode
  }

/** Why a preview cannot be turned into an apply request. */
export type ModeSwitchPreviewProblem = 'missing-revision' | 'active-turns-missing'

/**
 * Validate the preview's two safety preconditions.
 *
 * D20 requires the preview to carry the complete set of turns that will be
 * cancelled; an apply based on a missing list is refused rather than treated as
 * "nothing else was running".
 * @param preview - server preview.
 * @returns the problem, or undefined when the preview is actionable.
 */
export function modeSwitchPreviewProblem(preview: ModeSwitchPreview): ModeSwitchPreviewProblem | undefined {
  if (preview.previewRevision.trim() === '') return 'missing-revision'
  if (preview.requiresConfirm && preview.otherActiveTurns.length === 0) return 'active-turns-missing'
  return undefined
}

/** Phases of the connection-level switch dialog. */
export type ModeSwitchPhase =
  | 'idle'
  | 'previewing'
  | 'confirming'
  | 'ready'
  | 'applying'
  | 'done'
  | 'failed'

/** UI state for one connection-level `mode/preview` → `mode/apply` run. */
export interface ModeSwitchState {
  readonly phase: ModeSwitchPhase
  readonly nextMode?: ExecutorMode
  /** Session whose running turn D20 treats as the automatically-cancelled one. */
  readonly targetSessionId?: string
  readonly preview?: ModeSwitchPreview
  /** True only after the user confirmed the D20 list. */
  readonly confirmed: boolean
  /** P3 progress event currently shown in the dialog. */
  readonly progressPhase?: ModeSwitchProgressPhase
  /** Ids the server reported as cancelled after a successful apply. */
  readonly cancelledTurnIds?: readonly string[]
  readonly failedCancellations?: readonly ModeSwitchFailedCancellation[]
  readonly error?: ExecutorErrorView
}

/** Actions the settings dialog dispatches. */
export type ModeSwitchAction =
  | { readonly type: 'preview'; readonly nextMode: ExecutorMode; readonly targetSessionId?: string }
  | { readonly type: 'planned'; readonly preview: ModeSwitchPreview }
  | { readonly type: 'confirm' }
  | { readonly type: 'begin-apply' }
  | { readonly type: 'progress'; readonly phase: ModeSwitchProgressPhase }
  | {
    readonly type: 'applied'
    readonly cancelledTurnIds?: readonly string[]
    readonly failedCancellations?: readonly ModeSwitchFailedCancellation[]
  }
  | { readonly type: 'failed'; readonly error: ExecutorErrorView }
  | { readonly type: 'cancel' }
  | { readonly type: 'reset' }

/** Initial state: no switch requested. */
export const IDLE_MODE_SWITCH: ModeSwitchState = { phase: 'idle', confirmed: false }

/** What the confirmation dialog shows for one preview. */
export interface ModeSwitchSummary {
  readonly otherActiveTurns: readonly ModeSwitchTurn[]
  readonly currentTurn?: ModeSwitchCurrentTurn
  readonly needsConfirmation: boolean
  readonly previewProblem?: ModeSwitchPreviewProblem
}

/**
 * Reduce a preview to the dialog's facts.
 * @param preview - server preview.
 * @returns the turn lists and the confirmation requirement.
 */
export function summarizeModeSwitch(preview: ModeSwitchPreview): ModeSwitchSummary {
  const problem = modeSwitchPreviewProblem(preview)
  return {
    otherActiveTurns: preview.otherActiveTurns,
    ...(preview.currentTurn === undefined ? {} : { currentTurn: preview.currentTurn }),
    needsConfirmation: preview.requiresConfirm || preview.otherActiveTurns.length > 0,
    ...(problem === undefined ? {} : { previewProblem: problem }),
  }
}

/**
 * Reduce the connection-level switch state.
 *
 * A preview that violates the D20 completeness rule lands in `failed` with a
 * `mode-switch/preview-failed` view; it never reaches `applying`. `progress`
 * only annotates a running apply.
 * @param state - current state.
 * @param action - dialog action.
 * @returns the next state.
 */
export function modeSwitchReducer(state: ModeSwitchState, action: ModeSwitchAction): ModeSwitchState {
  switch (action.type) {
    case 'preview':
      if (state.phase === 'applying') return state
      return {
        phase: 'previewing',
        nextMode: action.nextMode,
        ...(action.targetSessionId === undefined ? {} : { targetSessionId: action.targetSessionId }),
        confirmed: false,
      }
    case 'planned': {
      if (state.phase !== 'previewing' && state.phase !== 'failed' && state.phase !== 'confirming') return state
      const summary = summarizeModeSwitch(action.preview)
      if (summary.previewProblem !== undefined) {
        const problem: ModeSwitchPreviewProblem = summary.previewProblem
        return {
          phase: 'failed',
          ...(state.nextMode === undefined ? {} : { nextMode: state.nextMode }),
          ...(state.targetSessionId === undefined ? {} : { targetSessionId: state.targetSessionId }),
          preview: action.preview,
          confirmed: false,
          error: {
            kind: 'failed',
            code: 'mode-switch/preview-failed',
            message: problem === 'active-turns-missing'
              ? 'The switch preview did not list the other running turns'
              : 'The switch preview carries no revision',
            retryable: true,
          },
        }
      }
      return {
        phase: summary.needsConfirmation ? 'confirming' : 'ready',
        ...(state.nextMode === undefined ? {} : { nextMode: state.nextMode }),
        ...(state.targetSessionId === undefined ? {} : { targetSessionId: state.targetSessionId }),
        preview: action.preview,
        confirmed: false,
      }
    }
    case 'confirm':
      if (state.phase !== 'confirming' || state.preview === undefined) return state
      if (modeSwitchPreviewProblem(state.preview) !== undefined) return state
      return { ...state, phase: 'applying', confirmed: true }
    case 'begin-apply': {
      if (state.phase !== 'ready' || state.preview === undefined) return state
      if (modeSwitchPreviewProblem(state.preview) !== undefined) return state
      // A preview that requires a confirmation is never applied from `ready`.
      if (state.preview.requiresConfirm || state.preview.otherActiveTurns.length > 0) return state
      return { ...state, phase: 'applying' }
    }
    case 'progress':
      if (state.phase !== 'applying') return state
      return { ...state, progressPhase: action.phase }
    case 'applied': {
      if (state.phase !== 'applying') return state
      const failed = action.failedCancellations ?? []
      if (failed.length > 0) {
        return {
          ...state,
          phase: 'failed',
          ...(action.cancelledTurnIds === undefined ? {} : { cancelledTurnIds: action.cancelledTurnIds }),
          failedCancellations: failed,
          error: {
            kind: 'failed',
            code: 'mode-switch/cancel-failed',
            message: 'Some turns could not be cancelled; the switch did not complete',
            retryable: true,
            failedCancellations: failed,
          },
        }
      }
      return {
        ...state,
        phase: 'done',
        ...(action.cancelledTurnIds === undefined ? {} : { cancelledTurnIds: action.cancelledTurnIds }),
      }
    }
    case 'failed':
      if (state.phase === 'done') return state
      return { ...state, phase: 'failed', error: action.error }
    case 'cancel':
    case 'reset':
      return IDLE_MODE_SWITCH
    default:
      return state
  }
}

/** The exact payload `mode/apply` must receive, or why the UI may not send it. */
export type ModeSwitchApplyRequest =
  | {
    readonly ok: true
    readonly nextMode: ExecutorMode
    readonly targetSessionId?: string
    readonly previewRevision: string
    readonly cancelActiveTurns: true
  }
  | {
    readonly ok: false
    readonly reason: 'not-ready' | 'confirmation-required' | 'missing-preview' | 'preview-incomplete'
  }

/**
 * Build the apply request from the dialog state.
 *
 * This is the last guard before the critical write: no revision, no complete
 * preview list, or an unconfirmed D20 list all fail closed here.
 * @param state - switch state after `confirm`/`begin-apply`.
 * @returns the request fields, or the blocking reason.
 */
export function modeSwitchApplyRequest(state: ModeSwitchState): ModeSwitchApplyRequest {
  if (state.phase !== 'applying') return { ok: false, reason: 'not-ready' }
  if (state.preview === undefined || state.nextMode === undefined) return { ok: false, reason: 'missing-preview' }
  if (modeSwitchPreviewProblem(state.preview) !== undefined) return { ok: false, reason: 'preview-incomplete' }
  if (summarizeModeSwitch(state.preview).needsConfirmation && !state.confirmed) {
    return { ok: false, reason: 'confirmation-required' }
  }
  return {
    ok: true,
    nextMode: state.nextMode,
    ...(state.targetSessionId === undefined ? {} : { targetSessionId: state.targetSessionId }),
    previewRevision: state.preview.previewRevision,
    cancelActiveTurns: true,
  }
}

/** Narrow the P3 SSE payload to one mode-switch event. */
export function parseModeSwitchEvent(data: unknown): ModeSwitchEvent | undefined {
  if (data === null || typeof data !== 'object') return undefined
  const event = data as { type?: unknown; targetId?: unknown; phase?: unknown; sessionId?: unknown; mode?: unknown }
  if (typeof event.targetId !== 'string' || event.targetId === '') return undefined
  switch (event.type) {
    case 'mode-switch/progress':
      return typeof event.phase === 'string' && isModeSwitchProgressPhase(event.phase)
        ? { type: 'mode-switch/progress', targetId: event.targetId, phase: event.phase }
        : undefined
    case 'turn/cancelled':
      return typeof event.sessionId === 'string' && event.sessionId !== ''
        ? { type: 'turn/cancelled', targetId: event.targetId, sessionId: event.sessionId }
        : undefined
    case 'mode/changed':
      if (!isExecutorMode(event.mode)) return undefined
      return {
        type: 'mode/changed',
        targetId: event.targetId,
        mode: event.mode,
        ...(typeof event.sessionId === 'string' && event.sessionId !== '' ? { sessionId: event.sessionId } : {}),
      }
    default:
      return undefined
  }
}

/** Narrow one progress phase. */
function isModeSwitchProgressPhase(value: string): value is ModeSwitchProgressPhase {
  switch (value) {
    case 'preview':
    case 'cancelling':
    case 'disposing':
    case 'stopping':
    case 'starting':
    case 'handshake':
    case 'ready':
    case 'failed':
      return true
    default:
      return false
  }
}

/** Narrow `mode-switch/cancel-failed` details into the failed list. */
function parseFailedCancellations(value: unknown): ModeSwitchFailedCancellation[] {
  if (value === null || typeof value !== 'object') return []
  const details = value as WireErrorDetails
  const list = details.failedCancellations ?? details.failures
  if (!Array.isArray(list)) return []
  return list.flatMap(item => {
    if (item === null || typeof item !== 'object') return []
    const row = item as { sessionId?: unknown; message?: unknown }
    if (typeof row.sessionId !== 'string' || row.sessionId === '') return []
    return [{
      sessionId: row.sessionId,
      ...(typeof row.message === 'string' ? { message: row.message } : {}),
    }]
  })
}
