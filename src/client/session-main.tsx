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
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  Button, IconCheckCircleFillRegular, IconCheckOutlineRegular, IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular, IconCopyOutlineRegular, IconEllipsisOutlineRegular, IconRefreshOutlineRegular,
  IconWarningTriangleOutlineRegular, MarkdownText, StateDot, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionApprovalCard } from './session-approval.tsx'
import { type ComposerAttachment, type ComposerCommand, type ComposerFileRef, type ComposerModelGroup } from './session-composer.tsx'
import { OfficialSessionComposer as SessionComposer } from './session-composer-official.tsx'
import { OfficialSessionHeader, SessionHeaderActions, SessionHeaderUtilities } from './session-header-official.tsx'
import { SessionHero } from './session-hero.tsx'
import { portalPath } from './portal-url.ts'
import { ToolCallCard, ToolResultCard } from './session-tools.tsx'
import type {
  SessionApprovalDecision, SessionTimelineApprovalEntry, SessionTimelineAssistantEntry, SessionTimelineEntry,
  SessionTimelineErrorEntry, SessionTimelineReasoningEntry, SessionTimelineToolCallEntry, SessionTimelineUserEntry,
} from './session-timeline.ts'
import { t } from './locales.ts'
import type { LocaleKey } from './locales.ts'
import { conversationCss } from './vendor/official-ui/classnames.ts'
import { UserContent } from './vendor/official-ui/components/UserContent.tsx'
import { loadOfficialApprovalUi, loadOfficialChatUi, loadOfficialTrajectoryUi } from './official-ui-runtime.ts'
import type { OfficialApprovalExports, OfficialChatExports, OfficialTrajectoryExports } from './official-ui-runtime.ts'

/* The platform module re-exports the official Markdown renderer; this plugin's
   type shim predates it, so declare the one binding used here. */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  export function IconCheckOutlineRegular(props?: { size?: number }): any
  export function IconCopyOutlineRegular(props?: { size?: number }): any
  export function writeClipboard(text: string): Promise<boolean>
  export function MarkdownText(props: {
    text: string
    streaming?: boolean
    labels: { code: { copyLabel: string; copiedLabel: string }; footnotes: string }
    variant?: 'body' | 'compact'
  }): any
}

/** Main-slot key for the native server conversation (task-15 registers it). */
export const NATIVE_MAIN_ID = 'dsh-remote-window-native'

/** Minimal selection request; timeline/SSE data is owned by the integration. */
export interface NativeSessionRequest {
  readonly targetId: string
  readonly targetLabel?: string
  readonly workspaceId?: string
  readonly workspaceTitle?: string
  readonly sessionId: string
  /** Server working directory used to resolve relative Markdown image paths. */
  readonly cwd?: string
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
  readonly onSend: (text: string, clientId: string, attachments?: readonly ComposerAttachment[]) => void | Promise<void>
  /** Run one official slash command on the server session. */
  readonly onCommand?: ((line: string) => void | Promise<void>) | undefined
  /** List official slash commands for this session. */
  readonly onListCommands?: (() => Promise<readonly ComposerCommand[]>) | undefined
  /** List routable server models for the model seat. */
  readonly onListModels?: (() => Promise<readonly ComposerModelGroup[]>) | undefined
  /** Persist a server model selection. */
  readonly onSelectModel?: ((provider: string, model: string, reasoningEffort?: string) => void | Promise<void>) | undefined
  /** Resolve `@` file suggestions from the server cwd. */
  readonly onSearchFiles?: ((query: string) => Promise<readonly ComposerFileRef[]>) | undefined
  /** Switch the server permission preset through `/permission`. */
  readonly onPermission?: ((preset: string) => void | Promise<void>) | undefined
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
  pathImages?: { resolve: (path: string) => string | undefined; labels: { loading: string; failed: string } }
}) => ReactElement

interface SessionPathContextValue {
  readonly targetId: string
  readonly cwd?: string
}

const SessionPathContext = createContext<SessionPathContextValue | undefined>(undefined)

