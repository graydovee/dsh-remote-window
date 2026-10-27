/**
 * Build one isolated DSH runtime artifact when the client cache has no
 * platform-matched release artifact.
 *
 * The published artifact has two top-level directories — `node/` (a complete
 * Node distribution) and `dsh/` (an installed `@deepseek-ai/dsh@<version>`) —
 * because the remote profile needs both: its launcher PATH starts with
 * `<node>/bin` and `<dsh>/node_modules/.bin`. This is the same layout the
 * server repository's `scripts/build-runtime-artifact.mjs` publishes.
 *
 * This is deliberately a *fallback*: `resolveRuntime` first checks the cache
 * (and `DSH_RW_RUNTIME_ARTIFACT`), and only calls this builder when neither is
 * available. Building needs a host pnpm and npm/node downloads, so it is slower
 * than an upload; the caller reports its progress on the connect step.
 */
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { ensureNodeTarball, findHostPnpm, remoteAssetsCacheDir, sha256File } from './assets.ts'
import { assertTargetOnly, execLocal, stageDshPackage } from './package-build.ts'
import { runtimeArtifactName } from './runtime.ts'

/** One locally built runtime artifact. */
export interface BuiltRuntimeArtifact {
  readonly path: string
  readonly sha256: string
  readonly size: number
}

export interface BuildRuntimeArtifactOptions {
  readonly version: string
  readonly platform: 'linux' | 'darwin'
  readonly arch: 'x64' | 'arm64'
  /** Artifact directory; defaults to `~/.dsh/remote-assets`. */
  readonly cacheDir?: string
  readonly onProgress?: (message: string, detail?: string) => void
}

/** One command that must succeed; its stderr is kept for the thrown error. */
async function run(command: string, args: readonly string[], timeoutMs: number): Promise<void> {
  const result = await execLocal(command, [...args], timeoutMs)
  if (result.code !== 0) {
    throw new Error(`${command} ${args[0] ?? ''} failed (exit ${String(result.code)}): ${(result.stderr || result.stdout).trim().slice(-600)}`)
  }
}

/**
 * A cached artifact is usable when it is a regular file with real content and,
 * when a `.sha256` sidecar exists, matches it. The sidecar is optional for
 * backward compatibility with artifacts uploaded before this fallback existed.
 */
async function usable(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size <= 1024 * 1024) return false
    const sidecar = await readFile(`${path}.sha256`, 'utf8').catch(() => undefined)
    if (sidecar === undefined) return true
    const expected = sidecar.trim().split(/\s+/)[0]?.toLowerCase()
    if (expected === undefined || !/^[a-f0-9]{64}$/.test(expected)) return false
    return (await sha256File(path)).toLowerCase() === expected
  } catch {
    return false
  }
}

/**
 * Extract a Node tarball into `<work>/node`.
 *
 * The official archives contain one top-level directory; renaming it avoids a
 * full second copy of a ~100 MB tree. `bin/node` is required so a corrupt
 * download fails before a 178 MB artifact is packed.
 */
async function extractNode(archive: string, work: string, onProgress: (message: string) => void): Promise<string> {
  const unpack = join(work, 'node-unpack')
  await mkdir(unpack, { recursive: true })
  onProgress('正在解压 Node 运行时…')
  await run('tar', ['-xzf', resolve(archive), '-C', unpack], 120_000)
  const entries = await readdir(unpack, { withFileTypes: true })
  const directory = entries.find(entry => entry.isDirectory())
  if (directory === undefined) throw new Error('the Node archive has no top-level directory')
  const source = join(unpack, directory.name)
  const nodeBin = await stat(join(source, 'bin', 'node')).catch(() => undefined)
  if (nodeBin === undefined || !nodeBin.isFile()) throw new Error('the Node archive has no bin/node')
  const target = join(work, 'node')
  await rename(source, target)
  await rm(unpack, { recursive: true, force: true }).catch(() => undefined)
  return target
}

/**
 * Build a `node/` + `dsh/` runtime tarball for one target platform.
 *
 * The target platform is the *remote* one; the staging commands always use the
 * host's Node/pnpm. That distinction is why `stageDshPackage` gets the host Node
 * while the downloaded Node tree is only packaged for the remote.
 */
export async function buildRuntimeArtifact(options: BuildRuntimeArtifactOptions): Promise<BuiltRuntimeArtifact> {
  const notify = options.onProgress ?? (() => {})
  const platformArch = `${options.platform}-${options.arch}`
  const dir = options.cacheDir ?? remoteAssetsCacheDir()
  await mkdir(dir, { recursive: true })
  const path = join(dir, runtimeArtifactName(options.version, platformArch))
  if (await usable(path)) {
    const info = await stat(path)
    const sha256 = await sha256File(path)
    notify(`已复用本地构建的运行时 ${options.version} (${(info.size / 1024 / 1024).toFixed(1)} MB)`)
    return { path, sha256, size: info.size }
  }

  const node = await ensureNodeTarball({ platform: options.platform, arch: options.arch, onProgress: notify })
  const host = await findHostPnpm()
  const work = join(tmpdir(), `dsh-runtime-build-${process.pid}-${Date.now()}`)
  const partial = join(dir, `.${basename(path)}.${process.pid}.partial`)
  await mkdir(work, { recursive: true })
  try {
    const nodeStage = await extractNode(node.path, work, notify)
    const dshStage = join(work, 'dsh')
    await mkdir(dshStage, { recursive: true })
    notify(`正在打包 @deepseek-ai/dsh@${options.version} (${platformArch})…`)
    await stageDshPackage({
      stage: dshStage,
      version: options.version,
      platform: options.platform,
      arch: options.arch,
      libc: options.platform === 'linux' ? 'gnu' : '',
      nodeBin: host.node,
      pnpmCjs: host.pnpm,
      onProgress: notify,
    })
    await assertTargetOnly(dshStage, options.platform, options.arch, options.platform === 'linux' ? 'gnu' : '')
    notify('正在生成运行时压缩包…')
    // Pack to a sibling file and rename only after tar succeeds. A failed or
    // interrupted build must never leave a large partial file that the next
    // connect mistakes for a complete cached artifact.
    await run('tar', ['-czf', partial, '-C', work, 'node', 'dsh'], 900_000)
    await rename(partial, path)
    const info = await stat(path)
    const sha256 = await sha256File(path)
    await writeFile(`${path}.sha256`, `${sha256}  ${runtimeArtifactName(options.version, platformArch)}\n`, 'utf8')
    notify(`运行时已构建 ${(info.size / 1024 / 1024).toFixed(1)} MB`, path)
    return { path, sha256, size: info.size }
  } finally {
    await rm(partial, { force: true }).catch(() => undefined)
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

