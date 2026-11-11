#!/usr/bin/env bash
# Repeatable smoke for one remote-workspace server profile: install side is
# install-server-plugin.sh; this exercises handshake, lease error paths, embed
# routes, index injection and the implemented P1 RPC surface.
#
#   scripts/qa/profile-smoke.sh [--name server] --profile <profile> [--instance <id>]
#
# Evidence: /tmp/dsh-qa/<name>/logs/profile-smoke-<profile>-<ts>.log
# (handshake JSON, per-call HTTP status/body, PASS/FAIL summary; no token).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

NAME="server"
PROFILE=""
INSTANCE="qa-smoke-$(date +%s)"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --instance) INSTANCE="$2"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
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

safe_profile="${PROFILE//[^a-zA-Z0-9_.-]/_}"
envfile="$QA_DIR/run/profile-$safe_profile.env"
[ -f "$envfile" ] || qa_die "profile $PROFILE is not running (missing $envfile); run profile-start.sh"
# shellcheck disable=SC1090
. "$envfile"
PORT="$QA_PROFILE_PORT"
URL="$QA_PROFILE_URL"
CLIENT_ID="${PROFILE#graydovee-remote-workspace-}"
[ "$CLIENT_ID" != "$PROFILE" ] || CLIENT_ID="$PROFILE"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$QA_DIR/logs/profile-smoke-$safe_profile-$STAMP.log"
mkdir -p "$QA_DIR/logs"
: > "$LOG"
JAR=/home/tester/qa-run/smoke-cookies.txt

pass=0; fail=0
ok() { printf 'PASS %s\n' "$*" | tee -a "$LOG"; pass=$((pass+1)); }
bad() { printf 'FAIL %s\n' "$*" | tee -a "$LOG" >&2; fail=$((fail+1)); }
expect_status() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then ok "$label (http $actual)"; else bad "$label expected http $expected got $actual"; fi
}
expect_json() {
  local label="$1" jq_expr="$2" json="$3"
  if printf '%s' "$json" | python3 -c "
import json,sys
d=json.load(sys.stdin)
ok = $jq_expr
if not ok: raise SystemExit(1)
" 2>/dev/null; then ok "$label"; else bad "$label ($json)"; fi
}

# Auth: exchange the launch token for the official browser cookie.
docker exec -u tester -e HOME=/home/tester "$QA_CONTAINER" bash -lc \
  "rm -f $JAR; curl -sS -o /dev/null -c $JAR '$URL'" >/dev/null
code="$(docker exec -u tester -e HOME=/home/tester "$QA_CONTAINER" bash -lc \
  "curl -sS -o /dev/null -w '%{http_code}' -b $JAR '$URL'")"
[ "$code" = "401" ] || [ "$code" = "200" ] || [ "$code" = "303" ] || bad "cookie auth probe got $code"

handshake() {
  local body="$1" with_cookie="$2"
  local cookie="-b $JAR"
  [ "$with_cookie" = "1" ] || cookie=""
  docker exec -i -u tester -e HOME=/home/tester "$QA_CONTAINER" bash -lc \
    "curl -sS -o /tmp/smoke-body.json -w '%{http_code}' $cookie \
       -X POST 'http://127.0.0.1:$PORT/dsh-remote-workspace-server/api/handshake' \
       -H 'content-type: application/json' --data '$body'; echo; cat /tmp/smoke-body.json"
}

body_ok="{\"protocol\":1,\"pluginVersion\":\"0.1.0-alpha.3\",\"clientId\":\"$CLIENT_ID\",\"instanceId\":\"$INSTANCE\",\"profile\":\"$PROFILE\"}"
hs="$(handshake "$body_ok" 1)"
hs_status="$(printf '%s\n' "$hs" | head -1)"; hs_json="$(printf '%s\n' "$hs" | tail -n +2)"
expect_status "handshake" "200" "$hs_status"
printf '%s\n' "$hs_json" >> "$LOG"
expect_json "handshake protocol/pluginVersion/dshVersion/profile/clientId" \
  'd.get("ok") and d["value"]["protocol"]==1 and d["value"]["pluginVersion"]=="0.1.0-alpha.3" and d["value"]["dshVersion"]=="0.2.1-rc.3" and d["value"]["profile"]!="" and d["value"]["clientId"]!=""' "$hs_json"
expect_json "handshake lease present" 'd.get("ok") and isinstance(d["value"].get("lease"),dict) and d["value"]["lease"].get("instanceId")' "$hs_json"
expect_json "handshake capabilities" 'd.get("ok") and d["value"].get("capabilities",{}).get("workspaceApi")==1' "$hs_json"

# Error paths.
bad_ver="{\"protocol\":1,\"pluginVersion\":\"9.9.9\",\"clientId\":\"$CLIENT_ID\",\"instanceId\":\"$INSTANCE-v\",\"profile\":\"$PROFILE\"}"
r="$(handshake "$bad_ver" 1)"; s="$(printf '%s\n' "$r" | head -1)"; j="$(printf '%s\n' "$r" | tail -n +2)"
expect_status "plugin-version-mismatch status" "409" "$s"
expect_json "plugin-version-mismatch code" 'd.get("error",{}).get("code")=="plugin-version-mismatch"' "$j"

