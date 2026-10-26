#!/usr/bin/env bash
# QA target entrypoint: install the per-run public key, then run sshd in the
# foreground. Everything else (dsh web, mock model, plugin installs) is driven
# from the host through scripts/qa/*.sh.
set -euo pipefail

authorized_key="${QA_AUTHORIZED_KEY:-/qa/authorized_keys.pub}"
key_target="/home/tester/.ssh/authorized_keys"

install -d -m 700 -o tester -g tester /home/tester/.ssh
if [ -f "$authorized_key" ]; then
  install -m 600 -o tester -g tester "$authorized_key" "$key_target"
else
  echo "[entrypoint] no authorized key mounted at $authorized_key" >&2
  exit 1
fi

# QA-only fixture credential for the client password-auth path. The container
# publishes SSH on 127.0.0.1 only and never holds a real credential.
if [ -n "${QA_TESTER_PASSWORD:-}" ]; then
  printf 'tester:%s\n' "$QA_TESTER_PASSWORD" | chpasswd
fi

# ~/.dsh is a named Docker volume: real ownership persists across container
# restarts, so DSH owner-only files (credentials, session locks) keep mode 600.
install -d -m 700 -o tester -g tester /home/tester/.dsh
chown -R tester:tester /home/tester/.dsh

mkdir -p /run/sshd
exec /usr/sbin/sshd -D -e
