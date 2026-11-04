/**
 * Pick the dsh runtime this connection will run on.
 *
 * The table (`compat/runtimes.json`) says which dsh releases this plugin build
 * can drive — an inclusive `[min, max]` — and which runtime assets it ships. This
 * module turns "what the remote already has" plus "what we can obtain" into one
 * decision, and it is deliberately a pure function: every side effect (cache
 * probe, release lookup, local build) is injected, so the whole priority ladder
 * is unit-tested without an SSH connection.
 *
 * Priority, highest first:
 *
 *  1. `DSH_RW_RUNTIME_ARTIFACT` — an operator named an artifact explicitly. Its
 *     manifest must be inside the interval; an out-of-range artifact is a
 *     mistake that must surface, never be silently used.
 *  2. The remote's own global dsh, when healthy and inside the interval — the
 *     cheapest path (no 190 MB upload) and the historically verified one.
 *  3. The newest interval runtime already in the local cache.
 *  4. The newest interval runtime published as a release asset.
 *  5. The newest interval runtime this host can build (POSIX hosts only).
 *
 * Being inside the interval but having no artifact is *not* a compatibility
 * failure: it is `no-artifact`, with its own wording ("upgrade the plugin").
 */
import type { DshCompatRange, RuntimeEntry } from './runtime-compat.ts'
import {
  describeRange,
  inDshRange,
  platformAvailable,
  supportedRuntimes,
} from './runtime-compat.ts'
import { compareDshVersion, parseDshVersion } from './version-range.ts'

/** How the chosen runtime was obtained. */
export type RuntimeSource = 'env' | 'global' | 'cache' | 'release' | 'build'

/** Why no runtime could be chosen. */
export type RuntimeRefusal = 'too-old' | 'too-new' | 'no-artifact'

/** What the planner should do; never throws. */
export type RuntimeSelection =
  | { readonly ok: true; readonly version: string; readonly source: RuntimeSource }
  | { readonly ok: false; readonly reason: RuntimeRefusal; readonly version?: string; readonly range: DshCompatRange }

/** Everything the decision depends on, injected so it stays pure. */
export interface RuntimeSelectionInput {
  /** The interval and assets of this build; defaults to the compiled table. */
  readonly range?: DshCompatRange
  readonly entries?: readonly RuntimeEntry[]
  /** The remote platform tag (`linux-x64-gnu`, `win32-x64`, …), when known. */
  readonly platformArch?: string | undefined
  /** The dsh version inside the `DSH_RW_RUNTIME_ARTIFACT` manifest, when set. */
  readonly envVersion?: string | undefined
  /** The remote's global dsh, when the scan found a launcher. */
  readonly remoteGlobal?: { readonly version: string; readonly healthy: boolean } | undefined
  /** Whether this host may build a POSIX runtime locally (false on win32). */
  readonly hostCanBuild: boolean
  /** Cache lookup for one runtime version. */
  readonly hasCache: (version: string) => boolean
  /** Release lookups for one runtime version (network, injectable in tests). */
  readonly canFetch: (version: string) => boolean
}

const DEFAULT_RANGE: DshCompatRange = { min: '0.0.0', max: '0.0.0' }

/**
 * Decide which runtime a connection uses.
 * @param input - the injected facts (see {@link RuntimeSelectionInput}).
 * @returns the chosen version and its source, or a refusal with the reason.
 */
export function selectRuntimeVersion(input: RuntimeSelectionInput): RuntimeSelection {
  const range = input.range ?? DEFAULT_RANGE
  const entries = input.entries ?? []
  const supported = supportedRuntimes({ schema: 2, plugin: '', dsh: range, runtimes: entries })
  const fitsPlatform = (entry: RuntimeEntry): boolean =>
    input.platformArch === undefined || platformAvailable(entry, input.platformArch)

  if (input.envVersion !== undefined && input.envVersion !== '') {
    if (inDshRange(input.envVersion, range)) {
      return { ok: true, version: input.envVersion, source: 'env' }
    }
    return { ok: false, reason: refusalReason(input.envVersion, range), version: input.envVersion, range }
  }

  const global = input.remoteGlobal
  if (global !== undefined && global.healthy && inDshRange(global.version, range)) {
    return { ok: true, version: global.version, source: 'global' }
  }

  for (const entry of supported) {
    if (!fitsPlatform(entry)) continue
    if (input.hasCache(entry.dsh)) return { ok: true, version: entry.dsh, source: 'cache' }
  }
  for (const entry of supported) {
    if (!fitsPlatform(entry)) continue
    if (input.canFetch(entry.dsh)) return { ok: true, version: entry.dsh, source: 'release' }
  }
  if (input.hostCanBuild) {
    for (const entry of supported) {
      if (!fitsPlatform(entry)) continue
      return { ok: true, version: entry.dsh, source: 'build' }
    }
  }

  const reason = global !== undefined && global.version !== ''
    ? refusalReason(global.version, range)
    : 'no-artifact'
  return { ok: false, reason, ...(global === undefined ? {} : { version: global.version }), range }
}

/**
 * Which side of the interval a version fell on.
 * @param version - the version line (already known to be out of range).
 * @param range - the supported interval.
 * @returns `too-old`, `too-new`, or `no-artifact` when unparseable.
 */
function refusalReason(version: string, range: DshCompatRange): RuntimeRefusal {
  const parsed = parseDshVersion(version)
  const min = parseDshVersion(range.min)
  const max = parseDshVersion(range.max)
  if (parsed === undefined || min === undefined || max === undefined) return 'no-artifact'
  if (compareDshVersion(parsed, max) > 0) return 'too-new'
  if (compareDshVersion(parsed, min) < 0) return 'too-old'
  return 'no-artifact'
}

/**
 * The sentence shown in the connect progress row and in failures.
 *
 * Kept next to the decision so the wording cannot drift from the rule: it always
 * names the chosen version, how it was obtained, and — for a refusal — the
 * concrete next step (`too-new` asks for a plugin upgrade, `too-old` for a
 * server upgrade).
 * @param selection - the result of {@link selectRuntimeVersion}.
 * @returns one line, never empty.
 */
export function describeSelection(selection: RuntimeSelection): string {
  if (selection.ok) {
    const how = {
      env: 'from DSH_RW_RUNTIME_ARTIFACT',
      global: 'reusing the global dsh',
      cache: 'from the local cache',
      release: 'downloaded from the release',
      build: 'built locally',
    }[selection.source]
    return `${selection.version} (${how})`
  }
  const range = describeRange(selection.range)
  const actual = selection.version === undefined ? '' : `remote is ${selection.version}; `
  if (selection.reason === 'too-new') {
    return `${actual}above the supported DSH interval (${range}); upgrade the plugin`
  }
  if (selection.reason === 'too-old') {
    return `${actual}below the supported DSH interval (${range}); upgrade the server's dsh`
  }
  return `no runtime artifact is available for the supported DSH interval (${range})`
}
