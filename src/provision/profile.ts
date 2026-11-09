/**
 * Package and POSIX-command helpers for the dedicated remote profile.
 *
 * The remote end is a *profile*, not an uploaded binary: a directory with the
 * official bundles, this plugin's server row and a copy of this package under
 * `node_modules`. These helpers copy that package and quote the command lines
 * the provisioning layer runs over SSH.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RemoteFile } from '../targets/types.ts'

/**
 * One file to write on the remote host.
 *
 * Re-exported from `targets/types.ts`, where it lives: `ssh/connect.ts` needs
 * the shape and must not import the provisioning layer (architecture §2.3,
 * decision A9). Existing `import type { RemoteFile } from './profile.ts'`
 * call sites keep working.
 */
export type { RemoteFile }

/**
 * The package files the remote needs at run time.
 *
 * The returned `path` is the **remote** (POSIX) path, never a host one: on
 * Windows `join('lib', 'server.js')` is `lib\server.js`, and using that as a
 * remote path wrote the bundle to a file literally named `libserver.js` in the
 * package root while the real `lib/server.js` kept an old build — which surfaced
 * only as a protocol mismatch (`expected 1`) when the stale server answered.
 */
export async function packageFiles(packageRoot: string): Promise<RemoteFile[]> {
  const files: RemoteFile[] = []
  /** Read one file by its host path but record its POSIX remote path. */
  const push = async (hostRelative: string, remotePath: string = hostRelative): Promise<void> => {
    files.push({ path: remotePath, content: await readFile(join(packageRoot, hostRelative)) })
  }
  await push('package.json')
  await push('cordis.patch.yml')
  for (const name of await readdir(join(packageRoot, 'lib'))) {
    if (name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.cjs')) await push(join('lib', name), `lib/${name}`)
  }
  return files
}

/** Quote one argv element for the POSIX shell. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * Build a `PATH=…` assignment whose `$PATH` still expands.
 *
 * Single-quoting the value (as {@link shellQuote} would) freezes `$PATH` into a
 * literal relative directory name — npm's lifecycle scripts then spawn `sh`
 * through a nonexistent PATH entry and die with ENOENT. The literal directory
 * segments are escaped for double quotes; the trailing `$PATH` stays live.
 */
export function pathAssignment(prefixes: readonly string[]): string {
  const escaped = prefixes.map(segment => segment.replace(/([$"\\`])/g, '\\$1')).join(':')
  return `PATH="${escaped}:$PATH"`
}
