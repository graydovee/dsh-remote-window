# dsh-remote-workspace

DeepSeek Harness 客户端插件：通过 SSH 把远端主机作为执行工作区，同时把 agent loop、模型请求和凭据留在本机。

这是 Remote Session 架构的 client 部分，负责 SSH 与 host key 校验、目标凭据、连接状态、远端工作区发现、`RemotePersistence` 以及树形/对话 UI。会话日志以远端 server 为唯一权威，并通过 DSH 官方 `SessionPersistence` 接口访问。

## 开发

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

server 部分位于 [`../dsh-remote-workspace-server`](../dsh-remote-workspace-server)。两个项目各保留一份同步的 `src/protocol.ts`，修改协议时必须同时更新。

## 安全

## Security

SSH 凭据不会进入会话协议；未知 host key 必须显式确认，host key 变化会中止连接，发送到 UI 的错误会先清理敏感信息。
