/**
 * Browser half of `dsh-remote-workspace` (v3).
 *
 * Contributions, all through the shipped client slots so hot reload disposes
 * them with the plugin fiber:
 *
 *  - `sidebar.panellist` — the native 「远程连接」 row. The shell owns the row's
 *    button chrome; the contribution renders the icon only, and selecting it
 *    switches the main column to this plugin's panel.
 *  - `main` — two keyed entries: {@link CONNECTIONS_PANEL_ID} lists every saved
 *    connection with its live phase and the connect/disconnect/forget verbs,
 *    and `SERVER_MAIN_ID` carries the full-screen official DSH UI of the
 *    connected target (portal iframe).
 *
 * While a target's official UI owns the main area the shell's own sidebar is
 * hidden, so the list is the pre-connection surface the `dsh-rw/close-portal`
 * command returns to. The connection dialogs and the toast live in a body-level
 * host (`chrome.tsx`) so they float above the iframe.
 */
import type { ClientContext } from './context.ts'
import { mountRemoteChrome } from './chrome.tsx'
import { CONNECTIONS_PANEL_ID, RemoteConnectionsIcon, RemoteConnectionsPanel } from './connections-panel.tsx'
import { t } from './locales.ts'
import {
  bindPortalCommandHandlers, closeServerMain, ServerMainPanel, SERVER_MAIN_ID,
} from './portal-main.tsx'
import {
  bindRemoteStoreContext, disposeRemoteStore, loadRemoteState, openConnectDialog,
  selectPanel, switchRemoteTarget,
} from './remote-store.ts'
import { ensureStyles } from './styles.ts'

/**
 * Row order in the shell's sidebar panellist.
 *
 * Ascending, after the shipped rows (插件 0, 自动化任务 10) so 远程连接 sits at the
 * bottom of the navigation list, directly above the trailing 更多 menu. This is a
 * plugin constant: the shell's panellist exposes no user reordering.
 */
const SIDEBAR_ORDER = 100

/** Client services this plugin needs: `slots` only. */
export const inject = ['slots']

/**
 * Plugin body: stylesheet, the floating chrome host, the connection snapshot
 * and the slot contributions.
 * @param ctx - the client context.
 */
export function apply(ctx: ClientContext): void {
  bindRemoteStoreContext(ctx)
  ctx.effect(() => ensureStyles(), 'dsh-remote-workspace: stylesheet')
  // Dialogs and the toast stay mounted across panel switches and above the
  // portal iframe; their own disposer removes the body-level host.
  ctx.effect(() => mountRemoteChrome(), 'dsh-remote-workspace: dialogs host')
  // The sidebar row and the list read one snapshot; the portal deep link
  // needs the session list too, so load at activation rather than on first
  // panel open.
  void loadRemoteState()
  ctx.effect(() => () => { disposeRemoteStore() }, 'dsh-remote-workspace: remote store lifetime')
  // Commands the embedded server UI sends to this page (protocol §9.3). The
  // handlers live here so `portal-main` stays free of store imports.
  bindPortalCommandHandlers({
    switchTarget: (targetId) => { void switchRemoteTarget(targetId) },
    openConnectDialog,
    closePortal: () => {
      closeServerMain()
      selectPanel(CONNECTIONS_PANEL_ID)
    },
  })

  // The 远程连接 navigation row. The shell owns the button, label and
  // selection; the same key opens the `main` panel below. The shell renders the
  // panellist in ascending order after its own rows (插件 0, 自动化任务 10) and
  // before the trailing 更多 menu, so a large order is "last after 自动化任务".
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: CONNECTIONS_PANEL_ID,
    order: SIDEBAR_ORDER,
    label: () => t('connections.sidebar.label'),
    registrant: 'dsh-remote-workspace',
  }, RemoteConnectionsIcon))

  // The connection list page. Registered defensively: an option mismatch on
  // this slot must not silently remove the sidebar row.
  try {
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: CONNECTIONS_PANEL_ID,
      label: () => t('connections.title'),
    }, RemoteConnectionsPanel))
  } catch (error) {
    console.error('[dsh-remote-workspace] connections panel registration failed', error)
  }

  // The full-screen official DSH UI of the connected target. Kept as its own
  // keyed entry: activation selects it, `dsh-rw/close-portal` selects the list.
  try {
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: SERVER_MAIN_ID,
      label: () => t('portal.main.aria'),
    }, ServerMainPanel))
  } catch (error) {
    console.error('[dsh-remote-workspace] official-ui main panel registration failed', error)
  }
}
