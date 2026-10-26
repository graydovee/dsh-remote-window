#!/usr/bin/env bash
# Open an interactive SSH session to the QA target (loopback only).
#
#   scripts/qa/ssh.sh [--name server] [-- command...]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

NAME="server"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --) shift; break ;;
    *) break ;;
  esac
done

QA_NAME="$NAME"
QA_DIR="$QA_ROOT/$NAME"
QA_STATE="$QA_DIR/state.env"
QA_CONTAINER="dsh-qa-$NAME"
qa_require_docker
qa_container_require_running

qa_ssh "$@"
