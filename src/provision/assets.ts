/**
 * Host-side asset cache for the remote deployment.
 *
 * ZCode-style: the *local* machine fetches each component once, verifies it,
 * and caches it under `~/.dsh/remote-assets/`. Deployments then upload from
 * this cache (or skip entirely when the remote marker matches), so a flaky
 * remote network never blocks a connect — only the first connect for a new
 * platform downloads anything, and repeated connects are pure uploads.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { artifactName, artifactTag, buildServerPackage } from './package-build.ts'

export { artifactName, artifactTag }

/** Node distribution versions tried in order. Node 24 is required: the dsh
 *  CLI entrypoint dispatches on `import.meta.main`, which Node 22 leaves
 *  undefined (the CLI then silently does nothing). The harness itself ships
 *  Node 24, so the deployed runtime matches the version dsh is tested with. */
export const NODE_VERSION_CANDIDATES = ['v24.21.0']

/** Download roots, tried in order: CN mirror first, then the official one.
 *  Each takes the release-relative file path (`v24.21.0/node-v24.21.0-….tar.gz`). */
const NODE_MIRRORS = [
  (file: string): string => `https://registry.npmmirror.com/-/binary/node/${file}`,
  (file: string): string => `https://nodejs.org/dist/${file}`,
]

/** npm registries for host-side staging, tried in order. */
const NPM_REGISTRIES = ['https://registry.npmmirror.com', 'https://registry.npmjs.org']

/** Pure-JS postinstall packages allowed to run scripts during staging. Native
 *  builds (node-pty & co.) are intentionally excluded: a cross-OS build would
 *  only produce host-platform binaries, and the remote execution world does
 *  not require a pty provider. */
const STAGE_BUILD_ALLOWLIST = ['@google/genai', 'protobufjs', 'koffi']

/** One cached asset ready for upload. */
export interface CachedAsset {
  /** Absolute local path of the artifact. */
  readonly path: string
  /** sha256 of the artifact bytes. */
  readonly sha256: string
  /** Byte size. */
  readonly size: number
  /** The component version this artifact carries. */
  readonly version: string
}

/** Run a local command as a promise with a byte ceiling. */
function execLocal(command: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error != null) {
        const code = typeof error.code === 'number' ? error.code : 1
        resolve({ code, stdout: stdout.toString(), stderr: stderr.toString() })
        return
      }
      resolve({ code: 0, stdout: stdout.toString(), stderr: stderr.toString() })
    })
  })
}

/** The host-side cache root: `~/.dsh/remote-assets/`. */
export function remoteAssetsCacheDir(): string {
  return join(homedir(), '.dsh', 'remote-assets')
}

/**
 * The most informative single line an error can give — never empty.
 *
 * `error.message` is empty for several `fs`/stream failures, and those were
 * exactly the ones this module reported as `cannot hash <path>: ` (alpha52, on a
 * Windows host): a diagnostic dead end. Fall back to the code, then the name.
 */
function errorReason(error: unknown): string {
  if (error instanceof Error) {
    if (error.message !== '') return error.message
    const code = (error as NodeJS.ErrnoException).code
    if (code !== undefined && String(code) !== '') return String(code)
    return error.name
  }
  return String(error)
}

/**
 * sha256 of one file, **streamed through `node:crypto`**.
 *
 * Was `execLocal('shasum', ['-a', '256', path])`, which is POSIX-only: on a
 * Windows host `shasum`/`sha256sum` do not exist, so the very first `ensureNode`
 * on any fresh remote died at `cannot hash …` (empty reason, no `.ready` marker)
 * — the whole upload path was unusable from Windows. Node's own crypto is always
 * present, and streaming keeps a 57 MB node tarball / 144 MB server package out
 * of memory (same style as `sha256OfFiles`).
 * @param path - absolute local file path.
 * @returns the lowercase hex digest.
 */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  try {
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  } catch (error) {
    throw new Error(`cannot hash ${path}: ${errorReason(error)}`)
  }
  return hash.digest('hex')
}

/** Machine architecture in Node tarball spelling. */
export function nodeArchKey(machine: string): 'x64' | 'arm64' {
  return machine === 'aarch64' || machine === 'arm64' ? 'arm64' : 'x64'
}

/** The `<platformArch>` segment used in cache paths and remote markers. */
export function platformArch(platform: 'linux' | 'darwin', arch: 'x64' | 'arm64'): string {
  return `${platform}-${arch}`
}

/**
 * The cached Node tarball for one platform, downloading it on first use.
 * Every candidate (version × mirror) is probed with a short HEAD request
 * before the real download; a failed download removes the partial file and
 * moves to the next candidate, mirroring the remote-install fallback.
 */
