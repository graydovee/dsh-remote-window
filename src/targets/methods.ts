/**
 * Which connection methods a platform may offer.
 *
 * One pure predicate, shared by the host's request validation and the browser
 * wizard, so "hidden outside Windows" is enforced on both sides instead of
 * being an eyeball-only claim: the client does not render a card when this
 * returns false, and `connect/start` rejects a forged `kind: 'wsl'` on the same
 * answer.
 */

/** Connection methods the connection dialog can present. */
export type ConnectionMethod = 'ssh' | 'docker' | 'wsl'

/**
 * Whether the WSL transport is implemented yet.
 *
 * A WSL target is not an SSH alias: the host has to reach a DSH bound to
 * `127.0.0.1:<port>` *inside* a distribution. That needs two pieces this
 * repository does not have yet —
 *
 *  1. a host-side connector that runs scripts with `wsl.exe -d <distro> -- sh -s`
 *     (the script arrives on stdin, because wsl.exe argument quoting is not
 *     reliable), and
 *  2. a `ProfileForwarder` that dials the distribution's loopback (WSL2
 *     localhost forwarding) for the profile HTTP/WS traffic.
 *
 * Until both exist the method must not be offered anywhere, even on `win32`:
 * a card that always fails at connect/start is worse than no card. Flip this
 * flag *and* add `'wsl'` back to `OFFERED_METHODS` in
 * `src/client/method-cards.ts` in the same change that lands the transport.
 */
export const WSL_TRANSPORT_ENABLED = false

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
  // (`C:\WINDOWS\system32\wsl.exe`), so even with a transport it only exists
  // on a Windows host; today it needs the transport gate as well.
  return WSL_TRANSPORT_ENABLED && platform === 'win32'
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
