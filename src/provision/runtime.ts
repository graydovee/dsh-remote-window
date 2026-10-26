/**
 * Independent / global DSH runtime planning for one client.
 *
 * The v1 start command is:
 *
 *   DSH_HOME=… PATH="<runtime>/node/bin:<runtime>/dsh/node_modules/.bin:$PATH"
 *   exec <runtime>/dsh/node_modules/.bin/dsh --profile … --host 127.0.0.1 --port 0 --no-open
 *
 * so one client's isolated runtime is a fixed directory with two components, a
 * Node distribution and a dsh install:
 *
 *   $DSH_HOME/remote-workspace/<clientId>/runtime/node/bin/node
 *   $DSH_HOME/remote-workspace/<clientId>/runtime/dsh/node_modules/.bin/dsh
 *
 * The artifact (client cache upload first, server download only as a fallback)
 * is a tarball carrying `node/` and `dsh/` at its root. The remote script below
 * verifies the checksum, proves both binaries answer, and atomically swaps the
 * two directories; the marker is written last.
 *
 * Global runtimes are only **detected** here: installing or upgrading the
 * server's shared dsh affects every profile on that host and therefore requires
 * an explicit confirmation (protocol D10/§6).
 */
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProfileExecResult, ProfileRemote } from './profile-lifecycle.ts'
import { scrubSecrets } from '../targets/types.ts'
import { pathAssignment, shellQuote } from './profile.ts'
import { isClientId } from '../targets/client-id.ts'

/** Which runtime a connection uses. */
export type RuntimeKind = 'isolated' | 'global'

/** The two-component isolated runtime layout. */
export interface RuntimePaths {
  readonly dshHome: string
  readonly clientId: string
  readonly root: string
  readonly nodeDir: string
  readonly nodeBin: string
  readonly dshDir: string
  readonly launcher: string
  readonly stateDir: string
  readonly stagingDir: string
  readonly markerPath: string
}

/** The installed-runtime marker (idempotency). */
export interface RuntimeMarker {
  readonly kind: 'isolated'
  readonly version: string
  readonly sha256: string
  readonly platformArch: string
  readonly installedAt: string
}

/** The local artifact the host may upload (or download as a fallback). */
export interface RuntimeArtifact {
  readonly path: string
  readonly name: string
  readonly sha256: string
  readonly size: number
  readonly version: string
  readonly platformArch: string
}

/** A coded runtime failure. */
export class RuntimeError extends Error {
  constructor(
    readonly code:
      | 'runtime-incompatible'
      | 'runtime-confirmation-required'
      | 'runtime-missing'
      | 'runtime-integrity-failed'
      | 'runtime-install-failed',
    message: string,
    readonly details?: unknown,
  ) {
    super(scrubSecrets(message))
    this.name = 'RuntimeError'
  }
}

/** `$DSH_HOME/remote-workspace/<clientId>/runtime` for one client. */
export function runtimePaths(dshHome: string, clientId: string): RuntimePaths {
  if (!dshHome.startsWith('/')) throw new Error(`DSH_HOME must be an absolute server path, got ${JSON.stringify(dshHome)}`)
  if (!isClientId(clientId)) throw new Error(`invalid clientId ${JSON.stringify(clientId)}`)
  const home = dshHome.replace(/\/+$/u, '')
  const stateDir = `${home}/remote-workspace/${clientId}`
  const root = `${stateDir}/runtime`
  return {
    dshHome: home,
    clientId,
    root,
    nodeDir: `${root}/node`,
    nodeBin: `${root}/node/bin/node`,
    dshDir: `${root}/dsh`,
    launcher: `${root}/dsh/node_modules/.bin/dsh`,
    stateDir,
    stagingDir: `${stateDir}/staging`,
    markerPath: `${root}/.dsh-rw-runtime.json`,
  }
}

/** The artifact name for one dsh release + platform. */
export function runtimeArtifactName(version: string, platformArch: string): string {
  return `dsh-runtime-${version}-${platformArch}.tar.gz`
}

/** The client-side cache path of one runtime artifact. */
export function runtimeArtifactCachePath(cacheDir: string, version: string, platformArch: string): string {
  return join(cacheDir, runtimeArtifactName(version, platformArch))
}

/**
 * Find the runtime artifact in the client cache (or an explicit env path).
 *
 * The artifact is client-uploaded, so the file must be local. A missing file is
 * `undefined` (the caller may download it); a path is returned only when it is a
 * regular non-empty file.
 */
export async function resolveRuntimeArtifact(options: {
  readonly version: string
  readonly platformArch: string
  readonly cacheDir: string
  readonly env?: Record<string, string | undefined>
}): Promise<string | undefined> {
  const override = options.env?.['DSH_RW_RUNTIME_ARTIFACT']
  const path = override !== undefined && override !== '' ? override : runtimeArtifactCachePath(options.cacheDir, options.version, options.platformArch)
  try {
    const info = await stat(path)
    return info.isFile() && info.size > 1024 ? path : undefined
  } catch {
    return undefined
  }
}

