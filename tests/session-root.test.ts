/**
 * The embedded local JSONL backend must read the *official* session root.
 *
 * Regression for the alpha.3 install: `apply()` passed `join(homedir(),
 * 'sessions')`, i.e. `~/sessions`, while dsh-base configures
 * `dshHomePath('sessions')`, i.e. `~/.dsh/sessions`. With the official
 * persistence row disabled by this bundle's patch, the routing then listed an
 * empty directory and every workspace looked as if its sessions had vanished.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { localSessionRoot } from '../src/session-persistence/routing.ts'

type RootCtx = Parameters<typeof localSessionRoot>[0]

/** A context exposing only the app-boot `dshHomePath` service. */
function ctxWithHomePath(): RootCtx {
  return {
    get: (name: string) => name === 'dshHomePath'
      ? (...segments: string[]) => join('/harness-home', ...segments)
      : undefined,
  } as unknown as RootCtx
}

/** A context with no app-boot service: the fallback must carry the root. */
const bare = { get: () => undefined } as unknown as RootCtx

describe('localSessionRoot', () => {
  it('uses the app-boot dshHomePath service when present', () => {
    expect(localSessionRoot(ctxWithHomePath(), {})).toBe(join('/harness-home', 'sessions'))
  })

  it('honours DSH_HOME when the service is absent', () => {
    expect(localSessionRoot(bare, { DSH_HOME: '/custom-harness-home' })).toBe(join('/custom-harness-home', 'sessions'))
  })

  it('falls back to ~/.dsh/sessions, never ~/sessions', () => {
    expect(localSessionRoot(bare, {})).toBe(join(homedir(), '.dsh', 'sessions'))
    expect(localSessionRoot(bare, { DSH_HOME: '   ' })).toBe(join(homedir(), '.dsh', 'sessions'))
  })
})
