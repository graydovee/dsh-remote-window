/**
 * The v1 **server-mode main area**: the same-origin iframe that hosts the
 * profile server's own official DSH UI (protocol §8/§9).
 *
 * The iframe is the only surface here; no conversation is redrawn. The client
 * sidebar is the only navigation (the server plugin's embed CSS hides the
 * official sidebar/rightbar), and the two sides talk through exactly the
 * contract in `portal-url.ts`:
 *
 *  - parent → iframe: `dsh-rw/open-session` / `dsh-rw/theme` / `dsh-rw/reload`;
 *  - iframe → parent: `dsh-rw/ready` plus same-origin `storage` events on the
 *    prefixed `dsh.sessions.current` key (never a private service API).
 *
 * v1 navigates by letting the embedded page reload itself (the known UX cost in
 * protocol §9.3); the frame reducer therefore keeps the `src` stable and only
 * changes what the sidebar requested.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import {
  Button, IconRefreshOutlineRegular, IconWarningTriangleOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContext } from './context.ts'
import { t } from './locales.ts'
import {
  IDLE_PORTAL_FRAME,
  acceptChildMessage,
  needsEmbedNavigation,
  openSessionMessage,
  parseSelectionStorageEvent,
  portalFrameReducer,
  portalUrl,
  type EmbedLang,
  type EmbedNavigationMode,
  type EmbedTheme,
  type PortalFrameState,
} from './portal-url.ts'

/** Main-slot key for the server-mode conversation area. */
export const SERVER_MAIN_ID = 'dsh-remote-workspace-server'

/** Everything one mounted server main area needs. */
export interface ServerMainRequest {
  readonly targetId: string
  /** Connection label, used only for the accessible region name. */
  readonly targetLabel: string
  /** Workspace shown by the embedded draft (fallback deep link §16.2 b). */
  readonly workspaceId?: string
  /** Session to open; the primary §16.2 a deep link. */
  readonly sessionId?: string
  /** `capabilities.embed.storagePrefix` from the handshake. */
  readonly storagePrefix: string
  /** `capabilities.embed.mode`: reload (v1) or client-half (v1.1). */
  readonly embedMode: EmbedNavigationMode
  readonly theme?: EmbedTheme
  readonly lang?: EmbedLang
}

/** The panel store: which target/session the main area currently shows. */
interface ServerMainState {
  readonly request?: ServerMainRequest
  /** Session reported by the embedded UI's storage bridge. */
  readonly reportedSessionId?: string
}

let state: ServerMainState = {}
const listeners = new Set<() => void>()

