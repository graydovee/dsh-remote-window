/**
 * Target-record plumbing: what a connect writes into the record.
 *
 * Two measured defects live here, both "a contract field with a broken producer":
 *
 * - **F0** `runConnect` rebuilt `remote` from the wizard payload only, so a
 *   same-label re-connect reset `dshHome`/`profile`/`nodePath`/`dshCommand`/
 *   `plugins` back to defaults. `DSH_HOME` decides where remote sessions live, so
 *   a reset `dshHome` makes history look lost and re-provisions the plugin into
 *   `~/.dsh`. The rule pinned below: request → existing record → default.
 * - **F1** `serverPackage` had no producer at all: schema + type existed, nothing
 *   ever wrote one, and `publicTarget` did not expose it. `provisionedHints()` is
 *   now the single producer, shared by both connect paths.
 */
import { describe, expect, it } from 'vitest'
import {
  provisionedHints,
  publicTarget,
  targetDraftFrom,
  type ConnectRequest,
} from '../src/provision/service.ts'
import type { RemoteTargetRecord } from '../src/targets/types.ts'
import type { TargetStore } from '../src/targets/store.ts'

/** A record as a previous connection would have left it. */
const EXISTING: RemoteTargetRecord = {
  id: 'rt-abc12345',
  label: 'box',
  kind: 'ssh',
  host: '10.0.0.9',
  port: 22,
  username: 'graydove',
  authKind: 'agent',
  hostKeyFingerprint: 'SHA256:pinned',
  packageSource: 'reuse',
  reuseDsh: { path: '/opt/node/bin/dsh', version: '0.2.1-rc.2', scannedAt: '2026-01-01T00:00:00.000Z' },
  platformProbe: { platform: 'linux', arch: 'arm64', libc: 'gnu', tag: 'linux-arm64-gnu', probedAt: '2026-01-01T00:00:00.000Z' },
  serverPackage: { artifact: 'dsh-remote-server-0.2.1-rc.2-linux-arm64-gnu.tar.gz', sha256: 'a'.repeat(64), version: '0.2.1-rc.2' },
  remote: {
    nodePath: '/opt/node/bin/node',
    dshCommand: 'dsh-next',
    profile: 'custom-profile',
    dshHome: '~/custom-dsh',
    plugins: ['plugin-a'],
  },
  status: 'stopped',
  lastConnectedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2025-12-31T00:00:00.000Z',
}

/** The wizard's payload for a re-connect: no `remote` block at all. */
const REQUEST: ConnectRequest = {
  label: 'BOX',
  kind: 'ssh',
  host: '10.0.0.9',
  port: 22,
  username: 'graydove',
  authKind: 'agent',
}

describe('targetDraftFrom (F0)', () => {
  it('does not reset the remote runtime when the request omits it', () => {
    const draft = targetDraftFrom({ request: REQUEST, existing: EXISTING })
    expect(draft.remote).toEqual(EXISTING.remote)
    // The rest of the record's identity and hints survive too.
    expect(draft).toMatchObject({
      id: EXISTING.id,
      createdAt: EXISTING.createdAt,
      hostKeyFingerprint: 'SHA256:pinned',
      reuseDsh: EXISTING.reuseDsh,
      platformProbe: EXISTING.platformProbe,
      serverPackage: EXISTING.serverPackage,
    })
    // A re-connect starts from 'unknown' status, whatever the old one was.
    expect(draft.status).toBe('unknown')
  })

  it('lets an explicitly sent field override the stored one, per field', () => {
    const draft = targetDraftFrom({
      request: { ...REQUEST, remote: { dshHome: '/data/dsh', plugins: ['plugin-b'] } },
      existing: EXISTING,
    })
    expect(draft.remote).toEqual({
      nodePath: '/opt/node/bin/node',
      dshCommand: 'dsh-next',
      profile: 'custom-profile',
      dshHome: '/data/dsh',
      plugins: ['plugin-b'],
    })
  })

  it('falls back to the documented defaults for a brand-new target', () => {
    const draft = targetDraftFrom({ request: REQUEST, now: '2026-02-02T00:00:00.000Z', id: 'rt-fixed000' })
    expect(draft.remote).toEqual({ nodePath: 'node', dshCommand: 'dsh', profile: 'dsh-remote-server', dshHome: '~/.dsh', plugins: [] })
    expect(draft.id).toBe('rt-fixed000')
    expect(draft.createdAt).toBe('2026-02-02T00:00:00.000Z')
    expect(draft.hostKeyFingerprint).toBe('')
    expect('reuseDsh' in draft).toBe(false)
    expect('serverPackage' in draft).toBe(false)
  })

  it('keeps a WSL target a WSL target, with no host key and the distro as host', () => {
    const draft = targetDraftFrom({
      request: { label: 'ubuntu', kind: 'wsl', host: 'ignored', port: 1, username: 'ignored', authKind: 'agent', wslDistro: 'Ubuntu-22.04', wslUser: 'graydove' },
      existing: { ...EXISTING, kind: 'wsl', host: 'Ubuntu-22.04', wslDistro: 'Ubuntu-22.04' },
    })
    expect(draft).toMatchObject({ kind: 'wsl', host: 'Ubuntu-22.04', port: 22, username: 'graydove', authKind: 'agent', hostKeyFingerprint: '', wslDistro: 'Ubuntu-22.04', wslUser: 'graydove' })
    // The remote runtime still comes from the record, not from defaults.
    expect(draft.remote.dshHome).toBe('~/custom-dsh')
  })

  it('refuses a WSL request without a distribution', () => {
    expect(() => targetDraftFrom({ request: { ...REQUEST, kind: 'wsl' } })).toThrow(/needs a distribution/)
  })
})

