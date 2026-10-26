/**
 * Pure timeline model for the v2 native server conversation.
 *
 * The server plugin normalizes its JSONL log into `RwTimelineEntry` rows
 * (task-11/12); the client keeps one ordered view here. This module deliberately
 * owns only data mechanics: sequence-based deduplication, optimistic user
 * replacement, streaming upserts and `beforeSeq` pagination. It has no React,
 * no network and no DSH import, so every merge rule is unit-testable.
 */

/** One rendered timeline row kind. */
export type SessionTimelineEntryKind =
  | 'user'
  | 'assistant'
  | 'reasoning'
  | 'tool-call'
  | 'tool-result'
  | 'error'
  | 'approval'
  | 'turn'
  | 'unknown'

/** Fields shared by every timeline row. */
export interface SessionTimelineBase {
  /** Stable row identity; the server may use the JSONL event id. */
  readonly id: string
  /** Monotonic server sequence; absent only for an optimistic local row. */
  readonly seq?: number
  /** ISO-8601 or epoch ms, as received; display-only. */
  readonly createdAt?: string | number
}

/** A user turn's message. `clientId` ties an optimistic row to the server echo. */
export interface SessionTimelineUserEntry extends SessionTimelineBase {
  readonly kind: 'user'
  readonly text: string
  /** Client-generated request id; absent on rows restored from history. */
  readonly clientId?: string
  /** True while the row exists only locally (before the server echo). */
  readonly pending?: boolean
}

/** An assistant message. `streaming` renders the incremental Markdown path. */
export interface SessionTimelineAssistantEntry extends SessionTimelineBase {
  readonly kind: 'assistant'
  readonly text: string
  readonly streaming?: boolean
  /** The server marked the assistant message as interrupted by a cancel. */
  readonly interrupted?: true
}

/** Provider reasoning text; rendered in a collapsed disclosure. */
export interface SessionTimelineReasoningEntry extends SessionTimelineBase {
  readonly kind: 'reasoning'
  readonly text: string
  readonly streaming?: boolean
}

/** One tool invocation (before/while its result arrives). */
export interface SessionTimelineToolCallEntry extends SessionTimelineBase {
  readonly kind: 'tool-call'
  readonly callId: string
  readonly name: string
  /** Raw JSON arguments; rendered as text, never executed. */
  readonly arguments?: unknown
  readonly status?: 'running' | 'done' | 'error'
}

/** One tool result; long output is truncated by CSS/see-more, not dropped. */
export interface SessionTimelineToolResultEntry extends SessionTimelineBase {
  readonly kind: 'tool-result'
  readonly callId: string
  readonly name?: string
  readonly output: string
  readonly isError?: boolean
  /** The server already truncated the output before sending it. */
  readonly truncated?: boolean
}

/** A turn- or transport-level failure row. */
export interface SessionTimelineErrorEntry extends SessionTimelineBase {
  readonly kind: 'error'
  readonly code?: string
  readonly message: string
  readonly retryable?: boolean
}

/** Approval decisions supported by the composer's approval card. */
export type SessionApprovalDecision = 'allow' | 'deny'

/** One tool approval request or its settled state. */
export interface SessionTimelineApprovalEntry extends SessionTimelineBase {
  readonly kind: 'approval'
  readonly approvalId: string
  readonly callId?: string
  readonly toolName?: string
  readonly reason?: string
  readonly status: 'pending' | 'allowed' | 'denied' | 'expired'
  /** Public, already-scrubbed details from the server. */
  readonly details?: unknown
}

/** Marker between turns; useful for wide spacing and error context. */
export interface SessionTimelineTurnEntry extends SessionTimelineBase {
  readonly kind: 'turn'
  readonly turn: number
  readonly phase: 'start' | 'end'
  readonly status?: 'running' | 'completed' | 'cancelled' | 'error'
}

/** Fallback row for a server kind this client version does not know. */
export interface SessionTimelineUnknownEntry extends SessionTimelineBase {
  readonly kind: 'unknown'
  readonly text: string
  readonly label?: string
}

/** One normalized timeline row. */
export type SessionTimelineEntry =
  | SessionTimelineUserEntry
  | SessionTimelineAssistantEntry
  | SessionTimelineReasoningEntry
  | SessionTimelineToolCallEntry
  | SessionTimelineToolResultEntry
  | SessionTimelineErrorEntry
  | SessionTimelineApprovalEntry
  | SessionTimelineTurnEntry
  | SessionTimelineUnknownEntry

