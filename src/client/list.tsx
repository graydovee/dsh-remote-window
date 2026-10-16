/**
 * Saved-items list view: the hosts the plugin has connected to and the remote
 * workspaces it has opened. Shown both when the overlay opens with saved
 * targets and right after a successful connection, so a new workspace is
 * immediately visible (with an "open again" and a "forget" action).
 */
import type { ReactElement, ReactNode } from 'react'
import {
  Button, IconGlobeOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular,
  IconWorkspaceTreeOutlineRegular, PathLabel, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PublicTarget, RemoteWorkspace, TargetStatus } from './api.ts'
import type { TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import { EmptyState, ErrorBanner, LoadingLine } from './common.tsx'
import { t } from './locales.ts'
import { formatTimestamp, store, useAppState } from './store.ts'

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

/** One saved host row. */
function WorkspaceNode(props: { workspace: RemoteWorkspace }): ReactElement {
  const { workspace } = props
  return (
    <li className="dsh-rw-tree-workspace">
      <div className="dsh-rw-row-title">
        <IconWorkspaceTreeOutlineRegular size={14} />
        <Button variant="ghost" size="sm" disabled={false} onClick={() => { void store.reopenWorkspace(workspace) }}>
          {workspace.title}
        </Button>
      </div>
      <div className="dsh-rw-row-meta"><span className="dsh-rw-mono">{workspace.path}</span></div>
      {workspace.sessionId !== undefined && (
        <ul className="dsh-rw-tree-sessions">
          <li className="dsh-rw-row-meta">
            <span>↳</span>
            <Button variant="ghost" size="sm" disabled={false} onClick={() => { void store.reopenWorkspace(workspace) }}>
              <span className="dsh-rw-mono">{workspace.sessionId}</span>
            </Button>
          </li>
        </ul>
      )}
    </li>
  )
}

function TargetRow(props: { target: PublicTarget; workspaces: RemoteWorkspace[]; pending: boolean }): ReactElement | null {
  const { target } = props
  const lastConnectedAt = formatTimestamp(target.lastConnectedAt)
  return (
    <li className="dsh-rw-row">
      <div className="dsh-rw-row-main">
        <div className="dsh-rw-row-title">
          {/* Connection-state globe: the icon itself carries the state color
              (green connected / red failed / neutral otherwise). */}
          <span className="dsh-rw-conn-icon" data-state={target.status}>
            <IconGlobeOutlineRegular size={14} />
          </span>
          <span>{target.label}</span>
          <Tag tone={STATUS_TONES[target.status]}>{t(STATUS_LABELS[target.status])}</Tag>
          <Tag tone="quiet">{t('list.kind.ssh')}</Tag>
        </div>
        <div className="dsh-rw-row-meta">
          <span className="dsh-rw-mono">
            {t('list.endpoint', { username: target.username, host: target.host, port: target.port })}
          </span>
          {lastConnectedAt !== undefined && <span>{t('list.lastConnectedAt', { time: lastConnectedAt })}</span>}
        </div>
        {target.lastError !== undefined && target.lastError !== '' && (
          <div className="dsh-rw-row-error">{t('list.lastError', { message: target.lastError })}</div>
        )}
      </div>
      <div className="dsh-rw-row-actions">
        {/* One entry action whose wording follows the state: a stopped host has
            nothing to stop, so it offers 重新连接 instead (ZCode's disconnected
            workspaces do the same). */}
        <Button
          variant="outline"
          size="sm"
          disabled={props.pending}
          onClick={() => { store.openTargetDirectory(target) }}
        >
          {target.status === 'ready' ? t('list.openDirectory') : t('list.reconnect')}
        </Button>
        {target.status === 'ready' && (
          <Button
            variant="ghost"
            size="sm"
            disabled={props.pending}
            onClick={() => { void store.stopTarget(target) }}
          >
            {t('list.stop')}
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
      </div>
      <div className="dsh-rw-tree-children">
        {props.workspaces.map(workspace => <WorkspaceNode key={workspace.id} workspace={workspace} />)}
        {target.status === 'ready' && (
          <Button variant="ghost" size="sm" disabled={props.pending} onClick={() => { store.openTargetDirectory(target) }}>
            {t('list.addWorkspace')}
          </Button>
        )}
      </div>
    </li>
  )
}

/** The saved-items list body. */
export function ListBody(): ReactElement | null {
  const state = useAppState()

  return (
    <div className="dsh-rw-stack">
      {state.error !== undefined && <ErrorBanner error={state.error} onDismiss={store.dismissError} />}
      <div className="dsh-rw-scroll">
        <p className="dsh-rw-hint">
          {t('list.description', { targets: state.targets.length, workspaces: state.workspaces.length })}
        </p>
        <p className="dsh-rw-hint">
          {state.pluginVersion === ''
            ? t('list.meta.unknown')
            : t('list.meta', { version: state.pluginVersion, profile: state.defaultProfile })}
        </p>

        {state.stateLoading && !state.stateLoaded && <LoadingLine text={t('list.loading')} />}

        <div className="dsh-rw-section">
          <h3 className="dsh-rw-section-title">{t('list.targets')}</h3>
          {state.targets.length === 0
            ? <EmptyState text={t('list.targets.empty')} />
            : (
              <ul className="dsh-rw-rows">
                {state.targets.map(target => (
                  <TargetRow key={target.id} target={target} workspaces={state.workspaces.filter(workspace => workspace.targetId === target.id)} pending={state.pending} />
                ))}
              </ul>
            )}
        </div>

        {/* Remote workspaces intentionally have no list here: opened ones live
            in the shell's own 工作区 tree like local projects. */}
      </div>
    </div>
  )
}

/** List actions, rendered inside the dialog footer. */
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
