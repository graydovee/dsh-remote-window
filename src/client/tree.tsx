/**
 * The v1 remote tree — the same official rows, now fed by server authority.
 *
 * Hierarchy stays connection → server workspace → server session. Row
 * presentation is still the vendored `ProjectRowItem` / `SessionNodeItem`; this
 * file owns only the walk, the lazy loading and the drag
 * wrappers. Every write (pin/archive/order/rename/remove/create) goes through
 * `remote-store` to the P3 contract; nothing here keeps a second list.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import {
  Button, IconArchiveOutlineRegular, IconBranchOutlineRegular, IconEditOutlineRegular, IconGlobeOutlineRegular, IconPinFillRegular,
  IconPinOutlineRegular, IconRefreshOutlineRegular, IconUnarchiveOutlineRegular,
  IconWarningTriangleOutlineRegular, MenuItemButton, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { NoticeToastHost } from './common.tsx'
import { t } from './locales.ts'
import { planRemoteDrop, planRemoteSessionDrop } from './remote-data.ts'
import type { RemoteSessionNode, RemoteWorkspaceGroup } from './remote-data.ts'
import {
  applyDeployment, connectRemoteTarget, disconnectRemoteTarget, dismissRemoteNotice, forkRemoteSession,
  loadRegistryChanges, loadRemoteSessions,
  notifyRemoteError, notifyRemoteSuccess, openAddWorkspace, openModeDialog, openRemoteDraft,
  openRemoteSession, previewProfileRestart, refreshTargetComplete, remoteSearchFor, requestDeleteWorkspace,
  requestForgetTarget, requestRenameSession, requestRenameWorkspace, retryPendingLocalReveal,
  reorderSessions, reorderWorkspaces,
  targetNodeKey, toggleRemoteNode, toggleSessionArchive, toggleSessionPin, useRemoteAppState, workspaceNodeKey,
} from './remote-store.ts'
import type { RemoteConnectionView } from './remote-store.ts'
import {
  ProjectRowItem, SessionNodeItem, rowRenderSlots, rowsTranslate,
} from './vendor/workspace-rows/index.ts'
import type { GroupNode, SessionNode } from './vendor/workspace-rows/index.ts'
import { RemoteDialogs } from './remote-dialogs.tsx'
import { rowsCss } from './vendor/workspace-rows/generated/classnames.ts'

/** Tick relative times while the tree is open. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Date.now()) }, 60_000)
    return () => { window.clearInterval(timer) }
  }, [])
  return now
}

/** One hierarchy wrapper (state/connection glyph positioning lives in CSS). */
function Level(props: {
  state?: string
  className?: string
  connect?: 'connecting' | 'failed' | undefined
  children: ReactNode
}): ReactElement {
  return (
    <div
      className={props.className}
      data-state={props.state}
      data-connect={props.connect}
      title={props.connect === 'connecting' ? t('tree.conn.connecting') : undefined}
    >
      {props.children}
    </div>
  )
}

/** The connection row's own connect/failure statement (same seat as before). */
function ConnectStatus(props: { connecting: boolean; error?: string | undefined }): ReactElement | null {
  if (props.error === undefined) return null
  const reason = t('tree.conn.failedReason', { message: props.error })
  return (
    <span className="dsh-rw-conn-status" data-kind="failed">
      <Tooltip label={reason} side="bottom" align="center" delayMs={100}>
        <span className="dsh-rw-conn-warning" role="img" aria-label={reason} title={reason}>
          <IconWarningTriangleOutlineRegular size={14} />
        </span>
      </Tooltip>
    </span>
  )
}

type VerbTranslate = (key: string, params?: Record<string, unknown>) => string

