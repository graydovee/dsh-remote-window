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
import { officialWorkspaceFor, shouldRegisterShellWorkspaces } from '../src/provision/service.ts'

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
  it('registers by default (current behaviour)', () => {
    expect(shouldRegisterShellWorkspaces({})).toBe(true)
    expect(shouldRegisterShellWorkspaces({ DSH_RW_NO_SHELL_WORKSPACES: '' })).toBe(true)
    expect(shouldRegisterShellWorkspaces({ DSH_RW_NO_SHELL_WORKSPACES: '0' })).toBe(true)
    expect(shouldRegisterShellWorkspaces({ DSH_RW_NO_SHELL_WORKSPACES: 'false' })).toBe(true)
  })

  it('turns off for the documented truthy spellings', () => {
    for (const value of ['1', 'true', 'TRUE', ' yes ', 'on']) {
      expect(shouldRegisterShellWorkspaces({ DSH_RW_NO_SHELL_WORKSPACES: value })).toBe(false)
    }
  })
})

describe('officialWorkspaceFor', () => {
  it('reuses an entry that already stands for the stub', async () => {
    const existing = { id: 'official-0', path: '/stub', title: 'w', attachSession: async () => {} }
    const { registry } = fakeRegistry({ existing })
    const official = await officialWorkspaceFor({ registry, canonicalStub: '/stub', shellTitle: 'w · target' })
    expect(official).toBe(existing)
    expect(registry.create).not.toHaveBeenCalled()
  })

  it('creates the row with the canonical stub and the display title', async () => {
    const { registry } = fakeRegistry()
    const official = await officialWorkspaceFor({ registry, canonicalStub: '/home/u/.dsh/remote-workspaces/rt-1/abcd', shellTitle: 'projects · box' })
    expect(registry.create).toHaveBeenCalledTimes(1)
    expect(registry.create).toHaveBeenCalledWith('/home/u/.dsh/remote-workspaces/rt-1/abcd', 'projects · box')
    expect(official?.id).toBe('official-1')
  })

  it('never touches the registry when the switch is on', async () => {
    vi.stubEnv('DSH_RW_NO_SHELL_WORKSPACES', '1')
    const { registry } = fakeRegistry()
    const official = await officialWorkspaceFor({ registry, canonicalStub: '/stub', shellTitle: 'w · target' })
    expect(official).toBeUndefined()
    expect(registry.resolveByPath).not.toHaveBeenCalled()
    expect(registry.create).not.toHaveBeenCalled()
  })

  it('tolerates a missing registry (no shell service in this host)', async () => {
    const official = await officialWorkspaceFor({ registry: undefined, canonicalStub: '/stub', shellTitle: 'w · target' })
    expect(official).toBeUndefined()
  })

  it('treats a refusing registry as "no row", not as an open failure', async () => {
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
