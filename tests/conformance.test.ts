/**
 * Protocol conformance: the official SSH providers against this plugin's server.
 *
 * This is the load-bearing test of the whole design. It mounts the *real*
 * official client providers (`dsh-fs-ssh`, `dsh-subprocess-ssh`,
 * `dsh-sandbox-ssh`) in one context and this plugin's `ctx.ssh` implementation in
 * another, connects them over an in-memory transport, and asserts the official
 * method set behaves exactly as it does against the official helper: fs
 * identities and version guards, process stdio and exit facts, output collection
 * snapshots, executable resolution and sandbox confinement.
 *
 * The "remote" host is a second context on the same machine, built from the same
 * provider rows the generated remote profile mounts, so a failure here means the
 * remote world would fail the same way.
 */
import { PassThrough } from 'node:stream'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalSandboxProvider from '@deepseek-ai/dsh-sandbox-local'
import SshFileSystem from '@deepseek-ai/dsh-fs-ssh'
import SshSubprocessRuntime from '@deepseek-ai/dsh-subprocess-ssh'
import SshSandboxProvider from '@deepseek-ai/dsh-sandbox-ssh'
import type { FsError, FsTarget } from '@deepseek-ai/dsh-fs'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { RemoteExecutionServer } from '../src/server/controller.ts'
import RemoteConnection from '../src/connection/index.ts'
import type { RemoteChannel, RemoteWorkspaceService } from '../src/targets/types.ts'

/** One connected pair of contexts plus its temporary workspace. */
interface Fixture {
  readonly client: Context
  readonly server: Context
  readonly workspace: string
  dispose(): Promise<void>
}

const fixtures: Fixture[] = []

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop() as Fixture
    await fixture.dispose()
  }
})

/** Mount the execution providers a generated remote profile mounts. */
async function mountServerProviders(ctx: Context, workspace: string, mode: 'read-only' | 'workspace-write'): Promise<void> {
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SandboxPolicyService, { mode, workspaceRoot: workspace })
  await ctx.plugin(SandboxedFileSystem, { cwd: workspace })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalSandboxProvider)
}

/** Mount the official client providers plus this plugin's connection. */
async function mountClientProviders(
  ctx: Context,
  channel: RemoteChannel,
  expectedDigest: () => Promise<string | undefined>,
  mode: 'read-only' | 'workspace-write' = 'workspace-write',
): Promise<void> {
  const service: RemoteWorkspaceService = {
    connectChannel: async () => channel,
    expectedDigest: async () => await expectedDigest(),
    getPackagePolicy: () => ({ policy: 'auto', mirror: '' }),
    setPackagePolicy: async () => {},
    pathAliases: () => [],
    routeForCwd: () => undefined,
    locateRemoteSession: async () => undefined,
    sessionRequest: async () => { throw new Error('not used in conformance') },
  }
  ctx.provide('remoteWorkspaces', service)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SandboxPolicyService, { mode, workspaceRoot: process.cwd() })
  await ctx.plugin(RemoteConnection, { targetId: 'rt-fixture' })
  await ctx.plugin(SshFileSystem)
  await ctx.plugin(SshSubprocessRuntime)
  await ctx.plugin(SshSandboxProvider)
}

/** Build a connected fixture: a real remote server on one side, official providers on the other. */
async function fixture(options: { mode?: 'read-only' | 'workspace-write'; expectedDigest?: () => Promise<string | undefined> } = {}): Promise<Fixture> {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-remote-fixture-'))
  const server = new Context()
  await mountServerProviders(server, workspace, options.mode ?? 'workspace-write')
  // The channel: client writes into `toServer`, the server writes into `toClient`.
  const toServer = new PassThrough()
  const toClient = new PassThrough()
  const running = new RemoteExecutionServer({
    ctx: server,
    input: toServer,
    output: toClient,
    workspace,
    leaseMs: 30_000,
  })
  await running.ready
  const channel: RemoteChannel = {
    input: toClient,
    output: toServer,
    close: async () => { await running.dispose() },
  }
  const client = new Context()
  await mountClientProviders(client, channel, options.expectedDigest ?? (async () => undefined), options.mode ?? 'workspace-write')
  const created: Fixture = {
    client,
    server,
    workspace,
    dispose: async () => {
      await client.fiber.dispose().catch(() => {})
      await server.fiber.dispose().catch(() => {})
      await running.dispose().catch(() => {})
      await rm(workspace, { recursive: true, force: true })
    },
  }
  fixtures.push(created)
  return created
}

/** Read a handle's stream to completion. */
async function readAll(stream: NodeJS.ReadableStream | undefined): Promise<string> {
  if (stream === undefined) return ''
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks).toString('utf8')
}

