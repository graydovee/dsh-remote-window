/**
 * Isolated/global runtime planning and the mock-artifact install path.
 *
 * The artifact layout is the v1 contract: a tarball with `node/` and `dsh/` at
 * its root. The installer runs through a real local `sh`; the artifact bytes are
 * a fixture until the release matrix produces them.
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RuntimeError,
  assertRuntimePlanConfirmed,
  installIsolatedRuntime,
  planRuntime,
  readRuntimeMarker,
  runtimeArtifactName,
  runtimeInstallScript,
  runtimePaths,
  runtimePathPrefixes,
  resolveRuntimeArtifact,
} from '../src/provision/runtime.ts'
import { LocalShellRemote, writeFakeRuntimeArtifact } from './helpers/local-remote.ts'

const CLIENT_ID = 'abcdef012345'
const VERSION = '0.2.1-rc.3'

describe('runtime paths and plans', () => {
  it('uses the fixed per-client runtime layout and PATH prefixes', () => {
    const paths = runtimePaths('/home/user/.dsh', CLIENT_ID)
    expect(paths.root).toBe('/home/user/.dsh/remote-workspace/abcdef012345/runtime')
    expect(paths.launcher).toBe(`${paths.root}/dsh/node_modules/.bin/dsh`)
    expect(paths.nodeBin).toBe(`${paths.root}/node/bin/node`)
    expect(runtimePathPrefixes(paths)).toEqual([`${paths.root}/node/bin`, `${paths.root}/dsh/node_modules/.bin`])
    expect(runtimeArtifactName(VERSION, 'linux-x64')).toBe('dsh-runtime-0.2.1-rc.3-linux-x64.tar.gz')
  })

  it('auto-installs/upgrades isolated runtimes but gates global ones behind confirmation', () => {
    const marker = { kind: 'isolated' as const, version: VERSION, sha256: 'a'.repeat(64), platformArch: 'linux-x64', installedAt: '2026-01-01T00:00:00.000Z' }
    expect(planRuntime({ kind: 'isolated', expectedVersion: VERSION, marker })).toMatchObject({ action: 'reuse', requiresConfirmation: false })
    expect(planRuntime({ kind: 'isolated', expectedVersion: VERSION, marker: { ...marker, version: '0.2.0' } })).toMatchObject({ action: 'upgrade', requiresConfirmation: false })
    expect(planRuntime({ kind: 'isolated', expectedVersion: VERSION })).toMatchObject({ action: 'install', requiresConfirmation: false })
    expect(planRuntime({
      kind: 'global',
      expectedVersion: VERSION,
      global: { launcher: '/usr/local/bin/dsh', version: VERSION, compatible: true },
    })).toMatchObject({ action: 'reuse', requiresConfirmation: false })
    expect(planRuntime({
      kind: 'global',
      expectedVersion: VERSION,
      global: { launcher: '/usr/local/bin/dsh', version: '0.2.0', compatible: false },
    })).toMatchObject({ action: 'upgrade', requiresConfirmation: true })
    expect(() => assertRuntimePlanConfirmed({ kind: 'global', action: 'install', requiresConfirmation: true, reason: 'x' }, false))
      .toThrow(RuntimeError)
    expect(() => assertRuntimePlanConfirmed({ kind: 'global', action: 'install', requiresConfirmation: true, reason: 'x' }, true)).not.toThrow()
  })
})

describe('runtime install script and mock artifact', () => {
  it('is LF-only, verifies the digest and proves both binaries before swapping', () => {
    const paths = runtimePaths('/home/user/.dsh', CLIENT_ID)
    const script = runtimeInstallScript({
      paths,
      tarballName: 'dsh-runtime-0.2.1-rc.3-linux-x64.tar.gz',
      artifact: { path: '/tmp/a.tgz', name: 'a.tgz', sha256: 'b'.repeat(64), size: 10, version: VERSION, platformArch: 'linux-x64' },
    })
    expect(script).not.toContain('\r')
    expect(script).toContain('sha256sum -c')
    expect(script).toContain('tar -xzf')
    expect(script).toContain('"$STAGE/node/bin/node" -v')
    expect(script.indexOf('mv -f "$STAGE/node"')).toBeLessThan(script.indexOf('printf %s'))
  })

  it('resolves a runtime artifact from the cache or env and reports a missing one', async () => {
    const cache = await mkdtemp(join(tmpdir(), 'dsh-rw-runtime-cache-'))
    expect(await resolveRuntimeArtifact({ version: VERSION, platformArch: 'linux-x64', cacheDir: cache })).toBeUndefined()
    const path = join(cache, runtimeArtifactName(VERSION, 'linux-x64'))
    await writeFile(path, Buffer.alloc(2048))
    expect(await resolveRuntimeArtifact({ version: VERSION, platformArch: 'linux-x64', cacheDir: cache })).toBe(path)
    expect(await resolveRuntimeArtifact({ version: VERSION, platformArch: 'linux-x64', cacheDir: cache, env: { DSH_RW_RUNTIME_ARTIFACT: path } })).toBe(path)
  })

  it('installs a fixture artifact through a real shell and writes the marker', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-rw-runtime-'))
    const paths = runtimePaths(home, CLIENT_ID)
    const artifactRoot = await mkdtemp(join(tmpdir(), 'dsh-rw-runtime-artifact-'))
    const tarball = await writeFakeRuntimeArtifact(artifactRoot, 'dsh-runtime-0.2.1-rc.3-linux-x64.tar.gz')
    const content = await readFile(tarball)
    const { createHash } = await import('node:crypto')
    const sha256 = createHash('sha256').update(content).digest('hex')
    const remote = new LocalShellRemote(home)
    const installed = await installIsolatedRuntime({
      remote,
      paths,
      artifact: { path: tarball, name: 'dsh-runtime-0.2.1-rc.3-linux-x64.tar.gz', sha256, size: content.length, version: VERSION, platformArch: 'linux-x64' },
      content,
    })
    expect(installed.marker.version).toBe(VERSION)
    expect(await readRuntimeMarker(remote, paths)).toMatchObject({ version: VERSION, sha256 })
    expect(await readFile(paths.launcher, 'utf8')).toContain('dsh stub')
  })
})
