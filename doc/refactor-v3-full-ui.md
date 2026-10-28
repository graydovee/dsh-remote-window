# v3：全屏官方 UI + 本地模型来源

本文件是 v3 的架构与实现契约。v2 的 native 对话主区（`session-main.tsx` 与
`assets/official-ui/` 的 vendored 会话组件）在 v3 不再是生产路径：主区改为 server profile 官方
DSH UI 的全屏同源 iframe；模型来源新增 **local（本机模型，默认）** 与 **server（server 自身模型）**。
数据权威、SSH、profile、host key、连接对话框全部沿用 v1/v2，不改变。

实现状态（本分支）：

| 部分 | 状态 |
|---|---|
| client iframe 外壳 / target rail / 连接生命周期 | 已完成 |
| server 插件 embed `full` 模式 | 已完成（server 仓库，随 tarball 内置） |
| 本地模型 bridge + SSH 反向隧道 + profile patch | 已完成（`src/local-llm/`） |
| 连接对话框模型来源设置 | 已完成 |
| native v2 主区与 vendored 组件删除 | 验收后清理，代码暂留但不注册/不挂载 |

## 1. 目标架构

```text
client DSH
├─ 连接对话框（沿用 v1：SSH/host-key/运行时/profile）
├─ 浮动 target rail（唯一 client chrome，默认折叠）
│   └─ target 状态、切换、连接/断开/忘记
└─ main slot：<iframe src="/dsh-remote-workspace/portal/<targetId>/?dshRwFull=1">
      └─ server profile 官方 DSH UI（sidebar/header/主区/rightbar/插件 UI）
```

- iframe 是 client 主区唯一内容；client shell 自己的 sidebar 在 iframe 挂载期间隐藏
  （`html[data-dsh-rw-portal] [data-slot="sidebar"]`），root grid 收成一列，官方 sidebar 就是导航。
- **不复制**官方 sidebar 的 workspace/session 树到 client；target rail 只列 target 与连接状态。
- iframe 同源：portal 反向代理剥 client cookie、注入 profile server cookie、剥 `Set-Cookie`，
  profile token 只存在 client host 内存，URL 中永不出现。
- iframe sandbox：`allow-scripts allow-same-origin allow-forms allow-popups allow-downloads`；
  不开放 top-navigation。
- `dshRwFull=1` 使 server 插件不注入隐藏 sidebar/rightbar/bottom 的 CSS；bootstrap 仍设置 storage
  shim、主题/语言、`dsh-rw/ready` 与 `dshRwSession` 深链。`full=1` 是兼容拼写。

### iframe 生命周期

- 连接成功（新连接或 rail 点击已停止 target）→ `activateRemoteTarget` → `openServerMain`。
- 切换 target：`closeServerMain` → 新请求；iframe key 为 `targetId:revision:reloadCount`，
  每次激活递增 revision，浏览器不会复用上一个 profile 的文档。
- 断连/忘记/连接离开 ready/删除：`releaseTarget` → `closePortalFor` → `clearRemoteSelection`。
- 20 s 内未收到 `dsh-rw/ready`（且 `onLoad` 也未完成）显示可重试错误；重试递增 `reloadCount`。
- 401/登录过期：client host 重新拿 profile token 后可重连；token 不进入 iframe URL。

## 2. 本地模型来源

### 2.1 数据路径

```text
server profile agent
  └─ 官方 llm-pi-ai route "client-local"（openai-completions）
       baseURL = http://127.0.0.1:<random server-loopback port>/v1
       apiKeyEnv = DSH_RW_LOCAL_LLM_KEY（占位值 local-bridge）
            └─ SSH reverse tunnel（ssh2 client.forwardIn('127.0.0.1', 0)）
                 └─ client host bridge（127.0.0.1:<ephemeral>）
                      └─ 用户配置的本地 OpenAI-compatible endpoint
```

