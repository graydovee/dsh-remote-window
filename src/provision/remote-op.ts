/**
 * One remote operation, in the server's own language.
 *
 * The plugin has two dialects (`posix` and `windows`) and every remote step has to
 * be expressible in both: a *body* to execute and, for PowerShell, a *stdin*
 * payload. Keeping that pair in one small type is what lets the lifecycle code
 * stay linear — `const op = paths.kind === 'windows' ? windowsOp(script) : shellOp(body)`
 * instead of a branch around every `remote.exec` call site.
 */
import type { RemoteKind } from './remote-dialect.ts'
import { decodeWindowsBytes, windowsCommand } from './windows-shell.ts'

/** A command plus the bytes its channel's stdin must receive. */
export interface RemoteOp {
  readonly body: string
  readonly stdin?: string
}

/** Wrap a POSIX shell script (stdin unused). */
export function shellOp(body: string): RemoteOp {
  return { body }
}

/**
 * Wrap a PowerShell script for a Windows server.
 *
 * The wrapper reads base64 from stdin and `Invoke-Expression`s it, so one rule
 * covers every Windows step: the script text never appears on a command line, and
 * quoting/code-page problems cannot reach it.
 * @param script - PowerShell source (ASCII).
 */
export function windowsOp(script: string): RemoteOp {
  const command = windowsCommand(script)
  return { body: command.command, stdin: command.stdin }
}

/** The subset of the remote seam an operation needs. */
export interface RemoteOpChannel {
  exec(body: string, options?: { readonly maxBytes?: number; readonly timeoutMs?: number; readonly stdin?: string }): Promise<{
    readonly code: number | null
    readonly stdout: string
    readonly stderr: string
  }>
}

/**
 * Run one operation and return its raw result.
 * @param channel - the profile remote (exec only).
 * @param op - the body and optional stdin payload.
 * @param options - byte budget and timeout.
 */
export async function execOp(
  channel: RemoteOpChannel,
  op: RemoteOp,
  options: { readonly maxBytes?: number; readonly timeoutMs?: number } = {},
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  return await channel.exec(op.body, {
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(op.stdin === undefined ? {} : { stdin: op.stdin }),
  })
}

/**
 * Decode a text answer produced by a Windows read.
 *
 * Windows reads return base64 (`windowsReadBytesScript`), because the underlying
 * file may be UTF-16LE while the channel decodes stdout as UTF-8; POSIX reads
 * already return plain text.
 * @param kind - the server's dialect.
 * @param result - the raw command result.
 */
export function opText(kind: RemoteKind, result: { readonly stdout: string }): string {
  if (kind !== 'windows') return result.stdout
  const trimmed = result.stdout.trim()
  if (trimmed === 'MISSING' || trimmed === '') return ''
  return decodeWindowsBytes(Buffer.from(trimmed, 'base64'))
}
