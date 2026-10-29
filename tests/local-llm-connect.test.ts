/**
 * End-to-end connect flow for the two model sources.
 *
 * `local` (the v3 default) must validate the endpoint, open the reverse tunnel,
 * write the `client-local` profile patch and export only the bridge placeholder
 * before the profile starts. `server` writes an empty patch. Every failure path
 * tears the bridge/tunnel down, and an unconfigured local source fails before
 * SSH/profile work starts.
 */
import { Agent, createServer } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import { connect } from 'node:net'
import type { AddressInfo } from 'node:net'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SshForwarder } from '../src/ssh/forward.ts'
import type { ProfileRemote, ProfileExecResult } from '../src/provision/profile-lifecycle.ts'
import { ProfileService, type ProfileConnection, type ProfileConnector } from '../src/provision/profile-service.ts'
import { buildLocalModelPatch, EMPTY_PROFILE_PATCH } from '../src/local-llm/profile.ts'
import type { TargetStore } from '../src/targets/store.ts'
import type { LocalLlmSettings, PackagePolicySettings, RemoteTargetRecord } from '../src/targets/types.ts'
import type { NativeLlmRuntime, NativeStreamChunk } from '../src/local-llm/native.ts'
import type { RemoteForward } from '../src/local-llm/tunnel.ts'
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

let profileServer: Server
let profilePort = 0
let modelServer: Server
let modelBaseUrl = ''
let tarball = ''
let store: TargetStore
let connectCalls = 0

beforeAll(async () => {
  profileServer = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
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
          capabilities: { workspaceApi: 1, eventsSse: 1, muxWs: 1, embed: { storagePrefix: 'dshrw:test:', mode: 'reload' } },
        } }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, value: {} }))
    })
  })
  await new Promise<void>(resolve => {
    profileServer.listen(0, '127.0.0.1', resolve)
  })
  profilePort = (profileServer.address() as AddressInfo).port

  modelServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'qwen3' }] }))
  })
  await new Promise<void>(resolve => {
    modelServer.listen(0, '127.0.0.1', resolve)
  })
  modelBaseUrl = `http://127.0.0.1:${(modelServer.address() as AddressInfo).port}`

  const root = await mkdtemp(join(tmpdir(), 'dsh-rw-local-connect-'))
  await writeFakeServerPluginPackage(root, { version: VERSION })
  tarball = await packPackage(root, `dsh-remote-workspace-server-${VERSION}.tgz`)
  process.env['DSH_RW_SERVER_PLUGIN_TARBALL'] = tarball
})

afterAll(async () => {
  delete process.env['DSH_RW_SERVER_PLUGIN_TARBALL']
  await new Promise<void>(resolve => {
    profileServer.close(() => resolve())
    setTimeout(resolve, 300)
  })
  await new Promise<void>(resolve => {
    modelServer.close(() => resolve())
  })
})

beforeEach(() => {
  connectCalls = 0
  store = fakeStore()
})

function fakeStore(localLlm?: LocalLlmSettings, key?: string): TargetStore {
  let clientId: string | undefined
  const records = new Map<string, RemoteTargetRecord>()
  let global: PackagePolicySettings = { policy: 'auto', mirror: '', ...(localLlm === undefined ? {} : { localLlm }) }
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
    },
    updateTarget: async (id: string, mutate: (current: RemoteTargetRecord) => RemoteTargetRecord) => {
      const current = records.get(id)
      if (current === undefined) throw new Error('missing')
      const next = mutate(current)
      records.set(id, next)
      return next
    },
    storeSecret: async (record: RemoteTargetRecord) => record,
    secretOf: async () => undefined,
    credentialKeyOf: () => undefined,
    globalSettings: () => global,
    localLlmSettings: () => global.localLlm,
    setLocalLlmSettings: async (settings: LocalLlmSettings | undefined) => {
      const { localLlm: _previous, ...rest } = global
      global = { ...rest, ...(settings === undefined ? {} : { localLlm: settings }) }
    },
    localLlmKey: async () => key,
    storeLocalLlmKey: async () => {},
    forgetLocalLlmKey: async () => {},
  }
  return target as unknown as TargetStore
}

class FakeRemote implements ProfileRemote {
  alive = false
  failStart = false
  log = `dsh web: http://127.0.0.1:${profilePort}/?token=fixture_token\n`
  readonly scripts: string[] = []
  readonly writes: { path: string; content: string }[] = []

