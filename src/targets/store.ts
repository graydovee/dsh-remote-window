/**
 * Plugin-owned persistence for remote targets and remote workspaces.
 *
 * Records live in this profile's storage domain (host plane, invisible to the
 * model and to any session log), and the only secret a record ever holds is a
 * reference into `ctx.credentials`. Every value handed to a caller, a log line
 * or an HTTP response goes through the redaction helpers in `types.ts`.
 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey, type CredentialKey } from '@deepseek-ai/dsh-credentials'
import { defineDomain, domainTable, type Domain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  packagePolicySettingsSchema,
  targetRecordSchema,
  workspaceRecordSchema,
  type LocalLlmSettings,
  type PackagePolicySettings,
  type RemoteTargetRecord,
  type RemoteWorkspaceRecord,
} from './types.ts'
import { generateClientId, isClientId } from './client-id.ts'

/** Smallest credential scope/id segments `ctx.credentials` accepts. */
const CREDENTIAL_SCOPE = 'remote-workspace'
/** Storage domains reject hyphens; the plugin name cannot be reused here. */
export const REMOTE_DOMAIN_NAME = 'dsh_remote_workspace'
/**
 * Credential id for the client-local model endpoint's API key.
 *
 * Fixed (not per target): the endpoint is a property of this client host, and
 * one key serves every target whose model source is `local`.
 */
export const LOCAL_LLM_CREDENTIAL_ID = 'client-local-llm'

/** The credential key (`remote-workspace/client-local-llm`) of the local model key. */
export function localLlmCredentialKey(): CredentialKey {
  return credentialKey(CREDENTIAL_SCOPE, LOCAL_LLM_CREDENTIAL_ID)
}

/**
 * One domain holds both tables plus the package-policy global.
 *
 * Version stays 1 on purpose: the backend's single-file layout has no version
 * migration (a stored unit stamped 1 hard-fails to open against a spec
 * declaring 2, `compatibleVersions` notwithstanding), and every field this
 * plugin has ever added to the record schemas is optional — old documents
 * validate under the current schemas unchanged. Additive evolution only.
 */
export const REMOTE_DOMAIN = defineDomain({
  name: REMOTE_DOMAIN_NAME,
  version: 1,
  global: {
    schema: packagePolicySettingsSchema,
    initial: { policy: 'auto', mirror: '' } satisfies PackagePolicySettings,
  },
  tables: {
    targets: domainTable(targetRecordSchema),
    workspaces: domainTable(workspaceRecordSchema),
  },
})

/** Thin, typed facade over the storage domain and the credential seam. */
export class TargetStore {
  private domain: Domain<typeof REMOTE_DOMAIN> | undefined

  constructor(private readonly ctx: Context) {}

  /** Open the domain; call once during plugin startup. */
  async open(): Promise<void> {
    // Idempotent: the storage domain throws 'already open' on a second open,
    // and more than one caller (startup self-check included) may race here.
    if (this.domain !== undefined) return
    this.domain = await this.ctx.storageDomain.open(REMOTE_DOMAIN)
  }

  /** Close the domain; registration and unloading are the plugin's responsibility. */
  async close(): Promise<void> {
    const domain = this.domain
    this.domain = undefined
    await domain?.close()
  }

  private require(): Domain<typeof REMOTE_DOMAIN> {
    if (this.domain === undefined) throw new Error('remote workspace storage is not open')
    return this.domain
  }

  /** The whole domain global slot (policy, mirror, clientId, local model settings). */
  globalSettings(): PackagePolicySettings {
    return this.require().global.get() as PackagePolicySettings
  }

  /** The stored client-local model endpoint settings, when configured. */
  localLlmSettings(): LocalLlmSettings | undefined {
    return this.globalSettings().localLlm
  }

  /**
   * Persist or clear the client-local model endpoint settings.
   *
   * The global slot also carries the package policy and the clientId; a write
   * must never drop them (a lost clientId would orphan the server profile).
   * @param settings - validated settings, or undefined to clear.
   */
  async setLocalLlmSettings(settings: LocalLlmSettings | undefined): Promise<void> {
    const current = this.globalSettings()
    const { localLlm: _previous, ...rest } = current
    const next = settings === undefined ? rest : { ...rest, localLlm: settings }
    await this.require().global.set(packagePolicySettingsSchema.parse(next))
  }