export async function ensureNodeTarball(options: {
  platform: 'linux' | 'darwin'
  arch: 'x64' | 'arm64'
  onProgress?: (message: string, detail?: string) => void
}): Promise<CachedAsset> {
  const notify = options.onProgress ?? (() => {})
  const dir = join(remoteAssetsCacheDir(), platformArch(options.platform, options.arch))
  // The cache directory may not exist on a first-ever run; `curl -o` would
  // fail with a write error before any download starts.
  await mkdir(dir, { recursive: true })
  const failures: string[] = []
  for (const version of NODE_VERSION_CANDIDATES) {
    const file = `node-${version}-${options.platform}-${options.arch}.tar.gz`
    const cached = join(dir, file)
    const ready = `${cached}.ready`
    try {
      const [info, marker] = await Promise.all([stat(cached), readFile(ready, 'utf8').catch(() => '')])
      if (info.isFile() && info.size > 1024 * 1024) {
        const sha256 = await sha256File(cached)
        if (marker.trim() === sha256) {
          notify(`node ${version} cached locally (${(info.size / 1024 / 1024).toFixed(1)} MB)`)
          return { path: cached, sha256, size: info.size, version }
        }
      }
    } catch {}
    // The gzipped distribution is ~30 MB; the official dist only ships .tar.gz
    // for linux/darwin, so no xz decompression is needed on the remote either.
    // Both mirrors key releases by the bare version directory (`/v24.21.0/`),
    // relative to the mirror root — no leading slash, no doubled separators.
    const relative = `${version}/node-${version}-${options.platform}-${options.arch}.tar.gz`
    for (const mirror of NODE_MIRRORS) {
      const url = mirror(relative)
      notify(`downloading node ${version} from ${new URL(url).host}`)
      await rm(cached, { force: true })
      const result = await execLocal('curl', ['-fL', '--retry', '2', '--connect-timeout', '20', '-m', '600', '-o', cached, url], 620_000)
      if (result.code !== 0) {
        // Surface the real reason (missing binary, DNS, 404…) — "trying the
        // next source" must never swallow it.
        const reason = (result.stderr || result.stdout || `curl exit ${result.code}`).trim().split('\n').slice(-3).join(' | ')
        failures.push(`${new URL(url).host}: ${reason}`)
        notify(`download from ${new URL(url).host} failed; trying the next source`, reason)
        await rm(cached, { force: true })
        continue
      }
      const info = await stat(cached)
      const sha256 = await sha256File(cached)
      await writeFile(ready, `${sha256}\n`)
      notify(`node ${version} downloaded (${(info.size / 1024 / 1024).toFixed(1)} MB)`)
      return { path: cached, sha256, size: info.size, version }
    }
  }
  throw new Error(`could not download a Node 22 distribution for ${options.platform}-${options.arch}; attempts: ${failures.join(' ;; ')}`)
}

/** Read one cached asset back by exact path (after a marker hit). */
export async function cachedAssetIfReady(path: string): Promise<CachedAsset | undefined> {
  try {
    const [info, ready] = await Promise.all([stat(path), readFile(`${path}.ready`, 'utf8')])
    const sha256 = ready.trim()
    if (!info.isFile() || sha256.length !== 64) return undefined
    return { path, sha256, size: info.size, version: '' }
  } catch {
    return undefined
  }
}

/** Drop orphaned cache entries (never fails). */
export async function pruneCache(olderThanMs: number): Promise<void> {
  const dir = remoteAssetsCacheDir()
  const entries = await readdir(dir).catch(() => [])
  const now = Date.now()
  for (const entry of entries) {
    const full = join(dir, entry)
    const info = await stat(full).catch(() => undefined)
    if (info !== undefined && now - info.mtimeMs > olderThanMs) await rm(full, { recursive: true, force: true }).catch(() => {})
  }
}

/** The server bundle's content hash — the `server` component's idempotency key. */
export async function sha256OfFiles(files: readonly { path: string; content: Buffer }[]): Promise<string> {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.path)
    hash.update('\0')
    hash.update(file.content)
  }
  return hash.digest('hex')
}

/** A host-side Node + pnpm pair able to stage npm packages. */
export interface HostPnpm {
  readonly node: string
  readonly pnpm: string
}

/**
 * Locate a host-side pnpm launcher.
 *
 * The harness ships one under `~/.dsh/dsh-runtimes/<runtime>/dependencies/pnpm`
 * with a matching Node; a PATH pnpm/node pair is the fallback.
 *
 * The probe has to accept **both** layouts: the packaged runtimes ship
 * `pnpm/bin/pnpm.mjs` and (on Windows) `node/bin/node.exe`, while older/POSIX
 * trees use `pnpm.cjs` and `node/bin/node`. Matching only the POSIX spelling is
 * what made every Windows-hosted staging attempt die with "cannot find a host
 * pnpm" — and staging is unavoidable for WSL targets, which only exist on
 * Windows.
 */
