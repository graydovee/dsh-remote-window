/**
 * Remote host-key verification.
 *
 * An unknown host key is never accepted silently: the wizard must show the
 * fingerprint and the user must confirm it, after which it is pinned in the
 * target record. A changed key is always refused. `known_hosts` is an optional
 * convenience for *filling* that fingerprint, never a bypass.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** OpenSSH-style SHA-256 fingerprint of a raw host key. */
export function fingerprintOf(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
}

/** A host key differing from the pinned one; never recoverable by retrying. */
export class HostKeyMismatchError extends Error {
  readonly code = 'REMOTE_HOST_KEY_CHANGED'

  constructor(readonly expected: string, readonly actual: string) {
    super(`remote host key changed: expected ${expected}, received ${actual}`)
    this.name = 'HostKeyMismatchError'
  }
}

/** The host key is not pinned yet; the caller must confirm the fingerprint first. */
export class HostKeyUnknownError extends Error {
  readonly code = 'REMOTE_HOST_KEY_UNKNOWN'

  constructor(readonly fingerprint: string) {
    super(`unverified remote host key ${fingerprint}; confirm the fingerprint and connect again`)
    this.name = 'HostKeyUnknownError'
  }
}

/** Either host-key rejection: first contact or a changed key. */
export type HostKeyRejection = HostKeyUnknownError | HostKeyMismatchError

/**
 * Build ssh2's `hostVerifier` for one target.
 *
 * ssh2 calls this synchronously from the key-exchange state machine and only
 * understands `boolean` (or `undefined` for async verification). Throwing out
 * of it aborts the packet parser while the exchange is still half finished, so
 * the server's trailing NEWKEYS packet then crashes the client with
 * "Received packet 21 instead of 31" — in this host that uncaught protocol
 * error takes down the whole DSH process. Answer `false` instead: ssh2
 * disconnects cleanly, and the typed reason travels out of band to the caller.
 * @param pinned - the confirmed fingerprint, or undefined for first contact.
 * @param onReject - receives the typed rejection (anonymous or changed key).
 * @returns a verifier that reports the fingerprint instead of silently trusting it.
 */
export function hostVerifier(
  pinned: string | undefined,
  onReject?: (error: HostKeyRejection) => void,
): (key: Buffer) => boolean {
  return (key: Buffer): boolean => {
    const actual = fingerprintOf(key)
    if (pinned === undefined) {
      onReject?.(new HostKeyUnknownError(actual))
      return false
    }
    if (pinned !== actual) {
      onReject?.(new HostKeyMismatchError(pinned, actual))
      return false
    }
    return true
  }
}

/** Default OpenSSH known_hosts path. */
export function knownHostsPath(): string {
  return join(homedir(), '.ssh', 'known_hosts')
}

/**
 * Find a plain-text `known_hosts` fingerprint for one host.
 *
 * Hashed entries (`|1|…`) cannot be matched without their host salt and are
 * skipped; the caller then falls back to explicit confirmation.
 * @param host - hostname or address.
 * @param port - port; a non-default port matches OpenSSH's `[host]:port` form.
 * @param path - known_hosts file, defaulting to the user's.
 * @returns the fingerprint, or undefined when no plain-text entry matches.
 */
export async function lookupKnownHost(
  host: string,
  port: number,
  path = knownHostsPath(),
): Promise<string | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return undefined
  }
  const names = new Set(port === 22 ? [host] : [`[${host}]:${port}`])
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#') || line.startsWith('|')) continue
    const [hosts, keyType, key] = line.split(/\s+/)
    if (hosts === undefined || keyType === undefined || key === undefined) continue
    if (!hosts.split(',').some(name => names.has(name))) continue
    const decoded = Buffer.from(key, 'base64')
    if (decoded.length === 0) continue
    return fingerprintOf(decoded)
  }
  return undefined
}
