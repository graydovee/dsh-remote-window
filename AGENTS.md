# AGENTS.md — dsh-remote-workspace（client 半边）

DSH（DeepSeek Harness）客户端插件：把一台 SSH 主机接入为远程工作区。
**会话权威存储在远端**（官方 JSONL 格式），本地只保留 agent loop、模型请求与凭据。
本插件拥有：SSH 连接与 host-key 校验、目标凭据、连接状态、远端工作区发现、
`RemotePersistence`、远端部署（provisioning）以及左侧栏的「远程工作区」区域。

## 仓库与身份

- 本仓库：<https://github.com/graydovee/dsh-remote-workspace>
- 兄弟仓库：<https://github.com/graydovee/dsh-remote-workspace-server>（server 半边）
- commit 身份固定为 `graydovee / graydovee@foxmail.com`（两个仓库的**局部** git config）。
- 推送注意：本机 keychain 里的默认凭据是另一个账号，直接 `git push` 会 403，
  要用 graydovee 的 token：

  ```bash
  git push "https://x-access-token:$(gh auth token --user graydovee)@github.com/graydovee/dsh-remote-workspace.git" main
  ```

## 必读文档

- `../backup/legacy-project/REFACTOR-BRIEF.md` — 重构唯一权威交底（Remote Session
  架构 v6）：目标形态、协议规范、里程碑 P0–P5。
- `../backup/legacy-project/PLAN.md` — 旧单仓库的 d1–d12 偏差记录（server bundle
  为何自包含、为何要 keep-alive、mux 宽容规则等），仍然全部有效。
- `docs/remote-session-agent-note.md` — Remote Session 设计要点。
- `src/client/vendor/workspace-rows/NOTICE.md` — 内置的官方行层出处与重新内置方法。

## 命令

