/**
 * 新会话 = the **official draft page**, not `POST /api/open-workspace`.
 *
 * Measured defect this replaces: every click on a workspace row or 新会话 called
 * `store.reopenWorkspace` → `api.openWorkspace`, which created (and seeded) a
 * remote session immediately. Abandoning the click left a named empty
 * conversation behind, and — with the lazy path — could resurrect an unrelated
 * old log.
 *
 * The official semantics are a draft: `uiWorkspace.startSession(workspaceId,
 * { agentPreset })` binds the welcome page + composer to a workspace and the
 * shell's own `sessions.create` fires only when the first message is sent; the
 * plugin's routing turns that `create(header.cwd)` into `persist.create` on the
 * target. Two things must therefore hold on the click path:
 *
 * 1. `prepare-workspace` runs first (idempotent; the row, its stub and the shell
 *    workspace row must exist before anything can be bound), and
 * 2. the preset is `remote:<targetId>` — without it the shell composes the
 *    shipped local preset while our persistence still writes remotely
 *    (alpha54 "defect B": the model ran on *this* machine and looked fine).
 *
 * `api.openWorkspace` must not appear on any of these paths; when a step fails,
 * the failure has to become a notice the user can read (the inline banner lives
 * in a panel that is not on screen while clicking a sidebar row — alpha55
 * defect A read as "the row does nothing"). **Success stays silent**: the draft
 * page opening *is* the feedback, so `state.notice` must be empty on every
 * successful entry point (workspace row, temporary draft row, 添加工作区 dialog).
 *
 * The second half pins the temporary row's state machine: `state.currentDraft` is
 * read from the shell — the selected session, still `blank`, with a `cwd` inside
 * one of our stubs — and must clear when the user switches away, when the draft's
 * first message lands, and when the connection goes down. A shell without a
 * selection store (or one whose subscribe throws) degrades instead of breaking
 * the draft click.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '../src/client/context.ts'
import type { WorkspaceRow } from '../src/client/workspace-join.ts'

/** The API spies the store module talks to (created before the mock factory). */
const apiSpies = vi.hoisted(() => {
  const spies = {
    prepareWorkspace: vi.fn(),
    openWorkspace: vi.fn(),
    openSession: vi.fn(),
    state: vi.fn(),
    listDir: vi.fn(),
    sessions: vi.fn(),
    remoteWorkspaces: vi.fn(),
    sessionFlag: vi.fn(),
    sessionRename: vi.fn(),
  }
  return {
    ...spies,
    api: {
      ...spies,
      // Unused by these paths, present so the module face stays complete.
      targets: vi.fn(async () => ({ targets: [] })),
      packagePolicy: vi.fn(async () => ({ policy: 'auto', mirror: '' })),
    },
  }
})

// The client half is assembled by the shell's module loader; only the modules
// this file's subject actually reaches are mocked.
vi.mock('react', () => ({
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  useEffect: () => {},
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => {}],
}))

vi.mock('../src/client/api.ts', () => ({
  api: apiSpies.api,
  openConnectStream: vi.fn(() => () => {}),
  // The store's own wire-error normalizer; the assertions only need the message.
  toWireError: (error: unknown) => ({
    code: (error as { code?: string })?.code ?? 'internal',
    message: error instanceof Error ? error.message : String(error),
  }),
  RemoteApiError: class RemoteApiError extends Error {
    code = 'internal'
  },
}))

/** The prepared row `/api/prepare-workspace` answers. */
const PREPARED = {
  workspaceId: 'wr-1',
  remoteWorkspaceId: 'srv-1',
  stubPath: '/home/tester/.dsh/remote-workspaces/rt-1/abcd1234',
  officialWorkspaceId: 'official-1',
  targetId: 'rt-1',
}

/** One joined workspace row (as the tree hands it to the action). */
function row(overrides: Partial<WorkspaceRow> = {}): WorkspaceRow {
  return {
    id: 'wr-1',
    targetId: 'rt-1',
    remoteWorkspaceId: 'srv-1',
    path: '/home/tester/projects',
    title: 'projects',
    ...overrides,
  } as WorkspaceRow
}

/** A shell context exposing just the services the draft path reads. */
function clientContext(options: {
  uiWorkspace?: Record<string, unknown> | undefined
  shellWorkspaceIds?: string[]
} = {}): { ctx: ClientContext; startSession: ReturnType<typeof vi.fn> } {
  const startSession = vi.fn()
  const services: Record<string, unknown> = {}
  if (options.uiWorkspace !== undefined) services.uiWorkspace = options.uiWorkspace
  else services.uiWorkspace = { startSession }
  const ids = options.shellWorkspaceIds ?? [PREPARED.officialWorkspaceId]
  services.workspaces = {
    list: { getSnapshot: () => ({ items: ids.map(workspaceId => ({ workspaceId })) }) },
  }
  return { ctx: { get: (name: string) => services[name] } as unknown as ClientContext, startSession }
}

