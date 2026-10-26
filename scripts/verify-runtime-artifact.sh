#!/usr/bin/env bash
# Exercise one isolated runtime artifact end-to-end: extract, run node/dsh,
# generate a factory web profile, start `dsh web`, read the token line, hit `/`.
#
#   scripts/verify-runtime-artifact.sh <dsh-runtime-*.tar.gz>
set -euo pipefail
[ "$#" -eq 1 ] || { echo "usage: $0 <runtime artifact.tar.gz>" >&2; exit 2; }
ARTIFACT="$(readlink -f "$1")"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/dsh-runtime-verify.XXXXXX")"
cleanup() {
  if [ -n "${PID:-}" ]; then kill "$PID" 2>/dev/null || true; fi
  rm -rf "$ROOT"
}
trap cleanup EXIT
mkdir -p "$ROOT/runtime" "$ROOT/home" "$ROOT/work"
tar -xzf "$ARTIFACT" -C "$ROOT/runtime"
NODE="$ROOT/runtime/node/bin/node"
DSH="$ROOT/runtime/dsh/node_modules/.bin/dsh"
[ -x "$NODE" ] || { echo "missing node binary" >&2; exit 1; }
[ -x "$DSH" ] || { echo "missing dsh launcher" >&2; exit 1; }
export DSH_HOME="$ROOT/home"
export PATH="$ROOT/runtime/node/bin:$ROOT/runtime/dsh/node_modules/.bin:$PATH"
"$NODE" -v
"$DSH" --version
cd "$ROOT/work"
"$DSH" --profile web --dump-config >/dev/null
"$DSH" web --host 127.0.0.1 --port 0 --no-open >"$ROOT/web.log" 2>"$ROOT/web.err" &
PID=$!
for _ in $(seq 1 120); do
  grep -q '^dsh web: ' "$ROOT/web.log" && break
  kill -0 "$PID" 2>/dev/null || { echo "profile server exited" >&2; tail -20 "$ROOT/web.err" >&2; exit 1; }
  sleep 0.25
done
grep '^dsh web: ' "$ROOT/web.log" || { echo "no token line" >&2; tail -20 "$ROOT/web.err" >&2; exit 1; }
URL="$(sed -n 's/^dsh web: //p' "$ROOT/web.log")"
CODE="$("$NODE" -e 'fetch(process.argv[1], { redirect: "manual" }).then(r => process.stdout.write(String(r.status))).catch(e => { console.error(e); process.exit(1) })' "$URL")"
echo "index status: $CODE"
[ "$CODE" = "303" ] || [ "$CODE" = "200" ] || { echo "unexpected index status $CODE" >&2; exit 1; }
echo "RUNTIME VERIFY PASS ($(basename "$ARTIFACT"))"