/** Resolve relative Markdown image paths through the target's official file API. */
function sessionPathImages(targetId: string, cwd: string | undefined): {
  resolve: (path: string) => string | undefined
  labels: { loading: string; failed: string }
} {
  return {
    resolve: (path: string) => {
      if (/^(?:https?|data|blob):/i.test(path) || path.startsWith('dsh-app://')) return path
      if (cwd === undefined || cwd === '') return undefined
      const absolute = path.startsWith('/') ? path : `${cwd.replace(/\/+$/u, '')}/${path}`
      return `${window.location.origin}${portalPath(targetId)}api/file?path=${encodeURIComponent(absolute)}`
    },
    labels: { loading: t('session.image.loading'), failed: t('session.image.failed') },
  }
}

/** Official Markdown renderer when the platform module exposes it; plain text otherwise. */
function RichText(props: { text: string; streaming?: boolean; compact?: boolean }): ReactElement {
  const context = useContext(SessionPathContext)
  // The platform export is a `React.memo` component object, not a function.
  if ((MarkdownText as unknown) == null) {
    return <p className={props.compact === true ? 'dsh-rw-session-plain' : undefined}>{props.text}</p>
  }
  return (
    <OfficialMarkdown
      text={props.text}
      labels={markdownLabels}
      {...(props.streaming === true ? { streaming: true } : {})}
      variant={props.compact === true ? 'compact' : 'body'}
      {...(context === undefined ? {} : { pathImages: sessionPathImages(context.targetId, context.cwd) })}
    />
  )
}

/** Generate a client id for one optimistic user row. */
function newClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Official message action row: copy with a short check confirmation. */
function MessageActions(props: { text: string }): ReactElement {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1000)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <div className="dsh-rw-session-actions">
      <Tooltip label={t(copied ? 'session.block.copied' : 'session.block.copy')} side="bottom">
        <button
          type="button"
          className="dsh-rw-session-action"
          aria-label={t(copied ? 'session.block.copied' : 'session.block.copy')}
          onClick={() => {
            void writeClipboard(props.text).then(ok => { if (ok) setCopied(true) })
          }}
        >
          {copied ? <IconCheckOutlineRegular /> : <IconCopyOutlineRegular />}
        </button>
      </Tooltip>
    </div>
  )
}

/** Official Chat target bundle for genuine upstream message components. */
function useOfficialChatUi(): OfficialChatExports | null {
  const [ui, setUi] = useState<OfficialChatExports | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadOfficialChatUi().then(
      value => { if (!cancelled) setUi(value) },
      () => { if (!cancelled) setUi(null) },
    )
    return () => { cancelled = true }
  }, [])
  return ui
}

/** Official message icon/copy row once the chat bundle is loaded; plain fallback during load. */
function OfficialMessageActions({ text, clock }: { text: string; clock: 'start' | 'end' }): ReactElement {
  const ui = useOfficialChatUi()
  const Actions = ui?.MessageIconActions as ((props: Record<string, unknown>) => ReactElement) | undefined
  if (Actions === undefined) return <MessageActions text={text} />
  return <Actions text={text} clock={clock} t={t} />
}

/** Locale bridge for the official chat components (message namespace). */
function officialChatT(key: string, vars?: Record<string, string | number>): string {
  if (key === 'copy') return t('session.block.copy')
  if (key === 'copied') return t('session.block.copied')
  if (key === 'message.extraBlock') return '额外内容'
  if (key === 'message.unknownBlock') return '未知内容'
  if (key === 'message.think') return t('session.reasoning.title')
  if (key === 'row.running') return t('session.reasoning.live')
  if (key === 'message.stopped') return '已停止'
  if (key === 'message.referenceSummary') return `引用了 ${String(vars?.['labels'] ?? '')}`
  if (key === 'json.truncated') return `已截断（共 ${String(vars?.['total'] ?? '')} 项）`
  return key
}

