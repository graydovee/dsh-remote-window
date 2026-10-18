/**
 * The remote `sandbox` reply shape: the contract that broke alpha54's default mode.
 *
 * `@deepseek-ai/dsh-sandbox-ssh` parses this reply with a **strict** facts schema
 * and turns any parse failure into `SandboxUnavailableError`, whose message
 * ("… no sandbox backend is usable on this host … Install bubblewrap … (Linux) …
 * (Windows) …") then reads like a *local* sandbox problem. Alpha54 shipped the
 * bare argv array from the unconfined-passthrough branch, so every bash call in a
 * remote workspace failed with that text while the command itself was perfectly
 * runnable on the remote.
 *
 * `factsSchema` below is copied **verbatim** from
 * `node_modules/@deepseek-ai/dsh-sandbox-ssh/lib/index.js` (0.2.1-rc.2), which
 * does not export it. If the official package ever changes the shape, the copy
 * here is the tripwire that makes this test fail instead of the field.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { unconfinedSandboxFacts } from '../src/server/controller.ts'

const factsSchema = z.object({
  argv: z.array(z.string()).min(1),
  enforcement: z.enum(['full', 'partial']),
  denialSignatures: z.array(z.string()),
  runnerFailureRules: z.array(z.object({
    allowedExitCodes: z.array(z.number().int()).optional(),
    fatalSignatures: z.array(z.string()),
    informationalLines: z.array(z.string()).optional(),
  }).strict()),
}).strict()

describe('unconfined sandbox facts', () => {
  it('parses under the official strict schema', () => {
    const facts = unconfinedSandboxFacts(['/bin/uname', '-s'])
    const parsed = factsSchema.safeParse(facts)
    expect(parsed.success).toBe(true)
    expect(parsed.success ? parsed.data : undefined).toEqual({
      argv: ['/bin/uname', '-s'],
      enforcement: 'partial',
      denialSignatures: [],
      runnerFailureRules: [],
    })
  })

  it('reproduces the alpha54 failure when the bare argv is returned instead', () => {
    // The old reply, kept as a regression witness: a bare array is exactly what
    // made the client report "no sandbox backend is usable on this host".
    const bare = factsSchema.safeParse(['/bin/uname', '-s'])
    expect(bare.success).toBe(false)
    if (bare.success) throw new Error('expected the bare array to be rejected')
    // zod's message for it is a JSON array — the `Runner failure: [` tail QA saw.
    expect(JSON.stringify(bare.error.issues)).toContain('expected object, received array')
  })

  it('claims partial enforcement (nothing governs the file effects here)', () => {
    // `full` is reserved for an argv a backend actually wrapped; claiming it would
    // tell consumers they have a hard boundary that does not exist.
    expect(unconfinedSandboxFacts(['/bin/true']).enforcement).toBe('partial')
  })

  it('copies the argv so the caller cannot mutate the reply in flight', () => {
    const argv = ['/bin/echo', 'hello']
    const facts = unconfinedSandboxFacts(argv)
    argv.push('mutated')
    expect(facts.argv).toEqual(['/bin/echo', 'hello'])
  })

  it('keeps runner-failure detection off (this world detects nothing itself)', () => {
    const facts = unconfinedSandboxFacts(['/bin/true'])
    expect(facts.runnerFailureRules).toEqual([])
    expect(facts.denialSignatures).toEqual([])
  })
})
