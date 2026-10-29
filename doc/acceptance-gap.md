# 验收差距矩阵（acceptance-gap）

> 用途：后续**拆任务**与 **QA 判定**的基准。每行给出：验收条目 / 现状（`文件:行号` 证据）/
> 差距 / 需要做什么 / 涉及模块 / 风险。行号以本文档落笔时的 `src/` 为准；改代码后如有漂移，
> 以函数名为准（每行都点了函数名）。
>
> 修订：**v2（2026-10-18，Leader 过闸 gate 3）**——按裁决 1–6 与实测契约纠正更新：
> 新增 2a.8（复用「自己刚部署的实例」的 PATH/nodePath 回归点）、E 节（验收资源与环境）、
> B 节第 8 条（两条传输 + host-key 确认）、3.2/4.2/2a.6 的裁决标注；§2.3/§7.1/§7.2 的脚本
> 纠正见 `doc/api-contract.md`。
> **v3（2026-10-18，Developer A/B 契约偏差裁决）**——4.1 措辞改为「断开连接 / 连接」；
> E 节 SSH 目标改为真实主机 `tester@203.0.113.10:22`（密码认证，登录后是 WSL），
> 删除已作废的「用户态 sshd 夹具 / `scripts/test-sshd.sh`」；其余偏差写在
> `doc/api-contract.md` §12 的偏差表。
> **v4（2026-10-18，D-1 裁决 (b) + 路由层口径）**——撤销 `origin` 降权要求（2a.8 的「需要做什么」
> 只保留 PATH 前缀与 nodePath 两条）；新增 **2a.9**：`connect/start` 路由层必须透传
> `reuseLauncherPath`（QA 在 alpha51 实测缺失），缺参以 `400` + `reuse-launcher-missing` 拒。
> **v5（2026-10-18，冻结前最后一批实现回写）**——1.2/1.3 改为 `method-cards.ts::offeredMethods`
> 且 **docker 整卡移除**；C 节补「`uiSession.bindingSource` 非 live 抛错 + 无 error boundary ⇒
> 白屏根因，已用 `clearMain()` 回避，右栏 dock 页签残留为理论风险」；D 节补两条回归
> （`sandbox` 兜底 facts 形状用 strict schema 验、`realm-unavailable` 守卫）。
> **v6（2026-10-18，阶段 P0：server 权威重构）**——6.2/7.1/7.2/7.3 改写为 server 权威语义
> （清单来自 `reg.list`、重命名走 `reg.rename`、删除走 `reg.delete` + `force`）；
> 新增 **F 节**：跨客户端同源 / desktop 零污染 / 删除不动会话日志 / 迁移无损 / 协议 v3 握手 /
> `reg.list` 向后解析 六条可判定证据链。权威归属表见 `doc/architecture.md` §7.1。
> **v7（2026-10-18，P0 契约修订：join 改 server 清单驱动）**——4.3 弹窗回单页签（删「远端已注册」
> 页签与 `unaddedServerWorkspaces()`）；**F.1 判定升级**：另一客户端建的工作区，本客户端刷新后
> **无需任何手动操作**就要出现（加了「要点按钮才出现 = 判失败」的反例），并新增第 ⑤ 步
> （移除后对端行与 ref 同时回收）。新增已知缺口「不能只在本机隐藏单个工作区」。
> **v8（2026-10-18，Gate 0 改判）**——共享 registry **默认零写入**（分支 A，
> `DSH_RW_FORCE_SHELL_WORKSPACES=1` 才回退 C）；F.2 判据随之改：**流程走完不得新增条目**
> （新增 = 判失败），清扫只用于清历史遗留；QA 在 alpha57 若判「会话接不进主区」则按
> architecture §7.4 的 A→B→C 判据翻分支。
>
> 判定口径：**能跑出证据的才算过**（UI 项报 DOM 实测值，远端项报远端文件/进程/输出的字面内容）。
> 架构与接口细节见 `doc/architecture.md`、`doc/api-contract.md`。

---

## A. 逐条差距矩阵

### 1. 新建连接分 3 步：① 选择方式 ② 填配置 ③ 连接

| 验收条目 | 现状（证据） | 差距 | 需要做什么 | 涉及模块 | 风险 |
|---|---|---|---|---|---|
| 1.1 三步（现在是四步） | `src/client/store.ts:30` `WizardStep = 'method' \| 'config' \| 'connecting' \| 'directory'`；`src/client/wizard.tsx:26` `STEP_ORDER` 四项；`wizard.tsx:57-62` `STEP_LABELS`；`wizard.tsx:785-788` 渲染四个步骤 | 四步，且第 3 步是纯进度页 | `WizardStep` 改为 `'method' \| 'config' \| 'connect'`；`STEP_ORDER`/`STEP_LABELS` 同步；第 3 步 = 连接方式三选一 + 进度 + 日志 + host-key | `client/store.ts`、`client/wizard.tsx` | 低。状态全在内存，无持久化，无兼容层需求 |
| 1.2 Step ① 支持 ssh | 实现已定稿：`src/client/method-cards.ts::offeredMethods(platform)` 产出卡片（`ssh` 恒有），内部用 host 同一个 `methodAvailable` 谓词 | 已有 | 保留；**docker 卡整卡移除**（不是置灰）：`ConnectionMethod` 仍保留 `'docker'` 作保留值，但 `OfferedMethod = Exclude<ConnectionMethod, 'docker'>`，UI 没有入口 | `client/method-cards.ts`、`targets/methods.ts` | 低 |
| 1.3 Step ① wsl 仅 Windows 可见 | `src/targets/methods.ts:20-27` `methodAvailable`（wsl 需 `win32`）；`method-cards.ts:35` `offeredMethods` 过滤卡片；host 侧 `src/index.ts:242-249`、`service.runConnect` 双闸门 | 已有 | 保留（**不得**改成置灰：非 Windows 上整卡不存在） | `client/method-cards.ts` | 低 |
| 1.4 Step ② ssh 能读 `~/.ssh/config` | `src/ssh-config.ts:350` `listSshAliases`；`src/index.ts:250-253` `ssh-aliases`；`index.ts:254-271` `alias-prefill`；`src/client/store.ts:880-927` `loadAliases`/`chooseAlias`；`wizard.tsx:351-388` 别名菜单 | 已有 | 保留 | — | — |
| 1.5 Step ② wsl 能读已装发行版 | `src/ssh/wsl.ts:209-221` `listWslDistros`（`-l -v`，UTF-16LE，不启动发行版）；`src/index.ts:242-249`；`src/client/store.ts:793-821` `loadWslDistros`；`wizard.tsx:223-311` `WslConfigFields` | 已有 | 保留 | — | — |
| 1.6 Step ③ 出现三种连接方式 | 现在的第 3 步只有进度行：`wizard.tsx:533-629` `ConnectingStep`；`store.ts:42` `CONNECT_STEPS`；`store.ts:250-258` `emptySteps` | 完全没有「连接方式」这个概念 | 新增三张方式卡片（复用 / 上传 / 远程下载-不可用）、`ConnectDraft.connectionMode: '' \| 'reuse' \| 'upload' \| 'download'` + `reuseLauncherPath`、扫描状态 `dshScan`；`startConnect()` 把 `connectionMode` 映射成 `packageSource`（`reuse`→`'reuse'`+path、`upload`→`'upload'`、`''`→省略） | `client/store.ts`、`client/wizard.tsx`、`client/api.ts`、`client/locales.ts` | 中。扫描需要凭据 → 必须复用 `pendingSecret`，且 host-key 未确认时先确认（见 2a.1 的实现约束） |

