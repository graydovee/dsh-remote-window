import { describe, expect, it } from 'vitest'
import { executionHostText, installRemoteContext, remoteWorkingDirectoryText } from '../src/session/remote-context.ts'

const target = { label: 'buildbox', host: '203.0.113.10', port: 22, username: 'tester' }

describe('remote execution-world context', () => {
  it('states only the execution host and the real remote working directory', () => {
    expect(executionHostText(target)).toBe('Execution host: buildbox (tester@203.0.113.10:22).')
    expect(remoteWorkingDirectoryText('/home/user/projects/example-project'))
      .toBe('Current working directory: "/home/user/projects/example-project".')
  })

  it('registers a non-interpolated runtime context section on the agent scope', () => {
    const calls: Array<{ name: string; text: string; order: number; interpolate: boolean }> = []
    const ctx = { systemPrompt: { context: (value: typeof calls[number]) => { calls.push(value) } } }
    installRemoteContext(ctx as never, { target, remotePath: '/srv/project' })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ name: 'working-directory:current', required: true, interpolate: false })
    expect(calls[0]?.text).toBe('Current working directory: "/srv/project".')
    expect(calls[1]).toMatchObject({ name: 'remote-workspace/execution-host', interpolate: false })
    expect(calls[1]?.text).toBe('Execution host: buildbox (tester@203.0.113.10:22).')
  })
})