/** The client-side timeline state (one loaded page window). */
export interface SessionTimelineState {
  readonly entries: readonly SessionTimelineEntry[]
  /** Older rows exist behind `beforeSeq`. */
  readonly hasMoreBefore: boolean
}

/** Empty timeline. */
export const EMPTY_TIMELINE: SessionTimelineState = { entries: [], hasMoreBefore: false }

/** Input for one optimistic user row. */
export interface OptimisticUserInput {
  readonly clientId: string
  readonly text: string
  readonly createdAt?: number
}

/** Result of appending an optimistic user row. */
export interface OptimisticUserResult {
  readonly state: SessionTimelineState
  readonly entry: SessionTimelineUserEntry
}

/** One incremental event from `/api/session/events`. */
export type SessionTimelineEvent =
  | { readonly type: 'entry'; readonly entry: SessionTimelineEntry }
  | { readonly type: 'snapshot'; readonly entries: readonly SessionTimelineEntry[]; readonly hasMoreBefore: boolean }
  | {
    /** Replace the optimistic row identified by `clientId` with the server echo. */
    readonly type: 'replace-user'
    readonly clientId: string
    readonly entry: SessionTimelineUserEntry
  }

/** The numeric sequence of one row, when it has one. */
export function timelineSeq(entry: SessionTimelineEntry): number | undefined {
  return entry.seq
}

/** Newest known server sequence; used as `afterSeq` on reconnect. */
export function timelineAfterSeq(entries: readonly SessionTimelineEntry[]): number {
  let max = 0
  for (const entry of entries) {
    if (entry.seq !== undefined && entry.seq > max) max = entry.seq
  }
  return max
}

/** Oldest known server sequence; used as `beforeSeq` for history paging. */
export function timelineOldestSeq(entries: readonly SessionTimelineEntry[]): number | undefined {
  let min: number | undefined
  for (const entry of entries) {
    if (entry.seq === undefined) continue
    if (min === undefined || entry.seq < min) min = entry.seq
  }
  return min
}

/** Sort by sequence; rows without a sequence (optimistic) trail in input order. */
function sortEntries(entries: readonly SessionTimelineEntry[]): SessionTimelineEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftSeq = left.entry.seq
      const rightSeq = right.entry.seq
      if (leftSeq === undefined && rightSeq === undefined) return left.index - right.index
      if (leftSeq === undefined) return 1
      if (rightSeq === undefined) return -1
      if (leftSeq !== rightSeq) return leftSeq - rightSeq
      return left.index - right.index
    })
    .map(item => item.entry)
}

/** Whether `entry` is the server echo of an optimistic row. */
function isEchoOf(previous: SessionTimelineEntry, incoming: SessionTimelineEntry): boolean {
  if (previous.kind !== 'user' || previous.clientId === undefined) return false
  if (incoming.kind !== 'user') return false
  return previous.clientId === incoming.clientId
}

/**
 * Upsert one server row.
 *
 * Identity order: `clientId` echo (drops the optimistic row), exact `id`, then
 * `seq`. A replaced row keeps its position after the sequence sort, so a
 * streaming assistant/reasoning update does not jump the timeline.
 * @param entries - current rows.
 * @param incoming - server row.
 * @returns a new, deduplicated, sequence-sorted array.
 */
export function upsertTimelineEntry(
  entries: readonly SessionTimelineEntry[],
  incoming: SessionTimelineEntry,
): SessionTimelineEntry[] {
  const next: SessionTimelineEntry[] = []
  let replaced = false
  for (const entry of entries) {
    if (isEchoOf(entry, incoming)) {
      next.push(incoming)
      replaced = true
      continue
    }
    if (entry.id === incoming.id) {
      next.push(incoming)
      replaced = true
      continue
    }
    if (incoming.seq !== undefined && entry.seq === incoming.seq) {
      next.push(incoming)
      replaced = true
      continue
    }
    next.push(entry)
  }
  if (!replaced) next.push(incoming)
  return sortEntries(next)
}

/** Merge one page of server rows (deduplicating and sorting). */
export function mergeTimelineEntries(
  current: readonly SessionTimelineEntry[],
  incoming: readonly SessionTimelineEntry[],
): SessionTimelineEntry[] {
  let next = [...current]
  for (const entry of incoming) next = upsertTimelineEntry(next, entry)
  return next
}

/** Build one optimistic user row (no sequence until the server echoes it). */
export function optimisticUserEntry(input: OptimisticUserInput): SessionTimelineUserEntry {
  return {
    id: `local:${input.clientId}`,
    kind: 'user',
    text: input.text,
    clientId: input.clientId,
    pending: true,
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
  }
}

