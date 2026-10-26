#!/usr/bin/env bash
# Stop the QA target container while keeping its bind-mounted data under
# /tmp/dsh-qa/<name>/ for the next start.sh run.
#
#   scripts/qa/stop.sh [--name server] [--remove]
#
# --remove also deletes the container (data dir still kept).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

NAME="server"
REMOVE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --remove) REMOVE=1; shift ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) qa_die "unknown argument: $1" ;;
  esac
done

QA_NAME="$NAME"
QA_DIR="$QA_ROOT/$QA_NAME"
QA_STATE="$QA_DIR/state.env"
QA_CONTAINER="dsh-qa-$NAME"
qa_require_docker

if [ -f "$QA_DIR/run/tunnel.pid" ]; then
  kill "$(cat "$QA_DIR/run/tunnel.pid" 2>/dev/null || true)" 2>/dev/null || true
  rm -f "$QA_DIR/run/tunnel.pid"
fi

if qa_container_exists; then
  if qa_container_running; then
    qa_log "stopping container $QA_CONTAINER"
    docker stop -t 5 "$QA_CONTAINER" >/dev/null
  fi
  if [ "$REMOVE" -eq 1 ]; then
    qa_log "removing container $QA_CONTAINER"
    docker rm -f "$QA_CONTAINER" >/dev/null
  fi
else
  qa_log "container $QA_CONTAINER does not exist"
fi

if [ -f "$QA_STATE" ]; then
  # shellcheck disable=SC1090
  . "$QA_STATE"
  if [ -n "${QA_SSH_PORT:-}" ] && qa_port_busy "$QA_SSH_PORT"; then
    qa_log "WARNING: 127.0.0.1:$QA_SSH_PORT is still listening"
  else
    qa_log "ssh port ${QA_SSH_PORT:-?} is closed"
  fi
fi
qa_log "data kept at $QA_DIR (cleanup.sh to remove)"
