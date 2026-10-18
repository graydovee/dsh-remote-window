# dsh-remote-workspace 架构（含本轮需求变更）

> 状态：**架构基线 v2**（本轮「新建连接三步 + 连接方式三选一 + 行级添加工作区」需求）。
> 权威性：本文件与 `doc/api-contract.md`、`doc/acceptance-gap.md` 一起是实现的唯一权威；
> 代码与文档不一致时，先走变更确认（架构师改文档并通知 Leader 与 Developer）。
> 现有实现事实以 `AGENTS.md` 为准（那份文件记录的是实测约束，本文件不推翻任何一条）。

- 本轮需求（验收标准 1–8）见 `doc/acceptance-gap.md`。
- 接口契约（路由 / 类型 / 脚本 / 缓存命名）见 `doc/api-contract.md`。

---

## 1. 范围与非目标

**本轮做**

1. 新建连接向导收敛为 **3 步**：① 选择方式 → ② 填写配置 → ③ 连接（连接方式三选一）。
2. 第 3 步的三种连接方式：**复用机器上的 dsh**（扫描 + 自动补装 server 插件）、**上传 server 包**
   （先探测远端架构、本地按架构打包并缓存复用）、**远程下载**（UI 出现、明确不可用）。
3. 连接行三个动作：**断开连接** / **删除连接**（原「忘记连接」改措辞）/ **添加工作区**。
4. 添加工作区 = 浏览远端目录并选一个目录（不再是向导第 4 步）。
5. 工作区行支持 **重命名工作区**、移除工作区、新会话。

**非目标（本轮明确不做）**

- **远程下载 server 包**：UI 卡片置灰，文案说明「第一个 server release 之后支持」。
  `assets.downloadServerPackage` 的代码保持原样，只是不再被 UI 当作可选项。
- **删除远端会话**、**删除远端部署物**（见 §5.3 结论）。
- **协议 / 远端 server 变更**：`src/protocol.ts`、`src/server/**`、`src/frame/**` 本轮**逐字节不动**
  （复用式连接、架构探测、工作区重命名都不需要远端新增 RPC）。这直接满足「两仓库逐字节相同」的硬约束，
  不需要两边同步。
- Docker / 容器方式（**卡片已整卡移除**，`ConnectionMethod` 里保留 `'docker'` 仅作保留值）。

---

## 2. 现有架构（复述）

### 2.1 三个运行时平面 × 三个 tsdown target

| 平面 | 跑在哪 | 代码 | 产物 |
|---|---|---|---|
| **host 行** | 本机 `dsh` 进程（`web` profile） | `src/index.ts`、`src/provision/**`、`src/ssh/**`、`src/targets/**`、`src/session-persistence/**`、`src/rsession/**` | host target：`index` / `connection` / `rsession` / `session-persistence` / `protocol` |
| **realm（执行世界）** | 本机进程内，每个 target 一个 `isolate` 域 | `src/preset/world.ts`、`src/connection/index.ts` | `connection` |
| **远端 server bundle** | 远端（ssh 主机 / WSL 发行版）内的 `dsh --profile <p>` | `src/server/**`、`src/frame/**`、`src/protocol.ts` | server target：`lib/server.js`（自包含） |
| 浏览器 | 用户的 Web 前端 | `src/client/**` | client target：CJS 工厂，走 `window.__ModuleLoader__` |

### 2.2 模块职责（一文件一行）

| 模块 | 职责 | 依赖 |
|---|---|---|
| `src/index.ts` | 插件主行：打开存储域、构造 `RemoteWorkspaces`、provide 路由持久层、注册 HTTP 路由与 SSE | `provision/service`、`targets/*`、`ssh-config`、`ssh/wsl`、`session-persistence/routing` |
| `src/provision/service.ts` | host 侧服务：连接票据、`runConnect`、浏览客户端缓存（per target 单 client + pin）、目录/工作区/会话读写、`forgetTarget`/`stopTarget`、`renameSession` | `provision/channel`、`targets/store`、`preset/world`、`session/open`、`ssh/hostkey` |
| `src/provision/channel.ts` | 五步流水线 `connect → probe → runtime → upload → start`；`openTransport` 是唯一区分 ssh / wsl 的地方 | `provision/transport`、`provision/deploy`、`provision/profile`、`provision/assets` |
| `src/provision/deploy.ts` | 纯脚本层：探测脚本、组件 marker 判定、node 解包脚本、dsh 包安装脚本、部署锁 | `provision/profile`（`shellQuote`）、`provision/assets`（类型） |
| `src/provision/assets.ts` | 宿主侧资产缓存（`~/.dsh/remote-assets`）+ `sourceOrder`/`resolveServerPackage` | `provision/package-build` |
| `src/provision/package-build.ts` | 把 `@deepseek-ai/dsh@<ver>` 暂存成一个目标平台的 tarball（原生依赖闭包修正） | 无（`node:` + 本地 exec） |
| `src/provision/profile.ts` | 生成远端 profile（`package.json`/`cordis.yml`/`cordis.patch.yml`）、插件文件集、启动命令 | `node:fs` |
| `src/provision/transport.ts` | `RemoteTransport` 抽象（`exec`/`writeFile`/`openChannel`/`close`），ssh 与 wsl 各一份实现 | `ssh/connect`、`ssh/wsl` |
| `src/ssh/connect.ts` | ssh2 连接 + host-key pin + exec/SFTP 上传 | `ssh/hostkey`、`targets/types`（凭据型别）、`provision/profile`（**仅类型 `RemoteFile`**，见 §2.3） |
| `src/ssh/wsl.ts` | `wsl.exe` 传输：发行版探测（UTF-16LE）、stdin 脚本（`sh -s`）、长驻通道、stdin 直传 | `targets/types`、`ssh/connect`（`ExecResult` 类型） |
| `src/ssh-config.ts` | 解析 `~/.ssh/config`（`Include`/`Match`/first-wins），`ssh -G` 解析 | 无（`node:` 内置） |
| `src/targets/types.ts` | 记录 schema（zod）、`PublicTarget`、`scrubSecrets`、`RemoteWorkspaceService` 接口 | `zod` |
| `src/targets/store.ts` | 存储域（`version: 1`）读写 + `ctx.credentials` 凭据接缝 | `targets/types`、`dsh-storage-domain`、`dsh-credentials` |
| `src/targets/methods.ts` | 平台 × 连接方式的纯谓词（host 与 client 共用） | 无 |
| `src/session-persistence/routing.ts` | 根平面 `sessionPersistence`：按 cwd 路由（本地 → 官方 JSONL；stub → 远端 `persist.*`），live 事件 writer | `rsession/remote-persistence`、`remoteWorkspaces` 服务 |
| `src/rsession/remote-persistence.ts` | `persist.*` 平面的 `SessionPersistence` 门面：header 重锚到本地 stub | `remoteWorkspaces` 服务 |
| `src/session/open.ts` | 用 `ctx.agents.create` / `resume` 组合远端会话（绕开 session-controller 的本地 mkdir） | `agentPresets`、`targets/types` |
| `src/preset/world.ts` | 每 target 一个 `isolate` realm preset（覆盖 `ssh/fs/subprocess/sandbox/shell`） | `agent-preset-registry` |
| `src/connection/index.ts` | realm 内的 `ctx.ssh` 实现（惰性）：`request` / `connectStream` / `dispose` + stub→remote 路径改写 | `remoteWorkspaces` 服务、`frame/*` |
| `src/client/*` | 左栏区域、面板、向导、三层走树、行内动词、store、locales | `client/api.ts`、`targets/methods`（纯谓词）、平台模块表 |
| `src/client/common.tsx` | 共享的 UI 原子：`Field` / `ErrorBanner` / `EmptyState` / `LoadingLine` / `NoticeToastHost` / **`useSingleHost`**（toast 与对话框的「第一个挂载者拥有」单实例保证） | `client/locales.ts`、平台模块表 |
| `src/client/method-cards.ts` | 第 1 步的方式卡集合：`offeredMethods(platform)` 用 host 同一个 `methodAvailable` 谓词过滤（ssh 恒有 / wsl 仅 win32 / docker 恒无）；`OfferedMethod = Exclude<ConnectionMethod, 'docker'>` | `targets/methods.ts`（**纯谓词，客户端可依赖**） |

