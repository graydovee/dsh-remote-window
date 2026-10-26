/**
 * P3 `mode/apply` orchestration (protocol §16.13).
 *
 * dev-core's `ProfileService.modeApply` owns the HTTP route, preview/D20
 * validation, target-record write and transport lifecycle; this helper adds the
 * part that must stay next to the session bridge:
 *
 * - **server → local**: one P1 `executor/switch` for the target session (the
 *   server plugin cancels that turn, disposes its managed handle or asks for a
 *   restart); if `restartRequired` is true the injected profile restart runs
 *   before the method resolves.
 * - **local → server**: every locally-owned agent is released first
 *   (cancel → idle → flush → close), then each session's executor record is
 *   flipped to `server`. Releasing before flipping is what prevents a
 *   server-mode writer from racing the local agent for the JSONL flock.
 *
 * Everything is injected; no Cordis/Node imports so dev-core can unit-test the
 * state machine without a profile server.
 */
import {
  ExecutorError,
  ServerExecutor,
  type ExecutorMode,
  type ExecutorSwitchOutcome,
} from './executor.ts'

/** The local-handle table this apply may need to drain. */
export interface ModeApplyLocalPort {
  /** Sessions whose write handle this process owns. */
  list(): readonly string[]
  /** Release one local agent (cancel → idle → flush → close). */
  release(sessionId: string): Promise<unknown>
}

/** Injected dependencies of one mode apply. */
export interface ModeApplyDeps {
  readonly executor: ServerExecutor
  /** Required for the local→server direction (and to report what was released). */
  readonly local?: ModeApplyLocalPort
  /** dev-core's profile stop/start/handshake; used only when the server asks. */
  readonly restartProfile?: () => Promise<void>
}

/** One mode-apply request (preview/D20 validation stays at the route). */
export interface ModeApplyRequest {
  readonly nextMode: ExecutorMode
  /** Session the user is looking at; required for a targeted server→local switch. */
  readonly targetSessionId?: string
  /** D20 consent for cancelling other sessions' running turns. */
  readonly confirmOtherTurns: boolean
  /** Passed to P1 `executor/switch`; the server re-checks it. */
  readonly previewRevision?: string
}

/** What the route needs after a successful switch. */
export interface ModeApplyResult {
  readonly switched: boolean
  readonly cancelledTurnIds: readonly string[]
  readonly failedCancellations: readonly { readonly sessionId: string; readonly message: string }[]
  readonly restartRequired: boolean
  /** Sessions whose record now reads `server` (local→server). */
  readonly switchedSessionIds: readonly string[]
  /** Session the UI should now open locally (server→local). */
  readonly openSessionId?: string
}

/** Turn one executor switch outcome into the route result shape. */
function resultOf(outcome: ExecutorSwitchOutcome, openSessionId?: string): ModeApplyResult {
  return {
    switched: true,
    cancelledTurnIds: outcome.plannedCancellations,
    failedCancellations: [],
    restartRequired: outcome.restartRequired,
    switchedSessionIds: outcome.mode === 'server' ? outcome.plannedCancellations : [],
    ...(openSessionId === undefined ? {} : { openSessionId }),
  }
}

/**
 * Apply one connection-level executor switch.
 *
 * The route must already have validated the D20 preview (`cancelActiveTurns`
 * consent + `previewRevision`); this helper performs the session/lease side.
 * @param deps - executor RPC, local handle table and profile restart port.
 * @param request - next mode, target session and D20 consent.
 * @returns the route result; failures throw a coded {@link ExecutorError}.
 */
export async function applyModeSwitch(deps: ModeApplyDeps, request: ModeApplyRequest): Promise<ModeApplyResult> {
  if (request.nextMode === 'local') {
    if (request.targetSessionId === undefined) {
      throw new ExecutorError(
        'bad-request',
        'switching to local needs the target session id (the server cancels or hands off that session)',
        400,
      )
    }
    const outcome = await deps.executor.switchTo({
      sessionId: request.targetSessionId,
      to: 'local',
      confirmOtherTurns: request.confirmOtherTurns,
      ...(deps.restartProfile === undefined ? {} : { restartProfile: deps.restartProfile }),
    })
    return resultOf(outcome, request.targetSessionId)
  }

  // local → server: release every owned writer before flipping any record.
  const local = deps.local
  const owned = local?.list() ?? []
  const failed: { sessionId: string; message: string }[] = []
  for (const sessionId of owned) {
    try {
      await local?.release(sessionId)
    } catch (error) {
      failed.push({ sessionId, message: error instanceof Error ? error.message : String(error) })
    }
  }
  if (failed.length > 0) {
    throw new ExecutorError(
      'mode-switch/cancel-failed',
      'some local turns could not be cancelled and released; the executor record was not changed',
      409,
      { failedCancellations: failed },
    )
  }
  const switchedSessionIds: string[] = []
  for (const sessionId of owned) {
    try {
      // The local writer was released above; the executor switch only flips the
      // record (an already-`server` record is a no-op).
      await deps.executor.switchTo({ sessionId, to: 'server', releaseLocal: async () => {} })
      switchedSessionIds.push(sessionId)
    } catch (error) {
      failed.push({ sessionId, message: error instanceof Error ? error.message : String(error) })
    }
  }
  if (failed.length > 0) {
    throw new ExecutorError(
      'mode-switch/cancel-failed',
      'local writers were released but some executor records could not be flipped to server',
      409,
      { failedCancellations: failed, switchedSessionIds },
    )
  }
  return {
    switched: true,
    cancelledTurnIds: owned,
    failedCancellations: [],
    restartRequired: false,
    switchedSessionIds,
  }
}
