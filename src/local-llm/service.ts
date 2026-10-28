/**
 * Lifecycle owner for the client-local model path of **one target**.
 *
 * A `local` model source needs two ephemeral pieces per live profile:
 *
 * 1. the loopback bridge — the pass-through proxy for a manual endpoint
 *    (`bridge.ts`), or the native provider bridge for the automatic source
 *    (`native.ts`), and
 * 2. the SSH reverse tunnel that maps a server-loopback port to this bridge.
 *
 * Both are created only after the connect flow validated the source and the
 * profile files were installed, and both are torn down together on stop,
 * reconnect and connect failure so a canceled connect never leaks a port.
 */
import type { TargetStore } from '../targets/store.ts'
import { effectiveModelSource } from '../targets/types.ts'
import { startLocalLlmBridge, type LocalLlmBridge } from './bridge.ts'
import { startNativeLlmBridge, type NativeLlmBridge, type NativeLlmRuntime } from './native.ts'
import {
  LOCAL_LLM_DISPLAY_NAME,
  localModelRouteId,
  type LocalModelRoute,
} from './profile.ts'
import { catalogDisplayModels, LocalLlmError, planLocalLlm, type LocalLlmPlan } from './settings.ts'
import type { RemoteForward, RemoteForwardCapable } from './tunnel.ts'

/** Either bridge implementation can fulfil this handle. */
export interface LocalBridgeHandle {
  readonly port: number
  close(): Promise<void>
}

/** What the profile patch and the caller need after a successful prepare. */
export interface LocalLlmPrepared {
  /** Which source this profile was prepared for. */
  readonly mode: 'auto' | 'manual'
  /** The bridge's client-host loopback port (the tunnel dials it). */
  readonly bridgePort: number
  /** The server-loopback host the profile's routes must use. */
  readonly remoteHost: '127.0.0.1'
  /** The random server-loopback port sshd bound (goes into the patch). */
  readonly remotePort: number
  /** Routes to declare in the profile patch (first = default model). */
  readonly routes: readonly LocalModelRoute[]
  /** Display model ids the profile advertises (preference order). */
  readonly models: readonly string[]
}

/** One live bridge + reverse tunnel pair. */
interface LiveLocalLlm {
  readonly bridge: LocalBridgeHandle
  readonly forward: RemoteForward
  readonly models: readonly string[]
}

/** Construction options for {@link LocalLlmService}. */
export interface LocalLlmServiceOptions {
  /** Resolves the client host's model runtime on demand (may appear late). */
  readonly llm?: () => NativeLlmRuntime | undefined
}

/**
 * Per-target owner of the local model path.
 *
 * `prepare` is a no-op for a `server` model source; for `local` it loads the
 * plan (discovering the automatic catalog or probing the manual endpoint),
 * starts the matching bridge, asks the connection for the reverse tunnel and
 * returns the random remote port plus the routes for the profile patch.
 */
export class LocalLlmService {
  private readonly live = new Map<string, LiveLocalLlm>()

  constructor(
    private readonly store: TargetStore,
    private readonly options: LocalLlmServiceOptions = {},
  ) {}

  /** Whether a bridge + tunnel pair is currently live for `targetId`. */
  has(targetId: string): boolean {
    return this.live.has(targetId)
  }

