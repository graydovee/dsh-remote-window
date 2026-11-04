/**
 * The compatibility contract between this plugin build and dsh releases.
 *
 * The table lives in `compat/runtimes.json` and is compiled into
 * {@link RUNTIME_COMPAT} by `scripts/sync-compat.mjs`; nothing in the source
 * hardcodes a dsh version. Two facts are declared, and they answer two different
 * questions:
 *
 *  - `dsh.min` / `dsh.max` — the **inclusive interval** of dsh releases this
 *    build can drive. Both bounds are required: dsh is a developer preview, so a
 *    release *above* the interval can break just as a release below it can. A
 *    one-sided rule ("from version X onwards") is what made the previous
 *    exact-version guard unmaintainable.
 *  - `runtimes[]` — the assets we actually ship (or can build locally), strictly
 *    newest-first, each with the platform tags it exists for. Being inside the
 *    interval does not imply an artifact exists: a brand-new dsh release may be
 *    supported but not yet built for `win32-x64`.
 *
 * Why a hand-written parser instead of `semver`: the repo already pins `zod`
 * exactly because a duplicate copy in the tree made `tsc` OOM; a second parser is
 * the same class of risk at a fraction of the benefit. `version-range.ts` owns
 * the comparison, this module owns the table and its validation.
 */
import { RUNTIME_COMPAT, type GeneratedCompatTable, type GeneratedRuntimeEntry } from './runtime-compat.generated.ts'
import { compareDshVersion, formatDshVersion, parseDshVersion } from './version-range.ts'

export { RUNTIME_COMPAT }
export type { GeneratedCompatTable as RuntimeCompatTable, GeneratedRuntimeEntry as RuntimeEntry }

/** The dsh interval this build supports; both ends are inclusive. */
export interface DshCompatRange {
  readonly min: string
  readonly max: string
}

/** The interval declared by the compiled table. */
export const RUNTIME_COMPAT_RANGE: DshCompatRange = RUNTIME_COMPAT.dsh

/**
 * Every platform tag an artifact may be published for.
 *
 * Kept in sync with `runtimePlatformArchOf()` (which produces these strings) and
 * with `scripts/sync-compat.mjs` (which rejects anything else in the table).
 */
export const KNOWN_PLATFORMS: readonly string[] = [
  'linux-x64-gnu',
  'linux-arm64-gnu',
  'linux-x64-musl',
  'linux-arm64-musl',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
  'win32-arm64',
]

/**
 * The `engines.dsh` / peer expression for one interval.
 *
 * `min === max` is written as the exact version (what every release so far
 * shipped, and what `pnpm` resolves most predictably); otherwise the range is
 * `>=min <=max`, both ends inclusive. `scripts/sync-compat.mjs` keeps its own
 * copy because it runs as plain Node without a TypeScript loader; the release
 * contract test asserts the two agree.
 * @param range - the interval to express.
 * @returns the manifest expression text.
 */
export function rangeExpression(range: DshCompatRange): string {
  return range.min === range.max ? range.min : `>=${range.min} <=${range.max}`
}

/**
 * Whether a version line names a dsh release inside the supported interval.
 * Unparseable text is never inside.
 * @param text - whatever `dsh --version` or a scan record printed.
 * @param range - the interval to test against; defaults to this build's.
 * @returns true when `min <= version <= max`.
 */
export function inDshRange(text: string, range: DshCompatRange = RUNTIME_COMPAT_RANGE): boolean {
  const version = parseDshVersion(text)
  if (version === undefined) return false
  const min = parseDshVersion(range.min)
  const max = parseDshVersion(range.max)
  if (min === undefined || max === undefined) return false
  return compareDshVersion(version, min) >= 0 && compareDshVersion(version, max) <= 0
}

/**
 * The supported interval as one human string, e.g. `0.2.1-rc.3 … 0.2.1-rc.4`.
 * @param range - the interval; defaults to this build's.
 * @returns text for the wizard, errors and logs.
 */
export function describeRange(range: DshCompatRange = RUNTIME_COMPAT_RANGE): string {
  return range.min === range.max ? range.min : `${range.min} … ${range.max}`
}

/**
 * The runtimes we ship, newest first (the table order is the priority order).
 * @param table - the compiled table; defaults to this build's.
 * @returns the runtime entries, filtered to those inside the interval.
 */
export function supportedRuntimes(table: GeneratedCompatTable = RUNTIME_COMPAT): readonly GeneratedRuntimeEntry[] {
  return table.runtimes.filter(entry => inDshRange(entry.dsh, table.dsh))
}

/**
 * Whether a runtime has an artifact published for one platform tag.
 * @param entry - one runtime entry.
 * @param platformArch - a tag from {@link KNOWN_PLATFORMS}.
 * @returns true when the entry lists that platform.
 */
export function platformAvailable(entry: GeneratedRuntimeEntry, platformArch: string): boolean {
  return entry.platforms.includes(platformArch)
}

/**
 * Validate a table the same way `scripts/sync-compat.mjs` does at build time.
 *
 * Lives here so the bundling tests can assert what the script asserts without
 * shelling out; the release gate still runs the script (`--check`).
 * @param table - the table to validate.
 * @returns the problems found, empty when the table is usable.
 */
export function compatProblems(table: GeneratedCompatTable = RUNTIME_COMPAT): readonly string[] {
  const problems: string[] = []
  if (table.schema !== 2) problems.push('schema must be 2')
  if (table.plugin.trim() === '') problems.push('plugin must be set')
  const min = parseDshVersion(table.dsh.min)
  const max = parseDshVersion(table.dsh.max)
  if (min === undefined) problems.push('dsh.min is not a dsh version')
  if (max === undefined) problems.push('dsh.max is not a dsh version')
  if (min !== undefined && max !== undefined && compareDshVersion(min, max) > 0) {
    problems.push('dsh.min is greater than dsh.max')
  }
  if (table.runtimes.length === 0) problems.push('runtimes must not be empty')
  let previous
  for (const entry of table.runtimes) {
    const parsed = parseDshVersion(entry.dsh)
    if (parsed === undefined) {
      problems.push(`runtime "${entry.dsh}" is not a dsh version`)
      continue
    }
    if (!inDshRange(entry.dsh, table.dsh)) problems.push(`runtime ${entry.dsh} is outside the supported interval`)
    if (entry.platforms.length === 0) problems.push(`runtime ${entry.dsh} lists no platforms`)
    for (const platform of entry.platforms) {
      if (!KNOWN_PLATFORMS.includes(platform)) problems.push(`runtime ${entry.dsh} lists unknown platform "${platform}"`)
    }
    const canonical = formatDshVersion(parsed)
    if (canonical !== entry.dsh) problems.push(`runtime ${entry.dsh} is not canonical (${canonical})`)
    if (previous !== undefined && compareDshVersion(parsed, previous) >= 0) {
      problems.push(`runtimes must be strictly newest-first (${entry.dsh} after the previous entry)`)
    }
    previous = parsed
  }
  return problems
}
