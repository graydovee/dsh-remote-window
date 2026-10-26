#!/usr/bin/env bash
# Start the official Messages mock model server inside the QA target.
#
# QA FIXTURE ONLY: it replaces the model HTTP endpoint used by
# @deepseek-ai/dsh-llm-deepseek. The agent loop, tool execution and the
# server-side session log remain real. The API key is a fixture string.
#
#   scripts/qa/mock-start.sh [--name server] [--sequence tool_call_success,success]
#                            [--text "QA mock reply"] [--tool-name bash]
#                            [--tool-arguments '<json>'] [--repeat-last 0|1]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

NAME="server"
SEQUENCE=""
TEXT=""
TOOL_NAME=""
TOOL_ARGUMENTS=""
REPEAT_LAST="1"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --sequence) SEQUENCE="$2"; shift 2 ;;
    --text) TEXT="$2"; shift 2 ;;
    --tool-name) TOOL_NAME="$2"; shift 2 ;;
    --tool-arguments) TOOL_ARGUMENTS="$2"; shift 2 ;;
    --repeat-last) REPEAT_LAST="$2"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
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

mkdir -p "$QA_DIR/mock"
CONFIG="$QA_DIR/mock/config.env"
[ -f "$CONFIG" ] || CONFIG=""

if [ -n "$CONFIG" ]; then
  # shellcheck disable=SC1090
  . "$CONFIG"
else
  QA_MOCK_SEQUENCE="${QA_MOCK_SEQUENCE:-tool_call_success,success}"
  QA_MOCK_TEXT="${QA_MOCK_TEXT:-QA mock model reply: the real DSH agent loop completed this server-side turn.}"
  QA_MOCK_TOOL_NAME="bash"
  # Empty means "use the wrapper default" (a bash call writing qa-marker.txt).
  QA_MOCK_TOOL_ARGUMENTS=""
  QA_MOCK_REPEAT_LAST="1"
fi
[ -n "$SEQUENCE" ] && QA_MOCK_SEQUENCE="$SEQUENCE"
[ -n "$TEXT" ] && QA_MOCK_TEXT="$TEXT"
[ -n "$TOOL_NAME" ] && QA_MOCK_TOOL_NAME="$TOOL_NAME"
[ -n "$TOOL_ARGUMENTS" ] && QA_MOCK_TOOL_ARGUMENTS="$TOOL_ARGUMENTS"
[ -n "$REPEAT_LAST" ] && QA_MOCK_REPEAT_LAST="$REPEAT_LAST"

# Persist the fixture configuration so web-start.sh reproduces the same setup.
{
  printf 'QA_MOCK_SEQUENCE=%q\n' "$QA_MOCK_SEQUENCE"
  printf 'QA_MOCK_TEXT=%q\n' "$QA_MOCK_TEXT"
  printf 'QA_MOCK_TOOL_NAME=%q\n' "$QA_MOCK_TOOL_NAME"
  printf 'QA_MOCK_TOOL_ARGUMENTS=%q\n' "$QA_MOCK_TOOL_ARGUMENTS"
  printf 'QA_MOCK_REPEAT_LAST=%q\n' "$QA_MOCK_REPEAT_LAST"
} > "$QA_DIR/mock/config.env"

"$HERE/mock-stop.sh" --name "$NAME" >/dev/null 2>&1 || true
rm -f "$QA_DIR/mock/ready.json" "$QA_DIR/mock/requests.jsonl" "$QA_DIR"/mock/attempt-*.json

qa_log "starting mock LLM server on container 127.0.0.1:${QA_MOCK_PORT}"
docker exec -d -u tester \
  -e HOME=/home/tester \
  -e "QA_MOCK_PORT=$QA_MOCK_PORT" \
  -e "QA_MOCK_API_KEY=$QA_MOCK_API_KEY" \
  -e "QA_MOCK_SEQUENCE=$QA_MOCK_SEQUENCE" \
  -e "QA_MOCK_TEXT=$QA_MOCK_TEXT" \
  -e "QA_MOCK_TOOL_NAME=$QA_MOCK_TOOL_NAME" \
  -e "QA_MOCK_TOOL_ARGUMENTS=$QA_MOCK_TOOL_ARGUMENTS" \
  -e "QA_MOCK_REPEAT_LAST=$QA_MOCK_REPEAT_LAST" \
  -e "QA_MOCK_DIR=/home/tester/qa-mock" \
  -e "QA_MOCK_LOG=/home/tester/qa-mock/requests.jsonl" \
  "$QA_CONTAINER" bash -lc \
  'cd /opt/dsh-qa && setsid nohup node mock-llm.mjs > /home/tester/qa-run/mock.log 2>&1 < /dev/null & echo $! > /home/tester/qa-run/mock.pid'

for _ in $(seq 1 30); do
  if docker exec "$QA_CONTAINER" test -f /home/tester/qa-mock/ready.json >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
if ! docker exec "$QA_CONTAINER" test -f /home/tester/qa-mock/ready.json >/dev/null 2>&1; then
  docker exec "$QA_CONTAINER" cat /home/tester/qa-run/mock.log >&2 || true
  qa_die "mock LLM server did not become ready"
fi
qa_log "mock ready: $(docker exec "$QA_CONTAINER" cat /home/tester/qa-mock/ready.json | tr -d '\n')"
qa_log "fixture sequence: $QA_MOCK_SEQUENCE (repeat last: $QA_MOCK_REPEAT_LAST)"
qa_log "evidence: $QA_DIR/mock/requests.jsonl and $QA_DIR/mock/attempt-*.json"
