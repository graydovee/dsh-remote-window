/**
 * Release lookup for the server package: tag candidates, transports, verification.
 *
 * The artifact name follows the **dsh** release it was built for
 * (`dsh-remote-server-0.2.1-rc.2-linux-arm64-gnu.tar.gz`), while releases are cut
 * and tagged with the **plugin** version (`v0.1.0-alphaN`). A client that only
 * looked under `server-v<dshVersion>` therefore never found a published release.
 *
 * Measured constraint behind the second transport (QA host, alpha62): that machine
 * cannot reach `github.com:443` at all (`curl: (56) Recv failure`, `(28) Failed to
 * connect`) while `api.github.com` answers unauthenticated — so a tag is only
 * *usable* if the REST asset endpoint is tried too.
 *
 * Everything is injected (`runner`, `cacheDir`), so no test touches the network or
 * the developer's real `~/.dsh/remote-assets`.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { curlArgs, downloadServerPackage, releaseTagsFor, type CurlRunner } from '../src/provision/assets.ts'

const VERSION = '0.2.1-rc.2'
const PLUGIN = '0.1.0-alpha62'
const ARTIFACT = `dsh-remote-server-${VERSION}-linux-arm64-gnu.tar.gz`
const BODY = Buffer.from('pretend this is a 121 MB tarball')

/** sha256 of the fake artifact, as the release's `.sha256` companion states it. */
function digest(): string {
  return createHash('sha256').update(BODY).digest('hex')
}

let dir = ''
let cacheDir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-release-'))
  cacheDir = join(dir, 'assets')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

/** What the fake network knows. */
interface FakeNet {
  /** Tags whose release *page* URLs serve `<tag>/<artifact>` + `.sha256`. */
  readonly pages?: ReadonlySet<string>
  /** Tags the REST API knows, each with `name → asset id`. */
  readonly api?: ReadonlyMap<string, ReadonlyMap<string, number>>
  /** Override the published digest (to exercise the mismatch path). */
  readonly sha?: string
}

/** Build a runner over the fake network and record every request. */
function network(net: FakeNet): { runner: CurlRunner; calls: { url: string; output?: string; headers?: readonly string[] }[] } {
  const calls: { url: string; output?: string; headers?: readonly string[] }[] = []
  const sha = net.sha ?? digest()
  const notFound = { code: 22, stderr: 'curl: (22) The requested URL returned error: 404', stdout: '' }
  const runner: CurlRunner = async options => {
    calls.push(options)
    // 1. release page: .../releases/download/<tag>/<file>
    const page = /\/releases\/download\/([^/]+)\/([^/]+)$/u.exec(options.url)
    if (page !== null) {
      const tag = page[1] ?? ''
      const file = page[2] ?? ''
      if (net.pages?.has(tag) !== true || options.output === undefined) return notFound
      await writeFile(options.output, file.endsWith('.sha256') ? `${sha}  ${file.replace(/\.sha256$/u, '')}\n` : BODY)
      return { code: 0, stderr: '', stdout: '' }
    }
    // 2. REST: .../releases/tags/<tag>
    const listing = /\/releases\/tags\/([^/]+)$/u.exec(options.url)
    if (listing !== null) {
      const assets = net.api?.get(decodeURIComponent(listing[1] ?? ''))
      if (assets === undefined) return notFound
      return { code: 0, stderr: '', stdout: JSON.stringify({ assets: [...assets].map(([name, id]) => ({ id, name })) }) }
    }
    // 3. REST: .../releases/assets/<id>
    const asset = /\/releases\/assets\/(\d+)$/u.exec(options.url)
    if (asset !== null) {
      const id = Number(asset[1])
      for (const assets of net.api?.values() ?? []) {
        const name = [...assets].find(([, value]) => value === id)?.[0]
        if (name === undefined) continue
        if (options.output === undefined) return notFound
        await writeFile(options.output, name.endsWith('.sha256') ? `${sha}  ${name.replace(/\.sha256$/u, '')}\n` : BODY)
        return { code: 0, stderr: '', stdout: '' }
      }
      return notFound
    }
    return notFound
  }
  return { runner, calls }
}

/** The standard request for these tests. */
function request(extra: Partial<Parameters<typeof downloadServerPackage>[0]>, runner: CurlRunner): Parameters<typeof downloadServerPackage>[0] {
  return {
    version: VERSION,
    platform: 'linux',
    arch: 'arm64',
    libc: 'gnu',
    mirror: '',
    pluginVersion: PLUGIN,
    cacheDir,
    runner,
    ...extra,
  }
}

describe('releaseTagsFor', () => {
  it('tries the dsh-scoped tag first, then the plugin tag', () => {
    expect(releaseTagsFor(VERSION, PLUGIN)).toEqual([`server-v${VERSION}`, `v${PLUGIN}`])
  })

  it('omits the plugin tag entirely when the version is unknown', () => {
    expect(releaseTagsFor(VERSION)).toEqual([`server-v${VERSION}`])
    expect(releaseTagsFor(VERSION, '   ')).toEqual([`server-v${VERSION}`])
  })
})

