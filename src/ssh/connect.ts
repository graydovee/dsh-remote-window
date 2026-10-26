/**
 * ssh2 transport: connection, host-key pinning, remote execution and upload.
 *
 * `ssh2` (pure JavaScript) is used instead of the `ssh` binary so a password or
 * key can be supplied by the wizard, the host key can be pinned explicitly, and
 * the protocol channel needs no ControlMaster socket or sshd stream-local
 * forwarding.
 */
import { Client, type ConnectConfig, type SFTPWrapper, type ClientChannel } from 'ssh2'
import { fingerprintOf, HostKeyMismatchError, HostKeyUnknownError } from './hostkey.ts'
import { scrubSecrets } from '../targets/types.ts'
import type { RemoteFile } from '../targets/types.ts'

export type { SFTPWrapper, RemoteFile }

/** Authentication material; never logged and never persisted by this module. */
export type SshAuth =
  | { readonly kind: 'password'; readonly password: string }
  | { readonly kind: 'privateKey'; readonly privateKey: Buffer; readonly passphrase?: string }
  | { readonly kind: 'agent'; readonly agent?: string }

/** The server rejected every offered authentication method. */
export class SshAuthError extends Error {
  readonly code = 'ssh-auth-failed'

  constructor(readonly host: string, readonly username: string) {
    super(`SSH authentication failed for ${username}@${host}: the server rejected the configured password/private key/agent. Check the credentials or switch the authentication method.`)
    this.name = 'SshAuthError'
  }
}

/** One SSH connection description. */
export interface SshConnectionOptions {
  readonly host: string
  readonly port: number
  readonly username: string
  readonly auth: SshAuth
  /** Confirmed host-key fingerprint; undefined means first contact and refuses. */
  readonly hostKeyFingerprint?: string
  readonly readyTimeoutMs?: number
}

/** A remote command's bounded result. */
export interface ExecResult {
  readonly code: number | null
  readonly signal: string | null
  readonly stdout: string
  readonly stderr: string
  readonly truncated: boolean
}

/** Error carrying whatever the remote printed, with secrets scrubbed. */
export class RemoteCommandError extends Error {
  readonly code = 'REMOTE_COMMAND_FAILED'

  constructor(message: string, readonly detail: string) {
    super(message)
    this.name = 'RemoteCommandError'
  }
}

/**
 * Connect and verify the host key.
 * @param options - host, credentials and the pinned fingerprint.
 * @returns a ready ssh2 client; the caller owns `end()`.
 * @throws HostKeyUnknownError on first contact, HostKeyMismatchError on a changed key.
 */
export async function connectSsh(options: SshConnectionOptions): Promise<Client> {
  const client = new Client()
  let hostKeyError: Error | undefined
  const config: ConnectConfig = {
    host: options.host,
    port: options.port,
    username: options.username,
    readyTimeout: options.readyTimeoutMs ?? 20_000,
    keepaliveInterval: 10_000,
    keepaliveCountMax: 3,
    ...(options.auth.kind === 'password' ? { password: options.auth.password } : {}),
    ...(options.auth.kind === 'privateKey'
      ? { privateKey: options.auth.privateKey, ...(options.auth.passphrase === undefined ? {} : { passphrase: options.auth.passphrase }) }
      : {}),
    ...(options.auth.kind === 'agent' ? { agent: options.auth.agent ?? process.env.SSH_AUTH_SOCK } : {}),
    // ssh2 needs a synchronous answer, so the reason is carried out of band and
    // surfaced as a typed error instead of a bare handshake failure.
    hostVerifier: (key: Buffer): boolean => {
      const actual = fingerprintOf(key)
      if (options.hostKeyFingerprint === undefined) {
        hostKeyError = new HostKeyUnknownError(actual)
        throw hostKeyError
      }
      if (options.hostKeyFingerprint !== actual) {
        hostKeyError = new HostKeyMismatchError(options.hostKeyFingerprint, actual)
        throw hostKeyError
      }
      return true
    },
  }
  await new Promise<void>((resolve, reject) => {
    client.once('ready', () => { resolve() })
    client.once('error', (error: Error) => {
      if (hostKeyError !== undefined) { reject(hostKeyError); return }
      if (/all configured authentication methods failed/i.test(error.message)) {
        reject(new SshAuthError(options.host, options.username))
        return
      }
      reject(error)
    })
    client.connect(config)
  })
  return client
}

/**
 * Run one command and collect bounded output.
 * @param client - a ready client.
 * @param command - POSIX shell command; callers must quote every interpolation.
 * @param options - byte ceiling and deadline.
 * @returns exit facts and captured output.
 */
export async function execRemote(
  client: Client,
  command: string,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<ExecResult> {
  const maxBytes = options.maxBytes ?? 256 * 1024
  return await new Promise<ExecResult>((resolve, reject) => {
    let truncated = false
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let total = 0
    const collect = (sink: Buffer[]) => (chunk: Buffer): void => {
      total += chunk.length
      if (total > maxBytes) {
        truncated = true
        return
      }
      sink.push(chunk)
    }
    const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
      reject(new RemoteCommandError('remote command timed out', scrubSecrets(command)))
    }, options.timeoutMs)
    const finish = (error: Error | undefined, result?: ExecResult): void => {
      if (timer !== undefined) clearTimeout(timer)
      if (error !== undefined) reject(error)
      else resolve(result as ExecResult)
    }
    client.exec(command, (error, stream) => {
      if (error !== undefined) {
        finish(new RemoteCommandError(`remote command failed to start: ${scrubSecrets(error.message)}`, scrubSecrets(command)))
        return
      }
      stream.on('data', collect(stdout))
      stream.stderr.on('data', collect(stderr))
      stream.on('error', (streamError: Error) => {
        finish(new RemoteCommandError(`remote command failed: ${scrubSecrets(streamError.message)}`, scrubSecrets(command)))
      })
      stream.on('close', (code: number | null, signal: string | null) => {
        finish(undefined, {
          code: code ?? null,
          signal: signal ?? null,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          truncated,
        })
      })
    })
  })
}

