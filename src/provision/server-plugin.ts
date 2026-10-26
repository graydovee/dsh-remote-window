/**
 * Offline per-client profile installation of the **server plugin**.
 *
 * Delivery contract (architecture §12.1 / protocol §14bis):
 *
 * - the client package ships `assets/server-plugin/dsh-remote-workspace-server-<version>.tgz`
 *   where `<version>` is this client plugin's release version (not a DSH version),
 *   plus `checksums.json` (`{ "<tarball name>": "<sha256>" }`);
 * - a dedicated profile installs it by unpacking (strip `package/`) into
 *   `<profileDir>/node_modules/dsh-remote-workspace-server/`, writing the four
 *   profile files and the marker `{version, sha256, protocol, dshVersion}`;
 *   no server-side network, pnpm or registry is involved;
 * - a trimmed/development package without the bundled tarball may download the
 *   same name+version and must verify it against `checksums.json`; a bad digest
 *   is `server-plugin-integrity-failed`, a mismatched version is
 *   `server-plugin-version-mismatch` — neither is installed;
 * - the marker matching the expected identity is an idempotent skip; upgrades
 *   and downgrades both reinstall through the same path and restart the profile.
 *
 * The shell body is a pure builder; installation only needs `exec`/`writeFile`,
 * so the tarball can be a fixture until the server repository starts building it.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { sha256File } from './assets.ts'
import type { RemoteFile } from '../targets/types.ts'
import { scrubSecrets } from '../targets/types.ts'
import {
  type ProfilePaths,
  type ProfileRemote,
  writeProfileStartupFiles,
} from './profile-lifecycle.ts'
import { shellQuote } from './profile.ts'

/** Package name the profile bundle list references. */
export const SERVER_PLUGIN_PACKAGE = 'dsh-remote-workspace-server'

/** Built-in tarball directory inside the client package. */
export const SERVER_PLUGIN_ASSET_DIR = 'assets/server-plugin'

/** Companion checksum index shipped next to the bundled tarball. */
export const SERVER_PLUGIN_CHECKSUMS_FILE = 'checksums.json'

/** Marker inside the profile (architecture §12.1 path). */
export const SERVER_PLUGIN_MARKER = '.dsh-rw-plugin.json'

/** The plugin wire protocol recorded in the marker. */
export const SERVER_PLUGIN_PROTOCOL = 1 as const

/** One bundled tarball's verified facts. */
export interface ServerPluginTarball {
  readonly path: string
  readonly name: string
  /** Version parsed from the file name (must equal the client version). */
  readonly version: string
  readonly size: number
  readonly sha256: string
  /** Where the bytes came from: bundled package asset or the download fallback. */
  readonly source: 'bundled' | 'download'
}

/** The marker body written after a successful install. */
export interface ServerPluginMarker {
  readonly version: string
  readonly sha256: string
  readonly protocol: typeof SERVER_PLUGIN_PROTOCOL
  readonly dshVersion: string
}

/** Tarball name → sha256. */
export type ServerPluginChecksums = Readonly<Record<string, string>>

/** A coded installer failure. */
export class ServerPluginError extends Error {
  constructor(
    readonly code:
      | 'server-plugin-missing'
      | 'server-plugin-version-mismatch'
      | 'server-plugin-integrity-failed'
      | 'server-plugin-invalid'
      | 'server-plugin-install-failed',
    message: string,
  ) {
    super(scrubSecrets(message))
    this.name = 'ServerPluginError'
  }
}

/** The tarball name for one client plugin version. */
export function serverPluginTarballName(version: string): string {
  return `${SERVER_PLUGIN_PACKAGE}-${version}.tgz`
}

/** Extract the version segment of a server-plugin tarball name. */
export function versionFromServerPluginTarball(name: string): string | undefined {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const match = new RegExp(`^${SERVER_PLUGIN_PACKAGE}-(.+)\\.tgz$`, 'u').exec(base)
  return match?.[1]
}

