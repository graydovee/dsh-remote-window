/**
 * Per-client profile lifecycle on the server (client side of protocol §3).
 *
 * A profile server is a **detached** `dsh --profile <p> --host 127.0.0.1 --port 0
 * --no-open` whose single stdout line carries the ephemeral port and launch
 * token. This module owns the parts that must be idempotent, testable and safe:
 *
 * - profile / runtime / log / pid path layout (one fixed directory per clientId);
 * - the exact LF start and stop shell bodies (`setsid nohup … > server.log 2>&1 &`);
 * - the anchored startup-line parser (port + token, token never logged);
 * - polling the log to readiness, with a bounded timeout and a scrubbed tail;
 * - SIGTERM → SIGKILL stop, pid-reuse guard, stale pid confirmation;
 * - the offline profile file set (4 files + plugin `node_modules` copy) and its marker.
 *
 * It deliberately knows nothing about SSH, HTTP or DSH services: the caller
 * supplies a {@link ProfileRemote} (one `exec`/`writeFile` seam) and, for the
 * final readiness check, a probe that asks the already-open tunnel for the
 * tokenized `GET /`.
 */
import { createHash } from 'node:crypto'
import type { RemoteFile } from '../targets/types.ts'
import { isClientId, profileNameFor } from '../targets/client-id.ts'
import { sha256OfFiles } from './assets.ts'
import { packageFiles, pathAssignment, shellQuote } from './profile.ts'

/** Startup line, anchored: `dsh web: http://127.0.0.1:<port>/?token=<43 chars>`. */
export const PROFILE_STARTUP_PATTERN = /^dsh web: http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+)$/u

/** How long a profile server may take to print its startup line. */
export const PROFILE_STARTUP_TIMEOUT_MS = 15_000

/** How long SIGTERM gets before SIGKILL. */
export const PROFILE_STOP_TIMEOUT_MS = 5_000

/** Lease heartbeat TTL from protocol §3.4. */
export const PROFILE_LEASE_TTL_MS = 20_000

/** The server plugin package installed into the per-client profile. */
export const PROFILE_SERVER_PLUGIN = 'dsh-remote-workspace-server'

/** Plugin marker written into the profile after the file set is on disk. */
export const PROFILE_PLUGIN_MARKER = '.dsh-rw-plugin.json'

/** Profile lease path, relative to the profile directory (server plugin writes it). */
export const PROFILE_LEASE_PATH = '.dsh-rw/lease.json'

/** One `exec` result from the profile remote. */
export interface ProfileExecResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

/** The narrow remote seam the lifecycle needs (SSH `exec` + file upload). */
export interface ProfileRemote {
  exec(body: string, options?: { readonly maxBytes?: number; readonly timeoutMs?: number }): Promise<ProfileExecResult>
  writeFile(path: string, content: Buffer): Promise<void>
}

/** Absolute server-side paths for one client's profile and its process state. */
export interface ProfilePaths {
  readonly dshHome: string
  readonly clientId: string
  readonly profile: string
  /** `$DSH_HOME/profiles/<profile>` (DSH's own profile directory). */
  readonly profileDir: string
  /** `$DSH_HOME/remote-workspace/profiles/<profile>` (our log/pid state). */
  readonly stateDir: string
  readonly logPath: string
  readonly pidPath: string
  /** `<profileDir>/.dsh-rw/lease.json` (written by the server plugin). */
  readonly leasePath: string
  /** `<profileDir>/node_modules/<PROFILE_SERVER_PLUGIN>`. */
  readonly pluginDir: string
}

/** Strip trailing slashes so path joins are stable. */
function normalizeDshHome(dshHome: string): string {
  const trimmed = dshHome.trim()
  if (trimmed === '' || !trimmed.startsWith('/')) throw new Error(`DSH_HOME must be an absolute server path, got ${JSON.stringify(dshHome)}`)
  return trimmed.replace(/\/+$/u, '')
}

/**
 * The fixed v1 layout for one client.
 * @param dshHome - absolute server `$DSH_HOME`.
 * @param clientId - the client's stable 12-hex id.
 */
