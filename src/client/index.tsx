/**
 * Browser half of `dsh-remote-workspace`.
 *
 * Two contributions, both through the shipped client slots so hot reload
 * disposes them with the plugin fiber:
 *
 *  1. `sidebar.panellist` — the 「远程连接」 row, directly below 插件 (order 1,
 *     above the schedules panel). The shell owns the row's button chrome;
 *     selecting it switches the main column to this plugin's panel.
 *  2. `main` — the panel page itself: 新建连接 at the top-left, and the whole
 *     flow inline (choose a method → fill the configuration → watch the live
 *     progress stream including the explicit host-key confirmation → pick the
 *     remote directory).
 *
 * The bundle imports only the platform module table (`react`,
 * `react/jsx-runtime`, `@deepseek-ai/dsh-client-ui-primitives`); the stylesheet
 * is injected as one `<style data-plugin="dsh-remote-workspace">` element from
 * {@link apply} because this plugin's tsdown config does not process CSS.
 */
import type { ReactElement, ReactNode } from 'react'
import type { ClientContext } from './context.ts'
import { t } from './locales.ts'
import { ListBody, ListFooter } from './list.tsx'
import { PANEL_ID, RemotePanelIcon, RemoteWorkspacePanel } from './panel.tsx'
import { mountSidebarSection } from './sidebar.tsx'
import { bindVerbContext } from './session-verbs.ts'
import { bindClientContext, dispose, store, watchWorkspaces } from './store.ts'
import { ensureStyles, syncWorkspaceIcons } from './styles.ts'

/**
 * Client services this plugin needs: `slots` only. Localization is the
 * plugin's own dictionary (`./locales.ts`), so no locale service is required.
 */
export const inject = ['slots']

/**
 * Plugin body: inject the stylesheet, own the store's side-effect lifetime and
 * register the two slot contributions.
 * @param ctx - the client context.
 */
export function apply(ctx: ClientContext): void {
  bindClientContext(ctx)
  bindVerbContext(ctx)
  ctx.effect(() => ensureStyles(), 'dsh-remote-workspace: stylesheet')
  // Globe icon on the plugin's rows in the shell 工作区 tree (plugin lifetime,
  // not panel lifetime — the rows live in the sidebar).
  ctx.effect(() => watchWorkspaces(syncWorkspaceIcons), 'dsh-remote-workspace: workspace icons')
  // The 远程工作区 section in the LEFT SIDEBAR, directly above the shell's own
  // 工作区 section. The shell declares no seat for a second section, so this
  // mounts into the browsing region itself; see sidebar.tsx for the anchors it
  // relies on and for the fallback when they are missing.
  ctx.effect(() => mountSidebarSection(), 'dsh-remote-workspace: sidebar section')
  // Load the saved state at activation, not only on first panel open: the
  // sidebar section and the workspace icons depend on it, and neither waits for
  // a panel the user may never open.
  void store.refreshState()
  ctx.effect(() => () => { dispose() }, 'dsh-remote-workspace: store lifetime')

  // The 远程连接 panel row: sits directly below 插件 (order 1, above the
  // schedules panel's 10) and above the 工作区 region. The shell owns the row's
  // button chrome; the row is registered before the page so a page-side failure
  // can never take the row down with it.
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 1,
    label: () => t('button.label'),
    registrant: 'dsh-remote-workspace',
  }, RemotePanelIcon))

  // The main-column page itself. Registered defensively: an option mismatch on
  // this slot must not silently remove the sidebar row.
  try {
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      label: () => t('app.name'),
    }, RemoteWorkspacePanel))
  } catch (error) {
    console.error('[dsh-remote-workspace] main panel registration failed', error)
  }

}
