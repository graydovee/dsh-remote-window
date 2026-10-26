#!/usr/bin/env bash
# Stop one per-client profile server inside the QA target and its SSH forward.
#
#   scripts/qa/profile-stop.sh [--name server] --profile <p> [--all]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

NAME="server"
PROFILE=""
ALL=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --all) ALL=1; shift ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) qa_die "unknown argument: $1" ;;
  esac
done

QA_NAME="$NAME"
QA_DIR="$QA_ROOT/$NAME"
QA_STATE="$QA_DIR/state.env"
QA_CONTAINER="dsh-qa-$NAME"

if [ "$ALL" -eq 1 ]; then
  for pidfile in "$QA_DIR"/run/profile-*.tunnel.pid; do
    [ -f "$pidfile" ] || continue
    kill "$(cat "$pidfile" 2>/dev/null || true)" 2>/dev/null || true
    rm -f "$pidfile"
  done
  qa_require_docker
  qa_container_running || exit 0
  docker exec -u tester "$QA_CONTAINER" bash -lc '
    for pidfile in /home/tester/qa-run/profile-*.pid; do
      [ -f "$pidfile" ] || continue
      kill "$(cat "$pidfile" 2>/dev/null || true)" 2>/dev/null || true
      rm -f "$pidfile"
    done
    pkill -f "[d]sh --profile .*--host 127.0.0.1" 2>/dev/null || true
  ' >/dev/null 2>&1 || true
  qa_log "all profile servers stopped"
  exit 0
fi

[ -n "$PROFILE" ] || qa_die "--profile is required (or --all)"
safe_profile="${PROFILE//[^a-zA-Z0-9_.-]/_}"
pidfile="$QA_DIR/run/profile-$safe_profile.tunnel.pid"
if [ -f "$pidfile" ]; then
  kill "$(cat "$pidfile" 2>/dev/null || true)" 2>/dev/null || true
  rm -f "$pidfile"
fi

qa_require_docker
qa_container_running || exit 0
docker exec -u tester -e HOME=/home/tester -e DSH_HOME=/home/tester/.dsh \
  -e "PROFILE=$PROFILE" -e "SAFE=$safe_profile" "$QA_CONTAINER" bash -lc '
  pkill -f "dsh --profile $PROFILE --host" 2>/dev/null || true
  for _ in $(seq 1 40); do
    pgrep -f "dsh --profile $PROFILE --host" >/dev/null 2>&1 || break
    sleep 0.25
  done
  pkill -9 -f "dsh --profile $PROFILE --host" 2>/dev/null || true
  rm -f "/home/tester/qa-run/profile-$SAFE.pid"
  # QA-only: drop the lease file so the next start claims a fresh lease instead
  # of waiting out the stale window. Production keeps the lease for takeover.
  rm -f "$DSH_HOME/profiles/$PROFILE/node_modules/../.dsh-rw/lease.json" 2>/dev/null || true
  rm -f "$DSH_HOME/profiles/$PROFILE/.dsh-rw/lease.json" 2>/dev/null || true
' >/dev/null 2>&1 || true
qa_log "profile $PROFILE stopped on $QA_NAME"
