/**
 * `client/targets` publication (protocol §16.14).
 *
 * The service is driven through a fake SSH connector that reaches a real
 * loopback "profile server" (the same fixture shape as
 * `provision-profile-service.test.ts`), so the handshake capability bit, the
 * P1 envelope and the actual JSON payload on the wire are exercised for real.
 * The snapshot itself is asserted through the public `clientTargetsSnapshot()`.
 */
import { Agent, createServer } from 'node:http'
import type { Server } from 'node:http'
import { connect } from 'node:net'
import type { AddressInfo } from 'node:net'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { SshForwarder } from '../src/ssh/forward.ts'
import type { ProfileRemote, ProfileExecResult } from '../src/provision/profile-lifecycle.ts'
import { ProfileService, type ConnectProfileRequest, type ProfileConnection, type ProfileConnector } from '../src/provision/profile-service.ts'
import type { TargetStore } from '../src/targets/store.ts'
import type { RemoteTargetRecord } from '../src/targets/types.ts'
import { packPackage, writeFakeServerPluginPackage } from './helpers/local-remote.ts'

const CLIENT_ID = 'abcdef012345'
const VERSION = '0.1.0-alpha.3'
const DSH_VERSION = '0.2.1-rc.3'
const SCAN = [
  '@@RW@@SCAN@@1',
  'HOME\t/home/user',
  'DSHHOME\t/home/user/.dsh',
  'UNAME\tLinux',
  'MACHINE\tx86_64',
  'OSTYPE\tLinux',
  'LDD\tldd (GNU libc) 2.35',
  'TOOL\ttar\t/bin/tar',
  'NODE\t/usr/local/bin/node\tv24.21.0',
  `DSH\t/usr/local/bin/dsh\t/usr/local/bin/dsh\t${DSH_VERSION}\t0\t/usr/local/bin/node`,
  'END',
].join('\n')

/** One published `client/targets` value as it arrived on the wire. */
interface PublishedSnapshot {
  readonly clientId: string
  readonly updatedAt: number
  readonly activeTargetId?: string
  readonly targets: readonly {
    readonly targetId: string
    readonly label: string
    readonly kind: string
    readonly host?: string
    readonly port?: number
    readonly username?: string
    readonly phase: string
    readonly active?: true
  }[]
}

let server: Server
let serverPort = 0
let published: PublishedSnapshot[] = []
/** Whether the fake server advertises `clientTargets: 1` in its handshake. */
let clientTargetsSupported = true
/** Set to hold the next `client/targets` response until released. */
let holdClientTargets: { readonly promise: Promise<void>; readonly release: () => void } | undefined
let tarball = ''
const services: ProfileService[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8')
      if (req.url?.startsWith('/?token=')) {
        res.writeHead(303, { location: './', 'set-cookie': 'dsh-auth-test=v1; Path=/; HttpOnly; SameSite=Strict' })
        res.end()
        return
      }
      if (req.url === '/dsh-remote-workspace-server/api/handshake') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, value: {
          protocol: 1,
          pluginVersion: VERSION,
          dshVersion: DSH_VERSION,
          profile: 'graydovee-remote-workspace-abcdef012345',
          clientId: CLIENT_ID,
          lease: { instanceId: 'i', expiresAt: '2026-01-01T00:00:20.000Z' },
          capabilities: {
            workspaceApi: 1,
            eventsSse: 1,
            muxWs: 1,
            embed: { storagePrefix: 'dshrw:test:', mode: 'reload' },
            ...(clientTargetsSupported ? { clientTargets: 1 } : {}),
          },
        } }))
        return
      }
      if (req.url === '/dsh-remote-workspace-server/api/rpc') {
        const request = JSON.parse(body) as { method: string; params?: unknown }
        if (request.method === 'client/targets') {
          published.push(request.params as PublishedSnapshot)
          const hold = holdClientTargets
          holdClientTargets = undefined
          if (hold !== undefined) await hold.promise
          const value = request.params as PublishedSnapshot
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true, value: { accepted: true, updatedAt: value.updatedAt, count: value.targets.length } }))
          return
        }
        const values: Record<string, unknown> = {
          'workspace/list': { workspaces: [], pinnedSessionIds: [], archivedSessionIds: [], registry: { revision: 'r1' } },
          'session/list': { sessions: [] },
          'profile/status': { activeAgents: [] },
          'profile/cancel-all': { canceled: [] },
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

  const root = await mkdtemp(join(tmpdir(), 'dsh-rw-client-targets-'))
  await writeFakeServerPluginPackage(root, { version: VERSION })
  tarball = await packPackage(root, `dsh-remote-workspace-server-${VERSION}.tgz`)
})