### 2a. 连接方式 a）复用机器上的 dsh

| 验收条目 | 现状（证据） | 差距 | 需要做什么 | 涉及模块 | 风险 |
|---|---|---|---|---|---|
| 2a.1 扫描远端已安装的 dsh 实例 | **不存在**。`src/provision/channel.ts` 全文无扫描；`src/provision/assets.ts:330-334` `sourceOrder` 只有 cache/download/build；`grep reuse` 无实现命中 | 无扫描脚本、无解析器、无路由、无 UI 列表 | 新增 `src/provision/dsh-scan.ts`（`scanDshScript()` + `parseDshScanOutput()` + `DshCandidate`）；新增路由 `dsh-scan`；`RemoteWorkspaces.scanDsh()` 用 throwaway transport 执行（照 `service.ts:629-647` `runCommand` 的写法） | `provision/dsh-scan.ts`(新)、`provision/service.ts`、`index.ts`、`client/api.ts`、`client/store.ts`、`client/wizard.tsx` | 高。扫描脚本必须是**只读**的，且 WSL 侧必须走 stdin（硬约束 8）；候选枚举面（PATH/nvm/fnm/volta/pnpm/`~/.dsh/server`）容易漏 |
| 2a.2 列出让用户选 | 无 | 无候选 UI | 第 3 步渲染候选列表（路径 / 版本 / 兼容徽标 / 是否已有 server 插件），选中项进 `config.reuseLauncherPath` | `client/wizard.tsx` | 中。`state.config` 里新增字段，注意 `patchConfig` 会清 `pendingSecret`（`store.ts:823-834`），选中候选不得走 `patchConfig` |
| 2a.3 判定版本兼容（`DSH_VERIFIED_RUNTIMES` 成员判定，只含 `0.2.1-rc.2`） | 区间只存在于 `package.json:84` 等 peer 声明；host 侧没有任何版本比较代码 | 无预发布感知的版本比较 | 新增 `src/provision/version-range.ts`：`parseDshVersion` / `compareVersions` / `isCompatibleDsh`（硬编码下限 `0.2.1-rc.2`、上限 `0.3.0` 开区间）；不新增依赖 | `provision/version-range.ts`(新)、`provision/dsh-scan.ts`、`provision/plan.ts` | 中。预发布语义（`rc.2` vs `rc.10` 数值比较、release > prerelease）必须有单测 |
| 2a.4 判定「缺 server 插件」 | 部署侧只有插件文件集的 sha256 marker：`channel.ts:379-391`（`decidePlugin`）、`deploy.ts:173-175`。复用路径下**没有** profile 目录 marker | 无「该 dsh 的 profile 里有没有我们的插件/是否最新」判定 | 扫描返回每个候选的 `profile.pluginVersion/pluginSha256/upToDate`（读 `<DSH_HOME>/profiles/<profile>/node_modules/dsh-remote-window/package.json` 与 `.dsh-rw-plugin.json`）；部署侧用 `sha256OfFiles` 比对 | `provision/dsh-scan.ts`、`provision/plan.ts`、`provision/channel.ts` | 中。`<DSH_HOME>` 可能与 `~/.dsh` 不同（`remote.dshHome` 可配），扫描需按用户配置的 dshHome 展开 |
| 2a.5 自动安装插件 | 插件安装逻辑已在打包路径里：`channel.ts:369-392`（`packageFiles` + `writeFiles` + marker），但目标目录固定为 `~/.dsh/profiles/<p>` 下的部署树 | 没有「装进复用 dsh 的 profile」分支；没有复用模式的 marker/部署锁 | `channel.ts` 拆两段：`uploadProfileAndPlugin({ profileDir, markerPath })`；复用模式 `profileDir = <DSH_HOME>/profiles/<profile>`，锁 = `<profileDir>/.dsh-rw.lock` | `provision/channel.ts`、`provision/deploy.ts`（新增 `profilePluginScript`/锁脚本）、`provision/profile.ts` | 中。两条路径共用 marker 语义，注意别让打包路径的旧 marker 失效（probe 要读两处） |
| 2a.6 远端没网时的失败提示 | **本来就不需要远端网络**：插件字节来自本机（`profile.packageFiles`）+ 本机缓存 | 无差距，但**文案**要讲清楚 | 第 3 步复用卡片文案 + 连接日志文案：复用模式「不需要远端网络」；失败时错误码 `dsh-incompatible` / `reuse-launcher-missing` / `reuse-node-missing` / `reuse-boot-failed`，并给**「改用上传 server 包并重试」按钮**（Leader 裁决 4：用户点了才切换，绝不自动回退） | `client/locales.ts`、`client/wizard.tsx`、`provision/channel.ts` | 低 |
| 2a.7 与五步流水线合并 | `channel.ts:208-419` `provisionOver`：probe→runtime→upload→start；`channel.ts:350-367` 无条件准备 dsh 包 | 无「跳过 runtime + dsh 包」分支 | 新增 `provision/plan.ts::planProvision`；`channel.ts` 按 plan 跳过 runtime（emit `ok` + 消息）与 dsh 包上传；start 用 `reuseServerCommand` | `provision/plan.ts`(新)、`provision/channel.ts`、`provision/profile.ts` | 高。这是最容易被写歪的地方：**不允许** reuse 失败后静默改走上传（A11） |
| 2a.8 **复用「自己刚部署的实例」**（Leader 实测的回归点，2026-10-18） | 部署产物：`~/.dsh/server/dsh/node_modules/.bin/dsh` 是 `/bin/sh` **包装脚本**（正文 `exec node`），`~/.dsh/server/node/bin/node` **不在 PATH 上**（`profile.ts:146-153` `serverCommand` 只在启动时用 `pathAssignment` 注入）；打包路径的插件 marker 实际落在 `~/.dsh/profiles/<p>/.dsh-rw-plugin.json` | 扫描脚本若不带 `$DSHHOME/server/node/bin` 前缀，`--version` 会 `exec: node: not found`（exit 127）→ `version=''` → 判不兼容 → **复用刚部署的实例第一次就失败**；`readlink -f` 对该 shim 返回它自身、`head -1` 是 `#!/bin/sh`，只看 shebang 给不出 node | 扫描脚本 `PATH` 前缀必须含 `$DSHHOME/server/node/bin`；`nodePath` 增加「shebang 不点名 node 的包装脚本 → 取 `$DSHHOME/server/node/bin/node`」 | `provision/dsh-scan.ts`、`provision/plan.ts` | **高**。必须有手测：对已部署过的远端扫描，该候选 `compatible: true` 且版本非空（api-contract §13 A 节） |
| 2a.9 **路由层必须透传 `reuseLauncherPath`**（QA 在 alpha51 实测的回归点，2026-10-18） | QA 实测 alpha51 的 `connect/start` 路由层**没有**把 `reuseLauncherPath` 从 body 搬进 `ConnectRequest`。现已修：`connectRequestFrom`（`src/index.ts:200`，纯函数）+ 回归测试 `tests/connect-request.test.ts`；缺参时 `index.ts:215-218` 抛 `RouteError('bad-request', …)`（HTTP 400，message 点名 `reuseLauncherPath`） | 用户在第 3 步选中的启动器路径丢失 → 复用在执行期才报错（错误指向不明），或静默按默认行为跑 | 路由层校验 + 单测钉住 `connectRequestFrom` 会把 `packageSource`/`reuseLauncherPath` 一起搬过去；QA 回归口径：抓一次 `connect/start` 请求体 + host 日志，确认路径到达 `planProvision` | `src/index.ts`、`tests/connect-request.test.ts`、`provision/service.ts` | **高**。QA 回归必查（alpha51 的真实缺陷） |

