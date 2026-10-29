# AGENTS.md — dsh-remote-window（v3）

本文件是维护者与代码 agent 的开发契约；用户文档见 README。v1 基线（profile/双模式/协议）以
`doc/refactor-v1-requirements.md`、`doc/refactor-v1-architecture.md`、`doc/refactor-v1-protocol.md` 为准；
v3 的 server 主区是 **server profile 官方 DSH UI 的全屏同源 iframe**（client 不再自绘对话），模型来源
有 **local（client 本机模型，默认）** 与 **server（server 自身模型）** 两种，契约见
`doc/refactor-v3-full-ui.md`。v2 的 native 主区代码暂留但不再注册/挂载，验收后删除。文档与代码冲突时，
先以可复现实现修正，不得静默改需求。旧文件 `doc/architecture.md`、`doc/api-contract.md`、
`doc/acceptance-gap.md` 中的 stdio/WSL 段落只是历史背景，不再作为实现契约。

## 项目边界（v3）

- **server 是一台能独立工作的普通 DSH；client 是它的远程入口。**
- 本仓库是 **client 半边**：`dsh-remote-window` 插件（host 行 + browser client + local 模式执行世界）。
- server 运行普通 `dsh web` + 每个 client 一个专用 profile
  `graydovee-remote-window-<clientId>`，其中安装 server 插件 `dsh-remote-window-server`
  （独立仓库发布；client 包内置精确同版本的 tarball）。
- client 通过**一条 SSH 连接**访问 server；profile server 只绑 `127.0.0.1`，不监听公网端口。
- 主区：client 的 main slot 只挂载一个同源 iframe（`/dsh-remote-window/portal/<targetId>/?dshRwFull=1`），
  显示 server profile 的完整官方 DSH UI；client shell sidebar 在 iframe 挂载期间隐藏，浮动 target rail
  是唯一的 client chrome。官方 UI 的 sidebar/header/主区/rightbar/插件 UI 全部由 server 提供。
- 模型来源（连接设置，非会话内热切换）：`local`（默认，agent/日志/工具仍在 server，模型请求经
  SSH 反向隧道转发到 client 本机）与 `server`（server profile 自己的模型）。local 的默认接入方式是
  **自动代理本机模型**：client host 用 `ctx.llm` 枚举本机全部 provider/model，经一条反向隧道暴露成
  server profile 的多个 `llm-pi-ai` route（每个 provider 一条 `remote-*` route，路径前缀区分）。
  连接对话框的 **高级选项** 列出发现到的全部 provider 与模型（默认全选，可逐项勾选/按 provider 全选
  或清空/刷新），所选集合持久化在 client 设置里，并决定 profile patch 生成哪些 route；不要把手动
  endpoint 当作高级选项的主交互（host 侧 manual 模式仅为旧 API/测试保留，UI 不再暴露）。切换需重连
  （D20：cancel → whenIdle/flush → 重启 profile）；本机发现不到模型或 provider 不可用时用专用
  `local-llm-*` 错误码拒绝，不静默回退到 server 模型。
- v2 的 executor（local agent 执行世界）保留在数据/旧会话中，但 iframe 主区始终由 server 官方 UI 打开
  server agent；新连接不再走 client native 主区。
- 目标机运行 `dsh --profile <p> --host 127.0.0.1 --port 0 --no-open`，stdout 打印
  `dsh web: http://127.0.0.1:<port>/?token=<token>`；client 经 SSH `forwardOut` 访问它。
- 公开仓库不得写入真实主机、用户名、内网地址、本机绝对路径、密码、token 或私人部署信息。示例使用
  `tester@203.0.113.10`、`/home/user`、`/tmp/...`。Git 身份/push 凭据用开发者本地配置。

## 本地命令

Node 22.19+ 或 24+；依赖管理只用 pnpm。

    pnpm install
    pnpm typecheck
    pnpm test
    pnpm build
    pnpm pack --pack-destination ~/.dsh/tarballs

额外命令：

    node scripts/vendor-workspace-rows.mjs --dsh <0.2.1-rc.2 checkout> \
      --source-label 'dsh-v0.2.1-rc.2 (687f282e86)'
    node scripts/bundle-server-plugin.mjs --tarball <server-plugin tgz>
    DSH_SMOKE_CLI=<dsh 启动器> npx vitest run tests/profile.smoke.test.ts

