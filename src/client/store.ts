/**
 * The plugin's browser app model: one module-level `useSyncExternalStore`
 * store shared by the sidebar panel row and the inline wizard page.
 *
 * Slot entries are registered independently, so React context cannot carry
 * state between them; a module-level store can (and it survives a hot-reload
 * `apply`, while every side effect it owns is still disposed through
 * `ctx.effect` → {@link dispose}).
 *
 * Secret handling: a submitted secret lives only in the module-level
 * {@link pendingSecret} closure (never in the rendered snapshot, never in a
 * URL) so a retry can reuse it while an input can never render it back.
 */
import { useSyncExternalStore } from 'react'
import {
  api, openConnectStream, toWireError,
} from './api.ts'
import type {
  AuthKind, ConnectFrame, ConnectStartRequest, ConnectStep, DirEntry, ListDirResult,
  PublicTarget, RemoteRuntimeInput, RemoteWorkspace, SshAlias, WireError,
} from './api.ts'
import type { ClientContext } from './context.ts'
import { t } from './locales.ts'
import type { LocaleKey } from './locales.ts'

/** Which wizard step is showing. */
export type WizardStep = 'method' | 'config' | 'connecting' | 'directory'

/** Which surface the overlay shows. */
export type WizardView = 'list' | 'wizard'

/** Connection-method card. Only `ssh` is selectable in v1. */
export type ConnectionMethod = 'ssh' | 'docker' | 'wsl'

/** The four progress rows, in server order. */
export const CONNECT_STEPS: readonly ConnectStep[] = ['connect', 'probe', 'runtime', 'upload', 'start']

/** Editable connection draft (step 2). */
export interface ConnectDraft {
  label: string
  host: string
  port: string
  username: string
  authKind: AuthKind
  /** Password / key passphrase. Cleared from the snapshot right after submit. */
  secret: string
  privateKeyPath: string
  sshConfigAlias?: string
  nodePath: string
  dshCommand: string
  profile: string
  dshHome: string
  /** Server-package source for this target; '' = follow the global policy. */
  packageSource: '' | 'download' | 'upload'
}

/** One progress row's state. */
export interface StepState {
  status: 'pending' | 'running' | 'ok' | 'failed'
  message?: string
  detail?: string
}

/** The host-key confirmation the server is waiting on. */
export interface HostKeyPrompt {
  fingerprint: string
  algorithm?: string
  answering: boolean
  trusted: boolean
}

/** One timestamped line of the connection log (ZCode-style live log). */
export interface ConnectLogLine {
  readonly time: string
  readonly level: 'info' | 'ok' | 'error'
  readonly text: string
}

/** Connection attempt state (step 3). */
export interface ConnectState {
  phase: 'idle' | 'running' | 'awaiting-hostkey' | 'failed' | 'succeeded'
  /** Which flow owns this attempt: the wizard, or a directory-open reconnect. */
  origin: 'wizard' | 'directory'
  ticket?: string
  steps: Record<ConnectStep, StepState>
  /** Live connection log, oldest first, capped. */
  readonly log: ConnectLogLine[]
  hostKey?: HostKeyPrompt
  target?: PublicTarget
  error?: WireError
}

/** Remote directory browser state (step 4). */
export interface DirectoryState {
  targetId?: string
  listing?: ListDirResult
  loading: boolean
  /** Slow operation: the channel is being (re)established — show 连接中. */
  connecting: boolean
  creating: boolean
  error?: WireError
  newDirName: string
  title: string
  /** Whether the user edited the workspace title (navigation then keeps it). */
  titleTouched: boolean
  pathInput: string
}

/** A transient success/failure notice rendered as the official `Toast`. */
export interface Notice {
  kind: 'success' | 'error'
  text: string
}

/** The complete rendered snapshot. */
export interface AppState {
  open: boolean
  view: WizardView
  step: WizardStep
  method: ConnectionMethod
  config: ConnectDraft
  aliases: SshAlias[]
  aliasWarnings: string[]
  aliasesLoading: boolean
  aliasesLoaded: boolean
  prefilling: boolean
  targets: PublicTarget[]
  workspaces: RemoteWorkspace[]
  pluginVersion: string
  defaultProfile: string
  stateLoaded: boolean
  stateLoading: boolean
  /** A primary command is in flight (primary buttons disable). */
  pending: boolean
  /** Whether a submitted secret is still held for a retry (never the secret itself). */
  secretPending: boolean
  error?: WireError
  notice?: Notice
  connect: ConnectState
  directory: DirectoryState
  /** Fingerprint the user trusted, scoped to the host it was confirmed for. */
  trusted?: { host: string; port: number; username: string; fingerprint: string }
}

