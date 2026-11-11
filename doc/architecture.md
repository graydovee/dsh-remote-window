# dsh-remote-workspace 架构（v1 背景文档）

> **v1 权威文档是 `doc/refactor-v1-architecture.md` 与 `doc/refactor-v1-protocol.md`。**
> 本文件是 v1 之前的架构历史（stdio 分帧 RPC、远程 execution world、P0 server 权威），
> **仅作背景，不再作为实现或验收契约**；v1 的 server 普通 DSH + per-client profile、双执行端、
> 同源 portal/iframe、registry 写守卫、P1/persist v1 等都以 refactor-v1-* 为准。
> 产品决定见 `doc/refactor-v1-requirements.md`；开发约束见 `AGENTS.md`。
>
> 当前数据位置速查（v1）：
>
> | 位置 | 内容 |
> |---|---|
> | server `~/.dsh/sessions/**` | 官方会话日志（两种执行端共用，权威） |
> | server `~/.dsh/storages/workspace.json` | 官方 workspace registry（权威，single layout） |
> | server `~/.dsh/profiles/graydovee-remote-workspace-<clientId>/` | 专用 profile + server 插件 + lease/log |
> | server `~/.dsh/remote-workspace/<clientId>/runtime/` | 独立 Node/DSH runtime |
> | client `~/.dsh/storages/dsh_remote_workspace.json` | 连接记录、包策略（旧 workspace refs 会清理） |
> | client `~/.dsh/remote-workspaces/<clientId>/…` | local 模式私有 anchors（非权威） |
>
> 下文 §1–§7 中的 stdio server bundle、`remote-server-sessions`、WSL、stub/WorkspaceRef 等描述是
> 旧架构记录；v1 不再使用。

---

## 1. 范围与非目标

**本轮做**

1. 新建连接向导收敛为 **3 步**：① 选择方式 → ② 填写配置 → ③ 连接。
2. 第 3 步（v7 重构）：进入即自动只读探测（连接主机 → 探测远端环境），随后才出现**运行时列表**：
   点选扫描到的某个 dsh 实例复用，或选「部署新运行时」再决定**上传 server 包** / **远程下载**。
   连接失败不落盘 —— 目标只在整条流水线成功后写入（见 `api-contract.md` v7）。
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
  官方 workspace 只认 `realpath(cwd) === workspace.path`；在当前“复用官方草稿页”的路线下，这是远端路径能进 shell 树的唯一办法。

> 官方 UI/功能复用边界、vendored 行的改动和自实现清单见 `doc/official-workspace-reuse.md`；
> DSH 升级时按该文档 §8 复核，这份架构文档只保留链路结论，不重复维护逐项清单。

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
| `src/provision/version-range.ts` | 版本解析 + 比较 + 兼容判定（`DSH_VERIFIED_RUNTIMES` 成员判定） | 纯函数，host 专用；**不引入 `semver` 依赖**（peer 区间是一个常量，用 30 行实现即可，避免动 `dependencies` 与锁文件） |
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
| ③ `connect` | 进入即自动探测（连接主机 / 探测远端环境 两行）→ **运行时列表**（点选复用，或部署新运行时后选上传 / 下载）+ `runtime/upload/start` 三行进度 + 连接日志 + host-key 面板 |

**第 1 步的方式卡（实现已定稿，2026-10-18）**：

- **docker 卡整卡移除**（不是置灰、不是 teaser）：卡片集合由
  `src/client/method-cards.ts::offeredMethods(platform)` 产出，内部用的就是 host 侧同一个
  `methodAvailable` 谓词（`targets/methods.ts`），所以「客户端渲染」与「host 校验」永远同源：
  `ssh` 恒有，`wsl` 仅 `win32`，`docker` 恒无。
- `ConnectionMethod` 类型里**仍保留 `'docker'`** 作为保留值（`method-cards.ts:25` 的
  `OfferedMethod = Exclude<ConnectionMethod, 'docker'>`），host 侧的 `methodAvailable` 也仍然
  拒绝它 —— 保留值是为了将来加回时不必改协议面，**不代表**它有 UI 入口。

`directory` 不再是向导步骤。浏览远端目录成为 **`AddWorkspaceDialog` 的唯一内容（单页签）**：

