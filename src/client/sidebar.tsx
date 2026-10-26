/**
 * The 远程工作区 section in the LEFT sidebar, directly above the shell's own
 * 工作区 section. The mount seam is unchanged (the shell declares one
 * `sidebar.workspaces` seat, so this plugin inserts its own element as the
 * browsing region's first child); only the data source is v1's P3 store.
 */
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  Button, IconPlusOutlineRegular, IconRefreshOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { t } from './locales.ts'
import {
  loadRemoteState, openConnectDialog, refreshAllRemote, useRemoteAppState,
} from './remote-store.ts'
import { RemoteTree } from './tree.tsx'

/** Attribute carrying our section element, for idempotent remounting. */
export const SIDEBAR_SECTION_ATTR = 'data-dsh-remote-workspace-section'

/** The shell's sidebar browsing seat. */
const WORKSPACES_SLOT = '[data-slot="sidebar.workspaces"]'

/** The section chrome: title row, local search, refresh and the tree. */
export function SidebarSection(): ReactElement | null {
  const state = useRemoteAppState()
  const busy = state.loading || state.pending
  return (
    <section className="dsh-rw-side" aria-label={t('tree.sidebar.title')} data-plugin="dsh-remote-workspace">
      <header className="dsh-rw-side-head">
        <span className="dsh-rw-side-title">{t('tree.sidebar.title')}</span>
        <span className="dsh-rw-side-actions">
          <Button
            variant="ghost"
            size="sm"
            icon={<IconRefreshOutlineRegular size={12} />}
            aria-label={t('remote.refresh')}
            disabled={busy}
            onClick={() => { void refreshAllRemote() }}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<IconPlusOutlineRegular size={12} />}
            aria-label={t('list.newConnection')}
            onClick={() => openConnectDialog()}
          />
        </span>
      </header>
      <div className="dsh-rw-side-body">
        {state.loading && !state.loaded && <p className="dsh-rw-tree-empty">{t('common.loading')}</p>}
        {state.error !== undefined && (
          <p className="dsh-rw-side-error">
            {t('list.loadFailed')}
            <button type="button" className="dsh-rw-banner-link" onClick={() => { void loadRemoteState() }}>
              {t('remote.error.retry')}
            </button>
          </p>
        )}
        <RemoteTree compact search="" />
      </div>
    </section>
  )
}

/**
 * Mount the sidebar section into the browsing region, above 工作区.
 * @returns a disposer that unmounts the React root and removes the node.
 */
export function mountSidebarSection(): (() => void) | undefined {
  if (typeof document === 'undefined') return undefined

  let disposed = false
  let container: HTMLDivElement | undefined
  let root: Root | undefined
  let region: HTMLElement | undefined

  const attach = (): void => {
    if (disposed) return
    const anchor = document.querySelector(WORKSPACES_SLOT)?.parentElement
    if (anchor === null || anchor === undefined) return
    region = anchor
    if (container === undefined) {
      container = document.createElement('div')
      container.setAttribute(SIDEBAR_SECTION_ATTR, '')
      container.className = 'dsh-rw-side-host'
      root = createRoot(container)
      root.render(<SidebarSection />)
    }
    if (container.parentElement !== anchor || anchor.firstElementChild !== container) {
      anchor.insertBefore(container, anchor.firstElementChild)
    }
  }

  attach()
  let observer: MutationObserver | undefined
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(attach)
    observer.observe(document.documentElement, { childList: true, subtree: true })
  }

  return () => {
    disposed = true
    observer?.disconnect()
    root?.unmount()
    container?.remove()
    region = undefined
  }
}