  /**
   * Bring up the local model path for one target.
   * @param targetId - target record id.
   * @param connection - an SSH connection that can open reverse tunnels.
   * @param plan - an already-loaded plan (the connect flow validates before
   *   installing profile files); loaded from storage when omitted.
   * @returns the tunnel port + routes, or `undefined` for a `server` source.
   * @throws LocalLlmError when the source is unconfigured/unreachable or the
   *   SSH server refuses the reverse tunnel; nothing stays listening then.
   */
  async prepare(
    targetId: string,
    connection: RemoteForwardCapable,
    plan?: LocalLlmPlan,
  ): Promise<LocalLlmPrepared | undefined> {
    const resolved = plan ?? (await this.loadPersistedPlan(targetId))
    if (resolved === undefined) return undefined
    // Replace, never stack: a reconnect of the same target drops the old pair.
    await this.teardown(targetId)
    const bridge = await this.startBridge(resolved)
    try {
      if (connection.remoteForward === undefined) {
        throw new LocalLlmError(
          'local-llm-forwarding-unavailable',
          'the SSH connection for this target does not support reverse tunnels',
        )
      }
      const forward = await connection.remoteForward({ listenHost: '127.0.0.1', targetPort: bridge.port })
      const routes = this.routesFor(resolved)
      this.live.set(targetId, { bridge, forward, models: [...resolved.models] })
      return {
        mode: resolved.mode,
        bridgePort: bridge.port,
        remoteHost: '127.0.0.1',
        remotePort: forward.port,
        routes,
        models: [...resolved.models],
      }
    } catch (error) {
      await bridge.close().catch(() => undefined)
      throw error
    }
  }

  /** Stop the bridge + tunnel for one target (idempotent). */
  async teardown(targetId: string): Promise<void> {
    const entry = this.live.get(targetId)
    if (entry === undefined) return
    this.live.delete(targetId)
    await Promise.allSettled([entry.forward.close(), entry.bridge.close()])
  }

  /** Stop every live local model path. */
  async close(): Promise<void> {
    await Promise.allSettled([...this.live.keys()].map(async targetId => await this.teardown(targetId)))
  }

  /** Start the bridge matching the plan's mode. */
  private async startBridge(plan: LocalLlmPlan): Promise<LocalBridgeHandle> {
    if (plan.mode === 'auto') {
      const llm = this.options.llm?.()
      if (llm === undefined || plan.catalog === undefined) {
        throw new LocalLlmError(
          'local-llm-unavailable',
          'the client host does not expose its model runtime; the automatic local model source cannot start',
        )
      }
      const bridge: NativeLlmBridge = await startNativeLlmBridge({
        llm,
        catalog: plan.catalog,
        timeoutMs: plan.settings?.timeoutMs,
      })
      return { port: bridge.port, close: async () => { await bridge.close() } }
    }
    if (plan.settings === undefined) {
      throw new LocalLlmError('local-llm-unconfigured', 'the local model endpoint has no saved settings')
    }
    const bridge: LocalLlmBridge = await startLocalLlmBridge({
      baseUrl: plan.settings.baseUrl,
      ...(plan.apiKey === undefined ? {} : { apiKey: plan.apiKey }),
      timeoutMs: plan.settings.timeoutMs,
    })
    return { port: bridge.port, close: async () => { await bridge.close() } }
  }

  /** Turn one plan into the routes the profile patch declares. */
  private routesFor(plan: LocalLlmPlan): LocalModelRoute[] {
    if (plan.mode === 'manual') {
      return [{
        id: 'client-local',
        displayName: LOCAL_LLM_DISPLAY_NAME,
        pathPrefix: '',
        models: plan.models.map(id => ({ id, name: id })),
      }]
    }
    const used = new Set<string>()
    const catalog = plan.catalog
    if (catalog === undefined) return []
    return catalog.providers.map(provider => ({
      id: localModelRouteId(provider.id, used),
      displayName: provider.name,
      pathPrefix: `/${encodeURIComponent(provider.id)}`,
      models: provider.models.map(model => ({ id: model.id, name: model.name })),
    }))
  }

  /** Load a persisted `local` plan; `undefined` means this target uses server models. */
  private async loadPersistedPlan(targetId: string): Promise<LocalLlmPlan | undefined> {
    const record = this.store.target(targetId)
    if (record === undefined || effectiveModelSource(record) !== 'local') return undefined
    const llm = this.options.llm?.()
    return await planLocalLlm(this.store, llm === undefined ? {} : { llm })
  }
}

/** Display ids for a plan (progress messages). */
export function planDisplayModels(plan: LocalLlmPlan): readonly string[] {
  return plan.mode === 'auto' && plan.catalog !== undefined
    ? catalogDisplayModels(plan.catalog)
    : plan.models
}
