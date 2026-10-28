/**
 * The v1 remote tree's pure data rules (protocol §5.1–§5.3).
 *
 * The point of these tests is not the shapes: it is that the *authority* stays
 * where the protocol puts it. Server order, membership, pin/archive and the
 * blank-session rule are all decided here, before React or the host API is
 * involved, so a later wiring mistake cannot quietly re-sort a server account
 * or turn a draft into a row.
 */
import { describe, expect, it } from 'vitest'
import {
  applyRemoteDrop,
  currentBlankSession,
  deriveSessionNodes,
  deriveWorkspaceGroups,
  planRemoteDrop,
  planRemoteSessionDrop,
  searchRemoteGroups,
  sessionsById,
} from '../src/client/remote-data.ts'
import type {
  RemoteSession,
  RemoteSessionList,
  RemoteWorkspace,
  RemoteWorkspaceList,
} from '../src/client/remote-data.ts'

function workspace(
  workspaceId: string,
  title: string,
  sessionIds: readonly string[],
  path = `/home/tester/${workspaceId}`,
): RemoteWorkspace {
  return {
    workspaceId,
    path,
    title,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    sessionIds,
  }
}

function session(sessionId: string, extra: Partial<RemoteSession> = {}): RemoteSession {
  return {
    sessionId,
    title: sessionId,
    blank: false,
    running: false,
    agentAvailable: true,
    updatedAt: 1_000,
    pinned: false,
    archived: false,
    ...extra,
  }
}

function workspaceList(workspaces: readonly RemoteWorkspace[], extra: Partial<RemoteWorkspaceList> = {}): RemoteWorkspaceList {
  return {
    registry: { revision: 'rev-1', epoch: 'epoch-1', initialized: true },
    workspaces,
    pinnedSessionIds: [],
    archivedSessionIds: [],
    ...extra,
  }
}

function sessionList(sessions: readonly RemoteSession[]): RemoteSessionList {
  return { registry: { revision: 'rev-1', epoch: 'epoch-1' }, sessions }
}

