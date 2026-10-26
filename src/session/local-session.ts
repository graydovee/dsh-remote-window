/**
 * Local-mode "new session" orchestration (architecture §9, protocol §16.10).
 *
 * A new server session in local mode must be created **server-authoritatively**
 * and then opened by the client agent:
 *
 * 1. client sidebar asks P1 `session/create { workspaceId, executor:'local' }`
 *    for a blank server session (the server plugin records the executor and
 *    materializes the official header);
 * 2. the client ensures its private anchor and resumes/creates the client-side
 *    agent on that **same** session id (the routing persistence writes the
 *    server log through P1 `persist/*`, never the local sessions root);
 * 3. the client waits (≤4 s per §16.10) until the client-side session catalog
 *    contains the summary and only then reveals the official conversation; the
 *    live-session catalog is what `uiWorkspace.openSession(id)` resolves
 *    against, so revealing earlier ends in `unknown session`.
 *
 * The fallback path (older/partial server without `session/create` support)
 * creates the identity on the client first and records the executor through
 * `executor/assign`; the routing's `persist/create { executor:'local' }` then
 * upserts the same record. Both paths keep the session id stable and never
 * produce a local workspace row or a client session log.
 *
 * This module is pure orchestration: RPC, agent factory, catalog wait and
 * reveal are all injected ports.
 */
import type { LocalAgentHandleLike } from './local-turn.ts'

/** How the blank session identity was created. */
export type LocalSessionOrigin = 'server' | 'client'

/** Stable failure for local-session creation. */
export class LocalSessionError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message)
    this.name = 'LocalSessionError'
  }
}

/** The injected capabilities of one local-mode session creation. */
export interface LocalSessionPorts {
  /**
   * P1 `session/create { workspaceId, executor:'local' }`. An unsupported
   * server throws a typed `bad-request`/`not-found`; the caller then falls back
   * to the client-created identity.
   */
  createBlankOnServer(input: { workspaceId: string; sessionId: string; signal?: AbortSignal }): Promise<{
    sessionId: string
    /**
     * `true` when the server also stored a durable blank session (so the client
     * resumes it); `false`/omitted for the v1 local mint, which only records the
     * executor, so the client must create the agent/log itself.
     */
    durable?: boolean
  }>
  /** Create the private anchor directory and return its absolute path. */
  ensureAnchor(workspaceId: string): Promise<string>
  /** Resume the stored blank session on the client (preferred path). */
  resumeAgent?(input: { sessionId: string; workspaceId: string; cwd: string; agentPreset: string; signal?: AbortSignal }): Promise<LocalAgentHandleLike>
  /** Create the session on the client (fallback path, routing does `persist/create`). */
  createAgent?(input: { sessionId: string; workspaceId: string; cwd: string; agentPreset: string; blank?: boolean; signal?: AbortSignal }): Promise<LocalAgentHandleLike>
  /** Record the executor before the fallback client create (older server). */
  assignExecutor?(input: { sessionId: string; signal?: AbortSignal }): Promise<void>
  /**
   * Wait until the client's session catalog contains this id
   * (`api-session/added`). A timeout maps to `session-reveal-timeout`.
   */
  waitForCatalog?(sessionId: string, options: { timeoutMs: number; signal?: AbortSignal }): Promise<void>
  /** Reveal the official conversation for the now-catalogued session. */
  reveal(sessionId: string): void
}

/** Options for one local-mode new session. */
export interface CreateLocalSessionOptions {
  readonly workspaceId: string
  /** Target preset id (`remote:<target>` for this client's realm). */
  readonly agentPreset: string
  /** Exact identity to use when the server mint path is unavailable. */
  readonly sessionId?: string
  /** Wait budget for the client catalog; §16.10 fixes ≤4 s. */
  readonly revealTimeoutMs?: number
  readonly signal?: AbortSignal
}

/** A created local-mode session. */
export interface LocalSessionCreated {
  readonly sessionId: string
  readonly origin: LocalSessionOrigin
  readonly cwd: string
  readonly handle: LocalAgentHandleLike
}

/** Code used when the client catalog never observed the new session. */
export const REVEAL_TIMEOUT_CODE = 'session-reveal-timeout'

/** Default reveal wait (protocol §16.10). */
export const REVEAL_TIMEOUT_MS = 4_000

/** Mint a fresh client-side session identity. */
function mintSessionId(): string {
  const globalCrypto = globalThis.crypto as { randomUUID?: () => string } | undefined
  const uuid = globalCrypto?.randomUUID?.()
  if (uuid === undefined) throw new LocalSessionError('session-create-failed', 'no crypto.randomUUID available to mint a session id')
  return `session-${uuid}`
}

