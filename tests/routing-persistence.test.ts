/**
 * Routing persistence: local cwds delegate to the embedded official JSONL
 * backend; private-anchor cwds route the same calls through the profile
 * server's P1 `persist/*` plane (v1).
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import RoutingSessionPersistence from '../src/session-persistence/routing.ts'
import { remotePresetId } from '../src/preset/world.ts'
import { RW_METHODS } from '../src/protocol.ts'

const TARGET = 'rt-abc'
const ANCHOR = '/Users/someone/.dsh/remote-windows/aaaaaaaaaaaa/rt-abc/1234abcd'
const REMOTE_PATH = '/home/user/project'
const WORKSPACE_ID = '3f9a1c0b7e2d4a68'

function header(id: string, cwd: string, agentPreset = remotePresetId(TARGET)): SessionHeader {
  return {
    version: 4, id: id as never, createdAt: Date.now(), cwd,
    isSeeded: false, delegationDepth: 0, agentPreset,
  } as never
}

const contexts: Context[] = []
let current: Context | undefined

function makeCtx(): Context {
  const ctx = new Context()
  ctx.provide('remoteWorkspaces', fakeService)
  current = ctx
  contexts.push(ctx)
  return ctx
}

afterEach(async () => {
  current = undefined
  while (contexts.length > 0) {
    const ctx = contexts.pop() as Context
    await ctx.fiber.dispose().catch(() => {})
  }
})

/** Dispatch one session-plane event the way the agent loop does. */
async function emit(name: string, ...args: unknown[]): Promise<void> {
  if (current === undefined) throw new Error('emit() needs a context created by makeCtx()')
  await (current.parallel as unknown as (event: string, ...rest: unknown[]) => Promise<void>)(name, ...args)
}

const requests: Array<{ method: string; params: Record<string, unknown> }> = []
/** Every live batch the routing sent to the remote plane, in order. */
const appended: SessionEvent[][] = []

const fakeService = {
  routeForCwd: (cwd: string | undefined) =>
    cwd === ANCHOR ? { targetId: TARGET, workspaceId: WORKSPACE_ID, remoteCwd: REMOTE_PATH } : undefined,
  stubForWorkspace: (workspaceId: string) => (workspaceId === WORKSPACE_ID ? ANCHOR : undefined),
  remotePathForWorkspace: (workspaceId: string) => (workspaceId === WORKSPACE_ID ? REMOTE_PATH : undefined),
  locateRemoteSession: async (sessionId: string) =>
    sessionId === 'session-remote' ? { targetId: TARGET, workspaceId: WORKSPACE_ID, remoteCwd: REMOTE_PATH } : undefined,
  sessionRequest: async <T,>(_targetId: string, method: string, params: unknown): Promise<T> => {
    const fields = (params ?? {}) as Record<string, unknown>
    requests.push({ method, params: fields })
    if (method === RW_METHODS.persistCreate) {
      return {
        handleId: 'handle-1',
        header: { ...(fields['header'] as object), cwd: REMOTE_PATH },
        nextSeq: 0,
      } as T
    }
    if (method === RW_METHODS.persistOpen) {
      return {
        handleId: 'handle-2',
        header: header('session-remote', REMOTE_PATH),
        eventCount: 1,
      } as T
    }
    if (method === RW_METHODS.persistStat) return { header: header('session-remote', REMOTE_PATH) } as T
    if (method === RW_METHODS.persistRead) {
      return {
        events: [{ type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } }],
        eventState: 'detached',
        nextOffset: 1,
      } as T
    }
    if (method === RW_METHODS.persistAppend) {
      appended.push(fields['events'] as SessionEvent[])
      return {} as T
    }
    if (method === RW_METHODS.persistFlush || method === RW_METHODS.persistClose) return {} as T
    if (method === RW_METHODS.persistList) return { snapshots: [] } as T
    return null as T
  },
}