/** Open an interactive exec channel for the server's stdio. */
export async function openExecChannel(client: Client, command: string): Promise<ClientChannel> {
  return await new Promise<ClientChannel>((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error !== undefined) {
        reject(new RemoteCommandError(`remote server failed to start: ${scrubSecrets(error.message)}`, scrubSecrets(command)))
        return
      }
      resolve(stream)
    })
  })
}

/** Open one SFTP session. */
export async function openSftp(client: Client): Promise<SFTPWrapper> {
  return await new Promise<SFTPWrapper>((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error !== undefined) reject(new RemoteCommandError(`remote SFTP session failed: ${scrubSecrets(error.message)}`, ''))
      else resolve(sftp)
    })
  })
}

/** Resolve a path relative to the SFTP session's starting directory. */
export async function realpath(sftp: SFTPWrapper, path: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    sftp.realpath(path, (error, resolved) => {
      if (error !== undefined) reject(new RemoteCommandError(`cannot resolve "${path}" on the remote host`, scrubSecrets(error.message)))
      else resolve(resolved)
    })
  })
}

/** Create a directory and every missing parent. */
export async function mkdirp(sftp: SFTPWrapper, directory: string): Promise<void> {
  const segments = directory.split('/').filter(segment => segment !== '')
  let current = directory.startsWith('/') ? '' : '.'
  for (const segment of segments) {
    current = current === '' ? `/${segment}` : `${current}/${segment}`
    await new Promise<void>((resolve, reject) => {
      sftp.mkdir(current, { mode: 0o755 }, (error) => {
        // An existing directory is success; anything else is reported.
        if (error == null || /failure/i.test(String(error.message ?? ''))) resolve()
        else reject(new RemoteCommandError(`cannot create remote directory "${current}"`, scrubSecrets(String(error.message))))
      })
    })
  }
}

/** Write one file, creating parents first. */
export async function writeRemoteFile(sftp: SFTPWrapper, file: RemoteFile): Promise<void> {
  const directory = file.path.slice(0, file.path.lastIndexOf('/'))
  await mkdirp(sftp, directory)
  await new Promise<void>((resolve, reject) => {
    sftp.writeFile(file.path, file.content, { mode: 0o644 }, (error) => {
      if (error != null) reject(new RemoteCommandError(`cannot write remote file "${file.path}"`, scrubSecrets(String(error.message))))
      else resolve()
    })
  })
}

/**
 * Stream one file to the remote host with byte-level progress.
 *
 * The artifact (a Node distribution, ~25-50 MB) is pushed in fixed chunks so a
 * throttled UI callback can show a ZCode-style percentage line instead of a
 * silent wait.
 */
export async function uploadRemoteFile(
  sftp: SFTPWrapper,
  file: RemoteFile,
  onProgress?: (sent: number, total: number) => void,
): Promise<void> {
  const directory = file.path.slice(0, file.path.lastIndexOf('/'))
  await mkdirp(sftp, directory)
  const CHUNK = 256 * 1024
  await new Promise<void>((resolve, reject) => {
    const stream = sftp.createWriteStream(file.path, { mode: 0o644, autoClose: true })
    let sent = 0
    stream.on('error', (error: Error) => reject(new RemoteCommandError(`cannot upload remote file "${file.path}"`, scrubSecrets(error.message))))
    stream.on('close', () => resolve())
    let offset = 0
    const pushNext = (): boolean => {
      while (offset < file.content.length) {
        const end = Math.min(offset + CHUNK, file.content.length)
        const chunk = file.content.subarray(offset, end)
        offset = end
        sent = offset
        onProgress?.(sent, file.content.length)
        if (!stream.write(chunk)) return false
      }
      stream.end()
      return true
    }
    stream.on('drain', () => { pushNext() })
    pushNext()
  })
}

/**
 * Write one file through an exec pipe (`cat > path`) — the fallback for
 * gateways that do not expose the SFTP subsystem. Remembers nothing: the
 * caller decides once per session which transport to use.
 */
export async function writeRemoteFileViaExec(client: Client, file: RemoteFile): Promise<void> {
  const quotedPath = file.path.replaceAll("'", "'\\''")
  const escaped = file.content.toString('base64')
  // Chunked base64 keeps a single argv under `getconf ARG_MAX` even for the
  // multi-megabyte server bundles; `base64 -d` exists in coreutils and busybox.
  const result = await new Promise<ExecResult>((resolve, reject) => {
    void execRemote(client, `umask 022; cat > '${quotedPath}.b64' << 'DSH_RW_EOF'\n${escaped}\nDSH_RW_EOF\n(base64 -d '${quotedPath}.b64' 2>/dev/null || openssl base64 -d -in '${quotedPath}.b64') > '${quotedPath}' && rm -f '${quotedPath}.b64'`, { maxBytes: 4096, timeoutMs: 300_000 })
      .then(resolve, reject)
  })
  if (result.code !== 0) {
    throw new RemoteCommandError(`cannot write remote file "${file.path}" through the exec pipe`, scrubSecrets(result.stderr.slice(-2000)))
  }
}