/** Append an optimistic user row and return both the new state and the row. */
export function appendOptimisticUser(
  state: SessionTimelineState,
  input: OptimisticUserInput,
): OptimisticUserResult {
  const entry = optimisticUserEntry(input)
  return {
    entry,
    state: { ...state, entries: upsertTimelineEntry(state.entries, entry) },
  }
}

/** Apply one incremental timeline event. */
export function applyTimelineEvent(
  state: SessionTimelineState,
  event: SessionTimelineEvent,
): SessionTimelineState {
  switch (event.type) {
    case 'entry':
      return { ...state, entries: upsertTimelineEntry(state.entries, event.entry) }
    case 'replace-user': {
      // Drop the optimistic row even if the echo carries a different id/seq.
      const withoutPending = state.entries.filter(entry =>
        !(entry.kind === 'user' && entry.clientId === event.clientId && entry.pending === true))
      return { ...state, entries: upsertTimelineEntry(withoutPending, event.entry) }
    }
    case 'snapshot':
      return {
        entries: mergeTimelineEntries([], event.entries),
        hasMoreBefore: event.hasMoreBefore,
      }
  }
}

/**
 * Prepend one older history page.
 *
 * The server's `beforeSeq` page may overlap the loaded window; upsert removes
 * the duplicates. `hasMoreBefore` comes from the page response.
 */
export function prependTimelinePage(
  state: SessionTimelineState,
  older: readonly SessionTimelineEntry[],
  hasMoreBefore: boolean,
): SessionTimelineState {
  return {
    entries: mergeTimelineEntries(state.entries, older),
    hasMoreBefore,
  }
}

/** Deduplicate a raw batch (history pages or a reconnect snapshot). */
export function dedupeTimeline(entries: readonly SessionTimelineEntry[]): SessionTimelineEntry[] {
  return mergeTimelineEntries([], entries)
}

/* ------------------------------------------------------------- server rows */

/** One server `session/timeline` entry (official-shaped, additive fields). */
export interface ServerTimelineEntry {
  readonly kind?: string
  readonly entryId?: string
  readonly id?: string
  readonly seq?: number
  readonly time?: string | number
  readonly createdAt?: string | number
  readonly role?: string
  readonly text?: string
  readonly content?: string
  readonly message?: string
  readonly callId?: string
  readonly name?: string
  readonly arguments?: unknown
  readonly args?: unknown
  readonly status?: string
  readonly output?: string
  readonly result?: string
  readonly isError?: boolean
  readonly truncated?: boolean
  readonly totalBytes?: number
  readonly approvalId?: string
  readonly toolName?: string
  readonly reason?: string
  readonly details?: unknown
  readonly state?: 'asked' | 'decided'
  readonly outcome?: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
  readonly code?: string
  readonly retryable?: boolean
  readonly turn?: number
  readonly phase?: string
  readonly type?: string
  readonly ignorable?: boolean
  readonly messageId?: string
  readonly clientId?: string
  readonly pending?: boolean
  readonly streaming?: boolean
  readonly [key: string]: unknown
}

/** One `session/timeline` page. */
export interface ServerTimelinePage {
  readonly entries?: readonly ServerTimelineEntry[]
  readonly afterSeq?: number
  readonly nextAfterSeq?: number
  readonly eventCount?: number
  readonly [key: string]: unknown
}

