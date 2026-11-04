#!/usr/bin/env node
/**
 * Keep every declaration of "which dsh versions does this plugin support" in
 * sync with the single source: `compat/runtimes.json`.
 *
 * The table is the contract; this script is what stops the copies from drifting
 * (the old release flow proved that: three hardcoded versions in a workflow and
 * an exact-version guard meant nothing was maintainable).
 *
 * It writes, and `--check` verifies:
 *
 *   1. `src/provision/runtime-compat.generated.ts` — the table as a typed module,
 *      so the bundler never has to inline JSON;
 *   2. `package.json` — `engines.dsh` plus every `@deepseek-ai/dsh-*` peer, as
 *      the inclusive interval from the table;
 *   3. `README.md` / `README-zh.md` — the support table between the
 *      `verified-runtimes` markers, generated from `compat/history.json`.
 *
 * Usage:
 *
 *   node scripts/sync-compat.mjs           # write
 *   node scripts/sync-compat.mjs --check   # exit 1 on drift (CI / pre-commit)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TABLE = join(ROOT, 'compat', 'runtimes.json')
const HISTORY = join(ROOT, 'compat', 'history.json')
const GENERATED = join(ROOT, 'src', 'provision', 'runtime-compat.generated.ts')
const PACKAGE = join(ROOT, 'package.json')
const READMES = [join(ROOT, 'README.md'), join(ROOT, 'README-zh.md')]

/** Platforms a runtime asset may be published for. */
export const KNOWN_PLATFORMS = [
  'linux-x64-gnu',
  'linux-arm64-gnu',
  'linux-x64-musl',
  'linux-arm64-musl',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
  'win32-arm64',
]

/** Peer dependency families whose version tracks the dsh runtime. */
const MIRRORED_PEER = /^@deepseek-ai\/dsh-/

/**
 * Parse one dsh version.
 * @param {string} text version-shaped text.
 * @returns {{major:number,minor:number,patch:number,prerelease:string[]}|undefined}
 */
export function parseVersion(text) {
  const match = /v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(text).trim())
  if (match === null) return undefined
  const prerelease = (match[4] ?? '').split('.').filter(part => part !== '')
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease }
}

/**
 * Compare two parsed versions the way semver does, prerelease ordering included.
 * @param {ReturnType<typeof parseVersion>} a left side (never undefined).
 * @param {ReturnType<typeof parseVersion>} b right side (never undefined).
 * @returns {number} negative, zero or positive.
 */
export function compareVersions(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === 0 && b.prerelease.length === 0 ? 0 : a.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.min(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const left = a.prerelease[index]
    const right = b.prerelease[index]
    const leftNumeric = /^\d+$/.test(left)
    const rightNumeric = /^\d+$/.test(right)
    if (left === right) continue
    if (leftNumeric && rightNumeric) return Number(left) < Number(right) ? -1 : 1
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    return left < right ? -1 : 1
  }
  return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length < b.prerelease.length ? -1 : 1
}

/**
 * Render the inclusive interval as a semver range (an exact version when it is a point).
 * @param {{min:string,max:string}} range the declared interval.
 * @returns {string} something npm/pnpm accepts.
 */
export function rangeExpression(range) {
  return range.min === range.max ? range.min : `>=${range.min} <=${range.max}`
}

/**
 * Validate the table and its history.
 * @param {any} table parsed `compat/runtimes.json`.
 * @param {any} history parsed `compat/history.json`.
 * @param {string} pluginVersion the version in `package.json`.
 * @returns {string[]} problems, empty when the table is usable.
 */
