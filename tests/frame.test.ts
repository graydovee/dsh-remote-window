import { connect as netConnect, createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Duplex, PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_FRAME_BYTES,
  END_DIRECTION,
  FRAME_ABORT,
  FRAME_CREDIT,
  FRAME_DATA,
  FRAME_END,
  FRAME_JSON,
  FRAME_OPEN,
  FRAME_OPEN_FAIL,
  FRAME_OPEN_OK,
  FrameDecoder,
  FrameError,
  encodeAbortFrame,
  encodeCreditFrame,
  encodeDataFrame,
  encodeEndFrame,
  encodeFrame,
  encodeJsonFrame,
  encodeOpenFailFrame,
  encodeOpenFrame,
  encodeOpenOkFrame,
} from '../src/frame/codec.ts'
import { FrameMux, STREAM_WINDOW_BYTES, streamTransport, type FrameMuxOptions } from '../src/frame/mux.ts'
import { authenticateStreamClient, capabilityMatches, createStreamCapability, createStreamListener } from '../src/frame/psk.ts'

/**
 * Two crossed duplexes: `a` writes into `b`'s readable and vice versa. The
 * tests drive them through {@link streamTransport} exactly like production
 * callers do, so no `Duplex.from` bookkeeping sits between the mux and bytes.
 */
function duplexPair(): [Duplex, Duplex] {
  const left = new PassThrough()
  const right = new PassThrough()
  const a = Duplex.from({ writable: left, readable: right })
  const b = Duplex.from({ writable: right, readable: left })
  return [a, b]
}

/** Split one crossed duplex into the readable/writable pair the adapter wants. */
function cross(duplex: Duplex): [import('node:stream').Readable, import('node:stream').Writable] {
  return [duplex as unknown as import('node:stream').Readable, duplex as unknown as import('node:stream').Writable]
}

/** Resolve after `ms`, used only for assertions that something must NOT happen. */
async function settle(ms: number): Promise<void> {
  await new Promise((resolve) => { setTimeout(resolve, ms) })
}

const temporary: string[] = []
afterEach(async () => {
  while (temporary.length > 0) await rm(temporary.pop() as string, { recursive: true, force: true })
})

describe('frame codec', () => {
  it('round-trips every frame type', () => {
    const decoder = new FrameDecoder()
    const endpoint = { path: '/tmp/root/1/stdout', capability: 'a'.repeat(64) }
    const frames = decoder.push(Buffer.concat([
      encodeJsonFrame(Buffer.from('{"type":"request"}')),
      encodeOpenFrame(7, endpoint),
      encodeOpenOkFrame(7),
      encodeOpenFailFrame(8, 'nope'),
      encodeDataFrame(7, Buffer.from('hello')),
      encodeEndFrame(7, END_DIRECTION.inbound),
      encodeAbortFrame(9, 'bad'),
      encodeCreditFrame(7, 4096),
    ]))
    expect(frames).toHaveLength(8)
    expect(frames[0]).toEqual({ type: FRAME_JSON, json: Buffer.from('{"type":"request"}') })
    expect(frames[1]).toEqual({ type: FRAME_OPEN, id: 7, endpoint })
    expect(frames[2]).toEqual({ type: FRAME_OPEN_OK, id: 7 })
    expect(frames[3]).toEqual({ type: FRAME_OPEN_FAIL, id: 8, message: 'nope' })
    expect(frames[4]).toEqual({ type: FRAME_DATA, id: 7, payload: Buffer.from('hello') })
    expect(frames[5]).toEqual({ type: FRAME_END, id: 7, direction: END_DIRECTION.inbound })
    expect(frames[6]).toEqual({ type: FRAME_ABORT, id: 9, message: 'bad' })
    expect(frames[7]).toEqual({ type: FRAME_CREDIT, id: 7, bytes: 4096 })
  })

  it('reassembles frames split across arbitrary chunk boundaries', () => {
    const bytes = Buffer.concat([
      encodeDataFrame(1, Buffer.from('abc')),
      encodeDataFrame(1, Buffer.from('defg')),
    ])
    const decoder = new FrameDecoder()
    const received: string[] = []
    for (const byte of bytes) {
      for (const frame of decoder.push(Buffer.from([byte]))) {
        if (frame.type === FRAME_DATA) received.push(frame.payload.toString('utf8'))
      }
    }
    decoder.end()
    expect(received).toEqual(['abc', 'defg'])
  })

  it('rejects malformed headers, oversized frames, and truncated transports', () => {
    expect(() => new FrameDecoder().push(encodeFrame(99, Buffer.from('x')))).toThrow(FrameError)
    expect(() => new FrameDecoder().push(encodeFrame(FRAME_JSON, Buffer.alloc(0)))).toThrow(/empty payload/)
    expect(() => new FrameDecoder(16).push(encodeFrame(FRAME_JSON, Buffer.alloc(17)))).toThrow(/exceeds/)
    // A data frame always carries a 4-byte id, so an empty payload is legal and
    // must survive the round trip rather than be mistaken for a zero-length frame.
    expect(new FrameDecoder().push(encodeDataFrame(1, Buffer.alloc(0)))).toEqual([
      { type: FRAME_DATA, id: 1, payload: Buffer.alloc(0) },
    ])
    expect(() => new FrameDecoder().push(encodeFrame(FRAME_END, Buffer.from([0, 1])))).toThrow(/missing its stream id|direction/)
    expect(() => new FrameDecoder().push(encodeFrame(FRAME_DATA, Buffer.from([0, 0])))).toThrow(/missing its stream id/)
    const partial = new FrameDecoder()
    partial.push(encodeDataFrame(1, Buffer.from('partial')).subarray(0, 6))
    expect(() => partial.end()).toThrow(/ended inside a frame/)
    expect(DEFAULT_MAX_FRAME_BYTES).toBe(64 * 1024 * 1024)
  })
})

