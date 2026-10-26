/**
 * Plugin-private local anchors for local-mode server sessions
 * (architecture §9, protocol §5.4).
 *
 * The anchor is the session's local `cwd` but must never look like a workspace:
 * it lives under the plugin's own `remote-workspaces/<clientId>/...` tree, is
 * created/removed only through these helpers, and a path outside the root can
 * never be created or removed (a malformed id must not widen the delete scope).
 */
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AnchorRegistry,
  anchorDshHome,
  anchorHash,
  anchorPathFor,
  anchorRoot,
  ensureAnchor,
  isUnderRoot,
  removeAnchor,
  removeTargetAnchors,
} from '../src/session/anchors.ts'

const roots: string[] = []

/** A private anchor root under a fresh temp DSH_HOME. */
async function tempRoot(clientId = 'client-abc123'): Promise<{ root: string; env: Record<string, string | undefined>; dshHome: string }> {
  const home = await mkdtemp(join(tmpdir(), 'rw-anchor-'))
  roots.push(home)
  const env = { DSH_HOME: home }
  return { root: anchorRoot({ clientId, env }), env, dshHome: home }
}

afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop() as string, { recursive: true, force: true })
})

describe('anchor root and path shape', () => {
  it('lives under DSH_HOME, not the real home directory', async () => {
    const { root, dshHome } = await tempRoot()
    expect(anchorDshHome({ DSH_HOME: dshHome })).toBe(dshHome)
    expect(root).toBe(join(dshHome, 'remote-workspaces', 'client-abc123'))
  })

  it('distinguishes the private anchor tree from the legacy visible stub root', async () => {
    const { root, dshHome } = await tempRoot()
    // The legacy stub root is $DSH_HOME/remote-workspaces/<targetId>; the v1
    // anchor adds the client id level, so an old stub can never be mistaken for
    // a private anchor by the retirement/cleanup code.
    const legacyStub = join(dshHome, 'remote-workspaces', 'target-1')
    expect(legacyStub.startsWith(root)).toBe(false)
    expect(root.split('/').at(-1)).toBe('client-abc123')
  })

  it('hashes a workspace id to a stable 16-hex directory and sanitizes ids', async () => {
    const { root, env } = await tempRoot()
    const path = anchorPathFor({ clientId: 'client-abc123', env }, 'target-1', 'workspace-abcdef12')
    expect(anchorHash('workspace-abcdef12')).toMatch(/^[0-9a-f]{16}$/)
    expect(anchorHash('workspace-abcdef12')).toBe(anchorHash('workspace-abcdef12'))
    expect(path.startsWith(root)).toBe(true)
    expect(path.split('/').at(-1)).toBe(anchorHash('workspace-abcdef12'))
    // A dotted id is not silently flattened into a traversal: it is rejected.
    expect(() => anchorPathFor({ clientId: 'client-abc123', env }, '../escape', 'workspace-1')).toThrow(/targetId/)
  })

  it('refuses empty or unusable client/target ids', () => {
    expect(() => anchorRoot({ clientId: '' })).toThrow(/clientId/)
    expect(() => anchorPathFor({ clientId: '.' }, 'target-1', 'workspace-1')).toThrow(/clientId/)
    expect(() => anchorPathFor({ clientId: 'c' }, '..', 'workspace-1')).toThrow(/targetId/)
    expect(() => anchorHash('')).toThrow(/workspaceId/)
  })

  it('falls back to ~/.dsh/sessions-like home only when DSH_HOME is blank', () => {
    const fallback = anchorDshHome({ DSH_HOME: '   ' })
    expect(fallback.endsWith(join('.dsh'))).toBe(true)
    expect(anchorDshHome({ DSH_HOME: '/custom/home' })).toBe('/custom/home')
  })
})

