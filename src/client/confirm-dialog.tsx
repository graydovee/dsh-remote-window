/**
 * The confirmation dialog for this plugin's destructive row verbs.
 *
 * `删除连接` removes the target, its stored secret, its workspaces, their
 * shell-tree entries and their stub directories — but NOT what lives on the
 * remote host (the deployed runtime and the session logs stay; the copy says so,
 * because "delete connection" reads like "delete the server"). `移除工作区`
 * likewise removes one workspace locally only. Neither is undoable, and both sit
 * in a row menu next to a non-destructive verb (`断开` / `重命名工作区`), so the
 * dialog exists to make the difference visible. The shell confirms its own
 * destructive workspace actions the same way; this is that dialog, built from
 * the same primitives, driven by the plugin's own pending request.
 */
import type { ReactElement } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { useSingleHost } from './common.tsx'
import { t } from './locales.ts'
import { store, useAppState } from './store.ts'

/** The dialog host: one form while a request is pending, nothing otherwise. */
export function ConfirmDialog(): ReactElement | null {
  const owned = useSingleHost('confirm')
  const state = useAppState()
  const pending = state.confirm
  if (!owned || pending === undefined) return null
  return (
    <Modal
      open
      onClose={store.settleConfirm}
      closeLabel={t('common.cancel')}
      title={pending.title}
      description={pending.message}
      footer={(
        <>
          <Button variant="outline" onClick={store.settleConfirm}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={state.pending}
            onClick={() => { void store.acceptConfirm() }}
          >
            {pending.confirmLabel}
          </Button>
        </>
      )}
    >
      <span />
    </Modal>
  )
}
