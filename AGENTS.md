# AGENTS.md — dsh-remote-workspace（client 半边）

DSH（DeepSeek Harness）客户端插件：把一台 SSH 主机接入为远程工作区。
**会话权威存储在远端**（官方 JSONL 格式），本地只保留 agent loop、模型请求与凭据。
本插件拥有：SSH 连接与 host-key 校验、目标凭据、连接状态、远端工作区发现、
`RemotePersistence`、远端部署（provisioning）以及浏览器侧树形/对话 UI。

## 必读文档

- `../backup/legacy-project/REFACTOR-BRIEF.md` — 重构唯一权威交底（Remote Session
  架构 v6）：目标形态、协议规范、里程碑 P0–P5、官方 API 文件:行号索引。
- `../backup/legacy-project/PLAN.md` — 旧单仓库的 d1–d12 偏差记录（实测机制：
  server bundle 为何自包含、为何要 keep-alive、mux 宽容规则等），仍然全部有效。
- `docs/remote-session-agent-note.md` — Remote Session 设计要点。
- 兄弟项目：`../dsh-remote-workspace-server`（远端 server 插件，见其 AGENTS.md）。

## 命令

```bash
pnpm install
pnpm typecheck    # tsc --noEmit（无 lint 配置）
pnpm test         # vitest run
pnpm build        # tsdown → lib/（三个 target，见下）
# 真实 profile 冒烟（需要已安装的 dsh 启动器）：
DSH_SMOKE_CLI=<path-to-dsh> npx vitest run tests/profile.smoke.test.ts
# 预打包 server 发行物（矩阵：自带 Node + dsh + 插件，CI 同款）：
node scripts/build-server-package.mjs --all --dsh-version <ver>
```

Node ≥ 22.19（或 ≥ 24）；只用 pnpm。`lib/` 是构建产物，不要手改。

## 与 server 项目的同步契约（最重要的规则）

`src/protocol.ts`、`src/server/`、`src/frame/` 三处与
`../dsh-remote-workspace-server` 里的同名文件**逐字节相同**（已验证）。改任何一处
必须两边同步改。原因：client 的 provisioner 部署的是**自己构建的**
`lib/server.js`（来自 `src/server/` 副本），而 conformance 测试也用副本在内存里
跑；server 项目是这段代码的正式归宿与发行包来源。`src/protocol.ts` 头部注释即此
约定：协议版本 2（`REMOTE_SESSION_PROTOCOL = 2`；官方执行世界 RPC 仍是 v1）。

## 架构：tsdown 三个 target（`tsdown.config.mjs`）

1. **host**（ESM/node）：`index`（插件主行）、`connection`（preset realm 内的
   `ctx.ssh` 实现）、`rsession`（`RemotePersistence`）、`protocol`。
2. **server**（`src/server/index.ts`）：远端执行世界 bundle。**自包含**——只
   external `@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery`；DSH 运行时模块
   拦截只解析裸包名、不解析子路径导出，故 `@deepseek-ai/dsh-ssh/protocol|/schemas`
   与 zod 全部内联（PLAN d2）。
3. **client**（浏览器，CJS 工厂，经 `window.__ModuleLoader__.load` 注册）：只允许
   平台模块表 external；**纯度门禁**会让 Node 内置物或跨插件值导入直接构建失败
   ——跨插件协作走 cordis 服务，不走值导入。CSS 运行时注入单个
   `<style data-plugin="dsh-remote-workspace">`（`src/client/styles.ts`）；文案走
   插件自带字典 `src/client/locales.ts`。

目录速览：`src/rsession/`（`RemotePersistence extends` 官方 `SessionPersistence`，
把 create/open/flush/stat/list 映射到 `persist.*` RPC，写路径缓冲、close/turn 边界
flush）；`src/preset/world.ts`（每目标 `isolate` realm preset——realm 覆盖
`ssh/fs/subprocess/sandbox/shell`）；`src/provision/`（profile 生成 + 部署：远端
profile patch 挂官方执行 provider、`remote-session-persistence`（官方 JSONL 后端）
与 `dsh-remote-workspace/server` 行；远端固定安装根 `~/.dsh/server`，一律
`/bin/sh -c` + 绝对路径，不依赖远端 PATH/登录 shell/系统 npm，PLAN d11）；
`src/ssh/` + `src/ssh-config.ts`（ssh2 连接、host-key 校验、`~/.ssh/config` 解析）；
`src/targets/`（目标存储与 `scrubSecrets`）。

