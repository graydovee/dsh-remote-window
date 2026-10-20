/**
 * The remote tree — rendered with the **official** workspace row components.
 *
 * The rows are not drawn here: `ProjectRowItem` (a group/workspace row) and
 * `SessionNodeItem` (a session row) are vendored verbatim from the shell's
 * `ui-workspace` client into `./vendor/workspace-rows`, together with their
 * stylesheet and the `workspace` locale dictionaries. So a remote workspace and
 * a remote session look and behave exactly like the shell's own — 34px/32px
 * rows, hover swaps (folder → chevron, time → row actions), title marquee,
 * hover cards, the `⋮` menu, selected/hover backgrounds — with no row styling
 * of our own.
 *
 * What this file owns is the walk, because our hierarchy has one level the
 * shell's does not: connection → workspace → session. No level is indented —
 * the shell's own tree is flat (see {@link Level}), so ours is too.
 *
 * Row verbs are the official ones with our meanings (the menu is fixed to a
 * rename/delete pair plus the `+` button, so the *labels* are what change):
 *
 *   connection  ＋ 添加工作区   ⋮ 连接/断开 · 删除连接
 *   workspace   ＋ 新会话       ⋮ 重命名工作区 · 移除工作区
 *   session     (click the row)  ⋮ 置顶/重命名/分叉/归档
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { IconWarningTriangleOutlineRegular, MenuItemButton, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PublicTarget, RemoteSession } from './api.ts'
import { t } from './locales.ts'
import { store, targetNodeKey, useAppState, workspaceNodeKey } from './store.ts'
import type { AppState } from './store.ts'
import { serverListState } from './workspace-join.ts'
import type { WorkspaceRow as WorkspaceRowModel } from './workspace-join.ts'
import { AddWorkspaceDialog } from './list.tsx'
import { ConfirmDialog } from './confirm-dialog.tsx'
import { RenameSessionDialog } from './rename-dialog.tsx'
import { WorkspaceRenameDialog } from './workspace-rename-dialog.tsx'
import { SessionMenu, SessionRowActions } from './session-row-parts.tsx'
import { workspaceFlags } from './session-verbs.ts'
import type { SessionFlags } from './session-verbs.ts'
import {
  ProjectRowItem, SessionNodeItem, rowRenderSlots, rowsTranslate,
} from './vendor/workspace-rows/index.ts'
import type { GroupNode, SessionNode } from './vendor/workspace-rows/index.ts'

/** Relabel one official row verb for a specific row. */
type VerbTranslate = (key: string, params?: Record<string, unknown>) => string

/** Tick the clock so relative row times stay honest while the panel is open. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Date.now()) }, 60_000)
    return () => { window.clearInterval(timer) }
  }, [])
  return now
}

/**
 * One level's wrapper.
 *
 * **No indent anywhere.** The shell's own tree is flat: a workspace row and the
 * session rows under it both carry the official row CSS's base inset
 * (`padding-inline-start: calc(8px + var(--dsh-workspace-indent, 0px))`) with
 * `--dsh-workspace-indent: 0px` on every group section — measured on the deployed
 * shell: workspace row padding 8px, session row padding 8px, first child at x=20
 * for both. So this plugin sets no indent either, and its three levels line up
 * exactly like the shell's rows (the connection row reads as the header above
 * the workspace rows).
 */
function Level(props: {
  state?: string
  className?: string
  /** A live connect attempt or its failure, so CSS can place the row's status. */
  connect?: 'connecting' | 'failed' | undefined
  children: ReactNode
}): ReactElement {
  return (
    <div className={props.className} data-state={props.state} data-connect={props.connect}>
      {props.children}
    </div>
  )
}

/**
 * The row's own statement about a connect attempt.
 *
 * It sits immediately **left of the 连接 seat** (the row's last action button),
 * which is the only place a disconnected row shows: a spinner while the attempt
 * runs, and a warning glyph whose tooltip is the reason once it failed. The
 * global error line at the bottom of the section is still written, but it is not
 * where the user's attention is after clicking a row.
 * @param props.connecting - an attempt for this target is in flight.
 * @param props.error - why the last attempt failed, if it did.
 * @returns the status element, or null when there is nothing to say.
 */
