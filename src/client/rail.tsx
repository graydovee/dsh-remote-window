/**
 * The floating **target rail** — the only client chrome beside the dialogs.
 *
 * The v3 main area is the server's complete official UI, so the client stops
 * duplicating its sidebar workspace/session tree. What remains is a narrow,
 * collapsed-by-default rail that lists saved targets, shows their live phase
 * and switches the full-screen frame between them. Hover or `Alt+R` expands it
 * (the official rail rule in the refactor plan); every action still goes
 * through `remote-store` and the existing connection dialogs.
 */
import { useEffect, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  IconChevronDownOutlineRegular, IconChevronLeftOutlineRegular,
  IconPlusOutlineRegular, IconRefreshOutlineRegular, IconWarningTriangleOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { NoticeToastHost } from './common.tsx'
import { t } from './locales.ts'
import {
  activateRemoteTarget, connectRemoteTarget, disconnectRemoteTarget, dismissRemoteNotice,
  loadRemoteState, openConnectDialog, refreshAllRemote, requestForgetTarget, useRemoteAppState,
} from './remote-store.ts'
import type { RemoteConnectionView } from './remote-store.ts'
import { RemoteDialogs } from './remote-dialogs.tsx'
import { useServerMainRequest } from './portal-main.tsx'

/** Marker attribute for the body-level rail host (idempotent mounting). */
export const TARGET_RAIL_ATTR = 'data-dsh-remote-window-rail'

/** Keyboard shortcut that pins the rail open (`Alt+R`). */
export const RAIL_SHORTCUT = 'r'

/** Screen edge the rail is docked to after a drag (or automatically). */
export type RailDock = 'left' | 'right' | 'top' | 'bottom'

/** Snapped rail position: docked edge plus a pixel offset along it. */
export interface RailPlacement {
  readonly dock: RailDock
  /** For left/right: distance from the viewport top. For top/bottom: from the left edge. */
  readonly offset: number
}

/** Gap between the rail and the screen edge. */
export const RAIL_MARGIN = 10

/** Collapsed rail thickness (side width / bar height). */
export const RAIL_COMPACT_SIZE = 44

/** Expanded vertical rail width. */
export const RAIL_SIDE_WIDTH = 280

/** `localStorage` key that remembers the user's chosen dock across remounts. */
export const RAIL_DOCK_STORAGE_KEY = 'dsh-remote-window.rail-dock'

/** Pointer travel that turns a press into a drag instead of a click. */
const RAIL_DRAG_THRESHOLD = 4

/** The subset of a React pointer event the drag start needs. */
interface RailPointerDown {
  readonly button: number
  readonly clientX: number
  readonly clientY: number
  readonly pointerId: number
}

/** Collapsed width of one bar chip, used to size the horizontal rail. */
const RAIL_BAR_CHIP_WIDTH = 34

const RAIL_DOCKS: readonly RailDock[] = ['left', 'right', 'top', 'bottom']

/** Clamp a value into `[min, max]` (max may fall below min on tiny viewports). */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)))
}

/** Width of a collapsed horizontal rail: one 34px chip per target plus padding. */
export function railBarWidth(targetCount: number): number {
  return Math.max(RAIL_COMPACT_SIZE, targetCount * RAIL_BAR_CHIP_WIDTH + 12)
}

/**
 * The collapse toggle only exists on a collapsed rail that actually has
 * something to fold: two or more connections and no active expansion.
 */
/**
 * The collapse toggle is offered whenever there is more than one connection to
 * fold away. It is rendered inside the rail card but *outside* the hover group
 * that expands the rail, so reaching it never fires the hover-expand (which
 * used to reflow the strip under the pointer and flicker the button away).
 */
export function railShowsToggle(expanded: boolean, minimized: boolean, targetCount: number): boolean {
  return !expanded && !minimized && targetCount > 1
}

/** Position/size overrides the rail needs for its current dock and state. */
export interface RailBoxStyle {
  [property: string]: number | undefined
  left?: number
  top?: number
  right?: number
  bottom?: number
  width?: number
  maxHeight?: number
}

/**
 * Inline box style for the rail at a dock.
 *
 * Collapsed: a compact strip along the docked edge (top/bottom bars are wide
 * enough for one glyph per target). Expanded: always the same vertical list
 * (CSS sets the 280px width), anchored to the same edge and limited to the
 * viewport height so the list scrolls instead of running off screen.
 */
