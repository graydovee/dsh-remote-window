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
import { SshRpcPeer, SSH_PROTOCOL_VERSION } from '@deepseek-ai/dsh-ssh/protocol'
import { helloSchema, type SshStreamEndpoint } from '@deepseek-ai/dsh-ssh/schemas'
import { FrameMux, streamTransport } from '../frame/mux.ts'
import type { RemoteChannel, RemoteWorkspaceService } from '../targets/types.ts'

/** Wire handshake observation, matching the official helper's `hello`. */
export type RemoteHello = z.infer<typeof helloSchema>

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
  static inject = ['remoteWorkspaces']
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
  private connecting: Promise<RemoteHello> | undefined
  private rpc: SshRpcPeer | undefined
  private mux: FrameMux | undefined
  private channel: RemoteChannel | undefined
  private remote: RemoteHello | undefined
  private heartbeat: NodeJS.Timeout | undefined
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
    if (!this.ctx.get('remoteWorkspaces')) throw new Error(`remote target "${this.config.targetId}" has no workspace service`)
  }

  /** Verified remote Node executable; unavailable before the first operation. */
  get nodeExecutable(): string {
    if (this.remote === undefined) throw new Error('the remote workspace is not connected yet')
    return this.remote.node
  }

  /** PTC bootstrap entries are not provisioned in v1. */
  get bootstrapPath(): string {
    throw new Error('remote PTC is not supported by dsh-remote-workspace v1')
  }

  /** The verified remote handshake, connecting on first access. */
  get ready(): Promise<RemoteHello> {
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
    const hello = await this.ready
    this.assertOpen()
    const outgoing = this.translateWorkspaceAliases(params)
    void hello
    const bounded = wait
      ? signal
      : signal === undefined
        ? AbortSignal.timeout(this.config.requestTimeoutMs)
        : AbortSignal.any([signal, AbortSignal.timeout(this.config.requestTimeoutMs)])
    return (this.rpc as SshRpcPeer).request(method, outgoing, result, bounded)
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
    const hello = await this.ready
    this.assertOpen()
    const remote = endpoint.path
    if (!remote.startsWith(`${hello.root}/`) || /[:\r\n\0]/u.test(remote)) {
      throw new Error('the remote server returned an invalid stream path')
    }
    const combined = signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal])
    combined.throwIfAborted()
    const stream = await (this.mux as FrameMux).open(endpoint, combined)
    return stream as unknown as import('node:net').Socket
  }

  /** Close the remote server channel and release every stream. */
  dispose(): Promise<void> {
    this.disposal ??= this.disposeOnce()
    return this.disposal
  }

  private async disposeOnce(): Promise<void> {
    this.closing = true
    this.lifetime.abort(new Error('remote workspace connection is closing'))
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat)
    try {
      if (this.failure === undefined && this.rpc !== undefined) {
        await this.rpc.request('close', {}, z.null(), AbortSignal.timeout(this.config.requestTimeoutMs)).catch(() => {})
      }
    } finally {
      this.rpc?.close()
      this.mux?.close()
      await this.channel?.close().catch(() => {})
      this.channel = undefined
    }
  }

  private assertOpen(): void {
    if (this.closing) throw new Error('remote workspace connection is closed')
    if (this.failure !== undefined) throw this.failure
  }

  private fail(error: Error): void {
    if (this.failure !== undefined) return
    this.failure = error
    this.lifetime.abort(error)
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat)
    this.rpc?.close(error)
    this.mux?.close(error)
    void this.channel?.close().catch(() => {})
  }

  private async start(): Promise<RemoteHello> {
    const workspaces = this.ctx.get('remoteWorkspaces') as RemoteWorkspaceService | undefined
    if (workspaces === undefined) throw new Error(`remote target "${this.config.targetId}" has no workspace service`)
    const channel = await workspaces.connectChannel(this.config.targetId, this.lifetime.signal)
    if (this.closing) {
      await channel.close().catch(() => {})
      throw new Error('remote workspace connection closed before startup')
    }
    this.channel = channel
    const mux = new FrameMux({ transport: streamTransport(channel.input, channel.output), role: 'client', label: `remote:${this.config.targetId}` })
    this.mux = mux
    const rpc = new SshRpcPeer(mux.jsonInput(), mux.jsonOutput(), this.config.maxFrameBytes, this.config.maxPending)
    this.rpc = rpc
    rpc.once('closed', (error) => { this.fail(error as Error) })
    void mux.closed.then((error) => { if (error) this.fail(error) })
    const hello = await rpc.request('hello', {
      protocol: SSH_PROTOCOL_VERSION,
      workspace: '/',
      leaseMs: this.config.leaseMs,
    }, helloSchema, AbortSignal.timeout(this.config.requestTimeoutMs))
    const expected = await workspaces.expectedDigest(this.config.targetId).catch(() => undefined)
    if (expected !== undefined && expected !== hello.hash) {
      const detail = `remote server digest ${hello.hash.slice(0, 16)}… differs from the installed plugin ${expected.slice(0, 16)}…`
      void this.dispose()
      throw new Error(`${detail}; install the same dsh-remote-workspace version on the remote host`)
    }
    this.remote = hello
    let heartbeatPending: Promise<unknown> | undefined
    this.heartbeat = setInterval(() => {
      heartbeatPending ??= rpc.request('heartbeat', {}, z.null(), AbortSignal.timeout(Math.floor(this.config.leaseMs / 2)))
        .catch((error: unknown) => { this.fail(error as Error) })
        .finally(() => { heartbeatPending = undefined })
    }, Math.floor(this.config.leaseMs / 3))
    this.heartbeat.unref()
    return hello
  }
}
