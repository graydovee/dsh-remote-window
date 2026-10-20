/**
 * `prepare-workspace`: materialize a remote directory for the **official
 * new-conversation draft** — and create no session.
 *
 * The lazy-create switch (task B) moved 新会话 onto the shell's own draft page:
 * `uiWorkspace.startSession(workspaceId)` creates the session when the first
 * message is sent, and the plugin's routing persistence turns that
 * `create(header.cwd)` into `persist.create` on the target. Everything a session
 * would need must therefore exist *before* any session does, and the host route
 * must be safe to call before **every** draft (the startup sweep and 刷新 delete
 * the shell rows under the stubs).
 *
 * What these tests pin, in the order the task lists them:
 *
 * 1. **Idempotent, session-free.** Two calls for one `(targetId, path)` keep the
 *    same record id, server workspace id and shell workspace id, re-register
 *    nothing, and never touch `ctx.agents` — a prepared workspace is not a
 *    conversation.
 * 2. **Forced shell row, Gate 0 untouched.** `prepareWorkspace` registers the
 *    official shell workspace row even with `DSH_RW_FORCE_SHELL_WORKSPACES`
 *    off (the draft page resolves its workspace from the shell's own list),
 *    while the same `materializeWorkspace` call the open/resume path makes still
 *    registers nothing.
 * 3. **A stopped target fails loudly** with `target-not-connected`, before the
 *    realm gate, the remote registration or any local record.
 * 4. **No shell row, no draft.** A missing/refusing workspace registry is
 *    `shell-workspace-unavailable` here rather than a dead click in the shell
 *    ("unknown workspace" swallowed into a console warning).
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { officialWorkspaceFor, RemoteWorkspaces, shouldRegisterShellWorkspaces } from '../src/provision/service.ts'
import type { TargetStore } from '../src/targets/store.ts'
import type { RemoteTargetRecord, RemoteWorkspaceRecord } from '../src/targets/types.ts'

/* ---------------------------------------------------------------- fixtures */

/** The remote directory every case materializes. */
const REMOTE_PATH = '/home/tester/projects'

/** One official shell workspace row (the registry's shape, loosely). */
interface OfficialRow {
  id: string
  path: string
  title: string
  attachSession(sessionId: string): Promise<void>
}

/**
 * A host context with the services these paths read, recording every `get`.
 *
 * `get` mirrors cordis (unknown service → `undefined`) instead of throwing, so
 * the assertions can distinguish "asked for `ctx.agents`" from "realm missing".
 */
function fakeContext(services: Record<string, unknown> = {}): { ctx: Context; touched: string[] } {
  const touched: string[] = []
  const presets = {
    resolve: async (id: string) => ({ id }),
    composedPreset: () => undefined,
    serviceFor: () => ({}),
  }
  const table: Record<string, unknown> = { agentPresets: presets, ...services }
  const ctx = {
    get: (name: string) => {
      touched.push(name)
      return table[name]
    },
  } as unknown as Context
  return { ctx, touched }
}

/** The registry stand-in; `rows` is what `resolveByPath` can find. */
function fakeRegistry(options: { refuse?: boolean } = {}): {
  registry: { create: ReturnType<typeof vi.fn>; resolveByPath: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }
  calls: string[]
  rows: OfficialRow[]
} {
  const calls: string[] = []
  const rows: OfficialRow[] = []
  let created = 0
  const registry = {
    resolveByPath: vi.fn(async (path: string) => {
      calls.push('resolveByPath')
      return rows.find(row => row.path === path)
    }),
    create: vi.fn(async (path: string, title?: string) => {
      calls.push('create')
      if (options.refuse === true) throw new Error('registry refused the row')
      created += 1
      const row: OfficialRow = { id: `official-${created}`, path, title: title ?? '', attachSession: async () => {} }
      rows.push(row)
      return row
    }),
    delete: vi.fn(async () => {}),
  }
  return { registry, calls, rows }
}

