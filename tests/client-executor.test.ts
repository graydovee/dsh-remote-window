/**
 * The connection's execution-end switch (protocol §5.4 + D20).
 *
 * D20 is a safety rule, not a label: switching may cancel other running turns,
 * so the state machine must expose exactly which turns a confirm dialog would
 * cancel, and must never advance to `switching` before the user has confirmed.
 * These tests pin that order, the auto-cancel-only-current path, and the
 * actionable error mapping the settings panel renders.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXECUTOR_MODE,
  IDLE_EXECUTOR_SWITCH,
  IDLE_MODE_SWITCH,
  executorErrorView,
  executorModeOf,
  executorOwnerExpired,
  executorSwitchReducer,
  isExecutorMode,
  isSameExecutorMode,
  otherActiveTurns,
  parseActiveTurns,
  parseExecutorOwner,
  modeSwitchApplyRequest,
  modeSwitchPreviewProblem,
  modeSwitchReducer,
  parseModeSwitchEvent,
  summarizeModeSwitch,
  requiresProfileRestart,
  summarizeExecutorSwitch,
  targetActiveTurn,
} from '../src/client/executor.ts'
import type {
  ActiveTurn,
  ExecutorSwitchPlan,
  ExecutorSwitchState,
  ModeSwitchAction,
  ModeSwitchPreview,
  ModeSwitchState,
} from '../src/client/executor.ts'

function turn(sessionId: string, running = true): ActiveTurn {
  return { sessionId, running, status: running ? 'running' : 'idle' }
}

function plan(extra: Partial<ExecutorSwitchPlan> = {}): ExecutorSwitchPlan {
  return {
    currentMode: 'server',
    to: 'local',
    restartRequired: true,
    activeTurns: [],
    requiresConfirmation: false,
    targetTurnRunning: false,
    ...extra,
  }
}

/** Drive the reducer through a list of actions. */
function run(actions: Parameters<typeof executorSwitchReducer>[1][]): ExecutorSwitchState {
  return actions.reduce(executorSwitchReducer, IDLE_EXECUTOR_SWITCH)
}

describe('executor mode setting', () => {
  it('defaults a missing/unknown setting to local', () => {
    expect(DEFAULT_EXECUTOR_MODE).toBe('local')
    expect(executorModeOf(undefined)).toBe('local')
    expect(executorModeOf('nonsense')).toBe('local')
    expect(executorModeOf('local')).toBe('local')
    expect(isExecutorMode('server')).toBe(true)
    expect(isExecutorMode('local')).toBe(true)
    expect(isExecutorMode('client')).toBe(false)
  })

  it('recognizes an unchanged mode', () => {
    expect(isSameExecutorMode('server', 'server')).toBe(true)
    expect(isSameExecutorMode('server', 'local')).toBe(false)
  })
})

describe('switch planning (D20)', () => {
  it('lists the other running turns and requires confirmation for them', () => {
    const p = plan({ activeTurns: [turn('target'), turn('other-1'), turn('other-2')], targetTurnRunning: true })
    const summary = summarizeExecutorSwitch(p, 'target')
    expect(summary.otherActiveTurns.map(t => t.sessionId)).toEqual(['other-1', 'other-2'])
    expect(summary.targetTurn?.sessionId).toBe('target')
    expect(summary.needsConfirmation).toBe(true)
    expect(summary.restartRequired).toBe(true)
  })

  it('treats a running target alone as auto-cancel (no second confirmation)', () => {
    const p = plan({ activeTurns: [turn('target')], targetTurnRunning: true })
    const summary = summarizeExecutorSwitch(p, 'target')
    expect(summary.otherActiveTurns).toEqual([])
    expect(summary.needsConfirmation).toBe(false)
  })

  it('still asks when the server flag says so, even without a listed other turn', () => {
    const summary = summarizeExecutorSwitch(plan({ requiresConfirmation: true }), 'target')
    expect(summary.needsConfirmation).toBe(true)
  })

  it('does not count stopped agents as active turns', () => {
    const p = plan({ activeTurns: [turn('target', false), turn('other', false)] })
    expect(otherActiveTurns(p, 'target')).toEqual([])
    expect(targetActiveTurn(p, 'target')).toBeUndefined()
    expect(summarizeExecutorSwitch(p, 'target').needsConfirmation).toBe(false)
  })
})

