/**
 * Plugin-owned records and the host-plane seam the realm-scoped connection uses.
 *
 * Remote targets cannot live in the official workspace service: that service
 * realpaths `header.cwd` and `stat`s it locally, so a remote path would be
 * recorded as an invalid session path. Targets and remote workspaces are
 * therefore plugin-owned records in this profile's storage domain, and secrets
 * never enter them — only a reference into `ctx.credentials`.
 */
import type { Readable, Writable } from 'node:stream'
import { z } from 'zod'

/** Authentication kind; the value never carries a secret. */
export type RemoteAuthKind = 'password' | 'privateKey' | 'agent'

/** One file to write on a remote host (absolute POSIX path + its bytes). */
export interface RemoteFile {
  /** Absolute POSIX path on the remote host. */
  readonly path: string
  readonly content: Buffer
}

/**
 * Where the server package comes from for one target.
 *
 * `auto` follows the global policy; `reuse` is not a package source at all — it
 * says "use the dsh the host already has", so nothing is produced or uploaded.
 * The three artifact sources stay a closed set (`assets.sourceOrder`), and
 * `resolveServerPackage` refuses `reuse` outright.
 */
export type RemotePackageSource = 'auto' | 'download' | 'upload' | 'reuse'

/** The launcher a reuse connection was last started with (a UI hint, not a contract). */
export interface RemoteReuseDshRecord {
  readonly path: string
  readonly version: string
  readonly nodePath?: string
  readonly scannedAt: string
}

/** The architecture the target was last probed on — a hint only. */
export interface RemotePlatformProbeRecord {
  readonly platform: 'linux' | 'darwin'
  readonly arch: 'x64' | 'arm64'
  readonly libc: '' | 'gnu' | 'musl'
  readonly tag: string
  readonly probedAt: string
}

/** The server package this target last deployed (badge + troubleshooting). */
export interface RemoteServerPackageRecord {
  readonly artifact: string
  readonly sha256: string
  readonly version: string
}

/**
 * Resource kind.
 *
 * `ssh` is a host reached over the network; `wsl` is a *local* Windows
 * distribution driven through `wsl.exe` (Windows hosts only — the platform gate
 * lives in `./methods.ts` and is enforced on both the host and the client).
 * A container target stays reserved for a later version.
 */
export type RemoteTargetKind = 'ssh' | 'wsl'

/** Non-secret target record persisted in the profile's storage domain. */
export interface RemoteTargetRecord {
  readonly id: string
  /** The user-visible alias; required, saved on a successful connection. */
  readonly label: string
  readonly kind: RemoteTargetKind
  /** `ssh`: the network host. `wsl`: the distribution name. */
  readonly host: string
  readonly port: number
  readonly username: string
  readonly authKind: RemoteAuthKind
  /** `<scope>/<id>` key in `ctx.credentials` when a secret is stored. */
  readonly credentialKey?: string
  /** Path to a private key file on the *local* machine. */
  readonly privateKeyPath?: string
  /**
   * Accepted remote host key fingerprint (`SHA256:…`), pinned after explicit
   * confirmation. An empty string means the target is a draft that has not
   * completed first contact yet; it can never be used to connect silently.
   *
   * A `wsl` target is a local process, so it has no host key at all and keeps
   * this empty forever — the connect path is kind-aware for exactly that reason.
   */
  readonly hostKeyFingerprint: string
  /** `~/.ssh/config` alias this target was prefilled from, when any. */
  readonly sshConfigAlias?: string
  /** `wsl` only: the distribution this target runs in (`wsl.exe -l` name). */
  readonly wslDistro?: string
  /** `wsl` only: the distro user; absent means the distribution's default user. */
  readonly wslUser?: string
  /** How to obtain the server package: `auto` follows the global policy. */
  readonly packageSource?: RemotePackageSource
  /** User-selected remote dsh for `packageSource: 'reuse'`; preselected next time. */
  readonly reuseDsh?: RemoteReuseDshRecord
  /** Architecture seen on the last probe — a hint, never a correctness input. */
  readonly platformProbe?: RemotePlatformProbeRecord
  /** The server package last deployed (or reused) for this target. */
  readonly serverPackage?: RemoteServerPackageRecord
  /** v1: the installation's stable client id (also stored in the domain global). */
  readonly clientId?: string
  /** This connection's executor setting (`local` default: fresh servers usually lack model keys). */
  readonly executor?: 'server' | 'local'
  /**
   * Where the agent's model requests are served.
   *
   * `server` uses the profile server's own model configuration; `local` forwards
   * them through an SSH reverse tunnel to this client's OpenAI-compatible
   * endpoint. Absent reads as `server` for a new/explicit connection and as the
   * executor-derived default for display (see {@link effectiveModelSource}).
   */
  readonly modelSource?: 'local' | 'server'
  /** v1: the per-client profile this target's server runs (`graydovee-remote-window-<clientId>`). */
  readonly profileName?: string
  /** v1: last profile server port (hint only; the process prints the real one). */
  readonly profilePort?: number
  /** v1: runtime kind/dir/versions (hints for the next connect; never correctness inputs). */
  readonly runtimeKind?: 'isolated' | 'global'
  readonly runtimeDir?: string
  readonly pluginVersion?: string
  readonly serverDshVersion?: string
  /** Remote runtime coordinates (v0 fields; kept until the old provisioner retires). */
  readonly remote: RemoteRuntimeRecord
  readonly status: 'unknown' | 'ready' | 'failed' | 'stopped'
  readonly lastError?: string
  readonly lastConnectedAt?: string
  readonly createdAt: string
}

