/**
 * The `ctx.ssh` implementation mounted inside one remote world's realm.
 *
 * The official SSH providers (`dsh-fs-ssh`, `dsh-subprocess-ssh`,
 * `dsh-sandbox-ssh`) only ever call `request()`, `connectStream()` and
 * `dispose()`, so implementing that surface is all it takes to make the whole
 * official execution stack run against a remote host. Two differences from the
 * official connection are deliberate:
 *
 * - **Lazy**: constructing the row validates configuration only. An unreachable
 *   host must not break the preset (a preset mount failure is permanent), so the
 *   first operation starts the remote server.
 * - **Transport-agnostic**: the byte channel comes from the host-plane
 *   `remoteWorkspaces` service, which owns `ssh2`, host-key verification and
 *   profile provisioning. The realm never sees a credential.
 */
import { z } from 'zod'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import { Duplex } from 'node:stream'
import type { SshStreamEndpoint } from '@deepseek-ai/dsh-ssh/schemas'
import type { RemoteMux, RemoteMuxStream } from '../remote/mux-client.ts'

/**
 * v1 execution-world client provided by dev-core (protocol §16.7/§16.9).
 *
 * `ctx.remoteMux` routes one target to its own WS/FrameMux backend; the realm
 * only needs one RPC round-trip and one stream attach. `RemoteMuxStream` is
 * adapted to a paused `Duplex`, the surface the official `*-ssh` providers
 * consume (pipe/end/destroy/close).
 */

/** What one realm-scoped connection needs to know; no secret is ever a field. */
export interface Config {
  /** Target record id owned by the host-plane store. */
  targetId: string
  /** Human-readable label used in diagnostics. */
  label?: string
  /** Administrative request deadline. */
  requestTimeoutMs?: number
  /** Maximum JSON payload bytes per request or response. */
  maxFrameBytes?: number
  /** Maximum ordinary in-flight requests. */
  maxPending?: number
  /** Remote server lease; loss of heartbeats starts remote cleanup. */
  leaseMs?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context { ssh: RemoteConnection }
}

/** One non-reconnecting connection to a remote execution world. */
export default class RemoteConnection extends Service {
  static inject = ['remoteMux']
  static Config: Schema<Config> = Schema.object({
    targetId: Schema.string().required().description('Remote target record id owned by the plugin store.'),
    label: Schema.string().description('Human-readable target label for diagnostics.'),
    requestTimeoutMs: Schema.number().default(30_000),
    maxFrameBytes: Schema.number().default(64 * 1024 * 1024),
    maxPending: Schema.number().default(128),
    leaseMs: Schema.number().default(30_000),
  })

