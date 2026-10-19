# AGENTS.md — dsh-remote-workspace

**开发约束，只写给改这个仓库的人（和 agent）。** 用户文档在 [`README.md`](README.md)：安装、
界面操作、排障、兼容性属于那里；开发规则、内部契约、实测陷阱只属于本文件。两边不要互相搬运。

本仓库是 Remote Session 架构的 client 半边：会话权威存储在远端，本机只保留 agent loop、
模型请求、凭据与 UI。

## 身份与推送

- 仓库：<https://github.com/graydovee/dsh-remote-workspace>；server 半边：
  <https://github.com/graydovee/dsh-remote-workspace-server>。
- commit 身份用仓库**局部** git config：`graydovee / graydovee@foxmail.com`。
- 本机 keychain 默认凭据是另一个账号，直接 `git push` 会 403，用：

  ```bash
  git push "https://x-access-token:$(gh auth token --user graydovee)@github.com/graydovee/dsh-remote-workspace.git" main
  ```

## 命令

```bash
pnpm install
pnpm typecheck    # tsc --noEmit（无 lint）
pnpm test         # vitest run；macOS 上 tests/workspace-refs.test.ts 有 4 条既有红
                  # （tmpdir 的 /var 与 realpath 的 /private/var 不一致，与代码无关）
pnpm build        # tsdown → lib/（host / server / client 三个 target）
node scripts/vendor-workspace-rows.mjs --dsh <dsh 源码 checkout>   # 重新内置官方行层
DSH_SMOKE_CLI=<dsh 启动器> npx vitest run tests/profile.smoke.test.ts
node scripts/build-server-package.mjs --all --dsh-version <ver>    # 预打包 server 发行物
```

Node ≥ 22.19（或 ≥ 24），只用 pnpm。`lib/` 是入库的构建产物，不要手改。

## 同步契约（与 server 仓库，最重要）

`src/protocol.ts`、`src/server/**`、`src/frame/**`、`src/provision/package-build.ts` 与
`../dsh-remote-workspace-server` 里的同名文件**逐字节相同**。改任何一处必须两边同一次提交/
发布一起改，并用 `cmp` 复核。原因：本仓库的 provisioner 部署的是**自己构建的**
`lib/server.js`，conformance 测试也在内存里跑这份副本；server 仓库是这段代码的正式归宿与
发行包来源。

协议版本 3（`REMOTE_SESSION_PROTOCOL = 3`；官方执行世界 RPC 仍是 v1）。方法集：
`server.hello`、`reg.list|create|rename|delete`、
`persist.list|titles|rename|create|open|append|flush|close|locate`。

## 架构与文件地图

tsdown 三个 target（`tsdown.config.mjs`）：

1. **host**（ESM/node）：`index`（插件主行）、`connection`（preset realm 内的 `ctx.ssh`）、
   `rsession`（`RemotePersistence`）、`session-persistence`（路由层）、`protocol`。
2. **server**（`src/server/index.ts`）：远端执行世界 bundle，**自包含**——只 external
   `@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery`；DSH 运行时只解析裸包名，所以
   `@deepseek-ai/dsh-ssh/protocol|/schemas` 与 zod 全部内联。
3. **client**（浏览器 CJS 工厂，经 `window.__ModuleLoader__.load` 注册）：只允许平台模块表
   external；**纯度门禁**会让 Node 内置物或跨插件值导入直接构建失败——跨插件协作走 cordis
   服务。CSS 注入单个 `<style data-plugin="dsh-remote-workspace">`。

