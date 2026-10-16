/**
 * Reading of the local OpenSSH client configuration for the wizard's step 2
 * (pick an alias, prefill the connection form).
 *
 * Scope and guarantees:
 *
 * - Dependency-free: `node:` builtins only, no I/O besides reading the config
 *   file(s) and, optionally, asking the local `ssh` binary for its resolved
 *   view with `ssh -G`. Nothing here touches a network.
 * - Non-interactive by construction: `ssh -G` prints the effective
 *   configuration and exits without opening a connection, so it can never
 *   prompt; the argv is passed as an array (never shell-interpolated) and no
 *   `-o` option is ever added, so host-key checking can never be weakened.
 * - Secret-free by construction: the only file path this module reports is an
 *   `IdentityFile` path. Passwords, passphrases, key material and agent sockets
 *   are never read, never returned and never logged.
 * - `process.env` is never consulted; the only environment-ish input is the
 *   user's home directory, used solely to expand a leading `~`.
 *
 * OpenSSH semantics implemented here:
 *
 * - Per option, the FIRST obtained value wins (OpenSSH keeps the first value it
 *   obtains for a keyword while walking the configuration). That is why every
 *   option in {@link SshConfigHost} is assigned only when still `undefined`.
 * - `Host` matching is case-insensitive, and a pattern containing `*`, `?` or a
 *   leading `!` is not a literal alias and is therefore never offered in the
 *   alias list (see {@link listSshAliases}).
 * - A `Match` block applies conditionally at connection time, so its keywords
 *   belong to no {@link SshConfigHost} entry: the parser drops them instead of
 *   leaking them into the preceding literal block.
 * - An `Include` is expanded in place, at the position where it appears, which
 *   is what makes "first value wins" observable across file boundaries.
 */

