/**
 * WSL target primitives: output parsing, argv shape and the platform gate.
 *
 * These are the parts that must be right before any distro is touched, and
 * every one of them is pure — no `wsl.exe` is spawned here.
 */
import { describe, expect, it } from 'vitest'
import { parseWslDistroList, wslCommandArgs, wslScriptArgs } from '../src/ssh/wsl.ts'
import { methodAvailable } from '../src/targets/methods.ts'

/** `wsl.exe -l -v`, already decoded from UTF-16LE (and with its trailing NULs). */
const REAL_LIST = [
  '  NAME            STATE           VERSION',
  '* Ubuntu-22.04    Running         2',
  '  docker-desktop  Running         2',
  '\0\0',
].join('\r\n')

describe('parseWslDistroList', () => {
  it('parses the real table, keeps order and marks the default distro', () => {
    expect(parseWslDistroList(REAL_LIST)).toEqual([
      { name: 'Ubuntu-22.04', state: 'Running', version: 2, default: true },
      { name: 'docker-desktop', state: 'Running', version: 2, default: false },
    ])
  })

  it('keeps a distribution name that contains spaces', () => {
    // Store installs are named "Ubuntu 22.04.3 LTS"; parsing from column offsets
    // would cut the name, so the row is read from its tail.
    const decoded = '  NAME                       STATE     VERSION\n* Ubuntu 22.04.3 LTS        Stopped   2\n'
    expect(parseWslDistroList(decoded)).toEqual([
      { name: 'Ubuntu 22.04.3 LTS', state: 'Stopped', version: 2, default: true },
    ])
  })

  it('accepts a distro that is still installing (no VERSION column)', () => {
    const decoded = '  NAME     STATE\n  Ubuntu   Installing\n'
    expect(parseWslDistroList(decoded)).toEqual([
      { name: 'Ubuntu', state: 'Installing', default: false },
    ])
  })

  it('returns nothing for an empty result or the header alone', () => {
    expect(parseWslDistroList('')).toEqual([])
    expect(parseWslDistroList('  NAME  STATE  VERSION\r\n')).toEqual([])
    expect(parseWslDistroList('\0\0\0')).toEqual([])
  })

  it('strips stray NULs (a UTF-16 read decoded as Latin-1)', () => {
    // Interleave a NUL between every character, the shape a mis-decoded
    // UTF-16LE stream has (code points 85,0,98,0,… as measured).
    const nul = String.fromCharCode(0)
    const decoded = ['  NAME  STATE  VERSION', '* Ubuntu  Running  2']
      .map(line => [...line].join(nul))
      .join('\n')
    expect(parseWslDistroList(decoded)).toEqual([
      { name: 'Ubuntu', state: 'Running', version: 2, default: true },
    ])
  })
})

describe('wsl argv shapes', () => {
  it('feeds scripts on stdin via `sh -s` (a multi-line -c body loses lines)', () => {
    expect(wslScriptArgs('Ubuntu-22.04')).toEqual(['-d', 'Ubuntu-22.04', '--', '/bin/sh', '-s'])
  })

  it('runs one single-line command through `sh -c`', () => {
    expect(wslCommandArgs('Ubuntu-22.04', 'echo hi')).toEqual([
      '-d', 'Ubuntu-22.04', '--', '/bin/sh', '-c', 'echo hi',
    ])
  })

  it('passes the distro user before the separator', () => {
    expect(wslScriptArgs('Ubuntu-22.04', 'root')).toEqual([
      '-d', 'Ubuntu-22.04', '--user', 'root', '--', '/bin/sh', '-s',
    ])
  })

  it('treats an empty user as "the distribution default"', () => {
    expect(wslScriptArgs('Ubuntu-22.04', '')).toEqual(['-d', 'Ubuntu-22.04', '--', '/bin/sh', '-s'])
  })
})

describe('methodAvailable', () => {
  it('offers SSH everywhere and WSL only on Windows', () => {
    for (const platform of ['win32', 'darwin', 'linux']) expect(methodAvailable('ssh', platform)).toBe(true)
    expect(methodAvailable('wsl', 'win32')).toBe(true)
    expect(methodAvailable('wsl', 'darwin')).toBe(false)
    expect(methodAvailable('wsl', 'linux')).toBe(false)
  })

  it('never offers the reserved container method', () => {
    for (const platform of ['win32', 'darwin', 'linux']) expect(methodAvailable('docker', platform)).toBe(false)
  })
})