```bash
pnpm install
pnpm typecheck    # tsc --noEmit（无 lint 配置）
pnpm test         # vitest run（77 个用例）
pnpm build        # tsdown → lib/（三个 target，见下）
# 重新内置官方行层（升级 DSH 后跑，产物已入库）：
node scripts/vendor-workspace-rows.mjs --dsh <dsh-checkout>
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
跑；server 项目是这段代码的正式归宿与发行包来源。

协议版本 2（`REMOTE_SESSION_PROTOCOL = 2`；官方执行世界 RPC 仍是 v1）。方法集：
`server.hello`、`reg.list|create`、`persist.list|titles|rename|create|open|append|flush|close|locate`。

## 架构：tsdown 三个 target（`tsdown.config.mjs`）

1. **host**（ESM/node）：`index`（插件主行）、`connection`（preset realm 内的
   `ctx.ssh` 实现）、`rsession`（`RemotePersistence`）、`session-persistence`
   （路由持久层）、`protocol`。
2. **server**（`src/server/index.ts`）：远端执行世界 bundle。**自包含**——只
   external `@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery`；DSH 运行时模块
   拦截只解析裸包名、不解析子路径导出，故 `@deepseek-ai/dsh-ssh/protocol|/schemas`
   与 zod 全部内联（PLAN d2）。
3. **client**（浏览器，CJS 工厂，经 `window.__ModuleLoader__.load` 注册）：只允许
   平台模块表 external；**纯度门禁**会让 Node 内置物或跨插件值导入直接构建失败
   ——跨插件协作走 cordis 服务，不走值导入。CSS 运行时注入单个
   `<style data-plugin="dsh-remote-workspace">`（`src/client/styles.ts`，官方行层的
   样式表也从这里一起注入）。

目录速览：

- `src/provision/` — profile 生成 + 部署（远端固定安装根 `~/.dsh/server`，一律
  `/bin/sh -c` + 绝对路径，不依赖远端 PATH/登录 shell/系统 npm，PLAN d11）。
- `src/session-persistence/routing.ts` — 根平面路由持久层（见下文）。
- `src/rsession/remote-persistence.ts` — `persist.*` 平面的 `SessionPersistence`。
- `src/preset/world.ts` — 每目标 `isolate` realm preset（覆盖
  `ssh/fs/subprocess/sandbox/shell`）。
- `src/ssh/` + `src/ssh-config.ts` — ssh2 连接、host-key 校验、`~/.ssh/config` 解析。
- `src/targets/` — 目标/工作区记录存储与 `scrubSecrets`。
- `src/client/` — `sidebar.tsx`（左侧栏区域挂载）、`tree.tsx`（三层走树，用官方行组件渲染）、
  `session-verbs.ts` / `session-row-parts.tsx`（行内动词）、`confirm-dialog.tsx` /
  `rename-dialog.tsx`、`store.ts`（模块级 `useSyncExternalStore` 快照 + 全部动作）、
  `panel.tsx` / `list.tsx`（面板 = 向导宿主 + 回退树）、`styles.ts` / `locales.ts`。
- `src/client/vendor/workspace-rows/` — **内置的官方行层**（见 P4 一节）。

## 不变量 — 不要破坏

- **凭据不过线**：SSH 凭据、模型 API key 只在本地；错误与日志一律过
  `scrubSecrets`（`src/targets/types.ts`）。
- **host key**：未知指纹必须显式确认（SHA-256 展示），已变更的 key 一律中止
  （`src/ssh/hostkey.ts`）。
- **信任栅栏**：所有插件 HTTP 路由必须过 `trustedRequest`（`src/index.ts`，DNS
  rebinding + 跨站防护）；JSON body 1 MiB 上限；API 方法名允许含斜杠
  （`connect/start`），不要加斜杠守卫。
- **零 patch**：不改官方 `cordis.patch.yml` 任何已有行，不替换全局服务；官方
  「添加工作区」按钮行为不变。左栏区域**不占用** `sidebar.workspaces` 槽位——
  它只在槽位元素之前插入自己的节点，官方占位者原样保留。
- **连接行必须惰性**（`src/connection/index.ts`）：preset 挂载失败是粘滞且永久的，
  不可达主机不得在构造时发起连接。
- **存储域版本恒为 1**：新字段只能 additive optional（`pinnedSessions` /
  `archivedSessions` 就是这么加的），bump 即砖（单文件布局无迁移）。
- **mux 宽容规则**（PLAN d6）：未知流的 `CREDIT/END/ABORT/OPEN_OK/OPEN_FAIL`
  忽略（迟到消息），仅未知流 `DATA` 是致命帧失步。
- **client bundle 重装必须 bump `package.json` version**：插件批量 URL 带
  `&rev=<hash>`，不 bump 浏览器吃旧缓存。
- **行样式一行都不要自己写**：行是内置的官方组件（见 P4）。
- **对话框与 toast 挂在树上，不挂在面板上**：`RemoteTree` 渲染
  `AddWorkspaceDialog` / `ConfirmDialog` / `RenameSessionDialog`，toast 由
  `NoticeToastHost` 的「第一个挂载者拥有」规则保证只出现一次。只挂在面板上会让
  侧栏点按钮"什么也不发生"（踩过两次）。

## 编码规约

- TS strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` +
  `allowImportingTsExtensions`：相对导入带 `.ts` 后缀；type-only 用 `import type`。
- 可选 wire 字段沿用条件展开惯用法 `...(x === undefined ? {} : { x })`。
- 注释解释**实测约束**而非显而易见的事；适用时注明对应的 PLAN 偏差编号。
- peer 依赖区间是 `>=0.2.0-rc.1 <0.3.0`；`dsh-plugin-dev check --strict` 的
  `manifest-peers` 失败是已记录偏差，不要靠降区间去"修"。

## 测试与验收

`tests/`：`conformance`（官方 `dsh-fs-ssh`/`dsh-subprocess-ssh`/`dsh-sandbox-ssh`
provider 对着 `src/server` 副本在内存传输上跑）、`frame`、`ssh-config`、`deploy`、
`remote-persistence`（handle 生命周期 → `persist.*`）、`routing-persistence`
（本地/远端路由、header 重锚、live 事件、handle 共享）、`profile.smoke`。

**UI 验收规则**：只通过 `dsh web`（`web` profile，端口 3080）验收，
**绝不把插件装进 desktop profile**（用户的桌面应用不装本插件）。浏览器点击交给
子代理（单标签约束：`browser_list_tabs` → `browser_follow_tab` → `browser_navigate`，
永不 `browser_open_tab`），并要求它回报 DOM 实测值而不是"看起来对"。

