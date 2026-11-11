/**
 * Full-screen official-UI main area without a browser.
 *
 * Walks the React element tree with hookless mocks and asserts the portal
 * contract the server needs: the same-origin portal prefix, the mounted target
 * in the query, `dshRwFull=1` (the complete official shell, not the embed
 * fallback), the iframe sandbox, a remount key that changes on every
 * reconnect/target switch, and the three portal commands the mirrored
 * server-side list sends back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  rwPortalClosePortal,
  rwPortalOpenConnectDialog,
  rwPortalSwitchTarget,
} from '../src/protocol.ts'

const ORIGIN = 'http://127.0.0.1:60900'

const primitives = vi.hoisted(() => ({
  buttons: [] as Array<Record<string, unknown>>,
}))

const reactState = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
}))

/** Messages the mocked `window` received, keyed by event type. */
const windowListeners = vi.hoisted(() => new Map<string, (event: MessageEvent) => void>())

/** The window object the mocked `iframeRef` points at. */
const iframeWindow = vi.hoisted(() => ({ postMessage: () => {} }))

vi.mock('react', () => ({
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  useEffect: (callback: () => void) => { callback() },
  useCallback: (callback: unknown) => callback,
  useRef: () => ({ current: { contentWindow: iframeWindow } }),
  useState: (initial: unknown) => {
    const index = reactState.cursor++
    const value = index < reactState.values.length
      ? reactState.values[index]
      : typeof initial === 'function' ? (initial as () => unknown)() : initial
    return [value, () => {}]
  },
}))
vi.mock('react/jsx-runtime', () => ({
  Fragment: Symbol.for('react.fragment'),
  jsx: (type: unknown, props: unknown, key?: unknown) => ({ type, props: key === undefined ? (props ?? {}) : { ...(props as Record<string, unknown> ?? {}), key } }),
  jsxs: (type: unknown, props: unknown, key?: unknown) => ({ type, props: key === undefined ? (props ?? {}) : { ...(props as Record<string, unknown> ?? {}), key } }),
  jsxDEV: (type: unknown, props: unknown, key?: unknown) => ({ type, props: key === undefined ? (props ?? {}) : { ...(props as Record<string, unknown> ?? {}), key } }),
}))
vi.mock('react/jsx-dev-runtime', () => ({
  Fragment: Symbol.for('react.fragment'),
  jsx: (type: unknown, props: unknown, key?: unknown) => ({ type, props: key === undefined ? (props ?? {}) : { ...(props as Record<string, unknown> ?? {}), key } }),
  jsxs: (type: unknown, props: unknown, key?: unknown) => ({ type, props: key === undefined ? (props ?? {}) : { ...(props as Record<string, unknown> ?? {}), key } }),
  jsxDEV: (type: unknown, props: unknown, key?: unknown) => ({ type, props: key === undefined ? (props ?? {}) : { ...(props as Record<string, unknown> ?? {}), key } }),
}))
vi.mock('react-dom', () => ({
  createPortal: (node: unknown) => node,
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: (props: Record<string, unknown>) => { primitives.buttons.push(props); return null },
  IconRefreshOutlineRegular: () => null,
  IconWarningTriangleOutlineRegular: () => null,
}))

// The main area registers its message bridge on render; a DOM-less test needs
// the two window facts it reads (origin + listener registry).
vi.stubGlobal('window', {
  location: { origin: ORIGIN },
  addEventListener: (type: string, listener: (event: MessageEvent) => void): void => {
    windowListeners.set(type, listener)
  },
  removeEventListener: (type: string): void => { windowListeners.delete(type) },
})

interface Element { type: unknown; props: Record<string, unknown> }

/** Collect every intrinsic element of one type from a rendered tree. */
function collect(node: unknown, wanted: string, output: Element[] = []): Element[] {
  if (node === null || node === undefined || typeof node === 'boolean') return output
  if (Array.isArray(node)) {
    for (const child of node) collect(child, wanted, output)
    return output
  }
  if (typeof node !== 'object') return output
  const element = node as Element
  if (element.type === wanted) output.push(element)
  if (typeof element.type === 'function') {
    collect((element.type as (props: Record<string, unknown>) => unknown)(element.props), wanted, output)
    return output
  }
  collect(element.props?.children, wanted, output)
  return output
}

/** Dispatch one child message the way the iframe would. */
function dispatch(data: unknown, overrides: { origin?: string; source?: unknown } = {}): void {
  const listener = windowListeners.get('message')
  if (listener === undefined) throw new Error('the main area registered no message listener')
  listener({
    origin: overrides.origin ?? ORIGIN,
    source: overrides.source ?? iframeWindow,
    data,
  } as MessageEvent)
}

beforeEach(() => {
  primitives.buttons.length = 0
  windowListeners.clear()
})

