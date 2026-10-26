/**
 * Host-side binding for local-mode session creation/opening.
 *
 * This is the factory dev-core's P3 routes import instead of copying the
 * orchestration: it binds the generic ports in `local-session.ts` /
 * `local-session-manager.ts` to the real host services
 * (`ctx.agents`/`ctx.agentPresets`/anchors/P1 RPC) while leaving the
 * **client-side** catalog wait + reveal to the caller (the browser's session
 * catalog is the only place `uiWorkspace.openSession(id)` resolves against;
 * the host cannot observe that catalog).
 *
 * Routes should therefore return `{ sessionId, workspaceId, executor:'local',
 * revealed:false }` unless they supply `waitForCatalog` + `reveal` ports; dev-ui
 * polls its own `sessions` catalog (≤4 s, protocol §16.10) and reveals after.
 *
 * The generic fallback path is intentional for v1: the server plugin's
 * `session/create { executor:'local' }` currently creates an official
 * **server-side** agent (unmanaged), so local sessions are created on the client
 * and stamped with `executor/assign`. `persist/create` then upserts the same
 * record through the routing persistence.
 */
import type { Context } from '@deepseek-ai/cordis'
import { AnchorRegistry, anchorPathFor, anchorRoot, ensureAnchor, removeTargetAnchors, type AnchorRoute } from './anchors.ts'
import { ExecutorHeldError, ExecutorModeConflictError, ServerExecutor, isOwnerFresh, type ExecutorRpc, type ExecutorRecord } from './executor.ts'
import {
  LocalSessionError,
  createLocalSession,
  type LocalSessionCreated,
  type LocalSessionPorts,
} from './local-session.ts'
import { LocalSessionManager, type ManagedLocalSession } from './local-session-manager.ts'
import { openRemoteSession, resumeRemoteSession, type OpenedRemoteSession } from './open.ts'
import type { RemoteContextTarget } from './remote-context.ts'
import { remotePresetId } from '../preset/world.ts'
import { RW_METHODS } from '../protocol.ts'

/** Everything the host binding needs; all lifetimes belong to the caller. */
export interface HostLocalRuntimeDeps {
  /** Root context carrying `agents`/`agentPresets`/`sessionPersistence`. */
  readonly ctx: Context
  /** Target-bound P1 RPC (dev-core's plugin client facade). */
  readonly rpc: ExecutorRpc
  readonly targetId: string
  /** Stored target identity for the model-facing remote context. */
  readonly target?: RemoteContextTarget | undefined
  /** Server-real workspace path, learned from P1; used by the remote context. */
  readonly remotePathForWorkspace?: ((workspaceId: string) => string | undefined) | undefined
  readonly clientId: string
  /** Client instance identity (profile lease); enables stale-owner takeover. */
  readonly instanceId?: string
  readonly env?: Record<string, string | undefined>
  /** Preset id recorded in the session log; defaults to `remote:<targetId>`. */
  readonly presetId?: string
  /** Durability barrier (routing writer); defaults to the injected persistence. */
  readonly flush?: () => Promise<void>
  readonly releaseTimeoutMs?: number
  /** dev-core's profile restart, required for the unmanaged server→local fallback. */
  readonly restartProfile?: () => Promise<void>
  /** Optional browser-catalog bridge; omission means the route reveals later. */
  readonly waitForCatalog?: (sessionId: string, options: { timeoutMs: number; signal?: AbortSignal }) => Promise<void>
  readonly reveal?: (sessionId: string) => void
  /** Reveal budget; protocol §16.10 fixes 4 s (injectable for tests). */
  readonly revealTimeoutMs?: number
}

/** A created/opened local session plus whether the conversation was revealed. */
export interface HostLocalSessionResult {
  readonly sessionId: string
  readonly workspaceId: string
  readonly executor: 'local'
  readonly revealed: boolean
  readonly session: ManagedLocalSession
}

/** The host-side local-mode facade one connected target exposes. */
export interface HostLocalRuntime {
  readonly executor: ServerExecutor
  readonly manager: LocalSessionManager
  readonly ports: LocalSessionPorts
  readonly anchorsRoot: string
  /** Reverse map for the routing facade (`routeForCwd`/`stubForWorkspace`). */
  readonly anchors: AnchorRegistry
  routeForCwd(cwd: string | undefined): AnchorRoute | undefined
  anchorForWorkspace(workspaceId: string): string | undefined
  create(input: { workspaceId: string; signal?: AbortSignal }): Promise<HostLocalSessionResult>
  open(input: { workspaceId: string; sessionId: string; signal?: AbortSignal }): Promise<HostLocalSessionResult>
  release(sessionId: string): Promise<void>
  /** Release every owned agent and remove this target's private anchors. */
  dispose(): Promise<void>
}

/** Map an unmanaged official agent to the frozen `agent-compose-failed` code. */
function unmanaged(opened: OpenedRemoteSession, sessionId: string): LocalSessionError {
  return new LocalSessionError(
    'agent-compose-failed',
    opened.unmanagedReason ?? `session "${sessionId}" is already live and its AgentHandle is not owned by this plugin`,
    { sessionId, managed: false },
  )
}