  /** Read the stored client-local model API key, if one is configured. */
  async localLlmKey(): Promise<string | undefined> {
    try {
      const stored = await this.ctx.credentials.readRecord(localLlmCredentialKey())
      if (stored === undefined || stored.kind !== 'api-key') return undefined
      return stored.key === undefined || stored.key === '' ? undefined : stored.key
    } catch {
      // An unreadable credential store is "no key" for read paths; the probe
      // then reports `local-llm-unauthorized` when the endpoint needs one.
      return undefined
    }
  }

  /**
   * Store (or clear) the client-local model API key.
   * @param key - the secret; an empty value removes the stored record.
   */
  async storeLocalLlmKey(key: string): Promise<void> {
    if (key === '') {
      await this.forgetLocalLlmKey()
      return
    }
    await this.ctx.credentials.modifyRecord(localLlmCredentialKey(), async () => ({ kind: 'api-key', key }))
  }

  /** Remove the stored client-local model API key (absent is a no-op). */
  async forgetLocalLlmKey(): Promise<void> {
    await this.ctx.credentials.deleteRecord(localLlmCredentialKey())
  }

  private targets(): KvTable<string, RemoteTargetRecord> {
    return this.require().table('targets') as unknown as KvTable<string, RemoteTargetRecord>
  }

  private workspaces(): KvTable<string, RemoteWorkspaceRecord> {
    return this.require().table('workspaces') as unknown as KvTable<string, RemoteWorkspaceRecord>
  }

  /** The plugin-wide package-source policy and release mirror. */
  packagePolicy(): PackagePolicySettings {
    return this.require().global.get()
  }

  /**
   * Replace the global package-source policy.
   *
   * The clientId lives in the same global slot (additive optional) and must not
   * be dropped by a policy write: a lost clientId would orphan the server's
   * per-client profile on the next connect.
   */
  async setPackagePolicy(settings: PackagePolicySettings): Promise<void> {
    const current = this.globalSettings()
    await this.require().global.set(packagePolicySettingsSchema.parse({
      ...settings,
      ...(settings.clientId === undefined && current.clientId !== undefined ? { clientId: current.clientId } : {}),
      ...(settings.localLlm === undefined && current.localLlm !== undefined ? { localLlm: current.localLlm } : {}),
    }))
  }

  /** The persisted v1 client id, when one has been generated. */
  clientId(): string | undefined {
    const value = (this.require().global.get() as PackagePolicySettings).clientId
    return value !== undefined && isClientId(value) ? value : undefined
  }

  /**
   * Read or lazily generate the installation's client id.
   *
   * The id is stable for the life of this storage domain (and therefore this
   * client installation); every concurrent caller shares one write. A stored
   * malformed value is treated as absent and replaced rather than trusted: the
   * id names a server profile and must be path-safe.
   */
  async ensureClientId(): Promise<string> {
    const existing = this.clientId()
    if (existing !== undefined) return existing
    this.clientIdAttempt ??= (async () => {
      const current = this.require().global.get() as PackagePolicySettings
      const generated = generateClientId()
      await this.require().global.set(packagePolicySettingsSchema.parse({ ...current, clientId: generated }))
      return generated
    })()
    try {
      return await this.clientIdAttempt
    } finally {
      this.clientIdAttempt = undefined
    }
  }

  /** The in-flight clientId write, so two first-callers cannot generate two ids. */
  private clientIdAttempt: Promise<string> | undefined

