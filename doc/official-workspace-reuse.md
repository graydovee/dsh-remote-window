# 官方工作区 UI / 功能复用与改动清单

> 维护者文档。回答四个问题：**UI 是否复用、对官方 UI 改了什么、功能是否复用、自己实现了什么**。
>
> 最后核对：2026-10-26（rc.3 兼容性复核）。  
> 运行版本：DSH Desktop `0.2.1-rc.3`；行组件仍 vendor 自 `0.2.1-rc.2`。  
> vendored 行组件的来源：`dsh-v0.2.1-rc.2`（commit `687f282e86`）。  
> rc.3 升级未改 vendor DOM；row API/样式边界复核见 `doc/dsh-rc3-compatibility.md`。  
> **v1 重构已改变复用边界：server 模式主区不再复用客户端草稿页，而是同源 iframe 嵌入 profile 官方 UI；
> local 模式才复用客户端官方会话/草稿。§1–§11 保留为旧架构记录，v1 口径以 §12 为准。**
>
> 官方源码路径均相对 DSH 仓库根目录。本文档不记录任何主机、用户名、凭据或本机绝对路径。

---

## 0. 一句话结论

- **UI**：复用官方 **行级展示组件**——`ProjectRowItem`（工作区/分组行）和 `SessionNodeItem`
  （会话行），以及它们的 CSS module 和 `workspace` locale 字典。远程草稿的 hero preset seat
  用只读固定 chip 条件覆盖；本地草稿仍用官方 seat。没有复用官方 `WorkspaceBrowser`
  的容器、section 头、搜索、拖拽、归档过滤、对话框和 action 组件。
- **功能**：新建会话/草稿页、打开后的会话 reveal、分叉、JSONL 持久化复用官方；远端 workspace
  生命周期、pin/archive 存储、session rename、远端 resume、连接/部署等是插件自建。
  `session/created` 的 `assertRemoteSessionPreset` 是 fail-closed 守卫。
- **最大风险**：官方行组件、`uiWorkspace` service 签名、官方 session action 的顺序/文案/确认流程
  发生变化时，插件不会自动跟进；必须按 §8 的流程逐项复核。

---

## 1. 复用边界

### 1.1 复用了哪些官方 UI

| 官方组件/资源 | 来源 | 插件用途 |
|---|---|---|
| `ProjectRowItem` | `packages/client/ui-workspace/src/client/rows/Rows.tsx` | 连接行、远程工作区行 |
| `SessionNodeItem` | 同上 | 远程会话行、临时「新会话」草稿行 |
| `Rows.module.css` | `.../rows/Rows.module.css` | 行高、缩进、hover 切换、菜单壳、marquee、选中态 |
| `AnimatedRows.module.css` | `.../rows/AnimatedRows.module.css` | 行增删动画样式（当前未实际使用） |
| `workspace` locale 字典 | `packages/client/ui-workspace/src/client/locales.ts` | 行内动作文案（置顶/归档/分叉/重命名等） |

`AnimatedRows.tsx` 也被复制并导出，但当前 [`tree.tsx`](../src/client/tree.tsx) 没有使用；
`Rows.tsx` 里的 `SearchResultItem` 被复制进生成文件，但没有导出、也没有使用。两项都是可清理的
vendored debt。

### 1.2 没有复用的官方 UI

- **`WorkspaceBrowser.tsx` 整层**：section 头、搜索框、分组/扁平列表、拖拽排序、归档过滤、
  session 数量折叠、工作区添加/rename/delete 对话框、action 组件，全部没有复用。
- **官方 session action 组件**：`PinSession`、`ArchiveSession`、`RenameSession`、`ForkSession`
  没有 vendor；插件自己写了 [`SessionMenu`](../src/client/session-row-parts.tsx) 和
  [`SessionRowActions`](../src/client/session-row-parts.tsx)。
- **官方对话框**：`SessionRenameDialog`、工作区重命名/删除确认、归档停止确认等没有复用；
  插件有自己的 [`rename-dialog.tsx`](../src/client/rename-dialog.tsx)、
  [`workspace-rename-dialog.tsx`](../src/client/workspace-rename-dialog.tsx)、
  [`confirm-dialog.tsx`](../src/client/confirm-dialog.tsx)。
- **官方本地目录选择器**：远程需要浏览远端目录，插件有自己的
  [`directory-picker.tsx`](../src/client/directory-picker.tsx) 与添加工作区对话框。
- **官方 agent preset hero seat**：远程草稿期间用只读的固定 chip 覆盖；本地工作区仍使用官方
  seat（`conversation.hero.agentPreset`），不把它变成全局替换。

### 1.3 复用了哪些官方功能

