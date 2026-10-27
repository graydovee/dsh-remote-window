/**
 * v2 conversation composer, rendered with the official 0.2.1-rc.3 DOM/CSS.
 *
 * The card, plus button, permission/model chips and circular send button are
 * the official DOM/CSS. The editable text is a contenteditable div because the
 * official Lexical instance is internal; slash commands, @ references,
 * attachments and clipboard images are implemented here against P1 callbacks.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { t } from './locales.ts'
import { inputCss } from './vendor/official-ui/classnames.ts'
import { CHEVRON_PATHS, MODEL_PATHS, SEND_PATHS, SHIELD_PATHS, STOP_PATHS } from './session-assets.tsx'

/** What one composer key press means. */
export type ComposerKeyAction = 'send' | 'newline' | 'ignore'

/** One browser file staged for the next prompt. */
export interface ComposerAttachment {
  readonly id: string
  readonly name: string
  readonly mediaType: string
  /** Canonical data URL for preview; the base64 payload follows the comma. */
  readonly dataUrl: string
  readonly size: number
}

/** One official slash command offered by the server session. */
export interface ComposerCommand {
  readonly name: string
  readonly description: string
}

/** One model row in the composer model menu. */
export interface ComposerModelInfo {
  readonly id: string
  readonly name: string
  readonly reasoning?: { readonly efforts: readonly { readonly id: string; readonly name: string }[]; readonly defaultEffort?: string }
}

/** One provider group in the composer model menu. */
export interface ComposerModelGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly ComposerModelInfo[]
}

/** One remote directory entry offered after `@`. */
export interface ComposerFileRef {
  readonly name: string
  readonly path: string
  readonly directory?: boolean
}

/**
 * Resolve Enter semantics without touching the DOM.
 *
 * Enter sends; Shift+Enter keeps the newline; an IME composition never sends;
 * a running turn and a disabled composer ignore Enter.
 * @param input - key facts from the textarea event.
 * @returns the action the composer should take.
 */
export function composerKeyAction(input: {
  readonly key: string
  readonly shiftKey: boolean
  readonly isComposing: boolean
  readonly running: boolean
  readonly disabled: boolean
}): ComposerKeyAction {
  if (input.key !== 'Enter') return 'ignore'
  if (input.isComposing) return 'ignore'
  if (input.shiftKey) return 'newline'
  if (input.disabled || input.running) return 'ignore'
  return 'send'
}

/** Props for one composer render. */
export interface SessionComposerProps {
  /** Current draft text (controlled by the main area). */
  readonly value: string
  readonly onChange: (value: string) => void
  readonly onSend: (text?: string, attachments?: readonly ComposerAttachment[]) => void
  readonly sessionId?: string | undefined
  readonly onStop?: (() => void) | undefined
  readonly running: boolean
  readonly disabled?: boolean | undefined
  readonly placeholder?: string | undefined
  readonly attachmentReason?: string | undefined
  readonly error?: { readonly message: string } | undefined
  /** Hero shows the tall empty-session input; docked is the active thread. */
  readonly variant?: 'hero' | 'composer' | undefined
  readonly permissionLabel?: string | undefined
  readonly modelLabel?: string | undefined
  readonly modelEffort?: string | undefined
  readonly models?: readonly ComposerModelGroup[] | undefined
  readonly modelLoading?: boolean | undefined
  readonly onSelectModel?: ((provider: string, model: string, reasoningEffort?: string) => void) | undefined
  readonly attachments?: readonly ComposerAttachment[] | undefined
  readonly onAddFiles?: ((files: readonly File[]) => void) | undefined
  readonly onRemoveAttachment?: ((id: string) => void) | undefined
  readonly commands?: readonly ComposerCommand[] | undefined
  readonly onSearchFiles?: ((query: string) => Promise<readonly ComposerFileRef[]>) | undefined
  readonly permissionOptions?: readonly { readonly id: string; readonly label: string }[] | undefined
  readonly onPermission?: ((preset: string) => void) | undefined
  readonly onCommandInput?: ((line: string) => void) | undefined
}

/** Keep the contenteditable text in sync when the owner clears/restores the draft. */
function useSyncedText(
  value: string,
  ref: { current: HTMLDivElement | null },
): void {
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    if (element.textContent === value) return
    element.textContent = value
  }, [value, ref])
}

/** Insert a line break at the caret (Shift+Enter) without Lexical. */
function insertNewline(ref: { current: HTMLDivElement | null }, value: string, onChange: (text: string) => void): void {
  const element = ref.current
  if (element === null) return
  element.focus()
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) {
    onChange(`${value}\n`)
    return
  }
  const range = selection.getRangeAt(0)
  range.deleteContents()
  const node = document.createTextNode('\n')
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  onChange(element.textContent ?? '')
}

