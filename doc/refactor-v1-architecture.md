# dsh-remote-window v1 架构

> 状态：**v1 实现架构（可开工版）**，2026-10-22。产品/验收以
> `doc/refactor-v1-requirements.md` 为准（含用户裁决 **D19/D20**）；协议逐字契约见
> `doc/refactor-v1-protocol.md`（下称 protocol）。两者冲突时产品决定优先，其次 protocol 的具体
> 方法/错误码，本文解释结构与取舍。
>
> 基线：DSH **0.2.1-rc.3**（精确钉住）。旧架构的 stdio/mux/standalone server bundle 退役。
> 本文中标注 `0.2.1-rc.2` 的实测记录是升级前证据，保留用于推导；rc.3 的复核范围、方法与环境见
> `doc/dsh-rc3-compatibility.md`。
> 文档只使用占位主机/路径，不记录真实凭据、内网地址或本机绝对路径。

---

## 0. 一句话

> **server 是一台能独立工作的普通 DSH；client 是它的远程入口。**
> 每个 client 在 server 上拥有自己的 profile server（`dsh --profile graydovee-remote-window-<clientId>`
> + `dsh-remote-window-server` 插件）。client 的两段式 sidebar 通过 P1 RPC 读取 server 官方
> workspace/session 数据；server 模式主区 = 同源 portal 嵌入的 **profile 官方 UI**；local 模式 =
> 客户端官方 UI + 插件执行世界；两种模式写同一份 server 会话日志。

---

## 1. 分层与文件所有权

```
┌───────────────────────────── client 机器 ─────────────────────────────┐
│ client GUI (浏览器)                                                    │
│   ├─ 官方本地 sidebar / 主区（local 模式 + 本地工作区）                 │
│   ├─ dsh-remote-window client half：远程段 sidebar、面板、连接向导、  │
│   │  执行端设置、server 模式 iframe 容器、错误/占用呈现                  │
│   └─ iframe: /dsh-remote-window/portal/<targetId>/  (同源)          │
│                                                                        │
│ client DSH host (Node)                                                 │
│   ├─ 官方服务：workspaceRegistry(本地)、sessionPersistence(路由)、      │
│   │  agents、agentPresets、credentials、webServer、client-connection    │
│   ├─ dsh-remote-window host half：targets/SSH/部署/profile 生命周期、 │
│   │  portal 代理、P1 RPC/SSE/mux 客户端、local 模式 routing persistence │
│   └─ 一条 SSH 连接（ssh2）─── forwardOut ───────────────┐               │
└─────────────────────────────────────────────────────────│───────────────┘
                                                          ▼
┌───────────────────────── server 机器（SSH 目标） ──────────────────────┐
│ profile server 进程（每 client 一个，127.0.0.1:<port>，token URL）      │
│   └─ dsh-remote-window-server 插件（Cordis host row + client half 可选）│
│        ├─ P1 路由：handshake/lease/RPC/SSE/mux WS                      │
│        ├─ 官方服务：workspaceRegistry、sessionPersistence、sessionController、│
│        │  agents、sessionTitle、storage-domain                         │
│        ├─ registry 写守卫（跨进程锁 + revision；包装官方 prototype）    │
│        ├─ executor 状态（文件 + 锁）、session prepare（managed agent）  │
│        └─ embed 注入：storage shim + CSS + bootstrap（tapIndex）        │
│ server 全局 DSH（可选、独立运行；不装插件时与本架构只共享 ~/.dsh 数据） │
└─────────────────────────────────────────────────────────────────────────┘
```

| 层 | 归属 | 职责 |
|---|---|---|
| client GUI | dev-ui | 远程段 sidebar（官方行）、连接/部署向导、执行端设置、iframe 容器、错误映射。 |
| client host | dev-core | SSH/forwardOut、target 记录、runtime/插件部署、profile 启停、portal、P1 客户端、local 模式远端 persistence 门面。 |
| client 官方服务 | 官方 | 本地 workspace/session/agent/凭据；local 模式的 agent loop 与模型调用。 |
| client local routing | dev-session | `sessionPersistence` 按 cwd 路由；stub↔server path 重锚；执行世界 realm（改为 WS mux）。 |
| server plugin | dev-server | P1 路由/lease、官方 service 包装、registry 守卫、executor、embed、mux WS、profile 生命周期服务端。 |
| server 官方服务 | 官方 | workspace/session/JSONL/agent/model/credentials；**不自造替代格式/锁**。 |
| 旧代码 | 删除 | `src/server/**`、`src/frame/psk.ts`、WSL/Docker 连接方式、旧 `reg.*/persist.* over stdio`。 |

依赖方向：`targets → ssh/portal/provision → service(p1) → realm/session → client`；client bundle 只能依赖
平台模块和纯谓词模块，不得 import host service 或 Node API。

---

## 2. 数据权威与同步语义（v1，含 D19/D20）