export function profilePaths(dshHome: string, clientId: string): ProfilePaths {
  const home = normalizeDshHome(dshHome)
  if (!isClientId(clientId)) throw new Error(`invalid clientId ${JSON.stringify(clientId)}`)
  const profile = profileNameFor(clientId)
  const profileDir = `${home}/profiles/${profile}`
  const stateDir = `${home}/remote-workspace/profiles/${profile}`
  return {
    dshHome: home,
    clientId,
    profile,
    profileDir,
    stateDir,
    logPath: `${stateDir}/server.log`,
    pidPath: `${stateDir}/server.pid`,
    leasePath: `${profileDir}/${PROFILE_LEASE_PATH}`,
    pluginDir: `${profileDir}/node_modules/${PROFILE_SERVER_PLUGIN}`,
  }
}

/** The server process's startup facts. */
export interface ProfileStartup {
  readonly port: number
  readonly token: string
}

/**
 * Parse one startup line.
 *
 * Anchored on purpose: the log is append-only and may contain unrelated dsh
 * output; a greedy or unanchored match could pick a port from a diagnostic.
 * @param text - one line (a trailing `\r` is tolerated for manually copied logs).
 */
export function parseProfileStartupLine(text: string): ProfileStartup | undefined {
  const match = PROFILE_STARTUP_PATTERN.exec(text.trim())
  if (match === null) return undefined
  const port = Number.parseInt(match[1] ?? '', 10)
  const token = match[2] ?? ''
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || token === '') return undefined
  return { port, token }
}

/** Find the last startup line in a log, when the log has one. */
export function findProfileStartup(text: string): ProfileStartup | undefined {
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0; index--) {
    const parsed = parseProfileStartupLine(lines[index] ?? '')
    if (parsed !== undefined) return parsed
  }
  return undefined
}

/** Parse a pid file; non-numeric/garbage content is a stale marker, not a pid. */
export function parsePidFile(text: string): number | undefined {
  const value = text.trim()
  if (!/^\d+$/u.test(value)) return undefined
  const pid = Number.parseInt(value, 10)
  return Number.isInteger(pid) && pid > 1 && pid <= 2_147_483_647 ? pid : undefined
}

/** A pid file body (one LF-terminated decimal pid). */
export function pidFileBody(pid: number): string {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error(`invalid pid ${String(pid)}`)
  return `${pid}\n`
}

/**
 * The detached start body (protocol §3.1).
 *
 * The launcher flags are the CLI's: `--profile` comes **before** the app args
 * (`dsh web --profile p` is rejected by 0.2.1-rc.2 as a second profile).
 * @param paths - fixed layout for this client.
 * @param options - launcher, PATH prefixes (`node/bin`, `dsh/node_modules/.bin`) and optional port.
 */
export function profileStartScript(
  paths: ProfilePaths,
  options: {
    readonly launcher: string
    readonly pathPrefixes?: readonly string[]
    /** Default 0 (OS-assigned); tests may pin a port. */
    readonly port?: number
  },
): string {
  const home = shellQuote(paths.dshHome)
  const launcher = shellQuote(options.launcher)
  const prefixes = [...(options.pathPrefixes ?? [])]
  const path = prefixes.length === 0 ? '' : `${pathAssignment(prefixes)} `
  return [
    'set -eu',
    'umask 077',
    `command mkdir -p ${shellQuote(paths.profileDir)} ${shellQuote(paths.stateDir)}`,
    `: > ${shellQuote(paths.logPath)}`,
    `chmod 700 ${shellQuote(paths.stateDir)} 2>/dev/null || true`,
    `chmod 600 ${shellQuote(paths.logPath)} 2>/dev/null || true`,
    'if command -v setsid >/dev/null 2>&1; then',
    `  setsid nohup env DSH_HOME=${home} ${path}${launcher} --profile ${shellQuote(paths.profile)} --host 127.0.0.1 --port ${options.port ?? 0} --no-open >> ${shellQuote(paths.logPath)} 2>&1 &`,
    'else',
    `  nohup env DSH_HOME=${home} ${path}${launcher} --profile ${shellQuote(paths.profile)} --host 127.0.0.1 --port ${options.port ?? 0} --no-open >> ${shellQuote(paths.logPath)} 2>&1 &`,
    'fi',
    'pid=$!',
    `printf '%s\\n' "$pid" > ${shellQuote(paths.pidPath)}`,
    `chmod 600 ${shellQuote(paths.pidPath)} 2>/dev/null || true`,
    'printf \'%s\\n\' "$pid"',
  ].join('\n')
}