| 功能 | 官方入口 | 插件用法 |
|---|---|---|
| 新建会话/草稿页 | `uiWorkspace.startSession(workspaceId, { agentPreset })` + 官方 draft/composer | 复用；插件只负责 `prepareWorkspace` 准备远端工作区/stub/官方行 |
| 打开会话的显示 | `uiWorkspace.openSession(sessionId)` | 复用；远端 resume 由插件完成，成功后调用官方 reveal |
| 分叉会话 | `uiWorkspace.forkSession(sessionId)` | 直接复用；插件只刷新自己的列表 |
| 会话持久化 | 官方 `session-persistence-jsonl` | 复用 JSONL 实现；插件在其上做 routing persistence |
| 官方行展示 | `ProjectRowItem` / `SessionNodeItem` | vendored 复用 |
| Agent preset / realm 框架 | `ctx.agentPresets`、官方 SSH providers | 复用框架；远程 preset 由插件提供 |

### 1.4 自实现的功能（必须维护）

| 能力 | 位置 | 为什么自实现 |
|---|---|---|
| 左侧 section 挂载 | [`sidebar.tsx`](../src/client/sidebar.tsx) | 官方 `sidebar.workspaces` 是 single，没有第二个 section 的 seat；插件按 DOM seam 挂载 |
| 三层树（连接 → 工作区 → 会话） | [`tree.tsx`](../src/client/tree.tsx) | 官方 `WorkspaceBrowser` 写死两级 walk，不能直接复用 |
| 连接行/工作区行的连接状态、globe/plug、a11y 包装 | `tree.tsx` + [`styles.ts`](../src/client/styles.ts) | 远程连接不是文件夹；官方行只提供基础视觉 |
| 会话菜单/悬浮按钮 | [`session-row-parts.tsx`](../src/client/session-row-parts.tsx) | 官方 action 组件依赖官方 slot owner；插件树不是官方 slot 的 occupant |
| pin/archive 存储 | [`session-verbs.ts`](../src/client/session-verbs.ts) + `store.ts` | 官方 `uiWorkspace.pinSession/archiveSession` 对远端 session 报 `not-found`（实测） |
| session rename | [`store.ts`](../src/client/store.ts) + `/api/session-rename` | 需要把 rename 追加到远端会话日志（`persist.rename`） |
| 远端 resume/open | [`store.ts`](../src/client/store.ts) + `/api/open-session` | 官方 open 只认本地 session 索引；远端会话要先经 routing persistence resume |
| 工作区 rename/delete | [`store.ts`](../src/client/store.ts)、[`store.ts`](../src/client/store.ts) + `/api/workspace-rename`、`/api/workspace-delete` | 远端 workspace 由远端 server registry 权威；官方 `workspaces.rename/delete` 只改本地 registry |
| 添加/浏览远端工作区 | [`directory-picker.tsx`](../src/client/directory-picker.tsx) | 官方目录选择器只认本地路径 |
| 官方 stub 工作区绑定 | [`provision/service.ts`](../src/provision/service.ts) | 官方草稿页要求 session 绑定官方 workspace id 和本地 realpath；插件注册隐藏 stub 行 |
| 每个 target 的远程执行世界 | [`preset/world.ts`](../src/preset/world.ts) | agent preset 是 DSH 的执行世界 seam；插件用 isolate realm 替换 fs/subprocess/sandbox/shell |
| 远程草稿的固定执行世界 chip | [`remote-preset-seat.tsx`](../src/client/remote-preset-seat.tsx) + [`remote-draft.ts`](../src/client/remote-draft.ts) | 远程草稿不能选其它连接/本地模式；动态 shadow 官方 hero picker，草稿结束即恢复 |
| 远程 session 的 preset 守卫 | [`remote-stub.ts`](../src/remote-stub.ts) | `session/created` 同步拒绝 stub cwd + 非目标 preset，以及本地 cwd + remote preset；stub 根跟随 `DSH_HOME` |
| 连接、探测、部署、host key、WSL | `src/provision/**`、`src/ssh/**`、`src/targets/**` | 官方没有远程 SSH/WSL 目标管理 |

---

## 2. Vendored UI 清单

目录：[`src/client/vendor/workspace-rows`](../src/client/vendor/workspace-rows)

| 文件 | 来源 | 说明 |
|---|---|---|
| `generated/Rows.tsx` | `.../rows/Rows.tsx` | `ProjectRowItem`、`SessionNodeItem`（以及未使用的 `SearchResultItem`） |
| `generated/AnimatedRows.tsx` | `.../rows/AnimatedRows.tsx` | 已生成并导出，当前未使用 |
| `generated/classnames.ts` | 两个 CSS module | CSS module 类名 → 带前缀的 class map |
| `generated/row-styles.ts` | 两个 CSS module | 注入到插件 `<style>` 的 CSS 文本 |
| `generated/locales.ts` | `.../client/locales.ts` | `workspace` namespace 字典 |
| `home-path.ts` | 本地 shim | `abbreviateHomePath` 的本地副本 |
| `models.ts` | 本地 shim | 官方 shell 内部类型的极简类型定义 |
| `render-slot.tsx` | 本地 shim | 把 vendored 行的 slot 请求接到插件的菜单/actions |
| `translate.ts` | 本地 shim | 把 `workspace` 字典接到插件的 `t` |
| `NOTICE.md` | 生成 | 来源与再生成说明 |

