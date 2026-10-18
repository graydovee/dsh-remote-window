/**
 * P2 host model: local `WorkspaceRef`s follow the **server's** workspace list.
 *
 * The user requirement behind this file: two clients connected to the same server
 * must see each other's workspaces. That only works if this client *derives* its
 * rows from `reg.list` instead of remembering what it created itself, which means:
 *
 * - a workspace this client never created gets a bare ref
 *   (`targetId` + `remoteWorkspaceId` only) — no stub, no shell row;
 * - a ref whose workspace the server no longer lists is dropped (with its stub),
 *   so a delete made on another device propagates on the next refresh;
 * - a legacy pre-P0 ref (path/title, no server id) is migrated by adopting the
 *   server's id for that path — never by re-creating a duplicate entry.
 *
 * Also covered: the Gate 0 sweep removes leaked official shell rows and nothing
 * else.
 */
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { officialWorkspaceFor, RemoteWorkspaces, scrubShellWorkspaces } from '../src/provision/service.ts'
import { workspaceRecordSchema, type RemoteWorkspaceRecord } from '../src/targets/types.ts'
import type { TargetStore } from '../src/targets/store.ts'
import type { RemoteWorkspaceSummary, WorkspaceId } from '../src/protocol.ts'

/** An in-memory `workspaces` table plus the registry stub the service consults. */
function fakeStore(initial: RemoteWorkspaceRecord[] = []): {
  store: TargetStore
  rows: Map<string, RemoteWorkspaceRecord>
  registry: { entries: Map<string, string>; deleted: string[] }
} {
  const rows = new Map(initial.map(record => [record.id, record]))
  const entries = new Map<string, string>()
  const deleted: string[] = []
  const store = {
    // A stored target exists; whether it is CONNECTED is the service's channels map.
    target: (id: string) => id === 'rt-1' || id === 'rt-stopped' ? { id, label: id, kind: 'ssh', host: 'h', port: 22, username: 'u', authKind: 'agent', hostKeyFingerprint: 'SHA256:x', remote: { nodePath: 'node', dshCommand: 'dsh', profile: 'dsh-remote-server', dshHome: '~/.dsh', plugins: [] }, status: 'stopped', createdAt: '2026-01-01T00:00:00.000Z' } : undefined,
    listWorkspaces: (targetId?: string) => [...rows.values()].filter(record => targetId === undefined || record.targetId === targetId),
    workspace: (id: string) => rows.get(id),
    putWorkspace: async (record: RemoteWorkspaceRecord) => {
      rows.set(record.id, workspaceRecordSchema.parse(record) as RemoteWorkspaceRecord)
    },
    deleteWorkspace: async (id: string) => rows.delete(id),
  } as unknown as TargetStore
  return { store, rows, registry: { entries, deleted } }
}

/** A context exposing only the official shell registry the service touches. */
function fakeCtx(registry: { entries: Map<string, string>; deleted: string[] }): Context {
  const service = {
    // `entries` maps a canonical stub path to the official entry id.
    resolveByPath: (path: string) => {
      const id = registry.entries.get(path)
      return id === undefined ? undefined : { id, path, attachSession: async () => {} }
    },
    create: async (path: string) => {
      const id = `official-${registry.entries.size + 1}`
      registry.entries.set(path, id)
      return { id, path, attachSession: async () => {} }
    },
    delete: async (id: string) => {
      registry.deleted.push(id)
      for (const [path, entry] of registry.entries) if (entry === id) registry.entries.delete(path)
    },
  }
  return {
    get: (name: string) => (name === 'workspaceRegistry' ? service : undefined),
  } as unknown as Context
}

/** One `reg.list` item. */
function serverItem(id: string, path: string, title = path.split('/').at(-1) ?? path): RemoteWorkspaceSummary {
  return { id: id as WorkspaceId, path, title, createdAt: '2026-10-18T00:00:00.000Z', sessionCount: 0 }
}

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-refs-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

