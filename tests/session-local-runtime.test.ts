/**
 * Host-side local-mode binding used by dev-core's P3 `session/create|open`.
 *
 * The route layer must not copy the orchestration: this factory binds the
 * generic ports to `ctx.agents`/`agentPresets`, private anchors and the
 * target-bound P1 RPC. The browser catalog wait/reveal stays optional — when
 * omitted the route returns `revealed:false` and dev-ui reveals after it sees
 * the summary (protocol §16.10).
 */
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createHostLocalRuntime,
  type HostLocalRuntimeDeps,
} from '../src/session/local-runtime.ts'
import type { LocalAgentHandleLike } from '../src/session/local-turn.ts'
import { remotePresetId } from '../src/preset/world.ts'

const TARGET = 'target-1'
const CLIENT = 'client-abc'
const WORKSPACE = '0123456789abcdef'
const PRESET = remotePresetId(TARGET)

const roots: string[] = []

afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop() as string, { recursive: true, force: true })
})

/** A fresh private DSH_HOME. */
async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rw-local-runtime-'))
  roots.push(dir)
  return dir
}

interface HandleRecord extends LocalAgentHandleLike {
  disposed: boolean
  cancelled: number
  idleWaited: number
}

/** A fake official AgentHandle. */
function fakeHandle(id: string): HandleRecord {
  const handle: HandleRecord = {
    disposed: false,
    cancelled: 0,
    idleWaited: 0,
    agent: {
      id,
      cancel: () => { handle.cancelled += 1 },
      whenIdle: async () => { handle.idleWaited += 1 },
    },
    dispose: async () => { handle.disposed = true },
  }
  return handle
}

/** Recorded RPC call. */
interface Call { method: string; params: Record<string, unknown> }

/** Build the host context and RPC port; returns the created handles too. */
function fakeDeps(options: {
  env?: Record<string, string | undefined>
  live?: boolean
  rpc?: Call[]
  handles?: HandleRecord[]
  waitForCatalog?: HostLocalRuntimeDeps['waitForCatalog']
  reveal?: HostLocalRuntimeDeps['reveal']
  resume?: (sessionId: string) => LocalAgentHandleLike
  serverCreateUnsupported?: boolean
} = {}): HostLocalRuntimeDeps {
  const calls = options.rpc ?? []
  const handles = options.handles ?? []
  const presets = {
    resolve: async (id: string) => ({ id }),
    mount: async () => {},
  }
  let counter = 0
  const agents = {
    get: () => (options.live === true ? { live: true } : undefined),
    create: async (createOptions: Record<string, unknown>) => {
      counter += 1
      const handle = fakeHandle(`session-created-${counter}`)
      handles.push(handle)
      void createOptions
      return handle
    },
    resume: async (resumeOptions: Record<string, unknown>) => {
      if (options.resume !== undefined) return options.resume(String(resumeOptions['resumeSessionId']))
      const handle = fakeHandle(String(resumeOptions['resumeSessionId']))
      handles.push(handle)
      return handle
    },
  }
  const ctx = {
    agentPresets: presets,
    agents,
    get: (name: string) => name === 'agentDefaultModel' ? { currentSelection: () => ({}) } : name === 'agentPresets' ? presets : undefined,
  } as unknown as Context
  const rpc = {
    async request<T>(method: string, params: unknown): Promise<T> {
      const fields = (params ?? {}) as Record<string, unknown>
      calls.push({ method, params: fields })
      if (method === 'session/create') {
        if (options.serverCreateUnsupported === true) {
          throw Object.assign(new Error('session/create unsupported'), { code: 'bad-request', status: 400 })
        }
        return { sessionId: fields['sessionId'], executor: 'local' } as T
      }
      if (method === 'executor/get') return null as T
      if (method === 'executor/assign') {
        return {
          version: 1,
          sessionId: fields['sessionId'],
          mode: 'local',
          updatedAt: new Date().toISOString(),
          owner: { clientId: CLIENT, instanceId: 'test-instance', heartbeatAt: new Date().toISOString() },
        } as T
      }
      return { ok: true } as T
    },
  }
  return {
    ctx,
    rpc,
    targetId: TARGET,
    clientId: CLIENT,
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.waitForCatalog === undefined ? {} : { waitForCatalog: options.waitForCatalog }),
    ...(options.reveal === undefined ? {} : { reveal: options.reveal }),
  }
}