  async exec(body: string): Promise<ProfileExecResult> {
    this.scripts.push(body)
    if (body.includes('@@RW@@SCAN@@1')) return { code: 0, stdout: SCAN, stderr: '' }
    if (body.includes('setsid nohup')) {
      if (this.failStart) return { code: 1, stdout: '', stderr: 'boom' }
      this.alive = true
      return { code: 0, stdout: '4321\n', stderr: '' }
    }
    if (body.includes('server.log')) return { code: 0, stdout: this.log, stderr: '' }
    if (body.includes('tar -xzf')) return { code: 0, stdout: 'installed\n', stderr: '' }
    if (body.includes('pidfile=')) {
      this.alive = false
      return { code: 0, stdout: 'stopped\n', stderr: '' }
    }
    if (body.includes('kill -0')) return { code: 0, stdout: this.alive ? '0' : '1', stderr: '' }
    if (body.includes('server.pid')) return { code: 0, stdout: '4321\n', stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }

  async writeFile(path: string, content: Buffer): Promise<void> {
    this.writes.push({ path, content: content.toString('utf8') })
  }
}

function fakeForwarder(): SshForwarder {
  return {
    open: async () => await new Promise((resolve, reject) => {
      const socket = connect(profilePort, '127.0.0.1', () => resolve(socket))
      socket.once('error', reject)
    }),
    httpAgent: () => new Agent({ keepAlive: false }),
    close: () => {},
  } as unknown as SshForwarder
}

function fakeConnector(options: { forwardError?: Error } = {}): {
  connector: ProfileConnector
  remote: FakeRemote
  forwardTargets: number[]
  forwardCloses: () => number
} {
  const remote = new FakeRemote()
  const forwardTargets: number[] = []
  let closes = 0
  const connection: ProfileConnection = {
    remote,
    forwarder: fakeForwarder(),
    fingerprint: 'SHA256:fixture',
    close: async () => {},
    remoteForward: async ({ targetPort }): Promise<RemoteForward> => {
      if (options.forwardError !== undefined) throw options.forwardError
      forwardTargets.push(targetPort)
      return {
        port: 41_000,
        close: async () => {
          closes += 1
        },
      }
    },
  }
  return {
    connector: {
      connect: async () => {
        connectCalls += 1
        return connection
      },
    },
    remote,
    forwardTargets,
    forwardCloses: () => closes,
  }
}

/** A client host whose own DSH serves two providers (the `auto` source). */
function autoRuntime(options: { text?: string } = {}): NativeLlmRuntime & { calls: number } {
  const state = { calls: 0 }
  const runtime: NativeLlmRuntime & { calls: number } = {
    calls: 0,
    async listProviders() {
      return [{ id: 'openai', name: 'OpenAI' }, { id: 'ollama', name: 'Ollama' }]
    },
    async listModels(provider: string) {
      return provider === 'openai'
        ? [{ provider: 'openai', id: 'gpt-5', name: 'GPT-5' }, { provider: 'openai', id: 'gpt-5-mini', name: 'GPT-5 mini' }]
        : [{ provider: 'ollama', id: 'llama3', name: 'llama3' }]
    },
    async *stream(): AsyncIterable<NativeStreamChunk> {
      state.calls += 1
      Object.defineProperty(runtime, 'calls', { value: state.calls, configurable: true })
      yield { type: 'text-delta', index: 0, text: options.text ?? 'hi from the client host' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  return runtime
}

/** A host context exposing only `llm` (everything else stays undefined). */
function autoContext(runtime: NativeLlmRuntime): Context {
  return { get: (name: string) => (name === 'llm' ? runtime : undefined) } as unknown as Context
}

function serviceWith(connector: ProfileConnector, ctx?: Context): ProfileService {
  return new ProfileService({
    store,
    packageRoot: '/tmp/client-package',
    pluginVersion: VERSION,
    connector,
    cacheDir: '/tmp/cache',
    ...(ctx === undefined ? {} : { ctx }),
  })
}

const request = {
  label: 'local-model',
  host: '203.0.113.10',
  port: 22,
  username: 'tester',
  authKind: 'password' as const,
  secret: 'hunter2',
  hostKeyFingerprint: 'SHA256:fixture',
}

const localSettings = (): LocalLlmSettings => ({ baseUrl: modelBaseUrl, models: ['qwen3'], timeoutMs: 5_000 })

describe('ProfileService local model source', () => {
  it('validates, writes the client-local patch and starts the profile with the bridge placeholder', async () => {
    store = fakeStore(localSettings(), 'sk-local-key')
    const fixture = fakeConnector()
    const service = serviceWith(fixture.connector)
    const result = await service.connect({ ...request, modelSource: 'local' })
    expect(result.target.modelSource).toBe('local')
    expect(connectCalls).toBe(1)
    expect(fixture.forwardTargets).toHaveLength(1)
    expect(fixture.forwardTargets[0]).toBeGreaterThan(0)

    const patchWrite = fixture.remote.writes.filter(write => write.path.endsWith('/cordis.patch.yml')).at(-1)
    expect(patchWrite?.content).toBe(buildLocalModelPatch({
      remotePort: 41_000,
      routes: [{ id: 'client-local', displayName: 'Local model', pathPrefix: '', models: [{ id: 'qwen3', name: 'qwen3' }] }],
    }))
    // The real key never reaches the server/profile: only the placeholder env.
    expect(patchWrite?.content).not.toContain('sk-local-key')
    expect(fixture.remote.scripts.some(script => script.includes(`DSH_RW_LOCAL_LLM_KEY='local-bridge'`))).toBe(true)

    expect(store.target(result.target.id)?.modelSource).toBe('local')
    const bridgeUrl = `http://127.0.0.1:${fixture.forwardTargets[0]}/v1/models`
    // The bridge lives for the whole connection.
    expect((await fetch(bridgeUrl)).status).toBe(200)

    expect(await service.stop(result.target.id)).toBe(true)
    expect(fixture.forwardCloses()).toBe(1)
    await expect(fetch(bridgeUrl)).rejects.toThrow()
  })

  it('proxies every client-host provider through one reverse tunnel in auto mode', async () => {
    store = fakeStore()
    const runtime = autoRuntime()
    const fixture = fakeConnector()
    const service = serviceWith(fixture.connector, autoContext(runtime))
    const result = await service.connect({ ...request, modelSource: 'local' })
    expect(result.target.modelSource).toBe('local')
    expect(fixture.forwardTargets).toHaveLength(1)
    const port = fixture.forwardTargets[0] as number

    const patchWrite = fixture.remote.writes.filter(write => write.path.endsWith('/cordis.patch.yml')).at(-1)
    const patch = patchWrite?.content ?? ''
    expect(patch).toContain('      "remote-openai":')
    expect(patch).toContain('        baseURL: "http://127.0.0.1:41000/openai/v1"')
    expect(patch).toContain('      "remote-ollama":')
    expect(patch).toContain('        baseURL: "http://127.0.0.1:41000/ollama/v1"')
    // The first route/model becomes the profile's default model.
    expect(patch).toContain('    provider: "remote-openai"')
    expect(patch).toContain('    model: "gpt-5"')

    const models = await (await fetch(`http://127.0.0.1:${port}/openai/v1/models`)).json() as { data: { id: string }[] }
    expect(models.data.map(entry => entry.id)).toEqual(['gpt-5', 'gpt-5-mini'])

    // A profile call over the tunnel reaches the client host's own ctx.llm.
    const reply = await fetch(`http://127.0.0.1:${port}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(reply.status).toBe(200)
    const body = await reply.json() as { choices: { message: { content: string } }[] }
    expect(body.choices[0]?.message.content).toBe('hi from the client host')
    expect(runtime.calls).toBe(1)

    await service.stop(result.target.id)
    await expect(fetch(`http://127.0.0.1:${port}/openai/v1/models`)).rejects.toThrow()
  })

  it('exposes only the saved selection of the automatic source to the profile and bridge', async () => {
    store = fakeStore({
      mode: 'auto',
      baseUrl: '',
      models: [],
      timeoutMs: 5_000,
      localSelection: [{ providerId: 'ollama', models: ['llama3'] }],
    })
    const runtime = autoRuntime()
    const fixture = fakeConnector()
    const service = serviceWith(fixture.connector, autoContext(runtime))
    const result = await service.connect({ ...request, modelSource: 'local' })
    expect(fixture.forwardTargets).toHaveLength(1)
    const port = fixture.forwardTargets[0] as number

    const patch = fixture.remote.writes.filter(write => write.path.endsWith('/cordis.patch.yml')).at(-1)?.content ?? ''
    // Only the selected provider becomes a route (and the profile default);
    // the unselected provider must not leak into the profile patch.
    expect(patch).toContain('      "remote-ollama":')
    expect(patch).not.toContain('remote-openai')
    expect(patch).toContain('    provider: "remote-ollama"')
    expect(patch).toContain('    model: "llama3"')

    // The bridge serves the filtered catalog only: unselected routes are 404.
    const models = await (await fetch(`http://127.0.0.1:${port}/ollama/v1/models`)).json() as { data: { id: string }[] }
    expect(models.data.map(entry => entry.id)).toEqual(['llama3'])
    expect((await fetch(`http://127.0.0.1:${port}/openai/v1/models`)).status).toBe(404)

    await service.stop(result.target.id)
  })

  it('writes an empty patch and opens no tunnel for the server source', async () => {
    store = fakeStore(localSettings(), 'sk-local-key')
    const fixture = fakeConnector()
    const service = serviceWith(fixture.connector)
    const result = await service.connect({ ...request, modelSource: 'server' })
    expect(result.target.modelSource).toBe('server')
    expect(fixture.forwardTargets).toHaveLength(0)
    const patchWrite = fixture.remote.writes.filter(write => write.path.endsWith('/cordis.patch.yml')).at(-1)
    expect(patchWrite?.content).toBe(EMPTY_PROFILE_PATCH)
    expect(fixture.remote.scripts.some(script => script.includes('DSH_RW_LOCAL_LLM_KEY'))).toBe(false)
    expect(store.target(result.target.id)?.modelSource).toBe('server')
    await service.stop(result.target.id)
    expect(fixture.forwardCloses()).toBe(0)
  })

  it('reconnects a pre-v3 server-executor record to server models when the request omits modelSource', async () => {
    // v2 records only carried `executor`; the v3 default (`local`) must not
    // hijack an explicit old server-executor choice on reconnect (see
    // `effectiveModelSource`). The record below has no `modelSource` field.
    const legacy: RemoteTargetRecord = {
      id: 'target-legacy',
      label: request.label,
      kind: 'ssh',
      host: request.host,
      port: request.port,
      username: request.username,
      authKind: 'password',
      hostKeyFingerprint: 'SHA256:fixture',
      executor: 'server',
      remote: {
        nodePath: '/usr/local/bin/node',
        dshCommand: '/usr/local/bin/dsh',
        profile: 'graydovee-remote-workspace-abcdef012345',
        dshHome: '/home/user/.dsh',
        plugins: [],
      },
      status: 'ready',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    await store.putTarget(legacy)
    const fixture = fakeConnector()
    const service = serviceWith(fixture.connector)
    const result = await service.connect({ ...request })
    expect(result.target.modelSource).toBe('server')
    expect(fixture.forwardTargets).toHaveLength(0)
    const patchWrite = fixture.remote.writes.filter(write => write.path.endsWith('/cordis.patch.yml')).at(-1)
    expect(patchWrite?.content).toBe(EMPTY_PROFILE_PATCH)
    await service.stop(result.target.id)
  })

  it('fails before SSH/profile work when the automatic local source has no model runtime', async () => {
    store = fakeStore()
    const fixture = fakeConnector()
    const service = serviceWith(fixture.connector)
    await expect(service.connect({ ...request, modelSource: 'local' })).rejects.toMatchObject({
      code: 'local-llm-unavailable',
      status: 502,
    })
    expect(connectCalls).toBe(0)
    expect(fixture.remote.scripts.some(script => script.includes('setsid nohup'))).toBe(false)
    expect(Object.values(service.connections())).toHaveLength(0)
  })

  it('tears the bridge + tunnel down when the profile fails to start', async () => {
    store = fakeStore(localSettings(), 'sk-local-key')
    const fixture = fakeConnector()
    fixture.remote.failStart = true
    const service = serviceWith(fixture.connector)
    await expect(service.connect({ ...request, modelSource: 'local' })).rejects.toMatchObject({ code: 'profile-start-failed' })
    expect(fixture.forwardCloses()).toBe(1)
    expect(fixture.forwardTargets).toHaveLength(1)
    await expect(fetch(`http://127.0.0.1:${fixture.forwardTargets[0]}/v1/models`)).rejects.toThrow()
  })

  it('closes the bridge when the SSH server refuses the reverse tunnel', async () => {
    store = fakeStore(localSettings(), 'sk-local-key')
    const refused = Object.assign(new Error('administratively prohibited'), { code: 'local-llm-forwarding-unavailable', status: 424 })
    const fixture = fakeConnector({ forwardError: refused })
    const service = serviceWith(fixture.connector)
    await expect(service.connect({ ...request, modelSource: 'local' })).rejects.toMatchObject({
      code: 'local-llm-forwarding-unavailable',
      status: 424,
    })
    expect(Object.values(service.connections())).toHaveLength(0)
  })
})
