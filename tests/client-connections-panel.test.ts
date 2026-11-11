/**
 * The 「远程连接」 panel without a browser.
 *
 * The panel is the client's pre-connection surface: one row per saved
 * connection, its live phase, and the connect/disconnect/forget verbs. The
 * shell renders it through the `main` slot, so the assertions are on the
 * element tree and on the store calls those clicks produce — the same pattern
 * as the other client specs (hook/JSX mocks, no React runtime in this repo).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from '../src/client/locales.ts'

const store = vi.hoisted(() => ({
  activate: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  forget: vi.fn(),
  openConnectDialog: vi.fn(),
  load: vi.fn(),
  refreshAll: vi.fn(),
  state: {} as Record<string, unknown>,
}))

vi.mock('../src/client/remote-store.ts', () => ({
  activateRemoteTarget: store.activate,
  connectRemoteTarget: store.connect,
  disconnectRemoteTarget: store.disconnect,
  loadRemoteState: store.load,
  openConnectDialog: store.openConnectDialog,
  refreshAllRemote: store.refreshAll,
  requestForgetTarget: store.forget,
  useRemoteAppState: () => store.state,
}))
vi.mock('../src/client/portal-main.tsx', () => ({
  useServerMainRequest: () => store.state.__active,
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: (props: Record<string, unknown>) => ({ type: 'mock-button', props }),
  StateDot: (props: Record<string, unknown>) => ({ type: 'mock-dot', props }),
  IconGlobeOutlineRegular: () => null,
  IconPlusOutlineRegular: () => null,
  IconRefreshOutlineRegular: () => null,
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

interface Element { type: unknown; props: Record<string, unknown> }

/** Walk a rendered element tree, calling function components with their props. */
function collect(node: unknown, output: Element[] = []): Element[] {
  if (node === null || node === undefined || typeof node === 'boolean') return output
  if (Array.isArray(node)) {
    for (const child of node) collect(child, output)
    return output
  }
  if (typeof node !== 'object') return output
  const element = node as Element
  output.push(element)
  if (typeof element.type === 'function') {
    collect((element.type as (props: Record<string, unknown>) => unknown)(element.props), output)
    return output
  }
  collect(element.props?.children, output)
  return output
}

function byTestId(elements: readonly Element[], testId: string): Element | undefined {
  return elements.find(element => element.props?.['data-testid'] === testId)
}

function allByTestId(elements: readonly Element[], testId: string): Element[] {
  return elements.filter(element => element.props?.['data-testid'] === testId)
}

/** Whether one element's text child equals `text`. */
function hasText(elements: readonly Element[], text: string): boolean {
  return elements.some(element => element.props?.children === text)
}

function view(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    target: {
      id: 't1', label: 'box', kind: 'ssh', host: '203.0.113.10', port: 22, username: 'tester', status: 'ready',
    },
    connection: { phase: 'ready' },
    stateLoad: { loading: false, loaded: true },
    sessionsLoad: { loading: false, loaded: false },
    ...overrides,
  }
}

const loadedState = {
  loaded: true,
  loading: false,
  pluginVersion: '0.1.0-alpha.7',
  order: [] as string[],
  connections: {} as Record<string, unknown>,
  pending: false,
}

async function render(): Promise<Element[]> {
  const module = await import('../src/client/connections-panel.tsx')
  return collect(module.RemoteConnectionsPanel())
}

beforeEach(() => {
  vi.clearAllMocks()
  store.state = { ...loadedState, order: [], connections: {} }
})

