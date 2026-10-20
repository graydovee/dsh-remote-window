#!/usr/bin/env node
/**
 * Move the verified dsh runtime, in the four places that must agree.
 *
 * Widening the contract is a release action: this script only rewrites the
 * declarations so they cannot drift apart by hand. It does not decide *whether*
 * a runtime is verified — `pnpm typecheck`, `pnpm test` and a real deployment
 * against that runtime do.
 *
 *   node scripts/bump-dsh-version.mjs --to 0.2.1-rc.3
 *   node scripts/bump-dsh-version.mjs --check
 *
 * `--check` is what CI runs: it fails when `engines.dsh`, the dsh peer/dev
 * ranges, `DSH_VERIFIED_RUNTIMES` or the READMEs disagree.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = path => readFileSync(join(root, path), 'utf8')
const write = (path, text) => writeFileSync(join(root, path), text)

/** Marker the compatibility table carries; new rows go directly above it. */
const ROW_MARKER = '<!-- verified-runtimes -->'
const READMES = ['README.md', 'README-zh.md']
const RUNTIME_FILE = 'src/provision/version-range.ts'
const RUNTIME_LINE = /export const DSH_VERIFIED_RUNTIMES: readonly string\[\] = \[[^\]]*\]/

const isDshDependency = name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')

function fail(message) {
  console.error(message)
  process.exit(1)
}

function parseArguments(argv) {
  const args = { check: false, to: '' }
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]
    if (value === '--check') args.check = true
    else if (value === '--to') args.to = argv[++index] ?? ''
    else fail(`unknown argument: ${value}`)
  }
  return args
}

/** The runtimes currently listed by the source constant. */
function verifiedRuntimes(source) {
  const line = source.match(RUNTIME_LINE)
  if (line === null) fail(`${RUNTIME_FILE} no longer declares DSH_VERIFIED_RUNTIMES`)
  return [...line[0].matchAll(/'([^']+)'/g)].map(match => match[1])
}

function readManifest() {
  return JSON.parse(read('package.json'))
}

function report(label, expected, actual) {
  if (actual === expected) return true
  console.error(`drift: ${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
  return false
}

function check() {
  const manifest = readManifest()
  const runtimes = verifiedRuntimes(read(RUNTIME_FILE))
  if (runtimes.length === 0) fail('DSH_VERIFIED_RUNTIMES is empty')
  const expected = manifest.engines.dsh
  let ok = report('engines.dsh vs DSH_VERIFIED_RUNTIMES', expected, runtimes.includes(expected) ? expected : runtimes[0])
  for (const [name, range] of Object.entries({ ...manifest.peerDependencies, ...manifest.devDependencies })) {
    if (isDshDependency(name)) ok = report(name, expected, range) && ok
  }
  for (const path of READMES) {
    const text = read(path)
    for (const runtime of runtimes) {
      if (!text.includes(runtime)) {
        console.error(`drift: ${path} does not name the verified runtime ${runtime}`)
        ok = false
      }
    }
    if (!text.includes(ROW_MARKER)) {
      console.error(`drift: ${path} is missing the ${ROW_MARKER} marker`)
      ok = false
    }
  }
  if (!ok) process.exit(1)
  console.log(`verified runtime contract is consistent (${runtimes.join(' / ')})`)
}

function bump(runtime) {
  if (runtime === '') fail('--to needs a version, e.g. --to 0.2.1-rc.3')
  const manifest = readManifest()
  const previous = verifiedRuntimes(read(RUNTIME_FILE))
  if (previous.includes(runtime)) fail(`${runtime} is already verified`)

  manifest.engines.dsh = runtime
  for (const record of [manifest.peerDependencies, manifest.devDependencies]) {
    for (const name of Object.keys(record)) if (isDshDependency(name)) record[name] = runtime
  }
  write('package.json', `${JSON.stringify(manifest, null, 2)}\n`)

  const source = read(RUNTIME_FILE)
  write(RUNTIME_FILE, source.replace(RUNTIME_LINE, `export const DSH_VERIFIED_RUNTIMES: readonly string[] = [${[...previous, runtime].map(value => `'${value}'`).join(', ')}]`))

  // One table row per verified runtime; the marker keeps the insert stable and
  // keeps the translations in step (both files carry the same table).
  for (const path of READMES) {
    const text = read(path)
    if (text.includes(runtime)) continue
    if (!text.includes(ROW_MARKER)) fail(`${path} is missing the ${ROW_MARKER} marker; add the row by hand`)
    const row = `| ${manifest.version} | ${runtime} | verified |`
    write(path, text.replace(ROW_MARKER, `${row}\n${ROW_MARKER}`))
  }

  console.log(`verified runtime -> ${runtime} (was ${previous.join(' / ')})`)
  console.log('next: pnpm install, pnpm typecheck, pnpm test, pnpm build, then a real deployment against that runtime')
}

const args = parseArguments(process.argv.slice(2))
if (args.check) check()
else bump(args.to)
