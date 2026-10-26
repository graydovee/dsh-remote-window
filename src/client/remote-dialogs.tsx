/**
 * v1 remote dialogs: add/remove/rename, archive confirmation, execution-end
 * settings (D20) and profile-restart confirmation.
 *
 * They are rendered by the remote tree (the sidebar section is the primary
 * host), using the same primitives as the shell's own dialogs. Every dialog is
 * driven by `remote-store` state and performs one P3 command; none of them
 * keeps a second copy of server data.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Button, DisclosureRow, IconGlobeOutlineRegular, Modal, SegmentedControl, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { api, type DirEntry, type SshAlias } from './api.ts'
import { Field } from './common.tsx'
import { remoteApi, type ConnectProgressEvent, type ConnectProgressStep } from './remote-api.ts'
import { summarizeModeSwitch } from './executor.ts'
import { LOCAL_MODE_READY } from './remote-store.ts'
import { t } from './locales.ts'
import {
  applyModeSwitch, browseAddWorkspace, cancelModeSwitch, cancelProfileRestart, closeAddWorkspace,
  closeConnectDialog, setAddWorkspacePath,
  closeArchiveActivity, closeDeleteWorkspace, closeForgetTarget, closeModeDialog, closeRenameSession,
  closeRenameWorkspace, confirmArchiveActivity, confirmProfileRestart, modeDialogFor,
  previewModeSwitch, setAddWorkspaceTitle, setRenameSessionValue, setRenameWorkspaceValue,
  patchConnectDialog, submitAddWorkspace, submitConnectDialog, submitDeleteWorkspace,
  submitForgetTarget, submitRenameSession, submitRenameWorkspace, useRemoteAppState,
} from './remote-store.ts'
import type { RemoteAppState, RemoteConnectionView } from './remote-store.ts'

/** Sort a directory listing: directories first, then names. */
function sortedEntries(entries: readonly DirEntry[]): DirEntry[] {
  return [...entries].sort((left, right) => {
    const leftDirectory = left.type === 'directory' ? 0 : 1
    const rightDirectory = right.type === 'directory' ? 0 : 1
    if (leftDirectory !== rightDirectory) return leftDirectory - rightDirectory
    return left.name.localeCompare(right.name, 'zh-Hans-CN')
  })
}

/** Three-step v1 connection wizard: method → SSH identity → connect/deploy. */
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
  failed: 'connect.status.failed',
} as const

