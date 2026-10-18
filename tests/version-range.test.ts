/**
 * The version window that decides "can this remote dsh drive the plugin".
 *
 * The prerelease ordering is the part that bites: `rc.10` sorts **above** `rc.2`
 * numerically but below it lexicographically, and the supported floor is exactly
 * `0.2.1-rc.2` — so a naive string compare would call the floor itself
 * incompatible. These cases are the contract from `doc/api-contract.md` §8.
 */
import { describe, expect, it } from 'vitest'
import {
  compareDshVersion,
  describeIncompatibility,
  DSH_MAX_VERSION,
  DSH_MIN_VERSION,
  isCompatibleDsh,
  parseDshVersion,
} from '../src/provision/version-range.ts'

describe('parseDshVersion', () => {
  it('parses a bare release, a release with v prefix and a prerelease', () => {
    expect(parseDshVersion('0.2.1')).toEqual({ major: 0, minor: 2, patch: 1, prerelease: [] })
    expect(parseDshVersion('v0.2.1-rc.2')).toEqual({ major: 0, minor: 2, patch: 1, prerelease: ['rc', '2'] })
    expect(parseDshVersion('0.3.0-beta.10')).toEqual({ major: 0, minor: 3, patch: 0, prerelease: ['beta', '10'] })
  })

  it('finds the first version-looking token inside noisy output', () => {
    expect(parseDshVersion('dsh 0.2.1-rc.2')?.minor).toBe(2)
    expect(parseDshVersion('  v0.2.1\n')).toEqual({ major: 0, minor: 2, patch: 1, prerelease: [] })
    expect(parseDshVersion('no version here')).toBeUndefined()
    expect(parseDshVersion('')).toBeUndefined()
  })

  it('drops an empty trailing prerelease segment', () => {
    expect(parseDshVersion('0.2.1-rc.2.')?.prerelease).toEqual(['rc', '2'])
  })
})

describe('compareDshVersion', () => {
  const at = (text: string) => parseDshVersion(text)!
  const cmp = (left: string, right: string): number => compareDshVersion(at(left), at(right))

  it('orders the numeric segments', () => {
    expect(cmp('0.2.0', '0.2.1')).toBeLessThan(0)
    expect(cmp('0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(cmp('1.0.0', '0.99.99')).toBeGreaterThan(0)
    expect(cmp('0.2.1', '0.2.1')).toBe(0)
  })

  it('puts a release above its own prereleases', () => {
    expect(cmp('0.2.1-rc.2', '0.2.1')).toBeLessThan(0)
    expect(cmp('0.2.1', '0.2.1-rc.2')).toBeGreaterThan(0)
  })

  it('compares numeric prerelease identifiers by value', () => {
    // The lexical trap: 'rc.10' < 'rc.2' as strings, but rc.10 is the later one.
    expect(cmp('0.2.1-rc.10', '0.2.1-rc.2')).toBeGreaterThan(0)
    expect(cmp('0.2.1-rc.2', '0.2.1-rc.10')).toBeLessThan(0)
  })

  it('ranks numeric identifiers below alphanumeric ones', () => {
    expect(cmp('0.2.1-1', '0.2.1-rc')).toBeLessThan(0)
  })

  it('makes a prefix list the smaller version', () => {
    expect(cmp('0.2.1-rc.2', '0.2.1-rc.2.1')).toBeLessThan(0)
    expect(cmp('0.2.1-rc.2.1', '0.2.1-rc.2')).toBeGreaterThan(0)
  })

  it('compares alphanumeric identifiers by ASCII order', () => {
    expect(cmp('0.2.1-alpha', '0.2.1-beta')).toBeLessThan(0)
  })
})

describe('isCompatibleDsh', () => {
  it('pins the three explicit §8 conclusions in one place', () => {
    // `compare(v, 0.3.0) < 0` admits a prerelease *of* the ceiling, rejects the
    // ceiling itself, and rejects the prerelease just below the floor — the three
    // cases the architect calls out by name.
    expect(isCompatibleDsh('0.3.0-rc.1')).toBe(true)
    expect(isCompatibleDsh('0.3.0')).toBe(false)
    expect(isCompatibleDsh('0.2.1-rc.1')).toBe(false)
  })

  it('accepts the measured floor itself', () => {
    expect(isCompatibleDsh('0.2.1-rc.2')).toBe(true)
    expect(isCompatibleDsh(`v${DSH_MIN_VERSION}`)).toBe(true)
  })

  it('accepts releases inside the window', () => {
    expect(isCompatibleDsh('0.2.1')).toBe(true)
    expect(isCompatibleDsh('0.2.1-rc.10')).toBe(true)
    expect(isCompatibleDsh('0.2.9-rc.1')).toBe(true)
  })

  it('rejects everything below the floor', () => {
    expect(isCompatibleDsh('0.2.0-rc.9')).toBe(false)
    expect(isCompatibleDsh('0.2.1-rc.1')).toBe(false)
    expect(isCompatibleDsh('0.1.9')).toBe(false)
  })

  it('rejects the exclusive ceiling and above', () => {
    expect(isCompatibleDsh(DSH_MAX_VERSION)).toBe(false)
    expect(isCompatibleDsh('1.0.0')).toBe(false)
    // A prerelease *of* the ceiling sorts below it, so the window admits it —
    // exactly what `compare(v, 0.3.0) < 0` means (api-contract §8 rule 5).
    expect(isCompatibleDsh('0.3.0-rc.1')).toBe(true)
  })

  it('rejects unparseable text (a launcher that printed nothing)', () => {
    expect(isCompatibleDsh('garbage')).toBe(false)
    expect(isCompatibleDsh('')).toBe(false)
  })
})

describe('describeIncompatibility', () => {
  it('names the floor and the ceiling', () => {
    expect(describeIncompatibility('0.1.9')).toBe(`version 0.1.9 is below the supported floor ${DSH_MIN_VERSION}`)
    expect(describeIncompatibility('0.3.0')).toBe(`version 0.3.0 is at or above the unsupported ceiling ${DSH_MAX_VERSION}`)
  })

  it('explains an empty or unparseable answer', () => {
    expect(describeIncompatibility('')).toBe('the launcher printed no version')
    expect(describeIncompatibility('definitely-not-a-version')).toContain('is not a dsh version')
  })
})
