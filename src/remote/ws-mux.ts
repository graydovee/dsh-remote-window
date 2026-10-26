/**
 * Client-side execution-world mux over one SSH-forwarded WebSocket.
 *
 * Protocol §7 / dev-server M2b contract:
 * - one binary WS message = one `src/frame/codec.ts` frame;
 * - the first frame is `FRAME_JSON` with `{"kind":"hello",...}`; the server
 *   answers one `FRAME_JSON` `{"kind":"hello-ok","maxFrameBytes":...}`;
 * - after that, a `FrameMux` multiplexes stream frames and the legacy
 *   `SshRpcPeer` JSON channel (whose payload is the peer's own length-prefixed
 *   RPC bytes, not a wire envelope);
 * - `openStream` sends `FRAME_OPEN { path, capability }` where the capability
 *   came from `process.prepare`.
 *
 * One backend instance owns exactly one WS/FrameMux for one target; the router
 * in `mux-client.ts` maps `targetId` to it.
 */
import type { Duplex } from 'node:stream'
import { z } from 'zod'
import { SshRpcPeer, SSH_PROTOCOL_VERSION } from '@deepseek-ai/dsh-ssh/protocol'
import { helloSchema } from '@deepseek-ai/dsh-ssh/schemas'
import { FrameMux, streamTransport } from '../frame/mux.ts'
import { DEFAULT_MAX_FRAME_BYTES } from '../frame/codec.ts'
import { scrubSecrets } from '../targets/types.ts'
import type { SshForwarder } from '../ssh/forward.ts'
import type { RemoteMuxBackend, RemoteMuxStream } from './mux-client.ts'
import { WebSocketFrameDuplex } from './ws-framing.ts'

/** Path of the server plugin's mux upgrade (protocol §4.1). */
export const MUX_UPGRADE_PATH = '/dsh-remote-workspace-server/api/mux'

/** Capabilities sent in the outer hello. */
export const MUX_CAPABILITIES = ['fs', 'subprocess', 'sandbox', 'terminal', 'process'] as const

/** Outer hello frame payload. */
export interface MuxHello {
  readonly kind: 'hello'
  readonly protocol: 1
  readonly clientId: string
  readonly instanceId: string
  readonly capabilities: readonly string[]
}

/** Outer hello-ok payload. */
export interface MuxHelloOk {
  readonly kind: 'hello-ok'
  readonly protocol: 1
  readonly maxFrameBytes: number
}

/** Options for one target's backend. */
export interface WsMuxOptions {
  readonly forwarder: SshForwarder
  readonly port: number
  readonly cookie: string
  readonly clientId: string
  readonly instanceId: string
  readonly openTimeoutMs?: number
  readonly leaseMs?: number
  /** Local anchor → server path aliases for this target (local mode). */
  readonly aliases?: () => readonly { readonly stub: string; readonly remote: string }[]
}

/**
 * Open the HTTP upgrade through a forwarded channel.
 * @returns the WS-framed duplex and the `FRAME_JSON` hello-ok payload.
 */
async function upgradeWebSocket(options: WsMuxOptions): Promise<Duplex> {
  const socket = await options.forwarder.open({ port: options.port })
  const key = Buffer.from(`${options.clientId}:${Date.now()}`).toString('base64').slice(0, 24)
  const headers: Record<string, string> = {
    host: `127.0.0.1:${options.port}`,
    connection: 'Upgrade',
    upgrade: 'websocket',
    'sec-websocket-version': '13',
    'sec-websocket-key': key,
    cookie: options.cookie,
    'x-dsh-rw-client': options.clientId,
    'x-dsh-rw-instance': options.instanceId,
    'x-dsh-rw-protocol': '1',
  }
  socket.write([
    `GET ${MUX_UPGRADE_PATH} HTTP/1.1`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    '',
    '',
  ].join('\r\n'))
  const { status, head } = await new Promise<{ status: number; head: Buffer }>((resolve, reject) => {
    let received = Buffer.alloc(0)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(Object.assign(new Error('the mux upgrade did not answer in time'), { code: 'upstream-timeout' }))
    }, options.openTimeoutMs ?? 10_000)
    timer.unref?.()
    const onData = (chunk: Buffer): void => {
      received = Buffer.concat([received, chunk])
      const end = received.indexOf('\r\n\r\n')
      if (end === -1) return
      clearTimeout(timer)
      socket.off('data', onData)
      const text = received.subarray(0, end).toString('utf8')
      const status = Number.parseInt((text.split('\r\n')[0] ?? '').split(' ')[1] ?? '0', 10)
      resolve({ status, head: received.subarray(end + 4) })
    }
    socket.on('data', onData)
    socket.once('error', (error: Error) => { clearTimeout(timer); reject(error) })
  })
  if (status !== 101) {
    socket.destroy()
    throw Object.assign(new Error(`the mux upgrade was refused (HTTP ${status})`), { code: 'tunnel-unavailable', status })
  }
  return new WebSocketFrameDuplex(socket, head)
}

