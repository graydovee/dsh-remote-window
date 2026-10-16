import { execFile } from 'node:child_process'
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  listSshAliases,
  prefillFromResolution,
  readSshConfig,
  resolveSshAlias,
} from '../src/ssh-config'
import type { SshConfigHost, SshConfigResolution } from '../src/ssh-config'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-ssh-config-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Write a fixture file below the per-test temp directory. */
async function fixture(name: string, contents: string): Promise<string> {
  const file = join(dir, name)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, contents, 'utf8')
  return file
}

/** Write an executable `/bin/sh` stand-in for the `ssh` binary. */
async function fakeSsh(name: string, body: string): Promise<string> {
  const file = await fixture(name, `#!/bin/sh\n${body}\n`)
  await chmod(file, 0o755)
  return file
}

/** First entry, asserting the array is non-empty (keeps `noUncheckedIndexedAccess` happy). */
function firstEntry(hosts: SshConfigHost[]): SshConfigHost {
  const [head] = hosts
  if (head === undefined) throw new Error('expected at least one Host entry')
  return head
}

/** `ssh -V` exists on essentially every macOS/Linux box; skip the probe test when it does not. */
const realSshAvailable = await new Promise<boolean>((settle) => {
  try {
    execFile('ssh', ['-V'], (error) => settle(error === null))
  } catch {
    settle(false)
  }
})

