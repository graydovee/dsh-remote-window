/**
 * Pure derivations for the v1 remote tree.
 *
 * Mirrors the P1 data contract in `doc/refactor-v1-protocol.md` §5.1–§5.3:
 * the server owns workspace membership/order and the registry-global pin and
 * archive sets, while these functions turn that authority into the row models
 * the official row components consume. Nothing here touches React, the network
 * or the host API, so every rule below is unit-testable in isolation.
 *
 * Three rules matter more than the shapes:
 *
 *  1. **Server order is the order.** A workspace's rows follow
 *     `WorkspaceListValue.workspaces`; its sessions follow
 *     `WorkspaceRow.sessionIds` (the official manual order written by
 *     `session/reorder`). There is no second, client-side order — only the
 *     official pinned rows lead their section before the rest.
 *  2. **A blank session is not a row.** `blank` members are filtered out of the
 *     list; the one currently open is returned separately as the temporary
 *     「新会话」 row (`deriveWorkspaceGroups(...).draft`).
 *  3. **Search is local and instantaneous.** It filters already-derived rows and
 *     never changes order, membership or the persisted view state.
 */

/** Registry identity carried by every list read (protocol §5.1/§5.2). */
export interface RemoteRegistry {
  /** sha256 of the server's workspace.json, or `absent`. */
  readonly revision: string
  /** The profile server process's registry load generation. */
  readonly epoch: string
  /** Only `workspace/list` and handshake carry this. */
  readonly initialized?: boolean
  /** Set by a read that observed an external change (protocol §10). */
  readonly stale?: boolean
}

/** One server-authoritative workspace row (protocol §5.1). */
export interface RemoteWorkspace {
  /** Official registry uuid. */
  readonly workspaceId: string
  /** Absolute, canonical server path. */
  readonly path: string
  readonly title: string
  /** ISO-8601, as returned by the server. */
  readonly createdAt: string
  readonly updatedAt: string
  /** Official membership **and** manual order (`insertSessionBefore`). */
  readonly sessionIds: readonly string[]
}

/** `workspace/list` value (protocol §5.1). */
export interface RemoteWorkspaceList {
  readonly registry: RemoteRegistry
  /** Official display order. */
  readonly workspaces: readonly RemoteWorkspace[]
  /** Registry-global pin ids. */
  readonly pinnedSessionIds: readonly string[]
  /** Registry-global archive ids. */
  readonly archivedSessionIds: readonly string[]
}

/** One server session row (protocol §5.2). */
export interface RemoteSession {
  readonly sessionId: string
  /** Projection title; absent = unnamed (the row localizes it). */
  readonly title?: string
  /** Official blank flag: the provisional New Session row. */
  readonly blank: boolean
  /** A live agent of this profile is running the Session right now. */
  readonly running: boolean
  /** This profile process has a live agent for the Session. */
  readonly agentAvailable: boolean
  /** Server-side cwd, when the summary carries it. */
  readonly cwd?: string
  /** Epoch milliseconds, from the official summary. */
  readonly updatedAt: number
  readonly parentSessionId?: string
  readonly origin?: 'subagent'
  readonly formatStatus?: 'current' | 'migration-required'
  /** Where the title came from (server plugin fold diagnostics, protocol §16.8). */
  readonly titleSource?: 'live' | 'projection' | 'log' | 'fallback'
  /** The session's stored execution end (M2g; absent = server record). */
  readonly executor?: 'server' | 'local'
  /** Official registry pin flag (archive and pin are mutually exclusive). */
  readonly pinned: boolean
  /** Official registry archive flag. */
  readonly archived: boolean
  /** Reverse lookup from workspace membership; absent for a stray session. */
  readonly workspaceId?: string
}

/** `session/list` value (protocol §5.2). */
export interface RemoteSessionList {
  readonly registry: RemoteRegistry
  readonly sessions: readonly RemoteSession[]
}

/** Pending interaction kinds the official session row can render. */
export type RemotePendingInteraction = 'approval' | 'plan-review' | 'question'

/** One renderable remote session row (the vendored `SessionNode` subset). */
export interface RemoteSessionNode {
  readonly id: string
  /** Empty when the server has no title (the row localizes 未命名). */
  readonly title: string
  readonly blank: boolean
  readonly running: boolean
  readonly runningSubagentCount: number
  readonly completed: boolean
  readonly pinned: boolean
  readonly archived: boolean
  readonly updatedAt: number
  readonly pendingInteraction?: RemotePendingInteraction
  /** Diagnostics for the row/UI, not part of the vendored row shape. */
  readonly agentAvailable: boolean
  readonly formatStatus?: 'current' | 'migration-required'
  readonly titleSource?: 'live' | 'projection' | 'log' | 'fallback'
  /** The session's stored execution end (M2g; absent = server record). */
  readonly executor?: 'server' | 'local'
}

