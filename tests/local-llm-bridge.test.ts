/**
 * The loopback bridge only forwards `/v1/...`, injects the saved key in place
 * of whatever the profile sent, streams the upstream reply through and never
 * puts the key in an error.
 */
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo, Server } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startLocalLlmBridge, type LocalLlmBridge, type LocalLlmBridgeOptions } from '../src/local-llm/bridge.ts'

interface UpstreamRequest {
  readonly method: string
  readonly url: string
  readonly headers: IncomingHttpHeaders
  body: string
}

interface FakeUpstream {
  readonly port: number
  readonly requests: UpstreamRequest[]
  close(): Promise<void>
}

/** Start a fake OpenAI-compatible endpoint on loopback; the handler gets the request. */
async function upstream(handler: (request: UpstreamRequest, response: ServerResponse, rawRequest: IncomingMessage) => void): Promise<FakeUpstream> {
  const requests: UpstreamRequest[] = []
  const server: Server = createServer((request, response) => {
    const record: UpstreamRequest = { method: request.method ?? '', url: request.url ?? '', headers: request.headers, body: '' }
    requests.push(record)
    request.setEncoding('utf8')
    request.on('data', chunk => {
      record.body += chunk
    })
    request.on('end', () => {
      handler(record, response, request)
    })
  })
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as AddressInfo).port
  return {
    port,
    requests,
    close: async () => {
      await new Promise<void>(resolve => {
        server.close(() => resolve())
      })
    },
  }
}

async function freePort(): Promise<number> {
  const server: Server = createServer()
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as AddressInfo).port
  await new Promise<void>(resolve => {
    server.close(() => resolve())
  })
  return port
}

function open(endpoint: FakeUpstream, extra: Partial<LocalLlmBridgeOptions> = {}): Promise<LocalLlmBridge> {
  return startLocalLlmBridge({
    baseUrl: `http://127.0.0.1:${endpoint.port}`,
    timeoutMs: 5_000,
    ...extra,
  })
}

const bridges: LocalLlmBridge[] = []
const upstreams: FakeUpstream[] = []
afterEach(async () => {
  await Promise.all(bridges.splice(0).map(bridge => bridge.close()))
  await Promise.all(upstreams.splice(0).map(endpoint => endpoint.close()))
})

async function start(endpoint: FakeUpstream, extra: Partial<LocalLlmBridgeOptions> = {}): Promise<LocalLlmBridge> {
  upstreams.push(endpoint)
  const bridge = await open(endpoint, extra)
  bridges.push(bridge)
  return bridge
}

async function startEndpoint(handler: (request: UpstreamRequest, response: ServerResponse, rawRequest: IncomingMessage) => void): Promise<FakeUpstream> {
  const endpoint = await upstream(handler)
  upstreams.push(endpoint)
  return endpoint
}

