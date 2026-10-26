/**
 * Release contract: the places that must agree before a version can be published.
 *
 * These assertions exist because the runtime gate, the manifest and the user
 * documentation drifted apart once already. They are cheap and they fail loudly:
 * a peer that is widened back to a range, a verified runtime the READMEs never
 * mention, a version bump that misses the server bundle, or a translation whose
 * sections moved.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import { DSH_VERIFIED_RUNTIMES, DSH_VERIFIED_SUMMARY, formatDshVersion, parseDshVersion } from '../src/provision/version-range.ts'

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const manifest = JSON.parse(read('package.json')) as {
  version: string
  engines: Record<string, string>
  dependencies: Record<string, string>
  peerDependencies: Record<string, string>
  devDependencies: Record<string, string>
  keywords: string[]
  files: string[]
  dsh: { manifestVersion: number; bundle: { patch: string }; client: { platform: string } }
}

/** The dsh packages whose version must follow `engines.dsh` exactly. */
const dshDependencies = (record: Record<string, string>): [string, string][] =>
  Object.entries(record).filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))

/** An exact version, never a range: no caret, tilde, comparison or `*`. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

describe('runtime contract', () => {
  it('declares one of the verified runtimes in engines.dsh', () => {
    expect(DSH_VERIFIED_RUNTIMES.length).toBeGreaterThan(0)
    expect(new Set(DSH_VERIFIED_RUNTIMES).size).toBe(DSH_VERIFIED_RUNTIMES.length)
    expect(DSH_VERIFIED_RUNTIMES).toContain(manifest.engines.dsh)
  })

  it('keeps every verified runtime parseable and canonically spelled', () => {
    for (const runtime of DSH_VERIFIED_RUNTIMES) {
      const parsed = parseDshVersion(runtime)
      expect(parsed, runtime).toBeDefined()
      expect(formatDshVersion(parsed!), runtime).toBe(runtime)
    }
  })

  it('ships the four SSH providers the client imports or mounts as runtime dependencies', () => {
    // The harness installation does not contain these packages: `dsh-ssh` is
    // imported by value (`/schemas`, `/protocol`) and the other three are mounted
    // by name inside the realm preset. A profile template sets
    // `autoInstallPeers: false`, so declaring them as peers alone leaves a fresh
    // install with `Cannot find package '@deepseek-ai/dsh-ssh'`.
    for (const name of ['@deepseek-ai/dsh-ssh', '@deepseek-ai/dsh-fs-ssh', '@deepseek-ai/dsh-subprocess-ssh', '@deepseek-ai/dsh-sandbox-ssh']) {
      expect(manifest.dependencies[name], name).toBe(manifest.engines.dsh)
    }
  })

  it('pins every dsh peer and devDependency to that same exact version', () => {
    for (const [name, range] of [...dshDependencies(manifest.peerDependencies), ...dshDependencies(manifest.devDependencies)]) {
      expect(range, name).toMatch(EXACT_VERSION)
      expect(range, name).toBe(manifest.engines.dsh)
    }
    expect(dshDependencies(manifest.peerDependencies).length).toBeGreaterThan(0)
  })
})

describe('package manifest', () => {
  it('carries the plugin bundle and client declarations', () => {
    expect(manifest.dsh.manifestVersion).toBe(1)
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh.client.platform).toBe('web')
  })

  it('is discoverable and ships only built artifacts', () => {
    expect(manifest.keywords).toContain('dsh-plugin')
    for (const entry of ['lib', 'cordis.patch.yml', 'README.md', 'README-zh.md', 'LICENSE', 'assets/server-plugin']) {
      expect(manifest.files, entry).toContain(entry)
    }
  })

  it('ships the built-in server plugin of exactly this client version', () => {
    const checksums = JSON.parse(read('assets/server-plugin/checksums.json')) as Record<string, string>
    const name = `dsh-remote-workspace-server-${manifest.version}.tgz`
    const sha = checksums[name]
    expect(sha, name).toMatch(/^[0-9a-f]{64}$/u)
    expect(statSync(new URL(`../assets/server-plugin/${name}`, import.meta.url)).size).toBeGreaterThan(1024)
  })
})

describe('README pair', () => {
  const headings = (path: string): string[] =>
    read(path).split('\n').filter(line => line.startsWith('## ')).map(line => line.trim())

  it('names the verified runtime in both languages', () => {
    for (const path of ['README.md', 'README-zh.md']) {
      expect(read(path), path).toContain(DSH_VERIFIED_SUMMARY)
    }
  })

  it('keeps the same section list so the translation cannot drift', () => {
    expect(headings('README-zh.md')).toEqual(headings('README.md'))
  })
})
