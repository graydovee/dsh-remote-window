import { describe, expect, it } from 'vitest'
import {
  defaultRemoteDshHome,
  remoteIsAbsolute,
  remoteJoin,
  remoteKindOf,
  remotePlatformOf,
  remoteTrimTrailing,
  runtimePlatformArchOf,
  windowsDirname,
} from '../src/provision/remote-dialect.ts'

const evidence = (platform: string, machine = 'x86_64', ostype = ''): { platform: string; machine: string; ostype: string; ldd: string } =>
  ({ platform, machine, ostype, ldd: '' })

describe('remote dialect detection', () => {
  it('recognises the PowerShell probe and a POSIX shell on Windows', () => {
    expect(remoteKindOf(evidence('Windows', 'AMD64'))).toBe('windows')
    expect(remoteKindOf(evidence('MINGW64_NT-10.0-26200', 'x86_64'))).toBe('windows')
    expect(remoteKindOf(evidence('MSYS_NT-10.0', 'x86_64'))).toBe('windows')
    expect(remoteKindOf(evidence('CYGWIN_NT-10.0', 'x86_64'))).toBe('windows')
  })

  it('keeps every POSIX family on the POSIX path', () => {
    expect(remoteKindOf(evidence('Linux', 'x86_64', 'linux'))).toBe('posix')
    expect(remoteKindOf(evidence('Darwin', 'arm64'))).toBe('posix')
    expect(remoteKindOf(evidence('FreeBSD', 'amd64'))).toBe('posix')
  })

  it('refuses to guess from empty evidence', () => {
    expect(remoteKindOf(evidence('', ''))).toBe('unknown')
    expect(remotePlatformOf(evidence('', ''))).toBe('windows')
    expect(remotePlatformOf(evidence('Linux', 'x86_64', 'linux'))).toBe('posix')
  })

  it('joins paths in the remote dialect, never in the host one', () => {
    expect(remoteJoin('posix', '/home/u/.dsh', 'profiles', 'p')).toBe('/home/u/.dsh/profiles/p')
    expect(remoteJoin('windows', 'C:\\Users\\u\\.dsh', 'profiles', 'p')).toBe('C:\\Users\\u\\.dsh\\profiles\\p')
    expect(windowsDirname('C:\\Users\\u\\.dsh\\server.log')).toBe('C:\\Users\\u\\.dsh')
  })

  it('recognises absolute paths per dialect', () => {
    expect(remoteIsAbsolute('posix', '/home/u/.dsh')).toBe(true)
    expect(remoteIsAbsolute('posix', 'C:\\Users\\u')).toBe(false)
    expect(remoteIsAbsolute('windows', 'C:\\Users\\u\\.dsh')).toBe(true)
    expect(remoteIsAbsolute('windows', '~/.dsh')).toBe(false)
  })

  it('defaults the DSH home to the remote user profile', () => {
    expect(defaultRemoteDshHome('posix', '/home/u')).toBe('/home/u/.dsh')
    expect(defaultRemoteDshHome('posix', '/home/u/')).toBe('/home/u/.dsh')
    expect(defaultRemoteDshHome('windows', 'C:\\Users\\u')).toBe('C:\\Users\\u\\.dsh')
    expect(defaultRemoteDshHome('windows', 'C:\\Users\\u\\')).toBe('C:\\Users\\u\\.dsh')
  })

  it('never trims the root of a drive to an empty string', () => {
    expect(remoteTrimTrailing('windows', 'C:\\Users\\u\\.dsh\\')).toBe('C:\\Users\\u\\.dsh')
    expect(remoteTrimTrailing('windows', 'C:\\')).toBe('C:\\')
  })

  it('keys the artifact matrix by remote evidence, including win32', () => {
    expect(runtimePlatformArchOf(evidence('Windows', 'AMD64'))).toBe('win32-x64')
    expect(runtimePlatformArchOf(evidence('Windows', 'ARM64'))).toBe('win32-arm64')
    expect(runtimePlatformArchOf(evidence('Linux', 'x86_64', 'linux'))).toBe('linux-x64-gnu')
    expect(runtimePlatformArchOf({ platform: 'Linux', machine: 'x86_64', ostype: 'linux', ldd: 'musl libc' })).toBe('linux-x64-musl')
    expect(runtimePlatformArchOf(evidence('Darwin', 'arm64'))).toBe('darwin-arm64')
  })

  it('returns undefined instead of guessing when the evidence is thin', () => {
    expect(runtimePlatformArchOf({ platform: 'Windows', machine: '', ostype: '', ldd: '' })).toBeUndefined()
    expect(runtimePlatformArchOf({ platform: '', machine: 'x86_64', ostype: '', ldd: '' })).toBeUndefined()
  })
})
