/**
 * The read-only "what dsh does this host already have" scan.
 *
 * The wizard's 复用机器上的 dsh path needs three facts *before* connecting: which
 * dsh launchers exist, which of them this plugin can drive, and whether the
 * target's profile already carries a current copy of the server plugin. All
 * three are gathered by one POSIX script over a throwaway transport and parsed
 * here — this module is the script plus its parser, with no I/O, so the parsing
 * rules are unit-testable exactly like `deploy.parseProbeOutput`.
 *
 * Hard constraints, because this script runs on a machine we do not own:
 *
 * - **Read-only.** Only `command -v`, `ls`, `test`, `readlink -f`, `head`, `sed`,
 *   `tr`, `cat`, `uname`, `ldd --version` and `<launcher> --version` appear. No
 *   `mkdir`/`rm`/`mv`/`cp`/`touch`, no package manager, no network. In
 *   particular the pipeline's own probe script is *not* a template: it does
 *   `mkdir -p ~/.dsh/server/.components` (`deploy.ts`), which is a write.
 * - **`$DSHHOME/server/node/bin` leads `PATH`.** The dsh this plugin deploys is a
 *   `/bin/sh` shim around `exec node` and its interpreter is *not* on the login
 *   PATH. Measured on Ubuntu 22.04: without that prefix, `--version` on a
 *   deployed launcher answers `exec: node: not found` (exit 127), the candidate
 *   is judged incompatible, and 复用 fails against the very instance this plugin
 *   installed a minute earlier. With it the same shim prints `0.2.1-rc.2`.
 * - **`readlink -f` on that shim returns the shim itself**, first line
 *   `#!/bin/sh`, so the shebang cannot name the interpreter. When a shebang is
 *   present but no node could be derived, the deployed
 *   `<DSHHOME>/server/node/bin/node` is used instead — that is what makes the
 *   shim runnable (`selfContained: false`).
 * - Multi-line scripts travel on stdin on the WSL side (`/bin/sh -s`, see
 *   `ssh/wsl.ts`); this text is plain LF, never CRLF (a CRLF body answers
 *   `/bin/sh: echo: not found` inside a distro).
 */

import { describeIncompatibility, isCompatibleDsh } from './version-range.ts'

/** First line of the scan output; anything else means "not our script". */
export const SCAN_MAGIC = '@@RW@@SCAN@@1'

/** Last line; its absence means the output was cut off (see {@link DshScan.truncated}). */
export const SCAN_END = 'END'

/** One `node` binary the scan found, with the version it printed. */
export interface ScannedNode {
  readonly path: string
  readonly version: string
}

/** One dsh launcher candidate as the script reported it (no judgement yet). */
export interface ScannedLauncher {
  /** The path a user would type (may be a symlink wrapper). */
  readonly path: string
  /** `readlink -f` of {@link path}; the de-duplication key. */
  readonly realPath: string
  /** First line of `<launcher> --version`; `''` when it printed nothing. */
  readonly version: string
  /** Exit code of that probe (`127` when the launcher could not run at all). */
  readonly exitCode: number
  /** Interpreter the launcher needs, when the host has an executable one. */
  readonly nodePath?: string
}

/** One profile directory under `DSH_HOME/profiles`. */
export interface ScannedProfile {
  readonly name: string
  readonly pluginVersion?: string
  readonly pluginSha256?: string
}

/** Everything one scan pass reported, before any policy is applied. */
export interface DshScan {
  readonly home?: string
  readonly dshHome?: string
  /** `uname -s` (e.g. `Linux`, `Darwin`). */
  readonly platform?: string
  /** `uname -m` (e.g. `x86_64`, `aarch64`). */
  readonly machine?: string
  /** `/proc/sys/kernel/ostype`, first line. */
  readonly ostype?: string
  /** `ldd --version` first line (glibc vs musl). */
  readonly ldd?: string
  /** `tar`/`sha256sum`/`shasum`/`curl`/`wget` that resolved, by name. */
  readonly tools: readonly { readonly name: string; readonly path: string }[]
  readonly nodes: readonly ScannedNode[]
  readonly launchers: readonly ScannedLauncher[]
  readonly profiles: readonly ScannedProfile[]
  /** Raw JSON of the packaging deployment's `.components/plugin.json`, when present. */
  readonly marker?: string
  /** True when the `END` sentinel never arrived (output cut off by the byte cap). */
  readonly truncated: boolean
}