`src/client/vendor/workspace-rows` 的 provenance 仍是 rc.2（rc.3 只升级运行时钉版，vendor DOM 未改）。
升级运行时或重新 vendor 前，按 `doc/dsh-rc3-compatibility.md` 复核 row API/样式边界。

`pnpm typecheck` 是 `tsc --noEmit`，没有 lint 脚本。`pnpm build` 生成 host/client 产物；`lib/` 已入库但
绝不能手改，必须改 `src/` 后重新构建。

## 两仓共享文件（逐字节）

P1 的逐字节契约只有三个文件：

    src/protocol.ts
    src/frame/codec.ts
    src/frame/mux.ts

改动任一文件必须在两个 checkout 同一次变更中修改、构建、测试，并在提交前比较：

    for f in protocol.ts frame/codec.ts frame/mux.ts; do
      cmp -s "src/$f" "../dsh-remote-window-server/src/$f" || echo "DIFF: $f"
    done

旧 stdio server bundle 的 8 文件同步集（`src/server/**`、`src/frame/psk.ts` 等）已退出 v2 契约并删除；
不要恢复。`src/protocol.ts` 中旧 `REMOTE_SESSION_PROTOCOL=3` 类型随旧 server 一并移除。

## 架构与依赖方向

tsdown targets：

1. **host**：Node ESM，入口 `index` 以及 loader 需要的子入口（protocol/connection/rsession/
   session-persistence）。
2. **client**：浏览器 CJS 工厂，经 `window.__ModuleLoader__.load` 注册；只 external 平台模块；Node
   内置模块/非 inline-safe 跨插件值导入触发纯度门禁；跨插件协作走 Cordis service。

主要目录（v3）：

    src/index.ts                 插件 host 行：HTTP/SSE 路由、portal、v1/P1 接线
    src/local-llm/              本机模型：设置/凭据、/v1 代理 bridge、SSH 反向隧道、profile patch
    src/portal/                  同源反向代理（HTTP prefix + WS exact、Host/Origin/cookie 规则）
    src/remote/                  P1 插件客户端：tunnel HTTP、handshake、mux WS、帧适配
    src/ssh/                     ssh2 连接、host key、forwardOut
    src/targets/                 target 记录、clientId、凭据引用、脱敏
    src/provision/               runtime/专用 profile/server 插件离线安装、profile 生命周期
    src/session/                 executor 状态机、anchors、local runtime/session、mode apply
    src/session-persistence/     本地 JSONL 与 server persist.* 的路由层
    src/rsession/                remote persist 门面
    src/preset/world.ts          local 模式执行世界 preset
    src/connection/              执行世界：ctx.ssh → RemoteMux 适配
    src/client/                 v3 远程段 UI：浮动 target rail、连接对话框、portal iframe 主区；
                                v2 native 主区/官方 vendor 暂留但不再注册
    assets/server-plugin/        内置 server 插件 tarball + checksums.json

依赖方向：`targets → ssh/provision → service → session/connection → client`。client 只能依赖平台模块和
明确的纯模块（如 `targets/methods.ts`），不得 import host service 或 Node API。

## 不能违反的行为约束

**安全**

- SSH 凭据、模型 API key 和任何 secret 只在需要的一端；错误、日志、SSE detail 必须 scrub。
- 未知 SSH host key 展示 SHA-256 并等待显式确认；已 pin 的 key 变化必须中止。
- profile server 的 token/官方 cookie 只在 client host 内存；浏览器永远拿不到；portal 不转发
  `Set-Cookie`，不把 client GUI cookie 带给 server。
- 每个 client 插件 HTTP 路由先过 `trustedRequest`，body ≤ 1 MiB；server 插件路由/WS 先过
  `ctx.connection.admit(req)`，body ≤ 1 MiB（mux/portal 流除外）。
- 不替换官方全局服务；server 插件对官方 `workspaceRegistry` 的 prototype 写守卫是**唯一**受控例外，
  必须带版本守卫、幂等标记与失败降级（architecture §4）。

**数据权威**

- workspace 清单/标题/id/顺序/pin/archive：server 官方 `ctx.workspaceRegistry`，id 用官方 uuid；不得再
  引入 `sha256(path)` 工作区 id，不得保留插件自己的 pinned/archived/order 副本。
