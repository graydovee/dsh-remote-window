/**
 * `/api/sessions` marks **saved drafts** (`draft: true`).
 *
 * Measured shape of a draft on the target: clicking 新会话 does persist a session
 * — `session`, `permission/preset`, `sandbox/mode`, `approval/policy`, about 324 B
 * — but the log carries **no `turn/start`**. The official definition of a blank
 * session is exactly that, so the log size alone cannot decide it any more: a
 * draft has bytes, and a real conversation whose title was never written has none.
 *
 * `listRemoteSessions` therefore opens the log once (`persist.open`,
 * `mode: 'read'`) for **untitled** sessions only and answers `draft` when there is
 * no `turn/start`. The properties these tests pin, each of which is a way the
 * feature can hurt a user:
 *
 * - a real conversation is never hidden: a titled session costs no RPC, a
 *   `turn/start` log is not a draft, and **every** failure (unreadable log, an
 *   unexpected payload, a refusing close) degrades to `draft = false` with a
 *   warning — showing one extra row is recoverable, hiding a conversation is not;
 * - the check cannot wedge the list: the handle is closed in `finally`, a close
 *   failure is logged and ignored, and a failed verdict is *not* cached so a
 *   transient channel problem is retried on the next list;
 * - the scan is bounded and memoized by log size, so a workspace full of old
 *   drafts is read once each and the first message (which grows the log)
 *   recomputes the verdict by itself.
 *
 * The host reads events through `persist.open` itself — there is no separate
 * read RPC — so "open → scan → close" is one target round trip pair and both
 * calls must name the same target and workspace.
 */
import { describe, expect, it, vi } from 'vitest'
import { RemoteWorkspaces } from '../src/provision/service.ts'
import type { TargetStore } from '../src/targets/store.ts'
import type { RemoteWorkspaceRecord } from '../src/targets/types.ts'

/** The server-side workspace id of the record under test. */
const WS = '0123456789abcdef'

/** The events of a freshly opened draft: headers only, no turn. */
const DRAFT_EVENTS = [
  { type: 'session/created', seq: 0 },
  { type: 'permission/preset', seq: 1 },
  { type: 'sandbox/mode', seq: 2 },
  { type: 'approval/policy', seq: 3 },
]

/** One `persist.list` summary. */
function summary(id: string, sizeBytes: number): { id: string; sizeBytes: number; createdAt: number } {
  return { id, sizeBytes, createdAt: 1 }
}

/** A `persist.open` answer with a handle and a log. */
type OpenAnswer = { handleId: string; events?: unknown[] }

/**
 * The host-plane service over a fake `persist.*` plane.
 *
 * Only `sessionRequest` is replaced (the administrative RPC hop); the draft logic
 * under test runs for real, so the call *order* is observable — that is what
 * proves the close happens even on a failed scan.
 */
function subject(): {
  service: RemoteWorkspaces
  calls: Array<[string, Record<string, unknown>]>
  set(options: {
    list?: unknown[]
    titles?: unknown[]
    open?: (params: { sessionId?: string }) => OpenAnswer
    closeFails?: boolean
  }): void
} {
  const rows: RemoteWorkspaceRecord[] = [{ id: 'wr-1', targetId: 'rt-1', remoteWorkspaceId: WS as never }]
  const store = {
    target: () => ({ id: 'rt-1', label: 'rt-1' }),
    listWorkspaces: () => rows,
    workspace: (id: string) => rows.find(record => record.id === id),
    putWorkspace: async () => {},
    deleteWorkspace: async () => true,
  } as unknown as TargetStore
  const ctx = { get: () => undefined } as never
  const service = new RemoteWorkspaces(ctx, store, { packageRoot: process.cwd(), leaseMs: 30_000, maxProcesses: 4 })

  const calls: Array<[string, Record<string, unknown>]> = []
  let list: unknown[] = []
  let titles: unknown[] = []
  let open: (params: { sessionId?: string }) => OpenAnswer = () => ({ handleId: 'h1', events: DRAFT_EVENTS })
  let closeFails = false
  const internals = service as unknown as {
    sessionRequest(targetId: string, method: string, params: Record<string, unknown>): Promise<unknown>
  }
  internals.sessionRequest = async (_targetId: string, method: string, params: Record<string, unknown>) => {
    calls.push([method, params])
    if (method === 'persist.list') return list
    if (method === 'persist.titles') return titles
    if (method === 'persist.open') return open(params as { sessionId?: string })
    if (method === 'persist.close') {
      if (closeFails) throw new Error('close exploded')
      return null
    }
    return null
  }
  return {
    service,
    calls,
    set: options => {
      if (options.list !== undefined) list = options.list
      if (options.titles !== undefined) titles = options.titles
      if (options.open !== undefined) open = options.open
      if (options.closeFails !== undefined) closeFails = options.closeFails
    },
  }
}

