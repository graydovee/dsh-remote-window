/**
 * Defect B (alpha54): a remote workspace must never open a session whose tools run
 * on the **local** machine.
 *
 * Observed: an older connection (`rt-ba4f4ebf`) answered `pwd` with the local stub
 * directory and wrote `.dsh-rw-remote-proof` on *this* machine while the remote
 * never saw it — the model had only the local `pwsh` tool, i.e. the session was
 * composed with a shipped preset and our realm was never mounted. A remote
 * workspace that silently degrades to local execution is worse than one that
 * refuses to open, because it looks like success.
 *
 * The three guards below are the enforcement points, and the last two tests drive
 * them through `RemoteWorkspaces` so the *wiring* (guard runs before anything is
 * materialized) is covered too.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { assertLiveSessionInRealm, assertRealmComposed, assertRemoteRealm, RemoteWorkspaces } from '../src/provision/service.ts'
import type { TargetStore } from '../src/targets/store.ts'

const PRESET = 'remote:rt-abc12345'

/** A refusal as the route layer reports it. */
async function refusal(work: Promise<unknown> | (() => unknown)): Promise<{ code: string; message: string }> {
  try {
    await (typeof work === 'function' ? work() : work)
  } catch (error) {
    const coded = error as { code?: string; message?: string }
    return { code: coded.code ?? '', message: coded.message ?? '' }
  }
  throw new Error('expected a refusal')
}

/** A host context with just the services these guards read. */
function fakeContext(options: {
  presets?: {
    resolve?: (id: string) => Promise<{ id: string; broken?: string }>
    composedPreset?: (ctx: Context) => string | undefined
    serviceFor?: (agent: { ctx: Context }, name: string) => unknown
  }
  live?: { ctx: Context }
}): Context {
  const presets = {
    resolve: options.presets?.resolve ?? (async (id: string) => ({ id })),
    composedPreset: options.presets?.composedPreset ?? (() => PRESET),
    serviceFor: options.presets?.serviceFor ?? (() => ({ kind: 'ssh-realm' })),
  }
  const services: Record<string, unknown> = {
    agentPresets: presets,
    agents: { get: () => options.live },
  }
  return { get: (name: string) => services[name] } as unknown as Context
}

describe('assertRemoteRealm', () => {
  it('returns the target preset id when the preset is registered and usable', async () => {
    await expect(assertRemoteRealm(fakeContext({ presets: { resolve: async id => ({ id }) } }), 'rt-abc12345')).resolves.toBe(PRESET)
  })

  it('refuses when the preset registry is unavailable', async () => {
    const ctx = { get: () => undefined } as unknown as Context
    const refused = await refusal(assertRemoteRealm(ctx, 'rt-abc12345'))
    expect(refused.code).toBe('realm-unavailable')
    expect(refused.message).toContain('rt-abc12345')
    expect(refused.message).toContain(PRESET)
    expect(refused.message).toContain('run on this machine')
  })

  it('refuses when the preset was never registered (old target, restarted host)', async () => {
    const ctx = fakeContext({
      presets: {
        resolve: async () => {
          throw new Error('Unknown agent preset: remote:rt-abc12345')
        },
      },
    })
    const refused = await refusal(assertRemoteRealm(ctx, 'rt-abc12345'))
    expect(refused.code).toBe('realm-unavailable')
    expect(refused.message).toContain('not registered')
    expect(refused.message).toContain('Unknown agent preset')
  })

  it('refuses a silent substitution with another (local) preset', async () => {
    const ctx = fakeContext({ presets: { resolve: async () => ({ id: 'shipped-default' }) } })
    const refused = await refusal(assertRemoteRealm(ctx, 'rt-abc12345'))
    expect(refused.code).toBe('realm-unavailable')
    expect(refused.message).toContain('shipped-default')
    expect(refused.message).toContain(PRESET)
  })

  it('refuses a preset whose activation failed, quoting the diagnostic', async () => {
    const ctx = fakeContext({ presets: { resolve: async id => ({ id, broken: 'row "sandbox-ssh" is unusable: no ssh service' }) } })
    const refused = await refusal(assertRemoteRealm(ctx, 'rt-abc12345'))
    expect(refused.code).toBe('realm-unavailable')
    expect(refused.message).toContain('failed to activate')
    expect(refused.message).toContain('sandbox-ssh')
  })
})

