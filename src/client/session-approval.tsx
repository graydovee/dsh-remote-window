/**
 * Tool-approval card for the v2 native timeline.
 *
 * One pending approval renders the tool name, the server's reason and the
 * public details, plus allow/deny buttons. Decisions are reported upward; this
 * component never talks to the host itself and never invents a default.
 */
import { useState } from 'react'
import type { ReactElement } from 'react'
import {
  Button, IconCheckCircleFillRegular, IconWarningTriangleOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionApprovalDecision, SessionTimelineApprovalEntry } from './session-timeline.ts'
import { t } from './locales.ts'

/** Render public approval details without trusting their shape. */
function formatDetails(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** Props for one approval row. */
export interface SessionApprovalCardProps {
  readonly entry: SessionTimelineApprovalEntry
  /** Report the user's explicit decision for this approval. */
  readonly onDecision: (approvalId: string, decision: SessionApprovalDecision) => void | Promise<void>
  /** Disable while the parent is reconnecting or another action is pending. */
  readonly disabled?: boolean | undefined
}

/** One approval card. */
export function SessionApprovalCard(props: SessionApprovalCardProps): ReactElement {
  const [submitting, setSubmitting] = useState<SessionApprovalDecision | null>(null)
  const entry = props.entry
  const details = formatDetails(entry.details)
  const pending = entry.status === 'pending'
  const decide = (decision: SessionApprovalDecision): void => {
    if (!pending || submitting !== null || props.disabled === true) return
    setSubmitting(decision)
    void Promise.resolve(props.onDecision(entry.approvalId, decision)).finally(() => setSubmitting(null))
  }
  const tone = entry.status === 'denied' || entry.status === 'expired' ? 'warning' : 'success'
  return (
    <div className="dsh-rw-session-approval" data-status={entry.status}>
      <div className="dsh-rw-session-approval-head">
        <span className="dsh-rw-session-approval-icon" aria-hidden="true">
          {tone === 'warning'
            ? <IconWarningTriangleOutlineRegular size={15} />
            : <IconCheckCircleFillRegular size={15} />}
        </span>
        <strong>{t('session.approval.title')}</strong>
        {entry.toolName !== undefined && entry.toolName !== '' && (
          <code className="dsh-rw-session-approval-tool">{entry.toolName}</code>
        )}
        <span className="dsh-rw-session-approval-status">
          {t(`session.approval.status.${entry.status}` as Parameters<typeof t>[0])}
        </span>
      </div>
      {entry.reason !== undefined && entry.reason !== '' && (
        <p className="dsh-rw-session-approval-reason">{entry.reason}</p>
      )}
      {details !== undefined && <pre className="dsh-rw-session-tool-code">{details}</pre>}
      {pending && (
        <div className="dsh-rw-session-approval-actions">
          <Button
            variant="primary"
            size="sm"
            disabled={submitting !== null || props.disabled === true}
            onClick={() => decide('allow')}
          >
            {t('session.approval.allow')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={submitting !== null || props.disabled === true}
            onClick={() => decide('deny')}
          >
            {t('session.approval.deny')}
          </Button>
        </div>
      )}
    </div>
  )
}
