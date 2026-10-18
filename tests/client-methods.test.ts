/**
 * Step 1's method cards (alpha55: the disabled container teaser was removed).
 *
 * The criterion this pins down is a *list*, not a rendering: step 1 offers ssh,
 * plus wsl only on a Windows host, and no reserved/teaser card at all. The list
 * lives in `src/client/method-cards.ts` so it can be asserted here — the wizard
 * component itself imports the shell's runtime module table, which this
 * repository does not install and therefore cannot render in vitest.
 */
import { describe, expect, it } from 'vitest'
import { OFFERED_METHODS, offeredMethods } from '../src/client/method-cards.ts'

describe('wizard step 1 method cards', () => {
  it('offers ssh and wsl only', () => {
    expect(OFFERED_METHODS).toEqual(['ssh', 'wsl'])
  })

  it('never offers the reserved container method on any platform', () => {
    for (const platform of ['win32', 'darwin', 'linux', '']) {
      expect(offeredMethods(platform)).not.toContain('docker')
    }
  })

  it('renders the WSL card only on a Windows host', () => {
    expect(offeredMethods('win32')).toEqual(['ssh', 'wsl'])
    for (const platform of ['darwin', 'linux', '']) expect(offeredMethods(platform)).toEqual(['ssh'])
  })

  it('always offers ssh', () => {
    for (const platform of ['win32', 'darwin', 'linux', '']) {
      expect(offeredMethods(platform)).toContain('ssh')
    }
  })
})