/** How the remote execution world is reached and started. */
export interface RemoteRuntimeRecord {
  /** Absolute or PATH-resolved Node executable on the remote host. */
  readonly nodePath: string
  /** Command that starts the remote dsh, for example `dsh` or `npx -y @deepseek-ai/dsh`. */
  readonly dshCommand: string
  /** Remote profile name. */
  readonly profile: string
  /** Remote `DSH_HOME`. */
  readonly dshHome: string
  /** Remote plugins to synchronise later; reserved and unused in v1. */
  readonly plugins: readonly string[]
}

/**
 * One remote workspace as *this client* remembers it: materialization + view state.
 *
 * **The server is the authority** (architecture §7): `path`/`title`/`createdAt`
 * now come from `reg.list` and are no longer stored here. What stays local is the
 * stub directory, the official shell entry id (cleanup only), the session pointer
 * and the per-client pin/archive sets — keyed by `remoteWorkspaceId`, so a rename
 * made on another device is consistent everywhere.
 *
 * P0 made `path`/`title`/`createdAt` **legacy optional**: an old document must
 * load unchanged (storage domain stays at version 1), and the startup migration
 * clears them once the server list has confirmed the id.
 */
export interface RemoteWorkspaceRecord {
  readonly id: string
  readonly targetId: string
  /** Server-authoritative workspace id (16 hex); absent until the ref is migrated. */
  readonly remoteWorkspaceId?: string
  /**
   * Local stub directory anchoring this remote path in the shell's workspace
   * tree. Non-authoritative: it may be deleted and rebuilt at any time, and a
   * ref created from `reg.list` has none until the workspace is opened.
   */
  readonly stubPath?: string
  /** The official workspace id this stub is registered under, when known (cleanup only). */
  readonly officialWorkspaceId?: string
  /**
   * Session ids this workspace's user pinned, most recently pinned first.
   *
   * Plugin-owned: the shell's own pin set is resolved against the *local*
   * session index, where a remote session never appears (see the schema's note).
   */
  readonly pinnedSessions?: string[]
  /** Session ids this workspace's user archived (grayed, not openable). */
  readonly archivedSessions?: string[]
  readonly lastOpenedAt?: string
  /** Session created for this workspace, when one exists. */
  readonly sessionId?: string
  /** @deprecated P0 legacy: the path now comes from `reg.list`; cleared by migration. */
  readonly path?: string
  /** @deprecated P0 legacy: the title now comes from `reg.list`; cleared by migration. */
  readonly title?: string
  /** @deprecated P0 legacy: `createdAt` now comes from `reg.list`; cleared by migration. */
  readonly createdAt?: string
  /** @deprecated P0 legacy: the server id is reported by `server.hello`. */
  readonly serverId?: string
}

/** The P0 name for {@link RemoteWorkspaceRecord}: a local reference, not a workspace. */
export type WorkspaceRef = RemoteWorkspaceRecord

