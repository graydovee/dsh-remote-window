#!/usr/bin/env bash
# Read server-side DSH session logs for QA evidence.
#
# DSH 0.2.1-rc.2 stores a session as
#   ~/.dsh/sessions/<cwd-slug>/session-<id>/session.v4.jsonl.zstd
# The log is zstd-compressed; this helper lists/dumps it inside the container so
# the host does not need a zstd binary.
#
#   scripts/qa/session-log.sh [--name server] --list
#   scripts/qa/session-log.sh [--name server] --dump [<session-id>] [--events]
#   scripts/qa/session-log.sh [--name server] --json [<session-id>]
#
# --events prints a compact one-line-per-event summary (turn/tool/assistant).
# --json prints the decompressed JSONL untouched.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

NAME="server"
MODE="list"
SESSION_ID=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --list) MODE="list"; shift ;;
    --dump) MODE="dump"; shift ;;
    --json) MODE="json"; shift ;;
    --events) MODE="events"; shift ;;
    --) shift; break ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) SESSION_ID="$1"; shift ;;
  esac
done
case "$MODE" in
  dump) MODE="json" ;;
esac

QA_NAME="$NAME"
QA_DIR="$QA_ROOT/$NAME"
QA_STATE="$QA_DIR/state.env"
qa_load_state
QA_CONTAINER="${QA_CONTAINER:-dsh-qa-$NAME}"
qa_require_docker
qa_container_require_running

if [ "$MODE" = "list" ]; then
  qa_log "session logs under server ~/.dsh/sessions:"
  docker exec -u tester -e HOME=/home/tester "$QA_CONTAINER" bash -lc '
    find /home/tester/.dsh/sessions -type f \( -name "*.jsonl" -o -name "*.jsonl.zstd" \) \
      -printf "%T@ %p\n" 2>/dev/null | sort -n | awk "{ printf \"%s %s\\n\", \$2, strftime(\"%Y-%m-%dT%H:%M:%SZ\", \$1) }"
  ' || true
  exit 0
fi

if [ -z "$SESSION_ID" ]; then
  SESSION_ID="$(docker exec -u tester -e HOME=/home/tester "$QA_CONTAINER" bash -lc '
    find /home/tester/.dsh/sessions -type f -name "session.v4.jsonl.zstd" -printf "%T@ %p\n" 2>/dev/null \
      | sort -n | tail -1 | cut -d" " -f2-
  ' || true)"
  [ -n "$SESSION_ID" ] || qa_die "no session log found; run a turn first"
fi

case "$SESSION_ID" in
  /*) path="$SESSION_ID" ;;
  *) path="$(docker exec -u tester -e HOME=/home/tester "$QA_CONTAINER" bash -lc \
        "find /home/tester/.dsh/sessions -type f -name '*$SESSION_ID*' -name '*.zstd' | head -1")" ;;
esac
[ -n "$path" ] || qa_die "session log not found for: $SESSION_ID"
qa_log "session log: $path"

if [ "$MODE" = "json" ]; then
  docker exec -u tester -e HOME=/home/tester "$QA_CONTAINER" bash -lc "zstd -dc '$path'"
  exit 0
fi

# Compact event summary for reports.
docker exec -u tester -e HOME=/home/tester "$QA_CONTAINER" bash -lc "zstd -dc '$path'" \
  | node -e '
let raw="";
process.stdin.on("data", chunk => { raw += chunk });
process.stdin.on("end", () => {
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line) } catch { continue }
    const type = event.type ?? "?";
    if (type === "tool/result") {
      const content = event.data?.message?.content ?? [];
      const text = content.map(part => part.text ?? "").join(" ");
      console.log("tool/result:", text.slice(0, 300).replace(/\n/g, "\\n"));
    } else if (type === "tool/call") {
      console.log("tool/call:", event.data?.name, String(event.data?.arguments ?? "").slice(0, 160));
    } else if (type === "assistant/message") {
      const content = event.data?.message?.content ?? [];
      const text = content.map(part => part.text ?? part.name ?? "").join(" ");
      console.log("assistant/message:", text.slice(0, 240));
    } else if (type === "turn/start" || type === "turn/end") {
      console.log(type + ":", JSON.stringify(event.data ?? {}).slice(0, 200));
    } else if (type === "session/title") {
      console.log("session/title:", JSON.stringify(event.data?.title), JSON.stringify(event.data?.source));
    }
  }
});
'
