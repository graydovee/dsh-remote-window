/**
 * Vendored official workspace rows, plus the shims they need.
 *
 * Public surface: the two row components (`ProjectRowItem`, `SessionNodeItem`)
 * and the animate-exit wrapper. Everything else is internal support.
 */
export { ProjectRowItem, SessionNodeItem } from './generated/Rows.tsx'
export { AnimatedRows } from './generated/AnimatedRows.tsx'
export { ROW_STYLES } from './generated/row-styles.ts'
export { rowsTranslate } from './translate.ts'
export { rowRenderSlots, LIVE_DOT } from './render-slot.tsx'
export type { GroupNode, SessionNode, RowsTranslate } from './models.ts'