> **`useSingleHost`（Leader 裁决 2026-10-18）**：同一类悬浮物（toast、以及即将新增的浏览/重命名弹窗）
> 在**左栏区域 + 面板**两个宿主同时存在时，只允许一个实例渲染——这是既有的 `NoticeToastHost`
> 「第一个挂载者拥有」规则。本轮新增的 `directory-picker` / `WorkspaceRenameDialog` 必须走同一个
> 单实例保证（`common.tsx::useSingleHost`），否则「双挂」缺陷会在弹窗上更显眼（面板与左栏各弹一个）。

### 2.3 依赖方向（禁止循环）

```
targets/types.ts  ── targets/methods.ts                 （叶子：zod / 纯函数）
      ▲
targets/store.ts ──┐
      ▲            │
ssh/hostkey.ts     │
      ▲            │
ssh/connect.ts ────┤            ssh/wsl.ts
      ▲            │                ▲
provision/transport.ts ───────────────┘
      ▲
provision/deploy.ts ── provision/profile.ts ── provision/package-build.ts
      ▲                        ▲                    ▲
provision/assets.ts ───────────┴────────────────────┘
      ▲
provision/channel.ts
      ▲
provision/service.ts  ── session/open.ts、preset/world.ts
      ▲
index.ts（HTTP 路由表）
      ▲
client/api.ts → client/store.ts → client/*.tsx（**绝不 import host 模块**，
                                      只允许 `targets/methods.ts` 这种纯谓词）
```

**唯一现存的反向边（本轮修掉）**：`src/ssh/connect.ts:12` 以 `import type { RemoteFile } from '../provision/profile.ts'`
反向依赖了 provision 层。虽然 `import type` 在 `verbatimModuleSyntax` 下一定被擦除、运行时无环，
但它让「ssh 不知道 provision」这条边界失真。**处置**：把 `RemoteFile` 移到 `targets/types.ts`
（机械移动，`provision/profile.ts` 改为 re-export 保持既有 import 不变）。改完后 ssh 层只依赖
`targets/**` 与 `ssh/hostkey.ts`。

**新增模块的依赖约束**（本轮）：

```
provision/version-range.ts   叶子（纯函数，无 import）
        ▲
provision/dsh-scan.ts        叶子（拼脚本 + 解析，只 import version-range + provision/profile 的 shellQuote）
        ▲
provision/plan.ts            只允许 import 上述两处 + `import type` 自 deploy/assets/types
        ▲
provision/channel.ts         计划的使用者（真正的执行者）
```

`dsh-scan.ts` / `plan.ts` **不得** import `ssh2`、`transport.ts` 或 `service.ts`，保证它们是可在
vitest 里零 I/O 单测的纯模块（与 `deploy.parseProbeOutput` 的既有做法一致）。

### 2.4 数据流：host 行 → realm `ctx.ssh` → 单条传输 → 远端 server bundle

```
浏览器
  │ POST /dsh-remote-workspace/api/connect/start → {ticket}
  │ GET  /dsh-remote-workspace/stream/connect?ticket=… （SSE 进度 + host-key + done/error）
  ▼
index.ts dispatchApi ──► RemoteWorkspaces.runConnect
                            │  provisionTarget()
                            │    openTransport ── ssh2（host-key pin）/ wsl.exe -d <distro> -- true
                            │    provisionOver
                            │      probe    → $HOME / uname / ostype / ldd / 组件 marker
                            │      runtime  → 上传 node tarball（marker 命中则跳过）
                            │      upload   → 上传 dsh 包 + profile + 插件文件集（sha256 marker）
                            │      start    → transport.openChannel(serverCommand) → RemoteChannel
                            ▼
                        channels.set(targetId, channel)   ← 每 target 唯一的一条字节流
                            │
                        browserFor(targetId) → RemoteClient（FrameMux + SshRpcPeer + heartbeat 10s）
                            ├── 浏览面：fs.list / reg.list / persist.list|titles|rename / connect 探测
                            └── remoteClient(targetId) + pin() ──► realm 的 ctx.ssh
                                                                     │
  会话打开（open-session / 新会话）──► ctx.agents.create|resume ──► preset mount（realm）
       │                                                              │
       │                                    官方 dsh-fs-ssh / dsh-subprocess-ssh / dsh-sandbox-ssh
       │                                                              │  request() → RemoteClient
       ▼                                                              ▼
  sessionPersistence = RoutingSessionPersistence ──按 header.cwd 路由──► 远端 server 的 persist.*
  （本地 cwd → 官方 JSONL；stub cwd → persist.* 平面）
```

三条不能破的实测约束（详见 `AGENTS.md`）：

1. **每 target 只有一个远端 server 进程**：`persist.create` 返回内存句柄，日志要 flush 才落盘，
   第二个 server 进程答 `session "…" not found`。所以浏览与 realm 共用同一 `RemoteClient`，
   `RemoteClient.close()` 只丢自己的 peer，绝不 `mux.close()`（那是传输层拆除）。
