/**
 * The v1 remote store's state/error/loading mapping (M1).
 *
 * The host is mocked at the P3 boundary. What is pinned here is what the
 * sidebar shows while those routes are being wired: the first-paint snapshot
 * becomes connections/groups, a session load is lazy and group-aware, a failed
 * refresh stays visible as an error (not an empty list), and D20 preview/apply
 * carries the exact revision and confirmation fields.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiSpies = vi.hoisted(() => ({
  state: vi.fn(),
  sessions: vi.fn(),
  stateRefresh: vi.fn(),
  stop: vi.fn(),
  workspaceDelete: vi.fn(),
  modePreview: vi.fn(),
  modeApply: vi.fn(),
  workspaceCreate: vi.fn(),
  workspaceRename: vi.fn(),
  sessionRename: vi.fn(),
  sessionPin: vi.fn(),
  sessionArchive: vi.fn(),
  sessionFork: vi.fn(),
  sessionReorder: vi.fn(),
  workspaceReorder: vi.fn(),
  fsList: vi.fn(),
  registryRefresh: vi.fn(),
  profileRestartPreview: vi.fn(),
  profileRestart: vi.fn(),
  sessionPrepareServer: vi.fn(),
  sessionCreate: vi.fn(),
  sessionOpen: vi.fn(),
  sessionTimeline: vi.fn(),
  sessionStatus: vi.fn(),
  sessionPrompt: vi.fn(),
  sessionCancel: vi.fn(),
  sessionApproval: vi.fn(),
  connectV1: vi.fn(),
  reconnect: vi.fn(),
  deploymentPreview: vi.fn(),
  deploymentApply: vi.fn(),
  localLlmRead: vi.fn(),
  localLlmSave: vi.fn(),
  localLlmProbe: vi.fn(),
  localLlmClearKey: vi.fn(),
  localLlmDiscover: vi.fn(),
}))
const nativeSpies = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
}))
const sseSpies = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
}))
const portalSpies = vi.hoisted(() => ({
  openServerMain: vi.fn(),
  closeServerMain: vi.fn(),
  request: undefined as { targetId: string; targetLabel: string } | undefined,
}))
const legacySpies = vi.hoisted(() => ({
  connect: vi.fn(),
  stopTarget: vi.fn(),
  forgetTarget: vi.fn(),
}))
const shellSpies = vi.hoisted(() => ({
  openSession: vi.fn(),
  clearMain: vi.fn(),
  selectPanel: vi.fn(),
}))

class MockRemoteApiError extends Error {
  readonly code: string
  readonly status: number
  readonly details: unknown
  constructor(code: string, message: string, status = 500, details?: unknown) {
    super(message)
    this.name = 'RemoteApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

vi.mock('react', () => ({
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}))
vi.mock('../src/client/api.ts', () => ({
  api: legacySpies,
  RemoteApiError: MockRemoteApiError,
  toWireError: (error: unknown) => ({
    code: error instanceof MockRemoteApiError ? error.code : 'internal',
    message: error instanceof Error ? error.message : String(error),
  }),
}))
vi.mock('../src/client/session-main.tsx', () => ({
  NATIVE_MAIN_ID: 'dsh-remote-workspace-native',
  openNativeSession: nativeSpies.open,
  closeNativeSession: nativeSpies.close,
}))
vi.mock('../src/client/remote-api.ts', () => ({
  remoteApi: apiSpies,
  openRemoteStateStream: vi.fn(() => () => {}),
  openSessionEvents: sseSpies.open,
  parseRemoteStateEvent: vi.fn(),
}))
vi.mock('../src/client/portal-main.tsx', () => ({
  SERVER_MAIN_ID: 'dsh-remote-workspace-server',
  openServerMain: portalSpies.openServerMain,
  closeServerMain: portalSpies.closeServerMain,
  serverMainRequest: () => portalSpies.request,
  serverMainSessionId: () => undefined,
  subscribeServerMain: () => () => {},
}))

/* --------------------------------------------------------------- fixtures */

const TARGET = {
  id: 't1',
  label: 'box',
  kind: 'ssh',
  host: '203.0.113.10',
  port: 22,
  username: 'tester',
  authKind: 'agent',
  hasStoredSecret: false,
  hostKeyFingerprint: 'SHA256:abc',
  remote: { nodePath: '', dshCommand: '', profile: '', dshHome: '', plugins: [] },
  status: 'ready',
  executor: 'server',
}

const WORKSPACES = {
  registry: { revision: 'rev-1', epoch: 'epoch-1', initialized: true },
  workspaces: [
    {
      workspaceId: 'w1',
      path: '/srv/project',
      title: 'project',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
      sessionIds: ['s1'],
    },
  ],
  pinnedSessionIds: [],
  archivedSessionIds: [],
}

const SESSIONS = {
  registry: { revision: 'rev-1', epoch: 'epoch-1' },
  sessions: [
    {
      sessionId: 's1',
      title: 'Fix parser',
      blank: false,
      running: false,
      agentAvailable: true,
      updatedAt: 1_000,
      pinned: false,
      archived: false,
      workspaceId: 'w1',
    },
  ],
}

const CONNECTION = {
  targetId: 't1',
  phase: 'ready',
  profile: { name: 'graydovee-remote-workspace-abc' },
  runtime: { kind: 'global' },
  plugin: { installed: true, protocol: 1 },
  portal: { base: '/dsh-remote-workspace/portal/t1/', muxPath: '/dsh-remote-workspace/portal/t1/api/remote.mux' },
  embed: { storagePrefix: 'dshrw:graydovee-remote-workspace-abc:', mode: 'reload' },
}

/** Load a fresh store module (module state resets). */
async function freshStore(): Promise<typeof import('../src/client/remote-store.ts')> {
  vi.resetModules()
  return await import('../src/client/remote-store.ts')
}

/** Let the store's fire-and-forget session load settle. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

/** Bind the fake shell and expose its spies (assertions for reveal/clear). */
function bindFakeShellWithReturn(store: typeof import('../src/client/remote-store.ts')): typeof shellSpies {
  bindFakeShell(store)
  return shellSpies
}