### 2b. 连接方式 b）上传 server 包 + 本地打包/缓存复用

| 验收条目 | 现状（证据） | 差距 | 需要做什么 | 涉及模块 | 风险 |
|---|---|---|---|---|---|
| 2b.1 探测远端需要的架构 | 已有：`deploy.ts:136-155` `probeScript`（`uname -s/-m`、`/proc/sys/kernel/ostype`、`ldd`）；`deploy.ts:101-133` `parseProbeOutput`（platform/arch/libc）；`channel.ts:228` 在流水线里用 | 有，但**只在连接过程中**可见；连接前 UI 无法告知「要哪个包」 | `dsh-scan` 顺带返回 `probe` + `package`（artifact 名 + 本地缓存是否命中）；流水线仍自己 probe（权威） | `provision/dsh-scan.ts`、`client/wizard.tsx`、`client/api.ts` | 低。注意 `probeScript` 有写副作用（`deploy.ts:146` `mkdir -p ~/.dsh/server/.components`），新的**只读**扫描脚本不要抄这一行 |
| 2b.2 本地对应架构的包不存在时先在本地生成 | 已有：`assets.ts:243-280` `buildDshRuntimePackage`（本地 pnpm 暂存 + `buildServerPackage`）；`channel.ts:328-336` `resolveServerPackage` 在 `upload` 策略下 cache→build | 已有 | 保留；UI 把「本机打包可能需数分钟」说清（日志已有 progress 行） | `provision/assets.ts`、`provision/package-build.ts` | 中。Windows 宿主打 linux 包的原生依赖坑（AGENTS「交叉暂存」5 条）已有 `fixNativeClosure` |
| 2b.3 缓存复用（下次选上传可直接用） | 已有：`assets.ts:341-374` `resolveServerPackage` 先查 `cachedAssetIfReady`（`assets.ts:152-161`：`stat` + `.ready` 里的 sha256）；命名 `package-build.ts:71-78` `artifactTag`/`artifactName` | 已有；缺**UI 可见性**（用户不知道命中缓存） | `dsh-scan` 返回 `package.cached/sha256/sizeBytes`，上传卡片显示「已缓存（xx MB，直接上传）」 | `client/wizard.tsx`、`provision/dsh-scan.ts` | 低 |
| 2b.4 `packageSource` 需要新增 `reuse` 且老记录兼容 | `src/targets/types.ts:57`（记录字段）、`:196` `packageSourceSchema = z.enum(['auto','download','upload'])`；`service.ts:70` ConnectRequest；`store.ts:64` 客户端草稿；`assets.ts:330` `sourceOrder` 入参类型 | 枚举只有三值 | `packageSourceSchema` 加 `'reuse'`（**optional 字段的枚举加宽**，旧记录仍然通过）；`sourceOrder` 保持只接受「需要产物」的三个值，`resolveServerPackage` 收到 `'reuse'` 抛类型错（防御） | `targets/types.ts`、`provision/assets.ts`、`provision/channel.ts`、`client/api.ts` | 中。`store.ts:35` 域版本仍 1；schema 加宽不算破坏性变更，但需一条「旧记录能读出」的单测 |

