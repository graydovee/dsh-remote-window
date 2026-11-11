/**
 * Windows command construction for a Windows server target.
 *
 * A Windows OpenSSH session runs one command through `cmd.exe /c "<command>"` (or
 * through PowerShell when that is the configured default shell), so the command
 * string has only two reliable properties: it is short enough for the command
 * line limit and it survives `cmd` quoting. Everything else about a Windows
 * deployment is therefore expressed as a **PowerShell script** that travels on
 * the channel's stdin as base64:
 *
 * - no quoting layer sees the script, so paths with spaces, `'`, `"`, `&` or
 *   non-ASCII characters are safe;
 * - the byte count is bounded by the transport, not by `CreateProcess`'s 8191
 *   character command line (the scan and the runtime installer both exceed it);
 * - the host side stays ASCII-only, so no console code page can corrupt it.
 *
 * Output that the host has to *parse* is emitted as base64 for the same reason
 * (a Windows log file is UTF-16LE, and `execRemote` decodes stdout as UTF-8), so
 * {@link decodeWindowsBytes} is the only place that guesses an encoding.
 */

/**
 * The wrapper that pulls a base64 PowerShell script from stdin and runs it.
 *
 * It is shipped with `-EncodedCommand`, never inline: the remote command line is
 * parsed by `cmd.exe` *or* by PowerShell depending on the machine's default
 * shell, and PowerShell interpolates `$` inside a double-quoted `-Command`. A
 * first real-machine run proved that: `$b` was expanded to nothing and the
 * wrapper reached PowerShell as `=[Console]::In.ReadToEnd()`. Encoding the
 * wrapper removes every shell metacharacter from argv.
 */
const STDIN_WRAPPER = [
  // Multi-statement, no nesting: an earlier one-liner with `Write((Invoke-Expression (…)))`
  // was rejected by Windows PowerShell 5.1 ("Try 语句缺少必需的 Catch 或 Finally 块")
  // even though the parentheses balanced — a real-machine failure, not a guess.
  '$b = [Console]::In.ReadToEnd()',
  '$t = [Convert]::FromBase64String($b.Trim())',
  '$s = [Text.Encoding]::Unicode.GetString($t)',
  'Invoke-Expression $s',
].join('; ')

/** `STDIN_WRAPPER` as `-EncodedCommand` wants it: base64 of UTF-16LE source. */
const STDIN_WRAPPER_ENCODED = Buffer.from(STDIN_WRAPPER, 'utf16le').toString('base64')

/** One command plus the stdin payload that carries its script. */
export interface WindowsCommand {
  /** The argv the transport executes; ASCII only, no quotes, no spaces in paths. */
  readonly command: string
  /** Base64 of the UTF-16LE script, when it travels on stdin instead of argv. */
  readonly stdin?: string
}

/**
 * Wrap one PowerShell script for transport.
 *
 * `powershell.exe` is addressed by bare name on purpose: OpenSSH on Windows puts
 * `C:\\Windows\\System32\\WindowsPowerShell\\v1.0` on the session's `PATH`, and a
 * hard-coded absolute path would break a Windows installed under another drive
 * (`D:\\Windows`). The command is pure ASCII with no `$`, quotes or spaces apart
 * from the script's own payload, so both `cmd.exe` and PowerShell accept it.
 * @param script - a PowerShell body, ASCII only.
 * @returns the command and its stdin payload.
 */
/**
 * A PowerShell payload travels in argv while it fits the Windows command line.
 *
 * The stdin wrapper is fine for megabytes, but on the real Windows server it
 * intermittently produced **no output at all** for the ~5 KB scan script while
 * the same script as `-EncodedCommand` answered in ~1.2 s, every time. Windows
 * caps a command line at 32 KiB, so anything that fits goes in argv and only the
 * genuinely large payloads (installers) keep using stdin.
 */
const INLINE_PAYLOAD_LIMIT = 28_000

/**
 * Console output is UTF-8, always.
 *
 * ssh2 decodes every byte as UTF-8; PowerShell 5.1 otherwise writes stderr in
 * the ANSI code page, so a localized error ("cannot bind argument to parameter",
 * in Chinese) reached the UI as mojibake. The prelude is prepended to every
 * script instead of being a caller's concern.
 */
export const WINDOWS_OUTPUT_ENCODING_PRELUDE = '[Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; '

export function windowsCommand(script: string): WindowsCommand {
  const encoded = Buffer.from(WINDOWS_OUTPUT_ENCODING_PRELUDE + script, 'utf16le').toString('base64')
  if (encoded.length <= INLINE_PAYLOAD_LIMIT) {
    return { command: `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}` }
  }
  return {
    command: `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${STDIN_WRAPPER_ENCODED}`,
    stdin: encoded,
  }
}