/** Minimal shell context: catalog + uiWorkspace + layout for reveal/selection. */
function bindFakeShell(store: typeof import('../src/client/remote-store.ts')): void {
  const context = {
    slots: { inject: () => () => {}, register: () => () => {} },
    effect: (body: () => unknown) => { body(); return () => {} },
    get: (name: string) => {
      if (name === 'uiWorkspace') return {
        openSession: shellSpies.openSession,
        clearMain: shellSpies.clearMain,
        selection: { getSnapshot: () => ({}), subscribe: () => () => {} },
      }
      if (name === 'sessions') return {
        list: { getSnapshot: () => ({ byId: { s1: {} } }), subscribe: () => () => {} },
        refresh: async () => ({}),
      }
      if (name === 'layout') return {
        panelInfo: { getSnapshot: () => ({ activePanelId: null }), subscribe: () => () => {} },
        selectPanel: shellSpies.selectPanel,
      }
      return undefined
    },
  }
  store.bindRemoteStoreContext(context as unknown as import('../src/client/context.ts').ClientContext)
}

beforeEach(() => {
  vi.clearAllMocks()
  portalSpies.request = undefined
  apiSpies.sessions.mockResolvedValue(SESSIONS)
  apiSpies.sessionTimeline.mockResolvedValue({ entries: [], beforeSeq: 0, nextBeforeSeq: null })
  apiSpies.sessionStatus.mockResolvedValue({ running: false, pendingApprovals: [] })
  apiSpies.stop.mockResolvedValue({ stopped: true })
  sseSpies.open.mockReturnValue(() => {})
  sseSpies.close.mockReset()
  apiSpies.sessionPrompt.mockResolvedValue({ accepted: true })
  apiSpies.sessionCancel.mockResolvedValue({ accepted: true })
  apiSpies.sessionApproval.mockResolvedValue({ accepted: true })
  // Auto mode (the default) kicks a provider discovery while the dialog opens.
  apiSpies.localLlmDiscover.mockResolvedValue({ providers: [] })
  apiSpies.state.mockResolvedValue({
    pluginVersion: '0.1.0',
    targets: [TARGET],
    connections: { t1: CONNECTION },
    workspaces: { t1: WORKSPACES },
    defaultProfile: 'graydovee-remote-workspace-abc',
  })
})

describe('first paint (M1)', () => {
  it('turns /api/state into a connection, expands it and lazy-loads sessions', async () => {
    const store = await freshStore()
    await store.loadRemoteState()
    await settle()
    const snapshot = store.remoteAppSnapshot()
    expect(snapshot.order).toEqual(['t1'])
    expect(snapshot.connections.t1?.connection?.phase).toBe('ready')
    expect(snapshot.connections.t1?.expanded['target:t1']).toBe(true)
    expect(apiSpies.sessions).toHaveBeenCalledWith('t1')
    const group = snapshot.connections.t1?.groups[0]
    expect(group?.workspace.workspaceId).toBe('w1')
    expect(group?.sessions.map(node => node.id)).toEqual(['s1'])
    expect(group?.workspace.sessionCount).toBe(1)
  })

  it('renders the sessions bundled in /api/state without a second round trip', async () => {
    apiSpies.state.mockResolvedValue({
      pluginVersion: '0.1.0',
      targets: [TARGET],
      connections: { t1: CONNECTION },
      workspaces: { t1: WORKSPACES },
      sessions: { t1: SESSIONS },
      defaultProfile: 'p',
    })
    const store = await freshStore()
    await store.loadRemoteState()
    expect(apiSpies.sessions).not.toHaveBeenCalled()
    const group = store.remoteAppSnapshot().connections.t1?.groups[0]
    expect(group?.sessions.map(node => node.id)).toEqual(['s1'])
  })

  it('keeps a legacy-ready target visible when the host has not added connections yet', async () => {
    apiSpies.state.mockResolvedValue({
      pluginVersion: '0.1.0',
      targets: [TARGET],
      connections: {},
      workspaces: {},
      defaultProfile: 'p',
    })
    const store = await freshStore()
    await store.loadRemoteState()
    const view = store.remoteAppSnapshot().connections.t1
    expect(view?.target.id).toBe('t1')
    expect(view?.connection).toBeUndefined()
    expect(view?.workspaces).toBeUndefined()
    expect(view?.groups).toEqual([])
  })

  it('chains registry/refresh when a light refresh reports stale', async () => {
    const store = await freshStore()
    await store.loadRemoteState()
    await settle()
    apiSpies.stateRefresh
      .mockResolvedValueOnce({ workspaces: WORKSPACES, sessions: SESSIONS, stale: true })
      .mockResolvedValueOnce({ workspaces: WORKSPACES, sessions: SESSIONS, stale: false })
    apiSpies.registryRefresh.mockResolvedValue({ revision: 'rev-2', serviceReplaced: true })
    await store.refreshTargetComplete('t1')
    expect(apiSpies.registryRefresh).toHaveBeenCalledWith('t1')
    expect(store.remoteAppSnapshot().connections.t1?.stale).toBe(false)
  })

  it('survives a failed per-target workspace read in /api/state', async () => {
    // The host substitutes `{ error }` for a target whose workspace read failed
    // (and marks the connection degraded). That must not sink the whole rail.
    apiSpies.state.mockResolvedValue({
      pluginVersion: '0.1.0',
      targets: [TARGET],
      connections: {
        t1: {
          ...CONNECTION,
          phase: 'degraded',
          error: { code: 'p1-read-failed', message: 'P1 POST /api/rpc failed: socket hang up' },
        },
      },
      workspaces: { t1: { error: { code: 'p1-read-failed', message: 'socket hang up' } } },
    })
    const store = await freshStore()
    await expect(store.loadRemoteState()).resolves.toBeUndefined()
    const snapshot = store.remoteAppSnapshot()
    expect(snapshot.error).toBeUndefined()
    expect(snapshot.order).toEqual(['t1'])
    expect(snapshot.connections.t1?.groups).toEqual([])
    expect(snapshot.connections.t1?.error?.code).toBe('p1-read-failed')
  })

  it('keeps a failed refresh as an error instead of an empty list', async () => {
    const store = await freshStore()
    await store.loadRemoteState()
    await settle()
    apiSpies.stateRefresh.mockRejectedValue(new MockRemoteApiError('tunnel-unavailable', 'tunnel down'))
    await store.refreshRemoteTarget('t1')
    const view = store.remoteAppSnapshot().connections.t1
    expect(view?.stateLoad.loading).toBe(false)
    expect(view?.stateLoad.error?.code).toBe('tunnel-unavailable')
    // The previous rows are still rendered.
    expect(view?.groups[0]?.sessions.map(node => node.id)).toEqual(['s1'])
  })
})

