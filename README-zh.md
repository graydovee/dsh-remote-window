# dsh-remote-workspace

[English](README.md) | 中文

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](package.json)
[![dsh](https://img.shields.io/badge/dsh-0.2.1--rc.3-blue.svg)](#compatibility)
[![npm](https://img.shields.io/npm/v/dsh-remote-workspace.svg)](https://www.npmjs.com/package/dsh-remote-workspace)

把一台 SSH 主机打开成 DeepSeek Harness 工作区。**server 是一台能独立工作的普通 DSH；本插件让它成为
client 的远程入口。** 工作区、会话、会话日志与共享视图状态都以 server 为权威。client 只加一条浮动
target rail，并把 server 的**完整官方 DSH UI 以同源 iframe 全屏铺满主区**——sidebar、header、对话、
右侧栏与第三方 UI 插件都是 server 上跑的那一份；client 不再自绘对话。

连接时选择 agent 的**模型请求**由谁服务：

- **local（默认）**：agent、会话日志与工具仍在 server，但每次模型请求经 SSH 反向隧道转发到 client
  本机的 OpenAI 兼容 endpoint。新 server 通常没配模型 key，所以默认走这里；endpoint 未配置时阻止
  连接，绝不静默回退到 server 模型。
- **server（可选）**：server profile 使用自己的模型配置；仅当 server 已配置模型凭据时显式选择。

两种来源写同一份 server 会话日志；切换模型来源需要重连，而不是换会话。

## Screenshots

![侧栏的「远程工作区」区域：连接 → server 工作区 → server 会话](https://raw.githubusercontent.com/graydovee/dsh-remote-workspace/main/assets/screenshots/01-remote-workspace.jpg)

client 只保留一个远程面：浮动 **target rail**（默认收起，hover 或 `Alt+R` 展开），列已保存连接、实时
阶段与连接/切换/忘记动作。连接后，server 自己的 sidebar 与对话就是导航；iframe 挂载期间 client shell
sidebar 隐藏。

## Why this exists

Harness 只在自己运行的机器上干活。当工作必须发生在别处——构建机、GPU 主机、预发服务器——有三种做法：

1. **把文件复制回来。** 镜像会漂移、冲突，两个人碰同一棵树就会悄悄出问题。
2. **所有东西都跑在远端。** 模型凭据和对话也跟着搬过去，换台电脑就没法接着干。
3. **server 保持普通 DSH，client 做它的远程入口。** 这就是本插件：目标机上跑 per-client profile
   server（`dsh web`），client 通过 SSH 访问它，server 官方数据保持权威。

由此得到三条不变量：

- **凭据不过线。** server 模型来源用 server 自己的凭据；local 来源的 key 只存 client 凭据库，由 bridge
  注入。SSH 密钥只在 client。错误、日志与流式明细都会脱敏。
- **目标机不监听公网端口。** profile server 只绑 `127.0.0.1`，client 经 SSH `forwardOut` 访问。
- **每 client 一个 profile，每会话一个写者。** server 插件持有 client lease；官方 JSONL flock 跨进程
  裁决会话写者，第二个写者会得到明确的 `session/writer-held`，而不是静默写坏日志。

如果你只需要“在一台服务器上改文件”，官方 SSH profile（`dsh-ssh` + `fs-ssh` + `subprocess-ssh` +
`sandbox-ssh`）更小，也不需要装插件。

## How it compares

| | 官方 SSH profile | 文件路由类插件 | 本插件 |
| --- | --- | --- | --- |
| 工具在哪执行 | 远端 | 远端 | 远端 |
| 一个界面里多个 target | 每台一个 profile | 支持 | 支持 |
| 会话日志权威 | 本地 | 本地 | **server** |
| 工作区/pin/archive/顺序 | 本地 | 本地 | **server（跨 client 共享）** |
| 连接的模型来源 | 固定本机 | 固定本机 | **local 隧道或 server** |
| 换台电脑继续 | 不行 | 不行 | **可以** |

## Architecture

```mermaid
flowchart LR
  subgraph client [你的电脑]
    UI[client Web UI<br/>target rail · 全屏 iframe]
    CHOST[client DSH host<br/>portal · P1 客户端 · profile 生命周期]
    LOCAL[本机模型 bridge<br/>127.0.0.1 临时端口]
    LLM[(你的 OpenAI 兼容 LLM)]
  end
  subgraph server [SSH 目标机]
    PROF[per-client profile server<br/>官方 DSH UI · agent]
    PLUG[server 插件<br/>P1 RPC · SSE · mux · embed]
    OFF[官方 DSH 服务<br/>workspaceRegistry · sessionPersistence · sessionController]
    LOG[(server ~/.dsh/sessions<br/>workspace registry · 视图状态)]
  end
  UI -->|同源 iframe| CHOST
  CHOST -->|portal 字节代理<br/>forwardOut| PROF
  CHOST -->|P1 HTTP/SSE/WS| PLUG
  PROF -->|模型请求经<br/>反向隧道 + bridge| LOCAL
  LOCAL --> LLM
  PLUG --> OFF --> LOG
  PROF --> OFF
```

client host 负责 SSH、host key pin、runtime/插件部署、per-client profile 生命周期、P1 客户端、同源
portal 与本机模型 bridge/tunnel。server 插件负责握手/租约、包装官方服务的 workspace/session API、
registry 写守卫、执行世界 WS mux 与 embed bootstrap/CSS。`dshRwFull=1` 让 embed 不再注入隐藏 sidebar/
rightbar/bottom 的 CSS，因此 iframe 里就是真实的 server UI。逐字契约见
[doc/refactor-v3-full-ui.md](doc/refactor-v3-full-ui.md)、
[doc/refactor-v1-architecture.md](doc/refactor-v1-architecture.md) 与
[doc/refactor-v1-protocol.md](doc/refactor-v1-protocol.md)。

## Feature breakdown

**官方 UI 全屏 iframe。** client main slot 只挂一个同源 iframe，加载 profile server 的官方 `dsh web`
UI，请求带 `dshRwFull=1`。portal 剥掉 client GUI cookie、注入 profile 自己的 cookie、不转发
`Set-Cookie`，且 token 不进入 iframe URL。iframe sandbox 固定为
`allow-scripts allow-same-origin allow-forms allow-popups allow-downloads`。iframe 挂载期间 client
shell sidebar 隐藏，target rail 保留可用。

**local 模型来源。** server profile 的 `cordis.patch.yml` 声明一条官方 `llm-pi-ai` OpenAI 兼容
route（`client-local`），指向 `http://127.0.0.1:<随机>/v1`。该端口是 SSH `forwardIn` 反向隧道，终止
在 client 的 loopback-only bridge。bridge 只转发 `/v1/*`，把请求里的 `Authorization` 注入/覆盖为
client 官方凭据库中的 key，不落日志；profile 只看到占位 key。endpoint、模型 id 与超时是 client 设置；
endpoint 不可达、HTTP 401、模型列表为空或 sshd 拒绝转发都返回带 code 的可操作错误，绝不静默回退
server 模型。

**server 权威数据。** workspace 清单/标题/顺序/pin/archive 来自 server 官方
`workspaceRegistry`；session 清单/标题/blank/running 来自 `sessionController` + 插件 JSONL title fold。
rename/fork/pin/archive/拖拽都调官方服务。搜索仅 client 内存过滤。

**per-client profile 与 runtime。** 每个 client 生成稳定 `clientId`，server 上用
`graydovee-remote-workspace-<clientId>`。专用 profile 与 server 插件从 client 包内置的
`dsh-remote-workspace-server-<version>.tgz` 离线安装；独立 Node+DSH runtime 自动安装/升级（或只读复用
已验证的全局 DSH）。profile lease 拒绝第二个驱动实例。

**Host key 必须确认。** 首次连接展示 host key SHA-256 并等待显式确认；之后 key 变化会中止连接。

**沙箱与权限。** server profile 为 iframe 里的 agent 挂官方 sandbox provider/policy；没有隔离 backend
时明确返回 partial enforcement 并在 server 执行，不假装已隔离。v2 executor 的远端执行世界仍保留在
代码/数据中供旧会话使用，但新主区不再进入。

## Quick start

装进 client 的 `web` profile（Plugins 页面或 CLI）：

```bash
dsh plugin --profile web add dsh-remote-workspace
```

pnpm 可能拦截 `ssh2` 的可选 native 构建脚本；用 Plugins 页面安装，或首次运行加
`--config.strict-dep-builds=false`。已安装但未启用时，在 Plugins 页面启用（或把
`dsh-remote-workspace` 加进 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles`）。重启服务
`dsh web` 的进程并刷新页面。

从 checkout 构建安装：

```bash
pnpm install && pnpm typecheck && pnpm test && pnpm build
pnpm pack --pack-destination ~/.dsh/tarballs
dsh plugin --profile web add ~/.dsh/tarballs/dsh-remote-workspace-<version>.tgz
```

client 包内置 server 插件 tarball，因此目标机不需要网络或包管理器。然后：

1. 打开浮动 **target rail**（hover 或按 `Alt+R`），点 **新建连接**。
2. 选择 `SSH`，填目标信息，首次连接确认 host key 指纹。
3. 选择模型来源：**local**（默认；填 OpenAI 兼容 endpoint、模型与可选 key，连接前 client 会探测
   `/v1/models`）或 **server**（使用 server profile 自己的模型配置）。
4. 查看探测结果。client 检查 server 的 Node/DSH 运行时与 server 插件，决定后续步骤是部署、更新还是
   跳过；随后启动 profile server，选 local 模型时打开 SSH 反向隧道，并完成握手鉴权。失败的尝试不会
   保存。
5. 成功后该 target 自动激活，server 官方 DSH UI 在 iframe 中全屏打开。用 server 自己的 sidebar
   建工作区、开会话；切换 target、重载 iframe、忘记连接都在 rail 上完成。

## Model source and session ownership

- 模型来源是连接设置，不是会话内热切换：更改它要按 D20 cancel → `whenIdle`/flush 后重启 profile。
  对话、会话 id 与日志不变。
- local 模型来源下，profile 的 `client-local` route 经 sshd 反向隧道指向 client host 持有的 bridge。
  断开或异常退出会关闭 bridge、隧道、profile 及其进程，不留下孤儿端口。
- **D20：** 如果 profile 还有 active turn，重启/切换对话框会列出它们并要求显式确认后才一起取消，绝不
  静默打断会话。
- 同一会话只能有一个写者。iframe 里的官方 UI 打开/resume 会话并持有官方 JSONL 锁；第二个实例打开
  同一会话会得到 `session/writer-held`。
- 断开连接会停止 per-client profile server、关闭 portal/隧道并取消该 profile 的 turn；server 日志、
  工作区与共享视图状态不受影响。

## Compatibility

当前只对这一个运行时做过验证：

| 插件 | 已验证 DSH 运行时 | 状态 |
| --- | --- | --- |
| 0.1.0-alpha.3 | 0.2.1-rc.3 | verified |
<!-- verified-runtimes -->

本版本针对 DSH `0.2.1-rc.3` 构建、打包并测试；`0.2.1-rc.2` 已不在已验证集合内，默认会被精确版本
守卫拒绝，除非显式豁免该组合。检查项、剩余范围与升级步骤见
[doc/dsh-rc3-compatibility.md](doc/dsh-rc3-compatibility.md)。

声明是**精确版本**，不是区间：清单把 `engines.dsh` 与全部 `@deepseek-ai/dsh-*` peer 钉在上面的运行时，
客户端也只在 server 版本属于已验证运行时时才接受它。DSH 还是开发者预览版；未验证版本会被一条可操作的
错误拒绝，而不是跑到一半失败。

如果确实要在本机试别的 DSH 版本，对这一对精确版本做豁免，并把结果视为不受支持：

```bash
dsh plugin --profile web allow-version dsh-remote-workspace@<已安装版本> \
  --dsh-version <运行时版本> --accept-risk
```

豁免只覆盖本机宿主；server 必须运行已验证运行时——client 安装的独立 runtime，或复用该精确版本的全局 DSH。

独立 runtime 会优先复用 `~/.dsh/remote-assets/` 中该平台/版本的缓存包；缓存没有时，client 用本机 pnpm
按同一 `node/` + `dsh/` 布局构建并上传，因此升级 DSH 后首次连接可能慢一些，之后直接复用。构建只写入
专用 profile 的独立 runtime，不改 server 的全局 DSH 或其它 profile。

## Data and security

| 位置 | 内容 |
| --- | --- |
| client `~/.dsh/storages/dsh_remote_workspace.json` | 连接记录（含模型来源）、本机模型 endpoint/模型/超时、包策略、旧 workspace refs（会清理） |
| client `~/.dsh/.credentials.yaml` | SSH 凭据与本机模型 API key（官方存储，`0600`） |
| client `~/.dsh/remote-workspaces/<clientId>/…` | v2 local 会话的私有 anchor（保留，非权威，不再展示） |
| client `~/.dsh/remote-assets/` | 本机 runtime/包缓存 |
| server `~/.dsh/sessions/**` | 权威会话日志（两种模型来源共用） |
| server `~/.dsh/storages/workspace.json` | 权威 workspace registry、pin/archive/顺序 |
| server `~/.dsh/profiles/graydovee-remote-workspace-<clientId>/` | 专用 profile、server 插件、lease、日志 |
| server `~/.dsh/remote-workspace/<clientId>/runtime/` | 独立 Node/DSH runtime |
| server `~/.dsh/remote-server-sessions/**`（旧） | 保留、不展示、不迁移 |

本机模型 API key 不会到 server 或浏览器：它只存 client 官方凭据库，只由 loopback bridge 读取并注入
转发的请求；server profile 只看到占位 `DSH_RW_LOCAL_LLM_KEY`。SSH 凭据也只在 client。profile server
的启动 token 与官方 cookie 只在 client host 内存，浏览器永远拿不到；portal 剥掉 client cookie，且不
转发 `Set-Cookie`。每个插件 HTTP 路由都做同源/可信主机校验并限制 body 大小；错误、日志与流式明细经过
脱敏。凭据文件本身由 DSH 凭据存储写入。

## Known limitations

- **D19：多 client 是刷新/重连后一致，不是实时推送。** 两个 client 共享 server 的 workspace/session/
  视图状态，但另一个 client（或 server 全局 DSH）的改动要在刷新/重连后可见；server 全局 DSH 独立可用，
  client 的改动可能需要重启全局 DSH 才显示。
- **v1 全局 runtime 只复用、不修改。** client 会检测并只读复用已验证的全局 DSH；安装/升级共享全局
  runtime 或其它 profile 的插件会被拒绝并给出可操作错误；只有专用 per-client profile 与独立 runtime
  会自动安装。
- **不删除会话。** 官方 DSH 没有该能力，本插件也不新增。
- **local 模型来源是默认。** 新连接默认走 client bridge（新 server 通常没配模型 key）；配置 server
  凭据后再显式选 server 模型来源。更改来源需要重连。
- **v2 executor（远端执行世界）不再被主区使用。** iframe 始终驱动 server agent。记录过 v2 `local`
  executor 的旧会话留在数据里，但新 UI 不再进入；详见
  [doc/refactor-v3-full-ui.md](doc/refactor-v3-full-ui.md)。
- **每个 client 只挂一个 iframe。** 打开第二个远程 target 会替换 frame（前一个 target 断开或在 rail
  中保持非激活）。没有两个 server 的分屏。
- **本机模型 bridge 只支持 HTTP（`/v1/*`）。** 本机 endpoint 的 TLS 尚未实现；endpoint 需在 client
  本机以明文 HTTP 可达。
- **sshd 必须允许反向转发。** 若 `AllowTcpForwarding`/`GatewayPorts` 策略拒绝 `forwardIn`，连接会以
  可操作错误失败，绝不静默改用 server 模型。
- **重启 profile 会取消它的所有 turn。** 普通刷新只重读数据；加载 workspace registry 变更用进程内官方
  service reload；完整重启 profile 是 fallback，且必须经过 D20 确认。
- **target rail 是 client 插件 UI。** 需要 client 的 `web` profile；desktop/headless profile 不是本界面支持的 target。
- **server 世界是 POSIX。** SSH 目标需提供 POSIX shell；v1 已退役 WSL/Docker 连接方式（Docker 只用于 QA）。

## Troubleshooting

| 症状 | 检查 |
| --- | --- |
| `incompatible-version` | 本机装 DSH `0.2.1-rc.3`，或对该精确版本做豁免（见 Compatibility）。 |
| 没有 target rail | 插件必须已安装并在 `web` 启用；重启 `dsh web` 并刷新。hover rail 或按 `Alt+R` 展开。 |
| `server-plugin-missing` / `server-plugin-version-mismatch` | client 包内置的 server 插件 tarball 丢失/版本不匹配；重装 client 插件后重连。 |
| `server-plugin-integrity-failed` | 内置/下载的 server 插件 sha256 校验失败；重装 client 包。 |
| `profile-in-use` / `profile-foreign-client` | 另一个 client 实例在驱动该 profile，或 clientId 被复制。用持有实例重试，或删除本机连接记录后重连。 |
| `registry-stale` | 另一个进程改了 server workspace registry。点远程段刷新；仍失败则按 D20 确认后重连（重启 profile）。 |
| `session/writer-held` | 该会话已被另一个实例驱动。等它结束，或刷新/重连；日志不会被写坏。 |
| `runtime-global-unsupported` / `plugin-profile-not-managed` | v1 不修改共享全局 runtime/其它 profile；使用专用 profile/独立 runtime。 |
| `local-llm-*`（如 `local-llm-unreachable`、`local-llm-tunnel-failed`、`local-llm-models-empty`） | 检查 client 本机 endpoint、key，或 server sshd 的反向转发策略；修好后重试，或改选 server 模型来源。 |
| `mode-switch/cancel-failed` / `shutdown-flush-timeout` | 重启前有 turn 取消失败/未完成落盘；UI 会列出，等它们收尾后重试。 |
| SSH 在部署前失败 | 检查账号、密钥权限、agent 与指纹；`ssh -v <host>` 是好用的下一步。 |
| 命令提示没有可用的沙箱 backend | 目标机没有隔离 backend；这是文档化的 partial enforcement 路径。 |

## Development

[AGENTS.md](AGENTS.md) 是开发契约（v3 边界、逐字节共享文件、存储与安全不变量、发布流程）。当前主区与
模型来源契约见 [doc/refactor-v3-full-ui.md](doc/refactor-v3-full-ui.md)；协议仍见
[doc/refactor-v1-architecture.md](doc/refactor-v1-architecture.md) 与
[doc/refactor-v1-protocol.md](doc/refactor-v1-protocol.md)。server 半边在
[dsh-remote-workspace-server](https://github.com/graydovee/dsh-remote-workspace-server)。

## License

MIT