export async function findHostPnpm(): Promise<HostPnpm> {
  const env = process.env
  if (env.DSH_HOST_PNPM !== undefined && env.DSH_HOST_NODE !== undefined) {
    return { node: env.DSH_HOST_NODE, pnpm: env.DSH_HOST_PNPM }
  }
  const isFile = (path: string): Promise<boolean> => stat(path).then(entry => entry.isFile(), () => false)
  /** First existing candidate, or undefined. */
  const firstFile = async (candidates: readonly string[]): Promise<string | undefined> => {
    for (const candidate of candidates) if (await isFile(candidate)) return candidate
    return undefined
  }
  const runtimes = join(homedir(), '.dsh', 'dsh-runtimes')
  for (const entry of await readdir(runtimes).catch(() => [])) {
    const deps = join(runtimes, entry, 'dependencies')
    const pnpm = await firstFile([
      join(deps, 'pnpm', 'bin', 'pnpm.cjs'),
      join(deps, 'pnpm', 'bin', 'pnpm.mjs'),
      join(deps, 'pnpm', 'pnpm.cjs'),
    ])
    const node = await firstFile([
      join(deps, 'node', 'bin', 'node'),
      join(deps, 'node', 'bin', 'node.exe'),
      join(deps, 'node', 'node.exe'),
    ])
    if (pnpm !== undefined && node !== undefined) return { node, pnpm }
  }
  throw new Error('cannot find a host pnpm to stage the dsh runtime package')
}

/**
 * Build (or fetch from the local cache) the server package for one target.
 *
 * Staging runs on the host with the exact harness version — the remote never
 * talks to a registry, and the deployed bytes can never drift from the host
 * version. The staging/packing implementation lives in `package-build.ts` and
 * is shared with the release CI script; a GitHub Release download can replace
 * the local staging per the target's package-source policy.
 */
export async function buildDshRuntimePackage(options: {
  version: string
  platform: 'linux' | 'darwin'
  arch: 'x64' | 'arm64'
  libc: '' | 'gnu' | 'musl'
  onProgress?: (message: string, detail?: string) => void
}): Promise<CachedAsset> {
  const notify = options.onProgress ?? (() => {})
  const tag = artifactTag(options.platform, options.arch, options.libc)
  const dir = remoteAssetsCacheDir()
  await mkdir(dir, { recursive: true })
  const cached = join(dir, artifactName(options.version, tag))
  const ready = `${cached}.ready`
  try {
    const [info, marker] = await Promise.all([stat(cached), readFile(ready, 'utf8').catch(() => '')])
    if (info.isFile() && info.size > 1024 * 1024) {
      const sha256 = await sha256File(cached)
      if (marker.trim() === sha256) {
        notify(`dsh server package ${options.version} cached (${(info.size / 1024 / 1024).toFixed(1)} MB)`)
        return { path: cached, sha256, size: info.size, version: options.version }
      }
    }
  } catch {}
  const tool = await findHostPnpm()
  const built = await buildServerPackage({
    version: options.version,
    platform: options.platform,
    arch: options.arch,
    libc: options.libc,
    outDir: dir,
    nodeBin: tool.node,
    pnpmCjs: tool.pnpm,
    onProgress: notify,
  })
  const sha256 = await sha256File(built.file)
  await writeFile(ready, `${sha256}\n`)
  return { path: built.file, sha256, size: built.size, version: options.version }
}

/**
 * How one `curl` fetch is executed.
 *
 * Injectable for the same reason `packStage` takes a `TarRunner`: the tag
 * fallback (404 → API → next tag), the API asset lookup and the `.sha256`
 * verification must be testable without network access or a real `curl`.
 * `output` is omitted for the JSON lookups, where the body comes back on stdout.
 */
export type CurlRunner = (options: {
  readonly url: string
  readonly output?: string
  readonly headers?: readonly string[]
  /** Whole-request budget in seconds; the transports get different ones. */
  readonly maxTimeSeconds?: number
  /** Continue an existing partial file (`-C -`) instead of restarting it. */
  readonly resume?: boolean
}) => Promise<{ readonly code: number; readonly stderr: string; readonly stdout: string }>

/**
 * Budget for the browser-style release URL.
 *
 * Short on purpose: on a host that cannot reach `github.com:443` the connection
 * *hangs* (measured: 0 bytes for ten minutes, no error, because `-m 900` had not
 * expired yet), so the REST fallback never got a turn. `--speed-time` ends a
 * stalled transfer after 30 s; this cap is the belt-and-braces limit for a slow
 * but alive one.
 */
export const RELEASE_PAGE_TIMEOUT_S = 180

/**
 * Budget for the REST transport: it is the one that really moves 121 MB.
 *
 * One hour, because the download has to survive a slow link: measured 12–45 KB/s
 * to `api.github.com` from the QA host, i.e. ~45–170 minutes for a 121 MB package,
 * so the earlier 15-minute cap made the download impossible there. Nothing can
 * hang forever from this: `--speed-limit`/`--speed-time` is what detects a dead
 * transfer, so a generous *total* budget costs nothing.
 */
export const API_TIMEOUT_S = 3600

/**
 * The argv one `curl` fetch runs with.
 *
 * - `--retry 3 --retry-connrefused` — the reset/refused cases are transient here;
 *   a retried request does succeed.
 * - `--speed-limit 1024 --speed-time 30` — measured: a blocked `github.com:443`
 *   does **not** fail fast, it sits at 0 bytes, and only this makes it give up in
 *   half a minute so the API fallback runs.
 * - `-m <budget>` — per transport (`RELEASE_PAGE_TIMEOUT_S` vs `API_TIMEOUT_S`).
 * Exported so the flags are asserted instead of assumed.
 * @param options - target url, optional output file, headers and time budget.
 */
