import { describe, expect, it } from 'vitest'
import {
  WINDOWS_OUTPUT_ENCODING_PRELUDE,
  decodeWindowsBytes,
  psQuote,
  windowsCommand,
  windowsMkdirScript,
  windowsPidAliveScript,
  windowsReadBytesScript,
  windowsRuntimeInstallScript,
  windowsScanScript,
  windowsServerPluginInstallScript,
  windowsStartScript,
  windowsStopScript,
  windowsWriteBytesScript,
} from '../src/provision/windows-shell.ts'

/** The script a Windows command carries, without the console-encoding prelude. */
const scriptOf = (command: { command?: string; stdin?: string }): string => {
  const raw = command.stdin !== undefined
    ? Buffer.from(command.stdin.trim(), 'base64').toString('utf16le')
    : (() => {
      const payload = /-EncodedCommand (\S+)$/u.exec(command.command ?? '')
      return payload === null ? '' : Buffer.from(payload[1]!, 'base64').toString('utf16le')
    })()
  return raw.startsWith(WINDOWS_OUTPUT_ENCODING_PRELUDE) ? raw.slice(WINDOWS_OUTPUT_ENCODING_PRELUDE.length) : raw
}

describe('windows shell command envelope', () => {
  it('carries a small script as UTF-16LE base64 in argv', () => {
    const command = windowsCommand("Write-Output 'héllo 世界'")
    expect(command.command).toContain('powershell.exe')
    expect(command.command).toContain('-NoProfile')
    expect(command.command).toContain('-NonInteractive')
    expect(command.command).toContain('-ExecutionPolicy Bypass')
    // A payload that fits the 32 KiB command line goes in argv: on the real
    // Windows server the stdin wrapper intermittently produced no output at all
    // for the 5 KB scan while this form answered in ~1.2 s every time.
    expect(command.stdin).toBeUndefined()
    expect(scriptOf(command)).toBe("Write-Output 'héllo 世界'")
  })

  it('moves a payload too large for argv onto stdin', () => {
    const huge = `Write-Output '${'x'.repeat(60_000)}'`
    const command = windowsCommand(huge)
    expect(command.stdin).toBeDefined()
    expect(command.command).not.toContain('-EncodedCommand ' + 'x'.repeat(10))
    expect(scriptOf(command)).toBe(huge)
  })

  it('never puts the script itself on the argv (quoting and code pages)', () => {
    const command = windowsCommand('Write-Output "a & b"; $x = @(1,2)')
    expect(command.command).not.toContain('a & b')
    // The base64 payload must be the only variable part, so no shell re-parse of
    // quotes, `$`, `&`, backticks or non-ASCII can happen on the way in.
    expect(scriptOf(command)).toContain('a & b')
  })

  it('quotes single-quoted literals by doubling', () => {
    expect(psQuote("it's")).toBe("'it''s'")
  })
})

describe('windows byte decoding', () => {
  it('decodes a BOM-less UTF-16LE stream', () => {
    const text = 'dsh web: http://127.0.0.1:1/?token=x'
    expect(decodeWindowsBytes(Buffer.from(text, 'utf16le'))).toBe(text)
  })

  it('decodes UTF-16LE with its BOM', () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('installed', 'utf16le')])
    expect(decodeWindowsBytes(bytes)).toBe('installed')
  })

  it('keeps plain UTF-8 intact', () => {
    expect(decodeWindowsBytes(Buffer.from('installed\n', 'utf8'))).toBe('installed\n')
  })
})

describe('windows scan script', () => {
  const script = windowsScanScript()

  it('emits the same record grammar as the POSIX probe', () => {
    expect(script).toContain('@@RW@@SCAN@@1')
    expect(script).toContain("$records.Add('END')")
    expect(script).toContain("'HOME' + $T + $homeDir")
    expect(script).toContain("'MACHINE' + $T + [string]$env:PROCESSOR_ARCHITECTURE")
  })

  it('reports the Windows launcher layouts it knows about', () => {
    expect(script).toContain("Join-Path $dshHome 'server\\dsh\\node_modules\\.bin\\dsh.cmd'")
    expect(script).toContain('DeepSeek Harness')
    expect(script).toContain('npm\\')
  })

  it('honours an explicit DSH home and reports platform evidence', () => {
    const explicit = windowsScanScript({ dshHome: 'C:\\dsh-rw-qa\\.dsh' })
    expect(explicit).toContain("$dshHome = 'C:\\dsh-rw-qa\\.dsh'")
    expect(explicit).toContain("'UNAME' + $T + 'Windows'")
  })
})

describe('windows runtime and plugin installers', () => {
  it('verifies the archive with Get-FileHash and extracts with tar.exe', () => {
    const script = windowsRuntimeInstallScript({
      root: 'C:\\root',
      stagingDir: 'C:\\stage\\in',
      tarballName: 'dsh-runtime-0.2.1-rc.3-win32-x64.tar.gz',
      markerPath: 'C:\\root\\.dsh-rw-runtime.json',
      markerJson: '{"version":"0.2.1-rc.3"}',
      sha256: 'a'.repeat(64),
    })
    expect(script).toContain('Get-FileHash')
    expect(script).toContain("$env:SystemRoot\\System32\\tar.exe")
    expect(script).toContain('node\\node.exe')
    expect(script).toContain('exit 11')
    expect(script).toContain('exit 13')
    expect(script).toContain('exit 14')
    expect(script).toContain("'installed'")
  })

  it('keeps the server-plugin exit codes one-for-one with POSIX', () => {
    const script = windowsServerPluginInstallScript({
      tarballPath: 'C:\\stage\\p.tgz',
      stageDir: 'C:\\stage\\unpack',
      destDir: 'C:\\profile\\node_modules\\dsh-remote-window-server',
      markerPath: 'C:\\profile\\.dsh-rw-plugin.json',
      markerJson: '{"version":"0.1.0-alpha.4"}',
      expectedName: 'dsh-remote-window-server',
      expectedVersion: '0.1.0-alpha.4',
      expectedSha256: 'b'.repeat(64),
    })
    for (const code of [10, 11, 12, 13, 14, 15]) expect(script).toContain(`exit ${code}`)
    expect(script).toContain('ConvertFrom-Json')
    expect(script).toContain('-notmatch')
  })
})