describe('readSshConfig', () => {
  it('parses several Host blocks, including multiple patterns on one line', async () => {
    const path = await fixture(
      'config',
      [
        'Host web1 *.example.com',
        '  HostName web1.example.com',
        '  Port 2222',
        '  User alice',
        '  IdentityFile ~/.ssh/id_web1',
        '',
        'Host db.test',
        '  HostName 10.0.0.5',
        '  ProxyJump bastion',
        '',
      ].join('\n'),
    )

    const { hosts, warnings } = await readSshConfig(path)

    expect(warnings).toEqual([])
    expect(hosts.map((host) => host.alias)).toEqual(['web1', 'db.test'])
    expect(firstEntry(hosts)).toEqual({
      alias: 'web1',
      patterns: ['web1', '*.example.com'],
      source: path,
      hostName: 'web1.example.com',
      port: 2222,
      user: 'alice',
      identityFile: '~/.ssh/id_web1',
    })
    expect(hosts[1]).toMatchObject({
      alias: 'db.test',
      patterns: ['db.test'],
      source: path,
      hostName: '10.0.0.5',
      proxyJump: 'bastion',
    })
    expect(hosts[1]?.port).toBeUndefined()
  })

  it('ignores comments and blank lines and accepts the Key = value form', async () => {
    const path = await fixture(
      'config',
      [
        '# a leading comment',
        '',
        '   ',
        'Host equals   # a trailing comment',
        '  HostName = equals.example.com',
        '  Port = 2200',
        '  User=bob',
        '  ProxyCommand=ssh -W %h:%p jump',
        '  ProxyJump = jump@bastion:22',
        '',
      ].join('\n'),
    )

    const { hosts, warnings } = await readSshConfig(path)

    expect(warnings).toEqual([])
    expect(firstEntry(hosts)).toEqual({
      alias: 'equals',
      patterns: ['equals'],
      source: path,
      hostName: 'equals.example.com',
      port: 2200,
      user: 'bob',
      proxyCommand: 'ssh -W %h:%p jump',
      proxyJump: 'jump@bastion:22',
    })
  })

  it('unquotes values that contain spaces and honours backslash escapes', async () => {
    const path = await fixture(
      'config',
      [
        'Host quoted',
        '  User "first last"',
        '  IdentityFile "~/keys/my key"',
        '  ProxyCommand "ssh -W %h:%p \\"jump host\\""',
        '',
      ].join('\n'),
    )

    const { hosts } = await readSshConfig(path)

    expect(firstEntry(hosts)).toEqual({
      alias: 'quoted',
      patterns: ['quoted'],
      source: path,
      user: 'first last',
      identityFile: '~/keys/my key',
      proxyCommand: 'ssh -W %h:%p "jump host"',
    })
  })

  it('keeps the first value when an option is repeated in one block', async () => {
    const path = await fixture(
      'config',
      [
        'Host dup',
        '  User first-user',
        '  User second-user',
        '  Port 2201',
        '  Port 2202',
        '  HostName first.example.com',
        '  HostName second.example.com',
        '',
      ].join('\n'),
    )

    const { hosts } = await readSshConfig(path)

    expect(firstEntry(hosts)).toEqual({
      alias: 'dup',
      patterns: ['dup'],
      source: path,
      user: 'first-user',
      port: 2201,
      hostName: 'first.example.com',
    })
  })

  it('drops Match keywords instead of leaking them into a literal entry', async () => {
    const path = await fixture(
      'config',
      [
        'User global-user',
        'Host alpha',
        '  HostName alpha.example.com',
        'Match host beta',
        '  User matched-user',
        '  Port 2222',
        'Host gamma',
        '  User gamma-user',
        '',
      ].join('\n'),
    )

    const { hosts } = await readSshConfig(path)

    expect(hosts.map((host) => host.alias)).toEqual(['alpha', 'gamma'])
    expect(hosts[0]).toEqual({ alias: 'alpha', patterns: ['alpha'], source: path, hostName: 'alpha.example.com' })
    expect(hosts[1]).toEqual({ alias: 'gamma', patterns: ['gamma'], source: path, user: 'gamma-user' })
  })

  it('follows Include with a glob, relative paths and nested includes', async () => {
    const main = await fixture(
      'config',
      ['Host primary', '  HostName primary.example.com', 'Include conf.d/*.conf', ''].join('\n'),
    )
    await fixture(
      'conf.d/10-alpha.conf',
      ['Host alpha', '  HostName alpha.example.com', 'Include nested/gamma.conf', ''].join('\n'),
    )
    await fixture('conf.d/nested/gamma.conf', ['Host gamma', '  HostName gamma.example.com', ''].join('\n'))
    await fixture(
      'conf.d/20-beta.conf',
      ['Host beta', '  HostName beta.example.com', 'Include 10-alpha.conf', ''].join('\n'),
    )

    const { hosts, warnings } = await readSshConfig(main)

    expect(warnings).toEqual([])
    // Include is expanded in place, and an include cycle is read only once.
    expect(hosts.map((host) => host.alias)).toEqual(['primary', 'alpha', 'gamma', 'beta'])
    expect(hosts.map((host) => host.hostName)).toEqual([
      'primary.example.com',
      'alpha.example.com',
      'gamma.example.com',
      'beta.example.com',
    ])
  })

  it('expands ~ in Include paths against the home directory', async () => {
    const main = await fixture(
      'config',
      ['Host root', '  HostName root.example.com', 'Include ~/conf.d/*.conf', ''].join('\n'),
    )
    await fixture('conf.d/tilde.conf', ['Host tilde', '  HostName tilde.example.com', ''].join('\n'))

    // `readSshConfig` never reads the environment itself; only `~` expansion does,
    // through `os.homedir()`, so pointing HOME at the fixture keeps this hermetic.
    const previousHome = process.env.HOME
    process.env.HOME = dir
    try {
      const { hosts, warnings } = await readSshConfig(main)
      expect(warnings).toEqual([])
      expect(hosts.map((host) => host.alias)).toEqual(['root', 'tilde'])
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
    }
  })

  it('silently ignores an Include glob that matches nothing', async () => {
    const main = await fixture(
      'config',
      ['Host web1', '  HostName web1.example.com', 'Include conf.d/*.conf', ''].join('\n'),
    )

    const { hosts, warnings } = await readSshConfig(main)

    expect(hosts.map((host) => host.alias)).toEqual(['web1'])
    expect(warnings).toEqual([])
  })

  it('warns instead of throwing when an explicitly named include is missing', async () => {
    const main = await fixture(
      'config',
      ['Host web1', '  HostName web1.example.com', 'Include missing.conf', ''].join('\n'),
    )

    const { hosts, warnings } = await readSshConfig(main)

    expect(hosts.map((host) => host.alias)).toEqual(['web1'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('missing.conf')
  })

  it('returns an empty result and a warning for a missing config file', async () => {
    const missing = join(dir, 'nope', 'config')

    const result = await readSshConfig(missing)

    expect(result.hosts).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain(missing)
  })
})

describe('listSshAliases', () => {
  it('offers literal aliases only, sorted case-insensitively, keeping the first duplicate', async () => {
    const path = await fixture(
      'config',
      [
        'Host alpha',
        '  HostName alpha.example.com',
        '',
        'Host Zebra',
        '  HostName zebra.example.com',
        '',
        'Host zebra',
        '  HostName ignored.example.com',
        '',
        'Host multi *.example.com',
        '  HostName multi.example.com',
        '',
        'Host *.internal',
        '  HostName wildcard.example.com',
        '',
        'Host ?ne',
        '  HostName question.example.com',
        '',
        'Host !negated',
        '  HostName negated.example.com',
        '',
      ].join('\n'),
    )

    const { aliases, warnings } = await listSshAliases(path)

    expect(warnings).toEqual([])
    expect(aliases.map((host) => host.alias)).toEqual(['alpha', 'multi', 'Zebra'])
    expect(aliases[2]?.hostName).toBe('zebra.example.com')
  })

  it('returns no aliases and a warning when the config file is missing', async () => {
    const missing = join(dir, 'nope', 'config')

    const { aliases, warnings } = await listSshAliases(missing)

    expect(aliases).toEqual([])
    expect(warnings).toHaveLength(1)
  })
})

describe('resolveSshAlias', () => {
  const missingBinary = (): string => join(dir, 'definitely-not-an-ssh-binary')

  it('falls back to the config file when the ssh binary is missing', async () => {
    const path = await fixture(
      'config',
      ['Host web1', '  HostName web1.example.com', '  Port 2222', '  User alice', ''].join('\n'),
    )

    const resolution = await resolveSshAlias('web1', { configPath: path, sshBinary: missingBinary() })

    expect(resolution).toMatchObject({
      alias: 'web1',
      hostName: 'web1.example.com',
      port: 2222,
      user: 'alice',
      origin: 'config-file',
    })
  })

  it('falls back to the config file when ssh exits nonzero', async () => {
    const failing = await fakeSsh('ssh-failing', 'echo "hostname bogus.example.com"\nexit 3')
    const path = await fixture(
      'config',
      ['Host web1', '  HostName web1.example.com', '  Port 2201', ''].join('\n'),
    )

    const resolution = await resolveSshAlias('web1', { configPath: path, sshBinary: failing })

    expect(resolution).toMatchObject({ hostName: 'web1.example.com', port: 2201, origin: 'config-file' })
  })

  it('applies hostName ?? alias and port ?? 22 when the block omits them', async () => {
    const path = await fixture('config', ['Host bare', '  User carol', ''].join('\n'))

    const resolution = await resolveSshAlias('bare', { configPath: path, sshBinary: missingBinary() })

    expect(resolution).toEqual({
      alias: 'bare',
      hostName: 'bare',
      port: 22,
      user: 'carol',
      origin: 'config-file',
    })
  })

  it('matches literal aliases case-insensitively, including non-first patterns', async () => {
    const path = await fixture(
      'config',
      ['Host Web1 secondary', '  HostName web1.example.com', '  Port 2222', ''].join('\n'),
    )

    const upper = await resolveSshAlias('WEB1', { configPath: path, sshBinary: missingBinary() })
    const secondary = await resolveSshAlias('SECONDARY', { configPath: path, sshBinary: missingBinary() })

    expect(upper).toMatchObject({ alias: 'WEB1', hostName: 'web1.example.com', port: 2222, origin: 'config-file' })
    expect(secondary).toMatchObject({ alias: 'SECONDARY', hostName: 'web1.example.com', port: 2222 })
  })

  it('returns undefined for an alias that is neither configured nor remapped', async () => {
    const unknown = await fakeSsh(
      'ssh-unknown',
      ['echo "hostname nosuch"', 'echo "port 22"', 'echo "user someone"'].join('\n'),
    )
    const path = await fixture('config', ['Host web1', '  HostName web1.example.com', ''].join('\n'))

    await expect(resolveSshAlias('nosuch', { configPath: path, sshBinary: unknown })).resolves.toBeUndefined()
    await expect(
      resolveSshAlias('nosuch', { configPath: path, sshBinary: missingBinary() }),
    ).resolves.toBeUndefined()
  })

  it('rejects hostile alias spellings without ever spawning ssh', async () => {
    const marker = join(dir, 'spawned')
    const tripwire = await fakeSsh('ssh-tripwire', `touch '${marker}'\necho 'hostname evil.example.com'`)
    const path = await fixture('config', ['Host web1', '  HostName web1.example.com', ''].join('\n'))
    const hostile = [
      '',
      '  web1',
      'web1\t',
      'web1 extra',
      'web1\nHost evil',
      '-oProxyCommand=touch /tmp/pwned',
      '-F/etc/passwd',
      'web\u00001',
    ]

    for (const alias of hostile) {
      await expect(
        resolveSshAlias(alias, { configPath: path, sshBinary: tripwire }),
      ).resolves.toBeUndefined()
    }

    await expect(access(marker)).rejects.toThrow()
  })

  it('parses ssh -G output, preferring the first IdentityFile that exists on disk', async () => {
    const existing = await fixture('id_ed25519', 'not a real key, just a path target\n')
    const fake = await fakeSsh(
      'ssh-fake',
      [
        'echo "hostname fake.example.com"',
        'echo "port 2200"',
        'echo "user bob"',
        'echo "identityfile ~/.ssh/dsh-ssh-config-not-here"',
        `echo "identityfile ${existing}"`,
        'echo "proxyjump jump@bastion:22"',
        'echo "proxycommand ssh -W %h:%p bastion"',
      ].join('\n'),
    )
    const path = await fixture('config', ['Host web1', '  HostName fake.example.com', ''].join('\n'))

    const resolution = await resolveSshAlias('web1', { configPath: path, sshBinary: fake })

    expect(resolution).toEqual({
      alias: 'web1',
      hostName: 'fake.example.com',
      port: 2200,
      user: 'bob',
      identityFile: existing,
      proxyJump: 'jump@bastion:22',
      proxyCommand: 'ssh -W %h:%p bastion',
      origin: 'ssh -G',
    })
  })

  it('accepts an alias that only a wildcard block remaps', async () => {
    const fake = await fakeSsh(
      'ssh-wildcard',
      ['echo "hostname gateway.example.com"', 'echo "port 2200"', 'echo "user guest"'].join('\n'),
    )
    const path = await fixture(
      'config',
      ['Host *.example.com', '  HostName gateway.example.com', '  User guest', ''].join('\n'),
    )

    const resolution = await resolveSshAlias('anything', { configPath: path, sshBinary: fake })

    expect(resolution).toMatchObject({
      alias: 'anything',
      hostName: 'gateway.example.com',
      port: 2200,
      user: 'guest',
      origin: 'ssh -G',
    })
  })

  it.skipIf(!realSshAvailable)('resolves through the real ssh binary with -F pinned to the fixture', async () => {
    const path = await fixture(
      'config',
      ['Host web1', '  HostName web1.example.com', '  Port 2222', '  User alice', ''].join('\n'),
    )

    const resolution = await resolveSshAlias('web1', { configPath: path })

    // `-G` prints configuration and exits; no connection is ever opened.
    expect(resolution?.origin).toBe('ssh -G')
    expect(resolution?.hostName).toBe('web1.example.com')
  })
})

describe('prefillFromResolution', () => {
  const literal: SshConfigHost = {
    alias: 'web1',
    patterns: ['web1'],
    source: '/fixture/config',
    hostName: 'literal.example.com',
    port: 2200,
    user: 'literal-user',
    identityFile: '~/.ssh/literal',
  }

  it('prefers the resolution and fills its gaps from the literal block', () => {
    const resolution: SshConfigResolution = {
      alias: 'web1',
      hostName: 'resolved.example.com',
      port: 2222,
      user: 'resolved-user',
      origin: 'ssh -G',
    }

    expect(prefillFromResolution(literal, resolution)).toEqual({
      alias: 'web1',
      host: 'resolved.example.com',
      port: 2222,
      username: 'resolved-user',
      identityFile: '~/.ssh/literal',
      source: 'ssh -G',
    })
  })

  it('falls back to the literal block coordinates when there is no resolution', () => {
    expect(prefillFromResolution(literal, undefined)).toEqual({
      alias: 'web1',
      host: 'literal.example.com',
      port: 2200,
      username: 'literal-user',
      identityFile: '~/.ssh/literal',
      source: 'config-file',
    })
  })

  it('defaults host to the alias and port to 22 when both sides are silent', () => {
    const bare: SshConfigHost = { alias: 'db', patterns: ['db'], source: '/fixture/config' }
    const resolution: SshConfigResolution = { alias: 'db', hostName: 'db.example.com', port: 22, origin: 'ssh -G' }

    expect(prefillFromResolution(bare, resolution)).toEqual({
      alias: 'db',
      host: 'db.example.com',
      port: 22,
      source: 'ssh -G',
    })
    expect(prefillFromResolution(bare, undefined)).toEqual({
      alias: 'db',
      host: 'db',
      port: 22,
      source: 'config-file',
    })
  })
})
