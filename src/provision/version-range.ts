/**
 * The dsh version window this plugin supports, and the comparison enforcing it.
 *
 * The window mirrors `package.json`'s peer range (`>=0.2.1-rc.2 <0.3.0`). The
 * floor is a *measured* baseline rather than a policy choice: 0.2.1-rc.2 is the
 * first release whose JSONL persistence backend is an `apply()`-mounted row and
 * whose `hello` carries `kind`/`executable` — on 0.2.0-rc.x the remote world
 * never starts. Keep the two in sync by hand when the peers move.
 *
 * Why not `semver`: the window is one constant, and a second, *mutable* parser
 * in the dependency tree has already cost this repo real pain (`zod` had to be
 * pinned to an exact version because a duplicate copy made `tsc` OOM, see
 * AGENTS.md). The ~70 lines below cover exactly the semantics we need — and the
 * prerelease ordering is unit-tested, which is the part a naive
 * `localeCompare` would get wrong (`rc.10` vs `rc.2`).
 */

/** Lowest dsh release the remote world runs on (inclusive). */
export const DSH_MIN_VERSION = '0.2.1-rc.2'

/** First dsh release the remote world is *not* known to work on (exclusive). */
export const DSH_MAX_VERSION = '0.3.0'

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
 *    (`rc.2 < rc.2.1`) — the case that decided the floor of the supported window.
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

/** The parsed floor, computed once. */
const MIN: DshVersion = parseDshVersion(DSH_MIN_VERSION) as DshVersion
/** The parsed ceiling, computed once. */
const MAX: DshVersion = parseDshVersion(DSH_MAX_VERSION) as DshVersion

/**
 * Whether a version line names a dsh release this plugin can drive remotely.
 * @param text - whatever `dsh --version` (or a scan record) printed.
 * @returns false for unparseable text as well as out-of-window versions.
 */
export function isCompatibleDsh(text: string): boolean {
  const version = parseDshVersion(text)
  if (version === undefined) return false
  return compareDshVersion(version, MIN) >= 0 && compareDshVersion(version, MAX) < 0
}

/**
 * A human-readable reason for rejecting a version line.
 *
 * Shown verbatim in the wizard's candidate list and in `reuse`-mode failures,
 * so it names the actual floor/ceiling instead of saying "unsupported".
 * @param text - the version line that failed {@link isCompatibleDsh}.
 * @returns one sentence; never empty.
 */
export function describeIncompatibility(text: string): string {
  const trimmed = text.trim()
  const version = parseDshVersion(trimmed)
  if (version === undefined) {
    return trimmed === '' ? 'the launcher printed no version' : `"${trimmed}" is not a dsh version`
  }
  if (compareDshVersion(version, MIN) < 0) {
    return `version ${trimmed} is below the supported floor ${DSH_MIN_VERSION}`
  }
  return `version ${trimmed} is at or above the unsupported ceiling ${DSH_MAX_VERSION}`
}
