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

/** Resource kind. WSL and container targets are reserved for a later version. */
export type RemoteTargetKind = 'ssh'

/** Non-secret target record persisted in the profile's storage domain. */
export interface RemoteTargetRecord {
  readonly id: string
  /** The user-visible alias; required, saved on a successful connection. */
  readonly label: string
  readonly kind: RemoteTargetKind
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
   */
  readonly hostKeyFingerprint: string
  /** `~/.ssh/config` alias this target was prefilled from, when any. */
  readonly sshConfigAlias?: string
  /** How to obtain the server package: `auto` follows the global policy. */
  readonly packageSource?: 'auto' | 'download' | 'upload'
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

/** One remote workspace: a directory on a target, not a local directory. */
export interface RemoteWorkspaceRecord {
  readonly id: string
  readonly targetId: string
  /** Absolute POSIX path on the target. */
  readonly path: string
  /**
   * Local stub directory anchoring this remote path in the shell's workspace
   * tree (official workspaces are local-realpath'd; a remote path never can
   * be). Absent on records created before stubs existed.
   */
  readonly stubPath?: string
  /** The official workspace id the stub is registered under, when known. */
  readonly officialWorkspaceId?: string
  readonly title: string
  readonly createdAt: string
  readonly lastOpenedAt?: string
  /** Session created for this workspace, when one exists. */
  readonly sessionId?: string
  /** Stable workspace identity returned by the remote server. */
  readonly remoteWorkspaceId?: string
  readonly serverId?: string
}

/** One protocol channel to a remote server. */
export interface RemoteChannel {
  readonly input: Readable
  readonly output: Writable
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
export interface RemoteWorkspaceService {
  /** Open (starting it when necessary) a protocol channel to one target. */
  connectChannel(targetId: string, signal?: AbortSignal): Promise<RemoteChannel>
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
export const packageSourceSchema = z.enum(['auto', 'download', 'upload'])

/** The domain global slot's schema (global default policy + release mirror). */
export const packagePolicySettingsSchema = z.object({
  policy: z.enum(['auto', 'download', 'upload', 'ask']),
  mirror: z.string(),
}).strict()

/** Stored target record; unknown fields from a newer version are dropped loudly. */
export const targetRecordSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.literal('ssh'),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  username: z.string().min(1),
  authKind: z.enum(['password', 'privateKey', 'agent']),
  credentialKey: z.string().optional(),
  privateKeyPath: z.string().min(1).optional(),
  hostKeyFingerprint: z.string().regex(/^(?:|SHA256:[A-Za-z0-9+/=]+)$/),
  sshConfigAlias: z.string().min(1).optional(),
  packageSource: packageSourceSchema.optional(),
  stubPath: z.string().min(1).optional(),
  officialWorkspaceId: z.string().min(1).optional(),
  remote: runtimeSchema,
  status: z.enum(['unknown', 'ready', 'failed', 'stopped']),
  lastError: z.string().optional(),
  lastConnectedAt: z.string().optional(),
  createdAt: z.string().min(1),
}).strict()

/** Stored remote workspace record. */
export const workspaceRecordSchema = z.object({
  id: z.string().min(1),
  targetId: z.string().min(1),
  path: z.string().startsWith('/'),
  stubPath: z.string().min(1).optional(),
  officialWorkspaceId: z.string().min(1).optional(),
  title: z.string().min(1),
  createdAt: z.string().min(1),
  lastOpenedAt: z.string().optional(),
  sessionId: z.string().min(1).optional(),
  remoteWorkspaceId: z.string().length(16).optional(),
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
  readonly packageSource?: 'auto' | 'download' | 'upload'
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
    ...(record.packageSource === undefined ? {} : { packageSource: record.packageSource }),
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
