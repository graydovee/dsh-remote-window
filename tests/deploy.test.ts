/**
 * Deployment decision layer: pure functions only, no SSH.
 *
 * These cover the ZCode-style idempotency core — marker parsing, the
 * skip/deploy decisions and the generated shell scripts' invariants.
 */
import { describe, expect, it } from 'vitest'
import {
  checkDshScript,
  decideDsh,
  decideNode,
  decidePlugin,
  extractNodeScript,
  installDshPackageScript,
  markerJson,
  parseMarker,
  parseProbeOutput,
  probeScript,
  sh,
  type DshMarker,
  type NodeMarker,
  type PluginMarker,
} from '../src/provision/deploy.ts'
import { bindingOf, isForeignBindingDir } from '../src/provision/package-build.ts'
import { serverCommand } from '../src/provision/profile.ts'

const NODE_MARKER: NodeMarker = { id: 'node', version: 'v22.14.0', platformArch: 'linux-x64', sha256: 'a'.repeat(64) }
const DSH_MARKER: DshMarker = { id: 'dsh', version: '0.2.0-rc.2', sha256: 'e'.repeat(64) }
const PLUGIN_MARKER: PluginMarker = { id: 'plugin', sha256: 'b'.repeat(64) }

describe('probe framing', () => {
  it('parses a full probe output into an environment', () => {
    const stdout = [
      '/home/graydove',
      '@@RW@@',
      'Linux\nx86_64',
      '@@RW@@',
      'Linux',
      '@@RW@@',
      '/usr/bin/tar\n/usr/bin/sha256sum\n/usr/bin/curl',
      '@@RW@@',
      JSON.stringify(NODE_MARKER),
      '@@RW@@',
      JSON.stringify(DSH_MARKER),
      '@@RW@@',
      '',
      '@@RW@@',
      'ldd (Ubuntu GLIBC 2.35-0ubuntu3.6) 2.35',
    ].join('\n')
    const facts = parseProbeOutput(stdout)
    expect(facts.libc).toBe('gnu')
    expect(facts.home).toBe('/home/graydove')
    expect(facts.platform).toBe('linux')
    expect(facts.arch).toBe('x64')
    expect(facts.tools).toEqual({ tar: true, sha256sum: true, curl: true, wget: false })
    expect(facts.node).toEqual(NODE_MARKER)
    expect(facts.dsh).toEqual(DSH_MARKER)
    expect(facts.plugin).toBeUndefined()
  })

  it('treats a Darwin uname with a Linux ostype as linux (container masquerade)', () => {
    const facts = parseProbeOutput(['/home/u', '@@RW@@', 'Darwin\narm64', '@@RW@@', 'Linux', '@@RW@@', '', '@@RW@@', '', '@@RW@@', '', '@@RW@@', '', '@@RW@@', 'ldd (musl libc)'].join('\n'))
    expect(facts.platform).toBe('linux')
  })

  it('tolerates corrupt markers', () => {
    expect(parseMarker<NodeMarker>('{not json')).toBeUndefined()
    expect(parseMarker<NodeMarker>('')).toBeUndefined()
    expect(parseMarker<NodeMarker>(undefined)).toBeUndefined()
  })

  it('the probe script emits the framing it promises', () => {
    const script = probeScript()
    expect(script.match(/@@RW@@/g)).toHaveLength(7)
    expect(script).toContain('uname -s')
    expect(script).toContain('.components/node.json')
  })
})

describe('skip/deploy decisions', () => {
  const asset = { version: 'v22.14.0', sha256: 'a'.repeat(64) }
  it('skips node only on a full marker match', () => {
    expect(decideNode(NODE_MARKER, asset, 'linux-x64')).toBe('skip')
    expect(decideNode(NODE_MARKER, asset, 'linux-arm64')).toBe('deploy')
    expect(decideNode(NODE_MARKER, { ...asset, version: 'v22.12.0' }, 'linux-x64')).toBe('deploy')
    expect(decideNode(NODE_MARKER, { ...asset, sha256: 'c'.repeat(64) }, 'linux-x64')).toBe('deploy')
    expect(decideNode(undefined, asset, 'linux-x64')).toBe('deploy')
  })
  it('skips dsh only on the same version and content', () => {
    expect(decideDsh(DSH_MARKER, '0.2.0-rc.2', 'e'.repeat(64))).toBe('skip')
    expect(decideDsh(DSH_MARKER, '0.2.0-rc.3', 'e'.repeat(64))).toBe('deploy')
    expect(decideDsh(DSH_MARKER, '0.2.0-rc.2', 'f'.repeat(64))).toBe('deploy')
    expect(decideDsh(undefined, '0.2.0-rc.2', 'e'.repeat(64))).toBe('deploy')
  })
  it('skips the plugin on the same content hash', () => {
    expect(decidePlugin(PLUGIN_MARKER, 'b'.repeat(64))).toBe('skip')
    expect(decidePlugin(PLUGIN_MARKER, 'd'.repeat(64))).toBe('deploy')
  })
  it('markers serialize as one JSON line', () => {
    expect(markerJson(NODE_MARKER)).toBe(`${JSON.stringify(NODE_MARKER)}\n`)
  })

  it('binding detection covers scoped families and keeps the target flavour', () => {
    expect(bindingOf('node-addon-require-builtin-linux-x64-gnu@0.1.9')).toEqual({ family: 'node-addon-require-builtin', flavour: 'linux-x64-gnu' })
    expect(bindingOf('@deepseek-ai+node-addon-system-darwin-arm64@0.1.2')).toEqual({ family: 'node-addon-system', flavour: 'darwin-arm64' })
    expect(bindingOf('@deepseek-ai+dsh@0.2.0-rc.2')).toBeUndefined()
    expect(bindingOf('node-addon-require-builtin@0.1.9')).toBeUndefined()
    expect(isForeignBindingDir('@deepseek-ai+node-addon-system-darwin-arm64@0.1.2', 'linux-x64-gnu')).toBe(true)
    expect(isForeignBindingDir('node-addon-require-builtin-linux-x64-gnu@0.1.9', 'linux-x64-gnu')).toBe(false)
  })
})

