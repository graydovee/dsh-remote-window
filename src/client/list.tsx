/**
 * The plugin panel body — the *secondary* surface.
 *
 * The tree itself lives in the left sidebar (see `sidebar.tsx`, next to the
 * shell's own 工作区 section). This panel is where the connection wizard renders
 * and where the 添加工作区 picker is hosted, and it keeps a full-width copy of the
 * tree so the plugin still works if the sidebar anchor is ever unavailable.
 */
import type { ReactElement } from 'react'
import {
  Button, IconPlusOutlineRegular, IconRefreshOutlineRegular, IconWorkspaceTreeOutlineRegular,
  Modal, PathLabel,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteRegistryWorkspace } from './api.ts'
import { EmptyState, ErrorBanner, LoadingLine } from './common.tsx'
import { t } from './locales.ts'
import { store, useAppState } from './store.ts'
import { RemoteTree } from './tree.tsx'

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

/** The panel body: the same tree as the sidebar, at full width. */
export function ListBody(): ReactElement | null {
  const state = useAppState()
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
          <RemoteTree compact={false} />
        </div>
      </div>
      {/* The picker is rendered by `RemoteTree` (it is a tree-level dialog). */}
    </div>
  )
}

/** Panel footer actions. */
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
