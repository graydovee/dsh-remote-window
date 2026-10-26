/**
 * RFC 6455 WebSocket framing for the P1 execution-world mux.
 *
 * The transport is an SSH `forwardOut` channel, not a browser WebSocket, so the
 * client has to speak the wire protocol itself: one **binary** WS message carries
 * exactly one `src/frame/codec.ts` frame (§7). This module is only the framing
 * layer (masking, continuation, ping/pong, close); stream/RPC semantics belong
 * to `mux-client.ts`.
 */
import { Duplex } from 'node:stream'
import type { Duplex as DuplexLike } from 'node:stream'

/** WebSocket opcodes used by the mux. */
export const WS_OPCODE = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa,
} as const

/** One decoded frame. */
export interface WebSocketFrame {
  readonly fin: boolean
  readonly opcode: number
  readonly payload: Buffer
}

/** Encode one client-to-server frame (clients must mask). */
export function encodeWebSocketFrame(opcode: number, payload: Buffer, maskKey?: Buffer): Buffer {
  const length = payload.length
  const header = length < 126 ? 2 : length <= 0xffff ? 4 : 10
  const mask = maskKey ?? Buffer.from([0x12, 0x34, 0x56, 0x78])
  const frame = Buffer.alloc(header + 4 + length)
  frame[0] = 0x80 | (opcode & 0x0f)
  if (length < 126) {
    frame[1] = 0x80 | length
    mask.copy(frame, 2)
    for (let index = 0; index < length; index++) frame[6 + index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0)
  } else if (length <= 0xffff) {
    frame[1] = 0x80 | 126
    frame.writeUInt16BE(length, 2)
    mask.copy(frame, 4)
    for (let index = 0; index < length; index++) frame[8 + index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0)
  } else {
    frame[1] = 0x80 | 127
    frame.writeBigUInt64BE(BigInt(length), 2)
    mask.copy(frame, 10)
    for (let index = 0; index < length; index++) frame[14 + index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0)
  }
  return frame
}

/** Incremental server-to-client frame decoder (server frames are unmasked). */
export class WebSocketFrameDecoder {
  private buffer = Buffer.alloc(0)

  constructor(private readonly maxMessageBytes = 64 * 1024 * 1024) {}

  /** Feed bytes; returns every complete frame contained in them. */
  push(chunk: Buffer): WebSocketFrame[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const frames: WebSocketFrame[] = []
    for (;;) {
      if (this.buffer.length < 2) break
      const first = this.buffer[0] ?? 0
      const second = this.buffer[1] ?? 0
      const fin = (first & 0x80) !== 0
      const opcode = first & 0x0f
      const masked = (second & 0x80) !== 0
      let length = second & 0x7f
      let offset = 2
      if (length === 126) {
        if (this.buffer.length < 4) break
        length = this.buffer.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        if (this.buffer.length < 10) break
        const wide = this.buffer.readBigUInt64BE(2)
        if (wide > BigInt(this.maxMessageBytes)) throw new Error('websocket frame is too large')
        length = Number(wide)
        offset = 10
      }
      if (length > this.maxMessageBytes) throw new Error('websocket frame is too large')
      const maskBytes = masked ? 4 : 0
      if (this.buffer.length < offset + maskBytes + length) break
      let payload = this.buffer.subarray(offset + maskBytes, offset + maskBytes + length)
      if (masked) {
        const mask = this.buffer.subarray(offset, offset + 4)
        const unmasked = Buffer.alloc(length)
        for (let index = 0; index < length; index++) unmasked[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0)
        payload = unmasked
      }
      this.buffer = this.buffer.subarray(offset + maskBytes + length)
      frames.push({ fin, opcode, payload: Buffer.from(payload) })
    }
    return frames
  }
}

/** Whether bytes look like the start of an HTTP/1.1 101 response. */
export function isWebSocketUpgradeResponse(head: string): boolean {
  return /^HTTP\/1\.1 101\b/u.test(head)
}

/**
 * A `Duplex` that exposes WS binary messages as byte chunks to a `FrameMux`.
 *
 * `FrameMux` writes one encoded codec frame per `_write` call, which becomes one
 * binary WS message; inbound binary messages are pushed as one chunk each, which
 * is exactly what the mux decoder expects. Text/control frames are handled here
 * (ping→pong, close→end), so the mux never sees them.
 */
export class WebSocketFrameDuplex extends Duplex {
  private readonly decoder: WebSocketFrameDecoder
  private fragments: Buffer[] = []
  private shut = false

  constructor(
    private readonly socket: DuplexLike,
    initial: Buffer = Buffer.alloc(0),
    options: { readonly maxMessageBytes?: number } = {},
  ) {
    super({ allowHalfOpen: true })
    this.decoder = new WebSocketFrameDecoder(options.maxMessageBytes)
    socket.once('error', (error: Error) => { this.destroy(error) })
    socket.once('close', () => { if (!this.shut) this.push(null) })
    socket.on('data', (chunk: Buffer) => {
      let frames: WebSocketFrame[]
      try {
        frames = this.decoder.push(chunk)
      } catch (error) {
        this.destroy(error instanceof Error ? error : new Error(String(error)))
        return
      }
      for (const frame of frames) this.receive(frame)
    })
    if (initial.length > 0) {
      for (const frame of this.decoder.push(initial)) this.receive(frame)
    }
  }

  private receive(frame: WebSocketFrame): void {
    if (frame.opcode === WS_OPCODE.ping) {
      this.sendFrame(WS_OPCODE.pong, frame.payload)
      return
    }
    if (frame.opcode === WS_OPCODE.pong) return
    if (frame.opcode === WS_OPCODE.close) {
      this.sendFrame(WS_OPCODE.close, Buffer.alloc(0))
      this.shut = true
      this.push(null)
      return
    }
    if (frame.opcode === WS_OPCODE.text) {
      // Protocol control frames are JSON but v1's mux uses binary messages; a
      // text frame is a contract violation, surfaced instead of silently parsed.
      this.destroy(new Error('the mux WebSocket sent a text frame; binary frames are required'))
      return
    }
    if (frame.opcode === WS_OPCODE.binary || frame.opcode === WS_OPCODE.continuation) {
      if (!frame.fin) {
        this.fragments.push(frame.payload)
        return
      }
      const payload = this.fragments.length === 0 ? frame.payload : Buffer.concat([...this.fragments, frame.payload])
      this.fragments = []
      this.push(payload)
    }
  }

  private sendFrame(opcode: number, payload: Buffer): void {
    if (this.socket.destroyed || this.shut) return
    this.socket.write(encodeWebSocketFrame(opcode, payload))
  }

  override _read(): void {}

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.shut || this.socket.destroyed) {
      callback(new Error('the mux WebSocket is closed'))
      return
    }
    this.sendFrame(WS_OPCODE.binary, Buffer.from(chunk))
    callback()
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.sendFrame(WS_OPCODE.close, Buffer.alloc(0))
    this.shut = true
    this.socket.end()
    callback()
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.shut = true
    if (!this.socket.destroyed) this.socket.destroy()
    callback(error)
  }
}
