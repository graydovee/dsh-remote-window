/**
 * Root-context session persistence routed by session cwd.
 *
 * This module is bound to the official `sessions` composition row via this
 * bundle's cordis.patch.yml (a later-layer row override by id replaces the
 * JSONL row's `name`/`config` entirely). Routing exists because the agent loop
 * resolves `sessionPersistence` on the HOST plane — a preset-realm provide
 * never reaches it (measured against dsh 0.2.0-rc.1, 2026-10-15) — so the only
 * way a remote-workspace session can persist to the remote server is for the
 * host-level service itself to route.
 *
 * Routing rule, evaluated per call:
 * - `create(header)`: the header cwd of a remote-workspace session is its
 *   local stub directory; a stub registered in the plugin store routes to that
 *   workspace's remote server. Any other cwd delegates to the embedded
 *   official JSONL backend with the same root — local sessions are stored
 *   byte-for-byte as before.
 * - `open`/`stat`: session ids carry no cwd, so the route comes from the
 *   server (`persist.locate`) across the targets with live channels; a miss
 *   delegates locally.
 * - `list`: local only. Remote sessions are plugin-managed and listed by the
 *   plugin panel via `persist.list`; they must not leak into the shell's
 *   global session list.
 *
 * Remote write ownership is the official backend's own handle lease running on
 * the server (one writer per session; a second device's write open rejects
 * with the ownership error), so no client-side locking is added.
 */