function connectionTranslate(connected: boolean, connecting: boolean, failed = false): VerbTranslate {
  const connectLabel = connecting
    ? t('tree.conn.connecting')
    : failed ? t('tree.conn.reconnect') : t('tree.conn.connect')
  return (key, params) => {
    if (key === 'rename') return connected ? t('tree.conn.disconnect') : connectLabel
    if (key === 'delete.workspace') return t('tree.forgetConnection')
    if (key === 'actions.newSession' || key === 'actions.newSession.aria') {
      return connected ? t('remote.workspace.add') : connectLabel
    }
    return rowsTranslate(key, params)
  }
}

function workspaceTranslate(title: string): VerbTranslate {
  return (key, params) => {
    if (key === 'rename') return t('remote.workspace.rename')
    if (key === 'delete.workspace') return t('remote.workspace.remove')
    if (key === 'actions.newSession' || key === 'actions.newSession.aria') return t('remote.session.new')
    if (key === 'actions.workspace.aria') return t('tree.workspace.aria', { name: title })
    return rowsTranslate(key, params)
  }
}

function sessionTranslate(title: string): VerbTranslate {
  return (key, params) => {
    if (key === 'actions.session.aria') return t('tree.session.aria', { name: title })
    return rowsTranslate(key, params)
  }
}

/** The session row's `⋮` entries, aligned with the official 0.2.1 order. */
function SessionMenu(props: {
  targetId: string
  workspaceId: string
  node: RemoteSessionNode
  close: () => void
}): ReactElement {
  const { node } = props
  const act = (run: () => void): void => { props.close(); run() }
  return (
    <>
      {!node.archived && (
        <MenuItemButton
          icon={node.pinned ? <IconPinFillRegular /> : <IconPinOutlineRegular />}
          onSelect={() => { act(() => { void toggleSessionPin(props.targetId, node.id) }) }}
        >
          {rowsTranslate(node.pinned ? 'menu.unpinSession' : 'menu.pinSession')}
        </MenuItemButton>
      )}
      <MenuItemButton
        icon={<IconEditOutlineRegular />}
        onSelect={() => { act(() => requestRenameSession(props.targetId, node.id)) }}
      >
        {rowsTranslate('rename')}
      </MenuItemButton>
      <MenuItemButton
        icon={<IconBranchOutlineRegular />}
        onSelect={() => { act(() => { void forkRemoteSession(props.targetId, node.id) }) }}
      >
        {rowsTranslate('menu.fork')}
      </MenuItemButton>
      <MenuItemButton
        danger={!node.archived}
        icon={node.archived ? <IconUnarchiveOutlineRegular /> : <IconArchiveOutlineRegular />}
        onSelect={() => {
          act(() => { void toggleSessionArchive(props.targetId, node.id) })
        }}
      >
        {rowsTranslate(node.archived ? 'menu.unarchiveSession' : 'menu.archiveSession')}
      </MenuItemButton>
      <MenuItemButton
        icon={<IconEditOutlineRegular />}
        onSelect={() => {
          act(() => {
            void navigator.clipboard.writeText(node.id).then(
              () => { notifyRemoteSuccess(t('tree.session.copied')) },
              () => { notifyRemoteError(t('tree.session.copyFailed')) },
            )
          })
        }}
      >
        {t('tree.session.copyId')}
      </MenuItemButton>
    </>
  )
}

