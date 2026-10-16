/**
 * The remote tree rows — connections → workspaces → sessions.
 *
 * Rendered in two places: the LEFT SIDEBAR section (the primary surface, right
 * next to the shell's own 工作区 section) and the plugin panel (the connection
 * wizard's home, and the fallback when the sidebar anchor is unavailable).
 * `compact` only changes spacing and which metadata fits — never behaviour —
 * because the sidebar column is much narrower than the main column.
 */
import type { ReactElement } from 'react'
import {
  Button, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconDeliverDocRegular,
  IconGlobeOutlineRegular, IconLinkOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular,
  IconWorkspaceTreeOutlineRegular, PathLabel, StateDot, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState, TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PublicTarget, RemoteSession, RemoteWorkspace, TargetStatus } from './api.ts'
import { t } from './locales.ts'
import { formatTimestamp, shortSessionId, store, targetNodeKey, useAppState, workspaceNodeKey } from './store.ts'

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

/** Row context shared by every node. */
interface TreeContext {
  /** Sidebar presentation: tighter rows, less metadata. */
  readonly compact: boolean
  readonly pending: boolean
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
function SessionRow(props: { workspace: RemoteWorkspace; session: RemoteSession } & TreeContext): ReactElement | null {
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
      {!props.compact && created !== undefined && (
        <span className="dsh-rw-tree-meta">{t('tree.session.createdAt', { time: created })}</span>
      )}
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
function WorkspaceNode(props: { workspace: RemoteWorkspace; target: PublicTarget } & TreeContext): ReactElement | null {
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
        {!props.compact && <PathLabel path={workspace.path} className="dsh-rw-tree-path" />}
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
            {props.compact ? t('tree.workspace.forget') : t('tree.workspace.forget')}
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
              <SessionRow
                key={session.id}
                workspace={workspace}
                session={session}
                compact={props.compact}
                pending={props.pending}
              />
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
              aria-label={t('common.refresh')}
              onClick={() => { void store.loadSessions(workspace, true) }}
            >
              {props.compact ? '' : t('common.refresh')}
            </Button>
          </li>
        </ul>
      )}
    </li>
  )
}

/** One connection node: the tri-state icon and its workspace children. */
function ConnectionNode(props: { target: PublicTarget; workspaces: RemoteWorkspace[] } & TreeContext): ReactElement | null {
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
        {!props.compact && (
          <>
            <Tag tone="quiet">{t('list.kind.ssh')}</Tag>
            <span className="dsh-rw-tree-meta dsh-rw-mono">
              {t('list.endpoint', { username: target.username, host: target.host, port: target.port })}
            </span>
            {lastConnectedAt !== undefined && (
              <span className="dsh-rw-tree-meta">{t('list.lastConnectedAt', { time: lastConnectedAt })}</span>
            )}
          </>
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
            aria-label={t('list.forget')}
            onClick={() => { void store.forgetTarget(target) }}
          >
            {props.compact ? '' : t('list.forget')}
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
              <WorkspaceNode
                key={workspace.id}
                workspace={workspace}
                target={target}
                compact={props.compact}
                pending={props.pending}
              />
            ))}
        </ul>
      )}
    </li>
  )
}

/**
 * The whole remote tree.
 * @param props.compact - sidebar presentation (narrow column).
 * @param props.empty - text shown when no connection is saved yet.
 */
export function RemoteTree(props: { compact: boolean; empty?: string }): ReactElement | null {
  const state = useAppState()
  if (state.targets.length === 0) {
    return <p className="dsh-rw-tree-empty">{props.empty ?? t('tree.empty')}</p>
  }
  return (
    <ul className={props.compact ? 'dsh-rw-tree dsh-rw-tree--compact' : 'dsh-rw-tree'}>
      {state.targets.map(target => (
        <ConnectionNode
          key={target.id}
          target={target}
          workspaces={state.workspaces.filter(workspace => workspace.targetId === target.id)}
          compact={props.compact}
          pending={state.pending}
        />
      ))}
    </ul>
  )
}