describe('release page transport', () => {
  it('uses the first tag when its release page answers', async () => {
    const { runner, calls } = network({ pages: new Set([`server-v${VERSION}`]) })
    const asset = await downloadServerPackage(request({}, runner))
    expect(calls[0]?.url).toContain(`/releases/download/server-v${VERSION}/${ARTIFACT}`)
    expect(asset.sha256).toBe(digest())
    await expect(readFile(`${asset.path}.ready`, 'utf8')).resolves.toBe(`${digest()}\n`)
  })

  it('falls through to the plugin tag when the first page 404s, then verifies there', async () => {
    const { runner, calls } = network({ pages: new Set([`v${PLUGIN}`]) })
    const asset = await downloadServerPackage(request({}, runner))
    const artifactCalls = calls.filter(call => call.url.includes(ARTIFACT) && !call.url.includes('.sha256'))
    expect(artifactCalls.map(call => call.url)).toEqual([
      `https://github.com/graydovee/dsh-remote-workspace-server/releases/download/server-v${VERSION}/${ARTIFACT}`,
      `https://github.com/graydovee/dsh-remote-workspace-server/releases/download/v${PLUGIN}/${ARTIFACT}`,
    ])
    // `.sha256` comes from the same tag that served the artifact.
    const shaCalls = calls.filter(call => call.url.endsWith('.sha256'))
    expect(shaCalls.map(call => call.url)).toEqual([
      `https://github.com/graydovee/dsh-remote-workspace-server/releases/download/v${PLUGIN}/${ARTIFACT}.sha256`,
    ])
    expect(asset.sha256).toBe(digest())
    expect((await readdir(cacheDir)).filter(name => name.includes('.dsh-sha'))).toEqual([])
  })

  it('honours a mirror prefix and never touches the API', async () => {
    const { runner, calls } = network({ pages: new Set([`server-v${VERSION}`]) })
    await downloadServerPackage(request({ mirror: 'https://mirror.example.com/' }, runner))
    expect(calls.every(call => call.url.startsWith('https://mirror.example.com/'))).toBe(true)
    expect(calls[0]?.url).toBe(`https://mirror.example.com/graydovee/dsh-remote-workspace-server/releases/download/server-v${VERSION}/${ARTIFACT}`)
  })
})

describe('GitHub API transport', () => {
  it('falls back to the REST asset endpoint when the release page is unreachable', async () => {
    // The alpha62 shape: the page URL is unreachable, the API answers 200.
    const assets = new Map([[ARTIFACT, 654349545], [`${ARTIFACT}.sha256`, 654349546]])
    const { runner, calls } = network({ api: new Map([[`server-v${VERSION}`, assets]]) })
    const asset = await downloadServerPackage(request({}, runner))
    const urls = calls.map(call => call.url)
    expect(urls).toContain(`https://api.github.com/repos/graydovee/dsh-remote-workspace-server/releases/tags/server-v${VERSION}`)
    expect(urls).toContain('https://api.github.com/repos/graydovee/dsh-remote-workspace-server/releases/assets/654349545')
    expect(urls).toContain('https://api.github.com/repos/graydovee/dsh-remote-workspace-server/releases/assets/654349546')
    // Both asset fetches ask for the bytes explicitly.
    expect(calls
      .filter(call => call.url.includes('/releases/assets/'))
      .every(call => call.headers?.includes('Accept: application/octet-stream') === true)).toBe(true)
    expect(asset.sha256).toBe(digest())
    await expect(readFile(`${asset.path}.ready`, 'utf8')).resolves.toBe(`${digest()}\n`)
  })

  it('treats "tag exists but has no asset for this arch" as a tag failure, not a hard error', async () => {
    const api = new Map([[`server-v${VERSION}`, new Map([['some-other.tar.gz', 1]])]])
    const { runner } = network({ api, pages: new Set([`v${PLUGIN}`]) })
    const asset = await downloadServerPackage(request({}, runner))
    expect(asset.sha256).toBe(digest())
  })

  it('names both transports per tag when nothing works', async () => {
    const { runner } = network({})
    const failure = await downloadServerPackage(request({}, runner)).then(() => undefined, (error: unknown) => error as Error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure?.message).toContain('release download failed: no server package found for')
    expect(failure?.message).toContain(`server-v${VERSION} (html: curl: (22)`)
    expect(failure?.message).toContain('api: ')
    expect(failure?.message).toContain(`v${PLUGIN} (`)
    expect(failure?.message).toContain('switch the package source to upload')
    expect((await readdir(cacheDir).catch(() => [])).filter(name => name.endsWith('.tar.gz'))).toEqual([])
  })

  it('refuses a package whose .sha256 disagrees (no transport or tag fallback)', async () => {
    const { runner } = network({ pages: new Set([`v${PLUGIN}`]), sha: 'a'.repeat(64) })
    const failure = await downloadServerPackage(request({ releaseTags: [`v${PLUGIN}`] }, runner))
      .then(() => undefined, (error: unknown) => error as Error)
    expect(failure?.message).toContain('sha256 mismatch')
    expect(failure?.message).toContain(`v${PLUGIN}`)
    expect((await readdir(cacheDir).catch(() => [])).filter(name => name.endsWith('.tar.gz'))).toEqual([])
  })
})

describe('curlArgs', () => {
  it('retries transient connection failures (measured: the reset clears on a retry)', () => {
    const args = curlArgs({ url: 'https://example.com/x', output: 'out.bin' })
    expect(args).toContain('-fL')
    expect(args).toContain('--retry')
    expect(args).toContain('3')
    expect(args).toContain('--retry-connrefused')
    // `-o <file>` right before the url (curl's argv order here).
    expect(args.slice(-3)).toEqual(['-o', 'out.bin', 'https://example.com/x'])
  })

  it('passes headers through and omits -o for a stdout fetch', () => {
    const args = curlArgs({ url: 'https://api.github.com/x', headers: ['Accept: application/vnd.github+json'] })
    expect(args).toContain('-H')
    expect(args).toContain('Accept: application/vnd.github+json')
    expect(args).not.toContain('-o')
    expect(args.at(-1)).toBe('https://api.github.com/x')
  })
})