describe('createHostLocalRuntime.create', () => {
  it('assigns the executor, creates the client agent on its private anchor and reports revealed:false', async () => {
    const dshHome = await home()
    const calls: Call[] = []
    const handles: HandleRecord[] = []
    const runtime = createHostLocalRuntime(fakeDeps({ env: { DSH_HOME: dshHome }, rpc: calls, handles }))
    const created = await runtime.create({ workspaceId: WORKSPACE })
    expect(created).toMatchObject({ executor: 'local', revealed: false, workspaceId: WORKSPACE })
    expect(created.sessionId).toMatch(/^session-/)
    // M2 path: the server mints the local id (no agent/log), then the client
    // creates the agent/log on its private anchor.
    expect(calls[0]?.method).toBe('session/create')
    expect(calls[0]?.params).toEqual({ workspaceId: WORKSPACE, sessionId: created.sessionId, executor: 'local' })
    expect(runtime.manager.owns(created.sessionId)).toBe(true)
    expect(handles).toHaveLength(1)
    // Private anchor exists under $DSH_HOME/remote-windows/<clientId>/...
    const anchor = join(dshHome, 'remote-windows', CLIENT, TARGET)
    expect((await stat(anchor)).isDirectory()).toBe(true)
    // The routing facade resolves the session's anchor cwd back to its route.
    expect(runtime.anchorForWorkspace(WORKSPACE)).toBeDefined()
    const route = runtime.routeForCwd(join(runtime.anchorForWorkspace(WORKSPACE) as string))
    expect(route).toMatchObject({ targetId: TARGET, workspaceId: WORKSPACE })
  })

  it('falls back to client mint + executor/assign on an older server', async () => {
    const calls: Call[] = []
    const handles: HandleRecord[] = []
    const runtime = createHostLocalRuntime(fakeDeps({
      env: { DSH_HOME: await home() },
      rpc: calls,
      handles,
      serverCreateUnsupported: true,
    }))
    const created = await runtime.create({ workspaceId: WORKSPACE })
    expect(calls.map(call => call.method)).toEqual(['session/create', 'executor/assign'])
    expect(runtime.manager.owns(created.sessionId)).toBe(true)
  })

  it('reveals when a catalog bridge is provided and maps a timeout to session-reveal-timeout', async () => {
    const revealed: string[] = []
    const ok = createHostLocalRuntime(fakeDeps({
      env: { DSH_HOME: await home() },
      waitForCatalog: async () => {},
      reveal: id => revealed.push(id),
    }))
    const created = await ok.create({ workspaceId: WORKSPACE })
    expect(created.revealed).toBe(true)
    expect(revealed).toEqual([created.sessionId])

    const slow = createHostLocalRuntime({
      ...fakeDeps({
        env: { DSH_HOME: await home() },
        waitForCatalog: async () => { await new Promise(() => {}) },
      }),
      revealTimeoutMs: 5,
    })
    const failure = slow.create({ workspaceId: WORKSPACE })
    await expect(failure).rejects.toMatchObject({ code: 'session-reveal-timeout' })
    // The handle is retained by the manager even when the reveal fails; the
    // route must release it (or retry the reveal) rather than leak a writer.
    const sessions = slow.manager.list()
    expect(sessions).toHaveLength(1)
    await slow.release(sessions[0]?.sessionId as string)
  })
})

describe('createHostLocalRuntime.open', () => {
  it('cold-resumes a stored session onto its anchor and retains the handle', async () => {
    const handles: HandleRecord[] = []
    const runtime = createHostLocalRuntime(fakeDeps({ env: { DSH_HOME: await home() }, handles }))
    const opened = await runtime.open({ workspaceId: WORKSPACE, sessionId: 'session-stored' })
    expect(opened).toMatchObject({ sessionId: 'session-stored', executor: 'local', revealed: false })
    expect(runtime.manager.owns('session-stored')).toBe(true)
    expect(handles[0]?.agent.id).toBe('session-stored')
    await runtime.release('session-stored')
    expect(handles[0]?.disposed).toBe(true)
    expect(runtime.manager.owns('session-stored')).toBe(false)
  })

  it('single-flights concurrent opens and reuses the owned handle', async () => {
    const handles: HandleRecord[] = []
    const runtime = createHostLocalRuntime(fakeDeps({ env: { DSH_HOME: await home() }, handles }))
    const [first, second] = await Promise.all([
      runtime.open({ workspaceId: WORKSPACE, sessionId: 'session-stored' }),
      runtime.open({ workspaceId: WORKSPACE, sessionId: 'session-stored' }),
    ])
    expect(first.sessionId).toBe(second.sessionId)
    // Only one client Agent/handle may exist for a local session.
    expect(handles).toHaveLength(1)
    expect(runtime.manager.owns('session-stored')).toBe(true)
  })

  it('re-opens after a release with a fresh handle (client restart path)', async () => {
    const handles: HandleRecord[] = []
    const runtime = createHostLocalRuntime(fakeDeps({ env: { DSH_HOME: await home() }, handles }))
    await runtime.open({ workspaceId: WORKSPACE, sessionId: 'session-stored' })
    await runtime.release('session-stored')
    expect(handles[0]?.disposed).toBe(true)
    const reopened = await runtime.open({ workspaceId: WORKSPACE, sessionId: 'session-stored' })
    expect(reopened.sessionId).toBe('session-stored')
    expect(handles).toHaveLength(2)
    expect(runtime.manager.owns('session-stored')).toBe(true)
  })

  it('refuses an already-live official agent instead of pretending to own it', async () => {
    const runtime = createHostLocalRuntime(fakeDeps({ env: { DSH_HOME: await home() }, live: true }))
    await expect(runtime.open({ workspaceId: WORKSPACE, sessionId: 'session-live' }))
      .rejects.toMatchObject({ code: 'agent-compose-failed' })
    expect(runtime.manager.owns('session-live')).toBe(false)
  })
})

describe('createHostLocalRuntime.dispose', () => {
  it('releases owned agents and removes the target anchors', async () => {
    const dshHome = await home()
    const handles: HandleRecord[] = []
    const runtime = createHostLocalRuntime(fakeDeps({ env: { DSH_HOME: dshHome }, handles }))
    await runtime.create({ workspaceId: WORKSPACE })
    const anchorRoot = runtime.anchorsRoot
    expect((await stat(anchorRoot)).isDirectory()).toBe(true)
    await runtime.dispose()
    expect(handles[0]?.disposed).toBe(true)
    expect(runtime.routeForCwd(join(anchorRoot, TARGET))).toBeUndefined()
    await expect(stat(join(anchorRoot, TARGET))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

// The preset id used by the ports defaults to the target-scoped id.
void (PRESET as string)
void (undefined as unknown as SessionId)
