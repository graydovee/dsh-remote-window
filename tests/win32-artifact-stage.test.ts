/**
 * win32 runtime artifact staging: the target-specific halves of
 * `package-build.ts` / `runtime-artifact.ts` / `assets.ts`.
 *
 * The win32 artifact is built on the *client* host, so these tests pin the
 * pieces that differ from POSIX without a registry, a real pnpm, a multi-MB
 * Node download or a real `tar`: the archive extractor is injected and the
 * staged trees are plain directories.
 *
 * Covered contracts:
 *
 * 1. the staging `.npmrc` targets `os=win32`/`cpu=<arch>` and emits no libc
 *    line (win32 has no gnu/musl split), with the POSIX lines unchanged;
 * 2. `node-addon-require-builtin`'s win32 sibling is `win32-<arch>-msvc`
 *    (verified registry naming), and a win32 tree is valid **without** the
 *    `node-addon-system` sibling that package never published for win32;
 * 3. a win32 tree missing the msvc sibling is rejected, and POSIX keeps
 *    requiring the system sibling;
 * 4. foreign require-builtin flavours are stripped while the win32 one stays;
 * 5. the artifact name is `dsh-runtime-<v>-win32-<arch>.tar.gz`;
 * 6. the Windows Node zip is extracted with `tar -xf` and must contain
 *    `node.exe`, while POSIX keeps `tar -xzf` + `bin/node` byte-for-byte;
 * 7. a `.bin/dsh.cmd` launcher is synthesized when the staging host is not
 *    Windows (pnpm only writes `.cmd` shims on Windows hosts).
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertTargetOnly,
  bindingPackageSuffix,
  ensureWindowsLauncherShim,
  isForeignBindingDir,
  stageNpmrcLines,
  stageWorkspaceLines,
  systemAddonSupported,
  windowsCmdShim,
} from '../src/provision/package-build.ts'
import { extractNode, type ExtractRunner } from '../src/provision/runtime-artifact.ts'
import { runtimeArtifactName } from '../src/provision/runtime.ts'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-win32-stage-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

/** Create a fake staged `.pnpm` virtual store from directory names. */
async function pnpmStore(entries: readonly string[]): Promise<string> {
  const stage = join(dir, 'dsh')
  const store = join(stage, 'node_modules', '.pnpm')
  for (const entry of entries) await mkdir(join(store, entry), { recursive: true })
  return stage
}

/**
 * A scripted extraction runner: it "extracts" one top-level directory holding
 * `file` and records the exact arguments it was called with.
 */
async function fakeArchive(top: string, file: readonly string[]): Promise<{ extract: ExtractRunner; calls: string[][] }> {
  const calls: string[][] = []
  const extract: ExtractRunner = async (command, args) => {
    calls.push([command, ...args])
    const unpack = args[args.indexOf('-C') + 1] as string
    const target = join(unpack, top, ...file)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, 'binary')
  }
  return { extract, calls }
}

