/**
 * Client-local model source settings, credential handling and readiness
 * planning.
 *
 * Two sources exist:
 *
 * - `manual` — the user's own OpenAI-compatible endpoint on the client host.
 *   A server profile reaches it through an SSH reverse tunnel and the
 *   pass-through bridge in `bridge.ts`.
 * - `auto` (the default for a fresh installation) — every provider/model of
 *   the client host's own DSH, exposed over the same reverse tunnel by the
 *   native bridge in `native.ts`. Nothing needs to be configured.
 *
 * Nothing here ever copies an API key out of `ctx.credentials` into the
 * storage domain, a log line, an error message or a route payload — the
 * browser only learns `hasApiKey`.
 *
 * Errors are coded ({@link LocalLlmError}) so the host routes can map them onto
 * 400/502/424 without leaking a URL credential or a key.
 */
import {
  effectiveLocalLlmMode,
  effectiveModelSource,
  LOCAL_LLM_SELECTION_MAX_MODELS,
  LOCAL_LLM_SELECTION_MAX_PROVIDERS,
  localLlmSelectionListSchema,
  localLlmSettingsSchema,
  scrubSecrets,
  type LocalLlmSelection,
  type LocalLlmSettings,
} from '../targets/types.ts'
import { localLlmCredentialKey, type TargetStore } from '../targets/store.ts'
import {
  discoverLocalCatalog,
  LocalCatalogError,
  type LocalCatalog,
  type LocalCatalogProvider,
  type NativeLlmRuntime,
} from './native.ts'

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
  | 'local-llm-unavailable'
  | 'local-llm-providers-unavailable'
  | 'local-llm-forwarding-unavailable'

/** HTTP status per coded failure (the P3 route envelope uses it verbatim). */
const STATUS_BY_LOCAL_LLM_CODE: Record<LocalLlmErrorCode, number> = {
  'local-llm-unconfigured': 400,
  'local-llm-bad-settings': 400,
  'local-llm-no-models': 400,
  'local-llm-unauthorized': 502,
  'local-llm-unreachable': 502,
  // The client host has no model runtime (or it failed to answer): a failed
  // dependency of the automatic proxy, not the request's fault.
  'local-llm-unavailable': 502,
  'local-llm-providers-unavailable': 502,
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
  /** Effective source: `auto` (the client host's own providers) or `manual`. */
  readonly mode: 'auto' | 'manual'
  readonly baseUrl: string
  readonly models: readonly string[]
  readonly timeoutMs: number
  readonly hasApiKey: boolean
  /**
   * Discovered providers/models in `auto` mode (the dialog shows them).
   * Omitted in `manual` mode.
   */
  readonly catalog?: LocalCatalog
  /** Why discovery failed, when it did (the dialog still offers Retry). */
  readonly catalogError?: string
  /**
   * The saved provider/model opt-in of the automatic source (auto only).
   *
   * Omitted means "no filter — proxy everything"; an empty array is an explicit
   * selection that matches nothing and fails the plan with `local-llm-no-models`.
   */
  readonly selection?: readonly LocalLlmSelection[]
  /** Effective model source of the requested target, when one was named. */
  readonly modelSource?: 'local' | 'server'
}

/** One validated, ready-to-use local model route plan. */
export interface LocalLlmPlan {
  readonly mode: 'auto' | 'manual'
  /** Required for `manual`; absent in `auto` (nothing to configure). */
  readonly settings?: LocalLlmSettings
  /** Display model ids (auto: `provider/model` pairs) for progress messages. */
  readonly models: readonly string[]
  /** The API key, kept only in memory for the bridge; never serialized. */
  readonly apiKey?: string
  /** The discovered catalog in `auto` mode. */
  readonly catalog?: LocalCatalog
}

