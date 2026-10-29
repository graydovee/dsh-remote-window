/**
 * The v1 embed contract's pure half (protocol §8 + §9).
 *
 * A wrong URL, a message accepted from another origin, or a storage event read
 * from the wrong iframe is a cross-target defect, so each bridge is tested as a
 * gate rather than as a formatting helper. The frame reducer only encodes what
 * the main area may conclude from those gates.
 */
import { describe, expect, it } from 'vitest'
import {
  EMBED_LANG_PARAM,
  EMBED_PARENT_PARAM,
  EMBED_SESSION_PARAM,
  EMBED_THEME_PARAM,
  EMBED_WORKSPACE_PARAM,
  IDLE_PORTAL_FRAME,
  PORTAL_PREFIX,
  SELECTION_STORAGE_KEY,
  acceptChildMessage,
  acceptParentMessage,
  embedNavigatesByReload,
  isTrustedMessageOrigin,
  needsEmbedNavigation,
  openSessionMessage,
  parseChildMessage,
  parseParentMessage,
  parsePortalQuery,
  parseSelectionStorageEvent,
  parseSelectionValue,
  portalFrameReducer,
  portalPath,
  portalUrl,
  portalUrlMatches,
  reloadMessage,
  selectionStorageKey,
  selectionStorageValue,
  themeMessage,
} from '../src/client/portal-url.ts'
import type { PortalFrameState } from '../src/client/portal-url.ts'

const ORIGIN = 'http://127.0.0.1:60900'
const PREFIX = 'dshrw:graydovee-remote-window-abc123:'

describe('portal URL', () => {
  it('builds one relative, trailing-slash portal path per target', () => {
    expect(portalPath('target-1')).toBe(`${PORTAL_PREFIX}/target-1/`)
    expect(portalPath('t/1')).toBe(`${PORTAL_PREFIX}/t%2F1/`)
    expect(() => portalPath('')).toThrow()
  })

  it('emits the four embed hints in a stable order', () => {
    expect(portalUrl({ targetId: 't1' })).toBe(`${PORTAL_PREFIX}/t1/`)
    const url = portalUrl({
      targetId: 't1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      theme: 'dark',
      lang: 'en-US',
      parentOrigin: ORIGIN,
    })
    const params = url.slice(url.indexOf('?') + 1)
    expect(url.startsWith(`${PORTAL_PREFIX}/t1/?`)).toBe(true)
    expect(params).toBe([
      `${EMBED_SESSION_PARAM}=session-1`,
      `${EMBED_WORKSPACE_PARAM}=workspace-1`,
      `${EMBED_THEME_PARAM}=dark`,
      `${EMBED_LANG_PARAM}=en-US`,
      `${EMBED_PARENT_PARAM}=${encodeURIComponent(ORIGIN)}`,
    ].join('&'))
  })

  it('drops empty hints instead of emitting blanks', () => {
    const url = portalUrl({ targetId: 't1', sessionId: '', workspaceId: '', parentOrigin: '' })
    expect(url).toBe(`${PORTAL_PREFIX}/t1/`)
  })

  it('supports the §16.2 workspace fallback deep link', () => {
    const url = portalUrl({ targetId: 't1', workspaceId: 'workspace-1' })
    expect(url).toBe(`${PORTAL_PREFIX}/t1/?${EMBED_WORKSPACE_PARAM}=workspace-1`)
  })

  it('parses the same hints back, ignoring unknown or invalid values', () => {
    expect(parsePortalQuery('?' + new URLSearchParams({
      [EMBED_SESSION_PARAM]: 'session-1',
      [EMBED_WORKSPACE_PARAM]: 'workspace-1',
      [EMBED_THEME_PARAM]: 'system',
      [EMBED_LANG_PARAM]: 'zh-CN',
      [EMBED_PARENT_PARAM]: ORIGIN,
      unknown: 'x',
    }).toString())).toEqual({
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      theme: 'system',
      lang: 'zh-CN',
      parentOrigin: ORIGIN,
    })
    expect(parsePortalQuery(`?${EMBED_THEME_PARAM}=sepia&${EMBED_LANG_PARAM}=fr&${EMBED_SESSION_PARAM}=`))
      .toEqual({})
    expect(parsePortalQuery('')).toEqual({})
  })

  it('accepts only this target’s portal URL for storage events', () => {
    expect(portalUrlMatches(`${ORIGIN}${portalPath('t1')}?${EMBED_SESSION_PARAM}=s`, 't1')).toBe(true)
    expect(portalUrlMatches(`${ORIGIN}${portalPath('t1')}api/events`, 't1')).toBe(true)
    expect(portalUrlMatches(`/dsh-remote-window/portal/t1/`, 't1')).toBe(true)
    expect(portalUrlMatches(`${ORIGIN}${portalPath('t10')}`, 't1')).toBe(false)
    expect(portalUrlMatches(`${ORIGIN}${portalPath('t1').slice(0, -1)}`, 't1')).toBe(false)
    expect(portalUrlMatches(`${ORIGIN}/elsewhere`, 't1')).toBe(false)
    expect(portalUrlMatches('', 't1')).toBe(false)
    expect(portalUrlMatches(`${ORIGIN}${portalPath('t1')}`, '')).toBe(false)
  })
})

