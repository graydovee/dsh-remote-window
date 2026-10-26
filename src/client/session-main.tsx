/**
 * v2 native server conversation main area.
 *
 * This is the replacement for the server-mode iframe: it never touches the
 * portal, the iframe DOM or the profile's official UI. The official reusable
 * pieces we can actually reach from a client plugin are the **primitives**
 * (`MarkdownText`, buttons, tooltips, state dots); the official Conversation
 * shell/composer/tool/approval components are registered internally by
 * `ui-conversation`/`ui-chat` and are not exported, so this file owns the
 * shell layout and the timeline adapters around those primitives. See
 * `doc/official-workspace-reuse.md` §13 for the reuse gap.
 *
 * The component is presentational + controlled: the integration layer
 * (remote-store/tree, task-15) owns the P3 timeline/SSE state and passes rows
 * through the pure `session-timeline.ts` merge helpers.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  Button, IconCheckCircleFillRegular, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular,
  IconRefreshOutlineRegular, IconWarningTriangleOutlineRegular, MarkdownText, StateDot, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionApprovalCard } from './session-approval.tsx'
import { SessionComposer } from './session-composer.tsx'
import { SessionHero } from './session-hero.tsx'
import { ToolCallCard, ToolResultCard } from './session-tools.tsx'
import type {
  SessionApprovalDecision, SessionTimelineAssistantEntry, SessionTimelineEntry, SessionTimelineErrorEntry,
  SessionTimelineReasoningEntry, SessionTimelineToolCallEntry, SessionTimelineUserEntry,
} from './session-timeline.ts'
import { t } from './locales.ts'
import type { LocaleKey } from './locales.ts'

/* The platform module re-exports the official Markdown renderer; this plugin's
   type shim predates it, so declare the one binding used here. */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  export function MarkdownText(props: {
    text: string
    streaming?: boolean
    labels: { code: { copyLabel: string; copiedLabel: string }; footnotes: string }
    variant?: 'body' | 'compact'
  }): any
}

/** Main-slot key for the native server conversation (task-15 registers it). */
export const NATIVE_MAIN_ID = 'dsh-remote-workspace-native'

/** Minimal selection request; timeline/SSE data is owned by the integration. */
export interface NativeSessionRequest {
  readonly targetId: string
  readonly targetLabel?: string
  readonly workspaceId?: string
  readonly workspaceTitle?: string
  readonly sessionId: string
  /** Session title for the header, when the sidebar knows it. */
  readonly title?: string
}

/** Connection/session status the header and composer reflect. */
export type NativeSessionStatus = 'loading' | 'idle' | 'running' | 'waiting-approval' | 'error'

/** One transport failure shown above the timeline. */
export interface NativeSessionError {
  readonly code?: string
  readonly message: string
}

/** Props of the native main area (controlled by the integration layer). */
export interface NativeSessionMainProps {
  readonly request: NativeSessionRequest
  readonly entries: readonly SessionTimelineEntry[]
  readonly status: NativeSessionStatus
  /** Older history exists behind `beforeSeq`. */
  readonly hasMoreBefore: boolean
  /** A `beforeSeq` page is in flight. */
  readonly loadingBefore?: boolean
  /** The events SSE is reconnecting; the composer stays disabled. */
  readonly reconnecting?: boolean
  /** Last visible failure (prompt/transport/timeline). */
  readonly error?: NativeSessionError | undefined
  /** A permission/approval request is waiting for this user. */
  readonly approvalPrompt?: string | undefined
  /** Explanation shown next to the disabled attachment control. */
  readonly attachmentReason?: string | undefined
  /** Load the next older page (`beforeSeq`). */
  readonly onLoadBefore: () => void | Promise<void>
  /**
   * Send one prompt. The generated `clientId` is the optimistic-row identity
   * the integration must reconcile when the server echoes the user message.
   */
  readonly onSend: (text: string, clientId: string) => void | Promise<void>
  /** Cancel the running turn. */
  readonly onStop: () => void | Promise<void>
  /** Answer one approval request. */
  readonly onApproval: (approvalId: string, decision: SessionApprovalDecision) => void | Promise<void>
  /** Retry the failed prompt/reconnect. */
  readonly onRetry?: (() => void) | undefined
  /** Workspace title shown by the official empty hero. */
  readonly workspaceLabel?: string | undefined
  /** Agent preset label shown by the official empty hero. */
  readonly presetLabel?: string | undefined
  readonly permissionLabel?: string | undefined
  readonly modelLabel?: string | undefined
  readonly modelEffort?: string | undefined
  /** Official hero placeholder override. */
  readonly placeholder?: string | undefined
}

