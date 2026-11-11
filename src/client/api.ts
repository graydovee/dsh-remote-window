/**
 * Shared browser → client-host transport (v3).
 *
 * The envelope, error normalizer and trust fence are the same for every call:
 * a failed request arrives as a {@link RemoteApiError} with a stable code, and
 * the UI renders {@link WireError} inline instead of a bare exception.
 *
 * What remains here is the connection-dialog surface: saved SSH aliases and
 * discoverable private keys. Every other route lives in `remote-api.ts`.
 */
import { t } from './locales.ts'

/** Route prefix owned by the plugin's host half. */
export const API_PREFIX = '/dsh-remote-workspace'

/** SSH authentication kind, as the host models it. */
export type AuthKind = 'password' | 'privateKey' | 'agent'

/** Connection status of a saved target. */
export type TargetStatus = 'unknown' | 'ready' | 'failed' | 'stopped'

/** A host the plugin has connected to before (a connection row's model). */
export interface PublicTarget {
  id: string
  label: string
  /** Connection kind; a WSL target reaches a local distribution, not a host. */
  kind?: 'ssh' | 'wsl'
  host: string
  port: number
  username: string
  /** Local WSL distribution name (WSL targets only). */
  wslDistro?: string
  status: TargetStatus
}

/** One alias read from the local `~/.ssh/config`. */
export interface SshAlias {
  alias: string
  hostName?: string
  port?: number
  user?: string
  identityFile?: string
  source: string
}

/** Response of `/api/ssh-aliases`. */
export interface SshAliasesResult {
  aliases: SshAlias[]
  warnings: string[]
}

/** Response of `/api/ssh-keys`. */
export interface SshKeysResult {
  keys: Array<{ path: string; label: string }>
}

/** A wire failure reduced to what the UI renders inline. */
export interface WireError {
  code: string
  message: string
}

/** One failed call, with the host's error code and the HTTP status. */
export class RemoteApiError extends Error {
  readonly code: string
  readonly status: number
  /** Structured public details from the envelope (never secrets). */
  readonly details?: unknown

  /**
   * @param code - the host's error code (`network` and `invalid-response` are client-side).
   * @param message - human-readable message, already localized where the client produced it.
   * @param status - HTTP status, 0 for a transport failure.
   */
  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'RemoteApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

/** Reduce any thrown value to a {@link WireError} for inline rendering. */
export function toWireError(error: unknown): WireError {
  if (error instanceof RemoteApiError) return { code: error.code, message: error.message }
  if (error instanceof Error) return { code: 'client', message: error.message }
  return { code: 'client', message: String(error) }
}

interface Envelope {
  ok?: unknown
  value?: unknown
  error?: { code?: unknown; message?: unknown; details?: unknown }
}

/**
 * Parse one JSON envelope, throwing {@link RemoteApiError} for anything else.
 * The body is read as text first so a non-JSON rejection (the host's trust
 * fence, a proxy) still produces a readable message.
 */
async function readEnvelope<T>(response: Response): Promise<T> {
  const raw = await response.text().catch(() => '')
  let parsed: Envelope | null = null
  if (raw !== '') {
    try {
      parsed = JSON.parse(raw) as Envelope
    } catch {
      parsed = null
    }
  }
  if (parsed !== null && parsed.ok === true) return parsed.value as T
  const code = typeof parsed?.error?.code === 'string' ? parsed.error.code : `http-${response.status}`
  const envelopeMessage = typeof parsed?.error?.message === 'string' ? parsed.error.message : undefined
  const fallback = raw === '' ? `HTTP ${response.status}` : raw.slice(0, 300)
  throw new RemoteApiError(code, envelopeMessage ?? fallback, response.status, parsed?.error?.details)
}

/** POST one command route and unwrap its envelope. */
export async function call<T>(route: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_PREFIX}/api/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  } catch (error) {
    throw new RemoteApiError('network', t('error.network', { message: error instanceof Error ? error.message : String(error) }), 0)
  }
  return readEnvelope<T>(response)
}

/** The connection-dialog data routes. */
export const api = {
  /** Aliases parsed from the local `~/.ssh/config`, plus parser warnings. */
  sshAliases(): Promise<SshAliasesResult> {
    return call<SshAliasesResult>('ssh-aliases', {})
  },

  /**
   * Private keys discoverable under `~/.ssh` on this host.
   *
   * Only paths cross the wire; the dialog offers them as datalist options and
   * still lets the user type a path that is not listed.
   */
  sshKeys(): Promise<SshKeysResult> {
    return call<SshKeysResult>('ssh-keys', {})
  },
}