describe('windows profile lifecycle scripts', () => {
  const options = {
    profileDir: 'C:\\Users\\u\\.dsh\\remote-window\\profiles\\p',
    stateDir: 'C:\\Users\\u\\.dsh\\remote-window\\state',
    logPath: 'C:\\Users\\u\\.dsh\\remote-window\\state\\server.log',
    pidPath: 'C:\\Users\\u\\.dsh\\remote-window\\state\\server.pid',
    dshHome: 'C:\\Users\\u\\.dsh',
    nodeExe: 'C:\\rt\\node\\node.exe',
    dshRoot: 'C:\\rt\\dsh',
    profile: 'p',
    host: '127.0.0.1',
    port: 0,
    pathPrefixes: ['C:\\rt\\node', 'C:\\rt\\dsh\\node_modules\\.bin'],
    env: { DSH_RW_LOCAL_LLM_KEY: 'placeholder' },
  }

  it('launches through a detached cmd wrapper so the startup line is not buffered', () => {
    const script = windowsStartScript(options)
    // PowerShell's `-RedirectStandardOutput` buffers; the wrapper file redirects in
    // cmd instead, which is what made the readiness poll see the startup line.
    expect(script).toContain('Invoke-CimMethod -ClassName Win32_Process -MethodName Create')
    expect(script).toContain("$env:ComSpec + ' /c \"' + $cmdFile + '\"'")
    // Redirection happens inside the wrapper: a PowerShell `-RedirectStandardOutput`
    // would buffer and hide the startup line.
    expect(script).not.toContain('-RedirectStandardOutput')
    expect(script).toContain('start-')
    expect(script).toContain('.cmd')
    expect(script).toContain('--profile')
    expect(script).toContain('--no-open')
    expect(script).toContain('WriteAllText($cmdFile')
    // A missing runtime must fail with a distinct code, not silently.
    expect(script).toContain('exit 20')
    expect(script).toContain('exit 21')
    expect(script).toContain('exit 22')
    expect(script).toContain('exit 23')
  })

  it('joins PATH prefixes with a semicolon and sets the environment before launch', () => {
    const script = windowsStartScript(options)
    expect(script).toContain("[string]::Join(';', $prefixes)")
    expect(script).toContain("$env:DSH_HOME = $dshHome")
    expect(script).toContain("$env:DSH_RW_LOCAL_LLM_KEY = 'placeholder'")
  })

  it('launches a reused global dsh through its shim when the tree carries no package', () => {
    const shim = 'C:\\Users\\u\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd'
    const script = windowsStartScript({
      ...options,
      dshRoot: 'C:\\Users\\u\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin',
      launcherShim: shim,
    })
    expect(script).toContain(`$shimPath = '${shim.replaceAll("'", "''")}'`)
    // The wrapper calls the shim itself; `node.exe` and the package manifest are
    // only consulted when the tree has a `node_modules/@deepseek-ai/dsh`.
    expect(script).toContain(`  $launch = 'call "' + $shimPath + '"'`)
    expect(script).toContain("$launch + ' --profile '")
    expect(script).toContain('exit 21')
  })

  it('stops by pid with a command-line guard against pid reuse', () => {
    const script = windowsStopScript({
      pidPath: options.pidPath,
      logPath: options.logPath,
      launcherMarker: options.dshHome,
      profileMarker: 'p',
      timeoutMs: 5000,
    })
    expect(script).toContain('Get-CimInstance Win32_Process')
    expect(script).toContain('taskkill /PID $processId /T /F')
    expect(script).toContain('start-p.cmd')
    expect(script).toContain("'stopped'")
  })

  it('checks liveness through Get-Process only', () => {
    expect(windowsPidAliveScript(42)).toContain('Get-Process -Id 42')
    expect(windowsPidAliveScript(42)).toContain("'alive'")
  })
})

describe('windows file helpers', () => {
  it('creates every directory in one round trip', () => {
    const script = windowsMkdirScript(['C:\\a', 'C:\\b\\c'])
    expect(script).toContain('[IO.Directory]::CreateDirectory')
    expect(script).toContain("'C:\\a'")
  })

  it('reads a missing file as a distinct marker instead of an error', () => {
    expect(windowsReadBytesScript('C:\\x')).toContain("'MISSING'")
    expect(windowsReadBytesScript('C:\\x')).toContain('exit 3')
  })

  it('writes bytes after creating the parent directory', () => {
    const script = windowsWriteBytesScript('C:\\a\\b.txt', Buffer.from('hi'))
    expect(script).toContain('WriteAllBytes')
    expect(script).toContain('CreateDirectory')
    expect(script).toContain(Buffer.from('hi').toString('base64'))
  })
})