- 会话清单/标题/运行态/rename/fork/cancel：server 官方 `ctx.sessionController`；标题必须由插件 JSONL
  title fold 补齐（按 `(sessionId,sizeBytes)` 记忆化，尾部回刷 `session/title`；blank 判 `turn/start`）。
- 会话日志读写：官方 `ctx.sessionPersistence`，单写者由官方 JSONL flock 裁决；不得自造锁/抢占。
  `SessionAlreadyOwnedError` 呈现为 `session/writer-held`；v1 用**显式错误**，不做只读/接管。
- 存储域 `dsh_remote_window` 版本恒为 1；只能加 optional 字段。旧 workspace refs 清理，不做 bump。
- local 模式 anchor 是插件私有材料（`<DSH_HOME>/remote-windows/<clientId>/<targetId>/<hash>`），
  绝不注册进官方 workspace registry、不出现在本地工作区列表；随插件/连接清理。
- 搜索是 client 瞬时过滤，不落盘、不发 P1。
- 删除会话：官方无能力，v1 不做。
- 远端会话 header cwd 是 server 真实路径；local 模式 client routing 负责 anchor ↔ server path 重锚，
  协议不隐式翻译。

**执行端与占用**

- 新连接默认 **modelSource=local**（server 通常没配模型 key）；连接设置存 client，target 记录用可选
  `modelSource` 持久化。server 模式必须在对话框显式选择。
- local 模型生命周期：解析计划（默认 `auto`：`ctx.llm.listProviders()/listModels()` 枚举本机
  provider/model，再按高级选项保存的 `localSelection` 过滤——未保存选择表示全量代理，过滤后为空则
  `local-llm-no-models`；`manual` 仅为旧 API/测试保留）→ 启动 client bridge（auto 是
  `ctx.llm.stream()` 的 OpenAI 兼容原生代理，manual 是 `/v1/*` 注入 key 的转发桥）→
  `ssh2.forwardIn('127.0.0.1', 0)` 取得 server 回环端口 → 重写 profile `cordis.patch.yml`（auto 每个
  provider 一条 `remote-<slug>` route、manual 一条 `client-local` route；`apiKeyEnv=DSH_RW_LOCAL_LLM_KEY`
  占位）→ 启动 profile。失败必须 coded error，禁止 fallback 到 server 模型；
  `stop()`/`reconnectLost()`/连接失败关闭 bridge+tunnel，禁止孤儿端口。bridge 必须把 adapter 的
  error/aborted 终止 chunk 转成显式错误（started 前 502 JSON、started 后 error chunk），不得映射成
  stop，否则 server 侧只会看到 EMPTY_RESPONSE。
- auto 模式不需要 key（本机 provider 自己的凭据在本机解析）；manual 的本机 key 只进官方
  `ctx.credentials`（固定 key），浏览器只看到 `hasApiKey`；bridge 注入/覆盖 Authorization，
  日志/错误/SSE 不得出现 key。
- 切换按 D20：preview 必须列当前 turn + 其它 active turn；apply 必须带 `previewRevision` 与
  `cancelActiveTurns:true`；缺清单拒绝执行；任何取消失败显式报错。
- 主区是 **官方 UI 全屏 iframe**（`portal-main.tsx`，`SERVER_MAIN_ID`）：连接成功/rail 激活 → 
  `openServerMain`；断开/忘记/连接离开 ready → `closePortalFor`。iframe key 必须含
  `targetId:revision:reloadCount`，重连/切换 target 必须重挂载，不能复用上一个 profile 的缓存文档。
  20 s 未收到 `dsh-rw/ready` 显示可重试错误；token 不得出现在 iframe URL。
- iframe sandbox 固定 `allow-scripts allow-same-origin allow-forms allow-popups allow-downloads`；
  不开放 top-navigation。portal 仍是纯字节代理，剥 client cookie、注入 server cookie、剥 `Set-Cookie`。
- `dshRwFull=1` 让 server embed 不隐藏官方 sidebar/rightbar/bottom；client 侧在 iframe 挂载期间用
  `html[data-dsh-rw-portal]` 隐藏 shell 自己的 sidebar 并收窄 root grid。