/* --------------------------------------------------------------- selection */

let nativeRequest: NativeSessionRequest | undefined
const nativeListeners = new Set<() => void>()

function commitNative(request: NativeSessionRequest | undefined): void {
  nativeRequest = request
  for (const listener of nativeListeners) listener()
}

/** Open (or re-point) the native main area. */
export function openNativeSession(request: NativeSessionRequest): void {
  commitNative(request)
}

/** Clear the native main-area request (integration owns selection/SSE abort). */
export function closeNativeSession(): void {
  if (nativeRequest === undefined) return
  commitNative(undefined)
}

/** Ask the native main area to show another session. */
export function navigateNativeSession(sessionId: string | undefined): void {
  if (nativeRequest === undefined) return
  commitNative({
    ...nativeRequest,
    ...(sessionId === undefined ? { sessionId: nativeRequest.sessionId } : { sessionId }),
  })
}

/** Current request, for store integration. */
export function nativeSessionRequest(): NativeSessionRequest | undefined {
  return nativeRequest
}

/** Current session id, for store integration. */
export function nativeSessionId(): string | undefined {
  return nativeRequest?.sessionId
}

/** Subscribe to selection changes (store integration). */
export function subscribeNativeSession(listener: () => void): () => void {
  nativeListeners.add(listener)
  return () => { nativeListeners.delete(listener) }
}

/* ------------------------------------------------------------- presentation */

/** Markdown labels for the official renderer. */
const markdownLabels = {
  code: { copyLabel: t('session.markdown.copy'), copiedLabel: t('session.markdown.copied') },
  footnotes: t('session.markdown.footnotes'),
}

const OfficialMarkdown = MarkdownText as unknown as (props: {
  text: string
  streaming?: boolean
  labels: typeof markdownLabels
  variant?: 'body' | 'compact'
}) => ReactElement

/** Official Markdown renderer when the platform module exposes it; plain text otherwise. */
function RichText(props: { text: string; streaming?: boolean; compact?: boolean }): ReactElement {
  if (typeof OfficialMarkdown !== 'function') {
    return <p className={props.compact === true ? 'dsh-rw-session-plain' : undefined}>{props.text}</p>
  }
  return (
    <OfficialMarkdown
      text={props.text}
      labels={markdownLabels}
      {...(props.streaming === true ? { streaming: true } : {})}
      variant={props.compact === true ? 'compact' : 'body'}
    />
  )
}

/** Generate a client id for one optimistic user row. */
function newClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** One user message row (official Markdown renderer, our alignment). */
function UserRow(props: { entry: SessionTimelineUserEntry }): ReactElement {
  return (
    <div className="dsh-rw-session-row" data-role="user">
      <div className="dsh-rw-session-user">
        {props.entry.pending === true && (
          <span className="dsh-rw-session-pending" aria-label={t('session.message.sending')}>
            <StateDot state="ongoing" size={7} />
          </span>
        )}
        <RichText text={props.entry.text} compact />
      </div>
    </div>
  )
}

/** One assistant message row. */
function AssistantRow(props: { entry: SessionTimelineAssistantEntry }): ReactElement {
  return (
    <div className="dsh-rw-session-row" data-role="assistant">
      <div className="dsh-rw-session-assistant">
        <RichText text={props.entry.text} streaming={props.entry.streaming === true} />
        {props.entry.interrupted === true && (
          <p className="dsh-rw-session-interrupted">{t('session.message.interrupted')}</p>
        )}
      </div>
    </div>
  )
}