| 数据 | 权威 | 落盘 | 可见性 |
|---|---|---|---|
| 工作区清单/标题/顺序 | server 官方 `workspaceRegistry`（进程内） | server `~/.dsh/storages/workspace.json`（single layout） | 同进程实时；跨进程**刷新/重连后**一致（非实时推送，D19 边界） |
| workspace 内会话顺序 | 官方 `workspace.sessionIds` | 同上 | 同上 |
| pin/archive | 官方 registry global 集合 | 同上 | 同上 |
| 会话清单/标题 | server 官方 JSONL + projection cache；插件补充 JSONL title fold | server `~/.dsh/sessions/**` | 每次 list 可重新扫盘；跨进程新会话刷新可见（title 由插件 fold 保证） |
| 会话日志/turn | server（两种模式都写同一份） | server JSONL（官方 flock 单写者） | 官方语义；`session/writer-held` |
| 执行端记录 | server 插件状态文件（跨 client 共享） | `~/.dsh/remote-window/state/executors/*.json` | 读写时即时可见 |
| 模型凭据 | server 模式 server / local 模式 client | 各自 credential store | 不跨线 |
| SSH 凭据 | client | client `ctx.credentials` | 权威，绝不过线 |
| 连接设置（默认执行端） | client | client 插件存储域 | 权威 |
| 搜索/展开态/归档过滤 | client | client localStorage | 瞬时 |
| server 全局 DSH 的写入 | server 全局进程 | 同一 `workspace.json` | client 侧刷新/重连后可见；全局 DSH 需重启/重开才见 client 改动（D19 明确不保证实时） |

### 2.1 多进程 workspace 事实（上游限制）

0.2.1-rc.2 官方 workspace registry **没有跨进程可见性/协调**：

- `packages/workspace/workspace/src/index.ts:199-296`：`[Service.init]` 打开 storage domain 一次；
  `list()` 同步读进程内 Map；无 reload/watch/revision API。
- `packages/storage/storage-domain/src/index.ts:103-158` + `README.md:146`：domain 打开时 `loadAll`
  进内存，读全走内存，`domain/changed` 是进程内事件。
- `packages/storage/storage-json/src/single-unit.ts:3`：内存权威，每次写整文件 atomic 覆盖；
  `README.md:141`：**no cross-process write locking，last-completion wins**。
- workspace domain 未声明 layout → 默认 `single`：`$DSH_HOME/storages/workspace.json`。
- 官方把 cross-process 保护列为 proposed/未实现。

结论（v1）：

1. **不新建 server-wide coordinator**（后续项，见 §13）。多 client 的共享语义 = **刷新/重连后一致**，
   不是实时推送；并发写在同一时刻仍可能 last-write-wins（由跨进程写守卫把“可控制的写”变成显式错误，
   见 §4）。
2. D19：只保证 client ↔ **本 client 的 profile 官方 UI**（同进程）双向实时；server 全局 DSH 独立可用，
   client 改动对全局 UI 可能要重启/重开才见。
3. 会话日志跨进程安全（JSONL list 每次扫盘；kernel flock 单写者）；标题由插件 fold 补齐（§5）。

---

## 3. Spike 验证记录（可复现）

> 环境：macOS 桌面版 DSH 0.2.1-rc.2（asar 只读提取到 `/tmp`），隔离 `DSH_HOME=/tmp/dsh-spike/run/home`，
> 临时 profile `web`/`spike`，未触碰真实 `~/.dsh`。命令中的 `<DSH>` 代表桌面版
> `.../runtime/cli/bin/dsh`，`<APP>` 代表桌面版安装目录。

### 3.1 官方能力（接口清单）

```sh
npx --yes @electron/asar extract "<APP>/Contents/Resources/app.asar" /tmp/dsh-spike/asar
node -p "require('/tmp/dsh-spike/asar/dsh/package.json').version"   # 0.2.1-rc.2
npm install --ignore-scripts @deepseek-ai/dsh@0.2.1-rc.2            # 取 .d.ts/源码对照
```

确认可用（均为公开 service/方法）：

| 能力 | 位置/签名 | 结论 |
|---|---|---|
| workspace registry | `ctx.workspaceRegistry`：`create/delete/get/list/insertBefore/setTitle(Workspace)/attachSession/insertSessionBefore/pinSession/unpinSession/archiveSession/unarchiveSession` | 权威、可包装；pin/archive/order 全局语义可直接复用（替代旧插件自存 sets） |
| session persistence | `ctx.sessionPersistence.open(id,'read'|'write')`、`create`、`list/stat`、`SessionHandle.read/append/flush/close` | 官方 JSONL + flock；**不自造** |
| session controller | `ctx.sessionController.list/create/rename/fork/cancel/inspect/page/follow/search/...` | 会话数据/动作官方面；`SessionAlreadyOwnedError → RemoteError session/writer-held` |
| agents | `ctx.agents.resume/create` 返回 `AgentHandle`；`ctx.agents.get(id)` 只有裸 Agent | 见 §8（managed handle） |
| session title | `ctx.sessionTitle.get/foldSessionTitle`；projection cache `title` | 插件 fold 兜底 |
| webserver 接缝 | `ctx.webServer.register/registerUpgrade/tapIndex` | 插件可注册 HTTP/WS/index 注入 |
| 鉴权接缝 | `ctx.connection.admit(req)` → `{peer}|{rejection:401|403}` | 插件路由/WS 可要求官方 cookie |
| loader 重载 | `ctx.loader.entries()` 找到 `name==='@deepseek-ai/dsh-workspace'` 的 entry；`entry.update({disabled:true})` → `entry.update({disabled:false})` | 可重启官方 workspace 行（见 §4.3，需版本守卫） |

### 3.2 会话单写者（D17 证据）

脚本：两个独立 Node 进程共享同一 `DSH_HOME`/sessions root，A `create+flush` 持有 writer，B 尝试
`open('write')` 与 `open('read')`（复用官方 JSONL 后端，非插件代码）。

