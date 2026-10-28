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
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
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
export const TARGET_RAIL_ATTR = 'data-dsh-remote-workspace-rail'

/** Keyboard shortcut that pins the rail open (`Alt+R`). */
export const RAIL_SHORTCUT = 'r'

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
  const expanded = pinned || hovered
  const portalActive = active !== undefined

  useEffect(() => {
    if (typeof document === 'undefined') return
    const host = document.querySelector(`[${TARGET_RAIL_ATTR}]`)
    if (host === null) return
    if (portalActive) host.setAttribute('data-portal', 'true')
    else host.removeAttribute('data-portal')
  }, [portalActive])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === RAIL_SHORTCUT) {
        event.preventDefault()
        setPinned(value => !value)
      } else if (event.key === 'Escape') {
        setPinned(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const views = state.order
    .map(targetId => state.connections[targetId])
    .filter((view): view is RemoteConnectionView => view !== undefined)

  return (
    <div
      className="dsh-rw-rail"
      data-expanded={expanded ? 'true' : undefined}
      data-portal={portalActive ? 'true' : undefined}
      data-pinned={pinned ? 'true' : undefined}
      role="navigation"
      aria-label={t('rail.aria')}
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
      </div>
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
