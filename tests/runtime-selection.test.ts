/**
 * The runtime planner's priority ladder, tested as a pure function.
 *
 * Every case names the interval explicitly instead of reading the compiled table,
 * because the interesting situations (an interval wider than one release, a
 * release whose artifact is missing, a remote global dsh above the upper bound)
 * are exactly the ones today's single-release table cannot express.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  describeSelection,
  selectRuntimeVersion,
  type RuntimeSelectionInput,
} from '../src/provision/runtime-selection.ts'

const TABLE = {
  schema: 2 as const,
  plugin: '0.1.0-alpha.4',
  dsh: { min: '0.2.1-rc.3', max: '0.2.2' },
  runtimes: [
    { dsh: '0.2.2', platforms: ['linux-x64-gnu', 'win32-x64'] },
    { dsh: '0.2.1-rc.3', platforms: ['linux-x64-gnu'] },
  ],
}

function input(overrides: Partial<RuntimeSelectionInput> = {}): RuntimeSelectionInput {
  return {
    range: TABLE.dsh,
    entries: TABLE.runtimes,
    platformArch: 'linux-x64-gnu',
    hostCanBuild: false,
    hasCache: () => false,
    canFetch: () => false,
    ...overrides,
  }
}

describe('selectRuntimeVersion', () => {
  it('uses an out-of-band artifact when its manifest is inside the interval', () => {
    expect(selectRuntimeVersion(input({ envVersion: '0.2.2' }))).toEqual({ ok: true, version: '0.2.2', source: 'env' })
  })

  it('refuses an out-of-band artifact above or below the interval', () => {
    // Silence would be worse than failing: the operator named this file, so an
    // incompatible one has to surface with the direction.
    expect(selectRuntimeVersion(input({ envVersion: '0.3.0' }))).toMatchObject({ ok: false, reason: 'too-new' })
    expect(selectRuntimeVersion(input({ envVersion: '0.2.1-rc.2' }))).toMatchObject({ ok: false, reason: 'too-old' })
  })

  it('reuses a healthy remote global dsh inside the interval before any artifact', () => {
    const selection = selectRuntimeVersion(input({
      remoteGlobal: { version: '0.2.1-rc.3', healthy: true },
      hasCache: () => true,
    }))
    expect(selection).toEqual({ ok: true, version: '0.2.1-rc.3', source: 'global' })
  })

  it('ignores an unhealthy or out-of-interval global dsh and takes the newest usable artifact', () => {
    const unhealthy = selectRuntimeVersion(input({
      remoteGlobal: { version: '0.2.2', healthy: false },
      hasCache: version => version === '0.2.1-rc.3',
    }))
    expect(unhealthy).toEqual({ ok: true, version: '0.2.1-rc.3', source: 'cache' })

    const tooNew = selectRuntimeVersion(input({
      remoteGlobal: { version: '0.3.0', healthy: true },
      hasCache: () => true,
    }))
    // Newest cached version wins, not the version the remote happens to have.
    expect(tooNew).toEqual({ ok: true, version: '0.2.2', source: 'cache' })
  })

  it('prefers the local cache over a release download of the same release', () => {
    expect(selectRuntimeVersion(input({ hasCache: version => version === '0.2.2', canFetch: () => true })))
      .toEqual({ ok: true, version: '0.2.2', source: 'cache' })
  })

  it('takes the newest runtime published for the remote platform', () => {
    expect(selectRuntimeVersion(input({ canFetch: () => true }))).toEqual({ ok: true, version: '0.2.2', source: 'release' })
  })

  it('falls back to a local build only when this host may build', () => {
    expect(selectRuntimeVersion(input({ hostCanBuild: true }))).toEqual({ ok: true, version: '0.2.2', source: 'build' })
    expect(selectRuntimeVersion(input({ hostCanBuild: false }))).toMatchObject({ ok: false, reason: 'no-artifact' })
  })

  it('skips runtimes without an artifact for the remote platform', () => {
    // 0.2.2 is win32-only here, so a linux target must fall through to 0.2.1-rc.3.
    const win32Only = [
      { dsh: '0.2.2', platforms: ['win32-x64'] },
      { dsh: '0.2.1-rc.3', platforms: ['linux-x64-gnu'] },
    ]
    expect(selectRuntimeVersion(input({ entries: win32Only, hasCache: () => true })))
      .toEqual({ ok: true, version: '0.2.1-rc.3', source: 'cache' })
    expect(selectRuntimeVersion(input({ entries: win32Only, platformArch: 'win32-x64', hasCache: () => true })))
      .toEqual({ ok: true, version: '0.2.2', source: 'cache' })
  })

  it('ignores table entries outside the interval', () => {
    const selection = selectRuntimeVersion(input({
      entries: [
        { dsh: '0.3.0', platforms: ['linux-x64-gnu'] },
        { dsh: '0.2.1-rc.3', platforms: ['linux-x64-gnu'] },
      ],
      hasCache: () => true,
    }))
    expect(selection).toEqual({ ok: true, version: '0.2.1-rc.3', source: 'cache' })
  })

  it('reports why nothing could be chosen', () => {
    expect(selectRuntimeVersion(input({ remoteGlobal: { version: '0.3.1', healthy: true } })))
      .toMatchObject({ ok: false, reason: 'too-new' })
    expect(selectRuntimeVersion(input({ remoteGlobal: { version: '0.2.1-rc.1', healthy: true } })))
      .toMatchObject({ ok: false, reason: 'too-old' })
    expect(selectRuntimeVersion(input({}))).toMatchObject({ ok: false, reason: 'no-artifact' })
  })

  it('never calls the cache or release probes for entries outside the interval', () => {
    const hasCache = vi.fn(() => false)
    const canFetch = vi.fn(() => false)
    selectRuntimeVersion(input({ entries: [{ dsh: '0.3.0', platforms: ['linux-x64-gnu'] }], hasCache, canFetch }))
    expect(hasCache).not.toHaveBeenCalled()
    expect(canFetch).not.toHaveBeenCalled()
  })
})

describe('describeSelection', () => {
  it('names the version and how it was obtained', () => {
    expect(describeSelection({ ok: true, version: '0.2.2', source: 'global' })).toBe('0.2.2 (reusing the global dsh)')
    expect(describeSelection({ ok: true, version: '0.2.2', source: 'build' })).toBe('0.2.2 (built locally)')
  })

  it('turns a refusal into the next action', () => {
    const tooNew = describeSelection({ ok: false, reason: 'too-new', version: '0.3.0', range: TABLE.dsh })
    expect(tooNew).toContain('0.3.0')
    expect(tooNew).toContain('upgrade the plugin')

    const tooOld = describeSelection({ ok: false, reason: 'too-old', version: '0.2.1-rc.1', range: TABLE.dsh })
    expect(tooOld).toContain("upgrade the server's dsh")

    const none = describeSelection({ ok: false, reason: 'no-artifact', range: TABLE.dsh })
    expect(none).toContain('no runtime artifact')
    expect(none).toContain('0.2.1-rc.3 … 0.2.2')
  })
})