实际输出：

```
A: created and flushed session-lock-spike access=write
B: open write failed name=SessionAlreadyOwnedError
   message=session "session-lock-spike" is already owned by an active write handle
B: open read OK access=read
B: read 1 events
sessions/--tmp-...--/session-lock-spike/session.v4.jsonl.zstd
sessions/--tmp-...--/session-lock-spike/session.lock   (0 bytes)
```

结论：官方已提供跨进程单写者；第二个写者得到固定错误文本。**不自造锁、不做超时抢占**。读打开可并存
（只读查看可行）。产品口径：v1 用**显式报错**，不做只读模式/确认接管；server 模式嵌入 UI 打开历史时
官方 `session/follow` 会 promote→resume（占写锁），因此“打开即占用”，不是被动只读。

### 3.3 同源 portal（dev-core 实测 + 本 spike 复核）

- profile server：`dsh --profile <p> --host 127.0.0.1 --port 0 --no-open` 只打印
  `dsh web: http://127.0.0.1:<port>/?token=<43位base64url>`；`GET /?token=…` → `303 location: ./` +
  `Set-Cookie: dsh-auth-<authorityHash>=…; Max-Age=2592000; Path=/; HttpOnly; SameSite=Strict`
  （HTTP 无 Secure）。cookie 的 authority = 请求 Host。
- 前缀剥离代理 + **Host 重写为 `127.0.0.1:<remotePort>` + 删除 Origin + 注入 cookie**：
  index 200（`<base href="./">`）、static asset 200、插件 bundle 200、`/api` 带 cookie 可用、
  `GET .../api/remote.mux`（Upgrade）→ `101 Switching Protocols`；浏览器 iframe 完整渲染。
- 反例：`--public-url` + 透传浏览器 Host 会让远端 cookie authority 变成 client origin，与 client GUI
  自己的 `dsh-auth-*` 同名冲突；`--port 0` + `--public-url` 还会让 stdout 失去真实端口。
  **定稿：不用 public-url/trusted-host；portal 只做字节代理。**
- 官方 web 0.2.1-rc.2 不发送 `X-Frame-Options`/CSP `frame-ancestors`（dev-core 实测）。

### 3.4 插件路由/注入/鉴权（本 spike 实测）

临时 profile `spike` 通过 `cordis.patch.yml` 的 `- insert:` 行加载 `/tmp` 插件，插件注册：

- `ctx.webServer.register({kind:'exact', path:'/spike/ping'})`：无 cookie → `401`；带官方 cookie → `200`；
- `ctx.webServer.registerUpgrade({path:'/spike/ws'})`：无 cookie → socket destroyed；带 cookie → `101`；
- `ctx.webServer.tapIndex(...)`：index 响应出现注入标记（带 cookie 的 index 中计数 1）。

结论：v1 插件 API = 自有 exact/prefix HTTP + upgrade 路由，鉴权 `ctx.connection.admit`；不使用官方
Gateway Remote（那是浏览器 Typert 面，不适用于 client host 之间的服务端通道）。

### 3.5 官方 workspace 行重载（loader 内部接缝）

两个进程共享 `DSH_HOME`：A 创建 `work2` 后，spike 进程（先启动）`list()` 仍无 `work2`。
在 spike 插件内执行：

```js
const entry = [...ctx.loader.entries()].find(e => e.options.name === '@deepseek-ai/dsh-workspace')
await entry.update({ disabled: true })
await entry.update({ disabled: false })
```

实测输出：

```
status before: ['work2', 'work', 'default-workspace']   # 进程重启后已载入
reload: ok ms=157 serviceReplaced=true before/after same
reload x5: all ok ms≈105, after list 正常
```

结论：**disable→enable 会重建官方 workspace 行**（service 实例替换），重复 5 次不崩、list 正常；
`entry.update({}, false, true)` **不会**重启（force 仅触发 patch-context，空 diff 无操作）。
限制：这是 loader 内部接缝（非官方公开 API）；官方 UI 的 workspace feed 是否无损刷新、与 agent/其它
service 的交互、监听泄漏仍需 dev-server 专项验证（§12 Spike B）。失败/不可用时 fallback = 重启
profile server（§6.3）。

### 3.6 同源存储污染（实测 DOM/键）

- 同源 iframe 与 parent 共享 `localStorage`；官方客户端持久键至少：
  `dsh.sessions.current`（`client/ui-workspace/src/client/navigation.ts:160`）、
  `dsh.workspace.view.v5`（`.../stores.ts:91`）。不隔离会互相覆盖选中/视图。
- 官方布局 DOM（0.2.1-rc.2 实测）：`[data-slot="sidebar"]`（`display:contents`）→ 父
  `div.<hash>_sidebarCol` → 父 `div.<hash>_frame`（inline `grid-template-columns`）→ `[data-slot="root"]`；
  另有 `[data-slot="rightbar"]`、`[data-slot="shell.bottom"]`、`[data-slot="shell.overlay"]`。
  CSS 隐藏方案与网格覆盖见 protocol §9.3（dev-ui 用该 DOM 校准选择器）。

---

## 4. registry：写守卫、刷新与重启

### 4.1 写守卫覆盖范围（v1 定稿：包装官方 service prototype）

