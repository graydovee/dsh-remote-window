/**
 * Vendored from `@deepseek-ai/dsh-util-workspace-path` (MIT, DeepSeek Harness).
 *
 * Only the one helper the vendored rows call is copied: the shell's row shows a
 * workspace's cwd on its hover card, abbreviating the host account home to `~`.
 */

/** Whether a path uses a Windows drive or UNC prefix. */
function isWindowsStylePath(value: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\')
}

/**
 * Abbreviate a POSIX home directory for display.
 * @param path - absolute or already-short display path.
 * @param home - host account home; absent skips abbreviation.
 * @returns `~` or `~/…` for the POSIX home and its descendants, otherwise `path`.
 */
export function abbreviateHomePath(path: string, home?: string): string {
  if (home === undefined || home === '') return path
  if (isWindowsStylePath(path) || isWindowsStylePath(home)) return path
  const root = home.replace(/\/+$/, '')
  if (root === '' || root === '/') return path
  if (path.replace(/\/+$/, '') === root) return '~'
  if (path.startsWith(`${root}/`)) return `~${path.slice(root.length)}`
  return path
}
