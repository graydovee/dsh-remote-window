#!/usr/bin/env bash
# Stop the server's global `dsh web` inside the QA target and its host-side SSH
# local forward.
#
#   scripts/qa/web-stop.sh [--name server]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

NAME="server"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    *) qa_die "unknown argument: $1" ;;
  esac
done

QA_NAME="$NAME"
QA_DIR="$QA_ROOT/$NAME"
QA_STATE="$QA_DIR/state.env"
QA_CONTAINER="dsh-qa-$NAME"

if [ -f "$QA_DIR/run/tunnel.pid" ]; then
  tunnel_pid="$(cat "$QA_DIR/run/tunnel.pid" 2>/dev/null || true)"
  if [ -n "$tunnel_pid" ]; then
    kill "$tunnel_pid" 2>/dev/null || true
  fi
  rm -f "$QA_DIR/run/tunnel.pid"
fi

qa_require_docker
qa_container_running || exit 0

docker exec -u tester "$QA_CONTAINER" bash -lc '
  if [ -f /home/tester/qa-run/web.pid ]; then
    pid="$(cat /home/tester/qa-run/web.pid)"
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    kill -9 "$pid" 2>/dev/null || true
    rm -f /home/tester/qa-run/web.pid
  fi
  pkill -f "[d]sh web --host" 2>/dev/null || true
' >/dev/null 2>&1 || true

for _ in $(seq 1 20); do
  if docker exec "$QA_CONTAINER" bash -lc '! pgrep -f "[d]sh web --host" >/dev/null 2>&1' >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
qa_log "dsh web stopped on $QA_NAME"
