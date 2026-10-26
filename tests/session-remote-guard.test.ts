/**
 * Fail-closed preset guard for v1 private anchors
 * (`<DSH_HOME>/remote-workspaces/<clientId>/<targetId>/<hash>`).
 *
 * The legacy visible-stub layout is retired; only the anchor layout is an
 * execution-world cwd. Any remote preset outside it, and any non-target preset
 * inside it, must be vetoed at the synchronous `session/created` boundary.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { remotePresetId } from '../src/preset/world.ts'
import { assertRemoteSessionPreset, remoteAnchorRoot, remoteTargetIdForCwd } from '../src/session/remote-guard.ts'

const ROOT = remoteAnchorRoot()
const CLIENT = 'aaaaaaaaaaaa'
const TARGET = 'rt-abc'
const ANCHOR = join(ROOT, CLIENT, TARGET, 'deadbeef')

it('follows DSH_HOME for the anchor root', () => {
  expect(remoteAnchorRoot({ DSH_HOME: '/tmp/custom-home' })).toBe(join('/tmp/custom-home', 'remote-workspaces'))
  expect(remoteAnchorRoot({ DSH_HOME: '   ' })).toBe(join(homedir(), '.dsh', 'remote-workspaces'))
})

describe('remoteTargetIdForCwd', () => {
  it('reads the target from a v1 anchor cwd', () => {
    expect(remoteTargetIdForCwd(ANCHOR)).toBe(TARGET)
    expect(remoteTargetIdForCwd(ANCHOR, { DSH_HOME: ROOT.replace(/\/remote-workspaces$/, '') })).toBe(TARGET)
  })

  it('does not accept the retired visible-stub layout as an anchor', () => {
    expect(remoteTargetIdForCwd(join(ROOT, TARGET, 'deadbeef'))).toBeUndefined()
  })

  it('does not treat the root or a lookalike prefix as an anchor', () => {
    expect(remoteTargetIdForCwd(ROOT)).toBeUndefined()
    expect(remoteTargetIdForCwd(join(ROOT, CLIENT))).toBeUndefined()
    expect(remoteTargetIdForCwd(join(ROOT, '..', 'local'))).toBeUndefined()
    expect(remoteTargetIdForCwd(`${ROOT}-other/${CLIENT}/${TARGET}/x`)).toBeUndefined()
    expect(remoteTargetIdForCwd(undefined)).toBeUndefined()
  })
})

describe('assertRemoteSessionPreset', () => {
  it('accepts the target preset on its anchor', () => {
    expect(() => { assertRemoteSessionPreset({ cwd: ANCHOR, agentPreset: remotePresetId(TARGET) }) }).not.toThrow()
  })

  it('rejects a local/standard preset on an anchor', () => {
    expect(() => { assertRemoteSessionPreset({ cwd: ANCHOR, agentPreset: 'standard' }) })
      .toThrow(/requires agent preset/)
  })

  it('rejects another target preset on an anchor', () => {
    expect(() => { assertRemoteSessionPreset({ cwd: ANCHOR, agentPreset: remotePresetId('rt-other') }) })
      .toThrow(/requires agent preset/)
  })

  it('rejects a remote preset on a local workspace', () => {
    expect(() => { assertRemoteSessionPreset({ cwd: join(ROOT, '..', 'local'), agentPreset: remotePresetId('rt-other') }) })
      .toThrow(/only valid for a remote workspace anchor/)
  })

  it('leaves non-anchor cwds with a local preset alone', () => {
    expect(() => { assertRemoteSessionPreset({ cwd: join(ROOT, '..', 'local'), agentPreset: 'standard' }) }).not.toThrow()
    expect(() => { assertRemoteSessionPreset({ agentPreset: 'standard' }) }).not.toThrow()
  })
})
