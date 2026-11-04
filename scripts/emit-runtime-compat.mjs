/**
 * Emit the compatibility snapshot a release publishes next to the tarballs.
 *
 * `compat/runtimes.json` is the single source of truth and this script is a
 * *projection* of it: the server release downloads the snapshot to build exactly
 * the runtime matrix the client claims to support, and renders its release notes
 * from the same numbers. Publishing the snapshot with the release (instead of
 * letting the other repo read this checkout) is what keeps the two repositories
 * from having to share a token or a submodule.
 *
 * The output is deterministic — no timestamps, keys in a fixed order — so that
 * re-running the release job cannot produce a different asset hash for the same
 * plugin version.
 *
 * Usage:
 *
 *   node scripts/emit-runtime-compat.mjs --out dist/runtime-compat.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback
}

const root = resolve(import.meta.dirname, '..')
const out = arg('out', 'dist/runtime-compat.json')

const manifest = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'))
const table = JSON.parse(readFileSync(`${root}/compat/runtimes.json`, 'utf8'))

if (table.plugin !== manifest.version) {
  console.error(`[runtime-compat] compat/runtimes.json plugin=${table.plugin} but package.json version=${manifest.version}`)
  process.exit(1)
}
if (table.schema !== 2) {
  console.error(`[runtime-compat] unsupported schema ${table.schema}; expected 2`)
  process.exit(1)
}

const snapshot = {
  schema: 2,
  plugin: table.plugin,
  dsh: { min: table.dsh.min, max: table.dsh.max },
  runtimes: table.runtimes.map(entry => ({ dsh: entry.dsh, platforms: [...entry.platforms] })),
}

mkdirSync(dirname(resolve(out)), { recursive: true })
writeFileSync(resolve(out), `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(`[runtime-compat] wrote ${out} (plugin ${snapshot.plugin}, dsh ${snapshot.dsh.min}..${snapshot.dsh.max}, ${snapshot.runtimes.length} runtime(s))`)