/** One renderable remote workspace row. */
export interface RemoteWorkspaceNode {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
  /** ISO-8601 creation time; the tree parses it for the hover card. */
  readonly createdAt: string
  readonly updatedAt: string
  /** Authoritative membership, in official manual order. */
  readonly sessionIds: readonly string[]
  /**
   * Conversations the row shows in its trailing count.
   *
   * With a loaded session list this excludes blank/draft and subagent rows
   * (the same set the tree renders); without one it falls back to the server's
   * membership size, so the row is never blank just because the lazy list has
   * not arrived yet.
   */
  readonly sessionCount: number
}

/** One workspace's derived rows, including the optional temporary draft. */
export interface RemoteWorkspaceGroup {
  readonly workspace: RemoteWorkspaceNode
  readonly sessions: readonly RemoteSessionNode[]
  /**
   * The blank session the client currently shows, only when it is a member of
   * this workspace. Rendered above `sessions`, never counted, never sorted.
   */
  readonly draft?: RemoteSessionNode
}

/** Visibility choices for the derived session list. */
export interface RemoteSessionVisibility {
  /** Include archived sessions (shown grayed but in place). Default true. */
  readonly includeArchived?: boolean
}

/** Count/derive options shared by the row helpers. */
export interface RemoteGroupOptions extends RemoteSessionVisibility {
  /** Session id the client currently shows, for the temporary draft row. */
  readonly currentSessionId?: string
}

/** Whether one server row is a visible conversation (not a draft/subagent). */
function isConversation(session: RemoteSession, options: RemoteSessionVisibility): boolean {
  if (session.origin === 'subagent') return false
  if (session.blank) return false
  if (session.archived && options.includeArchived === false) return false
  return true
}

/** Build the vendored-row model from one server session row. */
function sessionNode(session: RemoteSession): RemoteSessionNode {
  return {
    id: session.sessionId,
    title: session.title ?? '',
    blank: session.blank,
    running: session.running,
    // The P1 contract carries no subagent catalog; v1 rows show no child count.
    runningSubagentCount: 0,
    // Completion reminders are local UI state the remote contract does not
    // expose; a remote row never claims "finished, unread".
    completed: false,
    // The official row treats pinned and archived as mutually exclusive.
    pinned: session.pinned && !session.archived,
    archived: session.archived,
    updatedAt: session.updatedAt,
    ...(session.formatStatus === undefined ? {} : { formatStatus: session.formatStatus }),
    ...(session.titleSource === undefined ? {} : { titleSource: session.titleSource }),
    ...(session.executor === undefined ? {} : { executor: session.executor }),
    agentAvailable: session.agentAvailable,
  }
}

/**
 * The one blank session a workspace may show as the temporary 「新会话」 row.
 *
 * Returns nothing for a blank session the client is not currently showing, so
 * the row only exists while its conversation is on screen; a stored blank that
 * is not selected is not a row.
 * @param workspace - the workspace whose members are inspected.
 * @param sessionsById - the loaded session list, keyed by id.
 * @param currentSessionId - the session the client currently shows.
 * @returns the draft row, or undefined when no selected blank belongs here.
 */
export function currentBlankSession(
  workspace: RemoteWorkspace,
  sessionsById: ReadonlyMap<string, RemoteSession>,
  currentSessionId: string | undefined,
): RemoteSessionNode | undefined {
  if (currentSessionId === undefined || currentSessionId === '') return undefined
  if (!workspace.sessionIds.includes(currentSessionId)) return undefined
  const session = sessionsById.get(currentSessionId)
  return session?.blank === true ? sessionNode(session) : undefined
}

/**
 * Derive one workspace's session rows in official order.
 *
 * Membership comes from `workspace.sessionIds` (not from the global session
 * list order). Missing summaries are skipped: the account list is allowed to
 * lead the per-workspace pull. Pinned, non-archived rows lead in their member
 * order; every other row (including archived rows when shown) follows in member
 * order. The current blank is not part of this list; see
 * {@link currentBlankSession}.
 * @param workspace - the server workspace row.
 * @param sessionsById - the loaded sessions, keyed by id.
 * @param options - archived visibility.
 * @returns the derived conversation rows.
 */