/** Quote one value as a PowerShell single-quoted literal. */
export function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * Decode bytes produced by a Windows process.
 *
 * `Start-Process -RedirectStandardOutput` writes UTF-16LE, `cmd.exe` built-ins
 * write the OEM code page and `node` writes UTF-8; only the first two shapes are
 * distinguishable without a code-page table (BOM, or NUL-interleaved ASCII), and
 * the token line this plugin parses is pure ASCII either way.
 * @param bytes - raw bytes from the channel or from a base64 read.
 * @returns the decoded text, BOM removed.
 */
export function decodeWindowsBytes(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le')
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.subarray(3).toString('utf8')
  // No BOM and every second byte is NUL: UTF-16LE ASCII (the redirect case).
  if (bytes.length >= 4 && bytes[1] === 0 && bytes[3] === 0) return bytes.toString('utf16le')
  return bytes.toString('utf8')
}

/** The one PowerShell prologue every script of this module shares. */
const PRELUDE = [
  "$ErrorActionPreference = 'Stop'",
  // Windows PowerShell 5.1 formats errors with the console code page; the host
  // only ever parses ASCII records, so keep the surface predictable.
  '$ProgressPreference = \'SilentlyContinue\'',
  '$T = [char]9',
  '$NL = [char]10',
].join('\n')

/**
 * The read-only Windows scan script.
 *
 * Emits the exact TAB record format `parseDshScanOutput` already parses, so the
 * host has one parser for both shells. `UNAME` reports `Windows`: the parser and
 * `parseRemotePlatform` use it to tell this dialect from a POSIX one; `OSTYPE`
 * and `LDD` are empty because neither exists here.
 * @param options - optional `DSH_HOME` override (the target's configured value).
 */
