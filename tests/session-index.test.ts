/**
 * Shared server-authoritative session index (requirements D3/§5, protocol
 * §5.2/§16.8).
 *
 * Both executor modes read rows/titles/history from the same P1 API. These
 * tests pin the normalization (title fallback, registry facts, malformed rows
 * never becoming silent empty rows) and the read-only history walk (paged
 * `persist/read`, handle closed even when a page fails, server cwd preserved
 * for the local-mode routing to re-anchor).
 */
import { describe, expect, it } from 'vitest'
import {
  normalizeSessionList,
  ServerSessionIndex,
  ServerSessionIndexError,
} from '../src/session/server-index.ts'

const SESSION = 'session-index-1'

/** One recorded RPC call. */
interface Call {
  readonly method: string
  readonly params: Record<string, unknown>
}

/** Build a scriptable RPC port that records calls. */
function fakeRpc(handler: (method: string, params: Record<string, unknown>) => unknown): {
  rpc: { request<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> }
  calls: Call[]
} {
  const calls: Call[] = []
  return {
    calls,
    rpc: {
      async request<T>(method: string, params: unknown): Promise<T> {
        const fields = (params ?? {}) as Record<string, unknown>
        calls.push({ method, params: fields })
        return await handler(method, fields) as T
      },
    },
  }
}

/** A server header (server-real cwd). */
function header(id: string): Record<string, unknown> {
  return { id, version: 4, createdAt: 1, cwd: '/srv/project', isSeeded: false }
}

/** One event. */
function event(seq: number): Record<string, unknown> {
  return { type: 'turn/start', seq, time: seq, data: { turn: 1 } }
}

describe('normalizeSessionList', () => {
  it('normalizes the P1 envelope, title fallback, registry facts and optional fields', () => {
    const list = normalizeSessionList({
      registry: { revision: 'rev-1', epoch: 'epoch-1', stale: true },
      sessions: [
        {
          sessionId: 'a',
          title: 'named',
          titleSource: 'log',
          blank: false,
          running: true,
          agentAvailable: true,
          updatedAt: 123,
          pinned: true,
          archived: false,
          cwd: '/srv/a',
          workspaceId: 'w-1',
        },
        {
          sessionId: 'b',
          projections: { values: { title: 'projected' } },
          blank: true,
          running: false,
          agentAvailable: false,
          updatedAt: 'not-a-number',
          pinned: false,
          archived: true,
        },
        { title: 'no id' },
        'garbage',
      ],
    })
    expect(list.registry).toEqual({ revision: 'rev-1', epoch: 'epoch-1', stale: true })
    expect(list.sessions.map(row => row.sessionId)).toEqual(['a', 'b'])
    expect(list.sessions[0]).toMatchObject({
      title: 'named', titleSource: 'log', running: true, pinned: true, cwd: '/srv/a', workspaceId: 'w-1', updatedAt: 123,
    })
    expect(list.sessions[1]).toMatchObject({
      title: 'projected', blank: true, archived: true, updatedAt: 0,
    })
    expect(list.sessions[1]?.titleSource).toBeUndefined()
    expect(list.sessions[1]?.cwd).toBeUndefined()
  })

  it('passes the M2g executor through and defaults an omitted one to server', () => {
    const list = normalizeSessionList({
      registry: { revision: 'r', epoch: 'e' },
      sessions: [
        { sessionId: 'local-row', executor: 'local', updatedAt: 1, blank: true },
        { sessionId: 'server-row', executor: 'server', updatedAt: 2, blank: false },
        { sessionId: 'legacy-row', updatedAt: 3, blank: true },
        { sessionId: 'invalid-row', executor: 'bogus', updatedAt: 4 },
      ],
    })
    expect(list.sessions.map(row => [row.sessionId, row.executor])).toEqual([
      ['local-row', 'local'],
      ['server-row', 'server'],
      ['legacy-row', 'server'],
      ['invalid-row', 'server'],
    ])
  })

  it('accepts a bare array from a partial server without inventing registry facts', () => {
    const list = normalizeSessionList([{ sessionId: 'a', updatedAt: 1 }])
    expect(list.registry).toEqual({ revision: '', epoch: '' })
    expect(list.sessions).toHaveLength(1)
    expect(list.sessions[0]?.executor).toBe('server')
  })

  it('refuses a payload that is not a session array', () => {
    for (const raw of [null, { items: [] }, { sessions: 'nope' }, 7]) {
      expect(() => normalizeSessionList(raw)).toThrow(ServerSessionIndexError)
    }
  })
})

