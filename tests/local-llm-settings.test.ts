/**
 * Client-local model settings, credential isolation and the readiness probe.
 *
 * The key only ever lives in the credential seam (`localLlmKey`), never in the
 * storage domain or the browser-facing read shape.
 */
import { createServer } from 'node:http'
import type { AddressInfo, Server } from 'node:net'
import { describe, expect, it } from 'vitest'
import {
  LOCAL_LLM_DEFAULT_TIMEOUT_MS,
  LocalLlmError,
  clearLocalLlmKey,
  localModelsUrl,
  localUpstreamUrl,
  modelsFromCatalog,
  normalizeLocalBaseUrl,
  parseLocalLlmSelection,
  planLocalLlm,
  probeLocalModels,
  readLocalLlmState,
  saveLocalLlmState,
} from '../src/local-llm/settings.ts'
import type { NativeLlmRuntime } from '../src/local-llm/native.ts'
import {
  packagePolicySettingsSchema,
  type LocalLlmSettings,
  type PackagePolicySettings,
  type RemoteTargetRecord,
} from '../src/targets/types.ts'
import type { TargetStore } from '../src/targets/store.ts'

/** The subset of `TargetStore` the settings layer touches, with schema-faithful writes. */
class FakeStore {
  global: PackagePolicySettings = { policy: 'auto', mirror: '' }
  key: string | undefined
  readonly records = new Map<string, RemoteTargetRecord>()

  globalSettings(): PackagePolicySettings {
    return this.global
  }

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
    if (key === '') {
      await this.forgetLocalLlmKey()
      return
    }
    this.key = key
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

/** Serve one fake OpenAI-compatible `/v1/models` endpoint on loopback. */
async function endpoint(handler: (authorization: string | undefined) => { status: number; body: string; contentType?: string }): Promise<{ baseUrl: string; close(): Promise<void>; calls: string[] }> {
  const calls: string[] = []
  const server: Server = createServer((request, response) => {
    calls.push(`${request.method ?? ''} ${request.url ?? ''}`)
    const answer = handler(request.headers.authorization)
    response.writeHead(answer.status, { 'content-type': answer.contentType ?? 'application/json' })
    response.end(answer.body)
  })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const port = (server.address() as AddressInfo).port
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    calls,
    close: async () => { await new Promise<void>(resolve => { server.close(() => resolve()) }) },
  }
}

