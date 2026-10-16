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

/** Remote profile name used unless the target configures another one. */
export const DEFAULT_SERVER_PROFILE = 'dsh-remote-server'

/** Directory inside the profile that holds this plugin. */
export const PROFILE_PACKAGE_DIR = 'node_modules/dsh-remote-workspace'

/** One file to write on the remote host. */
export interface RemoteFile {
  /** Absolute POSIX path. */
  readonly path: string
  readonly content: Buffer
}

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

/** The package files the remote needs at run time. */
export async function packageFiles(packageRoot: string): Promise<RemoteFile[]> {
  const files: RemoteFile[] = []
  const push = async (relative: string): Promise<void> => {
    files.push({ path: relative, content: await readFile(join(packageRoot, relative)) })
  }
  await push('package.json')
  await push('cordis.patch.yml')
  for (const name of await readdir(join(packageRoot, 'lib'))) {
    if (name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.cjs')) await push(join('lib', name))
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
