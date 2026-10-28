/**
 * "Auto" local model source: exposes the **client host's own** DSH model
 * providers to a server profile over the existing SSH reverse tunnel.
 *
 * The profile's `llm-pi-ai` layer gets one OpenAI-compatible provider per
 * client-side provider route; every route's `baseURL` points at this loopback
 * bridge, which turns the incoming chat-completions request back into a
 * `ctx.llm.stream()` call on the client host. The profile talks only Model
 * Context Protocol wire format to us, we talk the harness's own `StreamChunk`
 * protocol to the client's providers — no API key ever crosses the SSH link.
 *
 * The bridge is byte-for-byte loopback only (`127.0.0.1`, ephemeral port); the
 * server side is reachable exclusively through the reverse tunnel.
 */
import { randomUUID } from 'node:crypto'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { Socket } from 'node:net'
import { scrubSecrets } from '../targets/types.ts'

/* ------------------------------------------------------------------ types */

/**
 * Structural view of the client host's `ctx.llm` (the `LlmRuntime` service).
 *
 * The plugin deliberately does not depend on `@deepseek-ai/dsh-llm`: the host
 * context exposes the service at runtime and the shapes below are the stable
 * wire vocabulary it returns (`docs/subsystems/llm-streaming.md`).
 */
export interface NativeLlmRuntime {
  listProviders(): Promise<readonly NativeProviderInfo[]>
  listModels(provider: string): Promise<readonly NativeModelInfo[]>
  stream(options: NativeGenerateOptions): AsyncIterable<NativeStreamChunk>
}

/** One registered provider route (`ctx.llm.listProviders()`). */
export interface NativeProviderInfo {
  readonly id: string
  readonly name: string
}

/** One model id advertised by a provider route (`ctx.llm.listModels()`). */
export interface NativeModelInfo {
  readonly provider: string
  readonly id: string
  readonly name: string
  readonly description?: string
}

/** Per-call token accounting (counts are disjoint; see the harness docs). */
export interface NativeTokenUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly reasoningTokens?: number
}

/** One structured model-call failure reported by the harness runtime. */
export interface NativeLlmFailure {
  readonly code?: string
  readonly message?: string
}

/** Why a model call ended. */
export type NativeFinishReason =
  | { readonly kind: 'stop' }
  | { readonly kind: 'tool-calls' }
  | { readonly kind: 'max-tokens' }
  | { readonly kind: 'aborted'; readonly failure?: NativeLlmFailure }
  | { readonly kind: 'error'; readonly failure?: NativeLlmFailure }

/** One durable content block (only the variants the bridge maps are listed). */
export interface NativeContentBlock {
  readonly type: string
  readonly text?: string
  readonly id?: string
  readonly name?: string
  readonly arguments?: string
}

/** One request message as the harness assembles it. */
export interface NativeRequestMessage {
  readonly id?: string
  readonly role: 'system' | 'developer' | 'user' | 'assistant' | 'tool'
  readonly content: readonly NativeContentBlock[]
  readonly source?: Record<string, unknown>
  readonly toolCallId?: string
  readonly isError?: boolean
}

/** One JSON-schema tool declaration. */
export interface NativeToolSchema {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
}

/** One fully assembled model request (`GenerateOptions`). */
export interface NativeGenerateOptions {
  readonly provider: string
  readonly model: string
  readonly messages: readonly NativeRequestMessage[]
  readonly system?: string
  readonly tools?: readonly NativeToolSchema[]
  readonly temperature?: number
  readonly maxTokens?: number
  readonly stop?: readonly string[]
  readonly signal?: AbortSignal
  readonly sessionId?: string
  readonly purpose?: string
}

