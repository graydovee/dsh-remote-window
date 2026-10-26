/**
 * P3 mode/apply session/lease side (protocol §16.13).
 *
 * The ordering is the contract: local agents are released (cancel → idle →
 * flush → close) **before** any executor record flips to `server`, so a
 * server-mode writer cannot race the local agent for the official JSONL flock.
 * For server→local the server plugin either hands off its managed handle or asks
 * for a profile restart after cancelling the target turn.
 */
import { describe, expect, it } from 'vitest'
import { applyModeSwitch, type ModeApplyLocalPort } from '../src/session/mode-apply.ts'
import { ExecutorSwitchConfirmRequiredError, ServerExecutor, type ExecutorRpc } from '../src/session/executor.ts'

const SESSION = 'session-mode-1'

/** A scriptable P1 executor RPC. */
function fakeRpc(handler: (method: string, params: Record<string, unknown>) => unknown): {
  rpc: ExecutorRpc
  calls: Array<{ method: string; params: Record<string, unknown> }>
} {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = []
  return {
    calls,
    rpc: {
      async request<T>(method: string, params: unknown): Promise<T> {
        const fields = (params ?? {}) as Record<string, unknown>
        calls.push({ method, params: fields })
        return await handler(method, fields) as T
      },
    },
  }
}

/** A recording local-handle table. */
function fakeLocal(ids: readonly string[], order: string[], failure?: string): ModeApplyLocalPort {
  return {
    list: () => ids,
    release: async (sessionId: string) => {
      order.push(`release:${sessionId}`)
      if (failure === sessionId) throw new Error(`could not cancel ${sessionId}`)
    },
  }
}

/** A plan answer for one mode. */
function plan(currentMode: 'server' | 'local', restartRequired = false, activeTurns: unknown[] = []) {
  return {
    currentMode,
    restartRequired,
    activeTurns,
    requiresConfirmation: false,
    targetTurnRunning: false,
  }
}

describe('applyModeSwitch server → local', () => {
  it('switches the target session and restarts only when the server asks', async () => {
    const order: string[] = []
    const { rpc } = fakeRpc((method) => {
      if (method === 'executor/plan-switch') return plan('server', true)
      if (method === 'executor/switch') { order.push('switch'); return { mode: 'local', restartRequired: true } }
      throw new Error(`unexpected ${method}`)
    })
    const result = await applyModeSwitch({
      executor: new ServerExecutor(rpc),
      restartProfile: async () => { order.push('restart') },
    }, { nextMode: 'local', targetSessionId: SESSION, confirmOtherTurns: true })
    expect(result).toMatchObject({ switched: true, restartRequired: true, openSessionId: SESSION })
    expect(order).toEqual(['switch', 'restart'])
  })

  it('does not restart when a managed handle made the switch restart-free', async () => {
    let restarted = false
    const { rpc } = fakeRpc((method) => {
      if (method === 'executor/plan-switch') return plan('server', false)
      if (method === 'executor/switch') return { mode: 'local', restartRequired: false }
      throw new Error(`unexpected ${method}`)
    })
    const result = await applyModeSwitch({
      executor: new ServerExecutor(rpc),
      restartProfile: async () => { restarted = true },
    }, { nextMode: 'local', targetSessionId: SESSION, confirmOtherTurns: false })
    expect(result.restartRequired).toBe(false)
    expect(restarted).toBe(false)
  })

  it('refuses a target-less switch to local', async () => {
    await expect(applyModeSwitch({ executor: new ServerExecutor(fakeRpc(() => null).rpc) }, { nextMode: 'local', confirmOtherTurns: false }))
      .rejects.toMatchObject({ code: 'bad-request' })
  })

  it('surfaces the D20 consent error from the server plan', async () => {
    const { rpc } = fakeRpc((method) => {
      if (method === 'executor/plan-switch') {
        return { ...plan('server', false, [{ sessionId: 'other', running: true, status: 'running' }]), requiresConfirmation: true }
      }
      throw new Error('switch must not be sent without consent')
    })
    await expect(applyModeSwitch({
      executor: new ServerExecutor(rpc),
    }, { nextMode: 'local', targetSessionId: SESSION, confirmOtherTurns: false }))
      .rejects.toBeInstanceOf(ExecutorSwitchConfirmRequiredError)
  })
})

