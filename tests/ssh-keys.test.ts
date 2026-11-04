/**
 * `~/.ssh` private-key discovery for the connect dialog.
 *
 * Only files that look like a private key may be offered: the directory also
 * holds `known_hosts`, `config`, sockets and public halves, and every one of
 * them would turn into a confusing connect failure. The scanner is injected, so
 * these cases never read the real `~`.
 */
import { describe, expect, it } from 'vitest'
import { isPrivateKeyCandidate, listLocalPrivateKeys, looksLikePrivateKey, type SshKeyScanner } from '../src/provision/ssh-keys.ts'

const KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n'
const PEM = '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n'

/** Build a scanner over an in-memory directory. */
function scannerOf(files: Record<string, string>): SshKeyScanner {
  const names = Object.keys(files)
  return {
    readdir: async () => names.map(name => ({ name, isFile: () => true })),
    readHead: async path => {
      const name = path.slice(path.lastIndexOf('/') + 1)
      const value = files[name]
      if (value === undefined) throw new Error('ENOENT')
      return value
    },
    isFile: async path => files[path.slice(path.lastIndexOf('/') + 1)] !== undefined,
  }
}

describe('isPrivateKeyCandidate', () => {
  it('rejects the files that live next to keys', () => {
    for (const name of ['config', 'known_hosts', 'known_hosts2', 'authorized_keys', 'authorized_keys2', 'environment', 'rc']) {
      expect(isPrivateKeyCandidate(name)).toBe(false)
    }
  })

  it('rejects public halves, sockets and dotfiles', () => {
    expect(isPrivateKeyCandidate('id_ed25519.pub')).toBe(false)
    expect(isPrivateKeyCandidate('agent.sock')).toBe(false)
    expect(isPrivateKeyCandidate('.gitkeep')).toBe(false)
  })

  it('accepts ordinary private key names', () => {
    expect(isPrivateKeyCandidate('id_ed25519')).toBe(true)
    expect(isPrivateKeyCandidate('work_deploy')).toBe(true)
  })
})

describe('looksLikePrivateKey', () => {
  it('matches OpenSSH and PEM headers', () => {
    expect(looksLikePrivateKey(KEY)).toBe(true)
    expect(looksLikePrivateKey(PEM)).toBe(true)
  })

  it('rejects a public key and empty content', () => {
    expect(looksLikePrivateKey('ssh-ed25519 AAAAC3Nz user@host\n')).toBe(false)
    expect(looksLikePrivateKey('')).toBe(false)
  })
})

describe('listLocalPrivateKeys', () => {
  it('lists only private keys, as tilde paths', async () => {
    const keys = await listLocalPrivateKeys({
      dir: '/home/user/.ssh',
      displayPrefix: '~/.ssh',
      scanner: scannerOf({
        id_ed25519: KEY,
        id_rsa: PEM,
        'id_ed25519.pub': 'ssh-ed25519 AAAA user@host\n',
        known_hosts: 'example.test ssh-ed25519 AAAA\n',
        config: 'Host *\n',
      }),
    })
    expect(keys.map(key => key.path)).toEqual(['~/.ssh/id_ed25519', '~/.ssh/id_rsa'])
    expect(keys.map(key => key.label)).toEqual(['id_ed25519', 'id_rsa'])
  })

  it('puts id_* first, then sorts the rest', async () => {
    const keys = await listLocalPrivateKeys({
      dir: '/k',
      displayPrefix: '~/.ssh',
      scanner: scannerOf({ zz_key: KEY, aa_key: KEY, id_rsa: KEY, id_ed25519: KEY }),
    })
    expect(keys.map(key => key.label)).toEqual(['id_ed25519', 'id_rsa', 'aa_key', 'zz_key'])
  })

  it('skips a file whose content is not a private key', async () => {
    const keys = await listLocalPrivateKeys({ dir: '/k', scanner: scannerOf({ notes: 'hello\n' }) })
    expect(keys).toEqual([])
  })

  it('survives an unreadable entry and a missing directory', async () => {
    const base = scannerOf({ good: KEY, secret: KEY })
    const keys = await listLocalPrivateKeys({
      dir: '/k',
      scanner: {
        ...base,
        readHead: async path => {
          if (path.endsWith('/secret')) throw new Error('EACCES')
          return KEY
        },
      },
    })
    expect(keys.map(key => key.label)).toEqual(['good'])
    await expect(listLocalPrivateKeys({
      dir: '/nowhere',
      scanner: { ...base, readdir: async () => { throw new Error('ENOENT') } },
    })).resolves.toEqual([])
  })
})
