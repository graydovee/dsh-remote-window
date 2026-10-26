#!/usr/bin/env bash
# Repeatable baseline checks for the QA Linux target.
#
#   tests/e2e/qa-target-smoke.sh [--name server] [--turn] [--keep-web]
#
# Checks, with no real credentials and no access to the real ~/.dsh:
#   1. container runs, SSH is published on 127.0.0.1 only
#   2. tester is unprivileged and DSH_HOME is the isolated bind mount
#   3. Node major and global dsh version match the image contract
#   4. mock model fixture starts and dsh web answers on the host loopback
#   5. (--turn) a real headless agent turn runs through the agent loop, calls the
#      bash tool, writes qa-marker.txt in the server workspace and persists a
#      session JSONL under the isolated ~/.dsh/sessions
#
# This is environment/baseline evidence, not acceptance of the v1 client
# features (those need the new plugin and are tracked in doc/qa-v1-plan.md).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
QA="$REPO/scripts/qa"

NAME="server"
RUN_TURN=0
KEEP_WEB=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --turn) RUN_TURN=1; shift ;;
    --keep-web) KEEP_WEB=1; shift ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

QA_DIR="${DSH_QA_ROOT:-/tmp/dsh-qa}/$NAME"
LOG_DIR="$QA_DIR/logs"
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/smoke-$STAMP.log"
: > "$LOG"

pass=0
fail=0
check() {
  local label="$1"; shift
  if "$@" >>"$LOG" 2>&1; then
    printf 'PASS %s\n' "$label" | tee -a "$LOG"
    pass=$((pass + 1))
  else
    printf 'FAIL %s\n' "$label" | tee -a "$LOG" >&2
    fail=$((fail + 1))
  fi
}

check_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    printf 'PASS %s (=%s)\n' "$label" "$actual" | tee -a "$LOG"
    pass=$((pass + 1))
  else
    printf 'FAIL %s expected=%s actual=%s\n' "$label" "$expected" "$actual" | tee -a "$LOG" >&2
    fail=$((fail + 1))
  fi
}

[ -f "$QA_DIR/state.env" ] || { echo "no state at $QA_DIR/state.env; run scripts/qa/start.sh" >&2; exit 2; }
# shellcheck disable=SC1090,SC1091
. "$QA_DIR/state.env"

echo "target: $QA_CONTAINER ($QA_DIR)" | tee -a "$LOG"
echo "log: $LOG" | tee -a "$LOG"

# 1. container + loopback-only SSH publication
check "container running" docker inspect -f '{{.State.Running}}' "$QA_CONTAINER"
ssh_ports="$(docker port "$QA_CONTAINER" 22 2>/dev/null || true)"
check_eq "ssh published on loopback only" "127.0.0.1:$QA_SSH_PORT" "$ssh_ports"

# 2. unprivileged user + isolated DSH_HOME
remote_user="$(docker exec -u tester -e HOME=/home/tester -e DSH_HOME=/home/tester/.dsh \
  "$QA_CONTAINER" bash -lc 'id -un' 2>/dev/null || true)"
remote_uid="$(docker exec -u tester -e HOME=/home/tester -e DSH_HOME=/home/tester/.dsh \
  "$QA_CONTAINER" bash -lc 'id -u' 2>/dev/null || true)"
check_eq "remote user is tester" "tester" "$remote_user"
check "remote uid is non-root" bash -c "[ -n '$remote_uid' ] && [ '$remote_uid' != '0' ]"
remote_home="$(docker exec -u tester -e HOME=/home/tester -e DSH_HOME=/home/tester/.dsh \
  "$QA_CONTAINER" bash -lc 'printf "%s" "$DSH_HOME"' 2>/dev/null || true)"
check_eq "DSH_HOME is isolated" "/home/tester/.dsh" "$remote_home"
check "isolated DSH home volume exists" docker volume inspect "${QA_VOLUME:-dsh-qa-$NAME-dsh-home}"
check "DSH home volume is owned by tester inside" bash -c \
  "docker exec '$QA_CONTAINER' bash -lc 'test \"\$(stat -c %U /home/tester/.dsh)\" = tester'"
check "host-side workspace exists" test -d "$QA_DIR/work"

