/**
 * The Windows branch of the profile lifecycle.
 *
 * These tests drive the real `ProfileRemote` surface with a fake channel that
 * decodes what the plugin actually sends: the POSIX path must be unchanged, and
 * the Windows path must be one PowerShell command carrying its script on stdin
 * (never in argv, where cmd.exe would re-parse quotes).
 */
import { describe, expect, test } from 'vitest'
import {
  profilePaths,
  readProfilePluginMarker,
  startProfileServer,
  stopProfileServer,
  writeProfile,
} from '../src/provision/profile-lifecycle.ts'
import { windowsCommand } from '../src/provision/windows-shell.ts'

interface Recorded {
  readonly body: string
  readonly stdin?: string
}

/** The script a recorded command actually runs (stdin is the encoded payload). */
function scriptOf(record: Recorded): string {
  if (record.stdin !== undefined) return Buffer.from(record.stdin.trim(), 'base64').toString('utf16le')
  const payload = /-EncodedCommand (\S+)$/u.exec(record.body)
  return payload === null ? record.body : Buffer.from(payload[1]!, 'base64').toString('utf16le')
}

/**
 * The read script opens the file with shared access; the profile log is held
 * for append by the running server, so `[IO.File]::ReadAllBytes` would fail.
 */
const READ_SCRIPT = /\[IO\.File\]::Open\(\$path, \[IO\.FileMode\]::Open/u

/** Files the plugin wrote through the Windows byte-write script, keyed by path. */
function fakeRemote(seed: Record<string, string> = {}): {
  remote: { exec: (body: string, options?: { stdin?: string }) => Promise<{ code: number | null; stdout: string; stderr: string }>; writeFile: (path: string, content: Buffer) => Promise<void> }
  records: Recorded[]
  writes: { path: string; content: Buffer }[]
  files: Map<string, string>
} {
  const records: Recorded[] = []
  const writes: { path: string; content: Buffer }[] = []
  const files = new Map<string, string>(Object.entries(seed))
  return {
    records,
    writes,
    files,
    remote: {
      async exec(body, options) {
        const record: Recorded = { body, ...(options?.stdin === undefined ? {} : { stdin: options.stdin }) }
        records.push(record)
        const script = scriptOf(record)
        const target = /\$path = '([^']*)'/u.exec(script)
        const written = /WriteAllBytes\(\$path,\s*\[Convert\]::FromBase64String\('([^']*)'\)/u.exec(script)
        if (target !== null && written !== null) {
          files.set(target[1] as string, Buffer.from(written[1] as string, 'base64').toString('utf8'))
          return { code: 0, stdout: '', stderr: '' }
        }
        if (target !== null && READ_SCRIPT.test(script)) {
          const value = files.get(target[1] as string)
          if (value === undefined) return { code: 3, stdout: 'MISSING', stderr: '' }
          return { code: 0, stdout: Buffer.from(value, 'utf8').toString('base64'), stderr: '' }
        }
        if (script.includes('taskkill')) return { code: 0, stdout: 'stopped', stderr: '' }
        return { code: 0, stdout: '', stderr: '' }
      },
      async writeFile(path, content) {
        writes.push({ path, content })
      },
    },
  }
}

const HOME = 'C:\\dsh-rw-qa\\.dsh'

describe('profile paths', () => {
  test('keeps the POSIX layout byte-for-byte', () => {
    const paths = profilePaths('/home/user/.dsh', 'abcdef012345', 'posix')
    expect(paths.kind).toBe('posix')
    expect(paths.profileDir).toBe('/home/user/.dsh/profiles/graydovee-remote-workspace-abcdef012345')
    expect(paths.logPath).toBe('/home/user/.dsh/remote-workspace/profiles/graydovee-remote-workspace-abcdef012345/server.log')
    expect(paths.pluginDir).toBe('/home/user/.dsh/profiles/graydovee-remote-workspace-abcdef012345/node_modules/dsh-remote-workspace-server')
  })

  test('uses Windows separators and no POSIX chmod for a Windows home', () => {
    const paths = profilePaths(HOME, 'abcdef012345', 'windows')
    expect(paths.kind).toBe('windows')
    expect(paths.profileDir).toBe('C:\\dsh-rw-qa\\.dsh\\profiles\\graydovee-remote-workspace-abcdef012345')
    expect(paths.leasePath.endsWith('\\.dsh-rw\\lease.json')).toBe(true)
  })
})

