# AGENTS.md — dsh-remote-workspace（client 半边）

DSH（DeepSeek Harness）客户端插件：把一台 SSH 主机接入为远程工作区。
**会话权威存储在远端**（官方 JSONL 格式），本地只保留 agent loop、模型请求与凭据。
本插件拥有：SSH 连接与 host-key 校验、目标凭据、连接状态、远端工作区发现、
`RemotePersistence`、远端部署（provisioning）以及左侧栏的「远程工作区」区域。

**工作方式**：任何需求都按下一节的四人团队（Leader / 架构师 / Developer / QA）分工执行
—— 先分工、后动手，收工出验收结论；只有「什么时候允许不开团队」里的那类改动例外。

## 工作方式：四人团队（Leader + 架构师 + Developer + QA）

**任何需求都先分工、后动手，收工给结论。** 主 agent 默认是 **Leader**：开工时先输出
「角色分工 + 当前任务计划」，再按下面的闸门顺序推进；结束时由 Leader 输出验收结论。
角色由子代理承担（`subagent` / `subagent_fork`），QA 必须真的在浏览器上操作
（单标签约束见「测试与验收」），不能只做接口级推断。

| 角色 | 职责 | 交付物 | 红线 |
|---|---|---|---|
| **Leader** | 澄清需求、定范围/约束/验收标准、拆解与派活、协调交接、处理阻塞、汇总裁决 | 需求与目标说明、验收标准、任务计划、任务分配记录、最终验收结论 | 不替架构师设计、不替 Developer 写实现、不替 QA 做 E2E |
| **架构师** | 系统架构、模块划分与职责边界、接口定义与依赖关系、关键技术风险与取舍；维护 `doc/` | `doc/` 架构文档（概览、模块职责、依赖关系、接口说明、关键设计决策）+ 架构变更记录 | 不承担业务功能实现；原型代码须经 Leader 明确同意 |
| **Developer** | 按已确认的架构与接口实现模块，编写并运行单元测试、自测，修 QA 缺陷 | 功能实现、单元测试、自测结果、实现说明（运行方式/已知限制/变更点）、缺陷修复记录 | 不擅自改架构或接口；不自行宣布"端到端通过" |
| **QA** | 按 Leader 的验收标准设计 E2E，用浏览器工具实测核心流程/异常路径/回归 | E2E 场景、测试记录（步骤·期望·实际·证据）、缺陷清单（可复现步骤·严重程度·影响范围）、回归结果、QA 结论 | 不改业务代码；不替 Leader 做最终验收决策 |

### 闸门顺序（不跳步）

1. **Leader** 澄清需求 → 目标、范围、约束、**验收标准**（要能逐条判定）。
2. **架构师** 出架构、模块依赖、接口定义并落到 `doc/`（`doc/` 目前不存在，首次架构任务
   由架构师创建，此后只有架构师写它）。
3. **Leader** 审架构、拆任务并分配；未过这道闸，Developer 不动手。
4. **Developer** 实现 + 单元测试 + 自测，提交实现说明。
5. **QA** 按验收标准跑浏览器 E2E，提交测试记录与缺陷清单。
6. 缺陷 → Developer 修 → QA 回归；架构/接口问题 → 架构师改 `doc/` 并通知 Leader 与
   Developer。
7. **Leader** 汇总交付物，按验收标准逐条判定，写明通过项、未通过项与遗留风险。

**架构以 `doc/` 为唯一权威**：实现与文档有偏差必须先走变更确认（架构师更新文档并通知
两边），不许"代码先改、文档后补"。

### 交接约定

任何一次交接（含角色内部的小步交付）都写清四件事，缺一项视为没交付：① 交付物路径
② 当前状态（完成 / 阻塞 / 待确认）③ 下一步交给谁 ④ 需要对方拍板的问题。
「已完成」不算交付。

### 什么时候允许不开团队

**无代码、无 UI 行为**的小改动（纯文档、脚手架、版本号、注释）可由 Leader 单角色完成，
但必须在回复里说明"为什么不触发架构/开发/QA"，且不得借此跳过本文件其它硬约束
（部署循环、版本 bump、零 patch、浏览器验收口径等）。凡触及 `src/`、`lib/` 产物生成、
`cordis.patch.yml` 或侧栏可见行为，一律走完整分工。

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

- `docs/remote-session-agent-note.md` — Remote Session 设计要点。
- `src/client/vendor/workspace-rows/NOTICE.md` — 内置的官方行层出处与重新内置方法。

## 命令

