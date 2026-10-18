/**
 * The **three**-step remote-connection wizard:
 *   ① choose a method → ② fill the configuration → ③ choose how the remote side
 *   is provisioned, connect, and watch it happen.
 *
 * Step 3 is deliberately one surface: the connection-method cards (reuse the
 * machine's dsh / upload the server package / download remotely-disabled), the
 * scan results that back the first two, the five progress rows, the live log and
 * the host-key confirmation all belong to the same decision. The remote-directory
 * browser that used to be step 4 is now the default tab of the 添加工作区 dialog
 * (`directory-picker.tsx`) — browsing a directory is a workspace action, not a
 * step of connecting.
 *
 * All state comes from the module store (`./store.ts`), so the wizard and the
 * sidebar-footer button share it without React context across separately
 * registered slot entries.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement, ChangeEvent } from 'react'
import {
  Button, DisclosureRow, IconChevronDownOutlineRegular, IconChevronLeftOutlineRegular,
  IconGlobeOutlineRegular, IconRefreshOutlineRegular, IconWarningTriangleOutlineRegular, Input, Menu,
  Pill, SegmentedControl, StateDot, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry, StateDotState, TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AuthKind, ConnectionMode, ConnectStep, DshCandidate, SshAlias, WslDistro } from './api.ts'
import { EmptyState, ErrorBanner, Field, LoadingLine } from './common.tsx'
import { t } from './locales.ts'
import { offeredMethods } from './method-cards.ts'
import type { AppState, StepState, WizardStep } from './store.ts'
import { CONNECT_STEPS, store, useAppState } from './store.ts'
import { methodAvailable } from '../targets/methods.ts'

/** Step order of the wizard. */
const STEP_ORDER: readonly WizardStep[] = ['method', 'config', 'connect']

/**
 * Method cards, in display order.
 *
 * The list itself lives in `method-cards.ts` (pure, unit-tested): step 1 offers
 * ssh everywhere and wsl on a Windows host, and a card is *rendered* only when
 * `methodAvailable` — the predicate the host validates too — says the platform
 * can host it, so off Windows the WSL card does not exist at all (not greyed
 * out — absent).
 */

/** Localized name/description key per method card. */
const METHOD_NAME_KEYS = {
  ssh: 'method.ssh.name',
  wsl: 'method.wsl.name',
} as const

/** Localized description key per method card. */
const METHOD_DESCRIPTION_KEYS = {
  ssh: 'method.ssh.description',
  wsl: 'method.wsl.description',
} as const

/**
 * Step 3's three cards.
 *
 * `download` is rendered but never selectable: it would fetch a released server
 * package, and there is no release yet (its copy says exactly that). Only the
 * *card* is unavailable — `assets.downloadServerPackage` still serves the
 * `auto` policy of pre-existing targets.
 */
const MODE_CARDS: readonly { id: ConnectionMode; disabled?: boolean }[] = [
  { id: 'reuse' },
  { id: 'upload' },
  { id: 'download', disabled: true },
]

/** Localized name/description key per connection-method card. */
const MODE_NAME_KEYS = {
  reuse: 'connect.mode.reuse.name',
  upload: 'connect.mode.upload.name',
  download: 'connect.mode.download.name',
} as const

/** Localized description key per connection-method card. */
const MODE_DESCRIPTION_KEYS = {
  reuse: 'connect.mode.reuse.description',
  upload: 'connect.mode.upload.description',
  download: 'connect.mode.download.description',
} as const

