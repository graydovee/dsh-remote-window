/**
 * P1 transport over the target's single SSH connection (`SshForwarder`).
 *
 * One transport belongs to one target/profile server and keeps one
 * `ForwardHttpAgent` (one SSH connection, many forwarded channels). It implements
 * the three shapes {@link PluginTransport} needs:
 *
 * - unary JSON requests for handshake/rpc (bounded body, timeout, abort);
 * - an SSE response body for `events()` (streamed, never buffered);
 * - a raw WebSocket upgrade socket for `openMux()` (headers written manually).
 */
import { request as httpRequest } from 'node:http'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { scrubSecrets } from '../targets/types.ts'
import type { SshForwarder } from '../ssh/forward.ts'
import type {
  PluginHttpRequest,
  PluginHttpResponse,
  PluginStreamResponse,
  PluginTransport,
  PluginUpgradeResponse,
} from './plugin-client.ts'

/** Default unary request budget. */
export const P1_REQUEST_TIMEOUT_MS = 30_000

/** Refuse a P1 response larger than this (the RPC plane carries JSON only). */
export const P1_MAX_RESPONSE_BYTES = 64 * 1024 * 1024

/** One target's P1 transport over its forwarded SSH channels. */
export class TunnelPluginTransport implements PluginTransport {
  private readonly agent
  private closed = false

  constructor(
    private readonly forwarder: SshForwarder,
    readonly port: number,
  ) {
    this.agent = forwarder.httpAgent({ port })
  }

  /** Host header every forwarded P1 request carries. */
  private get hostHeader(): string {
    return `127.0.0.1:${this.port}`
  }

  private headers(request: PluginHttpRequest): Record<string, string> {
    return { ...request.headers, host: this.hostHeader }
  }

  /** One bounded unary HTTP request. */
  async request(request: PluginHttpRequest): Promise<PluginHttpResponse> {
    if (this.closed) throw new Error('the P1 transport is closed')
    return await new Promise<PluginHttpResponse>((resolve, reject) => {
      const timeoutMs = request.timeoutMs ?? P1_REQUEST_TIMEOUT_MS
      const controller = new AbortController()
      const onAbort = (): void => { controller.abort() }
      request.signal?.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => { controller.abort() }, timeoutMs)
      timer.unref?.()
      const requestHandle = httpRequest({
        host: '127.0.0.1',
        port: this.port,
        method: request.method,
        path: request.path,
        headers: this.headers(request),
        agent: this.agent,
        signal: controller.signal,
      }, response => {
        const chunks: Buffer[] = []
        let total = 0
        response.on('data', (chunk: Buffer) => {
          total += chunk.length
          if (total > P1_MAX_RESPONSE_BYTES) {
            response.destroy()
            finish(new Error('the P1 response is too large'))
            return
          }
          chunks.push(chunk)
        })
        response.once('end', () => {
          finish(undefined, {
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          })
        })
        response.once('error', error => finish(error))
      })
      const finish = (error: Error | undefined, value?: PluginHttpResponse): void => {
        clearTimeout(timer)
        request.signal?.removeEventListener('abort', onAbort)
        if (error !== undefined) reject(error)
        else resolve(value as PluginHttpResponse)
      }
      requestHandle.once('error', error => finish(error))
      if (request.body !== undefined) requestHandle.write(request.body)
      requestHandle.end()
    })
  }

  /** One streaming (SSE) response: the caller consumes `body`. */
  async stream(request: PluginHttpRequest): Promise<PluginStreamResponse> {
    if (this.closed) throw new Error('the P1 transport is closed')
    return await new Promise<PluginStreamResponse>((resolve, reject) => {
      const controller = new AbortController()
      const onAbort = (): void => { controller.abort() }
      request.signal?.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => { controller.abort() }, request.timeoutMs ?? P1_REQUEST_TIMEOUT_MS)
      timer.unref?.()
      const requestHandle = httpRequest({
        host: '127.0.0.1',
        port: this.port,
        method: request.method,
        path: request.path,
        headers: this.headers(request),
        agent: this.agent,
        signal: controller.signal,
      }, response => {
        clearTimeout(timer)
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: response })
      })
      requestHandle.once('error', error => {
        clearTimeout(timer)
        request.signal?.removeEventListener('abort', onAbort)
        reject(error)
      })
      requestHandle.end()
    })
  }

  /** One raw WebSocket upgrade through a fresh forwarded channel. */
  async upgrade(request: PluginHttpRequest): Promise<PluginUpgradeResponse> {
    if (this.closed) throw new Error('the P1 transport is closed')
    const socket = await this.forwarder.open({ port: this.port }, request.signal)
    const headers = this.headers(request)
    socket.write([
      `${request.method} ${request.path} HTTP/1.1`,
      ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
      '',
      '',
    ].join('\r\n'))
    const head = await new Promise<{ status: number; headers: Record<string, string>; rest: Buffer }>((resolve, reject) => {
      let received = Buffer.alloc(0)
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new Error('the P1 upgrade did not answer in time'))
      }, request.timeoutMs ?? P1_REQUEST_TIMEOUT_MS)
      timer.unref?.()
      const onData = (chunk: Buffer): void => {
        received = Buffer.concat([received, chunk])
        const end = received.indexOf('\r\n\r\n')
        if (end === -1) return
        clearTimeout(timer)
        socket.off('data', onData)
        const headText = received.subarray(0, end).toString('utf8')
        const lines = headText.split('\r\n')
        const status = Number.parseInt((lines[0] ?? '').split(' ')[1] ?? '0', 10)
        const parsed: Record<string, string> = {}
        for (const line of lines.slice(1)) {
          const at = line.indexOf(':')
          if (at > 0) parsed[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim()
        }
        resolve({ status, headers: parsed, rest: received.subarray(end + 4) })
      }
      socket.on('data', onData)
      socket.once('error', (error: Error) => { clearTimeout(timer); reject(error) })
    })
    if (head.status !== 101) {
      socket.destroy()
      return { status: head.status, headers: head.headers, socket, head: head.rest }
    }
    return { status: head.status, headers: head.headers, socket, head: head.rest }
  }

  /** Destroy the agent and every forwarded channel it handed out. */
  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.agent.destroy()
  }
}

/** Re-export for tests/diagnostics. */
export type { Duplex, IncomingMessage }