/**
 * A browsing RPC client with a **stateful** workspace index.
 *
 * Stateful on purpose: `ensureRemoteWorkspace` is `reg.list`-then-`reg.create`,
 * so a static list would make a second `prepare-workspace` look like it created
 * a second server entry — the opposite of what idempotency must show.
 */
function fakeRemoteClient(): { client: { home: string; request: ReturnType<typeof vi.fn> }; rpcs: string[]; workspaces: Array<{ id: string; path: string; title: string }> } {
  const rpcs: string[] = []
  const workspaces: Array<{ id: string; path: string; title: string }> = []
  let created = 0
  const client = {
    home: '/home/tester',
    request: vi.fn(async (method: string, params: { path?: string; title?: string }) => {
      rpcs.push(method)
      const path = params.path ?? ''
      switch (method) {
        // `fs.resolve` answers a `targetSchema` object (`{ targetKey, displayPath }`).
        case 'fs.resolve':
          return { targetKey: path, displayPath: path }
        case 'fs.list':
          return [{ name: 'README.md', type: 'file', target: { targetKey: `${path}/README.md`, displayPath: `${path}/README.md` } }]
        case 'reg.list':
          return workspaces.map(item => ({ ...item, sessionCount: 0, createdAt: '2026-10-18T00:00:00.000Z' }))
        case 'reg.create': {
          created += 1
          const item = { id: `srv-${created}`, path, title: params.title ?? path.split('/').filter(Boolean).at(-1) ?? path }
          workspaces.push(item)
          return { ...item, sessionCount: 0, createdAt: '2026-10-18T00:00:00.000Z' }
        }
        default:
          // A `persist.*` or session RPC here would mean a session was created.
          throw new Error(`unexpected RPC ${method}`)
      }
    }),
  }
  return { client, rpcs, workspaces }
}

/** The target/workspace store stand-in, recording every write. */
function fakeStore(targetId = 'rt-1'): {
  store: TargetStore
  records: RemoteWorkspaceRecord[]
  puts: RemoteWorkspaceRecord[]
  calls: { putWorkspace: ReturnType<typeof vi.fn>; target: ReturnType<typeof vi.fn> }
} {
  const records: RemoteWorkspaceRecord[] = []
  const puts: RemoteWorkspaceRecord[] = []
  const target = {
    id: targetId,
    label: 'box',
    kind: 'ssh',
    host: '203.0.113.10',
    port: 22,
    username: 'tester',
    authKind: 'agent',
    hasStoredSecret: false,
    hostKeyFingerprint: 'SHA256:abc',
  } as unknown as RemoteTargetRecord
  const calls = {
    target: vi.fn((id: string) => (id === targetId ? target : undefined)),
    putWorkspace: vi.fn(async (record: RemoteWorkspaceRecord) => {
      puts.push(record)
      const at = records.findIndex(candidate => candidate.id === record.id)
      if (at === -1) records.push(record)
      else records[at] = record
    }),
  }
  const store = {
    target: calls.target,
    putWorkspace: calls.putWorkspace,
    listWorkspaces: (id?: string) => records.filter(record => id === undefined || record.targetId === id),
    packagePolicy: () => ({ policy: 'auto' as const, mirror: '' }),
  } as unknown as TargetStore
  return { store, records, puts, calls }
}

/** What a test needs to drive one service instance. */
interface Harness {
  service: RemoteWorkspaces
  store: ReturnType<typeof fakeStore>
  registry: ReturnType<typeof fakeRegistry>
  remote: ReturnType<typeof fakeRemoteClient>
  touched: string[]
  /** Mark the target connected (`channels.has(targetId)`) without a real channel. */
  connect(): void
  /** The private materialize call the open/resume path makes (no `force`). */
  materialize(targetId: string, options: { path: string; remoteWorkspaceId: string }): Promise<{ record: RemoteWorkspaceRecord; stub: string; official: OfficialRow | undefined }>
}

/**
 * Assemble one service with a connected target and a healthy registry.
 * @param options.registry - overrides the default registry stand-in (may be `undefined`).
 * @param options.connected - whether `channels` claims a live channel.
 */
