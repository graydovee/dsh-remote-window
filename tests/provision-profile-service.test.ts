/**
 * Host API vertical slice with a fake SSH transport.
 *
 * `ProfileService` is driven end-to-end: scan → plugin install → profile start →
 * token/cookie → P1 handshake → workspace/session reads → stop. The fake
 * connector's forwarder connects to a real loopback "profile server" HTTP
 * server, so the P1/portal client code (not just the service) is exercised.
 */
import { Agent, createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { connect } from 'node:net'
import type { AddressInfo } from 'node:net'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshForwarder } from '../src/ssh/forward.ts'
import type { ProfileRemote, ProfileExecResult } from '../src/provision/profile-lifecycle.ts'
import { profilePaths } from '../src/provision/profile-lifecycle.ts'
import { ProfileService, type ConnectProgressEvent, type ProfileConnection, type ProfileConnector } from '../src/provision/profile-service.ts'
import { remotePresetId } from '../src/preset/world.ts'
import type { TargetStore } from '../src/targets/store.ts'
import type { RemoteTargetRecord } from '../src/targets/types.ts'
import { packPackage, writeFakeServerPluginPackage } from './helpers/local-remote.ts'

const CLIENT_ID = 'abcdef012345'
const VERSION = '0.1.0-alpha.3'
const DSH_VERSION = '0.2.1-rc.3'
const SCAN = [
  '@@RW@@SCAN@@1',
  `HOME\t/home/user`,
  `DSHHOME\t/home/user/.dsh`,
  'UNAME\tLinux',
  'MACHINE\tx86_64',
  'OSTYPE\tLinux',
  'LDD\tldd (GNU libc) 2.35',
  'TOOL\ttar\t/bin/tar',
  'NODE\t/usr/local/bin/node\tv24.21.0',
  `DSH\t/usr/local/bin/dsh\t/usr/local/bin/dsh\t${DSH_VERSION}\t0\t/usr/local/bin/node`,
  'END',
].join('\n')

let server: Server
let serverPort = 0
let requests: { method: string; url: string; headers: IncomingMessage['headers']; body: string }[] = []
const executorModes = new Map<string, 'server' | 'local'>()
const pinnedIds: string[] = []
let registryReloads = 0
let tarball = ''
let store: TargetStore
let lastRecord: RemoteTargetRecord | undefined

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body })
      if (req.url?.startsWith('/?token=')) {
        res.writeHead(303, { location: './', 'set-cookie': 'dsh-auth-test=v1; Path=/; HttpOnly; SameSite=Strict' })
        res.end()
        return
      }
      if (req.url === '/dsh-remote-window-server/api/handshake') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, value: {
          protocol: 1,
          pluginVersion: VERSION,
          dshVersion: DSH_VERSION,
          profile: 'graydovee-remote-window-abcdef012345',
          clientId: CLIENT_ID,
          lease: { instanceId: 'i', expiresAt: '2026-01-01T00:00:20.000Z' },
          capabilities: { workspaceApi: 1, eventsSse: 1, muxWs: 1, embed: { storagePrefix: 'dshrw:test:', mode: 'reload' } },
        } }))
        return
      }
      if (req.url === '/dsh-remote-window-server/api/rpc') {
        const request = JSON.parse(body) as { method: string }
        const params = (request as { params?: Record<string, unknown> }).params ?? {}
        const values: Record<string, unknown> = {
          'workspace/list': { workspaces: [{ workspaceId: 'w1', path: '/home/user/work', title: 'work' }], pinnedSessionIds: [...pinnedIds], archivedSessionIds: [], registry: { revision: `r${registryReloads + 1}` } },
          'session/list': { sessions: [{ sessionId: 'session-1', title: 'hello', executor: 'local' }] },
          'profile/status': { activeAgents: [] },
          'profile/cancel-all': { canceled: [] },
          'session/create': { sessionId: 'session-created', agentPreset: 'remote:rt' },
          'session/timeline': { sessionId: 'session-1', events: [{ seq: 1, type: 'assistant', text: 'hi' }] },
          'session/prompt': { sessionId: 'session-1', accepted: true },
          'session/cancel': { sessionId: 'session-1', canceled: true },
          'session/approval': { sessionId: 'session-1', allowed: true },
          'session/status': { sessionId: 'session-1', running: false },
          'executor/get': { mode: executorModes.get(String(params['sessionId'])) ?? 'server' },
          'registry/refresh': (() => { registryReloads += 1; return { revision: `r${registryReloads + 1}`, serviceReplaced: true } })(),
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, value: values[request.method] ?? {} }))
        return
      }
      res.writeHead(404)
      res.end('not found')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  serverPort = (server.address() as AddressInfo).port

  const root = await mkdtemp(join(tmpdir(), 'dsh-rw-svc-fixture-'))
  await writeFakeServerPluginPackage(root, { version: VERSION })
  tarball = await packPackage(root, `dsh-remote-window-server-${VERSION}.tgz`)
  store = fakeStore()
})

