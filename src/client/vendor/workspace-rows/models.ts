/**
 * Type shapes the vendored row layer consumes.
 *
 * These mirror `ui-workspace`'s own models (`src/client/tree.ts`,
 * `src/client/contract/slots.ts`) but are declared here so the vendored files
 * never import a shell-internal module. Only what the row components actually
 * touch is declared; everything is plain data, so this plugin builds these
 * values from *remote* data (connections, remote workspaces, remote sessions)
 * with no shell service involved.
 */

/** Route descriptor for one shortcut, as the row shows it beside the row verb. */
export interface ShortcutCatalogEntry {
  readonly id: string
  readonly keys: readonly string[]
  readonly [key: string]: unknown
}

/** Menu open state shared with a row-menu entry (the row's `⋮` menu). */
export type MenuOpenState = readonly [open: boolean, setOpen: (open: boolean) => void]

/**
 * Pending user interaction kinds with dedicated row presentation.
 *
 * Remote sessions have no such state yet (the plugin does not observe
 * approvals/questions for them), so the field stays absent — but the vendored
 * status helper switches over the closed union and must see it.
 */
export type SessionPendingInteractionStatus = 'approval' | 'plan-review' | 'question'

/**
 * One top-level session row.
 *
 * `blank` is the provisional New Session row: the official renderer localizes
 * it and hides the row verbs, which is exactly the `新会话` row this plugin
 * renders under an expanded workspace.
 */
export interface SessionNode {
  readonly id: string
  /** Stored title, or empty (the renderer localizes blank and unnamed rows). */
  readonly title: string
  readonly blank: boolean
  /** A Session-scoped UI consumer is awaiting this user. */
  readonly pendingInteraction?: SessionPendingInteractionStatus
  readonly running: boolean
  readonly runningSubagentCount: number
  readonly completed: boolean
  readonly pinned: boolean
  readonly archived: boolean
  readonly updatedAt: number
}

/** One workspace row's facts (also used for the extra connection level). */
export interface GroupNode {
  readonly key: string
  /** Backing workspace id; absent marks a non-workspace group (our connection). */
  readonly workspaceId: string | undefined
  readonly cwd: string | undefined
  readonly createdAt: number | undefined
  readonly label: string
  readonly sessionCount: number
  readonly expanded: boolean
  /** Whether the group contains the selected session (active folder tint). */
  readonly containsCurrent: boolean
  readonly sessions: readonly SessionNode[]
}

/** One flat search row (declared for the vendored module's types; unused here). */
export interface SearchResultNode {
  readonly id: string
  readonly title: string
  readonly workspace: string
  readonly running: boolean
  readonly runningSubagentCount: number
  readonly completed: boolean
  readonly archived: boolean
  readonly snippet?: string
}

/** The locale seat the rows translate through. */
export type RowsTranslate = (key: string, params?: Record<string, unknown>) => string

/**
 * The slice of the browser's props the vendored file still names.
 *
 * Only the locale seat survives the rewrite, because every other prop it
 * referenced belongs to the browser shell this plugin does not vendor.
 */
export interface RowsProps {
  readonly t: RowsTranslate
}