describe('postMessage vocabulary', () => {
  it('builds the parent messages with v1', () => {
    expect(openSessionMessage('s1')).toEqual({ v: 1, type: 'dsh-rw/open-session', sessionId: 's1' })
    expect(themeMessage('dark')).toEqual({ v: 1, type: 'dsh-rw/theme', theme: 'dark' })
    expect(themeMessage('system', 'zh-CN')).toEqual({ v: 1, type: 'dsh-rw/theme', theme: 'system', lang: 'zh-CN' })
    expect(reloadMessage()).toEqual({ v: 1, type: 'dsh-rw/reload' })
    expect(() => openSessionMessage('')).toThrow()
  })

  it('rejects a parent message with the wrong version or shape', () => {
    expect(parseParentMessage({ v: 2, type: 'dsh-rw/reload' })).toBeUndefined()
    expect(parseParentMessage({ v: 1, type: 'dsh-rw/open-session', sessionId: '' })).toBeUndefined()
    expect(parseParentMessage({ v: 1, type: 'dsh-rw/open-session' })).toBeUndefined()
    expect(parseParentMessage({ v: 1, type: 'dsh-rw/theme', theme: 'sepia' })).toBeUndefined()
    expect(parseParentMessage({ v: 1, type: 'dsh-rw/unknown' })).toBeUndefined()
    expect(parseParentMessage(null)).toBeUndefined()
  })

  it('accepts the known parent messages with optional valid language', () => {
    expect(parseParentMessage({ v: 1, type: 'dsh-rw/open-session', sessionId: 's1' }))
      .toEqual({ v: 1, type: 'dsh-rw/open-session', sessionId: 's1' })
    expect(parseParentMessage({ v: 1, type: 'dsh-rw/theme', theme: 'dark', lang: 'en-US' }))
      .toEqual({ v: 1, type: 'dsh-rw/theme', theme: 'dark', lang: 'en-US' })
    expect(parseParentMessage({ v: 1, type: 'dsh-rw/theme', theme: 'dark', lang: 'fr' }))
      .toEqual({ v: 1, type: 'dsh-rw/theme', theme: 'dark' })
    expect(parseParentMessage({ v: 1, type: 'dsh-rw/reload' })).toEqual({ v: 1, type: 'dsh-rw/reload' })
  })

  it('accepts only the v1 ready message from the child', () => {
    expect(parseChildMessage({ v: 1, type: 'dsh-rw/ready' })).toEqual({ v: 1, type: 'dsh-rw/ready' })
    expect(parseChildMessage({ v: 1, type: 'dsh-rw/ready', extra: true })).toEqual({ v: 1, type: 'dsh-rw/ready' })
    expect(parseChildMessage({ v: 2, type: 'dsh-rw/ready' })).toBeUndefined()
    expect(parseChildMessage({ v: 1, type: 'dsh-rw/open-session' })).toBeUndefined()
    expect(parseChildMessage('nope')).toBeUndefined()
  })

  it('gates by both source window and origin', () => {
    const ready = { v: 1, type: 'dsh-rw/ready' }
    expect(acceptChildMessage({ origin: ORIGIN, data: ready }, ORIGIN, true)).toEqual(ready)
    expect(acceptChildMessage({ origin: 'http://evil.example', data: ready }, ORIGIN, true)).toBeUndefined()
    expect(acceptChildMessage({ origin: ORIGIN, data: ready }, ORIGIN, false)).toBeUndefined()
    expect(acceptChildMessage({ origin: ORIGIN, data: { v: 2, type: 'dsh-rw/ready' } }, ORIGIN, true)).toBeUndefined()

    const open = { v: 1, type: 'dsh-rw/open-session', sessionId: 's1' }
    expect(acceptParentMessage({ origin: ORIGIN, data: open }, ORIGIN)).toEqual(open)
    expect(acceptParentMessage({ origin: 'http://evil.example', data: open }, ORIGIN)).toBeUndefined()
    expect(isTrustedMessageOrigin('', '')).toBe(false)
    expect(isTrustedMessageOrigin(ORIGIN, '')).toBe(false)
  })
})