/** The raw streaming protocol emitted by adapters (`StreamChunk`). */
export type NativeStreamChunk =
  | { readonly type: 'block-start'; readonly index: number; readonly blockType: string }
  | { readonly type: 'text-delta'; readonly index: number; readonly text: string }
  | { readonly type: 'reasoning-delta'; readonly index: number; readonly text: string }
  | {
    readonly type: 'tool-call-delta'
    readonly index: number
    readonly id: string
    readonly name?: string
    readonly argumentsDelta: string
  }
  | { readonly type: 'block-end'; readonly index: number; readonly block: NativeContentBlock }
  | { readonly type: 'usage'; readonly usage: NativeTokenUsage }
  | { readonly type: 'finish'; readonly reason: NativeFinishReason; readonly replayState?: unknown }

/* ---------------------------------------------------------------- catalog */

/** One model in the discovery catalog. */
export interface LocalCatalogModel {
  readonly id: string
  readonly name: string
}

/** One provider route in the discovery catalog. */
export interface LocalCatalogProvider {
  readonly id: string
  readonly name: string
  readonly models: readonly LocalCatalogModel[]
}

/** What the client host's DSH currently offers. */
export interface LocalCatalog {
  readonly providers: readonly LocalCatalogProvider[]
}

/** Upper bounds keep a hostile/huge catalog from bloating the profile patch. */
export const LOCAL_CATALOG_MAX_PROVIDERS = 32
/** Maximum models advertised per provider. */
export const LOCAL_CATALOG_MAX_MODELS = 256

/**
 * Enumerate every provider/model the client host's DSH can currently serve.
 *
 * A provider whose catalog lookup fails (transient network, unconfigured
 * credentials) is skipped rather than failing the whole connect; the error is
 * surfaced through the provider's absence. Unknown/empty ids are ignored.
 * @param llm - the client host's `ctx.llm` runtime.
 * @returns providers with at least one usable model, in registration order.
 */
export async function discoverLocalCatalog(llm: NativeLlmRuntime): Promise<LocalCatalog> {
  let providers: readonly NativeProviderInfo[]
  try {
    providers = await llm.listProviders()
  } catch (error) {
    throw new LocalCatalogError(
      'local-llm-providers-unavailable',
      `the client host could not list its model providers: ${errorText(error)}`,
    )
  }
  const out: LocalCatalogProvider[] = []
  for (const provider of providers) {
    if (out.length >= LOCAL_CATALOG_MAX_PROVIDERS) break
    const id = typeof provider.id === 'string' ? provider.id.trim() : ''
    if (id === '') continue
    let models: readonly NativeModelInfo[]
    try {
      models = await llm.listModels(id)
    } catch {
      continue
    }
    const seen = new Set<string>()
    const catalogModels: LocalCatalogModel[] = []
    for (const model of models) {
      if (catalogModels.length >= LOCAL_CATALOG_MAX_MODELS) break
      const modelId = typeof model.id === 'string' ? model.id.trim() : ''
      if (modelId === '' || seen.has(modelId)) continue
      seen.add(modelId)
      const name = typeof model.name === 'string' && model.name.trim() !== '' ? model.name : modelId
      catalogModels.push({ id: modelId, name })
    }
    if (catalogModels.length === 0) continue
    out.push({
      id,
      name: typeof provider.name === 'string' && provider.name.trim() !== '' ? provider.name : id,
      models: catalogModels,
    })
  }
  return { providers: out }
}