```bash
pnpm install
pnpm typecheck    # tsc --noEmit（无 lint 配置）
pnpm test         # vitest run（78 个用例；Windows 上固定 17 个红是 POSIX-only fixture）
pnpm build        # tsdown → lib/（三个 target，见下）
# 重新内置官方行层（升级 DSH 后跑，产物已入库）。
# 需要**DSH 源码 checkout**：桌面/安装树里的 app.asar 只有 lib/，没有 src/client/rows/Rows.tsx。
node scripts/vendor-workspace-rows.mjs --dsh <dsh-checkout>
# 真实 profile 冒烟（需要已安装的 dsh 启动器）：
DSH_SMOKE_CLI=<path-to-dsh> npx vitest run tests/profile.smoke.test.ts
# 预打包 server 发行物（矩阵：自带 Node + dsh + 插件，CI 同款）：
node scripts/build-server-package.mjs --all --dsh-version <ver>
```

Node ≥ 22.19（或 ≥ 24）；只用 pnpm。`lib/` 是构建产物，不要手改。

## 与 server 项目的同步契约（最重要的规则）

`src/protocol.ts`、`src/server/`、`src/frame/`、`src/provision/package-build.ts` 四处与
`../dsh-remote-workspace-server` 里的同名文件**逐字节相同**（已验证）。改任何一处
必须两边同步改。原因：client 的 provisioner 部署的是**自己构建的**
`lib/server.js`（来自 `src/server/` 副本），而 conformance 测试也用副本在内存里
跑；server 项目是这段代码的正式归宿与发行包来源。

协议版本 3（`REMOTE_SESSION_PROTOCOL = 3`；官方执行世界 RPC 仍是 v1）。方法集：
`server.hello`、`reg.list|create|rename|delete`、`persist.list|titles|rename|create|open|append|flush|close|locate`。v2 客户端连 v3 server（或反过来）会得到一条可读的 `unsupported remote session protocol …`，**不静默降级**。

## 架构：tsdown 三个 target（`tsdown.config.mjs`）

1. **host**（ESM/node）：`index`（插件主行）、`connection`（preset realm 内的
   `ctx.ssh` 实现）、`rsession`（`RemotePersistence`）、`session-persistence`
   （路由持久层）、`protocol`。
2. **server**（`src/server/index.ts`）：远端执行世界 bundle。**自包含**——只
   external `@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery`；DSH 运行时模块
   拦截只解析裸包名、不解析子路径导出，故 `@deepseek-ai/dsh-ssh/protocol|/schemas`
   与 zod 全部内联。
3. **client**（浏览器，CJS 工厂，经 `window.__ModuleLoader__.load` 注册）：只允许
   平台模块表 external；**纯度门禁**会让 Node 内置物或跨插件值导入直接构建失败
   ——跨插件协作走 cordis 服务，不走值导入。CSS 运行时注入单个
   `<style data-plugin="dsh-remote-workspace">`（`src/client/styles.ts`，官方行层的
   样式表也从这里一起注入）。

目录速览：

- `src/provision/` — profile 生成 + 部署（远端固定安装根 `~/.dsh/server`，一律
  `/bin/sh -c` + 绝对路径，不依赖远端 PATH/登录 shell/系统 npm）。
- `src/session-persistence/routing.ts` — 根平面路由持久层（见下文）。
- `src/rsession/remote-persistence.ts` — `persist.*` 平面的 `SessionPersistence`。
- `src/preset/world.ts` — 每目标 `isolate` realm preset（覆盖
  `ssh/fs/subprocess/sandbox/shell`）。
- `src/ssh/` + `src/ssh-config.ts` — 两个宿侧传输：`connect.ts`（ssh2：连接、host-key 校验、exec/上传）与 `wsl.ts`（本机 `wsl.exe`：探测发行版、exec、stdin 直传、长驻通道）。`ssh-config.ts` 解析 `~/.ssh/config`。
- `src/provision/transport.ts` — **传输抽象**（`RemoteTransport`：`exec`/`writeFile`/`openChannel`/`close`），ssh 与 WSL 各一份实现；部署流水线只面向它，不 import `ssh2`。
- `src/targets/` — 目标/工作区记录存储、`scrubSecrets`，以及 `methods.ts`（平台×连接方式的纯谓词，客户端与 host 共用）。
- `src/client/` — `sidebar.tsx`（左侧栏区域挂载）、`tree.tsx`（三层走树，用官方行组件渲染）、
  `session-verbs.ts` / `session-row-parts.tsx`（行内动词）、`confirm-dialog.tsx` /
  `rename-dialog.tsx`、`store.ts`（模块级 `useSyncExternalStore` 快照 + 全部动作）、
  `panel.tsx` / `list.tsx`（面板 = 向导宿主 + 回退树）、`styles.ts` / `locales.ts`。
- `src/client/vendor/workspace-rows/` — **内置的官方行层**（见「行层是内置的官方代码」一节）。

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
- **mux 宽容规则**：未知流的 `CREDIT/END/ABORT/OPEN_OK/OPEN_FAIL`
  忽略（迟到消息），仅未知流 `DATA` 是致命帧失步。
- **client bundle 重装必须 bump `package.json` version**：插件批量 URL 带
  `&rev=<hash>`，不 bump 浏览器吃旧缓存。
