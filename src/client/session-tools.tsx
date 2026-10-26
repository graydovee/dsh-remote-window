/**
 * Official-block adapters for tool calls/results in the v2 timeline.
 *
 * Reused DSH primitives: `TerminalBlock`, `ReadBlock`, `SearchBlock`,
 * `DiffBlock`, `CodeBlock`, `JsonBlock`. The only self-drawn shell is the
 * per-result status line (running/error/truncated) because those blocks draw
 * only their own body. Tool payloads arrive as model-facing text, so the
 * adapters below parse the small set of shapes the official tool renderers
 * understand and fall back to `CodeBlock` when a shape is unknown.
 */
import { useState } from 'react'
import type { ReactElement } from 'react'
import {
  CodeBlock, DiffBlock, IconCheckCircleFillRegular, IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular, IconWarningTriangleOutlineRegular, JsonBlock, ReadBlock, SearchBlock,
  TerminalBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SessionTimelineToolCallEntry, SessionTimelineToolResultEntry,
} from './session-timeline.ts'
import { t } from './locales.ts'

/* The plugin's ambient platform shim predates these block exports; declare the
   bindings used here (the browser platform module ships them). */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  export function TerminalBlock(props: any): any
  export function ReadBlock(props: any): any
  export function SearchBlock(props: any): any
  export function DiffBlock(props: any): any
  export function CodeBlock(props: any): any
  export function JsonBlock(props: any): any
}

/** Reusable localized chrome for the official code-card family. */
const CODE_LABELS = {
  codeLabel: t('session.block.code'),
  wrapLabel: t('session.block.wrap'),
  unwrapLabel: t('session.block.unwrap'),
}
const CODE_COPY = { copyLabel: t('session.block.copy'), copiedLabel: t('session.block.copied') }

const TERMINAL_LABELS = {
  signal: (signal: string) => t('session.block.terminal.signal', { signal }),
  exitCode: (code: number) => t('session.block.terminal.exitCode', { code }),
  noExitCode: t('session.block.terminal.noExitCode'),
  running: t('session.tool.status.running'),
  failed: t('session.tool.status.error'),
  done: t('session.tool.status.done'),
  copy: t('session.block.copy'),
  copied: t('session.block.copied'),
  noOutput: t('session.block.terminal.noOutput'),
  collapseAria: t('session.block.collapse'),
  collapse: t('session.block.collapse'),
  expandAria: (hidden: number) => t('session.block.expandAria', { hidden }),
  expand: (hidden: number) => t('session.block.expand', { hidden }),
}
const READ_LABELS = {
  ...CODE_LABELS,
  window: (shown: number, total: number) => t('session.block.read.window', { shown, total }),
  copy: t('session.block.copy'),
  copied: t('session.block.copied'),
  collapseAria: t('session.block.collapse'),
  expandAria: (hidden: number) => t('session.block.expandAria', { hidden }),
  collapse: t('session.block.collapse'),
  expand: (hidden: number) => t('session.block.expand', { hidden }),
}
const SEARCH_LABELS = {
  pathsSummary: (shown: number, total: number, truncated: boolean) =>
    t(truncated ? 'session.block.search.pathsTruncated' : 'session.block.search.paths', { shown, total }),
  matchesSummary: (shown: number, total: number, files: number, truncated: boolean) =>
    t(truncated ? 'session.block.search.matchesTruncated' : 'session.block.search.matches', { shown, total, files }),
  copy: t('session.block.copy'),
  copied: t('session.block.copied'),
  noResults: t('session.block.search.noResults'),
  collapseAria: t('session.block.collapse'),
  expandAria: (hidden: number) => t('session.block.expandAria', { hidden }),
  collapse: t('session.block.collapse'),
  expand: (hidden: number) => t('session.block.expand', { hidden }),
}
const DIFF_LABELS = {
  ...CODE_LABELS,
  copy: t('session.block.copy'),
  copied: t('session.block.copied'),
  collapseAria: t('session.block.collapse'),
  expandAria: (hidden: number) => t('session.block.expandAria', { hidden }),
  collapse: t('session.block.collapse'),
  expand: (hidden: number) => t('session.block.expand', { hidden }),
}

/** The official block family a tool result should use. */
export type ToolBlockKind = 'terminal' | 'read' | 'search' | 'diff' | 'json' | 'code'

/** Pick a block from the tool name (tool args/results refine it). */
export function toolBlockKind(name: string | undefined): ToolBlockKind {
  const lower = (name ?? '').toLowerCase()
  if (/bash|shell|terminal|command|exec/.test(lower)) return 'terminal'
  if (/edit|write|patch|apply|diff/.test(lower)) return 'diff'
  if (/read|cat|view/.test(lower)) return 'read'
  if (/grep|search|glob|find|list/.test(lower)) return 'search'
  if (/json/.test(lower)) return 'json'
  return 'code'
}