function ConnectStatus(props: {
  connecting: boolean
  error?: { message: string } | undefined
}): ReactElement | null {
  if (props.connecting) {
    return (
      <span className="dsh-rw-conn-status" data-kind="connecting" role="status" aria-live="polite">
        <span className="dsh-rw-conn-spinner" aria-hidden="true" />
        <span className="dsh-rw-visually-hidden">{t('tree.conn.connecting')}</span>
      </span>
    )
  }
  if (props.error === undefined) return null
  const reason = t('tree.conn.failedReason', { message: props.error.message })
  return (
    <span className="dsh-rw-conn-status" data-kind="failed">
      <Tooltip label={reason} side="bottom" align="end" delayMs={100}>
        <span
          className="dsh-rw-conn-warning"
          role="img"
          // Screen readers and automation get the reason without hovering.
          aria-label={reason}
          title={reason}
        >
          <IconWarningTriangleOutlineRegular size={14} />
        </span>
      </Tooltip>
    </span>
  )
}

/** The shell's row verb for one connection, relabelled to what we actually do. */
function connectionTranslate(target: PublicTarget, connecting: boolean): VerbTranslate {
  const connected = target.status === 'ready'
  const connectLabel = connecting ? t('tree.conn.connecting') : t('tree.conn.connect')
  return (key, params) => {
    if (key === 'rename') return connected ? t('tree.conn.disconnect') : connectLabel
    if (key === 'delete.workspace') return t('tree.forgetConnection')
    // The `+` slot is the only row action a connection has besides its menu: when
    // the connection is down it is the 连接 button (a disconnected host cannot add
    // a workspace anyway), and when it is up it adds one.
    if (key === 'actions.newSession' || key === 'actions.newSession.aria') {
      return connected ? t('tree.conn.addWorkspace') : connectLabel
    }
    return rowsTranslate(key, params)
  }
}

/** Row verbs for a remote workspace. */
function workspaceTranslate(workspace: WorkspaceRowModel): VerbTranslate {
  return (key, params) => {
    // The official menu has exactly two fixed slots (`rename` / `delete`), so
    // 重命名工作区 takes the first one and 刷新会话列表 is gone (architecture A8:
    // the list refreshes on expand and after every verb anyway).
    if (key === 'rename') return t('tree.workspace.rename')
    if (key === 'delete.workspace') return t('tree.workspace.forget')
    if (key === 'actions.newSession' || key === 'actions.newSession.aria') return t('tree.workspace.newSession')
    if (key === 'actions.workspace.aria') return t('tree.workspace.aria', { name: workspace.title })
    return rowsTranslate(key, params)
  }
}

/** Row verbs for a remote session. */
function sessionTranslate(title: string): VerbTranslate {
  return (key, params) => {
    if (key === 'actions.session.aria') return t('tree.session.aria', { name: title })
    return rowsTranslate(key, params)
  }
}

/** One stored remote session as the official session row consumes it. */
function sessionNode(session: RemoteSession, flags: SessionFlags): SessionNode {
  return {
    id: session.id,
    title: session.title ?? '',
    blank: false,
    running: false,
    runningSubagentCount: 0,
    completed: false,
    // Pin/archive come from the shell's own sets (see `session-verbs.ts`), so
    // the row's indicator, grayed archived look and ordering are the official
    // presentation rather than a copy of it.
    pinned: flags.pinned.has(session.id),
    archived: flags.archived.has(session.id),
    // The row's time column: last activity, falling back to creation.
    updatedAt: session.updatedAt ?? session.createdAt ?? Date.now(),
  }
}

