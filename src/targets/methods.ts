/**
 * Which connection methods a platform may offer.
 *
 * One pure predicate, shared by the host's request validation and the browser
 * wizard, so "hidden outside Windows" is enforced on both sides instead of
 * being an eyeball-only claim: the client does not render a card when this
 * returns false, and `connect/start` rejects a forged `kind: 'wsl'` on the same
 * answer.
 */

/** Connection methods the wizard can present. */
export type ConnectionMethod = 'ssh' | 'docker' | 'wsl'

/**
 * Whether one method exists on a host platform.
 * @param method - wizard method id.
 * @param platform - `process.platform` of the harness host (`'win32'`, `'darwin'`, `'linux'`).
 * @returns true when the method may be offered on that platform.
 */
export function methodAvailable(method: ConnectionMethod, platform: string): boolean {
  if (method === 'ssh') return true
  // A container target is reserved for a later version on every platform.
  if (method === 'docker') return false
  // A WSL target is a *local* distro driven through `wsl.exe`
  // (`C:\WINDOWS\system32\wsl.exe`), so it only exists on a Windows host.
  return platform === 'win32'
}
