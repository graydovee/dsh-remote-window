/**
 * Host route contract for the client-local model settings.
 *
 * These are the only shapes the browser sees: settings plus `hasApiKey`, never
 * the key itself. A probe without a body key must reuse the saved credential
 * (the dialog clears the typed key after saving), while an explicit body key
 * wins so the user can test before saving.
 */
import { createServer } from 'node:http'
import type { AddressInfo, Server } from 'node:net'
import { describe, expect, it } from 'vitest'
import { dispatchLocalLlmApi, parseModelSource } from '../src/local-llm/routes.ts'
import type { NativeLlmRuntime } from '../src/local-llm/native.ts'
import { LocalLlmError } from '../src/local-llm/settings.ts'
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

/** A fake endpoint recording the Authorization header of each `/v1/models` call. */
async function endpoint(): Promise<{ baseUrl: string; authorizations: (string | undefined)[]; close(): Promise<void> }> {
  const authorizations: (string | undefined)[] = []
  const server: Server = createServer((request, response) => {
    authorizations.push(request.headers.authorization)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ data: [{ id: 'qwen3' }] }))
  })
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    authorizations,
    close: async () => {
      await new Promise<void>(resolve => {
        server.close(() => resolve())
      })
    },
  }
}

describe('parseModelSource', () => {
  it('accepts local|server and rejects anything else', () => {
    expect(parseModelSource({ modelSource: 'local' })).toBe('local')
    expect(parseModelSource({ modelSource: 'server' })).toBe('server')
    expect(parseModelSource({ modelSource: undefined })).toBeUndefined()
    expect(parseModelSource({})).toBeUndefined()
    for (const value of ['LOCAL', 'client', 1, {}]) {
      expect(() => parseModelSource({ modelSource: value })).toThrowError(LocalLlmError)
      try {
        parseModelSource({ modelSource: value })
      } catch (error) {
        expect(error).toMatchObject({ code: 'local-llm-bad-settings', status: 400 })
      }
    }
  })
})

