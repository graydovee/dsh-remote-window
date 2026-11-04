/**
 * Local private keys a connection may use.
 *
 * The private-key field is a text input plus a datalist, so the host has to
 * answer "which keys exist on this machine". Only paths are ever returned —
 * never key material — and only files that actually look like a private key:
 * `~/.ssh` also holds `known_hosts`, `config`, sockets and public halves, and
 * offering those would send the user into a connect failure.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** One selectable private key: an OpenSSH-style display path and its file name. */
export interface LocalPrivateKey {
  /** Tilde form (`~/.ssh/id_ed25519`); the dialog stores exactly this. */
  readonly path: string
  /** File name, used as the option label. */
  readonly label: string
}

/** Files in `~/.ssh` that are never private keys. */
const NOT_A_KEY = new Set([
  'config',
  'authorized_keys',
  'authorized_keys2',
  'known_hosts',
  'known_hosts2',
  'environment',
  'rc',
])

/** Largest file worth sniffing for a key header. */
const SNIFF_BYTES = 4096

/**
 * Whether a directory entry name could be a private key at all.
 * @param name - base name of one `~/.ssh` entry.
 * @returns false for public halves and the well-known non-key files.
 */
export function isPrivateKeyCandidate(name: string): boolean {
  if (name === '' || name.startsWith('.')) return false
  if (name.endsWith('.pub') || name.endsWith('.sock')) return false
  return !NOT_A_KEY.has(name)
}

/**
 * Whether the first bytes of a file look like a PEM/OpenSSH private key.
 * @param head - the beginning of the file as text.
 * @returns true when a `-----BEGIN … PRIVATE KEY-----` line is present.
 */
export function looksLikePrivateKey(head: string): boolean {
  return /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/u.test(head)
}

/** Injectable file-system surface, so the rule above is testable without `~`. */
export interface SshKeyScanner {
  readonly readdir: (dir: string) => Promise<Array<{ name: string; isFile: () => boolean }>>
  readonly readHead: (path: string) => Promise<string>
  readonly isFile: (path: string) => Promise<boolean>
}

const realScanner: SshKeyScanner = {
  readdir: async dir => await readdir(dir, { withFileTypes: true }),
  readHead: async path => (await readFile(path)).subarray(0, SNIFF_BYTES).toString('utf8'),
  isFile: async path => (await stat(path)).isFile(),
}

/**
 * List the private keys under a directory (default `~/.ssh`).
 *
 * A missing directory is not an error: a machine without `~/.ssh` simply has no
 * candidates, and the dialog falls back to the manual input.
 * @param options - override directory, display prefix and file-system surface.
 * @returns keys sorted with `id_*` first, then the rest, each alphabetical.
 */
export async function listLocalPrivateKeys(options: {
  readonly dir?: string
  readonly displayPrefix?: string
  readonly scanner?: SshKeyScanner
} = {}): Promise<LocalPrivateKey[]> {
  const dir = options.dir ?? join(homedir(), '.ssh')
  const prefix = options.displayPrefix ?? '~/.ssh'
  const scanner = options.scanner ?? realScanner
  let entries: Array<{ name: string; isFile: () => boolean }>
  try {
    entries = await scanner.readdir(dir)
  } catch {
    return []
  }
  const found: LocalPrivateKey[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !isPrivateKeyCandidate(entry.name)) continue
    const absolute = join(dir, entry.name)
    try {
      if (!(await scanner.isFile(absolute))) continue
      if (!looksLikePrivateKey(await scanner.readHead(absolute))) continue
    } catch {
      // Unreadable (mode 0600 owned by another user, iCloud stub, …): skip it
      // instead of failing the whole list.
      continue
    }
    found.push({ path: `${prefix}/${entry.name}`, label: entry.name })
  }
  return found.sort((left, right) => {
    const leftId = left.label.startsWith('id_') ? 0 : 1
    const rightId = right.label.startsWith('id_') ? 0 : 1
    return leftId === rightId ? left.label.localeCompare(right.label) : leftId - rightId
  })
}
