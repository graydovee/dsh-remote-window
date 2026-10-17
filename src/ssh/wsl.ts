/**
 * Transport timeline logging, enabled with `DSH_RW_DEBUG=1`.
 *
 * Off by default: it prints on every channel, and the questions it answers
 * ("who closed the distro process", "did the command line survive") only come up
 * when something breaks.
 * @param message - line to print.
 */
function debug(message: string): void {
  if (process.env.DSH_RW_DEBUG === '1') console.error(`[dsh-rw] ${message}`)
}

/**
 * WSL transport: a local distro driven through `wsl.exe`.
 *
 * The host-side counterpart of `connect.ts` (ssh2). Everything the deployment
 * needs from "the remote" is a POSIX shell, so the connection is
 * `wsl.exe -d <distro> -- /bin/sh -c <body>` plus a long-lived child process
 * whose stdio carries the protocol channel.
 *
 * Two measured facts shape this module:
 *
 * - `wsl.exe`'s own management output (`-l`, `--version`, `--status`) is
 *   **UTF-16LE**, even for its errors; a command run *inside* the distro prints
 *   UTF-8. Decoding both as UTF-8 yields NUL-interleaved garbage.
 * - Distro names may contain spaces (`Ubuntu 22.04.3 LTS` comes from the Store),
 *   so `-l -v` rows are parsed from the END of the line (STATE, VERSION) instead
 *   of by column offsets.
 *
 * Discovered distros are read with `-l -v` only: that subcommand never starts a
 * distribution, which is why opening a config panel cannot have the side effect
 * of booting one.
 */
import { spawn } from 'node:child_process'
import type { RemoteChannel } from '../targets/types.ts'
import { scrubSecrets } from '../targets/types.ts'
import type { ExecResult } from './connect.ts'

/** The Windows executable that owns every distro. */
const WSL_EXE = 'wsl.exe'

/** Byte ceiling for one management/command result. */
const DEFAULT_MAX_BYTES = 256 * 1024

/** A bounded stderr tail kept for failed-startup diagnostics. */
const STDERR_TAIL_BYTES = 8192

/** One installed distribution as the wizard offers it. */
export interface WslDistro {
  readonly name: string
  /** `Running` / `Stopped` / `Installing` (wsl.exe's own wording, trimmed). */
  readonly state?: string
  /** WSL version (1 or 2); absent for a distro that is still installing. */
  readonly version?: number
  /** Whether `wsl.exe` marks this distro as the default one. */
  readonly default: boolean
}

/** Result of one discovery pass; never throws for "WSL is absent". */
export interface WslProbe {
  readonly available: boolean
  readonly distros: readonly WslDistro[]
  readonly error?: string
}

/** Quote one value for the POSIX shell that runs inside the distro. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * Base argv that hands one distro a POSIX shell.
 *
 * `wsl.exe` re-parses the Windows command line, so a **multi-line** script
 * passed through `-c` is silently mangled (measured: a 7-line body lost two of
 * its commands, and the real failure surfaced as `zsh:12: unmatched "` — the
 * distro's default shell had parsed half a script). Scripts therefore travel on
 * stdin via `sh -s`; only short, single-line commands use `-c`.
 * @param distro - distribution name.
 * @param user - optional distro user.
 */
export function wslShellArgs(distro: string, user?: string): string[] {
  return [
    '-d',
    distro,
    ...(user === undefined || user === '' ? [] : ['--user', user]),
    '--',
    '/bin/sh',
  ]
}

/** argv for one script fed on stdin (`sh -s`), which is argv-safe for any body. */
export function wslScriptArgs(distro: string, user?: string): string[] {
  return [...wslShellArgs(distro, user), '-s']
}

/** argv for one single-line command (`sh -c`). */
export function wslCommandArgs(distro: string, body: string, user?: string): string[] {
  return [...wslShellArgs(distro, user), '-c', body]
}