/** One protocol channel to a remote server. */
export interface RemoteChannel {
  readonly input: Readable
  readonly output: Writable
  /**
   * Whether the far side is gone.
   *
   * The host plane caches one channel per target; without this flag a channel
   * whose remote server exited (lease expiry, crash, `wsl.exe` child death)
   * still looked usable, so the next browsing/agent call wrote into a dead pipe
   * and failed with a request timeout instead of re-provisioning.
   */
  readonly closed?: boolean
  /** Close the underlying channel; safe to call more than once. */
  close(): Promise<void>
}

/**
 * Host-plane service owned by the plugin's main row.
 *
 * The realm-scoped connection injects this instead of receiving credentials, so
 * a preset row's configuration never contains a secret and the connection file
 * never imports `ssh2`.
 */
/**
 * The RPC surface the realm-scoped `ctx.ssh` adapter needs.
 *
 * Structurally implemented by the plugin's own `RemoteClient`; declared here so
 * neither bundle imports the other's value module.
 */
export interface RemoteProtocolClient {
  /** Verified hello of the remote server (digest, root, workspace). */
  readonly hello: { readonly hash: string; readonly root: string; readonly workspace: string }
  /** One JSON RPC round-trip. */
  request<T>(method: string, params: unknown, result: import('zod').ZodType<T>, signal?: AbortSignal): Promise<T>
  /** Attach one authenticated logical stream. */
  openStream(endpoint: { readonly path: string }, signal?: AbortSignal): Promise<import('node:net').Socket>
}

export interface RemoteWorkspaceService {
  /** Open (starting it when necessary) a protocol channel to one target. */
  connectChannel(targetId: string, signal?: AbortSignal): Promise<RemoteChannel>
  /**
   * The target's single RPC client, pinned for the caller.
   *
   * Browsing and the realm-scoped `ctx.ssh` adapter must share one client: a
   * second multiplexer on the same stream steals the other peer's responses and
   * makes the remote server look unreachable.
   */
  remoteClient(targetId: string): Promise<RemoteProtocolClient>
  /** Drop one pin taken by {@link remoteClient}. */
  releaseRemoteClient(targetId: string): void
  /** SHA-256 of the local server entry, when it can be computed. */
  expectedDigest(targetId: string): Promise<string | undefined>
  /** The plugin-wide package-source policy and release mirror. */
  getPackagePolicy(): PackagePolicySettings
  /** Replace the plugin-wide package-source policy. */
  setPackagePolicy(settings: PackagePolicySettings): Promise<void>
  /** stub → remote path aliases for one target's opened workspaces. */
  pathAliases(targetId: string): { stub: string; remote: string }[]
  /** The remote workspace a stub-cwd session belongs to, when the stub is registered. */
  routeForCwd(cwd: string | undefined): { targetId: string; workspaceId: string } | undefined
  /** The local stub directory standing in for one remote workspace, when registered. */
  stubForWorkspace(workspaceId: string): string | undefined
  /** The remote workspace that owns one stored remote session, when discoverable. */
  locateRemoteSession(sessionId: string): Promise<{ targetId: string; workspaceId: string } | undefined>
  /** One administrative RPC to the target's server (persist.* plane). */
  sessionRequest<T>(targetId: string, method: string, params: unknown, signal?: AbortSignal): Promise<T>
}

declare module '@deepseek-ai/cordis' {
  interface Context { remoteWorkspaces: RemoteWorkspaceService }
}

const runtimeSchema = z.object({
  nodePath: z.string().min(1).default('node'),
  dshCommand: z.string().min(1).default('dsh'),
  profile: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).default('dsh-remote-server'),
  dshHome: z.string().min(1).default('~/.dsh'),
  plugins: z.array(z.string()).default([]),
}).strict()

/** Server-package source for one target. */
// Widened with `'reuse'` (architecture §3.3): an *optional* field whose enum grew,
// so every stored record still validates and the domain stays at version 1.
export const packageSourceSchema = z.enum(['auto', 'download', 'upload', 'reuse'])

/**
 * One provider's selected models for the automatic local model source.
 *
 * The connect dialog lists every provider/model the client host's own DSH can
 * serve; only the entries ticked here are exposed to the server profile (both
 * the profile patch and the native bridge see the filtered catalog). An empty
 * `models` list is a meaningful *exclusion*: it means "do not proxy this
 * provider", which is different from omitting the provider entirely.
 */
export interface LocalLlmSelection {
  readonly providerId: string
  readonly models: readonly string[]
}

