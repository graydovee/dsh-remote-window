/**
 * Plugin-private local anchor for a server session shown in **local mode**.
 *
 * The client's official session/agent layer needs an absolute local `cwd`:
 * it `stat`s/realpaths it, and the shell attaches sessions by their recorded
 * path. The server's real path is not usable there (it does not exist on this
 * machine), so local mode binds the session to an anchor directory.
 *
 * Requirement D3/§4.2.7: the anchor is **not** a workspace. It must never be
 * registered in the official workspace registry (the shared
 * `~/.dsh/storages/workspace.json`), must not appear in the client's local
 * workspace list, and must be removed when the plugin/connection goes away.
 *
 * Layout (architecture §9, protocol §5.4):
 *
 * ```
 * $DSH_HOME/remote-workspaces/<clientId>/<targetId>/<hash(workspaceId)>
 * ```
 *
 * The legacy visible-stub root (`$DSH_HOME/remote-workspaces/<targetId>/…`,
 * `src/session/remote-guard.ts`) is intentionally a different, shallower shape; the
 * legacy guard and its stubs are retired separately (architecture §12), and
 * nothing here registers a shell row for the anchor.
 */
import { createHash } from 'node:crypto'
import { mkdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'

/** Inputs shared by every anchor path helper. */
export interface AnchorOptions {
  /** Stable client identity; used as the first private path segment. */
  readonly clientId: string
  /** Environment used to resolve `DSH_HOME`; injectable for tests. */
  readonly env?: Record<string, string | undefined>
}

/** Legal segment characters; everything else is replaced to keep one path segment. */
function segment(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new Error(`${label} must not be empty`)
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]/g, '-')
  if (safe === '.' || safe === '..' || safe.startsWith('.')) throw new Error(`${label} is not a usable path segment: "${value}"`)
  return safe
}

/** The harness home the session/anchor data lives under. */
export function anchorDshHome(env: Record<string, string | undefined> = process.env): string {
  const configured = env['DSH_HOME']?.trim()
  return configured !== undefined && configured !== '' ? configured : join(homedir(), '.dsh')
}

/**
 * Private anchor root for one client.
 * @param options - client identity and environment.
 * @returns `<DSH_HOME>/remote-workspaces/<clientId>`.
 */
export function anchorRoot(options: AnchorOptions): string {
  const env = options.env ?? process.env
  return join(anchorDshHome(env), 'remote-workspaces', segment(options.clientId, 'clientId'))
}

/** Stable 16-hex directory name for one server workspace. */
export function anchorHash(workspaceId: string): string {
  const trimmed = workspaceId.trim()
  if (trimmed === '') throw new Error('workspaceId must not be empty')
  return createHash('sha256').update(trimmed).digest('hex').slice(0, 16)
}

/**
 * Where one server workspace's local anchor lives.
 * @param options - client identity and environment.
 * @param targetId - stored target id (connection identity, client-local).
 * @param workspaceId - server-authoritative workspace id.
 * @returns the absolute anchor directory (not created here).
 */
export function anchorPathFor(options: AnchorOptions, targetId: string, workspaceId: string): string {
  return join(anchorRoot(options), segment(targetId, 'targetId'), anchorHash(workspaceId))
}

/** Whether `path` is the root itself or a strict descendant of it. */
export function isUnderRoot(root: string, path: string): boolean {
  const rel = relative(root, path)
  if (rel === '') return true
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false
  return true
}

/**
 * Create one anchor directory (mode 0700) if needed.
 * @param root - the client's private anchor root.
 * @param path - anchor directory from {@link anchorPathFor}.
 * @returns the same path.
 * @throws when `path` escapes `root` (never create outside the private root).
 */
export async function ensureAnchor(root: string, path: string): Promise<string> {
  if (!isUnderRoot(root, path)) throw new Error(`refusing to create an anchor outside "${root}": "${path}"`)
  await mkdir(path, { recursive: true, mode: 0o700 })
  return path
}

/**
 * Remove one anchor directory. Missing paths are not an error (exit cleanup is
 * best-effort and idempotent).
 * @param root - the client's private anchor root.
 * @param path - anchor directory to remove.
 * @returns true when a directory was removed.
 */
export async function removeAnchor(root: string, path: string): Promise<boolean> {
  if (path === root) return false
  if (!isUnderRoot(root, path)) throw new Error(`refusing to remove an anchor outside "${root}": "${path}"`)
  const existed = await stat(path).then(() => true, () => false)
  if (!existed) return false
  return await rm(path, { recursive: true, force: true }).then(() => true, () => false)
}

/**
 * Remove every anchor of one target. Used on disconnect/delete and on plugin
 * disposal; the caller does not need to enumerate workspaces.
 * @param root - the client's private anchor root.
 * @param targetId - stored target id.
 * @returns true when the target directory was removed.
 */
export async function removeTargetAnchors(root: string, targetId: string): Promise<boolean> {
  const safe = segment(targetId, 'targetId')
  const path = join(root, safe)
  if (!isUnderRoot(root, path) || path === root) return false
  const existed = await stat(path).then(() => true, () => false)
  if (!existed) return false
  return await rm(path, { recursive: true, force: true }).then(() => true, () => false)
}

/** One anchor's identity: which target/workspace the local cwd stands for. */
export interface AnchorRoute {
  readonly targetId: string
  readonly workspaceId: string
  readonly path: string
}

/**
 * In-process map from a workspace's private anchor to its identity.
 *
 * The routing persistence resolves a session's route from `header.cwd`; in
 * local mode that cwd is the private anchor, which is not a workspace-registry
 * path. Every anchor this process creates must therefore be registrable here,
 * so `createRoutingPersistence`'s facade can answer `routeForCwd` /
 * `stubForWorkspace` without a second path algorithm.
 */
export class AnchorRegistry {
  private readonly byWorkspace = new Map<string, AnchorRoute>()
  private readonly byPath = new Map<string, AnchorRoute>()

  /** Record one anchor (last registration of the same workspace wins). */
  register(route: AnchorRoute): void {
    const previous = this.byWorkspace.get(route.workspaceId)
    if (previous !== undefined) this.byPath.delete(previous.path)
    this.byWorkspace.set(route.workspaceId, route)
    this.byPath.set(route.path, route)
  }

  /** Resolve a session cwd back to its target/workspace, if it is an anchor. */
  routeForCwd(cwd: string | undefined): AnchorRoute | undefined {
    if (cwd === undefined || cwd === '') return undefined
    return this.byPath.get(cwd)
  }

  /** The anchor path of one workspace, if materialized in this process. */
  pathFor(workspaceId: string): string | undefined {
    return this.byWorkspace.get(workspaceId)?.path
  }

  /** The server-real path is not stored here (the facade's P1 state owns it). */
  entries(): readonly AnchorRoute[] {
    return [...this.byWorkspace.values()]
  }

  /** Forget one workspace (disconnect/delete). */
  forget(workspaceId: string): void {
    const route = this.byWorkspace.get(workspaceId)
    if (route === undefined) return
    this.byWorkspace.delete(workspaceId)
    this.byPath.delete(route.path)
  }

  /** Forget every anchor of one target. */
  forgetTarget(targetId: string): readonly AnchorRoute[] {
    const removed = [...this.byWorkspace.values()].filter(route => route.targetId === targetId)
    for (const route of removed) this.forget(route.workspaceId)
    return removed
  }
}