export function windowsScanScript(options: { dshHome?: string } = {}): string {
  const override = (options.dshHome ?? '').trim().replace(/\\+$/u, '')
  const lines = [
    PRELUDE,
    'try {',
    '  $records = New-Object System.Collections.Generic.List[string]',
    "  $records.Add('@@RW@@SCAN@@1')",
    '  $homeDir = [string]$env:USERPROFILE',
    override === ''
      ? "  if ([string]::IsNullOrEmpty($env:DSH_HOME)) { $dshHome = Join-Path $homeDir '.dsh' } else { $dshHome = [string]$env:DSH_HOME }"
      : `  $dshHome = ${psQuote(override)}`,
    "  $records.Add('HOME' + $T + $homeDir)",
    "  $records.Add('DSHHOME' + $T + $dshHome)",
    "  $records.Add('UNAME' + $T + 'Windows')",
    "  $records.Add('MACHINE' + $T + [string]$env:PROCESSOR_ARCHITECTURE)",
    "  $records.Add('OSTYPE' + $T)",
    "  $records.Add('LDD' + $T)",
    "  foreach ($tool in @('tar', 'curl', 'sha256sum')) {",
    '    $found = Get-Command $tool -ErrorAction SilentlyContinue',
    "    if ($null -ne $found -and -not [string]::IsNullOrEmpty($found.Source)) { $records.Add('TOOL' + $T + $tool + $T + [string]$found.Source) }",
    '  }',
    '  $nodeCandidates = New-Object System.Collections.Generic.List[string]',
    '  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue',
    '  if ($null -ne $nodeCommand -and -not [string]::IsNullOrEmpty($nodeCommand.Source)) { $nodeCandidates.Add([string]$nodeCommand.Source) }',
    "  $nodeCandidates.Add((Join-Path $dshHome 'dsh-runtimes\\dsh-primary-runtime\\dependencies\\node\\bin\\node.exe'))",
    "  if (-not [string]::IsNullOrEmpty($env:ProgramFiles)) { $nodeCandidates.Add((Join-Path $env:ProgramFiles 'nodejs\\node.exe')) }",
    '  $seenNode = @{}',
    '  foreach ($candidate in $nodeCandidates) {',
    "    if ([string]::IsNullOrEmpty($candidate) -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }",
    '    $resolved = (Resolve-Path -LiteralPath $candidate).Path',
    '    if ($seenNode.ContainsKey($resolved)) { continue }',
    '    $seenNode[$resolved] = $true',
    "    $version = ''",
    "    try { $version = [string](& $resolved -v 2>$null | Select-Object -First 1) } catch { $version = '' }",
    "    $records.Add('NODE' + $T + $resolved + $T + $version)",
    '  }',
    // dsh launchers: PATH first, then the two layouts this plugin knows about —
    // a global npm/pnpm install and the DSH desktop app's bundled CLI.
    '  $launcherCandidates = New-Object System.Collections.Generic.List[string]',
    '  $dshCommand = Get-Command dsh -ErrorAction SilentlyContinue',
    '  if ($null -ne $dshCommand -and -not [string]::IsNullOrEmpty($dshCommand.Source)) { $launcherCandidates.Add([string]$dshCommand.Source) }',
    '  foreach ($name in @(\'dsh.cmd\', \'dsh.exe\')) {',
    "    if (-not [string]::IsNullOrEmpty($env:APPDATA)) { $launcherCandidates.Add((Join-Path $env:APPDATA ('npm\\' + $name))) }",
    "    if (-not [string]::IsNullOrEmpty($env:ProgramFiles)) { $launcherCandidates.Add((Join-Path $env:ProgramFiles ('nodejs\\' + $name))) }",
    "    if (-not [string]::IsNullOrEmpty($env:LOCALAPPDATA)) { $launcherCandidates.Add((Join-Path $env:LOCALAPPDATA ('Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\' + $name))) }",
    '  }',
    "  $launcherCandidates.Add((Join-Path $dshHome 'server\\dsh\\node_modules\\.bin\\dsh.cmd'))",
    '  $seenLauncher = @{}',
    '  foreach ($candidate in $launcherCandidates) {',
    "    if ([string]::IsNullOrEmpty($candidate) -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }",
    '    $resolved = (Resolve-Path -LiteralPath $candidate).Path',
    '    if ($seenLauncher.ContainsKey($resolved)) { continue }',
    '    $seenLauncher[$resolved] = $true',
    "    $version = ''",
    '    $code = 0',
    '    $job = $null',
    '    try {',
    "      $job = Start-Job -ScriptBlock { param($path) & $path --version } -ArgumentList $resolved",
    // Five candidates on a 60 s exec budget: a 15 s wait each could exhaust it
    // before the scan even reached the profile section.
    '      if (Wait-Job -Job $job -Timeout 5) {',
    "        $version = [string]((Receive-Job -Job $job 2>$null | Select-Object -First 1))",
    '      } else { $code = 124 }',
    '    } catch { $code = 127 }',
    '    if ($null -ne $job) { Remove-Job -Job $job -Force -ErrorAction SilentlyContinue }',
    "    $records.Add('DSH' + $T + $resolved + $T + $resolved + $T + $version + $T + [string]$code + $T)",
    '  }',
    // Profiles: name + our marker's plugin version/digest, exactly like POSIX.
    "  $profilesRoot = Join-Path $dshHome 'profiles'",
    '  if (Test-Path -LiteralPath $profilesRoot -PathType Container) {',
    '    foreach ($profileDir in (Get-ChildItem -LiteralPath $profilesRoot -Directory -ErrorAction SilentlyContinue)) {',
    "      $pluginVersion = ''",
    "      $pluginSha = ''",
    "      $manifest = Join-Path $profileDir.FullName 'node_modules\\dsh-remote-workspace\\package.json'",
    '      if (Test-Path -LiteralPath $manifest -PathType Leaf) {',
    '        try { $pluginVersion = [string]((Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).version) } catch { $pluginVersion = \'\' }',
    '      }',
    "      $markerFile = Join-Path $profileDir.FullName '.dsh-rw-plugin.json'",
    '      if (Test-Path -LiteralPath $markerFile -PathType Leaf) {',
    '        try { $pluginSha = [string]((Get-Content -LiteralPath $markerFile -Raw | ConvertFrom-Json).sha256) } catch { $pluginSha = \'\' }',
    '      }',
    "      $records.Add('PLUGIN' + $T + [string]$profileDir.Name + $T + $pluginVersion + $T + $pluginSha)",
    '    }',
    '  }',
    "  $componentMarker = Join-Path $dshHome 'server\\.components\\plugin.json'",
    '  if (Test-Path -LiteralPath $componentMarker -PathType Leaf) {',
    "    $raw = ''",
    "    try { $raw = [string](Get-Content -LiteralPath $componentMarker -Raw) } catch { $raw = '' }",
    "    if ($raw.Length -gt 400) { $raw = $raw.Substring(0, 400) }",
    "    $raw = $raw.Replace([string][char]10, '').Replace([char]9, ' ')",
    "    $records.Add('MARKER' + $T + $componentMarker + $T + $raw)",
    '  }',
    "  $records.Add('END')",
    '  [Console]::Out.Write([string]::Join($NL, $records) + $NL)',
    '} catch {',
    '  [Console]::Error.Write(($_ | Out-String))',
    '  exit 1',
    '}',
  ]
  return lines.join('\n')
}

/**
 * Make the given remote directories exist (`mkdir -p`).
 * @param dirs - absolute Windows paths.
 */
