/**
 * Client-side view of the per-session executor (server / local) state.
 *
 * The authoritative record is owned by the server plugin (protocol §5.4: one
 * `ExecutorRecord` per session, stored under `$DSH_HOME/remote-workspace/state/
 * executors/*.json`). This module only orchestrates the **client half** of a
 * switch against that record through P1 `executor/*` RPCs, and keeps the
 * ordering that makes the hand-off safe:
 *
 * - server → local: preview (D20) → server cancels + flushes (managed handle is
 *   disposed there, or the profile is restarted) → client optionally restarts
 *   the profile → local agent may take the write lock.
 * - local → server: the **client** must cancel its turn, wait for idle, flush
 *   and close the write handle *before* the record says `server`; otherwise two
 *   writers would race for the same JSONL artifact.
 *
 * Ownership of the log itself is never ours: the official JSONL flock decides
 * (`session/writer-held`). This module only turns the executor record into a
 * predictable UI/state-machine contract.
 *
 * Wire contract: `doc/refactor-v1-protocol.md` §5.4, §4.3; the shared wire
 * types/constants come from `src/protocol.ts` (two-repo contract).
 */
import { RW_METHODS } from '../protocol.ts'
import type { RwActiveAgent, RwExecutorMode, RwExecutorRecord, RwExecutorSwitchPlan } from '../protocol.ts'

/** Which side runs the agent loop and owns the model credentials. */
export type ExecutorMode = RwExecutorMode

/** Who currently drives a local-mode session; heartbeats keep it fresh. */
export type ExecutorOwner = NonNullable<RwExecutorRecord['owner']>

/** One durable executor record as returned by P1 `executor/get`. */
export type ExecutorRecord = RwExecutorRecord

/** One live agent on the profile server, used by the D20 preview. */
export type ExecutorActiveTurn = RwActiveAgent

/** P1 `executor/plan-switch` result (protocol §5.4). */
export type ExecutorSwitchPlan = RwExecutorSwitchPlan

/** What a completed switch leaves behind for the UI. */
export interface ExecutorSwitchOutcome {
  readonly mode: ExecutorMode
  readonly restartRequired: boolean
  /** Sessions whose running turn the switch plan expects to cancel. */
  readonly plannedCancellations: readonly string[]
}

/** The narrow RPC surface of one target's P1 client (dev-core's `remoteWorkspaces`). */
export interface ExecutorRpc {
  request<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T>
}

/** Typed failure with a stable P1-style code. */
export class ExecutorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ExecutorError'
  }
}

/** A switch for the same session is already in flight in this process. */
export class ExecutorSwitchBusyError extends ExecutorError {
  constructor(sessionId: string) {
    super('executor-switch-busy', `session "${sessionId}" already has an executor switch in flight`)
    this.name = 'ExecutorSwitchBusyError'
  }
}

/** D20: switching would cancel another session's running turn without consent. */
export class ExecutorSwitchConfirmRequiredError extends ExecutorError {
  constructor(readonly activeTurns: readonly ExecutorActiveTurn[]) {
    super(
      'executor-switch-confirm-required',
      `switching would cancel ${activeTurns.length} running turn(s) in this profile`,
      409,
      { activeTurns },
    )
    this.name = 'ExecutorSwitchConfirmRequiredError'
  }
}

/** The profile server still says the session runs on the other executor. */
export class ExecutorModeConflictError extends ExecutorError {
  constructor(readonly mode: ExecutorMode) {
    super('executor-mode-conflict', `the session is recorded on the "${mode}" executor`, 409, { mode })
    this.name = 'ExecutorModeConflictError'
  }
}

/** Another client owns a fresh local-mode executor record. */
export class ExecutorHeldError extends ExecutorError {
  constructor(readonly owner: ExecutorOwner | undefined) {
    super(
      'executor-held',
      owner === undefined
        ? 'the session is held by another client'
        : `the session is held by client "${owner.clientId}" (heartbeat ${owner.heartbeatAt})`,
      409,
      owner === undefined
        ? {}
        : { ownerClientId: owner.clientId, instanceId: owner.instanceId, heartbeatAt: owner.heartbeatAt },
    )
    this.name = 'ExecutorHeldError'
  }
}

