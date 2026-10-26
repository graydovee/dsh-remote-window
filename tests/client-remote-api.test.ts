/**
 * The P3 `/stream/state` wire vocabulary (dev-core framing, protocol §16).
 *
 * The sidebar reacts to these frames, so a frame parser that accepts a bad
 * target id or a forged kind would let one connection's event move another
 * connection's rows. The tests pin the gates, not the formatting.
 */
import { describe, expect, it } from 'vitest'
import { normalizeFsList, parseRemoteStateEvent } from '../src/client/remote-api.ts'

describe('normalizeFsList (M2c)', () => {
  it('joins each entry path under the server listing path and keeps parent/null', () => {
    expect(normalizeFsList({
      home: '/home/tester',
      path: '/home/tester/projects',
      parent: '/home/tester',
      entries: [
        { name: 'src', type: 'directory' },
        { name: 'README.md', type: 'file' },
      ],
    })).toEqual({
      home: '/home/tester',
      path: '/home/tester/projects',
      parent: '/home/tester',
      entries: [
        { name: 'src', type: 'directory', path: '/home/tester/projects/src' },
        { name: 'README.md', type: 'file', path: '/home/tester/projects/README.md' },
      ],
    })
    expect(normalizeFsList({
      home: '/home/tester', path: '/', parent: null, entries: [{ name: 'tmp', type: 'directory' }],
    })).toEqual({
      home: '/home/tester', path: '/', entries: [{ name: 'tmp', type: 'directory', path: '/tmp' }],
    })
  })
})

describe('parseRemoteStateEvent', () => {
  it('accepts one change frame with optional routing fields', () => {
    expect(parseRemoteStateEvent({
      v: 1,
      type: 'change',
      targetId: 't1',
      kind: 'session',
      reason: 'external',
      revision: 'rev-2',
      workspaceId: 'w1',
      sessionId: 's1',
    })).toEqual({
      v: 1,
      type: 'change',
      targetId: 't1',
      kind: 'session',
      reason: 'external',
      revision: 'rev-2',
      workspaceId: 'w1',
      sessionId: 's1',
    })
  })

  it('rejects a change with an unknown kind, a bad target or the wrong protocol', () => {
    expect(parseRemoteStateEvent({ v: 2, type: 'change', targetId: 't1', kind: 'session' })).toBeUndefined()
    expect(parseRemoteStateEvent({ v: 1, type: 'change', targetId: '', kind: 'session' })).toBeUndefined()
    expect(parseRemoteStateEvent({ v: 1, type: 'change', targetId: 't1', kind: 'other' })).toBeUndefined()
    expect(parseRemoteStateEvent({ v: 1, type: 'change', kind: 'session' })).toBeUndefined()
    expect(parseRemoteStateEvent({ v: 1, type: 'change', targetId: 't1', kind: 'session', reason: 'nope' }))
      .toEqual({ v: 1, type: 'change', targetId: 't1', kind: 'session' })
  })

  it('delegates the executor/mode events to the executor parser and adds v1', () => {
    expect(parseRemoteStateEvent({
      v: 1, type: 'mode-switch/progress', targetId: 't1', phase: 'cancelling',
    })).toEqual({ v: 1, type: 'mode-switch/progress', targetId: 't1', phase: 'cancelling' })
    expect(parseRemoteStateEvent({
      v: 1, type: 'turn/cancelled', targetId: 't1', sessionId: 's1',
    })).toEqual({ v: 1, type: 'turn/cancelled', targetId: 't1', sessionId: 's1' })
    expect(parseRemoteStateEvent({
      v: 1, type: 'mode/changed', targetId: 't1', mode: 'local',
    })).toEqual({ v: 1, type: 'mode/changed', targetId: 't1', mode: 'local' })
    expect(parseRemoteStateEvent({ v: 1, type: 'mode/changed', targetId: 't1', mode: 'nope' })).toBeUndefined()
  })

  it('accepts a local-mode reveal and rejects a blank one', () => {
    expect(parseRemoteStateEvent({ v: 1, type: 'session/revealed', targetId: 't1', sessionId: 's1' }))
      .toEqual({ v: 1, type: 'session/revealed', targetId: 't1', sessionId: 's1' })
    expect(parseRemoteStateEvent({ v: 1, type: 'session/revealed', targetId: 't1', sessionId: '' })).toBeUndefined()
    expect(parseRemoteStateEvent({ v: 1, type: 'session/revealed', targetId: '', sessionId: 's1' })).toBeUndefined()
  })

  it('rejects non-objects and unknown event types', () => {
    expect(parseRemoteStateEvent(null)).toBeUndefined()
    expect(parseRemoteStateEvent('change')).toBeUndefined()
    expect(parseRemoteStateEvent({ v: 1, type: 'unknown', targetId: 't1' })).toBeUndefined()
  })
})