describe('frame multiplexer', () => {
  /** One connected client/server mux pair over in-memory streams. */
  function connected(options: { accept?: FrameMuxOptions['accept'] } = {}): { client: FrameMux; server: FrameMux; transport: Duplex[] } {
    const [clientTransport, serverTransport] = duplexPair()
    const server = new FrameMux({
      transport: streamTransport(...cross(serverTransport)),
      role: 'server',
      accept: options.accept ?? (() => undefined),
    })
    const client = new FrameMux({ transport: streamTransport(...cross(clientTransport)), role: 'client' })
    return { client, server, transport: [clientTransport, serverTransport] }
  }

  it('carries opaque RPC bytes in both directions', async () => {
    const { client, server } = connected()
    const clientJson = Duplex.from({ writable: client.jsonOutput(), readable: client.jsonInput() })
    const serverJson = Duplex.from({ writable: server.jsonOutput(), readable: server.jsonInput() })
    const seen: Buffer[] = []
    serverJson.on('data', (chunk: Buffer) => { seen.push(chunk) })
    clientJson.write(Buffer.from('request-bytes'))
    serverJson.write(Buffer.from('result-bytes'))
    const echoed = await new Promise<Buffer>((resolve) => { clientJson.once('data', resolve) })
    await settle(10)
    expect(seen.map(chunk => chunk.toString()).join('')).toBe('request-bytes')
    expect(echoed.toString()).toBe('result-bytes')
  })

  it('opens a stream, transfers both directions, and half-closes', async () => {
    // The server side of a logical stream is one duplex: writing into it sends
    // data to the client, and reading from it receives client data.
    const inbound = new PassThrough()
    const outbound = new PassThrough()
    const { client } = connected({ accept: () => ({ inbound, outbound }) })
    const channel = await client.open({ path: '/root/1/stdout', capability: 'b'.repeat(64) })
    const clientRead: Buffer[] = []
    channel.on('data', (chunk: Buffer) => { clientRead.push(chunk) })
    const serverReceived: Buffer[] = []
    inbound.on('data', (chunk: Buffer) => { serverReceived.push(chunk) })

    outbound.write(Buffer.from('from-server'))
    channel.write(Buffer.from('from-client'))
    await settle(20)
    expect(Buffer.concat(clientRead).toString()).toBe('from-server')
    expect(Buffer.concat(serverReceived).toString()).toBe('from-client')

    const ended = new Promise<void>((resolve) => { channel.once('end', () => { resolve() }) })
    outbound.end()
    await ended
    expect(channel.readableEnded).toBe(true)
    expect(inbound.writableEnded).toBe(false)
  })

  it('rejects an open the server cannot serve', async () => {
    const { client } = connected()
    await expect(client.open({ path: '/root/missing' })).rejects.toThrow(/no stream for that endpoint/)
  })

  it('closes the mux when the peer sends data for an unknown stream', async () => {
    const { server, transport } = connected()
    const failure = server.closed
    // transport[0] is the client half: writing to it delivers to the server.
    const clientTransport = transport[0]
    if (clientTransport === undefined) throw new Error('missing client transport')
    clientTransport.write(encodeDataFrame(4242, Buffer.from('x')))
    expect((await failure)?.message).toMatch(/unknown stream/)
  })

  it('refuses to open a stream on a server-role mux', async () => {
    const { server } = connected()
    await expect(server.open({ path: '/x' })).rejects.toThrow(/client-role/)
  })

  it('applies backpressure to a slow consumer without stalling other streams', async () => {
    const bindings = new Map<string, { inbound: PassThrough; outbound: PassThrough }>()
    for (const name of ['slow', 'fast']) bindings.set(`/root/${name}`, { inbound: new PassThrough(), outbound: new PassThrough() })
    const bindingOf = (name: string): { inbound: PassThrough; outbound: PassThrough } => {
      const binding = bindings.get(`/root/${name}`)
      if (binding === undefined) throw new Error(`missing test binding ${name}`)
      return binding
    }
    const { client } = connected({
      accept: endpoint => bindings.get((endpoint as { path: string }).path),
    })
    const slow = await client.open({ path: '/root/slow' })
    const fast = await client.open({ path: '/root/fast' })

    // Never read `slow`: the sender must stop once the receive window is full.
    bindingOf('slow').outbound.write(Buffer.alloc(STREAM_WINDOW_BYTES * 2, 1))
    const fastData: Buffer[] = []
    fast.on('data', (chunk: Buffer) => { fastData.push(chunk) })
    bindingOf('fast').outbound.write(Buffer.from('management-traffic'))
    await settle(50)
    expect(Buffer.concat(fastData).toString()).toBe('management-traffic')

    // Draining the slow stream releases credit and lets the rest through.
    const total = STREAM_WINDOW_BYTES * 2
    let drained = 0
    slow.on('data', (chunk: Buffer) => { drained += chunk.length })
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => { if (drained === total) { clearInterval(timer); resolve() } }, 5)
    })
    expect(drained).toBe(total)
    // Client-side writes into a stream the server never reads still complete.
    await new Promise<void>((resolve, reject) => { slow.write(Buffer.alloc(1024), (error) => { if (error) reject(error); else resolve() }) })
  })
})

