/**
 * The 远程工作区 tree — the plugin panel's main view.
 *
 * Shape (the product requirement this file exists for):
 *
 *   远程工作区                     [新建连接] [刷新]
 *   └─ 连接 1  ●(三态)            [添加工作区] [断开] [忘记]
 *      ├─ 工作区 A  /remote/path  [打开] [新会话] [移除]
 *      │  ├─ 会话 a1  (创建时间)  [继续]
 *      │  └─ 会话 a2              [继续]
 *      └─ 工作区 B
 *
 * The tri-state icon belongs to the **connection** node (未连接/已连接/连接失败),
 * not to the workspace: a workspace is a directory, a connection has a state.
 * Session children are lazy: expanding a workspace calls `persist.list` on the
 * remote server, which is also the data behind 换设备续聊.
 */
import type { ReactElement } from 'react'
import {
  Button, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconDeliverDocRegular,
  IconGlobeOutlineRegular, IconLinkOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular,
  IconWorkspaceTreeOutlineRegular, Modal, PathLabel, StateDot, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState, TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PublicTarget, RemoteRegistryWorkspace, RemoteSession, RemoteWorkspace, TargetStatus } from './api.ts'
import { EmptyState, ErrorBanner, LoadingLine } from './common.tsx'
import { t } from './locales.ts'
import {
  formatTimestamp, shortSessionId, store, targetNodeKey, useAppState, workspaceNodeKey,
} from './store.ts'
import type { AppState } from './store.ts'

/** Status label key per target status. */
const STATUS_LABELS = {
  unknown: 'list.status.unknown',
  ready: 'list.status.ready',
  stopped: 'list.status.stopped',
  failed: 'list.status.failed',
} as const

/** Tag palette per target status. */
const STATUS_TONES: Record<TargetStatus, TagTone> = {
  unknown: 'neutral',
  ready: 'success',
  stopped: 'neutral',
  failed: 'danger',
}

/**
 * The connection's tri-state indicator.
 *
 * `ready` is the only state that proves a live channel: the host computes it
 * from the channel map, so a stale persisted "ready" cannot show green.
 */
function connectionState(status: TargetStatus): StateDotState {
  if (status === 'ready') return 'done'
  if (status === 'failed') return 'error'
  return 'idle'
}

/** Connection state wording (never the stored status word alone). */
function connectionLabel(status: TargetStatus): string {
  if (status === 'ready') return t('tree.conn.connected')
  if (status === 'failed') return t('tree.conn.failed')
  return t('tree.conn.disconnected')
}

/** One expand/collapse twisty. */
function Twisty(props: { open: boolean; label: string; onToggle: () => void }): ReactElement | null {
  return (
    <button
      type="button"
      className="dsh-rw-twisty"
      aria-expanded={props.open}
      aria-label={props.label}
      onClick={props.onToggle}
    >
      {props.open ? <IconChevronDownOutlineRegular size={12} /> : <IconChevronRightOutlineRegular size={12} />}
    </button>
  )
}

/** One stored remote session row. */
function SessionRow(props: { workspace: RemoteWorkspace; session: RemoteSession; pending: boolean }): ReactElement | null {
  const { session } = props
  const created = session.createdAt === undefined ? undefined : formatTimestamp(new Date(session.createdAt).toISOString())
  const isCurrent = props.workspace.sessionId === session.id
  return (
    <li className="dsh-rw-tree-session" data-current={isCurrent ? 'true' : 'false'}>
      <span className="dsh-rw-tree-gutter" />
      <span className="dsh-rw-tree-icon"><IconDeliverDocRegular size={13} /></span>
      <span className="dsh-rw-tree-label dsh-rw-mono" title={session.id}>
        {shortSessionId(session.id)}
      </span>
      {created !== undefined && <span className="dsh-rw-tree-meta">{t('tree.session.createdAt', { time: created })}</span>}
      {isCurrent && <Tag tone="info">{t('tree.workspace.open')}</Tag>}
      <span className="dsh-rw-tree-actions">
        <Button
          variant="ghost"
          size="sm"
          disabled={props.pending}
          onClick={() => { void store.continueSession(props.workspace, session) }}
        >
          {t('tree.session.continue')}
        </Button>
      </span>
    </li>
  )
}