## 不变量 — 不要破坏

- **凭据不过线**：SSH 凭据、模型 API key 只在本地；错误与日志一律过
  `scrubSecrets`（`src/targets/types.ts`）。
- **host key**：未知指纹必须显式确认（SHA-256 展示），已变更的 key 一律中止
  （`src/ssh/hostkey.ts`）。
- **信任栅栏**：所有插件 HTTP 路由必须过 `trustedRequest`（`src/index.ts`，DNS
  rebinding + 跨站防护）；JSON body 1 MiB 上限；API 方法名允许含斜杠
  （`connect/start`），不要加斜杠守卫。
- **零 patch**：不改官方 cordis.patch.yml 任何已有行，不替换全局服务；官方
  「添加工作区」按钮行为不变。左栏区域**不占用** `sidebar.workspaces` 槽位——
  它只在槽位元素之前插入自己的节点（见 P4 一节），官方占位者原样保留。
- **连接行必须惰性**（`src/connection/index.ts`）：preset 挂载失败是粘滞且永久的，
  不可达主机不得在构造时发起连接。
- **存储域版本恒为 1**：新字段只能 additive optional，bump 即砖（单文件布局无迁移）。
- **mux 宽容规则**（PLAN d6）：未知流的 `CREDIT/END/ABORT/OPEN_OK/OPEN_FAIL`
  忽略（迟到消息），仅未知流 `DATA` 是致命帧失步。
- **client bundle 重装必须 bump `package.json` version**：插件批量 URL 带
  `&rev=<hash>`，不 bump 浏览器吃旧缓存。

## 编码规约