import { execFile } from 'node:child_process'
import { access, glob, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** One `Host` block found in an OpenSSH client config file. */
export interface SshConfigHost {
  // NOTE: when a keyword appears more than once in the block (or in the blocks
  // it includes), OpenSSH's real rule applies: the FIRST obtained value wins,
  // so that is the one recorded here.
  /** The literal alias, exactly as spelled in the config (first pattern of a Host line). */
  alias: string
  /** Every pattern on the Host line that produced this entry. */
  patterns: string[]
  /** Source file the block came from, for diagnostics (absolute path). */
  source: string
  /** Literal values declared by the block and its includes; only the keys ssh accepts here. */
  hostName?: string
  port?: number
  user?: string
  identityFile?: string
  proxyJump?: string
  proxyCommand?: string
}

/** Fully resolved connection coordinates for one alias. */
export interface SshConfigResolution {
  alias: string
  hostName: string
  port: number
  user?: string
  identityFile?: string
  proxyJump?: string
  proxyCommand?: string
  /** Where the resolution came from. */
  origin: 'ssh -G' | 'config-file'
}

/** The subset of `ssh -G` output this module cares about. */
interface SshGValues {
  hostName?: string
  port?: number
  user?: string
  identityFiles: string[]
  proxyJump?: string
  proxyCommand?: string
}

/** Mutable parser state; shared across `Include` recursion so blocks span files. */
interface ParseState {
  hosts: SshConfigHost[]
  warnings: string[]
  /** Absolute paths already read, so an include cycle cannot loop forever. */
  visited: Set<string>
  /** Block receiving the following keywords, or `null` when they must be dropped. */
  current: SshConfigHost | null
}

/** A pattern with any of these characters is a matcher or a negation, not a literal alias. */
const NON_LITERAL_PATTERN = /[*?!]/

/** Characters that make an `Include` argument a glob rather than a plain path. */
const GLOB_CHARACTERS = /[*?[\]{}]/

/** Default `ssh -G` budget; the command only prints configuration and returns immediately. */
const DEFAULT_SSH_G_TIMEOUT_MS = 5000

/** `ssh -G` output is a few dozen KiB at most. */
const SSH_G_MAX_BUFFER = 1 << 20

/** OpenSSH's default port when neither the config file nor `ssh -G` supplies one. */
const DEFAULT_SSH_PORT = 22

/** The path `ssh` itself would read when no explicit config file is given. */
function defaultConfigPath(): string {
  return join(homedir(), '.ssh', 'config')
}

/** Expand a leading `~` (the only environment-derived expansion this module performs). */
function expandTilde(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return join(homedir(), value.slice(2))
  return value
}

/** True when a Host pattern can be listed and matched as a literal alias. */
function isLiteralPattern(pattern: string): boolean {
  return pattern.length > 0 && !NON_LITERAL_PATTERN.test(pattern)
}

/** True when the string is safe to hand to `execFile` as a positional host argument. */
function isSafeAlias(alias: string): boolean {
  if (alias.length === 0) return false
  // A leading dash could be read as an option by ssh even though argv is used.
  if (alias.startsWith('-')) return false
  // Whitespace, newlines and NUL: never a legal host, and dangerous as an argv entry.
  if (/\s/.test(alias)) return false
  if (alias.includes('\0')) return false
  return true
}

/** Short, path-safe description of an fs error for a warning string. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Split one config line into tokens.
 *
 * Whitespace separates tokens, `#` starts a comment outside quotes, `"` groups a
 * value that may contain spaces, and a backslash escapes the next character
 * inside a quoted value (so `"a\"b"` is `a"b`).
 */
function tokenizeLine(line: string): string[] {
  const tokens: string[] = []
  let token = ''
  let pending = false
  let quoted = false
  let escaped = false

  for (const character of line) {
    if (escaped) {
      token += character
      pending = true
      escaped = false
      continue
    }
    if (quoted && character === '\\') {
      escaped = true
      continue
    }
    if (character === '"') {
      quoted = !quoted
      pending = true
      continue
    }
    if (!quoted && character === '#') break
    if (!quoted && (character === ' ' || character === '\t')) {
      if (pending) tokens.push(token)
      token = ''
      pending = false
      continue
    }
    token += character
    pending = true
  }

  if (escaped) {
    token += '\\'
    pending = true
  }
  if (pending) tokens.push(token)
  return tokens
}

/**
 * Normalize a tokenized directive into `key` plus its arguments, accepting both
 * `Key value` and `Key = value` (and the unspaced `Key=value` spelling).
 */
function splitDirective(tokens: string[]): { key: string; args: string[] } | undefined {
  const first = tokens[0]
  if (first === undefined) return undefined

  let key = first
  let args = tokens.slice(1)

  const equals = key.indexOf('=')
  if (equals > 0) {
    args = [key.slice(equals + 1), ...args]
    key = key.slice(0, equals)
  }
  if (args[0] === '=') args = args.slice(1)

  return { key: key.toLowerCase(), args }
}

/** Assign a keyword to the current block, honouring OpenSSH's "first value wins". */
function applyOption(state: ParseState, key: string, args: string[]): void {
  const block = state.current
  if (block === null) return

  const first = args[0]
  if (first === undefined) return

  switch (key) {
    case 'hostname':
      if (block.hostName === undefined) block.hostName = first
      return
    case 'user':
      if (block.user === undefined) block.user = first
      return
    case 'identityfile':
      if (block.identityFile === undefined) block.identityFile = first
      return
    case 'proxyjump':
      if (block.proxyJump === undefined) block.proxyJump = first
      return
    case 'proxycommand':
      // ProxyCommand is a command line: re-join the arguments with single spaces.
      if (block.proxyCommand === undefined) block.proxyCommand = args.join(' ')
      return
    case 'port': {
      if (block.port !== undefined) return
      const port = Number.parseInt(first, 10)
      if (!/^\d+$/.test(first) || !Number.isInteger(port) || port < 1 || port > 65535) {
        state.warnings.push(`Ignoring invalid Port "${first}" in ${block.source}`)
        return
      }
      block.port = port
      return
    }
    default:
      // Every other keyword (HostKeyAlgorithms, SetEnv, ...) is out of scope.
      return
  }
}

/** Read one file into the shared state, following `Include` directives in place. */
async function readInto(state: ParseState, file: string): Promise<void> {
  const absolute = resolve(file)
  if (state.visited.has(absolute)) return
  state.visited.add(absolute)

  let text: string
  try {
    text = await readFile(absolute, 'utf8')
  } catch (error) {
    state.warnings.push(`Cannot read SSH config file ${absolute}: ${errorMessage(error)}`)
    return
  }

  for (const line of text.split(/\r?\n/)) {
    const tokens = tokenizeLine(line)
    if (tokens.length === 0) continue
    const directive = splitDirective(tokens)
    if (directive === undefined) continue
    const { key, args } = directive

    if (key === 'host') {
      const alias = args[0]
      if (alias === undefined) {
        // `Host` with no pattern matches nothing; following keys apply to nothing.
        state.current = null
        continue
      }
      const block: SshConfigHost = { alias, patterns: [...args], source: absolute }
      state.hosts.push(block)
      state.current = block
      continue
    }

    if (key === 'match') {
      // Conditional block: its keywords belong to no literal entry.
      state.current = null
      continue
    }

    if (key === 'include') {
      for (const pattern of args) await includeInto(state, absolute, pattern)
      continue
    }

    applyOption(state, key, args)
  }
}

/** Expand one `Include` argument (tilde, relative and glob forms) and read the result. */
async function includeInto(state: ParseState, fromFile: string, pattern: string): Promise<void> {
  const expanded = expandTilde(pattern)
  const candidate = expanded.startsWith('/') ? resolve(expanded) : resolve(dirname(fromFile), expanded)

  if (!GLOB_CHARACTERS.test(candidate)) {
    await readInto(state, candidate)
    return
  }

  let matches: string[]
  try {
    matches = []
    for await (const match of glob(candidate)) matches.push(match)
  } catch (error) {
    state.warnings.push(`Cannot expand Include "${pattern}" from ${fromFile}: ${errorMessage(error)}`)
    return
  }

  // A glob that matches nothing is legal (and common for `Include conf.d/*.conf`);
  // only an explicitly named include that cannot be read is worth a warning.
  matches.sort()
  for (const match of matches) await readInto(state, match)
}

/**
 * Read the config file(s) at `configPath`, following `Include` directives. Never throws for a missing file.
 *
 * `Include` arguments may start with `~`, be absolute, be relative to the file
 * that names them, or contain glob characters; a missing explicitly named
 * include is reported in `warnings` instead of throwing, and a glob that matches
 * nothing is silently ignored. Files reachable through `Include` are read once,
 * so an include cycle cannot loop and cannot duplicate entries.
 */
export async function readSshConfig(configPath: string): Promise<{ hosts: SshConfigHost[]; warnings: string[] }> {
  const state: ParseState = { hosts: [], warnings: [], visited: new Set(), current: null }
  await readInto(state, configPath)
  return { hosts: state.hosts, warnings: state.warnings }
}

/**
 * List the aliases a user can pick: literal (non-pattern) Host entries, sorted case-insensitively, de-duplicated (first wins). Default configPath = join(homedir(), '.ssh', 'config').
 *
 * Only the first pattern of a `Host` line decides list membership, so
 * `Host web1 *.example.com` is offered as `web1` while `Host *.example.com` is
 * not offered at all. The returned entries keep their literal table values
 * (including `~` in `identityFile`, which is passed through as written).
 */
export async function listSshAliases(configPath?: string): Promise<{ aliases: SshConfigHost[]; warnings: string[] }> {
  const { hosts, warnings } = await readSshConfig(configPath ?? defaultConfigPath())
  const seen = new Set<string>()
  const aliases: SshConfigHost[] = []

  for (const host of hosts) {
    if (!isLiteralPattern(host.alias)) continue
    const key = host.alias.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    aliases.push(host)
  }

  aliases.sort((left, right) => {
    const a = left.alias.toLowerCase()
    const b = right.alias.toLowerCase()
    if (a < b) return -1
    if (a > b) return 1
    return left.alias < right.alias ? -1 : left.alias > right.alias ? 1 : 0
  })

  return { aliases, warnings }
}

/** Run `ssh -G` and collect stdout; any failure (missing binary, nonzero exit, timeout) resolves to `undefined`. */
function runSshG(
  sshBinary: string,
  alias: string,
  configPath: string | undefined,
  timeoutMs: number,
): Promise<string | undefined> {
  const args = configPath === undefined ? ['-G', '-T', alias] : ['-F', configPath, '-G', '-T', alias]

  return new Promise((settle) => {
    try {
      execFile(
        sshBinary,
        args,
        { timeout: timeoutMs, maxBuffer: SSH_G_MAX_BUFFER, encoding: 'utf8' },
        (error, stdout) => {
          if (error !== null) {
            settle(undefined)
            return
          }
          // `encoding: 'utf8'` yields a string on modern @types/node; `String` keeps
          // this correct on older typings that still widen the parameter to Buffer.
          settle(typeof stdout === 'string' ? stdout : String(stdout))
        },
      )
    } catch {
      settle(undefined)
    }
  })
}

/** Parse the `key value` lines of `ssh -G` output; `value` keeps embedded spaces. */
function parseSshG(stdout: string): SshGValues {
  const values: SshGValues = { identityFiles: [] }

  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0) continue
    const space = line.indexOf(' ')
    if (space < 0) continue

    const key = line.slice(0, space).toLowerCase()
    let value = line.slice(space + 1).trim()
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\"/g, '"')
    }
    if (value.length === 0 || value === 'none') continue

    switch (key) {
      case 'hostname':
        if (values.hostName === undefined) values.hostName = value
        break
      case 'user':
        if (values.user === undefined) values.user = value
        break
      case 'port': {
        if (values.port !== undefined) break
        const port = Number.parseInt(value, 10)
        if (Number.isInteger(port) && port >= 1 && port <= 65535) values.port = port
        break
      }
      case 'identityfile':
        // `ssh -G` prints the candidate list in preference order.
        values.identityFiles.push(value)
        break
      case 'proxyjump':
        if (values.proxyJump === undefined) values.proxyJump = value
        break
      case 'proxycommand':
        if (values.proxyCommand === undefined) values.proxyCommand = value
        break
      default:
        break
    }
  }

  return values
}