afterAll(async () => {
  delete process.env['DSH_RW_SERVER_PLUGIN_TARBALL']
  await new Promise<void>(resolve => {
    server.close(() => resolve())
    setTimeout(resolve, 300)
  })
})

beforeEach(() => {
  published = []
  clientTargetsSupported = true
  holdClientTargets = undefined
  process.env['DSH_RW_SERVER_PLUGIN_TARBALL'] = tarball
})

afterEach(async () => {
  holdClientTargets = undefined
  await Promise.allSettled(services.map(async service => await service.dispose()))
  services.length = 0
})

function deferred(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {}
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

/** Poll until `predicate` holds; a quiet failure instead of a hung test. */
async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the client-targets condition')
    await new Promise<void>(resolve => { setTimeout(resolve, 10) })
  }
}

async function settle(ms = 400): Promise<void> {
  await new Promise<void>(resolve => { setTimeout(resolve, ms) })
}

function fakeStore(): TargetStore {
  let clientId: string | undefined
  const records = new Map<string, RemoteTargetRecord>()
  const store = {
    listTargets: () => [...records.values()],
    target: (id: string) => records.get(id),
    ensureClientId: async () => {
      clientId ??= CLIENT_ID
      return clientId
    },
    clientId: () => clientId,
    putTarget: async (record: RemoteTargetRecord) => { records.set(record.id, record) },
    updateTarget: async (id: string, mutate: (current: RemoteTargetRecord) => RemoteTargetRecord) => {
      const current = records.get(id)
      if (current === undefined) throw new Error('missing target')
      const next = mutate(current)
      records.set(id, next)
      return next
    },
    // The real store records the credential *reference* on the record; the
    // snapshot must never publish it.
    storeSecret: async (record: RemoteTargetRecord) => ({ ...record, credentialKey: 'remote-workspace/target-secret' }),
    secretOf: async () => 'stored-secret-value',
    credentialKeyOf: () => undefined,
  }
  return store as unknown as TargetStore
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
    open: async () => await new Promise<ReturnType<typeof connect>>((resolve, reject) => {
      const socket = connect(serverPort, '127.0.0.1', () => resolve(socket))
      socket.once('error', reject)
    }),
    httpAgent: () => new Agent({ keepAlive: false }),
    close: () => {},
  }
  return forwarder as unknown as SshForwarder
}

/** A connector whose next `connect` call can be held (for the `connecting` phase). */
class FixtureConnector implements ProfileConnector {
  private gate: { readonly promise: Promise<void>; readonly release: () => void } | undefined

  holdNext(): () => void {
    const gate = deferred()
    this.gate = gate
    return gate.release
  }

  async connect(): Promise<ProfileConnection> {
    const gate = this.gate
    this.gate = undefined
    if (gate !== undefined) await gate.promise
    return {
      remote: new FakeRemote(),
      forwarder: fakeForwarder(),
      fingerprint: 'SHA256:fixture',
      close: async () => {},
    }
  }
}

function makeService(store: TargetStore, connector: ProfileConnector = new FixtureConnector()): ProfileService {
  const service = new ProfileService({
    store,
    packageRoot: '/tmp/client-package',
    pluginVersion: VERSION,
    connector,
    cacheDir: '/tmp/cache',
  })
  services.push(service)
  return service
}

async function connectTarget(
  service: ProfileService,
  label: string,
  extra: Partial<ConnectProfileRequest> = {},
): Promise<Awaited<ReturnType<ProfileService['connect']>>> {
  return await service.connect({
    label,
    host: '203.0.113.10',
    port: 22,
    username: 'tester',
    authKind: 'password',
    secret: 'hunter2',
    hostKeyFingerprint: 'SHA256:fixture',
    modelSource: 'server',
    ...extra,
  })
}