/** Collapsed reasoning block. */
function ReasoningRow(props: { entry: SessionTimelineReasoningEntry }): ReactElement {
  const [open, setOpen] = useState(props.entry.streaming === true)
  return (
    <div className="dsh-rw-session-row" data-role="reasoning">
      <div className="dsh-rw-session-reasoning" data-open={open ? '' : undefined}>
        <button
          type="button"
          className="dsh-rw-session-reasoning-head"
          onClick={() => setOpen(value => !value)}
          aria-expanded={open}
        >
          <span className="dsh-rw-session-reasoning-toggle" aria-hidden="true">
            {open ? <IconChevronDownOutlineRegular size={12} /> : <IconChevronRightOutlineRegular size={12} />}
          </span>
          <span>{t(props.entry.streaming === true ? 'session.reasoning.live' : 'session.reasoning.title')}</span>
        </button>
        {open && (
          <div className="dsh-rw-session-reasoning-body">
            <RichText text={props.entry.text} streaming={props.entry.streaming === true} compact />
          </div>
        )}
      </div>
    </div>
  )
}

/** One error row. */
function ErrorRow(props: { entry: SessionTimelineErrorEntry }): ReactElement {
  return (
    <div className="dsh-rw-session-row" data-role="error">
      <div className="dsh-rw-session-error-card" role="alert">
        <IconWarningTriangleOutlineRegular size={15} />
        <div className="dsh-rw-session-error-text">
          <span>{props.entry.message}</span>
          {props.entry.code !== undefined && <code>{props.entry.code}</code>}
        </div>
      </div>
    </div>
  )
}

/** Turn boundary spacing marker. */
function TurnRow(props: { entry: Extract<SessionTimelineEntry, { kind: 'turn' }> }): ReactElement {
  if (props.entry.phase === 'start') return <div className="dsh-rw-session-turn" data-phase="start" />
  const label = props.entry.status === 'error'
    ? t('session.turn.error')
    : props.entry.status === 'cancelled' ? t('session.turn.cancelled') : t('session.turn.done')
  return (
    <div className="dsh-rw-session-turn" data-phase="end" data-status={props.entry.status}>
      <span>{label}</span>
    </div>
  )
}

/** Render one normalized timeline row. */
function TimelineEntryView(props: {
  entry: SessionTimelineEntry
  call?: SessionTimelineToolCallEntry | undefined
  onApproval: (approvalId: string, decision: SessionApprovalDecision) => void | Promise<void>
  disabled: boolean
}): ReactElement | null {
  const entry = props.entry
  switch (entry.kind) {
    case 'user':
      return <UserRow entry={entry} />
    case 'assistant':
      return <AssistantRow entry={entry} />
    case 'reasoning':
      return <ReasoningRow entry={entry} />
    case 'tool-call':
      return <div className="dsh-rw-session-row" data-role="tool"><ToolCallCard entry={entry} /></div>
    case 'tool-result':
      return (
        <div className="dsh-rw-session-row" data-role="tool">
          <ToolResultCard entry={entry} {...(props.call === undefined ? {} : { call: props.call })} />
        </div>
      )
    case 'approval':
      return (
        <div className="dsh-rw-session-row" data-role="approval">
          <SessionApprovalCard entry={entry} onDecision={props.onApproval} disabled={props.disabled} />
        </div>
      )
    case 'error':
      return <ErrorRow entry={entry} />
    case 'turn':
      return <TurnRow entry={entry} />
    case 'unknown':
      return (
        <div className="dsh-rw-session-row" data-role="unknown">
          <div className="dsh-rw-session-unknown">
            {entry.label !== undefined && <code>{entry.label}</code>}
            <span>{entry.text}</span>
          </div>
        </div>
      )
  }
}

