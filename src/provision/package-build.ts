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
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { join, dirname, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

/** npm registries, tried in order: CN mirror first. */
export const STAGE_REGISTRIES = ['https://registry.npmmirror.com', 'https://registry.npmjs.org']

/** One target platform a package can be staged for. */
export type StagePlatform = 'linux' | 'darwin' | 'win32'

/** One target CPU architecture. */
export type StageArch = 'x64' | 'arm64'

/** The C runtime flavour: only linux publishes gnu/musl variants. */
export type StageLibc = '' | 'gnu' | 'musl'

/** Pure-JS postinstall scripts allowed during staging; native builds excluded
 *  (a cross-OS build would only produce host binaries, and the remote world
 *  does not require a pty provider). */
const BUILD_ALLOWLIST = ['@google/genai', 'protobufjs', 'koffi']

/** Run a local command as a promise with a byte ceiling. */
export function execLocal(
  command: string,
  args: string[],
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, ...(env === undefined ? {} : { env }) }, (error, stdout, stderr) => {
      if (error != null) {
        const code = typeof error.code === 'number' ? error.code : 1
        resolve({ code, stdout: stdout.toString(), stderr: stderr.toString() })
        return
      }
      resolve({ code: 0, stdout: stdout.toString(), stderr: stderr.toString() })
    })
  })
}

/**
 * The staged dsh package's own bin entry (a JS file).
 *
 * Resolved from the package manifest rather than `<stage>/node_modules/.bin/dsh`
 * because that shim is a **shell** script: `node .bin/dsh` cannot parse it, and
 * the old POSIX-only probe also hard-coded `/usr/bin/env`, which does not exist
 * on Windows — a Windows host must be able to stage packages for WSL targets.
 * @param stage - the staging directory.
 * @returns the absolute bin script path, or undefined when the package is absent.
 */
async function resolveDshBin(stage: string): Promise<string | undefined> {
  const manifestPath = join(stage, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  let manifest: { bin?: string | Record<string, string> } | undefined
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { bin?: string | Record<string, string> }
  } catch {
    return undefined
  }
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.dsh
  if (typeof bin !== 'string' || bin === '') return undefined
  const script = join(dirname(manifestPath), bin)
  return await stat(script).then(entry => entry.isFile() ? script : undefined, () => undefined)
}

/**
 * The batch launcher shim for a win32 target, in npm cmd-shim shape.
 *
 * pnpm writes `.cmd`/`.ps1` shims only when the **host** is Windows, so a win32
 * target staged from macOS/Linux would otherwise ship just the POSIX
 * `.bin/dsh` shell script and the deployed Windows profile could not start. The
 * installed runtime layout is `<root>/dsh/node_modules/.bin` beside
 * `<root>/node/node.exe`, so the shim prefers the sibling Node tree relatively
 * and falls back to `node` on PATH — the same preference npm's own shim makes.
 * CRLF because it is a batch file. The server itself is launched as
 * `node.exe <dsh bin>` (to track the real node PID), so this is a
 * human-convenience launcher only: it must be correct or absent, never a
 * silent no-op.
 * @param launcherRelative - the dsh JS entry relative to `.bin`, backslash-separated.
 */
export function windowsCmdShim(launcherRelative: string): string {
  return [
    '@ECHO off',
    'SETLOCAL',
    'SET "_prog=%~dp0..\\..\\..\\node\\node.exe"',
    'IF NOT EXIST "%_prog%" SET "_prog=node"',
    `"%_prog%" "%~dp0${launcherRelative}" %*`,
    '',
  ].join('\r\n')
}

/**
 * Ensure `<stage>/node_modules/.bin/dsh.cmd` exists for a win32 target; a
 * Windows-hosted staging run already has pnpm's real shim and is left untouched.
 *
 * The entry is re-read from the installed manifest so the shim follows the
 * package's declared `bin` (npm's shim does the same); the caller's verified
 * launcher is the fallback when the manifest is unreadable.
 */
export async function ensureWindowsLauncherShim(stage: string, launcher: string): Promise<void> {
  const binDir = join(stage, 'node_modules', '.bin')
  const shim = join(binDir, 'dsh.cmd')
  if (await stat(shim).then(entry => entry.isFile(), () => false)) return
  const target = (await resolveDshBin(stage)) ?? launcher
  await mkdir(binDir, { recursive: true })
  await writeFile(shim, windowsCmdShim(relative(binDir, target).split(sep).join('\\')))
}

