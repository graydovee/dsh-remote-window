# Windows as a remote server

This document is the contract for using a Windows machine as the **remote server** target of
`dsh-remote-window`. It describes how the client drives a Windows host over SSH, what the isolated runtime
looks like on `win32`, which failures are coded, and what has actually been observed on real hardware.

It does **not** cover Windows as a *client* host (the machine running the DSH GUI). That path has its own
gaps and is not part of this contract.

## 1. Scope

A target is "Windows" when the remote probe reports Windows evidence — `MINGW*`, `MSYS*`, `CYGWIN*`, or the
`6.1.7601`-style banner printed by `cmd /c ver`. POSIX targets (`linux`, `darwin`, BSD) keep their existing
behaviour byte-for-byte; the only switch is the detected dialect.

Supported today:

| Capability | POSIX target | Windows target |
| --- | --- | --- |
| SSH connection, host-key pinning, password / key auth | yes | yes |
| Remote scan (`dsh`, `node`, profiles, native addon) | yes | yes |
| Isolated runtime deploy (`node/` + `dsh/`) | yes | yes (`win32-x64`, `win32-arm64`) |
| Server plugin install | yes | yes |
| Profile start / stop / lease | yes | yes (detached `cmd`, `taskkill /T`) |
| Portal proxy, plugin transport, session/workspace data | yes | yes |
| Local model bridge (`modelSource: 'local'`) | yes | not verified — use `server` |

## 2. How the client drives Windows

Every remote command exists in two dialects. `profilePaths(dshHome, clientId, kind)` (and
`runtimePaths(dshHome, clientId, kind)`) is the single switch; the `kind` travels on `ProfilePaths.kind` and
`RuntimePaths.kind`.

* **Encoding.** PowerShell scripts are never typed into the command line. The client sends
  `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand <base64>` and supplies
  the *script* on stdin as base64 of UTF-16LE. `cmd.exe` cannot re-parse quoting, `$` interpolation, or
  non-ASCII paths because the argv contains only the (already encoded) payload.
* **Writes.** Profile files, the plugin tarball and the runtime tarball are written with SFTP
  (`uploadRemoteFile`), which creates parent directories for `C:\...` paths.
* **Reads.** Text is read with `[IO.File]::Open($path, Open, Read, [IO.FileShare]::ReadWrite)` and copied to a
  `MemoryStream` before base64-encoding. `[IO.File]::ReadAllBytes` would take exclusive read sharing and fail
  with `IOException` while the running profile holds its log open for append (`cmd >> log`), which used to
  look like an empty log and a start timeout.
