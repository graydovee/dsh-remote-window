/** Native composer key semantics and tool argument formatting. */
import { describe, expect, it, vi } from 'vitest'

vi.mock('react', () => ({
  useEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
}))
vi.mock('react/jsx-runtime', () => ({
  Fragment: Symbol.for('react.fragment'),
  jsx: () => null,
  jsxs: () => null,
}))
vi.mock('react/jsx-dev-runtime', () => ({
  Fragment: Symbol.for('react.fragment'),
  jsx: () => null,
  jsxs: () => null,
  jsxDEV: () => null,
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Menu: () => null,
  PermissionIconReadOnlyRegular: () => null,
  PermissionIconWorkspaceWriteRegular: () => null,
  PermissionIconFullAccessRegular: () => null,
  Button: () => null,
  Tooltip: () => null,
  CodeBlock: () => null,
  DiffBlock: () => null,
  JsonBlock: () => null,
  ReadBlock: () => null,
  SearchBlock: () => null,
  TerminalBlock: () => null,
  IconCheckCircleFillRegular: () => null,
  IconChevronDownOutlineRegular: () => null,
  IconChevronRightOutlineRegular: () => null,
  IconWarningTriangleOutlineRegular: () => null,
}))
import { composerKeyAction } from '../src/client/session-composer.tsx'
import {
  formatToolArguments, parseDiffOutput, parseReadOutput, parseSearchOutput, toolBlockKind,
} from '../src/client/session-tools.tsx'

const idle = { key: 'Enter', shiftKey: false, isComposing: false, running: false, disabled: false }

describe('composer key semantics', () => {
  it('sends on Enter', () => {
    expect(composerKeyAction(idle)).toBe('send')
  })

  it('keeps Shift+Enter as a newline', () => {
    expect(composerKeyAction({ ...idle, shiftKey: true })).toBe('newline')
  })

  it('never sends while the IME is composing', () => {
    expect(composerKeyAction({ ...idle, isComposing: true })).toBe('ignore')
  })

  it('never sends while a turn is running or the composer is disabled', () => {
    expect(composerKeyAction({ ...idle, running: true })).toBe('ignore')
    expect(composerKeyAction({ ...idle, disabled: true })).toBe('ignore')
  })

  it('ignores other keys', () => {
    expect(composerKeyAction({ ...idle, key: 'a' })).toBe('ignore')
  })
})

describe('tool argument formatting', () => {
  it('pretty-prints objects and passes strings through', () => {
    expect(formatToolArguments({ command: 'ls' })).toContain('"command": "ls"')
    expect(formatToolArguments('plain')).toBe('plain')
    expect(formatToolArguments(undefined)).toBe('')
  })

  it('does not throw on cyclic values', () => {
    const value: Record<string, unknown> = {}
    value.self = value
    expect(formatToolArguments(value)).toContain('object')
  })
})

describe('official tool block selection', () => {
  it('picks terminal/read/search/diff/json/code from the tool name', () => {
    expect(toolBlockKind('bash')).toBe('terminal')
    expect(toolBlockKind('read_file')).toBe('read')
    expect(toolBlockKind('grep')).toBe('search')
    expect(toolBlockKind('apply_patch')).toBe('diff')
    expect(toolBlockKind('json')).toBe('json')
    expect(toolBlockKind('mystery')).toBe('code')
  })

  it('parses read output into numbered lines', () => {
    const parsed = parseReadOutput('1→first\n2→second')
    expect(parsed.lines).toEqual([{ number: 1, text: 'first' }, { number: 2, text: 'second' }])
    expect(parsed.totalLines).toBe(2)
  })

  it('parses grep output into the SearchBlock matches shape', () => {
    const parsed = parseSearchOutput('src/a.ts:3:hello\nsrc/a.ts:9:world\nsrc/b.ts:1:other')
    expect(parsed?.files).toHaveLength(2)
    expect(parsed?.files[0]).toEqual({ path: 'src/a.ts', matches: [{ lineNumber: 3, line: 'hello' }, { lineNumber: 9, line: 'world' }] })
    expect(parsed?.total).toBe(3)
  })

  it('parses a unified diff into DiffBlock hunks', () => {
    const parsed = parseDiffOutput('--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new')
    expect(parsed?.[0]?.path).toBe('b/file.ts')
    expect(parsed?.[0]?.oldText).toBe('old')
    expect(parsed?.[0]?.newText).toBe('new')
  })
})
