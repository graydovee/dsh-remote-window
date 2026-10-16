/**
 * Host-side asset cache for the remote deployment.
 *
 * ZCode-style: the *local* machine fetches each component once, verifies it,
 * and caches it under `~/.dsh/remote-assets/`. Deployments then upload from
 * this cache (or skip entirely when the remote marker matches), so a flaky
 * remote network never blocks a connect — only the first connect for a new
 * platform downloads anything, and repeated connects are pure uploads.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { artifactName, artifactTag, buildServerPackage } from './package-build.ts'

export { artifactName, artifactTag }

/** Node distribution versions tried in order. Node 24 is required: the dsh
 *  CLI entrypoint dispatches on `import.meta.main`, which Node 22 leaves
 *  undefined (the CLI then silently does nothing). The harness itself ships
 *  Node 24, so the deployed runtime matches the version dsh is tested with. */
export const NODE_VERSION_CANDIDATES = ['v24.21.0']

/** Download roots, tried in order: CN mirror first, then the official one.
 *  Each takes the release-relative file path (`v24.21.0/node-v24.21.0-….tar.gz`). */
const NODE_MIRRORS = [
  (file: string): string => `https://registry.npmmirror.com/-/binary/node/${file}`,
  (file: string): string => `https://nodejs.org/dist/${file}`,
]

/** npm registries for host-side staging, tried in order. */
const NPM_REGISTRIES = ['https://registry.npmmirror.com', 'https://registry.npmjs.org']

/** Pure-JS postinstall packages allowed to run scripts during staging. Native
 *  builds (node-pty & co.) are intentionally excluded: a cross-OS build would
 *  only produce host-platform binaries, and the remote execution world does
 *  not require a pty provider. */
const STAGE_BUILD_ALLOWLIST = ['@google/genai', 'protobufjs', 'koffi']

/** One cached asset ready for upload. */
export interface CachedAsset {
  /** Absolute local path of the artifact. */
  readonly path: string
  /** sha256 of the artifact bytes. */
  readonly sha256: string
  /** Byte size. */
  readonly size: number
  /** The component version this artifact carries. */
  readonly version: string
}

/** Run a local command as a promise with a byte ceiling. */
function execLocal(command: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error != null) {
        const code = typeof error.code === 'number' ? error.code : 1
        resolve({ code, stdout: stdout.toString(), stderr: stderr.toString() })
        return
      }
      resolve({ code: 0, stdout: stdout.toString(), stderr: stderr.toString() })
    })
  })
}

/** The host-side cache root: `~/.dsh/remote-assets/`. */
export function remoteAssetsCacheDir(): string {
  return join(homedir(), '.dsh', 'remote-assets')
}

function sha256File(path: string): Promise<string> {
  return execLocal('shasum', ['-a', '256', path], 60_000).then(r => {
    const line = r.stdout.split('\n')[0] ?? ''
    const hash = line.trim().split(/\s+/)[0] ?? ''
    if (r.code !== 0 || hash.length !== 64) throw new Error(`cannot hash ${path}: ${r.stderr || line}`)
    return hash
  })
}

/** Machine architecture in Node tarball spelling. */
export function nodeArchKey(machine: string): 'x64' | 'arm64' {
  return machine === 'aarch64' || machine === 'arm64' ? 'arm64' : 'x64'
}

/** The `<platformArch>` segment used in cache paths and remote markers. */
export function platformArch(platform: 'linux' | 'darwin', arch: 'x64' | 'arm64'): string {
  return `${platform}-${arch}`
}

/**
 * The cached Node tarball for one platform, downloading it on first use.
 * Every candidate (version × mirror) is probed with a short HEAD request
 * before the real download; a failed download removes the partial file and
 * moves to the next candidate, mirroring the remote-install fallback.
 */