/** Header status dot/label. */
function statusPresentation(status: NativeSessionStatus): {
  dot: 'ongoing' | 'warning' | 'done' | 'error' | 'idle'
  label: string
} {
  switch (status) {
    case 'running': return { dot: 'ongoing', label: t('session.status.running') }
    case 'waiting-approval': return { dot: 'warning', label: t('session.status.approval') }
    case 'error': return { dot: 'error', label: t('session.status.error') }
    case 'loading': return { dot: 'ongoing', label: t('session.status.loading') }
    default: return { dot: 'done', label: t('session.status.idle') }
  }
}

/** Header: title, route, execution end and reconnection state. */
function SessionHeader(props: {
  request: NativeSessionRequest
  status: NativeSessionStatus
  reconnecting: boolean
  onRetry?: (() => void) | undefined
  onClose?: (() => void) | undefined
}): ReactElement {
  const presentation = statusPresentation(props.status)
  const location = [props.request.targetLabel, props.request.workspaceTitle].filter(
    (value): value is string => value !== undefined && value !== '',
  ).join(' · ')
  return (
    <header className="dsh-rw-session-head">
      <div className="dsh-rw-session-head-main">
        <span className="dsh-rw-session-head-title">{props.request.title ?? props.request.sessionId}</span>
        {location !== '' && <span className="dsh-rw-session-head-route">{location}</span>}
        <span className="dsh-rw-session-head-executor">{t('session.header.executor')}</span>
      </div>
      <div className="dsh-rw-session-head-status" data-status={props.status}>
        <StateDot state={presentation.dot} size={7} />
        <span>{presentation.label}</span>
        {props.reconnecting && <span className="dsh-rw-session-head-reconnect">{t('session.status.reconnecting')}</span>}
        {props.onRetry !== undefined && props.status === 'error' && (
          <Tooltip label={t('common.retry')} side="bottom" align="end" delayMs={200}>
            <Button
              variant="ghost"
              size="sm"
              icon={<IconRefreshOutlineRegular size={12} />}
              aria-label={t('common.retry')}
              onClick={props.onRetry}
            />
          </Tooltip>
        )}
        {props.onClose !== undefined && (
          <Button variant="ghost" size="sm" onClick={props.onClose}>{t('common.close')}</Button>
        )}
      </div>
    </header>
  )
}

/**
 * The native conversation main area.
 *
 * Scrolling: the timeline sticks to the bottom while the user is already there;
 * scrolling up disables the stickiness and shows a jump-to-bottom affordance.
 * History pagination is a button at the top; the integration fetches
 * `beforeSeq` and prepends via `prependTimelinePage`.
 */
