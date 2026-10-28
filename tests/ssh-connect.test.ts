/**
 * ssh2 host-key verification fixture: a real SSH server on loopback.
 *
 * The verifier runs inside ssh2's synchronous key-exchange state machine, so
 * this drives the real handshake instead of mocking the transport. Throwing out
 * of the verifier aborts ssh2's packet parser while the exchange is still half
 * finished; the server's trailing NEWKEYS packet then crashes the client with
 * "Received packet 21 instead of 31" — uncaught in DSH, which exits. The
 * verifier must answer `false` so ssh2 disconnects cleanly and this test can
 * assert the typed error afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { Server as SshServer, utils } from 'ssh2'
import { connectSsh, type SshConnectionOptions } from '../src/ssh/connect.ts'
import { HostKeyMismatchError, HostKeyUnknownError } from '../src/ssh/hostkey.ts'

let server: SshServer
let port = 0

beforeAll(async () => {
  const hostKey = utils.generateKeyPairSync('ed25519')
  server = new SshServer({ hostKeys: [hostKey.private] }, (client) => {
    // A client that rejects the host key disconnects with KEY_EXCHANGE_FAILED;
    // the fixture's server connection must absorb that instead of crashing the
    // test process with ssh2's uncaught DISCONNECT error.
    client.on('error', () => undefined)
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password') ctx.accept()
      else ctx.reject(['password'])
    })
    client.on('session', (accept) => { accept() })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
    setTimeout(resolve, 500)
  })
})

function options(overrides: Partial<SshConnectionOptions> = {}): SshConnectionOptions {
  return {
    host: '127.0.0.1',
    port,
    username: 'tester',
    auth: { kind: 'password', password: 'fixture' },
    readyTimeoutMs: 5_000,
    ...overrides,
  }
}

/** Give any stale handshake packet a chance to arrive and expose a crash. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 100))
}

describe('connectSsh host-key verification', () => {
  it('reports an unknown host key and lets the handshake die cleanly', async () => {
    await expect(connectSsh(options())).rejects.toBeInstanceOf(HostKeyUnknownError)
    await settle()
  })

  it('pins the confirmed fingerprint and connects', async () => {
    const rejected = await connectSsh(options()).catch((error: unknown) => error)
    expect(rejected).toBeInstanceOf(HostKeyUnknownError)
    const fingerprint = (rejected as HostKeyUnknownError).fingerprint
    const client = await connectSsh(options({ hostKeyFingerprint: fingerprint }))
    client.end()
    await settle()
  })

  it('refuses a changed host key instead of retrying', async () => {
    const rejected = await connectSsh(options({ hostKeyFingerprint: 'SHA256:changed-key' })).catch((error: unknown) => error)
    expect(rejected).toBeInstanceOf(HostKeyMismatchError)
    expect((rejected as HostKeyMismatchError).expected).toBe('SHA256:changed-key')
    expect((rejected as HostKeyMismatchError).actual).toMatch(/^SHA256:/)
    await settle()
  })
})
