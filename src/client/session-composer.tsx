/**
 * v2 conversation composer, rendered with the official 0.2.1-rc.2 DOM/CSS.
 *
 * The hero and docked variants use the shell's real `yhfFVG_` classes (the
 * same nodes InputBar draws). Only the input body is a contenteditable div we
 * drive ourselves, because the official Lexical instance is internal; the
 * card, plus button, permission chip, model chip and circular send button are
 * the official classes/markup. Attachments stay disabled with an explanatory
 * title.
 */
import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { t } from './locales.ts'
import { CHEVRON_PATHS, MODEL_PATHS, SEND_PATHS, SHIELD_PATHS, STOP_PATHS } from './session-assets.tsx'

/** What one composer key press means. */
export type ComposerKeyAction = 'send' | 'newline' | 'ignore'

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
  readonly onSend: () => void
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
    const next = `${value}\n`
    onChange(next)
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

/** One official-styled composer. */
export function SessionComposer(props: SessionComposerProps): ReactElement {
  const editor = useRef<HTMLDivElement | null>(null)
  const disabled = props.disabled === true
  const variant = props.variant ?? 'composer'
  useSyncedText(props.value, editor)
  const send = (): void => {
    if (disabled || props.running || props.value.trim() === '') return
    props.onSend()
  }
  const placeholder = props.placeholder ?? t('session.composer.placeholder')
  const addReason = props.attachmentReason ?? t('session.composer.attachmentsDisabled')
  return (
    <div className={`yhfFVG_root${variant === 'hero' ? ' yhfFVG_hero' : ''}`}>
      <div className="yhfFVG_card" data-composer-card="true">
        <div className="yhfFVG_overlayAnchor" data-composer-overlay="true">
          <div data-slot="conversation.input.overlay" style={{ display: 'contents' }}><span hidden /></div>
        </div>
        <div data-slot="conversation.input.attachments" style={{ display: 'contents' }} />
        <div className="yhfFVG_scroll" data-input-scroll="true">
          <div className="yhfFVG_grow">
            <div
              ref={editor}
              className={`yhfFVG_input${disabled ? ' yhfFVG_inputDisabled' : ''}`}
              contentEditable={!disabled}
              role="textbox"
              aria-multiline="true"
              aria-label={placeholder}
              data-composer-input="true"
              data-placeholder={placeholder}
              data-phase="plain"
              style={{ userSelect: 'text', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              onInput={(event: { currentTarget: { textContent: string | null } }) => {
                props.onChange(event.currentTarget.textContent ?? '')
              }}
              onKeyDown={(event: {
                key: string
                shiftKey: boolean
                isComposing: boolean
                nativeEvent?: { isComposing?: boolean }
                preventDefault(): void
              }) => {
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
              <div aria-hidden="true" className="yhfFVG_placeholder" data-composer-placeholder="true">
                {placeholder}
              </div>
            )}
          </div>
        </div>
        <div className="yhfFVG_row">
          <div className="yhfFVG_tools">
            <button
              type="button"
              className="yhfFVG_add"
              aria-label={t('session.composer.add')}
              title={addReason}
              aria-haspopup="listbox"
              aria-expanded={false}
              disabled
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" strokeWidth="1.3">
                <path d="M8 2V14" stroke="currentColor" />
                <path d="M2 8H14" stroke="currentColor" />
              </svg>
            </button>
            <input type="file" multiple hidden />
            <div className="yhfFVG_modes">
              <span className="_root_4ub78_1">
                <button
                  type="button"
                  className="wXeviG_trigger"
                  aria-label={t('session.composer.permissionAria', { mode: props.permissionLabel ?? t('session.hero.permission') })}
                  title={addReason}
                >
                  <span className="wXeviG_triggerIcon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" strokeWidth="1" dangerouslySetInnerHTML={{ __html: SHIELD_PATHS }} />
                  </span>
                  <span className="wXeviG_triggerLabel">{props.permissionLabel ?? t('session.hero.permission')}</span>
                  <span className="wXeviG_chevron" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" strokeWidth="1" dangerouslySetInnerHTML={{ __html: CHEVRON_PATHS }} />
                  </span>
                </button>
              </span>
              <div data-slot="conversation.input.plan" style={{ display: 'contents' }} />
            </div>
            <div data-slot="conversation.input.left" style={{ display: 'contents' }} />
          </div>
          <div className="yhfFVG_trailing">
            <div className="yhfFVG_standardControls">
              <div data-slot="conversation.input.right" style={{ display: 'contents' }} />
              <div data-slot="conversation.input.model" style={{ display: 'contents' }}>
                <div className="cl2Rlq_root">
                  <button
                    type="button"
                    className="cl2Rlq_trigger"
                    aria-busy="false"
                    aria-expanded={false}
                    aria-haspopup="menu"
                    aria-label={t('session.composer.modelAria', {
                      model: props.modelLabel ?? t('session.hero.model'),
                      effort: props.modelEffort ?? t('session.hero.effort'),
                    })}
                    title={`${props.modelLabel ?? t('session.hero.model')} · ${props.modelEffort ?? t('session.hero.effort')}`}
                  >
                    <svg className="cl2Rlq_triggerIcon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" strokeWidth="1" dangerouslySetInnerHTML={{ __html: MODEL_PATHS }} />
                    <span className="cl2Rlq_triggerLabel"><span>{props.modelLabel ?? t('session.hero.model')}</span></span>
                    <span className="cl2Rlq_triggerEffort">{props.modelEffort ?? t('session.hero.effort')}</span>
                    <svg className="cl2Rlq_chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" strokeWidth="1" aria-hidden="true" dangerouslySetInnerHTML={{ __html: CHEVRON_PATHS }} />
                  </button>
                </div>
              </div>
            </div>
            <div className="yhfFVG_activity" />
            {props.running
              ? (
                <button
                  type="button"
                  className="yhfFVG_primary"
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
                  className="yhfFVG_primary"
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
        <div className="yhfFVG_notice" role="alert">{props.error.message}</div>
      )}
      <div className="yhfFVG_dock" />
    </div>
  )
}
