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
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import {
  SessionPersistence,
  type SessionAccess,
  type SessionHandle,
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
      ]) as RemotePersistence
      ;(created as unknown as { ctx: Context }).ctx = this.ctx
      remote = created
      this.remotes.set(route.workspaceId, remote)
    }
    return remote
  }

  override async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    const route = this.remotesService()?.routeForCwd(header.cwd)
    if (route !== undefined) {
      const remote = this.remoteFor(route)
      // The server rewrites the header cwd to the workspace path anyway; a
      // missing cwd only satisfies the wire type.
      if (remote !== undefined) return await remote.create({ ...header, cwd: header.cwd ?? '' }, options)
    }
    return await this.local.create(header, options)
  }

  override async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    const route = await this.remotesService()?.locateRemoteSession(id)
    if (route !== undefined) {
      const remote = this.remoteFor(route)
      if (remote !== undefined) return await remote.open(id, access, options)
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
