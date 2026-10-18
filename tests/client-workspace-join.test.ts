/**
 * The two-stage workspace join (`src/client/workspace-join.ts`).
 *
 * P0 puts the workspace list on the **server** (`reg.list`) and keeps only local
 * refs here, so a row exists only where the two halves meet. These tests pin the
 * four rules that keep that honest — especially the one that is easy to get
 * wrong: a **missing** `serverWorkspaces` key ("could not read the list") is not
 * an empty array ("the server has no workspace").
 */
import { describe, expect, it } from 'vitest'
import { joinWorkspaces, serverListState } from '../src/client/workspace-join.ts'
import type { PublicTarget, ServerWorkspace, WorkspaceRef } from '../src/client/api.ts'

/** Minimal ready target. */
function target(id: string, status: PublicTarget['status'] = 'ready'): PublicTarget {
  return {
    id,
    label: id,
    kind: 'ssh',
    host: 'example',
    port: 22,
    username: 'u',
    authKind: 'agent',
    hasStoredSecret: false,
    hostKeyFingerprint: '',
    remote: { nodePath: '', dshCommand: '', profile: '', dshHome: '', plugins: [] },
    status,
  }
}

function serverItem(id: string, path: string, extra: Partial<ServerWorkspace> = {}): ServerWorkspace {
  return { id, path, title: path.split('/').pop() ?? path, ...extra }
}

function ref(id: string, targetId: string, remoteWorkspaceId: string | undefined, extra: Partial<WorkspaceRef> = {}): WorkspaceRef {
  return { id, targetId, ...(remoteWorkspaceId === undefined ? {} : { remoteWorkspaceId }), ...extra }
}

describe('joinWorkspaces', () => {
  it('joins a server item with its local ref', () => {
    const rows = joinWorkspaces({
      targets: [target('rt-1')],
      refs: [ref('wr-1', 'rt-1', 'aaaaaaaaaaaaaaaa', { sessionId: 'session-1', pinnedSessions: ['s'] })],
      serverWorkspaces: { 'rt-1': [serverItem('aaaaaaaaaaaaaaaa', '/home/u/proj', { sessionCount: 3, createdAt: '2026-10-18T06:00:00.000Z' })] },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'wr-1',
      targetId: 'rt-1',
      remoteWorkspaceId: 'aaaaaaaaaaaaaaaa',
      path: '/home/u/proj',
      title: 'proj',
      sessionCount: 3,
      sessionId: 'session-1',
      pinnedSessions: ['s'],
    })
  })

  it('renders nothing for a target that is not ready (disconnected)', () => {
    const rows = joinWorkspaces({
      targets: [target('rt-1', 'stopped')],
      refs: [ref('wr-1', 'rt-1', 'aaaaaaaaaaaaaaaa')],
      serverWorkspaces: { 'rt-1': [serverItem('aaaaaaaaaaaaaaaa', '/home/u/proj')] },
    })
    expect(rows).toEqual([])
  })

  it('treats a MISSING server list key as unreadable, not as empty', () => {
    const shared = {
      targets: [target('rt-1')],
      refs: [ref('wr-1', 'rt-1', 'aaaaaaaaaaaaaaaa')],
    }
    expect(joinWorkspaces({ ...shared, serverWorkspaces: {} })).toEqual([])
    expect(serverListState({}, 'rt-1')).toBe('unavailable')
    // An explicitly empty list is a different fact: the server answered.
    expect(joinWorkspaces({ ...shared, serverWorkspaces: { 'rt-1': [] } })).toEqual([])
    expect(serverListState({ 'rt-1': [] }, 'rt-1')).toBe('empty')
    expect(serverListState({ 'rt-1': [serverItem('a', '/p')] }, 'rt-1')).toBe('rows')
  })

  it('skips a ref without a server id (pre-migration) and a ref whose server item is gone', () => {
    const rows = joinWorkspaces({
      targets: [target('rt-1')],
      refs: [
        ref('wr-legacy', 'rt-1', undefined, { path: '/home/u/legacy' } as Partial<WorkspaceRef>),
        ref('wr-gone', 'rt-1', 'bbbbbbbbbbbbbbbb'),
      ],
      serverWorkspaces: { 'rt-1': [serverItem('aaaaaaaaaaaaaaaa', '/home/u/proj')] },
    })
    expect(rows).toEqual([])
  })

  it('orders by newest activity, rows without a timestamp last, then by path', () => {
    const rows = joinWorkspaces({
      targets: [target('rt-1')],
      refs: [
        ref('wr-old', 'rt-1', '1111111111111111'),
        ref('wr-new', 'rt-1', '2222222222222222'),
        ref('wr-none', 'rt-1', '3333333333333333'),
        ref('wr-tie-b', 'rt-1', '4444444444444444'),
        ref('wr-tie-a', 'rt-1', '5555555555555555'),
      ],
      serverWorkspaces: {
        'rt-1': [
          serverItem('1111111111111111', '/a/old', { updatedAt: '2026-10-18T05:00:00.000Z' }),
          serverItem('2222222222222222', '/a/new', { updatedAt: '2026-10-18T07:00:00.000Z' }),
          serverItem('3333333333333333', '/a/no-time'),
          serverItem('4444444444444444', '/b/tie', { createdAt: '2026-10-18T06:00:00.000Z' }),
          serverItem('5555555555555555', '/a/tie', { createdAt: '2026-10-18T06:00:00.000Z' }),
        ],
      },
    })
    expect(rows.map(row => row.path)).toEqual(['/a/new', '/a/tie', '/b/tie', '/a/old', '/a/no-time'])
  })

  it('survives a v2 server item without createdAt/sessionCount', () => {
    const rows = joinWorkspaces({
      targets: [target('rt-1')],
      refs: [ref('wr-1', 'rt-1', 'aaaaaaaaaaaaaaaa')],
      serverWorkspaces: { 'rt-1': [{ id: 'aaaaaaaaaaaaaaaa', path: '/home/u/proj', title: 'proj' }] },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.createdAt).toBeUndefined()
    expect(rows[0]?.sessionCount).toBeUndefined()
  })
})
