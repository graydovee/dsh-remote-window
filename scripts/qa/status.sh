#!/usr/bin/env bash
# Show the QA target state and collect baseline evidence (no secrets).
#
#   scripts/qa/status.sh [--name server] [--json]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

NAME="server"
JSON=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --json) JSON=1; shift ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) qa_die "unknown argument: $1" ;;
  esac
done

QA_NAME="$NAME"
QA_DIR="$QA_ROOT/$QA_NAME"
QA_STATE="$QA_DIR/state.env"
QA_CONTAINER="dsh-qa-$NAME"
qa_require_docker

if [ -f "$QA_STATE" ]; then
  # shellcheck disable=SC1090
  . "$QA_STATE"
else
  qa_log "WARNING: no state file at $QA_STATE; is the target started?"
fi

status="absent"
if qa_container_exists; then
  status="$(docker inspect -f '{{.State.Status}} (up since {{.State.StartedAt}})' "$QA_CONTAINER" 2>/dev/null)"
fi

if qa_container_running; then
  set +e
  remote="$(qa_docker_exec_bash 'set -u
    printf "node=%s\n" "$(node --version)"
    printf "dsh=%s\n" "$(dsh --version 2>&1 | head -1)"
    printf "user=%s uid=%s\n" "$(id -un)" "$(id -u)"
    printf "dsh_home=%s\n" "${DSH_HOME:-unset}"
    if [ -d "$DSH_HOME" ]; then
      printf "profiles=%s\n" "$(ls "$DSH_HOME/profiles" 2>/dev/null | tr "\n" " ")"
      printf "sessions=%s\n" "$(find "$DSH_HOME/sessions" -type f 2>/dev/null | wc -l | tr -d " ")"
    else
      printf "profiles=absent\nsessions=0\n"
    fi
    printf "web_pids=%s\n" "$(pgrep -af "[d]sh web --host" | tr "\n" "|" || true)"
    printf "mock_pids=%s\n" "$(pgrep -af "[m]ock-llm.mjs" | tr "\n" "|" || true)"
    printf "work=%s\n" "$(ls -A /home/tester/work 2>/dev/null | tr "\n" " ")"
  ' 2>&1)"
  set -e
  if [ "$JSON" -eq 1 ]; then
    printf '{"name":%q,"container":%q,"status":%q,"ports":%q,"remote":%q}\n' \
      "$NAME" "$QA_CONTAINER" "$status" "$(docker port "$QA_CONTAINER" 2>/dev/null | tr '\n' ';')" "$remote"
  else
    printf 'QA target: %s\n' "$NAME"
    printf '  container : %s\n' "$status"
    printf '  image     : %s\n' "${QA_IMAGE:-unknown}"
    printf '  ports     : %s\n' "$(docker port "$QA_CONTAINER" 2>/dev/null | tr '\n' ' ')"
    printf '  data dir  : %s\n' "$QA_DIR"
    printf '  dsh home  : docker volume %s (%s)\n' "${QA_VOLUME:-dsh-qa-$NAME-dsh-home}" \
      "$(docker volume inspect -f '{{.Mountpoint}}' "${QA_VOLUME:-dsh-qa-$NAME-dsh-home}" 2>/dev/null || echo absent)"
    tunnel_state="closed"
    if [ -f "$QA_DIR/run/tunnel.pid" ]; then
      tunnel_pid="$(cat "$QA_DIR/run/tunnel.pid" 2>/dev/null || true)"
      if [ -n "$tunnel_pid" ] && kill -0 "$tunnel_pid" 2>/dev/null; then
        tunnel_state="open (host pid $tunnel_pid)"
      fi
    fi
    printf '  web tunnel: %s\n' "$tunnel_state"
    printf '  remote    :\n'
    printf '%s\n' "$remote" | sed 's/^/    /'
    printf '  host 127.0.0.1 listeners (ssh/web):\n'
    if command -v lsof >/dev/null 2>&1; then
      lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -E ":(${QA_SSH_PORT:-0}|${QA_WEB_PORT:-0}) " \
        | sed 's/^/    /' || true
    fi
    printf '  recent evidence files:\n'
    ls -la "$QA_DIR/run" "$QA_DIR/mock" 2>/dev/null | sed 's/^/    /' || true
  fi
else
  printf 'QA target: %s -> %s\n' "$NAME" "$status"
fi