/**
 * The scan script.
 *
 * Order matters in two places: `DSHHOME` must be known before `PATH` is built
 * (the deployed node lives under it), and the `--version` probes must run after
 * that `PATH` is exported.
 * @param options - optional `DSH_HOME` override (the target's configured value).
 * @returns one POSIX shell body; the caller wraps it with `sh()`/`exec`.
 */
export function scanDshScript(options: { dshHome?: string } = {}): string {
  const dshHome = (options.dshHome ?? '').trim().replace(/\/+$/u, '')
  // Three shapes come in from a target record: empty (use the remote's own
  // `$DSH_HOME` or `~/.dsh`), absolute (`/data/dsh`), and home-relative
  // (`~/.dsh-custom`). Only the absolute form can be shell-quoted; a `~` must
  // stay unquoted or the shell treats it as a literal directory name.
  const homeRelative = /^~\/(?:[^"$`\\\s]+)$/u.test(dshHome) ? dshHome.slice(2) : ''
  const defaultAssignment = "DSHHOME=$(printf '%s' \"${DSH_HOME:-$HOME/.dsh}\")"
  const homeAssignment = dshHome === '' || !dshHome.startsWith('/') && homeRelative === ''
    ? defaultAssignment
    : homeRelative !== ''
      ? `DSHHOME="$HOME/${homeRelative}"`
      : `DSHHOME=${quote(dshHome)}`
  return [
    // `set -u` only: a failed probe must still let the remaining lines run, so
    // the host always receives every record it can and judges on what exists.
    'set -u',
    // zsh aborts the whole script when a glob has no match; the candidate
    // loops below deliberately tolerate missing nvm/fnm trees.
    'if [ -n "${ZSH_VERSION:-}" ]; then setopt nonomatch 2>/dev/null || true; fi',
    'export LC_ALL=C',
    homeAssignment,
    // The deployed node first: see the module comment (exec: node: not found).
    // `export`, because this line stands alone rather than prefixing a command.
    'export PATH="$DSHHOME/server/node/bin:$HOME/.local/bin:$HOME/.bun/bin:$HOME/.volta/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"',
    'run() { if command -v timeout >/dev/null 2>&1; then timeout 15 "$@"; else "$@"; fi }',
    '',
    `printf '%s\\n' '${SCAN_MAGIC}'`,
    "printf 'HOME\\t%s\\n' \"$HOME\"",
    "printf 'DSHHOME\\t%s\\n' \"$DSHHOME\"",
    "printf 'UNAME\\t%s\\n' \"$(uname -s 2>/dev/null)\"",
    "printf 'MACHINE\\t%s\\n' \"$(uname -m 2>/dev/null)\"",
    "printf 'OSTYPE\\t%s\\n' \"$(cat /proc/sys/kernel/ostype 2>/dev/null | head -1)\"",
    "printf 'LDD\\t%s\\n' \"$(ldd --version 2>&1 | head -1)\"",
    'for t in tar sha256sum shasum curl wget; do',
    '  p=$(command -v "$t" 2>/dev/null || true)',
    '  [ -n "$p" ] || continue',
    "  printf 'TOOL\\t%s\\t%s\\n' \"$t\" \"$p\"",
    'done',
    '',
    'for n in "$(command -v node 2>/dev/null || true)" \\',
    '         "$HOME"/.nvm/versions/node/*/bin/node \\',
    '         "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node \\',
    '         "$HOME/.volta/bin/node" "$HOME/.bun/bin/node" \\',
    '         "/usr/local/bin/node" "/usr/bin/node"; do',
    '  [ -n "$n" ] || continue',
    '  [ -x "$n" ] || continue',
    "  printf 'NODE\\t%s\\t%s\\n' \"$n\" \"$(run \"$n\" -v 2>/dev/null | head -1)\"",
    'done',
    '',
    "SEEN='|'",
    'for c in "$(command -v dsh 2>/dev/null || true)" \\',
    '         "$HOME/.local/bin/dsh" "$HOME/.bun/bin/dsh" "$HOME/.volta/bin/dsh" \\',
    '         "$HOME/.local/share/pnpm/dsh" \\',
    '         "$HOME"/.nvm/versions/node/*/bin/dsh \\',
    '         "$HOME"/.local/share/fnm/node-versions/*/installation/bin/dsh \\',
    '         "/usr/local/bin/dsh" "/usr/bin/dsh" "/opt/homebrew/bin/dsh" \\',
    '         "$DSHHOME/server/dsh/node_modules/.bin/dsh"; do',
    '  [ -n "$c" ] || continue',
    '  [ -e "$c" ] || continue',
    '  real=$(readlink -f "$c" 2>/dev/null || printf \'%s\' "$c")',
    '  [ -n "$real" ] || real=$c',
    '  case "$SEEN" in *"|$real|"*) continue ;; esac',
    '  SEEN="$SEEN$real|"',
    '  out=$(run "$c" --version 2>/dev/null); code=$?',
    '  ver=$(printf \'%s\' "$out" | head -1)',
    '  sb=$(head -1 "$real" 2>/dev/null)',
    "  node=''",
    '  case "$sb" in',
    "    '#!'*'/env node'*) node=$(command -v node 2>/dev/null || true) ;;",
    "    '#!'*'/env '*node*) node=$(command -v node 2>/dev/null || true) ;;",
    "    '#!'*node*) node=$(printf '%s' \"$sb\" | sed -e 's/^#![[:space:]]*//' -e 's/[[:space:]].*$//') ;;",
    '  esac',
    "  case \"$node\" in /*) ;; *) node='' ;; esac",
    '  [ -x "$node" ] || node=\'\'',
    '  # A shebang that names no node + a deployed node = the uploaded dsh shim.',
    '  if [ -z "$node" ]; then',
    '    case "$sb" in',
    '      \'#!\'*) if [ -x "$DSHHOME/server/node/bin/node" ]; then node="$DSHHOME/server/node/bin/node"; fi ;;',
    '    esac',
    '  fi',
    "  printf 'DSH\\t%s\\t%s\\t%s\\t%s\\t%s\\n' \"$c\" \"$real\" \"$ver\" \"$code\" \"$node\"",
    'done',
    '',
    'for p in "$DSHHOME"/profiles/*; do',
    '  [ -d "$p" ] || continue',
    "  name=$(printf '%s' \"$p\" | sed -e 's|.*/profiles/||')",
    "  pv=''; sha=''",
    '  manifest="$p/node_modules/dsh-remote-workspace/package.json"',
    '  if [ -f "$manifest" ]; then',
    "    pv=$(tr -d '\\n' < \"$manifest\" | sed -n 's/.*\"version\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p')",
    '  fi',
    '  if [ -f "$p/.dsh-rw-plugin.json" ]; then',
    "    sha=$(tr -d '\\n' < \"$p/.dsh-rw-plugin.json\" | sed -n 's/.*\"sha256\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p')",
    '  fi',
    "  printf 'PLUGIN\\t%s\\t%s\\t%s\\n' \"$name\" \"$pv\" \"$sha\"",
    'done',
    '',
    'if [ -f "$DSHHOME/server/.components/plugin.json" ]; then',
    '  m=\'\'',
    "  m=$(tr -d '\\n' < \"$DSHHOME/server/.components/plugin.json\" | head -c 400 2>/dev/null || true)",
    "  printf 'MARKER\\t%s\\t%s\\n' \"$DSHHOME/server/.components/plugin.json\" \"$m\"",
    'fi',
    `printf '%s\\n' '${SCAN_END}'`,
  ].join('\n')
}

/** Quote one value for the POSIX shell (single quotes, `'` escaped). */
function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * Fold the scan script's TAB records into a {@link DshScan}.
 *
 * Rules that matter to callers:
 *
 * 1. A first line other than {@link SCAN_MAGIC} **throws**: returning an empty
 *    result would let a new client read an old/garbled answer as "this host has
 *    no dsh" and quietly send the user down the upload path.
 * 2. Records with the wrong field count are dropped. That is also how a path
 *    containing a TAB (or one split across lines) is discarded, which is what
 *    keeps a hostile filename out of the launcher list.
 * 3. Unknown record kinds are ignored, so an older host can keep parsing a
 *    newer script's output.
 * 4. A missing {@link SCAN_END} means the output was truncated by the transport
 *    byte cap: the records that did arrive stay usable and `truncated` is set.
 *
 * @param stdout - the script's stdout.
 * @returns the parsed scan.
 * @throws Error `unsupported scan output` when the magic line is absent.
 */
export function parseDshScanOutput(stdout: string): DshScan {
  const lines = stdout.split('\n').map(line => line.replace(/\r$/u, ''))
  const first = (lines[0] ?? '').trim()
  if (first !== SCAN_MAGIC) throw new Error('unsupported scan output')

  let home: string | undefined
  let dshHome: string | undefined
  let platform: string | undefined
  let machine: string | undefined
  let ostype: string | undefined
  let ldd: string | undefined
  let marker: string | undefined
  const tools: { name: string; path: string }[] = []
  const nodes: ScannedNode[] = []
  const launchers: ScannedLauncher[] = []
  const profiles: ScannedProfile[] = []
  let truncated = true

  for (const line of lines.slice(1)) {
    if (line === '') continue
    if (line === SCAN_END) {
      truncated = false
      break
    }
    const fields = line.split('\t')
    const kind = fields[0]
    switch (kind) {
      case 'HOME':
        if (fields.length === 2) home = fields[1]
        break
      case 'DSHHOME':
        if (fields.length === 2) dshHome = fields[1]
        break
      case 'UNAME':
        if (fields.length === 2) platform = fields[1]
        break
      case 'MACHINE':
        if (fields.length === 2) machine = fields[1]
        break
      case 'OSTYPE':
        if (fields.length === 2) ostype = fields[1]
        break
      case 'LDD':
        if (fields.length === 2) ldd = fields[1]
        break
      case 'TOOL': {
        if (fields.length !== 3) break
        const name = fields[1]
        const path = fields[2]
        if (name === undefined || path === undefined || name === '' || path === '') break
        tools.push({ name, path })
        break
      }
      case 'NODE': {
        if (fields.length !== 3) break
        const path = fields[1]
        if (path === undefined || path === '') break
        nodes.push({ path, version: fields[2] ?? '' })
        break
      }
      case 'DSH': {
        // `DSH <path> <realPath> <version> <exitCode> <nodePath-or-empty>`
        if (fields.length !== 6) break
        const path = fields[1]
        const realPath = fields[2]
        const version = fields[3]
        const codeText = fields[4]
        const node = fields[5]
        if (path === undefined || path === '' || codeText === undefined) break
        const exitCode = Number.parseInt(codeText, 10)
        if (!Number.isFinite(exitCode)) break
        launchers.push({
          path,
          realPath: realPath === undefined || realPath === '' ? path : realPath,
          version: version ?? '',
          exitCode,
          ...(node === undefined || node === '' ? {} : { nodePath: node }),
        })
        break
      }
      case 'PLUGIN': {
        // `PLUGIN <name> <pluginVersion-or-empty> <markerSha256-or-empty>`
        if (fields.length !== 4) break
        const name = fields[1]
        if (name === undefined || name === '') break
        const pluginVersion = fields[2] ?? ''
        const pluginSha256 = fields[3] ?? ''
        profiles.push({
          name,
          ...(pluginVersion === '' ? {} : { pluginVersion }),
          ...(pluginSha256 === '' ? {} : { pluginSha256 }),
        })
        break
      }
      case 'MARKER': {
        if (fields.length !== 3) break
        const text = fields[2]
        if (text !== undefined && text !== '') marker = text
        break
      }
      default:
        // Forward compatibility: an unknown record kind is simply not ours.
        break
    }
  }

  return {
    ...(home === undefined || home === '' ? {} : { home }),
    ...(dshHome === undefined || dshHome === '' ? {} : { dshHome }),
    ...(platform === undefined || platform === '' ? {} : { platform }),
    ...(machine === undefined || machine === '' ? {} : { machine }),
    ...(ostype === undefined || ostype === '' ? {} : { ostype }),
    ...(ldd === undefined || ldd === '' ? {} : { ldd }),
    ...(marker === undefined ? {} : { marker }),
    tools,
    nodes,
    launchers,
    profiles,
    truncated,
  }
}

/** The plugin the target's profile carries, as the wizard's candidate list shows it. */
export interface ScannedDshProfile {
  readonly name: string
  readonly pluginVersion?: string
  readonly pluginSha256?: string
  /** Whether the installed file set is the one this host would write. */
  readonly upToDate: boolean
}

/** One dsh the wizard may offer to reuse. */
export interface DshCandidate {
  readonly path: string
  readonly realPath: string
  /** First line of `--version`; `''` when the launcher printed nothing. */
  readonly version: string
  readonly compatible: boolean
  readonly executable: boolean
  /** Interpreter the launcher needs; absent for a self-contained binary. */
  readonly nodePath?: string
  /**
   * True when the launcher has no interpreter of its own — i.e. the scan found
   * no `nodePaths` for it. A native ELF/Mach-O launcher reports this, and so
   * does a `/bin/sh` wrapper with no node anywhere (which {@link planProvision}
   * turns into "deploy our own Node").
   */
  readonly selfContained: boolean
  readonly profile?: ScannedDshProfile
  /** Why this candidate was rejected; absent when it is usable. */
  readonly reason?: string
  /**
   * Where this launcher comes from. The picker names a row by this instead of by
   * a path nobody can read (`/home/u/.dsh/server/dsh/node_modules/.bin/dsh`).
   */
  readonly origin: CandidateOrigin
  /** Human detail for the origin: node version (nvm/fnm) or the install directory. */
  readonly originDetail?: string
}

/**
 * Provenance of one launcher.
 *
 * `deployed` is the runtime **this plugin** uploaded or downloaded
 * (`<dshHome>/server/dsh`); it is the one that runs the special
 * `dsh-remote-server` profile, so the picker must say so.
 */
export type CandidateOrigin = 'deployed' | 'nvm' | 'fnm' | 'volta' | 'bun' | 'user-local' | 'system' | 'other'

/**
 * Classify one launcher path.
 * @param path - the launcher's absolute path.
 * @param dshHome - the remote `DSH_HOME` the scan ran against (absolute, `''` when unknown).
 * @returns the origin and an optional detail (node version or directory).
 */
export function candidateOrigin(path: string, dshHome: string): { origin: CandidateOrigin; detail?: string } {
  const normalized = path.replaceAll('\\', '/')
  const home = dshHome.replace(/\/+$/, '')
  // The uploaded/downloaded runtime lives under `<DSH_HOME>/server/dsh`; check it
  // before the generic home-directory rules so it never reads as "user install".
  if (home !== '' && normalized.startsWith(`${home}/server/dsh/`)) return { origin: 'deployed' }
  const nvm = /\/\.nvm\/versions\/node\/([^/]+)\//.exec(normalized)
  if (nvm !== null && nvm[1] !== undefined) return { origin: 'nvm', detail: nvm[1] }
  const fnm = /\/\.local\/share\/fnm\/node-versions\/([^/]+)\//.exec(normalized)
  if (fnm !== null && fnm[1] !== undefined) return { origin: 'fnm', detail: fnm[1] }
  if (normalized.includes('/.volta/')) return { origin: 'volta' }
  if (normalized.includes('/.bun/')) return { origin: 'bun' }
  if (normalized.includes('/.local/bin/')) return { origin: 'user-local' }
  const directory = normalized.slice(0, normalized.lastIndexOf('/'))
  if (normalized.startsWith('/usr/') || normalized.startsWith('/opt/homebrew/') || normalized.startsWith('/bin/')) {
    return { origin: 'system', ...(directory === '' ? {} : { detail: directory }) }
  }
  return { origin: 'other', ...(directory === '' ? {} : { detail: directory }) }
}

/** The most candidates the wizard is asked to render. */
export const MAX_CANDIDATES = 12

/**
 * Turn the raw scan into the wizard's candidate list.
 *
 * The profile block is *not* per launcher: every launcher on one host shares the
 * same `DSH_HOME`, so "is our server plugin installed and current" is a property
 * of the profile, and the answer is attached to each candidate for rendering.
 *
 * @param scan - parsed scan output.
 * @param options - the profile this connection will use and the digest of the
 *   file set this host would upload (`sha256OfFiles(profile + plugin files)`).
 * @returns candidates ordered for the picker: usable-and-current first, then
 *   merely compatible, then the rest by path; already limited to
 *   {@link MAX_CANDIDATES}.
 */
export function assembleCandidates(
  scan: DshScan,
  options: { profile: string; expectedPluginSha?: string; dshHome?: string },
): DshCandidate[] {
  const scanned = scan.profiles.find(entry => entry.name === options.profile)
  const upToDate =
    scanned?.pluginSha256 !== undefined &&
    options.expectedPluginSha !== undefined &&
    scanned.pluginSha256 === options.expectedPluginSha
  const profile: ScannedDshProfile | undefined = scanned === undefined
    ? undefined
    : {
        name: scanned.name,
        ...(scanned.pluginVersion === undefined ? {} : { pluginVersion: scanned.pluginVersion }),
        ...(scanned.pluginSha256 === undefined ? {} : { pluginSha256: scanned.pluginSha256 }),
        upToDate,
      }
  const candidates: DshCandidate[] = scan.launchers.map(launcher => {
    const executable = launcher.exitCode === 0 && launcher.version.trim() !== ''
    const compatible = isCompatibleDsh(launcher.version)
    const origin = candidateOrigin(launcher.path, options.dshHome ?? '')
    return {
      path: launcher.path,
      realPath: launcher.realPath,
      version: launcher.version.trim(),
      compatible,
      executable,
      ...(launcher.nodePath === undefined ? {} : { nodePath: launcher.nodePath }),
      selfContained: launcher.nodePath === undefined,
      ...(profile === undefined ? {} : { profile }),
      origin: origin.origin,
      ...(origin.detail === undefined ? {} : { originDetail: origin.detail }),
      ...(compatible
        ? {}
        : {
            reason: executable
              ? describeIncompatibility(launcher.version)
              : launcher.exitCode === 0
                ? describeIncompatibility(launcher.version)
                : `the launcher did not report a version (exit ${launcher.exitCode})`,
          }),
    }
  })
  const rank = (candidate: DshCandidate): number =>
    candidate.compatible && candidate.profile?.upToDate === true ? 0 : candidate.compatible ? 1 : 2
  return candidates
    .sort((left, right) => rank(left) - rank(right) || left.path.localeCompare(right.path))
    .slice(0, MAX_CANDIDATES)
}

/** Architecture facts the wizard shows on the upload card. */
export interface RemoteRuntimeProbe {
  readonly platform: 'linux' | 'darwin'
  readonly arch: 'x64' | 'arm64'
  readonly libc: '' | 'gnu' | 'musl'
  readonly platformArch: string
  /** `artifactTag(platform, arch, libc)`, e.g. `linux-arm64-gnu`. */
  readonly tag: string
  readonly home: string
  readonly tools: { tar: boolean; sha256sum: boolean; curl: boolean; wget: boolean }
}

/**
 * Fold the scan's `TOOL` records into the probe's tool flags.
 *
 * `shasum` counts as `sha256sum`: macOS ships `shasum` and not `sha256sum`, and
 * the pipeline asks the same question of its own probe (`parseProbeOutput`), so
 * "can I verify a downloaded artifact here" must not answer differently
 * depending on which script asked.
 * @param tools - the resolved tool records.
 */
export function scanTools(tools: DshScan['tools']): RemoteRuntimeProbe['tools'] {
  const has = (name: string): boolean => tools.some(tool => tool.name === name)
  return {
    tar: has('tar'),
    sha256sum: has('sha256sum') || has('shasum'),
    curl: has('curl'),
    wget: has('wget'),
  }
}

/** What the local asset cache holds for the architecture the remote needs. */
export interface ServerPackageState {
  readonly artifact: string
  /** The dsh release the host would package/download. */
  readonly version: string
  readonly cached: boolean
  readonly sha256?: string
  readonly sizeBytes?: number
}

/** `/api/dsh-scan`'s two outcomes: ask for host-key confirmation, or report. */
export type DshScanResult =
  | { readonly stage: 'host-key'; readonly fingerprint: string }
  | {
      readonly stage: 'done'
      readonly probe: RemoteRuntimeProbe
      readonly package: ServerPackageState
      readonly dshHome: string
      readonly profiles: readonly string[]
      readonly candidates: readonly DshCandidate[]
    }
