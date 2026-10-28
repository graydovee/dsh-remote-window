/**
 * The generated profile patch and the profile-start environment.
 *
 * The patch is rewritten on every connect (the reverse-tunnel port is random),
 * overrides two official rows by id and never contains the user's model key:
 * the profile only gets the `local-bridge` placeholder through its launch env.
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_PROFILE_PATCH,
  LOCAL_LLM_API_KEY_ENV,
  LOCAL_LLM_BRIDGE_API_KEY,
  LOCAL_LLM_PROVIDER_ID,
  buildLocalModelPatch,
} from '../src/local-llm/profile.ts'
import {
  PROFILE_PATCH_FILE,
  profileEnvAssignments,
  profilePaths,
  profileStartScript,
  startProfileServer,
  writeProfilePatch,
  type ProfileExecResult,
  type ProfileRemote,
} from '../src/provision/profile-lifecycle.ts'

const CLIENT_ID = '0123456789ab'

class FakeProfileRemote implements ProfileRemote {
  log = ''
  readonly scripts: string[] = []
  readonly writes: { path: string; content: string }[] = []

  async exec(body: string): Promise<ProfileExecResult> {
    this.scripts.push(body)
    if (body.includes('setsid nohup')) return { code: 0, stdout: '4242\n', stderr: '' }
    if (body.includes('kill -0')) return { code: 0, stdout: '0', stderr: '' }
    if (body.includes('server.pid')) return { code: 0, stdout: '4242\n', stderr: '' }
    if (body.includes('server.log')) return { code: 0, stdout: this.log, stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }

  async writeFile(path: string, content: Buffer): Promise<void> {
    this.writes.push({ path, content: content.toString('utf8') })
  }
}

describe('buildLocalModelPatch', () => {
  it('overrides llm-pi-ai and agent-default-model with JSON-quoted YAML scalars', () => {
    expect(buildLocalModelPatch({ remotePort: 40_123, models: ['qwen3', 'llama3'] })).toBe(
      [
        '- id: "llm-pi-ai"',
        '  config:',
        '    providers:',
        '      "client-local":',
        '        displayName: "Local model"',
        '        api: "openai-completions"',
        '        baseURL: "http://127.0.0.1:40123/v1"',
        '        apiKeyEnv: "DSH_RW_LOCAL_LLM_KEY"',
        '        models:',
        '          - id: "qwen3"',
        '            name: "qwen3"',
        '          - id: "llama3"',
        '            name: "llama3"',
        '- id: "agent-default-model"',
        '  config:',
        '    provider: "client-local"',
        '    model: "qwen3"',
        '',
      ].join('\n'),
    )
  })

  it('keeps the route id, display name and key env configurable/stable and escapes strings', () => {
    const patch = buildLocalModelPatch({
      remotePort: 8_080,
      models: ['  qwen3  ', '', '   '],
      displayName: 'Local "fast" \\ model',
    })
    expect(LOCAL_LLM_PROVIDER_ID).toBe('client-local')
    expect(LOCAL_LLM_BRIDGE_API_KEY).toBe('local-bridge')
    expect(LOCAL_LLM_API_KEY_ENV).toBe('DSH_RW_LOCAL_LLM_KEY')
    expect(patch).toContain('displayName: "Local \\"fast\\" \\\\ model"')
    // Only the usable model survives trimming/filtering.
    expect(patch.match(/ {8}- id:/gu)).toHaveLength(1)
    expect(patch).toContain('model: "qwen3"')
    expect(patch.endsWith('\n')).toBe(true)
    // No user secret can appear: the patch only names the env variable.
    expect(patch).not.toContain('Bearer')
    expect(patch).not.toContain('sk-')
  })

  it('rejects an invalid port or an empty model list before the profile starts', () => {
    for (const remotePort of [0, 65_536, 1.5, Number.NaN]) {
      expect(() => buildLocalModelPatch({ remotePort, models: ['qwen3'] })).toThrow(/invalid reverse-tunnel port/u)
    }
    expect(() => buildLocalModelPatch({ remotePort: 8_080, models: [] })).toThrow(/at least one model/u)
    expect(() => buildLocalModelPatch({ remotePort: 8_080, models: [' ', ''] })).toThrow(/at least one model/u)
  })

  it('exposes the empty patch used for the server model source', () => {
    expect(EMPTY_PROFILE_PATCH).toBe('[]\n')
    expect(PROFILE_PATCH_FILE).toBe('cordis.patch.yml')
  })
})

describe('profile start environment', () => {
  it('renders shell-quoted NAME=value pairs and rejects unsafe names', () => {
    expect(profileEnvAssignments()).toBe('')
    expect(profileEnvAssignments({})).toBe('')
    expect(profileEnvAssignments({ DSH_RW_LOCAL_LLM_KEY: 'local-bridge' })).toBe(` DSH_RW_LOCAL_LLM_KEY='local-bridge'`)
    expect(profileEnvAssignments({ A: "it's", B: 'x y' })).toBe(` A='it'\\''s' B='x y'`)
    expect(() => profileEnvAssignments({ '1BAD': 'x' })).toThrow(/environment name/u)
    expect(() => profileEnvAssignments({ 'A-B': 'x' })).toThrow(/environment name/u)
  })

  it('appends the bridge placeholder in the detached start command', () => {
    const paths = profilePaths('/home/user/.dsh', CLIENT_ID)
    const script = profileStartScript(paths, {
      launcher: '/home/user/.dsh/runtime/dsh/node_modules/.bin/dsh',
      env: { DSH_RW_LOCAL_LLM_KEY: LOCAL_LLM_BRIDGE_API_KEY },
    })
    expect(script).toMatch(/setsid nohup env DSH_HOME=\S+ DSH_RW_LOCAL_LLM_KEY='local-bridge'/u)
    expect(script.indexOf(`DSH_RW_LOCAL_LLM_KEY='local-bridge'`)).toBeLessThan(script.indexOf('--profile'))
    // The start script never carries the user's real key, only the placeholder.
    expect(script).not.toContain('sk-user')
  })

  it('passes the environment through startProfileServer', async () => {
    const paths = profilePaths('/home/user/.dsh', CLIENT_ID)
    const remote = new FakeProfileRemote()
    remote.log = 'booting\n'
    const handle = await startProfileServer(remote, paths, {
      launcher: '/home/user/.dsh/runtime/dsh/node_modules/.bin/dsh',
      env: { DSH_RW_LOCAL_LLM_KEY: LOCAL_LLM_BRIDGE_API_KEY },
      timeoutMs: 2_000,
      sleep: async () => {
        remote.log += 'dsh web: http://127.0.0.1:45678/?token=tok_123\n'
      },
    })
    expect(handle).toMatchObject({ port: 45_678, token: 'tok_123', pid: 4242 })
    expect(remote.scripts[0]).toContain(`DSH_RW_LOCAL_LLM_KEY='local-bridge'`)
  })

  it('writes the patch next to the profile, creating the directory first', async () => {
    const paths = profilePaths('/home/user/.dsh', CLIENT_ID)
    const remote = new FakeProfileRemote()
    const patch = buildLocalModelPatch({ remotePort: 40_123, models: ['qwen3'] })
    await writeProfilePatch(remote, paths, patch)
    expect(remote.scripts[0]).toContain(`mkdir -p '${paths.profileDir}'`)
    expect(remote.writes).toEqual([{ path: `${paths.profileDir}/${PROFILE_PATCH_FILE}`, content: patch }])
  })
})
