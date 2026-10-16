/**
 * Build the remote server package(s) for release or offline use.
 *
 * One-shot local build:
 *   node scripts/build-server-package.mjs --platform linux --arch x64 --libc gnu
 * Full release matrix (what CI runs):
 *   node scripts/build-server-package.mjs --all
 *
 * Outputs into --out (default `dist-server`):
 *   dsh-remote-server-<dshVersion>-<platformArch>[-libc].tar.gz
 *   …tar.gz.sha256 / ….manifest.json
 *
 * Staging logic is shared with the plugin's connect flow
 * (`src/provision/package-build.ts`), so a CI artifact and a locally staged
 * package are byte-equivalent in layout. Node ≥ 22.6 required (type stripping).
 */
import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildServerPackage, artifactTag } from '../src/provision/package-build.ts'

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback
}

const outDir = resolve(arg('out', 'dist-server'))
await mkdir(outDir, { recursive: true })

// Host toolchain: same discovery the plugin uses at connect time.
const { findHostPnpm } = await import('../src/provision/assets.ts')
const tool = await findHostPnpm()
console.log(`[build-server] using node ${tool.node}`)
console.log(`[build-server] using pnpm ${tool.pnpm}`)

const dshVersion = arg('dsh-version', '')
if (dshVersion === '') {
  console.error('[build-server] --dsh-version is required (e.g. 0.2.0-rc.2)')
  process.exit(2)
}

/** The release matrix; musl slots are declared but fail loudly until a musl
 *  node dist is wired into the node component. */
const MATRIX = [
  { platform: 'linux', arch: 'x64', libc: 'gnu' },
  { platform: 'linux', arch: 'arm64', libc: 'gnu' },
  { platform: 'darwin', arch: 'x64', libc: '' },
  { platform: 'darwin', arch: 'arm64', libc: '' },
]

const all = process.argv.includes('--all')
const targets = all
  ? MATRIX
  : [{
      platform: arg('platform', 'linux'),
      arch: arg('arch', 'x64'),
      libc: arg('libc', arg('platform', 'linux') === 'linux' ? 'gnu' : ''),
    }]

let failed = false
for (const target of targets) {
  const tag = artifactTag(target.platform, target.arch, target.libc)
  console.log(`[build-server] building ${tag} …`)
  try {
    const result = await buildServerPackage({
      version: dshVersion,
      platform: target.platform,
      arch: target.arch,
      libc: target.libc,
      outDir,
      nodeBin: tool.node,
      pnpmCjs: tool.pnpm,
      onProgress: message => console.log(`[build-server] ${message}`),
    })
    const size = (await stat(result.file)).size
    console.log(`[build-server] ${tag}: ${(size / 1024 / 1024).toFixed(1)} MB sha256=${result.sha256}`)
  } catch (error) {
    failed = true
    console.error(`[build-server] ${tag} FAILED: ${error.message}`)
  }
}
process.exit(failed ? 1 : 0)