- 一个宿主（挂在 `RemoteTree` 上，沿用「对话框挂在树上」这条踩过两次的不变量），**只有一个页签：
  浏览目录**。（P0 变化：原计划的「远端已注册」页签**取消**——自动登记之后 server 里已有的工作区
  本来就会直接出现在树里，那个页签恒为空，留着只会误导。见 §7.5。）
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
| 远端 registry 标题与本地 `title` 不一致 | 裁决 5 | 重命名只改插件记录 `title`（绝不 `mv` 远端目录）；远端 `reg.list` 仍返回旧标题 | **P0 已关闭**：`reg.rename`（A34）让 title 只有一个权威；「远端已注册」页签也已随自动登记取消 |
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
| **SSH 路径的验收目标** | **真实主机 `tester@203.0.113.10:22`**，**密码认证** | 登录后即一台 WSL（发行版由 `uname -a` 确认）。`~/.ssh/config` 的别名读取由 QA 自行加一条别名指向该主机来验证；首次连接必然触发未知指纹确认。密码只出现在 `/api/connect/start`、`/api/dsh-scan` 的 body，**不得进报告/截图**。 |
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
| v6 | 2026-10-18 | **阶段 P0：server 权威 + 本地只留引用**（用户批准的重构） | 决策 A33–A42；新增 **§7**（7.1 权威归属表 / 7.2 协议 v3 与握手矩阵 / 7.3 `WorkspaceRef` 与迁移 / 7.4 Gate 0 A/B/C + 清扫 + `cleanup-shell-workspaces` / 7.5 客户端视图与断线 / 7.6 旧结论关闭表）；A7/A17 标注被推翻；api-contract 新增 §14（协议 v3 逐字契约）、§15（`WorkspaceRef`/`state` 形状）、§10 错误码、§1 路由表；acceptance-gap 新增 F 节（P0 验收口径） |
| v7 | 2026-10-18 | **P0 契约修订：join 改为 server 清单驱动**（Leader 裁决 A43/A44） | §7.1 增加「ref 集合是 server 清单的投影」+ 自动登记/回收规则 + 不变量 `workspaceRefs ⊇ serverWorkspaces`；§7.3 迁移并入自动登记流程；§7.5 行来源改 server 清单驱动、弹窗回单页签（删 `unaddedServerWorkspaces()`）、移除=删 server 登记、新增两条已知缺口；§3.4 单页签；§3.6 registry 标题缺口标关闭；api-contract §15.2/§15.3 语义与新不变量；acceptance-gap F.1 判定改为「无需手动操作即出现」 |
| v8 | 2026-10-18 | **Gate 0 改判：默认 A（零写入）+ 逃生口 + 清扫**（Leader 裁决） | §7.4 重写落地段：`shouldRegisterShellWorkspaces()` 默认 `false`、`DSH_RW_FORCE_SHELL_WORKSPACES=1` 回退 C、清扫（`scrubShellWorkspaces` + 启动 + `dispose` + `POST /api/cleanup-shell-workspaces`）无条件做；保留 A→B→C 升级判据（QA 在 alpha57 判红则翻 B）；A39 与 §7.1 权威表同步 |

### 附：本轮决策清单（ADR 摘要）