/**
 * The temporary 「新会话」 row: the draft the shell is showing right now.
 *
 * `blank: true` is the official presentation of a provisional row — the vendored
 * component prints the localized 新会话 title instead of `title`, hides the
 * timestamp and every row verb (nothing exists to rename, fork or archive before
 * the first message) and refuses to start a drag.
 *
 * `id` is the **real** draft session id rather than an empty placeholder, because
 * the row's selected look is `node.id === currentId`: with the shell's actual id
 * the row is highlighted exactly while that draft is the open conversation.
 * @param sessionId - the draft session id reported by the shell catalog.
 */
function draftSessionNode(sessionId: string): SessionNode {
  return {
    id: sessionId,
    // Blank rows never read this; kept honest in case the vendored title logic
    // changes to prefer a non-empty title.
    title: '',
    blank: true,
    running: false,
    runningSubagentCount: 0,
    completed: false,
    pinned: false,
    archived: false,
    updatedAt: Date.now(),
  }
}

/**
 * The row's seat: hover buttons and `⋮` menu entries.
 *
 * The leading slot stays empty on purpose. The official row uses it for *status*
 * dots (a running turn, a pending approval); this plugin does not observe a
 * remote session's status, and a dot meaning "this is the open one" is already
 * the row's selected background. An always-animating dot on every row read as a
 * stuck spinner (user report), so nothing is rendered there.
 *
 * @param workspace - the workspace the session belongs to.
 * @param session - the stored session.
 * @param flags - this workspace's pin/archive sets.
 * @returns the seat for `SessionNodeItem`.
 */
function sessionSeat(
  workspace: WorkspaceRowModel,
  session: RemoteSession,
  flags: SessionFlags,
): Parameters<typeof rowRenderSlots>[0] {
  const title = session.title ?? workspace.title
  const verbs = {
    workspace,
    session,
    title,
    pinned: flags.pinned.has(session.id),
    archived: flags.archived.has(session.id),
  }
  return {
    leading: null,
    menu: (close: () => void) => <SessionMenu key="menu" close={close} {...verbs} />,
    actions: <SessionRowActions key="actions" {...verbs} />,
  }
}

/**
 * Tree semantics for one vendored row.
 *
 * The vendored rows are plain `div`s whose activation lives in a JS click
 * handler, so a screen reader — and any browser automation — sees **no target at
 * all** for a connection or workspace row (measured: the a11y inventory of the
 * sidebar exposes only 刷新 / 新建连接). Wrapping the row in a `treeitem` with a
 * tab stop and Enter/Space forwarding makes the same action keyboard-reachable
 * without touching the vendored component or firing the click twice.
 */
function TreeRow(props: {
  label: string
  expanded?: boolean
  onActivate: () => void
  children: ReactElement
}): ReactElement {
  return (
    <div
      // `button`, not `treeitem`: a treeitem is focusable but is not offered as
      // an activation target to assistive tech or to automation bridges, which
      // is exactly why the rows were unreachable before.
      role="button"
      aria-label={props.label}
      {...(props.expanded === undefined ? {} : { 'aria-expanded': props.expanded })}
      tabIndex={0}
      className="dsh-rw-row-a11y"
      onKeyDown={(event: import('react').KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        props.onActivate()
      }}
    >
      {props.children}
    </div>
  )
}

/**
 * One workspace's session rows, with the **temporary draft row** on top.
 *
 * The draft row is the shell's answer to "which conversation is on screen", not a
 * list entry: it exists only while `state.currentDraft` names *this* workspace, it
 * is rendered before the list (never sorted, never counted, never a watermark
 * entry), and it disappears the moment the shell selects anything else or the
 * draft's first message makes it a real conversation.
 */
