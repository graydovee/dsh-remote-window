import { describe, expect, it } from 'vitest'
import { choiceFromScan, choiceReady, packageSourceOf, reusePathOf, usableCandidate, type RuntimeChoice } from '../src/client/runtime-choice.ts'
import type { DshCandidate } from '../src/client/api.ts'

/** One scan candidate; only the fields the helpers read are set. */
function candidate(overrides: Partial<DshCandidate> = {}): DshCandidate {
  return {
    path: '/usr/local/bin/dsh',
    realPath: '/usr/local/bin/dsh',
    version: '0.2.1-rc.3',
    compatible: true,
    executable: true,
    selfContained: true,
    origin: 'system',
    ...overrides,
  }
}

describe('packageSourceOf / reusePathOf', () => {
  it('maps every choice onto exactly one wire value', () => {
    expect(packageSourceOf(null)).toBeUndefined()
    expect(packageSourceOf({ kind: 'reuse', path: '/x/dsh' })).toBe('reuse')
    expect(packageSourceOf({ kind: 'upload' })).toBe('upload')
    expect(packageSourceOf({ kind: 'download' })).toBe('download')
  })

  it('exposes a launcher only for a reuse choice', () => {
    expect(reusePathOf(null)).toBeUndefined()
    expect(reusePathOf({ kind: 'reuse', path: '/x/dsh' })).toBe('/x/dsh')
    expect(reusePathOf({ kind: 'upload' })).toBeUndefined()
    expect(reusePathOf({ kind: 'download' })).toBeUndefined()
  })
})

describe('usableCandidate', () => {
  it('requires the exact path plus a verified runtime and an executable file', () => {
    const rows = [candidate({ path: '/a' }), candidate({ path: '/b', compatible: false }), candidate({ path: '/c', executable: false })]
    expect(usableCandidate(rows, '/a')?.path).toBe('/a')
    expect(usableCandidate(rows, '/b')).toBeUndefined()
    expect(usableCandidate(rows, '/c')).toBeUndefined()
    expect(usableCandidate(rows, '/missing')).toBeUndefined()
  })
})

describe('choiceReady', () => {
  it('is false until something is chosen', () => {
    expect(choiceReady(null, [])).toBe(false)
  })

  it('accepts a deploy choice without depending on the scan', () => {
    expect(choiceReady({ kind: 'upload' }, [])).toBe(true)
    expect(choiceReady({ kind: 'download' }, [])).toBe(true)
  })

  it('requires the reuse target to still be usable', () => {
    const rows = [candidate({ path: '/a' }), candidate({ path: '/b', compatible: false })]
    expect(choiceReady({ kind: 'reuse', path: '/a' }, rows)).toBe(true)
    expect(choiceReady({ kind: 'reuse', path: '/b' }, rows)).toBe(false)
    expect(choiceReady({ kind: 'reuse', path: '/gone' }, rows)).toBe(false)
  })
})

describe('choiceFromScan', () => {
  const current: RuntimeChoice = { kind: 'reuse', path: '/kept' }

  it('keeps a reuse pick that is still usable', () => {
    const rows = [candidate({ path: '/kept' }), candidate({ path: '/other', profile: { name: 'web', upToDate: true } })]
    expect(choiceFromScan(rows, current)).toEqual(current)
  })

  it('keeps a deploy pick — a rescan does not undo it', () => {
    expect(choiceFromScan([candidate()], { kind: 'download' })).toEqual({ kind: 'download' })
  })

  it('preselects an up-to-date install first, then any usable one', () => {
    const upToDate = candidate({ path: '/fresh', profile: { name: 'web', upToDate: true } })
    const other = candidate({ path: '/other' })
    expect(choiceFromScan([other, upToDate], null)).toEqual({ kind: 'reuse', path: '/fresh' })
    expect(choiceFromScan([other, candidate({ path: '/bad', compatible: false })], null)).toEqual({ kind: 'reuse', path: '/other' })
  })

  it('returns null when nothing is usable instead of inventing a pick', () => {
    expect(choiceFromScan([], null)).toBeNull()
    expect(choiceFromScan([candidate({ compatible: false })], null)).toBeNull()
    expect(choiceFromScan([candidate({ executable: false })], { kind: 'reuse', path: '/stale' })).toBeNull()
  })
})
