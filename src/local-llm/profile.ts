/**
 * The profile patch that routes a server profile's model requests to the
 * client-host local model source.
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
 * - `llm-pi-ai` declares one hand-declared route per local source provider
 *   speaking the `openai-completions` protocol against the bridge, with the
 *   bridge-only placeholder key injected through `DSH_RW_LOCAL_LLM_KEY`;
 * - `agent-default-model` selects the first route and its first model,
 *   otherwise the official loop would call the server's own (usually
 *   unconfigured) model.
 */
/** Route id the generated patch declares for the manual endpoint. */
export const LOCAL_LLM_PROVIDER_ID = 'client-local'

/** Prefix for every route generated from the client host's own providers. */
export const LOCAL_LLM_AUTO_PROVIDER_PREFIX = 'remote-'

/** Display name shown by the official model picker for the manual route. */
export const LOCAL_LLM_DISPLAY_NAME = 'Local model'

/** Environment variable the profile server reads the route's key from. */
export const LOCAL_LLM_API_KEY_ENV = 'DSH_RW_LOCAL_LLM_KEY'

/**
 * Value exported into the profile server for {@link LOCAL_LLM_API_KEY_ENV}.
 *
 * It is **not** the user's key: the bridge replaces any incoming Authorization
 * header with the real one (manual) or ignores it (auto), so the profile only
 * needs a non-empty placeholder (the adapter fails loudly with
 * `MISSING_CREDENTIAL` when `apiKeyEnv` resolves to nothing).
 */
export const LOCAL_LLM_BRIDGE_API_KEY = 'local-bridge'

/** The empty patch written for a `server` model source (restores the official rows). */
export const EMPTY_PROFILE_PATCH = '[]\n'

/** One model entry inside a generated `llm-pi-ai` route. */
export interface LocalModelRouteModel {
  readonly id: string
  readonly name: string
}

/** One OpenAI-compatible route the bridge exposes inside the profile. */
export interface LocalModelRoute {
  /** Route id inside `llm-pi-ai` (unique within the patch). */
  readonly id: string
  /** Display name for the official model picker. */
  readonly displayName: string
  /**
   * Bridge URL path prefix (`''` for the manual root proxy, or
   * `/<encodeURIComponent(providerId)>` for one auto route).
   */
  readonly pathPrefix: string
  readonly models: readonly LocalModelRouteModel[]
}

/** What the generated patch needs. */
export interface LocalModelPatchOptions {
  /** Server-loopback port the reverse tunnel bound (`forwardIn('127.0.0.1', 0)`). */
  readonly remotePort: number
  /** Routes to declare, in picker order; the first one is the default. */
  readonly routes: readonly LocalModelRoute[]
}

/** Quote one scalar as a YAML-compatible JSON string. */
function q(value: string): string {
  return JSON.stringify(value)
}

/**
 * Map one client provider id to a stable, unique `llm-pi-ai` route id.
 *
 * The prefix keeps auto routes from clobbering the profile's own provider
 * entries (a patch replaces same-key configs); characters outside
 * `[a-z0-9_-]` are folded to `-` because the config answers to a route key.
 * @param providerId - client-side provider id from `ctx.llm.listProviders()`.
 * @param used - ids already taken in this patch (mutated).
 */
export function localModelRouteId(providerId: string, used: Set<string>): string {
  const base = `${LOCAL_LLM_AUTO_PROVIDER_PREFIX}${providerId.trim().toLowerCase().replace(/[^a-z0-9_-]+/gu, '-')}`
  let id = base
  let suffix = 2
  while (used.has(id) || id === LOCAL_LLM_PROVIDER_ID) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  used.add(id)
  return id
}

/**
 * Build the profile `cordis.patch.yml` body for the local model source.
 * @param options - tunnel port and the routes to declare.
 * @returns YAML text (LF only, trailing newline).
 * @throws Error when no route/model id or an invalid port is supplied — a route
 *   with no models is unserviceable and must fail before the profile starts.
 */
export function buildLocalModelPatch(options: LocalModelPatchOptions): string {
  if (!Number.isInteger(options.remotePort) || options.remotePort < 1 || options.remotePort > 65_535) {
    throw new Error(`invalid reverse-tunnel port ${String(options.remotePort)}`)
  }
  const routes = options.routes.filter(route => route.models.length > 0)
  if (routes.length === 0) throw new Error('the local model patch needs at least one provider route')
  const ids = new Set<string>()
  const unique: LocalModelRoute[] = []
  for (const route of routes) {
    const id = route.id.trim()
    if (id === '' || ids.has(id)) throw new Error(`invalid or duplicate provider route id ${JSON.stringify(route.id)}`)
    ids.add(id)
    const prefix = route.pathPrefix.trim()
    if (prefix !== '' && !prefix.startsWith('/')) {
      throw new Error(`route ${JSON.stringify(id)} needs a "/"-prefixed bridge path`)
    }
    const models = route.models
      .map(model => ({ id: model.id.trim(), name: model.name.trim() === '' ? model.id.trim() : model.name.trim() }))
      .filter(model => model.id !== '')
    if (models.length === 0) throw new Error(`provider route ${JSON.stringify(id)} advertises no models`)
    unique.push({ id, displayName: route.displayName.trim() === '' ? id : route.displayName.trim(), pathPrefix: prefix, models })
  }
  const lines: string[] = ['- id: "llm-pi-ai"', '  config:', '    providers:']
  for (const route of unique) {
    lines.push(
      `      ${q(route.id)}:`,
      `        displayName: ${q(route.displayName)}`,
      `        api: ${q('openai-completions')}`,
      `        baseURL: ${q(`http://127.0.0.1:${options.remotePort}${route.pathPrefix}/v1`)}`,
      `        apiKeyEnv: ${q(LOCAL_LLM_API_KEY_ENV)}`,
      '        models:',
    )
    for (const model of route.models) {
      lines.push(`          - id: ${q(model.id)}`, `            name: ${q(model.name)}`)
    }
  }
  const first = unique[0] as LocalModelRoute
  const firstModel = first.models[0] as LocalModelRouteModel
  lines.push(
    '- id: "agent-default-model"',
    '  config:',
    `    provider: ${q(first.id)}`,
    `    model: ${q(firstModel.id)}`,
    '',
  )
  return lines.join('\n')
}
