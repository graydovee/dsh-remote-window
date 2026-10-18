/**
 * `connectionMode → packageSource` (alpha62: 远程下载 became selectable).
 *
 * Step 3's three cards are the only place the provisioning mode is chosen, and
 * `ConnectRequest.packageSource` is the only place it is expressed on the wire
 * (architecture A3). One card must produce exactly one wire value — a mode that
 * silently maps to nothing would look connected while the host followed the
 * global policy instead.
 */
import { describe, expect, it } from 'vitest'
import { choiceReady, packageSourceOf } from '../src/client/connect-mode.ts'

describe('packageSourceOf', () => {
  it('maps the 复用 card to reuse', () => {
    expect(packageSourceOf('reuse')).toBe('reuse')
  })

  it('maps the 上传 card to upload', () => {
    expect(packageSourceOf('upload')).toBe('upload')
  })

  it('maps the 远程下载 card to download', () => {
    expect(packageSourceOf('download')).toBe('download')
  })

  it('maps "nothing chosen" to the omitted field (follow the policy)', () => {
    expect(packageSourceOf('')).toBeUndefined()
  })
})

describe('choiceReady', () => {
  it('needs a picked launcher for reuse', () => {
    expect(choiceReady('reuse', '')).toBe(false)
    expect(choiceReady('reuse', '   ')).toBe(false)
    expect(choiceReady('reuse', '/home/u/.nvm/versions/node/v24.4.0/bin/dsh')).toBe(true)
  })

  it('accepts upload and download without further input', () => {
    expect(choiceReady('upload', '')).toBe(true)
    expect(choiceReady('download', '')).toBe(true)
  })

  it('refuses to start with no choice', () => {
    expect(choiceReady('', '/home/u/bin/dsh')).toBe(false)
  })
})
