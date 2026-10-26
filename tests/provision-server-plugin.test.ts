/**
 * Offline server-plugin installation (architecture §12.1 / protocol §14bis).
 *
 * A real npm-pack-shaped tarball is extracted by the real host `tar` through the
 * same shell body the SSH installer uses; the profile files, `package/` strip,
 * marker and idempotent skip are all exercised. An optional environment fixture
 * (`DSH_RW_SERVER_PLUGIN_TARBALL`) lets the same test run against the actual
 * server-repository artifact without hard-coding a machine path in the repo.
 */
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  SERVER_PLUGIN_PROTOCOL,
  ServerPluginError,
  bundledServerPluginPath,
  decideServerPluginInstall,
  findBundledServerPluginTarball,
  installServerPlugin,
  parseServerPluginChecksums,
  parseServerPluginMarker,
  readServerPluginMarker,
  resolveServerPluginTarball,
  serverPluginInstallScript,
  serverPluginMarkerPath,
  serverPluginTarballName,
  verifyServerPluginTarball,
  versionFromServerPluginTarball,
} from '../src/provision/server-plugin.ts'
import { LocalShellRemote, makeProfilePaths, makeTempDshHome, packPackage, writeFakeServerPluginPackage } from './helpers/local-remote.ts'

const VERSION = '0.1.0-alpha.3'
const DSH_VERSION = '0.2.1-rc.3'

async function fakeTarball(options: { version?: string; name?: string } = {}): Promise<{ root: string; tarball: string }> {
  const root = await makeTempDshHome()
  await writeFakeServerPluginPackage(root, { version: options.version ?? VERSION, ...(options.name === undefined ? {} : { name: options.name }) })
  const tarball = await packPackage(root, serverPluginTarballName(options.version ?? VERSION))
  return { root, tarball }
}

describe('server plugin tarball identity', () => {
  it('parses names and checksums without trusting arbitrary JSON', () => {
    expect(serverPluginTarballName(VERSION)).toBe('dsh-remote-workspace-server-0.1.0-alpha.3.tgz')
    expect(versionFromServerPluginTarball(serverPluginTarballName(VERSION))).toBe(VERSION)
    expect(versionFromServerPluginTarball('other.tgz')).toBeUndefined()
    const checksums = parseServerPluginChecksums(JSON.stringify({
      'dsh-remote-workspace-server-0.1.0-alpha.3.tgz': 'a'.repeat(64),
      'bad.tgz': 'not-a-digest',
      files: { 'nested.tgz': 'b'.repeat(64) },
    }))
    expect(checksums['dsh-remote-workspace-server-0.1.0-alpha.3.tgz']).toBe('a'.repeat(64))
    expect(checksums['nested.tgz']).toBe('b'.repeat(64))
    expect(checksums['bad.tgz']).toBeUndefined()
  })

  it('accepts the matching version and refuses a different one', async () => {
    const { tarball } = await fakeTarball()
    const verified = await verifyServerPluginTarball(tarball, VERSION)
    expect(verified.version).toBe(VERSION)
    expect(verified.sha256).toMatch(/^[0-9a-f]{64}$/u)
    await expect(verifyServerPluginTarball(tarball, '0.1.0-alpha.4')).rejects.toMatchObject({ code: 'server-plugin-version-mismatch' })
  })

  it('refuses a bad checksum and a missing bundled file is undefined', async () => {
    const { tarball } = await fakeTarball()
    await expect(verifyServerPluginTarball(tarball, VERSION, 'f'.repeat(64))).rejects.toMatchObject({ code: 'server-plugin-integrity-failed' })
    const root = await makeTempDshHome()
    expect(await findBundledServerPluginTarball(root, VERSION)).toBeUndefined()
    expect(bundledServerPluginPath(root, VERSION)).toContain(`assets/server-plugin/${serverPluginTarballName(VERSION)}`)
  })

  it('resolves the bundled tarball without an env override', async () => {
    delete process.env['DSH_RW_SERVER_PLUGIN_TARBALL']
    const cacheDir = await mkdtemp(join(tmpdir(), 'dsh-rw-plugin-cache-'))
    const bundled = await resolveServerPluginTarball({ packageRoot: join(import.meta.dirname, '..'), version: VERSION, cacheDir })
    expect(bundled.source).toBe('bundled')
    expect(bundled.path).toContain(`assets/server-plugin/${serverPluginTarballName(VERSION)}`)
    const checksums = await (await import('node:fs/promises')).readFile(join(import.meta.dirname, '..', 'assets', 'server-plugin', 'checksums.json'), 'utf8')
    expect(checksums).toContain(bundled.sha256)
  })

  it('download fallback verifies the same checksums entry', async () => {
    const { root, tarball } = await fakeTarball()
    const body = await readFile(tarball)
    const downloaded = await resolveServerPluginTarball({
      packageRoot: root,
      version: VERSION,
      cacheDir: join(root, 'cache'),
      downloader: {
        download: async (_name, destination) => {
          const { writeFile, mkdir } = await import('node:fs/promises')
          await mkdir(join(destination, '..'), { recursive: true })
          await writeFile(destination, body)
        },
      },
    })
    expect(downloaded.source).toBe('download')
    expect(downloaded.version).toBe(VERSION)
    await expect(resolveServerPluginTarball({ packageRoot: root, version: VERSION, cacheDir: join(root, 'cache') }))
      .rejects.toMatchObject({ code: 'server-plugin-missing' })
  })
})

