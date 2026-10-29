#!/usr/bin/env bash
# Manage an isolated client debug instance (independent DSH_HOME) for QA.
#
#   scripts/qa/client-instance.sh start --name client-a --port 25022 \
#       --client-tarball /tmp/dsh-rw-m1/dsh-remote-window-0.1.0-alpha.3.tgz \
#       [--server-tarball <server plugin tarball>] [--dsh <cli>]
#   scripts/qa/client-instance.sh stop  --name client-a
#   scripts/qa/client-instance.sh status --name client-a
#
# The instance lives under /tmp/dsh-qa/clients/<name>/ (home, work, logs) and
# never touches the real ~/.dsh. The printed token URL is QA-only; strip
# ?token=... before pasting anywhere.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

MODE="${1:-start}"; shift || true
NAME=""
PORT="25022"
CLIENT_TARBALL=""
SERVER_TARBALL="${DSH_RW_SERVER_PLUGIN_TARBALL:-}"
DSH_CLI="${DSH_QA_CLI:-}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --client-tarball) CLIENT_TARBALL="$2"; shift 2 ;;
    --server-tarball) SERVER_TARBALL="$2"; shift 2 ;;
    --dsh) DSH_CLI="$2"; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) qa_die "unknown argument: $1" ;;
  esac
done
[ -n "$NAME" ] || qa_die "--name is required"

CLIENT_ROOT="/tmp/dsh-qa/clients/$NAME"
HOME_DIR="$CLIENT_ROOT/home"
WORK_DIR="$CLIENT_ROOT/work"
LOG="$CLIENT_ROOT/client-web.log"

if [ -z "$DSH_CLI" ]; then
  if command -v dsh >/dev/null 2>&1; then
    DSH_CLI="$(command -v dsh)"
  else
    DSH_CLI="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
  fi
fi
[ -x "$DSH_CLI" ] || qa_die "dsh launcher not found/executable: $DSH_CLI (pass --dsh)"

stop_instance() {
  local pid
  pid="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    kill -9 "$pid" 2>/dev/null || true
  fi
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    qa_die "port $PORT is still listening after stop"
  fi
  qa_log "client instance $NAME stopped (port $PORT closed)"
}

case "$MODE" in
  stop)
    stop_instance
    exit 0
    ;;
  status)
    printf 'client instance: %s\n' "$NAME"
    printf '  root: %s\n' "$CLIENT_ROOT"
    printf '  port: %s (%s)\n' "$PORT" "$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && echo listening || echo closed)"
    printf '  log:  %s\n' "$LOG"
    node -e "const fs=require('fs');const p='$HOME_DIR/profiles/web/package.json';try{const j=JSON.parse(fs.readFileSync(p,'utf8'));console.log('  plugin:',j.dependencies?.['dsh-remote-window']||'absent');console.log('  bundles:',(j.dsh?.profile?.bundles||[]).join(', '))}catch{console.log('  profile: absent')}" 2>/dev/null || true
    tail -2 "$LOG" 2>/dev/null | sed 's/^/  /' || true
    exit 0
    ;;
  start) ;;
  *) qa_die "unknown mode: $MODE (start|stop|status)" ;;
esac

[ -n "$CLIENT_TARBALL" ] || qa_die "--client-tarball is required for start"
[ -f "$CLIENT_TARBALL" ] || qa_die "client tarball not found: $CLIENT_TARBALL"
qa_require_host_tool node

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  qa_die "port $PORT is already in use; stop the old instance or pick --port"
fi

mkdir -p "$HOME_DIR" "$WORK_DIR"
if [ ! -f "$HOME_DIR/profiles/web/package.json" ]; then
  qa_log "initializing fresh web profile under $HOME_DIR"
  ( cd "$WORK_DIR" && DSH_HOME="$HOME_DIR" "$DSH_CLI" --profile web --dump-config >/dev/null )
fi

qa_log "installing client plugin $(shasum -a 256 "$CLIENT_TARBALL" | awk '{print $1}')"
set +e
( cd "$WORK_DIR" && DSH_HOME="$HOME_DIR" "$DSH_CLI" plugin --profile web add "$CLIENT_TARBALL" ) \
  > "$CLIENT_ROOT/plugin-add.log" 2>&1
rc=$?
set -e
case "$rc" in
  0) ;;
  *) qa_log "dsh plugin add exited $rc (pnpm ignored-builds is non-fatal); verifying install" ;;
esac
node -e "
const fs=require('fs');
const p='$HOME_DIR/profiles/web/package.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
const plugin='dsh-remote-window';
if (!(plugin in (j.dependencies||{}))) { console.error('plugin dependency missing'); process.exit(1) }
j.dsh ??= {}; j.dsh.profile ??= {}; j.dsh.profile.bundles ??= [];
if (!j.dsh.profile.bundles.includes(plugin)) j.dsh.profile.bundles.push(plugin);
fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n');
console.log('bundles:', j.dsh.profile.bundles.join(', '));
" || { tail -20 "$CLIENT_ROOT/plugin-add.log" >&2; qa_die "client plugin install failed"; }

rm -f "$LOG"
env_args=()
[ -n "$SERVER_TARBALL" ] && env_args+=("DSH_RW_SERVER_PLUGIN_TARBALL=$SERVER_TARBALL")
qa_log "starting client dsh web on 127.0.0.1:$PORT (DSH_HOME=$HOME_DIR)"
if [ "${#env_args[@]}" -gt 0 ]; then
  ( cd "$WORK_DIR" && env DSH_HOME="$HOME_DIR" "${env_args[@]}" \
      "$DSH_CLI" web --host 127.0.0.1 --port "$PORT" --no-open > "$LOG" 2>&1 & echo $! > "$CLIENT_ROOT/client-web.pid" )
else
  ( cd "$WORK_DIR" && env DSH_HOME="$HOME_DIR" \
      "$DSH_CLI" web --host 127.0.0.1 --port "$PORT" --no-open > "$LOG" 2>&1 & echo $! > "$CLIENT_ROOT/client-web.pid" )
fi

url=""
# Boot can take longer than the first listen() poll; wait for the printed token
# URL and only fail on the overall timeout.
for _ in $(seq 1 120); do
  url="$(grep -oE "http://127.0.0.1:$PORT/\?token=[A-Za-z0-9_-]+" "$LOG" 2>/dev/null | head -1 || true)"
  [ -n "$url" ] && break
  sleep 1
done
[ -n "$url" ] || { tail -20 "$LOG" >&2; qa_die "client dsh web printed no token URL"; }

{
  printf 'client instance %s ready\n' "$NAME"
  printf '  root: %s\n' "$CLIENT_ROOT"
  printf '  token url: %s\n' "$url"
  printf '  server plugin tarball: %s\n' "${SERVER_TARBALL:-<unset>}"
} | tee "$CLIENT_ROOT/start.log" >&2
printf 'QA_CLIENT_TOKEN_URL=%s\n' "$url"