- **行样式一行都不要自己写**：行是内置的官方组件（见「行层是内置的官方代码」）。
- **对话框与 toast 挂在树上，不挂在面板上**：`RemoteTree` 渲染
  `AddWorkspaceDialog` / `ConfirmDialog` / `RenameSessionDialog`，toast 由
  `NoticeToastHost` 的「第一个挂载者拥有」规则保证只出现一次。只挂在面板上会让
  侧栏点按钮"什么也不发生"（踩过两次）。

## 编码规约

- TS strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` +
  `allowImportingTsExtensions`：相对导入带 `.ts` 后缀；type-only 用 `import type`。
- 可选 wire 字段沿用条件展开惯用法 `...(x === undefined ? {} : { x })`。
- 注释解释**实测约束**而非显而易见的事；写清当年的现象与结论，别只写"按设计如此"。
- **`engines.dsh` 与全部 `@deepseek-ai/dsh-*` peer 都写精确值 `0.2.1-rc.2`，不写区间。**
  理由：0.2.1-rc.2 是唯一实测过的版本，写 `>=0.2.1-rc.2 <0.3.0` 等于替 0.2.2 提前担保——
  而后续 0.2.x 完全可能改掉 `apply()` 挂载式持久后端、`hello` 的 `kind`/`executable` 严格
  形状或行/`data-slot` 契约。DSH 的准入只看 `engines.dsh`（存在时 peer 被忽略），所以两者
  钉成同一个精确值，清单里就没有任何一处读起来像"0.2.x 都行"。扩窗是一次发布动作：
  升 `devDependencies` → 跑 typecheck/conformance/浏览器验收 → 同版本里改两个仓库的声明。
  `dsh-plugin-dev check --strict` 的 `manifest-peers` 失败是已记录偏差，不要靠升降区间去"修"。
- **`zod` 必须钉死成 harness 用的那个确切版本（当前 `4.4.3`），不要写 `^`。**
  实测：官方包用 `zod: 4.4.3`，而 `^4.4.3` 会解析到 4.6.x，树里出现两份 zod 后
  `z.infer`/`ZodType` 跨副本交叉推导，`tsc` 会在 `src/targets/store.ts`、
  `src/server/processes.ts`、`src/server/controller.ts` 上跑到 4 GB / 8 GB 堆都
  OOM（`Ineffective mark-compacts near heap limit`），钉回单份后 typecheck 是 6 秒。
  升级 DSH 时先看 `node_modules/zod/package.json` 与任一官方包的 `dependencies.zod`。

## 测试与验收

`tests/`：`conformance`（官方 `dsh-fs-ssh`/`dsh-subprocess-ssh`/`dsh-sandbox-ssh`
provider 对着 `src/server` 副本在内存传输上跑）、`frame`、`ssh-config`、`deploy`、
`remote-persistence`（handle 生命周期 → `persist.*`）、`routing-persistence`
（本地/远端路由、header 重锚、live 事件、handle 共享）、`profile.smoke`。

**UI 验收规则**：只通过 `dsh web`（`web` profile，端口 3080）验收，
**绝不把插件装进 desktop profile**（用户的桌面应用不装本插件）。浏览器点击交给
子代理（单标签约束：`browser_list_tabs` → `browser_follow_tab` → `browser_navigate`，
永不 `browser_open_tab`），并要求它回报 DOM 实测值而不是"看起来对"。

部署循环：**bump 本地修订号**（`0.1.0-alpha1.x`，仅本机）→ `pnpm typecheck && pnpm test && pnpm build`
→ `pnpm pack --pack-destination ~/.dsh/tarballs` →
`dsh plugin --profile web remove/add <tgz>` → 重启 3080。

## 会话持久层的路由接线（实测，2026-10-16；0.2.1-rc.2 复核 2026-10-17）

远程工作区的会话是**远端权威**：本插件在 `apply()` 里构造 `RoutingSessionPersistence`
（`src/session-persistence/routing.ts`）并 provide 为 `sessionPersistence`，按会话 cwd
路由——本地 cwd 委托内嵌的官方 JSONL 后端（root 仍是 `~/.dsh/sessions`，本地会话行为
逐字节不变），远程 stub cwd 走远端 `persist.*` 平面。

五条**实测约束**（踩过的坑，改这里之前先读）：

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
4. **`RemotePersistence`（我们自己 `extends SessionPersistence` 的那个门面）仍必须用
   stub context 构造**（`Reflect.construct(RemotePersistence, [registrationAbsorbingContext(), ...])`
   再把 `ctx` 换回真值）：基类构造函数会 `provide('sessionPersistence')`，在根上下文
   二次注册直接抛 `service "sessionPersistence" has been registered at <...>`。
   内嵌的**官方**后端不再需要这一套（见第 5 条）。
5. **官方 JSONL 后端在 0.2.1-rc.2 是一个"插件行"，不是可 `new` 的类**：它只导出
   `apply(ctx, config)`，并在**被挂载的 ctx** 上 provide `sessionPersistence`、同时把
   live 路由 tracker `install` 到那个 ctx。因此内嵌做法是
   `ctx.isolate('sessionPersistence', LABEL)` 拿一个服务隔离的子 scope，对它
   `await applyJsonl(scope, { root })`，再用 `scope.get('sessionPersistence')` 取回实例。
   两个后果：① 隔离只影响服务注册、不影响事件——cordis 的事件分发是全局派发
   （只有 service 用自己的 filter 时才收窄），所以 tracker 在子 scope 上照样收到
   root 平面发出的 `session/event`，**不需要**旧版那次手工 `tracker.install(ctx)`；
   ② 挂载是异步的，`localReady` 必须在每个本地委托前 await（构造里同时挂一个
   `.catch(() => {})`，避免变成未处理拒绝）。

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

**历史 trap（0.2.0-rc.x，已不适用但值得记住成因）**：那时官方 JSONL 后端是个可 `new`
的类、live 路由在**它自己的构造函数**里 `install(ctx)`，而 routing 用吸收注册的 stub
context 构造它 —— `on`/`effect` 在 stub 上是空操作，于是那次 install 什么都没装上，
**连本地会话也只剩 seed**，只能靠手工补一次 `tracker.install(ctx)` 救回来。
0.2.1-rc.2 改成 `apply(ctx, config)` 之后这条坑消失：tracker 由官方自己装在被挂载的
scope 上（见上文约束 5）。**别再往 routing 里加 `tracker.install` 补丁。**

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

## 与 harness 的契约面（0.2.1-rc.2 复核，2026-10-17）

升级 DSH 时必须重新核对这四处；都是**运行时**契约，tsc 抓不到（我们对 `ctx.ssh`
是自己 `declare module` 的，不和官方 `SshConnection` 做结构比对）：

1. **`hello` 形状变了**：`dsh-ssh` 的 `helloSchema` 现在是
   `{ protocol, hash, kind: 'executable' | 'node-script', platform, nodeVersion, executable, root, workspace, bootstrapHash? }`，
   旧的 `node` 字段消失。schema 是 `$strict`，所以**发旧形状会在 `.parse` 直接抛**。
   远端 server（`src/server/controller.ts`）发 `kind: 'node-script'` +
   `executable: process.execPath`（我们是 `lib/server.js` 由部署的 node 执行）。
2. **`ctx.ssh` 的服务面**：官方 `SshConnection` 只有 `ready` / `ptcLaunch` / `request` /
   `connectStream` / `dispose`。旧的 `nodeExecutable` + `bootstrapPath` 两个 getter 被
   合并成 `ptcLaunch`（`{kind:'embedded',executable}` 或
   `{kind:'node-script',executable,bootstrapPath}`）。实测 0.2.1-rc.2 安装树里
   **没有任何消费方读 `ptcLaunch`**（只有 dsh-ssh 自己定义），所以 `RemoteConnection`
   里仍然以"不支持 PTC"抛错，但成员本身必须存在，别再退回两个旧 getter。
3. **客户端平台面**：我们只依赖两处外壳标识——DOM 锚点
   `[data-slot="sidebar.workspaces"]`（区域挂载用 portal，见「区域挂载」一节）和 `main` 槽位
   注册（`ctx.slots.register` / `layout.selectPanel`）。**`sidebar.panellist` 行
   已经删掉**（alpha30）：它只是复制了「远程工作区」区域 `+ 新建连接` 的入口，
   现在唯一的入口是那个 `+`。此外依赖行契约（`data-row-key`、菜单键
   `delete.workspace` / `actions.newSession`、`blank` 行、归档行的
   `aria-description`、`--dsh-workspace-indent`）——这些在 0.2.1-rc.2 逐项复核
   **仍在**。行层本身是我们内置的官方副本，shell 改自己的 `Rows.tsx` 不影响我们的
   渲染；受影响的是上面这些外部标识。
4. **桌面安装树仍然不含 SSH 包**：`@deepseek-ai/dsh-ssh` / `dsh-fs-ssh` /
   `dsh-subprocess-ssh` / `dsh-sandbox-ssh` 在 `app.asar/dsh/node_modules` 里不存在
   （Desktop 是本地产品）。要在 desktop 的 `dsh web` 里跑本插件，必须把它们装进
   `web` profile；另外 `dsh plugin --profile web add` **只写 `dependencies`，不会把包
   加进 `dsh.profile.bundles`**——不加 bundle 层，`cordis.patch.yml` 不生效，启动时会
   看到 `dsh-remote-workspace … failed to import` + 6 个官方行 pending。

## WSL 目标（仅 Windows，alpha31 起）

WSL 目标 = **本机的一个发行版**当前执行世界：不联网、没有 host key，传输是 spawn 出来的
`wsl.exe`。所有实测约束都记在这里，改这块之前先读。

**平台闸门（两端各有职责，缺一不可）**：`process.platform === 'win32'` 才允许，判定写在
`src/targets/methods.ts::methodAvailable`。客户端据此**整个不渲染** WSL 卡片（不是置灰）；
host 侧 `connect/start` 与 `wsl-distros` 在非 win32 直接 400。两处用同一谓词，避免"藏了但
没拦"。`/api/state` 新增 `platform` 字段就是为了让浏览器知道宿主 OS。

**发行版探测（`wsl -l -v`）**：
- 只有 `wsl.exe` 自己的管理输出是 **UTF-16LE**（`-l`/`--version`/`--status`，连错误也是），
  按 utf8 读会得到夹 NUL 的乱码；`wsl -d X -- cmd` 的输出才是 UTF-8。两种解码别混用。
- WSL 2.4.13 **不支持** `--format json`（`E_INVALIDARG`），只能解析表格。
- 发行版名**可能含空格**（Store 装的 `Ubuntu 22.04.3 LTS`），所以行解析从**尾部**取 token
  （末位数字=VERSION，倒数第二=STATE，其余整段=NAME），不能按列宽切。
- `Installing` 行没有 VERSION 列，要能容忍。
- **探测不得启动发行版**：只用 `-l -v`；也**不要**为了预填用户去跑 `whoami`（那会把 Stopped
  的发行版拉起来）。用户名留空 = 发行版默认用户。

**连接与部署**：
- 五步流水线与 SSH 完全共用（`provisionOver`），差别只在 `openTransport`：WSL 分支先跑
  `wsl -d <distro> -- true` 证明可达（这一步会把 Stopped 的发行版拉起来，这就是"连接"的语义）。
- **没有 host key**：`hostKeyFingerprint` 对 WSL 恒为 `''`，所以 `connectOnce` 的"指纹为空
  就拒绝"必须 kind-aware；`runConnect` 对 WSL 跳过指纹确认循环，也不存 credential。
- 记录里 `host` 存发行版名、`port` 恒 22（不参与）、`username` 存 distro 用户或 `'default'`
  （schema 要求非空），真正的标识是 `wslDistro`/`wslUser`。存储域版本仍是 1（additive）。
- **上传必须走子进程 stdin**（`writeWslFile` → `cat > path`）。不要复用 ssh 那条 base64
  heredoc 兜底：node 发行包 25–50 MB，一条命令塞进去会顶爆 `ARG_MAX`。已实测
  `'hello' | wsl.exe -d Ubuntu-22.04 -- /bin/sh -c 'cat > f'` 可往返。
- 通道 = `spawn('wsl.exe', ['-d', d, '--user'?, '--', '/bin/sh', '-c', serverCommand])` 的
  stdio；`exited` 供启动存活窗口（8s）判定，`diagnostics()` 给失败时的 stderr 尾巴。
  `close()` 结束 stdin 再 kill（`wsl.exe` 只是包装器，发行版内进程由 server 自己的租约兜底）。
- **`packStage` 不能写死 `/usr/bin/tar`**：WSL 是 Windows-only，它的 server 包也在 Windows
  上打，而 Windows 10+ 的 `tar.exe` 在 PATH 里。现在先试 `/usr/bin/tar`，否则用 PATH 的 `tar`。

**多行脚本必须走 stdin（`sh -s`），不能走 argv（实测 2026-10-18）**：`wsl.exe` 会重新解析
Windows 命令行，7 行的 body 经 `-c` 传进去会**丢行**，甚至被发行版的默认 shell（zsh）捡去
执行（表现为 `zsh:12: unmatched "`）。所以 `wslExec()` 一律 `spawn(…, ['-d', d, '--', '/bin/sh', '-s'])`
再把脚本写进 stdin；只有**单行**命令（通道启动、`cat > file`）才用 `-c`。区分两种解码与
两种传参方式是这块最容易翻车的地方。

