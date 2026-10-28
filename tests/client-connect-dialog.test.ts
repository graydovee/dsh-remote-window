/**
 * v3 connect dialog: the model source moved into 高级选项, local defaults to
 * auto-proxying this DSH's own providers.
 *
 * The dialog is driven by store state and the primitives package is external to
 * this repository, so the component tree is walked with hook/JSX mocks (the
 * pattern used by the other client specs). What is pinned here: DSH_HOME and
 * the model-source segmented control live inside the advanced disclosure, the
 * auto panel renders the discovered provider summary/chips, the empty catalog
 * tells the user to configure a provider first, and only manual mode blocks on
 * a missing endpoint.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from '../src/client/locales.ts'

const dialog = {
  phase: 'idle' as const,
  label: 'box',
  host: '203.0.113.10',
  port: '22',
  username: 'tester',
  authKind: 'agent' as const,
  secret: '',
  privateKeyPath: '',
  dshHome: '',
  runtimePolicy: 'auto' as const,
  modelSource: 'local' as 'local' | 'server',
  localMode: 'auto' as 'auto' | 'manual',
  localBaseUrl: '',
  localModels: [] as string[],
  localTimeoutMs: 120_000,
  localProviders: [] as Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }>,
  localProvidersLoading: false,
  localProvidersLoaded: false,
  localHasApiKey: false,
  localSettingsLoading: false,
  localModelsLoading: false,
}

const storeSpies = vi.hoisted(() => ({
  appState: {} as Record<string, unknown>,
  discoverLocalProviders: vi.fn(),
  probeLocalLlmModels: vi.fn(),
  clearLocalLlmKey: vi.fn(),
  patchConnectDialog: vi.fn(),
  submitConnectDialog: vi.fn(),
  closeConnectDialog: vi.fn(),
}))

const reactState = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
}))

vi.mock('react', () => ({
  useEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
  useState: (initial: unknown) => {
    const index = reactState.cursor++
    if (index >= reactState.values.length) {
      reactState.values[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
    }
    const set = (next: unknown): void => {
      reactState.values[index] = typeof next === 'function'
        ? (next as (previous: unknown) => unknown)(reactState.values[index])
        : next
    }
    return [reactState.values[index], set]
  },
}))
vi.mock('react/jsx-runtime', () => ({
  Fragment: Symbol.for('react.fragment'),
  jsx: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
  jsxs: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
  jsxDEV: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
}))
vi.mock('react/jsx-dev-runtime', () => ({
  Fragment: Symbol.for('react.fragment'),
  jsx: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
  jsxs: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
  jsxDEV: (type: unknown, props: unknown) => ({ type, props: props ?? {} }),
}))

const remoteStore = vi.hoisted(() => ({
  noop: vi.fn(),
  clearLocalLlmKey: storeSpies.clearLocalLlmKey,
  discoverLocalProviders: storeSpies.discoverLocalProviders,
  patchConnectDialog: storeSpies.patchConnectDialog,
  probeLocalLlmModels: storeSpies.probeLocalLlmModels,
  submitConnectDialog: storeSpies.submitConnectDialog,
  closeConnectDialog: storeSpies.closeConnectDialog,
}))
vi.mock('../src/client/remote-store.ts', () => ({
  LOCAL_MODE_READY: true,
  applyModeSwitch: remoteStore.noop,
  browseAddWorkspace: remoteStore.noop,
  cancelModeSwitch: remoteStore.noop,
  cancelProfileRestart: remoteStore.noop,
  clearLocalLlmKey: remoteStore.clearLocalLlmKey,
  closeAddWorkspace: remoteStore.noop,
  closeArchiveActivity: remoteStore.noop,
  closeConnectDialog: remoteStore.closeConnectDialog,
  closeDeleteWorkspace: remoteStore.noop,
  closeForgetTarget: remoteStore.noop,
  closeModeDialog: remoteStore.noop,
  closeRenameSession: remoteStore.noop,
  closeRenameWorkspace: remoteStore.noop,
  confirmArchiveActivity: remoteStore.noop,
  confirmProfileRestart: remoteStore.noop,
  discoverLocalProviders: remoteStore.discoverLocalProviders,
  modeDialogFor: () => undefined,
  patchConnectDialog: remoteStore.patchConnectDialog,
  previewModeSwitch: remoteStore.noop,
  probeLocalLlmModels: remoteStore.probeLocalLlmModels,
  setAddWorkspacePath: remoteStore.noop,
  setAddWorkspaceTitle: remoteStore.noop,
  setRenameSessionValue: remoteStore.noop,
  setRenameWorkspaceValue: remoteStore.noop,
  submitAddWorkspace: remoteStore.noop,
  submitConnectDialog: remoteStore.submitConnectDialog,
  submitDeleteWorkspace: remoteStore.noop,
  submitForgetTarget: remoteStore.noop,
  submitRenameSession: remoteStore.noop,
  submitRenameWorkspace: remoteStore.noop,
  useRemoteAppState: () => storeSpies.appState,
}))
vi.mock('../src/client/api.ts', () => ({
  api: { sshAliases: vi.fn(async () => ({ aliases: [], warnings: [] })) },
}))
vi.mock('../src/client/remote-api.ts', () => ({ remoteApi: { connectProgress: vi.fn() } }))
vi.mock('../src/client/executor.ts', () => ({ summarizeModeSwitch: () => undefined }))
vi.mock('../src/client/common.tsx', () => ({
  Field: (props: Record<string, unknown>) => ({ type: 'mock-field', props }),
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: (props: Record<string, unknown>) => ({ type: 'mock-button', props }),
  DisclosureRow: (props: Record<string, unknown>) => ({ type: 'mock-disclosure', props }),
  IconGlobeOutlineRegular: () => null,
  Modal: (props: Record<string, unknown>) => ({
    type: 'mock-modal',
    props: { ...props, children: [props.children, props.footer] },
  }),
  SegmentedControl: (props: Record<string, unknown>) => ({ type: 'mock-segmented', props }),
  StateDot: () => null,
}))

interface Element { type: unknown; props: Record<string, unknown> }

/** Walk an element tree, invoking function components. */
function collect(node: unknown, output: Element[] = []): Element[] {
  if (node === null || node === undefined || typeof node === 'boolean') return output
  if (Array.isArray(node)) {
    for (const child of node) collect(child, output)
    return output
  }
  if (typeof node !== 'object') return output
  const element = node as Element
  output.push(element)
  if (typeof element.type === 'function') {
    collect((element.type as (props: Record<string, unknown>) => unknown)(element.props), output)
    return output
  }
  collect(element.props?.children, output)
  return output
}

