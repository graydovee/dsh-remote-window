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
 * shell's does not: connection → workspace → session. Each level nests one step
 * deeper through the official `--dsh-workspace-indent` custom property, which
 * the vendored CSS already reads.
 *
 * Row verbs are the official ones with our meanings (the menu is fixed to a
 * rename/delete pair plus the `+` button, so the *labels* are what change):
 *
 *   connection  ＋ 添加工作区   ⋮ 连接/断开 · 忘记连接
 *   workspace   ＋ 新会话       ⋮ 刷新会话列表 · 移除工作区
 *   session     (click the row)  ⋮ 复制会话 ID
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PublicTarget, RemoteSession, RemoteWorkspace } from './api.ts'
import { t } from './locales.ts'
import { store, targetNodeKey, useAppState, workspaceNodeKey } from './store.ts'
import type { AppState } from './store.ts'
import { RenameSessionDialog } from './rename-dialog.tsx'
import { SessionMenu, SessionRowActions } from './session-row-parts.tsx'
import { workspaceFlags } from './session-verbs.ts'
import type { SessionFlags } from './session-verbs.ts'
import {
  LIVE_DOT, ProjectRowItem, SessionNodeItem, rowRenderSlots, rowsTranslate,
} from './vendor/workspace-rows/index.ts'
import type { GroupNode, SessionNode } from './vendor/workspace-rows/index.ts'

/** One indent step for the extra hierarchy levels, in CSS pixels. */
const INDENT_STEP = 14

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

/** Wrap one level's rows and set that level's indent. */
function Level(props: { depth: number; state?: string; className?: string; children: ReactNode }): ReactElement {
  return (
    <div
      className={props.className}
      data-state={props.state}
      style={{ '--dsh-workspace-indent': `${props.depth * INDENT_STEP}px` } as Record<string, string>}
    >
      {props.children}
    </div>
  )
}

/** The shell's row verb for one connection, relabelled to what we actually do. */
function connectionTranslate(target: PublicTarget): VerbTranslate {
  const connected = target.status === 'ready'
  return (key, params) => {
    if (key === 'rename') return connected ? t('tree.conn.disconnect') : t('tree.conn.connect')
    if (key === 'delete.workspace') return t('tree.forgetConnection')
    if (key === 'actions.newSession' || key === 'actions.newSession.aria') return t('tree.conn.addWorkspace')
    return rowsTranslate(key, params)
  }
}

/** Row verbs for a remote workspace. */
function workspaceTranslate(workspace: RemoteWorkspace): VerbTranslate {
  return (key, params) => {
    if (key === 'rename') return t('tree.sessions.refresh')
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

/** The provisional New Session row: the official blank-session presentation. */
function blankSessionNode(): SessionNode {
  return {
    id: '',
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
 * The row's full seat: leading dot, hover buttons and `⋮` menu entries.
 * @param workspace - the workspace the session belongs to.
 * @param session - the stored session.
 * @param flags - the official pin/archive sets.
 * @param leading - the live dot, when this device has the session open.
 * @returns the seat for `SessionNodeItem`.
 */
function sessionSeat(
  workspace: RemoteWorkspace,
  session: RemoteSession,
  flags: SessionFlags,
  leading: ReactElement | null,
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
    leading,
    menu: <SessionMenu key="menu" {...verbs} />,
    actions: <SessionRowActions key="actions" {...verbs} />,
  }
}

/** The leading dot of a session row: only the session this device has open is live. */
function sessionLeading(workspace: RemoteWorkspace, state: AppState): ReactElement | null {
  return state.currentSessionId !== undefined && workspace.sessionId === state.currentSessionId ? LIVE_DOT : null
}

/** One session row plus the trailing New Session row of an expanded workspace. */
function SessionRows(props: { workspace: RemoteWorkspace; now: number; flags: SessionFlags }): ReactElement | null {
  const state = useAppState()
  const list = state.sessions[props.workspace.id]
  const items = orderSessions(list?.items ?? [], props.flags)
  return (
    <>
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
          renderSlot={rowRenderSlots(sessionSeat(props.workspace, session, props.flags, sessionLeading(props.workspace, state)))}
          t={sessionTranslate(session.title ?? props.workspace.title)}
        />
      ))}
      {list !== undefined && list.error !== undefined && (
        <p className="dsh-rw-side-error">{t('tree.sessions.failed', { message: list.error.message })}</p>
      )}
      {list !== undefined && list.loading && items.length === 0 && (
        <p className="dsh-rw-tree-empty">{t('tree.sessions.loading')}</p>
      )}
      {/* The blank session row is the official 新会话 affordance: clicking it
          starts a fresh remote session in this workspace. */}
      <SessionNodeItem
        node={blankSessionNode()}
        currentId={state.currentSessionId}
        now={props.now}
        onOpen={() => { void store.reopenWorkspace(props.workspace) }}
        onRenameRequest={() => {}}
        renderSlot={rowRenderSlots({ leading: null, menu: null, actions: null })}
        t={sessionTranslate(props.workspace.title)}
      />
    </>
  )
}

