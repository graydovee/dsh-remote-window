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
 * @returns the method's value, or undefined when the method is not ours.
 */
export async function dispatchLocalLlmApi(
  store: TargetStore,
  method: string,
  body: Record<string, unknown>,
): Promise<unknown | undefined> {
  switch (method) {
    case 'local-llm/read':
      // No secret crosses this route: the browser only learns `hasApiKey`.
      return await readLocalLlmState(store, optionalString(body, 'targetId'))
    case 'local-llm/save': {
      const baseUrl = requireString(body, 'baseUrl')
      const models = optionalStringArray(body, 'models')
      const timeoutMs = optionalInteger(body, 'timeoutMs')
      const apiKey = optionalString(body, 'apiKey')
      return await saveLocalLlmState(store, {
        baseUrl,
        ...(models === undefined ? {} : { models }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        ...(apiKey === undefined ? {} : { apiKey }),
      })
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
    case 'local-llm/clear-key':
      return await clearLocalLlmKey(store)
    default:
      return undefined
  }
}
