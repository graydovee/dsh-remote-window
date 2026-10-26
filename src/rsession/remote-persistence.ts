import type { Context } from '@deepseek-ai/cordis'
import type {
  SessionEvent,
  SessionHeader,
  SessionId,
  SessionLogOffset,
  SessionSeedEventState,
} from '@deepseek-ai/dsh-session'
import {
  SessionPersistence,
  type SessionHandle,
  type SessionPersistenceCreateOptions,
  type SessionPersistenceListOptions,
  type SessionPersistenceSnapshot,
  type SessionPersistenceStatOptions,
  type SessionPersistenceOpenOptions,
} from '@deepseek-ai/dsh-session-persistence'
import { RW_METHODS } from '../protocol.ts'

/** Target-bound P1 RPC used by the routing persistence. */
export interface RemoteSessionRpc {
  request<T = unknown>(method: string, params: unknown, signal?: AbortSignal): Promise<T>
}

/** One `persist/create|open` answer. */
interface RemoteHandlePayload {
  handleId: string
  header: SessionHeader
  /** A partial server may include the opening events; optional on the wire. */
  events?: readonly SessionEvent[]
  /** Fork-inherited prefix length, as the server stored it. */
  inheritedEventCount?: number
  /** `persist/open` cursor: number of durable events on the server. */
  eventCount?: number
  /** `persist/create` first-append cursor. */
  nextSeq?: number
}

/** One `persist/read` answer (protocol §16.6). */
interface RemoteReadPayload {
  events?: readonly SessionEvent[]
  eventState?: SessionSeedEventState
  nextOffset?: number
}

/** A raw `persist/list` / `persist/stat` snapshot. */
interface RemoteSnapshotPayload {
  readonly header?: unknown
  readonly revision?: unknown
  readonly sizeBytes?: unknown
}

/**
 * Adapter options for the official `sessionPersistence` façade.
 *
 * The server stores the durable header, while the client live session is
 * anchored on a private directory and its own execution-world preset. Both
 * rewrites are read-path only; the durable log keeps the server values.
 */
export interface RemotePersistenceOptions {
  /**
   * Server-real cwd of the owning workspace (`persist/create` requires it).
   * Resolved per call because a workspace may be learned after this instance
   * was created by an earlier observe/stat.
   */
  readonly remoteCwdOf?: () => string | undefined
  /** Preset id of this connection's local execution world. */
  readonly agentPresetOf?: () => string | undefined
}

/** Stable error code of a typed P1 failure, when present. */
function errorCodeOf(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** HTTP status of a typed P1 failure, when present. */
function errorStatusOf(error: unknown): number | undefined {
  if (error === null || typeof error !== 'object') return undefined
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : undefined
}

/**
 * Whether a handle-scoped RPC failed because the server no longer knows the
 * handle (profile restart, plugin redeploy). P1 fixes the code
 * `handle-not-found` / status 410; self-heal is allowed exactly once.
 */
function isHandleLost(error: unknown): boolean {
  return errorCodeOf(error) === 'handle-not-found' || errorStatusOf(error) === 410
}

/** Normalize one raw server snapshot; `undefined` for a malformed row. */
function snapshotOf(raw: unknown): SessionPersistenceSnapshot | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const value = raw as RemoteSnapshotPayload
  const header = value.header as SessionHeader | undefined
  if (header === undefined || typeof header !== 'object' || typeof (header as { id?: unknown }).id !== 'string') return undefined
  return {
    header,
    revision: (typeof value.revision === 'string' ? value.revision : `remote:${header.id}`) as never,
    ...(typeof value.sizeBytes === 'number' ? { sizeBytes: value.sizeBytes } : {}),
  }
}

/**
 * SessionPersistence provider that stores the authoritative log through the
 * profile server's P1 `persist/*` API.
 *
 * The server's official JSONL backend owns format, contiguity, durability and
 * the single-writer flock; this adapter only translates:
 *
 * - `create`: the live header cwd is the local anchor, while the durable header
 *   carries the server-real `remoteCwd` (`persist/create` validates it against
 *   the official workspace path);
 * - every returned header is re-anchored on the local anchor + this
 *   connection's preset so official consumers can stat/attach it;
 * - `read` is paged, and a lost server handle (`handle-not-found` 410) is
 *   re-opened exactly once.
 */
