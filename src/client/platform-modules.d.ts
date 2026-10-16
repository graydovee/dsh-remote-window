/**
 * Local ambient declarations for the browser module table this client bundle
 * is built against.
 *
 * WHY THIS FILE EXISTS
 * The plugin's runtime imports (`react`, `react/jsx-runtime`) and the two
 * allowed value-import packages (`@deepseek-ai/dsh-client-ui-slots`,
 * `@deepseek-ai/dsh-client-ui-primitives`) are resolved at RUNTIME through
 * `window.__ModuleLoader__`'s module table — they are deliberately NOT
 * dependencies of this repository (see `tsdown.config.mjs`: only the platform
 * module table is external, everything else is inlined). They are therefore
 * absent from `node_modules`, and `tsc --noEmit` would report TS2307 for every
 * import. This file supplies the minimal, *permissive* shapes those modules
 * expose so the client half type-checks in this repository.
 *
 * It is a stand-in, not the contract: the authoritative types live in the DSH
 * checkout (`packages/client/ui-primitives/src/index.ts`,
 * `packages/client/ui-slots/src/index.ts`, `@types/react`). If the real
 * packages are ever installed, DELETE this file — the ambient declarations
 * would then collide with the real ones.
 *
 * Only what `src/client/**` actually uses is declared; primitive props are
 * intentionally loose (`[key: string]: any`) so shell-native attributes
 * (`data-*`, `aria-*`, event handlers) pass through unchecked.
 */

/* -------------------------------------------------------------------------
 * react
 * ---------------------------------------------------------------------- */

declare module 'react-dom/client' {
  /** One mounted React root (the sidebar-section host owns one of these). */
  export interface Root {
    render(children: unknown): void
    unmount(): void
  }
  export function createRoot(container: Element | DocumentFragment): Root
}

declare module 'react-dom' {
  export function createPortal(children: unknown, container: Element | DocumentFragment, key?: string | null): any
}

declare module 'react' {
  export type Key = string | number

  /** Minimal element shape; only enough for `ReactNode` composition. */
  export interface ReactElement {
    type: unknown
    props: unknown
    key: Key | null
  }

  export type ReactNode =
    | ReactElement
    | string
    | number
    | boolean
    | null
    | undefined
    | Iterable<ReactNode>

  /** Inline-style record; custom `--dsh-*` properties are allowed. */
  export interface CSSProperties {
    [property: string]: string | number | undefined
  }

  export interface MutableRefObject<T> {
    current: T
  }

  export interface RefObject<T> {
    readonly current: T | null
  }

  export type Ref<T> = ((instance: T | null) => void) | MutableRefObject<T | null> | null

  /** Change event as this plugin consumes it (inputs and checkboxes). */
  export interface ChangeEvent<T = Element> {
    target: T & { value: string; checked: boolean }
    currentTarget: T
    preventDefault(): void
    stopPropagation(): void
  }

  /** Keyboard event as this plugin consumes it (Enter/Escape handling). */
  export interface KeyboardEvent<T = Element> {
    key: string
    shiftKey: boolean
    ctrlKey: boolean
    altKey: boolean
    metaKey: boolean
    repeat: boolean
    defaultPrevented: boolean
    target: T
    currentTarget: T
    preventDefault(): void
    stopPropagation(): void
  }

  /** Mouse event as this plugin consumes it. */
  export interface MouseEvent<T = Element> {
    button: number
    target: T
    currentTarget: T
    preventDefault(): void
    stopPropagation(): void
  }

  export type SetStateAction<S> = S | ((previous: S) => S)
  export type Dispatch<A> = (value: A) => void

  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>]
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function useMemo<T>(factory: () => T, deps?: readonly unknown[]): T
  export function useCallback<T>(callback: T, deps?: readonly unknown[]): T
  export function useRef<T>(initial: T): MutableRefObject<T>
  export function useRef<T>(initial: T | null): MutableRefObject<T | null>
  export function useSyncExternalStore<S>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => S,
    getServerSnapshot?: () => S,
  ): S

  export const Fragment: (props: { children?: ReactNode }) => ReactElement
}

/* -------------------------------------------------------------------------
 * react/jsx-runtime — the automatic JSX entry (`jsx: react-jsx`)
 * ---------------------------------------------------------------------- */