/** The row's hover buttons (archive then pin), matching the official pair. */
function SessionActions(props: { targetId: string; node: RemoteSessionNode }): ReactElement {
  const { node } = props
  return (
    <>
      <Tooltip label={rowsTranslate(node.archived ? 'menu.unarchiveSession' : 'menu.archiveSession')} side="bottom" align="end" delayMs={500}>
        <button
          type="button"
          className={rowsCss.iconButton}
          aria-label={rowsTranslate(node.archived ? 'menu.unarchiveSession' : 'menu.archiveSession')}
          onClick={(event: { stopPropagation(): void }) => {
            event.stopPropagation()
            void toggleSessionArchive(props.targetId, node.id)
          }}
        >
          {node.archived ? <IconUnarchiveOutlineRegular size={14} /> : <IconArchiveOutlineRegular size={14} />}
        </button>
      </Tooltip>
      {!node.archived && (
        <Tooltip label={rowsTranslate(node.pinned ? 'menu.unpinSession' : 'menu.pinSession')} side="bottom" align="end" delayMs={500}>
          <button
            type="button"
            className={rowsCss.iconButton}
            aria-label={rowsTranslate(node.pinned ? 'menu.unpinSession' : 'menu.pinSession')}
            onClick={(event: { stopPropagation(): void }) => {
              event.stopPropagation()
              void toggleSessionPin(props.targetId, node.id)
            }}
          >
            {node.pinned ? <IconPinFillRegular size={14} /> : <IconPinOutlineRegular size={14} />}
          </button>
        </Tooltip>
      )}
    </>
  )
}

