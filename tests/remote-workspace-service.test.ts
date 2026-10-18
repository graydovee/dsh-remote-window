/**
 * The `remoteWorkspaces` facade: interface member ⊆ provided key, and forwarding.
 *
 * Measured defect this pins (alpha52, D4): `ctx.provide` takes an untyped object,
 * so the facade literal had drifted from `RemoteWorkspaceService` —
 * `remoteClient`/`releaseRemoteClient` were **missing**, the realm's
 * `ctx.ssh.start()` threw `workspaces.remoteClient is not a function`, and every
 * tool call in a remote session failed while the session itself looked fine.
 *
 * Two layers of protection, both asserted here:
 *
 * 1. **Compile time** — `remoteWorkspaceService()` declares its return type as
 *    `RemoteWorkspaceService`, so a missing member is a `tsc` error at the
 *    assembly point. The `satisfies`/`Exclude` below additionally fails to
 *    compile if this test's member list falls behind the interface.
 * 2. **Runtime** — every interface member is a key of the produced facade, and
 *    each key forwards to the instance with the caller's arguments (so a key
 *    cannot be a stub that returns nothing).
 */
import { describe, expect, it, vi } from 'vitest'
import { remoteWorkspaceService } from '../src/index.ts'
import type { RemoteWorkspaceService } from '../src/targets/types.ts'
import type { RemoteWorkspaces } from '../src/provision/service.ts'

/** Every member of the interface the realm resolves (mirror of targets/types.ts). */
const MEMBERS = [
  'connectChannel',
  'remoteClient',
  'releaseRemoteClient',
  'expectedDigest',
  'getPackagePolicy',
  'pathAliases',
  'setPackagePolicy',
  'routeForCwd',
  'stubForWorkspace',
  'locateRemoteSession',
  'sessionRequest',
] as const satisfies readonly (keyof RemoteWorkspaceService)[]

// Exhaustiveness at compile time: if the interface grows a member that is not in
// MEMBERS, `MissingMember` stops being `never` and this line fails to typecheck.
type MissingMember = Exclude<keyof RemoteWorkspaceService, (typeof MEMBERS)[number]>
const NO_MISSING_MEMBER: MissingMember extends never ? true : MissingMember = true

/** A recording stand-in for the real host-plane service. */
function stubWorkspaces(): { stub: RemoteWorkspaces; seen: string[]; client: { hello: { hash: string; root: string; workspace: string } } } {
  const seen: string[] = []
  const client = { hello: { hash: 'h', root: '/', workspace: '/' } }
  const stub = {
    connectChannel: vi.fn(async (targetId: string) => { seen.push(`connectChannel:${targetId}`); return { channel: 'channel' } }),
    remoteClient: vi.fn(async (targetId: string) => { seen.push(`remoteClient:${targetId}`); return client }),
    releaseRemoteClient: vi.fn((targetId: string) => { seen.push(`releaseRemoteClient:${targetId}`) }),
    expectedDigest: vi.fn(async (targetId: string) => { seen.push(`expectedDigest:${targetId}`); return undefined }),
    getPackagePolicy: vi.fn(() => {
      seen.push('getPackagePolicy')
      return { policy: 'auto' as const, mirror: '' }
    }),
    pathAliases: vi.fn((targetId: string) => { seen.push(`pathAliases:${targetId}`); return [] }),
    setPackagePolicy: vi.fn(async (settings: { policy: string }) => { seen.push(`setPackagePolicy:${settings.policy}`) }),
    routeForCwd: vi.fn((cwd: string | undefined) => { seen.push(`routeForCwd:${cwd ?? ''}`); return undefined }),
    stubForWorkspace: vi.fn((workspaceId: string) => { seen.push(`stubForWorkspace:${workspaceId}`); return undefined }),
    locateRemoteSession: vi.fn(async (sessionId: string) => { seen.push(`locateRemoteSession:${sessionId}`); return undefined }),
    sessionRequest: vi.fn(async (targetId: string, method: string) => { seen.push(`sessionRequest:${targetId}:${method}`); return null }),
  }
  return { stub: stub as unknown as RemoteWorkspaces, seen, client }
}

describe('remoteWorkspaceService', () => {
  it('exposes every interface member (alpha52 was missing remoteClient)', () => {
    expect(NO_MISSING_MEMBER).toBe(true)
    const { stub } = stubWorkspaces()
    const facade = remoteWorkspaceService(stub)
    expect(Object.keys(facade).sort()).toEqual([...MEMBERS].sort())
    // The two the realm cannot live without:
    expect(typeof facade.remoteClient).toBe('function')
    expect(typeof facade.releaseRemoteClient).toBe('function')
  })

  it('forwards every member to the instance with the caller arguments', async () => {
    const { stub, seen, client } = stubWorkspaces()
    const facade: RemoteWorkspaceService = remoteWorkspaceService(stub)

    await facade.connectChannel('rt-1')
    // The realm pins the target's single shared client — identity matters.
    expect(await facade.remoteClient('rt-1')).toBe(client)
    facade.releaseRemoteClient('rt-1')
    await facade.expectedDigest('rt-1')
    facade.getPackagePolicy()
    facade.pathAliases('rt-1')
    await facade.setPackagePolicy({ policy: 'upload', mirror: '' })
    facade.routeForCwd('/tmp/stub')
    facade.stubForWorkspace('rw-1')
    await facade.locateRemoteSession('sess-1')
    await facade.sessionRequest('rt-1', 'persist.list', {})

    expect(seen).toEqual([
      'connectChannel:rt-1',
      'remoteClient:rt-1',
      'releaseRemoteClient:rt-1',
      'expectedDigest:rt-1',
      'getPackagePolicy',
      'pathAliases:rt-1',
      'setPackagePolicy:upload',
      'routeForCwd:/tmp/stub',
      'stubForWorkspace:rw-1',
      'locateRemoteSession:sess-1',
      'sessionRequest:rt-1:persist.list',
    ])
  })

  it('passes the abort signal through to connectChannel', async () => {
    const { stub } = stubWorkspaces()
    const facade = remoteWorkspaceService(stub)
    const controller = new AbortController()
    await facade.connectChannel('rt-1', controller.signal)
    expect(stub.connectChannel).toHaveBeenCalledWith('rt-1', controller.signal)
  })
})
