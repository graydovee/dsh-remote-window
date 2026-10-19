# dsh-remote-workspace

English | [中文](README-zh.md)

Open an SSH host as a DeepSeek Harness workspace. The agent loop, model requests and
credentials stay on your machine; files, commands and **session logs** live on the host, so you
can resume a conversation from any machine.

## Requirements

| Where | Needs |
| --- | --- |
| Your machine | DeepSeek Harness **`0.2.1-rc.2`** with the `web` profile, Node `^22.19.0 \|\| >=24.0.0` |
| Remote host | A reachable sshd and a POSIX shell (`/bin/sh`, `tar`, `chmod`, writable `$HOME`). No Node, npm or dsh needed |
| Windows | WSL targets only; the chosen distro becomes the remote side |

Use it with `dsh web`. The desktop app does not ship the SSH packages this plugin builds on,
so install it into a `web` profile, not a desktop profile.

## Install

```bash
pnpm install
pnpm build
pnpm pack --pack-destination ~/.dsh/tarballs

dsh plugin --profile web add ~/.dsh/tarballs/dsh-remote-workspace-<version>.tgz
```

Restart the process that serves the GUI, then reload the page.

Installing from git instead of a tarball means building at install time; allow that in the
profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-remote-workspace: true
```

## Connect a host

Sidebar → **远程工作区** → **＋新建连接**.

1. **选择方式** — `SSH` for a remote host, `WSL` for a distro on this Windows machine.
2. **填写配置** — an alias (required), host, port, user, and a credential (SSH Agent, a private
   key, or a password; it is sent once and not stored in the list). **高级：远端运行时** only
   matters when the remote defaults do not fit.
3. **连接** — choose how the remote side gets its runtime, then trust the host key:
   - **复用机器上的 dsh** — use what is already installed on the host (no upload);
   - **上传 server 包** — push a runtime built for the host's architecture;
   - **远程下载** — fetch the matching release from GitHub.

   The first connection shows the host's SHA-256 fingerprint and waits for 信任并继续. A
   fingerprint that changed later stops the connection. Failures leave the connection log open.

## Use it

Click **＋** on a connection row (or **⋮ → 添加工作区**) and pick a remote directory. Workspaces
list their sessions; click the blank row to start one, or click a session to resume it.

| Action | Where | Effect |
| --- | --- | --- |
| 连接 / 重新连接 / 断开 | connection row `⋮`, or the plug icon | Opens or closes the remote channel |
| 添加工作区 | connection row `＋` | Registers a remote directory on the server |
| 新会话 | workspace row `＋`, or the blank row | Starts a session |
| 打开 / 继续 | click a session row | Resumes from the remote log |
| 置顶 / 归档 / 重命名 / 分叉 | session row `⋮` | Sorting, visual state, a real `session/title` event, or a forked session — all recorded remotely |
| 移除工作区 | workspace row `⋮` | Drops the catalogue entry; remote session logs are kept |
| 刷新 | region header | Re-reads workspaces and sessions |
| 删除连接 | connection row `⋮` | Forgets local records and credentials; the remote runtime and logs stay |

## Where your data lives

| Location | Contents |
| --- | --- |
| Remote `~/.dsh/remote-server-sessions/` | The session logs — the only authoritative copy |
| Remote `~/.dsh/server/` | The runtime this plugin deployed there |
| Local target store | Connections, workspaces, pin/archive state |
| Local `~/.dsh/remote-assets/` | Cached runtime packages |

SSH credentials and model API keys never leave your machine. Unknown host keys must be
confirmed, a changed host key aborts, and errors surface with secrets removed.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Install or startup refuses with `incompatible-version` | Your DSH is not `0.2.1-rc.2`. Install that version, or read [Compatibility](#compatibility) |
| Sidebar has no **远程工作区** section | The plugin did not mount: check the profile is `web` and restart the process serving the GUI |
| `该 server 上还没有工作区` right after opening | The workspace list was still loading; click 刷新 |
| A command fails with `no sandbox backend is usable` | The host has no sandbox backend; commands run there unconfined by design |
| Connection fails immediately | Read the connection log in the wizard, then check the account, key passphrase or agent with `ssh -v <host>` |
| `unsupported remote session protocol` | Client and remote runtime disagree; reconnect so the plugin redeploys its server |

## Compatibility

This plugin supports **exactly one DeepSeek Harness release, `0.2.1-rc.2`** (`engines.dsh`). A
newer `0.2.x` is untested, so the installer and the loader refuse it before anything runs. If you
want to try a different release anyway:

```bash
dsh plugin --profile web allow-version dsh-remote-workspace@<installed version> \
  --dsh-version <your DSH version> --accept-risk
```

That combination is unsupported. Runtime packages are published for `linux-x64`,
`linux-arm64`, `darwin-x64` and `darwin-arm64`; Windows hosts are supported as WSL targets only.

## Contributing

Changing this repository is covered by [AGENTS.md](AGENTS.md): source layout, invariants, release
rules and the acceptance loop. Users do not need it.

## License

MIT
