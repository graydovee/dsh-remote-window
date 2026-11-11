/**
 * The 「远程连接」 navigation row and the connection list page it opens.
 *
 * The shell owns both seats: `sidebar.panellist` renders the row (its icon
 * comes from {@link RemoteConnectionsIcon}) and selecting it switches the main
 * column to the `main` slot entry registered under the same key
 * ({@link CONNECTIONS_PANEL_ID}). The page is the pre-connection surface: while
 * no target's official UI is mounted it lists every saved connection with its
 * live phase and the connect / disconnect / forget verbs. Once a target is
 * active the official UI owns the main column and the client sidebar is hidden,
 * so this page is what the `dsh-rw/close-portal` command returns to.
 *
 * All state comes from `remote-store`; every action is one store verb, so the
 * portal commands and the page share one lifecycle.
 */
import type { ReactElement } from 'react'
import {
  Button, IconGlobeOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PublicTargetV1, ConnectionPhase } from './remote-api.ts'
import type { RemoteConnectionView } from './remote-store.ts'
import {
  activateRemoteTarget, connectRemoteTarget, disconnectRemoteTarget, loadRemoteState,
  openConnectDialog, refreshAllRemote, requestForgetTarget, useRemoteAppState,
} from './remote-store.ts'
import type { LocaleKey } from './locales.ts'
import { t } from './locales.ts'
import { useServerMainRequest } from './portal-main.tsx'

/** The panel id shared by the `sidebar.panellist` row and the `main` entry. */
export const CONNECTIONS_PANEL_ID = 'dsh-remote-workspace'

/** Sidebar row icon; the shell passes the edge size and the selection state. */
export function RemoteConnectionsIcon(props: { size: number; active?: boolean }): ReactElement | null {
  return <IconGlobeOutlineRegular size={props.size} />
}

/** Phase label keys; every `remote.phase.*` value already exists. */
const PHASE_LABELS: Record<ConnectionPhase, LocaleKey> = {
  disconnected: 'remote.phase.disconnected',
  connecting: 'remote.phase.connecting',
  ready: 'remote.phase.ready',
  degraded: 'remote.phase.degraded',
  failed: 'remote.phase.failed',
  stopped: 'remote.phase.stopped',
}

/** Dot appearance per phase: live = green, degraded = warning, gone = idle. */
const PHASE_DOTS: Record<ConnectionPhase, StateDotState> = {
  disconnected: 'idle',
  connecting: 'ongoing',
  ready: 'done',
  degraded: 'warning',
  failed: 'error',
  stopped: 'idle',
}

/**
 * The phase one row shows.
 *
 * A connection state is authoritative when it exists; a saved target that never
 * reported one falls back to its persisted status (`ready` or `stopped`).
 */
function phaseOf(view: RemoteConnectionView): ConnectionPhase {
  return view.connection?.phase ?? (view.target.status === 'ready' ? 'ready' : 'stopped')
}

/** A live profile: the row offers 断开 instead of 连接/重新连接. */
function isConnected(phase: ConnectionPhase): boolean {
  return phase === 'ready' || phase === 'degraded'
}

/**
 * Row endpoint copy.
 *
 * SSH shows `user@host:port`; a WSL target has no host to reach, so it shows the
 * local distribution instead.
 * @param target - one saved target.
 * @returns the localized endpoint line.
 */
function endpointOf(target: PublicTargetV1): string {
  if (target.kind === 'wsl') {
    const distro = target.wslDistro ?? (target.host === '' ? undefined : target.host)
    return distro === undefined
      ? t('connections.endpoint.wsl')
      : t('connections.endpoint.wslDistro', { distro })
  }
  return t('connections.endpoint', { username: target.username, host: target.host, port: target.port })
}

