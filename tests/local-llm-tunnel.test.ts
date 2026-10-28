/**
 * Reverse SSH tunnel (`forwardIn`) lifecycle: sshd binds a random loopback
 * port, accepted channels pipe to the client-host bridge, and a refusal from
 * the server becomes the coded forwarding-unavailable error (no fallback).
 */
import { EventEmitter } from 'node:events'
import { createServer, connect, type AddressInfo, type Server, type Socket } from 'node:net'
import type { ClientChannel } from 'ssh2'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createRemoteForward,
  startRemoteForward,
  type RemoteForward,
  type ReverseTunnelClient,
  type TcpConnectionInfo,
  type TcpConnectionListener,
} from '../src/local-llm/tunnel.ts'
import { LocalLlmError } from '../src/local-llm/settings.ts'

interface ForwardCall {
  readonly host: string
  readonly port: number
}

/** Mock ssh2 transport exposing only what the reverse tunnel uses. */
class FakeTunnelClient implements ReverseTunnelClient {
  readonly emitter = new EventEmitter()
  readonly forwardCalls: ForwardCall[] = []
  readonly unforwardCalls: ForwardCall[] = []
  readonly boundPort: number
  readonly refusal: Error | undefined

  constructor(options: { boundPort?: number; refusal?: Error } = {}) {
    this.boundPort = options.boundPort ?? 43_211
    this.refusal = options.refusal
  }

  forwardIn(host: string, port: number, callback: (error?: Error, boundPort?: number) => void): void {
    this.forwardCalls.push({ host, port })
    if (this.refusal !== undefined) {
      callback(this.refusal)
      return
    }
    callback(undefined, this.boundPort)
  }

  unforwardIn(host: string, port: number, callback: (error?: Error | null) => void): void {
    this.unforwardCalls.push({ host, port })
    callback(null)
  }

  on(event: 'tcp connection', listener: TcpConnectionListener): unknown {
    return this.emitter.on(event, listener)
  }

  off(event: 'tcp connection', listener: TcpConnectionListener): unknown {
    return this.emitter.off(event, listener)
  }

  emitConnection(info: TcpConnectionInfo, accept: () => ClientChannel, reject: () => void): void {
    this.emitter.emit('tcp connection', info, accept, reject)
  }

  listenerCount(): number {
    return this.emitter.listenerCount('tcp connection')
  }
}

const cleanups: (() => Promise<void> | void)[] = []
const forwards: RemoteForward[] = []
afterEach(async () => {
  for (const forward of forwards.splice(0)) await forward.close()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** Two connected sockets: `channel` is what the SSH server hands us, `peer` the server-side caller. */
async function socketPair(): Promise<{ channel: Socket; peer: Socket }> {
  const pair = await new Promise<{ channel: Socket; peer: Socket }>((resolve, reject) => {
    let peer: Socket
    const server: Server = createServer(channel => {
      server.close()
      resolve({ channel, peer })
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      peer = connect((server.address() as AddressInfo).port, '127.0.0.1')
      peer.on('error', reject)
    })
  })
  pair.channel.on('error', () => {})
  pair.peer.on('error', () => {})
  return pair
}

/** Loopback echo server standing in for the client-host bridge. */
async function echoBridge(): Promise<{ port: number; close(): Promise<void> }> {
  const server: Server = createServer(socket => {
    socket.on('data', chunk => socket.write(Buffer.concat([Buffer.from('echo:'), chunk])))
    socket.on('error', () => {})
  })
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    port: (server.address() as AddressInfo).port,
    close: async () => {
      await new Promise<void>(resolve => {
        server.close(() => resolve())
      })
    },
  }
}

function tcpInfo(destPort: number): TcpConnectionInfo {
  return { destIP: '127.0.0.1', destPort, srcIP: '203.0.113.10', srcPort: 51_234 }
}

async function waitForData(socket: Socket): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for tunneled data')), 2_000)
    socket.once('data', chunk => {
      clearTimeout(timer)
      resolve(chunk)
    })
  })
}

describe('startRemoteForward', () => {
  it('asks sshd for a loopback port and pipes accepted channels to the bridge', async () => {
    const client = new FakeTunnelClient({ boundPort: 43_211 })
    const bridge = await echoBridge()
    cleanups.push(() => bridge.close())
    const forward = await startRemoteForward(client, { targetPort: bridge.port })
    forwards.push(forward)
    expect(forward.port).toBe(43_211)
    expect(client.forwardCalls).toEqual([{ host: '127.0.0.1', port: 0 }])
    expect(client.listenerCount()).toBe(1)

    const pair = await socketPair()
    cleanups.push(() => {
      pair.channel.destroy()
      pair.peer.destroy()
    })
    let rejected = 0
    client.emitConnection(tcpInfo(43_211), () => pair.channel as unknown as ClientChannel, () => { rejected += 1 })
    expect(rejected).toBe(0)

    pair.peer.write('ping')
    expect((await waitForData(pair.peer)).toString()).toBe('echo:ping')
  })

  it('rejects channels for a different forwarded port', async () => {
    const client = new FakeTunnelClient({ boundPort: 43_211 })
    const bridge = await echoBridge()
    cleanups.push(() => bridge.close())
    const forward = await startRemoteForward(client, { targetPort: bridge.port })
    forwards.push(forward)

    let rejections = 0
    const channel = await socketPair()
    cleanups.push(() => {
      channel.channel.destroy()
      channel.peer.destroy()
    })
    client.emitConnection(tcpInfo(43_999), () => channel.channel as unknown as ClientChannel, () => { rejections += 1 })
    expect(rejections).toBe(1)
  })

  it('maps an sshd refusal (AllowTcpForwarding no) to the coded forwarding error', async () => {
    const refused = new FakeTunnelClient({ refusal: new Error('administratively prohibited') })
    await expect(startRemoteForward(refused, { targetPort: 8080 })).rejects.toMatchObject({
      code: 'local-llm-forwarding-unavailable',
      status: 424,
    })
    await expect(startRemoteForward(refused, { targetPort: 8080 })).rejects.toBeInstanceOf(LocalLlmError)
  })

  it('never binds anything but 127.0.0.1 and validates the target port', async () => {
    const client = new FakeTunnelClient()
    await expect(startRemoteForward(client, { listenHost: '0.0.0.0' as '127.0.0.1', targetPort: 8080 })).rejects.toMatchObject({
      code: 'local-llm-forwarding-unavailable',
    })
    await expect(startRemoteForward(client, { targetPort: 0 })).rejects.toMatchObject({ code: 'local-llm-forwarding-unavailable' })
    expect(client.forwardCalls).toEqual([])
  })

  it('close cancels the remote forward once, removes the listener and is idempotent', async () => {
    const client = new FakeTunnelClient()
    const forward = await startRemoteForward(client, { targetPort: 8080 })
    expect(client.listenerCount()).toBe(1)
    await forward.close()
    await forward.close()
    expect(client.unforwardCalls).toEqual([{ host: '127.0.0.1', port: 43_211 }])
    expect(client.listenerCount()).toBe(0)
  })
})

describe('createRemoteForward', () => {
  it('adapts a client into the ProfileConnection seam', async () => {
    const client = new FakeTunnelClient({ boundPort: 40_000 })
    const forward = await createRemoteForward(client)({ targetPort: 8080 })
    forwards.push(forward)
    expect(forward.port).toBe(40_000)
  })
})