/**
 * Parse `wsl.exe -l -v` output.
 *
 * The input is already decoded from UTF-16LE. Rows are `[*] <name> <STATE> <VER>`;
 * the name is everything before the last two whitespace-separated tokens, and a
 * row whose last token is not a number (a distro in `Installing`) carries only
 * `[*] <name> <STATE>`.
 * @param decoded - UTF-16LE-decoded stdout of `wsl.exe -l -v`.
 * @returns the parsed distros, in wsl.exe's order (the default one first).
 */
export function parseWslDistroList(decoded: string): WslDistro[] {
  const distros: WslDistro[] = []
  const lines = decoded.replaceAll('\uFEFF', '').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.replaceAll('\0', '').trim()
    if (line === '') continue
    // The header row is `NAME STATE VERSION` (column-padded).
    if (/^NAME\s+STATE\b/i.test(line)) continue
    const isDefault = line.startsWith('*')
    const body = (isDefault ? line.slice(1) : line).trim()
    if (body === '') continue
    const tokens = body.split(/\s+/)
    if (tokens.length < 2) continue
    const last = tokens[tokens.length - 1] as string
    const secondLast = tokens[tokens.length - 2] as string
    const version = /^\d+$/.test(last) ? Number(last) : undefined
    const state = version === undefined ? last : secondLast
    const name = tokens.slice(0, version === undefined ? -1 : -2).join(' ').trim()
    if (name === '') continue
    distros.push({
      name,
      state,
      ...(version === undefined ? {} : { version }),
      default: isDefault,
    })
  }
  return distros
}

/** Spawn `wsl.exe` and collect bounded output, decoded per the caller's choice. */
function runWslManagement(
  args: readonly string[],
  options: { timeoutMs: number; encoding: 'utf16le' | 'utf8' },
): Promise<{ code: number | null; stdout: string; stderr: string; failed?: string }> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(WSL_EXE, [...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: '', failed: `cannot start wsl.exe: ${String(error)}` })
      return
    }
    const out: Buffer[] = []
    const err: Buffer[] = []
    let total = 0
    const collect = (sink: Buffer[]) => (chunk: Buffer): void => {
      total += chunk.length
      if (total <= DEFAULT_MAX_BYTES) sink.push(chunk)
    }
    let settled = false
    const settle = (value: { code: number | null; stdout: string; stderr: string; failed?: string }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      child?.kill()
      settle({ code: null, stdout: '', stderr: '', failed: 'wsl.exe did not answer in time' })
    }, options.timeoutMs)
    timer.unref?.()
    child.stdout?.on('data', collect(out))
    child.stderr?.on('data', collect(err))
    child.once('error', (error: NodeJS.ErrnoException) => {
      settle({
        code: null,
        stdout: '',
        stderr: '',
        failed: error.code === 'ENOENT' ? 'wsl.exe was not found on this host' : `wsl.exe failed to start: ${error.message}`,
      })
    })
    child.once('close', (code: number | null) => {
      settle({
        code,
        stdout: Buffer.concat(out).toString(options.encoding),
        stderr: Buffer.concat(err).toString(options.encoding),
      })
    })
  })
}

