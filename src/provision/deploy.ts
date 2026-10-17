/**
 * ZCode-style remote deployment.
 *
 * Every component lands in one fixed root (`~/.dsh/server/`), the whole flow
 * runs under `/bin/sh -c` with absolute paths (no remote PATH, no login shell,
 * no package manager for node), and idempotency comes from per-component
 * marker files under `~/.dsh/server/.components/`:
 *
 * - `node`   — the official Node distribution tarball, uploaded from the
 *              host-side cache (`assets.ts`), extracted into staging and
 *              atomically moved into place. Marker: id+version+platformArch.
 * - `dsh`    — installed with the deployed node's *own* npm (an official
 *              distribution always ships it) into `~/.dsh/server/prefix`.
 *              Marker: the `dsh --version` output.
 * - `plugin` — this plugin's lib plus the profile files, plain-copied.
 *              Marker: the sha256 of the uploaded file set.
 *
 * A marker is written only *after* the component verifies, so a failed deploy
 * can never make an old binary look current.
 */
import type { RemoteTransport } from './transport.ts'
import { pathAssignment, shellQuote } from './profile.ts'
import type { RemoteFile } from './profile.ts'
import type { CachedAsset } from './assets.ts'

/** The fixed remote installation root. */
export const SERVER_ROOT = '.dsh/server'

/** Component marker directory, under {@link SERVER_ROOT}. */
export const COMPONENTS_DIR = `${SERVER_ROOT}/.components`

/** How long a stale `.deploy.lock` may sit before a new deploy reclaims it. */
const LOCK_STALE_MS = 10 * 60 * 1000

/** The node component's marker file record. */
export interface NodeMarker {
  readonly id: 'node'
  readonly version: string
  readonly platformArch: string
  readonly sha256: string
}

/** The dsh component's marker file record. */
export interface DshMarker {
  readonly id: 'dsh'
  readonly version: string
  readonly sha256: string
}

/** The plugin component's marker file record. */
export interface PluginMarker {
  readonly id: 'plugin'
  readonly sha256: string
}

/** Everything one deployment needs to know about the remote host. */
export interface RemoteEnvironment {
  /** Absolute remote home directory. */
  readonly home: string
  /** `linux` or `darwin` (the only remote platforms Node ships for this use). */
  readonly platform: 'linux' | 'darwin'
  readonly arch: 'x64' | 'arm64'
  /** `<platform>-<arch>`, e.g. `linux-x64`. */
  readonly platformArch: string
  /** glibc vs musl (linux only; '' elsewhere) — selects the package variant. */
  readonly libc: '' | 'gnu' | 'musl'
  readonly tools: { tar: boolean; sha256sum: boolean; curl: boolean; wget: boolean }
  readonly node: NodeMarker | undefined
  readonly dsh: DshMarker | undefined
  readonly plugin: PluginMarker | undefined
}

/** Quote one argv element for the remote POSIX shell. */
const q = shellQuote

/** Wrap a command body so it always runs under `/bin/sh` — never the user's login shell. */
export function sh(body: string): string {
  return `/bin/sh -c ${q(body)}`
}

/** A remote path inside the server root, rooted at the detected home. */
export function serverPath(home: string, relative: string): string {
  return `${home}/${SERVER_ROOT}/${relative}`
}

