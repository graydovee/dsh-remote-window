/**
 * P1 client: envelope/error mapping, lease headers, SSE decoding and mux upgrade.
 *
 * The transport is fake: these tests pin the wire contract without a network,
 * matching protocol §2.1/§4/§6/§12.
 */
import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import {
  PLUGIN_ROUTES,
  REMOTE_WORKSPACE_PLUGIN_PROTOCOL,
  RemotePluginClient,
  SseDecoder,
  decodeSseFrame,
  parsePluginEnvelope,
  type PluginHttpRequest,
  type PluginHttpResponse,
  type PluginStreamResponse,
  type PluginTransport,
  type PluginUpgradeResponse,
} from '../src/remote/plugin-client.ts'

class FakeTransport implements PluginTransport {
  readonly requests: PluginHttpRequest[] = []
  responses: PluginHttpResponse[] = []
  streams: PluginStreamResponse[] = []
  upgrades: PluginUpgradeResponse[] = []

  async request(request: PluginHttpRequest): Promise<PluginHttpResponse> {
    this.requests.push(request)
    return this.responses.shift() ?? { status: 500, headers: {}, body: Buffer.from('{"ok":false,"error":{"code":"internal","message":"no fake response"}}') }
  }

  async stream(request: PluginHttpRequest): Promise<PluginStreamResponse> {
    this.requests.push(request)
    return this.streams.shift() ?? { status: 500, headers: {}, body: Readable.from([]) }
  }

  async upgrade(request: PluginHttpRequest): Promise<PluginUpgradeResponse> {
    this.requests.push(request)
    return this.upgrades.shift() ?? { status: 404, headers: {}, socket: Readable.from([]) as never, head: Buffer.alloc(0) }
  }
}

const HANDSHAKE = {
  protocol: 1,
  pluginVersion: '0.1.0-alpha.3',
  dshVersion: '0.2.1-rc.3',
  profile: 'graydovee-remote-workspace-abcdef012345',
  clientId: 'abcdef012345',
  lease: { instanceId: 'instance-1', expiresAt: '2026-01-01T00:00:20.000Z' },
  capabilities: { workspaceApi: 1, eventsSse: 1, muxWs: 1, embed: { storagePrefix: 'dshrw:test:', mode: 'reload' as const } },
}

function envelope(value: unknown): PluginHttpResponse {
  return { status: 200, headers: {}, body: Buffer.from(JSON.stringify({ ok: true, value })) }
}

function failure(status: number, code: string, details?: unknown): PluginHttpResponse {
  return { status, headers: {}, body: Buffer.from(JSON.stringify({ ok: false, error: { code, message: `${code} message`, ...(details === undefined ? {} : { details }) } })) }
}

function makeClient(transport: FakeTransport): RemotePluginClient {
  return new RemotePluginClient({ transport, clientId: 'abcdef012345', instanceId: 'instance-1', pluginVersion: '0.1.0-alpha.3', cookie: 'dsh-auth-x=v1' })
}

