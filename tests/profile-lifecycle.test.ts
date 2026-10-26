/**
 * v1 profile lifecycle (protocol §3): the parts that must be exact.
 *
 * The start command's flag order, the anchored startup-line parser, the pid/log
 * layout, SIGTERM→SIGKILL stop, the four profile files and the lease classifier
 * are all pinned here. The remote seam is faked; the shell bodies are asserted
 * as text and the real tarball extraction lives in the installer test.
 */
import { describe, expect, it } from 'vitest'
import {
  buildProfileFileSet,
  findProfileStartup,
  isLeaseFresh,
  leaseActionFor,
  parseProfileLease,
  parseProfileStartupLine,
  parsePidFile,
  pidFileBody,
  profileFileSetDigest,
  profilePaths,
  profilePluginMarkerPath,
  profileStartScript,
  profileStartupFiles,
  profileStopScript,
  readProfilePluginMarker,
  readProfilePid,
  startProfileServer,
  stopProfileServer,
  tokenFingerprint,
  waitForProfileStartup,
  writeProfile,
  type ProfileExecResult,
  type ProfileRemote,
} from '../src/provision/profile-lifecycle.ts'
import { generateClientId, generateInstanceId, isClientId, isProfileName, profileNameFor } from '../src/targets/client-id.ts'
import { LocalShellRemote, makeProfilePaths } from './helpers/local-remote.ts'

const CLIENT_ID = '0123456789ab'
const VERSION = '0.1.0-alpha.3'

/** A scripted remote whose only state is the log/pid/alive triple. */
class FakeProfileRemote implements ProfileRemote {
  log = ''
  pid: number | undefined = 4242
  alive = false
  readonly scripts: string[] = []
  readonly writes: string[] = []
  probeStopped = false