describe('startLocalLlmBridge', () => {
  it('binds loopback only and forwards /v1 paths with their query, appending them once', async () => {
    const endpoint = await startEndpoint((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'qwen3' }] }))
    })
    const bridge = await start(endpoint, { baseUrl: `http://127.0.0.1:${endpoint.port}/openai/v1` })
    expect(bridge.host).toBe('127.0.0.1')
    expect(bridge.url).toBe(`http://127.0.0.1:${bridge.port}`)

    const response = await fetch(`${bridge.url}/v1/models?limit=2`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [{ id: 'qwen3' }] })
    expect(endpoint.requests).toHaveLength(1)
    expect(endpoint.requests[0]?.method).toBe('GET')
    expect(endpoint.requests[0]?.url).toBe('/openai/v1/models?limit=2')
  })

  it('refuses anything outside /v1/ without contacting the endpoint', async () => {
    const endpoint = await startEndpoint((_request, response) => {
      response.writeHead(200)
      response.end('{}')
    })
    const bridge = await start(endpoint)
    for (const path of ['/health', '/v1', '/v2/models']) {
      const response = await fetch(`${bridge.url}${path}`)
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ error: { code: 'local-llm-not-found' } })
    }
    expect(endpoint.requests).toHaveLength(0)
  })

  it('replaces the inbound Authorization with the saved key and strips hop-by-hop headers', async () => {
    const endpoint = await startEndpoint((_request, response) => {
      response.writeHead(200)
      response.end('{}')
    })
    const bridge = await start(endpoint, { apiKey: 'sk-real-key' })
    const response = await fetch(`${bridge.url}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer attacker-supplied',
        'proxy-authorization': 'Basic attacker',
        connection: 'keep-alive',
        'content-type': 'application/json',
      },
      body: '{"model":"qwen3"}',
    })
    expect(response.status).toBe(200)
    const seen = endpoint.requests[0]
    expect(seen?.method).toBe('POST')
    expect(seen?.url).toBe('/v1/chat/completions')
    expect(seen?.body).toBe('{"model":"qwen3"}')
    expect(seen?.headers.authorization).toBe('Bearer sk-real-key')
    expect(seen?.headers['proxy-authorization']).toBeUndefined()
    // The upstream parser always adds its own Host; it must be the endpoint,
    // and Node's client adds Connection/Transfer-Encoding of its own.
    expect(seen?.headers.host).toBe(`127.0.0.1:${endpoint.port}`)
    expect(seen?.headers['proxy-authorization']).toBeUndefined()
    expect(seen?.headers.te).toBeUndefined()
    expect(seen?.headers.trailer).toBeUndefined()
    expect(seen?.headers.upgrade).toBeUndefined()
  })

  it('strips an inbound Authorization even when no key is configured', async () => {
    const endpoint = await startEndpoint((_request, response) => {
      response.writeHead(200)
      response.end('{}')
    })
    const bridge = await start(endpoint)
    await fetch(`${bridge.url}/v1/models`, { headers: { authorization: 'Bearer attacker' } })
    expect(endpoint.requests[0]?.headers.authorization).toBeUndefined()
  })

  it('streams chunks through without buffering the whole body', async () => {
    const endpoint = await startEndpoint((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: one\n\n')
      setTimeout(() => {
        response.write('data: two\n\n')
        response.end()
      }, 10)
    })
    const bridge = await start(endpoint)
    const response = await fetch(`${bridge.url}/v1/chat/completions`, { method: 'POST', body: '{"stream":true}' })
    expect(response.status).toBe(200)
    const reader = response.body?.getReader()
    expect(reader).toBeDefined()
    const decoder = new TextDecoder()
    let text = ''
    for (;;) {
      const { done, value } = await reader!.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    expect(text).toContain('data: one')
    expect(text).toContain('data: two')
  })

  it('tears the upstream request down when the client aborts', async () => {
    let upstreamClosed = false
    const endpoint = await startEndpoint((_request, response, rawRequest) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: first\n\n')
      rawRequest.on('close', () => {
        upstreamClosed = true
      })
      response.on('close', () => {
        upstreamClosed = true
      })
    })
    const bridge = await start(endpoint)
    const controller = new AbortController()
    const response = await fetch(`${bridge.url}/v1/chat/completions`, { method: 'POST', body: '{}', signal: controller.signal })
    const reader = response.body!.getReader()
    await reader.read()
    controller.abort()
    await vi.waitFor(() => {
      expect(upstreamClosed).toBe(true)
    })
  })

  it('answers 504 when the endpoint stalls past the timeout', async () => {
    const endpoint = await startEndpoint(() => {
      // Never answer.
    })
    const bridge = await start(endpoint, { apiKey: 'sk-timeout-secret', timeoutMs: 80 })
    const response = await fetch(`${bridge.url}/v1/chat/completions`, { method: 'POST', body: '{}' })
    expect(response.status).toBe(504)
    const body = await response.text()
    expect(JSON.parse(body)).toMatchObject({ error: { code: 'local-llm-upstream-timeout' } })
    expect(body).not.toContain('sk-timeout-secret')
  })

  it('answers 502 (scrubbed) when the endpoint refuses connections', async () => {
    const port = await freePort()
    const bridge = await startLocalLlmBridge({ baseUrl: `http://127.0.0.1:${port}`, apiKey: 'sk-refused-secret', timeoutMs: 2_000 })
    bridges.push(bridge)
    const response = await fetch(`${bridge.url}/v1/models`)
    expect(response.status).toBe(502)
    const body = await response.text()
    expect(JSON.parse(body)).toMatchObject({ error: { code: 'local-llm-upstream-failed' } })
    expect(body).not.toContain('sk-refused-secret')
  })

  it('is idempotent on close and stops listening', async () => {
    const endpoint = await startEndpoint((_request, response) => {
      response.writeHead(200)
      response.end('{}')
    })
    const bridge = await start(endpoint)
    await bridge.close()
    await bridge.close()
    await expect(fetch(`${bridge.url}/v1/models`)).rejects.toThrow()
  })

  it('rejects an invalid timeout before binding a port', async () => {
    await expect(startLocalLlmBridge({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 0 })).rejects.toThrow(/timeout/u)
  })
})