/** A coded catalog failure the route layer can map to an HTTP status. */
export class LocalCatalogError extends Error {
  constructor(readonly code: 'local-llm-providers-unavailable', message: string) {
    super(scrubSecrets(message))
    this.name = 'LocalCatalogError'
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Scrub one error message before it crosses the tunnel.
 *
 * `scrubSecrets` covers URL/key-value shapes; provider SDK errors can also
 * echo a raw bearer key, which must never reach the profile server logs.
 */
function scrubBridgeError(text: string): string {
  return scrubSecrets(text)
    .replace(/\bsk-[A-Za-z0-9_-]{4,}\b/g, 'sk-***')
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1***')
}

/* ----------------------------------------------------------------- bridge */

/** Maximum accepted JSON request body (MiB) for one bridged chat call. */
export const LOCAL_NATIVE_BODY_LIMIT_BYTES = 16 * 1024 * 1024

/** Options for one native bridge instance. */
export interface NativeLlmBridgeOptions {
  /** The client host's `ctx.llm` runtime. */
  readonly llm: NativeLlmRuntime
  /** The catalog discovered for this connect (routes are restricted to it). */
  readonly catalog: LocalCatalog
  /** Upstream request timeout for non-streaming calls (streaming has no cap). */
  readonly timeoutMs?: number
}

/** A running native bridge. */
export interface NativeLlmBridge {
  /** Loopback host (always `127.0.0.1`). */
  readonly host: '127.0.0.1'
  /** Ephemeral loopback port. */
  readonly port: number
  /** `http://127.0.0.1:<port>` (no trailing slash). */
  readonly url: string
  /** The loopback URL prefix for one provider route. */
  providerUrl(providerId: string): string
  /** Close the listener and every open connection. */
  close(): Promise<void>
}

/**
 * Start the loopback bridge for one connect.
 * @param options - runtime, catalog and optional timeout.
 */
export async function startNativeLlmBridge(bridgeOptions: NativeLlmBridgeOptions): Promise<NativeLlmBridge> {
  const runtime = bridgeOptions.llm
  const routes = new Map<string, LocalCatalogProvider>()
  for (const provider of bridgeOptions.catalog.providers) routes.set(encodeURIComponent(provider.id), provider)
  const timeoutMs = bridgeOptions.timeoutMs ?? 120_000
  const sockets = new Set<Socket>()
  const server: Server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (!response.headersSent) {
        sendJson(response, 500, openAiError(500, 'bridge-failed', scrubBridgeError(errorText(error))))
      } else {
        try {
          response.end()
        } catch {}
      }
    })
  })
  server.on('connection', socket => {
    sockets.add(socket)
    socket.on('close', () => { sockets.delete(socket) })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    throw new Error('the native local-model bridge did not obtain a loopback port')
  }
  const url = `http://127.0.0.1:${address.port}`
  return {
    host: '127.0.0.1',
    port: address.port,
    url,
    providerUrl(providerId: string): string {
      return `${url}/${encodeURIComponent(providerId)}/v1`
    },
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    },
  }

  /* ---------------------------------------------------------------- routing */

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const rawUrl = request.url ?? '/'
    let parsed: URL
    try {
      parsed = new URL(rawUrl, url)
    } catch {
      sendJson(response, 400, openAiError(400, 'bad-request', 'the request URL is not a path'))
      return
    }
    const segments = parsed.pathname.split('/').filter(segment => segment !== '')
    const providerKey = segments[0] === undefined ? '' : segments[0]
    const provider = routes.get(providerKey)
    if (provider === undefined) {
      sendJson(response, 404, openAiError(404, 'unknown-provider', `unknown provider route ${JSON.stringify(providerKey)}`))
      return
    }
    const rest = segments.slice(1)
    const method = (request.method ?? 'GET').toUpperCase()
    if (method === 'GET' && rest.length >= 2 && rest[0] === 'v1' && rest[1] === 'models') {
      const modelId = rest.length > 2 ? decodeURIComponent(rest.slice(2).join('/')) : undefined
      if (modelId === undefined) {
        sendJson(response, 200, {
          object: 'list',
          data: provider.models.map(model => ({
            id: model.id,
            object: 'model',
            created: 0,
            owned_by: provider.id,
          })),
        })
        return
      }
      const model = provider.models.find(entry => entry.id === modelId)
      if (model === undefined) {
        sendJson(response, 404, openAiError(404, 'model-not-found', `the provider does not advertise model ${JSON.stringify(modelId)}`))
        return
      }
      sendJson(response, 200, { id: model.id, object: 'model', created: 0, owned_by: provider.id })
      return
    }
    if (method === 'POST' && rest.length === 3 && rest[0] === 'v1' && rest[1] === 'chat' && rest[2] === 'completions') {
      await handleChat(request, response, provider, timeoutMs)
      return
    }
    sendJson(response, 404, openAiError(404, 'not-found', `unknown route ${method} ${parsed.pathname}`))
  }

  async function handleChat(
    request: IncomingMessage,
    response: ServerResponse,
    provider: LocalCatalogProvider,
    timeout: number,
  ): Promise<void> {
    let body: Record<string, unknown>
    try {
      body = parseJsonBody(await readBody(request, LOCAL_NATIVE_BODY_LIMIT_BYTES))
    } catch (error) {
      sendJson(response, 400, openAiError(400, 'bad-request', scrubBridgeError(errorText(error))))
      return
    }
    const modelId = typeof body.model === 'string' ? body.model.trim() : ''
    const model = provider.models.find(entry => entry.id === modelId)
    if (modelId === '' || model === undefined) {
      sendJson(
        response,
        404,
        openAiError(404, 'model-not-found', `the provider ${JSON.stringify(provider.id)} does not advertise model ${JSON.stringify(modelId)}`),
      )
      return
    }
    const messages = Array.isArray(body.messages) ? body.messages : undefined
    if (messages === undefined || messages.length === 0) {
      sendJson(response, 400, openAiError(400, 'bad-request', '"messages" must be a non-empty array'))
      return
    }
    const controller = new AbortController()
    const onClose = (): void => { controller.abort(new Error('the profile server closed the bridge request')) }
    response.on('close', onClose)
    const stream = body.stream === true
    const includeUsage = isIncludeUsage(body.stream_options)
    const id = `chatcmpl-${randomUUID()}`

    let options: NativeGenerateOptions
    try {
      options = toGenerateOptions(provider, modelId, body, messages, controller.signal)
    } catch (error) {
      response.off('close', onClose)
      sendJson(response, 400, openAiError(400, 'bad-request', scrubBridgeError(errorText(error))))
      return
    }

    if (!stream) {
      const timer = setTimeout(() => { controller.abort(new Error(`the model call exceeded ${timeout} ms`)) }, Math.min(timeout, 2_147_483_647))
      timer.unref?.()
      try {
        const collected = await collect(options, provider, modelId)
        sendJson(response, 200, collected)
      } catch (error) {
        sendJson(response, 500, openAiError(500, 'model-call-failed', scrubBridgeError(errorText(error))))
      } finally {
        clearTimeout(timer)
        response.off('close', onClose)
      }
      return
    }

    // Headers stay unwritten until the first chunk: a call that fails before
    // producing content can still answer with a plain error response.
    let started = false
    const startStream = (): void => {
      if (started) return
      started = true
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      response.flushHeaders?.()
    }
    const emit = (payload: Record<string, unknown>): void => {
      startStream()
      emitSse(response, payload)
    }
    let failure: string | undefined
    try {
      failure = await streamChat(options, provider, modelId, emit, id, includeUsage)
    } catch (error) {
      const message = scrubBridgeError(errorText(error))
      if (!started) {
        response.off('close', onClose)
        sendJson(response, 502, openAiError(502, 'model-call-failed', message))
        return
      }
      emit({
        id,
        object: 'chat.completion.chunk',
        created: 0,
        model: modelId,
        choices: [{ index: 0, delta: {}, finish_reason: 'error' }],
        error: { message, type: 'model-call-failed' },
      })
      failure = message
    } finally {
      response.off('close', onClose)
    }
    if (!started && failure !== undefined) {
      sendJson(response, 502, openAiError(502, 'model-call-failed', failure))
      return
    }
    try {
      response.write('data: [DONE]\n\n')
      response.end()
    } catch {}
  }

  /* ------------------------------------------------------------ converters */

  function toGenerateOptions(
    provider: LocalCatalogProvider,
    modelId: string,
    body: Record<string, unknown>,
    messages: readonly Record<string, unknown>[],
    signal: AbortSignal,
  ): NativeGenerateOptions {
    const systemParts: string[] = []
    const nativeMessages: NativeRequestMessage[] = []
    for (const raw of messages) {
      const role = typeof raw.role === 'string' ? raw.role : ''
      if (role === 'system' || role === 'developer') {
        systemParts.push(...flattenOpenAiContent(raw.content).texts)
        continue
      }
      if (role === 'user') {
        const { texts } = flattenOpenAiContent(raw.content)
        const text = texts.join('')
        nativeMessages.push({
          role: 'user',
          source: { kind: 'user' },
          content: text === '' ? [] : [{ type: 'text', text }],
        })
        continue
      }
      if (role === 'assistant') {
        const { texts } = flattenOpenAiContent(raw.content)
        const content: NativeContentBlock[] = []
        if (texts.length > 0) content.push({ type: 'text', text: texts.join('') })
        for (const call of openAiToolCalls(raw)) {
          content.push({ type: 'tool-call', id: call.id, name: call.name, arguments: call.arguments })
        }
        nativeMessages.push({
          role: 'assistant',
          source: { kind: 'model', provider: provider.id, model: modelId },
          content,
        })
        continue
      }
      if (role === 'tool') {
        const toolCallId = typeof raw.tool_call_id === 'string' ? raw.tool_call_id : ''
        const { texts } = flattenOpenAiContent(raw.content)
        nativeMessages.push({
          role: 'tool',
          source: { kind: 'tool', callId: toolCallId },
          toolCallId,
          isError: false,
          content: texts.length === 0 ? [{ type: 'text', text: '' }] : [{ type: 'text', text: texts.join('') }],
        })
        continue
      }
    }
    const options: NativeGenerateOptions = {
      provider: provider.id,
      model: modelId,
      messages: nativeMessages,
      signal,
      ...(systemParts.length === 0 ? {} : { system: systemParts.join('\n\n') }),
      ...(toTemperature(body.temperature) === undefined ? {} : { temperature: toTemperature(body.temperature) as number }),
      ...(toMaxTokens(body) === undefined ? {} : { maxTokens: toMaxTokens(body) as number }),
      ...(toStop(body.stop) === undefined ? {} : { stop: toStop(body.stop) as readonly string[] }),
    }
    const tools = toToolSchemas(body.tools)
    return tools === undefined ? options : { ...options, tools }
  }

  async function collect(
    options: NativeGenerateOptions,
    provider: LocalCatalogProvider,
    modelId: string,
  ): Promise<Record<string, unknown>> {
    const text: string[] = []
    const toolCalls: { id: string; name: string; arguments: string }[] = []
    const toolIndexByBlock = new Map<number, number>()
    const callNameByBlock = new Map<number, string>()
    let usage: NativeTokenUsage | undefined
    let finish: NativeFinishReason | undefined
    let reasoning: string[] = []
    for await (const chunk of runtime.stream(options)) {
      switch (chunk.type) {
        case 'text-delta':
          text.push(chunk.text)
          break
        case 'reasoning-delta':
          reasoning.push(chunk.text)
          break
        case 'tool-call-delta': {
          const index = toolIndexByBlock.get(chunk.index)
          if (index === undefined) {
            toolIndexByBlock.set(chunk.index, toolCalls.length)
            callNameByBlock.set(chunk.index, chunk.name ?? '')
            toolCalls.push({ id: chunk.id, name: chunk.name ?? '', arguments: chunk.argumentsDelta })
          } else {
            const call = toolCalls[index]
            if (call !== undefined) {
              if (call.id === '' && chunk.id !== '') call.id = chunk.id
              if (call.name === '' && chunk.name !== undefined) call.name = chunk.name
              call.arguments += chunk.argumentsDelta
            }
          }
          break
        }
        case 'block-end': {
          if (chunk.block.type === 'tool-call') {
            const index = toolIndexByBlock.get(chunk.index)
            if (index !== undefined && toolCalls[index] !== undefined && chunk.block.arguments !== undefined) {
              toolCalls[index].arguments = chunk.block.arguments
            }
          }
          break
        }
        case 'usage':
          usage = chunk.usage
          break
        case 'finish':
          finish = chunk.reason
          break
        default:
          break
      }
    }
    const failure = finishFailureText(finish)
    if (failure !== undefined && text.length === 0 && toolCalls.length === 0) throw new Error(failure)
    return {
      id: `chatcmpl-${randomUUID()}`,
      object: 'chat.completion',
      created: 0,
      model: modelId,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: text.length === 0 ? null : text.join(''),
          ...(toolCalls.length === 0
            ? {}
            : {
                tool_calls: toolCalls.map(call => ({
                  id: call.id,
                  type: 'function',
                  function: { name: call.name, arguments: call.arguments },
                })),
              }),
          ...(reasoning.length === 0 ? {} : { reasoning_content: reasoning.join('') }),
        },
        finish_reason: toOpenAiFinish(finish),
      }],
      ...(usage === undefined ? {} : { usage: toOpenAiUsage(usage) }),
      provider: provider.id,
    }
  }

  async function streamChat(
    options: NativeGenerateOptions,
    provider: LocalCatalogProvider,
    modelId: string,
    emit: (payload: Record<string, unknown>) => void,
    id: string,
    includeUsage: boolean,
  ): Promise<string | undefined> {
    const created = Math.floor(Date.now() / 1000)
    const toolIndexByBlock = new Map<number, number>()
    let usage: NativeTokenUsage | undefined
    let finish: NativeFinishReason | undefined
    const base = { id, object: 'chat.completion.chunk', created, model: modelId }
    for await (const chunk of runtime.stream(options)) {
      switch (chunk.type) {
        case 'text-delta':
          emit({
            ...base,
            choices: [{ index: 0, delta: { content: chunk.text }, finish_reason: null }],
          })
          break
        case 'reasoning-delta':
          emit({
            ...base,
            choices: [{ index: 0, delta: { reasoning_content: chunk.text }, finish_reason: null }],
          })
          break
        case 'tool-call-delta': {
          let index = toolIndexByBlock.get(chunk.index)
          if (index === undefined) {
            index = toolIndexByBlock.size
            toolIndexByBlock.set(chunk.index, index)
            emit({
              ...base,
              choices: [{
                index: 0,
                delta: {
                  tool_calls: [{
                    index,
                    id: chunk.id,
                    type: 'function',
                    function: { name: chunk.name ?? '', arguments: chunk.argumentsDelta },
                  }],
                },
                finish_reason: null,
              }],
            })
          } else {
            emit({
              ...base,
              choices: [{
                index: 0,
                delta: {
                  tool_calls: [{ index, function: { arguments: chunk.argumentsDelta } }],
                },
                finish_reason: null,
              }],
            })
          }
          break
        }
        case 'usage':
          usage = chunk.usage
          break
        case 'finish':
          finish = chunk.reason
          break
        default:
          break
      }
    }
    const failure = finishFailureText(finish)
    emit({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: toOpenAiFinish(finish) }],
      ...(failure === undefined ? {} : { error: { message: failure, type: 'model-call-failed' } }),
    })
    if (includeUsage && usage !== undefined) {
      emit({ ...base, choices: [], usage: toOpenAiUsage(usage) })
    }
    return failure
  }
}

