# v3：全屏官方 UI + 本地模型来源

本文件是 v3 的架构与实现契约。主区是 server profile 官方 DSH UI 的全屏同源 iframe；v2 的 native
对话主区与 vendored 会话组件已在 v3 验收后删除。模型来源为 **local（本机模型，默认）** 与
**server（server 自身模型）**。
数据权威、SSH、profile、host key、连接对话框全部沿用 v1/v2，不改变。

实现状态（本分支）：

| 部分 | 状态 |
|---|---|
| client iframe 外壳 / 左栏「远程连接」行与列表面板 / 连接生命周期 | 已完成 |
| server 插件 embed `full` 模式 | 已完成（server 仓库，随 tarball 内置） |
| 本地模型自动代理（`ctx.llm` 枚举 + 原生 bridge）+ SSH 反向隧道 + per-provider profile patch | 已完成（`src/local-llm/`，`native.ts`） |
| 手动 OpenAI 兼容 endpoint | 仅 `bridge.ts` 旧路径/API 兼容，对话框不再提供 |
| 连接对话框模型来源设置（默认 local）+ 全部 provider/model 勾选代理 | 已完成（`localSelection`） |
| portal 必须带 `dshRwSession` 深链 | 已完成（`portalSessionFor`） |
| 重连复用已保存绝对 `DSH_HOME` | 已完成（`reconnectDshHome`） |
| native v2 主区与 vendored 组件删除 | 已删除（client 只剩左栏连接行/列表面板与 iframe 主区） |
| server 侧「远程连接」行与列表面板（`dsh.client` 浏览器半） | 已完成（server 仓库，随 tarball 内置） |
| 连接快照发布（`client/targets` + 能力位 `clientTargets`） | 已完成（client host，150 ms 去抖 / 5 s 补发） |

## 1. 目标架构

```text
client DSH
├─ 连接对话框（沿用 v1：SSH/host-key/运行时/profile），挂在 body 层单例浮层宿主
├─ sidebar.panellist「远程连接」行（order 100，位于「自动化任务」之后、「更多」之前）
│   └─ main 面板：连接列表（状态点/label/user@host:port/阶段 + 连接·断开·删除）
└─ main slot：<iframe src="/dsh-remote-workspace/portal/<targetId>/?dshRwFull=1&dshRwTarget=<targetId>">
      └─ server profile 官方 DSH UI（sidebar/header/主区/rightbar/插件 UI）
            └─ sidebar.panellist「远程连接」行 + main 面板（同一份连接，点击回传 client 切换）
```

- 未挂载 iframe 时，client 左栏自然显示「远程连接」行；iframe 挂载后 client shell 自己的 sidebar 隐藏
  （`html[data-dsh-rw-portal] [data-slot="sidebar"]`），root grid 收成一列，官方 sidebar 就是导航，切换入口
  由 server 官方 sidebar 里同一个行承担。
- **不复制**官方 sidebar 的 workspace/session 树到 client；两侧列表都只列连接（target）与连接状态。
- 两个入口都是**声明式槽位**：`sidebar.panellist`（一行，壳负责按钮/文字/选中态）+ `main`（同 key 的页面）。
  不接管 `sidebar` / `sidebar.workspaces`（single，注册会替换整列/整个浏览区），也不做 DOM seam 注入。
- 连接列表数据只有一个权威：client host 用 P1 `client/targets` 把快照发给当前 profile server；server 的
  浏览器半用相对路径 `dsh-remote-workspace-server/api/client/targets` 读取（只过 `admit`）。server 面板点击
  只是回传命令（`dsh-rw/switch-target` / `dsh-rw/open-connect-dialog` / `dsh-rw/close-portal`），切换动作
  仍由 client 执行。
- iframe 同源：portal 反向代理剥 client cookie、注入 profile server cookie、剥 `Set-Cookie`，
  profile token 只存在 client host 内存，URL 中永不出现。
- iframe sandbox：`allow-scripts allow-same-origin allow-forms allow-popups allow-downloads`；
  不开放 top-navigation。
- `dshRwFull=1` 使 server 插件不注入隐藏 sidebar/rightbar/bottom 的 CSS；bootstrap 仍设置 storage
  shim、主题/语言、`dsh-rw/ready` 与 `dshRwSession` 深链。`full=1` 是兼容拼写。

### iframe 生命周期

- 连接成功（新连接或点列表里已停止的 target）→ `activateRemoteTarget` → `openServerMain`。
- 切换 target：`closeServerMain` → 新请求；iframe key 为 `targetId:revision:reloadCount`，
  每次激活递增 revision，浏览器不会复用上一个 profile 的文档。