### Windows 宿主上的交叉暂存（实测跑通，alpha47）

WSL 目标只在 Windows 上存在，所以 **linux 包常常是在 Windows 上打出来的**。这条路上的坑
（每一个都让部署在远端以完全不同的面貌失败）：

1. **`findHostPnpm`** 要同时认 `pnpm.cjs`/`pnpm.mjs` 与 `node`/`node.exe`（打包的 runtime 用 `.mjs`）。
2. **launcher 探活用包清单里的 bin JS**（`node_modules/@deepseek-ai/dsh/<bin.dsh>`）：`.bin/dsh`
   在 Windows 上是 **shell 包装脚本**，`node .bin/dsh` 解析不了；`/usr/bin/env` 在 Windows 上
   根本不存在。
3. **打包会丢可执行位**：NTFS 没有 +x，解出来的文件 mode 是 0666，所以安装脚本用
   `test -e` + `chmod +x`，真正的判据是随后 `--version` 的输出。
4. **`packageFiles` 的 `path` 是远端路径**：`join('lib', name)` 在 Windows 上是 `lib\server.js`，
   拿它当远端路径会把文件写成包根的 `libserver.js`，而真正的 `lib/server.js` 保持旧构建 ——
   症状是远端握手报 `Invalid input: expected 1`（旧 bundle 的协议常量）而不是文件缺失。
