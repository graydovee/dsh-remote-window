/**
 * Server-package staging: turn `@deepseek-ai/dsh@<version>` into one
 * self-contained tarball for a target platform.
 *
 * Shared by the connect flow (`assets.buildDshRuntimePackage`, host-local
 * staging as an offline fallback) and the release build script
 * (`scripts/build-server-package.mjs`, CI matrix). One implementation, so the
 * CI artifact and the locally staged one cannot drift.
 *
 * Native-module closure is the load-bearing part: packages like
 * `node-addon-require-builtin` resolve their binding through *sibling* npm
 * packages named `<name>-<platform>-<arch>[-gnu|msvc]`, which a plain install
 * resolves for the **host** platform (a Mac staging for linux gets darwin
 * bindings — the round-4 failure). We therefore explicitly install the
 * target-platform sibling at the same version and strip foreign-platform
 * siblings, then assert the result.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** npm registries, tried in order: CN mirror first. */
export const STAGE_REGISTRIES = ['https://registry.npmmirror.com', 'https://registry.npmjs.org']

/** Pure-JS postinstall scripts allowed during staging; native builds excluded
 *  (a cross-OS build would only produce host binaries, and the remote world
 *  does not require a pty provider). */
const BUILD_ALLOWLIST = ['@google/genai', 'protobufjs', 'koffi']

/** Run a local command as a promise with a byte ceiling. */
export function execLocal(command: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error != null) {
        const code = typeof error.code === 'number' ? error.code : 1
        resolve({ code, stdout: stdout.toString(), stderr: stderr.toString() })
        return
      }
      resolve({ code: 0, stdout: stdout.toString(), stderr: stderr.toString() })
    })
  })
}

/** The `<platform>-<arch>[-libc]` artifact tag. */
export function artifactTag(platform: 'linux' | 'darwin', arch: 'x64' | 'arm64', libc: '' | 'gnu' | 'musl'): string {
  return libc === '' ? `${platform}-${arch}` : `${platform}-${arch}-${libc}`
}

/** The server-package artifact name for one target. */
export function artifactName(version: string, tag: string): string {
  return `dsh-remote-server-${version}-${tag}.tar.gz`
}

/**
 * The sibling-package suffix that `node-addon-require-builtin` resolves for a
 * target. glibc/musl only exists on linux.
 */
export function bindingPackageSuffix(platform: 'linux' | 'darwin', arch: 'x64' | 'arm64', libc: '' | 'gnu' | 'musl'): string {
  const base = `${platform}-${arch}`
  return platform === 'linux' && libc !== '' ? `${base}-${libc}` : base
}

/** Binding families that ship one sibling package per platform flavour.
 *  `require-builtin` is required on the target; `system` (and any future
 *  family) is stripped when foreign so shipped trees are target-only. */
export const BINDING_FAMILIES = ['node-addon-require-builtin', 'node-addon-system']

const PLATFORM_FLAVOURS = ['darwin', 'linux', 'win32']

/** Split one `.pnpm` entry into a known binding family + flavour, if it is one. */
export function bindingOf(dirName: string): { family: string; flavour: string } | undefined {
  // Scoped names arrive as `@deepseek-ai+node-addon-system-darwin-arm64@0.1.2`.
  const withoutVersion = dirName.replace(/@[^@]+$/, '')
  for (const family of BINDING_FAMILIES) {
    const index = withoutVersion.lastIndexOf(family)
    if (index < 0) continue
    const flavour = withoutVersion.slice(index + family.length + 1)
    if (PLATFORM_FLAVOURS.some(platform => flavour === platform || flavour.startsWith(`${platform}-`))) {
      return { family, flavour }
    }
  }
  return undefined
}

/** Whether one `.pnpm` directory name belongs to a foreign-platform binding. */
export function isForeignBindingDir(dirName: string, suffix: string): boolean {
  const binding = bindingOf(dirName)
  return binding !== undefined && binding.flavour !== suffix
}

/**
 * Stage `@deepseek-ai/dsh@<version>` for one target platform into `stage`.
 * @returns the installed dsh version (from the launcher probe).
 */
