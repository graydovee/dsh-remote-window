/**
 * Root-context session persistence routed by session cwd.
 *
 * This module is provided by the plugin's own `apply()` on the service name the
 * bundle's cordis.patch.yml frees by disabling the official JSONL row (a patch
 * row cannot swap a row's `name`, and an inserted replacement row was never
 * constructed — see AGENTS.md "会话持久层的路由接线"). Routing exists because
 * the agent loop resolves `sessionPersistence` on the HOST plane — a
 * preset-realm provide never reaches it (measured against dsh 0.2.0-rc.1,
 * 2026-10-15) — so the only way a remote-workspace session can persist to the
 * remote server is for the host-level service itself to route.
 *
 * Routing rule, evaluated per call:
 * - `create(header)`: the header cwd of a remote-workspace session is its
 *   private local anchor; a registered anchor routes to that workspace's
 *   profile server (P1 `persist/create`). Any other cwd delegates to the
 *   embedded official JSONL backend with the same root — local sessions are
 *   stored byte-for-byte as before.
 * - `open`/`stat`: session ids carry no cwd, so the route comes from the
 *   host facade (`persist/locate`) across the targets with live profiles; a
 *   miss delegates locally.
 * - `list`: local only. Remote sessions are listed by the plugin panel through
 *   the server's `session/list`; they must not leak into the shell's global
 *   session list.
 *
 * Remote write ownership is the official backend's own handle lease running on
 * the server (one writer per session; a second device's write open rejects
 * with the ownership error), so no client-side locking is added.
 *
 * v1: a remote session's cwd is a plugin-private anchor
 * (`<DSH_HOME>/remote-workspaces/<clientId>/<targetId>/<hash>`), and the
 * facade resolves it to the server workspace / `remoteCwd`. The retired
 * stdio plane is gone; `list` remains local-only so the server-owned rows never
 * leak into the client shell's global session list.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { apply as applyJsonl } from '@deepseek-ai/dsh-session-persistence-jsonl'
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
import { remotePresetId } from '../preset/world.ts'

/** Row configuration — mirrors the official JSONL row's keys (whole-row replace). */
export interface RoutingPersistenceConfig {
  readonly root: string
  readonly compression?: 'none' | 'zstd'
}

/**
 * Resolve the official local session root for the embedded JSONL backend.
 *
 * The base profile configures its own JSONL row with
 * `dshHomePath('sessions')`, so this plugin must resolve the same directory
 * (honouring an explicit `DSH_HOME`), not `homedir()/sessions`. The latter is
 * `~/sessions`: the official backend then reads an empty list while every real
 * log sits under `~/.dsh/sessions`, which looks exactly like "all sessions
 * disappeared" to the user.
 *
 * @param ctx - host context; `dshHomePath` is the app-boot service when mounted.
 * @param env - environment used for the fallback, injectable for tests.
 * @returns the absolute directory the local backend should read and write.
 */
export function localSessionRoot(
  ctx: Pick<Context, 'get'>,
  env: Record<string, string | undefined> = process.env,
): string {
  const dshHomePath = ctx.get('dshHomePath') as ((...segments: string[]) => string) | undefined
  if (typeof dshHomePath === 'function') return dshHomePath('sessions')
  const configured = env['DSH_HOME']?.trim()
  return join(configured !== undefined && configured !== '' ? configured : join(homedir(), '.dsh'), 'sessions')
}

/** Where one remote session lives. */
export interface SessionRoute {
  readonly targetId: string
  /** Server workspace id (official registry uuid, used as the remote cache key). */
  readonly workspaceId: string
  /**
   * Server-real workspace path (`persist/locate` / `workspace/list`).
   * `persist/create` requires it.
   */
  readonly remoteCwd?: string
}

/**
 * The slice of the plugin's host-plane service the routing needs. Declared
 * structurally (not imported) so this module stays decoupled from the store.
 * Exported because dev-core builds the v1 facade and mounts this persistence in
 * its `apply()` — one factory, not two copies of the routing.
 */
export interface RoutingRemoteService {
  routeForCwd(cwd: string | undefined): SessionRoute | undefined
  locateRemoteSession(sessionId: string): Promise<SessionRoute | undefined>
  sessionRequest<T>(targetId: string, method: string, params: unknown, signal?: AbortSignal): Promise<T>
  /** The private local anchor a remote workspace stands for, when materialized. */
  stubForWorkspace(workspaceId: string): string | undefined
  /** Server-real path of one workspace (P1 `workspace/list`); required by `persist/create`. */
  remotePathForWorkspace(workspaceId: string): string | undefined
}

/**
 * A context stub that absorbs a base class' self-registration.
 *
 * Only the remote façade still needs it: `RemotePersistence` extends the
 * official `SessionPersistence`, whose constructor registers the instance under
 * `sessionPersistence`, and the routing owns that name. The embedded *local*
 * backend no longer needs a stub — it is mounted into an isolated scope instead.
 */
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

/**
 * Scope label for the embedded local backend's service registration.
 *
 * `isolate()` joins every call carrying the same label, so all routing
 * instances in one process share one local backend instead of racing to register
 * a second one.
 */