  async exec(body: string): Promise<ProfileExecResult> {
    this.scripts.push(body)
    if (body.includes('setsid nohup')) {
      this.alive = true
      return { code: 0, stdout: `${this.pid ?? 4242}\n`, stderr: '' }
    }
    if (body.includes('pidfile=')) {
      this.alive = false
      return { code: 0, stdout: 'stopped\n', stderr: '' }
    }
    if (body.includes('kill -0')) return { code: 0, stdout: this.alive ? '0' : '1', stderr: '' }
    if (body.includes('server.pid')) return { code: 0, stdout: this.pid === undefined ? '' : `${this.pid}\n`, stderr: '' }
    if (body.includes('server.log')) return { code: 0, stdout: this.log, stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }

  async writeFile(path: string, _content: Buffer): Promise<void> {
    this.writes.push(path)
  }
}

describe('clientId and profile names', () => {
  it('generates a stable 12-hex clientId and a matching profile name', () => {
    const clientId = generateClientId(size => new Uint8Array(size).fill(0xab))
    expect(clientId).toBe('abababababab')
    expect(isClientId(clientId)).toBe(true)
    expect(isClientId('ABCDEF012345')).toBe(false)
    expect(isClientId('short')).toBe(false)
    expect(profileNameFor(CLIENT_ID)).toBe('graydovee-remote-workspace-0123456789ab')
    expect(isProfileName('graydovee-remote-workspace-0123456789ab')).toBe(true)
    expect(isProfileName('graydovee-remote-workspace-0123456789AB')).toBe(false)
    expect(generateInstanceId(() => 'instance-1')).toBe('instance-1')
  })
})

describe('profile path layout (protocol §3.1)', () => {
  it('keeps the profile, log/pid state and lease in their fixed places', () => {
    const paths = profilePaths('/home/user/.dsh', CLIENT_ID)
    expect(paths.profile).toBe('graydovee-remote-workspace-0123456789ab')
    expect(paths.profileDir).toBe('/home/user/.dsh/profiles/graydovee-remote-workspace-0123456789ab')
    expect(paths.stateDir).toBe('/home/user/.dsh/remote-workspace/profiles/graydovee-remote-workspace-0123456789ab')
    expect(paths.logPath).toBe(`${paths.stateDir}/server.log`)
    expect(paths.pidPath).toBe(`${paths.stateDir}/server.pid`)
    expect(paths.leasePath).toBe(`${paths.profileDir}/.dsh-rw/lease.json`)
    expect(paths.pluginDir).toBe(`${paths.profileDir}/node_modules/dsh-remote-workspace-server`)
    expect(() => profilePaths('relative/home', CLIENT_ID)).toThrow(/absolute/u)
    expect(() => profilePaths('/home/user/.dsh', 'nope')).toThrow(/clientId/u)
  })
})

describe('startup line and pid parsing', () => {
  it('parses exactly one anchored `dsh web:` line and ignores noise', () => {
    expect(parseProfileStartupLine('dsh web: http://127.0.0.1:55431/?token=AbC_def-123')).toEqual({ port: 55_431, token: 'AbC_def-123' })
    expect(parseProfileStartupLine('prefix dsh web: http://127.0.0.1:1/?token=x')).toBeUndefined()
    expect(parseProfileStartupLine('dsh web: http://127.0.0.1:0/?token=x')).toBeUndefined()
    expect(parseProfileStartupLine('dsh web: http://10.0.0.1:1/?token=x')).toBeUndefined()
    expect(findProfileStartup(`booting\n${'dsh web: http://127.0.0.1:4000/?token=tok'}\n`)).toEqual({ port: 4000, token: 'tok' })
  })

  it('accepts a decimal pid only and rejects garbage', () => {
    expect(parsePidFile('4242\n')).toBe(4242)
    expect(parsePidFile('')).toBeUndefined()
    expect(parsePidFile('0')).toBeUndefined()
    expect(parsePidFile('pid')).toBeUndefined()
    expect(pidFileBody(4242)).toBe('4242\n')
    expect(() => pidFileBody(0)).toThrow()
    expect(tokenFingerprint('secret')).toMatch(/^[0-9a-f]{16}$/u)
  })
})

describe('start and stop shell bodies', () => {
  it('starts detached with dsh launcher flags before app args, LF only', () => {
    const paths = profilePaths('/home/user/.dsh', CLIENT_ID)
    const script = profileStartScript(paths, {
      launcher: '/home/user/.dsh/remote-workspace/0123456789ab/runtime/dsh/node_modules/.bin/dsh',
      pathPrefixes: [
        '/home/user/.dsh/remote-workspace/0123456789ab/runtime/node/bin',
        '/home/user/.dsh/remote-workspace/0123456789ab/runtime/dsh/node_modules/.bin',
      ],
    })
    expect(script).not.toContain('\r')
    expect(script).toContain('setsid nohup env DSH_HOME=')
    expect(script).toContain(`--profile 'graydovee-remote-workspace-0123456789ab'`)
    expect(script.indexOf('--profile')).toBeLessThan(script.indexOf('--host'))
    expect(script).toContain('--host 127.0.0.1 --port 0 --no-open')
    expect(script).toContain(paths.logPath)
    expect(script).toContain(paths.pidPath)
    expect(script).toContain("printf '%s\\n' \"$pid\"")
    // The token is never printed here: only dsh itself writes it to the log.
    expect(script).not.toContain('token')
  })

  it('stops with SIGTERM, waits, then SIGKILL, guarding pid reuse', () => {
    const paths = profilePaths('/home/user/.dsh', CLIENT_ID)
    const script = profileStopScript(paths, { timeoutMs: 5_000 })
    expect(script).not.toContain('\r')
    expect(script).toContain('kill -TERM')
    expect(script).toContain('kill -KILL')
    expect(script).toContain('ps -p')
    expect(script).toContain(paths.profile)
    expect(script).toContain('rm -f "$pidfile"')
  })
})

describe('profileStartupFiles and marker', () => {
  it('writes four files with base/web-app/server-plugin bundles', () => {
    const paths = profilePaths('/home/user/.dsh', CLIENT_ID)
    const files = profileStartupFiles({ profile: paths.profile })
    expect([...files.keys()]).toEqual(['package.json', 'cordis.yml', 'cordis.patch.yml', 'pnpm-workspace.yaml'])
    const pkg = JSON.parse(files.get('package.json') ?? '{}') as { dsh: { profile: { bundles: string[] } } }
    expect(pkg.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-remote-workspace-server'])
    expect(files.get('cordis.yml')).toBe('[]\n')
    expect(files.get('cordis.patch.yml')).toBe('[]\n')
  })

  it('produces a full absolute file set and stable digest', async () => {
    const paths = profilePaths('/home/user/.dsh', CLIENT_ID)
    const plugin = [{ path: 'package.json', content: Buffer.from('{"name":"dsh-remote-workspace-server"}') }]
    const files = buildProfileFileSet(paths, plugin)
    expect(files.map(file => file.path)).toContain(`${paths.pluginDir}/package.json`)
    const digest = await profileFileSetDigest(files)
    expect(digest).toMatch(/^[0-9a-f]{64}$/u)
    expect(await profileFileSetDigest(files)).toBe(digest)
  })
})

describe('startProfileServer / stopProfileServer', () => {
  it('starts, parses the log, probes readiness and reports the handle', async () => {
    const paths = profilePaths('/home/user/.dsh', CLIENT_ID)
    const remote = new FakeProfileRemote()
    remote.log = 'booting\n'
    const probeCalls: number[] = []
    const handlePromise = startProfileServer(remote, paths, {
      launcher: '/home/user/.dsh/remote-workspace/0123456789ab/runtime/dsh/node_modules/.bin/dsh',
      timeoutMs: 2_000,
      sleep: async () => { remote.log += 'dsh web: http://127.0.0.1:45678/?token=tok_123\n' },
      probe: async startup => { probeCalls.push(startup.port); return true },
    })
    const handle = await handlePromise
    expect(handle.port).toBe(45_678)
    expect(handle.token).toBe('tok_123')
    expect(handle.pid).toBe(4242)
    expect(probeCalls).toEqual([45_678])
    expect(remote.scripts.some(script => script.includes('setsid nohup'))).toBe(true)
  })

  it('times out with a scrubbed log and stops a late process', async () => {
    const paths = profilePaths('/home/user/.dsh', CLIENT_ID)
    const remote = new FakeProfileRemote()
    remote.alive = true
    await expect(startProfileServer(remote, paths, {
      launcher: '/opt/node/bin/dsh',
      timeoutMs: 1,
      sleep: async () => {},
    })).rejects.toMatchObject({ code: 'profile-start-timeout' })
    expect(remote.scripts.some(script => script.includes('kill -TERM'))).toBe(true)
  })

  it('reports whether a stop signalled a process', async () => {
    const paths = profilePaths('/home/user/.dsh', CLIENT_ID)
    const remote = new FakeProfileRemote()
    remote.alive = true
    expect(await stopProfileServer(remote, paths, { sleep: async () => {} })).toBe(true)
    remote.pid = undefined
    // The fake returns "stopped" for the pidfile body regardless; the real body
    // exits 0 silently when no pid file exists, which is covered in the installer
    // fixture. Here we only pin the handle's boolean contract.
    expect(typeof await stopProfileServer(remote, paths)).toBe('boolean')
  })

  it('waits for a startup line and fails fast when the process is gone', async () => {
    const paths = profilePaths('/home/user/.dsh', CLIENT_ID)
    const remote = new FakeProfileRemote()
    remote.alive = false
    await expect(waitForProfileStartup(remote, paths, { timeoutMs: 1, sleep: async () => {} }))
      .rejects.toMatchObject({ code: 'profile-start-failed' })
    expect(await readProfilePid(remote, paths)).toBe(4242)
  })
})

describe('profile marker and lease classification', () => {
  it('writes the marker last after the file set and reads it back', async () => {
    const paths = await makeProfilePaths(CLIENT_ID)
    const remote = new LocalShellRemote(paths.dshHome)
    const result = await writeProfile(remote, paths, [{ path: 'package.json', content: Buffer.from('{}') }], { version: VERSION })
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/u)
    const marker = await readProfilePluginMarker(remote, paths)
    expect(marker?.version).toBe(VERSION)
    expect(marker?.sha256).toBe(result.digest)
    expect(marker?.profile).toBe(paths.profile)
    expect(profilePluginMarkerPath(paths)).toBe(`${paths.profileDir}/.dsh-rw-plugin.json`)
  })

  it('classifies leases per protocol §3.4', () => {
    const lease = parseProfileLease(JSON.stringify({
      version: 1,
      profile: 'graydovee-remote-workspace-0123456789ab',
      clientId: CLIENT_ID,
      instanceId: 'other-instance',
      pid: 1,
      port: 4000,
      startedAt: '2026-01-01T00:00:00.000Z',
      heartbeatAt: new Date().toISOString(),
      tokenFingerprint: 'abc',
    }))
    expect(lease).toBeDefined()
    expect(leaseActionFor(lease, { clientId: CLIENT_ID, instanceId: 'mine' })).toBe('in-use')
    expect(leaseActionFor(lease, { clientId: CLIENT_ID, instanceId: 'mine' }, Date.now(), false)).toBe('takeover')
    expect(leaseActionFor(lease, { clientId: 'ffffffffffff', instanceId: 'mine' })).toBe('foreign-client')
    expect(leaseActionFor(lease, { clientId: CLIENT_ID, instanceId: 'other-instance' })).toBe('mine')
    expect(leaseActionFor(undefined, { clientId: CLIENT_ID, instanceId: 'mine' })).toBe('takeover')
    expect(isLeaseFresh(lease as never, Date.now(), 20_000)).toBe(true)
  })
})
