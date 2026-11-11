# tests/e2e

QA browser/E2E assets for `dsh-remote-workspace` v1.

- `qa-target-smoke.sh` — repeatable baseline for the disposable Docker+SSH
  server target (`scripts/qa/`). Verifies loopback-only SSH, isolated
  `~/.dsh`, Node/DSH version contract, mock model fixture, `dsh web` startup,
  and an optional real headless agent turn (`--turn`) that exercises the agent
  loop, the bash tool and server-side session logging without real credentials.

- `scripts/qa/profile-smoke.sh` (in the QA scripts directory) — server plugin P1
  smoke: handshake, lease error paths, embed/bootstrap/css, index injection,
  workspace/session RPCs. Run it after `profile-start.sh`.

The full v1 acceptance matrix (client connection, remote tree, server/local
modes, switching, reconnect, two clients, errors, cleanup) lives in
`doc/qa-v1-plan.md`; its execution evidence goes to `doc/qa-v1-report.md`.

Planned browser E2E cases (blocked on the new plugin implementation):

1. server standalone: add workspace → new session → one turn (server UI).
2. client A connects, remote tree renders server workspaces/sessions.
3. server mode: open session, one turn, evidence in server `~/.dsh/sessions`.
4. local mode: one turn, client-side model request, server-side log.
5. mode switch both directions, including a running turn.
6. disconnect/reconnect, no orphan processes/ports.
7. two clients with different clientIds, shared workspace/session data.
8. profile lock conflict, host-key change, runtime/plugin install failures.
9. cleanup: no containers/ports/temp dirs; real `~/.dsh` untouched.

Do not mark any of these as passing without the evidence defined in
`doc/qa-v1-plan.md`.