/** One saved connection: state glyph, name/endpoint/phase, and its verbs. */
function ConnectionRow(props: {
  view: RemoteConnectionView
  active: boolean
  pending: boolean
}): ReactElement {
  const { view, active, pending } = props
  const { target } = view
  const phase = phaseOf(view)
  const connected = isConnected(phase)
  const busy = view.connecting === true || pending
  const action = connected
    ? t('connections.disconnect')
    : target.status === 'unknown' ? t('connections.connect') : t('list.reconnect')
  return (
    <li
      className="dsh-rw-conn-row"
      data-testid="dsh-rw-conn-row"
      data-target-id={target.id}
      data-active={active ? 'true' : undefined}
      data-connected={connected ? 'true' : undefined}
      data-phase={phase}
    >
      <button
        type="button"
        className="dsh-rw-conn-open"
        data-testid="dsh-rw-conn-open"
        aria-label={t('connections.activate', { label: target.label })}
        aria-current={active ? 'true' : undefined}
        title={t('connections.activate', { label: target.label })}
        onClick={() => { void activateRemoteTarget(target.id) }}
      >
        <span className="dsh-rw-conn-dot">
          <StateDot state={PHASE_DOTS[phase]} size={8} />
        </span>
        <span className="dsh-rw-conn-label">
          <span className="dsh-rw-conn-name">{target.label}</span>
          <span className="dsh-rw-conn-meta">
            {`${endpointOf(target)} · ${t(PHASE_LABELS[phase])}`}
          </span>
        </span>
      </button>
      {active && <span className="dsh-rw-conn-badge">{t('connections.active')}</span>}
      <span className="dsh-rw-conn-actions">
        <Button
          data-testid="dsh-rw-conn-toggle"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            void (connected ? disconnectRemoteTarget(target.id) : connectRemoteTarget(target.id))
          }}
        >
          {action}
        </Button>
        <Button
          data-testid="dsh-rw-conn-forget"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => { requestForgetTarget(target.id) }}
        >
          {t('list.forget')}
        </Button>
      </span>
    </li>
  )
}

/**
 * The connection list page.
 *
 * A failed initial read is rendered as its own error surface, never as the
 * empty state: "no saved connections" and "the host did not answer" lead the
 * user to different actions.
 */
export function RemoteConnectionsPanel(): ReactElement | null {
  const state = useRemoteAppState()
  const active = useServerMainRequest()
  const views = state.order
    .map(targetId => state.connections[targetId])
    .filter((view): view is RemoteConnectionView => view !== undefined)
  const firstLoad = state.loading && !state.loaded
  return (
    <div className="dsh-rw-page">
      <div className="dsh-rw-page-head">
        <div className="dsh-rw-page-heading">
          <h1 className="dsh-rw-page-title">{t('connections.title')}</h1>
          <p className="dsh-rw-page-intro">{t('connections.subtitle')}</p>
        </div>
        <div className="dsh-rw-page-actions">
          <Button
            data-testid="dsh-rw-conn-new"
            variant="primary"
            size="sm"
            icon={<IconPlusOutlineRegular size={12} />}
            onClick={openConnectDialog}
          >
            {t('list.newConnection')}
          </Button>
          <Button
            data-testid="dsh-rw-conn-refresh"
            variant="outline"
            size="sm"
            icon={<IconRefreshOutlineRegular size={12} />}
            disabled={state.loading}
            onClick={() => { void refreshAllRemote() }}
          >
            {t('remote.refresh')}
          </Button>
        </div>
      </div>
      <div className="dsh-rw-page-body">
        {/* A failed read is announced above the rows: the list keeps working
            with its last snapshot instead of masquerading as empty. */}
        {state.error !== undefined && (
          <div className="dsh-rw-banner" data-kind="error" data-testid="dsh-rw-conn-error" role="alert">
            <div className="dsh-rw-banner-text">
              <span>{t('connections.loadFailed')}</span>
              <span className="dsh-rw-banner-code">{state.error.message}</span>
            </div>
            <Button
              data-testid="dsh-rw-conn-retry"
              variant="outline"
              onClick={() => { void loadRemoteState() }}
            >
              {t('common.retry')}
            </Button>
          </div>
        )}
        {firstLoad
          ? <p className="dsh-rw-hint" data-testid="dsh-rw-conn-loading" role="status">{t('common.loading')}</p>
          : views.length === 0
            ? state.error === undefined
              ? (
                <button
                  type="button"
                  className="dsh-rw-empty"
                  data-testid="dsh-rw-conn-empty"
                  onClick={openConnectDialog}
                >
                  <span className="dsh-rw-empty-title">{t('connections.empty')}</span>
                  <span className="dsh-rw-hint">{t('connections.empty.hint')}</span>
                </button>
              )
              : null
            : (
              <ul className="dsh-rw-conn-list" data-testid="dsh-rw-conn-list">
                {views.map(view => (
                  <ConnectionRow
                    key={view.target.id}
                    view={view}
                    active={active?.targetId === view.target.id}
                    pending={state.pending}
                  />
                ))}
              </ul>
            )}
      </div>
    </div>
  )
}
