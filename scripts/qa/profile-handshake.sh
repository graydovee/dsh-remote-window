#!/usr/bin/env bash
# Send one handshake to the per-client profile server, with overrides for the
# error paths required by the protocol (profile-*, plugin-version-*).
#
#   scripts/qa/profile-handshake.sh [--name server] [--profile <p>] \
#       [--client-id <id>] [--instance-id <id>] \
#       [--plugin-version 0.1.0-alpha.3] [--protocol 1] \
#       [--token-fingerprint <s>] [--no-cookie] \
#       [--expect-status <n>] [--expect-code <code>] [--json]
#
# The profile name determines the default clientId:
#   graydovee-remote-workspace-<clientId>
# The cookie is obtained by GET /?token=... inside the container (one-time
# token is read from the profile server log). Never paste the token into docs.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

NAME="server"
PROFILE=""
CLIENT_ID=""
INSTANCE_ID=""
PLUGIN_VERSION="0.1.0-alpha.3"
PROTOCOL="1"
BODY_PROFILE=""
TOKEN_FINGERPRINT=""
USE_COOKIE=1
EXPECT_STATUS=""
EXPECT_CODE=""
RAW_JSON=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --client-id) CLIENT_ID="$2"; shift 2 ;;
    --instance-id) INSTANCE_ID="$2"; shift 2 ;;
    --plugin-version) PLUGIN_VERSION="$2"; shift 2 ;;
    --body-profile) BODY_PROFILE="$2"; shift 2 ;;
    --protocol) PROTOCOL="$2"; shift 2 ;;
    --token-fingerprint) TOKEN_FINGERPRINT="$2"; shift 2 ;;
    --no-cookie) USE_COOKIE=0; shift ;;
    --expect-status) EXPECT_STATUS="$2"; shift 2 ;;
    --expect-code) EXPECT_CODE="$2"; shift 2 ;;
    --json) RAW_JSON=1; shift ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) qa_die "unknown argument: $1" ;;
  esac
done
[ -n "$PROFILE" ] || qa_die "--profile is required"
case "$PROFILE" in
  ?*) ;;
esac
[ -n "$BODY_PROFILE" ] || BODY_PROFILE="$PROFILE"
if [ -z "$CLIENT_ID" ]; then
  case "$PROFILE" in
    graydovee-remote-workspace-*) CLIENT_ID="${PROFILE#graydovee-remote-workspace-}" ;;
    *) CLIENT_ID="$PROFILE" ;;
  esac
fi
[ -n "$INSTANCE_ID" ] || INSTANCE_ID="qa-instance-$(date +%s)-$$"

QA_NAME="$NAME"
QA_DIR="$QA_ROOT/$NAME"
QA_STATE="$QA_DIR/state.env"
qa_load_state
QA_CONTAINER="${QA_CONTAINER:-dsh-qa-$NAME}"
qa_require_docker
qa_container_require_running

safe_profile="${PROFILE//[^a-zA-Z0-9_.-]/_}"
envfile="$QA_DIR/run/profile-$safe_profile.env"
[ -f "$envfile" ] || qa_die "no $envfile; run profile-start.sh first"
# shellcheck disable=SC1090
. "$envfile"
PORT="$QA_PROFILE_PORT"

body="$(PROFILE="$BODY_PROFILE" CLIENT_ID="$CLIENT_ID" INSTANCE_ID="$INSTANCE_ID" \
  PLUGIN_VERSION="$PLUGIN_VERSION" PROTOCOL="$PROTOCOL" TOKEN_FP="$TOKEN_FINGERPRINT" \
  node -e '
    const body = {
      protocol: Number(process.env.PROTOCOL),
      pluginVersion: process.env.PLUGIN_VERSION,
      clientId: process.env.CLIENT_ID,
      instanceId: process.env.INSTANCE_ID,
      profile: process.env.PROFILE,
    };
    if (process.env.TOKEN_FP) body.tokenFingerprint = process.env.TOKEN_FP;
    process.stdout.write(JSON.stringify(body));
  ')"

cookie_flag=()
if [ "$USE_COOKIE" -eq 1 ]; then
  cookie_flag=(-c /home/tester/qa-run/handshake-cookies.txt -b /home/tester/qa-run/handshake-cookies.txt)
fi

# Fresh cookie jar per call unless the caller wants a shared session.
rm -f "$QA_DIR/run/handshake-cookies.txt" >/dev/null 2>&1 || true
docker exec -u tester -e HOME=/home/tester "$QA_CONTAINER" bash -lc \
  "rm -f /home/tester/qa-run/handshake-cookies.txt; curl -sS -o /dev/null -c /home/tester/qa-run/handshake-cookies.txt '$QA_PROFILE_URL'" \
  >/dev/null 2>&1 || true

response="$(docker exec -i -u tester -e HOME=/home/tester "$QA_CONTAINER" bash -lc \
  "curl -sS -o /tmp/qa-handshake-body.json -w '%{http_code}' \\
     -b /home/tester/qa-run/handshake-cookies.txt \\
     -X POST 'http://127.0.0.1:$PORT/dsh-remote-workspace-server/api/handshake' \\
     -H 'content-type: application/json' \\
     --data '$body'; echo; cat /tmp/qa-handshake-body.json")"

status="$(printf '%s\n' "$response" | head -1)"
json="$(printf '%s\n' "$response" | tail -n +2)"
[ -n "$status" ] || qa_die "handshake produced no HTTP status"

qa_log "handshake status=$status clientId=$CLIENT_ID instanceId=$INSTANCE_ID profile=$PROFILE"
if [ "$RAW_JSON" -eq 1 ]; then
  printf '%s\n' "$json"
else
  printf '%s\n' "$json" | node -e '
    let raw="";
    process.stdin.on("data", c => raw += c);
    process.stdin.on("end", () => {
      let value;
      try { value = JSON.parse(raw) } catch { console.log(raw.trim()); process.exit(0) }
      const scrub = (text) => String(text).replace(/token=[^&"\\s]+/g, "token=<redacted>");
      if (value.ok) {
        const v = value.value ?? {};
        console.log(JSON.stringify({
          ok: true,
          protocol: v.protocol,
          pluginVersion: v.pluginVersion,
          dshVersion: v.dshVersion,
          profile: v.profile,
          clientId: v.clientId,
          lease: v.lease,
          staleTakeover: v.staleTakeover,
          registry: v.registry,
          capabilities: v.capabilities,
          activeAgents: v.activeAgents,
        }, null, 2));
      } else {
        console.log(scrub(JSON.stringify(value, null, 2)));
      }
    });
  '
fi

if [ -n "$EXPECT_STATUS" ] && [ "$status" != "$EXPECT_STATUS" ]; then
  qa_die "expected HTTP $EXPECT_STATUS, got $status"
fi
if [ -n "$EXPECT_CODE" ]; then
  actual_code="$(printf '%s' "$json" | node -e '
    let raw="";process.stdin.on("data",c=>raw+=c);process.stdin.on("end",()=>{
      try{const v=JSON.parse(raw);process.stdout.write(String(v?.error?.code??""))}catch{process.stdout.write("")}
    })')"
  if [ "$actual_code" != "$EXPECT_CODE" ]; then
    printf '%s\n' "$json" >&2
    qa_die "expected error code $EXPECT_CODE, got $actual_code"
  fi
  qa_log "expected error code observed: $EXPECT_CODE"
fi

exit 0
