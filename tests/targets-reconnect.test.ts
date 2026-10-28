/**
 * Reconnects must keep the DSH_HOME the original connect resolved: the wizard's
 * field is optional, but the profile patch, profile server and reverse tunnel all
 * live under that home. A wrong guess points a live profile at a dead bridge.
 */
import { describe, expect, it } from 'vitest'
import { reconnectDshHome } from '../src/targets/methods.ts'

describe('reconnectDshHome', () => {
  it('reuses the absolute home recorded by the previous connect', () => {
    expect(reconnectDshHome('/home/user/.dsh', undefined)).toBe('/home/user/.dsh')
  })

  it('prefers an explicit request value', () => {
    expect(reconnectDshHome('/home/user/.dsh', '/srv/dsh')).toBe('/srv/dsh')
  })

  it('falls back to the remote scan for unexpanded or empty defaults', () => {
    expect(reconnectDshHome('~/.dsh', undefined)).toBeUndefined()
    expect(reconnectDshHome('', undefined)).toBeUndefined()
    expect(reconnectDshHome('./relative', undefined)).toBeUndefined()
  })
})
