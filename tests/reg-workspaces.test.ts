/**
 * Protocol v3 workspace RPCs: `reg.list` activity, `reg.rename`, `reg.delete`.
 *
 * The three load-bearing rules (doc/api-contract.md §14, architecture §7.2):
 *
 * 1. **Rename never moves the id or the path** — view state keyed by workspace id
 *    (pins/archives) must survive a rename, and the title lives on the server.
 * 2. **Delete only removes the registry entry.** Session logs under
 *    `~/.dsh/remote-server-sessions/**` are never touched, so re-registering the
 *    same path restores its `sessionCount` — that recovery is the automated proof
 *    that data was not lost (A35).
 * 3. **Delete is idempotent** and refuses a non-empty workspace unless `force`.
 *
 * Driven against the real `RemoteSessionStore` with a fake persistence/registry,
 * so the assertions are about behaviour rather than a mocked protocol.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { assertHelloProtocol } from '../src/server/controller.ts'
import { RemoteSessionStore } from '../src/server/session-store.ts'
import { REMOTE_METHODS, REMOTE_SESSION_PROTOCOL } from '../src/protocol.ts'

/** One stored session as the fake persistence exposes it. */
interface FakeSession {
  readonly id: string
  readonly cwd: string
  readonly createdAt: number
  /** Log events: `time` is what `updatedAt` folds. */
  readonly events: { type: string; time: number; data?: unknown }[]
}

/** A persistence stand-in that records creates/opens and serves stored sessions. */
function fakePersistence(sessions: FakeSession[]): {
  service: Record<string, unknown>
  reads: () => number
} {
  let reads = 0
  const snapshots = () =>
    sessions.map(session => ({
      header: { id: session.id, cwd: session.cwd, createdAt: session.createdAt },
      sizeBytes: session.events.length,
    }))
  const service = {
    list: async () => snapshots(),
    create: async (header: { id: string; cwd: string; createdAt: number }) => {
      sessions.push({ id: header.id, cwd: header.cwd, createdAt: header.createdAt, events: [] })
      return {
        header,
        inheritedEventCount: undefined,
        read: async () => ({ events: [] }),
        append: async () => {},
        flush: async () => {},
        close: async () => {},
      }
    },
    open: async (id: string) => {
      reads++
      const session = sessions.find(candidate => candidate.id === id)
      if (session === undefined) throw new Error(`session "${id}" not found`)
      return {
        header: { id: session.id, cwd: session.cwd, createdAt: session.createdAt },
        inheritedEventCount: undefined,
        read: async () => ({ events: session.events }),
        append: async () => {},
        flush: async () => {},
        close: async () => {},
      }
    },
  }
  return { service, reads: () => reads }
}

/** A registry stand-in with the official `list`/`create`/`delete` surface. */
function fakeRegistry(records: { id?: string; path: string; title: string; createdAt?: string }[]): {
  service: Record<string, unknown>
  deleted: string[]
} {
  const deleted: string[] = []
  return {
    service: {
      list: () => records,
      create: async (path: string, title?: string) => {
        const existing = records.find(record => record.path === path)
        if (existing !== undefined) return existing
        const created = { id: `reg-${records.length + 1}`, path, title: title ?? path, createdAt: '2026-01-01T00:00:00.000Z' }
        records.push(created)
        return created
      },
      delete: async (id: string) => {
        deleted.push(id)
        const index = records.findIndex(record => record.id === id)
        if (index >= 0) records.splice(index, 1)
        return true
      },
    },
    deleted,
  }
}

