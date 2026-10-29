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

  it('docks to the nearest edge and clamps the offset along it', async () => {
    const module = await import('../src/client/rail.tsx')
    const viewport = { width: 1440, height: 900 }
    expect(module.snapRailPlacement({ x: 2, y: 400 }, viewport)).toEqual({ dock: 'left', offset: 378 })
    expect(module.snapRailPlacement({ x: 1438, y: 400 }, viewport)).toEqual({ dock: 'right', offset: 378 })
    expect(module.snapRailPlacement({ x: 700, y: 3 }, viewport)).toEqual({ dock: 'top', offset: 678 })
    expect(module.snapRailPlacement({ x: 700, y: 897 }, viewport)).toEqual({ dock: 'bottom', offset: 678 })
    // Corners clamp to the margin instead of leaving the viewport.
    expect(module.snapRailPlacement({ x: 1, y: 1 }, viewport)).toEqual({ dock: 'left', offset: 10 })
    expect(module.snapRailPlacement({ x: 1439, y: 899 }, viewport)).toEqual({ dock: 'right', offset: 846 })
    // A tiny viewport still produces a valid on-screen offset.
    expect(module.snapRailPlacement({ x: 200, y: 50 }, { width: 400, height: 100 })).toEqual({ dock: 'top', offset: 178 })
  })

  it('keeps a snapped placement inside the viewport when the window resizes', async () => {
    const module = await import('../src/client/rail.tsx')
    expect(module.clampRailPlacement({ dock: 'top', offset: 9999 }, { width: 1440, height: 900 })).toEqual({ dock: 'top', offset: 1386 })
    expect(module.clampRailPlacement({ dock: 'left', offset: -20 }, { width: 1440, height: 900 })).toEqual({ dock: 'left', offset: 10 })
    // Zero-sized viewports (SSR / before layout) leave the placement untouched.
    expect(module.clampRailPlacement({ dock: 'right', offset: 40 }, { width: 0, height: 0 })).toEqual({ dock: 'right', offset: 40 })
  })

  it('sizes a collapsed horizontal bar from the target count', async () => {
    const module = await import('../src/client/rail.tsx')
    // One compact glyph chip per target plus padding, never below 44px.
    expect(module.railBarWidth(0)).toBe(44)
    expect(module.railBarWidth(9)).toBe(318)
    expect(module.railBarWidth(1)).toBe(46)
  })

  it('anchors an expanded dock as a vertical list inside the viewport', async () => {
    const module = await import('../src/client/rail.tsx')
    const viewport = { width: 1440, height: 900 }
    // Expanded docks are always the vertical 280px list, so only the anchor
    // (top/bottom) and the horizontal offset differ between edges.
    expect(module.railBoxStyle({ dock: 'top', offset: 678 }, true, 9, viewport)).toEqual({
      top: 10,
      left: 678,
      maxHeight: 880,
    })
    expect(module.railBoxStyle({ dock: 'bottom', offset: 678 }, true, 9, viewport)).toEqual({
      bottom: 10,
      left: 678,
      maxHeight: 880,
    })
    // The expanded list clamps its left edge so the 280px box stays on screen.
    expect(module.railBoxStyle({ dock: 'top', offset: 1400 }, true, 9, viewport)).toEqual({
      top: 10,
      left: 1150,
      maxHeight: 880,
    })
    // Collapsed bars reserve the full strip width and stay on screen too.
    expect(module.railBoxStyle({ dock: 'top', offset: 1400 }, false, 9, viewport)).toEqual({
      top: 10,
      left: 1112,
      width: 318,
    })
    // A zero-sized viewport (SSR / before layout) still yields finite values.
    expect(module.railBoxStyle({ dock: 'bottom', offset: 40 }, true, 3, { width: 0, height: 0 })).toEqual({
      bottom: 10,
      left: 10,
      maxHeight: 44,
    })
    // Side docks only carry their vertical offset.
    expect(module.railBoxStyle({ dock: 'left', offset: 96 }, true, 9, viewport)).toEqual({ left: 10, top: 96 })
    expect(module.railBoxStyle({ dock: 'right', offset: 398 }, false, 9, viewport)).toEqual({ right: 10, top: 398 })
  })

  it('renders the rail at its default left dock with a position style', async () => {
    store.state = {
      loaded: true,
      loading: false,
      order: ['t1'],
      connections: { t1: view() },
    }
    const module = await import('../src/client/rail.tsx')
    const rail = collect(module.TargetRail()).find(element => element.props?.className === 'dsh-rw-rail')
    expect(rail).toBeDefined()
    expect(rail?.props['data-dock']).toBe('left')
    expect(rail?.props['data-expanded']).toBeUndefined()
    expect((rail?.props.style as Record<string, unknown>).left).toBe(10)
    expect((rail?.props.style as Record<string, unknown>).top).toBe(96)
  })
})
