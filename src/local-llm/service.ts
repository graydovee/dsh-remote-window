/**
 * Lifecycle owner for the client-local model path of **one target**.
 *
 * A `local` model source needs two ephemeral pieces per live profile:
 *
 * 1. the loopback {@link LocalLlmBridge} (key injection + path allowlist), and
 * 2. the SSH reverse tunnel that maps a server-loopback port to this bridge.
 *
 * Both are created only after the connect flow validated the endpoint and the
 * profile files were installed, and both are torn down together on stop,
 * reconnect and connect failure so a canceled connect never leaks a port.
 */
import type { TargetStore } from '../targets/store.ts'
import { effectiveModelSource } from '../targets/types.ts'
import { startLocalLlmBridge, type LocalLlmBridge } from './bridge.ts'
import { LocalLlmError, planLocalLlm, type LocalLlmPlan } from './settings.ts'
import type { RemoteForward, RemoteForwardCapable } from './tunnel.ts'

/** What the profile patch and the caller need after a successful prepare. */
export interface LocalLlmPrepared {
  /** The bridge's client-host loopback port (the tunnel dials it). */
  readonly bridgePort: number
  /** The server-loopback host the profile's `client-local` route must use. */
  readonly remoteHost: '127.0.0.1'
  /** The random server-loopback port sshd bound (goes into the patch). */
  readonly remotePort: number
  /** The model ids the profile patch advertises (preference order). */
  readonly models: readonly string[]
}

/** One live bridge + reverse tunnel pair. */
interface LiveLocalLlm {
  readonly bridge: LocalLlmBridge
  readonly forward: RemoteForward
  readonly models: readonly string[]
}

/**
 * Per-target owner of the local model path.
 *
 * `prepare` is a no-op for a `server` model source; for `local` it loads the
 * settings (probing `/v1/models` when the model list is empty), starts the
 * bridge, asks the connection for the reverse tunnel and returns the random
 * remote port for the profile patch.
 */
export class LocalLlmService {
  private readonly live = new Map<string, LiveLocalLlm>()

  constructor(private readonly store: TargetStore) {}

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
   * @returns the tunnel port + models, or `undefined` for a `server` source.
   * @throws LocalLlmError when the endpoint is unconfigured/unreachable or the
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
    const bridge = await startLocalLlmBridge({
      baseUrl: resolved.settings.baseUrl,
      ...(resolved.apiKey === undefined ? {} : { apiKey: resolved.apiKey }),
      timeoutMs: resolved.settings.timeoutMs,
    })
    try {
      if (connection.remoteForward === undefined) {
        throw new LocalLlmError(
          'local-llm-forwarding-unavailable',
          'the SSH connection for this target does not support reverse tunnels',
        )
      }
      const forward = await connection.remoteForward({ listenHost: '127.0.0.1', targetPort: bridge.port })
      this.live.set(targetId, { bridge, forward, models: [...resolved.models] })
      return {
        bridgePort: bridge.port,
        remoteHost: '127.0.0.1',
        remotePort: forward.port,
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

  /** Load a persisted `local` plan; `undefined` means this target uses server models. */
  private async loadPersistedPlan(targetId: string): Promise<LocalLlmPlan | undefined> {
    const record = this.store.target(targetId)
    if (record === undefined || effectiveModelSource(record) !== 'local') return undefined
    return await planLocalLlm(this.store)
  }
}
