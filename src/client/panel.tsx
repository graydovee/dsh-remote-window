/**
 * The 远程连接 main panel: the sidebar row under 插件 and the page it opens.
 *
 * The row is an ordinary `sidebar.panellist` entry (order 1, right after the
 * plugins panel), so the shell owns the button, label and selection — exactly
 * like 插件 and 任务. Selecting it switches the main column to this page via
 * the `main` slot entry with the same key. The page hosts the whole flow
 * inline: 新建连接 sits at the top-left, and the four-step wizard renders in
 * place instead of a dialog.
 */
import { useEffect } from 'react'
import type { ReactElement } from 'react'
import {
  Button, IconGlobeOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { NoticeToast } from './common.tsx'
import { t } from './locales.ts'
import { ListBody } from './list.tsx'
import { store, useAppState } from './store.ts'
import { WizardBody, WizardFooter } from './wizard.tsx'

/** The panel id in the layout's main registry and the `sidebar.panellist` cell. */
export const PANEL_ID = 'dsh-remote-workspace'

/** Sidebar row icon; the shell asks for the edge and the selection state. */
export function RemotePanelIcon(props: { size: number }): ReactElement | null {
  return <IconGlobeOutlineRegular size={props.size} />
}

/** Main-column page: actions at the top-left, list or wizard below. */
export function RemoteWorkspacePanel(): ReactElement | null {
  const state = useAppState()
  const wizard = state.view !== 'list'
  // First open on a fresh page load: the store starts empty and nothing else
  // triggers a load, so the panel must fetch its own state exactly once.
  useEffect(() => {
    if (!state.stateLoaded && !state.stateLoading) void store.refreshState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="dsh-rw-page">
      <div className="dsh-rw-page-head">
        <Button
          variant="primary"
          icon={<IconPlusOutlineRegular size={12} />}
          onClick={store.newConnection}
        >
          {t('list.newConnection')}
        </Button>
        <Button
          variant="ghost"
          icon={<IconRefreshOutlineRegular size={12} />}
          disabled={state.stateLoading}
          onClick={() => { void store.refreshState() }}
        >
          {t('common.refresh')}
        </Button>
        <span className="dsh-rw-page-title">{t('app.name')}</span>
      </div>
      <div className="dsh-rw-page-body">
        {wizard ? <WizardBody /> : <ListBody />}
      </div>
      {state.notice !== undefined && (
        <NoticeToast kind={state.notice.kind} text={state.notice.text} onDismiss={store.dismissNotice} />
      )}
      {wizard && (
        <div className="dsh-rw-page-foot"><WizardFooter /></div>
      )}
    </div>
  )
}