/** Render tool arguments as a stable string for the JsonBlock fallback. */
export function formatToolArguments(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** Parse a `read` result into official ReadBlock lines. */
export function parseReadOutput(text: string): { lines: { number: number; text: string }[]; totalLines: number } {
  const raw = text.split('\n')
  const lines: { number: number; text: string }[] = []
  for (const line of raw) {
    // Accepted official shapes: `12→content`, `12 | content`, `12: content`.
    const match = /^\s*(\d+)\s*(?:→|\||:)\s?(.*)$/.exec(line)
    if (match !== null) {
      lines.push({ number: Number(match[1]), text: match[2] ?? '' })
    } else {
      lines.push({ number: lines.length + 1, text: line })
    }
  }
  while (lines.length > 1 && lines[lines.length - 1]?.text === '') lines.pop()
  return { lines, totalLines: Math.max(lines.length, lines[lines.length - 1]?.number ?? 0) }
}

/** Parse a `grep` result into the official SearchBlock matched-files shape. */
export function parseSearchOutput(text: string): { kind: 'matches'; files: { path: string; matches: { lineNumber: number; line: string }[] }[]; total: number } | undefined {
  const files = new Map<string, { lineNumber: number; line: string }[]>()
  for (const raw of text.split('\n')) {
    const match = /^(.+?):(\d+):(.*)$/.exec(raw)
    if (match === null) continue
    const path = match[1] ?? ''
    const lineNumber = Number(match[2])
    if (path === '' || !Number.isFinite(lineNumber)) continue
    const list = files.get(path) ?? []
    list.push({ lineNumber, line: match[3] ?? '' })
    files.set(path, list)
  }
  if (files.size === 0) return undefined
  return {
    kind: 'matches',
    files: [...files.entries()].map(([path, matches]) => ({ path, matches })),
    total: [...files.values()].reduce((sum, matches) => sum + matches.length, 0),
  }
}

/** Parse a simple unified diff into official DiffBlock hunks; undefined if it is not a diff. */
export function parseDiffOutput(text: string): { path: string; oldText: string | null; newText: string }[] | undefined {
  const results: { path: string; oldText: string | null; newText: string }[] = []
  let current: { path: string; old: string[]; next: string[] } | undefined
  for (const line of text.split('\n')) {
    if (line.startsWith('--- ')) {
      if (current !== undefined) results.push({ path: current.path, oldText: current.old.join('\n') || null, newText: current.next.join('\n') })
      current = { path: line.slice(4).trim(), old: [], next: [] }
      continue
    }
    if (current === undefined) continue
    if (line.startsWith('+++ ')) { current.path = line.slice(4).trim() || current.path; continue }
    if (line.startsWith('@@')) continue
    if (line.startsWith('-')) current.old.push(line.slice(1))
    else if (line.startsWith('+')) current.next.push(line.slice(1))
    else if (line.startsWith(' ')) { current.old.push(line.slice(1)); current.next.push(line.slice(1)) }
  }
  if (current !== undefined) results.push({ path: current.path, oldText: current.old.join('\n') || null, newText: current.next.join('\n') })
  return results.length === 0 ? undefined : results
}

function readPath(args: Record<string, unknown> | undefined): string | undefined {
  for (const key of ['path', 'file_path', 'file', 'target']) {
    const value = args?.[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

function readCommand(args: Record<string, unknown> | undefined): string | undefined {
  for (const key of ['command', 'cmd', 'script']) {
    const value = args?.[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

/** One official-block body for a tool result. */
function ToolResultBody(props: {
  call: SessionTimelineToolCallEntry | undefined
  result: SessionTimelineToolResultEntry
}): ReactElement {
  const name = props.call?.name ?? props.result.name
  const kind = toolBlockKind(name)
  const text = props.result.output
  const args = props.call?.arguments !== undefined && typeof props.call.arguments === 'object' && props.call.arguments !== null
    ? props.call.arguments as Record<string, unknown> : undefined
  if (kind === 'terminal') {
    return (
      <TerminalBlock
        command={typeof props.call?.arguments === 'string' ? props.call.arguments : readCommand(args) ?? t('session.tool.call')}
        output={text}
        exitCode={props.result.isError === true ? 1 : 0}
        running={props.call?.status === 'running'}
        labels={TERMINAL_LABELS}
      />
    )
  }
  if (kind === 'read') {
    const parsed = parseReadOutput(text)
    return (
      <ReadBlock
        {...(readPath(args) === undefined ? {} : { label: readPath(args) })}
        lines={parsed.lines}
        totalLines={parsed.totalLines}
        labels={READ_LABELS}
      />
    )
  }
  if (kind === 'search') {
    const matches = parseSearchOutput(text)
    if (matches !== undefined) {
      return (
        <SearchBlock
          kind="matches"
          files={matches.files}
          total={matches.total}
          truncated={props.result.truncated === true}
          labels={SEARCH_LABELS}
        />
      )
    }
    const paths = text.split('\n').map(line => line.trim()).filter(line => line !== '')
    return (
      <SearchBlock
        kind="paths"
        paths={paths}
        total={paths.length}
        truncated={props.result.truncated === true}
        labels={SEARCH_LABELS}
      />
    )
  }
  if (kind === 'diff') {
    const diffs = parseDiffOutput(text)
    if (diffs !== undefined) return <DiffBlock diffs={diffs} labels={DIFF_LABELS} />
    const before = typeof args?.['oldText'] === 'string' ? args['oldText'] : typeof args?.['old_string'] === 'string' ? args['old_string'] : null
    const after = typeof args?.['newText'] === 'string' ? args['newText'] : typeof args?.['new_string'] === 'string' ? args['new_string'] : text
    const path = readPath(args) ?? name ?? 'tool'
    return <DiffBlock diffs={[{ path, oldText: before, newText: after }]} labels={DIFF_LABELS} />
  }
  if (kind === 'json') {
    try {
      return <JsonBlock label={t('session.tool.result')} payload={JSON.parse(text)} truncatedLabel={(total: number) => t('session.block.jsonTruncated', { total })} />
    } catch {
      // fall through to CodeBlock
    }
  }
  return <CodeBlock code={text} copyLabel={t('session.block.copy')} copiedLabel={t('session.block.copied')} toolbarLabels={CODE_LABELS} />
}

/** Collapsed arguments header for a tool call (official Json/Code block body). */
function ToolCallBody(props: { entry: SessionTimelineToolCallEntry }): ReactElement | null {
  const value = props.entry.arguments
  if (value === undefined) return null
  if (typeof value === 'string') {
    return <CodeBlock code={value} copyLabel={t('session.block.copy')} copiedLabel={t('session.block.copied')} showHeader={false} />
  }
  return <JsonBlock label={t('session.tool.arguments')} payload={value} defaultOpen={false} truncatedLabel={(total: number) => t('session.block.jsonTruncated', { total })} />
}

/** One tool invocation card. */
export function ToolCallCard(props: { entry: SessionTimelineToolCallEntry }): ReactElement {
  const [open, setOpen] = useState(false)
  const status = props.entry.status ?? 'running'
  return (
    <div className="dsh-rw-session-tool" data-status={status} data-kind="call">
      <button
        type="button"
        className="dsh-rw-session-tool-head"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
      >
        <span className="dsh-rw-session-tool-toggle" aria-hidden="true">
          {open ? <IconChevronDownOutlineRegular size={12} /> : <IconChevronRightOutlineRegular size={12} />}
        </span>
        <span className="dsh-rw-session-tool-kind">{t('session.tool.call')}</span>
        <code className="dsh-rw-session-tool-name">{props.entry.name}</code>
        <span className="dsh-rw-session-tool-status">{t(`session.tool.status.${status}` as Parameters<typeof t>[0])}</span>
      </button>
      {open && <ToolCallBody entry={props.entry} />}
    </div>
  )
}

/** One tool result card; the body is the official block chosen for the tool. */
export function ToolResultCard(props: {
  entry: SessionTimelineToolResultEntry
  /** The paired call supplies the command/path/arguments the official block needs. */
  call?: SessionTimelineToolCallEntry | undefined
}): ReactElement {
  const error = props.entry.isError === true
  return (
    <div className="dsh-rw-session-tool" data-status={error ? 'error' : 'done'} data-kind="result">
      <div className="dsh-rw-session-tool-head" role="status">
        <span className="dsh-rw-session-tool-icon" aria-hidden="true">
          {error ? <IconWarningTriangleOutlineRegular size={13} /> : <IconCheckCircleFillRegular size={13} />}
        </span>
        <span className="dsh-rw-session-tool-kind">{t(error ? 'session.tool.resultError' : 'session.tool.result')}</span>
        {props.entry.name !== undefined && props.entry.name !== ''
          ? <code className="dsh-rw-session-tool-name">{props.entry.name}</code>
          : null}
        {props.entry.truncated === true && <span className="dsh-rw-session-tool-note">{t('session.tool.truncated')}</span>}
      </div>
      <div className="dsh-rw-session-tool-body">
        <ToolResultBody call={props.call} result={props.entry} />
      </div>
    </div>
  )
}
