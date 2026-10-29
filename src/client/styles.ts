/**
 * Plugin-owned stylesheet.
 *
 * The repository's `tsdown.config.mjs` does not process CSS for this plugin
 * (no CSS modules, no `?inline` loader), so the browser half ships ONE CSS
 * string injected as a single `<style data-plugin="dsh-remote-workspace">`
 * element from `apply` — the simplest correct approach under that build, and
 * an effect so hot reload disposes the tag with the rest of the contribution.
 *
 * Colors/spacing come from the shell's `--dsw-*` tokens so the surface
 * follows the active theme.
 */

/** A plug/link glyph: the connection row's 连接 button (the mask uses its alpha). */
const PLUG_MASK = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6"/><path d="M15 2v6"/><path d="M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6z"/><path d="M12 17v5"/></svg>',
)}")`

/** A minimal single-colour globe (the mask only uses its alpha). */
const GLOBE_MASK = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
)}")`

/** Marker attribute value for the injected `<style>` element. */
export const STYLE_PLUGIN_ID = 'dsh-remote-workspace'

/** The complete stylesheet. */
import { ROW_STYLES } from './vendor/workspace-rows/generated/row-styles.ts'
import { OFFICIAL_UI_STYLES } from './vendor/official-ui/styles.ts'

/**
 * The official InputBar is the upstream component, so its CSS-module class
 * names carry the upstream build hash (`uV2eYG` for the pinned rc.3 bundle).
 * Mirror the vendored, readable `.dsh-rwv-input-*` selectors onto those exact
 * names; the generated stylesheet remains the single source of truth.
 */
const officialInputAliasStyles = OFFICIAL_UI_STYLES.replace(
  /\.dsh-rwv-input-([A-Za-z0-9_-]+)/gu,
  '.uV2eYG_$1',
)

import { MODEL_SELECT_CSS } from './vendor/official-ui/model-css.ts'

