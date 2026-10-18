/**
 * The plugin panel body — the *secondary* surface — plus the 添加工作区 dialog.
 *
 * The tree itself lives in the left sidebar (see `sidebar.tsx`, next to the
 * shell's own 工作区 section). This panel is where the connection wizard renders
 * and where a second copy of the tree is kept, so the plugin still works if the
 * sidebar anchor is ever unavailable.
 *
 * The dialog is **browse-only** (P0): the tree renders every workspace in the
 * server's list, because the host keeps a local ref for each of them — including
 * the ones another client created. A "server has it, add it here" tab would
 * therefore be permanently empty; adding a workspace means picking a directory.
 */
import type { ReactElement } from 'react'
import {
  Button, IconPlusOutlineRegular, IconRefreshOutlineRegular,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ErrorBanner, LoadingLine, useSingleHost } from './common.tsx'
import { DirectoryPicker } from './directory-picker.tsx'
import { t } from './locales.ts'
import { store, useAppState } from './store.ts'
import { RemoteTree } from './tree.tsx'

/**
 * The 添加工作区 dialog: pick a remote directory.
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
  const { directory } = state
  const canOpen = !state.pending
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
              disabled={directory.loading}
              onClick={() => {
                const targetId = directory.targetId
                if (targetId === undefined) return
                void store.loadDirectory(targetId, directory.listing?.path ?? '')
              }}
            >
              {t('common.refresh')}
            </Button>
          </span>
          <span className="dsh-rw-footer-group">
            <Button
              variant="primary"
              disabled={!canOpen}
              onClick={() => { void store.openWorkspace() }}
            >
              {state.pending ? t('directory.opening') : t('directory.open')}
            </Button>
            <Button variant="ghost" onClick={store.closeAddWorkspace}>{t('tree.addWorkspace.close')}</Button>
          </span>
        </div>
      )}
    >
      <div className="dsh-rw-picker">
        <DirectoryPicker />
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
          onClick={() => { void store.refreshAll() }}
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