/** Read exactly one FRAME_JSON payload (the outer hello-ok). */
async function readHelloOk(mux: FrameMux, timeoutMs: number): Promise<MuxHelloOk> {
  const input = mux.jsonInput()
  return await new Promise<MuxHelloOk>((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    const timer = setTimeout(() => { cleanup(); reject(new Error('the mux hello-ok did not arrive in time')) }, timeoutMs)
    timer.unref?.()
    const cleanup = (): void => {
      clearTimeout(timer)
      input.off('data', onData)
    }
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk])
      let parsed: unknown
      try { parsed = JSON.parse(buffer.toString('utf8')) } catch { return }
      cleanup()
      input.pause()
      if (parsed === null || typeof parsed !== 'object' || (parsed as { kind?: unknown }).kind !== 'hello-ok') {
        reject(new Error('the mux server answered an unexpected hello frame'))
        return
      }
      resolve(parsed as MuxHelloOk)
    }
    input.on('data', onData)
  })
}

/**
 * Rewrite local-mode anchors to their server paths across one request payload.
 *
 * The official providers send the session cwd on every call (`fs.resolve
 * {cwd}`, `process.prepare {cwd}`, sandbox `{workspaceRoot}`, …); local mode
 * binds the session to a private anchor, which the server does not know. This is
 * the single seam every mux request crosses, so one traversal covers all
 * methods. Strings inside argv and arbitrary content are left untouched beyond
 * exact path prefixes.
 */
export function translateMuxAliases(
  value: unknown,
  aliases: readonly { readonly stub: string; readonly remote: string }[],
): unknown {
  if (aliases.length === 0) return value
  const walk = (item: unknown): unknown => {
    if (typeof item === 'string') {
      for (const alias of aliases) {
        if (item === alias.stub) return alias.remote
        if (item.startsWith(`${alias.stub}/`)) return `${alias.remote}${item.slice(alias.stub.length)}`
      }
      return item
    }
    if (Array.isArray(item)) return item.map(walk)
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([key, child]) => [key, walk(child)]))
    }
    return item
  }
  return walk(value)
}

/** One target's real `RemoteMuxBackend` over WS + FrameMux + SshRpcPeer. */
export class WsMuxBackend implements RemoteMuxBackend {
  private mux: FrameMux | undefined
  private peer: SshRpcPeer | undefined
  private connecting: Promise<void> | undefined
  private closed = false

  constructor(private readonly options: WsMuxOptions) {}

  /** Establish WS + outer hello + inner peer hello once. */
  private async connect(): Promise<void> {
    if (this.closed) throw Object.assign(new Error('the remote mux is closed'), { code: 'mux-disposed' })
    if (this.peer !== undefined) return
    this.connecting ??= (async () => {
      const ws = await upgradeWebSocket(this.options)
      const mux = new FrameMux({ transport: streamTransport(ws, ws), role: 'client', label: 'remote-mux' })
      this.mux = mux
      const hello: MuxHello = {
        kind: 'hello',
        protocol: 1,
        clientId: this.options.clientId,
        instanceId: this.options.instanceId,
        capabilities: MUX_CAPABILITIES,
      }
      mux.jsonOutput().write(Buffer.from(JSON.stringify(hello), 'utf8'))
      const helloOk = await readHelloOk(mux, this.options.openTimeoutMs ?? 10_000)
      const peer = new SshRpcPeer(
        mux.jsonInput(),
        mux.jsonOutput(),
        Math.min(DEFAULT_MAX_FRAME_BYTES, helloOk.maxFrameBytes > 0 ? helloOk.maxFrameBytes : DEFAULT_MAX_FRAME_BYTES),
        128,
      )
      await peer.request('hello', {
        protocol: SSH_PROTOCOL_VERSION,
        workspace: '/',
        leaseMs: this.options.leaseMs ?? 30_000,
      }, helloSchema, AbortSignal.timeout(20_000))
      this.peer = peer
    })()
    try {
      await this.connecting
    } finally {
      this.connecting = undefined
    }
  }