`ROW_STYLES` 在 [`styles.ts`](../src/client/styles.ts) 中拼进插件唯一的 `<style>` 元素，
因此行样式与插件自己的 section 样式共用一个样式表。

---

## 3. 对 vendored UI 改了什么

### 3.1 `Rows.tsx`

与 `0.2.0-rc.1` 对照，diff 约 18 行，全部是生成/接线，不含组件逻辑改动：

- 增加生成头（来源、禁止手改、重跑脚本说明）；
- 增加 `// @ts-nocheck`，保持上游文件体逐字复制，同时让插件的调用点继续受类型检查；
- `ShortcutCatalogEntry` 的 import 从官方 shell 内部路径改为本地 `../models.ts`；
- `WorkspaceBrowserProps` 改为本地 `RowsProps`，`RowTranslate` 类型改为 `RowsTranslate`；
- `GroupNode` / `SearchResultNode` / `SessionNode` 的 import 改为本地 `../models.ts`；
- `abbreviateHomePath` 从 `@deepseek-ai/dsh-util-workspace-path` 改为本地 `../home-path.ts`；
- CSS module import 改为生成后的 `./classnames.ts`。

没有改行高、hover、菜单壳、marquee、选中态等视觉逻辑。

### 3.2 `AnimatedRows.tsx`

diff 约 8 行，同样只有生成头、`// @ts-nocheck` 和 CSS module 替换；没有逻辑改动。当前未使用。

### 3.3 CSS

- `Rows.module.css` / `AnimatedRows.module.css` 的每个 class 加前缀：
  - `dsh-rwv-rows-*`
  - `dsh-rwv-anim-*`
- 目的：避免和 shell 自己加载的同一 CSS module 冲突；
- CSS 内的反引号和 `${` 在生成模板字符串时转义；
- 没有改官方选择器、尺寸或颜色。

### 3.4 `locales.ts`

- 整份 `workspace` namespace 字典复制；
- 删除 shell 内部 `WorkspaceKey` 联合类型；
- 将 `satisfies Record<WorkspaceKey, string>` 放宽为 `satisfies Record<string, string>`；
- 目的：让行组件在插件 bundle 中使用同一套文案，避免文案漂移。

### 3.5 本地 shim（不是官方代码）

- `models.ts`：只声明 vendored 行需要的 `GroupNode` / `SessionNode` / `SearchResultNode` /
  `RowsProps` / `RowsTranslate` / `MenuOpenState` / `ShortcutCatalogEntry` 形状；
- `render-slot.tsx`：实现 `renderSlot` 的三个 key：
  - `sidebar.workspaces.session.menu.item` → 插件菜单；
  - `sidebar.workspaces.session.row.action` → 插件悬浮按钮；
  - `sidebar.session.row.leading` → 当前为 `null`；
- `translate.ts`：把 `rowsTranslate` 绑定到插件自己的 locale；
- `home-path.ts`：本地 `abbreviateHomePath`，避免 import 官方纯模块。

### 3.6 插件对行的外部覆盖（不在 vendored 文件里）

这些改在 [`styles.ts`](../src/client/styles.ts) / [`tree.tsx`](../src/client/tree.tsx)，
不是对 vendored 源码的修改：

- 连接行把官方文件夹 SVG 隐藏，用 CSS mask 画 globe；
- 断开状态只显示「连接」按钮，并用 plug mask 替换加号；
- 连接状态颜色（ready/failed/stopped/unknown）；
- 连接中 spinner / 失败 warning；
- `TreeRow` 给行包一层 `role="button"`、`tabIndex=0`、Enter/Space 转发；
- 三层树不增加缩进；
- section 的 host 高度、滚动、折叠时 `visibility: hidden`；
- 官方 stub 行隐藏规则（只作用于 `[data-slot="sidebar.workspaces"]`）。

---

## 4. UI 复用矩阵