export async function stageDshPackage(options: {
  stage: string
  version: string
  platform: 'linux' | 'darwin'
  arch: 'x64' | 'arm64'
  libc: '' | 'gnu' | 'musl'
  nodeBin: string
  pnpmCjs: string
  onProgress?: (message: string, detail?: string) => void
}): Promise<string> {
  const notify = options.onProgress ?? (() => {})
  await mkdir(options.stage, { recursive: true })
  await writeFile(join(options.stage, 'package.json'), `${JSON.stringify({
    name: 'dsh-remote-server',
    private: true,
    pnpm: { onlyBuiltDependencies: BUILD_ALLOWLIST },
  }, null, 2)}\n`)
  const failures: string[] = []
  for (const registry of STAGE_REGISTRIES) {
    await writeFile(join(options.stage, '.npmrc'), [
      `registry=${registry}`,
      `supported-architectures[]=os=${options.platform}`,
      `supported-architectures[]=cpu=${options.arch}`,
      ...(options.platform === 'linux' && options.libc !== '' ? [`supported-architectures[]=libc=${options.libc}`] : []),
      '',
    ].join('\n'))
    notify(`staging @deepseek-ai/dsh@${options.version} via pnpm (${registry.replace('https://', '')}, target ${options.platform}-${options.arch}${options.libc === '' ? '' : `-${options.libc}`})`)
    const add = await execLocal(options.nodeBin, [options.pnpmCjs, '-C', options.stage, 'add', `@deepseek-ai/dsh@${options.version}`, '--loglevel=warn'], 600_000)
    const launcher = join(options.stage, 'node_modules', '.bin', 'dsh')
    const launcherOk = await stat(launcher).then(i => i.isFile(), () => false)
    if (!launcherOk) {
      failures.push(`${registry}: pnpm produced no dsh launcher: ${(add.stderr || add.stdout || `exit ${add.code}`).trim().slice(-300)}`)
      continue
    }
    await fixNativeClosure({ stage: options.stage, platform: options.platform, arch: options.arch, libc: options.libc, nodeBin: options.nodeBin, pnpmCjs: options.pnpmCjs, onProgress: notify })
    const probe = await execLocal('/usr/bin/env', [
      `PATH=/usr/bin:/bin:${join(options.nodeBin, '..')}`,
      launcher, '--version',
    ], 120_000)
    const version = probe.stdout.trim().split('\n')[0] ?? ''
    if (probe.code !== 0 || version === '') {
      failures.push(`${registry}: launcher probe failed: ${(probe.stderr || probe.stdout || `exit ${probe.code}`).trim().slice(-300)}`)
      continue
    }
    return version
  }
  throw new Error(`could not stage @deepseek-ai/dsh@${options.version}; attempts: ${failures.join(' ;; ')}`)
}

/**
 * Install the target-platform native binding siblings and remove the
 * host-platform ones the installer resolved by mistake.
 */
export async function fixNativeClosure(options: {
  stage: string
  platform: 'linux' | 'darwin'
  arch: 'x64' | 'arm64'
  libc: '' | 'gnu' | 'musl'
  nodeBin: string
  pnpmCjs: string
  onProgress?: (message: string, detail?: string) => void
}): Promise<void> {
  const notify = options.onProgress ?? (() => {})
  const pnpmDir = join(options.stage, 'node_modules', '.pnpm')
  const entries = await readdir(pnpmDir).catch(() => [])
  // The binding family's version comes from whichever sibling (or the main
  // package) the resolver already pulled in.
  let bindingVersion = ''
  for (const entry of entries) {
    const match = /^node-addon-require-builtin(?:-.+)?@(\d[^/]*)$/.exec(entry)
    if (match !== null) {
      bindingVersion = match[1] ?? ''
      break
    }
  }
  if (bindingVersion === '') return
  const suffix = bindingPackageSuffix(options.platform, options.arch, options.libc)
  const binding = `node-addon-require-builtin-${suffix}`
  const needed = entries.some(entry => entry.startsWith(`${binding}@`))
  if (!needed) {
    notify(`adding native binding ${binding}@${bindingVersion}`)
    const add = await execLocal(options.nodeBin, [options.pnpmCjs, '-C', options.stage, 'add', `${binding}@${bindingVersion}`, '--loglevel=warn', '--save-optional=false'], 600_000)
    if (add.code !== 0 && add.stdout === '' && add.stderr !== '') {
      // pnpm may exit nonzero for lockfile notes; only a missing launcher
      // directory matters — re-checked below by the caller's probe.
      notify(`binding install warning`, (add.stderr || add.stdout).slice(-300))
    }
  }
  // Strip foreign-platform siblings so the shipped tree is target-only.
  for (const entry of await readdir(pnpmDir).catch(() => [])) {
    if (isForeignBindingDir(entry, suffix)) {
      notify(`removing foreign native binding ${entry}`)
      await rm(join(pnpmDir, entry), { recursive: true, force: true }).catch(() => {})
    }
  }
}

