# dsh-remote-workspace

[English](README.md) | 中文

**把一台 SSH 主机接入为 DeepSeek Harness 工作区。** agent loop、模型请求、凭据与界面都留在
本机；文件、子进程、shell 与**会话日志**在远端主机上，采用 DSH 官方 JSONL 格式。换一台设备
继续对话不需要任何镜像同步。

- 在左侧栏新增 **「远程工作区」** 区域：连接 → 工作区 → 会话。
- 自动在远端装好并启动 `dsh` 运行时（远端**不需要**预装 Node 或 npm）。
- SSH 凭据与模型 key 只留本机、host key 必须确认、会话日志不经过本机。
- 这是 `dsh web`（`web` profile）的插件，只在 **DSH `0.2.1-rc.2`** 上验证过。

## Quick start

### 1. Requirements

| 位置 | 要求 |
| --- | --- |
| 本机 | `dsh` **恰好 `0.2.1-rc.2`**、`web` profile、Node `^22.19.0 \|\| >=24.0.0` |
| 远端主机 | POSIX：可达 sshd、`/bin/sh`、`tar`、`chmod`、可写 `$HOME`。**不需要 Node / npm / dsh** —— 由插件部署 |
| 远端目标（WSL） | 仅 Windows 宿主；选中的发行版就是执行世界 |

本插件是 `dsh web` 的 bundle。桌面应用安装树不含 SSH 包（`@deepseek-ai/dsh-ssh`、
`dsh-fs-ssh`、`dsh-subprocess-ssh`、`dsh-sandbox-ssh`），所以请装进 `web` profile，
不要装进 desktop profile。

### 2. Install the plugin

包还不在 registry 上，用构建出的 tarball 安装：

```bash
pnpm install
pnpm build
pnpm pack --pack-destination ~/.dsh/tarballs

dsh plugin --profile web remove dsh-remote-workspace   # 仅在已安装时
dsh plugin --profile web add ~/.dsh/tarballs/dsh-remote-workspace-<version>.tgz
```

然后重启提供 GUI 的进程并刷新页面：这是 bundle 插件，重启才会挂载它的 patch 层。走 git 安装
拿到的是源码而不是构建产物，需要在 profile 的 `pnpm-workspace.yaml` 里放行 `prepare`：

```yaml
allowBuilds:
  dsh-remote-workspace: true
```

### 3. Connect a host

左侧栏 → **远程工作区** → **＋新建连接**。向导分三步：

1. **选择方式** —— `SSH`（远程主机）或 `WSL`（本机 Windows 上的发行版，无 host key、无密码）。
2. **填写配置** —— SSH 需填 **别名**（必填，连接成功后保存）、**主机**、**端口**、**用户名**、
   **认证方式**（`SSH Agent` / `私钥` / `密码`；密钥或密码只发送一次，不写入列表）。
   **高级：远端运行时** 可在默认值不合适时覆盖远端的 `Node 路径` / `DSH 命令` / `Profile` /
   `DSH_HOME`；别名可从 `~/.ssh/config` 预填。
3. **连接** —— 选择远端运行时来源，然后确认主机指纹：
   - **复用机器上的 dsh** —— 扫描远端已装的 dsh，只补装本插件；不上传、不需要远端网络；
   - **上传 server 包** —— 按远端架构上传运行时包（Node + dsh）；本机已缓存则直接上传；
   - **远程下载** —— 从 GitHub Release 取对应架构的包（找不到时回退到本机构建）。

   首次连接某主机时会展示 SHA-256 指纹并等待 **信任并继续**；之后指纹变化会直接中止连接。
   进度依次是 连接主机 → 探测远端环境 → 部署运行时(Node) → 部署 dsh 与服务端 → 建立执行通道，
   失败时**连接日志**会保留在页面上。

### 4. Add a workspace and open a session

1. 连接行上点 **＋**（或 **⋮ → 添加工作区**）。在远端目录树里浏览——主目录 / 上一级 / 新建目录 /
   路径输入框——然后 **打开为工作区**。**工作区名称** 留空就用目录名；以后改名不会移动远端目录。
2. 工作区行会列出它的会话。点 **blank 行（`新会话`）** 新建，或点已有会话行继续。对话在主区
   打开，并从远端日志续上。

### 5. Day-to-day