describe('reconcileWorkspaceRefs', () => {
  it('registers a bare ref for a workspace another client created', async () => {
    const { store, rows, registry } = fakeStore()
    const subject = new RemoteWorkspaces(fakeCtx(registry), store, { packageRoot: process.cwd(), leaseMs: 30_000, maxProcesses: 4 })
    await subject.reconcileWorkspaceRefs('rt-1', [serverItem('0123456789abcdef', '/home/u/proj')])
    expect(rows.size).toBe(1)
    const [ref] = [...rows.values()]
    expect(ref).toMatchObject({ targetId: 'rt-1', remoteWorkspaceId: '0123456789abcdef' })
    // A bare ref carries no materialization: no stub, no shell row, no path copy.
    expect(ref?.stubPath).toBeUndefined()
    expect(ref?.officialWorkspaceId).toBeUndefined()
    expect(ref?.path).toBeUndefined()
    expect(ref?.id.startsWith('wr-')).toBe(true)
  })

  it('is idempotent across repeated reads', async () => {
    const { store, rows, registry } = fakeStore()
    const subject = new RemoteWorkspaces(fakeCtx(registry), store, { packageRoot: process.cwd(), leaseMs: 30_000, maxProcesses: 4 })
    const items = [serverItem('0123456789abcdef', '/home/u/proj')]
    await subject.reconcileWorkspaceRefs('rt-1', items)
    await subject.reconcileWorkspaceRefs('rt-1', items)
    expect(rows.size).toBe(1)
  })

  it('drops a ref whose workspace the server no longer lists, and its stub', async () => {
    const stub = join(dir, 'stub-gone')
    await mkdir(stub, { recursive: true })
    await writeFile(join(stub, 'keep.txt'), 'x')
    const { store, rows, registry } = fakeStore([
      { id: 'wr-gone', targetId: 'rt-1', remoteWorkspaceId: 'fedcba9876543210', stubPath: stub },
    ])
    const subject = new RemoteWorkspaces(fakeCtx(registry), store, { packageRoot: process.cwd(), leaseMs: 30_000, maxProcesses: 4 })
    await subject.reconcileWorkspaceRefs('rt-1', [])
    expect(rows.size).toBe(0)
    // The stub directory goes with it; the server's session logs are not involved.
    await expect(stat(stub)).rejects.toThrow()
  })

  it('migrates a legacy ref by adopting the server id for its path', async () => {
    const stub = join(dir, 'stub-legacy')
    await mkdir(stub, { recursive: true })
    const { store, rows, registry } = fakeStore([
      {
        id: 'rw-1a2b3c4d',
        targetId: 'rt-1',
        path: '/home/u/proj',
        title: 'proj',
        createdAt: '2025-12-31T00:00:00.000Z',
        stubPath: stub,
        sessionId: 'session-1',
        pinnedSessions: ['session-1'],
      },
    ])
    const subject = new RemoteWorkspaces(fakeCtx(registry), store, { packageRoot: process.cwd(), leaseMs: 30_000, maxProcesses: 4 })
    await subject.reconcileWorkspaceRefs('rt-1', [serverItem('0123456789abcdef', '/home/u/proj')])
    const [ref] = [...rows.values()]
    expect(ref).toMatchObject({
      id: 'rw-1a2b3c4d',
      targetId: 'rt-1',
      remoteWorkspaceId: '0123456789abcdef',
      stubPath: stub,
      sessionId: 'session-1',
      pinnedSessions: ['session-1'],
    })
    // Legacy fields are cleared: the server owns path/title/createdAt now.
    expect(ref?.path).toBeUndefined()
    expect(ref?.title).toBeUndefined()
    expect(ref?.createdAt).toBeUndefined()
    expect(rows.size).toBe(1)
  })

  it('drops a ref that has neither a server id nor a path (unresolvable)', async () => {
    const { store, rows, registry } = fakeStore([{ id: 'wr-empty', targetId: 'rt-1' }])
    const subject = new RemoteWorkspaces(fakeCtx(registry), store, { packageRoot: process.cwd(), leaseMs: 30_000, maxProcesses: 4 })
    await subject.reconcileWorkspaceRefs('rt-1', [])
    expect(rows.size).toBe(0)
  })

  it('reports no stub→remote alias for a ref that was only auto-registered', async () => {
    const { store, registry } = fakeStore()
    const subject = new RemoteWorkspaces(fakeCtx(registry), store, { packageRoot: process.cwd(), leaseMs: 30_000, maxProcesses: 4 })
    await subject.reconcileWorkspaceRefs('rt-1', [serverItem('0123456789abcdef', '/home/u/proj')])
    // Nothing has been materialized yet, so the realm has nothing to rewrite —
    // and in particular it must not invent an alias without a stub.
    expect(subject.pathAliases('rt-1')).toEqual([])
  })
})