export function windowsMkdirScript(dirs: readonly string[]): string {
  const list = dirs.map(psQuote).join(', ')
  return [PRELUDE, `foreach ($d in @(${list})) { [IO.Directory]::CreateDirectory($d) | Out-Null }`, "Write-Output 'ok'"].join('\n')
}

/**
 * Read one remote file and print its bytes as base64.
 *
 * A missing file prints `MISSING` and exits 3, so callers can tell "absent" from
 * "empty" without a second round trip.
 * @param path - absolute Windows path.
 */
export function windowsReadBytesScript(path: string): string {
  return [
    PRELUDE,
    `$path = ${psQuote(path)}`,
    'if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { [Console]::Out.Write(\'MISSING\'); exit 3 }',
    // `[IO.File]::ReadAllBytes` asks for read-exclusive sharing, and the profile
    // log is held open for append by the running server (`cmd >> log`), so a
    // plain read fails with an IOException and the caller sees an empty log
    // forever. Open the file with `FileShare::ReadWrite` and copy it out.
    '$stream = $null',
    '$memory = $null',
    'try {',
    '  $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)',
    '  $memory = New-Object System.IO.MemoryStream',
    '  $buffer = New-Object byte[] 65536',
    '  while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) { $memory.Write($buffer, 0, $read) }',
    '  [Console]::Out.Write([Convert]::ToBase64String($memory.ToArray()))',
    '} finally {',
    '  if ($memory -ne $null) { $memory.Dispose() }',
    '  if ($stream -ne $null) { $stream.Dispose() }',
    '}',
  ].join('\n')
}

/**
 * Write one remote file from bytes supplied by the host.
 *
 * The bytes travel as base64 *inside* the script rather than as a separate SFTP
 * upload: the profile file set is small (a few KiB) and a single round trip keeps
 * the "write then verify" ordering of the POSIX path. The parent directory is
 * created first so a profile that does not exist yet needs no second call.
 * @param path - absolute Windows path.
 * @param content - file bytes.
 */
export function windowsWriteBytesScript(path: string, content: Buffer): string {
  return [
    PRELUDE,
    `$path = ${psQuote(path)}`,
    '$parent = [IO.Path]::GetDirectoryName($path)',
    'if (-not [string]::IsNullOrEmpty($parent)) { [IO.Directory]::CreateDirectory($parent) | Out-Null }',
    `[IO.File]::WriteAllBytes($path, [Convert]::FromBase64String(${psQuote(content.toString('base64'))}))`,
    "Write-Output 'ok'",
  ].join('\n')
}

/** Everything the Windows start script needs. */
export interface WindowsStartOptions {
  readonly profileDir: string
  readonly stateDir: string
  readonly logPath: string
  readonly pidPath: string
  readonly dshHome: string
  /** `node.exe` of the runtime (or of the global dsh installation). */
  readonly nodeExe: string
  /** The tree that contains `node_modules/@deepseek-ai/dsh` (isolated: `<root>\dsh`). */
  readonly dshRoot: string
  /**
   * `.cmd` shim of a reused global DSH. `dshRoot` is then the shim's directory,
   * which has no `node_modules/@deepseek-ai/dsh` for the desktop app's bundled
   * CLI; the shim carries its own interpreter and entry point.
   */
  readonly launcherShim?: string
  readonly profile: string
  /** Keep `127.0.0.1` and `0`: the profile server must never listen publicly. */
  readonly host: string
  readonly port: number
  readonly pathPrefixes: readonly string[]
  readonly env?: NodeJS.ProcessEnv
}

/**
 * Start the profile server detached and print its PID.
 *
 * `node.exe` is launched directly, not through the package's `.cmd` shim: with
 * `-RedirectStandardOutput` PowerShell cannot start a batch file (the shim would
 * need `cmd.exe /c`, and that makes the tracked PID the shell's, so a stop would
 * orphan the real server). The CLI entry is read from the installed package
 * manifest, which is exactly what the shim would have done.
 *
 * The token is *not* printed here — it is read back from the log with the same
 * `dsh web: http://127.0.0.1:<port>/?token=<token>` line the POSIX path uses.
 * `-RedirectStandardOutput` writes UTF-16LE, which `decodeWindowsBytes` handles.
 */