/** The RPC names in call order. */
function methods(calls: Array<[string, unknown]>): string[] {
  return calls.map(([method]) => method)
}

/** The params of one RPC name. */
function paramsOf(calls: Array<[string, Record<string, unknown>]>, method: string): Record<string, unknown> | undefined {
  return calls.find(([name]) => name === method)?.[1]
}

describe('draft marking in /api/sessions', () => {
  it('marks an untitled session without turn/start as draft and closes its handle', async () => {
    const test = subject()
    test.set({ list: [summary('s1', 324)], titles: [] })

    const entries = await test.service.listRemoteSessions('rt-1', 'wr-1')

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: 's1', draft: true, sizeBytes: 324 })
    // One open, one close, on the same target and against the same workspace the
    // list used (the server verifies the log's cwd against it).
    expect(methods(test.calls)).toEqual(['persist.list', 'persist.titles', 'persist.open', 'persist.close'])
    expect(paramsOf(test.calls, 'persist.open')).toEqual({ workspaceId: WS, sessionId: 's1', mode: 'read' })
    expect(paramsOf(test.calls, 'persist.close')).toEqual({ handleId: 'h1' })
  })

  it('does not mark a log that already has a turn/start (even untitled)', async () => {
    const test = subject()
    test.set({
      list: [summary('s1', 900)],
      titles: [],
      open: () => ({ handleId: 'h', events: [...DRAFT_EVENTS, { type: 'turn/start' }] }),
    })

    const entries = await test.service.listRemoteSessions('rt-1', 'wr-1')

    // Absent, not `false`: an older client must see the same field it always saw.
    expect(entries[0]).not.toHaveProperty('draft')
    expect(methods(test.calls)).toContain('persist.close')
  })

  it('never opens a session that already has a title (a real conversation costs no RPC)', async () => {
    const test = subject()
    test.set({ list: [summary('s1', 4_096)], titles: [{ id: 's1', title: 'Fix the parser', updatedAt: 2 }] })

    const entries = await test.service.listRemoteSessions('rt-1', 'wr-1')

    expect(entries[0]).toMatchObject({ id: 's1', title: 'Fix the parser' })
    expect(entries[0]).not.toHaveProperty('draft')
    expect(methods(test.calls)).not.toContain('persist.open')
    expect(methods(test.calls)).not.toContain('persist.close')
  })

  it('memoizes by log size and recomputes once the first message grows the log', async () => {
    const test = subject()
    test.set({ list: [summary('s1', 324)], titles: [] })
    const opens = (): number => methods(test.calls).filter(method => method === 'persist.open').length

    expect((await test.service.listRemoteSessions('rt-1', 'wr-1'))[0]).toMatchObject({ draft: true })
    expect(opens()).toBe(1)
    // Same size: the verdict is reused, no second read.
    await test.service.listRemoteSessions('rt-1', 'wr-1')
    expect(opens()).toBe(1)

    // First message: the log grew and now carries a turn.
    test.set({
      list: [summary('s1', 1_200)],
      titles: [],
      open: () => ({ handleId: 'h2', events: [...DRAFT_EVENTS, { type: 'turn/start' }] }),
    })
    const after = await test.service.listRemoteSessions('rt-1', 'wr-1')
    expect(opens()).toBe(2)
    expect(after[0]).not.toHaveProperty('draft')
  })

  it('marks each untitled session from its own log', async () => {
    const test = subject()
    test.set({
      list: [summary('draft-1', 324), summary('talked-1', 800)],
      titles: [],
      open: params => ({
        handleId: `h-${params.sessionId ?? ''}`,
        events: params.sessionId === 'draft-1' ? DRAFT_EVENTS : [...DRAFT_EVENTS, { type: 'turn/start' }],
      }),
    })

    const entries = await test.service.listRemoteSessions('rt-1', 'wr-1')

    // One list, two verdicts: the cache key carries the session id, so a log
    // that talked is never hidden because a sibling is a draft.
    expect(entries.find(entry => entry.id === 'draft-1')).toMatchObject({ draft: true })
    expect(entries.find(entry => entry.id === 'talked-1')).not.toHaveProperty('draft')
    // Both handles closed, each with its own id.
    const closes = test.calls.filter(([method]) => method === 'persist.close').map(([, params]) => params.handleId)
    expect(closes).toEqual(['h-draft-1', 'h-talked-1'])
  })

  it('fails open on a read error, warns, and retries on the next list', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const test = subject()
      test.set({
        list: [summary('s1', 324)],
        titles: [],
        open: () => {
          throw new Error('already owned by an active write handle')
        },
      })

      const first = await test.service.listRemoteSessions('rt-1', 'wr-1')
      // A session that cannot be read is a conversation as far as the tree goes
      // (never hide a real log), and the list itself still answers.
      expect(first).toHaveLength(1)
      expect(first[0]).not.toHaveProperty('draft')
      expect(warn).toHaveBeenCalled()
      expect(methods(test.calls)).not.toContain('persist.close')

      // Not cached: a transient channel problem is retried instead of pinning the
      // session as a conversation forever.
      await test.service.listRemoteSessions('rt-1', 'wr-1')
      expect(methods(test.calls).filter(method => method === 'persist.open')).toHaveLength(2)
    } finally {
      warn.mockRestore()
    }
  })

  it('treats a payload without events as a read failure and still closes the handle', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const test = subject()
      test.set({ list: [summary('s1', 324)], titles: [], open: () => ({ handleId: 'h' }) })

      const entries = await test.service.listRemoteSessions('rt-1', 'wr-1')

      expect(entries[0]).not.toHaveProperty('draft')
      expect(paramsOf(test.calls, 'persist.close')).toEqual({ handleId: 'h' })
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('still answers the verdict when closing the handle fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const test = subject()
      test.set({ list: [summary('s1', 324)], titles: [], closeFails: true })

      const entries = await test.service.listRemoteSessions('rt-1', 'wr-1')

      // A leaked handle costs server memory; failing the whole list would hide
      // every session of the workspace.
      expect(entries[0]).toMatchObject({ draft: true })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('closing the draft-check handle'))
    } finally {
      warn.mockRestore()
    }
  })

  it('skips the read for an untitled log past the scan budget', async () => {
    const test = subject()
    // One byte over DRAFT_SCAN_MAX_BYTES (256 KiB): too large to read on every list.
    test.set({ list: [summary('s1', 262_145)], titles: [] })

    const entries = await test.service.listRemoteSessions('rt-1', 'wr-1')

    expect(entries[0]).not.toHaveProperty('draft')
    expect(methods(test.calls)).not.toContain('persist.open')
  })

  it('scans an untitled session whose size the server did not report', async () => {
    const test = subject()
    test.set({ list: [{ id: 's1', createdAt: 1 }], titles: [] })

    const entries = await test.service.listRemoteSessions('rt-1', 'wr-1')

    // No version stamp means no memo: the only safe answer is to read it.
    expect(entries[0]).toMatchObject({ draft: true })
    expect(paramsOf(test.calls, 'persist.open')).toMatchObject({ sessionId: 's1', mode: 'read' })
  })
})
