/**
 * The **shared** server-authoritative session index used by both executor
 * modes (requirements §5 / D3): sidebar rows, titles and history all come from
 * the server plugin's P1 API, never from a client-side copy.
 *
 * This module deliberately reads only:
 *
 * - `session/list` → `SessionListValue` (protocol §5.2); the server plugin
 *   assembles it from the official session controller, the workspace registry
 *   membership order, the official pin/archive sets, and its JSONL title fold
 *   (`titleSource`); and
 * - `persist/open` + `persist/read` (read access) for one session's history.
 *
 * Read opens never take the official write lock, so showing a row cannot steal
 * a writer from the other executor. The returned headers keep the **server**
 * cwd; the local-mode routing re-anchors them on its private stub, while the
 * server-mode UI does not use this history path at all (its official UI follows
 * the log itself).
 *
 * Wire contract: `doc/refactor-v1-protocol.md` §5.2, §16.6/§16.8.
 */
import type { SessionEvent, SessionHeader, SessionSeedEventState } from '@deepseek-ai/dsh-session'
import { RW_METHODS } from '../protocol.ts'
import type { RwSessionRow } from '../protocol.ts'

/** One sidebar row (protocol §5.2; shared wire type). */
export type ServerSessionRow = RwSessionRow

/** The registry facts carried alongside the rows. */
export interface ServerRegistryFacts {
  readonly revision: string
  readonly epoch: string
  readonly stale?: boolean
}

/** One `session/list` answer, normalized. */
export interface ServerSessionList {
  readonly registry: ServerRegistryFacts
  readonly sessions: readonly ServerSessionRow[]
}

/** One read-only history read. */
export interface ServerSessionHistory {
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
  readonly eventState: SessionSeedEventState
  readonly inheritedEventCount: number
}

/** The P1 RPC surface needed by the index. */
export interface ServerSessionIndexRpc {
  request<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T>
}

/** Stable failure for a malformed server answer. */
export class ServerSessionIndexError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message)
    this.name = 'ServerSessionIndexError'
  }
}

/** One `persist/open` answer as the index consumes it. */
interface PersistOpenPayload {
  readonly handleId?: unknown
  readonly header?: unknown
  readonly eventCount?: unknown
  readonly inheritedEventCount?: unknown
  readonly events?: unknown
}

/** One `persist/read` answer. */
interface PersistReadPayload {
  readonly events?: unknown
  readonly eventState?: unknown
  readonly nextOffset?: unknown
}

/** Upper bound for one history walk; a corrupt cursor must not loop forever. */
const MAX_HISTORY_PAGES = 10_000

/** Whether a raw value is a plain object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Optional string field. */
function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Normalize one session row; `undefined` drops a malformed row. */
function rowOf(raw: unknown): ServerSessionRow | undefined {
  if (!isObject(raw)) return undefined
  const sessionId = optionalString(raw['sessionId'])
  if (sessionId === undefined) return undefined
  const projections = isObject(raw['projections']) ? raw['projections'] : undefined
  const values = projections !== undefined && isObject(projections['values']) ? projections['values'] : undefined
  const workspaces = raw['workspaceId']
  const origin = raw['origin'] === 'subagent' ? 'subagent' as const : undefined
  const formatStatus = raw['formatStatus'] === 'current' || raw['formatStatus'] === 'migration-required'
    ? raw['formatStatus']
    : undefined
  const title = optionalString(raw['title']) ?? (values === undefined ? undefined : optionalString(values['title']))
  const titleSourceRaw = raw['titleSource']
  const titleSource = titleSourceRaw === 'live' || titleSourceRaw === 'projection' || titleSourceRaw === 'log' || titleSourceRaw === 'fallback'
    ? titleSourceRaw
    : undefined
  const parentSessionId = optionalString(raw['parentSessionId'])
  const cwd = optionalString(raw['cwd'])
  // M2g: the row carries the execution end for its next turn (protocol §5.2).
  // A partial/older plugin omits it; absence means the server default, not an
  // empty value the UI has to special-case.
  const executor = raw['executor'] === 'local' ? 'local' as const : 'server' as const
  return {
    sessionId,
    ...(title === undefined ? {} : { title }),
    ...(titleSource === undefined ? {} : { titleSource }),
    executor,
    blank: raw['blank'] === true,
    running: raw['running'] === true,
    agentAvailable: raw['agentAvailable'] === true,
    ...(cwd === undefined ? {} : { cwd }),
    updatedAt: typeof raw['updatedAt'] === 'number' && Number.isFinite(raw['updatedAt']) ? raw['updatedAt'] : 0,
    ...(parentSessionId === undefined ? {} : { parentSessionId }),
    ...(origin === undefined ? {} : { origin }),
    ...(formatStatus === undefined ? {} : { formatStatus }),
    pinned: raw['pinned'] === true,
    archived: raw['archived'] === true,
    ...(optionalString(workspaces) === undefined ? {} : { workspaceId: optionalString(workspaces) as string }),
  }
}

