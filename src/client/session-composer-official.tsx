/**
 * Adapter that renders the real official rc.3 composer component.
 *
 * The component code and its CSS are loaded from the vendored official bundle
 * (`assets/official-ui`) instead of being reimplemented. This file supplies the
 * remote session's data, draft attachments, and the named control slots; the
 * editor, chips, buttons, menus, and DOM remain the upstream implementation.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Menu, IconChevronDownOutlineRegular, PermissionIconReadOnlyRegular, PermissionIconWorkspaceWriteRegular, PermissionIconFullAccessRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { t as appT } from './locales.ts'
import { loadOfficialModelUi, loadOfficialUi } from './official-ui-runtime.ts'
import type { OfficialModelExports, OfficialUiExports } from './official-ui-runtime.ts'
import type { ComposerAttachment, ComposerFileRef, SessionComposerProps } from './session-composer.tsx'
import { OFFICIAL_LOCALE_ZH } from './vendor/official-ui/locale-zh.ts'

type AnyRecord = Record<string, any>

/** Translate the official conversation namespace; falls back to the key. */
function officialT(key: string, vars?: Record<string, string | number>): string {
  const template = OFFICIAL_LOCALE_ZH[key] ?? key
  if (vars === undefined) return template
  return template.replace(/\{(\w+)\}/gu, (_, name: string) => String(vars[name] ?? `{${name}}`))
}

/** Empty observable store for fixed host facts. */
function constantStore<T>(value: T): AnyRecord {
  return { getSnapshot: () => value, subscribe: () => () => {} }
}

/** Subscribe one selector to an official snapshot store. */
function useOfficialStore<S>(store: AnyRecord, selector: (value: S) => unknown): unknown {
  return useSyncExternalStore(
    callback => store.subscribe(callback) as () => void,
    () => selector(store.getSnapshot() as S),
  )
}

/** Draft attachment ids are opaque branded strings upstream. */
function attachmentId(): string {
  return `rw-${crypto.randomUUID()}`
}

/** Render the official composer once its bundle is available. */
export function OfficialSessionComposer(props: SessionComposerProps): ReactElement {
  const [ui, setUi] = useState<OfficialUiExports | null>(null)
  const [modelUi, setModelUi] = useState<OfficialModelExports | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void Promise.all([loadOfficialUi(), loadOfficialModelUi()]).then(([value, models]) => {
      if (cancelled) return
      setUi(value)
      setModelUi(models)
    }, (error: unknown) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error))
    })
    return () => { cancelled = true }
  }, [])
  if (ui === null) {
    return (
      <div className="dsh-rwv-official-composer-loading" role="status">
        {loadError === null ? appT('common.loading') : `${appT('common.loading')} (${loadError})`}
      </div>
    )
  }
  return <OfficialInputBar ui={ui} modelUi={modelUi} {...props} />
}

