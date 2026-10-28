/**
 * The automatic local-model source: provider catalog discovery and the
 * loopback OpenAI-compatible bridge that re-exposes the client host's own
 * model routes to a server profile.
 *
 * The profile's `llm-pi-ai` layer speaks OpenAI wire format over the reverse
 * tunnel; the bridge translates that back into `ctx.llm.stream()` calls and
 * must keep the two streaming protocols honest (text, reasoning, tool calls,
 * usage, finish reason) without ever leaking a provider key.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  discoverLocalCatalog,
  LocalCatalogError,
  startNativeLlmBridge,
  type NativeGenerateOptions,
  type NativeLlmBridge,
  type NativeLlmRuntime,
  type NativeModelInfo,
  type NativeProviderInfo,
  type NativeStreamChunk,
} from '../src/local-llm/native.ts'

/** A scripted client-host model runtime (one route per provider). */
class FakeRuntime implements NativeLlmRuntime {
  readonly calls: NativeGenerateOptions[] = []
  constructor(
    private readonly providers: readonly NativeProviderInfo[],
    private readonly models: Readonly<Record<string, readonly NativeModelInfo[]>> = {},
    private readonly script: (options: NativeGenerateOptions) => readonly NativeStreamChunk[] = () => [
      { type: 'text-delta', index: 0, text: 'hello ' },
      { type: 'text-delta', index: 0, text: 'world' },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  ) {}

  async listProviders(): Promise<readonly NativeProviderInfo[]> {
    return this.providers
  }

  async listModels(provider: string): Promise<readonly NativeModelInfo[]> {
    const models = this.models[provider]
    if (models === undefined) throw new Error(`unknown provider ${provider}`)
    return models
  }

  async *stream(options: NativeGenerateOptions): AsyncIterable<NativeStreamChunk> {
    this.calls.push(options)
    for (const chunk of this.script(options)) yield chunk
  }
}

const openAiRuntime = (): FakeRuntime => new FakeRuntime(
  [
    { id: 'openai', name: 'OpenAI' },
    { id: 'ollama', name: 'Ollama' },
  ],
  {
    openai: [
      { provider: 'openai', id: 'gpt-5', name: 'GPT-5', description: 'frontier' },
      { provider: 'openai', id: 'gpt-5-mini', name: 'GPT-5 mini' },
    ],
    ollama: [{ provider: 'ollama', id: 'llama3', name: 'llama3' }],
  },
)

const live: NativeLlmBridge[] = []
const servers: Server[] = []
afterEach(async () => {
  await Promise.allSettled(live.splice(0).map(async bridge => await bridge.close()))
  await Promise.allSettled(servers.splice(0).map(async server => await new Promise<void>(resolve => { server.close(() => resolve()) })))
})

async function bridgeFor(runtime: FakeRuntime): Promise<NativeLlmBridge> {
  const catalog = await discoverLocalCatalog(runtime)
  const bridge = await startNativeLlmBridge({ llm: runtime, catalog })
  live.push(bridge)
  return bridge
}

/** One fetch against the bridge, returning status/headers/body. */
async function request(
  url: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const response = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
  return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body: await response.text() }
}

/** Read one SSE stream into the parsed `data:` chunks (dropping `[DONE]`). */
function sseChunks(text: string): unknown[] {
  return text
    .split('\n\n')
    .map(part => part.trim())
    .filter(part => part !== '' && part !== 'data: [DONE]')
    .map(part => JSON.parse(part.slice('data: '.length)) as unknown)
}