| id | 决策 | 一句话理由 |
|---|---|---|
| A1 | reuse 判定放进纯模块 `provision/plan.ts` | 可单测、可解释，`channel.ts` 不涨 if |
| A2 | **不新增 `ProvisionStep`**，reuse 用 `runtime`/`upload` 的消息行表达 | 5 步是 wire 契约，多一行 UI 不值一次协议变更 |
| A3 | 扫描是**连接前只读**的普通 POST（`dsh-scan`），host-key 未确认时返回 `stage:'host-key'` | 复用向导已有的「信任后再连」语义，不落记录、不建通道 |
| A4 | 架构探测折进 `dsh-scan` 的返回里，流水线仍自己 probe | 一次传输拿全事实；记录里的 probe 只作提示 |
| A5 | 目录浏览变成 `AddWorkspaceDialog` 的默认页签 | 需求 5 要「行上点添加工作区再浏览」；对话框挂树上（踩过两次） |
| A6 | 删除连接 = 只删本地 + 凭据 + stub + shell 条目；远端部署物与会话日志保留 | 远端是共享安装与用户数据，删了不可恢复 |
| A7 | 工作区重命名 = 本地 `title`，绝不 `mv` 远端目录 | 远端是权威、`mv` 不可回滚、官方 shell 也只改标题。（**P0 推翻其「只改本地」部分，见 A34**；「绝不 `mv` 目录」仍成立） |
| A8 | `刷新会话列表` 退出工作区行菜单 | 官方行菜单只有两个固定 key，而重命名是需求 |
| A9 | `RemoteFile` 移到 `targets/types.ts` | 消掉 ssh→provision 的类型回边 |
| A10 | 记录只加 4 个 optional 字段，域版本仍 1 | 单文件布局无迁移，bump 即砖 |
| A11 | reuse 失败**不**自动改走上传 | 不能静默传 25–50 MB |
| A12 | 远端插件 marker 分两处（打包/复用），probe 同时读 | 两种安装布局共存，旧部署不需要迁移 |
| A13 | 连接成功后**不自动弹**添加工作区（回列表 + 展开 + toast） | 浏览会触发远端目录读取，不该由一次「连接成功」替用户决定 |
| A14 | 接受 `刷新会话列表` 退出工作区行菜单 | 官方行菜单固定两项，重命名是验收项；列表会自读 |
| A15 | 删除连接的确认正文**逐项**写「删什么/不删什么」 | 用户必须能预期远端不会被清理 |
| A16 | reuse 失败给「改用上传 server 包并重试」按钮，但不自动回退 | 把选择权交给用户，同时不放行静默大文件传输 |
| A17 | 工作区重命名不同步远端 registry 标题（进已知缺口） | 需要 `reg.rename` → 触碰 server 代码与两仓库同步。（**P0 已做：A34 加 `reg.rename`，本缺口关闭**） |
| A18 | 复用候选的 `nodePath` 必须认 `$DSHHOME/server/node/bin/node`，扫描 PATH 前缀必须含它 | 实测：部署实例是 `/bin/sh` 包装脚本 + 内部 `exec node`，不带这个前缀会 `exit 127` 被误判不兼容 |
| A19 | 复用启动命令一律 `DSH_HOME=… PATH="<nodeDir>:<launcherDir>:$PATH" exec <launcher> --profile <p>`，**不用** `node <launcher>`；`selfContained` 时省略 PATH 前缀 | 实测部署 launcher 是 `/bin/sh` 包装脚本（末行 `exec node`），`node <launcher>` 跑不起来；PATH 前缀同时覆盖两种形状 |
| A20 | 插件 marker **两处并存**：`<profileDir>/.dsh-rw-plugin.json`（两条路径都写）+ `.components/plugin.json`（仅上传路径写，**`decidePlugin` 的权威**） | 复用路径没有 `.components/` 树；上传路径的「要不要重传」必须仍由原判据决定 |
| A21 | ~~`0.3.0-rc.1` 属于兼容~~ → **已被 2026-10-20 修订取代**：门禁改为 `DSH_VERIFIED_RUNTIMES` 成员判定，只接受实测过的 `0.2.1-rc.2` | 区间是对未发布版本的提前担保，且会放进未验证的中间预发布 |
| A22 | 候选装配函数命名 `assembleCandidates()` | Leader 已确认；职责单一（scan → 带 profile 与排序的候选） |
| A23 | 扫描**不 pin** 指纹；确认后指纹进内存 `state.trusted`，`connect/start` 复用它**不二次弹窗**，pin 只在连接成功时发生 | 扫描是只读探路，不该产生持久信任；又不能让用户两次确认同一台机器 |
| A24 | 草稿字段 `ConnectDraft.packageSource` 退役，第 3 步 `connectionMode` **独占** wire 字段 `packageSource` | 一份真相；旧的第 2 步选择器是双入口缺陷。**已被 v7 取代**：`connectionMode` 改为 `runtimeChoice`（复用列表 / 部署新运行时），wire 不变 |
| A25 | 目标只在一次成功连接后落盘；host-key 确认只活在本次尝试的内存里 | 失败尝试不得留下无凭据的行；"确认即 pin" 会让错误密码也变成一条坏记录 |
| A25 | 所有弹窗（含新浏览弹窗、工作区重命名）必须 `useSingleHost(<kind>)`（`common.tsx:134`） | 左栏与面板同时挂载 `RemoteTree`，不接入就是双弹窗 |
| A26 | SSH 验收资源 = 真实主机 `tester@203.0.113.10:22`（密码认证）；自建 sshd 夹具作废 | 夹具脚本不存在，QA 会找不到；真实主机还能顺带验 `~/.ssh/config` 别名与 host-key 确认 |
| A27 | **撤销**「部署实例排在 PATH 命中之后」与 `DshCandidate.origin`（Leader 裁决 (b)，2026-10-18） | 部署实例本身就是最可靠的复用候选（自带 node、插件状态可判）；`origin` 是纯展示冗余，会让 wire 契约变宽而无收益。排序 = `compatible && upToDate` → `compatible` → `path` |
| A28 | `reuse-launcher-missing` **在路由层**以 `400` 拒（`packageSource==='reuse'` 且 `reuseLauncherPath` 缺失/为空），plan 阶段同码只作兜底 | QA 实测 alpha51 的路由层没透传该字段；缺参必须同步拒，不能留到执行期才报 |
| A29 | 远端 `sandbox` 兜底**必须返回官方 facts 对象**（`{ argv, enforcement:'partial', denialSignatures:[], runnerFailureRules:[] }`），不是裸 argv；验证必须用官方 strict schema，**不许 `z.unknown()`** | alpha48–54 的裸数组被客户端 strict `.parse` 拒绝、包成 `SandboxUnavailableError`（用户看到与平台无关的通用模板 + `Runner failure: [`）；`z.unknown()` 正是让它活到 alpha55 的原因。`partial` 是诚实值：没有 backend 约束过 argv |
| A30 | 新增 `realm-unavailable` 三守卫（`assertRemoteRealm` / `assertLiveSessionInRealm` / `assertRealmComposed`），接线在 `openWorkspace`/`resumeSessionOnce` 的任何副作用之前 | alpha54 安全事故：realm 没挂时静默用本地执行世界跑命令（只有 pwsh、cwd 是 stub、本机写出 proof 文件）。宁可报错也不能假远端 |
| A31 | 第 1 步方式卡**只有 ssh / wsl**，docker 整卡移除；`ConnectionMethod` 保留 `'docker'` 作保留值 | 卡片由 `offeredMethods(platform)` 用 host 同一谓词过滤，杜绝「藏了但没拦」；保留类型值是为了将来加回不动协议面 |
| A32 | `serverPackage` 由 `provisionedHints()` **唯一生产**，`publicTarget` 带出且不含凭据 | 三个新增记录字段里只有它需要「谁写」的约束：多个写入点会让「上次部署的包」与「上次 probe」互相覆盖 |
| A33 | **P0：远端工作区清单权威 = server**（`reg.list`）；本地不再持有 `path`/`title`/`createdAt` | 两个客户端连同一 server 必须同源；旧模型每端各自 `reg.create`，互相看不见 |
| A34 | **P0：工作区重命名 = server `reg.rename`**（**推翻 A7/A17** 的「只改本地 `title`」） | server 权威后本地 title 无意义；id 是 `sha256(serverId\0path)[0..16]`，重命名不改 id、不动目录 |
| A35 | **P0：工作区删除 = server `reg.delete`**；默认拒绝仍有会话者（`workspace-not-empty <n>`），`force:true` **只删清单条目**，**绝不删会话日志** | 清单可重建（`reg.create` 幂等），会话日志是用户数据、删了不可恢复；QA 用「删除后重建，sessionCount 回来」证明数据没丢 |
| A36 | **P0：协议 v3**（`REMOTE_SESSION_PROTOCOL = 3`），两仓同步；握手协议不符必须给可读错误 `server-protocol-mismatch`，**不静默降级** | 新增 `reg.rename`/`reg.delete` + `reg.list` 字段扩展；静默降级会让新客户端以为改名成功 |
| A37 | **P0：`RemoteWorkspaceRecord` → `WorkspaceRef`**（去掉 path/title/createdAt），存储域版本仍 1；旧记录启动时幂等 `reg.create` 迁移，失败只记日志 | 单文件布局无迁移；幂等登记让老用户无损（会话按 `header.cwd` 匹配，重建清单即恢复） |
| A38 | **P0：断线不渲染工作区行**，不做「本地最后已知清单」持久化缓存 | 避免出现第二份权威；树本来就要求 `connected && expanded` |
| A39 | **P0：stub 目录 = 本地临时材料**（非权威，可删可重建）；官方 shell 条目按 Gate 0 判定，**本轮默认 A（零写入共享 registry）**，逃生口 `DSH_RW_FORCE_SHELL_WORKSPACES=1` 回退 C 行为；**清扫无条件做**（见 §7.4） | 实测：`attachSession` 缺条目会跳过、registry membership 只是 filter 非 enforcement、`dsh-agent` 里 `workspaceRegistry` 出现 0 次；唯一未验是浏览器侧 `uiWorkspace.openSession`，QA 在 alpha57 判红则翻 B |
| A40 | **P0：置顶/归档 = 每客户端视图状态**，按 `remoteWorkspaceId` 存在 `WorkspaceRef` 上，不进 server | 设备偏好不该跨端同步，server 也没有该 RPC |
| A41 | **P0：删除连接不删 server 清单条目**（其他客户端还在用），只删本地 ref/凭据/stub/shell 条目 | 一个客户端退出不该改变别人看到的世界 |
| A42 | **P0：新增 `POST /api/cleanup-shell-workspaces`**，并在启动与 `dispose()` 自动清扫 | 共享 registry 里历史残留必须能一键回收，且要有可验证入口 |
| A43 | **P0：可渲染的工作区行由 server 清单驱动**（不是「server ∩ 本地 ref」的 inner join）；host 在每次 `reg.list` 后**自动登记/回收 ref**（server 有本机无 → 建 ref；本机有 server 无 → 删 ref） | inner join 只渲染「本机加过的」，**另一个客户端建的工作区仍然看不到**——正是用户抱怨的现象。自动登记让两端刷新即互相可见；ref 只承载材料化与视图状态 |
| A44 | **P0：「移除工作区」= 删 server 登记**（所有客户端消失），会话日志保留；**不做**「只在本机隐藏」 | 清单是权威；本地隐藏会被下一次自动登记复活，除非引入 hide 集合（本轮不做，记入已知缺口） |

