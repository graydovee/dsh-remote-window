/**
 * The 远程连接 main page (secondary surface).
 *
 * v1 keeps the sidebar as the only navigation; this page is the connection
 * overview: one card per saved target with its live phase, profile/runtime/
 * plugin facts and the actions that belong to a connection. The old three-step
 * wizard (and its WSL flow) is deliberately not mounted here any more.
 */
import { useEffect } from 'react'
import type { ReactElement } from 'react'
import {
  Button, IconPlusOutlineRegular, IconRefreshOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { RemoteTreeBoundary } from './boundary.tsx'
import { t } from './locales.ts'
import {
  connectRemoteTarget, disconnectRemoteTarget, loadRemoteState, openAddWorkspace, openConnectDialog,
  openModeDialog, refreshAllRemote, useNativeSessionMainProps, useRemoteAppState,
} from './remote-store.ts'
import type { RemoteConnectionView } from './remote-store.ts'
import { NativeSessionMain } from './session-main.tsx'

/** The panel id in the layout's main registry (`main` slot key). */
export const PANEL_ID = 'dsh-remote-workspace'

/** Native server conversation main area (registered under NATIVE_MAIN_ID). */
export function NativeSessionPanel(): ReactElement | null {
  return (
    <RemoteTreeBoundary>
      <NativeSessionPanelBody />
    </RemoteTreeBoundary>
  )
}

function NativeSessionPanelBody(): ReactElement | null {
  const props = useNativeSessionMainProps()
  if (props === undefined) return null
  return <NativeSessionMain {...props} />
}

/** Main-column page: the boundary keeps a render crash from blanking the shell. */
export function RemoteWorkspacePanel(): ReactElement | null {
  return (
    <RemoteTreeBoundary>
      <PanelBody />
    </RemoteTreeBoundary>
  )
}

/** One connection card. */
function ConnectionCard(props: { view: RemoteConnectionView }): ReactElement {
  const { view } = props
  const phase = view.connection?.phase ?? 'stopped'
  const connected = phase === 'ready' || phase === 'degraded'
  const runtime = view.connection?.runtime
  const plugin = view.connection?.plugin
  return (
    <section className="dsh-rw-card" data-phase={phase}>
      <header className="dsh-rw-card-head">
        <span className="dsh-rw-card-title">{view.target.label}</span>
        <span className="dsh-rw-card-phase">{t(`remote.phase.${phase}` as Parameters<typeof t>[0])}</span>
        <span className="dsh-rw-card-mode">{t(view.mode === 'server' ? 'remote.mode.server' : 'remote.mode.local')}</span>
      </header>
      <p className="dsh-rw-card-endpoint">
        {view.target.kind === 'wsl'
          ? t('list.endpoint.wsl', { distro: view.target.wslDistro ?? view.target.host })
          : t('list.endpoint', { username: view.target.username, host: view.target.host, port: view.target.port })}
      </p>
      <dl className="dsh-rw-card-facts">
        <dt>{t('remote.panel.profile')}</dt>
        <dd>{view.connection?.profile?.name ?? t('common.unknown')}</dd>
        <dt>{t('remote.panel.runtime')}</dt>
        <dd>
          {runtime === null || runtime === undefined
            ? t('common.unknown')
            : `${runtime.kind}${runtime.dshVersion === undefined ? '' : ` · ${runtime.dshVersion}`}`}
        </dd>
        <dt>{t('remote.panel.plugin')}</dt>
        <dd>
          {plugin === null || plugin === undefined
            ? t('common.unknown')
            : plugin.installed ? (plugin.version ?? t('common.unknown')) : t('remote.panel.pluginMissing')}
        </dd>
      </dl>
      {view.error !== undefined && <p className="dsh-rw-side-error">{view.error.message}</p>}
      {view.connection?.error !== undefined && <p className="dsh-rw-side-error">{view.connection.error.message}</p>}
      <div className="dsh-rw-card-actions">
        <Button
          variant="outline"
          disabled={view.stateLoad.loading}
          onClick={() => {
            void (connected ? disconnectRemoteTarget(view.target.id) : connectRemoteTarget(view.target.id))
          }}
        >
          {t(connected ? 'list.stop' : 'list.reconnect')}
        </Button>
        <Button
          variant="ghost"
          disabled={!connected}
          onClick={() => { void openAddWorkspace(view.target.id) }}
        >
          {t('remote.workspace.add')}
        </Button>
        <Button variant="ghost" disabled={!connected} onClick={() => openModeDialog(view.target.id)}>
          {t('remote.mode.switch')}
        </Button>
        <Button
          variant="ghost"
          disabled={view.stateLoad.loading}
          onClick={() => { void loadRemoteState() }}
        >
          {t('remote.refresh')}
        </Button>
      </div>
    </section>
  )
}

/** The page body. */
function PanelBody(): ReactElement | null {
  const state = useRemoteAppState()
  useEffect(() => {
    if (!state.loaded && !state.loading) void loadRemoteState()
  }, [state.loaded, state.loading])
  const views = state.order
    .map(targetId => state.connections[targetId])
    .filter((view): view is RemoteConnectionView => view !== undefined)
  return (
    <div className="dsh-rw-page">
      <div className="dsh-rw-page-head">
        <Button variant="primary" icon={<IconPlusOutlineRegular size={12} />} onClick={openConnectDialog}>
          {t('list.newConnection')}
        </Button>
        <Button
          variant="ghost"
          icon={<IconRefreshOutlineRegular size={12} />}
          disabled={state.loading}
          onClick={() => { void refreshAllRemote() }}
        >
          {t('remote.refresh')}
        </Button>
        <span className="dsh-rw-page-title">{t('remote.panel.title')}</span>
      </div>
      <div className="dsh-rw-page-body">
        {state.loading && !state.loaded && <p className="dsh-rw-hint">{t('common.loading')}</p>}
        {state.error !== undefined && (
          <p className="dsh-rw-side-error">
            {t('list.loadFailed')}
            <button type="button" className="dsh-rw-banner-link" onClick={() => { void loadRemoteState() }}>
              {t('remote.error.retry')}
            </button>
          </p>
        )}
        {state.loaded && views.length === 0 && (
          <p className="dsh-rw-hint">{t('remote.panel.empty')}</p>
        )}
        <div className="dsh-rw-card-list">
          {views.map(view => <ConnectionCard key={view.target.id} view={view} />)}
        </div>
      </div>
    </div>
  )
}