export function curlArgs(options: {
  readonly url: string
  readonly output?: string
  readonly headers?: readonly string[]
  readonly maxTimeSeconds?: number
  readonly resume?: boolean
}): string[] {
  return [
    '-fL',
    '--retry', '3',
    '--retry-connrefused',
    '--connect-timeout', '20',
    '--speed-limit', '1024',
    '--speed-time', '30',
    '-m', String(options.maxTimeSeconds ?? RELEASE_PAGE_TIMEOUT_S),
    // Resume a partial artifact: a 40-minute download must not restart from zero
    // because the link hiccuped at 99.8% (alpha66).
    ...(options.resume === true ? ['-C', '-'] : []),
    ...(options.headers ?? []).flatMap(header => ['-H', header]),
    ...(options.output === undefined ? [] : ['-o', options.output]),
    options.url,
  ]
}

/** The production runner: `curl -fL` into a file (or stdout), bounded by a timeout. */
export const runCurl: CurlRunner = async (options) => {
  // The process timeout outlives curl's own budget so curl reports first (a killed
  // curl loses its stderr, which is the diagnostic we need).
  const budgetMs = ((options.maxTimeSeconds ?? RELEASE_PAGE_TIMEOUT_S) + 60) * 1_000
  const result = await execLocal('curl', curlArgs(options), budgetMs)
  return { code: result.code, stderr: result.stderr, stdout: result.stdout }
}

/**
 * GitHub coordinates of the release that carries the server packages.
 *
 * The **server** repository, not this one: these tarballs are a dsh runtime
 * world built by `dsh-remote-window-server`'s own CI
 * (`.github/workflows/server-release.yml`), and that is where they are
 * released. Publishing them from the client repository was wrong — it put the
 * server project's artifacts behind the plugin's release page.
 */
const RELEASE_OWNER = 'graydovee'
const RELEASE_REPO = 'dsh-remote-window-server'
/** Browser-style release asset URL for one tag (the official, documented path). */
const HTML_BASE = 'https://github.com'
/** REST base: reachable even where `github.com:443` is blocked (measured). */
const API_BASE = 'https://api.github.com'

/**
 * The release tags a server package may live under, in the order to try.
 *
 * Two names are legitimate, and neither is wrong:
 *
 * 1. `server-v<dshVersion>` — the long-term convention: the artifact is built for
 *    one dsh release train, so the tag names that version.
 * 2. `v<pluginVersion>` — releases cut with the plugin itself (the user tags
 *    `v0.1.0-alphaN` and hangs the CI matrix on it). Without this candidate a
 *    published release would be invisible to every client, because the client
 *    looks up the *dsh* version, not the plugin's.
 *
 * The first candidate that answers wins; `.sha256` is fetched from the same tag as
 * the artifact, never from a different one.
 * @param dshVersion - the dsh release the package is built for.
 * @param pluginVersion - this plugin's own version, when known.
 */
export function releaseTagsFor(dshVersion: string, pluginVersion?: string): string[] {
  const tags = [`server-v${dshVersion}`]
  const plugin = pluginVersion?.trim() ?? ''
  if (plugin !== '' && !tags.includes(`v${plugin}`)) tags.push(`v${plugin}`)
  return tags
}

/** The GitHub release asset base for one tag under a given host. */
function releaseAssetBase(host: string, tag: string): string {
  return `${host}/${RELEASE_OWNER}/${RELEASE_REPO}/releases/download/${tag}`
}

/** One transport's failure, kept short for the aggregated error message. */
function reasonOf(result: { code: number; stderr: string }): string {
  return (result.stderr || `curl exit ${result.code}`).trim().split('\n').at(-1)?.slice(-160) ?? `curl exit ${result.code}`
}

/**
 * How long a host whose release page failed *hard* is skipped.
 *
 * In-process only (a restart clears it) and deliberately short: the network may
 * come back, and the official release URL is the path we want whenever it works.
 */
export const RELEASE_PAGE_MEMORY_MS = 10 * 60 * 1000

/** Hosts whose release page transport recently failed at the network level. */
const unreachableHosts = new Map<string, number>()

/**
 * Whether a failure means "this host is unreachable" rather than "this asset/tag
 * is missing".
 *
 * The distinction is the whole point: a 404 (`--fail` exit 22) proves the host
 * answered, so the next tag must be tried normally; a blocked host instead hangs
 * or resets. curl codes here: 6/7 resolution/connect, 28 timeout (also what
 * `--speed-time` aborts with), 35 TLS handshake, 55/56 send/recv failure, 18
 * partial transfer, 92 HTTP/2 stream error.
 * @param result - the failed curl result.
 */
export function isReleasePageUnreachable(result: { code: number; stderr: string }): boolean {
  if (result.code === 22 || result.code === 0) return false
  if ([6, 7, 18, 28, 35, 55, 56, 92].includes(result.code)) return true
  return /\(6\)|\(7\)|\(18\)|\(28\)|\(35\)|\(55\)|\(56\)|\(92\)|timed out|Recv failure|Connection (refused|reset)/i.test(result.stderr)
}