export function validateCompat(table, history, pluginVersion) {
  const problems = []
  if (table?.schema !== 2) problems.push('compat/runtimes.json: schema must be 2')
  if (table?.plugin !== pluginVersion) {
    problems.push(`compat/runtimes.json: plugin is "${table?.plugin}" but package.json says "${pluginVersion}"`)
  }
  const min = parseVersion(table?.dsh?.min ?? '')
  const max = parseVersion(table?.dsh?.max ?? '')
  if (min === undefined) problems.push('compat/runtimes.json: dsh.min is not a dsh version')
  if (max === undefined) problems.push('compat/runtimes.json: dsh.max is not a dsh version')
  if (min !== undefined && max !== undefined && compareVersions(min, max) > 0) {
    problems.push('compat/runtimes.json: dsh.min is greater than dsh.max')
  }
  const runtimes = Array.isArray(table?.runtimes) ? table.runtimes : []
  if (runtimes.length === 0) problems.push('compat/runtimes.json: runtimes must not be empty')
  let previous
  for (const entry of runtimes) {
    const parsed = parseVersion(entry?.dsh ?? '')
    if (parsed === undefined) {
      problems.push(`compat/runtimes.json: runtime "${entry?.dsh}" is not a dsh version`)
      continue
    }
    if (min !== undefined && compareVersions(parsed, min) < 0) problems.push(`compat/runtimes.json: runtime ${entry.dsh} is below dsh.min`)
    if (max !== undefined && compareVersions(parsed, max) > 0) problems.push(`compat/runtimes.json: runtime ${entry.dsh} is above dsh.max`)
    if (previous !== undefined && compareVersions(parsed, previous) >= 0) {
      problems.push(`compat/runtimes.json: runtimes must be strictly newest-first (${entry.dsh} after the previous entry)`)
    }
    previous = parsed
    const platforms = Array.isArray(entry?.platforms) ? entry.platforms : []
    if (platforms.length === 0) problems.push(`compat/runtimes.json: runtime ${entry.dsh} lists no platforms`)
    for (const platform of platforms) {
      if (!KNOWN_PLATFORMS.includes(platform)) {
        problems.push(`compat/runtimes.json: runtime ${entry.dsh} lists unknown platform "${platform}"`)
      }
    }
  }
  if (!Array.isArray(history) || history.length === 0) problems.push('compat/history.json: must be a non-empty array')
  const seen = new Set()
  for (const row of Array.isArray(history) ? history : []) {
    if (typeof row?.plugin !== 'string' || row.plugin === '') problems.push('compat/history.json: a row has no plugin version')
    if (seen.has(row?.plugin)) problems.push(`compat/history.json: duplicate row for ${row.plugin}`)
    seen.add(row?.plugin)
    if (parseVersion(row?.min ?? '') === undefined || parseVersion(row?.max ?? '') === undefined) {
      problems.push(`compat/history.json: row ${row?.plugin} has an unparseable interval`)
    }
    if (!Array.isArray(row?.runtimes)) problems.push(`compat/history.json: row ${row?.plugin} has no runtimes array`)
  }
  const latest = Array.isArray(history) ? history[history.length - 1] : undefined
  if (latest !== undefined && latest.plugin !== pluginVersion) {
    problems.push(`compat/history.json: the last row must be this release (${pluginVersion}), found "${latest.plugin}"`)
  }
  return problems
}

/**
 * Render the generated TypeScript module.
 * @param {any} table parsed `compat/runtimes.json`.
 * @returns {string} file contents.
 */
export function renderGenerated(table) {
  const runtimes = table.runtimes
    .map(entry => [
      '    {',
      `      dsh: ${JSON.stringify(entry.dsh)},`,
      `      platforms: [${entry.platforms.map(platform => JSON.stringify(platform)).join(', ')}],`,
      '    },',
    ].join('\n'))
    .join('\n')
  return `/**
 * GENERATED by scripts/sync-compat.mjs from compat/runtimes.json — do not edit.
 *
 * The compatibility interval is inclusive on both ends: dsh makes breaking
 * changes, so a version above \`dsh.max\` is refused just like one below
 * \`dsh.min\`. Run \`node scripts/sync-compat.mjs\` after editing the table.
 */

/** One published (or locally buildable) runtime asset. */
export interface GeneratedRuntimeEntry {
  /** The exact dsh release this runtime contains. */
  readonly dsh: string
  /** Platform tags the asset exists for, newest-first entries first. */
  readonly platforms: readonly string[]
}

/** The compatibility contract of this plugin build. */
export interface GeneratedCompatTable {
  readonly schema: 2
  readonly plugin: string
  /** Inclusive interval of dsh versions this build can drive. */
  readonly dsh: { readonly min: string; readonly max: string }
  /** Runtimes we ship, strictly newest-first. */
  readonly runtimes: readonly GeneratedRuntimeEntry[]
}

/** The table this build was compiled with. */
export const RUNTIME_COMPAT: GeneratedCompatTable = {
  schema: 2,
  plugin: ${JSON.stringify(table.plugin)},
  dsh: { min: ${JSON.stringify(table.dsh.min)}, max: ${JSON.stringify(table.dsh.max)} },
  runtimes: [
${runtimes}
  ],
}
`
}

