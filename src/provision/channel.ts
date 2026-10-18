/**
 * Provisioning one remote execution world.
 *
 * ZCode-shaped, and **transport-agnostic** since WSL targets arrived: every
 * stage runs under `/bin/sh -c` with absolute paths against a `RemoteTransport`
 * (an ssh2 session, or a locally spawned `wsl.exe` in a Windows distribution),
 * and the far side never depends on its own PATH, login shell or package
 * manager for Node. The stages, each reported to the wizard:
 *
 * 1. **connect** — ssh2 with host-key verification (an unconfirmed key aborts
 *    with the fingerprint so the user can decide, a *changed* key always
 *    aborts). A WSL distro is a local process with no host key: it is proven
 *    reachable by running a command instead.
 * 2. **probe**   — one framed shell probe: `$HOME`, `uname` (+ostype
 *    correction), download tools, and the per-component markers.
 * 3. **runtime** — the Node *component*: skipped when the marker matches and
 *    the deployed binary verifies; otherwise the host-side cached tarball is
 *    uploaded with live progress, sha-checked, extracted in staging and
 *    atomically swapped in.
 * 4. **upload**  — the `dsh` component (installed from the host-staged package)
 *    plus this plugin's lib and the profile files, all marker-gated.
 * 5. **start**   — run the deployed `dsh --profile` on its stdio, which becomes
 *    the protocol channel.
 */
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fingerprintOf } from '../ssh/hostkey.ts'
import type { SshAuth } from '../ssh/connect.ts'
import { connectSshTransport, connectWslTransport, type RemoteTransport } from './transport.ts'
import { packageFiles, remoteProfileFiles, reuseServerCommand, serverCommand, shellQuote, PROFILE_PACKAGE_DIR } from './profile.ts'
import {
  acquireDeployLock,
  acquireProfileLock,
  checkDshScript,
  decideDsh,
  decidePlugin,
  extractNodeScript,
  installDshPackageScript,
  parseMarker,
  parseProbeOutput,
  parseReuseLauncherOutput,
  probeScript,
  profilePluginScript,
  releaseDeployLock,
  releaseProfileLock,
  reuseLauncherScript,
  runDeployScript,
  serverPath,
  sh,
  uploadNodeTarball,
  writeFiles,
  PROFILE_MARKER_FILE,
  type ProfilePluginMarker,
  type ReuseLauncherProbe,
  type RemoteEnvironment,
} from './deploy.ts'
import { artifactName, artifactTag, ensureNodeTarball, nodeArchKey, platformArch, resolveServerPackage, sha256OfFiles, NODE_VERSION_CANDIDATES, type CachedAsset } from './assets.ts'
import { planProvision } from './plan.ts'
import type { PluginMarker } from './deploy.ts'
import type { RemoteChannel, RemoteTargetKind, RemoteTargetRecord } from '../targets/types.ts'
import { scrubSecrets } from '../targets/types.ts'

/** Provisioning stages, surfaced verbatim to the wizard. */
export type ProvisionStep = 'connect' | 'probe' | 'runtime' | 'upload' | 'start'

/** Progress event emitted while connecting. */
export interface ProvisionEvent {
  readonly type: 'step' | 'host-key' | 'warn'
  readonly step?: ProvisionStep
  readonly status?: 'running' | 'ok' | 'failed'
  readonly message?: string
  readonly detail?: string
  readonly fingerprint?: string
}

/** Everything one provisioning attempt needs. */
export interface ProvisionRequest {
  readonly target: RemoteTargetRecord
  /** Password or key passphrase; undefined for agent authentication. */
  readonly secret?: string
  /** Loaded private key material. */
  readonly privateKey?: Buffer
  /** Absolute local plugin package root; its `lib/` is uploaded. */
  readonly packageRoot: string
  /** Fingerprint the user confirmed during *this* attempt. */
  readonly hostKeyFingerprint?: string
  /** Plugin-wide package-source policy and release mirror (from the store). */
  readonly packagePolicy?: { policy: 'auto' | 'download' | 'upload' | 'ask'; mirror: string }
  /**
   * The dsh launcher to reuse, when the effective package source is `reuse`.
   * The wizard's selection wins over the record; a tree 连接 passes the stored
   * `reuseDsh.path` instead.
   */
  readonly reuseLauncherPath?: string
  readonly signal?: AbortSignal
  readonly onEvent?: (event: ProvisionEvent) => void
}

