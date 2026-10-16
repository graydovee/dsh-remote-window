/**
 * The four-step remote-connection wizard: choose a method → fill the
 * configuration → watch the live progress stream → pick the remote directory.
 *
 * All state comes from the module store (`./store.ts`), so the wizard and the
 * sidebar-footer button share it without React context across separately
 * registered slot entries.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement, ChangeEvent, KeyboardEvent, ReactNode } from 'react'
import {
  Button, DisclosureRow, IconChevronDownOutlineRegular, IconChevronLeftOutlineRegular,
  IconCheckCircleFillRegular, IconFolderCloseRegular, IconDeliverDocRegular, IconGlobeOutlineRegular,
  IconPlusOutlineRegular, IconRefreshOutlineRegular, IconWarningTriangleOutlineRegular, Input, Menu,
  Pill, SegmentedControl, StateDot, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry, StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AuthKind, ConnectStep, DirEntry, SshAlias } from './api.ts'
import { EmptyState, ErrorBanner, Field, LoadingLine } from './common.tsx'
import { t } from './locales.ts'
import type { AppState, ConnectionMethod, StepState, WizardStep } from './store.ts'
import { CONNECT_STEPS, sortEntries, store, useAppState } from './store.ts'

/** Step order of the wizard. */
const STEP_ORDER: readonly WizardStep[] = ['method', 'config', 'connecting', 'directory']

/** Method cards; only SSH is selectable in v1. */
const METHOD_CARDS: readonly { id: ConnectionMethod; disabled: boolean }[] = [
  { id: 'ssh', disabled: false },
  { id: 'docker', disabled: true },
  { id: 'wsl', disabled: true },
]

/** Localized name/description key per method card. */
const METHOD_NAME_KEYS = {
  ssh: 'method.ssh.name',
  docker: 'method.docker.name',
  wsl: 'method.wsl.name',
} as const

/** Localized description key per method card. */
const METHOD_DESCRIPTION_KEYS = {
  ssh: 'method.ssh.description',
  docker: 'method.docker.description',
  wsl: 'method.wsl.description',
} as const

/** Step label key per wizard step. */
const STEP_LABELS = {
  method: 'step.label.method',
  config: 'step.label.config',
  connecting: 'step.label.connecting',
  directory: 'step.label.directory',
} as const

/** Progress-row label key per server step. */
const CONNECT_STEP_LABELS = {
  connect: 'connect.step.connect',
  runtime: 'connect.step.runtime',
  probe: 'connect.step.probe',
  upload: 'connect.step.upload',
  start: 'connect.step.start',
} as const

/** Status label key per progress status. */
const CONNECT_STATUS_LABELS = {
  pending: 'connect.status.pending',
  running: 'connect.status.running',
  ok: 'connect.status.ok',
  failed: 'connect.status.failed',
} as const

/** State-dot semantic per progress status. */
function dotState(status: StepState['status']): StateDotState {
  switch (status) {
    case 'running': return 'ongoing'
    case 'ok': return 'done'
    case 'failed': return 'error'
    default: return 'idle'
  }
}

/** Short summary of one `~/.ssh/config` alias for the dropdown. */
function aliasLabel(alias: SshAlias): string {
  if (alias.hostName === undefined || alias.hostName === '') return alias.alias
  const user = alias.user !== undefined && alias.user !== '' ? `${alias.user}@` : ''
  const port = alias.port === undefined ? '' : `:${alias.port}`
  return `${alias.alias} — ${user}${alias.hostName}${port}`
}

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

/** Step indicator: one pill per step, earlier steps are jump targets. */
function StepPills(props: { state: AppState }): ReactElement | null {
  const current = STEP_ORDER.indexOf(props.state.step)
  const blocked = props.state.connect.phase === 'running' || props.state.connect.phase === 'awaiting-hostkey'
  return (
    <div className="dsh-rw-steps" role="list" aria-label={t('wizard.steps.aria')}>
      {STEP_ORDER.map((step, index) => (
        <span className="dsh-rw-step-pill" role="listitem" key={step}>
          <Pill
            active={step === props.state.step}
            {...(index < current && !blocked
              ? {
                onClick: () => { store.setStep(step) },
                title: t('step.goBackTo', { label: t(STEP_LABELS[step]) }),
              }
              : {})}
          >
            {`${index + 1}. ${t(STEP_LABELS[step])}`}
          </Pill>
        </span>
      ))}
    </div>
  )
}