export async function ensureNodeTarball(options: {
  platform: 'linux' | 'darwin'
  arch: 'x64' | 'arm64'
  onProgress?: (message: string, detail?: string) => void
}): Promise<CachedAsset> {
  const notify = options.onProgress ?? (() => {})
  const dir = join(remoteAssetsCacheDir(), platformArch(options.platform, options.arch))
  // The cache directory may not exist on a first-ever run; `curl -o` would
  // fail with a write error before any download starts.
  await mkdir(dir, { recursive: true })
  const failures: string[] = []
  for (const version of NODE_VERSION_CANDIDATES) {
    const file = `node-${version}-${options.platform}-${options.arch}.tar.gz`
    const cached = join(dir, file)
    const ready = `${cached}.ready`
    try {
      const [info, marker] = await Promise.all([stat(cached), readFile(ready, 'utf8').catch(() => '')])
      if (info.isFile() && info.size > 1024 * 1024) {
        const sha256 = await sha256File(cached)
        if (marker.trim() === sha256) {
          notify(`node ${version} cached locally (${(info.size / 1024 / 1024).toFixed(1)} MB)`)
          return { path: cached, sha256, size: info.size, version }
        }
      }
    } catch {}
    // The gzipped distribution is ~30 MB; the official dist only ships .tar.gz
    // for linux/darwin, so no xz decompression is needed on the remote either.
    // Both mirrors key releases by the bare version directory (`/v24.21.0/`),
    // relative to the mirror root — no leading slash, no doubled separators.
    const relative = `${version}/node-${version}-${options.platform}-${options.arch}.tar.gz`
    for (const mirror of NODE_MIRRORS) {
      const url = mirror(relative)
      notify(`downloading node ${version} from ${new URL(url).host}`)
      await rm(cached, { force: true })
      const result = await execLocal('curl', ['-fL', '--retry', '2', '--connect-timeout', '20', '-m', '600', '-o', cached, url], 620_000)
      if (result.code !== 0) {
        // Surface the real reason (missing binary, DNS, 404…) — "trying the
        // next source" must never swallow it.
        const reason = (result.stderr || result.stdout || `curl exit ${result.code}`).trim().split('\n').slice(-3).join(' | ')
        failures.push(`${new URL(url).host}: ${reason}`)
        notify(`download from ${new URL(url).host} failed; trying the next source`, reason)
        await rm(cached, { force: true })
        continue
      }
      const info = await stat(cached)
      const sha256 = await sha256File(cached)
      await writeFile(ready, `${sha256}\n`)
      notify(`node ${version} downloaded (${(info.size / 1024 / 1024).toFixed(1)} MB)`)
      return { path: cached, sha256, size: info.size, version }
    }
  }
  throw new Error(`could not download a Node 22 distribution for ${options.platform}-${options.arch}; attempts: ${failures.join(' ;; ')}`)
}

/** Read one cached asset back by exact path (after a marker hit). */
export async function cachedAssetIfReady(path: string): Promise<CachedAsset | undefined> {
  try {
    const [info, ready] = await Promise.all([stat(path), readFile(`${path}.ready`, 'utf8')])
    const sha256 = ready.trim()
    if (!info.isFile() || sha256.length !== 64) return undefined
    return { path, sha256, size: info.size, version: '' }
  } catch {
    return undefined
  }
}

/** Drop orphaned cache entries (never fails). */
export async function pruneCache(olderThanMs: number): Promise<void> {
  const dir = remoteAssetsCacheDir()
  const entries = await readdir(dir).catch(() => [])
  const now = Date.now()
  for (const entry of entries) {
    const full = join(dir, entry)
    const info = await stat(full).catch(() => undefined)
    if (info !== undefined && now - info.mtimeMs > olderThanMs) await rm(full, { recursive: true, force: true }).catch(() => {})
  }
}

/** The server bundle's content hash — the `server` component's idempotency key. */
export async function sha256OfFiles(files: readonly { path: string; content: Buffer }[]): Promise<string> {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.path)
    hash.update('\0')
    hash.update(file.content)
  }
  return hash.digest('hex')
}