5. **`@deepseek-ai/node-addon-system`（flock）没有 win32 构建**，Windows 上暂存时一个都装不到，
   直到远端第一次给会话加锁才炸：`Cannot find module '@deepseek-ai/node-addon-system-linux-x64/package.json'`。
   `fixNativeClosure` 现在按 family 补装：`node-addon-require-builtin-<platform>-<arch>[-<libc>]`
   与 `@deepseek-ai/node-addon-system-<platform>-<arch>`（**后者没有 libc**，`isForeignBindingDir`
   必须按 family 取目标 flavour，否则会把刚装上的包当"外来平台"删掉）。

### 每 target 只能有一个远端 server 进程（alpha46 实测）

`persist.create` 返回的是**内存句柄**，日志要 flush 才落盘（那时远端只有 `session.lock`）。
所以任何 `persist.*` 落在**第二个** server 进程上都会答 `session "…" not found` ——
浏览会话必须和 realm 共用同一条通道（一个进程），不能各开一条 `wsl.exe`。

这条约束连带三个必须一起守住的不变量：

- **`RemoteClient.close()` 只关自己的 peer**：`mux.close()` 是**传输层拆除**，会 destroy 子进程的
  stdio；那样下一次 attach 会在 0 ms 内报 `SSH connection lost`（实测 `in.destroyed=true
  out.destroyed=true`），realm 的会话也跟着死。
