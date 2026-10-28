/**
 * Floating target rail (v3 chrome) without a browser.
 *
 * The rail is the only client-owned navigation left: one row per saved target,
 * activation switching/reconnecting the full-screen official UI, and the
 * existing dialogs staying reachable. Assertions are on the element tree and
 * on the store calls those clicks produce.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  activate: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  openConnectDialog: vi.fn(),
  refreshAll: vi.fn(),
  load: vi.fn(),
  forget: vi.fn(),
  dismissNotice: vi.fn(),
  state: {
    loaded: true,
    loading: false,
    order: [] as string[],
    connections: {} as Record<string, unknown>,
  } as Record<string, unknown>,
}))

vi.mock('../src/client/remote-store.ts', () => ({
  activateRemoteTarget: store.activate,
  connectRemoteTarget: store.connect,
  disconnectRemoteTarget: store.disconnect,
  dismissRemoteNotice: store.dismissNotice,
  loadRemoteState: store.load,
  openConnectDialog: store.openConnectDialog,
  refreshAllRemote: store.refreshAll,
  requestForgetTarget: store.forget,
  useRemoteAppState: () => store.state,
}))
vi.mock('../src/client/remote-dialogs.tsx', () => ({ RemoteDialogs: () => null }))
vi.mock('../src/client/common.tsx', () => ({ NoticeToastHost: () => null }))
vi.mock('../src/client/portal-main.tsx', () => ({
  useServerMainRequest: () => store.state.__active,
}))
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: () => {}, unmount: () => {} }) }))
vi.mock('react', () => ({
  useEffect: () => {},
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
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconPlusOutlineRegular: () => null,
  IconRefreshOutlineRegular: () => null,
  IconWarningTriangleOutlineRegular: () => null,
}))

interface Element { type: unknown; props: Record<string, unknown> }

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

/** All intrinsic `<button>` elements in render order. */
function buttons(node: unknown): Array<Record<string, unknown>> {
  return collect(node).filter(element => element.type === 'button').map(element => element.props)
}

function view(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    target: {
      id: 't1', label: 'box', kind: 'ssh', host: '203.0.113.10', port: 22, username: 'tester', status: 'ready',
    },
    connection: { phase: 'ready' },
    groups: [],
    expanded: {},
    mode: 'server',
    stateLoad: { loading: false, loaded: true },
    sessionsLoad: { loading: false, loaded: false },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  store.state = {
    loaded: true,
    loading: false,
    order: [],
    connections: {},
  }
})

describe('target rail', () => {
  it('offers the connect dialog when no target is saved', async () => {
    const module = await import('../src/client/rail.tsx')
    const rendered = buttons(module.TargetRail())
    expect(rendered.length).toBeGreaterThan(0)
    const add = rendered.find(button => button['aria-label'] === '新建连接')
    expect(add).toBeDefined()
    ;(add?.onClick as (() => void) | undefined)?.()
    expect(store.openConnectDialog).toHaveBeenCalled()
  })

  it('activates a live target and highlights it in the rail', async () => {
    store.state = {
      loaded: true,
      loading: false,
      order: ['t1'],
      connections: { t1: view() },
      __active: { targetId: 't1' },
    }
    const module = await import('../src/client/rail.tsx')
    const rendered = buttons(module.TargetRail())
    const main = rendered.find(button => String(button['aria-label']).includes('切换'))
    expect(main).toBeDefined()
    ;(main?.onClick as (() => void) | undefined)?.()
    expect(store.activate).toHaveBeenCalledWith('t1')
    const chip = collect(module.TargetRail()).find(element => element.props?.['data-active'] === 'true')
    expect(chip).toBeDefined()
  })

  it('connects a stopped target and exposes disconnect/forget in the expanded rail', async () => {
    store.state = {
      loaded: true,
      loading: false,
      order: ['t1'],
      connections: { t1: view({ connection: { phase: 'stopped' } }) },
    }
    const module = await import('../src/client/rail.tsx')
    const rendered = buttons(module.TargetRail())
    expect(rendered.some(button => String(button['aria-label']) === '重新连接')).toBe(true)
    const connect = rendered.find(button => String(button['aria-label']) === '重新连接')
    ;(connect?.onClick as (() => void) | undefined)?.()
    expect(store.connect).toHaveBeenCalledWith('t1')
    const forget = rendered.find(button => String(button['aria-label']) === '删除连接')
    ;(forget?.onClick as (() => void) | undefined)?.()
    expect(store.forget).toHaveBeenCalledWith('t1')
  })

  it('keeps the connect action for a live target (disconnect)', async () => {
    store.state = {
      loaded: true,
      loading: false,
      order: ['t1'],
      connections: { t1: view() },
    }
    const module = await import('../src/client/rail.tsx')
    const rendered = buttons(module.TargetRail())
    const disconnect = rendered.find(button => String(button.title ?? button['aria-label']) === '停止')
    expect(disconnect).toBeDefined()
    ;(disconnect?.onClick as (() => void) | undefined)?.()
    expect(store.disconnect).toHaveBeenCalledWith('t1')
  })
})