/** Log lines kept per attempt; older lines fall off the head. */
const CONNECT_LOG_LIMIT = 400

/** Lines that report continuous progress (`upload progress (node): 42.0% …`)
 *  collapse into one live row per key instead of flooding the log. */
const PROGRESS_PREFIX = /^(upload progress \([^)]*\)|download progress):/

/**
 * Run a directory-plane operation, flipping `connecting` when it outlives
 * `delay` — the point where a plain read has become a channel (re)build, which
 * can take seconds. The UI then shows 连接中 instead of a bare reading line.
 */
async function withConnecting<T>(run: () => Promise<T>): Promise<T> {
  const timer = setTimeout(() => {
    commit(previous => ({ directory: { ...previous.directory, connecting: true } }))
  }, 1_200)
  try {
    return await run()
  } finally {
    clearTimeout(timer)
    commit(previous => previous.directory.connecting ? { directory: { ...previous.directory, connecting: false } } : {})
  }
}

/** Append one line to the current attempt's live log. */
function appendLog(level: ConnectLogLine['level'], text: string): void {
  const line: ConnectLogLine = {
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    level,
    text,
  }
  const previous = state.connect.log
  const last = previous[previous.length - 1]
  const progressKey = PROGRESS_PREFIX.exec(text)?.[0]
  if (progressKey !== undefined && last !== undefined && PROGRESS_PREFIX.exec(last.text)?.[0] === progressKey) {
    // Same progress stream: replace the previous row (ZCode collapses these too).
    const log = [...previous.slice(0, -1), line]
    commit({ connect: { ...state.connect, log } })
    return
  }
  const log = [...previous, line]
  commit({ connect: { ...state.connect, log: log.length > CONNECT_LOG_LIMIT ? log.slice(log.length - CONNECT_LOG_LIMIT) : log } })
}

function emptySteps(): Record<ConnectStep, StepState> {
  return {
    connect: { status: 'pending' },
    probe: { status: 'pending' },
    runtime: { status: 'pending' },
    upload: { status: 'pending' },
    start: { status: 'pending' },
  }
}

function idleConnect(): ConnectState {
  return { phase: 'idle', origin: 'wizard', steps: emptySteps(), log: [] }
}

function emptyDirectory(): DirectoryState {
  return { loading: false, creating: false, newDirName: '', title: '', titleTouched: false, pathInput: '',
  connecting: false,
  }
}

function emptyDraft(): ConnectDraft {
  return {
    label: '',
    host: '',
    port: '22',
    username: '',
    authKind: 'password',
    secret: '',
    privateKeyPath: '',
    nodePath: '',
    dshCommand: '',
    profile: '',
    dshHome: '',
    packageSource: '',
  }
}

function initialState(): AppState {
  return {
    open: false,
    view: 'list',
    step: 'method',
    method: 'ssh',
    config: emptyDraft(),
    aliases: [],
    aliasWarnings: [],
    aliasesLoading: false,
    aliasesLoaded: false,
    prefilling: false,
    targets: [],
    workspaces: [],
    pluginVersion: '',
    defaultProfile: '',
    stateLoaded: false,
    stateLoading: false,
    pending: false,
    secretPending: false,
    connect: idleConnect(),
    directory: emptyDirectory(),
  }
}

/* ------------------------------------------------------------------ store */

let state: AppState = initialState()
const listeners = new Set<() => void>()

/**
 * Monotonic id of the current overlay session. Every asynchronous action
 * captures it and drops its result when the session moved on (overlay closed,
 * new connection started, plugin disposed), so a late response can never
 * resurrect a dialog the user already left.
 */
let generation = 0

/** In-flight attempt's secret: deliberately outside the rendered snapshot. */
let pendingSecret: string | undefined

/** Closer of the live SSE stream, when one is open. */
let closeStream: (() => void) | undefined

function commit(patch: Partial<AppState> | ((previous: AppState) => Partial<AppState>)): void {
  const changes = typeof patch === 'function' ? patch(state) : patch
  if (changes === undefined || Object.keys(changes).length === 0) return
  state = { ...state, ...changes }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot(): AppState {
  return state
}

/** Snapshot hook for the button and the overlay. */
export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Whether the overlay is open. The footer button only needs this bit, and a
 * primitive snapshot keeps it from re-rendering on every SSE progress frame.
 */
export function useOverlayOpen(): boolean {
  return useSyncExternalStore(subscribe, () => state.open, () => state.open)
}

/** Number of saved remote items (badge on the footer button). */
export function useRemoteItemCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => state.targets.length + state.workspaces.length,
    () => state.targets.length + state.workspaces.length,
  )
}

