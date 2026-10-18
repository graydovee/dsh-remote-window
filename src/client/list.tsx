/**
 * The plugin panel body — the *secondary* surface — plus the 添加工作区 dialog.
 *
 * The tree itself lives in the left sidebar (see `sidebar.tsx`, next to the
 * shell's own 工作区 section). This panel is where the connection wizard renders
 * and where a second copy of the tree is kept, so the plugin still works if the
 * sidebar anchor is ever unavailable.
 *
 * The dialog has two tabs, **browse first**: adding a workspace means picking a
 * remote directory (that is the requirement), and the remote dsh's own registry
 * is the shortcut for directories it already knows. The browse tab is
 * `directory-picker.tsx` — the only copy of that UI, moved out of the wizard.
 */
import type { ReactElement } from 'react'
import {
  Button, IconPlusOutlineRegular, IconRefreshOutlineRegular, IconWorkspaceTreeOutlineRegular,
  Modal, PathLabel, SegmentedControl,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteRegistryWorkspace } from './api.ts'
import { EmptyState, ErrorBanner, LoadingLine, useSingleHost } from './common.tsx'
import { DirectoryPicker } from './directory-picker.tsx'
import { t } from './locales.ts'
import { store, useAppState } from './store.ts'
import { RemoteTree } from './tree.tsx'

/** One row of the 远端已注册 tab: a workspace the remote dsh registered. */
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

/**
 * The 添加工作区 dialog: 浏览目录 (default) and 远端已注册.
 *
 * Opening it opens the browser, including its connect-first step for a target
 * whose channel is down (`store.openBrowseDirectory` shows 连接中 inside the
 * dialog rather than a blank pane).
 */
export function AddWorkspaceDialog(): ReactElement | null {
  const owned = useSingleHost('add-workspace')
  const state = useAppState()
  const dialog = state.addWorkspace
  if (!owned || dialog === undefined) return null
  const added = new Set(
    state.workspaces
      .filter(workspace => workspace.targetId === dialog.targetId)
      .map(workspace => workspace.path),
  )
  const browse = dialog.tab === 'browse'
  const { directory } = state
  const canOpen = browse
    && !state.pending
    && !directory.loading
    && !directory.connecting
    && directory.listing !== undefined
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
              disabled={browse ? directory.loading : dialog.loading}
              onClick={() => {
                if (!browse) {
                  void store.refreshAddWorkspace()
                  return
                }
                const targetId = directory.targetId
                if (targetId === undefined) return
                void store.loadDirectory(targetId, directory.listing?.path ?? '')
              }}
            >
              {t('common.refresh')}
            </Button>
          </span>
          <span className="dsh-rw-footer-group">
            {browse && (
              <Button
                variant="primary"
                disabled={!canOpen}
                onClick={() => { void store.openWorkspace() }}
              >
                {state.pending ? t('directory.opening') : t('directory.open')}
              </Button>
            )}
            <Button variant="ghost" onClick={store.closeAddWorkspace}>{t('tree.addWorkspace.close')}</Button>
          </span>
        </div>
      )}
    >
      <div className="dsh-rw-picker">
        <SegmentedControl<'browse' | 'registry'>
          id="dsh-rw-add-workspace-tab"
          value={dialog.tab}
          label={t('tree.addWorkspace.title')}
          options={[
            { value: 'browse', label: t('tree.addWorkspace.tab.browse') },
            { value: 'registry', label: t('tree.addWorkspace.tab.registry') },
          ]}
          onChange={(next) => { store.setAddWorkspaceTab(next) }}
        />
        {browse
          ? <DirectoryPicker />
          : (
            <>
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
            </>
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
      {/* The dialog is rendered by `RemoteTree` (it is a tree-level dialog). */}
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
