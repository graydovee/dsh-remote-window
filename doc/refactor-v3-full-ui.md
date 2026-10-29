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
| 本地模型自动代理（`ctx.llm` 枚举 + 原生 bridge）+ SSH 反向隧道 + per-provider profile patch | 已完成（`src/local-llm/`，`native.ts`） |
| 手动 OpenAI 兼容 endpoint | 仅 `bridge.ts` 旧路径/API 兼容，对话框不再提供 |
| 连接对话框模型来源设置（默认 local）+ 全部 provider/model 勾选代理 | 已完成（`localSelection`） |
| portal 必须带 `dshRwSession` 深链 | 已完成（`portalSessionFor`） |
| 重连复用已保存绝对 `DSH_HOME` | 已完成（`reconnectDshHome`） |
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
- 打开 portal 必须带 `dshRwSession`：`activateRemoteTarget` 先 `portalSessionFor`（host state 中最近
  的非 blank/非归档/非 subagent 会话，否则 `session/create` 建 blank），再 `openServerMain`。裸开
  portal 会落在官方首启 composer（“选择一个工作区开始”），且在 iframe 内无法恢复。
- 401/登录过期：client host 重新拿 profile token 后可重连；token 不进入 iframe URL。

## 2. 本地模型来源

### 2.1 数据路径

```text
server profile agent
  └─ 官方 llm-pi-ai routes（openai-completions，每个本机 provider 一条）
       route id = remote-<slug>，baseURL = http://127.0.0.1:<random>/<provider>/v1
       apiKeyEnv = DSH_RW_LOCAL_LLM_KEY（占位值 local-bridge）
            └─ SSH reverse tunnel（ssh2 client.forwardIn('127.0.0.1', 0)，单条隧道）
                 └─ client host bridge（127.0.0.1:<ephemeral>）
                      ├─ auto：按 provider 前缀调用本机 ctx.llm.stream()（原生类型，无 key 重填）
                      └─ manual：转发 /v1/* 到用户配置的 OpenAI-compatible endpoint（注入 key）
```

- 只替换模型来源；agent、会话日志、workspace、文件、工具执行仍在 server。
- auto 模式：`discoverLocalCatalog(ctx.llm)` 枚举本机 `listProviders()`/`listModels()`，每个 provider
  在 profile 里生成一条 route（路径前缀 `<provider>`），`agent-default-model` 取第一个 route 的首个
  模型；本机 DSH 自己的 provider 凭据/协议原样使用，client 不另存 key。`ctx.llm` 不存在时
  `local-llm-providers-unavailable`，目录为空时 `local-llm-no-models`。
- 选择过滤：高级选项保存的 `localSelection: [{providerId, models[]}]` 决定 profile 生成哪些 route
  （按目录顺序、未知项静默丢弃）；未保存选择 = 全量代理，过滤后为空 → `local-llm-no-models`（400）。
  选择存在 client 存储域 `dsh_remote_workspace` 的 global `localLlm`（可选字段，域版本仍为 1）。
- manual 模式仅为旧 API/测试保留（对话框不再提供）：endpoint/模型/超时存同上 `localLlm`，API key
  只存官方 `ctx.credentials`（固定 key），浏览器只看到 `hasApiKey`。
- bridge 必须把 adapter 的 error/aborted 终止 chunk 转成显式错误：首个 chunk 前 → HTTP 502 JSON
  `{error:{type:'model-call-failed'}}`；已开始流式 → OpenAI `error` chunk。不得把 failure 映射成
  `finish_reason:"stop"`，否则 server pi-ai 会得到空回复（EMPTY_RESPONSE）。
- profile 的 `cordis.patch.yml` 每次连接重写：反向隧道端口随机，旧端口必然失效。server 模式写 `[]`。
- 未配置/不可达/401/无模型：在启动 profile 前以 coded error 失败，**不静默回退**到 server 模型；
  `forwardIn` 被 sshd 拒绝时返回 `local-llm-forwarding-unavailable`（424）。
- 连接失败、`stop()`、`reconnectLost()` 都关闭 bridge + tunnel；多 target 各自独立，切换不串流。
- 重连必须复用上次 connect 解析出的绝对 `remote.dshHome`（`reconnectDshHome`）：profile patch、
  profile server、反向隧道和 server 调用都绑定这个 home；否则重连会把 patch 写到默认 home，server 仍
  指向旧 bridge 端口（表现为重连后模型请求超时）。

### 2.2 连接设置

连接对话框 config 步骤的「模型来源」区块收进 **高级选项**（不新增步骤）：

- 单选 **本地模型（默认）** / **server 模型**；选择 **server** 时不显示本地目录；
- 本地目录按 provider 分组列出**全部**发现到的模型，默认全选；每行 checkbox，provider 行支持全选/
  清空，底部提供「刷新」、已选统计与空/失败提示（`local-llm-providers-unavailable`）；
- 「刷新」调用 host `local-llm/discover`，读取 `local-llm/read` 同时返回完整目录 + 已存选择；
- 「下一步」前保存 `local-llm/save {mode:'auto', selection?}`；catalog 读取成功但为空且无已存选择时
  以 `local-llm-unconfigured` 阻止提交；目录读不到由 host 以 `local-llm-providers-unavailable` 拒绝；