---

## 7. 阶段 P0：server 权威 + 本地只留引用（本节优先于 §2–§3）

> 用户提出的问题（原文要点）：远端工作区应以 **server 为权威**；现在两个客户端连同一台 server
> 各自建本地工作区、互相看不到，而且为了给会话挂靠而在共享的 `~/.dsh/storages/workspace.json`
> 里留下 stub 条目，导致**没装插件的 desktop 也能看到远程工作区行**。
>
> 已核实的事实（本轮不再重查）：会话层**已经**是 server 权威（`persist.*` + 远端
> `~/.dsh/remote-server-sessions/…`）；server 侧**已有**工作区注册表
> （`src/server/session-store.ts:99-125`：`records()` → 远端 profile 的 `workspaceRegistry.list()`，
> 否则用 `workspaceId = sha256(serverId\0path)[0..16]` 的本地索引；`listWorkspaces()` / `createWorkspace()`）；
> 但左栏读的是**本地**权威（`service.ts:514 listWorkspaces()` → `/api/state.workspaces`），
> `materializeWorkspace`（`service.ts:1263-1306`）会 `registry.create(stub)` 并把
> `stubPath`/`officialWorkspaceId` 写进本地记录，`dispose()`（`service.ts:1438`）不清这些官方条目。

### 7.1 权威归属表（新的核心表）