部署循环：`pnpm typecheck && pnpm test && pnpm build` → **bump 版本** →
`pnpm pack --pack-destination ~/.dsh/tarballs` →
`dsh plugin --profile web remove/add <tgz>` → 重启 3080。

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
   `service "sessionPersistence" has been registered at <...>`；同时它的 live 路由
   是在构造函数里 `install(ctx)` 的，用 stub 构造就等于**没装**（见下面"三条写路径"）。

验证口径：远端 `~/.dsh/remote-server-sessions/<projectKey(远端路径)>/<sessionId>/`，
本地 `~/.dsh/sessions/` 不应出现该会话。

### header cwd 重锚（实测）

服务端把会话 header 的 cwd 改写成**远端路径**（`RemoteSessionStore.createSession`
用 `workspace.path` 覆盖）。这在本地无法使用：官方 workspace 注册表只把
`realpath(header.cwd) === workspace.path` 的会话算作成员，session-controller 也会
抛 `cwd conflict`。因此 `RemotePersistence` 在 `create`/`open`/`list` 三个出口把
header 重新锚定到**本地 stub**（构造参数由 routing 从 `stubForWorkspace(workspaceId)` 取）。

不变量由此统一为：**远程工作区的会话，其 cwd 永远是本地 stub**（create 与
resume 两条路一致），远端路径只在 realm 的 stub→remote 别名处出现。

## 左侧栏「远程工作区」= 官方行组件 + 我们的三层走树

形态（左栏、shell 自己的「工作区」区域**正上方**）：

```
远程工作区                      [刷新] [＋新建连接]
└─ 🌐 连接   mac-arm-200        [＋添加工作区 | 连接]  [⋮ 连接/断开 · 忘记连接]
   └─ 📁 工作区  dujiahui       [＋新会话]            [⋮ 刷新会话列表 · 移除工作区]
      ├─ 会话标题  45 分钟       [⋮ 置顶 · 重命名 · 分叉 · 归档]
      └─ 新会话                  （官方 blank 行 = 新建会话）
工作区                          ← shell 自己的区域，行为不变
```

### 行层是内置的官方代码（**不要自己画行**）

`src/client/vendor/workspace-rows/` 内置了官方 `ui-workspace` 的行层：
`Rows.tsx`（`ProjectRowItem` / `SessionNodeItem`）、`AnimatedRows.tsx`、两个
`.module.css`、`workspace` 命名空间词典。`scripts/vendor-workspace-rows.mjs`
负责生成：给 CSS 类名加前缀（`dsh-rwv-rows-` / `dsh-rwv-anim-`）、把 CSS-module
导入换成类名映射（我们没有 CSS 管线）、把 shell 内部类型导入换到 `models.ts`。
`generated/*` 带 `@ts-nocheck`（逐字节保留上游，props 仍参与我们调用点的类型检查）。

由此得到的能力：

- 工作区行 = `ProjectRowItem`（34px，文件夹 hover 换展开箭头，`＋` 与 `⋮`，官方 hover 卡）；
  会话行 = `SessionNodeItem`（32px，标题跑马灯、时间 hover 让位给行操作、
  **点击整行 = 打开会话**、`blank: true` 就是官方的「新会话」行）。
- **不缩进**。官方 CSS 是 `padding-inline-start: calc(8px + var(--dsh-workspace-indent, 0px))`，
  而实测 shell 自己的树是**平的**：工作区行与会话行的 padding 都是 8px、首个子元素都在
  x=20，`--dsh-workspace-indent` 每个 group section 都是 `0px`。所以我们的三级
  （连接/工作区/会话）也全部 0px，`INDENT_STEP` 之类的常量已删除——别再发明缩进。
- 菜单只有 `rename` / `delete.workspace` 两个固定项、`t` 由行宿主传入，我们的语义
  **靠改这两个 key 的译文**实现。`delete` 不是有效 key。
- 连接行**不能**把 `workspaceId` 传 `undefined`：vendored 组件把 `undefined` 当作
  "未分组" 桶，会把标签替换成「未分组」。我们用 `conn:<targetId>`。
- 会话 `⋮` 的两个**我们的**菜单项必须调 `close()`（seat 从行的 `hookContext` 里取出
  菜单的开关函数传下来）；自己的项不关菜单就会留一个悬空菜单（踩过）。
- 三态呈现在连接行**图标**上：`data-state` 决定文件夹槽画地球的颜色（绿/红/灰）；
  未连接/失败时还额外：菜单触发位的包裹层隐藏、`＋` 位画**插头**（CSS mask）承担
  「连接」按钮且不需 hover 就可见。
