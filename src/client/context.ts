/**
 * Structural face of the Cordis client context this plugin is applied with.
 *
 * Deliberately NOT `import type { Context } from 'cordis'` + declaration
 * merging: the browser context composes members from many client packages and
 * this repository does not install them (they resolve through the runtime
 * module table, see `platform-modules.d.ts`). Declaring the two members the
 * plugin actually uses keeps the client half self-contained and independent of
 * another package's internal service types.
 */
import type { ReactNode } from 'react'

/** One slot registration. Shape mirrors `slots.register(options, component)`. */
export interface SlotRegistrationOptions {
  /** Slot name declared by the shipped owner (`sidebar.footer.action`, `shell.overlay`, …). */
  name: string
  /** Cell id for list slots (a fresh id sits beside the shipped entries). */
  id?: string
  /** Position among the entries, ascending. */
  order?: number
  /** Display text where the owner projects one. */
  label?: string | (() => string)
  /** Main-panel registry key (`main` slot): the id `layout.selectPanel` expects. */
  key?: string
  /** Locale namespace for label resolution by the owning shell. */
  locale?: string
  /** Diagnostics stamp shown by slot occupancy errors. */
  registrant?: string
  /** Shadowing priority (lowest renders). */
  priority?: number
}

/** The `slots` client service, as this plugin consumes it. */
export interface SlotsService {
  /**
   * Install an effect for each declaration lifetime of a slot.
   * @param key - declared slot key to depend on.
   * @param callback - creates the contribution's disposer(s).
   * @returns an idempotent disposer for the wait and the active contribution.
   */
  inject(key: string, callback: () => (() => void) | Iterable<() => void>): () => void

  /**
   * Contribute a component to a declared slot.
   * @param options - registration options (kind shape fields included).
   * @param component - the contributed component.
   * @returns the disposer removing the contribution.
   */
  register(options: SlotRegistrationOptions, component: (props: any) => ReactNode): () => void
}

/** The subset of the Cordis client context this plugin's `apply` needs. */
export interface ClientContext {
  readonly slots: SlotsService
  /**
   * Resolve a service by name on the browser context. Only used for
   * shell-owned singletons we merely *talk to* (e.g. `uiWorkspace` to reveal
   * an opened session); anything typed belongs in this interface instead.
   */
  get(name: string): unknown
  /**
   * Run `body` inside the caller's fiber and dispose its result with the
   * plugin (hot-reload safe).
   * @param body - setup body returning a disposer (or nothing).
   * @param label - diagnostics label.
   * @returns the disposer of the effect itself.
   */
  effect(body: () => void | (() => void) | Iterable<() => void>, label?: string): () => void
}
