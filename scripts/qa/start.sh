#!/usr/bin/env bash
# Start (or reuse) the disposable Linux Docker + SSH target for QA.
#
#   scripts/qa/start.sh [--name server] [--node 22|24]
#                       [--ssh-port 22022] [--web-port 24022]
#                       [--dsh-version 0.2.1-rc.2] [--rebuild] [--recreate]
#                       [--auto-ports]
#
# The container publishes SSH and the future dsh web port on 127.0.0.1 only.
# Server data lives under /tmp/dsh-qa/<name>/ (bind-mounted into the container);
# the real ~/.dsh is never touched.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

NAME="server"
NODE_MAJOR="22"
SSH_PORT="22022"
WEB_PORT="24022"
DSH_VERSION="$QA_DSH_VERSION_DEFAULT"
REBUILD=0
RECREATE=0
AUTO_PORTS=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --node) NODE_MAJOR="$2"; shift 2 ;;
    --ssh-port) SSH_PORT="$2"; shift 2 ;;
    --web-port) WEB_PORT="$2"; shift 2 ;;
    --dsh-version) DSH_VERSION="$2"; shift 2 ;;
    --rebuild) REBUILD=1; shift ;;
    --recreate) RECREATE=1; shift ;;
    --auto-ports) AUTO_PORTS=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) qa_die "unknown argument: $1" ;;
  esac
done

case "$NODE_MAJOR" in
  22|24) ;;
  *) qa_die "--node must be 22 or 24 (got $NODE_MAJOR)" ;;
esac
case "$NAME" in
  *[!a-z0-9-]*) qa_die "--name must be lowercase letters, digits and dashes" ;;
esac

QA_NAME="$NAME"
QA_DIR="$QA_ROOT/$QA_NAME"
QA_STATE="$QA_DIR/state.env"
QA_IMAGE="dsh-qa-server:node${NODE_MAJOR}-${DSH_VERSION}"
QA_CONTAINER="dsh-qa-$NAME"
QA_VOLUME="dsh-qa-$NAME-dsh-home"
QA_SSH_PASSWORD="${QA_SSH_PASSWORD:-qa-fixture-password}"

qa_require_docker
qa_require_host_tool ssh
qa_require_host_tool ssh-keygen

# Reuse a running target instead of silently replacing it.
if qa_container_running; then
  if [ "$RECREATE" -eq 0 ] && [ -f "$QA_STATE" ]; then
    qa_log "container $QA_CONTAINER is already running; reuse it (--recreate to replace)"
    qa_print_summary
    exit 0
  fi
  qa_log "removing existing running container $QA_CONTAINER (data dir is kept)"
  docker rm -f "$QA_CONTAINER" >/dev/null
elif qa_container_exists; then
  qa_log "removing stopped container $QA_CONTAINER"
  docker rm -f "$QA_CONTAINER" >/dev/null
fi

mkdir -p "$QA_DIR"/{work,keys,run,mock,logs}
qa_ensure_key
qa_relax_mount_perms
# Named volume, not a bind mount: Docker Desktop maps host files to root:root
# inside the container, which breaks DSH's owner-only credential/session modes.
docker volume create --label dsh.qa=1 --label "dsh.qa.name=$NAME" "$QA_VOLUME" >/dev/null

# Port safety: published on loopback only, but still fail loudly instead of
# colliding with a real listener.
if qa_port_busy "$SSH_PORT"; then
  if [ "$AUTO_PORTS" -eq 1 ]; then
    SSH_PORT="$(qa_pick_free_port "$SSH_PORT")"
    qa_log "ssh port busy; picked $SSH_PORT"
  else
    qa_die "127.0.0.1:$SSH_PORT is already in use (use --ssh-port or --auto-ports)"
  fi
fi
if qa_port_busy "$WEB_PORT"; then
  if [ "$AUTO_PORTS" -eq 1 ]; then
    WEB_PORT="$(qa_pick_free_port "$WEB_PORT")"
    qa_log "web port busy; picked $WEB_PORT"
  else
    qa_die "127.0.0.1:$WEB_PORT is already in use (use --web-port or --auto-ports)"
  fi