/**
 * The stop body: SIGTERM, wait up to `timeoutMs`, then SIGKILL.
 *
 * The pid-reuse guard (`ps -p … -o args=` must mention the profile name) is what
 * prevents a stale pid file from killing an unrelated process after a reboot.
 * When `ps` is unavailable the plain `kill -0` liveness check remains; the
 * profile name in the shell's own process table is still verified by the
 * `grep` fallback below.
 * @param paths - fixed layout.
 * @param options - stop budget and a log line set the caller may expect.
 */
export function profileStopScript(paths: ProfilePaths, options: { readonly timeoutMs?: number; readonly profileHint?: string } = {}): string {
  const timeoutMs = Math.max(100, options.timeoutMs ?? PROFILE_STOP_TIMEOUT_MS)
  const ticks = Math.max(1, Math.ceil(timeoutMs / 100))
  const hint = options.profileHint ?? paths.profile
  return [
    'set -u',
    `pidfile=${shellQuote(paths.pidPath)}`,
    `lease=${shellQuote(paths.leasePath)}`,
    // A stopped/aborted profile leaves a heartbeat-fresh lease. Clear it even
    // when the pid file is already gone, so the next start of the same client
    // can claim the profile immediately instead of waiting out the 20s TTL.
    'rm -f "$lease"',
    '[ -f "$pidfile" ] || exit 0',
    'pid=$(cat "$pidfile" 2>/dev/null || true)',
    'case "$pid" in \'\'|*[!0-9]*) rm -f "$pidfile"; exit 0;; esac',
    'if command -v ps >/dev/null 2>&1; then',
    `  args=$(ps -p "$pid" -o args= 2>/dev/null || true)`,
    `  case "$args" in *${hint.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}*) ;; *) rm -f "$pidfile"; exit 0;; esac`,
    'fi',
    'kill -TERM "$pid" 2>/dev/null || true',
    'i=0',
    'while kill -0 "$pid" 2>/dev/null; do',
    '  i=$((i+1))',
    `  if [ "$i" -ge ${ticks} ]; then kill -KILL "$pid" 2>/dev/null || true; break; fi`,
    '  sleep 0.1 2>/dev/null || sleep 1',
    'done',
    'rm -f "$pidfile"',
    'printf \'stopped\\n\'',
  ].join('\n')
}

/** A coded lifecycle failure the P3/route layer can expose. */
export class ProfileLifecycleError extends Error {
  constructor(
    readonly code: 'profile-start-timeout' | 'profile-start-failed' | 'profile-stop-failed' | 'profile-state-failed',
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ProfileLifecycleError'
  }
}

/** Last N chars of a log, with secrets scrubbed. */
export function scrubbedLogTail(text: string, max = 2000): string {
  return text.length <= max ? text : text.slice(-max)
}

/** Sleep seam so the polling loops are deterministic in tests. */
export type Sleep = (ms: number) => Promise<void>

/** Default sleep. */
export const realSleep: Sleep = async (ms) => { await new Promise<void>(resolve => { setTimeout(resolve, ms) }) }

/** Read and parse the latest startup line from the profile log. */
export async function readProfileStartup(remote: ProfileRemote, paths: ProfilePaths): Promise<ProfileStartup | undefined> {
  const log = await remote.exec(`cat ${shellQuote(paths.logPath)} 2>/dev/null || true`, { maxBytes: 64 * 1024, timeoutMs: 10_000 })
  return findProfileStartup(log.stdout)
}

/** Read the pid file, or undefined when absent/garbage. */
export async function readProfilePid(remote: ProfileRemote, paths: ProfilePaths): Promise<number | undefined> {
  const pid = await remote.exec(`cat ${shellQuote(paths.pidPath)} 2>/dev/null || true`, { maxBytes: 256, timeoutMs: 10_000 })
  return parsePidFile(pid.stdout)
}

