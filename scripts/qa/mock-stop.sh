#!/usr/bin/env bash
# Stop the QA mock model fixture inside the target container.
#
#   scripts/qa/mock-stop.sh [--name server]
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
qa_require_docker
qa_container_running || exit 0

docker exec -u tester "$QA_CONTAINER" bash -lc '
  if [ -f /home/tester/qa-run/mock.pid ]; then
    kill "$(cat /home/tester/qa-run/mock.pid)" 2>/dev/null || true
    rm -f /home/tester/qa-run/mock.pid
  fi
  pkill -f "mock-llm.mjs" 2>/dev/null || true
' >/dev/null 2>&1 || true
qa_log "mock LLM server stopped"
