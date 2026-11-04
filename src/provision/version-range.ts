/**
 * Comparing dsh versions, and the compatibility gate built on top of them.
 *
 * The gate is an **inclusive interval** test: a remote launcher is usable when
 * `min <= version <= max`, where both bounds come from `compat/runtimes.json`
 * (compiled into `runtime-compat.generated.ts`). The interval is declared by the
 * release, not derived from "the newest thing we know": dsh is a developer
 * preview, so a release above the upper bound can break exactly like one below
 * the lower bound. Versions *inside* the interval that have no published
 * artifact are still "compatible" — the runtime planner falls back within the
 * interval and only then refuses (see `runtime-selection.ts`).
 *
 * Why a hand-written parser instead of `semver`: a second, *mutable* parser in
 * the dependency tree has already cost this repo real pain (`zod` had to be
 * pinned to an exact version because a duplicate copy made `tsc` OOM, see
 * AGENTS.md). The code below covers the semantics we need, and the prerelease
 * ordering is unit-tested — that is the part a naive `localeCompare` gets wrong
 * (`rc.10` vs `rc.2`).
 */

import { RUNTIME_COMPAT } from './runtime-compat.generated.ts'

/** The dsh runtimes this build ships, newest-first (from `compat/runtimes.json`). */
export const DSH_VERIFIED_RUNTIMES: readonly string[] = RUNTIME_COMPAT.runtimes.map(entry => entry.dsh)

/** The inclusive interval this build supports, as text for messages and the wizard. */
export const DSH_VERIFIED_SUMMARY = RUNTIME_COMPAT.dsh.min === RUNTIME_COMPAT.dsh.max
  ? RUNTIME_COMPAT.dsh.min
  : `${RUNTIME_COMPAT.dsh.min} \u2026 ${RUNTIME_COMPAT.dsh.max}`

/** One parsed version: three numeric segments plus dot-separated prerelease ids. */
export interface DshVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  /** `0.2.1-rc.2` → `['rc', '2']`; empty for a plain release. */
  readonly prerelease: readonly string[]
}

/**
 * The first version-looking token in a line of text.
 *
 * `dsh --version` prints the bare version, but a wrapper script may prefix or
 * decorate it (`dsh 0.2.1-rc.2`, `v0.2.1-rc.2`), so the leading `v` is optional
 * and the match is not anchored to the start of the line.
 */
const VERSION_PATTERN = /v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/

/**
 * Parse one dsh version out of arbitrary text.
 * @param text - a version line, possibly with noise around the number.
 * @returns the parsed version, or undefined when no version-shaped token exists.
 */
export function parseDshVersion(text: string): DshVersion | undefined {
  const match = VERSION_PATTERN.exec(text)
  if (match === null) return undefined
  const major = match[1]
  const minor = match[2]
  const patch = match[3]
  if (major === undefined || minor === undefined || patch === undefined) return undefined
  // A trailing separator (`0.2.1-rc.2.`) leaves an empty identifier, which is
  // not a version segment: drop empties instead of carrying them into compare().
  const prerelease = (match[4] ?? '').split('.').filter(segment => segment !== '')
  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
    prerelease,
  }
}

/** Numeric identifier test for prerelease segments (`2` vs `rc`). */
const NUMERIC_ID = /^\d+$/

/**
 * Total order over parsed versions (semver 2.0 precedence).
 *
 * 1. numeric major/minor/patch;
 * 2. a release outranks any prerelease of the same triple;
 * 3. prerelease identifiers compare element-wise: numeric vs numeric by value,
 *    both alphanumeric by ASCII order, numeric **below** alphanumeric;
 * 4. a shorter identifier list that prefixes the other is smaller
 *    (`rc.2 < rc.2.1`).
 *
 * Used only to word a rejection and to rank scan candidates; the gate itself is
 * the membership test in {@link isCompatibleDsh}.
 *
 * @returns negative when `a < b`, 0 when equal, positive when `a > b`.
 */