function SessionRows(props: { workspace: WorkspaceRowModel; now: number; flags: SessionFlags }): ReactElement | null {
  const state = useAppState()
  const list = state.sessions[props.workspace.id]
  const draft = state.currentDraft?.workspaceId === props.workspace.id ? state.currentDraft : undefined
  // The draft's own session is hidden from the conversation rows — it is standing
  // in for that row above. A host that predates the `draft` flag still reports the
  // draft's bytes, so filtering by id is what keeps it from rendering twice.
  const stored = (list?.items ?? []).filter(session => session.id !== draft?.sessionId)
  const items = orderSessions(stored, props.flags)
  return (
    <>
      {draft !== undefined && (
        <TreeRow
          label={t('tree.draft.openAria')}
          onActivate={() => { void store.startDraftSession(props.workspace) }}
        >
          <SessionNodeItem
            node={draftSessionNode(draft.sessionId)}
            // Highlighting follows the draft: the vendored row marks itself
            // selected when its id is the current one.
            currentId={draft.sessionId}
            now={props.now}
            onOpen={() => { void store.startDraftSession(props.workspace) }}
            onRenameRequest={() => {}}
            renderSlot={rowRenderSlots({ leading: null, menu: null, actions: null })}
            t={sessionTranslate(props.workspace.title)}
          />
        </TreeRow>
      )}
      {items.map(session => (
        <SessionNodeItem
          key={session.id}
          node={sessionNode(session, props.flags)}
          currentId={state.currentSessionId}
          now={props.now}
          onOpen={(id) => {
            const found = items.find(candidate => candidate.id === id)
            // An archived session is not openable (the official row marks that
            // with `aria-description`); the click is a no-op with a notice.
            if (found === undefined) return
            if (props.flags.archived.has(found.id)) {
              store.notifyError(t('tree.session.archivedNotOpenable'))
              return
            }
            void store.openSession(props.workspace, found)
          }}
          onRenameRequest={() => {}}
          renderSlot={rowRenderSlots(sessionSeat(props.workspace, session, props.flags))}
          t={sessionTranslate(session.title ?? props.workspace.title)}
        />
      ))}
      {list !== undefined && list.error !== undefined && (
        <p className="dsh-rw-side-error">{t('tree.sessions.failed', { message: list.error.message })}</p>
      )}
      {list !== undefined && list.loading && items.length === 0 && (
        <p className="dsh-rw-tree-empty">{t('tree.sessions.loading')}</p>
      )}
      {/* No draft and nothing stored: say so instead of leaving the workspace
          silently empty (the always-present blank row used to fill this spot). */}
      {list !== undefined && list.loaded && !list.loading && list.error === undefined
        && items.length === 0 && draft === undefined && (
        <p className="dsh-rw-tree-empty">{t('tree.sessions.empty')}</p>
      )}
    </>
  )
}

/** One remote workspace row plus its session rows. */
function WorkspaceRow(props: { workspace: WorkspaceRowModel; target: PublicTarget; now: number }): ReactElement | null {
  const state = useAppState()
  const { workspace } = props
  const key = workspaceNodeKey(workspace.id)
  const expanded = state.expanded[key] ?? false
  const list = state.sessions[workspace.id]
  const connected = props.target.status === 'ready'
  const flags = workspaceFlags(workspace)
  const translate = useMemo(() => workspaceTranslate(workspace), [workspace.title])
  const group: GroupNode = {
    key: workspace.id,
    workspaceId: workspace.remoteWorkspaceId,
    cwd: workspace.path,
    // A v2 server omits `createdAt`; the hover card then shows no date rather
    // than `Invalid Date` (contract §14.1: never drop the row over a missing
    // field).
    createdAt: workspace.createdAt === undefined ? undefined : Date.parse(workspace.createdAt),
    label: workspace.title,
    // The server's count is the truth until this device has loaded the list —
    // and once it has, the count is the *stored* conversations it can show
    // (drafts have no log yet, so the server count can be one higher).
    sessionCount: list === undefined ? workspace.sessionCount ?? 0 : visibleSessions(list.items).length,
    expanded,
    containsCurrent: state.currentSessionId !== undefined && workspace.sessionId === state.currentSessionId,
    sessions: [],
  }
  return (
    <>
      <TreeRow label={props.workspace.title} expanded={expanded} onActivate={() => { store.toggleNode(key) }}>
      <ProjectRowItem
        group={group}
        onToggle={() => { store.toggleNode(key) }}
        onCreate={() => { void store.startDraftSession(workspace) }}
        actions={{
          rename: () => { store.requestWorkspaceRename(workspace) },
          delete: () => { store.requestDeleteWorkspace(workspace) },
        }}
        // A disconnected connection cannot start sessions; the row still
        // renders, with the plain dictionary labels.
        t={connected ? translate : ((verb: string, params?: Record<string, unknown>) => rowsTranslate(verb, params))}
      />
      </TreeRow>
      {expanded && <SessionRows workspace={workspace} now={props.now} flags={flags} />}
    </>
  )
}

