/**
 * Deployment decision layer: pure functions only, no SSH.
 *
 * These cover the ZCode-style idempotency core — marker parsing, the
 * skip/deploy decisions and the generated shell scripts' invariants.
 */
import { describe, expect, it } from 'vitest'
import {
  acquireProfileLock,
  checkDshScript,
  decideDsh,
  decideNode,
  decidePlugin,
  extractNodeScript,
  installDshPackageScript,
  markerJson,
  parseMarker,
  parseProbeOutput,
  parseReuseLauncherOutput,
  probeFactsFrom,
  probeScript,
  profileLockScript,
  profilePluginScript,
  profileUnlockScript,
  releaseProfileLock,
  reuseLauncherScript,
  sh,
  type DshMarker,
  type NodeMarker,
  type PluginMarker,
  type ProfilePluginMarker,
} from '../src/provision/deploy.ts'
import { bindingOf, isForeignBindingDir } from '../src/provision/package-build.ts'
import { reuseServerCommand, serverCommand } from '../src/provision/profile.ts'
import type { RemoteTransport } from '../src/provision/transport.ts'

const NODE_MARKER: NodeMarker = { id: 'node', version: 'v22.14.0', platformArch: 'linux-x64', sha256: 'a'.repeat(64) }
const DSH_MARKER: DshMarker = { id: 'dsh', version: '0.2.0-rc.2', sha256: 'e'.repeat(64) }
const PLUGIN_MARKER: PluginMarker = { id: 'plugin', sha256: 'b'.repeat(64) }