| 功能/区域 | 官方 UI | 当前实现 | 结论 |
|---|---|---|---|
| 连接行/工作区行 | `ProjectRowItem` | vendored + globe/plug/status 覆盖 | **复用**，少量外部覆盖 |
| 会话行/草稿行 | `SessionNodeItem` | vendored + 自定义菜单/按钮插槽 | **复用**，action 自写 |
| 远程草稿的 agent preset 选择 | 官方 `conversation.hero.agentPreset` | 远程草稿时用只读 chip shadow；本地草稿保留官方 picker | **条件复用**：本地复用，远程固定 |
| 左侧 section 头、刷新、加号 | `WorkspaceBrowser` 自带 | [`sidebar.tsx`](../src/client/sidebar.tsx) | 自写 |
| 三层树容器 | 官方两级 `WorkspaceBrowser` | [`tree.tsx`](../src/client/tree.tsx) | 自写 |
| 搜索 | 官方 WorkspaceBrowser | 无 | **未实现** |
| 工作区/会话拖拽排序 | 官方 WorkspaceBrowser | 无 | **未实现** |
| 归档过滤/显示归档 | 官方 WorkspaceBrowser | 无（只做灰色+排序） | **未实现** |
| 会话数量折叠 | 官方 WorkspaceBrowser | 无 | **未实现** |
| 会话菜单/悬浮按钮 | 官方 `PinSession` 等 action 组件 | [`session-row-parts.tsx`](../src/client/session-row-parts.tsx) | 自写 UI，行为部分复用 |
| 重命名/删除/确认对话框 | 官方 slot dialog | 插件自己的 dialog | 自写 |
| 添加工作区/目录浏览 | 官方本地选择器 | 插件远端目录浏览 | 自写 |
| 主面板 | 官方 `main` slot 的通用面板能力 | 插件自己的 panel/list/wizard | 自写 |
| toast/notice | 官方 row toast | 插件 `NoticeToastHost` | 自写 |

---

## 5. 功能复用矩阵

| 动作 | 官方 service/API | 当前实现 | 复用程度 |
|---|---|---|---|
| 新建会话/草稿页 | `uiWorkspace.startSession` + 官方 draft | 插件 `enterDraft` → `prepareWorkspace` → 官方 `startSession` | **高**：草稿页和 session 创建复用官方 |
| 远程草稿的 preset 选择 | 官方 hero picker + `agentPresets` | 固定 chip；`session/created` 的 `assertRemoteSessionPreset` 拒绝错误 preset（含本地 cwd + remote preset） | **自建安全层**：PTC/标准远程仍不支持 |
| 打开会话 | `uiWorkspace.openSession` | `/api/open-session` 远端 resume → 官方 `openSession` reveal | **中**：显示复用，resume 自建 |
| 分叉会话 | `uiWorkspace.forkSession` | 直接调用官方，刷新插件列表 | **高** |
| 重命名会话 | `uiWorkspace.renameSession` | `/api/session-rename` → 远端 `persist.rename` | **低/待评估**：可尝试接回官方 service |
| 置顶/取消置顶 | `uiWorkspace.pinSession` / `unpinSession` | `/api/session-flag` + 插件自己的 `pinnedSessions` | **自建**：官方 service 对远端 session 报 `not-found` |
| 归档/取消归档 | `uiWorkspace.archiveSession` / `unarchiveSession` | `/api/session-flag` + 插件自己的 `archivedSessions` | **自建**：还缺官方停止确认/归档过滤 |
| 删除会话 | 官方无此动作 | 无 | **无** |
| 重命名工作区 | `workspaces.rename`（只改本地 registry） | `/api/workspace-rename` → 远端 `reg.rename` | **自建**：远端权威 |
| 删除工作区 | `workspaces.delete`（只改本地 registry） | `/api/workspace-delete` → 远端 `reg.delete` | **自建**：远端权威 |
| 添加/浏览工作区 | 官方本地目录选择器 | 插件远端目录浏览 | **自建** |
| 会话持久化 | 官方 `session-persistence-jsonl` | 官方 JSONL + 插件 routing persistence | **高** |
| 连接/探测/部署/host key | 无官方对应 | `src/provision/**`、`src/ssh/**` | **自建** |

---

## 6. 为什么没有复用 `WorkspaceBrowser`

官方 `WorkspaceBrowser` 不是可复用组件，而是 ui-workspace 的整个 section owner：

- 它自己持有 section header、搜索、分组/扁平列表、拖拽、归档过滤、session 数量、对话框和
  action slot；
- 它的树是 **工作区 → 会话** 两级，而远程需要 **连接 → 工作区 → 会话** 三级；
- 它注册了 `sidebar.workspaces.session.menu.item` / `row.action` 的官方 action entries，
  这些 entries 只在官方 browser 的渲染上下文里有意义；插件自己的 tree 不是那个 slot owner。

所以插件只 vendor 了纯展示的行组件；容器、交互和 action 仍是插件自己的实现。

---

## 7. 官方升级后必须复核的点

按风险从高到低：

1. **vendored 行**：`Rows.tsx`、`AnimatedRows.tsx`、两个 CSS module、`workspace` locale。
2. **官方 `uiWorkspace` 客户端 service**：
   - `startSession(workspaceId, { agentPreset })`
   - `openSession(sessionId)`
   - `pinSession` / `unpinSession`
   - `archiveSession` / `unarchiveSession`
   - `forkSession`
   - `renameSession`（如果之后接回）
