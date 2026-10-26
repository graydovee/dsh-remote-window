/**
 * Test-only local fixture for the profile/runtime installers.
 *
 * The production seam is command execution on an SSH target; these helpers run
 * the exact same shell bodies against a real local `sh` in a temp directory, so
 * the tarball extraction, checksum, profile file and marker paths are exercised
 * for real without a remote host. They are not imported by production code.
 */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { ProfileExecResult, ProfilePaths, ProfileRemote } from '../../src/provision/profile-lifecycle.ts'
import { profilePaths } from '../../src/provision/profile-lifecycle.ts'

const execFileAsync = promisify(execFile)

/** A `ProfileRemote` that runs the body through the local POSIX shell. */
export class LocalShellRemote implements ProfileRemote {
  /** Every exec body, for tests that assert on the exact script. */
  readonly scripts: string[] = []
  /** Every file written, for tests that assert the offline payload. */
  readonly writes: { path: string; size: number }[] = []

  constructor(readonly cwd: string) {}

  async exec(body: string, _options?: { readonly maxBytes?: number; readonly timeoutMs?: number }): Promise<ProfileExecResult> {
    this.scripts.push(body)
    try {
      const result = await execFileAsync('sh', ['-c', body], { cwd: this.cwd, maxBuffer: 8 * 1024 * 1024, timeout: 20_000 })
      return { code: 0, stdout: result.stdout, stderr: result.stderr }
    } catch (error) {
      const failed = error as { code?: number | string; stdout?: string; stderr?: string }
      return {
        code: typeof failed.code === 'number' ? failed.code : 1,
        stdout: failed.stdout ?? '',
        stderr: failed.stderr ?? '',
      }
    }
  }

  async writeFile(path: string, content: Buffer): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
    this.writes.push({ path, size: content.length })
  }
}

/** A fresh local `$DSH_HOME`-shaped temp directory. */
export async function makeTempDshHome(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'dsh-rw-fixture-'))
}

/** Fixed profile paths under a temp `$DSH_HOME`. */
export async function makeProfilePaths(clientId = 'abcdef012345'): Promise<ProfilePaths> {
  return profilePaths(await makeTempDshHome(), clientId)
}

/** Write a minimal npm-pack-shaped server plugin package into `root/package`. */
export async function writeFakeServerPluginPackage(root: string, options: { version: string; name?: string }): Promise<void> {
  const pkg = join(root, 'package')
  await mkdir(join(pkg, 'lib'), { recursive: true })
  await writeFile(join(pkg, 'package.json'), `${JSON.stringify({
    name: options.name ?? 'dsh-remote-workspace-server',
    version: options.version,
    type: 'module',
    main: 'lib/plugin.js',
    dsh: { bundle: { patch: './cordis.patch.yml' }, manifestVersion: 1 },
    engines: { dsh: '0.2.1-rc.3' },
  }, null, 2)}\n`)
  await writeFile(join(pkg, 'cordis.patch.yml'), '- insert:\n    - id: dsh-remote-workspace-server\n      name: dsh-remote-workspace-server\n')
  await writeFile(join(pkg, 'lib', 'plugin.js'), 'export function apply() {}\n')
}

/** Pack `root/package` into `root/<name>.tgz` with the host `tar`. */
export async function packPackage(root: string, name: string): Promise<string> {
  const tarball = join(root, name)
  await execFileAsync('tar', ['-czf', tarball, '-C', root, 'package'])
  return tarball
}

/**
 * Write a fake isolated runtime artifact: `node/bin/node` (a shell stub that
 * prints `v24.21.0`) and `dsh/node_modules/.bin/dsh` (a shell stub), then pack
 * both at the tarball root.
 */
export async function writeFakeRuntimeArtifact(root: string, name: string): Promise<string> {
  const nodeBin = join(root, 'staging', 'node', 'bin')
  const dshBin = join(root, 'staging', 'dsh', 'node_modules', '.bin')
  await mkdir(nodeBin, { recursive: true })
  await mkdir(dshBin, { recursive: true })
  await writeFile(join(nodeBin, 'node'), '#!/bin/sh\nprintf %s "v24.21.0"\n', { mode: 0o755 })
  await writeFile(join(dshBin, 'dsh'), '#!/bin/sh\nprintf %s "dsh stub"\n', { mode: 0o755 })
  const tarball = join(root, name)
  await execFileAsync('tar', ['-czf', tarball, '-C', join(root, 'staging'), 'node', 'dsh'])
  return tarball
}
