/**
 * `sha256File`: node:crypto only, streamed, and never a bare reason.
 *
 * Measured defect this pins (alpha52, Windows host, B3): the implementation
 * shelled out to `shasum -a 256`, which does not exist on Windows. Every fresh
 * remote therefore died at the node component with
 * `cannot hash C:\…\node-v24.21.0-linux-arm64.tar.gz:` — an empty reason — and
 * left an unmarked 57 MB tarball in the cache. The upload path was unusable from
 * a Windows host for *every* architecture.
 *
 * `node:child_process` is mocked in this file: if hashing ever reaches for an
 * external command again, these tests fail loudly instead of depending on which
 * POSIX tools happen to be installed.
 */
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  execFile: () => {
    throw new Error('hashing spawned an external process')
  },
}))

const { sha256File } = await import('../src/provision/assets.ts')

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-sha256-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

describe('sha256File', () => {
  it('hashes a real file through crypto, with a non-ASCII file name', async () => {
    // 3 MiB: larger than one read chunk, so the streaming path is exercised.
    const bytes = Buffer.alloc(3 * 1024 * 1024 + 7)
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251
    const path = join(dir, '节点-パッケージ.bin')
    await writeFile(path, bytes)

    const expected = createHash('sha256').update(bytes).digest('hex')
    await expect(sha256File(path)).resolves.toBe(expected)
  })

  it('hashes an empty file to the well-known digest', async () => {
    const path = join(dir, 'empty.bin')
    await writeFile(path, '')
    await expect(sha256File(path)).resolves.toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('names a reason for a missing file instead of leaving the message empty', async () => {
    const path = join(dir, 'nope.bin')
    const failure = await sha256File(path).then(() => undefined, (error: unknown) => error as Error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure?.message).toMatch(/^cannot hash .+nope\.bin: \S/u)
    // The alpha52 message ended in `: ` with nothing after it.
    expect(failure?.message.replace(/^cannot hash .*?: /u, '')).not.toBe('')
    expect(failure?.message).toContain('ENOENT')
  })

  it('proves the external-command path is gone (the mock would throw)', async () => {
    const { execFile } = await import('node:child_process')
    expect(() => execFile('shasum', ['-a', '256', 'x'])).toThrow(/spawned an external process/)
  })
})