const LOCAL_SCOPE = Symbol.for('dsh-remote-workspace.local-persistence')

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

  /**
   * The embedded official JSONL backend, resolved asynchronously.
   *
   * dsh 0.2.1-rc.2 turned the JSONL backend into a *plugin row*
   * (`apply(ctx, config)`) with no exported class, so it can no longer be
   * constructed against a stub context. It now registers `sessionPersistence`
   * on whatever context it is mounted on and installs its live-event tracker
   * there; mounting it into a **service-isolated** child scope keeps our own
   * `sessionPersistence` name intact. Its tracker still observes every
   * `session/event` because cordis dispatches to all subscribers unless the
   * dispatcher supplies a service filter.
   */
  private readonly localReady: Promise<SessionPersistence>
  private readonly remotes = new Map<string, RemotePersistence>()
  /** Open remote write handles by session id — the live-event routing key. */
  private readonly writers = new Map<string, RemoteLiveWriter>()
  /** Where each session this process has seen lives; see {@link routeOf}. */
  private readonly routes = new Map<string, SessionRoute>()

  /**
   * @param ctx - host context (the root tree every consumer resolves against).
   * @param config - the embedded official JSONL backend's root/compression.
   * @param injectedRemote - the host facade, when the caller owns its lifetime.
   *   Omitted: resolved lazily from `ctx.get('remoteWorkspaces')`.
   */
  constructor(ctx: Context, config: RoutingPersistenceConfig, private readonly injectedRemote?: RoutingRemoteService) {
    super(ctx)
    this.localReady = (async (): Promise<SessionPersistence> => {
      const scope = ctx.isolate('sessionPersistence', LOCAL_SCOPE)
      await applyJsonl(scope, {
        root: config.root,
        ...(config.compression === undefined ? {} : { compression: config.compression }),
      })
      const local = scope.get('sessionPersistence') as SessionPersistence | undefined
      if (local === undefined) throw new Error('the embedded JSONL persistence did not register its service')
      return local
    })()
    // A mount failure must surface at the first local call (where a caller can
    // report it), not as an unhandled rejection that could take the process down.
    void this.localReady.catch(() => {})
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

  /** The embedded backend, once mounted. */
  private local(): Promise<SessionPersistence> {
    return this.localReady
  }

  private remotesService(): RoutingRemoteService | undefined {
    return this.injectedRemote ?? (this.ctx.get('remoteWorkspaces') as RoutingRemoteService | undefined)
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
        // The anchor keeps a resumed session's header usable on this machine.
        // Resolved per call: the workspace may only be materialized *after*
        // this instance was created by an earlier observe/stat.
        () => service.stubForWorkspace(route.workspaceId),
        {
          // P1 `persist/create` needs the server path. Prefer the freshly read
          // server state over the route snapshot (a cached path is diagnostic).
          remoteCwdOf: () => service.remotePathForWorkspace(route.workspaceId) ?? route.remoteCwd,
          // Header preset is client-local: re-anchor it on this connection's
          // preset so a second client (or a re-minted target id) can resume the
          // same server log in its own execution world. The stored copy is
          // server-authoritative and untouched.
          agentPresetOf: () => remotePresetId(route.targetId),
        },
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
      if (remote !== undefined) {
        const handle = await remote.create(header, options)
        // Remember where it landed: the very next `open`/`stat` for a session
        // this process just created must not depend on a server-side locate
        // round-trip. A miss there falls back to the *local* store and answers
        // `session "…" not found` for a session that plainly exists remotely.
        this.routes.set(String(handle.id), route)
        return this.routeLive(handle)
      }
    }
    return await (await this.local()).create(header, options)
  }

  override async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    const route = await this.routeOf(id)
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
        this.routes.set(String(id), route)
        return access === 'write' ? this.routeLive(handle) : handle
      }
    }
    return await (await this.local()).open(id, access, options)
  }

  override async stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined> {
    const route = await this.routeOf(id)
    if (route !== undefined) {
      const remote = this.remoteFor(route)
      if (remote !== undefined) return await remote.stat(id, options)
    }
    return await (await this.local()).stat(id, options)
  }

  /**
   * Where one session lives: the process-local table first, then the server.
   *
   * `persist.locate` is only consulted for ids this process has not seen. The
   * table is authoritative for the process lifetime because a remote session
   * cannot move between workspaces (its log lives under one project key).
   */
  private async routeOf(id: SessionId): Promise<SessionRoute | undefined> {
    const known = this.routes.get(String(id))
    if (known !== undefined) return known
    const route = await this.remotesService()?.locateRemoteSession(id)
    if (route !== undefined) this.routes.set(String(id), route)
    return route
  }

  override async list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    // Local only by design: remote sessions belong to the plugin panel.
    return await (await this.local()).list(options)
  }

  override async flush(): Promise<void> {
    await (await this.local()).flush()
    for (const remote of this.remotes.values()) await remote.flush().catch(() => {})
  }
}

/**
 * Build the routing persistence against an explicit host-plane facade.
 *
 * dev-core's v1 `apply()` owns the facade (`remoteWorkspaces` with the P1
 * methods) and must mount this same instance under the `sessionPersistence`
 * service name; providing the factory here keeps the routing (and its
 * re-anchoring/lease-borrowing rules) in one module.
 * @param ctx - host context in the root tree.
 * @param config - local JSONL root and compression.
 * @param remote - the host facade (`remoteWorkspaces`).
 * @returns the constructed routing persistence (self-registers under `sessionPersistence`).
 */
export function createRoutingPersistence(
  ctx: Context,
  config: RoutingPersistenceConfig,
  remote: RoutingRemoteService,
): RoutingSessionPersistence {
  return new RoutingSessionPersistence(ctx, config, remote)
}