describe('routing session persistence (v1)', () => {
  let root: string

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('delegates local cwds to the embedded JSONL backend', async () => {
    root = await mkdtemp(join(tmpdir(), 'rw-routing-'))
    const persistence = new RoutingSessionPersistence(makeCtx(), { root })
    const handle = await persistence.create(header('session-local', '/Users/someone/project', 'standard'))
    await handle.append([
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    ] as never)
    await handle.flush()
    expect(requests.filter(entry => entry.method === RW_METHODS.persistCreate)).toHaveLength(0)
    await persistence.flush()
  })

  it('routes private-anchor creates through P1 persist/create with remoteCwd + executor', async () => {
    requests.length = 0
    const persistence = new RoutingSessionPersistence(makeCtx(), { root: await mkdtemp(join(tmpdir(), 'rw-routing2-')) })
    const handle = await persistence.create(header('session-remote-1', ANCHOR))
    expect(handle.header.cwd).toBe(ANCHOR)
    const create = requests.find(entry => entry.method === RW_METHODS.persistCreate)
    expect(create?.params).toMatchObject({
      remoteCwd: REMOTE_PATH,
      executor: 'local',
      header: { id: 'session-remote-1', cwd: REMOTE_PATH },
    })
    expect(create?.params).not.toHaveProperty('workspaceId')
    await handle.close()
  })

  it('routes opens by server-side locate and re-anchors the header', async () => {
    const persistence = new RoutingSessionPersistence(makeCtx(), { root: await mkdtemp(join(tmpdir(), 'rw-routing3-')) })
    const handle = await persistence.open('session-remote' as never, 'read')
    expect(handle.header.cwd).toBe(ANCHOR)
    expect(requests.some(entry => entry.method === RW_METHODS.persistOpen)).toBe(true)
    const snapshot = await persistence.stat('session-remote' as never)
    expect(snapshot?.header.cwd).toBe(ANCHOR)
    await handle.close()
  })

  it('falls back to local when locate misses', async () => {
    const persistence = new RoutingSessionPersistence(makeCtx(), { root: await mkdtemp(join(tmpdir(), 'rw-routing4-')) })
    await expect(persistence.open('session-unknown' as never, 'read')).rejects.toThrow(/session-unknown/)
  })

  it('persists LOCAL live events through the embedded backend own tracker', async () => {
    const localRoot = await mkdtemp(join(tmpdir(), 'rw-routing-live-'))
    const persistence = new RoutingSessionPersistence(makeCtx(), { root: localRoot })
    const handle = await persistence.create(header('session-local-live', '/Users/someone/project', 'standard'))
    const event: SessionEvent = { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } } as never
    await emit('session/event', { id: 'session-local-live' }, event)
    await emit('session/flush', { id: 'session-local-live' })
    const seen = await handle.read(0, undefined)
    expect(seen.events).toHaveLength(1)
    await handle.close()
    await rm(localRoot, { recursive: true, force: true })
  })

  it('buffers a remote session live events and sends them on session/flush', async () => {
    appended.length = 0
    const persistence = new RoutingSessionPersistence(makeCtx(), { root: await mkdtemp(join(tmpdir(), 'rw-routing-live2-')) })
    const handle = await persistence.create(header('session-remote-live', ANCHOR))
    const first = { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } } as never
    const second = { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } } as never
    await emit('session/event', { id: 'session-remote-live' }, first)
    await emit('session/event', { id: 'session-remote-live' }, second)
    expect(appended).toHaveLength(0)
    await emit('session/flush', { id: 'session-remote-live' })
    expect(appended).toEqual([[first, second]])
    await emit('session/flush', { id: 'session-remote-live' })
    expect(appended).toHaveLength(1)
    await handle.close()
  })

  it('drains buffered live events before an explicit append and before close', async () => {
    appended.length = 0
    const persistence = new RoutingSessionPersistence(makeCtx(), { root: await mkdtemp(join(tmpdir(), 'rw-routing-live3-')) })
    const handle = await persistence.create(header('session-remote-order', ANCHOR))
    const live = { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } } as never
    const explicit = { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } } as never
    await emit('session/event', { id: 'session-remote-order' }, live)
    await handle.append([explicit])
    expect(appended).toEqual([[live], [explicit]])
    const tail = { type: 'turn/end', seq: 2, time: 3, data: { turn: 1, reason: { kind: 'completed' } } } as never
    await emit('session/event', { id: 'session-remote-order' }, tail)
    await handle.close()
    expect(appended).toEqual([[live], [explicit], [tail]])
    expect(requests.some(entry => entry.method === RW_METHODS.persistClose)).toBe(true)
  })

  it('shares one live write handle between concurrent write opens', async () => {
    requests.length = 0
    const persistence = new RoutingSessionPersistence(makeCtx(), { root: await mkdtemp(join(tmpdir(), 'rw-routing-share-')) })
    const owner = await persistence.open('session-remote' as never, 'write')
    const borrower = await persistence.open('session-remote' as never, 'write')
    expect(requests.filter(entry => entry.method === RW_METHODS.persistOpen)).toHaveLength(1)
    await borrower.flush()
    expect(requests.some(entry => entry.method === RW_METHODS.persistFlush)).toBe(true)
    await borrower.close()
    expect(requests.some(entry => entry.method === RW_METHODS.persistClose)).toBe(false)
    await owner.close()
    expect(requests.some(entry => entry.method === RW_METHODS.persistClose)).toBe(true)
  })

  it('exposes the activation self-check marker', () => {
    const persistence = new RoutingSessionPersistence(makeCtx(), { root: join(tmpdir(), 'rw-routing5-') })
    expect((persistence as unknown as { routingMarker: symbol }).routingMarker).toBe(Symbol.for('dsh-remote-window.routing-persistence'))
  })
})