/** Provider cap for one persisted selection (matches the discovery catalog cap). */
export const LOCAL_LLM_SELECTION_MAX_PROVIDERS = 32
/** Per-provider model cap for a persisted selection (matches the catalog cap). */
export const LOCAL_LLM_SELECTION_MAX_MODELS = 256

/**
 * Trim, de-duplicate and merge a provider selection.
 *
 * One entry per provider is kept: the first occurrence decides the position in
 * the result and later occurrences only contribute model ids. Model ids are
 * trimmed and de-duplicated in first-seen order; an explicit empty list is
 * preserved (see {@link LocalLlmSelection}). Blank provider ids and blank model
 * ids are dropped defensively — route input is validated separately.
 * @param selection - entries from a route body or a stored document.
 * @returns a normalized selection with at most one entry per provider.
 */
export function sanitizeLocalLlmSelection(selection: readonly LocalLlmSelection[]): LocalLlmSelection[] {
  const byProvider = new Map<string, string[]>()
  for (const entry of selection) {
    const providerId = entry.providerId.trim()
    if (providerId === '') continue
    const models = byProvider.get(providerId) ?? []
    for (const raw of entry.models) {
      const model = raw.trim()
      if (model === '' || models.includes(model)) continue
      models.push(model)
    }
    byProvider.set(providerId, models)
  }
  return [...byProvider].map(([providerId, models]) => ({ providerId, models }))
}

/** Validate one provider's selection entry; the list schema sanitizes/merges. */
export const localLlmSelectionSchema = z.object({
  providerId: z
    .string()
    .min(1)
    .max(256)
    .refine(value => value.trim() !== '', 'provider ids must not be blank'),
  models: z
    .array(z.string().min(1).max(256).refine(value => value.trim() !== '', 'model ids must not be blank'))
    .max(LOCAL_LLM_SELECTION_MAX_MODELS),
}).strict()

/**
 * Validate a whole selection list (route input and the persisted document).
 *
 * The transform makes "sanitized/deduped" a property of the schema, not only
 * of the save path: a document written by an older/foreign writer still reads
 * back as one entry per provider with unique ids.
 */
export const localLlmSelectionListSchema = z
  .array(localLlmSelectionSchema)
  .max(LOCAL_LLM_SELECTION_MAX_PROVIDERS)
  .transform(selection => sanitizeLocalLlmSelection(selection))

/**
 * The client-host local model source used as a server agent's model source
 * (the "local model" feature).
 *
 * Two modes exist:
 * - `manual` — a user-supplied OpenAI-compatible endpoint (`baseUrl`).
 * - `auto` — every provider/model of the client host's own DSH, exposed over
 *   the existing SSH reverse tunnel by a loopback bridge; nothing to
 *   configure, so `baseUrl` stays empty.
 *
 * Only non-secret facts live here: the mode, the base URL, the model ids and
 * the timeout. The API key itself lives in `ctx.credentials` under a fixed
 * key; `apiKeyRef` is only its non-secret address (and presence hint) for
 * diagnostics.
 */
export interface LocalLlmSettings {
  /**
   * Where the local source comes from. Optional so documents written before
   * the auto mode keep validating; see `effectiveLocalLlmMode`.
   */
  readonly mode?: 'auto' | 'manual'
  /** Base URL of the endpoint (`http`/`https`, no embedded credentials); empty in auto mode. */
  readonly baseUrl: string
  /** Advertised model ids in preference order; empty means "probe on connect". */
  readonly models: readonly string[]
  /** Upstream request/probe timeout in milliseconds. */
  readonly timeoutMs: number
  /** Non-secret credential address (`remote-window/<id>`); never a secret. */
  readonly apiKeyRef?: string
  /**
   * The automatic source's opt-in provider/model list (additive optional).
   *
   * Absent means "no filter": every discovered provider/model is proxied, which
   * is both the pre-selection behavior and the back-compat path for documents
   * written before this field existed. Only `auto` persists it — the manual
   * source has no catalog to select from, so a manual save drops it.
   */
  readonly localSelection?: readonly LocalLlmSelection[]
}

/**
 * The local model source's effective mode.
 *
 * An explicit `mode` always wins. A legacy document written before this field
 * existed has no `mode`; a configured `baseUrl` then means the user chose the
 * manual endpoint, while an empty base URL means "never configured" and gets
 * the new automatic proxy default.
 * @param settings - the stored settings, when any.
 */