/** The `<platform>-<arch>[-libc]` artifact tag. */
export function artifactTag(platform: StagePlatform, arch: StageArch, libc: StageLibc): string {
  return libc === '' ? `${platform}-${arch}` : `${platform}-${arch}-${libc}`
}

/** The server-package artifact name for one target. */
export function artifactName(version: string, tag: string): string {
  return `dsh-remote-server-${version}-${tag}.tar.gz`
}

/**
 * The sibling-package suffix that `node-addon-require-builtin` resolves for a
 * target. glibc/musl only exists on linux; win32 builds are MSVC-ABI and carry
 * `-msvc` instead.
 *
 * Verified against the registry (2026-11): `node-addon-require-builtin@0.1.9`
 * declares optionalDependencies `node-addon-require-builtin-win32-x64-msvc`,
 * `-win32-arm64-msvc` and `-win32-ia32-msvc` — the win32 suffix must be
 * `win32-<arch>-msvc`, not `win32-<arch>`.
 */
export function bindingPackageSuffix(platform: StagePlatform, arch: StageArch, libc: StageLibc): string {
  const base = `${platform}-${arch}`
  if (platform === 'win32') return `${base}-msvc`
  return platform === 'linux' && libc !== '' ? `${base}-${libc}` : base
}

/** Binding families that ship one sibling package per platform flavour.
 *  `require-builtin` is required on the target; `system` (and any future
 *  family) is stripped when foreign so shipped trees are target-only. */
export const BINDING_FAMILIES = ['node-addon-require-builtin', 'node-addon-system']

/**
 * The platforms `@deepseek-ai/node-addon-system` publishes a binding for.
 *
 * Verified against the registry (2026-11): 0.1.2 declares
 * darwin-arm64/darwin-x64/linux-x64/linux-arm64 optional siblings and **no
 * win32 build at all** (no `win32-*` optionalDependency). DSH itself fails
 * closed without it — `lib/flock.js` raises the coded
 * `ERR_FLOCK_UNSUPPORTED_PLATFORM` and the entrypoint falls back to a probe —
 * so win32 is a valid target *without* the addon. Staging and the target-only
 * assert therefore skip the system sibling for platforms not listed here,
 * explicitly, instead of treating it as an installation failure. The
 * `node-addon-require-builtin` msvc sibling stays mandatory on win32.
 */
export const SYSTEM_ADDON_PLATFORMS: readonly StagePlatform[] = ['darwin', 'linux']

/** Whether one target should have the `@deepseek-ai/node-addon-system` sibling. */
export function systemAddonSupported(platform: StagePlatform): boolean {
  return SYSTEM_ADDON_PLATFORMS.includes(platform)
}

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
/**
 * The flavour one binding family must carry for one target.
 *
 * `node-addon-require-builtin` publishes `-<libc>` flavours
 * (`linux-x64-gnu`); `node-addon-system` publishes plain `<platform>-<arch>`
 * (`linux-x64`) and has no win32 build at all. Comparing the system family
 * against the require-builtin suffix made every freshly installed system sibling
 * look foreign, so the staging step deleted the binding it had just added.
 */
function targetFlavour(family: string, suffix: string): string {
  return family === 'node-addon-require-builtin' ? suffix : suffix.split('-').slice(0, 2).join('-')
}

/** Whether one `.pnpm` entry is a native binding for some *other* flavour. */
export function isForeignBindingDir(dirName: string, suffix: string): boolean {
  const binding = bindingOf(dirName)
  if (binding === undefined) return false
  return binding.flavour !== targetFlavour(binding.family, suffix)
}

/**
 * The `.npmrc` lines that steer pnpm's optional native siblings at one target.
 *
 * POSIX output is byte-identical to the previous inline list. win32 has no
 * libc concept, so a caller that passes one is ignored rather than emitting an
 * unresolvable `libc=` line (pnpm's `supportedArchitectures` cannot express
 * MSVC ABI — the `-msvc` suffix comes from {@link bindingPackageSuffix}).
 * Exported so the win32 target is unit-testable without a real pnpm install.
 */
/**
 * The `pnpm-workspace.yaml` lines for one target.
 *
 * pnpm 10 reads project settings such as `nodeLinker` from this file, not from
 * `.npmrc` (verified against pnpm 10.34/11.28). A win32 tree must be hoisted so
 * it contains real directories instead of symlinks: Windows `tar.exe` writes
 * reparse points that Node cannot follow (`fs.stat` → EPERM), which stopped a
 * real Windows server from resolving its own entry point. POSIX keeps the
 * default isolated linker and writes no workspace file at all.
 */