- **`connectOnce` 缓存通道后要立刻 attach 一个心跳客户端**：否则从「连接成功」到「第一次目录/
  会话操作」之间没有任何心跳，30s 租约一到 server 自己退出。
- **浏览客户端按 target 缓存**（空闲 120s 回收）：不能一次操作一条通道 —— 每次都要重新
  provisioning + 在 distro 里起一个 dsh，一次目录导航 40 秒。

**Windows 上的 stub 是 `C:\…`**：`session/open.ts` 的"绝对路径"判定必须用 `isAbsolute`，
不能写 `startsWith('/')`；`publicTarget` 也要带出 `wslDistro`/`wslUser`，否则列表行只剩 `host`。

### 远端世界的沙箱与执行（alpha48–50 实测）

- **`dsh-sandbox-ssh` 只是把 `request('sandbox', { argv, policy })` 转发到远端**，真正的
  `confine()` 在**远端 server 里**执行。WSL 的 Ubuntu 既没有 bubblewrap 也没有 Landlock，
  于是每条 shell 命令都在闸门被拒：
  `sandbox mode "workspace-write" is requested but no sandbox backend is usable on this host…`。
- 处置（`src/server/controller.ts`）：远端世界**本身就是隔离边界**，所以 `confine()` 报
  "no sandbox backend is usable" 时**原样执行 argv**（并在远端日志里说一次）。这与
  workspace-write 的本地语义一致（"就是这台机器的这个工作区"），也不再逼用户点
  danger-full-access 审批。
- **但返回值必须是官方 facts 对象，不能是裸 argv（alpha55 实测的致命坑）**：
  `@deepseek-ai/dsh-sandbox-ssh::confine()` 用 **strict** schema 校验远端返回
  `{ argv, enforcement: 'full'|'partial', denialSignatures: string[], runnerFailureRules: [...] }`。
  alpha48–54 的兜底分支 `return input.argv` 是**裸字符串数组**，于是客户端 `.parse` 拒绝、
  被 `catch` 包成 `SandboxUnavailableError`，用户看到的是
  `sandbox mode "workspace-write" … no sandbox backend is usable on this host … (Linux)…(macOS)…(Windows) … Runner failure: [`
  —— 那句话是 `SandboxUnavailableError` 的**通用模板**（它同时列三种平台的建议，与真实平台
  无关，极容易被误读成"本机 Windows 沙箱被调用了"），而 `Runner failure:` 后面那个孤零零的
  `[` 就是裸数组 / zod `issues` 的开头。兜底现在返回
  `{ argv, enforcement: 'partial', denialSignatures: [], runnerFailureRules: [] }`
  （`partial`：没有任何 backend 真正约束过 argv，声称 `full` 是失败方向错误）。
- **验证必须用官方 strict schema，不许用 `z.unknown()`**：alpha48–50 那次"验证通过"正是因为
  用 `z.unknown()` 拿到了裸数组，绕过了契约，于是这个 bug 活到 alpha55 才被浏览器 E2E 抓到。
- 远端 `sandbox-policy` 行的 `mode` 默认 `workspace-write`、`workspaceRoot = process.cwd()`
  （远端世界自己的工作区根），不需要改。