/**
 * Pick the `IdentityFile` to prefill: the first candidate that exists on disk,
 * falling back to the first candidate when none does.
 */
async function pickIdentityFile(candidates: string[]): Promise<string | undefined> {
  const first = candidates[0]
  if (first === undefined) return undefined

  for (const candidate of candidates) {
    const expanded = expandTilde(candidate)
    try {
      await access(expanded)
      return expanded
    } catch {
      // Not present locally; keep looking.
    }
  }

  return expandTilde(first)
}

/** True when some literal Host pattern names this alias (case-insensitively). */
async function isConfiguredAlias(alias: string, configPath: string | undefined): Promise<boolean> {
  const { hosts } = await readSshConfig(configPath ?? defaultConfigPath())
  const needle = alias.toLowerCase()
  return hosts.some((host) =>
    host.patterns.some((pattern) => isLiteralPattern(pattern) && pattern.toLowerCase() === needle),
  )
}

/** Resolve straight from the config file: first literal match, case-insensitively. */
async function resolveFromConfigFile(
  alias: string,
  configPath: string | undefined,
): Promise<SshConfigResolution | undefined> {
  const { hosts } = await readSshConfig(configPath ?? defaultConfigPath())
  const needle = alias.toLowerCase()

  for (const host of hosts) {
    const matched = host.patterns.some(
      (pattern) => isLiteralPattern(pattern) && pattern.toLowerCase() === needle,
    )
    if (!matched) continue
    return {
      alias,
      hostName: host.hostName ?? alias,
      port: host.port ?? DEFAULT_SSH_PORT,
      user: host.user,
      identityFile: host.identityFile,
      proxyJump: host.proxyJump,
      proxyCommand: host.proxyCommand,
      origin: 'config-file',
    }
  }

  return undefined
}

