/**
 * Full-screen official-UI main area without a browser.
 *
 * Walks the React element tree with hookless mocks and asserts the portal
 * contract the server needs: the same-origin portal prefix, `dshRwFull=1` (the
 * complete official shell, not the embed fallback), the iframe sandbox, and a
 * remount key that changes on every reconnect/target switch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const primitives = vi.hoisted(() => ({
  buttons: [] as Array<Record<string, unknown>>,
}))

const reactState = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
}))

vi.mock('react', () => ({
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  useEffect: () => {},
  useCallback: (callback: unknown) => callback,
  useRef: (value: unknown) => ({ current: value }),
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

beforeEach(() => {
  primitives.buttons.length = 0
})

describe('full-screen official UI main area', () => {
  it('renders nothing before a target is activated', async () => {
    const module = await import('../src/client/portal-main.tsx')
    expect(module.serverMainRequest()).toBeUndefined()
    expect(module.ServerMainPanel()).toBeNull()
  })

  it('mounts the portal with full=1 and the same-origin sandbox', async () => {
    const module = await import('../src/client/portal-main.tsx')
    module.openServerMain({ targetId: 't1', targetLabel: 'box' })
    const panel = module.ServerMainPanel()
    expect(panel).not.toBeNull()
    reactState.cursor = 0
    const frames = collect(panel, 'iframe')
    expect(frames).toHaveLength(1)
    const props = frames[0]?.props ?? {}
    expect(String(props.src)).toContain('/dsh-remote-window/portal/t1/')
    expect(String(props.src)).toContain('dshRwFull=1')
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
})