/** Whether an error says the P1 server does not implement `session/create`. */
function isUnsupportedCreate(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return code === 'bad-request' || code === 'gateway/bad-request' || code === 'not-found' || code === 'method-not-found'
}

/** Bound a promise, mapping a timeout to a typed error. */
async function waitFor<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal | undefined, sessionId: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new LocalSessionError(
        REVEAL_TIMEOUT_CODE,
        `session "${sessionId}" was not visible in the client catalog within ${timeoutMs} ms`,
        { sessionId, timeoutMs },
      ))
    }, timeoutMs)
  })
  try {
    return await (signal === undefined ? Promise.race([promise, timeout]) : Promise.race([promise, timeout, aborted(signal)]))
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    void promise.catch(() => {})
  }
}

/** Reject with the signal's reason when the caller cancels. */
function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

/**
 * Create a local-mode session against one connected target.
 *
 * @param ports - injected P1/agent/catalog capabilities.
 * @param options - workspace, preset and reveal budget.
 * @returns the session identity and the client agent handle.
 * @throws {@link LocalSessionError} when the session could not be created or
 *   revealed; in the reveal-failure case the caller still owns `handle` only
 *   when the error carries one, so create failures never leak it silently.
 */
export async function createLocalSession(
  ports: LocalSessionPorts,
  options: CreateLocalSessionOptions,
): Promise<LocalSessionCreated> {
  if (options.workspaceId.trim() === '') {
    throw new LocalSessionError('bad-request', 'workspaceId must not be empty')
  }
  if (options.agentPreset.trim() === '') {
    throw new LocalSessionError('bad-request', 'agentPreset must not be empty')
  }
  options.signal?.throwIfAborted()

  let sessionId = options.sessionId ?? mintSessionId()
  let origin: LocalSessionOrigin = 'client'
  let durableServerBlank = false
  try {
    const created = await ports.createBlankOnServer({
      workspaceId: options.workspaceId,
      sessionId,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    if (typeof created.sessionId === 'string' && created.sessionId !== '') sessionId = created.sessionId
    origin = 'server'
    durableServerBlank = created.durable === true
  } catch (error) {
    if (!isUnsupportedCreate(error)) throw error
    origin = 'client'
  }

  const cwd = await ports.ensureAnchor(options.workspaceId)

  let handle: LocalAgentHandleLike
  if (durableServerBlank) {
    if (ports.resumeAgent === undefined) {
      throw new LocalSessionError('session-create-failed', 'local session creation needs a resume port for a server-created blank session')
    }
    handle = await ports.resumeAgent({
      sessionId,
      workspaceId: options.workspaceId,
      cwd,
      agentPreset: options.agentPreset,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } else {
    if (ports.createAgent === undefined) {
      throw new LocalSessionError('session-create-failed', 'local session creation needs a client agent port for the fallback path')
    }
    // A server-minted id already carries the executor record; only the
    // client-minted fallback needs the explicit assign.
    if (origin === 'client' && ports.assignExecutor !== undefined) {
      await ports.assignExecutor({
        sessionId,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
    }
    handle = await ports.createAgent({
      sessionId,
      workspaceId: options.workspaceId,
      cwd,
      agentPreset: options.agentPreset,
      // v1 local mode: a new session is a blank draft; the official composer
      // creates the first turn (no synthetic seed turn).
      blank: true,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  }

  if (ports.waitForCatalog !== undefined) {
    try {
      await waitFor(
        ports.waitForCatalog(sessionId, {
          timeoutMs: options.revealTimeoutMs ?? REVEAL_TIMEOUT_MS,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        }),
        // waitForCatalog owns its own budget; the outer guard is a backstop for
        // a port that never resolves. Give it the same budget plus one second.
        (options.revealTimeoutMs ?? REVEAL_TIMEOUT_MS) + 250,
        options.signal,
        sessionId,
      )
    } catch (error) {
      if (error instanceof LocalSessionError) {
        // The agent exists; the caller must dispose it rather than leak a
        // write handle when the reveal never succeeds.
        throw Object.assign(error, { handle }) as LocalSessionError & { handle: LocalAgentHandleLike }
      }
      // A port may reject with its own timeout/cancel error; never lose the
      // handle we already created.
      const message = error instanceof Error ? error.message : String(error)
      throw Object.assign(new LocalSessionError(REVEAL_TIMEOUT_CODE, message, { sessionId }), { handle })
    }
  }
  ports.reveal(sessionId)
  return { sessionId, origin, cwd, handle }
}
