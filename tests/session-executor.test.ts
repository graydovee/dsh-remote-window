/**
 * Client half of the executor state machine (protocol §5.4, §16.5; D20).
 *
 * The server owns the record; these tests pin the ordering the client must
 * add:
 *
 * - local → server: release (cancel → idle → flush → close) **before** the
 *   record flips; a failed release must abort the switch, never let two
 *   writers race the JSONL artifact.
 * - server → local: preview (D20) → server switch → optional profile restart
 *   (only when the server says it is required); a failed restart is reported,
 *   not disguised as success.
 *
 * All RPCs are fake: no network, no official services.
 */
import { describe, expect, it } from 'vitest'
import {
  ExecutorAssignUnsupportedError,
  ExecutorHeldError,
  ExecutorModeConflictError,
  ExecutorRestartFailedError,
  ExecutorSwitchBusyError,
  ExecutorSwitchConfirmRequiredError,
  ServerExecutor,
  executorHeldByOther,
  isOwnerFresh,
  type ExecutorActiveTurn,
  type ExecutorRecord,
  type ExecutorRpc,
  type ExecutorSwitchPlan,
} from '../src/session/executor.ts'

const SESSION = 'session-exec-1'

/** One recorded RPC plus its resolved value. */
interface Call {
  readonly method: string
  readonly params: Record<string, unknown>
}

/** A scriptable RPC port. */
function fakeRpc(handlers: Record<string, (params: Record<string, unknown>) => unknown>): { rpc: ExecutorRpc; calls: Call[] } {
  const calls: Call[] = []
  const rpc: ExecutorRpc = {
    async request<T>(method: string, params: unknown): Promise<T> {
      const fields = (params ?? {}) as Record<string, unknown>
      calls.push({ method, params: fields })
      const handler = handlers[method]
      if (handler === undefined) throw new Error(`unexpected rpc ${method}`)
      return await handler(fields) as T
    },
  }
  return { rpc, calls }
}

/** A plan as the server would answer it. */
function plan(overrides: Partial<ExecutorSwitchPlan> = {}): ExecutorSwitchPlan {
  return {
    currentMode: 'server',
    to: 'local',
    restartRequired: true,
    activeTurns: [],
    requiresConfirmation: false,
    targetTurnRunning: false,
    ...overrides,
  }
}

/** One running turn entry. */
function turn(sessionId: string, running = true): ExecutorActiveTurn {
  return { sessionId, running, status: running ? 'running' : 'idle' }
}

