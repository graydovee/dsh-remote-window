/**
 * The browser → client-host API used by the v3 rail, dialogs and portal.
 *
 * Every route here is the host face; none talks to the profile server
 * directly. The envelope, error normalizer and trust fence live in `api.ts`.
 */
import { call } from './api.ts'
import type { PublicTarget, WireError } from './api.ts'
import type { RemoteSessionList, RemoteWorkspace, RemoteWorkspaceList } from './remote-data.ts'

/** Connection phase reported by the client host. */
export type ConnectionPhase = 'disconnected' | 'connecting' | 'ready' | 'degraded' | 'failed' | 'stopped'

/** Live profile-server process facts. */
export interface ConnectionProfileState {
  readonly name: string
  readonly port?: number
  readonly pid?: number
  readonly startedAt?: string
}

/** Which runtime the profile server was started from. */
export interface ConnectionRuntimeState {
  readonly kind: 'isolated' | 'global'
  readonly dshVersion?: string
  readonly launcher?: string
}

/** Installed server-plugin facts. */
export interface ConnectionPluginState {
  readonly version?: string
  readonly protocol?: number
  readonly installed: boolean
}

/** Embed hints resolved by the handshake. */
export interface EmbedCapabilities {
  readonly storagePrefix: string
  readonly mode: 'reload' | 'client-half'
  readonly parentOrigin?: string
}

/** Portal endpoints for one connected target. */
export interface PortalState {
  readonly base: string
  readonly muxPath: string
}

/** Registry revision bookkeeping (protocol §10). */
export interface RegistryStatus {
  readonly revision: string
  readonly loadedRevision: string
  readonly stale: boolean
}

/** One target's P3 connection state (`state` / `state/refresh`). */
export interface ConnectionStateV1 {
  readonly targetId: string
  readonly phase: ConnectionPhase
  readonly profile: ConnectionProfileState | null
  readonly runtime: ConnectionRuntimeState | null
  readonly plugin: ConnectionPluginState | null
  readonly embed?: EmbedCapabilities
  readonly portal: PortalState
  readonly registry?: RegistryStatus
  readonly error?: WireError
}

/** Target row as the v1 state carries it. */
export interface PublicTargetV1 extends PublicTarget {
  /** Stable client id (profile/runtime isolation). */
  readonly clientId?: string
  /** per-client profile name. */
  readonly profileName?: string
}

/** `GET /api/state` v1 (additive over the legacy shape). */
export interface StateResultV1 {
  readonly pluginVersion: string
  readonly targets: readonly PublicTargetV1[]
  /** Per-target connection state; a missing key means "not connected/never read". */
  readonly connections: Readonly<Record<string, ConnectionStateV1>>
  /** Per-target workspace list; only connected targets appear. */
  readonly workspaces: Readonly<Record<string, RemoteWorkspaceList>>
  /** Per-target session list snapshot (portal deep link without a second round trip). */
  readonly sessions?: Readonly<Record<string, RemoteSessionList>>
  readonly platform?: string
}

/** `POST /api/sessions` (workspaceId omitted = all sessions). */
export interface SessionListResult extends RemoteSessionList {}

/** `POST /api/state/refresh` value (host shape: both raw lists + stale flag). */
export interface StateRefreshResult {
  readonly workspaces: RemoteWorkspaceList
  readonly sessions: RemoteSessionList
  readonly stale: boolean
  /** Host additive: current connection state, when the implementation provides it. */
  readonly connection?: ConnectionStateV1
  /** Host additive: the registry status read with the refresh. */
  readonly registry?: RegistryStatus | null
}

/** `POST /api/session/create` value (server-mode blank/reuse). */
export interface SessionCreateResult {
  readonly sessionId: string
  readonly workspaceId?: string
  readonly executor?: 'server' | 'local'
}

/** Progress step names reported by the host during one connect attempt. */
export type ConnectProgressStep = 'connect' | 'probe' | 'runtime' | 'upload' | 'start'