/** Readable, scrubbed text for one terminal model-call failure. */
function finishFailureText(reason: NativeFinishReason | undefined): string | undefined {
  if (reason === undefined) return undefined
  if (reason.kind !== 'error' && reason.kind !== 'aborted') return undefined
  const code = typeof reason.failure?.code === 'string' && reason.failure.code !== '' ? `${reason.failure.code}: ` : ''
  const message = typeof reason.failure?.message === 'string' && reason.failure.message !== ''
    ? reason.failure.message
    : 'the model call ended without a content block'
  return scrubBridgeError(`${code}${message}`)
}

/* --------------------------------------------------------------- helpers */

interface OpenAiToolCall {
  readonly id: string
  readonly name: string
  readonly arguments: string
}

interface FlattenedContent {
  readonly texts: string[]
}

/** Flatten OpenAI message content (string or text parts); images become a text note. */
function flattenOpenAiContent(content: unknown): FlattenedContent {
  if (typeof content === 'string') return { texts: content === '' ? [] : [content] }
  if (!Array.isArray(content)) return { texts: [] }
  const texts: string[] = []
  for (const part of content) {
    if (part === null || typeof part !== 'object') continue
    const record = part as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') {
      if (record.text !== '') texts.push(record.text)
      continue
    }
    if (record.type === 'image_url') {
      texts.push('[image attachment omitted by the local model proxy]')
      continue
    }
    if (typeof record.text === 'string' && record.text !== '') texts.push(record.text)
  }
  return { texts }
}

