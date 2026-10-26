#!/usr/bin/env bash
# Remove QA containers, their /tmp data, and (optionally) the images.
#
#   scripts/qa/cleanup.sh [--name server] [--all] [--images] [--yes]
#
#   --name NAME   clean one instance (default: server)
#   --all         clean every dsh.qa-labelled container and every data dir under
#                 $DSH_QA_ROOT (default /tmp/dsh-qa)
#   --images      also remove locally built dsh-qa-server:* images
#   --yes         skip the confirmation for --all
#
# Refuses to delete anything whose resolved path is not under a temp root.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

NAME="server"
ALL=0
IMAGES=0
ASSUME_YES=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --all) ALL=1; shift ;;
    --images) IMAGES=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) qa_die "unknown argument: $1" ;;
  esac
done

qa_require_docker

# Only ever delete under a temp root.
resolved_root="$(cd "$QA_ROOT" 2>/dev/null && pwd -P || true)"
if [ -z "$resolved_root" ]; then
  qa_log "data root $QA_ROOT does not exist; nothing to delete"
else
  case "$resolved_root" in
    /tmp/*|/private/tmp/*) ;;
    *) qa_die "refusing to delete non-temp QA_ROOT=$resolved_root" ;;
  esac
fi

if [ "$ALL" -eq 1 ] && [ "$ASSUME_YES" -ne 1 ]; then
  printf 'About to remove ALL QA containers and data under %s (images=%s). Continue? [y/N] ' \
    "${resolved_root:-$QA_ROOT}" "$IMAGES" >&2
  read -r answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) qa_die "aborted" ;;
  esac
fi

containers=()
if [ "$ALL" -eq 1 ]; then
  while IFS= read -r c; do [ -n "$c" ] && containers+=("$c"); done \
    < <(docker ps -aq --filter 'label=dsh.qa=1' 2>/dev/null || true)
else
  if docker inspect "dsh-qa-$NAME" >/dev/null 2>&1; then
    containers+=("dsh-qa-$NAME")
  fi
fi

for c in "${containers[@]:-}"; do
  [ -n "$c" ] || continue
  qa_log "removing container $c"
  docker rm -f "$c" >/dev/null
done

if [ "$ALL" -eq 1 ]; then
  while IFS= read -r vol; do
    [ -n "$vol" ] || continue
    qa_log "removing docker volume $vol"
    docker volume rm -f "$vol" >/dev/null 2>&1 || true
  done < <(docker volume ls -q --filter 'label=dsh.qa=1' 2>/dev/null || true)
else
  volume="dsh-qa-$NAME-dsh-home"
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    qa_log "removing docker volume $volume"
    docker volume rm -f "$volume" >/dev/null 2>&1 || true
  fi
fi

if [ "$ALL" -eq 1 ]; then
  if [ -n "$resolved_root" ] && [ -d "$resolved_root" ]; then
    for pidfile in "$resolved_root"/*/run/tunnel.pid; do
      [ -f "$pidfile" ] && kill "$(cat "$pidfile" 2>/dev/null || true)" 2>/dev/null || true
    done
    qa_log "removing data root $resolved_root"
    rm -rf "$resolved_root"
  fi
  if [ "$IMAGES" -eq 1 ]; then
    while IFS= read -r image; do
      [ -n "$image" ] || continue
      qa_log "removing image $image"
      docker rmi -f "$image" >/dev/null 2>&1 || true
    done < <(docker images --format '{{.Repository}}:{{.Tag}}' 'dsh-qa-server' 2>/dev/null || true)
  fi
else
  instance_dir="$QA_ROOT/$NAME"
  if [ -d "$instance_dir" ]; then
    resolved_instance="$(cd "$instance_dir" && pwd -P)"
    case "$resolved_instance" in
      /tmp/*|/private/tmp/*)
        if [ -f "$resolved_instance/run/tunnel.pid" ]; then
          kill "$(cat "$resolved_instance/run/tunnel.pid" 2>/dev/null || true)" 2>/dev/null || true
        fi
        qa_log "removing data dir $resolved_instance"
        rm -rf "$resolved_instance"
        ;;
      *) qa_die "refusing to delete non-temp path $resolved_instance" ;;
    esac
  fi
  if [ "$IMAGES" -eq 1 ]; then
    image="$(docker images --format '{{.Repository}}:{{.Tag}}' 'dsh-qa-server' 2>/dev/null | head -1 || true)"
    [ -z "$image" ] || docker rmi -f "$image" >/dev/null 2>&1 || true
  fi
fi

qa_log "remaining QA containers:"
docker ps -a --filter 'label=dsh.qa=1' --format '  {{.Names}} {{.Status}}' || true
qa_log "host listeners on 127.0.0.1 (ssh/web ports):"
if command -v lsof >/dev/null 2>&1; then
  lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -E ':(22|22022|22024|24022|24024) ' || true
fi
qa_log "cleanup done"
