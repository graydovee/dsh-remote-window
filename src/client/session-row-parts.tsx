/**
 * The session row's menu entries and hover buttons.
 *
 * These are the shell's own row verbs, rendered with the shell's own labels,
 * icons and row-menu primitives, and wired to the shell's own client services
 * (see `session-verbs.ts`). Only the *data* is ours — the session list of a
 * remote workspace — so a remote session answers to 置顶会话 / 重命名 /
 * 分叉会话 / 归档会话 exactly like a local one.
 */
import type { ReactElement } from 'react'
import {
  IconArchiveOutlineRegular, IconBranchOutlineRegular, IconEditOutlineRegular,
  IconPinFillRegular, IconPinOutlineRegular, IconUnarchiveOutlineRegular,
  MenuItemButton, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteSession, RemoteWorkspace } from './api.ts'
import { store } from './store.ts'
import { sessionVerbs } from './session-verbs.ts'
import { rowsCss } from './vendor/workspace-rows/generated/classnames.ts'
import { rowsTranslate } from './vendor/workspace-rows/translate.ts'

/** Facts one row's verbs need. */
export interface RowVerbProps {
  readonly workspace: RemoteWorkspace
  readonly session: RemoteSession
  readonly title: string
  readonly pinned: boolean
  readonly archived: boolean
}

/**
 * The `⋮` menu entries of one session row, in the shell's order.
 * @param props.close - the row's menu setter; every entry dismisses the menu
 *   before acting, exactly like the shell's own entries do.
 */
export function SessionMenu(props: RowVerbProps & { close: () => void }): ReactElement | null {
  const { session, title, pinned, archived } = props
  const t = rowsTranslate
  const act = (run: () => void): void => { props.close(); run() }
  return (
    <>
      {/* Pin is meaningless on an archived row (the two are mutually exclusive
          on the host), so it is absent there — the shell hides it the same way. */}
      {!archived && (
        <MenuItemButton
          icon={pinned ? <IconPinFillRegular /> : <IconPinOutlineRegular />}
          onSelect={() => { act(() => { void sessionVerbs.setPin(props.workspace, session.id, !pinned, t(pinned ? 'menu.unpinSession' : 'menu.pinSession')) }) }}
        >
          {t(pinned ? 'menu.unpinSession' : 'menu.pinSession')}
        </MenuItemButton>
      )}
      <MenuItemButton
        icon={<IconEditOutlineRegular />}
        onSelect={() => { act(() => { store.requestRename(props.workspace, { ...session, title }) }) }}
      >
        {t('rename')}
      </MenuItemButton>
      <MenuItemButton
        icon={<IconBranchOutlineRegular />}
        onSelect={() => { act(() => { void sessionVerbs.forkSession(props.workspace, session.id, t('menu.fork')) }) }}
      >
        {t('menu.fork')}
      </MenuItemButton>
      <MenuItemButton
        danger={!archived}
        icon={archived ? <IconUnarchiveOutlineRegular /> : <IconArchiveOutlineRegular />}
        onSelect={() => {
          act(() => {
            void sessionVerbs.setArchived(props.workspace, session.id, !archived, t(archived ? 'menu.unarchiveSession' : 'menu.archiveSession'))
          })
        }}
      >
        {t(archived ? 'menu.unarchiveSession' : 'menu.archiveSession')}
      </MenuItemButton>
    </>
  )
}

/** The hover buttons at one session row's right edge (archive, then pin). */
export function SessionRowActions(props: RowVerbProps): ReactElement | null {
  const { session, pinned, archived } = props
  const t = rowsTranslate
  return (
    <>
      <Tooltip label={t(archived ? 'actions.unarchive' : 'actions.archive')} side="bottom" align="end" delayMs={500}>
        <button
          type="button"
          className={rowsCss.iconButton}
          aria-label={t(archived ? 'actions.unarchive' : 'actions.archive')}
          onClick={(event: { stopPropagation(): void }) => {
            event.stopPropagation()
            void sessionVerbs.setArchived(props.workspace, session.id, !archived, t(archived ? 'actions.unarchive' : 'actions.archive'))
          }}
        >
          {archived ? <IconUnarchiveOutlineRegular size={14} /> : <IconArchiveOutlineRegular size={14} />}
        </button>
      </Tooltip>
      {!archived && (
        <Tooltip label={t(pinned ? 'actions.unpin' : 'actions.pin')} side="bottom" align="end" delayMs={500}>
          <button
            type="button"
            className={rowsCss.iconButton}
            aria-label={t(pinned ? 'actions.unpin' : 'actions.pin')}
            onClick={(event: { stopPropagation(): void }) => {
              event.stopPropagation()
              void sessionVerbs.setPin(props.workspace, session.id, !pinned, t(pinned ? 'actions.unpin' : 'actions.pin'))
            }}
          >
            {pinned ? <IconPinFillRegular size={14} /> : <IconPinOutlineRegular size={14} />}
          </button>
        </Tooltip>
      )}
    </>
  )
}