3. **官方 workspace controller**：`workspaces.rename/delete` 的语义（目前只改本地 registry）。
4. **官方 session action slot**：
   - `sidebar.workspaces.session.menu.item` 的 order/label；
   - `sidebar.workspaces.session.row.action` 的 order/label；
   - `PinSession` / `ArchiveSession` / `RenameSession` / `ForkSession` 的确认流程和图标。
5. **官方 draft / agent preset**：
   - `startSession` 是否仍复用 blank session；
   - `conversation.hero.agentPreset` 的 owner props、single-slot priority 语义；
   - `ui-agent-preset` 的 roster/selection 逻辑（远程 preset 仍全局注册，靠固定 chip + host guard 收口）。
6. **官方 workspace registry**：stub 行的创建、隐藏、删除，`realpath(cwd) === workspace.path` 校验。
7. **官方 `ui-conversation` / `ui-workspace` slot 声明**：section 挂载和行 slot 的 key/owner props。

---

## 8. 维护流程

每次升级 DSH：

1. 记录新版本/commit。
2. 重跑：
   ```bash
   node scripts/vendor-workspace-rows.mjs --dsh <dsh 源码 checkout>
   ```
3. 检查生成 diff：
   - 应该只有生成头、import/类型改写、CSS class 前缀；
   - 出现逻辑行变化时，逐行核对官方 `Rows.tsx` / `AnimatedRows.tsx`。
4. 对照官方 `ui-workspace`：
   - `WorkspaceBrowser.tsx` 的搜索/拖拽/过滤/对话框；
   - `session-actions/*` 的 order/label/确认流程；
   - `contract/slots.ts` 的 slot key/owner props。
5. 对照 `ui-agent-preset` 的 hero seat 和 roster。
6. 更新本文档的矩阵、最后核对版本、已知缺口。
7. 跑 `pnpm typecheck`、相关 vitest、`pnpm build`。
8. 实机跑远程工作区验收：新建/打开/重命名/pin/archive/fork。

当前生成脚本没有 `--check` 模式，diff 需要人工看；后续可加一个 CI 检查，比较生成结果与仓库文件，
不一致就提示升级后必须重跑。

---

## 9. 已知缺口 / 后续

- **PTC/标准模式的远程 parity**：`src/connection/index.ts:101` 明确 `ptcLaunch` 不支持；
  remote preset 也是独立执行世界，不是 standard/PTC 的远程版本。需要独立 server/protocol 方案。
- **模式选择器已收敛**：远程草稿期间官方 hero picker 被固定 chip 覆盖，不能选其它 target 或本地模式；
  host guard 拒绝 stub cwd + 非目标 preset。PTC 仍不可用，tooltip 已说明。
- **本地 picker 仍会列出 Remote preset**：`agentPresets` 是全局 roster，本地草稿的官方 picker 会显示已连接
  target 的 remote preset；host guard 会拒绝 local cwd + remote preset，但 UI 选项仍在。彻底隐藏需要自定义
  本地 picker，本次未做。
- **pin/archive/rename 能否接回官方 service**：需要真实实验；可用则删掉插件自己的 sets/route，
  不可用则保留并按官方语义补齐（归档停止确认、归档过滤、撤销 toast）。
- **搜索/拖拽/归档过滤/运行状态点**：官方 WorkspaceBrowser 有，远程 tree 没有；按优先级补。
- **完全独立于官方 workspace**：当前选择复用官方草稿页，所以必须保留隐藏 stub 行；
  若要内部也完全不碰官方 registry，需要自建远程草稿页/会话创建，属于另一项大工程。

---

## 10. 验收清单

- [ ] 每个复用/自实现项都能在本文档找到源码路径和结论。
- [ ] 对 vendored 文件的改动只包含生成头、import/类型/CSS 接线，没有行为改动。
- [ ] 对官方 service 的调用集中在 adapter/已知位置，没有新的散落 `ctx.get('uiWorkspace')`。
- [ ] 官方升级后本文档的“最后核对”已更新。
- [ ] 文档不含真实主机、用户名、凭据或本机绝对路径。
- [ ] `pnpm typecheck`、相关测试、`pnpm build` 通过。

---

## 11. 验证记录

### 2026-10-22：远程草稿实测

环境：独立 `DSH_HOME` 的干净 web profile；临时 `127.0.0.1` SSH 夹具（userland `ssh2` server，临时
host/client key、临时 HOME/DSH_HOME，只监听 loopback；未复制真实凭据、未连真实主机）。远程 package 使用
本机缓存的 `0.2.1-rc.2-darwin-arm64` server 包。

流程与观察：

