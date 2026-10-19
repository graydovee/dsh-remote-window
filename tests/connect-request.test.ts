/**
 * The `connect/start` wire body → `ConnectRequest` mapping.
 *
 * This mapping is the only place a new wire field is read off the JSON, and a
 * field that is missing here is invisible in every later layer. alpha51 shipped
 * exactly that bug: `reuseLauncherPath` was accepted by the contract and by
 * `planProvision`, but never copied out of the body, so a perfectly healthy
 * reuse selection failed *after* the transport had already opened with
 * `reuse-launcher-missing: no dsh launcher was selected`. These tests pin the
 * field list (including the 400 the contract asks for when it is absent).
 */
import { describe, expect, it } from 'vitest'
import { connectRequestFrom } from '../src/index.ts'

/** A refusal as the route layer reports it (`code`/`status` are its public fields). */
function refusal(body: Record<string, unknown>): { code: string; status: number; message: string } {
  try {
    connectRequestFrom(body)
  } catch (error) {
    const coded = error as { code?: string; status?: number; message?: string }
    return { code: coded.code ?? '', status: coded.status ?? 0, message: coded.message ?? '' }
  }
  throw new Error('expected the request to be refused')
}

const WSL_REUSE = {
  kind: 'wsl',
  wslDistro: 'Ubuntu-22.04',
  label: 'ubuntu',
  packageSource: 'reuse',
  reuseLauncherPath: '/home/user/.dsh/server/dsh/node_modules/.bin/dsh',
}