/** A fresh store module instance (module-level state must not leak between cases). */
async function loadStore(): Promise<typeof import('../src/client/store.ts')> {
  vi.resetModules()
  return await import('../src/client/store.ts')
}

const STATE = {
  targets: [],
  workspaceRefs: [],
  serverWorkspaces: {},
  pluginVersion: '0.1.0-alpha1',
  defaultProfile: 'web',
  platform: 'darwin',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  apiSpies.prepareWorkspace.mockResolvedValue(PREPARED)
  apiSpies.state.mockResolvedValue(STATE)
  apiSpies.listDir.mockResolvedValue({ home: '/home/tester', path: '/home/tester/projects', entries: [] })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('startDraftSession', () => {
  it('prepares the workspace, then starts the official session with the remote preset', async () => {
    const { ctx, startSession } = clientContext()
    const store = await loadStore()
    store.bindClientContext(ctx)

    await store.store.startDraftSession(row())

    expect(apiSpies.prepareWorkspace).toHaveBeenCalledWith('rt-1', '/home/tester/projects', 'projects')
    // The preset is what keeps the execution world on the target: the exact
    // options object is the contract (an omitted preset is defect B).
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(startSession).toHaveBeenCalledWith('official-1', { agentPreset: 'remote:rt-1' })
    // Order: the shell can only bind a row that already exists.
    expect(apiSpies.prepareWorkspace.mock.invocationCallOrder[0]).toBeLessThan(startSession.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY)
    // Draft semantics: no session-creating route anywhere on this path.
    expect(apiSpies.openWorkspace).not.toHaveBeenCalled()
    expect(apiSpies.openSession).not.toHaveBeenCalled()
  })

  it('stays silent on success (the draft page is the result)', async () => {
    const { ctx } = clientContext()
    const store = await loadStore()
    store.bindClientContext(ctx)

    await store.store.startDraftSession(row())

    const state = store.useAppState()
    expect(state.pending).toBe(false)
    // No toast: the shell's draft page opening *is* the answer, and the row
    // appearing in the tree says the rest (beta feedback: the toast was noise).
    expect(state.notice).toBeUndefined()
  })

  it('opens the very same draft from a click on the workspace row (no resume of the stale sessionId)', async () => {
    const { ctx, startSession } = clientContext()
    const store = await loadStore()
    store.bindClientContext(ctx)
    // A record from the old immediate-open route still carries a sessionId; the
    // draft path must not resume it (the log would be an unrelated old one).
    const stale = row({ sessionId: 'session-old' } as Partial<WorkspaceRow>)

    await store.store.openWorkspaceRecord(stale)

    expect(apiSpies.openWorkspace).not.toHaveBeenCalled()
    expect(apiSpies.openSession).not.toHaveBeenCalled()
    expect(startSession).toHaveBeenCalledWith('official-1', { agentPreset: 'remote:rt-1' })
  })

  it('enters the same draft from the 添加工作区 dialog instead of open-workspace', async () => {
    const { ctx, startSession } = clientContext()
    const store = await loadStore()
    store.bindClientContext(ctx)

    await store.store.loadDirectory('rt-1', '/home/tester/projects')
    await store.store.openWorkspace()

    expect(apiSpies.listDir).toHaveBeenCalledWith('rt-1', '/home/tester/projects')
    // The dialog pre-fills the title from the directory name (`loadDirectory`),
    // so the picked directory reaches prepare with it.
    expect(apiSpies.prepareWorkspace).toHaveBeenCalledWith('rt-1', '/home/tester/projects', 'projects')
    expect(startSession).toHaveBeenCalledWith('official-1', { agentPreset: 'remote:rt-1' })
    expect(apiSpies.openWorkspace).not.toHaveBeenCalled()
    // Silent as well: this entry point used to toast `directory.draftOpened`.
    expect(store.useAppState().notice).toBeUndefined()
  })
})

describe('startDraftSession failures', () => {
  it('refuses to fall back when the shell has no uiWorkspace service', async () => {
    const { ctx } = clientContext({ uiWorkspace: {} })
    const store = await loadStore()
    store.bindClientContext(ctx)

    await store.store.startDraftSession(row())

    const state = store.useAppState()
    expect(state.pending).toBe(false)
    expect(state.notice?.kind).toBe('error')
    // The message names the missing service rather than silently creating a
    // session through the old route.
    expect(state.notice?.text).toContain('uiWorkspace')
    expect(apiSpies.prepareWorkspace).not.toHaveBeenCalled()
    expect(apiSpies.openWorkspace).not.toHaveBeenCalled()
  })

  it('turns a prepare failure into a readable error and starts nothing', async () => {
    const failure = Object.assign(new Error('remote target "rt-1" is not connected'), { code: 'target-not-connected' })
    apiSpies.prepareWorkspace.mockRejectedValueOnce(failure)
    const { ctx, startSession } = clientContext()
    const store = await loadStore()
    store.bindClientContext(ctx)

    await store.store.startDraftSession(row())

    const state = store.useAppState()
    expect(state.pending).toBe(false)
    expect(state.error?.code).toBe('target-not-connected')
    expect(state.notice?.kind).toBe('error')
    expect(state.notice?.text).toContain('is not connected')
    expect(startSession).not.toHaveBeenCalled()
    expect(apiSpies.openWorkspace).not.toHaveBeenCalled()
  })

  it('rebuilds a swept shell row by preparing again before binding the draft', async () => {
    // The startup sweep / 刷新 deletes every row under the stub root, so the id
    // the first prepare answered is not in the shell list any more.
    apiSpies.prepareWorkspace
      .mockResolvedValueOnce({ ...PREPARED, officialWorkspaceId: 'official-swept' })
      .mockResolvedValueOnce({ ...PREPARED, officialWorkspaceId: 'official-2' })
    const { ctx, startSession } = clientContext({ shellWorkspaceIds: ['official-2'] })
    const store = await loadStore()
    store.bindClientContext(ctx)

    const pending = store.store.startDraftSession(row())
    // The bounded wait for the swept row times out, then the retry lands.
    await vi.advanceTimersByTimeAsync(4_000)
    await pending

    expect(apiSpies.prepareWorkspace).toHaveBeenCalledTimes(2)
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(startSession).toHaveBeenCalledWith('official-2', { agentPreset: 'remote:rt-1' })
  })
})

/* ------------------------------------- the currentDraft state machine */

/** The local stub the prepared row carries; the shell anchors a draft there. */
const STUB = PREPARED.stubPath

/** `/api/state` with one joined remote workspace, so stub→row mapping works. */
const STATE_WITH_REF = {
  ...STATE,
  workspaceRefs: [{ id: 'wr-1', targetId: 'rt-1', remoteWorkspaceId: 'srv-1', stubPath: STUB }],
}

/**
 * A shell stand-in with a mutable session catalog and selection.
 *
 * Emulates the two facts `refreshDraftFromShell` reads: the selected session id
 * (`selection.getSnapshot`) and each catalog row's `cwd`/`blank`. `startSession`
 * does what the shell does — creates a blank session anchored at the workspace
 * path and selects it — and then notifies the subscribers the store installed.
 * @param options.selection - `'store'` (normal), `'none'` (no selection service),
 *   or `'throwing'` (a subscribe that refuses).
 */
function draftShell(options: { selection?: 'store' | 'none' | 'throwing' } = {}): {
  ctx: ClientContext
  startSession: ReturnType<typeof vi.fn>
  select(sessionId: string | undefined): void
  catalog(rows: Record<string, { cwd?: string; blank?: boolean }>): void
} {
  let selected: string | undefined
  let byId: Record<string, { cwd?: string; blank?: boolean }> = {}
  const selectionSubscribers: Array<() => void> = []
  const listSubscribers: Array<() => void> = []

  const startSession = vi.fn(() => {
    // The shell creates the draft immediately and shows it.
    selected = 'session-draft'
    byId = { ...byId, 'session-draft': { cwd: STUB, blank: true } }
    for (const notify of listSubscribers) notify()
    for (const notify of selectionSubscribers) notify()
  })

  const shell: Record<string, unknown> = { startSession }
  if (options.selection === 'throwing') {
    shell.selection = {
      getSnapshot: () => ({ sessionId: selected }),
      subscribe: () => {
        throw new Error('selection subscribe refused')
      },
    }
  } else if (options.selection !== 'none') {
    shell.selection = {
      getSnapshot: () => ({ sessionId: selected }),
      subscribe: (notify: () => void) => {
        selectionSubscribers.push(notify)
        return () => { selectionSubscribers.splice(selectionSubscribers.indexOf(notify), 1) }
      },
    }
  }

  const services: Record<string, unknown> = {
    uiWorkspace: shell,
    workspaces: {
      list: { getSnapshot: () => ({ items: [{ workspaceId: PREPARED.officialWorkspaceId }] }) },
    },
    sessions: {
      list: {
        getSnapshot: () => ({ byId }),
        subscribe: (notify: () => void) => {
          listSubscribers.push(notify)
          return () => { listSubscribers.splice(listSubscribers.indexOf(notify), 1) }
        },
      },
    },
  }
  return {
    ctx: { get: (name: string) => services[name] } as unknown as ClientContext,
    startSession,
    select: sessionId => {
      selected = sessionId
      for (const notify of selectionSubscribers) notify()
    },
    catalog: rows => { byId = rows },
  }
}

describe('currentDraft (the temporary 新会话 row)', () => {
  it('records the open draft from the shell after the click', async () => {
    apiSpies.state.mockResolvedValue(STATE_WITH_REF)
    const shell = draftShell()
    const store = await loadStore()
    store.bindClientContext(shell.ctx)

    await store.store.startDraftSession(row())

    expect(shell.startSession).toHaveBeenCalledTimes(1)
    // The row's lifetime is *read from the shell*, never authored here: a blank
    // session whose cwd is one of our stubs is the draft.
    expect(store.useAppState().currentDraft).toEqual({ workspaceId: 'wr-1', sessionId: 'session-draft' })
    // The workspace node is expanded so the row inside it can be seen.
    expect(store.useAppState().expanded['workspace:wr-1']).toBe(true)
  })

  it('drops the row when the user switches to a stored conversation', async () => {
    apiSpies.state.mockResolvedValue(STATE_WITH_REF)
    const shell = draftShell()
    const store = await loadStore()
    store.bindClientContext(shell.ctx)
    await store.store.startDraftSession(row())
    expect(store.useAppState().currentDraft).toBeDefined()

    shell.catalog({
      'session-draft': { cwd: STUB, blank: true },
      'session-stored': { cwd: STUB, blank: false },
    })
    shell.select('session-stored')

    // Selection changed without any session row changing: the temporary row is
    // only ever "what is on screen right now".
    expect(store.useAppState().currentDraft).toBeUndefined()
  })

  it('drops the row when the draft stops being blank (the first message)', async () => {
    apiSpies.state.mockResolvedValue(STATE_WITH_REF)
    const shell = draftShell()
    const store = await loadStore()
    store.bindClientContext(shell.ctx)
    await store.store.startDraftSession(row())

    // The same selected session, one turn later: the shell's blank flag cleared,
    // and the session-list subscription is what tells the store.
    shell.catalog({ 'session-draft': { cwd: STUB, blank: false } })
    shell.select('session-draft')

    expect(store.useAppState().currentDraft).toBeUndefined()
  })

  it('never adopts a blank session outside our stubs (a local conversation)', async () => {
    apiSpies.state.mockResolvedValue(STATE_WITH_REF)
    const shell = draftShell()
    shell.catalog({ 'local-draft': { cwd: '/home/tester/local-project', blank: true } })
    shell.select('local-draft')
    const store = await loadStore()
    store.bindClientContext(shell.ctx)

    // The plugin's tree must stay empty for a shell workspace it does not own.
    expect(store.useAppState().currentDraft).toBeUndefined()
  })

  it('clears the row when the connection goes down', async () => {
    apiSpies.state.mockResolvedValue({
      ...STATE_WITH_REF,
      targets: [{
        id: 'rt-1',
        label: 'box',
        kind: 'ssh',
        host: '203.0.113.10',
        port: 22,
        username: 'tester',
        authKind: 'agent',
        hasStoredSecret: false,
        hostKeyFingerprint: '',
        remote: { nodePath: '', dshCommand: '', profile: '', dshHome: '', plugins: [] },
        status: 'ready',
      }],
    })
    const shell = draftShell()
    const store = await loadStore()
    store.bindClientContext(shell.ctx)
    await store.store.startDraftSession(row())
    expect(store.useAppState().currentDraft).toBeDefined()

    // 断开: the shell selection is cleared (the store deselects before teardown),
    // which is the moment the draft stops being on screen.
    shell.select(undefined)

    expect(store.useAppState().currentDraft).toBeUndefined()
  })

  it('degrades when the shell exposes no selection store', async () => {
    apiSpies.state.mockResolvedValue(STATE_WITH_REF)
    const shell = draftShell({ selection: 'none' })
    const store = await loadStore()

    expect(() => store.bindClientContext(shell.ctx)).not.toThrow()
    await store.store.startDraftSession(row())

    // Best effort: the draft page still opens, only the temporary row is unknown.
    expect(shell.startSession).toHaveBeenCalledTimes(1)
    expect(store.useAppState().currentDraft).toBeUndefined()
  })

  it('survives a selection store whose subscribe throws', async () => {
    apiSpies.state.mockResolvedValue(STATE_WITH_REF)
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const shell = draftShell({ selection: 'throwing' })
      const store = await loadStore()

      expect(() => store.bindClientContext(shell.ctx)).not.toThrow()
      await store.store.startDraftSession(row())
      expect(shell.startSession).toHaveBeenCalledTimes(1)
      expect(errorLog).toHaveBeenCalledWith(
        '[dsh-remote-workspace] subscribing to the shell selection failed',
        expect.any(Error),
      )
    } finally {
      errorLog.mockRestore()
    }
  })
})