describe('connections panel', () => {
  it('shows the empty state and offers the connect dialog', async () => {
    const elements = await render()
    expect(byTestId(elements, 'dsh-rw-conn-empty')).toBeDefined()
    expect(byTestId(elements, 'dsh-rw-conn-loading')).toBeUndefined()
    expect(hasText(elements, t('connections.empty'))).toBe(true)
    expect(hasText(elements, t('connections.empty.hint'))).toBe(true)
    const newButton = byTestId(elements, 'dsh-rw-conn-new')
    expect(newButton?.props.children).toBe(t('list.newConnection'))
    ;(newButton?.props.onClick as (() => void) | undefined)?.()
    expect(store.openConnectDialog).toHaveBeenCalledTimes(1)
    // The empty state is the second entry into the same dialog.
    const empty = byTestId(elements, 'dsh-rw-conn-empty')
    ;(empty?.props.onClick as (() => void) | undefined)?.()
    expect(store.openConnectDialog).toHaveBeenCalledTimes(2)
  })

  it('activates the target when a row is clicked', async () => {
    store.state = { ...loadedState, order: ['t1'], connections: { t1: view() } }
    const elements = await render()
    const row = byTestId(elements, 'dsh-rw-conn-row')
    expect(row?.props['data-target-id']).toBe('t1')
    const open = byTestId(elements, 'dsh-rw-conn-open')
    expect(open?.props['aria-label']).toBe(t('connections.activate', { label: 'box' }))
    ;(open?.props.onClick as (() => void) | undefined)?.()
    expect(store.activate).toHaveBeenCalledWith('t1')
  })

  it('reconnects a stopped target and shows the reconnect wording', async () => {
    store.state = {
      ...loadedState,
      order: ['t1'],
      connections: { t1: view({ connection: { phase: 'stopped' } }) },
    }
    const elements = await render()
    const toggle = byTestId(elements, 'dsh-rw-conn-toggle')
    expect(toggle?.props.disabled).toBe(false)
    expect(toggle?.props.children).toBe(t('list.reconnect'))
    ;(toggle?.props.onClick as (() => void) | undefined)?.()
    expect(store.connect).toHaveBeenCalledWith('t1')
  })

  it('disconnects a live target instead of reconnecting it', async () => {
    store.state = { ...loadedState, order: ['t1'], connections: { t1: view() } }
    const elements = await render()
    const toggle = byTestId(elements, 'dsh-rw-conn-toggle')
    expect(toggle?.props.children).toBe(t('connections.disconnect'))
    ;(toggle?.props.onClick as (() => void) | undefined)?.()
    expect(store.disconnect).toHaveBeenCalledWith('t1')
  })

  it('asks before forgetting a connection', async () => {
    store.state = { ...loadedState, order: ['t1'], connections: { t1: view() } }
    const elements = await render()
    const forget = byTestId(elements, 'dsh-rw-conn-forget')
    expect(forget?.props.children).toBe(t('list.forget'))
    ;(forget?.props.onClick as (() => void) | undefined)?.()
    expect(store.forget).toHaveBeenCalledWith('t1')
  })

  it('highlights the target the official UI currently shows', async () => {
    store.state = {
      ...loadedState,
      order: ['t1', 't2'],
      connections: {
        t1: view(),
        t2: view({
          target: {
            id: 't2', label: 'box2', kind: 'ssh', host: '203.0.113.11', port: 22, username: 'tester', status: 'stopped',
          },
          connection: { phase: 'stopped' },
        }),
      },
      __active: { targetId: 't2' },
    }
    const elements = await render()
    const rows = allByTestId(elements, 'dsh-rw-conn-row')
    expect(rows).toHaveLength(2)
    const active = rows.filter(row => row.props['data-active'] === 'true')
    expect(active).toHaveLength(1)
    expect(active[0]?.props['data-target-id']).toBe('t2')
    const opens = allByTestId(elements, 'dsh-rw-conn-open')
    expect(opens.map(open => open.props['aria-current'])).toEqual([undefined, 'true'])
  })

  it('renders the loading state before the first snapshot arrives', async () => {
    store.state = { ...loadedState, loaded: false, loading: true }
    const elements = await render()
    expect(byTestId(elements, 'dsh-rw-conn-loading')).toBeDefined()
    expect(byTestId(elements, 'dsh-rw-conn-empty')).toBeUndefined()
    expect(byTestId(elements, 'dsh-rw-conn-error')).toBeUndefined()
  })

  it('renders a failed read as an error, never as an empty list', async () => {
    store.state = {
      ...loadedState,
      error: { code: 'network', message: 'host unreachable' },
    }
    const elements = await render()
    const error = byTestId(elements, 'dsh-rw-conn-error')
    expect(error).toBeDefined()
    expect(byTestId(elements, 'dsh-rw-conn-empty')).toBeUndefined()
    expect(hasText(elements, t('connections.loadFailed'))).toBe(true)
    expect(hasText(elements, 'host unreachable')).toBe(true)
    const retry = byTestId(elements, 'dsh-rw-conn-retry')
    expect(retry?.props.children).toBe(t('common.retry'))
    ;(retry?.props.onClick as (() => void) | undefined)?.()
    expect(store.load).toHaveBeenCalled()
  })

  it('keeps the last rows usable while a refresh failure is shown', async () => {
    store.state = {
      ...loadedState,
      order: ['t1'],
      connections: { t1: view() },
      error: { code: 'network', message: 'refresh failed' },
    }
    const elements = await render()
    expect(byTestId(elements, 'dsh-rw-conn-error')).toBeDefined()
    expect(byTestId(elements, 'dsh-rw-conn-list')).toBeDefined()
    expect(allByTestId(elements, 'dsh-rw-conn-row')).toHaveLength(1)
    expect(byTestId(elements, 'dsh-rw-conn-empty')).toBeUndefined()
  })

  it('shows a WSL target’s distribution instead of an SSH endpoint', async () => {
    store.state = {
      ...loadedState,
      order: ['t1'],
      connections: {
        t1: view({
          target: {
            id: 't1', label: 'wsl-box', kind: 'wsl', host: '', port: 0, username: 'tester',
            wslDistro: 'Ubuntu', status: 'ready',
          },
          connection: { phase: 'ready' },
        }),
      },
    }
    const elements = await render()
    expect(hasText(elements, `${t('connections.endpoint.wslDistro', { distro: 'Ubuntu' })} · ${t('remote.phase.ready')}`)).toBe(true)
  })

  it('disables the verbs while another store verb is pending', async () => {
    store.state = { ...loadedState, order: ['t1'], connections: { t1: view() }, pending: true }
    const elements = await render()
    expect(byTestId(elements, 'dsh-rw-conn-toggle')?.props.disabled).toBe(true)
    expect(byTestId(elements, 'dsh-rw-conn-forget')?.props.disabled).toBe(true)
  })
})
