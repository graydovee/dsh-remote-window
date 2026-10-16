/**
 * Routing persistence: local cwds delegate to the embedded JSONL backend,
 * remote-workspace stub cwds go through the `persist.*` RPC plane.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import RoutingSessionPersistence from '../src/session-persistence/routing.ts'

const STUB = '/Users/someone/.dsh/remote-workspaces/rt-abc/1234abcd'

function header(id: string, cwd: string): SessionHeader {
  // Shaped like a real stored header (see a session log's first line).
  return {
    version: 4, id: id as never, createdAt: Date.now(), cwd,
    isSeeded: false, delegationDepth: 0, agentPreset: 'standard',
  } as never
}

function makeCtx(): Context {
  return {
    reflect: { provide: () => () => {} },
    logger: { warn() {}, info() {}, error() {}, debug() {} },
    effect: () => () => {},
    on: () => ({ dispose() {} }),
    get: (name: string) => (name === 'remoteWorkspaces' ? fakeService : undefined),
  } as unknown as Context
}

const requests: Array<{ method: string; params: unknown }> = []
const fakeService = {
  routeForCwd: (cwd: string | undefined) =>
    cwd === STUB ? { targetId: 'rt-abc', workspaceId: '0123456789abcdef' } : undefined,
  locateRemoteSession: async (sessionId: string) =>
    sessionId === 'session-remote' ? { targetId: 'rt-abc', workspaceId: '0123456789abcdef' } : undefined,
  sessionRequest: async <T,>(targetId: string, method: string, params: unknown): Promise<T> => {
    requests.push({ method, params })
    if (method === 'persist.create') {
      return {
        handleId: 'handle-1',
        header: (params as { header: unknown }).header,
        events: [],
      } as T
    }
    if (method === 'persist.open') {
      return { handleId: 'handle-2', header: (params as unknown as { header?: unknown }).header ?? null, events: [{ type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } }] } as T
    }
    if (method === 'persist.locate') {
      return { workspaceId: (params as { sessionId: string }).sessionId === 'session-remote' ? '0123456789abcdef' : null } as T
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

  it('exposes the activation self-check marker', () => {
    const persistence = new RoutingSessionPersistence(makeCtx(), { root: join(tmpdir(), 'rw-routing5-') })
    expect((persistence as unknown as { routingMarker: symbol }).routingMarker).toBe(Symbol.for('dsh-remote-workspace.routing-persistence'))
  })
})