  private readonly config: Required<Omit<Config, 'label'>> & Pick<Config, 'label'>
  private readonly lifetime = new AbortController()
  private connecting: Promise<void> | undefined
  /** v1 execution-world service provided by dev-core. */
  private mux: RemoteMux | undefined
  private failure: Error | undefined
  private closing = false
  private disposal: Promise<void> | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'ssh')
    this.config = zod.object({
      targetId: zod.string().min(1),
      label: zod.string().optional(),
      requestTimeoutMs: zod.number().int().positive().max(2_147_483_647),
      maxFrameBytes: zod.number().int().positive().max(64 * 1024 * 1024),
      maxPending: zod.number().int().positive().max(128),
      leaseMs: zod.number().int().min(3000).max(600_000),
    }).parse(config)
    ctx.effect(() => () => this.dispose())
  }

  /**
   * Readiness is intentionally immediate: the remote server starts on the first
   * operation, so an offline host cannot make the preset permanently broken.
   */
  async [Service.init](): Promise<void> {
    if (this.ctx.get('remoteMux') === undefined) {
      throw new Error(`remote target "${this.config.targetId}" has no execution-world mux service`)
    }
  }

  /**
   * Verified remote PTC launch coordinates.
   *
   * The official `SshConnection` surface (dsh-ssh 0.2.1-rc.2) replaced the
   * separate `nodeExecutable` / `bootstrapPath` getters with this union, and the
   * hello it validates now carries `kind` + `executable` instead of `node`. This
   * world is a `node-script` deployment whose PTC bootstrap is never
   * provisioned, so PTC stays unsupported exactly as before — no installed
   * provider reads this member, so the refusal cannot break a session.
   */
  get ptcLaunch(): { kind: 'embedded'; executable: string } | { kind: 'node-script'; executable: string; bootstrapPath: string } {
    // v1 keeps the official PTC bootstrap unsupported: nothing in this world
    // provisions it, and no installed provider reads this member.
    throw new Error('remote PTC is not supported by dsh-remote-workspace v1')
  }

  /** The verified remote handshake, connecting on first access. */
  get ready(): Promise<void> {
    this.connecting ??= this.start()
    return this.connecting
  }

  /**
   * Send one remote operation; cancellation never replays an ambiguous mutation.
   * @param method - the helper-compatible operation name.
   * @param params - JSON request fields.
   * @param result - response validation before callers see data.
   * @param signal - cancellation, which does not undo completed remote effects.
   * @param wait - allow a process observation to outlast the administrative deadline.
   * @returns the validated remote result.
   */
  async request<T>(method: string, params: unknown, result: z.ZodType<T>, signal?: AbortSignal, wait = false): Promise<T> {
    this.assertOpen()
    await this.ready
    this.assertOpen()
    const outgoing = this.translateWorkspaceAliases(params)
    const bounded = wait
      ? signal
      : signal === undefined
        ? AbortSignal.timeout(this.config.requestTimeoutMs)
        : AbortSignal.any([signal, AbortSignal.timeout(this.config.requestTimeoutMs)])
    const mux = await this.muxService()
    const raw = await mux.request<unknown>(this.config.targetId, method, outgoing, bounded)
    return result.parse(raw)
  }

  /** RPC seam used by the realm-scoped RemotePersistence provider. */
  async remoteSessionRequest<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
    return await this.request(method, params, z.unknown() as z.ZodType<T>, signal)
  }

  /**
   * Rewrite stub-workspace paths into their remote counterparts across every
   * string value in the request params.
   *
   * Workspace-anchored sessions carry the shell-side cwd — a local stub
   * directory (official workspaces are local-realpath'd) — while the remote
   * world only knows the real directory. The official SSH providers pass the
   * session cwd explicitly on every call (`fs.resolve {cwd}`, spawn `{cwd}`,
   * policy `{workspaceRoot}`, ...), and this connection is the single seam
   * all of them cross, so the alias rewrite here covers every method.
   * Command strings *inside* argv are deliberately untouched; the seeded
   * system context and error feedback push the agent toward real paths.
   */
  private translateWorkspaceAliases(params: unknown): unknown {
    let aliases: { stub: string; remote: string }[] | undefined
    const walk = (value: unknown): unknown => {
      if (typeof value === 'string') {
        for (const alias of aliases ?? []) {
          if (value === alias.stub) return alias.remote
          if (value.startsWith(alias.stub + '/')) return alias.remote + value.slice(alias.stub.length)
        }
        return value
      }
      if (Array.isArray(value)) return value.map(item => walk(item))
      if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, walk(item)]))
      }
      return value
    }
    try {
      const workspaces = this.ctx.get('remoteWorkspaces') as { pathAliases?(targetId: string): { stub: string; remote: string }[] } | undefined
      aliases = workspaces?.pathAliases?.(this.config.targetId)
    } catch {
      return params
    }
    if (aliases === undefined || aliases.length === 0) return params
    return walk(params)
  }

  /**
   * Attach one authenticated logical stream.
   * @param endpoint - coordinates issued by this connection's remote server.
   * @param signal - cancellation of allocation and the resulting stream.
   * @returns a duplex; attach a consumer before writing large payloads.
   */
  async connectStream(endpoint: SshStreamEndpoint, signal?: AbortSignal): Promise<import('node:net').Socket> {
    await this.ready
    this.assertOpen()
    const combined = signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal])
    combined.throwIfAborted()
    // The server mux's FRAME_OPEN carries the endpoint's official capability
    // (64-hex, minted by `process.prepare` / the hello root); the path alone is
    // not enough to admit the stream.
    const mux = await this.muxService()
    const stream = await mux.openStream(this.config.targetId, endpoint.path, { capability: endpoint.capability })
    combined.throwIfAborted()
    return muxStreamSocket(stream) as unknown as import('node:net').Socket
  }

  /** Close the remote server channel and release every stream. */
  dispose(): Promise<void> {
    this.disposal ??= this.disposeOnce()
    return this.disposal
  }

  private async disposeOnce(): Promise<void> {
    this.closing = true
    this.lifetime.abort(new Error('remote workspace connection is closing'))
    // The mux service owns the per-target WS/FrameMux lifetime (and its P1
    // client shares it with the browse plane); a realm teardown drops its
    // reference only, never closing the shared transport.
    this.mux = undefined
  }

  private assertOpen(): void {
    if (this.closing) throw new Error('remote workspace connection is closed')
    if (this.failure !== undefined) throw this.failure
  }

  private fail(error: Error): void {
    if (this.failure !== undefined) return
    this.failure = error
    this.lifetime.abort(error)
    this.mux = undefined
  }

  /** Resolve the target-bound mux on every call so an SSH reconnect is visible. */
  private async muxService(): Promise<RemoteMux> {
    await this.ready
    this.assertOpen()
    const mux = this.ctx.get('remoteMux') as RemoteMux | undefined
    if (mux === undefined) throw new Error(`remote target "${this.config.targetId}" has no execution-world mux service`)
    this.mux = mux
    return mux
  }

  private async start(): Promise<void> {
    const mux = this.ctx.get('remoteMux') as RemoteMux | undefined
    if (mux === undefined) throw new Error(`remote target "${this.config.targetId}" has no execution-world mux service`)
    if (this.closing) throw new Error('remote workspace connection closed before startup')
    this.mux = mux
  }
}

