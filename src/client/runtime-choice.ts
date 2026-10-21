/**
 * Step 3's runtime choice, kept pure so the wizard's enablement rules and the
 * wire mapping are testable without React.
 *
 * Three outcomes, one model: reuse one of the dsh installs the scan found (the
 * list the user picks from), or deploy a **new** runtime and decide how it
 * travels (upload this machine's package, or download the release). The wire
 * still carries exactly one `ConnectRequest.packageSource`, so this module is
 * the only place that maps the UI model onto it.
 */
import type { DshCandidate } from './api.ts'

/** One picked runtime; `null` = nothing picked yet (连接 stays disabled). */
export type RuntimeChoice =
  | { readonly kind: 'reuse'; readonly path: string }
  | { readonly kind: 'upload' }
  | { readonly kind: 'download' }
  | null

/** The wire values a choice can produce (`connect-mode.ts` used to own this). */
export type ConnectPackageSource = 'reuse' | 'upload' | 'download'

/** A candidate that would actually work: verified runtime and executable. */
export function usableCandidate(candidates: readonly DshCandidate[], path: string): DshCandidate | undefined {
  return candidates.find(candidate => candidate.path === path && candidate.compatible && candidate.executable)
}

/**
 * Map the choice onto the request's `packageSource`.
 * @param choice - the wizard's current selection.
 * @returns the wire value, or undefined when nothing was chosen.
 */
export function packageSourceOf(choice: RuntimeChoice): ConnectPackageSource | undefined {
  return choice === null ? undefined : choice.kind
}

/**
 * The launcher a reuse choice names; undefined for a deploy choice.
 * @param choice - the wizard's current selection.
 */
export function reusePathOf(choice: RuntimeChoice): string | undefined {
  return choice !== null && choice.kind === 'reuse' ? choice.path : undefined
}

/**
 * Whether 连接 may start.
 *
 * A deploy choice is always ready: the pipeline probes the host itself, so a
 * failed scan does not block uploading or downloading. A reuse choice is ready
 * only while its candidate is still present and usable — a stale path after a
 * rescan must re-enable nothing.
 * @param choice - the current selection.
 * @param candidates - the scan's candidates.
 */
export function choiceReady(choice: RuntimeChoice, candidates: readonly DshCandidate[]): boolean {
  if (choice === null) return false
  if (choice.kind !== 'reuse') return true
  return usableCandidate(candidates, choice.path) !== undefined
}

/**
 * Reconcile the selection with a fresh scan.
 *
 * Keeps a still-usable reuse pick (and any deploy pick), otherwise preselects
 * the best candidate: an up-to-date plugin install first, then any usable one.
 * No usable candidate leaves the selection empty instead of inventing one.
 * @param candidates - the scan's candidates.
 * @param current - the selection before the scan.
 */
export function choiceFromScan(candidates: readonly DshCandidate[], current: RuntimeChoice): RuntimeChoice {
  if (current !== null && current.kind !== 'reuse') return current
  if (current !== null && usableCandidate(candidates, current.path) !== undefined) return current
  const best = candidates.find(candidate => candidate.compatible && candidate.executable && candidate.profile?.upToDate === true)
    ?? candidates.find(candidate => candidate.compatible && candidate.executable)
  return best === undefined ? null : { kind: 'reuse', path: best.path }
}
