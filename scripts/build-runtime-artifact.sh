#!/usr/bin/env bash
# Build a test-only isolated runtime artifact from the *server's* installed DSH.
#
# Layout (protocol §6.1 / provision/runtime.ts):
#   node/bin/node
#   dsh/node_modules/.bin/dsh
#   dsh/node_modules/@deepseek-ai/dsh/...
#
# Run this on a Linux host (or inside the QA Docker target) that already has
# `dsh` and `node` installed. The output is a local test artifact, not a release:
#   scripts/build-runtime-artifact.sh [--out DIR] [--dsh-version X]
set -euo pipefail

OUT_DIR="${PWD}/dist/runtime"
DSH_VERSION=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --out) OUT_DIR="$2"; shift 2 ;;
    --dsh-version) DSH_VERSION="$2"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

command -v node >/dev/null || { echo "node not found" >&2; exit 2; }
command -v dsh >/dev/null || { echo "dsh not found" >&2; exit 2; }
[ -n "$DSH_VERSION" ] || DSH_VERSION="$(dsh --version | tr -d '[:space:]')"
[ -n "$DSH_VERSION" ] || { echo "cannot determine dsh version" >&2; exit 2; }

uname_s="$(uname -s)"
case "$uname_s" in
  Linux) platform=linux ;;
  Darwin) platform=darwin ;;
  *) echo "unsupported platform $uname_s" >&2; exit 2 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) echo "unsupported arch $(uname -m)" >&2; exit 2 ;;
esac
platform_arch="${platform}-${arch}"

NODE_BIN="$(command -v node)"
NODE_REAL="$(readlink -f "$NODE_BIN" 2>/dev/null || printf '%s' "$NODE_BIN")"
DSH_BIN="$(command -v dsh)"
DSH_REAL="$(readlink -f "$DSH_BIN" 2>/dev/null || printf '%s' "$DSH_BIN")"
NPM_ROOT="$(npm root -g 2>/dev/null || true)"
if [ -z "$NPM_ROOT" ] || [ ! -d "$NPM_ROOT/@deepseek-ai/dsh" ]; then
  # Fallback: derive the package root from the launcher's real path.
  NPM_ROOT="$(CDPATH= cd -- "$(dirname -- "$DSH_REAL")/.." && pwd -P)"
fi
[ -d "$NPM_ROOT/@deepseek-ai/dsh" ] || { echo "cannot locate @deepseek-ai/dsh under $NPM_ROOT" >&2; exit 2; }

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/dsh-runtime-stage.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/node/bin" "$STAGE/dsh/node_modules"
cp "$NODE_REAL" "$STAGE/node/bin/node"
chmod 755 "$STAGE/node/bin/node"
# Copy the global install verbatim: the test artifact must run without network
# and without the host's global node_modules.
cp -a "$NPM_ROOT/." "$STAGE/dsh/node_modules/"
mkdir -p "$STAGE/dsh/node_modules/.bin"
cat > "$STAGE/dsh/node_modules/.bin/dsh" <<'LAUNCHER'
#!/bin/sh
# Relative launcher: PATH supplies node from <runtime>/node/bin.
exec node "$(dirname "$0")/../@deepseek-ai/dsh/bin/dsh.js" "$@" 2>/dev/null || \
  exec node "$(dirname "$0")/../@deepseek-ai/dsh/lib/cli.js" "$@"
LAUNCHER
chmod 755 "$STAGE/dsh/node_modules/.bin/dsh"

mkdir -p "$OUT_DIR"
NAME="dsh-runtime-${DSH_VERSION}-${platform_arch}.tar.gz"
tar -czf "$OUT_DIR/$NAME" -C "$STAGE" node dsh
SHA="$(sha256sum "$OUT_DIR/$NAME" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$OUT_DIR/$NAME" | awk '{print $1}')"
printf '%s  %s\n' "$SHA" "$NAME" > "$OUT_DIR/$NAME.sha256"
echo "built $OUT_DIR/$NAME"
echo "sha256 $SHA"
echo "version $DSH_VERSION platform $platform_arch"