- 选择持久化后重连生效（改选择 → 重连 → profile patch 只生成所选 route），server 会话内可在这些模型
  之间随意切换；
- 进度区在长步骤上显示 `已用 Ns` 与「等待…」提示，轮询连续失败 3 次显示告警（不静默）。

`v1/connect` body 增加可选 `modelSource`；target 记录增加可选 `modelSource`，`executor` 轴保持原义
（v3 的 iframe 主区始终由 server 官方 UI 打开 server 侧 agent，因此 executor=local 的旧记录不会触发
client 本地 agent）。解析顺序：request 显式值 → 已存记录（无 `modelSource` 的 v2 记录按
`effectiveModelSource` 回落到 `executor` 推导值，即 server 记录重连仍是 server 模型）→ 新连接默认
`local`。

## 3. 失败模式

| 场景 | 行为 |
|---|---|
| 本机 ctx.llm 不可用（auto） | `local-llm-providers-unavailable`（502）；不 fallback |
| 本机目录为空（auto） | `local-llm-no-models`；profile 不启动 |
| 选择过滤为空 | host `local-llm-no-models`（400）；profile 不启动 |
| manual（旧 API）未配置 | host `local-llm-unconfigured`；不 fallback |
| manual endpoint 拒绝/超时（旧 API） | `local-llm-unauthorized` / `local-llm-unreachable`；profile 不启动 |
| bridge 内模型调用失败 | 流式前 502 JSON、流式中 OpenAI error chunk；不再映射成空 stop |
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
| auto 目录发现 / 原生 bridge（ctx.llm.stream）| `src/local-llm/native.ts`、`src/local-llm/settings.ts`（`discoverLocalCatalog`） |
| manual bridge / 反向隧道 / service 生命周期 | `src/local-llm/bridge.ts`、`src/local-llm/tunnel.ts`、`src/local-llm/service.ts` |
| 深链 session 选择（portalSessionFor）| `src/client/remote-store.ts` |
| 重连复用 DSH_HOME（reconnectDshHome）| `src/targets/methods.ts`、`src/index.ts` |
| 反向隧道 SSH 接缝 | `src/provision/profile-service.ts`（`ProfileConnection.remoteForward`） |
| profile patch 与 env | `src/local-llm/profile.ts`、`src/provision/profile-lifecycle.ts` |
| server 插件 full 模式 | server 仓库 `src/server-plugin/embed.ts` |

本分支实测证据（本地运行，2026-10）：

- client：`pnpm typecheck` 通过；`pnpm test` **626 passed / 1 skipped**（67 通过 + 1 跳过，68 文件）；
  `pnpm build` 通过（`lib/client.js` 473.18 kB）。
- server：`pnpm typecheck` 通过；`pnpm test` **69 passed**（15 文件）；`pnpm build` 通过。
- 共享文件 `src/protocol.ts`、`src/frame/codec.ts`、`src/frame/mux.ts` 两仓 `cmp` 一致。
- client 包 `dsh-remote-workspace-0.1.0-alpha.3.tgz` 1,047,853 B，sha256
  `024d2bd9cb97043fd04c842954e163ede04d71183857295648c0c8ddc6508f89`。
- 内置 tarball `dsh-remote-workspace-server-0.1.0-alpha.3.tgz` 88,977 B，sha256
  `f7fa2112165462df3dc8803ae39db1ebaea091feb97af112107e66f9464bf272`，与 `assets/server-plugin/checksums.json`
  一致。
- server 插件在干净 `DSH_HOME` 下 rc.3 隔离冒烟：`/?dshRwFull=1` 与 `/` 字节一致（38,122 B），bootstrap
  同步打 full 标记，embed.css 585 B 未受影响，portal 风格 WS 握手到 profile 返回 101。

### 浏览器 E2E 验收（临时 `DSH_HOME`，本机回环）

环境：桌面版 rc.3 CLI 起干净 profile；fake sshd（回环、密码认证）与 fake OpenAI 兼容服务模拟远端与
本机模型，全程不接触真实主机与真实凭据。

- 连接对话框（v3 文案、模型来源默认 local、高级选项里的自动代理）：SSH → host key SHA-256 展示并确认 →
  全局 runtime 复用 → 专用 profile 离线安装 server plugin → 启动 profile server → portal 打开；首次
  连接暴露的 ssh2 host-key 崩溃已修复并加回归测试 `tests/ssh-connect.test.ts`。
