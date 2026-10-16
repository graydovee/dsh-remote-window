/**
 * Per-target agent preset: the isolated execution world.
 *
 * The preset is one `cordis:group` carrying an `isolate` realm for every service
 * its rows *provide* (`ssh`, `fs`, `subprocess`, `sandbox`, `shell`). Isolation
 * is mandatory, not cosmetic: `mountPreset` rejects a preset whose rows publish
 * services into the host realm ("Preset services require isolate realms"), and a
 * mount failure is permanent for that preset. With the realm in place the official
 * SSH providers replace the local execution world for this session only, while
 * the host plane keeps `sandboxPolicy`, the model client, credentials and the UI.
 */
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type { RemoteTargetRecord } from '../targets/types.ts'

/** Preset ids are namespaced so a target's world can never collide with a shipped preset. */
export const REMOTE_PRESET_PREFIX = 'remote:'

/** The preset id that serves one target. */
export function remotePresetId(targetId: string): string {
  return `${REMOTE_PRESET_PREFIX}${targetId}`
}

/**
 * Build the preset definition for one target.
 * @param target - the stored target record.
 * @returns a definition ready for `ctx.agentPresets.register`.
 */
export function remotePresetDefinition(target: RemoteTargetRecord): PresetDefinition {
  const id = remotePresetId(target.id);
  return {
    id,
    name: `Remote: ${target.label}`,
    description: `Execution world on ${target.username}@${target.host}:${target.port}; models and credentials stay local.`,
    // After the shipped presets, so the picker keeps its usual default.
    order: 90,
    plugins: [
      {
        id: `remote-world`,
        name: 'cordis:group',
        group: true,
        isolate: {
          ssh: true,
          fs: true,
          subprocess: true,
          sandbox: true,
          shell: true,
        },
        config: [
          {
            id: 'connection',
            name: 'dsh-remote-workspace/connection',
            config: { targetId: target.id, label: target.label },
          },
          // Official providers, unmodified: they only talk to `ctx.ssh`.
          { id: 'fs-ssh', name: '@deepseek-ai/dsh-fs-ssh' },
          { id: 'subprocess-ssh', name: '@deepseek-ai/dsh-subprocess-ssh' },
          { id: 'sandbox-ssh', name: '@deepseek-ai/dsh-sandbox-ssh' },
          // The shell provider closes the loop for the bash tool: it confines
          // argv through the realm's sandbox and runs it through the realm's
          // subprocess, so every command executes on the remote host.
          { id: 'bash-sandbox', name: '@deepseek-ai/dsh-bash-sandbox', config: { timeoutMs: 60_000 } },
          { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
          { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
          { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
        ],
      },
    ],
  }
}
