/**
 * The row verbs for a remote session — wired to the **official client services**.
 *
 * The shell's own session rows call `ctx.uiWorkspace` (pin/unpin/archive/
 * unarchive/fork) and `ctx.sessions` (rename through a session reference). Those
 * services reach the host through the workspace/session controllers, which in
 * turn read and write sessions through `sessionPersistence` — and this plugin's
 * routing persistence is what makes a *remote* session reachable there. So the
 * verbs are not reimplemented: calling the same services is what makes a remote
 * session behave like a local one (pin ordering, archive set, fork lineage all
 * land in the official places).
 *
 * Failure surfaces as a notice: nothing else on the row moves, so a silent
 * failure would read as a dead action.
 */
import type { ClientContext } from './context.ts'
import type { RemoteWorkspace } from './api.ts'
import { t } from './locales.ts'
import { store } from './store.ts'

/** The slice of the official `uiWorkspace` client service we call. */
interface OfficialUiWorkspaceService {
  pinSession(sessionId: string): Promise<void>
  unpinSession(sessionId: string): Promise<void>
  archiveSession(sessionId: string, options?: { readonly stopActivity?: boolean }): Promise<void>
  unarchiveSession(sessionId: string): Promise<void>
  forkSession(sessionId: string, onCreated?: (childId: string) => void): Promise<string>
}

/** The official services, resolved lazily from the client context. */
let clientContext: ClientContext | undefined

/**
 * Bind the client context, as the store does, so the verbs can resolve the
 * official services without prop drilling.
 * @param ctx - the client context.
 */
export function bindVerbContext(ctx: ClientContext): void {
  clientContext = ctx
}

function uiWorkspace(): OfficialUiWorkspaceService | undefined {
  return clientContext?.get('uiWorkspace') as OfficialUiWorkspaceService | undefined
}

/**
 * One workspace's pin/archive membership, as the rows consume it.
 *
 * Sourced from the plugin's own workspace record rather than the shell's sets —
 * see {@link setPin} for why the shell's cannot hold a remote session.
 */
export interface SessionFlags {
  readonly pinned: ReadonlySet<string>
  readonly archived: ReadonlySet<string>
}

/** No flags: a workspace whose record carries neither set. */
const EMPTY_FLAGS: SessionFlags = { pinned: new Set(), archived: new Set() }

/**
 * Build one workspace's flag sets from its record.
 * @param workspace - the workspace record, or undefined.
 * @returns the pinned and archived sets.
 */
export function workspaceFlags(workspace: RemoteWorkspace | undefined): SessionFlags {
  if (workspace === undefined) return EMPTY_FLAGS
  return {
    pinned: new Set(workspace.pinnedSessions ?? []),
    archived: new Set(workspace.archivedSessions ?? []),
  }
}

/** Report one verb failure without moving any other surface. */
function report(action: string, reason: unknown): void {
  const message = reason instanceof Error ? reason.message : String(reason)
  store.notifyError(t('tree.verb.failed', { action, message }))
}

/**
 * Pin or unpin one session.
 *
 * NOT the shell's `uiWorkspace.pinSession`: that resolves the id against the
 * shell's *local* session index, where a remote session never appears, and
 * answers `session/not-found` (measured). The plugin owns the set for its own
 * sessions instead — the row's pinned look, ordering and the menu labels all
 * read from it, so the behaviour is the shell's even though the storage is not.
 * @param workspace - the workspace the session belongs to.
 * @param sessionId - the stored remote session id.
 * @param pinned - the state to apply.
 * @param action - the verb label, for the failure notice.
 */
async function setPin(workspace: RemoteWorkspace, sessionId: string, pinned: boolean, action: string): Promise<void> {
  try {
    await store.setSessionFlag(workspace, sessionId, 'pinned', pinned)
  } catch (error) {
    report(action, error)
  }
}

/** Archive or unarchive one session (plugin-owned set, see {@link setPin}). */
async function setArchived(workspace: RemoteWorkspace, sessionId: string, archived: boolean, action: string): Promise<void> {
  try {
    await store.setSessionFlag(workspace, sessionId, 'archived', archived)
  } catch (error) {
    report(action, error)
  }
}

/** Fork one session, then open the child it produced. */
async function forkSession(workspace: RemoteWorkspace, sessionId: string, action: string): Promise<void> {
  const service = uiWorkspace()
  if (service === undefined) return
  try {
    const childId = await service.forkSession(sessionId)
    store.notifySuccess(t('tree.session.forked'))
    // The child is a new *remote* session: it exists on the server the moment
    // the fork resolves, but this plugin's list is its own, so it has to be
    // re-read (the shell's list updates itself; ours does not).
    await store.refreshSessions(workspace)
    store.revealSessionId(childId)
  } catch (error) {
    report(action, error)
  }
}

/** The verbs, as the tree consumes them. */
export const sessionVerbs = { setPin, setArchived, forkSession } as const