1. SSH 连接 → 主机指纹确认 → 扫描 `darwin-arm64` → 上传 server 包 → 启动远端 profile。
2. 在远端 `project` 目录建立远程工作区，点击「新会话」进入官方草稿页。
3. 草稿页显示：
   - workspace chip：`project · fixture`
   - mode seat：只读 `远程执行 · fixture`，DOM 是 `span`，没有 chevron/menu，没有官方 preset 按钮。
4. 远程会话日志落在夹具的 `DSH_HOME/remote-server-sessions/...`；本地 stub 落在测试实例的
   `DSH_HOME/remote-workspaces/<targetId>/...`，没有写入真实 `~/.dsh`。
5. 本地工作区的官方 picker 仍显示标准/PTC/极简/创造；**仍会显示已连接 target 的 `Remote: fixture`**。
   host guard 已拒绝「本地 cwd + remote preset」，但 UI 选项未隐藏——这是 §9 的已知缺口。
6. 最终：`pnpm typecheck` 通过；相关测试 31 个通过；全量 `pnpm test` 389 通过、4 个既有
   `workspace-refs` macOS realpath 失败；`pnpm build` 通过。
7. 调试实例、SSH 夹具、临时目录和 `/private/tmp/.pnpm-store` 已清理。


---

## 12. v1 重构后的复用边界（2026-10-22）

> 本节是当前维护口径，优先于 §1–§11。旧架构的“client 跑 agent + 远端 execution world”已被
> v1 的 server/local 双执行端取代；旧的 remote workspace refs/stub/preset 行不再进入 client bundle。

### 12.1 UI 复用矩阵（v1 历史，v2 见 §13）

> v2 已用 `session-main.tsx` 的 native server 主区替换 iframe；本节保留 v1 复用记录，供回退/对照。

| 区域/组件 | v1 实现 | 结论 |
|---|---|---|
| 连接行 / server 工作区行 | vendored `ProjectRowItem`（0.2.1-rc.2） | **复用官方行**；连接行外部叠加 globe/plug/状态样式与 a11y wrapper |
| server 会话行 / 临时「新会话」行 | vendored `SessionNodeItem` | **复用官方行**；菜单/悬浮按钮仍由插件注入（官方行 slot 不是官方 browser 的 occupant） |
| 行拖拽 | vendor 行的 `drag` props + 插件外层 drop 区 | **复用官方 drag 接口**；workspace 拖拽命中由 group wrapper 承担（与官方 browser 相同模式） |
| server 模式主区 | `src/client/portal-main.tsx` 的同源 iframe（`portal/<targetId>/?dshRwSession=…`） | **嵌入 server 官方 UI**；不重画对话/输入/审批/流式 |
| local 模式主区 | client 官方 conversation/draft（由 dev-session 桥接 server 会话） | **复用官方 UI**；仅当 local runtime 接线完成后启用 |
| 搜索 | 插件本地过滤（`remote-data.ts::searchRemoteGroups`） | 自实现；不落盘、不发 P1 |
| 排序/拖拽持久化 | P3 `workspace/reorder` / `session/reorder` → 官方 registry | 官方权威；插件只渲染 |
| toolbar 区域头/刷新/新建连接 | `sidebar.tsx` + `ConnectDialog` | 自实现（官方 `WorkspaceBrowser` 仍不可复用） |
| 对话框 | `remote-dialogs.tsx`（Modal + 相同 primitives） | 自实现；add/remove/rename/archive-stop/mode/restart |
| 官方草稿页 | server 模式：server 官方 UI 内部草稿；local 模式：client 官方 draft/composer | 条件复用；server 模式不再用客户端 stub/草稿 |
| 官方 `WorkspaceBrowser` 整层 | 未复用 | section header/search/drag/filter/dialog 仍是官方 browser 的私有 owner，且树是两级；远程树是三级 |
| 官方 session action 组件 | 未 vendor | `SessionMenu`/`SessionActions` 自写，行为走 P3 |
| 官方 agent preset hero seat | 旧 remote-preset chip 已从 M1 activation 移除 | local 模式恢复时由 dev-session 定义执行世界/选择语义 |

### 12.2 vendored 行（0.2.1-rc.2）改动清单

| 文件 | v1 变化 |
|---|---|
| `generated/Rows.tsx` | 相对 0.2.0：`Tooltip ... portal` ×2、`HoverCard ... grouped` ×2；其余为生成头/import/CSS 接线，无逻辑改动 |
| `generated/row-styles.ts` | `.rowActions gap: 10px → 15px` + 注释；其余无变化 |
| `generated/locales.ts` | 新增 `draft.workspaceRequired`、`draft.initializationFailed`、`menu.sessionId`、`toast.sessionIdCopied/copyFailed`、`toast.forkRequiresOpen/openForkSource` |
| `generated/AnimatedRows.tsx`、`classnames.ts` | 与 0.2.0 一致 |
| `NOTICE.md` | provenance 为 `dsh-v0.2.1-rc.2 (commit 687f282e86)`，不写本机路径 |

