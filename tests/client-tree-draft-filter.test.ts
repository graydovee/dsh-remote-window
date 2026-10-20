/**
 * The remote tree's **draft filtering** and its 新会话 entry points.
 *
 * Two rounds of semantics meet in this file, because the tree is where they show:
 *
 * - the log's *existence* is no longer the whole story. A saved draft does have a
 *   log (~324 B of `session`/`permission/preset`/`sandbox/mode`/`approval/policy`
 *   events and no turn), so `sizeBytes > 0` alone cannot tell a conversation from
 *   a draft; the host answers it directly with `draft` (`/api/sessions`), and the
 *   size check stays only as the fallback for a session with no bytes at all.
 * - the 新会话 row is **temporary**: it exists only while the shell is showing that
 *   draft (`state.currentDraft` names this workspace), it is rendered above the
 *   conversation list — never sorted, never a pin, never a watermark — and it
 *   leaves the moment the first message makes the session a conversation. The
 *   permanent blank row every workspace used to carry is gone.
 *
 * The component itself is not renderable here: `tree.tsx` imports the shell's
 * runtime module table (`@deepseek-ai/dsh-client-ui-primitives`, the vendored
 * `workspace-rows`), which this repository does not install. Both are mocked and
 * the element tree `RemoteTree` returns is walked with a minimal renderer, so
 * the assertions are about what the tree *produces* (session rows, the row's
 * `sessionCount`, the click targets) rather than about its JSX text.
 *
 * Pinned here:
 *
 * 1. a session the host marks `draft`, or one with `sizeBytes` missing/`0`, is
 *    not rendered as a row; every stored conversation is (titled or not);
 * 2. the workspace row's `sessionCount` follows the stored conversations, and
 *    falls back to the server's count until the list is loaded;
 * 3. the temporary draft row sits first (before pinned rows), carries the shell's
 *    real session id so the vendored component marks it selected, never
 *    duplicates the listed session, and disappears on a workspace switch or a
 *    blank→false transition;
 * 4. the workspace row's `+` and the temporary row both enter the draft
 *    (`store.startDraftSession`), while clicking a *stored* session row still
 *    opens that conversation (`store.openSession`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '../src/client/store.ts'
import type { RemoteSession } from '../src/client/api.ts'
import type { WorkspaceRow } from '../src/client/workspace-join.ts'

/** Every store action the tree calls; only the ones under test matter. */
const storeSpies = vi.hoisted(() => ({
  startDraftSession: vi.fn(),
  openSession: vi.fn(),
  toggleNode: vi.fn(),
  connectTarget: vi.fn(),
  openAddWorkspace: vi.fn(),
  stopTarget: vi.fn(),
  requestForgetTarget: vi.fn(),
  requestWorkspaceRename: vi.fn(),
  requestDeleteWorkspace: vi.fn(),
  notifyError: vi.fn(),
}))

/** The mocked vendored rows: they record the nodes the tree hands them. */
const rows = vi.hoisted(() => {
  interface Recorded {
    project: Array<Record<string, unknown>>
    session: Array<Record<string, unknown>>
  }
  const recorded: Recorded = { project: [], session: [] }
  return { recorded }
})

/** The tree's state is supplied by this file, not by the real store module. */
const appState = vi.hoisted(() => ({ current: {} as unknown }))

vi.mock('react', () => ({
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  useEffect: () => {},
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => {}],
}))

// JSX elements are inert records here; the walker below "renders" them. The dev
// runtime is what vitest's transformer emits.
vi.mock('react/jsx-dev-runtime', () => ({
  Fragment: Symbol.for('react.fragment'),
  jsx: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
  jsxs: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
  jsxDEV: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
}))

vi.mock('react/jsx-runtime', () => ({
  Fragment: Symbol.for('react.fragment'),
  jsx: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
  jsxs: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
  jsxDEV: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
}))

vi.mock('../src/client/store.ts', () => ({
  store: storeSpies,
  targetNodeKey: (targetId: string) => `target:${targetId}`,
  workspaceNodeKey: (workspaceId: string) => `workspace:${workspaceId}`,
  useAppState: () => appState.current,
}))