describe('server-mode session opening (v2 native main)', () => {
  it('opens the native main even while session/prepare-server is not deployed yet', async () => {
    const store = await freshStore()
    await store.loadRemoteState()
    await settle()
    apiSpies.sessionPrepareServer.mockRejectedValue(new MockRemoteApiError('http-404', 'not found', 404))
    apiSpies.sessionTimeline.mockResolvedValue({
      entries: [{ kind: 'user', entryId: 'e1', seq: 1, time: 1, text: 'hi' }],
      beforeSeq: 0,
      nextBeforeSeq: null,
    })
    await store.openRemoteSession('t1', 's1')
    expect(nativeSpies.open).toHaveBeenCalledWith(expect.objectContaining({
      targetId: 't1',
      workspaceId: 'w1',
      sessionId: 's1',
    }))
    expect(apiSpies.sessionTimeline).toHaveBeenCalledWith('t1', 's1', expect.objectContaining({ limit: 80 }))
    expect(store.remoteAppSnapshot().selection).toEqual({ targetId: 't1', workspaceId: 'w1', sessionId: 's1' })
    expect(store.remoteAppSnapshot().native?.entries).toHaveLength(1)
  })

  it('creates and prepares the blank session before opening the native main', async () => {
    const store = await freshStore()
    await store.loadRemoteState()
    await settle()
    apiSpies.sessionCreate.mockResolvedValue({ sessionId: 'blank-1', workspaceId: 'w1' })
    apiSpies.sessionPrepareServer.mockResolvedValue({ managed: true })
    apiSpies.stateRefresh.mockResolvedValue({ workspaces: WORKSPACES, sessions: SESSIONS, stale: false })
    apiSpies.sessions.mockResolvedValue(SESSIONS)
    await store.openRemoteDraft('t1', 'w1')
    expect(apiSpies.sessionCreate).toHaveBeenCalledWith({
      targetId: 't1',
      workspaceId: 'w1',
      executor: 'server',
    })
    expect(apiSpies.sessionPrepareServer).toHaveBeenCalledWith('t1', 'blank-1')
    expect(nativeSpies.open).toHaveBeenCalledWith(expect.objectContaining({
      targetId: 't1',
      workspaceId: 'w1',
      sessionId: 'blank-1',
    }))
    expect(store.remoteAppSnapshot().selection).toEqual({
      targetId: 't1',
      workspaceId: 'w1',
      sessionId: 'blank-1',
    })
  })

  it('reuses the workspace existing blank instead of creating a second session', async () => {
    const store = await freshStore()
    apiSpies.state.mockResolvedValue({
      pluginVersion: '0.1.0',
      targets: [TARGET],
      connections: { t1: CONNECTION },
      workspaces: { t1: { ...WORKSPACES, workspaces: [{ ...WORKSPACES.workspaces[0], sessionIds: ['s1', 'b1'] }] } },
      sessions: {
        t1: {
          ...SESSIONS,
          sessions: [...SESSIONS.sessions, {
            sessionId: 'b1',
            blank: true,
            running: false,
            agentAvailable: false,
            updatedAt: 2_000,
            pinned: false,
            archived: false,
            workspaceId: 'w1',
            executor: 'server',
          }],
        },
      },
      defaultProfile: 'graydovee-remote-workspace-abc',
    })
    apiSpies.sessionPrepareServer.mockResolvedValue({ managed: true })
    await store.loadRemoteState()
    await settle()
    await store.openRemoteDraft('t1', 'w1')
    await store.openRemoteDraft('t1', 'w1')
    expect(apiSpies.sessionCreate).not.toHaveBeenCalled()
    expect(apiSpies.sessionPrepareServer).toHaveBeenCalledWith('t1', 'b1')
    expect(nativeSpies.open).toHaveBeenLastCalledWith(expect.objectContaining({
      targetId: 't1',
      workspaceId: 'w1',
      sessionId: 'b1',
    }))
    expect(store.remoteAppSnapshot().selection).toEqual({ targetId: 't1', workspaceId: 'w1', sessionId: 'b1' })
  })


  it('merges live timeline/status/approval SSE frames into the native view', async () => {
    const store = await freshStore()
    await store.loadRemoteState()
    await settle()
    apiSpies.sessionPrepareServer.mockResolvedValue({ managed: true })
    await store.openRemoteSession('t1', 's1')
    expect(sseSpies.open).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: 't1', sessionId: 's1', afterSeq: 0 }),
      expect.any(Object),
    )
    const handlers = sseSpies.open.mock.calls.at(-1)?.[1] as {
      onEvent: (frame: { event: string; data: string }) => void
    }
    handlers.onEvent({
      event: 'timeline',
      data: JSON.stringify({
        entries: [
          { kind: 'user', entryId: 'e1', seq: 1, time: 1, text: 'hello' },
          { kind: 'assistant', entryId: 'e2', seq: 2, time: 2, text: 'hi there' },
        ],
      }),
    })
    expect(store.remoteAppSnapshot().native?.entries.map(entry => entry.id)).toEqual(['e1', 'e2'])
    handlers.onEvent({
      event: 'status',
      data: JSON.stringify({ running: true, pendingApprovals: [{ approvalId: 'a1', toolName: 'bash' }] }),
    })
    expect(store.remoteAppSnapshot().native?.status).toBe('waiting-approval')
    expect(store.remoteAppSnapshot().native?.approvalPrompt).toBe('bash')
    handlers.onEvent({
      event: 'approval',
      data: JSON.stringify({ approvalId: 'a2', toolName: 'write', reason: 'modify file' }),
    })
    expect(store.remoteAppSnapshot().native?.entries.some(entry =>
      entry.kind === 'approval' && entry.approvalId === 'a2' && entry.status === 'pending')).toBe(true)
    expect(store.remoteAppSnapshot().native?.approvalPrompt).toBe('modify file')
  })

  it('closes the native view and its SSE stream on disconnect', async () => {
    const store = await freshStore()
    await store.loadRemoteState()
    await settle()
    apiSpies.sessionPrepareServer.mockResolvedValue({ managed: true })
    const stop = vi.fn()
    sseSpies.open.mockReturnValue(stop)
    await store.openRemoteSession('t1', 's1')
    nativeSpies.close.mockClear()
    await store.disconnectRemoteTarget('t1')
    expect(store.remoteAppSnapshot().native).toBeUndefined()
    expect(nativeSpies.close).toHaveBeenCalled()
    expect(store.remoteAppSnapshot().selection).toBeUndefined()
    expect(stop).toHaveBeenCalled()
  })

  it('does not open the portal when creating the blank session failed', async () => {
    const store = await freshStore()
    await store.loadRemoteState()
    await settle()
    apiSpies.sessionCreate.mockRejectedValue(new MockRemoteApiError('session/writer-held', 'held', 409))
    await store.openRemoteDraft('t1', 'w1')
    expect(nativeSpies.open).not.toHaveBeenCalled()
    expect(store.remoteAppSnapshot().notice?.kind).toBe('error')
  })

  it('refuses to open the portal when the managed agent composition failed', async () => {
    const store = await freshStore()
    await store.loadRemoteState()
    await settle()
    apiSpies.sessionPrepareServer.mockRejectedValue(new MockRemoteApiError('agent-compose-failed', 'compose failed', 500))
    await store.openRemoteSession('t1', 's1')
    expect(nativeSpies.open).not.toHaveBeenCalled()
    expect(store.remoteAppSnapshot().notice?.kind).toBe('error')
  })
})

