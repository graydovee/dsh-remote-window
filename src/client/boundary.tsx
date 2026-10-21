/**
 * The panel's last line of defence.
 *
 * The client is a bundle inside the shell's page: an exception thrown while
 * rendering the tree or the wizard unmounts the whole React root and leaves a
 * blank page with no way back (the shell has no error boundary of its own). This
 * boundary keeps the failure local — the console gets the real error, the user
 * gets a sentence and a reload hint — so a bad record can never take the whole
 * 远程工作区 page down.
 */
import { Component } from 'react'
import type { ErrorInfo, ReactElement, ReactNode } from 'react'
import { t } from './locales.ts'

interface BoundaryState {
  failed: boolean
}

/** Renders children, or a fallback after a render/lifecycle exception. */
export class RemoteTreeBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[dsh-remote-workspace] panel crashed', error, info.componentStack)
  }

  render(): ReactNode {
    return this.state.failed ? <CrashFallback /> : this.props.children
  }
}

/** What the user sees instead of a white page. */
function CrashFallback(): ReactElement {
  return (
    <div className="dsh-rw-page">
      <p className="dsh-rw-hint">{t('panel.crashed')}</p>
    </div>
  )
}