/** The absolute path a bundled tarball is expected at. */
export function bundledServerPluginPath(packageRoot: string, version: string): string {
  return join(packageRoot, SERVER_PLUGIN_ASSET_DIR, serverPluginTarballName(version))
}

/** The checksum index path inside the client package. */
export function serverPluginChecksumsPath(packageRoot: string): string {
  return join(packageRoot, SERVER_PLUGIN_ASSET_DIR, SERVER_PLUGIN_CHECKSUMS_FILE)
}

/** The marker path inside a profile. */
export function serverPluginMarkerPath(paths: ProfilePaths): string {
  return `${paths.profileDir}/${SERVER_PLUGIN_MARKER}`
}

/**
 * Parse `checksums.json`.
 *
 * The canonical shape is a flat `{ "<name>": "<sha256>" }`; a nested
 * `{ "files": { … } }` object is also accepted because release tooling often
 * wraps it. Invalid digests are ignored (the caller then refuses to install).
 */
export function parseServerPluginChecksums(text: string): ServerPluginChecksums {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {}
  }
  const record = parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  const nested = record['files'] !== null && typeof record['files'] === 'object' ? record['files'] as Record<string, unknown> : undefined
  const out: Record<string, string> = {}
  for (const source of [record, nested ?? {}]) {
    for (const [name, value] of Object.entries(source)) {
      if (typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)) out[name] = value
    }
  }
  return out
}

/** Read the bundled checksum index, if present. */
export async function readServerPluginChecksums(packageRoot: string): Promise<ServerPluginChecksums> {
  try {
    return parseServerPluginChecksums(await readFile(serverPluginChecksumsPath(packageRoot), 'utf8'))
  } catch {
    return {}
  }
}

/** The expected digest for one tarball name, if the index has it. */
export function expectedServerPluginSha(checksums: ServerPluginChecksums, version: string): string | undefined {
  return checksums[serverPluginTarballName(version)]
}

/**
 * Find and verify the bundled tarball.
 *
 * A missing file is `undefined` (the caller may download it); a file whose
 * `checksums.json` entry disagrees is `server-plugin-integrity-failed`; a name
 * that encodes another version is `server-plugin-version-mismatch` — installing
 * it would put a server plugin of a different release behind this client.
 * @param packageRoot - client plugin package root.
 * @param version - this client's plugin version.
 * @param checksums - pre-read index; read from disk when omitted.
 */
export async function findBundledServerPluginTarball(
  packageRoot: string,
  version: string,
  checksums?: ServerPluginChecksums,
): Promise<ServerPluginTarball | undefined> {
  const path = bundledServerPluginPath(packageRoot, version)
  let info
  try {
    info = await stat(path)
  } catch {
    return undefined
  }
  if (!info.isFile() || info.size < 256) {
    throw new ServerPluginError('server-plugin-invalid', `the bundled server plugin tarball is empty or unreadable: ${path}`)
  }
  const sha256 = await sha256File(path)
  const expected = expectedServerPluginSha(checksums ?? await readServerPluginChecksums(packageRoot), version)
  if (expected !== undefined && expected !== sha256) {
    throw new ServerPluginError(
      'server-plugin-integrity-failed',
      `the bundled server plugin tarball sha256 ${sha256} does not match checksums.json (${expected})`,
    )
  }
  return { path, name: serverPluginTarballName(version), version, size: info.size, sha256, source: 'bundled' }
}

/**
 * Verify one already-downloaded tarball before it is uploaded.
 * @param path - absolute local tarball path.
 * @param expectedVersion - client plugin version.
 * @param expectedSha256 - digest from `checksums.json`; a mismatch is refused.
 */
