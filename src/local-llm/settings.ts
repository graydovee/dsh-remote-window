/**
 * Client-local model endpoint settings, credential handling and the readiness
 * probe.
 *
 * The user's OpenAI-compatible endpoint runs on the **client host**; a server
 * profile reaches it through an SSH reverse tunnel and the loopback bridge in
 * `bridge.ts`. Nothing here ever copies the API key out of
 * `ctx.credentials` into the storage domain, a log line, an error message or a
 * route payload — the browser only learns `hasApiKey`.
 *
 * Errors are coded ({@link LocalLlmError}) so the host routes can map them onto
 * 400/502/424 without leaking a URL credential or a key.
 */
import {
  effectiveModelSource,
  localLlmSettingsSchema,
  scrubSecrets,
  type LocalLlmSettings,
} from '../targets/types.ts'
import { localLlmCredentialKey, type TargetStore } from '../targets/store.ts'

/** Default upstream request/probe timeout (two minutes). */
export const LOCAL_LLM_DEFAULT_TIMEOUT_MS = 120_000
/** Smallest accepted timeout. */
export const LOCAL_LLM_MIN_TIMEOUT_MS = 1_000
/** Largest accepted timeout. */
export const LOCAL_LLM_MAX_TIMEOUT_MS = 3_600_000

/** Coded failures the host routes expose for the local model feature. */
export type LocalLlmErrorCode =
  | 'local-llm-unconfigured'
  | 'local-llm-bad-settings'
  | 'local-llm-no-models'
  | 'local-llm-unauthorized'
  | 'local-llm-unreachable'
  | 'local-llm-forwarding-unavailable'

/** HTTP status per coded failure (the P3 route envelope uses it verbatim). */
const STATUS_BY_LOCAL_LLM_CODE: Record<LocalLlmErrorCode, number> = {
  'local-llm-unconfigured': 400,
  'local-llm-bad-settings': 400,
  'local-llm-no-models': 400,
  'local-llm-unauthorized': 502,
  'local-llm-unreachable': 502,
  // The server could not provide its side of the reverse tunnel (sshd refused
  // `forwardIn`, e.g. `AllowTcpForwarding no`): a failed dependency, not the
  // client request's fault.
  'local-llm-forwarding-unavailable': 424,
}

/** A coded local-model failure; every message is scrubbed before it escapes. */
export class LocalLlmError extends Error {
  readonly status: number

  constructor(readonly code: LocalLlmErrorCode, message: string, readonly details?: unknown) {
    super(scrubSecrets(message))
    this.name = 'LocalLlmError'
    this.status = STATUS_BY_LOCAL_LLM_CODE[code]
  }
}

/** The browser-facing read shape: settings plus `hasApiKey`, never the key. */
export interface LocalLlmReadState {
  readonly baseUrl: string
  readonly models: readonly string[]
  readonly timeoutMs: number
  readonly hasApiKey: boolean
  /** Effective model source of the requested target, when one was named. */
  readonly modelSource?: 'local' | 'server'
}

/** One validated, ready-to-use local model route plan. */
export interface LocalLlmPlan {
  readonly settings: LocalLlmSettings
  readonly models: readonly string[]
  /** The API key, kept only in memory for the bridge; never serialized. */
  readonly apiKey?: string
}

/** The settings the route layer reads before a save. */
export interface LocalLlmSaveInput {
  readonly baseUrl: string
  readonly models?: readonly string[]
  readonly timeoutMs?: number
  /**
   * A new API key. An empty string clears the stored key; `undefined` keeps the
   * current one (the browser never sends back what it does not have).
   */
  readonly apiKey?: string
}

/**
 * Validate and normalize one local endpoint base URL.
 *
 * Only `http(s)` without embedded credentials, query or fragment is accepted —
 * the bridge injects the key in a header, and a URL carrying one would leak it
 * into every error message. A trailing `/v1` is stripped so the incoming
 * request path (`/v1/...`) is appended exactly once.
 * @param baseUrl - the configured endpoint base.
 * @returns `scheme://host[/path]` without a trailing slash or `/v1`.
 */
export function normalizeLocalBaseUrl(baseUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(baseUrl.trim())
  } catch {
    throw new LocalLlmError('local-llm-bad-settings', 'the local model base URL is not a valid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new LocalLlmError('local-llm-bad-settings', 'the local model base URL must use http:// or https://')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new LocalLlmError('local-llm-bad-settings', 'the local model base URL must not embed credentials')
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new LocalLlmError('local-llm-bad-settings', 'the local model base URL must not carry a query or fragment')
  }
  const path = parsed.pathname.replace(/\/+$/u, '').replace(/\/v1$/u, '').replace(/\/+$/u, '')
  return `${parsed.protocol}//${parsed.host}${path}`
}

