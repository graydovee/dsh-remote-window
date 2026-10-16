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
})