/** Whether a pid is alive (`kill -0`; a permission error still means a live process). */
export async function isRemotePidAlive(remote: ProfileRemote, pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 1) return false
  const result = await remote.exec(`kill -0 ${pid} 2>/dev/null; printf '%s' "$?"`, { maxBytes: 64, timeoutMs: 10_000 })
  return result.stdout.trim() === '0'
}

/** Wait for the startup line, bounded by the protocol's 15 s default. */
export async function waitForProfileStartup(
  remote: ProfileRemote,
  paths: ProfilePaths,
  options: {
    readonly timeoutMs?: number
    readonly intervalMs?: number
    readonly sleep?: Sleep
    readonly signal?: AbortSignal
  } = {},
): Promise<ProfileStartup> {
  const timeoutMs = options.timeoutMs ?? PROFILE_STARTUP_TIMEOUT_MS
  const intervalMs = options.intervalMs ?? 250
  const sleep = options.sleep ?? realSleep
  const deadline = Date.now() + Math.max(1, timeoutMs)
  let lastLog = ''
  for (;;) {
    options.signal?.throwIfAborted()
    const log = await remote.exec(`cat ${shellQuote(paths.logPath)} 2>/dev/null || true`, { maxBytes: 64 * 1024, timeoutMs: 10_000 })
    lastLog = log.stdout
    const startup = findProfileStartup(lastLog)
    if (startup !== undefined) return startup
    // Liveness first: a process that already exited is a fast, actionable
    // `profile-start-failed`, not a 15 s timeout (the deadline is for a process
    // that is still booting).
    const pid = await readProfilePid(remote, paths)
    if (pid !== undefined && !(await isRemotePidAlive(remote, pid))) {
      throw new ProfileLifecycleError(
        'profile-start-failed',
        `profile server exited before printing its startup line${lastLog.trim() === '' ? '' : `: ${scrubbedLogTail(lastLog)}`}`,
        { pid, logTail: scrubbedLogTail(lastLog) },
      )
    }
    if (Date.now() >= deadline) {
      throw new ProfileLifecycleError(
        'profile-start-timeout',
        `profile server did not print its startup line within ${timeoutMs} ms${lastLog.trim() === '' ? '' : `: ${scrubbedLogTail(lastLog)}`}`,
        { logTail: scrubbedLogTail(lastLog) },
      )
    }
    await sleep(intervalMs)
  }
}

/** A profile server that is up, with the token kept only in this host's memory. */
export interface ProfileServerHandle {
  readonly paths: ProfilePaths
  readonly pid: number
  readonly port: number
  /** Launch token: never persisted, never sent to the browser. */
  readonly token: string
}

/**
 * Start one profile server and wait for its startup line.
 *
 * The token is returned to the caller (which immediately exchanges it for the
 * official cookie and must not keep it after that). A failed start leaves the
 * log on disk for diagnosis and stops a process that did come up without a
 * parsable line, so a retry does not race an orphan.
 * @param remote - profile remote seam.
 * @param paths - fixed layout.
 * @param options - launcher, PATH prefixes, optional readiness probe and timings.
 */