  /** Every stored target, oldest first. */
  listTargets(): RemoteTargetRecord[] {
    return [...this.targets().entries()].map(([, value]) => value).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  /** One target, or undefined. */
  target(id: string): RemoteTargetRecord | undefined {
    return this.targets().get(id)
  }

  /** Insert or replace a target record. */
  async putTarget(record: RemoteTargetRecord): Promise<void> {
    await this.targets().put(record.id, targetRecordSchema.parse(record))
  }

  /** Atomically update a target. */
  async updateTarget(id: string, mutate: (current: RemoteTargetRecord) => RemoteTargetRecord): Promise<RemoteTargetRecord> {
    return await this.targets().update(id, current => targetRecordSchema.parse(mutate(current)))
  }

  /** Forget a target and its stored secret. */
  async deleteTarget(id: string): Promise<void> {
    const record = this.target(id)
    if (record !== undefined) await this.forgetSecret(record)
    await this.targets().delete(id)
  }

  /** Every stored remote workspace ref, newest activity first. */
  listWorkspaces(targetId?: string): RemoteWorkspaceRecord[] {
    return [...this.workspaces().entries()]
      .map(([, value]) => value)
      .filter(record => targetId === undefined || record.targetId === targetId)
      // `createdAt` is a legacy P0 field (the server owns path/title/createdAt now),
      // so the order falls back to the local activity stamp and finally the id —
      // a missing key must never make the order unstable.
      .sort((left, right) => (right.lastOpenedAt ?? right.createdAt ?? right.id).localeCompare(left.lastOpenedAt ?? left.createdAt ?? left.id))
  }

  /** One workspace ref by local id, or by its server workspace id (P2: both keys are legal). */
  workspace(id: string): RemoteWorkspaceRecord | undefined {
    const direct = this.workspaces().get(id)
    if (direct !== undefined) return direct
    return [...this.workspaces().entries()].map(([, value]) => value).find(record => record.remoteWorkspaceId === id)
  }

  /** Insert or replace a workspace record. */
  async putWorkspace(record: RemoteWorkspaceRecord): Promise<void> {
    await this.workspaces().put(record.id, workspaceRecordSchema.parse(record))
  }

  /** Atomically update a workspace. */
  async updateWorkspace(id: string, mutate: (current: RemoteWorkspaceRecord) => RemoteWorkspaceRecord): Promise<RemoteWorkspaceRecord> {
    return await this.workspaces().update(id, current => workspaceRecordSchema.parse(mutate(current)))
  }

  /** Forget a workspace record. */
  async deleteWorkspace(id: string): Promise<boolean> {
    return await this.workspaces().delete(id)
  }

  /** The credential key for one target's secret, or undefined when it has none. */
  credentialKeyOf(record: RemoteTargetRecord): CredentialKey | undefined {
    return record.credentialKey === undefined ? undefined : credentialKey(CREDENTIAL_SCOPE, record.id)
  }

  /**
   * Store a target's secret.
   * @param record - target record to extend.
   * @param secret - password, key passphrase or token; an empty value clears it.
   * @returns the record with its credential reference set or cleared.
   */
  async storeSecret(record: RemoteTargetRecord, secret: string): Promise<RemoteTargetRecord> {
    const key = credentialKey(CREDENTIAL_SCOPE, record.id)
    if (secret === '') {
      await this.ctx.credentials.deleteRecord(key)
      const { credentialKey: _cleared, ...rest } = record
      return rest as RemoteTargetRecord
    }
    await this.ctx.credentials.modifyRecord(key, async () => ({ kind: 'api-key', key: secret }))
    return { ...record, credentialKey: key }
  }

  /**
   * Read a target's secret, if one is stored and still configured.
   * @param record - target record.
   * @returns the secret value, or undefined.
   */
  async secretOf(record: RemoteTargetRecord): Promise<string | undefined> {
    const key = this.credentialKeyOf(record)
    if (key === undefined) return undefined
    const stored = await this.ctx.credentials.readRecord(key)
    if (stored === undefined || stored.kind !== 'api-key') return undefined
    return stored.key === undefined || stored.key === '' ? undefined : stored.key
  }

  /** Remove any stored secret for a target. */
  async forgetSecret(record: RemoteTargetRecord): Promise<void> {
    const key = this.credentialKeyOf(record)
    if (key !== undefined) await this.ctx.credentials.deleteRecord(key)
  }
}

