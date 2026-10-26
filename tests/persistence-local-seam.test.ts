/**
 * End-to-end seam for local-mode session creation inside the client host:
 *
 *   HostLocalRuntime.create
 *     → P1 `session/create {executor:'local'}` (id only, no agent/log)
 *     → private anchor (AnchorRegistry)
 *     → ctx.agents.create
 *         → routing `sessionPersistence.create(header.cwd = anchor)`
 *             → P1 `persist/create { header(cwd = remoteCwd), remoteCwd,
 *                                  executor:'local' }`
 *     → handle owned by the runtime
 *
 * and `runtime.open` after a release resumes the same session through
 * `persist/open {sessionId, access:'write'}` with the header re-anchored on the
 * private anchor. This is the wiring dev-core installs in `src/index.ts`; the
 * test fakes only the Cordis services and P1 transport.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { afterAll, describe, expect, it } from 'vitest'
import { createRoutingPersistence, type RoutingRemoteService, type SessionRoute } from '../src/session-persistence/routing.ts'
import { createHostLocalRuntime } from '../src/session/local-runtime.ts'
import type { LocalAgentHandleLike } from '../src/session/local-turn.ts'
import { remotePresetId } from '../src/preset/world.ts'

const TARGET = 'target-1'
const CLIENT = 'client-abc'
const WORKSPACE = '0123456789abcdef'
const REMOTE_CWD = '/home/tester/work'
const PRESET = remotePresetId(TARGET)
const ROOTS: string[] = []

afterAll(async () => {
  while (ROOTS.length > 0) await rm(ROOTS.pop() as string, { recursive: true, force: true })
})

/** A fake official AgentHandle. */
function fakeHandle(id: string): LocalAgentHandleLike {
  return {
    agent: { id, cancel: () => {}, whenIdle: async () => {} },
    dispose: async () => {},
  }
}

/** A stored header as the server returns it (server cwd). */
function serverHeader(id: string): SessionHeader {
  return { id: id as never, version: 4 as never, createdAt: 1, cwd: REMOTE_CWD, isSeeded: false }
}

describe('local session seam: runtime → routing → P1 persist', () => {
  it('creates through the anchor and reopens via persist/open with re-anchored header', async () => {
    const home = await mkdtemp(join(tmpdir(), 'rw-local-seam-'))
    ROOTS.push(home)
    const dshHome = join(home, 'dsh')

    const ctx = new Context()
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    const rpc = {
      async request<T>(method: string, params: unknown): Promise<T> {
        const fields = (params ?? {}) as Record<string, unknown>
        calls.push({ method, params: fields })
        if (method === 'session/create') return { sessionId: fields['sessionId'], executor: 'local' } as T
        if (method === 'executor/assign') return { mode: 'local' } as T
        if (method === 'persist/create') {
          return {
            handleId: 'handle-create',
            header: { ...(fields['header'] as SessionHeader), cwd: REMOTE_CWD },
            nextSeq: 0,
          } as T
        }
        if (method === 'persist/open') {
          return { handleId: 'handle-open', header: serverHeader(String(fields['sessionId'])), inheritedEventCount: 0, eventCount: 1 } as T
        }
        return null as T
      },
    }

    // The real routing instance, wired exactly as dev-core does.
    let runtime: ReturnType<typeof createHostLocalRuntime> | undefined
    const facade: RoutingRemoteService = {
      routeForCwd: cwd => runtime?.routeForCwd(cwd) as SessionRoute | undefined,
      locateRemoteSession: async () => undefined,
      stubForWorkspace: workspaceId => runtime?.anchorForWorkspace(workspaceId),
      remotePathForWorkspace: workspaceId => (workspaceId === WORKSPACE ? REMOTE_CWD : undefined),
      sessionRequest: async <T,>(_targetId: string, method: string, params: unknown): Promise<T> => await rpc.request<T>(method, params),
    }
    const routing = createRoutingPersistence(ctx, { root: join(home, 'sessions') }, facade)

    // The fake Agent factory performs what agent-loop does: persistence create.
    const presets = { resolve: async (id: string) => ({ id }), mount: async () => {} }
    const agents = {
      get: () => undefined,
      create: async (options: { sessionId: string; meta: { cwd: string; agentPreset?: string }; setup?: (c: Context) => Promise<void> }) => {
        await options.setup?.(ctx)
        const header: SessionHeader = {
          id: options.sessionId as never,
          version: 4 as never,
          createdAt: 1,
          cwd: options.meta.cwd,
          isSeeded: false,
          ...(options.meta.agentPreset === undefined ? {} : { agentPreset: options.meta.agentPreset }),
        } as never
        const persisted = await routing.create(header)
        expect(persisted.header.cwd).toBe(options.meta.cwd)
        // Mirror agent-loop: the AgentHandle owns the persistence handle, and
        // disposing it closes/drains that handle (releasing the routing writer).
        return {
          agent: { id: options.sessionId, cancel: () => {}, whenIdle: async () => {} },
          dispose: async () => { await persisted.close() },
        }
      },
      resume: async (options: { resumeSessionId: string; setup?: (c: Context) => Promise<void> }) => {
        await options.setup?.(ctx)
        const handle = await routing.open(options.resumeSessionId as never, 'write')
        expect(handle.header.cwd).toBe(runtime?.anchorForWorkspace(WORKSPACE))
        return {
          agent: { id: options.resumeSessionId, cancel: () => {}, whenIdle: async () => {} },
          dispose: async () => { await handle.close() },
        }
      },
    }
    ctx.provide('agentPresets', presets)
    ctx.provide('agents', agents)
    ctx.provide('agentDefaultModel', { currentSelection: () => ({}) })

    runtime = createHostLocalRuntime({
      ctx,
      rpc,
      targetId: TARGET,
      clientId: CLIENT,
      env: { DSH_HOME: dshHome },
      presetId: PRESET,
    })

    const created = await runtime.create({ workspaceId: WORKSPACE })
    expect(created.executor).toBe('local')
    expect(runtime.manager.owns(created.sessionId)).toBe(true)
    const anchor = runtime.anchorForWorkspace(WORKSPACE)
    expect(anchor).toBeDefined()
    expect(runtime.routeForCwd(anchor)).toEqual({ targetId: TARGET, workspaceId: WORKSPACE, path: anchor })

    const create = calls.find(call => call.method === 'persist/create')
    expect(create?.params).toMatchObject({
      remoteCwd: REMOTE_CWD,
      executor: 'local',
      header: { id: created.sessionId, cwd: REMOTE_CWD },
    })
    expect(create?.params).not.toHaveProperty('workspaceId')

    // Release, then reopen: the same session is resumed read/write on the
    // private anchor, via the v1 persist/open shape.
    await runtime.release(created.sessionId)
    const reopened = await runtime.open({ workspaceId: WORKSPACE, sessionId: created.sessionId })
    expect(reopened.sessionId).toBe(created.sessionId)
    expect(runtime.manager.owns(created.sessionId)).toBe(true)
    const open = calls.find(call => call.method === 'persist/open')
    expect(open?.params).toEqual({ sessionId: created.sessionId, access: 'write' })

    await runtime.dispose()
    await (ctx as unknown as { fiber: { dispose(): Promise<void> } }).fiber.dispose().catch(() => {})
  })
})
