#!/usr/bin/env bash
# Run a command inside the QA target as the unprivileged tester user with the
# isolated DSH_HOME.
#
#   scripts/qa/exec.sh [--name server] -- dsh --version
#   scripts/qa/exec.sh --name server 'dsh plugin --profile web list'
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

if [ "$#" -eq 0 ]; then
  qa_die "usage: exec.sh [--name server] -- <command...>"
fi
if [ "$#" -eq 1 ] && [ -n "$1" ]; then
  qa_docker_exec_bash "$1"
else
  qa_docker_exec "$@"
fi