/** Render one user row through the official rc.3 `UserMessageNodeView`. */
function OfficialUserRow(props: { ui: OfficialChatExports; entry: SessionTimelineUserEntry }): ReactElement {
  const { ui } = props
  const UserMessageNodeView = ui.UserMessageNodeView as any
  const UserContentOfficial = ui.UserContent as any
  const renderFactorySlot = (name: string, slotProps: any): ReactElement | null => {
    if (name === 'conversation.chat.user.content') {
      return (
        <UserContentOfficial
          {...slotProps}
          renderFactorySlot={(inner: string, innerProps: any) => (
            inner === 'conversation.user.text'
              ? <RichText text={String(innerProps.text ?? '')} compact />
              : null
          )}
          renderSlot={() => null}
          t={officialChatT}
        />
      )
    }
    if (name === 'conversation.user.text') return <RichText text={String(slotProps.text ?? '')} compact />
    return null
  }
  const node = {
    data: {
      content: props.entry.text === '' ? [] : [{ type: 'text', text: props.entry.text }],
      time: Date.now(),
    },
  }
  return (
    <div className="dsh-rw-session-row" data-role="user">
      <UserMessageNodeView
        node={node}
        renderFactorySlot={renderFactorySlot}
        loadImage={() => undefined}
        t={officialChatT}
      />
      {props.entry.pending === true && (
        <span className="dsh-rw-session-pending" aria-label={t('session.message.sending')}>
          <StateDot state="ongoing" size={7} />
        </span>
      )}
    </div>
  )
}

/** One user message row; falls back to the local bubble only while the bundle loads. */
function UserRow(props: { entry: SessionTimelineUserEntry }): ReactElement {
  const ui = useOfficialChatUi()
  if (ui !== null) return <OfficialUserRow ui={ui} entry={props.entry} />
  return (
    <div className="dsh-rw-session-row" data-role="user">
      <UserContent text={props.entry.text} renderText={text => <RichText text={text} compact />} />
      {props.entry.pending === true && (
        <span className="dsh-rw-session-pending" aria-label={t('session.message.sending')}>
          <StateDot state="ongoing" size={7} />
        </span>
      )}
      {props.entry.pending !== true && <OfficialMessageActions text={props.entry.text} clock="start" />}
    </div>
  )
}

/** Stable disclosure hook for the official assistant body. */
function useOfficialDisclosure(): { expanded: boolean; setExpanded: (open: boolean) => void; toggle: () => void } {
  const [expanded, setExpanded] = useState(false)
  return { expanded, setExpanded, toggle: () => setExpanded(value => !value) }
}

const OFFICIAL_PRESENTATION = {
  mode: 'standard' as const,
  collapseTiming: 'never' as const,
  foldCompletedTurns: false,
  stepGrouping: 'none' as const,
  liveProcessDetail: false,
  settledReasoningPreview: true,
}

function useOfficialPresentation(selector: (policy: typeof OFFICIAL_PRESENTATION) => unknown): unknown {
  return selector(OFFICIAL_PRESENTATION)
}

function useOfficialGroupAction(): ReturnType<typeof useRef<HTMLDivElement>> {
  return useRef<HTMLDivElement>(null)
}

/** Render one assistant body through the official rc.3 `AssistantMarkdown`. */
function OfficialAssistantRow(props: { ui: OfficialChatExports; entry: SessionTimelineAssistantEntry }): ReactElement {
  const AssistantMarkdown = props.ui.AssistantMarkdown as any
  return (
    <div className="dsh-rw-session-row" data-role="assistant">
      <div className="dsh-rw-session-assistant">
        <AssistantMarkdown
          blocks={props.entry.text === '' ? [] : [{ kind: 'text', text: props.entry.text }]}
          streaming={props.entry.streaming === true}
          interrupted={props.entry.interrupted === true}
          useDisclosure={useOfficialDisclosure}
          usePresentation={useOfficialPresentation}
          useGroupAction={useOfficialGroupAction}
          renderSlot={() => null}
          loadImage={() => undefined}
          t={officialChatT}
        />
      </div>
    </div>
  )
}

