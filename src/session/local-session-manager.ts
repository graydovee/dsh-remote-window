/**
 * Process-local ownership of local-mode Agents and their executor switches.
 *
 * Local mode has one writer per session: the client Agent the plugin created or
 * cold-resumed. Keeping that `AgentHandle` in one place is what makes the
 * local→server switch safe (`release` = cancel → idle → flush → close) and what
 * prevents two panel opens from resuming the same session twice.
 *
 * This manager is deliberately free of Cordis/Node imports: open/create, anchor
 * paths, catalog wait/reveal, profile restart and the P1 executor RPC are all
 * injected. It is the seam dev-core/dev-ui wire to the host plugin; the wire
 * contract is `doc/refactor-v1-protocol.md` §5.4 and §16.5/§16.10.
 */
import {
  ExecutorLocalReleaseError,
  ServerExecutor,
  type ExecutorMode,
  type ExecutorSwitchOutcome,
} from './executor.ts'
import { createLocalSession, type LocalSessionCreated, type LocalSessionPorts } from './local-session.ts'
import { releaseLocalTurn, type LocalAgentHandleLike, type LocalTurnReleaseResult } from './local-turn.ts'

/** One local session's agent, as owned by this process. */
export interface ManagedLocalSession {
  readonly sessionId: string
  readonly workspaceId: string
  readonly handle: LocalAgentHandleLike
  readonly preset: string
}

/** Dependencies of the manager; every operation is injected. */
export interface LocalSessionManagerPorts {
  /** Bind one workspace to its private anchor and return the path. */
  anchorForWorkspace(workspaceId: string): Promise<string>
  /** Ports for a *new* local session (preferred server-mint or client fallback). */
  createPorts: LocalSessionPorts
  /** Cold-open an existing stored session on the client (returns the owned handle). */
  openAgent(input: { sessionId: string; workspaceId: string; cwd: string; agentPreset: string; signal?: AbortSignal }): Promise<LocalAgentHandleLike>
  /** Agent preset id for this connection/target. */
  presetFor(workspaceId: string): string
  /** Durability barrier for the routing writer (sessionPersistence.flush). */
  flush?: () => Promise<void>
  /** Idle/dispose budget; protocol §6.3 uses 3 s. */
  releaseTimeoutMs?: number
  /** Restart the profile server for an unmanaged server→local switch. */
  restartProfile?: () => Promise<void>
}

/** The result of switching a session's executor. */
export interface ManagedSwitchResult extends ExecutorSwitchOutcome {
  /** The handle owned after a switch to local (freshly resumed by the caller). */
  readonly session?: ManagedLocalSession
}

/**
 * Own the client-side local agents of one target/profile.
 *
 * One instance per connected target. It never writes the server log itself;
 * that stays with the routing persistence.
 */
export class LocalSessionManager {
  private readonly managed = new Map<string, ManagedLocalSession>()
  /** Serialize open/create per session so two callers cannot double-resume. */
  private readonly opening = new Map<string, Promise<ManagedLocalSession>>()

  constructor(
    private readonly executor: ServerExecutor,
    private readonly ports: LocalSessionManagerPorts,
  ) {}

  /** Sessions whose agent this process currently owns. */
  list(): readonly ManagedLocalSession[] {
    return [...this.managed.values()]
  }

  /** Whether this process owns the write handle of one session. */
  owns(sessionId: string): boolean {
    return this.managed.has(sessionId)
  }

  /** Resolve the owned handle, if any. */
  get(sessionId: string): ManagedLocalSession | undefined {
    return this.managed.get(sessionId)
  }