describe('normalizeLocalBaseUrl', () => {
  it('strips a trailing /v1 and slashes so request paths are appended once', () => {
    expect(normalizeLocalBaseUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080')
    expect(normalizeLocalBaseUrl('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080')
    expect(normalizeLocalBaseUrl('http://127.0.0.1:8080/v1')).toBe('http://127.0.0.1:8080')
    expect(normalizeLocalBaseUrl('http://127.0.0.1:8080/v1/')).toBe('http://127.0.0.1:8080')
    expect(normalizeLocalBaseUrl(' https://models.internal/openai/v1 ')).toBe('https://models.internal/openai')
    expect(localModelsUrl('http://127.0.0.1:8080/v1')).toBe('http://127.0.0.1:8080/v1/models')
    expect(localUpstreamUrl('http://127.0.0.1:8080/v1/', '/v1/chat/completions?x=1')).toBe('http://127.0.0.1:8080/v1/chat/completions?x=1')
    expect(localUpstreamUrl('http://127.0.0.1:8080/openai', 'v1/models')).toBe('http://127.0.0.1:8080/openai/v1/models')
  })

  it('rejects non-http, credentialed, query and fragment URLs with a coded error', () => {
    for (const baseUrl of ['ftp://127.0.0.1', 'http://user:secret@127.0.0.1:8080', 'http://127.0.0.1:8080/?token=secret', 'http://127.0.0.1:8080/#frag', 'not a url']) {
      expect(() => normalizeLocalBaseUrl(baseUrl)).toThrowError(LocalLlmError)
      try {
        normalizeLocalBaseUrl(baseUrl)
      } catch (error) {
        expect(error).toMatchObject({ code: 'local-llm-bad-settings', status: 400 })
      }
    }
  })
})

describe('modelsFromCatalog', () => {
  it('accepts the OpenAI data shape, a bare array and strings, de-duplicated', () => {
    expect(modelsFromCatalog({ data: [{ id: 'qwen3' }, { id: 'qwen3' }, { id: 'llama3' }] })).toEqual(['qwen3', 'llama3'])
    expect(modelsFromCatalog([{ id: 'a' }, 'b', { nope: 1 }, null])).toEqual(['a', 'b'])
    expect(modelsFromCatalog({ data: [] })).toEqual([])
    expect(modelsFromCatalog({ models: ['x'] })).toEqual([])
    expect(modelsFromCatalog(null)).toEqual([])
  })
})

describe('settings read/save', () => {
  it('defaults to the automatic source, no endpoint and no key, without leaking a secret', async () => {
    const { store } = fakeStore()
    expect(await readLocalLlmState(store)).toMatchObject({
      mode: 'auto',
      baseUrl: '',
      models: [],
      timeoutMs: LOCAL_LLM_DEFAULT_TIMEOUT_MS,
      hasApiKey: false,
    })
    // No runtime is injected here, so the read reports the failed discovery
    // beside the mode instead of failing the whole read.
    expect((await readLocalLlmState(store)).catalogError).toContain('does not expose its model runtime')
  })

  it('normalizes, persists and reads back settings plus hasApiKey only', async () => {
    const { store, raw } = fakeStore()
    const saved = await saveLocalLlmState(store, {
      baseUrl: 'http://127.0.0.1:11434/v1/',
      models: ['qwen3', 'qwen3', ' llama3 '],
      timeoutMs: 30_000,
      apiKey: 'sk-client-secret',
    })
    expect(saved).toEqual({ mode: 'manual', baseUrl: 'http://127.0.0.1:11434', models: ['qwen3', 'llama3'], timeoutMs: 30_000, hasApiKey: true })
    expect(raw.key).toBe('sk-client-secret')
    const read = await readLocalLlmState(store)
    expect(read).toEqual({ mode: 'manual', baseUrl: 'http://127.0.0.1:11434', models: ['qwen3', 'llama3'], timeoutMs: 30_000, hasApiKey: true })
    expect(JSON.stringify(read)).not.toContain('sk-client-secret')
    // The domain copy may carry only the credential *reference*, never the key.
    expect(JSON.stringify(raw.global)).not.toContain('sk-client-secret')
    expect(raw.global.localLlm?.apiKeyRef).toContain('client-local-llm')
  })

  it('keeps the stored key when a save omits apiKey and clears it on an empty save', async () => {
    const { store, raw } = fakeStore()
    await saveLocalLlmState(store, { baseUrl: 'http://127.0.0.1:8000', apiKey: 'k' })
    const kept = await saveLocalLlmState(store, { baseUrl: 'http://127.0.0.1:8001' })
    expect(kept.hasApiKey).toBe(true)
    expect(raw.key).toBe('k')
    const cleared = await saveLocalLlmState(store, { baseUrl: 'http://127.0.0.1:8001', apiKey: '' })
    expect(cleared.hasApiKey).toBe(false)
    expect(raw.key).toBeUndefined()
    const explicit = await clearLocalLlmKey(store)
    expect(explicit.hasApiKey).toBe(false)
    expect(raw.global.localLlm?.apiKeyRef).toBeUndefined()
  })

  it('rejects a bad timeout, bad models and an invalid URL as coded 400s', async () => {
    const { store } = fakeStore()
    await expect(saveLocalLlmState(store, { baseUrl: 'http://127.0.0.1:8000', timeoutMs: 10 })).rejects.toMatchObject({ code: 'local-llm-bad-settings', status: 400 })
    await expect(saveLocalLlmState(store, { baseUrl: 'http://127.0.0.1:8000', timeoutMs: 10.5 })).rejects.toMatchObject({ code: 'local-llm-bad-settings' })
    await expect(saveLocalLlmState(store, { baseUrl: 'http://127.0.0.1:8000', models: ['ok', 42 as unknown as string] })).rejects.toMatchObject({ code: 'local-llm-bad-settings' })
    await expect(saveLocalLlmState(store, { baseUrl: 'http://127.0.0.1:8000?x=1' })).rejects.toMatchObject({ code: 'local-llm-bad-settings' })
  })

  it('includes the effective model source when a target is named', async () => {
    const { store, raw } = fakeStore()
    raw.records.set('rt-a', { id: 'rt-a', modelSource: 'local', executor: 'server' } as RemoteTargetRecord)
    raw.records.set('rt-b', { id: 'rt-b', executor: 'server' } as RemoteTargetRecord)
    expect((await readLocalLlmState(store, 'rt-a')).modelSource).toBe('local')
    expect((await readLocalLlmState(store, 'rt-b')).modelSource).toBe('server')
    expect((await readLocalLlmState(store, 'rt-missing')).modelSource).toBeUndefined()
  })
})

describe('probeLocalModels', () => {
  it('returns the catalog from a loopback endpoint and sends the key', async () => {
    const seen: (string | undefined)[] = []
    const fake = await endpoint(authorization => {
      seen.push(authorization)
      return { status: 200, body: JSON.stringify({ data: [{ id: 'qwen3' }, { id: 'llama3' }] }) }
    })
    try {
      expect(await probeLocalModels({ baseUrl: fake.baseUrl, apiKey: 'sk-probe' })).toEqual(['qwen3', 'llama3'])
      expect(seen).toEqual(['Bearer sk-probe'])
      expect(fake.calls).toEqual(['GET /v1/models'])
    } finally {
      await fake.close()
    }
  })

  it('maps 401/403 to unauthorized 502', async () => {
    for (const status of [401, 403]) {
      const fake = await endpoint(() => ({ status, body: '{"error":"nope"}' }))
      try {
        await expect(probeLocalModels({ baseUrl: fake.baseUrl })).rejects.toMatchObject({ code: 'local-llm-unauthorized', status: 502 })
      } finally {
        await fake.close()
      }
    }
  })

  it('maps a non-JSON or empty catalog to no-models and a transport failure to unreachable', async () => {
    const html = await endpoint(() => ({ status: 200, body: '<html>not json</html>', contentType: 'text/html' }))
    try {
      await expect(probeLocalModels({ baseUrl: html.baseUrl })).rejects.toMatchObject({ code: 'local-llm-no-models', status: 400 })
    } finally {
      await html.close()
    }
    const empty = await endpoint(() => ({ status: 200, body: JSON.stringify({ data: [] }) }))
    try {
      await expect(probeLocalModels({ baseUrl: empty.baseUrl })).rejects.toMatchObject({ code: 'local-llm-no-models' })
    } finally {
      await empty.close()
    }
    const closed = await endpoint(() => ({ status: 200, body: '{}' }))
    const closedUrl = closed.baseUrl
    await closed.close()
    await expect(probeLocalModels({ baseUrl: closedUrl, timeoutMs: 2_000 })).rejects.toMatchObject({ code: 'local-llm-unreachable', status: 502 })
  })
})

describe('planLocalLlm', () => {
  it('needs the model runtime when nothing is configured (automatic source)', async () => {
    const { store } = fakeStore()
    await expect(planLocalLlm(store)).rejects.toMatchObject({ code: 'local-llm-unavailable', status: 502 })
  })

  it('is a coded unconfigured failure when the manual source has no endpoint', async () => {
    const { store, raw } = fakeStore()
    raw.global = packagePolicySettingsSchema.parse({ policy: 'auto', mirror: '', localLlm: { mode: 'manual', baseUrl: '', models: [], timeoutMs: LOCAL_LLM_DEFAULT_TIMEOUT_MS } })
    await expect(planLocalLlm(store)).rejects.toMatchObject({ code: 'local-llm-unconfigured', status: 400 })
  })

  it('uses stored models without probing and carries the key for the bridge', async () => {
    const { store } = fakeStore()
    await saveLocalLlmState(store, { baseUrl: 'http://127.0.0.1:9999/v1', models: ['qwen3'], apiKey: 'sk-plan' })
    const plan = await planLocalLlm(store)
    expect(plan.models).toEqual(['qwen3'])
    expect(plan.apiKey).toBe('sk-plan')
    expect(plan.settings?.baseUrl).toBe('http://127.0.0.1:9999')
  })

  it('probes when no models are stored and persists what it discovered', async () => {
    let probes = 0
    const fake = await endpoint(() => {
      probes += 1
      return { status: 200, body: JSON.stringify({ data: [{ id: 'local-model' }] }) }
    })
    const { store, raw } = fakeStore()
    try {
      await saveLocalLlmState(store, { baseUrl: fake.baseUrl })
      const plan = await planLocalLlm(store)
      expect(plan.models).toEqual(['local-model'])
      expect(probes).toBe(1)
      expect(raw.global.localLlm?.models).toEqual(['local-model'])
      // The discovered list is reused; a second plan does not probe again.
      const second = await planLocalLlm(store)
      expect(second.models).toEqual(['local-model'])
      expect(probes).toBe(1)
    } finally {
      await fake.close()
    }
  })

  it('propagates the probe failure codes instead of falling back', async () => {
    const fake = await endpoint(() => ({ status: 401, body: '{}' }))
    const { store } = fakeStore()
    try {
      await saveLocalLlmState(store, { baseUrl: fake.baseUrl })
      await expect(planLocalLlm(store)).rejects.toMatchObject({ code: 'local-llm-unauthorized' })
    } finally {
      await fake.close()
    }
  })
})

/* ------------------------------------------------------- automatic selection */

/** A client host whose own DSH serves two providers (the auto source). */
function catalogRuntime(): NativeLlmRuntime {
  return {
    async listProviders() {
      return [{ id: 'openai', name: 'OpenAI' }, { id: 'ollama', name: 'Ollama' }]
    },
    async listModels(provider: string) {
      return provider === 'openai'
        ? [
            { provider: 'openai', id: 'gpt-5', name: 'GPT-5' },
            { provider: 'openai', id: 'gpt-5-mini', name: 'GPT-5 mini' },
          ]
        : [
            { provider: 'ollama', id: 'llama3', name: 'llama3' },
            { provider: 'ollama', id: 'qwen3', name: 'qwen3' },
          ]
    },
    async *stream() {
      yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
    },
  }
}

describe('automatic source selection', () => {
  it('persists a trimmed, de-duplicated selection and reads it back beside the full catalog', async () => {
    const { store, raw } = fakeStore()
    const saved = await saveLocalLlmState(store, {
      mode: 'auto',
      selection: [
        { providerId: ' openai ', models: ['gpt-5', 'gpt-5', ' gpt-5-mini '] },
        { providerId: 'openai', models: ['gpt-5'] },
        { providerId: 'ollama', models: [] },
      ],
    }, catalogRuntime())
    const normalized = [
      { providerId: 'openai', models: ['gpt-5', 'gpt-5-mini'] },
      { providerId: 'ollama', models: [] },
    ]
    expect(saved).toMatchObject({ mode: 'auto', baseUrl: '', models: [], selection: normalized })
    expect(raw.global.localLlm?.localSelection).toEqual(normalized)
    // The read shape carries the *unfiltered* catalog: the dialog needs every
    // model to render checkboxes; the plan is what applies the selection.
    expect(saved.catalog?.providers.map(provider => provider.id)).toEqual(['openai', 'ollama'])
    expect(saved.catalog?.providers.flatMap(provider => provider.models.map(model => model.id))).toEqual([
      'gpt-5',
      'gpt-5-mini',
      'llama3',
      'qwen3',
    ])
    expect(saved.selection).toEqual(normalized)
    expect((await readLocalLlmState(store)).selection).toEqual(normalized)
  })

  it('drops the selection when saving the manual source', async () => {
    const { store, raw } = fakeStore()
    await saveLocalLlmState(store, { mode: 'auto', selection: [{ providerId: 'openai', models: ['gpt-5'] }] }, catalogRuntime())
    const manual = await saveLocalLlmState(store, {
      mode: 'manual',
      baseUrl: 'http://127.0.0.1:11434',
      selection: [{ providerId: 'openai', models: ['gpt-5'] }],
    })
    expect(manual).not.toHaveProperty('selection')
    expect(raw.global.localLlm?.localSelection).toBeUndefined()
    expect(raw.global.localLlm?.mode).toBe('manual')
    expect(await readLocalLlmState(store)).not.toHaveProperty('selection')
  })

  it('clears a stored selection when an auto save omits it (back-compat keep-all)', async () => {
    const { store, raw } = fakeStore()
    await saveLocalLlmState(store, { mode: 'auto', selection: [{ providerId: 'openai', models: ['gpt-5'] }] }, catalogRuntime())
    expect(raw.global.localLlm?.localSelection).toBeDefined()
    const cleared = await saveLocalLlmState(store, { mode: 'auto' }, catalogRuntime())
    expect(cleared).not.toHaveProperty('selection')
    expect(raw.global.localLlm?.localSelection).toBeUndefined()
    const plan = await planLocalLlm(store, { llm: catalogRuntime() })
    expect(plan.models).toEqual(['openai/gpt-5', 'openai/gpt-5-mini', 'ollama/llama3', 'ollama/qwen3'])
  })

  it('filters the plan to the selected providers and models, in catalog order', async () => {
    const { store } = fakeStore()
    await saveLocalLlmState(store, {
      mode: 'auto',
      selection: [
        { providerId: 'ollama', models: ['qwen3'] },
        { providerId: 'openai', models: ['gpt-5-mini'] },
      ],
    }, catalogRuntime())
    const plan = await planLocalLlm(store, { llm: catalogRuntime() })
    expect(plan.mode).toBe('auto')
    expect(plan.catalog?.providers).toEqual([
      { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-5-mini', name: 'GPT-5 mini' }] },
      { id: 'ollama', name: 'Ollama', models: [{ id: 'qwen3', name: 'qwen3' }] },
    ])
    expect(plan.models).toEqual(['openai/gpt-5-mini', 'ollama/qwen3'])
  })

  it('drops unknown providers and unknown models from the filtered plan', async () => {
    const { store } = fakeStore()
    await saveLocalLlmState(store, {
      mode: 'auto',
      selection: [
        { providerId: 'missing', models: ['whatever'] },
        { providerId: 'openai', models: ['gpt-5', 'gone-model'] },
        { providerId: 'ollama', models: [] },
      ],
    }, catalogRuntime())
    const plan = await planLocalLlm(store, { llm: catalogRuntime() })
    expect(plan.catalog?.providers).toEqual([
      { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-5', name: 'GPT-5' }] },
    ])
    expect(plan.models).toEqual(['openai/gpt-5'])
  })

  it('fails with local-llm-no-models when the selection matches nothing', async () => {
    const { store } = fakeStore()
    await saveLocalLlmState(store, { mode: 'auto', selection: [{ providerId: 'missing', models: ['x'] }] }, catalogRuntime())
    await expect(planLocalLlm(store, { llm: catalogRuntime() })).rejects.toMatchObject({
      code: 'local-llm-no-models',
      status: 400,
    })
    // An explicit empty selection is the same "nothing to proxy" state.
    await saveLocalLlmState(store, { mode: 'auto', selection: [] }, catalogRuntime())
    await expect(planLocalLlm(store, { llm: catalogRuntime() })).rejects.toMatchObject({ code: 'local-llm-no-models' })
    try {
      await planLocalLlm(store, { llm: catalogRuntime() })
    } catch (error) {
      expect((error as Error).message).toContain('selection')
    }
  })

  it('rejects malformed selections as coded 400s before writing anything', async () => {
    const { store, raw } = fakeStore()
    const malformed: unknown[] = [
      'openai/gpt-5',
      [null],
      [{ providerId: '', models: [] }],
      [{ providerId: '   ', models: [] }],
      [{ providerId: 'openai' }],
      [{ providerId: 'openai', models: 'gpt-5' }],
      [{ providerId: 'openai', models: [''] }],
      [{ providerId: 'openai', models: [42] }],
      [{ providerId: 'openai', models: [], extra: true }],
    ]
    for (const selection of malformed) {
      await expect(
        saveLocalLlmState(store, { mode: 'auto', selection: selection as never }, catalogRuntime()),
      ).rejects.toMatchObject({ code: 'local-llm-bad-settings', status: 400 })
    }
    expect(raw.global.localLlm).toBeUndefined()
    expect(parseLocalLlmSelection(undefined)).toBeUndefined()
    expect(parseLocalLlmSelection([])).toEqual([])
  })
})