/** One assistant message row; local markdown only while the official bundle loads. */
function AssistantRow(props: { entry: SessionTimelineAssistantEntry }): ReactElement {
  const ui = useOfficialChatUi()
  if (ui !== null) return <OfficialAssistantRow ui={ui} entry={props.entry} />
  return (
    <div className="dsh-rw-session-row" data-role="assistant">
      <div className="dsh-rw-session-assistant">
        <RichText text={props.entry.text} streaming={props.entry.streaming === true} />
        {props.entry.interrupted === true && (
          <p className="dsh-rw-session-interrupted">{t('session.message.interrupted')}</p>
        )}
        {props.entry.streaming !== true && <OfficialMessageActions text={props.entry.text} clock="end" />}
      </div>
    </div>
  )
}

/** Render one reasoning block through the official rc.3 `ReasoningRow`. */
function OfficialReasoningRow(props: { ui: OfficialChatExports; entry: SessionTimelineReasoningEntry }): ReactElement {
  const Reasoning = props.ui.ReasoningRow as any
  return (
    <Reasoning
      text={props.entry.text}
      running={props.entry.streaming === true}
      useDisclosure={useOfficialDisclosure}
      usePresentation={useOfficialPresentation}
      renderSlot={(_name: string, slotProps: any) => (
        <RichText text={String(slotProps?.text ?? '')} streaming={props.entry.streaming === true} compact />
      )}
      t={officialChatT}
    />
  )
}

/** One reasoning row; official component once loaded. */
function ReasoningRow(props: { entry: SessionTimelineReasoningEntry }): ReactElement {
  const ui = useOfficialChatUi()
  if (ui !== null) return <OfficialReasoningRow ui={ui} entry={props.entry} />
  return <FallbackReasoningRow entry={props.entry} />
}

/** Locale bridge for the official approval panel. */
function officialApprovalT(key: string, vars?: Record<string, string | number>): string {
  if (key === 'waiting') return '等待审批'
  if (key === 'detail.aria') return '审批详情'
  if (key === 'escalation') return `工具 ${String(vars?.['toolName'] ?? '')} 请求越权执行`
  if (key === 'reject') return '拒绝'
  if (key === 'allowOnce') return '允许一次'
  return key
}

/** Render one pending approval through the official rc.3 ApprovalPanel. */
function OfficialApprovalRow(props: {
  ui: OfficialApprovalExports
  entry: SessionTimelineApprovalEntry
  onApproval: (approvalId: string, decision: SessionApprovalDecision) => void | Promise<void>
  disabled?: boolean | undefined
}): ReactElement {
  const Panel = props.ui.ApprovalPanel as any
  const { entry } = props
  const detail = entry.details === undefined
    ? null
    : <pre className="dsh-rw-session-tool-code">{typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details, null, 2)}</pre>
  const pending = {
    key: entry.approvalId,
    toolName: entry.toolName ?? '',
    callId: entry.callId,
    reason: entry.reason,
    answerable: entry.status === 'pending' && props.disabled !== true,
    answer: (outcome: 'allowed-once' | 'rejected') => Promise.resolve(
      props.onApproval(entry.approvalId, outcome === 'allowed-once' ? 'allow' : 'deny'),
    ),
  }
  return (
    <Panel
      matched={pending}
      renderSlot={(name: string) => (name === 'conversation.approval.detail' ? detail : null)}
      resolveReason={(value: string) => value}
      t={officialApprovalT}
    />
  )
}

/** Approval row: official pending panel, local settled-state summary. */
function ApprovalRow(props: {
  entry: SessionTimelineApprovalEntry
  onApproval: (approvalId: string, decision: SessionApprovalDecision) => void | Promise<void>
  disabled?: boolean | undefined
}): ReactElement {
  const [ui, setUi] = useState<OfficialApprovalExports | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadOfficialApprovalUi().then(
      value => { if (!cancelled) setUi(value) },
      () => { if (!cancelled) setUi(null) },
    )
    return () => { cancelled = true }
  }, [])
  if (ui !== null && props.entry.status === 'pending') {
    return <OfficialApprovalRow ui={ui} entry={props.entry} onApproval={props.onApproval} disabled={props.disabled} />
  }
  return <SessionApprovalCard entry={props.entry} onDecision={props.onApproval} disabled={props.disabled} />
}