/** The official InputBar adapter for one remote session. */
function OfficialInputBar({ ui, modelUi, ...props }: SessionComposerProps & { ui: OfficialUiExports; modelUi: OfficialModelExports | null }): ReactElement {
  const [attachments, setAttachments] = useState<ReadonlyMap<string, ComposerAttachment>>(() => new Map())
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [atQuery, setAtQuery] = useState<string | null>(null)
  const [atFiles, setAtFiles] = useState<readonly ComposerFileRef[]>([])
  const shell = useMemo(() => new (ui.SessionInputShell as any)({
    actx: {},
    defaultSink: async (text: string, ids: readonly string[]) => {
      const selected = ids.map(id => attachmentsRef.current.get(id)).filter((item): item is ComposerAttachment => item !== undefined)
      const outcome = await Promise.resolve(props.onSend(text, selected)).then(() => ({ kind: 'success' as const }), (error: unknown) => ({
        kind: 'error' as const,
        text: error instanceof Error ? error.message : String(error),
      }))
      return outcome
    },
    commandAttachments: {
      serialize: async (ids: readonly string[]) => ids.map((id) => {
        const item = attachmentsRef.current.get(id)
        if (item === undefined) throw new Error('attachment disappeared')
        if (item.mediaType.startsWith('image/')) {
          return { type: 'image', mediaType: item.mediaType, data: item.dataUrl.slice(item.dataUrl.indexOf(',') + 1), name: item.name }
        }
        return { type: 'file', receiptId: id }
      }),
      release: () => {},
      unsupportedNotice: () => officialT('attachment.unsupported'),
    },
  }), [ui, props.onSend])

  const input = useOfficialStore(shell.state, (value: any) => value) as any
  const notices = shell.notices as AnyRecord
  const draft = typeof input?.draft === 'string' ? input.draft : ''

  useEffect(() => {
    const match = /^\/([a-z0-9_-]*)$/u.exec(draft)
    setSlashQuery(match === null ? null : match[1] ?? '')
  }, [draft])
  useEffect(() => {
    const match = /(?:^|\s)@([^\s@]*)$/u.exec(draft)
    const query = match?.[1] ?? null
    setAtQuery(query)
    if (query === null) { setAtFiles([]); return }
    let cancelled = false
    const timer = setTimeout(() => {
      void props.onSearchFiles?.(query).then((files) => { if (!cancelled) setAtFiles(files.slice(0, 8)) })
        .catch(() => { if (!cancelled) setAtFiles([]) })
    }, 160)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [draft, props.onSearchFiles])

  const slashOptions = useMemo(() => {
    if (slashQuery === null) return []
    return (props.commands ?? []).filter(command => command.name.startsWith(slashQuery)).slice(0, 8)
  }, [slashQuery, props.commands])

  const attachmentsArray = useMemo(() => [...attachments.values()], [attachments])
  const uploads = useMemo(() => {
    const entries: Record<string, unknown> = {}
    for (const item of attachmentsArray) {
      if (!item.mediaType.startsWith('image/')) entries[item.id] = { status: 'ready', receiptId: item.id, file: { id: item.id, name: item.name } }
    }
    return entries
  }, [attachmentsArray])
  const uploadStore = useMemo(() => constantStore(uploads), [uploads])
  const emptyLexicon = useMemo(() => new Map(), [])
  const emptyShortcuts = useMemo(() => [], [])
  const busyEnter = useMemo(() => constantStore('queue'), [])

  const addFiles = (files: readonly File[], _directories?: ReadonlySet<File>): string | null => {
    const next = new Map(attachmentsRef.current)
    const ids: string[] = []
    for (const file of files) {
      const id = attachmentId()
      const isImage = file.type.startsWith('image/')
      const dataUrl = isImage ? '' : ''
      next.set(id, {
        id,
        name: file.name === '' ? (isImage ? '图片' : '文件') : file.name,
        mediaType: file.type === '' ? (isImage ? 'image/png' : 'application/octet-stream') : file.type,
        dataUrl,
        size: file.size,
        file,
        previewUrl: isImage ? URL.createObjectURL(file) : undefined,
      } as ComposerAttachment & { file: File; previewUrl?: string })
      ids.push(id)
      if (isImage) {
        const reader = new FileReader()
        reader.addEventListener('load', () => {
          const url = typeof reader.result === 'string' ? reader.result : ''
          setAttachments((current) => {
            const item = current.get(id)
            if (item === undefined) return current
            const updated = new Map(current)
            updated.set(id, { ...item, dataUrl: url })
            return updated
          })
        })
        reader.readAsDataURL(file)
      }
    }
    setAttachments(next)
    shell.actions.addAttachments(ids)
    return null
  }

  const removeAttachment = (id: string): void => {
    shell.actions.removeAttachment(id)
    setAttachments((current) => {
      const next = new Map(current)
      next.delete(id)
      return next
    })
  }

  const resolveDraftAttachments = (ids: readonly string[]): readonly ComposerAttachment[] =>
    ids.map(id => attachmentsRef.current.get(id)).filter((item): item is ComposerAttachment => item !== undefined)

  const renderSlot = (name: string, slotProps?: AnyRecord): ReactNode => {
    if (name === 'conversation.input.permission') {
      return <PermissionSlot label={props.permissionLabel} options={props.permissionOptions} onPick={props.onPermission} locked={slotProps?.locked === true} />
    }
    if (name === 'conversation.input.model') {
      return modelUi === null
        ? null
        : <OfficialModelSlot ui={modelUi} label={props.modelLabel} effort={props.modelEffort} groups={props.models} loading={props.modelLoading} onPick={props.onSelectModel} locked={slotProps?.locked === true} />
    }
    if (name === 'conversation.input.attachments') {
      return <AttachmentRail items={(slotProps?.attachments ?? []) as AnyRecord[]} uploads={uploads} local={attachmentsRef.current} onRemove={removeAttachment} />
    }
    if (name === 'conversation.input.overlay') {
      return (
        <>
          {slashOptions.length > 0 && (
            <div className="dsh-rwv-official-popover" role="listbox" aria-label={appT('session.composer.commands')}>
              {slashOptions.map(command => (
                <button key={command.name} type="button" className="dsh-rwv-official-option" onClick={() => {
                  shell.actions.setDraft(`/${command.name} `)
                  shell.editor.focus()
                }}>
                  <span className="dsh-rwv-official-option-name">/{command.name}</span>
                  <span className="dsh-rwv-official-option-desc">{command.description}</span>
                </button>
              ))}
            </div>
          )}
          {atQuery !== null && atFiles.length > 0 && (
            <div className="dsh-rwv-official-popover" role="listbox" aria-label={appT('session.composer.files')}>
              {atFiles.map(file => (
                <button key={file.path} type="button" className="dsh-rwv-official-option" onClick={() => {
                  const next = draft.replace(/(?:^|\s)@([^\s@]*)$/u, (whole: string) => `${whole.startsWith(' ') ? ' ' : ''}@${file.path} `)
                  shell.actions.setDraft(next)
                  shell.editor.focus()
                }}>
                  <span className="dsh-rwv-official-option-name">{file.name}{file.directory === true ? '/' : ''}</span>
                  <span className="dsh-rwv-official-option-desc">{file.path}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )
    }
    return null
  }

  const Bar = ui.InputBar as unknown as (barProps: AnyRecord) => ReactElement
  return (
    <div className="dsh-rwv-official-composer">
      <Bar
        variant="composer"
        sessionId={props.sessionId}
        placeholder={props.placeholder}
        disabled={props.disabled === true}
        blocked={undefined}
        useSession={(selector: (value: AnyRecord) => unknown) => selector({ running: props.running, removed: false, promptError: null, subagent: null })}
        useInput={(selector: (value: AnyRecord) => unknown) => useOfficialStore(shell.state, selector) as never}
        inputActions={shell.actions}
        keyboard={shell}
        addFiles={addFiles}
        removeAttachment={removeAttachment}
        resolveDraftAttachments={resolveDraftAttachments}
        retryFileUpload={() => {}}
        toggleCommandMenu={() => {}}
        stop={props.onStop}
        t={officialT}
        renderSlot={renderSlot}
        useBusyEnter={(selector: (value: unknown) => unknown) => selector(busyEnter.getSnapshot())}
        useFileUploads={(selector: (value: AnyRecord) => unknown) => selector(uploadStore.getSnapshot() as AnyRecord)}
        useNotices={(selector: (value: unknown) => unknown) => useOfficialStore(notices, selector) as never}
        useLexicon={(selector: (value: unknown) => unknown) => selector(emptyLexicon)}
        useMenuLauncher={(selector: (value: unknown) => unknown) => selector(null)}
        useStopShortcut={(selector: (value: unknown) => unknown) => selector(emptyShortcuts)}
        useProjection={(key: string, selector?: (value: unknown) => unknown) => selector === undefined ? undefined : selector(undefined)}
      />
    </div>
  )
}

function cleanPermissionLabel(value: string | undefined): string | undefined {
  return value?.replace(/^\/permission\s+/u, '')
}

const PERMISSION_GLYPHS: Record<string, ReactElement> = {
  'read-only': <PermissionIconReadOnlyRegular />,
  'workspace-write': <PermissionIconWorkspaceWriteRegular />,
  'danger-full-access': <PermissionIconFullAccessRegular />,
}

const PERMISSION_LABELS: Record<string, string> = {
  'read-only': '仅可查看',
  'workspace-write': '工作区内修改',
  'danger-full-access': '完全权限',
}

function permissionLabel(id: string, label: string | undefined): string {
  return PERMISSION_LABELS[id] ?? cleanPermissionLabel(label) ?? id
}

function PermissionSlot(props: { label?: string; options?: readonly { id: string; label: string }[]; onPick?: (id: string) => void; locked: boolean }): ReactElement {
  const [open, setOpen] = useState(false)
  const options = props.options ?? []
  const current = options.find(option => permissionLabel(option.id, option.label) === cleanPermissionLabel(props.label))
  const currentId = current?.id ?? 'workspace-write'
  const currentLabel = permissionLabel(currentId, current?.label)
  const items = options.map(option => ({
    id: option.id,
    label: permissionLabel(option.id, option.label),
    icon: PERMISSION_GLYPHS[option.id],
  }))
  return (
    <div className="dsh-rwv-official-control">
      <Menu
        open={open}
        anchor={(
          <button type="button" className="dsh-rwv-official-chip" disabled={props.locked} onClick={() => { setOpen(value => !value) }} aria-expanded={open} aria-label={`访问模式，当前：${currentLabel}`} title={current?.label}>
            <span className="dsh-rwv-official-chip-icon" aria-hidden="true">{PERMISSION_GLYPHS[currentId]}</span>
            <span>{currentLabel}</span>
            <IconChevronDownOutlineRegular className="dsh-rwv-official-chip-chevron" />
          </button>
        )}
        items={items}
        selectedId={currentId}
        onSelect={(id) => { setOpen(false); props.onPick?.(id) }}
        onClose={() => { setOpen(false) }}
        side="top"
        portal
      />
    </div>
  )
}

const OFFICIAL_MODEL_LOCALE_ZH: Record<string, string> = {
  'provider.account': 'DeepSeek 账号',
  'trigger.fallback': '请选择模型',
  'trigger.loading': '正在加载模型…',
  'trigger.selectAria': '请选择模型',
  'trigger.aria': '选择模型，当前 {model}',
  'trigger.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
  'menu.aria': '模型与推理等级',
  'menu.model': '模型',
  'menu.effort': '推理等级',
  'effort.providerDefault': 'Default',
  'status.loading': '正在刷新模型列表…',
  'error.action': '模型操作失败：{message}',
  'error.sessionInUse': '当前会话已被占用，可能是其他正在运行的 DSH 导致的。',
  'action.reload': '重新加载',
  'warning.groupLoad': '{name} 加载失败：{message}',
  'search.placeholder': '搜索模型…',
  'search.clear': '清除搜索',
  'search.empty': '没有匹配的模型。',
  'empty.models': '暂无可用模型',
  'empty.efforts': '当前模型未提供推理等级。',
}

function modelT(key: string, vars?: Record<string, string | number>): string {
  const template = OFFICIAL_MODEL_LOCALE_ZH[key] ?? key
  if (vars === undefined) return template
  return template.replace(/\{(\w+)\}/gu, (_, name: string) => String(vars[name] ?? `{${name}}`))
}

function OfficialModelSlot(props: {
  ui: OfficialModelExports
  label?: string
  effort?: string
  groups?: readonly { id: string; name: string; models: readonly { id: string; name: string; reasoning?: { defaultEffort?: string; efforts?: readonly { id: string; name: string }[] } }[] }[]
  loading?: boolean
  onPick?: (provider: string, model: string, effort?: string) => void | Promise<void>
  locked: boolean
}): ReactElement | null {
  const groups = useMemo(() => (props.groups ?? []).map(group => ({
    ...group,
    models: group.models.map(model => ({
      ...model,
      ...(model.reasoning === undefined ? {} : {
        reasoning: {
          ...(model.reasoning.defaultEffort === undefined ? {} : { defaultEffort: model.reasoning.defaultEffort }),
          ...(model.reasoning.efforts === undefined ? {} : { efforts: model.reasoning.efforts }),
        },
      }),
    })),
  })), [props.groups])
  const current = useMemo<{ provider: string; model: string; reasoningEffort?: string } | null>(() => {
    const group = groups.find(candidate => candidate.models.some(model => model.name === props.label))
    const model = group?.models.find(candidate => candidate.name === props.label)
    return group === undefined || model === undefined ? null : { provider: group.id, model: model.id, ...(props.effort === undefined ? {} : { reasoningEffort: props.effort }) }
  }, [groups, props.label, props.effort])
  const store = useMemo(() => {
    let snapshot: AnyRecord = { status: 'ready', groups, current, pending: null, failures: [], error: null, retainedEffort: props.effort ?? null }
    const listeners = new Set<() => void>()
    const notify = (): void => { for (const listener of listeners) listener() }
    return {
      directory: { subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }, getSnapshot: () => snapshot },
      setCurrent: (selection: typeof current): void => { snapshot = { ...snapshot, current: selection }; notify() },
      setPending: (selection: typeof current): void => { snapshot = { ...snapshot, pending: selection }; notify() },
    }
  }, [groups, current, props.effort])
  const ModelSelect = props.ui.ModelSelect as unknown as (value: AnyRecord) => ReactElement
  return (
    <ModelSelect
      locked={props.locked}
      available={groups.length > 0}
      directory={store.directory}
      load={() => Promise.resolve()}
      select={async (selection: any) => {
        store.setPending(selection)
        try {
          await props.onPick?.(selection.provider, selection.model, selection.reasoningEffort)
          store.setCurrent(selection)
          return { ok: true }
        } catch (error) {
          return { ok: false, error: { code: 'select-failed', message: error instanceof Error ? error.message : String(error) } }
        } finally {
          store.setPending(null)
        }
      }}
      t={modelT}
      renderSlot={((_name: string, _props: unknown, options?: { fallback?: unknown }) => options?.fallback ?? null) as never}
    />
  )
}

function AttachmentRail(props: { items: readonly AnyRecord[]; uploads: Record<string, unknown>; local: ReadonlyMap<string, ComposerAttachment>; onRemove: (id: string) => void }): ReactElement | null {
  if (props.items.length === 0) return null
  return (
    <div className="dsh-rwv-official-attachments">
      {props.items.map(item => (
        <div key={String(item.id)} className="dsh-rwv-official-attachment" title={String(item.file?.name ?? '')}>
          {(item.kind === 'image' || props.local.get(String(item.id))?.mediaType.startsWith('image/')) && typeof (item.previewUrl ?? (props.local.get(String(item.id)) as (ComposerAttachment & { previewUrl?: string }) | undefined)?.previewUrl) === 'string'
            ? <img src={String(item.previewUrl ?? (props.local.get(String(item.id)) as (ComposerAttachment & { previewUrl?: string }) | undefined)?.previewUrl)} alt="" />
            : <span>{String(item.file?.name ?? '')}</span>}
          <button type="button" className="dsh-rwv-official-attachment-remove" onClick={() => { props.onRemove(String(item.id)) }} aria-label={'移除'}>×</button>
        </div>
      ))}
    </div>
  )
}
