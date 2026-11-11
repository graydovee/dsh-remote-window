/**
 * The one-line inventory the probe step reports.
 *
 * It answers "what does the server already have?" and nothing else: the steps
 * below it report what the client then does. Keeping it a pure function keeps
 * the wording testable without a live server, and keeps Node and DSH separate —
 * a server can have Node without a usable DSH, and a DSH launcher whose version
 * this client does not support.
 */
import type { DshScan } from './dsh-scan.ts'
import { isCompatibleDsh } from './version-range.ts'

/** The runtime finding the probe decided on. */
export interface SetupRuntimeFact {
  readonly kind: 'isolated' | 'global'
  readonly action: 'reuse' | 'install' | 'upgrade'
  readonly version: string
  readonly installedVersion?: string
  readonly nodeVersion?: string
}

/** The server-plugin finding the probe decided on. */
export interface SetupPluginFact {
  readonly action: 'reuse' | 'install' | 'upgrade'
  readonly version: string
  readonly installedVersion?: string
}

/** Everything the facts line needs, all read before any deployment starts. */
export interface SetupFactsInput {
  readonly scan: Pick<DshScan, 'platform' | 'machine' | 'nodes' | 'launchers'>
  readonly dshHome: string
  readonly expectedDsh: string
  /** True when the caller asked for an isolated runtime regardless of the server. */
  readonly forcedIsolated: boolean
  readonly runtime: SetupRuntimeFact
  readonly plugin: SetupPluginFact
}

/**
 * Build the probe observations, one entry per fact.
 *
 * The progress row shows them as separate lines (each observation is its own
 * sentence: environment, Node, global DSH, DSH_HOME, runtime, plugin).
 * @param input - the findings gathered during the probe.
 * @returns the observations in reading order.
 */
export function remoteSetupFactLines(input: SetupFactsInput): readonly string[] {
  const platformLabel = [input.scan.platform ?? '', input.scan.machine ?? ''].filter(part => part !== '').join(' ')
  const node = [...input.scan.nodes].find(candidate => candidate.version !== '') ?? input.scan.nodes[0]
  const nodeFact = node === undefined
    ? 'Node 未找到'
    : `Node ${node.version === '' ? '版本未知' : node.version}（${node.path}）`
  const usable = [...input.scan.launchers].find(candidate => candidate.version !== '' && isCompatibleDsh(candidate.version))
  const launcher = usable ?? input.scan.launchers[0]
  const dshFact = launcher === undefined
    ? 'server 全局 DSH 未找到'
    : launcher.version === ''
      ? `server 全局 DSH 版本未知（${launcher.path}）`
      : isCompatibleDsh(launcher.version)
        ? `server 全局 DSH ${launcher.version}（${launcher.path}）${input.forcedIsolated ? '可用，本次按设置改用隔离运行时' : '可用'}`
        : `server 全局 DSH ${launcher.version}（${launcher.path}）不可用，需要 ${input.expectedDsh}`
  const nodeSuffix = input.runtime.nodeVersion === undefined || input.runtime.nodeVersion === ''
    ? ''
    : `（Node ${input.runtime.nodeVersion}）`
  const runtimeFact = input.runtime.kind === 'global'
    ? `server 全局 DSH ${input.runtime.version}${nodeSuffix}`
    : input.runtime.action === 'reuse'
      ? `隔离运行时 ${input.runtime.installedVersion ?? input.runtime.version}${nodeSuffix}`
      : input.runtime.action === 'upgrade'
        ? `隔离运行时 ${input.runtime.installedVersion ?? '旧版本'}（需更新到 ${input.runtime.version}）`
        : '隔离运行时 未安装'
  const pluginFact = input.plugin.action === 'reuse'
    ? `server 插件 ${input.plugin.installedVersion ?? input.plugin.version}`
    : input.plugin.action === 'upgrade'
      // A rebuilt tarball keeps its version and changes its sha256; saying
      // "0.1.0-alpha.7 需更新到 0.1.0-alpha.7" reads like a bug.
      ? input.plugin.installedVersion === input.plugin.version
        ? `server 插件 ${input.plugin.version}（内容已更新，将重装）`
        : `server 插件 ${input.plugin.installedVersion ?? '旧版本'}（需更新到 ${input.plugin.version}）`
      : 'server 插件 未安装'
  return [
    `远端环境 ${platformLabel === '' ? '未知' : platformLabel}`,
    nodeFact,
    dshFact,
    `DSH_HOME ${input.dshHome}`,
    runtimeFact,
    pluginFact,
  ]
}

/**
 * The same observations on one line.
 *
 * Used where only one line fits (the connect log); the progress row renders
 * {@link remoteSetupFactLines} as one row per observation instead.
 * @param input - the findings gathered during the probe.
 * @returns the observations separated by ` · `.
 */
export function remoteSetupFacts(input: SetupFactsInput): string {
  return remoteSetupFactLines(input).join(' · ')
}