describe('connectRequestFrom', () => {
  it('carries reuseLauncherPath for a WSL reuse connect (the alpha51 repro)', () => {
    const request = connectRequestFrom(WSL_REUSE)
    expect(request.packageSource).toBe('reuse')
    expect(request.reuseLauncherPath).toBe('/home/user/.dsh/server/dsh/node_modules/.bin/dsh')
    expect(request.kind).toBe('wsl')
    expect(request.wslDistro).toBe('Ubuntu-22.04')
  })

  it('carries reuseLauncherPath for an ssh reuse connect too', () => {
    const request = connectRequestFrom({
      label: 'box',
      host: '10.0.0.12',
      port: 22,
      username: 'tester',
      authKind: 'password',
      secret: 'hunter2',
      packageSource: 'reuse',
      reuseLauncherPath: '/home/user/.nvm/versions/node/v24.4.0/bin/dsh',
    })
    expect(request).toMatchObject({
      kind: 'ssh',
      packageSource: 'reuse',
      reuseLauncherPath: '/home/user/.nvm/versions/node/v24.4.0/bin/dsh',
      host: '10.0.0.12',
      username: 'tester',
      secret: 'hunter2',
    })
  })

  it('trims the launcher path and treats a blank one as absent', () => {
    expect(connectRequestFrom({ ...WSL_REUSE, reuseLauncherPath: '  /opt/dsh  ' }).reuseLauncherPath).toBe('/opt/dsh')
    // Blank + reuse = the documented 400, not a request that fails three layers down.
    const missing = refusal({ ...WSL_REUSE, reuseLauncherPath: '   ' })
    expect(missing.code).toBe('bad-request')
    expect(missing.status).toBe(400)
    expect(missing.message).toContain('reuseLauncherPath')
  })

  it('refuses reuse without a launcher at all', () => {
    const { reuseLauncherPath: _dropped, ...withoutPath } = WSL_REUSE
    expect('reuseLauncherPath' in withoutPath).toBe(false)
    const refused = refusal(withoutPath)
    expect(refused.code).toBe('bad-request')
    expect(refused.status).toBe(400)
    expect(refused.message).toContain('reuseLauncherPath')
  })

  it('omits packageSource when the wizard follows the global policy', () => {
    const request = connectRequestFrom({ kind: 'wsl', wslDistro: 'Ubuntu-22.04', label: 'ubuntu' })
    expect('packageSource' in request).toBe(false)
    expect('reuseLauncherPath' in request).toBe(false)
  })

  it('rejects a packageSource outside the enum', () => {
    const refused = refusal({ kind: 'wsl', wslDistro: 'Ubuntu-22.04', label: 'ubuntu', packageSource: 'sideload' })
    expect(refused.code).toBe('bad-request')
    expect(refused.status).toBe(400)
    expect(refused.message).toContain('packageSource')
  })

  it('keeps every ssh field the transports need', () => {
    const request = connectRequestFrom({
      label: 'box',
      host: 'dev-box',
      port: '2222',
      username: 'u',
      authKind: 'privateKey',
      privateKeyPath: '~/.ssh/id_ed25519',
      sshConfigAlias: 'dev-box',
      hostKeyFingerprint: 'SHA256:abc',
      remote: { profile: 'dsh-remote-server', dshHome: '~/.dsh' },
    })
    expect(request).toMatchObject({
      kind: 'ssh',
      host: 'dev-box',
      port: 2222,
      username: 'u',
      authKind: 'privateKey',
      privateKeyPath: '~/.ssh/id_ed25519',
      sshConfigAlias: 'dev-box',
      hostKeyFingerprint: 'SHA256:abc',
      remote: { profile: 'dsh-remote-server', dshHome: '~/.dsh' },
    })
  })

  it('keeps the WSL user and the platform-gated distro', () => {
    const request = connectRequestFrom({ ...WSL_REUSE, wslUser: 'tester' })
    expect(request).toMatchObject({ kind: 'wsl', wslUser: 'tester', host: 'Ubuntu-22.04', username: 'tester', port: 22, authKind: 'agent' })
    // Without a distro user the distro default applies and no credential is carried.
    expect(connectRequestFrom(WSL_REUSE).username).toBe('default')
    expect('secret' in connectRequestFrom(WSL_REUSE)).toBe(false)
  })

  it('still validates the ssh port range', () => {
    const base = { label: 'box', host: 'h', username: 'u' }
    expect(connectRequestFrom({ ...base, port: 1 }).port).toBe(1)
    expect(refusal({ ...base, port: 0 }).code).toBe('bad-request')
    expect(refusal({ ...base, port: 65_536 }).code).toBe('bad-request')
    expect(refusal({ ...base, port: 'not-a-port' }).code).toBe('bad-request')
  })

  it('validates the remote runtime block instead of passing it through (F2)', () => {
    const base = { ...WSL_REUSE }
    // Valid fields are trimmed and kept.
    const request = connectRequestFrom({
      ...base,
      remote: { nodePath: '  /opt/node/bin/node  ', dshCommand: 'dsh', profile: 'custom-profile', dshHome: '~/custom-dsh', plugins: ['a', 'b'] },
    })
    expect(request.remote).toEqual({
      nodePath: '/opt/node/bin/node',
      dshCommand: 'dsh',
      profile: 'custom-profile',
      dshHome: '~/custom-dsh',
      plugins: ['a', 'b'],
    })
    // `remote: {}` is legal: every field then comes from the stored record.
    expect(connectRequestFrom({ ...base, remote: {} }).remote).toEqual({})
    expect('remote' in connectRequestFrom(base)).toBe(false)
  })

  it('rejects a remote block the record schema would reject, naming the field', () => {
    const base = { ...WSL_REUSE }
    const badProfile = refusal({ ...base, remote: { profile: 'BadProfile' } })
    expect(badProfile.code).toBe('bad-request')
    expect(badProfile.status).toBe(400)
    expect(badProfile.message).toContain('remote.profile')

    for (const field of ['nodePath', 'dshCommand', 'dshHome'] as const) {
      const refused = refusal({ ...base, remote: { [field]: '   ' } })
      expect(refused.code).toBe('bad-request')
      expect(refused.message).toContain(`remote.${field}`)
    }

    const badPlugins = refusal({ ...base, remote: { plugins: ['ok', 3] } })
    expect(badPlugins.code).toBe('bad-request')
    expect(badPlugins.message).toContain('remote.plugins')

    const notAnObject = refusal({ ...base, remote: 'nope' })
    expect(notAnObject.code).toBe('bad-request')
    expect(notAnObject.message).toContain('"remote"')

    // An unknown key would otherwise blow up inside store.putTarget's zod parse
    // as a 500, halfway through a connect.
    const unknownKey = refusal({ ...base, remote: { dshHom: '~/.dsh' } })
    expect(unknownKey.code).toBe('bad-request')
    expect(unknownKey.message).toContain('remote.dshHom')
  })
})