/** A provisioned server channel plus the verified host-key fingerprint. */
export interface ProvisionResult {
  readonly channel: RemoteChannel
  /**
   * The verified host key, or `''` for a WSL target (a local distro has none —
   * the only transport where an empty fingerprint is legitimate).
   */
  readonly fingerprint: string
  readonly nodePath: string
  readonly dshPath: string
  readonly home: string
  readonly kind: RemoteTargetKind
  /** Architecture this run measured (the record's `platformProbe` hint). */
  readonly probe: { readonly platform: 'linux' | 'darwin'; readonly arch: 'x64' | 'arm64'; readonly libc: '' | 'gnu' | 'musl'; readonly tag: string }
  /** Present when the world was started from a dsh the host already had. */
  readonly reuse?: { readonly path: string; readonly version: string; readonly nodePath?: string }
  /**
   * The server package this run resolved and deployed (the record's
   * `serverPackage`). Absent in reuse mode — nothing was shipped there.
   */
  readonly package?: { readonly artifact: string; readonly sha256: string; readonly version: string }
}

/** Resolve a remote path that may start with `~`. */
export function expandRemoteHome(path: string, home: string): string {
  if (path === '~') return home
  if (path.startsWith('~/')) return `${home}/${path.slice(2)}`
  return path
}

/** Build the ssh2 authentication material for a target. */
export function authFor(target: RemoteTargetRecord, secret: string | undefined, privateKey: Buffer | undefined): SshAuth {
  if (target.authKind === 'password') {
    if (secret === undefined || secret === '') throw new Error(`remote target "${target.label}" has no stored password`)
    return { kind: 'password', password: secret }
  }
  if (target.authKind === 'privateKey') {
    if (privateKey === undefined) throw new Error(`remote target "${target.label}" has no readable private key`)
    return { kind: 'privateKey', privateKey, ...(secret === undefined ? {} : { passphrase: secret }) }
  }
  return { kind: 'agent' }
}

/**
 * The dsh release the remote must run: the harness's own version when known,
 * else the installed dsh-ssh helper version (same release train), else latest.
 *
 * Exported because `dsh-scan` reports which artifact *would* be uploaded for
 * this target's architecture, and that name has to match the one a real
 * deployment would resolve (`doc/api-contract.md` §9).
 */
export function dshReleaseVersion(packageRoot: string): string {
  const env = process.env.DSH_CLIENT_VERSION
  if (env !== undefined && env !== '') return env
  // The web profile installs the official ssh helpers as plain deps next to
  // this plugin, so the helper's version names the exact dsh release train.
  const candidates = [
    join(packageRoot, 'node_modules', '@deepseek-ai', 'dsh-ssh', 'package.json'),
    join(packageRoot, '..', '@deepseek-ai', 'dsh-ssh', 'package.json'),
  ]
  for (const candidate of candidates) {
    try {
      const helper = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: string }
      if (typeof helper.version === 'string' && helper.version !== '') return helper.version
    } catch {}
  }
  return 'latest'
}

/** Throttled percentage reporter: at most one line per second or 5% jump. */
function progressReporter(label: string, emit: (message: string) => void): (sent: number, total: number) => void {
  let lastAt = 0
  let lastPercent = -100
  return (sent, total) => {
    const percent = total === 0 ? 100 : Math.floor((sent / total) * 100)
    const now = Date.now()
    if (now - lastAt < 1000 && percent - lastPercent < 5 && percent !== 100) return
    lastAt = now
    lastPercent = percent
    const mb = (sent / 1024 / 1024).toFixed(1)
    const totalMb = (total / 1024 / 1024).toFixed(1)
    emit(`upload progress (${label}): ${percent.toFixed(1)}% (${mb}/${totalMb} MB)`)
  }
}

