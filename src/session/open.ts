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
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { remotePresetId, remotePresetDefinition, remoteWorkspacePresetId } from '../preset/world.ts'
import type { RemoteTargetRecord } from '../targets/types.ts'
import type { WorkspaceId } from '../protocol.ts'

/** Options for one remote session. */
export interface OpenRemoteSessionOptions {
  /** Target record id; its preset must already be registered. */
  readonly targetId: string
  /** Absolute remote working directory. */
  readonly path: string
  /** Session id to reuse, when reopening an existing workspace session. */
  readonly sessionId?: string
  /** Cancellation of the whole creation. */
  readonly signal?: AbortSignal
  /** Remote registry identity used by the session persistence provider. */
  readonly remoteWorkspaceId?: WorkspaceId
  /** The stored target record (workspace-scoped presets need its labels). */
  readonly target: RemoteTargetRecord
}

/** The created session's identity. */
export interface OpenedRemoteSession {
  readonly sessionId: SessionId
  readonly agentPreset: string
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
 *
 * Consequence: the session is not blank, so the shell's agent-preset chips
 * (blank-only, per `ui-agent-preset/seat-store`) never show for it. That is
 * correct here — the preset is the per-target remote realm; switching the
 * fresh session to standard/PTC would point its tools back at the local
 * machine.
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
 * @param options - target, remote path and optional existing session id.
 * @returns the session identity and the preset it was composed with.
 */
export async function openRemoteSession(ctx: Context, options: OpenRemoteSessionOptions): Promise<OpenedRemoteSession> {
  if (!options.path.startsWith('/')) throw new Error(`remote working directory must be absolute, received "${options.path}"`)
  console.error(`[rw] openRemoteSession: target=${options.targetId} ws=${options.remoteWorkspaceId ?? 'NONE'} path=${options.path}`)
  const presets = ctx.agentPresets
  // A workspace-scoped composition carries the persistence row bound to this
  // workspace id (registered fresh per open — `register` replaces per id);
  // without a remote workspace identity the target preset alone is used and
  // the session has no remote persistence.
  const presetId = options.remoteWorkspaceId === undefined
    ? remotePresetId(options.targetId)
    : remoteWorkspacePresetId(options.targetId, options.remoteWorkspaceId)
  if (options.remoteWorkspaceId !== undefined) {
    try {
      await presets.register(remotePresetDefinition(options.target, options.remoteWorkspaceId))
      console.error(`[rw] ws preset registered: ${presetId}`)
    } catch (error) {
      // `register` throws on an existing id; a workspace opened twice in one
      // process hits this with an identical definition — that is not an
      // error, the persistence row we need is already in the roster.
      if (!/Duplicate agent preset/i.test(error instanceof Error ? error.message : String(error))) throw error
    }
  }
  const resolved = await presets.resolve(presetId).catch((error: unknown) => {
    const details = (error as { details?: { available?: string[] } }).details
    console.error(`[rw] resolve failed: ${presetId}; available=${JSON.stringify(details?.available)}`)
    throw error
  })
  console.error(`[rw] ws preset resolved: ${presetId}${resolved.broken === undefined ? '' : ` broken=${resolved.broken}`}`)
  if (resolved.broken !== undefined) {
    throw new Error(`remote preset "${presetId}" is unusable: ${resolved.broken}`)
  }
  const sessionId = (options.sessionId ?? `session-${randomUUID()}`) as SessionId
  const agents = ctx.agents as unknown as AgentCreator
  const existing = agents.get(sessionId)
  if (existing !== undefined) {
    // Pre-existing sessions predate seeding; their (blank) state cannot be
    // repaired retroactively — the seed only applies at creation time.
    return { sessionId, agentPreset: resolved.id }
  }
  const defaultModel = ctx.get('agentDefaultModel') as { currentSelection(): { provider?: string; model?: string } } | undefined
  const selection = defaultModel?.currentSelection() ?? {}
  const buildCreate = (id: SessionId) => ({
    sessionId: id,
    // The shell keeps a *blank* session's composer inert behind a "select a
    // workspace" hero; the seed's complete turn (see workspaceSeedEvents)
    // clears blank so the opened workspace is immediately chatty, and keeps
    // the stored log reload-valid. The preset stays fixed to the remote realm.
    seed: workspaceSeedEvents(),
    agentOptions: { ...(selection.provider === undefined ? {} : { provider: selection.provider }), ...(selection.model === undefined ? {} : { model: selection.model }) },
    meta: { cwd: options.path, agentPreset: resolved.id },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    // `setup` runs before the agent is published, so no observer sees a session
    // whose realm is not mounted yet.
    setup: async (agentCtx: Context): Promise<void> => {
      // The workspace-scoped preset carries the persistence row; it provides
      // `sessionPersistence` inside the realm (same mechanism as the official
      // fs/subprocess providers), which is the only resolution path that
      // reliably reaches the agent loop.
      await presets.mount(agentCtx, presetId)
    },
  })
  try {
    await agents.create(buildCreate(sessionId))
    return { sessionId, agentPreset: resolved.id }
  } catch (error) {
    // A workspace record survives process restarts with its old session id:
    // the live agent registry is empty then, but the durable session store
    // still owns that id, so creation is rejected — either as a duplicate or
    // (sessions seeded before the closed-turn fix) as a corrupt stored log
    // the shell refuses to load. The old transcript stays in the store; the
    // workspace moves on to a fresh session.
    const message = error instanceof Error ? error.message : String(error)
    if (options.sessionId === undefined || !/already exists|corrupt|does not match an open turn/i.test(message)) throw error
    const fresh = `session-${randomUUID()}` as SessionId
    await agents.create(buildCreate(fresh))
    return { sessionId: fresh, agentPreset: resolved.id }
  }
}
