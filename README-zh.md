# dsh-remote-workspace

**把一台 SSH 主机接入为 DeepSeek Harness 工作区。**

本仓库是 **Remote Session** 架构的 client 半边：agent loop、模型请求、API 凭据与浏览器 UI
留在本机；文件、子进程、shell 与**会话日志**在远端主机上。会话日志以远端为唯一权威，采用
DSH 官方 JSONL 格式，因此换一台设备继续对话不需要任何镜像同步。

- 包：`dsh-remote-workspace@0.1.0-alpha68` —— bundle 插件，client 平台 `web`
- 首个公开里程碑 tag：[`v0.1.0-alpha1`](https://github.com/graydovee/dsh-remote-workspace/tree/v0.1.0-alpha1)
- server 半边：[`dsh-remote-workspace-server`](https://github.com/graydovee/dsh-remote-workspace-server)
- English: [README.md](README.md)

## How it works

```
         你的机器（dsh web）                         SSH 主机（POSIX）
┌───────────────────────────────────┐          ┌───────────────────────────────────────┐
│ agent loop · 模型 · 凭据          │  分帧    │ dsh 运行时（自带 Node + dsh，不依赖   │
│ RoutingSessionPersistence         │◄────────►│ 远端系统安装）                        │
│   ├─ 本地 cwd  → 官方 JSONL       │ 协议 3   │ fs / subprocess / sandbox / shell     │
│   └─ 远端 cwd  → persist.*（RPC） │          │ sessionPersistence → JSONL（zstd）    │
│ 「远程工作区」侧栏区域            │          │ ~/.dsh/remote-server-sessions/…       │
└───────────────────────────────────┘          └───────────────────────────────────────┘
```

插件负责四件事：

1. **传输** —— `ssh2` 连接与 host key 校验；Windows 宿主上另有 WSL 目标（用 `wsl.exe`
   取代网络跳转）。
2. **远端部署** —— 把 Node 运行时与目标平台的 `dsh` 依赖树暂存或下载到 `~/.dsh/server`，并把
   本插件的 `package.json` / `cordis.patch.yml` / `lib/server.js` 上传到 profile 的
   `node_modules/dsh-remote-workspace`。远端命令一律 `/bin/sh -c` + 绝对路径，从不依赖远端的
   `PATH`、登录 shell 或系统 npm。
3. **持久化路由** —— `RoutingSessionPersistence` provide 官方 `sessionPersistence`：本地
   cwd 的会话走未改动的官方 JSONL 后端，远程工作区的会话走远端 `persist.*` 平面。远程会话
   的 header cwd 永远是本地 stub，官方 workspace 注册表与 session-controller 照常工作。
4. **UI** —— 左侧栏 **「远程工作区」** 区域（在 shell 自己的「工作区」区域正上方）用官方
   行组件渲染「连接 → 工作区 → 会话」三层。

## Requirements and compatibility

### Declared in `package.json`

| 项目 | 字段 | 取值 |
| --- | --- | --- |
| DSH 宿主 | `engines.dsh` | `0.2.1-rc.2` —— 精确值，唯一实测过的版本 |
| DSH 各包 | `peerDependencies` 里每个 `@deepseek-ai/dsh-*` | `0.2.1-rc.2` —— 精确值 |
| 清单格式 | `dsh.manifestVersion` | `1` |
| Node | `engines.node` | `^22.19.0 \|\| >=24.0.0` |
| 线协议 | `REMOTE_SESSION_PROTOCOL` / `server.hello` | `3` |
| 验证基线 | `devDependencies` | `@deepseek-ai/dsh-*` `0.2.1-rc.2`、`@deepseek-ai/cordis` `4.0.5` |

这样声明的原因：

- **只声明一个 DSH 版本，不是窗口。** `0.2.1-rc.2` 是本插件唯一验证过的版本。写范围等于承诺
  范围内每个版本都能跑，而这一点无法预知：后面的 `0.2.x` 完全可能改掉 `apply()` 挂载式 JSONL
  后端、严格 `{ kind, executable }` 的 `hello` 形状，或本 client 所依赖的行 / `data-slot`
  契约。兼容性是靠重跑测试挣来的，不是靠放宽区间。
- DSH 在**安装时**与**每次 profile 启动时**都会检查 **`engines.dsh`**，而且该字段存在时
  **它独自裁决**——`peerDependencies` 不参与准入判断。peer 也钉成同一个精确值，这样清单里
  没有任何一处读起来像「0.2.x 都行」，两处声明也不可能漂移。
- 更低版本起不来（`0.2.0-rc.x` 与更早的 `0.2.1` alpha 缺 `apply()` 挂载式 JSONL 后端与严格
  `hello` 形状）；更高版本则是**未测**，不是"兼容"。
- `@deepseek-ai/cordis`（`^4.0.5`）与 `@deepseek-ai/schemastery`（`^3.18.2`）保留 caret 区间：
  它们是随运行时一起发的、遵循 semver 的库，精确的 `engines.dsh` 已经唯一确定我们看到的副本。
- client 与 server 必须同为线协议 `3`：不匹配会得到 `unsupported remote session protocol …`，
  不静默降级；server 半边声明的是同一个精确 DSH 版本。

**其它版本的主机一律被拒**（`incompatible-version`，requirement 键为 `engines.dsh`），在 pnpm
下载或执行任何东西之前就拒绝。唯一的旁路是在 profile 的 `compatibility.json` 里按「包版本 ×
运行时版本」逐对豁免：

```bash
dsh plugin --profile web allow-version dsh-remote-workspace@0.1.0-alpha68 \
  --dsh-version <宿主实际的 dsh 版本> --accept-risk
```

这种组合**明确不受支持**——没测过，失败模式包括崩溃和会话日志损坏。

**扩窗是一次发布动作，绝不是改区间**：把 `devDependencies` 升到新版本，跑 `pnpm typecheck`、
provider conformance 套件与浏览器验收，然后在同一版本里同时更新两个仓库的 `engines.dsh`。

### Runtime matrix

| 角色 | 要求 |
| --- | --- |
| 本机 | `dsh` **`0.2.1-rc.2`**，使用 `web` profile；Node `^22.19.0 \|\| >=24.0.0`；macOS、Linux 或 Windows |
| 远端主机（SSH） | POSIX：`/bin/sh`、`tar`、`chmod`、可写 `$HOME`、可达 sshd。**不需要 Node 或 npm** —— 部署自带运行时 |
| 远端目标（WSL） | 仅 Windows 宿主；被选中的发行版即执行世界 |
| server 包 | `linux-x64-gnu`、`linux-arm64-gnu`、`darwin-x64`、`darwin-arm64` |

server 包矩阵刻意不含 Windows：所有部署脚本都是 `/bin/sh` + `tar` + `chmod`，Windows 远端
需要独立的部署器。

请使用 `web` profile。桌面应用安装树不含 SSH 包（`@deepseek-ai/dsh-ssh`、`dsh-fs-ssh`、
`dsh-subprocess-ssh`、`dsh-sandbox-ssh`），所以本插件是 `dsh web` 的能力；不要装进 desktop
profile。

## Install

包目前不在任何 registry 上，从构建出的 tarball（或 git checkout）安装：

```bash
pnpm install
pnpm build
pnpm pack --pack-destination ~/.dsh/tarballs

dsh plugin --profile web remove dsh-remote-workspace   # 仅在已安装时
dsh plugin --profile web add ~/.dsh/tarballs/dsh-remote-workspace-0.1.0-alpha68.tgz
```

然后重启提供 GUI 的进程并刷新页面。这是 **bundle** 插件：`dsh plugin add` 同时把它写进
profile 的 `dsh.profile.bundles`，重启才会挂载 patch 层。

git 安装拿到的是源码而不是构建产物，因此需要在 profile 的 `pnpm-workspace.yaml` 里放行
`prepare` 构建脚本，并钉住 commit：

```bash
dsh plugin --profile web add "github:graydovee/dsh-remote-workspace#<commit>"
```

```yaml
allowBuilds:
  dsh-remote-workspace: true
```

## First connection

1. 左侧栏 → **远程工作区** → **＋新建连接**。
2. 填 host、port、user，选择凭据，确认 host key 指纹（SHA-256）。未知指纹必须显式确认；
   **变化过**的 key 一律中止。
3. 选择远端运行时来源：
   - **download** —— 从 server 仓库的 release 拉取 server 包；
   - **upload** —— 把你自建的 tarball 推上远端；
   - **reuse** —— 直接复用远端已安装的 `dsh`。
4. 添加一个工作区（远端目录），然后打开已有会话或新建会话。

部署带锁：第二个客户端不会把上传交错进同一个安装根。

## The sidebar: connections → workspaces → sessions

```
远程工作区                      [刷新] [＋新建连接]
└─ 🌐 连接   mac-arm-200        [＋添加工作区 | 连接]  [⋮ 连接/断开 · 忘记连接]
   └─ 📁 工作区  dujiahui       [＋新会话]            [⋮ 刷新会话列表 · 移除工作区]
      ├─ 会话标题  45 分钟       [⋮ 置顶 · 重命名 · 分叉 · 归档]
      └─ 新会话                  （官方 blank 行 = 新建会话）
工作区                          ← shell 自己的区域，行为不变
```

- 连接行的文件夹槽用颜色表示连接状态（绿 / 红 / 灰）；未连接或失败时 `＋` 位变成插头，
  点它即连接。
- 断开连接会收起子树，重连会重新展开。
- 会话动词：**置顶**、**重命名**、**分叉**、**归档**。置顶与归档存在插件自己的工作区记录上
  （shell 的置顶路径用本地会话索引校验，而远端会话不在其中）；重命名是往远端日志追加一条
  真正的 `session/title` 事件；分叉走 shell 自己的 `forkSession`，落点也是远端。
- 行本身是 shell 的官方行组件，内置在 `src/client/vendor/workspace-rows/` 并用官方样式表
  渲染；只有区域自身的框（宿主盒、高度链、连接态）是插件 CSS。升级 DSH 后用
  `node scripts/vendor-workspace-rows.mjs --dsh <dsh-checkout>` 重新内置。

## Where everything is stored

| 位置 | 内容 |
| --- | --- |
| 远端 `~/.dsh/server/` | 部署的运行时：`node/`、`dsh/`、暂存目录与组件标记 |
| 远端 `~/.dsh/profiles/dsh-remote-server/` | server 启动所用的 profile；本插件的文件在 `node_modules/dsh-remote-workspace/` 下 |
| 远端 `~/.dsh/remote-server-sessions/<projectKey>/<sessionId>/` | **权威**会话日志（官方 JSONL，zstd 分帧） |
| 远端 `~/.dsh/remote-server/` | `server-id`（workspace id 的组成部分）、`workspaces.json`（服务端权威清单）、`status.json`（0600 发现清单） |
| 本机目标存储 | 连接、工作区、`pinnedSessions` / `archivedSessions` |
| 本机 `~/.dsh/remote-assets/` | 从 release 下载的 server 包缓存 |
| 本机 `~/.dsh/sessions/` | 永远不会出现远端会话 |

## Security model

- **凭据不过线。** SSH 凭据与模型 API key 只留在本机；所有发往 UI 或日志的内容都过
  `scrubSecrets`。
- **host key 固定。** 未知指纹必须显式确认（展示 SHA-256）；指纹变化即中止连接。
- **所有插件 HTTP 路由都过 `trustedRequest`**（DNS rebinding 与跨站防护），JSON 请求体上限
  1 MiB。
- **远端世界就是隔离边界。** 插件不会削弱宿主自己的沙箱策略。远端没有可用的沙箱后端时
  （例如没有 bubblewrap/Landlock 的 WSL 发行版），命令在**那台远端主机内**原样执行，并如实
  报告 `enforcement: 'partial'`，而不是假装已受限。
- **零原地 patch。** bundle 只新增自己的行，并 disable 一条官方持久化行
  （`session-persistence-jsonl`，在 `cordis.patch.yml` 里重述）；不重写任何官方行，shell 自己的
  「添加工作区」按钮行为不变。

## Versioning and releases

- 版本形如 `0.1.0-alphaN`，**每次部署都必须 bump**：插件批量 URL 带 `&rev=<hash>`，不 bump
  浏览器会继续吃旧 bundle。同一版本号也出现在 `/api/state` 的 `pluginVersion` 与远端
  `server.hello.version` 里。
- tag **`v0.1.0-alpha1`** 标记首个公开里程碑（该 commit 上的包版本是 `0.1.0-alpha61`）；
  后续里程碑各自打 tag。
- **精确的 `engines.dsh` 跟着 harness 走，不跟着时间走**：接受一个新的 DSH 版本 = 发一个新的
  插件版本，其 `devDependencies` 与 `engines.dsh` 同时指向它；在那样一版发出来之前，当前版本
  继续拒绝其它宿主，而不是去猜。
- server **运行时包**由 server 仓库构建并发布，tag 为 `server-v<dsh 版本>`（例如
  `server-v0.2.1-rc.2`）。插件先找 `server-v<dshVersion>`，再找 `v<pluginVersion>`，并对实际
  成功的那次传输校验 `.sha256`。

## Development

```bash
pnpm install
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run
pnpm build        # tsdown → lib/（host、server、浏览器三个 target）
```

测试覆盖：官方 provider conformance 对仓库内 `src/server` 副本、分帧 mux、`~/.ssh/config`
解析、部署、`persist.*` 句柄生命周期、路由持久层、包下载、WSL 探测与远端工作区服务。

协议与服务端实现与 server 仓库**逐字节相同**（`src/protocol.ts`、`src/server/`、
`src/frame/`、`src/provision/package-build.ts`），改一处必须两边同步改。

设计要点见 [`docs/remote-session-agent-note.md`](docs/remote-session-agent-note.md) 与仓库的
`AGENTS.md`。

## Known limitations (alpha)

- 远端会话不出现在 shell 的全局会话列表；shell 侧可能刷
  `uiConversation.binding: unknown session` 之类的噪音。
- 还没有「删除会话」动作；目前只能到远端 `~/.dsh/remote-server-sessions/…` 手动删。
- 在 shell 自己的工作区区域里，对应的官方行是用 `display: none` 隐藏的（并未从 DOM 移除）。
- 会话行不显示运行中/待审批状态点。
- 工作区标题存在服务端权威清单里，但改名不会移动远端目录。
- 面板首帧可能短暂显示错误的空态，刷新即恢复。
- 下载的 server 包只缓存 `tar.gz` + `.ready`（含摘要），不保留 release 里的 `.manifest.json`。

## License

MIT