let dir = ''
let indexPath = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-reg-'))
  indexPath = join(dir, 'workspaces.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

/** Build a store over the given fakes. */
function store(options: {
  sessions: FakeSession[]
  records: { id?: string; path: string; title: string; createdAt?: string }[]
}): { store: RemoteSessionStore; reads: () => number; deleted: string[]; records: typeof options.records } {
  const persistence = fakePersistence(options.sessions)
  const registry = fakeRegistry(options.records)
  const ctx = {
    get: (name: string) => (name === 'sessionPersistence' ? persistence.service : name === 'workspaceRegistry' ? registry.service : undefined),
  } as unknown as Context
  return {
    store: new RemoteSessionStore(ctx, 'server-1', 'install-1', indexPath),
    reads: persistence.reads,
    deleted: registry.deleted,
    records: options.records,
  }
}

describe('protocol 3 surface', () => {
  it('advertises protocol 3 and the new method names', () => {
    expect(REMOTE_SESSION_PROTOCOL).toBe(3)
    expect(REMOTE_METHODS.renameWorkspace).toBe('reg.rename')
    expect(REMOTE_METHODS.deleteWorkspace).toBe('reg.delete')
  })

  it('refuses an older client with an actionable sentence (never a schema error)', () => {
    expect(() => assertHelloProtocol({ protocol: 2, clientVersion: '0.1.0-alpha54' })).toThrow(
      'unsupported remote session protocol 2; this server speaks 3 (upgrade the client plugin)',
    )
    expect(() => assertHelloProtocol({ protocol: 'x' })).toThrow(/unsupported remote session protocol unknown; this server speaks 3/)
    expect(() => assertHelloProtocol({ protocol: 3, clientVersion: 'v' })).not.toThrow()
  })
})

describe('reg.list', () => {
  it('reports path, server title, createdAt and the session count', async () => {
    const sessions: FakeSession[] = [
      { id: 's1', cwd: '/home/u/proj', createdAt: 1, events: [{ type: 'turn/start', time: 10 }] },
      { id: 's2', cwd: '/home/u/proj', createdAt: 2, events: [{ type: 'turn/start', time: 30 }] },
      { id: 's3', cwd: '/home/u/other', createdAt: 3, events: [] },
    ]
    const { store: subject } = store({ sessions, records: [{ id: 'r1', path: '/home/u/proj', title: 'proj', createdAt: '2026-01-01T00:00:00.000Z' }] })
    const listed = await subject.listWorkspaces()
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ path: '/home/u/proj', title: 'proj', createdAt: '2026-01-01T00:00:00.000Z', sessionCount: 2 })
    // The id is derived from serverId + path, never taken from the registry.
    expect(listed[0]?.id).toBe(subject.workspaceId('/home/u/proj'))
    // Activity is opt-in; the cheap list never opens a log.
    expect('updatedAt' in (listed[0] ?? {})).toBe(false)
  })

  it('folds updatedAt only when asked, memoized by artifact size', async () => {
    const sessions: FakeSession[] = [
      { id: 's1', cwd: '/home/u/proj', createdAt: 1, events: [{ type: 'turn/start', time: 10 }] },
      { id: 's2', cwd: '/home/u/proj', createdAt: 2, events: [{ type: 'turn/start', time: 30 }] },
    ]
    const { store: subject, reads } = store({ sessions, records: [{ path: '/home/u/proj', title: 'proj' }] })
    const [withActivity] = await subject.listWorkspaces(true)
    expect(withActivity?.updatedAt).toBe(new Date(30).toISOString())
    const firstReads = reads()
    await subject.listWorkspaces(true)
    // Second pass: the logs did not change size, so nothing is re-read.
    expect(reads()).toBe(firstReads)
  })
})