/** Remember that one host's release page is not usable right now. */
export function markReleasePageUnreachable(host: string, now: number = Date.now()): void {
  unreachableHosts.set(host, now)
}

/** Whether one host is still inside its "skip the release page" window. */
export function releasePageMarkedUnreachable(host: string, now: number = Date.now()): boolean {
  const markedAt = unreachableHosts.get(host)
  if (markedAt === undefined) return false
  if (now - markedAt >= RELEASE_PAGE_MEMORY_MS) {
    unreachableHosts.delete(host)
    return false
  }
  return true
}

/** Forget every remembered host (tests only). */
export function resetReleasePageMemory(): void {
  unreachableHosts.clear()
}

/**
 * When a download reports its size, and how often at most.
 *
 * A 121 MB package can take an hour on a slow link, so a silent progress line is
 * indistinguishable from a hang (alpha65). The poller reads the `-o` target's size
 * — curl's own stderr meter is not portable across versions — and reports at most
 * twice a minute or every 20 MB, whichever comes first.
 */
const DOWNLOAD_PROGRESS_TICK_MS = 5_000
const DOWNLOAD_PROGRESS_REPORT_MS = 15_000
const DOWNLOAD_PROGRESS_STEP_BYTES = 20 * 1024 * 1024

/** `12.3` for byte counts, in MB. */
function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}

/**
 * Download one file and report success/failure without throwing.
 *
 * `onProgress` is invoked while the transfer runs (see
 * {@link DOWNLOAD_PROGRESS_STEP_BYTES}); failures delete the target so a partial
 * file can never be mistaken for a cached artifact.
 */
async function fetchTo(
  runner: CurlRunner,
  url: string,
  output: string,
  options: {
    headers?: readonly string[]
    maxTimeSeconds?: number
    /** Total size, when the caller knows it (the REST asset listing reports `size`). */
    totalBytes?: number
    onProgress?: (transferred: number, totalBytes: number | undefined) => void
    progressIntervalMs?: number
    /** Continue an existing partial file instead of restarting it. */
    resume?: boolean
    /** Keep a partial file on failure (resume needs it); default removes it. */
    keepPartial?: boolean
  } = {},
): Promise<{ ok: boolean; result: { code: number; stderr: string; stdout: string } }> {
  let finished = false
  /** Wakes the poller's sleep when the transfer ends, so it never adds latency. */
  let wake: (() => void) | undefined
  let poller: Promise<void> | undefined
  if (options.onProgress !== undefined) {
    const onProgress = options.onProgress
    const tickMs = options.progressIntervalMs ?? DOWNLOAD_PROGRESS_TICK_MS
    poller = (async () => {
      let lastBytes = 0
      let lastReportAt = Date.now()
      while (!finished) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, tickMs)
          timer.unref?.()
          // `finished` must interrupt the sleep: without this every completed
          // transfer waited out a whole tick (5 s each) before returning.
          wake = () => {
            clearTimeout(timer)
            resolve()
          }
        })
        wake = undefined
        if (finished) return
        const size = await stat(output).then(info => info.size, () => 0)
        const now = Date.now()
        if (size <= lastBytes) continue
        if (size - lastBytes < DOWNLOAD_PROGRESS_STEP_BYTES && now - lastReportAt < DOWNLOAD_PROGRESS_REPORT_MS) continue
        lastBytes = size
        lastReportAt = now
        onProgress(size, options.totalBytes)
      }
    })()
  }
  try {
    const result = await runner({
      url,
      output,
      ...(options.headers === undefined ? {} : { headers: options.headers }),
      ...(options.maxTimeSeconds === undefined ? {} : { maxTimeSeconds: options.maxTimeSeconds }),
      ...(options.resume === true ? { resume: true } : {}),
    })
    if (result.code === 0) return { ok: true, result }
    // A *transport* failure of the artifact keeps what already arrived: the next
    // attempt resumes with `-C -` (alpha66 lost 40 minutes at 99.8%). Everything
    // else (and any caller that did not ask) still cleans up, so a 0-byte file
    // can never masquerade as a cached artifact.
    if (options.keepPartial !== true) await rm(output, { force: true })
    return { ok: false, result }
  } finally {
    finished = true
    wake?.()
    await poller?.catch(() => {})
  }
}

/**
 * Verify a downloaded artifact against its companion and mark the cache ready.
 *
 * A body that does not match its own `.sha256` is a **hard failure**: the tag
 * exists and its companion disagrees, so trying another transport (or tag) would
 * only hide a bad publish.
 */
async function verifyDownload(cached: string, shaFile: string, releaseTag: string, transport: string): Promise<CachedAsset> {
  const expected = (await readFile(shaFile, 'utf8')).trim().split(/\s+/)[0] ?? ''
  await rm(shaFile, { force: true })
  const actual = await sha256File(cached)
  if (expected.length !== 64 || expected !== actual) {
    await rm(cached, { force: true })
    throw new Error(`downloaded server package sha256 mismatch for release ${releaseTag} via ${transport} (expected ${expected || 'none'}, got ${actual})`)
  }
  const info = await stat(cached)
  await writeFile(`${cached}.ready`, `${actual}\n`)
  return { path: cached, sha256: actual, size: info.size, version: '' }
}