/**
 * Render the README support table.
 * @param {any} history parsed `compat/history.json`.
 * @returns {string} markdown rows (no markers).
 */
export function renderHistory(history) {
  const rows = history.map(row => {
    const interval = row.min === row.max ? `= ${row.min}` : `>= ${row.min} <= ${row.max}`
    return `| ${row.plugin} | ${interval} | ${row.runtimes.join(', ')} |`
  })
  return [
    '| Plugin | Supported DSH | Published runtimes |',
    '| --- | --- | --- |',
    ...rows,
  ].join('\n')
}

/**
 * Replace the block between the README markers.
 * @param {string} text current file.
 * @param {string} table rendered table.
 * @returns {string | undefined} new contents, or undefined when the markers are missing.
 */
export function replaceReadmeBlock(text, table) {
  const pattern = /(<!-- verified-runtimes:start -->\n)([\s\S]*?)(<!-- verified-runtimes:end -->)/u
  if (!pattern.test(text)) return undefined
  return text.replace(pattern, `$1${table}\n$3`)
}

/**
 * Compute the files this script owns.
 * @returns {Map<string,string>} path → expected contents.
 */
export function expectedFiles() {
  const table = JSON.parse(readFileSync(TABLE, 'utf8'))
  const history = JSON.parse(readFileSync(HISTORY, 'utf8'))
  const pkg = JSON.parse(readFileSync(PACKAGE, 'utf8'))
  const problems = validateCompat(table, history, pkg.version)
  if (problems.length > 0) {
    throw new Error(`compat table is invalid:\n- ${problems.join('\n- ')}`)
  }
  const expression = rangeExpression(table.dsh)
  const nextPackage = { ...pkg, engines: { ...pkg.engines, dsh: expression } }
  const peers = {}
  for (const [name, version] of Object.entries(pkg.peerDependencies ?? {})) {
    peers[name] = MIRRORED_PEER.test(name) ? expression : version
  }
  nextPackage.peerDependencies = peers
  const rendered = renderHistory(history)
  const files = new Map()
  files.set(GENERATED, renderGenerated(table))
  files.set(PACKAGE, `${JSON.stringify(nextPackage, null, 2)}\n`)
  for (const path of READMES) {
    const replaced = replaceReadmeBlock(readFileSync(path, 'utf8'), rendered)
    if (replaced === undefined) {
      throw new Error(`${path}: missing <!-- verified-runtimes:start --> / <!-- verified-runtimes:end --> markers`)
    }
    files.set(path, replaced)
  }
  return files
}

const check = process.argv.includes('--check')
const files = expectedFiles()
const drift = []
for (const [path, contents] of files) {
  let current = ''
  try {
    current = readFileSync(path, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  if (current === contents) continue
  drift.push(path.slice(ROOT.length + 1))
  if (!check) writeFileSync(path, contents)
}
if (check && drift.length > 0) {
  console.error(`compat declarations are stale; run "node scripts/sync-compat.mjs":\n- ${drift.join('\n- ')}`)
  process.exit(1)
}
if (!check) {
  console.log(drift.length === 0 ? 'compat declarations already in sync' : `updated: ${drift.join(', ')}`)
}
