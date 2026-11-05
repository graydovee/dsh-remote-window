#!/usr/bin/env node
/**
 * Move the supported dsh runtime, in the one place that owns it.
 *
 * The contract lives in `compat/runtimes.json` (interval + runtimes, newest
 * first); every other declaration — `engines.dsh`, the dsh peer/dev pins, the
 * generated module and both README tables — is regenerated from it by
 * `scripts/sync-compat.mjs`. This script only edits the table so the release
 * action is mechanical:
 *
 *   node scripts/bump-dsh-version.mjs --to 0.2.1-rc.5
 *   node scripts/bump-dsh-version.mjs --check
 *
 * `--to` widens `dsh.max` when needed and keeps the previous entries (servers
 * and caches keep resolving them). `--check` is what CI runs: it delegates to
 * `sync-compat --check`, so any declaration that drifted from the table fails.
 * Neither mode decides *whether* a runtime is verified — `pnpm typecheck`,
 * `pnpm test` and a real deployment against that runtime do.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const TABLE = join(root, 'compat/runtimes.json')
const SYNC = join(root, 'scripts/sync-compat.mjs')
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u

function fail(message) {
  console.error(message)
  process.exit(1)
}

function parse(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/u.exec(version)
  if (match === null) return undefined
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/** Semver-ish comparison: numeric identifiers by value, numbers below words. */
function compare(left, right) {
  const a = parse(left)
  const b = parse(right)
  if (a === undefined || b === undefined) return left.localeCompare(right)
  for (let index = 0; index < 3; index++) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] - b.numbers[index]
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index++) {
    const one = a.prerelease[index]
    const two = b.prerelease[index]
    if (one === undefined) return -1
    if (two === undefined) return 1
    const oneNumeric = /^\d+$/u.test(one)
    const twoNumeric = /^\d+$/u.test(two)
    if (oneNumeric && twoNumeric && Number(one) !== Number(two)) return Number(one) - Number(two)
    if (oneNumeric !== twoNumeric) return oneNumeric ? -1 : 1
    if (one !== two) return one < two ? -1 : 1
  }
  return 0
}

function readTable() {
  try {
    return JSON.parse(readFileSync(TABLE, 'utf8'))
  } catch (error) {
    fail(`cannot read ${TABLE}: ${error.message}`)
  }
}

function runSync(args) {
  const result = spawnSync(process.execPath, [SYNC, ...args], { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function bump(version) {
  if (!VERSION.test(version)) fail(`"${version}" is not a dsh version`)
  const table = readTable()
  const newest = table.runtimes?.[0]
  if (newest === undefined) fail('compat/runtimes.json has no runtime entries')
  if (newest.dsh === version) {
    console.log(`${version} is already the newest runtime; nothing to move`)
    runSync([])
    return
  }
  const runtimes = [
    { dsh: version, platforms: [...newest.platforms] },
    ...table.runtimes.filter(entry => entry.dsh !== version),
  ].sort((left, right) => compare(right.dsh, left.dsh))
  const max = compare(version, table.dsh.max) > 0 ? version : table.dsh.max
  const min = compare(version, table.dsh.min) < 0 ? version : table.dsh.min
  const next = { ...table, dsh: { min, max }, runtimes }
  writeFileSync(TABLE, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`added ${version} to compat/runtimes.json (interval ${min} … ${max})`)
  runSync([])
}

const argv = process.argv.slice(2)
const check = argv.includes('--check')
const toIndex = argv.indexOf('--to')
if (check && toIndex !== -1) fail('pass either --check or --to <version>, not both')
if (check) {
  runSync(['--check'])
} else if (toIndex !== -1) {
  const version = argv[toIndex + 1]
  if (version === undefined) fail('--to needs a version, e.g. --to 0.2.1-rc.5')
  bump(version)
} else {
  fail('usage: node scripts/bump-dsh-version.mjs [--to <version> | --check]')
}