/* ------------------------------------------------------------- derivations */

/**
 * Whether the overlay refuses to close right now: a connection attempt is
 * running or waiting for a host-key decision, and closing would orphan it.
 * @param current - the snapshot to inspect.
 */
export function isConnectBlocking(current: AppState): boolean {
  if (current.view !== 'wizard' || current.step !== 'connecting') return false
  return current.connect.phase === 'running' || current.connect.phase === 'awaiting-hostkey'
}

/** Sort directories first, then files, each alphabetically. */
export function sortEntries(entries: readonly DirEntry[]): DirEntry[] {
  return [...entries].sort((left, right) => {
    const leftDirectory = left.type === 'directory' ? 0 : 1
    const rightDirectory = right.type === 'directory' ? 0 : 1
    if (leftDirectory !== rightDirectory) return leftDirectory - rightDirectory
    return left.name.localeCompare(right.name, 'zh-Hans-CN')
  })
}

/** Last path segment, for a default workspace title. */
export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  const name = index === -1 ? trimmed : trimmed.slice(index + 1)
  return name === '' ? '/' : name
}

/** Join a directory path with one child name. */
export function joinPath(base: string, name: string): string {
  return base === '' || base === '/' ? `/${name}` : `${base.replace(/\/+$/, '')}/${name}`
}

/* ---------------------------------------------------------------- helpers */

function validation(messageKey: LocaleKey): WireError {
  return { code: 'invalid', message: t(messageKey) }
}

/** Validate everything but the secret; the secret is resolved separately. */
function validateDraft(draft: ConnectDraft): WireError | undefined {
  if (draft.label.trim() === '') return validation('config.alias.required')
  if (draft.host.trim() === '') return validation('config.host.required')
  const port = Number(draft.port.trim())
  if (!Number.isInteger(port) || port < 1 || port > 65535) return validation('config.port.invalid')
  if (draft.username.trim() === '') return validation('config.username.required')
  return undefined
}

/** Resolve the secret to send, reusing the in-flight one on a retry. */
function resolveSecret(draft: ConnectDraft): { ok: true; secret?: string } | { ok: false; error: WireError } {
  if (draft.authKind === 'agent') return { ok: true }
  if (draft.authKind === 'privateKey') {
    if (draft.privateKeyPath.trim() === '') return { ok: false, error: validation('config.secret.privateKey.required') }
    const passphrase = draft.secret !== '' ? draft.secret : pendingSecret
    return passphrase === undefined || passphrase === '' ? { ok: true } : { ok: true, secret: passphrase }
  }
  const password = draft.secret !== '' ? draft.secret : pendingSecret
  if (password === undefined || password === '') return { ok: false, error: validation('config.secret.password.required') }
  return { ok: true, secret: password }
}

/** Non-empty remote-runtime overrides only. */
function buildRemote(draft: ConnectDraft): RemoteRuntimeInput | undefined {
  const remote: RemoteRuntimeInput = {}
  if (draft.nodePath.trim() !== '') remote.nodePath = draft.nodePath.trim()
  if (draft.dshCommand.trim() !== '') remote.dshCommand = draft.dshCommand.trim()
  if (draft.profile.trim() !== '') remote.profile = draft.profile.trim()
  if (draft.dshHome.trim() !== '') remote.dshHome = draft.dshHome.trim()
  return Object.keys(remote).length === 0 ? undefined : remote
}

function stopStream(): void {
  const close = closeStream
  closeStream = undefined
  if (close !== undefined) close()
}

/**
 * Hold (or drop) the submitted secret outside the rendered snapshot.
 * @param value - the secret to reuse on a retry, or undefined to drop it.
 */
function setPendingSecret(value: string | undefined): void {
  pendingSecret = value
  commit({ secretPending: value !== undefined })
}

