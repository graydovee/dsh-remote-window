/** v2 P3 host surface: query parsing and session command passthrough. */
import { describe, expect, it } from 'vitest'
import { Readable, Writable } from 'node:stream'
import { APPROVAL_DECISIONS, approvalDecision, handleSessionEvents } from '../src/index.ts'
import { sessionEventsQuery } from '../src/index.ts'
import { RemotePluginError, SESSION_RPC, sessionEventsPath } from '../src/remote/plugin-client.ts'

describe('v2 session event query', () => {
  it('parses target/session/afterSeq and rejects missing or malformed fields', () => {
    expect(sessionEventsQuery('/dsh-remote-workspace/api/session/events?targetId=rt-1&sessionId=s-1&afterSeq=4'))
      .toEqual({ targetId: 'rt-1', sessionId: 's-1', afterSeq: 4 })
    expect(sessionEventsQuery('/?targetId=rt-1&sessionId=s-1')).toEqual({ targetId: 'rt-1', sessionId: 's-1' })
    expect(() => sessionEventsQuery('/?sessionId=s-1')).toThrowError(/targetId/)
    expect(() => sessionEventsQuery('/?targetId=rt-1')).toThrowError(/sessionId/)
    expect(() => sessionEventsQuery('/?targetId=rt-1&sessionId=s-1&afterSeq=-2')).toThrowError(/afterSeq/)
    expect(() => sessionEventsQuery('/?targetId=rt-1&sessionId=s-1&afterSeq=x')).toThrowError(/afterSeq/)
  })

  it('validates approval decisions before touching the remote', () => {
    for (const decision of APPROVAL_DECISIONS) expect(approvalDecision(decision)).toBe(decision)
    expect(() => approvalDecision('maybe')).toThrowError(/decision/)
    expect(() => approvalDecision(undefined)).toThrowError(/decision/)
  })

  it('keeps the planned P1 method names and a stable event path adapter', () => {
    expect(SESSION_RPC).toEqual({
      timeline: 'session/timeline',
      prompt: 'session/prompt',
      cancel: 'session/cancel',
      approval: 'session/approval',
      status: 'session/status',
    })
    expect(sessionEventsPath({ sessionId: 's 1' })).toBe('/dsh-remote-workspace-server/api/session/events?sessionId=s+1')
    expect(new RemotePluginError('session-events-failed', 'x').code).toBe('session-events-failed')
  })
})


class CaptureResponse extends Writable {
  status = 0
  headers: Record<string, unknown> = {}
  body = ''
  wroteHead = false
  writeHead(status: number, headers?: Record<string, unknown>): this {
    this.status = status
    this.headers = headers ?? {}
    this.wroteHead = true
    return this
  }
  flushHeaders(): void {}
  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.body += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    callback()
  }
}

function eventRequest(url: string): Readable & { headers: Record<string, string>; method: string; url: string } {
  return Object.assign(Readable.from([]), { headers: { host: '127.0.0.1:1' }, method: 'GET', url })
}

describe('v2 session SSE host bridge', () => {
  it('returns a coded JSON 404 when the target is not connected', async () => {
    const res = new CaptureResponse()
    const ctx = { get: () => ({ trustedHosts: [] }) } as never
    const profiles = { connectionState: () => undefined } as never
    await handleSessionEvents(ctx, profiles, eventRequest('/dsh-remote-workspace/api/session/events?targetId=rt-1&sessionId=s-1') as never, res as never)
    expect(res.status).toBe(404)
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, error: { code: 'target-not-connected' } })
  })

  it('forwards P1 frames as same-origin SSE and ends cleanly', async () => {
    const res = new CaptureResponse()
    const ctx = { get: () => ({ trustedHosts: [] }) } as never
    const profiles = {
      connectionState: () => ({ phase: 'ready' }),
      sessionEvents: async function* () {
        yield { event: 'timeline', data: '{"seq":1,"type":"assistant"}' }
        yield { event: 'status', data: '{"running":true}' }
      },
    } as never
    await handleSessionEvents(ctx, profiles, eventRequest('/dsh-remote-workspace/api/session/events?targetId=rt-1&sessionId=s-1&afterSeq=0') as never, res as never)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    expect(res.body).toContain('event: timeline\ndata: {"seq":1,"type":"assistant"}')
    expect(res.body).toContain('event: status\ndata: {"running":true}')
  })
})