### 2c. 连接方式 c）远程下载（本轮不实现，UI 出现但不可用）

| 验收条目 | 现状（证据） | 差距 | 需要做什么 | 涉及模块 | 风险 |
|---|---|---|---|---|---|
| 2c.1 卡片出现且不可用 | 现在「Remote 下载」藏在高级折叠里、**能用**：`wizard.tsx:511-524` `packageSource` SegmentedControl（auto/download/upload）；`assets.ts:289-327` `downloadServerPackage` 会真的去 GitHub Releases 下载 | 位置错（高级折叠）、语义错（可用） | 第 3 步出现「远程下载」卡片 `disabled`，文案「第一个 server release 之后支持」；`download` 从连接方式选择里**移除**（全局策略仍保留 auto/download，供老目标与策略设置使用） | `client/wizard.tsx`、`client/locales.ts` | 低。**不要**顺手删 `assets.downloadServerPackage`（`auto` 策略还在用） |

### 3. 连接成功后「远程工作区」区域多出该连接

| 验收条目 | 现状（证据） | 差距 | 需要做什么 | 涉及模块 | 风险 |
|---|---|---|---|---|---|
| 3.1 连接成功即出现 | 已有：SSE `done` 帧 → `store.ts:1072-1090` 写 `target` + `refreshState()`；树按 `state.targets` 渲染 `tree.tsx:412-419`；`/api/state` 返回 targets `index.ts:229-241` | 已有 | 保留 | — | — |
| 3.2 成功后落点必须是「列表 + 连接行」，不是目录页 | `store.ts:1081` 在 `done` 帧里 `step: 'directory'` 并 `loadDirectory(target.id, '')` | 落点会跑到目录浏览 | **Leader 裁决 1（已采纳）**：改为 `view: 'list'`、清 `connect`、展开该连接节点（`targetNodeKey`）、toast 引导「点『添加工作区』」；**不**自动弹添加工作区弹窗 | `client/store.ts` | 低。但 `ConnectState.origin==='directory'`（`store.ts:102`）连同 `openTargetDirectory`（`store.ts:1228`）要一起退役，别只改一行留下死代码 |

### 4. 连接行三个按钮都能工作

| 验收条目 | 现状（证据） | 差距 | 需要做什么 | 涉及模块 | 风险 |
|---|---|---|---|---|---|
| 4.1 断开连接 | 已有：`tree.tsx:365`（`rename` 槽 → `store.stopTarget`）、`tree.tsx:79` 译文、`store.ts:1345-1370` `stopTarget`、`service.ts:422-444` `stopTarget`、路由 `index.ts:419-420` | 已有 | **措辞按需求方原文**（Leader 裁决 b）：已连接时显示「**断开连接**」，未连接时显示「**连接**」（同一个菜单槽的二态，不改动作） | `client/locales.ts` | 低。动作不变 |
| 4.2 删除连接（措辞从「忘记连接」改） | 实现已有：`tree.tsx:366`（`delete` 槽 → `store.requestForgetTarget`）、`store.ts:592-602`、`service.ts:403-420` `forgetTarget`、路由 `index.ts:379-382`。**措辞**是「忘记连接」：`locales.ts:109` + 确认框 `locales.ts:110-111`(zh)/`375-376`(en) | 只有措辞与确认框正文 | **Leader 裁决 3（已采纳）**：改 `tree.forgetConnection` 等 key 的中英文为「删除连接」；确认正文**逐项**写「会删」= 本机记录 + 已存凭据 + N 个远程工作区记录 + 其本地锚点目录/shell 条目，「不会删」= 远端 `~/.dsh/server` 部署物 + `remote-server-sessions` 会话日志 + 远端 profile；`store.ts:1322` 的成功 toast（`list.forgotTarget`）同步 | `client/locales.ts`、`client/store.ts`(仅文案 key) | 低。**动作语义不变**（见 architecture §3.5 的处置表） |
| 4.3 添加工作区 | 存在但语义不对：`tree.tsx:363`（`+` 槽，仅 connected 时）；`store.ts:1515-1521` `openAddWorkspace` 打开的是**远端注册表列表** `list.tsx:44-112`（数据源 `reg.list`，`service.ts:848-862`），浏览只是弹窗里的小逃生口 `list.tsx:76-85` | 主路径不是「浏览目录」 | `AddWorkspaceDialog` **只保留「浏览目录」单页签**（P0 裁决 A43：自动登记后「远端已注册」页签恒为空，取消它并删掉 `unaddedServerWorkspaces()`）；未连接时弹窗内先 `api.connect` 再列目录 | `client/list.tsx`、`client/directory-picker.tsx`(新)、`client/wizard.tsx`(抽走)、`client/store.ts`、`client/workspace-join.ts` | 中。抽组件时不要复制两份目录 UI（现有 `DirectoryStep` 全量搬走） |

### 5. 添加工作区能浏览远端目录，选一个目录作为工作区

