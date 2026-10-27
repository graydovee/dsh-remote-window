/**
 * Vendored official UI assets: the patch wrapper must stay syntactically valid
 * and keep the exports the adapters depend on. A broken outer wrapper used to
 * fail only in the browser (`exports.ApprovalPanel` unreachable), while
 * typecheck and the plugin tests stayed green.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'

const ASSETS = join(import.meta.dirname, '..', 'assets', 'official-ui')

function asset(name: string): string {
  return readFileSync(join(ASSETS, name), 'utf8')
}

describe('vendored official UI bundles', () => {
  it('parses every shipped wrapper', () => {
    for (const name of ['conversation-client.js', 'chat-client.js', 'approval-client.js', 'model-client.js', 'tool-client.js']) {
      expect(() => new Script(asset(name), { filename: name }), name).not.toThrow()
    }
  })

  it('exposes the approval factory exactly once, with the official export patched in', () => {
    const source = asset('approval-client.js')
    expect(source.startsWith('window.__DSH_OFFICIAL_APPROVAL_LOAD__ = ({')).toBe(true)
    expect(source).toContain('\n}).factory;\n')
    expect(source).toContain('exports.ApprovalPanel = ApprovalPanel;')
    expect(source.match(/__DSH_OFFICIAL_APPROVAL_LOAD__/gu)).toHaveLength(1)
  })

  it('keeps the chat exports used by the native panel', () => {
    const source = asset('chat-client.js')
    for (const name of ['AssistantMarkdown', 'UserContent', 'MessageIconActions', 'ReasoningRow', 'UserMessageNodeView']) {
      expect(source).toContain(`exports.${name} =`)
    }
  })

  it('exposes the official tool row and conversation dictionary', () => {
    expect(asset('tool-client.js')).toContain('exports.ToolRow = ToolRow;')
    expect(asset('conversation-client.js')).toContain('exports.conversationZh = zh;')
  })

  it('exposes the official trajectory table and locale', () => {
    expect(asset('trajectory-client.js')).toContain('exports.TrajectoryTable = TrajectoryTable;')
    expect(asset('trajectory-client.js')).toContain('exports.trajectoryZh = zh;')
  })
})
