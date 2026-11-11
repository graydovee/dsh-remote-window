/**
 * Plugin-owned stylesheet (v3: connection panel, dialogs, portal frame).
 *
 * The build pipeline does not process CSS for this plugin, so the browser half
 * ships ONE CSS string injected as a single `<style data-plugin="dsh-remote-workspace">`
 * element from `apply` — the simplest correct approach under that build, and an
 * effect so hot reload disposes the tag with the rest of the contribution.
 *
 * Colors/spacing come from the shell's `--dsw-*` tokens so the surface follows
 * the active theme.
 */

/** Marker attribute value for the injected `<style>` element. */
export const STYLE_PLUGIN_ID = 'dsh-remote-workspace'

/** The complete stylesheet. */
export const STYLE_TEXT = `
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
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: 32px 16px;
  border: 1px dashed var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-lg);
  background: transparent;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-secondary);
  text-align: center;
  cursor: pointer;
}
.dsh-rw-empty:hover {
  background: var(--dsw-alias-bg-secondary, rgb(127 127 127 / 6%));
}
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
.dsh-rw-fields {
  display: flex;
  flex-direction: column;
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
.dsh-rw-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  word-break: break-all;
}
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
/* The probe row reports several observations: one line each, no joined sentence. */
.dsh-rw-progress-lines {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  word-break: break-word;
}
.dsh-rw-progress-line {
  display: block;
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
.dsh-rw-side-error {
  margin: 2px 8px 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
  word-break: break-word;
}
.dsh-rw-dir-list > .dsh-rw-hint {
  margin: 0;
  padding: 8px 10px;
}
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
/* Reconnect mode: no wizard navigation, just the attempt's progress. */
.dsh-rw-connect-layout[data-reconnect="true"] {
  grid-template-columns: minmax(0, 1fr);
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
.dsh-rw-local-model {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--dsw-alias-border-secondary, rgb(127 127 127 / 18%));
}
.dsh-rw-local-source,
.dsh-rw-local-auto {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dsh-rw-connect-elapsed {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}
html[data-dsh-rw-portal] [data-slot="sidebar"] {
  display: none !important;
}
html[data-dsh-rw-portal] [data-slot="root"] > div > div {
  grid-template-columns: minmax(0, 1fr) !important;
}
.dsh-rw-chrome {
  position: relative;
  z-index: 60;
}
/* Page skeleton mirrors the shell's own pages: 48px gutters, an 80px header
   bar with the 960px content column, and the body as the only scroller. */
.dsh-rw-page {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0 48px;
}
.dsh-rw-page-head {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  max-width: 960px;
  padding: 28px 0 20px;
}
.dsh-rw-page-heading {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.dsh-rw-page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 500;
  line-height: 28px;
  color: var(--dsw-alias-label-primary);
}
.dsh-rw-page-intro {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-rw-page-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  padding-top: 2px;
}
.dsh-rw-page-body {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1 1 auto;
  align-self: stretch;
  min-height: 0;
  overflow-y: auto;
  margin: 0 -48px;
  padding: 0 48px 48px;
}
.dsh-rw-page-body > * {
  width: 100%;
  max-width: 960px;
  margin-right: auto;
  margin-left: auto;
}
.dsh-rw-empty-title {
  display: block;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
}
.dsh-rw-empty .dsh-rw-hint {
  display: block;
  margin-top: 6px;
}
.dsh-rw-conn-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
  list-style: none;
}
.dsh-rw-conn-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 14px 16px;
}
.dsh-rw-conn-row + .dsh-rw-conn-row {
  border-top: 0.5px solid var(--dsw-alias-border-l1);
}
.dsh-rw-conn-row:hover {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-secondary));
}
.dsh-rw-conn-row[data-active="true"] {
  background: var(--dsw-alias-bg-secondary);
}
.dsh-rw-conn-badge {
  flex: none;
  padding: 1px 8px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-rw-conn-open {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dsh-rw-conn-dot {
  display: flex;
  flex: none;
  align-items: center;
}
.dsh-rw-conn-label {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}
.dsh-rw-conn-name {
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-rw-conn-meta {
  display: flex;
  gap: 4px;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-rw-conn-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
}
.dsh-rw-conn-row[data-phase="failed"] .dsh-rw-conn-name {
  color: var(--dsw-alias-state-error-primary);
}
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