/** Render one dialog snapshot and return every element it produced. */
async function renderDialog(overrides: Record<string, unknown> = {}): Promise<Element[]> {
  storeSpies.appState = {
    loaded: true,
    loading: false,
    order: [],
    connections: {},
    search: '',
    pending: false,
    connectDialog: { ...dialog, ...overrides },
  }
  reactState.cursor = 0
  // Start on the config step: that is where the advanced disclosure lives.
  if (reactState.values.length === 0) reactState.values[0] = 'config'
  const module = await import('../src/client/remote-dialogs.tsx')
  return collect(module.RemoteDialogs())
}

/** Render again with the same hook state (simulates a post-click re-render). */
async function rerender(): Promise<Element[]> {
  reactState.cursor = 0
  const module = await import('../src/client/remote-dialogs.tsx')
  return collect(module.RemoteDialogs())
}

function hasText(elements: readonly Element[], text: string): boolean {
  return elements.some(element => element.props?.children === text)
}

function button(elements: readonly Element[], label: string): Element | undefined {
  return elements.find(element => element.type === 'mock-button' && element.props.children === label)
}

/** The advanced disclosure of the config step. */
function advanced(elements: readonly Element[]): Element {
  const disclosure = elements.find(element => element.type === 'mock-disclosure')
  if (disclosure === undefined) throw new Error('advanced disclosure not rendered')
  return disclosure
}

/** Elements nested inside the advanced disclosure (already-rendered children). */
function advancedContent(elements: readonly Element[]): Element[] {
  return collect(advanced(elements).props.children)
}

function segmented(elements: readonly Element[], id: string): Element {
  const control = elements.find(element => element.type === 'mock-segmented' && element.props.id === id)
  if (control === undefined) throw new Error(`segmented control ${id} not found`)
  return control
}

beforeEach(() => {
  vi.clearAllMocks()
  reactState.values.length = 0
  reactState.cursor = 0
  storeSpies.probeLocalLlmModels.mockResolvedValue(undefined)
})

