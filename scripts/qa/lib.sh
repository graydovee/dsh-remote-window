#!/usr/bin/env bash
# Shared helpers for the disposable Docker/SSH QA target.
# Source this file; do not execute it directly.
set -euo pipefail

QA_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QA_ROOT="${DSH_QA_ROOT:-/tmp/dsh-qa}"
QA_NAME="${QA_NAME:-server}"
QA_DIR="$QA_ROOT/$QA_NAME"
QA_STATE="$QA_DIR/state.env"

QA_DSH_VERSION_DEFAULT="0.2.1-rc.3"
QA_MOCK_API_KEY_DEFAULT="qa-mock-key"
QA_MOCK_PORT_DEFAULT="28080"
QA_WEB_HOST_DEFAULT="127.0.0.1"

qa_log() { printf '[qa] %s\n' "$*" >&2; }
qa_die() { printf '[qa] ERROR: %s\n' "$*" >&2; exit 1; }

qa_require_docker() {
  command -v docker >/dev/null 2>&1 || qa_die "docker CLI not found"
  docker info >/dev/null 2>&1 || qa_die "Docker daemon is not reachable"
}

qa_require_host_tool() {
  command -v "$1" >/dev/null 2>&1 || qa_die "host tool '$1' is required"
}

qa_state_set() {
  # qa_state_set KEY VALUE [KEY VALUE ...]
  mkdir -p "$QA_DIR"
  local tmp="$QA_STATE.tmp"
  : > "$tmp"
  while [ "$#" -ge 2 ]; do
    printf '%s=%q\n' "$1" "$2" >> "$tmp"
    shift 2
  done
  mv "$tmp" "$QA_STATE"
}

qa_load_state() {
  [ -f "$QA_STATE" ] || qa_die "no QA state at $QA_STATE; run scripts/qa/start.sh first"
  # shellcheck disable=SC1090
  . "$QA_STATE"
  QA_CONTAINER="${QA_CONTAINER:-dsh-qa-$QA_NAME}"
}

qa_container_exists() {
  docker inspect "$QA_CONTAINER" >/dev/null 2>&1
}

qa_container_running() {
  [ "$(docker inspect -f '{{.State.Running}}' "$QA_CONTAINER" 2>/dev/null || true)" = "true" ]
}

qa_container_require_running() {
  qa_container_running || qa_die "container $QA_CONTAINER is not running; run scripts/qa/start.sh"
}

qa_ssh_opts() {
  printf '%s\n' \
    -i "$QA_DIR/keys/id_ed25519" \
    -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=accept-new \
    -o UserKnownHostsFile="$QA_DIR/known_hosts" \
    -o ConnectTimeout=5 \
    -o ServerAliveInterval=15 \
    -o LogLevel=ERROR
}

qa_ssh() {
  [ -n "${QA_SSH_PORT:-}" ] || qa_load_state
  local -a opts=()
  while IFS= read -r line; do opts+=("$line"); done < <(qa_ssh_opts)
  ssh "${opts[@]}" -p "$QA_SSH_PORT" "tester@127.0.0.1" "$@"
}

qa_docker_exec() {
  # Run a command as tester with the isolated DSH_HOME, in the workspace dir.
  docker exec -i -u tester \
    -e HOME=/home/tester \
    -e DSH_HOME=/home/tester/.dsh \
    -e LANG=C.UTF-8 \
    -w /home/tester/work \
    "$QA_CONTAINER" "$@"
}

qa_docker_exec_bash() {
  docker exec -i -u tester \
    -e HOME=/home/tester \
    -e DSH_HOME=/home/tester/.dsh \
    -e LANG=C.UTF-8 \
    -w /home/tester/work \
    "$QA_CONTAINER" bash -lc "$*"
}

qa_port_busy() {
  local port="$1"
  if command -v nc >/dev/null 2>&1; then
    nc -z -w 1 127.0.0.1 "$port" >/dev/null 2>&1
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  else
    qa_die "need nc or lsof to check host ports"
  fi
}

qa_pick_free_port() {
  local port="$1"
  local limit=$((port + 200))
  while [ "$port" -lt "$limit" ]; do
    if ! qa_port_busy "$port"; then
      printf '%s\n' "$port"
      return 0
    fi
    port=$((port + 1))
  done
  qa_die "no free host port in range starting at $1"
}

qa_ensure_key() {
  mkdir -p "$QA_DIR/keys"
  chmod 700 "$QA_DIR/keys"
  if [ ! -f "$QA_DIR/keys/id_ed25519" ]; then
    qa_log "generating disposable QA ssh key"
    ssh-keygen -q -t ed25519 -N '' -C "dsh-qa-$QA_NAME" \
      -f "$QA_DIR/keys/id_ed25519" >/dev/null
  fi
}

qa_relax_mount_perms() {
  # Docker Desktop bind mounts show host files as root:root inside the
  # container, so the unprivileged tester user needs world write to keep
  # server data writable across container re-creations. QA-only, /tmp-only.
  mkdir -p "$QA_DIR/work" "$QA_DIR/run" "$QA_DIR/mock" "$QA_DIR/logs"
  chmod 777 "$QA_DIR/work" "$QA_DIR/run" "$QA_DIR/mock" "$QA_DIR/logs"
  chmod -R a+rwX "$QA_DIR/work" "$QA_DIR/run" "$QA_DIR/mock" "$QA_DIR/logs" 2>/dev/null || true
}

qa_print_summary() {
  qa_load_state
  printf '\nQA target ready\n'
  printf '  name        %s\n' "$QA_NAME"
  printf '  container   %s (%s)\n' "$QA_CONTAINER" "$(docker inspect -f '{{.State.Status}}' "$QA_CONTAINER" 2>/dev/null || echo absent)"
  printf '  image       %s\n' "$QA_IMAGE"
  printf '  node        %s\n' "$QA_NODE"
  printf '  dsh         %s\n' "$QA_DSH_VERSION"
  printf '  ssh         ssh -i %s -p %s tester@127.0.0.1\n' "$QA_DIR/keys/id_ed25519" "$QA_SSH_PORT"
  printf '  web access  ssh local forward 127.0.0.1:%s (scripts/qa/web-start.sh)\n' "$QA_WEB_PORT"
  printf '  data dir    %s\n' "$QA_DIR"
  printf '  dsh home    docker volume %s\n' "${QA_VOLUME:-?}"
  printf '  ssh bind    '\''docker port %s 22'\'' must show 127.0.0.1:%s\n' "$QA_CONTAINER" "$QA_SSH_PORT"
}