export function stageWorkspaceLines(platform: StagePlatform): string[] {
  return platform === 'win32' ? ['nodeLinker: hoisted'] : []
}

export function stageNpmrcLines(options: { readonly platform: StagePlatform; readonly arch: StageArch; readonly libc: StageLibc }): string[] {
  return [
    `supported-architectures[]=os=${options.platform}`,
    `supported-architectures[]=cpu=${options.arch}`,
    ...(options.platform === 'linux' && options.libc !== '' ? [`supported-architectures[]=libc=${options.libc}`] : []),

  ]
}

/**
 * Stage `@deepseek-ai/dsh@<version>` for one target platform into `stage`.
 * @returns the installed dsh version (from the launcher probe).
 */
export async function stageDshPackage(options: {
  stage: string
  version: string
  platform: StagePlatform
  arch: StageArch
  libc: StageLibc
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
      ...stageNpmrcLines(options),
      '',
    ].join('\n'))
    // A win32 tree must not contain symlinks: Windows `tar.exe` writes reparse
    // points that Node cannot follow (`fs.stat` → EPERM), so Node cannot even
    // resolve its own entry point. pnpm 10 reads `nodeLinker` from
    // `pnpm-workspace.yaml` — the `.npmrc` equivalent is ignored (verified), so
    // the hoisted linker is written here, for win32 targets only. Measured on a
    // real Windows 11 host; POSIX artifacts keep the isolated linker.
    const workspace = stageWorkspaceLines(options.platform)
    if (workspace.length > 0) {
      await writeFile(join(options.stage, 'pnpm-workspace.yaml'), `${workspace.join('\n')}\n`)
    }
    notify(`staging @deepseek-ai/dsh@${options.version} via pnpm (${registry.replace('https://', '')}, target ${options.platform}-${options.arch}${options.libc === '' ? '' : `-${options.libc}`})`)
    const add = await execLocal(options.nodeBin, [options.pnpmCjs, '-C', options.stage, 'add', `@deepseek-ai/dsh@${options.version}`, '--loglevel=warn'], 600_000)
    // Probe the package's own bin entry, not `<stage>/node_modules/.bin/dsh`:
    // that shim is a POSIX shell script, so `node .bin/dsh` cannot parse it and
    // `/usr/bin/env` does not exist on Windows at all. Staging must work on a
    // Windows host because WSL targets are Windows-only.
    const launcher = await resolveDshBin(options.stage)
    if (launcher === undefined) {
      failures.push(`${registry}: pnpm produced no dsh launcher: ${(add.stderr || add.stdout || `exit ${add.code}`).trim().slice(-300)}`)
      continue
    }
    await fixNativeClosure({ stage: options.stage, platform: options.platform, arch: options.arch, libc: options.libc, nodeBin: options.nodeBin, pnpmCjs: options.pnpmCjs, onProgress: notify })
    // pnpm writes `.cmd`/`.ps1` shims only when the *host* is Windows; a win32
    // target staged from macOS/Linux must still ship a launcher the Windows
    // profile can start (measured: pnpm 10.34.6 on darwin with the win32
    // supported-architectures creates `node_modules/.bin/dsh` only).
    if (options.platform === 'win32') await ensureWindowsLauncherShim(options.stage, launcher)
    const probe = await execLocal(options.nodeBin, [launcher, '--version'], 120_000)
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
  platform: StagePlatform
  arch: StageArch
  libc: StageLibc
  nodeBin: string
  pnpmCjs: string
  onProgress?: (message: string, detail?: string) => void
}): Promise<void> {
  const notify = options.onProgress ?? (() => {})
  const pnpmDir = join(options.stage, 'node_modules', '.pnpm')
  const suffix = bindingPackageSuffix(options.platform, options.arch, options.libc)
  const plainSuffix = `${options.platform}-${options.arch}`

  /**
   * Native packages whose platform sibling must be installed for the *target*.
   *
   * `node-addon-require-builtin` is the PTC/`import.meta.main` addon and carries
   * `-<libc>` (or `-msvc` on win32); `@deepseek-ai/node-addon-system` is the
   * flock/file-lock addon and publishes plain `<platform>-<arch>` siblings —
   * but **no win32 build at all** (verified against the registry: 0.1.2 ships
   * darwin-arm64/darwin-x64/linux-x64/linux-arm64 only), so a win32 target must
   * not try to install one. DSH itself tolerates the missing addon (its
   * `lib/flock.js` raises the coded `ERR_FLOCK_UNSUPPORTED_PLATFORM` and the
   * entrypoint falls back to a probe), so skipping is the correct target state.
   * For linux/darwin the system sibling stays required: a host with no sibling
   * for the target (Windows staging linux) would otherwise install none and the
   * deployed server would die on the first lock with
   * `Cannot find module '@deepseek-ai/node-addon-system-linux-x64/package.json'`.
   */
  const families: readonly { readonly main: RegExp; readonly target: string }[] = [
    // The explicit sibling add is load-bearing: verified pnpm 10.34/11.28
    // **ignore** `supported-architectures[]` from `.npmrc` (those settings moved
    // to `pnpm-workspace.yaml`), so a win32 target staged from macOS/Linux would
    // otherwise install the *host* sibling. Linux/darwin worked only because this
    // add already existed.
    { main: /^node-addon-require-builtin(?:-.+)?@(\d[^/]*)$/, target: `node-addon-require-builtin-${suffix}` },
    ...(systemAddonSupported(options.platform)
      ? [{ main: /^@deepseek-ai\+node-addon-system@(\d[^/]*)$/, target: `@deepseek-ai/node-addon-system-${plainSuffix}` }]
      : []),
  ]

  for (const family of families) {
    const entries = await readdir(pnpmDir).catch(() => [])
    let version = ''
    for (const entry of entries) {
      const match = family.main.exec(entry)
      if (match !== null) {
        version = match[1] ?? ''
        break
      }
    }
    // A hoisted tree keeps the package as a real directory and has no store
    // entry to read the version from, so fall back to its manifest.
    const mainName = family.target.split('/')[0] === '@deepseek-ai' ? '@deepseek-ai/node-addon-system' : 'node-addon-require-builtin'
    if (version === '') {
      const manifest = await readFile(join(options.stage, 'node_modules', mainName, 'package.json'), 'utf8').catch(() => undefined)
      if (manifest !== undefined) {
        try {
          const parsed = JSON.parse(manifest) as { version?: unknown }
          if (typeof parsed.version === 'string') version = parsed.version
        } catch {
          // A broken manifest only means "unknown version": skip this family.
        }
      }
    }
    if (version === '') continue
    const flatName = family.target.replace('/', '+')
    if (entries.some(entry => entry.startsWith(`${flatName}@`))) continue
    if (existsSync(join(options.stage, 'node_modules', family.target))) continue
    notify(`adding native binding ${family.target}@${version}`)
    const add = await execLocal(options.nodeBin, [options.pnpmCjs, '-C', options.stage, 'add', `${family.target}@${version}`, '--loglevel=warn', '--save-optional=false'], 600_000)
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
  // A hoisted tree (win32) keeps the packages as real directories, so the same
  // strip has to run against `node_modules` and `node_modules/@deepseek-ai`.
  const modulesDir = join(options.stage, 'node_modules')
  const candidates: { path: string; name: string }[] = []
  for (const name of await readdir(modulesDir).catch(() => [] as string[])) {
    if (bindingSuffixOf(name) !== undefined) candidates.push({ path: join(modulesDir, name), name })
  }
  const scopedDir = join(modulesDir, '@deepseek-ai')
  for (const name of await readdir(scopedDir).catch(() => [] as string[])) {
    const scopedName = `@deepseek-ai/${name}`
    if (bindingSuffixOf(scopedName) !== undefined) {
      candidates.push({ path: join(scopedDir, name), name: scopedName })
    }
  }
  for (const candidate of candidates) {
    const found = bindingSuffixOf(candidate.name) ?? ''
    const expected = candidate.name.startsWith('@deepseek-ai/node-addon-system-') ? plainSuffix : suffix
    if (found === expected) continue
    notify(`removing foreign native binding ${candidate.name}`)
    await rm(candidate.path, { recursive: true, force: true }).catch(() => {})
  }
}

/** Whether one `.pnpm` entry is a foreign `node-addon-system` platform sibling. */
function isForeignSystemBinding(entry: string, plainSuffix: string): boolean {
  const match = /^@deepseek-ai\+node-addon-system-(.+?)@/.exec(entry)
  return match !== null && match[1] !== plainSuffix
}

/**
 * Assert the staged tree is target-only: every shipped native binding dir
 * must match the target flavour. Throws with the offending names otherwise.
 */
/** The platform suffix of a native binding module name, from either linker. */
function bindingSuffixOf(name: string): string | undefined {
  const scoped = /^@deepseek-ai\/node-addon-system-(.+)$/u.exec(name)
  if (scoped !== null) return scoped[1]
  const plain = /^node-addon-require-builtin-(.+)$/u.exec(name)
  if (plain !== null) return plain[1]
  return undefined
}

/** Drop the `@<version>` a pnpm store entry carries (`name@1.2.3`). */
function storeNameOf(entry: string): string {
  const at = entry.lastIndexOf('@')
  const name = at > 0 ? entry.slice(0, at) : entry
  return name.replace('@deepseek-ai+', '@deepseek-ai/')
}

export async function assertTargetOnly(stage: string, platform: StagePlatform, arch: StageArch, libc: StageLibc): Promise<void> {
  const suffix = bindingPackageSuffix(platform, arch, libc)
  const plainSuffix = `${platform}-${arch}`
  const modulesDir = join(stage, 'node_modules')
  const pnpmEntries = await readdir(join(modulesDir, '.pnpm')).catch(() => [] as string[])
  const modules = await readdir(modulesDir).catch(() => [] as string[])
  const scoped = await readdir(join(modulesDir, '@deepseek-ai')).catch(() => [] as string[])
  // Both linkers are supported, and a hoisted tree may still keep a `.pnpm`
  // store next to the real directories: collect the binding names from both.
  const names = new Set<string>([
    ...modules.filter(name => !name.startsWith('.') && !name.startsWith('@')),
    ...scoped.map(name => `@deepseek-ai/${name}`),
    ...pnpmEntries.map(storeNameOf),
  ])
  const bindings = [...names].filter(name => bindingSuffixOf(name) !== undefined)
  // The main `node-addon-system` package carries no platform suffix, so it is
  // not in `bindings`; membership checks read `names` directly.
  const has = (name: string): boolean => names.has(name)
  const foreign = bindings.filter(name => {
    const found = bindingSuffixOf(name) ?? ''
    return name.startsWith('@deepseek-ai/node-addon-system-')
      ? found !== plainSuffix
      : found !== suffix
  })
  if (foreign.length > 0) {
    throw new Error(`staged package contains foreign native bindings for ${platform}-${arch}${libc === '' ? '' : `-${libc}`}: ${foreign.join(', ')}`)
  }
  if (!has(`node-addon-require-builtin-${suffix}`)) {
    throw new Error(`staged package is missing the native binding node-addon-require-builtin-${suffix}`)
  }
  // Platforms the system addon does not publish for (win32: no binding in
  // 0.1.2; DSH fails closed with ERR_FLOCK_UNSUPPORTED_PLATFORM and probes)
  // must not require the sibling. The require-builtin binding above is still
  // mandatory — the skip is only for the addon that has no build.
  if (!systemAddonSupported(platform)) return
  if (has('@deepseek-ai/node-addon-system') && !has(`@deepseek-ai/node-addon-system-${plainSuffix}`)) {
    throw new Error(`staged package is missing the native binding @deepseek-ai/node-addon-system-${plainSuffix}`)
  }
}

/**
 * A usable `tar` for packing the staged tree.
 *
 * `/usr/bin/tar` is the POSIX default, but this build also has to run on a
 * **Windows** host — WSL targets are Windows-only, so their server package is
 * staged here too. Windows 10+ ships bsdtar as `tar.exe` on PATH, and it accepts
 * the same `-czf … -C … .` invocation; without this fallback every Windows
 * build died with ENOENT on `/usr/bin/tar`.
 */
function tarExecutable(): string {
  return existsSync('/usr/bin/tar') ? '/usr/bin/tar' : 'tar'
}

/**
 * How long one `tar` pass may take.
 *
 * Measured on a Windows host (bsdtar, alpha51): packing the staged dsh tree —
 * ~31k entries, ~144 MB — needs **5–6 minutes**, and the old 300 s cap killed
 * tar mid-stream. Because the archive used to be written *in place*, the result
 * was a 135,659,520-byte `.tar.gz` that looked like an artifact but answered
 * `tar -tzf: Truncated input file`, with empty stderr and no `.sha256` /
 * `.manifest.json` next to it. 15 minutes keeps headroom for a slow disk while
 * still bounding a hang.
 */
export const PACK_TIMEOUT_MS = 900_000

/** One finished `tar` run, as {@link packStage} needs to see it. */
export interface TarRunResult {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stderr: string
}

/**
 * How one `tar` invocation is executed.
 *
 * Injectable so {@link packStage}'s guarantees — pack into `.partial`, publish by
 * rename, never leave a half-written archive at the final name — are unit-tested
 * without a real `tar` and without waiting out a timeout.
 */
export type TarRunner = (options: {
  readonly executable: string
  readonly args: readonly string[]
  readonly timeoutMs: number
  readonly env: NodeJS.ProcessEnv
}) => Promise<TarRunResult>

/** The production runner: `execFile` with {@link PACK_TIMEOUT_MS}. */
function runTar(options: { executable: string; args: readonly string[]; timeoutMs: number; env: NodeJS.ProcessEnv }): Promise<TarRunResult> {
  type ExecFailure = Error & { code?: number | string; signal?: NodeJS.Signals | null }
  return new Promise<TarRunResult>((resolve) => {
    execFile(options.executable, [...options.args], { env: options.env, timeout: options.timeoutMs, maxBuffer: 1024 * 1024 }, (error, _stdout, stderr) => {
      const failure = error as ExecFailure | null
      resolve({
        // A timeout kills tar, so `code` stays null and `signal` is what tells the
        // reason apart from a plain non-zero exit.
        code: failure === null ? 0 : typeof failure.code === 'number' ? failure.code : null,
        signal: failure?.signal ?? null,
        stderr: stderr?.toString() ?? '',
      })
    })
  })
}

/**
 * Pack one staged tree into `outFile` (macOS AppleDouble files excluded).
 *
 * Two measured constraints:
 *
 * 1. **Pack into a per-run `<outFile>.<pid>-<rand>.partial`, publish with
 *    `rename`.** A killed tar must not leave bytes at the final name:
 *    `assets.cachedAssetIfReady` trusts file-size + the `.ready` digest and a
 *    release upload trusts the file name, so a truncated archive at the final
 *    path is a *silent* bad deployment. A failed run therefore leaves the
 *    previous artifact untouched and removes only its own partial. The suffix is
 *    unique per run because two connects can resolve the same artifact at the
 *    same time (`assets.resolveServerPackage`): with a fixed `.partial` name each
 *    would delete the other's in-progress archive. A crashed run can leave one
 *    such file behind; it is never published, and `assets.pruneCache` reaps it.
 * 2. **Name the reason on failure.** A timeout kills tar with empty stderr,
 *    which is why the alpha51 failure read `tar failed: ` and had to be
 *    diagnosed by measuring the output file. The signal and the pack budget are
 *    now part of the message.
 * @param stage - absolute path of the staged package tree.
 * @param outFile - absolute path of the final archive.
 * @param runner - tar invoker; tests inject a scripted one.
 */
export async function packStage(stage: string, outFile: string, runner: TarRunner = runTar): Promise<void> {
  const partial = `${outFile}.${process.pid}-${randomUUID().slice(0, 8)}.partial`
  let result: TarRunResult
  try {
    result = await runner({
      executable: tarExecutable(),
      args: ['-czf', partial, '-C', stage, '.'],
      timeoutMs: PACK_TIMEOUT_MS,
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    })
  } catch (error) {
    await rm(partial, { force: true }).catch(() => {})
    throw error
  }
  if (result.code !== 0) {
    await rm(partial, { force: true }).catch(() => {})
    const detail = result.stderr.trim()
    const cause = result.signal === null
      ? `exit ${result.code === null ? 'unknown' : String(result.code)}`
      : `signal ${result.signal}`
    throw new Error(`tar failed (${cause}; pack budget ${PACK_TIMEOUT_MS} ms): ${detail !== '' ? detail : 'no stderr output'}`)
  }
  // `rename` replaces an existing artifact atomically on POSIX and on Windows
  // (Node maps it to MoveFileEx with MOVEFILE_REPLACE_EXISTING).
  await rename(partial, outFile)
}

/** CLI entry for the release build script (see scripts/build-server-package.mjs). */
export async function buildServerPackage(options: {
  version: string
  platform: StagePlatform
  arch: StageArch
  libc: StageLibc
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
