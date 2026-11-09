/**
 * The v3 connection dialogs, hosted by the floating target rail.
 *
 * Two surfaces remain: the three-step SSH connect form (method → config →
 * connect, with the host-key confirmation on the last step) and the forget
 * confirmation. Everything else — workspaces, sessions, mode switching — is
 * owned by the server's official UI inside the portal iframe.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Button, DisclosureRow, IconGlobeOutlineRegular, Modal, SegmentedControl, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { api, type SshAlias } from './api.ts'
import { Field } from './common.tsx'
import { offeredMethods, type OfferedMethod } from './method-cards.ts'
import { remoteApi, type ConnectProgressEvent, type ConnectProgressStep } from './remote-api.ts'
import { t, type LocaleKey } from './locales.ts'
import {
  closeConnectDialog, closeForgetTarget, patchConnectDialog, submitConnectDialog,
  submitForgetTarget, useRemoteAppState,
} from './remote-store.ts'
import type { RemoteAppState } from './remote-store.ts'

const CONNECT_STEPS = ['method', 'config', 'connect'] as const
type ConnectStep = typeof CONNECT_STEPS[number]
const CONNECT_STEP_LABELS = {
  method: 'step.label.method',
  config: 'step.label.config',
  connect: 'step.label.connect',
} as const

const PROGRESS_STEPS: readonly ConnectProgressStep[] = ['connect', 'probe', 'runtime', 'upload', 'start']
const PROGRESS_LABELS = {
  connect: 'connect.step.connect',
  probe: 'connect.step.probe',
  runtime: 'connect.step.runtime',
  upload: 'connect.step.upload',
  start: 'connect.step.start',
} as const
const PROGRESS_STATUS = {
  pending: 'connect.status.pending',
  running: 'connect.status.running',
  ok: 'connect.status.ok',
  skipped: 'connect.status.skipped',
  failed: 'connect.status.failed',
} as const

/**
 * Method-card copy, keyed by the pure module's offered-method ids.
 *
 * The card list itself comes from {@link offeredMethods} — the same predicate
 * the host validates — so a method only appears when its transport exists
 * (`methodAvailable`). WSL keeps its translated copy here so the day
 * `WSL_TRANSPORT_ENABLED` flips the card renders a real label instead of a raw
 * key; the config step below is SSH-only and must grow WSL fields before that
 * flip adds it to `OFFERED_METHODS`.
 */
const METHOD_CARD_COPY: Record<OfferedMethod, { readonly name: LocaleKey; readonly description: LocaleKey; readonly aria: LocaleKey }> = {
  ssh: { name: 'method.ssh.name', description: 'method.ssh.description', aria: 'method.ssh.aria' },
  wsl: { name: 'method.wsl.name', description: 'method.wsl.description', aria: 'method.wsl.aria' },
}

/** Id of the datalist that offers the private keys found under `~/.ssh`. */
const SSH_KEY_LIST_ID = 'dsh-rw-ssh-key-options'