export function windowsStartScript(options: WindowsStartOptions): string {
  const envEntries = Object.entries(options.env ?? {}).filter(([name]) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))
  const launchArgs = [
    "'--profile'", psQuote(options.profile),
    "'--host'", psQuote(options.host),
    "'--port'", psQuote(String(options.port)),
    "'--no-open'",
  ].join(', ')
  return [
    PRELUDE,
    `$profileDir = ${psQuote(options.profileDir)}`,
    `$stateDir = ${psQuote(options.stateDir)}`,
    `$logPath = ${psQuote(options.logPath)}`,
    `$pidPath = ${psQuote(options.pidPath)}`,
    `$dshHome = ${psQuote(options.dshHome)}`,
    `$nodeExe = ${psQuote(options.nodeExe)}`,
    `$dshRoot = ${psQuote(options.dshRoot)}`,
    `$shimPath = ${psQuote(options.launcherShim ?? '')}`,
    'foreach ($d in @($profileDir, $stateDir)) { [IO.Directory]::CreateDirectory($d) | Out-Null }',
    // A previous instance may still hold the log open; a locked log must never
    // abort the launch (the wrapper appends, so stale tail lines are harmless).
    "if (Test-Path -LiteralPath $logPath -PathType Leaf) { try { Remove-Item -LiteralPath $logPath -Force -ErrorAction Stop } catch { } }",
    "if (Test-Path -LiteralPath ($logPath + '.err') -PathType Leaf) { try { Remove-Item -LiteralPath ($logPath + '.err') -Force -ErrorAction Stop } catch { } }",
    "$manifest = Join-Path $dshRoot 'node_modules\\@deepseek-ai\\dsh\\package.json'",
    // Two launch shapes: a package tree started through `node.exe`, and a global
    // DSH whose `.cmd` shim carries its own interpreter and entry point.
    'if (Test-Path -LiteralPath $manifest -PathType Leaf) {',
    "  if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) { [Console]::Error.Write('the runtime has no node.exe'); exit 20 }",
    '  $package = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json',
    '  $bin = $package.bin',
    '  $entry = $null',
    '  if ($bin -is [string]) { $entry = $bin } elseif ($null -ne $bin -and $null -ne $bin.dsh) { $entry = [string]$bin.dsh }',
    "  if ([string]::IsNullOrEmpty($entry)) { [Console]::Error.Write('the dsh package declares no bin entry'); exit 22 }",
    // `[IO.Path]::GetDirectoryName` instead of `Split-Path -LiteralPath … -Parent`:
    // PowerShell 5.1 rejects that pair with AmbiguousParameterSet (real-machine run).
    '  $binScript = Join-Path ([IO.Path]::GetDirectoryName($manifest)) $entry',
    "  if (-not (Test-Path -LiteralPath $binScript -PathType Leaf)) { [Console]::Error.Write('the dsh bin entry is missing'); exit 23 }",
    `  $launch = '"' + $nodeExe + '" "' + $binScript + '"'`,
    '} elseif (-not [string]::IsNullOrEmpty($shimPath) -and (Test-Path -LiteralPath $shimPath -PathType Leaf)) {',
    `  $launch = 'call "' + $shimPath + '"'`,
    '} else {',
    "  [Console]::Error.Write('the dsh package is not installed under the runtime'); exit 21",
    '}',
    '$env:DSH_HOME = $dshHome',
    `$prefixes = @(${options.pathPrefixes.map(psQuote).join(', ')})`,
    "if ($prefixes.Count -gt 0) { $env:PATH = ([string]::Join(';', $prefixes) + ';' + [string]$env:PATH) }",
    ...envEntries.map(([name, value]) => `$env:${name} = ${psQuote(value ?? '')}`),
    // The redirect must happen in `cmd.exe`, not in PowerShell: a
    // `Start-Process -RedirectStandardOutput` stream is buffered, so the server's
    // startup line did not reach `server.log` while the process was alive and the
    // readiness poll timed out on the first real-machine run. `cmd /c file.cmd`
    // hands the child's stdout straight to the file.
    `$cmdFile = Join-Path $stateDir ${psQuote('start-' + options.profile + '.cmd')}`,
    '$lines = New-Object System.Collections.Generic.List[string]',
    "[void]$lines.Add('@echo off')",
    `[void]$lines.Add(${psQuote('set "DSH_HOME=' + options.dshHome + '"')})`,
    "if ($prefixes.Count -gt 0) { [void]$lines.Add('set \"PATH=' + [string]::Join(';', $prefixes) + ';%PATH%\"') }",
    ...envEntries.map(([name, value]) => `[void]$lines.Add(${psQuote(`set "${name}=${value ?? ''}"`)})`),
    `[void]$lines.Add($launch + ' --profile ' + ${psQuote(options.profile)} + ' --host ' + ${psQuote(options.host)} + ' --port ' + ${psQuote(String(options.port))} + ' --no-open >> "' + $logPath + '" 2>&1')`,
    '[IO.File]::WriteAllText($cmdFile, (($lines -join ([string][char]13 + [char]10)) + [char]13 + [char]10))',
    // `Start-Process` inherits the SSH session's job object, so the profile died
    // the moment our exec channel closed (real-machine run). A Win32_Process
    // created by the WMI service is not in that job: it survives the session.
    "$commandLine = [string]$env:ComSpec + ' /c \"' + $cmdFile + '\"'",
    '$created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine }',
    "if ($created.ReturnValue -ne 0) { [Console]::Error.Write('the profile process could not be created'); exit 24 }",
    '$processId = [int]$created.ProcessId',
    '[IO.File]::WriteAllText($pidPath, ([string]$processId + [char]10))',
    '[Console]::Out.Write([string]$processId + [char]10)',
  ].join('\n')
}