- `WorkspaceBrowser.tsx`（1487 行）**不内置**：它写死了「工作区 → 会话」两层，而我们要
  「连接 → 工作区 → 会话」三层；行层与走树在官方代码里本来就是分开的。

### 区域挂载（为什么是 portal 而不是 slot）

shell 在左栏只声明**一个**浏览区域槽位 `sidebar.workspaces`（`kind: 'single'`），其
占位者 ui-workspace 就是整个「工作区」区域；**没有槽位能再放一个同级区域**（已对发布
的 rc.2 bundle 逐个 `data-slot` 核对），ui-workspace 的 client 也不导出可复用的区域
组件。所以 `src/client/sidebar.tsx` 把节点 `insertBefore` 到
`[data-slot="sidebar.workspaces"]` 的父元素（物理区域盒）第一位：

- 该槽位元素是 `display: contents`（0×0）、**跨折叠周期保持 DOM 身份**；
- 折叠时 shell 只把区域 `opacity: 0`（它自己的面板会卸载子树），所以本区域额外用
  `[data-sidebar-collapsed="true"] .dsh-rw-side-host { visibility: hidden }` 把自己
  移出 a11y 树与命中测试；
- 挂载对自己的时序负责：MutationObserver 等锚点出现（boot order 可能晚于插件激活），
  被 shell 重排/丢弃时重新插到第一位；锚点缺失就整段不挂载、不抛错，面板仍是回退面；
- **高度链要逐级收住**（host → `.dsh-rw-side` → `.dsh-rw-side-body`）：少一级
  `min-height: 0`，树就会溢出宿主盒并被下面的「工作区」盖住（实测 host 底 770px、
  树内容到 1141px，被盖住的行点击命中到 shell 的行）。

### 把插件自己的行挡在 shell 的「工作区」之外

shell 会为远端工作区的 **stub 目录**渲染一个官方工作区行，并在会话打开后把会话行渲染成
**同一 group section 里的兄弟行**（不是那一行的子节点）。因此隐藏必须两条：

```css
[data-slot="sidebar.workspaces"] div[data-row-key="workspace:<official id>"] { display: none }
[data-slot="sidebar.workspaces"] div:has(> span > div[data-row-key="workspace:<id>"]) [data-row-key^="session:"] { display: none }
[data-slot="sidebar.workspaces"] div[data-row-key="session:<session id>"] { display: none }
```

- **必须带 `[data-slot="sidebar.workspaces"]` 前缀**：内置行用的是**同样的**
  `data-row-key`，不加前缀会把插件自己的行也藏掉（实测 44 行只剩 1 行）。
- 隐藏只动 `display`，官方行的 id/接线/行为都不动；`src/client/store.ts:watchShellRows`
  负责把这两组 id 喂给 `syncShellHiding`（工作区 id 来自记录，会话 id 来自已知会话集合）。

### 连接断开时收起子树

连接是"子节点存在的唯一通道"：`status !== 'ready'` 时 store 清掉该连接**及其所有工作区**
的展开标记（`collapseTarget`），渲染层再加一道 `connected && expanded` 的保证。因此
后台通道掉线（`refreshState` 看到非 ready）也会一起收起。重连是另一个事件，会重新展开
该节点（新的通道正是该看它工作区的时候）——这一点在 `collapseTarget` 的注释里写明，
别把两者"修"成同一种行为。

## 行内动词：官方外观，各自的落点

| 动词 | 落点 | 为什么 |
|---|---|---|
| 置顶 / 取消置顶 | 插件自己的集合（工作区记录上的 `pinnedSessions`，additive optional） | shell 的 `workspace/pinSession` 是拿**本地**会话索引校验的，对远端 id 必然 `session/not-found`（已实测）。排序：置顶在前、归档在后 |
| 归档 / 取消归档 | 同上（`archivedSessions`），与置顶互斥；归档行置灰、拒绝打开（官方行的 `aria-description`） | 同上 |
| 重命名 | `POST /api/session-rename` → 服务端 `persist.rename`：取写 handle、读日志长度、**追加一条官方形状的 `session/title`**（`source: {kind:'user'}`）、flush、放租约 | 官方"重命名"本质就是一次 append；shell 的客户端 hop（`sessions.using(...).rename`）对远端会话根本到不了（客户端 index 里没有这个 id，报 `sessions.retain: unknown session`）。**绝不要为了改名去打开会话** |
| 分叉会话 | shell 自己的 `uiWorkspace.forkSession`，之后重读插件自己的会话列表 | 官方 fork 走 routing 就能落到远端；之前失败是因为 `inheritedEventCount` 没过线 |
| 打开会话 | 点击会话行 → `POST /api/open-session` → `ctx.agents.resume` | 官方 resume 会 `persistence.open(id,'write')` → routing → 远端日志读回，**换设备续聊不需要任何镜像同步** |