| 动作 | 位置 | 作用 |
| --- | --- | --- |
| 连接 / 重新连接 / 断开 | 连接行 `⋮` 或 `＋` 位的插头图标 | 启动或停止远端运行时通道。断开时收起子树，重连时重新展开 |
| 添加工作区 | 连接行 `＋` | 把一个远端目录登记进**服务端**的工作区清单 |
| 新会话 | 工作区行 `＋` 或 blank 行 | 新建会话（远端真实日志） |
| 打开 / 继续 | 点会话行 | 从远端日志续聊，换设备同样可用 |
| 置顶 / 归档 | 会话行 `⋮` | 排序与视觉状态，存在插件自己的工作区记录上（归档行拒绝打开） |
| 重命名 | 会话行 `⋮` | 往远端日志追加一条官方 `session/title` 事件 |
| 分叉 | 会话行 `⋮` | 走 shell 自己的 `forkSession`，子会话同样落在远端 |
| 移除工作区 | 工作区行 `⋮` | 删除清单条目与本机 stub。**远端会话日志保留**，重新登记同一目录即可再看到 |
| 刷新 | 区域标题 / 工作区行 | 重新读取服务端的工作区清单与会话 |
| 删除连接 | 连接行 `⋮` | 忘掉本机记录、凭据与 stub；远端运行时与会话日志不动 |

## Using it well

- **会话是远端文件，不是镜像。** agent 写入的一切都追加在主机上
  （`~/.dsh/remote-server-sessions/<projectKey>/<sessionId>/`）。两台机器连同一台主机看到的是
  同一批会话；删掉本机 stub 不会删掉它们。
- **工作区清单归服务端。** 增删工作区改的是主机的 `workspaces.json`，第二个客户端下次刷新时
  会看到变化（轮询，不是推送）。
- **WSL 目标是本机的。** Windows 宿主上发行版就是执行世界：没有 sshd、没有 host key，部署走
  `wsl.exe`（多行脚本走 stdin，所以 zsh 等默认 shell 的发行版也能部署）。