import type { Context } from '@deepseek-ai/cordis'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { SessionEvent, SessionHeader, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import {
  SessionPersistence,
  type SessionAccess,
  type SessionHandle,
  type SessionHandleAppendOptions,
  type SessionHandleFlushOptions,
  type SessionHandleReadOptions,
  type SessionHandleReadResult,
  type SessionPersistenceCreateOptions,
  type SessionPersistenceListOptions,
  type SessionPersistenceOpenOptions,
  type SessionPersistenceSnapshot,
  type SessionPersistenceStatOptions,
} from '@deepseek-ai/dsh-session-persistence'
import { RemotePersistence, type RemoteSessionRpc } from '../rsession/remote-persistence.ts'
import type { WorkspaceId } from '../protocol.ts'

/** Row configuration — mirrors the official JSONL row's keys (whole-row replace). */
export interface RoutingPersistenceConfig {
  readonly root: string
  readonly compression?: 'none' | 'zstd'
}

/** Where one remote session lives. */
export interface SessionRoute {
  readonly targetId: string
  readonly workspaceId: WorkspaceId
}

/**
 * The slice of the plugin's host-plane service the routing needs. Declared
 * structurally (not imported) so this module stays decoupled from the store.
 */
interface RoutingRemoteService {
  routeForCwd(cwd: string | undefined): SessionRoute | undefined
  locateRemoteSession(sessionId: string): Promise<SessionRoute | undefined>
  sessionRequest<T>(targetId: string, method: string, params: unknown, signal?: AbortSignal): Promise<T>
  /** The local stub directory a remote workspace stands for, when it is registered. */
  stubForWorkspace(workspaceId: string): string | undefined
}

/** A context stub that absorbs the base class' self-registration. */
function registrationAbsorbingContext(): Context {
  return {
    reflect: { provide: () => () => {} },
    logger: { warn() {}, info() {}, error() {}, debug() {} },
    effect: () => () => {},
    on: () => ({ dispose() {} }),
  } as unknown as Context
}

/**
 * One remote session's live-event writer.
 *
 * Live events are **not** appended one RPC at a time: like the official JSONL
 * backend, the routing buffers them per session and sends one batch at the
 * official durability barriers (`session/flush`, and the handle's own
 * `flush`/`close`). A failed batch is retained verbatim so the next barrier
 * retries it instead of silently dropping a turn.
 */
class RemoteLiveWriter {
  private buffer: SessionEvent[] = []
  private chain: Promise<void> = Promise.resolve()
  private closedFlag = false

  constructor(
    private readonly handle: SessionHandle,
    private readonly warn: (message: string) => void,
    private readonly onClosed: () => void = () => {},
  ) {}

  /** Whether the underlying remote handle is still open. */
  get closed(): boolean {
    return this.closedFlag
  }

  /** The handle the session's owner receives: `close` drains before releasing. */
  wrap(): SessionHandle {
    return new DrainedHandle(this.handle, this, false)
  }

  /**
   * A second view of the same live handle.
   *
   * Handed to a *concurrent* write open of the same session (two resumes
   * racing, or the shell opening a session the plugin is already resuming).
   * Asking the server for a second handle would make the official backend
   * refuse the whole session with `already owned by an active write handle`,
   * so the borrower shares; it may flush but must not release the ownership
   * the first owner still holds.
   */
  borrow(): SessionHandle {
    return new DrainedHandle(this.handle, this, true)
  }

  enqueue(event: SessionEvent): void {
    if (!this.closedFlag) this.buffer.push(event)
  }

  /** Append everything buffered so far, in order. */
  private step(): Promise<void> {
    this.chain = this.chain.then(async () => {
      if (this.buffer.length === 0) return
      const batch = this.buffer
      this.buffer = []
      try {
        await this.handle.append(batch)
      } catch (error) {
        this.buffer = [...batch, ...this.buffer]
        this.warn(
          `dsh-remote-workspace: background write for session "${String(this.handle.id)}" failed `
          + `(buffered events retained): ${String(error)}`,
        )
      }
    })
    return this.chain
  }

  drain(): Promise<void> {
    return this.step()
  }

  flush(): Promise<void> {
    return this.step().then(() => this.handle.flush())
  }

  /** Drain, then release the remote write ownership. Idempotent. */
  close(): Promise<void> {
    if (this.closedFlag) return this.chain
    this.closedFlag = true
    this.chain = this.step().then(
      () => this.handle.close(),
      () => this.handle.close().catch(() => {}),
    ).finally(() => { this.onClosed() })
    return this.chain
  }
}

/**
 * The handle a routed session's owner gets. It exists for one reason: the
 * agent loop commits its closing events into the session *synchronously* and
 * then closes the handle, relying on close to drain them durably (the official
 * backend behaves that way). Buffered live events must therefore be sent
 * before the close RPC, including for explicit appends, which must not
 * overtake buffered live ones.
 */
class DrainedHandle implements SessionHandle {
  constructor(
    private readonly inner: SessionHandle,
    private readonly writer: RemoteLiveWriter,
    /** A borrower shares the writer's ownership: closing must not release it. */
    private readonly borrowed: boolean,
  ) {}

  get id(): SessionId { return this.inner.id }
  get header(): SessionHeader { return this.inner.header }
  get access(): SessionAccess { return this.inner.access }
  get inheritedEventCount(): SessionLogOffset { return this.inner.inheritedEventCount }

  read(offset?: number, length?: number, options?: SessionHandleReadOptions): Promise<SessionHandleReadResult> {
    return this.inner.read(offset, length, options)
  }

  async append(events: readonly SessionEvent[], options?: SessionHandleAppendOptions): Promise<void> {
    await this.writer.drain()
    await this.inner.append(events, options)
  }

  flush(_options?: SessionHandleFlushOptions): Promise<void> {
    return this.writer.flush()
  }

  async close(): Promise<void> {
    // A borrower only flushes: the owning handle stays open for the session
    // that is actually running on it.
    if (this.borrowed) { await this.writer.drain(); return }
    await this.writer.close()
  }

  readonly [Symbol.asyncDispose] = async (): Promise<void> => { await this.close() }
}

const ROUTING_MARKER = Symbol.for('dsh-remote-workspace.routing-persistence')

export default class RoutingSessionPersistence extends SessionPersistence {
  /**
   * Deliberately NO `static inject = ['remoteWorkspaces']`: the row provides
   * `sessionPersistence`, which the workspace registry itself consumes — an
   * inject edge here makes the registry wait on us while we wait on it, and
   * nothing ever activates. `remotesService()` resolves lazily per call
   * instead; cordis activates the provider on demand.
   *

  /**
   * Activation self-check marker. The row module and the plugin entry are
   * separate bundle copies, so `instanceof` cannot work across them; a global
   * symbol field can.
   */
  readonly routingMarker = ROUTING_MARKER

  static Config = undefined

  private readonly local: JsonlSessionPersistence
  private readonly remotes = new Map<WorkspaceId, RemotePersistence>()
  /** Open remote write handles by session id — the live-event routing key. */
  private readonly writers = new Map<string, RemoteLiveWriter>()

  constructor(ctx: Context, config: RoutingPersistenceConfig) {
    super(ctx)
    // The delegate must not register anything (the service name is ours now),
    // so its constructor runs against a stub and only its real context is
    // restored afterwards — the JSONL backend uses `this.ctx` solely for
    // torn-tail warnings.
    this.local = Reflect.construct(JsonlSessionPersistence, [
      registrationAbsorbingContext(),
      { root: config.root, ...(config.compression === undefined ? {} : { compression: config.compression }) },
    ])
    ;(this.local as unknown as { ctx: Context }).ctx = ctx
    // The embedded backend installs its live-session routing (`session/event` →
    // its write handle, drain on `session/flush`, final drain on
    // `session/disposed`) **in its constructor** — which ran against the stub
    // context above, where `on`/`effect` are no-ops. Without this re-install no
    // backend at all would route live events, so even ordinary LOCAL sessions
    // would keep only their seed on disk.
    ;(this.local as unknown as { tracker: { install(ctx: Context): void } }).tracker.install(ctx)
    // Remote sessions are not in that backend's writer registry (it never saw a
    // handle for them), so the routing mirrors the same three hooks for the
    // remote plane. Exactly one of the two paths owns any given session id.
    const writers = this.writers
    ctx.on('session/event', (session: { readonly id: SessionId }, event: SessionEvent) => {
      writers.get(String(session.id))?.enqueue(event)
    })
    ctx.on('session/flush', (session: { readonly id: SessionId }) => {
      return writers.get(String(session.id))?.flush()
    })
    ctx.on('session/disposed', (session: { readonly id: SessionId }) => {
      const key = String(session.id)
      const writer = writers.get(key)
      if (writer === undefined) return undefined
      writers.delete(key)
      return writer.close()
    })
  }

  private remotesService(): RoutingRemoteService | undefined {
    return this.ctx.get('remoteWorkspaces') as RoutingRemoteService | undefined
  }

  private remoteFor(route: SessionRoute): RemotePersistence | undefined {
    const service = this.remotesService()
    if (service === undefined) return undefined
    let remote = this.remotes.get(route.workspaceId)
    if (remote === undefined) {
      // `RemotePersistence` extends the official SessionPersistence, whose base
      // constructor registers itself under `sessionPersistence` — with the
      // stub context that registration is absorbed (this routing instance owns
      // the name), and the real context is restored right after.
      const created = Reflect.construct(RemotePersistence, [
        registrationAbsorbingContext(),
        {
          request: <T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> =>
            service.sessionRequest<T>(route.targetId, method, params, signal),
        },
        route.workspaceId,
        // The stub keeps a resumed session's header anchored on this machine.
        // Resolved per call: the workspace may only be materialized *after*
        // this instance was created by an earlier observe/stat.
        () => service.stubForWorkspace(route.workspaceId),
      ]) as RemotePersistence
      ;(created as unknown as { ctx: Context }).ctx = this.ctx
      remote = created
      this.remotes.set(route.workspaceId, remote)
    }
    return remote
  }

  /** Wrap one freshly opened remote write handle so its live events reach it. */
  private routeLive(handle: SessionHandle): SessionHandle {
    const key = String(handle.id)
    const writer = new RemoteLiveWriter(
      handle,
      (message) => { this.ctx.logger.warn(message) },
      () => { if (this.writers.get(key) === writer) this.writers.delete(key) },
    )
    this.writers.set(key, writer)
    return writer.wrap()
  }

  override async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    const route = this.remotesService()?.routeForCwd(header.cwd)
    if (route !== undefined) {
      const remote = this.remoteFor(route)
      // The server rewrites the header cwd to the workspace path anyway; a
      // missing cwd only satisfies the wire type.
      if (remote !== undefined) return this.routeLive(await remote.create({ ...header, cwd: header.cwd ?? '' }, options))
    }
    return await this.local.create(header, options)
  }

  override async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    const route = await this.remotesService()?.locateRemoteSession(id)
    if (route !== undefined) {
      const remote = this.remoteFor(route)
      // Only a write open is a mutation target; a read handle never receives
      // live events, so wrapping it would only add a layer.
      if (remote !== undefined) {
        if (access === 'write') {
          const live = this.writers.get(String(id))
          // A concurrent write open of the same session shares the live
          // handle: the server's official backend allows exactly one writer,
          // and a second `persist.open` would fail the session for both
          // callers with `already owned by an active write handle`.
          if (live !== undefined && !live.closed) return live.borrow()
        }
        const handle = await remote.open(id, access, options)
        return access === 'write' ? this.routeLive(handle) : handle
      }
    }
    return await this.local.open(id, access, options)
  }

  override async stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined> {
    const route = await this.remotesService()?.locateRemoteSession(id)
    if (route !== undefined) {
      const remote = this.remoteFor(route)
      if (remote !== undefined) return await remote.stat(id, options)
    }
    return await this.local.stat(id, options)
  }

  override async list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    // Local only by design: remote sessions belong to the plugin panel.
    return await this.local.list(options)
  }

  override async flush(): Promise<void> {
    await this.local.flush()
    for (const remote of this.remotes.values()) await remote.flush().catch(() => {})
  }
}