describe('serverPluginInstallScript', () => {
  it('is LF-only, stages, strips package/ and writes the marker last', async () => {
    const paths = await makeProfilePaths()
    const script = serverPluginInstallScript({
      tarballPath: `${paths.stateDir}/staging/x.tgz`,
      paths,
      expectedVersion: VERSION,
      dshVersion: DSH_VERSION,
      expectedSha256: 'a'.repeat(64),
    })
    expect(script).not.toContain('\r')
    expect(script).toContain('tar -xzf')
    expect(script).toContain('command mv -f "$STAGE/package" "$DEST"')
    expect(script).toContain('sha256sum -c')
    expect(script).toContain(serverPluginMarkerPath(paths))
    expect(script.indexOf('mv -f')).toBeLessThan(script.indexOf('printf %s'))
  })

  it('decides idempotency on version, digest, protocol and dsh version', () => {
    const marker = { version: VERSION, sha256: 'a'.repeat(64), protocol: SERVER_PLUGIN_PROTOCOL, dshVersion: DSH_VERSION }
    expect(decideServerPluginInstall(marker, { version: VERSION, sha256: 'a'.repeat(64), protocol: 1, dshVersion: DSH_VERSION })).toBe('skip')
    expect(decideServerPluginInstall(marker, { version: '0.1.0-alpha.4', sha256: 'a'.repeat(64) })).toBe('install')
    expect(decideServerPluginInstall(marker, { version: VERSION, sha256: 'b'.repeat(64) })).toBe('install')
    expect(decideServerPluginInstall(marker, { version: VERSION, sha256: 'a'.repeat(64), dshVersion: '0.2.1' })).toBe('install')
    expect(decideServerPluginInstall(undefined, { version: VERSION, sha256: 'a'.repeat(64) })).toBe('install')
    expect(parseServerPluginMarker(JSON.stringify(marker))).toEqual(marker)
    expect(parseServerPluginMarker('{"version":"x"}')).toBeUndefined()
  })
})

describe('installServerPlugin against a real local shell', () => {
  it('installs the package, profile files and marker; second run is a skip', async () => {
    const { tarball } = await fakeTarball()
    const verified = await verifyServerPluginTarball(tarball, VERSION)
    const paths = await makeProfilePaths()
    const remote = new LocalShellRemote(paths.dshHome)
    const first = await installServerPlugin({ remote, paths, tarball: verified, dshVersion: DSH_VERSION })
    expect(first.installed).toBe(true)
    expect(first.marker.version).toBe(VERSION)
    const installedManifest = JSON.parse(await readFile(join(paths.pluginDir, 'package.json'), 'utf8')) as { name: string; version: string }
    expect(installedManifest.name).toBe('dsh-remote-workspace-server')
    expect(installedManifest.version).toBe(VERSION)
    expect(await readFile(join(paths.profileDir, 'package.json'), 'utf8')).toContain('dsh-remote-workspace-server')
    expect(await readFile(join(paths.profileDir, 'cordis.patch.yml'), 'utf8')).toBe('[]\n')
    const marker = await readServerPluginMarker(remote, paths)
    expect(marker).toMatchObject({ version: VERSION, protocol: 1, dshVersion: DSH_VERSION })
    const skip = await installServerPlugin({ remote, paths, tarball: verified, dshVersion: DSH_VERSION })
    expect(skip.installed).toBe(false)
  })

  it('refuses a tarball whose package.json version disagrees with its file name', async () => {
    const { tarball } = await fakeTarball({ version: '9.9.9' })
    const verified = { path: tarball, name: serverPluginTarballName(VERSION), version: VERSION, size: 1, sha256: await hash(tarball), source: 'bundled' as const }
    const paths = await makeProfilePaths()
    const remote = new LocalShellRemote(paths.dshHome)
    await expect(installServerPlugin({ remote, paths, tarball: verified, dshVersion: DSH_VERSION }))
      .rejects.toMatchObject({ code: 'server-plugin-install-failed' })
    await expect(access(join(paths.pluginDir, 'package.json'))).rejects.toBeDefined()
  })

  it('runs against the real server-repository tarball when provided', async () => {
    const fixture = process.env['DSH_RW_SERVER_PLUGIN_TARBALL']
    if (fixture === undefined || fixture === '') return
    const verified = await verifyServerPluginTarball(fixture, VERSION)
    const paths = await makeProfilePaths()
    const remote = new LocalShellRemote(paths.dshHome)
    const installed = await installServerPlugin({ remote, paths, tarball: verified, dshVersion: DSH_VERSION })
    expect(installed.installed).toBe(true)
    const manifest = JSON.parse(await readFile(join(paths.pluginDir, 'package.json'), 'utf8')) as { name: string; version: string }
    expect(manifest.name).toBe('dsh-remote-workspace-server')
    expect(manifest.version).toBe(VERSION)
    // The server package's own bundle patch is not overwritten by the client.
    expect(await readFile(join(paths.pluginDir, 'cordis.patch.yml'), 'utf8')).toContain('dsh-remote-workspace-server')
  })
})

async function hash(path: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  const { readFile: read } = await import('node:fs/promises')
  return createHash('sha256').update(await read(path)).digest('hex')
}

void ServerPluginError
