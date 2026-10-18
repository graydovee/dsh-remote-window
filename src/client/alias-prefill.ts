/**
 * How one `~/.ssh/config` alias fills the step-2 draft.
 *
 * An alias carries **address facts** — host, port, user, identity file — and no
 * authentication *decision*. It used to force `authKind: 'privateKey'` whenever
 * the alias named an `IdentityFile`, which silently flipped a user who had
 * already chosen 密码 onto key auth: picking
 * `dshtest-wsl — graydove@192.168.10.210` then failed with
 * `cannot reach 192.168.10.210:22: All configured authentication methods failed`
 * (alpha55 defect). The prefill therefore only ever fills *fields*: the identity
 * file still lands in `privateKeyPath` (so switching to 私钥 is one click once
 * the user decides to), but the selected auth kind is never touched.
 *
 * Kept React-free so the rule is unit-testable: `store.ts` imports `react`,
 * which this repository does not install.
 */
import type { AliasPrefill } from './api.ts'

/** The draft fields an alias may fill (structural, so `ConnectDraft` fits). */
export interface AliasDraftTarget {
  host: string
  port: string
  username: string
  privateKeyPath: string
  label: string
}

/**
 * The patch one alias produces.
 *
 * Deliberately **no `authKind` member**: the type is the guarantee that the
 * prefill cannot override the user's choice, so a future refactor has to delete
 * a type member (and this comment) to reintroduce the defect.
 */
export interface AliasDraftPatch {
  sshConfigAlias: string
  host: string
  port: string
  username: string
  privateKeyPath?: string
  label: string
}

/**
 * Build the draft patch for one resolved alias.
 * @param prefill - the alias as `/api/alias-prefill` resolved it.
 * @param previous - the current draft (its label/username/private key are kept
 *   unless the alias provides better facts).
 * @returns the fields to merge into the draft.
 */
export function draftFromAlias(prefill: AliasPrefill, previous: AliasDraftTarget): AliasDraftPatch {
  const identityFile = prefill.identityFile !== undefined && prefill.identityFile !== ''
    ? prefill.identityFile
    : undefined
  return {
    sshConfigAlias: prefill.alias,
    host: prefill.host,
    port: String(prefill.port),
    username: prefill.username !== undefined && prefill.username !== '' ? prefill.username : previous.username,
    ...(identityFile === undefined ? {} : { privateKeyPath: identityFile }),
    label: previous.label.trim() === '' ? prefill.alias : previous.label,
  }
}