2. **远端会话的 header cwd 永远是本地 stub**（`rsession/remote-persistence.ts` 三个出口重锚）；
   远端路径只出现在 `connection/index.ts:153 translateWorkspaceAliases` 的 stub→remote 改写处。
3. **`hello` 形状是 `$strict`**：远端 server 发 `kind:'node-script'` + `executable`，
   发旧形状会在 `.parse` 直接抛。

### 2.5 记录存储

- `TargetStore`（`src/targets/store.ts`）开一个存储域 `dsh_remote_workspace`，**`version: 1` 恒定**
  （`store.ts:35`），两张表 `targets` / `workspaces` + 一个 global（包来源策略）。
- 单文件布局**没有迁移**：bump 版本即砖。**新字段只能是 additive optional**，旧文档必须在当前
  schema 下原样通过（`pinnedSessions` / `archivedSessions` 就是这么加的）。
- 凭据：记录里只有 `credentialKey` 这一条引用，值在 `ctx.credentials`；`PublicTarget` 只暴露
  `hasStoredSecret: boolean`（`service.ts:1244`）。任何错误/日志一律过 `scrubSecrets`
  （`targets/types.ts:336`）。
- 远端工作区在**本地 shell 的工作区树**里靠一个 stub 目录占位
  （`service.ts:1062-1092`：`~/.dsh/remote-workspaces/<targetId>/<sha1(targetId,path)>`），
  官方 workspace 只认 `realpath(cwd) === workspace.path`，这是远端路径能进 shell 树的唯一办法。

### 2.6 路由持久层（远端权威）

`apply()` 里构造 `RoutingSessionPersistence` 并 provide 为 `sessionPersistence`；官方
`session-persistence-jsonl` 行在本 bundle 的 `cordis.patch.yml` 里 `disabled: true`（文档化偏差 d13），
启动时自检 `routingMarker`（`index.ts:524-527`）。远程会话的可观测证据在远端
`~/.dsh/remote-server-sessions/<projectKey(远端路径)>/<sessionId>/`，本地 `~/.dsh/sessions/` 不应出现该会话。

### 2.7 HTTP 面

- 前缀 `/dsh-remote-workspace`；命令一律 `POST /api/<name>`（名字**允许含斜杠**，如 `connect/start`），
  响应信封 `{ ok: true, value }` / `{ ok: false, error: { code, message } }`。
- 每个请求先过 `trustedRequest`（`index.ts:128`：loopback/trustedHosts + `sec-fetch-site` +
  origin 同源），body ≤ 1 MiB（`index.ts:63`），错误消息过 `scrubSecrets`。
- 进度走 SSE（`/stream/connect?ticket=`）：帧 `step` / `host-key` / `done` / `error`。

### 2.8 远端沙箱的兜底契约（实测 alpha55，最容易写错的一处）

`dsh-sandbox-ssh` 只把 `request('sandbox', { argv, policy })` 转发到远端，真正的 `confine()`
在**远端 server 里**执行。WSL 的 Ubuntu 既没有 bubblewrap 也没有 Landlock，因此远端世界里
「没有可用 sandbox 后端」是常态，兜底策略是**原样执行 argv**（远端世界本身就是隔离边界）。

**但返回值必须是官方 facts 对象，不能是裸 argv**（`src/server/controller.ts:100-128`）：

```ts
// 远端 server（controller.ts）的兜底分支
return { argv: [...argv], enforcement: 'partial', denialSignatures: [], runnerFailureRules: [] }
```

| 点 | 结论 |
|---|---|
| 形状 | `@deepseek-ai/dsh-sandbox-ssh::confine()` 用 **strict** schema 校验远端返回 `{ argv, enforcement: 'full'\|'partial', denialSignatures: string[], runnerFailureRules: [...] }` |
| alpha48–54 的 bug | 兜底 `return input.argv` 是**裸字符串数组** → 客户端 `.parse` 拒绝 → 被 `catch` 包成 `SandboxUnavailableError` |
| 用户看到的现象 | `sandbox mode "workspace-write" … no sandbox backend is usable on this host … (Linux)…(macOS)…(Windows) … Runner failure: [` —— 那句是 `SandboxUnavailableError` 的**通用模板**（同时列三种平台，与真实平台无关，极易误读成「本机 Windows 沙箱被调用了」），`Runner failure:` 后面孤零零的 `[` 就是裸数组 / zod `issues` 的开头 |
| 为什么 `partial` | 没有任何 backend 真正约束过 argv，声称 `full` 是失败方向错误 |
| **验证纪律** | 必须用**官方 strict schema** 校验该 RPC；**不许用 `z.unknown()`**——alpha48–50 的「验证通过」正是被 `z.unknown()` 放过去的（拿到裸数组也不报错），于是这个 bug 活到 alpha55 才被浏览器 E2E 抓到 |

---

## 3. 本轮架构变更

### 3.1 新增模块（为什么放在 provision/）

| 新模块 | 内容 | 为什么在这个位置 |
|---|---|---|
| `src/provision/version-range.ts` | 版本解析 + 比较 + 兼容判定（`>=0.2.1-rc.2 <0.3.0`） | 纯函数，host 专用；**不引入 `semver` 依赖**（peer 区间是一个常量，用 30 行实现即可，避免动 `dependencies` 与锁文件） |
| `src/provision/dsh-scan.ts` | 「扫描远端已装 dsh」脚本 + 解析器 + 候选类型 | 与 `deploy.ts`（脚本层）、`ssh-config.ts`（解析层）同构：**只拼脚本、只解析文本**，零 I/O，可单测 |
| `src/provision/plan.ts` | `planProvision()`：把「目标记录 + probe 事实 + 扫描结果 + 策略」判定成 `ProvisionPlan`（reuse 还是打包、跳过哪些 stage） | 判定必须可单测、可解释（QA 要能说清为什么走了 reuse），且 `channel.ts` 里不再长出 if 森林 |

它们都在 **host 平面**，不碰 client bundle（纯度门禁无关），也不碰 `src/server/**`。

### 3.2 五步流水线如何与「复用」合并（结论）

**不新增 stage。** `ProvisionStep`（`channel.ts:56`）是 **wire 契约**（SSE `step` 帧 + 客户端
`asConnectFrame` 白名单，`api.ts:418`），改它要同时改枚举、客户端进度表与隐藏逻辑，收益只是多一行
UI。「跳过」这件事本来就有先例：`runtime` 在 marker 命中时也会跳过，但行照样是 `ok`。

合并后的流水线（reuse 分支）：

