/**
 * The remote directory browser — the body of the 添加工作区 dialog's default tab.
 *
 * Moved verbatim out of the wizard's step 4: browsing a remote directory is a
 * *workspace* action (a connection row's 添加工作区), not a step of connecting.
 * There is exactly one copy of this UI — the wizard no longer renders a
 * directory step at all.
 *
 * All of its state is the store's `directory` slice (`store.loadDirectory` …),
 * so this file owns nothing but presentation: breadcrumbs, parent/home/refresh,
 * a path jump, the entry list, 新建目录, and the workspace title field.
 */
import type { ChangeEvent, KeyboardEvent, ReactElement } from 'react'
import {
  Button, IconChevronLeftOutlineRegular, IconDeliverDocRegular, IconFolderCloseRegular,
  IconPlusOutlineRegular, IconRefreshOutlineRegular, Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DirEntry } from './api.ts'
import { EmptyState, ErrorBanner, Field, LoadingLine } from './common.tsx'
import { t } from './locales.ts'
import { sortEntries, store, useAppState } from './store.ts'

/** Breadcrumb segments (each with its absolute path) for one remote path. */
function crumbs(path: string): Array<{ label: string; path: string }> {
  const root = { label: t('directory.root'), path: '/' }
  if (path === '' || path === '/') return [root]
  const segments: Array<{ label: string; path: string }> = [root]
  let cumulative = ''
  for (const part of path.split('/')) {
    if (part === '') continue
    cumulative += `/${part}`
    segments.push({ label: part, path: cumulative })
  }
  return segments
}

/** Row for one remote directory entry. */
function EntryRow(props: { entry: DirEntry; onOpen: (entry: DirEntry) => void }): ReactElement | null {
  const isDirectory = props.entry.type === 'directory'
  return (
    <button
      type="button"
      className="dsh-rw-entry"
      data-type={props.entry.type}
      disabled={!isDirectory}
      onClick={() => { if (isDirectory) props.onOpen(props.entry) }}
      title={props.entry.path}
    >
      {isDirectory ? <IconFolderCloseRegular size={14} /> : <IconDeliverDocRegular size={14} />}
      <span className="dsh-rw-entry-name">{props.entry.name}</span>
      <span className="dsh-rw-entry-kind">
        {isDirectory ? t('common.directory') : props.entry.type === 'file' ? t('common.file') : props.entry.type}
      </span>
    </button>
  )
}

/**
 * The browser itself.
 *
 * Rendered while the dialog is open. The host re-establishes the channel on the
 * first `list-dir` of a cold target, so both loading states matter: `connecting`
 * is the multi-second channel build (opened by `store.openBrowseDirectory`) and
 * `loading` a plain read.
 */
export function DirectoryPicker(): ReactElement | null {
  const state = useAppState()
  const { directory } = state
  const targetId = directory.targetId
  const listing = directory.listing
  const open = (path: string): void => {
    if (targetId === undefined) return
    void store.loadDirectory(targetId, path)
  }

  // `directory.open` is the dialog-lifetime flag that replaced the wizard's
  // `step: 'directory'`: a listing that outlived its dialog must never render.
  if (!directory.open || targetId === undefined) {
    return (
      <div className="dsh-rw-section">
        <EmptyState text={t('directory.noTarget')} />
      </div>
    )
  }

  return (
    <div className="dsh-rw-section">
      <div className="dsh-rw-inline">
        <Button
          variant="ghost"
          size="sm"
          icon={<IconChevronLeftOutlineRegular size={12} />}
          disabled={listing?.parent === undefined || directory.loading}
          onClick={() => { if (listing?.parent !== undefined) open(listing.parent) }}
        >
          {t('directory.parent')}
        </Button>
        {listing !== undefined && listing.home !== '' && (
          <Button variant="ghost" size="sm" disabled={directory.loading} onClick={() => { open(listing.home) }}>
            {t('directory.home')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon={<IconRefreshOutlineRegular size={12} />}
          aria-label={t('common.refresh')}
          disabled={directory.loading}
          onClick={() => { open(listing?.path ?? '') }}
        />
        <Input
          className="dsh-rw-grow"
          data-step-focus
          value={directory.pathInput}
          aria-label={t('directory.crumbs.aria')}
          placeholder={t('directory.path.placeholder')}
          onChange={(event: ChangeEvent<HTMLInputElement>) => { store.setPathInput(event.target.value) }}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            open(event.currentTarget.value.trim())
          }}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={directory.loading}
          onClick={() => { open(directory.pathInput.trim()) }}
        >
          {t('directory.path.goto')}
        </Button>
      </div>

      {listing !== undefined && (
        <nav className="dsh-rw-crumbs" aria-label={t('directory.crumbs.aria')}>
          {crumbs(listing.path).map((crumb, index) => (
            <span key={crumb.path}>
              {index > 0 && <span className="dsh-rw-crumb-separator">/</span>}
              <button
                type="button"
                className="dsh-rw-crumb"
                aria-current={crumb.path === listing.path ? 'true' : undefined}
                disabled={directory.loading}
                onClick={() => { open(crumb.path) }}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>
      )}

      {directory.connecting && <LoadingLine text={t('directory.connecting')} />}
      {directory.loading && !directory.connecting && <LoadingLine text={t('directory.loading')} />}
      {listing !== undefined && !directory.loading && (
        listing.entries.length === 0
          ? <EmptyState text={t('directory.empty')} />
          : (
            <div className="dsh-rw-entries">
              {sortEntries(listing.entries).map(entry => (
                <EntryRow key={entry.path} entry={entry} onOpen={() => { open(entry.path) }} />
              ))}
            </div>
          )
      )}

      <div className="dsh-rw-inline">
        <Input
          className="dsh-rw-grow"
          value={directory.newDirName}
          aria-label={t('directory.newDir')}
          placeholder={t('directory.newDir.placeholder')}
          onChange={(event: ChangeEvent<HTMLInputElement>) => { store.setNewDirName(event.target.value) }}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            void store.createDirectory()
          }}
        />
        <Button
          variant="outline"
          size="sm"
          icon={<IconPlusOutlineRegular size={12} />}
          disabled={directory.creating || directory.newDirName.trim() === ''}
          onClick={() => { void store.createDirectory() }}
        >
          {t('directory.newDir.create')}
        </Button>
      </div>

      <Field label={t('directory.titleField')} hint={t('directory.titleField.placeholder')}>
        <Input
          value={directory.title}
          aria-label={t('directory.titleField')}
          onChange={(event: ChangeEvent<HTMLInputElement>) => { store.setDirectoryTitle(event.target.value) }}
        />
      </Field>

      {directory.error !== undefined && <ErrorBanner error={directory.error} />}
    </div>
  )
}
