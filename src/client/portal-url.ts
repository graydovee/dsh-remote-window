/**
 * Pure plumbing for the v1 server-mode main area (`portal` + `embed`).
 *
 * Mirrors `doc/refactor-v1-protocol.md` §8 (same-origin portal) and §9 (official
 * UI embed). The iframe lifecycle belongs to `portal-main.tsx` (task-5); this
 * module owns the parts that must be exact and testable without a DOM:
 *
 *  - the portal URL/query the client constructs for one target (`dshRwSession`,
 *    theme, language and the parent-origin check);
 *  - the `postMessage` vocabulary (parent → iframe navigation and iframe →
 *    parent readiness), including strict version/origin validation;
 *  - the storage-event bridge the iframe uses to report its selected session
 *    (the official UI persists `dsh.sessions.current`, and the embed shim
 *    prefixes that key — no private API);
 *  - the small frame state machine (loading / ready / error / reload) the
 *    React container renders.
 */

/** Client-host portal prefix (protocol §8.1). */
export const PORTAL_PREFIX = '/dsh-remote-workspace/portal'

/** Embed query keys (protocol §9.3, plus the §16.2 fallback). */
export const EMBED_SESSION_PARAM = 'dshRwSession'
/** Fallback deep link (protocol §16.2): open the workspace's own draft. */
export const EMBED_WORKSPACE_PARAM = 'dshRwWorkspace'
export const EMBED_THEME_PARAM = 'dshRwTheme'
export const EMBED_LANG_PARAM = 'dshRwLang'
export const EMBED_PARENT_PARAM = 'dshRwParent'

/** Theme value forwarded to the embedded official UI (best-effort). */
export type EmbedTheme = 'light' | 'dark' | 'system'

/** Language value forwarded to the embedded official UI (best-effort). */
export type EmbedLang = 'zh-CN' | 'en-US'

/** How the iframe applies a navigation (server capability, protocol §2.3). */
export type EmbedNavigationMode = 'reload' | 'client-half'

/** Input for {@link portalUrl}. */
export interface PortalUrlInput {
  /** Connected target id; required (an unconnected target has no portal). */
  readonly targetId: string
  /** Session to open on the first load (the §16.2 primary path). */
  readonly sessionId?: string
  /** Workspace fallback deep link (§16.2 option b). */
  readonly workspaceId?: string
  /** Requested theme; omitted keeps the embedded UI's own choice. */
  readonly theme?: EmbedTheme
  /** Requested language; omitted keeps the embedded UI's own choice. */
  readonly lang?: EmbedLang
  /** Parent origin the embed script validates messages against. */
  readonly parentOrigin?: string
}

/**
 * The portal path for one target, with a trailing slash.
 *
 * The path is relative on purpose: the iframe is same-origin with the client
 * GUI, so a relative `src` keeps the browser on the client origin (and avoids
 * ever exposing profile-server authority).
 * @param targetId - connected target id.
 * @returns `/dsh-remote-workspace/portal/<encoded targetId>/`.
 */
export function portalPath(targetId: string): string {
  if (targetId === '') throw new TypeError('portalPath: targetId must not be empty')
  return `${PORTAL_PREFIX}/${encodeURIComponent(targetId)}/`
}

/**
 * Build the iframe's initial URL (protocol §9.3).
 *
 * Query parameters are ordered deterministically (session, theme, lang, parent)
 * so tests and diagnostics compare one stable string.
 * @param input - target and optional embed hints.
 * @returns the relative portal URL.
 */
export function portalUrl(input: PortalUrlInput): string {
  const params = new URLSearchParams()
  if (input.sessionId !== undefined && input.sessionId !== '') {
    params.set(EMBED_SESSION_PARAM, input.sessionId)
  }
  if (input.workspaceId !== undefined && input.workspaceId !== '') {
    params.set(EMBED_WORKSPACE_PARAM, input.workspaceId)
  }
  if (input.theme !== undefined) params.set(EMBED_THEME_PARAM, input.theme)
  if (input.lang !== undefined) params.set(EMBED_LANG_PARAM, input.lang)
  if (input.parentOrigin !== undefined && input.parentOrigin !== '') {
    params.set(EMBED_PARENT_PARAM, input.parentOrigin)
  }
  const query = params.toString()
  return query === '' ? portalPath(input.targetId) : `${portalPath(input.targetId)}?${query}`
}

/** Values the embed bootstrap reads from its own URL query (server side). */
export interface PortalQuery {
  readonly sessionId?: string
  readonly workspaceId?: string
  readonly theme?: EmbedTheme
  readonly lang?: EmbedLang
  readonly parentOrigin?: string
}

