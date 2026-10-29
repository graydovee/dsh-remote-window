/**
 * P1 `persist/*` adaptation (protocol §5.4, §16).
 *
 * The client's routing talks to the server plugin through the frozen v1 wire
 * shape while the retired stdio plane is still supported:
 *
 * - `persist/create` carries the **server** cwd (`remoteCwd`) and stamps the
 *   local executor; the returned durable header is re-anchored on the local
 *   stub so official consumers can stat/attach it.
 * - `persist/open` is addressed by session id only (no workspace id).
 * - `persist/read` is paged and returns `nextOffset`.
 * - a lost server handle (`handle-not-found`, 410) is self-healed exactly once;
 *   the re-attach must not replay an already durable batch.
 */
import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { RemotePersistence } from '../src/rsession/remote-persistence.ts'

const STUB = '/Users/someone/.dsh/remote-windows/client-1/target-1/abc'
const REMOTE = '/srv/project'

/** A stored header as the server would return it (server cwd). */
function header(id: string, cwd = REMOTE): SessionHeader {
  return {
    id: id as never,
    version: 4 as never,
    createdAt: 1,
    cwd,
    isSeeded: false,
  }
}

/** One RPC call as recorded by the fake. */
interface Call {
  readonly method: string
  readonly params: Record<string, unknown>
}

/** Build a v1 persistence whose stub and remote cwd are known. */
function v1Persistence(
  handler: (method: string, params: Record<string, unknown>) => unknown,
  options: { remoteCwd?: string | undefined; withStub?: boolean } = {},
) {
  const calls: Call[] = []
  const rpc = {
    async request<T>(method: string, params: unknown): Promise<T> {
      const fields = (params ?? {}) as Record<string, unknown>
      calls.push({ method, params: fields })
      return await handler(method, fields) as T
    },
  }
  const remoteCwd = 'remoteCwd' in options ? options.remoteCwd : REMOTE
  const persistence = new RemotePersistence(
    new Context(),
    rpc,
    options.withStub === false ? undefined : () => STUB,
    {
      ...(remoteCwd === undefined ? {} : { remoteCwdOf: () => remoteCwd }),
    },
  )
  return { persistence, calls }
}

const event = (seq: number): SessionEvent => ({ type: 'turn/start', seq, time: seq, data: { turn: 1 } }) as never

describe('P1 persist/create', () => {
  it('sends the server cwd as remoteCwd + header.cwd and stamps the local executor', async () => {
    const { persistence, calls } = v1Persistence(() => ({ handleId: 'handle-1', header: header('session-1'), eventCount: 0 }))
    const handle = await persistence.create({ ...header('session-1', STUB), isSeeded: true } as never, { inheritedEventCount: 3 } as never)
    const create = calls[0]
    expect(create?.method).toBe('persist/create')
    expect(create?.params).toMatchObject({
      remoteCwd: REMOTE,
      executor: 'local',
      inheritedEventCount: 3,
      header: { id: 'session-1', cwd: REMOTE, isSeeded: true },
    })
    // The retired plane's workspaceId must not travel on the v1 wire.
    expect(create?.params).not.toHaveProperty('workspaceId')
    // The live handle is anchored locally, not on the server path.
    expect(handle.header.cwd).toBe(STUB)
    expect(handle.inheritedEventCount).toBe(3)
  })

  it('fails closed when the server cwd is unknown', async () => {
    const { persistence } = v1Persistence(() => ({ handleId: 'handle-1', header: header('session-1') }), { remoteCwd: undefined })
    await expect(persistence.create(header('session-1', STUB))).rejects.toThrow(/server cwd/)
  })
})

describe('P1 persist/open and read', () => {
  it('opens by session id (no workspace id) and re-anchors the header', async () => {
    const { persistence, calls } = v1Persistence(() => ({ handleId: 'handle-2', header: header('session-1'), eventCount: 5 }))
    const handle = await persistence.open('session-1' as never, 'write')
    expect(calls[0]).toEqual({ method: 'persist/open', params: { sessionId: 'session-1', access: 'write' } })
    expect(handle.header.cwd).toBe(STUB)
  })

  it('pages reads through persist/read and tracks nextOffset', async () => {
    const { persistence, calls } = v1Persistence((method) => {
      if (method === 'persist/open') return { handleId: 'handle-2', header: header('session-1'), eventCount: 3 }
      if (method === 'persist/read') {
        // Two events for the requested page; nextOffset advances by the page length.
        return { events: [event(0), event(1)], eventState: 'detached', nextOffset: 2 }
      }
      return null
    })
    const handle = await persistence.open('session-1' as never, 'read')
    const page = await handle.read(0, 2)
    expect(page.events.map(item => item.seq)).toEqual([0, 1])
    expect(calls.at(-1)).toEqual({ method: 'persist/read', params: { offset: 0, length: 2, handleId: 'handle-2' } })
    // A full read refreshes the cached view (used by the core `read()` contract).
    await handle.read()
    expect(calls.at(-1)).toEqual({ method: 'persist/read', params: { offset: 0, handleId: 'handle-2' } })
  })
})