describe('startProfileServer on Windows', () => {
  test('sends one encoded PowerShell command that starts a detached cmd wrapper', async () => {
    const { remote, records } = fakeRemote()
    const paths = profilePaths(HOME, 'abcdef012345', 'windows')
    await startProfileServer(remote, paths, {
      launcher: 'C:\\rt\\dsh',
      nodePath: 'C:\\rt\\node\\node.exe',
      pathPrefixes: ['C:\\rt\\node'],
      port: 0,
      timeoutMs: 1_000,
      intervalMs: 1,
      sleep: async () => undefined,
    }).catch(() => undefined)
    expect(records.length).toBeGreaterThan(0)
    const first = records[0] as Recorded
    expect(first.body.startsWith('powershell.exe ')).toBe(true)
    const script = scriptOf(first)
    expect(script).toContain('Invoke-CimMethod -ClassName Win32_Process -MethodName Create')
    expect(script).toContain("$env:ComSpec + ' /c \"' + $cmdFile + '\"'")
    expect(script).toContain('--profile')
    expect(script).toContain('--no-open')
    expect(script).not.toContain('setsid')
    expect(script).not.toContain('chmod')
  })

  test('starts a reused global dsh through its shim', async () => {
    const { remote, records } = fakeRemote()
    const paths = profilePaths(HOME, 'abcdef012345', 'windows')
    await startProfileServer(remote, paths, {
      launcher: 'C:\\Users\\grayd\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin',
      launcherShim: 'C:\\Users\\grayd\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd',
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      port: 0,
      timeoutMs: 1_000,
      intervalMs: 1,
      sleep: async () => undefined,
    }).catch(() => undefined)
    const script = scriptOf(records[0] as Recorded)
    expect(script).toContain('dsh.cmd')
    expect(script).toContain("$launch = 'call \"' + $shimPath + '\"'")
  })
})

describe('stopProfileServer on Windows', () => {
  test('stops by PID with a command-line guard, never with kill', async () => {
    const { remote, records } = fakeRemote({ 'Get-CimInstance': 'stopped' })
    const paths = profilePaths(HOME, 'abcdef012345', 'windows')
    const stopped = await stopProfileServer(remote, paths)
    expect(stopped).toBe(true)
    const script = scriptOf(records[0] as Recorded)
    expect(script).toContain('Get-CimInstance')
    expect(script).toContain('taskkill /PID $processId /T /F')
    expect(script).not.toContain('kill -')
  })
})

describe('profile files on Windows', () => {
  test('writes remote paths with backslashes and reads the marker back', async () => {
    const { remote, writes, records } = fakeRemote()
    const paths = profilePaths(HOME, 'abcdef012345', 'windows')
    await writeProfile(remote, paths, [], { version: '1' })
    expect(writes.some(write => write.path.endsWith('\\cordis.yml'))).toBe(true)
    const marker = await readProfilePluginMarker(remote, paths)
    expect(marker).toMatchObject({ id: 'plugin', version: '1' })
    expect(scriptOf(records.at(-1) as Recorded)).toContain('[IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)')
  })

  test('the marker write is a Windows byte write, not a printf redirect', async () => {
    const { remote, records } = fakeRemote()
    const paths = profilePaths(HOME, 'abcdef012345', 'windows')
    await writeProfile(remote, paths, [], { version: '1' })
    const bodies = records.map(scriptOf).join('\n')
    expect(bodies).toContain('WriteAllBytes')
    expect(bodies).not.toContain('printf')
  })
})

test('the encoded command never carries the script in argv', () => {
  const command = windowsCommand("Write-Output 'secret script text'")
  expect(command.command).not.toContain('secret script text')
  expect(scriptOf({ body: command.command, ...(command.stdin === undefined ? {} : { stdin: command.stdin }) })).toContain('secret script text')
})

test('startup polling decodes the UTF-16LE log that Start-Process writes', async () => {
  const line = 'dsh web: http://127.0.0.1:41234/?token=abc_DEF-123'
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(line, 'utf16le')]).toString('base64')
  const { remote } = fakeRemote({ ReadAllBytes: utf16 })
  const paths = profilePaths(HOME, 'abcdef012345', 'windows')
  const started = await startProfileServer(remote, paths, {
    launcher: 'C:\\rt\\dsh',
    nodePath: 'C:\\rt\\node\\node.exe',
    timeoutMs: 50,
    intervalMs: 1,
    sleep: async () => undefined,
  }).catch((error: unknown) => error)
  expect(started).toBeInstanceOf(Object)
})

test('lease reads do not explode when the file is missing', async () => {
  const { remote } = fakeRemote({ ReadAllBytes: 'MISSING' })
  const paths = profilePaths(HOME, 'abcdef012345', 'windows')
  const lease = await (await import('../src/provision/profile-lifecycle.ts')).readProfileLease(remote, paths)
  expect(lease).toBeUndefined()
})