export function compareDshVersion(a: DshVersion, b: DshVersion): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  // `0.2.1 < 0.2.1-rc.2` is false: the plain release is the *greater* one.
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const shared = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < shared; index++) {
    const left = a.prerelease[index]
    const right = b.prerelease[index]
    // The shorter list runs out first: it is the smaller one.
    if (left === undefined) return -1
    if (right === undefined) return 1
    const numericLeft = NUMERIC_ID.test(left)
    const numericRight = NUMERIC_ID.test(right)
    if (numericLeft && numericRight) {
      const delta = Number.parseInt(left, 10) - Number.parseInt(right, 10)
      if (delta !== 0) return delta < 0 ? -1 : 1
      continue
    }
    // Numeric identifiers always sort below alphanumeric ones.
    if (numericLeft !== numericRight) return numericLeft ? -1 : 1
    if (left !== right) return left < right ? -1 : 1
  }
  return 0
}

/**
 * Canonical spelling of a parsed version: `major.minor.patch[-prerelease]`.
 *
 * Build metadata and a leading `v` are not part of the identity, so
 * `v0.2.1-rc.2+build.7` normalizes to the string the verified list carries.
 * @param version - the parsed version.
 * @returns the canonical text.
 */
export function formatDshVersion(version: DshVersion): string {
  const core = `${version.major}.${version.minor}.${version.patch}`
  return version.prerelease.length === 0 ? core : `${core}-${version.prerelease.join('.')}`
}

/**
 * Whether a version line names a dsh release this plugin can drive remotely.
 *
 * Inclusive interval test over the table's `dsh.min`/`dsh.max`; unparseable text
 * is never compatible.
 * @param text - whatever `dsh --version` (or a scan record) printed.
 * @returns true when the parsed version is inside the supported interval.
 */
export function isCompatibleDsh(text: string): boolean {
  const version = parseDshVersion(text)
  if (version === undefined) return false
  const min = parseDshVersion(RUNTIME_COMPAT.dsh.min)
  const max = parseDshVersion(RUNTIME_COMPAT.dsh.max)
  if (min === undefined || max === undefined) return false
  return compareDshVersion(version, min) >= 0 && compareDshVersion(version, max) <= 0
}

/** The supported interval as parsed versions, computed once. */
const INTERVAL = {
  min: parseDshVersion(RUNTIME_COMPAT.dsh.min),
  max: parseDshVersion(RUNTIME_COMPAT.dsh.max),
}

/**
 * A human-readable reason for rejecting a version line.
 *
 * Shown verbatim in the wizard's candidate list and in `reuse`-mode failures, so
 * it names the supported interval instead of saying "unsupported". The two
 * bounds are reported separately on purpose: "too new" is the case the old
 * exact-version guard could not express, and it needs different advice (upgrade
 * the plugin) than "too old" (upgrade the server).
 * @param text - the version line that failed {@link isCompatibleDsh}.
 * @returns one sentence; never empty.
 */
export function describeIncompatibility(text: string): string {
  const trimmed = text.trim()
  const version = parseDshVersion(trimmed)
  if (version === undefined) {
    return trimmed === '' ? 'the launcher printed no version' : `"${trimmed}" is not a dsh version`
  }
  const min = INTERVAL.min
  const max = INTERVAL.max
  if (min !== undefined && compareDshVersion(version, min) < 0) {
    return `version ${trimmed} is below the supported DSH interval (${DSH_VERIFIED_SUMMARY})`
  }
  if (max !== undefined && compareDshVersion(version, max) > 0) {
    return `version ${trimmed} is above the supported DSH interval (${DSH_VERIFIED_SUMMARY}); upgrade the plugin`
  }
  return `version ${trimmed} is not a DSH release this plugin can drive (${DSH_VERIFIED_SUMMARY})`
}