describe('deployment confirmation (M3)', () => {
  it('passes confirm=true only when the explicit button action runs', async () => {
    const store = await freshStore()
    await store.loadRemoteState()
    await settle()
    apiSpies.deploymentApply.mockResolvedValue({ applied: true, restarted: true, version: '0.2.1-rc.3' })
    apiSpies.stateRefresh.mockResolvedValue({ workspaces: WORKSPACES, sessions: SESSIONS, stale: false })
    await store.applyDeployment('t1', 'runtime')
    expect(apiSpies.deploymentApply).toHaveBeenCalledWith('t1', 'runtime', true)
    expect(store.remoteAppSnapshot().notice?.kind).toBe('success')
  })

  it('surfaces a managed-profile refusal as an actionable error', async () => {
    const store = await freshStore()
    await store.loadRemoteState()
    await settle()
    apiSpies.deploymentApply.mockRejectedValue(new MockRemoteApiError(
      'plugin-profile-not-managed', 'v1 only manages the dedicated profile', 501,
    ))
    await store.applyDeployment('t1', 'plugin')
    const notice = store.remoteAppSnapshot().notice
    expect(notice?.kind).toBe('error')
    expect(notice?.text).toContain('专用 profile')
  })
})

describe('minimal v1 connect entry', () => {
  it('shows the SHA-256 on host-key-unknown and retries with that fingerprint', async () => {
    const store = await freshStore()
    await store.loadRemoteState()
    store.openConnectDialog()
    store.patchConnectDialog({
      label: 'box',
      host: '203.0.113.10',
      port: '22',
      username: 'tester',
      authKind: 'password',
      secret: 's3cret',
      modelSource: 'server',
    })
    apiSpies.connectV1.mockRejectedValue(new MockRemoteApiError(
      'host-key-unknown',
      'confirm the host key',
      409,
      { fingerprint: 'SHA256:abcdef' },
    ))
    await store.submitConnectDialog()
    const waiting = store.remoteAppSnapshot().connectDialog
    expect(waiting?.phase).toBe('hostkey')
    expect(waiting?.fingerprint).toBe('SHA256:abcdef')
    expect(waiting?.secret).toBe('s3cret')
    apiSpies.connectV1.mockResolvedValue({
      target: TARGET,
      state: CONNECTION,
    })
    await store.submitConnectDialog()
    expect(apiSpies.connectV1).toHaveBeenLastCalledWith(expect.objectContaining({
      hostKeyFingerprint: 'SHA256:abcdef',
      secret: 's3cret',
    }))
    expect(store.remoteAppSnapshot().connectDialog).toBeUndefined()
    expect(apiSpies.state).toHaveBeenCalled()
  })

  it('does not retry a changed host key', async () => {
    const store = await freshStore()
    store.openConnectDialog()
    store.patchConnectDialog({
      label: 'box', host: 'host', port: '22', username: 'u', authKind: 'agent', modelSource: 'server',
    })
    apiSpies.connectV1.mockRejectedValue(new MockRemoteApiError('host-key-changed', 'pinned key changed', 409))
    await store.submitConnectDialog()
    const failed = store.remoteAppSnapshot().connectDialog
    expect(failed?.phase).toBe('failed')
    expect(failed?.fingerprint).toBeUndefined()
    expect(failed?.error?.code).toBe('host-key-changed')
  })
})

describe('registry-stale recovery (QA M2)', () => {
  it('shows the reload affordance after a stale write and clears it through registry/refresh', async () => {
    const store = await freshStore()
    await store.loadRemoteState()
    await settle()
    store.requestRenameWorkspace('t1', 'w1')
    store.setRenameWorkspaceValue('Renamed')
    apiSpies.workspaceRename.mockRejectedValue(new MockRemoteApiError(
      'registry-stale', 'another instance changed workspace.json', 409,
    ))
    await store.submitRenameWorkspace()
    expect(store.remoteAppSnapshot().connections.t1?.stale).toBe(true)
    expect(store.remoteAppSnapshot().renameWorkspace).toBeDefined()
    apiSpies.registryRefresh.mockResolvedValue({ revision: 'rev-2', serviceReplaced: true })
    apiSpies.stateRefresh.mockResolvedValue({ workspaces: WORKSPACES, sessions: SESSIONS, stale: false })
    await store.loadRegistryChanges('t1')
    expect(apiSpies.registryRefresh).toHaveBeenCalledWith('t1')
    expect(store.remoteAppSnapshot().connections.t1?.stale).toBe(false)
    expect(store.remoteAppSnapshot().notice?.text).toContain('已请求')
  })
})