describe('legacy record compatibility', () => {
  it('the storage schema still accepts a pre-P0 record', () => {
    const legacy = {
      id: 'rw-1a2b3c4d',
      targetId: 'rt-1',
      path: '/home/u/proj',
      title: 'proj',
      createdAt: '2025-12-31T00:00:00.000Z',
      stubPath: 'C:\\Users\\u\\.dsh\\remote-workspaces\\rt-1\\abcd1234',
      officialWorkspaceId: 'official-1',
      sessionId: 'session-1',
      pinnedSessions: ['session-1'],
      archivedSessions: [],
    }
    expect(workspaceRecordSchema.parse(legacy)).toMatchObject({ path: '/home/u/proj', title: 'proj' })
  })

  it('accepts a migrated ref (no legacy fields at all)', () => {
    expect(workspaceRecordSchema.parse({ id: 'wr-1', targetId: 'rt-1', remoteWorkspaceId: '0123456789abcdef' })).toBeTruthy()
  })
})

describe('a bare (auto-registered) ref is usable', () => {
  /** A target record good enough for the local materialization path. */
  const target = {
    id: 'rt-1',
    label: 'box',
    kind: 'ssh' as const,
    host: '10.0.0.9',
    port: 22,
    username: 'u',
    authKind: 'agent' as const,
    hostKeyFingerprint: 'SHA256:x',
    remote: { nodePath: 'node', dshCommand: 'dsh', profile: 'dsh-remote-server', dshHome: '~/.dsh', plugins: [] },
    status: 'ready' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
  }

  it('sessions() resolves the workspace from the bare ref (no path needed)', async () => {
    const { store, registry } = fakeStore([{ id: 'wr-1', targetId: 'rt-1', remoteWorkspaceId: '0123456789abcdef' }])
    const subject = new RemoteWorkspaces(fakeCtx(registry), store, { packageRoot: process.cwd(), leaseMs: 30_000, maxProcesses: 4 })
    // The persist.* plane is browser-backed; stub only that hop to isolate the
    // lookup: a ref without `path`/`stubPath` must still resolve.
    const calls: unknown[] = []
    ;(subject as unknown as { sessionRequest: unknown }).sessionRequest = async (_targetId: string, method: string, params: unknown) => {
      calls.push([method, params])
      return []
    }
    await expect(subject.listRemoteSessions('rt-1', '0123456789abcdef')).resolves.toEqual([])
    await expect(subject.listRemoteSessions('rt-1', 'wr-1')).resolves.toEqual([])
    // Both keys reached the same server workspace id (`persist.titles` is the
    // additive second call and carries the same id).
    expect(calls.filter(call => (call as [string])[0] === 'persist.list')).toEqual([
      ['persist.list', { workspaceId: '0123456789abcdef' }],
      ['persist.list', { workspaceId: '0123456789abcdef' }],
    ])
  })

  it('session-flag accepts the server workspace id as the key', async () => {
    const { store, rows, registry } = fakeStore([{ id: 'wr-1', targetId: 'rt-1', remoteWorkspaceId: '0123456789abcdef' }])
    const subject = new RemoteWorkspaces(fakeCtx(registry), store, { packageRoot: process.cwd(), leaseMs: 30_000, maxProcesses: 4 })
    const updated = await subject.setSessionFlag('0123456789abcdef', 'session-1', 'pinned', true)
    expect(updated.pinnedSessions).toEqual(['session-1'])
    // ... and it wrote the ref under its local id, not a new row.
    expect(rows.size).toBe(1)
    expect(rows.get('wr-1')?.pinnedSessions).toEqual(['session-1'])
  })

  it('open-workspace materializes a stub onto the existing bare ref', async () => {
    // Shell rows are off by default (Gate 0 branch A), so materialization must
    // touch nothing but the stub + the ref.
    const { store, rows, registry } = fakeStore([{ id: 'wr-1', targetId: 'rt-1', remoteWorkspaceId: '0123456789abcdef' }])
    const subject = new RemoteWorkspaces(fakeCtx(registry), store, { packageRoot: process.cwd(), leaseMs: 30_000, maxProcesses: 4 })
    const materialize = (subject as unknown as {
      materializeWorkspace: (t: typeof target, o: { path: string; remoteWorkspaceId: string }) => Promise<{ record: RemoteWorkspaceRecord; stub: string; official: unknown }>
    }).materializeWorkspace.bind(subject)
    const outcome = await materialize(target, { path: '/home/u/proj', remoteWorkspaceId: '0123456789abcdef' })
    expect(outcome.official).toBeUndefined()
    expect(outcome.record.stubPath).toBe(outcome.stub)
    // The ref keeps its identity: no duplicate row, no legacy path/title copy.
    expect(rows.size).toBe(1)
    expect(rows.get('wr-1')).toMatchObject({ targetId: 'rt-1', remoteWorkspaceId: '0123456789abcdef', stubPath: outcome.stub })
    expect(rows.get('wr-1')?.path).toBeUndefined()
    // Now that it is materialized, the realm gets its stub → remote alias.
    ;(subject as unknown as { workspacePaths: Map<string, string> }).workspacePaths.set('rt-1\u00000123456789abcdef', '/home/u/proj')
    expect(subject.pathAliases('rt-1')).toEqual([{ stub: outcome.stub, remote: '/home/u/proj' }])
    await rm(outcome.stub, { recursive: true, force: true }).catch(() => {})
  })
})