describe('ensure / remove guards', () => {
  it('creates the anchor directory and never escapes the root', async () => {
    const { root } = await tempRoot()
    const path = join(root, 'target-1', 'abc')
    await expect(ensureAnchor(root, path)).resolves.toBe(path)
    expect((await stat(path)).isDirectory()).toBe(true)

    await expect(ensureAnchor(root, join(root, '..', 'outside'))).rejects.toThrow(/outside/)
    await expect(ensureAnchor(root, '/tmp/outside-anchor')).rejects.toThrow(/outside/)
  })

  it('isUnderRoot accepts the root and descendants, rejects siblings', async () => {
    const { root } = await tempRoot()
    expect(isUnderRoot(root, root)).toBe(true)
    expect(isUnderRoot(root, join(root, 'a'))).toBe(true)
    expect(isUnderRoot(root, `${root}-evil`)).toBe(false)
    expect(isUnderRoot(root, join(root, '..', 'x'))).toBe(false)
  })

  it('removes one anchor idempotently and refuses the root / outside paths', async () => {
    const { root } = await tempRoot()
    const path = join(root, 'target-1', 'abc')
    await ensureAnchor(root, path)
    await writeFile(join(path, 'file.txt'), 'x')

    await expect(removeAnchor(root, path)).resolves.toBe(true)
    await expect(removeAnchor(root, path)).resolves.toBe(false)
    await expect(removeAnchor(root, root)).resolves.toBe(false)
    await expect(removeAnchor(root, join(root, '..', 'outside'))).rejects.toThrow(/outside/)
  })

  it('removes every anchor of one target only', async () => {
    const { root } = await tempRoot()
    const targetA = join(root, 'target-a')
    const targetB = join(root, 'target-b')
    await ensureAnchor(root, join(targetA, 'one'))
    await ensureAnchor(root, join(targetA, 'two'))
    await ensureAnchor(root, join(targetB, 'one'))

    await expect(removeTargetAnchors(root, 'target-a')).resolves.toBe(true)
    await expect(readdir(root)).resolves.toEqual(['target-b'])
    await expect(readdir(targetB)).resolves.toEqual(['one'])
    await expect(removeTargetAnchors(root, 'target-a')).resolves.toBe(false)
  })

  it('refuses a target id that would escape the root', async () => {
    const { root } = await tempRoot()
    await expect(removeTargetAnchors(root, '../..')).rejects.toThrow(/targetId/)
  })
})

describe('AnchorRegistry', () => {
  it('resolves an anchor cwd back to target/workspace and forgets by target', () => {
    const registry = new AnchorRegistry()
    registry.register({ targetId: 't1', workspaceId: 'w1', path: '/anchors/t1/w1' })
    registry.register({ targetId: 't1', workspaceId: 'w2', path: '/anchors/t1/w2' })
    registry.register({ targetId: 't2', workspaceId: 'w3', path: '/anchors/t2/w3' })
    expect(registry.routeForCwd('/anchors/t1/w2')).toEqual({ targetId: 't1', workspaceId: 'w2', path: '/anchors/t1/w2' })
    expect(registry.routeForCwd('/not/an/anchor')).toBeUndefined()
    expect(registry.routeForCwd(undefined)).toBeUndefined()
    expect(registry.pathFor('w1')).toBe('/anchors/t1/w1')
    expect(registry.entries()).toHaveLength(3)
    expect(registry.forgetTarget('t1').map(entry => entry.workspaceId)).toEqual(['w1', 'w2'])
    expect(registry.routeForCwd('/anchors/t1/w1')).toBeUndefined()
    expect(registry.routeForCwd('/anchors/t2/w3')).toBeDefined()
    expect(registry.pathFor('w3')).toBe('/anchors/t2/w3')
  })

  it('replaces a re-materialized workspace instead of leaking the old path', () => {
    const registry = new AnchorRegistry()
    registry.register({ targetId: 't1', workspaceId: 'w1', path: '/old' })
    registry.register({ targetId: 't1', workspaceId: 'w1', path: '/new' })
    expect(registry.pathFor('w1')).toBe('/new')
    expect(registry.routeForCwd('/old')).toBeUndefined()
  })
})
