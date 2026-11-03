/**
 * Build one isolated DSH runtime artifact when the client cache has no
 * platform-matched release artifact.
 *
 * The published artifact has two top-level directories — `node/` (a complete
 * Node distribution) and `dsh/` (an installed `@deepseek-ai/dsh@<version>`) —
 * because the remote profile needs both: its launcher PATH starts with
 * `<node>/bin` and `<dsh>/node_modules/.bin` (POSIX) or `<node>` and
 * `<dsh>/node_modules/.bin` on win32, where the node tree holds `node.exe` at
 * its root. This is the same layout the server repository's
 * `scripts/build-runtime-artifact.mjs` publishes.
 *
 * This is deliberately a *fallback*: `resolveRuntime` first checks the cache
 * (and `DSH_RW_RUNTIME_ARTIFACT`), and only calls this builder when neither is
 * available. Building needs a host pnpm and npm/node downloads, so it is slower
 * than an upload; the caller reports its progress on the connect step.
 */
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { ensureNodeTarball, findHostPnpm, remoteAssetsCacheDir, sha256File } from './assets.ts'
import { assertTargetOnly, execLocal, stageDshPackage, type StageArch, type StagePlatform } from './package-build.ts'
import { runtimeArtifactName } from './runtime.ts'

/** One locally built runtime artifact. */
export interface BuiltRuntimeArtifact {
  readonly path: string
  readonly sha256: string
  readonly size: number
}

export interface BuildRuntimeArtifactOptions {
  readonly version: string
  readonly platform: StagePlatform
  readonly arch: StageArch
  /** Artifact directory; defaults to `~/.dsh/remote-assets`. */
  readonly cacheDir?: string
  readonly onProgress?: (message: string, detail?: string) => void
}

/** One command that must succeed; its stderr is kept for the thrown error. */
async function run(command: string, args: readonly string[], timeoutMs: number): Promise<void> {
  // `COPYFILE_DISABLE=1` keeps macOS `tar` from emitting AppleDouble `._*`
  // sidecars into the artifact: they are junk on a POSIX server and plain noise
  // (thousands of files) on a Windows one.
  const result = await execLocal(command, [...args], timeoutMs, { ...process.env, COPYFILE_DISABLE: '1' })
  if (result.code !== 0) {
    throw new Error(`${command} ${args[0] ?? ''} failed (exit ${String(result.code)}): ${(result.stderr || result.stdout).trim().slice(-600)}`)
  }
}

/**
 * How one archive extraction is executed.
 *
 * Injectable so the win32 (`node.exe`) and POSIX (`bin/node`) layouts are unit
 * tested without a real `tar` or a multi-megabyte download.
 */
export type ExtractRunner = (command: string, args: readonly string[], timeoutMs: number) => Promise<void>

/** The production extraction runner: the same failure shape as {@link run}. */
const runExtract: ExtractRunner = async (command, args, timeoutMs) => {
  await run(command, args, timeoutMs)
}

/**
 * A cached artifact is usable when it is a regular file with real content and,
 * when a `.sha256` sidecar exists, matches it. The sidecar is optional for
 * backward compatibility with artifacts uploaded before this fallback existed.
 */
/**
 * Drop macOS AppleDouble sidecars from a staged tree.
 *
 * Extracting the Windows Node zip on macOS leaves `._*` companions next to the
 * real files; they are noise on a POSIX server and thousands of junk files on a
 * Windows one. Best effort: a failed unlink must never fail a build.
 */
async function pruneAppleDouble(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.name === '__MACOSX') {
      await rm(path, { recursive: true, force: true }).catch(() => {})
      continue
    }
    if (entry.isDirectory()) {
      await pruneAppleDouble(path)
      continue
    }
    if (entry.name.startsWith('._')) await unlink(path).catch(() => {})
  }
}

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
 * Extract a Node distribution into `<work>/node`.
 *
 * The official POSIX archives contain one top-level directory and an executable
 * `bin/node`; the Windows distribution is a **zip** whose top-level directory
 * holds `node.exe` (there is no `bin/`). Renaming the top-level directory
 * avoids a full second copy of a ~100 MB tree, and the binary check makes a
 * corrupt download fail before a 178 MB artifact is packed.
 * @param archive - the downloaded official archive (`.tar.gz`, or `.zip` on win32).
 * @param work - the build directory the extracted tree is renamed into.
 * @param platform - the target platform (not the host).
 * @param onProgress - progress reporter.
 * @param extract - extraction invoker; tests inject a scripted one.
 */
export async function extractNode(
  archive: string,
  work: string,
  platform: StagePlatform,
  onProgress: (message: string) => void,
  extract: ExtractRunner = runExtract,
): Promise<string> {
  const windows = platform === 'win32'
  const unpack = join(work, 'node-unpack')
  await mkdir(unpack, { recursive: true })
  onProgress('正在解压 Node 运行时…')
  // POSIX archives are gzipped; the win32 zip is not, and `-z` would force a
  // gzip decoder on it, so win32 uses plain `-xf` (bsdtar auto-detects zip).
  await extract('tar', windows ? ['-xf', resolve(archive), '-C', unpack] : ['-xzf', resolve(archive), '-C', unpack], 120_000)
  const entries = await readdir(unpack, { withFileTypes: true })
  const directory = entries.find(entry => entry.isDirectory())
  if (directory === undefined) throw new Error('the Node archive has no top-level directory')
  const source = join(unpack, directory.name)
  const nodeBin = await stat(join(source, ...(windows ? ['node.exe'] : ['bin', 'node']))).catch(() => undefined)
  if (nodeBin === undefined || !nodeBin.isFile()) throw new Error(windows ? 'the Node archive has no node.exe' : 'the Node archive has no bin/node')
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
    const nodeStage = await extractNode(node.path, work, options.platform, notify)
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
    // `-h` dereferences symlinks. A win32 tree must not contain them: Windows
    // `tar.exe` writes reparse points that Node cannot follow (`fs.stat` →
    // EPERM), so the artifact shipped to a Windows server carries real files.
    // POSIX keeps `-czf` and the symlinked pnpm layout it always had.
    const dereference = options.platform === 'win32' ? ['-czhf'] : ['-czf']
    await pruneAppleDouble(join(work, 'node'))
    await pruneAppleDouble(join(work, 'dsh'))
    await run('tar', [...dereference, partial, '-C', work, 'node', 'dsh'], 900_000)
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

