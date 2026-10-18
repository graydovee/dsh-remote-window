/**
 * Gate 0: is the official shell workspace row *required* for a remote session?
 *
 * The plugin used to register every remote stub in the shell's global workspace
 * registry (`~/.dsh/storages/workspace.json`) before creating a session. That file
 * is shared by every dsh on the machine, so the rows leak into clients that have
 * no plugin at all (a desktop install shows `…\.dsh\remote-workspaces\rt-…\…`),
 * and nothing removes them.
 *
 * The static finding behind the switch (see `officialWorkspaceFor`'s note) is that
 * nothing in the **open** path needs the row:
 *
 * - `attachSession` is the only official call on our path, it rejects a session
 *   whose `realpath(header.cwd) !== path`, and it is skipped entirely when the row
 *   is absent (`materialized.official?.attachSession`);
 * - registry membership is a *filter* (`candidateMatches` → warn + drop), not an
 *   enforcement;
 * - the only other `workspaceRegistry` consumer in the shipped tree is
 *   `dsh-api-session-controller`, which our `ctx.agents.create` path bypasses.
 *
 * These tests pin the switch itself: with `DSH_RW_NO_SHELL_WORKSPACES=1` the
 * registry is never touched, while the stub path (ours, used for routing) still
 * comes from the caller.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { officialWorkspaceFor, RemoteWorkspaces, shouldRegisterShellWorkspaces } from '../src/provision/service.ts'
import type { TargetStore } from '../src/targets/store.ts'

/** A registry stand-in that records what the plugin asks of it. */
function fakeRegistry(options: { existing?: { id: string; path: string; attachSession: (sessionId: string) => Promise<void> }; createFails?: boolean } = {}): {
  registry: { create: ReturnType<typeof vi.fn>; resolveByPath: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }
} {
  return {
    registry: {
      resolveByPath: vi.fn(() => options.existing),
      create: vi.fn(async (path: string, title: string) => {
        if (options.createFails === true) throw new Error('registry refused the row')
        return { id: 'official-1', path, title, attachSession: async () => {} }
      }),
      delete: vi.fn(async () => {}),
    },
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('shouldRegisterShellWorkspaces', () => {
  it('is OFF by default (Gate 0 branch A: no shell rows)', () => {
    expect(shouldRegisterShellWorkspaces({})).toBe(false)
    expect(shouldRegisterShellWorkspaces({ DSH_RW_FORCE_SHELL_WORKSPACES: '' })).toBe(false)
    expect(shouldRegisterShellWorkspaces({ DSH_RW_FORCE_SHELL_WORKSPACES: '0' })).toBe(false)
    expect(shouldRegisterShellWorkspaces({ DSH_RW_FORCE_SHELL_WORKSPACES: 'false' })).toBe(false)
  })

  it('the escape hatch restores the old behaviour', () => {
    for (const value of ['1', 'true', 'TRUE', ' yes ', 'on']) {
      expect(shouldRegisterShellWorkspaces({ DSH_RW_FORCE_SHELL_WORKSPACES: value })).toBe(true)
    }
  })
})

describe('routing without a shell row', () => {
  it('routes a stub-cwd session from our own record fields (no officialWorkspaceId needed)', async () => {
    const { RemoteWorkspaces } = await import('../src/provision/service.ts')
    // A record as the switch-on path writes it: `stubPath` ours, no official id.
    const record = {
      id: 'rw-1',
      targetId: 'rt-1',
      path: '/home/graydove/projects',
      stubPath: 'C:\\Users\\grayd\\.dsh\\remote-workspaces\\rt-1\\abcd1234',
      remoteWorkspaceId: '0123456789abcdef',
      title: 'projects',
      createdAt: '2026-10-18T00:00:00.000Z',
    }
    const store = { listWorkspaces: () => [record] } as unknown as TargetStore
    const ctx = { get: () => undefined } as unknown as Context
    const service = new RemoteWorkspaces(ctx, store, { packageRoot: process.cwd(), leaseMs: 30_000, maxProcesses: 4 })
    expect(service.routeForCwd(record.stubPath)).toEqual({ targetId: 'rt-1', workspaceId: '0123456789abcdef' })
    expect(service.stubForWorkspace('0123456789abcdef')).toBe(record.stubPath)
  })
})

describe('officialWorkspaceFor', () => {
  it('does not touch the registry by default (branch A)', async () => {
    const { registry } = fakeRegistry()
    const official = await officialWorkspaceFor({ registry, canonicalStub: '/stub', shellTitle: 'w · target' })
    expect(official).toBeUndefined()
    expect(registry.resolveByPath).not.toHaveBeenCalled()
    expect(registry.create).not.toHaveBeenCalled()
  })

  it('reuses an entry that already stands for the stub (escape hatch on)', async () => {
    vi.stubEnv('DSH_RW_FORCE_SHELL_WORKSPACES', '1')
    const existing = { id: 'official-0', path: '/stub', title: 'w', attachSession: async () => {} }
    const { registry } = fakeRegistry({ existing })
    const official = await officialWorkspaceFor({ registry, canonicalStub: '/stub', shellTitle: 'w · target' })
    expect(official).toBe(existing)
    expect(registry.create).not.toHaveBeenCalled()
  })

  it('creates the row with the canonical stub and the display title (escape hatch on)', async () => {
    vi.stubEnv('DSH_RW_FORCE_SHELL_WORKSPACES', '1')
    const { registry } = fakeRegistry()
    const official = await officialWorkspaceFor({ registry, canonicalStub: '/home/u/.dsh/remote-workspaces/rt-1/abcd', shellTitle: 'projects · box' })
    expect(registry.create).toHaveBeenCalledTimes(1)
    expect(registry.create).toHaveBeenCalledWith('/home/u/.dsh/remote-workspaces/rt-1/abcd', 'projects · box')
    expect(official?.id).toBe('official-1')
  })

  it('tolerates a missing registry (no shell service in this host)', async () => {
    vi.stubEnv('DSH_RW_FORCE_SHELL_WORKSPACES', '1')
    const official = await officialWorkspaceFor({ registry: undefined, canonicalStub: '/stub', shellTitle: 'w · target' })
    expect(official).toBeUndefined()
  })

  it('treats a refusing registry as "no row", not as an open failure', async () => {
    vi.stubEnv('DSH_RW_FORCE_SHELL_WORKSPACES', '1')
    const { registry } = fakeRegistry({ createFails: true })
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const official = await officialWorkspaceFor({ registry, canonicalStub: '/stub', shellTitle: 'w · target' })
      expect(official).toBeUndefined()
      // The failure is loud in the log, silent to the user's session.
      expect(errorLog).toHaveBeenCalledWith(
        '[dsh-remote-workspace] registering the workspace in the shell tree failed',
        expect.any(Error),
      )
    } finally {
      errorLog.mockRestore()
    }
  })
})