- 断连/忘记/连接离开 ready/删除：`releaseTarget` → `closePortalFor` → `clearRemoteSelection`。
- `dsh-rw/close-portal`（server 面板的「返回本地」）只关 portal，profile 保持 ready，并回选连接列表面板。
- 连接（含重新连接）一个已保存 target 时打开连接对话框的**进度页**：隐藏向导步骤，直接显示
  连接主机 → 探测远端环境 → 部署运行时 → 准备 server 插件 → 建立执行通道 的状态、日志与已用时间；
  成功自动关对话框并打开 iframe，失败留在对话框里可重试（`attemptId` 每次新生成，进度从头开始）。
- 两个连接列表页都抄官方页面骨架：48px 留白 + 960px 居中列 + 80px 标题栏（标题/说明在左，`size="sm"`
  工具栏在右），body 是唯一滚动区；行是 0.5px 边框卡片，hover 与当前行用官方底色 token。
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
| server 插件无 `clientTargets` 能力位 | client 不发布快照；重装同版本 tarball 后恢复，不报错、不影响连接 |
| 快照读取失败（server 面板） | 保留上一次渲染 + 同步不可用提示，绝不清成「没有连接」 |
| server 面板点已激活行 | no-op（`switchRemoteTarget` 判同 target） |
| server 面板点未连接 target | 走正常连接流程；失败 toast，当前 iframe 保留 |
| 伪造/跨 origin/非 v1 的子页面消息 | `parseRwPortalCommand` 丢弃，无提示 |
| 目标机直接打开 server UI（非嵌入） | 行与面板可见，三条命令禁用 |
| `sidebar.panellist` 注册失败 | 只 `console.error`；行与面板各自 try/catch，不互相拖累 |

## 4. 测试与验收

- client：`portal-url`（URL/query/reducer/三条子页面命令）、`client-portal-main`（full=1、sandbox、
  remount key、close、`dshRwTarget`）、`client-connections-panel`（空态/行点击/连接·断开·删除/高亮/
  加载与失败态）、`provision-client-targets`（顺序/phase/能力位/去抖/补发/脱敏）、`local-llm-*`
  （bridge/tunnel/profile/settings）。
- server：`server-plugin-embed`（full marker、CSS gate、tapIndex 注入一次）、`server-plugin-client-targets`
  （快照校验/乱序/脱敏/能力位）、`client-connections-section`（URL/命令/高亮/语言回退）、
  `server-plugin-package`（`./client`、`dsh.client`、`lib/client.js`）。
- 手工：连接真实 target，确认官方 sidebar/header/主区/rightbar 与第三方 UI 插件全可见；本地模型完成
  一轮对话；server 模型完成一轮；断网/endpoint down 显示可读错误。
- `pnpm typecheck` / `pnpm test` / `pnpm build` 两仓全绿；三份共享文件 `cmp` 一致；内置 tarball 版本与
  sha256 与 server 仓库产物一致。

实现坐标（便于 review）：

| 关注点 | 文件 |
|---|---|
| iframe 外壳 / sandbox / remount / ready 超时 | `src/client/portal-main.tsx` |
| 左栏「远程连接」行与列表面板 | `src/client/index.tsx`、`src/client/connections-panel.tsx`、`src/client/styles.ts` |
| 连接对话框/toast 的 body 层宿主 | `src/client/chrome.tsx` |
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
| 连接快照发布（P1） | `src/provision/profile-service.ts`、`src/remote/plugin-client.ts` |
| server 侧连接行与面板（`dsh.client`） | server 仓库 `src/client/index.tsx`、`src/client/section.tsx`、`src/server-plugin/client-targets.ts` |

本分支实测证据（本地运行，2026-11-10）：

- client：`pnpm typecheck` 通过；`pnpm test` **408 passed / 1 skipped**（41 文件通过、1 跳过）；`pnpm build`
  通过（`lib/client.js` 131,851 B，`lib/index.js` 384,048 B）；`node scripts/sync-compat.mjs --check` 通过。
- server：`pnpm typecheck` 通过；`pnpm test` **101 passed**（18 文件）；`pnpm build` 通过
  （`lib/client.js` 33,287 B，含 `window.__ModuleLoader__.load` 工厂）。
- 共享文件 `src/protocol.ts`、`src/frame/codec.ts`、`src/frame/mux.ts` 两仓 `cmp` 一致。
- client 包 `dsh-remote-workspace-0.1.0-alpha.7.tgz` 322,645 B，sha256
  `8a90deae91016140c6c9f6bd4ce290440da187b15467c5cee0663ef83688dfd7`。
- 内置 tarball `dsh-remote-workspace-server-0.1.0-alpha.7.tgz` 103,047 B，sha256
  `4367b0e7e1b5499b16067d2168add5d00936af9358877fd7ab61fb26bc8e97c6`，与
  `assets/server-plugin/checksums.json` 一致。

