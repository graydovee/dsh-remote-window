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
 * The preset id for one *workspace-scoped* composition: same world, plus the
 * remote-session persistence row bound to one workspace id. A fresh id per
 * workspace keeps `presets.register` replace-per-id semantics intact.
 */
export function remoteWorkspacePresetId(targetId: string, workspaceId: string): string {
  return `${REMOTE_PRESET_PREFIX}${targetId}:${workspaceId}`
}

/**
 * Build the preset definition for one target.
 * @param target - the stored target record.
 * @returns a definition ready for `ctx.agentPresets.register`.
 */
export function remotePresetDefinition(target: RemoteTargetRecord, workspaceId?: string): PresetDefinition {
  // The workspace-scoped variant MUST carry its own id: registering the target
  // id twice is a duplicate, and resolving the workspace id against a roster
  // that only has the target preset fails with agent-preset/not-found.
  const id = workspaceId === undefined ? remotePresetId(target.id) : remoteWorkspacePresetId(target.id, workspaceId);
  return {
    id,
    name: workspaceId === undefined ? `Remote: ${target.label}` : `Remote: ${target.label} · ${workspaceId.slice(0, 6)}`,
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
          // The persistence row provides 'sessionPersistence' inside the realm;
          // isolation is what makes that provide legal next to the root
          // context's official JSONL backend (cordis throws on a same-name
          // provide that resolves to another realm's registration).
          sessionPersistence: true,
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
          // Workspace-scoped only: the session persistence provider whose
          // authoritative log lives on the remote server. It is a realm row —
          // the same mechanism the official providers use — because the agent
          // loop resolves `sessionPersistence` through its preset mount; a
          // provider installed from `setup` on the agent scope never enters
          // that resolution path.
          ...(workspaceId === undefined ? [] : [{
            id: 'remote-persistence',
            name: 'dsh-remote-workspace/rsession',
            config: { workspaceId },
          }]),
        ],
      },
    ],
  }
}