重跑命令（脚本已支持 `--source-label`，缺省从 checkout 的 git facts 自动取 tag/commit）：

```bash
node scripts/vendor-workspace-rows.mjs --dsh <0.2.1-rc.2 checkout> \
  --source-label 'dsh-v0.2.1-rc.2 (687f282e86)'
```

### 12.3 官方功能复用矩阵（v1）

| 功能 | 官方入口 | v1 用法 |
|---|---|---|
| workspace list/title/order | server `ctx.workspaceRegistry` | P1 `workspace/list`；P3 树直接渲染 |
| workspace create/rename/delete/reorder | Registry/entity 方法 | P3 `workspace/create|rename|delete|reorder` → 官方 |
| session list/title/blank/running | `ctx.sessionController` + JSONL title fold | P1 `session/list`；插件 fold `session/title` 保证标题 |
| new session/draft | server `sessionController.create`（blank） | server：P1 `session/create(blank)` → `prepare-server` → iframe `dshRwSession` 深链；local：host create/resume → catalog → 官方 `openSession` |
| open session | server 官方 UI；local `uiWorkspace.openSession` | server：iframe 深链；local：按 §16.10 顺序 reveal |
| rename/fork/pin/archive/reorder | session-controller/registry | P3 → P1 官方方法；pin/archive/order 不再有插件本地 sets |
| 搜索 | 无官方远程搜索 | 本地瞬时过滤 |
| 删除会话 | 官方无此动作 | **不实现**（与官方一致） |
| 执行端切换 | 无官方对应 | P3 `mode/preview|apply`（D20）+ host executor 状态；local gate 由 host runtime 决定 |
| 主区 iframe | server 官方 web UI | portal 代理 + embed storage shim/CSS/postMessage；client 不解析/重画 |

### 12.4 自实现清单（v1，维护重点）

- `src/client/remote-api.ts`：P3 HTTP/SSE adapter（含 raw/wrapped 容器兼容、错误 details、mode/restart）。
- `src/client/remote-store.ts`：v1 远程段状态机（state/sessions 懒加载、selection、D20 mode、restart/stale、local reveal、gate）。
- `src/client/remote-data.ts`：server 顺序/成员序/pin/archive、搜索、drag before 语义。
- `src/client/executor.ts`：D20 纯状态机 + 错误/active turn/targetSessionId + mode 事件解析。
- `src/client/portal-url.ts`：portal URL/embed 参数、postMessage/storage key 校验、frame 状态机。
- `src/client/portal-main.tsx`：同源 iframe 容器、storage 选中同步、错误/重试、独立 main key。
- `src/client/tree.tsx` / `sidebar.tsx` / `remote-dialogs.tsx`：三级树、官方行、唯一 dialog host、动作 UI。
- `src/client/panel.tsx`：v1 连接概览页（旧 wizard/list 不再注册）。
- `src/client/api.ts`：旧连接/目录 API 仍保留部分给过渡；v1 远程段不再使用旧远程 workspace/session 路由。

### 12.5 v1 主区 / iframe 验收要点

1. iframe `src = portal/<targetId>/?dshRwSession=<id>&dshRwTheme&dshRwLang&dshRwParent`；同源。
2. parent → iframe 只用 `{v:1,type:'dsh-rw/open-session'|'dsh-rw/theme'|'dsh-rw/reload'}`，校验 origin/source。
3. iframe → parent：`dsh-rw/ready` + 同源 `storage` 事件，key 必须恰好 `<storagePrefix>dsh.sessions.current`（单前缀），value `{sessionId}`。
4. 官方 sidebar/rightbar 由 embed CSS 隐藏；client sidebar 唯一导航，无双滚动/双导航。
5. 断开/删除/模式切换移除 iframe；local 模式 selection 清理用 guarded `clearMain` → `selectPanel(null)` fallback，只清属于本 target 的 selection。
6. local gate 未开时 mode 按钮 disabled，不写 `target.executor`；server 模式 iframe/树不受影响。

### 12.6 已知缺口 / 后续（v1）

