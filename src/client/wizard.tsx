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
import type { AuthKind, CandidateOrigin, ConnectStep, DshCandidate, SshAlias, WslDistro } from './api.ts'
import { ErrorBanner, Field, LoadingLine } from './common.tsx'
import { choiceReady } from './runtime-choice.ts'
import { t } from './locales.ts'
import { offeredMethods } from './method-cards.ts'
import type { AppState, StepState, WizardStep } from './store.ts'
import { store, useAppState } from './store.ts'
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
 * The two ways a **new** runtime reaches the host, offered only after
 * 「部署新运行时」 is picked.
 *
 * `download` fetches the released server package for the remote architecture
 * (host side: GitHub Release, tag candidates `server-v<dshVersion>` then
 * `v<pluginVersion>`), falling back to a local build when no release matches.
 */
const DEPLOY_CARDS: readonly { id: 'upload' | 'download' }[] = [
  { id: 'upload' },
  { id: 'download' },
]

/** Localized name/description key per deploy card. */
const DEPLOY_NAME_KEYS = {
  upload: 'connect.mode.upload.name',
  download: 'connect.mode.download.name',
} as const

/** Localized description key per deploy card. */
const DEPLOY_DESCRIPTION_KEYS = {
  upload: 'connect.mode.upload.description',
  download: 'connect.mode.download.description',
} as const

/** The phase-2 progress rows; phase 1 already covers connect + probe. */
const DEPLOY_STEPS: readonly ConnectStep[] = ['runtime', 'upload', 'start']

/** Row label per launcher provenance (the path alone is unreadable). */
const ORIGIN_KEYS: Record<CandidateOrigin, 'dsh.origin.deployed' | 'dsh.origin.nvm' | 'dsh.origin.fnm' | 'dsh.origin.volta' | 'dsh.origin.bun' | 'dsh.origin.user-local' | 'dsh.origin.system' | 'dsh.origin.other'> = {
  deployed: 'dsh.origin.deployed',
  nvm: 'dsh.origin.nvm',
  fnm: 'dsh.origin.fnm',
  volta: 'dsh.origin.volta',
  bun: 'dsh.origin.bun',
  'user-local': 'dsh.origin.user-local',
  system: 'dsh.origin.system',
  other: 'dsh.origin.other',
}

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
  // The row is identified by *what it is* plus the profile it will run — a path
  // like `/home/u/.dsh/server/dsh/node_modules/.bin/dsh` tells nobody anything.
  const profileName = profile?.name ?? ''
  const pluginText = profile === undefined
    ? t('dsh.plugin.none')
    : profile.upToDate
      ? t('dsh.profile.installed', { profile: profileName, version: profile.pluginVersion ?? t('dsh.version.unknown') })
      : t('dsh.profile.outdated', { profile: profileName, version: profile.pluginVersion ?? t('dsh.version.unknown') })
  // A deployed runtime *is* its profile — the name alone identifies it, so the
  // row does not say "deployed by this plugin" in front of it.
  const originLabel = t(ORIGIN_KEYS[candidate.origin])
  const rowLabel = candidate.origin === 'deployed'
    ? (profileName !== '' ? profileName : originLabel)
    : `${originLabel}${candidate.originDetail !== undefined && candidate.originDetail !== '' ? ` · ${candidate.originDetail}` : ''}`
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
        <span className="dsh-rw-candidate-path">{rowLabel}</span>
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
        <span className="dsh-rw-candidate-note">{t('dsh.candidate.path', { path: candidate.path })}</span>
        {candidate.reason !== undefined && candidate.reason !== '' && (
          <span className="dsh-rw-candidate-reason">{candidate.reason}</span>
        )}
      </span>
      <span className="dsh-rw-candidate-action">{props.selected ? t('dsh.selected') : t('dsh.select')}</span>
    </button>
  )
}

/** One row of the phase-1/phase-2 progress lists. */
function ProgressRow(props: { step: ConnectStep; row: StepState }): ReactElement {
  const detail = props.row.message ?? props.row.detail
  return (
    <div className="dsh-rw-progress-row">
      <span className="dsh-rw-progress-dot">
        <StateDot state={dotState(props.row.status)} />
      </span>
      <span className="dsh-rw-progress-text">
        <span className="dsh-rw-progress-title">
          {t(CONNECT_STEP_LABELS[props.step])}
          <span className="dsh-rw-progress-status">{t(CONNECT_STATUS_LABELS[props.row.status])}</span>
        </span>
        {detail !== undefined && detail !== '' && <span className="dsh-rw-progress-message">{detail}</span>}
      </span>
    </div>
  )
}