describe('win32 runtime artifact staging', () => {
  it('targets os=win32/cpu=<arch> in the staging .npmrc and never writes a libc line', () => {
    expect(stageNpmrcLines({ platform: 'win32', arch: 'x64', libc: '' })).toEqual([
      'supported-architectures[]=os=win32',
      'supported-architectures[]=cpu=x64',
    ])
    // The hoisted linker comes from `pnpm-workspace.yaml` (pnpm 10 ignores the
    // `.npmrc` key); POSIX writes no workspace file at all.
    expect(stageWorkspaceLines('win32')).toEqual(['nodeLinker: hoisted'])
    expect(stageWorkspaceLines('linux')).toEqual([])
    // A caller that passes the linux default by mistake must not emit libc for win32.
    expect(stageNpmrcLines({ platform: 'win32', arch: 'arm64', libc: 'gnu' })).toEqual([
      'supported-architectures[]=os=win32',
      'supported-architectures[]=cpu=arm64',
    ])
    // POSIX output is byte-identical to the previous inline list.
    expect(stageNpmrcLines({ platform: 'linux', arch: 'x64', libc: 'gnu' })).toEqual([
      'supported-architectures[]=os=linux',
      'supported-architectures[]=cpu=x64',
      'supported-architectures[]=libc=gnu',
    ])
    expect(stageNpmrcLines({ platform: 'darwin', arch: 'arm64', libc: '' })).toEqual([
      'supported-architectures[]=os=darwin',
      'supported-architectures[]=cpu=arm64',
    ])
  })

  it('resolves the win32 binding suffix to the published msvc sibling names', () => {
    expect(bindingPackageSuffix('win32', 'x64', '')).toBe('win32-x64-msvc')
    expect(bindingPackageSuffix('win32', 'arm64', '')).toBe('win32-arm64-msvc')
    // POSIX suffixes are unchanged.
    expect(bindingPackageSuffix('linux', 'x64', 'gnu')).toBe('linux-x64-gnu')
    expect(bindingPackageSuffix('linux', 'x64', 'musl')).toBe('linux-x64-musl')
    expect(bindingPackageSuffix('darwin', 'arm64', '')).toBe('darwin-arm64')
  })

  it('does not expect a node-addon-system sibling where upstream publishes none', () => {
    // @deepseek-ai/node-addon-system@0.1.2 publishes darwin/linux only; DSH
    // fails closed with ERR_FLOCK_UNSUPPORTED_PLATFORM and probes instead.
    expect(systemAddonSupported('win32')).toBe(false)
    expect(systemAddonSupported('darwin')).toBe(true)
    expect(systemAddonSupported('linux')).toBe(true)
  })

  it('accepts a win32 tree with the msvc require-builtin sibling and no system sibling', async () => {
    const stage = await pnpmStore([
      'node-addon-require-builtin@0.1.9',
      'node-addon-require-builtin-win32-x64-msvc@0.1.9',
      '@deepseek-ai+node-addon-system@0.1.2',
      '@deepseek-ai+dsh@0.2.1-rc.3',
    ])
    await expect(assertTargetOnly(stage, 'win32', 'x64', '')).resolves.toBeUndefined()
  })

  it('rejects a win32 tree without the msvc require-builtin sibling', async () => {
    // No foreign sibling here on purpose: the failure under test is the missing
    // target binding, not the foreign-binding sweep.
    const stage = await pnpmStore([
      'node-addon-require-builtin@0.1.9',
      '@deepseek-ai+node-addon-system@0.1.2',
      '@deepseek-ai+dsh@0.2.1-rc.3',
    ])
    await expect(assertTargetOnly(stage, 'win32', 'x64', '')).rejects.toThrow(
      /missing the native binding node-addon-require-builtin-win32-x64-msvc/,
    )
  })

  it('still requires the node-addon-system sibling on POSIX targets', async () => {
    const stage = await pnpmStore([
      'node-addon-require-builtin@0.1.9',
      'node-addon-require-builtin-linux-x64-gnu@0.1.9',
      '@deepseek-ai+node-addon-system@0.1.2',
    ])
    await expect(assertTargetOnly(stage, 'linux', 'x64', 'gnu')).rejects.toThrow(
      /missing the native binding @deepseek-ai\/node-addon-system-linux-x64/,
    )
  })

  it('rejects a win32 tree that still contains foreign native bindings', async () => {
    const stage = await pnpmStore([
      'node-addon-require-builtin-win32-x64-msvc@0.1.9',
      'node-addon-require-builtin-linux-x64-gnu@0.1.9',
    ])
    await expect(assertTargetOnly(stage, 'win32', 'x64', '')).rejects.toThrow(/foreign native bindings for win32-x64/)
  })

  it('strips foreign require-builtin flavours but keeps the win32-x64-msvc binding', () => {
    expect(isForeignBindingDir('node-addon-require-builtin-darwin-arm64@0.1.9', 'win32-x64-msvc')).toBe(true)
    expect(isForeignBindingDir('node-addon-require-builtin-linux-x64-gnu@0.1.9', 'win32-x64-msvc')).toBe(true)
    expect(isForeignBindingDir('node-addon-require-builtin-win32-ia32-msvc@0.1.9', 'win32-x64-msvc')).toBe(true)
    expect(isForeignBindingDir('node-addon-require-builtin-win32-x64-msvc@0.1.9', 'win32-x64-msvc')).toBe(false)
    // The unsuffixed main package is not a platform sibling and must survive.
    expect(isForeignBindingDir('node-addon-require-builtin@0.1.9', 'win32-x64-msvc')).toBe(false)
  })

  it('names the win32 runtime artifact dsh-runtime-<v>-win32-<arch>.tar.gz', () => {
    expect(runtimeArtifactName('0.2.1-rc.3', 'win32-x64')).toBe('dsh-runtime-0.2.1-rc.3-win32-x64.tar.gz')
    expect(runtimeArtifactName('0.2.1-rc.3', 'win32-arm64')).toBe('dsh-runtime-0.2.1-rc.3-win32-arm64.tar.gz')
  })

  it('extracts the Windows zip with tar -xf and requires node/node.exe', async () => {
    const work = join(dir, 'work')
    const archive = '/downloads/node-v24.21.0-win-x64.zip'
    const { extract, calls } = await fakeArchive('node-v24.21.0-win-x64', ['node.exe'])

    const nodeDir = await extractNode(archive, work, 'win32', () => {}, extract)

    expect(nodeDir).toBe(join(work, 'node'))
    expect(await stat(join(nodeDir, 'node.exe')).then(entry => entry.isFile())).toBe(true)
    expect(calls).toEqual([['tar', '-xf', resolve(archive), '-C', join(work, 'node-unpack')]])
  })

  it('rejects a win32 archive whose tree has bin/node instead of node.exe', async () => {
    const work = join(dir, 'work')
    // A POSIX-shaped tree staged as win32: bin/node must not satisfy the layout.
    const { extract } = await fakeArchive('node-v24.21.0-win-x64', ['bin', 'node'])
    await expect(extractNode('/downloads/node-v24.21.0-win-x64.zip', work, 'win32', () => {}, extract)).rejects.toThrow(
      'the Node archive has no node.exe',
    )
  })

  it('keeps the POSIX extraction byte-identical (tar -xzf + bin/node)', async () => {
    const work = join(dir, 'work')
    const archive = '/downloads/node-v24.21.0-darwin-arm64.tar.gz'
    const { extract, calls } = await fakeArchive('node-v24.21.0-darwin-arm64', ['bin', 'node'])

    const nodeDir = await extractNode(archive, work, 'darwin', () => {}, extract)

    expect(nodeDir).toBe(join(work, 'node'))
    expect(await stat(join(nodeDir, 'bin', 'node')).then(entry => entry.isFile())).toBe(true)
    expect(calls).toEqual([['tar', '-xzf', resolve(archive), '-C', join(work, 'node-unpack')]])
  })

  it('keeps the POSIX "no bin/node" failure message', async () => {
    const work = join(dir, 'work')
    const { extract } = await fakeArchive('node-v24.21.0-darwin-arm64', ['node.exe'])
    await expect(extractNode('/downloads/node-v24.21.0-darwin-arm64.tar.gz', work, 'darwin', () => {}, extract)).rejects.toThrow(
      'the Node archive has no bin/node',
    )
  })

  it('synthesizes a dsh.cmd launcher when pnpm only produced the POSIX shim', async () => {
    const stage = join(dir, 'dsh')
    const launcher = join(stage, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    await mkdir(dirname(launcher), { recursive: true })
    await writeFile(launcher, '')
    await mkdir(join(stage, 'node_modules', '.bin'), { recursive: true })
    await writeFile(join(stage, 'node_modules', '.bin', 'dsh'), '#!/bin/sh\n')

    await ensureWindowsLauncherShim(stage, launcher)

    const shim = await readFile(join(stage, 'node_modules', '.bin', 'dsh.cmd'), 'utf8')
    expect(shim).toBe(windowsCmdShim('..\\@deepseek-ai\\dsh\\lib\\bin.js'))
    expect(shim).toContain('%~dp0..\\..\\..\\node\\node.exe')
    expect(shim).toContain('%~dp0..\\@deepseek-ai\\dsh\\lib\\bin.js')
    expect(shim).toContain('%*')
    expect(shim.split('\r\n').length).toBeGreaterThan(4)
    // The POSIX shim and its content are untouched.
    expect(await readFile(join(stage, 'node_modules', '.bin', 'dsh'), 'utf8')).toBe('#!/bin/sh\n')
  })

  it('resolves the .cmd shim entry from the installed manifest bin', async () => {
    const stage = join(dir, 'dsh')
    const pkg = join(stage, 'node_modules', '@deepseek-ai', 'dsh')
    await mkdir(join(pkg, 'dist'), { recursive: true })
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', bin: { dsh: 'dist/main.js' } }))
    await writeFile(join(pkg, 'dist', 'main.js'), '')

    // The caller's launcher may be stale; the manifest bin is authoritative.
    await ensureWindowsLauncherShim(stage, join(pkg, 'lib', 'bin.js'))

    const shim = await readFile(join(stage, 'node_modules', '.bin', 'dsh.cmd'), 'utf8')
    expect(shim).toBe(windowsCmdShim('..\\@deepseek-ai\\dsh\\dist\\main.js'))
    expect(shim).toContain('node')
    expect(shim).toContain('%~dp0..\\@deepseek-ai\\dsh\\dist\\main.js')
  })

  it('falls back to the verified launcher when the manifest is unreadable', async () => {
    const stage = join(dir, 'dsh')
    const launcher = join(stage, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    await mkdir(dirname(launcher), { recursive: true })
    await writeFile(launcher, '')

    await ensureWindowsLauncherShim(stage, launcher)

    const shim = await readFile(join(stage, 'node_modules', '.bin', 'dsh.cmd'), 'utf8')
    expect(shim).toBe(windowsCmdShim('..\\@deepseek-ai\\dsh\\lib\\bin.js'))
    expect(shim).toContain('node')
    expect(shim).toContain('%~dp0..\\@deepseek-ai\\dsh\\lib\\bin.js')
  })

  it('leaves a real pnpm .cmd shim untouched', async () => {
    const stage = join(dir, 'dsh')
    const launcher = join(stage, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    await mkdir(dirname(launcher), { recursive: true })
    await writeFile(launcher, '')
    const cmd = join(stage, 'node_modules', '.bin', 'dsh.cmd')
    await mkdir(dirname(cmd), { recursive: true })
    await writeFile(cmd, '@ECHO off\r\nfrom-pnpm\r\n')

    await ensureWindowsLauncherShim(stage, launcher)

    expect(await readFile(cmd, 'utf8')).toBe('@ECHO off\r\nfrom-pnpm\r\n')
  })
})

describe('assertTargetOnly on the hoisted layout', () => {
  const make = async (names: string[]): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-hoisted-'))
    const modules = join(root, 'node_modules')
    for (const name of names) {
      const path = name.startsWith('@')
        ? join(modules, name)
        : join(modules, name)
      await mkdir(path, { recursive: true })
    }
    return root
  }

  it('accepts a win32 hoisted tree and requires the msvc binding', async () => {
    const ok = await make(['node-addon-require-builtin-win32-x64-msvc'])
    await expect(assertTargetOnly(ok, 'win32', 'x64', '')).resolves.toBeUndefined()
    const missing = await make([])
    await expect(assertTargetOnly(missing, 'win32', 'x64', '')).rejects.toThrow(/node-addon-require-builtin-win32-x64-msvc/u)
  })

  it('rejects a foreign binding in a hoisted tree', async () => {
    const foreign = await make(['node-addon-require-builtin-win32-x64-msvc', 'node-addon-require-builtin-darwin-arm64'])
    await expect(assertTargetOnly(foreign, 'win32', 'x64', '')).rejects.toThrow(/foreign native bindings/u)
  })
})