/** The settings the route layer reads before a save. */
export interface LocalLlmSaveInput {
  /** Next source; defaults to the current effective mode. */
  readonly mode?: 'auto' | 'manual'
  /** Endpoint base; required for `manual`, ignored for `auto`. */
  readonly baseUrl?: string
  readonly models?: readonly string[]
  readonly timeoutMs?: number
  /**
   * A new API key. An empty string clears the stored key; `undefined` keeps the
   * current one (the browser never sends back what it does not have).
   */
  readonly apiKey?: string
  /**
   * The automatic source's provider/model opt-in. Only persisted in `auto`
   * mode; `undefined` clears a previously saved selection (back-compat keep-all)
   * and `[]` is an explicit selection that matches nothing.
   */
  readonly selection?: readonly LocalLlmSelection[]
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

/**
 * Validate, normalize and de-duplicate a route body's `selection` field.
 *
 * The wire shape is `{ providerId: string; models: string[] }[]`; malformed
 * input is a coded 400 rather than a partially applied save. `undefined`/`null`
 * mean "the caller did not state a selection" and are kept distinct from `[]`
 * (an explicit selection that matches nothing).
 * @param value - the raw JSON value of the `selection` field.
 * @returns normalized entries, or undefined when the field was omitted.
 */
export function parseLocalLlmSelection(value: unknown): LocalLlmSelection[] | undefined {
  if (value === undefined || value === null) return undefined
  const parsed = localLlmSelectionListSchema.safeParse(value)
  if (!parsed.success) {
    throw new LocalLlmError(
      'local-llm-bad-settings',
      `"selection" must be an array of { providerId: string, models: string[] } entries (at most ${LOCAL_LLM_SELECTION_MAX_PROVIDERS} providers, ${LOCAL_LLM_SELECTION_MAX_MODELS} models each)`,
    )
  }
  return parsed.data
}

/** The stored settings document, when one exists. */
function currentSettings(store: TargetStore): LocalLlmSettings | undefined {
  return store.localLlmSettings()
}

/**
 * Discover the client host's provider catalog for the `auto` source.
 * @param llm - the client host's `ctx.llm` runtime, when available.
 * @param timeoutMs - accepted for symmetry with the manual probe; the catalog
 *   itself is local and synchronous-ish.
 * @returns the discovered catalog (never empty; throws a coded error instead).
 */
async function discoverCatalog(llm: NativeLlmRuntime | undefined, timeoutMs: number): Promise<LocalCatalog> {
  void timeoutMs
  if (llm === undefined) {
    throw new LocalLlmError(
      'local-llm-unavailable',
      'the client host does not expose its model runtime; the automatic local model source is unavailable in this installation',
    )
  }
  let catalog: LocalCatalog
  try {
    catalog = await discoverLocalCatalog(llm)
  } catch (error) {
    if (error instanceof LocalCatalogError) {
      throw new LocalLlmError('local-llm-unreachable', error.message)
    }
    throw new LocalLlmError('local-llm-unreachable', `the client host could not list its models: ${errorMessage(error)}`)
  }
  if (catalog.providers.length === 0) {
    throw new LocalLlmError(
      'local-llm-no-models',
      'the client host has no model providers with models; configure a model provider in DSH before connecting with the automatic local model source',
    )
  }
  return catalog
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Flatten a catalog into `provider/model` display ids. */
export function catalogDisplayModels(catalog: LocalCatalog): string[] {
  const out: string[] = []
  for (const provider of catalog.providers) {
    for (const model of provider.models) out.push(`${provider.id}/${model.id}`)
  }
  return out
}

/**
 * Keep only the providers/models a stored selection names.
 *
 * Matching is by exact id after trimming: a selected provider that no longer
 * exists is dropped, and only selected models that the provider still lists
 * survive. Providers without any surviving model disappear, so the caller can
 * treat an empty result as "nothing to proxy". Catalog order (not selection
 * order) is preserved so profile route ids stay stable across saves.
 * @param catalog - the freshly discovered catalog.
 * @param selection - the stored, sanitized selection entries.
 * @returns the filtered catalog.
 */
function filterCatalogBySelection(catalog: LocalCatalog, selection: readonly LocalLlmSelection[]): LocalCatalog {
  const wanted = new Map<string, Set<string>>()
  for (const entry of selection) {
    const providerId = entry.providerId.trim()
    if (providerId === '') continue
    const models = wanted.get(providerId) ?? new Set<string>()
    for (const raw of entry.models) {
      const model = raw.trim()
      if (model !== '') models.add(model)
    }
    wanted.set(providerId, models)
  }
  const providers: LocalCatalogProvider[] = []
  for (const provider of catalog.providers) {
    const selected = wanted.get(provider.id)
    if (selected === undefined || selected.size === 0) continue
    const models = provider.models.filter(model => selected.has(model.id))
    if (models.length === 0) continue
    providers.push({ id: provider.id, name: provider.name, models })
  }
  return { providers }
}

/** The current settings as the browser sees them (no secret). */
export async function readLocalLlmState(
  store: TargetStore,
  targetId?: string,
  llm?: NativeLlmRuntime,
): Promise<LocalLlmReadState> {
  const settings = currentSettings(store)
  const mode = effectiveLocalLlmMode(settings)
  const key = await store.localLlmKey()
  let modelSource: 'local' | 'server' | undefined
  if (targetId !== undefined) {
    const record = store.target(targetId)
    if (record !== undefined) modelSource = effectiveModelSource(record)
  }
  const base: LocalLlmReadState = {
    mode,
    baseUrl: settings?.baseUrl ?? '',
    models: [...(settings?.models ?? [])],
    timeoutMs: settings?.timeoutMs ?? LOCAL_LLM_DEFAULT_TIMEOUT_MS,
    hasApiKey: key !== undefined,
    ...(modelSource === undefined ? {} : { modelSource }),
  }
  if (mode === 'manual') return base
  // Auto mode: discover so the dialog can show what would be proxied. A
  // discovery failure is reported beside the mode instead of failing the read;
  // the saved selection is returned either way so the dialog can render it.
  const selection = settings?.localSelection
  const withSelection: LocalLlmReadState = selection === undefined ? base : { ...base, selection }
  try {
    const catalog = await discoverCatalog(llm, base.timeoutMs)
    return { ...withSelection, catalog }
  } catch (error) {
    const message = error instanceof LocalLlmError ? error.message : scrubSecrets(errorMessage(error))
    return { ...withSelection, catalogError: message }
  }
}

/**
 * Validate, persist and (when a key or model list is supplied) update the
 * local model settings. A key goes to `ctx.credentials`, never to the domain.
 * @param store - opened target store (domain global + credential seam).
 * @param input - the route body.
 * @returns the same read shape `local-llm/read` answers.
 */
export async function saveLocalLlmState(
  store: TargetStore,
  input: LocalLlmSaveInput,
  llm?: NativeLlmRuntime,
): Promise<LocalLlmReadState> {
  const current = currentSettings(store)
  // A save that names an endpoint means the manual source; only a save that
  // carries neither mode nor endpoint falls back to the stored (legacy) mode.
  const mode = input.mode
    ?? (input.baseUrl !== undefined && input.baseUrl.trim() !== '' ? 'manual' : effectiveLocalLlmMode(current))
  if (mode !== 'auto' && mode !== 'manual') {
    throw new LocalLlmError('local-llm-bad-settings', '"mode" must be auto|manual')
  }
  const timeoutMs = input.timeoutMs ?? current?.timeoutMs ?? LOCAL_LLM_DEFAULT_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs < LOCAL_LLM_MIN_TIMEOUT_MS || timeoutMs > LOCAL_LLM_MAX_TIMEOUT_MS) {
    throw new LocalLlmError(
      'local-llm-bad-settings',
      `the timeout must be an integer between ${LOCAL_LLM_MIN_TIMEOUT_MS} and ${LOCAL_LLM_MAX_TIMEOUT_MS} ms`,
    )
  }
  if (input.apiKey !== undefined) await store.storeLocalLlmKey(input.apiKey)
  const hasKey = (await store.localLlmKey()) !== undefined
  let settings: LocalLlmSettings
  if (mode === 'auto') {
    // Nothing to configure: the catalog is discovered live on demand. Keep the
    // timeout and drop any previously saved manual endpoint so switching back
    // later starts from a clean slate. The selection is validated/normalized
    // here, and an omitted field clears a stale filter (the pre-selection
    // "proxy everything" behavior); manual mode drops the value entirely.
    const selection = parseLocalLlmSelection(input.selection)
    settings = {
      mode: 'auto',
      baseUrl: '',
      models: [],
      timeoutMs,
      ...(selection === undefined ? {} : { localSelection: selection }),
    }
  } else {
    const baseUrl = normalizeLocalBaseUrl(requireManualBaseUrl(input.baseUrl, current))
    const models = normalizeModels(input.models ?? [])
    settings = {
      mode: 'manual',
      baseUrl,
      models,
      timeoutMs,
      ...(hasKey ? { apiKeyRef: String(localLlmCredentialKey()) } : {}),
    }
  }
  await store.setLocalLlmSettings(localLlmSettingsSchema.parse(settings))
  return await readLocalLlmState(store, undefined, llm)
}

function requireManualBaseUrl(input: string | undefined, current: LocalLlmSettings | undefined): string {
  const value = input ?? (effectiveLocalLlmMode(current) === 'manual' ? current?.baseUrl : undefined)
  if (value === undefined || value.trim() === '') {
    throw new LocalLlmError(
      'local-llm-unconfigured',
      'no local model endpoint is configured; save the client-local OpenAI-compatible base URL or switch to the automatic source',
    )
  }
  return value
}

/**
 * Remove the stored local model API key (settings stay).
 * @param store - opened target store.
 */
export async function clearLocalLlmKey(store: TargetStore): Promise<LocalLlmReadState> {
  await store.forgetLocalLlmKey()
  const current = currentSettings(store)
  if (current !== undefined) {
    const { apiKeyRef: _cleared, ...rest } = current
    await store.setLocalLlmSettings(rest)
  }
  return await readLocalLlmState(store)
}

/**
 * Probe one manual local endpoint's `/v1/models` and return its model ids.
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
 * Produce a connect-ready plan for the current local model mode.
 *
 * `auto` discovers the client host's provider catalog (coded failure when the
 * host exposes nothing); `manual` validates the saved endpoint, reads the key
 * from the credential store and probes `/v1/models` when no models are stored
 * (persisting what it discovered so the next connect is offline).
 * Throws {@link LocalLlmError} — never falls back to the server's models.
 * @param store - opened target store.
 * @param options - host-side model runtime (required for `auto`).
 */
export async function planLocalLlm(
  store: TargetStore,
  options?: { readonly llm?: NativeLlmRuntime },
): Promise<LocalLlmPlan> {
  const settings = currentSettings(store)
  const mode = effectiveLocalLlmMode(settings)
  if (mode === 'auto') {
    const discovered = await discoverCatalog(options?.llm, settings?.timeoutMs ?? LOCAL_LLM_DEFAULT_TIMEOUT_MS)
    // No stored selection keeps the historical behavior (proxy everything);
    // a stored one narrows the catalog before it reaches the profile patch.
    const selection = settings?.localSelection
    const catalog = selection === undefined ? discovered : filterCatalogBySelection(discovered, selection)
    if (catalog.providers.length === 0) {
      throw new LocalLlmError(
        'local-llm-no-models',
        'the saved local model selection matches none of the client host\'s current models; reselect at least one provider/model in the connection settings',
      )
    }
    return { mode, catalog, models: catalogDisplayModels(catalog) }
  }
  if (settings === undefined || settings.baseUrl.trim() === '') {
    throw new LocalLlmError(
      'local-llm-unconfigured',
      'no local model endpoint is configured; save the client-local OpenAI-compatible base URL or switch to the automatic source',
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
    const discovered: LocalLlmSettings = { ...settings, mode, baseUrl, models }
    await store.setLocalLlmSettings(localLlmSettingsSchema.parse(discovered))
  }
  if (models.length === 0) {
    throw new LocalLlmError('local-llm-no-models', 'the local model endpoint has no models; configure at least one model id')
  }
  return {
    mode,
    settings: { ...settings, mode, baseUrl, models },
    models,
    ...(apiKey === undefined ? {} : { apiKey }),
  }
}