- **local 模式**：`LOCAL_MODE_READY=true`；host `mode/apply`（含 managed/unmanaged restart 分支）与 `/api/session/open` 已接，client 官方对话 UI 复用；server 日志经 dev-session 桥。剩余阻塞是 dev-core/dev-server 的 mux 工具执行（`process.done`/spawn），UI 已显示官方错误。
- **目录浏览**：P1 `fs/list` 已在 server M2c 落地（`{home,path,parent,entries[]}`，无 size/mtime）；client `remote-api` 归一化为 `ListDirResult`（补 `entry.path`）供 add-workspace 对话框使用，手动输入 server 绝对路径仍保留为兜底。
- **安装/升级确认**：M3 已接 host `deployment/preview|apply`。独立 runtime 与专用 profile 插件由 host 自动处理；全局 runtime / 非专用 profile 插件在连接下显示显式确认按钮（`confirm:true` 仅由按钮发出）。host v1 仍拒绝修改共享全局 runtime/其他 profile（`runtime-global-unsupported`/`plugin-profile-not-managed`），UI 原样显示可操作错误，不静默写。
- **刷新 UX**：远程段头部/树底部「刷新」现在是 `state/refresh` → 发现 `registry.stale` 自动接着 `registry/refresh` 再重读（registry refresh 不取消 turn）；stale banner 仍保留手动入口。协议 §16.3 的“轻量 state/refresh”仍是底层语义，UI 把两步串成一次用户动作。
- **删除会话**：官方无能力，不做。
- **embed 每次切会话 reload**：v1 接受；v1.1 可用 server client half 免 reload。
- **旧文件**：`wizard.tsx`、`list.tsx`（已删）、`directory-picker.tsx`（已删）、旧 `store.ts` 等不再进入 v1 bundle；`panel.tsx` 已重写为 v1 概览，但当前 activation 未注册（sidebar 是唯一入口）。M2g 后会话行有 `executor` 字段，打开已有会话按行路由；旧 server 无字段时回退 connection mode。
- **升级复核**：DSH 0.2.1-rc.3 的 DOM slot/CSS/官方 service 签名变化时，重跑 vendor 脚本、核对 §13 的 native 主区边界（以及 §12 的历史 embed 边界），并重跑 P1/UI 冒烟测试。


## 13. v2 native server 主区：官方组件复用边界（task-14）

v2 server 模式不再使用 iframe/portal。目标是用官方组件拼装，只写薄适配器。

**已实测可复用并已使用**

| 官方组件/模块 | 用途 | 入口 |
|---|---|---|
| `MarkdownText` | user/assistant/reasoning 正文（含流式渲染） | `@deepseek-ai/dsh-client-ui-primitives` |
| `TerminalBlock` | bash/shell 工具结果（命令、ANSI 输出、running/exit code） | 同上 |
| `ReadBlock` | read 工具结果（行号、语法高亮、窗口摘要） | 同上 |
| `SearchBlock` | grep/glob/search 结果（matches/paths 两种 shape） | 同上 |
| `DiffBlock` | edit/write/patch 结果（统一 diff 或 old/new 文本） | 同上 |
| `CodeBlock` | 未知/纯代码工具结果、tool arguments 字符串 | 同上 |
| `JsonBlock` | 结构化 tool arguments / JSON 结果 | 同上 |
| `Button`/`Tooltip`/`StateDot`/icons | header、composer、状态、折叠控件 | 同上 |
| `ProjectRowItem`/`SessionNodeItem` | 远程树行（未改动） | vendor 0.2.1 |

**官方组件缺口（因此保留了最小自绘壳）**

- `@deepseek-ai/dsh-client-ui-conversation` 的 `/client` 入口只导出 `apply`、`UiConversation`、
  registries/contracts/types；`ConversationRoot` / `ConversationContent` / `ConversationSession` /
  `InputBar` 等 skeleton 组件**不在包导出**，且依赖 local session controller、ui-session、
  conversation service 与 input slots。
- `@deepseek-ai/dsh-client-ui-chat` 只导出 `apply`、chat 类型与 `isRunningTool` 等 helper；
  `ChatView` / `MessageItem` / tool nodes / `ApprovalCommand` / `ReasoningRow` 均在包内部，
  依赖 chat store、approval service、local transcript，不能拿 server timeline props 直接渲染。
- 因此 v2 `session-main.tsx` 自绘：header、滚动/自动滚底、错误/重连条、时间线壳、approval 壳、
  composer 壳；数据/SSE 由 remote-store 薄适配器接入 `session-timeline.ts` 的纯合并函数。
- 若后续官方包导出 shell/composer，或 task-15 把 server 会话映射进 local conversation controller
  的 slot 渲染链路，应替换这些壳；当前不复制官方组件源码、无 iframe/DOM/portal 依赖。

**数据形状**

- 官方 `RwTimelineEntry`（`src/protocol.ts`）：`entryId/seq/time/kind`；tool-result 用
  `text/isError/truncated`，approval 用 `state:'asked'|'decided'` + `outcome`；`unknown` 保留 `type`。
- `session-timeline.ts::adaptServerTimelineEntry/Page` 做官方行 → UI 行的唯一映射；
  `upsertTimelineEntry` 按 clientId echo → id → seq 去重，`prependTimelinePage` 处理 beforeSeq
  分页，`timelineAfterSeq` 供 SSE 重连；optimistic user 行由 `appendOptimisticUser` 创建。