describe('applyModeSwitch local → server', () => {
  it('releases every local writer before flipping any record', async () => {
    const order: string[] = []
    const calls: string[] = []
    const { rpc } = fakeRpc((method, params) => {
      calls.push(`${method}:${String(params['sessionId'])}`)
      if (method === 'executor/plan-switch') return plan('local', false)
      if (method === 'executor/switch') { order.push(`switch:${String(params['sessionId'])}`); return { mode: 'server', restartRequired: false } }
      throw new Error(`unexpected ${method}`)
    })
    const result = await applyModeSwitch({
      executor: new ServerExecutor(rpc),
      local: fakeLocal(['a', 'b'], order),
    }, { nextMode: 'server', confirmOtherTurns: false })
    expect(result).toMatchObject({ switched: true, restartRequired: false, switchedSessionIds: ['a', 'b'] })
    expect(order).toEqual(['release:a', 'release:b', 'switch:a', 'switch:b'])
    expect(calls.filter(call => call.startsWith('executor/switch'))).toHaveLength(2)
  })

  it('aborts before flipping any record when a release fails', async () => {
    const order: string[] = []
    const { rpc, calls } = fakeRpc((method) => {
      if (method === 'executor/plan-switch') return plan('local', false)
      if (method === 'executor/switch') return { mode: 'server', restartRequired: false }
      throw new Error(`unexpected ${method}`)
    })
    await expect(applyModeSwitch({
      executor: new ServerExecutor(rpc),
      local: fakeLocal(['a', 'b'], order, 'a'),
    }, { nextMode: 'server', confirmOtherTurns: false })).rejects.toMatchObject({
      code: 'mode-switch/cancel-failed',
      details: { failedCancellations: [{ sessionId: 'a' }] },
    })
    // No switch may be attempted after a failed release.
    expect(calls.some(call => call.method === 'executor/switch')).toBe(false)
    expect(order).toEqual(['release:a', 'release:b'])
  })

  it('reports a failed record flip after all writers were released', async () => {
    const order: string[] = []
    const { rpc } = fakeRpc((method, params) => {
      if (method === 'executor/plan-switch') return plan('local', false)
      if (method === 'executor/switch' && params['sessionId'] === 'b') throw new Error('server refuses the flip')
      if (method === 'executor/switch') return { mode: 'server', restartRequired: false }
      throw new Error(`unexpected ${method}`)
    })
    await expect(applyModeSwitch({
      executor: new ServerExecutor(rpc),
      local: fakeLocal(['a', 'b'], order),
    }, { nextMode: 'server', confirmOtherTurns: false })).rejects.toMatchObject({
      code: 'mode-switch/cancel-failed',
      details: { switchedSessionIds: ['a'] },
    })
    expect(order).toEqual(['release:a', 'release:b'])
  })

  it('is a no-op for records that already say server after the release pass', async () => {
    const order: string[] = []
    const { rpc } = fakeRpc((method) => {
      if (method === 'executor/plan-switch') return plan('server', false)
      if (method === 'executor/switch') return { mode: 'server', restartRequired: false }
      throw new Error(`unexpected ${method}`)
    })
    const result = await applyModeSwitch({
      executor: new ServerExecutor(rpc),
      local: fakeLocal(['a'], order),
    }, { nextMode: 'server', confirmOtherTurns: false })
    expect(result.switchedSessionIds).toEqual(['a'])
    // The record already reads server, so the release was the only mutation.
    expect(order).toEqual(['release:a'])
  })
})