| 数据 | 权威 | 落盘位置 | 本地的角色 |
|---|---|---|---|
| 会话事件日志 | **server** | 远端 `~/.dsh/remote-server-sessions/<projectKey>/<sessionId>/` | 无副本（routing 直读） |
| 会话标题 / 最后活动 | **server**（fold 日志，`persist.titles`） | 同一日志 | 无副本（server 侧按 `sizeBytes` 记忆化） |
| 会话列表 | **server**（`persist.list`） | 远端 | `client/store.ts` 的 `state.sessions` 只是 UI 缓存，展开时重读 |
| **远端工作区清单**（`path`/`title`/`createdAt`/`sessionCount`/`updatedAt`） | **server**（`reg.list`） | 远端 profile 的 `workspaceRegistry`，否则 server 本地索引 `workspaces.json` | **只在连接期存在**（内存 `serverWorkspaces[targetId]`），不持久化（A38） |
| 连接目标 / 认证方式 | **本地** | plugin 存储域 `targets` | 权威 |
| SSH 密码 / 私钥口令 / 模型 key | **本地** | `ctx.credentials`（记录里只有 `credentialKey` 引用） | 权威，**绝不过线** |
| 包来源策略 / 平台探测 / 复用启动器 | **本地** | `targets` 记录（`packageSource`/`platformProbe`/`reuseDsh`/`serverPackage`） | 权威（本机事实） |
| stub 目录 | **本地临时材料** | `~/.dsh/remote-workspaces/<targetId>/<sha1>` | **非权威**，可随时删除重建 |
| **官方 shell 工作区条目** | **本地 shell**（`workspaceRegistry`，落在共享 `~/.dsh/storages/workspace.json`） | 共享存储（所有 profile/客户端共用） | **默认零写入**（Gate 0 分支 A，A39）；逃生口下才写；历史遗留由清扫无条件收掉（§7.4） |
| 置顶 / 归档 | **每客户端视图** | plugin 存储域 `workspaceRefs`（按 `remoteWorkspaceId` 存） | 视图状态，不上 server（A40） |
| 本地 ref（`stubPath`/`officialWorkspaceId`/`sessionId`/`lastOpenedAt`） | **本地** | plugin 存储域 `workspaceRefs` | 材料化 + UI 状态；**不决定「有没有这一行」**（见下） |

**本机 ref 集合是 server 清单的投影，不是「我加过哪些工作区」**（Leader 裁决 2026-10-18，A43）：

- 每次拿到某 target 的 `reg.list` 后，host **自动登记引用（auto-ref）**：
  - **server 有、本机无 ref** → 新建一条 `WorkspaceRef`（新 `wr-xxxxxxxx`），**只写
    `targetId` + `remoteWorkspaceId`**；**不建 stub、不写官方 shell 条目、不连主机**；
  - **本机有 ref、server 已无该项** → 删掉该 ref（best-effort 删其 stub 目录与官方条目）。
