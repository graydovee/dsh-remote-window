/**
 * The host-side transport seam.
 *
 * Provisioning and the protocol channel only need "run a POSIX command on the
 * far side", "put a file there" and "give me a long-lived stdio pair". SSH and
 * WSL answer all three differently — one over ssh2 (with an optional SFTP
 * subsystem), one over a locally spawned `wsl.exe` — so the deployment code
 * targets this interface instead of importing `ssh2`.
 *
 * Both implementations keep the measured constraint that a *fresh* transport
 * costs a real connection: `connect*Transport` does the connect, the caller owns
 * `close()`.
 */
import type { RemoteChannel, RemoteTargetKind } from '../targets/types.ts'
import { scrubSecrets } from '../targets/types.ts'
import {
  connectSsh,
  execRemote,
  openExecChannel,
  openSftp,
  uploadRemoteFile,
  writeRemoteFile,
  writeRemoteFileViaExec,
  type ExecResult,
  type SshConnectionOptions,
  type SFTPWrapper,
} from '../ssh/connect.ts'
import { spawnWslChannel, wslExec, writeWslFile } from '../ssh/wsl.ts'

/** One command's bounded result (the ssh module's shape, re-exported). */
export type RemoteExec = ExecResult

/** A protocol channel plus the process's captured stderr tail. */
export interface RemoteChannelHandle {
  readonly channel: RemoteChannel
  /** What the far side printed on stderr, scrubbed; empty when nothing was captured. */
  diagnostics(): string
  /** Resolves once the far-side process exits, with its code (null when unknown). */
  readonly exited: Promise<number | null>
}

/** Everything provisioning needs from one reachable execution world. */
export interface RemoteTransport {
  readonly kind: RemoteTargetKind
  /** Run one POSIX shell body and collect bounded output. */
  exec(body: string, options?: { maxBytes?: number; timeoutMs?: number }): Promise<RemoteExec>
  /** Write one file, creating parents, reporting byte progress when asked. */
  writeFile(path: string, content: Buffer, onProgress?: (sent: number, total: number) => void): Promise<void>
  /** Start the long-lived server process whose stdio becomes the protocol channel. */
  openChannel(body: string): Promise<RemoteChannelHandle>
  /** Release the underlying connection. Idempotent. */
  close(): Promise<void>
}

/** Bytes of stderr kept for a failed-startup report. */
const STDERR_TAIL_BYTES = 8192

/**
 * Connect over ssh2.
 * @param options - host, credentials and the pinned host-key fingerprint.
 * @returns a transport whose SFTP subsystem is opened lazily on first upload.
 * @throws HostKeyUnknownError on first contact, HostKeyMismatchError on a changed key.
 */
export async function connectSshTransport(options: SshConnectionOptions): Promise<RemoteTransport> {
  const client = await connectSsh(options)
  // SFTP is optional: a gateway without the subsystem demotes the whole session
  // to exec-pipe uploads instead of failing the connect. Probed once, lazily,
  // because a marker-hit connect performs no upload at all.
  let sftp: SFTPWrapper | undefined
  let sftpTried = false
  const sftpOrUndefined = async (): Promise<SFTPWrapper | undefined> => {
    if (sftpTried) return sftp
    sftpTried = true
    try {
      sftp = await openSftp(client)
    } catch {
      sftp = undefined
    }
    return sftp
  }
  let closed = false
  return {
    kind: 'ssh',
    exec: async (body, execOptions) => await execRemote(client, body, execOptions ?? {}),
    writeFile: async (path, content, onProgress) => {
      const session = await sftpOrUndefined()
      if (session !== undefined) {
        await uploadRemoteFile(session, { path, content }, onProgress)
        return
      }
      await writeRemoteFileViaExec(client, { path, content })
      onProgress?.(content.length, content.length)
    },
    openChannel: async (body) => {
      const stream = await openExecChannel(client, body)
      let tail = ''
      stream.stderr.on('data', (chunk: Buffer) => {
        tail = `${tail}${chunk.toString('utf8')}`.slice(-STDERR_TAIL_BYTES)
      })
      let ended = false
      stream.once('close', () => { ended = true })
      stream.once('error', () => { ended = true })
      const exited = new Promise<number | null>((resolveExit) => {
        let settled = false
        const settle = (code: number | null): void => {
          if (settled) return
          settled = true
          resolveExit(code)
        }
        stream.once('exit', (code: number | null) => { settle(code) })
        stream.once('close', () => { settle(null) })
      })
      const channel: RemoteChannel = {
        input: stream.stdout,
        output: stream,
        // The host plane reads this to decide whether the cached channel is
        // still usable (the remote server exits on lease expiry).
        get closed() { return ended || stream.destroyed },
        // Closing the channel releases the whole session, exactly like the
        // single-purpose `ServerChannel` this replaced: the provisioned world
        // owns one connection and ends with it.
        close: async () => {
          ended = true
          if (!stream.destroyed) stream.end()
          closed = true
          client.end()
        },
      }
      return { channel, diagnostics: () => scrubSecrets(tail.trim()), exited }
    },
    close: async () => {
      if (closed) return
      closed = true
      try {
        sftp?.end()
      } catch {}
      client.end()
    },
  }
}

/**
 * Connect to one local WSL distribution.
 *
 * There is no handshake to verify: the transport is a process started on this
 * machine, so the caller treats the target as trusted and never asks for a host
 * key. Reachability is proven by the provisioning `connect` step, which runs a
 * trivial command inside the distro.
 * @param options - distribution name and optional distro user.
 * @returns the transport; `close()` is a no-op because each channel owns its process.
 */
export function connectWslTransport(options: { distro: string; user?: string }): RemoteTransport {
  const { distro, user } = options
  return {
    kind: 'wsl',
    exec: async (body, execOptions) => await wslExec(distro, body, { ...execOptions, ...(user === undefined ? {} : { user }) }),
    writeFile: async (path, content, onProgress) => {
      await writeWslFile(distro, path, content, onProgress, user)
    },
    openChannel: async (body) => spawnWslChannel(distro, body, user),
    close: async () => {},
  }
}
