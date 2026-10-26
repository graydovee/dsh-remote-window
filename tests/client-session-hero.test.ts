/**
 * Official-DOM checks for the empty-session hero/composer.
 *
 * These pin the exact 0.2.1-rc.3 class names from the shell stylesheet so a
 * future refactor cannot silently fall back to a hand-drawn card. Hookless
 * element walking keeps the test dependency-free.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('react', () => ({
  useEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
}))
vi.mock('react/jsx-runtime', () => ({
  Fragment: Symbol.for('react.fragment'),
  jsx: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
  jsxs: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
}))
vi.mock('react/jsx-dev-runtime', () => ({
  Fragment: Symbol.for('react.fragment'),
  jsx: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
  jsxs: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
  jsxDEV: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
}))

interface Collected {
  classes: string[]
  buttons: Array<Record<string, unknown>>
  text: string[]
}

function collect(node: unknown, out: Collected): void {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') { out.text.push(String(node)); return }
  if (Array.isArray(node)) { for (const child of node) collect(child, out); return }
  if (typeof node !== 'object') return
  const element = node as { type?: unknown; props?: Record<string, unknown> }
  if (typeof element.type === 'string' && element.type === 'button') out.buttons.push(element.props ?? {})
  const cls = element.props?.['className']
  if (typeof cls === 'string') out.classes.push(...cls.split(/\s+/).filter(Boolean))
  if (typeof element.type === 'function') {
    collect((element.type as (props: unknown) => unknown)(element.props), out)
    return
  }
  collect(element.props?.['children'], out)
}

const composer = {
  value: '',
  onChange: () => {},
  onSend: () => {},
  onStop: () => {},
  running: false,
  attachmentReason: '附件暂不可用',
}

describe('official empty hero DOM', () => {
  it('uses the shell hero, workspace row and preset classes', async () => {
    const { SessionHero } = await import('../src/client/session-hero.tsx')
    const out: Collected = { classes: [], buttons: [], text: [] }
    collect(SessionHero({ composer, workspaceLabel: 'uap-lite' }), out)
    expect(out.classes).toContain('ST7X_W_composerStack')
    expect(out.classes).toContain('ST7X_W_composerHero')
    expect(out.classes).toContain('bocITq_root')
    expect(out.classes).toContain('bocITq_fish')
    expect(out.classes).toContain('bocITq_previewBadge')
    expect(out.classes).toContain('ST7X_W_heroWorkspaceRow')
    expect(out.classes).toContain('bocITq_workspace')
    expect(out.classes).toContain('m0vb0q_seat')
    expect(out.classes).toContain('yhfFVG_card')
    expect(out.text.join(' ')).toContain('uap-lite')
  })

  it('renders the official composer card, chips, plus and circular send button', async () => {
    const { SessionComposer } = await import('../src/client/session-composer.tsx')
    const out: Collected = { classes: [], buttons: [], text: [] }
    collect(SessionComposer({ ...composer, variant: 'hero' }), out)
    expect(out.classes).toContain('yhfFVG_hero')
    expect(out.classes).toContain('yhfFVG_card')
    expect(out.classes).toContain('yhfFVG_input')
    expect(out.classes).toContain('yhfFVG_placeholder')
    expect(out.classes).toContain('yhfFVG_add')
    expect(out.classes).toContain('wXeviG_trigger')
    expect(out.classes).toContain('cl2Rlq_trigger')
    expect(out.classes).toContain('yhfFVG_primary')
    const plus = out.buttons.find(button => button['className'] === 'yhfFVG_add')
    expect(plus?.['disabled']).toBe(true)
    const send = out.buttons.find(button => button['className'] === 'yhfFVG_primary')
    expect(send?.['aria-label']).toContain('发送')
    expect(send?.['disabled']).toBe(true)
  })
})