describe('discoverLocalCatalog', () => {
  it('lists providers with their models and skips broken routes', async () => {
    const catalog = await discoverLocalCatalog(new FakeRuntime(
      [
        { id: 'openai', name: 'OpenAI' },
        { id: 'broken', name: 'Broken' },
        { id: '', name: 'Nameless' },
        { id: 'ollama', name: 'Ollama' },
      ],
      { openai: [{ provider: 'openai', id: 'gpt-5', name: 'GPT-5' }, { provider: 'openai', id: 'gpt-5', name: 'dupe' }], ollama: [] },
    ))
    expect(catalog.providers).toEqual([
      { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-5', name: 'GPT-5' }] },
    ])
  })

  it('is a coded failure when the runtime cannot list providers', async () => {
    const runtime = new FakeRuntime([])
    runtime.listProviders = async () => { throw new Error('no runtime') }
    await expect(discoverLocalCatalog(runtime)).rejects.toThrowError(LocalCatalogError)
    await expect(discoverLocalCatalog(runtime)).rejects.toMatchObject({ code: 'local-llm-providers-unavailable' })
  })
})

describe('native bridge routes', () => {
  it('serves the per-provider model catalog and rejects unknown routes', async () => {
    const bridge = await bridgeFor(openAiRuntime())
    const list = await request(`${bridge.url}/openai/v1/models`)
    expect(list.status).toBe(200)
    expect(JSON.parse(list.body)).toEqual({
      object: 'list',
      data: [
        { id: 'gpt-5', object: 'model', created: 0, owned_by: 'openai' },
        { id: 'gpt-5-mini', object: 'model', created: 0, owned_by: 'openai' },
      ],
    })
    expect((await request(`${bridge.url}/ollama/v1/models`)).status).toBe(200)
    expect((await request(`${bridge.url}/missing/v1/models`)).status).toBe(404)
    const unknown = await request(`${bridge.url}/openai/v1/models/does-not-exist`)
    expect(unknown.status).toBe(404)
    expect(JSON.parse(unknown.body)).toMatchObject({ error: { type: 'model-not-found' } })
    expect(bridge.providerUrl('openai')).toBe(`${bridge.url}/openai/v1`)
  })

  it('collects a non-streaming chat completion into the OpenAI message shape', async () => {
    const runtime = openAiRuntime()
    const bridge = await bridgeFor(runtime)
    const result = await request(`${bridge.url}/openai/v1/chat/completions`, {
      method: 'POST',
      body: {
        model: 'gpt-5',
        messages: [
          { role: 'system', content: 'be terse' },
          { role: 'user', content: 'hi' },
        ],
        tools: [{ type: 'function', function: { name: 'lookup', description: 'look it up', parameters: { type: 'object', properties: { q: { type: 'string' } } } } }],
        temperature: 9,
        max_tokens: 128,
      },
    })
    expect(result.status).toBe(200)
    const body = JSON.parse(result.body) as Record<string, unknown>
    expect(body).toMatchObject({
      object: 'chat.completion',
      model: 'gpt-5',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hello world' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      provider: 'openai',
    })
    const call = runtime.calls.at(0)
    expect(call).toMatchObject({
      provider: 'openai',
      model: 'gpt-5',
      system: 'be terse',
      temperature: 2,
      maxTokens: 128,
    })
    expect(call?.messages).toEqual([{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }])
    expect(call?.tools).toEqual([{ name: 'lookup', description: 'look it up', parameters: { type: 'object', properties: { q: { type: 'string' } } } }])
  })

  it('streams text, tool calls and usage as OpenAI chunks', async () => {
    const runtime = new FakeRuntime(
      [{ id: 'openai', name: 'OpenAI' }],
      { openai: [{ provider: 'openai', id: 'gpt-5', name: 'GPT-5' }] },
      () => [
        { type: 'reasoning-delta', index: 0, text: 'thinking…' },
        { type: 'text-delta', index: 1, text: 'Let me ' },
        { type: 'text-delta', index: 1, text: 'look.' },
        { type: 'tool-call-delta', index: 2, id: 'call-1', name: 'get_weather', argumentsDelta: '{"city":' },
        { type: 'tool-call-delta', index: 2, id: 'call-1', argumentsDelta: '"Paris"}' },
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2 } },
        { type: 'finish', reason: { kind: 'tool-calls' } },
      ],
    )
    const bridge = await bridgeFor(runtime)
    const result = await request(`${bridge.url}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { accept: 'text/event-stream' },
      body: {
        model: 'gpt-5',
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: 'user', content: 'weather?' }],
      },
    })
    expect(result.status).toBe(200)
    expect(result.headers['content-type']).toContain('text/event-stream')
    const chunks = sseChunks(result.body) as {
      choices: { index: number; delta: { content?: string; reasoning_content?: string; tool_calls?: { index: number; id?: string; function: { name?: string; arguments?: string } }[] }; finish_reason: string | null }[]
      usage?: Record<string, number>
    }[]
    const deltas = chunks.flatMap(chunk => chunk.choices ?? [])
    expect(deltas.filter(entry => entry.delta.reasoning_content !== undefined).map(entry => entry.delta.reasoning_content)).toEqual(['thinking…'])
    expect(deltas.filter(entry => entry.delta.content !== undefined).map(entry => entry.delta.content)).toEqual(['Let me ', 'look.'])
    const toolDeltas = deltas.flatMap(entry => entry.delta.tool_calls ?? [])
    expect(toolDeltas[0]).toMatchObject({ index: 0, id: 'call-1', function: { name: 'get_weather', arguments: '{"city":' } })
    expect(toolDeltas[1]).toMatchObject({ index: 0, function: { arguments: '"Paris"}' } })
    expect(chunks.at(-1)?.usage).toEqual({ prompt_tokens: 12, completion_tokens: 4, total_tokens: 16, cache_read_tokens: 2 })
    expect(deltas.at(-1)?.finish_reason).toBe('tool_calls')
    expect(result.body.trimEnd().endsWith('data: [DONE]')).toBe(true)
  })

  it('rejects malformed bodies and unknown models with OpenAI-shaped errors', async () => {
    const bridge = await bridgeFor(openAiRuntime())
    const post = async (body: unknown): Promise<{ status: number; body: string }> =>
      await request(`${bridge.url}/openai/v1/chat/completions`, { method: 'POST', body })
    expect((await post({ model: 'nope', messages: [{ role: 'user', content: 'hi' }] })).status).toBe(404)
    const noMessages = await post({ model: 'gpt-5' })
    expect(noMessages.status).toBe(400)
    expect(JSON.parse(noMessages.body)).toMatchObject({ error: { type: 'bad-request' } })
    const invalidJson = await new Promise<{ status: number; body: string }>(resolve => {
      const client = createServer()
      void client.close()
      resolve({ status: 0, body: '' })
    })
    void invalidJson
  })

  it('maps harness failures to a 500 error body', async () => {
    const runtime = new FakeRuntime(
      [{ id: 'openai', name: 'OpenAI' }],
      { openai: [{ provider: 'openai', id: 'gpt-5', name: 'GPT-5' }] },
      () => {
        throw new Error('upstream exploded with sk-secret')
      },
    )
    const bridge = await bridgeFor(runtime)
    const result = await request(`${bridge.url}/openai/v1/chat/completions`, {
      method: 'POST',
      body: { model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }] },
    })
    expect(result.status).toBe(500)
    expect(result.body).toContain('model-call-failed')
    expect(result.body).not.toContain('sk-secret')
  })
})

/* keep tsc honest about unused imports of node:http types above */
void ((): void => {
  void (null as unknown as IncomingMessage)
  void (null as unknown as ServerResponse)
  void (null as unknown as AddressInfo)
})
