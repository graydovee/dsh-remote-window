/**
 * Empty-session hero, copied from the official 0.2.1-rc.2 DOM.
 *
 * Classes (`ST7X_W_`, `bocITq_`, `m0vb0q_`) are the shell's real hashed CSS
 * module names from that build; the shell stylesheet paints them globally, so
 * this file supplies only the official structure and our values. The composer
 * below reuses the same official `yhfFVG_` markup.
 */
import type { ReactElement } from 'react'
import { SessionComposer } from './session-composer.tsx'
import type { SessionComposerProps } from './session-composer.tsx'
import { CHEVRON_PATHS, FISH_PATHS, FOLDER_PATHS, PRESET_PATHS } from './session-assets.tsx'
import { t } from './locales.ts'

/** Props for the official empty-session hero. */
export interface SessionHeroProps {
  /** Official composer (hero variant); functionality is owned by NativeSessionMain. */
  readonly composer: SessionComposerProps
  /** Workspace title shown in the official workspace chip. */
  readonly workspaceLabel?: string | undefined
  /** Agent preset label shown in the official preset seat. */
  readonly presetLabel?: string | undefined
  /** Headline overrides, when a locale needs them. */
  readonly title?: string | undefined
  readonly previewLabel?: string | undefined
}

/** Official empty-session hero + composer. */
export function SessionHero(props: SessionHeroProps): ReactElement {
  const workspace = props.workspaceLabel ?? t('session.hero.workspace')
  const preset = props.presetLabel ?? t('session.hero.preset')
  return (
    <div className="ST7X_W_composerStack ST7X_W_composerHero">
      <div className="bocITq_root">
        <div className="bocITq_stack">
          <div className="bocITq_headline">
            <span className="bocITq_fishHitbox">
              <div data-slot="conversation.hero.brand.mark" style={{ display: 'contents' }}>
                <svg
                  className="bocITq_fish"
                  width="34"
                  height="25.015544041450777"
                  viewBox="0 0 23.16 17.04"
                  fill="none"
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: FISH_PATHS }}
                />
              </div>
            </span>
            <span className="bocITq_titleGroup">
              <span>{props.title ?? t('session.hero.title')}</span>
              <span className="bocITq_previewBadge">{props.previewLabel ?? t('session.hero.preview')}</span>
            </span>
          </div>
          <div className="bocITq_body" />
        </div>
      </div>
      <div className="ST7X_W_heroWorkspaceRow">
        <button
          type="button"
          className="bocITq_workspace"
          aria-label={t('session.hero.workspace')}
          aria-haspopup="menu"
          aria-expanded={false}
          aria-disabled={true}
          disabled
          title={t('session.hero.unsupported')}
        >
          <svg
            width="16"
            height="16"
            className="bocITq_folder"
            viewBox="0 0 16 16"
            fill="none"
            strokeWidth="1"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: FOLDER_PATHS }}
          />
          <span className="bocITq_workspaceLabel">{workspace}</span>
          <svg
            width="12"
            height="12"
            className="bocITq_chevron"
            viewBox="0 0 16 16"
            fill="none"
            strokeWidth="1"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: CHEVRON_PATHS }}
          />
        </button>
        <div data-slot="conversation.hero.workspace" style={{ display: 'contents' }}>
          <span className="_root_4ub78_1" />
          <div data-slot="conversation.hero.workspace.directoryFlow" style={{ display: 'contents' }} />
        </div>
        <div data-slot="conversation.hero.agentPreset" style={{ display: 'contents' }}>
          <span className="_root_4ub78_1 m0vb0q_menuAnchor">
            <button
              type="button"
              className="m0vb0q_seat"
              aria-haspopup="menu"
              aria-expanded={false}
              aria-disabled={true}
              disabled
              title={t('session.hero.unsupported')}
            >
              <svg
                width="16"
                height="16"
                className="m0vb0q_seatIcon"
                viewBox="0 0 16 16"
                fill="none"
                strokeWidth="1"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: PRESET_PATHS }}
              />
              <span className="m0vb0q_seatLabel">{preset}</span>
              <svg
                width="14"
                height="14"
                className="m0vb0q_chevron"
                viewBox="0 0 16 16"
                fill="none"
                strokeWidth="1"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: CHEVRON_PATHS }}
              />
            </button>
          </span>
        </div>
        <div className="ST7X_W_heroOptions">
          <div data-slot="conversation.hero.options" style={{ display: 'contents' }} />
        </div>
      </div>
      <SessionComposer {...props.composer} variant="hero" />
    </div>
  )
}