export function railBoxStyle(
  placement: RailPlacement,
  expanded: boolean,
  targetCount: number,
  viewport: { readonly width: number; readonly height: number },
  minimized = false,
): RailBoxStyle {
  if (placement.dock === 'left') return { left: RAIL_MARGIN, top: placement.offset }
  if (placement.dock === 'right') return { right: RAIL_MARGIN, top: placement.offset }

  if (expanded) {
    const left = clamp(placement.offset, RAIL_MARGIN, viewport.width - RAIL_MARGIN - RAIL_SIDE_WIDTH)
    const maxHeight = Math.max(RAIL_COMPACT_SIZE, viewport.height - RAIL_MARGIN * 2)
    return placement.dock === 'top'
      ? { top: RAIL_MARGIN, left, maxHeight }
      : { bottom: RAIL_MARGIN, left, maxHeight }
  }

  // Minimized bars shrink to a single +N glyph; otherwise the collapsed strip
  // reserves one glyph slot for the collapse toggle when it is visible.
  const width = minimized
    ? RAIL_COMPACT_SIZE
    : railBarWidth(targetCount + (targetCount > 1 ? 1 : 0))
  const left = clamp(placement.offset, RAIL_MARGIN, viewport.width - RAIL_MARGIN - width)
  return placement.dock === 'top'
    ? { top: RAIL_MARGIN, left, width }
    : { bottom: RAIL_MARGIN, left, width }
}

/** Pick the screen edge closest to the pointer. */
export function nearestRailDock(
  pointer: { readonly x: number; readonly y: number },
  viewport: { readonly width: number; readonly height: number },
): RailDock {
  const distances: Array<[RailDock, number]> = [
    ['left', pointer.x],
    ['right', viewport.width - pointer.x],
    ['top', pointer.y],
    ['bottom', viewport.height - pointer.y],
  ]
  let best: [RailDock, number] = distances[0]!
  for (const candidate of distances.slice(1)) {
    if (candidate[1] < best[1]) best = candidate
  }
  return best[0]
}

/**
 * Snap a free position to the nearest edge.
 *
 * Left/right docks keep the collapsed vertical column and offset along Y;
 * top/bottom docks become the horizontal bar and offset along X.
 * @param pointer - final pointer position in viewport coordinates.
 * @param viewport - current viewport size in CSS pixels.
 * @returns the dock and the clamped edge offset.
 */
export function snapRailPlacement(
  pointer: { readonly x: number; readonly y: number },
  viewport: { readonly width: number; readonly height: number },
): RailPlacement {
  const dock = nearestRailDock(pointer, viewport)
  if (dock === 'left' || dock === 'right') {
    return {
      dock,
      offset: clamp(
        pointer.y - RAIL_COMPACT_SIZE / 2,
        RAIL_MARGIN,
        viewport.height - RAIL_COMPACT_SIZE - RAIL_MARGIN,
      ),
    }
  }
  return {
    dock,
    offset: clamp(
      pointer.x - RAIL_COMPACT_SIZE / 2,
      RAIL_MARGIN,
      viewport.width - RAIL_COMPACT_SIZE - RAIL_MARGIN,
    ),
  }
}

/** Keep an already-snapped placement inside the current viewport. */
export function clampRailPlacement(
  placement: RailPlacement,
  viewport: { readonly width: number; readonly height: number },
): RailPlacement {
  if (viewport.width <= 0 || viewport.height <= 0) return placement
  if (placement.dock === 'left' || placement.dock === 'right') {
    return {
      dock: placement.dock,
      offset: clamp(
        placement.offset,
        RAIL_MARGIN,
        viewport.height - RAIL_COMPACT_SIZE - RAIL_MARGIN,
      ),
    }
  }
  return {
    dock: placement.dock,
    offset: clamp(
      placement.offset,
      RAIL_MARGIN,
      viewport.width - RAIL_COMPACT_SIZE - RAIL_MARGIN,
    ),
  }
}

function isRailDock(value: unknown): value is RailDock {
  return typeof value === 'string' && (RAIL_DOCKS as readonly string[]).includes(value)
}

function readStoredPlacement(): RailPlacement | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = window.localStorage.getItem(RAIL_DOCK_STORAGE_KEY)
    if (raw === null) return undefined
    const value = JSON.parse(raw) as Partial<RailPlacement>
    if (isRailDock(value.dock) && typeof value.offset === 'number' && Number.isFinite(value.offset)) {
      return { dock: value.dock, offset: Math.max(RAIL_MARGIN, value.offset) }
    }
  } catch {
    // Storage may be unavailable (private mode) — fall back to the default dock.
  }
  return undefined
}

function storePlacement(placement: RailPlacement): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RAIL_DOCK_STORAGE_KEY, JSON.stringify(placement))
  } catch {
    // Ignore storage failures; the dock simply resets on remount.
  }
}

function viewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 0, height: 0 }
  return { width: window.innerWidth, height: window.innerHeight }
}

/** Default dock: a tall-centred column on the left edge. */
const DEFAULT_PLACEMENT: RailPlacement = { dock: 'left', offset: 96 }

/** Live viewport size, re-read on window resizes (0×0 outside a document). */
function useViewport(): { readonly width: number; readonly height: number } {
  const [size, setSize] = useState(viewportSize)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = (): void => { setSize(viewportSize()) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

/** Short label shown in collapsed mode: first visible character of the name. */
function initialOf(label: string): string {
  const trimmed = label.trim()
  const first = [...trimmed][0]
  return first === undefined ? '?' : first.toUpperCase()
}

/** Connected when the host reports a ready/degraded profile. */
function isConnected(view: RemoteConnectionView): boolean {
  const phase = view.connection?.phase
  return phase === 'ready' || phase === 'degraded'
}

/** One target chip: compact glyph + expanded label/actions. */
function TargetChip(props: {
  view: RemoteConnectionView
  active: boolean
  pinned: boolean
}): ReactElement {
  const { view, active, pinned } = props
  const connected = isConnected(view)
  const phase = view.connection?.phase ?? (view.target.status === 'ready' ? 'ready' : 'stopped')
  const failed = view.connection?.error !== undefined || view.error !== undefined
  const endpoint = view.target.kind === 'wsl'
    ? (view.target.wslDistro ?? view.target.host)
    : `${view.target.username}@${view.target.host}`
  return (
    <div
      className="dsh-rw-rail-target"
      data-active={active ? 'true' : undefined}
      data-connected={connected ? 'true' : undefined}
      data-phase={phase}
      data-pinned={pinned ? 'true' : undefined}
    >
      <button
        type="button"
        className="dsh-rw-rail-main"
        aria-label={t('rail.activate', { label: view.target.label })}
        title={connected ? t('rail.activate', { label: view.target.label }) : t('rail.connect', { label: view.target.label })}
        onClick={() => { void activateRemoteTarget(view.target.id) }}
      >
        <span className="dsh-rw-rail-glyph" aria-hidden="true">
          {view.connecting ? <span className="dsh-rw-rail-spinner" /> : initialOf(view.target.label)}
        </span>
        <span className="dsh-rw-rail-label">
          <span className="dsh-rw-rail-name">{view.target.label}</span>
          <span className="dsh-rw-rail-meta">
            {failed && <IconWarningTriangleOutlineRegular size={11} />}
            {`${endpoint} · ${t(`remote.phase.${phase}` as Parameters<typeof t>[0])}`}
          </span>
        </span>
      </button>
      <span className="dsh-rw-rail-actions">
        <button
          type="button"
          className="dsh-rw-rail-action"
          disabled={view.connecting}
          title={connected ? t('list.stop') : t('list.reconnect')}
          aria-label={connected ? t('list.stop') : t('list.reconnect')}
          onClick={() => {
            void (connected ? disconnectRemoteTarget(view.target.id) : connectRemoteTarget(view.target.id))
          }}
        >
          {t(connected ? 'rail.disconnect' : 'rail.connectShort')}
        </button>
        <button
          type="button"
          className="dsh-rw-rail-action"
          title={t('tree.forgetConnection')}
          aria-label={t('tree.forgetConnection')}
          onClick={() => requestForgetTarget(view.target.id)}
        >
          {t('rail.forget')}
        </button>
      </span>
    </div>
  )
}

/** The rail surface, including the dialogs it owns. */
export function TargetRail(): ReactElement {
  const state = useRemoteAppState()
  const active = useServerMainRequest()
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  // Minimized collapses the whole strip to a single +N button; hover no longer
  // expands it until the user clicks that button again.
  const [minimized, setMinimized] = useState(false)
  const expanded = !minimized && (pinned || hovered)
  const portalActive = active !== undefined
  // Placement and drag live in the rail itself: the host div only provides the
  // fixed viewport layer (pointer-events: none) so every screen pixel can be a
  // drop target without blocking the client shell underneath.
  const [placement, setPlacement] = useState<RailPlacement>(
    () => clampRailPlacement(readStoredPlacement() ?? DEFAULT_PLACEMENT, viewportSize()),
  )
  const [userDocked, setUserDocked] = useState(() => readStoredPlacement() !== undefined)
  const [drag, setDrag] = useState<{ readonly x: number; readonly y: number } | null>(null)
  const viewport = useViewport()
  const dragSession = useState(() => ({
    startX: 0,
    startY: 0,
    pointerId: undefined as number | undefined,
    moved: false,
    suppressClick: false,
  }))[0]

  useEffect(() => {
    if (typeof document === 'undefined') return
    const host = document.querySelector(`[${TARGET_RAIL_ATTR}]`)
    if (host === null) return
    if (portalActive) host.setAttribute('data-portal', 'true')
    else host.removeAttribute('data-portal')
  }, [portalActive])

  // Before the user ever drags the rail, opening the full-screen official UI
  // docks it right (the official sidebar owns the left edge); a manual dock
  // always wins over this default.
  useEffect(() => {
    if (!portalActive || userDocked) return
    const size = viewportSize()
    if (size.width <= 0 || size.height <= 0) return
    setPlacement(current => current.dock === 'right'
      ? current
      : {
          dock: 'right',
          offset: Math.max(RAIL_MARGIN, Math.round((size.height - RAIL_COMPACT_SIZE) / 2)),
        })
  }, [portalActive, userDocked])

  // Shrinking the window must never strand the rail off-screen.
  useEffect(() => {
    if (viewport.width <= 0 || viewport.height <= 0) return
    setPlacement(current => clampRailPlacement(current, viewport))
  }, [viewport.width, viewport.height])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === RAIL_SHORTCUT) {
        event.preventDefault()
        // The shortcut is the keyboard escape hatch from a minimized rail.
        setMinimized(false)
        setPinned(value => !value)
      } else if (event.key === 'Escape') {
        setPinned(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /**
   * Start a pointer drag.
   *
   * A press only becomes a drag after `RAIL_DRAG_THRESHOLD` pixels, so every
   * chip/button inside the rail still behaves as a normal click; once the drag
   * ends the rail snaps to the nearest edge and the trailing click is eaten.
   */
  const startDrag = (event: RailPointerDown): void => {
    if (event.button !== 0 || typeof window === 'undefined') return
    dragSession.startX = event.clientX
    dragSession.startY = event.clientY
    dragSession.pointerId = event.pointerId
    dragSession.moved = false
    // A previous gesture that ended away from the rail may never have
    // delivered its trailing click; do not let that stale flag eat this press.
    dragSession.suppressClick = false
    const onMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== dragSession.pointerId) return
      const dx = moveEvent.clientX - dragSession.startX
      const dy = moveEvent.clientY - dragSession.startY
      if (!dragSession.moved && Math.hypot(dx, dy) < RAIL_DRAG_THRESHOLD) return
      dragSession.moved = true
      setDrag({
        x: moveEvent.clientX - RAIL_COMPACT_SIZE / 2,
        y: moveEvent.clientY - RAIL_COMPACT_SIZE / 2,
      })
    }
    const finish = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId !== dragSession.pointerId) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      dragSession.pointerId = undefined
      if (!dragSession.moved) return
      dragSession.suppressClick = true
      setDrag(null)
      const snapped = snapRailPlacement(
        { x: upEvent.clientX, y: upEvent.clientY },
        { width: window.innerWidth, height: window.innerHeight },
      )
      setPlacement(snapped)
      setUserDocked(true)
      storePlacement(snapped)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const suppressDraggedClick = (event: { stopPropagation: () => void; preventDefault: () => void }): void => {
    if (!dragSession.suppressClick) return
    dragSession.suppressClick = false
    event.stopPropagation()
    event.preventDefault()
  }

  const views = state.order
    .map(targetId => state.connections[targetId])
    .filter((view): view is RemoteConnectionView => view !== undefined)

  // Nothing left to fold once the last extra connection goes away.
  useEffect(() => {
    if (views.length <= 1) setMinimized(false)
  }, [views.length])

  // Collapsed horizontal bars cannot use an auto width with a CSS transition,
  // so the component sizes them; expanded docks always render the same
  // vertical list and keep their box inside the viewport via railBoxStyle.
  const railStyle: CSSProperties = drag !== null
    ? { left: drag.x, top: drag.y }
    : railBoxStyle(placement, expanded, views.length, viewport, minimized)

  const showToggle = drag === null && railShowsToggle(expanded, minimized, views.length)

  return (
    <div
      className="dsh-rw-rail"
      style={railStyle}
      data-expanded={expanded ? 'true' : undefined}
      data-portal={portalActive ? 'true' : undefined}
      data-pinned={pinned ? 'true' : undefined}
      data-dock={placement.dock}
      data-dragging={drag !== null ? 'true' : undefined}
      data-user-docked={userDocked ? 'true' : undefined}
      data-minimized={minimized ? 'true' : undefined}
      role="navigation"
      aria-label={t('rail.aria')}
      title={t('rail.dragHint')}
      onPointerDown={startDrag}
      onClickCapture={suppressDraggedClick}
    >
      {/* Only this group expands the rail on hover; the fold button below it
          must stay outside so pointing at it cannot trigger a reflow. */}
      <div
        className="dsh-rw-rail-hover"
        onMouseEnter={() => { setHovered(true) }}
        onMouseLeave={() => { setHovered(false) }}
        onFocus={() => { setHovered(true) }}
        onBlur={(event: FocusEvent) => {
          const current = event.currentTarget as Node | null
          const next = event.relatedTarget as Node | null
          if (current === null || !current.contains(next)) setHovered(false)
        }}
      >
      <div className="dsh-rw-rail-head">
        <span className="dsh-rw-rail-title">{t('rail.title')}</span>
        <span className="dsh-rw-rail-head-actions">
          <button
            type="button"
            className="dsh-rw-rail-icon"
            title={t('remote.refresh')}
            aria-label={t('remote.refresh')}
            disabled={state.loading}
            onClick={() => { void refreshAllRemote() }}
          >
            <IconRefreshOutlineRegular size={12} />
          </button>
          <button
            type="button"
            className="dsh-rw-rail-icon"
            title={t('list.newConnection')}
            aria-label={t('list.newConnection')}
            onClick={openConnectDialog}
          >
            <IconPlusOutlineRegular size={12} />
          </button>
        </span>
      </div>
      <div className="dsh-rw-rail-list">
        {minimized ? (
          <button
            type="button"
            className="dsh-rw-rail-minimized"
            data-testid="dsh-rw-rail-minimized"
            title={t('rail.expandList', { count: views.length })}
            aria-label={t('rail.expandList', { count: views.length })}
            onClick={() => {
              // One click both restores the strip and reveals it: the pointer is
              // already over the rail, so no fresh enter event would fire.
              setMinimized(false)
              setHovered(true)
            }}
          >
            +{views.length}
          </button>
        ) : (
          <>
            {views.map(view => (
              <TargetChip
                key={view.target.id}
                view={view}
                active={active?.targetId === view.target.id}
                pinned={pinned}
              />
            ))}
            {views.length === 0 && (
              <button type="button" className="dsh-rw-rail-empty" onClick={openConnectDialog}>
                <span className="dsh-rw-rail-glyph" aria-hidden="true">+</span>
                <span className="dsh-rw-rail-label">
                  <span className="dsh-rw-rail-name">{t('rail.empty')}</span>
                  <span className="dsh-rw-rail-meta">{t('rail.empty.hint')}</span>
                </span>
              </button>
            )}
          </>
        )}
      </div>
      </div>
      {showToggle && (
        <button
          type="button"
          className="dsh-rw-rail-toggle"
          data-testid="dsh-rw-rail-toggle"
          title={t('rail.collapseList')}
          aria-label={t('rail.collapseList')}
          onClick={() => { setMinimized(true) }}
        >
          {placement.dock === 'top' || placement.dock === 'bottom'
            ? <IconChevronLeftOutlineRegular size={12} />
            : (
              <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
                <IconChevronDownOutlineRegular size={12} />
              </span>
            )}
        </button>
      )}
      {state.loading && !state.loaded && <p className="dsh-rw-rail-status">{t('common.loading')}</p>}
      {state.error !== undefined && (
        <button type="button" className="dsh-rw-rail-status" onClick={() => { void loadRemoteState() }}>
          {t('rail.loadFailed')}
        </button>
      )}
      <RemoteDialogs />
      {state.notice !== undefined && <NoticeToastHost notice={state.notice} onDismiss={dismissRemoteNotice} />}
    </div>
  )
}

/**
 * Mount the rail into a body-level host.
 *
 * The shell sidebar is hidden while the official UI owns navigation, so the
 * rail cannot live inside the sidebar; a fixed host keeps it available in both
 * states (portal active or not) and survives sidebar re-renders.
 * @returns a disposer that unmounts the React root and removes the host.
 */
export function mountTargetRail(): (() => void) | undefined {
  if (typeof document === 'undefined' || document.body === null) return undefined
  let disposed = false
  const existing = document.querySelector(`[${TARGET_RAIL_ATTR}]`)
  existing?.remove()
  const container = document.createElement('div')
  container.setAttribute(TARGET_RAIL_ATTR, '')
  container.className = 'dsh-rw-rail-host'
  const root: Root = createRoot(container)
  root.render(<TargetRail />)
  document.body.appendChild(container)
  return () => {
    if (disposed) return
    disposed = true
    root.unmount()
    container.remove()
  }
}
