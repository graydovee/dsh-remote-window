/**
 * The scan must pick the server's dialect before it spends a budget on it.
 *
 * A Windows server parses a POSIX body with PowerShell: the errors are noise and
 * the shell can end up waiting on stdin, which is exactly how the first real
 * Windows connect burned its whole scan budget. These cases pin the cheap probe,
 * the Windows-first order and the single retry.
 */
import { describe, expect, it } from 'vitest'
import { ProfileService, type ProfileConnection, type ProfileConnector } from '../src/provision/profile-service.ts'
import type { ProfileRemote } from '../src/provision/profile-lifecycle.ts'
import type { SshForwarder } from '../src/ssh/forward.ts'
import type { ProfileExecResult } from '../src/provision/profile-lifecycle.ts'
import type { TargetStore } from '../src/targets/store.ts'

const WINDOWS_VER = '\r\nMicrosoft Windows [版本 10.0.26200.9711]\r\n'

/** A remote that answers the scan phase only. */
class ScanRemote implements ProfileRemote {
  readonly scripts: string[] = []
  constructor(private readonly windowsScan: () => ProfileExecResult | Error) {}
  async exec(body: string): Promise<ProfileExecResult> {
    this.scripts.push(body)
    if (body === 'cmd /c ver') return { code: 0, stdout: WINDOWS_VER, stderr: '' }
    if (body.startsWith('powershell.exe')) {
      const answer = this.windowsScan()
      if (answer instanceof Error) throw answer
      return answer
    }
    return { code: 1, stdout: '', stderr: 'sh: 1: Syntax error: "(" unexpected' }
  }
  async writeFile(): Promise<void> {}
}

function fakeStore(): TargetStore {
  let clientId: string | undefined
  const records = new Map<string, never>()
  const target = {
    listTargets: () => [...records.values()],
    target: () => undefined,
    ensureClientId: async () => {
      clientId ??= 'abcdef012345'
      return clientId
    },
    clientId: () => clientId,
    putTarget: async () => {},
    updateTarget: async () => { throw new Error('missing') },
    storeSecret: async <T>(record: T): Promise<T> => record,
    secretOf: async () => undefined,
    credentialKeyOf: () => undefined,
    globalSettings: () => ({ policy: 'auto' as const, mirror: '' }),
    localLlmSettings: () => undefined,
    setLocalLlmSettings: async () => {},
    localLlmKey: async () => undefined,
    storeLocalLlmKey: async () => {},
    forgetLocalLlmKey: async () => {},
  }
  return target as unknown as TargetStore
}

function serviceFor(remote: ProfileRemote): ProfileService {
  const connector: ProfileConnector = {
    connect: async () => ({
      kind: 'ssh' as const,
      remote,
      fingerprint: 'SHA256:fixture',
      forwarder: { open: async () => { throw new Error('unused') }, httpAgent: () => { throw new Error('unused') }, close: () => {} } as unknown as SshForwarder,
      close: async () => {},
    }) as unknown as ProfileConnection,
  }
  return new ProfileService({ store: fakeStore(), packageRoot: '/tmp/client-package', pluginVersion: '0.1.0-alpha.4', connector, cacheDir: '/tmp/cache' })
}

const request = {
  label: 'windows-scan',
  host: '192.0.2.10',
  port: 22,
  username: 'tester',
  authKind: 'password' as const,
  secret: 'fixture',
  hostKeyFingerprint: 'SHA256:fixture',
  modelSource: 'server' as const,
}

const WINDOWS_SCAN = [
  '@@RW@@SCAN@@1',
  'HOME\tC:\\Users\\tester',
  'DSHHOME\tC:\\Users\\tester\\.dsh',
  'UNAME\tWindows',
  'MACHINE\tAMD64',
  'OSTYPE\t',
  'LDD\t',
  'END',
].join('\n')

describe('scan dialect selection', () => {
  it('asks for cmd ver first and never runs the POSIX body on a Windows server', async () => {
    const remote = new ScanRemote(() => ({ code: 0, stdout: WINDOWS_SCAN, stderr: '' }))
    const service = serviceFor(remote)
    // The scan succeeds; the connect then fails later on the missing tarball in
    // this fixture, which is enough to prove which dialect ran.
    await expect(service.connect(request)).rejects.toThrow(/tarball|bundled/u)
    expect(remote.scripts[0]).toBe('cmd /c ver')
    expect(remote.scripts.filter(script => script.startsWith('powershell.exe'))).toHaveLength(1)
    expect(remote.scripts.some(script => script.includes('ZSH_VERSION') || script.includes('set -u\nif'))).toBe(false)
  })

  it('retries the Windows scan once before giving up', async () => {
    let attempts = 0
    const remote = new ScanRemote(() => {
      attempts += 1
      if (attempts === 1) return new Error('remote command timed out')
      return { code: 0, stdout: WINDOWS_SCAN, stderr: '' }
    })
    const service = serviceFor(remote)
    await expect(service.connect(request)).rejects.toThrow(/tarball|bundled/u)
    expect(remote.scripts.filter(script => script.startsWith('powershell.exe'))).toHaveLength(2)
  })

  it('keeps the POSIX scan first when the server does not answer cmd ver', async () => {
    const remote = new ScanRemote(() => ({ code: 0, stdout: '', stderr: '' }))
    const original = remote.exec.bind(remote)
    remote.exec = async (body: string): Promise<ProfileExecResult> => {
      if (body === 'cmd /c ver') {
        remote.scripts.push(body)
        return { code: 127, stdout: '', stderr: 'sh: cmd: not found' }
      }
      return await original(body)
    }
    const service = serviceFor(remote)
    await expect(service.connect(request)).rejects.toThrow(/both dialects|home directory|scan|tarball|bundled/u)
    expect(remote.scripts[0]).toBe('cmd /c ver')
    expect(remote.scripts[1]?.includes('ZSH_VERSION')).toBe(true)
    // The old contract survives for non-Windows servers: a failed POSIX scan still
    // falls back to the Windows probe, which simply answers with nothing here.
    expect(remote.scripts.filter(script => script.startsWith('powershell.exe'))).toHaveLength(1)
  })
})
