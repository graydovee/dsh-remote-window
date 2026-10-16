/**
 * Remote profile smoke test: the real remote shape, without an SSH host.
 *
 * It lays out a profile exactly the way the provisioner does — an empty-bundle
 * profile whose patch layer mounts the execution providers plus
 * `dsh-remote-workspace/server`, with the built plugin copied into the profile's
 * `node_modules` — boots it with the installed `dsh` CLI, and speaks the
 * protocol over its stdio. This proves the part an in-process fixture cannot:
 * that a *profile* boot resolves the official providers and this plugin's own
 * peers, keeps stdout clean, serves the method set, and exits on `close`.
 *
 * Gated on `DSH_SMOKE_CLI` (the dsh launcher), so ordinary runs stay hermetic:
 *   DSH_SMOKE_CLI="/Applications/DeepSeek Harness.app/.../runtime/cli/bin/dsh" npx vitest run tests/profile.smoke.test.ts
 */
import { spawn } from 'node:child_process'
import { openSync } from 'node:fs'
import { appendFile, copyFile, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { SshRpcPeer, SSH_PROTOCOL_VERSION } from '@deepseek-ai/dsh-ssh/protocol'
import { entriesSchema, helloSchema, preparedSchema, targetSchema, writeResultSchema } from '@deepseek-ai/dsh-ssh/schemas'
import { DEFAULT_MAX_FRAME_BYTES } from '../src/frame/codec.ts'
import { FrameMux, streamTransport } from '../src/frame/mux.ts'
import { remoteProfileFiles, PROFILE_PACKAGE_DIR } from '../src/provision/profile.ts'

const CLI = process.env.DSH_SMOKE_CLI
const LIB_DIR = join(import.meta.dirname ?? '.', '..', 'lib')

describe.skipIf(CLI === undefined)('remote profile boot', () => {
  it('serves the protocol over stdio and exits on close', async () => {
    process.once('unhandledRejection', (reason) => {
      console.error('[smoke] unhandledRejection:', reason instanceof Error ? reason.stack : String(reason))
    })
    let child: ReturnType<typeof spawn> | undefined
    let stderrLog = ''
    const home = await mkdtemp(join(tmpdir(), 'dsh-remote-home-'))
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-remote-work-'))
    try {
      // 1. Lay out the profile the provisioner writes.
      const profileName = 'dsh-remote-server'
      const profileDir = join(home, 'profiles', profileName)
      await mkdir(profileDir, { recursive: true })
      for (const [name, content] of remoteProfileFiles({ profile: profileName, leaseMs: 30_000 })) {
        await writeFile(join(profileDir, name), content, 'utf8')
      }
      // 2. Install this plugin into the profile's node_modules (a plain copy).
      const packageDir = join(profileDir, ...PROFILE_PACKAGE_DIR.split('/'))
      await mkdir(packageDir, { recursive: true })
      await copyFile(join(LIB_DIR, '..', 'package.json'), join(packageDir, 'package.json'))
      await copyFile(join(LIB_DIR, '..', 'cordis.patch.yml'), join(packageDir, 'cordis.patch.yml'))
      await mkdir(join(packageDir, 'lib'), { recursive: true })
      const built = await readdir(LIB_DIR)
      for (const name of built) {
        if (name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.cjs')) {
          await copyFile(join(LIB_DIR, name), join(packageDir, 'lib', name))
        }
      }
      await writeFile(join(workspace, 'smoke.txt'), 'from the remote world\n', 'utf8')

      // 3. Boot the profile and speak the protocol on its stdio.
      let lastStep = 'start'
      const step = (name: string): void => { lastStep = name; if (process.env.DSH_RW_DEBUG) console.error('[smoke] step', name) }
      stderrLog = join(home, 'server-stderr.log')
      const proc = spawn(CLI as string, ['--profile', profileName], {
        cwd: workspace,
        env: { ...process.env, DSH_HOME: home },
        stdio: ['pipe', 'pipe', openSync(stderrLog, 'a')],
      })
      child = proc
      const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
        proc.once('close', (code, signal) => { resolve({ code, signal }) })
      })

      // The child's stdio leaves when it exits; the shared adapter contains
      // the resulting EPIPE instead of letting it escape as an uncaught error.
      const mux = new FrameMux({
        transport: streamTransport(child.stdout ?? new PassThrough(), child.stdin ?? new PassThrough()),
        role: 'client',
        label: 'profile-smoke',
      })
      const peer = new SshRpcPeer(mux.jsonInput(), mux.jsonOutput(), DEFAULT_MAX_FRAME_BYTES, 128)

      step('hello');
      const hello = await peer.request(
        'hello',
        { protocol: SSH_PROTOCOL_VERSION, workspace, leaseMs: 30_000 },
        helloSchema,
        AbortSignal.timeout(60_000),
      )
      // The server row loaded, which means the profile resolved this plugin and
      // every official provider it mounts.
      expect(hello.platform).toBe('darwin')
      expect(hello.workspace.startsWith('/')).toBe(true)

      // fs: write, read back, list.
      // A fresh file: `createIfAbsent` must refuse an existing one.
      step('fs.resolve');
      const file = await peer.request(
        'fs.resolve',
        { path: join(workspace, 'remote.txt'), cwd: hello.workspace },
        targetSchema,
        AbortSignal.timeout(20_000),
      )
      step('fs.write');
      const written = await peer.request(
        'fs.write',
        {
          target: file,
          content: 'written remotely\n',
          expected: { kind: 'createIfAbsent' },
          policy: { mode: 'workspace-write', workspaceRoot: hello.workspace },
        },
        writeResultSchema,
        AbortSignal.timeout(20_000),
      )
      expect(written.operation).toBe('create')
      step('fs.readText');
      const text = await peer.request('fs.readText', { target: file }, z.string(), AbortSignal.timeout(20_000))
      expect(text).toBe('written remotely\n')
      step('fs.resolve root');
      const root = await peer.request('fs.resolve', { path: hello.workspace }, targetSchema, AbortSignal.timeout(20_000))
      step('fs.list');
      const entries = await peer.request('fs.list', { target: root }, entriesSchema, AbortSignal.timeout(20_000))
      expect(entries.some(entry => entry.name === 'smoke.txt')).toBe(true)

      // process: run one command through the pipe-mode channel set.
      step('process.prepare');
      const prepared = await peer.request(
        'process.prepare',
        { argv: ['/bin/sh', '-c', 'printf smoke-ok'], cwd: hello.workspace, graceMs: 5000, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' } },
        preparedSchema,
        AbortSignal.timeout(20_000),
      )
      step('open stdout');
      const stdout = await mux.open(prepared.streams.stdout, AbortSignal.timeout(20_000))
      const stderrStream = await mux.open(prepared.streams.stderr, AbortSignal.timeout(20_000))
      stdout.end()
      stderrStream.end()
      const collected: Buffer[] = []
      stdout.on('data', (chunk: Buffer) => { collected.push(chunk) })
      step('process.start');
      await peer.request('process.start', { id: prepared.id }, z.object({}).strict(), AbortSignal.timeout(20_000))
      step('process.done');
      const done = await peer.request('process.done', { id: prepared.id }, z.unknown())
      expect((done as { outcome: { exitCode: number } }).outcome.exitCode).toBe(0)
      expect(Buffer.concat(collected).toString()).toBe('smoke-ok')

      // close: the server must answer and the host process must leave.
      step('close')
      await peer.request('close', {}, z.null(), AbortSignal.timeout(20_000))
      const exit = await exited
      expect(exit.code ?? 0).toBe(0)
      mux.close()
      proc.kill('SIGTERM')

      // stdout carried only protocol frames (no banner, no log line): if the
      // host had printed anything, the mux would have failed long before here.
      expect(mux.openStreams).toBe(0)
    } catch (error) {
      console.error(`[smoke] failed after step "${(globalThis as { lastStep?: string }).lastStep ?? '?'}":`, error)
      console.error('[smoke] server stderr:\n' + await readFile(stderrLog, 'utf8').catch(() => '<unreadable>'))
      throw error
    } finally {
      await rm(home, { recursive: true, force: true })
      await rm(workspace, { recursive: true, force: true })
    }
  }, 120_000)
})
