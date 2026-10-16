/**
 * The slot seat the vendored session rows render through.
 *
 * The shell passes its own `renderSlot` to its rows, which is how plugins
 * decorate a session row (leading dot, hover card, row actions). This plugin is
 * the host here, so the seat renders what our rows need and nothing else:
 *
 *  - `sidebar.session.row.leading` → the live dot for the session this device
 *    has open (the row is selected);
 *  - `sidebar.workspaces.session.menu.item` → the entries of the row's `⋮`
 *    menu. The official row builds the menu from this list, so ours has to
 *    supply at least one entry or the menu opens empty.
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

/** The dot our rows show for the session this device has open. */
export const LIVE_DOT = <StateDot state="ongoing" size={8} />

/**
 * Build the render seat for one row.
 * @param leading - content for the row's leading slot (our live dot), or null.
 * @param menu - the `⋮` menu entries for this row, or null for the blank row.
 * @returns the seat the vendored row expects.
 */
export function rowRenderSlots(leading: ReactElement | null, menu: ReactElement | null): PropsRenderSlots<RowSlotKey>['renderSlot'] {
  return ((key: string) => {
    if (key === 'sidebar.session.row.leading') return leading ?? null
    if (key === 'sidebar.workspaces.session.menu.item') return menu ?? null
    return null
  }) as PropsRenderSlots<RowSlotKey>['renderSlot']
}
