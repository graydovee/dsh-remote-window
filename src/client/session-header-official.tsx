/**
 * Official DSH session header adapter.
 *
 * The vendored rc.3 conversation bundle exports its real
 * `ConversationSessionHeader`; this adapter supplies the remote session's
 * stores/slots and lets the official component own the header DOM. Its CSS is
 * the vendored ConversationRoot stylesheet rewritten to the official hashed
 * class names that the component references.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import {
  Button, IconCopyOutlineRegular, IconEllipsisOutlineRegular, IconRefreshOutlineRegular, StateDot, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { conversationCss } from './vendor/official-ui/classnames.ts'
import { OFFICIAL_UI_STYLES } from './vendor/official-ui/styles.ts'
import { loadOfficialUi } from './official-ui-runtime.ts'
import type { OfficialUiExports } from './official-ui-runtime.ts'
import { t } from './locales.ts'
import type { NativeSessionRequest, NativeSessionStatus } from './session-main.tsx'

interface HeaderProps {
  request: NativeSessionRequest
  status: NativeSessionStatus
  reconnecting: boolean
  view: 'conversation' | 'trace'
  onView: (view: 'conversation' | 'trace') => void
  onRetry?: (() => void) | undefined
  onClose?: (() => void) | undefined
  actions: ReactNode
  utilities: ReactNode
}

interface OfficialHeaderExports extends OfficialUiExports {
  ConversationSessionHeader?: (props: Record<string, unknown>) => ReactElement
  conversationCss?: Record<string, string>
}

function statusPresentation(status: NativeSessionStatus): { dot: 'ongoing' | 'warning' | 'done' | 'error' | 'idle'; label: string } {
  switch (status) {
    case 'running': return { dot: 'ongoing', label: t('session.status.running') }
    case 'waiting-approval': return { dot: 'warning', label: t('session.status.approval') }
    case 'error': return { dot: 'error', label: t('session.status.error') }
    case 'loading': return { dot: 'ongoing', label: t('session.status.loading') }
    default: return { dot: 'done', label: t('session.status.idle') }
  }
}

/** Rewrite the vendored ConversationRoot rules to the hashed names used by the official component. */
function officialHeaderCss(ui: OfficialHeaderExports): string {
  const hashes = ui.conversationCss
  if (hashes === undefined) return ''
  let css = OFFICIAL_UI_STYLES
  for (const key of Object.keys(conversationCss)) {
    const hash = hashes[key]
    const prefixed = (conversationCss as Record<string, string>)[key]
    if (typeof hash === 'string' && typeof prefixed === 'string') {
      css = css.replaceAll(`.${prefixed}`, `.${hash}`)
    }
  }
  return css
}

let injected = false
function injectOfficialHeaderCss(ui: OfficialHeaderExports): void {
  if (injected || typeof document === 'undefined') return
  const css = officialHeaderCss(ui)
  if (css === '') return
  const style = document.createElement('style')
  style.dataset['dshOfficialHeader'] = 'true'
  style.textContent = css
  document.head.append(style)
  injected = true
}

function HeaderFallback(props: HeaderProps): ReactElement {
  return (
    <header className={conversationCss.header} data-conversation-header="">
      <div className={conversationCss.titleRow}>
        <div className={conversationCss.titleCluster}>
          <nav className={conversationCss.crumbs} aria-label={props.request.title ?? props.request.sessionId}>
            <span className={conversationCss.crumbSeg}>
              <span className={`${conversationCss.crumb} ${conversationCss.crumbCurrent}`}>{props.request.title ?? props.request.sessionId}</span>
            </span>
          </nav>
          <div className={conversationCss.headerActions}>{props.actions}</div>
        </div>
        <div className={conversationCss.headerUtilities}>{props.utilities}</div>
      </div>
    </header>
  )
}