```
connect  ── 不变
probe    ── 不变（home / platform / arch / libc / 组件 marker）
[plan]   ── 纯判定：reuse | package（不 emit）
reuse?   ├─ 是：校验用户选中的 launcher（`<launcher> --version` + 版本区间 + 是否已有本插件）
         │      · 通过 → runtime 直接 ok，消息「复用远端 dsh <ver>（跳过 Node 与 dsh 部署）」
         │      · 失败 → 抛错（错误码见 api-contract），**绝不静默改走上传**
         └─ 否：runtime（按需部署 Node）→ upload 的 **dsh 包那一半**
upload   ── profile + 插件文件集（两条路都要跑；marker 命中则跳过）
start    ── reuse 用 `PATH="<nodeDir>:<launcherDir>:$PATH" exec <launcher> --profile <p>`
            （**不是** `node <launcher>`：实测部署 launcher 是 `/bin/sh` 包装脚本，ADR A19）；
            打包用 `~/.dsh/server/dsh/node_modules/.bin/dsh`
```

三个关键决定与理由：

1. **reuse 失败不回退到打包上传**。25–50 MB 的包不能因为一次版本不匹配就静默上载（用户的网络/配额
   与等待时间都不是我们的）。错误消息给出明确出路：**Leader 裁决 4（2026-10-18）**——失败提示里带一个
   **「改用上传 server 包并重试」按钮**（用户点一下才切换 `packageSource: 'upload'` 重跑同一份草稿），
   但**绝不自动改走上传**。`auto` / `download` 策略内部的 cache→download→build 回退链保持不变。
2. **reuse 仍然跑 probe**。`home` 决定 `DSH_HOME` 展开与部署锁路径；`platform/arch/libc` 决定
   「如果用户之后切回上传，需要哪个包」。probe 是权威事实，**记录里的缓存值只当提示**
   （它可能是另一台机器/旧版本留下的）。
3. **reuse 也需要 install 插件**：`upload` 阶段把 `<DSH_HOME>/profiles/<profile>/` 写成
   `package.json` + `cordis.yml` + `cordis.patch.yml` + `pnpm-workspace.yaml` +
   `node_modules/dsh-remote-workspace/**`（`profile.remoteProfileFiles` + `profile.packageFiles`，
   现有函数原样复用）。这就是需求里的「自动安装插件」——**全程不访问远端包管理器、不需要远端网络**，
   字节来自本机缓存/本机构建。marker 写 `<profileDir>/.dsh-rw-plugin.json`（见 §3.7）。

为什么复用是对的：远端只需要一个**能跑 dsh 的 Node + 一份 dsh 安装**。用户机器上已装 dsh 时，
再传一个 25–50 MB 的自带 Node + dsh 是纯浪费；而 `DSH_HOME` 默认都是 `~/.dsh`，所以
**会话存储位置与 dsh 安装路径无关**，打包↔复用互换不会丢历史会话（`remote-server-sessions` 仍在
`~/.dsh/remote-server-sessions`）。

### 3.3 「连接方式三选一」的落点

- 语义载体是 **`ConnectRequest.packageSource`**（`service.ts:70`）：现有 `auto|download|upload`，
  新增 `'reuse'`；reuse 额外携带 `reuseLauncherPath`。**不新造一个并行的 mode 概念**
  （两个概念会立刻出现「packageSource 与 mode 冲突」的问题）。
- 全局策略 `PackagePolicySettings.policy`（`auto|download|upload|ask`）**不加 `reuse`**：
  「复用哪台机器上的哪个 dsh」是本机事实，不可能做成全局默认。
- 架构探测（需求 2b 的「先探测远端需要什么架构的包」）：**探测能力已存在**
  （`deploy.probeScript` + `parseProbeOutput`，含 `uname -m`、`/proc/sys/kernel/ostype`、`ldd`），
  缺的是「连接前就能看到」。做法：新增**连接前只读探测路由 `dsh-scan`**，一次返回
  「架构 / 包名 / 本地缓存是否命中 + 候选 dsh 列表」（同一条 throwaway 传输，见 api-contract §3.1）。
  流水线仍然自己 probe 一次（权威）。

### 3.4 向导三步化，`directory` 步骤去哪里（结论）

`WizardStep` 从 `'method' | 'config' | 'connecting' | 'directory'`（`store.ts:30`）收敛为
**`'method' | 'config' | 'connect'`**：

| 步骤 | 内容 |
|---|---|
| ① `method` | 连接方式卡片：**只有 ssh / wsl 两张**（见下） |
| ② `config` | 对应配置（ssh 读 `~/.ssh/config`；wsl 读已装发行版）——不变 |
| ③ `connect` | **连接方式三选一卡片** + （复用时的）扫描结果列表 + 进度行 + 连接日志 + host-key 面板 |

**第 1 步的方式卡（实现已定稿，2026-10-18）**：

- **docker 卡整卡移除**（不是置灰、不是 teaser）：卡片集合由
  `src/client/method-cards.ts::offeredMethods(platform)` 产出，内部用的就是 host 侧同一个
  `methodAvailable` 谓词（`targets/methods.ts`），所以「客户端渲染」与「host 校验」永远同源：
  `ssh` 恒有，`wsl` 仅 `win32`，`docker` 恒无。
- `ConnectionMethod` 类型里**仍保留 `'docker'`** 作为保留值（`method-cards.ts:25` 的
  `OfferedMethod = Exclude<ConnectionMethod, 'docker'>`），host 侧的 `methodAvailable` 也仍然
  拒绝它 —— 保留值是为了将来加回时不必改协议面，**不代表**它有 UI 入口。

`directory` 不再是向导步骤。浏览远端目录成为 **`AddWorkspaceDialog` 的默认页签**：

- 一个宿主（挂在 `RemoteTree` 上，沿用「对话框挂在树上」这条踩过两次的不变量），两个页签：
  **浏览目录**（默认）/ **远端已注册**（现有 `reg.list` 列表）。原来是「注册表列表 + 一个浏览逃生口」，
  现在反过来，因为需求 5 要的是浏览。
- 浏览 UI 从 `wizard.tsx::DirectoryStep`（`wizard.tsx:632-765`）**抽成 `src/client/directory-picker.tsx`**，
  `DirectoryState`（`store.ts:112`）留在 store 里不动（只加一个 `open` 标记）。
- 目标未连接时：弹窗内先走 `api.connect(targetId)`，`directory.connecting` 已经是现成的「连接中」显示。
  因此 `ConnectState.origin: 'directory'`、`openTargetDirectory`、`retryDirectoryConnect`
  三个为「向导里浏览目录」而存在的概念一起退役。
