/**
 * SSH **reverse** tunnel (`forwardIn`) that lets a server profile reach the
 * client-host bridge.
 *
 * Forwarding out (client → server loopback) is the module next door; this one is
 * the mirror image. sshd binds an OS-assigned port on the **server's** loopback
 * (`forwardIn('127.0.0.1', 0)`), and every inbound `tcp connection` event for
 * that port is accepted and piped to the bridge listening on the client's
 * `127.0.0.1`. Both ends stay on loopback: the tunnel is reachable only through
 * the SSH connection, and sshd's `AllowTcpForwarding` gate is surfaced as the
 * coded `local-llm-forwarding-unavailable` failure (no silent fallback).
 */
import { connect as netConnect, type Socket } from 'node:net'
import type { Client, ClientChannel } from 'ssh2'
import { LocalLlmError } from './settings.ts'

/** The subset of an ssh2 `Client` a reverse tunnel needs (mockable in tests). */
export interface ReverseTunnelClient {
  forwardIn(remoteHost: string, remotePort: number, callback: (error?: Error, boundPort?: number) => void): void
  unforwardIn(remoteHost: string, remotePort: number, callback: (error?: Error | null) => void): void
  on(event: 'tcp connection', listener: TcpConnectionListener): unknown
  off(event: 'tcp connection', listener: TcpConnectionListener): unknown
}

/** The ssh2 `tcp connection` event payload. */
export interface TcpConnectionInfo {
  readonly destIP: string
  readonly destPort: number
  readonly srcIP: string
  readonly srcPort: number
}

/** The `tcp connection` listener ssh2 invokes for each inbound forwarded connection. */
export type TcpConnectionListener = (
  info: TcpConnectionInfo,
  accept: () => ClientChannel,
  reject: () => void,
) => void

/** Where the reverse tunnel listens and what it dials on the client host. */
export interface RemoteForwardOptions {
  /** Server-side listen address; only `127.0.0.1` is supported. */
  readonly listenHost?: '127.0.0.1'
  /** Client-host loopback port to pipe each accepted channel to (the bridge). */
  readonly targetPort: number
}

/** A live reverse tunnel. */
export interface RemoteForward {
  /** The server-loopback port sshd bound (random; rewritten into the profile patch). */
  readonly port: number
  /** Cancel the remote forwarding and destroy open channels; idempotent. */
  close(): Promise<void>
}

/** Structural seam used by `LocalLlmService.prepare` (ProfileConnection satisfies it). */
export interface RemoteForwardCapable {
  readonly remoteForward?: (options: RemoteForwardOptions) => Promise<RemoteForward>
}

/** How long `unforwardIn` may take before the tunnel considers itself closed anyway. */
const CLOSE_TIMEOUT_MS = 2_000

/**
 * Ask the SSH server for a loopback reverse forward and wire accepted channels
 * to the client-host bridge.
 * @param client - connected ssh2 transport (or a mock implementing the subset).
 * @param options - bridge port to dial.
 * @returns the bound remote port plus an idempotent `close`.
 * @throws LocalLlmError `local-llm-forwarding-unavailable` when sshd refuses.
 */
export async function startRemoteForward(
  client: ReverseTunnelClient,
  options: RemoteForwardOptions,
): Promise<RemoteForward> {
  const listenHost = options.listenHost ?? '127.0.0.1'
  if (listenHost !== '127.0.0.1') {
    throw new LocalLlmError('local-llm-forwarding-unavailable', 'the reverse tunnel may only bind 127.0.0.1')
  }
  if (!Number.isInteger(options.targetPort) || options.targetPort < 1 || options.targetPort > 65_535) {
    throw new LocalLlmError(
      'local-llm-forwarding-unavailable',
      `the reverse tunnel target port ${String(options.targetPort)} is invalid`,
    )
  }

  const port = await new Promise<number>((resolve, reject) => {
    try {
      client.forwardIn(listenHost, 0, (error, boundPort) => {
        if (error !== undefined) {
          reject(
            new LocalLlmError(
              'local-llm-forwarding-unavailable',
              `the SSH server refused to open a reverse tunnel (AllowTcpForwarding?): ${error.message}`,
            ),
          )
          return
        }
        if (boundPort === undefined || boundPort < 1) {
          reject(
            new LocalLlmError(
              'local-llm-forwarding-unavailable',
              'the SSH server accepted the reverse tunnel without a bind port',
            ),
          )
          return
        }
        resolve(boundPort)
      })
    } catch (error) {
      reject(
        new LocalLlmError(
          'local-llm-forwarding-unavailable',
          `the reverse tunnel could not be requested: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
    }
  })

  const sockets = new Set<Socket>()
  const listener: TcpConnectionListener = (info, accept, reject) => {
    if (info.destPort !== port) {
      // Another forwardIn on the same connection owns this port.
      reject()
      return
    }
    let channel: ClientChannel
    try {
      channel = accept()
    } catch {
      return
    }
    const socket = netConnect({ host: '127.0.0.1', port: options.targetPort })
    sockets.add(socket)
    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      sockets.delete(socket)
      socket.destroy()
      channel.destroy()
    }
    socket.on('error', finish)
    socket.on('close', finish)
    channel.on('error', finish)
    channel.on('close', finish)
    channel.on('end', () => {
      socket.end()
    })
    socket.on('end', () => {
      channel.end()
    })
    channel.pipe(socket)
    socket.pipe(channel)
  }
  client.on('tcp connection', listener)

  let closing: Promise<void> | undefined
  return {
    port,
    close(): Promise<void> {
      closing ??= (async () => {
        try {
          client.off('tcp connection', listener)
        } catch {
          // A transport that already closed may not support off(); the sockets below still go.
        }
        for (const socket of sockets) socket.destroy()
        sockets.clear()
        await new Promise<void>(resolve => {
          let settled = false
          const done = (): void => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve()
          }
          const timer = setTimeout(done, CLOSE_TIMEOUT_MS)
          timer.unref?.()
          try {
            client.unforwardIn(listenHost, port, () => {
              done()
            })
          } catch {
            done()
          }
        })
      })()
      return closing
    },
  }
}

/**
 * Adapt a live ssh2 client into the `remoteForward` seam `ProfileConnection`
 * exposes (kept as a factory so the connector owns the client lifetime).
 * @param client - connected ssh2 transport.
 */
export function createRemoteForward(
  client: ReverseTunnelClient,
): (options: RemoteForwardOptions) => Promise<RemoteForward> {
  return async options => await startRemoteForward(client, options)
}
