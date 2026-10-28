/**
 * `LocalLlmService` owns the bridge + reverse-tunnel pair per target:
 * prepare brings both up (or neither), teardown is idempotent, and a server
 * model source never opens a listener.
 */
import { createServer } from 'node:http'
import type { AddressInfo, Server } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalLlmService } from '../src/local-llm/service.ts'
import type { LocalLlmPlan } from '../src/local-llm/settings.ts'
import type { RemoteForward, RemoteForwardCapable } from '../src/local-llm/tunnel.ts'
import {
  packagePolicySettingsSchema,
  type LocalLlmSettings,
  type PackagePolicySettings,
  type RemoteTargetRecord,
} from '../src/targets/types.ts'
import type { TargetStore } from '../src/targets/store.ts'

class FakeStore {
  global: PackagePolicySettings = { policy: 'auto', mirror: '' }
  key: string | undefined
  readonly records = new Map<string, RemoteTargetRecord>()

  localLlmSettings(): LocalLlmSettings | undefined {
    return this.global.localLlm
  }

  async setLocalLlmSettings(settings: LocalLlmSettings | undefined): Promise<void> {
    const { localLlm: _previous, ...rest } = this.global
    this.global = packagePolicySettingsSchema.parse(settings === undefined ? rest : { ...rest, localLlm: settings })
  }

  async localLlmKey(): Promise<string | undefined> {
    return this.key
  }

  async storeLocalLlmKey(key: string): Promise<void> {
    this.key = key === '' ? undefined : key
  }

  async forgetLocalLlmKey(): Promise<void> {
    this.key = undefined
  }

  target(targetId: string): RemoteTargetRecord | undefined {
    return this.records.get(targetId)
  }
}

function fakeStore(): { store: TargetStore; raw: FakeStore } {
  const raw = new FakeStore()
  return { store: raw as unknown as TargetStore, raw }
}

/** A connected-looking SSH seam that records reverse-forward calls. */
function fakeConnection(options: { port?: number; fail?: Error } = {}): {
  connection: RemoteForwardCapable
  readonly closes: number
  readonly targets: number[]
} {
  const state = { closes: 0, targets: [] as number[] }
  const connection: RemoteForwardCapable = {
    async remoteForward({ targetPort }) {
      state.targets.push(targetPort)
      if (options.fail !== undefined) throw options.fail
      return {
        port: options.port ?? 41_234,
        async close() {
          state.closes += 1
        },
      } satisfies RemoteForward
    },
  }
  return {
    connection,
    get closes(): number {
      return state.closes
    },
    targets: state.targets,
  }
}

async function endpoint(): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ data: [{ id: 'qwen3' }] }))
  })
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: async () => {
      await new Promise<void>(resolve => {
        server.close(() => resolve())
      })
    },
  }
}

const services: LocalLlmService[] = []
afterEach(async () => {
  await Promise.allSettled(services.splice(0).map(async service => await service.close()))
})

function serviceFor(store: TargetStore): LocalLlmService {
  const service = new LocalLlmService(store)
  services.push(service)
  return service
}

function planFor(baseUrl: string, models: readonly string[] = ['qwen3']): LocalLlmPlan {
  return {
    mode: 'manual',
    settings: { baseUrl, models: [...models], timeoutMs: 5_000 },
    models: [...models],
    apiKey: 'sk-bridge-secret',
  }
}