/** Localized time text for a saved row, or undefined when absent/unparseable. */
export function formatTimestamp(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

/* ---------------------------------------------------------------- actions */

/** The client context, bound in `apply`, for shell-owned services. */
let clientContext: ClientContext | undefined

/** Capture the client context for {@link revealSession}. */
export function bindClientContext(ctx: ClientContext): void {
  clientContext = ctx
}

/**
 * Ask the shell to bring a just-opened session to the front. The shell owns
 * session navigation: `uiWorkspace.openSession` is how its own UI switches
 * conversations; without this the workspace opens silently and the user stays
 * on the plugin panel with only a toast.
 */
function revealSession(sessionId: string): void {
  try {
    const workspace = clientContext?.get('uiWorkspace') as { openSession?(id: string): void } | undefined
    if (workspace !== undefined && typeof workspace.openSession === 'function') workspace.openSession(sessionId)
  } catch (error) {
    console.error('[dsh-remote-workspace] revealSession failed', error)
  }
}

/** Read saved targets/workspaces (and auto-enter the wizard on a first run). */
async function refreshState(): Promise<void> {
  const gen = generation
  const firstLoad = !state.stateLoaded
  commit({ stateLoading: true })
  try {
    const value = await api.state()
    if (gen !== generation) return
    const hasSaved = value.targets.length > 0 || value.workspaces.length > 0
    commit({
      targets: value.targets,
      workspaces: value.workspaces,
      pluginVersion: value.pluginVersion,
      defaultProfile: value.defaultProfile,
      stateLoaded: true,
      stateLoading: false,
    })
    if (firstLoad && state.open && state.view === 'list' && !hasSaved) commit({ view: 'wizard', step: 'method' })
  } catch (error) {
    if (gen !== generation) return
    // A first frame can arrive while the plugin host is still opening its
    // storage; retry briefly instead of showing an empty panel that only a
    // manual 刷新 fixes.
    if (firstLoad) {
      for (let attempt = 1; attempt <= 4; attempt++) {
        await new Promise(resolve => setTimeout(resolve, attempt * 750))
        if (gen !== generation) return
        try {
          const value = await api.state()
          if (gen !== generation) return
          commit({
            targets: value.targets,
            workspaces: value.workspaces,
            pluginVersion: value.pluginVersion,
            defaultProfile: value.defaultProfile,
            stateLoaded: true,
            stateLoading: false,
          })
          return
        } catch {}
      }
    }
    commit({ stateLoading: false, stateLoaded: true, error: toWireError(error) })
  }
}

/**
 * Leave the wizard and return to the saved-items list; refused while a
 * connection attempt owns the flow.
 *
 * Named for the overlay days: the panel's 取消/关闭 buttons land here, so
 * leaving now also rewinds the view.
 */
function closeOverlay(): void {
  if (isConnectBlocking(state)) return
  generation += 1
  stopStream()
  setPendingSecret(undefined)
  commit({ open: false, view: 'list', error: undefined, notice: undefined, prefilling: false, pending: false })
}

/** Leave the list and start a fresh wizard run. */
function newConnection(): void {
  generation += 1
  stopStream()
  setPendingSecret(undefined)
  commit({
    view: 'wizard',
    step: 'method',
    error: undefined,
    notice: undefined,
    // A fresh run also releases any flag an abandoned request left behind.
    prefilling: false,
    pending: false,
    stateLoading: false,
    connect: idleConnect(),
    directory: emptyDirectory(),
  })
}

/** Switch the wizard to a step, loading that step's data. */
function setStep(step: WizardStep): void {
  // 连接中 is a *run state*, not a place to browse: entering it without a live
  // attempt would strand the wizard on a retry button wired to a stale draft.
  if (step === 'connecting' && state.connect.phase !== 'running' && state.connect.phase !== 'awaiting-hostkey') return
  commit({ step, error: undefined })
  if (step === 'config') void loadAliases()
}

/** Return to the saved-items list from any wizard step. */
function showList(): void {
  generation += 1
  stopStream()
  commit({ view: 'list', step: 'method', error: undefined, notice: undefined, prefilling: false, pending: false })
  void refreshState()
}

function setMethod(method: ConnectionMethod): void {
  if (method !== 'ssh') return
  commit({ method })
}

function patchConfig(patch: Partial<ConnectDraft>): void {
  setPendingSecret(undefined)
  // Editing the fields the alias resolved means the alias no longer describes
  // this connection (its ProxyJump/IdentityFile may not apply), so the marker
  // is dropped; picking the alias again re-establishes it.
  const clearsAlias = patch.host !== undefined || patch.port !== undefined || patch.username !== undefined
  commit((previous) => {
    const config: ConnectDraft = { ...previous.config, ...patch }
    if (clearsAlias) delete config.sshConfigAlias
    return { config }
  })
}

function dismissError(): void {
  commit({ error: undefined })
}

function dismissNotice(): void {
  commit({ notice: undefined })
}

/**
 * Observe the saved remote workspaces for the lifetime of the plugin fiber
 * (not the panel — the icon rules target sidebar rows that must survive
 * panel switches). Fires immediately and on every workspaces change.
 */
export function watchWorkspaces(apply: (ids: readonly string[]) => void): () => void {
  const run = () => {
    apply(state.workspaces.map((workspace) => workspace.officialWorkspaceId ?? '').filter((id) => id !== ''))
  }
  run()
  return subscribe(run)
}

/** Load `~/.ssh/config` aliases once per overlay session. */
async function loadAliases(force = false): Promise<void> {
  if (state.aliasesLoading) return
  if (state.aliasesLoaded && !force) return
  const gen = generation
  commit({ aliasesLoading: true })
  try {
    const value = await api.sshAliases()
    if (gen !== generation) return
    commit({ aliases: value.aliases, aliasWarnings: value.warnings, aliasesLoading: false, aliasesLoaded: true })
  } catch (error) {
    if (gen !== generation) return
    commit({ aliasesLoading: false, aliasesLoaded: true, error: toWireError(error) })
  }
}

/** Prefill host/port/user/key from one `~/.ssh/config` alias. */
async function chooseAlias(alias: string): Promise<void> {
  const gen = generation
  commit({ prefilling: true, error: undefined })
  try {
    const value = await api.aliasPrefill(alias)
    if (gen !== generation) {
      commit({ prefilling: false })
      return
    }
    setPendingSecret(undefined)
    const identityFile = value.identityFile !== undefined && value.identityFile !== ''
      ? value.identityFile
      : undefined
    commit(previous => ({
      prefilling: false,
      config: {
        ...previous.config,
        sshConfigAlias: value.alias,
        host: value.host,
        port: String(value.port),
        username: value.username !== undefined && value.username !== '' ? value.username : previous.config.username,
        privateKeyPath: identityFile ?? previous.config.privateKeyPath,
        authKind: identityFile === undefined ? previous.config.authKind : 'privateKey',
        label: previous.config.label.trim() === '' ? value.alias : previous.config.label,
        secret: '',
      },
    }))
  } catch (error) {
    if (gen !== generation) return
    commit({ prefilling: false, error: toWireError(error) })
  }
}

/** Start (or retry) the connection attempt behind `/api/connect/start`. */
async function startConnect(): Promise<void> {
  commit(previous => ({ connect: { ...previous.connect, origin: 'wizard' } }))
  const draft = state.config
  const invalid = validateDraft(draft)
  if (invalid !== undefined) {
    commit({ view: 'wizard', step: 'config', error: invalid })
    return
  }
  const resolved = resolveSecret(draft)
  if (!resolved.ok) {
    commit({ view: 'wizard', step: 'config', error: resolved.error })
    return
  }

  const host = draft.host.trim()
  const port = Number(draft.port.trim())
  const username = draft.username.trim()
  const request: ConnectStartRequest = {
    label: draft.label.trim(),
    host,
    port,
    username,
    authKind: draft.authKind,
  }
  if (resolved.secret !== undefined) request.secret = resolved.secret
  if (draft.authKind === 'privateKey') request.privateKeyPath = draft.privateKeyPath.trim()
  if (draft.sshConfigAlias !== undefined && draft.sshConfigAlias !== '') request.sshConfigAlias = draft.sshConfigAlias
  const trusted = state.trusted
  if (trusted !== undefined && trusted.host === host && trusted.port === port && trusted.username === username) {
    request.hostKeyFingerprint = trusted.fingerprint
  }
  const remote = buildRemote(draft)
  if (remote !== undefined) request.remote = remote
  if (draft.packageSource === 'download' || draft.packageSource === 'upload') request.packageSource = draft.packageSource

  setPendingSecret(resolved.secret)
  const gen = generation
  commit(previous => ({
    pending: true,
    view: 'wizard',
    step: 'connecting',
    error: undefined,
    notice: undefined,
    connect: { ...idleConnect(), phase: 'running', log: [{ time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), level: 'info' as const, text: `connecting to ${host}:${port} as ${username}` }] },
    config: { ...previous.config, secret: '' },
  }))

  try {
    const { ticket } = await api.connectStart(request)
    if (gen !== generation) {
      commit({ pending: false })
      return
    }
    commit(previous => ({ pending: false, connect: { ...previous.connect, phase: 'running', ticket } }))
    startStream(ticket, gen)
  } catch (error) {
    if (gen !== generation) return
    commit(previous => ({
      pending: false,
      connect: { ...previous.connect, phase: 'failed', error: toWireError(error) },
    }))
  }
}