describe('ServerSessionIndex.list', () => {
  it('reads session/list and keeps the server rows', async () => {
    const { rpc, calls } = fakeRpc(() => ({
      registry: { revision: 'r', epoch: 'e' },
      sessions: [{ sessionId: SESSION, title: 't', blank: false, running: false, agentAvailable: false, updatedAt: 1, pinned: false, archived: false }],
    }))
    const index = new ServerSessionIndex(rpc)
    const list = await index.list()
    expect(list.sessions[0]?.sessionId).toBe(SESSION)
    expect(calls).toEqual([{ method: 'session/list', params: {} }])
  })
})

describe('ServerSessionIndex.history', () => {
  it('walks paged reads, keeps server cwd, and closes the read handle', async () => {
    const { rpc, calls } = fakeRpc((method, params) => {
      if (method === 'persist/open') {
        return { handleId: 'handle-1', header: header(SESSION), inheritedEventCount: 2 }
      }
      if (method === 'persist/read') {
        const offset = params['offset'] as number
        if (offset === 0) return { events: [event(0)], eventState: 'detached', nextOffset: 1 }
        if (offset === 1) return { events: [event(1)], eventState: 'detached', nextOffset: 2 }
        return { events: [], eventState: 'detached', nextOffset: 2 }
      }
      if (method === 'persist/close') return {}
      throw new Error(`unexpected ${method}`)
    })
    const history = await new ServerSessionIndex(rpc).history(SESSION)
    expect(history.header.cwd).toBe('/srv/project')
    expect(history.events.map(item => (item as { seq?: number }).seq)).toEqual([0, 1])
    expect(history.inheritedEventCount).toBe(2)
    expect(calls.map(call => call.method)).toEqual([
      'persist/open', 'persist/read', 'persist/read', 'persist/read', 'persist/close',
    ])
    expect(calls[0]?.params).toEqual({ sessionId: SESSION, access: 'read' })
    expect(calls[4]?.params).toEqual({ handleId: 'handle-1' })
  })

  it('stops on a non-advancing cursor instead of looping forever', async () => {
    const { rpc, calls } = fakeRpc((method) => {
      if (method === 'persist/open') return { handleId: 'handle-1', header: header(SESSION) }
      if (method === 'persist/read') return { events: [event(0)], eventState: 'detached', nextOffset: 0 }
      if (method === 'persist/close') return {}
      return {}
    })
    await new ServerSessionIndex(rpc).history(SESSION)
    expect(calls.filter(call => call.method === 'persist/read')).toHaveLength(1)
  })

  it('closes the handle even when a page read fails', async () => {
    const { rpc, calls } = fakeRpc((method) => {
      if (method === 'persist/open') return { handleId: 'handle-1', header: header(SESSION) }
      if (method === 'persist/read') throw Object.assign(new Error('session/not-found'), { code: 'session-not-found', status: 404 })
      return {}
    })
    await expect(new ServerSessionIndex(rpc).history(SESSION)).rejects.toMatchObject({ code: 'session-not-found' })
    expect(calls.at(-1)?.method).toBe('persist/close')
  })

  it('refuses an open answer without a handle', async () => {
    const { rpc } = fakeRpc(() => ({ header: header(SESSION) }))
    await expect(new ServerSessionIndex(rpc).history(SESSION)).rejects.toMatchObject({
      code: 'server-index-invalid',
    })
  })

  it('rejects an empty session id before any RPC', async () => {
    const { rpc, calls } = fakeRpc(() => ({}))
    await expect(new ServerSessionIndex(rpc).history('  ')).rejects.toBeInstanceOf(ServerSessionIndexError)
    expect(calls).toHaveLength(0)
  })
})