/**
 * Stop the profile server described by its PID file.
 *
 * The command line must still name the deployed runtime *and* the profile: a
 * recycled PID would otherwise kill an unrelated process. Prints `stopped`,
 * `absent` (no PID file) or `mismatch` (PID reused).
 * @param options - PID file, the exact substrings to match, and the grace budget.
 */
export function windowsStopScript(options: {
  readonly pidPath: string
  readonly logPath: string
  readonly launcherMarker: string
  readonly profileMarker: string
  readonly timeoutMs: number
}): string {
  const attempts = Math.max(1, Math.round(options.timeoutMs / 200))
  return [
    PRELUDE,
    `$pidPath = ${psQuote(options.pidPath)}`,
    'if (-not (Test-Path -LiteralPath $pidPath -PathType Leaf)) { [Console]::Out.Write(\'absent\'); exit 0 }',
    '$text = ([IO.File]::ReadAllText($pidPath)).Trim()',
    "if ($text -notmatch '^[0-9]+$') { Remove-Item -LiteralPath $pidPath -Force; [Console]::Out.Write('absent'); exit 0 }",
    '$processId = [int]$text',
    '$process = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $text) -ErrorAction SilentlyContinue',
    'if ($null -eq $process) { Remove-Item -LiteralPath $pidPath -Force; [Console]::Out.Write(\'stopped\'); exit 0 }',
    '$commandLine = [string]$process.CommandLine',
    // The recorded PID is the `cmd.exe` that owns the profile's `start-*.cmd`
    // wrapper, so the identity check is that wrapper's name and the kill must take
    // the whole tree (`/T`): the node server is a grandchild of this process.
    `if ($commandLine -notlike ${psQuote(`*start-${options.profileMarker}.cmd*`)}) { [Console]::Out.Write('mismatch'); exit 4 }`,
    '& $env:ComSpec /c taskkill /PID $processId /T /F | Out-Null',
    `for ($attempt = 0; $attempt -lt ${String(attempts)}; $attempt++) {`,
    '  Start-Sleep -Milliseconds 200',
    '  if ($null -eq (Get-Process -Id $processId -ErrorAction SilentlyContinue)) { break }',
    '}',
    'if ($null -ne (Get-Process -Id $processId -ErrorAction SilentlyContinue)) { Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue; [Console]::Out.Write(\'running\'); exit 5 }',
    'Remove-Item -LiteralPath $pidPath -Force',
    "if (Test-Path -LiteralPath ($logPath + '.err') -PathType Leaf) { Remove-Item -LiteralPath ($logPath + '.err') -Force -ErrorAction SilentlyContinue }",
    "[Console]::Out.Write('stopped')",
  ].join('\n')
}

/**
 * Whether one PID is alive.
 *
 * Liveness only: the *stop* path additionally verifies the command line, but a
 * readiness poll must not pay for a WMI query on every tick. A recycled PID can
 * therefore look alive here for one polling window; `windowsStopScript` refuses to
 * kill it, so the worst case is a slower, accurate failure instead of a wrong kill.
 * @param pid - the process id taken from the remote pid file.
 */
export function windowsPidAliveScript(pid: number): string {
  return [
    PRELUDE,
    `if ($null -eq (Get-Process -Id ${String(pid)} -ErrorAction SilentlyContinue)) { [Console]::Out.Write('dead'); exit 0 }`,
    "[Console]::Out.Write('alive')",
  ].join('\n')
}

/**
 * Install one isolated runtime from an uploaded tarball.
 *
 * Mirrors the POSIX contract: verify sha256, extract into staging, prove
 * `node.exe -v` and the dsh launcher, swap both directories, write the marker
 * last, remove the staging copy. The Windows Node distribution has no
 * `bin/node`, and the runtime launcher is the `.cmd` shim pnpm generates for
 * Windows, so the layout checks differ from POSIX — the *artifact* layout stays
 * `node/` + `dsh/` in both.
 */