/**
 * Bind the generic local-session ports to host services.
 * @param deps - host context, target-bound RPC, client id and optional ports.
 * @returns ports for {@link createLocalSession} (or the runtime below).
 */
export function createHostLocalSessionPorts(deps: HostLocalRuntimeDeps): LocalSessionPorts {
  const anchorsRoot = anchorRoot({ clientId: deps.clientId, ...(deps.env === undefined ? {} : { env: deps.env }) })
  const anchorOptions = { clientId: deps.clientId, ...(deps.env === undefined ? {} : { env: deps.env }) }
  const preset = deps.presetId ?? remotePresetId(deps.targetId)
  return {
    // M2 server: `session/create { executor:'local' }` mints the id and records
    // the local executor **without** creating an agent or a durable session, so
    // the client still owns the log creation (`persist/create`) and the handle.
    // An older server rejects it; the caller then falls back to client mint +
    // `executor/assign`.
    createBlankOnServer: async ({ workspaceId, sessionId, signal }) => {
      const created = await deps.rpc.request<{ sessionId?: unknown; executor?: unknown }>(
        RW_METHODS.sessionCreate,
        { workspaceId, sessionId, executor: 'local' },
        signal,
      )
      const minted = typeof created?.sessionId === 'string' && created.sessionId !== '' ? created.sessionId : sessionId
      return { sessionId: minted, durable: false }
    },
    ensureAnchor: async (workspaceId: string) =>
      await ensureAnchor(anchorsRoot, anchorPathFor(anchorOptions, deps.targetId, workspaceId)),
    assignExecutor: async ({ sessionId, signal }) => {
      await deps.rpc.request(RW_METHODS.executorAssign, { sessionId, mode: 'local' }, signal)
    },
    createAgent: async ({ sessionId, workspaceId, cwd, agentPreset, blank, signal }) => {
      const opened = await openRemoteSession(deps.ctx, {
        targetId: deps.targetId,
        path: cwd,
        sessionId,
        agentPreset: agentPreset === '' ? preset : agentPreset,
        ...(blank === true ? { seed: false } : {}),
        ...(signal === undefined ? {} : { signal }),
        ...(deps.target === undefined ? {} : { remoteContext: { target: deps.target, ...(deps.remotePathForWorkspace?.(workspaceId) === undefined ? {} : { remotePath: deps.remotePathForWorkspace(workspaceId) as string }) } }),
      })
      if (!opened.managed || opened.handle === undefined) throw unmanaged(opened, sessionId)
      return opened.handle
    },
    resumeAgent: async ({ sessionId, workspaceId, cwd, agentPreset, signal }) => {
      const opened = await resumeRemoteSession(deps.ctx, {
        targetId: deps.targetId,
        sessionId,
        agentPreset: agentPreset === '' ? preset : agentPreset,
        ...(signal === undefined ? {} : { signal }),
        ...(deps.target === undefined ? {} : { remoteContext: { target: deps.target, ...(deps.remotePathForWorkspace?.(workspaceId) === undefined ? {} : { remotePath: deps.remotePathForWorkspace(workspaceId) as string }) } }),
      })
      // A cold resume re-anchors the header on the stub; `cwd` is the expected
      // anchor the caller just created (kept in the signature for diagnostics).
      void cwd
      if (!opened.managed || opened.handle === undefined) throw unmanaged(opened, sessionId)
      return opened.handle
    },
    ...(deps.waitForCatalog === undefined ? {} : { waitForCatalog: deps.waitForCatalog }),
    reveal: deps.reveal ?? (() => {}),
  }
}

/** Default reveal wait (protocol §16.10). */
const REVEAL_BUDGET_MS = 4_000

/** Run the optional catalog wait + reveal; returns whether a reveal ran. */
async function revealIfConfigured(
  deps: HostLocalRuntimeDeps,
  sessionId: string,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  if (deps.waitForCatalog === undefined) return false
  const timeoutMs = deps.revealTimeoutMs ?? REVEAL_BUDGET_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      deps.waitForCatalog(sessionId, { timeoutMs, ...(signal === undefined ? {} : { signal }) }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new LocalSessionError(
            'session-reveal-timeout',
            `session "${sessionId}" was not visible in the client catalog within ${timeoutMs} ms`,
            { sessionId, timeoutMs },
          ))
        }, timeoutMs + 250)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  deps.reveal?.(sessionId)
  return true
}

/**
 * Prepare the session's executor record for a local write open.
 *
 * After a client restart the durable record still names the previous client
 * instance, and the P1 `persist/open(write)` guard would reject it with
 * `executor-held`. The protocol allows a stale owner (>20 s) to be taken over
 * with `executor/assign`; a session still recorded on `server` must instead be
 * switched, so it stays a hard conflict here.
 * @param executor - target-bound executor RPC.
 * @param deps - client/instance identity.
 * @param sessionId - stored session id.
 */