- 端到端验证口径（真跑一条命令，拿到字面输出）：

  ```ts
  const p = await provisionTarget({ target /* kind:'wsl' */, packageRoot, packagePolicy })
  const c = await openRemoteClient(p.channel, '/home/graydove')
  const facts = z.object({ argv: z.array(z.string()), enforcement: z.enum(['full','partial']),
    denialSignatures: z.array(z.string()), runnerFailureRules: z.array(z.unknown()) }).strict()
  await c.request('sandbox', { argv: ['/bin/uname','-s'], policy: { mode:'workspace-write', workspaceRoot:'/home/graydove' } }, facts)
  // → { argv: ["/bin/uname","-s"], enforcement: 'partial', denialSignatures: [], runnerFailureRules: [] }
  //   用官方 facts 形状（strict）校验；用 z.unknown() 会把"裸数组"的 bug 放过去。
  await c.request('executable', { command: 'uname' }, z.unknown())      // → "/usr/bin/uname"
  const prep = await c.request('process.prepare', {
    argv: ['/bin/sh','-c','uname -s; pwd; echo WSL-OK'], cwd: '/home/graydove', graceMs: 5_000,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 65_536 }, stderr: { maxBytes: 65_536 } },
  }, z.unknown())
  await c.request('process.start', { id: prep.id }, z.unknown())
  await c.request('process.wait', { id: prep.id }, z.unknown())
  const done = await c.request('process.done', { id: prep.id }, z.unknown())
  // collected.stdout.tail 是 base64 → "Linux\n/home/graydove\nWSL-OK\n"
  ```
- **realm 与浏览共用同一个 `RemoteClient`**（`RemoteWorkspaces.remoteClient()` + `pin()`）：
  一个字节流只能有一个 mux/peer。之前各自建 peer，谁先收到 `hello` 响应就把对方的请求饿死，
  表现为"空闲一阵后 `SSH connection lost`"（realm 的心跳因而从未成功）。realm 的
  `dispose()` 只**解绑并 release pin**，绝不 `mux.close()`（那是传输层拆除）。
- **`process.done` 的 stdout 是 base64**（`collected.stdout.tail`），不是明文。

### 侧栏行的可点击性

内置行是 `div` + JS 点击，**在无障碍树里没有激活目标**（实测：侧栏清单只有 刷新 / 新建连接），
自动化与读屏都进不去。`tree.tsx` 现在用 `TreeRow` 包一层
`role="button"` + `tabIndex=0` + `aria-expanded` + Enter/Space 转发（`display: contents`
不产生盒子，布局逐字节不变）。连接行由此可点（点一下即展开/连接）；工作区与会话行的
可点击性仍不完整（展开后其真实按钮会出现，但行本身时有时无），**这是已知缺口**。

## server 包的 release 与「远程下载」（alpha63 起）

**发布**：**在 `dsh-remote-workspace-server` 仓库**（不是本仓库！这些 tarball 是那个项目的
产物），`.github/workflows/server-release.yml`，`push: tags: ['server-v*']` 触发，矩阵
`linux-x64-gnu / linux-arm64-gnu / darwin-x64 / darwin-arm64`，每个组合产出
`dsh-remote-server-<dshVersion>-<tag>.tar.gz` + `.sha256` + `.manifest.json`，同一个 job
把它们挂到**两个** release：

被推的 tag，即 `server-v<dshVersion>`（如 `server-v0.2.1-rc.2`）—— 包是按 **dsh 版本**构建的，
客户端第一个候选就是它。插件自己的 tag（`v0.1.0-alphaN`）留在本仓库，**不挂 server 包**。

历史教训（2026-10-19）：曾经把 server 包发在本仓库的 release 里，因为客户端 URL 硬编码成了
`dsh-remote-workspace`；那是把另一个项目的产物挂在本项目的发布页上。现在
`assets.ts::RELEASE_REPO = 'dsh-remote-workspace-server'`，构建与发布都在 server 仓库。

**没有 Windows 矩阵项**：远端执行世界是 POSIX —— 部署脚本全是 `/bin/sh` + `tar` + `chmod`，
`artifactTag()` 的类型也只接受 `linux | darwin`。Windows 远端需要独立部署器，不属于本插件。

**下载**（`src/provision/assets.ts`）：候选 tag 顺序 `server-v<dshVersion>` → `v<pluginVersion>`；
每个 tag 内部两种传输，按序尝试：

1. `https://github.com/<owner>/<repo>/releases/download/<tag>/<name>`（官方语义）；
2. `api.github.com` REST：`/releases/tags/<tag>` 按 `assets[].name` 找到 id →
   `/releases/assets/<id>` 带 `Accept: application/octet-stream` 落盘。

第二条是**实测必需**：这台机器上 `github.com:443` 会整段不可达（`curl (28)` 连接超时 /
`(56)` 被 reset），而 `api.github.com` 一直可用；`gh release download` 能成功正是因为它走 API。
`mirror` 一旦配置就**只**试镜像（镜像未必是 GitHub）。`.sha256` 永远与成功的那次传输、那个
tag 同源；摘要不一致是硬错，不换 tag 也不换传输。curl 统一
`-fL --retry 3 --retry-connrefused --connect-timeout 20`。

