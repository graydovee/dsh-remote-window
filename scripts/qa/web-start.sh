#!/usr/bin/env bash
# Start the server's ordinary global `dsh web` inside the QA target, pointed at
# the QA mock model fixture, and expose it on the host through an SSH local
# forward (the server itself only listens on 127.0.0.1).
#
#   scripts/qa/web-start.sh [--name server] [--no-mock]
#
# This is the "server standalone" baseline: no client plugin and no per-client
# profile. The SSH tunnel mirrors how the real client reaches a profile server.
# Prints the token URL; the token is in /tmp/dsh-qa/<name>/run/web.log only.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

NAME="server"
WITH_MOCK=1
while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --no-mock) WITH_MOCK=0; shift ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) qa_die "unknown argument: $1" ;;
  esac
done

QA_NAME="$NAME"
QA_DIR="$QA_ROOT/$NAME"
QA_STATE="$QA_DIR/state.env"
qa_load_state
QA_CONTAINER="${QA_CONTAINER:-dsh-qa-$NAME}"
qa_require_docker
qa_container_require_running

"$HERE/web-stop.sh" --name "$NAME" >/dev/null 2>&1 || true

model_env=()
if [ "$WITH_MOCK" -eq 1 ]; then
  [ -f "$QA_DIR/mock/config.env" ] || "$HERE/mock-start.sh" --name "$NAME" >/dev/null
  # ready.json is left over from previous runs; check the process, not the file.
  if ! docker exec "$QA_CONTAINER" bash -lc 'pgrep -f "[m]ock-llm.mjs" >/dev/null 2>&1'; then
    "$HERE/mock-start.sh" --name "$NAME" >/dev/null
  fi
  model_env=(
    -e "DEEPSEEK_BASE_URL=http://127.0.0.1:${QA_MOCK_PORT}/v1"
    -e "DEEPSEEK_API_KEY=${QA_MOCK_API_KEY}"
  )
  qa_log "model endpoint -> QA mock fixture http://127.0.0.1:${QA_MOCK_PORT}/v1 (not a real credential)"
else
  qa_log "starting without mock model; a real model would be required for turns"
fi

rm -f "$QA_DIR/run/web.log" "$QA_DIR/run/web.pid" "$QA_DIR/run/tunnel.log" "$QA_DIR/run/tunnel.pid"
qa_log "starting dsh web on container 127.0.0.1:${QA_WEB_PORT} (isolated DSH_HOME=/home/tester/.dsh)"
docker exec -d -u tester \
  -e HOME=/home/tester \
  -e DSH_HOME=/home/tester/.dsh \
  -e LANG=C.UTF-8 \
  -e "DSH_PERMISSION_MODE=${DSH_QA_PERMISSION_MODE:-danger-full-access}" \
  "${model_env[@]}" \
  "$QA_CONTAINER" bash -lc \
  "cd /home/tester/work && setsid nohup dsh web --host 127.0.0.1 --port '$QA_WEB_PORT' --no-open > /home/tester/qa-run/web.log 2>&1 < /dev/null & echo \$! > /home/tester/qa-run/web.pid"

ready=0
for _ in $(seq 1 60); do
  code="$(docker exec "$QA_CONTAINER" curl -s -o /dev/null -w '%{http_code}' \
            --max-time 2 "http://127.0.0.1:${QA_WEB_PORT}/" 2>/dev/null || true)"
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  docker exec "$QA_CONTAINER" cat /home/tester/qa-run/web.log >&2 || true
  qa_die "dsh web did not answer on container 127.0.0.1:$QA_WEB_PORT"
fi

# Host-side reachability through the same SSH channel the client plugin would
# use; the container publishes no web port.
qa_log "opening SSH local forward 127.0.0.1:${QA_WEB_PORT} -> container 127.0.0.1:${QA_WEB_PORT}"
ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes \
  -i "$QA_DIR/keys/id_ed25519" -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$QA_DIR/known_hosts" \
  -o ConnectTimeout=5 -o LogLevel=ERROR \
  -L "127.0.0.1:${QA_WEB_PORT}:127.0.0.1:${QA_WEB_PORT}" \
  -p "$QA_SSH_PORT" tester@127.0.0.1 \
  >"$QA_DIR/run/tunnel.log" 2>&1 &
tunnel_pid=$!
echo "$tunnel_pid" > "$QA_DIR/run/tunnel.pid"

host_ready=0
for _ in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${QA_WEB_PORT}/" || true)"
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    host_ready=1
    break
  fi
  sleep 0.5
done
if [ "$host_ready" -ne 1 ]; then
  cat "$QA_DIR/run/tunnel.log" >&2 || true
  qa_die "SSH tunnel did not answer on host 127.0.0.1:$QA_WEB_PORT"
fi

# The printed URL is a loopback origin; the tunnel keeps the same port, so it
# works unchanged on the host and contains no container address.
url="$(docker exec "$QA_CONTAINER" bash -lc '
  grep -oE "http://[^[:space:]]+" /home/tester/qa-run/web.log 2>/dev/null | head -1
' || true)"
if [ -z "$url" ]; then
  url="http://127.0.0.1:${QA_WEB_PORT}/"
fi
host_url="${url//0.0.0.0/127.0.0.1}"
http_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$host_url" || true)"

{
  printf 'QA dsh web started: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'bind: container 127.0.0.1:%s (no published web port)\n' "$QA_WEB_PORT"
  printf 'host access: SSH local forward 127.0.0.1:%s (pid %s)\n' "$QA_WEB_PORT" "$tunnel_pid"
  printf 'model: %s\n' "$([ "$WITH_MOCK" -eq 1 ] && echo "QA mock fixture (http://127.0.0.1:${QA_MOCK_PORT}/v1)" || echo "real/absent")"
  printf 'http probe (host, token-free): %s\n' "$http_code"
  printf 'token url: %s\n' "$host_url"
} | tee "$QA_DIR/logs/web-start.log" >&2

printf 'QA_WEB_TOKEN_URL=%s\n' "$host_url"
