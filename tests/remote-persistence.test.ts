import { Context } from '@deepseek-ai/cordis'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { RemotePersistence } from '../src/rsession/remote-persistence.ts'

const sessionHeader = (id: string): SessionHeader => ({
  id: id as never,
  version: 4 as never,
  createdAt: 1,
  cwd: '/srv/project',
  isSeeded: false,
})

describe('RemotePersistence', () => {
  it('maps the official handle lifecycle to persistence RPCs', async () => {
    const calls: string[] = []
    const rpc = {
      async request<T>(method: string, params: unknown): Promise<T> {
        calls.push(`${method}:${JSON.stringify(params)}`)
        if (method === 'persist.create') return { handleId: 'handle-1', header: sessionHeader('session-1'), events: [] } as T
        return null as T
      },
    }
    const persistence = new RemotePersistence(new Context(), rpc, 'workspace-1' as never)
    const handle = await persistence.create(sessionHeader('session-1'))
    await handle.append([])
    await handle.flush()
    await handle.close()
    expect(calls.map(value => value.split(':', 1)[0])).toEqual([
      'persist.create', 'persist.append', 'persist.flush', 'persist.close',
    ])
  })

  it('re-attaches and retries when the server forgot the handle', async () => {
    // A server restart (lease expiry, stop, or the plugin's own server-bundle
    // redeploy) drops its in-memory handle table while this client keeps the
    // handle id; the append must survive instead of failing a live turn.
    const calls: string[] = []
    let appends = 0
    const rpc = {
      async request<T>(method: string, params: unknown): Promise<T> {
        calls.push(`${method}:${JSON.stringify(params)}`)
        if (method === 'persist.create') {
          return { handleId: 'handle-1', header: sessionHeader('session-1'), events: [] } as T
        }
        if (method === 'persist.append') {
          appends += 1
          if (appends === 1) throw new Error('unknown remote session handle "handle-1"')
          return null as T
        }
        if (method === 'persist.open') {
          return {
            handleId: 'handle-2',
            header: sessionHeader('session-1'),
            events: [{ type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } }],
          } as T
        }
        return null as T
      },
    }
    const persistence = new RemotePersistence(new Context(), rpc, 'workspace-1' as never)
    const handle = await persistence.create(sessionHeader('session-1'))
    const batch = [{ type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } }] as never
    await handle.append(batch)
    // create → failed append → re-attach → retried append on the new handle.
    expect(calls.map(value => value.split(':', 1)[0])).toEqual([
      'persist.create', 'persist.append', 'persist.open', 'persist.append',
    ])
    expect(calls.at(-1)).toContain('"handleId":"handle-2"')
    // The re-attach re-reads the authoritative log, so the handle's own view
    // stays consistent (seed event + the batch just appended).
    const read = await handle.read(0)
    expect(read.events).toHaveLength(2)
  })

  it('sends the fork-inherited prefix length with a seeded create', async () => {
    // A forked session's header is `isSeeded`, and the official backend refuses
    // to store one without its inherited event count — so the count has to
    // travel with the create, and come back on the handle.
    const calls: Array<{ method: string; params: unknown }> = []
    const rpc = {
      async request<T>(method: string, params: unknown): Promise<T> {
        calls.push({ method, params })
        if (method === 'persist.create') {
          return { handleId: 'handle-1', header: { ...sessionHeader('child'), isSeeded: true }, events: [], inheritedEventCount: 3 } as T
        }
        if (method === 'persist.open') {
          return { handleId: 'handle-2', header: { ...sessionHeader('child'), isSeeded: true }, events: [], inheritedEventCount: 3 } as T
        }
        return null as T
      },
    }
    const persistence = new RemotePersistence(new Context(), rpc, 'workspace-1' as never)
    const handle = await persistence.create(
      { ...sessionHeader('child'), isSeeded: true } as never,
      { inheritedEventCount: 3 } as never,
    )
    const create = calls.find(call => call.method === 'persist.create')
    expect(create?.params).toMatchObject({ inheritedEventCount: 3 })
    expect(handle.inheritedEventCount).toBe(3)
    // Opening a seeded log reports the same prefix length back.
    const opened = await persistence.open('child' as never, 'write')
    expect(opened.inheritedEventCount).toBe(3)
  })

  it('does not retry an unrelated persistence failure', async () => {
    const rpc = {
      async request<T>(method: string): Promise<T> {
        if (method === 'persist.create') return { handleId: 'handle-1', header: sessionHeader('session-1'), events: [] } as T
        if (method === 'persist.append') throw new Error('session "session-1" append rejected: non-contiguous batch')
        return null as T
      },
    }
    const persistence = new RemotePersistence(new Context(), rpc, 'workspace-1' as never)
    const handle = await persistence.create(sessionHeader('session-1'))
    await expect(handle.append([])).rejects.toThrow(/non-contiguous/)
  })
})