/** One release asset as the GitHub REST API reports it. */
interface ReleaseAsset {
  readonly id: number
  readonly name: string
  /** Byte size, so the progress line can show `x / total`. */
  readonly size?: number
}

/** The subset of the release JSON this module reads. */
function assetsOf(json: string): ReleaseAsset[] | undefined {
  try {
    const parsed = JSON.parse(json) as { assets?: unknown }
    if (!Array.isArray(parsed.assets)) return undefined
    return parsed.assets
      .filter((asset): asset is { id: number; name: string; size?: number } =>
        typeof asset === 'object' && asset !== null &&
        typeof (asset as { id?: unknown }).id === 'number' &&
        typeof (asset as { name?: unknown }).name === 'string')
      .map(asset => ({
        id: asset.id,
        name: asset.name,
        ...(typeof asset.size === 'number' ? { size: asset.size } : {}),
      }))
  } catch {
    return undefined
  }
}

/**
 * Download the release-built server package and verify it against its `.sha256`.
 *
 * Two transports are tried **per candidate tag**, because a published release is
 * only useful if the client can actually reach it:
 *
 * 1. the browser-style release URL on `github.com` (the documented path);
 * 2. the REST API (`/releases/tags/<tag>` → `assets[].id` → `/releases/assets/<id>`
 *    with `Accept: application/octet-stream`). Measured on the QA host:
 *    `github.com:443` times out there while `api.github.com` answers 200
 *    unauthenticated.
 *
 * A configured `mirror` disables the API transport: a mirror is not necessarily
 * GitHub, so only the mirror URL is tried.
 * @param options - release/arch, mirror, tag candidates and test seams.
 */
