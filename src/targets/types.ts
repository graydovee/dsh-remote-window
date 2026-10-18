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
  /** Remote runtime coordinates. */
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

/** The domain global slot's schema (global default policy + release mirror). */
export const packagePolicySettingsSchema = z.object({
  policy: z.enum(['auto', 'download', 'upload', 'ask']),
  mirror: z.string(),
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