export const STYLE_TEXT = `
/* The official workspace rows bring their own stylesheet; it is injected with
   ours so both surfaces (sidebar section and panel) share one <style> tag. */
${ROW_STYLES}

/* The official Conversation/Chat CSS modules vendored from the installed DSH
   release. Class selectors are prefixed; everything else is upstream. */
${OFFICIAL_UI_STYLES}
${officialInputAliasStyles}

/* ---------------------------------------------------------------- footer */

.dsh-rw-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.dsh-rw-page-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px 10px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dsh-rw-page-title {
  margin-left: auto;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-rw-page-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 12px;
}
.dsh-rw-page-foot {
  flex: none;
  padding: 10px 12px;
}
.dsh-rw-log {
  margin-top: 10px;
  border: 1px solid var(--dsw-alias-border, #e5e6eb);
  border-radius: var(--dsw-radius-md, 8px);
  overflow: hidden;
  background: var(--dsw-alias-bg-secondary, #f7f8fa);
}
.dsh-rw-log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  font-weight: 600;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  border-bottom: 1px solid var(--dsw-alias-border, #e5e6eb);
}
.dsh-rw-log-count {
  color: var(--dsw-alias-label-tertiary);
  font-weight: 400;
}
.dsh-rw-log-body {
  max-height: 220px;
  overflow-y: auto;
  padding: 8px 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
}
.dsh-rw-log-line {
  display: flex;
  gap: 8px;
  white-space: pre-wrap;
  word-break: break-all;
}
.dsh-rw-log-line[data-level='error'] .dsh-rw-log-text {
  color: #d93026;
}
.dsh-rw-log-line[data-level='ok'] .dsh-rw-log-text {
  color: #1a7f37;
}
.dsh-rw-log-time {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-rw-footer {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  width: 100%;
  height: 42px;
  margin: 8px 0 0;
}

.dsh-rw-footer[data-rail="true"] {
  width: 36px;
  height: 36px;
  margin: 0;
}

.dsh-rw-footer-button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 100%;
  padding: 0 10px;
  border: 0;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}

.dsh-rw-footer-button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dsh-rw-footer-button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-rw-footer[data-rail="true"] .dsh-rw-footer-button {
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 50%;
}

.dsh-rw-footer-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dsh-rw-footer-badge {
  margin-left: auto;
  flex: none;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

/* ------------------------------------------------------------- dialog box */

.dsh-rw-dialog {
  width: min(560px, 100%);
  max-height: 100%;
}

.dsh-rw-content {
  min-height: 0;
}

.dsh-rw-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}

.dsh-rw-scroll {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 54vh;
  overflow: auto;
  padding-right: 2px;
}

.dsh-rw-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.dsh-rw-step-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.dsh-rw-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dsh-rw-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-hint {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-empty {
  margin: 0;
  padding: 12px;
  border: 1px dashed var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary);
  text-align: center;
}

/* --------------------------------------------------------------- banners */

.dsh-rw-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  font-size: 13px;
  line-height: 19px;
  color: var(--dsw-alias-label-primary);
}

.dsh-rw-banner[data-kind="error"] {
  border-color: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
}

.dsh-rw-banner-text {
  flex: 1 1 auto;
  min-width: 0;
  word-break: break-word;
}

.dsh-rw-banner-code {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--dsw-alias-label-caption);
}

.dsh-rw-runtime-choices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.dsh-rw-connect-plan {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 20px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-connect-plan li::marker {
  color: var(--dsw-alias-label-caption);
}

.dsh-rw-connect-summary {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-rw-connect-summary-row {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  min-width: 0;
  font-size: 12px;
  line-height: 18px;
}

.dsh-rw-connect-summary-row dt {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-connect-summary-row dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  text-align: right;
  color: var(--dsw-alias-label-primary);
}

/* ---------------------------------------------------------- method cards */

.dsh-rw-methods {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}

.dsh-rw-method {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.dsh-rw-method:hover:not([data-disabled="true"]) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-rw-method[data-selected="true"] {
  border-color: var(--dsw-alias-state-business-primary);
}

.dsh-rw-method[data-disabled="true"] {
  cursor: not-allowed;
  opacity: 0.55;
}

.dsh-rw-method-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
}

.dsh-rw-method-description {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-method-state {
  font-size: 11px;
  color: var(--dsw-alias-label-caption);
}

/* --------------------------- step-3 scan panels (new cards, layout only)

   These are NOT the sidebar's rows: they are the two panels step 3 shows under
   its connection-method cards (the reuse candidate list and the upload summary).
   Every colour/spacing value comes from the shell's tokens, so the cards follow
   the active theme like the rest of the plugin. */

.dsh-rw-scan {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dsh-rw-candidates {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dsh-rw-candidate {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.dsh-rw-candidate:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-rw-candidate[data-selected="true"] {
  border-color: var(--dsw-alias-state-business-primary);
}

.dsh-rw-candidate:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.dsh-rw-candidate-main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.dsh-rw-candidate-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  word-break: break-all;
}

.dsh-rw-candidate-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-candidate-note {
  font-size: 11px;
  color: var(--dsw-alias-label-caption);
}

.dsh-rw-candidate-reason {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-state-error-primary);
}

.dsh-rw-candidate-action {
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}

/* ---------------------------------------------------------------- fields */

.dsh-rw-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dsh-rw-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}

.dsh-rw-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.dsh-rw-field-label {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}

.dsh-rw-field-hint {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-caption);
}

.dsh-rw-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.dsh-rw-grow {
  flex: 1 1 auto;
  min-width: 0;
}

/* The Input primitive wraps its <input> in a span; inside a flex row the
   wrapper grows, and the native field has to fill it. */
.dsh-rw-grow input {
  width: 100%;
  box-sizing: border-box;
}

.dsh-rw-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  word-break: break-all;
}

/* -------------------------------------------------------------- progress */

.dsh-rw-progress {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dsh-rw-progress-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
}

.dsh-rw-progress-row:last-child {
  border-bottom: 0;
}

.dsh-rw-progress-dot {
  flex: none;
  margin-top: 3px;
}

.dsh-rw-progress-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.dsh-rw-progress-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
}

.dsh-rw-progress-status {
  font-size: 11px;
  color: var(--dsw-alias-label-caption);
}

.dsh-rw-progress-row[data-progress="skipped"] .dsh-rw-progress-status {
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-progress-message {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  word-break: break-word;
}

.dsh-rw-progress-entry {
  display: flex;
  flex-direction: column;
}

.dsh-rw-progress-entry .dsh-rw-progress-row {
  border-bottom: 0;
}

.dsh-rw-progress-entry + .dsh-rw-progress-entry {
  border-top: 0.5px solid var(--dsw-alias-border-l1);
}

.dsh-rw-hostkey-inline {
  margin: 2px 0 10px 25px;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  font-size: 12px;
  line-height: 18px;
}

.dsh-rw-hostkey-inline p {
  margin: 0 0 6px;
}

.dsh-rw-hostkey-inline code {
  display: block;
  margin: 4px 0 6px;
  padding: 6px 8px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-secondary);
  overflow-wrap: anywhere;
}

.dsh-rw-hostkey {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 0.5px solid var(--dsw-alias-state-warn-primary);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-rw-hostkey-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-state-warn-primary);
}

/* ------------------------------------------------------------- directory */

.dsh-rw-crumbs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-height: 28px;
}

.dsh-rw-crumb {
  padding: 2px 6px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.dsh-rw-crumb:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dsh-rw-crumb[aria-current="true"] {
  color: var(--dsw-alias-label-primary);
}

.dsh-rw-crumb-separator {
  color: var(--dsw-alias-label-caption);
  font-size: 12px;
}

.dsh-rw-entries {
  display: flex;
  flex-direction: column;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  overflow: hidden;
}

.dsh-rw-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.dsh-rw-entry:last-child {
  border-bottom: 0;
}

.dsh-rw-entry:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-rw-entry[data-type="file"],
.dsh-rw-entry[data-type="other"] {
  color: var(--dsw-alias-label-tertiary);
  cursor: default;
}

.dsh-rw-entry[data-type="file"]:hover,
.dsh-rw-entry[data-type="other"]:hover {
  background: transparent;
}

.dsh-rw-entry-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dsh-rw-entry-kind {
  margin-left: auto;
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-caption);
}

/* ------------------------------------------------------------- list view */

.dsh-rw-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dsh-rw-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-rw-row-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1 1 auto;
  min-width: 0;
}

/* Connection-state globe: the icon carries the state color (green
   connected / red failed / neutral otherwise) — tri-state at a glance. */
.dsh-rw-conn-icon {
  display: inline-flex;
  align-items: center;
  color: var(--dsw-alias-label-secondary, inherit);
}
.dsh-rw-conn-icon[data-state="ready"] {
  color: var(--dsw-alias-state-success-primary);
}
.dsh-rw-conn-icon[data-state="failed"] {
  color: var(--dsw-alias-state-error-primary);
}

.dsh-rw-row-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
}

.dsh-rw-row-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-row-error {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
  word-break: break-word;
}

/* The PathLabel primitive clips from the left; give it room inside the row. */
.dsh-rw-path {
  display: inline-block;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
}

.dsh-rw-row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.dsh-rw-footer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}

.dsh-rw-footer-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* --------------------------------------------------------- remote tree shell

   The ROWS are not styled here: they are the shell's own row components and
   stylesheet (src/client/vendor/workspace-rows, injected with STYLE_TEXT). This
   block only positions the three-level tree inside the region and tints the
   official folder icon on a connection row by its state. */

.dsh-rw-tree {
  display: flex;
  flex-direction: column;
}

/* One indent level per hierarchy step; the vendored row CSS reads this. */
.dsh-rw-conn > div,
.dsh-rw-tree > div > div {
  min-width: 0;
}

/* A connection is not a folder: the official row's leading slot paints a globe
   instead, through the same mask technique this plugin already uses on the
   shell's own rows. Everything else about the row stays official — including
   the hover swap, which hides this slot and shows the chevron. */
.dsh-rw-conn .dsh-rwv-rows-folder svg {
  display: none;
}
.dsh-rw-conn .dsh-rwv-rows-folder::before {
  content: '';
  width: 16px;
  height: 16px;
  flex: none;
  background-color: currentColor;
  -webkit-mask: ${GLOBE_MASK} center / contain no-repeat;
  mask: ${GLOBE_MASK} center / contain no-repeat;
}

/* A connection that is down shows exactly ONE control: its 连接 button.
   The official project row has two action seats (the menu trigger, then the
   plus) and fixed glyphs,
   so the state is expressed by which seats are shown and by an unmistakable
   glyph:
     - the menu trigger is hidden: a menu affordance sitting on a disconnected row
       reads as a menu left open;
     - the plus seat stays visible and paints a plug instead of the new-session
       glyph, so 连接 can never be mistaken for 添加工作区.
   Once connected the strip returns to the official pair, revealed on hover like
   every other row. */
.dsh-rw-conn:not([data-state="ready"]) .dsh-rwv-rows-rowActions {
  display: inline-flex;
}
.dsh-rw-conn:not([data-state="ready"]) .dsh-rwv-rows-rowActions > *:first-child {
  display: none;
}
.dsh-rw-conn:not([data-state="ready"]) .dsh-rwv-rows-rowActions > button:last-child svg {
  display: none;
}
.dsh-rw-conn:not([data-state="ready"]) .dsh-rwv-rows-rowActions > button:last-child::before {
  content: '';
  width: 16px;
  height: 16px;
  flex: none;
  background-color: currentColor;
  -webkit-mask: ${PLUG_MASK} center / contain no-repeat;
  mask: ${PLUG_MASK} center / contain no-repeat;
}

/* While connecting, the connect control itself becomes a spinner. The globe
   stays still: it reports the link state, the button reports the attempt. */
.dsh-rw-conn[data-connect="connecting"] .dsh-rwv-rows-rowActions {
  opacity: 1;
  pointer-events: none;
}

.dsh-rw-conn[data-connect="connecting"] .dsh-rwv-rows-rowActions > button:last-child::before {
  content: '';
  width: 13px;
  height: 13px;
  flex: none;
  background: transparent;
  -webkit-mask: none;
  mask: none;
  border: 1.5px solid var(--dsw-alias-border-l2);
  border-top-color: var(--dsw-alias-label-secondary);
  border-radius: 50%;
  animation: dsh-rw-conn-spin 0.8s linear infinite;
}

/* A disconnected/failed row still needs its ⋮ menu (delete/refresh/mode); the
   connect control stays available beside it. */
.dsh-rw-conn[data-state="stopped"] .dsh-rwv-rows-rowActions > *:first-child,
.dsh-rw-conn[data-state="unknown"] .dsh-rwv-rows-rowActions > *:first-child,
.dsh-rw-conn[data-state="failed"] .dsh-rwv-rows-rowActions > *:first-child {
  display: inline-flex;
}

/* With the menu visible, keep the failure warning left of the whole action
   group rather than on top of the ⋮ button. */
.dsh-rw-conn[data-state="failed"] .dsh-rw-conn-status {
  inset-inline-end: 56px;
}

/* Connection state colours that globe: green connected / red failed /
   neutral otherwise. Only the glyph's colour is ours. */
.dsh-rw-conn[data-state="ready"] .dsh-rwv-rows-folder {
  color: var(--dsw-alias-state-success-primary);
}
.dsh-rw-conn[data-state="failed"] .dsh-rwv-rows-folder {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-rw-conn[data-state="unknown"] .dsh-rwv-rows-folder,
.dsh-rw-conn[data-state="stopped"] .dsh-rwv-rows-folder {
  color: var(--dsw-alias-label-tertiary);
}

/* The connect attempt reports **on its own row**: a spinner while it runs, a
   warning glyph whose tooltip is the reason once it failed. Both ride in the
   free slot immediately left of the 连接 seat (8px row padding + 16px button +
   8px gap = 32px from the row's inline end); nothing is added to the row's
   layout, only one glyph's worth of padding on the title cell so a long label
   cannot run underneath it. */
.dsh-rw-conn {
  position: relative;
}
.dsh-rw-conn-status {
  position: absolute;
  inset-inline-end: 32px;
  top: 50%;
  translate: 0 -50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  z-index: 1;
}
.dsh-rw-conn[data-connect] .dsh-rwv-rows-projectText {
  padding-inline-end: 20px;
}
.dsh-rw-conn-spinner {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 1.5px solid var(--dsw-alias-border-l2);
  border-top-color: var(--dsw-alias-label-secondary);
  animation: dsh-rw-conn-spin 0.8s linear infinite;
}
.dsh-rw-conn-warning {
  display: inline-flex;
  align-items: center;
  color: var(--dsw-alias-state-error-primary);
  cursor: help;
}
/* A spinner already says "wait": the 连接 seat behind it must not invite a
   second click that the pending guard would swallow. */
.dsh-rw-conn[data-connect="connecting"] .dsh-rwv-rows-rowActions {
  opacity: 0.45;
  pointer-events: none;
}
.dsh-rw-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
@keyframes dsh-rw-conn-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-rw-conn-spinner {
    animation-duration: 2.4s;
  }
}

/* The rename dialog's input, matching the shell's dialog input metrics. */
.dsh-rw-rename-input {
  box-sizing: border-box;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-family: inherit;
}
.dsh-rw-rename-input:focus {
  outline: none;
  border-color: var(--dsw-alias-border-l1, var(--dsw-alias-border-l2));
}

/* A11y wrapper around one vendored row: no box, but a real tree item. */
.dsh-rw-row-a11y { display: contents }
.dsh-rw-row-a11y:focus-visible { outline: 2px solid var(--dsh-color-accent, #3b82f6); outline-offset: -2px; border-radius: 6px }
.dsh-rw-tree-empty {
  margin: 4px 8px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

/* --------------------------------------------- add-workspace (browse only) */

/* One tab since P0: the server list is what the tree renders, so the dialog is
   just the directory browser in a scrolling box. The per-row picker styles that
   the old "registered remotely" tab needed are gone with that tab. */
.dsh-rw-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 120px;
  max-height: 52vh;
  overflow: auto;
}

/* ------------------------------------------- sidebar section (远程工作区) */

/* Mounted as the first child of the sidebar's browsing region, directly above
   the shell's own 工作区 section. flex:none keeps this section at its natural
   height while the official list takes the rest of the column. */
.dsh-rw-side-host {
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 46vh;
}

.dsh-rw-side {
  display: flex;
  flex-direction: column;
  gap: 2px;
  /* No horizontal padding: each row owns its own inset (the official row CSS is
     padding-inline-start: calc(8px + var(--dsh-workspace-indent))), so the
     connection level lands flush with the section title instead of one step in. */
  padding: 4px 0 6px;
  /* The whole chain must be height-bounded, or the tree simply overflows the
     host box and the rows below get covered by the shell's 工作区 section
     (measured: host bottom 770px, tree content down to 1141px, the covered
     rows hit-tested onto the shell's rows). */
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

/* Exactly the shell's own section header metrics, measured from the deployed
   WorkspaceBrowser stylesheet (.sectionHeader / .sectionLabel): 36px row,
   a 4px inline start, a 20px line box, and the sidebar's inherited 14px base
   font in the tertiary tone at normal weight. Visually the two section titles
   (远程工作区 / 工作区) have to read as peers — same indent, size and colour. */
.dsh-rw-side-head {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 36px;
  /* 4px matches the shell's section label; 8px on the inline end keeps the row
     controls where the official header's actions sit (its root adds 12px of
     inline-end padding and the header pulls 4px back). */
  padding: 0 8px 0 4px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-rw-side-title {
  flex: 1 1 auto;
  /* Inherit the sidebar's 14px base, exactly like the shell's section label
     (it declares no font-size of its own). */
  font-size: inherit;
  font-weight: 400;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-rw-side-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0.6;
  transition: opacity 120ms ease;
}
.dsh-rw-side:hover .dsh-rw-side-actions,
.dsh-rw-side:focus-within .dsh-rw-side-actions {
  opacity: 1;
}

/* Fixed execution-world chip shown in place of the official agent-preset
   picker while a remote draft is open. It is status, not a mode menu: the
   target is a property of the workspace, and the host guard rejects any
   other preset for the same stub. */
.dsh-rw-remote-preset {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border);
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
}
.dsh-rw-remote-preset-dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--dsw-alias-state-success-primary);
}

/* While the column is collapsed the shell leaves our node in the DOM (its own
   panel unmounts instead) and only fades the region to opacity 0 — which keeps
   every control in the accessibility tree and hit-testable, so the section
   hides itself explicitly. The attribute is on the frame element, an ancestor
   of the region. */
[data-sidebar-collapsed="true"] .dsh-rw-side-host {
  visibility: hidden;
}

/* The section scrolls on its own: the official session list keeps its own
   scroller and must not be pushed out of the column by a long remote list. */
.dsh-rw-side-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.dsh-rw-side-error {
  margin: 2px 8px 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
  word-break: break-word;
}

/* -------------------------------------- v2 native server conversation area */

/* Layout mirrors the official conversation: one full-height column with a
   compact header, a centered reading column and a bottom composer. Colors and
   spacing use the shell's design tokens so it reads as the same product. */
.dsh-rw-session {
  container-type: inline-size;
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  /* Official conversation geometry: 64% of the column, clamped 680-920px. */
  --dsh-conversation-column-width: 100%;
  --dsh-chat-content-width: clamp(680px, calc(var(--dsh-conversation-column-width) * 0.64), 920px);
  --dsh-composer-card-max-width: calc(var(--dsh-chat-content-width) + 32px);
  --dsh-composer-side-clearance: 16px;
  --dsh-composer-dock-inset: 8px;
  --dsh-composer-text-max-height: 336px;
}

.dsh-rw-session-hero { overflow: hidden; }

.dsh-rw-session-hero-center {
  --dsh-chat-content-width: clamp(680px, calc(100cqw * 0.64), 920px);
  --dsh-composer-card-max-width: calc(var(--dsh-chat-content-width) + 32px);
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  width: 100%;
  padding: 24px 0 32px;
  overflow-y: auto;
}

.dsh-rw-session .dsh-rw-session-hero-center > .dsh-rwv-conv-composerStack {
  width: clamp(712px, calc(64cqw + 64px), 952px) !important;
  min-width: 0 !important;
  max-width: 100% !important;
  margin: 0 auto;
  transform: translateX(-3.5px);
}

.dsh-rw-session .dsh-rwv-hero-root {
  padding-left: 0 !important;
  padding-right: 0 !important;
}

.dsh-rw-session .dsh-rwv-official-composer .uV2eYG_root {
  padding-left: 0 !important;
  padding-right: 0 !important;
}

.dsh-rw-session-hero-center .dsh-rwv-conv-heroWorkspaceRow {
  align-items: center;
}

.dsh-rw-session-hero-center button:disabled {
  cursor: default;
  opacity: 0.55;
}


/* Official InputBar slots: the permission and model triggers live in separate
 * CSS modules on the server; mirror their compact official geometry here. */
.dsh-rw-session-dock :where(.wXeviG_trigger, .cl2Rlq_trigger) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}

.dsh-rw-session-dock :where(.wXeviG_trigger, .cl2Rlq_trigger):hover {
  background: var(--dsw-alias-bg-l2);
  color: var(--dsw-alias-label-primary);
}

.dsh-rw-session-dock :where(.wXeviG_triggerIcon, .cl2Rlq_triggerIcon, .wXeviG_chevron, .cl2Rlq_chevron) {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-session-dock .wXeviG_triggerLabel,
.dsh-rw-session-dock .cl2Rlq_triggerLabel {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  color: var(--dsw-alias-label-secondary);
}

.dsh-rw-session-dock .cl2Rlq_triggerLabel > span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.dsh-rw-session-dock .cl2Rlq_triggerEffort {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
}

.dsh-rw-session-dock .cl2Rlq_root,
.dsh-rw-session-dock ._root_4ub78_1 {
  display: inline-flex;
  min-width: 0;
}

.dsh-rw-session-dock .dsh-rwv-input-standardControls {
  gap: 4px;
}
.dsh-rw-session-status {
  display: inline-flex;
  align-items: center;
  padding: 0 4px;
}

.dsh-rw-trace {
  width: min(calc(100% - 48px), 920px);
  margin: 0 auto;
  padding: 18px 0 40px;
}

.dsh-rw-trace-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 12px;
  padding: 9px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
  font-size: 13px;
  line-height: 1.6;
}

.dsh-rw-trace-label {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.dsh-rw-trace-text {
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.dsh-rw-trace-row[data-kind='error'] .dsh-rw-trace-text {
  color: var(--dsw-alias-state-error-primary);
}

.dsh-rw-session-dock {
  --dsh-chat-content-width: clamp(680px, calc(100cqw * 0.64), 920px);
  --dsh-composer-card-max-width: calc(var(--dsh-chat-content-width) + 32px);
  flex: none;
  width: 100%;
  padding: 8px 0 14px;
  background: linear-gradient(to bottom, transparent 0, var(--dsw-alias-bg-base) 14px);
  transform: translateX(-3.5px);
}

.dsh-rw-session-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 46px;
  padding: 0 18px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}

.dsh-rw-session-head-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
}

.dsh-rw-session-head-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
}

.dsh-rw-session-head-route {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}

.dsh-rw-session-head-executor {
  flex: none;
  padding: 1px 8px;
  border-radius: 999px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
}

.dsh-rw-session-head-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}

.dsh-rw-session-head-status[data-status="running"] { color: var(--dsw-alias-state-success-primary); }
.dsh-rw-session-head-status[data-status="error"] { color: var(--dsw-alias-state-error-primary); }
.dsh-rw-session-head-menu-wrap { position: relative; display: inline-flex; }

.dsh-rw-session-head-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  min-width: 168px;
  padding: 4px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md, 10px);
  background: var(--dsw-alias-bg-base);
  box-shadow: var(--dsw-shadow-popover, 0 8px 24px rgba(15, 17, 21, .12));
}

.dsh-rw-session-head-menu button {
  display: flex;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.dsh-rw-session-head-menu button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-rw-session-head-reconnect { color: var(--dsw-alias-state-warning-primary, var(--dsw-alias-label-secondary)); }

.dsh-rw-session-banner {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 12px 0;
  padding: 6px 10px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}

.dsh-rw-session-banner code {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}

.dsh-rw-session-banner-error {
  color: var(--dsw-alias-state-error-primary);
  border: 0.5px solid var(--dsw-alias-state-error-primary);
}

.dsh-rw-session-banner-approval {
  color: var(--dsw-alias-state-warning-primary, var(--dsw-alias-label-primary));
}

.dsh-rw-session-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.dsh-rw-session-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: var(--dsh-chat-content-width);
  max-width: 920px;
  margin: 0 auto;
  padding: 18px 0 24px;
}

.dsh-rw-session-more {
  display: flex;
  justify-content: center;
  padding: 4px 0 10px;
}

.dsh-rw-session-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 64px 16px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
  text-align: center;
}

.dsh-rw-session-empty p { margin: 0; }

.dsh-rw-session-row {
  display: flex;
  width: 100%;
  min-width: 0;
}

.dsh-rw-session-row[data-role="user"] {
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  padding: 10px 0 4px;
}

.dsh-rw-session-user {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  max-width: min(calc(var(--dsh-chat-content-width, 748px) * 0.702), 82%);
  padding: 10px 16px;
  border-radius: var(--dsw-radius-xl, 20px);
  background: var(--dsw-specific-bubble);
  font-size: var(--dsh-content-font-size, 14px);
  line-height: calc(22px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-label-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.dsh-rw-session-user p { margin: 0; }
.dsh-rw-session-user p + p { margin-top: 8px; }

.dsh-rw-session-pending { padding-top: 5px; flex: none; }

.dsh-rw-session-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  opacity: 0;
  transition: opacity 80ms ease;
}

.dsh-rw-session-row:hover .dsh-rw-session-actions,
.dsh-rw-session-row:focus-within .dsh-rw-session-actions { opacity: 1; }

@media (hover: none) {
  .dsh-rw-session-actions { opacity: 1; }
}

.dsh-rw-session-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 6px;
  border: none;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

.dsh-rw-session-action svg { width: 15px; height: 15px; }
.dsh-rw-session-action:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}

.dsh-rw-session-row[data-role="assistant"] { padding: 6px 0; }

.dsh-rw-session-assistant {
  width: 100%;
  min-width: 0;
  font-size: 14px;
  line-height: 22px;
  overflow-wrap: anywhere;
}

.dsh-rw-session-reasoning { width: 100%; }

.dsh-rw-session-reasoning-head {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}

.dsh-rw-session-reasoning-toggle { display: inline-flex; }

.dsh-rw-session-reasoning-body {
  margin: 2px 0 6px 16px;
  padding-left: 10px;
  border-left: 2px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
}

.dsh-rw-session-turn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 8px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  line-height: 14px;
}

.dsh-rw-session-turn[data-phase="start"] { border-top: 0.5px solid var(--dsw-alias-border-l3); margin-top: 10px; }
.dsh-rw-session-turn[data-phase="end"] { margin: 6px 0 8px; }

.dsh-rw-session-running {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0 2px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.dsh-rw-session-error-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-md);
  border: 0.5px solid var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-bg-layer-1);
  font-size: 12px;
  line-height: 18px;
}

.dsh-rw-session-error-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
.dsh-rw-session-error-text code { color: var(--dsw-alias-label-tertiary); font-size: 10px; }

/* Tool cards */
.dsh-rw-session-tool {
  width: 100%;
  margin: 2px 0;
}

/* The official Code/Json/Terminal/Read/Search/Diff blocks draw their own card;
   this shell only supplies the status line, so it must not double the border. */
.dsh-rw-session-tool-body {
  width: 100%;
  margin-top: 2px;
}

.dsh-rw-session-tool-body > * { width: 100%; }

.dsh-rw-session-tool-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
  text-align: left;
  cursor: pointer;
}

.dsh-rw-session-tool-toggle,
.dsh-rw-session-tool-icon { display: inline-flex; flex: none; color: var(--dsw-alias-label-tertiary); }
.dsh-rw-session-tool[data-status="error"] .dsh-rw-session-tool-icon { color: var(--dsw-alias-state-error-primary); }
.dsh-rw-session-tool-kind { flex: none; }
.dsh-rw-session-tool-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); font-size: 11px; }
.dsh-rw-session-tool-status { margin-left: auto; flex: none; color: var(--dsw-alias-label-tertiary); }
.dsh-rw-session-tool-note { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 10px; }

.dsh-rw-session-tool-code {
  margin: 0;
  max-height: 260px;
  overflow: auto;
  padding: 6px 10px 8px;
  border-top: 0.5px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-secondary);
  font-family: var(--dsw-font-family-mono, ui-monospace, monospace);
  font-size: 11px;
  line-height: 16px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* Approval */
.dsh-rw-session-approval {
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-md);
  border: 0.5px solid var(--dsw-alias-state-warning-primary, var(--dsw-alias-border-l3));
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-rw-session-approval[data-status="denied"],
.dsh-rw-session-approval[data-status="expired"] { border-color: var(--dsw-alias-border-l3); }

.dsh-rw-session-approval-head { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; line-height: 18px; }
.dsh-rw-session-approval-icon { display: inline-flex; flex: none; color: var(--dsw-alias-state-warning-primary, var(--dsw-alias-label-secondary)); }
.dsh-rw-session-approval[data-status="allowed"] .dsh-rw-session-approval-icon { color: var(--dsw-alias-state-success-primary); }
.dsh-rw-session-approval-tool { color: var(--dsw-alias-label-primary); font-size: 11px; }
.dsh-rw-session-approval-status { margin-left: auto; flex: none; color: var(--dsw-alias-label-tertiary); font-size: 10px; }
.dsh-rw-session-approval-reason { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dsh-rw-session-approval-actions { display: flex; gap: 6px; padding-top: 8px; }

/* Composer */
.dsh-rw-session-composer {
  flex: none;
  padding: 8px 24px 14px;
  background: var(--dsw-alias-bg-base);
}

.dsh-rw-session-composer-box {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  width: min(100%, 820px);
  margin: 0 auto;
  padding: 8px 8px 8px 12px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-rw-session-composer-box:focus-within { border-color: var(--dsw-alias-border-l4); }
.dsh-rw-session-composer[data-running] .dsh-rw-session-composer-box { border-color: var(--dsw-alias-state-success-primary); }

.dsh-rw-session-composer-input {
  flex: 1 1 auto;
  min-width: 0;
  max-height: 220px;
  padding: 2px 0;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  overflow-y: auto;
}

.dsh-rw-session-composer-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

.dsh-rw-session-composer-attach {
  padding: 2px 4px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary));
  font-size: 11px;
  line-height: 16px;
  cursor: not-allowed;
}

.dsh-rw-session-composer-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  width: min(100%, 820px);
  margin: 4px auto 0;
  color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary));
  font-size: 10px;
  line-height: 14px;
}

.dsh-rw-session-jump {
  position: absolute;
  left: 50%;
  bottom: 132px;
  translate: -50% 0;
  z-index: 2;
  padding: 3px 10px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
  box-shadow: var(--dsw-shadow-sm, 0 2px 8px rgb(0 0 0 / 8%));
}

.dsh-rw-session-error-text {
  width: min(100%, 820px);
  margin: 4px auto 0;
  color: var(--dsw-alias-state-error-primary);
  font-size: 11px;
  line-height: 16px;
}

.dsh-rw-session-hidden-status { display: none; }

.dsh-rw-session-interrupted {
  margin: 4px 0 0;
  color: var(--dsw-alias-state-warning-primary, var(--dsw-alias-label-tertiary));
  font-size: 11px;
  line-height: 16px;
}

.dsh-rw-session-unknown {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
  overflow-wrap: anywhere;
}

.dsh-rw-session-unknown code { color: var(--dsw-alias-label-tertiary); font-size: 10px; }

.dsh-rw-session-plain { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }

/* --------------------------------------------------- v1 remote tree chrome */

.dsh-rw-search-row {
  display: flex;
  align-items: center;
  gap: 2px;
  margin: 2px 8px 4px;
}

.dsh-rw-search {
  box-sizing: border-box;
  flex: 1 1 auto;
  min-width: 0;
  width: auto;
  margin: 0;
  height: 26px;
  padding: 0 8px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 18px;
  outline: none;
}

.dsh-rw-search:focus {
  border-color: var(--dsw-alias-border-l4);
}

.dsh-rw-conn-mode-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin: 0 8px 4px 32px;
  padding: 4px 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}

.dsh-rw-conn-mode-label {
  color: var(--dsw-alias-label-secondary);
}

.dsh-rw-conn-mode-credentials {
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-remote-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 2px 8px 4px 32px;
  padding: 4px 6px;
  border-radius: var(--dsw-radius-sm);
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-1);
  font-size: 11px;
  line-height: 16px;
}

.dsh-rw-banner-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-link);
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
}

.dsh-rw-banner-link:hover {
  text-decoration: underline;
}

.dsh-rw-refresh-row {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: auto;
  margin: 2px 8px 4px 32px;
  border: 0;
  background: transparent;
  cursor: pointer;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}

.dsh-rw-refresh-row:hover {
  color: var(--dsw-alias-label-secondary);
}

/* Workspace drop target (official ProjectRowItem only supplies drag start/end;
   the enclosing group owns hit testing, as in the shell's own browser). */
.dsh-rw-ws-group {
  position: relative;
}

.dsh-rw-ws-group[data-drop-active="before"]::before,
.dsh-rw-ws-group[data-drop-active="after"]::after {
  content: '';
  z-index: 1;
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  border-radius: 1px;
  background: var(--dsw-alias-state-business-primary);
  pointer-events: none;
}

.dsh-rw-ws-group[data-drop-active="before"]::before { top: -1px; }
.dsh-rw-ws-group[data-drop-active="after"]::after { bottom: -1px; }

/* Add-workspace dialog */
.dsh-rw-addworkspace-modal {
  width: min(900px, calc(100vw - 48px)) !important;
  max-width: min(900px, calc(100vw - 48px)) !important;
  height: min(820px, calc(100vh - 48px)) !important;
  max-height: min(820px, calc(100vh - 48px)) !important;
  display: flex;
  flex-direction: column;
}

.dsh-rw-addworkspace-content {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
}

.dsh-rw-addworkspace-content > :last-child {
  min-height: 0;
  flex: 1 1 auto;
  overflow: auto;
}

.dsh-rw-addworkspace-modal > :last-child {
  flex: none;
}

.dsh-rw-mkdir {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dsh-rw-mkdir > input {
  flex: 1 1 auto;
  min-width: 0;
}

.dsh-rw-mkdir > button {
  flex: 0 0 auto;
  white-space: nowrap;
  min-width: max-content;
}

.dsh-rw-addworkspace-modal .dsh-rw-add-workspace {
  min-height: 0;
  overflow: visible;
}

.dsh-rw-add-workspace {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 240px;
}

.dsh-rw-add-path {
  font-family: var(--dsw-font-family-mono, ui-monospace, monospace);
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  word-break: break-all;
}

.dsh-rw-dir-list {
  display: flex;
  flex-direction: column;
  height: min(300px, 34vh);
  flex: none;
  overflow-y: auto;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
}

.dsh-rw-dir-list > .dsh-rw-hint {
  margin: 0;
  padding: 8px 10px;
}

.dsh-rw-dir-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
}

.dsh-rw-dir-row:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-rw-dir-row:disabled {
  color: var(--dsw-alias-label-caption);
  cursor: default;
}

.dsh-rw-dir-name {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-rw-dir-kind {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
}

/* Deployment confirmation strip under an expanded connection. */
.dsh-rw-deploy-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  margin: 0 8px 4px 32px;
  padding: 4px 6px;
  border-radius: var(--dsw-radius-sm);
  border: 0.5px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
}

.dsh-rw-deploy-title {
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-deploy-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* Connection overview cards (the 远程连接 main page) */
.dsh-rw-card-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dsh-rw-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-rw-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.dsh-rw-card-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
}

.dsh-rw-card-phase,
.dsh-rw-card-mode {
  flex: none;
  padding: 1px 8px;
  border-radius: 999px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
}

.dsh-rw-card[data-phase="ready"] .dsh-rw-card-phase {
  color: var(--dsw-alias-state-success-primary);
  border-color: var(--dsw-alias-state-success-primary);
}

.dsh-rw-card[data-phase="failed"] .dsh-rw-card-phase {
  color: var(--dsw-alias-state-error-primary);
  border-color: var(--dsw-alias-state-error-primary);
}

.dsh-rw-card-endpoint {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--dsw-font-family-mono, ui-monospace, monospace);
  font-size: 11px;
  line-height: 16px;
  word-break: break-all;
}

.dsh-rw-card-facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 10px;
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
}

.dsh-rw-card-facts dt {
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-card-facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.dsh-rw-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* Minimal v1 connect dialog */
.dsh-rw-connect-modal {
  width: min(820px, calc(100vw - 48px)) !important;
  max-width: min(820px, calc(100vw - 48px)) !important;
  max-height: min(780px, calc(100vh - 48px)) !important;
}

.dsh-rw-connect-modal .dsh-rw-connect-identity {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-rw-connect-identity-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 12px;
  line-height: 18px;
}

.dsh-rw-connect-identity-item span {
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-connect-identity-wide {
  grid-column: span 2;
}

.dsh-rw-connect-identity-item strong {
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-rw-ssh-alias-row {
  flex-wrap: nowrap;
}

.dsh-rw-ssh-alias-row > select {
  flex: 1 1 auto;
  min-width: 0;
}

.dsh-rw-ssh-alias-row > button {
  flex: 0 0 auto;
}

.dsh-rw-connect-layout {
  display: grid;
  grid-template-columns: 178px minmax(0, 1fr);
  gap: 22px;
  min-height: 420px;
}

.dsh-rw-connect-stepnav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 16px;
  border-right: 0.5px solid var(--dsw-alias-border-l2);
}

.dsh-rw-connect-stepnav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
}

.dsh-rw-connect-stepnav-item:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dsh-rw-connect-stepnav-item[data-active="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}

.dsh-rw-connect-stepnav-item[data-done="true"] {
  color: var(--dsw-alias-label-primary);
}

.dsh-rw-connect-stepnav-item:disabled {
  cursor: default;
  opacity: 0.55;
}

.dsh-rw-connect-stepnav-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: none;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 999px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.dsh-rw-connect-stepnav-item[data-active="true"] .dsh-rw-connect-stepnav-index {
  border-color: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-state-business-primary);
}

.dsh-rw-connect-stepbody {
  min-width: 0;
}

@media (max-width: 720px) {
  .dsh-rw-connect-layout {
    grid-template-columns: 1fr;
    gap: 14px;
    min-height: 0;
  }

  .dsh-rw-connect-stepnav {
    flex-direction: row;
    padding: 0 0 12px;
    border-right: 0;
    border-bottom: 0.5px solid var(--dsw-alias-border-l2);
    overflow: auto;
  }

  .dsh-rw-connect-stepnav-item {
    width: auto;
    flex: none;
  }
}

.dsh-rw-connect-dialog {
  max-height: calc(100vh - 220px);
  overflow: auto;
}

@media (max-width: 720px) {
  .dsh-rw-connect-modal {
    width: calc(100vw - 24px);
    max-width: calc(100vw - 24px);
  }
}

.dsh-rw-connect-dialog {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 260px;
}

.dsh-rw-connect-grid {
  display: grid;
  grid-template-columns: 1.6fr 0.6fr 1fr;
  gap: 8px;
}

/* v3 model source: inside the advanced disclosure, below DSH_HOME. */
.dsh-rw-local-model {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--dsw-alias-border-secondary, rgb(127 127 127 / 18%));
}

/* Source → grouped provider/model checklist (auto discovery). */
.dsh-rw-local-source,
.dsh-rw-local-auto {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dsh-rw-local-models-row {
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.dsh-rw-local-catalog {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.dsh-rw-local-provider {
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-rw-local-provider-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.dsh-rw-local-provider-name {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-rw-local-provider-id {
  min-width: 0;
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-rw-local-provider-count {
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-caption);
  font-variant-numeric: tabular-nums;
}

.dsh-rw-local-provider-actions {
  flex: none;
  gap: 2px;
  margin-left: auto;
}

.dsh-rw-local-model-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 6px;
}

.dsh-rw-local-model-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 2px;
  border-radius: var(--dsw-radius-sm);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.dsh-rw-local-model-option:hover {
  background: var(--dsw-alias-bg-secondary, rgb(127 127 127 / 10%));
}

.dsh-rw-local-model-option input[type='checkbox'] {
  flex: none;
  margin: 0;
  accent-color: var(--dsw-alias-brand-primary, #4d6bfe);
}

.dsh-rw-local-model-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-rw-local-model-id {
  min-width: 0;
  margin-left: auto;
  padding-left: 8px;
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Elapsed time next to the primary connect action while submitting. */
.dsh-rw-connect-elapsed {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

.dsh-rw-connect-hostkey {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dsh-rw-connect-hostkey code {
  padding: 8px 10px;
  overflow-wrap: anywhere;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
}

/* Execution-end dialog */
.dsh-rw-mode-dialog,
.dsh-rw-mode-confirm {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  line-height: 20px;
}

.dsh-rw-mode-actions {
  display: flex;
  gap: 8px;
}

.dsh-rw-mode-confirm ul {
  margin: 0;
  padding-left: 18px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}

/* ------------------------------------------------------ target rail (v3) */

/* The official UI owns navigation while the frame is mounted: yield the
   client shell's sidebar and collapse its grid column so the iframe is the
   whole content area. The floating rail lives outside the grid (body-level
   host) and therefore stays reachable in both states. */
html[data-dsh-rw-portal] [data-slot="sidebar"] {
  display: none !important;
}

html[data-dsh-rw-portal] [data-slot="root"] > div > div {
  grid-template-columns: minmax(0, 1fr) !important;
}

.dsh-rw-rail-host {
  position: fixed;
  left: 10px;
  bottom: 14px;
  z-index: 70;
  display: flex;
  flex-direction: column-reverse;
  align-items: flex-start;
  pointer-events: none;
}

/* While the official full UI owns the screen, the frame's sidebar and its
   account button sit along the left edge: dock the floating rail to the right
   edge (where the official content keeps its margin) so nothing official is
   covered while the rail is collapsed. */
.dsh-rw-rail-host[data-portal="true"] {
  right: 10px;
  left: auto;
  top: 50%;
  bottom: auto;
  transform: translateY(-50%);
  flex-direction: column;
  align-items: flex-end;
}

.dsh-rw-rail {
  pointer-events: auto;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 44px;
  max-height: calc(100vh - 96px);
  padding: 6px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base)) 94%, transparent);
  box-shadow:
    0 8px 24px rgb(0 0 0 / 18%),
    0 0 0 1px var(--dsw-alias-border-secondary, rgb(127 127 127 / 18%));
  backdrop-filter: blur(8px);
  overflow: hidden;
  /* No width transition: the expansion must be an instant, deterministic
     layout (background tabs can freeze animations mid-flight and leave the
     collapsed 44px box with expanded children clipped). */
  transition: none;
}

.dsh-rw-rail[data-expanded="true"],
.dsh-rw-rail:focus-within {
  width: 280px;
}

.dsh-rw-rail-head {
  display: none;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 2px 4px 6px;
}

.dsh-rw-rail[data-expanded="true"] .dsh-rw-rail-head {
  display: flex;
}

.dsh-rw-rail-title {
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-rw-rail-head-actions {
  display: flex;
  flex: none;
  gap: 2px;
}

.dsh-rw-rail-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

.dsh-rw-rail-icon:hover {
  background: var(--dsw-alias-bg-secondary, rgb(127 127 127 / 8%));
  color: var(--dsw-alias-label-primary);
}

.dsh-rw-rail-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.dsh-rw-rail-target,
.dsh-rw-rail-empty {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  min-width: 0;
  border-radius: 10px;
}

.dsh-rw-rail-main,
.dsh-rw-rail-empty {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 4px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.dsh-rw-rail-main:hover,
.dsh-rw-rail-empty:hover {
  background: var(--dsw-alias-bg-secondary, rgb(127 127 127 / 8%));
}

.dsh-rw-rail-glyph {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-secondary, rgb(127 127 127 / 10%));
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
}

.dsh-rw-rail-target[data-active="true"] .dsh-rw-rail-glyph {
  background: var(--dsw-alias-brand-primary, #4d6bfe);
  color: #fff;
}

.dsh-rw-rail-target[data-phase="failed"] .dsh-rw-rail-glyph,
.dsh-rw-rail-target[data-phase="error"] .dsh-rw-rail-glyph {
  box-shadow: inset 0 0 0 1px var(--dsw-alias-state-error, #e5484d);
}

.dsh-rw-rail-label {
  display: none;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}

.dsh-rw-rail[data-expanded="true"] .dsh-rw-rail-label {
  display: flex;
}

.dsh-rw-rail-name {
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-rw-rail-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-rw-rail-actions {
  display: none;
  flex: none;
  gap: 2px;
}

.dsh-rw-rail[data-expanded="true"] .dsh-rw-rail-actions {
  display: flex;
}

.dsh-rw-rail-action {
  padding: 2px 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
}

.dsh-rw-rail-action:hover {
  background: var(--dsw-alias-bg-secondary, rgb(127 127 127 / 8%));
  color: var(--dsw-alias-label-primary);
}

.dsh-rw-rail-status {
  flex: none;
  margin: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  text-align: left;
  cursor: pointer;
}

.dsh-rw-rail-spinner {
  width: 10px;
  height: 10px;
  border: 2px solid currentcolor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: dsh-rw-spin 800ms linear infinite;
}

@keyframes dsh-rw-spin {
  to { transform: rotate(360deg); }
}

/* ------------------------------------------------ server-mode main area */

/* The iframe covers the whole client window: v3 makes the client the remote
   server's UI. The frame layer sits above the client shell (which keeps its
   own state underneath) and below the floating target rail (z-index 70). */
.dsh-rw-portal {
  position: fixed;
  inset: 0;
  z-index: 55;
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
}

.dsh-rw-portal-frame {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-height: 0;
  border: 0;
  background: var(--dsw-alias-bg-base);
}

.dsh-rw-portal-status {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
  pointer-events: none;
}

.dsh-rw-portal-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px;
  text-align: center;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
}

.dsh-rw-portal-error-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 420px;
  font-size: 13px;
  line-height: 20px;
}

.dsh-rw-portal-error-text > span {
  color: var(--dsw-alias-label-tertiary);
  word-break: break-word;
}



/* Official DisclosureRow shell for tool calls: 24px summary, expanded body below. */
.dsh-rw-tool-sep {
  display: inline-block;
  width: 2px;
  height: 2px;
  margin: 0 8px;
  border-radius: 1px;
  background: var(--dsw-alias-label-caption);
  vertical-align: middle;
}

.dsh-rw-tool-summary {
  display: inline-block;
  max-width: min(72ch, 100%);
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));
  text-overflow: ellipsis;
  vertical-align: bottom;
  white-space: nowrap;
}

.dsh-rw-tool-summary-error { color: var(--dsw-alias-state-error-primary); }

.dsh-rw-tool-body {
  padding: 2px 0 6px 22px;
}


/** Composer attachment chips and command/file menus (rc.3 InputBar shell). */
.dsh-rw-composer-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px 0;
}
.dsh-rw-composer-attachment {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  padding: 3px 6px 3px 4px;
  border: 1px solid var(--vscode-widget-border, rgba(127, 127, 127, .25));
  border-radius: 7px;
  background: var(--vscode-editorWidget-background, rgba(127, 127, 127, .08));
  font-size: 12px;
  line-height: 16px;
}
.dsh-rw-composer-attachment img {
  width: 44px;
  height: 44px;
  border-radius: 4px;
  object-fit: cover;
}
.dsh-rw-composer-file-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: rgba(127, 127, 127, .14);
  font-size: 12px;
}
.dsh-rw-composer-attachment-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-rw-composer-attachment button {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: .65;
  font-size: 14px;
  line-height: 14px;
}
.dsh-rw-composer-menu {
  position: absolute;
  z-index: 40;
  display: flex;
  flex-direction: column;
  min-width: 240px;
  max-width: min(440px, 80vw);
  max-height: 280px;
  overflow: auto;
  margin-bottom: 8px;
  padding: 4px;
  border: 1px solid var(--vscode-widget-border, rgba(127, 127, 127, .25));
  border-radius: 8px;
  background: var(--vscode-editorWidget-background, #252526);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .28);
}
.dsh-rw-composer-menu-slash,
.dsh-rw-composer-menu-at {
  left: 10px;
  bottom: calc(100% - 2px);
}
.dsh-rw-composer-menu-permission,
.dsh-rw-composer-menu-model {
  left: 0;
  bottom: calc(100% + 4px);
}
.dsh-rw-composer-menu-model {
  right: 0;
  left: auto;
}
.dsh-rw-composer-menu > button,
.dsh-rw-composer-menu-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.dsh-rw-composer-menu > button:hover,
.dsh-rw-composer-menu-item:hover {
  background: var(--vscode-list-hoverBackground, rgba(127, 127, 127, .14));
}
.dsh-rw-composer-menu-name {
  font-size: 13px;
  line-height: 17px;
}
.dsh-rw-composer-menu-desc {
  color: var(--vscode-descriptionForeground, rgba(127, 127, 127, .9));
  font-size: 11px;
  line-height: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-rw-composer-model-group {
  padding: 2px 0;
}
.dsh-rw-composer-model-provider {
  padding: 6px 8px 2px;
  color: var(--vscode-descriptionForeground, rgba(127, 127, 127, .9));
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .04em;
  line-height: 14px;
}
.dsh-rw-composer-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.dsh-rw-composer-menu-empty {
  padding: 8px 9px;
  color: var(--vscode-descriptionForeground, rgba(127, 127, 127, .9));
  font-size: 11px;
  line-height: 15px;
}
.dsh-rw-session-dock {
  position: relative;
}
.dsh-rw-session-hero-center {
  position: relative;
}

.dsh-rwv-official-composer {
  position: relative;
  width: min(var(--dsh-composer-card-max-width), calc(100% - 16px));
  margin-inline: auto;
}
.dsh-rwv-official-composer [data-composer-card="true"] {
  width: 100%;
  max-width: var(--dsh-composer-card-max-width);
}
.dsh-rwv-official-composer-loading {
  min-height: 92px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--vscode-descriptionForeground, rgba(127, 127, 127, .9));
  font-size: 12px;
}
.dsh-rwv-official-control {
  position: relative;
  display: inline-flex;
  min-width: 0;
}
.dsh-rwv-official-chip-chevron { flex: none; color: var(--dsw-alias-label-caption); }
.dsh-rwv-official-chip-icon,
.dsh-rwv-official-option-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 16px;
  height: 16px;
}
.dsh-rwv-official-option {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dsh-rwv-official-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 220px;
  height: 28px;
  padding: 0 4px 0 8px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  outline: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.dsh-rwv-official-chip:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-rwv-official-chip:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}
.dsh-rwv-official-chip-icon svg { width: 14px; height: 14px; }
.dsh-rwv-official-popover {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 60;
  width: max-content;
  min-width: 200px;
  max-width: min(360px, 80vw);
  padding: 4px;
  border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  border-radius: 10px;
  background: var(--vscode-menu-background, var(--vscode-editorWidget-background, #fff));
  box-shadow: 0 8px 24px rgba(0, 0, 0, .18);
}
.dsh-rwv-official-popover--above {
  bottom: calc(100% + 8px);
}
.dsh-rwv-official-option {
  display: flex;
  width: 100%;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.dsh-rwv-official-option:hover {
  background: color-mix(in srgb, currentColor 8%, transparent);
}
.dsh-rwv-official-option-name {
  font-weight: 500;
  white-space: nowrap;
}
.dsh-rwv-official-option-desc {
  overflow: hidden;
  color: var(--vscode-descriptionForeground, rgba(127, 127, 127, .9));
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-rwv-official-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 4px 0;
}
.dsh-rwv-official-attachment {
  position: relative;
  display: flex;
  max-width: 180px;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, currentColor 4%, transparent);
  color: var(--vscode-descriptionForeground, rgba(127, 127, 127, .9));
  font-size: 11px;
}
.dsh-rwv-official-attachment img {
  width: 34px;
  height: 34px;
  border-radius: 5px;
  object-fit: cover;
}
.dsh-rwv-official-attachment-remove {
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 14px;
  line-height: 14px;
  cursor: pointer;
}
.dsh-rwv-official-attachment-remove:hover {
  background: color-mix(in srgb, currentColor 10%, transparent);
}
/* Official AgentPresetSeat.module.css (rc.3): the preset chip beside the
   workspace picker. The plugin loads the vendored conversation/hero CSS but
   not the agent-preset module, so these upstream class names were falling back
   to the browser's default button chrome (visible border). */
.m0vb0q_menuAnchor {
  min-width: 54px;
  max-width: 100%;
}
.m0vb0q_seat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: min(100%, 240px);
  min-height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.m0vb0q_seat:not(:disabled):hover,
.m0vb0q_seat[aria-expanded='true'] {
  background: var(--dsw-alias-interactive-bg-hover);
}
.m0vb0q_seat:disabled {
  cursor: default;
  color: var(--dsw-alias-label-quaternary);
}
.m0vb0q_seatIcon { flex: none; color: var(--dsw-alias-label-primary); }
.m0vb0q_seatLabel {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.m0vb0q_chevron { flex: none; color: var(--dsw-alias-label-caption); }
${MODEL_SELECT_CSS}
`