/** A host-side Node + pnpm pair able to stage npm packages. */
export interface HostPnpm {
  readonly node: string
  readonly pnpm: string
}

/**
 * Locate a host-side pnpm launcher.
 *
 * The harness ships one under `~/.dsh/dsh-runtimes/<runtime>/dependencies/pnpm`
 * with a matching Node; a PATH pnpm/node pair is the fallback.
 */
export async function findHostPnpm(): Promise<HostPnpm> {
  const env = process.env
  if (env.DSH_HOST_PNPM !== undefined && env.DSH_HOST_NODE !== undefined) {
    return { node: env.DSH_HOST_NODE, pnpm: env.DSH_HOST_PNPM }
  }
  const runtimes = join(homedir(), '.dsh', 'dsh-runtimes')
  for (const entry of await readdir(runtimes).catch(() => [])) {
    const pnpm = join(runtimes, entry, 'dependencies', 'pnpm', 'bin', 'pnpm.cjs')
    const node = join(runtimes, entry, 'dependencies', 'node', 'bin', 'node')
    const [pnpmOk, nodeOk] = await Promise.all([
      stat(pnpm).then(i => i.isFile(), () => false),
      stat(node).then(i => i.isFile(), () => false),
    ])
    if (pnpmOk && nodeOk) return { node, pnpm }
  }
  throw new Error('cannot find a host pnpm to stage the dsh runtime package')
}

/**
 * Build (or fetch from the local cache) the server package for one target.
 *
 * Staging runs on the host with the exact harness version — the remote never
 * talks to a registry, and the deployed bytes can never drift from the host
 * version. The staging/packing implementation lives in `package-build.ts` and
 * is shared with the release CI script; a GitHub Release download can replace
 * the local staging per the target's package-source policy.
 */
export async function buildDshRuntimePackage(options: {
  version: string
  platform: 'linux' | 'darwin'
  arch: 'x64' | 'arm64'
  libc: '' | 'gnu' | 'musl'
  onProgress?: (message: string, detail?: string) => void
}): Promise<CachedAsset> {
  const notify = options.onProgress ?? (() => {})
  const tag = artifactTag(options.platform, options.arch, options.libc)
  const dir = remoteAssetsCacheDir()
  await mkdir(dir, { recursive: true })
  const cached = join(dir, artifactName(options.version, tag))
  const ready = `${cached}.ready`
  try {
    const [info, marker] = await Promise.all([stat(cached), readFile(ready, 'utf8').catch(() => '')])
    if (info.isFile() && info.size > 1024 * 1024) {
      const sha256 = await sha256File(cached)
      if (marker.trim() === sha256) {
        notify(`dsh server package ${options.version} cached (${(info.size / 1024 / 1024).toFixed(1)} MB)`)
        return { path: cached, sha256, size: info.size, version: options.version }
      }
    }
  } catch {}
  const tool = await findHostPnpm()
  const built = await buildServerPackage({
    version: options.version,
    platform: options.platform,
    arch: options.arch,
    libc: options.libc,
    outDir: dir,
    nodeBin: tool.node,
    pnpmCjs: tool.pnpm,
    onProgress: notify,
  })
  const sha256 = await sha256File(built.file)
  await writeFile(ready, `${sha256}\n`)
  return { path: built.file, sha256, size: built.size, version: options.version }
}

/** The GitHub release asset base for one version. */
function releaseAssetBase(mirror: string, version: string): string {
  const base = mirror.replace(/\/+$/, '') || 'https://github.com'
  return `${base}/graydove/dsh-remote-worspace/releases/download/server-v${version}`
}