/**
 * Resolve one alias through `ssh -G <alias>` (non-interactive), falling back to the config file when the ssh binary is missing or fails. Returns undefined when the alias is unknown.
 *
 * Hostile spellings (empty, whitespace, newline, NUL, or a `-` prefix) are
 * rejected before any process is spawned, so an alias can never be read as an
 * ssh option. `options.configPath` is passed as `-F`, which keeps the probe
 * independent of the developer's real `~/.ssh/config`; when it is omitted a
 * successful `ssh -G` result is still cross-checked against the default config
 * file, because `ssh -G` exits successfully even for an unknown alias (it then
 * reports the alias as its own hostname).
 */
export async function resolveSshAlias(
  alias: string,
  options?: { configPath?: string; sshBinary?: string; timeoutMs?: number },
): Promise<SshConfigResolution | undefined> {
  if (!isSafeAlias(alias)) return undefined

  const configPath = options?.configPath
  const sshBinary = options?.sshBinary ?? 'ssh'
  const timeoutMs = options?.timeoutMs ?? DEFAULT_SSH_G_TIMEOUT_MS

  const stdout = await runSshG(sshBinary, alias, configPath, timeoutMs)
  if (stdout !== undefined) {
    const values = parseSshG(stdout)
    const hostName = values.hostName
    if (hostName !== undefined) {
      const configured = await isConfiguredAlias(alias, configPath)
      // `ssh -G` succeeds for unknown hosts too; only an alias that is neither in
      // the config nor remapped by a wildcard/default block is truly unknown.
      if (configured || hostName.toLowerCase() !== alias.toLowerCase()) {
        return {
          alias,
          hostName,
          port: values.port ?? DEFAULT_SSH_PORT,
          user: values.user,
          identityFile: await pickIdentityFile(values.identityFiles),
          proxyJump: values.proxyJump,
          proxyCommand: values.proxyCommand,
          origin: 'ssh -G',
        }
      }
    }
  }

  return resolveFromConfigFile(alias, configPath)
}

/**
 * Prefill for the wizard form: the resolution plus the literal table values.
 *
 * The resolution wins wherever it has a value (it is what ssh would actually
 * use), and any gap it leaves is filled from the literal block; with no
 * resolution at all the block's own values are returned.
 */
export function prefillFromResolution(
  host: SshConfigHost,
  resolution: SshConfigResolution | undefined,
): {
  alias: string
  host: string
  port: number
  username?: string
  identityFile?: string
  source: 'ssh -G' | 'config-file'
} {
  return {
    alias: host.alias,
    host: resolution?.hostName ?? host.hostName ?? host.alias,
    port: resolution?.port ?? host.port ?? DEFAULT_SSH_PORT,
    username: resolution?.user ?? host.user,
    identityFile: resolution?.identityFile ?? host.identityFile,
    source: resolution?.origin ?? 'config-file',
  }
}
