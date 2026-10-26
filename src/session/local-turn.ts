/**
 * Cancel a client-side (local-mode) turn and release its server write handle.
 *
 * This is the client half of a `local → server` executor switch (protocol
 * §5.4): the local agent must be stopped, its loop idle, the routing writer
 * flushed, and the remote `SessionHandle` closed before the executor record
 * flips — otherwise the server-mode UI could open the same JSONL artifact and
 * the official flock would reject it as `session/writer-held` (or, worse, a
 * not-yet-flushed tail would be lost on profile restart).
 *
 * The official `AgentHandle.dispose()` already performs
 * `cancel(disposed) → whenIdle() → handle.close()`; this helper adds the
 * explicit user-cancel (so the durable turn closes with `reason: user` rather
 * than a disposal reason), a bounded idle wait with a timeout that is reported
 * instead of swallowed, and an explicit flush barrier (the routing persistence
 * batches live events, so `close()` alone is the durability barrier, but the
 * extra flush makes a slow remote channel visible before the record flips).
 *
 * Nothing here talks to the network: the handle and the flush port are
 * injected.
 */

/** Why a local turn could not be released. */
export class LocalTurnReleaseError extends Error {
  constructor(
    readonly code: 'mode-switch/cancel-failed' | 'mode-switch/release-timeout',
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'LocalTurnReleaseError'
  }
}

/** The subset of the official `Agent` this helper drives. */
export interface LocalAgentLike {
  readonly id: string
  cancel(cause: { kind: 'user' }, options: { keepInbox: true }): void
  whenIdle(): Promise<void>
}

/** The subset of the official `AgentHandle` this helper owns. */
export interface LocalAgentHandleLike {
  readonly agent: LocalAgentLike
  dispose(): Promise<void>
}

/** Options for {@link releaseLocalTurn}. */
export interface ReleaseLocalTurnOptions {
  /** Durability barrier for the routing writer (e.g. `sessionPersistence.flush`). */
  flush?: () => Promise<void>
  /** How long idle/dispose may take before the helper reports a timeout. */
  timeoutMs?: number
}

/** Handles released by this process; avoids mutating the official handle. */
const RELEASED = new WeakSet<LocalAgentHandleLike>()

/** Result of one release attempt. */
export interface LocalTurnReleaseResult {
  /** The idle wait exceeded `timeoutMs`; dispose still completed afterwards. */
  readonly timedOut: boolean
  /** A previous call already released this handle. */
  readonly alreadyReleased: boolean
  /**
   * The user-cancel call itself threw (loop already shutting down). Non-fatal:
   * `dispose()` performs its own disposal cancel, so the flock is still released
   * and the caller may log this as a diagnostic.
   */
  readonly cancelError?: string
}

/** Raised internally to distinguish a timeout from a failed operation. */
class TimeoutSentinel extends Error {}

/**
 * Race a promise against a deadline.
 * @param promise - the operation to bound.
 * @param timeoutMs - deadline in milliseconds.
 * @param label - diagnostic label used by the timeout error.
 * @returns the operation's value.
 * @throws {@link TimeoutSentinel} when the deadline wins.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new TimeoutSentinel(`${label} timed out after ${timeoutMs} ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    // The losing promise may still reject later; contain it so it cannot turn
    // into an unhandled rejection after the timeout already resolved the race.
    void promise.catch(() => {})
  }
}

/**
 * Stop a local turn and release its write handle.
 *
 * Idempotent per handle instance: a second call returns
 * `{ timedOut: false, alreadyReleased: true }` instead of disposing twice.
 *
 * @param handle - the official `AgentHandle` the plugin owns for this session.
 * @param options - flush port and idle/dispose deadline.
 * @returns whether the idle wait timed out.
 * @throws {@link LocalTurnReleaseError} when the turn/handle could not be
 *   released; callers must not flip the executor record in that case.
 */
export async function releaseLocalTurn(
  handle: LocalAgentHandleLike,
  options: ReleaseLocalTurnOptions = {},
): Promise<LocalTurnReleaseResult> {
  const timeoutMs = options.timeoutMs ?? 3_000
  if (RELEASED.has(handle)) return { timedOut: false, alreadyReleased: true }
  RELEASED.add(handle)

  const failures: string[] = []
  let cancelError: string | undefined
  let timedOut = false

  // 1. Ask the loop to stop the current turn like the user's cancel button
  //    would. A rejected cancel (loop already shutting down) must not prevent
  //    the close below: the handle remains the only capability that frees the
  //    official write lock.
  try {
    handle.agent.cancel({ kind: 'user' }, { keepInbox: true })
  } catch (error) {
    cancelError = error instanceof Error ? error.message : String(error)
  }

  // 2. Wait for the turn's closing events to be committed. Timing out is
  //    reported, not fatal: dispose below still waits for idle and closes the
  //    handle, which is what actually releases the flock.
  try {
    await withTimeout(handle.agent.whenIdle(), timeoutMs, `session "${handle.agent.id}" idle wait`)
  } catch (error) {
    if (error instanceof TimeoutSentinel) timedOut = true
    else failures.push(`idle: ${error instanceof Error ? error.message : String(error)}`)
  }

  // 3. Durability barrier for events the routing writer still buffers.
  if (options.flush !== undefined) {
    try {
      await options.flush()
    } catch (error) {
      failures.push(`flush: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // 4. Dispose releases the official write handle (and thus the kernel flock).
  try {
    await withTimeout(handle.dispose(), timeoutMs, `session "${handle.agent.id}" dispose`)
  } catch (error) {
    if (error instanceof TimeoutSentinel) {
      throw new LocalTurnReleaseError(
        'mode-switch/release-timeout',
        `session "${handle.agent.id}" dispose did not release the write handle within ${timeoutMs} ms; the session stays local`,
        error,
      )
    }
    failures.push(`dispose: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (failures.length > 0) {
    throw new LocalTurnReleaseError(
      'mode-switch/cancel-failed',
      `session "${handle.agent.id}" could not be released: ${failures.join('; ')}`,
      failures,
    )
  }
  return {
    timedOut,
    alreadyReleased: false,
    ...(cancelError === undefined ? {} : { cancelError }),
  }
}

/**
 * Bind {@link releaseLocalTurn} into the `LocalTurnReleaser` shape the executor
 * state machine takes.
 * @param handle - local agent handle to release.
 * @param options - flush port and deadline.
 * @returns a releaser that throws when the switch must be aborted.
 */
export function localTurnReleaser(
  handle: LocalAgentHandleLike,
  options: ReleaseLocalTurnOptions = {},
): () => Promise<void> {
  return async () => {
    await releaseLocalTurn(handle, options)
  }
}