/** Extract normalized function calls from one assistant message. */
function openAiToolCalls(message: Record<string, unknown>): OpenAiToolCall[] {
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
  const out: OpenAiToolCall[] = []
  for (const raw of calls) {
    if (raw === null || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    const fn = record.function !== null && typeof record.function === 'object'
      ? (record.function as Record<string, unknown>)
      : undefined
    const id = typeof record.id === 'string' ? record.id : ''
    const name = fn !== undefined && typeof fn.name === 'string' ? fn.name : ''
    const args = fn !== undefined
      ? typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {})
      : '{}'
    if (name === '') continue
    out.push({ id, name, arguments: args })
  }
  return out
}

/** Normalize the OpenAI `tools` field to harness `ToolSchema`s. */
function toToolSchemas(value: unknown): readonly NativeToolSchema[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: NativeToolSchema[] = []
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    const fn = record.function !== null && typeof record.function === 'object'
      ? (record.function as Record<string, unknown>)
      : undefined
    if (fn === undefined || typeof fn.name !== 'string' || fn.name === '') continue
    const parameters = fn.parameters !== null && typeof fn.parameters === 'object'
      ? (fn.parameters as Record<string, unknown>)
      : { type: 'object', properties: {} }
    out.push({
      name: fn.name,
      description: typeof fn.description === 'string' ? fn.description : '',
      parameters,
    })
  }
  return out.length === 0 ? undefined : out
}