describe('v3 connect dialog model source', () => {
  it('puts DSH_HOME and the model source inside the advanced disclosure', async () => {
    const elements = await renderDialog()
    const nested = advancedContent(elements)
    expect(advanced(elements).props.title).toBe(t('remote.connect.advanced'))
    // DSH_HOME stays the first advanced field.
    expect(nested.some(element => element.type === 'mock-field' && element.props.label === t('remote.connect.dshHome'))).toBe(true)
    // Source first, then the local sub-mode.
    const source = segmented(nested, 'dsh-rw-connect-model-source')
    expect(source.props.value).toBe('local')
    expect((source.props.options as Array<{ value: string }>).map(option => option.value)).toEqual(['local', 'server'])
    const mode = segmented(nested, 'dsh-rw-connect-local-mode')
    expect(mode.props.value).toBe('auto')
    expect((mode.props.options as Array<{ value: string }>).map(option => option.value)).toEqual(['auto', 'manual'])
    // The auto panel is the default local path: hint + refresh + summary.
    expect(hasText(nested, t('connect.local.auto.hint'))).toBe(true)
    expect(button(nested, t('connect.local.auto.refresh'))).toBeDefined()
    expect(hasText(nested, t('connect.local.auto.summary', { providers: 0, models: 0 }))).toBe(true)
    // The removed standalone block means no model-source control outside it.
    expect(elements.some(element => element.type === 'mock-segmented' && element.props.id === 'dsh-rw-connect-model-source')).toBe(true)
    expect(nested.filter(element => element.type === 'mock-segmented' && element.props.id === 'dsh-rw-connect-model-source')).toHaveLength(1)
  })

  it('renders the discovered provider summary and chips in the auto panel', async () => {
    const elements = await renderDialog({
      localProviders: [
        { id: 'p1', name: 'Provider one', models: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] },
        { id: 'p2', name: 'Provider two', models: [{ id: 'c', name: 'C' }] },
      ],
      localProvidersLoaded: true,
    })
    const nested = advancedContent(elements)
    expect(hasText(nested, t('connect.local.auto.summary', { providers: 2, models: 3 }))).toBe(true)
    expect(hasText(nested, 'Provider one')).toBe(true)
    expect(hasText(nested, 'Provider two')).toBe(true)
    expect(hasText(nested, t('connect.local.auto.empty'))).toBe(false)
    const refresh = button(nested, t('connect.local.auto.refresh'))
    expect(refresh).toBeDefined()
    ;(refresh?.props.onClick as () => void)()
    expect(storeSpies.discoverLocalProviders).toHaveBeenCalledTimes(1)
  })

  it('asks the user to configure a provider when discovery returns nothing', async () => {
    const elements = await renderDialog({ localProviders: [], localProvidersLoaded: true })
    const nested = advancedContent(elements)
    expect(hasText(nested, t('connect.local.auto.empty'))).toBe(true)
  })

  it('shows the loading and error states inline while refreshing', async () => {
    const loading = advancedContent(await renderDialog({ localProvidersLoading: true }))
    expect(button(loading, t('connect.local.auto.refreshing'))).toBeDefined()
    const failed = advancedContent(await renderDialog({ localError: 'boom' }))
    expect(hasText(failed, 'boom')).toBe(true)
  })

  it('keeps the server hint when the source is server', async () => {
    const nested = advancedContent(await renderDialog({ modelSource: 'server' }))
    expect(hasText(nested, t('connect.local.serverHint'))).toBe(true)
    expect(nested.some(element => element.type === 'mock-segmented' && element.props.id === 'dsh-rw-connect-local-mode')).toBe(false)
  })

  it('switches the local sub-mode through the store', async () => {
    const nested = advancedContent(await renderDialog())
    const mode = segmented(nested, 'dsh-rw-connect-local-mode')
    ;(mode.props.onChange as (next: string) => void)('manual')
    expect(storeSpies.patchConnectDialog).toHaveBeenCalledWith({ localMode: 'manual', localError: undefined })
    expect(storeSpies.discoverLocalProviders).not.toHaveBeenCalled()
    // The manual panel keeps today's endpoint/key/probe controls.
    const manual = advancedContent(await renderDialog({ localMode: 'manual' }))
    expect(manual.some(element => element.type === 'mock-field' && element.props.label === t('connect.local.baseUrl'))).toBe(true)
    expect(button(manual, t('connect.local.refresh'))).toBeDefined()
  })

  it('requires an endpoint in manual mode before leaving the config step', async () => {
    reactState.values[0] = 'config'
    const elements = await renderDialog({ localMode: 'manual', localBaseUrl: '' })
    const next = button(elements, t('remote.connect.next'))
    expect(next).toBeDefined()
    ;(next?.props.onClick as () => void)()
    const rerendered = await rerender()
    expect(hasText(rerendered, t('connect.local.baseUrlRequired'))).toBe(true)
    expect(storeSpies.submitConnectDialog).not.toHaveBeenCalled()
    // The step did not advance: the deploy section is absent.
    expect(hasText(rerendered, t('connect.deploy.title'))).toBe(false)
  })

  it('lets auto mode leave the config step without any endpoint', async () => {
    reactState.values[0] = 'config'
    const elements = await renderDialog({ localMode: 'auto', localBaseUrl: '' })
    const next = button(elements, t('remote.connect.next'))
    expect(next).toBeDefined()
    ;(next?.props.onClick as () => void)()
    const rerendered = await rerender()
    expect(hasText(rerendered, t('connect.local.baseUrlRequired'))).toBe(false)
    expect(hasText(rerendered, t('connect.deploy.title'))).toBe(true)
  })
})