| 验收条目 | 现状（证据） | 差距 | 需要做什么 | 涉及模块 | 风险 |
|---|---|---|---|---|---|
| 5.1 浏览远端目录 | 已有：`store.ts:1167-1225` `loadDirectory`；`wizard.tsx:632-765` `DirectoryStep`（面包屑/上级/主目录/路径跳转/新建目录/空态/错误）；host `service.ts:662-682` `listDirectory`；路由 `index.ts:342-350` | 只在向导里 | 搬到弹窗页签（组件搬迁 + 删除 `openTargetDirectory` 的 step 跳转） | `client/*`、`src/client/styles.ts`（若类名需调整） | 中。`list-dir` 走 `withBrowser`（`service.ts:710-734`），未连接目标会**自动连**（`connectChannel`），所以要显式给「连接中」状态而不是白屏 |
| 5.2 选目录作为工作区 | 已有：`store.ts:1288-1313` `openWorkspace` → `index.ts:351-358` → `service.ts:970-985` `openWorkspace`（先 `listDirectory` 校验、再 materialize stub、再建会话） | 已有 | 弹窗里成功后关窗 + 展开连接节点 + `revealSession` | `client/store.ts`、`client/list.tsx` | 低 |
| 5.3 目录名作为标题 / 可改标题 | 已有：`wizard.tsx:754-760` 标题输入、`store.ts:1257-1259` `setDirectoryTitle`、host `materializeWorkspace` 默认取末段（`service.ts:1053`） | 已有 | 搬迁时保留 | — | — |

### 6. 添加后连接下显示该连接的工作区列表

| 验收条目 | 现状（证据） | 差距 | 需要做什么 | 涉及模块 | 风险 |
|---|---|---|---|---|---|
| 6.1 三层走树（连接→工作区→会话） | 已有：`tree.tsx:308-386` `ConnectionRow`（`connected && expanded` 才渲染子节点）、`tree.tsx:266-305` `WorkspaceRow`、`tree.tsx:216-263` `SessionRows`、`tree.tsx:433-443` `orderSessions` | 已有 | 保留 | — | — |
| 6.2 记录来源 | 上一版：`store.ts:651-705` `refreshState`（`/api/state` 的 `workspaces`）+ `service.ts:459-461` `listWorkspaces`（本地记录）。**P0 改**：工作区行来自 `/api/state` 的 `serverWorkspaces`（= 每个在线 target 的 `reg.list`），本地只有 `workspaceRefs`（架构 §7.1） | 本地不再是清单权威 | `service.listWorkspaces()` 退役；`state` 增 `workspaceRefs`/`serverWorkspaces`（§15.2）；客户端按 `(targetId, remoteWorkspaceId)` join | `provision/service.ts`、`index.ts`、`client/store.ts`、`client/tree.tsx` | 中。断线时该 target 没有工作区行（A38，与现状一致） |

### 7. 远程工作区功能与本地工作区基本相同（重命名 / 删除 / 新会话）

| 验收条目 | 现状（证据） | 差距 | 需要做什么 | 涉及模块 | 风险 |
|---|---|---|---|---|---|
| 7.1 可重命名工作区 | 上一版实现为「只改本地 `RemoteWorkspaceRecord.title`」（`tree.tsx:94` 槽位 + `workspace-rename` 路由）。**P0 推翻**：清单在 server，本地没有 title 可改（架构 A34） | 语义要改成 server `reg.rename` | 路由 `workspace-rename` 改 body `{ targetId, remoteWorkspaceId, title }` → 转发 `reg.rename`（§14.2）；成功后重读 `reg.list` 并刷新 `serverWorkspaces`；弹窗沿用 `workspace-rename-dialog.tsx` | `server/session-store.ts`、`server/controller.ts`、`protocol.ts`、`provision/service.ts`、`index.ts`、`client/*` | 中。**id 与远端目录都不变**；必须两仓同步（A34） |
| 7.2 可删除工作区 | 上一版是本地 `forgetWorkspace`（删本地记录 + stub + 官方条目）。**P0 改语义**：删除 = server `reg.delete` | 要区分「有会话拒绝/强制」「只删清单不删日志」 | 新增路由 `workspace-delete` → `reg.delete`（§4.1/§14.3）；`sessionCount>0` 时 409 `workspace-not-empty` → 二次确认后 `force: true`；成功后删本地 ref/stub/官方条目 | 同 7.1 + `client/confirm-dialog.tsx` | **高**。force 语义必须写清「会话日志保留」并让 QA 用「删后重建 sessionCount 恢复」证明（F 节） |
| 7.3 可新会话 | 已有：工作区 `+` → `store.ts:292` `reopenWorkspace`；官方 blank 行 `tree.tsx:252-260`；host `openWorkspace` 总是新建（`service.ts:975-985` 注释） | 已有 | 保留（P0 下 workspace 行来自 server 清单，`reopenWorkspace` 传的 path 改为取自 server 项） | `client/store.ts` | 低 |
| 7.4 样式/行为对齐本地 | 行层是内置官方组件（`src/client/vendor/workspace-rows/**`），零自绘样式 | 已有 | 保留；新增弹窗只用官方 primitives（Modal/Button/Input/Field） | `client/styles.ts` | 低 |

### 8. 新会话可创建，且对话的全部操作在远端

| 验收条目 | 现状（证据） | 差距 | 需要做什么 | 涉及模块 | 风险 |
|---|---|---|---|---|---|
| 8.1 新会话 | 已有：`service.ts:970-985` + `session/open.ts:121-171`；blank 行 `tree.tsx:252-260` | 已有 | 保留 | — | — |
| 8.2 点击会话在远端对话 | 已有：`store.ts:1482-1506` `openSession` → `index.ts:359-368` `open-session` → `service.ts:1001-1028` `resumeSession` → `agents.resume` → routing → `persist.*` | 已有 | 保留 | `client/store.ts`、`provision/service.ts`、`session-persistence/routing.ts` | 中（并发：同 session 重复 resume 已被 `resumeQueue` 串行化） |
| 8.3 工具执行在远端 | 已有：realm preset 覆盖 `ssh/fs/subprocess/sandbox/shell`（`preset/world.ts:36-66`）；`connection/index.ts:121-133` `request`；沙箱无后端时远端原样返回 argv（`server/controller.ts`，见 AGENTS） | 已有 | 保留 | — | — |
| 8.4 读写文件在远端 | 已有：`dsh-fs-ssh` 走 `ctx.ssh.request` → 远端 `fs.*`；stub→remote 改写 `connection/index.ts:153-177` | 已有 | 保留 | — | — |
| 8.5 持久化在远端 | 已有：`routing.ts:233+` `RoutingSessionPersistence`；`rsession/remote-persistence.ts:66-72` header 重锚；远端根 `~/.dsh/remote-server-sessions` | 已有 | 保留（**验收口径见 B 节**） | — | — |

