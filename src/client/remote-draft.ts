/**
 * The remote draft's target, for the hero agent-preset seat.
 *
 * The remote world is fixed by the workspace's target, not chosen as a "mode".
 * Keeping this lookup pure makes the slot-registration sync and the chip
 * component use exactly the same rule.
 */
import type { AppState } from './store.ts'

/** One remote draft's fixed execution target. */
export interface RemoteDraftTarget {
  readonly targetId: string
  /** Target label shown in the fixed chip. */
  readonly label: string
}

/**
 * Resolve the target of the currently open remote draft.
 * @param state - store snapshot (only the draft/workspace/target slices are read).
 * @returns the target, or undefined when no remote draft is open.
 */
export function remoteDraftTarget(
  state: Pick<AppState, 'currentDraft' | 'workspaces' | 'targets'>,
): RemoteDraftTarget | undefined {
  const draft = state.currentDraft
  if (draft === undefined) return undefined
  const workspace = state.workspaces.find(candidate => candidate.id === draft.workspaceId)
  if (workspace === undefined) return undefined
  const target = state.targets.find(candidate => candidate.id === workspace.targetId)
  return {
    targetId: workspace.targetId,
    label: target?.label ?? workspace.title,
  }
}