function harness(options: { registry?: ReturnType<typeof fakeRegistry> | undefined; connected?: boolean; services?: Record<string, unknown> } = {}): Harness {
  const store = fakeStore('rt-1')
  const registry = options.registry ?? fakeRegistry()
  const remote = fakeRemoteClient()
  const { ctx, touched } = fakeContext({
    workspaceRegistry: registry.registry,
    ...options.services,
  })
  const service = new RemoteWorkspaces(ctx, store.store, { packageRoot: process.cwd(), leaseMs: 30_000, maxProcesses: 4 })
  const internals = service as unknown as {
    channels: Map<string, unknown>
    withBrowser<T>(targetId: string, operation: (client: unknown) => Promise<T>): Promise<T>
    materializeWorkspace(target: RemoteTargetRecord, options: { path: string; remoteWorkspaceId: string }): Promise<{ record: RemoteWorkspaceRecord; stub: string; official: OfficialRow | undefined }>
  }
  if (options.connected !== false) internals.channels.set('rt-1', {})
  // Both directory validation and registration go through `withBrowser`; the
  // transport is the only part replaced, so `listDirectory` and
  // `ensureRemoteWorkspace` run for real against the fake client.
  vi.spyOn(internals, 'withBrowser').mockImplementation(async (_targetId, operation) => await operation(remote.client))
  return {
    service,
    store,
    registry,
    remote,
    touched,
    connect: () => { internals.channels.set('rt-1', {}) },
    materialize: async (targetId, materializeOptions) => await internals.materializeWorkspace(store.calls.target(targetId) as RemoteTargetRecord, materializeOptions),
  }
}

/** Read the coded refusal a rejected promise carries. */
async function refusal(work: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await work
  } catch (error) {
    const coded = error as { code?: string; message?: string }
    return { code: coded.code ?? '', message: coded.message ?? '' }
  }
  throw new Error('expected a refusal')
}

/** Temporary `HOME`, so the stub directory never lands in the real `~/.dsh`. */
const homes: string[] = []

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-rw-prepare-'))
  homes.push(home)
  vi.stubEnv('HOME', home)
  vi.stubEnv('USERPROFILE', home)
  // Gate 0's default: no shell rows unless the caller forces them.
  vi.stubEnv('DSH_RW_FORCE_SHELL_WORKSPACES', '')
  return home
}

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

/* ------------------------------------------------------- 1: idempotency */