export function deriveSessionNodes(
  workspace: RemoteWorkspace,
  sessionsById: ReadonlyMap<string, RemoteSession>,
  options: RemoteSessionVisibility = {},
): RemoteSessionNode[] {
  const members: RemoteSession[] = []
  for (const id of workspace.sessionIds) {
    const session = sessionsById.get(id)
    if (session !== undefined && isConversation(session, options)) members.push(session)
  }
  // Official `sectionMembers` semantics: pinned rows lead, everything else
  // keeps the member order — archives keep their slots instead of sinking.
  const leading = members.filter(session => session.pinned && !session.archived)
  const rest = members.filter(session => !(session.pinned && !session.archived))
  return [...leading, ...rest].map(sessionNode)
}

/**
 * Group a full session list by workspace membership.
 * @param sessionList - the loaded sessions.
 * @returns every session indexed by its id, for the derivation helpers.
 */
export function sessionsById(list: RemoteSessionList | readonly RemoteSession[]): Map<string, RemoteSession> {
  const rows: readonly RemoteSession[] = Array.isArray(list)
    ? (list as readonly RemoteSession[])
    : (list as RemoteSessionList).sessions
  const map = new Map<string, RemoteSession>()
  for (const session of rows) map.set(session.sessionId, session)
  return map
}

/**
 * Derive every workspace row and its sessions for one connection.
 *
 * Workspaces keep the server's display order. A workspace with no loaded
 * session list still renders: its count falls back to the authoritative
 * membership size, which is the only fact the workspace row itself needs.
 * @param list - `workspace/list` value.
 * @param sessionList - `session/list` value, when the client has loaded it.
 * @param options - archived visibility and the currently shown session.
 * @returns the groups in server order.
 */
export function deriveWorkspaceGroups(
  list: RemoteWorkspaceList,
  sessionList: RemoteSessionList | readonly RemoteSession[] | undefined,
  options: RemoteGroupOptions = {},
): RemoteWorkspaceGroup[] {
  const byId = sessionList === undefined ? undefined : sessionsById(sessionList)
  const groups: RemoteWorkspaceGroup[] = []
  for (const workspace of list.workspaces) {
    const sessions = byId === undefined ? [] : deriveSessionNodes(workspace, byId, options)
    // A session may be listed under no workspace when a write by another
    // process is mid-flight; the tree only renders workspace-owned rows.
    const count = byId === undefined
      ? workspace.sessionIds.length
      : sessions.length
    const draft = byId === undefined
      ? undefined
      : currentBlankSession(workspace, byId, options.currentSessionId)
    groups.push({
      workspace: {
        workspaceId: workspace.workspaceId,
        path: workspace.path,
        title: workspace.title,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
        sessionIds: workspace.sessionIds,
        sessionCount: count,
      },
      sessions,
      ...(draft === undefined ? {} : { draft }),
    })
  }
  return groups
}

/** Result of {@link searchRemoteGroups}: which rows one query keeps. */
export interface RemoteSearchResult {
  /** Workspace ids to keep (their sessions are then decided by `sessionIds`). */
  readonly workspaceIds: ReadonlySet<string>
  /** Session ids to keep; a workspace hit keeps all of its sessions. */
  readonly sessionIds: ReadonlySet<string>
  /** Normalized query actually applied ('' = no filter). */
  readonly query: string
  /** False when nothing matches; the UI must say "no results", not "empty". */
  readonly hasMatches: boolean
}

/**
 * Filter already-derived groups by a local query.
 *
 * Matching is case-insensitive over workspace title/path and session title.
 * A workspace hit keeps every visible session under it (the user searched for
 * the workspace); a session-only hit keeps its owning workspace plus just the
 * matching sessions. The query is never sent to the server and never touches
 * order or persisted view state (protocol §5.3).
 * @param groups - the derived connection tree.
 * @param query - raw user input.
 * @returns the ids to render.
 */