**目标**：v1 主区就是 profile 官方 UI，会话 rename/fork/pin/archive 与可能的 workspace 动作都走官方
registry；不能只守 P1。v1 在 server 插件 `apply()` 里做**受版本守卫的 prototype 包装**：

- 找到官方 `WorkspaceRegistry` 实例（`ctx.workspaceRegistry`），包装其 prototype 的写方法：
  `create/delete/insertBefore/initializeDefault/pinSession/unpinSession/archiveSession/unarchiveSession`；
- 包装 `WorkspaceEntity` prototype 的 `setTitle/attachSession/detachSession/insertSessionBefore`
  （通过任一现有 entity 的 constructor 取 prototype；若注册表为空，包装 `list()/get()/create()` 的返回
  实体原型，首个 entity 出现时补上）；
- 包装器统一：取跨进程 `registry.lock` → 比较 `workspace.json` revision 与 `loadedRevision` → 不一致
  抛 `registry-stale`（不进入官方写）→ 一致则调用原方法 → 成功更新 revision → 释放锁；
- 覆盖 **官方 UI 写 + P1 写**；官方 UI 收到错误时显示可操作错误（“server 工作区已被其他实例修改，
  请刷新”），而不是静默丢更新；
- 包装失败/原型不可写 → 能力位 `registryWriteGuard: 'none'`，文档降级为“v1 不保证并发写”，QA 不按
  并发写判失败（已知缺口，非默认路径）。
- 需要 dev-server 专项验证：官方 UI 写路径、错误传播、重复包装、loader 重载后重新包装、监听无泄漏。

### 4.2 读与 stale

- 每次 `workspace/list`/`session/list` 先 `stat` 文件 revision；
- 与 `loadedRevision` 不同 → 返回 `registry.stale: true` + 当前（可能旧）数据，UI 显示“server 端有更新”；
- 不做自动写；不静默把旧数据当最新。

### 4.3 刷新 / 重连（P3 UI 契约；protocol §16.3 为逐字契约）

> 与 protocol §10 的关系：§10 的“刷新=重启”是旧表述，已被 protocol §16.3/§16.4 替换。
> 最终顺序：`state/refresh`（轻量）→ `registry/refresh`（loader 重载）→ `profile/restart`（D20 确认）。

| 动作 | 行为 | 取消 turn？ | D20 确认？ |
|---|---|---|---|
| **轻量刷新** `POST /api/state/refresh {targetId}` | 重读 session list/title（扫盘 + title fold）、返回 workspace 快照与 `stale`；不重启进程 | 否 | 否 |
| **加载 registry 变更** `POST /api/registry/refresh {targetId}` | 调 P1 `registry/refresh`（disable/enable 官方 workspace 行，版本守卫，失败 `registry-reload-failed`）；不重启进程 | 否 | 否 |
| **重启 profile** `POST /api/profile/restart {targetId}` | 先 `profile/restart-preview` 列出 active turns；用户确认后：cancel + whenIdle/flush（≤3 s）→ 停 process → 启 process → handshake → 重建 tunnel/iframe | 是（全部） | **是**（D20） |
| **重连**（连接断开/网络恢复） | 同 restart 流程；若存在 active turn，UI 先展示将被取消的清单与确认；崩溃恢复可不清单（无从获取），但需提示 | 是 | 是（可知时） |
| `registry/refresh` 失败 | 返回 `registry-reload-failed`；UI 提供“改为重启 profile（会取消 turn）”按钮 | — | 是 |

- `state/refresh` 不得静默重启进程；`profile/restart` 不得在没有 preview 清单时执行
  （`pid`/active 列表缺失 → `profile-restart-preview-failed`）。
- P3 的 preview/apply 形状按 dev-ui D20 契约（见 protocol §5.4/P3 段）：`preview(targetId,nextMode)` →
  `{currentTurn?, otherActiveTurns[], requiresConfirm, previewRevision}`；
  `apply(targetId,nextMode,{cancelActiveTurns:true,previewRevision})` →
  `{switched, cancelledTurnIds[], failedCancellations[]}`；事件 `mode-switch/progress`、
  `turn/cancelled`、`mode/changed`；错误 `mode-switch/preview-failed`、
  `mode-switch/other-turns-cancelled-required`、`mode-switch/cancel-failed`、`profile-locked`。

### 4.4 首次 bootstrap 竞争

空 `~/.dsh` 的两个 profile 同时初始化 default workspace 会整包覆盖。client host 启动 profile server 前
取 `$DSH_HOME/remote-window/locks/bootstrap.lock`；handshake 返回 `registry.initialized` 后释放；
第二个 client 等锁（≤30 s）再启动。全局 DSH 与 profile 同时首次启动不在 v1 保证范围（D19）。

---

## 5. sidebar 数据：workspace/session/title

- **workspace 清单/标题/顺序/pin/archive**：P1 `workspace/list` 直接读官方 registry（同进程），
  字段 = 官方 id/path/title/createdAt/updatedAt/sessionIds + global 集合；不再有插件自己的
  `WorkspaceRef`/pinned/archived 存储。
- **session list**：P1 `session/list` 调官方 `ctx.sessionController.list()`（不激活 agent）+
  workspace 成员序（`insertSessionBefore`）+ pin/archive 集合。
