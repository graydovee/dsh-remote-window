# dsh-remote-workspace

English | [中文](README-zh.md)

**Open an SSH host as a DeepSeek Harness workspace.** The agent loop, model requests,
credentials and the UI stay on your machine; the files, subprocesses, shell and **session
logs** live on the remote host, in the official DSH JSONL format. Resuming a conversation
from another machine needs no mirroring.

- Adds a **远程工作区** section to the left sidebar: connections → workspaces → sessions.
- Installs and starts a `dsh` runtime on the host for you (no Node or npm needed there).
- Keeps SSH credentials and model keys local, verifies host keys, and never routes session
  logs through your machine.
- A plugin for `dsh web` (`web` profile). Verified against **DSH `0.2.1-rc.2`** only.

## Quick start

### 1. Requirements

| Where | Requirement |
| --- | --- |
| Your machine | `dsh` **exactly `0.2.1-rc.2`**, a `web` profile, Node `^22.19.0 \|\| >=24.0.0` |
| Remote host | POSIX with a reachable sshd, `/bin/sh`, `tar`, `chmod`, writable `$HOME`. **No Node, npm or dsh needed** — they are deployed for you |
| Remote target (WSL) | Windows hosts only; the chosen distro is the execution world |

The plugin is a bundle for `dsh web`. The desktop app image does not ship the SSH packages
(`@deepseek-ai/dsh-ssh`, `dsh-fs-ssh`, `dsh-subprocess-ssh`, `dsh-sandbox-ssh`), so install it
into a `web` profile, never into a desktop profile.

### 2. Install the plugin

The package is not on a registry yet; install a built tarball:

```bash
pnpm install
pnpm build
pnpm pack --pack-destination ~/.dsh/tarballs

dsh plugin --profile web remove dsh-remote-workspace   # only if already installed
dsh plugin --profile web add ~/.dsh/tarballs/dsh-remote-workspace-<version>.tgz
```

