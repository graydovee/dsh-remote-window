/**
 * Local turn release ordering (protocol §5.4/§6.3, architecture §6.3):
 *
 *   cancel → await whenIdle (3 s) → sessionPersistence.flush → handle.dispose
 *
 * The dispose is what releases the official JSONL flock. A failed release must
 * throw so the executor record is not flipped to `server`; a timed-out idle wait
 * is reported, while the dispose still has to finish.
 */
import { describe, expect, it } from 'vitest'
import {
  LocalTurnReleaseError,
  localTurnReleaser,
  releaseLocalTurn,
  type LocalAgentHandleLike,
} from '../src/session/local-turn.ts'

/** A fake handle that records the order of calls. */
function fakeHandle(options: {
  order?: string[]
  cancelThrows?: boolean
  idle?: () => Promise<void>
  dispose?: () => Promise<void>
} = {}): LocalAgentHandleLike & { order: string[] } {
  const order = options.order ?? []
  return {
    order,
    agent: {
      id: 'session-local-1',
      cancel: () => {
        order.push('cancel')
        if (options.cancelThrows === true) throw new Error('loop already stopped')
      },
      whenIdle: async () => {
        order.push('idle')
        await options.idle?.()
      },
    },
    dispose: async () => {
      order.push('dispose')
      await options.dispose?.()
    },
  }
}

/** A flush port that records and optionally fails. */
function fakeFlush(order: string[], failure?: Error): () => Promise<void> {
  return async () => {
    order.push('flush')
    if (failure !== undefined) throw failure
  }
}

describe('releaseLocalTurn', () => {
  it('cancels, waits for idle, flushes, then disposes', async () => {
    const order: string[] = []
    const handle = fakeHandle({ order })
    const result = await releaseLocalTurn(handle, { flush: fakeFlush(order) })
    expect(order).toEqual(['cancel', 'idle', 'flush', 'dispose'])
    expect(result).toEqual({ timedOut: false, alreadyReleased: false })
  })

  it('is idempotent per handle: a second release does not dispose again', async () => {
    const order: string[] = []
    const handle = fakeHandle({ order })
    await releaseLocalTurn(handle, { flush: fakeFlush(order) })
    const second = await releaseLocalTurn(handle, { flush: fakeFlush(order) })
    expect(second).toEqual({ timedOut: false, alreadyReleased: true })
    expect(order).toEqual(['cancel', 'idle', 'flush', 'dispose'])
  })

  it('reports a timed-out idle wait but still completes the dispose', async () => {
    const order: string[] = []
    const handle = fakeHandle({
      order,
      idle: async () => { await new Promise(resolve => setTimeout(resolve, 50)) },
    })
    const result = await releaseLocalTurn(handle, { flush: fakeFlush(order), timeoutMs: 5 })
    expect(result.timedOut).toBe(true)
    // The dispose barrier still ran, so the flock is released.
    expect(order).toEqual(['cancel', 'idle', 'flush', 'dispose'])
  })

  it('treats a throwing user-cancel as a diagnostic when dispose releases the lock', async () => {
    const order: string[] = []
    const result = await releaseLocalTurn(fakeHandle({ order, cancelThrows: true }), { flush: fakeFlush(order) })
    expect(order).toEqual(['cancel', 'idle', 'flush', 'dispose'])
    expect(result.cancelError).toBe('loop already stopped')
  })

  it('fails the release when the flush barrier fails', async () => {
    const order: string[] = []
    const failure = new LocalTurnReleaseError('mode-switch/cancel-failed', 'x')
    void failure
    await expect(releaseLocalTurn(fakeHandle({ order }), { flush: fakeFlush(order, new Error('remote append failed')) }))
      .rejects.toMatchObject({ code: 'mode-switch/cancel-failed' })
    // Dispose still ran: a failure must not leave the write handle open.
    expect(order).toEqual(['cancel', 'idle', 'flush', 'dispose'])
  })

  it('fails the release when dispose rejects', async () => {
    const order: string[] = []
    await expect(releaseLocalTurn(fakeHandle({
      order,
      dispose: async () => { throw new Error('handle close failed') },
    }), { flush: fakeFlush(order) })).rejects.toMatchObject({
      code: 'mode-switch/cancel-failed',
      message: expect.stringContaining('handle close failed'),
    })
  })

  it('reports release-timeout when dispose never resolves', async () => {
    const order: string[] = []
    const handle = fakeHandle({ order, dispose: async () => await new Promise(() => {}) })
    await expect(releaseLocalTurn(handle, { timeoutMs: 5 })).rejects.toMatchObject({
      code: 'mode-switch/release-timeout',
    })
  })

  it('binds into the executor switch port shape', async () => {
    const order: string[] = []
    const releaser = localTurnReleaser(fakeHandle({ order }))
    await releaser()
    expect(order).toEqual(['cancel', 'idle', 'dispose'])
  })
})