/** Step 1 — connection method. */
function MethodStep(props: { state: AppState }): ReactElement | null {
  return (
    <div className="dsh-rw-section">
      <h3 className="dsh-rw-section-title">{t('method.title')}</h3>
      <p className="dsh-rw-hint">{t('method.description')}</p>
      <div className="dsh-rw-methods">
        {METHOD_CARDS.map((card, index) => {
          const selected = props.state.method === card.id
          return (
            <button
              key={card.id}
              type="button"
              className="dsh-rw-method"
              data-disabled={card.disabled ? 'true' : undefined}
              data-selected={selected ? 'true' : undefined}
              disabled={card.disabled}
              aria-pressed={selected}
              aria-label={card.id === 'ssh' ? t('method.ssh.aria') : undefined}
              {...(card.disabled ? {} : { 'data-step-focus': index === 0 ? true : undefined })}
              onClick={() => {
                if (card.disabled) return
                store.setMethod(card.id)
                store.setStep('config')
              }}
            >
              <span className="dsh-rw-method-name">
                {card.id === 'ssh' && <IconGlobeOutlineRegular size={16} />}
                {t(METHOD_NAME_KEYS[card.id])}
                {selected && <Tag tone="info">{t('method.selected')}</Tag>}
              </span>
              <span className="dsh-rw-method-description">{t(METHOD_DESCRIPTION_KEYS[card.id])}</span>
              {card.disabled && <span className="dsh-rw-method-state">{t('method.disabledNote')}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Step 2 — connection configuration. */
function ConfigStep(props: { state: AppState }): ReactElement | null {
  const { config, aliases, aliasesLoading, aliasesLoaded, aliasWarnings, prefilling, pending, secretPending } = props.state
  const [menuOpen, setMenuOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const items: MenuEntry[] = aliases.map(alias => ({ id: alias.alias, label: aliasLabel(alias) }))
  const aliasTrigger = (
    <Button
      variant="outline"
      size="sm"
      disabled={aliasesLoading || items.length === 0}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      icon={<IconChevronDownOutlineRegular size={12} />}
      onClick={() => { setMenuOpen(open => !open) }}
    >
      {t('config.aliasFromSsh')}
    </Button>
  )

  return (
    <div className="dsh-rw-section">
      <div className="dsh-rw-fields">
        <Field label={t('config.alias')} hint={t('config.alias.hint')}>
          <Input
            data-step-focus
            value={config.label}
            placeholder={t('config.alias.placeholder')}
            aria-label={t('config.alias')}
            onChange={(event: ChangeEvent<HTMLInputElement>) => { store.patchConfig({ label: event.target.value }) }}
          />
        </Field>

        <div className="dsh-rw-inline">
          <Menu
            open={menuOpen}
            onClose={() => { setMenuOpen(false) }}
            items={items}
            selectedId={config.sshConfigAlias}
            onSelect={(id) => {
              setMenuOpen(false)
              void store.chooseAlias(id)
            }}
            align="start"
            portal
            anchor={aliasTrigger}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<IconRefreshOutlineRegular size={12} />}
            aria-label={t('common.refresh')}
            disabled={aliasesLoading}
            onClick={() => { void store.loadAliases(true) }}
          />
          <span className="dsh-rw-field-hint">
            {aliasesLoading
              ? t('config.aliasFromSsh.loading')
              : prefilling
                ? t('config.aliasFromSsh.prefilling')
                : aliasesLoaded && aliases.length === 0
                  ? t('config.aliasFromSsh.empty')
                  : ''}
          </span>
        </div>

        {aliasWarnings.length > 0 && (
          <p className="dsh-rw-hint" title={aliasWarnings.join('\n')}>
            {`${t('config.aliasFromSsh.warning', { count: aliasWarnings.length })}: ${aliasWarnings[0] ?? ''}`}
          </p>
        )}

        <div className="dsh-rw-grid">
          <Field label={t('config.host')}>
            <Input
              value={config.host}
              placeholder={t('config.host.placeholder')}
              aria-label={t('config.host')}
              onChange={(event: ChangeEvent<HTMLInputElement>) => { store.patchConfig({ host: event.target.value }) }}
            />
          </Field>
          <Field label={t('config.port')}>
            <Input
              value={config.port}
              inputMode="numeric"
              aria-label={t('config.port')}
              onChange={(event: ChangeEvent<HTMLInputElement>) => { store.patchConfig({ port: event.target.value }) }}
            />
          </Field>
          <Field label={t('config.username')}>
            <Input
              value={config.username}
              aria-label={t('config.username')}
              onChange={(event: ChangeEvent<HTMLInputElement>) => { store.patchConfig({ username: event.target.value }) }}
            />
          </Field>
        </div>

        <Field label={t('config.authKind')}>
          <SegmentedControl<AuthKind>
            id="dsh-rw-auth"
            value={config.authKind}
            disabled={prefilling || pending}
            label={t('config.authKind.label')}
            options={[
              { value: 'password', label: t('config.auth.password') },
              { value: 'privateKey', label: t('config.auth.privateKey') },
              { value: 'agent', label: t('config.auth.agent') },
            ]}
            onChange={(next) => { store.patchConfig({ authKind: next }) }}
          />
        </Field>

        {config.authKind === 'password' && (
          <Field label={t('config.secret.password')} hint={secretPending ? t('config.secret.reEnter') : t('config.secret.neverStored')}>
            <Input
              type="password"
              autoComplete="off"
              value={config.secret}
              aria-label={t('config.secret.password')}
              onChange={(event: ChangeEvent<HTMLInputElement>) => { store.patchConfig({ secret: event.target.value }) }}
            />
          </Field>
        )}

        {config.authKind === 'privateKey' && (
          <>
            <Field label={t('config.secret.privateKeyPath')}>
              <Input
                value={config.privateKeyPath}
                placeholder={t('config.secret.privateKeyPath.placeholder')}
                aria-label={t('config.secret.privateKeyPath')}
                onChange={(event: ChangeEvent<HTMLInputElement>) => { store.patchConfig({ privateKeyPath: event.target.value }) }}
              />
            </Field>
            <Field label={t('config.secret.passphrase')} hint={secretPending ? t('config.secret.reEnter') : t('config.secret.neverStored')}>
              <Input
                type="password"
                autoComplete="off"
                value={config.secret}
                aria-label={t('config.secret.passphrase')}
                onChange={(event: ChangeEvent<HTMLInputElement>) => { store.patchConfig({ secret: event.target.value }) }}
              />
            </Field>
          </>
        )}

        {config.authKind === 'agent' && <p className="dsh-rw-hint">{t('config.secret.agent.note')}</p>}

        <DisclosureRow
          icon={<IconGlobeOutlineRegular size={14} />}
          title={t('config.advanced')}
          open={advancedOpen}
          expandable
          onToggle={() => { setAdvancedOpen(open => !open) }}
          expandOnRowClick
        >
          <div className="dsh-rw-fields">
            <p className="dsh-rw-hint">{t('config.advanced.hint')}</p>
            <div className="dsh-rw-grid">
              <Field label={t('config.nodePath')}>
                <Input
                  value={config.nodePath}
                  aria-label={t('config.nodePath')}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => { store.patchConfig({ nodePath: event.target.value }) }}
                />
              </Field>
              <Field label={t('config.dshCommand')}>
                <Input
                  value={config.dshCommand}
                  aria-label={t('config.dshCommand')}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => { store.patchConfig({ dshCommand: event.target.value }) }}
                />
              </Field>
              <Field
                label={t('config.profile')}
                hint={props.state.defaultProfile === '' ? undefined : t('config.useDefault', { value: props.state.defaultProfile })}
              >
                <Input
                  value={config.profile}
                  aria-label={t('config.profile')}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => { store.patchConfig({ profile: event.target.value }) }}
                />
              </Field>
              <Field label={t('config.dshHome')}>
                <Input
                  value={config.dshHome}
                  aria-label={t('config.dshHome')}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => { store.patchConfig({ dshHome: event.target.value }) }}
                />
              </Field>
            </div>
            <Field label={t('config.packageSource')} hint={t('config.packageSource.hint')}>
              <SegmentedControl<'' | 'download' | 'upload'>
                id="dsh-rw-package-source"
                value={config.packageSource}
                disabled={prefilling || pending}
                label={t('config.packageSource.label')}
                options={[
                  { value: '', label: t('config.packageSource.auto') },
                  { value: 'download', label: t('config.packageSource.download') },
                  { value: 'upload', label: t('config.packageSource.upload') },
                ]}
                onChange={(next) => { store.patchConfig({ packageSource: next }) }}
              />
            </Field>
          </div>
        </DisclosureRow>
      </div>
    </div>
  )
}

/** Step 3 — live progress, the connection log, and host-key confirmation. */
function ConnectingStep(props: { state: AppState }): ReactElement | null {
  const { connect } = props.state
  const prompt = connect.hostKey
  const logRef = useRef<HTMLDivElement>(null)
  // Terminal behaviour: the tail stays in view as lines arrive.
  useEffect(() => {
    const node = logRef.current
    if (node !== null) node.scrollTop = node.scrollHeight
  }, [connect.log.length])
  return (
    <div className="dsh-rw-section">
      <h3 className="dsh-rw-section-title">{t('connect.title')}</h3>
      <p className="dsh-rw-hint">{t('connect.description')}</p>

      <div className="dsh-rw-progress">
        {CONNECT_STEPS.map((step: ConnectStep) => {
          const row = connect.steps[step] ?? { status: 'pending' as const }
          const detail = row.message ?? row.detail
          return (
            <div className="dsh-rw-progress-row" key={step}>
              <span className="dsh-rw-progress-dot">
                <StateDot state={dotState(row.status)} />
              </span>
              <span className="dsh-rw-progress-text">
                <span className="dsh-rw-progress-title">
                  {t(CONNECT_STEP_LABELS[step])}
                  <span className="dsh-rw-progress-status">{t(CONNECT_STATUS_LABELS[row.status])}</span>
                </span>
                {detail !== undefined && detail !== '' && <span className="dsh-rw-progress-message">{detail}</span>}
              </span>
            </div>
          )
        })}
      </div>

      <div className="dsh-rw-log" data-testid="dsh-rw-log">
        <div className="dsh-rw-log-head">
          <span>{t('connect.log.title')}</span>
          <span className="dsh-rw-log-count">{String(connect.log.length)}</span>
        </div>
        <div className="dsh-rw-log-body" ref={logRef}>
          {connect.log.map((line, index) => (
            <div className="dsh-rw-log-line" key={index} data-level={line.level}>
              <span className="dsh-rw-log-time">{line.time}</span>
              <span className="dsh-rw-log-text">{line.text}</span>
            </div>
          ))}
          {connect.log.length === 0 && <div className="dsh-rw-log-line"><span className="dsh-rw-log-text">{t('connect.description')}</span></div>}
        </div>
      </div>

      {prompt !== undefined && (
        <div className="dsh-rw-hostkey">
          <span className="dsh-rw-hostkey-title">
            <IconWarningTriangleOutlineRegular size={14} />
            {t('connect.hostKey.title')}
          </span>
          <p className="dsh-rw-hint">{t('connect.hostKey.description')}</p>
          <div>
            <div className="dsh-rw-field-label">{t('connect.hostKey.fingerprint')}</div>
            <div className="dsh-rw-mono">{prompt.fingerprint}</div>
          </div>
          {prompt.algorithm !== undefined && prompt.algorithm !== '' && (
            <div>
              <div className="dsh-rw-field-label">{t('connect.hostKey.algorithm')}</div>
              <div className="dsh-rw-mono">{prompt.algorithm}</div>
            </div>
          )}
          <div className="dsh-rw-inline">
            <Button
              variant="primary"
              data-step-focus
              disabled={prompt.answering || prompt.trusted}
              onClick={() => { void store.confirmHostKey() }}
            >
              {prompt.trusted
                ? t('connect.hostKey.trusted')
                : prompt.answering ? t('connect.hostKey.trusting') : t('connect.hostKey.trust')}
            </Button>
            <Button variant="ghost" disabled={prompt.answering} onClick={() => { store.cancelConnect() }}>
              {t('connect.hostKey.cancel')}
            </Button>
          </div>
        </div>
      )}

      {connect.phase === 'succeeded' && (
        <p className="dsh-rw-hint">
          <IconCheckCircleFillRegular size={12} />
          {` ${t('connect.succeeded')}`}
        </p>
      )}
      {connect.phase === 'failed' && <p className="dsh-rw-hint">{t('connect.retryHint')}</p>}
      {connect.error !== undefined && <ErrorBanner error={connect.error} />}
    </div>
  )
}

/** Step 4 — remote directory browser. */
function DirectoryStep(props: { state: AppState }): ReactElement | null {
  const { directory } = props.state
  const targetId = directory.targetId
  const listing = directory.listing
  const open = (path: string): void => {
    if (targetId === undefined) return
    void store.loadDirectory(targetId, path)
  }

  if (targetId === undefined) {
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

/** The wizard body: step pills, banners and the current step. */
export function WizardBody(): ReactElement | null {
  const state = useAppState()
  const bodyRef = useRef<HTMLDivElement>(null)
  const fingerprint = state.connect.hostKey?.fingerprint

  // "Focus the first field when a step opens" — also when the host-key panel
  // appears mid-step, so its explicit confirmation button takes the keyboard.
  useEffect(() => {
    const node = bodyRef.current?.querySelector<HTMLElement>('[data-step-focus]')
    node?.focus()
  }, [state.step, state.view, fingerprint])

  return (
    <div className="dsh-rw-stack">
      <StepPills state={state} />
      {state.error !== undefined && <ErrorBanner error={state.error} onDismiss={store.dismissError} />}
      <div className="dsh-rw-scroll" ref={bodyRef}>
        {state.step === 'method' && <MethodStep state={state} />}
        {state.step === 'config' && <ConfigStep state={state} />}
        {state.step === 'connecting' && <ConnectingStep state={state} />}
        {state.step === 'directory' && <DirectoryStep state={state} />}
      </div>
    </div>
  )
}

/** Wizard actions, rendered inside the dialog footer. */
export function WizardFooter(): ReactElement | null {
  const state = useAppState()
  const { pending, connect, directory } = state
  const busy = connect.phase === 'running' || connect.phase === 'awaiting-hostkey'

  if (state.step === 'method') {
    return (
      <div className="dsh-rw-footer-actions">
        <span className="dsh-rw-footer-group">
          <Button variant="ghost" onClick={store.closeOverlay}>{t('common.cancel')}</Button>
        </span>
        <span className="dsh-rw-footer-group">
          <Button variant="primary" disabled={state.method !== 'ssh'} onClick={() => { store.setStep('config') }}>
            {t('step.label.config')}
          </Button>
        </span>
      </div>
    )
  }

  if (state.step === 'config') {
    return (
      <div className="dsh-rw-footer-actions">
        <span className="dsh-rw-footer-group">
          <Button variant="ghost" icon={<IconChevronLeftOutlineRegular size={12} />} onClick={() => { store.setStep('method') }}>
            {t('common.back')}
          </Button>
        </span>
        <span className="dsh-rw-footer-group">
          <Button variant="ghost" onClick={store.closeOverlay}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={pending || state.prefilling} onClick={() => { void store.startConnect() }}>
            {t('config.connect')}
          </Button>
        </span>
      </div>
    )
  }

  if (state.step === 'connecting') {
    return (
      <div className="dsh-rw-footer-actions">
        <span className="dsh-rw-footer-group">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => { if (connect.origin === 'directory') store.showList(); else store.setStep('config') }}
          >
            {t('common.back')}
          </Button>
        </span>
        <span className="dsh-rw-footer-group">
          <Button variant="ghost" disabled={connect.phase === 'succeeded'} onClick={() => { store.cancelConnect() }}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={pending || busy}
            onClick={() => {
              // A reconnect opened from the directory flow must retry that flow,
              // not a wizard connect whose draft may be empty.
              if (connect.origin === 'directory') store.retryDirectoryConnect()
              else void store.startConnect()
            }}
          >
            {t('common.retry')}
          </Button>
        </span>
      </div>
    )
  }

  return (
    <div className="dsh-rw-footer-actions">
      <span className="dsh-rw-footer-group">
        <Button variant="ghost" icon={<IconChevronLeftOutlineRegular size={12} />} onClick={() => { store.showList() }}>
          {t('directory.backToList')}
        </Button>
      </span>
      <span className="dsh-rw-footer-group">
        <Button variant="ghost" onClick={store.closeOverlay}>{t('common.close')}</Button>
        <Button
          variant="primary"
          disabled={pending || directory.loading || directory.listing === undefined}
          onClick={() => { void store.openWorkspace() }}
        >
          {pending ? t('directory.opening') : t('directory.open')}
        </Button>
      </span>
    </div>
  )
}