- **标题（v1 硬要求：与本地工作区 1:1，不允许长期无名）**：
  1. live session → `ctx.sessionTitle.get(session)`；
  2. 官方 projection cache 的 `title`（若存在）；
  3. **插件 JSONL title fold**：`sessionPersistence.open(id,'read')` + `stat.sizeBytes` 记忆化，
     从日志尾部按块回刷找最新 `session/title` 事件（`foldSessionTitle` 语义）；blank 用同一读取判
     `turn/start` 是否出现；
  4. 兜底 = 官方显示规则（durable title → cwd basename → session id）。
  - 缓存 key `(sessionId, sizeBytes)`；并发上限 4；失效 = sizeBytes 变化/收到 session 事件。
  - `SessionRow.titleSource: 'live'|'projection'|'log'|'fallback'`（诊断；QA 可用）。
- **搜索**：client 瞬时过滤，不落盘、不发 P1。
- **排序/拖拽**：workspace 顺序 `workspace/reorder` → 官方 `insertBefore`；workspace 内会话顺序
  `session/reorder` → 官方 `insertSessionBefore`；pin 由官方集合排序。client 只渲染，不存第二份。

---

## 6. 生命周期

### 6.1 连接与部署（固定顺序）

```
connect(SSH + host key) → probe → runtime(独立/全局) → profile+plugin 安装 → profile server start
→ token/cookie → handshake(lease) → portal ready
```

- 独立 runtime：`$DSH_HOME/remote-window/<clientId>/runtime`（固定），自动安装/升级（不需要确认）；
  升级前停该 profile server，升级后重启；不影响其他 client。来源：client 缓存 artifact 上传优先，
  server 下载 release tarball + 同源 sha256 校验兜底。
- 全局 runtime：只检测；安装/升级必须按钮确认（文案写明影响 server 上其他 profile）。
- 专用 profile 插件：离线写 4 个文件（`package.json`/`cordis.yml`/`cordis.patch.yml`/
  `pnpm-workspace.yaml`）+ `node_modules/dsh-remote-window-server/**`（不依赖 server 网络/pnpm）；
  marker 记录版本+sha；自动重装/升级并重启 profile server。
- 其他 profile：安装/重启均按钮确认；不得静默写。
- 运行时版本契约仍只有一个来源 `DSH_VERIFIED_RUNTIMES`（0.2.1-rc.3）。

### 6.2 profile server（细节见 protocol §3）

- 启动命令：`DSH_HOME=… PATH="<runtime>/node/bin:<runtime>/dsh/node_modules/.bin:$PATH" exec <dsh>
  --profile graydovee-remote-window-<clientId> --host 127.0.0.1 --port 0 --no-open`
  （注意 `--profile` 在 app 参数前；`dsh web --profile` 会被 CLI 拒绝）。
- detached + log(0600) + pid；stdout 单行正则取 port/token；15 s 就绪超时。
- 单 client 租约：`<profileDir>/.dsh-rw/lease.json`（clientId/instanceId/pid/port/heartbeat/tokenFingerprint）；
  heartbeat 5 s、TTL 20 s；第二 client `profile-in-use`；clientId 不同 `profile-foreign-client`；
  stale 可接管。详见 protocol §3.4。
- 断开：`profile/cancel-all`（cancel + whenIdle/flush ≤3 s）→ SIGTERM → 5 s 后 SIGKILL → 关隧道；
  崩溃时进程退出释放所有 flock，下次按 stale 租约恢复。

### 6.3 profile 重启（刷新/切换兜底）

- 先取 preview（active turns）；有 active turns 必须 D20 确认；确认后逐 profile 处理：
  cancel → `await agent.whenIdle()`（3 s 超时）→ `sessionPersistence.flush()` → 记录失败（不静默）→
  SIGTERM/start，顺序同 §6.2；重建 cookie/tunnel/iframe，handshake 成功后恢复 UI 选中。
- 失败保留可诊断状态（log 尾部、pid、lease），可重试；不得把“重启失败”显示成空列表。

---

## 7. server 模式数据流

```
client sidebar 展开连接
  → P3 GET /api/state?targetId → client host → P1 workspace/list + session/list
  → client sidebar 渲染（官方行）
点击会话
  → client host P1 session/prepare-server {sessionId}       # §8 managed agent
  → client 主区 iframe src = portal/<targetId>/?dshRwSession=<id>&theme/lang
  → bootstrap: storage 前缀 + 预写 dsh.sessions.current + CSS 隐藏 sidebar
  → 官方 UI restoreSelection/openSession；session/follow 发现 live agent → 复用（不再 resume）
  → 官方 UI 负责发送/取消/审批/流式/历史；client 只观察 storage 事件同步选中
点击“新建会话”（workspace 行）
  → P1 session/create {workspaceId, executor:'server'}（官方 blank 复用/创建）
  → P1 session/prepare-server {sessionId}（memoized resume + hold handle）
  → iframe 深链 dshRwSession=<id>（官方 restoreSelection 复用 blank 为草稿页；QA 验证）
点击 rename/fork/pin/archive
  → client sidebar → P1 session/rename|fork|pin|archive → 官方 service（写守卫）
  → 官方 UI 同进程可见；client sidebar 重新拉取
```

- 新建会话/草稿最终选择：**先 P1 创建 blank 再深链 `dshRwSession`**（不是 `dshRwWorkspace`）。
  `dshRwWorkspace` 仅作为 fallback（官方 UI 自己创建 blank，agent 不受插件管理 → 切 local 时只能重启）。
  **QA 必须先验**：blank session 在官方 `restoreSelection` 下显示为草稿页（不是正式会话）；若不成立，
  v1 改走 `dshRwWorkspace` fallback（并接受切换重启），或排期 v1.1 server client half；不得假装通过。
