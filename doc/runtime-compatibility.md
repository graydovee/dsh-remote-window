# DSH compatibility and runtime selection

This document is the maintainer contract for the version relationship between `dsh-remote-window` and the
DSH runtime it drives remotely. User-facing prose lives in `README.md` / `README-zh.md`.

## 1. Why an interval

DSH is a developer preview: a release *above* the one we tested can break exactly like one below it. A
one-sided rule ("this version or newer") is therefore wrong, and an exact-equality rule cannot express
"supported, but not yet built". The contract is a **closed interval** plus a list of artifacts:

```json
{
  "schema": 2,
  "plugin": "0.1.0-alpha.6",
  "dsh": { "min": "0.2.1-rc.2", "max": "0.2.2-rc.1" },
  "runtimes": [
    { "dsh": "0.2.2-rc.1", "platforms": ["linux-x64-gnu", "linux-arm64-gnu", "darwin-x64", "darwin-arm64", "win32-x64"] },
    { "dsh": "0.2.1-rc.5", "platforms": ["linux-x64-gnu", "linux-arm64-gnu", "darwin-x64", "darwin-arm64", "win32-x64"] },
    { "dsh": "0.2.1-rc.3", "platforms": ["linux-x64-gnu", "linux-arm64-gnu", "darwin-x64", "darwin-arm64", "win32-x64"] }
  ]
}
```

`compat/runtimes.json` is the single source of truth. `compat/history.json` records the interval of each
released plugin version (newest last); the sync script validates both.

## 1b. What "supported" is verified against

The interval is a declaration, not a guarantee that nothing changed: the automated suite (typecheck plus the
vitest suite, including the profile-service and provision integration tests) runs against the **newest**
runtime in the interval because `devDependencies` pin it exactly. A real-machine run on that newest release is
still required before a release page calls it verified — the last full Windows/real-host run was on
`0.2.1-rc.3`, so a newer release stays in the interval but is marked as such in the release notes.

Verification record — `0.2.2-rc.1` (plugin `0.1.0-alpha.6`):

- automatic: `pnpm typecheck`, `pnpm test`, `pnpm build` on the pinned `0.2.2-rc.1` packages, plus a clean
  `DSH_HOME` install (`dsh plugin --profile web add <tarball>`) that boots `dsh web` and serves
  `/dsh-remote-window/api/*` and `/dsh-remote-window/official-ui.js`;
- remote profile: the rebuilt server plugin starts inside a dedicated profile on `0.2.2-rc.1`, mounts the
  official providers and answers the P1 `/api/handshake` + execution-world RPCs (`fs.patch`, `fs.delete`,
  `fs.move` included);
- still open: a real SSH-host run on `0.2.2-rc.1` (POSIX and Windows) and a browser pass over the portal,
  vendored workspace rows and the `<768px` drawer breakpoint; until that run happens the release notes must
  say so rather than call the pair verified.

## 2. What the generated files are

`node scripts/sync-compat.mjs` validates the tables and rewrites, in place:

| Output | Why it is generated |
| --- | --- |
| `src/provision/runtime-compat.generated.ts` | The runtime reads the same table the release published — no hand-copied constant. |
| `package.json` `engines.dsh` + every `@deepseek-ai/dsh-*` peer | The manifest must state the interval an installer sees. |
| `README.md` / `README-zh.md` block between `<!-- verified-runtimes:start -->` and `<!-- verified-runtimes:end -->` | The supported matrix is documentation users read. |

`--check` compares instead of writing and exits non-zero on drift; the client release workflow runs it, so a
stale table cannot be published. The expression is `rangeExpression(range)`: the exact version while the
interval is a single release, `>=min <=max` otherwise.

## 3. How a connection chooses a runtime

`selectRuntimeVersion` in `src/provision/runtime-selection.ts` is the only decision point (pure, injectable,
unit-tested). Priority, highest first:

1. `DSH_RW_RUNTIME_ARTIFACT` — its manifest (`<file>.manifest.json`) must be inside the interval; an
   out-of-range artifact surfaces as `too-old`/`too-new` instead of being used silently.
2. The remote's own global dsh — only when the scan saw a healthy launcher and its version is in the interval.
3. The newest interval runtime already in `~/.dsh/remote-assets/`.
4. The newest interval runtime published as a release asset (no client-side downloader ships yet).
5. The newest interval runtime this host can build (POSIX hosts only).

A version inside the interval with no artifact is `no-artifact` with its own message; `too-new` advises
upgrading the plugin, `too-old` advises upgrading the server's dsh.

## 4. Artifact naming

`dsh-runtime-<dsh version>-<platform tag>.tar.gz`. The name describes the **content** (`node/` plus
`@deepseek-ai/dsh@<dsh>`, no plugin code), which is why several plugin versions reuse one artifact. The
plugin version never appears in a runtime file name.

## 5. Release flow

1. Client release (`v<plugin>`): `sync-compat --check` → `pnpm pack` → `scripts/emit-runtime-compat.mjs`
   writes `runtime-compat.json` → uploaded as a release asset.
2. Server release (`v<plugin>` or `server-v<dsh>`): downloads that snapshot, derives its runtime matrix from
   it, builds the platforms it can stage, and renders its release body from the same numbers
   (`scripts/render-release-notes.mjs`) — the supported interval, which platforms got an asset, and which are
   still missing (win32 today). The snapshot is attached to the release too.

## 6. Adding a DSH release

Every time upstream publishes a dsh the plugin claims to support, update the declaration in the same change:

1. Read the upstream release notes and run the suite against the new build: `pnpm install` with the packages
   pinned by `sync-compat` (step 3 does the bump), then `pnpm typecheck`, `pnpm test`, `pnpm build`. Note what
   broke, and whether a real-machine run is needed before the interval may grow.
2. Edit `compat/runtimes.json`: put the new version as the **first** entry of `runtimes[]` (the list is
   strictly newest-first and every entry must sit inside the interval), widen `dsh.max` (and `dsh.min` only
   when the old minimum is dropped on purpose). Keep the previous entries: existing servers/caches keep
   resolving them.
3. Append `{ "plugin": "<next plugin version>", "min": …, "max": …, "runtimes": [...] }` to
   `compat/history.json` — one row per released plugin version, and the last row must match
   `package.json`'s version.
4. `node scripts/sync-compat.mjs` and commit everything it rewrites: `src/provision/runtime-compat.generated.ts`,
   `package.json` (`engines.dsh` + every `@deepseek-ai/dsh-*` peer as the interval expression, the dsh
   packages themselves pinned to the newest entry), and both README compatibility tables. `pnpm install`
   afterwards so the lockfile follows the new pins.
5. Run the gates again (`pnpm typecheck`, `pnpm test`, `pnpm build`) and `node scripts/sync-compat.mjs --check`.
6. Record the verification in section 1b: what was exercised automatically and what needs a real-machine run.
   The release body is generated from `runtime-compat.json`, so the same numbers reach the release page.
7. If the new release also needs a runtime artifact, build it (`scripts/build-runtime-artifact.mjs`, or let
   the server release job do it) and QA it from `~/.dsh/remote-assets/` before publishing.

The interval is what the plugin *accepts*; the exact pins are what CI and users install. Do not widen the
interval on a test run alone when the change touches startup, portal, or persistence — those need the
real-machine checklist in `doc/windows-server-support.md` §6 or an equivalent run on the new build.