/** Parse the installed-runtime marker; a missing/corrupt marker means reinstall. */
export function parseRuntimeMarker(text: string): RuntimeMarker | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  try {
    const parsed = JSON.parse(trimmed) as Partial<RuntimeMarker>
    if (
      parsed.kind !== 'isolated' ||
      typeof parsed.version !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(parsed.sha256 ?? '') ||
      typeof parsed.platformArch !== 'string' ||
      typeof parsed.installedAt !== 'string'
    ) return undefined
    return parsed as RuntimeMarker
  } catch {
    return undefined
  }
}

/** What the connect pipeline should do for its runtime stage. */
export type RuntimePlan =
  | { readonly kind: 'isolated'; readonly action: 'reuse' | 'install' | 'upgrade'; readonly requiresConfirmation: false; readonly reason: string }
  | { readonly kind: 'global'; readonly action: 'reuse' | 'install' | 'upgrade'; readonly requiresConfirmation: boolean; readonly reason: string }

/**
 * Decide the isolated runtime action.
 *
 * Isolated runtimes are per-client and may be installed/upgraded without asking
 * (D10); a marker with the same version+digest is reused. A global runtime is
 * detected only; a missing/incompatible global dsh becomes a
 * `requiresConfirmation: true` plan that the host must surface as a button.
 */
export function planRuntime(options: {
  readonly kind: RuntimeKind
  readonly expectedVersion: string
  readonly marker?: RuntimeMarker
  readonly artifact?: Pick<RuntimeArtifact, 'version' | 'sha256' | 'platformArch'>
  readonly global?: { readonly launcher: string; readonly version: string; readonly compatible: boolean }
}): RuntimePlan {
  if (options.kind === 'global') {
    const global = options.global
    if (global !== undefined && global.compatible && global.version === options.expectedVersion) {
      return { kind: 'global', action: 'reuse', requiresConfirmation: false, reason: `reuse the server's global dsh ${global.version} at ${global.launcher}` }
    }
    const action = global === undefined ? 'install' : 'upgrade'
    return {
      kind: 'global',
      action,
      requiresConfirmation: true,
      reason: global === undefined
        ? `no global dsh ${options.expectedVersion} was found; installing one changes every profile on the server`
        : `the server's global dsh ${global.version} is not the verified ${options.expectedVersion}; upgrading it changes every profile on the server`,
    }
  }
  const marker = options.marker
  if (marker !== undefined && marker.version === options.expectedVersion && (options.artifact === undefined || marker.sha256 === options.artifact.sha256)) {
    return { kind: 'isolated', action: 'reuse', requiresConfirmation: false, reason: `isolated runtime ${options.expectedVersion} already installed` }
  }
  return {
    kind: 'isolated',
    action: marker === undefined ? 'install' : 'upgrade',
    requiresConfirmation: false,
    reason: marker === undefined
      ? `installing isolated runtime ${options.expectedVersion}`
      : `upgrading isolated runtime ${marker.version} → ${options.expectedVersion}`,
  }
}

/**
 * Refuse a global runtime mutation without the user's explicit confirmation.
 * @param plan - the plan being executed.
 * @param confirmed - the UI button's answer.
 */
export function assertRuntimePlanConfirmed(plan: RuntimePlan, confirmed: boolean): void {
  if (plan.requiresConfirmation && !confirmed) {
    throw new RuntimeError(
      'runtime-confirmation-required',
      `${plan.action === 'install' ? 'install' : 'upgrade'} of the server's global DSH runtime requires explicit confirmation: ${plan.reason}`,
      { kind: plan.kind, action: plan.action },
    )
  }
}

/**
 * The remote install body for one isolated runtime artifact.
 *
 * Layout contract: the tarball contains `node/` and `dsh/` at its root. The
 * script stages the extraction, checks the checksum (when a hash tool exists),
 * proves `node/bin/node -v` and the dsh launcher answer, then replaces both
 * directories. A failed run leaves the previous runtime untouched.
 */