export function searchRemoteGroups(
  groups: readonly RemoteWorkspaceGroup[],
  query: string,
): RemoteSearchResult {
  const needle = query.trim().toLowerCase()
  if (needle === '') {
    const workspaceIds = new Set<string>()
    const sessionIds = new Set<string>()
    for (const group of groups) {
      workspaceIds.add(group.workspace.workspaceId)
      for (const session of group.sessions) sessionIds.add(session.id)
      if (group.draft !== undefined) sessionIds.add(group.draft.id)
    }
    return { workspaceIds, sessionIds, query: '', hasMatches: groups.length > 0 }
  }
  const workspaceIds = new Set<string>()
  const sessionIds = new Set<string>()
  for (const group of groups) {
    const workspaceHit = `${group.workspace.title}\n${group.workspace.path}`.toLowerCase().includes(needle)
    if (workspaceHit) {
      workspaceIds.add(group.workspace.workspaceId)
      for (const session of group.sessions) sessionIds.add(session.id)
      if (group.draft !== undefined) sessionIds.add(group.draft.id)
      continue
    }
    const matched = group.sessions.filter(session => session.title.toLowerCase().includes(needle))
    if (matched.length === 0) continue
    workspaceIds.add(group.workspace.workspaceId)
    for (const session of matched) sessionIds.add(session.id)
  }
  return { workspaceIds, sessionIds, query: needle, hasMatches: workspaceIds.size > 0 }
}

/** Which half of a row the pointer released on (official drag contract). */
export type RemoteDropHalf = 'before' | 'after'

/** Why a drop cannot be committed; the row stays where it was. */
export type RemoteDropRejection =
  | 'not-found'
  | 'no-op'
  | 'archived-source'
  | 'pinned-mismatch'

/** The anchor an accepted drop resolves to, or the reason it was refused. */
export type RemoteDropPlan =
  | { readonly beforeId?: string }
  | { readonly reject: RemoteDropRejection }

/**
 * Resolve one same-list drop to the `before` anchor the reorder RPC takes.
 *
 * The server API is `beforeWorkspaceId` / `beforeSessionId` (protocol §4.2), so
 * dropping **after** a row means "before the next row"; dropping after the last
 * row omits the anchor (append).
 * @param order - the list's current ids, in server order.
 * @param sourceId - the dragged row.
 * @param targetId - the row the pointer released on.
 * @param half - which half of the target.
 * @returns the anchor (or an append plan), or the rejection reason.
 */
export function planRemoteDrop(
  order: readonly string[],
  sourceId: string,
  targetId: string,
  half: RemoteDropHalf,
): RemoteDropPlan {
  const sourceIndex = order.indexOf(sourceId)
  const targetIndex = order.indexOf(targetId)
  if (sourceIndex === -1 || targetIndex === -1) return { reject: 'not-found' }
  if (sourceId === targetId) return { reject: 'no-op' }
  const anchorIndex = half === 'before' ? targetIndex : targetIndex + 1
  const beforeId = order[anchorIndex]
  return beforeId === undefined ? {} : { beforeId }
}

/** One session drop's extra guards (pin blocks and archived non-draggables). */
export interface RemoteSessionDropInput {
  readonly order: readonly string[]
  readonly sourceId: string
  readonly targetId: string
  readonly half: RemoteDropHalf
  /** Registry-global pin set, used to keep drops inside one pin block. */
  readonly pinnedSessionIds: ReadonlySet<string>
  /** Registry-global archive set; archived rows never start a drag. */
  readonly archivedSessionIds: ReadonlySet<string>
}

/**
 * Resolve one session drop the official rows allow.
 *
 * Pinned rows reorder only among pinned rows and archived rows never start a
 * drag; both rules are inherited from the vendored row gating so a silently
 * accepted invalid drop cannot reorder the server account.
 * @param input - order, identities and the two registry sets.
 * @returns the anchor (or an append plan), or the rejection reason.
 */
export function planRemoteSessionDrop(input: RemoteSessionDropInput): RemoteDropPlan {
  if (input.archivedSessionIds.has(input.sourceId)) return { reject: 'archived-source' }
  if (input.pinnedSessionIds.has(input.sourceId) !== input.pinnedSessionIds.has(input.targetId)) {
    return { reject: 'pinned-mismatch' }
  }
  return planRemoteDrop(input.order, input.sourceId, input.targetId, input.half)
}

/**
 * Apply one accepted drop to a local order (the optimistic render).
 *
 * The server call is authoritative; this copy only exists so the row can move
 * under the pointer before the round trip, and is replaced by the next read.
 * @param order - current order.
 * @param sourceId - moved row.
 * @param beforeId - anchor, or undefined to append.
 * @returns the new order (the input is never mutated).
 */
export function applyRemoteDrop(
  order: readonly string[],
  sourceId: string,
  beforeId: string | undefined,
): readonly string[] {
  if (!order.includes(sourceId)) return [...order]
  const next = order.filter(id => id !== sourceId)
  if (beforeId === undefined) return [...next, sourceId]
  const anchor = next.indexOf(beforeId)
  if (anchor === -1) return [...next, sourceId]
  return [...next.slice(0, anchor), sourceId, ...next.slice(anchor)]
}
