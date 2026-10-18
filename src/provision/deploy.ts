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

/** Packaging mode's deployment lock, under {@link SERVER_ROOT}. */
export const DEPLOY_LOCK_DIR = '.deploy.lock'

/**
 * Reuse mode's marker file, **inside the profile directory**.
 *
 * Two marker locations exist because two install layouts do: a packaged
 * deployment records `.components/plugin.json` under its own root, while a
 * reused dsh keeps nothing but its profile — and both share the same
 * `$DSH_HOME/profiles/<profile>`. The scan reads both (see `dsh-scan.ts`), so
 * switching a target between the two modes never makes an installed plugin look
 * missing. The relative layout is frozen by `doc/api-contract.md` §9.2.
 */
export const PROFILE_MARKER_FILE = '.dsh-rw-plugin.json'

/** Reuse mode's deployment lock, inside the profile directory (same semantics as {@link DEPLOY_LOCK_DIR}). */
export const PROFILE_LOCK_DIR = '.dsh-rw.lock'

/** How long a stale lock may sit before a new deploy reclaims it. */
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

/**
 * Reuse mode's marker inside the profile directory.
 *
 * Carries `version`/`profile` on top of the digest so the wizard can say *what*
 * is installed where without opening the package manifest.
 */
export interface ProfilePluginMarker {
  readonly id: 'plugin'
  readonly sha256: string
  readonly version: string
  readonly profile: string
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
  /**
   * The reuse-mode marker of the profile this run will use, when the probe read
   * one. Additive: an older deployment only has {@link plugin}, and a missing
   * value is never a failure (see `doc/architecture.md` §3.7).
   */
  readonly profilePlugin: ProfilePluginMarker | undefined
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
 * The platform/arch/libc rule, in one place.
 *
 * Both the pipeline probe (`parseProbeOutput`) and the read-only `dsh-scan`
 * need it — the scan reports `uname`/`ostype`/`ldd` as separate records instead
 * of the probe's framed segments — and two copies of "a Linux container may
 * fake `uname -s`, `/proc/sys/kernel/ostype` tells the truth" would drift.
 * @param options - the four raw facts.
 * @returns the artifact-relevant platform classification.
 */
export function probeFactsFrom(options: { uname: string; machine: string; ostype: string; ldd: string }): {
  platform: 'linux' | 'darwin'
  arch: 'x64' | 'arm64'
  libc: '' | 'gnu' | 'musl'
} {
  const ostype = options.ostype.trim().toLowerCase()
  const unameSystem = options.uname.trim()
  // A Linux container may fake `uname -s`; `/proc/sys/kernel/ostype` tells the
  // truth (ZCode's detectEnv does the same).
  const platform = ostype.includes('linux') || (unameSystem === 'Darwin' && ostype === 'linux') ? 'linux' : unameSystem === 'Darwin' ? 'darwin' : 'linux'
  const rawArch = options.machine.trim()
  const arch = rawArch === 'arm64' || rawArch === 'aarch64' ? 'arm64' : 'x64'
  const ldd = options.ldd.trim().toLowerCase()
  const libc = platform !== 'linux' ? '' : ldd.includes('musl') ? 'musl' : 'gnu'
  return { platform, arch, libc }
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
  const tools = (segments[3] ?? '').split('\n').map(line => line.trim().split('/').pop() ?? '').filter(Boolean)
  const facts = probeFactsFrom({
    uname: uname[0] ?? '',
    machine: uname[1] ?? '',
    ostype: (segments[2] ?? '').split('\n')[0] ?? '',
    ldd: (segments[7] ?? '').split('\n')[0] ?? '',
  })
  return {
    home,
    platform: facts.platform,
    arch: facts.arch,
    libc: facts.libc,
    tools: {
      tar: tools.includes('tar'),
      sha256sum: tools.includes('sha256sum') || tools.includes('shasum'),
      curl: tools.includes('curl'),
      wget: tools.includes('wget'),
    },
    node: parseMarker<NodeMarker>(segments[4]),
    dsh: parseMarker<DshMarker>(segments[5]),
    plugin: parseMarker<PluginMarker>(segments[6]),
    profilePlugin: parseMarker<ProfilePluginMarker>(segments[8]),
  }
}

/**
 * The one-shot environment probe: facts only, framed by `@@RW@@` separators.
 *
 * The last segment is additive (reuse mode's profile marker). A profile name is
 * schema-validated to `[a-z0-9-]`, but the script is built from it, so anything
 * else simply omits the segment instead of interpolating.
 * @param options - the profile whose reuse marker should be read, if any.
 */
export function probeScript(options: { profile?: string } = {}): string {
  const profile = options.profile ?? ''
  const safeProfile = /^[a-z0-9][a-z0-9-]*$/.test(profile)
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
    "printf '@@RW@@\\n'",
    // Unquoted on purpose: a single-quoted `~` is a literal directory name, and
    // the profile is already restricted to `[a-z0-9-]` above.
    ...(safeProfile ? [`cat ~/.dsh/profiles/${profile}/${PROFILE_MARKER_FILE} 2>/dev/null || true`] : []),
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
 * The lock-acquire body for one absolute lock directory.
 *
 * `mkdir` is the atomic test-and-set; a lock older than ten minutes is a crashed
 * client and is reclaimed once. Shared by both layouts (packaging keeps its lock
 * under the server root, reuse keeps one inside the profile directory) so the
 * semantics can never diverge.
 */
function lockAcquireBody(lockDir: string, token: string): string {
  const parent = lockDir.slice(0, lockDir.lastIndexOf('/'))
  return [
    'set -eu',
    `command mkdir -p ${q(parent)}`,
    `if command mkdir ${q(lockDir)} 2>/dev/null; then printf %s ${q(token)} > ${q(`${lockDir}/owner`)}; exit 0; fi`,
    `owner=$(cat ${q(`${lockDir}/owner`)} 2>/dev/null || true)`,
    `[ "$owner" = ${q(token)} ] && exit 0`,
    `age=$(( $(date +%s) - $(stat -c %Y ${q(lockDir)} 2>/dev/null || stat -f %m ${q(lockDir)} 2>/dev/null || echo 0) ))`,
    `if [ "$age" -gt ${Math.floor(LOCK_STALE_MS / 1000)} ]; then`,
    `  rm -rf ${q(lockDir)}`,
    `  command mkdir ${q(lockDir)} && printf %s ${q(token)} > ${q(`${lockDir}/owner`)} && exit 0`,
    'fi',
    `echo "another deployment holds ${lockDir} (owner ${'$'}{owner:-unknown}, ${'$'}age s old)" >&2`,
    'exit 8',
  ].join('\n')
}

/** The lock-release body for one absolute lock directory (best effort). */
function lockReleaseBody(lockDir: string, token: string): string {
  return [
    `[ -f ${q(`${lockDir}/owner`)} ] || exit 0`,
    `owner=$(cat ${q(`${lockDir}/owner`)})`,
    `[ "$owner" = ${q(token)} ] || exit 0`,
    `rm -rf ${q(lockDir)}`,
  ].join('\n')
}

/**
 * Acquire the deployment lock. `mkdir` is the atomic test-and-set; a lock
 * older than ten minutes is a crashed client and is reclaimed once.
 */
export async function acquireDeployLock(transport: RemoteTransport, home: string, token: string): Promise<void> {
  const lockDir = `${home}/${SERVER_ROOT}/${DEPLOY_LOCK_DIR}`
  const result = await transport.exec(sh(lockAcquireBody(lockDir, token)), { maxBytes: 4096, timeoutMs: 30_000 })
  if (result.code !== 0) {
    throw new Error(`cannot acquire the remote deploy lock: ${result.stderr.trim() || `exit ${result.code}`}`)
  }
}

/** Release the deployment lock (best effort). */
export async function releaseDeployLock(transport: RemoteTransport, home: string, token: string): Promise<void> {
  const lockDir = `${home}/${SERVER_ROOT}/${DEPLOY_LOCK_DIR}`
  await transport.exec(sh(lockReleaseBody(lockDir, token)), { maxBytes: 4096, timeoutMs: 15_000 }).catch(() => {})
}

/** The reuse-mode lock directory for one profile. */
export function profileLockDir(profileDir: string): string {
  return `${profileDir}/${PROFILE_LOCK_DIR}`
}

/**
 * The reuse-mode lock body, for callers that batch scripts themselves.
 * @param options - the profile directory and this attempt's owner token.
 */
export function profileLockScript(options: { profileDir: string; token: string }): string {
  return lockAcquireBody(profileLockDir(options.profileDir), options.token)
}

/** The reuse-mode unlock body. */
export function profileUnlockScript(options: { profileDir: string; token: string }): string {
  return lockReleaseBody(profileLockDir(options.profileDir), options.token)
}

/**
 * Acquire the reuse-mode lock.
 *
 * Same `mkdir` test-and-set, different scope: a reused dsh's profile is shared by
 * every device that points at this host, so two connects can race the plugin
 * file set. The lock lives **inside the profile directory** because that, not
 * `~/.dsh/server`, is the only path a reuse deployment owns.
 * @param transport - open transport.
 * @param profileDir - absolute remote profile directory.
 * @param token - this attempt's owner token.
 */
export async function acquireProfileLock(transport: RemoteTransport, profileDir: string, token: string): Promise<void> {
  const result = await transport.exec(sh(profileLockScript({ profileDir, token })), { maxBytes: 4096, timeoutMs: 30_000 })
  if (result.code !== 0) {
    throw new Error(`cannot acquire the remote profile lock: ${result.stderr.trim() || `exit ${result.code}`}`)
  }
}

/** Release the reuse-mode lock (best effort). */
export async function releaseProfileLock(transport: RemoteTransport, profileDir: string, token: string): Promise<void> {
  await transport.exec(sh(profileUnlockScript({ profileDir, token })), { maxBytes: 4096, timeoutMs: 15_000 }).catch(() => {})
}

/**
 * The script that writes the reuse-mode plugin marker.
 *
 * Written **after** the file set is on disk, so a failed upload can never look
 * current (same rule as every other marker in this module).
 * @param options - profile directory, file-set digest, plugin version and profile name.
 */
export function profilePluginScript(options: { profileDir: string; sha256: string; version: string; profile: string }): string {
  const marker: ProfilePluginMarker = {
    id: 'plugin',
    sha256: options.sha256,
    version: options.version,
    profile: options.profile,
  }
  return [
    'set -eu',
    `command mkdir -p ${q(options.profileDir)}`,
    `printf %s ${q(`${JSON.stringify(marker)}\n`)} > ${q(`${options.profileDir}/${PROFILE_MARKER_FILE}`)}`,
  ].join('\n')
}

/**
 * The read-only script that measures one reuse launcher.
 *
 * Everything it needs is measured here rather than assumed, because the wizard's
 * scan may be minutes old and the user may have picked a path that has since
 * changed. `$DSHHOME/server/node/bin` leads `PATH` for the same measured reason
 * the scan needs it: the uploaded dsh is a `/bin/sh` shim around `exec node`, and
 * without that prefix its `--version` answers `exec: node: not found` (exit 127).
 * @param options - the selected launcher and the deployment root that may hold a Node.
 */
export function reuseLauncherScript(options: { launcherPath: string; installHome: string }): string {
  const deployedNode = serverPath(options.installHome, 'node/bin/node')
  return [
    'set -u',
    'export LC_ALL=C',
    // `export`: this line stands alone (not as a command prefix), and the
    // interpreter probe below only finds the deployed node because PATH is
    // exported to the launcher it spawns.
    `export ${pathAssignment([serverPath(options.installHome, 'node/bin')])}`,
    `L=${q(options.launcherPath)}`,
    "printf '%s\\n' '@@RW@@REUSE@@1'",
    'if [ -e "$L" ]; then printf \'EXISTS\\t1\\n\'; else printf \'EXISTS\\t0\\n\'; fi',
    'if [ -x "$L" ]; then printf \'EXEC\\t1\\n\'; else printf \'EXEC\\t0\\n\'; fi',
    'real=$(readlink -f "$L" 2>/dev/null || printf \'%s\' "$L")',
    '  [ -n "$real" ] || real=$L',
    "printf 'REAL\\t%s\\n' \"$real\"",
    'sb=$(head -1 "$real" 2>/dev/null)',
    'case "$sb" in \'#!\'*) printf \'SHEBANG\\t1\\n\' ;; *) printf \'SHEBANG\\t0\\n\' ;; esac',
    "node=''",
    'case "$sb" in',
    "  '#!'*'/env node'*) node=$(command -v node 2>/dev/null || true) ;;",
    "  '#!'*'/env '*node*) node=$(command -v node 2>/dev/null || true) ;;",
    "  '#!'*node*) node=$(printf '%s' \"$sb\" | sed -e 's/^#![[:space:]]*//' -e 's/[[:space:]].*$//') ;;",
    'esac',
    'case "$node" in /*) ;; *) node=\'\' ;; esac',
    '  [ -x "$node" ] || node=\'\'',
    "printf 'NODE\\t%s\\n' \"$node\"",
    `if [ -x ${q(deployedNode)} ]; then printf 'DEPLOYED\\t%s\\n' ${q(deployedNode)}; else printf 'DEPLOYED\\t\\n'; fi`,
    'if [ -x "$L" ]; then',
    '  out=$("$L" --version 2>/dev/null); code=$?',
    "  printf 'VERSION\\t%s\\n' \"$(printf '%s' \"$out\" | head -1)\"",
    "  printf 'CODE\\t%s\\n' \"$code\"",
    'else',
    "  printf 'VERSION\\t\\n'",
    "  printf 'CODE\\t127\\n'",
    'fi',
    "printf '%s\\n' 'END'",
  ].join('\n')
}

/** What {@link reuseLauncherScript} reported about one launcher. */
export interface ReuseLauncherProbe {
  readonly path: string
  readonly realPath: string
  readonly exists: boolean
  readonly executable: boolean
  readonly hasShebang: boolean
  readonly version: string
  readonly exitCode: number | null
  readonly nodePath?: string
  readonly deployedNode?: string
}

/**
 * Parse {@link reuseLauncherScript}'s records.
 *
 * Structural twin of `plan.ReuseLauncherFacts`: this module owns the shell side,
 * `plan.ts` owns the decision, and neither imports the other's values.
 * @param stdout - the script's stdout.
 * @param launcherPath - the path that was probed (echoed back into the facts).
 * @returns the facts, with conservative defaults for records that never arrived.
 */
export function parseReuseLauncherOutput(stdout: string, launcherPath: string): ReuseLauncherProbe {
  const values = new Map<string, string>()
  for (const line of stdout.split('\n').map(entry => entry.replace(/\r$/u, ''))) {
    if (line === '' || line === 'END') continue
    const index = line.indexOf('\t')
    if (index <= 0) continue
    values.set(line.slice(0, index), line.slice(index + 1))
  }
  const codeText = values.get('CODE') ?? ''
  const exitCode = /^\d+$/.test(codeText) ? Number.parseInt(codeText, 10) : null
  const node = values.get('NODE') ?? ''
  const deployed = values.get('DEPLOYED') ?? ''
  return {
    path: launcherPath,
    realPath: values.get('REAL') || launcherPath,
    exists: values.get('EXISTS') === '1',
    executable: values.get('EXEC') === '1',
    hasShebang: values.get('SHEBANG') === '1',
    version: values.get('VERSION') ?? '',
    exitCode,
    ...(node === '' ? {} : { nodePath: node }),
    ...(deployed === '' ? {} : { deployedNode: deployed }),
  }
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