export async function startProfileServer(
  remote: ProfileRemote,
  paths: ProfilePaths,
  options: {
    readonly launcher: string
    readonly pathPrefixes?: readonly string[]
    readonly probe?: (startup: ProfileStartup) => Promise<boolean>
    readonly timeoutMs?: number
    readonly intervalMs?: number
    readonly sleep?: Sleep
    readonly signal?: AbortSignal
  },
): Promise<ProfileServerHandle> {
  const start = await remote.exec(profileStartScript(paths, {
    launcher: options.launcher,
    ...(options.pathPrefixes === undefined ? {} : { pathPrefixes: options.pathPrefixes }),
  }), { maxBytes: 4096, timeoutMs: 30_000 })
  if (start.code !== 0) {
    throw new ProfileLifecycleError(
      'profile-start-failed',
      `the profile server could not be launched (exit ${start.code ?? 'signal'}): ${scrubbedLogTail(start.stderr.trim())}`,
      { stderr: scrubbedLogTail(start.stderr) },
    )
  }
  let startup: ProfileStartup
  try {
    startup = await waitForProfileStartup(remote, paths, {
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
      ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch (error) {
    await stopProfileServer(remote, paths, { sleep: options.sleep }).catch(() => false)
    throw error
  }
  const pid = await readProfilePid(remote, paths)
  if (pid === undefined) {
    await stopProfileServer(remote, paths, { sleep: options.sleep }).catch(() => false)
    throw new ProfileLifecycleError('profile-start-failed', 'the profile server printed its line but no pid was written')
  }
  if (options.probe !== undefined && !(await options.probe(startup))) {
    // Capture the log before stopping: the failure text QA sees must name the
    // port/pid and the server's own tail, not just "listening but failed".
    const tail = await remote.exec(`cat ${shellQuote(paths.logPath)} 2>/dev/null || true`, { maxBytes: 64 * 1024, timeoutMs: 10_000 }).then(result => result.stdout).catch(() => '')
    await stopProfileServer(remote, paths, { sleep: options.sleep }).catch(() => false)
    await waitForProfileStopped(remote, paths, { sleep: options.sleep }).catch(() => false)
    throw new ProfileLifecycleError(
      'profile-start-failed',
      `the profile server printed its token on port ${startup.port} (pid ${pid}) but did not answer its tokenized root request${tail.trim() === '' ? '' : `: ${scrubbedLogTail(tail)}`}`,
      { pid, port: startup.port, logTail: scrubbedLogTail(tail) },
    )
  }
  return { paths, pid, port: startup.port, token: startup.token }
}

/**
 * Stop the profile server for one client.
 * @returns true when a process was signalled, false when there was no pid file.
 */
export async function stopProfileServer(
  remote: ProfileRemote,
  paths: ProfilePaths,
  options: { readonly timeoutMs?: number; readonly sleep?: Sleep } = {},
): Promise<boolean> {
  const result = await remote.exec(profileStopScript(paths, {
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  }), { maxBytes: 1024, timeoutMs: (options.timeoutMs ?? PROFILE_STOP_TIMEOUT_MS) + 15_000 })
  if (result.code !== 0) {
    throw new ProfileLifecycleError(
      'profile-stop-failed',
      `the profile server could not be stopped (exit ${result.code ?? 'signal'}): ${scrubbedLogTail(result.stderr.trim())}`,
      { stderr: scrubbedLogTail(result.stderr) },
    )
  }
  return result.stdout.includes('stopped')
}

/**
 * Wait until a stopped profile server's pid is gone (best-effort read-back).
 *
 * `stopProfileServer` already polls the pid in its shell body; this host-side
 * check makes the *next* start deterministic instead of racing a process that
 * the shell reported gone but that is still unwinding.
 */
export async function waitForProfileStopped(
  remote: ProfileRemote,
  paths: ProfilePaths,
  options: { readonly timeoutMs?: number; readonly intervalMs?: number; readonly sleep?: Sleep } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? PROFILE_STOP_TIMEOUT_MS
  const intervalMs = options.intervalMs ?? 100
  const sleep = options.sleep ?? realSleep
  const deadline = Date.now() + Math.max(1, timeoutMs)
  for (;;) {
    const pid = await readProfilePid(remote, paths)
    if (pid === undefined) return true
    if (!(await isRemotePidAlive(remote, pid))) return true
    if (Date.now() >= deadline) return false
    await sleep(intervalMs)
  }
}

/** The server-side lease shape written by the server plugin (protocol §3.4). */
export interface ProfileLease {
  readonly version: 1
  readonly profile: string
  readonly clientId: string
  readonly instanceId: string
  readonly pid: number
  readonly port: number
  readonly startedAt: string
  readonly heartbeatAt: string
  readonly tokenFingerprint: string
}

/** Parse one lease file, tolerating absence/corruption (lease is diagnostic here). */
export function parseProfileLease(text: string): ProfileLease | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  try {
    const parsed = JSON.parse(trimmed) as Partial<ProfileLease>
    if (
      parsed.version !== 1 ||
      typeof parsed.profile !== 'string' ||
      typeof parsed.clientId !== 'string' ||
      typeof parsed.instanceId !== 'string' ||
      typeof parsed.pid !== 'number' ||
      typeof parsed.port !== 'number' ||
      typeof parsed.startedAt !== 'string' ||
      typeof parsed.heartbeatAt !== 'string' ||
      typeof parsed.tokenFingerprint !== 'string'
    ) return undefined
    return parsed as ProfileLease
  } catch {
    return undefined
  }
}

/** Read the lease file from the profile directory. */
export async function readProfileLease(remote: ProfileRemote, paths: ProfilePaths): Promise<ProfileLease | undefined> {
  const result = await remote.exec(`cat ${shellQuote(paths.leasePath)} 2>/dev/null || true`, { maxBytes: 8192, timeoutMs: 10_000 })
  return parseProfileLease(result.stdout)
}

/** Whether a lease's heartbeat is still within the protocol TTL. */
export function isLeaseFresh(lease: ProfileLease, now: number = Date.now(), ttlMs: number = PROFILE_LEASE_TTL_MS): boolean {
  const beat = Date.parse(lease.heartbeatAt)
  return Number.isFinite(beat) && now - beat <= ttlMs
}

/** What the client should do with an existing lease before starting its profile. */
export type LeaseAction = 'mine' | 'in-use' | 'takeover' | 'foreign-client'

/**
 * Client-side lease classification (protocol §3.4).
 *
 * The server plugin remains the authority on handshake; this helper only lets
 * the client avoid killing a profile that another instance is actively using and
 * decide whether it may clean a stale one.
 * @param lease - latest lease on disk.
 * @param owner - this client instance identity.
 * @param now - clock seam.
 * @param pidAlive - whether the lease pid is still alive (undefined = unknown).
 */
export function leaseActionFor(
  lease: ProfileLease | undefined,
  owner: { readonly clientId: string; readonly instanceId: string },
  now: number = Date.now(),
  pidAlive?: boolean,
): LeaseAction {
  if (lease === undefined) return 'takeover'
  if (lease.clientId !== owner.clientId) return 'foreign-client'
  if (lease.instanceId === owner.instanceId) return 'mine'
  if (pidAlive === false) return 'takeover'
  return isLeaseFresh(lease, now) ? 'in-use' : 'takeover'
}

/** The four profile files plus the plugin package files written offline. */
export interface ProfileFiles {
  /** Relative path → text content of the profile's own files. */
  readonly startup: Map<string, string>
  /** Plugin package files, relative to the profile directory (`node_modules/<plugin>/…`). */
  readonly plugin: readonly RemoteFile[]
}

/**
 * The profile's four root files (protocol §3.1 / architecture §12).
 *
 * `dsh.profile.bundles` must contain the server plugin by name: the plugin
 * package supplies its own `cordis.patch.yml`, so this profile never uses a
 * package manager and never needs server-side network access.
 * @param options - profile name and plugin package name.
 */
export function profileStartupFiles(options: { readonly profile: string; readonly pluginPackage?: string }): Map<string, string> {
  const plugin = options.pluginPackage ?? PROFILE_SERVER_PLUGIN
  const packageJson = `${JSON.stringify({
    name: `dsh-profile-${options.profile}`,
    private: true,
    dependencies: {
      [plugin]: `file:node_modules/${plugin}`,
    },
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', plugin],
      },
    },
  }, null, 2)}\n`
  return new Map([
    ['package.json', packageJson],
    ['cordis.yml', '[]\n'],
    // The profile layer is empty on purpose: the server plugin ships its own
    // bundle patch, and the client must not overwrite a user's profile edits.
    ['cordis.patch.yml', '[]\n'],
    ['pnpm-workspace.yaml', 'packages:\n  - .\n'],
  ])
}

/**
 * Read a local server-plugin package directory into remote profile files.
 *
 * Uses the same file selection as the old provisioning profile (package.json,
 * cordis.patch.yml, `lib/*.js|mjs|cjs`) through `provision/profile.ts`, so a
 * plugin package that can be loaded locally can also be copied here.
 * @param packageDir - absolute local plugin package root (server repo checkout/build).
 */
export async function pluginPackageFiles(packageDir: string): Promise<RemoteFile[]> {
  return await packageFiles(packageDir)
}

/**
 * Build the complete absolute-path file set for one profile (startup files +
 * plugin package under `node_modules/`), plus its marker digest.
 * @param paths - fixed layout for this client.
 * @param plugin - plugin package files relative to the package root.
 */
export function buildProfileFileSet(paths: ProfilePaths, plugin: readonly RemoteFile[]): RemoteFile[] {
  const files: RemoteFile[] = []
  for (const [name, content] of profileStartupFiles({ profile: paths.profile })) {
    files.push({ path: `${paths.profileDir}/${name}`, content: Buffer.from(content, 'utf8') })
  }
  for (const file of plugin) {
    files.push({ path: `${paths.pluginDir}/${file.path}`, content: file.content })
  }
  return files
}

/** The digest stored in the profile marker (absolute remote paths + bytes). */
export async function profileFileSetDigest(files: readonly RemoteFile[]): Promise<string> {
  return await sha256OfFiles(files)
}

/**
 * Write only the profile's four root files (no plugin payload).
 *
 * The v1 installer uploads the server plugin as a versioned tarball and extracts
 * it into `node_modules/` remotely, so the profile files and the package payload
 * are installed by separate steps with separate idempotency markers.
 * @param remote - profile remote seam.
 * @param paths - fixed layout.
 */
export async function writeProfileStartupFiles(remote: ProfileRemote, paths: ProfilePaths): Promise<void> {
  await remote.exec(`command mkdir -p ${shellQuote(paths.profileDir)} ${shellQuote(paths.pluginDir)}`, { maxBytes: 1024, timeoutMs: 15_000 })
  for (const [name, content] of profileStartupFiles({ profile: paths.profile })) {
    await remote.writeFile(`${paths.profileDir}/${name}`, Buffer.from(content, 'utf8'))
  }
}

/** The profile plugin marker body. */
export interface ProfilePluginMarker {
  readonly id: 'plugin'
  readonly version: string
  readonly sha256: string
  readonly profile: string
  readonly installedAt: string
}

/** One marker file path inside the profile directory. */
export function profilePluginMarkerPath(paths: ProfilePaths): string {
  return `${paths.profileDir}/${PROFILE_PLUGIN_MARKER}`
}

/**
 * Write the profile file set and its marker.
 *
 * Order is load-bearing: every file first, marker last, so an interrupted
 * install never looks current. The caller may reuse `digest` to skip the whole
 * write when the marker already matches.
 * @returns the marker digest that was written.
 */
export async function writeProfile(
  remote: ProfileRemote,
  paths: ProfilePaths,
  plugin: readonly RemoteFile[],
  options: { readonly version: string; readonly now?: Date } = { version: '' },
): Promise<{ digest: string; files: readonly RemoteFile[] }> {
  const files = buildProfileFileSet(paths, plugin)
  const digest = await profileFileSetDigest(files)
  await remote.exec(`command mkdir -p ${shellQuote(paths.profileDir)} ${shellQuote(paths.pluginDir)}`, { maxBytes: 1024, timeoutMs: 15_000 })
  for (const file of files) await remote.writeFile(file.path, file.content)
  const marker: ProfilePluginMarker = {
    id: 'plugin',
    version: options.version,
    sha256: digest,
    profile: paths.profile,
    installedAt: (options.now ?? new Date()).toISOString(),
  }
  await remote.exec(
    `printf %s ${shellQuote(`${JSON.stringify(marker)}\n`)} > ${shellQuote(profilePluginMarkerPath(paths))}`,
    { maxBytes: 1024, timeoutMs: 15_000 },
  )
  return { digest, files }
}

/** Read the existing profile marker; a missing/corrupt marker means "reinstall". */
export async function readProfilePluginMarker(remote: ProfileRemote, paths: ProfilePaths): Promise<ProfilePluginMarker | undefined> {
  const result = await remote.exec(`cat ${shellQuote(profilePluginMarkerPath(paths))} 2>/dev/null || true`, { maxBytes: 4096, timeoutMs: 10_000 })
  const text = result.stdout.trim()
  if (text === '') return undefined
  try {
    const parsed = JSON.parse(text) as Partial<ProfilePluginMarker>
    if (parsed.id !== 'plugin' || typeof parsed.sha256 !== 'string' || typeof parsed.version !== 'string' || typeof parsed.profile !== 'string') return undefined
    return parsed as ProfilePluginMarker
  } catch {
    return undefined
  }
}

/** A token fingerprint for diagnostics only (never an authentication input). */
export function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16)
}
