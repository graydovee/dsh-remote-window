/**
 * The connection methods the wizard's step 1 presents.
 *
 * Kept as a **pure module** (no React, no shell services) for two reasons:
 *
 *  - the acceptance criterion for step 1 is "ssh, plus wsl only on Windows, and
 *    no reserved/teaser card" — a list that can be asserted directly in a test,
 *    which a component table inside `wizard.tsx` cannot be (that file imports
 *    the shell's runtime module table, which this repository does not install);
 *  - visibility must be decided by the *shared* predicate the host validates
 *    `connect/start` with ({@link methodAvailable}), so "hidden on the client"
 *    and "refused on the host" cannot drift.
 */
import { methodAvailable } from '../targets/methods.ts'
import type { ConnectionMethod } from '../targets/methods.ts'

/**
 * Methods this wizard offers.
 *
 * Narrower than {@link ConnectionMethod} on purpose: the shared type still
 * carries the reserved container method, but the product's step 1 is ssh + wsl
 * only. A permanently disabled teaser card was removed (alpha55) — it was noise
 * in the one place the user compares real options.
 */
export type OfferedMethod = Exclude<ConnectionMethod, 'docker'>

/** Offered methods, in display order. */
export const OFFERED_METHODS: readonly OfferedMethod[] = ['ssh', 'wsl']

/**
 * The offered methods this host platform can actually run.
 * @param platform - the harness host's `process.platform` (`'win32'`, `'darwin'`, …).
 * @returns the methods to render as cards, in display order.
 */
export function offeredMethods(platform: string): OfferedMethod[] {
  return OFFERED_METHODS.filter(method => methodAvailable(method, platform))
}