/** One buffered connect-progress event. */
export interface ConnectProgressEvent {
  readonly step: ConnectProgressStep
  readonly status: 'running' | 'ok' | 'skipped' | 'failed'
  readonly message: string
  /** Pre-split observations (the probe reports one line per fact); optional. */
  readonly details?: readonly string[]
  readonly at: number
}

/** The host routes the v3 client uses. */
export const remoteApi = {
  /** Full first-paint snapshot (targets + connection states + workspace lists). */
  state(): Promise<StateResultV1> {
    return call<StateResultV1>('state', {})
  },

  /** Session list for one target; `workspaceId` omitted returns the whole account. */
  async sessions(targetId: string, workspaceId?: string): Promise<SessionListResult> {
    const value = await call<SessionListResult | { sessions: SessionListResult }>('v1/sessions', {
      targetId,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    })
    const raw = value as SessionListResult
    const wrapped = value as { sessions: SessionListResult }
    return Array.isArray(raw.sessions) ? raw : wrapped.sessions
  },

  /** The server's authoritative workspace list (host wraps the P1 value). */
  async workspaces(targetId: string): Promise<RemoteWorkspaceList> {
    const value = await call<RemoteWorkspaceList | { workspaces: RemoteWorkspaceList }>('v1/workspaces', { targetId })
    const raw = value as RemoteWorkspaceList
    const wrapped = value as { workspaces: RemoteWorkspaceList }
    return Array.isArray(raw.workspaces) ? raw : wrapped.workspaces
  },

  /** Connect one identity through the v1 host route. */
  connectV1(request: {
    readonly label: string
    readonly host: string
    readonly port: number
    readonly username: string
    readonly authKind: 'password' | 'privateKey' | 'agent'
    readonly secret?: string
    readonly privateKeyPath?: string
    readonly hostKeyFingerprint?: string
    readonly dshHome?: string
    readonly runtimePolicy?: 'auto' | 'isolated'
    readonly attemptId?: string
    /** Where the server agent's model requests are served. */
    readonly modelSource?: 'local' | 'server'
  }): Promise<{ target: PublicTargetV1; state: ConnectionStateV1 }> {
    return call<{ target: PublicTargetV1; state: ConnectionStateV1 }>('v1/connect', request)
  },

  /** Read the progress buffer for one connect attempt. */
  connectProgress(attemptId: string): Promise<{ events: ConnectProgressEvent[] }> {
    return call<{ events: ConnectProgressEvent[] }>('v1/connect/progress', { attemptId })
  },

  /**
   * Reconnect one saved target using the host-side pinned record and secret.
   *
   * `attemptId` opts the attempt into the host's progress buffer, so the dialog
   * can show the same step-by-step progress a first connection shows.
   */
  reconnect(
    targetId: string,
    options: { readonly attemptId?: string } = {},
  ): Promise<{ target: PublicTargetV1; state: ConnectionStateV1 }> {
    return call<{ target: PublicTargetV1; state: ConnectionStateV1 }>('v1/connect', {
      targetId,
      ...(options.attemptId === undefined ? {} : { attemptId: options.attemptId }),
    })
  },

  /** Delete one saved target (profile stopped, local record and secret removed). */
  forget(targetId: string): Promise<{ forgotten: true }> {
    return call<{ forgotten: true }>('forget-target', { targetId })
  },

  /** Stop one profile server through the v1 host route. */
  stop(targetId: string): Promise<{ stopped: boolean }> {
    return call<{ stopped: boolean }>('v1/stop', { targetId })
  },

  /** Server-mode new session: create/reuse a blank. */
  sessionCreate(params: {
    readonly targetId: string
    readonly workspaceId: string
  }): Promise<SessionCreateResult> {
    return call<SessionCreateResult>('session/create', {
      targetId: params.targetId,
      workspaceId: params.workspaceId,
      executor: 'server',
    })
  },

  /** Light refresh of one target; never restarts the profile (protocol §16.3). */
  stateRefresh(targetId: string): Promise<StateRefreshResult> {
    return call<StateRefreshResult>('state/refresh', { targetId })
  },
}
