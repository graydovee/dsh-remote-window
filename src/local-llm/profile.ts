/**
 * The profile patch that routes a server profile's model requests to the
 * client-host bridge.
 *
 * The server profile's `cordis.patch.yml` is generated on **every connect**: the
 * SSH reverse tunnel binds an OS-assigned server-loopback port, so the previous
 * patch's `baseURL` is stale by definition. The builder is pure and the output
 * is plain YAML (no `!!js` expressions): every scalar is JSON-quoted, which is
 * valid YAML and survives model ids containing special characters.
 *
 * Two official rows are overridden **by id**; a patch override replaces the
 * whole row config (no deep merge), so each entry restates everything it needs:
 *
 * - `llm-pi-ai` declares one hand-declared route (`client-local`) speaking the
 *   `openai-completions` protocol against the bridge, with the bridge-only key
 *   injected through `DSH_RW_LOCAL_LLM_KEY`;
 * - `agent-default-model` selects that route and its first model, otherwise the
 *   official loop would call the server's own (usually unconfigured) model.
 */
/** Route id the generated patch declares inside `llm-pi-ai`. */
export const LOCAL_LLM_PROVIDER_ID = 'client-local'

/** Display name shown by the official model picker for the generated route. */
export const LOCAL_LLM_DISPLAY_NAME = 'Local model'

/** Environment variable the profile server reads the route's key from. */
export const LOCAL_LLM_API_KEY_ENV = 'DSH_RW_LOCAL_LLM_KEY'

/**
 * Value exported into the profile server for {@link LOCAL_LLM_API_KEY_ENV}.
 *
 * It is **not** the user's key: the bridge replaces any incoming Authorization
 * header with the real one, so the profile only needs a non-empty placeholder
 * (the adapter fails loudly with `MISSING_CREDENTIAL` when `apiKeyEnv` resolves
 * to nothing).
 */
export const LOCAL_LLM_BRIDGE_API_KEY = 'local-bridge'

/** The empty patch written for a `server` model source (restores the official rows). */
export const EMPTY_PROFILE_PATCH = '[]\n'

/** What the generated patch needs. */
export interface LocalModelPatchOptions {
  /** Server-loopback port the reverse tunnel bound (`forwardIn('127.0.0.1', 0)`). */
  readonly remotePort: number
  /** Model ids advertised by the user's endpoint, in preference order. */
  readonly models: readonly string[]
  /** Provider display name; defaults to {@link LOCAL_LLM_DISPLAY_NAME}. */
  readonly displayName?: string
}

/** Quote one scalar as a YAML-compatible JSON string. */
function q(value: string): string {
  return JSON.stringify(value)
}

/**
 * Build the profile `cordis.patch.yml` body for the local model source.
 * @param options - tunnel port, model ids and optional display name.
 * @returns YAML text (LF only, trailing newline).
 * @throws Error when no model id or an invalid port is supplied — a route with
 *   no models is unserviceable and must fail before the profile starts.
 */
export function buildLocalModelPatch(options: LocalModelPatchOptions): string {
  if (!Number.isInteger(options.remotePort) || options.remotePort < 1 || options.remotePort > 65_535) {
    throw new Error(`invalid reverse-tunnel port ${String(options.remotePort)}`)
  }
  const models = options.models.map(model => model.trim()).filter(model => model !== '')
  if (models.length === 0) throw new Error('the local model patch needs at least one model id')
  const displayName = options.displayName ?? LOCAL_LLM_DISPLAY_NAME
  const lines: string[] = [
    '- id: "llm-pi-ai"',
    '  config:',
    '    providers:',
    `      ${q(LOCAL_LLM_PROVIDER_ID)}:`,
    `        displayName: ${q(displayName)}`,
    `        api: ${q('openai-completions')}`,
    `        baseURL: ${q(`http://127.0.0.1:${options.remotePort}/v1`)}`,
    `        apiKeyEnv: ${q(LOCAL_LLM_API_KEY_ENV)}`,
    '        models:',
  ]
  for (const id of models) {
    lines.push(`          - id: ${q(id)}`, `            name: ${q(id)}`)
  }
  lines.push(
    '- id: "agent-default-model"',
    '  config:',
    `    provider: ${q(LOCAL_LLM_PROVIDER_ID)}`,
    `    model: ${q(models[0] as string)}`,
    '',
  )
  return lines.join('\n')
}