/** First non-empty line, trimmed — the actionable part of a wsl.exe error. */
function firstLine(text: string): string {
  for (const line of text.replaceAll('\0', '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed !== '') return trimmed
  }
  return ''
}

/**
 * Discover installed distributions.
 *
 * Never starts a distro and never throws: an absent or disabled WSL reports
 * `available: false` with a scrubbed reason so the wizard can show it inline.
 * @returns the probe result.
 */
export async function listWslDistros(): Promise<WslProbe> {
  const result = await runWslManagement(['-l', '-v'], { timeoutMs: 10_000, encoding: 'utf16le' })
  if (result.failed !== undefined) return { available: false, distros: [], error: scrubSecrets(result.failed) }
  if (result.code !== 0) {
    const detail = firstLine(result.stderr) || firstLine(result.stdout)
    return {
      available: false,
      distros: [],
      error: scrubSecrets(detail !== '' ? detail : `wsl.exe exited with code ${String(result.code)}`),
    }
  }
  return { available: true, distros: parseWslDistroList(result.stdout) }
}

/**
 * Run one script inside a distro and collect bounded output.
 *
 * The script is written to the process's stdin (`sh -s`) instead of being passed
 * through `-c`: `wsl.exe` re-parses the Windows command line, and a multi-line
 * body loses lines (and can end up parsed by the distro's own default shell).
 * @param distro - distribution name.
 * @param body - POSIX shell script; callers must quote every interpolation.
 * @param options - byte ceiling, deadline and optional distro user.
 * @returns exit facts and captured output (UTF-8, as the distro prints it).
 */
export async function wslExec(
  distro: string,
  body: string,
  options: { maxBytes?: number; timeoutMs?: number; user?: string } = {},
): Promise<ExecResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  return await new Promise<ExecResult>((resolve, reject) => {
    let child
    try {
      child = spawn(WSL_EXE, wslScriptArgs(distro, options.user), { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      reject(new Error(`cannot start wsl.exe: ${scrubSecrets(String(error))}`))
      return
    }
    let truncated = false
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let total = 0
    const collect = (sink: Buffer[]) => (chunk: Buffer): void => {
      total += chunk.length
      if (total > maxBytes) {
        truncated = true
        return
      }
      sink.push(chunk)
    }
    let settled = false
    const finish = (error: Error | undefined, result?: ExecResult): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      if (error !== undefined) reject(error)
      else resolve(result as ExecResult)
    }
    const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
      child?.kill()
      finish(new Error(`remote command timed out in distro "${distro}"`))
    }, options.timeoutMs)
    timer?.unref?.()
    child.stdout?.on('data', collect(stdout))
    child.stderr?.on('data', collect(stderr))
    child.once('error', (error: NodeJS.ErrnoException) => {
      finish(new Error(error.code === 'ENOENT'
        ? 'wsl.exe was not found on this host'
        : `the command inside distro "${distro}" failed to start: ${scrubSecrets(error.message)}`))
    })
    child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
      finish(undefined, {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        truncated,
      })
    })
    // A script that exits early closes the pipe under us; the close handler
    // still reports the real outcome, so an EPIPE here is not a failure.
    child.stdin?.on('error', () => {})
    child.stdin?.end(body)
  })
}

/** A long-lived distro process plus its bounded stderr tail. */
export interface WslChannelHandle {
  readonly channel: RemoteChannel
  /** What the process printed on stderr, scrubbed. */
  diagnostics(): string
  /** Resolves once the distro-side process exits, with its code. */
  readonly exited: Promise<number | null>
}

/**
 * Start one long-lived process inside a distro whose stdio is the protocol channel.
 * @param distro - distribution name.
 * @param body - the server command (a POSIX shell body).
 * @param user - optional distro user.
 * @returns the channel plus a diagnostics reader.
 */