function toTemperature(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(2, value))
}

function toMaxTokens(body: Record<string, unknown>): number | undefined {
  const value = body.max_completion_tokens ?? body.max_tokens
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return undefined
  return value
}

function toStop(value: unknown): readonly string[] | undefined {
  if (typeof value === 'string') return value === '' ? undefined : [value]
  if (!Array.isArray(value)) return undefined
  const out = value.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
  return out.length === 0 ? undefined : out
}

function toOpenAiFinish(reason: NativeFinishReason | undefined): string {
  switch (reason?.kind) {
    case 'tool-calls':
      return 'tool_calls'
    case 'max-tokens':
      return 'length'
    case 'aborted':
    case 'error':
      return 'stop'
    default:
      return 'stop'
  }
}

function toOpenAiUsage(usage: NativeTokenUsage): Record<string, number> {
  const prompt = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  return {
    prompt_tokens: prompt,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens ?? prompt + usage.outputTokens,
    ...(usage.cacheReadTokens === undefined ? {} : { cache_read_tokens: usage.cacheReadTokens }),
  }
}

function isIncludeUsage(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  return (value as { include_usage?: unknown }).include_usage === true
}

/** Read one request body with a hard byte cap. */
async function readBody(request: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > limit) throw new Error(`the request body exceeds ${limit} bytes`)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function parseJsonBody(text: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('the request body is not valid JSON')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('the request body must be a JSON object')
  }
  return value as Record<string, unknown>
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) {
    try {
      response.end()
    } catch {}
    return
  }
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

function openAiError(status: number, type: string, message: string): Record<string, unknown> {
  return { error: { message, type, code: type, param: null } }
}

function emitSse(response: ServerResponse, chunk: unknown): void {
  response.write(`data: ${JSON.stringify(chunk)}\n\n`)
}