describe('prepareWorkspace: idempotent and session-free', () => {
  it('keeps every id across two calls, re-registers nothing, and creates no session', async () => {
    await tempHome()
    const test = harness()
    const first = await test.service.prepareWorkspace('rt-1', REMOTE_PATH)
    const second = await test.service.prepareWorkspace('rt-1', REMOTE_PATH)

    // Same plugin row, same server workspace, same shell row, same stub.
    expect(first.workspace.id).toBe(second.workspace.id)
    expect(first.workspace.remoteWorkspaceId).toBe('srv-1')
    expect(second.workspace.remoteWorkspaceId).toBe('srv-1')
    expect(first.officialWorkspaceId).toBe(second.officialWorkspaceId)
    expect(first.stubPath).toBe(second.stubPath)

    // The server entry was looked up, not created twice (`reg.list` first).
    expect(test.remote.rpcs.filter(method => method === 'reg.create')).toHaveLength(1)
    expect(test.remote.rpcs.filter(method => method === 'reg.list')).toHaveLength(2)
    // The shell row was resolved, not created twice.
    expect(test.registry.calls.filter(call => call === 'create')).toHaveLength(1)
    expect(test.registry.rows).toHaveLength(1)

    // **No session**: nothing asked the agent/session services, no write ever
    // carried a sessionId, and no `persist.*` RPC was attempted.
    expect(test.touched).not.toContain('agents')
    expect(test.touched).not.toContain('sessions')
    expect(test.store.puts.every(record => record.sessionId === undefined)).toBe(true)
    // Two writes per prepare: the materialized record, then the view-state
    // touch (`lastOpenedAt`) that sorts the prepared row first.
    expect(test.store.calls.putWorkspace).toHaveBeenCalledTimes(4)
    expect(test.remote.rpcs.some(method => method.startsWith('persist.'))).toBe(false)
  })

  it('reports the stored stub (the shell row path) as the draft cwd', async () => {
    const home = await tempHome()
    const test = harness()
    const prepared = await test.service.prepareWorkspace('rt-1', REMOTE_PATH)

    // `routeForCwd` compares the session's cwd against this value, and the
    // shell derives that cwd from its own row — the two must be one string.
    expect(prepared.stubPath).toBe(test.registry.rows[0]?.path)
    expect(prepared.workspace.stubPath).toBe(prepared.stubPath)
    expect(prepared.stubPath.startsWith(home) || prepared.stubPath.startsWith(`/private${home}`)).toBe(true)
    expect(prepared.workspace.targetId).toBe('rt-1')
    expect(prepared.workspace.remoteWorkspaceId).toBe('srv-1')
  })

  it('keeps the record id and its session pointer untouched (no "latest session" rewrite)', async () => {
    await tempHome()
    const test = harness()
    const first = await test.service.prepareWorkspace('rt-1', REMOTE_PATH)
    const second = await test.service.prepareWorkspace('rt-1', REMOTE_PATH)
    expect(second.workspace.id).toBe(first.workspace.id)
    expect(second.workspace.sessionId).toBeUndefined()
    // `lastOpenedAt` is a view-state touch (the prepared row sorts first).
    expect(second.workspace.lastOpenedAt).toBeDefined()
  })
})

/* --------------------------------------- 2: forced shell row vs Gate 0 */

describe('prepareWorkspace: the forced shell row', () => {
  it('registers the shell row even with the Gate 0 switch off', async () => {
    await tempHome()
    // The switch is off by default; that is the state this case runs in.
    expect(shouldRegisterShellWorkspaces({})).toBe(false)
    expect(process.env.DSH_RW_FORCE_SHELL_WORKSPACES ?? '').toBe('')
    const test = harness()
    const prepared = await test.service.prepareWorkspace('rt-1', REMOTE_PATH)

    expect(prepared.officialWorkspaceId).toBe('official-1')
    expect(test.registry.calls).toContain('create')
    expect(test.registry.rows).toHaveLength(1)
    // The row is what `uiWorkspace.startSession(workspaceId)` resolves.
    expect(prepared.workspace.officialWorkspaceId).toBe(prepared.officialWorkspaceId)
  })

  it('leaves the open/resume path unregistered (Gate 0 does not regress)', async () => {
    await tempHome()
    const test = harness()
    // Exactly the call `openWorkspace` and `resumeSessionOnce` make: no `force`.
    const materialized = await test.materialize('rt-1', { path: '/home/tester/other', remoteWorkspaceId: 'srv-9' })

    expect(test.registry.calls).toEqual([])
    expect(materialized.official).toBeUndefined()
    expect(materialized.record.officialWorkspaceId).toBeUndefined()
    // The stub is still ours (routing needs it) — only the shell row is absent.
    expect(materialized.record.stubPath).toBe(materialized.stub)
  })

  it('hands the very same registry row to a second prepare (a swept-then-rewritten row keeps its id)', async () => {
    await tempHome()
    const test = harness()
    const first = await test.service.prepareWorkspace('rt-1', REMOTE_PATH)
    // The startup sweep deletes the row; the registry then answers a *new* one.
    test.registry.rows.splice(0)
    const second = await test.service.prepareWorkspace('rt-1', REMOTE_PATH)
    expect(second.officialWorkspaceId).toBe('official-2')
    expect(second.workspace.id).toBe(first.workspace.id)
    expect(second.officialWorkspaceId).not.toBe(first.officialWorkspaceId)
  })
})