- sidebar “新会话”临时行：只在该 workspace 的 blank 会话正被打开时显示；切走即消失；blank 不出现在
  普通会话列表。
- 执行端徽标/凭据归属在 client sidebar 与主区可见（server/local）。

## 8. managed agent（server 模式占用与切换）

> **验证门槛（不写死）**：A+ 依赖“插件先 prepare + 官方 UI 复用 live agent”。开工后 dev-server 与
> dev-session 必须做一次联合 spike（真实 profile + 官方 UI 打开会话）：确认无双 resume、不丢
> handle、组合完整（preset/modelSelection 与官方一致）、切 local 后 flock 确实释放。**失败即整体退回
> “切换 = 重启 profile + D20”**，删除本节的 managed 路径，不得带着风险发布。

官方 UI 打开历史时会 `session/follow → promote → resolve → ctx.agents.resume`，并**丢弃 AgentHandle**
（`dsh-api-session-controller` L221-241/365-370/392-401/1586-1594）；之后进程内无人能 dispose 该 agent，
flock 一直持有到进程退出。为了不重启就能切 local，v1 采用 **A+：插件先 prepare、自己持 handle**：

1. `session/prepare-server {sessionId}`：插件确保该 session 有 live agent **且 handle 由插件持有**：
   - 已 live（例如官方先开）→ 无法接管 handle：记录 `unmanaged`；返回
     `{managed:false, fallback:'restart'}`（切换时走重启兜底）。
   - 未 live → 复刻官方公开组合（`agentPresets.resolve/mount` + `installModelSelection`，
     dev-session 实测 compose 结果 `composedPreset==='standard'`）后 `ctx.agents.resume({resumeSessionId,
     agentOptions, setup})`，保存 `Map<sessionId, AgentHandle>`，返回 `{managed:true}`。
   - 组合/版本守卫失败 → `agent-compose-failed`，不展示 iframe。
2. 官方 UI 随后打开该 session：`liveAgent` 直接复用，不再 resume；iframe 内任何打开都必须先 prepare
   （client 主区导航顺序保证；隐藏 sidebar 阻止其余入口）。
3. 切换 server→local：若目标 managed → `handle.dispose()`（cancel + whenIdle + close，释放 flock）；
   若 `unmanaged` → 只能重启 profile（D20 preview/确认，见 §4.3）。
4. 断开/删除连接：插件 dispose 所有 managed handles（或进程退出释放）；unmanaged 随进程退出。
5. 其它 active turn（D20）：切换/重启前 preview 列出；当前 turn 自动取消；确认后一起取消；未确认拒绝。
6. local→server：client 关闭写 handle → `session/prepare-server` → iframe 深链；无需重启。
7. 产品口径：server 模式“打开会话”即占用写者（官方 follow promote 的既成事实）；第二个实例尝试
   发言/改名会得到 `session/writer-held`。

## 9. local 模式

- 执行端：client agent loop + client 模型/凭据；文件/进程/沙箱/终端 = server 插件执行世界
  （P1 WS mux，复用 `frame/codec.ts`+`mux.ts`）；fail-closed：mux 不可用 → 报错，绝不本地执行。
- 会话日志：server 官方 JSONL；client `sessionPersistence` 路由：
  - 本地 cwd → 官方 JSONL；remote stub cwd → `RemotePersistence` → P1 `persist/*`；
  - header 传入协议带 `remoteCwd`（server 真实路径，必须等于某个官方 workspace path），插件用
    `remoteCwd` 创建官方 header；返回的 header 是 server 路径，client 侧重锚为 stub；
  - `persist/locate` 返回 `{remoteCwd, workspaceId?}`；`persist/list` 返回 raw snapshots（client 过滤/重锚）。
- anchor/stub：插件私有目录（`DSH_HOME/remote-windows/<clientId>/<targetId>/<hash>`），**不写官方
  workspace registry / 共享 workspace.json**；client 官方 UI 中远程会话不是本地工作区行。
- 主区打开顺序（必须）：**host 先 create/resume（拿 handle、让 client catalog 有 summary）→
  浏览器再 `uiWorkspace.openSession(id)`**；等待 client `sessions` catalog 收录（≤4 s，轮询），否则
  `unknown session`（alpha55 缺陷）会吞掉点击。
- 草稿/新会话：client sidebar 调 P1 `session/create {workspaceId, executor:'local', blank:true}` →
  client `ctx.agents.create/resume` + `persist/create`（executor:local）→ `flush()` materialize header →
  `uiWorkspace.openSession` 显示官方草稿/编辑器；blank 复用官方语义（同 workspace 下一个 blank）。
- 会话标题/列表：sidebar 用 P1 `session/list`（§5）；client 官方 UI 只显示当前打开的远程会话。
- 官方 selection 清理：断开/删除/切换时按 protocol §9.5（守卫私有 `clearMain` → fallback
  `selectPanel(null)` + 仅当 selection 属于本 target 才清 `dsh.sessions.current` + reload 提示）。

## 10. 执行端状态机（D20）