vi.mock('../src/client/vendor/workspace-rows/index.ts', () => ({
  ProjectRowItem: (props: Record<string, unknown>) => {
    rows.recorded.project.push(props)
    return null
  },
  SessionNodeItem: (props: Record<string, unknown>) => {
    rows.recorded.session.push(props)
    return null
  },
  rowRenderSlots: () => ({}),
  rowsTranslate: (key: string) => key,
}))

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconWarningTriangleOutlineRegular: () => null,
  MenuItemButton: () => null,
  Tooltip: () => null,
}))

// Dialogs are siblings of the tree and irrelevant to what it renders.
vi.mock('../src/client/list.tsx', () => ({ AddWorkspaceDialog: () => null }))
vi.mock('../src/client/confirm-dialog.tsx', () => ({ ConfirmDialog: () => null }))
vi.mock('../src/client/rename-dialog.tsx', () => ({ RenameSessionDialog: () => null }))
vi.mock('../src/client/workspace-rename-dialog.tsx', () => ({ WorkspaceRenameDialog: () => null }))
vi.mock('../src/client/session-row-parts.tsx', () => ({
  SessionMenu: () => null,
  SessionRowActions: () => null,
}))

/* ---------------------------------------------------------------- fixtures */

/** One connected-ready target. */
function target(id = 'rt-1'): AppState['targets'][number] {
  return {
    id,
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
  } as unknown as AppState['targets'][number]
}

/** One joined workspace row of that target. */
function workspaceRow(): WorkspaceRow {
  return {
    id: 'wr-1',
    targetId: 'rt-1',
    remoteWorkspaceId: 'srv-1',
    path: '/home/tester/projects',
    title: 'projects',
    sessionCount: 3,
  } as unknown as WorkspaceRow
}

/** A listed remote session; `sizeBytes` is the stored-log artifact signal. */
function session(id: string, extra: Partial<RemoteSession>): RemoteSession {
  return { id, createdAt: 1_000, ...extra } as RemoteSession
}

/** The application state the tree renders (only the fields it reads). */
function stateWith(
  items: RemoteSession[],
  options: {
    expanded?: boolean
    /** The draft the shell is showing right now (the temporary 新会话 row). */
    currentDraft?: { workspaceId: string; sessionId: string }
    pinned?: string[]
  } = {},
): AppState {
  return {
    targets: [target()],
    workspaces: [{ ...workspaceRow(), pinnedSessions: options.pinned ?? [] } as WorkspaceRow],
    ...(options.currentDraft === undefined ? {} : { currentDraft: options.currentDraft }),
    workspaceRefs: [],
    serverWorkspaces: { 'rt-1': [] },
    expanded: options.expanded === false ? {} : { 'target:rt-1': true, 'workspace:wr-1': true },
    sessions: { 'wr-1': { loading: false, loaded: true, items } },
    connectFeedback: {},
    currentSessionId: undefined,
    platform: 'darwin',
  } as unknown as AppState
}

/**
 * Render one element subtree by invoking function components.
 *
 * Enough of React for this file: elements are `{type, props}` records, the hooks
 * are mocked above, and there is no state or effects to schedule.
 */
function render(node: unknown): void {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    for (const child of node) render(child)
    return
  }
  if (typeof node !== 'object') return
  const element = node as { type?: unknown; props?: { children?: unknown } }
  if (typeof element.type === 'function') {
    render((element.type as (props: unknown) => unknown)(element.props))
    return
  }
  if (element.props !== undefined) render(element.props.children)
}

/** The session-row nodes the tree produced, in order. */
function sessionNodes(): Array<{ id: string; title: string; blank: boolean }> {
  return rows.recorded.session.map(props => props.node as { id: string; title: string; blank: boolean })
}

/** The workspace row (not the connection row) the tree produced. */
function workspaceRowProps(): Record<string, unknown> | undefined {
  return rows.recorded.project.find(props => (props.group as { key?: string })?.key === 'wr-1')
}