/**
 * Adapt one v1 mux stream to the paused `Duplex` the official providers use.
 *
 * `RemoteMuxStream` is transport-agnostic; the providers pipe it into process
 * stdio, terminal output, or a `SshRpcPeer` (which only needs a
 * Readable+Writable pair). No extra backpressure is invented here: the mux/WS
 * layer owns flow control.
 */
function muxStreamSocket(stream: RemoteMuxStream): Duplex {
  let iterator: AsyncIterator<Uint8Array> | undefined
  let pumping = false
  const duplex = new Duplex({
    // Official forwardOut sockets are half-open: providers may end stdin while
    // still reading stdout (subprocess/terminal). Keep the readable side alive.
    allowHalfOpen: true,
    read() {
      if (pumping) return
      pumping = true
      iterator ??= stream.read()[Symbol.asyncIterator]()
      void (async () => {
        try {
          while (!duplex.destroyed) {
            const next = await iterator?.next()
            if (next === undefined || next.done === true) {
              pumping = false
              duplex.push(null)
              return
            }
            if (!duplex.push(Buffer.from(next.value))) {
              pumping = false
              return
            }
          }
        } catch (error) {
          pumping = false
          duplex.destroy(error instanceof Error ? error : new Error(String(error)))
        }
      })()
    },
    write(chunk: Buffer, _encoding, callback) {
      Promise.resolve(stream.write(chunk)).then(() => callback(), error => callback(error instanceof Error ? error : new Error(String(error))))
    },
    final(callback) {
      try {
        stream.end()
        callback()
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)))
      }
    },
    destroy(error, callback) {
      stream.abort(error?.message)
      callback(error)
    },
  })
  return duplex
}