describe('P1 410 handle-not-found self-heal', () => {
  it('re-opens once and retries the append on the new handle id', async () => {
    const calls: Call[] = []
    let appends = 0
    const rpc = {
      async request<T>(method: string, params: unknown): Promise<T> {
        const fields = (params ?? {}) as Record<string, unknown>
        calls.push({ method, params: fields })
        if (method === 'persist/create') return { handleId: 'handle-1', header: header('session-1'), eventCount: 0 } as T
        if (method === 'persist/append') {
          appends += 1
          if (appends === 1) throw Object.assign(new Error('handle-not-found'), { code: 'handle-not-found', status: 410 })
          return null as T
        }
        if (method === 'persist/open') return { handleId: 'handle-2', header: header('session-1'), eventCount: 1 } as T
        return null as T
      },
    }
    const persistence = new RemotePersistence(new Context(), rpc, () => STUB, { remoteCwdOf: () => REMOTE })
    const handle = await persistence.create(header('session-1', STUB))
    await handle.append([event(0)])
    expect(calls.map(call => call.method)).toEqual(['persist/create', 'persist/append', 'persist/open', 'persist/append'])
    expect(calls[2]?.params).toEqual({ sessionId: 'session-1', access: 'write' })
    expect(calls[3]?.params).toMatchObject({ handleId: 'handle-2' })
  })

  it('self-heals only once: a second loss on the re-opened handle is thrown', async () => {
    let appends = 0
    let opens = 0
    const persistence = new RemotePersistence(new Context(), {
      async request<T>(method: string): Promise<T> {
        if (method === 'persist/create') return { handleId: 'handle-1', header: header('session-1'), eventCount: 0 } as T
        if (method === 'persist/append') {
          appends += 1
          throw Object.assign(new Error('handle-not-found'), { code: 'handle-not-found', status: 410 })
        }
        if (method === 'persist/open') {
          opens += 1
          return { handleId: 'handle-2', header: header('session-1'), eventCount: 1 } as T
        }
        return null as T
      },
    }, () => STUB, { remoteCwdOf: () => REMOTE })
    const handle = await persistence.create(header('session-1', STUB))
    await expect(handle.append([event(0)])).rejects.toMatchObject({ code: 'handle-not-found' })
    expect(opens).toBe(1)
    expect(appends).toBe(2)
  })

  it('does not self-heal a non-contiguous append (server maps it to bad-request)', async () => {
    const failure = Object.assign(new Error('append seq mismatch: expected 3 at index 0, got 2'), {
      code: 'bad-request',
      status: 400,
      details: { reason: 'seq-mismatch' },
    })
    let opens = 0
    const { persistence } = v1Persistence((method) => {
      if (method === 'persist/create') return { handleId: 'handle-1', header: header('session-1'), nextSeq: 0 }
      if (method === 'persist/append') throw failure
      if (method === 'persist/open') { opens += 1; return null }
      return null
    })
    const handle = await persistence.create(header('session-1', STUB))
    await expect(handle.append([event(2)])).rejects.toBe(failure)
    // A non-contiguous batch is a client/sequence bug, not a lost server handle.
    expect(opens).toBe(0)
  })

  it('propagates the executor write-open guards unchanged', async () => {
    const conflict = Object.assign(new Error('session executor is "server"'), {
      code: 'executor-mode-conflict',
      status: 409,
      details: { mode: 'server', liveAgent: true },
    })
    const { persistence } = v1Persistence((method) => {
      if (method === 'persist/open') throw conflict
      return null
    })
    await expect(persistence.open('session-live' as never, 'write')).rejects.toBe(conflict)
  })

  it('does not re-open after an unrelated persistence failure', async () => {
    let opens = 0
    const persistence = new RemotePersistence(new Context(), {
      async request<T>(method: string): Promise<T> {
        if (method === 'persist/create') return { handleId: 'handle-1', header: header('session-1') } as T
        if (method === 'persist/append') throw new Error('non-contiguous batch')
        if (method === 'persist/open') { opens += 1; return null as T }
        return null as T
      },
    }, () => STUB, { remoteCwdOf: () => REMOTE })
    const handle = await persistence.create(header('session-1', STUB))
    await expect(handle.append([event(0)])).rejects.toThrow(/non-contiguous/)
    expect(opens).toBe(0)
  })
})

describe('P1 list / stat and legacy compatibility', () => {
  it('accepts the raw snapshots envelope and re-anchors every header', async () => {
    const { persistence, calls } = v1Persistence(() => ({
      snapshots: [
        { header: header('session-a'), sizeBytes: 10 },
        { header: header('session-b'), sizeBytes: 20 },
      ],
    }))
    const rows = await persistence.list()
    expect(rows.map(row => row.header.id)).toEqual(['session-a', 'session-b'])
    expect(rows.every(row => row.header.cwd === STUB)).toBe(true)
    expect(calls[0]).toEqual({ method: 'persist/list', params: {} })
  })

  it('prefers persist/stat in v1 and re-anchors its header', async () => {
    const { persistence } = v1Persistence((method) => {
      if (method === 'persist/stat') return { header: header('session-a') }
      return null
    })
    const snapshot = await persistence.stat('session-a' as never)
    expect(snapshot?.header.cwd).toBe(STUB)
  })

})
