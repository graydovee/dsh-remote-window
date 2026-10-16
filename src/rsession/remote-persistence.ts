import type { Context } from '@deepseek-ai/cordis'
import type {
  SessionEvent,
  SessionHeader,
  SessionId,
  SessionLogOffset,
  SessionSeedEventState,
} from '@deepseek-ai/dsh-session'
import { SessionPersistence, type SessionHandle, type SessionPersistenceCreateOptions, type SessionPersistenceListOptions, type SessionPersistenceSnapshot, type SessionPersistenceStatOptions, type SessionPersistenceOpenOptions } from '@deepseek-ai/dsh-session-persistence'
import type { RemoteHandleId, RemoteSessionId, RemoteSessionSummary, WorkspaceId } from '../protocol.ts'

export interface RemoteSessionRpc {
  request<T = unknown>(method: string, params: unknown, signal?: AbortSignal): Promise<T>
}

interface RemoteHandlePayload {
  handleId: RemoteHandleId
  header: SessionHeader
  events?: readonly SessionEvent[]
  /** Fork-inherited prefix length, as the server stored it. */
  inheritedEventCount?: number
}

interface RemoteSnapshot extends RemoteSessionSummary {
  header: SessionHeader
}

const asRemoteSessionId = (id: SessionId): RemoteSessionId => id as unknown as RemoteSessionId

/**
 * SessionPersistence provider that stores the authoritative log through the
 * remote server. It deliberately delegates ownership, format validation and
 * lease renewal to the official backend running on that server.
 *
 * The one client-side fact it adds is the **header cwd rewrite** (`localCwd`):
 * the server stores every session under the *remote* workspace path, so a
 * resumed session's header would otherwise carry `/Users/remote/project`
 * locally. Consumers do realpath/`stat` work on `header.cwd` — the official
 * workspace registry only attaches a session whose canonical cwd equals the
 * workspace path, and the session controller rejects a mismatch with
 * `cwd conflict` — so a remote path is unusable on this side. Rewriting it to
 * the local stub keeps one invariant for both flows: *a remote-workspace
 * session always has the stub as its cwd*, and the realm's stub→remote alias
 * does the translation at the tool boundary (exactly as it does for `create`).
 */
export class RemotePersistence extends SessionPersistence {
  private readonly handles = new Set<RemoteHandle>()

  constructor(
    ctx: Context,
    private readonly rpc: RemoteSessionRpc,
    private readonly workspaceId: WorkspaceId,
    /**
     * Resolves the local stub directory standing in for the remote workspace.
     *
     * A *function*, not a captured string: the routing caches one instance per
     * workspace id, and a session can be observed (`stat`) before the workspace
     * is materialized on this machine. A captured value would freeze `undefined`
     * into the cache and every later header would keep the remote path.
     */
    private readonly stubOf?: () => string | undefined,
  ) {
    super(ctx)
  }

  /** Re-anchor one server-side header on the local stub cwd. */
  private reanchor<T extends { header: SessionHeader }>(value: T): T {
    const localCwd = this.stubOf?.()
    if (localCwd === undefined || value.header.cwd === localCwd) return value
    return { ...value, header: { ...value.header, cwd: localCwd } }
  }

  async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    // A forked session's header is seeded, and the official backend refuses to
    // store one without the inherited prefix length — so it has to cross the
    // wire with the header, not be reconstructed on the server.
    const inheritedEventCount = options?.inheritedEventCount
    const payload = await this.rpc.request<RemoteHandlePayload>('persist.create', {
      workspaceId: this.workspaceId,
      header,
      ...(inheritedEventCount === undefined ? {} : { inheritedEventCount: Number(inheritedEventCount) }),
    }, options?.signal)
    const anchored = this.reanchor(payload)
    const handle = new RemoteHandle(this.rpc, anchored.handleId, 'write', anchored.header, anchored.events ?? [], () => { this.handles.delete(handle) }, this.workspaceId, anchored.inheritedEventCount)
    this.handles.add(handle)
    return handle
  }

  async open(id: SessionId, access: 'read' | 'write', options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    const payload = await this.rpc.request<RemoteHandlePayload>('persist.open', {
      workspaceId: this.workspaceId,
      sessionId: asRemoteSessionId(id),
      mode: access,
    }, options?.signal)
    const anchored = this.reanchor(payload)
    const handle = new RemoteHandle(this.rpc, anchored.handleId, access, anchored.header, anchored.events ?? [], () => { this.handles.delete(handle) }, this.workspaceId, anchored.inheritedEventCount)
    this.handles.add(handle)
    return handle
  }

  async flush(): Promise<void> {
    await Promise.all([...this.handles].map(handle => handle.flush()))
  }

  async stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined> {
    const snapshots = await this.list({ signal: options?.signal })
    return snapshots.find(snapshot => snapshot.header.id === id)
  }

  async list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    const snapshots = await this.rpc.request<readonly RemoteSnapshot[]>('persist.list', { workspaceId: this.workspaceId }, options?.signal)
    return snapshots.map(snapshot => ({
      header: this.reanchor(snapshot).header,
      revision: (`remote:${snapshot.id}:${snapshot.sizeBytes ?? 0}`) as never,
      ...(snapshot.sizeBytes === undefined ? {} : { sizeBytes: snapshot.sizeBytes }),
    }))
  }

  async closeHandle(handle: RemoteHandle): Promise<void> {
    this.handles.delete(handle)
  }
}

