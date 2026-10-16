# dsh-remote-workspace

A DeepSeek Harness client plugin that connects an SSH host as a remote execution workspace while keeping the agent loop, model requests, and credentials local.

The plugin is the client half of the Remote Session architecture. It owns SSH and host-key verification, target credentials, connection state, remote workspace discovery, `RemotePersistence`, and the tree/chat UI. Session logs are authoritative on the remote server and are accessed through the official DSH `SessionPersistence` contract.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

The server half lives in [`../dsh-remote-workspace-server`](../dsh-remote-workspace-server). The two projects keep synchronized copies of `src/protocol.ts`; update both copies together.

## Security

SSH credentials never cross the session protocol. Unknown host keys require explicit confirmation, changed host keys abort, and errors sent to the UI are scrubbed for secrets.
