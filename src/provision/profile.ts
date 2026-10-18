/**
 * Remote profile generation.
 *
 * The remote end is a *profile*, not an uploaded binary: a directory with an
 * empty-bundle `package.json`, the standard empty root list, and a patch layer
 * that mounts exactly the execution providers plus this plugin's server row.
 * No agent loop, no session store, no model client and no credential provider is
 * mounted there, so nothing on the remote can reach the user's models.
 *
 * The plugin package itself is placed in the profile's `node_modules` instead of
 * being installed with a package manager: DSH resolves a profile-local package's
 * own peers (cordis, schemastery) from the dsh installation, so a plain
 * directory copy is a complete, offline install.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RemoteFile } from '../targets/types.ts'

/**
 * One file to write on the remote host.
 *
 * Re-exported from `targets/types.ts`, where it now lives: `ssh/connect.ts`
 * needs the shape and must not import the provisioning layer (architecture
 * §2.3, decision A9). Existing `import type { RemoteFile } from './profile.ts'`
 * call sites keep working.
 */
export type { RemoteFile }

/** Remote profile name used unless the target configures another one. */
export const DEFAULT_SERVER_PROFILE = 'dsh-remote-server'

/** Directory inside the profile that holds this plugin. */
export const PROFILE_PACKAGE_DIR = 'node_modules/dsh-remote-workspace'

const ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

/**
 * The provider rows a remote execution world needs.
 *
 * `session-projection` is required because `sandbox-policy` injects
 * `sessionProjections`; without it the policy service never activates and every
 * write is denied. `fs-sandbox` (not `fs-local`) is the provider that enforces
 * the per-call policy the client sends.
 */
function providerRows(options: { leaseMs: number; maxProcesses: number }): string {
  return `- insert:
    - id: remote-session-persistence
      name: '@deepseek-ai/dsh-session-persistence-jsonl'
      disabled: !!js ctx.get('sessionPersistence') !== undefined
      config:
        root: !!js dshHomePath('remote-server-sessions')
        compression: zstd
    - id: session-projection
      name: '@deepseek-ai/dsh-session-projection'
    - id: subprocess
      name: '@deepseek-ai/dsh-subprocess-local'
    - id: sandbox
      name: '@deepseek-ai/dsh-sandbox-local'
    - id: sandbox-policy
      name: '@deepseek-ai/dsh-sandbox-policy'
      config:
        mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'
        workspaceRoot: !!js process.cwd()
    - id: fs-sandbox
      name: '@deepseek-ai/dsh-fs-sandbox'
    - id: remote-workspace-server
      name: dsh-remote-workspace/server
      config:
        workspace: !!js process.cwd()
        identityFile: !!js dshHomePath('remote-server/server-id')
        workspaceIndex: !!js dshHomePath('remote-server/workspaces.json')
        statusFile: !!js dshHomePath('remote-server/status.json')
        leaseMs: ${options.leaseMs}
        maxProcesses: ${options.maxProcesses}
        exitOnClose: true
`
}

/** The remote profile's own files, keyed by path relative to the profile directory. */
export function remoteProfileFiles(options: {
  profile: string
  leaseMs?: number
  maxProcesses?: number
}): Map<string, string> {
  return new Map([
    ['package.json', `${JSON.stringify({
      name: `dsh-profile-${options.profile}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [] } },
    }, null, 2)}\n`],
    ['cordis.yml', ROOT_CONFIG],
    ['cordis.patch.yml', providerRows({ leaseMs: options.leaseMs ?? 30_000, maxProcesses: options.maxProcesses ?? 128 })],
    ['pnpm-workspace.yaml', 'packages:\n  - .\n'],
  ])
}

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
 * Single-quoting the value (as {@link shellQuote} would) freezes `$PATH` into
 * a literal relative directory name — npm's lifecycle scripts then spawn `sh`
 * through a nonexistent PATH entry and die with ENOENT. The literal directory
 * segments are escaped for double quotes; the trailing `$PATH` stays live.
 */
export function pathAssignment(prefixes: readonly string[]): string {
  const escaped = prefixes.map(segment => segment.replace(/([$"\\`])/g, '\\$1')).join(':')
  return `PATH="${escaped}:$PATH"`
}

/**
 * The command that starts the remote server on its stdio.
 *
 * Everything is an absolute path inside the deployment root and the explicit
 * `PATH` only exists so the `dsh` launcher's `#!/usr/bin/env node` shebang
 * resolves to the *deployed* node — the remote's own PATH is never consulted.
 */
export function serverCommand(options: { home: string; installHome: string; profile: string }): string {
  const root = `${options.installHome}/.dsh/server`
  return [
    `DSH_HOME=${shellQuote(options.home)}`,
    pathAssignment([`${root}/node/bin`, `${root}/dsh/node_modules/.bin`]),
    `exec ${shellQuote(`${root}/dsh/node_modules/.bin/dsh`)} --profile ${shellQuote(options.profile)}`,
  ].join(' ')
}

/**
 * The command that starts a **reused** dsh on its stdio.
 *
 * Why a PATH prefix rather than `node <launcher>`: the launcher we measured on
 * Ubuntu 22.04 (the deployed `.bin/dsh`) is a `/bin/sh` wrapper whose last line
 * is `exec node …`, so handing it to `node` as a script is not possible. Putting
 * the interpreter's directory **first on `PATH`** starts both shapes — a JS
 * launcher with `#!/usr/bin/env node` and that `/bin/sh` shim — with exactly the
 * same command, and it is also what makes `candidates[].nodePath` meaningful
 * (`doc/api-contract.md` §9.2's intent; the invocation differs only in form).
 *
 * `nodePath` is omitted for a self-contained (native) launcher: nothing needs to
 * be on PATH, and the remote's own PATH must not be relied on.
 * @param options - `DSH_HOME`, the launcher, the profile and the interpreter.
 */
export function reuseServerCommand(options: {
  readonly dshHome: string
  readonly launcher: string
  readonly profile: string
  /** Node (or other interpreter) whose directory leads `PATH`; omit when self-contained. */
  readonly nodePath?: string
}): string {
  const dirs: string[] = []
  if (options.nodePath !== undefined) {
    const nodeDir = options.nodePath.slice(0, options.nodePath.lastIndexOf('/'))
    if (nodeDir !== '') dirs.push(nodeDir)
    // A launcher in the interpreter's own `bin` (the nvm/pnpm layout) adds
    // nothing — but a hand-installed launcher elsewhere still needs its dir for
    // any `exec dsh` inside a wrapper script.
    const launcherDir = options.launcher.includes('/') ? options.launcher.slice(0, options.launcher.lastIndexOf('/')) : ''
    if (launcherDir !== '' && !dirs.includes(launcherDir)) dirs.push(launcherDir)
  }
  return [
    `DSH_HOME=${shellQuote(options.dshHome)}`,
    ...(dirs.length === 0 ? [] : [pathAssignment(dirs)]),
    `exec ${shellQuote(options.launcher)} --profile ${shellQuote(options.profile)}`,
  ].join(' ')
}
