/**
 * Every live route the browser half calls must exist as a `dispatchApi` case.
 *
 * The two halves are separate modules and a route name is a plain string, so a
 * rename would otherwise surface only as a runtime 404 (`unknown method
 * "v1/wsl/distros"`). Both client modules are scanned: `api.ts` carries the
 * connection-dialog routes, `remote-api.ts` the rail/portal routes.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const CLIENT_SOURCES = ['../src/client/api.ts', '../src/client/remote-api.ts']
  .map(path => readFileSync(new URL(path, import.meta.url), 'utf8'))
const HOST_SOURCE = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

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
  it('dispatches every route the client calls', () => {
    const host = hostRoutes(HOST_SOURCE)
    const stale = CLIENT_SOURCES.flatMap(clientRoutes).filter(route => !host.has(route))
    expect(stale).toEqual([])
  })

  it('keeps the private-key discovery route on both halves', () => {
    const routes = CLIENT_SOURCES.flatMap(clientRoutes)
    expect(routes).toContain('ssh-keys')
    expect(hostRoutes(HOST_SOURCE).has('ssh-keys')).toBe(true)
  })

  it('wires the ssh-keys route to the scanner that only returns paths', () => {
    expect(HOST_SOURCE).toMatch(/case 'ssh-keys': \{[\s\S]*?listLocalPrivateKeys\(\)/u)
  })
})