/** Narrow a theme string. */
export function isEmbedTheme(value: unknown): value is EmbedTheme {
  return value === 'light' || value === 'dark' || value === 'system'
}

/** Narrow a language string. */
export function isEmbedLang(value: unknown): value is EmbedLang {
  return value === 'zh-CN' || value === 'en-US'
}

/**
 * Read the embed hints from a search string (`?dshRwSession=…`).
 *
 * Unknown/invalid values are dropped instead of failing: the iframe must still
 * open when a future client sends a hint this version does not know.
 * @param search - `location.search` (a leading `?` is optional).
 * @returns the recognized hints.
 */
export function parsePortalQuery(search: string): PortalQuery {
  const params = new URLSearchParams(search)
  const sessionId = params.get(EMBED_SESSION_PARAM)
  const workspaceId = params.get(EMBED_WORKSPACE_PARAM)
  const theme = params.get(EMBED_THEME_PARAM)
  const lang = params.get(EMBED_LANG_PARAM)
  const parent = params.get(EMBED_PARENT_PARAM)
  return {
    ...(sessionId === null || sessionId === '' ? {} : { sessionId }),
    ...(workspaceId === null || workspaceId === '' ? {} : { workspaceId }),
    ...(isEmbedTheme(theme) ? { theme } : {}),
    ...(isEmbedLang(lang) ? { lang } : {}),
    ...(parent === null || parent === '' ? {} : { parentOrigin: parent }),
  }
}

/**
 * Whether one absolute URL belongs to a target's portal document.
 *
 * Used to validate `StorageEvent.url`: a same-origin storage event fires for
 * every iframe, so the parent must only accept the one it owns (protocol §9.3).
 * @param candidate - event URL or iframe URL.
 * @param targetId - the target whose iframe is the only accepted source.
 * @returns true when the path is exactly inside that target's portal.
 */
export function portalUrlMatches(candidate: string, targetId: string): boolean {
  if (targetId === '' || candidate === '') return false
  let parsed: URL
  try {
    parsed = new URL(candidate, 'http://portal.local')
  } catch {
    return false
  }
  const prefix = portalPath(targetId)
  return parsed.pathname === prefix || parsed.pathname.startsWith(prefix)
}

/* --------------------------------------------------- postMessage vocabulary */

/** Parent → iframe: switch the embedded conversation. */
export interface OpenSessionMessage {
  readonly v: 1
  readonly type: 'dsh-rw/open-session'
  readonly sessionId: string
}

/** Parent → iframe: best-effort theme/language sync. */
export interface ThemeMessage {
  readonly v: 1
  readonly type: 'dsh-rw/theme'
  readonly theme: EmbedTheme
  readonly lang?: EmbedLang
}

/** Parent → iframe: diagnostic/recovery reload. */
export interface ReloadMessage {
  readonly v: 1
  readonly type: 'dsh-rw/reload'
}

/** Messages the client main area posts into the iframe. */
export type ParentMessage = OpenSessionMessage | ThemeMessage | ReloadMessage

/** iframe → parent: the official UI has booted. */
export interface ReadyMessage {
  readonly v: 1
  readonly type: 'dsh-rw/ready'
}

/** Messages the embedded page posts to the client main area. */
export type ChildMessage = ReadyMessage

/** Build one navigation message. */
export function openSessionMessage(sessionId: string): OpenSessionMessage {
  if (sessionId === '') throw new TypeError('openSessionMessage: sessionId must not be empty')
  return { v: 1, type: 'dsh-rw/open-session', sessionId }
}

/** Build one theme message. */
export function themeMessage(theme: EmbedTheme, lang?: EmbedLang): ThemeMessage {
  return { v: 1, type: 'dsh-rw/theme', theme, ...(lang === undefined ? {} : { lang }) }
}

/** Build one reload message. */
export function reloadMessage(): ReloadMessage {
  return { v: 1, type: 'dsh-rw/reload' }
}

/** Whether a message event came from the origin this main area expects. */
export function isTrustedMessageOrigin(origin: string, expectedOrigin: string): boolean {
  return origin !== '' && expectedOrigin !== '' && origin === expectedOrigin
}

/**
 * Validate one parent → iframe message (runs inside the embedded page).
 * @param data - `MessageEvent.data`.
 * @returns the typed message, or undefined when the shape/version is wrong.
 */
