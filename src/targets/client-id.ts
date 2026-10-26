/**
 * Stable identities for the per-client profile and the per-process instance.
 *
 * `clientId` is the client installation's identity: it names the server profile
 * (`graydovee-remote-workspace-<clientId>`) and the isolated runtime directory,
 * so it must be stable across restarts and safe in a path and a DSH profile
 * name. `instanceId` is deliberately not persisted: it identifies **one client
 * DSH process** and is what the server-side lease uses to tell "my retry" from
 * "another process".
 */
import { randomBytes, randomUUID } from 'node:crypto'

/** Prefix DSH profile names carry; the requirements document fixes it. */
export const PROFILE_PREFIX = 'graydovee-remote-workspace-'

/** v1 clientId: 12 lowercase hex characters (48 bits). */
export const CLIENT_ID_LENGTH = 12

/** The profile-name and path-safe clientId shape. */
export const CLIENT_ID_PATTERN = /^[a-z0-9]{12}$/u

/** A DSH profile name built from this plugin's prefix and a clientId. */
export const PROFILE_NAME_PATTERN = /^graydovee-remote-workspace-[a-z0-9]{12}$/u

/** Random bytes seam, injectable so tests can pin a clientId. */
export type RandomBytes = (size: number) => Uint8Array

/**
 * Generate one clientId.
 * @param random - byte source; defaults to `node:crypto`.
 * @returns 12 lowercase hex characters.
 */
export function generateClientId(random: RandomBytes = randomBytes): string {
  const bytes = random(CLIENT_ID_LENGTH / 2)
  return Buffer.from(bytes).toString('hex')
}

/** Whether a value is a valid v1 clientId. */
export function isClientId(value: string): boolean {
  return CLIENT_ID_PATTERN.test(value)
}

/**
 * The DSH profile name for a clientId.
 * @throws Error when the clientId is not the v1 shape (never silently sanitize:
 *   a wrong profile name would point at another client's profile).
 */
export function profileNameFor(clientId: string): string {
  if (!isClientId(clientId)) throw new Error(`invalid clientId ${JSON.stringify(clientId)}`)
  return `${PROFILE_PREFIX}${clientId}`
}

/** Whether a string is one of this plugin's per-client profile names. */
export function isProfileName(name: string): boolean {
  return PROFILE_NAME_PATTERN.test(name)
}

/** A fresh per-process instance id (UUID v4 by default). */
export function generateInstanceId(create: () => string = randomUUID): string {
  return create()
}