- 因此两个客户端刷新后**立刻互相看到**对方建的工作区，无需任何手动操作。
- 约束：自动登记**只在已连接、且已成功拿到 `reg.list`** 的 target 上做；**绝不**为了登记/迁移去连主机。
- 不变量：**对每个已连接 target，`workspaceRefs` 的 `remoteWorkspaceId` 集合 ⊇ `serverWorkspaces[targetId]`
  的 id 集合**（实现上应当相等；⊇ 是下限，因为 `reg.list` 失败时保留既有 ref，避免抖动）。

由此得到的三条可验证结论：

1. **跨客户端同源**：A 端建的工作区，B 端连同一 server 刷新后**直接出现**（id 相同、无需手动添加）。
2. **desktop 零污染**：清单在 server，stub 只是本地临时目录，不再需要往共享 `workspace.json`
   写条目；历史残留由 §7.4 的清扫收掉。
3. **删除不动会话**：`reg.delete` 只动清单；会话日志留在远端，重新 `reg.create` 即恢复可见（§7.2）。

### 7.2 协议 v3（`REMOTE_SESSION_PROTOCOL` 2 → 3）

契约逐字版（请求/响应/错误串/可选性）在 **`doc/api-contract.md` §14**；这里只记架构结论：

- 新增两个 RPC：**`reg.rename { id, title }`**、**`reg.delete { id, force? }`**；
  **`reg.list`** 的每项补 `updatedAt?`（`createdAt`/`sessionCount` 已有）。
- **id 不变性**：`id = sha256(serverId \0 path)[0..16]`，重命名只改 `title`，**路径与 id 都不动**
  （所以 `pinnedSessions`/`archivedSessions` 这类按 id 存的视图状态在改名后仍然有效）。
- **`reg.delete` 的连带语义（A35，本轮落地）**：
  - `force` 省略/false 且 `sessionCount > 0` → 错误串 `workspace-not-empty <count>`（客户端转成 409）。
  - `force: true` → 删除**清单条目**；**不删除** `~/.dsh/remote-server-sessions/**`。
  - 删除后同路径再 `reg.create`，`sessionCount` **立刻恢复**（会话按 `header.cwd` 归属）——
    这是「清单可重建、数据没丢」的可验证证据，QA 按它判。
  - 本轮**不提供** `purgeSessions`：真要回收磁盘必须另加显式二次确认的 RPC。
- **握手矩阵**（`server.hello`）：

  | 客户端 \ server | v3 server | v2 server（旧部署） |
  |---|---|---|
  | **v3 client** | 正常 | server 拒：`unsupported remote session protocol 3` → 客户端报 `server-protocol-mismatch`，提示「远端 server 插件过旧，请重连（会自动重部署）或改用上传 server 包」 |
  | **v2 client** | server 拒：`unsupported remote session protocol 2; this server speaks 3` → 旧客户端看到该消息 | 正常 |

  - 实践上 v3 client 连上时会先跑 provisioner（marker/sha 门禁）**替换远端插件字节再 start**，
    所以「v3 client + v2 server」只在部署失败/被跳过时出现；这条错误文案就是为了那种情况。
  - 反向（旧 desktop 客户端连已被别人升级过的 server）**必须**得到可读错误，**不许**静默降级：
    服务端在 zod `literal(3)` 之前先做一次「读 protocol 数字 + 比对」，抛出带两端版本号的句子。
- **两仓同步**：`src/protocol.ts`、`src/server/**`（`session-store.ts` 增 `renameWorkspace`/`removeWorkspace`，
  `controller.ts` 增两个方法分支）都属同步集。**任一处改动必须两边同步并复核 8 文件逐字节相同**
  （`protocol.ts` + 4 server + 3 frame）。这是本轮唯一允许改 `src/server/**` 的工作项。

### 7.3 本地数据模型：`WorkspaceRef` 与迁移

`RemoteWorkspaceRecord`（带 `path`/`title`/`createdAt`）→ **`WorkspaceRef`**：

```ts
export interface WorkspaceRef {
  readonly id: string                 // 本地 ref id，仍为 `wr-xxxxxxxx`（UI 的节点 key）
  readonly targetId: string
  readonly remoteWorkspaceId?: string // server 权威 id（16 hex）；旧记录迁移前可缺
  readonly stubPath?: string          // 本地材料化：stub 目录（非权威）
  readonly officialWorkspaceId?: string // 本地 shell 条目 id（非权威，供清扫）
  readonly pinnedSessions?: string[]
  readonly archivedSessions?: string[]
  readonly lastOpenedAt?: string
  readonly sessionId?: string
}
```

- **存储域版本仍为 1**（单文件布局无迁移，bump 即砖）。schema 只能是「旧字段全部 optional 保留 +
  新字段 optional 增加」的**并集**：`path`/`title`/`createdAt`/`serverId` 仍可出现在旧文档里，
  读出来后由迁移清空（`WorkspaceRef` 不再写它们）。
