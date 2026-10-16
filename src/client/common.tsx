/**
 * Small shared pieces used by both the wizard and the saved-items list:
 * a labelled form field and the inline message banners (the server's error
 * `code`/`message` always render inline, never in a toast-only path).
 */
import type { ReactElement, ReactNode } from 'react'
import { useRef } from 'react'
import {
  Button, IconCheckCircleFillRegular, IconCloseOutlineRegular, IconWarningOutlineRegular,
  IconWarningTriangleOutlineRegular, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WireError } from './api.ts'
import { t } from './locales.ts'

/**
 * One labelled form control plus an optional hint line.
 *
 * A plain container, not `<label>`: the controls inside carry their own
 * `aria-label`, and a label wrapping a segmented control would hijack its
 * clicks.
 */
export function Field(props: {
  label: string
  hint?: string | undefined
  children: ReactNode
}): ReactElement | null {
  return (
    <div className="dsh-rw-field">
      <span className="dsh-rw-field-label">{props.label}</span>
      {props.children}
      {props.hint !== undefined && props.hint !== '' && <span className="dsh-rw-field-hint">{props.hint}</span>}
    </div>
  )
}

/** One inline message line. */
export function Banner(props: {
  kind: 'error' | 'success' | 'info'
  text: string
  /** Server error code, rendered small under the message. */
  code?: string | undefined
  onDismiss?: (() => void) | undefined
}): ReactElement | null {
  const icon = props.kind === 'error'
    ? <IconWarningTriangleOutlineRegular size={14} />
    : props.kind === 'success' ? <IconCheckCircleFillRegular size={14} /> : null
  return (
    <div className="dsh-rw-banner" data-kind={props.kind} role={props.kind === 'error' ? 'alert' : 'status'}>
      {icon}
      <span className="dsh-rw-banner-text">
        {props.text}
        {props.code !== undefined && props.code !== '' && (
          <span className="dsh-rw-banner-code">{t('error.code', { code: props.code })}</span>
        )}
      </span>
      {props.onDismiss !== undefined && (
        <Button
          variant="ghost"
          size="sm"
          icon={<IconCloseOutlineRegular size={12} />}
          aria-label={t('error.dismiss')}
          onClick={props.onDismiss}
        />
      )}
    </div>
  )
}

/** Inline error banner for one wire failure. */
export function ErrorBanner(props: { error: WireError; onDismiss?: (() => void) | undefined }): ReactElement | null {
  return <Banner kind="error" text={props.error.message} code={props.error.code} onDismiss={props.onDismiss} />
}

/**
 * Transient notice rendered as the shell's official `Toast` (top-center,
 * self-timed hold+fade; `onDone` is the only dismissal signal). The store no
 * longer runs its own auto-dismiss timer — the component owns the lifecycle.
 *
 * Success uses the built-in green check; errors keep the default dark
 * surface with a warning icon and a longer hold (official pattern: no error
 * tone exists). `key` replays the slide-in when a new notice object arrives,
 * matching the official seq-keyed usage (ui-open-in-app/open-failure-toast).
 */
export function NoticeToast(props: {
  kind: 'success' | 'error'
  text: string
  onDismiss: () => void
}): ReactElement | null {
  const seq = useRef(0)
  const seen = useRef<unknown>(undefined)
  // New notice object identity ⇒ bump the key so the animation replays.
  if (props !== seen.current) {
    seen.current = props
    seq.current += 1
  }
  return props.kind === 'success'
    ? <Toast key={seq.current} text={props.text} tone="success" holdMs={3000} onDone={props.onDismiss} />
    : (
      <Toast
        key={seq.current}
        text={props.text}
        icon={<IconWarningOutlineRegular size={18} />}
        holdMs={5000}
        onDone={props.onDismiss}
      />
    )
}

/** A block-level loading line. */
export function LoadingLine(props: { text?: string }): ReactElement | null {
  return <p className="dsh-rw-hint">{props.text ?? t('common.loading')}</p>
}

/** An empty-state box. */
export function EmptyState(props: { text: string }): ReactElement | null {
  return <p className="dsh-rw-empty">{props.text}</p>
}
