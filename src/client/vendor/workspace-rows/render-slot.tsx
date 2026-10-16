/**
 * The slot seat the vendored session rows render through.
 *
 * The shell passes its own `renderSlot` to its rows, which is how plugins
 * decorate a session row (leading dot, hover buttons, `⋮` menu entries). This
 * plugin is the host here, so the seat renders what our rows need:
 *
 *  - `sidebar.session.row.leading` → the live dot for the session this device
 *    has open;
 *  - `sidebar.session.row.action` → the hover buttons at the row's right edge;
 *  - `sidebar.workspaces.session.menu.item` → the entries of the row's `⋮` menu
 *    (the official row builds that menu from this list).
 */
import type { ReactElement } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'

/** Slot keys the vendored session row asks for. */
type RowSlotKey =
  | 'sidebar.workspaces.session.menu.item'
  | 'sidebar.workspaces.session.row.action'
  | 'sidebar.session.row.leading'
  | 'sidebar.session.row.hover'

/** What one row's seat renders. */
export interface RowSlotContent {
  /** Leading slot content (our live dot), or null. */
  readonly leading: ReactElement | null
  /**
   * Builds the `⋮` menu entries. The row passes its own open-state setter, which
   * every entry must call when it acts — the official entries do exactly that
   * through this hook, and an entry that acts without dismissing leaves a
   * dangling menu on screen (the defect this signature exists to prevent).
   */
  readonly menu: ((close: () => void) => ReactElement | null) | null
  /** Hover buttons, or null. */
  readonly actions: ReactElement | null
}

/** The dot our rows show for the session this device has open. */
export const LIVE_DOT = <StateDot state="ongoing" size={8} />

/**
 * Build the render seat for one row.
 * @param content - the leading/menu/actions share for this row.
 * @returns the seat the vendored row expects.
 */
export function rowRenderSlots(content: RowSlotContent): PropsRenderSlots<RowSlotKey>['renderSlot'] {
  return ((key: string, _owner?: unknown, options?: { readonly hookContext?: unknown }) => {
    if (key === 'sidebar.session.row.leading') return content.leading
    if (key === 'sidebar.workspaces.session.row.action') return content.actions
    if (key === 'sidebar.workspaces.session.menu.item') {
      const hook = options?.hookContext as readonly [boolean, (open: boolean) => void] | undefined
      return content.menu?.(() => { hook?.[1](false) }) ?? null
    }
    return null
  }) as PropsRenderSlots<RowSlotKey>['renderSlot']
}
