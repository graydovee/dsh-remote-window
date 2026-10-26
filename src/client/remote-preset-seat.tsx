/**
 * The fixed "remote execution" chip for a remote workspace draft.
 *
 * The shell's hero agent-preset seat is a global roster: every per-target
 * remote preset appears there, so the picker reads as a connection selector and
 * lets a draft choose another target (or a local standard/PTC preset) before
 * the session exists. A remote workspace does not have a mode choice: its target
 * owns the execution world. While a remote draft is open we therefore shadow the
 * official seat with this read-only chip; when the draft closes the entry is
 * disposed and the official picker returns for local workspaces.
 *
 * The host still has the final say: `src/remote-stub.ts` vetoes any session
 * whose stub cwd is combined with a non-target preset.
 */
import type { ReactElement } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContext } from './context.ts'
import { t } from './locales.ts'
import { remoteDraftTarget } from './remote-draft.ts'
import { appStateSnapshot, subscribeAppState, useAppState } from './store.ts'

/** The chip drawn in place of the official preset picker. */
export function RemotePresetSeat(): ReactElement | null {
  const state = useAppState()
  const remote = remoteDraftTarget(state)
  if (remote === undefined) return null
  const hint = t('tree.remotePreset.hint')
  return (
    <Tooltip label={hint} side="bottom" delayMs={400}>
      <span className="dsh-rw-remote-preset" title={hint} data-target={remote.targetId}>
        <span className="dsh-rw-remote-preset-dot" aria-hidden="true" />
        <span>{t('tree.remotePreset.label', { label: remote.label })}</span>
      </span>
    </Tooltip>
  )
}

/**
 * Register the conditional seat for the lifetime of the slot owner.
 *
 * A single-slot entry shadows the official chip only while a remote draft is
 * open. The entry is created/disposed from the store subscription, not during
 * React render, so the local workspace path keeps the official picker untouched.
 * @param ctx - client context with the `slots` service.
 * @returns the disposer of the slot injection.
 */
export function registerRemotePresetSeat(ctx: ClientContext): () => void {
  return ctx.slots.inject('conversation.hero.agentPreset', () => {
    let entry: (() => void) | undefined
    let failed = false
    const sync = (): void => {
      const remote = remoteDraftTarget(appStateSnapshot())
      if (remote === undefined) {
        entry?.()
        entry = undefined
        return
      }
      if (entry !== undefined || failed) return
      try {
        entry = ctx.slots.register({
          name: 'conversation.hero.agentPreset',
          // Lower priority renders first; the official entry is the fallback
          // the moment this one is disposed.
          priority: -1,
        }, RemotePresetSeat)
      } catch (error) {
        failed = true
        console.error('[dsh-remote-workspace] remote preset seat registration failed', error)
      }
    }
    const stop = subscribeAppState(sync)
    sync()
    return () => {
      stop()
      entry?.()
      entry = undefined
    }
  })
}
