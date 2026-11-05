/**
 * The probe line must report observations, and Node/DSH are two of them.
 *
 * The user-facing requirement: "远端环境是什么、运行时是否存在、存在的话是什么
 * 版本" — and a global DSH that exists but is not the verified version must be
 * reported as unusable instead of silently triggering an isolated runtime.
 */
import { describe, expect, it } from 'vitest'
import { remoteSetupFacts, type SetupFactsInput } from '../src/provision/setup-facts.ts'

const WINDOWS_SCAN = {
  platform: 'Windows',
  machine: 'AMD64',
  nodes: [{ path: 'C:\\Program Files\\nodejs\\node.exe', version: 'v22.18.0' }],
  launchers: [
    {
      path: 'C:\\Users\\tester\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd',
      realPath: 'C:\\Users\\tester\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd',
      version: '0.2.1-rc.1',
      exitCode: 0,
    },
  ],
} as unknown as SetupFactsInput['scan']

function input(patch: Partial<SetupFactsInput>): SetupFactsInput {
  return {
    scan: WINDOWS_SCAN,
    dshHome: 'C:\\Users\\tester\\.dsh',
    expectedDsh: '0.2.1-rc.3',
    forcedIsolated: false,
    runtime: { kind: 'isolated', action: 'install', version: '0.2.1-rc.3' },
    plugin: { action: 'install', version: '0.1.0-alpha.4' },
    ...patch,
  }
}

describe('remote setup facts', () => {
  it('reports Node and DSH separately, and says why the global DSH is unusable', () => {
    const facts = remoteSetupFacts(input({}))
    expect(facts).toContain('远端环境 Windows AMD64')
    expect(facts).toContain('Node v22.18.0（C:\\Program Files\\nodejs\\node.exe）')
    expect(facts).toContain('server 全局 DSH 0.2.1-rc.1')
    expect(facts).toContain('不可用，需要 0.2.1-rc.3')
    expect(facts).toContain('DSH_HOME C:\\Users\\tester\\.dsh')
    expect(facts).toContain('隔离运行时 未安装')
    expect(facts).toContain('server 插件 未安装')
    expect(facts).not.toContain('部署')
  })

  it('reports a reusable global DSH with its Node version', () => {
    const facts = remoteSetupFacts(input({
      scan: { ...WINDOWS_SCAN, launchers: [{ ...WINDOWS_SCAN.launchers[0]!, version: '0.2.1-rc.3' }] },
      runtime: { kind: 'global', action: 'reuse', version: '0.2.1-rc.3', nodeVersion: 'v24.21.0' },
      plugin: { action: 'reuse', version: '0.1.0-alpha.4', installedVersion: '0.1.0-alpha.4' },
    }))
    expect(facts).toContain('server 全局 DSH 0.2.1-rc.3')
    expect(facts).toContain('可用')
    expect(facts).toContain('server 全局 DSH 0.2.1-rc.3（Node v24.21.0）')
    expect(facts).toContain('server 插件 0.1.0-alpha.4')
  })

  it('says when a usable global DSH is skipped on purpose', () => {
    const facts = remoteSetupFacts(input({
      scan: { ...WINDOWS_SCAN, launchers: [{ ...WINDOWS_SCAN.launchers[0]!, version: '0.2.1-rc.3' }] },
      forcedIsolated: true,
    }))
    expect(facts).toContain('可用，本次按设置改用隔离运行时')
  })

  it('reports an installed isolated runtime version and a plugin upgrade', () => {
    const facts = remoteSetupFacts(input({
      scan: { ...WINDOWS_SCAN, launchers: [] },
      runtime: { kind: 'isolated', action: 'reuse', version: '0.2.1-rc.3', installedVersion: '0.2.1-rc.3', nodeVersion: 'v24.21.0' },
      plugin: { action: 'upgrade', version: '0.1.0-alpha.4', installedVersion: '0.1.0-alpha.3' },
    }))
    expect(facts).toContain('server 全局 DSH 未找到')
    expect(facts).toContain('隔离运行时 0.2.1-rc.3（Node v24.21.0）')
    expect(facts).toContain('server 插件 0.1.0-alpha.3（需更新到 0.1.0-alpha.4）')
  })

  it('reports a POSIX server without a global DSH and without Node on PATH', () => {
    const facts = remoteSetupFacts(input({
      scan: { platform: 'Linux', machine: 'x86_64', nodes: [], launchers: [] } as unknown as SetupFactsInput['scan'],
    }))
    expect(facts).toContain('远端环境 Linux x86_64')
    expect(facts).toContain('Node 未找到')
    expect(facts).toContain('server 全局 DSH 未找到')
  })
})