/** Download the release-built server package and verify it against its .sha256. */
export async function downloadServerPackage(options: {
  version: string
  platform: 'linux' | 'darwin'
  arch: 'x64' | 'arm64'
  libc: '' | 'gnu' | 'musl'
  mirror: string
  onProgress?: (message: string, detail?: string) => void
}): Promise<CachedAsset> {
  const notify = options.onProgress ?? (() => {})
  const tag = artifactTag(options.platform, options.arch, options.libc)
  const name = artifactName(options.version, tag)
  const dir = remoteAssetsCacheDir()
  await mkdir(dir, { recursive: true })
  const cached = join(dir, name)
  const base = releaseAssetBase(options.mirror, options.version)
  notify(`downloading server package ${name} from ${new URL(`${base}/${name}`).host}`)
  const download = await execLocal('curl', ['-fL', '--retry', '2', '--connect-timeout', '20', '-m', '900', '-o', cached, `${base}/${name}`], 920_000)
  if (download.code !== 0) {
    await rm(cached, { force: true })
    throw new Error(`release download failed: ${(download.stderr || `curl exit ${download.code}`).trim().slice(-300)}`)
  }
  const shaFile = `${cached}.dsh-sha`
  const shaFetch = await execLocal('curl', ['-fL', '--retry', '2', '--connect-timeout', '20', '-m', '60', '-o', shaFile, `${base}/${name}.sha256`], 80_000)
  if (shaFetch.code !== 0) {
    await rm(cached, { force: true })
    throw new Error('release download succeeded but its .sha256 companion is missing; refusing an unverifiable package')
  }
  const expected = (await readFile(shaFile, 'utf8')).trim().split(/\s+/)[0] ?? ''
  await rm(shaFile, { force: true })
  const actual = await sha256File(cached)
  if (expected.length !== 64 || expected !== actual) {
    await rm(cached, { force: true })
    throw new Error(`downloaded server package sha256 mismatch (expected ${expected || 'none'}, got ${actual})`)
  }
  const info = await stat(cached)
  await writeFile(`${cached}.ready`, `${actual}\n`)
  notify(`server package downloaded (${(info.size / 1024 / 1024).toFixed(1)} MB)`)
  return { path: cached, sha256: actual, size: info.size, version: options.version }
}

/** The package-source resolution order for one policy. */
export function sourceOrder(policy: 'auto' | 'download' | 'upload'): readonly ('cache' | 'download' | 'build')[] {
  if (policy === 'download') return ['cache', 'download', 'build'] as const
  if (policy === 'upload') return ['cache', 'build'] as const
  return ['cache', 'download', 'build'] as const
}

/**
 * Resolve the server package per policy. Every source lands in the same local
 * cache, so a policy change or a retry after a partial download never
 * re-fetches what is already on disk.
 */
export async function resolveServerPackage(options: {
  version: string
  platform: 'linux' | 'darwin'
  arch: 'x64' | 'arm64'
  libc: '' | 'gnu' | 'musl'
  policy: 'auto' | 'download' | 'upload'
  mirror: string
  onProgress?: (message: string, detail?: string) => void
}): Promise<{ asset: CachedAsset; via: 'cache' | 'download' | 'build' }> {
  const notify = options.onProgress ?? (() => {})
  const tag = artifactTag(options.platform, options.arch, options.libc)
  const dir = remoteAssetsCacheDir()
  const cached = join(dir, artifactName(options.version, tag))
  const hit = await cachedAssetIfReady(cached)
  if (hit !== undefined) {
    notify(`server package ${options.version} cached (${(hit.size / 1024 / 1024).toFixed(1)} MB)`)
    return { asset: hit, via: 'cache' }
  }
  const errors: string[] = []
  for (const source of sourceOrder(options.policy)) {
    if (source === 'cache') continue
    try {
      if (source === 'download') {
        return { asset: await downloadServerPackage({ ...options }), via: 'download' }
      }
      return { asset: await buildDshRuntimePackage({ ...options }), via: 'build' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${source}: ${message}`)
      notify(`${source === 'download' ? 'release download' : 'local build'} failed; trying the next source`, message)
    }
  }
  throw new Error(`could not obtain the server package ${artifactName(options.version, tag)}; attempts: ${errors.join(' ;; ')}`)
}