export async function downloadServerPackage(options: {
  version: string
  platform: 'linux' | 'darwin'
  arch: 'x64' | 'arm64'
  libc: '' | 'gnu' | 'musl'
  mirror: string
  /** This plugin's version, for the `v<pluginVersion>` candidate. */
  pluginVersion?: string
  /** Explicit candidate list (tests); defaults to {@link releaseTagsFor}. */
  releaseTags?: readonly string[]
  /** Cache directory override (tests); defaults to `~/.dsh/remote-assets`. */
  cacheDir?: string
  /** curl substitution (tests). */
  runner?: CurlRunner
  /** Clock substitution (tests): the release-page memory's window is time-based. */
  now?: () => number
  /** Progress poll interval override (tests); defaults to a few seconds. */
  progressIntervalMs?: number
  onProgress?: (message: string, detail?: string) => void
}): Promise<CachedAsset> {
  const notify = options.onProgress ?? (() => {})
  const runner = options.runner ?? runCurl
  const now = options.now ?? Date.now
  const tag = artifactTag(options.platform, options.arch, options.libc)
  const name = artifactName(options.version, tag)
  const dir = options.cacheDir ?? remoteAssetsCacheDir()
  await mkdir(dir, { recursive: true })
  const cached = join(dir, name)
  const shaFile = `${cached}.dsh-sha`
  const tags = options.releaseTags ?? releaseTagsFor(options.version, options.pluginVersion)
  const mirror = options.mirror.replace(/\/+$/, '')
  const failures: string[] = []
  // A blocked release page hangs instead of failing (measured: ten minutes at zero
  // bytes), so once it has failed at the network level the next attempts in this
  // process go straight to the API for ten minutes — otherwise every connect pays
  // the whole budget again. Only hard network failures arm this; a 404 means the
  // host answered and the next tag is tried normally.
  const skipHtml = mirror === '' && releasePageMarkedUnreachable(HTML_BASE, now())
  if (skipHtml) notify('release page marked unreachable for 10 minutes; using the GitHub API')
  // A 121 MB transfer over a slow link must show movement, or it reads as a hang.
  const progress = (transferred: number, totalBytes: number | undefined): void => {
    notify(`server package download progress: ${megabytes(transferred)}${totalBytes === undefined ? '' : ` / ${megabytes(totalBytes)}`} MB`)
  }
  const progressOptions = {
    onProgress: progress,
    ...(options.progressIntervalMs === undefined ? {} : { progressIntervalMs: options.progressIntervalMs }),
  }
  /**
   * Fetch the artifact body, resuming a partial file when there is one.
   *
   * `curl -C -` is what turns a hiccup at 99.8% into a retry instead of a lost
   * 40-minute download (alpha66). A failed transfer KEEPS the partial: the next
   * transport or tag continues it. A 404 deletes it (that tag does not exist),
   * and so does a size/sha mismatch (the bytes are not the published ones).
   */
  const fetchArtifact = async (url: string, options: {
    headers?: readonly string[]
    maxTimeSeconds: number
    totalBytes?: number
  }): Promise<{ ok: true } | { ok: false; reason: string; code: number; stderr: string }> => {
    const existing = await stat(cached).then(info => info.size, () => 0)
    const total = options.totalBytes
    // Already complete (a previous attempt got the whole body, e.g. the sha step failed).
    if (total !== undefined && existing === total) return { ok: true }
    // Longer than the published asset: stale or mixed bytes, start over.
    if (total !== undefined && existing > total) await rm(cached, { force: true })
    const resume = existing > 0 && (total === undefined || existing < total)
    if (resume) notify(`resuming the server package download at ${megabytes(existing)}${total === undefined ? '' : ` / ${megabytes(total)}`} MB`)
    const result = await fetchTo(runner, url, cached, {
      ...(options.headers === undefined ? {} : { headers: options.headers }),
      maxTimeSeconds: options.maxTimeSeconds,
      ...(total === undefined ? {} : { totalBytes: total }),
      ...progressOptions,
      ...(resume ? { resume: true } : {}),
      // Keep what arrived; the next attempt resumes it.
      keepPartial: true,
    })
    if (!result.ok) {
      // 404: this tag/asset is not there, so the partial belongs to nothing.
      if (result.result.code === 22) await rm(cached, { force: true })
      return { ok: false, reason: reasonOf(result.result), code: result.result.code, stderr: result.result.stderr }
    }
    if (total !== undefined) {
      const size = await stat(cached).then(info => info.size, () => 0)
      if (size !== total) {
        // A short body after a successful curl is not resumable safely: drop it.
        await rm(cached, { force: true })
        return { ok: false, reason: `incomplete (${size} / ${total} bytes)`, code: 0, stderr: '' }
      }
    }
    return { ok: true }
  }

  for (const releaseTag of tags) {
    const attempts: string[] = []
    const hosts = skipHtml ? [] : mirror === '' ? [HTML_BASE] : [mirror]
    // The REST listing reports the asset sizes; remember them so a resumed
    // attempt knows what "complete" means.
    let assetSizes: Map<string, number> | undefined
    // 1. release-page (or mirror) URL
    for (const host of hosts) {
      const base = releaseAssetBase(host, releaseTag)
      const total = assetSizes?.get(name)
      notify(`downloading server package ${name} from ${host} (release ${releaseTag})`)
      const artifact = await fetchArtifact(`${base}/${name}`, { maxTimeSeconds: RELEASE_PAGE_TIMEOUT_S, ...(total === undefined ? {} : { totalBytes: total }) })
      if (!artifact.ok) {
        attempts.push(`html: ${artifact.reason}`)
        if (host === HTML_BASE && isReleasePageUnreachable({ code: artifact.code, stderr: artifact.stderr })) markReleasePageUnreachable(HTML_BASE, now())
        continue
      }
      const sha = await fetchTo(runner, `${base}/${name}.sha256`, shaFile, { maxTimeSeconds: RELEASE_PAGE_TIMEOUT_S })
      if (!sha.ok) {
        attempts.push(`html: .sha256 companion missing`)
        continue
      }
      const verified = await verifyDownload(cached, shaFile, releaseTag, 'html')
      notify(`server package downloaded from release ${releaseTag} (${megabytes(verified.size)} MB)`)
      return { ...verified, version: options.version }
    }
    // 2. REST API transport (only for GitHub itself)
    if (mirror === '') {
      if (!skipHtml) notify(`release page unreachable for ${releaseTag}; trying the GitHub API`)
      const releaseUrl = `${API_BASE}/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases/tags/${encodeURIComponent(releaseTag)}`
      const listing = await runner({ url: releaseUrl, headers: ['Accept: application/vnd.github+json'], maxTimeSeconds: API_TIMEOUT_S })
      if (listing.code !== 0) {
        attempts.push(`api: ${reasonOf(listing)}`)
      } else {
        const assets = assetsOf(listing.stdout)
        assetSizes = new Map((assets ?? []).filter(asset => asset.size !== undefined).map(asset => [asset.name, asset.size as number] as const))
        const artifactAsset = assets?.find(asset => asset.name === name)
        const shaAsset = assets?.find(asset => asset.name === `${name}.sha256`)
        if (artifactAsset === undefined || shaAsset === undefined) {
          // The tag exists but carries no package for this architecture.
          attempts.push(`api: asset ${name} not in release`)
        } else {
          const artifact = await fetchArtifact(
            `${API_BASE}/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases/assets/${artifactAsset.id}`,
            {
              headers: ['Accept: application/octet-stream'],
              maxTimeSeconds: API_TIMEOUT_S,
              // The listing reports the size, so progress reads `x / 121.2 MB` and
              // a resume knows how much is missing.
              ...(artifactAsset.size === undefined ? {} : { totalBytes: artifactAsset.size }),
            },
          )
          if (!artifact.ok) {
            attempts.push(`api: ${artifact.reason}`)
          } else {
            const sha = await fetchTo(runner, `${API_BASE}/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases/assets/${shaAsset.id}`, shaFile, {
              headers: ['Accept: application/octet-stream'],
              maxTimeSeconds: API_TIMEOUT_S,
            })
            if (!sha.ok) {
              attempts.push(`api: .sha256 asset download failed`)
            } else {
              const verified = await verifyDownload(cached, shaFile, releaseTag, 'api')
              notify(`server package downloaded from release ${releaseTag} via the GitHub API (${megabytes(verified.size)} MB)`)
              return { ...verified, version: options.version }
            }
          }
        }
      }
    }
    failures.push(`${releaseTag} (${attempts.join('; ') || 'not found'})`)
  }
  throw new Error(
    `release download failed: no server package found for ${failures.join(', ')}; publish a release (tag ${tags.at(-1) ?? ''}) or switch the package source to upload`,
  )
}