### 浏览器验收（headless Chrome + 干净 `DSH_HOME`，2026-11-10）

client 侧（profile `web`，`dsh --version` 0.2.2-rc.1，只装 `dsh-remote-workspace`）：

- 左栏出现「远程连接」行（`sidebar.panellist`，图标 + 文字，排在导航列表最下面、末尾「更多」之前）；
  点开后主区是连接列表面板：标题「远程连接」、`新建连接`、`刷新`、空态「还没有远程连接 / 点「新建连接」
  添加一台远程主机。」。
- 页面里没有 `[data-dsh-remote-workspace-rail]`；`[data-dsh-remote-workspace-chrome]` 浮层宿主存在；点
  `新建连接` 在主区上方打开「新建远程连接」对话框（三步向导）。
- DOM 断言：`.dsh-rw-page` 占满主区（1320×913 @ x=280，即官方 `mainPanel`），没有把官方 sidebar 挤掉。

server 侧（独立 profile，装 `dsh-remote-workspace-server@0.1.0-alpha.7`，走 `dshRwFull=1` 的全模式）：

- 官方 sidebar 里出现同一个「Remote connections」行（该 profile 语言是 en-US；行位置与 client 一致）。
- 面板读到快照后渲染 3 行：`dev-box / tester@203.0.113.10:22 · Connected`（`Current` 高亮，来自
  `dshRwTarget`）、`build-host / builder@203.0.113.11:2222 · Stopped`、
  `Ubuntu-24.04 / WSL · Ubuntu-24.04 · Connecting`；底部 `3 connections`。
- 直接打开（没有 parent frame）时面板显示「Opened directly: switching connections needs the client
  window.」并禁用三条命令。
- 宿主契约（curl 模拟 client host，真实插件进程）：handshake 返回 `capabilities.clientTargets = 1`；
  `client/targets` 发布 → `{accepted:true, count:3}`；旧 `updatedAt` → `{accepted:false}`（保留新快照）；
  含 `token=` 的 label 被写成 `[redacted]`，`credentialKey`/`privateKeyPath`/未知字段被丢弃；冒用别的
  `clientId` → `lease-mismatch`；`GET dsh-remote-workspace-server/api/client/targets` 返回
  `{ok:true, value:{clientId, updatedAt, targets[]}}`。

本次未做的验收（记录为限制）：没有用真实 SSH 目标跑完整「连接 → iframe → 在 server 面板点击切换」链路
（需要 Docker QA 目标或真机）；该链路的两个新环节已分别验证：client 侧 `switchRemoteTarget`/命令分发有
单测，server 侧面板点行只走 `postMessage` 且命令构造/校验有单测。

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
- 深链恢复：打开列表里的 target 时 iframe URL 带 `dshRwSession=<sessionId>`，打开后恢复该会话（而不是
  官方首启 composer）；无会话时先 `session/create` 建 blank 再带深链。
- 远程功能（headless Chrome + CDP 截图证据）：iframe 内切换模型到 `e2e-test-model` → 发送
  `自动代理验收：请回复收到` → 官方 rollout 流式回复 `本地模型 E2E 已收到：…`（用时 1 秒，2 轮 2 步），
  标题自动生成；链路 = server `remote-e2e-provider` → SSH 反向隧道 → client `ctx.llm.stream()`
  → 本机 pi-ai provider → fake OpenAI。刷新页面、断开重连、停止再启动后会话都会恢复；`停止` 后
  profile server 进程退出。
- 重连回归：`v1/connect {targetId}` 重连后 patch 仍写在保存的 `DSH_HOME`
  （`/tmp/dsh-e2e/server-dsh-home/...`，mtime 刷新、隧道端口更新），不再落到远端默认 home；
  回归测试 `tests/targets-reconnect.test.ts`。
- 已知限制：宿主进程被 SIGTERM/SIGKILL 硬杀时，profile server 可能短暂残留，需手动清理（正常
  `停止`/`断开` 会关闭）；旧版 `/api/state` 在某个 target 读失败时会返回 `{error}` 列表，client 侧
  `readableList`/`deriveWorkspaceGroups` 已做降级（`p1-read-failed` 呈现为连接错误而不是崩溃）。

## 5. 清理记录（已完成）

已删除 `src/client/session-main.tsx`、`src/client/panel.tsx`、`src/client/session-composer*`、
`session-tools/approval/timeline/hero` 等 native 主区生产路径，以及 `assets/official-ui/`、vendor 脚本
与对应测试；保留 `portal`/`embed` 与 `remote-store` 的连接/工作区命令。
