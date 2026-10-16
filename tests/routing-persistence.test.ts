/**
 * Routing persistence: local cwds delegate to the embedded JSONL backend,
 * remote-workspace stub cwds go through the `persist.*` RPC plane.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import RoutingSessionPersistence from '../src/session-persistence/routing.ts'

const STUB = '/Users/someone/.dsh/remote-workspaces/rt-abc/1234abcd'

function header(id: string, cwd: string): SessionHeader {
  // Shaped like a real stored header (see a session log's first line).
  return {
    version: 4, id: id as never, createdAt: Date.now(), cwd,
    isSeeded: false, delegationDepth: 0, agentPreset: 'standard',
  } as never
}

/** Listeners the routing installed on the host context, by event name. */
const listeners = new Map<string, Array<(...args: never[]) => unknown>>()

function makeCtx(): Context {
  listeners.clear()
  return {
    reflect: { provide: () => () => {} },
    logger: { warn() {}, info() {}, error() {}, debug() {} },
    effect: () => () => {},
    on: (name: string, callback: (...args: never[]) => unknown) => {
      const bucket = listeners.get(name) ?? []
      bucket.push(callback)
      listeners.set(name, bucket)
      return { dispose() {} }
    },
    get: (name: string) => (name === 'remoteWorkspaces' ? fakeService : undefined),
  } as unknown as Context
}

/** Dispatch one session-plane event to every listener the routing installed. */
async function emit(name: string, ...args: unknown[]): Promise<void> {
  for (const listener of listeners.get(name) ?? []) {
    await (listener as unknown as (...values: unknown[]) => Promise<void>)(...args)
  }
}

const requests: Array<{ method: string; params: unknown }> = []
/** Every live batch the routing sent to the remote plane, in order. */
const appended: SessionEvent[][] = []
/** What the remote server believes the workspace path is (it rewrites cwd). */
const REMOTE_PATH = '/Users/remote-user/project'
const WORKSPACE_ID = '0123456789abcdef'
const fakeService = {
  routeForCwd: (cwd: string | undefined) =>
    cwd === STUB ? { targetId: 'rt-abc', workspaceId: WORKSPACE_ID } : undefined,
  stubForWorkspace: (workspaceId: string) => (workspaceId === WORKSPACE_ID ? STUB : undefined),
  locateRemoteSession: async (sessionId: string) =>
    sessionId === 'session-remote' ? { targetId: 'rt-abc', workspaceId: WORKSPACE_ID } : undefined,
  sessionRequest: async <T,>(targetId: string, method: string, params: unknown): Promise<T> => {
    requests.push({ method, params })
    if (method === 'persist.create') {
      return {
        handleId: 'handle-1',
        header: { ...(params as { header: object }).header, cwd: REMOTE_PATH },
        events: [],
      } as T
    }
    if (method === 'persist.open') {
      return {
        handleId: 'handle-2',
        header: header('session-remote', REMOTE_PATH),
        events: [{ type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } }],
      } as T
    }
    if (method === 'persist.list') {
      return [{ id: 'session-remote', header: header('session-remote', REMOTE_PATH), cwd: REMOTE_PATH }] as T
    }
    if (method === 'persist.append') {
      appended.push((params as { events: SessionEvent[] }).events)
      return null as T
    }
    if (method === 'persist.flush' || method === 'persist.close') return null as T
    if (method === 'persist.locate') {
      return { workspaceId: (params as { sessionId: string }).sessionId === 'session-remote' ? WORKSPACE_ID : null } as T
    }
    return null as T
  },
}