- **迁移算法（启动时，`store.open()` 之后、`ensureWorlds()` 之内）**：
  1. 对每条 `workspaceRef`：若 `remoteWorkspaceId === undefined` 且 `path !== undefined`，等该 target
     的连接可用后（**不在启动时强行连**），调 `reg.create(path, title)`；
  2. 成功 → 写入 `remoteWorkspaceId`，清掉 `path`/`title`/`createdAt`，保留 `stubPath`/`officialWorkspaceId`；
  3. 失败（未连接 / 目录已不存在 / 旧 server 不支持）→ **只记日志**，记录原样保留，下次连上再试；
     同一 ref 每个进程最多尝试一次；
  4. **迁移完成后没有单独的收尾步骤**：这批记录随后就落进 §7.1 的**自动登记流程**——下一次
     `reg.list` 会像对待任何 server 项一样对待它们（有则留存/对齐 `remoteWorkspaceId`，server 无则删除 ref）。
     换句话说：迁移只负责「把旧记录翻译成 server id」，**是否保留这一行由 server 清单决定**。
- **未连接就打开工作区**：`serverWorkspaces` 为空 → 客户端只显示连接行（现状如此），
  不假装有清单（A38）。
- `pinnedSessions`/`archivedSessions` 的键从「本地 record id」改成 **`remoteWorkspaceId`**
  （改名不失效），迁移时把旧集合搬过去（旧集合本来就是远端 sessionId）。

### 7.4 stub / 官方 shell 条目生命周期（Gate 0）

**问题**：会话要能在 shell 里被挂靠，需要一个「官方工作区」；而官方工作区是**共享**
`~/.dsh/storages/workspace.json` 里的行，于是没装插件的 desktop 也看得见。
Gate 0 = 判定**我们到底需不需要这条官方行**。三个分支：

| 分支 | 形态 | 共享 registry 泄漏 | 代价 / 前置 |
|---|---|---|---|
| **A** | 完全不需要注册：不建官方行，会话直接以远端 `header.cwd` 被 shell 识别 | **零** | 依赖「registry membership 只是 filter、`attachSession` 缺条目会跳过」这几条实测（见下） |
| **B** | 建立会话时**瞬态注册**（`registry.create(stub)` → `attachSession` → **立即 `registry.delete`**） | 只在窗口期 | 需要证明删掉官方行后会话仍可用、不被 shell 判为孤儿（`bindingSource` 路径，alpha54 白屏同源风险） |
| **C** | 注册必须**贯穿会话生命周期**（P0 之前的行为） | 有 | 唯一能消除泄漏的路径是**上游改动**（shell 支持插件提供的分组 / absent projection） |

**本轮落地（A39，Leader 裁决 2026-10-18 改判为 A）**：**默认走 A —— 不往共享
`~/.dsh/storages/workspace.json` 写任何东西**。

- 开关：`shouldRegisterShellWorkspaces()` 默认 **`false`**；逃生口
  **`DSH_RW_FORCE_SHELL_WORKSPACES=1`** 强制回到 C 的行为（注册贯穿生命周期）。
  用途：上游将来若把 registry membership 变成 **enforcement**（而不是现在的 filter），
  运维**一次重启**即可回退，不需要改代码重新发版。
- 依据（Developer-A 的实测 / 静态证据，已在代码注释与测试里钉住）：
  1. `attachSession` 是**唯一**官方调用，且**缺条目时跳过**（warn 而不是抛错）；
  2. registry membership 只影响 **filter**（warn + 丢弃），**不是 enforcement**；
  3. 全 asar 统计 `dsh-agent` 里 `workspaceRegistry` 出现 **0 次**；我们的
     `ctx.agents.create/resume` **不经过** `dsh-api-session-controller`。
- **唯一未验**：浏览器侧 `uiWorkspace.openSession` 是否仍能把会话接到主区 → **归 QA 在 alpha57 上验**；
  若判红（会话点不开 / 白屏 / `bindingSource` 报错），**翻 B**（瞬态注册后立即删除），
  再不行才回 C。
- **清扫无条件做**（与落哪个分支无关）：`scrubShellWorkspaces()` + **启动** + **`dispose()`** +
  `POST /api/cleanup-shell-workspaces`（A42）。它的作用从「回收我们自己刚写的」变成
  「**清历史遗留**」——用户在 P0 之前的版本里已经写进共享 registry 的 stub 条目必须能收干净。