function ConnectDialog(props: { state: RemoteAppState }): ReactElement | null {
  const dialog = props.state.connectDialog
  const [step, setStep] = useState<ConnectStep>('method')
  const [aliases, setAliases] = useState<SshAlias[]>([])
  const [aliasWarnings, setAliasWarnings] = useState<string[]>([])
  const [aliasesLoading, setAliasesLoading] = useState(false)
  const [aliasesLoaded, setAliasesLoaded] = useState(false)
  const [sshKeyOptions, setSshKeyOptions] = useState<Array<{ path: string; label: string }>>([])
  const [sshKeysLoaded, setSshKeysLoaded] = useState(false)
  const [aliasChoice, setAliasChoice] = useState('')
  const [configError, setConfigError] = useState<string | undefined>(undefined)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [progress, setProgress] = useState<ConnectProgressEvent[]>([])
  /** Re-render once a second while the connect attempt is running. */
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [progressReadError, setProgressReadError] = useState<string | undefined>(undefined)
  const startedAt = useRef<number | undefined>(undefined)
  const progressFailures = useRef(0)
  useEffect(() => {
    if (props.state.connectDialog?.phase === 'hostkey') setStep('connect')
  }, [props.state.connectDialog?.phase])
  useEffect(() => {
    if (step !== 'config' || aliasesLoaded || aliasesLoading) return
    setAliasesLoading(true)
    void api.sshAliases()
      .then(result => { setAliases(result.aliases); setAliasWarnings(result.warnings); setAliasesLoaded(true) })
      .catch(() => { setAliasesLoaded(true) })
      .finally(() => { setAliasesLoading(false) })
  }, [step, aliasesLoaded, aliasesLoading])
  useEffect(() => {
    // Only fetched when the private-key tab is visible: a password/agent
    // connection never touches `~/.ssh`, and the list is cached per dialog.
    if (step !== 'config' || dialog?.authKind !== 'privateKey' || sshKeysLoaded) return
    void api.sshKeys()
      .then(result => { setSshKeyOptions(result.keys); setSshKeysLoaded(true) })
      .catch(() => { setSshKeysLoaded(true) })
  }, [step, dialog?.authKind, sshKeysLoaded])
  useEffect(() => {
    if (step !== 'connect') return
    if (props.state.connectDialog?.phase !== 'idle') return
    void submitConnectDialog()
  }, [step, props.state.connectDialog?.phase])
  const attemptId = props.state.connectDialog?.attemptId
  const submitting = props.state.connectDialog?.phase === 'submitting'
  useEffect(() => {
    progressFailures.current = 0
    setProgressReadError(undefined)
    setElapsedSeconds(0)
    if (attemptId === undefined) {
      startedAt.current = undefined
      setProgress([])
      return
    }
    startedAt.current = Date.now()
    let stopped = false
    const tick = async (): Promise<void> => {
      try {
        const result = await remoteApi.connectProgress(attemptId)
        if (stopped) return
        progressFailures.current = 0
        setProgressReadError(undefined)
        setProgress(result.events)
      } catch (error) {
        if (stopped) return
        // A transient poll failure is not a connection failure: keep retrying
        // and only tell the user after three consecutive misses.
        progressFailures.current += 1
        if (progressFailures.current >= 3) {
          setProgressReadError(t('connect.progress.readFailed', {
            message: error instanceof Error ? error.message : String(error),
          }))
        }
      }
    }
    setProgress([])
    void tick()
    const timer = setInterval(() => { void tick() }, 300)
    return () => { stopped = true; clearInterval(timer) }
  }, [attemptId])
  useEffect(() => {
    if (!submitting || attemptId === undefined) {
      setElapsedSeconds(0)
      return
    }
    const timer = setInterval(() => {
      if (startedAt.current === undefined) return
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt.current) / 1_000)))
    }, 1_000)
    return () => clearInterval(timer)
  }, [submitting, attemptId])
  if (dialog === undefined) return null
  const current = dialog.phase === 'hostkey' ? 'connect' : step
  const currentIndex = CONNECT_STEPS.indexOf(current)
  const hostKey = dialog.phase === 'hostkey' && dialog.fingerprint !== undefined
  const patch = (value: Parameters<typeof patchConnectDialog>[0]): void => { setConfigError(undefined); patchConnectDialog(value) }
  const validateConfig = (): string | undefined => {
    if (dialog.label.trim() === '') return t('remote.connect.labelRequired')
    if (dialog.host.trim() === '') return t('remote.connect.hostRequired')
    const port = Number(dialog.port.trim())
    if (!Number.isInteger(port) || port < 1 || port > 65_535) return t('remote.connect.portInvalid')
    if (dialog.username.trim() === '') return t('remote.connect.userRequired')
    if (dialog.authKind === 'password' && dialog.secret === '') return t('remote.connect.secretRequired')
    if (dialog.authKind === 'privateKey' && dialog.privateKeyPath.trim() === '') return t('remote.connect.keyRequired')
    // The local source auto-discovers this DSH's own providers; the host
    // validates the catalog at connect time instead of asking for an endpoint.
    return undefined
  }
  const primaryLabel = current !== 'connect'
    ? t('remote.connect.next')
    : submitting
      ? t('remote.connect.submitting')
      : hostKey
        ? t('remote.connect.hostkeyTrust')
        : dialog.phase === 'failed'
          ? t('remote.connect.retry')
          : t('remote.connect.submit')
  return (
    <Modal
      open
      onClose={closeConnectDialog}
      title={t('remote.connect.title')}
      className="dsh-rw-connect-modal"
      closeLabel={t('remote.dialog.cancel')}
      footer={(
        <div className="dsh-rw-footer-actions">
          <span className="dsh-rw-footer-group">
            <Button variant="ghost" onClick={closeConnectDialog} disabled={submitting}>
              {t('remote.dialog.cancel')}
            </Button>
            {current !== 'method' && (
              <Button
                variant="outline"
                onClick={() => { setStep(CONNECT_STEPS[currentIndex - 1]!) }}
                disabled={submitting}
              >
                {t('remote.connect.back')}
              </Button>
            )}
          </span>
          <span className="dsh-rw-footer-group">
            {submitting && (
              <span className="dsh-rw-connect-elapsed" data-testid="dsh-rw-connect-elapsed" role="status">
                {t('connect.progress.elapsed', { seconds: elapsedSeconds })}
              </span>
            )}
            <Button
              variant="primary"
              onClick={() => {
                if (current === 'connect') { void submitConnectDialog(); return }
                if (current === 'config') {
                  const invalid = validateConfig()
                  if (invalid !== undefined) { setConfigError(invalid); return }
                }
                setStep(CONNECT_STEPS[currentIndex + 1]!)
              }}
              disabled={submitting || (current === 'connect' && dialog.phase === 'idle')}
            >
              {primaryLabel}
            </Button>
          </span>
        </div>
      )}
    >
      <div className="dsh-rw-connect-dialog">
        <div className="dsh-rw-connect-layout">
          <nav className="dsh-rw-connect-stepnav" aria-label={t('wizard.steps.aria')}>
            {CONNECT_STEPS.map((item, index) => (
              <button
                key={item}
                type="button"
                className="dsh-rw-connect-stepnav-item"
                data-active={item === current ? 'true' : undefined}
                data-done={index < currentIndex ? 'true' : undefined}
                disabled={submitting || index > currentIndex}
                onClick={() => { setStep(item) }}
                title={index < currentIndex ? t('step.goBackTo', { label: t(CONNECT_STEP_LABELS[item]) }) : undefined}
              >
                <span className="dsh-rw-connect-stepnav-index">{index + 1}</span>
                <span className="dsh-rw-connect-stepnav-label">{t(CONNECT_STEP_LABELS[item])}</span>
              </button>
            ))}
          </nav>
          <div className="dsh-rw-connect-stepbody">

        {current === 'method' && (
          <div className="dsh-rw-section">
            <h3 className="dsh-rw-section-title">{t('method.title')}</h3>
            <p className="dsh-rw-hint">{t('method.description')}</p>
            <div className="dsh-rw-methods">
              {/* Offered cards come from the gate: `offeredMethods` → `methodAvailable`
                  (WSL only appears once `WSL_TRANSPORT_ENABLED` has a transport). */}
              {offeredMethods(props.state.platform ?? '').map(method => (
                <button
                  key={method}
                  type="button"
                  className="dsh-rw-method"
                  data-selected={method === 'ssh' ? 'true' : undefined}
                  aria-pressed={method === 'ssh'}
                  aria-label={t(METHOD_CARD_COPY[method].aria)}
                  onClick={() => { setStep('config') }}
                >
                  <span className="dsh-rw-method-name">{t(METHOD_CARD_COPY[method].name)}</span>
                  <span className="dsh-rw-method-description">{t(METHOD_CARD_COPY[method].description)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {current === 'config' && (
          <div className="dsh-rw-section">
            <h3 className="dsh-rw-section-title">{t('connect.config.title')}</h3>
            <Field
              label={t('remote.connect.sshAlias')}
              hint={aliasesLoading ? t('remote.connect.sshAlias.loading') : aliasesLoaded && aliases.length === 0 ? t('remote.connect.sshAlias.empty') : t('remote.connect.sshAlias.hint')}
            >
              <div className="dsh-rw-inline dsh-rw-ssh-alias-row">
                <select
                  className="dsh-rw-rename-input"
                  value={aliasChoice}
                  disabled={submitting || aliasesLoading}
                  onChange={(event: { target: { value: string } }) => {
                    const value = event.target.value
                    setAliasChoice(value)
                    const alias = aliases.find(candidate => candidate.alias === value)
                    if (alias === undefined) return
                    patch({
                      label: dialog.label.trim() === '' ? alias.alias : dialog.label,
                      host: alias.hostName ?? '',
                      port: String(alias.port ?? 22),
                      ...(alias.user === undefined ? {} : { username: alias.user }),
                      ...(alias.identityFile === undefined ? {} : { privateKeyPath: alias.identityFile }),
                    })
                  }}
                >
                  <option value="">{t('remote.connect.sshAlias.manual')}</option>
                  {aliases.map(alias => (
                    <option value={alias.alias} key={alias.alias}>
                      {`${alias.alias}${alias.hostName === undefined ? '' : ` — ${alias.user === undefined ? '' : `${alias.user}@`}${alias.hostName}${alias.port === undefined ? '' : `:${alias.port}`}`}`}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={aliasesLoading}
                  onClick={() => {
                    setAliasesLoaded(false)
                    setAliasesLoading(true)
                    void api.sshAliases()
                      .then(result => { setAliases(result.aliases); setAliasWarnings(result.warnings) })
                      .catch(() => {})
                      .finally(() => { setAliasesLoaded(true); setAliasesLoading(false) })
                  }}
                >
                  {t('remote.connect.sshAlias.refresh')}
                </Button>
              </div>
              {aliasWarnings.length > 0 && <span className="dsh-rw-hint">{t('remote.connect.sshAlias.warning', { count: aliasWarnings.length })}</span>}
            </Field>
            <Field label={t('remote.connect.label')}>
              <input
                className="dsh-rw-rename-input"
                value={dialog.label}
                disabled={submitting}
                placeholder={t('remote.connect.labelPlaceholder')}
                onChange={(event: { target: { value: string } }) => patch({ label: event.target.value })}
              />
            </Field>
            <div className="dsh-rw-connect-grid">
              <Field label={t('remote.connect.host')}>
                <input
                  className="dsh-rw-rename-input"
                  value={dialog.host}
                  disabled={submitting}
                  placeholder="203.0.113.10"
                  onChange={(event: { target: { value: string } }) => patch({ host: event.target.value })}
                />
              </Field>
              <Field label={t('remote.connect.port')}>
                <input
                  className="dsh-rw-rename-input"
                  value={dialog.port}
                  disabled={submitting}
                  inputMode="numeric"
                  onChange={(event: { target: { value: string } }) => patch({ port: event.target.value })}
                />
              </Field>
              <Field label={t('remote.connect.username')}>
                <input
                  className="dsh-rw-rename-input"
                  value={dialog.username}
                  disabled={submitting}
                  placeholder="tester"
                  onChange={(event: { target: { value: string } }) => patch({ username: event.target.value })}
                />
              </Field>
            </div>
            <Field label={t('remote.connect.authKind')}>
              <SegmentedControl<'password' | 'privateKey' | 'agent'>
                id="dsh-rw-connect-auth"
                value={dialog.authKind}
                disabled={submitting}
                label={t('remote.connect.authKind')}
                options={[
                  { value: 'password', label: t('remote.connect.auth.password') },
                  { value: 'privateKey', label: t('remote.connect.auth.privateKey') },
                  { value: 'agent', label: t('remote.connect.auth.agent') },
                ]}
                onChange={(next) => patch({ authKind: next })}
              />
            </Field>
            {dialog.authKind === 'password' && (
              <Field label={t('remote.connect.secret')}>
                <input
                  className="dsh-rw-rename-input"
                  type="password"
                  value={dialog.secret}
                  disabled={submitting}
                  autoComplete="off"
                  onChange={(event: { target: { value: string } }) => patch({ secret: event.target.value })}
                />
              </Field>
            )}
            {dialog.authKind === 'privateKey' && (
              <>
                <Field label={t('remote.connect.privateKeyPath')} hint={t('remote.connect.privateKeyHint')}>
                  <input
                    className="dsh-rw-rename-input"
                    value={dialog.privateKeyPath}
                    disabled={submitting}
                    placeholder="~/.ssh/id_ed25519"
                    list={SSH_KEY_LIST_ID}
                    onChange={(event: { target: { value: string } }) => patch({ privateKeyPath: event.target.value })}
                  />
                  <datalist id={SSH_KEY_LIST_ID}>
                    {sshKeyOptions.map(option => (
                      <option key={option.path} value={option.path} label={option.label} />
                    ))}
                  </datalist>
                  <p className="dsh-rw-hint" data-testid="dsh-rw-ssh-keys">
                    {sshKeyOptions.length === 0
                      ? t('remote.connect.privateKeyNone')
                      : t('remote.connect.privateKeyFound', { count: String(sshKeyOptions.length) })}
                  </p>
                </Field>
                <Field label={t('remote.connect.passphrase')} hint={t('remote.connect.passphraseHint')}>
                  <input
                    className="dsh-rw-rename-input"
                    type="password"
                    value={dialog.secret}
                    disabled={submitting}
                    autoComplete="off"
                    onChange={(event: { target: { value: string } }) => patch({ secret: event.target.value })}
                  />
                </Field>
              </>
            )}
            <DisclosureRow
              icon={<IconGlobeOutlineRegular size={14} />}
              title={t('remote.connect.advanced')}
              open={advancedOpen}
              expandable
              onToggle={() => {
                const next = !advancedOpen
                setAdvancedOpen(next)
              }}
              expandOnRowClick
            >
              <div className="dsh-rw-fields">
                <p className="dsh-rw-hint">{t('remote.connect.advanced.hint')}</p>
                <Field label={t('remote.connect.dshHome')} hint={t('remote.connect.dshHomeHint')}>
                  <input
                    className="dsh-rw-rename-input"
                    value={dialog.dshHome}
                    disabled={submitting}
                    placeholder="/home/tester/.dsh"
                    onChange={(event: { target: { value: string } }) => patch({ dshHome: event.target.value })}
                  />
                </Field>
                <div className="dsh-rw-local-model dsh-rw-local-source" data-testid="dsh-rw-model-source">
                  <Field label={t('connect.local.title')}>
                    <SegmentedControl<'local' | 'server'>
                      id="dsh-rw-connect-model-source"
                      value={dialog.modelSource}
                      disabled={submitting}
                      label={t('connect.local.title')}
                      options={[
                        { value: 'local', label: t('connect.local.source.local') },
                        { value: 'server', label: t('connect.local.source.server') },
                      ]}
                      onChange={(next) => patch({ modelSource: next })}
                    />
                  </Field>
                  {dialog.modelSource === 'server' ? (
                    <p className="dsh-rw-hint">{t('connect.local.serverHint')}</p>
                  ) : (
                    <p className="dsh-rw-hint" data-testid="dsh-rw-local-auto-hint">
                      {t('connect.local.auto.forwardAll')}
                    </p>
                  )}
                </div>
              </div>
            </DisclosureRow>
            {configError !== undefined && <p className="dsh-rw-side-error">{configError}</p>}
          </div>
        )}

        {current === 'connect' && (
          <div className="dsh-rw-section">
            <div className="dsh-rw-connect-identity" aria-label={t('remote.connect.identity')}>
              <div className="dsh-rw-connect-identity-item">
                <span>{t('remote.connect.label')}</span>
                <strong>{dialog.label.trim() === '' ? '—' : dialog.label}</strong>
              </div>
              <div className="dsh-rw-connect-identity-item">
                <span>{t('remote.connect.host')}</span>
                <strong>{dialog.host.trim() === '' ? '—' : `${dialog.host}:${dialog.port || '22'}`}</strong>
              </div>
              <div className="dsh-rw-connect-identity-item">
                <span>{t('remote.connect.username')}</span>
                <strong>{dialog.username.trim() === '' ? '—' : dialog.username}</strong>
              </div>
              <div className="dsh-rw-connect-identity-item">
                <span>{t('remote.connect.authKind')}</span>
                <strong>{dialog.authKind === 'password' ? t('remote.connect.auth.password') : dialog.authKind === 'privateKey' ? t('remote.connect.auth.privateKey') : t('remote.connect.auth.agent')}</strong>
              </div>
              <div className="dsh-rw-connect-identity-item dsh-rw-connect-identity-wide">
                <span>{t('remote.connect.dshHome')}</span>
                <strong>{dialog.dshHome || t('remote.connect.dshHomeDefault')}</strong>
              </div>
            </div>
            <h3 className="dsh-rw-section-title">{t('connect.deploy.title')}</h3>
            {progressReadError !== undefined && (
              <p className="dsh-rw-side-error" role="alert" data-testid="dsh-rw-progress-error">
                {progressReadError}
              </p>
            )}
            {submitting && progress.length === 0 && (
              <p className="dsh-rw-hint" data-testid="dsh-rw-progress-waiting">
                {t('connect.progress.waiting')}
              </p>
            )}
            <div className="dsh-rw-progress">
              {PROGRESS_STEPS.map(item => {
                const event = [...progress].reverse().find(candidate => candidate.step === item)
                const status = event?.status ?? 'pending'
                return (
                  <div className="dsh-rw-progress-entry" key={item}>
                    <div className="dsh-rw-progress-row" data-progress={status}>
                      <span className="dsh-rw-progress-dot">
                        <StateDot state={status === 'running' ? 'ongoing' : status === 'ok' || status === 'skipped' ? 'done' : status === 'failed' ? 'error' : 'idle'} />
                      </span>
                      <span className="dsh-rw-progress-text">
                        <span className="dsh-rw-progress-title">
                          {t(PROGRESS_LABELS[item])}
                          <span className="dsh-rw-progress-status">{t(PROGRESS_STATUS[status])}</span>
                        </span>
                        {event !== undefined && event.message !== '' && (
                          <span className="dsh-rw-progress-message">{event.message}</span>
                        )}
                      </span>
                    </div>
                    {item === 'connect' && hostKey && (
                      <div className="dsh-rw-hostkey-inline" role="alert">
                        <p>{t('remote.connect.hostkeyMessage')}</p>
                        <code className="dsh-rw-mono">{dialog.fingerprint}</code>
                        <p className="dsh-rw-hint">{t('remote.connect.hostkeyHint')}</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {progress.length > 0 && (
              <div className="dsh-rw-log" data-testid="dsh-rw-connect-log">
                <div className="dsh-rw-log-head">
                  <span>{t('connect.log.title')}</span>
                  <span className="dsh-rw-log-count">{progress.length}</span>
                </div>
                <div className="dsh-rw-log-body">
                  {progress.map((event, index) => (
                    <div className="dsh-rw-log-line" key={`${event.at}-${index}`} data-level={event.status === 'failed' ? 'error' : event.status === 'ok' ? 'ok' : undefined}>
                      <span className="dsh-rw-log-time">{new Date(event.at).toLocaleTimeString()}</span>
                      <span className="dsh-rw-log-text">{event.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="dsh-rw-hint">{t('connect.deploy.hint')}</p>
            {submitting && <p className="dsh-rw-hint" role="status">{t('remote.connect.deploying')}</p>}
            {dialog.error !== undefined && <p className="dsh-rw-side-error">{dialog.error.message}</p>}
          </div>
        )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** Every dialog the rail owns (all portalled by the shell's Modal). */
export function RemoteDialogs(): ReactElement | null {
  const state = useRemoteAppState()
  return (
    <>
      <ConnectDialog state={state} />
      {state.forgetTarget !== undefined && (
        <Modal
          open
          onClose={closeForgetTarget}
          title={t('tree.forget.confirm.title')}
          description={t('tree.forget.confirm.message', { label: state.forgetTarget.label, count: 0 })}
          closeLabel={t('remote.dialog.cancel')}
          footer={(
            <>
              <Button variant="outline" onClick={closeForgetTarget} disabled={state.pending}>
                {t('remote.dialog.cancel')}
              </Button>
              <Button variant="primary" onClick={() => { void submitForgetTarget() }} disabled={state.pending}>
                {t('list.forget')}
              </Button>
            </>
          )}
        >
          <span />
        </Modal>
      )}
    </>
  )
}