/**
 * Phase 1 — the read-only scan that runs the moment step 3 opens.
 *
 * It answers two questions before the user picks anything: can we reach the
 * host (and is its key trusted), and what does the host already have (arch,
 * tools, dsh installs, package cache). The runtime list below is built from it.
 */
function ScanProgress(props: { state: AppState }): ReactElement {
  const { dshScan, config } = props.state
  const scanning = dshScan.status === 'scanning'
  const awaitingKey = dshScan.fingerprint !== undefined
  const connectStatus: StepState['status'] = scanning || awaitingKey
    ? 'running'
    : dshScan.status === 'ready'
      ? 'ok'
      : dshScan.status === 'unavailable'
        ? 'failed'
        : 'pending'
  const probeStatus: StepState['status'] = dshScan.status === 'ready'
    ? 'ok'
    : dshScan.status === 'unavailable'
      ? 'failed'
      : 'pending'
  const endpoint = config.host === '' ? config.wslDistro : `${config.host}:${config.port}`
  return (
    <div className="dsh-rw-progress">
      <ProgressRow
        step="connect"
        row={{
          status: connectStatus,
          ...(connectStatus === 'running'
            ? { message: awaitingKey ? t('connect.scan.hostKey.pending') : t('connect.scan.connecting', { endpoint }) }
            : {}),
          ...(connectStatus === 'failed' ? { message: dshScan.error ?? '' } : {}),
        }}
      />
      {/* The confirmation blocks this very step, so it sits under 连接主机 and
          above 探测远端环境 — which cannot start until the key is trusted. */}
      {awaitingKey && (
        <HostKeyPanel
          fingerprint={dshScan.fingerprint ?? ''}
          answering={scanning}
          confirmed={false}
          confirmLabel={t('connect.hostKey.trust')}
          answeringLabel={t('connect.hostKey.trusting')}
          confirmedLabel={t('connect.hostKey.trusted')}
          cancelLabel={t('common.back')}
          onConfirm={() => { void store.scanDsh(true) }}
          onCancel={() => { store.setStep('config') }}
        />
      )}
      <ProgressRow
        step="probe"
        row={{
          status: probeStatus,
          ...(probeStatus === 'ok' && dshScan.probe !== undefined
            ? { message: t('connect.package.probe', { tag: dshScan.probe.tag }) }
            : {}),
        }}
      />
    </div>
  )
}

/**
 * Phase 1's runtime decision: reuse one of the scanned installs, or deploy a
 * new runtime and pick how it travels.
 *
 * Reuse is a **list**, not a card: the scan already knows every dsh on the host,
 * so the user's job is to pick one. The deploy row only reveals 上传 / 远程下载
 * after it is chosen — that is the only point where the tradeoff matters.
 */
