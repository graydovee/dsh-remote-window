/**
 * Small shared pieces for the v3 dialogs and the rail's toast host.
 */
import type { ReactElement, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'

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

/**
 * Whether this component is **the** live instance of its kind.
 *
 * The toast host is mounted in one place in v3, but hot reload can briefly keep
 * two trees alive; the first host owns the surface so a notice never renders
 * twice.
 * @param kind - a stable name per surface, e.g. `'notice-toast'`.
 * @returns true while this instance owns the surface.
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
    // Who else is waiting for this surface: when the owner's tree unmounts the
    // surface passes on, or the toast would vanish while a notice is pending.
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

/** Current owner token per surface kind. */
const owners = new Map<string, object>()

/** Claim functions of every mounted instance, per surface kind. */
const waiters = new Map<string, Set<() => void>>()

/**
 * Transient notice rendered as the shell's official `Toast` (top-center,
 * self-timed hold+fade; `onDone` is the only dismissal signal).
 *
 * Success uses the built-in green check; errors keep the default dark surface
 * with a warning icon and a longer hold. `key` replays the slide-in when a
 * **new notice** arrives: the notice object is stable until the next commit
 * that replaces it, so only a real new notice bumps the key.
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

/** The single toast host for this plugin. */
export function NoticeToastHost(props: {
  notice: { kind: 'success' | 'error'; text: string } | undefined
  onDismiss: () => void
}): ReactElement | null {
  const owned = useSingleHost('notice-toast')
  if (!owned || props.notice === undefined) return null
  // The store's notice object is handed down whole: it is what the toast keys
  // its replay on, and a fresh literal here would re-key it.
  return <NoticeToast notice={props.notice} onDismiss={props.onDismiss} />
}
