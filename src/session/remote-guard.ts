/**
 * Fail-closed guard for local-mode sessions whose cwd is a private anchor.
 *
 * v1 local mode binds a server session to a plugin-private anchor
 * (`<DSH_HOME>/remote-workspaces/<clientId>/<targetId>/<hash>`); the anchor is
 * **not** a workspace and must never be composed with an execution world other
 * than that target's remote preset. This module is the synchronous
 * `session/created` veto:
 *
 * - an anchor cwd must carry exactly `remote:<targetId>`;
 * - a `remote:*` preset on any other cwd is rejected too (a remote execution
 *   world mounted on a local workspace runs tools on the wrong machine).
 *
 * The legacy visible-stub layout (`<DSH_HOME>/remote-workspaces/<targetId>/…`)
 * is retired with the old stdio architecture; those stubs are cleaned by the
 * migration sweep instead of being attachable here.
 */
import { homedir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { remotePresetId, REMOTE_PRESET_PREFIX } from '../preset/world.ts'

/**
 * Root of the private local anchors.
 *
 * It must follow `DSH_HOME`: a profile with a non-default home (clean debug
 * instance, QA client instance) keeps its anchors under that home.
 * @param env - environment used for the fallback, injectable for tests.
 */
export function remoteAnchorRoot(env: Record<string, string | undefined> = process.env): string {
  const configured = env['DSH_HOME']?.trim()
  return join(configured !== undefined && configured !== '' ? configured : join(homedir(), '.dsh'), 'remote-workspaces')
}

/**
 * Resolve the target id from a local-mode anchor cwd.
 *
 * v1 anchors are `<root>/<clientId>/<targetId>/<hash>`; the target id keeps its
 * `rt-` prefix. Anything shallower (the retired visible stub layout) or outside
 * the root is not an anchor.
 * @param cwd - session header cwd; absent/blank is never an anchor.
 * @returns the target id, or undefined for a non-anchor cwd.
 */
export function remoteTargetIdForCwd(cwd: string | undefined, env: Record<string, string | undefined> = process.env): string | undefined {
  if (cwd === undefined || cwd === '') return undefined
  const root = remoteAnchorRoot(env)
  const rel = relative(root, cwd)
  if (rel === '' || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) return undefined
  const segments = rel.split(sep)
  if (segments.length < 3) return undefined
  const targetId = segments[1]
  return targetId !== undefined && targetId.startsWith('rt-') ? targetId : undefined
}

/** The session-header fields the guard reads. */
export interface RemoteSessionHeaderLike {
  readonly cwd?: string
  readonly agentPreset?: string
}

/**
 * Refuse a session under a private anchor that would compose any execution
 * world other than that target's remote preset.
 *
 * Called from the synchronous `session/created` boundary: a throw vetoes and
 * rolls back publication. It also catches a preset chosen before the UI's
 * fixed remote chip mounted, a cross-target preset, or a resumed session whose
 * durable header names another client's target id.
 * @param header - the session header about to be published.
 */
export function assertRemoteSessionPreset(header: RemoteSessionHeaderLike): void {
  const targetId = remoteTargetIdForCwd(header.cwd)
  if (targetId === undefined) {
    // The inverse shape is just as wrong: a remote execution world mounted on
    // an ordinary local workspace would run its tools remotely while the cwd
    // stays local. Reject it instead of letting the preset picker leak one.
    if (header.agentPreset?.startsWith(REMOTE_PRESET_PREFIX) === true) {
      throw new Error(
        `agent preset "${header.agentPreset}" is only valid for a remote workspace anchor; `
        + `got cwd "${header.cwd ?? ''}". Refusing to run a remote execution world on a local workspace.`,
      )
    }
    return
  }
  const expected = remotePresetId(targetId)
  if (header.agentPreset === expected) return
  throw new Error(
    `remote workspace "${targetId}" requires agent preset "${expected}"; `
    + `got "${header.agentPreset ?? ''}". Refusing to create or resume a session that would run outside the remote execution world.`,
  )
}
