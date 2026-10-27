# Vendored official DSH Conversation/Chat client bundles

Source: `@deepseek-ai/dsh-client-ui-conversation@0.2.1-rc.3` and
`@deepseek-ai/dsh-client-ui-chat@0.2.1-rc.3` (DSH tag `dsh-v0.2.1-rc.3`,
commit `1f81c047fc`).

The files are the official package `lib/client.js` builds with only the outer
module wrapper changed:

- the wrapper assigns the CJS factory to `window.__DSH_OFFICIAL_UI_LOAD__`
  (`conversation-client.js`) or `window.__DSH_OFFICIAL_CHAT_LOAD__`
  (`chat-client.js`) instead of calling `window.__ModuleLoader__.load`;
- the returned exports additionally expose the components the remote adapter
  mounts: `InputBar`, `SessionInputShell`, `ConversationSessionHeader`,
  `conversationCss`; `UserContent`, `AssistantMarkdown`,
  `UserMessageNodeView`, `MessageIconActions`, `ReasoningRow`.

No component code, CSS or behavior was rewritten. The browser adapter in
`src/client/official-ui-runtime.ts` evaluates these factories with the page's
platform `require` table. The readable CSS copy used by the adapter is generated
by `scripts/vendor-official-ui.mjs` from the same tag.

The approval panel is the official `@deepseek-ai/dsh-client-ui-approval@0.2.1-rc.3`
`lib/client.js`, with the same outer-wrapper patch (`approval-client.js`)
exporting `ApprovalPanel`. The bundle injects its own official CSS.
