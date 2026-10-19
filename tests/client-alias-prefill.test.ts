/**
 * Alias prefill (alpha55 defect: choosing a `~/.ssh/config` alias forced the
 * auth kind to 私钥 and broke a password-only host).
 *
 * The rule under test is a pure function (`src/client/alias-prefill.ts`), so it
 * can be asserted here: the store that consumes it imports `react`, which this
 * repository does not install.
 */
import { describe, expect, it } from 'vitest'
import { draftFromAlias } from '../src/client/alias-prefill.ts'
import type { AliasPrefill } from '../src/client/api.ts'

/** A draft that already has a user-chosen auth kind and a label. */
const draft = {
  label: 'my-box',
  host: '',
  port: '22',
  username: '',
  privateKeyPath: '',
  authKind: 'password' as const,
}

/** The alias QA used: it names an IdentityFile, but the host only accepts a password. */
const aliasWithKey: AliasPrefill = {
  alias: 'dshtest-wsl',
  host: '203.0.113.10',
  port: 22,
  username: 'tester',
  identityFile: '~/.ssh/id_ed25519',
  source: 'config-file',
}

describe('draftFromAlias', () => {
  it('never carries an auth kind (the user keeps their choice)', () => {
    const patch = draftFromAlias(aliasWithKey, draft)
    expect('authKind' in patch).toBe(false)
    // The one visible consequence: a password draft stays a password draft.
    expect({ ...draft, ...patch }.authKind).toBe('password')
  })

  it('still prefills the identity file, so 私钥 is one click away', () => {
    const patch = draftFromAlias(aliasWithKey, draft)
    expect(patch.privateKeyPath).toBe('~/.ssh/id_ed25519')
  })

  it('fills the address facts the alias resolved', () => {
    expect(draftFromAlias(aliasWithKey, draft)).toMatchObject({
      sshConfigAlias: 'dshtest-wsl',
      host: '203.0.113.10',
      port: '22',
      username: 'tester',
      label: 'my-box',
    })
  })

  it('keeps a typed username when the alias has none', () => {
    const patch = draftFromAlias({ ...aliasWithKey, username: undefined }, { ...draft, username: 'typed' })
    expect(patch.username).toBe('typed')
  })

  it('leaves the old private key alone when the alias names no identity file', () => {
    const patch = draftFromAlias({ ...aliasWithKey, identityFile: undefined }, { ...draft, privateKeyPath: '~/.ssh/old' })
    expect('privateKeyPath' in patch).toBe(false)
    expect({ ...draft, privateKeyPath: '~/.ssh/old', ...patch }.privateKeyPath).toBe('~/.ssh/old')
  })

  it('uses the alias as the label only when none was typed', () => {
    expect(draftFromAlias(aliasWithKey, { ...draft, label: '  ' }).label).toBe('dshtest-wsl')
  })
})
