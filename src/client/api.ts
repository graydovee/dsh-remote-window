/**
 * Typed client for this plugin's frozen host HTTP contract.
 *
 * Every route lives under {@link API_PREFIX}: POST + JSON body for commands,
 * one GET SSE stream for connection progress (EventSource cannot POST, so the
 * one-shot `ticket` travels in the query string). Responses are always
 * `{ ok: true, value }` or `{ ok: false, error: { code, message } }`; a
 * non-envelope body (a fence rejection, a proxy error page) is surfaced as
 * {@link RemoteApiError} carrying the HTTP status.
 *
 * No secret ever enters a URL: `secret`/`privateKeyPath` ride the
 * `/api/connect/start` JSON body only, and {@link api.connectStart} is the
 * only method that takes them.
 */
import { t } from './locales.ts'

/** Route prefix owned by the plugin's host half. */
export const API_PREFIX = '/dsh-remote-workspace'

/** SSH authentication kind, as the host models it. */
export type AuthKind = 'password' | 'privateKey' | 'agent'

/** Connection status of a saved target. */
export type TargetStatus = 'unknown' | 'ready' | 'failed' | 'stopped'

/** Remote runtime knobs (advanced section of the wizard). */
export interface RemoteRuntimeConfig {
  nodePath: string
  dshCommand: string
  profile: string
  dshHome: string
  plugins: string[]
}

/** A host the plugin has connected to before. */
export interface PublicTarget {
  id: string
  label: string
  kind: 'ssh'
  host: string
  port: number
  username: string
  authKind: AuthKind
  hasStoredSecret: boolean
  hostKeyFingerprint: string
  sshConfigAlias?: string
  remote: RemoteRuntimeConfig
  status: TargetStatus
  lastError?: string
  lastConnectedAt?: string
}

/** A remote directory remembered as a workspace. */
export interface RemoteWorkspace {
  id: string
  targetId: string
  path: string
  title: string
  createdAt: string
  lastOpenedAt?: string
  sessionId?: string
  remoteWorkspaceId?: string
  serverId?: string
  /** Official shell-workspace entry id (present once the workspace was opened). */
  officialWorkspaceId?: string
  /** Session ids this plugin's user pinned in this workspace, most recent first. */
  pinnedSessions?: string[]
  /** Session ids this plugin's user archived (grayed, not openable). */
  archivedSessions?: string[]
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

/** One workspace the *remote* dsh itself has registered (`reg.list`). */
export interface RemoteRegistryWorkspace {
  id: string
  path: string
  title: string
  sessionCount: number
  createdAt: string
}

/** One session stored on the remote server for a workspace (`persist.list`). */
export interface RemoteSession {
  id: string
  /** Creation time from the stored header (epoch milliseconds). */
  createdAt?: number
  sizeBytes?: number
  /** Log title (`session/title`), absent when the session has none. */
  title?: string
  /** Last activity in the log (epoch milliseconds), for the row's time column. */
  updatedAt?: number
}

/** Response of `/api/ssh-aliases`. */
export interface SshAliasesResult {
  aliases: SshAlias[]
  warnings: string[]
}

/** Response of `/api/alias-prefill`. */
export interface AliasPrefill {
  alias: string
  host: string
  port: number
  username?: string
  identityFile?: string
  source: 'ssh -G' | 'config-file'
}

/** Optional remote runtime overrides sent with `/api/connect/start`. */
export interface RemoteRuntimeInput {
  nodePath?: string
  dshCommand?: string
  profile?: string
  dshHome?: string
}

/** Body of `/api/connect/start`. `secret` never leaves this request. */
export interface ConnectStartRequest {
  label: string
  host: string
  port: number
  username: string
  authKind: AuthKind
  secret?: string
  privateKeyPath?: string
  sshConfigAlias?: string
  /** Present only when retrying after the user confirmed a fingerprint. */
  hostKeyFingerprint?: string
  /** Per-target server-package source; omitted = follow the global policy. */
  packageSource?: 'download' | 'upload'
  remote?: RemoteRuntimeInput
}

/** Response of `/api/state`. */
export interface StateResult {
  targets: PublicTarget[]
  workspaces: RemoteWorkspace[]
  pluginVersion: string
  defaultProfile: string
}

/** One directory entry of `/api/list-dir`. */
export interface DirEntry {
  name: string
  type: 'file' | 'directory' | 'other'
  path: string
}

/** Response of `/api/list-dir`. */
export interface ListDirResult {
  home: string
  path: string
  parent?: string
  entries: DirEntry[]
}

/** Response of `/api/open-workspace`. */
export interface OpenWorkspaceResult {
  workspace: RemoteWorkspace
  sessionId: string
}

/** The four progress steps the server reports over SSE. */
export type ConnectStep = 'connect' | 'probe' | 'runtime' | 'upload' | 'start'

/** Status a step frame may carry. */
export type ConnectStepStatus = 'running' | 'ok' | 'failed'

/** One frame of the `/stream/connect` SSE stream. */
export type ConnectFrame =
  | { type: 'step'; step: ConnectStep; status: ConnectStepStatus; message?: string; detail?: string }
  | { type: 'host-key'; fingerprint: string; algorithm?: string }
  | { type: 'done'; target: PublicTarget }
  | { type: 'error'; code: string; message: string }

/** A wire failure reduced to what the UI renders inline. */
export interface WireError {
  code: string
  message: string
}

/** One failed call, with the host's error code and the HTTP status. */
export class RemoteApiError extends Error {
  readonly code: string
  readonly status: number

