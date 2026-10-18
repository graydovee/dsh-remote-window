/**
 * Two server processes, one `workspaces.json`: the workspace list must converge.
 *
 * Real deployments have exactly this shape — each client connection runs its own
 * remote `dsh` process, both reading `~/.dsh/remote-server/workspaces.json`. When
 * the index was loaded once at startup, a delete or rename made through one
 * connection stayed invisible to the other until it was reconnected (alpha60).
 *
 * The tests below open **two** `RemoteSessionStore` instances over one temp file
 * and assert the four convergence properties plus the read-modify-write guarantee
 * that keeps two writers from dropping each other's entries.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { RemoteSessionStore } from '../src/server/session-store.ts'
import type { WorkspaceId } from '../src/protocol.ts'

/** A persistence stub with no sessions: these tests are about the workspace index. */
function emptyPersistence(): Record<string, unknown> {
  return {
    list: async () => [],
    create: async () => { throw new Error('unused') },
    open: async () => { throw new Error('unused') },
  }
}

let dir = ''
let indexPath = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-index-'))
  indexPath = join(dir, 'workspaces.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

/**
 * One server process: no `workspaceRegistry`, so the index file is the registry.
 *
 * Both instances share the **server id**, exactly like production (it comes from
 * the installation's identity file): workspace ids are `sha256(serverId + path)`,
 * so different ids would make the overlay/tombstones of one process meaningless
 * to the other. What differs here is only the in-memory cache.
 */
function server(_label: string): RemoteSessionStore {
  const ctx = { get: (name: string) => (name === 'sessionPersistence' ? emptyPersistence() : undefined) } as unknown as Context
  return new RemoteSessionStore(ctx, 'server-shared', 'install-shared', indexPath)
}

/** Paths currently listed, sorted, for order-independent assertions. */
async function paths(store: RemoteSessionStore): Promise<string[]> {
  return (await store.listWorkspaces()).map(entry => entry.path).sort()
}

describe('cross-process workspace index', () => {
  it('a create in one process is visible to the other immediately', async () => {
    const a = server('a')
    const b = server('b')
    await a.createWorkspace('/home/u/one')
    await expect(paths(b)).resolves.toEqual(['/home/u/one'])
  })

  it('a rename in one process is visible to the other', async () => {
    const a = server('a')
    const b = server('b')
    const created = await a.createWorkspace('/home/u/one', 'one')
    await a.renameWorkspace(created.id, 'renamed')
    const [listed] = await b.listWorkspaces()
    expect(listed).toMatchObject({ path: '/home/u/one', title: 'renamed' })
  })

  it('a delete in one process removes it from the other', async () => {
    const a = server('a')
    const b = server('b')
    await a.createWorkspace('/home/u/one')
    await expect(paths(b)).resolves.toEqual(['/home/u/one'])
    const [listed] = await a.listWorkspaces()
    await a.removeWorkspace(listed?.id as WorkspaceId, true)
    await expect(paths(b)).resolves.toEqual([])
  })

  it('a second writer does not drop the first writer’s entry (read-modify-write)', async () => {
    const a = server('a')
    const b = server('b')
    await a.createWorkspace('/home/u/one')
    // B never saw the file before this call; it must re-read before writing.
    await b.createWorkspace('/home/u/two')
    await expect(paths(a)).resolves.toEqual(['/home/u/one', '/home/u/two'])
    await expect(paths(b)).resolves.toEqual(['/home/u/one', '/home/u/two'])
  })

  it('sees a file replaced wholesale by another process', async () => {
    const a = server('a')
    const b = server('b')
    await a.createWorkspace('/home/u/one')
    await expect(paths(b)).resolves.toEqual(['/home/u/one'])
    // A third "process" writes the document directly (newer mtime + different size).
    await writeFile(indexPath, `${JSON.stringify({
      version: 1,
      local: [{ path: '/home/u/external', title: 'external', createdAt: '2026-10-18T00:00:00.000Z' }],
      overlay: {},
      deleted: {},
    })}\n`)
    await expect(paths(b)).resolves.toEqual(['/home/u/external'])
  })

  it('still reads a legacy bare-array index', async () => {
    await writeFile(indexPath, `${JSON.stringify([{ path: '/home/u/legacy', title: 'legacy' }])}\n`)
    const b = server('b')
    await expect(paths(b)).resolves.toEqual(['/home/u/legacy'])
  })

  it('serializes concurrent writes inside one process (no lost entry)', async () => {
    const a = server('a')
    await Promise.all([a.createWorkspace('/home/u/p1'), a.createWorkspace('/home/u/p2'), a.createWorkspace('/home/u/p3')])
    await expect(paths(a)).resolves.toEqual(['/home/u/p1', '/home/u/p2', '/home/u/p3'])
  })

  it('writes the versioned document atomically (no temp files left behind)', async () => {
    const a = server('a')
    await a.createWorkspace('/home/u/one')
    const document = JSON.parse(await readFile(indexPath, 'utf8')) as { version: number; local: unknown[] }
    expect(document.version).toBe(1)
    expect(document.local).toHaveLength(1)
    const { readdir } = await import('node:fs/promises')
    const leftovers = (await readdir(dir)).filter(name => name.includes('.tmp-'))
    expect(leftovers).toEqual([])
  })
})
