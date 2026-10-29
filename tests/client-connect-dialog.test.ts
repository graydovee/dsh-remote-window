/**
 * v3 connect dialog: the model source lives in 高级选项 and the local source is
 * always the auto-discovered catalog of this DSH's providers — there is no
 * manual endpoint/API-key UI any more.
 *
 * The dialog is driven by store state and the primitives package is external to
 * this repository, so the component tree is walked with hook/JSX mocks (the
 * pattern used by the other client specs). What is pinned here: DSH_HOME and
 * the model-source segmented control live inside the advanced disclosure, the
 * discovered catalog renders one provider group with a checkbox per model plus
 * per-provider 全选/清空, an empty catalog tells the user to configure a
 * provider first, and the deploy step shows a waiting hint while the first
 * progress poll has not answered yet.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from '../src/client/locales.ts'

const PROVIDER_ONE = {
  id: 'p1',
  name: 'Provider one',
  models: [{ id: 'a', name: 'Model A' }, { id: 'b', name: 'Model B' }],
}
const PROVIDER_TWO = {
  id: 'p2',
  name: 'Provider two',
  models: [{ id: 'c', name: 'Model C' }],
}

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
  localProviders: [] as Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }>,
  localProvidersLoading: false,
  localProvidersLoaded: true,
  localSelection: {} as Record<string, readonly string[]>,
  localSettingsLoading: false,
}

const storeSpies = vi.hoisted(() => ({
  appState: {} as Record<string, unknown>,
  discoverLocalProviders: vi.fn(),
  patchConnectDialog: vi.fn(),
  setLocalProviderSelected: vi.fn(),
  submitConnectDialog: vi.fn(),
  closeConnectDialog: vi.fn(),
  toggleLocalModel: vi.fn(),
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
  closeConnectDialog: storeSpies.closeConnectDialog,
  discoverLocalProviders: storeSpies.discoverLocalProviders,
  patchConnectDialog: storeSpies.patchConnectDialog,
  setLocalProviderSelected: storeSpies.setLocalProviderSelected,
  submitConnectDialog: storeSpies.submitConnectDialog,
  toggleLocalModel: storeSpies.toggleLocalModel,
}))
vi.mock('../src/client/remote-store.ts', () => ({
  LOCAL_MODE_READY: true,
  applyModeSwitch: remoteStore.noop,
  browseAddWorkspace: remoteStore.noop,
  cancelModeSwitch: remoteStore.noop,
  cancelProfileRestart: remoteStore.noop,
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
  setAddWorkspacePath: remoteStore.noop,
  setAddWorkspaceTitle: remoteStore.noop,
  setLocalProviderSelected: remoteStore.setLocalProviderSelected,
  setRenameSessionValue: remoteStore.noop,
  setRenameWorkspaceValue: remoteStore.noop,
  submitAddWorkspace: remoteStore.noop,
  submitConnectDialog: remoteStore.submitConnectDialog,
  submitDeleteWorkspace: remoteStore.noop,
  submitForgetTarget: remoteStore.noop,
  submitRenameSession: remoteStore.noop,
  submitRenameWorkspace: remoteStore.noop,
  toggleLocalModel: remoteStore.toggleLocalModel,
  useRemoteAppState: () => storeSpies.appState,
}))
vi.mock('../src/client/api.ts', () => ({
  api: { sshAliases: vi.fn(async () => ({ aliases: [], warnings: [] })) },
}))
const apiSpies = vi.hoisted(() => ({ connectProgress: vi.fn() }))
vi.mock('../src/client/remote-api.ts', () => ({ remoteApi: apiSpies }))
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

function text(elements: readonly Element[], testId: string): string | undefined {
  const element = elements.find(candidate => candidate.props?.['data-testid'] === testId)
  return element?.props?.children as string | undefined
}

function button(elements: readonly Element[], label: string): Element | undefined {
  return elements.find(element => element.type === 'mock-button' && element.props.children === label)
}

function buttons(elements: readonly Element[], label: string): Element[] {
  return elements.filter(element => element.type === 'mock-button' && element.props.children === label)
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

function checkbox(elements: readonly Element[], providerId: string, modelId: string): Element {
  const input = elements.find(element => element.props?.['data-testid'] === `dsh-rw-local-model-${providerId}-${modelId}`)
  if (input === undefined) throw new Error(`checkbox ${providerId}/${modelId} not rendered`)
  return input
}

beforeEach(() => {
  vi.clearAllMocks()
  reactState.values.length = 0
  reactState.cursor = 0
  apiSpies.connectProgress.mockResolvedValue({ events: [] })
})

describe('v3 connect dialog model source', () => {
  it('puts DSH_HOME and the model source inside the advanced disclosure', async () => {
    const elements = await renderDialog()
    const nested = advancedContent(elements)
    expect(advanced(elements).props.title).toBe(t('remote.connect.advanced'))
    // DSH_HOME stays the first advanced field; there is no manual endpoint
    // form, so the only other field is the model-source label.
    const fields = nested.filter(element => element.type === 'mock-field')
    expect(fields.map(field => field.props.label)).toEqual([
      t('remote.connect.dshHome'),
      t('connect.local.title'),
    ])
    expect(elements.some(element => element.props?.id === 'dsh-rw-connect-local-mode')).toBe(false)
    // Source segmented control keeps only local|server.
    const source = segmented(nested, 'dsh-rw-connect-model-source')
    expect(source.props.value).toBe('local')
    expect((source.props.options as Array<{ value: string }>).map(option => option.value)).toEqual(['local', 'server'])
    // Local is always auto-discovery: hint + refresh + summary.
    expect(hasText(nested, t('connect.local.auto.hint'))).toBe(true)
    expect(button(nested, t('connect.local.auto.refresh'))).toBeDefined()
    expect(text(nested, 'dsh-rw-local-summary')).toBe(
      t('connect.local.auto.summary', { providers: 0, selected: 0, models: 0 }),
    )
  })

  it('renders the discovered catalog grouped per provider with every model checked', async () => {
    const nested = advancedContent(await renderDialog({
      localProviders: [PROVIDER_ONE, PROVIDER_TWO],
      localSelection: { p1: ['a', 'b'], p2: ['c'] },
    }))
    expect(text(nested, 'dsh-rw-local-summary')).toBe(
      t('connect.local.auto.summary', { providers: 2, selected: 3, models: 3 }),
    )
    expect(hasText(nested, 'Provider one')).toBe(true)
    expect(hasText(nested, 'Provider two')).toBe(true)
    expect(hasText(nested, 'Model A')).toBe(true)
    expect(hasText(nested, 'Model C')).toBe(true)
    expect(checkbox(nested, 'p1', 'a').props.checked).toBe(true)
    expect(checkbox(nested, 'p1', 'b').props.checked).toBe(true)
    expect(checkbox(nested, 'p2', 'c').props.checked).toBe(true)
    expect(checkbox(nested, 'p1', 'a').props.disabled).toBe(false)
    expect(hasText(nested, t('connect.local.auto.empty'))).toBe(false)
    // Per-provider count + 全选/清空 buttons, one pair per provider.
    expect(hasText(nested, t('connect.local.auto.providerCount', { selected: 2, total: 2 }))).toBe(true)
    expect(hasText(nested, t('connect.local.auto.providerCount', { selected: 1, total: 1 }))).toBe(true)
    const selectAll = buttons(nested, t('connect.local.auto.selectAll'))
    const clear = buttons(nested, t('connect.local.auto.clear'))
    expect(selectAll).toHaveLength(2)
    expect(clear).toHaveLength(2)
    ;(selectAll[0]!.props.onClick as () => void)()
    expect(storeSpies.setLocalProviderSelected).toHaveBeenCalledWith('p1', true)
    ;(clear[1]!.props.onClick as () => void)()
    expect(storeSpies.setLocalProviderSelected).toHaveBeenCalledWith('p2', false)
  })

  it('delegates checkbox changes and refreshes the catalog', async () => {
    const nested = advancedContent(await renderDialog({
      localProviders: [PROVIDER_ONE, PROVIDER_TWO],
      localSelection: { p1: ['a', 'b'], p2: ['c'] },
    }))
    ;(checkbox(nested, 'p1', 'a').props.onChange as () => void)()
    expect(storeSpies.toggleLocalModel).toHaveBeenCalledWith('p1', 'a')
    ;(checkbox(nested, 'p2', 'c').props.onChange as () => void)()
    expect(storeSpies.toggleLocalModel).toHaveBeenCalledWith('p2', 'c')
    ;(button(nested, t('connect.local.auto.refresh'))?.props.onClick as () => void)()
    expect(storeSpies.discoverLocalProviders).toHaveBeenCalledTimes(1)
  })

  it('asks the user to configure a provider when discovery returns nothing', async () => {
    const nested = advancedContent(await renderDialog({ localProviders: [], localProvidersLoaded: true }))
    expect(text(nested, 'dsh-rw-local-empty')).toBe(t('connect.local.auto.empty'))
  })

  it('shows the loading and error states inline while refreshing', async () => {
    const loading = advancedContent(await renderDialog({
      localProviders: [PROVIDER_ONE],
      localProvidersLoading: true,
      localProvidersLoaded: false,
    }))
    expect(button(loading, t('connect.local.auto.refreshing'))).toBeDefined()
    const failed = advancedContent(await renderDialog({ localError: 'boom' }))
    expect(hasText(failed, 'boom')).toBe(true)
  })

  it('keeps the server hint when the source is server', async () => {
    const nested = advancedContent(await renderDialog({ modelSource: 'server' }))
    expect(hasText(nested, t('connect.local.serverHint'))).toBe(true)
    expect(nested.some(element => element.props?.['data-testid']?.toString().startsWith('dsh-rw-local-provider-'))).toBe(false)
    expect(nested.some(element => element.type === 'mock-segmented' && element.props.id === 'dsh-rw-connect-local-mode')).toBe(false)
  })

  it('lets the config step advance without any endpoint (discovery is the only model config)', async () => {
    reactState.values[0] = 'config'
    const elements = await renderDialog()
    const next = button(elements, t('remote.connect.next'))
    expect(next).toBeDefined()
    ;(next?.props.onClick as () => void)()
    const rerendered = await rerender()
    expect(hasText(rerendered, t('connect.deploy.title'))).toBe(true)
  })

  it('shows the elapsed timer next to the primary action while submitting', async () => {
    const elements = await renderDialog({ phase: 'submitting', attemptId: 'attempt-1' })
    expect(text(elements, 'dsh-rw-connect-elapsed')).toBe(t('connect.progress.elapsed', { seconds: 0 }))
    expect(button(elements, t('remote.connect.next'))?.props.disabled).toBe(true)
  })

  it('shows a waiting hint above the steps until the first progress poll answers', async () => {
    reactState.values[0] = 'connect'
    const submitting = await renderDialog({ phase: 'submitting', attemptId: 'attempt-1' })
    expect(text(submitting, 'dsh-rw-progress-waiting')).toBe(t('connect.progress.waiting'))
    expect(hasText(submitting, t('connect.deploy.title'))).toBe(true)
    // Idle/retry renders keep the hint hidden.
    const idle = await renderDialog({ phase: 'failed' })
    expect(text(idle, 'dsh-rw-progress-waiting')).toBeUndefined()
    expect(text(idle, 'dsh-rw-connect-elapsed')).toBeUndefined()
  })
})