function RuntimePanel(props: { state: AppState }): ReactElement | null {
  const { dshScan, config } = props.state
  const [deployOpen, setDeployOpen] = useState(false)
  const choice = config.runtimeChoice
  const chosenDeploy = choice !== null && choice.kind !== 'reuse' ? choice.kind : undefined
  if (dshScan.status !== 'ready') return null
  const candidates = dshScan.candidates
  const deployExpanded = deployOpen || chosenDeploy !== undefined
  return (
    <div className="dsh-rw-scan">
      <h3 className="dsh-rw-section-title">{t('connect.runtime.title')}</h3>
      <p className="dsh-rw-hint">{t('connect.runtime.hint')}</p>

      {props.state.verifiedRuntimes.length > 0 && (
        <p className="dsh-rw-hint">
          {t('connect.scan.verified', { version: props.state.verifiedRuntimes.join(' / ') })}
        </p>
      )}

      {(dshScan.dshHome !== undefined && dshScan.dshHome !== '') || (dshScan.profiles?.length ?? 0) > 0 ? (
        <p className="dsh-rw-hint">
          {dshScan.dshHome !== undefined && dshScan.dshHome !== '' ? t('dsh.scan.home', { home: dshScan.dshHome }) : ''}
          {dshScan.dshHome !== undefined && dshScan.dshHome !== '' ? ' · ' : ''}
          {(dshScan.profiles?.length ?? 0) > 0
            ? t('dsh.scan.profiles', { profiles: (dshScan.profiles ?? []).join(' / ') })
            : t('dsh.scan.noProfiles')}
        </p>
      ) : null}

      {candidates.length === 0 && <p className="dsh-rw-hint">{t('connect.runtime.empty')}</p>}
      {candidates.length > 0 && (
        <div className="dsh-rw-candidates">
          {candidates.map(candidate => (
            <CandidateRow
              key={candidate.realPath === '' ? candidate.path : candidate.realPath}
              candidate={candidate}
              selected={choice !== null && choice.kind === 'reuse' && choice.path === candidate.path}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        className="dsh-rw-candidate"
        data-selected={chosenDeploy !== undefined ? 'true' : undefined}
        aria-expanded={deployExpanded}
        onClick={() => setDeployOpen(open => !open)}
      >
        <span className="dsh-rw-candidate-main">
          <span className="dsh-rw-candidate-path">{t('connect.runtime.deploy')}</span>
          <span className="dsh-rw-candidate-meta">
            <span className="dsh-rw-candidate-note">{t('connect.runtime.deploy.hint')}</span>
          </span>
        </span>
        <span className="dsh-rw-candidate-action">
          {deployExpanded ? t('connect.runtime.collapse') : t('connect.runtime.expand')}
        </span>
      </button>

      {deployExpanded && (
        <>
          <div className="dsh-rw-methods" role="radiogroup" aria-label={t('connect.runtime.deploy')}>
            {DEPLOY_CARDS.map((card, index) => {
              const selected = chosenDeploy === card.id
              return (
                <button
                  key={card.id}
                  type="button"
                  className="dsh-rw-method"
                  data-selected={selected ? 'true' : undefined}
                  data-mode={card.id}
                  aria-pressed={selected}
                  {...(index === 0 ? { 'data-step-focus': true } : {})}
                  onClick={() => store.chooseDeploy(card.id)}
                >
                  <span className="dsh-rw-method-name">
                    {t(DEPLOY_NAME_KEYS[card.id])}
                    {selected && <Tag tone="info">{t('connect.mode.selected')}</Tag>}
                  </span>
                  <span className="dsh-rw-method-description">{t(DEPLOY_DESCRIPTION_KEYS[card.id])}</span>
                </button>
              )
            })}
          </div>
          {chosenDeploy !== undefined && <PackagePanel state={props.state} mode={chosenDeploy} />}
        </>
      )}
    </div>
  )
}

/**
 * Step 3's package panel: which package the remote architecture needs, and what
 * this choice will do with it.
 *
 * Shared facts (probe tag, artifact name, whether the package is already cached)
 * come from the same `dsh-scan` the reuse list uses; only the outcome line is
 * mode-specific:
 *  - `upload` — cached ⇒ upload as is, otherwise build it here (minutes);
 *  - `download` — cached ⇒ use it, otherwise fetch the release for this arch
 *    (host side falls back to a local build when no release matches).
 */
function PackagePanel(props: { state: AppState; mode: 'upload' | 'download' }): ReactElement | null {
  const { dshScan } = props.state
  const scanning = dshScan.status === 'scanning'
  const probe = dshScan.probe
  const pkg = dshScan.package
  const outcome = props.mode === 'upload'
    ? (pkg?.cached === true
      ? t('connect.upload.cached', { size: formatSize(pkg.sizeBytes) })
      : t('connect.upload.build'))
    : (pkg?.cached === true
      ? t('connect.download.cached', { size: formatSize(pkg.sizeBytes) })
      : t('connect.download.fetch', { artifact: pkg?.artifact ?? t('common.unknown') }))
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
      {scanning && <LoadingLine text={t('connect.package.checking')} />}
      {dshScan.status === 'unavailable' && (
        <ErrorBanner error={{ code: 'scan-failed', message: t('connect.scan.failed', { message: dshScan.error ?? '' }) }} />
      )}
      {!scanning && probe === undefined && dshScan.status !== 'unavailable' && (
        <p className="dsh-rw-hint">{t('connect.package.unknown')}</p>
      )}
      {probe !== undefined && (
        <>
          <p className="dsh-rw-hint">{t('connect.package.probe', { tag: probe.tag })}</p>
          {pkg !== undefined && <p className="dsh-rw-hint">{t('connect.package.artifact', { artifact: pkg.artifact })}</p>}
          <p className="dsh-rw-hint">{outcome}</p>
        </>
      )}
    </div>
  )
}

/**
 * Step 3 — auto probe, runtime choice, live deploy progress, host-key
 * confirmation and the connection log.
 *
 * The step is entered by {@link WizardFooter}'s 连接 button; the scan below has
 * already run by then (`setStep('connect')` triggers it), so the user sees the
 * host being reached and probed before being asked anything.
 */
function ConnectStep(props: { state: AppState }): ReactElement | null {
  const { connect, config, dshScan } = props.state
  const prompt = connect.hostKey
  const logRef = useRef<HTMLDivElement>(null)
  const busy = connect.phase === 'running' || connect.phase === 'awaiting-hostkey'
  const scanning = dshScan.status === 'scanning'
  // Terminal behaviour: the tail stays in view as lines arrive.
  useEffect(() => {
    const node = logRef.current
    if (node !== null) node.scrollTop = node.scrollHeight
  }, [connect.log.length])
  // Reuse never falls back to uploading on its own (that would push 25–50 MB
  // without asking). The way out is an explicit button.
  const reuseFailed = connect.phase === 'failed' && config.runtimeChoice !== null && config.runtimeChoice.kind === 'reuse'
  return (
    <div className="dsh-rw-section">
      <h3 className="dsh-rw-section-title">{t('connect.title')}</h3>
      <p className="dsh-rw-hint">
        {dshScan.status === 'ready' && dshScan.probe !== undefined
          ? t('connect.package.probe', { tag: dshScan.probe.tag })
          : t('connect.description')}
      </p>

      <ScanProgress state={props.state} />

      {dshScan.status === 'unavailable' && (
        <>
          <ErrorBanner error={{ code: 'scan-failed', message: t('connect.scan.failed', { message: dshScan.error ?? '' }) }} />
          <div className="dsh-rw-inline">
            <Button variant="outline" disabled={scanning} onClick={() => { void store.scanDsh(true) }}>
              {t('connect.scan.retry')}
            </Button>
          </div>
        </>
      )}

      {dshScan.status === 'ready' && (
        <div className="dsh-rw-inline">
          <span className="dsh-rw-field-hint">{t('connect.scan.ready', { count: dshScan.candidates.length })}</span>
          <Button
            variant="ghost"
            size="sm"
            icon={<IconRefreshOutlineRegular size={12} />}
            disabled={scanning || busy}
            onClick={() => { void store.scanDsh(true) }}
          >
            {t('connect.scan.retry')}
          </Button>
        </div>
      )}

      <RuntimePanel state={props.state} />

      <div className="dsh-rw-progress">
        {DEPLOY_STEPS.map(step => (
          <ProgressRow key={step} step={step} row={connect.steps[step] ?? { status: 'pending' }} />
        ))}
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

      {connect.phase === 'failed' && <p className="dsh-rw-hint">{t('connect.retryHint')}</p>}
      {connect.error !== undefined && <ErrorBanner error={connect.error} />}
      {reuseFailed && (
        <div className="dsh-rw-inline">
          <Button
            variant="outline"
            onClick={() => {
              // Explicit switch, never an automatic fallback (architecture A11).
              store.chooseDeploy('upload')
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
  // until the scan has run and the runtime choice is usable (a reuse pick must
  // still name a compatible install; deploy choices are always ready).
  const scanning = state.dshScan.status === 'scanning'
  const chosen = !scanning && choiceReady(config.runtimeChoice, state.dshScan.candidates)
  // Selecting 远程下载 when no package is cached here means this press really
  // downloads ~40 MB from the release — say so on the button.
  const downloads = config.runtimeChoice !== null && config.runtimeChoice.kind === 'download' && state.dshScan.package?.cached === false
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
          {connect.phase === 'failed'
            ? t('common.retry')
            : downloads ? t('connect.download.button') : t('config.connect')}
        </Button>
      </span>
    </div>
  )
}