afterAll(async () => {
  await new Promise<void>(resolve => {
    server.close(() => resolve())
    setTimeout(resolve, 300)
  })
})

beforeEach(() => {
  requests = []
  lastRecord = undefined
  store = fakeStore()
  process.env['DSH_RW_SERVER_PLUGIN_TARBALL'] = tarball
})

function fakeStore(): TargetStore {
  let clientId: string | undefined
  const records = new Map<string, RemoteTargetRecord>()
  const target = {
    listTargets: () => [...records.values()],
    target: (id: string) => records.get(id),
    ensureClientId: async () => {
      clientId ??= CLIENT_ID
      return clientId
    },
    clientId: () => clientId,
    putTarget: async (record: RemoteTargetRecord) => {
      records.set(record.id, record)
      lastRecord = record
    },
    updateTarget: async (id: string, mutate: (current: RemoteTargetRecord) => RemoteTargetRecord) => {
      const current = records.get(id)
      if (current === undefined) throw new Error('missing')
      const next = mutate(current)
      records.set(id, next)
      return next
    },
    storeSecret: async (record: RemoteTargetRecord) => record,
    credentialKeyOf: () => undefined,
  }
  return target as unknown as TargetStore
}

class FakeRemote implements ProfileRemote {
  alive = false
  log = `dsh web: http://127.0.0.1:${serverPort}/?token=fixture_token\n`
  readonly scripts: string[] = []
  readonly writes: string[] = []

