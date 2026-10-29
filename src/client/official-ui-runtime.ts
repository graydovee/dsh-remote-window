/**
 * Loader for the vendored DSH 0.2.1-rc.3 conversation bundle.
 *
 * The bundle is the official package build, patched only at its outer module
 * wrapper: instead of registering with `window.__ModuleLoader__.load`, it
 * assigns a factory to `window.__DSH_OFFICIAL_UI_LOAD__` and exports the
 * components the remote adapter renders (`InputBar`, `SessionInputShell`).
 * The source is served by our host route so this client bundle stays small and
 * the exact upstream build remains inspectable in `assets/official-ui`.
 *
 * The factory needs the page's platform module table. The CJS client factory
 * receives it as `require`; capture that binding here rather than reaching for
 * globals the shell does not export.
 */

/* The client bundle is a CJS factory; the platform table is the `require`
   argument injected by `window.__ModuleLoader__.load`. */
declare const require: ((id: string) => unknown) | undefined

export interface OfficialUiExports {
  InputBar: (props: Record<string, unknown>) => unknown
  SessionInputShell: new (deps: Record<string, unknown>) => Record<string, unknown>
  conversationZh: Record<string, string>
  [key: string]: unknown
}

interface OfficialLoaderWindow {
  __DSH_OFFICIAL_UI_LOAD__?: (require: (id: string) => unknown) => OfficialUiExports
  __DSH_OFFICIAL_CHAT_LOAD__?: (require: (id: string) => unknown) => OfficialChatExports
  __DSH_OFFICIAL_APPROVAL_LOAD__?: (require: (id: string) => unknown) => OfficialApprovalExports
  __DSH_OFFICIAL_MODEL_LOAD__?: (require: (id: string) => unknown) => OfficialModelExports
  __DSH_OFFICIAL_TOOL_LOAD__?: (require: (id: string) => unknown) => OfficialToolExports
  __DSH_OFFICIAL_TRAJECTORY_LOAD__?: (require: (id: string) => unknown) => OfficialTrajectoryExports
}

export interface OfficialTrajectoryExports {
  TrajectoryTable: (props: Record<string, unknown>) => unknown
  trajectoryZh: Record<string, string>
  [key: string]: unknown
}

export interface OfficialToolExports {
  ToolRow: (props: Record<string, unknown>) => unknown
  [key: string]: unknown
}

export interface OfficialModelExports {
  ModelSelect: (props: Record<string, unknown>) => unknown
  [key: string]: unknown
}

export interface OfficialApprovalExports {
  ApprovalPanel: (props: Record<string, unknown>) => unknown
  [key: string]: unknown
}

export interface OfficialChatExports {
  UserMessageNodeView: (props: Record<string, unknown>) => unknown
  AssistantMarkdown: (props: Record<string, unknown>) => unknown
  UserContent: (props: Record<string, unknown>) => unknown
  MessageIconActions: (props: Record<string, unknown>) => unknown
  ReasoningRow: (props: Record<string, unknown>) => unknown
  [key: string]: unknown
}

const BUNDLE_URL = '/dsh-remote-window/official-ui.js'
const CHAT_BUNDLE_URL = '/dsh-remote-window/official-ui-chat.js?v=2'
const APPROVAL_BUNDLE_URL = '/dsh-remote-window/official-ui-approval.js'
const MODEL_BUNDLE_URL = '/dsh-remote-window/official-ui-model.js'
const TOOL_BUNDLE_URL = '/dsh-remote-window/official-ui-tool.js'
const TRAJECTORY_BUNDLE_URL = '/dsh-remote-window/official-ui-trajectory.js'
let pending: Promise<OfficialUiExports> | undefined
let chatPending: Promise<OfficialChatExports> | undefined
let approvalPending: Promise<OfficialApprovalExports> | undefined
let modelPending: Promise<OfficialModelExports> | undefined
let toolPending: Promise<OfficialToolExports> | undefined
let trajectoryPending: Promise<OfficialTrajectoryExports> | undefined

