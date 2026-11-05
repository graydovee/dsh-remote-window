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
  "plugin": "0.1.0-alpha.4",
  "dsh": { "min": "0.2.1-rc.3", "max": "0.2.1-rc.3" },
  "runtimes": [
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

1. Run the client test suite against the new dsh build and note what breaks.
2. Append `{ "dsh": "<new>", "platforms": [...] }` as the **first** entry of `runtimes[]` (strictly
   newest-first) and widen `dsh.max` (and `dsh.min` only if the old minimum is dropped).
3. `node scripts/sync-compat.mjs`, then `pnpm typecheck`, `pnpm test`, `pnpm build`.
4. Build the platform artifacts (`scripts/build-runtime-artifact.mjs`), place them in
   `~/.dsh/remote-assets/` for local QA or let the server release job publish them.