- **连接成功的落点（Leader 裁决 1，2026-10-18）**：SSE `done` 帧后**不自动打开**「添加工作区」弹窗。
  改为：回到列表视图 → 展开该连接节点（`targetNodeKey`）→ 成功 toast 引导「点『添加工作区』」。
  理由：浏览目录会触发远端目录读取（未连接时甚至要建通道），不该由一次「连接成功」替用户决定；
  需求 5 把浏览挂在行按钮上，落点必须与它一致。
- **兼容性**：向导状态全在内存（`store.ts` 模块级 state），没有持久化、没有 URL、没有跨设备共享，
  所以**不需要兼容层**；需要兼容的只有「旧远端 server bundle」（缺 `persist.titles` 已有降级先例）
  与 SSE 帧白名单（本轮的 reuse 通过 **消息** 表达，帧形状不变）。

### 3.5 「删除连接」的语义（结论）

措辞：`tree.forgetConnection` 的文案从「忘记连接」改为「**删除连接**」（`locales.ts:109`），
确认弹窗标题/正文同步改。**动作实现不变**（`store.requestForgetTarget` → `api.forgetTarget`
→ `RemoteWorkspaces.forgetTarget`，`service.ts:403`），只改用户可见语义。

**Leader 裁决 3（2026-10-18）**：确认正文必须**逐项**写明「会删什么 / 不会删什么」——
会删：本机记录、已保存的凭据、该连接下的 N 个远程工作区记录、它们的本地锚点目录与 shell 工作区条目；
不会删：远端 `~/.dsh/server` 部署物、远端 `~/.dsh/remote-server-sessions` 会话日志、远端 profile。
表如下（正文按「删」列 + 「不删」列各写一句，不允许只写「将删除本机记录」）：

| 对象 | 删除连接时 | 理由 |
|---|---|---|
| 目标记录 + 存储的凭据 | **删** | 现有行为 |
| 预注册的 agent preset | **删** | 现有行为（否则残留一个不可用的 preset） |
| 通道 / 浏览客户端 | **关** | 现有行为 |
| 本地工作区记录 + stub 目录 + shell 工作区条目 | **删** | 现有行为（`service.ts:418` 用 `forgetWorkspace` 而不是 `deleteWorkspace`，否则侧栏会留孤儿文件夹行） |
| 远端会话日志 `~/.dsh/remote-server-sessions/**` | **不删** | 数据是用户在远端的资产；换设备/换 dsh 安装方式后还要继续聊。删了不可恢复 |
| 远端部署物 `~/.dsh/server/**`（打包模式的 Node+dsh） | **不删** | 它是**共享安装**：同一台机器的第二次连接、别的设备、别的 profile 都可能复用；半删会留下坏依赖树 |
| 远端 workspace 索引（`workspaces.json` 里 `reg.create` 的路径条目） | **不删**（已知残留） | 删它需要远端新增 `reg.delete` RPC → 触碰 `src/server/**` 与两仓库同步，本轮明确不做；残留只是路径记录，无害 |
| 远端 profile `~/.dsh/profiles/<profile>/` | **不删** | 同上（重连即可复用；删了下次要重传插件） |

「移除工作区」同理：只删本地记录 + stub + shell 条目，不动远端目录、不动远端会话（`locales.ts:113` 已写明）。

### 3.6 「重命名工作区」落在哪里（结论）

- **落点**：工作区行 `⋮` 的 `rename` 槽（`tree.tsx:94` 现在是「刷新会话列表」）改为
  **「重命名工作区」**；`delete.workspace` 槽保持「移除工作区」。
- **数据落点**：只改**插件自己的记录** `RemoteWorkspaceRecord.title`（新增路由 `workspace-rename`），
  外加（best effort）官方 shell 工作区的显示名，**绝不改远端目录名**。
  理由：
  1. 官方 shell 自己的「重命名工作区」也只改标题不改目录（用户预期一致）；
  2. 远端会话日志的 header cwd 是**远端权威**、已经写进远端日志；改目录名会让这些会话的路径失效，
     还会让远端 `workspaces.json` 里的旧路径条目指向不存在的目录；
  3. 远端 `mv` 是不可逆的文件系统操作，跨网络执行没有回滚故事，失败会留下半改状态。
  4. 我们自己的 shell 行是**被隐藏**的（`store.ts:watchShellRows` + `styles.ts` 的 `display:none`），
     官方工作区标题就算没同步也看不见，不会造成用户可见的不一致。
- **取舍（Leader 裁决 2，2026-10-18：已采纳）**：`刷新会话列表` 从工作区行菜单里消失。`ProjectRowItem`
  的菜单**固定只有两项**（`vendor/workspace-rows/generated/Rows.tsx:245-246`，`rename` / `delete`），
  第三项无处可放；而「不自己画行样式、不改 vendored 组件」是硬约束。会话列表本身在展开时重读、每个动词后
  重读（`store.refreshSessionsFor`），刷新缺口的实际影响很小；面板的 `刷新` 仍在。
- **远端 registry 标题不同步（Leader 裁决 5，2026-10-18）**：`reg.list` 返回的标题保持创建时的值，
  记为**已知缺口**（见 §1 非目标与下表），修它需要 `reg.rename` RPC（触碰 server 代码），本轮不做。

**本轮产生的已知缺口（随裁决进文档，QA 不按缺口判失败）**：

| 缺口 | 来源 | 影响 | 后续 |
|---|---|---|---|
| 工作区行不再有「刷新会话列表」 | 裁决 2 | 官方行菜单只有 `rename` / `delete.workspace` 两个固定 key，「重命名工作区」占了 `rename`；列表改在展开与每个动词后自动重读 | 若用户反馈强烈，下一轮给面板加「按工作区刷新」入口 |
| 远端 registry 标题与本地 `title` 不一致 | 裁决 5 | 重命名只改插件记录 `title`（绝不 `mv` 远端目录）；远端 `reg.list` 仍返回旧标题，添加工作区弹窗「远端已注册」页签显示旧标题 | 需要 `reg.rename` RPC（含两仓库同步） |
| 删除连接不清理远端部署物/会话/索引 | 裁决 3 | 远端残留 `~/.dsh/server`、`workspaces.json` 条目 | 需要 `reg.delete` + 显式「清理远端」动作 |
| **shell 侧 `uiSession.bindingSource` 在记录非 live 时抛错，且 render 无 error boundary** | alpha54 白屏事故（验收后发现） | 这是「断开→重连整页白屏」的**底层原因**。我们已在其前用官方 `uiWorkspace.clearMain()` 取消选中来回避（断开/删除/掉线路径），但**右栏若仍留着该会话的 dock 页签**（`SidebarSessionViews.prune()` 保留 `hasRetainedTabs`）仍可能触发同一路径 | 彻底修复需要 shell 侧回落到 absent projection + error boundary（**不是**本仓库能改的） |

### 3.7 记录字段与存储域（结论）

