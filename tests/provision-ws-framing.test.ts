/**
 * WebSocket framing for the P1 mux: mask/encode, incremental decode, and the
 * Duplex adapter that turns binary WS messages into mux frame bytes.
 */
import { Duplex, PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  WS_OPCODE,
  WebSocketFrameDecoder,
  WebSocketFrameDuplex,
  encodeWebSocketFrame,
} from '../src/remote/ws-framing.ts'

/** A duplex whose readable side is fed by `toClient` and writes go to `toServer`. */
function socketPair(): { socket: Duplex; toClient: PassThrough; toServer: PassThrough } {
  const toClient = new PassThrough()
  const toServer = new PassThrough()
  const socket = new Duplex({
    read() {
      const onData = (chunk: Buffer): void => { if (!this.push(chunk)) toClient.pause() }
      toClient.on('data', onData)
      toClient.once('resume', () => {})
      this.once('close', () => toClient.off('data', onData))
    },
    write(chunk, encoding, callback) { toServer.write(chunk, encoding, callback) },
    final(callback) { toServer.end(callback) },
    destroy(error, callback) {
      toClient.destroy()
      toServer.destroy()
      callback(error)
    },
  })
  return { socket, toClient, toServer }
}

describe('WebSocket framing', () => {
  it('round-trips a masked binary frame through the incremental decoder', () => {
    const decoder = new WebSocketFrameDecoder()
    const payload = Buffer.from([1, 2, 3, 4, 5])
    const frame = encodeWebSocketFrame(WS_OPCODE.binary, payload)
    // The decoder accepts masked frames too; server frames are normally unmasked.
    const [decoded] = decoder.push(frame)
    expect(decoded).toMatchObject({ fin: true, opcode: WS_OPCODE.binary })
    expect(decoded?.payload).toEqual(payload)
  })

  it('decodes fragmented frames across arbitrary chunk boundaries', () => {
    const decoder = new WebSocketFrameDecoder()
    const first = Buffer.from([0x02, 0x03, 0x61, 0x62, 0x63])
    const second = Buffer.from([0x80, 0x02, 0x64, 0x65])
    expect(decoder.push(first.subarray(0, 2))).toEqual([])
    const frames = decoder.push(Buffer.concat([first.subarray(2), second]))
    expect(frames).toHaveLength(2)
    expect(frames[0]).toMatchObject({ fin: false, opcode: WS_OPCODE.binary })
    expect(frames[1]).toMatchObject({ fin: true, opcode: WS_OPCODE.continuation })
  })

  it('forwards binary messages as chunks and answers ping with pong', async () => {
    const { socket, toClient, toServer } = socketPair()
    const duplex = new WebSocketFrameDuplex(socket)
    const incoming: Buffer[] = []
    const outgoing: Buffer[] = []
    duplex.on('data', (chunk: Buffer) => incoming.push(chunk))
    toServer.on('data', (chunk: Buffer) => outgoing.push(chunk))

    toClient.write(Buffer.from([0x82, 0x02, 0x68, 0x69]))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(Buffer.concat(incoming).toString()).toBe('hi')

    toClient.write(Buffer.from([0x89, 0x01, 0x70]))
    await new Promise(resolve => setTimeout(resolve, 10))
    const pong = Buffer.concat(outgoing)
    expect(pong[0]).toBe(0x8a)
    expect(pong[1] ?? 0).toBeGreaterThanOrEqual(0x80)
    duplex.destroy()
  })

  it('writes masked client binary messages for every mux frame chunk', async () => {
    const { socket, toServer } = socketPair()
    const duplex = new WebSocketFrameDuplex(socket)
    const written: Buffer[] = []
    toServer.on('data', (chunk: Buffer) => written.push(chunk))
    await new Promise<void>((resolve, reject) => duplex.write(Buffer.from([9, 8, 7]), error => error === null || error === undefined ? resolve() : reject(error)))
    const frame = Buffer.concat(written)
    expect(frame[0]).toBe(0x82)
    expect(frame[1] ?? 0).toBeGreaterThanOrEqual(0x80)
    const length = (frame[1] ?? 0) & 0x7f
    const mask = frame.subarray(2, 6)
    const payload = Buffer.alloc(length)
    for (let index = 0; index < length; index++) payload[index] = (frame[6 + index] ?? 0) ^ (mask[index % 4] ?? 0)
    expect([...payload]).toEqual([9, 8, 7])
    duplex.destroy()
  })

  it('rejects text frames (mux messages are binary)', async () => {
    const { socket, toClient } = socketPair()
    const duplex = new WebSocketFrameDuplex(socket)
    const error = new Promise<Error | null>(resolve => duplex.once('error', resolve))
    toClient.write(Buffer.from([0x81, 0x01, 0x78]))
    expect((await error)?.message).toMatch(/text frame/u)
    duplex.destroy()
  })
})