- 只替换模型来源；agent、会话日志、workspace、文件、工具执行仍在 server。
- 本地 endpoint/模型/超时存 client 存储域 `dsh_remote_workspace` 的 global `localLlm`（可选字段，
  域版本仍为 1）；API key 只存官方 `ctx.credentials`（固定 key），浏览器只看到 `hasApiKey`。
- profile 的 `cordis.patch.yml` 每次连接重写：反向隧道端口随机，旧端口必然失效。server 模式写 `[]`。
- patch 覆盖官方 row `llm-pi-ai`（声明 `client-local` route 与模型清单）和 `agent-default-model`
  （默认 provider/model）。模型清单来自 connected 前的 `/v1/models` 探测或已存清单。
- 未配置/不可达/401/无模型：在启动 profile 前以 coded error 失败，**不静默回退**到 server 模型；
  `forwardIn` 被 sshd 拒绝时返回 `local-llm-forwarding-unavailable`（424）。
- 连接失败、`stop()`、`reconnectLost()` 都关闭 bridge + tunnel；多 target 各自独立，切换不串流。

### 2.2 连接设置

连接对话框 config 步骤的「模型来源」区块（不新增步骤）：

- 单选 **本地模型（默认）** / **server 模型**；
- 本地 endpoint、API key（只写本机凭据，输入后不回显）、「保存并刷新模型」；
- 模型 chips 显示探测结果，第一个作为默认；
- 未配置 endpoint 时 config → connect 被阻止，connect 若被绕过由 host 以
  `local-llm-unconfigured` 拒绝；用户显式选 server 才走 server provider。

`v1/connect` body 增加可选 `modelSource`；target 记录增加可选 `modelSource`，`executor` 轴保持原义
（v3 的 iframe 主区始终由 server 官方 UI 打开 server 侧 agent，因此 executor=local 的旧记录不会触发
client 本地 agent）。解析顺序：request 显式值 → 已存记录（无 `modelSource` 的 v2 记录按
`effectiveModelSource` 回落到 `executor` 推导值，即 server 记录重连仍是 server 模型）→ 新连接默认
`local`。

## 3. 失败模式

| 场景 | 行为 |
|---|---|
| 本地未配置 | 连接被阻止 / host `local-llm-unconfigured`；不 fallback |
| endpoint 拒绝/超时 | `local-llm-unauthorized` / `local-llm-unreachable`；profile 不启动 |
| 无模型 | `local-llm-no-models`；profile 不启动 |
| sshd 禁止 forwardIn | `local-llm-forwarding-unavailable`；不降级 |
| iframe 20 s 未 ready | 主区错误 + 重试；连接保持，可断开重连 |
| target 断开/忘记 | iframe、bridge、tunnel 一起清理 |
| 401/token 过期 | 重连后重挂 iframe；token 不进 URL |

## 4. 测试与验收

- client：`portal-url`（URL/query/reducer）、`client-portal-main`（full=1、sandbox、remount key、
  close）、`client-target-rail`（激活/连接/断开/忘记）、`client-remote-store`（激活生命周期与本地模型
  设置/探测/阻止）、`local-llm-*`（bridge/tunnel/profile/settings）。
- server：`server-plugin-embed`（full marker、CSS gate、tapIndex 注入一次）。
- 手工：连接真实 target，确认官方 sidebar/header/主区/rightbar 与第三方 UI 插件全可见；本地模型完成
  一轮对话；server 模型完成一轮；断网/endpoint down 显示可读错误。
- `pnpm typecheck` / `pnpm test` / `pnpm build` 两仓全绿；三份共享文件 `cmp` 一致；内置 tarball 版本与
  sha256 与 server 仓库产物一致。

实现坐标（便于 review）：

