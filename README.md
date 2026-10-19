# dsh-remote-workspace

**Open an SSH host as a DeepSeek Harness workspace.**

This is the client half of the **Remote Session** architecture. The agent loop, model
requests, API credentials and the browser UI stay on your machine; the files,
subprocesses, shell and **session logs** live on the remote host. Sessions are
authoritative there, in the official DSH JSONL format, so resuming a conversation from
another machine needs no mirroring.

- Bundle plugin for `dsh web` (client platform `web`)
- Release: [`v0.1.0-alpha1`](https://github.com/graydovee/dsh-remote-workspace/tree/v0.1.0-alpha1)
- Server half: [`dsh-remote-workspace-server`](https://github.com/graydovee/dsh-remote-workspace-server)
- Chinese: [README-zh.md](README-zh.md)

## How it works

```
         your machine (dsh web)                      SSH host (POSIX)
┌───────────────────────────────────┐          ┌───────────────────────────────────────┐
│ agent loop · models · credentials │  frames  │ dsh runtime (shipped with its own     │
│ RoutingSessionPersistence         │◄────────►│ Node + dsh, no system install needed) │
│   ├─ local cwd  → official JSONL  │ protocol │ fs / subprocess / sandbox / shell     │
│   └─ remote cwd → persist.* (RPC) │    3     │ sessionPersistence → JSONL (zstd)     │
│ 「远程工作区」 sidebar region     │          │ ~/.dsh/remote-server-sessions/…       │
└───────────────────────────────────┘          └───────────────────────────────────────┘
```

The plugin owns four things:

1. **Transport** — `ssh2` connections with host-key verification, plus WSL targets on
   Windows hosts (`wsl.exe` instead of a network hop).
2. **Remote deployment** — a Node runtime and a target-platform `dsh` tree are staged or
   downloaded into `~/.dsh/server`, and this plugin's `package.json` / `cordis.patch.yml` /
   `lib/server.js` are uploaded into the profile's
   `node_modules/dsh-remote-workspace`. Remote commands are always `/bin/sh -c` with
   absolute paths; the host's `PATH`, login shell and system npm are never consulted.
3. **Persistence routing** — `RoutingSessionPersistence` provides the official
   `sessionPersistence` service. Sessions with a local cwd use the untouched official JSONL
   backend; remote-workspace sessions go to the remote `persist.*` plane. A remote
   session's header cwd is always the local stub, so the official workspace registry and
   session controller keep working.
4. **UI** — the **远程工作区** region in the left sidebar (above the shell's own workspace
   region) renders connections → workspaces → sessions with the official row components.

## Requirements and compatibility

### Declared in `package.json`

| What | Field | Value |
| --- | --- | --- |
| DSH host | `engines.dsh` | `0.2.1-rc.2` — exact, the only verified release |
| DSH packages | every `@deepseek-ai/dsh-*` in `peerDependencies` | `0.2.1-rc.2` — exact |
| Manifest format | `dsh.manifestVersion` | `1` |
| Node | `engines.node` | `^22.19.0 \|\| >=24.0.0` |
| Wire protocol | `REMOTE_SESSION_PROTOCOL` / `server.hello` | `3` |
| Verification | `devDependencies` | `@deepseek-ai/dsh-*` `0.2.1-rc.2`, `@deepseek-ai/cordis` `4.0.5` |

Why it is declared this way:

- **Exactly one DSH release, not a window.** `0.2.1-rc.2` is the only release this plugin has
  been verified against. A range would claim that every release inside it keeps working, and
  that is not knowable: a later `0.2.x` is free to change the `apply()`-mounted JSONL backend,
  the strict `{ kind, executable }` hello shape, or the row / `data-slot` contract this client
  mounts onto. Compatibility is earned by re-running the suite, not by widening a range.
- DSH checks **`engines.dsh`** at install time and at every profile start, and when the field
  is present **that value alone decides** — `peerDependencies` are ignored for admission. The
  peers are pinned to the same exact string so nothing in the manifest reads as "0.2.x is
  fine", and the two declarations cannot drift apart.
- Older releases do not boot it (`0.2.0-rc.x` and earlier `0.2.1` alphas lack the
  `apply()`-mounted JSONL backend and the strict hello shape); newer releases are simply
  untested.
- `@deepseek-ai/cordis` (`^4.0.5`) and `@deepseek-ai/schemastery` (`^3.18.2`) keep caret
  ranges: they are semver-stable libraries shipped *inside* the runtime, so the exact
  `engines.dsh` pin already fixes which copies we see.
- Client and server must agree on wire protocol `3`. A mismatched pair fails with
  `unsupported remote session protocol …` instead of degrading silently; the server half
  declares the same exact DSH release.

**A host on any other release is refused** (`incompatible-version`, requirement keyed
`engines.dsh`) before pnpm downloads or runs anything. The only escape hatch is a per-pair
exemption recorded in the profile's `compatibility.json`:

```bash
dsh plugin --profile web allow-version dsh-remote-workspace@<version you installed> \
  --dsh-version <the host's dsh version> --accept-risk
```

That combination is explicitly unsupported — it was never tested, and the failure modes
include crashes and session-log damage.

**Advancing the window is a release task**, never a range edit: move `devDependencies` to the
new release, run `pnpm typecheck`, the provider conformance suite and the browser acceptance
run, then update `engines.dsh` in both repositories in the same version.

### Runtime matrix

| Role | Requirement |
| --- | --- |
| Local host | `dsh` **`0.2.1-rc.2`** with the `web` profile; Node `^22.19.0 \|\| >=24.0.0`; macOS, Linux or Windows |
| Remote host (SSH) | POSIX: `/bin/sh`, `tar`, `chmod`, a writable `$HOME`, reachable sshd. **No Node or npm required** — the deployment ships its own runtime |
| Remote target (WSL) | Windows hosts only; the selected distro becomes the execution world |
| Server packages | `linux-x64-gnu`, `linux-arm64-gnu`, `darwin-x64`, `darwin-arm64` |

Windows is deliberately absent from the server-package matrix: every provisioning script is
`/bin/sh` + `tar` + `chmod`, and a Windows remote would need its own deployer.

Use the `web` profile. The desktop app image does not ship the SSH packages
(`@deepseek-ai/dsh-ssh`, `dsh-fs-ssh`, `dsh-subprocess-ssh`, `dsh-sandbox-ssh`), so this
plugin is a `dsh web` feature; do not install it into a desktop profile.

## Install

The package is not on a registry yet. Install a built tarball (or a git checkout):

```bash
pnpm install
pnpm build
pnpm pack --pack-destination ~/.dsh/tarballs

dsh plugin --profile web remove dsh-remote-workspace   # only if already installed
dsh plugin --profile web add ~/.dsh/tarballs/dsh-remote-workspace-<version>.tgz
```

Restart the process that serves the GUI, then reload the page. This is a **bundle** plugin:
`dsh plugin add` also appends it to the profile's `dsh.profile.bundles`, and a restart is
what mounts the patch layer.

A git install fetches sources, not build output, so allow the package's `prepare` build in
the profile's `pnpm-workspace.yaml` and pin a commit:

```bash
dsh plugin --profile web add "github:graydovee/dsh-remote-workspace#<commit>"
```

```yaml
allowBuilds:
  dsh-remote-workspace: true
```

## First connection

1. Left sidebar → **远程工作区** → **＋新建连接**.
2. Enter host, port and user, choose the credential, and confirm the host key fingerprint
   (SHA-256). An unknown key must be confirmed explicitly; a **changed** key aborts.
3. Pick where the remote runtime comes from:
   - **download** — the server package is fetched from the release of the server repository;
   - **upload** — a tarball you built yourself is pushed to the host;
   - **reuse** — an already installed `dsh` on the host is used as-is.
4. Add a workspace (a remote directory), then open an existing session or start a new one.

Deployment is lock-guarded: a second client cannot interleave its upload into the same
install root.

## The sidebar: connections → workspaces → sessions

```
远程工作区                      [刷新] [＋新建连接]
└─ 🌐 connection   mac-arm-200  [+ add workspace | connect]  [⋮ connect/disconnect · forget]
   └─ 📁 workspace  dujiahui    [+ new session]              [⋮ refresh · remove workspace]
      ├─ session title  45 min  [⋮ pin · rename · fork · archive]
      └─ New session            (the official blank row)
工作区                          ← the shell's own region, unchanged
```

- The connection row's folder glyph carries the connection state (green / red / grey); while
  a target is disconnected or failed, the `＋` slot turns into a plug that connects.
- Disconnecting folds the subtree, reconnecting expands it again.
- Session verbs: **pin**, **rename**, **fork**, **archive**. Pin and archive live on the
  plugin's own workspace record (the shell's pin path validates against the local session
  index, which remote sessions are not in); rename appends a real `session/title` event to
  the remote log; fork goes through the shell's own `forkSession` and lands on the remote.
- Rows are the shell's own row components, vendored under
  `src/client/vendor/workspace-rows/` and rendered with their official stylesheet; only the
  region's own chrome (host box, height chain, connection states) is plugin CSS. The
  vendored layer is regenerated from a DSH source checkout with
  `node scripts/vendor-workspace-rows.mjs --dsh <dsh-checkout>`.

## Where everything is stored

| Location | Contents |
| --- | --- |
| Remote `~/.dsh/server/` | Deployed runtime: `node/`, `dsh/`, staging and component markers |
| Remote `~/.dsh/profiles/dsh-remote-server/` | The profile the server boots with; this plugin's files live under `node_modules/dsh-remote-workspace/` |
| Remote `~/.dsh/remote-server-sessions/<projectKey>/<sessionId>/` | **Authoritative** session logs (official JSONL, zstd frames) |
| Remote `~/.dsh/remote-server/` | `server-id` (drives workspace ids), `workspaces.json` (server-owned catalogue), `status.json` (0600 discovery manifest) |
| Local target store | Connections, workspaces, `pinnedSessions` / `archivedSessions` |
| Local `~/.dsh/remote-assets/` | Cached server packages downloaded from releases |
| Local `~/.dsh/sessions/` | Never receives a remote session |

## Security model

- **Credentials never cross the wire.** SSH credentials and model API keys stay on the local
  machine; anything shown in the UI or written to logs passes `scrubSecrets`.
- **Host keys are pinned.** Unknown fingerprints require explicit confirmation (SHA-256 is
  displayed); a key that changed aborts the connection.
- **Every plugin HTTP route goes through `trustedRequest`** (DNS-rebinding and cross-site
  protection), and JSON request bodies are capped at 1 MiB.
- **The remote world is the isolation boundary.** The plugin does not weaken a host's own
  sandbox policy. When the remote has no usable sandbox backend (for example a WSL distro
  without bubblewrap/Landlock), commands run unconfinced *inside that host* and the result
  reports `enforcement: 'partial'` rather than pretending to be confined.
- **Zero in-place patching.** The bundle adds its own rows and disables one official
  persistence row (`session-persistence-jsonl`, restated in `cordis.patch.yml`); no official
  row is rewritten and the shell's own "add workspace" button keeps its behavior.

## Versioning and releases

- **The repository version is the release, `v0.1.0-alpha1`.** Everything committed —
  `package.json`, the embedded remote-server version strings and `lib/` — carries it.
- **A local deployment adds a revision suffix instead of inventing a new number:**
  `0.1.0-alpha1.1`, `0.1.0-alpha1.2`, … The deploy loop raises the suffix on the machine that
  deploys, so the plugin bundle URL (`&rev=<hash>`) busts the browser cache; the same string
  shows up in `/api/state` (`pluginVersion`) and the remote `server.hello.version`. Bump
  **before** `pnpm build` — the server's fallback version is compiled into `lib/server.js`.
  It is never committed: after the deploy the tree goes back with
  `git checkout -- package.json src/server/index.ts && pnpm build`.
- A new public milestone is a new tag (`v0.1.0-alphaN`), and the suffix restarts at `.1`.
- **The exact `engines.dsh` moves with the harness, not with time.** Accepting a new DSH
  release means a new plugin version whose `devDependencies` and `engines.dsh` both name it;
  until that release exists, the current one keeps refusing other hosts instead of guessing.
- The server *runtime packages* are built and released **from the server repository**, tagged
  `server-v<dsh version>` (for example `server-v0.2.1-rc.2`). The plugin looks for
  `server-v<dshVersion>` first, then `v<pluginVersion>`, and verifies the `.sha256` of
  whichever transfer succeeded.

## Development

```bash
pnpm install
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run
pnpm build        # tsdown → lib/ (host, server and browser targets)
```

Tests cover official provider conformance against the in-repo `src/server` copy, the frame
mux, `~/.ssh/config` parsing, deployment, the `persist.*` handle lifecycle, routing
persistence, package download, WSL probing and the remote workspace service.

The protocol and server implementation are **byte-identical** with the server repository
(`src/protocol.ts`, `src/server/`, `src/frame/`, `src/provision/package-build.ts`); change
both copies together.

Design notes live in [`docs/remote-session-agent-note.md`](docs/remote-session-agent-note.md)
and in the repository's `AGENTS.md`.

## Known limitations (alpha)

- Remote sessions do not appear in the shell's global session list; the shell may log
  `uiConversation.binding: unknown session` noise for them.
- There is no delete-session verb yet; remove a session by deleting it under
  `~/.dsh/remote-server-sessions/…` on the host.
- Inside the shell's own workspace region the corresponding official rows are hidden with
  `display: none` (they are not removed from the DOM).
- Session rows do not show a running/approval status dot.
- Workspace titles live in the server-owned catalogue, but renaming does not move the remote
  directory.
- The first frame after opening the panel can briefly show the wrong empty state; a refresh
  settles it.
- Downloading a server package caches `tar.gz` + `.ready` (with the digest) but not the
  release's `.manifest.json`.

## License

MIT