```
            ┌──────────── server ────────────┐
new session │ executor record = server       │
            │ (managed by prepare-server)    │
            └───────┬───────────────▲────────┘
                    │ switch       │ switch + prepare/iframe
                    ▼              │
     preview → confirm(D20) → cancel/flush → (managed? dispose : restart) 
                    │              │
                    ▼              │
            ┌──────────── local ─────────────┐
            │ record=local + owner(lease)    │
            │ client agent writes via        │
            │ persist/open(write)            │
            └────────────────────────────────┘
```

- 记录：server 端状态文件（§2）；`persist/create|open(write)` 校验模式：
  - record=`server` → `409 executor-mode-conflict`（details `{mode:'server'}`）；
  - record 缺失 → 插件按 lease 补 `{mode:'local', owner:<lease>, switchedBy:'handoff'}` 后允许
    （仅当本进程无该 session 的 live server agent；否则 `executor-mode-conflict`）；
  - owner 不匹配且心跳新鲜 → `executor-held`；心跳过期（>20s）才允许 `executor/assign` 接管；
  - 读打开不校验。
- 切换失败：记录保持/回滚到可解释状态；UI 显示 `mode-switch/cancel-failed` 等错误，不假装切成功。
- 其它 active turn：preview 必填清单；确认后一起 cancel；缺清单 → 拒绝执行（D20）。

## 11. portal / embed（摘要，逐字见 protocol §8/§9）

- portal 路由 `/dsh-remote-window/portal/<targetId>/`（HTTP prefix）+ `/api/remote.mux`（WS exact）；
  剥前缀 → SSH forwardOut → `127.0.0.1:<port>`；Host 重写、删 Origin、注入 cookie、丢弃 Set-Cookie；
  token 永不进浏览器；错误 503/502 可操作。
- embed：server 插件 `tapIndex` 在 app bundle 前注入 inline config + `bootstrap.js`；storage shim
  前缀 `dshrw:<profile>:`（getItem/setItem/removeItem/clear/key/length；localStorage+sessionStorage）；
  `dshRwSession` 首次深链预写 selection；postMessage 仅 `open-session/theme/reload`；选中回传靠同源
  `storage` 事件；CSS 隐藏 `[data-slot="sidebar"]`/`rightbar`/`shell.bottom` 并把主区占满。
- v1 无 server client half；会话切换 = iframe reload（WS/流式自动恢复）；v1.1 可选 client half 免 reload。
- 同源隔离验收：client 键不变、无 server cookie、clear 不误清、双 target 不串消息。

## 12. 部署 / 清理 / 迁移

- **删除旧代码/数据**：`src/server/**`、`src/frame/psk.ts`、WSL/Docker 连接方式与测试、旧
  `RemoteWorkspaceRecord`/`workspaceRefs`/`pinnedSessions`/`archivedSessions`/`remote:<target>` preset
  注册、旧 server bundle 部署物（server `~/.dsh/server` 可保留但不使用，不主动删）。
- **保留不动**：server `~/.dsh/sessions`、`~/.dsh/storages/*`、模型凭据；旧
  `~/.dsh/remote-server-sessions/**` 保留不展示、不迁移。
- **client 存储域 version 1**：`targets` 只加 optional 字段（clientId/executor/profileName/profilePort/
  runtimeKind/runtimeDir/pluginVersion/serverDshVersion）；旧 workspace refs 读出后清理；无迁移 bump。
- **卸载/禁用**：client 本地不留可见远程行/stub（启动/卸载清扫 `remote-windows` 私有目录与旧 shell
  条目）；server 共享数据保留。
- **清理旧 marker**：专用 profile marker（plugin version+sha）用于幂等重装；更换 DSH 版本时按
  `DSH_VERIFIED_RUNTIMES` 拒绝并提示。

### 12.1 server 插件 artifact 交付（v1 定稿）

client 需要把 `dsh-remote-window-server` 自动装进 server 的专用 profile；artifact 来源必须确定：

1. **内置 tarball（主路径）**：client npm 包在构建/发布时内置
   `assets/server-plugin/dsh-remote-window-server-<version>.tgz`（与 client 插件版本精确一致，
   `version` = 仓库发布版本；`engines.dsh`/peers 仍钉 0.2.1-rc.3）。专用 profile 安装直接解包到
   `<profileDir>/node_modules/dsh-remote-window-server/`（strip `package/`），**不依赖 server 网络/
   pnpm/registry**。
2. **tarball 内容清单（发布门禁）**：`package.json`（name=`dsh-remote-window-server`，version，
   dsh peers）、`lib/`（host 入口；如含 client half 也在 `lib/`）、`cordis.patch.yml`（profile 行 insert）、
   `README.md`/`LICENSE`（可选）。不含 `node_modules`；运行时依赖由 profile 的 DSH 安装提供。
3. **缺失时兜底**：开发/裁剪包可能没有内置 tarball → 从 npm registry 或 release 下载同名同版本 tarball，
   按 client 包内 `assets/server-plugin/checksums.json` 的 sha256 校验；校验失败 →
   `server-plugin-integrity-failed`，不安装。下载版本必须与 client 期望版本精确一致，否则
   `server-plugin-version-mismatch` 并提示“升级 client 插件”，**不得**装一个不匹配版本。
4. **安装步骤**：staging 目录解包 → 校验 sha256/路径穿越 → 原子 rename → 写 profile 4 文件
   （`package.json`/`cordis.yml`/`cordis.patch.yml`/`pnpm-workspace.yaml`）→ marker
   `<profileDir>/.dsh-rw-plugin.json` `{version, sha256, protocol, dshVersion}` → 重启 profile server。
   marker 与期望一致时幂等跳过；升级/降级都走同一路径。