Restart the process serving the GUI, then reload the page: this is a bundle plugin, and the
restart is what mounts its patch layer. A git install fetches sources instead of build output,
so allow the package's `prepare` build in the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-remote-workspace: true
```

### 3. Connect a host

Sidebar → **远程工作区** → **＋新建连接**. The wizard has three steps:

1. **选择方式** — `SSH` (a remote host) or `WSL` (a distro on this Windows machine; no host
   key or password).
2. **填写配置** — for SSH: **别名** (required; saved after a successful connect), **主机**,
   **端口**, **用户名**, **认证方式** (`SSH Agent` / `私钥` / `密码`; the key or password is
   sent once and never stored in the list). **高级：远端运行时** overrides the remote
   `Node 路径` / `DSH 命令` / `Profile` / `DSH_HOME` when the defaults do not fit; aliases
   can be prefilled from `~/.ssh/config`.
3. **连接** — pick where the remote runtime comes from, then confirm the host key:
   - **复用机器上的 dsh** — scan what is already installed on the host and add only this
     plugin; no upload, no host-side network;
   - **上传 server 包** — push a runtime package (Node + dsh) for the host's architecture;
     a locally cached package is uploaded directly;
   - **远程下载** — fetch the matching release from GitHub (falls back to a local build).

   The first connection to a host shows its SHA-256 fingerprint and waits for **信任并继续**.
   A fingerprint that changed later aborts the connection. Progress runs through 连接主机 →
   探测远端环境 → 部署运行时(Node) → 部署 dsh 与服务端 → 建立执行通道; failures keep the
   connection log visible.

### 4. Add a workspace and open a session

1. On the connection row, click **＋** (or **⋮ → 添加工作区**). Browse the remote directory
   tree — 主目录 / 上一级 / 新建目录 / path box — then **打开为工作区**. Leave
   **工作区名称** empty to use the directory name; renaming later never moves the directory.
2. The workspace row shows its sessions. Click the **blank row** (`新会话`) to start one, or
   click an existing session row to resume it. The conversation opens in the main area and
   continues from the remote log.

### 5. Day-to-day

| Action | Where | What it does |
| --- | --- | --- |
| 连接 / 重新连接 / 断开 | connection row `⋮` or the `＋` plug icon | Starts or stops the remote runtime channel. Disconnecting folds the subtree; reconnecting expands it |
| 添加工作区 | connection row `＋` | Registers a remote directory in the server-owned workspace list |
| 新会话 | workspace row `＋`, or the blank row | Creates a session (a real remote log) |
| 打开 / 继续 | click a session row | Resumes from the remote log; safe from another machine |
| 置顶 / 归档 | session row `⋮` | Sorting and visual state, stored on the plugin's workspace record (archived rows refuse to open) |
| 重命名 | session row `⋮` | Appends an official `session/title` event to the remote log |
| 分叉 | session row `⋮` | Forks through the shell's own `forkSession`; the child lives on the remote too |
| 移除工作区 | workspace row `⋮` | Removes the catalogue entry and the local stub. **Remote session logs are kept**; register the same directory again to see them |
| 刷新 | region header / workspace row | Re-reads the server's workspace list and sessions |
| 删除连接 | connection row `⋮` | Forgets the local record, credentials and stubs. The deployed runtime and remote logs stay |

## Using it well

- **Sessions are remote files, not a mirror.** Everything the agent writes is appended on the
  host (`~/.dsh/remote-server-sessions/<projectKey>/<sessionId>/`). Two machines connected to
  the same host see the same sessions; deleting a local stub does not delete them.
- **The workspace list belongs to the server.** Adding or removing a workspace changes the
  host's `workspaces.json`, so a second client sees the change on its next refresh (polling,
  not push).
- **WSL targets are local.** On a Windows host, a distro is the execution world: no sshd, no
  host key, and the deployment goes through `wsl.exe` (its multi-line scripts are fed on
  stdin, which is why the deploy works in zsh/flavours).

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Install or startup refuses with `incompatible-version` naming `engines.dsh` | The host is not `0.2.1-rc.2` (the only release this plugin is verified against) | Install `dsh` `0.2.1-rc.2`, or grant a temporary exemption — see [Compatibility](#compatibility) |
| `dsh-remote-workspace … failed to import`, then official rows stay pending | The package was added as a dependency but never into `dsh.profile.bundles` (typical in a desktop profile that lacks the SSH packages) | Install it with `dsh plugin --profile web add` and restart |
| `unsupported remote session protocol …` | The client and the remote server disagree on the wire protocol (`3`) | Reconnect; the plugin redeploys its own server bundle when the plugin version changes |
| Every command fails with `sandbox mode "workspace-write" … no sandbox backend is usable` | The remote world has no sandbox backend (for example a WSL distro without bubblewrap/Landlock) | Expected: the remote world is the isolation boundary, commands run there unconfinced and report `enforcement: 'partial'` |
| No **远程工作区** section in the sidebar | The plugin is not mounted (not a `web` profile, or the restart did not happen) | Check `dsh --profile web --dump-config` for its layer, then restart |
| `该 server 上还没有工作区` on the first frame, correct after a refresh | The workspace list was not ready yet when the panel rendered | Refresh; a known first-frame cosmetic issue |
| Connection fails early | Wrong host/port/user/credential, or the host key was not trusted | Read 连接日志 in the wizard, try `ssh -v <host>` with the same account, check the private key passphrase or your agent |

## Compatibility

| What | Field | Value |
| --- | --- | --- |
| DSH host | `engines.dsh` | `0.2.1-rc.2` — exact, the only verified release |
| DSH packages | every `@deepseek-ai/dsh-*` in `peerDependencies` | `0.2.1-rc.2` — exact |
| Manifest format | `dsh.manifestVersion` | `1` |
| Node | `engines.node` | `^22.19.0 \|\| >=24.0.0` |
| Wire protocol | `REMOTE_SESSION_PROTOCOL` / `server.hello` | `3` |
| Verification | `devDependencies` | `@deepseek-ai/dsh-*` `0.2.1-rc.2`, `@deepseek-ai/cordis` `4.0.5` |

`0.2.1-rc.2` is declared exactly, not as a range: it is the only release this plugin has been
verified against, and a later `0.2.x` may change the persistence backend, the strict
`{ kind, executable }` hello shape or the row / `data-slot` contract. DSH's admission check
reads `engines.dsh` alone (peers are ignored once it is present), so the peers are pinned to
the same exact string. Older releases do not boot it; newer ones are untested.

A host on another release is refused before pnpm downloads or runs anything. The only escape
hatch is a per-pair exemption recorded in the profile's `compatibility.json`:

```bash
dsh plugin --profile web allow-version dsh-remote-workspace@<installed version> \
  --dsh-version <the host's dsh version> --accept-risk
```

That combination is unsupported — it was never tested, and the failure modes include crashes
and session-log damage. Advancing the window is a release task: move `devDependencies` to the
new release, run `pnpm typecheck`, the provider conformance suite and the browser acceptance
run, then update `engines.dsh` in both repositories in the same version.

## How it works

```
         your machine (dsh web)                      SSH host (POSIX)
