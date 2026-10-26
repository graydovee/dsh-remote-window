/**
 * Local-mode Agent ownership comes from `open.ts`/`resume` (D2 hand-off).
 *
 * If the plugin creates or cold-resumes the client Agent, it must keep the
 * official `AgentHandle`: that is the only capability that can cancel the turn,
 * wait for idle, flush and close the write handle when switching to server mode
 * (protocol §5.4). Conversely, a session that is already live was opened by
 * another caller (embedded official UI, another resume, the shell) and cannot
 * be managed — the caller must fall back to a profile restart.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { openRemoteSession, resumeRemoteSession } from '../src/session/open.ts'
import type { LocalAgentHandleLike } from '../src/session/local-turn.ts'

const TARGET = 'target-1'
const PRESET = `remote:${TARGET}`
const ANCHOR = '/tmp/rw-anchor/ws-1'

/** A fake official AgentHandle. */
function fakeHandle(id = 'session-1'): LocalAgentHandleLike & { disposed: boolean } {
  const handle = {
    disposed: false,
    agent: { id, cancel: () => {}, whenIdle: async () => {} },
    dispose: async () => { handle.disposed = true },
  }
  return handle
}

/** One recorded create/resume call. */
interface AgentCall {
  readonly kind: 'create' | 'resume'
  readonly options: Record<string, unknown>
}

/** Build the minimal host context these functions read. */
function fakeContext(options: {
  calls?: AgentCall[]
  live?: boolean
  create?: (options: Record<string, unknown>) => Promise<LocalAgentHandleLike>
  resume?: (options: Record<string, unknown>) => Promise<LocalAgentHandleLike>
  broken?: string
  mounts?: string[]
  selection?: { provider?: string; model?: string }
} = {}): Context {
  const calls = options.calls ?? []
  let handleCount = 0
  const mounts = options.mounts ?? []
  const presets = {
    resolve: async (id: string) => (options.broken === undefined ? { id } : { id, broken: options.broken }),
    mount: async (_ctx: Context, id: string) => { mounts.push(id) },
  }
  const agents = {
    get: () => (options.live === true ? {} : undefined),
    create: async (createOptions: Record<string, unknown>) => {
      calls.push({ kind: 'create', options: createOptions })
      if (options.create !== undefined) return await options.create(createOptions)
      handleCount += 1
      return fakeHandle(`session-created-${handleCount}`)
    },
    resume: async (resumeOptions: Record<string, unknown>) => {
      calls.push({ kind: 'resume', options: resumeOptions })
      if (options.resume !== undefined) return await options.resume(resumeOptions)
      return fakeHandle('session-resumed')
    },
  }
  const services: Record<string, unknown> = {
    agentPresets: presets,
    agents,
    agentDefaultModel: { currentSelection: () => options.selection ?? {} },
  }
  return {
    agentPresets: presets,
    agents,
    get: (name: string) => services[name],
  } as unknown as Context
}

describe('openRemoteSession ownership', () => {
  it('creates the Agent and returns the handle it owns', async () => {
    const calls: AgentCall[] = []
    const mounts: string[] = []
    const ctx = fakeContext({ calls, mounts, selection: { provider: 'deepseek', model: 'chat' } })
    const opened = await openRemoteSession(ctx, { targetId: TARGET, path: ANCHOR })
    expect(opened.managed).toBe(true)
    expect(opened.handle).toBeDefined()
    expect(opened.agentPreset).toBe(PRESET)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.kind).toBe('create')
    expect(calls[0]?.options).toMatchObject({
      meta: { cwd: ANCHOR, agentPreset: PRESET },
      agentOptions: { provider: 'deepseek', model: 'chat' },
    })
    // A v1 local session is a blank draft: no synthetic turn seed.
    expect(calls[0]?.options).not.toHaveProperty('seed')
    // The setup mount happens before publication (no observer sees a realm-less agent).
    const setup = calls[0]?.options['setup'] as (agentCtx: Context) => Promise<void>
    await setup(ctx)
    expect(mounts).toEqual([PRESET])
  })

  it('reports an already-live session as unmanaged instead of pretending to own it', async () => {
    const opened = await openRemoteSession(fakeContext({ live: true }), { targetId: TARGET, path: ANCHOR })
    expect(opened.managed).toBe(false)
    expect(opened.handle).toBeUndefined()
    expect(opened.unmanagedReason).toMatch(/already live/)
  })

  it('falls back to a fresh identity when the stored log is unusable, and still owns the new handle', async () => {
    let attempts = 0
    const ctx = fakeContext({
      create: async () => {
        attempts += 1
        if (attempts === 1) throw new Error(`session "session-old" is corrupt`)
        return fakeHandle('session-fresh')
      },
    })
    const opened = await openRemoteSession(ctx, { targetId: TARGET, path: ANCHOR, sessionId: 'session-old' as SessionId })
    expect(attempts).toBe(2)
    expect(opened.sessionId).not.toBe('session-old')
    expect(opened.managed).toBe(true)
    expect(opened.handle).toBeDefined()
  })

  it('does not swallow an unrelated creation failure', async () => {
    const ctx = fakeContext({ create: async () => { throw new Error('transport exploded') } })
    await expect(openRemoteSession(ctx, { targetId: TARGET, path: ANCHOR })).rejects.toThrow(/transport exploded/)
  })

  it('refuses a relative anchor and an unusable preset', async () => {
    await expect(openRemoteSession(fakeContext(), { targetId: TARGET, path: 'relative/anchor' })).rejects.toThrow(/absolute/)
    await expect(openRemoteSession(fakeContext({ broken: 'mount failed' }), { targetId: TARGET, path: ANCHOR })).rejects.toThrow(/unusable/)
  })
})

describe('resumeRemoteSession ownership', () => {
  it('cold-resumes a stored session and returns the owned handle', async () => {
    const calls: AgentCall[] = []
    const mounts: string[] = []
    const ctx = fakeContext({ calls, mounts })
    const opened = await resumeRemoteSession(ctx, { targetId: TARGET, sessionId: 'session-stored' })
    expect(opened).toMatchObject({ sessionId: 'session-stored', agentPreset: PRESET, managed: true })
    expect(opened.handle).toBeDefined()
    expect(calls[0]?.kind).toBe('resume')
    expect(calls[0]?.options['resumeSessionId']).toBe('session-stored')
    const setup = calls[0]?.options['setup'] as (agentCtx: Context) => Promise<void>
    await setup(ctx)
    expect(mounts).toEqual([PRESET])
  })

  it('treats an already-live session as unmanaged', async () => {
    const opened = await resumeRemoteSession(fakeContext({ live: true }), { targetId: TARGET, sessionId: 'session-live' })
    expect(opened.managed).toBe(false)
    expect(opened.handle).toBeUndefined()
  })
})
