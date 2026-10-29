/**
 * Mux alias translation: local-mode anchors become server paths before the
 * execution-world request leaves the client.
 */
import { describe, expect, it } from 'vitest'
import { translateMuxAliases } from '../src/remote/ws-mux.ts'

const ALIASES = [{ stub: '/home/client/.dsh/remote-windows/client-1/rt-1/abc', remote: '/home/tester/work' }]

describe('translateMuxAliases', () => {
  it('rewrites exact and prefixed cwd/workspaceRoot but not argv text', () => {
    const out = translateMuxAliases({
      cwd: '/home/client/.dsh/remote-windows/client-1/rt-1/abc',
      workspaceRoot: '/home/client/.dsh/remote-windows/client-1/rt-1/abc/sub',
      argv: ['/bin/sh', '-c', 'pwd'],
      nested: { path: '/home/client/.dsh/remote-windows/client-1/rt-1/abc/file.txt' },
    }, ALIASES) as Record<string, unknown>
    expect(out.cwd).toBe('/home/tester/work')
    expect(out.workspaceRoot).toBe('/home/tester/work/sub')
    expect(out.argv).toEqual(['/bin/sh', '-c', 'pwd'])
    expect((out.nested as Record<string, unknown>).path).toBe('/home/tester/work/file.txt')
  })

  it('is a no-op without aliases or for unrelated paths', () => {
    const input = { cwd: '/home/client/anchor', other: '/tmp/x' }
    expect(translateMuxAliases(input, [])).toEqual(input)
    expect(translateMuxAliases(input, ALIASES)).toEqual(input)
  })
})
