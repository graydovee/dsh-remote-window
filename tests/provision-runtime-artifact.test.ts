/**
 * Local runtime-artifact fallback: a pre-existing platform artifact must be
 * reused without downloading Node or invoking the host pnpm.
 *
 * The build path itself is integration-sized (downloads Node, stages the dsh
 * package, tars ~178 MB), so this unit test pins the cache contract the connect
 * path relies on.
 */
import { mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sha256File } from '../src/provision/assets.ts'
import { buildRuntimeArtifact } from '../src/provision/runtime-artifact.ts'
import { runtimeArtifactName } from '../src/provision/runtime.ts'

const VERSION = '0.2.1-rc.3'

describe('automatic isolated runtime artifact', () => {
  it('reuses a cached platform artifact before trying to build one', async () => {
    const cache = await mkdtemp(join(tmpdir(), 'dsh-rw-built-runtime-'))
    const path = join(cache, runtimeArtifactName(VERSION, 'darwin-arm64'))
    await writeFile(path, Buffer.alloc(1024 * 1024 + 1))

    const built = await buildRuntimeArtifact({
      version: VERSION,
      platform: 'darwin',
      arch: 'arm64',
      cacheDir: cache,
    })

    expect(built.path).toBe(path)
    expect(built.sha256).toBe(await sha256File(path))
    expect(built.size).toBe((await stat(path)).size)
  })

  it('accepts a cached artifact whose sidecar checksum matches', async () => {
    const cache = await mkdtemp(join(tmpdir(), 'dsh-rw-built-runtime-'))
    const path = join(cache, runtimeArtifactName(VERSION, 'darwin-arm64'))
    await writeFile(path, Buffer.alloc(1024 * 1024 + 1))
    await writeFile(`${path}.sha256`, `${await sha256File(path)}  runtime.tar.gz\n`)

    const built = await buildRuntimeArtifact({
      version: VERSION,
      platform: 'darwin',
      arch: 'arm64',
      cacheDir: cache,
    })

    expect(built.path).toBe(path)
  })
})