export function parseParentMessage(data: unknown): ParentMessage | undefined {
  if (data === null || typeof data !== 'object') return undefined
  const message = data as { v?: unknown; type?: unknown; sessionId?: unknown; theme?: unknown; lang?: unknown }
  if (message.v !== 1) return undefined
  switch (message.type) {
    case 'dsh-rw/open-session':
      return typeof message.sessionId === 'string' && message.sessionId !== ''
        ? { v: 1, type: 'dsh-rw/open-session', sessionId: message.sessionId }
        : undefined
    case 'dsh-rw/theme':
      if (!isEmbedTheme(message.theme)) return undefined
      return {
        v: 1,
        type: 'dsh-rw/theme',
        theme: message.theme,
        ...(isEmbedLang(message.lang) ? { lang: message.lang } : {}),
      }
    case 'dsh-rw/reload':
      return { v: 1, type: 'dsh-rw/reload' }
    default:
      return undefined
  }
}

/**
 * Validate one iframe → parent message (runs in the client GUI).
 * @param data - `MessageEvent.data`.
 * @returns the typed message, or undefined when the shape/version is wrong.
 */
export function parseChildMessage(data: unknown): ChildMessage | undefined {
  if (data === null || typeof data !== 'object') return undefined
  const message = data as { v?: unknown; type?: unknown }
  return message.v === 1 && message.type === 'dsh-rw/ready' ? { v: 1, type: 'dsh-rw/ready' } : undefined
}

/**
 * Parent-side gate for one iframe message.
 *
 * Both facts must hold before the payload is trusted: the event came from this
 * main area's only iframe (`sourceMatches`, checked by the caller against
 * `iframe.contentWindow`), and its origin equals the client GUI origin.
 * @param event - origin and decoded data from the DOM listener.
 * @param expectedOrigin - the client GUI origin recorded when the iframe opened.
 * @param sourceMatches - whether `event.source` is the current iframe window.
 * @returns the typed message, or undefined.
 */
export function acceptChildMessage(
  event: { readonly origin: string; readonly data: unknown },
  expectedOrigin: string,
  sourceMatches: boolean,
): ChildMessage | undefined {
  return sourceMatches && isTrustedMessageOrigin(event.origin, expectedOrigin)
    ? parseChildMessage(event.data)
    : undefined
}

/**
 * iframe-side gate for one parent message.
 * @param event - origin and decoded data from the embedded page's listener.
 * @param parentOrigin - `dshRwParent` (defaults to the iframe's own origin).
 * @returns the typed message, or undefined.
 */
export function acceptParentMessage(
  event: { readonly origin: string; readonly data: unknown },
  parentOrigin: string,
): ParentMessage | undefined {
  return isTrustedMessageOrigin(event.origin, parentOrigin)
    ? parseParentMessage(event.data)
    : undefined
}

/* -------------------------------------------------------- storage selection */

/** Official persisted selection key (ui-workspace writes this store). */
export const SELECTION_STORAGE_KEY = 'dsh.sessions.current'

/** One decoded selection snapshot; `{}` means "nothing selected". */
export interface SelectionSnapshot {
  readonly sessionId?: string
}

/**
 * The prefixed key the embed shim exposes for the official selection store.
 * @param storagePrefix - `capabilities.embed.storagePrefix` from the handshake.
 * @returns the key a `StorageEvent` must carry.
 */
export function selectionStorageKey(storagePrefix: string): string {
  if (storagePrefix === '') throw new TypeError('selectionStorageKey: prefix must not be empty')
  return `${storagePrefix}${SELECTION_STORAGE_KEY}`
}

/** Serialize one selection snapshot the way the official store does. */
export function selectionStorageValue(sessionId: string | undefined): string {
  return JSON.stringify(sessionId === undefined || sessionId === '' ? {} : { sessionId })
}

/**
 * Parse one persisted selection value.
 * @param value - raw `newValue`; `null` means the key was removed (cleared).
 * @returns the snapshot, or undefined when the bytes are not the contract.
 */