验证口径（端到端）：把 `~/.dsh/remote-assets/<artifact>.tar.gz{,.ready,.sha256,.manifest.json}`
挪走 → 新建连接选「远程下载」→ 进度里必须出现 `server package downloaded from release …`，
随后 `server package ready via download` → 上传 → `ready`；缓存 `.ready` 内容必须逐字符等于
release 里那份 `.sha256`。
## 版本策略

**仓库里的版本 = 发布版本，当前 `v0.1.0-alpha1`。**

本地调试部署时**不改发布版本号，只加修订后缀**：`0.1.0-alpha1.1`、`0.1.0-alpha1.2`……
在**执行部署的那台机器**上把后缀 +1（插件批量 URL 带 `&rev=<hash>`，不 bump 浏览器吃
旧缓存）；同一字符串也出现在 `/api/state` 的 `pluginVersion` 与远端
`server.hello.version`。后缀必须加在 `pnpm build` **之前**——server 的兜底版本号会被
编译进 `lib/server.js`。

**这些临时版本永不推送到远程**：不提交、不 push、不打 tag、不发布。提交进仓库的
`package.json`、`src/server/index.ts` 版本串与 `lib/` 始终是发布版本。部署完用
`git checkout -- package.json src/server/index.ts && pnpm build` 把工作树还原。

提进仓库就等于把调试号当成发布版本，也等于让同一版本号对应两份不同内容。

已打 tag：client 仓库 `v0.1.0-alpha1`（插件里程碑，**不带** server 包）；server 包只在
`dsh-remote-workspace-server` 仓库按 `server-v<dshVersion>` 打 tag 并发 release。

## 已知缺口（alpha）

- 远端会话**不出现在 shell 的全局会话列表**：routing 的 `list()` 仍然 local-only
  （远端会话由本插件的区域列出）。代价是 shell 侧会刷
  `uiConversation.binding: unknown session` 之类的噪音。
- **没有删除会话的动作**：行菜单只有 置顶/重命名/分叉/归档；要在远端清会话目前只能
  手动删 `~/.dsh/remote-server-sessions/...`。
- 插件自己的行**在 shell 的工作区里是被隐藏而不是移除**（官方行仍在 DOM 中，`display: none`）。
- 会话「运行中/待审批」状态没有观察，所以会话行**不显示状态点**（前导槽恒为空）。
- **工作区行菜单没有「刷新会话列表」**：官方行菜单只有 `rename` / `delete.workspace` 两个
  固定 key，「重命名工作区」占了 `rename`，列表改在展开与每个动词后自动重读。
- **远端 registry 里的工作区标题不同步**：重命名只改插件记录的 `title`（绝不 `mv` 远端目录）；
  要让远端 `reg.list` 也改名需要新增 `reg.rename` RPC（触碰 `src/server/**` 与两仓同步）。
- **工作区权威在 server（alpha61）之后的三条限制**：
  ① 跨客户端收敛是**轮询式**的（每个 `reg.list` 先 `stat` 索引文件的 `{mtimeMs,size}` 再决定重读），
  没有跨进程通知；多客户端并发写同一清单时**最后写覆盖标题**（标题是单值），但读-改-写保证
  **不会丢工作区条目**。
  ② 同一个 server 被两个 target（或两台客户端）连上时，**点击已在另一个 realm 里 live 的会话**
  不会切换主区、也没有提示（走了「已打开」早退分支）——边缘场景，未处理。
  ③ 工作区**不能只在本机隐藏**：「移除工作区」删的是 server 上的清单条目，所有客户端都会消失；
  要本地隐藏需要另一个语义（未实现）。
- **shell 侧的 `uiSession.bindingSource` 在记录非 live 时会抛错**，而它的 render 没有 error
  boundary —— 这是 alpha54 那次「断开→重连整页白屏」的底层原因。我们已在断开/删除/掉线前
  用官方 `uiWorkspace.clearMain()` 取消选中来回避；但若右栏仍留着该会话的 dock 页签
  （`SidebarSessionViews.prune()` 会保留 `hasRetainedTabs`），仍可能触发同一路径。彻底修复
  需要 shell 侧回落到 absent projection + error boundary。
- **新连接首帧可能显示一次错误的空态**：`/api/state` 的 `serverWorkspaces` 还没就绪时，
  侧栏会短暂出现「该 server 上还没有工作区」，点一次刷新即恢复（alpha63 实测）。观感问题，
  未修：正确做法是在首帧也把「未知」与「空」区分开（契约 §15.2 的缺键语义只覆盖了稳定态）。
- **下载路径不落 `.manifest.json`**：只有本机构建会写 `…manifest.json`；从 release 下载的缓存
  只有 `tar.gz` + `.ready`（摘要写在 `.ready` 里，不保留 `.sha256` 伴随文件）。依赖 manifest
  做版本核对的场景需要自己从 release 取。