/** A promise and its resolvers, for ordering assertions. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

describe('ServerExecutor.preview / get / assign', () => {
  it('reads and normalizes one executor record', async () => {
    const { rpc, calls } = fakeRpc({
      'executor/get': () => ({
        version: 1,
        sessionId: SESSION,
        mode: 'local',
        updatedAt: '2026-10-22T00:00:00.000Z',
        owner: { clientId: 'c1', instanceId: 'i1', heartbeatAt: '2026-10-22T00:00:00.000Z' },
      }),
    })
    const executor = new ServerExecutor(rpc)
    const record = await executor.get(SESSION)
    expect(record?.mode).toBe('local')
    expect(record?.owner?.clientId).toBe('c1')
    expect(calls).toEqual([{ method: 'executor/get', params: { sessionId: SESSION } }])
  })

  it('answers null for a missing record and rejects an invalid mode', async () => {
    const missing = new ServerExecutor(fakeRpc({ 'executor/get': () => null }).rpc)
    await expect(missing.get(SESSION)).resolves.toBeNull()

    const invalid = new ServerExecutor(fakeRpc({ 'executor/get': () => ({ mode: 'bogus' }) }).rpc)
    await expect(invalid.get(SESSION)).rejects.toMatchObject({ code: 'executor-record-invalid' })
  })

  it('assigns a local executor and maps an unsupported server to a typed error', async () => {
    const assigned = new ServerExecutor(fakeRpc({
      'executor/assign': () => ({ version: 1, sessionId: SESSION, mode: 'local', updatedAt: 'now' }),
    }).rpc)
    await expect(assigned.assign(SESSION, 'local')).resolves.toMatchObject({ mode: 'local' })

    const unsupported = new ServerExecutor(fakeRpc({
      'executor/assign': () => { throw Object.assign(new Error('no such method'), { code: 'bad-request', status: 400 }) },
    }).rpc)
    await expect(unsupported.assign(SESSION, 'local')).rejects.toBeInstanceOf(ExecutorAssignUnsupportedError)
  })

  it('normalizes a preview and keeps requiresConfirmation strict', async () => {
    const { rpc } = fakeRpc({
      'executor/plan-switch': () => plan({ requiresConfirmation: true, activeTurns: [turn('other')] }),
    })
    const preview = await new ServerExecutor(rpc).preview(SESSION, 'local')
    expect(preview.requiresConfirmation).toBe(true)
    expect(preview.activeTurns).toHaveLength(1)
  })
})

describe('ServerExecutor.switchTo server → local', () => {
  it('previews, switches, then restarts the profile only when required', async () => {
    const order: string[] = []
    const { rpc } = fakeRpc({
      'executor/plan-switch': () => { order.push('preview'); return plan({ restartRequired: true }) },
      'executor/switch': () => { order.push('switch'); return { mode: 'local', restartRequired: true } },
    })
    const executor = new ServerExecutor(rpc)
    const outcome = await executor.switchTo({
      sessionId: SESSION,
      to: 'local',
      restartProfile: async () => { order.push('restart') },
    })
    expect(outcome).toMatchObject({ mode: 'local', restartRequired: true })
    expect(order).toEqual(['preview', 'switch', 'restart'])
  })

  it('does not restart when a managed handle made the switch restart-free', async () => {
    let restarted = false
    const { rpc } = fakeRpc({
      'executor/plan-switch': () => plan({ restartRequired: false }),
      'executor/switch': () => ({ mode: 'local', restartRequired: false }),
    })
    const outcome = await new ServerExecutor(rpc).switchTo({
      sessionId: SESSION,
      to: 'local',
      restartProfile: async () => { restarted = true },
    })
    expect(outcome.restartRequired).toBe(false)
    expect(restarted).toBe(false)
  })

  it('refuses a switch that would cancel another running turn without D20 consent', async () => {
    const { rpc, calls } = fakeRpc({
      'executor/plan-switch': () => plan({ requiresConfirmation: true, activeTurns: [turn('other-session')] }),
    })
    const executor = new ServerExecutor(rpc)
    const failure = executor.switchTo({ sessionId: SESSION, to: 'local' })
    await expect(failure).rejects.toBeInstanceOf(ExecutorSwitchConfirmRequiredError)
    await expect(failure).rejects.toMatchObject({
      code: 'executor-switch-confirm-required',
      details: { activeTurns: [{ sessionId: 'other-session' }] },
    })
    // No switch may be sent before consent.
    expect(calls.map(call => call.method)).toEqual(['executor/plan-switch'])
  })

  it('passes the D20 consent through and reports the planned cancellations', async () => {
    const { rpc, calls } = fakeRpc({
      'executor/plan-switch': () => plan({ requiresConfirmation: true, activeTurns: [turn('other-session'), turn('idle', false)] }),
      'executor/switch': () => ({ mode: 'local', restartRequired: false }),
    })
    const outcome = await new ServerExecutor(rpc).switchTo({
      sessionId: SESSION,
      to: 'local',
      confirmOtherTurns: true,
    })
    expect(calls.find(call => call.method === 'executor/switch')?.params).toMatchObject({ confirmOtherTurns: true })
    expect(outcome.plannedCancellations).toEqual(['other-session'])
  })

  it('surfaces a failed profile restart instead of pretending the switch worked', async () => {
    const { rpc } = fakeRpc({
      'executor/plan-switch': () => plan(),
      'executor/switch': () => ({ mode: 'local', restartRequired: true }),
    })
    const failure = new ServerExecutor(rpc).switchTo({
      sessionId: SESSION,
      to: 'local',
      restartProfile: async () => { throw new Error('profile-start-timeout') },
    })
    await expect(failure).rejects.toBeInstanceOf(ExecutorRestartFailedError)
    await expect(failure).rejects.toMatchObject({
      code: 'executor-switch-restart-failed',
      details: { cause: 'profile-start-timeout' },
    })
  })

  it('is a no-op when the session already runs on the requested executor', async () => {
    const { rpc, calls } = fakeRpc({
      'executor/plan-switch': () => plan({ currentMode: 'local', to: 'local', restartRequired: false }),
    })
    const outcome = await new ServerExecutor(rpc).switchTo({ sessionId: SESSION, to: 'local' })
    expect(outcome).toMatchObject({ mode: 'local', restartRequired: false, plannedCancellations: [] })
    expect(calls.map(call => call.method)).toEqual(['executor/plan-switch'])
  })
})

describe('ServerExecutor.switchTo local → server', () => {
  it('releases the local turn before flipping the record', async () => {
    const order: string[] = []
    const { rpc } = fakeRpc({
      'executor/plan-switch': () => { order.push('preview'); return plan({ currentMode: 'local', to: 'server', restartRequired: false }) },
      'executor/switch': () => { order.push('switch'); return { mode: 'server', restartRequired: false } },
    })
    const executor = new ServerExecutor(rpc)
    const outcome = await executor.switchTo({
      sessionId: SESSION,
      to: 'server',
      releaseLocal: async () => { order.push('release') },
    })
    expect(outcome).toMatchObject({ mode: 'server', restartRequired: false })
    expect(order).toEqual(['preview', 'release', 'switch'])
  })

  it('refuses to flip without a release port', async () => {
    const { rpc, calls } = fakeRpc({
      'executor/plan-switch': () => plan({ currentMode: 'local', to: 'server' }),
    })
    await expect(new ServerExecutor(rpc).switchTo({ sessionId: SESSION, to: 'server' }))
      .rejects.toMatchObject({ code: 'mode-switch/release-required' })
    expect(calls.map(call => call.method)).toEqual(['executor/plan-switch'])
  })

  it('aborts the switch when the local turn cannot be released', async () => {
    const { rpc, calls } = fakeRpc({
      'executor/plan-switch': () => plan({ currentMode: 'local', to: 'server' }),
    })
    await expect(new ServerExecutor(rpc).switchTo({
      sessionId: SESSION,
      to: 'server',
      releaseLocal: async () => { throw new Error('dispose did not release the write handle') },
    })).rejects.toMatchObject({
      code: 'mode-switch/cancel-failed',
      details: { cause: 'dispose did not release the write handle' },
    })
    // The record must still say local: no writer is released.
    expect(calls.some(call => call.method === 'executor/switch')).toBe(false)
  })
})

describe('ServerExecutor concurrency', () => {
  it('rejects a second switch for the same session while one is in flight', async () => {
    const firstSwitch = deferred<unknown>()
    const { rpc } = fakeRpc({
      'executor/plan-switch': () => plan(),
      'executor/switch': async () => await firstSwitch.promise,
    })
    const executor = new ServerExecutor(rpc)
    const first = executor.switchTo({ sessionId: SESSION, to: 'local' })
    await Promise.resolve()
    await Promise.resolve()
    expect(executor.isSwitching(SESSION)).toBe(true)
    await expect(executor.switchTo({ sessionId: SESSION, to: 'local' })).rejects.toBeInstanceOf(ExecutorSwitchBusyError)
    firstSwitch.resolve({ mode: 'local', restartRequired: false })
    await expect(first).resolves.toMatchObject({ mode: 'local' })
    expect(executor.isSwitching(SESSION)).toBe(false)
  })
})

describe('executor ownership helpers', () => {
  const owner = (heartbeatAt: string): ExecutorRecord['owner'] => ({ clientId: 'c1', instanceId: 'i1', heartbeatAt })
  const now = Date.parse('2026-10-22T00:00:20.000Z')

  it('treats an owner heartbeat younger than 20 s as fresh', () => {
    expect(isOwnerFresh({ version: 1, sessionId: SESSION, mode: 'local', updatedAt: '', owner: owner('2026-10-22T00:00:10.000Z') }, now)).toBe(true)
    expect(isOwnerFresh({ version: 1, sessionId: SESSION, mode: 'local', updatedAt: '', owner: owner('2026-10-21T23:59:59.999Z') }, now)).toBe(false)
    expect(isOwnerFresh(null, now)).toBe(false)
    expect(isOwnerFresh({ version: 1, sessionId: SESSION, mode: 'local', updatedAt: '', owner: owner('not-a-date') }, now)).toBe(false)
  })

  it('only treats another live client as a hold', () => {
    const record: ExecutorRecord = {
      version: 1,
      sessionId: SESSION,
      mode: 'local',
      updatedAt: '',
      owner: owner('2026-10-22T00:00:10.000Z'),
    }
    expect(executorHeldByOther(record, { clientId: 'c1', instanceId: 'i1' }, now)).toBe(false)
    expect(executorHeldByOther(record, { clientId: 'c2', instanceId: 'i2' }, now)).toBe(true)
    expect(executorHeldByOther(record, { clientId: 'c2', instanceId: 'i2' }, now + 20_001)).toBe(false)
    expect(executorHeldByOther({ ...record, mode: 'server' }, { clientId: 'c2', instanceId: 'i2' }, now)).toBe(false)
  })

  it('maps occupancy to the protocol errors', async () => {
    const serverMode = new ServerExecutor(fakeRpc({
      'executor/get': () => ({ version: 1, sessionId: SESSION, mode: 'server', updatedAt: '' }),
    }).rpc)
    await expect(serverMode.assertLocalWritable(SESSION, { clientId: 'c1', instanceId: 'i1' }))
      .rejects.toBeInstanceOf(ExecutorModeConflictError)

    const held = new ServerExecutor(fakeRpc({
      'executor/get': () => ({
        version: 1,
        sessionId: SESSION,
        mode: 'local',
        updatedAt: '',
        owner: { clientId: 'other', instanceId: 'other', heartbeatAt: new Date().toISOString() },
      }),
    }).rpc)
    await expect(held.assertLocalWritable(SESSION, { clientId: 'c1', instanceId: 'i1' }))
      .rejects.toBeInstanceOf(ExecutorHeldError)
  })
})