/** Step label key per wizard step. */
const STEP_LABELS = {
  method: 'step.label.method',
  config: 'step.label.config',
  connect: 'step.label.connect',
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

/** Human-readable package size for the "already cached" line. */
function formatSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes <= 0) return '—'
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
  // A method the host cannot support is not rendered at all: the WSL card is
  // absent off Windows (`offeredMethods` asks the same `methodAvailable` the
  // host validates `connect/start` with).
  const cards = offeredMethods(props.state.platform)
  return (
    <div className="dsh-rw-section">
      <h3 className="dsh-rw-section-title">{t('method.title')}</h3>
      <p className="dsh-rw-hint">{t('method.description')}</p>
      <div className="dsh-rw-methods">
        {cards.map((method, index) => {
          const selected = props.state.method === method
          return (
            <button
              key={method}
              type="button"
              className="dsh-rw-method"
              data-selected={selected ? 'true' : undefined}
              aria-pressed={selected}
              aria-label={method === 'ssh' ? t('method.ssh.aria') : t('method.wsl.aria')}
              {...(index === 0 ? { 'data-step-focus': true } : {})}
              onClick={() => {
                store.setMethod(method)
                store.setStep('config')
              }}
            >
              <span className="dsh-rw-method-name">
                {method === 'ssh' && <IconGlobeOutlineRegular size={16} />}
                {t(METHOD_NAME_KEYS[method])}
                {selected && <Tag tone="info">{t('method.selected')}</Tag>}
              </span>
              <span className="dsh-rw-method-description">{t(METHOD_DESCRIPTION_KEYS[method])}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Known `wsl.exe` states rendered in the user's language; anything else verbatim. */
function wslStateLabel(state: string | undefined): string | undefined {
  if (state === undefined) return undefined
  const lowered = state.toLowerCase()
  if (lowered.startsWith('running')) return t('wsl.state.running')
  if (lowered.startsWith('stopped')) return t('wsl.state.stopped')
  if (lowered.startsWith('installing')) return t('wsl.state.installing')
  return state
}

/**
 * The WSL fields of step 2: distribution detection, selection and the optional
 * distro user.
 *
 * Detection runs when the step is entered (`store.loadWslDistros`); this
 * component only renders the outcome and lets the user re-run it. When nothing
 * is detected the distribution is still typeable, so a WSL install that the
 * probe cannot enumerate (or a distro the user knows by name) is not a dead end.
 */
function WslConfigFields(props: { state: AppState }): ReactElement {
  const { config, wslProbe, pending } = props.state
  const [menuOpen, setMenuOpen] = useState(false)
  const hasList = wslProbe.distros.length > 0
  const selected = wslProbe.distros.find(distro => distro.name === config.wslDistro)
  const items: MenuEntry[] = wslProbe.distros.map((distro: WslDistro) => ({
    id: distro.name,
    label: [distro.name, wslStateLabel(distro.state), distro.default ? t('wsl.default') : undefined]
      .filter((part): part is string => part !== undefined && part !== '')
      .join(' · '),
  }))
  const trigger = (
    <Button
      variant="outline"
      size="sm"
      disabled={pending || wslProbe.status === 'loading'}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      aria-label={t('config.wslDistro')}
      icon={<IconChevronDownOutlineRegular size={12} />}
      onClick={() => { setMenuOpen(open => !open) }}
    >
      {selected === undefined
        ? (config.wslDistro === '' ? t('config.wslDistro.pick') : config.wslDistro)
        : [selected.name, wslStateLabel(selected.state)].filter((part): part is string => part !== undefined).join(' · ')}
    </Button>
  )
  return (
    <>
      <Field label={t('config.wslDistro')} hint={t('config.wslDistro.hint')}>
        <div className="dsh-rw-inline">
          {hasList
            ? (
              <Menu
                open={menuOpen}
                onClose={() => { setMenuOpen(false) }}
                items={items}
                selectedId={config.wslDistro}
                onSelect={(id) => {
                  setMenuOpen(false)
                  store.patchConfig({ wslDistro: id })
                }}
                align="start"
                portal
                anchor={trigger}
              />
            )
            : (
              <Input
                data-step-focus
                value={config.wslDistro}
                placeholder={t('config.wslDistro.placeholder')}
                aria-label={t('config.wslDistro')}
                onChange={(event: ChangeEvent<HTMLInputElement>) => { store.patchConfig({ wslDistro: event.target.value }) }}
              />
            )}
          <Button
            variant="ghost"
            size="sm"
            icon={<IconRefreshOutlineRegular size={12} />}
            aria-label={t('common.refresh')}
            disabled={wslProbe.status === 'loading'}
            onClick={() => { void store.loadWslDistros(true) }}
          />
          <span className="dsh-rw-field-hint">
            {wslProbe.status === 'loading'
              ? t('wsl.detecting')
              : wslProbe.status === 'unavailable'
                ? t('wsl.unavailable', { reason: wslProbe.error ?? '' })
                : hasList
                  ? t('wsl.detected', { count: String(wslProbe.distros.length) })
                  : t('wsl.empty')}
          </span>
        </div>
      </Field>

      <Field label={t('config.wslUser')} hint={t('config.wslUser.hint')}>
        <Input
          value={config.wslUser}
          placeholder={t('config.wslUser.placeholder')}
          aria-label={t('config.wslUser')}
          onChange={(event: ChangeEvent<HTMLInputElement>) => { store.patchConfig({ wslUser: event.target.value }) }}
        />
      </Field>

      <p className="dsh-rw-hint">{t('config.wsl.note')}</p>
    </>
  )
}

/** Step 2 — connection configuration. */
function ConfigStep(props: { state: AppState }): ReactElement | null {
  const { config, aliases, aliasesLoading, aliasesLoaded, aliasWarnings, prefilling, pending, secretPending } = props.state
  const wsl = props.state.method === 'wsl'
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

        {wsl && <WslConfigFields state={props.state} />}

        {!wsl && (<>
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
        </>)}

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
          </div>
        </DisclosureRow>
      </div>
    </div>
  )
}

/**
 * The host-key confirmation panel.
 *
 * ONE component for both flows that can stop on an unknown fingerprint: the
 * connection attempt (frame `host-key`) and the read-only scan
 * (`stage: 'host-key'`). The requirement is that they are literally the same
 * panel — same copy, same explicit confirmation, never automatic.
 */
function HostKeyPanel(props: {
  fingerprint: string
  algorithm?: string | undefined
  /** The confirm request is in flight. */
  answering: boolean
  /** This fingerprint has already been accepted in this flow. */
  confirmed: boolean
  confirmLabel: string
  answeringLabel: string
  confirmedLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}): ReactElement {
  return (
    <div className="dsh-rw-hostkey">
      <span className="dsh-rw-hostkey-title">
        <IconWarningTriangleOutlineRegular size={14} />
        {t('connect.hostKey.title')}
      </span>
      <p className="dsh-rw-hint">{t('connect.hostKey.description')}</p>
      <div>
        <div className="dsh-rw-field-label">{t('connect.hostKey.fingerprint')}</div>
        <div className="dsh-rw-mono">{props.fingerprint}</div>
      </div>
      {props.algorithm !== undefined && props.algorithm !== '' && (
        <div>
          <div className="dsh-rw-field-label">{t('connect.hostKey.algorithm')}</div>
          <div className="dsh-rw-mono">{props.algorithm}</div>
        </div>
      )}
      <div className="dsh-rw-inline">
        <Button
          variant="primary"
          data-step-focus
          disabled={props.answering || props.confirmed}
          onClick={props.onConfirm}
        >
          {props.confirmed ? props.confirmedLabel : props.answering ? props.answeringLabel : props.confirmLabel}
        </Button>
        <Button variant="ghost" disabled={props.answering} onClick={props.onCancel}>
          {props.cancelLabel}
        </Button>
      </div>
    </div>
  )
}

/** One candidate row of the reuse list. */
function CandidateRow(props: { candidate: DshCandidate; selected: boolean }): ReactElement | null {
  const { candidate } = props
  const usable = candidate.compatible && candidate.executable
  const profile = candidate.profile
  const pluginText = profile === undefined
    ? t('dsh.plugin.none')
    : profile.upToDate
      ? t('dsh.plugin.installed', { version: profile.pluginVersion ?? t('dsh.version.unknown') })
      : t('dsh.plugin.outdated', { version: profile.pluginVersion ?? t('dsh.version.unknown') })
  const versionTone: TagTone = candidate.compatible ? 'success' : 'danger'
  return (
    <button
      type="button"
      className="dsh-rw-candidate"
      data-selected={props.selected ? 'true' : undefined}
      data-compatible={candidate.compatible ? 'true' : 'false'}
      aria-pressed={props.selected}
      aria-disabled={usable ? undefined : 'true'}
      disabled={!usable}
      title={candidate.path}
      onClick={() => { if (usable) store.selectDshCandidate(candidate.path) }}
    >
      <span className="dsh-rw-candidate-main">
        <span className="dsh-rw-candidate-path">{candidate.path}</span>
        <span className="dsh-rw-candidate-meta">
          <Tag tone="neutral">{candidate.version === '' ? t('dsh.version.unknown') : candidate.version}</Tag>
          <Tag tone={versionTone}>{candidate.compatible ? t('dsh.compatible') : t('dsh.incompatible')}</Tag>
          {!candidate.executable && <Tag tone="warning">{t('dsh.notExecutable')}</Tag>}
          {candidate.selfContained && <Tag tone="quiet">{t('dsh.selfContained')}</Tag>}
          <span className="dsh-rw-candidate-note">{pluginText}</span>
          {candidate.nodePath !== undefined && candidate.nodePath !== '' && (
            <span className="dsh-rw-candidate-note">{t('dsh.nodePath', { path: candidate.nodePath })}</span>
          )}
        </span>
        {candidate.reason !== undefined && candidate.reason !== '' && (
          <span className="dsh-rw-candidate-reason">{candidate.reason}</span>
        )}
      </span>
      <span className="dsh-rw-candidate-action">{props.selected ? t('dsh.selected') : t('dsh.select')}</span>
    </button>
  )
}

/**
 * Step 3's reuse panel: the scan's four states, all with text.
 *
 *   scanning          → 扫描中
 *   host-key pending  → the shared confirmation panel; confirming re-scans with
 *                       the fingerprint (a scan pins and stores nothing)
 *   ready, no rows    → 无候选
 *   ready, rows       → the candidate list (path / version / compatibility /
 *                       whether the server plugin is already there)
 */
function ReusePanel(props: { state: AppState }): ReactElement | null {
  const { dshScan, config } = props.state
  const scanning = dshScan.status === 'scanning'
  return (
    <div className="dsh-rw-scan">
      <div className="dsh-rw-inline">
        <span className="dsh-rw-field-hint">
          {scanning
            ? t('connect.scan.scanning')
            : dshScan.status === 'ready'
              ? t('connect.scan.ready', { count: dshScan.candidates.length })
              : ''}
        </span>
        <Button
          variant="ghost"
          size="sm"
          icon={<IconRefreshOutlineRegular size={12} />}
          disabled={scanning}
          onClick={() => { void store.scanDsh(true) }}
        >
          {t('connect.scan.retry')}
        </Button>
      </div>

      {dshScan.fingerprint !== undefined && (
        <>
          <p className="dsh-rw-hint">{t('connect.scan.hostKey.pending')}</p>
          <HostKeyPanel
            fingerprint={dshScan.fingerprint}
            answering={scanning}
            confirmed={false}
            confirmLabel={t('connect.hostKey.trust')}
            answeringLabel={t('connect.hostKey.trusting')}
            confirmedLabel={t('connect.hostKey.trusted')}
            cancelLabel={t('common.back')}
            onConfirm={() => { void store.scanDsh(true) }}
            onCancel={() => { store.setStep('config') }}
          />
        </>
      )}

      {scanning && dshScan.fingerprint === undefined && <LoadingLine text={t('connect.scan.scanning')} />}

      {dshScan.status === 'unavailable' && (
        <ErrorBanner error={{ code: 'scan-failed', message: t('connect.scan.failed', { message: dshScan.error ?? '' }) }} />
      )}

      {dshScan.status === 'ready' && dshScan.candidates.length === 0 && (
        <EmptyState text={t('connect.scan.empty')} />
      )}

      {/* Rows exist but none of them can be reused: say so instead of showing a
          list whose every entry is disabled with no explanation of the way out. */}
      {dshScan.status === 'ready'
        && dshScan.candidates.length > 0
        && !dshScan.candidates.some(candidate => candidate.compatible && candidate.executable) && (
          <p className="dsh-rw-hint">{t('connect.scan.empty')}</p>
        )}

      {dshScan.status === 'ready' && dshScan.candidates.length > 0 && (
        <div className="dsh-rw-candidates">
          {dshScan.candidates.map(candidate => (
            <CandidateRow
              key={candidate.realPath === '' ? candidate.path : candidate.realPath}
              candidate={candidate}
              selected={config.reuseLauncherPath !== '' && config.reuseLauncherPath === candidate.path}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Step 3's upload panel: which package the remote architecture needs and whether
 * it is already cached locally (then it is uploaded as is) or has to be built
 * here (minutes). The facts come from the same `dsh-scan` the reuse list uses.
 */
function UploadPanel(props: { state: AppState }): ReactElement | null {
  const { dshScan } = props.state
  const scanning = dshScan.status === 'scanning'
  const probe = dshScan.probe
  const pkg = dshScan.package
  return (
    <div className="dsh-rw-scan">
      <div className="dsh-rw-inline">
        <Button
          variant="ghost"
          size="sm"
          icon={<IconRefreshOutlineRegular size={12} />}
          disabled={scanning}
          onClick={() => { void store.scanDsh(true) }}
        >
          {t('connect.scan.retry')}
        </Button>
      </div>
      {scanning && <LoadingLine text={t('connect.upload.checking')} />}
      {dshScan.status === 'unavailable' && (
        <ErrorBanner error={{ code: 'scan-failed', message: t('connect.scan.failed', { message: dshScan.error ?? '' }) }} />
      )}
      {!scanning && probe === undefined && dshScan.status !== 'unavailable' && (
        <p className="dsh-rw-hint">{t('connect.upload.unknown')}</p>
      )}
      {probe !== undefined && (
        <>
          <p className="dsh-rw-hint">{t('connect.upload.probe', { tag: probe.tag })}</p>
          {pkg !== undefined && <p className="dsh-rw-hint">{t('connect.upload.artifact', { artifact: pkg.artifact })}</p>}
          <p className="dsh-rw-hint">
            {pkg?.cached === true
              ? t('connect.upload.cached', { size: formatSize(pkg.sizeBytes) })
              : t('connect.upload.build')}
          </p>
        </>
      )}
    </div>
  )
}

/**
 * Step 3 — the provisioned-through choice, the live progress, the connection log
 * and the host-key confirmation.
 */
function ConnectStep(props: { state: AppState }): ReactElement | null {
  const { connect, config, dshScan } = props.state
  const prompt = connect.hostKey
  const logRef = useRef<HTMLDivElement>(null)
  const busy = connect.phase === 'running' || connect.phase === 'awaiting-hostkey'
  // Terminal behaviour: the tail stays in view as lines arrive.
  useEffect(() => {
    const node = logRef.current
    if (node !== null) node.scrollTop = node.scrollHeight
  }, [connect.log.length])
  // Reuse never falls back to uploading on its own (that would push 25–50 MB
  // without asking). The way out is an explicit button, and only this flow gets
  // one: an upload failure is just a retry.
  const reuseFailed = connect.phase === 'failed' && config.connectionMode === 'reuse'
  return (
    <div className="dsh-rw-section">
      <h3 className="dsh-rw-section-title">{t('connect.mode.title')}</h3>
      <p className="dsh-rw-hint">{t('connect.mode.description')}</p>

      <div className="dsh-rw-methods" role="radiogroup" aria-label={t('connect.mode.title')}>
        {MODE_CARDS.map((card, index) => {
          const selected = config.connectionMode === card.id
          const disabled = card.disabled === true || busy
          return (
            <button
              key={card.id}
              type="button"
              className="dsh-rw-method"
              data-disabled={disabled ? 'true' : undefined}
              data-selected={selected ? 'true' : undefined}
              data-mode={card.id}
              disabled={disabled}
              aria-pressed={selected}
              {...(disabled ? {} : { 'data-step-focus': index === 0 ? true : undefined })}
              onClick={() => {
                if (disabled) return
                store.setConnectionMode(card.id)
              }}
            >
              <span className="dsh-rw-method-name">
                {t(MODE_NAME_KEYS[card.id])}
                {selected && <Tag tone="info">{t('connect.mode.selected')}</Tag>}
              </span>
              <span className="dsh-rw-method-description">{t(MODE_DESCRIPTION_KEYS[card.id])}</span>
              {card.disabled === true && <span className="dsh-rw-method-state">{t('connect.mode.download.disabled')}</span>}
            </button>
          )
        })}
      </div>

      {config.connectionMode === 'reuse' && <ReusePanel state={props.state} />}
      {config.connectionMode === 'upload' && <UploadPanel state={props.state} />}

      <h3 className="dsh-rw-section-title">{t('connect.title')}</h3>
      <p className="dsh-rw-hint">
        {dshScan.status === 'ready' && dshScan.probe !== undefined
          ? t('connect.upload.probe', { tag: dshScan.probe.tag })
          : t('connect.description')}
      </p>

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
        <HostKeyPanel
          fingerprint={prompt.fingerprint}
          algorithm={prompt.algorithm}
          answering={prompt.answering}
          confirmed={prompt.trusted}
          confirmLabel={t('connect.hostKey.trust')}
          answeringLabel={t('connect.hostKey.trusting')}
          confirmedLabel={t('connect.hostKey.trusted')}
          cancelLabel={t('connect.hostKey.cancel')}
          onConfirm={() => { void store.confirmHostKey() }}
          onCancel={() => { store.cancelConnect() }}
        />
      )}

      {connect.phase === 'failed' && <p className="dsh-rw-hint">{t('connect.retryHint')}</p>}
      {connect.error !== undefined && <ErrorBanner error={connect.error} />}
      {reuseFailed && (
        <div className="dsh-rw-inline">
          <Button
            variant="outline"
            onClick={() => {
              // Explicit switch, never an automatic fallback (architecture A11).
              store.setConnectionMode('upload')
              void store.startConnect()
            }}
          >
            {t('connect.reuse.switchUpload')}
          </Button>
        </div>
      )}
    </div>
  )
}

/** The wizard body: step pills, banners and the current step. */
export function WizardBody(): ReactElement | null {
  const state = useAppState()
  const bodyRef = useRef<HTMLDivElement>(null)
  const fingerprint = state.connect.hostKey?.fingerprint
  const scanFingerprint = state.dshScan.fingerprint

  // "Focus the first field when a step opens" — also when a host-key panel
  // appears mid-step (connect or scan), so its explicit confirmation button
  // takes the keyboard.
  useEffect(() => {
    const node = bodyRef.current?.querySelector<HTMLElement>('[data-step-focus]')
    node?.focus()
  }, [state.step, state.view, fingerprint, scanFingerprint])

  return (
    <div className="dsh-rw-stack">
      <StepPills state={state} />
      {state.error !== undefined && <ErrorBanner error={state.error} onDismiss={store.dismissError} />}
      <div className="dsh-rw-scroll" ref={bodyRef}>
        {state.step === 'method' && <MethodStep state={state} />}
        {state.step === 'config' && <ConfigStep state={state} />}
        {state.step === 'connect' && <ConnectStep state={state} />}
      </div>
    </div>
  )
}

/** Wizard actions, rendered inside the dialog footer. */
export function WizardFooter(): ReactElement | null {
  const state = useAppState()
  const { pending, connect, config } = state
  const busy = connect.phase === 'running' || connect.phase === 'awaiting-hostkey'

  if (state.step === 'method') {
    return (
      <div className="dsh-rw-footer-actions">
        <span className="dsh-rw-footer-group">
          <Button variant="ghost" onClick={store.closeOverlay}>{t('common.cancel')}</Button>
        </span>
        <span className="dsh-rw-footer-group">
          <Button variant="primary" disabled={!methodAvailable(state.method, state.platform)} onClick={() => { store.setStep('config') }}>
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
          <Button variant="primary" disabled={pending || state.prefilling} onClick={() => { store.setStep('connect') }}>
            {t('step.label.connect')}
          </Button>
        </span>
      </div>
    )
  }

  // Step 3: starting and retrying are the same call; the primary is disabled
  // until the choice is complete (a mode is picked, and reuse has a launcher).
  const chosen = config.connectionMode === 'reuse'
    ? config.reuseLauncherPath !== ''
    : config.connectionMode === 'upload'
  return (
    <div className="dsh-rw-footer-actions">
      <span className="dsh-rw-footer-group">
        <Button variant="ghost" icon={<IconChevronLeftOutlineRegular size={12} />} disabled={busy} onClick={() => { store.setStep('config') }}>
          {t('common.back')}
        </Button>
      </span>
      <span className="dsh-rw-footer-group">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            // Nothing in flight: 取消 leaves the wizard like it does on the
            // earlier steps. Mid-attempt it aborts the attempt and stays here,
            // which is where the retry / another mode lives.
            const phase = connect.phase
            if (phase === 'idle' || phase === 'succeeded') store.closeOverlay()
            else store.cancelConnect()
          }}
        >
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={pending || busy || !chosen}
          onClick={() => { void store.startConnect() }}
        >
          {connect.phase === 'failed' ? t('common.retry') : t('config.connect')}
        </Button>
      </span>
    </div>
  )
}