---

## B. 「对话真的在远端」的 QA 证据口径（需求 8 的判定方法）

任一证据链缺失即判**未通过**；证据必须是字面输出/文件内容，不接受「看起来对」。

1. **远端日志出现**：连接后开一个新会话并聊一轮，然后在**远端**执行
   `ls -la ~/.dsh/remote-server-sessions/<projectKey(远端工作区路径)>/<sessionId>/`
   与 `wc -l`（或 `head -1`），报告**字面输出**。同时在本机 `~/.dsh/sessions/` 下
   `grep -r "<sessionId>"` 必须**无命中**（本地不得出现该会话）。
2. **工具在远端执行**：在会话里让模型跑
   `pwd; hostname; uname -s; cat /proc/sys/kernel/ostype; touch .dsh-rw-remote-proof`
   - 输出里的 `pwd` 必须是**远端工作区路径**（不是 stub `C:\…\.dsh\remote-windows\…`，也不是本机的 cwd）；
   - `hostname`/`uname` 必须是远端（WSL 场景 = 发行版；ssh 场景 = 远端主机）；
   - `.dsh-rw-remote-proof` 必须**只在远端**存在（`ssh`/`wsl` 里 `ls` 得到），本机对应路径不存在。
3. **一次工具调用只发生一次**：远端 `ls` 只看到 1 个 proof 文件，本机同名文件 0 个（防止「两边都跑了」）。
4. **server 进程唯一且在远端**：会话 live 期间在远端执行
   `ps -eo pid,args | grep -c '[d]sh --profile dsh-remote-server'` 必须为 **1**；
   WSL 场景同样在发行版内查（不是 Windows 侧 `wsl.exe` 计数）。会话结束后（空闲租约 30 s + 关闭）应为 0。
5. **远端权威可续聊**：杀掉本机 `dsh web`（3080）并重启，点击同一个会话行 → 历史消息**从远端**读回
   （`open-session` → `agents.resume` → routing → `persist.open`）；重启后本机 `~/.dsh/sessions/` 仍无该会话。
6. **会话标题来自远端日志**：在 A 设备改标题后，`persist.titles` 读到新标题（行时间列为日志最后事件时间）。
7. **复用 / 打包两种连接方式都要跑一遍**（同一远端、同一工作区路径）：两者都能满足 1–6，
   且切换后历史会话仍在（证明存储位置只由 `DSH_HOME` 决定，与 dsh 安装路径无关）。
8. **两条传输路径都要跑一遍**：`wsl` 与 `ssh`（见下面 E 节的资源）。`ssh` 路径还必须额外证明
   **未知 host key 的显式确认**：首次连接弹指纹面板 → 确认前不得建立会话 → 确认后才继续
   （`dsh-scan` 的 `stage:'host-key'` 分支与 `connect/start` 的确认路径都要各证一次）。

**UI 侧（需求 1–7）**：QA 报 DOM 实测值，不报观感。至少包含：
- 向导步骤 pill 的文本与数量（应为 3）；
- 第 3 步三张方式卡片的 `disabled` 属性与文案（远程下载必须 `disabled`）；
- 连接行三个动作的可见文本（断开连接 / 删除连接 / 添加工作区）+ 点击后的 DOM 变化
  （`data-row-key`、工作区行数、toast 文本）；
- 添加工作区弹窗里目录条目数与选中目录的绝对路径、打开后树里的工作区行文本；
- 工作区行菜单的两项文本（重命名工作区 / 移除工作区）与重命名后行文本变化。

---

## C. 本轮不做（避免 QA 按错误标准判）

| 项 | 处理 |
|---|---|
| 远程下载 server 包 | UI 置灰 + 文案；`downloadServerPackage` 代码保留（`auto` 策略仍用） |
| 删除远端会话 | 仍是已知缺口（AGENTS「已知缺口」），行菜单不含删除 |
| 删除连接时清理远端部署物 / 远端 workspace 索引 | 明确保留（architecture §3.5），残留写进文档 |
| 远端 registry 里的工作区标题与本地重命名同步 | **P0 已做**（`reg.rename`，架构 A34）；本条不再适用 |
| **「只在本机隐藏某个工作区」** | P0 明确不做（A44）：清单是 server 权威，本地隐藏会被下一次自动登记复活；需要的话应做成「整连接不连/删除连接」，而不是逐工作区隐藏。QA 不按此判失败 |
| 会话「运行中/待审批」状态点 | 仍未观察 |
| 工作区行「刷新会话列表」 | 退出行菜单（Leader 裁决 2 已采纳；官方行菜单只有 `rename`/`delete.workspace` 两个固定 key，重命名占了 `rename`；列表在展开与每个动词后自动重读）。见 architecture §3.6 |
| 远端 registry 标题与本地 `title` 不一致 | 已知缺口（裁决 5）：重命名只改插件记录 `title`，绝不 `mv` 远端目录；同步远端 `reg.list` 需新增 `reg.rename`。QA 不按此判失败 |
| **shell 侧 `uiSession.bindingSource` 非 live 抛错 + render 无 error boundary** | alpha54 白屏根因；我们已用官方 `uiWorkspace.clearMain()` 在断开/删除/掉线前取消选中回避。**右栏残留 dock 页签**（`SidebarSessionViews.prune()` 保留 `hasRetainedTabs`）仍是理论风险；彻底修复在 shell 侧（absent projection + error boundary），不在本仓库范围。QA 记录为「已知风险」，不判失败 |