/** Collapsed reasoning block while the official bundle loads. */
function FallbackReasoningRow(props: { entry: SessionTimelineReasoningEntry }): ReactElement {
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
          <ApprovalRow entry={entry} onApproval={props.onApproval} disabled={props.disabled} />
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

/** Load the official trajectory table and its locale once per page. */
function useOfficialTrajectory(): OfficialTrajectoryExports | null {
  const [ui, setUi] = useState<OfficialTrajectoryExports | null>(null)
  useEffect(() => {
    let live = true
    void loadOfficialTrajectoryUi().then(
      value => { if (live) setUi(value) },
      () => { /* keep the local fallback */ },
    )
    return () => { live = false }
  }, [])
  return ui
}

function trajectoryTranslate(zh: Record<string, string>): (key: string, vars?: Record<string, string | number>) => string {
  return (key, vars) => {
    const value = zh[key] ?? key
    if (vars === undefined) return value
    return value.replace(/\{(\w+)\}/gu, (_, name: string) => String(vars[name] ?? `{${name}}`))
  }
}

function trajectoryCells(entries: readonly SessionTimelineEntry[]): {
  turns: readonly { turn: number; groups: readonly { title: string; cells: readonly Record<string, unknown>[] }[] }[]
  count: number
} {
  const cells: Record<string, unknown>[] = []
  let index = 0
  for (const entry of entries) {
    if (entry.kind === 'unknown') continue
    const next: Record<string, unknown> = { index: ++index, timeSeconds: null }
    if (entry.kind === 'user') Object.assign(next, { kind: 'user', text: entry.text })
    else if (entry.kind === 'assistant') Object.assign(next, { kind: 'message', text: entry.text })
    else if (entry.kind === 'reasoning') Object.assign(next, { kind: 'message', text: `${t('session.trace.reasoning')}：${entry.text}` })
    else if (entry.kind === 'tool-result') {
      Object.assign(next, {
        kind: 'tool', text: entry.name ?? t('session.tool.result'), toolName: entry.name,
        result: entry.output, isError: entry.isError === true,
      })
    } else if (entry.kind === 'tool-call') {
      Object.assign(next, { kind: 'tool', text: entry.name, toolName: entry.name })
    } else if (entry.kind === 'error') Object.assign(next, { kind: 'context', text: entry.message })
    else if (entry.kind === 'approval') Object.assign(next, { kind: 'context', text: t('session.trace.result') })
    cells.push(next)
  }
  return { turns: [{ turn: 1, groups: [{ title: '', cells }] }], count: index }
}

/** Official trajectory table when the vendored bundle is ready. */
function OfficialSessionTrace({ entries, ui }: { entries: readonly SessionTimelineEntry[]; ui: OfficialTrajectoryExports }): ReactElement {
  const table = ui.TrajectoryTable as (props: Record<string, unknown>) => ReactElement
  const data = trajectoryCells(entries)
  const collapsedTurns = useMemo(() => new Set<number>(), [])
  const collapsedAssistants = useMemo(() => new Set<string>(), [])
  return (
    <div className="dsh-rw-trace dsh-rw-trace-official" role="region" aria-label={t('session.view.trace')}>
      {table({
        t: trajectoryTranslate(ui.trajectoryZh),
        turns: data.turns,
        renderSlot: () => null,
        loadImage: () => Promise.resolve(''),
        requestNumbers: [],
        collapsedTurns,
        onToggleTurn: () => {},
        collapsedAssistants,
        onToggleAssistant: () => {},
        onSelectedIndexChange: () => {},
        onRecordSelect: () => {},
        hasOlderRecords: false,
      })}
    </div>
  )
}

/** Compact trajectory view; falls back until the official table is loaded. */
function SessionTrace(props: { entries: readonly SessionTimelineEntry[] }): ReactElement {
  const official = useOfficialTrajectory()
  if (official !== null) return <OfficialSessionTrace entries={props.entries} ui={official} />
  const rows = props.entries.filter(entry =>
    entry.kind === 'user' || entry.kind === 'assistant' || entry.kind === 'reasoning'
    || entry.kind === 'tool-call' || entry.kind === 'tool-result' || entry.kind === 'error',
  )
  return (
    <div className="dsh-rw-trace" role="log">
      {rows.map(entry => {
        const label = entry.kind === 'user' ? t('session.trace.user')
          : entry.kind === 'assistant' ? t('session.trace.assistant')
            : entry.kind === 'reasoning' ? t('session.trace.reasoning')
              : entry.kind === 'tool-call' ? `${t('session.trace.tool')} · ${entry.name}`
                : entry.kind === 'tool-result' ? `${t('session.trace.result')}${entry.name === undefined ? '' : ` · ${entry.name}`}`
                  : t('session.trace.error')
        const text = entry.kind === 'user' || entry.kind === 'assistant' || entry.kind === 'reasoning'
          ? entry.text
          : entry.kind === 'tool-result' ? entry.output
            : entry.kind === 'error' ? entry.message : ''
        return (
          <div key={`trace:${entry.id}`} className="dsh-rw-trace-row" data-kind={entry.kind}>
            <span className="dsh-rw-trace-label">{label}</span>
            <span className="dsh-rw-trace-text">{text.length > 260 ? `${text.slice(0, 260)}…` : text}</span>
          </div>
        )
      })}
    </div>
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
  const [attachments, setAttachments] = useState<readonly ComposerAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | undefined>(undefined)
  const [commands, setCommands] = useState<readonly ComposerCommand[]>([])
  const [models, setModels] = useState<readonly ComposerModelGroup[]>([])
  const [modelLoading, setModelLoading] = useState(false)
  const [modelLabel, setModelLabel] = useState<string | undefined>(props.modelLabel)
  const [modelEffort, setModelEffort] = useState<string | undefined>(props.modelEffort)
  const [permissionLabel, setPermissionLabel] = useState<string | undefined>(props.permissionLabel)
  const listCommandsRef = useRef(props.onListCommands)
  listCommandsRef.current = props.onListCommands
  const listModelsRef = useRef(props.onListModels)
  listModelsRef.current = props.onListModels
  const [stick, setStick] = useState(true)
  const [view, setView] = useState<'conversation' | 'trace'>('conversation')
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
  // A completed call is represented by its result card; showing both duplicates
  // the tool name/status. Internal no-op events are not part of the transcript.
  const visibleEntries = useMemo(() => {
    const answered = new Set<string>()
    for (const entry of props.entries) {
      if (entry.kind === 'tool-result') answered.add(entry.callId)
    }
    return props.entries.filter(entry =>
      entry.kind !== 'unknown'
      && !(entry.kind === 'tool-call' && answered.has(entry.callId)),
    )
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

  const addFiles = (files: readonly File[]): void => {
    setAttachmentError(undefined)
    const room = Math.max(0, 4 - attachments.length)
    const accepted = files.slice(0, room)
    if (accepted.length === 0) return
    for (const file of accepted) {
      if (file.size > 600 * 1024) {
        setAttachmentError(t('session.composer.attachmentTooLarge', { name: file.name }))
        continue
      }
      const reader = new FileReader()
      reader.addEventListener('load', () => {
        const dataUrl = reader.result
        if (typeof dataUrl !== 'string') return
        setAttachments(current => current.length >= 4 ? current : [...current, {
          id: newClientId(),
          name: file.name,
          mediaType: file.type || 'application/octet-stream',
          dataUrl,
          size: file.size,
        }])
      })
      reader.readAsDataURL(file)
    }
  }
  const removeAttachment = (id: string): void => {
    setAttachments(current => current.filter(item => item.id !== id))
  }
  useEffect(() => {
    let cancelled = false
    const load = listCommandsRef.current
    if (load === undefined) return
    void load().then((next) => { if (!cancelled) setCommands(next) }).catch(() => {})
    return () => { cancelled = true }
  }, [props.request.sessionId])
  useEffect(() => {
    let cancelled = false
    const load = listModelsRef.current
    if (load === undefined) return
    setModelLoading(true)
    void load()
      .then((next) => {
        if (cancelled) return
        setModels(next)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setModelLoading(false) })
    return () => { cancelled = true }
  }, [props.request.sessionId])
  const send = (nextText?: string, nextAttachments?: readonly ComposerAttachment[]): void => {
    const text = (nextText ?? draft).trim()
    if (text === '' || disabled || running) return
    if (text.startsWith('/') && props.onCommand !== undefined) {
      setDraft('')
      void Promise.resolve(props.onCommand(text)).catch(() => {})
      return
    }
    const pending = nextAttachments ?? attachments
    setDraft('')
    setAttachments([])
    void Promise.resolve(props.onSend(text, newClientId(), pending)).catch(() => {
      // The integration turns the failure into `props.error`; keep the draft
      // out of the timeline's optimistic path so it does not duplicate.
    })
  }
  const switchPermission = (preset: string): void => {
    const labels: Record<string, string> = {
      'read-only': t('session.composer.permission.readOnly'),
      'workspace-write': t('session.composer.permission.workspaceWrite'),
      'danger-full-access': t('session.composer.permission.fullAccess'),
    }
    setPermissionLabel(labels[preset] ?? preset)
    if (draft.startsWith('/permission')) setDraft('')
    void Promise.resolve(props.onPermission?.(preset)).catch(() => {})
  }

  const chooseModel = (provider: string, model: string, reasoningEffort?: string): void => {
    const info = models.find(group => group.id === provider)?.models.find(item => item.id === model)
    setModelLabel(info?.name ?? model)
    setModelEffort(reasoningEffort)
    void Promise.resolve(props.onSelectModel?.(provider, model, reasoningEffort)).catch(() => {})
  }

  const composerProps = {
    value: draft,
    sessionId: props.request.sessionId,
    onChange: setDraft,
    onSend: send,
    onStop: () => { void props.onStop() },
    running,
    disabled,
    ...(props.attachmentReason === undefined ? {} : { attachmentReason: props.attachmentReason }),
    ...(attachmentError === undefined ? {} : { error: { message: attachmentError } }),
    permissionLabel,
    attachments,
    onAddFiles: addFiles,
    onRemoveAttachment: removeAttachment,
    commands,
    ...(props.onSearchFiles === undefined ? {} : { onSearchFiles: props.onSearchFiles }),
    permissionOptions: [
      { id: 'read-only', label: t('session.composer.permission.readOnly') },
      { id: 'workspace-write', label: t('session.composer.permission.workspaceWrite') },
      { id: 'danger-full-access', label: t('session.composer.permission.fullAccess') },
    ],
    onPermission: switchPermission,
    onCommandInput: (line: string) => { setDraft(current => current + line) },
    models,
    modelLoading,
    onSelectModel: chooseModel,
    ...(modelLabel === undefined ? {} : { modelLabel }),
    ...(modelEffort === undefined ? {} : { modelEffort }),
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
  const pathContext = useMemo<SessionPathContextValue>(() => ({
    targetId: props.request.targetId,
    ...(props.request.cwd === undefined ? {} : { cwd: props.request.cwd }),
  }), [props.request.targetId, props.request.cwd])

  if (hero) {
    return (
      <SessionPathContext.Provider value={pathContext}>
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
      </SessionPathContext.Provider>
    )
  }

  return (
    <SessionPathContext.Provider value={pathContext}>
    <section className="dsh-rw-session" aria-label={t('session.main.aria')} data-status={props.status}>
      <OfficialSessionHeader
        request={props.request}
        status={props.status}
        reconnecting={props.reconnecting === true}
        view={view}
        onView={setView}
        actions={(
          <SessionHeaderActions
            status={props.status}
            reconnecting={props.reconnecting === true}
            sessionId={props.request.sessionId}
            {...(props.onRetry === undefined ? {} : { onRetry: props.onRetry })}
          />
        )}
        utilities={(
          <SessionHeaderUtilities
            sessionId={props.request.sessionId}
          />
        )}
      />
      {banners}
      <div className="dsh-rw-session-scroll" ref={scroll} onScroll={onScroll}>
        <div className="dsh-rw-session-list" role="log" aria-live="polite" aria-relevant="additions text">
          {view === 'trace' ? (
            <SessionTrace entries={props.entries} />
          ) : (
            <>
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
              {visibleEntries.map(entry => (
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
            </>
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
    </SessionPathContext.Provider>
  )
}
