/**
 * Plugin-owned stylesheet (v3: target rail, connection dialogs, portal frame).
 *
 * The build pipeline does not process CSS for this plugin, so the browser half
 * ships ONE CSS string injected as a single `<style data-plugin="dsh-remote-window">`
 * element from `apply` — the simplest correct approach under that build, and an
 * effect so hot reload disposes the tag with the rest of the contribution.
 *
 * Colors/spacing come from the shell's `--dsw-*` tokens so the surface follows
 * the active theme.
 */

/** Marker attribute value for the injected `<style>` element. */
export const STYLE_PLUGIN_ID = 'dsh-remote-window'

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
  margin: 0;
  padding: 12px;
  border: 1px dashed var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary);
  text-align: center;
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
@keyframes dsh-rw-conn-spin {
  to {
    transform: rotate(360deg);
  }
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
.dsh-rw-rail-host {
  position: fixed;
  inset: 0;
  z-index: 70;
  pointer-events: none;
}
.dsh-rw-rail {
  position: absolute;
  pointer-events: auto;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 44px;
  max-height: calc(100vh - 20px);
  padding: 6px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base)) 94%, transparent);
  box-shadow:
    0 8px 24px rgb(0 0 0 / 18%),
    0 0 0 1px var(--dsw-alias-border-secondary, rgb(127 127 127 / 18%));
  backdrop-filter: blur(8px);
  overflow: hidden;
  /* Expanding/collapsing animates the box on both axes; the snap transition
     reuses the same curve when the rail is dropped on another edge. */
  transition:
    left 200ms cubic-bezier(0.22, 0.8, 0.26, 1),
    top 200ms cubic-bezier(0.22, 0.8, 0.26, 1),
    right 200ms cubic-bezier(0.22, 0.8, 0.26, 1),
    bottom 200ms cubic-bezier(0.22, 0.8, 0.26, 1),
    width 200ms cubic-bezier(0.22, 0.8, 0.26, 1),
    height 200ms cubic-bezier(0.22, 0.8, 0.26, 1),
    border-radius 200ms ease;
  will-change: left, top, width;
}
.dsh-rw-rail[data-dragging="true"] {
  transition: none;
  cursor: grabbing;
}
.dsh-rw-rail[data-expanded="true"] {
  width: 280px;
}
.dsh-rw-rail[data-dock="top"]:not([data-expanded="true"]),
.dsh-rw-rail[data-dock="bottom"]:not([data-expanded="true"]) {
  flex-direction: row;
  align-items: stretch;
  height: 44px;
  max-height: 44px;
  padding: 6px;
}
.dsh-rw-rail[data-dock="top"]:not([data-expanded="true"]) .dsh-rw-rail-head,
.dsh-rw-rail[data-dock="bottom"]:not([data-expanded="true"]) .dsh-rw-rail-head {
  flex: none;
  padding: 0 6px 0 0;
  align-items: center;
}
.dsh-rw-rail[data-dock="top"]:not([data-expanded="true"]) .dsh-rw-rail-list,
.dsh-rw-rail[data-dock="bottom"]:not([data-expanded="true"]) .dsh-rw-rail-list {
  flex: none;
  flex-direction: row;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
}
.dsh-rw-rail[data-dock="top"]:not([data-expanded="true"]) .dsh-rw-rail-target,
.dsh-rw-rail[data-dock="bottom"]:not([data-expanded="true"]) .dsh-rw-rail-target,
.dsh-rw-rail[data-dock="top"]:not([data-expanded="true"]) .dsh-rw-rail-empty,
.dsh-rw-rail[data-dock="bottom"]:not([data-expanded="true"]) .dsh-rw-rail-empty {
  flex: none;
  max-width: 200px;
}
.dsh-rw-rail[data-dock="top"]:not([data-expanded="true"]) .dsh-rw-rail-target .dsh-rw-rail-main,
.dsh-rw-rail[data-dock="bottom"]:not([data-expanded="true"]) .dsh-rw-rail-target .dsh-rw-rail-main {
  padding: 4px;
  text-align: left;
}
.dsh-rw-rail[data-dock="top"]:not([data-expanded="true"]) .dsh-rw-rail-status,
.dsh-rw-rail[data-dock="bottom"]:not([data-expanded="true"]) .dsh-rw-rail-status {
  flex: none;
  margin: 0 4px;
  white-space: nowrap;
}
.dsh-rw-rail[data-dock="top"][data-expanded="true"],
.dsh-rw-rail[data-dock="bottom"][data-expanded="true"] {
  flex-direction: column;
  height: auto;
  overflow-y: auto;
}
@media (prefers-reduced-motion: reduce) {
  .dsh-rw-rail {
    transition: none;
  }
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
.dsh-rw-rail-toggle,
.dsh-rw-rail-minimized {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  min-width: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  cursor: pointer;
}
.dsh-rw-rail-toggle {
  margin: 2px auto 0;
  color: var(--dsw-alias-label-secondary);
}
.dsh-rw-rail-hover {
  display: contents;
}
.dsh-rw-rail-minimized {
  background: var(--dsw-alias-bg-secondary, rgb(127 127 127 / 10%));
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}
.dsh-rw-rail-toggle:hover,
.dsh-rw-rail-minimized:hover {
  background: var(--dsw-alias-bg-secondary, rgb(127 127 127 / 10%));
  color: var(--dsw-alias-label-primary);
}
.dsh-rw-rail[data-dock="top"]:not([data-expanded="true"]) .dsh-rw-rail-toggle,
.dsh-rw-rail[data-dock="bottom"]:not([data-expanded="true"]) .dsh-rw-rail-toggle {
  margin: 0 0 0 2px;
}
.dsh-rw-rail[data-minimized="true"][data-dock="top"],
.dsh-rw-rail[data-minimized="true"][data-dock="bottom"] {
  width: 44px;
}
.dsh-rw-rail[data-minimized="true"][data-dock="top"] .dsh-rw-rail-list,
.dsh-rw-rail[data-minimized="true"][data-dock="bottom"] .dsh-rw-rail-list {
  overflow: hidden;
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