declare module 'react/jsx-runtime' {
  export namespace JSX {
    interface Element {
      type: unknown
      props: unknown
      key: string | number | null
    }
    interface ElementClass {
      render(): unknown
    }
    interface ElementAttributesProperty {
      props: unknown
    }
    interface ElementChildrenAttribute {
      children: unknown
    }
    interface IntrinsicAttributes {
      key?: string | number | null
    }
    /** Intrinsic tags accept every attribute; the shell owns their real props. */
    interface IntrinsicElements {
      [elementName: string]: any
    }
  }

  export const Fragment: any
  export function jsx(type: any, props: any, key?: any): JSX.Element
  export function jsxs(type: any, props: any, key?: any): JSX.Element
  export function jsxDEV(type: any, props: any, key?: any, isStatic?: any, source?: any, self?: any): JSX.Element
}

/* -------------------------------------------------------------------------
 * @deepseek-ai/dsh-client-ui-primitives
 * ---------------------------------------------------------------------- */

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { CSSProperties, ReactNode } from 'react'

  export interface IconProps {
    size?: number | undefined
    className?: string | undefined
  }

  export type IconComponent = (props: IconProps) => any

  export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'toolbar'

  export function Button(props: {
    variant?: ButtonVariant
    size?: 'md' | 'sm'
    icon?: ReactNode
    className?: string | undefined
    children?: ReactNode
    [attribute: string]: any
  }): any

  export function Input(props: { icon?: ReactNode; className?: string | undefined; [attribute: string]: any }): any

  export function Checkbox(props: { [attribute: string]: any }): any
  export function Switch(props: { [attribute: string]: any }): any

  /**
   * Official top-center toast: portals to `document.body`, slides in (160ms),
   * holds `holdMs` (default 3000), fades out (1s), then calls `onDone` —
   * `onDone` is the only dismissal signal.
   */
  export function Toast(props: {
    text: string
    icon?: ReactNode
    /** 'success' renders the built-in green check and ignores `icon`. */
    tone?: 'success'
    anchor?: HTMLElement | null
    holdMs?: number
    actions?: readonly { label: string; prefix?: string; onClick: () => void }[]
    onDone: () => void
  }): any

  export const IconWarningOutlineRegular: IconComponent

  export interface SegmentedControlOption<Value extends string> {
    value: Value
    label: string
    disabled?: boolean
    title?: string
  }

  export function SegmentedControl<Value extends string>(props: {
    id: string
    value: Value
    options: readonly SegmentedControlOption<Value>[]
    onChange: (next: Value) => void
    label: string
    disabled?: boolean
    className?: string | undefined
  }): any

  export interface SegmentedTab<Value extends string = string> {
    value: Value
    label: ReactNode
    id: string
    panelId: string
  }

  export function SegmentedTabs<Value extends string>(props: {
    items: readonly [SegmentedTab<Value>, ...SegmentedTab<Value>[]]
    value: Value
    onChange: (value: Value) => void
    label: string
    className?: string | undefined
  }): any

  export interface MenuItem {
    id: string
    label: ReactNode
    disabled?: boolean
    icon?: ReactNode
    danger?: boolean
    submenu?: readonly MenuItem[]
  }
  export interface MenuSeparator {
    type: 'separator'
    id: string
  }
  export interface MenuLabel {
    type: 'label'
    id: string
    text: string
  }
  export type MenuEntry = MenuItem | MenuSeparator | MenuLabel

  export function Menu(props: {
    open: boolean
    anchor: ReactNode
    items?: readonly MenuEntry[]
    children?: ReactNode
    footer?: readonly MenuEntry[]
    selectedId?: string | undefined
    selectedIds?: readonly string[] | undefined
    onSelect?: (id: string) => void
    onClose: () => void
    align?: 'start' | 'end'
    side?: 'bottom' | 'top' | 'right'
    portal?: boolean
    closeOnPointerLeave?: boolean
    dense?: boolean
    compact?: boolean
    autoFocus?: boolean
    selection?: 'check' | 'fill'
    className?: string | undefined
    listClassName?: string | undefined
  }): any

  export interface MenuItemButtonProps {
    children: ReactNode
    icon?: ReactNode
    disabled?: boolean
    danger?: boolean
    separatorBefore?: boolean
    onSelect: () => void
    [attribute: string]: any
  }

  export function MenuItemButton(props: MenuItemButtonProps): any

  export interface MenuSurfaceProps {
    compact?: boolean
    className?: string | undefined
    style?: CSSProperties
    children?: ReactNode
    [attribute: string]: any
  }

  export function MenuSurface(props: MenuSurfaceProps): any

  export function Modal(props: {
    open: boolean
    onClose: () => void
    title: string
    closeLabel?: string
    description?: string
    children?: ReactNode
    footer?: ReactNode
    className?: string | undefined
    contentClassName?: string | undefined
    backdropBlur?: boolean
    headless?: boolean
    [attribute: string]: any
  }): any

  export function Pill(props: {
    active?: boolean
    className?: string | undefined
    children?: ReactNode
    [attribute: string]: any
  }): any

  export type TagTone = 'outline' | 'solid' | 'neutral' | 'quiet' | 'success' | 'info' | 'warning' | 'danger'

  export function Tag(props: { tone?: TagTone; className?: string | undefined; children?: ReactNode }): any

  /** Official relative-time formatter (unit + count) used by the row time column. */
  export function relativeTime(at: number, now: number): { unit: 'now' | 'minutes' | 'hours' | 'days' | 'months' | 'years'; n: number }

  export type StateDotState = 'done' | 'warning' | 'ongoing' | 'error' | 'idle'

  export function StateDot(props: {
    state: StateDotState
    size?: number | undefined
    className?: string | undefined
    appearance?: 'dot' | 'step'
  }): any

  export function PathLabel(props: { path: string; className?: string | undefined; [attribute: string]: any }): any

  export function HoverCard(props: { [attribute: string]: any }): any

  export type TooltipSide = 'right' | 'bottom' | 'top'

  export function Tooltip(props: {
    label: string | (() => string)
    side?: TooltipSide
    align?: 'center' | 'end'
    disabled?: boolean
    portal?: boolean
    children: any
    [attribute: string]: any
  }): any

  export interface DisclosureRowProps {
    icon: ReactNode
    title: string
    open: boolean
    expandable: boolean
    onToggle: () => void
    running?: boolean | undefined
    expandOnRowClick?: boolean | undefined
    collapsedContent?: ReactNode
    children?: ReactNode
    className?: string | undefined
    contentClassName?: string | undefined
  }

  export function DisclosureRow(props: DisclosureRowProps): any

  /* Icons actually used by this plugin (the module re-exports the full set). */
  export const IconGlobeOutlineRegular: IconComponent
  export const IconChevronDownOutlineRegular: IconComponent
  export const IconChevronLeftOutlineRegular: IconComponent
  export const IconChevronRightOutlineRegular: IconComponent
  export const IconPlusOutlineRegular: IconComponent
  export const IconRefreshOutlineRegular: IconComponent
  export const IconCloseOutlineRegular: IconComponent
  export const IconCheckCircleFillRegular: IconComponent
  export const IconWarningTriangleOutlineRegular: IconComponent
  export const IconFolderCloseRegular: IconComponent
  export const IconFolderOpenRegular: IconComponent
  export const IconDeliverDocRegular: IconComponent
  export const IconWorkspaceTreeOutlineRegular: IconComponent
  export const IconLinkOutlineRegular: IconComponent
  export const IconEllipsisOutlineRegular: IconComponent
  export const IconArchiveOutlineRegular: IconComponent
  export const IconEditOutlineRegular: IconComponent
  export const IconNewChatOutlineRegular: IconComponent
  export const IconPinFillRegular: IconComponent
  export const IconTrashOutlineRegular: IconComponent
  export const IconTriangleRightFillRegular: IconComponent
  export const IconUnarchiveOutlineRegular: IconComponent
}


/* -------------------------------------------------------------------------
 * @deepseek-ai/dsh-client-ui-slots
 * The slot *service* arrives through `ctx.slots`; only the render-seat types are
 * imported by value-free code (the vendored rows take one as a prop).
 * ---------------------------------------------------------------------- */

declare module '@deepseek-ai/dsh-client-ui-slots' {
  export type RenderSlotFn<Key extends string> = (key: Key, owner?: unknown, options?: unknown) => unknown
  export type PropsRenderSlots<S extends string> = {
    renderSlot: RenderSlotFn<S>
    readonly __renders?: ((key: S) => void) | undefined
  }
}