export class RemotePersistence extends SessionPersistence {
  private readonly handles = new Set<RemoteHandle>()
  private readonly remoteCwdOf?: () => string | undefined
  private readonly agentPresetOf?: () => string | undefined

  constructor(
    ctx: Context,
    private readonly rpc: RemoteSessionRpc,
    /**
     * The local anchor directory standing in for the remote workspace.
     * A function, not a captured string: the anchor may be materialized after
     * this instance was created by an earlier observe/stat.
     */
    private readonly anchorOf?: () => string | undefined,
    options: RemotePersistenceOptions = {},
  ) {
    super(ctx)
    this.remoteCwdOf = options.remoteCwdOf
    this.agentPresetOf = options.agentPresetOf
  }

  /** Re-anchor one server-side header on the local anchor and preset. */
  private reanchor<T extends { header: SessionHeader }>(value: T): T {
    const localCwd = this.anchorOf?.()
    const preset = this.agentPresetOf?.()
    if ((localCwd === undefined || value.header.cwd === localCwd)
      && (preset === undefined || value.header.agentPreset === preset)) return value
    return {
      ...value,
      header: {
        ...value.header,
        ...(localCwd === undefined ? {} : { cwd: localCwd }),
        ...(preset === undefined ? {} : { agentPreset: preset }),
      },
    }
  }

  /** The server-real cwd required by `persist/create`. */
  private requireRemoteCwd(): string {
    const remote = this.remoteCwdOf?.()
    if (remote === undefined || remote === '') {
      throw new Error('remote workspace has no known server cwd; cannot create its session log')
    }
    return remote
  }

  async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    // A forked session's header is seeded, and the official backend refuses to
    // store one without the inherited prefix length — it has to cross the wire
    // with the header, not be reconstructed on the server.
    const inheritedEventCount = options?.inheritedEventCount
    const remoteCwd = this.requireRemoteCwd()
    const params: Record<string, unknown> = {
      header: { ...header, cwd: remoteCwd },
      remoteCwd,
      executor: 'local',
    }
    if (inheritedEventCount !== undefined) params['inheritedEventCount'] = Number(inheritedEventCount)
    const payload = await this.rpc.request<RemoteHandlePayload>(RW_METHODS.persistCreate, params, options?.signal)
    return this.adopt('write', payload, inheritedEventCount === undefined ? undefined : Number(inheritedEventCount))
  }

  async open(id: SessionId, access: 'read' | 'write', options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    const payload = await this.rpc.request<RemoteHandlePayload>(
      RW_METHODS.persistOpen,
      { sessionId: String(id), access },
      options?.signal,
    )
    return this.adopt(access, payload)
  }

  /** Store one official handle behind the re-anchored façade. */
  private adopt(access: 'read' | 'write', payload: RemoteHandlePayload, inheritedFallback?: number): SessionHandle {
    const anchored = this.reanchor(payload)
    const handle = new RemoteHandle(
      this.rpc,
      anchored.handleId,
      access,
      anchored.header,
      () => { this.handles.delete(handle) },
      anchored.inheritedEventCount ?? inheritedFallback,
      anchored.eventCount ?? anchored.nextSeq,
    )
    this.handles.add(handle)
    return handle
  }

  async flush(): Promise<void> {
    await Promise.all([...this.handles].map(handle => handle.flush()))
  }

  async stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined> {
    const raw = await this.rpc.request<unknown>(RW_METHODS.persistStat, { sessionId: String(id) }, options?.signal)
    if (raw === null || raw === undefined) return undefined
    const snapshot = snapshotOf(raw)
    return snapshot === undefined ? undefined : { ...snapshot, header: this.reanchor(snapshot).header }
  }

  async list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    const raw = await this.rpc.request<unknown>(RW_METHODS.persistList, {}, options?.signal)
    const rows = raw !== null && typeof raw === 'object' && Array.isArray((raw as { snapshots?: unknown }).snapshots)
      ? (raw as { snapshots: readonly unknown[] }).snapshots
      : []
    const snapshots: SessionPersistenceSnapshot[] = []
    for (const row of rows) {
      const snapshot = snapshotOf(row)
      if (snapshot === undefined) continue
      snapshots.push({ ...snapshot, header: this.reanchor(snapshot).header })
    }
    return snapshots
  }
}