class RemoteHandle implements SessionHandle {
  readonly [Symbol.asyncDispose] = async (): Promise<void> => { await this.close() }
  private closed = false
  private events: SessionEvent[]
  /** The live server-side handle id; replaced when the server forgot the old one. */
  private handleId: RemoteHandleId
  /** Serializes concurrent re-attach attempts for this handle. */
  private reattaching: Promise<void> | undefined

  constructor(
    private readonly rpc: RemoteSessionRpc,
    handleId: RemoteHandleId,
    readonly access: 'read' | 'write',
    readonly header: SessionHeader,
    events: readonly SessionEvent[],
    private readonly onClose: () => void,
    private readonly workspaceId: WorkspaceId,
    private inheritedCount?: number,
  ) {
    this.handleId = handleId
    this.events = [...events]
  }

  get id(): SessionId { return this.header.id }
  get inheritedEventCount(): SessionLogOffset { return (this.inheritedCount ?? 0) as SessionLogOffset }

  async read(offset = 0, length?: number): Promise<{ eventState: SessionSeedEventState; events: readonly SessionEvent[] }> {
    this.ensureOpen()
    const end = length === undefined ? undefined : offset + length
    return { eventState: 'detached', events: this.events.slice(offset, end) }
  }

  async append(events: readonly SessionEvent[]): Promise<void> {
    this.ensureOpen()
    if (this.access !== 'write') throw new Error('remote session handle is read-only')
    await this.call('persist.append', { events })
    this.events.push(...events)
  }

  async flush(): Promise<void> {
    this.ensureOpen()
    await this.call('persist.flush', {})
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.rpc.request('persist.close', { handleId: this.handleId }).catch(() => {})
    this.onClose()
  }

  /**
   * Run one handle-scoped RPC, surviving a server that no longer knows this
   * handle.
   *
   * The server keeps handles in memory, so its handle table is lost whenever it
   * restarts — a lease expiry after an idle gap, an explicit stop, or the
   * plugin's own server-bundle redeploy, which happens on every server-side
   * release. Without this, the failure surfaces as a broken *turn* in a live
   * conversation (`unknown remote session handle "…"`), which is exactly the
   * kind of durability the remote-authoritative design promises not to have.
   *
   * Re-attaching re-reads the log from disk on the server, so `events` is
   * refreshed from the authoritative artifact rather than guessed: a batch that
   * was already stored before the loss is then rejected as non-contiguous
   * instead of being written twice.
   */
  private async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    try {
      return await this.rpc.request<T>(method, { ...params, handleId: this.handleId })
    } catch (error) {
      if (this.closed || !/unknown remote session handle/i.test(String(error))) throw error
      await this.reattach()
      return await this.rpc.request<T>(method, { ...params, handleId: this.handleId })
    }
  }

  /** Re-open this session on the server for the same access, once. */
  private reattach(): Promise<void> {
    this.reattaching ??= (async (): Promise<void> => {
      const payload = await this.rpc.request<RemoteHandlePayload>('persist.open', {
        workspaceId: this.workspaceId,
        sessionId: asRemoteSessionId(this.header.id),
        mode: this.access,
      })
      this.handleId = payload.handleId
      this.events = [...(payload.events ?? [])]
      // A re-attach may also restore a seeded child's prefix length.
      if (payload.inheritedEventCount !== undefined) this.inheritedCount = payload.inheritedEventCount
    })().finally(() => { this.reattaching = undefined })
    return this.reattaching
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('remote session handle is closed')
  }
}
