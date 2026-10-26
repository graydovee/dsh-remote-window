/**
 * The v1 remote tree's rendering contract on top of the P3 store.
 *
 * The tree still renders the **official** rows (mocked here as recorders); what
 * these tests pin is which rows it produces from server data: workspace order,
 * session membership/order, the one temporary 「新会话」 row, local search
 * filtering, and the archived-row click guard. No network or React renderer is
 * involved.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteAppState, RemoteConnectionView } from '../src/client/remote-store.ts'
import type { RemoteSession, RemoteWorkspaceGroup } from '../src/client/remote-data.ts'
import { deriveWorkspaceGroups } from '../src/client/remote-data.ts'

const appState = vi.hoisted(() => ({ current: {} as unknown }))
const storeFn = vi.hoisted(() => ({
  openRemoteSession: vi.fn(),
  openRemoteDraft: vi.fn(),
  notifyRemoteError: vi.fn(),
  notifyRemoteSuccess: vi.fn(),
  openModeDialog: vi.fn(),
  openAddWorkspace: vi.fn(),
  requestRenameWorkspace: vi.fn(),
  requestDeleteWorkspace: vi.fn(),
  requestForgetTarget: vi.fn(),
  requestRenameSession: vi.fn(),
  connectRemoteTarget: vi.fn(),
  disconnectRemoteTarget: vi.fn(),
  toggleRemoteNode: vi.fn(),
  toggleSessionPin: vi.fn(),
  toggleSessionArchive: vi.fn(),
  forkRemoteSession: vi.fn(),
  reorderSessions: vi.fn(),
  reorderWorkspaces: vi.fn(),
  loadRemoteSessions: vi.fn(),
  loadRegistryChanges: vi.fn(),
  previewProfileRestart: vi.fn(),
  remoteSearchFor: vi.fn(),
}))

const rows = vi.hoisted(() => ({
  project: [] as Array<Record<string, unknown>>,
  session: [] as Array<Record<string, unknown>>,
}))

vi.mock('react', () => ({
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  useEffect: () => {},
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => {}],
}))

vi.mock('react/jsx-runtime', () => ({
  Fragment: Symbol.for('react.fragment'),
  jsx: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
  jsxs: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
  jsxDEV: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
}))
vi.mock('react/jsx-dev-runtime', () => ({
  Fragment: Symbol.for('react.fragment'),
  jsx: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
  jsxs: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
  jsxDEV: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
}))

vi.mock('../src/client/remote-store.ts', () => ({
  useRemoteAppState: () => appState.current,
  targetNodeKey: (id: string) => `target:${id}`,
  workspaceNodeKey: (id: string) => `workspace:${id}`,
  ...storeFn,
}))

vi.mock('../src/client/remote-dialogs.tsx', () => ({ RemoteDialogs: () => null }))
vi.mock('../src/client/common.tsx', () => ({ useSingleHost: () => true }))
vi.mock('../src/client/vendor/workspace-rows/index.ts', () => ({
  ProjectRowItem: (props: Record<string, unknown>) => { rows.project.push(props); return null },
  SessionNodeItem: (props: Record<string, unknown>) => { rows.session.push(props); return null },
  rowRenderSlots: () => ({}),
  rowsTranslate: (key: string) => key,
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconWarningTriangleOutlineRegular: () => null,
  IconArchiveOutlineRegular: () => null,
  IconBranchOutlineRegular: () => null,
  IconEditOutlineRegular: () => null,
  IconGlobeOutlineRegular: () => null,
  IconPinFillRegular: () => null,
  IconPinOutlineRegular: () => null,
  IconRefreshOutlineRegular: () => null,
  IconUnarchiveOutlineRegular: () => null,
  MenuItemButton: () => null,
  Tooltip: () => null,
}))
vi.mock('../src/client/vendor/workspace-rows/generated/classnames.ts', () => ({
  rowsCss: { iconButton: 'icon-button' },
}))

/* --------------------------------------------------------------- fixtures */

