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
import { RUNTIME_COMPAT, compatProblems, inDshRange, rangeExpression } from '../src/provision/runtime-compat.ts'
/** The release helper keeps its own copy of the expression rule; assert parity. */
import { rangeExpression as scriptRangeExpression } from '../scripts/sync-compat.mjs'

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

/** The expression `engines.dsh` and every peer must carry for this table. */
const EXPECTED_DSH_EXPRESSION = rangeExpression(RUNTIME_COMPAT.dsh)

describe('runtime contract', () => {
  it('compiles a table that passes the same checks the sync script runs', () => {
    expect(compatProblems(RUNTIME_COMPAT)).toEqual([])
  })

  it('declares the supported interval as engines.dsh, in one spelling', () => {
    expect(DSH_VERIFIED_RUNTIMES.length).toBeGreaterThan(0)
    expect(new Set(DSH_VERIFIED_RUNTIMES).size).toBe(DSH_VERIFIED_RUNTIMES.length)
    for (const runtime of DSH_VERIFIED_RUNTIMES) expect(inDshRange(runtime)).toBe(true)
    expect(manifest.engines.dsh).toBe(EXPECTED_DSH_EXPRESSION)
    if (RUNTIME_COMPAT.dsh.min === RUNTIME_COMPAT.dsh.max) {
      // A single supported release stays exact: ranges resolve differently under
      // pnpm and the exact form is what every published version shipped.
      expect(manifest.engines.dsh).toMatch(EXACT_VERSION)
    }
  })

  it('keeps the release script and the plugin on one expression rule', () => {
    for (const range of [
      { min: '0.2.1-rc.3', max: '0.2.1-rc.3' },
      { min: '0.2.1-rc.3', max: '0.2.2' },
      { min: '0.2.1', max: '0.3.0-rc.1' },
    ]) {
      expect(scriptRangeExpression(range)).toBe(rangeExpression(range))
    }
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
      expect(manifest.dependencies[name], name).toBe(EXPECTED_DSH_EXPRESSION)
    }
  })

  it('pins every dsh peer and devDependency to that same expression', () => {
    for (const [name, range] of [...dshDependencies(manifest.peerDependencies), ...dshDependencies(manifest.devDependencies)]) {
      expect(range, name).toBe(EXPECTED_DSH_EXPRESSION)
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
    const name = `dsh-remote-window-server-${manifest.version}.tgz`
    const sha = checksums[name]
    expect(sha, name).toMatch(/^[0-9a-f]{64}$/u)
    expect(statSync(new URL(`../assets/server-plugin/${name}`, import.meta.url)).size).toBeGreaterThan(1024)
  })
})

describe('README pair', () => {
  const headings = (path: string): string[] =>
    read(path).split('\n').filter(line => line.startsWith('## ')).map(line => line.trim())

  it('names the supported interval and this plugin version in both languages', () => {
    for (const path of ['README.md', 'README-zh.md']) {
      const text = read(path)
      expect(text, path).toContain(DSH_VERIFIED_SUMMARY)
      expect(text, path).toContain(manifest.version)
      expect(text, path).toContain('<!-- verified-runtimes:start -->')
      expect(text, path).toContain('<!-- verified-runtimes:end -->')
    }
  })

  it('keeps the same section list so the translation cannot drift', () => {
    expect(headings('README-zh.md')).toEqual(headings('README.md'))
  })
})