describe('executorSwitchReducer', () => {
  it('walks the confirm path: preview → confirming → switching → done', () => {
    const p = plan({ activeTurns: [turn('target'), turn('other')], targetTurnRunning: true })
    const afterPlan = run([
      { type: 'preview', to: 'local', targetSessionId: 'target' },
      { type: 'plan', plan: p, targetSessionId: 'target' },
    ])
    expect(afterPlan.phase).toBe('confirming')
    const confirmed = executorSwitchReducer(afterPlan, { type: 'confirm' })
    expect(confirmed.phase).toBe('switching')
    expect(confirmed.confirmed).toBe(true)
    const done = executorSwitchReducer(confirmed, { type: 'switched', mode: 'local', cancelledSessionIds: ['target', 'other'] })
    expect(done.phase).toBe('done')
    expect(done.to).toBe('local')
    expect(done.cancelledSessionIds).toEqual(['target', 'other'])
  })

  it('walks the auto-cancel path when only the target turn runs', () => {
    const p = plan({ activeTurns: [turn('target')], targetTurnRunning: true })
    const ready = run([
      { type: 'preview', to: 'local', targetSessionId: 'target' },
      { type: 'plan', plan: p, targetSessionId: 'target' },
    ])
    expect(ready.phase).toBe('ready')
    const switching = executorSwitchReducer(ready, { type: 'begin-switch' })
    expect(switching.phase).toBe('switching')
    expect(switching.confirmed).toBe(false)
    expect(executorSwitchReducer(switching, { type: 'switched', mode: 'local' }).phase).toBe('done')
  })

  it('never reaches switching from the confirm dialog without an explicit confirm', () => {
    const confirming = run([
      { type: 'preview', to: 'local', targetSessionId: 'target' },
      { type: 'plan', plan: plan({ activeTurns: [turn('other')], requiresConfirmation: true }), targetSessionId: 'target' },
    ])
    expect(confirming.phase).toBe('confirming')
    expect(executorSwitchReducer(confirming, { type: 'begin-switch' })).toBe(confirming)
    expect(executorSwitchReducer(confirming, { type: 'switched', mode: 'local' })).toBe(confirming)
  })

  it('cancels back to idle with no residual plan', () => {
    const confirming = run([
      { type: 'preview', to: 'local', targetSessionId: 'target' },
      { type: 'plan', plan: plan({ activeTurns: [turn('other')], requiresConfirmation: true }), targetSessionId: 'target' },
    ])
    expect(executorSwitchReducer(confirming, { type: 'cancel' })).toEqual(IDLE_EXECUTOR_SWITCH)
  })

  it('keeps the plan on failure so the dialog can retry', () => {
    const switching = run([
      { type: 'preview', to: 'local', targetSessionId: 'target' },
      { type: 'plan', plan: plan(), targetSessionId: 'target' },
      { type: 'begin-switch' },
    ])
    const failed = executorSwitchReducer(switching, {
      type: 'failed',
      error: executorErrorView({ code: 'executor-switch-busy', message: 'busy' }),
    })
    expect(failed.phase).toBe('failed')
    expect(failed.plan?.to).toBe('local')
    // A fresh plan from the failed state (retry) re-enters the machine.
    const retried = executorSwitchReducer(failed, {
      type: 'plan',
      plan: plan({ activeTurns: [turn('other')], requiresConfirmation: true }),
      targetSessionId: 'target',
    })
    expect(retried.phase).toBe('confirming')
  })

  it('does not claim success when some cancellations failed', () => {
    const switching = run([
      { type: 'preview', to: 'local', targetSessionId: 'target' },
      { type: 'plan', plan: plan(), targetSessionId: 'target' },
      { type: 'begin-switch' },
    ])
    const partial = executorSwitchReducer(switching, {
      type: 'switched',
      mode: 'local',
      cancelledSessionIds: ['target'],
      failedSessionIds: ['other'],
    })
    expect(partial.phase).toBe('failed')
    expect(partial.failedSessionIds).toEqual(['other'])
    expect(partial.error?.kind).toBe('failed')
  })

  it('ignores illegal/late transitions', () => {
    expect(executorSwitchReducer(IDLE_EXECUTOR_SWITCH, { type: 'confirm' })).toBe(IDLE_EXECUTOR_SWITCH)
    expect(executorSwitchReducer(IDLE_EXECUTOR_SWITCH, { type: 'switched', mode: 'local' })).toBe(IDLE_EXECUTOR_SWITCH)
    expect(executorSwitchReducer(IDLE_EXECUTOR_SWITCH, { type: 'loaded' as never })).toBe(IDLE_EXECUTOR_SWITCH)
    const previewing = executorSwitchReducer(IDLE_EXECUTOR_SWITCH, { type: 'preview', to: 'local', targetSessionId: 't' })
    // A second preview is harmless; a preview while switching is not.
    expect(executorSwitchReducer(previewing, { type: 'preview', to: 'server', targetSessionId: 't' }).phase).toBe('previewing')
    const switching = { ...previewing, phase: 'switching' as const }
    expect(executorSwitchReducer(switching, { type: 'preview', to: 'local', targetSessionId: 't' })).toBe(switching)
  })

  it('requires a profile restart for the local end', () => {
    expect(requiresProfileRestart(plan({ to: 'local' }))).toBe(true)
    expect(requiresProfileRestart(plan({ to: 'server', restartRequired: false }))).toBe(false)
    expect(requiresProfileRestart(plan({ to: 'server', restartRequired: true }))).toBe(true)
  })
})

