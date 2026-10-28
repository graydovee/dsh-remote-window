/**
 * Browser half of `dsh-remote-workspace` (v3).
 *
 * Contributions, all through the shipped client slots so hot reload disposes
 * them with the plugin fiber:
 *
 *  - the floating **target rail** (mounted by {@link mountTargetRail}) — saved
 *    connections, their live phase, switching the full-screen frame and the
 *    connection dialogs. It is the only client chrome left;
 *  - one keyed `main` panel for the full-screen official DSH UI of the
 *    connected target (portal iframe, `SERVER_MAIN_ID`). The client shell's own
 *    sidebar yields while the frame is mounted, so the official sidebar/header/
 *    right sidebar are the navigation.
 *
 * The v2 native conversation renderer (`session-main.tsx`, vendored composer/
 * header/tool components) is retained in the tree but no longer registered or
 * mounted; it is deleted after v3 acceptance (the plan's cleanup phase).
 */
import type { ClientContext } from './context.ts'
import { t } from './locales.ts'
import { bindServerMainContext, ServerMainPanel, SERVER_MAIN_ID } from './portal-main.tsx'
import { mountTargetRail } from './rail.tsx'
import { bindRemoteStoreContext, disposeRemoteStore, loadRemoteState } from './remote-store.ts'
import { ensureStyles } from './styles.ts'

/** Client services this plugin needs: `slots` only. */
export const inject = ['slots']

/**
 * Plugin body: stylesheet, the floating target rail, the P3 state stream and
 * the full-screen official-UI main panel.
 * @param ctx - the client context.
 */
export function apply(ctx: ClientContext): void {
  bindRemoteStoreContext(ctx)
  bindServerMainContext(ctx)
  ctx.effect(() => ensureStyles(), 'dsh-remote-workspace: stylesheet')
  // The floating target rail is the only client chrome while the official UI
  // owns the main area; it stays mounted across sidebar re-renders.
  ctx.effect(() => mountTargetRail(), 'dsh-remote-workspace: target rail')
  // v1 remote tree: one P3 snapshot for the rail; sessions/workspaces still
  // load for connection facts but are rendered by the server's official UI.
  void loadRemoteState()
  ctx.effect(() => () => { disposeRemoteStore() }, 'dsh-remote-workspace: remote store lifetime')

  // One keyed main entry: the full-screen official DSH UI served through the
  // same-origin portal. The v2 native conversation panel is not registered.
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