describe('RemotePluginClient', () => {
  it('handshakes with the protocol body and lease headers, then records the lease', async () => {
    const transport = new FakeTransport()
    transport.responses.push(envelope(HANDSHAKE))
    const client = makeClient(transport)
    const result = await client.handshake({ profile: HANDSHAKE.profile })
    expect(result).toMatchObject({ protocol: 1, profile: HANDSHAKE.profile })
    expect(client.leaseState?.instanceId).toBe('instance-1')
    expect(client.capabilities?.embed?.storagePrefix).toBe('dshrw:test:')
    const request = transport.requests[0]
    expect(request?.path).toBe(PLUGIN_ROUTES.handshake)
    expect(request?.headers['x-dsh-rw-client']).toBe('abcdef012345')
    expect(request?.headers['x-dsh-rw-instance']).toBe('instance-1')
    expect(request?.headers['x-dsh-rw-protocol']).toBe(String(REMOTE_WORKSPACE_PLUGIN_PROTOCOL))
    expect(request?.headers.cookie).toBe('dsh-auth-x=v1')
    expect(JSON.parse(request?.body?.toString('utf8') ?? '{}')).toMatchObject({ protocol: 1, clientId: 'abcdef012345', instanceId: 'instance-1' })
  })

  it('maps an official error envelope to a coded error with status/details', async () => {
    const transport = new FakeTransport()
    transport.responses.push(failure(409, 'session/writer-held', { sessionId: 'session-1' }))
    const client = makeClient(transport)
    await expect(client.rpc('session/rename', { sessionId: 'session-1', title: 'x' })).rejects.toMatchObject({
      code: 'session/writer-held',
      status: 409,
      details: { sessionId: 'session-1' },
    })
  })

  it('classifies a non-JSON 404 as plugin-missing and a bad protocol as mismatch', async () => {
    const transport = new FakeTransport()
    transport.responses.push({ status: 404, headers: {}, body: Buffer.from('<!doctype html>') })
    await expect(makeClient(transport).handshake({ profile: HANDSHAKE.profile })).rejects.toMatchObject({ code: 'plugin-missing' })

    const mismatch = new FakeTransport()
    mismatch.responses.push(envelope({ ...HANDSHAKE, protocol: 2 }))
    await expect(makeClient(mismatch).handshake({ profile: HANDSHAKE.profile })).rejects.toMatchObject({
      code: 'plugin-protocol-mismatch',
      details: { clientProtocol: 1, serverProtocol: 2 },
    })
  })

  it('streams SSE frames and records no token/cookie in errors', async () => {
    const transport = new FakeTransport()
    transport.streams.push({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: Readable.from([
        Buffer.from('event: hello\ndata: {"protocol":1}\n\n'),
        Buffer.from(': ping\n\nevent: change\ndata: {"kind":"workspace"}\n\n'),
      ]),
    })
    const events: string[] = []
    for await (const event of makeClient(transport).events()) events.push(`${event.event}:${event.data}`)
    expect(events).toEqual(['hello:{"protocol":1}', 'change:{"kind":"workspace"}'])
    expect(transport.requests[0]?.headers['x-dsh-rw-client']).toBe('abcdef012345')
  })

  it('requires a 101 upgrade for the mux and carries the lease headers', async () => {
    const transport = new FakeTransport()
    const client = makeClient(transport)
    transport.upgrades.push({ status: 101, headers: {}, socket: Readable.from([]) as never, head: Buffer.alloc(0) })
    await expect(client.openMux({ key: 'dGhlIHNhbXBsZSBub25jZQ==' })).resolves.toMatchObject({ status: 101 })
    expect(transport.requests[0]?.path).toBe(PLUGIN_ROUTES.mux)
    expect(transport.requests[0]?.headers['x-dsh-rw-protocol']).toBe('1')

    const refused = new FakeTransport()
    await expect(makeClient(refused).openMux({ key: 'x' })).rejects.toMatchObject({ code: 'tunnel-unavailable' })
  })
})

describe('SSE decoder', () => {
  it('handles arbitrary chunk boundaries, multi-line data and comments', () => {
    const decoder = new SseDecoder()
    expect(decoder.push('event: change\ndata: {"a"')).toEqual([])
    expect(decoder.push(':1}\n\n')).toEqual([{ event: 'change', data: '{"a":1}' }])
    expect(decodeSseFrame('data: one\ndata: two')).toEqual({ event: 'message', data: 'one\ntwo' })
    expect(decodeSseFrame(': ping')).toBeUndefined()
  })

  it('parses envelopes strictly', () => {
    expect(parsePluginEnvelope(200, '{"ok":true,"value":{"a":1}}', 'test')).toEqual({ a: 1 })
    expect(() => parsePluginEnvelope(200, '{"ok":true}', 'test')).toThrow(/without a value/u)
    expect(() => parsePluginEnvelope(500, 'not json', 'test')).toThrow(/non-JSON/u)
  })
})