```
src/provision/       profile 生成 + 部署（安装根 ~/.dsh/server，一律 /bin/sh -c + 绝对路径）
src/provision/transport.ts  RemoteTransport 抽象：ssh 与 WSL 各一份，部署流水线不 import ssh2
src/session-persistence/routing.ts  按会话 cwd 路由的 sessionPersistence
src/rsession/        persist.* 平面的 SessionPersistence
src/preset/world.ts  每目标 isolate realm preset（ssh/fs/subprocess/sandbox/shell）
src/ssh/             connect.ts（ssh2 连接/host key/exec/上传）、wsl.ts、hostkey.ts、ssh-config.ts
src/targets/         目标/工作区记录、scrubSecrets、methods.ts（平台×连接方式的纯谓词）
src/client/          sidebar.tsx（区域挂载）、tree.tsx（三层走树）、store.ts（快照与动作）、
                     session-verbs.ts、dialogs、styles.ts、locales.ts、vendor/workspace-rows/
```

## 硬约束（违反即破坏行为）

- **凭据不过线**：SSH 凭据与模型 API key 只在本地；错误与日志一律过 `scrubSecrets`。
- **host key**：未知指纹必须显式确认（展示 SHA-256），已变更的 key 一律中止。
- **信任栅栏**：所有插件 HTTP 路由必须过 `trustedRequest`（DNS rebinding + 跨站）；JSON body
  上限 1 MiB；API 方法名允许含斜杠（`connect/start`），不要加斜杠守卫。
- **零 patch**：不改官方 `cordis.patch.yml` 的已有行、不替换全局服务；「添加工作区」按钮
  行为不变。左栏区域**不占用** `sidebar.workspaces` 槽位，只在槽位元素之前插入节点。
- **连接行必须惰性**：preset 挂载失败是粘滞且永久的，不可达主机不得在构造时发起连接。
- **存储域版本恒为 1**：新字段只能 additive optional（`pinnedSessions` /
  `archivedSessions` 即此例），bump 即砖（单文件布局无迁移）。
- **mux 宽容规则**：未知流的 `CREDIT/END/ABORT/OPEN_OK/OPEN_FAIL` 忽略（迟到消息），只有
  未知流的 `DATA` 是致命帧失步。
- **重装必 bump 版本**：插件批量 URL 带 `&rev=<hash>`，不 bump 浏览器吃旧缓存（见版本规则）。
- **行样式一行都不要自己写**：行是内置的官方组件，见下文。
- **对话框与 toast 挂在树上**（`RemoteTree`），不挂在面板上；否则侧栏按钮"什么也不发生"。
- **`engines.dsh` 与全部 `@deepseek-ai/dsh-*` peer 写精确值 `0.2.1-rc.2`**，不写区间：只有这一版
  实测过。DSH 准入只看 `engines.dsh`（存在时 peer 被忽略），peer 钉同一值以免清单读起来像
  "0.2.x 都行"。扩窗是发布动作：升 devDeps → 跑 typecheck/conformance/浏览器验收 → 同版本
  改两仓声明。`dsh-plugin-dev check --strict` 的 `manifest-peers` 失败是已记录偏差，不要靠
  升降区间去"修"。
- **`zod` 钉死成 harness 用的确切版本（当前 `4.4.3`），不写 `^`**：树里出现两份 zod 后
  `z.infer` 跨副本推导会让 `tsc` OOM。