describe('add workspace (manual path fallback)', () => {
  it('creates the workspace from a typed path when fs/list is unavailable', async () => {
    const store = await freshStore()
    await store.loadRemoteState()
    await settle()
    apiSpies.fsList.mockRejectedValue(new MockRemoteApiError('http-404', 'not found', 404))
    await store.openAddWorkspace('t1')
    expect(store.remoteAppSnapshot().addWorkspace?.error?.code).toBe('http-404')
    store.setAddWorkspacePath('/srv/manual')
    store.setAddWorkspaceTitle('manual')
    apiSpies.workspaceCreate.mockResolvedValue({
      workspaceId: 'w2', path: '/srv/manual', title: 'manual', createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z', sessionIds: [],
    })
    apiSpies.stateRefresh.mockResolvedValue({ workspaces: WORKSPACES, sessions: SESSIONS, stale: false })
    await store.submitAddWorkspace()
    expect(apiSpies.workspaceCreate).toHaveBeenCalledWith('t1', '/srv/manual', 'manual')
    expect(store.remoteAppSnapshot().addWorkspace).toBeUndefined()
  })
})

describe('workspace deletion (409 confirmation)', () => {
  it('turns workspace-not-empty into the force question with the server count', async () => {
    const store = await freshStore()
    await store.loadRemoteState()
    await settle()
    store.requestDeleteWorkspace('t1', 'w1')
    apiSpies.workspaceDelete.mockRejectedValue(
      new MockRemoteApiError('workspace-not-empty', 'has sessions', 409, { sessionCount: 3 }),
    )
    await store.submitDeleteWorkspace()
    const pending = store.remoteAppSnapshot().deleteWorkspace
    expect(pending?.force).toBe(true)
    expect(pending?.sessionCount).toBe(3)
  })
})

describe('archive activity retry', () => {
  it('keeps the server activity list for the “stop and archive” dialog', async () => {
    const store = await freshStore()
    await store.loadRemoteState()
    await settle()
    apiSpies.sessionArchive.mockRejectedValue(new MockRemoteApiError(
      'session/archive-activity',
      'session is active',
      409,
      { activities: ['running turn'] },
    ))
    await store.toggleSessionArchive('t1', 's1')
    expect(store.remoteAppSnapshot().archiveActivity).toEqual({
      targetId: 't1',
      sessionId: 's1',
      title: 'Fix parser',
      activities: ['running turn'],
    })
    apiSpies.sessionArchive.mockResolvedValue({ archived: ['s1'] })
    await store.confirmArchiveActivity()
    expect(apiSpies.sessionArchive).toHaveBeenLastCalledWith('t1', 's1', true, true)
  })
})