  /**
   * @param code - the host's error code (`network` and `invalid-response` are client-side).
   * @param message - human-readable message, already localized where the client produced it.
   * @param status - HTTP status, 0 for a transport failure.
   */
  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'RemoteApiError'
    this.code = code
    this.status = status
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
  error?: { code?: unknown; message?: unknown }
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
  throw new RemoteApiError(code, envelopeMessage ?? fallback, response.status)
}

/** POST one command route and unwrap its envelope. */
async function call<T>(route: string, body: unknown): Promise<T> {
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

/** One command per frozen host route. */
export const api = {
  /** Saved targets, saved workspaces, plugin version and the default profile. */
  state(): Promise<StateResult> {
    return call<StateResult>('state', {})
  },

  /** Aliases parsed from the local `~/.ssh/config`, plus parser warnings. */
  sshAliases(): Promise<SshAliasesResult> {
    return call<SshAliasesResult>('ssh-aliases', {})
  },

  /** Resolved connection fields for one alias (host/port/user/identity). */
  aliasPrefill(alias: string): Promise<AliasPrefill> {
    return call<AliasPrefill>('alias-prefill', { alias })
  },

  /**
   * Start a connection attempt; the returned ticket addresses the SSE stream.
   * @param request - connection fields; `secret` is sent here and nowhere else.
   */
  connectStart(request: ConnectStartRequest): Promise<{ ticket: string }> {
    return call<{ ticket: string }>('connect/start', request)
  },

  /** Accept one host-key fingerprint for a running attempt (never automatic). */
  hostkeyConfirm(ticket: string, fingerprint: string): Promise<{ accepted: true }> {
    return call<{ accepted: true }>('hostkey-confirm', { ticket, fingerprint })
  },

  /** List one remote directory. */
  listDir(targetId: string, path: string): Promise<ListDirResult> {
    return call<ListDirResult>('list-dir', { targetId, path })
  },

  /** Create one remote directory. */
  mkdir(targetId: string, path: string): Promise<{ path: string }> {
    return call<{ path: string }>('mkdir', { targetId, path })
  },

  /** Open a remote directory as a workspace and create its session. */
  openWorkspace(targetId: string, path: string, title?: string): Promise<OpenWorkspaceResult> {
    return call<OpenWorkspaceResult>('open-workspace', title === undefined ? { targetId, path } : { targetId, path, title })
  },

  /**
   * Adopt a session that already exists on the remote server (换设备续聊).
   * @param targetId - the host owning the session.
   * @param path - the remote workspace directory.
   * @param sessionId - stored remote session id.
   */
  openSession(targetId: string, path: string, sessionId: string, title?: string): Promise<OpenWorkspaceResult> {
    return call<OpenWorkspaceResult>('open-session', {
      targetId,
      path,
      sessionId,
      ...(title === undefined ? {} : { title }),
    })
  },

  /** The workspaces the remote dsh has registered (添加工作区 source). */
  remoteWorkspaces(targetId: string): Promise<{ workspaces: RemoteRegistryWorkspace[] }> {
    return call<{ workspaces: RemoteRegistryWorkspace[] }>('remote-workspaces', { targetId })
  },

  /** Sessions stored on the remote server for one local workspace record. */
  sessions(targetId: string, workspaceId: string): Promise<{ sessions: RemoteSession[] }> {
    return call<{ sessions: RemoteSession[] }>('sessions', { targetId, workspaceId })
  },

  /** Drop one saved target (and everything derived from it). */
  forgetTarget(targetId: string): Promise<{ forgotten: true }> {
    return call<{ forgotten: true }>('forget-target', { targetId })
  },

  /** Rename one stored remote session (the plugin's own host hop). */
  sessionRename(targetId: string, path: string, sessionId: string, title: string): Promise<{ renamed: true }> {
    return call<{ renamed: true }>('session-rename', { targetId, path, sessionId, title })
  },

  /** Pin/unpin or archive/unarchive one stored remote session. */
  sessionFlag(workspaceId: string, sessionId: string, flag: 'pinned' | 'archived', on: boolean): Promise<{ workspace: RemoteWorkspace }> {
    return call<{ workspace: RemoteWorkspace }>('session-flag', { workspaceId, sessionId, flag, on })
  },

  /** Drop one saved remote workspace. */
  forgetWorkspace(workspaceId: string): Promise<{ forgotten: true }> {
    return call<{ forgotten: true }>('forget-workspace', { workspaceId })
  },

  /** Open (or reuse) the execution channel of a saved host, without a session. */
  connect(targetId: string): Promise<{ target: PublicTarget }> {
    return call<{ target: PublicTarget }>('connect', { targetId })
  },

  /** Stop the target's remote execution-world session. */
  stopTarget(targetId: string): Promise<{ stopped: boolean }> {
    return call<{ stopped: boolean }>('stop-target', { targetId })
  },
}

/** The SSE URL for one attempt (one-shot ticket, no secret). */
export function connectStreamUrl(ticket: string): string {
  return `${API_PREFIX}/stream/connect?ticket=${encodeURIComponent(ticket)}`
}

/** Frame-name fallback: the host may name its SSE events after the frame type. */
const FRAME_EVENT_NAMES = ['step', 'host-key', 'done', 'error'] as const

/** Narrow one parsed JSON value to a {@link ConnectFrame}. */
function asConnectFrame(value: unknown): ConnectFrame | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const frame = value as { type?: unknown }
  switch (frame.type) {
    case 'step': {
      const step = (value as { step?: unknown }).step
      const status = (value as { status?: unknown }).status
      if (step !== 'connect' && step !== 'probe' && step !== 'runtime' && step !== 'upload' && step !== 'start') return undefined
      if (status !== 'running' && status !== 'ok' && status !== 'failed') return undefined
      const message = (value as { message?: unknown }).message
      const detail = (value as { detail?: unknown }).detail
      return {
        type: 'step',
        step,
        status,
        ...(typeof message === 'string' ? { message } : {}),
        ...(typeof detail === 'string' ? { detail } : {}),
      }
    }
    case 'host-key': {
      const fingerprint = (value as { fingerprint?: unknown }).fingerprint
      if (typeof fingerprint !== 'string') return undefined
      const algorithm = (value as { algorithm?: unknown }).algorithm
      return {
        type: 'host-key',
        fingerprint,
        ...(typeof algorithm === 'string' ? { algorithm } : {}),
      }
    }
    case 'done': {
      const target = (value as { target?: unknown }).target
      if (target === null || typeof target !== 'object') return undefined
      return { type: 'done', target: target as PublicTarget }
    }
    case 'error': {
      const code = (value as { code?: unknown }).code
      const message = (value as { message?: unknown }).message
      return {
        type: 'error',
        code: typeof code === 'string' ? code : 'stream',
        message: typeof message === 'string' ? message : t('connect.stream.closed'),
      }
    }
    default:
      return undefined
  }
}

/** Handlers for one connection stream. */
export interface ConnectStreamHandlers {
  /** One validated frame, in arrival order. */
  onFrame: (frame: ConnectFrame) => void
  /** Transport failure (reported once; the caller owns closing). */
  onTransportError: (message: string) => void
}

/**
 * Open the SSE progress stream for one attempt.
 *
 * The stream is closed by the returned disposer only: the caller closes it on
 * a terminal frame (`done`/`error`) or on a transport failure, because the
 * ticket is one-shot and the browser's automatic reconnect would re-open a
 * dead attempt. Frames are read from the default `message` event and, as a
 * fallback, from events named after the frame type.
 *
 * @param ticket - the one-shot ticket from {@link api.connectStart}.
 * @param handlers - frame and transport callbacks.
 * @returns an idempotent close function.
 */
export function openConnectStream(ticket: string, handlers: ConnectStreamHandlers): () => void {
  if (typeof EventSource === 'undefined') {
    throw new RemoteApiError('no-eventsource', t('error.streamUnsupported'), 0)
  }
  const source = new EventSource(connectStreamUrl(ticket))
  let closed = false
  let failed = false

  const close = (): void => {
    if (closed) return
    closed = true
    source.close()
  }

  const deliver = (event: MessageEvent): void => {
    if (closed) return
    let parsed: unknown
    try {
      parsed = JSON.parse(String(event.data))
    } catch {
      return
    }
    const frame = asConnectFrame(parsed)
    if (frame !== undefined) handlers.onFrame(frame)
  }

  source.onmessage = deliver
  for (const name of FRAME_EVENT_NAMES) {
    source.addEventListener(name, deliver as EventListener)
  }
  source.onerror = (): void => {
    if (closed || failed) return
    failed = true
    handlers.onTransportError(t('connect.stream.closed'))
  }

  return close
}