describe('executor errors', () => {
  it('maps confirm-required to the active-turn list', () => {
    const view = executorErrorView({
      code: 'executor-switch-confirm-required',
      message: 'confirm first',
      details: { activeTurns: [{ sessionId: 's1', running: true, status: 'running' }, { nope: true }] },
    })
    expect(view.kind).toBe('confirm-required')
    expect(view.retryable).toBe(false)
    expect(view.activeTurns?.map(t => t.sessionId)).toEqual(['s1'])
  })

  it('maps busy/held/writer-held/profile-in-use with their actionability', () => {
    expect(executorErrorView({ code: 'executor-switch-busy', message: 'busy' }).kind).toBe('busy')
    const held = executorErrorView({
      code: 'executor-held',
      message: 'held',
      details: { ownerClientId: 'c1', ownerInstanceId: 'i1', heartbeatAt: '2026-10-22T00:00:00.000Z' },
    })
    expect(held.kind).toBe('held')
    expect(held.owner?.clientId).toBe('c1')
    expect(held.retryable).toBe(true)
    expect(executorErrorView({ code: 'session/writer-held', message: 'taken' }).kind).toBe('writer-held')
    expect(executorErrorView({ code: 'profile-in-use', message: 'in use' }).kind).toBe('profile-in-use')
    expect(executorErrorView({ code: 'internal', message: 'boom' }).kind).toBe('failed')
  })

  it('parses only well-formed active turns and owners', () => {
    expect(parseActiveTurns(null)).toEqual([])
    expect(parseActiveTurns([{ sessionId: 'a' }, { sessionId: '' }, 1])).toEqual([
      { sessionId: 'a', running: false, status: 'unknown' },
    ])
    expect(parseExecutorOwner(undefined)).toBeUndefined()
    expect(parseExecutorOwner({ ownerClientId: '' })).toBeUndefined()
    expect(parseExecutorOwner({ ownerClientId: 'c1' })).toEqual({ clientId: 'c1' })
  })

  it('expires an owner only after the protocol TTL', () => {
    const now = Date.parse('2026-10-22T00:00:30.000Z')
    expect(executorOwnerExpired('2026-10-22T00:00:20.000Z', now)).toBe(false)
    expect(executorOwnerExpired('2026-10-22T00:00:09.999Z', now)).toBe(true)
    expect(executorOwnerExpired('not-a-date', now)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* connection-level mode switch (protocol §16.13)                      */
/* ------------------------------------------------------------------ */

function preview(extra: Partial<ModeSwitchPreview> = {}): ModeSwitchPreview {
  return {
    otherActiveTurns: [],
    requiresConfirm: false,
    previewRevision: 'rev-preview-1',
    ...extra,
  }
}

function runMode(actions: ModeSwitchAction[]): ModeSwitchState {
  return actions.reduce(modeSwitchReducer, IDLE_MODE_SWITCH)
}

describe('mode/preview (D20) summary', () => {
  it('lists every other running turn and requires confirmation for them', () => {
    const p = preview({
      currentTurn: { sessionId: 'target', running: true },
      otherActiveTurns: [{ sessionId: 'other', title: 'Other chat' }],
      requiresConfirm: true,
    })
    const summary = summarizeModeSwitch(p)
    expect(summary.otherActiveTurns.map(t => t.sessionId)).toEqual(['other'])
    expect(summary.currentTurn?.sessionId).toBe('target')
    expect(summary.needsConfirmation).toBe(true)
    expect(summary.previewProblem).toBeUndefined()
  })

  it('does not require confirmation when only the current turn runs', () => {
    const summary = summarizeModeSwitch(preview({ currentTurn: { sessionId: 'target', running: true } }))
    expect(summary.needsConfirmation).toBe(false)
  })

  it('flags a preview that claims confirmation but lists no other turn', () => {
    expect(modeSwitchPreviewProblem(preview({ requiresConfirm: true }))).toBe('active-turns-missing')
    expect(modeSwitchPreviewProblem(preview({ previewRevision: '   ' }))).toBe('missing-revision')
    expect(modeSwitchPreviewProblem(preview())).toBeUndefined()
  })
})

describe('modeSwitchReducer', () => {
  it('refuses to apply a preview with a missing turn list or revision', () => {
    const confirming = runMode([
      { type: 'preview', nextMode: 'local' },
      { type: 'planned', preview: preview({ requiresConfirm: true }) },
    ])
    expect(confirming.phase).toBe('failed')
    expect(confirming.error?.code).toBe('mode-switch/preview-failed')
    expect(modeSwitchApplyRequest(confirming)).toEqual({ ok: false, reason: 'not-ready' })
  })

  it('walks the confirm path and emits the exact apply request', () => {
    const p = preview({
      currentTurn: { sessionId: 'target', running: true },
      otherActiveTurns: [{ sessionId: 'other' }],
      requiresConfirm: true,
    })
    const confirming = runMode([
      { type: 'preview', nextMode: 'local' },
      { type: 'planned', preview: p },
    ])
    expect(confirming.phase).toBe('confirming')
    const applying = modeSwitchReducer(confirming, { type: 'confirm' })
    expect(applying.phase).toBe('applying')
    expect(applying.confirmed).toBe(true)
    expect(modeSwitchApplyRequest(applying)).toEqual({
      ok: true,
      nextMode: 'local',
      previewRevision: 'rev-preview-1',
      cancelActiveTurns: true,
    })
    const done = modeSwitchReducer(applying, { type: 'applied', cancelledTurnIds: ['target', 'other'] })
    expect(done.phase).toBe('done')
    expect(done.cancelledTurnIds).toEqual(['target', 'other'])
  })

  it('carries the selected target session into the apply request', () => {
    const ready = runMode([
      { type: 'preview', nextMode: 'local', targetSessionId: 's1' },
      { type: 'planned', preview: preview() },
      { type: 'begin-apply' },
    ])
    expect(modeSwitchApplyRequest(ready)).toMatchObject({
      ok: true,
      nextMode: 'local',
      targetSessionId: 's1',
    })
  })

  it('auto-applies when only the current turn exists', () => {
    const ready = runMode([
      { type: 'preview', nextMode: 'server' },
      { type: 'planned', preview: preview({ currentTurn: { sessionId: 'target', running: true } }) },
    ])
    expect(ready.phase).toBe('ready')
    expect(modeSwitchReducer(ready, { type: 'confirm' })).toBe(ready)
    const applying = modeSwitchReducer(ready, { type: 'begin-apply' })
    expect(applying.phase).toBe('applying')
    expect(applying.confirmed).toBe(false)
    expect(modeSwitchApplyRequest(applying)).toMatchObject({ ok: true, nextMode: 'server' })
  })

  it('never applies the confirm path without an explicit confirm', () => {
    const confirming = runMode([
      { type: 'preview', nextMode: 'local' },
      { type: 'planned', preview: preview({ otherActiveTurns: [{ sessionId: 'other' }] }) },
    ])
    expect(confirming.phase).toBe('confirming')
    expect(modeSwitchReducer(confirming, { type: 'begin-apply' })).toBe(confirming)
    expect(modeSwitchApplyRequest(confirming)).toEqual({ ok: false, reason: 'not-ready' })
  })

  it('keeps preview and failure state for a retry, and cancels cleanly', () => {
    const applying = runMode([
      { type: 'preview', nextMode: 'local' },
      { type: 'planned', preview: preview() },
      { type: 'begin-apply' },
    ])
    expect(applying.phase).toBe('applying')
    const failed = modeSwitchReducer(applying, {
      type: 'failed',
      error: executorErrorView({ code: 'mode-switch/preview-stale', message: 'stale' }),
    })
    expect(failed.phase).toBe('failed')
    expect(failed.preview?.previewRevision).toBe('rev-preview-1')
    expect(failed.error?.kind).toBe('preview-stale')
    expect(modeSwitchReducer(failed, { type: 'cancel' })).toEqual(IDLE_MODE_SWITCH)
    expect(modeSwitchReducer(failed, { type: 'planned', preview: preview() }).phase).toBe('ready')
  })

  it('reports a partially failed cancellation instead of claiming success', () => {
    const applying = runMode([
      { type: 'preview', nextMode: 'local' },
      { type: 'planned', preview: preview() },
      { type: 'begin-apply' },
    ])
    const failed = modeSwitchReducer(applying, {
      type: 'applied',
      cancelledTurnIds: ['target'],
      failedCancellations: [{ sessionId: 'other', message: 'timeout' }],
    })
    expect(failed.phase).toBe('failed')
    expect(failed.failedCancellations).toEqual([{ sessionId: 'other', message: 'timeout' }])
    expect(failed.error?.code).toBe('mode-switch/cancel-failed')
    expect(failed.error?.failedCancellations).toEqual([{ sessionId: 'other', message: 'timeout' }])
  })

  it('annotates an applying switch with P3 progress phases only', () => {
    const applying = runMode([
      { type: 'preview', nextMode: 'local' },
      { type: 'planned', preview: preview() },
      { type: 'begin-apply' },
    ])
    const progressed = modeSwitchReducer(applying, { type: 'progress', phase: 'cancelling' })
    expect(progressed.progressPhase).toBe('cancelling')
    expect(modeSwitchReducer(IDLE_MODE_SWITCH, { type: 'progress', phase: 'ready' })).toBe(IDLE_MODE_SWITCH)
  })
})

describe('mode-switch errors and events', () => {
  it('maps the §16.13 errors', () => {
    expect(executorErrorView({ code: 'mode-switch/preview-failed', message: 'x' })).toMatchObject({
      kind: 'failed', retryable: true,
    })
    expect(executorErrorView({ code: 'mode-switch/preview-stale', message: 'x' }).kind).toBe('preview-stale')
    expect(executorErrorView({ code: 'mode-switch/other-turns-cancelled-required', message: 'x', details: {
      otherActiveTurns: [{ sessionId: 's1', title: 'One' }],
    } })).toMatchObject({
      kind: 'confirm-required',
      activeTurns: [{ sessionId: 's1', title: 'One', running: false, status: 'unknown' }],
    })
    expect(executorErrorView({ code: 'profile-locked', message: 'x' }).kind).toBe('profile-locked')
    expect(executorErrorView({ code: 'executor-mode-conflict', message: 'x' }).kind).toBe('mode-conflict')
    expect(executorErrorView({ code: 'registry-stale', message: 'x' }).kind).toBe('registry-stale')
    expect(executorErrorView({ code: 'mode-switch/cancel-failed', message: 'x', details: {
      failedCancellations: [{ sessionId: 's1', message: 'timeout' }, { nope: true }],
    } })).toMatchObject({
      kind: 'failed',
      failedCancellations: [{ sessionId: 's1', message: 'timeout' }],
    })
  })

  it('parses the P3 SSE events and rejects malformed ones', () => {
    expect(parseModeSwitchEvent({ type: 'mode-switch/progress', targetId: 't1', phase: 'cancelling' }))
      .toEqual({ type: 'mode-switch/progress', targetId: 't1', phase: 'cancelling' })
    expect(parseModeSwitchEvent({ type: 'turn/cancelled', targetId: 't1', sessionId: 's1' }))
      .toEqual({ type: 'turn/cancelled', targetId: 't1', sessionId: 's1' })
    expect(parseModeSwitchEvent({ type: 'mode/changed', targetId: 't1', sessionId: 's1', mode: 'local' }))
      .toEqual({ type: 'mode/changed', targetId: 't1', sessionId: 's1', mode: 'local' })
    expect(parseModeSwitchEvent({ type: 'mode/changed', targetId: 't1', mode: 'nope' })).toBeUndefined()
    expect(parseModeSwitchEvent({ type: 'mode-switch/progress', targetId: 't1', phase: 'nope' })).toBeUndefined()
    expect(parseModeSwitchEvent({ type: 'turn/cancelled', targetId: '', sessionId: 's1' })).toBeUndefined()
    expect(parseModeSwitchEvent(null)).toBeUndefined()
  })
})