export function spawnWslChannel(distro: string, body: string, user?: string): WslChannelHandle {
  const args = wslCommandArgs(distro, body, user)
  const child = spawn(WSL_EXE, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const t0 = Date.now()
  // `DSH_RW_DEBUG=1` turns on the transport timeline. Kept behind a flag because
  // it prints on every channel: it exists to answer "who killed the distro
  // process", which is exactly how the `mux.close()`-tears-down-stdio bug and the
  // lease-expiry bug were found (see AGENTS.md).
  debug(`wsl spawn distro=${distro} pid=${String(child.pid)} argv=${JSON.stringify(args.slice(0, 4))} body=${JSON.stringify(body.slice(0, 300))}`)
  let tail = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    tail = `${tail}${chunk.toString('utf8')}`.slice(-STDERR_TAIL_BYTES)
  })
  // A dead channel must never surface as an uncaught stream error: the peer
  // reports failure through its own close path.
  child.stdin?.on('error', () => {})
  child.stdout?.on('error', () => {})
  child.stderr?.on('error', () => {})
  child.on('error', () => {})
  child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    debug(`wsl exit +${Date.now() - t0}ms code=${String(code)} signal=${String(signal)} tail=${JSON.stringify(tail.slice(-300))}`)
  })
  let closed = false
  let ended = false
  const exited = new Promise<number | null>((resolveExit) => {
    child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
      ended = true
      debug(`wsl close +${Date.now() - t0}ms code=${String(code)} signal=${String(signal)}`)
      resolveExit(code)
    })
  })
  const channel: RemoteChannel = {
    input: child.stdout as RemoteChannel['input'],
    output: child.stdin as RemoteChannel['output'],
    // The host plane uses this to retire a cached channel whose process is gone
    // (the in-distro `dsh` exits on lease expiry), so the next call
    // re-provisions instead of writing into a dead pipe.
    // `exitCode`/`signalCode` are set even when the 'close' event has not been
    // delivered yet, so a process that just died is never mistaken for a live
    // far side (writing into it answered `SSH connection lost`).
    get closed() { return ended || child.exitCode !== null || child.signalCode !== null },
    close: async () => {
      if (!child.stdin?.destroyed && child.stdin?.writable) child.stdin.end()
      // `wsl.exe` is a wrapper: ending our stdin half-closes the distro process,
      // and the server's own lease (leaseMs) reaps whatever is left inside the
      // distro if this kill does not reach it.
      if (!closed) {
        closed = true
        debug(`wsl channel.close() distro=${distro} code=${String(child.exitCode)} at=${new Error().stack?.split('\n').slice(2, 5).join(' | ')}`)
        child.kill()
      }
    },
  }
  return { channel, diagnostics: () => scrubSecrets(tail.trim()), exited }
}

/**
 * Write one file into a distro by streaming bytes into the process's stdin.
 *
 * Deliberately not the ssh path's base64 heredoc: the Node distribution tarball
 * is tens of megabytes, and a single base64 argument would exceed the kernel's
 * `ARG_MAX`. A locally spawned child has stdin, so the bytes travel as a stream.
 * @param distro - distribution name.
 * @param path - absolute POSIX path inside the distro.
 * @param content - file bytes.
 * @param onProgress - byte progress sink.
 * @param user - optional distro user.
 */
export async function writeWslFile(
  distro: string,
  path: string,
  content: Buffer,
  onProgress?: (sent: number, total: number) => void,
  user?: string,
): Promise<void> {
  const directory = path.slice(0, path.lastIndexOf('/')) || '/'
  const body = `umask 022; command mkdir -p ${shellQuote(directory)} && cat > ${shellQuote(path)}`
  await new Promise<void>((resolve, reject) => {
    const child = spawn(WSL_EXE, wslCommandArgs(distro, body, user), { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const errors: Buffer[] = []
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      if (error === undefined) resolve()
      else reject(error)
    }
    child.stderr?.on('data', (chunk: Buffer) => {
      if (errors.length < 64) errors.push(chunk)
    })
    child.stdout?.on('data', () => {})
    child.once('error', (error: NodeJS.ErrnoException) => {
      finish(new Error(error.code === 'ENOENT' ? 'wsl.exe was not found on this host' : `cannot upload: ${scrubSecrets(error.message)}`))
    })
    child.once('close', (code: number | null) => {
      if (code === 0) {
        finish()
        return
      }
      const detail = scrubSecrets(Buffer.concat(errors).toString('utf8').trim().slice(-2000))
      finish(new Error(`cannot write "${path}" in distro "${distro}" (exit ${String(code)}): ${detail !== '' ? detail : 'no stderr output'}`))
    })
    const CHUNK = 256 * 1024
    let offset = 0
    const pump = (): void => {
      while (offset < content.length) {
        const end = Math.min(offset + CHUNK, content.length)
        const chunk = content.subarray(offset, end)
        offset = end
        onProgress?.(offset, content.length)
        if (!child.stdin?.write(chunk)) {
          child.stdin?.once('drain', pump)
          return
        }
      }
      child.stdin?.end()
    }
    // Writing before the child is listening can raise EPIPE on Windows; the
    // close handler still reports the real outcome, so only swallow the error.
    child.stdin?.on('error', () => {})
    pump()
  })
}