  /** One helper-method RPC over the mux JSON channel. */
  async request<T>(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    await this.connect()
    const peer = this.peer
    if (peer === undefined) throw Object.assign(new Error('the remote mux is not connected'), { code: 'mux-unavailable' })
    const aliases = this.options.aliases?.() ?? []
    const outgoing = translateMuxAliases(payload, aliases)
    try {
      return await peer.request(endpoint, outgoing, z.unknown() as z.ZodType<T>, signal) as T
    } catch (error) {
      // Preserve the complete remote failure (message/code/params) instead of a
      // generic "spawn failed" line: QA and the server maintainer need argv/cwd
      // to diagnose execution-world failures. The payload is scrubbed and
      // capped, never sent to the browser as a secret.
      const code = typeof (error as { code?: unknown }).code === 'string' ? String((error as { code?: unknown }).code) : 'mux-request-failed'
      const message = error instanceof Error ? error.message : String(error)
      const payloadSummary: string = (() => {
        try { return scrubSecrets(JSON.stringify(payload)).slice(0, 4000) } catch { return '[unserializable payload]' }
      })()
      throw Object.assign(
        new Error(scrubSecrets(`${endpoint} failed [${code}]: ${message}`)),
        {
          code,
          cause: error,
          details: {
            endpoint,
            remoteCode: code,
            remoteMessage: scrubSecrets(message),
            payload: payloadSummary,
          },
        },
      )
    }
  }

  /** Open one mux stream; `payload` carries the official `capability` token. */
  async openStream(endpoint: string, payload: unknown): Promise<RemoteMuxStream> {
    await this.connect()
    const mux = this.mux
    if (mux === undefined) throw Object.assign(new Error('the remote mux is not connected'), { code: 'mux-unavailable' })
    const capability = (payload as { capability?: unknown } | undefined)?.capability
    if (typeof capability !== 'string' || capability === '') {
      throw Object.assign(new Error(`opening mux stream "${endpoint}" requires a capability token`), { code: 'mux-request-failed' })
    }
    let stream: Awaited<ReturnType<FrameMux['open']>>
    try {
      stream = await mux.open({ path: endpoint, capability })
    } catch (error) {
      const code = typeof (error as { code?: unknown }).code === 'string' ? String((error as { code?: unknown }).code) : 'mux-request-failed'
      const message = error instanceof Error ? error.message : String(error)
      throw Object.assign(new Error(scrubSecrets(`opening mux stream ${endpoint} failed [${code}]: ${message}`)), {
        code,
        cause: error,
        details: { endpoint, remoteCode: code, remoteMessage: scrubSecrets(message), payload: scrubSecrets(JSON.stringify(payload)).slice(0, 2000) },
      })
    }
    return {
      write: async (chunk: Uint8Array) => {
        await new Promise<void>((resolve, reject) => {
          stream.write(Buffer.from(chunk), error => error == null ? resolve() : reject(error))
        })
      },
      end: () => { stream.end() },
      abort: (reason?: string) => { stream.destroy(new Error(reason ?? 'stream aborted')) },
      read: async function* () {
        for await (const chunk of stream) yield new Uint8Array(chunk as Buffer)
      },
    }
  }

  /** Close this target's mux and fail every stream. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    try { await this.peer?.request('close', {}, z.null(), AbortSignal.timeout(3_000)) } catch {}
    this.peer?.close()
    this.peer = undefined
    this.mux?.close()
    this.mux = undefined
  }
}