/**
 * The URL of the endpoint's OpenAI model catalog (`GET /v1/models`).
 * @param baseUrl - configured endpoint base (normalized here).
 */
export function localModelsUrl(baseUrl: string): string {
  return `${normalizeLocalBaseUrl(baseUrl)}/v1/models`
}

/**
 * The upstream URL for one bridge request.
 *
 * The bridge only forwards paths starting `/v1/`, so this is a plain join; the
 * base's own `/v1` was already removed by {@link normalizeLocalBaseUrl}.
 * @param baseUrl - configured endpoint base.
 * @param requestPath - the client-side path plus query (`/v1/chat/completions?x=1`).
 */
export function localUpstreamUrl(baseUrl: string, requestPath: string): string {
  const base = normalizeLocalBaseUrl(baseUrl)
  return requestPath.startsWith('/') ? `${base}${requestPath}` : `${base}/${requestPath}`
}

/** Read the endpoint base from an endpoint's model catalog JSON. */
export function modelsFromCatalog(body: unknown): string[] {
  const rows = Array.isArray(body)
    ? body
    : body !== null && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)
      ? (body as { data: unknown[] }).data
      : []
  const models: string[] = []
  for (const row of rows) {
    const id = typeof row === 'string'
      ? row
      : row !== null && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string'
        ? (row as { id: string }).id
        : undefined
    if (id === undefined) continue
    const value = id.trim()
    if (value !== '' && !models.includes(value)) models.push(value)
  }
  return models
}

/** Deduplicate/normalize a model id list, rejecting malformed input. */
function normalizeModels(models: readonly unknown[]): string[] {
  const out: string[] = []
  for (const entry of models) {
    if (typeof entry !== 'string') throw new LocalLlmError('local-llm-bad-settings', 'model ids must be strings')
    const value = entry.trim()
    if (value === '' || value.length > 256) throw new LocalLlmError('local-llm-bad-settings', 'model ids must be non-empty and at most 256 characters')
    if (!out.includes(value)) out.push(value)
  }
  if (out.length > 256) throw new LocalLlmError('local-llm-bad-settings', 'at most 256 model ids may be configured')
  return out
}

/** The current settings as the browser sees them (no secret). */
export async function readLocalLlmState(store: TargetStore, targetId?: string): Promise<LocalLlmReadState> {
  const settings = store.localLlmSettings()
  const key = await store.localLlmKey()
  let modelSource: 'local' | 'server' | undefined
  if (targetId !== undefined) {
    const record = store.target(targetId)
    if (record !== undefined) modelSource = effectiveModelSource(record)
  }
  return {
    baseUrl: settings?.baseUrl ?? '',
    models: [...(settings?.models ?? [])],
    timeoutMs: settings?.timeoutMs ?? LOCAL_LLM_DEFAULT_TIMEOUT_MS,
    hasApiKey: key !== undefined,
    ...(modelSource === undefined ? {} : { modelSource }),
  }
}

/**
 * Validate, persist and (when a key or model list is supplied) update the
 * endpoint settings. The key goes to `ctx.credentials`, never to the domain.
 * @param store - opened target store (domain global + credential seam).
 * @param input - the route body.
 * @returns the same read shape `local-llm/read` answers.
 */
export async function saveLocalLlmState(store: TargetStore, input: LocalLlmSaveInput): Promise<LocalLlmReadState> {
  const current = store.localLlmSettings()
  const baseUrl = normalizeLocalBaseUrl(input.baseUrl)
  const models = normalizeModels(input.models ?? current?.models ?? [])
  const timeoutMs = input.timeoutMs ?? current?.timeoutMs ?? LOCAL_LLM_DEFAULT_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs < LOCAL_LLM_MIN_TIMEOUT_MS || timeoutMs > LOCAL_LLM_MAX_TIMEOUT_MS) {
    throw new LocalLlmError(
      'local-llm-bad-settings',
      `the timeout must be an integer between ${LOCAL_LLM_MIN_TIMEOUT_MS} and ${LOCAL_LLM_MAX_TIMEOUT_MS} ms`,
    )
  }
  if (input.apiKey !== undefined) await store.storeLocalLlmKey(input.apiKey)
  const hasKey = (await store.localLlmKey()) !== undefined
  const settings: LocalLlmSettings = {
    baseUrl,
    models,
    timeoutMs,
    ...(hasKey ? { apiKeyRef: String(localLlmCredentialKey()) } : {}),
  }
  await store.setLocalLlmSettings(localLlmSettingsSchema.parse(settings))
  return {
    baseUrl: settings.baseUrl,
    models: [...settings.models],
    timeoutMs: settings.timeoutMs,
    hasApiKey: hasKey,
  }
}