function startStream(ticket: string, gen: number): void {
  stopStream()
  try {
    closeStream = openConnectStream(ticket, {
      onFrame: (frame) => {
        if (gen !== generation) return
        handleFrame(frame)
      },
      onTransportError: (message) => {
        if (gen !== generation) return
        stopStream()
        const phase = state.connect.phase
        if (phase === 'failed' || phase === 'succeeded') return
        commit(previous => ({
          connect: { ...previous.connect, phase: 'failed', error: { code: 'stream', message } },
        }))
      },
    })
  } catch (error) {
    commit(previous => ({
      connect: { ...previous.connect, phase: 'failed', error: toWireError(error) },
    }))
  }
}

function handleFrame(frame: ConnectFrame): void {
  switch (frame.type) {
    case 'step': {
      appendLog(frame.status === 'failed' ? 'error' : 'info', frame.message === undefined ? `${frame.step} ${frame.status}` : frame.message)
      commit(previous => ({
        connect: {
          ...previous.connect,
          steps: {
            ...previous.connect.steps,
            [frame.step]: {
              status: frame.status,
              ...(frame.message === undefined ? {} : { message: frame.message }),
              ...(frame.detail === undefined ? {} : { detail: frame.detail }),
            },
          },
        },
      }))
      return
    }
    case 'host-key': {
      appendLog('info', t('connect.log.hostKey', { fingerprint: frame.fingerprint }))
      commit(previous => ({
        connect: {
          ...previous.connect,
          phase: 'awaiting-hostkey',
          hostKey: {
            fingerprint: frame.fingerprint,
            ...(frame.algorithm === undefined ? {} : { algorithm: frame.algorithm }),
            answering: false,
            trusted: false,
          },
        },
      }))
      return
    }
    case 'done': {
      stopStream()
      setPendingSecret(undefined)
      const target = frame.target
      appendLog('ok', t('connect.log.done', { label: target.label }))
      const trusted = target.hostKeyFingerprint === ''
        ? state.trusted
        : { host: target.host, port: target.port, username: target.username, fingerprint: target.hostKeyFingerprint }
      commit(previous => ({
        step: 'directory',
        notice: { kind: 'success', text: t('connect.succeeded') },
        connect: { ...previous.connect, phase: 'succeeded', hostKey: undefined, target, error: undefined },
        directory: { ...emptyDirectory(), targetId: target.id },
        trusted: trusted ?? previous.trusted,
      }))
      void loadDirectory(target.id, '')
      void refreshState()
      return
    }
    case 'error': {
      appendLog('error', `${frame.code}: ${frame.message}`)
      stopStream()
      commit(previous => ({
        connect: { ...previous.connect, phase: 'failed', hostKey: undefined, error: { code: frame.code, message: frame.message } },
      }))
    }
  }
}

