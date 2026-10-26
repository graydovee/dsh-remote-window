/**
 * ssh2 `forwardOut` fixture: a real SSH server and client on loopback.
 *
 * The production portal/P1 stack only ever sees forwarded channels, so this test
 * drives the actual ssh2 client forward path (HTTP through the agent, a raw
 * upgrade socket) instead of mocking the transport.
 */
import { createServer as createHttpServer } from 'node:http'
import type { Server as HttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, Server as SshServer, utils } from 'ssh2'
import { ForwardHttpAgent, SshForwarder, forwardOut, isForwardError, sendForwardedHttp } from '../src/ssh/forward.ts'

let sshServer: SshServer
let sshPort = 0
let upstream: HttpServer
let upstreamPort = 0
const sockets: Array<{ destroy(): void }> = []

beforeAll(async () => {
  upstream = createHttpServer((req, res) => {
    if (req.url === '/chunked303') {
      // DSH's tokenized root: 303 with Set-Cookie and a chunked (not
      // content-length) body. The probe must settle on the terminal chunk.
      res.writeHead(303, { 'set-cookie': 'dsh-auth-test=v1', 'content-type': 'text/plain' })
      res.write('t')
      res.end('ok')
      return
    }
    if (req.url === '/stream') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.write('one')
      setTimeout(() => { res.write('two'); res.end('three') }, 10)
      return
    }
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'dsh-auth-x=v1' })
    res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers }))
  })
  upstream.on('upgrade', (_req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
    socket.on('data', chunk => socket.write(chunk))
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  upstreamPort = (upstream.address() as AddressInfo).port

  const hostKey = utils.generateKeyPairSync('ed25519')
  sshServer = new SshServer({ hostKeys: [hostKey.private] }, client => {
    client.on('authentication', ctx => {
      if (ctx.method === 'password') ctx.accept()
      else ctx.reject(['password'])
    })
    client.on('tcpip', (accept, reject, info) => {
      if (info.destPort !== upstreamPort) {
        reject()
        return
      }
      const channel = accept()
      void import('node:net').then(({ connect }) => {
        const target = connect(info.destPort, info.destIP)
        target.once('connect', () => { channel.pipe(target).pipe(channel) })
        target.once('error', () => channel.close())
      })
    })
    client.on('session', accept => { accept() })
  })
  await new Promise<void>(resolve => sshServer.listen(0, '127.0.0.1', resolve))
  sshPort = (sshServer.address() as AddressInfo).port
})

afterAll(async () => {
  for (const socket of sockets) socket.destroy()
  await new Promise<void>(resolve => {
    sshServer.close(() => resolve())
    setTimeout(resolve, 500)
  })
  await new Promise<void>(resolve => {
    upstream.close(() => resolve())
    setTimeout(resolve, 500)
  })
})

async function connectClient(): Promise<Client> {
  const client = new Client()
  await new Promise<void>((resolve, reject) => {
    client.once('ready', resolve)
    client.once('error', reject)
    client.connect({ host: '127.0.0.1', port: sshPort, username: 'tester', password: 'fixture', hostVerifier: () => true })
  })
  return client
}

describe('forwardOut', () => {
  it('forwards a raw HTTP request through direct-tcpip', async () => {
    const client = await connectClient()
    try {
      const stream = await forwardOut(client, { port: upstreamPort })
      const result = await sendForwardedHttp(stream, { method: 'GET', path: '/hello?x=1', headers: { host: 'ignored' } })
      expect(result.status).toBe(200)
      const parsed = JSON.parse(result.body.toString('utf8')) as { url: string; headers: Record<string, string> }
      expect(parsed.url).toBe('/hello?x=1')
    } finally {
      client.end()
    }
  })

  it('settles a chunked 303 token response without a socket close', async () => {
    const client = await connectClient()
    try {
      const stream = await forwardOut(client, { port: upstreamPort })
      const started = Date.now()
      const result = await sendForwardedHttp(stream, { method: 'GET', path: '/chunked303' }, { timeoutMs: 3_000 })
      expect(result.status).toBe(303)
      expect(result.headers['set-cookie']).toContain('dsh-auth-test=v1')
      expect(Date.now() - started).toBeLessThan(2_000)
    } finally {
      client.end()
    }
  })

  it('works as an http.Agent (the portal/P1 transport path)', async () => {
    const client = await connectClient()
    const forwarder = new SshForwarder(client)
    const agent = forwarder.httpAgent({ port: upstreamPort })
    expect(agent).toBeInstanceOf(ForwardHttpAgent)
    const { request } = await import('node:http')
    const body = await new Promise<string>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: upstreamPort, path: '/agent', agent }, res => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      })
      req.once('error', reject)
      req.end()
    })
    expect(JSON.parse(body).url).toBe('/agent')
    forwarder.close()
    client.end()
  })

  it('carries a raw WebSocket upgrade handshake and post-upgrade bytes', async () => {
    const client = await connectClient()
    try {
      const stream = await forwardOut(client, { port: upstreamPort })
      stream.write('GET /api/remote.mux HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n')
      const head = await new Promise<string>((resolve, reject) => {
        let data = Buffer.alloc(0)
        const onData = (chunk: Buffer): void => {
          data = Buffer.concat([data, chunk])
          const end = data.indexOf('\r\n\r\n')
          if (end !== -1) {
            stream.off('data', onData)
            stream.write('ping')
            resolve(data.subarray(0, end).toString('utf8'))
          }
        }
        stream.on('data', onData)
        stream.once('error', reject)
      })
      expect(head).toContain('101 Switching Protocols')
      const echo = await new Promise<string>((resolve) => {
        stream.once('data', (chunk: Buffer) => resolve(chunk.toString('utf8')))
      })
      expect(echo).toBe('ping')
      stream.destroy()
    } finally {
      client.end()
    }
  })

  it('refuses before opening when the signal is already aborted', async () => {
    const client = await connectClient()
    try {
      const controller = new AbortController()
      controller.abort()
      await expect(forwardOut(client, { port: upstreamPort }, {}, controller.signal)).rejects.toSatisfy(isForwardError)
    } finally {
      client.end()
    }
  })

  it('rejects a forward the SSH server refuses', async () => {
    const client = await connectClient()
    try {
      await expect(forwardOut(client, { port: 1 })).rejects.toSatisfy(isForwardError)
    } finally {
      client.end()
    }
  })
})