/**
 * Open the transport for one target, reporting the `connect` stage.
 *
 * The only place that knows how a target is reached: `wsl` spawns a local
 * distribution (no host key to verify), everything else is ssh2 with the pinned
 * fingerprint (an unconfirmed key throws `HostKeyUnknownError` from here).
 * @param request - target plus the credential material for this attempt.
 * @returns an open transport; the caller owns `close()`.
 */
export async function openTransport(request: ProvisionRequest): Promise<RemoteTransport> {
  const { target } = request
  const emit = (event: ProvisionEvent): void => { request.onEvent?.(event) }
  request.signal?.throwIfAborted()
  if (target.kind === 'wsl') {
    const distro = target.wslDistro ?? ''
    if (distro === '') throw new Error(`remote target "${target.label}" has no WSL distribution`)
    emit({ type: 'step', step: 'connect', status: 'running', message: `starting WSL distribution ${distro}` })
    const transport = connectWslTransport({ distro, ...(target.wslUser === undefined ? {} : { user: target.wslUser }) })
    // Prove the distro answers before spending the probe and deploy stages on
    // it; a Stopped distro starts on this call, which is what "connect" means.
    const check = await transport.exec('true', { maxBytes: 4096, timeoutMs: 30_000 })
    if (check.code !== 0) {
      await transport.close().catch(() => {})
      const detail = scrubSecrets(check.stderr.trim().slice(-2000))
      throw new Error(`cannot enter WSL distribution "${distro}" (exit ${check.code ?? 'signal'}): ${detail !== '' ? detail : 'no stderr output'}`)
    }
    emit({ type: 'step', step: 'connect', status: 'ok', message: `WSL ${distro}` })
    return transport
  }
  emit({ type: 'step', step: 'connect', status: 'running', message: `connecting to ${target.host}:${target.port}` })
  const auth = authFor(target, request.secret, request.privateKey)
  // An empty fingerprint means first contact: `connectSsh` then refuses with the
  // HostKeyUnknownError carrying the fingerprint the user must confirm.
  const pinned = request.hostKeyFingerprint ?? target.hostKeyFingerprint
  const transport = await connectSshTransport({
    host: target.host,
    port: target.port,
    username: target.username,
    auth,
    ...(pinned === '' ? {} : { hostKeyFingerprint: pinned }),
  })
  emit({ type: 'step', step: 'connect', status: 'ok' })
  return transport
}

/**
 * The package source actually in force for one target: the record's own choice
 * wins, otherwise the plugin-wide policy (`ask` behaves like `auto`, which is
 * what the store's schema documents).
 * @param target - stored target record.
 * @param policy - plugin-wide policy and mirror, when the caller passed one.
 */
export function effectivePackageSource(
  target: RemoteTargetRecord,
  policy: { policy: 'auto' | 'download' | 'upload' | 'ask' } | undefined,
): 'auto' | 'download' | 'upload' | 'reuse' {
  if (target.packageSource !== undefined && target.packageSource !== 'auto') return target.packageSource
  const global = policy?.policy ?? 'auto'
  return global === 'ask' ? 'auto' : global
}

/**
 * An error carrying the code the SSE `error` frame reports (api-contract §10).
 * Message is scrubbed here so no call site can forget it.
 */
function codedError(code: string, message: string): Error {
  const error = new Error(scrubSecrets(message))
  ;(error as { code?: string }).code = code
  return error
}

/** This plugin's own version, read from the package root it deploys from. */
async function pluginVersionOf(packageRoot: string): Promise<string> {
  try {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : ''
  } catch {
    return ''
  }
}

/**
 * The remote profile + plugin file set for one profile directory.
 *
 * Shared by the pipeline and by `dsh-scan` (which has to compare its digest against
 * the installed marker before the user commits to anything), so "is the plugin
 * current" is answered by exactly one construction of the file set — the digest
 * covers the absolute remote paths, so the two callers must build it identically.
 * @param packageRoot - local plugin package root.
 * @param profileDir - absolute remote profile directory.
 * @param profile - profile name (it is written into the profile's package.json).
 */