/** Render the real official header; fall back to a tiny skeleton while its bundle loads. */
export function OfficialSessionHeader(props: HeaderProps): ReactElement {
  const [ui, setUi] = useState<OfficialHeaderExports | undefined>(undefined)
  const [loadError, setLoadError] = useState(false)
  useEffect(() => {
    let cancelled = false
    void loadOfficialUi().then((loaded) => {
      if (cancelled) return
      const headerUi = loaded as OfficialHeaderExports
      injectOfficialHeaderCss(headerUi)
      setUi(headerUi)
    }, () => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [])

  const title = props.request.title ?? props.request.sessionId
  const activeView = props.view === 'trace' ? 'trace' : 'chat'
  const tabs = useMemo(() => ([
    { id: 'chat', label: t('session.view.conversation') },
    { id: 'trace', label: t('session.view.trace') },
  ]), [])
  const byId = useMemo(() => ({
    [props.request.sessionId]: { id: props.request.sessionId, displayTitle: title, origin: 'user' },
  }), [props.request.sessionId, title])
  const useSessions = useMemo(() => (selector: (state: unknown) => unknown) => selector({ byId }), [byId])
  const useConversationViews = useMemo(() => (selector: (views: unknown) => unknown) => selector(tabs), [tabs])
  const useStore = useMemo(() => (selector: (state: unknown) => unknown) => selector({ view: activeView }), [activeView])
  const selectView = (id: string): void => { props.onView(id === 'trace' ? 'trace' : 'conversation') }
  const renderSlot = (name: string): ReactNode => {
    if (name === 'conversation.session.header.actions') return props.actions
    if (name === 'conversation.session.header.utilities') return props.utilities
    return null
  }

  if (loadError || ui?.ConversationSessionHeader === undefined) return <HeaderFallback {...props} />
  const Header = ui.ConversationSessionHeader
  const headerClass = ui.conversationCss?.header ?? conversationCss.header
  return (
    <header className={headerClass} data-conversation-header="">
      <Header
        sessionId={props.request.sessionId}
        hideChrome={false}
        useSessions={useSessions}
        useConversationViews={useConversationViews}
        useStore={useStore}
        renderSlot={renderSlot}
        open={() => {}}
        selectView={selectView}
        setPinned={() => {}}
        t={(key: string) => key === 'session.moreViews' ? t('tree.session.more') : key}
        useEntryPins={(selector: (ids: string[]) => unknown) => selector([])}
        useEntryActions={(selector: (value: undefined) => unknown) => selector(undefined)}
      />
    </header>
  )
}

/** Status/action rail used inside the official header actions slot. */
export function SessionHeaderActions(props: {
  status: NativeSessionStatus
  reconnecting: boolean
  onRetry?: (() => void) | undefined
  onClose?: (() => void) | undefined
  sessionId: string
}): ReactElement {
  const presentation = statusPresentation(props.status)
  return (
    <>
      <span className="dsh-rw-session-status" data-status={props.status} title={presentation.label}>
        <StateDot state={presentation.dot} size={7} />
      </span>
      {props.reconnecting && <span className="dsh-rw-session-head-reconnect">{t('session.status.reconnecting')}</span>}
      {props.onRetry !== undefined && props.status === 'error' && (
        <Tooltip label={t('common.retry')} side="bottom" align="end" delayMs={200}>
          <Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular size={12} />} aria-label={t('common.retry')} onClick={props.onRetry} />
        </Tooltip>
      )}
      {props.onClose !== undefined && (
        <Button variant="ghost" size="sm" onClick={props.onClose}>{t('common.close')}</Button>
      )}
    </>
  )
}

/** Overflow menu used inside the official header utilities slot. */
export function SessionHeaderUtilities(props: {
  sessionId: string
  onClose?: (() => void) | undefined
}): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  return (
    <>
      <Tooltip label={t('tree.session.copyId')} side="bottom" align="end" delayMs={200}>
        <Button
          variant="ghost" size="sm" icon={<IconCopyOutlineRegular size={14} />}
          aria-label={t('tree.session.copyId')}
          onClick={() => {
            void writeClipboard(props.sessionId)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
          }}
        />
      </Tooltip>
      <div className="dsh-rw-session-head-menu-wrap">
        <Tooltip label={t('tree.session.more')} side="bottom" align="end" delayMs={200}>
          <Button
            variant="ghost" size="sm" icon={<IconEllipsisOutlineRegular size={14} />}
            aria-label={t('tree.session.more')} aria-expanded={menuOpen}
            onClick={() => setMenuOpen(value => !value)}
          />
        </Tooltip>
        {menuOpen && (
          <div className="dsh-rw-session-head-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => { void writeClipboard(props.sessionId); setMenuOpen(false) }}>
              {t('tree.session.copyId')}
            </button>
            {props.onClose !== undefined && (
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); props.onClose?.() }}>
                {t('common.close')}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}