export function windowsRuntimeInstallScript(options: {
  readonly root: string
  readonly stagingDir: string
  readonly tarballName: string
  readonly markerPath: string
  readonly markerJson: string
  readonly sha256: string
}): string {
  const stage = `${options.stagingDir}\\runtime`
  const tarball = `${options.stagingDir}\\${options.tarballName}`
  const nodeExe = `${stage}\\node\\node.exe`
  const launcher = `${stage}\\dsh\\node_modules\\.bin\\dsh.cmd`
  const launcherAlt = `${stage}\\dsh\\node_modules\\.bin\\dsh`
  return [
    PRELUDE,
    `$tarball = ${psQuote(tarball)}`,
    `$stage = ${psQuote(stage)}`,
    `$root = ${psQuote(options.root)}`,
    'if (-not (Test-Path -LiteralPath $tarball -PathType Leaf)) { [Console]::Error.Write(\'runtime artifact missing\'); exit 10 }',
    `$hash = (Get-FileHash -LiteralPath $tarball -Algorithm SHA256).Hash.ToLowerInvariant()`,
    `if ($hash -ne ${psQuote(options.sha256.toLowerCase())}) { [Console]::Error.Write('runtime sha256 mismatch'); exit 11 }`,
    'if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }',
    'foreach ($d in @($stage, $root)) { [IO.Directory]::CreateDirectory($d) | Out-Null }',
    // bsdtar is the Windows built-in tar (Windows 10 1803+); there is no POSIX
    // `tar` to fall back to, and `Expand-Archive` cannot read a .tar.gz.
    '& "$env:SystemRoot\\System32\\tar.exe" -xzf $tarball -C $stage',
    'if ($LASTEXITCODE -ne 0) { [Console]::Error.Write(\'tar failed to extract the runtime artifact\'); exit 12 }',
    `if (-not (Test-Path -LiteralPath ${psQuote(nodeExe)} -PathType Leaf)) { [Console]::Error.Write('runtime artifact has no node/node.exe'); exit 13 }`,
    `$launcher = ${psQuote(launcher)}`,
    `if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { $launcher = ${psQuote(launcherAlt)} }`,
    'if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { [Console]::Error.Write(\'runtime artifact has no dsh launcher\'); exit 14 }',
    `$version = (& ${psQuote(nodeExe)} -v 2>$null | Select-Object -First 1)`,
    "if ([string]::IsNullOrEmpty($version)) { [Console]::Error.Write('runtime node did not answer -v'); exit 15 }",
    'foreach ($suffix in @(\'node.new\', \'dsh.new\')) { $p = Join-Path $root $suffix; if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force } }',
    'Move-Item -LiteralPath (Join-Path $stage \'node\') -Destination (Join-Path $root \'node.new\') -Force',
    'Move-Item -LiteralPath (Join-Path $stage \'dsh\') -Destination (Join-Path $root \'dsh.new\') -Force',
    'foreach ($name in @(\'node\', \'dsh\')) { $target = Join-Path $root $name; if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }; Move-Item -LiteralPath (Join-Path $root ($name + \'.new\')) -Destination $target -Force }',
    `[IO.File]::WriteAllText(${psQuote(options.markerPath)}, ${psQuote(`${options.markerJson}\n`)})`,
    'Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue',
    'Remove-Item -LiteralPath $tarball -Force -ErrorAction SilentlyContinue',
    "Write-Output 'installed'",
  ].join('\n')
}

/**
 * Prove the runtime's native `require-builtin` addon still loads.
 *
 * The JavaScript is identical to the POSIX probe (same resolution rules, same
 * exit codes); only the invocation differs, because PowerShell would otherwise
 * parse the script's `$`-free quotes differently from a POSIX shell. The probe
 * text contains no single quote, so {@link psQuote} is enough.
 * @param options - deployed node, the `dsh` install directory and the JS source.
 */
export function windowsNodeEvalScript(options: {
  readonly nodeBin: string
  readonly dshDir: string
  readonly source: string
}): string {
  return [
    PRELUDE,
    `& ${psQuote(options.nodeBin)} -e ${psQuote(options.source)} ${psQuote(options.dshDir)}`,
    "if ($LASTEXITCODE -eq 0) { [Console]::Out.Write('addon-ok'); exit 0 }",
    "if ($LASTEXITCODE -eq 2) { [Console]::Out.Write('addon-app-boot-missing'); exit 2 }",
    '[Console]::Out.Write(\'addon-failed\')',
    'exit 1',
  ].join('\n')
}

/**
 * Install (or replace) the server plugin package into one profile.
 *
 * Mirrors the POSIX script's contract one exit code at a time — the codes are
 * part of the diagnosis surface, so a Windows failure must be as specific as a
 * POSIX one: 10 missing tarball, 11 bad tarball, 12 checksum, 13 name,
 * 14 version, 15 path escape. `tar.exe` (bsdtar) is the only archive tool that
 * ships with Windows and can read a `.tgz`; `Expand-Archive` cannot.
 * @param options - tarball, profile layout, expected identity and checksum.
 */
