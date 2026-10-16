/**
 * The 远程工作区 section, rendered **in the left sidebar**, directly above the
 * shell's own 工作区 section.
 *
 * Why a portal rather than a slot: the shell declares exactly one browsing seat
 * in the sidebar (`sidebar.workspaces`, kind `single`) and its occupant
 * (ui-workspace) is the whole 工作区 section — header, list and dialogs. There
 * is no seat for a second section, and replacing the occupant would mean
 * reimplementing or inlining ui-workspace, which is not exported for reuse.
 *
 * What this module relies on is small and measurable (verified against the
 * deployed shell, 2026-10-16):
 *
 *  - `[data-slot="sidebar.workspaces"]` exists, is `display: contents` (0×0, no
 *    box of its own) and keeps its DOM identity across sidebar collapse cycles;
 *  - its parent is the physical region box (`flex-direction: column`,
 *    `overflow: hidden`) whose only child is that slot element;
 *  - the region goes `opacity: 0` and 35px wide while the sidebar is collapsed,
 *    so a section mounted inside it hides with the column for free.
 *
 * The mount is therefore: insert our own element as the region's first child.
 * If any of that is missing (a future shell rework), the function returns
 * undefined without mounting, and the plugin panel remains a complete fallback —
 * nothing throws, nothing half-mounts.
 */
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  Button, IconGlobeOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { t } from './locales.ts'
import { PANEL_ID } from './panel.tsx'
import { store, useAppState } from './store.ts'
import { RemoteTree } from './tree.tsx'

/** Attribute carrying our section element, for idempotent remounting. */
export const SIDEBAR_SECTION_ATTR = 'data-dsh-remote-workspace-section'

/** The shell's sidebar browsing seat. */
const WORKSPACES_SLOT = '[data-slot="sidebar.workspaces"]'

/** The section chrome: title row + the tree. */
export function SidebarSection(): ReactElement | null {
  const state = useAppState()
  const busy = state.stateLoading || state.pending
  return (
    <section className="dsh-rw-side" aria-label={t('tree.sidebar.title')} data-plugin="dsh-remote-workspace">
      <header className="dsh-rw-side-head">
        <span className="dsh-rw-side-icon" aria-hidden="true"><IconGlobeOutlineRegular size={14} /></span>
        <span className="dsh-rw-side-title">{t('tree.sidebar.title')}</span>
        <span className="dsh-rw-side-actions">
          <Button
            variant="ghost"
            size="sm"
            icon={<IconRefreshOutlineRegular size={12} />}
            aria-label={t('common.refresh')}
            disabled={busy}
            onClick={() => { void store.refreshState() }}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<IconPlusOutlineRegular size={12} />}
            aria-label={t('list.newConnection')}
            onClick={() => { store.openConnectionWizard(PANEL_ID) }}
          />
        </span>
      </header>
      <div className="dsh-rw-side-body">
        {state.stateLoading && !state.stateLoaded && <p className="dsh-rw-tree-empty">{t('list.loading')}</p>}
        <RemoteTree compact empty={t('tree.sidebar.empty')} />
      </div>
      {state.error !== undefined && <p className="dsh-rw-side-error">{state.error.message}</p>}
    </section>
  )
}

/**
 * Mount the sidebar section into the browsing region, above 工作区.
 *
 * The mount is deliberately defensive, because two timings are not ours:
 * the shell may render its sidebar *after* this plugin activates (boot order),
 * and the sidebar may be re-rendered later (theme, collapse, HMR). So the
 * section attaches when the anchor first appears and re-attaches itself if the
 * shell ever drops or reorders our node.
 *
 * @returns a disposer that unmounts the React root and removes the node.
 */
export function mountSidebarSection(): (() => void) | undefined {
  if (typeof document === 'undefined') return undefined

  let disposed = false
  let container: HTMLDivElement | undefined
  let root: Root | undefined
  let region: HTMLElement | undefined

  /** Insert our (existing or fresh) node as the region's first child. */
  const attach = (): void => {
    if (disposed) return
    const anchor = document.querySelector(WORKSPACES_SLOT)?.parentElement
    if (anchor === null || anchor === undefined) return
    region = anchor
    if (container === undefined) {
      container = document.createElement('div')
      container.setAttribute(SIDEBAR_SECTION_ATTR, '')
      container.className = 'dsh-rw-side-host'
      // Our own React root: the region belongs to the shell's tree, and no slot
      // occupant may render a sibling of the 工作区 section.
      root = createRoot(container)
      root.render(<SidebarSection />)
    }
    // `insertBefore(node, node)` is a remove+insert, so guard both orders.
    if (container.parentElement !== anchor || anchor.firstElementChild !== container) {
      anchor.insertBefore(container, anchor.firstElementChild)
    }
  }

  attach()
  let observer: MutationObserver | undefined
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(attach)
    // Cheap: the callback re-checks one predicate when our node is already in
    // place, and mutations are delivered per microtask, not per node.
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
