/**
 * Step 1's method cards (SSH only while the WSL transport does not exist).
 *
 * The criterion this pins down is a *list*, not a rendering: step 1 offers ssh
 * everywhere, never the reserved container method, and never wsl until the host
 * gains a WSL connector + profile forwarder (`WSL_TRANSPORT_ENABLED` in
 * `src/targets/methods.ts`). The list lives in `src/client/method-cards.ts` so
 * it can be asserted here — the dialog component itself imports the shell's
 * runtime module table, which this repository does not install.
 */
import { describe, expect, it } from 'vitest'
import { OFFERED_METHODS, offeredMethods } from '../src/client/method-cards.ts'

describe('connect dialog step 1 method cards', () => {
  it('offers ssh only while the WSL transport is missing', () => {
    expect(OFFERED_METHODS).toEqual(['ssh'])
  })

  it('never offers the reserved container method on any platform', () => {
    for (const platform of ['win32', 'darwin', 'linux', '']) {
      expect(offeredMethods(platform)).not.toContain('docker')
    }
  })

  it('does not offer the WSL card on any platform until its transport exists', () => {
    for (const platform of ['win32', 'darwin', 'linux', '']) {
      expect(offeredMethods(platform)).toEqual(['ssh'])
    }
  })

  it('always offers ssh', () => {
    for (const platform of ['win32', 'darwin', 'linux', '']) {
      expect(offeredMethods(platform)).toContain('ssh')
    }
  })
})
