/**
 * The **two-stage join** that produces the remote workspace rows.
 *
 * P0 (architecture §7.1/§7.5): the server owns the workspace list
 * (`path`/`title`/`createdAt`/`sessionCount`/`updatedAt`), and this plugin's
 * store only keeps a **local reference** per materialized workspace
 * (`stubPath`/`officialWorkspaceId`/`sessionId`/pin-archive sets). Neither half
 * is renderable alone, so every row is a join:
 *
 *   server list item  ⋈  local ref     by  (targetId, remoteWorkspaceId)
 *
 * Four rules make the join honest, and each has a test:
 *
 *  1. only a **ready** target contributes rows — a connection that is down has
 *     no authoritative list, and the old local record no longer carries a
 *     `path`/`title` to fall back on (architecture §7.5);
 *  2. a **missing** `serverWorkspaces[targetId]` key means "the list could not be
 *     read" and contributes nothing; it is *not* the same as an empty array
 *     ("the server says there is no workspace"), and the UI says so differently;
 *  3. a ref without `remoteWorkspaceId`, or whose server item is gone, produces
 *     no row (pre-migration ref / deleted on the server / another client's stale
 *     view);
 *  4. order: newest activity first (`updatedAt ?? createdAt`), rows without any
 *     timestamp last, ties broken by `path` so the order is deterministic.
 *
 * Pure module (no React, no shell services) precisely so these rules are
 * unit-testable: `store.ts` imports `react`, which this repository does not
 * install.
 */
import type { PublicTarget, ServerWorkspace, WorkspaceRef } from './api.ts'

/** One renderable workspace row: the join of a server item and a local ref. */
export interface WorkspaceRow {
  /** Local ref id — the UI node key, and the id `sessions`/`sessionFlag` take. */
  readonly id: string
  readonly targetId: string
  /** Server-authoritative id (16 hex). Always present on a row. */
  readonly remoteWorkspaceId: string
  readonly path: string
  readonly title: string
  /** Old (v2) servers may omit these three; the UI renders `—`. */
  readonly createdAt?: string
  readonly sessionCount?: number
  readonly updatedAt?: string
  readonly stubPath?: string
  readonly officialWorkspaceId?: string
  readonly sessionId?: string
  readonly pinnedSessions?: string[]
  readonly archivedSessions?: string[]
  readonly lastOpenedAt?: string
}

/** Everything the join needs. */
export interface WorkspaceJoinInput {
  readonly targets: readonly PublicTarget[]
  readonly refs: readonly WorkspaceRef[]
  readonly serverWorkspaces: Readonly<Record<string, readonly ServerWorkspace[]>>
}

/**
 * What the tree may say about one target's server list.
 *
 * `unavailable` (key missing) and `empty` (key present, no items) are different
 * facts and must read differently in the UI.
 */
export type ServerListState = 'unavailable' | 'empty' | 'rows'

/**
 * Classify one target's server list.
 * @param serverWorkspaces - the `/api/state` map.
 * @param targetId - the target to look at.
 * @returns `unavailable` when the key is absent, else `empty` or `rows`.
 */
export function serverListState(
  serverWorkspaces: Readonly<Record<string, readonly ServerWorkspace[]>>,
  targetId: string,
): ServerListState {
  const list = serverWorkspaces[targetId]
  if (list === undefined) return 'unavailable'
  return list.length === 0 ? 'empty' : 'rows'
}

/** Sort key: newest known timestamp first; missing timestamps sink. */
function activityOf(item: { updatedAt?: string; createdAt?: string }): number | undefined {
  for (const value of [item.updatedAt, item.createdAt]) {
    if (value === undefined || value === '') continue
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return undefined
}

/**
 * Join one target's server list with its local refs.
 * @param target - the target (only `ready` ones take part).
 * @param refs - all local refs (filtered by target inside).
 * @param list - that target's server list, or undefined when unreadable.
 * @returns the rows of this target, in display order.
 */
function joinTarget(
  target: PublicTarget,
  refs: readonly WorkspaceRef[],
  list: readonly ServerWorkspace[] | undefined,
): WorkspaceRow[] {
  if (target.status !== 'ready' || list === undefined) return []
  const byRemoteId = new Map<string, ServerWorkspace>()
  for (const item of list) byRemoteId.set(item.id, item)
  const rows: WorkspaceRow[] = []
  for (const ref of refs) {
    if (ref.targetId !== target.id) continue
    const remoteWorkspaceId = ref.remoteWorkspaceId
    if (remoteWorkspaceId === undefined || remoteWorkspaceId === '') continue
    const item = byRemoteId.get(remoteWorkspaceId)
    if (item === undefined) continue
    rows.push({
      id: ref.id,
      targetId: ref.targetId,
      remoteWorkspaceId,
      path: item.path,
      title: item.title,
      ...(item.createdAt === undefined ? {} : { createdAt: item.createdAt }),
      ...(item.sessionCount === undefined ? {} : { sessionCount: item.sessionCount }),
      ...(item.updatedAt === undefined ? {} : { updatedAt: item.updatedAt }),
      ...(ref.stubPath === undefined ? {} : { stubPath: ref.stubPath }),
      ...(ref.officialWorkspaceId === undefined ? {} : { officialWorkspaceId: ref.officialWorkspaceId }),
      ...(ref.sessionId === undefined ? {} : { sessionId: ref.sessionId }),
      ...(ref.pinnedSessions === undefined ? {} : { pinnedSessions: ref.pinnedSessions }),
      ...(ref.archivedSessions === undefined ? {} : { archivedSessions: ref.archivedSessions }),
      ...(ref.lastOpenedAt === undefined ? {} : { lastOpenedAt: ref.lastOpenedAt }),
    })
  }
  return rows.sort(compareRows)
}

/** Newest activity first; no-timestamp rows last; ties by path then ref id. */
function compareRows(left: WorkspaceRow, right: WorkspaceRow): number {
  const leftAt = activityOf(left)
  const rightAt = activityOf(right)
  if (leftAt !== rightAt) {
    if (leftAt === undefined) return 1
    if (rightAt === undefined) return -1
    return rightAt - leftAt
  }
  const byPath = left.path.localeCompare(right.path)
  return byPath !== 0 ? byPath : left.id.localeCompare(right.id)
}

/**
 * Every renderable workspace row, grouped implicitly by `targetId`.
 * @param input - targets, local refs and the per-target server lists.
 * @returns the rows, ordered per {@link compareRows}.
 */
export function joinWorkspaces(input: WorkspaceJoinInput): WorkspaceRow[] {
  const rows: WorkspaceRow[] = []
  for (const target of input.targets) {
    rows.push(...joinTarget(target, input.refs, input.serverWorkspaces[target.id]))
  }
  return rows
}