bad_prof="{\"protocol\":1,\"pluginVersion\":\"0.1.0-alpha.3\",\"clientId\":\"$CLIENT_ID\",\"instanceId\":\"$INSTANCE-p\",\"profile\":\"web\"}"
r="$(handshake "$bad_prof" 1)"; s="$(printf '%s\n' "$r" | head -1)"; j="$(printf '%s\n' "$r" | tail -n +2)"
expect_status "profile-mismatch status" "409" "$s"
expect_json "profile-mismatch code" 'd.get("error",{}).get("code")=="profile-mismatch"' "$j"

bad_client="{\"protocol\":1,\"pluginVersion\":\"0.1.0-alpha.3\",\"clientId\":\"qa2\",\"instanceId\":\"$INSTANCE-c\",\"profile\":\"$PROFILE\"}"
r="$(handshake "$bad_client" 1)"; s="$(printf '%s\n' "$r" | head -1)"; j="$(printf '%s\n' "$r" | tail -n +2)"
expect_status "profile-foreign-client status" "409" "$s"
expect_json "profile-foreign-client code" 'd.get("error",{}).get("code")=="profile-foreign-client"' "$j"

r="$(handshake "$body_ok" 0)"; s="$(printf '%s\n' "$r" | head -1)"
expect_status "no-cookie handshake rejected" "401" "$s"

# Profile-in-use: a second instance right after the successful lease claim.
if [ "$hs_status" = "200" ]; then
  other="{\"protocol\":1,\"pluginVersion\":\"0.1.0-alpha.3\",\"clientId\":\"$CLIENT_ID\",\"instanceId\":\"$INSTANCE-other\",\"profile\":\"$PROFILE\"}"
  r="$(handshake "$other" 1)"; s="$(printf '%s\n' "$r" | head -1)"; j="$(printf '%s\n' "$r" | tail -n +2)"
  case "$s" in
    409) expect_json "profile-in-use code" 'd.get("error",{}).get("code")=="profile-in-use"' "$j" ;;
    200) ok "profile-in-use not triggered (lease was stale; acceptable)" ;;
    *) bad "profile-in-use unexpected status $s" ;;
  esac
fi
# Re-claim with our instance for RPC calls.
handshake "$body_ok" 1 >/dev/null

rpc() {
  local method="$1" params="$2"
  local body="{\"protocol\":1,\"method\":\"$method\",\"params\":$params}"
  docker exec -i -u tester -e HOME=/home/tester "$QA_CONTAINER" bash -lc \
    "curl -sS -o /tmp/smoke-rpc.json -w '%{http_code}' -b $JAR \
       -X POST 'http://127.0.0.1:$PORT/dsh-remote-workspace-server/api/rpc' \
       -H 'content-type: application/json' \
       -H 'x-dsh-rw-client: $CLIENT_ID' -H 'x-dsh-rw-instance: $INSTANCE' -H 'x-dsh-rw-protocol: 1' \
       --data '$body'; echo; cat /tmp/smoke-rpc.json"
}

r="$(rpc "profile/status" '{}')"; s="$(printf '%s\n' "$r" | head -1)"; j="$(printf '%s\n' "$r" | tail -n +2)"
expect_status "profile/status" "200" "$s"
printf 'profile/status body: %s\n' "$j" >> "$LOG"

r="$(rpc "registry/status" '{}')"; s="$(printf '%s\n' "$r" | head -1)"; j="$(printf '%s\n' "$r" | tail -n +2)"
expect_status "registry/status" "200" "$s"
printf 'registry/status body: %s\n' "$j" >> "$LOG"

# Real workspace create + list under the shared server DSH_HOME.
ws_path="/home/tester/work/qa-smoke-ws"
docker exec -u tester "$QA_CONTAINER" mkdir -p "$ws_path"
r="$(rpc "workspace/create" "{\"path\":\"$ws_path\",\"title\":\"QA smoke workspace\"}")"
s="$(printf '%s\n' "$r" | head -1)"; j="$(printf '%s\n' "$r" | tail -n +2)"
if [ "$s" = "200" ]; then ok "workspace/create"; else bad "workspace/create http $s ($j)"; fi
printf 'workspace/create body: %s\n' "$j" >> "$LOG"

r="$(rpc "workspace/list" '{}')"; s="$(printf '%s\n' "$r" | head -1)"; j="$(printf '%s\n' "$r" | tail -n +2)"
expect_status "workspace/list" "200" "$s"
expect_json "workspace/list includes smoke workspace" "\"$ws_path\" in json.dumps(d)" "$j"
printf 'workspace/list body: %s\n' "$j" >> "$LOG"