编码规约：TS strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` +
`allowImportingTsExtensions`（相对导入带 `.ts`）；type-only 用 `import type`；可选 wire 字段
沿用 `...(x === undefined ? {} : { x })`；注释写**实测约束**（现象 + 结论），不写废话。

## 会话持久层（实测，改前必读）

`apply()` 里构造 `RoutingSessionPersistence` 并 provide 为 `sessionPersistence`，按会话 cwd
路由：本地 cwd 委托内嵌的官方 JSONL 后端（root 仍是 `~/.dsh/sessions`，本地行为逐字节不变），
远程 stub cwd 走远端 `persist.*`。

1. 官方行 id 是 `session-persistence-jsonl`（dsh-base 层），不是 `sessions`（后者在
   dsh-sdk-minimal，web profile 里不存在；覆盖它会打印 `entry "sessions" not found`）。
2. patch 覆盖不能换 `name`（loader 有 name-mismatch 守卫），所以"替换类"写成 `disabled: true`
   再在 `apply()` 里 provide；patch `insert` 一行实测从不被构造。
3. `inject` 里不能写 `workspaceRegistry`：`dsh-workspace` 消费 `sessionPersistence` 会互等，
   启动时 7 个 entry 永久 pending。一律 `ctx.get('workspaceRegistry')` 懒解析（无 inject 时
   属性访问会抛）。
4. 自建 `RemotePersistence extends SessionPersistence` 必须用吸收注册的 stub context 构造
   （`Reflect.construct`），否则二次 `provide('sessionPersistence')` 直接抛。
5. 官方 JSONL 后端在 0.2.1-rc.2 是 `apply(ctx, config)` 插件行，不是可 `new` 的类：用
   `ctx.isolate('sessionPersistence', LABEL)` 拿子 scope，`await applyJsonl(scope, {root})`，
   再 `scope.get('sessionPersistence')`；`localReady` 必须在每次本地委托前 await。**不要再往
   routing 里加 `tracker.install` 补丁**（那是 0.2.0-rc.x 的坑）。

**header cwd 永远重锚到本地 stub**：服务端会把 header cwd 改成远端路径，而官方 workspace
注册表要求 `realpath(header.cwd) === workspace.path`，session-controller 还会抛 `cwd conflict`。
`RemotePersistence` 在 `create`/`open`/`list` 三个出口重锚；远端路径只出现在 realm 的
stub→remote 别名处。

### 三条写路径与三个并发坑

routing 自己对 `session/event` / `session/flush` / `session/disposed` 装钩子：
`create`/`open` 时按 session id 注册 `RemoteLiveWriter`（缓冲 + 在官方持久化屏障上批量
`persist.append`），handle 用 `DrainedHandle` 包一层保证 close 前先 drain。

1. 同一 session 的并发 write open：官方只允许一个 writer，第二个 `persist.open` 会让两个
   调用者一起失败。routing 把活跃 writer 以 `borrow()` 借出（可 flush，`close()` 不释放）。
2. `withBrowser` 的 retry 会关掉共享 client：按 target 串行化（`browserQueue`）。
3. 同一 session 的并发 resume：按 session id 串行（`resumeQueue`）。

服务端 handle 表在内存里：重启（租约到期、显式停止、**每次 server bundle 更新后的自动重部署**）
会清空它。`RemoteHandle` 只对 `unknown remote session handle` 自愈一次（重新 `persist.open`
再重试），其它持久化错误不重试。

## 侧栏区域与行（实测）

- 行层是**内置的官方代码**（`src/client/vendor/workspace-rows/`，由
  `scripts/vendor-workspace-rows.mjs` 生成，`generated/*` 带 `@ts-nocheck`）。工作区行 =
  `ProjectRowItem`，会话行 = `SessionNodeItem`（`blank: true` 即「新会话」行）。
- **不缩进**：实测 shell 自己的树是平的（padding 8px、`--dsh-workspace-indent` 为 0），
  三级也全部 0px，别再发明 `INDENT_STEP`。
- 行菜单只有 `rename` / `delete.workspace` 两个固定 key，语义靠改这两个 key 的译文；会话行的
  自己的菜单项必须先调 `close()`（从 `hookContext` 取），否则留悬空菜单。
- 连接行不能把 `workspaceId` 传 `undefined`（vendored 组件当作"未分组"），用 `conn:<targetId>`。
- 三态在连接行**图标**上：`data-state` 决定地球颜色；未连接/失败时 `＋` 位画插头承担连接。
- 区域挂在 `[data-slot="sidebar.workspaces"]` 父元素第一位（portal，不是 slot）：该槽位
  `display: contents`、跨折叠保持 DOM 身份；折叠时用
  `[data-sidebar-collapsed="true"]` 把自己移出 a11y 与命中测试；锚点缺失就整段不挂载。
  高度链（host → `.dsh-rw-side` → `.dsh-rw-side-body`）每级都要 `min-height: 0`。
- 隐藏 shell 里对应的官方行：选择器**必须带** `[data-slot="sidebar.workspaces"]` 前缀（内置行
  用同样的 `data-row-key`），只改 `display`。
- 断开连接时 store 清掉该连接及其所有工作区的展开标记（`collapseTarget`），重连重新展开——
  两者是不同事件，别合并。
- 行内动词落点：置顶/归档 → 插件自己的 `pinnedSessions`/`archivedSessions`；重命名 →
  `POST /api/session-rename` → 服务端 `persist.rename`（**绝不为此打开会话**）；分叉 → shell
  的 `uiWorkspace.forkSession`；打开 → `POST /api/open-session` → `ctx.agents.resume`。
  会话已 live 时改名走 live 会话 + flush；文本先用 `normalizeSessionTitle`。
- 标题从远端日志读（`persist.titles`，log-only latest wins，`(id,sizeBytes)` 记忆化、并发 4）。

## 与 harness 的契约面（升级 DSH 必核，tsc 抓不到）

1. `hello` 形状：`{ protocol, hash, kind: 'executable'|'node-script', platform, nodeVersion,
   executable, root, workspace, bootstrapHash? }`，`$strict`，发旧形状直接抛。远端发
   `kind: 'node-script'` + `executable: process.execPath`。
2. `ctx.ssh` 只有 `ready`/`ptcLaunch`/`request`/`connectStream`/`dispose`；`ptcLaunch` 无消费方，
   但仍必须存在。
3. 客户端只依赖：DOM 锚点 `[data-slot="sidebar.workspaces"]`、`ctx.slots.register` /
   `layout.selectPanel`，以及行契约（`data-row-key`、`delete.workspace`/`actions.newSession`、
   `blank` 行、归档行 `aria-description`、`--dsh-workspace-indent`）。
4. 桌面安装树不含 SSH 包；`dsh plugin add` **只写依赖、不写 `dsh.profile.bundles`**，不加
   bundle 层会 `failed to import` + 官方行 pending。

## WSL 目标（仅 Windows，实测）

- 平台闸门两端都做：`src/targets/methods.ts::methodAvailable`；客户端不渲染卡片，host 侧
  `connect/start` 与 `wsl-distros` 在非 win32 返 400。
- `wsl -l -v` 等管理输出是 **UTF-16LE**，`wsl -d X -- cmd` 是 UTF-8；WSL 2.4.13 不支持
  `--format json`；发行版名可能含空格，按尾部 token 解析；`Installing` 行没有 VERSION 列。
- 探测不得启动发行版（只 `-l -v`），也不要为预填用户名跑 `whoami`。
- **多行脚本必须走 stdin**（`sh -s`）：`wsl.exe` 会重解析命令行，`-c` 传 7 行会丢行甚至被
  zsh 捡走。上传同理走 `cat > path`，不要用 base64 heredoc（会顶爆 `ARG_MAX`）。
- `packStage` 不能写死 `/usr/bin/tar`（Windows 宿主用 PATH 上的 `tar.exe`）。
- 每 target 只允许一个 server 进程：`persist.create` 是内存句柄，第二个进程会答
  `session "…" not found`。连带三条：`RemoteClient.close()` 只关自己的 peer（`mux.close()` 是
  传输层拆除）；`connectOnce` 缓存通道后立刻挂心跳客户端；浏览客户端按 target 缓存。
- Windows 上 stub 是 `C:\…`：「绝对路径」判定用 `isAbsolute`，不能 `startsWith('/')`；
  `publicTarget` 要带 `wslDistro`/`wslUser`。

### Windows 宿主交叉暂存（alpha47 实测）

`findHostPnpm` 要认 `pnpm.cjs`/`pnpm.mjs` 与 `node`/`node.exe`；launcher 探活用包清单里的 bin
JS（`.bin/dsh` 是 shell 包装）；NTFS 丢可执行位（`test -e` + `chmod +x`，判据是 `--version`
输出）；`packageFiles` 的 path 是**远端** POSIX 路径（`lib\server.js` 会写成 `libserver.js`）；
flock 的 `@deepseek-ai/node-addon-system-*` 没有 win32 构建，`fixNativeClosure` 按 family 补装
（`node-addon-require-builtin-<platform>-<arch>[-<libc>]`、`@deepseek-ai/node-addon-system-<platform>-<arch>`，
后者没有 libc）。

### 远端沙箱

`dsh-sandbox-ssh` 只转发，`confine()` 在远端执行。没有可用 backend（如 WSL 无
bubblewrap/Landlock）时**原样执行 argv** 并返回官方 facts 对象
`{ argv, enforcement: 'partial', denialSignatures: [], runnerFailureRules: [] }`——不能用裸
数组（官方 strict schema 会拒），也不能用 `z.unknown()` 验证。

## server 包下载与发布

- 发布在 **server 仓库**：`.github/workflows/server-release.yml`，tag `server-v<dsh 版本>`，
  矩阵 `linux-x64-gnu / linux-arm64-gnu / darwin-x64 / darwin-arm64`；插件 tag 不带 server 包。
- 下载（`src/provision/assets.ts`，`RELEASE_REPO = 'dsh-remote-workspace-server'`）：候选 tag
  `server-v<dshVersion>` → `v<pluginVersion>`；每个 tag 先试 release 直链，再试
  `api.github.com` REST（实测本机直链不可达而 API 可用）；`.sha256` 与成功的那次传输同源。
- 验证口径：把 `~/.dsh/remote-assets/<artifact>.*` 挪走 → 远程下载 → 进度出现
  `server package downloaded from release` → `deployment` → `ready`；`.ready` 内容逐字符等于
  release 的 `.sha256`。

## 版本与发布规则

- **仓库里的版本 = 发布版本，当前 `v0.1.0-alpha1`。** 提交进仓库的 `package.json`、
  `src/server/index.ts` 版本串、`lib/` 都带这个号。
- **本地调试部署不改发布版本，只加修订后缀**：`0.1.0-alpha1.1`、`0.1.0-alpha1.2`……只在执行
  部署的机器上加；`/api/state` 的 `pluginVersion` 与远端 `server.hello.version` 报的就是它。
  必须在 `pnpm build` **之前**加（兜底版本号会编译进 `lib/server.js`）。
- **这些临时版本永不推送**：不提交、不 push、不打 tag、不发布。部署完
  `git checkout -- package.json src/server/index.ts && pnpm build` 还原工作树。
- 新里程碑才打新 tag（`v0.1.0-alphaN`）。这套规则只写在本文件，README 不出现开发号。

## 验收

- 部署循环：bump 本地修订号 → `pnpm typecheck && pnpm test && pnpm build` →
  `pnpm pack --pack-destination ~/.dsh/tarballs` → `dsh plugin --profile web remove/add <tgz>`
  → 重启 3080。
- **UI 验收只走 `dsh web`（`web` profile，端口 3080）**，绝不装进 desktop profile。浏览器操作
  交给子代理（`browser_list_tabs` → `browser_follow_tab` → `browser_navigate`，不用
  `browser_open_tab`），要求回报 DOM 实测值。
- 隐私：文档、注释、测试夹具里不得出现真实主机/用户名/内网 IP/本机路径；用
  `tester@203.0.113.10`、`/home/user` 之类的占位符。

## 已知缺口

- 远端会话不出现在 shell 的全局列表（会有 `uiConversation.binding: unknown session` 噪音）。
- 没有删除会话动作（只能手动删远端的 `remote-server-sessions/…`）。
- 插件自己的行在 shell 的区域里是 `display: none` 隐藏，不是移除。
- 会话行没有运行中/待审批状态点。
- 工作区改名只改清单标题，不 `mv` 远端目录。
- 新连接首帧可能短暂显示错误空态。
- 下载缓存不保留 release 的 `.manifest.json`。
- `tests/workspace-refs.test.ts` 在 macOS 上 4 条红（`/var` 与 `/private/var` 的 realpath 差异）。
