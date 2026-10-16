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

/** Marker attribute value for the injected `<style>` element. */
export const STYLE_PLUGIN_ID = 'dsh-remote-workspace'

/** The complete stylesheet. */
export const STYLE_TEXT = `
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

/** A minimal single-color globe (stroke width irrelevant — mask uses alpha). */
const GLOBE_MASK = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
)}")`

/**
 * Swap the folder icon for a globe on every shell-tree row that belongs to a
 * remote workspace. Safe against unknown ids: rules simply never match.
 * @param ids official shell-workspace ids currently registered.
 * @returns a disposer removing the injected tag.
 */
export function syncWorkspaceIcons(ids: readonly string[]): () => void {
  if (typeof document === 'undefined') return () => {}
  let tag = document.querySelector<HTMLStyleElement>(`style[data-plugin="${ICONS_STYLE_ID}"]`)
  if (tag === null) {
    // `dataset` is getter-only; mutate it, never Object.assign it — this runs
    // inside the plugin's activation effect, where a throw kills the entry.
    tag = document.createElement('style')
    tag.dataset.plugin = ICONS_STYLE_ID
    document.head.appendChild(tag)
  }
  tag.textContent = ids.map((id) => `
div[data-row-key="workspace:${id}"] > span:first-child {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
div[data-row-key="workspace:${id}"] > span:first-child svg {
  display: none;
}
div[data-row-key="workspace:${id}"] > span:first-child::before {
  content: '';
  width: 16px;
  height: 16px;
  background-color: currentColor;
  -webkit-mask: ${GLOBE_MASK} center / contain no-repeat;
  mask: ${GLOBE_MASK} center / contain no-repeat;
  flex: none;
}`).join('\n')
  return () => { tag.remove() }
}
