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

export const STYLE_TEXT = `
/* The official workspace rows bring their own stylesheet; it is injected with
   ours so both surfaces (sidebar section and panel) share one <style> tag. */
${ROW_STYLES}

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

.dsh-rw-progress-message {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  word-break: break-word;
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

/* ----------------------------------------------------- add-workspace list */

.dsh-rw-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 120px;
  max-height: 52vh;
  overflow: auto;
}

.dsh-rw-picker-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dsh-rw-picker-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-rw-picker-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
}

.dsh-rw-picker-title {
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
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

/* Mirrors the shell's own section header metrics so the two sections read as
   peers: same row height, same label weight, same secondary tone. */
.dsh-rw-side-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  /* Matches the rows' own inset, so the title lines up with the connection glyph. */
  padding: 0 8px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-rw-side-title {
  flex: 1 1 auto;
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
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