describe('execution-end switch (D20, §16.13)', () => {
  it('previews active turns, then applies with previewRevision + cancelActiveTurns', async () => {
    const store = await freshStore()
    bindFakeShell(store)
    await store.loadRemoteState()
    await settle()
    apiSpies.sessionPrepareServer.mockResolvedValue({ managed: true })
    apiSpies.sessionOpen.mockResolvedValue({ sessionId: 's1', workspaceId: 'w1', executor: 'local', revealed: true })
    await store.openRemoteSession('t1', 's1')
    apiSpies.modePreview.mockResolvedValue({
      currentTurn: { sessionId: 's1', running: true },
      otherActiveTurns: [{ sessionId: 's2', title: 'Other session' }],
      requiresConfirm: true,
      previewRevision: 'preview-1',
    })
    await store.previewModeSwitch('t1', 'local')
    expect(store.remoteAppSnapshot().connections.t1?.modeSwitch.phase).toBe('confirming')
    apiSpies.modeApply.mockResolvedValue({
      switched: true,
      cancelledTurnIds: ['s1', 's2'],
      failedCancellations: [],
    })
    apiSpies.stateRefresh.mockResolvedValue({
      workspaces: WORKSPACES,
      sessions: SESSIONS,
      stale: false,
    })
    await store.applyModeSwitch('t1')
    expect(apiSpies.modeApply).toHaveBeenCalledWith({
      targetId: 't1',
      nextMode: 'local',
      cancelActiveTurns: true,
      previewRevision: 'preview-1',
      targetSessionId: 's1',
    })
    const view = store.remoteAppSnapshot().connections.t1
    expect(view?.mode).toBe('local')
    expect(view?.modeSwitch.phase).toBe('idle')
    expect(store.remoteAppSnapshot().notice?.kind).toBe('success')
    // The server native main (and its SSE) must be torn down when the session
    // reopens in the client official UI.
    expect(store.remoteAppSnapshot().native).toBeUndefined()
    expect(nativeSpies.close).toHaveBeenCalled()
  })

  it('passes the selected session to mode/preview and mode/apply', async () => {
    const store = await freshStore()
    bindFakeShell(store)
    await store.loadRemoteState()
    await settle()
    apiSpies.sessionPrepareServer.mockResolvedValue({ managed: true })
    apiSpies.sessionOpen.mockResolvedValue({ sessionId: 's1', workspaceId: 'w1', executor: 'local', revealed: true })
    await store.openRemoteSession('t1', 's1')
    apiSpies.modePreview.mockResolvedValue({
      otherActiveTurns: [],
      requiresConfirm: false,
      previewRevision: 'preview-2',
    })
    await store.previewModeSwitch('t1', 'local')
    expect(apiSpies.modePreview).toHaveBeenCalledWith('t1', 'local', 's1')
    apiSpies.modeApply.mockResolvedValue({ switched: true, cancelledTurnIds: [], failedCancellations: [] })
    apiSpies.stateRefresh.mockResolvedValue({ workspaces: WORKSPACES, sessions: SESSIONS, stale: false })
    await store.applyModeSwitch('t1')
    expect(apiSpies.modeApply).toHaveBeenCalledWith(expect.objectContaining({
      targetSessionId: 's1',
      previewRevision: 'preview-2',
    }))
  })

  it('reopens the native main when switching from local back to server', async () => {
    const store = await freshStore()
    const shell = bindFakeShellWithReturn(store)
    await store.loadRemoteState()
    await settle()
    apiSpies.sessionPrepareServer.mockResolvedValue({ managed: true })
    apiSpies.sessionOpen.mockResolvedValue({ sessionId: 's1', workspaceId: 'w1', executor: 'local', revealed: true })
    apiSpies.sessionTimeline.mockResolvedValue({ entries: [], beforeSeq: 0, nextBeforeSeq: null })
    await store.openRemoteSession('t1', 's1')
    expect(store.remoteAppSnapshot().native).toBeDefined()

    // local: native closes and the official UI takes over.
    apiSpies.modePreview.mockResolvedValue({ otherActiveTurns: [], requiresConfirm: false, previewRevision: 'to-local' })
    apiSpies.modeApply.mockResolvedValue({ switched: true, cancelledTurnIds: [], failedCancellations: [] })
    apiSpies.stateRefresh.mockResolvedValue({ workspaces: WORKSPACES, sessions: SESSIONS, stale: false })
    await store.previewModeSwitch('t1', 'local')
    await store.applyModeSwitch('t1')
    expect(store.remoteAppSnapshot().native).toBeUndefined()
    expect(shell.openSession).toHaveBeenCalledWith('s1')

    // server: native is rebuilt for the same selection.
    nativeSpies.open.mockClear()
    apiSpies.modePreview.mockResolvedValue({ otherActiveTurns: [], requiresConfirm: false, previewRevision: 'to-server' })
    apiSpies.modeApply.mockResolvedValue({ switched: true, cancelledTurnIds: [], failedCancellations: [] })
    await store.previewModeSwitch('t1', 'server')
    await store.applyModeSwitch('t1')
    expect(nativeSpies.open).toHaveBeenCalledWith(expect.objectContaining({ targetId: 't1', sessionId: 's1' }))
    expect(store.remoteAppSnapshot().native?.request.sessionId).toBe('s1')
  })

  it('maps a cancel failure to the failed list and keeps the dialog state', async () => {
    const store = await freshStore()
    bindFakeShell(store)
    await store.loadRemoteState()
    await settle()
    apiSpies.sessionPrepareServer.mockResolvedValue({ managed: true })
    apiSpies.sessionOpen.mockResolvedValue({ sessionId: 's1', workspaceId: 'w1', executor: 'local', revealed: true })
    await store.openRemoteSession('t1', 's1')
    apiSpies.modePreview.mockResolvedValue({
      otherActiveTurns: [{ sessionId: 's2' }],
      requiresConfirm: true,
      previewRevision: 'preview-1',
    })
    await store.previewModeSwitch('t1', 'local')
    apiSpies.modeApply.mockRejectedValue(new MockRemoteApiError(
      'mode-switch/cancel-failed',
      'one turn did not cancel',
      500,
      { failedCancellations: [{ sessionId: 's2', message: 'timeout' }] },
    ))
    await store.applyModeSwitch('t1')
    const view = store.remoteAppSnapshot().connections.t1
    expect(view?.modeSwitch.phase).toBe('failed')
    expect(view?.modeSwitch.error?.code).toBe('mode-switch/cancel-failed')
    expect(view?.modeSwitch.error?.failedCancellations).toEqual([
      { sessionId: 's2', message: 'timeout' },
    ])
  })
})

describe('v3 full-screen official UI activation', () => {
  it('shows a ready target in the server main panel, deep-linked to its newest conversation', async () => {
    const store = await freshStore()
    bindFakeShell(store)
    await store.loadRemoteState()
    await settle()
    await store.activateRemoteTarget('t1')
    expect(portalSpies.openServerMain).toHaveBeenCalledWith(expect.objectContaining({
      targetId: 't1',
      targetLabel: 'box',
      sessionId: 's1',
      storagePrefix: 'dshrw:graydovee-remote-workspace-abc:',
    }))
    expect(shellSpies.selectPanel).toHaveBeenCalledWith('dsh-remote-workspace-server')
    expect(store.remoteAppSnapshot().selection).toEqual({ targetId: 't1' })
  })

  it('creates the workspace blank session when the profile has no conversation yet', async () => {
    apiSpies.state.mockResolvedValue({
      pluginVersion: '0.1.0',
      targets: [TARGET],
      connections: { t1: CONNECTION },
      workspaces: { t1: WORKSPACES },
      sessions: { t1: { ...SESSIONS, sessions: [] } },
      defaultProfile: 'graydovee-remote-workspace-abc',
    })
    apiSpies.sessionCreate.mockResolvedValue({ sessionId: 'blank-1', workspaceId: 'w1' })
    const store = await freshStore()
    bindFakeShell(store)
    await store.loadRemoteState()
    await settle()
    await store.activateRemoteTarget('t1')
    expect(apiSpies.sessionCreate).toHaveBeenCalledWith({
      targetId: 't1',
      workspaceId: 'w1',
      executor: 'server',
    })
    expect(portalSpies.openServerMain).toHaveBeenCalledWith(expect.objectContaining({
      targetId: 't1',
      sessionId: 'blank-1',
    }))
  })

  it('keeps the frame without a deep link when no session can be resolved', async () => {
    apiSpies.state.mockResolvedValue({
      pluginVersion: '0.1.0',
      targets: [TARGET],
      connections: { t1: CONNECTION },
      workspaces: { t1: { ...WORKSPACES, workspaces: [] } },
      sessions: { t1: { ...SESSIONS, sessions: [] } },
      defaultProfile: 'graydovee-remote-workspace-abc',
    })
    const store = await freshStore()
    bindFakeShell(store)
    await store.loadRemoteState()
    await settle()
    await store.activateRemoteTarget('t1')
    expect(apiSpies.sessionCreate).not.toHaveBeenCalled()
    expect(portalSpies.openServerMain).toHaveBeenCalledWith(expect.objectContaining({
      targetId: 't1',
    }))
    expect(portalSpies.openServerMain.mock.calls.at(-1)?.[0]?.sessionId).toBeUndefined()
  })

  it('does not remount an already active target', async () => {
    const store = await freshStore()
    bindFakeShell(store)
    await store.loadRemoteState()
    await settle()
    await store.activateRemoteTarget('t1')
    portalSpies.openServerMain.mockClear()
    // The mocked portal reports the active request after the first activation.
    portalSpies.request = { targetId: 't1', targetLabel: 'box' }
    await store.activateRemoteTarget('t1')
    expect(portalSpies.openServerMain).not.toHaveBeenCalled()
  })

  it('opens the official UI after a successful connect of a stopped target', async () => {
    apiSpies.state
      .mockResolvedValueOnce({
        pluginVersion: '0.1.0',
        targets: [TARGET],
        connections: { t1: { ...CONNECTION, phase: 'stopped' } },
        workspaces: { t1: WORKSPACES },
        defaultProfile: 'p',
      })
      .mockResolvedValue({
        pluginVersion: '0.1.0',
        targets: [TARGET],
        connections: { t1: CONNECTION },
        workspaces: { t1: WORKSPACES },
        defaultProfile: 'p',
      })
    apiSpies.reconnect.mockResolvedValue({ target: TARGET, state: CONNECTION })
    const store = await freshStore()
    bindFakeShell(store)
    await store.loadRemoteState()
    await settle()
    await store.connectRemoteTarget('t1')
    expect(portalSpies.openServerMain).toHaveBeenCalledWith(expect.objectContaining({ targetId: 't1' }))
  })

  it('tears the frame down when the target disconnects', async () => {
    const store = await freshStore()
    bindFakeShell(store)
    await store.loadRemoteState()
    await settle()
    portalSpies.request = { targetId: 't1', targetLabel: 'box' }
    apiSpies.stop.mockResolvedValue({ stopped: true })
    await store.disconnectRemoteTarget('t1')
    expect(portalSpies.closeServerMain).toHaveBeenCalled()
    expect(shellSpies.selectPanel).toHaveBeenCalledWith(null)
  })

  it('tears the frame down when a ready connection leaves ready', async () => {
    const store = await freshStore()
    bindFakeShell(store)
    await store.loadRemoteState()
    await settle()
    portalSpies.request = { targetId: 't1', targetLabel: 'box' }
    apiSpies.stateRefresh.mockResolvedValue({
      connection: { ...CONNECTION, phase: 'failed' },
      workspaces: WORKSPACES,
      sessions: SESSIONS,
    })
    await store.refreshRemoteTarget('t1')
    expect(portalSpies.closeServerMain).toHaveBeenCalled()
  })
})

