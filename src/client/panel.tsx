/**
 * The 远程连接 main panel — the page the wizard and the connection list live in.
 *
 * It has no sidebar row of its own: the 「远程工作区」 section's `+新建连接`
 * control opens it with `layout.selectPanel(PANEL_ID)`, and the same id is the
 * `main` slot key the shell renders the page under. The page hosts the whole
 * flow inline: 新建连接 sits at the top-left, and the four-step wizard renders
 * in place instead of a dialog.
 */
import { useEffect } from 'react'
import type { ReactElement } from 'react'
import {
  Button, IconPlusOutlineRegular, IconRefreshOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { NoticeToastHost } from './common.tsx'
import { t } from './locales.ts'
import { ListBody } from './list.tsx'
import { store, useAppState } from './store.ts'
import { WizardBody, WizardFooter } from './wizard.tsx'

/** The panel id in the layout's main registry (`main` slot key). */
export const PANEL_ID = 'dsh-remote-workspace'

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
      <NoticeToastHost notice={state.notice} onDismiss={store.dismissNotice} />
      {wizard && (
        <div className="dsh-rw-page-foot"><WizardFooter /></div>
      )}
    </div>
  )
}
