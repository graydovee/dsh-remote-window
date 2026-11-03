/**
 * Which command language the *server* speaks.
 *
 * The plugin used to assume POSIX everywhere: every remote step was a `sh`
 * script, every remote path was absolute when it started with `/`, and the
 * isolated runtime was `<root>/node/bin/node` + `<root>/dsh/node_modules/.bin/dsh`.
 * A Windows server breaks all three assumptions, and it breaks them at
 * *deployment* time — long after the user has typed their address and pressed
 * connect. This module is the single place that decides the dialect and derives
 * its paths, so every consumer asks one question instead of sniffing strings.
 *
 * The dialect is decided from the probe's evidence, never from a guess:
 *
 * - `UNAME` reports `Windows` for the PowerShell probe (and `MINGW*`/`MSYS*`/
 *   `CYGWIN*` for a POSIX shell on Windows, e.g. Git Bash);
 * - `OSTYPE` (`/proc/sys/kernel/ostype`) proves Linux even when `uname` lies;
 * - an empty/unknown answer stays `unknown` so the caller can refuse with a
 *   coded error instead of silently deploying the wrong scripts.
 */
import { posix, win32 } from 'node:path'
import type { DshScan } from './dsh-scan.ts'

/** The command language of one server. */
export type RemoteKind = 'posix' | 'windows'

/**
 * Decide the remote dialect from one scan.
 * @param scan - the parsed probe output.
 * @returns `posix`, `windows`, or `unknown` when the evidence is insufficient.
 */
export function remoteKindOf(scan: Pick<DshScan, 'platform' | 'ostype'>): RemoteKind | 'unknown' {
  const uname = (scan.platform ?? '').trim()
  const ostype = (scan.ostype ?? '').trim().toLowerCase()
  if (ostype.includes('linux')) return 'posix'
  if (uname === '') return 'unknown'
  if (/^(mingw|msys|cygwin)/iu.test(uname) || /windows/iu.test(uname)) return 'windows'
  if (/^(linux|darwin|freebsd|openbsd|netbsd|sunos|aix)/iu.test(uname)) return 'posix'
  return 'unknown'
}

/**
 * Whether a path is absolute for one dialect.
 *
 * `win32.isAbsolute` accepts both `C:\x` and `\\server\share\x`; `posix` only
 * `/x`. Neither is used to *build* a path, only to validate one the user typed.
 * @param kind - the remote dialect.
 * @param value - the candidate path.
 */
export function remoteIsAbsolute(kind: RemoteKind, value: string): boolean {
  return kind === 'windows' ? win32.isAbsolute(value) : posix.isAbsolute(value)
}

/** The path module of one dialect (`posix` or `win32`), for joining only. */
export function remotePathModule(kind: RemoteKind): typeof posix {
  return kind === 'windows' ? (win32 as unknown as typeof posix) : posix
}

/**
 * Join remote path segments with the dialect's separator.
 *
 * This exists so no caller is tempted to reuse the *host's* `join` for a remote
 * path: on macOS a Windows server's `join('C:\\Users\\x', '.dsh')` would produce
 * a mixed-separator path that Windows tolerates but that no longer compares
 * equal to the path the user typed.
 * @param kind - the remote dialect.
 * @param parts - segments; later absolute segments reset the join, as usual.
 */
export function remoteJoin(kind: RemoteKind, ...parts: readonly string[]): string {
  const joined = remotePathModule(kind).join(...parts)
  return kind === 'windows' ? joined : joined
}

/** Strip trailing separators from a remote path (keeping a bare root). */
export function remoteTrimTrailing(kind: RemoteKind, value: string): string {
  const trimmed = kind === 'windows' ? value.replace(/[\\/]+$/u, '') : value.replace(/\/+$/u, '')
  if (trimmed === '') return value
  // `C:\` must stay `C:\`: trimming the separator off a drive root turns it
  // into the *relative* path `C:`, which no remote command accepts.
  return kind === 'windows' && /^[A-Za-z]:$/u.test(trimmed) ? `${trimmed}\\` : trimmed
}

/**
 * The remote `DSH_HOME` a Windows server uses by default.
 *
 * The POSIX path is `$HOME/.dsh`, which the probe already reports as
 * `scan.dshHome`; this is only the fallback when a probe answer is missing, and
 * on Windows `$HOME` and `$USERPROFILE` are the same directory.
 */
export function defaultRemoteDshHome(kind: RemoteKind, home: string): string {
  return remoteJoin(kind, remoteTrimTrailing(kind, home), '.dsh')
}

/**
 * The interpreter/build matrix key for a scan's platform and machine.
 *
 * Kept separate from {@link remoteKindOf}: this feeds an *artifact name*, and an
 * unknown answer must fail instead of picking `linux`.
 * @param scan - the parsed probe output.
 * @returns `win32-x64`, `linux-arm64-gnu`, … or `undefined` when undecidable.
 */
export function runtimePlatformArchOf(scan: Pick<DshScan, 'platform' | 'machine' | 'ostype' | 'ldd'>): string | undefined {
  const kind = remoteKindOf(scan)
  const machine = (scan.machine ?? '').trim().toLowerCase()
  const arch = machine === 'arm64' || machine === 'aarch64' || machine === 'arm64e' ? 'arm64' : machine === '' ? undefined : 'x64'
  if (arch === undefined) return undefined
  if (kind === 'windows') return `win32-${arch}`
  if (kind === 'unknown') return undefined
  const uname = (scan.platform ?? '').trim()
  if (uname === 'Darwin' || /^darwin/iu.test(uname)) return `darwin-${arch}`
  const libc = (scan.ldd ?? '').toLowerCase().includes('musl') ? 'musl' : 'gnu'
  return `linux-${arch}-${libc}`
}

/**
 * The dialect a scan's evidence says the remote speaks, as something we can act
 * on: anything that is not provably POSIX is treated as Windows *only* by the
 * caller that already chose the Windows probe (see `ProfileService.scanRemote`).
 * @param scan - remote evidence.
 */
export function remotePlatformOf(scan: Pick<DshScan, 'platform' | 'machine' | 'ostype' | 'ldd'>): RemoteKind {
  return remoteKindOf(scan) === 'posix' ? 'posix' : 'windows'
}

/**
 * `dirname` for a Windows path, without touching the host's own `node:path`.
 * @param value - an absolute Windows path.
 */
export function windowsDirname(value: string): string {
  return win32.dirname(value)
}