/** Parse one component marker JSON, tolerating absence or corruption. */
export function parseMarker<T>(raw: string | undefined): T | undefined {
  const text = raw?.trim() ?? ''
  if (text === '') return undefined
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

/**
 * Fold the probe's separator-framed output into a {@link RemoteEnvironment}.
 * Pure so the decision layer is unit-testable without a host.
 */
export function parseProbeOutput(stdout: string): Omit<RemoteEnvironment, 'platformArch' | 'arch' | 'platform' | 'libc'> & {
  platform: string
  arch: string
  libc: '' | 'gnu' | 'musl'
} {
  const segments = stdout.split('@@RW@@').map(segment => segment.trim())
  const home = (segments[0] ?? '').split('\n')[0] ?? ''
  const uname = (segments[1] ?? '').split('\n').map(line => line.trim()).filter(Boolean)
  const ostype = ((segments[2] ?? '').split('\n')[0] ?? '').trim().toLowerCase()
  const tools = (segments[3] ?? '').split('\n').map(line => line.trim().split('/').pop() ?? '').filter(Boolean)
  // A Linux container may fake `uname -s`; `/proc/sys/kernel/ostype` tells the
  // truth (ZCode's detectEnv does the same).
  const platform = ostype.includes('linux') || (uname[0] === 'Darwin' && ostype === 'linux') ? 'linux' : uname[0] === 'Darwin' ? 'darwin' : 'linux'
  const rawArch = uname[1] ?? ''
  const arch = rawArch === 'arm64' || rawArch === 'aarch64' ? 'arm64' : 'x64'
  const ldd = ((segments[7] ?? '').split('\n')[0] ?? '').toLowerCase()
  const libc = platform !== 'linux' ? '' : ldd.includes('musl') ? 'musl' : 'gnu'
  return {
    home,
    platform,
    arch,
    libc,
    tools: {
      tar: tools.includes('tar'),
      sha256sum: tools.includes('sha256sum') || tools.includes('shasum'),
      curl: tools.includes('curl'),
      wget: tools.includes('wget'),
    },
    node: parseMarker<NodeMarker>(segments[4]),
    dsh: parseMarker<DshMarker>(segments[5]),
    plugin: parseMarker<PluginMarker>(segments[6]),
  }
}

/** The one-shot environment probe: facts only, framed by `@@RW@@` separators. */
export function probeScript(): string {
  return [
    'printf \'%s\\n\' "$HOME"',
    "printf '@@RW@@\\n'",
    'uname -s; uname -m',
    "printf '@@RW@@\\n'",
    'cat /proc/sys/kernel/ostype 2>/dev/null || true',
    "printf '@@RW@@\\n'",
    'for t in tar sha256sum shasum curl wget; do command -v "$t" 2>/dev/null || true; done',
    "printf '@@RW@@\\n'",
    'mkdir -p ~/.dsh/server/.components',
    'cat ~/.dsh/server/.components/node.json 2>/dev/null || true',
    "printf '@@RW@@\\n'",
    'cat ~/.dsh/server/.components/dsh.json 2>/dev/null || true',
    "printf '@@RW@@\\n'",
    'cat ~/.dsh/server/.components/plugin.json 2>/dev/null || true',
    "printf '@@RW@@\\n'",
    'ldd --version 2>&1 | head -1 || true',
  ].join('\n')
}

/**
 * Decide whether the deployed node component is current.
 * The marker must match the cached artifact on id, version AND platformArch,
 * and the decision to skip is only safe together with a live `node -v` probe,
 * so a half-deleted deployment still redeploys.
 */
export function decideNode(marker: NodeMarker | undefined, asset: Pick<CachedAsset, 'version' | 'sha256'>, platformArch: string): 'skip' | 'deploy' {
  return marker !== undefined && marker.version === asset.version && marker.platformArch === platformArch && marker.sha256 === asset.sha256 ? 'skip' : 'deploy'
}

/** Decide whether the deployed dsh component is current (content-addressed). */
export function decideDsh(marker: DshMarker | undefined, version: string, sha256: string): 'skip' | 'deploy' {
  return marker !== undefined && marker.version === version && marker.sha256 === sha256 ? 'skip' : 'deploy'
}

/** Decide whether the uploaded plugin/profile file set is current. */
export function decidePlugin(marker: PluginMarker | undefined, sha256: string): 'skip' | 'deploy' {
  return marker !== undefined && marker.sha256 === sha256 ? 'skip' : 'deploy'
}

/** One component marker as JSON, suitable for `printf %s`. */
export function markerJson(marker: NodeMarker | DshMarker | PluginMarker): string {
  return `${JSON.stringify(marker)}\n`
}

/**
 * The remote script that turns one uploaded tarball into `<root>/node`.
 *
 * Everything is absolute, staging-first and verified before the swap, so an
 * interrupted run leaves the previous deployment untouched.
 */
export function extractNodeScript(options: { home: string; version: string; tarballName: string; distDir: string; sha256: string; platformArch: string; shaTool: 'sha256sum' | 'shasum -a 256' | '' }): string {
  const root = `${options.home}/${SERVER_ROOT}`
  const tarball = `${root}/staging/${options.tarballName}`
  const extract = `${root}/staging/node-x`
  const lines = [
    'set -eu',
    `cd ${q(options.home)}`,
    `command mkdir -p ${q(`${root}/staging`)} ${q(`${root}/.components`)}`,
    // Janitor: staging entries older than a day are failed runs — reclaim them.
    `find ${q(`${root}/staging`)} -maxdepth 1 -depth 1 -mtime +1 -exec rm -rf {} + 2>/dev/null || true`,
    ...(options.shaTool === '' ? [] : [`echo '${options.sha256}  ${tarball}' | ${options.shaTool} -c - >/dev/null 2>&1 || { echo 'node tarball sha256 mismatch' >&2; exit 3; }`]),
    `rm -rf ${q(extract)}`,
    `command mkdir -p ${q(extract)}`,
    `tar -xzf ${q(tarball)} -C ${q(extract)}`,
    `test -x ${q(`${extract}/${options.distDir}/bin/node`)}`,
    `rm -rf ${q(`${root}/node.new`)}`,
    `command mv -f ${q(`${extract}/${options.distDir}`)} ${q(`${root}/node.new`)}`,
    `got=$(${q(`${root}/node.new/bin/node`)} -v)`,
    `[ "$got" = ${q(options.version)} ] || { echo "extracted node reports $got, expected ${options.version}" >&2; exit 4; }`,
    `rm -rf ${q(`${root}/node`)}`,
    `command mv -f ${q(`${root}/node.new`)} ${q(`${root}/node`)}`,
    `rm -rf ${q(extract)} ${q(tarball)}`,
    `printf %s ${q(markerJson({ id: 'node', version: options.version, platformArch: options.platformArch, sha256: options.sha256 }))} > ${q(`${root}/.components/node.json`)}`,
  ]
  return lines.join('\n')
}

/**
 * Turn one uploaded dsh runtime package (built host-side by
 * `assets.buildDshRuntimePackage`) into `<root>/dsh`, verify the launcher
 * answers, then write the content-addressed marker. Nothing on the remote
 * talks to a registry; the package already contains the whole dependency
 * closure for the target platform.
 */
export function installDshPackageScript(options: { home: string; version: string; sha256: string; tarballName: string }): string {
  const root = `${options.home}/${SERVER_ROOT}`
  const tarball = `${root}/staging/${options.tarballName}`
  const extract = `${root}/staging/dsh-x`
  const target = `${root}/dsh`
  const launcher = `${target}/node_modules/.bin/dsh`
  return [
    'set -eu',
    `echo '${options.sha256}  ${tarball}' | sha256sum -c - >/dev/null 2>&1 || { echo 'dsh package sha256 mismatch' >&2; exit 3; }`,
    `rm -rf ${q(extract)}`,
    `command mkdir -p ${q(extract)}`,
    `tar -xzf ${q(tarball)} -C ${q(extract)}`,
    // `-e`, not `-x`: a package packed on **Windows** carries mode 0666 on every
    // file (NTFS has no execute bit), so the launcher arrives non-executable and
    // the old `test -x` rejected a perfectly good deployment. Restore the bit and
    // let the version probe below be the real check.
    `test -e ${q(`${extract}/node_modules/.bin/dsh`)} || { echo 'the dsh package has no launcher' >&2; exit 5; }`,
    `command chmod +x ${q(`${extract}/node_modules/.bin/dsh`)} 2>/dev/null || true`,
    `got=$(${pathAssignment([`${root}/node/bin`, `${extract}/node_modules/.bin`])} ${q(`${extract}/node_modules/.bin/dsh`)} --version | head -1)`,
    `[ -n "$got" ] || { echo 'the staged dsh launcher printed nothing (node too old for import.meta.main?)' >&2; exit 6; }`,
    `rm -rf ${q(target)} ${q(`${root}/prefix`)}`,
    `command mv -f ${q(extract)} ${q(target)}`,
    `command chmod +x ${q(launcher)} 2>/dev/null || true`,
    `rm -f ${q(tarball)}`,
    `printf %s ${q(markerJson({ id: 'dsh', version: options.version, sha256: options.sha256 }))} > ${q(`${root}/.components/dsh.json`)}`,
  ].join('\n')
}

/** Reveal an installed dsh version without reinstalling (marker hit path). */
export function checkDshScript(options: { home: string }): string {
  const root = `${options.home}/${SERVER_ROOT}`
  return [
    'set -eu',
    `d=${q(`${root}/dsh/node_modules/.bin/dsh`)}`,
    // A Windows-packed deployment may carry a non-executable launcher; the
    // "does it run" answer is the version line, not the mode bit.
    'test -e "$d" || exit 9',
    'command chmod +x "$d" 2>/dev/null || true',
    `${pathAssignment([`${root}/node/bin`, `${root}/dsh/node_modules/.bin`])} "$d" --version | head -1`,
  ].join('\n')
}

/**
 * Acquire the deployment lock. `mkdir` is the atomic test-and-set; a lock
 * older than ten minutes is a crashed client and is reclaimed once.
 */
export async function acquireDeployLock(transport: RemoteTransport, home: string, token: string): Promise<void> {
  const root = `${home}/${SERVER_ROOT}`
  const body = [
    'set -eu',
    `command mkdir -p ${q(root)}`,
    `if command mkdir ${q(`${root}/.deploy.lock`)} 2>/dev/null; then printf %s ${q(token)} > ${q(`${root}/.deploy.lock/owner`)}; exit 0; fi`,
    `owner=$(cat ${q(`${root}/.deploy.lock/owner`)} 2>/dev/null || true)`,
    `[ "$owner" = ${q(token)} ] && exit 0`,
    `age=$(( $(date +%s) - $(stat -c %Y ${q(`${root}/.deploy.lock`)} 2>/dev/null || stat -f %m ${q(`${root}/.deploy.lock`)} 2>/dev/null || echo 0) ))`,
    `if [ "$age" -gt ${Math.floor(LOCK_STALE_MS / 1000)} ]; then`,
    `  rm -rf ${q(`${root}/.deploy.lock`)}`,
    `  command mkdir ${q(`${root}/.deploy.lock`)} && printf %s ${q(token)} > ${q(`${root}/.deploy.lock/owner`)} && exit 0`,
    'fi',
    `echo "another deployment holds ${root}/.deploy.lock (owner ${'$'}{owner:-unknown}, ${'$'}age s old)" >&2`,
    'exit 8',
  ].join('\n')
  const result = await transport.exec(sh(body), { maxBytes: 4096, timeoutMs: 30_000 })
  if (result.code !== 0) {
    throw new Error(`cannot acquire the remote deploy lock: ${result.stderr.trim() || `exit ${result.code}`}`)
  }
}

/** Release the deployment lock (best effort). */
export async function releaseDeployLock(transport: RemoteTransport, home: string, token: string): Promise<void> {
  const root = `${home}/${SERVER_ROOT}`
  const body = [
    `[ -f ${q(`${root}/.deploy.lock/owner`)} ] || exit 0`,
    `owner=$(cat ${q(`${root}/.deploy.lock/owner`)})`,
    `[ "$owner" = ${q(token)} ] || exit 0`,
    `rm -rf ${q(`${root}/.deploy.lock`)}`,
  ].join('\n')
  await transport.exec(sh(body), { maxBytes: 4096, timeoutMs: 15_000 }).catch(() => {})
}

/** Write small files (profile text, lib bundles) through the transport. */
export async function writeFiles(transport: RemoteTransport, files: readonly RemoteFile[]): Promise<void> {
  for (const file of files) await transport.writeFile(file.path, file.content)
}

/** Upload the node tarball with progress, then run the extraction script. */
export async function uploadNodeTarball(
  transport: RemoteTransport,
  options: { home: string; content: Buffer; version: string; platformArch: string },
  onProgress?: (sent: number, total: number) => void,
): Promise<{ tarballPath: string; tarballName: string; distDir: string }> {
  const distDir = `node-${options.version}-${options.platformArch}`
  const tarballName = `${distDir}.tar.gz`
  const tarballPath = serverPath(options.home, `staging/${tarballName}`)
  await transport.writeFile(tarballPath, options.content, onProgress)
  return { tarballPath, tarballName, distDir }
}

/** Run one deployment step's script, surfacing the remote stderr verbatim. */
export async function runDeployScript(transport: RemoteTransport, script: string, options: { what: string; timeoutMs: number; maxBytes?: number }): Promise<string> {
  const result = await transport.exec(sh(script), { maxBytes: options.maxBytes ?? 256 * 1024, timeoutMs: options.timeoutMs })
  if (result.code !== 0) {
    const detail = result.stderr.trim().slice(-2000)
    throw new Error(`remote ${options.what} failed (exit ${result.code ?? 'signal'}): ${detail !== '' ? detail : 'no stderr output'}`)
  }
  return result.stdout
}