function commit(patch: Partial<ServerMainState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function snapshot(): ServerMainState {
  return state
}

/** Open (or re-point) the server-mode main area. */
export function openServerMain(request: ServerMainRequest): void {
  commit({ request, reportedSessionId: request.sessionId })
}

/** Ask the embedded UI to show another session (v1 reloads the document). */
export function navigateServerMain(sessionId: string | undefined): void {
  if (state.request === undefined) return
  commit({
    request: { ...state.request, ...(sessionId === undefined ? { sessionId: undefined } : { sessionId }) },
    reportedSessionId: sessionId,
  })
}

/** Tear the main area down (disconnect / mode switch / target switch). */
export function closeServerMain(): void {
  if (state.request === undefined) return
  commit({ request: undefined, reportedSessionId: undefined })
}

/** Session the embedded official UI reports as selected, when one is mounted. */
export function serverMainSessionId(): string | undefined {
  const request = state.request
  if (request === undefined) return undefined
  return state.reportedSessionId ?? request.sessionId
}

/** Subscribe to the reported selection (the tree's remote highlight source). */
export function subscribeServerMain(listener: () => void): () => void {
  return subscribe(listener)
}

/** Read the panel request outside React. */
export function serverMainRequest(): ServerMainRequest | undefined {
  return state.request
}

/** The client context, for the public `layout.selectPanel` deselect path. */
let clientContext: ClientContext | undefined

/** Bind the context used to return to the official conversation panel. */
export function bindServerMainContext(ctx: ClientContext): void {
  clientContext = ctx
}

function selectConversationPanel(): void {
  try {
    const layout = clientContext?.get('layout') as { selectPanel?(id: string | null): void } | undefined
    layout?.selectPanel?.(null)
  } catch (error) {
    console.error('[dsh-remote-workspace] returning to the conversation panel failed', error)
  }
}

/** Read the document's theme into the embed hint (best-effort, §9.3). */
function documentTheme(): EmbedTheme {
  if (typeof document === 'undefined') return 'system'
  const root = document.documentElement
  if (root.hasAttribute('data-ds-dark-theme')) return 'dark'
  if (root.getAttribute('data-ds-theme') === 'light') return 'light'
  return 'system'
}

/** Current UI language as the embed hint. */
function documentLang(): EmbedLang {
  if (typeof document !== 'undefined' && document.documentElement.lang.startsWith('en')) return 'en-US'
  return 'zh-CN'
}

/** Hook: the panel request/snapshot. */
function useServerMain(): ServerMainState {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/**
 * One iframe's lifecycle, kept as a thin adapter over the pure reducer.
 * @param request - current target/session request.
 * @returns frame state and the two user-recovery actions.
 */
function usePortalFrame(request: ServerMainRequest | undefined): {
  frame: PortalFrameState
  setFrame: (update: (previous: PortalFrameState) => PortalFrameState) => void
  retry: () => void
} {
  const [frame, setFrame] = useState<PortalFrameState>(IDLE_PORTAL_FRAME)
  const dispatch = useCallback((action: Parameters<typeof portalFrameReducer>[1]) => {
    setFrame(previous => portalFrameReducer(previous, action))
  }, [])

  useEffect(() => {
    if (request === undefined) {
      dispatch({ type: 'clear' })
      return
    }
    setFrame(previous => portalFrameReducer(previous, {
      type: 'open',
      targetId: request.targetId,
      ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
    }))
    // The request identity (not each field) is the navigation unit; a thematic
    // change is applied by the message effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.targetId, dispatch])

  return {
    frame,
    setFrame,
    retry: () => dispatch({ type: 'retry' }),
  }
}

/** The iframe + its loading/error chrome. */
export function ServerMainArea(props: { request: ServerMainRequest }): ReactElement {
  const { request } = props
  const { frame, setFrame, retry } = usePortalFrame(request)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const dispatchSelection = useCallback((sessionId: string | undefined) => {
    commit({ reportedSessionId: sessionId })
    setFrame(previous => portalFrameReducer(previous, { type: 'selection', ...(sessionId === undefined ? {} : { sessionId }) }))
  }, [])
  const expectedOrigin = typeof window === 'undefined' ? '' : window.location.origin
  const src = portalUrl({
    targetId: request.targetId,
    ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
    ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
    theme: request.theme ?? documentTheme(),
    lang: request.lang ?? documentLang(),
    ...(expectedOrigin === '' ? {} : { parentOrigin: expectedOrigin }),
  })

  // A sidebar selection made after the frame is ready becomes a navigation.
  // The initial open already carries the session in the query, so only a later
  // change (or one made while another session is displayed) needs this hop.
  useEffect(() => {
    if (request.sessionId === undefined) return
    if (frame.phase === 'idle' || frame.targetId !== request.targetId) return
    if (!needsEmbedNavigation(frame, request.sessionId)) return
    setFrame(previous => portalFrameReducer(previous, { type: 'navigate', sessionId: request.sessionId }))
  }, [request.sessionId, request.targetId, frame])

  // Parent → iframe navigation. The iframe keeps its document; the embed shim
  // reloads it after persisting the requested selection (v1).
  useEffect(() => {
    if (frame.phase !== 'loading') return
    if (!needsEmbedNavigation(frame, request.sessionId)) return
    const target = iframeRef.current?.contentWindow
    if (target === null || target === undefined) return
    if (request.sessionId !== undefined) {
      target.postMessage(openSessionMessage(request.sessionId), expectedOrigin)
    }
  }, [frame, request.sessionId, expectedOrigin])

  // iframe → parent readiness.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onMessage = (event: MessageEvent): void => {
      const iframe = iframeRef.current
      const message = acceptChildMessage(
        { origin: event.origin, data: event.data },
        expectedOrigin,
        iframe !== null && event.source === iframe.contentWindow,
      )
      if (message?.type === 'dsh-rw/ready') setFrame(previous => portalFrameReducer(previous, { type: 'loaded' }))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [expectedOrigin])

  // iframe → parent selection: same-origin storage event on the prefixed key.
  useEffect(() => {
    if (typeof window === 'undefined' || request.storagePrefix === '') return
    const onStorage = (event: StorageEvent): void => {
      if (event.storageArea !== window.localStorage) return
      const selection = parseSelectionStorageEvent(
        { key: event.key, newValue: event.newValue, url: event.url },
        { targetId: request.targetId, storagePrefix: request.storagePrefix },
      )
      if (selection === undefined) return
      dispatchSelection(selection.sessionId)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [request.targetId, request.storagePrefix, dispatchSelection])

  const failed = frame.phase === 'error'
  return (
    <div className="dsh-rw-portal" data-target={request.targetId}>
      <iframe
        ref={iframeRef}
        className="dsh-rw-portal-frame"
        title={t('portal.title', { label: request.targetLabel })}
        src={src}
        // Same-origin by construction; the portal strips the profile server's
        // cookie authority and never forwards Set-Cookie (§8.2).
        allow="clipboard-read; clipboard-write"
        onLoad={() => setFrame(previous => portalFrameReducer(previous, { type: 'loaded' }))}
      />
      {frame.phase === 'loading' && (
        <div className="dsh-rw-portal-status" role="status" aria-live="polite">
          {t('portal.loading', { label: request.targetLabel })}
        </div>
      )}
      {failed && (
        <div className="dsh-rw-portal-error" role="alert">
          <IconWarningTriangleOutlineRegular size={18} />
          <div className="dsh-rw-portal-error-text">
            <strong>{t('portal.failed', { label: request.targetLabel })}</strong>
            <span>{frame.error?.message ?? t('portal.failedUnknown')}</span>
          </div>
          <Button variant="outline" icon={<IconRefreshOutlineRegular size={12} />} onClick={retry}>
            {t('common.retry')}
          </Button>
        </div>
      )}
    </div>
  )
}

/** The main-slot entry: renders the current request, or nothing. */
export function ServerMainPanel(): ReactElement | null {
  const current = useServerMain()
  if (current.request === undefined) return null
  return <ServerMainArea request={current.request} />
}

/** Public action for the sidebar: close the server area and return to chat. */
export function closeServerMainPanel(): void {
  closeServerMain()
  selectConversationPanel()
}