5. **失败/回滚**：安装后 handshake 失败或 `plugin-protocol-mismatch` → 用内置 tarball 重装一次并重启
   （last-known-good）；仍失败 → 保留 log（scrub），报 `server-plugin-install-failed`，不得回退到本地执行。
6. **其他 profile/全局**：安装/重启必须按钮确认；不得静默覆盖。
7. **发布 CI/脚本**：两仓同版本发布；server 仓库产出上述 tarball（内容清单/`sha256`/`manifest.json`），
   client 仓库在 `pnpm build`/`pnpm pack` 时把 tarball 复制进 `assets/server-plugin/` 并写 checksums；
   `scripts/build-server-package.mjs` 扩展为同时校验客户端内置 tarball 的版本/sha。runtime 包
   （node+dsh）仍按原矩阵在 server 仓库发布，二者不要混淆。

## 13. 风险 / 已知缺口 / v2 边界

| 项 | 状态 | 处置 |
|---|---|---|
| 官方 workspace registry 无跨进程 reload/锁 | **上游事实** | v1：写守卫（prototype 包装 + 跨进程锁 + revision）+ 显式 `registry/refresh`（disable/enable，需版本守卫；失败 fallback 重启 profile）；多 client = 刷新/重连后一致，非实时推送；QA 不按并发写判失败 |
| `ctx.loader` disable/enable 是内部接缝 | 风险 | 版本精确钉 0.2.1-rc.3；运行守卫（entry 查找/唯一/失败→重启）；dev-server Spike B 验证官方 UI/agent/监听；升级必须复核 |
| 官方 UI 打开历史 promote→resume 且丢 handle | 上游行为 | A+ 插件先 prepare 持 handle；unmanaged 检测→切换走重启（D20）；产品口径：打开即占用 |
| 切换走重启会取消该 profile 全部 turn | 设计约束 | D20 preview + 二次确认；managed handle 时可只 dispose 目标（不重启） |
| 另一进程新建会话缺 title（projection cache 单进程） | 已关闭（v1） | 插件 JSONL title fold（sizeBytes 记忆化）+ 官方显示兜底 |
| `persist/open` 精确 cursor 需一次全日志解码（JSONL snapshot 无 eventCount） | v1 已知偏离（Lead 裁决） | 仅 410 自愈/open 时一次；与 title fold 共享 `(sessionId,sizeBytes)` 缓存；>8 MiB 告警、>128 MiB 拒绝（`internal` + details），官方未来提供 eventCount 即删除 |
| 全局 DSH 与 profile 并发写 workspace.json | D19 明确 | v1 不保证实时；last-write-wins；QA 不做并发写；后续 coordinator |
| server 官方全局 UI 看不到 client 改动（除非重启） | D19 明确 | 记录；后续插件装全局 profile / coordinator |
| `clearMain` 是未进 d.ts 的私有方法 | 风险 | 运行时守卫 + fallback + I3 四条路径测试 |
| 同源 iframe localStorage 污染 | 已解 | 前缀 storage shim + Set-Cookie 不转发 |
| iframe 每次切换会话 reload | v1 UX 成本 | 初期接受；v1.1 client half 免 reload |
| 右边栏/官方 workspace 动作在 embed 中被隐藏 | v1 范围 | 只保留对话主区；不影响 E3 |
| 删除会话 | 非目标 | 官方无此能力，不做 |
| PTC/标准模式远程 parity | 非目标 | 执行世界沿用插件 realm；文档不得承诺 |

**v1 / v2**：v1 = 官方 UI 嵌入 + 双模式 + 单写者 + 刷新/重连一致；v2 = client 官方 UI 作为 server
模式主区、多 client 实时同步（coordinator 或上游 revision）、全局 DSH 实时、免 reload 深链。

## 14. 测试策略（最低门槛）

| 层 | 测试 |
|---|---|
| 纯/单元 | protocol 类型与错误码、portal 头改写、lease 状态机、executor 状态机、registry revision/锁、storage shim（jsdom）、title fold（fixture JSONL）、persist 路由重锚 |
| 集成（fake ssh2 + forwardOut） | 两个 profile 共享 DSH_HOME：写守卫 stale 错误、registry/refresh、session create/list/title、flock writer-held、lease 第二 client |
| server 插件（Cordis） | 官方 UI 写路径被守卫、loader refresh 无泄漏、embed 注入顺序、mux WS 生命周期 |
| 浏览器 E2E | 连接→部署→server 模式对话（mock provider）→切 local→切回→断开/重连；iframe 无双 sidebar；localStorage 隔离断言；`clearMain` 四路径；两 client 刷新后一致 |
| 回归 | `pnpm typecheck/test/build`；两仓 `cmp`（protocol/frame/codec/frame/mux）；macOS workspace-refs realpath 4 条单独标注 |

`doc/refactor-v1-requirements.md` §7 A–J 为最终验收；本表只是实现自测。

## 15. 与 protocol 的对应

- 方法/类型/错误码/状态机逐字：protocol §3–§12；
- 文件所有权：protocol §14（与本文件 §1 一致）；
- spike 细节/复现命令：本文件 §3；开发争议以 protocol 方法名/错误码为准，结构取舍以本文件为准。
