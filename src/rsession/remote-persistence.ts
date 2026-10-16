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
}

interface RemoteSnapshot extends RemoteSessionSummary {
  header: SessionHeader
}

const asRemoteSessionId = (id: SessionId): RemoteSessionId => id as unknown as RemoteSessionId

/**
 * SessionPersistence provider that stores the authoritative log through the
 * remote server. It deliberately delegates ownership, format validation and
 * lease renewal to the official backend running on that server.
 */
export class RemotePersistence extends SessionPersistence {
  private readonly handles = new Set<RemoteHandle>()

  constructor(
    ctx: Context,
    private readonly rpc: RemoteSessionRpc,
    private readonly workspaceId: WorkspaceId,
  ) {
    super(ctx)
  }

  async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    const payload = await this.rpc.request<RemoteHandlePayload>('persist.create', { workspaceId: this.workspaceId, header }, options?.signal)
    const handle = new RemoteHandle(this.rpc, payload.handleId, 'write', payload.header, payload.events ?? [], () => { this.handles.delete(handle) })
    this.handles.add(handle)
    return handle
  }

  async open(id: SessionId, access: 'read' | 'write', options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    const payload = await this.rpc.request<RemoteHandlePayload>('persist.open', {
      workspaceId: this.workspaceId,
      sessionId: asRemoteSessionId(id),
      mode: access,
    }, options?.signal)
    const handle = new RemoteHandle(this.rpc, payload.handleId, access, payload.header, payload.events ?? [], () => { this.handles.delete(handle) })
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
      header: snapshot.header,
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

  constructor(
    private readonly rpc: RemoteSessionRpc,
    private readonly handleId: RemoteHandleId,
    readonly access: 'read' | 'write',
    readonly header: SessionHeader,
    events: readonly SessionEvent[],
    private readonly onClose: () => void,
  ) {
    this.events = [...events]
  }

  get id(): SessionId { return this.header.id }
  get inheritedEventCount(): SessionLogOffset { return 0 as SessionLogOffset }

  async read(offset = 0, length?: number): Promise<{ eventState: SessionSeedEventState; events: readonly SessionEvent[] }> {
    this.ensureOpen()
    const end = length === undefined ? undefined : offset + length
    return { eventState: 'detached', events: this.events.slice(offset, end) }
  }

  async append(events: readonly SessionEvent[]): Promise<void> {
    this.ensureOpen()
    if (this.access !== 'write') throw new Error('remote session handle is read-only')
    await this.rpc.request('persist.append', { handleId: this.handleId, events })
    this.events.push(...events)
  }

  async flush(): Promise<void> {
    this.ensureOpen()
    await this.rpc.request('persist.flush', { handleId: this.handleId })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.rpc.request('persist.close', { handleId: this.handleId })
    this.onClose()
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('remote session handle is closed')
  }
}