describe('storage selection bridge', () => {
  it('uses the official key under the handshake prefix', () => {
    expect(SELECTION_STORAGE_KEY).toBe('dsh.sessions.current')
    expect(selectionStorageKey(PREFIX)).toBe(`${PREFIX}dsh.sessions.current`)
    expect(() => selectionStorageKey('')).toThrow()
  })

  it('serializes and parses the official selection record', () => {
    expect(selectionStorageValue('s1')).toBe('{"sessionId":"s1"}')
    expect(selectionStorageValue(undefined)).toBe('{}')
    expect(parseSelectionValue('{"sessionId":"s1"}')).toEqual({ sessionId: 's1' })
    expect(parseSelectionValue('{}')).toEqual({})
    expect(parseSelectionValue(null)).toEqual({})
    expect(parseSelectionValue('not json')).toBeUndefined()
    expect(parseSelectionValue('{"sessionId":42}')).toEqual({})
  })

  it('accepts only our key, our target iframe URL and a valid record', () => {
    const url = `${ORIGIN}${portalPath('t1')}?${EMBED_SESSION_PARAM}=s1`
    const event = { key: selectionStorageKey(PREFIX), newValue: '{"sessionId":"s1"}', url }
    expect(parseSelectionStorageEvent(event, { targetId: 't1', storagePrefix: PREFIX }))
      .toEqual({ sessionId: 's1' })
    expect(parseSelectionStorageEvent(
      { ...event, key: selectionStorageKey('other:') },
      { targetId: 't1', storagePrefix: PREFIX },
    )).toBeUndefined()
    expect(parseSelectionStorageEvent(
      { ...event, url: `${ORIGIN}${portalPath('t2')}` },
      { targetId: 't1', storagePrefix: PREFIX },
    )).toBeUndefined()
    expect(parseSelectionStorageEvent(
      { ...event, newValue: null },
      { targetId: 't1', storagePrefix: PREFIX },
    )).toEqual({})
  })
})

describe('portal frame state', () => {
  function reduce(actions: Parameters<typeof portalFrameReducer>[1][]): PortalFrameState {
    return actions.reduce(portalFrameReducer, IDLE_PORTAL_FRAME)
  }

  it('loads a target, becomes ready, and keeps the reported selection', () => {
    const loading = reduce([{ type: 'open', targetId: 't1', sessionId: 's1' }])
    expect(loading.phase).toBe('loading')
    expect(loading.targetId).toBe('t1')
    expect(loading.requestedSessionId).toBe('s1')
    expect(loading.reloadCount).toBe(1)
    const ready = portalFrameReducer(loading, { type: 'loaded' })
    expect(ready.phase).toBe('ready')
    const selected = portalFrameReducer(ready, { type: 'selection', sessionId: 's2' })
    expect(selected.reportedSessionId).toBe('s2')
  })

  it('turns a navigation into a reload and ignores stale ready signals', () => {
    const ready = reduce([{ type: 'open', targetId: 't1', sessionId: 's1' }, { type: 'loaded' }])
    const navigating = portalFrameReducer(ready, { type: 'navigate', sessionId: 's2' })
    expect(navigating.phase).toBe('loading')
    expect(navigating.requestedSessionId).toBe('s2')
    expect(navigating.reloadCount).toBe(2)
    expect(portalFrameReducer(navigating, { type: 'loaded' }).phase).toBe('ready')
  })

  it('keeps the target and session on failure so the UI can retry', () => {
    const failed = reduce([
      { type: 'open', targetId: 't1', sessionId: 's1' },
      { type: 'failed', error: { code: 'upstream-timeout', message: 'timeout' } },
    ])
    expect(failed.phase).toBe('error')
    expect(failed.targetId).toBe('t1')
    expect(failed.requestedSessionId).toBe('s1')
    expect(failed.error?.code).toBe('upstream-timeout')
    const retry = portalFrameReducer(failed, { type: 'retry' })
    expect(retry.phase).toBe('loading')
    expect(retry.reloadCount).toBe(failed.reloadCount + 1)
    expect(retry.error).toBeUndefined()
  })

  it('ignores lifecycle signals while idle and clears on teardown', () => {
    expect(portalFrameReducer(IDLE_PORTAL_FRAME, { type: 'loaded' })).toBe(IDLE_PORTAL_FRAME)
    expect(portalFrameReducer(IDLE_PORTAL_FRAME, { type: 'failed', error: { code: 'x', message: 'x' } }))
      .toBe(IDLE_PORTAL_FRAME)
    const ready = reduce([{ type: 'open', targetId: 't1' }, { type: 'loaded' }])
    expect(portalFrameReducer(ready, { type: 'clear' })).toEqual(IDLE_PORTAL_FRAME)
  })

  it('decides when a selected session needs an embed navigation', () => {
    const ready = reduce([{ type: 'open', targetId: 't1', sessionId: 's1' }, { type: 'loaded' }])
    expect(needsEmbedNavigation(ready, 's1')).toBe(false)
    expect(needsEmbedNavigation(ready, 's2')).toBe(true)
    expect(needsEmbedNavigation(ready, undefined)).toBe(true)
    const noSelection = reduce([{ type: 'open', targetId: 't1' }, { type: 'loaded' }])
    expect(needsEmbedNavigation(noSelection, undefined)).toBe(false)
  })

  it('declares reload navigation for the v1 embed capability', () => {
    expect(embedNavigatesByReload('reload')).toBe(true)
    expect(embedNavigatesByReload('client-half')).toBe(false)
  })
})