/** Fetch and instantiate the vendored official bundle once per page. */
export function loadOfficialUi(): Promise<OfficialUiExports> {
  if (pending !== undefined) return pending
  pending = (async () => {
    const platformRequire = typeof require === 'function' ? require : undefined
    if (platformRequire === undefined) throw new Error('platform require is unavailable')
    const response = await fetch(BUNDLE_URL, { credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) throw new Error(`official ui bundle: HTTP ${response.status}`)
    // eslint-disable-next-line no-new-func -- the vendored bundle is a classic script by construction.
    new Function(await response.text())()
    const factory = (globalThis as unknown as OfficialLoaderWindow).__DSH_OFFICIAL_UI_LOAD__
    if (factory === undefined) throw new Error('official ui factory was not installed')
    return factory(platformRequire)
  })()
  return pending
}

/* Debug hook while wiring the vendor adapter; harmless in production but can be
   removed once the official InputBar is the only path. */

/** Fetch and instantiate the vendored official Chat target bundle once. */
export function loadOfficialChatUi(): Promise<OfficialChatExports> {
  if (chatPending !== undefined) return chatPending
  chatPending = (async () => {
    const platformRequire = typeof require === 'function' ? require : undefined
    if (platformRequire === undefined) throw new Error('platform require is unavailable')
    const response = await fetch(CHAT_BUNDLE_URL, { credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) throw new Error(`official chat bundle: HTTP ${response.status}`)
    // eslint-disable-next-line no-new-func -- the vendored bundle is a classic script by construction.
    new Function(await response.text())()
    const factory = (globalThis as unknown as OfficialLoaderWindow).__DSH_OFFICIAL_CHAT_LOAD__
    if (factory === undefined) throw new Error('official chat factory was not installed')
    return factory(platformRequire)
  })()
  return chatPending
}



/** Fetch and instantiate the vendored official Approval panel once per page. */
export function loadOfficialApprovalUi(): Promise<OfficialApprovalExports> {
  if (approvalPending !== undefined) return approvalPending
  approvalPending = (async () => {
    const platformRequire = typeof require === 'function' ? require : undefined
    if (platformRequire === undefined) throw new Error('platform require is unavailable')
    const response = await fetch(APPROVAL_BUNDLE_URL, { credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) throw new Error(`official approval bundle: HTTP ${response.status}`)
    // eslint-disable-next-line no-new-func -- the vendored bundle is a classic script by construction.
    new Function(await response.text())()
    const factory = (globalThis as unknown as OfficialLoaderWindow).__DSH_OFFICIAL_APPROVAL_LOAD__
    if (factory === undefined) throw new Error('official approval factory was not installed')
    return factory(platformRequire)
  })()
  return approvalPending
}


/** Fetch and instantiate the vendored official model-selection bundle once per page. */
export function loadOfficialModelUi(): Promise<OfficialModelExports> {
  if (modelPending !== undefined) return modelPending
  modelPending = (async () => {
    const platformRequire = typeof require === 'function' ? require : undefined
    if (platformRequire === undefined) throw new Error('platform require is unavailable')
    const response = await fetch(MODEL_BUNDLE_URL, { credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) throw new Error(`official model bundle: HTTP ${response.status}`)
    // eslint-disable-next-line no-new-func -- the vendored bundle is a classic script by construction.
    new Function(await response.text())()
    const factory = (globalThis as unknown as OfficialLoaderWindow).__DSH_OFFICIAL_MODEL_LOAD__
    if (factory === undefined) throw new Error('official model factory was not installed')
    return factory(platformRequire)
  })()
  return modelPending
}


/** Fetch and instantiate the vendored official tool-row bundle once per page. */
export function loadOfficialToolUi(): Promise<OfficialToolExports> {
  if (toolPending !== undefined) return toolPending
  toolPending = (async () => {
    const platformRequire = typeof require === 'function' ? require : undefined
    if (platformRequire === undefined) throw new Error('platform require is unavailable')
    const response = await fetch(TOOL_BUNDLE_URL, { credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) throw new Error(`official tool bundle: HTTP ${response.status}`)
    // eslint-disable-next-line no-new-func -- the vendored bundle is a classic script by construction.
    new Function(await response.text())()
    const factory = (globalThis as unknown as OfficialLoaderWindow).__DSH_OFFICIAL_TOOL_LOAD__
    if (factory === undefined) throw new Error('official tool factory was not installed')
    return factory(platformRequire)
  })()
  return toolPending
}


/** Fetch and instantiate the vendored official trajectory table once per page. */
export function loadOfficialTrajectoryUi(): Promise<OfficialTrajectoryExports> {
  if (trajectoryPending !== undefined) return trajectoryPending
  trajectoryPending = (async () => {
    const platformRequire = typeof require === 'function' ? require : undefined
    if (platformRequire === undefined) throw new Error('platform require is unavailable')
    const response = await fetch(TRAJECTORY_BUNDLE_URL, { credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) throw new Error(`official trajectory bundle: HTTP ${response.status}`)
    // eslint-disable-next-line no-new-func -- the vendored bundle is a classic script by construction.
    new Function(await response.text())()
    const factory = (globalThis as unknown as OfficialLoaderWindow).__DSH_OFFICIAL_TRAJECTORY_LOAD__
    if (factory === undefined) throw new Error('official trajectory factory was not installed')
    return factory(platformRequire)
  })()
  return trajectoryPending
}