export async function verifyServerPluginTarball(
  path: string,
  expectedVersion: string,
  expectedSha256?: string,
): Promise<ServerPluginTarball> {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const version = versionFromServerPluginTarball(name)
  if (version === undefined) throw new ServerPluginError('server-plugin-invalid', `not a server plugin tarball name: ${name}`)
  if (version !== expectedVersion) {
    throw new ServerPluginError(
      'server-plugin-version-mismatch',
      `the server plugin tarball is version ${version}, this client requires ${expectedVersion}`,
    )
  }
  let info
  try {
    info = await stat(path)
  } catch {
    throw new ServerPluginError('server-plugin-missing', `the server plugin tarball does not exist: ${path}`)
  }
  if (!info.isFile() || info.size < 256) throw new ServerPluginError('server-plugin-invalid', `the server plugin tarball is empty: ${path}`)
  const sha256 = await sha256File(path)
  if (expectedSha256 !== undefined && expectedSha256 !== sha256) {
    throw new ServerPluginError(
      'server-plugin-integrity-failed',
      `the server plugin tarball sha256 ${sha256} does not match the expected ${expectedSha256}`,
    )
  }
  return { path, name, version, size: info.size, sha256, source: 'download' }
}

/** Download fallback seam (npm registry or release URL). */
export interface ServerPluginDownloader {
  /** Fetch the named tarball to `destination`; reject on a transport failure. */
  download(name: string, destination: string): Promise<void>
}

/**
 * Resolve the tarball the installer should upload.
 *
 * Bundled first. Only when the client package is trimmed/development does this
 * fall back to the injected downloader; the resulting bytes are verified against
 * the same `checksums.json` entry and the exact version before being returned.
 */
export async function resolveServerPluginTarball(options: {
  readonly packageRoot: string
  readonly version: string
  readonly cacheDir: string
  readonly downloader?: ServerPluginDownloader
}): Promise<ServerPluginTarball> {
  const checksums = await readServerPluginChecksums(options.packageRoot)
  const bundled = await findBundledServerPluginTarball(options.packageRoot, options.version, checksums)
  if (bundled !== undefined) return bundled
  const name = serverPluginTarballName(options.version)
  const expected = expectedServerPluginSha(checksums, options.version)
  if (options.downloader === undefined) {
    throw new ServerPluginError(
      'server-plugin-missing',
      `the client package has no bundled ${name} and no download source is configured${expected === undefined ? '' : ` (expected sha256 ${expected})`}`,
    )
  }
  const destination = join(options.cacheDir, name)
  await options.downloader.download(name, destination)
  return await verifyServerPluginTarball(destination, options.version, expected)
}

/**
 * Whether the installed marker already describes this tarball.
 * A missing marker is always a reinstall; protocol/DSH version changes also
 * force one (the server plugin must match this client's protocol).
 */
export function decideServerPluginInstall(
  marker: ServerPluginMarker | undefined,
  expected: { readonly version: string; readonly sha256: string; readonly protocol?: number; readonly dshVersion?: string },
): 'skip' | 'install' {
  if (marker === undefined) return 'install'
  if (marker.version !== expected.version || marker.sha256 !== expected.sha256) return 'install'
  if (expected.protocol !== undefined && marker.protocol !== expected.protocol) return 'install'
  if (expected.dshVersion !== undefined && marker.dshVersion !== expected.dshVersion) return 'install'
  return 'skip'
}

/** Parse the marker file, tolerating absence/corruption as "reinstall". */
export function parseServerPluginMarker(text: string): ServerPluginMarker | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  try {
    const parsed = JSON.parse(trimmed) as Partial<ServerPluginMarker>
    if (
      typeof parsed.version !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(parsed.sha256 ?? '') ||
      parsed.protocol !== SERVER_PLUGIN_PROTOCOL ||
      typeof parsed.dshVersion !== 'string'
    ) return undefined
    return parsed as ServerPluginMarker
  } catch {
    return undefined
  }
}

/**
 * The server-side install body.
 *
 * Everything is absolute and staged: the tarball is extracted into
 * `<stateDir>/staging/server-plugin`, its manifest name/version are compared to
 * the expected values, and only then is the package directory swapped in —
 * that is the `package/` strip. The marker is written last, so an interrupted
 * upload never looks installed. A downloaded tarball may carry a checksum; the
 * caller verifies it on the host too, and this body repeats the check when given.
 * @param options - tarball path on the server, profile paths and expected identity.
 */
