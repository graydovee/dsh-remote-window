/**
 * `packStage`: the archive is published by rename, never written in place.
 *
 * Measured defect this pins (alpha51, Windows host, `linux-arm64-gnu`): the
 * 300 s `execFile` timeout killed tar mid-write, and because tar wrote straight
 * to the final name the directory kept a 135,659,520-byte `.tar.gz` that looked
 * like a build artifact (`tar -tzf` → `Truncated input file`), with empty stderr
 * and no `.sha256`/`.manifest.json`. So these tests assert:
 *
 * 1. success publishes `<name>` from a `.partial` and leaves no partial behind;
 * 2. failure leaves **nothing** behind under either name;
 * 3. failure after a previous good artifact keeps that artifact intact;
 * 4. the failure message names the cause (signal / budget) instead of a bare
 *    empty stderr;
 * 5. the pack budget is the measured one (≥ 900 s);
 * 6. two concurrent packs of the same artifact use different partial paths, so
 *    neither can delete the other's in-progress archive.
 *
 * Hermetic: the `tar` invocation is injected (`TarRunner`), so no test spawns a
 * real tar, waits out a timeout, or depends on the platform's tar flavour.
 */
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PACK_TIMEOUT_MS, packStage, type TarRunResult, type TarRunner } from '../src/provision/package-build.ts'

let dir = ''
let stage = ''
let outFile = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-pack-stage-'))
  stage = join(dir, 'stage')
  outFile = join(dir, 'dsh-remote-server-0.2.1-rc.3-linux-arm64-gnu.tar.gz')
  await writeFile(join(dir, 'keep.txt'), 'x')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

/** Every half-written archive currently in the output directory. */
async function partials(): Promise<string[]> {
  return (await readdir(dir).catch(() => [])).filter(name => name.endsWith('.partial'))
}

/** Whether a path exists. */
async function exists(path: string): Promise<boolean> {
  return await stat(path).then(() => true, () => false)
}

/** The archive path tar was pointed at (`-czf <path>`). */
function archiveArg(args: readonly string[]): string {
  return args[args.indexOf('-czf') + 1] as string
}

/** A runner that records its options and answers with a scripted outcome. */
function scripted(outcome: (args: readonly string[]) => Promise<TarRunResult>): {
  runner: TarRunner
  calls: { executable: string; args: readonly string[]; timeoutMs: number; env: NodeJS.ProcessEnv }[]
} {
  const calls: { executable: string; args: readonly string[]; timeoutMs: number; env: NodeJS.ProcessEnv }[] = []
  const runner: TarRunner = async options => {
    calls.push({ executable: options.executable, args: options.args, timeoutMs: options.timeoutMs, env: options.env })
    return await outcome(options.args)
  }
  return { runner, calls }
}

describe('packStage', () => {
  it('packs into a partial and publishes it by rename', async () => {
    const { runner, calls } = scripted(async args => {
      await writeFile(archiveArg(args), 'archive-bytes')
      return { code: 0, signal: null, stderr: '' }
    })
    await packStage(stage, outFile, runner)

    expect(await readFile(outFile, 'utf8')).toBe('archive-bytes')
    expect(await partials()).toEqual([])
    // tar was pointed at a partial of the final name, with the staged tree as cwd.
    expect(calls[0]?.args).toEqual(['-czf', archiveArg(calls[0]?.args ?? []), '-C', stage, '.'])
    expect(archiveArg(calls[0]?.args ?? [])).toMatch(/linux-arm64-gnu\.tar\.gz\.\d+-[0-9a-f]{8}\.partial$/)
    // AppleDouble suppression survives the rewrite.
    expect(calls[0]?.env.COPYFILE_DISABLE).toBe('1')
  })

  it('uses the measured pack budget (the 300 s cap truncated a real archive)', async () => {
    const { runner, calls } = scripted(async args => {
      await writeFile(archiveArg(args), 'archive')
      return { code: 0, signal: null, stderr: '' }
    })
    await packStage(stage, outFile, runner)
    expect(calls[0]?.timeoutMs).toBe(PACK_TIMEOUT_MS)
    expect(PACK_TIMEOUT_MS).toBeGreaterThanOrEqual(900_000)
  })

  it('leaves nothing behind when tar exits non-zero', async () => {
    const { runner } = scripted(async args => {
      // Bytes written before the failure must not survive anywhere.
      await writeFile(archiveArg(args), 'half')
      return { code: 3, signal: null, stderr: '  disk full\n' }
    })
    await expect(packStage(stage, outFile, runner)).rejects.toThrow(/tar failed \(exit 3;[^)]*\): disk full/)
    expect(await exists(outFile)).toBe(false)
    expect(await partials()).toEqual([])
  })

  it('names the signal when tar was killed (the alpha51 shape: code null, empty stderr)', async () => {
    const { runner } = scripted(async args => {
      await writeFile(archiveArg(args), 'truncated-gzip')
      return { code: null, signal: 'SIGTERM', stderr: '' }
    })
    const failure = await packStage(stage, outFile, runner).then(() => undefined, (error: unknown) => error as Error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure?.message).toContain('signal SIGTERM')
    expect(failure?.message).toContain(`${PACK_TIMEOUT_MS} ms`)
    expect(failure?.message).toContain('no stderr output')
    expect(await exists(outFile)).toBe(false)
    expect(await partials()).toEqual([])
  })

  it('keeps a previous good artifact when a re-pack fails', async () => {
    await writeFile(outFile, 'previous-good-archive')
    const { runner } = scripted(async () => ({ code: 2, signal: null, stderr: 'boom' }))
    await expect(packStage(stage, outFile, runner)).rejects.toThrow(/tar failed/)
    expect(await readFile(outFile, 'utf8')).toBe('previous-good-archive')
    expect(await partials()).toEqual([])
  })

  it('gives concurrent packs of the same artifact distinct partials', async () => {
    // `assets.resolveServerPackage` can be reached by two connects at once; with a
    // single fixed `.partial` name each run's cleanup would delete the other's
    // archive mid-write.
    await writeFile(outFile, 'previous-good-archive')
    const targets: string[] = []
    const { runner } = scripted(async args => {
      const target = archiveArg(args)
      targets.push(target)
      // Hold the "archive" open while the second run starts.
      if (targets.length === 1) await new Promise(resolveWait => setTimeout(resolveWait, 20))
      await writeFile(target, `bytes-${targets.length}`)
      return { code: 0, signal: null, stderr: '' }
    })
    await Promise.all([packStage(stage, outFile, runner), packStage(stage, outFile, runner)])
    expect(new Set(targets).size).toBe(2)
    // Both runs succeeded, so whichever renamed last published a complete archive.
    expect(await readFile(outFile, 'utf8')).toMatch(/^bytes-/)
    expect(await partials()).toEqual([])
  })

  it('propagates a runner rejection and still removes its partial', async () => {
    const { runner } = scripted(async args => {
      await writeFile(archiveArg(args), 'half')
      throw new Error('cannot spawn tar')
    })
    await expect(packStage(stage, outFile, runner)).rejects.toThrow('cannot spawn tar')
    expect(await partials()).toEqual([])
    expect(await exists(outFile)).toBe(false)
  })
})
