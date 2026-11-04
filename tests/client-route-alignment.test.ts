/**
 * Every live route the browser half calls must exist as a `dispatchApi` case.
 *
 * The two halves are separate modules and a route name is a plain string, so a
 * rename used to surface only as a runtime 404 (`unknown method
 * "v1/wsl/distros"`). `src/client/api.ts` still carries v2-era helpers whose
 * routes were dropped by the host; that debt is pinned as a literal list so a
 * *new* stale call fails immediately.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const API_SOURCE = readFileSync(new URL('../src/client/api.ts', import.meta.url), 'utf8')
const HOST_SOURCE = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

/** v2 routes the client still exposes but the host no longer dispatches. */
const KNOWN_STALE = [
  'alias-prefill',
  'cleanup-shell-workspaces',
  'connect',
  'connect/start',
  'dsh-scan',
  'hostkey-confirm',
  'list-dir',
  'open-session',
  'open-workspace',
  'remote-windows',
  'session-flag',
  'session-rename',
  'sessions',
  'stop-target',
  'workspace-rename',
] as const

/** Routes the browser half calls in `call()`. */
function clientRoutes(source: string): string[] {
  const routes = new Set<string>()
  for (const match of source.matchAll(/call<[^>]*>\('([^']+)'/gu)) routes.add(match[1] as string)
  for (const match of source.matchAll(/call\('([^']+)'/gu)) routes.add(match[1] as string)
  return [...routes].sort()
}

/** Routes the host dispatches from `dispatchApi`. */
function hostRoutes(source: string): Set<string> {
  const routes = new Set<string>()
  for (const match of source.matchAll(/case '([^']+)':/gu)) routes.add(match[1] as string)
  return routes
}

describe('host/browser route alignment', () => {
  it('dispatches every live route and nothing silently new is stale', () => {
    const host = hostRoutes(HOST_SOURCE)
    const stale = clientRoutes(API_SOURCE).filter(route => !host.has(route))
    expect(stale).toEqual([...KNOWN_STALE].sort())
  })

  it('keeps the private-key discovery route on both halves', () => {
    expect(clientRoutes(API_SOURCE)).toContain('ssh-keys')
    expect(hostRoutes(HOST_SOURCE).has('ssh-keys')).toBe(true)
  })

  it('wires the ssh-keys route to the scanner that only returns paths', () => {
    expect(HOST_SOURCE).toMatch(/case 'ssh-keys': \{[\s\S]*?listLocalPrivateKeys\(\)/u)
  })
})