export function serverPluginInstallScript(options: {
  readonly tarballPath: string
  readonly paths: ProfilePaths
  readonly expectedVersion: string
  readonly dshVersion: string
  readonly expectedSha256?: string
  readonly installedAt?: string
}): string {
  const stage = `${options.paths.stateDir}/staging/server-plugin`
  const marker: ServerPluginMarker = {
    version: options.expectedVersion,
    sha256: options.expectedSha256 ?? '',
    protocol: SERVER_PLUGIN_PROTOCOL,
    dshVersion: options.dshVersion,
  }
  const checksum = options.expectedSha256 === undefined
    ? []
    : [
        'if command -v sha256sum >/dev/null 2>&1; then',
        `  echo ${shellQuote(`${options.expectedSha256}  ${options.tarballPath}`)} | sha256sum -c - >/dev/null 2>&1 || { echo 'server plugin tarball sha256 mismatch' >&2; exit 12; }`,
        'elif command -v shasum >/dev/null 2>&1; then',
        `  echo ${shellQuote(`${options.expectedSha256}  ${options.tarballPath}`)} | shasum -a 256 -c - >/dev/null 2>&1 || { echo 'server plugin tarball sha256 mismatch' >&2; exit 12; }`,
        'fi',
      ]
  return [
    'set -eu',
    'umask 022',
    `TAR=${shellQuote(options.tarballPath)}`,
    `STAGE=${shellQuote(stage)}`,
    `DEST=${shellQuote(options.paths.pluginDir)}`,
    'test -f "$TAR" || { echo "server plugin tarball missing: $TAR" >&2; exit 10; }',
    ...checksum,
    'rm -rf "$STAGE"',
    'command mkdir -p "$STAGE" "$(dirname "$DEST")"',
    'tar -xzf "$TAR" -C "$STAGE"',
    'test -f "$STAGE/package/package.json" || { echo "server plugin tarball has no package/package.json" >&2; exit 11; }',
    // Refuse a tarball that writes outside package/ or uses `..` segments before
    // trusting its manifest (tar would otherwise extract those paths).
    "if tar -tzf \"$TAR\" | grep -Ev '^package(/|$)' | grep -q .; then echo 'server plugin tarball has entries outside package/' >&2; exit 15; fi",
    "if tar -tzf \"$TAR\" | grep -qE '(^|/)\\.\\.(/|$)'; then echo 'server plugin tarball contains .. path segments' >&2; exit 15; fi",
    // Compare name and version without assuming node is on the remote PATH.
    "name=$(tr -d '\\n' < \"$STAGE/package/package.json\" | sed -n 's/.*\"name\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p')",
    "ver=$(tr -d '\\n' < \"$STAGE/package/package.json\" | sed -n 's/.*\"version\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p')",
    `[ "$name" = ${shellQuote(SERVER_PLUGIN_PACKAGE)} ] || { echo "server plugin package name is $name" >&2; exit 13; }`,
    `[ "$ver" = ${shellQuote(options.expectedVersion)} ] || { echo "server plugin package version is $ver" >&2; exit 14; }`,
    'stage_real=$(cd "$STAGE" && pwd -P)',
    '[ "$(cd "$STAGE/package" && pwd -P)" = "$stage_real/package" ] || { echo "server plugin tarball escaped the staging directory" >&2; exit 15; }',
    'rm -rf "$DEST"',
    'command mv -f "$STAGE/package" "$DEST"',
    `printf %s ${shellQuote(`${JSON.stringify(marker)}\n`)} > ${shellQuote(serverPluginMarkerPath(options.paths))}`,
    'rm -rf "$STAGE"',
    'rm -f "$TAR"',
    'printf \'installed\\n\'',
  ].join('\n')
}

/** Read the installed marker. */
export async function readServerPluginMarker(remote: ProfileRemote, paths: ProfilePaths): Promise<ServerPluginMarker | undefined> {
  const result = await remote.exec(`cat ${shellQuote(serverPluginMarkerPath(paths))} 2>/dev/null || true`, { maxBytes: 4096, timeoutMs: 10_000 })
  return parseServerPluginMarker(result.stdout)
}

