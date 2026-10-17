/**
 * Opening a session whose working directory is a *remote* path.
 *
 * The official session-controller layer cannot be used: `createOrAdopt` calls
 * `mkdir(cwd, { recursive: true })` before composing the agent (MIT, DSH
 * `packages/api/session-controller/src/agent.ts`), which would create the remote
 * path locally. `ctx.agents.create` performs no filesystem access — it only
 * requires `meta.cwd` to be an absolute path — so the plugin composes the same
 * thing itself: resolve the preset, mount it into the unpublished agent scope,
 * then publish with the remote cwd.
 *
 * Persistence is NOT wired here: the host-plane `sessionPersistence` is the
 * routing backend (see `src/session-persistence/routing.ts`, bound via the
 * bundle's `sessions` row override), which sends stub-cwd sessions to the
 * remote server by themselves.
 */
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { remotePresetId } from '../preset/world.ts'

/** Options for one remote session. */
export interface OpenRemoteSessionOptions {
  /** Target record id; its preset must already be registered. */
  readonly targetId: string
  /** Absolute local stub directory standing in for the remote path. */
  readonly path: string
  /** Session id to reuse, when reopening an existing workspace session. */
  readonly sessionId?: string
  /** Cancellation of the whole creation. */
  readonly signal?: AbortSignal
}

/** The created session's identity. */
export interface OpenedRemoteSession {
  readonly sessionId: SessionId
  readonly agentPreset: string
}

/** Options for resuming a stored remote session. */
export interface ResumeRemoteSessionOptions {
  /** Target record id; its preset must already be registered and its channel live. */
  readonly targetId: string
  /** Stored session id; it may have been written by another dsh instance. */
  readonly sessionId: string
  /** Cancellation of the load and composition. */
  readonly signal?: AbortSignal
}

/** The subset of `ctx.agents` this module needs. */
interface AgentCreator {
  get(id: SessionId): unknown
  create(options: {
    sessionId: SessionId
    agentOptions?: { provider?: string; model?: string }
    meta: { cwd: string; agentPreset?: string }
    signal?: AbortSignal
    setup?: (agentCtx: Context) => Promise<void> | void
  }): Promise<unknown>
  /**
   * Load a persisted session and publish a live agent on it. The remote log is
   * read through the routing persistence, so `resumeSessionId` may name a
   * session that only exists on the remote host (cross-device continuation).
   */
  resume(options: {
    resumeSessionId: SessionId
    agentOptions?: { provider?: string; model?: string }
    signal?: AbortSignal
    setup?: (agentCtx: Context) => Promise<void> | void
  }): Promise<unknown>
}

/**
 * The creation-time seed: one *complete* turn (open → system head → close).
 *
 * Why a whole turn: the restore layer (DSH `session-format-v3-to-v4`
 * relationships.ts) requires every `system/message` to sit inside an open
 * `turn/start` + `step/start` pair — a bare system event loads fine in memory
 * but is rejected as `… does not match an open turn and step` on the next
 * process restart. The turn must also be *closed* (`step/end` + `turn/end`,
 * reason `completed`): an open tail survives one reload, but the agent loop
 * derives the next turn number from the last seen `data.turn` and its new
 * `turn/start` would then collide with the still-open turn and corrupt the
 * log again.
 */