* **Directories.** `[IO.Directory]::CreateDirectory` per directory; POSIX keeps `command mkdir -p`.
* **Start.** The client writes `<stateDir>\start-<profile>.cmd` (env assignments + `"<node>" "<bin>" … >>
  "<log>" 2>&1`) and creates it with
  `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '<ComSpec> /c
  "<cmd>"' }`. `Start-Process` is not used: it inherits the SSH exec channel's job object, so closing the
  channel kills the profile. The wrapper redirects inside `cmd`, so the log is written as the server starts
  (PowerShell's `-RedirectStandardOutput` buffers, which made the readiness poll time out).
* **Stop.** `Get-CimInstance Win32_Process` checks that the recorded PID still runs the
  `start-<profile>.cmd` command line (PID reuse guard), then `taskkill /PID <pid> /T /F` kills the tree.
* **Readiness.** The startup line is parsed from the log with `PROFILE_STARTUP_PATTERN`; on `win32` the budget
  is `WINDOWS_PROFILE_STARTUP_TIMEOUT_MS = 90_000` because a detached `cmd` + cold Node start + Defender
  scanning routinely exceeds the POSIX 15 s budget.

## 3. The `win32` runtime artifact

`dsh-runtime-<version>-<platform>-<arch>.tar.gz` for `win32` is laid out exactly like the POSIX one:
`node/node.exe` and `dsh/node_modules/@deepseek-ai/dsh`. Two differences are required by real Windows
behaviour:

1. **No symbolic links.** `pnpm`'s default isolated layout produces `node_modules/@deepseek-ai/dsh ->
   .pnpm/...` links. A Windows `tar.exe` (bsdtar) round-trip creates a reparse point that PowerShell resolves
   but Node/libuv cannot: `fs.statSync` / `fs.realpathSync` fail with `EPERM` (a `mklink /D` to the same
   target works), and DSH never starts. The artifact is therefore staged with
   `pnpm-workspace.yaml` → `nodeLinker: hoisted` (`.npmrc`'s `node-linker` is ignored by pnpm 10/11) and
   packed with `tar -czhf` (dereference), so the tarball contains no links at all.
2. **No `@deepseek-ai/node-addon-system` binding.** That package publishes no `win32` sibling. Importing it
   throws `ERR_FLOCK_UNSUPPORTED_PLATFORM`, which DSH tolerates, so `assertTargetOnly` skips that family for
   `win32` explicitly (see `SYSTEM_ADDON_PLATFORMS`) while still requiring
   `node-addon-require-builtin-win32-x64-msvc`. The native-addon health probe uses a hoisted-aware source
   (`<dsh>/node_modules/@deepseek-ai/dsh-app-boot/package.json` via `createRequire`).

`pnpm` ignores `.npmrc`'s `supported-architectures[]` when resolving optional native siblings, so the staging
step installs the target sibling explicitly (`node-addon-require-builtin-win32-x64-msvc@<version>`), then
prunes foreign bindings from both `.pnpm` and the hoisted tree.

## 4. Coded failures

| Code | Where | Meaning |
| --- | --- | --- |
| `runtime-incompatible` | `resolveRuntime` | The remote platform could not be identified, so no runtime artifact can be chosen. Never falls back to `linux`. |
| `runtime-missing` | `resolveRuntime` | No cached/`DSH_RW_RUNTIME_ARTIFACT` artifact for that platform. Pre-seed the file or use a `reuse` global DSH. |
| `runtime-install-failed` | runtime install | `tar.exe`, `Get-FileHash`, `node.exe -v` or the native-addon probe failed. |
| `server-plugin-install-failed` | plugin install | Manifest, name, version, sha256 or archive-path check failed (`windowsServerPluginInstallScript` mirrors the POSIX exit codes 10–15). |
| `profile-start-failed` / `profile-start-timeout` | profile lifecycle | The wrapper could not start `node.exe`, or its startup line never appeared. |

## 5. Known limitations

* The client never downloads `dsh-runtime-*` artifacts. A Windows target therefore needs either
  `DSH_RW_RUNTIME_ARTIFACT=<path to dsh-runtime-*-win32-<arch>.tar.gz>`, a pre-seeded
  `~/.dsh/remote-assets/dsh-runtime-<version>-win32-<arch>.tar.gz`, or a healthy global DSH to `reuse`.
* Building a POSIX-side runtime artifact from a Windows *client* host is refused; this branch does not add
  Windows client support.
* Agent authentication is not available for a Windows **client** host; the server side uses key/password auth
  only.
* `modelSource: 'local'` was not verified against a Windows target (the reverse tunnel was exercised on
  POSIX only). Use `server` models.
* `DSH_HOME` must be an absolute Windows path (`C:\...`); `~` / relative values are rejected.
* No `windows-latest` CI job yet; the Windows paths are covered by unit tests with a fake channel and by the
  real-machine run below.

## 6. Real-machine evidence

Verified once, by hand, against a physical Windows 11 machine (build `10.0.26200`) with `OpenSSH.Server`
running, using the local macOS DSH plugin as the client and `C:\dsh-rw-qa\.dsh` as the target `DSH_HOME`:

1. `v1/connect` → `phase: ready`, isolated runtime installed at
   `C:\dsh-rw-qa\.dsh\remote-window\<clientId>\runtime`, `remote.nodePath` = `...\node\node.exe`,
   `serverDshVersion = 0.2.1-rc.3`.
2. Portal `GET /dsh-remote-window/portal/<targetId>/?dshRwFull=1` → `200`, 38 149 bytes, the official
   `<title>DeepSeek Harness</title>` page served from the Windows profile.
3. Data channel: `v1/workspaces` and `v1/sessions` returned the live registry (`initialized: false` on a
   fresh home).
4. `v1/stop` → `{ stopped: true }`, and the remote process count for that client tree went to `0`.

Reproduce with placeholder values only; never commit real hosts, usernames or paths.