describe('probe framing', () => {
  it('parses a full probe output into an environment', () => {
    const stdout = [
      '/home/user',
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
    expect(facts.home).toBe('/home/user')
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
    const script = probeScript({ profile: 'dsh-remote-server' })
    // 8 separators: the original seven plus the additive reuse-mode marker read.
    expect(script.match(/@@RW@@/g)).toHaveLength(8)
    expect(script).toContain('uname -s')
    expect(script).toContain('.components/node.json')
    expect(script).toContain('.dsh-rw-plugin.json')
  })

  it('the probe reads the reuse-mode marker additively, and only for a safe profile name', () => {
    expect(probeScript({ profile: 'dsh-remote-server' })).toContain('cat ~/.dsh/profiles/dsh-remote-server/.dsh-rw-plugin.json')
    // Anything the schema would reject is simply not interpolated.
    expect(probeScript({ profile: '../etc' })).not.toContain('profiles/')
  })

  it('folds the reuse-mode marker into the environment without failing when absent', () => {
    const marker: ProfilePluginMarker = { id: 'plugin', sha256: 'c'.repeat(64), version: '0.1.0-alpha50', profile: 'dsh-remote-server' }
    const segments = ['/home/u', '@@RW@@', 'Linux\nx86_64', '@@RW@@', 'Linux', '@@RW@@', 'tar', '@@RW@@', '', '@@RW@@', '', '@@RW@@', '', '@@RW@@', 'ldd (GNU libc) 2.39', '@@RW@@', JSON.stringify(marker)]
    expect(parseProbeOutput(segments.join('\n')).profilePlugin).toEqual(marker)
    expect(parseProbeOutput(segments.slice(0, 15).join('\n')).profilePlugin).toBeUndefined()
  })

  it('one platform/arch/libc rule, shared with the reuse scan', () => {
    expect(probeFactsFrom({ uname: 'Linux', machine: 'aarch64', ostype: 'Linux', ldd: 'ldd (GNU libc) 2.39' })).toEqual({ platform: 'linux', arch: 'arm64', libc: 'gnu' })
    expect(probeFactsFrom({ uname: 'Linux', machine: 'x86_64', ostype: 'Linux', ldd: 'musl libc (x86_64)' })).toEqual({ platform: 'linux', arch: 'x64', libc: 'musl' })
    expect(probeFactsFrom({ uname: 'Darwin', machine: 'arm64', ostype: '', ldd: 'Project: dyld' })).toEqual({ platform: 'darwin', arch: 'arm64', libc: '' })
    // A Linux container masquerading as Darwin.
    expect(probeFactsFrom({ uname: 'Darwin', machine: 'x86_64', ostype: 'Linux', ldd: '' }).platform).toBe('linux')
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
    // `-e`, not `-x`: a package packed on Windows (NTFS has no execute bit)
    // arrives with mode 0666, so the script restores the bit instead of
    // rejecting an otherwise good deployment.
    expect(script).toContain(`test -e '/home/u/.dsh/server/staging/dsh-x/node_modules/.bin/dsh'`)
    expect(script).toContain(`command chmod +x '/home/u/.dsh/server/staging/dsh-x/node_modules/.bin/dsh'`)
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

describe('reuse-mode scripts', () => {
  it('writes the profile marker with digest, version and profile', () => {
    const script = profilePluginScript({ profileDir: '/home/u/.dsh/profiles/dsh-remote-server', sha256: 'a'.repeat(64), version: '0.1.0-alpha50', profile: 'dsh-remote-server' })
    expect(script.split('\n')[0]).toBe('set -eu')
    expect(script).toContain(`command mkdir -p '/home/u/.dsh/profiles/dsh-remote-server'`)
    expect(script).toContain(`> '/home/u/.dsh/profiles/dsh-remote-server/.dsh-rw-plugin.json'`)
    expect(script).toContain(`"id":"plugin"`)
    expect(script).toContain(`"version":"0.1.0-alpha50"`)
    expect(script).toContain(`"profile":"dsh-remote-server"`)
  })

  it('locks inside the profile directory with the same test-and-set as the deploy lock', () => {
    const lock = profileLockScript({ profileDir: '/home/u/.dsh/profiles/dsh-remote-server', token: 'tok-1' })
    expect(lock).toContain(`command mkdir '/home/u/.dsh/profiles/dsh-remote-server/.dsh-rw.lock'`)
    expect(lock).toContain(`'tok-1'`)
    expect(lock).toContain('exit 8')
    const unlock = profileUnlockScript({ profileDir: '/home/u/.dsh/profiles/dsh-remote-server', token: 'tok-1' })
    expect(unlock).toContain(`rm -rf '/home/u/.dsh/profiles/dsh-remote-server/.dsh-rw.lock'`)
  })

  it('acquires and releases the profile lock through the transport', async () => {
    const calls: string[] = []
    const transport = {
      kind: 'ssh',
      exec: async (body: string) => { calls.push(body); return { code: 0, signal: null, stdout: '', stderr: '', truncated: false } },
      writeFile: async () => {},
      openChannel: async () => { throw new Error('not used') },
      close: async () => {},
    } as unknown as RemoteTransport
    await acquireProfileLock(transport, '/home/u/.dsh/profiles/p', 'tok')
    await releaseProfileLock(transport, '/home/u/.dsh/profiles/p', 'tok')
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('.dsh-rw.lock')
    expect(calls[1]).toContain('rm -rf')
  })

  it('measures the selected launcher with the deployed node first on PATH', () => {
    const script = reuseLauncherScript({ launcherPath: '/home/u/.nvm/versions/node/v24.4.0/bin/dsh', installHome: '/home/u' })
    expect(script).toContain('export PATH="/home/u/.dsh/server/node/bin:$PATH"')
    expect(script).toContain(`L='/home/u/.nvm/versions/node/v24.4.0/bin/dsh'`)
    expect(script).toContain('readlink -f')
    expect(script).toContain('"$L" --version')
    expect(script).toContain('SHEBANG')
    expect(script).toContain('DEPLOYED')
    expect(script.split('\n').at(-1)).toBe(`printf '%s\\n' 'END'`)
  })

  it('parses the launcher probe, including the /bin/sh shim shape', () => {
    const shim = parseReuseLauncherOutput([
      '@@RW@@REUSE@@1',
      'EXISTS\t1',
      'EXEC\t1',
      'REAL\t/home/u/.dsh/server/dsh/node_modules/.bin/dsh',
      'SHEBANG\t1',
      'NODE\t/home/u/.dsh/server/node/bin/node',
      'DEPLOYED\t/home/u/.dsh/server/node/bin/node',
      'VERSION\t0.2.1-rc.2',
      'CODE\t0',
      'END',
    ].join('\n'), '/home/u/.dsh/server/dsh/node_modules/.bin/dsh')
    expect(shim).toEqual({
      path: '/home/u/.dsh/server/dsh/node_modules/.bin/dsh',
      realPath: '/home/u/.dsh/server/dsh/node_modules/.bin/dsh',
      exists: true,
      executable: true,
      hasShebang: true,
      version: '0.2.1-rc.2',
      exitCode: 0,
      nodePath: '/home/u/.dsh/server/node/bin/node',
      deployedNode: '/home/u/.dsh/server/node/bin/node',
    })
  })

  it('falls back to conservative facts when the probe never answered', () => {
    const missing = parseReuseLauncherOutput('', '/opt/dsh')
    expect(missing).toMatchObject({ path: '/opt/dsh', realPath: '/opt/dsh', exists: false, executable: false, hasShebang: false, version: '', exitCode: null })
    expect(missing.nodePath).toBeUndefined()
    expect(missing.deployedNode).toBeUndefined()
  })

  it('starts a reused dsh with DSH_HOME and the interpreter on PATH', () => {
    const command = reuseServerCommand({
      dshHome: '/home/u/.dsh',
      launcher: '/home/u/.nvm/versions/node/v24.4.0/bin/dsh',
      profile: 'dsh-remote-server',
      nodePath: '/home/u/.nvm/versions/node/v24.4.0/bin/node',
    })
    expect(command).toContain(`DSH_HOME='/home/u/.dsh'`)
    expect(command).toContain(`PATH="/home/u/.nvm/versions/node/v24.4.0/bin:$PATH"`)
    expect(command).toContain(`exec '/home/u/.nvm/versions/node/v24.4.0/bin/dsh' --profile 'dsh-remote-server'`)
  })

  it('starts a self-contained launcher without any PATH prefix', () => {
    const command = reuseServerCommand({
      dshHome: '/home/u/.dsh',
      launcher: '/usr/local/bin/dsh',
      profile: 'dsh-remote-server',
    })
    expect(command).toBe(`DSH_HOME='/home/u/.dsh' exec '/usr/local/bin/dsh' --profile 'dsh-remote-server'`)
  })
})