`REMOTE_DOMAIN.version` **恒为 1**；本轮只在 `targetRecordSchema` 上加 **additive optional**：

| 字段 | 形状 | 用途 |
|---|---|---|
| `packageSource` | 枚举**加宽**为 `'auto' \| 'download' \| 'upload' \| 'reuse'` | 记忆本目标的连接方式 |
| `reuseDsh` | `{ path, version, nodePath?, scannedAt }` | 记忆用户选中的那台 dsh，下次预选 |
| `platformProbe` | `{ platform, arch, libc, tag, probedAt }` | 上次探测到的架构（**提示**，不参与正确性） |
| `serverPackage` | `{ artifact, sha256, version }` | 上次真正部署/复用的包（调试与 UI 徽标） |

`RemoteWorkspaceRecord` **不加字段**（`title` 已存在）。

远端 profile 的插件 marker（**两条路径并存**，ADR A20 / api-contract §9.2）：

| marker | 写入者 | 用途 / 权威性 |
|---|---|---|
| `<DSH_HOME>/profiles/<profile>/.dsh-rw-plugin.json`（`{ id, sha256, version, profile }`） | **两条路径都写** | 扫描据此判断 `profile.upToDate`（复用路径唯一的 marker） |
| `<installHome>/.dsh/server/.components/plugin.json` | 只有打包路径写（`channel.ts:385-388`；`probeScript` 读） | **`decidePlugin` 的判据**：打包路径要不要重传插件，仍以它为准 |

- probe / scan 两处 marker 都读，缺失任何一个都不算失败（旧部署没有 profile-local 的那份）。
- 部署锁：打包模式沿用 `~/.dsh/server/.deploy.lock`；复用模式用
  `<DSH_HOME>/profiles/<profile>/.dsh-rw.lock`（`mkdir` 原子 test-and-set，语义同现有实现）。

### 3.8 本轮**不**改的东西（硬边界）

- `src/protocol.ts`、`src/server/**`、`src/frame/**`：**本轮例外只有一处** ——
  `src/server/controller.ts` 的 sandbox 兜底返回值改成官方 facts 对象（见 §2.8，alpha55 修）。
  该改动**已与兄弟仓库同步**：复核 8 个文件（`protocol.ts` + 4 server + 3 frame）逐字节相同
  （2026-10-18 `Get-FileHash` 复核，`protocol.ts` sha256 `53B53EE3…452C6`）。
  除此之外三处一律不动 —— 任何新需求都不该让它们再变。
- 官方 `cordis.patch.yml` 已有行一条不动（新增行只允许 additive，本轮连新增都不需要）。
- 官方行层 vendored 代码：不动（重命名工作区靠改译文/回调，不靠改组件）。
- 全局服务：不替换（`sessionPersistence` 的 provide 是既有文档化偏差 d13，本轮不扩大）。
- 不新增 npm 依赖（不引入 `semver`；`zod` 继续钉 `4.4.3`）。

### 3.9 `realm-unavailable` 守卫（本轮新增，alpha54 安全事故的防线）

**行为契约（最重要的一条）**：远端工作区的会话**绝不允许**在 realm 没挂上时静默回落到本地执行世界
去跑命令。alpha54 实测过这个安全事故：preset 未挂载时模型手里只有 `pwsh`、cwd 是本地 stub、
**本机真的写出了 proof 文件**——用户以为在远端跑，实际在本地跑。

三个守卫都在 `src/provision/service.ts`，**接在任何副作用之前**（建通道/stub/会话之前）：

| 守卫 | 位置 | 拒绝条件 |
|---|---|---|
| `assertRemoteRealm(ctx, targetId)`（`service.ts:1611`） | `openWorkspace`（`:1170`）与 `resumeSessionOnce`（`:1233`）**入口** | ① `agentPresets` 服务不可用；② 预设未注册（`resolve` 抛错）；③ 解析出的 id **不等于** `remote:<targetId>`；④ `resolved.broken` 有诊断 |
| `assertLiveSessionInRealm(ctx, targetId, sessionId)`（`:1646`） | `resumeSessionOnce`（`:1234`），在 resume 之前 | 会话记录存在但**不 live**，不能安全接管 |
| `assertRealmComposed(ctx, targetId, sessionId)`（`:1665`） | `openWorkspace`（`:1188`）与 `resumeSessionOnce`（`:1239`），在会话创建/resume **之后** | 会话虽建好，但它的 realm 没有真正组合起来 |

- 错误码统一 `realm-unavailable`（HTTP 500；见 api-contract §10），消息必须含
  **targetId + 预设 id + 原始原因**，例如
  `remote workspace "rt-xxxx": preset "remote:rt-xxxx" is not registered (<原始错误>); reconnect the target so its execution world is restored`。
- 为什么三条而不是一条：入口守卫挡「根本没注册」，live 守卫挡「记录在但进程已丢」，
  composed 守卫挡「建好了但 realm 没挂」——三条对应三种不同的失败面，合并会漏。
- QA 口径：断开后立刻点会话行必须得到 `realm-unavailable`（不是白屏、也不是本地执行），
  且本机不出现任何由该会话写出的文件。

---

## 4. 硬约束（写进实现，QA 可逐条验）

1. **凭据绝不过线**：SSH 密码/私钥/模型 key 只在本地；`secret` 只出现在 `/api/connect/start`（以及新增
   `/api/dsh-scan`）的 JSON body 里，永不进 URL、永不进记录、永不进日志；错误与日志一律过 `scrubSecrets`。
2. **未知 host key 必须显式确认**：ssh 首次连接展示 SHA-256 指纹等用户确认，已变更的 key 一律中止
   （`ssh/hostkey.ts`）；**WSL 无 host key，指纹恒为 `''`**，连接流程必须 kind-aware（现有
   `service.runConnect` 已有这条分支，新增的 `dsh-scan` 必须照抄同一套）。
3. **所有插件 HTTP 路由过 `trustedRequest`**，JSON body ≤ **1 MiB**，错误 `message` 过 `scrubSecrets`。
4. **零 patch**：不改官方 `cordis.patch.yml` 已有行、不替换全局服务、官方「添加工作区」按钮行为不变、
   左栏区域不占用 `sidebar.workspaces` 槽位。
5. **存储域版本恒为 1**，新字段 additive optional（见 §3.7）。
6. **`src/protocol.ts` / `src/server/**` / `src/frame/**` 与兄弟仓库逐字节相同**；改任一处必须两边同步。
   本轮唯一改动是 `src/server/controller.ts` 的 sandbox 兜底 facts 对象（§2.8），已同步并复核 8 文件相同。