describe('officialWorkspaceFor: the force override', () => {
  it('registers while the switch is off when the caller forces it', async () => {
    const { registry, calls } = fakeRegistry()
    const official = await officialWorkspaceFor({ registry, canonicalStub: '/stub', shellTitle: 'w · box', force: true })
    expect(official?.id).toBe('official-1')
    expect(calls).toEqual(['resolveByPath', 'create'])
  })

  it('treats force:false exactly like the switch being off', async () => {
    const { registry, calls } = fakeRegistry()
    const official = await officialWorkspaceFor({ registry, canonicalStub: '/stub', shellTitle: 'w · box', force: false })
    expect(official).toBeUndefined()
    expect(calls).toEqual([])
  })
})

/* ------------------------------------------- 3: not connected fails loud */

describe('prepareWorkspace: a stopped target', () => {
  it('refuses with target-not-connected before the realm gate and any registration', async () => {
    await tempHome()
    const test = harness({ connected: false })
    const refused = await refusal(test.service.prepareWorkspace('rt-1', REMOTE_PATH))

    expect(refused.code).toBe('target-not-connected')
    expect(refused.message).toContain('connect the host first')
    // Order matters: a stopped host is not reported as a realm problem.
    expect(test.touched).not.toContain('agentPresets')
    expect(test.touched).not.toContain('workspaceRegistry')
    expect(test.registry.calls).toEqual([])
    expect(test.remote.rpcs).toEqual([])
    expect(test.store.calls.putWorkspace).not.toHaveBeenCalled()
  })

  it('never degrades to a local workspace', async () => {
    await tempHome()
    const test = harness({ connected: false })
    await refusal(test.service.prepareWorkspace('rt-1', REMOTE_PATH))
    // Nothing materialized locally either: no stub record, no shell row.
    expect(test.store.records).toEqual([])
    expect(test.registry.rows).toEqual([])
  })

  it('reports an unknown target as such', async () => {
    await tempHome()
    const test = harness()
    await expect(test.service.prepareWorkspace('rt-missing', REMOTE_PATH)).rejects.toThrow(/unknown remote target "rt-missing"/)
  })
})

/* ------------------------------------- 4: unavailable shell workspace row */

describe('prepareWorkspace: an unbindable draft', () => {
  it('fails with shell-workspace-unavailable when the host has no registry', async () => {
    await tempHome()
    const store = fakeStore('rt-1')
    const remote = fakeRemoteClient()
    const { ctx } = fakeContext({ workspaceRegistry: undefined })
    const service = new RemoteWorkspaces(ctx, store.store, { packageRoot: process.cwd(), leaseMs: 30_000, maxProcesses: 4 })
    const internals = service as unknown as {
      channels: Map<string, unknown>
      withBrowser<T>(targetId: string, operation: (client: unknown) => Promise<T>): Promise<T>
    }
    internals.channels.set('rt-1', {})
    vi.spyOn(internals, 'withBrowser').mockImplementation(async (_targetId, operation) => await operation(remote.client))

    const refused = await refusal(service.prepareWorkspace('rt-1', REMOTE_PATH))
    expect(refused.code).toBe('shell-workspace-unavailable')
    expect(refused.message).toContain('remote workspace "rt-1"')
    expect(refused.message).toContain('could not be registered')
    // The remote entry is real; the *draft* is what cannot be bound.
    expect(remote.rpcs).toContain('reg.create')
  })

  it('turns a refusing registry into the same code instead of a silent success', async () => {
    await tempHome()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const test = harness({ registry: fakeRegistry({ refuse: true }) })
    const refused = await refusal(test.service.prepareWorkspace('rt-1', REMOTE_PATH))

    expect(refused.code).toBe('shell-workspace-unavailable')
    expect(test.registry.calls).toContain('create')
    expect(errorLog).toHaveBeenCalledWith(
      '[dsh-remote-workspace] registering the workspace in the shell tree failed',
      expect.any(Error),
    )
    // Still no session: the refusal happens before anything could be opened.
    expect(test.touched).not.toContain('agents')
    expect(test.remote.rpcs.some(method => method.startsWith('persist.'))).toBe(false)
  })
})
