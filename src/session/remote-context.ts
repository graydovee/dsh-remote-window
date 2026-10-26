/**
 * Model-facing facts for a local-agent / remote-world session.
 *
 * DSH's working-directory context describes the process that owns the Agent.
 * In local mode that process is on the client, while bash/fs calls run on the
 * target. The model only needs the execution host and the real remote cwd; the
 * anchor, SSH lifecycle and sandbox mechanics are DSH implementation details and
 * stay out of the prompt. A scoped `working-directory:current` shadows the
 * official client-anchor context without changing the tool routing.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Target facts a local-mode session needs to describe its execution host. */
export interface RemoteContextTarget {
  readonly label: string
  readonly host: string
  readonly port: number
  readonly username: string
}

/** Options for {@link installRemoteContext}. */
export interface RemoteContextOptions {
  readonly target: RemoteContextTarget
  /** Server-real working directory; undefined until the workspace is learned. */
  readonly remotePath?: string | undefined
}

/** Build the execution-host line (pure; exported for tests). */
export function executionHostText(target: RemoteContextTarget): string {
  return `Execution host: ${target.label} (${target.username}@${target.host}:${target.port}).`
}

/** Build the remote working-directory line (pure; exported for tests). */
export function remoteWorkingDirectoryText(remotePath: string): string {
  return `Current working directory: ${JSON.stringify(remotePath)}.`
}

interface PromptContextValue {
  readonly name: string
  readonly order: number
  readonly interpolate: boolean
  readonly required?: boolean
  readonly text: string
}

interface PromptService {
  context?(value: PromptContextValue): unknown
  getContextOrder?(name: string): number
}

/** Install the context contributions on one Agent scope (no-op without systemPrompt). */
export function installRemoteContext(ctx: Context, options: RemoteContextOptions): void {
  const direct = (ctx as unknown as { systemPrompt?: PromptService }).systemPrompt
  const service = direct ?? ((ctx as unknown as { get?: (name: string) => unknown }).get?.('systemPrompt') as PromptService | undefined)
  if (service?.context === undefined) return
  const order = service.getContextOrder?.('WORKING_DIRECTORY') ?? 0
  if (options.remotePath !== undefined && options.remotePath !== '') {
    // Same name as the official contribution: scoped registration shadows it.
    service.context({
      name: 'working-directory:current',
      order,
      required: true,
      interpolate: false,
      text: remoteWorkingDirectoryText(options.remotePath),
    })
  }
  service.context({
    name: 'remote-workspace/execution-host',
    order: order + 1,
    interpolate: false,
    text: executionHostText(options.target),
  })
}