/**
 * Inject the stylesheet once per document.
 * @returns a disposer removing exactly the injected tag.
 */
export function ensureStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.querySelector(`style[data-plugin="${STYLE_PLUGIN_ID}"]`)
  if (existing !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = STYLE_PLUGIN_ID
  tag.textContent = STYLE_TEXT
  document.head.appendChild(tag)
  return () => { tag.remove() }
}

/**
 * Marker for the shell workspace-tree rows this plugin owns. The official
 * `ui-workspace` Rows component hard-codes a folder icon per row and keys the
 * row DOM with `data-row-key="workspace:<officialWorkspaceId>"` (its CSS
 * module classes are hashed, but that attribute and the icon-first child
 * order are stable), so the swap is done per-row from the client.
 */
const ICONS_STYLE_ID = 'dsh-remote-workspace-icons'

/**
 * Keep the shell's own 工作区 section free of this plugin's rows.
 *
 * The shell renders an official workspace row for a remote workspace's *stub*
 * directory, and — once a remote session is open — a session row for it as a
 * **sibling inside the same group section**, not as a child of that row:
 *
 *   div._7514NG_groupSection
 *     ├ span > div[data-row-key="workspace:61151f20-…"]   ← the stub workspace
 *     └ span > div[data-row-key="session:session-568dcb0f-…"]  ← the open session
 *
 * So hiding the workspace row alone (the earlier rule) left the session row
 * visible, and the remote session appeared as a top-level entry of 工作区 — the
 * regression this replaces. Two rules now cover both shapes:
 *
 *  - the whole group section that holds a remote stub workspace hides every
 *    session row inside it, so sessions we have not listed yet are covered too;
 *  - plus one rule per known remote session id, for a session the shell renders
 *    outside any group (its 未分组 bucket).
 *
 * Everything else about those rows stays official: they keep their ids, their
 * wiring and their behaviour; only their box is hidden, because this plugin's
 * own section is where a remote workspace and its sessions belong.
 *
 * @param workspaceIds - official shell-workspace ids of this plugin's stubs.
 * @param sessionIds - stored remote session ids this plugin knows about.
 * @returns a disposer removing the injected tag.
 */
