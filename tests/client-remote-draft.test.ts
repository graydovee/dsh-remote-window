/**
 * The remote draft's fixed target lookup used by the hero preset chip.
 *
 * The chip must appear only while a *remote* draft is open; local drafts keep
 * the official picker. This pure helper is the rule both the registration sync
 * and the component use.
 */
import { describe, expect, it } from 'vitest'
import { remoteDraftTarget } from '../src/client/remote-draft.ts'

function state(overrides: Record<string, unknown> = {}) {
  return {
    currentDraft: { workspaceId: 'wr-1', sessionId: 'session-1' },
    workspaces: [{ id: 'wr-1', targetId: 'rt-1', title: 'project · host' }],
    targets: [{ id: 'rt-1', label: 'host' }],
    ...overrides,
  } as unknown as Parameters<typeof remoteDraftTarget>[0]
}

describe('remoteDraftTarget', () => {
  it('resolves the draft workspace target and its label', () => {
    expect(remoteDraftTarget(state())).toEqual({ targetId: 'rt-1', label: 'host' })
  })

  it('is absent when no draft is open', () => {
    expect(remoteDraftTarget(state({ currentDraft: undefined }))).toBeUndefined()
  })

  it('is absent when the draft workspace is not in the joined rows', () => {
    expect(remoteDraftTarget(state({ workspaces: [] }))).toBeUndefined()
  })

  it('falls back to the workspace title when the target row is missing', () => {
    expect(remoteDraftTarget(state({ targets: [] }))).toEqual({ targetId: 'rt-1', label: 'project · host' })
  })
})
