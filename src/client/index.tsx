/**
 * Browser half of `dsh-remote-workspace` (v1).
 *
 * Contributions, all through the shipped client slots so hot reload disposes
 * them with the plugin fiber:
 *
 *  - the 「远程工作区」 section in the left sidebar (mounted by
 *    {@link mountSidebarSection}) — connections → server workspaces → sessions;
 *  - one keyed `main` panel for the server-mode conversation area (the v2
 *    native timeline/composer, task-15). The legacy portal iframe module stays
 *    in the tree but is not mounted. A local conversation is selected through
 *    the official `uiWorkspace`, which clears the key and returns to
 *    `conversation`.
 *
 * The legacy connection panel/wizard and the old remote-preset seat are not
 * registered in v1; local-mode wiring lives in the session bridge and will be
 * re-attached there, not through the old panel.
 */
import type { ClientContext } from './context.ts'
import { t } from './locales.ts'
import { bindRemoteStoreContext, disposeRemoteStore, loadRemoteState } from './remote-store.ts'
import { NativeSessionPanel } from './panel.tsx'
import { NATIVE_MAIN_ID } from './session-main.tsx'
import { mountSidebarSection } from './sidebar.tsx'
import { ensureStyles } from './styles.ts'
import { loadOfficialUi } from './official-ui-runtime.ts'

/** Client services this plugin needs: `slots` only. */
export const inject = ['slots']

/**
 * Plugin body: stylesheet, the sidebar section, the P3 state stream and the
 * server-mode main panel.
 * @param ctx - the client context.
 */
export function apply(ctx: ClientContext): void {
  void loadOfficialUi().then(
    () => {},
    error => console.warn('[dsh-remote-workspace] official ui failed', error),
  )
  bindRemoteStoreContext(ctx)
  ctx.effect(() => ensureStyles(), 'dsh-remote-workspace: stylesheet')
  // The 远程工作区 section in the LEFT SIDEBAR, directly above the shell's own
  // 工作区 section. The shell declares no seat for a second section, so this
  // mounts into the browsing region itself; see sidebar.tsx.
  ctx.effect(() => mountSidebarSection(), 'dsh-remote-workspace: sidebar section')
  // v1 remote tree: one P3 snapshot for the sidebar; sessions load lazily when
  // a connection expands. The state stream keeps it current afterwards.
  void loadRemoteState()
  ctx.effect(() => () => { disposeRemoteStore() }, 'dsh-remote-workspace: remote store lifetime')

  // One keyed main entry: the v2 native conversation. The portal iframe is
  // retained but no longer registered/mounted (removed after v2 acceptance).
  try {
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: NATIVE_MAIN_ID,
      label: () => t('session.main.aria'),
    }, NativeSessionPanel))
  } catch (error) {
    console.error('[dsh-remote-workspace] native main panel registration failed', error)
  }
}