export function effectiveLocalLlmMode(settings: LocalLlmSettings | undefined): 'auto' | 'manual' {
  if (settings?.mode === 'auto' || settings?.mode === 'manual') return settings.mode
  return settings !== undefined && settings.baseUrl.trim() !== '' ? 'manual' : 'auto'
}

/** Validate one local-model settings object; URL scheme + no embedded credentials. */
export const localLlmSettingsSchema = z.object({
  mode: z.enum(['auto', 'manual']).optional(),
  baseUrl: z.string().max(2048).refine((value) => {
    if (value === '') return true
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      return false
    }
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.username === ''
      && parsed.password === ''
      && parsed.hash === ''
      && parsed.search === ''
  }, 'must be an http(s) URL without credentials, query or fragment'),
  models: z.array(z.string().min(1).max(256)).max(256),
  timeoutMs: z.number().int().min(1_000).max(3_600_000),
  apiKeyRef: z.string().min(1).max(256).optional(),
  // Additive optional (storage stays at version 1): an absent list keeps every
  // discovered provider/model, an empty list is an explicit "nothing".
  localSelection: localLlmSelectionListSchema.optional(),
}).strict()

/** The domain global slot's schema (global default policy + release mirror). */
export const packagePolicySettingsSchema = z.object({
  policy: z.enum(['auto', 'download', 'upload', 'ask']),
  mirror: z.string(),
  /** v1 client identity; additive optional until first ensureClientId(). */
  clientId: z.string().regex(/^[a-z0-9]{12}$/u).optional(),
  /** Additive optional local-model endpoint settings (domain stays at version 1). */
  localLlm: localLlmSettingsSchema.optional(),
}).strict()

/** Stored target record; unknown fields from a newer version are dropped loudly. */
export const targetRecordSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  // Widened from `z.literal('ssh')` when WSL targets arrived. Records written by
  // an earlier version still validate unchanged, so the storage domain stays at
  // version 1 (additive evolution only).
  kind: z.enum(['ssh', 'wsl']),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  username: z.string().min(1),
  authKind: z.enum(['password', 'privateKey', 'agent']),
  credentialKey: z.string().optional(),
  privateKeyPath: z.string().min(1).optional(),
  hostKeyFingerprint: z.string().regex(/^(?:|SHA256:[A-Za-z0-9+/=]+)$/),
  sshConfigAlias: z.string().min(1).optional(),
  wslDistro: z.string().min(1).optional(),
  wslUser: z.string().min(1).optional(),
  packageSource: packageSourceSchema.optional(),
  /** Reuse mode's launcher memory; `.strict()` like every other record object. */
  reuseDsh: z.object({
    path: z.string().min(1),
    version: z.string(),
    nodePath: z.string().min(1).optional(),
    scannedAt: z.string().min(1),
  }).strict().optional(),
  /** Last probed architecture (hint only; every connect probes again). */
  platformProbe: z.object({
    platform: z.enum(['linux', 'darwin']),
    arch: z.enum(['x64', 'arm64']),
    libc: z.enum(['', 'gnu', 'musl']),
    tag: z.string().min(1),
    probedAt: z.string().min(1),
  }).strict().optional(),
  /** The server package last deployed, for the UI badge and for troubleshooting. */
  serverPackage: z.object({
    artifact: z.string().min(1),
    sha256: z.string().length(64),
    version: z.string().min(1),
  }).strict().optional(),
  // v1 additive optional fields (architecture §12): old documents validate
  // unchanged, so the storage domain stays at version 1.
  clientId: z.string().regex(/^[a-z0-9]{12}$/u).optional(),
  executor: z.enum(['server', 'local']).optional(),
  /** Additive optional local-model source (storage domain stays at version 1). */
  modelSource: z.enum(['local', 'server']).optional(),
  profileName: z.string().regex(/^graydovee-remote-window-[a-z0-9]{12}$/u).optional(),
  profilePort: z.number().int().min(1).max(65_535).optional(),
  runtimeKind: z.enum(['isolated', 'global']).optional(),
  runtimeDir: z.string().min(1).optional(),
  pluginVersion: z.string().min(1).optional(),
  serverDshVersion: z.string().min(1).optional(),
  stubPath: z.string().min(1).optional(),
  officialWorkspaceId: z.string().min(1).optional(),
  remote: runtimeSchema,
  status: z.enum(['unknown', 'ready', 'failed', 'stopped']),
  lastError: z.string().optional(),
  lastConnectedAt: z.string().optional(),
  createdAt: z.string().min(1),
}).strict()