export function windowsServerPluginInstallScript(options: {
  readonly tarballPath: string
  readonly stageDir: string
  readonly destDir: string
  readonly markerPath: string
  readonly markerJson: string
  readonly expectedName: string
  readonly expectedVersion: string
  readonly expectedSha256?: string
}): string {
  return [
    PRELUDE,
    `$tarball = ${psQuote(options.tarballPath)}`,
    `$stage = ${psQuote(options.stageDir)}`,
    `$dest = ${psQuote(options.destDir)}`,
    'if (-not (Test-Path -LiteralPath $tarball -PathType Leaf)) { [Console]::Error.Write(\'server plugin tarball missing\'); exit 10 }',
    ...(options.expectedSha256 === undefined
      ? []
      : [
          `if ((Get-FileHash -LiteralPath $tarball -Algorithm SHA256).Hash.ToLowerInvariant() -ne ${psQuote(options.expectedSha256.toLowerCase())}) { [Console]::Error.Write('server plugin tarball sha256 mismatch'); exit 12 }`,
        ]),
    'if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }',
    'foreach ($d in @($stage, ([IO.Path]::GetDirectoryName($dest)))) { [IO.Directory]::CreateDirectory($d) | Out-Null }',
    '$tar = Join-Path $env:SystemRoot \'System32\\tar.exe\'',
    // Validate the entry list *before* extracting: tar would otherwise happily
    // write a `..` member or an absolute path outside the staging directory.
    '$entries = @(& $tar -tzf $tarball)',
    'if ($LASTEXITCODE -ne 0) { [Console]::Error.Write(\'server plugin tarball is not readable\'); exit 11 }',
    'foreach ($entry in $entries) { if ($entry -notmatch \'^package(/|$)\') { [Console]::Error.Write(\'server plugin tarball has entries outside package/\'); exit 15 } }',
    'foreach ($entry in $entries) { if ($entry -match \'(^|/)\\.\\.(/|$)\') { [Console]::Error.Write(\'server plugin tarball contains .. path segments\'); exit 15 } }',
    '& $tar -xzf $tarball -C $stage',
    'if ($LASTEXITCODE -ne 0) { [Console]::Error.Write(\'failed to extract the server plugin tarball\'); exit 11 }',
    'if (-not (Test-Path -LiteralPath (Join-Path $stage \'package\\package.json\') -PathType Leaf)) { [Console]::Error.Write(\'server plugin tarball has no package/package.json\'); exit 11 }',
    '$manifest = Get-Content -LiteralPath (Join-Path $stage \'package\\package.json\') -Raw | ConvertFrom-Json',
    `if ([string]$manifest.name -ne ${psQuote(options.expectedName)}) { [Console]::Error.Write(('server plugin package name is ' + [string]$manifest.name)); exit 13 }`,
    `if ([string]$manifest.version -ne ${psQuote(options.expectedVersion)}) { [Console]::Error.Write(('server plugin package version is ' + [string]$manifest.version)); exit 14 }`,
    '$staged = Join-Path $stage \'package\'',
    '$stagedFull = [IO.Path]::GetFullPath($staged)',
    '$stageFull = [IO.Path]::GetFullPath($stage)',
    "if (-not $stagedFull.StartsWith($stageFull, [StringComparison]::Ordinal)) { [Console]::Error.Write('server plugin tarball escaped the staging directory'); exit 15 }",
    'if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }',
    'Move-Item -LiteralPath $staged -Destination $dest -Force',
    `[IO.File]::WriteAllText(${psQuote(options.markerPath)}, ${psQuote(options.markerJson)} + [char]10)`,
    'Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue',
    'Remove-Item -LiteralPath $tarball -Force -ErrorAction SilentlyContinue',
    "Write-Output 'installed'",
  ].join('\n')
}

/**
 * Unwrap PowerShell's CLIXML error envelope.
 *
 * When stderr is redirected (`-EncodedCommand` through ssh), PowerShell wraps
 * every error record in `#< CLIXML … <S S="Error">text</S> …`, which is what the
 * UI would otherwise show verbatim. The inner text is what the user needs.
 */
export function cleanWindowsError(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('#< CLIXML')) return trimmed
  const parts = [...trimmed.matchAll(/<S S="Error">([\s\S]*?)<\/S>/gu)].map(match => match[1] ?? '')
  return parts
    .join('')
    .replaceAll('_x000D_', '')
    .replaceAll('_x000A_', '\n')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .trim()
}