/** Render the tree over one state, with fresh recordings. */
async function renderTree(appStateValue: AppState): Promise<typeof import('../src/client/tree.tsx')> {
  appState.current = appStateValue
  rows.recorded.project.length = 0
  rows.recorded.session.length = 0
  vi.resetModules()
  const tree = await import('../src/client/tree.tsx')
  render(tree.RemoteTree({ compact: false }))
  return tree
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ---------------------------------------------------- the draft filter */

describe('the tree hides un-materialized drafts', () => {
  it('renders only sessions with a stored log (sizeBytes > 0)', async () => {
    await renderTree(stateWith([
      session('session-stored', { title: 'a real conversation', sizeBytes: 4_096, updatedAt: 20 }),
      // No log yet: the shell created the session for a draft and no turn was sent.
      session('session-draft', { title: 'untitled draft', updatedAt: 30 }),
      // An empty log is the same fact on the wire.
      session('session-empty', { title: 'zero bytes', sizeBytes: 0, updatedAt: 40 }),
    ]))

    const ids = sessionNodes().map(node => node.id)
    expect(ids).toContain('session-stored')
    expect(ids).not.toContain('session-draft')
    expect(ids).not.toContain('session-empty')
    // Ordering follows the stored list, not the drafts that were dropped.
    expect(ids.filter(id => id !== '')).toEqual(['session-stored'])
  })

  it('keeps a stored log that has no title (a real conversation, not a draft)', async () => {
    await renderTree(stateWith([
      session('session-untitled', { sizeBytes: 128 }),
      session('session-draft', {}),
    ]))
    const ids = sessionNodes().map(node => node.id).filter(id => id !== '')
    expect(ids).toEqual(['session-untitled'])
  })

  it('shows no blank row when no draft is open (the always-present row is gone)', async () => {
    // The permanent blank session row used to sit under every workspace, even
    // with nothing to start. The temporary row now exists only while the shell
    // is actually showing a draft.
    await renderTree(stateWith([]))
    expect(sessionNodes().filter(node => node.blank)).toEqual([])
    expect(sessionNodes()).toEqual([])
  })

  it('hides a listed session the host marks as a draft, even when it has bytes', async () => {
    await renderTree(stateWith([
      session('session-live', { title: 'on screen', sizeBytes: 324, draft: true }),
      session('session-stored', { title: 'kept', sizeBytes: 512 }),
    ]))
    // A saved draft has a log (~324 B of session/permission/sandbox headers), so
    // `sizeBytes > 0` alone cannot decide this — the host's `draft` flag does.
    expect(sessionNodes().map(node => node.id)).toEqual(['session-stored'])
    expect((workspaceRowProps()?.group as { sessionCount?: number })?.sessionCount).toBe(1)
  })

  it('counts stored conversations only in the row hover card', async () => {
    await renderTree(stateWith([
      session('session-stored', { sizeBytes: 10 }),
      session('session-draft', {}),
      session('session-empty', { sizeBytes: 0 }),
    ]))
    // The server said 3 (`workspaceRow().sessionCount`), but this device has the
    // list: drafts have no log yet, so they are not conversations.
    expect((workspaceRowProps()?.group as { sessionCount?: number })?.sessionCount).toBe(1)
  })

  it('falls back to the server count until the list is loaded', async () => {
    const state = stateWith([])
    state.sessions = {}
    await renderTree(state)
    expect((workspaceRowProps()?.group as { sessionCount?: number })?.sessionCount).toBe(3)
  })
})

/* ------------------------------------------- the two 新会话 entry points */

describe('the 新会话 entry points enter the draft', () => {
  it('the workspace row + starts a draft for that workspace', async () => {
    await renderTree(stateWith([session('session-stored', { sizeBytes: 10 })]))
    const onCreate = workspaceRowProps()?.onCreate as (() => void) | undefined
    expect(typeof onCreate).toBe('function')
    onCreate?.()
    expect(storeSpies.startDraftSession).toHaveBeenCalledTimes(1)
    expect((storeSpies.startDraftSession.mock.calls[0]?.[0] as WorkspaceRow).id).toBe('wr-1')
    // The workspace row never opens an existing session.
    expect(storeSpies.openSession).not.toHaveBeenCalled()
  })

  it('the temporary draft row starts a draft too', async () => {
    await renderTree(stateWith(
      [session('session-stored', { sizeBytes: 10 })],
      { currentDraft: { workspaceId: 'wr-1', sessionId: 'session-draft' } },
    ))
    const blank = rows.recorded.session.find(props => (props.node as { blank?: boolean }).blank === true)
    expect(blank).toBeDefined()
    ;(blank?.onOpen as ((id: string) => void) | undefined)?.('session-draft')
    expect(storeSpies.startDraftSession).toHaveBeenCalledTimes(1)
    expect((storeSpies.startDraftSession.mock.calls[0]?.[0] as WorkspaceRow).id).toBe('wr-1')
    expect(storeSpies.openSession).not.toHaveBeenCalled()
  })

  it('a stored session row still opens that conversation', async () => {
    await renderTree(stateWith([session('session-stored', { title: 'kept', sizeBytes: 10 })]))
    const stored = rows.recorded.session.find(props => (props.node as { id?: string }).id === 'session-stored')
    expect(stored).toBeDefined()
    ;(stored?.onOpen as ((id: string) => void) | undefined)?.('session-stored')
    expect(storeSpies.openSession).toHaveBeenCalledTimes(1)
    expect(storeSpies.startDraftSession).not.toHaveBeenCalled()
  })
})

describe('the tree renders nothing for a connection that is down', () => {
  it('produces no workspace rows when the target is not ready', async () => {
    const state = stateWith([session('session-stored', { sizeBytes: 10 })])
    state.targets = [{ ...target(), status: 'stopped' } as AppState['targets'][number]]
    await renderTree(state)
    expect(workspaceRowProps()).toBeUndefined()
    expect(sessionNodes()).toEqual([])
  })
})

/* ------------------------------------------ the temporary 新会话 row */

/** The draft the shell is showing while 新会话 is open on the only workspace. */
const OPEN_DRAFT = { workspaceId: 'wr-1', sessionId: 'session-draft' }

describe('the temporary draft row', () => {
  it('sits first, before a pinned conversation', async () => {
    await renderTree(stateWith(
      [
        session('session-pinned', { title: 'pinned conversation', sizeBytes: 10, updatedAt: 90 }),
        session('session-other', { title: 'other conversation', sizeBytes: 20, updatedAt: 80 }),
      ],
      { currentDraft: OPEN_DRAFT, pinned: ['session-pinned'] },
    ))

    const nodes = sessionNodes()
    // The draft row is prepended, never sorted and never a pin: the user's
    // pinned conversation keeps its rank below it.
    expect(nodes[0]).toMatchObject({ id: 'session-draft', blank: true })
    expect(nodes.slice(1).map(node => node.id)).toEqual(['session-pinned', 'session-other'])
  })

  it('carries the shell session id so the vendored row shows the selected look', async () => {
    await renderTree(stateWith([], { currentDraft: OPEN_DRAFT }))
    const draft = rows.recorded.session.find(props => (props.node as { blank?: boolean }).blank === true)
    expect(draft).toBeDefined()
    // `currentId === node.id` is the vendored component's selected state.
    expect(draft?.currentId).toBe('session-draft')
  })

  it('keeps the draft out of the conversation list even on a host that still reports its bytes', async () => {
    await renderTree(stateWith(
      // No `draft` flag (older host): the saved draft has bytes and would
      // otherwise render as a conversation.
      [session('session-draft', { sizeBytes: 324 })],
      { currentDraft: OPEN_DRAFT },
    ))

    // Filtered by id, so it appears exactly once — as the temporary row above.
    expect(sessionNodes().map(node => node.id)).toEqual(['session-draft'])
    expect(sessionNodes()[0]?.blank).toBe(true)
    // The *count* is where the flag earns its keep: without `draft` the host
    // cannot tell the saved draft from a conversation, so a legacy host still
    // counts it (with the flag — see the test above — it does not). The row list
    // is covered either way by the id filter.
    expect((workspaceRowProps()?.group as { sessionCount?: number })?.sessionCount).toBe(1)
  })

  it('does not appear while another workspace owns the draft', async () => {
    await renderTree(stateWith(
      [session('session-a', { sizeBytes: 1 })],
      { currentDraft: { workspaceId: 'wr-other', sessionId: 'session-draft' } },
    ))
    expect(sessionNodes().filter(node => node.blank)).toEqual([])
  })

  it('disappears when the first message turns the draft into a conversation', async () => {
    // After sending: the host answers `draft: false` (absent) with a title, the
    // shell's blank flag cleared, so `currentDraft` is gone.
    await renderTree(stateWith([
      session('session-draft', { title: 'Fix the parser', sizeBytes: 1_200 }),
    ]))

    expect(sessionNodes().filter(node => node.blank)).toEqual([])
    expect(sessionNodes().map(node => node.id)).toEqual(['session-draft'])
  })

  it('is not counted in the workspace hover count', async () => {
    await renderTree(stateWith([session('session-a', { sizeBytes: 1 })], { currentDraft: OPEN_DRAFT }))
    expect((workspaceRowProps()?.group as { sessionCount?: number })?.sessionCount).toBe(1)
  })
})