## D. 回归不变量（改动后必跑）

- `pnpm typecheck && pnpm test && pnpm build` 全绿（Windows 上 17 个 POSIX-only fixture 红是已知）。
- `src/protocol.ts` / `src/server/**` / `src/frame/**` 与兄弟仓库逐字节相同（本轮应保持零改动）：
  `Get-FileHash` 对比 8 个文件（`protocol.ts` + 4 server + 3 frame）。
- 本地工作区行为不变：本地会话仍写 `~/.dsh/sessions/`，官方「添加工作区」按钮行为不变。
- `cordis.patch.yml` 无改动（`git diff --exit-code`）。
- 记录兼容：拿一份旧 profile 的存储域快照（含 `packageSource: 'download'` 的老记录）能读出并通过
  `targetRecordSchema`。
- 凭据：任何新增路由的错误消息里 `grep -i "password\|passphrase\|secret"` 只应看到 `***`。
- **远端 `sandbox` 兜底形状**：`request('sandbox', …)` 的返回必须是官方 facts 对象
  `{ argv, enforcement:'partial', denialSignatures:[], runnerFailureRules:[] }`，
  用 `@deepseek-ai/dsh-sandbox-ssh` 的 **strict** schema 校验；**不许用 `z.unknown()`**
  （alpha48–50 的「通过」就是被它放过去的）。见 architecture §2.8。
- **realm 守卫**：`stop-target` / 断开后立刻点会话行 → 必须得到 `realm-unavailable`
  （HTTP 500，消息含 targetId + 预设 id + 原因），且**本机不新增任何文件**、
  不出现本地 shell 执行（architecture §3.9 的行为契约）。

---

## E. 验收资源与环境（Leader 裁决，2026-10-18 更新）

| 用途 | 资源 | 关键事实 |
|---|---|---|
| **WSL 传输的验收目标** | 本机 `Ubuntu-22.04` | 已确认存在 `~/.dsh/server/{dsh,node,staging}` 与 `~/.dsh/profiles/dsh-remote-server/.dsh-rw-plugin.json`——即**打包路径已部署过**。因此它同时是「上传包 → 复用刚部署实例」这条链的现成用例（对应 2a.8 的回归点）。WSL 无 host key，指纹恒 `''`。 |
| **SSH 传输的验收目标** | **真实主机 `tester@203.0.113.10:22`**（**密码认证**） | 该主机登录后就是一台 WSL（发行版用 `uname -a` 确认，QA 需把它记进测试记录）。① `~/.ssh/config` 别名读取：QA 自己在该文件里加一条别名指向这台主机（例如 `Host qa-ssh` + `HostName 203.0.113.10` + `User tester`），然后在第 ② 步用别名预填；② 未知 host-key 确认：首次连接必然触发指纹面板（`dsh-scan` 的 `stage:'host-key'` 与 `connect/start` 各证一次）；③ ssh 传输全流程（连接 → 上传包/复用 → 添加工作区 → 会话在远端）。**密码只在 `/api/connect/start`、`/api/dsh-scan` 的 body 里出现，QA 不得把密码写进报告或截图。** |
| 未知 host key 正例 | SSH 真实主机的 host key 对本机是新的 | 首次连接触发指纹确认（覆盖硬约束 2）。**注意**：该主机被确认过一次后指纹就进内存 `state.trusted`；要重测确认流程需重启 `dsh web`（内存态）或换目标。 |
| 不兼容 dsh 负例 | 在真实主机上把 `PATH` 指向一个假启动器（`--version` 打印 `0.1.9`），或用 `nvm` 装一个旧版 dsh | 验证 `dsh-incompatible` 错误码 + 「改用上传 server 包并重试」按钮（裁决 4），并证明**没有自动开始上传**（日志无 upload 行、无大流量传输）。 |

> QA 必须报告「用了哪条传输、哪台目标、哪个连接方式」三元组；同一验收条目至少有一组证据来自
> **复用**方式和一组来自**上传**方式。
>
> 已作废：早前设想的「Ubuntu-22.04 内自建用户态 sshd 夹具 / `scripts/test-sshd.sh`」**不再使用**，
> 该脚本不存在，QA 不要去找（2026-10-18 Leader 裁决）。

---

## F. 阶段 P0（server 权威 + 本地只留引用）的验收口径

> 这一节是**可逐条判定**的证据链。P0 的核心命题只有三句：
> **清单在 server**、**共享 registry 不被污染**、**删除不动会话日志**。
> 每条都要字面证据（命令输出 / JSON 片段 / 文件列表），不接受「看起来对」。

### F.1 跨客户端同源（清单在 server，**行由 server 清单驱动**）

**判定核心（Leader 裁决 A43）**：在另一客户端建出来的工作区，**本客户端刷新后无需任何手动操作
就出现**（不需要点「添加工作区」、不需要在某个页签里手动加一次、不需要重启）。

| 步骤 | 期望 | 证据 |
|---|---|---|
| ① 客户端 A（`dsh web` 端口 P1，profile `web`）连接同一台 server，添加工作区 `/home/user/proj` | 成功；`reg.list` 里出现该项 | A 的 `POST /api/state` → `serverWorkspaces[targetId]` 里的 `{id,path,title,sessionCount}`，`id` 记下来 |
| ② 客户端 B（**另一个** profile 或另一个端口 P2，同一 server，**此前从未加过这个工作区**）连接并**只刷新**（不点任何按钮） | **无需手动操作**，B 的「远程工作区」树里直接出现该工作区行（同 `id`、同 `path`、同标题） | 截图/DOM 实测行文本 + B 的 `POST /api/state`：`serverWorkspaces[id]` 有该项，且 `workspaceRefs` 里存在同 `remoteWorkspaceId` 的 ref（证明显式登记是自动发生的） |
| ③ A 建一个会话、聊一轮；B 展开该工作区 | B 看到**同一个 sessionId** 与**同一个标题** | B 的 `POST /api/sessions` 响应；`persist.titles` 读到的标题一致 |
| ④ A 重命名工作区；B 刷新 | B 看到新标题（`reg.rename` 是 server 权威） | 两边 `reg.list` 的 `title` 一致 |
| ⑤ A 移除该工作区（无会话 → 直接删；有会话 → 二次确认 `force`）；B 刷新 | B 的行**同时消失**（清单是共享权威） | B 的 `POST /api/state` 里 `serverWorkspaces` 无该项，且 `workspaceRefs` 里对应 ref 也被回收 |

