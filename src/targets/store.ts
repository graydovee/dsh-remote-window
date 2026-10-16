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
  type PackagePolicySettings,
  type RemoteTargetRecord,
  type RemoteWorkspaceRecord,
} from './types.ts'

/** Smallest credential scope/id segments `ctx.credentials` accepts. */
const CREDENTIAL_SCOPE = 'remote-workspace'
/** Storage domains reject hyphens; the plugin name cannot be reused here. */
export const REMOTE_DOMAIN_NAME = 'dsh_remote_workspace'

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

  /** Replace the global package-source policy. */
  async setPackagePolicy(settings: PackagePolicySettings): Promise<void> {
    await this.require().global.set(packagePolicySettingsSchema.parse(settings))
  }

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

  /** Every stored remote workspace, optionally for one target. */
  listWorkspaces(targetId?: string): RemoteWorkspaceRecord[] {
    return [...this.workspaces().entries()]
      .map(([, value]) => value)
      .filter(record => targetId === undefined || record.targetId === targetId)
      .sort((left, right) => (right.lastOpenedAt ?? right.createdAt).localeCompare(left.lastOpenedAt ?? left.createdAt))
  }

  /** One workspace, or undefined. */
  workspace(id: string): RemoteWorkspaceRecord | undefined {
    return this.workspaces().get(id)
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

