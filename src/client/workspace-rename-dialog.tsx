/**
 * The rename dialog for one remote workspace.
 *
 * Same shape as `rename-dialog.tsx` (the session one): the shell's own rename
 * dialog is a `shell.overlay` entry owned by ui-workspace, which a plugin cannot
 * raise, so this is the same dialog built from the same primitives around the
 * plugin's own hop — `POST /api/workspace-rename`, which rewrites the record's
 * title and nothing else.
 *
 * Deliberately NOT a remote `mv`: the directory is what every stored session's
 * header points at, the remote registry keeps its own copy of the title, and a
 * network rename has no rollback (architecture A7). The description says so,
 * because "rename a workspace" reads like a directory rename to a user.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { useSingleHost } from './common.tsx'
import { t } from './locales.ts'
import { store, useAppState } from './store.ts'

/** One request's form; mounting seeds the draft from the request. */
function WorkspaceRenameForm(props: { currentTitle: string }): ReactElement | null {
  const [draft, setDraft] = useState(props.currentTitle)
  const [renaming, setRenaming] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const composing = useRef(false)
  const trimmed = draft.trim()
  const blocked = renaming || trimmed === ''
  const close = (): void => { if (!renaming) store.settleWorkspaceRename() }
  const confirm = (): void => {
    if (blocked) return
    setRenaming(true)
    setError(undefined)
    store.acceptWorkspaceRename(trimmed).then(
      () => {
        setRenaming(false)
        store.settleWorkspaceRename()
      },
      (reason: unknown) => {
        setRenaming(false)
        setError(t('tree.workspace.renameFailed', {
          message: reason instanceof Error ? reason.message : String(reason),
        }))
      },
    )
  }
  const input = useRef<HTMLInputElement | null>(null)
  useEffect(() => { input.current?.focus() }, [])
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('common.cancel')}
      title={t('tree.workspace.rename.title')}
      description={t('tree.workspace.rename.description')}
      footer={(
        <>
          <Button variant="outline" disabled={renaming} onClick={close}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={blocked} onClick={confirm}>{t('tree.workspace.rename')}</Button>
        </>
      )}
    >
      <input
        ref={input}
        className="dsh-rw-rename-input"
        value={draft}
        disabled={renaming}
        aria-label={t('tree.workspace.rename.title')}
        onChange={(event: { target: { value: string } }) => { setDraft(event.target.value) }}
        onCompositionStart={() => { composing.current = true }}
        onCompositionEnd={() => { composing.current = false }}
        onKeyDown={(event: { key: string; preventDefault(): void }) => {
          if (event.key === 'Enter' && !composing.current) { event.preventDefault(); confirm() }
        }}
      />
      {error !== undefined && <p className="dsh-rw-side-error">{error}</p>}
    </Modal>
  )
}

/** The dialog host: renders one form per pending request, or nothing. */
export function WorkspaceRenameDialog(): ReactElement | null {
  const owned = useSingleHost('rename-workspace')
  const state = useAppState()
  const pending = state.renameWorkspace
  if (!owned || pending === undefined) return null
  return (
    <WorkspaceRenameForm
      key={pending.workspace.id}
      currentTitle={pending.title}
    />
  )
}