- 无论哪个分支，下面三项都成立：
  1. **最小化写入**：默认 A 下**零写入**；逃生口/翻 B 时只有真正「打开/新建会话」才注册，
     单纯展开、看列表、只读 `reg.list` **不写**共享 registry。
  2. **生命周期回收**：注册过的话，最后一个本地会话关闭（`session/disposed`）或 target 断开/删除时，
     删掉官方条目与 stub 目录；`dispose()`（插件卸载）清扫本进程造出的全部条目。
  3. **启动 + 手动清扫（两条入口）**：
     - 启动时扫官方 registry，删掉 `path` 落在 `~/.dsh/remote-workspaces/` 下、且**没有活跃会话**的条目；
     - `POST /api/cleanup-shell-workspaces`：手动触发同一次清扫，响应列出删掉/保留的 id
       （保留 = 有活跃会话）。这是 QA 证明「desktop 零污染」的操作入口。

**Gate 0 的升级判据**（保留，供 QA 判红时决策）：
① 基线：A 下开会话并 resume，主区能否显示（`uiWorkspace.openSession` 的返回与 DOM）；
② 若 ① 失败 → 翻 B：注册 → `attachSession` → 立即删条目，再测开会话与 resume 旧会话；
③ 若 ② 仍失败 → 回 C（= 逃生口常开），并记录失败现象作为上游需求依据。
判据红线：出现 `bindingSource` 报错或白屏即视为该分支失败。

### 7.5 客户端视图与断线行为

- **可渲染的工作区行 = server 清单**（Leader 裁决 2026-10-18，A43）。树的数据来源：
  - **驱动项**：`serverWorkspaces[targetId]`（连接期由 `POST /api/state` 带回，= 各在线 target 的
    `reg.list`），它决定「有哪些行」以及 `path`/`title`/`createdAt`/`sessionCount`/`updatedAt`；
  - **叠加项**：`workspaceRefs`（按 `(targetId, remoteWorkspaceId)` 匹配）只提供材料化与视图状态
    （`stubPath`/`officialWorkspaceId`/`sessionId`/置顶归档/`lastOpenedAt`）。
  - 由于 host 会自动登记 ref（§7.1），正常情况下两者一一对应；**匹配不到 ref 的 server 项仍要渲染**
    （用 `title`/`path` 直出，未材料化），不允许因为「本机没加过」就隐藏——那正是用户抱怨的现象。
- 排序：工作区按 `updatedAt ?? createdAt` 倒序；置顶/归档规则不变（视图层）。
- 断开 → 不渲染工作区行（`connected && expanded`，且没有 server 列表）——与现状一致，
  但**不再**回落到本地记录（本地已经没有人可显示的 `path`/`title`）。
- 删除连接：删本地 ref + 凭据 + stub + 官方条目；**不动** server 清单（A41）。
- 「移除工作区」= **删除 server 上的登记**（`workspace-delete` → `reg.delete`），**所有客户端都会消失**；
  有会话时先弹 `workspace-not-empty`（409），二次确认后 `force: true`，文案**必须**写明
  「远端会话日志会保留」。本轮**不做**「只在本机隐藏」这种本地视图（见 §7.6 已知缺口）。
- 「重命名工作区」= server `reg.rename`；成功后重读 `reg.list`。
- **添加工作区弹窗回到单页签**（只有「浏览目录」）：「远端已注册」页签取消——自动登记之后它恒为空，
  留着只会误导。因此 `client/workspace-join.ts` 的 `unaddedServerWorkspaces()` 也随之删除
  （它存在的唯一理由就是那个页签）。

### 7.6 P0 对既有结论的关闭清单

| 旧结论 | 状态 |
|---|---|
| A7「重命名只改本地 `title`」/ A17「不同步远端 registry」 | **被 A34 推翻**：server `reg.rename` 是权威 |
| §3.6 已知缺口「远端 registry 标题与本地 `title` 不一致」 | **关闭**（只剩一个 title，在 server） |
| §3.6 已知缺口「删除连接不清理远端 workspace 索引」 | **部分关闭**：能力有了（`reg.delete`），但删除连接**有意不用**它（A41）；单条工作区删除可用 |
| §2.5「远端工作区在本地 shell 树里靠 stub 占位」 | 仍成立，但 stub 降级为**非权威临时材料**（§7.1） |
| §2.6「path 来自本地记录」 | 改为「path 来自 server 列表（内存）」，routing 只用 stub 做 cwd 映射 |
| **P0 已知缺口：不能「只在本机隐藏某个工作区」** | 本轮不做。清单是 server 权威，本地隐藏会立刻被下一次自动登记「复活」（或者要引入一套 hide 集合）；若用户需要「桌面端不想看见某台 server 的工作区」，应做成**整连接**级别（本机不连接/删除连接），而不是逐工作区隐藏 |
| **P0 已知缺口：`/api/state` 的 ref 集合会被自动登记改写** | 任何假设「ref 只在我添加时出现」的旧逻辑（含旧测试）都必须按 A43 重写 |