fi

if [ "$REBUILD" -eq 1 ] || ! docker image inspect "$QA_IMAGE" >/dev/null 2>&1; then
  qa_log "building image $QA_IMAGE (node $NODE_MAJOR, dsh $DSH_VERSION)"
  docker build \
    --build-arg "NODE_MAJOR=$NODE_MAJOR" \
    --build-arg "DSH_VERSION=$DSH_VERSION" \
    -t "$QA_IMAGE" "$HERE"
else
  qa_log "reusing image $QA_IMAGE"
fi

qa_log "starting container $QA_CONTAINER"
docker run -d \
  --name "$QA_CONTAINER" \
  --hostname "dsh-qa-$NAME" \
  --label "dsh.qa=1" \
  --label "dsh.qa.name=$NAME" \
  -p "127.0.0.1:${SSH_PORT}:22" \
  -v "$QA_VOLUME:/home/tester/.dsh" \
  -v "$QA_DIR/work:/home/tester/work" \
  -v "$QA_DIR/run:/home/tester/qa-run" \
  -v "$QA_DIR/mock:/home/tester/qa-mock" \
  -v "$QA_DIR/keys/id_ed25519.pub:/qa/authorized_keys.pub:ro" \
  -e "QA_WEB_PORT=$WEB_PORT" \
  -e "QA_MOCK_API_KEY=$QA_MOCK_API_KEY_DEFAULT" \
  -e "QA_TESTER_PASSWORD=$QA_SSH_PASSWORD" \
  "$QA_IMAGE" >/dev/null

qa_log "waiting for sshd on 127.0.0.1:$SSH_PORT"
ready=0
for _ in $(seq 1 60); do
  if ssh -i "$QA_DIR/keys/id_ed25519" \
       -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
       -o UserKnownHostsFile="$QA_DIR/known_hosts" -o ConnectTimeout=2 \
       -o LogLevel=ERROR -p "$SSH_PORT" tester@127.0.0.1 true >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  docker logs --tail 40 "$QA_CONTAINER" >&2 || true
  qa_die "sshd did not become ready on 127.0.0.1:$SSH_PORT"
fi

qa_state_set \
  QA_NAME "$NAME" \
  QA_NODE "$NODE_MAJOR" \
  QA_DSH_VERSION "$DSH_VERSION" \
  QA_IMAGE "$QA_IMAGE" \
  QA_CONTAINER "$QA_CONTAINER" \
  QA_VOLUME "$QA_VOLUME" \
  QA_SSH_PORT "$SSH_PORT" \
  QA_WEB_PORT "$WEB_PORT" \
  QA_WEB_HOST "127.0.0.1" \
  QA_MOCK_PORT "$QA_MOCK_PORT_DEFAULT" \
  QA_MOCK_API_KEY "$QA_MOCK_API_KEY_DEFAULT" \
  QA_MOCK_SEQUENCE "tool_call_success,success" \
  QA_MOCK_TEXT "QA mock model reply: the real DSH agent loop completed this server-side turn." \
  QA_SSH_PASSWORD "$QA_SSH_PASSWORD"

QA_SSH_PORT="$SSH_PORT"
node_version="$(qa_ssh 'node --version')"
dsh_version="$(qa_ssh 'dsh --version' 2>&1 | head -1)"
ssh_version="$(qa_ssh 'ssh -V' 2>&1 | head -1 || true)"

{
  printf 'QA target started: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'image: %s\n' "$QA_IMAGE"
  printf 'container: %s\n' "$QA_CONTAINER"
  printf 'node: %s\n' "$node_version"
  printf 'dsh: %s\n' "$dsh_version"
  printf 'ssh: %s\n' "$ssh_version"
  printf 'published ports:\n'
  docker port "$QA_CONTAINER"
} | tee "$QA_DIR/logs/start.log"

if ! printf '%s' "$dsh_version" | grep -q "$DSH_VERSION"; then
  qa_log "WARNING: dsh --version output does not mention $DSH_VERSION: $dsh_version"
fi

qa_print_summary
