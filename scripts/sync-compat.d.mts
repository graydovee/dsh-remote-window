/**
 * Types for `sync-compat.mjs`.
 *
 * The script runs as plain Node (no TypeScript loader) and the release contract
 * test imports it to assert that the script and the plugin agree on how an
 * interval is written into `engines.dsh`; this declaration is what makes that
 * import type-safe.
 */
export interface CompatRangeLike {
  readonly min: string
  readonly max: string
}

export function rangeExpression(range: CompatRangeLike): string
