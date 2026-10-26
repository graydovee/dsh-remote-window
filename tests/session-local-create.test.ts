/**
 * Local-mode "new session" orchestration (architecture §9, protocol §16.10).
 *
 * Preferred path: server creates the blank identity and records the executor →
 * client ensures the private anchor → client resumes the same id → wait for the
 * client catalog → reveal the official conversation.
 *
 * Fallback (older server): client mints the identity, assigns the executor,
 * creates the client agent (routing persists through P1 `persist/create`).
 *
 * The order matters: revealing before the catalog has the summary ends in the
 * official `unknown session` error, and a reveal timeout must not silently leak
 * a live client agent/write handle.
 */
import { describe, expect, it } from 'vitest'
import {
  createLocalSession,
  LocalSessionError,
  REVEAL_TIMEOUT_CODE,
  type LocalSessionPorts,
} from '../src/session/local-session.ts'
import type { LocalAgentHandleLike } from '../src/session/local-turn.ts'

const PRESET = 'remote:target-1'
const WORKSPACE = 'workspace-1'

/** A fake agent handle; creation tests do not drive it. */
function fakeHandle(id = 'session-1'): LocalAgentHandleLike {
  return {
    agent: { id, cancel: () => {}, whenIdle: async () => {} },
    dispose: async () => {},
  }
}

/** A call log plus ports with overridable behaviour. */
function fakePorts(overrides: Partial<LocalSessionPorts> = {}): {
  ports: LocalSessionPorts
  order: string[]
} {
  const order: string[] = []
  const ports: LocalSessionPorts = {
    createBlankOnServer: async ({ sessionId }) => {
      order.push('server-create')
      return { sessionId, durable: true }
    },
    ensureAnchor: async () => {
      order.push('anchor')
      return '/tmp/anchor/ws-1'
    },
    resumeAgent: async () => {
      order.push('resume')
      return fakeHandle()
    },
    createAgent: async () => {
      order.push('create-agent')
      return fakeHandle()
    },
    assignExecutor: async () => {
      order.push('assign')
    },
    waitForCatalog: async () => {
      order.push('catalog')
    },
    reveal: () => {
      order.push('reveal')
    },
    ...overrides,
  }
  return { ports, order }
}

describe('createLocalSession preferred server path', () => {
  it('creates on the server, resumes on the client, then reveals', async () => {
    const { ports, order } = fakePorts()
    const created = await createLocalSession(ports, { workspaceId: WORKSPACE, agentPreset: PRESET, sessionId: 'session-server-1' })
    expect(order).toEqual(['server-create', 'anchor', 'resume', 'catalog', 'reveal'])
    expect(created).toMatchObject({ sessionId: 'session-server-1', origin: 'server', cwd: '/tmp/anchor/ws-1' })
    expect(created.handle.agent.id).toBe('session-1')
  })

  it('uses the server-minted id when it differs from the requested one', async () => {
    const { ports } = fakePorts({
      createBlankOnServer: async () => ({ sessionId: 'session-server-minted', durable: true }),
    })
    const created = await createLocalSession(ports, { workspaceId: WORKSPACE, agentPreset: PRESET, sessionId: 'session-requested' })
    expect(created.sessionId).toBe('session-server-minted')
  })

  it('creates the agent on the client when the server only mints the local id (M2)', async () => {
    const { ports, order } = fakePorts()
    // M2 `session/create {executor:'local'}` records the executor and returns
    // an id but stores no durable session; the client must create the log.
    ports.createBlankOnServer = async ({ sessionId }) => {
      order.push('server-create')
      return { sessionId, durable: false }
    }
    const created = await createLocalSession(ports, { workspaceId: WORKSPACE, agentPreset: PRESET, sessionId: 'session-minted' })
    expect(order).toEqual(['server-create', 'anchor', 'create-agent', 'catalog', 'reveal'])
    expect(created).toMatchObject({ sessionId: 'session-minted', origin: 'server' })
  })
})

describe('createLocalSession fallback client path', () => {
  it('assigns the executor before creating the client agent and reveals last', async () => {
    const { ports, order } = fakePorts({
      createBlankOnServer: async () => { throw Object.assign(new Error('unsupported'), { code: 'bad-request', status: 400 }) },
    })
    const created = await createLocalSession(ports, { workspaceId: WORKSPACE, agentPreset: PRESET, sessionId: 'session-client-1' })
    expect(created).toMatchObject({ sessionId: 'session-client-1', origin: 'client' })
    expect(order).toEqual(['anchor', 'assign', 'create-agent', 'catalog', 'reveal'])
  })

  it('mints an identity when the caller did not name one', async () => {
    const { ports } = fakePorts({
      createBlankOnServer: async () => { throw Object.assign(new Error('unsupported'), { code: 'not-found', status: 404 }) },
    })
    const created = await createLocalSession(ports, { workspaceId: WORKSPACE, agentPreset: PRESET })
    expect(created.sessionId).toMatch(/^session-/)
  })

  it('does not swallow a genuine create failure', async () => {
    const failure = Object.assign(new Error('path invalid'), { code: 'workspace-path-invalid', status: 400 })
    const { ports, order } = fakePorts({
      createBlankOnServer: async () => { throw failure },
    })
    await expect(createLocalSession(ports, { workspaceId: WORKSPACE, agentPreset: PRESET }))
      .rejects.toBe(failure)
    expect(order).toEqual([])
  })
})

describe('createLocalSession reveal failure', () => {
  it('reports session-reveal-timeout and hands the live handle back for disposal', async () => {
    const { ports, order } = fakePorts({
      waitForCatalog: async () => { await new Promise(() => {}) },
    })
    const failure = createLocalSession(ports, {
      workspaceId: WORKSPACE,
      agentPreset: PRESET,
      sessionId: 'session-reveal-1',
      revealTimeoutMs: 5,
    })
    await expect(failure).rejects.toMatchObject({ code: REVEAL_TIMEOUT_CODE })
    await expect(failure).rejects.toHaveProperty('handle.agent.id', 'session-1')
    expect(order).toEqual(['server-create', 'anchor', 'resume'])
    expect(order).not.toContain('reveal')
  })

  it('wraps a port-specific catalog failure into a reveal error carrying the handle', async () => {
    const { ports } = fakePorts({
      waitForCatalog: async () => { throw new Error('catalog disconnected') },
    })
    const failure = createLocalSession(ports, { workspaceId: WORKSPACE, agentPreset: PRESET, sessionId: 'session-reveal-2' })
    await expect(failure).rejects.toMatchObject({ code: REVEAL_TIMEOUT_CODE, message: 'catalog disconnected' })
    await expect(failure).rejects.toHaveProperty('handle.agent.id', 'session-1')
  })
})

describe('createLocalSession validation', () => {
  it('rejects an empty workspace or preset before any port runs', async () => {
    const { ports, order } = fakePorts()
    await expect(createLocalSession(ports, { workspaceId: ' ', agentPreset: PRESET })).rejects.toBeInstanceOf(LocalSessionError)
    await expect(createLocalSession(ports, { workspaceId: WORKSPACE, agentPreset: ' ' })).rejects.toMatchObject({ code: 'bad-request' })
    expect(order).toEqual([])
  })

  it('propagates a failing resume without revealing', async () => {
    const { ports, order } = fakePorts({
      resumeAgent: async () => { throw new Error('agent-compose-failed') },
    })
    await expect(createLocalSession(ports, { workspaceId: WORKSPACE, agentPreset: PRESET, sessionId: 'session-x' }))
      .rejects.toThrow(/agent-compose-failed/)
    expect(order).toEqual(['server-create', 'anchor'])
  })
})