/** Stored remote workspace record. */
/** Session ids the user pinned / archived in one remote workspace.
 *
 * Plugin-owned rather than the shell's registry-global sets: the shell resolves
 * a pin against its *local* session index (`sessionPersistence.list()`), which
 * by design holds no remote session, so `workspace/pinSession` answers
 * `session/not-found` for a remote id. Additive optional fields keep the storage
 * domain version at 1. */
const sessionFlagSchema = z.array(z.string()).optional()

/**
 * Local workspace reference (P0, architecture §15.1).
 *
 * A strict **union** of the old record and the new one: `path`/`title`/
 * `createdAt`/`serverId` stay accepted so old documents validate, but nothing
 * writes them any more — `workspaceRefs` holds only what is genuinely local.
 */
export const workspaceRecordSchema = z.object({
  id: z.string().min(1),
  targetId: z.string().min(1),
  remoteWorkspaceId: z.string().length(16).optional(),
  stubPath: z.string().min(1).optional(),
  officialWorkspaceId: z.string().min(1).optional(),
  lastOpenedAt: z.string().optional(),
  sessionId: z.string().min(1).optional(),
  /** Session ids the user pinned in this remote workspace, most recent first. */
  pinnedSessions: sessionFlagSchema,
  /** Session ids the user archived in this remote workspace. */
  archivedSessions: sessionFlagSchema,
  // ── legacy P0 fields: read-only, cleared by the startup migration ──────────
  path: z.string().startsWith('/').optional(),
  title: z.string().min(1).optional(),
  createdAt: z.string().min(1).optional(),
  serverId: z.string().min(1).optional(),
}).strict()

/** Create-time payload for a target; the id and fingerprint are assigned by the caller. */
export const targetDraftSchema = z.object({
  label: z.string().min(1).max(64),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535).default(22),
  username: z.string().min(1),
  authKind: z.enum(['password', 'privateKey', 'agent']).default('agent'),
  /** Secret material; never persisted outside `ctx.credentials`. */
  secret: z.string().optional(),
  privateKeyPath: z.string().min(1).optional(),
  sshConfigAlias: z.string().min(1).optional(),
  packageSource: packageSourceSchema.optional(),
  remote: runtimeSchema.partial().optional(),
}).strict()

/** A target as the browser may see it: no secret, no key material, no credential reference. */
export interface PublicTarget {
  readonly id: string
  readonly label: string
  readonly kind: RemoteTargetKind
  readonly host: string
  readonly port: number
  readonly username: string
  readonly authKind: RemoteAuthKind
  readonly hasStoredSecret: boolean
  readonly hostKeyFingerprint: string
  readonly sshConfigAlias?: string
  /** `wsl` targets: the distribution and its optional user, for the row/labels. */
  readonly wslDistro?: string
  readonly wslUser?: string
  readonly packageSource?: RemotePackageSource
  /** Last reuse launcher, so the wizard can preselect it (`doc/api-contract.md` §5). */
  readonly reuseDsh?: RemoteReuseDshRecord
  /** Last probed architecture (the wizard's upload badge). */
  readonly platformProbe?: RemotePlatformProbeRecord
  /** The server package last deployed (badge/troubleshooting; holds no credential). */
  readonly serverPackage?: RemoteServerPackageRecord
  /** v1 additive state (all optional; see `RemoteTargetRecord`). */
  readonly clientId?: string
  readonly executor?: 'server' | 'local'
  /** Explicit model source; absent means "derive from the executor for display". */
  readonly modelSource?: 'local' | 'server'
  readonly profileName?: string
  readonly profilePort?: number
  readonly runtimeKind?: 'isolated' | 'global'
  readonly runtimeDir?: string
  readonly pluginVersion?: string
  readonly serverDshVersion?: string
  readonly remote: RemoteRuntimeRecord
  readonly status: 'unknown' | 'ready' | 'failed' | 'stopped'
  readonly lastError?: string
  readonly lastConnectedAt?: string
}

/** The plugin-wide default for obtaining the server package. */
export type PackagePolicy = 'auto' | 'download' | 'upload' | 'ask'