/** One connection row (the level the shell's own tree does not have) plus its workspaces. */
function ConnectionRow(props: { target: PublicTarget; workspaces: WorkspaceRowModel[]; now: number }): ReactElement | null {
  const state = useAppState()
  const { target } = props
  const key = targetNodeKey(target.id)
  const expanded = state.expanded[key] ?? false
  const connected = target.status === 'ready'
  const feedback = state.connectFeedback[target.id]
  const connecting = feedback?.connecting === true
  const translate = useMemo(() => connectionTranslate(target, connecting), [target.status, connecting])
  const sessionCount = props.workspaces.reduce(
    (total, workspace) => total + (state.sessions[workspace.id]?.items.length ?? 0),
    0,
  )
  const lastConnectedAt = Date.parse(target.lastConnectedAt ?? '')
  const group: GroupNode = {
    // The official row keys itself `workspace:<key>`; the key identifies this
    // node rather than a local workspace, which is fine — it is only identity,
    // and it keeps the row's own DOM contract intact.
    key: `conn:${target.id}`,
    // NOT `undefined`: the vendored row reads that as the ungrouped bucket and
    // replaces the label with 未分组. Any string keeps our own label and the
    // hover card's workspace lines.
    workspaceId: `conn:${target.id}`,
    // A WSL target has no user@host:port to show, only its distribution.
    cwd: target.kind === 'wsl'
      ? t('list.endpoint.wsl', { distro: target.wslDistro ?? target.host })
      : t('list.endpoint', { username: target.username, host: target.host, port: target.port }),
    createdAt: Number.isNaN(lastConnectedAt) ? undefined : lastConnectedAt,
    label: target.label,
    sessionCount,
    expanded,
    containsCurrent: false,
    sessions: [],
  }
  return (
    <>
      <Level
        state={target.status}
        className="dsh-rw-conn"
        connect={connecting ? 'connecting' : feedback?.error === undefined ? undefined : 'failed'}
      >
        <ConnectStatus connecting={connecting} error={feedback?.error} />
        <TreeRow
          label={target.label}
          expanded={connected && expanded}
          onActivate={() => {
            if (connected) store.toggleNode(key)
            else void store.connectTarget(target)
          }}
        >
        <ProjectRowItem
          // Keyed by state: switching between connected/disconnected remounts the
          // row, which resets its (vendored, internal) menu to closed. A menu that
          // outlives the action it performed is the defect this prevents.
          key={`conn:${target.status}`}
          group={group}
          // Clicking a disconnected connection connects it; a live one folds,
          // exactly like the shell's workspace rows fold.
          onToggle={() => {
            if (connected) store.toggleNode(key)
            else void store.connectTarget(target)
          }}
          onCreate={() => { void (connected ? store.openAddWorkspace(target) : store.connectTarget(target)) }}
          actions={{
            rename: () => { void (connected ? store.stopTarget(target) : store.connectTarget(target)) },
            delete: () => { store.requestForgetTarget(target) },
          }}
          t={translate}
        />
        </TreeRow>
      </Level>
      {/* Children exist only through the channel: a connection that is down shows
          nothing under it, whatever the expanded flag says (the store clears the
          flag too, this is the render-side guarantee). */}
      {connected && expanded && (
        <>
          {props.workspaces.length === 0
            ? (
              // "The server has no workspace" and "the list could not be read"
              // are different facts (a missing `serverWorkspaces` key is not an
              // empty array), so they read differently.
              <p className="dsh-rw-tree-empty">
                {serverListState(state.serverWorkspaces, target.id) === 'unavailable'
                  ? t('tree.conn.noWorkspace.unavailable')
                  : t('tree.conn.noWorkspace')}
              </p>
            )
            : props.workspaces.map(workspace => (
              <WorkspaceRow key={workspace.id} workspace={workspace} target={target} now={props.now} />
            ))}
        </>
      )}
    </>
  )
}