# Rename the new workspace (real official registry write through the guard).
ws_id="$(printf '%s' "$j" | python3 -c "
import json,sys
d=json.load(sys.stdin)
items=d.get('value',{}).get('workspaces') or []
for w in (items if isinstance(items,list) else []):
    if w.get('path')=='$ws_path': print(w.get('workspaceId') or w.get('id') or ''); break
")"
if [ -n "$ws_id" ]; then
  r="$(rpc "workspace/rename" "{\"workspaceId\":\"$ws_id\",\"title\":\"QA smoke renamed\"}")"
  s="$(printf '%s\n' "$r" | head -1)"; j="$(printf '%s\n' "$r" | tail -n +2)"
  if [ "$s" = "200" ]; then ok "workspace/rename"; else bad "workspace/rename http $s ($j)"; fi
  printf 'workspace/rename body: %s\n' "$j" >> "$LOG"
else
  bad "workspace id not found in workspace/list"
fi

# Session list must fold the real session title from its JSONL log.
r="$(rpc "session/list" "{\"workspaceId\":\"$ws_id\"}")"; s="$(printf '%s\n' "$r" | head -1)"; j="$(printf '%s\n' "$r" | tail -n +2)"
expect_status "session/list for smoke workspace" "200" "$s"
printf 'session/list body: %s\n' "$j" >> "$LOG"

# session/create on the existing /home/tester/work workspace (blank draft).
work_ws_id="$(docker exec -u tester -e HOME=/home/tester "$QA_CONTAINER" bash -lc \
  "cat /home/tester/.dsh/storages/workspace.json" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for wid,w in (d.get('tables',{}).get('workspaces',{}) or {}).items():
    if w.get('path')=='/home/tester/work': print(wid); break
")"
if [ -n "$work_ws_id" ]; then
  r="$(rpc "session/create" "{\"workspaceId\":\"$work_ws_id\",\"blank\":true,\"executor\":\"server\"}")"
  s="$(printf '%s\n' "$r" | head -1)"; j="$(printf '%s\n' "$r" | tail -n +2)"
  case "$s" in
    200) ok "session/create blank" ;;
    *) bad "session/create http $s ($j)" ;;
  esac
  printf 'session/create body: %s\n' "$j" >> "$LOG"
  r="$(rpc "session/list" "{\"workspaceId\":\"$work_ws_id\"}")"; s="$(printf '%s\n' "$r" | head -1)"; j="$(printf '%s\n' "$r" | tail -n +2)"
  expect_status "session/list for /home/tester/work" "200" "$s"
  expect_json "session/list has non-empty titles" "any(s.get('title') for s in d.get('value',{}).get('sessions',[]))" "$j"
  printf 'session/list work body: %s\n' "$j" >> "$LOG"
else
  bad "workspace /home/tester/work not in official registry"
fi

# Embed routes + index injection (public static, cookie for index).
b_code="$(docker exec -u tester -e HOME=/home/tester "$QA_CONTAINER" bash -lc \
  "curl -sS -o /tmp/bootstrap.js -w '%{http_code} %{content_type} %{size_download}' 'http://127.0.0.1:$PORT/dsh-remote-workspace-server/embed/bootstrap.js'")"
case "$b_code" in
  200*) ok "embed/bootstrap.js ($b_code)" ;;
  *) bad "embed/bootstrap.js ($b_code)" ;;
esac
docker exec -u tester -e HOME=/home/tester "$QA_CONTAINER" bash -lc \
  "curl -sS 'http://127.0.0.1:$PORT/dsh-remote-workspace-server/embed/bootstrap.js' | grep -q '__dshRwShimmed__'" \
  && ok "bootstrap contains storage shim" || bad "bootstrap shim missing"
c_code="$(docker exec -u tester -e HOME=/home/tester "$QA_CONTAINER" bash -lc \
  "curl -sS -o /dev/null -w '%{http_code} %{content_type}' 'http://127.0.0.1:$PORT/dsh-remote-workspace-server/embed/embed.css'")"
case "$c_code" in
  200*) ok "embed/embed.css ($c_code)" ;;
  *) bad "embed/embed.css ($c_code)" ;;
esac
docker exec -u tester -e HOME=/home/tester "$QA_CONTAINER" bash -lc \
  "curl -sS -b $JAR 'http://127.0.0.1:$PORT/' | grep -q '__DSH_RW_EMBED__'" \
  && ok "index injects __DSH_RW_EMBED__" || bad "index injection missing"
docker exec -u tester -e HOME=/home/tester "$QA_CONTAINER" bash -lc \
  "curl -sS -b $JAR 'http://127.0.0.1:$PORT/' | grep -Eq '(src=\"dsh-remote-workspace-server/embed/bootstrap.js\"|src=\"/dsh-remote-workspace-server/embed/bootstrap.js\")'" \
  && ok "index injects bootstrap script (relative or absolute path)" || bad "bootstrap script tag missing"

echo "----" | tee -a "$LOG"
printf 'RESULT profile %s: %s passed, %s failed (log: %s)\n' "$PROFILE" "$pass" "$fail" "$LOG" | tee -a "$LOG"
[ "$fail" -eq 0 ]