describe('stream psk', () => {
  it('authenticates a matching capability and rejects a wrong one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-remote-psk-'))
    temporary.push(dir)
    const path = join(dir, 'stream.sock')
    const listener = await createStreamListener(path, 2000)
    expect(listener.capability).toMatch(/^[0-9a-f]{64}$/)
    expect(capabilityMatches(listener.capability, listener.capability)).toBe(true)
    expect(capabilityMatches(listener.capability, createStreamCapability())).toBe(false)

    const raw = netConnect({ path })
    await new Promise<void>((resolve, reject) => { raw.once('connect', resolve); raw.once('error', reject) })
    const authenticated = await authenticateStreamClient(raw, listener.capability, 2000)
    const accepted = await listener.connected
    accepted.resume()
    authenticated.resume()
    const echoed = new Promise<string>((resolve) => { authenticated.once('data', (chunk: Buffer) => { resolve(chunk.toString()) }) })
    accepted.write(Buffer.from('psk-ok'))
    expect(await echoed).toBe('psk-ok')
    authenticated.destroy()
    accepted.destroy()
    await listener.close()
  })

  it('fails the handshake for a wrong capability', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-remote-psk-'))
    temporary.push(dir)
    const server = createServer()
    await new Promise<void>((resolve) => { server.listen(join(dir, 's.sock'), resolve) })
    // No PSK callback at all: the client cannot complete a PSK handshake.
    const raw = netConnect({ path: join(dir, 's.sock') })
    await new Promise<void>((resolve, reject) => { raw.once('connect', resolve); raw.once('error', reject) })
    await expect(authenticateStreamClient(raw, createStreamCapability(), 1000)).rejects.toThrow()
    raw.destroy()
    server.unref()
    server.close()
  })
})
