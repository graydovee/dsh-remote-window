/**
 * Realm `ctx.ssh` adapter over dev-core's v1 `RemoteMux` (protocol §16.9).
 *
 * The official `*-ssh` providers only ever see `request()` + a paused duplex
 * from `connectStream()`, so the adapter must:
 *
 * - forward one RPC with a parsed result over the per-target mux;
 * - keep the stub→server path alias rewrite at this single seam;
 * - convert a `RemoteMuxStream` into a Duplex the providers can pipe, with
 *   writes/end/abort crossing to the mux in order.
 *
 * The legacy stdio `RemoteProtocolClient` stays as a fallback while dev-core
 * wires the service; these tests cover the v1 path.
 */
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { afterEach, describe, expect, it } from 'vitest'
import type { RemoteMux, RemoteMuxStream } from '../src/remote/mux-client.ts'
import RemoteConnection from '../src/connection/index.ts'

const TARGET = 'target-1'
const STUB = '/local/stub'
const REMOTE = '/srv/project'

const contexts: Context[] = []

afterEach(async () => {
  while (contexts.length > 0) await (contexts.pop() as Context).fiber.dispose().catch(() => {})
})

/** A mux stream that emits one chunk then waits for abort/end. */
function fakeStream(options: {
  outbound?: Uint8Array[]
  aborted?: string[]
  ends?: number[]
} = {}): RemoteMuxStream {
  const inbound = new TextEncoder().encode('hello!')
  let sent = false
  return {
    async write(chunk: Uint8Array) { (options.outbound ?? []).push(Buffer.from(chunk)) },
    end() { (options.ends ?? []).push(1) },
    abort(reason?: string) { (options.aborted ?? []).push(reason ?? '') },
    async *read() {
      if (!sent) {
        sent = true
        yield inbound
      }
    },
  }
}

/** Provide the two host services the realm connection reads. */
async function mount(options: {
  mux: RemoteMux
  aliases?: { stub: string; remote: string }[]
}): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('remoteMux', options.mux)
  ctx.provide('remoteWorkspaces', {
    pathAliases: () => options.aliases ?? [],
  } as never)
  await ctx.plugin(RemoteConnection, { targetId: TARGET })
  return ctx
}

describe('ctx.ssh over RemoteMux', () => {
  it('forwards one RPC with the result schema and the path alias rewrite', async () => {
    const calls: Array<{ target: string; endpoint: string; payload: unknown }> = []
    const mux: RemoteMux = {
      request: async <T,>(target: string, endpoint: string, payload: unknown): Promise<T> => {
        calls.push({ target, endpoint, payload })
        return `${REMOTE}/file.txt` as T
      },
      openStream: async () => fakeStream(),
      close: async () => {},
    }
    const ctx = await mount({ mux, aliases: [{ stub: STUB, remote: REMOTE }] })
    const result = await ctx.ssh.request('fs.resolve', { cwd: `${STUB}/dir` }, z.string())
    expect(result).toBe(`${REMOTE}/file.txt`)
    expect(calls).toEqual([{ target: TARGET, endpoint: 'fs.resolve', payload: { cwd: `${REMOTE}/dir` } }])
  })

  it('parses the mux answer with the provider schema and fails on a mismatch', async () => {
    const mux: RemoteMux = {
      request: async <T,>() => 42 as T,
      openStream: async () => fakeStream(),
      close: async () => {},
    }
    const ctx = await mount({ mux })
    await expect(ctx.ssh.request('process.prepare', {}, z.object({ id: z.string() }))).rejects.toThrow()
  })

  it('adapts a mux stream into a duplex: read, write, end, abort', async () => {
    const outbound: Uint8Array[] = []
    const aborted: string[] = []
    const ends: number[] = []
    const openCalls: Array<{ target: string; endpoint: string; payload: unknown }> = []
    const mux: RemoteMux = {
      request: async <T,>() => null as T,
      openStream: async (target: string, endpoint: string, payload: unknown) => {
        openCalls.push({ target, endpoint, payload })
        return fakeStream({ outbound, aborted, ends })
      },
      close: async () => {},
    }
    const ctx = await mount({ mux })
    const capability = 'a'.repeat(64)
    const socket = await ctx.ssh.connectStream({ path: '/streams/stdout', capability } as never)
    const received: Buffer[] = []
    socket.on('data', chunk => received.push(Buffer.from(chunk)))
    socket.resume()
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(Buffer.concat(received).toString()).toBe('hello!')
    expect(openCalls).toEqual([{ target: TARGET, endpoint: '/streams/stdout', payload: { capability } }])

    socket.write(Buffer.from('out'))
    await new Promise(resolve => setImmediate(resolve))
    expect(Buffer.concat(outbound).toString()).toBe('out')

    socket.end()
    await new Promise(resolve => setImmediate(resolve))
    expect(ends.length).toBe(1)

    // Abort is a separate stream (destroy → mux abort with the error message).
    const abortable = await ctx.ssh.connectStream({ path: '/streams/stderr', capability: 'b'.repeat(64) } as never)
    abortable.on('error', () => {})
    abortable.destroy(new Error('cancelled'))
    await new Promise(resolve => setImmediate(resolve))
    expect(aborted).toContain('cancelled')
  })
})
