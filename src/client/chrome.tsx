/**
 * Body-level host for the plugin's floating surfaces.
 *
 * The connection dialogs and the notice toast must stay reachable while the
 * portal iframe owns the whole window, so they cannot live in the connection
 * panel (which is unmounted while a target is active). This module mounts one
 * React root into `<body>` and keeps it for the plugin's lifetime; the CSS
 * places it above `.dsh-rw-portal` (z-index 55).
 *
 * The official `Modal`/`Toast` portal themselves to `<body>`, so the host adds
 * no layout of its own — it only owns the React tree and its disposer.
 */
import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { NoticeToastHost } from './common.tsx'
import { RemoteDialogs } from './remote-dialogs.tsx'
import { dismissRemoteNotice, useRemoteAppState } from './remote-store.ts'

/** Marker attribute for the body-level chrome host (idempotent mounting). */
export const CHROME_HOST_ATTR = 'data-dsh-remote-workspace-chrome'

/** Every floating surface the plugin owns outside the slots. */
function RemoteChrome(): ReactElement | null {
  const state = useRemoteAppState()
  return (
    <>
      <RemoteDialogs />
      {state.notice !== undefined && (
        <NoticeToastHost notice={state.notice} onDismiss={dismissRemoteNotice} />
      )}
    </>
  )
}

/**
 * Mount the chrome host into `<body>`.
 *
 * Re-running replaces the previous host so a hot reload cannot leave two sets
 * of dialogs behind.
 * @returns a disposer that unmounts the React root and removes the host.
 */
export function mountRemoteChrome(): (() => void) | undefined {
  if (typeof document === 'undefined' || document.body === null) return undefined
  let disposed = false
  const existing = document.querySelector(`[${CHROME_HOST_ATTR}]`)
  existing?.remove()
  const container = document.createElement('div')
  container.setAttribute(CHROME_HOST_ATTR, '')
  container.className = 'dsh-rw-chrome'
  const root: Root = createRoot(container)
  root.render(<RemoteChrome />)
  document.body.appendChild(container)
  return () => {
    if (disposed) return
    disposed = true
    root.unmount()
    container.remove()
  }
}
