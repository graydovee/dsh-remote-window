/**
 * The connection methods the v3 connect dialog's step 1 presents.
 *
 * Kept as a **pure module** (no React, no shell services) for two reasons:
 *
 *  - the acceptance criterion for step 1 is "ssh only, and no reserved/teaser
 *    card" — a list that can be asserted directly in a test, which a component
 *    table inside `remote-dialogs.tsx` cannot be (that file imports the shell's
 *    runtime module table, which this repository does not install);
 *  - visibility must be decided by the *shared* predicate the host validates
 *    `connect/start` with ({@link methodAvailable}), so "hidden on the client"
 *    and "refused on the host" cannot drift.
 */
import { methodAvailable } from '../targets/methods.ts'
import type { ConnectionMethod } from '../targets/methods.ts'

/**
 * Methods this dialog offers.
 *
 * Narrower than {@link ConnectionMethod} on purpose: the shared type still
 * carries the reserved container method and the not-yet-transportable WSL
 * method, while the product's step 1 offers SSH only. WSL is deliberately
 * absent even on `win32` until `WSL_TRANSPORT_ENABLED` (in
 * `src/targets/methods.ts`) has an implemented host connector + forwarder;
 * then it is added back here, and the dialog's metadata table already carries
 * its label keys.
 */
export type OfferedMethod = Exclude<ConnectionMethod, 'docker'>

/** Offered methods, in display order. */
export const OFFERED_METHODS: readonly OfferedMethod[] = ['ssh']

/**
 * The offered methods this host platform can actually run.
 *
 * Today that is `['ssh']` everywhere: `methodAvailable` returns false for WSL
 * until its transport exists, and for the reserved container method on every
 * platform. Keeping the filter means the dialog never needs a second gate when
 * a method becomes available.
 * @param platform - the harness host's `process.platform` (`'win32'`, `'darwin'`, …).
 * @returns the methods to render as cards, in display order.
 */
export function offeredMethods(platform: string): OfferedMethod[] {
  return OFFERED_METHODS.filter(method => methodAvailable(method, platform))
}