/** One workspace node with its (lazy) session children. */
function WorkspaceNode(props: { workspace: RemoteWorkspace; target: PublicTarget; pending: boolean }): ReactElement | null {
  const state = useAppState()
  const { workspace } = props
  const key = workspaceNodeKey(workspace.id)
  const open = state.expanded[key] ?? false
  const sessions = state.sessions[workspace.id]
  const connected = props.target.status === 'ready'
  return (
    <li className="dsh-rw-tree-workspace">
      <div className="dsh-rw-tree-row" data-open={open ? 'true' : 'false'}>
        <Twisty open={open} label={open ? t('tree.collapse') : t('tree.expand')} onToggle={() => { store.toggleNode(key) }} />
        <span className="dsh-rw-tree-icon"><IconWorkspaceTreeOutlineRegular size={13} /></span>
        <span className="dsh-rw-tree-label">{workspace.title}</span>
        <PathLabel path={workspace.path} className="dsh-rw-tree-path" />
        <span className="dsh-rw-tree-actions">
          <Button
            variant="outline"
            size="sm"
            disabled={!connected || props.pending}
            onClick={() => { void store.openWorkspaceRecord(workspace) }}
          >
            {t('tree.workspace.open')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!connected || props.pending}
            onClick={() => { void store.reopenWorkspace(workspace) }}
          >
            {t('tree.workspace.newSession')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={props.pending}
            onClick={() => { void store.forgetWorkspace(workspace) }}
          >
            {t('tree.workspace.forget')}
          </Button>
        </span>
      </div>
      {open && (
        <ul className="dsh-rw-tree-children">
          {sessions === undefined || (sessions.loading && sessions.items.length === 0) ? (
            <li className="dsh-rw-tree-note">{t('tree.sessions.loading')}</li>
          ) : sessions.error !== undefined ? (
            <li className="dsh-rw-tree-note dsh-rw-tree-note-error">
              {t('tree.sessions.failed', { message: sessions.error.message })}
            </li>
          ) : sessions.items.length === 0 ? (
            <li className="dsh-rw-tree-note">{t('tree.sessions.empty')}</li>
          ) : (
            sessions.items.map(session => (
              <SessionRow key={session.id} workspace={workspace} session={session} pending={props.pending} />
            ))
          )}
          <li className="dsh-rw-tree-note">
            <Button
              variant="ghost"
              size="sm"
              disabled={!connected || props.pending}
              icon={<IconPlusOutlineRegular size={12} />}
              onClick={() => { void store.reopenWorkspace(workspace) }}
            >
              {t('tree.workspace.newSession')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={sessions?.loading ?? false}
              icon={<IconRefreshOutlineRegular size={12} />}
              onClick={() => { void store.loadSessions(workspace, true) }}
            >
              {t('common.refresh')}
            </Button>
          </li>
        </ul>
      )}
    </li>
  )
}

/** One connection node: the tri-state icon and its workspace children. */
function ConnectionNode(props: { target: PublicTarget; workspaces: RemoteWorkspace[]; pending: boolean }): ReactElement | null {
  const state = useAppState()
  const { target } = props
  const key = targetNodeKey(target.id)
  const open = state.expanded[key] ?? false
  const lastConnectedAt = formatTimestamp(target.lastConnectedAt)
  const connected = target.status === 'ready'
  return (
    <li className="dsh-rw-tree-connection" data-state={target.status}>
      <div className="dsh-rw-tree-row" data-open={open ? 'true' : 'false'}>
        <Twisty open={open} label={open ? t('tree.collapse') : t('tree.expand')} onToggle={() => { store.toggleNode(key) }} />
        <span className="dsh-rw-tree-icon dsh-rw-conn-icon" data-state={target.status}>
          <IconGlobeOutlineRegular size={14} />
        </span>
        {/* The tri-state itself: grey 未连接 / green 已连接 / red 连接失败. */}
        <StateDot state={connectionState(target.status)} size={8} />
        <span className="dsh-rw-tree-label">{target.label}</span>
        <Tag tone={STATUS_TONES[target.status]}>{connectionLabel(target.status)}</Tag>
        <Tag tone="quiet">{t('list.kind.ssh')}</Tag>
        <span className="dsh-rw-tree-meta dsh-rw-mono">
          {t('list.endpoint', { username: target.username, host: target.host, port: target.port })}
        </span>
        {lastConnectedAt !== undefined && (
          <span className="dsh-rw-tree-meta">{t('list.lastConnectedAt', { time: lastConnectedAt })}</span>
        )}
        <span className="dsh-rw-tree-actions">
          {/* 先连接才能建会话: while the connection is down its single primary
              action is 连接; every workspace action stays disabled until the
              host reports a live channel. */}
          {!connected && (
            <Button
              variant="primary"
              size="sm"
              disabled={props.pending}
              icon={<IconLinkOutlineRegular size={12} />}
              onClick={() => { void store.connectTarget(target) }}
            >
              {target.status === 'unknown' ? t('tree.conn.connect') : t('tree.conn.reconnect')}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={!connected || props.pending}
            icon={<IconPlusOutlineRegular size={12} />}
            onClick={() => { void store.openAddWorkspace(target) }}
          >
            {t('tree.conn.addWorkspace')}
          </Button>
          {connected && (
            <Button
              variant="ghost"
              size="sm"
              disabled={props.pending}
              onClick={() => { void store.stopTarget(target) }}
            >
              {t('tree.conn.disconnect')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={props.pending}
            onClick={() => { void store.forgetTarget(target) }}
          >
            {t('list.forget')}
          </Button>
        </span>
      </div>
      {target.lastError !== undefined && target.lastError !== '' && (
        <div className="dsh-rw-tree-error">{t('list.lastError', { message: target.lastError })}</div>
      )}
      {open && (
        <ul className="dsh-rw-tree-children">
          {props.workspaces.length === 0
            ? <li className="dsh-rw-tree-note">{t('tree.conn.noWorkspace')}</li>
            : props.workspaces.map(workspace => (
              <WorkspaceNode key={workspace.id} workspace={workspace} target={target} pending={props.pending} />
            ))}
        </ul>
      )}
    </li>
  )
}

/** One row of the 添加工作区 picker: a workspace the remote dsh registered. */
function AddWorkspaceRow(props: { entry: RemoteRegistryWorkspace; added: boolean; pending: boolean }): ReactElement | null {
  const { entry } = props
  return (
    <li className="dsh-rw-picker-row">
      <span className="dsh-rw-tree-icon"><IconWorkspaceTreeOutlineRegular size={13} /></span>
      <span className="dsh-rw-picker-main">
        <span className="dsh-rw-picker-title">{entry.title}</span>
        <PathLabel path={entry.path} className="dsh-rw-tree-path" />
      </span>
      <span className="dsh-rw-tree-meta">{t('tree.addWorkspace.sessions', { count: entry.sessionCount })}</span>
      <Button
        variant={props.added ? 'ghost' : 'outline'}
        size="sm"
        disabled={props.pending}
        onClick={() => { void store.adoptRemoteWorkspace(entry) }}
      >
        {props.added ? t('tree.addWorkspace.added') : t('tree.addWorkspace.add')}
      </Button>
    </li>
  )
}

/** The 添加工作区 modal: the remote dsh's own registry, plus a browse escape hatch. */
export function AddWorkspaceDialog(): ReactElement | null {
  const state = useAppState()
  const dialog = state.addWorkspace
  if (dialog === undefined) return null
  const added = new Set(
    state.workspaces
      .filter(workspace => workspace.targetId === dialog.targetId)
      .map(workspace => workspace.path),
  )
  const target = state.targets.find(candidate => candidate.id === dialog.targetId)
  return (
    <Modal
      open
      onClose={store.closeAddWorkspace}
      title={t('tree.addWorkspace.title')}
      closeLabel={t('tree.addWorkspace.close')}
      description={t('tree.addWorkspace.description', { label: dialog.targetLabel })}
      footer={(
        <div className="dsh-rw-footer-actions">
          <span className="dsh-rw-footer-group">
            <Button
              variant="ghost"
              icon={<IconRefreshOutlineRegular size={12} />}
              disabled={dialog.loading}
              onClick={() => { void store.refreshAddWorkspace() }}
            >
              {t('common.refresh')}
            </Button>
          </span>
          <span className="dsh-rw-footer-group">
            {/* Directory browsing stays available: a workspace need not be
                registered on the remote dsh to be opened here. */}
            <Button
              variant="outline"
              disabled={target === undefined}
              onClick={() => {
                store.closeAddWorkspace()
                if (target !== undefined) store.openTargetDirectory(target)
              }}
            >
              {t('tree.addWorkspace.browse')}
            </Button>
            <Button variant="primary" onClick={store.closeAddWorkspace}>{t('tree.addWorkspace.close')}</Button>
          </span>
        </div>
      )}
    >
      <div className="dsh-rw-picker">
        {dialog.error !== undefined && <ErrorBanner error={dialog.error} />}
        {dialog.loading && dialog.items.length === 0 && <LoadingLine text={t('tree.addWorkspace.loading')} />}
        {!dialog.loading && dialog.items.length === 0 && dialog.error === undefined && (
          <EmptyState text={t('tree.addWorkspace.empty')} />
        )}
        {dialog.items.length > 0 && (
          <ul className="dsh-rw-picker-list">
            {dialog.items.map(entry => (
              <AddWorkspaceRow
                key={entry.id}
                entry={entry}
                added={added.has(entry.path)}
                pending={state.pending}
              />
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

/** The tree body of the panel. */
export function ListBody(): ReactElement | null {
  const state: AppState = useAppState()
  const hasTargets = state.targets.length > 0

  return (
    <div className="dsh-rw-stack">
      {state.error !== undefined && <ErrorBanner error={state.error} onDismiss={store.dismissError} />}
      <div className="dsh-rw-scroll">
        <p className="dsh-rw-hint">{t('tree.hint')}</p>
        <p className="dsh-rw-hint">
          {state.pluginVersion === ''
            ? t('list.meta.unknown')
            : t('list.meta', { version: state.pluginVersion, profile: state.defaultProfile })}
        </p>

        {state.stateLoading && !state.stateLoaded && <LoadingLine text={t('list.loading')} />}

        <div className="dsh-rw-section">
          <h3 className="dsh-rw-section-title">{t('tree.title')}</h3>
          {!hasTargets
            ? <EmptyState text={t('tree.empty')} />
            : (
              <ul className="dsh-rw-tree">
                {state.targets.map(target => (
                  <ConnectionNode
                    key={target.id}
                    target={target}
                    workspaces={state.workspaces.filter(workspace => workspace.targetId === target.id)}
                    pending={state.pending}
                  />
                ))}
              </ul>
            )}
        </div>
      </div>
      <AddWorkspaceDialog />
    </div>
  )
}

/** List actions, rendered inside the panel footer. */
export function ListFooter(): ReactElement | null {
  const state = useAppState()
  return (
    <div className="dsh-rw-footer-actions">
      <span className="dsh-rw-footer-group">
        <Button
          variant="ghost"
          icon={<IconRefreshOutlineRegular size={12} />}
          disabled={state.stateLoading}
          onClick={() => { void store.refreshState() }}
        >
          {t('common.refresh')}
        </Button>
      </span>
      <span className="dsh-rw-footer-group">
        <Button variant="ghost" onClick={store.closeOverlay}>{t('common.close')}</Button>
        <Button variant="primary" icon={<IconPlusOutlineRegular size={12} />} onClick={store.newConnection}>
          {t('list.newConnection')}
        </Button>
      </span>
    </div>
  )
}