  /**
   * Create a new local-mode session and retain its handle.
   * @param input - workspace id and optional cancellation.
   * @returns the created session and its owned handle.
   */
  async create(input: { workspaceId: string; signal?: AbortSignal }): Promise<ManagedLocalSession> {
    const preset = this.ports.presetFor(input.workspaceId)
    const created: LocalSessionCreated = await createLocalSession(this.ports.createPorts, {
      workspaceId: input.workspaceId,
      agentPreset: preset,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    const managed: ManagedLocalSession = {
      sessionId: created.sessionId,
      workspaceId: input.workspaceId,
      handle: created.handle,
      preset,
    }
    this.managed.set(created.sessionId, managed)
    return managed
  }

  /**
   * Cold-open a stored server session on the client and retain its handle.
   *
   * The caller must have selected local mode for this session (executor record
   * `local`); the guard is the server's `persist/open(write)` check, so this
   * method only adds single-flight ownership.
   * @param input - stored session id and workspace binding.
   */
  async open(input: { sessionId: string; workspaceId: string; signal?: AbortSignal }): Promise<ManagedLocalSession> {
    const existing = this.managed.get(input.sessionId)
    if (existing !== undefined) return existing
    const inflight = this.opening.get(input.sessionId)
    if (inflight !== undefined) return await inflight
    const attempt = (async (): Promise<ManagedLocalSession> => {
      const preset = this.ports.presetFor(input.workspaceId)
      const cwd = await this.ports.anchorForWorkspace(input.workspaceId)
      const handle = await this.ports.openAgent({
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        cwd,
        agentPreset: preset,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      })
      const managed: ManagedLocalSession = { sessionId: input.sessionId, workspaceId: input.workspaceId, handle, preset }
      this.managed.set(input.sessionId, managed)
      return managed
    })().finally(() => { this.opening.delete(input.sessionId) })
    this.opening.set(input.sessionId, attempt)
    return await attempt
  }

  /**
   * Release one local agent: cancel its turn, wait for idle/flush, close the
   * official handle. Idempotent; a missing session is a no-op.
   * @param sessionId - stored session id.
   * @param options - optional release overrides.
   */
  async release(sessionId: string, options: { flush?: () => Promise<void>; timeoutMs?: number } = {}): Promise<LocalTurnReleaseResult> {
    const managed = this.managed.get(sessionId)
    if (managed === undefined) return { timedOut: false, alreadyReleased: true }
    const flush = options.flush ?? this.ports.flush
    const timeoutMs = options.timeoutMs ?? this.ports.releaseTimeoutMs
    const result = await releaseLocalTurn(managed.handle, {
      ...(flush === undefined ? {} : { flush }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    })
    this.managed.delete(sessionId)
    return result
  }

  /** Release every owned local agent (disconnect / plugin dispose). */
  async releaseAll(options: { flush?: () => Promise<void>; timeoutMs?: number } = {}): Promise<readonly string[]> {
    const ids = [...this.managed.keys()]
    const failures: string[] = []
    for (const id of ids) {
      try {
        await this.release(id, options)
      } catch {
        // Keep releasing the rest: one wedged agent must not strand the others'
        // write locks on a profile teardown.
        failures.push(id)
      }
    }
    if (failures.length > 0) {
      throw new Error(`could not release local session(s): ${failures.join(', ')}`)
    }
    return ids
  }

  /**
   * Switch one session local → server.
   *
   * The record flips only after the local handle is released; a release failure
   * aborts the switch and leaves the session local (protocol §5.4).
   */
  async switchToServer(sessionId: string, options: { confirmOtherTurns?: boolean } = {}): Promise<ManagedSwitchResult> {
    const outcome = await this.executor.switchTo({
      sessionId,
      to: 'server',
      ...(options.confirmOtherTurns === undefined ? {} : { confirmOtherTurns: options.confirmOtherTurns }),
      releaseLocal: async () => { await this.release(sessionId) },
    })
    return outcome
  }

  /**
   * Switch one session server → local. The server either hands off its managed
   * handle (`restartRequired:false`) or asks for a profile restart (unmanaged
   * live agent); the caller then opens the session locally with {@link open}.
   */
  async switchToLocal(sessionId: string, options: { confirmOtherTurns?: boolean } = {}): Promise<ManagedSwitchResult> {
    const restartProfile = this.ports.restartProfile
    return await this.executor.switchTo({
      sessionId,
      to: 'local',
      ...(options.confirmOtherTurns === undefined ? {} : { confirmOtherTurns: options.confirmOtherTurns }),
      ...(restartProfile === undefined ? {} : { restartProfile }),
    })
  }

  /** The current executor mode as the server reports it (for UI badges). */
  async modeOf(sessionId: string): Promise<ExecutorMode> {
    return (await this.executor.get(sessionId))?.mode ?? 'server'
  }
}

/** Re-export the error so callers can map a failed switch without importing three modules. */
export { ExecutorLocalReleaseError }