/** Adapt one server row to the client's normalized union. */
export function adaptServerTimelineEntry(raw: ServerTimelineEntry): SessionTimelineEntry {
  const id = typeof raw.entryId === 'string' && raw.entryId !== ''
    ? raw.entryId
    : typeof raw.id === 'string' && raw.id !== '' ? raw.id : `seq:${raw.seq ?? 'unknown'}`
  const createdAt = raw.time ?? raw.createdAt
  const base = {
    id,
    ...(typeof raw.seq === 'number' ? { seq: raw.seq } : {}),
    ...(createdAt === undefined ? {} : { createdAt }),
  }
  const text = typeof raw.text === 'string' ? raw.text
    : typeof raw.content === 'string' ? raw.content
      : typeof raw.message === 'string' ? raw.message : ''
  switch (raw.kind) {
    case 'user':
      return {
        ...base,
        kind: 'user',
        text,
        ...(typeof raw.clientId === 'string' ? { clientId: raw.clientId } : {}),
        ...(raw.pending === true ? { pending: true } : {}),
      }
    case 'assistant':
      return {
        ...base,
        kind: 'assistant',
        text,
        ...(raw.streaming === true ? { streaming: true } : {}),
        ...(raw.interrupted === true ? { interrupted: true as const } : {}),
      }
    case 'reasoning':
      return { ...base, kind: 'reasoning', text, ...(raw.streaming === true ? { streaming: true } : {}) }
    case 'tool-call':
      return {
        ...base,
        kind: 'tool-call',
        callId: typeof raw.callId === 'string' ? raw.callId : id,
        name: typeof raw.name === 'string' ? raw.name : 'tool',
        ...(raw.arguments !== undefined ? { arguments: raw.arguments } : raw.args !== undefined ? { arguments: raw.args } : {}),
        ...(raw.status === 'running' || raw.status === 'done' || raw.status === 'error' ? { status: raw.status } : {}),
      }
    case 'tool-result':
      return {
        ...base,
        kind: 'tool-result',
        callId: typeof raw.callId === 'string' ? raw.callId : id,
        ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
        output: typeof raw.output === 'string' ? raw.output
          : typeof raw.result === 'string' ? raw.result : text,
        ...(raw.isError === true ? { isError: true } : {}),
        ...(raw.truncated === true ? { truncated: true } : {}),
      }
    case 'approval': {
      // Official `RwTimelineEntry` uses asked/decided + outcome; the P3 state
      // message may also use a direct status. Prefer the explicit status.
      const direct = raw.status === 'pending' || raw.status === 'allowed' || raw.status === 'denied' || raw.status === 'expired'
        ? raw.status : undefined
      const status = direct ?? (raw.state === 'decided'
        ? raw.outcome === 'allowed-once' ? 'allowed' : raw.outcome === 'rejected' ? 'denied' : 'expired'
        : 'pending')
      return {
        ...base,
        kind: 'approval',
        approvalId: typeof raw.approvalId === 'string' && raw.approvalId !== '' ? raw.approvalId : id,
        ...(typeof raw.callId === 'string' ? { callId: raw.callId } : {}),
        ...(typeof raw.toolName === 'string' ? { toolName: raw.toolName } : raw.name !== undefined ? { toolName: String(raw.name) } : {}),
        ...(typeof raw.reason === 'string' ? { reason: raw.reason } : {}),
        ...(raw.state === 'asked' || raw.state === 'decided' ? { state: raw.state } : {}),
        ...(raw.outcome === 'allowed-once' || raw.outcome === 'rejected' || raw.outcome === 'cancelled' || raw.outcome === 'unavailable'
          ? { outcome: raw.outcome } : {}),
        status,
        ...(raw.details === undefined ? {} : { details: raw.details }),
      }
    }
    case 'error':
      return {
        ...base,
        kind: 'error',
        ...(typeof raw.code === 'string' ? { code: raw.code } : {}),
        message: text === '' ? 'server reported an error' : text,
        ...(raw.retryable === true ? { retryable: true } : {}),
      }
    case 'turn':
      return {
        ...base,
        kind: 'turn',
        turn: typeof raw.turn === 'number' ? raw.turn : 0,
        phase: raw.phase === 'end' ? 'end' : 'start',
        ...(raw.status === 'running' || raw.status === 'completed' || raw.status === 'cancelled' || raw.status === 'error'
          ? { status: raw.status } : {}),
      }
    default:
      return {
        ...base,
        kind: 'unknown',
        text: text === '' ? JSON.stringify(raw) : text,
        ...(typeof raw.type === 'string' ? { label: raw.type }
          : typeof raw.kind === 'string' ? { label: raw.kind } : {}),
      }
  }
}

/** Adapt one server page; returns the cursor the next call should send. */
export function adaptServerTimelinePage(raw: ServerTimelinePage): {
  readonly entries: SessionTimelineEntry[]
  readonly afterSeq?: number
  readonly nextAfterSeq?: number
  readonly eventCount?: number
} {
  const entries = (raw.entries ?? []).map(adaptServerTimelineEntry)
  return {
    entries: dedupeTimeline(entries),
    ...(typeof raw.afterSeq === 'number' ? { afterSeq: raw.afterSeq } : {}),
    ...(typeof raw.nextAfterSeq === 'number' ? { nextAfterSeq: raw.nextAfterSeq } : {}),
    ...(typeof raw.eventCount === 'number' ? { eventCount: raw.eventCount } : {}),
  }
}

/** Whether the timeline has no rows yet (the empty state). */
export function timelineIsEmpty(state: SessionTimelineState): boolean {
  return state.entries.length === 0
}