describe('routing session persistence', () => {
  let root: string

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('delegates local cwds to the embedded JSONL backend', async () => {
    root = await mkdtemp(join(tmpdir(), 'rw-routing-'))
    const persistence = new RoutingSessionPersistence(makeCtx(), { root })
    const handle = await persistence.create(header('session-local', '/Users/someone/project'))
    await handle.append([
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    ] as never)
    await handle.flush()
    // No remote RPC was made for a local session (the delegate is the
    // official backend, so storage layout is its own contract).
    expect(requests.filter(entry => entry.method === 'persist.create')).toHaveLength(0)
    await persistence.flush()
  })

  it('routes stub-cwd creates to the remote persist plane', async () => {
    const persistence = new RoutingSessionPersistence(makeCtx(), { root: await mkdtemp(join(tmpdir(), 'rw-routing2-')) })
    const handle = await persistence.create(header('session-remote-1', STUB))
    expect(handle).toBeDefined()
    expect(requests.some(entry => entry.method === 'persist.create')).toBe(true)
    await handle?.close()
  })

  it('routes opens by server-side locate', async () => {
    const persistence = new RoutingSessionPersistence(makeCtx(), { root: await mkdtemp(join(tmpdir(), 'rw-routing3-')) })
    const handle = await persistence.open('session-remote' as never, 'read')
    expect(handle).toBeDefined()
    // The routing consults the fake service (no wire call of its own), then
    // opens through the persist plane.
    expect(requests.some(entry => entry.method === 'persist.open')).toBe(true)
    await handle?.close()
  })

  it('falls back to local when locate misses', async () => {
    const persistence = new RoutingSessionPersistence(makeCtx(), { root: await mkdtemp(join(tmpdir(), 'rw-routing4-')) })
    // A session id the remote does not know and the local store does not have:
    // the local backend's own error must surface (not-found family), proving
    // the call reached the delegate.
    await expect(persistence.open('session-unknown' as never, 'read')).rejects.toThrow(/session-unknown/)
  })

  it('re-anchors a resumed header on the local stub', async () => {
    // The server stores the *remote* path; local consumers realpath and stat
    // `header.cwd`, so the routing must hand back the stub or the session can
    // neither attach to the shell workspace nor be reopened by the controller.
    const persistence = new RoutingSessionPersistence(makeCtx(), { root: await mkdtemp(join(tmpdir(), 'rw-routing6-')) })
    const handle = await persistence.open('session-remote' as never, 'write')
    expect(handle?.header.cwd).toBe(STUB)
    await handle?.close()

    const snapshot = await persistence.stat('session-remote' as never)
    expect(snapshot?.header.cwd).toBe(STUB)
  })

  it('re-anchors a created header on the local stub', async () => {
    const persistence = new RoutingSessionPersistence(makeCtx(), { root: await mkdtemp(join(tmpdir(), 'rw-routing7-')) })
    const handle = await persistence.create(header('session-remote-2', STUB))
    expect(handle.header.cwd).toBe(STUB)
    await handle.close()
  })

  it('re-installs the embedded backend so LOCAL live events still persist', async () => {
    // The embedded JSONL backend installs its live routing in its constructor,
    // which ran against a registration-absorbing stub context (no-op `on`).
    // Without the explicit re-install the whole process — local sessions
    // included — would keep nothing but the seed turn.
    const root = await mkdtemp(join(tmpdir(), 'rw-routing-live-'))
    const persistence = new RoutingSessionPersistence(makeCtx(), { root })
    const handle = await persistence.create(header('session-local-live', '/Users/someone/project'))
    const event: SessionEvent = { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } } as never
    await emit('session/event', { id: 'session-local-live' }, event)
    await emit('session/flush', { id: 'session-local-live' })
    const seen = await handle.read(0, undefined)
    expect(seen.events).toHaveLength(1)
    await handle.close()
    await rm(root, { recursive: true, force: true })
  })

  it('buffers a remote session\'s live events and sends them on session/flush', async () => {
    appended.length = 0
    const persistence = new RoutingSessionPersistence(makeCtx(), { root: await mkdtemp(join(tmpdir(), 'rw-routing-live2-')) })
    const handle = await persistence.create(header('session-remote-live', STUB))
    const first = { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } } as never
    const second = { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } } as never
    await emit('session/event', { id: 'session-remote-live' }, first)
    await emit('session/event', { id: 'session-remote-live' }, second)
    // Buffered, not one RPC per event: the remote plane has seen nothing yet.
    expect(appended).toHaveLength(0)
    await emit('session/flush', { id: 'session-remote-live' })
    expect(appended).toEqual([[first, second]])
    // A second flush with nothing buffered must not send an empty batch.
    await emit('session/flush', { id: 'session-remote-live' })
    expect(appended).toHaveLength(1)
    await handle.close()
  })

  it('drains buffered live events before an explicit append and before close', async () => {
    appended.length = 0
    const persistence = new RoutingSessionPersistence(makeCtx(), { root: await mkdtemp(join(tmpdir(), 'rw-routing-live3-')) })
    const handle = await persistence.create(header('session-remote-order', STUB))
    const live = { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } } as never
    const explicit = { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } } as never
    await emit('session/event', { id: 'session-remote-order' }, live)
    // An explicit append must never overtake buffered live events.
    await handle.append([explicit])
    expect(appended).toEqual([[live], [explicit]])
    // Closing commits whatever is still buffered before releasing ownership.
    const tail = { type: 'turn/end', seq: 2, time: 3, data: { turn: 1, reason: { kind: 'completed' } } } as never
    await emit('session/event', { id: 'session-remote-order' }, tail)
    await handle.close()
    expect(appended).toEqual([[live], [explicit], [tail]])
    expect(requests.some(entry => entry.method === 'persist.close')).toBe(true)
  })

  it('shares one live write handle between concurrent write opens', async () => {
    // The official backend allows one writer per session: a second
    // `persist.open` would fail BOTH callers with `already owned by an active
    // write handle` — the failure mode observed when two resumes of the same
    // session race. The routing hands the second caller a borrower instead.
    requests.length = 0
    appended.length = 0
    const persistence = new RoutingSessionPersistence(makeCtx(), { root: await mkdtemp(join(tmpdir(), 'rw-routing-share-')) })
    const owner = await persistence.open('session-remote' as never, 'write')
    const borrower = await persistence.open('session-remote' as never, 'write')
    expect(requests.filter(entry => entry.method === 'persist.open')).toHaveLength(1)
    // The borrower may flush the shared log …
    await borrower.flush()
    expect(requests.some(entry => entry.method === 'persist.flush')).toBe(true)
    // … but closing it must NOT release the owner's write ownership.
    await borrower.close()
    expect(requests.some(entry => entry.method === 'persist.close')).toBe(false)
    await owner.close()
    expect(requests.some(entry => entry.method === 'persist.close')).toBe(true)
  })

  it('exposes the activation self-check marker', () => {
    const persistence = new RoutingSessionPersistence(makeCtx(), { root: join(tmpdir(), 'rw-routing5-') })
    expect((persistence as unknown as { routingMarker: symbol }).routingMarker).toBe(Symbol.for('dsh-remote-workspace.routing-persistence'))
  })
})
