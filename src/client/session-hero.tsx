/**
 * Empty-session hero, rendered with the official DSH Conversation CSS.
 *
 * The class map is generated from the installed DSH release by
 * `scripts/vendor-official-ui.mjs`; the structure stays the upstream DOM. This
 * file supplies only our values (workspace/preset labels, disabled seats).
 */
import type { ReactElement } from 'react'
import { OfficialSessionComposer as SessionComposer } from './session-composer-official.tsx'
import type { SessionComposerProps } from './session-composer.tsx'
import { CHEVRON_PATHS, FISH_PATHS, FOLDER_PATHS, PRESET_PATHS } from './session-assets.tsx'
import { t } from './locales.ts'
import { conversationCss, heroCss } from './vendor/official-ui/classnames.ts'

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
    <div className={`${conversationCss.composerStack} ${conversationCss.composerHero}`}>
      <div className={heroCss.root}>
        <div className={heroCss.stack}>
          <div className={heroCss.headline}>
            <span className={heroCss.fishHitbox}>
              <div data-slot="conversation.hero.brand.mark" style={{ display: 'contents' }}>
                <svg
                  className={heroCss.fish}
                  width="34"
                  height="25.015544041450777"
                  viewBox="0 0 23.16 17.04"
                  fill="none"
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: FISH_PATHS }}
                />
              </div>
            </span>
            <span className={heroCss.titleGroup}>
              <span>{props.title ?? t('session.hero.title')}</span>
              <span className={heroCss.previewBadge}>{props.previewLabel ?? t('session.hero.preview')}</span>
            </span>
          </div>
          <div className={heroCss.body} />
        </div>
      </div>
      <div className={conversationCss.heroWorkspaceRow}>
        <button
          type="button"
          className={heroCss.workspace}
          aria-label={t('session.hero.workspace')}
          aria-haspopup="menu"
          aria-expanded={false}
        >
          <svg
            width="16"
            height="16"
            className={heroCss.folder}
            viewBox="0 0 16 16"
            fill="none"
            strokeWidth="1"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: FOLDER_PATHS }}
          />
          <span className={heroCss.workspaceLabel}>{workspace}</span>
          <svg
            width="12"
            height="12"
            className={heroCss.chevron}
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
        <div className={conversationCss.heroOptions}>
          <div data-slot="conversation.hero.options" style={{ display: 'contents' }} />
        </div>
      </div>
      <SessionComposer {...props.composer} variant="hero" />
    </div>
  )
}