export function NativeSessionMain(props: NativeSessionMainProps): ReactElement {
  const [draft, setDraft] = useState('')
  const [stick, setStick] = useState(true)
  const scroll = useRef<HTMLDivElement | null>(null)
  const disabled = props.reconnecting === true || props.status === 'loading'
  const running = props.status === 'running' || props.status === 'waiting-approval'
  const lastEntry = props.entries[props.entries.length - 1]
  const calls = useMemo(() => {
    const map = new Map<string, SessionTimelineToolCallEntry>()
    for (const entry of props.entries) {
      if (entry.kind === 'tool-call') map.set(entry.callId, entry)
    }
    return map
  }, [props.entries])

  // Stick to the newest content unless the user has scrolled up.
  useEffect(() => {
    const element = scroll.current
    if (element === null || !stick) return
    element.scrollTop = element.scrollHeight
  }, [props.entries.length, lastEntry?.id, lastEntry?.seq, lastEntry?.kind, stick])

  const onScroll = (): void => {
    const element = scroll.current
    if (element === null) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    const nextStick = distance < 48
    if (nextStick !== stick) setStick(nextStick)
  }

  const jumpToBottom = (): void => {
    const element = scroll.current
    if (element === null) return
    element.scrollTop = element.scrollHeight
    setStick(true)
  }

  const send = (): void => {
    const text = draft.trim()
    if (text === '' || disabled || running) return
    setDraft('')
    void Promise.resolve(props.onSend(text, newClientId())).catch(() => {
      // The integration turns the failure into `props.error`; keep the draft
      // out of the timeline's optimistic path so it does not duplicate.
    })
  }

  const composerProps = {
    value: draft,
    onChange: setDraft,
    onSend: send,
    onStop: () => { void props.onStop() },
    running,
    disabled,
    ...(props.attachmentReason === undefined ? {} : { attachmentReason: props.attachmentReason }),
    ...(props.permissionLabel === undefined ? {} : { permissionLabel: props.permissionLabel }),
    ...(props.modelLabel === undefined ? {} : { modelLabel: props.modelLabel }),
    ...(props.modelEffort === undefined ? {} : { modelEffort: props.modelEffort }),
    ...(props.placeholder === undefined ? {} : { placeholder: props.placeholder }),
  } satisfies Omit<Parameters<typeof SessionComposer>[0], 'variant'>

  const banners = (
    <>
      {props.reconnecting === true && (
        <div className="dsh-rw-session-banner" role="status">
          <StateDot state="ongoing" size={7} />
          <span>{t('session.banner.reconnecting')}</span>
          {props.onRetry !== undefined && (
            <button type="button" className="dsh-rw-banner-link" onClick={props.onRetry}>{t('common.retry')}</button>
          )}
        </div>
      )}
      {props.error !== undefined && (
        <div className="dsh-rw-session-banner dsh-rw-session-banner-error" role="alert">
          <IconWarningTriangleOutlineRegular size={14} />
          <span>{props.error.message}</span>
          {props.error.code !== undefined && <code>{props.error.code}</code>}
          {props.onRetry !== undefined && (
            <button type="button" className="dsh-rw-banner-link" onClick={props.onRetry}>{t('common.retry')}</button>
          )}
        </div>
      )}
      {props.approvalPrompt !== undefined && (
        <div className="dsh-rw-session-banner dsh-rw-session-banner-approval" role="status">
          <IconCheckCircleFillRegular size={14} />
          <span>{props.approvalPrompt}</span>
        </div>
      )}
    </>
  )

  const hero = props.entries.length === 0 && props.status !== 'running'

  if (hero) {
    return (
      <section className="dsh-rw-session dsh-rw-session-hero" aria-label={t('session.main.aria')} data-status={props.status}>
        {banners}
        <div className="dsh-rw-session-hero-center">
          <SessionHero
            composer={composerProps}
            workspaceLabel={props.workspaceLabel ?? props.request.workspaceTitle ?? props.request.workspaceId}
            {...(props.presetLabel === undefined ? {} : { presetLabel: props.presetLabel })}
          />
        </div>
      </section>
    )
  }

  return (
    <section className="dsh-rw-session" aria-label={t('session.main.aria')} data-status={props.status}>
      {banners}
      <div className="dsh-rw-session-scroll" ref={scroll} onScroll={onScroll}>
        <div className="dsh-rw-session-list" role="log" aria-live="polite" aria-relevant="additions text">
          {props.hasMoreBefore && (
            <div className="dsh-rw-session-more">
              <Button
                variant="outline"
                size="sm"
                disabled={props.loadingBefore === true}
                onClick={() => { void props.onLoadBefore() }}
              >
                {props.loadingBefore === true ? t('session.history.loading') : t('session.history.load')}
              </Button>
            </div>
          )}
          {props.entries.map(entry => (
            <TimelineEntryView
              key={`${entry.kind}:${entry.id}`}
              entry={entry}
              {...(entry.kind === 'tool-result' && calls.has(entry.callId)
                ? { call: calls.get(entry.callId) }
                : {})}
              onApproval={props.onApproval}
              disabled={props.reconnecting === true}
            />
          ))}
          {props.status === 'running' && (
            <div className="dsh-rw-session-running" role="status">
              <StateDot state="ongoing" size={7} />
              <span>{t('session.status.running')}</span>
            </div>
          )}
        </div>
      </div>
      {!stick && (
        <button type="button" className="dsh-rw-session-jump" onClick={jumpToBottom}>
          {t('session.jumpBottom')}
        </button>
      )}
      <div className="dsh-rw-session-dock">
        <SessionComposer {...composerProps} variant="composer" />
      </div>
    </section>
  )
}