- 打开 portal **必须带 `dshRwSession` 深链**（`portalSessionFor`：优先 host state 里最近的非 blank
  会话，否则 `session/create` 建 blank）；裸开 portal 会落到官方首启 composer（“选择一个工作区开始”）
  且 iframe 内无法恢复。深链只写 `dsh.sessions.current`，不 reload、不换写者。
- 开发说明（不是模型 prompt）：local 模式只注入 remote working-directory + execution host；SSH/mux/
  sandbox/anchor 生命周期属于 DSH/插件实现，不进入模型上下文。SSH 意外关闭自动重连最多 5 次（指数
  退避）；认证/host-key 错误不重试，用户主动 stop 不触发。
- 停进程/释放 handle 前必须 cancel → `agent.whenIdle()`（3 s 预算）→ `sessionPersistence.flush()`；
  超时不得静默 SIGTERM。
- local 模式打开顺序：host 先 create/resume 让 client catalog 有 summary，再 `uiWorkspace.openSession`；
  超时显示可重试错误，不吞点击。
- 断开/删除/切换清理 client 官方 selection：用受运行时守卫的 `uiWorkspace.clearMain()`；fallback
  `ctx.layout.selectPanel(null)`，只清属于本 target 的 `dsh.sessions.current`，绝不误清本地会话；
  禁止白屏（I3）。

**profile / 部署**

- 启动命令固定：`DSH_HOME=… PATH="<runtime>/node/bin:<runtime>/dsh/node_modules/.bin:$PATH" exec <dsh>
  --profile <p> --host 127.0.0.1 --port 0 --no-open`；`--profile` 在 app 参数前，不要写
  `dsh web --profile`。
- 解析 stdout 单行 `^dsh web: http://127\.0\.0\.1:(\d+)/\?token=([A-Za-z0-9_-]+)$`；token 只进
  `server.log`（0600）和 host 内存。
- 单 client profile lease（clientId/instanceId/pid/port/heartbeat，TTL 20 s）在 server 插件；第二实例
  `profile-in-use`、异 client `profile-foreign-client`、stale 才可接管。
- 专用 profile：离线解包内置 `dsh-remote-window-server-<client-version>.tgz` + 写 4 个 profile 文件
  + marker；不依赖 server 网络/pnpm。marker 不匹配才重装；失败 `server-plugin-*` 错误，不静默回退。
- 独立 runtime 自动安装/升级；全局 runtime 只检测复用，v1 拒绝修改共享全局 runtime/非专用 profile
  插件，返回 `runtime-global-unsupported` / `plugin-profile-not-managed`，不得静默写。目标版本没有缓存
  artifact 时，client 复用 host pnpm 在 `~/.dsh/remote-assets/` 构建 `node/`+`dsh/` 包再上传；构建结果
  与 server 仓库发布的 runtime 布局一致，失败才报 `runtime-missing`。
- 一个 profile 一个 client；client 断开 → cancel/flush → 停 profile server、关隧道。
- 已保存 target 的重连必须复用上次 connect 解析出的 **绝对 `remote.dshHome`**
  （`targets/methods.ts` `reconnectDshHome()`，请求显式值优先，`~`/空/相对路径才回退远端扫描）；
  否则 profile patch/隧道会写到默认 home，server 继续调用旧 bridge 端口。回归测试
  `tests/targets-reconnect.test.ts`。
- 不新增版本区间：运行时契约唯一来源 `DSH_VERIFIED_RUNTIMES`，只接受实测 `0.2.1-rc.3`。
- `engines.dsh` 与全部 `@deepseek-ai/dsh-*` peer 精确 `0.2.1-rc.3`；zod 固定 `4.4.3`；
  `engines.node` 保持 `^22.19.0 || >=24.0.0`。
- `@deepseek-ai/dsh-ssh`、`dsh-fs-ssh`、`dsh-subprocess-ssh`、`dsh-sandbox-ssh` 是精确版本
  **dependencies**（harness 安装里没有；local 模式按值 import/按名挂载）。
- 版本号由仓库发布版本决定（当前 `0.1.0-alpha.3`）；内置 server 插件 tarball 版本必须与它精确一致。
  本机调试可用修订后缀，但部署后 `git checkout -- package.json`，修订号永不提交/发布。

**官方 UI（iframe，硬约束）**

- server 主区必须显示 **完整、未改写的官方 DSH UI**：sidebar、header、主区、rightbar、插件 UI 都由
  server profile 提供，client 不得叠加自绘标题栏/会话树/常驻侧栏。