function workspace(id: string, title: string, sessionIds: readonly string[], path = `/srv/${id}`) {
  return { workspaceId: id, path, title, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', sessionIds }
}

function session(id: string, extra: Partial<RemoteSession> = {}): RemoteSession {
  return {
    sessionId: id,
    title: id,
    blank: false,
    running: false,
    agentAvailable: true,
    updatedAt: 1_000,
    pinned: false,
    archived: false,
    ...extra,
  }
}

function groups(): RemoteWorkspaceGroup[] {
  return deriveWorkspaceGroups(
    {
      registry: { revision: 'r1', epoch: 'e1', initialized: true },
      workspaces: [
        workspace('w1', 'Alpha', ['s2', 's1']),
        workspace('w2', 'Beta', ['s3']),
      ],
      pinnedSessionIds: [],
      archivedSessionIds: [],
    },
    {
      registry: { revision: 'r1', epoch: 'e1' },
      sessions: [
        session('s1'),
        session('s2', { pinned: true }),
        session('s3', { archived: true }),
      ],
    },
  )
}

function view(overrides: Partial<RemoteConnectionView> = {}): RemoteConnectionView {
  return {
    target: {
      id: 't1',
      label: 'box',
      kind: 'ssh',
      host: '203.0.113.10',
      port: 22,
      username: 'tester',
      authKind: 'agent',
      hasStoredSecret: false,
      hostKeyFingerprint: 'SHA256:abc',
      remote: { nodePath: '', dshCommand: '', profile: '', dshHome: '', plugins: [] },
      status: 'ready',
    },
    connection: {
      targetId: 't1',
      phase: 'ready',
      profile: { name: 'profile' },
      runtime: { kind: 'global' },
      plugin: { installed: true },
      portal: { base: '/dsh-remote-workspace/portal/t1/', muxPath: '/dsh-remote-workspace/portal/t1/api/remote.mux' },
    },
    workspaces: {
      registry: { revision: 'r1', epoch: 'e1', initialized: true },
      workspaces: [workspace('w1', 'Alpha', ['s2', 's1']), workspace('w2', 'Beta', ['s3'])],
      pinnedSessionIds: [],
      archivedSessionIds: [],
    },
    sessions: {
      registry: { revision: 'r1', epoch: 'e1' },
      sessions: [session('s1'), session('s2', { pinned: true }), session('s3', { archived: true })],
    },
    groups: groups(),
    stateLoad: { loading: false, loaded: true },
    sessionsLoad: { loading: false, loaded: true },
    expanded: { 'target:t1': true, 'workspace:w1': true, 'workspace:w2': true },
    mode: 'server',
    modeSwitch: { phase: 'idle', confirmed: false },
    restart: { phase: 'idle' },
    stale: false,
    ...overrides,
  }
}

function stateWith(connection: RemoteConnectionView | undefined, extra: Partial<RemoteAppState> = {}): RemoteAppState {
  return {
    loaded: true,
    loading: false,
    pluginVersion: '0.1.0',
    order: connection === undefined ? [] : ['t1'],
    connections: connection === undefined ? {} : { t1: connection },
    search: '',
    pending: false,
    ...extra,
  }
}

/** Walk the returned element tree, invoking function components. */
function render(node: unknown): void {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) { for (const child of node) render(child); return }
  if (typeof node !== 'object') return
  const element = node as { type?: unknown; props?: { children?: unknown } }
  if (typeof element.type === 'function') {
    render((element.type as (props: unknown) => unknown)(element.props))
    return
  }
  if (element.props !== undefined) render(element.props.children)
}

interface TreeSearchResult {
  readonly workspaceIds: Set<string>
  readonly sessionIds: Set<string>
  readonly query: string
  readonly hasMatches: boolean
}

async function renderTree(next: RemoteAppState, search?: TreeSearchResult): Promise<void> {
  appState.current = next
  rows.project.length = 0
  rows.session.length = 0
  storeFn.remoteSearchFor.mockReturnValue(search)
  vi.resetModules()
  const tree = await import('../src/client/tree.tsx')
  render(tree.RemoteTree({ compact: false }))
}