afterEach(async () => {
  const module = await import('../src/client/portal-main.tsx')
  module.closeServerMain()
})

describe('full-screen official UI main area', () => {
  it('renders nothing before a target is activated', async () => {
    const module = await import('../src/client/portal-main.tsx')
    expect(module.serverMainRequest()).toBeUndefined()
    expect(module.ServerMainPanel()).toBeNull()
  })

  it('mounts the portal with full=1, the target and the same-origin sandbox', async () => {
    const module = await import('../src/client/portal-main.tsx')
    module.openServerMain({ targetId: 't1', targetLabel: 'box' })
    const panel = module.ServerMainPanel()
    expect(panel).not.toBeNull()
    reactState.cursor = 0
    const frames = collect(panel, 'iframe')
    expect(frames).toHaveLength(1)
    const props = frames[0]?.props ?? {}
    expect(String(props.src)).toContain('/dsh-remote-workspace/portal/t1/')
    expect(String(props.src)).toContain('dshRwFull=1')
    expect(String(props.src)).toContain('dshRwTarget=t1')
    expect(String(props.src)).not.toContain('token')
    expect(props.sandbox).toBe('allow-scripts allow-same-origin allow-forms allow-popups allow-downloads')
    expect(props.title).toContain('box')
    expect(props.onLoad).toBeTypeOf('function')
  })

  it('remounts with a new key on every activation and tears down on close', async () => {
    const module = await import('../src/client/portal-main.tsx')
    module.openServerMain({ targetId: 't1', targetLabel: 'box' })
    const first = collect(module.ServerMainPanel(), 'iframe')[0]?.props.key
    module.openServerMain({ targetId: 't1', targetLabel: 'box' })
    reactState.cursor = 0
    const second = collect(module.ServerMainPanel(), 'iframe')[0]?.props.key
    expect(first).not.toBe(second)
    module.closeServerMain()
    expect(module.ServerMainPanel()).toBeNull()
  })

  it('notifies subscribers and exposes the selected session', async () => {
    const module = await import('../src/client/portal-main.tsx')
    const listener = vi.fn()
    const unsubscribe = module.subscribeServerMain(listener)
    module.openServerMain({ targetId: 't1', targetLabel: 'box', sessionId: 's1' })
    expect(listener).toHaveBeenCalled()
    expect(module.serverMainSessionId()).toBe('s1')
    expect(module.serverMainRequest()).toMatchObject({ targetId: 't1' })
    unsubscribe()
    module.closeServerMain()
  })

  it('dispatches the three portal commands to the bound handlers', async () => {
    const module = await import('../src/client/portal-main.tsx')
    const handlers = { switchTarget: vi.fn(), openConnectDialog: vi.fn(), closePortal: vi.fn() }
    module.bindPortalCommandHandlers(handlers)
    module.openServerMain({ targetId: 't1', targetLabel: 'box' })
    collect(module.ServerMainPanel(), 'iframe')
    dispatch(rwPortalSwitchTarget('t2'))
    expect(handlers.switchTarget).toHaveBeenCalledWith('t2')
    dispatch(rwPortalOpenConnectDialog())
    expect(handlers.openConnectDialog).toHaveBeenCalledTimes(1)
    dispatch(rwPortalClosePortal())
    expect(handlers.closePortal).toHaveBeenCalledTimes(1)
  })

  it('accepts readiness but ignores forged or malformed child messages', async () => {
    const module = await import('../src/client/portal-main.tsx')
    const handlers = { switchTarget: vi.fn(), openConnectDialog: vi.fn(), closePortal: vi.fn() }
    module.bindPortalCommandHandlers(handlers)
    module.openServerMain({ targetId: 't1', targetLabel: 'box' })
    collect(module.ServerMainPanel(), 'iframe')

    // Readiness is a lifecycle signal, not a command.
    dispatch({ v: 1, type: 'dsh-rw/ready' })
    // Wrong origin, wrong source window, wrong revision, unknown type.
    dispatch(rwPortalSwitchTarget('t2'), { origin: 'http://evil.example' })
    dispatch(rwPortalSwitchTarget('t2'), { source: { postMessage: () => {} } })
    dispatch({ v: 2, type: 'dsh-rw/switch-target', targetId: 't2' })
    dispatch({ v: 1, type: 'dsh-rw/unknown' })
    dispatch({ v: 1, type: 'dsh-rw/switch-target', targetId: '' })
    expect(handlers.switchTarget).not.toHaveBeenCalled()
    expect(handlers.openConnectDialog).not.toHaveBeenCalled()
    expect(handlers.closePortal).not.toHaveBeenCalled()

    // A well-formed command from the mounted frame still works.
    dispatch(rwPortalSwitchTarget('t2'))
    expect(handlers.switchTarget).toHaveBeenCalledWith('t2')
  })
})
