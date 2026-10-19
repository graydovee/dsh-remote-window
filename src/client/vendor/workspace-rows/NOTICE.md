# Vendored: the official workspace row layer

Source checkout: `<dsh-checkout>`
Upstream paths:

- `packages/client/ui-workspace/src/client/rows/Rows.tsx`
- `packages/client/ui-workspace/src/client/rows/AnimatedRows.tsx`
- `packages/client/ui-workspace/src/client/rows/Rows.module.css`
- `packages/client/ui-workspace/src/client/rows/AnimatedRows.module.css`
- `packages/client/ui-workspace/src/client/locales.ts` (the `workspace` namespace dictionaries)

License: MIT (DeepSeek Harness). Files under `generated/` are produced by
`scripts/vendor-workspace-rows.mjs`, which prefixes every CSS class
(`dsh-rwv-rows-` / `dsh-rwv-anim-`) and rewires the imports this bundle cannot
keep. Do not edit them by hand — re-run the script after upgrading DSH.