/**
 * Read one local package directory recursively into remote file entries.
 *
 * Peer packages copied into the profile are source-only (no `node_modules`) and
 * small; this intentionally does not follow a package manager's link layout.
 */
export async function collectLocalPackageFiles(packageDir: string): Promise<RemoteFile[]> {
  const files: RemoteFile[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
        continue
      }
      if (!entry.isFile()) continue
      files.push({ path: relative(packageDir, absolute).split('\\').join('/'), content: await readFile(absolute) })
    }
  }
  await walk(packageDir)
  return files
}

/**
 * Copy one runtime peer package into the profile's `node_modules`.
 *
 * A profile-local plugin resolves its peers from the profile's own
 * `node_modules` chain; a server whose global DSH installation is not an
 * ancestor (the normal `npm -g` layout) cannot resolve e.g.
 * `@deepseek-ai/schemastery`, and the profile server then dies at import time.
 * Copying the peer is the offline equivalent of the peer install and never
 * touches the shared global DSH.
 * @returns the number of files written.
 */
export async function installProfilePeerPackage(
  remote: ProfileRemote,
  paths: ProfilePaths,
  options: { readonly name: string; readonly packageDir: string },
): Promise<number> {
  const files = await collectLocalPackageFiles(options.packageDir)
  for (const file of files) {
    await remote.writeFile(`${paths.profileDir}/node_modules/${options.name}/${file.path}`, file.content)
  }
  return files.length
}

/**
 * Install (or reinstall/upgrade/downgrade) the server plugin into one profile.
 *
 * The profile's four root files are written first; the tarball install script
 * swaps the package and marker. The caller restarts the profile server when the
 * install changed anything (the running process has the old module graph).
 * @returns the marker facts and whether an install actually ran.
 */
export async function installServerPlugin(options: {
  readonly remote: ProfileRemote
  readonly paths: ProfilePaths
  readonly tarball: ServerPluginTarball
  readonly dshVersion: string
  readonly installedAt?: Date
  readonly force?: boolean
}): Promise<{ readonly installed: boolean; readonly marker: ServerPluginMarker }> {
  if (!options.force) {
    const existing = await readServerPluginMarker(options.remote, options.paths)
    if (decideServerPluginInstall(existing, {
      version: options.tarball.version,
      sha256: options.tarball.sha256,
      protocol: SERVER_PLUGIN_PROTOCOL,
      dshVersion: options.dshVersion,
    }) === 'skip') {
      return { installed: false, marker: existing as ServerPluginMarker }
    }
  }
  await writeProfileStartupFiles(options.remote, options.paths)
  const content = await readFile(options.tarball.path)
  const stagingPath = `${options.paths.stateDir}/staging/${options.tarball.name}`
  await options.remote.exec(`command mkdir -p ${shellQuote(`${options.paths.stateDir}/staging`)}`, { maxBytes: 1024, timeoutMs: 15_000 })
  await options.remote.writeFile(stagingPath, content)
  const result = await options.remote.exec(serverPluginInstallScript({
    tarballPath: stagingPath,
    paths: options.paths,
    expectedVersion: options.tarball.version,
    dshVersion: options.dshVersion,
    expectedSha256: options.tarball.sha256,
    ...(options.installedAt === undefined ? {} : { installedAt: options.installedAt.toISOString() }),
  }), { maxBytes: 64 * 1024, timeoutMs: 120_000 })
  if (result.code !== 0) {
    throw new ServerPluginError(
      'server-plugin-install-failed',
      `installing the server plugin into ${options.paths.profile} failed (exit ${result.code ?? 'signal'}): ${scrubSecrets(result.stderr.trim().slice(-2000))}`,
    )
  }
  return {
    installed: true,
    marker: {
      version: options.tarball.version,
      sha256: options.tarball.sha256,
      protocol: SERVER_PLUGIN_PROTOCOL,
      dshVersion: options.dshVersion,
    },
  }
}
