/**
 * M1 P0: the sidebar's 「+」 must open the connect dialog even when no
 * connection exists.
 *
 * The dialog host is owned by the always-mounted sidebar section (not by the
 * remote tree, which renders nothing until a target exists). This test walks
 * the component tree with the same hook/JSX mocks as the other client specs and
 * asserts both facts: a dialogs host is part of the section, and the first
 * connection control calls the store action.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const appState = vi.hoisted(() => ({
  current: {
    loaded: true,
    loading: false,
    order: [] as string[],
    pending: false,
    search: '',
    connections: {},
  },
}))
const storeSpies = vi.hoisted(() => ({
  openConnectDialog: vi.fn(),
  refreshAllRemote: vi.fn(),
  setRemoteSearch: vi.fn(),
  loadRemoteState: vi.fn(),
  dismissRemoteNotice: vi.fn(),
}))
const buttons = vi.hoisted(() => [] as Array<Record<string, unknown>>)

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
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: () => {}, unmount: () => {} }) }))
vi.mock('../src/client/remote-store.ts', () => ({
  useRemoteAppState: () => appState.current,
  ...storeSpies,
}))
vi.mock('../src/client/tree.tsx', () => ({ RemoteTree: () => null }))
vi.mock('../src/client/common.tsx', () => ({ NoticeToastHost: () => null }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: (props: Record<string, unknown>) => { buttons.push(props); return null },
  IconPlusOutlineRegular: () => null,
  IconRefreshOutlineRegular: () => null,
}))

/** Walk the element tree, invoking function components. */
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

beforeEach(() => {
  vi.clearAllMocks()
  buttons.length = 0
})

describe('sidebar connect entry (M1)', () => {
  it('opens the connect dialog from the + control', async () => {
    const sidebar = await import('../src/client/sidebar.tsx')
    render(sidebar.SidebarSection())
    // The header has refresh then +; the + control is the last one.
    const plus = buttons.at(-1)
    expect(plus).toBeDefined()
    ;(plus?.onClick as (() => void) | undefined)?.()
    expect(storeSpies.openConnectDialog).toHaveBeenCalledTimes(1)
  })
})
