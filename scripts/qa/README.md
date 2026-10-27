# QA Linux target (`scripts/qa/`)

Disposable Docker + SSH box that plays the remote **server** side of
`dsh-remote-workspace`. It runs an ordinary global `@deepseek-ai/dsh` (no plugin
required) so the "server is a normal DSH" baseline can be verified before the
new server plugin exists.

## What it guarantees

- Linux container, Node 22 or 24, global `@deepseek-ai/dsh@0.2.1-rc.3`.
- SSH published on `127.0.0.1:<port>` only; key auth only; no root login.
- Isolated server data: `~/.dsh` inside the container is bind-mounted from
  `/tmp/dsh-qa/<name>/home`, the workspace from `/tmp/dsh-qa/<name>/work`.
  The real `~/.dsh` is never mounted or modified.
- Model fixture: the official Messages mock server
  (`@deepseek-ai/dsh-llm-mock-server`) replaces **only the model HTTP endpoint**
  used by `dsh-llm-deepseek`; the agent loop, tool execution, files and session
  logs stay real. The fixture key `qa-mock-key` is not a credential.
- Everything is removable with `cleanup.sh`: container, images (optional),
  `/tmp/dsh-qa/**`, host ports.

## Layout and auth

- `~/.dsh` lives in a **named Docker volume** (`dsh-qa-<name>-dsh-home`): Docker Desktop
  bind mounts present host files as `root:root`, which breaks DSH's owner-only
  credential/session modes. The volume keeps real ownership; workspace and evidence
  stay under `/tmp/dsh-qa/<name>/` (bind mounts).
- SSH is the only published port (`127.0.0.1:<ssh>`). Password auth is enabled with a
  per-instance **QA fixture** password (`QA_SSH_PASSWORD`, default `qa-fixture-password`)
  for the client-host password-auth path; the container is loopback-only and holds no
  real credential. Key auth stays available.
- `dsh web` binds `127.0.0.1` inside the container; the host reaches it through an SSH
  local forward opened by `web-start.sh` / `profile-start.sh`. No web port is published.

## Typical flow

```sh
# 1. start (builds the image on first run; ~1-3 min)
scripts/qa/start.sh                      # node 22, ssh 22022, web 24022
scripts/qa/start.sh --name server24 --node 24 --ssh-port 22024 --web-port 24024

# 2. verify the global DSH is standalone
scripts/qa/status.sh
scripts/qa/exec.sh -- dsh --version
scripts/qa/ssh.sh -- node --version

# 3. server-side baseline: global dsh web + mock model
scripts/qa/web-start.sh                  # prints the token URL (host 127.0.0.1:24022)
scripts/qa/mock-start.sh --sequence success   # optional: override fixture behavior

# 4. server plugin install entry (D11 / per-client profile)
scripts/qa/install-server-plugin.sh --check
scripts/qa/install-server-plugin.sh --profile graydovee-remote-workspace-qa1 \
  --tarball /path/to/dsh-remote-workspace-server-*.tgz

# 5. per-client profile + server plugin (offline install contract)
scripts/qa/install-server-plugin.sh --profile graydovee-remote-workspace-qa1 \
  --tarball /path/to/dsh-remote-workspace-server-0.1.0-alpha.3.tgz \
  --sha256 <sha256> --create-profile
scripts/qa/profile-start.sh --profile graydovee-remote-workspace-qa1
scripts/qa/profile-handshake.sh --profile graydovee-remote-workspace-qa1
scripts/qa/profile-smoke.sh --profile graydovee-remote-workspace-qa1
scripts/qa/session-log.sh --list
scripts/qa/session-log.sh --events          # compact turn/tool/assistant summary
scripts/qa/profile-stop.sh --profile graydovee-remote-workspace-qa1

# 6. stop / cleanup
scripts/qa/web-stop.sh
scripts/qa/stop.sh                        # keeps /tmp/dsh-qa data
scripts/qa/cleanup.sh --all --images --yes
```

## Notes

- `web-start.sh` starts `dsh web --host 0.0.0.0 --port <port>` **inside** the
  container because the container port is published to the host loopback. The
  host mapping is still `127.0.0.1:<port>`; nothing is exposed on a LAN
  interface. The real deployment requirement (server listens on no public
  port; the client uses an SSH tunnel) is exercised by the client plugin later.
- Docker Desktop bind mounts show host files as `root:root` inside the
  container. `start.sh` relaxes permissions on the `/tmp/dsh-qa` data dirs so
  the unprivileged `tester` user can keep writing across container restarts.
  This is QA-only and never applies to a real host.
- `mock-start.sh` evidence: `/tmp/dsh-qa/<name>/mock/requests.jsonl` and
  `attempt-<n>.json` (full request body the real agent sent), `ready.json`,
  and `/tmp/dsh-qa/<name>/run/mock.log`.
- `dsh web` output (including the one-time token URL) is in
  `/tmp/dsh-qa/<name>/run/web.log`; profile servers log to
  `/tmp/dsh-qa/<name>/run/profile-<profile>.log`. Do not paste the token into reports;
  strip the `?token=...` query.
- Session logs are zstd-compressed (`session.v4.jsonl.zstd`); use `session-log.sh`
  instead of reading them on the host.
- `install-server-plugin.sh` follows the offline install contract (extract
  `package/`, register the bundle, no npm/pnpm/network). It links
  `@deepseek-ai/schemastery` from the global DSH install because the current server
  plugin imports it by name and the client-side offline deploy does not provide it.
