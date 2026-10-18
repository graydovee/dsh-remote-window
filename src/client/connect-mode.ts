/**
 * How step 3's three-way choice maps onto the wire.
 *
 * `ConnectRequest.packageSource` is the only place the server-side provisioning
 * mode is expressed (architecture A3: no second, parallel "mode" concept), so the
 * card the user picks has to become exactly one wire value — and nothing else.
 * Pure module so the mapping is unit-testable: `store.ts` imports `react`, which
 * this repository does not install.
 */
import type { ConnectionMode } from './api.ts'

/** The `ConnectRequest.packageSource` values a card may produce. */
export type ConnectPackageSource = 'reuse' | 'upload' | 'download'

/**
 * Map one step-3 choice to the wire field.
 * @param mode - the selected card, or `''` while nothing is chosen.
 * @returns the package source, or undefined = follow the per-target/global policy.
 */
export function packageSourceOf(mode: '' | ConnectionMode): ConnectPackageSource | undefined {
  switch (mode) {
    case 'reuse': return 'reuse'
    case 'upload': return 'upload'
    case 'download': return 'download'
    default: return undefined
  }
}

/**
 * Whether a choice is complete enough to start a connection.
 *
 * Every mode is startable on its own except `reuse`, which also needs the
 * launcher the user picked from the scan (the host refuses `reuse` without it).
 * @param mode - the selected card.
 * @param reuseLauncherPath - the launcher chosen in the reuse panel.
 * @returns true when 连接 may be pressed.
 */
export function choiceReady(mode: '' | ConnectionMode, reuseLauncherPath: string): boolean {
  if (mode === '') return false
  if (mode === 'reuse') return reuseLauncherPath.trim() !== ''
  return true
}