/** Accept the shown host-key fingerprint (never automatic). */
async function confirmHostKey(): Promise<void> {
  const { ticket, hostKey } = state.connect
  if (ticket === undefined || hostKey === undefined || hostKey.answering || hostKey.trusted) return
  commit(previous => ({
    connect: { ...previous.connect, hostKey: { ...hostKey, answering: true } },
    error: undefined,
  }))
  try {
    await api.hostkeyConfirm(ticket, hostKey.fingerprint)
    const draft = state.config
    commit(previous => ({
      trusted: {
        host: draft.host.trim(),
        port: Number(draft.port.trim()),
        username: draft.username.trim(),
        fingerprint: hostKey.fingerprint,
      },
      connect: {
        ...previous.connect,
        phase: 'running',
        hostKey: { ...hostKey, answering: false, trusted: true },
      },
    }))
  } catch (error) {
    commit(previous => ({
      error: toWireError(error),
      connect: { ...previous.connect, hostKey: { ...hostKey, answering: false } },
    }))
  }
}

/** Abandon a pending host-key prompt and return to the configuration step. */
function cancelConnect(): void {
  stopStream()
  // A reconnect owned by the directory flow has no wizard draft to return to.
  if (state.connect.origin === 'directory') {
    showList()
    return
  }
  commit({
    step: 'config',
    error: undefined,
    notice: undefined,
    connect: idleConnect(),
    directory: emptyDirectory(),
  })
}

/** Retry a directory-open reconnect from the 连接中 step. */
function retryDirectoryConnect(): void {
  const targetId = state.directory.targetId
  if (targetId === undefined) return
  commit(previous => ({
    error: undefined,
    connect: {
      ...previous.connect,
      phase: 'running',
      origin: 'directory',
      steps: { ...emptySteps(), connect: { status: 'running' } },
    },
  }))
  void loadDirectory(targetId, '', { promoteFromConnecting: true })
}

