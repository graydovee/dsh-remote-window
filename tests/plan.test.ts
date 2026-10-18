/**
 * `planProvision`: the reuse-vs-package decision.
 *
 * The two rules worth locking down: a refused reuse **never** degrades into an
 * upload (that would push 25–50 MB over the user's link without consent), and a
 * launcher whose interpreter is missing is still a *reuse* plan — it just asks
 * the pipeline to deploy Node (`deployRuntime`), which is the measured
 * Ubuntu-22.04 shape of the uploaded dsh shim.
 */
import { describe, expect, it } from 'vitest'
import { planProvision, type ReuseLauncherFacts } from '../src/provision/plan.ts'

/** Facts for a healthy nvm-installed dsh. */
function facts(overrides: Partial<ReuseLauncherFacts> = {}): ReuseLauncherFacts {
  const path = '/home/u/.nvm/versions/node/v24.4.0/bin/dsh'
  return {
    path,
    realPath: '/home/u/.nvm/versions/node/v24.4.0/lib/node_modules/@deepseek-ai/dsh/bin/dsh.js',
    exists: true,
    executable: true,
    version: '0.2.1-rc.2',
    exitCode: 0,
    nodePath: '/home/u/.nvm/versions/node/v24.4.0/bin/node',
    hasShebang: true,
    ...overrides,
  }
}

describe('planProvision', () => {
  it('packages when the source is not reuse', () => {
    for (const packageSource of [undefined, 'auto', 'upload', 'download'] as const) {
      expect(planProvision({ packageSource })).toEqual({ ok: true, plan: { mode: 'package' } })
    }
  })

  it('reuses a healthy launcher with the interpreter the host already has', () => {
    const reuse = facts()
    const decision = planProvision({ packageSource: 'reuse', reuseLauncherPath: reuse.path, reuse })
    expect(decision).toEqual({
      ok: true,
      plan: {
        mode: 'reuse',
        launcher: {
          path: reuse.path,
          realPath: reuse.realPath,
          version: '0.2.1-rc.2',
          nodePath: '/home/u/.nvm/versions/node/v24.4.0/bin/node',
          selfContained: false,
        },
        deployRuntime: false,
      },
    })
  })

  it('treats a native launcher as self-contained', () => {
    const reuse = facts({ hasShebang: false, nodePath: undefined, realPath: '/usr/local/bin/dsh' })
    const decision = planProvision({ packageSource: 'reuse', reuseLauncherPath: reuse.path, reuse })
    expect(decision.ok).toBe(true)
    if (!decision.ok || decision.plan.mode !== 'reuse') throw new Error('expected a reuse plan')
    expect(decision.plan.launcher.selfContained).toBe(true)
    expect(decision.plan.launcher.nodePath).toBeUndefined()
    expect(decision.plan.deployRuntime).toBe(false)
  })

  it('deploys our own Node when a script launcher has none anywhere', () => {
    const reuse = facts({ nodePath: undefined, deployedNode: undefined })
    const decision = planProvision({ packageSource: 'reuse', reuseLauncherPath: reuse.path, reuse })
    expect(decision.ok).toBe(true)
    if (!decision.ok || decision.plan.mode !== 'reuse') throw new Error('expected a reuse plan')
    expect(decision.plan.deployRuntime).toBe(true)
    expect(decision.plan.launcher.selfContained).toBe(false)
  })

  it('uses an already-deployed Node for a /bin/sh shim instead of redeploying', () => {
    // The uploaded `.bin/dsh` is `#!/bin/sh` + `exec node`; the plain scan finds
    // the deployed Node and hands it back as `deployedNode`.
    const reuse = facts({
      path: '/home/u/.dsh/server/dsh/node_modules/.bin/dsh',
      realPath: '/home/u/.dsh/server/dsh/node_modules/.bin/dsh',
      nodePath: undefined,
      deployedNode: '/home/u/.dsh/server/node/bin/node',
    })
    const decision = planProvision({ packageSource: 'reuse', reuseLauncherPath: reuse.path, reuse })
    expect(decision.ok).toBe(true)
    if (!decision.ok || decision.plan.mode !== 'reuse') throw new Error('expected a reuse plan')
    expect(decision.plan.deployRuntime).toBe(false)
    expect(decision.plan.launcher.nodePath).toBe('/home/u/.dsh/server/node/bin/node')
  })

  it('refuses without a selected path', () => {
    const decision = planProvision({ packageSource: 'reuse', reuseLauncherPath: '  ' })
    expect(decision).toMatchObject({ ok: false, code: 'reuse-launcher-missing' })
  })

  it('refuses when the facts belong to a different launcher', () => {
    const reuse = facts()
    const decision = planProvision({ packageSource: 'reuse', reuseLauncherPath: '/other/dsh', reuse })
    expect(decision).toMatchObject({ ok: false, code: 'reuse-launcher-missing' })
  })

  it('refuses a launcher that vanished', () => {
    const reuse = facts({ exists: false })
    const decision = planProvision({ packageSource: 'reuse', reuseLauncherPath: reuse.path, reuse })
    expect(decision).toMatchObject({ ok: false, code: 'reuse-launcher-missing' })
    if (decision.ok) throw new Error('expected a refusal')
    expect(decision.message).toContain('does not exist')
  })

  it('refuses a launcher without the execute bit', () => {
    const reuse = facts({ executable: false })
    const decision = planProvision({ packageSource: 'reuse', reuseLauncherPath: reuse.path, reuse })
    expect(decision).toMatchObject({ ok: false, code: 'reuse-launcher-missing' })
  })

  it('refuses an out-of-window version and names the floor', () => {
    const reuse = facts({ version: '0.1.9' })
    const decision = planProvision({ packageSource: 'reuse', reuseLauncherPath: reuse.path, reuse })
    expect(decision).toMatchObject({ ok: false, code: 'dsh-incompatible' })
    if (decision.ok) throw new Error('expected a refusal')
    expect(decision.message).toContain('0.1.9')
    expect(decision.message).toContain('0.2.1-rc.2')
  })

  it('refuses a launcher that cannot report a version at all', () => {
    const reuse = facts({ version: '', exitCode: 127 })
    const decision = planProvision({ packageSource: 'reuse', reuseLauncherPath: reuse.path, reuse })
    expect(decision).toMatchObject({ ok: false, code: 'dsh-incompatible' })
    if (decision.ok) throw new Error('expected a refusal')
    expect(decision.message).toContain('exit 127')
    expect(decision.message).toContain('no version')
  })

  it('never turns a refused reuse into a package plan', () => {
    const reuse = facts({ version: '1.2.3' })
    const decision = planProvision({ packageSource: 'reuse', reuseLauncherPath: reuse.path, reuse })
    expect(decision.ok).toBe(false)
  })
})
