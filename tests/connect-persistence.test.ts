/**
 * "Persist only after a successful connect" (api-contract §2.1).
 *
 * The measured defect this pins: the host-key confirmation used to write the
 * target immediately, so a later failure (wrong password, probe error, start
 * failure) left a target behind with **no credential** — and its row in the tree
 * could only report `remote target "…" has no stored password`, with no action
 * to repair it. The pipeline is injected here so each failure mode is exact.
 */
import { describe, expect, it, vi } from 'vitest'
import { HostKeyUnknownError } from '../src/ssh/hostkey.ts'
import { RemoteWorkspaces, type ConnectRequest } from '../src/provision/service.ts'
import type { ProvisionResult } from '../src/provision/channel.ts'
import type { RemoteTargetRecord } from '../src/targets/types.ts'

/** A provisioning result good enough for the success path. */
function provisioned(): ProvisionResult {
  return {
    channel: {} as ProvisionResult['channel'],
    fingerprint: 'SHA256:confirmed',
    nodePath: '/usr/bin/node',
    dshPath: '/home/tester/.dsh/bin/dsh',
    home: '/home/tester',
    kind: 'ssh',
    probe: { platform: 'linux', arch: 'x64', libc: 'gnu', tag: 'linux-x64-gnu' },
  }
}

/** Minimal TargetStore face: records in an array, writes recorded. */
function fakeStore(): {
  store: Record<string, unknown>
  putTarget: ReturnType<typeof vi.fn>
  storeSecret: ReturnType<typeof vi.fn>
  records: RemoteTargetRecord[]
} {
  const records: RemoteTargetRecord[] = []
  const putTarget = vi.fn(async (record: RemoteTargetRecord) => {
    records.push(record)
    return record
  })
  const storeSecret = vi.fn(async (record: RemoteTargetRecord) => ({ ...record, credentialKey: `remote-workspace/${record.id}` }))
  return {
    records,
    putTarget,
    storeSecret,
    store: {
      listTargets: () => records,
      target: (id: string) => records.find(record => record.id === id),
      secretOf: async () => undefined,
      packagePolicy: () => ({ policy: 'auto' as const, mirror: '' }),
      putTarget,
      storeSecret,
      credentialKeyOf: (record: RemoteTargetRecord) => (record.credentialKey === undefined ? undefined : { scope: 'remote-workspace', id: record.id }),
    },
  }
}

/** A Context face with only what a successful connect reaches. */
function fakeContext(): { agentPresets: { register: () => Promise<() => void> } } {
  return { agentPresets: { register: async () => async () => {} } }
}

/** One ssh/password connect request (the wizard's shape). */
function request(): ConnectRequest {
  return { label: 'dev-box', host: '203.0.113.10', port: 22, username: 'tester', authKind: 'password', secret: 'pw' }
}

function service(provision: ReturnType<typeof vi.fn>) {
  const { store, putTarget, storeSecret, records } = fakeStore()
  const workspaces = new RemoteWorkspaces(fakeContext() as never, store as never, {
    packageRoot: '/tmp/plugin',
    leaseMs: 1_000,
    maxProcesses: 4,
    provision: provision as never,
  })
  return { workspaces, putTarget, storeSecret, records }
}

describe('a failed connect writes nothing', () => {
  it('leaves the store untouched when provisioning throws', async () => {
    const provision = vi.fn(async () => { throw new Error('ssh authentication failed') })
    const { workspaces, putTarget, storeSecret, records } = service(provision)
    const ticket = workspaces.beginConnect(request())
    await expect(workspaces.runConnect(ticket, () => {})).rejects.toThrow('ssh authentication failed')
    expect(putTarget).not.toHaveBeenCalled()
    expect(storeSecret).not.toHaveBeenCalled()
    expect(records).toEqual([])
  })

  it('still writes nothing after a host-key confirmation followed by a failure', async () => {
    let attempt = 0
    const provision = vi.fn(async () => {
      attempt++
      if (attempt === 1) throw new HostKeyUnknownError('SHA256:first-contact')
      throw new Error('wrong password')
    })
    const { workspaces, putTarget, storeSecret, records } = service(provision)
    const ticket = workspaces.beginConnect(request())
    const events: string[] = []
    const running = workspaces.runConnect(ticket, event => { events.push(event.type) })
    // Wait for the host-key frame, confirm it, then let the second attempt fail.
    await vi.waitFor(() => { expect(events).toContain('host-key') })
    expect(workspaces.confirmHostKey(ticket, 'SHA256:first-contact')).toBe(true)
    await expect(running).rejects.toThrow('wrong password')
    expect(provision).toHaveBeenCalledTimes(2)
    expect(putTarget).not.toHaveBeenCalled()
    expect(storeSecret).not.toHaveBeenCalled()
    expect(records).toEqual([])
  })

  it('rejects a confirmation naming a different fingerprint', async () => {
    let attempt = 0
    const provision = vi.fn(async () => {
      attempt++
      if (attempt === 1) throw new HostKeyUnknownError('SHA256:first-contact')
      throw new Error('never reached')
    })
    const { workspaces, putTarget } = service(provision)
    const ticket = workspaces.beginConnect(request())
    const events: string[] = []
    const running = workspaces.runConnect(ticket, event => { events.push(event.type) })
    await vi.waitFor(() => { expect(events).toContain('host-key') })
    expect(workspaces.confirmHostKey(ticket, 'SHA256:someone-else')).toBe(false)
    // Nothing confirms the real key — abandon the attempt like a closed stream.
    workspaces.releaseTicket(ticket)
    await expect(running).rejects.toThrow()
    expect(putTarget).not.toHaveBeenCalled()
  })
})

describe('a successful connect writes exactly once', () => {
  it('stores the secret and the ready record together', async () => {
    const provision = vi.fn(async () => provisioned())
    const { workspaces, putTarget, storeSecret, records } = service(provision)
    const ticket = workspaces.beginConnect(request())
    const target = await workspaces.runConnect(ticket, () => {})
    expect(provision).toHaveBeenCalledTimes(1)
    expect(storeSecret).toHaveBeenCalledTimes(1)
    expect(putTarget).toHaveBeenCalledTimes(1)
    expect(records).toHaveLength(1)
    expect(records[0]?.status).toBe('ready')
    expect(records[0]?.credentialKey).toBe(`remote-workspace/${records[0]?.id}`)
    expect(records[0]?.hostKeyFingerprint).toBe('SHA256:confirmed')
    expect(target.hasStoredSecret).toBe(true)
    expect(target.status).toBe('ready')
  })

  it('keeps an existing record id when the label is reused', async () => {
    const provision = vi.fn(async () => provisioned())
    const { workspaces, putTarget, records } = service(provision)
    const first = workspaces.beginConnect(request())
    const created = await workspaces.runConnect(first, () => {})
    const second = workspaces.beginConnect(request())
    const again = await workspaces.runConnect(second, () => {})
    expect(again.id).toBe(created.id)
    expect(putTarget).toHaveBeenCalledTimes(2)
    expect(records).toHaveLength(2)
    expect(records[1]?.id).toBe(records[0]?.id)
  })
})