export async function profileFileSet(packageRoot: string, profileDir: string, profile: string): Promise<{ path: string; content: Buffer }[]> {
  const files: { path: string; content: Buffer }[] = []
  for (const [name, content] of remoteProfileFiles({ profile })) {
    files.push({ path: `${profileDir}/${name}`, content: Buffer.from(content, 'utf8') })
  }
  for (const file of await packageFiles(packageRoot)) {
    files.push({ path: `${profileDir}/${PROFILE_PACKAGE_DIR}/${file.path}`, content: file.content })
  }
  return files
}

/**
 * The absolute remote profile directory for one target.
 *
 * Both layouts keep the profile in the same directory: the packaged server also
 * runs with `DSH_HOME=<dshHome>`, so 打包 ↔ 复用 can be swapped without losing the
 * installed plugin — or the remote sessions, which live under
 * `DSH_HOME/remote-server-sessions` regardless of how dsh was installed.
 * @param dshHome - absolute remote `DSH_HOME`.
 * @param home - absolute remote home (used when `dshHome` is relative).
 * @param profile - profile name.
 */
export function profileDirFor(dshHome: string, home: string, profile: string): string {
  return isAbsolute(dshHome) ? `${dshHome}/profiles/${profile}` : `${join(home, dshHome)}/profiles/${profile}`
}

/**
 * Probe, deploy and start the remote server over an already-open transport.
 * @param transport - an open transport (ownership stays with the caller).
 * @param request - target, package policy and progress sink.
 * @returns the live channel and the deployment facts.
 */