7. **不自己画行样式**：行是内置的官方组件；能改的只有传给它的译文与回调。
8. **多行脚本一律走 stdin**：WSL 上的多行脚本必须经 `wsl -d <d> -- /bin/sh -s` + stdin
   （`wsl.ts:93 wslScriptArgs`），**不许塞进 argv**（实测丢行、被默认 shell 捡去执行）。
   新增的扫描脚本必须遵守：ssh 侧 `sh -c`、wsl 侧天然走 `sh -s`（`transport.exec` 已经分流）。
   **并且脚本必须是 LF 行尾**：经 stdin 交给 `sh -s` 时 CRLF 的 `\r` 会被并进命令名
   （实测症状 `/bin/sh: echo: not found`）。脚本一律写在 TS 字符串字面量里（天然 LF），
   **禁止**从 Windows here-string / CRLF 文件读入后拼接；单测里断言脚本字符串不含 `\r`（api-contract §7.1）。
9. **一个 target 只能有一个远端 server 进程**：浏览面与 realm 共用 `RemoteClient` + `pin()`；
   不许为 `persist.*` 或新功能另开第二条 `wsl.exe`/ssh 通道。
10. **连接行必须惰性**：不可达主机不得在构造/render 时发起连接；扫描只能由用户显式动作触发。
11. **远端 `sandbox` 兜底必须返回官方 facts 对象**（`{ argv, enforcement:'partial', denialSignatures:[], runnerFailureRules:[] }`），
    禁止裸 argv；验证必须用官方 strict schema，禁止 `z.unknown()`（§2.8、A29）。
12. **realm 未挂上的远端会话绝不允许在本地执行世界跑命令**；三条守卫必须在任何副作用之前
    （§3.9、A30），失败一律 `realm-unavailable`。

---

## 5. 测试与验收资源（Leader 裁决，2026-10-18 更新）

| 用途 | 资源 | 状态与注意 |
|---|---|---|
| **WSL 路径的验收目标** | 本机 `Ubuntu-22.04` 发行版 | 已确认存在 `~/.dsh/server/{dsh,node,staging}` 与 `~/.dsh/profiles/dsh-remote-server/.dsh-rw-plugin.json`（即**打包路径已部署过**）。因此这台既是「上传包」的现成目标，也是「复用刚部署实例」的现成用例（见 api-contract §2.3/§7.2 的 PATH 前缀纠正）。WSL 无 host key，指纹恒 `''`。 |
| **SSH 路径的验收目标** | **真实主机 `graydove@192.168.10.210:22`**，**密码认证** | 登录后即一台 WSL（发行版由 `uname -a` 确认）。`~/.ssh/config` 的别名读取由 QA 自行加一条别名指向该主机来验证；首次连接必然触发未知指纹确认。密码只出现在 `/api/connect/start`、`/api/dsh-scan` 的 body，**不得进报告/截图**。 |
| 复用方式的「不兼容」负例 | 同上主机：`PATH` 指向打印 `0.1.9` 的假启动器，或装一个旧版 dsh | 用于验证 `dsh-incompatible` 错误码与「改用上传 server 包并重试」按钮（裁决 4），并证明**没有自动开始上传**。 |
| host-key 未确认的正例 | 上述主机的 host key 对本机是**新的**，首次连接必触发 | 正好覆盖硬约束 2 与 `dsh-scan` 的 `stage:'host-key'`；确认后指纹进内存 `state.trusted`，重测需重启 `dsh web`。 |

QA 取证仍按 `doc/acceptance-gap.md` B 节与 E 节；两条传输路径（WSL / 真实 SSH 主机）都要跑一遍。

> 已作废：「Ubuntu-22.04 内自建用户态 sshd 夹具 + `scripts/test-sshd.sh`」不再使用（脚本不存在，
> 2026-10-18 Leader 裁决）。

---

## 6. 变更记录

| # | 日期 | 变更 | 影响面 |
|---|---|---|---|
| v1 | 2026-10-18 | 建立 `doc/`：现有架构复述 + 本轮需求（三步向导、复用 dsh、上传包、添加工作区、删除连接、工作区重命名）的架构判定 | 决策 A1–A12：无 stage 变更；`WizardStep` 收敛；`directory` → 弹窗页签；`packageSource` 加宽；记录 4 个 optional 字段；ssh→provision 的类型回边取消 |
| v2 | 2026-10-18 | Leader 过闸（gate 3）：6 个问题的裁决全部采纳 + 1 条实测契约纠正 | 决策 A13–A18；新增 §5「测试与验收资源」；硬约束 8 补 LF 行尾；§3.4 连接成功落点、§3.5 确认文案逐项化、§3.6 已知缺口表；api-contract §2.3/§7.1/§7.2 同步 |
| v3 | 2026-10-18 | Developer A/B 契约偏差裁决回写 | 决策 A19–A26；§5 SSH 资源改真实主机（sshd 夹具作废）；§2.2 增 `common.tsx` / `useSingleHost` 职责；配套 api-contract §2.2/§2.3/§6/§8/§9.2/§12/§13 与 acceptance-gap 4.1、E 节 |
| v4 | 2026-10-18 | D-1 裁决 (b)：撤销 origin 降权；路由层 `reuse-launcher-missing` 口径 | 决策 A27–A28；api-contract §2.3/§3.1/§10/§12/§13 同步，acceptance-gap 新增 2a.9（路由必须透传 `reuseLauncherPath`） |
| v5 | 2026-10-18 | 冻结前最后一批实现回写 | 决策 A29–A32；新增 §2.8（远端 sandbox facts 契约）、§3.9（`realm-unavailable` 三守卫）；§3.3/§1 方式卡改「只有 ssh/wsl，docker 整卡移除」；§3.6 已知缺口补「`uiSession.bindingSource` 抛错 + 无 error boundary ⇒ 白屏根因，已用 `clearMain()` 回避」；§2.2 增 `method-cards.ts`；api-contract §10/§11 与 acceptance-gap 1.2/C 节同步 |

### 附：本轮决策清单（ADR 摘要）

