/**
 * Vendored from DSH 0.2.1-rc.3
 * `packages/client/ui-chat/src/client/chat/UserContent.tsx`.
 *
 * The remote adapter currently has no attachment payloads, so the attachment
 * and reference branches are intentionally absent. The text stack, bubble and
 * spacing classes are the official `MessageItem.module.css` classes; the text
 * itself is supplied by our `conversation.user.text` adapter slot.
 */
import type { ReactElement, ReactNode } from 'react'
import { messageCss } from '../classnames'

export interface UserContentProps {
  text: string
  renderText: (text: string) => ReactNode
}

export function UserContent(props: UserContentProps): ReactElement {
  return (
    <div className={messageCss.userStack}>
      <div className={messageCss.bubble}>
        {props.renderText(props.text)}
      </div>
    </div>
  )
}
