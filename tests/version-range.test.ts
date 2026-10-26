/**
 * The verified-runtime contract that decides "can this remote dsh drive the plugin".
 *
 * The gate is a membership test over `DSH_VERIFIED_RUNTIMES`, not a version
 * window: a release we have never exercised is rejected even when it sorts
 * inside a plausible range. The prerelease ordering below is still exercised
 * because the rejection wording uses it, and `rc.10` vs `rc.2` is the case a
 * naive string compare gets wrong.
 */
import { describe, expect, it } from 'vitest'
import {
  compareDshVersion,
  describeIncompatibility,
  DSH_VERIFIED_RUNTIMES,
  DSH_VERIFIED_SUMMARY,
  formatDshVersion,
  isCompatibleDsh,
  parseDshVersion,
} from '../src/provision/version-range.ts'

describe('parseDshVersion', () => {
  it('parses a bare release, a release with v prefix and a prerelease', () => {
    expect(parseDshVersion('0.2.1')).toEqual({ major: 0, minor: 2, patch: 1, prerelease: [] })
    expect(parseDshVersion('v0.2.1-rc.3')).toEqual({ major: 0, minor: 2, patch: 1, prerelease: ['rc', '3'] })
    expect(parseDshVersion('0.3.0-beta.10')).toEqual({ major: 0, minor: 3, patch: 0, prerelease: ['beta', '10'] })
  })

  it('finds the first version-looking token inside noisy output', () => {
    expect(parseDshVersion('dsh 0.2.1-rc.3')?.minor).toBe(2)
    expect(parseDshVersion('  v0.2.1\n')).toEqual({ major: 0, minor: 2, patch: 1, prerelease: [] })
    expect(parseDshVersion('no version here')).toBeUndefined()
    expect(parseDshVersion('')).toBeUndefined()
  })

  it('drops an empty trailing prerelease segment', () => {
    expect(parseDshVersion('0.2.1-rc.3.')?.prerelease).toEqual(['rc', '3'])
  })
})

describe('formatDshVersion', () => {
  it('canonicalizes the spelling used by the verified list', () => {
    expect(formatDshVersion(parseDshVersion('v0.2.1-rc.3')!)).toBe('0.2.1-rc.3')
    expect(formatDshVersion(parseDshVersion('0.2.1-rc.3+build.7')!)).toBe('0.2.1-rc.3')
    expect(formatDshVersion(parseDshVersion('0.2.1')!)).toBe('0.2.1')
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
    expect(cmp('0.2.1-rc.3', '0.2.1')).toBeLessThan(0)
    expect(cmp('0.2.1', '0.2.1-rc.3')).toBeGreaterThan(0)
  })

  it('compares numeric prerelease identifiers by value', () => {
    // The lexical trap: 'rc.10' < 'rc.2' as strings, but rc.10 is the later one.
    expect(cmp('0.2.1-rc.10', '0.2.1-rc.3')).toBeGreaterThan(0)
    expect(cmp('0.2.1-rc.3', '0.2.1-rc.10')).toBeLessThan(0)
  })

  it('ranks numeric identifiers below alphanumeric ones', () => {
    expect(cmp('0.2.1-1', '0.2.1-rc')).toBeLessThan(0)
  })

  it('makes a prefix list the smaller version', () => {
    expect(cmp('0.2.1-rc.3', '0.2.1-rc.3.1')).toBeLessThan(0)
    expect(cmp('0.2.1-rc.3.1', '0.2.1-rc.3')).toBeGreaterThan(0)
  })

  it('compares alphanumeric identifiers by ASCII order', () => {
    expect(cmp('0.2.1-alpha', '0.2.1-beta')).toBeLessThan(0)
  })
})

describe('isCompatibleDsh', () => {
  it('accepts the verified runtime however it is spelled', () => {
    for (const runtime of DSH_VERIFIED_RUNTIMES) {
      expect(isCompatibleDsh(runtime)).toBe(true)
      expect(isCompatibleDsh(`v${runtime}`)).toBe(true)
      expect(isCompatibleDsh(`dsh ${runtime}`)).toBe(true)
      expect(isCompatibleDsh(`${runtime}.`)).toBe(true)
      expect(isCompatibleDsh(`${runtime}+build.7`)).toBe(true)
    }
  })

  it('rejects any other release, including one inside a plausible window', () => {
    expect(isCompatibleDsh('0.2.1')).toBe(false)
    expect(isCompatibleDsh('0.2.1-rc.1')).toBe(false)
    expect(isCompatibleDsh('0.2.1-rc.10')).toBe(false)
    expect(isCompatibleDsh('0.2.2')).toBe(false)
    expect(isCompatibleDsh('0.2.9-rc.1')).toBe(false)
    expect(isCompatibleDsh('0.3.0-rc.1')).toBe(false)
    expect(isCompatibleDsh('0.3.0')).toBe(false)
    expect(isCompatibleDsh('0.1.9')).toBe(false)
    expect(isCompatibleDsh('1.0.0')).toBe(false)
  })

  it('rejects unparseable text (a launcher that printed nothing)', () => {
    expect(isCompatibleDsh('garbage')).toBe(false)
    expect(isCompatibleDsh('')).toBe(false)
  })
})

describe('describeIncompatibility', () => {
  it('names the verified runtime and the direction', () => {
    expect(describeIncompatibility('0.1.9')).toBe(`version 0.1.9 is older than the verified DSH runtime ${DSH_VERIFIED_SUMMARY}`)
    expect(describeIncompatibility('0.3.0')).toBe(`version 0.3.0 is newer than the verified DSH runtime ${DSH_VERIFIED_SUMMARY}`)
  })

  it('explains an empty or unparseable answer', () => {
    expect(describeIncompatibility('')).toBe('the launcher printed no version')
    expect(describeIncompatibility('definitely-not-a-version')).toContain('is not a dsh version')
  })

  it('never returns an empty sentence', () => {
    for (const text of ['0.2.1', '0.2.2', '0.2.9-rc.1', '0.3.0-rc.1', 'garbage', '']) {
      expect(describeIncompatibility(text).length).toBeGreaterThan(0)
    }
  })
})
