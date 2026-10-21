/**
 * Step 3 performs the read-only probe **on entry**, and the runtime list is the
 * result — not a choice made before the host was ever contacted.
 *
 * These assertions pin the store half of that flow: entering step 3 starts the
 * scan (once per identity), a fresh scan reconciles/preselects the runtime
 * choice, an identity edit invalidates both, and a failed scan is reported
 * without retrying itself in a loop.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const STATE = {
  targets: [],
  workspaceRefs: [],
  serverWorkspaces: {},
  pluginVersion: '0.1.0-alpha.1',
  verifiedRuntimes: ['0.2.1-rc.2'],
  defaultProfile: 'remote-server',
  platform: 'darwin',
}

const spies = vi.hoisted(() => ({
  dshScan: vi.fn(),
  state: vi.fn(),
  aliasPrefill: vi.fn(),
}))

vi.mock('react', () => ({
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  useEffect: () => {},
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => {}],
}))

vi.mock('../src/client/api.ts', () => ({
  api: {
    state: spies.state,
    dshScan: spies.dshScan,
    aliasPrefill: spies.aliasPrefill,
  },
  openConnectStream: vi.fn(() => () => {}),
  toWireError: (error: unknown) => ({
    code: (error as { code?: string })?.code ?? 'internal',
    message: error instanceof Error ? error.message : String(error),
  }),
  RemoteApiError: class RemoteApiError extends Error {
    code = 'internal'
  },
}))

/** One usable scan candidate. */
const CANDIDATE = {
  path: '/usr/local/bin/dsh',
  realPath: '/usr/local/bin/dsh',
  version: '0.2.1-rc.2',
  compatible: true,
  executable: true,
  selfContained: true,
}

/** A `stage: 'done'` scan answer. */
function scanDone(candidates: unknown[] = [CANDIDATE]) {
  return {
    stage: 'done',
    probe: { platform: 'linux', arch: 'x64', libc: 'gnu', tag: 'linux-x64-gnu', home: '/home/tester', tools: {} },
    package: { artifact: 'dsh-remote-server-0.2.1-rc.2-linux-x64-gnu.tar.gz', version: '0.2.1-rc.2', cached: false },
    dshHome: '/home/tester/.dsh',
    profiles: [],
    candidates,
  }
}

/** A fresh store module (module-level state must not leak between cases). */
async function loadStore(): Promise<typeof import('../src/client/store.ts')> {
  vi.resetModules()
  return await import('../src/client/store.ts')
}

/** Fill in one valid ssh draft. */
function draft(store: Awaited<ReturnType<typeof loadStore>>, host = '203.0.113.10'): void {
  store.store.setMethod('ssh')
  store.store.patchConfig({
    label: 'dev-box',
    host,
    port: '22',
    username: 'tester',
    authKind: 'password',
    secret: 'pw',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  spies.state.mockResolvedValue(STATE)
})

describe('scan on entering step 3', () => {
  it('starts the probe when the step opens and only once per identity', async () => {
    spies.dshScan.mockResolvedValue(scanDone())
    const store = await loadStore()
    draft(store)
    store.store.setStep('connect')
    await vi.waitFor(() => { expect(spies.dshScan).toHaveBeenCalledTimes(1) })
    expect(spies.dshScan.mock.calls[0]?.[0]).toMatchObject({ host: '203.0.113.10', username: 'tester', secret: 'pw' })

    // A second entry with the same identity must not rescan.
    store.store.setStep('connect')
    await Promise.resolve()
    expect(spies.dshScan).toHaveBeenCalledTimes(1)
  })

  it('preselects the best reusable runtime after the scan', async () => {
    spies.dshScan.mockResolvedValue(scanDone([
      { ...CANDIDATE, path: '/opt/old/dsh', realPath: '/opt/old/dsh', compatible: false },
      CANDIDATE,
    ]))
    const store = await loadStore()
    draft(store)
    store.store.setStep('connect')
    await vi.waitFor(() => { expect(store.useAppState().dshScan.status).toBe('ready') })
    expect(store.useAppState().config.runtimeChoice).toEqual({ kind: 'reuse', path: CANDIDATE.path })
  })

  it('leaves the choice empty when the scan finds nothing usable', async () => {
    spies.dshScan.mockResolvedValue(scanDone([{ ...CANDIDATE, compatible: false }]))
    const store = await loadStore()
    draft(store)
    store.store.setStep('connect')
    await vi.waitFor(() => { expect(store.useAppState().dshScan.status).toBe('ready') })
    expect(store.useAppState().config.runtimeChoice).toBeNull()
  })
})

describe('identity edits invalidate the probe', () => {
  it('drops the scan and the runtime choice, then rescans on re-entry', async () => {
    spies.dshScan.mockResolvedValue(scanDone())
    const store = await loadStore()
    draft(store)
    store.store.setStep('connect')
    await vi.waitFor(() => { expect(store.useAppState().dshScan.status).toBe('ready') })

    store.store.patchConfig({ host: '203.0.113.11' })
    expect(store.useAppState().dshScan.status).toBe('idle')
    expect(store.useAppState().config.runtimeChoice).toBeNull()

    store.store.setStep('connect')
    await vi.waitFor(() => { expect(spies.dshScan).toHaveBeenCalledTimes(2) })
  })
})

describe('a deploy choice survives a rescan', () => {
  it('keeps 远程下载 selected instead of collapsing back to reuse', async () => {
    spies.dshScan.mockResolvedValue(scanDone())
    const store = await loadStore()
    draft(store)
    store.store.setStep('connect')
    await vi.waitFor(() => { expect(store.useAppState().dshScan.status).toBe('ready') })

    store.store.chooseDeploy('download')
    expect(store.useAppState().config.runtimeChoice).toEqual({ kind: 'download' })

    store.store.scanDsh(true)
    await vi.waitFor(() => { expect(spies.dshScan).toHaveBeenCalledTimes(2) })
    await vi.waitFor(() => { expect(store.useAppState().dshScan.status).toBe('ready') })
    expect(store.useAppState().config.runtimeChoice).toEqual({ kind: 'download' })
  })
})

describe('a failed probe is reported, not retried', () => {
  it('lands in the wizard as an error with no automatic second call', async () => {
    spies.dshScan.mockRejectedValue(new Error('cannot reach 203.0.113.10:22'))
    const store = await loadStore()
    draft(store)
    store.store.setStep('connect')
    await vi.waitFor(() => { expect(store.useAppState().dshScan.status).toBe('unavailable') })
    expect(store.useAppState().dshScan.error).toContain('cannot reach')
    await Promise.resolve()
    expect(spies.dshScan).toHaveBeenCalledTimes(1)
  })
})