describe('LocalLlmService', () => {
  it('starts the bridge, opens the reverse tunnel and returns the remote port', async () => {
    const fake = await endpoint()
    try {
      const { store } = fakeStore()
      const service = serviceFor(store)
      const cli = fakeConnection({ port: 43_210 })
      const prepared = await service.prepare('rt-a', cli.connection, planFor(fake.baseUrl))
      expect(prepared).toBeDefined()
      expect(prepared?.remoteHost).toBe('127.0.0.1')
      expect(prepared?.remotePort).toBe(43_210)
      expect(prepared?.models).toEqual(['qwen3'])
      expect(prepared?.bridgePort).toBeGreaterThan(0)
      expect(cli.targets).toEqual([prepared?.bridgePort])
      expect(service.has('rt-a')).toBe(true)

      // The bridge really forwards to the endpoint through the same key path.
      const response = await fetch(`http://127.0.0.1:${prepared?.bridgePort}/v1/models`)
      expect(response.status).toBe(200)
    } finally {
      await fake.close()
    }
  })

  it('tears both pieces down idempotently and never leaks a listener', async () => {
    const fake = await endpoint()
    try {
      const { store } = fakeStore()
      const service = serviceFor(store)
      const cli = fakeConnection()
      const prepared = await service.prepare('rt-a', cli.connection, planFor(fake.baseUrl))
      const bridgeUrl = `http://127.0.0.1:${prepared?.bridgePort}`
      expect((await fetch(`${bridgeUrl}/v1/models`)).status).toBe(200)
      await service.teardown('rt-a')
      await service.teardown('rt-a')
      expect(cli.closes).toBe(1)
      expect(service.has('rt-a')).toBe(false)
      await expect(fetch(`${bridgeUrl}/v1/models`)).rejects.toThrow()
    } finally {
      await fake.close()
    }
  })

  it('is a no-op for a server model source and closes the bridge when the tunnel fails', async () => {
    const { store, raw } = fakeStore()
    const service = serviceFor(store)
    raw.records.set('rt-server', { id: 'rt-server', modelSource: 'server' } as RemoteTargetRecord)
    expect(await service.prepare('rt-server', fakeConnection().connection)).toBeUndefined()
    expect(service.has('rt-server')).toBe(false)

    // A saved local target without settings would throw unconfigured; with
    // settings, a refused reverse tunnel must not leave the bridge listening.
    raw.records.set('rt-local', { id: 'rt-local', modelSource: 'local' } as RemoteTargetRecord)
    raw.global = packagePolicySettingsSchema.parse({ ...raw.global, localLlm: { baseUrl: 'http://127.0.0.1:9', models: ['qwen3'], timeoutMs: 5_000 } })
    const refused = fakeConnection({ fail: Object.assign(new Error('refused'), { code: 'local-llm-forwarding-unavailable', status: 424 }) })
    await expect(service.prepare('rt-local', refused.connection)).rejects.toMatchObject({ code: 'local-llm-forwarding-unavailable' })
    expect(service.has('rt-local')).toBe(false)

    // A connection that cannot open reverse tunnels is a coded failure too.
    await expect(service.prepare('rt-local', {})).rejects.toMatchObject({ code: 'local-llm-forwarding-unavailable', status: 424 })
  })

  it('replaces an existing pair instead of stacking connections', async () => {
    const fake = await endpoint()
    try {
      const { store } = fakeStore()
      const service = serviceFor(store)
      const first = fakeConnection({ port: 40_001 })
      const second = fakeConnection({ port: 40_002 })
      const preparedA = await service.prepare('rt-a', first.connection, planFor(fake.baseUrl))
      const preparedB = await service.prepare('rt-a', second.connection, planFor(fake.baseUrl))
      expect(preparedA?.remotePort).toBe(40_001)
      expect(preparedB?.remotePort).toBe(40_002)
      expect(first.closes).toBe(1)
      expect(service.has('rt-a')).toBe(true)
    } finally {
      await fake.close()
    }
  })

  it('loads a persisted plan for a local target and propagates an unconfigured endpoint', async () => {
    const fake = await endpoint()
    try {
      const { store, raw } = fakeStore()
      const service = serviceFor(store)
      raw.records.set('rt-local', { id: 'rt-local', modelSource: 'local' } as RemoteTargetRecord)
      raw.global = packagePolicySettingsSchema.parse({ ...raw.global, localLlm: { baseUrl: fake.baseUrl, models: ['qwen3'], timeoutMs: 5_000 } })
      const prepared = await service.prepare('rt-local', fakeConnection({ port: 40_003 }).connection)
      expect(prepared?.remotePort).toBe(40_003)

      raw.global = packagePolicySettingsSchema.parse({ policy: 'auto', mirror: '' })
      raw.records.set('rt-empty', { id: 'rt-empty', modelSource: 'local' } as RemoteTargetRecord)
      await expect(service.prepare('rt-empty', fakeConnection().connection)).rejects.toMatchObject({ code: 'local-llm-unavailable' })
    } finally {
      await fake.close()
    }
  })

  it('does not open anything for an unknown target without an explicit plan', async () => {
    const { store } = fakeStore()
    const service = serviceFor(store)
    expect(await service.prepare('rt-missing', fakeConnection().connection)).toBeUndefined()
    expect(service.has('rt-missing')).toBe(false)
  })
})