function workspaceSeedEvents(): unknown[] {
  const time = Date.now()
  return [
    { type: 'turn/start', seq: 0, time, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time, data: { turn: 1, step: 1 } },
    {
      type: 'system/message',
      seq: 2,
      time,
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        message: {
          id: randomUUID(),
          role: 'system',
          content: [],
          source: { kind: 'system-prompt' },
        },
      },
    },
    { type: 'step/end', seq: 3, time, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 4, time, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

/**
 * Create (or adopt) the session for a remote workspace.
 * @param ctx - the plugin's host context.
 * @param options - target, stub path and optional existing session id.
 * @returns the session identity and the preset it was composed with.
 */
export async function openRemoteSession(ctx: Context, options: OpenRemoteSessionOptions): Promise<OpenedRemoteSession> {
  // The path here is the **local stub** the session is anchored on (the realm's
  // stub→remote alias translates it at the tool boundary), so it must be
  // absolute *for this host*: `startsWith('/')` rejected every Windows stub
  // (`C:\Users\…\.dsh\remote-workspaces\…`) even though it was perfectly valid.
  if (!isAbsolute(options.path)) throw new Error(`remote working directory must be absolute, received "${options.path}"`)
  const presets = ctx.agentPresets
  const presetId = remotePresetId(options.targetId)
  const resolved = await presets.resolve(presetId)
  if (resolved.broken !== undefined) {
    throw new Error(`remote preset "${presetId}" is unusable: ${resolved.broken}`)
  }
  const sessionId = (options.sessionId ?? `session-${randomUUID()}`) as SessionId
  const agents = ctx.agents as unknown as AgentCreator
  const existing = agents.get(sessionId)
  if (existing !== undefined) {
    return { sessionId, agentPreset: resolved.id }
  }
  const defaultModel = ctx.get('agentDefaultModel') as { currentSelection(): { provider?: string; model?: string } } | undefined
  const selection = defaultModel?.currentSelection() ?? {}
  const buildCreate = (id: SessionId) => ({
    sessionId: id,
    // The shell keeps a *blank* session's composer inert behind a "select a
    // workspace" hero; the seed's complete turn (see workspaceSeedEvents)
    // clears blank so the opened workspace is immediately chatty, and keeps
    // the stored log reload-valid.
    seed: workspaceSeedEvents(),
    agentOptions: { ...(selection.provider === undefined ? {} : { provider: selection.provider }), ...(selection.model === undefined ? {} : { model: selection.model }) },
    meta: { cwd: options.path, agentPreset: resolved.id },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    // `setup` runs before the agent is published, so no observer sees a session
    // whose realm is not mounted yet.
    setup: async (agentCtx: Context): Promise<void> => {
      await presets.mount(agentCtx, resolved.id)
    },
  })
  try {
    await agents.create(buildCreate(sessionId))
    return { sessionId, agentPreset: resolved.id }
  } catch (error) {
    // A workspace record survives process restarts with its old session id:
    // the live agent registry is empty then, but the durable session store
    // still owns that id, so creation is rejected — either as a duplicate or
    // as a corrupt stored log. The workspace moves on to a fresh session.
    const message = error instanceof Error ? error.message : String(error)
    if (options.sessionId === undefined || !/already exists|corrupt|does not match an open turn/i.test(message)) throw error
    const fresh = `session-${randomUUID()}` as SessionId
    await agents.create(buildCreate(fresh))
    return { sessionId: fresh, agentPreset: resolved.id }
  }
}

/**
 * Resume one *stored* remote session, possibly created on another device.
 *
 * The write path is the official resume flow: `ctx.agents.resume` opens the
 * session for write through the routing persistence, which finds its workspace
 * by `persist.locate` and reads the authoritative log from the remote server.
 * No seed is supplied — the stored log *is* the history — and the live session
 * inherits the stub cwd from the re-anchored header (see `RemotePersistence`),
 * so the official workspace can attach it like any local session.
 *
 * @param ctx - the plugin's host context.
 * @param options - target, session id to adopt, optional cancellation.
 * @returns the session identity and the preset it was composed with.
 */
export async function resumeRemoteSession(ctx: Context, options: ResumeRemoteSessionOptions): Promise<OpenedRemoteSession> {
  const presets = ctx.agentPresets
  const presetId = remotePresetId(options.targetId)
  const resolved = await presets.resolve(presetId)
  if (resolved.broken !== undefined) {
    throw new Error(`remote preset "${presetId}" is unusable: ${resolved.broken}`)
  }
  const sessionId = options.sessionId as SessionId
  const agents = ctx.agents as unknown as AgentCreator
  // A session that is already live (opened earlier in this process) only needs
  // the caller to reveal it; resuming again would collide on write ownership.
  if (agents.get(sessionId) !== undefined) {
    return { sessionId, agentPreset: resolved.id }
  }
  const defaultModel = ctx.get('agentDefaultModel') as { currentSelection(): { provider?: string; model?: string } } | undefined
  const selection = defaultModel?.currentSelection() ?? {}
  await agents.resume({
    resumeSessionId: sessionId,
    agentOptions: { ...(selection.provider === undefined ? {} : { provider: selection.provider }), ...(selection.model === undefined ? {} : { model: selection.model }) },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    // Same pre-publication composition as `create`: the realm must exist
    // before any observer can drive the resumed session.
    setup: async (agentCtx: Context): Promise<void> => {
      await presets.mount(agentCtx, resolved.id)
    },
  })
  return { sessionId, agentPreset: resolved.id }
}