describe('v3 local model source', () => {
  /** Fill the minimum SSH identity so submit reaches the model-source gate. */
  function fillIdentity(store: typeof import('../src/client/remote-store.ts')): void {
    store.patchConnectDialog({
      label: 'box', host: '203.0.113.10', port: '22', username: 'tester', authKind: 'agent',
    })
  }

  /** The read shape `local-llm/save` echoes back for one request. */
  function savedState(request: {
    mode?: 'auto' | 'manual'
    baseUrl?: string
    models?: readonly string[]
    timeoutMs?: number
    apiKey?: string
  }): Record<string, unknown> {
    return {
      mode: request.mode ?? 'auto',
      baseUrl: request.baseUrl ?? '',
      models: request.models ?? [],
      timeoutMs: request.timeoutMs ?? 120_000,
      hasApiKey: request.apiKey !== undefined,
    }
  }

  it('hydrates the auto default and discovers this DSH’s providers', async () => {
    apiSpies.localLlmRead.mockResolvedValue({
      mode: 'auto', baseUrl: '', models: [], timeoutMs: 120_000, hasApiKey: false,
    })
    apiSpies.localLlmDiscover.mockResolvedValue({
      providers: [{ id: 'p1', name: 'Local provider', models: [{ id: 'qwen', name: 'Qwen' }] }],
    })
    const store = await freshStore()
    store.openConnectDialog()
    await settle()
    await settle()
    const dialog = store.remoteAppSnapshot().connectDialog
    expect(dialog?.modelSource).toBe('local')
    expect(dialog?.localMode).toBe('auto')
    expect(dialog?.localProviders).toEqual([
      { id: 'p1', name: 'Local provider', models: [{ id: 'qwen', name: 'Qwen' }] },
    ])
    expect(dialog?.localProvidersLoaded).toBe(true)
    expect(dialog?.localProvidersLoading).toBe(false)
    expect(apiSpies.localLlmDiscover).toHaveBeenCalledTimes(1)
  })

  it('hydrates a saved manual endpoint without discovering providers', async () => {
    apiSpies.localLlmRead.mockResolvedValue({
      mode: 'manual', baseUrl: 'http://127.0.0.1:11434/v1', models: ['qwen'], timeoutMs: 120_000, hasApiKey: true,
    })
    const store = await freshStore()
    store.openConnectDialog()
    await settle()
    const dialog = store.remoteAppSnapshot().connectDialog
    expect(dialog?.modelSource).toBe('local')
    expect(dialog?.localMode).toBe('manual')
    expect(dialog?.localBaseUrl).toBe('http://127.0.0.1:11434/v1')
    expect(dialog?.localModels).toEqual(['qwen'])
    expect(dialog?.localHasApiKey).toBe(true)
    expect(dialog?.localSettingsLoading).toBe(false)
    expect(apiSpies.localLlmDiscover).not.toHaveBeenCalled()
  })

  it('discovers providers on demand', async () => {
    apiSpies.localLlmRead.mockResolvedValue({
      mode: 'manual', baseUrl: '', models: [], timeoutMs: 120_000, hasApiKey: false,
    })
    apiSpies.localLlmDiscover.mockResolvedValue({
      providers: [
        { id: 'p1', name: 'Provider one', models: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] },
        { id: 'p2', name: 'Provider two', models: [{ id: 'c', name: 'C' }] },
      ],
    })
    const store = await freshStore()
    store.openConnectDialog()
    await settle()
    await store.discoverLocalProviders()
    const dialog = store.remoteAppSnapshot().connectDialog
    expect(apiSpies.localLlmDiscover).toHaveBeenCalledTimes(1)
    expect(dialog?.localProviders.map(provider => provider.id)).toEqual(['p1', 'p2'])
    expect(dialog?.localProvidersLoaded).toBe(true)
    expect(dialog?.localError).toBeUndefined()
  })

  it('surfaces a discovery failure inline and keeps the auto panel usable', async () => {
    apiSpies.localLlmRead.mockResolvedValue({
      mode: 'manual', baseUrl: '', models: [], timeoutMs: 120_000, hasApiKey: false,
    })
    apiSpies.localLlmDiscover.mockRejectedValue(new MockRemoteApiError(
      'local-llm-providers-unavailable', 'configure a provider in this DSH installation', 502,
    ))
    const store = await freshStore()
    store.openConnectDialog()
    await settle()
    await store.discoverLocalProviders()
    const dialog = store.remoteAppSnapshot().connectDialog
    expect(dialog?.localProviders).toEqual([])
    expect(dialog?.localProvidersLoaded).toBe(true)
    expect(dialog?.localProvidersLoading).toBe(false)
    expect(dialog?.localError).toContain('读取本机模型失败')
  })

  it('saves the manual endpoint/key and adopts the probed model ids', async () => {
    apiSpies.localLlmRead.mockResolvedValue({
      mode: 'manual', baseUrl: '', models: [], timeoutMs: 120_000, hasApiKey: false,
    })
    apiSpies.localLlmSave.mockImplementation(async (request: { mode?: 'auto' | 'manual'; baseUrl?: string; models?: readonly string[]; timeoutMs?: number; apiKey?: string }) => savedState(request))
    apiSpies.localLlmProbe.mockResolvedValue({ models: ['a', 'b'] })
    const store = await freshStore()
    store.openConnectDialog()
    await settle()
    store.patchConnectDialog({ localMode: 'manual', localBaseUrl: 'http://127.0.0.1:11434/v1' })
    const models = await store.probeLocalLlmModels('secret-key')
    expect(models).toEqual(['a', 'b'])
    expect(apiSpies.localLlmSave).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'manual', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'secret-key',
    }))
    const dialog = store.remoteAppSnapshot().connectDialog
    expect(dialog?.localModels).toEqual(['a', 'b'])
    expect(dialog?.localHasApiKey).toBe(true)
    expect(dialog?.localError).toBeUndefined()
  })

  it('blocks connecting in manual mode with an unconfigured endpoint (no server fallback)', async () => {
    apiSpies.localLlmRead.mockResolvedValue({
      mode: 'manual', baseUrl: '', models: [], timeoutMs: 120_000, hasApiKey: false,
    })
    const store = await freshStore()
    store.openConnectDialog()
    await settle()
    fillIdentity(store)
    await store.submitConnectDialog()
    expect(apiSpies.connectV1).not.toHaveBeenCalled()
    const dialog = store.remoteAppSnapshot().connectDialog
    expect(dialog?.phase).toBe('failed')
    expect(dialog?.error?.code).toBe('local-llm-unconfigured')
  })

  it('probes an empty manual model list before connecting and passes the source', async () => {
    apiSpies.localLlmRead.mockResolvedValue({
      mode: 'manual', baseUrl: '', models: [], timeoutMs: 120_000, hasApiKey: false,
    })
    apiSpies.localLlmSave.mockImplementation(async (request: { mode?: 'auto' | 'manual'; baseUrl?: string; models?: readonly string[]; timeoutMs?: number; apiKey?: string }) => savedState(request))
    apiSpies.localLlmProbe.mockResolvedValue({ models: ['m1'] })
    apiSpies.connectV1.mockResolvedValue({ target: TARGET, state: CONNECTION })
    const store = await freshStore()
    store.openConnectDialog()
    await settle()
    store.patchConnectDialog({
      label: 'box', host: '203.0.113.10', port: '22', username: 'tester', authKind: 'agent',
      localMode: 'manual', localBaseUrl: 'http://127.0.0.1:11434/v1',
    })
    await store.submitConnectDialog()
    expect(apiSpies.localLlmSave).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'manual', baseUrl: 'http://127.0.0.1:11434/v1',
    }))
    expect(apiSpies.localLlmProbe).toHaveBeenCalled()
    expect(apiSpies.connectV1).toHaveBeenCalledWith(expect.objectContaining({ modelSource: 'local' }))
  })

  it('submits auto mode by saving mode=auto, without probing the endpoint', async () => {
    apiSpies.localLlmRead.mockResolvedValue({
      mode: 'auto', baseUrl: '', models: [], timeoutMs: 120_000, hasApiKey: false,
    })
    apiSpies.localLlmSave.mockImplementation(async (request: { mode?: 'auto' | 'manual'; baseUrl?: string; models?: readonly string[]; timeoutMs?: number; apiKey?: string }) => savedState(request))
    apiSpies.connectV1.mockResolvedValue({ target: TARGET, state: CONNECTION })
    const store = await freshStore()
    store.openConnectDialog()
    await settle()
    await settle()
    fillIdentity(store)
    await store.submitConnectDialog()
    expect(apiSpies.localLlmProbe).not.toHaveBeenCalled()
    expect(apiSpies.localLlmSave).toHaveBeenCalledWith({ mode: 'auto' })
    expect(apiSpies.connectV1).toHaveBeenCalledWith(expect.objectContaining({ modelSource: 'local' }))
  })

  it('passes server as the explicit source without probing the local endpoint', async () => {
    apiSpies.localLlmRead.mockResolvedValue({
      mode: 'auto', baseUrl: '', models: [], timeoutMs: 120_000, hasApiKey: false,
    })
    apiSpies.connectV1.mockResolvedValue({ target: TARGET, state: CONNECTION })
    const store = await freshStore()
    store.openConnectDialog()
    await settle()
    store.patchConnectDialog({
      label: 'box', host: '203.0.113.10', port: '22', username: 'tester', authKind: 'agent',
      modelSource: 'server',
    })
    await store.submitConnectDialog()
    expect(apiSpies.localLlmProbe).not.toHaveBeenCalled()
    expect(apiSpies.localLlmSave).not.toHaveBeenCalled()
    expect(apiSpies.connectV1).toHaveBeenCalledWith(expect.objectContaining({ modelSource: 'server' }))
  })
})