- 模型选择（普通连接即验证；临时 debug 实例 + fake sshd/LLM）：高级选项列出 2 个 provider / 3 个
  模型并默认全选；取消勾选 DeepSeek（2 个模型）后连接成功，profile patch 只生成
  `remote-e2e-provider`（tunnel 51817），`agent-default-model` = `remote-e2e-provider/e2e-test-model`；
  portal 深链恢复会话后模型选择器为 `e2e-test-model`，发送「选择过滤验收：请回复收到」得到
  `本地模型 E2E 已收到：…`（已完成，用时 1 秒，3 轮 3 步），fake LLM 日志确认请求经所选 route 到达；
  profile patch 写出 `remote-deepseek-official` 与 `remote-e2e-provider` 两条 route（各自 baseURL
  `http://127.0.0.1:<tunnel>/<provider>/v1`），`agent-default-model` 取第一条 route 的首个模型；
  直接 curl `<tunnel>/e2e-provider/v1/models` 与 `/chat/completions` 均返回模型目录/正常回复。
- 深链恢复：命中 rail 的 target 时 iframe URL 带 `dshRwSession=<sessionId>`，打开后恢复该会话（而不是
  官方首启 composer）；无会话时先 `session/create` 建 blank 再带深链。
- 远程功能（headless Chrome + CDP 截图证据）：iframe 内切换模型到 `e2e-test-model` → 发送
  `自动代理验收：请回复收到` → 官方 rollout 流式回复 `本地模型 E2E 已收到：…`（用时 1 秒，2 轮 2 步），
  标题自动生成；链路 = server `remote-e2e-provider` → SSH 反向隧道 → client `ctx.llm.stream()`
  → 本机 pi-ai provider → fake OpenAI。刷新页面、断开重连、停止再启动后会话都会恢复；`停止` 后
  profile server 进程退出。
- 重连回归：`v1/connect {targetId}` 重连后 patch 仍写在保存的 `DSH_HOME`
  （`/tmp/dsh-e2e/server-dsh-home/...`，mtime 刷新、隧道端口更新），不再落到远端默认 home；
  回归测试 `tests/targets-reconnect.test.ts`。
- 浮动 rail 拖拽吸附（headless Chrome CDP 模拟 pointer 事件，`/tmp/dsh-e2e/cdp-rail.mjs`、
  `cdp-rail-vertical.mjs`）：收起时跟随吸附边——左侧竖排 44×352 @ (10,96)；上下为 44px 横排图标条
  （9 targets + 折叠按钮槽 → 352×44，chip 32×32；`railBarWidth(9)=318` 只算 chip 条）；拖到右缘 → `data-dock="right"`、x=1386、offset 398、写入
  `localStorage['dsh-remote-workspace.rail-dock']`；刷新后保持 top（折叠宽 352 = `railBarWidth(10)`，含折叠按钮槽）；
  拖回左缘 → y=278。**展开后不管哪条边都是同一个 280px 竖向列表**（`railBoxStyle` 负责贴边/限高/
  水平夹取）：上缘展开 y=10、高 427、chips 268×41 纵向排列；下缘展开贴底（y+h=803=813-10）；
  水平偏移夹在 [10, 视口-10-280]。截图 `/tmp/dsh-e2e/rail-top-vertical.jpg`、
  `/tmp/dsh-e2e/rail-bottom-vertical.jpg`。回归测试 `tests/client-target-rail.test.ts`
  （吸附/夹取/默认 dock/railBarWidth/railBoxStyle）。
- rail 收起态最小化（headless Chrome CDP，`/tmp/dsh-e2e/cdp-rail-minimize.mjs`，9 个连接）：竖排
  收起 44×350，折叠按钮在 rail 卡片内部、最后 chip 下方（y=408 vs chip 底 406），但不属于
  `.dsh-rw-rail-hover` 组（`toggleInsideRail=true`、`toggleInsideHover=false`）；指针移到按钮上 rail
  仍保持 44px 不展开。点击后 44×44、只渲染 `+9`，hover 不再展开；点 `+9` 恢复 44×350 并把 hover 展开
  行为恢复（280×427，展开期间按钮隐藏）。拖到上缘：352×44，按钮在卡片内、最后 chip 之后
  （x=990，rail 右缘 1030），图标为指向左侧的折回箭头；点击最小化 44×44、hover 不展开，再点恢复
  352×44。截图 `/tmp/dsh-e2e/rail-min-toggle.jpg`、`rail-min-vertical.jpg`、`rail-min-horizontal.jpg`、
  `rail-top-collapsed.jpg`。回归测试 `tests/client-target-rail.test.ts`（`railShowsToggle`、
  `railBoxStyle` minimized 宽度、toggle 在卡片内且不在 hover 组内、1 个连接时不存在）。
- 已知限制：宿主进程被 SIGTERM/SIGKILL 硬杀时，profile server 可能短暂残留，需手动清理（正常
  `停止`/`断开` 会关闭）；旧版 `/api/state` 在某个 target 读失败时会返回 `{error}` 列表，client 侧
  `readableList`/`deriveWorkspaceGroups` 已做降级（`p1-read-failed` 呈现为连接错误而不是崩溃）。

## 5. 清理阶段（验收后）

删除 `src/client/session-main.tsx`、`src/client/panel.tsx`、`src/client/session-composer*`、
`session-tools/approval/timeline/hero` 等 native 主区生产路径，以及 `assets/official-ui/`、相关 vendor
脚本与测试；保留 `portal`/`embed`（v3 重新成为主路径）与 `remote-store` 的连接/工作区命令。
