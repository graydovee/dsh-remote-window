#!/usr/bin/env bash
# Start one per-client DSH profile server inside the QA target and capture the
# printed loopback URL (port + token), without publishing any container port.
#
#   scripts/qa/profile-start.sh [--name server] [--profile <profile>] \
#       [--mock] [--permission danger-full-access]
#
# Outputs /tmp/dsh-qa/<name>/run/profile-<profile>.log (server stdout/stderr,
# contains the one-time token) and .env with PORT/TOKEN_URL (token is a QA
# fixture secret: never paste it into reports).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

NAME="server"
PROFILE=""
WITH_MOCK=1
PERMISSION="${DSH_QA_PERMISSION_MODE:-danger-full-access}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --no-mock) WITH_MOCK=0; shift ;;
    --mock) WITH_MOCK=1; shift ;;
    --permission) PERMISSION="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) qa_die "unknown argument: $1" ;;
  esac
done

[ -n "$PROFILE" ] || qa_die "--profile is required"
QA_NAME="$NAME"
QA_DIR="$QA_ROOT/$NAME"
QA_STATE="$QA_DIR/state.env"
qa_load_state
QA_CONTAINER="${QA_CONTAINER:-dsh-qa-$NAME}"
qa_require_docker
qa_container_require_running

"$HERE/profile-stop.sh" --name "$NAME" --profile "$PROFILE" >/dev/null 2>&1 || true

model_env=()
if [ "$WITH_MOCK" -eq 1 ]; then
  [ -f "$QA_DIR/mock/config.env" ] || "$HERE/mock-start.sh" --name "$NAME" >/dev/null
  if ! docker exec "$QA_CONTAINER" bash -lc 'pgrep -f "[m]ock-llm.mjs" >/dev/null 2>&1'; then
    "$HERE/mock-start.sh" --name "$NAME" >/dev/null
  fi
  model_env=(
    -e "DEEPSEEK_BASE_URL=http://127.0.0.1:${QA_MOCK_PORT}/v1"
    -e "DEEPSEEK_API_KEY=${QA_MOCK_API_KEY}"
  )
  qa_log "model endpoint -> QA mock fixture http://127.0.0.1:${QA_MOCK_PORT}/v1 (not a real credential)"
fi

safe_profile="${PROFILE//[^a-zA-Z0-9_.-]/_}"
log="$QA_DIR/run/profile-$safe_profile.log"
envfile="$QA_DIR/run/profile-$safe_profile.env"
rm -f "$log" "$envfile" "$QA_DIR/run/profile-$safe_profile.pid"

qa_log "starting profile $PROFILE (host 127.0.0.1, port 0) inside $QA_CONTAINER"
# docker exec -d keeps the process detached; run dsh directly (no extra shell
# background job) so the PID we later match with pgrep is the real process.
docker exec -d -u tester \
  -e HOME=/home/tester \
  -e DSH_HOME=/home/tester/.dsh \
  -e LANG=C.UTF-8 \
  -e "DSH_PERMISSION_MODE=$PERMISSION" \
  "${model_env[@]}" \
  "$QA_CONTAINER" bash -lc \
  "cd /home/tester/work && exec dsh --profile '$PROFILE' --host 127.0.0.1 --port 0 --no-open > '/home/tester/qa-run/profile-$safe_profile.log' 2>&1 < /dev/null"

url=""
# Profile boot includes plugin composition; poll the printed URL instead of a
# child pid, and fail early only when no matching dsh process exists at all.
tick=0
for _ in $(seq 1 120); do
  tick=$((tick + 1))
  url="$(docker exec "$QA_CONTAINER" bash -lc \
          "grep -oE 'http://[^[:space:]]+' '/home/tester/qa-run/profile-$safe_profile.log' 2>/dev/null | head -1" || true)"
  [ -n "$url" ] && break
  if [ "$tick" -gt 20 ] && ! docker exec "$QA_CONTAINER" bash -lc \
        "pgrep -f 'dsh --profile $PROFILE --host' >/dev/null 2>&1"; then
    break
  fi
  sleep 1
done
if [ -z "$url" ]; then
  docker exec "$QA_CONTAINER" cat "/home/tester/qa-run/profile-$safe_profile.log" >&2 || true
  qa_die "profile $PROFILE did not print a URL within 90s"
fi

# The container exposes no web port. Reach the loopback origin through an SSH
# local forward, exactly like the real client tunnel.
port="$(printf '%s' "$url" | sed -E 's#^http://[^:/]+:([0-9]+).*#\1#')"
[ -n "$port" ] || qa_die "could not parse port from: $url"
host_url="${url//0.0.0.0/127.0.0.1}"

"$HERE/profile-tunnel.sh" --name "$NAME" --profile "$PROFILE" --port "$port" >/dev/null

{
  printf 'QA_PROFILE=%q\n' "$PROFILE"
  printf 'QA_PROFILE_PORT=%q\n' "$port"
  printf 'QA_PROFILE_URL=%q\n' "$host_url"
  printf 'QA_PROFILE_LOG=%q\n' "$log"
} > "$envfile"

{
  printf 'profile %s started\n' "$PROFILE"
  printf 'command: dsh --profile %s --host 127.0.0.1 --port 0 --no-open (inside container)\n' "$PROFILE"
  printf 'container stdout line: %s\n' "$url"
  printf 'host tunnel: 127.0.0.1:%s -> container 127.0.0.1:%s\n' "$port" "$port"
  printf 'server log: %s\n' "$log"
} | tee "$QA_DIR/logs/profile-start-$safe_profile.log" >&2

printf 'QA_PROFILE_URL=%s\n' "$host_url"