describe('reg.rename', () => {
  it('changes only the title, keeping id and path stable', async () => {
    const { store: subject } = store({ sessions: [], records: [{ id: 'r1', path: '/home/u/proj', title: 'proj' }] })
    const id = subject.workspaceId('/home/u/proj')
    await expect(subject.renameWorkspace(id, '后端服务')).resolves.toEqual({ id, title: '后端服务' })
    const [listed] = await subject.listWorkspaces()
    expect(listed).toMatchObject({ id, path: '/home/u/proj', title: '后端服务' })
  })

  it('refuses an invalid id, an empty title and an unknown workspace', async () => {
    const { store: subject } = store({ sessions: [], records: [{ path: '/home/u/proj', title: 'proj' }] })
    const id = subject.workspaceId('/home/u/proj')
    await expect(subject.renameWorkspace('NOT-HEX' as never, 'x')).rejects.toThrow('invalid-workspace-id "NOT-HEX"')
    await expect(subject.renameWorkspace(id, '   ')).rejects.toThrow('invalid-title')
    await expect(subject.renameWorkspace('0123456789abcdef' as never, 'x')).rejects.toThrow('unknown remote workspace "0123456789abcdef"')
  })

  it('persists the title override and a deletion across a restart', async () => {
    const first = store({ sessions: [], records: [{ path: '/home/u/proj', title: 'proj' }] })
    await first.store.renameWorkspace(first.store.workspaceId('/home/u/proj'), 'renamed')
    await first.store.removeWorkspace(first.store.workspaceId('/home/u/proj'), true)
    // The index file is the durable part: a new store must agree.
    const { store: second } = store({ sessions: [], records: [{ path: '/home/u/proj', title: 'proj' }] })
    expect(await second.listWorkspaces()).toEqual([])
    const document = JSON.parse(await readFile(indexPath, 'utf8')) as { version: number; deleted: Record<string, unknown> }
    expect(document.version).toBe(1)
    expect(Object.keys(document.deleted)).toHaveLength(1)
  })

  it('still loads a legacy array-shaped index', async () => {
    await writeFile(indexPath, `${JSON.stringify([{ path: '/home/u/legacy', title: 'legacy' }])}\n`)
    const persistence = fakePersistence([])
    const ctx = { get: (name: string) => (name === 'sessionPersistence' ? persistence.service : undefined) } as unknown as Context
    const subject = new RemoteSessionStore(ctx, 'server-1', 'install-1', indexPath)
    const listed = await subject.listWorkspaces()
    expect(listed.map(entry => entry.path)).toEqual(['/home/u/legacy'])
  })
})

describe('reg.delete', () => {
  const records = [{ id: 'r1', path: '/home/u/proj', title: 'proj' }]
  const sessions: FakeSession[] = [
    { id: 's1', cwd: '/home/u/proj', createdAt: 1, events: [{ type: 'turn/start', time: 10 }] },
    { id: 's2', cwd: '/home/u/proj', createdAt: 2, events: [{ type: 'turn/start', time: 20 }] },
  ]

  it('refuses a non-empty workspace without force, counting its sessions', async () => {
    const { store: subject } = store({ sessions: [...sessions], records: [...records] })
    await expect(subject.removeWorkspace(subject.workspaceId('/home/u/proj'))).rejects.toThrow('workspace-not-empty 2')
    expect(await subject.listWorkspaces()).toHaveLength(1)
  })

  it('force removes the entry only: sessions survive and come back on re-register', async () => {
    const live = [...sessions]
    const { store: subject, deleted } = store({ sessions: live, records: [...records] })
    const id = subject.workspaceId('/home/u/proj')
    await expect(subject.removeWorkspace(id, true)).resolves.toEqual({ removed: true, sessionCount: 2 })
    expect(await subject.listWorkspaces()).toEqual([])
    // The registry's own entry was dropped (best effort, by ITS id).
    expect(deleted).toEqual(['r1'])
    // Session data untouched: the fake persistence still holds both logs.
    expect(live).toHaveLength(2)
    // Re-registering the same path restores the count — the proof that the
    // delete never removed logs (A35).
    await subject.createWorkspace('/home/u/proj')
    const [restored] = await subject.listWorkspaces()
    expect(restored).toMatchObject({ path: '/home/u/proj', sessionCount: 2 })
  })

  it('is idempotent and treats an unknown id as already gone', async () => {
    const { store: subject } = store({ sessions: [], records: [] })
    await expect(subject.removeWorkspace('0123456789abcdef' as never)).resolves.toEqual({ removed: false, sessionCount: 0 })
    const withEntry = store({ sessions: [], records: [{ id: 'r1', path: '/home/u/proj', title: 'proj' }] })
    const id = withEntry.store.workspaceId('/home/u/proj')
    await withEntry.store.removeWorkspace(id, true)
    await expect(withEntry.store.removeWorkspace(id, true)).resolves.toEqual({ removed: false, sessionCount: 0 })
  })

  it('refuses an invalid id', async () => {
    const { store: subject } = store({ sessions: [], records: [] })
    await expect(subject.removeWorkspace('../etc' as never, true)).rejects.toThrow('invalid-workspace-id "../etc"')
  })

  it('does not call a registry delete when the record carries no registry id', async () => {
    const { store: subject, deleted } = store({ sessions: [], records: [{ path: '/home/u/proj', title: 'proj' }] })
    await subject.removeWorkspace(subject.workspaceId('/home/u/proj'), true)
    expect(deleted).toEqual([])
  })
})