/** Focus the editor and put the caret at the end after a menu insertion. */
function focusEnd(ref: { current: HTMLDivElement | null }): void {
  const element = ref.current
  if (element === null) return
  element.focus()
  const selection = window.getSelection()
  if (selection === null) return
  const range = document.createRange()
  range.selectNodeContents(element)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

/** One official-styled composer. */
export function SessionComposer(props: SessionComposerProps): ReactElement {
  const editor = useRef<HTMLDivElement | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const disabled = props.disabled === true
  const variant = props.variant ?? 'composer'
  const [slashOpen, setSlashOpen] = useState(false)
  const [permissionOpen, setPermissionOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [atOpen, setAtOpen] = useState(false)
  const [atQuery, setAtQuery] = useState('')
  const [atFiles, setAtFiles] = useState<readonly ComposerFileRef[]>([])
  const [atLoading, setAtLoading] = useState(false)
  useSyncedText(props.value, editor)
  const attachments = props.attachments ?? []
  const commands = props.commands ?? []
  const capabilities = props.onAddFiles !== undefined

  const slashMatch = /^\/([a-z0-9_-]*)$/u.exec(props.value)
  const slashOptions = useMemo(() => {
    if (slashMatch === null) return []
    const query = slashMatch[1] ?? ''
    return commands.filter(command => command.name.startsWith(query)).slice(0, 8)
  }, [commands, slashMatch])

  const atMatch = /(?:^|\s)@([^\s@]*)$/u.exec(props.value)
  // Fetch suggestions when the caret is in a `@` token.
  useEffect(() => {
    if (atMatch === null) {
      setAtOpen(false)
      setAtFiles([])
      return
    }
    const query = atMatch[1] ?? ''
    setAtQuery(query)
    setAtOpen(true)
    if (props.onSearchFiles === undefined) return
    let cancelled = false
    setAtLoading(true)
    const timer = setTimeout(() => {
      void props.onSearchFiles?.(query).then((files) => {
        if (!cancelled) {
          setAtFiles(files.slice(0, 8))
          setAtLoading(false)
        }
      }).catch(() => {
        if (!cancelled) {
          setAtFiles([])
          setAtLoading(false)
        }
      })
    }, 160)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [atMatch?.[1], props.onSearchFiles])

  const send = (): void => {
    if (disabled || props.running || props.value.trim() === '') return
    props.onSend()
  }
  const insert = (text: string): void => {
    props.onChange(text)
    focusEnd(editor)
  }
  const insertCommand = (name: string): void => {
    setSlashOpen(false)
    if (name === 'permission') {
      props.onChange('/permission ')
      setPermissionOpen(true)
      return
    }
    if (name === 'model') {
      props.onChange('')
      setModelOpen(true)
      return
    }
    props.onChange(`/${name} `)
  }
  const insertFile = (file: ComposerFileRef): void => {
    if (atMatch === null) return
    const start = props.value.slice(0, atMatch.index) + (atMatch[0].startsWith(' ') ? ' ' : '')
    insert(`${start}@${file.path} `)
    setAtOpen(false)
  }
  const placeholder = props.placeholder
    ?? t(variant === 'hero' ? 'session.composer.placeholder' : 'session.composer.placeholderComposer')
  const addReason = props.attachmentReason ?? t('session.composer.attachmentsDisabled')
  const permissionOptions = props.permissionOptions ?? [
    { id: 'read-only', label: t('session.composer.permission.readOnly') },
    { id: 'workspace-write', label: t('session.composer.permission.workspaceWrite') },
    { id: 'danger-full-access', label: t('session.composer.permission.fullAccess') },
  ]

  return (
    <div className={`${inputCss.root}${variant === 'hero' ? ` ${inputCss.hero}` : ''}`}>
      <div className={inputCss.card} data-composer-card="true">
        <div className={inputCss.overlayAnchor} data-composer-overlay="true">
          <div data-slot="conversation.input.overlay" style={{ display: 'contents' }}><span hidden /></div>
        </div>
        <div data-slot="conversation.input.attachments" style={{ display: 'contents' }}>
          {attachments.length > 0 && (
            <div className="dsh-rw-composer-attachments" aria-label={t('session.composer.attachments')}>
              {attachments.map(attachment => (
                <span key={attachment.id} className="dsh-rw-composer-attachment" title={attachment.name}>
                  {attachment.mediaType.startsWith('image/')
                    ? <img src={attachment.dataUrl} alt="" />
                    : <span className="dsh-rw-composer-file-icon" aria-hidden="true">▤</span>}
                  <span className="dsh-rw-composer-attachment-name">{attachment.name}</span>
                  <button
                    type="button"
                    aria-label={t('session.composer.removeAttachment', { name: attachment.name })}
                    onClick={() => { props.onRemoveAttachment?.(attachment.id) }}
                  >×</button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className={inputCss.scroll} data-input-scroll="true">
          <div className={inputCss.grow}>
            <div
              ref={editor}
              className={`${inputCss.input}${disabled ? ` ${inputCss.inputDisabled}` : ''}`}
              contentEditable={!disabled}
              role="textbox"
              aria-multiline="true"
              aria-label={placeholder}
              data-composer-input="true"
              data-placeholder={placeholder}
              data-phase="plain"
              style={{ userSelect: 'text', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              onInput={(event: { currentTarget: { textContent: string | null } }) => {
                const value = event.currentTarget.textContent ?? ''
                props.onChange(value)
                if (/^\/([a-z0-9_-]*)$/u.test(value)) setSlashOpen(true)
                else setSlashOpen(false)
              }}
              onPaste={(event: { clipboardData?: { files?: FileList } | undefined; preventDefault(): void }) => {
                const files = Array.from(event.clipboardData?.files ?? [])
                if (files.length === 0 || props.onAddFiles === undefined) return
                event.preventDefault()
                props.onAddFiles(files)
              }}
              onKeyDown={(event: {
                key: string
                shiftKey: boolean
                isComposing: boolean
                nativeEvent?: { isComposing?: boolean }
                preventDefault(): void
              }) => {
                if (event.key === 'Escape') {
                  setSlashOpen(false)
                  setPermissionOpen(false)
                  setModelOpen(false)
                  setAtOpen(false)
                  return
                }
                const action = composerKeyAction({
                  key: event.key,
                  shiftKey: event.shiftKey,
                  isComposing: event.isComposing === true || event.nativeEvent?.isComposing === true,
                  running: props.running,
                  disabled,
                })
                if (action === 'send') {
                  event.preventDefault()
                  send()
                } else if (action === 'newline') {
                  event.preventDefault()
                  insertNewline(editor, props.value, props.onChange)
                }
              }}
            />
            {props.value === '' && (
              <div aria-hidden="true" className={inputCss.placeholder} data-composer-placeholder="true">
                {placeholder}
              </div>
            )}
          </div>
        </div>
        {slashOpen && slashOptions.length > 0 && (
          <div className="dsh-rw-composer-menu dsh-rw-composer-menu-slash" role="listbox" aria-label={t('session.composer.commands')}>
            {slashOptions.map(command => (
              <button
                key={command.name}
                type="button"
                role="option"
                aria-selected="false"
                onClick={() => { insertCommand(command.name) }}
              >
                <span className="dsh-rw-composer-menu-name">/{command.name}</span>
                <span className="dsh-rw-composer-menu-desc">{command.description}</span>
              </button>
            ))}
          </div>
        )}
        {atOpen && (atLoading || atFiles.length > 0) && (
          <div className="dsh-rw-composer-menu dsh-rw-composer-menu-at" role="listbox" aria-label={t('session.composer.files')}>
            {atLoading && <div className="dsh-rw-composer-menu-empty">{t('session.composer.loadingFiles')}</div>}
            {!atLoading && atFiles.map(file => (
              <button key={file.path} type="button" role="option" aria-selected="false" onClick={() => { insertFile(file) }}>
                <span className="dsh-rw-composer-menu-name">{file.directory === true ? '▸' : '·'} {file.name}</span>
                <span className="dsh-rw-composer-menu-desc">{file.path}</span>
              </button>
            ))}
          </div>
        )}
        <div className={inputCss.row}>
          <div className={inputCss.tools}>
            <button
              type="button"
              className={inputCss.add}
              aria-label={t('session.composer.add')}
              title={capabilities ? t('session.composer.add') : addReason}
              aria-haspopup="file"
              onClick={() => { fileInput.current?.click() }}
              disabled={!capabilities || disabled}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" strokeWidth="1.3">
                <path d="M8 2V14" stroke="currentColor" />
                <path d="M2 8H14" stroke="currentColor" />
              </svg>
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(event: { currentTarget: HTMLInputElement }) => {
                const files: File[] = Array.from(event.currentTarget.files ?? [])
                if (files.length > 0) props.onAddFiles?.(files)
                event.currentTarget.value = ''
              }}
            />
            <div className={inputCss.modes}>
              <span className="_root_4ub78_1">
                <button
                  type="button"
                  className="wXeviG_trigger"
                  aria-label={t('session.composer.permissionAria', { mode: props.permissionLabel ?? t('session.hero.permission') })}
                  aria-haspopup="menu"
                  aria-expanded={permissionOpen}
                  onClick={() => { setPermissionOpen(value => !value); setModelOpen(false) }}
                >
                  <span className="wXeviG_triggerIcon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" strokeWidth="1" dangerouslySetInnerHTML={{ __html: SHIELD_PATHS }} />
                  </span>
                  <span className="wXeviG_triggerLabel">{props.permissionLabel ?? t('session.hero.permission')}</span>
                  <span className="wXeviG_chevron" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" strokeWidth="1" dangerouslySetInnerHTML={{ __html: CHEVRON_PATHS }} />
                  </span>
                </button>
                {permissionOpen && (
                  <div className="dsh-rw-composer-menu dsh-rw-composer-menu-permission" role="menu">
                    {permissionOptions.map(option => (
                      <button
                        key={option.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked="false"
                        onClick={() => {
                          setPermissionOpen(false)
                          props.onPermission?.(option.id)
                        }}
                      >
                        <span className="dsh-rw-composer-menu-name">{option.label}</span>
                        <span className="dsh-rw-composer-menu-desc">/permission {option.id}</span>
                      </button>
                    ))}
                  </div>
                )}
              </span>
              <div data-slot="conversation.input.plan" style={{ display: 'contents' }} />
            </div>
            <div data-slot="conversation.input.left" style={{ display: 'contents' }} />
          </div>
          <div className={inputCss.trailing}>
            <div className={inputCss.standardControls}>
              <div data-slot="conversation.input.right" style={{ display: 'contents' }} />
              <div data-slot="conversation.input.model" style={{ display: 'contents' }}>
                <div className="cl2Rlq_root">
                  <button
                    type="button"
                    className="cl2Rlq_trigger"
                    aria-busy="false"
                    aria-expanded={modelOpen}
                    aria-haspopup="menu"
                    aria-label={t('session.composer.modelAria', {
                      model: props.modelLabel ?? t('session.hero.model'),
                      effort: props.modelEffort ?? t('session.hero.effort'),
                    })}
                    title={`${props.modelLabel ?? t('session.hero.model')} · ${props.modelEffort ?? t('session.hero.effort')}`}
                    onClick={() => { setModelOpen(value => !value); setPermissionOpen(false) }}
                  >
                    <svg className="cl2Rlq_triggerIcon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" strokeWidth="1" dangerouslySetInnerHTML={{ __html: MODEL_PATHS }} />
                    <span className="cl2Rlq_triggerLabel"><span>{props.modelLabel ?? t('session.hero.model')}</span></span>
                    <span className="cl2Rlq_triggerEffort">{props.modelEffort ?? t('session.hero.effort')}</span>
                    <svg className="cl2Rlq_chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" strokeWidth="1" aria-hidden="true" dangerouslySetInnerHTML={{ __html: CHEVRON_PATHS }} />
                  </button>
                  {modelOpen && (
                    <div className="dsh-rw-composer-menu dsh-rw-composer-menu-model" role="menu">
                      {props.modelLoading === true && <div className="dsh-rw-composer-menu-empty">…</div>}
                      {props.modelLoading !== true && (props.models ?? []).length === 0 && (
                        <div className="dsh-rw-composer-menu-empty">{t('session.composer.modelHint')}</div>
                      )}
                      {(props.models ?? []).map(group => (
                        <div key={group.id} className="dsh-rw-composer-model-group">
                          <div className="dsh-rw-composer-model-provider">{group.name}</div>
                          {group.models.map(model => (
                            <button
                              key={`${group.id}:${model.id}`}
                              type="button"
                              className="dsh-rw-composer-menu-item"
                              role="menuitem"
                              onClick={() => {
                                setModelOpen(false)
                                props.onSelectModel?.(group.id, model.id, model.reasoning?.defaultEffort)
                              }}
                            >
                              <span className="dsh-rw-composer-menu-name">{model.name}</span>
                              {model.reasoning?.defaultEffort !== undefined && (
                                <span className="dsh-rw-composer-menu-desc">{model.reasoning.defaultEffort}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className={inputCss.activity} />
            {props.running
              ? (
                <button
                  type="button"
                  className={inputCss.primary}
                  aria-label={t('session.composer.stop')}
                  title={t('session.composer.stop')}
                  onClick={() => { props.onStop?.() }}
                  disabled={props.onStop === undefined}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" dangerouslySetInnerHTML={{ __html: STOP_PATHS }} />
                </button>
              )
              : (
                <button
                  type="button"
                  className={inputCss.primary}
                  aria-label={t('session.composer.send')}
                  title={t('session.composer.send')}
                  onClick={send}
                  disabled={disabled || props.value.trim() === ''}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" dangerouslySetInnerHTML={{ __html: SEND_PATHS }} />
                </button>
              )}
          </div>
        </div>
      </div>
      {props.error !== undefined && (
        <div className={inputCss.notice} role="alert">{props.error.message}</div>
      )}
      <div className={inputCss.dock} />
    </div>
  )
}
