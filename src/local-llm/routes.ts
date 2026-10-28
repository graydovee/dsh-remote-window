/**
 * The `local-llm/*` host methods and the `modelSource` request field.
 *
 * Kept out of the plugin row so the route contract (body validation, the
 * browser-facing shape and the coded failures) is unit-testable with a fake
 * store; `index.ts` only dispatches into these functions. No method here ever
 * returns the API key — the read shape exposes `hasApiKey` and nothing else.
 */
import type { TargetStore } from '../targets/store.ts'
import {
  clearLocalLlmKey,
  LocalLlmError,
  probeLocalModels,
  readLocalLlmState,
  saveLocalLlmState,
} from './settings.ts'
import { discoverLocalCatalog, LocalCatalogError, type NativeLlmRuntime } from './native.ts'

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LocalLlmError('local-llm-bad-settings', `"${field}" is required`)
  }
  return value
}

function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new LocalLlmError('local-llm-bad-settings', `"${field}" must be a string`)
  return value
}

function optionalStringArray(body: Record<string, unknown>, field: string): string[] | undefined {
  const value = body[field]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    throw new LocalLlmError('local-llm-bad-settings', `"${field}" must be an array of strings`)
  }
  return value as string[]
}

function optionalInteger(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new LocalLlmError('local-llm-bad-settings', `"${field}" must be an integer`)
  }
  return value
}

/** Parse the optional `mode` field (`auto` | `manual`). */
function optionalMode(body: Record<string, unknown>): 'auto' | 'manual' | undefined {
  const value = body.mode
  if (value === undefined || value === null) return undefined
  if (value !== 'auto' && value !== 'manual') {
    throw new LocalLlmError('local-llm-bad-settings', '"mode" must be auto|manual')
  }
  return value
}

/**
 * Parse the optional `modelSource` connect field.
 * @param body - the `v1/connect` body.
 * @returns the validated source, or undefined when the caller omitted it.
 */
export function parseModelSource(body: Record<string, unknown>): 'local' | 'server' | undefined {
  const value = body.modelSource
  if (value === undefined || value === null) return undefined
  if (value !== 'local' && value !== 'server') {
    throw new LocalLlmError('local-llm-bad-settings', '"modelSource" must be local|server')
  }
  return value
}

/**
 * Dispatch one `local-llm/*` method.
 * @param store - opened target store.
 * @param method - `local-llm/read|save|probe|clear-key`.
 * @param body - the already-parsed JSON body.
 * @param llm - the client host's model runtime (auto mode discovery); may be
 *   resolved lazily because the service can appear after plugin apply.
 * @returns the method's value, or undefined when the method is not ours.
 */
export async function dispatchLocalLlmApi(
  store: TargetStore,
  method: string,
  body: Record<string, unknown>,
  resolveLlm?: () => NativeLlmRuntime | undefined,
): Promise<unknown | undefined> {
  const llm = resolveLlm?.()
  switch (method) {
    case 'local-llm/read':
      // No secret crosses this route: the browser only learns `hasApiKey`.
      return await readLocalLlmState(store, optionalString(body, 'targetId'), llm)
    case 'local-llm/save': {
      const baseUrl = optionalString(body, 'baseUrl')
      // Legacy callers (and the surviving tests) save an endpoint without a
      // mode; an endpoint implies the manual source, never the automatic one.
      const mode = optionalMode(body)
        ?? (baseUrl !== undefined && baseUrl.trim() !== '' ? 'manual' : undefined)
      // A save naming neither a mode nor an endpoint is ambiguous; the browser
      // always sends `mode`, so refuse instead of silently persisting a guess.
      if (mode === undefined) {
        throw new LocalLlmError('local-llm-bad-settings', '"mode" or "baseUrl" is required')
      }
      const models = optionalStringArray(body, 'models')
      const timeoutMs = optionalInteger(body, 'timeoutMs')
      const apiKey = optionalString(body, 'apiKey')
      return await saveLocalLlmState(store, {
        ...(mode === undefined ? {} : { mode }),
        ...(baseUrl === undefined ? {} : { baseUrl }),
        ...(models === undefined ? {} : { models }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        ...(apiKey === undefined ? {} : { apiKey }),
      }, llm)
    }
    case 'local-llm/probe': {
      // Probing runs on the client host, before any SSH/profile work: the
      // wizard can show a precise failure without starting a server.
      const baseUrl = requireString(body, 'baseUrl')
      const timeoutMs = optionalInteger(body, 'timeoutMs')
      // The dialog clears the typed key after a successful save, so a probe
      // with no body key falls back to the stored credential; an explicit key
      // (e.g. "test this one before saving") always wins.
      const apiKey = optionalString(body, 'apiKey') ?? (await store.localLlmKey())
      return {
        models: await probeLocalModels({
          baseUrl,
          ...(apiKey === undefined ? {} : { apiKey }),
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
        }),
      }
    }
    case 'local-llm/discover': {
      // Auto mode's provider panel: enumerate everything this DSH can serve so
      // the user sees exactly what will be proxied.
      const runtime = resolveLlm?.()
      if (runtime === undefined) {
        throw new LocalLlmError(
          'local-llm-unavailable',
          'the client host does not expose its model runtime; the automatic local model source is unavailable in this installation',
        )
      }
      try {
        return { providers: (await discoverLocalCatalog(runtime)).providers }
      } catch (error) {
        if (error instanceof LocalCatalogError) throw new LocalLlmError('local-llm-providers-unavailable', error.message)
        throw new LocalLlmError(
          'local-llm-providers-unavailable',
          `the client host could not list its models: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    case 'local-llm/clear-key':
      return await clearLocalLlmKey(store)
    default:
      return undefined
  }
}