describe('deriveWorkspaceGroups', () => {
  it('keeps the server workspace order and the server membership order', () => {
    const list = workspaceList([
      workspace('w2', 'second', ['b', 'a']),
      workspace('w1', 'first', ['c']),
    ])
    const groups = deriveWorkspaceGroups(list, sessionList([
      session('a'),
      session('b'),
      session('c'),
    ]))
    expect(groups.map(group => group.workspace.workspaceId)).toEqual(['w2', 'w1'])
    expect(groups[0]?.sessions.map(row => row.id)).toEqual(['b', 'a'])
    expect(groups[1]?.sessions.map(row => row.id)).toEqual(['c'])
  })

  it('falls back to the server membership size before the session list is loaded', () => {
    const list = workspaceList([workspace('w1', 'one', ['a', 'b', 'c'])])
    const groups = deriveWorkspaceGroups(list, undefined)
    expect(groups[0]?.workspace.sessionCount).toBe(3)
    expect(groups[0]?.sessions).toEqual([])
  })

  it('counts the loaded conversations, not drafts, subagents or hidden archives', () => {
    const list = workspaceList([workspace('w1', 'one', ['a', 'blank', 'child', 'archived'])])
    const groups = deriveWorkspaceGroups(list, sessionList([
      session('a'),
      session('blank', { blank: true }),
      session('child', { origin: 'subagent' }),
      session('archived', { archived: true }),
    ]), { currentSessionId: 'blank' })
    expect(groups[0]?.workspace.sessionCount).toBe(2)
    expect(groups[0]?.sessions.map(row => row.id)).toEqual(['a', 'archived'])
    expect(groups[0]?.draft?.id).toBe('blank')
  })

  it('keeps archived rows in their member slot unless archived rows are hidden', () => {
    const list = workspaceList([workspace('w1', 'one', ['a', 'archived', 'b'])])
    const sessions = sessionList([session('a'), session('archived', { archived: true }), session('b')])
    expect(deriveWorkspaceGroups(list, sessions)[0]?.sessions.map(row => row.id))
      .toEqual(['a', 'archived', 'b'])
    expect(deriveWorkspaceGroups(list, sessions, { includeArchived: false })[0]?.sessions.map(row => row.id))
      .toEqual(['a', 'b'])
  })

  it('leads pinned rows in member order, and never marks an archived row pinned', () => {
    const list = workspaceList([workspace('w1', 'one', ['a', 'b', 'c', 'd'])])
    const groups = deriveWorkspaceGroups(list, sessionList([
      session('a'),
      session('b', { pinned: true }),
      session('c', { pinned: true, archived: true }),
      session('d'),
    ]))
    expect(groups[0]?.sessions.map(row => row.id)).toEqual(['b', 'a', 'c', 'd'])
    expect(groups[0]?.sessions.find(row => row.id === 'c')?.pinned).toBe(false)
  })

  it('skips members whose summary has not arrived and stray sessions outside every workspace', () => {
    const list = workspaceList([workspace('w1', 'one', ['a', 'missing'])])
    const groups = deriveWorkspaceGroups(list, sessionList([session('a'), session('stray', { workspaceId: undefined })]))
    expect(groups[0]?.sessions.map(row => row.id)).toEqual(['a'])
    expect(groups).toHaveLength(1)
  })

  it('degrades an unreadable list (host substituted `{ error }`) to no rows', () => {
    // A failed per-target read in `/api/state` arrives as `{ error }` instead of
    // a list; the connection explains the failure, so the tree must stay empty.
    const failed = { error: { code: 'p1-read-failed', message: 'socket hang up' } } as unknown as RemoteWorkspaceList
    expect(deriveWorkspaceGroups(failed, undefined)).toEqual([])
  })

  it('exposes only the selected blank session as the temporary draft', () => {
    const list = workspaceList([workspace('w1', 'one', ['blank', 'a'])])
    const sessions = sessionList([session('blank', { blank: true }), session('a')])
    expect(deriveWorkspaceGroups(list, sessions)[0]?.draft).toBeUndefined()
    expect(deriveWorkspaceGroups(list, sessions, { currentSessionId: 'blank' })[0]?.draft?.id).toBe('blank')
    expect(deriveWorkspaceGroups(list, sessions, { currentSessionId: 'a' })[0]?.draft).toBeUndefined()
  })

  it('does not expose a selected blank that belongs to another workspace', () => {
    const list = workspaceList([workspace('w1', 'one', ['a']), workspace('w2', 'two', ['blank'])])
    const groups = deriveWorkspaceGroups(
      list,
      sessionList([session('a'), session('blank', { blank: true })]),
      { currentSessionId: 'blank' },
    )
    expect(groups[0]?.draft).toBeUndefined()
    expect(groups[1]?.draft?.id).toBe('blank')
  })
})

describe('currentBlankSession', () => {
  it('requires a selected, blank member', () => {
    const w = workspace('w1', 'one', ['blank'])
    const byId = sessionsById(sessionList([session('blank', { blank: true })]))
    expect(currentBlankSession(w, byId, 'blank')?.id).toBe('blank')
    expect(currentBlankSession(w, byId, undefined)).toBeUndefined()
    expect(currentBlankSession(w, byId, 'other')).toBeUndefined()
    const stored = sessionsById(sessionList([session('blank', { blank: false })]))
    expect(currentBlankSession(w, stored, 'blank')).toBeUndefined()
  })
})

describe('deriveSessionNodes', () => {
  it('derives only visible conversations and preserves member order', () => {
    const w = workspace('w1', 'one', ['a', 'blank', 'child', 'b'])
    const byId = sessionsById([
      session('a'),
      session('blank', { blank: true }),
      session('child', { origin: 'subagent' }),
      session('b', { archived: true }),
    ])
    expect(deriveSessionNodes(w, byId).map(row => row.id)).toEqual(['a', 'b'])
  })
})

