#!/usr/bin/env bash
# Open a host-side SSH local forward to one profile server port inside the QA
# target (the container publishes no web port).
#
#   scripts/qa/profile-tunnel.sh [--name server] --profile <p> --port <n>
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

NAME="server"
PROFILE=""
PORT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) qa_die "unknown argument: $1" ;;
  esac
done
[ -n "$PROFILE" ] || qa_die "--profile is required"
[ -n "$PORT" ] || qa_die "--port is required"

QA_NAME="$NAME"
QA_DIR="$QA_ROOT/$NAME"
QA_STATE="$QA_DIR/state.env"
qa_load_state
QA_CONTAINER="${QA_CONTAINER:-dsh-qa-$NAME}"
qa_require_docker
qa_container_require_running

safe_profile="${PROFILE//[^a-zA-Z0-9_.-]/_}"
pidfile="$QA_DIR/run/profile-$safe_profile.tunnel.pid"
logfile="$QA_DIR/run/profile-$safe_profile.tunnel.log"

if [ -f "$pidfile" ]; then
  kill "$(cat "$pidfile" 2>/dev/null || true)" 2>/dev/null || true
  rm -f "$pidfile"
fi

qa_log "opening SSH local forward 127.0.0.1:$PORT -> container 127.0.0.1:$PORT"
ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes \
  -i "$QA_DIR/keys/id_ed25519" -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$QA_DIR/known_hosts" \
  -o ConnectTimeout=5 -o LogLevel=ERROR \
  -L "127.0.0.1:${PORT}:127.0.0.1:${PORT}" \
  -p "$QA_SSH_PORT" tester@127.0.0.1 \
  >"$logfile" 2>&1 &
echo "$!" > "$pidfile"

for _ in $(seq 1 40); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${PORT}/" || true)"
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    qa_log "tunnel ready (http probe $code)"
    exit 0
  fi
  sleep 0.5
done
cat "$logfile" >&2 || true
qa_die "SSH local forward did not answer on host 127.0.0.1:$PORT"