/** The package-source resolution order for one policy. */
export function sourceOrder(policy: 'auto' | 'download' | 'upload'): readonly ('cache' | 'download' | 'build')[] {
  // `download` is an *explicit* choice: if both transports fail, say so and stop.
  // Silently staging a local build would tell the user "downloaded" when nothing
  // was downloaded (alpha66). Only `auto` keeps the build fallback.
  if (policy === 'download') return ['cache', 'download'] as const
  if (policy === 'upload') return ['cache', 'build'] as const
  return ['cache', 'download', 'build'] as const
}

/**
 * What the local cache holds for one target architecture, without touching the
 * network or the packer.
 *
 * Used by `dsh-scan` to tell the wizard "already cached, upload directly" before
 * the user commits to the upload path. Deliberately the *same* validation the
 * resolver applies on a hit (`cachedAssetIfReady` + the 1 MiB floor from
 * api-contract §9.1), so a "cached" badge and a real cache hit cannot disagree.
 * @param options - the dsh release and the target platform.
 * @returns the artifact name plus, on a hit, its digest and size.
 */
export async function describeLocalPackage(options: {
  version: string
  platform: 'linux' | 'darwin'
  arch: 'x64' | 'arm64'
  libc: '' | 'gnu' | 'musl'
}): Promise<{ artifact: string; version: string; cached: boolean; sha256?: string; sizeBytes?: number }> {
  const tag = artifactTag(options.platform, options.arch, options.libc)
  const artifact = artifactName(options.version, tag)
  const hit = await cachedAssetIfReady(join(remoteAssetsCacheDir(), artifact))
  if (hit === undefined || hit.size <= 1024 * 1024) {
    return { artifact, version: options.version, cached: false }
  }
  return { artifact, version: options.version, cached: true, sha256: hit.sha256, sizeBytes: hit.size }
}

/**
 * Resolve the server package per policy. Every source lands in the same local
 * cache, so a policy change or a retry after a partial download never
 * re-fetches what is already on disk.
 *
 * `'reuse'` is accepted by the *type* only so the caller can pass the target's
 * effective source straight through: reuse never produces an artifact, so it is
 * refused loudly here instead of quietly building one (architecture §3.3/A11 —
 * a reuse failure must never become a silent 40 MB upload).
 */
export async function resolveServerPackage(options: {
  version: string
  platform: 'linux' | 'darwin'
  arch: 'x64' | 'arm64'
  libc: '' | 'gnu' | 'musl'
  policy: 'auto' | 'download' | 'upload' | 'reuse'
  mirror: string
  /** This plugin's version, so the `v<pluginVersion>` release tag is tried too. */
  pluginVersion?: string
  /** Cache directory override (tests); defaults to `~/.dsh/remote-assets`. */
  cacheDir?: string
  /** curl substitution (tests). */
  runner?: CurlRunner
  onProgress?: (message: string, detail?: string) => void
}): Promise<{ asset: CachedAsset; via: 'cache' | 'download' | 'build' }> {
  if (options.policy === 'reuse') {
    throw new Error('the "reuse" package source produces no server package; reuse is a provisioning mode, not an artifact source')
  }
  const notify = options.onProgress ?? (() => {})
  const tag = artifactTag(options.platform, options.arch, options.libc)
  const dir = options.cacheDir ?? remoteAssetsCacheDir()
  const cached = join(dir, artifactName(options.version, tag))
  const hit = await cachedAssetIfReady(cached)
  if (hit !== undefined) {
    notify(`server package ${options.version} cached (${(hit.size / 1024 / 1024).toFixed(1)} MB)`)
    return { asset: hit, via: 'cache' }
  }
  const errors: string[] = []
  for (const source of sourceOrder(options.policy)) {
    if (source === 'cache') continue
    try {
      if (source === 'download') {
        return { asset: await downloadServerPackage({ ...options }), via: 'download' }
      }
      return { asset: await buildDshRuntimePackage({ ...options, onProgress: notify }), via: 'build' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${source}: ${message}`)
      // The wording matters: with `download` still followed by `build`, the user
      // must be able to see that the release was missing *and* that a local build
      // took over (api-contract §3.3's `server package ready via build|cache`).
      notify(
        source === 'download'
          ? `release download failed: ${message}; falling back to a local build`
          : `local build failed; trying the next source`,
        message,
      )
    }
  }
  throw new Error(`could not obtain the server package ${artifactName(options.version, tag)}; attempts: ${errors.join(' ;; ')}`)
}