## Troubleshooting

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| 安装或启动被拒，`incompatible-version` 指向 `engines.dsh` | 宿主不是 `0.2.1-rc.2`（本插件唯一验证过的版本） | 装回 `dsh` `0.2.1-rc.2`，或按 [Compatibility](#compatibility) 临时豁免 |
| `dsh-remote-workspace … failed to import`，随后官方行一直 pending | 包只进了 `dependencies`、没进 `dsh.profile.bundles`（桌面 profile 缺 SSH 包时常见） | 用 `dsh plugin --profile web add` 安装并重启 |
| `unsupported remote session protocol …` | 客户端与远端 server 的线协议（`3`）不一致 | 重新连接；插件版本变化时会重新部署它自己的 server bundle |
| 每条命令都报 `sandbox mode "workspace-write" … no sandbox backend is usable` | 远端世界没有可用沙箱后端（例如没有 bubblewrap/Landlock 的 WSL 发行版） | 属预期行为：远端世界就是隔离边界，命令在远端原样执行并报 `enforcement: 'partial'` |
| 侧栏没有 **远程工作区** 区域 | 插件没挂载（不是 `web` profile，或没有重启） | 用 `dsh --profile web --dump-config` 确认那一层存在，然后重启 |
| 首帧显示「该 server 上还没有工作区」，刷新后正常 | 面板渲染时工作区清单尚未就绪 | 刷新；已知的首帧观感问题 |
| 连接很早就失败 | 主机/端口/用户/凭据不对，或 host key 未信任 | 看向导里的 **连接日志**；用同一账号试 `ssh -v <host>`；检查私钥口令或 agent |

## Compatibility

| 项目 | 字段 | 取值 |
| --- | --- | --- |
| DSH 宿主 | `engines.dsh` | `0.2.1-rc.2` —— 精确值，唯一验证过的版本 |
| DSH 各包 | `peerDependencies` 里每个 `@deepseek-ai/dsh-*` | `0.2.1-rc.2` —— 精确值 |
| 清单格式 | `dsh.manifestVersion` | `1` |
| Node | `engines.node` | `^22.19.0 \|\| >=24.0.0` |
| 线协议 | `REMOTE_SESSION_PROTOCOL` / `server.hello` | `3` |
| 验证基线 | `devDependencies` | `@deepseek-ai/dsh-*` `0.2.1-rc.2`、`@deepseek-ai/cordis` `4.0.5` |

`0.2.1-rc.2` 写的是精确值而不是区间：它是本插件唯一验证过的版本，而后续 `0.2.x` 完全可能改掉
持久化后端、严格 `{ kind, executable }` 的 hello 形状，或行 / `data-slot` 契约。DSH 的准入只读
`engines.dsh`（存在时 peer 被忽略），所以 peer 也钉成同一个精确值。更低的版本起不来，更高的
版本只是**未测**。

其它版本的宿主会在 pnpm 下载或执行任何东西之前被拒。唯一的旁路是在 profile 的
`compatibility.json` 里按「包版本 × 运行时版本」逐对豁免：

```bash
dsh plugin --profile web allow-version dsh-remote-workspace@<已安装版本> \
  --dsh-version <宿主实际的 dsh 版本> --accept-risk
```

这种组合**不受支持**——没测过，失败模式包括崩溃与会话日志损坏。扩窗是一次发布动作：把
`devDependencies` 升到新版本，跑 `pnpm typecheck`、provider conformance 与浏览器验收，然后
在同一版本里更新两个仓库的 `engines.dsh`。

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

1. **传输** —— 带 host key 校验的 `ssh2`；WSL 目标改用 `wsl.exe`。
2. **部署** —— Node 运行时与目标平台的 `dsh` 依赖树被暂存或下载到 `~/.dsh/server`，本插件被
   上传到 profile 的 `node_modules/dsh-remote-workspace`。远端命令一律 `/bin/sh -c` +
   绝对路径，从不使用远端的 `PATH`、登录 shell 或系统 npm。
3. **持久化路由** —— `RoutingSessionPersistence` provide 官方 `sessionPersistence`：本地 cwd 用
   未改动的 JSONL 后端，远程工作区走远端 `persist.*` 平面。远程会话的 header cwd 仍是本地
   stub，官方 workspace 注册表照常工作。
4. **UI** —— 「远程工作区」区域用 shell 自己的行组件渲染「连接 → 工作区 → 会话」（行层内置在
   `src/client/vendor/workspace-rows/`）。

## Data and security

| 位置 | 内容 |
| --- | --- |
| 远端 `~/.dsh/server/` | 部署的运行时：`node/`、`dsh/`、暂存目录与组件标记 |
| 远端 `~/.dsh/profiles/dsh-remote-server/` | server 启动所用的 profile；本插件在 `node_modules/dsh-remote-workspace/` 下 |
| 远端 `~/.dsh/remote-server-sessions/<projectKey>/<sessionId>/` | **权威**会话日志（官方 JSONL，zstd） |
| 远端 `~/.dsh/remote-server/` | `server-id`（workspace id 的组成部分）、`workspaces.json`、`status.json`（0600） |
| 本机目标存储 | 连接、工作区、`pinnedSessions` / `archivedSessions` |
| 本机 `~/.dsh/remote-assets/` | 从 release 下载的运行时包缓存 |

- SSH 凭据与模型 API key 从不离开本机；发往 UI 或写入日志的内容都过 `scrubSecrets`。
- 未知 host key 必须显式确认（SHA-256）；指纹变化即中止连接。
- 所有插件 HTTP 路由都过 `trustedRequest`（DNS rebinding 与跨站防护），JSON 请求体上限 1 MiB。
- bundle 只新增自己的行并 disable 一条官方持久化行；不重写任何官方行，shell 自己的
  「添加工作区」按钮行为不变。

## Versioning and releases

- 仓库里的版本就是发布版本 `v0.1.0-alpha1`；新的公开里程碑才打新 tag `v0.1.0-alphaN`。
- server **运行时包**由 [server 仓库](https://github.com/graydovee/dsh-remote-workspace-server)
  构建并发布，tag 为 `server-v<dsh 版本>`（例如 `server-v0.2.1-rc.2`）。插件先找
  `server-v<dshVersion>`，再找 `v<pluginVersion>`，并对实际成功的那次传输校验 `.sha256`。

## Development

```bash
pnpm install
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run
pnpm build        # tsdown → lib/（host、server、浏览器三个 target）
```

测试覆盖：官方 provider conformance 对仓库内 `src/server` 副本、分帧 mux、`~/.ssh/config`
解析、部署、`persist.*` 句柄生命周期、路由持久层、包下载、WSL 探测与远端工作区服务。协议与
服务端实现与 server 仓库**逐字节相同**（`src/protocol.ts`、`src/server/`、`src/frame/`、
`src/provision/package-build.ts`），改一处必须两边同步改。侧栏行层用
`node scripts/vendor-workspace-rows.mjs --dsh <dsh-checkout>` 从 DSH 源码重新内置。

设计要点：[`docs/remote-session-agent-note.md`](docs/remote-session-agent-note.md) 与仓库的
`AGENTS.md`。

## Known limitations

- 远端会话不出现在 shell 的全局会话列表（shell 侧可能刷
  `uiConversation.binding: unknown session` 之类的噪音）。
- 还没有「删除会话」动作；目前只能到远端 `~/.dsh/remote-server-sessions/…` 手动删。
- 在 shell 自己的工作区区域里，对应的官方行是用 `display: none` 隐藏的，并未从 DOM 移除。
- 会话行不显示运行中/待审批状态点。
- 工作区标题存在服务端清单里，改名不会移动远端目录。
- 面板首帧可能短暂显示错误的空态。
- 下载的运行时包只缓存 `tar.gz` + `.ready`（含摘要），不保留 release 里的 `.manifest.json`。

## License

MIT
