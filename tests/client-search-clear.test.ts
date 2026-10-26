/**
 * Search clear must restore the full remote tree.
 *
 * Reproduces the UI sequence without a browser: load /api/state through the
 * real store, render the real tree, type a query, then clear it and re-render.
 * The recorded official rows must go beta-only → back to every workspace.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteWorkspaceList } from '../src/client/remote-data.ts'

const remoteApiSpies = vi.hoisted(() => ({
  state: vi.fn(),
  sessions: vi.fn(),
  stateRefresh: vi.fn(),
  registryRefresh: vi.fn(),
}))
const rows = vi.hoisted(() => ({ projects: [] as Array<Record<string, unknown>>, sessions: [] as Array<Record<string, unknown>> }))

vi.mock('react', () => ({
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  useEffect: () => {},
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => {}],
  useRef: (value: unknown) => ({ current: value }),
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
vi.mock('../src/client/api.ts', () => ({
  api: { connect: vi.fn(), stopTarget: vi.fn(), forgetTarget: vi.fn() },
  RemoteApiError: class extends Error { code = 'x'; status = 500; details = undefined },
  toWireError: (error: unknown) => ({ code: 'x', message: error instanceof Error ? error.message : String(error) }),
}))
vi.mock('../src/client/remote-api.ts', () => ({
  remoteApi: remoteApiSpies,
  openRemoteStateStream: () => () => {},
}))
vi.mock('../src/client/portal-main.tsx', () => ({
  SERVER_MAIN_ID: 'server-main',
  openServerMain: vi.fn(),
  closeServerMain: vi.fn(),
  serverMainRequest: () => undefined,
  serverMainSessionId: () => undefined,
  subscribeServerMain: () => () => {},
}))
vi.mock('../src/client/remote-dialogs.tsx', () => ({ RemoteDialogs: () => null }))
vi.mock('../src/client/common.tsx', () => ({
  NoticeToastHost: () => null,
  useSingleHost: () => true,
}))
vi.mock('../src/client/vendor/workspace-rows/index.ts', () => ({
  ProjectRowItem: (props: Record<string, unknown>) => { rows.projects.push(props); return null },
  SessionNodeItem: (props: Record<string, unknown>) => { rows.sessions.push(props); return null },
  rowRenderSlots: () => ({}),
  rowsTranslate: (key: string) => key,
}))
vi.mock('../src/client/vendor/workspace-rows/generated/classnames.ts', () => ({ rowsCss: { iconButton: 'icon' } }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: (props: Record<string, unknown>) => ({ type: 'button', props }),
  MarkdownText: () => null,
  CodeBlock: () => null,
  DiffBlock: () => null,
  JsonBlock: () => null,
  ReadBlock: () => null,
  SearchBlock: () => null,
  TerminalBlock: () => null,
  IconArchiveOutlineRegular: () => null,
  IconBranchOutlineRegular: () => null,
  IconCloseOutlineRegular: () => null,
  IconEditOutlineRegular: () => null,
  IconGlobeOutlineRegular: () => null,
  IconPinFillRegular: () => null,
  IconPinOutlineRegular: () => null,
  IconRefreshOutlineRegular: () => null,
  IconUnarchiveOutlineRegular: () => null,
  IconWarningTriangleOutlineRegular: () => null,
  MenuItemButton: () => null,
  Tooltip: () => null,
}))

const TARGET = {
  id: 't1', label: 'box', kind: 'ssh', host: '203.0.113.10', port: 22, username: 'tester',
  authKind: 'agent', hasStoredSecret: false, hostKeyFingerprint: '', status: 'ready',
  remote: { nodePath: '', dshCommand: '', profile: '', dshHome: '', plugins: [] },
}
const WORKSPACES: RemoteWorkspaceList = {
  registry: { revision: 'r1', epoch: 'e1', initialized: true },
  workspaces: [
    { workspaceId: 'alpha', path: '/srv/alpha', title: 'alpha', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', sessionIds: [] },
    { workspaceId: 'beta', path: '/srv/beta', title: 'beta', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', sessionIds: [] },
    { workspaceId: 'gamma', path: '/srv/gamma', title: 'gamma', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', sessionIds: [] },
  ],
  pinnedSessionIds: [],
  archivedSessionIds: [],
}
const SESSIONS = { registry: { revision: 'r1', epoch: 'e1' }, sessions: [] }

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

function projectKeys(): string[] {
  return rows.projects
    .map(props => (props.group as { key?: string })?.key)
    .filter((key): key is string => key !== undefined)
}

beforeEach(() => {
  vi.clearAllMocks()
  remoteApiSpies.state.mockResolvedValue({
    pluginVersion: '0.1.0',
    targets: [TARGET],
    connections: { t1: { targetId: 't1', phase: 'ready', profile: { name: 'p' }, runtime: { kind: 'global' }, plugin: { installed: true }, portal: { base: '', muxPath: '' } } },
    workspaces: { t1: WORKSPACES },
    sessions: { t1: SESSIONS },
    defaultProfile: 'p',
  })
  remoteApiSpies.sessions.mockResolvedValue(SESSIONS)
})

describe('search clear restores the full tree', () => {
  it('goes from beta-only back to alpha/beta/gamma after setRemoteSearch(empty)', async () => {
    vi.resetModules()
    const store = await import('../src/client/remote-store.ts')
    await store.loadRemoteState()
    rows.projects.length = 0
    const tree = await import('../src/client/tree.tsx')
    render(tree.RemoteTree({ compact: true }))
    expect(projectKeys()).toEqual(['conn:t1', 'alpha', 'beta', 'gamma'])
    store.setRemoteSearch('beta')
    rows.projects.length = 0
    render(tree.RemoteTree({ compact: true }))
    expect(projectKeys()).toEqual(['conn:t1', 'beta'])
    store.setRemoteSearch('')
    rows.projects.length = 0
    render(tree.RemoteTree({ compact: true }))
    expect(projectKeys()).toEqual(['conn:t1', 'alpha', 'beta', 'gamma'])
  })

  it('also restores the full tree when the sidebar passes the cleared value down', async () => {
    vi.resetModules()
    const store = await import('../src/client/remote-store.ts')
    await store.loadRemoteState()
    rows.projects.length = 0
    const tree = await import('../src/client/tree.tsx')
    render(tree.RemoteTree({ compact: true, search: 'beta' }))
    expect(projectKeys()).toEqual(['conn:t1', 'beta'])
    rows.projects.length = 0
    render(tree.RemoteTree({ compact: true, search: '' }))
    expect(projectKeys()).toEqual(['conn:t1', 'alpha', 'beta', 'gamma'])
  })
})
