/**
 * v2 native timeline merge rules.
 *
 * The server SSE stream can replay rows, echo an optimistic user message with a
 * new id, and update a streaming assistant row in place. These tests pin the
 * identity ladder (clientId echo → id → seq), ordering, pagination and
 * afterSeq so the UI never duplicates or reorders a turn.
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_TIMELINE, adaptServerTimelineEntry, adaptServerTimelinePage, appendOptimisticUser,
  applyTimelineEvent, dedupeTimeline, mergeTimelineEntries, optimisticUserEntry, prependTimelinePage,
  timelineAfterSeq, timelineIsEmpty, timelineOldestSeq, upsertTimelineEntry,
} from '../src/client/session-timeline.ts'
import type { SessionTimelineEntry } from '../src/client/session-timeline.ts'

function user(seq: number, text: string, id = `u${seq}`) {
  return { kind: 'user' as const, id, seq, text }
}
function assistant(seq: number, text: string, extra: Partial<Extract<SessionTimelineEntry, { kind: 'assistant' }>> = {}) {
  return { kind: 'assistant' as const, id: `a${seq}`, seq, text, ...extra }
}
function toolCall(seq: number, callId = 'c1') {
  return { kind: 'tool-call' as const, id: `t${seq}`, seq, callId, name: 'bash', arguments: { command: 'ls' }, status: 'running' as const }
}

describe('timeline upsert/merge', () => {
  it('sorts by sequence and keeps server order', () => {
    const entries = [assistant(3, 'c'), user(1, 'a'), assistant(2, 'b')]
    expect(mergeTimelineEntries([], entries).map(entry => entry.seq)).toEqual([1, 2, 3])
  })

  it('replaces a row by id and by seq instead of duplicating it', () => {
    const base = [user(1, 'hello')]
    const byId = upsertTimelineEntry(base, { ...user(1, 'hello!'), id: 'u1' })
    expect(byId).toHaveLength(1)
    expect((byId[0] as { text: string }).text).toBe('hello!')

    const bySeq = upsertTimelineEntry(base, { ...user(1, 'again'), id: 'other' })
    expect(bySeq).toHaveLength(1)
    expect((bySeq[0] as { text: string }).text).toBe('again')
  })

  it('updates a streaming assistant row in place (no positional jump)', () => {
    const base = [user(1, 'q'), assistant(2, 'par'), { kind: 'tool-call' as const, id: 'tool', seq: 3, callId: 'c', name: 'bash', status: 'running' as const }]
    const next = upsertTimelineEntry(base, assistant(2, 'partial answer', { streaming: true }))
    expect(next.map(entry => entry.kind)).toEqual(['user', 'assistant', 'tool-call'])
    expect((next[1] as { text: string }).text).toBe('partial answer')
  })

  it('echoes an optimistic user row by clientId even when the server id differs', () => {
    const optimistic = optimisticUserEntry({ clientId: 'client-1', text: 'hello', createdAt: 1 })
    const state = appendOptimisticUser(EMPTY_TIMELINE, { clientId: 'client-1', text: 'hello' })
    expect(state.state.entries).toHaveLength(1)
    const echoed = applyTimelineEvent(state.state, {
      type: 'replace-user',
      clientId: 'client-1',
      entry: { kind: 'user', id: 'server-1', seq: 7, text: 'hello', clientId: 'client-1' },
    })
    expect(echoed.entries).toHaveLength(1)
    expect(echoed.entries[0]).toMatchObject({ id: 'server-1', seq: 7 })
    expect(optimistic.pending).toBe(true)
  })

  it('also reconciles a server echo appended by the normal entry path', () => {
    const { state } = appendOptimisticUser(EMPTY_TIMELINE, { clientId: 'c2', text: 'hi' })
    const next = applyTimelineEvent(state, {
      type: 'entry',
      entry: { kind: 'user', id: 's2', seq: 4, text: 'hi', clientId: 'c2' },
    })
    expect(next.entries).toHaveLength(1)
    expect(next.entries[0]?.seq).toBe(4)
  })

  it('keeps optimistic rows without a sequence at the end', () => {
    const base = [user(1, 'old')]
    const optimistic = optimisticUserEntry({ clientId: 'c3', text: 'new' })
    const next = upsertTimelineEntry(base, optimistic)
    expect(next.map(entry => entry.kind)).toEqual(['user', 'user'])
    expect(next[1]?.seq).toBeUndefined()
  })
})

describe('pagination and reconnect cursor', () => {
  it('computes afterSeq/oldestSeq from defined sequences only', () => {
    const entries = [user(2, 'b'), assistant(5, 'c'), optimisticUserEntry({ clientId: 'c', text: 'x' })]
    expect(timelineAfterSeq(entries)).toBe(5)
    expect(timelineOldestSeq(entries)).toBe(2)
    expect(timelineAfterSeq([])).toBe(0)
    expect(timelineOldestSeq([])).toBeUndefined()
  })

  it('prepends an older page, deduplicating overlap', () => {
    const current = [user(4, 'd'), assistant(5, 'e')]
    const older = [user(1, 'a'), user(2, 'b'), assistant(3, 'c'), user(4, 'd')]
    const next = prependTimelinePage({ entries: current, hasMoreBefore: true }, older, false)
    expect(next.entries.map(entry => entry.seq)).toEqual([1, 2, 3, 4, 5])
    expect(next.hasMoreBefore).toBe(false)
  })

  it('applies a snapshot as a deduplicated window and keeps hasMoreBefore', () => {
    const next = applyTimelineEvent(EMPTY_TIMELINE, {
      type: 'snapshot',
      entries: [user(2, 'b'), user(1, 'a'), user(2, 'b')],
      hasMoreBefore: true,
    })
    expect(next.entries.map(entry => entry.seq)).toEqual([1, 2])
    expect(next.hasMoreBefore).toBe(true)
    expect(timelineIsEmpty(next)).toBe(false)
    expect(timelineIsEmpty(EMPTY_TIMELINE)).toBe(true)
  })

  it('dedupes a raw batch with repeated seq', () => {
    expect(dedupeTimeline([user(1, 'a'), user(1, 'b')])).toHaveLength(1)
  })
})

describe('official RwTimelineEntry adapter', () => {
  it('maps ids/time and the interrupted assistant marker', () => {
    expect(adaptServerTimelineEntry({
      kind: 'assistant', entryId: 'e1', seq: 3, time: 1700000000000, text: 'hi', interrupted: true,
    })).toMatchObject({ id: 'e1', seq: 3, kind: 'assistant', interrupted: true })
  })

  it('maps asked/decided approvals to pending/allowed/denied/expired', () => {
    expect(adaptServerTimelineEntry({
      kind: 'approval', entryId: 'a1', seq: 1, time: 1, approvalId: 'ap', state: 'asked', toolName: 'bash',
    })).toMatchObject({ status: 'pending', approvalId: 'ap' })
    expect(adaptServerTimelineEntry({
      kind: 'approval', entryId: 'a2', seq: 2, time: 2, approvalId: 'ap', state: 'decided', outcome: 'allowed-once',
    })).toMatchObject({ status: 'allowed' })
    expect(adaptServerTimelineEntry({
      kind: 'approval', entryId: 'a3', seq: 3, time: 3, approvalId: 'ap', state: 'decided', outcome: 'rejected',
    })).toMatchObject({ status: 'denied' })
    expect(adaptServerTimelineEntry({
      kind: 'approval', entryId: 'a4', seq: 4, time: 4, approvalId: 'ap', state: 'decided', outcome: 'cancelled',
    })).toMatchObject({ status: 'expired' })
  })

  it('maps tool result text/isError and keeps the truncation flag', () => {
    expect(adaptServerTimelineEntry({
      kind: 'tool-result', entryId: 'tr1', seq: 5, time: 5, callId: 'c1', isError: true, truncated: true, text: 'boom',
    })).toMatchObject({ kind: 'tool-result', output: 'boom', isError: true, truncated: true, callId: 'c1' })
  })

  it('maps official unknown rows to a visible fallback instead of dropping them', () => {
    expect(adaptServerTimelineEntry({
      kind: 'unknown', entryId: 'u9', seq: 9, time: 9, type: 'surface/plan', ignorable: true,
    })).toMatchObject({ kind: 'unknown', label: 'surface/plan' })
  })

  it('adapts a page and exposes nextAfterSeq', () => {
    const page = adaptServerTimelinePage({
      entries: [
        { kind: 'user', entryId: 'u1', seq: 1, time: 1, text: 'a' },
        { kind: 'assistant', entryId: 'a1', seq: 2, time: 2, text: 'b' },
      ],
      afterSeq: 2,
      nextAfterSeq: 2,
      eventCount: 2,
    })
    expect(page.entries.map(entry => entry.seq)).toEqual([1, 2])
    expect(page.nextAfterSeq).toBe(2)
  })
})
