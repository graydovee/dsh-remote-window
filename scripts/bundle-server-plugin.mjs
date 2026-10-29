#!/usr/bin/env node
/**
 * Bundle the matching server-plugin tarball into the client package.
 *
 * The dedicated profile installs this artifact offline; the copy is part of the
 * npm package (`assets/server-plugin/`) and its sha256 goes into
 * `checksums.json` next to it. The version encoded in the tarball name must equal
 * this client's version: a client may only ship the server plugin of its own
 * release train.
 *
 * Usage:
 *   node scripts/bundle-server-plugin.mjs --tarball ../dsh-remote-window-server/dist/server-plugin/dsh-remote-window-server-0.1.0-alpha.3.tgz
 *   DSH_SERVER_PLUGIN_TARBALL=... node scripts/bundle-server-plugin.mjs
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const tarballArg = (() => {
  const index = args.indexOf('--tarball')
  if (index !== -1 && args[index + 1] !== undefined) return args[index + 1]
  return process.env['DSH_SERVER_PLUGIN_TARBALL']
})()
if (tarballArg === undefined || tarballArg === '') {
  console.error('bundle-server-plugin: pass --tarball <path> or DSH_SERVER_PLUGIN_TARBALL')
  process.exit(2)
}
const tarball = resolve(tarballArg)
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const clientVersion = String(manifest.version)
const name = basename(tarball)
const match = /^dsh-remote-window-server-(.+)\.tgz$/u.exec(name)
if (match === null) {
  console.error(`bundle-server-plugin: unexpected tarball name ${name}`)
  process.exit(2)
}
const serverVersion = match[1]
if (serverVersion !== clientVersion) {
  console.error(`bundle-server-plugin: server plugin version ${serverVersion} does not match client ${clientVersion}`)
  process.exit(2)
}
const info = await stat(tarball)
if (!info.isFile() || info.size < 1024) {
  console.error(`bundle-server-plugin: ${tarball} is not a non-empty tarball`)
  process.exit(2)
}
const bytes = await readFile(tarball)
const sha256 = createHash('sha256').update(bytes).digest('hex')
const targetDir = join(root, 'assets', 'server-plugin')
await mkdir(targetDir, { recursive: true })
await copyFile(tarball, join(targetDir, name))
const checksumPath = join(targetDir, 'checksums.json')
let checksums = {}
try {
  checksums = JSON.parse(await readFile(checksumPath, 'utf8'))
} catch {}
// Keep only entries whose artifact is still shipped; older release tarballs
// are not part of this package.
checksums = Object.fromEntries(
  Object.entries(checksums).filter(([entry]) => entry === name || existsSync(join(targetDir, entry))),
)
checksums[name] = sha256
await writeFile(checksumPath, `${JSON.stringify(checksums, null, 2)}\n`)
console.log(`bundled ${name} (${info.size} bytes, sha256 ${sha256})`)