export function syncShellHiding(workspaceIds: readonly string[], sessionIds: readonly string[]): () => void {
  if (typeof document === 'undefined') return () => {}
  let tag = document.querySelector<HTMLStyleElement>(`style[data-plugin="${ICONS_STYLE_ID}"]`)
  if (tag === null) {
    // `dataset` is getter-only; mutate it, never Object.assign it — this runs
    // inside the plugin's activation effect, where a throw kills the entry.
    tag = document.createElement('style')
    tag.dataset.plugin = ICONS_STYLE_ID
    document.head.appendChild(tag)
  }
  // Every rule is scoped to the shell's own browsing slot. The vendored rows this
  // plugin renders carry the *same* `data-row-key` attributes, so an unscoped
  // rule would hide the plugin's own tree as well (measured: 43 of 44 rows gone).
  const groups = workspaceIds.map(id => `
[data-slot="sidebar.workspaces"] div[data-row-key="workspace:${id}"] {
  display: none;
}
[data-slot="sidebar.workspaces"] div:has(> span > div[data-row-key="workspace:${id}"]) [data-row-key^="session:"] {
  display: none;
}`).join('\n')
  const sessions = sessionIds.map(id => `
[data-slot="sidebar.workspaces"] div[data-row-key="session:${id}"] {
  display: none;
}`).join('\n')
  tag.textContent = groups + sessions
  return () => { tag.remove() }
}