/** Global policy + release mirror, persisted in the domain's global slot. */
export interface PackagePolicySettings {
  readonly policy: PackagePolicy
  /** Base URL prefixed to GitHub release URLs when set (CN-reachable mirror). */
  readonly mirror: string
  /**
   * The client installation's stable id (v1 `graydovee-remote-window-<id>`).
   *
   * Additive optional on the domain global: an old document without it still
   * validates and is upgraded in place on the first `ensureClientId()`.
   */
  readonly clientId?: string
  /**
   * The client-local model endpoint settings (additive optional).
   *
   * Kept in the same global slot as the package policy so the storage domain
   * stays at version 1; every writer must preserve the other fields.
   */
  readonly localLlm?: LocalLlmSettings
}

/**
 * The target's effective model source.
 *
 * An explicit `modelSource` always wins. Otherwise a server-executor target
 * keeps its model on the server; every other target's models are the client's
 * own (local mode runs the agent locally, so its models are local by
 * definition). This is what the UI reports; the connect flow only forwards
 * models when `modelSource === 'local'` is explicit or persisted.
 * @param record - the stored target fields that decide the source.
 */
export function effectiveModelSource(record: {
  readonly modelSource?: 'local' | 'server'
  readonly executor?: 'server' | 'local'
}): 'local' | 'server' {
  return record.modelSource ?? (record.executor === 'server' ? 'server' : 'local')
}

/** Strip everything the browser must not see from a stored target. */
export function toPublicTarget(record: RemoteTargetRecord): PublicTarget {
  return {
    id: record.id,
    label: record.label,
    kind: record.kind,
    host: record.host,
    port: record.port,
    username: record.username,
    authKind: record.authKind,
    hasStoredSecret: record.credentialKey !== undefined,
    hostKeyFingerprint: record.hostKeyFingerprint,
    ...(record.sshConfigAlias === undefined ? {} : { sshConfigAlias: record.sshConfigAlias }),
    ...(record.wslDistro === undefined ? {} : { wslDistro: record.wslDistro }),
    ...(record.wslUser === undefined ? {} : { wslUser: record.wslUser }),
    ...(record.packageSource === undefined ? {} : { packageSource: record.packageSource }),
    ...(record.reuseDsh === undefined ? {} : { reuseDsh: record.reuseDsh }),
    ...(record.platformProbe === undefined ? {} : { platformProbe: record.platformProbe }),
    ...(record.serverPackage === undefined ? {} : { serverPackage: record.serverPackage }),
    ...(record.clientId === undefined ? {} : { clientId: record.clientId }),
    ...(record.executor === undefined ? {} : { executor: record.executor }),
    ...(record.modelSource === undefined ? {} : { modelSource: record.modelSource }),
    ...(record.profileName === undefined ? {} : { profileName: record.profileName }),
    ...(record.profilePort === undefined ? {} : { profilePort: record.profilePort }),
    ...(record.runtimeKind === undefined ? {} : { runtimeKind: record.runtimeKind }),
    ...(record.runtimeDir === undefined ? {} : { runtimeDir: record.runtimeDir }),
    ...(record.pluginVersion === undefined ? {} : { pluginVersion: record.pluginVersion }),
    ...(record.serverDshVersion === undefined ? {} : { serverDshVersion: record.serverDshVersion }),
    remote: record.remote,
    status: record.status,
    ...(record.lastError === undefined ? {} : { lastError: scrubSecrets(record.lastError) }),
    ...(record.lastConnectedAt === undefined ? {} : { lastConnectedAt: record.lastConnectedAt }),
  }
}

/**
 * Remove values that look like credentials from free text.
 *
 * Applied to every error string, log line and HTTP/SSE payload the plugin emits,
 * so a rejected SSH attempt cannot echo a password into the UI or a session log.
 */
export function scrubSecrets(text: string): string {
  return text
    .replace(/(password|passphrase|secret|token)(\s*[=:]\s*)\S+/gi, '$1$2***')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted private key]')
    .replace(/(?:^|\s)(?:ssh-rsa|ssh-ed25519|ecdsa-sha2-\S+)\s+[A-Za-z0-9+/=]{16,}/g, ' [redacted public key]')
}

/** Replace every occurrence of a known secret value; used where the value is available. */
export function redactValues(text: string, secrets: readonly string[]): string {
  let output = scrubSecrets(text)
  for (const secret of secrets) {
    if (secret.length === 0) continue
    output = output.split(secret).join('***')
  }
  return output
}