async function ensureLocalExecutorRecord(
  executor: ServerExecutor,
  deps: HostLocalRuntimeDeps,
  sessionId: string,
): Promise<ExecutorRecord> {
  let record: ExecutorRecord | null
  try {
    record = await executor.get(sessionId)
  } catch (error) {
    // A partial server without executor/get: leave the write-open guard to
    // decide rather than blocking local mode here.
    if ((error as { code?: unknown })?.code === 'bad-request' || (error as { code?: unknown })?.code === 'not-found') {
      return { version: 1, sessionId, mode: 'local', updatedAt: new Date().toISOString() }
    }
    throw error
  }
  if (record?.mode === 'server') throw new ExecutorModeConflictError('server')
  const owner = record?.owner
  const sameInstance = owner !== undefined && deps.instanceId !== undefined && owner.instanceId === deps.instanceId
  const sameClient = owner !== undefined && owner.clientId === deps.clientId
  if (record?.mode === 'local' && owner !== undefined && sameClient && (sameInstance || isOwnerFresh(record))) {
    // A fresh owner of this same client is the live local handle (e.g. another
    // panel opened it); do not rewrite the record.
    return record
  }
  if (record?.mode === 'local' && owner !== undefined && !sameClient && isOwnerFresh(record)) {
    throw new ExecutorHeldError(owner)
  }
  return await executor.assign(sessionId, 'local')
}

/**
 * Build the host-side local-mode runtime for one connected target.
 * @param deps - host context, target-bound RPC, client id and optional ports.
 * @returns create/open/release operations sharing one owned-handle table.
 */
export function createHostLocalRuntime(deps: HostLocalRuntimeDeps): HostLocalRuntime {
  const anchorsRoot = anchorRoot({ clientId: deps.clientId, ...(deps.env === undefined ? {} : { env: deps.env }) })
  // The runtime reveals exactly once, after the manager returns, so its port
  // copy must not also run the wait/reveal inside `createLocalSession`.
  // `createHostLocalSessionPorts` (exported separately) keeps the passthrough
  // for callers that drive `createLocalSession` directly.
  const anchors = new AnchorRegistry()
  const basePorts = createHostLocalSessionPorts({ ...deps, waitForCatalog: undefined, reveal: () => {} })
  const ports: LocalSessionPorts = {
    ...basePorts,
    ensureAnchor: async (workspaceId: string) => {
      const path = await basePorts.ensureAnchor(workspaceId)
      anchors.register({ targetId: deps.targetId, workspaceId, path })
      return path
    },
  }
  const executor = new ServerExecutor(deps.rpc)
  const preset = deps.presetId ?? remotePresetId(deps.targetId)
  const manager = new LocalSessionManager(executor, {
    anchorForWorkspace: async (workspaceId: string) => await ports.ensureAnchor(workspaceId),
    createPorts: ports,
    openAgent: async ({ sessionId, workspaceId, cwd, agentPreset, signal }) => {
      void workspaceId
      if (ports.resumeAgent === undefined) throw new LocalSessionError('agent-compose-failed', 'local open has no resume port')
      return await ports.resumeAgent({ sessionId, workspaceId, cwd, agentPreset, ...(signal === undefined ? {} : { signal }) })
    },
    presetFor: () => preset,
    ...(deps.flush === undefined ? {} : { flush: deps.flush }),
    ...(deps.releaseTimeoutMs === undefined ? {} : { releaseTimeoutMs: deps.releaseTimeoutMs }),
    ...(deps.restartProfile === undefined ? {} : { restartProfile: deps.restartProfile }),
  })
  return {
    executor,
    manager,
    ports,
    anchorsRoot,
    anchors,
    routeForCwd: cwd => anchors.routeForCwd(cwd),
    anchorForWorkspace: workspaceId => anchors.pathFor(workspaceId),
    async create(input) {
      const session = await manager.create(input)
      const revealed = await revealIfConfigured(deps, session.sessionId, input.signal)
      return {
        sessionId: session.sessionId,
        workspaceId: session.workspaceId,
        executor: 'local',
        revealed,
        session,
      }
    },
    async open(input) {
      // A reconnect must take the executor record over from the previous client
      // instance before the P1 write open; otherwise `executor-held` blocks a
      // perfectly recoverable local session.
      await ensureLocalExecutorRecord(executor, deps, input.sessionId)
      const session = await manager.open(input)
      const revealed = await revealIfConfigured(deps, session.sessionId, input.signal)
      return {
        sessionId: session.sessionId,
        workspaceId: session.workspaceId,
        executor: 'local',
        revealed,
        session,
      }
    },
    async release(sessionId: string) {
      await manager.release(sessionId, deps.flush === undefined ? {} : { flush: deps.flush })
    },
    async dispose() {
      await manager.releaseAll(deps.flush === undefined ? {} : { flush: deps.flush })
      anchors.forgetTarget(deps.targetId)
      await removeTargetAnchors(anchorsRoot, deps.targetId).catch(() => false)
    },
  }
}

/** Re-export for route wiring (one import site). */
export type { LocalSessionCreated, ManagedLocalSession }