function ConnectDialog(props: { state: RemoteAppState }): ReactElement | null {
  const dialog = props.state.connectDialog
  const [step, setStep] = useState<ConnectStep>('method')
  const [aliases, setAliases] = useState<SshAlias[]>([])
  const [aliasWarnings, setAliasWarnings] = useState<string[]>([])
  const [aliasesLoading, setAliasesLoading] = useState(false)
  const [aliasesLoaded, setAliasesLoaded] = useState(false)
  const [aliasChoice, setAliasChoice] = useState('')
  const [configError, setConfigError] = useState<string | undefined>(undefined)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [progress, setProgress] = useState<ConnectProgressEvent[]>([])
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
    if (step !== 'connect') return
    if (props.state.connectDialog?.phase !== 'idle') return
    void submitConnectDialog()
  }, [step, props.state.connectDialog?.phase])
  const attemptId = props.state.connectDialog?.attemptId
  useEffect(() => {
    if (attemptId === undefined) {
      setProgress([])
      return
    }
    let stopped = false
    const tick = async (): Promise<void> => {
      try {
        const result = await remoteApi.connectProgress(attemptId)
        if (!stopped) setProgress(result.events)
      } catch {}
    }
    setProgress([])
    void tick()
    const timer = setInterval(() => { void tick() }, 300)
    return () => { stopped = true; clearInterval(timer) }
  }, [attemptId])
  if (dialog === undefined) return null
  const current = dialog.phase === 'hostkey' ? 'connect' : step
  const currentIndex = CONNECT_STEPS.indexOf(current)
  const submitting = dialog.phase === 'submitting'
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
              <button
                type="button"
                className="dsh-rw-method"
                data-selected="true"
                aria-pressed
                aria-label={t('method.ssh.aria')}
                onClick={() => { setStep('config') }}
              >
                <span className="dsh-rw-method-name">{t('method.ssh.name')}</span>
                <span className="dsh-rw-method-description">{t('method.ssh.description')}</span>
              </button>
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
                    onChange={(event: { target: { value: string } }) => patch({ privateKeyPath: event.target.value })}
                  />
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
              onToggle={() => { setAdvancedOpen(open => !open) }}
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
            <div className="dsh-rw-progress">
              {PROGRESS_STEPS.map(item => {
                const event = [...progress].reverse().find(candidate => candidate.step === item)
                const status = event?.status ?? 'pending'
                return (
                  <div className="dsh-rw-progress-entry" key={item}>
                    <div className="dsh-rw-progress-row" data-progress={status}>
                      <span className="dsh-rw-progress-dot">
                        <StateDot state={status === 'running' ? 'ongoing' : status === 'ok' ? 'done' : status === 'failed' ? 'error' : 'idle'} />
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

/** The add-workspace directory browser. */
function AddWorkspaceDialog(props: { state: RemoteAppState }): ReactElement | null {
  const dialog = props.state.addWorkspace
  const [newDirName, setNewDirName] = useState('')
  const [mkdirPending, setMkdirPending] = useState(false)
  const [mkdirError, setMkdirError] = useState<string | undefined>(undefined)
  if (dialog === undefined) return null
  const createDirectory = async (): Promise<void> => {
    const name = newDirName.trim()
    if (name === '' || dialog.listing === undefined) return
    if (name.includes('/')) { setMkdirError(t('remote.addWorkspace.dirNameInvalid')); return }
    setMkdirPending(true)
    setMkdirError(undefined)
    try {
      const base = dialog.listing.path.replace(/\/+$/u, '')
      await remoteApi.mkdir(dialog.targetId, `${base}/${name}`)
      setNewDirName('')
      await browseAddWorkspace(dialog.listing.path, { preservePath: true })
    } catch (error) {
      setMkdirError(error instanceof Error ? error.message : String(error))
    } finally {
      setMkdirPending(false)
    }
  }
  const entries = dialog.listing === undefined ? [] : sortedEntries(dialog.listing.entries)
  const parent = dialog.listing?.parent
  const typedPath = dialog.path ?? ''
  const slash = typedPath.lastIndexOf('/')
  const typedBase = slash >= 0 ? typedPath.slice(0, slash + 1) : ''
  const typedPrefix = slash >= 0 ? typedPath.slice(slash + 1) : typedPath
  const sameBase = dialog.listing !== undefined
    && typedBase.replace(/\/+$/u, '') === dialog.listing.path.replace(/\/+$/u, '')
  const visibleEntries = sameBase && typedPrefix !== ''
    ? entries.filter(entry => entry.name.toLowerCase().startsWith(typedPrefix.toLowerCase()))
    : entries
  return (
    <Modal
      open
      onClose={closeAddWorkspace}
      className="dsh-rw-addworkspace-modal"
      contentClassName="dsh-rw-addworkspace-content"
      title={t('remote.addWorkspace.title')}
      description={t('remote.addWorkspace.description', { label: dialog.targetLabel })}
      closeLabel={t('remote.addWorkspace.close')}
      footer={(
        <div className="dsh-rw-footer-actions">
          <span className="dsh-rw-footer-group">
            <Button variant="ghost" onClick={closeAddWorkspace} disabled={dialog.creating}>
              {t('remote.addWorkspace.close')}
            </Button>
          </span>
          <span className="dsh-rw-footer-group">
            <Button
              variant="primary"
              disabled={dialog.creating || dialog.loading || dialog.path === undefined}
              onClick={() => { void submitAddWorkspace() }}
            >
              {dialog.creating ? t('remote.addWorkspace.creating') : t('remote.addWorkspace.create')}
            </Button>
          </span>
        </div>
      )}
    >
      <div className="dsh-rw-add-workspace">
        <Field label={t('remote.addWorkspace.pathLabel')} hint={t('remote.addWorkspace.pathHint')}>
          <input
            className="dsh-rw-rename-input"
            value={dialog.path ?? ''}
            disabled={dialog.creating}
            placeholder="/home/tester/projects"
            onChange={(event: { target: { value: string } }) => {
              const next = event.target.value
              setAddWorkspacePath(next)
              if (next.endsWith('/')) void browseAddWorkspace(next, { preservePath: true })
            }}
            onKeyDown={(event: { key: string; preventDefault(): void }) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              if (dialog.path !== undefined && dialog.path !== '') void browseAddWorkspace(dialog.path)
            }}
          />
        </Field>
        <div className="dsh-rw-add-path">{dialog.path ?? '…'}</div>
        <div className="dsh-rw-mkdir">
          <input
            className="dsh-rw-rename-input"
            value={newDirName}
            disabled={mkdirPending}
            placeholder={t('remote.addWorkspace.dirNamePlaceholder')}
            aria-label={t('remote.addWorkspace.dirName')}
            onChange={(event: { target: { value: string } }) => { setNewDirName(event.target.value); setMkdirError(undefined) }}
            onKeyDown={(event: { key: string; preventDefault(): void }) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void createDirectory()
            }}
          />
          <Button variant="outline" size="sm" disabled={mkdirPending || newDirName.trim() === '' || dialog.listing === undefined} onClick={() => { void createDirectory() }}>
            {mkdirPending ? t('remote.addWorkspace.dirCreating') : t('remote.addWorkspace.dirCreate')}
          </Button>
        </div>
        {mkdirError !== undefined && <p className="dsh-rw-side-error">{mkdirError}</p>}
        <div className="dsh-rw-dir-list">
          {parent !== undefined && (
            <button type="button" className="dsh-rw-dir-row" onClick={() => { void browseAddWorkspace(parent) }}>
              <span className="dsh-rw-dir-name">{t('remote.addWorkspace.parent')}</span>
            </button>
          )}
          {visibleEntries.map(entry => (
            <button
              key={entry.path}
              type="button"
              className="dsh-rw-dir-row"
              data-type={entry.type}
              disabled={entry.type !== 'directory'}
              onClick={() => { void browseAddWorkspace(entry.path) }}
            >
              <span className="dsh-rw-dir-name">{entry.name}</span>
              <span className="dsh-rw-dir-kind">{entry.type}</span>
            </button>
          ))}
          {dialog.loading && <p className="dsh-rw-hint">{t('remote.addWorkspace.loading')}</p>}
          {!dialog.loading && visibleEntries.length === 0 && <p className="dsh-rw-hint">{t('remote.addWorkspace.empty')}</p>}
        </div>
        <div className="dsh-rw-field">
          <span className="dsh-rw-field-label">{t('remote.addWorkspace.titleLabel')}</span>
          <input
            className="dsh-rw-rename-input"
            value={dialog.title}
            disabled={dialog.creating}
            aria-label={t('remote.addWorkspace.titleLabel')}
            onChange={(event: { target: { value: string } }) => setAddWorkspaceTitle(event.target.value)}
          />
          <span className="dsh-rw-field-hint">{t('remote.addWorkspace.titleHint')}</span>
        </div>
        {dialog.error !== undefined && (
          <p className="dsh-rw-side-error">{t('remote.addWorkspace.failed', { message: dialog.error.message })}</p>
        )}
      </div>
    </Modal>
  )
}

/** Shared one-line input form body. */
function RenameForm(props: {
  label: string
  value: string
  pending: boolean
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}): ReactElement {
  const input = useRef<HTMLInputElement | null>(null)
  useEffect(() => { input.current?.focus() }, [])
  const submit = (): void => {
    if (props.value.trim() === '' || props.pending) return
    props.onSubmit()
  }
  return (
    <Modal
      open
      onClose={props.onCancel}
      title={props.label}
      closeLabel={t('remote.dialog.cancel')}
      footer={(
        <>
          <Button variant="outline" onClick={props.onCancel} disabled={props.pending}>
            {t('remote.dialog.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} disabled={props.pending || props.value.trim() === ''}>
            {t('remote.dialog.rename')}
          </Button>
        </>
      )}
    >
      <input
        ref={input}
        className="dsh-rw-rename-input"
        value={props.value}
        disabled={props.pending}
        placeholder={t('remote.rename.placeholder')}
        aria-label={props.label}
        onChange={(event: { target: { value: string } }) => props.onChange(event.target.value)}
        onKeyDown={(event: { key: string; preventDefault(): void }) => {
          if (event.key === 'Enter') { event.preventDefault(); submit() }
        }}
      />
    </Modal>
  )
}

/** Every dialog the remote tree owns. */
export function RemoteDialogs(): ReactElement | null {
  // The sidebar section is the single, always-present dialog host.
  const state = useRemoteAppState()
  const view = modeDialogFor(state)
  return (
    <>
      <ConnectDialog state={state} />
      <AddWorkspaceDialog state={state} />
      {state.renameWorkspace !== undefined && (
        <RenameForm
          label={t('remote.rename.workspace.title')}
          value={state.renameWorkspace.value}
          pending={state.pending}
          onChange={setRenameWorkspaceValue}
          onSubmit={() => { void submitRenameWorkspace() }}
          onCancel={closeRenameWorkspace}
        />
      )}
      {state.renameSession !== undefined && (
        <RenameForm
          label={t('remote.rename.session.title')}
          value={state.renameSession.value}
          pending={state.pending}
          onChange={setRenameSessionValue}
          onSubmit={() => { void submitRenameSession() }}
          onCancel={closeRenameSession}
        />
      )}
      {state.deleteWorkspace !== undefined && (
        <Modal
          open
          onClose={closeDeleteWorkspace}
          title={state.deleteWorkspace.force ? t('remote.workspace.removeForceTitle', { count: state.deleteWorkspace.sessionCount ?? '?' }) : t('remote.workspace.removeTitle')}
          description={state.deleteWorkspace.force
            ? t('remote.workspace.removeForceMessage')
            : t('remote.workspace.removeMessage', { title: state.deleteWorkspace.title, path: state.deleteWorkspace.path })}
          closeLabel={t('remote.dialog.cancel')}
          footer={(
            <>
              <Button variant="outline" onClick={closeDeleteWorkspace} disabled={state.pending}>
                {t('remote.dialog.cancel')}
              </Button>
              <Button variant="primary" onClick={() => { void submitDeleteWorkspace() }} disabled={state.pending}>
                {state.deleteWorkspace.force ? t('remote.workspace.removeForce') : t('remote.workspace.remove')}
              </Button>
            </>
          )}
        >
          <span />
        </Modal>
      )}
      {state.archiveActivity !== undefined && (
        <Modal
          open
          onClose={closeArchiveActivity}
          title={t('remote.session.archiveBlocked')}
          closeLabel={t('remote.dialog.cancel')}
          footer={(
            <>
              <Button variant="outline" onClick={closeArchiveActivity} disabled={state.pending}>
                {t('remote.dialog.cancel')}
              </Button>
              <Button variant="primary" onClick={() => { void confirmArchiveActivity() }} disabled={state.pending}>
                {t('remote.session.archiveStop')}
              </Button>
            </>
          )}
        >
          <p className="dsh-rw-hint">
            {t('remote.session.archiveActivities', {
              activities: state.archiveActivity.activities === undefined
                ? state.archiveActivity.title
                : state.archiveActivity.activities.join(' · '),
            })}
          </p>
        </Modal>
      )}
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
      {view !== undefined && <ModeDialog state={state} view={view} />}
      <RestartDialog state={state} />
    </>
  )
}

/** The execution-end settings + D20 confirmation dialog. */
function ModeDialog(props: { state: RemoteAppState; view: RemoteConnectionView }): ReactElement | null {
  const { state, view } = props
  const targetId = view.target.id
  const modeSwitch = view.modeSwitch
  const preview = modeSwitch.preview
  const summary = preview === undefined ? undefined : summarizeModeSwitch(preview)
  if (modeSwitch.phase === 'confirming' && summary !== undefined) {
    return (
      <Modal
        open
        onClose={() => cancelModeSwitch(targetId)}
        title={t('remote.mode.confirmTitle')}
        closeLabel={t('remote.dialog.cancel')}
        footer={(
          <>
            <Button variant="outline" onClick={() => cancelModeSwitch(targetId)}>
              {t('remote.dialog.cancel')}
            </Button>
            <Button variant="primary" onClick={() => { void applyModeSwitch(targetId) }}>
              {t('remote.mode.confirm')}
            </Button>
          </>
        )}
      >
        <div className="dsh-rw-mode-confirm">
          {summary.currentTurn !== undefined && <p>{t('remote.mode.confirmCurrent')}</p>}
          {summary.otherActiveTurns.length > 0 && (
            <>
              <p>{t('remote.mode.confirmOthers', { count: summary.otherActiveTurns.length })}</p>
              <ul>
                {summary.otherActiveTurns.map(turn => (
                  <li key={turn.sessionId}>
                    {t('remote.mode.confirmItem', {
                      title: turn.title ?? t('remote.mode.confirmUntitled'),
                      id: turn.sessionId,
                    })}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </Modal>
    )
  }
  const failed = modeSwitch.phase === 'failed'
  return (
    <Modal
      open
      onClose={() => closeModeDialog(targetId)}
      title={t('remote.mode.switchMenu')}
      closeLabel={t('remote.dialog.cancel')}
      footer={(
        <Button variant="outline" onClick={() => closeModeDialog(targetId)} disabled={modeSwitch.phase === 'applying'}>
          {t('remote.dialog.cancel')}
        </Button>
      )}
    >
      <div className="dsh-rw-mode-dialog">
        <p className="dsh-rw-hint">{t('remote.mode.current', {
          mode: t(view.mode === 'server' ? 'remote.mode.server' : 'remote.mode.local'),
        })}</p>
        <p className="dsh-rw-hint">
          {t(view.mode === 'server' ? 'remote.mode.credentials.server' : 'remote.mode.credentials.local')}
        </p>
        <div className="dsh-rw-mode-actions">
          <Button
            variant={view.mode === 'server' ? 'primary' : 'outline'}
            disabled={!LOCAL_MODE_READY || view.mode === 'server' || modeSwitch.phase === 'previewing' || modeSwitch.phase === 'applying'}
            onClick={() => { void previewModeSwitch(targetId, 'server') }}
          >
            {t('remote.mode.server')}
          </Button>
          <Button
            variant={view.mode === 'local' ? 'primary' : 'outline'}
            disabled={!LOCAL_MODE_READY || view.mode === 'local' || modeSwitch.phase === 'previewing' || modeSwitch.phase === 'applying'}
            onClick={() => { void previewModeSwitch(targetId, 'local') }}
          >
            {t('remote.mode.local')}
          </Button>
        </div>
        {!LOCAL_MODE_READY && <p className="dsh-rw-hint">{t('remote.mode.pending')}</p>}
        {state.selection?.targetId !== targetId && <p className="dsh-rw-hint">{t('remote.mode.selectSessionFirst')}</p>}
        {modeSwitch.phase === 'ready' && (
          <Button variant="primary" onClick={() => { void applyModeSwitch(targetId) }}>
            {t('remote.mode.apply')}
          </Button>
        )}
        {modeSwitch.phase === 'previewing' && <p className="dsh-rw-hint">{t('remote.mode.switching')}</p>}
        {modeSwitch.phase === 'applying' && (
          <p className="dsh-rw-hint">
            {t('remote.mode.switching')}
            {modeSwitch.progressPhase === undefined ? '' : ` (${modeSwitch.progressPhase})`}
          </p>
        )}
        {modeSwitch.phase === 'done' && <p className="dsh-rw-hint">{t('remote.mode.switched', {
          mode: t(modeSwitch.nextMode === 'local' ? 'remote.mode.local' : 'remote.mode.server'),
        })}</p>}
        {failed && (
          <>
            <p className="dsh-rw-side-error">
              {t('remote.mode.previewFailed', { message: modeSwitch.error?.message ?? '' })}
            </p>
            {modeSwitch.nextMode !== undefined && (
              <Button
                variant="outline"
                onClick={() => { void previewModeSwitch(targetId, modeSwitch.nextMode!) }}
              >
                {t('remote.mode.retry')}
              </Button>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

/** Profile-restart confirmation (D20), shown when a preview is pending. */
function RestartDialog(props: { state: RemoteAppState }): ReactElement | null {
  const entry = Object.values(props.state.connections).find(view => view.restart.phase === 'confirming')
  if (entry === undefined || entry.restart.preview === undefined) return null
  const preview = entry.restart.preview
  return (
    <Modal
      open
      onClose={() => cancelProfileRestart(entry.target.id)}
      title={t('remote.restart.title')}
      closeLabel={t('remote.dialog.cancel')}
      footer={(
        <>
          <Button variant="outline" onClick={() => cancelProfileRestart(entry.target.id)}>
            {t('remote.dialog.cancel')}
          </Button>
          <Button variant="primary" onClick={() => { void confirmProfileRestart(entry.target.id) }}>
            {t('remote.restart.confirm')}
          </Button>
        </>
      )}
    >
      <div className="dsh-rw-mode-confirm">
        {preview.activeTurns.length === 0
          ? <p>{t('remote.restart.none')}</p>
          : <p>{t('remote.restart.message', { count: preview.activeTurns.length })}</p>}
        {preview.activeTurns.length > 0 && (
          <ul>
            {preview.activeTurns.map(turn => (
              <li key={turn.sessionId}>{turn.title ?? turn.sessionId}</li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