describe('searchRemoteGroups', () => {
  const list = workspaceList([
    workspace('w1', 'Alpha project', ['one', 'two'], '/srv/alpha'),
    workspace('w2', 'Beta project', ['three'], '/srv/beta'),
  ])
  const sessions = sessionList([
    session('one', { title: 'Fix the parser' }),
    session('two', { title: 'Unrelated' }),
    session('three', { title: 'Parser cleanup' }),
  ])
  const groups = deriveWorkspaceGroups(list, sessions)

  it('treats an empty or whitespace query as "no filter"', () => {
    const empty = searchRemoteGroups(groups, '')
    expect(empty.hasMatches).toBe(true)
    expect(empty.workspaceIds).toEqual(new Set(['w1', 'w2']))
    expect(empty.sessionIds).toEqual(new Set(['one', 'two', 'three']))
    const spaces = searchRemoteGroups(groups, '   ')
    expect(spaces.workspaceIds).toEqual(empty.workspaceIds)
  })

  it('keeps every session under a workspace whose title or path matches', () => {
    const byTitle = searchRemoteGroups(groups, 'alpha')
    expect(byTitle.workspaceIds).toEqual(new Set(['w1']))
    expect(byTitle.sessionIds).toEqual(new Set(['one', 'two']))
    const byPath = searchRemoteGroups(groups, 'srv/beta')
    expect(byPath.workspaceIds).toEqual(new Set(['w2']))
    expect(byPath.sessionIds).toEqual(new Set(['three']))
  })

  it('keeps only matching sessions under a workspace when only session titles match', () => {
    const result = searchRemoteGroups(groups, 'parser')
    expect(result.workspaceIds).toEqual(new Set(['w1', 'w2']))
    expect(result.sessionIds).toEqual(new Set(['one', 'three']))
  })

  it('reports no matches without inventing rows', () => {
    const result = searchRemoteGroups(groups, 'nope')
    expect(result.hasMatches).toBe(false)
    expect(result.workspaceIds.size).toBe(0)
    expect(result.sessionIds.size).toBe(0)
  })

  it('is case-insensitive and does not change order or membership', () => {
    const result = searchRemoteGroups(groups, 'ALPHA')
    expect(result.workspaceIds).toEqual(new Set(['w1']))
    expect(groups[0]?.sessions.map(row => row.id)).toEqual(['one', 'two'])
  })
})

describe('drag planning', () => {
  const order = ['a', 'b', 'c']

  it('resolves before/after to the API anchor, with after-last meaning append', () => {
    expect(planRemoteDrop(order, 'c', 'a', 'before')).toEqual({ beforeId: 'a' })
    expect(planRemoteDrop(order, 'a', 'b', 'after')).toEqual({ beforeId: 'c' })
    expect(planRemoteDrop(order, 'a', 'c', 'after')).toEqual({})
    expect(planRemoteDrop(order, 'b', 'b', 'before')).toEqual({ reject: 'no-op' })
    expect(planRemoteDrop(order, 'missing', 'a', 'before')).toEqual({ reject: 'not-found' })
    expect(planRemoteDrop(order, 'a', 'missing', 'before')).toEqual({ reject: 'not-found' })
  })

  it('keeps session drops inside one pin block and never moves an archived source', () => {
    const pinned = new Set(['b'])
    expect(planRemoteSessionDrop({
      order,
      sourceId: 'b',
      targetId: 'a',
      half: 'before',
      pinnedSessionIds: pinned,
      archivedSessionIds: new Set(),
    })).toEqual({ reject: 'pinned-mismatch' })
    expect(planRemoteSessionDrop({
      order,
      sourceId: 'a',
      targetId: 'b',
      half: 'before',
      pinnedSessionIds: new Set(['a', 'b']),
      archivedSessionIds: new Set(),
    })).toEqual({ beforeId: 'b' })
    expect(planRemoteSessionDrop({
      order,
      sourceId: 'a',
      targetId: 'b',
      half: 'before',
      pinnedSessionIds: new Set(),
      archivedSessionIds: new Set(['a']),
    })).toEqual({ reject: 'archived-source' })
  })

  it('applies an accepted drop without mutating the input', () => {
    const before = [...order]
    expect(applyRemoteDrop(order, 'c', 'a')).toEqual(['c', 'a', 'b'])
    expect(applyRemoteDrop(order, 'a', 'c')).toEqual(['b', 'a', 'c'])
    expect(applyRemoteDrop(order, 'a', undefined)).toEqual(['b', 'c', 'a'])
    expect(applyRemoteDrop(order, 'missing', 'a')).toEqual(order)
    expect(applyRemoteDrop(order, 'a', 'missing')).toEqual(['b', 'c', 'a'])
    expect(order).toEqual(before)
  })
})