describe('provisionedHints (F1)', () => {
  const probe = { platform: 'linux' as const, arch: 'arm64' as const, libc: 'gnu' as const, tag: 'linux-arm64-gnu' }

  it('records the deployed package after a successful upload connect', () => {
    const hints = provisionedHints(
      {
        probe,
        package: { artifact: 'dsh-remote-server-0.2.1-rc.2-linux-arm64-gnu.tar.gz', sha256: 'b'.repeat(64), version: '0.2.1-rc.2' },
      },
      '2026-03-03T00:00:00.000Z',
    )
    expect(hints.serverPackage).toEqual({
      artifact: 'dsh-remote-server-0.2.1-rc.2-linux-arm64-gnu.tar.gz',
      sha256: 'b'.repeat(64),
      version: '0.2.1-rc.2',
    })
    expect(hints.platformProbe).toEqual({ ...probe, probedAt: '2026-03-03T00:00:00.000Z' })
    expect('reuseDsh' in hints).toBe(false)
  })

  it('records the reused launcher and no package in reuse mode', () => {
    const hints = provisionedHints(
      { probe, reuse: { path: '/opt/node/bin/dsh', version: '0.2.1-rc.2', nodePath: '/opt/node/bin/node' } },
      '2026-03-03T00:00:00.000Z',
    )
    expect(hints.reuseDsh).toEqual({ path: '/opt/node/bin/dsh', version: '0.2.1-rc.2', nodePath: '/opt/node/bin/node', scannedAt: '2026-03-03T00:00:00.000Z' })
    expect('serverPackage' in hints).toBe(false)
  })

  it('omits nodePath when the launcher was self-contained', () => {
    const hints = provisionedHints({ probe, reuse: { path: '/usr/local/bin/dsh', version: '0.2.1' } }, '2026-03-03T00:00:00.000Z')
    expect(hints.reuseDsh).toEqual({ path: '/usr/local/bin/dsh', version: '0.2.1', scannedAt: '2026-03-03T00:00:00.000Z' })
  })
})

describe('publicTarget', () => {
  const store = { credentialKeyOf: () => 'remote-workspace/rt-abc12345' } as unknown as TargetStore

  it('exposes packageSource, reuseDsh, platformProbe and serverPackage', () => {
    const target = publicTarget(EXISTING, store)
    expect(target).toMatchObject({
      packageSource: 'reuse',
      reuseDsh: EXISTING.reuseDsh,
      platformProbe: EXISTING.platformProbe,
      serverPackage: EXISTING.serverPackage,
    })
  })

  it('carries no secret, no key material and no credential reference', () => {
    const target = publicTarget(EXISTING, store) as unknown as Record<string, unknown>
    expect('secret' in target).toBe(false)
    expect('privateKey' in target).toBe(false)
    expect('credentialKey' in target).toBe(false)
    expect(target.hasStoredSecret).toBe(true)
  })
})