/**
 * Normalize a `session/list` answer. P1 sends `{ registry, sessions }`; a
 * partial/older plugin may send the bare array, which is accepted without
 * pretending the registry facts are known.
 */
export function normalizeSessionList(raw: unknown): ServerSessionList {
  const rowsRaw = Array.isArray(raw)
    ? raw
    : isObject(raw) && Array.isArray(raw['sessions'])
      ? raw['sessions']
      : undefined
  if (rowsRaw === undefined) {
    throw new ServerSessionIndexError('server-index-invalid', 'session/list did not return a session array')
  }
  const registryRaw = isObject(raw) && isObject(raw['registry']) ? raw['registry'] : undefined
  const registry: ServerRegistryFacts = {
    revision: registryRaw === undefined ? '' : optionalString(registryRaw['revision']) ?? '',
    epoch: registryRaw === undefined ? '' : optionalString(registryRaw['epoch']) ?? '',
    ...(registryRaw !== undefined && registryRaw['stale'] === true ? { stale: true } : {}),
  }
  const sessions: ServerSessionRow[] = []
  for (const row of rowsRaw) {
    const normalized = rowOf(row)
    if (normalized !== undefined) sessions.push(normalized)
  }
  return { registry, sessions }
}

/**
 * Read-only view onto the server's authoritative session data.
 *
 * One instance per connected target. All methods are pure RPC + normalization;
 * no client cache is written here (the sidebar store owns presentation).
 */
export class ServerSessionIndex {
  constructor(private readonly rpc: ServerSessionIndexRpc) {}

  /**
   * List the server's sessions (all workspaces).
   * @param signal - caller cancellation.
   * @returns normalized rows plus the server's registry facts.
   */
  async list(signal?: AbortSignal): Promise<ServerSessionList> {
    const raw = await this.rpc.request<unknown>(RW_METHODS.sessionList, {}, signal)
    return normalizeSessionList(raw)
  }

  /**
   * Read one session's durable history without taking a write lock.
   *
   * The handle is closed in `finally`; a close failure is ignored so the read
   * result is never masked by teardown noise.
   * @param sessionId - stored server session id.
   * @param signal - caller cancellation.
   * @returns the header (server cwd) and every event currently stored.
   */
  async history(sessionId: string, signal?: AbortSignal): Promise<ServerSessionHistory> {
    if (sessionId.trim() === '') throw new ServerSessionIndexError('server-index-invalid', 'sessionId must not be empty')
    const opened = await this.rpc.request<PersistOpenPayload>(RW_METHODS.persistOpen, { sessionId, access: 'read' }, signal)
    const handleId = opened?.handleId
    const header = opened?.header
    if (typeof handleId !== 'string' || handleId === '' || !isObject(header)) {
      throw new ServerSessionIndexError('server-index-invalid', `persist/open returned no handle for "${sessionId}"`)
    }
    const events: SessionEvent[] = Array.isArray(opened.events) ? [...opened.events as SessionEvent[]] : []
    let eventState: SessionSeedEventState = 'detached'
    let offset = events.length
    try {
      for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
        const answer = await this.rpc.request<PersistReadPayload>(RW_METHODS.persistRead, { handleId, offset }, signal)
        const batch = Array.isArray(answer?.events) ? answer.events as SessionEvent[] : []
        events.push(...batch)
        if (answer?.eventState === 'detached' || answer?.eventState === 'shared-frozen') eventState = answer.eventState
        const next = typeof answer?.nextOffset === 'number' && Number.isSafeInteger(answer.nextOffset)
          ? answer.nextOffset
          : offset + batch.length
        if (batch.length === 0 || next <= offset) break
        offset = next
      }
    } finally {
      await this.rpc.request(RW_METHODS.persistClose, { handleId }).catch(() => {})
    }
    const inherited = typeof opened.inheritedEventCount === 'number' && opened.inheritedEventCount >= 0
      ? opened.inheritedEventCount
      : 0
    return {
      header: header as unknown as SessionHeader,
      events,
      eventState,
      inheritedEventCount: inherited,
    }
  }
}
