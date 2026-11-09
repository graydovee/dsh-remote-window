/**
 * Remote profile smoke test: the real remote shape, without an SSH host.
 *
 * It lays out a profile exactly the way the provisioner does — the bundled
 * server-plugin tarball offline in `node_modules`, the official `dsh-base` +
 * `dsh-web-app` bundles plus the plugin as the profile's bundle list — boots it
 * with the installed `dsh` CLI, and checks over HTTP that the profile resolved
 * the official providers and this plugin's own peers: the plugin row answers its
 * routes, an unauthenticated handshake is refused by admission, and the process
 * stays up.
 *
 * Gated on `DSH_SMOKE_CLI` (the dsh launcher), so ordinary runs stay hermetic:
 *   DSH_SMOKE_CLI="/Applications/DeepSeek Harness.app/.../runtime/cli/bin/dsh" npx vitest run tests/profile.smoke.test.ts
 *
 * The launcher must be the same dsh version the compat table pins (the desktop
 * app's bundled CLI may be newer); the bundled server tarball is extracted from
 * this package, so no npm install happens on the server side.
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROFILE_SERVER_PLUGIN, profileStartupFiles } from '../src/provision/profile-lifecycle.ts'

const CLI = process.env.DSH_SMOKE_CLI
const ROOT = join(import.meta.dirname ?? '.', '..')
const PROFILE = 'dsh-remote-server'
/** Total budget for the profile to print its token URL (cold start + plugin install marker). */
const START_TIMEOUT_MS = 90_000

/** Poll `read` until it yields a value or the deadline passes. */
async function waitFor<T>(read: () => T | undefined, timeoutMs: number): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() >= deadline) return undefined
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

describe.skipIf(CLI === undefined || process.platform === 'win32')('remote profile boot', () => {
  it('serves the plugin routes over HTTP and refuses unauthenticated handshakes', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-remote-home-'))
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-remote-work-'))
    let child: ReturnType<typeof spawn> | undefined
    try {
      // 1. Lay out the profile the provisioner writes (the four root files).
      const profileDir = join(home, 'profiles', PROFILE)
      await mkdir(profileDir, { recursive: true })
      for (const [name, content] of profileStartupFiles({ profile: PROFILE })) {
        await writeFile(join(profileDir, name), content, 'utf8')
      }

      // 2. Unpack the bundled server plugin into the profile's node_modules — the
      //    same artifact a dedicated profile receives, no package manager involved.
      const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as { version: string }
      const tarball = join(ROOT, 'assets', 'server-plugin', `dsh-remote-window-server-${manifest.version}.tgz`)
      const pluginDir = join(profileDir, 'node_modules', PROFILE_SERVER_PLUGIN)
      await mkdir(pluginDir, { recursive: true })
      execFileSync('tar', ['-xzf', tarball, '-C', pluginDir, '--strip-components=1'], { stdio: 'pipe' })

      // 3. Boot it exactly like the provisioner does (app args after --profile).
      child = spawn(CLI as string, ['--profile', PROFILE, '--host', '127.0.0.1', '--port', '0', '--no-open'], {
        cwd: workspace,
        env: { ...process.env, DSH_HOME: home },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      const skipped = (): string | undefined => /skipping profile bundle[\s\S]*?is incompatible with dsh/u.exec(stderr)?.[0]

      const tokenUrl = await waitFor(() => /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/u.exec(stdout)?.[1], START_TIMEOUT_MS)
      expect(tokenUrl, `profile never printed its token URL\nstdout:\n${stdout}\nstderr:\n${stderr}`).toBeDefined()
      expect(skipped(), 'the version gate refused the plugin instead of loading it').toBeUndefined()
      const base = new URL(tokenUrl as string).origin

      // 4. The plugin row registered its routes: bootstrap/embed CSS are static,
      //    and the RPC surface refuses an unauthenticated caller through admission.
      const bootstrap = await fetch(`${base}/dsh-remote-window-server/embed/bootstrap.js`)
      expect(bootstrap.status).toBe(200)
      expect(await bootstrap.text()).toContain('__dshRw')

      const css = await fetch(`${base}/dsh-remote-window-server/embed/embed.css`)
      expect(css.status).toBe(200)

      const handshake = await fetch(`${base}/dsh-remote-window-server/api/handshake`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect([401, 403]).toContain(handshake.status)
      expect(handshake.headers.get('content-type')).toContain('application/json')

      // 5. The process is still the one we started: the row did not crash after
      //    activating, and the profile keeps its lifetime.
      expect(child.exitCode).toBeNull()
    } catch (error) {
      console.error('[smoke] failed; profile dirs kept for inspection:', home, workspace)
      throw error
    } finally {
      if (child !== undefined && child.exitCode === null) {
        child.kill('SIGKILL')
        await new Promise(resolve => setTimeout(resolve, 250))
      }
      await rm(home, { recursive: true, force: true })
      await rm(workspace, { recursive: true, force: true })
    }
  }, 150_000)
})