两个例外路径：

- 会话**此刻已经 live 在本进程**时，重命名走 live 会话（官方 `sessionTitle.rename`
  + flush）：它持着日志写租约，服务端会拒绝二次 open，而且在内存会话上追加才对。
- 文本一律先用官方 `normalizeSessionTitle`（上限从 live 标题服务读）归一化。

行菜单的每个项在动作前必须先关菜单（`hookContext` 的 setter，见上文）。

## 会话标题：从远端日志读（`persist.titles`）

官方行显示 `node.title`，而标题是 `session/title` 事件（log-only，latest wins）——
**远端 profile 不挂 session-title，标题是本机 dsh 生成后经 routing 写进远端日志的**。
所以批量 RPC `persist.titles`（`src/server/session-store.ts::titles`）：对工作区内每个
会话取 `read` handle 读日志、fold 最后一个 `session/title` 取 `data.title`，同时用最后
一个事件的 `time` 作为 `updatedAt`（行的时间列）；按 `(id, sizeBytes)` 记忆化、并发上限 4、
单会话读失败只丢它自己。客户端先回 `persist.list` 再合并标题（旧远端 server 没有该 RPC
→ 捕获、标题留空 → 行显示「未命名」）。

## 会话事件的三条写路径（实测）

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

### 三个并发坑（都已修掉，别再退化）

1. **同一 session 的并发 write open**：官方后端只允许一个 writer，第二个 `persist.open`
   会让**两个调用者一起失败**（`session "…" is already owned by an active write handle`），
   并且这个错误会挂到一轮**本来跑通的对话**上。routing 现在把已有的活跃 writer 以
   `borrow()` 交出去：借出方可以 flush，但 `close()` 不释放所有权。
2. **`RemoteWorkspaces.withBrowser` 的 retry 会关掉共享 client**：另一个在飞的调用随即
   `SSH connection lost`。现在按 target 串行化（`browserQueue`），retry 语义不变。
3. **同一 session 的并发 resume**：两个 resume 都通过"是否已 live"检查后才竞争写所有权。
   `RemoteWorkspaces.resumeSession` 现在按 session id 串行（`resumeQueue`）。

### 服务端重启的恢复

服务端 handle 表在进程内存里，重启（空闲租约到期、显式停止、**以及每次服务端 bundle
更新的自动重部署**）会清空它。`RemoteHandle` 因此对 `unknown remote session handle`
自愈一次：重新 `persist.open`（服务端从磁盘重读日志，`events` 以权威 artifact 为准，
重复批次会因为 seq 不连续被拒而不是写坏），再用新 handleId 重试。其它持久化错误不重试。

## 版本策略

未正式发版前一律 `0.1.0-alphaN`（不要 `0.x.y`）。**每次部署必须 bump**
（插件批量 URL 带 `&rev=<hash>`，不 bump 浏览器吃旧缓存）；版本同时出现在
`package.json`、`/api/state` 的 `pluginVersion` 与远端 `server.hello.version`。
发布后再打 tag / release，目前两个仓库都**没有** tag（也没建 release）。

## 已知缺口（alpha）

- 远端会话**不出现在 shell 的全局会话列表**：routing 的 `list()` 仍然 local-only
  （远端会话由本插件的区域列出）。代价是 shell 侧会刷
  `uiConversation.binding: unknown session` 之类的噪音。
- **没有删除会话的动作**：行菜单只有 置顶/重命名/分叉/归档；要在远端清会话目前只能
  手动删 `~/.dsh/remote-server-sessions/...`。
- 插件自己的行**在 shell 的工作区里是被隐藏而不是移除**（官方行仍在 DOM 中，`display: none`）。
- 会话「运行中/待审批」状态没有观察，所以会话行**不显示状态点**（前导槽恒为空）。
