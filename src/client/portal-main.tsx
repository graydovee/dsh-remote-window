/**
 * The v3 **remote main area**: one same-origin iframe showing the profile
 * server's complete official DSH UI (protocol §8/§9).
 *
 * The client no longer redraws the conversation. The frame is full-screen in
 * the shell's main region and the server plugin's embed layer is asked for
 * `full` mode (`dshRwFull=1`), so the official sidebar, header, conversation
 * and right sidebar are all present and owned by the server.
 *
 * The client keeps exactly two chrome surfaces: the floating target rail
 * (`rail.tsx`) and the connection dialogs. Both live outside the frame.
 *
 * Parent → iframe messages are kept for compatibility with the v1 deep-link
 * contract, but full mode relies on the embedded official UI's own navigation;
 * the only message the parent still needs is the child's readiness.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { createPortal } from 'react-dom'
import {
  Button, IconRefreshOutlineRegular, IconWarningTriangleOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContext } from './context.ts'
import { t } from './locales.ts'
import {
  IDLE_PORTAL_FRAME,
  acceptChildMessage,
  parseSelectionStorageEvent,
  portalFrameReducer,
  portalUrl,
  type EmbedLang,
  type EmbedNavigationMode,
  type EmbedTheme,
  type PortalFrameState,
} from './portal-url.ts'

/** Main-slot key for the full-screen official UI area. */
export const SERVER_MAIN_ID = 'dsh-remote-window-server'

/** Attribute placed on `<html>` while a portal frame is mounted. */
export const PORTAL_ACTIVE_ATTR = 'data-dsh-rw-portal'

/** Everything one mounted main area needs. */
export interface ServerMainRequest {
  readonly targetId: string
  /** Connection label, used only for the accessible region name. */
  readonly targetLabel: string
  /** Optional deep link: workspace shown by the embedded official UI. */
  readonly workspaceId?: string
  /** Optional deep link: session opened on the first load. */
  readonly sessionId?: string
  /** `capabilities.embed.storagePrefix` from the handshake (optional in v3). */
  readonly storagePrefix?: string
  /** `capabilities.embed.mode`: reload (v1) or client-half (v1.1). */
  readonly embedMode?: EmbedNavigationMode
  readonly theme?: EmbedTheme
  readonly lang?: EmbedLang
}

/** The panel store: which target the main area currently shows. */
interface ServerMainState {
  readonly request?: ServerMainRequest
  /** Monotonic remount counter: a reconnect must never reuse the cached UI. */
  readonly revision: number
  /** Session reported by the embedded UI's storage bridge. */
  readonly reportedSessionId?: string
}

let state: ServerMainState = { revision: 0 }
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

/**
 * Open (or re-point) the full-screen official UI.
 *
 * Every call bumps {@link ServerMainState.revision}: a reconnect, a target
 * switch or an explicit retry must remount the iframe so the browser cannot
 * serve the previous profile's cached document.
 */
export function openServerMain(request: ServerMainRequest): void {
  commit({
    request,
    revision: state.revision + 1,
    reportedSessionId: request.sessionId,
  })
}

/** Ask the embedded UI to show another session (kept for the v1 deep-link API). */
export function navigateServerMain(sessionId: string | undefined): void {
  if (state.request === undefined) return
  commit({
    request: { ...state.request, ...(sessionId === undefined ? { sessionId: undefined } : { sessionId }) },
    revision: state.revision + 1,
    reportedSessionId: sessionId,
  })
}

/** Tear the main area down (disconnect / target switch / plugin disposal). */
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

/** Subscribe to main-area changes (the target rail's active highlight). */
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
    console.error('[dsh-remote-window] returning to the conversation panel failed', error)
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

/** Hook: the current request, for the target rail's active highlight. */
export function useServerMainRequest(): ServerMainRequest | undefined {
  return useServerMain().request
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
    // The request identity (not each field) is the navigation unit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.targetId, dispatch])

  return {
    frame,
    setFrame,
    retry: () => dispatch({ type: 'retry' }),
  }
}

/** How long the official UI may take to report readiness before we show an error. */
export const PORTAL_READY_TIMEOUT_MS = 20_000

/** The iframe + its loading/error chrome. */
export function ServerMainArea(props: { request: ServerMainRequest }): ReactElement {
  const { request } = props
  const current = useServerMain()
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
    // The whole official shell: no client-side sidebar/rightbar hiding.
    full: true,
  })
  const storagePrefix = request.storagePrefix

  // The client shell yields its own sidebar while the official UI owns the
  // navigation; the floating target rail stays outside the shell grid.
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute(PORTAL_ACTIVE_ATTR, request.targetId)
    return () => { document.documentElement.removeAttribute(PORTAL_ACTIVE_ATTR) }
  }, [request.targetId])

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

  // A document that never reports readiness is a failure the user can act on.
  useEffect(() => {
    if (frame.phase !== 'loading') return
    const timer = setTimeout(() => {
      setFrame(previous => previous.phase === 'loading'
        ? portalFrameReducer(previous, {
          type: 'failed',
          error: { code: 'portal-not-ready', message: t('portal.timeout', { label: request.targetLabel }) },
        })
        : previous)
    }, PORTAL_READY_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [frame.phase, frame.reloadCount, current.revision, request.targetLabel, setFrame])

  // iframe → parent selection: same-origin storage event on the prefixed key.
  useEffect(() => {
    if (typeof window === 'undefined' || storagePrefix === undefined || storagePrefix === '') return
    const onStorage = (event: StorageEvent): void => {
      if (event.storageArea !== window.localStorage) return
      const selection = parseSelectionStorageEvent(
        { key: event.key, newValue: event.newValue, url: event.url },
        { targetId: request.targetId, storagePrefix },
      )
      if (selection === undefined) return
      dispatchSelection(selection.sessionId)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [request.targetId, storagePrefix, dispatchSelection])

  const failed = frame.phase === 'error'
  return (
    <div className="dsh-rw-portal" data-target={request.targetId} data-phase={frame.phase}>
      <iframe
        // The revision is part of the key: a reconnect must remount the frame
        // instead of letting the browser reuse the previous profile's document.
        key={`${request.targetId}:${current.revision}:${frame.reloadCount}`}
        ref={iframeRef}
        className="dsh-rw-portal-frame"
        title={t('portal.title', { label: request.targetLabel })}
        src={src}
        // Same-origin by construction; the portal strips the profile server's
        // cookie authority and never forwards Set-Cookie (§8.2). The sandbox
        // deliberately omits top-navigation; downloads/popups stay available
        // because the official UI exposes them in-frame.
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        allow="clipboard-read; clipboard-write"
        referrerPolicy="no-referrer"
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
            <span>{t('portal.failedHint')}</span>
          </div>
          <Button variant="outline" icon={<IconRefreshOutlineRegular size={12} />} onClick={retry}>
            {t('common.retry')}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * The main-slot entry: renders the current request, or nothing.
 *
 * The frame is portalled to `document.body` so the official UI covers the
 * whole client window (the shell sidebar included) — v3 is "the client becomes
 * the server UI", not a panel inside the client's own layout.
 */
export function ServerMainPanel(): ReactElement | null {
  const current = useServerMain()
  if (current.request === undefined) return null
  const area = <ServerMainArea request={current.request} />
  // Non-DOM hosts (SSR, component tests) get the tree inline; the browser
  // portals it to <body> so the official UI covers the whole client window.
  if (typeof document === 'undefined') return area
  return createPortal(area, document.body)
}

/** Public action for the rail: close the server area and return to chat. */
export function closeServerMainPanel(): void {
  closeServerMain()
  selectConversationPanel()
}