function sessionNodes(): Array<{ id: string; title: string; blank: boolean; archived: boolean; pinned: boolean }> {
  return rows.session.map(props => props.node as {
    id: string; title: string; blank: boolean; archived: boolean; pinned: boolean
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the v1 remote tree renders server authority', () => {
  it('renders one connection, its workspaces in server order and each workspace’s member order', async () => {
    await renderTree(stateWith(view()))
    const projectKeys = rows.project
      .map(props => (props.group as { key?: string })?.key)
      .filter((key): key is string => key !== undefined)
    expect(projectKeys).toEqual(['conn:t1', 'w1', 'w2'])
    expect(sessionNodes().map(node => node.id)).toEqual(['s2', 's1', 's3'])
    expect(sessionNodes().find(node => node.id === 's2')?.pinned).toBe(true)
    expect(sessionNodes().find(node => node.id === 's3')?.archived).toBe(true)
  })

  it('renders nothing when no connection has been saved', async () => {
    await renderTree(stateWith(undefined))
    expect(rows.project).toEqual([])
    expect(rows.session).toEqual([])
  })

  it('replaces the workspace count with the loaded conversation count', async () => {
    await renderTree(stateWith(view()))
    const workspaceRow = rows.project.find(props => (props.group as { key?: string })?.key === 'w1')
    expect((workspaceRow?.group as { sessionCount?: number } | undefined)?.sessionCount).toBe(2)
  })
})

describe('the temporary draft row', () => {
  it('sits above the workspace’s sessions and reopens the existing blank', async () => {
    const base = view()
    const draft = session('blank', { blank: true })
    const withDraft = view({
      groups: deriveWorkspaceGroups({
        registry: { revision: 'r1', epoch: 'e1', initialized: true },
        workspaces: [
          workspace('w1', 'Alpha', ['s2', 's1', 'blank']),
          workspace('w2', 'Beta', ['s3']),
        ],
        pinnedSessionIds: [],
        archivedSessionIds: [],
      }, {
        registry: { revision: 'r1', epoch: 'e1' },
        sessions: [...base.sessions!.sessions, draft],
      }, { currentSessionId: 'blank' }),
      expanded: { 'target:t1': true, 'workspace:w1': true },
    })
    await renderTree(stateWith(withDraft))
    const first = rows.session[0]?.node as { id?: string; blank?: boolean } | undefined
    expect(first).toMatchObject({ id: 'blank', blank: true })
    const draftProps = rows.session[0] as { onOpen?: () => void } | undefined
    draftProps?.onOpen?.()
    // The temporary row represents an already-created blank session: opening it
    // must not mint another session through the draft-create path.
    expect(storeFn.openRemoteSession).toHaveBeenCalledWith('t1', 'blank')
    expect(storeFn.openRemoteDraft).not.toHaveBeenCalled()
  })
})

describe('row click paths (M3)', () => {
  it('the workspace row + starts the blank draft path', async () => {
    await renderTree(stateWith(view()))
    const workspaceRow = rows.project.find(props => (props.group as { key?: string })?.key === 'w1')
    ;(workspaceRow as { onCreate?: () => void } | undefined)?.onCreate?.()
    expect(storeFn.openRemoteDraft).toHaveBeenCalledWith('t1', 'w1')
  })

  it('the connected connection row + opens add-workspace', async () => {
    await renderTree(stateWith(view()))
    const connectionRow = rows.project.find(props => (props.group as { key?: string })?.key === 'conn:t1')
    ;(connectionRow as { onCreate?: () => void } | undefined)?.onCreate?.()
    expect(storeFn.openAddWorkspace).toHaveBeenCalledWith('t1')
  })
})

describe('session row clicks', () => {
  it('opens a stored session through the remote store', async () => {
    await renderTree(stateWith(view()))
    const row = rows.session.find(props => (props.node as { id?: string })?.id === 's1')
    ;(row as { onOpen?: () => void } | undefined)?.onOpen?.()
    expect(storeFn.openRemoteSession).toHaveBeenCalledWith('t1', 's1')
  })

  it('refuses an archived session with a notice', async () => {
    await renderTree(stateWith(view()))
    const row = rows.session.find(props => (props.node as { id?: string })?.id === 's3')
    ;(row as { onOpen?: () => void } | undefined)?.onOpen?.()
    expect(storeFn.openRemoteSession).not.toHaveBeenCalled()
    expect(storeFn.notifyRemoteError).toHaveBeenCalled()
  })
})

describe('local search', () => {
  it('keeps only matching workspaces and sessions while searching', async () => {
    const search = {
      workspaceIds: new Set(['w1']),
      sessionIds: new Set(['s1']),
      query: 'alpha',
      hasMatches: true,
    }
    await renderTree(stateWith(view(), { search: 'alpha' }), search)
    expect(sessionNodes().map(node => node.id)).toEqual(['s1'])
    const projectKeys = rows.project.map(props => (props.group as { key?: string })?.key)
    expect(projectKeys).not.toContain('w2')
  })

  it('states "no matches" instead of an empty tree', async () => {
    await renderTree(stateWith(view(), { search: 'zzz' }), {
      workspaceIds: new Set(),
      sessionIds: new Set(),
      query: 'zzz',
      hasMatches: false,
    })
    expect(sessionNodes()).toEqual([])
  })
})