/** One remote workspace row plus its session rows. */
function WorkspaceRow(props: { workspace: RemoteWorkspace; target: PublicTarget; now: number }): ReactElement | null {
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
    workspaceId: workspace.remoteWorkspaceId ?? workspace.id,
    cwd: workspace.path,
    createdAt: Date.parse(workspace.createdAt),
    label: workspace.title,
    sessionCount: list?.items.length ?? 0,
    expanded,
    containsCurrent: state.currentSessionId !== undefined && workspace.sessionId === state.currentSessionId,
    sessions: [],
  }
  return (
    <>
      <ProjectRowItem
        group={group}
        onToggle={() => { store.toggleNode(key) }}
        onCreate={() => { void store.reopenWorkspace(workspace) }}
        actions={{
          rename: () => { void store.loadSessions(workspace, true) },
          delete: () => { void store.forgetWorkspace(workspace) },
        }}
        // A disconnected connection cannot start sessions; the row still
        // renders, with the plain dictionary labels.
        t={connected ? translate : ((verb: string, params?: Record<string, unknown>) => rowsTranslate(verb, params))}
      />
      {expanded && <Level depth={2}><SessionRows workspace={workspace} now={props.now} flags={flags} /></Level>}
    </>
  )
}

/** One connection row (the level the shell's own tree does not have) plus its workspaces. */
function ConnectionRow(props: { target: PublicTarget; workspaces: RemoteWorkspace[]; now: number }): ReactElement | null {
  const state = useAppState()
  const { target } = props
  const key = targetNodeKey(target.id)
  const expanded = state.expanded[key] ?? false
  const connected = target.status === 'ready'
  const translate = useMemo(() => connectionTranslate(target), [target.status])
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
    cwd: t('list.endpoint', { username: target.username, host: target.host, port: target.port }),
    createdAt: Number.isNaN(lastConnectedAt) ? undefined : lastConnectedAt,
    label: target.label,
    sessionCount,
    expanded,
    containsCurrent: false,
    sessions: [],
  }
  return (
    <>
      <Level depth={0} state={target.status} className="dsh-rw-conn">
        <ProjectRowItem
          group={group}
          // Clicking a disconnected connection connects it; a live one folds,
          // exactly like the shell's workspace rows fold.
          onToggle={() => {
            if (connected) store.toggleNode(key)
            else void store.connectTarget(target)
          }}
          onCreate={() => { void store.openAddWorkspace(target) }}
          actions={{
            rename: () => { void (connected ? store.stopTarget(target) : store.connectTarget(target)) },
            delete: () => { void store.forgetTarget(target) },
          }}
          t={translate}
        />
      </Level>
      {expanded && (
        <Level depth={1}>
          {props.workspaces.length === 0
            ? <p className="dsh-rw-tree-empty">{t('tree.conn.noWorkspace')}</p>
            : props.workspaces.map(workspace => (
              <WorkspaceRow key={workspace.id} workspace={workspace} target={target} now={props.now} />
            ))}
        </Level>
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
    <RenameSessionDialog />
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
 * Order one workspace's sessions the way the shell orders its own: pinned rows
 * lead (in the shell's pin order), then most recent activity, with archived
 * rows last — and pinned/archived membership comes from the official sets.
 * @param items - the stored sessions.
 * @param flags - the official pin/archive sets.
 * @returns the row order.
 */
function orderSessions(items: readonly RemoteSession[], flags: SessionFlags): RemoteSession[] {
  const rank = (session: RemoteSession): number => {
    if (flags.pinned.has(session.id)) return 0
    return flags.archived.has(session.id) ? 2 : 1
  }
  return [...items].sort((left, right) => {
    const byRank = rank(left) - rank(right)
    if (byRank !== 0) return byRank
    return (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0)
  })
}
