/**
 * Small shared pieces used by both the wizard and the saved-items list:
 * a labelled form field and the inline message banners (the server's error
 * `code`/`message` always render inline, never in a toast-only path).
 */
import type { ReactElement, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
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
 * tone exists). `key` replays the slide-in when a **new notice** arrives,
 * matching the official seq-keyed usage (ui-open-in-app/open-failure-toast).
 *
 * The identity compared is the store's notice object, not this component's
 * props: React builds a fresh props object on every render, so comparing props
 * re-keyed the `Toast` on *every* store commit — the toast then remounted,
 * replayed its slide-in and restarted its hold, which is why 已连接/已断开
 * repeated whenever a row was clicked. The notice object is stable until the
 * next commit that replaces it, so only a real new notice bumps the key.
 */
export function NoticeToast(props: {
  notice: { kind: 'success' | 'error'; text: string }
  onDismiss: () => void
}): ReactElement | null {
  const seq = useRef(0)
  const seen = useRef<unknown>(undefined)
  // A new notice object ⇒ bump the key so the animation replays (once).
  if (props.notice !== seen.current) {
    seen.current = props.notice
    seq.current += 1
  }
  const { kind, text } = props.notice
  return kind === 'success'
    ? <Toast key={seq.current} text={text} tone="success" holdMs={3000} onDone={props.onDismiss} />
    : (
      <Toast
        key={seq.current}
        text={text}
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

/**
 * Whether this component is **the** live instance of its kind.
 *
 * `RemoteTree` — which hosts this plugin's dialogs — is mounted twice: once by
 * the sidebar section and once by the plugin panel's list body. Both are live at
 * the same time, so an unguarded dialog would render two stacked modals for one
 * request. Same rule as {@link NoticeToastHost} (the first host owns the
 * surface), but keyed per kind so the four dialogs do not fight each other.
 *
 * Ownership is claimed in an effect rather than in a `useState` initializer:
 * a counter in an initializer double-counts under StrictMode's double-invoke and
 * would leave every instance a non-owner.
 * @param kind - a stable name per dialog, e.g. `'add-workspace'`.
 * @returns true while this instance owns the dialog surface.
 */
export function useSingleHost(kind: string): boolean {
  const [token] = useState<object>(() => ({}))
  const [owned, setOwned] = useState(false)
  useEffect(() => {
    const claim = (): void => {
      if (owners.has(kind)) return
      owners.set(kind, token)
      setOwned(true)
    }
    claim()
    // Who else is waiting for this surface: when the owner's tree unmounts (the
    // panel closing, say) the surface must pass on, or the dialog would vanish
    // while its request is still pending.
    const contenders = waiters.get(kind) ?? new Set<() => void>()
    waiters.set(kind, contenders)
    contenders.add(claim)
    return () => {
      contenders.delete(claim)
      if (owners.get(kind) !== token) return
      owners.delete(kind)
      setOwned(false)
      for (const next of contenders) {
        next()
        break
      }
    }
  }, [kind, token])
  return owned
}

/** Current owner token per dialog kind. */
const owners = new Map<string, object>()

/** Claim functions of every mounted instance, per dialog kind. */
const waiters = new Map<string, Set<() => void>>()

/**
 * The single toast host for this plugin.
 *
 * The sidebar section and the plugin panel are separate surface trees, and a
 * verb can be raised from either; rendering one `NoticeToast` per surface would
 * show every notice twice when both are mounted. Ownership goes through
 * {@link useSingleHost}, so it also **passes on** when the owning tree unmounts
 * (the panel closing, say) — the old mount-order counter never handed the
 * surface to the survivor, which could leave the plugin with no toast at all.
 */
export function NoticeToastHost(props: {
  notice: { kind: 'success' | 'error'; text: string } | undefined
  onDismiss: () => void
}): ReactElement | null {
  const owned = useSingleHost('notice-toast')
  if (!owned || props.notice === undefined) return null
  // The store's notice object is handed down whole: it is what the toast keys
  // its replay on (see NoticeToast), and a fresh literal here would re-key it.
  return <NoticeToast notice={props.notice} onDismiss={props.onDismiss} />
}