/**
 * Remove the stored local model API key (settings stay).
 * @param store - opened target store.
 */
export async function clearLocalLlmKey(store: TargetStore): Promise<LocalLlmReadState> {
  await store.forgetLocalLlmKey()
  const current = store.localLlmSettings()
  if (current !== undefined) {
    const { apiKeyRef: _cleared, ...rest } = current
    await store.setLocalLlmSettings(rest)
  }
  return await readLocalLlmState(store)
}

/**
 * Probe one local endpoint's `/v1/models` and return its model ids.
 *
 * Runs from the client host (no SSH involved) so a misconfigured endpoint fails
 * before any remote work starts. Coded failures:
 * - 401/403 → `local-llm-unauthorized`
 * - transport error/timeout/other HTTP status → `local-llm-unreachable`
 * - non-JSON/empty catalog → `local-llm-no-models`
 * @param options - endpoint base, optional key and timeout.
 */
export async function probeLocalModels(options: {
  readonly baseUrl: string
  readonly apiKey?: string
  readonly timeoutMs?: number
}): Promise<string[]> {
  const url = localModelsUrl(options.baseUrl)
  const timeoutMs = options.timeoutMs ?? LOCAL_LLM_DEFAULT_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new LocalLlmError('local-llm-bad-settings', 'the probe timeout must be a positive integer')
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, Math.min(timeoutMs, 2_147_483_647))
  timer.unref?.()
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(options.apiKey === undefined || options.apiKey === '' ? {} : { authorization: `Bearer ${options.apiKey}` }),
      },
      signal: controller.signal,
    })
  } catch (error) {
    throw new LocalLlmError(
      'local-llm-unreachable',
      `the local model endpoint did not answer ${url} within ${timeoutMs} ms: ${error instanceof Error ? error.message : String(error)}`,
      { url, timeoutMs },
    )
  } finally {
    clearTimeout(timer)
  }
  if (response.status === 401 || response.status === 403) {
    throw new LocalLlmError(
      'local-llm-unauthorized',
      `the local model endpoint answered HTTP ${response.status} for ${url}; check the saved API key`,
      { url, status: response.status },
    )
  }
  if (!response.ok) {
    throw new LocalLlmError(
      'local-llm-unreachable',
      `the local model endpoint answered HTTP ${response.status} for ${url}`,
      { url, status: response.status },
    )
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new LocalLlmError('local-llm-no-models', `the local model endpoint's ${url} response is not JSON`, { url })
  }
  const models = modelsFromCatalog(body)
  if (models.length === 0) {
    throw new LocalLlmError(
      'local-llm-no-models',
      `the local model endpoint's ${url} response lists no model ids; configure the model ids manually`,
      { url },
    )
  }
  return models
}

/**
 * Load the configured endpoint and produce a connect-ready plan.
 *
 * Validates the base URL, reads the key from the credential store and probes
 * `/v1/models` when no models are stored (persisting what it discovered so the
 * next connect is offline). Throws {@link LocalLlmError} — never falls back to
 * the server's models.
 * @param store - opened target store.
 */
export async function planLocalLlm(store: TargetStore): Promise<LocalLlmPlan> {
  const settings = store.localLlmSettings()
  if (settings === undefined || settings.baseUrl.trim() === '') {
    throw new LocalLlmError(
      'local-llm-unconfigured',
      'no local model endpoint is configured; save the client-local OpenAI-compatible base URL before connecting with the local model source',
    )
  }
  const baseUrl = normalizeLocalBaseUrl(settings.baseUrl)
  const apiKey = await store.localLlmKey()
  let models = [...settings.models]
  if (models.length === 0) {
    models = await probeLocalModels({
      baseUrl,
      ...(apiKey === undefined ? {} : { apiKey }),
      timeoutMs: settings.timeoutMs,
    })
    const discovered: LocalLlmSettings = { ...settings, baseUrl, models }
    await store.setLocalLlmSettings(localLlmSettingsSchema.parse(discovered))
  }
  if (models.length === 0) {
    throw new LocalLlmError('local-llm-no-models', 'the local model endpoint has no models; configure at least one model id')
  }
  return {
    settings: { ...settings, baseUrl, models },
    models,
    ...(apiKey === undefined ? {} : { apiKey }),
  }
}