export function runtimeInstallScript(options: {
  readonly paths: RuntimePaths
  readonly artifact: RuntimeArtifact
  readonly tarballName: string
  readonly installedAt?: string
}): string {
  const stage = `${options.paths.stagingDir}/runtime`
  const tarball = `${options.paths.stagingDir}/${options.tarballName}`
  const marker: RuntimeMarker = {
    kind: 'isolated',
    version: options.artifact.version,
    sha256: options.artifact.sha256,
    platformArch: options.artifact.platformArch,
    installedAt: options.installedAt ?? new Date().toISOString(),
  }
  return [
    'set -eu',
    'umask 022',
    `TAR=${shellQuote(tarball)}`,
    `STAGE=${shellQuote(stage)}`,
    `ROOT=${shellQuote(options.paths.root)}`,
    'test -f "$TAR" || { echo "runtime artifact missing: $TAR" >&2; exit 10; }',
    'if command -v sha256sum >/dev/null 2>&1; then',
    `  echo ${shellQuote(`${options.artifact.sha256}  ${tarball}`)} | sha256sum -c - >/dev/null 2>&1 || { echo 'runtime sha256 mismatch' >&2; exit 11; }`,
    'elif command -v shasum >/dev/null 2>&1; then',
    `  echo ${shellQuote(`${options.artifact.sha256}  ${tarball}`)} | shasum -a 256 -c - >/dev/null 2>&1 || { echo 'runtime sha256 mismatch' >&2; exit 11; }`,
    'fi',
    'rm -rf "$STAGE"',
    `command mkdir -p "$STAGE" "$ROOT" ${shellQuote(options.paths.stagingDir)}`,
    'tar -xzf "$TAR" -C "$STAGE"',
    'test -e "$STAGE/node/bin/node" || { echo "runtime artifact has no node/bin/node" >&2; exit 12; }',
    'test -e "$STAGE/dsh/node_modules/.bin/dsh" || { echo "runtime artifact has no dsh launcher" >&2; exit 13; }',
    `chmod +x "$STAGE/node/bin/node" "$STAGE/dsh/node_modules/.bin/dsh" 2>/dev/null || true`,
    'got=$("$STAGE/node/bin/node" -v 2>/dev/null || true)',
    '[ -n "$got" ] || { echo "runtime node did not answer -v" >&2; exit 14; }',
    `rm -rf "$ROOT/node.new" "$ROOT/dsh.new"`,
    `command mv -f "$STAGE/node" "$ROOT/node.new"`,
    `command mv -f "$STAGE/dsh" "$ROOT/dsh.new"`,
    `rm -rf "$ROOT/node" "$ROOT/dsh"`,
    `command mv -f "$ROOT/node.new" "$ROOT/node"`,
    `command mv -f "$ROOT/dsh.new" "$ROOT/dsh"`,
    `printf %s ${shellQuote(`${JSON.stringify(marker)}\n`)} > ${shellQuote(options.paths.markerPath)}`,
    'rm -rf "$STAGE" "$TAR"',
    'printf \'installed\\n\'',
  ].join('\n')
}

/** Read the runtime marker from the remote host. */
export async function readRuntimeMarker(remote: ProfileRemote, paths: RuntimePaths): Promise<RuntimeMarker | undefined> {
  const result: ProfileExecResult = await remote.exec(`cat ${shellQuote(paths.markerPath)} 2>/dev/null || true`, { maxBytes: 4096, timeoutMs: 10_000 })
  return parseRuntimeMarker(result.stdout)
}

/**
 * Install or upgrade one isolated runtime from a local artifact (upload path).
 *
 * The artifact is uploaded to the client's staging directory and the pure
 * {@link runtimeInstallScript} performs verification and the atomic swap. The
 * caller stops the profile server first (a running process may hold files in
 * the old runtime) and restarts it afterwards.
 */
export async function installIsolatedRuntime(options: {
  readonly remote: ProfileRemote
  readonly paths: RuntimePaths
  readonly artifact: RuntimeArtifact
  readonly content: Buffer
  readonly installedAt?: Date
}): Promise<{ readonly installed: boolean; readonly marker: RuntimeMarker }> {
  const tarballName = options.artifact.name
  const stagingPath = `${options.paths.stagingDir}/${tarballName}`
  await options.remote.exec(`command mkdir -p ${shellQuote(options.paths.stagingDir)}`, { maxBytes: 1024, timeoutMs: 15_000 })
  await options.remote.writeFile(stagingPath, options.content)
  const result = await options.remote.exec(runtimeInstallScript({
    paths: options.paths,
    artifact: options.artifact,
    tarballName,
    ...(options.installedAt === undefined ? {} : { installedAt: options.installedAt.toISOString() }),
  }), { maxBytes: 64 * 1024, timeoutMs: 300_000 })
  if (result.code !== 0) {
    throw new RuntimeError(
      'runtime-install-failed',
      `installing the isolated runtime for ${options.paths.clientId} failed (exit ${result.code ?? 'signal'}): ${scrubSecrets(result.stderr.trim().slice(-2000))}`,
    )
  }
  return {
    installed: true,
    marker: {
      kind: 'isolated',
      version: options.artifact.version,
      sha256: options.artifact.sha256,
      platformArch: options.artifact.platformArch,
      installedAt: (options.installedAt ?? new Date()).toISOString(),
    },
  }
}

/** The `PATH` prefixes the start command needs for one isolated runtime. */
export function runtimePathPrefixes(paths: RuntimePaths): readonly string[] {
  return [`${paths.nodeDir}/bin`, `${paths.dshDir}/node_modules/.bin`]
}

/** The start-command `PATH` assignment for a runtime (pure; shared with tests). */
export function runtimePathAssignment(paths: RuntimePaths): string {
  return pathAssignment(runtimePathPrefixes(paths))
}