# 3. Node / dsh version contract
node_major="$(docker exec "$QA_CONTAINER" node --version | sed 's/^v//' | cut -d. -f1)"
check_eq "node major" "$QA_NODE" "$node_major"
dsh_version="$(docker exec -u tester -e HOME=/home/tester -e DSH_HOME=/home/tester/.dsh \
  "$QA_CONTAINER" bash -lc 'dsh --version 2>&1 | head -1' || true)"
case "$dsh_version" in
  *"$QA_DSH_VERSION"*) check_eq "global dsh version" "contains:$QA_DSH_VERSION" "contains:$QA_DSH_VERSION" ;;
  *) check_eq "global dsh version" "contains:$QA_DSH_VERSION" "$dsh_version" ;;
esac

# 4. mock fixture + web on loopback
if [ "$RUN_TURN" -eq 0 ]; then
  check "mock fixture starts" "$QA/mock-start.sh" --name "$NAME"
  "$QA/web-start.sh" --name "$NAME" >"$LOG_DIR/smoke-web-$STAMP.log" 2>&1 || true
  web_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$QA_WEB_PORT/" 2>/dev/null || true)"
  case "$web_code" in
    200|302|303|307|401|403) check_eq "dsh web answers on host loopback" "http" "http" ;;
    *) check_eq "dsh web answers on host loopback" "http" "$web_code" ;;
  esac
  check "dsh web process runs" docker exec "$QA_CONTAINER" pgrep -f 'dsh web --host'
  if [ "$KEEP_WEB" -eq 0 ]; then
    "$QA/web-stop.sh" --name "$NAME" >>"$LOG" 2>&1 || true
    check "dsh web process stopped" bash -c "! docker exec '$QA_CONTAINER' pgrep -f 'dsh web --host' >/dev/null 2>&1"
  fi
fi

# 5. real headless agent turn through the fixture
if [ "$RUN_TURN" -eq 1 ]; then
  check "mock fixture starts" "$QA/mock-start.sh" --name "$NAME" \
    --sequence tool_call_success,success --text "QA smoke turn complete."
  rm -f "$QA_DIR/work/qa-marker.txt"
  count_sessions() {
    docker exec "$QA_CONTAINER" bash -lc \
      'find /home/tester/.dsh/sessions -type f \( -name "*.jsonl" -o -name "*.jsonl.zstd" \) 2>/dev/null | wc -l | tr -d " "'
  }
  before_sessions="$(count_sessions)"
  turn_log="$LOG_DIR/smoke-turn-$STAMP.log"
  set +e
  docker exec -i -u tester \
    -e HOME=/home/tester \
    -e DSH_HOME=/home/tester/.dsh \
    -e DEEPSEEK_BASE_URL="http://127.0.0.1:$QA_MOCK_PORT/v1" \
    -e DEEPSEEK_API_KEY="$QA_MOCK_API_KEY" \
    -e "DSH_PERMISSION_MODE=${DSH_QA_PERMISSION_MODE:-danger-full-access}" \
    -w /home/tester/work \
    "$QA_CONTAINER" bash -lc \
    'dsh --profile headless "Write the QA marker file, then report done."' \
    >"$turn_log" 2>&1
  turn_rc=$?
  set -e
  echo "headless exit=$turn_rc" >>"$LOG"
  check_eq "headless turn exit code" "0" "$turn_rc"
  check "bash tool wrote qa-marker.txt" test -f "$QA_DIR/work/qa-marker.txt"
  if [ -f "$QA_DIR/work/qa-marker.txt" ]; then
    check "marker content" grep -q "QA server baseline" "$QA_DIR/work/qa-marker.txt"
  fi
  after_sessions="$(count_sessions)"
  check "session jsonl added under server ~/.dsh/sessions" test "$after_sessions" -gt "$before_sessions"
  check "mock captured a real agent request" bash -c "grep -q '\"model\"' '$QA_DIR/mock/attempt-1.json'"
  check "no remote-server-sessions directory" bash -c "! test -d '$QA_DIR/home/remote-server-sessions'"
  "$QA/mock-stop.sh" --name "$NAME" >>"$LOG" 2>&1 || true
fi

echo "----" | tee -a "$LOG"
printf 'RESULT %s: %s passed, %s failed\n' "$NAME" "$pass" "$fail" | tee -a "$LOG"
[ "$fail" -eq 0 ]