/** A local turn could not be cancelled/released; the switch did not happen. */
export class ExecutorLocalReleaseError extends ExecutorError {
  constructor(cause: unknown) {
    super(
      'mode-switch/cancel-failed',
      `could not cancel and release the local turn: ${cause instanceof Error ? cause.message : String(cause)}`,
      409,
      { cause: cause instanceof Error ? cause.message : String(cause) },
    )
    this.name = 'ExecutorLocalReleaseError'
  }
}

/** The profile restart after recording `local` failed; the record is already local. */
export class ExecutorRestartFailedError extends ExecutorError {
  constructor(cause: unknown) {
    super(
      'executor-switch-restart-failed',
      `the executor switch was recorded but the profile restart failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      500,
      { cause: cause instanceof Error ? cause.message : String(cause) },
    )
    this.name = 'ExecutorRestartFailedError'
  }
}

/** The server plugin does not expose `executor/assign` yet. */
export class ExecutorAssignUnsupportedError extends ExecutorError {
  constructor(sessionId: string) {
    super('executor-assign-unsupported', `the server plugin cannot record an executor for "${sessionId}"`)
    this.name = 'ExecutorAssignUnsupportedError'
  }
}

/** How stale a local owner may be before another client may take over. */
export const EXECUTOR_OWNER_TTL_MS = 20_000

/** Read one error's stable code without assuming this repo's error class. */
function codeOf(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** A server response for `executor/get`: absent record is `null` on the wire. */
function asRecord(sessionId: string, raw: unknown): ExecutorRecord | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object') throw new ExecutorError('executor-record-invalid', `executor record for "${sessionId}" is not an object`, 500)
  const record = raw as Partial<ExecutorRecord>
  if (record.mode !== 'server' && record.mode !== 'local') {
    throw new ExecutorError('executor-record-invalid', `executor record for "${sessionId}" has an invalid mode`, 500)
  }
  if (record.sessionId !== undefined && record.sessionId !== sessionId) {
    throw new ExecutorError('executor-record-invalid', `executor record for "${sessionId}" names "${String(record.sessionId)}"`, 500)
  }
  return {
    version: 1,
    sessionId,
    mode: record.mode,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
    ...(record.owner === undefined ? {} : { owner: record.owner }),
    ...(record.switchedBy === undefined ? {} : { switchedBy: record.switchedBy }),
  }
}

/**
 * Whether a local executor record's owner is still alive.
 * @param record - the last record read from the server.
 * @param now - current epoch ms (injectable for tests).
 * @param ttlMs - freshness window; the protocol fixes 20 s.
 */
export function isOwnerFresh(
  record: ExecutorRecord | null | undefined,
  now: number = Date.now(),
  ttlMs: number = EXECUTOR_OWNER_TTL_MS,
): boolean {
  const heartbeat = record?.owner?.heartbeatAt
  if (heartbeat === undefined) return false
  const at = Date.parse(heartbeat)
  if (!Number.isFinite(at)) return false
  return now - at <= ttlMs
}

/** Owner hold check used by UI before offering a takeover. */
export function executorHeldByOther(
  record: ExecutorRecord | null | undefined,
  self: { clientId: string; instanceId: string },
  now: number = Date.now(),
): boolean {
  if (record?.mode !== 'local' || record.owner === undefined) return false
  const sameClient = record.owner.clientId === self.clientId && record.owner.instanceId === self.instanceId
  return !sameClient && isOwnerFresh(record, now)
}

/** One serialized runner per session to reject concurrent switches. */
class SessionLocks {
  private readonly chains = new Map<string, Promise<unknown>>()

  get busy(): readonly string[] {
    return [...this.chains.keys()]
  }

  isBusy(sessionId: string): boolean {
    return this.chains.has(sessionId)
  }

  run<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    if (this.chains.has(sessionId)) throw new ExecutorSwitchBusyError(sessionId)
    const next = operation().finally(() => {
      if (this.chains.get(sessionId) === next) this.chains.delete(sessionId)
    })
    this.chains.set(sessionId, next)
    return next
  }
}

/** Stop a local turn and release its server-side write handle. */
export type LocalTurnReleaser = () => Promise<void>

/** Options for {@link ServerExecutor.switchTo}. */
export interface ExecutorSwitchRequest {
  readonly sessionId: string
  readonly to: ExecutorMode
  /**
   * D20 consent. A switch is refused while `preview.requiresConfirmation` is
   * true and this is not `true`; it is passed through to the server.
   */
  readonly confirmOtherTurns?: boolean
  /**
   * Required when switching local→server: cancels the client turn, awaits
   * idle/flush and closes the write handle before the record flips.
   */
  readonly releaseLocal?: LocalTurnReleaser
  /**
   * Required when the server answers `restartRequired: true` (server→local for
   * an unmanaged live agent). dev-core's `restartProfile(targetId)`.
   */
  readonly restartProfile?: () => Promise<void>
}

/**
 * Client half of the executor protocol for one target.
 *
 * All state lives on the server; this class adds only the client ordering,
 * per-session switch serialization, and stable error codes. It never writes a
 * session log itself.
 */
export class ServerExecutor {
  private readonly locks = new SessionLocks()

  constructor(
    private readonly rpc: ExecutorRpc,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Whether a switch for this session is currently running in this process. */
  isSwitching(sessionId: string): boolean {
    return this.locks.isBusy(sessionId)
  }

  /** Read the authoritative executor record, if any. */
  async get(sessionId: string): Promise<ExecutorRecord | null> {
    const raw = await this.rpc.request<unknown>(RW_METHODS.executorGet, { sessionId })
    return asRecord(sessionId, raw)
  }

  /**
   * Record the executor for a session that has no record yet (local-mode new
   * session / hand-off). Owner identity is filled in by the server plugin from
   * the P1 lease headers, so only the mode travels from here.
   */
  async assign(sessionId: string, mode: ExecutorMode): Promise<ExecutorRecord> {
    try {
      const raw = await this.rpc.request<unknown>(RW_METHODS.executorAssign, { sessionId, mode })
      const record = asRecord(sessionId, raw)
      if (record === null) throw new ExecutorError('executor-record-invalid', `executor/assign did not return a record for "${sessionId}"`, 500)
      return record
    } catch (error) {
      if (error instanceof ExecutorError) throw error
      const code = codeOf(error)
      // Old/partial server (protocol still being finalized): no `executor/assign`.
      if (code === 'bad-request' || code === 'gateway/bad-request' || code === 'not-found' || code === 'handle-not-found') {
        throw new ExecutorAssignUnsupportedError(sessionId)
      }
      throw error
    }
  }

  /** D20 preview; no side effects. */
  async preview(sessionId: string, to: ExecutorMode): Promise<ExecutorSwitchPlan> {
    const raw = await this.rpc.request<unknown>(RW_METHODS.executorPlanSwitch, { sessionId, to })
    if (raw === null || typeof raw !== 'object') {
      throw new ExecutorError('executor-plan-invalid', `executor/plan-switch returned no plan for "${sessionId}"`, 500)
    }
    const plan = raw as Partial<ExecutorSwitchPlan>
    if (plan.currentMode !== 'server' && plan.currentMode !== 'local') {
      throw new ExecutorError('executor-plan-invalid', `executor plan for "${sessionId}" has an invalid current mode`, 500)
    }
    const activeTurns = Array.isArray(plan.activeTurns) ? plan.activeTurns : []
    return {
      currentMode: plan.currentMode,
      to,
      restartRequired: plan.restartRequired === true,
      activeTurns,
      requiresConfirmation: plan.requiresConfirmation === true,
      targetTurnRunning: plan.targetTurnRunning === true,
    }
  }

  /**
   * Switch one session's executor with the ordering the protocol requires.
   *
   * local → server: `releaseLocal` first (cancel → idle → flush → close), then
   * the record flips; the server-mode UI may open the session afterwards.
   *
   * server → local: preview/confirm, then the server cancels and either hands
   * off its managed handle or asks for a profile restart; the local agent must
   * not open the log before this resolves.
   */
  async switchTo(request: ExecutorSwitchRequest): Promise<ExecutorSwitchOutcome> {
    return await this.locks.run(request.sessionId, async () => await this.switchLocked(request))
  }

  private async switchLocked(request: ExecutorSwitchRequest): Promise<ExecutorSwitchOutcome> {
    const { sessionId, to } = request
    if (sessionId === '') throw new ExecutorError('bad-request', 'sessionId must not be empty', 400)
    const plan = await this.preview(sessionId, to)
    if (plan.currentMode === to) {
      return { mode: to, restartRequired: false, plannedCancellations: [] }
    }

    if (to === 'server') {
      // The client owns the write handle in local mode. Releasing it must
      // happen before the record says server or another process can race it.
      if (request.releaseLocal === undefined) {
        throw new ExecutorError(
          'mode-switch/release-required',
          `switching "${sessionId}" to server requires releasing the local turn first`,
          400,
        )
      }
      try {
        await request.releaseLocal()
      } catch (error) {
        throw new ExecutorLocalReleaseError(error)
      }
      const result = await this.rpc.request<unknown>(RW_METHODS.executorSwitch, { sessionId, to })
      return this.outcome(result, 'server', plan.activeTurns)
    }

    // server → local
    if (plan.requiresConfirmation && request.confirmOtherTurns !== true) {
      throw new ExecutorSwitchConfirmRequiredError(plan.activeTurns)
    }
    const result = await this.rpc.request<unknown>(RW_METHODS.executorSwitch, {
      sessionId,
      to,
      confirmOtherTurns: request.confirmOtherTurns === true,
    })
    const outcome = this.outcome(result, 'local', plan.activeTurns)
    if (outcome.restartRequired) {
      if (request.restartProfile === undefined) {
        throw new ExecutorError(
          'executor-switch-restart-required',
          `switching "${sessionId}" to local requires a profile restart, but no restart port was provided`,
          500,
        )
      }
      try {
        await request.restartProfile()
      } catch (error) {
        throw new ExecutorRestartFailedError(error)
      }
    }
    return outcome
  }

  /** Normalize the server's `executor/switch` answer. */
  private outcome(raw: unknown, expected: ExecutorMode, activeTurns: readonly ExecutorActiveTurn[]): ExecutorSwitchOutcome {
    if (raw === null || typeof raw !== 'object') {
      throw new ExecutorError('executor-switch-invalid', `executor/switch returned no result for "${expected}"`, 500)
    }
    const value = raw as { mode?: unknown; restartRequired?: unknown }
    const mode = value.mode === 'server' || value.mode === 'local' ? value.mode : expected
    if (mode !== expected) {
      throw new ExecutorError(
        'executor-switch-invalid',
        `executor/switch answered mode "${mode}" while "${expected}" was requested`,
        500,
      )
    }
    const planned = activeTurns
      .filter(turn => turn.running)
      .map(turn => turn.sessionId)
    return {
      mode,
      restartRequired: value.restartRequired === true,
      plannedCancellations: planned,
    }
  }

  /**
   * Drop a stale local-mode owner record before taking over. The official
   * flock is still the only write authority; this only clears the plugin's
   * intent record (protocol `executor/release`).
   */
  async release(sessionId: string): Promise<void> {
    await this.rpc.request<unknown>(RW_METHODS.executorRelease, { sessionId })
  }

  /** Read the record and throw the protocol's occupancy errors, for UI checks. */
  async assertLocalWritable(
    sessionId: string,
    self: { clientId: string; instanceId: string },
  ): Promise<ExecutorRecord | null> {
    const record = await this.get(sessionId)
    if (record?.mode === 'server') throw new ExecutorModeConflictError(record.mode)
    if (record !== null && executorHeldByOther(record, self, this.now())) throw new ExecutorHeldError(record.owner)
    return record
  }
}
