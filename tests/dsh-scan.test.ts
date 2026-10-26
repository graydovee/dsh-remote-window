/**
 * The read-only dsh scan: script invariants and the parser.
 *
 * Two things must never regress here:
 *
 * 1. The script stays **read-only**. A `mkdir` slipped into the scan (copied from
 *    the pipeline's probe script) would make a "just look at this host" wizard
 *    step write to the user's machine.
 * 2. The deployed-node fallback stays in place. Without it the uploaded dsh
 *    answers `exec: node: not found` and a healthy deployment reads as
 *    incompatible (measured on Ubuntu 22.04).
 */
import { describe, expect, it } from 'vitest'
import {
  assembleCandidates,
  candidateOrigin,
  parseDshScanOutput,
  scanDshScript,
  scanTools,
  SCAN_END,
  SCAN_MAGIC,
  type DshScan,
} from '../src/provision/dsh-scan.ts'

/** A complete, well-formed scan output. */
function sampleOutput(overrides: { tail?: string[] } = {}): string {
  return [
    SCAN_MAGIC,
    'HOME\t/home/user',
    'DSHHOME\t/home/user/.dsh',
    'UNAME\tLinux',
    'MACHINE\taarch64',
    'OSTYPE\tLinux',
    'LDD\tldd (Ubuntu GLIBC 2.35-0ubuntu3.6) 2.35',
    'TOOL\ttar\t/usr/bin/tar',
    'TOOL\tsha256sum\t/usr/bin/sha256sum',
    'TOOL\tcurl\t/usr/bin/curl',
    'NODE\t/usr/bin/node\tv20.11.1',
    'DSH\t/home/user/.nvm/versions/node/v24.4.0/bin/dsh\t/home/user/.nvm/versions/node/v24.4.0/lib/node_modules/@deepseek-ai/dsh/bin/dsh.js\t0.2.1-rc.3\t0\t/home/user/.nvm/versions/node/v24.4.0/bin/node',
    'DSH\t/home/user/.dsh/server/dsh/node_modules/.bin/dsh\t/home/user/.dsh/server/dsh/node_modules/.bin/dsh\t0.2.1-rc.3\t0\t/home/user/.dsh/server/node/bin/node',
    'DSH\t/opt/old/dsh\t/opt/old/dsh\t0.1.9-beta.4\t0\t',
    'PLUGIN\tdsh-remote-server\t0.1.0-alpha50\tabcdef',
    'PLUGIN\tweb\t\t',
    'MARKER\t/home/user/.dsh/server/.components/plugin.json\t{"id":"plugin","sha256":"abcdef"}',
    ...(overrides.tail ?? [SCAN_END]),
  ].join('\n')
}

