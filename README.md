# dsh-remote-workspace

English | [中文](README-zh.md)

`dsh-remote-workspace` adds remote workspaces to the DeepSeek Harness **web** profile. It keeps the
agent loop, model calls and credentials on your computer while the remote machine owns the files,
commands and session logs. You can therefore reconnect the same workspace from another computer
without copying a local session directory.

The project has two repositories:

- [client](https://github.com/graydovee/dsh-remote-workspace) — the DSH plugin, browser UI, SSH/WSL
  transport and provisioning code.
- [server](https://github.com/graydovee/dsh-remote-workspace-server) — the headless DSH plugin that
  runs on the target and serves the filesystem, processes, sandbox bridge and remote session store.

The client normally deploys and starts the server for you. There is no listening port on the target;
the server speaks a framed RPC protocol over the SSH or WSL stdio channel.

## What you can do

- Add an SSH host, or a WSL distribution on Windows.
- Browse remote directories and register them as workspaces.
- Start, resume, rename, fork, pin and archive sessions whose logs stay on the target.
- Run DSH filesystem, process, terminal and sandbox operations in the remote execution world.
- Reuse a compatible `dsh` already installed on the target, upload a runtime package from the client,
  or download a published package for the target architecture.
- Share one remote workspace between multiple client machines because the workspace registry and
  session logs are server-authoritative.

## Requirements

| Location | Requirement |
| --- | --- |
| Local machine | DeepSeek Harness `0.2.1-rc.2`, the `web` profile, and Node `^22.19.0 \|\| >=24.0.0` |
| SSH target | Reachable `sshd`, a POSIX `/bin/sh`, `tar`, `chmod`, and a writable home directory |
| WSL target | Windows with `wsl.exe` and a usable POSIX distribution |
| Network | The local machine must reach the SSH target; package download mode also needs release access |

The target does not need Node, npm or DSH when you choose upload or download mode. The client stages
the matching runtime under `~/.dsh/server/`. Windows is supported as a **client host for WSL targets**;
the remote execution world itself is POSIX.

## Install in a web profile

Build and pack the plugin from a checkout:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm pack --pack-destination ~/.dsh/tarballs
dsh plugin --profile web add ~/.dsh/tarballs/dsh-remote-workspace-<version>.tgz
```

Restart the process that serves `dsh web`, then reload the page. Install this plugin in the `web`
profile; the desktop profile does not provide the browser module table and SSH dependencies used by
this package.

When installing from a Git dependency, allow the package's build script in the profile's
`pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-remote-workspace: true
```

## Connect a target

Open **Remote Workspaces** in the sidebar and choose **New connection**.

1. Choose `SSH`, or `WSL` on Windows.
2. Enter an alias and the target details. SSH supports an agent, a private key, or a password. A
   password or key passphrase is used for the connection and is kept in the local credential store;
   it is never part of a workspace record or sent to the server plugin.
3. Run the read-only probe, choose a runtime source, then connect:

   | Choice | Behavior |
   | --- | --- |
   | Reuse installed DSH | Validates a compatible launcher already on the target and deploys only this plugin's profile files. |
   | Upload server package | Builds or uses a verified local package for the target OS/CPU, uploads it, and installs it under `~/.dsh/server/`. |
   | Download server package | Downloads the matching release asset on the local side, verifies its SHA-256 companion, then uploads it to the target. |

   For SSH, the first connection displays the host's SHA-256 key fingerprint. Explicitly trust it to
   continue. A later key change stops the connection; it is never silently accepted. WSL is a local
   process and has no host key prompt.

## Work with sessions

Use the plus action on a connection to browse and add a remote directory. A workspace row contains
its sessions and a blank row for a new session.

| Action | Result |
| --- | --- |
| Connect / reconnect / disconnect | Opens or closes the target's one shared channel. |
| Add workspace | Registers the directory in the target's server-side workspace registry. |
| Open / continue | Resumes a session from the target's JSONL log. |
| New session | Creates a session whose events are written to the target. |
| Rename session | Appends a `session/title` event remotely without opening the session. |
| Fork session | Uses the shell's normal fork operation and preserves inherited event metadata. |
| Pin / archive | Stores client-side view state; it does not rewrite the remote log. |
| Rename workspace | Changes the server-side display title; the physical directory does not move. |
| Remove workspace | Removes the registry entry. Existing session logs remain on the target. |
| Delete connection | Forgets local target metadata and credentials. It does not delete remote files or logs. |

Only one server process is started per target. Browsing and agent operations share its channel, which
prevents split session handles and conflicting write leases.

## Data and security

| Location | Contents |
| --- | --- |
| Target `~/.dsh/remote-server-sessions/` | Authoritative remote session logs |
| Target `~/.dsh/remote-server/` | Server identity, workspace index and status manifest |
| Target `~/.dsh/server/` | Uploaded Node/DSH runtime and the deployed server bundle |
| Local DSH storage | Target records, workspace references and pin/archive view state |
| Local `~/.dsh/remote-assets/` | Verified Node and server-package cache |

Model API keys and SSH credentials stay on the local machine. HTTP routes are same-origin/trusted,
request bodies are size-limited, and displayed errors are scrubbed of secrets. Remote sandbox support
depends on the target's available backend; when no backend exists, the remote world reports partial
enforcement and executes the requested argv there.

## Compatibility and platform limits

This release is tested against exactly DSH `0.2.1-rc.2`. The plugin and server package declare that
version precisely and reject other releases before the remote world starts. Runtime release assets
currently cover `linux-x64-gnu`, `linux-arm64-gnu`, `darwin-x64` and `darwin-arm64`. A Windows host
uses WSL; there is no native Windows remote package.

If you intentionally test another DSH version, use the profile's risk-acceptance command and expect
unsupported behavior:

```bash
dsh plugin --profile web allow-version dsh-remote-workspace@<installed-version> \
  --dsh-version <dsh-version> --accept-risk
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `incompatible-version` | Install DSH `0.2.1-rc.2` in the local web profile. |
| Remote Workspaces is missing | Confirm the plugin is installed in `web`, restart `dsh web`, and reload the page. |
| The first view says there are no workspaces | Wait for the server list to load, then use Refresh. |
| SSH fails before provisioning | Check the account, private-key permissions, agent and fingerprint; `ssh -v <host>` is useful. |
| `unsupported remote session protocol` | Reconnect so the client redeploys the matching server bundle. |
| A command reports no usable sandbox backend | The target has no confinement backend; this is the documented partial-enforcement path. |
| A reused launcher is rejected | Select a DSH launcher whose `--version` is compatible, or choose Upload server package. |

## Development

Read [AGENTS.md](AGENTS.md) before changing code. It defines the client/server byte-for-byte sync
contract, storage and security invariants, build targets, test matrix and release procedure. The
server repository has its own [README](https://github.com/graydovee/dsh-remote-workspace-server) and
[AGENTS.md](https://github.com/graydovee/dsh-remote-workspace-server/blob/main/AGENTS.md).

## License

MIT