const SECRET_FIELD_NAMES = [
  'credentialKey',
  'privateKeyPath',
  'hostKeyFingerprint',
  'profileName',
  'lastError',
  'dshHome',
  'runtimeDir',
  'sshConfigAlias',
  'wslDistro',
] as const

describe('client targets snapshot', () => {
  it('keeps store order and maps ready/stopped/connecting phases', async () => {
    const store = fakeStore()
    const connector = new FixtureConnector()
    const service = makeService(store, connector)
    const alpha = await connectTarget(service, 'alpha')
    const beta = await connectTarget(service, 'beta')

    expect(service.clientTargetsSnapshot().targets.map(target => [target.label, target.phase])).toEqual([
      ['alpha', 'ready'],
      ['beta', 'ready'],
    ])

    await service.stop(beta.target.id)
    expect(service.clientTargetsSnapshot().targets.map(target => [target.label, target.phase])).toEqual([
      ['alpha', 'ready'],
      ['beta', 'stopped'],
    ])

    // A reconnect of a stored target reports `connecting` from the moment the
    // attempt starts, not the phase of the connection it is replacing.
    const release = connector.holdNext()
    const pending = connectTarget(service, 'alpha')
    try {
      await waitFor(() => service.clientTargetsSnapshot().targets[0]?.phase === 'connecting')
      expect(service.clientTargetsSnapshot().targets[0]).toMatchObject({ label: 'alpha', phase: 'connecting' })
    } finally {
      release()
    }
    await pending
    expect(service.clientTargetsSnapshot().targets.map(target => [target.label, target.phase])).toEqual([
      ['alpha', 'ready'],
      ['beta', 'stopped'],
    ])
    // Store order is the source of the row order.
    expect(service.clientTargetsSnapshot().targets.map(target => target.targetId)).toEqual(store.listTargets().map(record => record.id))
  })

  it('publishes only the allowlisted fields and never a secret or a path', async () => {
    const store = fakeStore()
    const service = makeService(store)
    const alpha = await connectTarget(service, 'alpha', { privateKeyPath: '/home/user/.ssh/id_ed25519' })
    await store.updateTarget(alpha.target.id, current => ({ ...current, lastError: 'password=hunter2 rejected' }))

    const snapshot = service.clientTargetsSnapshot()
    expect(snapshot.clientId).toBe(CLIENT_ID)
    expect(snapshot.targets).toEqual([
      {
        targetId: alpha.target.id,
        label: 'alpha',
        kind: 'ssh',
        host: '203.0.113.10',
        port: 22,
        username: 'tester',
        phase: 'ready',
      },
    ])
    // The payload is built from `toPublicTarget()`, which drops the credential
    // reference, key path, host-key fingerprint and profile name; the row picks
    // only the protocol's fields, so remote paths never cross either.
    expect(Object.keys(snapshot.targets[0] ?? {})).toEqual(['targetId', 'label', 'kind', 'host', 'port', 'username', 'phase'])
    const json = JSON.stringify(snapshot)
    for (const field of SECRET_FIELD_NAMES) expect(json).not.toContain(field)
    expect(json).not.toContain('/home/user')
    expect(json).not.toContain('~/.ssh')
    expect(json).not.toContain('hunter2')
    expect(json).not.toContain('remote-workspace/target-secret')
    expect(json).not.toContain('graydovee-remote-workspace')
  })

  it('omits the endpoint for a local WSL distribution target', async () => {
    const store = fakeStore()
    const service = makeService(store)
    await store.putTarget({
      id: 'rt-wsl0001',
      label: 'Ubuntu',
      kind: 'wsl',
      host: 'Ubuntu',
      port: 0,
      username: '',
      authKind: 'agent',
      hostKeyFingerprint: '',
      credentialKey: 'remote-workspace/wsl-secret',
      remote: { nodePath: 'node', dshCommand: 'dsh', profile: '', dshHome: '/home/user/.dsh', plugins: [] },
      status: 'stopped',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(service.clientTargetsSnapshot()).toEqual({
      clientId: '',
      updatedAt: expect.any(Number),
      targets: [{ targetId: 'rt-wsl0001', label: 'Ubuntu', kind: 'wsl', phase: 'stopped' }],
    })
  })

  it('moves the timestamp forward even when two snapshots land in the same millisecond', () => {
    const service = makeService(fakeStore())
    const first = service.clientTargetsSnapshot()
    const second = service.clientTargetsSnapshot()
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt)
  })
})

describe('client targets publication', () => {
  it('publishes nothing when the server does not advertise the capability', async () => {
    clientTargetsSupported = false
    const store = fakeStore()
    const service = makeService(store)
    await connectTarget(service, 'alpha')
    service.publishClientTargets()
    await settle()
    expect(published).toHaveLength(0)
  })

  it('publishes nothing while no connection is live', async () => {
    const store = fakeStore()
    const service = makeService(store)
    service.publishClientTargets()
    await settle(300)
    expect(published).toHaveLength(0)

    const alpha = await connectTarget(service, 'alpha')
    await waitFor(() => published.length >= 1)
    await settle(50)
    published = []
    await service.stop(alpha.target.id)
    // The last live connection is gone: the timers are cleared, nothing is sent.
    await settle()
    expect(published).toHaveLength(0)
  })

  it('publishes the whole connection list in store order once a live server opts in', async () => {
    const store = fakeStore()
    const service = makeService(store)
    await connectTarget(service, 'alpha')
    await connectTarget(service, 'beta')
    await waitFor(() => published.length >= 2)
    const last = published.at(-1)
    expect(last?.clientId).toBe(CLIENT_ID)
    expect(last?.targets.map(target => [target.label, target.phase, target.host, target.username])).toEqual([
      ['alpha', 'ready', '203.0.113.10', 'tester'],
      ['beta', 'ready', '203.0.113.10', 'tester'],
    ])
    // The active target is browser state; the host omits it.
    expect(last).not.toHaveProperty('activeTargetId')
    expect(last?.targets.every(target => !('active' in target))).toBe(true)
    const json = JSON.stringify(published)
    for (const field of SECRET_FIELD_NAMES) expect(json).not.toContain(field)
  })

  it('debounces a burst into one publish', async () => {
    const store = fakeStore()
    const service = makeService(store)
    await connectTarget(service, 'alpha')
    await waitFor(() => published.length >= 1)
    await settle(50)
    published = []
    for (let index = 0; index < 5; index += 1) service.publishClientTargets()
    await settle()
    expect(published).toHaveLength(1)
  })

  it('coalesces a change that arrives while a publish is in flight', async () => {
    const store = fakeStore()
    const service = makeService(store)
    await connectTarget(service, 'alpha')
    await waitFor(() => published.length >= 1)
    await settle(50)
    published = []

    const hold = deferred()
    holdClientTargets = hold
    service.publishClientTargets()
    await waitFor(() => published.length === 1)
    // The first request is held open; a second trigger must not overlap it.
    service.publishClientTargets()
    await settle(250)
    expect(published).toHaveLength(1)
    hold.release()
    // The dirty flag earned exactly one follow-up request.
    await waitFor(() => published.length === 2)
    expect(published).toHaveLength(2)
  })

  it('re-publishes while a connection is live so a restarted server re-learns the list', { timeout: 15_000 }, async () => {
    const store = fakeStore()
    const service = makeService(store)
    await connectTarget(service, 'alpha')
    await waitFor(() => published.length >= 1)
    await settle(50)
    published = []
    const startedAt = Date.now()
    await waitFor(() => published.length >= 1, 8_000)
    const gap = Date.now() - startedAt
    expect(gap).toBeGreaterThanOrEqual(4_500)
    expect(gap).toBeLessThan(6_500)
  })

  it('never publishes after dispose', async () => {
    const store = fakeStore()
    const service = makeService(store)
    await connectTarget(service, 'alpha')
    await waitFor(() => published.length >= 1)
    await settle(50)
    published = []
    await service.dispose()
    service.publishClientTargets()
    await settle()
    expect(published).toHaveLength(0)
  })
})