class RemoteHandle implements SessionHandle {
  readonly [Symbol.asyncDispose] = async (): Promise<void> => { await this.close() }
  private closed = false
  private events: SessionEvent[]
  /** The live server-side handle id; replaced when the server forgot the old one. */
  private handleId: string
  /** Official cursor reported by `persist/open`; a re-attach continues here. */
  private eventCount: number
  /** Serializes concurrent re-attach attempts for this handle. */
  private reattaching: Promise<void> | undefined

  constructor(
    private readonly rpc: RemoteSessionRpc,
    handleId: string,
    readonly access: 'read' | 'write',
    readonly header: SessionHeader,
    private readonly onClose: () => void,
    private inheritedCount?: number,
    eventCount?: number,
  ) {
    this.handleId = handleId
    this.events = []
    this.eventCount = eventCount ?? 0
  }

  get id(): SessionId { return this.header.id }
  get inheritedEventCount(): SessionLogOffset { return (this.inheritedCount ?? 0) as SessionLogOffset }

  async read(offset = 0, length?: number): Promise<{ eventState: SessionSeedEventState; events: readonly SessionEvent[] }> {
    this.ensureOpen()
    const params: Record<string, unknown> = { offset }
    if (length !== undefined) params['length'] = length
    const payload = await this.call<RemoteReadPayload>(RW_METHODS.persistRead, params)
    const events = Array.isArray(payload?.events) ? payload.events : []
    // A full read refreshes the cache so a re-attach/later read sees the
    // authoritative artifact instead of a stale in-memory copy.
    if (offset === 0 && length === undefined) this.events = [...events]
    if (typeof payload?.nextOffset === 'number') this.eventCount = Math.max(this.eventCount, payload.nextOffset)
    return { eventState: payload?.eventState ?? 'detached', events }
  }

  async append(events: readonly SessionEvent[]): Promise<void> {
    this.ensureOpen()
    if (this.access !== 'write') throw new Error('remote session handle is read-only')
    await this.call(RW_METHODS.persistAppend, { events })
    this.events.push(...events)
    this.eventCount += events.length
  }

  async flush(): Promise<void> {
    this.ensureOpen()
    await this.call(RW_METHODS.persistFlush, {})
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.rpc.request(RW_METHODS.persistClose, { handleId: this.handleId }).catch(() => {})
    this.onClose()
  }

  /**
   * Run one handle-scoped RPC, surviving a server that lost this handle.
   *
   * The server keeps handles in memory; a profile restart (or lease expiry)
   * loses the table while this client keeps the handle id. Without this the
   * failure surfaces as a broken live turn. Re-attaching re-reads the durable
   * cursor; exactly one retry is allowed and an already-stored batch is then
   * rejected by the official contiguity check instead of being written twice.
   */
  private async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    try {
      return await this.rpc.request<T>(method, { ...params, handleId: this.handleId })
    } catch (error) {
      if (this.closed || !isHandleLost(error)) throw error
      await this.reattach()
      return await this.rpc.request<T>(method, { ...params, handleId: this.handleId })
    }
  }

  /** Re-open this session on the server for the same access, once. */
  private reattach(): Promise<void> {
    this.reattaching ??= (async (): Promise<void> => {
      const payload = await this.rpc.request<RemoteHandlePayload>(RW_METHODS.persistOpen, {
        sessionId: String(this.header.id),
        access: this.access,
      })
      this.handleId = payload.handleId
      this.eventCount = payload.eventCount ?? payload.events?.length ?? this.eventCount
      this.events = payload.events === undefined ? this.events.slice(0, this.eventCount) : [...payload.events]
      if (payload.inheritedEventCount !== undefined) this.inheritedCount = payload.inheritedEventCount
    })().finally(() => { this.reattaching = undefined })
    return this.reattaching
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('remote session handle is closed')
  }
}