/** Browse one remote directory of the connected (or saved) target. */
async function loadDirectory(targetId: string, path: string, options?: { promoteFromConnecting?: boolean }): Promise<void> {
  const promote = options?.promoteFromConnecting === true
  const logLine = (text: string): void => {
    commit(previous => ({
      connect: {
        ...previous.connect,
        log: [...previous.connect.log, { time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), level: 'info' as const, text }],
      },
    }))
  }
  // Coarse, honest progress beats a frozen directory step: the host reports
  // nothing mid-flight, so these lines mark the stages we know it walks.
  const hints = promote
    ? [
        setTimeout(() => { logLine(t('connect.log.directoryProbe')) }, 1_500),
        setTimeout(() => { logLine(t('connect.log.directoryStart')) }, 4_000),
      ]
    : []
  return await withConnecting(async () => {
  const gen = generation
  commit(previous => ({
    directory: { ...previous.directory, targetId, loading: true, error: undefined },
  }))
  try {
    const listing = await api.listDir(targetId, path)
    if (gen !== generation) return
    for (const hint of hints) clearTimeout(hint)
    if (promote) {
      // Show the final line before promoting: committing both in the same tick
      // lets React coalesce them and the line never reaches the DOM.
      logLine(t('connect.log.directoryReady'))
      await new Promise(resolve => setTimeout(resolve, 120))
      if (gen !== generation) return
    }
    commit(previous => ({
      ...(promote ? { step: 'directory' as const, connect: { ...previous.connect, phase: 'succeeded' as const } } : {}),
      directory: {
        ...previous.directory,
        listing,
        loading: false,
        connecting: false,
        error: undefined,
        pathInput: listing.path,
        newDirName: '',
        title: previous.directory.titleTouched && previous.directory.title !== ''
          ? previous.directory.title
          : basename(listing.path),
      },
    }))
  } catch (error) {
    if (gen !== generation) return
    for (const hint of hints) clearTimeout(hint)
    commit(previous => ({
      ...(promote ? { step: 'directory' as const, connect: { ...previous.connect, phase: 'failed' as const } } : {}),
      directory: { ...previous.directory, loading: false, connecting: false, error: toWireError(error) },
    }))
  }
  })
}

/** Enter the directory browser for a saved target (from the list view). */
function openTargetDirectory(target: PublicTarget): void {
  generation += 1
  // A host that is not live (never connected, or explicitly stopped) must show
  // the 连接中 step while the channel is (re)built — never a directory step
  // that sits empty until provisioning finishes.
  const needsConnect = target.status !== 'ready'
  const now = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  commit({
    view: 'wizard',
    step: needsConnect ? 'connecting' : 'directory',
    error: undefined,
    notice: undefined,
    directory: { ...emptyDirectory(), targetId: target.id },
    connect: needsConnect
      ? {
          phase: 'running',
          origin: 'directory' as const,
          steps: { ...emptySteps(), connect: { status: 'running' } },
          log: [{ time: now, level: 'info', text: t('connect.log.directoryConnect', { label: target.label }) }],
        }
      : idleConnect(),
  })
  void loadDirectory(target.id, '', { promoteFromConnecting: needsConnect })
}

function setNewDirName(name: string): void {
  commit(previous => ({ directory: { ...previous.directory, newDirName: name } }))
}

function setDirectoryTitle(title: string): void {
  commit(previous => ({ directory: { ...previous.directory, title, titleTouched: true } }))
}

function setPathInput(path: string): void {
  commit(previous => ({ directory: { ...previous.directory, pathInput: path } }))
}

/** Create a directory under the current one, then enter it. */
async function createDirectory(): Promise<void> {
  const { targetId, listing, newDirName, creating } = state.directory
  const name = newDirName.trim()
  if (targetId === undefined || listing === undefined || name === '' || creating) return
  const path = joinPath(listing.path, name)
  const gen = generation
  commit(previous => ({ directory: { ...previous.directory, creating: true, error: undefined } }))
  try {
    await api.mkdir(targetId, path)
    if (gen !== generation) return
    commit({
      directory: { ...state.directory, creating: false, newDirName: '' },
      notice: { kind: 'success', text: t('directory.newDir.created', { path }) },
    })
    await loadDirectory(targetId, path)
  } catch (error) {
    if (gen !== generation) return
    commit(previous => ({ directory: { ...previous.directory, creating: false, error: toWireError(error) } }))
  }
}