> 反例（会被判失败）：
> - B 里**看不到** A 建的工作区，或必须点「添加工作区 / 远端已注册」才出现 → 说明 join 还是 inner join，判失败；
> - 两边 `id` 不同 → 说明还在各自 `reg.create` 不同 path；
> - ⑤ 之后 B 仍有这一行（ref 没被回收）或 A 端需要重启才消失。

### F.2 desktop 零污染（共享 registry 不再出现我们的 stub）

1. 记录基线：`cat ~/.dsh/storages/workspace.json`（或该存储域文件）里 `~/.dsh/remote-windows/` 出现次数。
2. 走一遍完整流程（连接 → 添加工作区 → 开一个会话 → 断开）。
3. 调用 `POST /api/cleanup-shell-workspaces`，期望 `{ removed: [...], kept: [] }`（`kept` 非空 = 仍有活跃会话）。
4. 再 `cat` 同一文件：**`~/.dsh/remote-windows/` 出现次数为 0**（贴出 grep 计数前后对比：
   `grep -c "remote-windows" <file>`）。
5. **未装插件的 desktop**：在 desktop profile 里启动（**不**装本插件），左栏**不出现**任何远程工作区行；
   文件里也没有我们的 stub 条目（第 4 步已证）。

> **默认分支是 A（零写入）**（Leader 裁决 v8）：不设 `DSH_RW_FORCE_SHELL_WORKSPACES=1` 时，
> 第 2 步走完文件里就**不应新增任何** `~/.dsh/remote-windows/` 条目——**第 3 步的清扫是为了
> 清历史遗留**（老版本写进去的行），不是清我们刚刚写的。因此：
> - 若第 2 步后计数**增加** → 判失败（默认 A 失效）；
> - 若第 2 步后计数不变、但第 3 步清出了旧行（`removed` 非空）→ **符合预期**；
> - 若设了逃生口（运维回退）→ 允许窗口期存在，判据回到「会话结束后能清到 0」。

### F.3 删除不动会话日志（`reg.delete` 的连带语义）

1. 在 server 侧记录目标工作区会话目录：`ls ~/.dsh/remote-server-sessions/<projectKey>/` 与
   每个 `<sessionId>/` 的 `wc -l`（贴字面输出）。
2. 客户端点「移除工作区」→ 期望 HTTP **409 `workspace-not-empty`**，message 含会话数。
3. 二次确认（`force: true`）→ 期望 `{ removed: true, sessionCount: N }`，清单里不再有该 id。
4. **立刻 ls 同一会话目录**：目录与文件数**完全不变**（贴前后对照）→ 证明「只删清单」。
5. 用「添加工作区」重新登记同一路径 → `reg.list` 的 `sessionCount` **恢复为 N**，
   会话列表、标题、历史消息都在（`POST /api/sessions` + 打开一个会话看到历史）。

> 反例：第 4 步目录变空，或第 5 步 `sessionCount` 变 0 → 说明实现顺手删了日志，判失败。

### F.4 迁移无损（旧 `RemoteWorkspaceRecord` → `WorkspaceRef`）

准备：用一个装有旧版插件、已建过工作区的 profile（或手工把一条旧记录写进存储域，含
`path`/`title`/`stubPath`/`officialWorkspaceId`/`sessionId`）。

| 步骤 | 期望 |
|---|---|
| ① 升级插件并启动（target 未连接） | 不报错、不阻塞启动；旧记录原样保留；日志里有「跳过迁移（未连接）」 |
| ② 连接该 target | 迁移自动执行：`reg.create(path, title)`；本地记录出现 `remoteWorkspaceId`，`path`/`title`/`createdAt` 被清空 |
| ③ `POST /api/state` | `workspaceRefs[..].remoteWorkspaceId` = `reg.list` 里同 path 的 `id`（贴两处 id 对照） |
| ④ 打开该工作区历史会话 | 能打开、历史完整（会话按 `header.cwd` 归属，与清单重建无关） |
| ⑤ 重启后 | 不重复迁移（`remoteWorkspaceId` 已存在）；无重复清单项 |

> 反例：同一个 path 在 `reg.list` 里出现两条（说明迁移不是幂等登记）。

### F.5 协议 v3 与握手

| 步骤 | 期望 |
|---|---|
| ① v3 client + v3 server | 连接成功；`server.hello` 返回 `protocol: 3` |
| ② v3 client + 旧 server 插件（人为把远端 profile 的 `lib/` 换回 v2 构建） | 明确报 `server-protocol-mismatch`，文案含「远端 server 插件过旧」与「重连/改用上传」两条出路；**不**静默降级 |
| ③ 旧 client（v2 构建）+ v3 server | 旧客户端显示可读句子 `unsupported remote session protocol 2; this server speaks 3 …`（贴出） |
| ④ `grep -rn "REMOTE_SESSION_PROTOCOL" src/protocol.ts` | `= 3`；且两仓 8 文件逐字节相同（`Get-FileHash` 对照表） |

### F.6 `reg.list` 向后解析（旧 server 缺字段）

用 v3 client 连一个 v2 server（或手工 stub 掉 `updatedAt`/`sessionCount`）：工作区行仍渲染，
缺字段显示为 `—`，**不**整项丢弃、**不**报错。