describe('the startup sweep waits for the registry (alpha59)', () => {
  /** A registry that only becomes visible after `appearAfter` `get()` calls. */
  function lateRegistry(entries: Map<string, string>, deleted: string[], appearAfter: number): Context {
    const registry = {
      resolveByPath: async (path: string) => {
        const id = entries.get(path)
        return id === undefined ? undefined : { id, path, attachSession: async () => {} }
      },
      create: async (path: string) => {
        const id = `official-${entries.size + 1}`
        entries.set(path, id)
        return { id, path, attachSession: async () => {} }
      },
      delete: async (id: string) => {
        deleted.push(id)
        for (const [path, entry] of entries) if (entry === id) entries.delete(path)
      },
    }
    let reads = 0
    return {
      get: (name: string) => {
        if (name !== 'workspaceRegistry') return undefined
        reads += 1
        return reads > appearAfter ? registry : undefined
      },
    } as unknown as Context
  }

  /** A stub tree with one directory for `rt-1`, plus its registry entry. */
  async function stubTree(label: string): Promise<{ root: string; id: string; entries: Map<string, string> }> {
    const root = join(dir, label)
    const stub = join(root, 'rt-1', 'aaaa1111')
    await mkdir(stub, { recursive: true })
    return { root, id: 'official-a', entries: new Map([[stub, 'official-a']]) }
  }

  it('retries until the registry exists, then really deletes', async () => {
    const { root, entries } = await stubTree('late-workspaces')
    const deleted: string[] = []
    // `undefined` twice, then the registry — exactly the boot order that made
    // alpha58's startup sweep a silent no-op.
    const ctx = lateRegistry(entries, deleted, 2)
    const subject = new RemoteWorkspaces(ctx, fakeStore().store, { packageRoot: process.cwd(), leaseMs: 30_000, maxProcesses: 4 })
    const result = await subject.scrubWhenRegistryReady({ timeoutMs: 1_000, intervalMs: 1, root })
    expect(result).toEqual({ removed: ['official-a'], kept: [] })
    expect(deleted).toEqual(['official-a'])
    expect(entries.size).toBe(0)
  })

  it('gives up after the timeout without marking the sweep done', async () => {
    const { root, entries } = await stubTree('never-workspaces')
    const deleted: string[] = []
    const ctx = lateRegistry(entries, deleted, Number.MAX_SAFE_INTEGER)
    const subject = new RemoteWorkspaces(ctx, fakeStore().store, { packageRoot: process.cwd(), leaseMs: 30_000, maxProcesses: 4 })
    await expect(subject.scrubWhenRegistryReady({ timeoutMs: 20, intervalMs: 1, root })).resolves.toBeUndefined()
    expect(deleted).toEqual([])
    // The first `/api/state` net can still run later (flag untouched).
    const late = await subject.scrubShellWorkspacesOnce({ root })
    expect(late).toEqual({ removed: [], kept: [] })
  })

  it('the first /api/state sweep runs once, later calls do not re-scan', async () => {
    const { root, entries } = await stubTree('once-workspaces')
    const deleted: string[] = []
    const ctx = lateRegistry(entries, deleted, 0)
    const subject = new RemoteWorkspaces(ctx, fakeStore().store, { packageRoot: process.cwd(), leaseMs: 30_000, maxProcesses: 4 })
    const first = await subject.scrubShellWorkspacesOnce({ root })
    expect(first).toEqual({ removed: ['official-a'], kept: [] })
    const second = await subject.scrubShellWorkspacesOnce({ root })
    expect(second).toEqual({ removed: [], kept: [] })
    // The second call is a no-op: `delete` ran exactly once.
    expect(deleted).toEqual(['official-a'])
  })

  it('a workspace write on a stopped target answers target-not-connected (409)', async () => {
    const ctx = { get: () => undefined } as unknown as Context
    const subject = new RemoteWorkspaces(ctx, fakeStore().store, { packageRoot: process.cwd(), leaseMs: 30_000, maxProcesses: 4 })
    const rename = await subject.renameWorkspace('rt-stopped', '0123456789abcdef', 'x')
      .then(() => undefined, (error: unknown) => error as Error & { code?: string })
    expect(rename?.code).toBe('target-not-connected')
    expect(rename?.message).toContain('connect the host first')
    const remove = await subject.deleteWorkspace('rt-stopped', '0123456789abcdef')
      .then(() => undefined, (error: unknown) => error as Error & { code?: string })
    expect(remove?.code).toBe('target-not-connected')
  })
})
describe('an ASYNC shell registry (the official one returns Promises)', () => {
  /** Registry whose every method is async — exactly like `dsh-workspace`. */
  function asyncCtx(entries: Map<string, string>, deleted: string[]): Context {
    return {
      get: (name: string) =>
        name !== 'workspaceRegistry'
          ? undefined
          : {
              resolveByPath: async (path: string) => {
                const id = entries.get(path)
                return id === undefined ? undefined : { id, path, attachSession: async () => {} }
              },
              create: async (path: string) => {
                const id = `official-${entries.size + 1}`
                entries.set(path, id)
                return { id, path, attachSession: async () => {} }
              },
              delete: async (id: string) => {
                deleted.push(id)
                for (const [path, entry] of entries) if (entry === id) entries.delete(path)
              },
            },
    } as unknown as Context
  }

  it('scrub removes the REAL ids (alpha57 answered [null, null])', async () => {
    const root = join(dir, 'async-workspaces')
    const stubA = join(root, 'rt-1', 'aaaa1111')
    const stubB = join(root, 'rt-1', 'bbbb2222')
    await mkdir(stubA, { recursive: true })
    await mkdir(stubB, { recursive: true })
    const entries = new Map<string, string>([
      [stubA, 'official-a'],
      [stubB, 'official-b'],
    ])
    const deleted: string[] = []
    const result = await scrubShellWorkspaces(asyncCtx(entries, deleted), { root })
    // Real id strings, never `undefined` from an un-awaited Promise.
    expect(result.removed.sort()).toEqual(['official-a', 'official-b'])
    expect(deleted.sort()).toEqual(['official-a', 'official-b'])
    expect(result.kept).toEqual([])
    expect(entries.size).toBe(0)
  })

  it('officialWorkspaceFor awaits resolveByPath and returns an object', async () => {
    vi.stubEnv('DSH_RW_FORCE_SHELL_WORKSPACES', '1')
    const entries = new Map<string, string>([['/stub', 'official-a']])
    const registry = asyncCtx(entries, []).get('workspaceRegistry') as unknown as Parameters<typeof officialWorkspaceFor>[0]['registry']
    const official = await officialWorkspaceFor({ registry, canonicalStub: '/stub', shellTitle: 'w · target' })
    expect(official).not.toBeInstanceOf(Promise)
    expect(official).toMatchObject({ id: 'official-a', path: '/stub' })
    // The call the shell-tree path makes must be reachable on the awaited value.
    expect(typeof official?.attachSession).toBe('function')
  })
})
describe('scrubShellWorkspaces (Gate 0 sweep)', () => {
  it('removes only the entries whose path is one of our stubs', async () => {
    const root = join(dir, 'remote-workspaces')
    const stubA = join(root, 'rt-1', 'aaaa1111')
    const stubB = join(root, 'rt-1', 'bbbb2222')
    const unrelated = join(dir, 'a-real-project')
    await mkdir(stubA, { recursive: true })
    await mkdir(stubB, { recursive: true })
    await mkdir(unrelated, { recursive: true })
    const { registry } = fakeStore()
    const ctx = fakeCtx(registry)
    // Two stubs leaked a row; the unrelated project also has one (must survive).
    registry.entries.set(stubA, 'official-a')
    registry.entries.set(unrelated, 'official-real')
    const result = await scrubShellWorkspaces(ctx, { root })
    expect(result.removed.sort()).toEqual(['official-a'])
    expect(result.kept).toContain(stubB)
    expect(registry.deleted).toEqual(['official-a'])
    // The unrelated workspace is untouched, and no stub directory was removed.
    expect(registry.entries.get(unrelated)).toBe('official-real')
    await expect(stat(stubA)).resolves.toBeTruthy()
  })

  it('is a no-op when the host has no shell registry', async () => {
    const ctx = { get: () => undefined } as unknown as Context
    await expect(scrubShellWorkspaces(ctx, { root: join(dir, 'missing') })).resolves.toEqual({ removed: [], kept: [] })
  })
})
