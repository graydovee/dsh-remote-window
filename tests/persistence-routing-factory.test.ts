/**
 * The routing factory dev-core mounts in its v1 `apply()`.
 *
 * One routing implementation, one set of rules: the facade is injected instead
 * of per-call `ctx.get('remoteWorkspaces')`, and the v1 P1 parameters
 * (`remoteCwd` + `executor:'local'`) flow through the same re-anchoring path as
 * the retired stdio plane. This is the seam that keeps `src/index.ts` from
 * growing a second copy of the routing.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createRoutingPersistence,
  type RoutingRemoteService,
  type SessionRoute,
} from '../src/session-persistence/routing.ts'

const STUB = '/Users/someone/.dsh/remote-workspaces/client-1/target-1/abc'
const REMOTE = '/srv/project'
const WORKSPACE = '0123456789abcdef'

/** A stored header. */
function header(id: string, cwd: string): SessionHeader {
  return {
    id: id as never,
    version: 4 as never,
    createdAt: 1,
    cwd,
    isSeeded: false,
    delegationDepth: 0,
    agentPreset: 'standard',
  } as never
}

/** A recording v1 facade with the methods dev-core will provide. */
function fakeFacade(): {
  facade: RoutingRemoteService
  calls: Array<{ method: string; params: Record<string, unknown> }>
} {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = []
  const route: SessionRoute = { targetId: 'target-1', workspaceId: WORKSPACE as never, remoteCwd: REMOTE }
  const facade: RoutingRemoteService = {
    routeForCwd: (cwd: string | undefined) => (cwd === STUB ? route : undefined),
    locateRemoteSession: async (sessionId: string) => (sessionId === 'session-remote' ? route : undefined),
    stubForWorkspace: (workspaceId: string) => (workspaceId === WORKSPACE ? STUB : undefined),
    remotePathForWorkspace: (workspaceId: string) => (workspaceId === WORKSPACE ? REMOTE : undefined),
    sessionRequest: async <T,>(targetId: string, method: string, params: unknown): Promise<T> => {
      calls.push({ method, params: (params ?? {}) as Record<string, unknown> })
      if (targetId !== 'target-1') throw new Error(`unexpected target ${targetId}`)
      if (method === 'persist/create') {
        return { handleId: 'handle-1', header: header('session-new', REMOTE), nextSeq: 0 } as T
      }
      if (method === 'persist/open') {
        // The durable header names the *old* client's target-scoped preset; the
        // routing must re-anchor it on this connection's preset.
        return {
          handleId: 'handle-2',
          header: { ...header('session-remote', REMOTE), agentPreset: 'remote:rt-old-target' },
          eventCount: 2,
        } as T
      }
      if (method === 'persist/stat') {
        return { header: header('session-remote', REMOTE) } as T
      }
      if (method === 'persist.read') {
        return { events: [], eventState: 'detached', nextOffset: 2 } as T
      }
      return null as T
    },
  }
  return { facade, calls }
}

const contexts: Context[] = []
let root: string | undefined

afterAll(async () => {
  while (contexts.length > 0) await (contexts.pop() as Context).fiber.dispose().catch(() => {})
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

describe('createRoutingPersistence with an injected v1 facade', () => {
  it('does not depend on ctx.remoteWorkspaces and routes creates with remoteCwd/executor', async () => {
    root = await mkdtemp(join(tmpdir(), 'rw-routing-factory-'))
    const ctx = new Context()
    contexts.push(ctx)
    const { facade, calls } = fakeFacade()
    const persistence = createRoutingPersistence(ctx, { root }, facade)
    const handle = await persistence.create(header('session-new', STUB))
    expect(handle.header.cwd).toBe(STUB)
    const create = calls.find(call => call.method === 'persist/create')
    expect(create?.params).toMatchObject({
      remoteCwd: REMOTE,
      executor: 'local',
      header: { id: 'session-new', cwd: REMOTE },
    })
    expect(create?.params).not.toHaveProperty('workspaceId')
    await handle.close()
  })

  it('re-anchors stat/open through the same facade', async () => {
    root = await mkdtemp(join(tmpdir(), 'rw-routing-factory2-'))
    const ctx = new Context()
    contexts.push(ctx)
    const { facade } = fakeFacade()
    const persistence = createRoutingPersistence(ctx, { root }, facade)
    const opened = await persistence.open('session-remote' as never, 'write')
    expect(opened.header.cwd).toBe(STUB)
    // The stored header keeps whatever the server wrote; only the live handle
    // is re-anchored on this connection's execution world.
    expect(opened.header.agentPreset).toBe('remote:target-1')
    const snapshot = await persistence.stat('session-remote' as never)
    expect(snapshot?.header.cwd).toBe(STUB)
    await opened.close()
  })
})