- client 唯一 chrome 是浮动 target rail 与连接对话框；rail 默认折叠、hover 或 `Alt+R` 展开，只列
  target/连接状态/切换动作，不复制官方 workspace/session 树。
- rail 可拖拽并吸附到屏幕四边（`src/client/rail.tsx` 的 `snapRailPlacement`/`clampRailPlacement`）：
  收起时跟随吸附边（左右为 44px 竖排图标条，上下为 44px 横排图标条）；**展开后无论哪条边都渲染
  同一个 280px 竖向列表**（按视口限高、列表纵向滚动），上下吸附展开时列表贴在上/下边缘、水平位置
  夹在视口内（`railBoxStyle`）。位置存 `localStorage['dsh-remote-window.rail-dock']`，未手动拖动
  前 portal 打开时自动靠右；展开/收起使用 200ms 过渡，`prefers-reduced-motion` 下关闭动画。
- rail 收起态在连接数 > 1 时末尾多一个折叠按钮（左右吸附在最后一个图标下方，上下吸附在图标条右端），
  点击最小化为单个 `+N` 图标（N = 连接数），最小化期间 hover 不展开；再点 `+N` 直接一步进入展开态
  （等价 hover 展开），指针移开后回到收起条。最小化是会话内状态（不持久化），连接数降到 1 自动恢复。按钮**在 rail 卡片内部**（竖排在最后
  一个 chip 下方、横排在 chip 条右端），但不属于负责 hover 展开的 `.dsh-rw-rail-hover` 组：指针指到
  按钮不会触发展开。图标指向收起方向（竖排向下、横排向左折回），hover 展开/最小化/单连接/拖拽期间
  隐藏（`railShowsToggle` 只看 expanded/minimized/count）。不把按钮移出 hover 组会回到「hover 按钮 →
  rail 展开 → 按钮消失 → 闪烁」的老 bug。
- `dshRwFull=1` 只控制 server 插件不注入隐藏 CSS；不得在 client 侧用自定义 CSS 覆盖官方视觉。
- 官方 iframe 的滚动、下载、弹窗、剪贴板必须在 sandbox 内可用；新增权限需在本文与
  `doc/refactor-v3-full-ui.md` 同步说明。
- v2 的 `assets/official-ui/`、vendored 行组件与 native 主区在验收后删除；删除前不得再向其中添加
  生产路径引用。

**UI 复用**

- 官方行是 vendor 组件（`ProjectRowItem`/`SessionNodeItem`）：不得重写行样式/加缩进；改动前重跑
  `scripts/vendor-workspace-rows.mjs` 并保留 NOTICE 来源；复用边界/自实现清单见
  `doc/official-workspace-reuse.md`（v2 以 §13 为准；§12 为 v1 历史）。
- 对话框/toast 挂在浮动 target rail 的树上；同一类浮层用 `useSingleHost`。
- 隐藏 shell 官方行选择器必须带 `[data-slot="sidebar.workspaces"]` 前缀，只改 `display`。
- 远程段不写 client 共享 `workspace.json`/`sessions`；会话日志只写 server。
- embed/portal 是 **v3 主路径**：server 插件 `tapIndex` 注入 bootstrap/CSS，portal 保持纯字节代理、
  不解析 HTML；`full=1`/`dshRwFull=1` 只关掉隐藏 CSS，不改官方行为。storage shim 前缀只影响 iframe
  realm；深链/切换遵守 protocol §9/§16.2。
- 重新安装后必须让插件批量 URL 的 rev 变化，否则浏览器缓存旧代码。

## 数据位置与清理