/** Tree semantics for one vendored row (the same a11y wrapper as before). */
function TreeRow(props: {
  label: string
  expanded?: boolean
  onActivate: () => void
  children: ReactElement
}): ReactElement {
  return (
    <div
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

/** One session row. */
function SessionRow(props: {
  view: RemoteConnectionView
  workspace: RemoteWorkspaceGroup
  node: RemoteSessionNode
  now: number
  drag: DragState | null
  setDrag: (next: DragState | null) => void
  sessionOrder: readonly string[]
  currentSessionId?: string
}): ReactElement {
  const { workspace, node } = props
  const targetId = props.view.target.id
  const workspaceId = workspace.workspace.workspaceId
  const pinned = useMemo(() => new Set(workspace.sessions.filter(row => row.pinned).map(row => row.id)), [workspace.sessions])
  const archived = useMemo(() => new Set(workspace.sessions.filter(row => row.archived).map(row => row.id)), [workspace.sessions])
  const compatible = props.drag?.kind === 'session'
    && props.drag.targetId === targetId
    && props.drag.workspaceId === workspaceId
  const samePin = compatible && props.drag!.pinned === pinned.has(node.id)
  const dragProps = {
    start: () => { props.setDrag({ kind: 'session', targetId, workspaceId, sourceId: node.id, pinned: pinned.has(node.id) }) },
    active: samePin,
    marker: samePin && props.drag?.over?.id === node.id ? props.drag.over.half : null,
    hover: (half: 'before' | 'after') => {
      const current = props.drag
      if (current === null) return
      props.setDrag({ ...current, over: { id: node.id, half } })
    },
    drop: (half: 'before' | 'after') => {
      const current = props.drag
      props.setDrag(null)
      if (current === null) return
      const plan = planRemoteSessionDrop({
        order: props.sessionOrder,
        sourceId: current.sourceId,
        targetId: node.id,
        half,
        pinnedSessionIds: pinned,
        archivedSessionIds: archived,
      })
      if ('reject' in plan) return
      void reorderSessions(targetId, workspaceId, current.sourceId, plan.beforeId)
    },
    end: () => { props.setDrag(null) },
  }
  const group: SessionNode = {
    id: node.id,
    title: node.title,
    blank: false,
    running: node.running,
    runningSubagentCount: node.runningSubagentCount,
    completed: node.completed,
    pinned: node.pinned,
    archived: node.archived,
    updatedAt: node.updatedAt,
  }
  const seat = rowRenderSlots({
    leading: null,
    menu: (close: () => void) => (
      <SessionMenu key="menu" targetId={targetId} workspaceId={workspaceId} node={node} close={close} />
    ),
    actions: <SessionActions key="actions" targetId={targetId} node={node} />,
  })
  return (
    <SessionNodeItem
      node={group}
      currentId={props.currentSessionId}
      now={props.now}
      onOpen={() => {
        if (node.archived) {
          notifyRemoteError(t('tree.session.archivedNotOpenable'))
          return
        }
        void openRemoteSession(targetId, node.id)
      }}
      onRenameRequest={() => {}}
      renderSlot={seat}
      drag={dragProps}
      t={sessionTranslate(node.title === '' ? rowsTranslate('session.untitled') : node.title)}
    />
  )
}

/** One temporary 「新会话」 row for the open blank session. */
function DraftRow(props: {
  view: RemoteConnectionView
  workspace: RemoteWorkspaceGroup
  draft: RemoteSessionNode
  now: number
}): ReactElement {
  const node: SessionNode = {
    id: props.draft.id,
    title: '',
    blank: true,
    running: false,
    runningSubagentCount: 0,
    completed: false,
    pinned: false,
    archived: false,
    updatedAt: Date.now(),
  }
  return (
    <SessionNodeItem
      node={node}
      currentId={props.draft.id}
      now={props.now}
      onOpen={() => { void openRemoteSession(props.view.target.id, props.draft.id) }}
      onRenameRequest={() => {}}
      renderSlot={rowRenderSlots({ leading: null, menu: null, actions: null })}
      t={sessionTranslate(props.workspace.workspace.title)}
    />
  )
}

/** One workspace row plus its session rows. */
function WorkspaceRow(props: {
  view: RemoteConnectionView
  group: RemoteWorkspaceGroup
  now: number
  drag: DragState | null
  setDrag: (next: DragState | null) => void
  workspaceOrder: readonly string[]
  searchActive: boolean
  currentSessionId?: string
  visibleSessionIds?: ReadonlySet<string>
}): ReactElement {
  const { group, view } = props
  const targetId = view.target.id
  const workspaceId = group.workspace.workspaceId
  const key = workspaceNodeKey(workspaceId)
  const expanded = view.expanded[key] ?? false
  const shown = props.searchActive || expanded
  const sessions = props.visibleSessionIds === undefined
    ? group.sessions
    : group.sessions.filter(node => props.visibleSessionIds!.has(node.id))
  const containsCurrent = props.currentSessionId !== undefined
    && group.sessions.some(node => node.id === props.currentSessionId)
  const sessionOrder = group.workspace.sessionIds
  const workspaceDrag = props.drag?.kind === 'workspace' && props.drag.targetId === targetId
  const createdAtMs = Date.parse(group.workspace.createdAt)
  const groupNode: GroupNode = {
    key: workspaceId,
    workspaceId,
    cwd: group.workspace.path,
    createdAt: Number.isNaN(createdAtMs) ? undefined : createdAtMs,
    label: group.workspace.title,
    sessionCount: group.workspace.sessionCount,
    expanded: shown,
    containsCurrent,
    sessions: [],
  }
  const halfOf = (event: { clientY: number; currentTarget: HTMLElement }): 'before' | 'after' => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }
  const commitWorkspaceDrop = (half: 'before' | 'after'): void => {
    const current = props.drag
    if (current === null || current.kind !== 'workspace') return
    props.setDrag(null)
    const plan = planRemoteDrop(props.workspaceOrder, current.sourceId, workspaceId, half)
    if ('reject' in plan) return
    void reorderWorkspaces(targetId, current.sourceId, plan.beforeId)
  }
  return (
    <div
      className="dsh-rw-ws-group"
      data-drop-active={workspaceDrag && props.drag?.over?.id === workspaceId ? props.drag.over.half : undefined}
      onDragOver={workspaceDrag
        ? (event: { preventDefault(): void; dataTransfer: { dropEffect: string } | null; clientY: number; currentTarget: HTMLElement }) => {
          event.preventDefault()
          if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
          const current = props.drag
          if (current === null) return
          props.setDrag({ ...current, over: { id: workspaceId, half: halfOf(event) } })
        }
        : undefined}
      onDrop={workspaceDrag
        ? (event: { preventDefault(): void; dataTransfer: { dropEffect: string } | null; clientY: number; currentTarget: HTMLElement }) => {
          event.preventDefault()
          commitWorkspaceDrop(halfOf(event))
        }
        : undefined}
    >
      <TreeRow
        label={group.workspace.title}
        expanded={shown}
        onActivate={() => toggleRemoteNode(targetId, key)}
      >
        <ProjectRowItem
          group={groupNode}
          onToggle={() => toggleRemoteNode(targetId, key)}
          onCreate={() => { void openRemoteDraft(targetId, workspaceId) }}
          actions={{
            rename: () => requestRenameWorkspace(targetId, workspaceId),
            delete: () => requestDeleteWorkspace(targetId, workspaceId),
          }}
          drag={{
            start: () => { props.setDrag({ kind: 'workspace', targetId, sourceId: workspaceId }) },
            end: () => { if (props.drag?.kind === 'workspace') props.setDrag(null) },
          }}
          t={workspaceTranslate(group.workspace.title)}
        />
      </TreeRow>
      {shown && (
        <div role="group">
          {group.draft !== undefined && (
            <DraftRow view={view} workspace={group} draft={group.draft} now={props.now} />
          )}
          {sessions.map(node => (
            <SessionRow
              key={node.id}
              view={view}
              workspace={group}
              node={node}
              now={props.now}
              drag={props.drag}
              setDrag={props.setDrag}
              sessionOrder={sessionOrder}
              {...(props.currentSessionId === undefined ? {} : { currentSessionId: props.currentSessionId })}
            />
          ))}
          {view.sessionsLoad.loading && group.sessions.length === 0 && (
            <p className="dsh-rw-tree-empty">{t('remote.loading.sessions')}</p>
          )}
          {view.sessionsLoad.error !== undefined && group.sessions.length === 0 && (
            <p className="dsh-rw-side-error">
              {t('remote.sessions.failed', { message: view.sessionsLoad.error.message })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Deployment status and the two confirmation buttons (M3). */
function DeploymentRow(props: { view: RemoteConnectionView }): ReactElement | null {
  const deployment = props.view.connection?.deployment
  if (deployment === undefined) return null
  const runtimeNeeds = deployment.runtime.action !== 'reuse'
    && (deployment.runtime.requiresConfirmation || deployment.runtime.mode === 'confirm')
  const pluginNeeds = deployment.plugin.action !== 'reuse' && deployment.plugin.requiresConfirmation
  const actionLabel = (action: 'install' | 'upgrade'): string =>
    t(action === 'install' ? 'remote.deploy.install' : 'remote.deploy.upgrade')
  if (!runtimeNeeds && !pluginNeeds) return null
  return (
    <div className="dsh-rw-deploy-row">
      <span className="dsh-rw-deploy-title">{t('remote.deploy.title')}</span>
      {runtimeNeeds && (
        <span className="dsh-rw-deploy-item">
          <span>
            {t('remote.deploy.runtime')} · {actionLabel(deployment.runtime.action === 'install' ? 'install' : 'upgrade')}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={props.view.stateLoad.loading}
            onClick={() => { void applyDeployment(props.view.target.id, 'runtime') }}
          >
            {t('remote.deploy.runtimeButton')}
          </Button>
        </span>
      )}
      {pluginNeeds && (
        <span className="dsh-rw-deploy-item">
          <span>{t('remote.deploy.plugin')} · {actionLabel(deployment.plugin.action === 'install' ? 'install' : 'upgrade')}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={props.view.stateLoad.loading}
            onClick={() => { void applyDeployment(props.view.target.id, 'plugin') }}
          >
            {t('remote.deploy.pluginButton')}
          </Button>
        </span>
      )}
    </div>
  )
}

/** One connection row, its mode/credential chip and its workspace subtree. */
function ConnectionRow(props: {
  view: RemoteConnectionView
  now: number
  drag: DragState | null
  setDrag: (next: DragState | null) => void
  /** Owned by SidebarSection, so a cleared input cannot leave a stale filter. */
  search: string
}): ReactElement {
  const { view } = props
  const targetId = view.target.id
  const key = targetNodeKey(targetId)
  const livePhase = view.connection?.phase
  const connected = livePhase === 'ready' || livePhase === 'degraded'
  const connecting = view.connecting === true || livePhase === 'connecting'
  const error = view.error ?? view.connection?.error
  const failed = view.connectFailed === true || livePhase === 'failed'
  const phase = connecting ? 'connecting' : failed ? 'failed' : connected ? 'ready' : livePhase ?? 'stopped'
  const expanded = view.expanded[key] ?? false
  const state = useRemoteAppState()
  const searchActive = props.search.trim() !== ''
  // Only derive a result while a query is active: the cleared state must use
  // the unfiltered server-order groups, never a remembered search result.
  const result = searchActive ? remoteSearchFor(targetId, props.search) : undefined
  const groups = result === undefined
    ? view.groups
    : view.groups.filter(group => result.workspaceIds.has(group.workspace.workspaceId))
  const workspaceOrder = (view.workspaces?.workspaces ?? []).map(workspace => workspace.workspaceId)
  const sessionCount = view.groups.reduce((total, group) => total + group.sessions.length, 0)
  const group: GroupNode = {
    key: `conn:${targetId}`,
    workspaceId: `conn:${targetId}`,
    cwd: view.target.kind === 'wsl'
      ? t('list.endpoint.wsl', { distro: view.target.wslDistro ?? view.target.host })
      : t('list.endpoint', { username: view.target.username, host: view.target.host, port: view.target.port }),
    createdAt: Number.isNaN(Date.parse(view.target.lastConnectedAt ?? '')) ? undefined : Date.parse(view.target.lastConnectedAt ?? ''),
    label: view.target.label,
    sessionCount,
    expanded,
    containsCurrent: false,
    sessions: [],
  }
  const translate = useMemo(
    () => connectionTranslate(connected, connecting, failed),
    [connected, connecting, failed],
  )
  return (
    <>
      <Level
        state={phase}
        className="dsh-rw-conn"
        connect={connecting ? 'connecting' : failed ? 'failed' : undefined}
      >
        <ConnectStatus connecting={connecting} error={failed ? error?.message : undefined} />
        <TreeRow
          label={view.target.label}
          expanded={connected && expanded}
          onActivate={() => {
            if (connected) toggleRemoteNode(targetId, key)
            else void connectRemoteTarget(targetId)
          }}
        >
          <ProjectRowItem
            key={`conn:${view.target.status}:${view.connection?.phase ?? ''}`}
            group={group}
            onToggle={() => {
              if (connected) toggleRemoteNode(targetId, key)
              else void connectRemoteTarget(targetId)
            }}
            onCreate={() => { void (connected ? openAddWorkspace(targetId) : connectRemoteTarget(targetId)) }}
            actions={{
              rename: () => { void (connected ? disconnectRemoteTarget(targetId) : connectRemoteTarget(targetId)) },
              delete: () => requestForgetTarget(targetId),
              extra: [
                { id: 'mode', label: t('remote.mode.switchMenu'), icon: <IconGlobeOutlineRegular />, onSelect: () => openModeDialog(targetId) },
                {
                  id: 'refresh',
                  label: t('remote.refresh'),
                  icon: <IconRefreshOutlineRegular />,
                  onSelect: () => { void (view.stale ? loadRegistryChanges(targetId) : refreshTargetComplete(targetId)) },
                },
              ],
            }}
            t={translate}
          />
        </TreeRow>
      </Level>
      {connected && (expanded || searchActive) && (
        <>
          {state.openingDraft?.targetId === targetId && (
            <p className="dsh-rw-tree-empty">{t('remote.draft.opening')}</p>
          )}
          <DeploymentRow view={view} />
          {state.pendingLocalReveal?.targetId === targetId && (
            <div className="dsh-rw-remote-banner" role="status">
              <span>{t('remote.session.revealTimeout')}</span>
              <button type="button" className="dsh-rw-banner-link" onClick={() => { void retryPendingLocalReveal() }}>
                {t('remote.error.retry')}
              </button>
            </div>
          )}
          {view.stale && (
            <div className="dsh-rw-remote-banner" role="status">
              <span>{t('remote.registry.stale')}</span>
              <button type="button" className="dsh-rw-banner-link" onClick={() => { void loadRegistryChanges(targetId) }}>
                {t('remote.registry.load')}
              </button>
              {view.reloadError !== undefined && (
                <button type="button" className="dsh-rw-banner-link" onClick={() => { void previewProfileRestart(targetId) }}>
                  {t('remote.registry.restart')}
                </button>
              )}
            </div>
          )}
          {view.stateLoad.loading && groups.length === 0 && (
            <p className="dsh-rw-tree-empty">{t('remote.loading')}</p>
          )}
          {view.stateLoad.error !== undefined && groups.length === 0 && (
            <p className="dsh-rw-side-error">
              {t('remote.sessions.failed', { message: view.stateLoad.error.message })}
            </p>
          )}
          {!view.stateLoad.loading && view.workspaces === undefined && groups.length === 0 && (
            <p className="dsh-rw-tree-empty">{t('remote.empty.unavailable')}</p>
          )}
          {groups.map(group => (
            <WorkspaceRow
              key={group.workspace.workspaceId}
              view={view}
              group={group}
              now={props.now}
              drag={props.drag}
              setDrag={props.setDrag}
              workspaceOrder={workspaceOrder}
              searchActive={searchActive}
              {...(state.selection?.targetId === targetId && state.selection.sessionId !== undefined
                ? { currentSessionId: state.selection.sessionId }
                : {})}
              {...(result === undefined ? {} : { visibleSessionIds: result.sessionIds })}
            />
          ))}
          {searchActive && result !== undefined && !result.hasMatches && (
            <p className="dsh-rw-tree-empty">{t('remote.search.empty')}</p>
          )}
          {!view.sessionsLoad.loaded && view.sessionsLoad.loading && (
            <p className="dsh-rw-tree-empty">{t('remote.loading.sessions')}</p>
          )}
        </>
      )}
    </>
  )
}

/** Drag state shared by every row in one tree. */
interface DragState {
  readonly kind: 'workspace' | 'session'
  readonly targetId: string
  readonly workspaceId?: string
  readonly sourceId: string
  readonly pinned?: boolean
  readonly over?: { readonly id: string; readonly half: 'before' | 'after' } | undefined
}

/**
 * The whole remote tree. With no saved connection it renders nothing: the
 * sidebar header already carries 新建连接, so an empty sentence is noise.
 */
export function RemoteTree(props: { compact: boolean; search?: string }): ReactElement | null {
  const state = useRemoteAppState()
  // The sidebar owns the search input; passing its value down makes the clear
  // path independent from a possibly stale store subscription.
  const search = props.search ?? state.search
  const now = useNow()
  const [drag, setDrag] = useState<DragState | null>(null)
  // With no connection the tree has no rows; the sidebar section owns the
  // dialogs, so the connect dialog is not lost here.
  const overlays = (
    <>
      <RemoteDialogs />
      {state.notice !== undefined && <NoticeToastHost notice={state.notice} onDismiss={dismissRemoteNotice} />}
    </>
  )
  if (state.order.length === 0) return overlays
  return (
    <>
      {overlays}
      <div
        className={props.compact ? 'dsh-rw-tree dsh-rw-tree--compact' : 'dsh-rw-tree'}
        role="tree"
        aria-label={t('tree.sidebar.title')}
      >
        {state.order.map(targetId => {
          const view = state.connections[targetId]
          return view === undefined
            ? null
            : <ConnectionRow key={targetId} view={view} now={now} drag={drag} setDrag={setDrag} search={search} />
        })}
      </div>
    </>
  )
}