  async exec(body: string): Promise<ProfileExecResult> {
    this.scripts.push(body)
    if (body.includes('@@RW@@SCAN@@1')) return { code: 0, stdout: SCAN, stderr: '' }
    if (body.includes('setsid nohup')) { this.alive = true; return { code: 0, stdout: '4321\n', stderr: '' } }
    if (body.includes('server.log')) return { code: 0, stdout: this.log, stderr: '' }
    if (body.includes('tar -xzf')) return { code: 0, stdout: 'installed\n', stderr: '' }
    if (body.includes('pidfile=')) { this.alive = false; return { code: 0, stdout: 'stopped\n', stderr: '' } }
    if (body.includes('kill -0')) return { code: 0, stdout: this.alive ? '0' : '1', stderr: '' }
    if (body.includes('server.pid')) return { code: 0, stdout: '4321\n', stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }

  async writeFile(path: string, _content: Buffer): Promise<void> {
    this.writes.push(path)
  }
}

function fakeForwarder(): SshForwarder {
  const forwarder = {
    open: async () => await new Promise((resolve, reject) => {
      const socket = connect(serverPort, '127.0.0.1', () => resolve(socket))
      socket.once('error', reject)
    }),
    httpAgent: () => new Agent({ keepAlive: false }),
    close: () => {},
  }
  return forwarder as unknown as SshForwarder
}

function fakeConnector(): { connector: ProfileConnector; remote: FakeRemote } {
  const remote = new FakeRemote()
  const connection: ProfileConnection = {
    remote,
    forwarder: fakeForwarder(),
    fingerprint: 'SHA256:fixture',
    close: async () => {},
  }
  return { connector: { connect: async () => connection }, remote }
}

describe('ProfileService M1 slice', () => {
  it('registers the remote preset for a v1 target and disposes it on stop', async () => {
    const { connector } = fakeConnector()
    const registered: { id?: string }[] = []
    const disposed: string[] = []
    const ctx = {
      get: (name: string) => name === 'agentPresets'
        ? {
            register: async (definition: unknown) => {
              registered.push(definition as { id?: string })
              return () => { disposed.push((definition as { id?: string }).id ?? '') }
            },
          }
        : undefined,
    } as never
    const service = new ProfileService({
      ctx,
      store,
      packageRoot: '/tmp/client-package',
      pluginVersion: VERSION,
      connector,
      cacheDir: '/tmp/cache',
    })
    const result = await service.connect({
      label: 'preset-fixture',
      host: '203.0.113.20',
      port: 22,
      username: 'tester',
      authKind: 'password',
      secret: 'hunter2',
      hostKeyFingerprint: 'SHA256:fixture',
      modelSource: 'server',
    })
    expect(result.target.executor).toBe('local')
    expect(registered.map(entry => entry.id)).toContain(remotePresetId(result.target.id))
    await service.stop(result.target.id)
    expect(disposed).toContain(remotePresetId(result.target.id))
  })

  it('state refresh reloads the registry so another client pin/archive becomes visible', async () => {
    const { connector } = fakeConnector()
    const service = new ProfileService({ store, packageRoot: '/tmp/client-package', pluginVersion: VERSION, connector, cacheDir: '/tmp/cache' })
    const result = await service.connect({
      label: 'refresh-flags', host: '203.0.113.50', port: 22, username: 'tester', authKind: 'password', secret: 'x', hostKeyFingerprint: 'SHA256:fixture',
      modelSource: 'server',
    })
    const before = registryReloads
    pinnedIds.push('session-1')
    const refreshed = await service.refresh(result.target.id)
    expect(refreshed.registryReloaded).toBe(true)
    expect(registryReloads).toBeGreaterThan(before)
    expect(refreshed.sessions).toMatchObject({ sessions: [{ sessionId: 'session-1', pinned: true }] })
    await service.stop(result.target.id)
  })

  it('forwards the planned v2 session RPCs and codes an unconnected target', async () => {
    const { connector } = fakeConnector()
    const service = new ProfileService({ store, packageRoot: '/tmp/client-package', pluginVersion: VERSION, connector, cacheDir: '/tmp/cache' })
    const result = await service.connect({
      label: 'v2-session-rpc', host: '203.0.113.60', port: 22, username: 'tester', authKind: 'password', secret: 'x', hostKeyFingerprint: 'SHA256:fixture',
      modelSource: 'server',
    })
    expect(await service.sessionTimeline(result.target.id, { sessionId: 'session-1', afterSeq: 0 })).toMatchObject({ sessionId: 'session-1' })
    expect(await service.sessionPrompt(result.target.id, { sessionId: 'session-1', text: 'hi' })).toMatchObject({ accepted: true })
    expect(await service.sessionCancel(result.target.id, { sessionId: 'session-1' })).toMatchObject({ canceled: true })
    expect(await service.sessionApproval(result.target.id, { sessionId: 'session-1', approvalId: 'a1', decision: 'allow' })).toMatchObject({ allowed: true })
    expect(await service.sessionStatus(result.target.id, { sessionId: 'session-1' })).toMatchObject({ running: false })
    await service.stop(result.target.id)
    await expect(service.sessionTimeline(result.target.id, { sessionId: 'session-1' })).rejects.toMatchObject({ code: 'target-not-connected' })
  })

  it('infers session/open executor from the server executor record', async () => {
    const { connector } = fakeConnector()
    const service = new ProfileService({ store, packageRoot: '/tmp/client-package', pluginVersion: VERSION, connector, cacheDir: '/tmp/cache' })
    const result = await service.connect({
      label: 'executor-open', host: '203.0.113.40', port: 22, username: 'tester', authKind: 'password', secret: 'x', hostKeyFingerprint: 'SHA256:fixture',
      modelSource: 'server',
    })
    const created = await service.sessionCreate(result.target.id, { workspaceId: 'w1', executor: 'server' })
    expect(created).toMatchObject({ sessionId: 'session-created', executor: 'server' })
    executorModes.set('session-created', 'server')
    expect(await service.sessionOpen(result.target.id, { sessionId: 'session-created', workspaceId: 'w1' }))
      .toMatchObject({ sessionId: 'session-created', executor: 'server' })
    executorModes.set('session-local', 'local')
    // An explicit stale `server` must not override the recorded local mode.
    await expect(service.sessionOpen(result.target.id, { sessionId: 'session-local', workspaceId: 'w1', executor: 'server' }))
      .rejects.toMatchObject({ code: 'local-runtime-unavailable' })
    await service.stop(result.target.id)
  })

  it('reuses a preset already registered by the legacy world sweep (upgrade path)', async () => {
    const existingRecord: RemoteTargetRecord = {
      id: 'rt-preset1', label: 'preset-existing', kind: 'ssh', host: '203.0.113.30', port: 22,
      username: 'tester', authKind: 'password', hostKeyFingerprint: 'SHA256:fixture',
      remote: { nodePath: 'node', dshCommand: '/usr/local/bin/dsh', profile: 'graydovee-remote-window-abcdef012345', dshHome: '/home/tester/.dsh', plugins: [] },
      status: 'ready', createdAt: '2026-01-01T00:00:00.000Z',
    }
    await store.putTarget(existingRecord)
    const register = vi.fn()
    const ctx = {
      get: (name: string) => name === 'agentPresets'
        ? { list: async () => [{ id: 'remote:rt-preset1' }], register }
        : undefined,
    } as never
    const { connector } = fakeConnector()
    const service = new ProfileService({ ctx, store, packageRoot: '/tmp/client-package', pluginVersion: VERSION, connector, cacheDir: '/tmp/cache' })
    const result = await service.connect({
      label: 'preset-existing', host: '203.0.113.30', port: 22, username: 'tester', authKind: 'password', secret: 'x', hostKeyFingerprint: 'SHA256:fixture',
      modelSource: 'server',
    })
    expect(result.target.id).toBe('rt-preset1')
    expect(register).not.toHaveBeenCalled()
    await service.stop(result.target.id)
  })

  it('decides runtime/plugin actions during the probe step before deploying', async () => {
    const { connector } = fakeConnector()
    const service = new ProfileService({ store, packageRoot: '/tmp/client-package', pluginVersion: VERSION, connector, cacheDir: '/tmp/cache' })
    const progress: ConnectProgressEvent[] = []
    await service.connect({
      label: 'probe-fixture',
      host: '203.0.113.11',
      port: 22,
      username: 'tester',
      authKind: 'password',
      secret: 'hunter2',
      hostKeyFingerprint: 'SHA256:fixture',
      modelSource: 'server',
    }, event => progress.push(event))
    const probe = progress.find(event => event.step === 'probe' && event.status === 'ok')
    expect(probe?.message).toContain('运行时 跳过')
    expect(probe?.message).toContain('server 插件 部署')
    expect(progress.find(event => event.step === 'runtime')?.status).toBe('skipped')
    expect(progress.find(event => event.step === 'upload')?.status).toBe('ok')
  })

  it('connects, installs, starts, handshakes and exposes workspace/session data', async () => {
    const { connector, remote } = fakeConnector()
    const service = new ProfileService({
      store,
      packageRoot: '/tmp/client-package',
      pluginVersion: VERSION,
      connector,
      cacheDir: '/tmp/cache',
    })
    const result = await service.connect({
      label: 'fixture',
      host: '203.0.113.10',
      port: 22,
      username: 'tester',
      authKind: 'password',
      secret: 'hunter2',
      hostKeyFingerprint: 'SHA256:fixture',
      modelSource: 'server',
    })
    expect(result.target).toMatchObject({ label: 'fixture', profileName: 'graydovee-remote-window-abcdef012345', pluginVersion: VERSION, serverDshVersion: DSH_VERSION })
    expect(result.state).toMatchObject({ phase: 'ready', profile: { name: 'graydovee-remote-window-abcdef012345', port: serverPort, pid: 4321 } })
    expect(result.state.deployment?.plugin).toMatchObject({ dedicated: true, expectedVersion: VERSION, action: 'reuse' })
    expect(service.deploymentPreview(result.target.id).runtime.mode).toBe('confirm')
    await expect(service.deploymentApply(result.target.id, { kind: 'runtime', confirm: false })).rejects.toMatchObject({ code: 'runtime-confirmation-required' })
    await expect(service.deploymentApply(result.target.id, { kind: 'runtime', confirm: true })).rejects.toMatchObject({ code: 'runtime-global-unsupported' })
    expect(service.connections()[result.target.id]).toMatchObject({ phase: 'ready' })
    expect(await service.workspaceList(result.target.id)).toMatchObject({ workspaces: [{ workspaceId: 'w1' }] })
    expect(await service.sessionList(result.target.id, 'w1')).toMatchObject({ sessions: [{ sessionId: 'session-1', executor: 'local', archived: false }] })
    expect(await service.refresh(result.target.id)).toMatchObject({ stale: false })
    const handshake = requests.find(entry => entry.url.endsWith('/api/handshake'))
    expect(handshake?.headers['x-dsh-rw-client']).toBe(CLIENT_ID)
    expect(handshake?.headers['x-dsh-rw-instance']).toBeTruthy()
    expect(handshake?.headers.cookie).toContain('dsh-auth-test=v1')
    expect(remote.scripts.some(script => script.includes('setsid nohup'))).toBe(true)
    expect(remote.writes.some(path => path.includes('dsh-remote-window-server-'))).toBe(true)
    expect(remote.scripts.some(script => script.includes('/node_modules/dsh-remote-window-server'))).toBe(true)
    expect(await service.stop(result.target.id)).toBe(true)
    expect(service.connections()[result.target.id]?.phase).toBe('stopped')
  })

  it('reports failures without leaving a live state', async () => {
    const { connector } = fakeConnector()
    const service = new ProfileService({
      store,
      packageRoot: '/tmp/client-package',
      pluginVersion: '9.9.9',
      connector,
      cacheDir: '/tmp/cache',
    })
    await expect(service.connect({
      label: 'bad-version',
      host: '203.0.113.11',
      port: 22,
      username: 'tester',
      authKind: 'password',
      secret: 'x',
      hostKeyFingerprint: 'SHA256:fixture',
      modelSource: 'server',
    })).rejects.toBeDefined()
    expect(Object.values(service.connections()).every(state => state.phase !== 'ready')).toBe(true)
  })
})