export function parseSelectionValue(value: string | null): SelectionSnapshot | undefined {
  if (value === null || value === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') return undefined
  const sessionId = (parsed as { sessionId?: unknown }).sessionId
  if (sessionId === undefined) return {}
  if (typeof sessionId !== 'string' || sessionId === '') return {}
  return { sessionId }
}

/**
 * Parent-side filter for one same-origin `storage` event.
 *
 * The official UI reports its selection by writing the prefixed
 * `dsh.sessions.current`; only that key, from this target's iframe URL, is
 * accepted. Every other storage event is another surface's business.
 * @param event - `key`, `newValue`, `url`, `storageArea` is `localStorage`.
 * @param input - target id and the handshake's storage prefix.
 * @returns the selected session, or undefined when the event is not ours.
 */
export function parseSelectionStorageEvent(
  event: {
    readonly key: string | null
    readonly newValue: string | null
    readonly url: string
  },
  input: { readonly targetId: string; readonly storagePrefix: string },
): SelectionSnapshot | undefined {
  if (input.storagePrefix === '') return undefined
  if (event.key !== selectionStorageKey(input.storagePrefix)) return undefined
  if (!portalUrlMatches(event.url, input.targetId)) return undefined
  return parseSelectionValue(event.newValue)
}

/* ------------------------------------------------------------ frame state */

/** Loading state of one server-mode iframe. */
export type PortalPhase = 'idle' | 'loading' | 'ready' | 'error'

/** A portal failure the main area can render (already scrubbed by the host). */
export interface PortalError {
  readonly code: string
  readonly message: string
}

/** State one iframe container renders. */
export interface PortalFrameState {
  readonly phase: PortalPhase
  readonly targetId?: string
  /** Session the sidebar asked for. */
  readonly requestedSessionId?: string
  /** Session the embedded UI reports (via the storage bridge). */
  readonly reportedSessionId?: string
  /** Navigation count, for diagnostics and to key a reload affordance. */
  readonly reloadCount: number
  readonly error?: PortalError
}

/** Initial state: no frame mounted. */
export const IDLE_PORTAL_FRAME: PortalFrameState = { phase: 'idle', reloadCount: 0 }

/** Actions the main-area container dispatches. */
export type PortalFrameAction =
  | { readonly type: 'open'; readonly targetId: string; readonly sessionId?: string }
  | { readonly type: 'navigate'; readonly sessionId?: string }
  | { readonly type: 'loaded' }
  | { readonly type: 'selection'; readonly sessionId?: string }
  | { readonly type: 'failed'; readonly error: PortalError }
  | { readonly type: 'retry' }
  | { readonly type: 'clear' }

/**
 * Reduce the iframe lifecycle.
 *
 * v1 navigates by having the embedded page reload itself (protocol §9.3), so a
 * requested session change moves the frame back to `loading` and bumps
 * `reloadCount`; `ready`/`selection` during that window are ignored until the
 * document reports itself loaded again. A failure keeps the target identity so
 * the retry can reuse it.
 * @param state - current state.
 * @param action - UI action.
 * @returns the next state.
 */
export function portalFrameReducer(state: PortalFrameState, action: PortalFrameAction): PortalFrameState {
  switch (action.type) {
    case 'open':
      return {
        phase: 'loading',
        targetId: action.targetId,
        ...(action.sessionId === undefined ? {} : { requestedSessionId: action.sessionId }),
        reloadCount: state.targetId === action.targetId ? state.reloadCount : state.reloadCount + 1,
      }
    case 'navigate':
      if (state.phase === 'idle' || state.targetId === undefined) return state
      return {
        ...state,
        phase: 'loading',
        requestedSessionId: action.sessionId,
        reloadCount: state.reloadCount + 1,
        error: undefined,
      }
    case 'loaded':
      if (state.phase !== 'loading') return state
      return { ...state, phase: 'ready' }
    case 'selection':
      if (state.phase === 'idle' || state.targetId === undefined) return state
      return {
        ...state,
        reportedSessionId: action.sessionId,
        ...(state.phase === 'loading' ? { phase: 'ready' as const } : {}),
      }
    case 'failed':
      if (state.phase === 'idle') return state
      return { ...state, phase: 'error', error: action.error }
    case 'retry':
      if (state.targetId === undefined) return state
      return { ...state, phase: 'loading', reloadCount: state.reloadCount + 1, error: undefined }
    case 'clear':
      return IDLE_PORTAL_FRAME
  }
}

/** Whether the embed capability applies navigation by reloading the document. */
export function embedNavigatesByReload(mode: EmbedNavigationMode): boolean {
  return mode === 'reload'
}

/**
 * Whether the sidebar session changed away from what the frame already shows.
 * @param frame - current frame state.
 * @param sessionId - the session the user just selected.
 * @returns true when a navigation message is required.
 */
export function needsEmbedNavigation(frame: PortalFrameState, sessionId: string | undefined): boolean {
  if (sessionId === undefined) return frame.requestedSessionId !== undefined
  return frame.requestedSessionId !== sessionId && frame.reportedSessionId !== sessionId
}
