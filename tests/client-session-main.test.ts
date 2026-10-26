/**
 * Native session main-area smoke test without a browser.
 *
 * Walks the React element tree with hookless mocks, records the official
 * primitive usage and asserts the shell composes the v2 timeline rows,
 * approval card, composer and empty/error states. Network/SSE stays in the
 * integration layer, so this test stays presentational.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionTimelineEntry } from '../src/client/session-timeline.ts'

const recorded = vi.hoisted(() => ({
  composer: [] as Array<Record<string, unknown>>,
  tools: [] as Array<{ card: string; props: Record<string, unknown> }>,
  approvals: [] as Array<Record<string, unknown>>,
  buttons: [] as Array<Record<string, unknown>>,
  markdown: [] as Array<Record<string, unknown>>,
  classes: [] as string[],
}))

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
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  MarkdownText: (props: Record<string, unknown>) => { recorded.markdown.push(props); return null },
  Button: (props: Record<string, unknown>) => { recorded.buttons.push(props); return null },
  Tooltip: (props: { children?: unknown }) => props.children ?? null,
  StateDot: () => null,
  IconCheckCircleFillRegular: () => null,
  IconChevronDownOutlineRegular: () => null,
  IconChevronRightOutlineRegular: () => null,
  IconRefreshOutlineRegular: () => null,
  IconWarningTriangleOutlineRegular: () => null,
}))
vi.mock('../src/client/session-composer.tsx', () => ({
  SessionComposer: (props: Record<string, unknown>) => { recorded.composer.push(props); return null },
}))
vi.mock('../src/client/session-tools.tsx', () => ({
  ToolCallCard: (props: Record<string, unknown>) => { recorded.tools.push({ card: 'call', props }); return null },
  ToolResultCard: (props: Record<string, unknown>) => { recorded.tools.push({ card: 'result', props }); return null },
}))
vi.mock('../src/client/session-approval.tsx', () => ({
  SessionApprovalCard: (props: Record<string, unknown>) => { recorded.approvals.push(props); return null },
}))

function render(node: unknown): void {
  if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'string') return
  if (Array.isArray(node)) { for (const child of node) render(child); return }
  if (typeof node !== 'object') return
  const element = node as { type?: unknown; props?: { children?: unknown; className?: string } }
  if (typeof element.props?.className === 'string') recorded.classes.push(element.props.className)
  if (typeof element.type === 'function') {
    render((element.type as (props: unknown) => unknown)(element.props))
    return
  }
  if (element.props !== undefined) render(element.props.children)
}

const REQUEST = {
  targetId: 't1',
  targetLabel: 'box',
  workspaceId: 'w1',
  workspaceTitle: 'project',
  sessionId: 's1',
  title: 'Build the thing',
}

function entries(): SessionTimelineEntry[] {
  return [
    { kind: 'user', id: 'u1', seq: 1, text: 'hello' },
    { kind: 'assistant', id: 'a1', seq: 2, text: '**hi**', streaming: true },
    { kind: 'reasoning', id: 'r1', seq: 3, text: 'thinking' },
    { kind: 'tool-call', id: 'c1', seq: 4, callId: 'call-1', name: 'bash', arguments: { command: 'ls' }, status: 'running' },
    { kind: 'tool-result', id: 'tr1', seq: 5, callId: 'call-1', name: 'bash', output: 'file.txt' },
    { kind: 'approval', id: 'ap1', seq: 6, approvalId: 'approval-1', toolName: 'bash', status: 'pending' },
    { kind: 'error', id: 'e1', seq: 7, code: 'stream/failed', message: 'stream failed' },
    { kind: 'turn', id: 'turn-1', seq: 8, turn: 1, phase: 'end', status: 'completed' },
  ]
}

beforeEach(() => {
  recorded.composer.length = 0
  recorded.tools.length = 0
  recorded.approvals.length = 0
  recorded.buttons.length = 0
  recorded.markdown.length = 0
  recorded.classes.length = 0
})

describe('NativeSessionMain shell', () => {
  it('renders every v2 row kind through the official primitives', async () => {
    const module = await import('../src/client/session-main.tsx')
    const onApproval = vi.fn()
    render(module.NativeSessionMain({
      request: REQUEST,
      entries: entries(),
      status: 'idle',
      hasMoreBefore: true,
      onLoadBefore: vi.fn(),
      onSend: vi.fn(),
      onStop: vi.fn(),
      onApproval,
    }))
    expect(recorded.composer).toHaveLength(1)
    expect(recorded.composer[0]).toMatchObject({ running: false, disabled: false, variant: 'composer' })
    expect(recorded.markdown.length).toBeGreaterThanOrEqual(2)
    expect(recorded.tools.map(item => item.card)).toEqual(['call', 'result'])
    expect(recorded.tools[1]?.props.call).toMatchObject({ callId: 'call-1', name: 'bash' })
    expect(recorded.approvals).toHaveLength(1)
    const approval = recorded.approvals[0] as { entry: unknown; onDecision: (id: string, decision: string) => void }
    expect(approval.entry).toMatchObject({ approvalId: 'approval-1' })
    approval.onDecision('approval-1', 'allow')
    expect(onApproval).toHaveBeenCalledWith('approval-1', 'allow')
  })

  it('turns the send button into stop while running and disables during reconnect', async () => {
    const module = await import('../src/client/session-main.tsx')
    render(module.NativeSessionMain({
      request: REQUEST,
      entries: [],
      status: 'running',
      hasMoreBefore: false,
      reconnecting: true,
      onLoadBefore: vi.fn(),
      onSend: vi.fn(),
      onStop: vi.fn(),
      onApproval: vi.fn(),
    }))
    expect(recorded.composer[0]).toMatchObject({ running: true, disabled: true })
  })

  it('renders the official hero + hero composer for an idle blank session', async () => {
    const module = await import('../src/client/session-main.tsx')
    render(module.NativeSessionMain({
      request: REQUEST,
      entries: [],
      status: 'idle',
      hasMoreBefore: false,
      onLoadBefore: vi.fn(),
      onSend: vi.fn(),
      onStop: vi.fn(),
      onApproval: vi.fn(),
    }))
    expect(recorded.classes).toContain('ST7X_W_composerStack ST7X_W_composerHero')
    expect(recorded.classes).toContain('bocITq_headline')
    expect(recorded.classes).toContain('ST7X_W_heroWorkspaceRow')
    expect(recorded.composer).toHaveLength(1)
    expect(recorded.composer[0]).toMatchObject({ variant: 'hero' })
  })
})

describe('native main selection store', () => {
  it('opens, navigates and closes the request; subscribers fire', async () => {
    const module = await import('../src/client/session-main.tsx')
    const listener = vi.fn()
    const unsubscribe = module.subscribeNativeSession(listener)
    module.openNativeSession(REQUEST)
    expect(module.nativeSessionId()).toBe('s1')
    expect(module.nativeSessionRequest()).toMatchObject(REQUEST)
    expect(listener).toHaveBeenCalled()
    module.navigateNativeSession('s2')
    expect(module.nativeSessionId()).toBe('s2')
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2)
    module.closeNativeSession()
    expect(module.nativeSessionRequest()).toBeUndefined()
    unsubscribe()
  })
})