| id | 决策 | 一句话理由 |
|---|---|---|
| A1 | reuse 判定放进纯模块 `provision/plan.ts` | 可单测、可解释，`channel.ts` 不涨 if |
| A2 | **不新增 `ProvisionStep`**，reuse 用 `runtime`/`upload` 的消息行表达 | 5 步是 wire 契约，多一行 UI 不值一次协议变更 |
| A3 | 扫描是**连接前只读**的普通 POST（`dsh-scan`），host-key 未确认时返回 `stage:'host-key'` | 复用向导已有的「信任后再连」语义，不落记录、不建通道 |
| A4 | 架构探测折进 `dsh-scan` 的返回里，流水线仍自己 probe | 一次传输拿全事实；记录里的 probe 只作提示 |
| A5 | 目录浏览变成 `AddWorkspaceDialog` 的默认页签 | 需求 5 要「行上点添加工作区再浏览」；对话框挂树上（踩过两次） |
| A6 | 删除连接 = 只删本地 + 凭据 + stub + shell 条目；远端部署物与会话日志保留 | 远端是共享安装与用户数据，删了不可恢复 |
| A7 | 工作区重命名 = 本地 `title`，绝不 `mv` 远端目录 | 远端是权威、`mv` 不可回滚、官方 shell 也只改标题 |
| A8 | `刷新会话列表` 退出工作区行菜单 | 官方行菜单只有两个固定 key，而重命名是需求 |
| A9 | `RemoteFile` 移到 `targets/types.ts` | 消掉 ssh→provision 的类型回边 |
| A10 | 记录只加 4 个 optional 字段，域版本仍 1 | 单文件布局无迁移，bump 即砖 |
| A11 | reuse 失败**不**自动改走上传 | 不能静默传 25–50 MB |
| A12 | 远端插件 marker 分两处（打包/复用），probe 同时读 | 两种安装布局共存，旧部署不需要迁移 |
| A13 | 连接成功后**不自动弹**添加工作区（回列表 + 展开 + toast） | 浏览会触发远端目录读取，不该由一次「连接成功」替用户决定 |
| A14 | 接受 `刷新会话列表` 退出工作区行菜单 | 官方行菜单固定两项，重命名是验收项；列表会自读 |
| A15 | 删除连接的确认正文**逐项**写「删什么/不删什么」 | 用户必须能预期远端不会被清理 |
| A16 | reuse 失败给「改用上传 server 包并重试」按钮，但不自动回退 | 把选择权交给用户，同时不放行静默大文件传输 |
| A17 | 工作区重命名不同步远端 registry 标题（进已知缺口） | 需要 `reg.rename` → 触碰 server 代码与两仓库同步 |
| A18 | 复用候选的 `nodePath` 必须认 `$DSHHOME/server/node/bin/node`，扫描 PATH 前缀必须含它 | 实测：部署实例是 `/bin/sh` 包装脚本 + 内部 `exec node`，不带这个前缀会 `exit 127` 被误判不兼容 |
| A19 | 复用启动命令一律 `DSH_HOME=… PATH="<nodeDir>:<launcherDir>:$PATH" exec <launcher> --profile <p>`，**不用** `node <launcher>`；`selfContained` 时省略 PATH 前缀 | 实测部署 launcher 是 `/bin/sh` 包装脚本（末行 `exec node`），`node <launcher>` 跑不起来；PATH 前缀同时覆盖两种形状 |
| A20 | 插件 marker **两处并存**：`<profileDir>/.dsh-rw-plugin.json`（两条路径都写）+ `.components/plugin.json`（仅上传路径写，**`decidePlugin` 的权威**） | 复用路径没有 `.components/` 树；上传路径的「要不要重传」必须仍由原判据决定 |
| A21 | `0.3.0-rc.1` **属于兼容** | npm semver：预发布段 < 同号正式版，故 `0.3.0-rc.1 < 0.3.0`（落在 `[0.2.1-rc.2, 0.3.0)`） |
| A22 | 候选装配函数命名 `assembleCandidates()` | Leader 已确认；职责单一（scan → 带 profile 与排序的候选） |
| A23 | 扫描**不 pin** 指纹；确认后指纹进内存 `state.trusted`，`connect/start` 复用它**不二次弹窗**，pin 只在连接成功时发生 | 扫描是只读探路，不该产生持久信任；又不能让用户两次确认同一台机器 |
| A24 | 草稿字段 `ConnectDraft.packageSource` 退役，第 3 步 `connectionMode` **独占** wire 字段 `packageSource` | 一份真相；旧的第 2 步选择器是双入口缺陷 |
| A25 | 所有弹窗（含新浏览弹窗、工作区重命名）必须 `useSingleHost(<kind>)`（`common.tsx:134`） | 左栏与面板同时挂载 `RemoteTree`，不接入就是双弹窗 |
| A26 | SSH 验收资源 = 真实主机 `graydove@192.168.10.210:22`（密码认证）；自建 sshd 夹具作废 | 夹具脚本不存在，QA 会找不到；真实主机还能顺带验 `~/.ssh/config` 别名与 host-key 确认 |
| A27 | **撤销**「部署实例排在 PATH 命中之后」与 `DshCandidate.origin`（Leader 裁决 (b)，2026-10-18） | 部署实例本身就是最可靠的复用候选（自带 node、插件状态可判）；`origin` 是纯展示冗余，会让 wire 契约变宽而无收益。排序 = `compatible && upToDate` → `compatible` → `path` |
| A28 | `reuse-launcher-missing` **在路由层**以 `400` 拒（`packageSource==='reuse'` 且 `reuseLauncherPath` 缺失/为空），plan 阶段同码只作兜底 | QA 实测 alpha51 的路由层没透传该字段；缺参必须同步拒，不能留到执行期才报 |
| A29 | 远端 `sandbox` 兜底**必须返回官方 facts 对象**（`{ argv, enforcement:'partial', denialSignatures:[], runnerFailureRules:[] }`），不是裸 argv；验证必须用官方 strict schema，**不许 `z.unknown()`** | alpha48–54 的裸数组被客户端 strict `.parse` 拒绝、包成 `SandboxUnavailableError`（用户看到与平台无关的通用模板 + `Runner failure: [`）；`z.unknown()` 正是让它活到 alpha55 的原因。`partial` 是诚实值：没有 backend 约束过 argv |
| A30 | 新增 `realm-unavailable` 三守卫（`assertRemoteRealm` / `assertLiveSessionInRealm` / `assertRealmComposed`），接线在 `openWorkspace`/`resumeSessionOnce` 的任何副作用之前 | alpha54 安全事故：realm 没挂时静默用本地执行世界跑命令（只有 pwsh、cwd 是 stub、本机写出 proof 文件）。宁可报错也不能假远端 |
| A31 | 第 1 步方式卡**只有 ssh / wsl**，docker 整卡移除；`ConnectionMethod` 保留 `'docker'` 作保留值 | 卡片由 `offeredMethods(platform)` 用 host 同一谓词过滤，杜绝「藏了但没拦」；保留类型值是为了将来加回不动协议面 |
| A32 | `serverPackage` 由 `provisionedHints()` **唯一生产**，`publicTarget` 带出且不含凭据 | 三个新增记录字段里只有它需要「谁写」的约束：多个写入点会让「上次部署的包」与「上次 probe」互相覆盖 |
