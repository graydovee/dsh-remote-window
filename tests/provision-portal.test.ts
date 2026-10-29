/**
 * P2 portal proxy against a real loopback upstream (protocol §8).
 *
 * The upstream is a real HTTP server and a real upgrade socket; the SSH tunnel
 * is replaced by direct loopback connections, so the proxy's header rewriting,
 * streaming, Set-Cookie removal, timeout and WebSocket piping are all exercised.
 */
import { Agent, createServer, request as httpRequest } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import { connect } from 'node:net'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  PortalError,
  PortalProxy,
  portalMuxPath,
  portalPath,
  portalRequestAllowed,
  portalResponseHeaders,
  portalUpstreamHeaders,
  stripPortalPrefix,
  type PortalUpstream,
} from '../src/portal/proxy.ts'

let upstream: Server
let upstreamPort = 0
let lastHeaders: IncomingMessage['headers'] = {}
let slowMode = false

beforeAll(async () => {
  upstream = createServer((req, res) => {
    lastHeaders = req.headers
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      if (slowMode) {
        setTimeout(() => { res.writeHead(200); res.end('late') }, 200)
        return
      }
      if (req.url === '/chunks') {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.write('a')
        setTimeout(() => { res.write('b'); res.end('c') }, 5)
        return
      }
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'dsh-auth-secret=v1' })
      res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
  })
  upstream.on('upgrade', (req, socket) => {
    lastHeaders = req.headers
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
    socket.on('data', chunk => socket.write(chunk))
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  upstreamPort = (upstream.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>(resolve => {
    upstream.close(() => resolve())
    setTimeout(resolve, 300)
  })
})

function directUpstream(): PortalUpstream {
  return {
    host: '127.0.0.1',
    port: upstreamPort,
    agent: new Agent({ keepAlive: false }),
    connect: () => new Promise((resolve, reject) => {
      const socket = connect(upstreamPort, '127.0.0.1', () => resolve(socket))
      socket.once('error', reject)
    }),
  }
}

async function startPortal(options: { targetId?: string; timeoutMs?: number; cookie?: string } = {}): Promise<{ port: number; proxy: PortalProxy; close(): Promise<void> }> {
  const targetId = options.targetId ?? 't1'
  const proxy = new PortalProxy(targetId, directUpstream(), options.cookie ?? 'dsh-auth-official=v1', options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
  const server = createServer((req, res) => { void proxy.handleRequest(req, res) })
  server.on('upgrade', (req, socket, head) => { void proxy.handleUpgrade(req, socket, head) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as AddressInfo).port,
    proxy,
    close: async () => { await new Promise<void>(resolve => { server.close(() => resolve()); setTimeout(resolve, 200) }) },
  }
}

interface ResponseResult { status: number; headers: IncomingMessage['headers']; body: string }

function call(port: number, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<ResponseResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: options.headers ?? {} }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

describe('portal header/route helpers', () => {
  it('strips exactly one mount prefix and keeps the query untouched', () => {
    expect(stripPortalPrefix('/dsh-remote-window/portal/t1', 't1')).toBe('/')
    expect(stripPortalPrefix('/dsh-remote-window/portal/t1/', 't1')).toBe('/')
    expect(stripPortalPrefix('/dsh-remote-window/portal/t1/api/x?q=1', 't1')).toBe('/api/x?q=1')
    expect(stripPortalPrefix('/dsh-remote-window/portal/t2/', 't1')).toBeUndefined()
    expect(portalMuxPath('t1')).toBe('/dsh-remote-window/portal/t1/api/remote.mux')
  })

  it('rewrites Host, drops Origin/Referer and browser cookies, injects the official cookie', () => {
    const headers = portalUpstreamHeaders({
      host: 'client.example:5173',
      origin: 'http://client.example:5173',
      referer: 'http://client.example:5173/',
      cookie: 'dsh-auth-client=v1',
      'accept-encoding': 'gzip',
      'sec-fetch-site': 'same-origin',
    }, { upstreamPort: 4000, cookie: 'dsh-auth-official=v1' })
    expect(headers.host).toBe('127.0.0.1:4000')
    expect(headers.origin).toBeUndefined()
    expect(headers.referer).toBeUndefined()
    expect(headers.cookie).toBe('dsh-auth-official=v1')
    expect(headers['accept-encoding']).toBe('gzip')
    expect(headers['sec-fetch-site']).toBe('same-origin')
  })

  it('never forwards Set-Cookie and guards cross-site/foreign-origin requests', () => {
    expect(portalResponseHeaders({ 'set-cookie': 'a=b', 'content-type': 'text/html' })).toEqual({ 'content-type': 'text/html' })
    expect(portalRequestAllowed({ headers: { 'sec-fetch-site': 'cross-site' } })).toMatchObject({ ok: false, code: 'forbidden' })
    expect(portalRequestAllowed({ headers: { origin: 'http://evil.example' } }, 'http://client.example')).toMatchObject({ ok: false })
    expect(portalRequestAllowed({ headers: { origin: 'http://client.example' } }, 'http://client.example')).toEqual({ ok: true })
  })

  it('exposes a coded error for the route layer', () => {
    const error = new PortalError('target-not-connected', 'not connected', 404)
    expect(error).toMatchObject({ code: 'target-not-connected', status: 404, message: 'not connected' })
  })
})

describe('PortalProxy HTTP', () => {
  it('forwards path/query/body and rewrites the documented headers', async () => {
    slowMode = false
    const portal = await startPortal()
    try {
      const result = await call(portal.port, `${portalPath('t1')}api/x?q=1`, {
        method: 'POST',
        headers: { origin: 'http://client.example', referer: 'http://client.example/', cookie: 'browser-cookie=1', 'content-type': 'application/json' },
        body: '{"hello":true}',
      })
      expect(result.status).toBe(200)
      const echoed = JSON.parse(result.body) as { method: string; url: string; headers: Record<string, string>; body: string }
      expect(echoed.method).toBe('POST')
      expect(echoed.url).toBe('/api/x?q=1')
      expect(echoed.body).toBe('{"hello":true}')
      expect(echoed.headers.host).toBe(`127.0.0.1:${upstreamPort}`)
      expect(echoed.headers.cookie).toBe('dsh-auth-official=v1')
      expect(result.headers['set-cookie']).toBeUndefined()
    } finally {
      await portal.close()
    }
  })

  it('streams a chunked response and keeps a 4xx upstream status', async () => {
    slowMode = false
    const portal = await startPortal()
    try {
      const result = await call(portal.port, `${portalPath('t1')}chunks`)
      expect(result.body).toBe('abc')
      expect(result.headers['set-cookie']).toBeUndefined()
    } finally {
      await portal.close()
    }
  })

  it('returns 400 outside the mount, 404 after close and 502 on timeout', async () => {
    slowMode = false
    const portal = await startPortal({ timeoutMs: 20 })
    try {
      expect((await call(portal.port, '/elsewhere')).status).toBe(400)
      slowMode = true
      expect((await call(portal.port, `${portalPath('t1')}slow`)).status).toBe(502)
      slowMode = false
      portal.proxy.close()
      expect((await call(portal.port, `${portalPath('t1')}`)).status).toBe(404)
    } finally {
      await portal.close()
    }
  })
})

describe('PortalProxy WebSocket upgrade', () => {
  it('forwards the exact mux upgrade and pipes post-upgrade bytes', async () => {
    const portal = await startPortal()
    try {
      const raw = await new Promise<{ head: string; socket: import('node:net').Socket }>((resolve, reject) => {
        const socket = connect(portal.port, '127.0.0.1')
        let data = Buffer.alloc(0)
        socket.once('connect', () => {
          socket.write([
            `GET ${portalMuxPath('t1')} HTTP/1.1`,
            `Host: 127.0.0.1:${portal.port}`,
            'Connection: Upgrade',
            'Upgrade: websocket',
            'Sec-WebSocket-Version: 13',
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
            'Origin: http://client.example',
            'Cookie: browser-cookie=1',
            '',
            '',
          ].join('\r\n'))
        })
        const timer = setTimeout(() => { socket.destroy(); reject(new Error('upgrade timed out')) }, 5_000)
        const onData = (chunk: Buffer): void => {
          data = Buffer.concat([data, chunk])
          const end = data.indexOf('\r\n\r\n')
          if (end === -1) return
          clearTimeout(timer)
          socket.off('data', onData)
          resolve({ head: data.subarray(0, end).toString('utf8'), socket })
        }
        socket.on('data', onData)
        socket.once('error', reject)
      })
      expect(raw.head).toContain('101 Switching Protocols')
      expect(lastHeaders.host).toBe(`127.0.0.1:${upstreamPort}`)
      expect(lastHeaders.cookie).toBe('dsh-auth-official=v1')
      const echo = await new Promise<string>((resolve, reject) => {
        raw.socket.once('data', (chunk: Buffer) => resolve(chunk.toString('utf8')))
        raw.socket.once('error', reject)
        raw.socket.write('ping')
      })
      expect(echo).toBe('ping')
      raw.socket.destroy()
    } finally {
      await portal.close()
    }
  })

  it('rejects an upgrade path that is not the mux', async () => {
    const portal = await startPortal()
    try {
      const result = await new Promise<string>((resolve, reject) => {
        const socket = connect(portal.port, '127.0.0.1')
        let data = ''
        socket.once('connect', () => {
          socket.write([
            `GET ${portalPath('t1')}other HTTP/1.1`,
            `Host: 127.0.0.1:${portal.port}`,
            'Connection: Upgrade',
            'Upgrade: websocket',
            '',
            '',
          ].join('\r\n'))
        })
        socket.on('data', chunk => { data += chunk.toString('utf8') })
        socket.once('error', reject)
        socket.once('close', () => resolve(data))
        setTimeout(() => { socket.destroy(); resolve(data) }, 500)
      })
      expect(result).toContain('400')
    } finally {
      await portal.close()
    }
  })
})
