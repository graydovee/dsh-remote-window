/**
 * The rename dialog for one remote session.
 *
 * The shell's own dialog is a `shell.overlay` entry owned by ui-workspace, which
 * a plugin cannot raise; this is the same dialog built from the same primitives
 * (Modal + input + buttons) around the same hop — `sessionVerbs.renameSession`,
 * which calls the official session service exactly like the shell's dialog does.
 * The copy comes from the vendored `workspace` dictionary, so it reads
 * identically.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteWorkspace } from './api.ts'
import { useSingleHost } from './common.tsx'
import { t } from './locales.ts'
import { store, useAppState } from './store.ts'
import { rowsTranslate } from './vendor/workspace-rows/translate.ts'

/** One request's form; mounting seeds the draft from the request. */
function RenameForm(props: { workspace: RemoteWorkspace; sessionId: string; currentTitle: string }): ReactElement | null {
  const [draft, setDraft] = useState(props.currentTitle)
  const [renaming, setRenaming] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const composing = useRef(false)
  const trimmed = draft.trim()
  const blocked = renaming || trimmed === ''
  const close = (): void => { if (!renaming) store.settleRename() }
  const confirm = (): void => {
    if (blocked) return
    setRenaming(true)
    setError(undefined)
    store.renameSession(props.workspace, props.sessionId, trimmed).then(
      () => {
        setRenaming(false)
        store.settleRename()
      },
      (reason: unknown) => {
        setRenaming(false)
        setError(t('tree.session.renameFailed', { message: reason instanceof Error ? reason.message : String(reason) }))
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
      title={rowsTranslate('rename.session.title')}
      footer={(
        <>
          <Button variant="outline" disabled={renaming} onClick={close}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={blocked} onClick={confirm}>{rowsTranslate('rename')}</Button>
        </>
      )}
    >
      <input
        ref={input}
        className="dsh-rw-rename-input"
        value={draft}
        disabled={renaming}
        aria-label={rowsTranslate('rename.session.title')}
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
export function RenameSessionDialog(): ReactElement | null {
  const owned = useSingleHost('rename-session')
  const state = useAppState()
  const target = state.renameTarget
  if (!owned || target === undefined) return null
  return (
    <RenameForm
      key={target.session.id}
      workspace={target.workspace}
      sessionId={target.session.id}
      currentTitle={target.title}
    />
  )
}