describe('scanDshScript', () => {
  const script = scanDshScript()

  it('frames its output with the magic line and the END sentinel', () => {
    expect(script.split('\n')).toContain(`printf '%s\\n' '${SCAN_MAGIC}'`)
    expect(script.split('\n')).toContain(`printf '%s\\n' '${SCAN_END}'`)
  })

  it('puts the deployed node first on PATH (the measured exec: node: not found fix)', () => {
    expect(script).toContain('export PATH="$DSHHOME/server/node/bin:')
  })

  it('falls back to the deployed node when a shebang names none (the /bin/sh shim)', () => {
    expect(script).toContain('if [ -x "$DSHHOME/server/node/bin/node" ]')
    expect(script).toContain('case "$sb" in')
  })

  it('is read-only: no mkdir/rm/mv/cp/touch/ln, no package manager, no download', () => {
    for (const line of script.split('\n')) {
      expect(line).not.toMatch(/^\s*(?:sudo\s+)?(?:mkdir|rm|mv|cp|touch|chmod|chown|ln)\b/)
      expect(line).not.toMatch(/\b(?:npm|pnpm|yarn|apt|apt-get|pip|brew)\s/)
    }
    // `curl`/`wget` may only be *detected*, never invoked with a URL.
    expect(script).not.toMatch(/\b(?:curl|wget)\s+-/)
    expect(script).not.toMatch(/\$\((?:curl|wget)\b/)
  })

  it('only ever reads the packaging marker, never writes it', () => {
    const markerLines = script.split('\n').filter(line => line.includes('.components'))
    expect(markerLines).toHaveLength(3)
    // `2>/dev/null` is the only `>` allowed (it discards stderr, not bytes).
    for (const line of markerLines) expect(line.replaceAll('2>/dev/null', '')).not.toMatch(/>/)
  })

  it('invokes dsh with --version and nothing else', () => {
    const dshCalls = [...script.matchAll(/run "\$c" (--\S+)/g)].map(match => match[1])
    expect(dshCalls).toEqual(['--version'])
  })

  it('uses LF line endings only (a CRLF body answers /bin/sh: echo: not found in a distro)', () => {
    expect(script).not.toContain('\r')
  })

  it('honours an explicit dsh home and keeps a tilde unquoted', () => {
    expect(scanDshScript({ dshHome: '/data/dsh' })).toContain("DSHHOME='/data/dsh'")
    expect(scanDshScript({ dshHome: '~/alt-dsh' })).toContain('DSHHOME="$HOME/alt-dsh"')
    expect(scanDshScript({ dshHome: '' })).toContain('${DSH_HOME:-$HOME/.dsh}')
  })
})

describe('parseDshScanOutput', () => {
  it('folds every record kind', () => {
    const scan = parseDshScanOutput(sampleOutput())
    expect(scan.home).toBe('/home/user')
    expect(scan.dshHome).toBe('/home/user/.dsh')
    expect(scan.platform).toBe('Linux')
    expect(scan.machine).toBe('aarch64')
    expect(scan.ostype).toBe('Linux')
    expect(scan.ldd).toContain('GLIBC')
    expect(scan.tools.map(tool => tool.name)).toEqual(['tar', 'sha256sum', 'curl'])
    expect(scan.nodes).toEqual([{ path: '/usr/bin/node', version: 'v20.11.1' }])
    expect(scan.launchers).toHaveLength(3)
    expect(scan.launchers[0]).toEqual({
      path: '/home/user/.nvm/versions/node/v24.4.0/bin/dsh',
      realPath: '/home/user/.nvm/versions/node/v24.4.0/lib/node_modules/@deepseek-ai/dsh/bin/dsh.js',
      version: '0.2.1-rc.3',
      exitCode: 0,
      nodePath: '/home/user/.nvm/versions/node/v24.4.0/bin/node',
    })
    // The empty NODE field means "the deployed node", not a broken record.
    expect(scan.launchers[2]).toEqual({ path: '/opt/old/dsh', realPath: '/opt/old/dsh', version: '0.1.9-beta.4', exitCode: 0 })
    expect(scan.profiles).toEqual([
      { name: 'dsh-remote-server', pluginVersion: '0.1.0-alpha50', pluginSha256: 'abcdef' },
      { name: 'web' },
    ])
    expect(scan.marker).toContain('"id":"plugin"')
    expect(scan.truncated).toBe(false)
  })

  it('throws on a first line that is not the magic (an old/garbled answer must not read as "no dsh")', () => {
    expect(() => parseDshScanOutput('hello world\nEND')).toThrow(/unsupported scan output/)
    expect(() => parseDshScanOutput('')).toThrow(/unsupported scan output/)
  })

  it('flags truncated output but keeps what arrived', () => {
    const scan = parseDshScanOutput(sampleOutput({ tail: [] }))
    expect(scan.truncated).toBe(true)
    expect(scan.launchers).toHaveLength(3)
  })

  it('drops records with the wrong field count (that is also how a TAB in a path is discarded)', () => {
    const stdout = [
      SCAN_MAGIC,
      'HOME\t/home/u',
      'DSH\t/only/one/field',
      'DSH\t/with\ttab/in/path\t/real\t0.2.1\t0\t',
      'DSH\t/good/dsh\t/good/dsh\t0.2.1-rc.3\t0\t/usr/bin/node',
      'PLUGIN\tname-only',
      'END',
    ].join('\n')
    const scan = parseDshScanOutput(stdout)
    expect(scan.launchers).toEqual([
      { path: '/good/dsh', realPath: '/good/dsh', version: '0.2.1-rc.3', exitCode: 0, nodePath: '/usr/bin/node' },
    ])
    expect(scan.profiles).toEqual([])
  })

  it('ignores unknown record kinds (forward compatibility)', () => {
    const scan = parseDshScanOutput([SCAN_MAGIC, 'FUTURE\tone\ttwo', 'HOME\t/home/u', 'END'].join('\n'))
    expect(scan.home).toBe('/home/u')
  })

  it('tolerates CRLF line endings', () => {
    const scan = parseDshScanOutput(`${SCAN_MAGIC}\r\nHOME\t/home/u\r\nEND\r\n`)
    expect(scan.home).toBe('/home/u')
    expect(scan.truncated).toBe(false)
  })
})

describe('assembleCandidates', () => {
  const scan = parseDshScanOutput(sampleOutput())

  it('marks compatibilities, reasons and the shared profile block', () => {
    const candidates = assembleCandidates(scan, { profile: 'dsh-remote-server', expectedPluginSha: 'abcdef' })
    const byPath = new Map(candidates.map(candidate => [candidate.path, candidate]))
    const nvm = byPath.get('/home/user/.nvm/versions/node/v24.4.0/bin/dsh')
    expect(nvm?.compatible).toBe(true)
    expect(nvm?.executable).toBe(true)
    expect(nvm?.nodePath).toBe('/home/user/.nvm/versions/node/v24.4.0/bin/node')
    expect(nvm?.selfContained).toBe(false)
    expect(nvm?.profile).toEqual({ name: 'dsh-remote-server', pluginVersion: '0.1.0-alpha50', pluginSha256: 'abcdef', upToDate: true })
    expect(nvm?.reason).toBeUndefined()

    const old = byPath.get('/opt/old/dsh')
    expect(old?.compatible).toBe(false)
    expect(old?.selfContained).toBe(true)
    expect(old?.reason).toContain('older than the verified DSH runtime')
  })

  it('reports upToDate=false when the installed digest differs', () => {
    const candidates = assembleCandidates(scan, { profile: 'dsh-remote-server', expectedPluginSha: 'deadbeef' })
    expect(candidates[0]?.profile?.upToDate).toBe(false)
  })

  it('reports upToDate=false when the profile carries no marker at all', () => {
    const candidates = assembleCandidates(scan, { profile: 'web', expectedPluginSha: 'abcdef' })
    expect(candidates[0]?.profile).toEqual({ name: 'web', upToDate: false })
  })

  it('sorts current-and-compatible first, then compatible, then the rest', () => {
    const candidates = assembleCandidates(scan, { profile: 'dsh-remote-server', expectedPluginSha: 'abcdef' })
    // Two compatible launchers plus the 0.1.9 one; the incompatible entry is last
    // and every compatible entry sits ahead of it.
    expect(candidates.map(candidate => candidate.compatible)).toEqual([true, true, false])
    expect(candidates.at(-1)?.path).toBe('/opt/old/dsh')
  })

  it('ranks usable candidates first, then by path, whatever the input order (D-1: no origin)', () => {
    // The wizard's list is ordered by usability alone; there is no "was this
    // installed by us" tier (D-1 decision (b)), so this is the whole rule. The
    // profile block — and therefore `upToDate` — is shared by every candidate on
    // one host, so the only tiers that can differ here are usable vs not.
    const unsorted = parseDshScanOutput([
      SCAN_MAGIC,
      'HOME\t/home/u',
      'PLUGIN\tdsh-remote-server\t0.1.0-alpha50\tabcdef',
      // usable, listed before the unusable ones on purpose
      'DSH\t/z/compatible\t/z/compatible\t0.2.1-rc.3\t0\t',
      'DSH\t/a/incompatible\t/a/incompatible\t0.1.0\t0\t',
      'DSH\t/b/incompatible\t/b/incompatible\t0.2.1\t0\t',
      'END',
    ].join('\n'))
    const paths = assembleCandidates(unsorted, { profile: 'dsh-remote-server', expectedPluginSha: 'abcdef' })
      .map(candidate => candidate.path)
    expect(paths).toEqual(['/z/compatible', '/a/incompatible', '/b/incompatible'])
    // Same host, same DSH_HOME: the profile block (and so `upToDate`) is shared.
    expect(new Set(assembleCandidates(unsorted, { profile: 'dsh-remote-server', expectedPluginSha: 'abcdef' }).map(candidate => candidate.profile?.upToDate))).toEqual(new Set([true]))
  })

  it('caps the list at 12 entries', () => {
    const many: DshScan = {
      ...scan,
      launchers: Array.from({ length: 30 }, (_unused, index) => ({
        path: `/opt/dsh-${String(index).padStart(2, '0')}`,
        realPath: `/opt/dsh-${String(index).padStart(2, '0')}`,
        version: '0.2.1-rc.3',
        exitCode: 0,
      })),
    }
    expect(assembleCandidates(many, { profile: 'dsh-remote-server' })).toHaveLength(12)
  })

  it('calls a launcher that never answered incompatible, with the exit code in the reason', () => {
    const broken: DshScan = {
      ...scan,
      launchers: [{ path: '/opt/broken', realPath: '/opt/broken', version: '', exitCode: 127 }],
    }
    const [candidate] = assembleCandidates(broken, { profile: 'dsh-remote-server' })
    expect(candidate?.compatible).toBe(false)
    expect(candidate?.executable).toBe(false)
    expect(candidate?.reason).toContain('exit 127')
  })
})

describe('scanTools', () => {
  it('maps the TOOL records the pipeline probe reports', () => {
    expect(scanTools([
      { name: 'tar', path: '/usr/bin/tar' },
      { name: 'sha256sum', path: '/usr/bin/sha256sum' },
      { name: 'curl', path: '/usr/bin/curl' },
    ])).toEqual({ tar: true, sha256sum: true, curl: true, wget: false })
  })

  it('counts shasum as sha256sum (macOS ships only shasum)', () => {
    expect(scanTools([{ name: 'shasum', path: '/usr/bin/shasum' }])).toEqual({ tar: false, sha256sum: true, curl: false, wget: false })
  })

  it('reports every tool absent for a bare host', () => {
    expect(scanTools([])).toEqual({ tar: false, sha256sum: false, curl: false, wget: false })
  })

  it('ignores unknown tool names', () => {
    expect(scanTools([{ name: 'busybox', path: '/bin/busybox' }])).toEqual({ tar: false, sha256sum: false, curl: false, wget: false })
  })
})

describe('candidate provenance', () => {
  it('recognises the runtime this plugin deployed before any home rule', () => {
    expect(candidateOrigin('/home/user/.dsh/server/dsh/node_modules/.bin/dsh', '/home/user/.dsh')).toEqual({ origin: 'deployed' })
    // A different DSH_HOME makes the same path an ordinary "other" install.
    expect(candidateOrigin('/home/user/.dsh/server/dsh/node_modules/.bin/dsh', '/opt/dsh')).toEqual({ origin: 'other', detail: '/home/user/.dsh/server/dsh/node_modules/.bin' })
  })

  it('names node managers by version and system installs by directory', () => {
    expect(candidateOrigin('/home/user/.nvm/versions/node/v24.4.0/bin/dsh', '/home/user/.dsh')).toEqual({ origin: 'nvm', detail: 'v24.4.0' })
    expect(candidateOrigin('/home/user/.local/share/fnm/node-versions/v22.1.0/installation/bin/dsh', '')).toEqual({ origin: 'fnm', detail: 'v22.1.0' })
    expect(candidateOrigin('/usr/local/bin/dsh', '')).toEqual({ origin: 'system', detail: '/usr/local/bin' })
    expect(candidateOrigin('/home/user/.local/bin/dsh', '')).toEqual({ origin: 'user-local' })
    expect(candidateOrigin('/home/user/.volta/bin/dsh', '')).toEqual({ origin: 'volta' })
  })

  it('attaches the provenance to every assembled candidate', () => {
    const scan: DshScan = parseDshScanOutput(sampleOutput())
    const candidates = assembleCandidates(scan, { profile: 'dsh-remote-server', dshHome: '/home/user/.dsh' })
    const deployed = candidates.find(candidate => candidate.path.includes('/.dsh/server/dsh/'))
    expect(deployed?.origin).toBe('deployed')
    const nvm = candidates.find(candidate => candidate.path.includes('/.nvm/'))
    expect(nvm?.origin).toBe('nvm')
    expect(nvm?.originDetail).toBe('v24.4.0')
    expect(candidates.find(candidate => candidate.path === '/opt/old/dsh')?.origin).toBe('other')
  })
})