/**
 * Assert the staged tree is target-only: every shipped native binding dir
 * must match the target flavour. Throws with the offending names otherwise.
 */
export async function assertTargetOnly(stage: string, platform: 'linux' | 'darwin', arch: 'x64' | 'arm64', libc: '' | 'gnu' | 'musl'): Promise<void> {
  const suffix = bindingPackageSuffix(platform, arch, libc)
  const pnpmDir = join(stage, 'node_modules', '.pnpm')
  const entries = await readdir(pnpmDir).catch(() => [])
  const foreign = entries.filter(entry => isForeignBindingDir(entry, suffix))
  if (foreign.length > 0) {
    throw new Error(`staged package contains foreign native bindings for ${platform}-${arch}${libc === '' ? '' : `-${libc}`}: ${foreign.join(', ')}`)
  }
  const required = entries.some(entry => entry.startsWith(`node-addon-require-builtin-${suffix}@`))
  if (!required) {
    throw new Error(`staged package is missing the native binding node-addon-require-builtin-${suffix}`)
  }
}

/** Pack one staged tree into `outFile` (macOS AppleDouble files excluded). */
export async function packStage(stage: string, outFile: string): Promise<void> {
  await rm(outFile, { force: true })
  const env = { ...process.env, COPYFILE_DISABLE: '1' }
  await new Promise<void>((resolve, reject) => {
    execFile('/usr/bin/tar', ['-czf', outFile, '-C', stage, '.'], { env, timeout: 300_000, maxBuffer: 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error != null) reject(new Error(`tar failed: ${stderr.toString().trim()}`))
      else resolve()
    })
  })
}

/** CLI entry for the release build script (see scripts/build-server-package.mjs). */
export async function buildServerPackage(options: {
  version: string
  platform: 'linux' | 'darwin'
  arch: 'x64' | 'arm64'
  libc: '' | 'gnu' | 'musl'
  outDir: string
  nodeBin: string
  pnpmCjs: string
  onProgress?: (message: string, detail?: string) => void
}): Promise<{ file: string; sha256: string; size: number; manifest: Record<string, string | number> }> {
  const { createHash } = await import('node:crypto')
  const stage = join(options.outDir, `stage-${randomUUID().slice(0, 8)}`)
  try {
    const dshVersion = await stageDshPackage({ ...options, stage })
    await assertTargetOnly(stage, options.platform, options.arch, options.libc)
    const tag = artifactTag(options.platform, options.arch, options.libc)
    const file = join(options.outDir, artifactName(dshVersion, tag))
    await packStage(stage, file)
    const info = await stat(file)
    const sha256 = createHash('sha256').update(await readFile(file)).digest('hex')
    const manifest = {
      dshVersion,
      platformArch: artifactTag(options.platform, options.arch, options.libc),
      sha256,
      size: info.size,
      minNode: 'v24.21.0',
    }
    await writeFile(`${file}.sha256`, `${sha256}  ${file.split('/').pop()}\n`)
    await writeFile(join(options.outDir, artifactName(dshVersion, tag).replace(/\.tar\.gz$/, '.manifest.json')), `${JSON.stringify(manifest, null, 2)}\n`)
    return { file, sha256, size: info.size, manifest }
  } finally {
    await rm(stage, { recursive: true, force: true }).catch(() => {})
  }
}