- TS strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` +
  `allowImportingTsExtensions`：相对导入带 `.ts` 后缀；type-only 用 `import type`。
- 可选 wire 字段沿用条件展开惯用法 `...(x === undefined ? {} : { x })`。
- 注释解释**实测约束**而非显而易见的事；适用时注明对应的 PLAN 偏差编号。
- peer 依赖区间是 `>=0.2.0-rc.1 <0.3.0`；`dsh-plugin-dev check --strict` 的
  `manifest-peers` 失败是已记录偏差，不要靠降区间去"修"。
- 浏览器 UI 验收不在本会话里自己开浏览器点：发验证简报给子代理，单标签约束。

## 测试层（tests/）

`conformance`（官方 `dsh-fs-ssh`/`dsh-subprocess-ssh`/`dsh-sandbox-ssh` provider
对着 `src/server` 副本在内存传输上跑）；`frame`（分帧/多路复用/流控/TLS-PSK）；
`ssh-config`（`~/.ssh/config` 解析与 `ssh -G` 预填）；`deploy`；`remote-persistence`
（官方 handle 生命周期 → `persist.*` RPC 映射）；`profile.smoke`（真实 profile
经 dsh CLI 于 stdio 上说协议）。

## 会话持久层的路由接线（实测，2026-10-16）

远程工作区的会话是**远端权威**：本插件在 `apply()` 里构造 `RoutingSessionPersistence`
（`src/session-persistence/routing.ts`）并 provide 为 `sessionPersistence`，按会话 cwd
路由——本地 cwd 委托内嵌的官方 JSONL 后端（root 仍是 `~/.dsh/sessions`，本地会话行为
逐字节不变），远程 stub cwd 走远端 `persist.*` 平面。

四条**实测约束**（踩过的坑，改这里之前先读）：

1. **官方行 id 是 `session-persistence-jsonl`（dsh-base 层），不是 `sessions`**
   （后者属于 dsh-sdk-minimal 层，web profile 里不存在）。覆盖 `sessions`
   会打印 `entry "sessions" not found` 并静默无效。
2. **patch 覆盖不能换 `name`**：loader 对 override 有 `name mismatch` 守卫，只允许改
   config；因此"替换类"必须写成 `disabled: true`（禁用官方行）+ 在我们自己的
   `apply()` 里 provide（不能靠 patch `insert` 一行——实测该行从不被构造）。
3. **`inject` 里不能写 `workspaceRegistry`**：`dsh-workspace` 消费
   `sessionPersistence`，而本插件提供它——声明这条边会让两边互相等待，启动时
   7 个 entry 永久 pending。注册表一律用 `ctx.get('workspaceRegistry')` 懒解析
   （注意：无 inject 时属性访问 `ctx.workspaceRegistry` 会抛
   `cannot get property "workspaceRegistry" without inject`）。
4. **任何 `extends SessionPersistence` 的内部实例都必须用 stub context 构造**
   （`Reflect.construct(Klass, [registrationAbsorbingContext(), ...])`）：基类构造函数
   会 `provide('sessionPersistence')`，在根上下文二次注册直接抛
   `service "sessionPersistence" has been registered at <...>`。

验证口径：远端 `~/.dsh/remote-server-sessions/<projectKey(远端路径)>/<sessionId>/`，
本地 `~/.dsh/sessions/` 不应出现该会话。

### header cwd 重锚（实测，2026-10-16 补）

服务端把会话 header 的 cwd 改写成**远端路径**（`RemoteSessionStore.createSession`
用 `workspace.path` 覆盖）。这在本地无法使用：官方 workspace 注册表只把
`realpath(header.cwd) === workspace.path` 的会话算作成员，session-controller 也会
抛 `cwd conflict`。因此 `RemotePersistence` 在 `create`/`open`/`list` 三个出口把
header 重新锚定到**本地 stub**（构造参数 `localCwd`，由 routing 从
`stubForWorkspace(workspaceId)` 取）。

不变量由此统一为：**远程工作区的会话，其 cwd 永远是本地 stub**（create 与
resume 两条路一致），远端路径只在 realm 的 stub→remote 别名处出现。少了这一步，
`agents.resume` 出来的会话 attach 不上、点开会话会被判 cwd 冲突。

## P4：左侧栏「远程工作区」= 官方行组件 + 我们的三层走树（2026-10-16 定稿）

**行不是我们画的**。`src/client/vendor/workspace-rows/` 内置了官方
`ui-workspace` 的行层（`Rows.tsx` / `AnimatedRows.tsx` / 两个 `.module.css` /
`workspace` 命名空间词典），由 `scripts/vendor-workspace-rows.mjs` 生成：脚本从
DSH 检出拷贝、给 CSS 类名加前缀（`dsh-rwv-rows-` / `dsh-rwv-anim-`）、把
CSS-module 导入换成类名映射、把 shell 内部类型导入换到 `models.ts`。
`generated/*` 里带 `@ts-nocheck`（逐字节保留上游，props 仍参与我们调用点的类型检查）。

由此得到的能力（**不要再手写行样式**）：

- 工作区行 = `ProjectRowItem`（34px，文件夹图标 hover 换成展开箭头，`＋` 与 `⋮` 菜单，
  官方 hover 卡）；会话行 = `SessionNodeItem`（32px，标题跑马灯、时间 hover 让位给
  行操作、点击整行 = 打开会话、`blank` 行即官方的「新会话」行）。
- 缩进用**官方自己的变量** `--dsh-workspace-indent`（官方 CSS 已是
  `calc(8px + var(--dsh-workspace-indent,0px))`）：连接 0px / 工作区 14px / 会话 28px，
  一行 CSS 都不用改。
- 菜单只有 `rename` / `delete.workspace` 两个固定项、`t` 由行宿主传入，所以我们的
  **语义靠改这两个 key 的译文**实现（连接行：连接/断开、忘记连接；工作区行：
  刷新会话列表、移除工作区）。`delete` 不是有效 key，必须是 `delete.workspace`。
- 连接行**不能**把 `workspaceId` 传 `undefined`：vendored 组件把 `undefined` 当作
  "未分组" 桶，会把标签替换成「未分组」。任何字符串都行（我们用 `conn:<targetId>`）。
- 三态只体现在连接行**文件夹图标的颜色**上（`.dsh-rw-conn[data-state=…]
  .dsh-rwv-rows-folder`），行的尺寸/hover/菜单都是官方的。

不内置的部分：`WorkspaceBrowser.tsx`（1487 行）写死了「工作区 → 会话」两层，而我们要
「连接 → 工作区 → 会话」三层；行层与走树在官方代码里本来就是分开的，所以复用的单位是行层。

## 会话标题：必须从远端日志读（`persist.titles`）

官方行显示 `node.title`，而标题是 `session/title` 事件（log-only，latest wins）——
**远端 profile 不挂 session-title，标题是本机 dsh 生成后经 routing 写进远端日志的**。
所以新增批量 RPC `persist.titles`（`src/server/session-store.ts::titles`）：对工作区内
每个会话取 `read` handle 读日志、fold 最后一个 `session/title` 取 `data.title`，
同时用最后一个事件的 `time` 作为 `updatedAt`（行的时间列）；按 `(id, sizeBytes)` 记忆化，
并发上限 4，单会话读失败只丢它自己。客户端 `listRemoteSessions` 先回 `persist.list`
再合并标题（旧远端 server 没有该 RPC → 捕获、标题留空 → 行显示「未命名」）。

## 历史：更早的形态（已被上面的方案取代）

## P4（旧）：左侧栏「远程工作区」区域与「换设备续聊」（2026-10-16）

形态：**左侧栏**里、shell 自己的「工作区」区域**正上方**并列一个「远程工作区」区域：

```
远程工作区                      [刷新] [+ 新建连接]
└─ 连接1 ●(三态)               [连接|重新连接] [添加工作区] [断开] [忘记]
   └─ 工作区1                  [打开] [新会话] [移除]
      └─ 会话1  会话2 …        [继续]
工作区                          ← shell 自己的区域，行为不变
└─ …（远程工作区已从这里隐藏，避免同一工作区出现两次）
```

### 为什么是 portal 而不是 slot（实测，2026-10-16）

shell 在左栏只声明**一个**浏览区域槽位：`sidebar.workspaces`（`kind: 'single'`），
其占位者 ui-workspace 就是整个「工作区」区域（表头 + 列表 + 全部对话框）；
**没有任何槽位可以再放一个同级区域**（已对发布的 rc.2 bundle 逐个 `data-slot`
值核对），而 ui-workspace 的 client 也不导出可复用的区域组件
（`WorkspaceBrowser` 只在包内 import）。所以：

- 增补一个同级区域只有两条路：**改 shell**（加一个 section 列表槽位），或
  **在浏览区域里挂自己的节点**。本插件走后者，且不替换任何官方占位者。
- 挂载点：`[data-slot="sidebar.workspaces"]` 的父元素（物理区域盒
  `_3WPZCG_regionArea`，`flex-direction: column`、`overflow: hidden`）——把我们的
  节点 `insertBefore(..., firstElementChild)` 即可排在「工作区」之上。该槽位元素
  是 `display: contents`（0×0，没有自己的盒），**跨折叠周期保持 DOM 身份**。
- 折叠时 shell 只把区域 `opacity: 0`（它自己的面板会卸载子树），所以本区域额外
  用 `[data-sidebar-collapsed="true"] .dsh-rw-side-host { visibility: hidden }`
  把自己移出 a11y 树与命中测试。
- 挂载对自己的**时序**负责：`src/client/sidebar.tsx` 用一个 MutationObserver 等在
  锚点出现（boot order 可能晚于插件激活），并在 shell 重排/丢弃我们的节点时重新
  插入到第一位。锚点缺失时整段不挂载、不抛错，插件面板仍是完整回退面。
- **高度链必须逐级收住**（`.dsh-rw-side-host` → `.dsh-rw-side` →
  `.dsh-rw-side-body`）：少一级 `min-height: 0`，树就会溢出宿主盒并被下面的
  「工作区」盖住（实测 host 底 770px、树内容到 1141px，被盖住的行点击命中到
  shell 的行）。紧凑行还必须 `flex-wrap: wrap`，否则动作按钮会顶出 280px 栏宽
  之外而点不到。

面板（`main` 槽位的 `dsh-remote-workspace` 页）保留为：向导的宿主、添加工作区
选择器的宿主，以及侧栏锚点不可用时的回退树。

- **先连接才能建会话**：连接节点的 `连接/重新连接` 走 `/api/connect`
  （`connectChannel`）就地接通，不进入向导；未连接时工作区动作全部 disable。
- **添加工作区** = 读**远端 dsh 自己的** `reg.list`（`/api/remote-workspaces`），
  对话框里还有「浏览远端目录…」逃生口，落到向导的目录浏览器。这正是"装了 server
  插件的 dsh 的每个工作区都能被添加"。
- **会话列表**（`/api/sessions` → `persist.list`）按工作区懒加载；`继续` 走
  `/api/open-session` → `resumeRemoteSession()`（`ctx.agents.resume`），官方
  resume 流程会 `persistence.open(id,'write')` → routing → 远端日志读回，因此
  **换设备续聊不需要任何镜像同步**：设备 B 添加同一远端工作区（`reg.list` 里已有）
  后就能看到并继续设备 A 的会话。
- `openWorkspaceRecord`（`打开`）= 有 `sessionId` 就续聊，失败（旧版坏日志 /
  另一设备持写租约）则回退新建并在 toast 里说明原因。

已知缺口（alpha）：远程会话不出现在 shell 的全局会话列表（routing `list()` 仍然
local-only），会话在树里只显示短 id + 创建时间（标题投影在官方 UI 侧）。

## 会话事件的三条写路径（实测，2026-10-16 补）

**trap：官方 JSONL 后端的 live 路由是在它自己的构造函数里 `install(ctx)` 的**，
而 routing 用**吸收注册的 stub context** 构造它 —— `on`/`effect` 在 stub 上是空操作，
所以那次 install 什么都没装上。后果不是"远程会话事件没落盘"这么局部：
**连本地会话也只剩 seed**（整个进程只有 `appendUnstoredSuffix` 的显式 append 生效）。
因此 routing 构造函数里必须补一次
`(this.local as unknown as { tracker: { install(c: Context): void } }).tracker.install(ctx)`。

远程会话不在那个 backend 的 writer 注册表里（它从没见过远程 handle），所以 routing
自己对 `session/event` / `session/flush` / `session/disposed` 装同样的三个钩子：
`create`/`open` 时按 session id 注册 `RemoteLiveWriter`（缓冲 + 在官方持久化屏障上批量
`persist.append`），handle 用 `DrainedHandle` 包一层，保证 **close 前先 drain**（官方
契约：loop 同步把收尾事件写进 session 后立刻 close，靠 close 把它落盘）。

### 三个并发坑（都已在代码里修掉，别再退化）

1. **同一 session 的并发 write open**：官方后端只允许一个 writer，第二个
   `persist.open` 会让**两个调用者一起失败**（`session "…" is already owned by an
   active write handle`），并且这个错误会挂到一轮**本来跑通的对话**上。routing 现在把
   已有的活跃 writer 以 `borrow()` 交出去：借出方可以 flush，但 `close()` 不释放所有权。
2. **`RemoteWorkspaces.withBrowser` 的 retry 会关掉共享 client**：另一个在飞的调用随即
   `SSH connection lost`（面板同时发两个请求就能复现）。现在按 target 串行化
   （`browserQueue`），retry 语义不变且不再波及并发调用。
3. **同一 session 的并发 resume**：两个 resume 都通过 "是否已 live" 检查后才竞争写所有权。
   `RemoteWorkspaces.resumeSession` 现在按 session id 串行（`resumeQueue`），第二个调用在
   第一个发布后立刻命中 live agent 直接返回。

### 服务端重启的恢复

服务端 handle 表在进程内存里，重启（空闲租约到期、显式停止、**以及每次服务端 bundle
更新的自动重部署**）会清空它。`RemoteHandle` 因此对 `unknown remote session handle`
自愈一次：重新 `persist.open`（服务端因此从磁盘重读日志，`events` 以权威 artifact 为准，
重复批次会因为 seq 不连续被拒而不是写坏），再用新 handleId 重试。其它持久化错误不重试。

## 版本策略

未正式发版前一律 `0.1.0-alphaN`（不要 `0.x.y`）。**每次部署必须 bump**
（插件批量 URL 带 `&rev=<hash>`，不 bump 浏览器吃旧缓存）；版本同时出现在
`package.json`、`/api/state` 的 `pluginVersion` 与远端 `server.hello.version`。

## 已完成的重构状态（2026-10-16）

P0–P5 均已落地：协议 v2、server 侧 `RemoteSessionStore`、`RemotePersistence`、
**P2 的 root-plane 路由接线**（方案 A：`RoutingSessionPersistence` 在 `apply()` 里
provide，官方 `session-persistence-jsonl` 行被本 bundle 的 patch `disabled`）、
P4 树形面板与续聊。历史中间态记录见 git 提交 `9d592f6` 之前。