describe('assertLiveSessionInRealm', () => {
  it('allows a live session that is composed with our preset', () => {
    const live = { ctx: {} as Context }
    expect(() => assertLiveSessionInRealm(fakeContext({ live }), 'rt-abc12345', 'session-1')).not.toThrow()
  })

  it('refuses a live session composed with another preset (the defect-B hole)', () => {
    const live = { ctx: {} as Context }
    const ctx = fakeContext({ live, presets: { composedPreset: () => 'dsh-minimal' } })
    let failure: { code: string; message: string } | undefined
    try {
      assertLiveSessionInRealm(ctx, 'rt-abc12345', 'session-1')
    } catch (error) {
      const coded = error as { code?: string; message?: string }
      failure = { code: coded.code ?? '', message: coded.message ?? '' }
    }
    expect(failure?.code).toBe('realm-unavailable')
    expect(failure?.message).toContain('session-1')
    expect(failure?.message).toContain('dsh-minimal')
    expect(failure?.message).toContain(PRESET)
  })

  it('ignores a session that is not live', () => {
    expect(() => assertLiveSessionInRealm(fakeContext({}), 'rt-abc12345', 'session-1')).not.toThrow()
  })
})

describe('assertRealmComposed', () => {
  it('accepts a session composed with our preset and carrying the realm ssh', () => {
    const live = { ctx: {} as Context }
    expect(() => assertRealmComposed(fakeContext({ live }), 'rt-abc12345', 'session-1')).not.toThrow()
  })

  it('refuses a session whose realm has no ssh service (realm mounted but empty)', () => {
    const live = { ctx: {} as Context }
    const ctx = fakeContext({ live, presets: { serviceFor: () => undefined } })
    let failure: { code: string; message: string } | undefined
    try {
      assertRealmComposed(ctx, 'rt-abc12345', 'session-1')
    } catch (error) {
      const coded = error as { code?: string; message?: string }
      failure = { code: coded.code ?? '', message: coded.message ?? '' }
    }
    expect(failure?.code).toBe('realm-unavailable')
    expect(failure?.message).toContain('no realm ssh service')
  })
})

describe('RemoteWorkspaces wiring', () => {
  /** A service whose store/channel access would fail loudly if it were reached. */
  function service(ctx: Context): RemoteWorkspaces {
    const forbidden = new Proxy({}, {
      get: () => () => {
        throw new Error('the store must not be touched when the realm is unavailable')
      },
    }) as unknown as TargetStore
    return new RemoteWorkspaces(ctx, forbidden, { packageRoot: process.cwd(), leaseMs: 30_000, maxProcesses: 4 })
  }

  it('refuses a new session before touching the store or the remote', async () => {
    const ctx = fakeContext({ presets: { resolve: async id => ({ id, broken: 'row "connection" is unusable' }) } })
    const refused = await refusal(service(ctx).openWorkspace('rt-abc12345', '/home/user/projects'))
    expect(refused.code).toBe('realm-unavailable')
    expect(refused.message).toContain('failed to activate')
  })

  it('refuses to resume a session when the realm is not available', async () => {
    const ctx = fakeContext({
      presets: {
        resolve: async () => {
          throw new Error('Unknown agent preset: remote:rt-abc12345')
        },
      },
    })
    const refused = await refusal(service(ctx).resumeSession('rt-abc12345', '/home/user/projects', 'session-1'))
    expect(refused.code).toBe('realm-unavailable')
    expect(refused.message).toContain('not registered')
  })
})