| 关注点 | 文件 |
|---|---|
| iframe 外壳 / sandbox / remount / ready 超时 | `src/client/portal-main.tsx` |
| 浮动 target rail | `src/client/rail.tsx`、`src/client/styles.ts` |
| 连接生命周期、激活/清理、本地模型设置命令 | `src/client/remote-store.ts`、`src/client/remote-api.ts` |
| 连接对话框模型来源区块 | `src/client/remote-dialogs.tsx` |
| host 路由 `local-llm/*`、`v1/connect` 的 `modelSource` | `src/index.ts`、`src/local-llm/routes.ts` |
| 设置/凭据/探测 | `src/local-llm/settings.ts` |
| bridge / 反向隧道 / service 生命周期 | `src/local-llm/bridge.ts`、`src/local-llm/tunnel.ts`、`src/local-llm/service.ts` |
| 反向隧道 SSH 接缝 | `src/provision/profile-service.ts`（`ProfileConnection.remoteForward`） |
| profile patch 与 env | `src/local-llm/profile.ts`、`src/provision/profile-lifecycle.ts` |
| server 插件 full 模式 | server 仓库 `src/server-plugin/embed.ts` |

本分支实测证据（2026-08 本地运行）：

- client：`pnpm typecheck` 通过；`pnpm test` **579 passed / 1 skipped**（64 通过 + 1 跳过，65 文件）；
  `pnpm build` 通过。
- server：`pnpm typecheck` 通过；`pnpm test` **69 passed**（15 文件）；`pnpm build` 通过。
- 共享文件 `src/protocol.ts`、`src/frame/codec.ts`、`src/frame/mux.ts` 两仓 `cmp` 一致。
- 内置 tarball `dsh-remote-workspace-server-0.1.0-alpha.3.tgz` 88,977 B，sha256
  `f7fa2112165462df3dc8803ae39db1ebaea091feb97af112107e66f9464bf272`，与 `assets/server-plugin/checksums.json`
  一致。
- server 插件在干净 `DSH_HOME` 下 rc.3 隔离冒烟：`/?dshRwFull=1` 与 `/` 字节一致（38,122 B），bootstrap
  同步打 full 标记，embed.css 585 B 未受影响，portal 风格 WS 握手到 profile 返回 101。

### 浏览器 E2E 验收（临时 `DSH_HOME`，本机回环）

环境：桌面版 rc.3 CLI 起干净 profile；fake sshd（回环、密码认证）与 fake OpenAI 兼容服务模拟远端与
本机模型，全程不接触真实主机与真实凭据。

- 连接对话框（v3 文案、模型来源默认 local）：SSH → host key SHA-256 展示并确认 → 全局 runtime 复用 →
  专用 profile 离线安装 server plugin → 启动 profile server → portal 打开；首次连接暴露的 ssh2
  host-key 崩溃已修复并加回归测试 `tests/ssh-connect.test.ts`。
- 全屏官方 UI：iframe 内是 server profile 自带的官方 sidebar/header/会话/composer/账号菜单（同源
  portal，`dshRwFull=1`）；client 自己的 sidebar 在挂载期间隐藏，只保留右下角浮动 rail。
- 远程功能：输入消息 → 官方 rollout 流式回复（经 local-llm bridge → SSH 反向隧道 → fake 模型），
  标题自动生成；刷新页面、断开重连、停止再启动后会话都会恢复；`停止` 后 profile server 进程退出。
- 已知限制：宿主进程被 SIGTERM/SIGKILL 硬杀时，profile server 可能短暂残留，需手动清理（正常
  `停止`/`断开` 会关闭）；rail 覆盖在官方 UI 右下角，属设计内的唯一 client chrome。

## 5. 清理阶段（验收后）

删除 `src/client/session-main.tsx`、`src/client/panel.tsx`、`src/client/session-composer*`、
`session-tools/approval/timeline/hero` 等 native 主区生产路径，以及 `assets/official-ui/`、相关 vendor
脚本与测试；保留 `portal`/`embed`（v3 重新成为主路径）与 `remote-store` 的连接/工作区命令。