describe('generated scripts', () => {
  it('wraps bodies in /bin/sh so the login shell never matters', () => {
    expect(sh('echo hi')).toBe(`/bin/sh -c 'echo hi'`)
  })

  it('the node extraction script stages, verifies, swaps atomically and writes the marker last', () => {
    const script = extractNodeScript({
      home: '/home/u',
      version: 'v22.14.0',
      tarballName: 'node-v22.14.0-linux-x64.tar.gz',
      distDir: 'node-v22.14.0-linux-x64',
      sha256: 'a'.repeat(64),
      platformArch: 'linux-x64',
      shaTool: 'sha256sum',
    })
    const lines = script.split('\n')
    expect(lines[0]).toBe('set -eu')
    expect(script).toContain(`sha256sum -c -`)
    expect(script.indexOf('tar -xzf')).toBeGreaterThan(script.indexOf('sha256sum -c -'))
    expect(script).toContain(`test -x '/home/u/.dsh/server/staging/node-x/node-v22.14.0-linux-x64/bin/node'`)
    const swap = script.indexOf(`command mv -f '/home/u/.dsh/server/node.new' '/home/u/.dsh/server/node'`)
    const marker = script.indexOf('node.json')
    expect(swap).toBeGreaterThan(-1)
    expect(marker).toBeGreaterThan(swap)
    expect(script).toContain(`[ "$got" = 'v22.14.0' ]`)
  })

  it('the node script skips sha verification when no tool exists', () => {
    const script = extractNodeScript({
      home: '/home/u',
      version: 'v22.14.0',
      tarballName: 'n.tar.gz',
      distDir: 'n',
      sha256: 'a'.repeat(64),
      platformArch: 'linux-x64',
      shaTool: '',
    })
    expect(script).not.toContain('sha256sum -c')
  })

  it('the dsh package install script verifies, swaps atomically and writes the marker last', () => {
    const script = installDshPackageScript({ home: '/home/u', version: '0.2.0-rc.2', sha256: 'e'.repeat(64), tarballName: 'dsh-runtime-0.2.0-rc.2-linux-x64.tar.gz' })
    const lines = script.split('\n')
    expect(lines[0]).toBe('set -eu')
    expect(script).toContain('sha256sum -c -')
    expect(script.indexOf('tar -xzf')).toBeGreaterThan(script.indexOf('sha256sum -c -'))
    expect(script).toContain(`test -x '/home/u/.dsh/server/staging/dsh-x/node_modules/.bin/dsh'`)
    const swap = script.indexOf(`command mv -f '/home/u/.dsh/server/staging/dsh-x' '/home/u/.dsh/server/dsh'`)
    const marker = script.indexOf('.components/dsh.json')
    expect(swap).toBeGreaterThan(-1)
    expect(marker).toBeGreaterThan(swap)
    // legacy npm-prefix layout from earlier builds must not linger
    expect(script).toContain(`rm -rf '/home/u/.dsh/server/dsh' '/home/u/.dsh/server/prefix'`)
    expect(script).toContain(`PATH="/home/u/.dsh/server/node/bin:/home/u/.dsh/server/staging/dsh-x/node_modules/.bin:$PATH"`)
  })

  it('the marker-hit check runs the launcher from the whole-package layout', () => {
    const check = checkDshScript({ home: '/home/u' })
    expect(check).toContain(`'/home/u/.dsh/server/dsh/node_modules/.bin/dsh'`)
    expect(check).toContain(`PATH="/home/u/.dsh/server/node/bin:/home/u/.dsh/server/dsh/node_modules/.bin:$PATH"`)
  })

  it('the start command resolves everything through the deployment root', () => {
    const command = serverCommand({ home: '/home/u', installHome: '/home/u', profile: 'dsh-remote-server' })
    expect(command).toContain(`DSH_HOME='/home/u'`)
    expect(command).toContain(`PATH="/home/u/.dsh/server/node/bin:/home/u/.dsh/server/dsh/node_modules/.bin:$PATH"`)
    expect(command).toContain(`exec '/home/u/.dsh/server/dsh/node_modules/.bin/dsh' --profile 'dsh-remote-server'`)
  })
})