| 位置 | 内容 |
|---|---|
| client `~/.dsh/storages/dsh_remote_window.json` | target 记录（含 `modelSource`）、`localLlm` 模式（auto/manual 兼容）/本地模型选择 `localSelection`/超时、全局包策略、旧 workspace refs（待清理） |
| client `~/.dsh/.credentials.yaml` | SSH/凭据引用与 manual 模式的本地模型 API key（旧 API 兼容，官方 store，0600）；auto 模式不存 key |
| client `~/.dsh/remote-windows/<clientId>/…` | local 模式私有 anchors（非权威，可删可重建） |
| client `~/.dsh/remote-assets/` | 本地 runtime/旧包缓存 |
| server `~/.dsh/sessions/**` | 官方会话日志（两种模式共用；权威） |
| server `~/.dsh/storages/workspace.json` | 官方 workspace registry（权威，single layout） |
| server `~/.dsh/profiles/graydovee-remote-window-<clientId>/` | 专用 profile + 插件 + lease/log/pid |
| server `~/.dsh/remote-window/<clientId>/runtime/` | 独立 runtime（固定目录） |
| server `~/.dsh/remote-window/state/`、`locks/` | executor 记录、registry/bootstrap 锁 |
| server `~/.dsh/remote-server-sessions/**`（旧） | 保留、不展示、不迁移 |

- 卸载/禁用：清 client 本地锚点、旧 shell 条目与本地缓存；不删 server 官方 sessions/workspace/凭据，
  不删旧 `remote-server-sessions`。
- 清理调试实例：先 kill，确认端口关闭，`realpath` 后删临时目录；不删其它 tarball。

## 空调试实例（本地 UI 验收）

用独立 `DSH_HOME` 起干净 web profile，不碰真实 `~/.dsh`。`<dsh>` 为桌面版
`<应用目录>/Contents/Resources/runtime/cli/bin/dsh` 或 PATH 里的 `dsh`；QA/Linux 可直接
`npm install -g @deepseek-ai/dsh@0.2.1-rc.3`（纯 npm 分发，bin=dsh）。

    tmp=$(mktemp -d /tmp/dsh-empty.XXXXXX)
    export DSH_HOME="$tmp/home"
    <dsh> --profile web --dump-config >/dev/null          # 生成出厂 profile
    pnpm build && pnpm pack --pack-destination "$tmp"
    <dsh> plugin --profile web add "$tmp"/dsh-remote-window-*.tgz
    # pnpm 11 报 ERR_PNPM_IGNORED_BUILDS 并非 0 退出时：依赖已装好，手工把
    # dsh-remote-window 追加进 $DSH_HOME/profiles/web/package.json 的 dsh.profile.bundles。
    mkdir -p "$tmp/work" && cd "$tmp/work"
    DSH_HOME="$tmp/home" <dsh> web --host 127.0.0.1 --port <port> --no-open   # 后台任务

把打印的 token URL 给用户。改代码后：重打包，解到
`$DSH_HOME/profiles/web/node_modules/dsh-remote-window`（`--strip-components=1`），重启实例。

清理：`job_kill <job>` → `pgrep -fl "<tmp>"` 应为空 → `curl` 端口失败 → `realpath "<tmp>"` → 删除；
仅在装插件生成过时删 `/private/tmp/.pnpm-store`。

禁止：动真实 `~/.dsh`/正式 profile；复制真实凭据；连真实主机；`pnpm approve-builds`；删其它 tarball。
全新 home 出现官方默认工作区/会话属正常，不要当脏数据。

## 测试与发布

- 提交前至少：`pnpm typecheck`、`pnpm test`、`pnpm build`；两仓共享文件 `cmp`。
- 改动涉及 portal/embed/registry guard/executor/mode switch 时补对应集成测试；QA 以
  `doc/refactor-v1-requirements.md` §7 A–J 验收，证据可引用 `/tmp/dsh-qa`（不写 secret/真实路径）。
- 发布：两仓同版本；server 仓库产出 `dsh-remote-window-server-<version>.tgz` + `.sha256` +
  `.manifest.json`；client 仓库用 `scripts/bundle-server-plugin.mjs` 内置并写 `checksums.json`，
  `pnpm pack` 必须带 `assets/server-plugin/`。
- runtime 包（node+dsh）仍只在 server 仓库按矩阵发布（linux-x64-gnu、linux-arm64-gnu、darwin-x64、
  darwin-arm64）；client 下载后必须校验同源 sha256。v1 全局 runtime 修改不开放，只检测复用。
- README 只写用户可操作内容；开发约束只更新本文件。

## 当前遗留 / 禁止扩展

- 旧 `doc/architecture.md`、`doc/api-contract.md`、`doc/acceptance-gap.md` 描述的 stdio/WSL 架构只是历史
  背景，不再作为实现契约；不要据此写用户文档。
- `lib/` 是构建产物，禁止手改；改 `src/` 后重新 `pnpm build`。