/**
 * The whole remote tree.
 * @param props.empty - text shown when no connection is saved yet.
 * @param props.compact - sidebar presentation flag (kept for the panel copy).
 */
export function RemoteTree(props: { compact: boolean; empty?: string }): ReactElement | null {
  const state = useAppState()
  const now = useNow()
  if (state.targets.length === 0) {
    return <p className="dsh-rw-tree-empty">{props.empty ?? t('tree.empty')}</p>
  }
  return (
    <>
    {/* Dialogs belong to the tree, not to one surface: the sidebar section is the
        primary one, and a picker rendered only by the panel opened nothing when the
        user clicked 添加工作区 there. */}
    <AddWorkspaceDialog />
    <ConfirmDialog />
    <RenameSessionDialog />
    <WorkspaceRenameDialog />
    <div
      className={props.compact ? 'dsh-rw-tree dsh-rw-tree--compact' : 'dsh-rw-tree'}
      role="tree"
      aria-label={t('tree.sidebar.title')}
    >
      {state.targets.map(target => (
        <ConnectionRow
          key={target.id}
          target={target}
          workspaces={state.workspaces.filter(workspace => workspace.targetId === target.id)}
          now={now}
        />
      ))}
    </div>
    </>
  )
}

/**
 * Whether one listed remote session is a **stored conversation** rather than a
 * draft.
 *
 * Official semantics, measured in the shipped shell: a blank session is one whose
 * log carries no `turn/start`. `new session` does create and persist the shell
 * session immediately (a few hundred bytes of session/permission/sandbox headers),
 * and the plugin's draft path keeps that log — the draft is *reusable*, the next
 * 新会话 reopens the same blank — but it is still not a conversation. So the log's
 * size alone cannot decide this any more; the host answers it directly with
 * `draft` (it opens the log and looks for `turn/start`), and that flag is what the
 * row list honours.
 *
 * The size check stays as the fallback for a host that predates the flag: a
 * session with no bytes at all has no log yet, so it cannot be a row either.
 * Either way the *currently open* draft is filtered by id in `SessionRows`, so it
 * can never appear twice even on an older host.
 *
 * A stored log with no title stays: that is a real conversation whose title was
 * never written (pre-0.1.0 logs, another device mid-write), and the row already
 * renders the localized 未命名 placeholder for it.
 * @param session - one `/api/sessions` entry.
 * @returns true when the session is a conversation the tree may list.
 */
function isStoredSession(session: RemoteSession): boolean {
  if (session.draft === true) return false
  return session.sizeBytes !== undefined && session.sizeBytes > 0
}

/** The sessions a workspace's tree may show: stored conversations only. */
function visibleSessions(items: readonly RemoteSession[]): RemoteSession[] {
  return items.filter(isStoredSession)
}

/**
 * Order one workspace's sessions the way the shell orders its own: pinned rows
 * lead (in the shell's pin order), then most recent activity, with archived
 * rows last — and pinned/archived membership comes from the official sets.
 *
 * Drafts are dropped first ({@link isStoredSession}): they are not rows yet.
 * @param items - the stored sessions.
 * @param flags - the official pin/archive sets.
 * @returns the row order.
 */
function orderSessions(items: readonly RemoteSession[], flags: SessionFlags): RemoteSession[] {
  const rank = (session: RemoteSession): number => {
    if (flags.pinned.has(session.id)) return 0
    return flags.archived.has(session.id) ? 2 : 1
  }
  return visibleSessions(items).sort((left, right) => {
    const byRank = rank(left) - rank(right)
    if (byRank !== 0) return byRank
    return (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0)
  })
}
