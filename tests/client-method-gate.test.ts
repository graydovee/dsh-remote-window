/**
 * WSL is gated on an *implemented transport*, not on the client platform.
 *
 * Main has no WSL transport (the host's `connect/start` is SSH-only), so the
 * v3 connect dialog must render exactly one method card — SSH — on every host
 * platform, including `win32`. Flipping the method on only once `wsl.exe`
 * exec-over-stdin + a profile forwarder exist is the contract this pins:
 *
 *  - `methodAvailable('wsl', …)` is false while `WSL_TRANSPORT_ENABLED` is false,
 *  - `offeredMethods(platform)` is `['ssh']` for win32/darwin/linux,
 *  - the mounted v3 dialog (`remote-dialogs.tsx`) renders one SSH card and no
 *    WSL copy even when the host reports `platform: 'win32'`.
 *
 * The dialog component is walked with the same hook/JSX mocks as
 * `tests/client-connect-dialog.test.ts`; the primitives package is external to
 * this repository.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from '../src/client/locales.ts'
import { offeredMethods, OFFERED_METHODS } from '../src/client/method-cards.ts'
import { methodAvailable, WSL_TRANSPORT_ENABLED } from '../src/targets/methods.ts'

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

/** Render the mounted v3 dialogs on the initial (method) step for one state. */
async function renderMethodStep(state: Record<string, unknown> = {}): Promise<Element[]> {
  storeSpies.appState = {
    loaded: true,
    loading: false,
    platform: 'win32',
    order: [],
    connections: {},
    search: '',
    pending: false,
    connectDialog: dialog,
    ...state,
  }
  reactState.cursor = 0
  if (reactState.values.length === 0) reactState.values[0] = 'method'
  const module = await import('../src/client/remote-dialogs.tsx')
  return collect(module.RemoteDialogs())
}

/** The method cards (`<button className="dsh-rw-method">`), not their container. */
function methodCards(elements: readonly Element[]): Element[] {
  return elements.filter(element => element.props?.className === 'dsh-rw-method')
}

function hasText(elements: readonly Element[], text: string): boolean {
  return elements.some(element => element.props?.children === text)
}

beforeEach(() => {
  vi.clearAllMocks()
  reactState.values.length = 0
  reactState.cursor = 0
  apiSpies.connectProgress.mockResolvedValue({ events: [] })
})

describe('connection method gate (no WSL transport on this checkout)', () => {
  it('keeps the WSL transport flag off and the method unavailable on every platform', () => {
    expect(WSL_TRANSPORT_ENABLED).toBe(false)
    expect(methodAvailable('ssh', 'darwin')).toBe(true)
    expect(methodAvailable('ssh', 'win32')).toBe(true)
    expect(methodAvailable('docker', 'win32')).toBe(false)
    expect(methodAvailable('wsl', 'win32')).toBe(false)
    expect(methodAvailable('wsl', 'darwin')).toBe(false)
    expect(methodAvailable('wsl', 'linux')).toBe(false)
  })

  it('offers SSH only on win32, darwin and linux', () => {
    expect(OFFERED_METHODS).toEqual(['ssh'])
    expect(offeredMethods('win32')).toEqual(['ssh'])
    expect(offeredMethods('darwin')).toEqual(['ssh'])
    expect(offeredMethods('linux')).toEqual(['ssh'])
  })

  it('renders exactly one SSH method card on win32 and no WSL copy', async () => {
    const elements = await renderMethodStep({ platform: 'win32' })
    const cards = methodCards(elements)
    expect(cards).toHaveLength(1)
    const card = cards[0]!
    expect(card.props['aria-label']).toBe(t('method.ssh.aria'))
    expect(hasText(elements, t('method.ssh.name'))).toBe(true)
    expect(hasText(elements, t('method.ssh.description'))).toBe(true)
    // No WSL card label/description/aria anywhere in the rendered tree.
    expect(hasText(elements, t('method.wsl.name'))).toBe(false)
    expect(hasText(elements, t('method.wsl.description'))).toBe(false)
    expect(elements.some(element => element.props?.['aria-label'] === t('method.wsl.aria'))).toBe(false)
  })

  it('renders the same single SSH card when the host platform is unknown', async () => {
    const elements = await renderMethodStep({ platform: undefined })
    expect(methodCards(elements)).toHaveLength(1)
    expect(hasText(elements, t('method.wsl.name'))).toBe(false)
  })
})
