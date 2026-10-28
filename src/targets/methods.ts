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

/**
 * Which `DSH_HOME` a reconnect of a saved target should ask for.
 *
 * The wizard's DSH_HOME is optional, so the value worth reusing is the one the
 * previous connect resolved (remote `dshHome`, always absolute). Reusing it keeps
 * the profile patch, the profile server and the reverse tunnel in the same
 * directory; falling back to the remote default instead would leave the previous
 * bridge port in a profile that no longer belongs to this connection.
 *
 * `~`-relative defaults are not reused: the host never expands them, so the
 * remote scan decides what the home really is.
 * @param savedRemoteDshHome - `dshHome` recorded by the last successful connect.
 * @param requested - explicit DSH_HOME from the request body, when present.
 * @returns the DSH_HOME to pass to the connect request, or undefined for the scan default.
 */
export function reconnectDshHome(savedRemoteDshHome: string, requested: string | undefined): string | undefined {
  if (requested !== undefined) return requested
  return savedRemoteDshHome.startsWith('/') ? savedRemoteDshHome : undefined
}