export async function provisionOver(transport: RemoteTransport, request: ProvisionRequest): Promise<ProvisionResult> {
  const { target, onEvent } = request
  const emit = (event: ProvisionEvent): void => { onEvent?.(event) }
  const notify = (step: ProvisionStep, message: string, detail?: string): void => {
    emit({ type: 'step', step, status: 'running', message, ...(detail === undefined ? {} : { detail }) })
  }
  const signal = request.signal
  signal?.throwIfAborted()

  // ── probe ──────────────────────────────────────────────────────────────────
  emit({ type: 'step', step: 'probe', status: 'running', message: 'checking the remote host' })
  const probeResult = await transport.exec(sh(probeScript({ profile: target.remote.profile })), { maxBytes: 64 * 1024, timeoutMs: 30_000 })
  if (probeResult.code !== 0) {
    throw new Error(`remote probe failed (exit ${probeResult.code ?? 'signal'}): ${scrubSecrets(probeResult.stderr.slice(-2000))}`)
  }
  const facts = parseProbeOutput(probeResult.stdout)
  const home = facts.home
  if (home === '' || !home.startsWith('/')) {
    throw new Error(`cannot determine the remote home directory on ${target.host}`)
  }
  const env: RemoteEnvironment = { ...facts, platformArch: platformArch(facts.platform === 'darwin' ? 'darwin' : 'linux', nodeArchKey(facts.arch)) } as RemoteEnvironment
  const toolList = Object.entries(env.tools).filter(([, ok]) => ok).map(([name]) => name).join(', ')
  emit({
    type: 'step',
    step: 'probe',
    status: 'ok',
    message: `${env.platform}-${env.arch} at ${home}${toolList === '' ? '' : ` (tools: ${toolList})`}`,
  })

  const installHome = home
  const dshHome = expandRemoteHome(target.remote.dshHome, home)
  const profileName = target.remote.profile
  const platform: 'linux' | 'darwin' = env.platform === 'darwin' ? 'darwin' : 'linux'
  const arch: 'x64' | 'arm64' = env.arch === 'arm64' ? 'arm64' : 'x64'
  const tag = artifactTag(platform, arch, env.libc)
  // Both layouts keep the profile in the same directory: the packaged server also
  // runs with `DSH_HOME=<dshHome>`, so 打包 ↔ 复用 can be swapped without losing
  // the installed plugin — or the remote sessions, which live under
  // `DSH_HOME/remote-server-sessions` regardless of how dsh was installed.
  const profileDir = profileDirFor(dshHome, home, profileName)

  // ── plan: reuse the host's dsh, or package one ─────────────────────────────
  // A pure decision (`plan.ts`) so every outcome can be explained and tested; its
  // only input from the wire is one read-only probe of the selected launcher.
  const effective = effectivePackageSource(target, request.packagePolicy)
  const reuseLauncherPath = (request.reuseLauncherPath ?? '').trim()
  const reuseFacts: ReuseLauncherProbe | undefined = effective === 'reuse' && reuseLauncherPath !== ''
    ? parseReuseLauncherOutput(
        (await transport.exec(sh(reuseLauncherScript({ launcherPath: reuseLauncherPath, installHome })), { maxBytes: 16 * 1024, timeoutMs: 40_000 })).stdout,
        reuseLauncherPath,
      )
    : undefined
  const decision = planProvision({
    packageSource: effective,
    reuseLauncherPath,
    ...(reuseFacts === undefined ? {} : { reuse: reuseFacts }),
  })
  // No fallback: a failed reuse reports its code, it never becomes a silent
  // 25–50 MB upload (architecture A11).
  if (!decision.ok) throw codedError(decision.code, decision.message)
  const plan = decision.plan
  const lockToken = randomUUID()
  const pluginVersion = await pluginVersionOf(request.packageRoot)

  /**
   * The Node component, shared by both modes.
   *
   * A configured `remote.nodePath` wins and is not deployed at all; otherwise a
   * marker hit must still prove the binary runs, and only then is the
   * host-cached tarball uploaded.
   */
  const ensureNode = async (): Promise<{ binDir: string; version: string; external: boolean }> => {
    const override = target.remote.nodePath
    if (override !== '' && override !== 'node') {
      const overridePath = expandRemoteHome(override, home)
      const check = await transport.exec(sh(`p=${shellQuote(overridePath)}; if [ -x "$p" ]; then "$p" -v; else echo MISSING; fi`), { maxBytes: 256, timeoutMs: 20_000 })
      const version = check.stdout.trim()
      if (check.code === 0 && version.startsWith('v2')) {
        notify('runtime', `using the configured Node ${version} at ${overridePath}`)
        return { binDir: overridePath.slice(0, overridePath.lastIndexOf('/')), version, external: true }
      }
      notify('runtime', `the configured Node at ${overridePath} is not usable (${version || 'not executable'}); deploying a local one`)
    }
    const marker = env.node
    if (
      marker !== undefined &&
      (NODE_VERSION_CANDIDATES as readonly string[]).includes(marker.version) &&
      marker.platformArch === env.platformArch
    ) {
      // Marker plausible — prove the binary actually runs before skipping.
      const verify = await transport.exec(sh(`${shellQuote(serverPath(installHome, 'node/bin/node'))} -v`), { maxBytes: 64, timeoutMs: 20_000 })
      if (verify.code === 0 && verify.stdout.trim() === marker.version) {
        notify('runtime', `node ${marker.version} already deployed (marker match)`)
        return { binDir: serverPath(installHome, 'node/bin'), version: marker.version, external: false }
      }
      notify('runtime', `the deployed node does not verify (${verify.stdout.trim() || 'missing'}); redeploying`)
    }
    await acquireDeployLock(transport, installHome, lockToken)
    try {
      const asset: CachedAsset = await ensureNodeTarball({
        platform,
        arch,
        onProgress: (message, detail) => notify('runtime', message, detail),
      })
      notify('runtime', `uploading node ${asset.version} (${(asset.size / 1024 / 1024).toFixed(1)} MB)`)
      const upload = await uploadNodeTarball(transport, {
        home: installHome,
        content: await readFile(asset.path),
        version: asset.version,
        platformArch: env.platformArch,
      }, progressReporter('node', message => notify('runtime', message)))
      await runDeployScript(transport, extractNodeScript({
        home: installHome,
        version: asset.version,
        tarballName: upload.tarballName,
        distDir: upload.distDir,
        sha256: asset.sha256,
        platformArch: env.platformArch,
        shaTool: env.tools.sha256sum ? 'sha256sum' : '',
      }), { what: 'node deployment', timeoutMs: 300_000 })
      notify('runtime', `node ${asset.version} deployed to ${serverPath(installHome, 'node')}`)
      return { binDir: serverPath(installHome, 'node/bin'), version: asset.version, external: false }
    } finally {
      await releaseDeployLock(transport, installHome, lockToken)
    }
  }

  let dshPath = ''
  let startNode = ''
  let startCommand = ''
  let startMessage = ''
  /**
   * The artifact this run resolved and deployed, for the record's `serverPackage`.
   *
   * Only the packaging branch has one: reuse ships no archive at all, so the field
   * stays absent there instead of recording a hollow artifact name.
   */
  let deployedPackage: { artifact: string; sha256: string; version: string } | undefined

  if (plan.mode === 'package') {
    // ── runtime: the node component ──────────────────────────────────────────
    signal?.throwIfAborted()
    emit({ type: 'step', step: 'runtime', status: 'running', message: 'checking the deployed runtime' })
    const node = await ensureNode()
    startNode = node.external ? expandRemoteHome(target.remote.nodePath, home) : serverPath(installHome, 'node/bin/node')
    emit({ type: 'step', step: 'runtime', status: 'ok', message: node.external ? 'runtime ready (configured node)' : `node ${node.version} ready` })

    // ── upload: the dsh package (the profile part is shared, below) ──────────
    signal?.throwIfAborted()
    emit({ type: 'step', step: 'upload', status: 'running', message: 'preparing the dsh runtime package' })
    // The package is staged once on the host (exact harness version, target
    // platform pinned) and cached; a marker hit never even uploads it.
    const release = dshReleaseVersion(request.packageRoot)
    const policy = request.packagePolicy ?? { policy: 'auto' as const, mirror: '' }
    notify('upload', `server package required: ${artifactName(release, tag)}`)
    const { asset: pkg, via: pkgVia } = await resolveServerPackage({
      version: release,
      platform,
      arch,
      libc: env.libc,
      policy: effective,
      mirror: policy.mirror,
      onProgress: (message, detail) => notify('upload', message, detail),
    })
    notify('upload', `server package ready via ${pkgVia}`)
    deployedPackage = { artifact: artifactName(release, tag), sha256: pkg.sha256, version: release }
    let needDshInstall = decideDsh(env.dsh, release, pkg.sha256) !== 'skip'
    if (!needDshInstall) {
      // Marker plausible — the launcher must still answer before we skip.
      const check = await transport.exec(sh(checkDshScript({ home: installHome })), { maxBytes: 256, timeoutMs: 60_000 })
      const version = check.stdout.trim()
      if (check.code === 0 && version !== '') {
        notify('upload', `dsh ${version} already deployed (marker match)`)
      } else {
        notify('upload', 'the deployed dsh does not verify; redeploying')
        needDshInstall = true
      }
    }
    if (needDshInstall) {
      await acquireDeployLock(transport, installHome, lockToken)
      try {
        notify('upload', `uploading dsh ${release} package (${(pkg.size / 1024 / 1024).toFixed(1)} MB)`)
        const tarballName = `dsh-runtime-${release}-${env.platformArch}.tar.gz`
        const tarballPath = serverPath(installHome, `staging/${tarballName}`)
        await transport.writeFile(tarballPath, await readFile(pkg.path), progressReporter('dsh', message => notify('upload', message)))
        await runDeployScript(transport, installDshPackageScript({
          home: installHome,
          version: release,
          sha256: pkg.sha256,
          tarballName,
        }), { what: 'dsh package deployment', timeoutMs: 300_000 })
        notify('upload', `dsh ${release} deployed`, serverPath(installHome, 'dsh/node_modules/.bin/dsh'))
      } finally {
        await releaseDeployLock(transport, installHome, lockToken)
      }
    }
    dshPath = serverPath(installHome, 'dsh/node_modules/.bin/dsh')
    startCommand = serverCommand({ home: dshHome, installHome, profile: profileName })
    startMessage = `starting profile ${profileName}`
  } else {
    // ── reuse: neither Node nor the dsh package is uploaded ──────────────────
    signal?.throwIfAborted()
    emit({ type: 'step', step: 'runtime', status: 'running', message: `checking the selected launcher ${plan.launcher.path}` })
    let nodePath = plan.launcher.nodePath
    let ownNodeVersion = ''
    if (plan.deployRuntime) {
      // Neither the host nor a previous deployment can interpret this launcher,
      // so our own Node becomes the interpreter. A failure here is a *reuse*
      // failure with its own code (api-contract §10), never a packaging retry.
      try {
        const node = await ensureNode()
        nodePath = `${node.binDir}/node`
        ownNodeVersion = node.version
      } catch (error) {
        throw codedError(
          'reuse-node-missing',
          `the selected dsh ${plan.launcher.path} needs Node and none could be deployed: ${scrubSecrets(error instanceof Error ? error.message : String(error))}`,
        )
      }
    }
    startNode = nodePath ?? ''
    const reuseMessage = ownNodeVersion === ''
      ? `复用远端 dsh ${plan.launcher.version}（跳过 Node 与 dsh 部署）`
      : `复用远端 dsh ${plan.launcher.version}（自带 Node ${ownNodeVersion}）`
    emit({ type: 'step', step: 'runtime', status: 'ok', message: reuseMessage })
    emit({ type: 'step', step: 'upload', status: 'running', message: `preparing the server profile at ${profileDir}` })
    dshPath = plan.launcher.path
    startCommand = reuseServerCommand({
      dshHome,
      launcher: plan.launcher.path,
      profile: profileName,
      ...(nodePath === undefined ? {} : { nodePath }),
    })
    startMessage = `复用启动器 ${plan.launcher.path}`
  }

  // ── profile + plugin (both modes: this *is* 自动安装 server 插件) ────────────
  signal?.throwIfAborted()
  const profileFiles = await profileFileSet(request.packageRoot, profileDir, profileName)
  const pluginSha = await sha256OfFiles(profileFiles)
  // Which marker speaks for the installed plugin: reuse mode reads the marker
  // inside the profile directory; the packaging marker the probe already read
  // stays the fallback, so a deployment made by an older client (or by the
  // packaging path) never looks uninstalled.
  const profileMarker = plan.mode === 'reuse'
    ? parseMarker<ProfilePluginMarker>(
        (await transport.exec(sh(`cat ${shellQuote(`${profileDir}/${PROFILE_MARKER_FILE}`)} 2>/dev/null || true`), { maxBytes: 4096, timeoutMs: 15_000 })).stdout,
      )
    : undefined
  const installedMarker: PluginMarker | undefined = plan.mode === 'reuse'
    ? (profileMarker === undefined ? env.plugin : { id: 'plugin', sha256: profileMarker.sha256 })
    : env.plugin
  let pluginOutcome = ''
  if (decidePlugin(installedMarker, pluginSha) === 'skip') {
    pluginOutcome = 'server 插件已是最新（marker 命中）'
    notify('upload', pluginOutcome)
  } else {
    notify('upload', plan.mode === 'reuse'
      ? `远端 dsh 未安装 server 插件，正在安装（${profileFiles.length} 个文件）`
      : `uploading profile and plugin (${profileFiles.length} files)`)
    // A reused dsh's profile is shared by every device pointing at this host, so
    // the file-set write is serialized with the profile lock; the packaging path
    // keeps its own `.deploy.lock` semantics (unchanged) around the dsh package.
    if (plan.mode === 'reuse') await acquireProfileLock(transport, profileDir, lockToken)
    try {
      await writeFiles(transport, profileFiles)
      if (plan.mode === 'package') {
        // Unchanged marker: the probe and older clients read this one.
        const markerScript = [
          'set -eu',
          `printf %s ${shellQuote(`${JSON.stringify({ id: 'plugin', sha256: pluginSha })}\n`)} > ${shellQuote(serverPath(installHome, '.components/plugin.json'))}`,
        ].join('\n')
        await transport.exec(sh(markerScript), { maxBytes: 4096, timeoutMs: 15_000 })
      }
      // Written in both modes: this is the only place a *reused* dsh's profile
      // records the plugin, and it is what `dsh-scan` reads back.
      await transport.exec(sh(profilePluginScript({ profileDir, sha256: pluginSha, version: pluginVersion, profile: profileName })), { maxBytes: 4096, timeoutMs: 15_000 })
      notify('upload', `profile written to ${profileDir}`)
    } finally {
      if (plan.mode === 'reuse') await releaseProfileLock(transport, profileDir, lockToken)
    }
    pluginOutcome = `server 插件 ${pluginVersion} 已安装（profile ${profileName}）`
    notify('upload', pluginOutcome)
  }
  emit({ type: 'step', step: 'upload', status: 'ok', message: `${pluginOutcome}；dsh at ${dshPath}` })

  // ── start ──────────────────────────────────────────────────────────────────
  signal?.throwIfAborted()
  emit({ type: 'step', step: 'start', status: 'running', message: startMessage })
  const handle = await transport.openChannel(startCommand)
  // Liveness: the process is attached before it even loads, so "ok" here would
  // be a lie if the server dies on boot. Wait out the crash window and surface
  // the stderr tail instead of caching a zombie.
  const survivor = await Promise.race([
    handle.exited.then(code => ({ alive: false as const, code })),
    new Promise<{ alive: true }>(resolveAlive => setTimeout(() => resolveAlive({ alive: true }), 8_000)),
  ])
  if (!survivor.alive) {
    const tail = handle.diagnostics()
    if (plan.mode === 'reuse') {
      // The launcher ran, but the world did not come up (plugin mount failure,
      // wrong DSH_HOME, a dsh this plugin cannot drive): name it and point at
      // the way out instead of letting the wizard retry into the same wall.
      throw codedError(
        'reuse-boot-failed',
        `the reused dsh exited during startup (code ${survivor.code}): ${tail !== '' ? tail : 'no stderr captured'}; use 「上传 server 包」 instead`,
      )
    }
    throw new Error(`the remote server exited during startup (code ${survivor.code}): ${tail !== '' ? tail : 'no stderr captured'}`)
  }
  emit({ type: 'step', step: 'start', status: 'ok' })
  return {
    channel: handle.channel,
    fingerprint: request.hostKeyFingerprint ?? target.hostKeyFingerprint,
    nodePath: startNode,
    dshPath,
    home,
    kind: target.kind,
    probe: { platform, arch, libc: env.libc, tag },
    ...(deployedPackage === undefined ? {} : { package: deployedPackage }),
    ...(plan.mode === 'reuse'
      ? {
          reuse: {
            path: plan.launcher.path,
            version: plan.launcher.version,
            ...(startNode === '' ? {} : { nodePath: startNode }),
          },
        }
      : {}),
  }
}

/**
 * Connect, probe, deploy and start the remote server.
 * @param request - target, credentials and progress sink.
 * @returns the channel and the verified host-key fingerprint (`''` for WSL).
 * @throws HostKeyUnknownError on first contact, HostKeyMismatchError on a changed key.
 */
export async function provisionTarget(request: ProvisionRequest): Promise<ProvisionResult> {
  const transport = await openTransport(request)
  try {
    return await provisionOver(transport, request)
  } catch (error) {
    // The caller only keeps a transport when provisioning succeeded (the
    // returned channel closes it); everything else must not leak a session.
    await transport.close().catch(() => {})
    throw error
  }
}

/** Verify a candidate fingerprint without connecting, for the wizard's confirmation panel. */
export function describeFingerprint(key: Buffer): string {
  return fingerprintOf(key)
}

/** Read a local private key file for a target, expanding `~`. */
export async function readPrivateKey(path: string): Promise<Buffer> {
  const expanded = path.startsWith('~/') ? join(homedir(), path.slice(2)) : resolve(path)
  return await readFile(expanded)
}

/** Quote one value for a POSIX shell, exported for the wizard's mkdir command. */
export { shellQuote }
