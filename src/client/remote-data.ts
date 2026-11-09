/**
 * Pure server-data shapes the v3 client reads from the host.
 *
 * The server owns workspace membership/order and session summaries; the client
 * only carries these values into the portal deep link and the rail's badges.
 * Nothing here touches React, the network or the host API.
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
  /** Projection title; absent = unnamed. */
  readonly title?: string
  /** Official blank flag: the provisional New Session row. */
  readonly blank: boolean
  /** Epoch milliseconds, from the official summary. */
  readonly updatedAt: number
  /** Anonymous subagent session rows never become portal deep links. */
  readonly origin?: 'subagent'
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