┌───────────────────────────────────┐          ┌───────────────────────────────────────┐
│ agent loop · models · credentials │  frames  │ dsh runtime (shipped with its own     │
│ RoutingSessionPersistence         │◄────────►│ Node + dsh, no system install needed) │
│   ├─ local cwd  → official JSONL  │ protocol │ fs / subprocess / sandbox / shell     │
│   └─ remote cwd → persist.* (RPC) │    3     │ sessionPersistence → JSONL (zstd)     │
│ 「远程工作区」 sidebar region      │          │ ~/.dsh/remote-server-sessions/…       │
└───────────────────────────────────┘          └───────────────────────────────────────┘
```

1. **Transport** — `ssh2` with host-key verification; WSL targets use `wsl.exe` instead.
2. **Deployment** — a Node runtime and a target-platform `dsh` tree are staged or downloaded
   into `~/.dsh/server`, and this plugin is uploaded into the profile's
   `node_modules/dsh-remote-workspace`. Remote commands are always `/bin/sh -c` with absolute
   paths; the host's `PATH`, login shell and system npm are never used.
3. **Persistence routing** — `RoutingSessionPersistence` provides the official
   `sessionPersistence` service: local cwds use the untouched JSONL backend, remote
   workspaces go to the remote `persist.*` plane. A remote session's header cwd stays the
   local stub, so the official workspace registry keeps working.
4. **UI** — the 远程工作区 region renders connections → workspaces → sessions with the
   shell's own row components (vendored under `src/client/vendor/workspace-rows/`).

## Data and security

| Location | Contents |
| --- | --- |
| Remote `~/.dsh/server/` | Deployed runtime: `node/`, `dsh/`, staging and component markers |
| Remote `~/.dsh/profiles/dsh-remote-server/` | The profile the server boots with; this plugin lives under `node_modules/dsh-remote-workspace/` |
| Remote `~/.dsh/remote-server-sessions/<projectKey>/<sessionId>/` | **Authoritative** session logs (official JSONL, zstd) |
| Remote `~/.dsh/remote-server/` | `server-id` (drives workspace ids), `workspaces.json`, `status.json` (0600) |
| Local target store | Connections, workspaces, `pinnedSessions` / `archivedSessions` |
| Local `~/.dsh/remote-assets/` | Cached runtime packages downloaded from releases |

- SSH credentials and model API keys never leave the local machine; anything shown in the UI or
  written to logs passes `scrubSecrets`.
- Unknown host keys require explicit confirmation (SHA-256); a key that changed aborts.
- Every plugin HTTP route goes through `trustedRequest` (DNS-rebinding and cross-site
  protection), with JSON bodies capped at 1 MiB.
- The bundle adds its own rows and disables one official persistence row; no official row is
  rewritten and the shell's own "add workspace" button keeps its behavior.

## Versioning and releases

- The repository version is the release, `v0.1.0-alpha1`; a new public milestone is a new tag
  `v0.1.0-alphaN`.
- The server *runtime packages* are built and released from the
  [server repository](https://github.com/graydovee/dsh-remote-workspace-server), tagged
  `server-v<dsh version>` (for example `server-v0.2.1-rc.2`). The plugin tries
  `server-v<dshVersion>` first, then `v<pluginVersion>`, and verifies the `.sha256` of the
  transfer that succeeded.

## Development

```bash
pnpm install
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run
pnpm build        # tsdown → lib/ (host, server and browser targets)
```

Tests cover official provider conformance against the in-repo `src/server` copy, the frame
mux, `~/.ssh/config` parsing, deployment, the `persist.*` handle lifecycle, routing
persistence, package download, WSL probing and the remote workspace service. The protocol and
server implementation are byte-identical with the server repository (`src/protocol.ts`,
`src/server/`, `src/frame/`, `src/provision/package-build.ts`) — change both copies together.
Sidebar rows are regenerated from a DSH source checkout with
`node scripts/vendor-workspace-rows.mjs --dsh <dsh-checkout>`.

Design notes: [`docs/remote-session-agent-note.md`](docs/remote-session-agent-note.md) and the
repository's `AGENTS.md`.

## Known limitations

- Remote sessions do not appear in the shell's global session list (the shell may log
  `uiConversation.binding: unknown session` noise for them).
- No delete-session action yet; remove a session by deleting it under
  `~/.dsh/remote-server-sessions/…` on the host.
- Inside the shell's own workspace region the corresponding official rows are hidden with
  `display: none`, not removed from the DOM.
- Session rows do not show a running/approval status dot.
- Workspace titles live in the server catalogue; renaming does not move the remote directory.
- The first frame after opening the panel can briefly show the wrong empty state.
- Downloaded runtime packages cache `tar.gz` + `.ready` (with the digest), not the release's
  `.manifest.json`.

## License

MIT