/** Open the browsed directory as a workspace; the wizard closes on success. */
async function openWorkspace(): Promise<void> {
  return await withConnecting(async () => {
  const { targetId, listing, title } = state.directory
  if (targetId === undefined || listing === undefined || state.pending) return
  const gen = generation
  commit({ pending: true, error: undefined })
  try {
    const trimmed = title.trim()
    const result = await api.openWorkspace(targetId, listing.path, trimmed === '' ? undefined : trimmed)
    if (gen !== generation) return
    commit({
      pending: false,
      view: 'list',
      step: 'method',
      directory: emptyDirectory(),
      connect: idleConnect(),
      notice: { kind: 'success', text: t('directory.opened', { title: result.workspace.title }) },
    })
    revealSession(result.sessionId)
    void refreshState()
  } catch (error) {
    if (gen !== generation) return
    commit({ pending: false, error: toWireError(error) })
  }
  })
}

async function forgetTarget(target: PublicTarget): Promise<void> {
  if (state.pending) return
  const gen = generation
  commit({ pending: true, error: undefined })
  try {
    await api.forgetTarget(target.id)
    if (gen !== generation) return
    commit({ pending: false, notice: { kind: 'success', text: t('list.forgotTarget', { label: target.label }) } })
    await refreshState()
  } catch (error) {
    if (gen !== generation) return
    commit({ pending: false, error: toWireError(error) })
  }
}

async function forgetWorkspace(workspace: RemoteWorkspace): Promise<void> {
  if (state.pending) return
  const gen = generation
  commit({ pending: true, error: undefined })
  try {
    await api.forgetWorkspace(workspace.id)
    if (gen !== generation) return
    commit({ pending: false, notice: { kind: 'success', text: t('list.forgotWorkspace', { title: workspace.title }) } })
    await refreshState()
  } catch (error) {
    if (gen !== generation) return
    commit({ pending: false, error: toWireError(error) })
  }
}

async function stopTarget(target: PublicTarget): Promise<void> {
  if (state.pending) return
  const gen = generation
  commit({ pending: true, error: undefined })
  try {
    const { stopped } = await api.stopTarget(target.id)
    if (gen !== generation) return
    commit({
      pending: false,
      notice: stopped
        ? { kind: 'success', text: t('list.stopped', { label: target.label }) }
        : { kind: 'error', text: t('list.stopUnsupported', { label: target.label }) },
    })
    // A stopped host has no channel to read from: leave its directory view so
    // no operation dangles in the connecting state against a dead channel.
    if (stopped && state.directory.targetId === target.id) {
      commit({ directory: emptyDirectory(), view: 'list', step: 'method' })
    }
    await refreshState()
  } catch (error) {
    if (gen !== generation) return
    commit({ pending: false, error: toWireError(error) })
  }
}

/** Re-open a saved remote workspace (the host recreates its session). */
async function reopenWorkspace(workspace: RemoteWorkspace): Promise<void> {
  return await withConnecting(async () => {
  if (state.pending) return
  const gen = generation
  commit({ pending: true, error: undefined })
  try {
    const result = await api.openWorkspace(workspace.targetId, workspace.path, workspace.title)
    if (gen !== generation) return
    commit({
      pending: false,
      notice: { kind: 'success', text: t('directory.opened', { title: result.workspace.title }) },
    })
    revealSession(result.sessionId)
    await refreshState()
  } catch (error) {
    if (gen !== generation) return
    commit({ pending: false, error: toWireError(error) })
  }
  })
}

/** Table of the store's actions, as the components consume them. */
export const store = {
  closeOverlay,
  newConnection,
  showList,
  setStep,
  setMethod,
  patchConfig,
  dismissError,
  dismissNotice,
  loadAliases,
  chooseAlias,
  startConnect,
  confirmHostKey,
  cancelConnect,
  loadDirectory,
  openTargetDirectory,
  setNewDirName,
  setDirectoryTitle,
  setPathInput,
  createDirectory,
  openWorkspace,
  retryDirectoryConnect,
  forgetTarget,
  forgetWorkspace,
  stopTarget,
  reopenWorkspace,
  refreshState,
  isConnectBlocking: (): boolean => isConnectBlocking(state),
} as const

/** The store's actions (the object above), for prop-free components. */
export type Store = typeof store

/**
 * Dispose every side effect the store owns: close the live SSE stream (its
 * ticket is one-shot, so a hot reload cannot resume it) and drop the
 * in-flight secret. The rendered snapshot stays, so a hot-reloaded overlay
 * shows the attempt as failed and offers a retry.
 */
export function dispose(): void {
  stopStream()
  setPendingSecret(undefined)
  const phase = state.connect.phase
  if (phase === 'running' || phase === 'awaiting-hostkey') {
    commit(previous => ({
      connect: {
        ...previous.connect,
        phase: 'failed',
        hostKey: undefined,
        error: { code: 'disposed', message: t('connect.stream.closed') },
      },
    }))
  }
}