describe('official providers against the remote workspace server', () => {
  it('resolves, lists, reads and writes through ctx.fs', async () => {
    const { client, workspace } = await fixture()
    await mkdir(join(workspace, 'nested'), { recursive: true })
    await writeFile(join(workspace, 'hello.txt'), 'hello world\n')
    await writeFile(join(workspace, 'nested', 'deep.txt'), 'deep\n')

    const canonical = await realpath(workspace)
    const file = await client.fs.resolve(join(workspace, 'hello.txt'))
    // The remote provider canonicalizes through realpath; on macOS the temporary
    // directory lives behind the `/var` → `/private/var` symlink.
    expect(client.fs.processPath(file)).toBe(join(canonical, 'hello.txt'))
    expect(await client.fs.readText(file)).toBe('hello world\n')

    const directory = await client.fs.resolve(workspace)
    const entries = await client.fs.listDir(directory)
    expect(entries.map(entry => entry.name).sort()).toEqual(['hello.txt', 'nested'])
    expect(entries.find(entry => entry.name === 'nested')?.type).toBe('directory')

    const info = await client.fs.stat(file)
    expect(info?.type).toBe('file')
    expect(info?.size).toBe(12)
    expect((await client.fs.lstat(join(workspace, 'missing.txt')))?.type).toBeUndefined()
  })

  it('creates, edits and refuses a stale version through the remote provider', async () => {
    const { client, workspace } = await fixture()
    const target = await client.fs.resolve(join(workspace, 'created.txt'))

    const created = await client.fs.writeText(target, 'first\n', { kind: 'createIfAbsent' })
    expect(created.operation).toBe('create')
    expect(created.before).toBeNull()

    const edited = await client.fs.editText(target, { oldString: 'first', newString: 'second', replaceAll: false })
    expect(edited.after).toBe('second\n')
    expect(await client.fs.readText(target)).toBe('second\n')

    const stale = await client.fs
      .writeText(target, 'third\n', { kind: 'replaceIfVersion', version: created.version })
      .catch((error: unknown) => error as FsError)
    expect(stale).toBeInstanceOf(Error)
    expect((stale as FsError).code).toBe('FS_STALE_VERSION')

    const missingEdit = await client.fs
      .editText(target, { oldString: 'absent', newString: 'x', replaceAll: false })
      .catch((error: unknown) => error as FsError)
    expect((missingEdit as FsError).code).toBe('FS_EDIT_NOT_FOUND')
  })

  it('reads bytes and byte ranges, and enforces the remote size ceiling', async () => {
    const { client, workspace } = await fixture()
    const payload = Buffer.from('0123456789abcdef')
    await writeFile(join(workspace, 'bytes.bin'), payload)
    const target = await client.fs.resolve(join(workspace, 'bytes.bin'))

    expect(Buffer.from(await client.fs.readBytes(target, undefined, 1024)).toString()).toBe(payload.toString())
    expect(Buffer.from(await client.fs.readByteRange(target, { offset: 4, length: 6 })).toString()).toBe('456789')

    const tooLarge = await client.fs.readBytes(target, undefined, 4).catch((error: unknown) => error as FsError)
    expect((tooLarge as FsError).code).toBe('FS_TOO_LARGE')
  })

  it('streams text through the iterator methods', async () => {
    const { client, workspace } = await fixture()
    await writeFile(join(workspace, 'lines.txt'), 'one\ntwo\nthree\n')
    const target = await client.fs.resolve(join(workspace, 'lines.txt'))
    const chunks: string[] = []
    for await (const chunk of await client.fs.streamText(target)) chunks.push(chunk)
    expect(chunks.join('')).toBe('one\ntwo\nthree\n')
  })

  it('denies writes outside the workspace and under read-only mode', async () => {
    const { client, workspace } = await fixture({ mode: 'read-only' })
    const inside = await client.fs.resolve(join(workspace, 'denied.txt'))
    const denied = await client.fs.writeText(inside, 'nope\n', { kind: 'createIfAbsent' }).catch((error: unknown) => error as FsError)
    expect((denied as FsError).code).toBe('FS_SANDBOX_DENIED')

    const outside = await fixture()
    const escaped = await outside.client.fs.resolve(join(homedir(), 'dsh-remote-workspace-denied.txt'))
    const refused = await outside.client.fs
      .writeText(escaped, 'nope\n', { kind: 'createIfAbsent' })
      .catch((error: unknown) => error as FsError)
    expect((refused as FsError).code).toBe('FS_SANDBOX_DENIED')
  })

  it('runs a process with separated stdio and reports its exit facts', async () => {
    const { client, workspace } = await fixture()
    const handle: SubprocessHandle = client.subprocess.spawn({
      argv: ['/bin/sh', '-c', 'printf out; printf err 1>&2; exit 3'],
      cwd: workspace,
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: 5_000,
    })
    // Read the streams *while* awaiting done, exactly like the official bash
    // tool: an unread PassThrough never ends, and `drainOutput` would then wait
    // out the whole grace period instead of returning as soon as the remote does.
    const outcome = await Promise.all([
      readAll(handle.stdout),
      readAll(handle.stderr),
      handle.done.catch((error: unknown) => {
        throw new Error(`remote process failed: ${error instanceof Error ? error.message : String(error)}`)
      }),
    ]).then(([stdout, stderr, outcome]) => ({ stdout, stderr, outcome }))
    expect(outcome.stdout).toBe('out')
    expect(outcome.stderr).toBe('err')
    expect(outcome.outcome.exitCode).toBe(3)
    expect(outcome.outcome.signal).toBeNull()
  })

  it('feeds stdin to a remote process', async () => {
    const { client, workspace } = await fixture()
    const handle = client.subprocess.spawn({
      argv: ['/bin/cat'],
      cwd: workspace,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: 5_000,
    })
    const collected = readAll(handle.stdout)
    const ignored = readAll(handle.stderr)
    handle.stdin?.end('piped-through\n')
    expect(await collected).toBe('piped-through\n')
    expect(await ignored).toBe('')
    expect((await handle.done).exitCode).toBe(0)
  })

  it('pushes collected output snapshots before the process exits', async () => {
    const { client, workspace } = await fixture()
    const handle = client.subprocess.spawn({
      argv: ['/bin/sh', '-c', 'printf first; sleep 0.6; printf second'],
      cwd: workspace,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
      graceMs: 5_000,
    })
    const reader = handle.collected.stdout
    expect(reader).toBeDefined()
    // The intermediate snapshot must arrive while the process is still running.
    const deadline = Date.now() + 5_000
    let live = ''
    while (Date.now() < deadline) {
      live = reader?.readFrom(0).text ?? ''
      if (live.includes('first')) break
      await new Promise((resolve) => { setTimeout(resolve, 20) })
    }
    expect(live).toContain('first')
    await handle.done
    expect(reader?.readFrom(0).text).toBe('firstsecond')
  })

  it('resolves executables and confines argv on the remote host', async () => {
    const { client, workspace } = await fixture()
    const resolved = await client.subprocess.resolveExecutable('sh', undefined)
    expect(resolved.startsWith('/')).toBe(true)

    const policy = { mode: 'workspace-write', workspaceRoot: workspace } as SandboxPolicy
    const confined = await client.sandbox.confine(['/bin/echo', 'hello'], policy)
    expect(confined.argv).toContain('/bin/echo')
    expect(['full', 'partial']).toContain(confined.enforcement)
    expect(Array.isArray(confined.denialSignatures)).toBe(true)

    const unconfined = await client.sandbox
      .confine(['/bin/echo', 'hello'], { mode: 'danger-full-access', workspaceRoot: workspace } as unknown as SandboxPolicy)
      .catch((error: unknown) => error as Error)
    expect(unconfined).toBeInstanceOf(Error)
  })

  it('reports the terminal environment and survives a missing pty provider', async () => {
    const { client, workspace } = await fixture()
    const environment = await client.subprocess.terminalEnvironment()
    expect(environment.platform).toBe('posix')
    // node-pty is optional; when it is absent the remote must say so clearly
    // instead of hanging or reporting a false success.
    const attempt = await client.subprocess
      .spawnTerminal({
        argv: ['/bin/sh'],
        cwd: workspace,
        rows: 24,
        cols: 80,
        terminalType: 'xterm-256color',
        graceMs: 3_000,
      })
      .then(handle => ({ ok: true as const, handle }))
      .catch((error: unknown) => ({ ok: false as const, error: error as Error }))
    if (attempt.ok) {
      await attempt.handle.terminate()
    } else {
      expect(attempt.error.message.length).toBeGreaterThan(0)
    }
  })

  it('rejects a server whose digest differs from the installed plugin', async () => {
    const { client } = await fixture({ expectedDigest: async () => 'f'.repeat(64) })
    const failure = await client.ssh
      .request('fs.resolve', { path: '/' }, (await import('zod')).z.unknown())
      .catch((error: unknown) => error as Error)
    expect((failure as Error).message).toMatch(/digest/)
  })

  it('keeps the local session isolated: the client context sees only the remote filesystem', async () => {
    const { client, workspace } = await fixture()
    await writeFile(join(workspace, 'remote-only.txt'), 'remote\n')
    const listing = await client.fs.listDir(await client.fs.resolve(workspace))
    expect(listing.some(entry => entry.name === 'remote-only.txt')).toBe(true)
    // The plugin's own working directory is a different directory entirely.
    const here = await client.fs.resolve(process.cwd())
    const hereEntries = await client.fs.listDir(here)
    expect(hereEntries.some(entry => entry.name === 'remote-only.txt')).toBe(false)
  })
})

/** The fixture's channel type must stay assignable to what the connection expects. */
const _channelTypeCheck: (channel: RemoteChannel) => FsTarget | undefined = channel => {
  void channel
  return undefined
}
void _channelTypeCheck