describe('dispatchLocalLlmApi', () => {
  it('reads defaults, saves and clears without ever exposing the key', async () => {
    const { store } = fakeStore()
    expect(await dispatchLocalLlmApi(store, 'local-llm/read', {})).toMatchObject({
      mode: 'auto',
      baseUrl: '',
      models: [],
      timeoutMs: 120_000,
      hasApiKey: false,
    })
    const saved = await dispatchLocalLlmApi(store, 'local-llm/save', {
      mode: 'manual',
      baseUrl: 'http://127.0.0.1:11434/v1/',
      models: ['qwen3'],
      timeoutMs: 30_000,
      apiKey: 'sk-route-secret',
    })
    expect(saved).toMatchObject({ mode: 'manual', baseUrl: 'http://127.0.0.1:11434', models: ['qwen3'], timeoutMs: 30_000, hasApiKey: true })
    expect(JSON.stringify(saved)).not.toContain('sk-route-secret')
    const read = await dispatchLocalLlmApi(store, 'local-llm/read', {})
    expect(read).toMatchObject(saved as Record<string, unknown>)
    const cleared = await dispatchLocalLlmApi(store, 'local-llm/clear-key', {})
    expect(cleared).toMatchObject({ hasApiKey: false })
    expect((await dispatchLocalLlmApi(store, 'local-llm/read', {}))).toMatchObject({ hasApiKey: false })
  })

  it('reports the effective model source when targetId is provided', async () => {
    const { store, raw } = fakeStore()
    raw.records.set('rt-local', { id: 'rt-local', modelSource: 'local', executor: 'server' } as RemoteTargetRecord)
    raw.records.set('rt-server', { id: 'rt-server', executor: 'server' } as RemoteTargetRecord)
    raw.records.set('rt-default', { id: 'rt-default' } as RemoteTargetRecord)
    expect(await dispatchLocalLlmApi(store, 'local-llm/read', { targetId: 'rt-local' })).toMatchObject({ modelSource: 'local' })
    expect(await dispatchLocalLlmApi(store, 'local-llm/read', { targetId: 'rt-server' })).toMatchObject({ modelSource: 'server' })
    expect(await dispatchLocalLlmApi(store, 'local-llm/read', { targetId: 'rt-default' })).toMatchObject({ modelSource: 'local' })
    expect(await dispatchLocalLlmApi(store, 'local-llm/read', {})).not.toHaveProperty('modelSource')
  })

  it('validates save bodies and returns undefined for unknown methods', async () => {
    const { store } = fakeStore()
    await expect(dispatchLocalLlmApi(store, 'local-llm/save', {})).rejects.toMatchObject({ code: 'local-llm-bad-settings', status: 400 })
    await expect(dispatchLocalLlmApi(store, 'local-llm/save', { baseUrl: 'http://127.0.0.1:1', models: 'qwen3' })).rejects.toMatchObject({ code: 'local-llm-bad-settings' })
    await expect(dispatchLocalLlmApi(store, 'local-llm/save', { baseUrl: 'http://127.0.0.1:1', timeoutMs: 'fast' })).rejects.toMatchObject({ code: 'local-llm-bad-settings' })
    await expect(dispatchLocalLlmApi(store, 'local-llm/save', { baseUrl: 'http://127.0.0.1:1', apiKey: 42 })).rejects.toMatchObject({ code: 'local-llm-bad-settings' })
    expect(await dispatchLocalLlmApi(store, 'local-llm/unknown', {})).toBeUndefined()
    expect(await dispatchLocalLlmApi(store, 'v1/connect', {})).toBeUndefined()
  })

  it('probes with an explicit body key, falling back to the stored key when omitted', async () => {
    const fake = await endpoint()
    const { store, raw } = fakeStore()
    try {
      // Explicit key wins even when a different key is stored.
      raw.key = 'sk-stored'
      expect(await dispatchLocalLlmApi(store, 'local-llm/probe', { baseUrl: fake.baseUrl, apiKey: 'sk-typed' })).toEqual({ models: ['qwen3'] })
      expect(fake.authorizations.at(-1)).toBe('Bearer sk-typed')

      // No body key: use the saved credential (dialog clears the typed key after save).
      expect(await dispatchLocalLlmApi(store, 'local-llm/probe', { baseUrl: fake.baseUrl })).toEqual({ models: ['qwen3'] })
      expect(fake.authorizations.at(-1)).toBe('Bearer sk-stored')

      // No stored key: probe without Authorization.
      await raw.forgetLocalLlmKey()
      expect(await dispatchLocalLlmApi(store, 'local-llm/probe', { baseUrl: fake.baseUrl })).toEqual({ models: ['qwen3'] })
      expect(fake.authorizations.at(-1)).toBeUndefined()
    } finally {
      await fake.close()
    }
  })

  it('discovers the client host providers for the automatic source', async () => {
    const { store } = fakeStore()
    const runtime = {
      async listProviders() {
        return [{ id: 'openai', name: 'OpenAI' }, { id: 'ollama', name: 'Ollama' }]
      },
      async listModels(provider: string) {
        return provider === 'openai'
          ? [{ provider: 'openai', id: 'gpt-5', name: 'GPT-5' }]
          : [{ provider: 'ollama', id: 'llama3', name: 'llama3' }]
      },
      async *stream() {
        yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
      },
    } satisfies NativeLlmRuntime
    expect(await dispatchLocalLlmApi(store, 'local-llm/discover', {}, () => runtime)).toEqual({
      providers: [
        { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-5', name: 'GPT-5' }] },
        { id: 'ollama', name: 'Ollama', models: [{ id: 'llama3', name: 'llama3' }] },
      ],
    })
    // A host without the model runtime is a coded 502, not a crash.
    await expect(dispatchLocalLlmApi(store, 'local-llm/discover', {}, () => undefined)).rejects.toMatchObject({
      code: 'local-llm-unavailable',
      status: 502,
    })
    const broken = { ...runtime, listProviders: async () => { throw new Error('no runtime') } }
    await expect(dispatchLocalLlmApi(store, 'local-llm/discover', {}, () => broken)).rejects.toMatchObject({
      code: 'local-llm-providers-unavailable',
      status: 502,
    })
  })

  it('keeps probe failures coded and scrubbed', async () => {
    const fake = await endpoint()
    const { store, raw } = fakeStore()
    try {
      raw.key = 'sk-hidden'
      await expect(dispatchLocalLlmApi(store, 'local-llm/probe', { baseUrl: `${fake.baseUrl}/?x=1` })).rejects.toMatchObject({
        code: 'local-llm-bad-settings',
        status: 400,
      })
      try {
        await dispatchLocalLlmApi(store, 'local-llm/probe', { baseUrl: `${fake.baseUrl}/?x=1` })
      } catch (error) {
        expect((error as Error).message).not.toContain('sk-hidden')
      }
    } finally {
      await fake.close()
    }
  })
})
