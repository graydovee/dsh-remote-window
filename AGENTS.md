# AGENTS.md — dsh-remote-window

本文件是本仓库（client 半边）的开发契约：**做什么、怎么做、哪些约束不能破**。面向用户的用法见
`README.md` / `README-zh.md`；v3 主路径的细节契约见 `doc/refactor-v3-full-ui.md`（server 主区是 server
profile 官方 DSH UI 的全屏同源 iframe），Windows server 目标的细节见 `doc/windows-server-support.md`，
版本兼容规则见 `doc/runtime-compatibility.md`。文档与代码不一致时，按可复现实现修正并在同一变更里更新
文档，不静默改需求。

## 项目边界

- **server 是一台能独立工作的普通 DSH；client 是它的远程入口。**
- 本仓库产出 `dsh-remote-window` 插件：host 行（Node ESM）+ browser client + local 模式执行世界。
- server 运行普通 `dsh web`，并为每个 client 建专用 profile `graydovee-remote-window-<clientId>`，其中
  安装 server 插件 `dsh-remote-window-server`（独立仓库发布；client 包内置精确同版本 tarball）。
- client 用一条连接访问 server：SSH 走 ssh2；目标就是本机 WSL 发行版时走本机 `wsl.exe`（无 sshd、
  无 host key）。profile server 只绑 `127.0.0.1`，client 经 `forwardOut` / WSL 回环访问。
- 主区是**一个同源 iframe**（`/dsh-remote-window/portal/<targetId>/?dshRwFull=1`），显示 server profile
  的完整官方 UI；client shell 的 sidebar 在 iframe 挂载期间隐藏，浮动 target rail 是唯一的 client chrome。
- 模型来源是连接设置（不在会话内热切换）：`local`（默认，agent/日志/工具仍在 server，模型请求经反向
  隧道转发到 client 本机）与 `server`。local 把 `ctx.llm` 枚举到的**全部** provider/model 经一条反向隧道
  暴露成 server profile 的多个 `llm-pi-ai` route（每个 provider 一条 `remote-<slug>`）；没有勾选、没有
  provider/model 级过滤，对话框只留一行说明。本机暂时没有可用模型也允许连接：此时不启动 bridge/隧道、
  profile patch 写空补丁，server 用自己的模型；本机后来新增的模型在**下一次连接**重新发现并写入 patch
  （`@deepseek-ai/dsh-llm` 没有 provider-changed 事件，不做 profile 热重启）。切换模型来源要重连
  （D20：cancel → whenIdle/flush → 重启 profile）。
- 目标机启动命令固定：`dsh --profile <p> --host 127.0.0.1 --port 0 --no-open`，stdout 打印
  `dsh web: http://127.0.0.1:<port>/?token=<token>`。
- 公开仓库只写占位值：示例用 `tester@203.0.113.10`、`/home/user`、`/tmp/...`；真实主机、用户名、
  内网地址、本机绝对路径、密码、token、私人部署信息都不进仓库。Git 身份与 push 凭据用开发者本地配置。

## 本地命令

Node 22.19+ 或 24+；依赖管理只用 pnpm。

    pnpm install
    pnpm typecheck
    pnpm test
    pnpm build
    pnpm pack --pack-destination ~/.dsh/tarballs

额外命令：

    node scripts/sync-compat.mjs          # 改 compat/ 之后重新生成声明；--check 用于门禁
    node scripts/bump-dsh-version.mjs --to <dsh>   # 把新 dsh 加为 runtimes[0] 并重生成声明
    node scripts/bump-dsh-version.mjs --check      # CI 用的别名，等于 sync-compat --check
    node scripts/vendor-workspace-rows.mjs --dsh <checkout> --source-label 'dsh-v<version> (<sha>)'
    node scripts/bundle-server-plugin.mjs --tarball <server-plugin tgz>
    DSH_SMOKE_CLI=<dsh 启动器> npx vitest run tests/profile.smoke.test.ts

`pnpm typecheck` 是 `tsc --noEmit`（没有 lint 脚本）。`pnpm build` 生成 host/client 产物；`lib/` 已入库
但**由 `src/` 重新构建产生**，修改一律落在 `src/` 后重跑 `pnpm build`。

`package.json` 不声明 `prepare`/`preinstall`/`install`/`postinstall`：`lib/` 已入库，发布包由 `pnpm pack`
生成（pnpm 会把这类脚本从打包 manifest 剥掉）；而 pnpm 11 对 git 安装的构建脚本要求消费者在
`allowBuilds` 放行（`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`），声明就会让 `dsh plugin add <git url>`
失败。`tests/release-contract.test.ts` 守住这条。

`src/client/vendor/workspace-rows` 的 provenance 固定在记录里（见文件头 NOTICE）；升级运行时或重新
vendor 前，按 `doc/dsh-rc3-compatibility.md` 复核 row API/样式边界。

## 两仓共享文件（逐字节）

逐字节契约只有三个文件：

    src/protocol.ts
    src/frame/codec.ts
    src/frame/mux.ts

改动任一文件时，在两个 checkout 的同一次变更里修改、构建、测试，并在提交前比较：

    for f in protocol.ts frame/codec.ts frame/mux.ts; do
      cmp -s "src/$f" "../dsh-remote-window-server/src/$f" || echo "DIFF: $f"
    done

## 架构与依赖方向

tsdown targets：

1. **host**：Node ESM，入口 `index` 以及 loader 需要的子入口（protocol/connection/rsession/
   session-persistence）。
2. **client**：浏览器 CJS 工厂，经 `window.__ModuleLoader__.load` 注册；只 external 平台模块。Node
   内置模块/非 inline-safe 跨插件值导入会触发纯度门禁；跨插件协作走 Cordis service。

主要目录：

    src/index.ts                 插件 host 行：HTTP/SSE 路由、portal、v1/P1 接线
    src/local-llm/               本机模型：设置/凭据、/v1 代理 bridge、SSH 反向隧道、profile patch
    src/portal/                  同源反向代理（HTTP prefix + WS exact、Host/Origin/cookie 规则）
    src/remote/                  P1 插件客户端：tunnel HTTP、handshake、mux WS、帧适配
    src/ssh/                     ssh2 连接、host key、forwardOut、Windows agent
    src/targets/                 target 记录、clientId、凭据引用、脱敏
    src/provision/               runtime/profile/server 插件安装与生命周期、远程方言层、版本兼容与选版
    src/session/                 executor 状态机、anchors、local runtime/session、mode apply
    src/session-persistence/     本地 JSONL 与 server persist.* 的路由层
    src/rsession/                remote persist 门面
    src/preset/world.ts          local 模式执行世界 preset
    src/connection/              执行世界：ctx.ssh → RemoteMux 适配
    src/client/                  v3 远程段 UI：浮动 target rail、连接对话框、portal iframe 主区
    assets/server-plugin/        内置 server 插件 tarball + checksums.json
    compat/                      版本兼容表（runtimes.json）与发布历史（history.json）

依赖方向：`targets → ssh/provision → service → session/connection → client`。client 只依赖平台模块和
明确的纯模块（如 `targets/methods.ts`），不 import host service 或 Node API。

## 远端平台方言层（POSIX / Windows）

server 端可以是 POSIX（linux/darwin）或 **Windows**。方言由远端探测决定：`ProfilePaths.kind` /
`RuntimePaths.kind` 是唯一开关，**POSIX 分支的输出必须逐字节保持不变**（回归测试盯这一点）。

- PowerShell 一律用 `powershell.exe -EncodedCommand <base64>` 执行；脚本本体经 stdin 传 UTF-16LE
  base64。argv 保持 ASCII：脚本、路径、中文都不拼进命令行（会被二次解析）。
- 读远端文本用 `[IO.File]::Open(..., [IO.FileShare]::ReadWrite)`；`ReadAllBytes` 会和运行中 profile 的
  `cmd >> log` 抢独占读锁，表现为日志永远为空、启动被误判超时。
- 启动用 `Invoke-CimMethod -ClassName Win32_Process -MethodName Create` 跑 `start-<profile>.cmd`（日志由
  cmd 重定向）。`Start-Process` 会继承 SSH exec 通道的 job object，通道关闭即被杀，所以不用它。
- 停止先用 `Get-CimInstance Win32_Process` 校验命令行（PID 复用守卫），再 `taskkill /PID <pid> /T /F`
  杀整棵进程树。
- Windows 启动预算用 `WINDOWS_PROFILE_STARTUP_TIMEOUT_MS = 90_000`（detached cmd + 冷启动 + Defender）。
- win32 运行时产物**不含符号链接**：staging 用 `pnpm-workspace.yaml` 的 `nodeLinker: hoisted`（`.npmrc`
  的 node-linker 键被 pnpm 10/11 忽略），打包用 `tar -czhf`。`@deepseek-ai/node-addon-system` 没有
  win32 sibling，`assertTargetOnly` 显式跳过它，但仍要求 `node-addon-require-builtin-win32-x64-msvc`；
  native addon 健康探针要认 hoisted 布局。
- 平台无法判定时抛 `runtime-incompatible`，不回退 linux；`DSH_HOME` 必须是 Windows 绝对路径
  （`path.posix`/`path.win32` 按方言取，不用宿主 `node:path` 处理远端路径）。
- Windows 分支要同时具备 fake channel 单测与至少一次真机验证记录（只靠 macOS 单测不算验证）。

## 版本与兼容

版本契约的唯一来源是 `compat/runtimes.json`（schema 2）：

```json
{ "schema": 2, "plugin": "<本仓发布版本>",
  "dsh": { "min": "<最低兼容>", "max": "<最高兼容>" },
  "runtimes": [{ "dsh": "<版本>", "platforms": ["linux-x64-gnu", "…"] }] }
```

- `dsh.min`/`dsh.max` 是**两端闭区间**（更高的预览版也可能不兼容）；`runtimes[]` 按新到旧列出可交付的
  dsh 版本与平台标签。源码里不写死 dsh 版本：需要「最新期望版本」时读 `RUNTIME_COMPAT.runtimes[0].dsh`，
  判断兼容用 `inDshRange`。
- 改表后必须 `node scripts/sync-compat.mjs` 并提交生成物：`src/provision/runtime-compat.generated.ts`、
  `package.json` 的 `engines.dsh` 与全部 `@deepseek-ai/dsh-*` peer（`rangeExpression(range)`：单版本写精确
  版本，否则 `>=min <=max`），以及两份 README 的 `<!-- verified-runtimes:start -->`/`end` 区块。
  `--check` 是发布门禁，生成物不一致直接失败。
- 安装/测试用的 dsh 包（`dependencies` 与 `devDependencies` 里的 `@deepseek-ai/dsh*`，含
  `dsh-ssh`/`dsh-fs-ssh`/`dsh-subprocess-ssh`/`dsh-sandbox-ssh`）由脚本钉到**区间内最新的精确版本**：
  区间表达「我接受什么」，精确钉版表达「我实际装什么、测什么」，pnpm 不会去解析没人验证过的预发布。
- 选版逻辑只有一处：`src/provision/runtime-selection.ts` 的 `selectRuntimeVersion`。优先级是
  `DSH_RW_RUNTIME_ARTIFACT` → 区间内且健康的全局 dsh → 本地缓存 → release 产物 → POSIX 宿主本地构建 →
  拒绝。区间内但没有产物要报 `no-artifact`（提示预置产物 / 换全局 dsh），不当成版本不兼容；
  `too-new` 建议升级插件，`too-old` 建议升级 server 的 dsh。
- `compat/history.json` 记录每个已发布插件版本的区间，发新版时追加一行（`sync-compat.mjs` 校验它与
  `package.json` 版本一致）。
- 版本号由仓库发布版本决定（当前 `0.1.0-alpha.5`）。内置 server 插件 tarball 的版本必须与它精确一致。
  本机调试可用修订后缀，部署后 `git checkout -- package.json`，修订号不进提交、不上发布。
- zod 固定 `4.4.3`，`engines.node` 保持 `^22.19.0 || >=24.0.0`。

### 发新版的流程

上游发布新的 dsh 时：

1. 在 `compat/runtimes.json` 里把新版本作为 `runtimes[0]`（旧的保留在后面，供已缓存/已部署的 server
   继续复用），按需放宽 `dsh.min` 或 `dsh.max`；在 `compat/history.json` 追加本插件版本一行。
2. `node scripts/sync-compat.mjs`，把它改写的 `package.json`（engines/peers/钉版）、生成模块与两份
   README 表格一并提交；`pnpm install` 让锁文件跟上新钉版。
3. 按变更性质跑 `pnpm typecheck`、`pnpm test`、`pnpm build`，并对新增平台/新 dsh 做一次真机或集成验证
   （记录写进 `doc/runtime-compatibility.md` 的验证说明与 release 正文的来源快照）。
4. 发布时 client 的 `.github/workflows/release.yml` 会跑 `sync-compat --check` 并上传
   `runtime-compat.json`；server 的 `.github/workflows/server-release.yml` 用它推导 runtime 矩阵、生成
   「支持的 dsh 区间 + 有/无产物的平台 + 每文件 sha256」的 release 正文并挂上快照。

## 安全

- SSH 凭据、模型 API key 和任何 secret 只出现在需要的一端；错误、日志、SSE detail 一律 scrub。
- 未知 SSH host key 展示 SHA-256 并等待显式确认；已 pin 的 key 变化立即中止。
- profile server 的 token 与官方 cookie 只留在 client host 内存；浏览器拿不到；portal 不转发
  `Set-Cookie`，也不把 client GUI cookie 带给 server。
- 每个 client 插件 HTTP 路由先过 `trustedRequest`，body ≤ 1 MiB；server 插件路由/WS 先过
  `ctx.connection.admit(req)`，body ≤ 1 MiB（mux/portal 流除外）。
- 官方全局服务保持原样。唯一受控例外是 server 插件对官方 `workspaceRegistry` 的 prototype 写守卫：
  必须带版本守卫、幂等标记与失败降级（见 architecture §4）。

## 数据权威

- workspace 清单/标题/id/顺序/pin/archive 归 server 官方 `ctx.workspaceRegistry`，id 用官方 uuid；插件
  不保留自己的 pinned/archived/order 副本，也不用 `sha256(path)` 当工作区 id。
- 会话清单/标题/运行态/rename/fork/cancel 归 server 官方 `ctx.sessionController`；标题由插件 JSONL
  title fold 补齐（按 `(sessionId,sizeBytes)` 记忆化，尾部回刷 `session/title`；blank 判 `turn/start`）。
- 会话日志读写走官方 `ctx.sessionPersistence`，单写者由官方 JSONL flock 裁决，插件不自造锁、不抢占。
  `SessionAlreadyOwnedError` 呈现为 `session/writer-held`，用显式错误让用户决定。
- 存储域 `dsh_remote_window` 版本恒为 1，只允许新增 optional 字段。
- local 模式 anchor 是插件私有材料（`<DSH_HOME>/remote-windows/<clientId>/<targetId>/<hash>`），不注册进
  官方 workspace registry、不出现在本地工作区列表，随插件/连接清理。
- 搜索是 client 端的瞬时过滤：不落盘、不发 P1。
- 远端会话 header 里的 cwd 是 server 真实路径；local 模式由 client routing 负责 anchor ↔ server path
  重锚，协议层不做隐式翻译。

## 连接与执行端

- 新连接默认 `modelSource=local`（server 通常没配模型 key）；连接设置存 client，target 记录用可选
  `modelSource` 持久化。server 模型必须在对话框里显式选择。
- local 模型生命周期：解析计划（`auto`：用 `ctx.llm.listProviders()/listModels()` 枚举本机全部
  provider/model，全量进计划；为空则 `models: []` 并跳过 bridge。`manual` 只服务旧 API/测试）→ 启动
  client bridge（auto 是 `ctx.llm.stream()` 的 OpenAI 兼容原生代理，manual 是 `/v1/*` 注入 key 的转发桥）
  → `ssh2.forwardIn('127.0.0.1', 0)` 取得 server 回环端口 → 重写 profile `cordis.patch.yml`（auto 每个
  provider 一条 `remote-<slug>` route，manual 一条 `client-local`；`apiKeyEnv=DSH_RW_LOCAL_LLM_KEY` 占位）
  → 启动 profile。真正的失败（目录读取异常、桥或隧道失败）用 `local-llm-*` 错误码拒绝，不回退到 server
  模型；`stop()`/`reconnectLost()`/连接失败要关闭 bridge + tunnel，不留孤儿端口。
- bridge 把 adapter 的 error/aborted 终止 chunk 转成显式错误（started 前 502 JSON、started 后 error
  chunk）；不映射成 stop，否则 server 侧只看到 `EMPTY_RESPONSE`。
- auto 模式不需要 key（本机 provider 的凭据在本机解析）；manual 的本机 key 只进官方
  `ctx.credentials`（固定 key），浏览器只看到 `hasApiKey`。bridge 注入/覆盖 Authorization，日志、错误、
  SSE 里不出现 key。
- 模型来源切换按 D20：preview 列出当前 turn 与其它 active turn；apply 带 `previewRevision` 与
  `cancelActiveTurns:true`；缺清单拒绝执行，取消失败显式报错。
- SSH 意外关闭自动重连最多 5 次（指数退避）；认证/host-key 错误与用户主动 stop 不重试。
- 停进程/释放 handle 前按 cancel → `agent.whenIdle()`（3 s 预算）→ `sessionPersistence.flush()`；超时
  报显式错误。
- local 模式打开顺序：host 先 create/resume 让 client catalog 有 summary，再 `uiWorkspace.openSession`；
  超时显示可重试错误，不吞点击。
- 断开/删除/切换时清理 client 官方 selection：用受运行时守卫的 `uiWorkspace.clearMain()`，fallback 是
  `ctx.layout.selectPanel(null)`；只清属于本 target 的 `dsh.sessions.current`，不碰本地会话。
- 开发说明（不进模型上下文）：local 模式只注入 remote working-directory + execution host；SSH/mux/
  sandbox/anchor 生命周期属于 DSH/插件实现。

## profile 与部署

- 启动命令固定：`DSH_HOME=… PATH="<runtime>/node/bin:<runtime>/dsh/node_modules/.bin:$PATH" exec <dsh>
  --profile <p> --host 127.0.0.1 --port 0 --no-open`；`--profile` 写在 app 参数前，不用
  `dsh web --profile`。
- 解析 stdout 单行 `^dsh web: http://127\.0\.0\.1:(\d+)/\?token=([A-Za-z0-9_-]+)$`；token 只进
  `server.log`（0600）与 host 内存。
- 单 client profile lease（clientId/instanceId/pid/port/heartbeat，TTL 20 s）在 server 插件裁决：第二实例
  `profile-in-use`、异 client `profile-foreign-client`，stale 才可接管。
- 专用 profile：离线解包内置 `dsh-remote-window-server-<client-version>.tgz`，写 4 个 profile 文件，最后
  写 marker；不依赖 server 网络/pnpm。marker 不匹配才重装；失败报 `server-plugin-*`，不回退。
- 独立 runtime 自动安装/升级。全局 runtime 只检测复用；要改共享全局 runtime 或非专用 profile 插件时
  返回 `runtime-global-unsupported` / `plugin-profile-not-managed`，让用户显式决定。目标版本没有缓存产物
  时，POSIX 宿主可用本机 pnpm 在 `~/.dsh/remote-assets/` 构建 `node/`+`dsh/` 包再上传（布局与 server 仓库
  发布的 runtime 一致）；Windows 宿主以 `runtime-build-unsupported-host` 拒绝本机构建。
- 一个 profile 一个 client；client 断开 → cancel/flush → 停 profile server、关隧道。
- 已保存 target 的重连复用上次 connect 解析出的**绝对 `remote.dshHome`**
  （`targets/methods.ts` 的 `reconnectDshHome()`：请求显式值优先，`~`/空/相对路径才回退远端扫描），否则
  profile patch 与隧道会写到默认 home、server 继续调用旧 bridge 端口。回归测试
  `tests/targets-reconnect.test.ts`。
- server 主区是官方 UI 全屏 iframe（`portal-main.tsx`，`SERVER_MAIN_ID`）：连接成功/rail 激活 →
  `openServerMain`；断开/忘记/连接离开 ready → `closePortalFor`。iframe key 必须含
  `targetId:revision:reloadCount`，重连/切换 target 必须重挂载；20 s 未收到 `dsh-rw/ready` 显示可重试
  错误；token 不出现在 iframe URL。
- iframe sandbox 固定 `allow-scripts allow-same-origin allow-forms allow-popups allow-downloads`，不开
  top-navigation。portal 是纯字节代理：剥 client cookie、注入 server cookie、剥 `Set-Cookie`。
- `dshRwFull=1` 让 server embed 不隐藏官方 sidebar/rightbar/bottom；client 侧在 iframe 挂载期间用
  `html[data-dsh-rw-portal]` 隐藏 shell 自己的 sidebar 并收窄 root grid。
- 打开 portal 必须带 `dshRwSession` 深链（`portalSessionFor`：优先 host state 里最近的非 blank 会话，
  否则 `session/create` 建 blank）；深链只写 `dsh.sessions.current`，不 reload、不换写者。

## 官方 UI（iframe）

- server 主区显示**完整、未改写的官方 DSH UI**：sidebar、header、主区、rightbar、插件 UI 都由 server
  profile 提供；client 不叠加自绘标题栏/会话树/常驻侧栏。
- client 唯一 chrome 是浮动 target rail 与连接对话框：rail 默认折叠，hover 或 `Alt+R` 展开，只列
  target/连接状态/切换动作。
- rail 可拖拽并吸附到屏幕四边（`src/client/rail.tsx` 的 `snapRailPlacement`/`clampRailPlacement`）：
  收起时跟随吸附边（左右 44px 竖排图标条，上下 44px 横排图标条）；展开后无论哪条边都渲染同一个 280px
  竖向列表（按视口限高、列表纵向滚动），上下吸附展开时列表贴上下边缘、水平位置夹在视口内
  （`railBoxStyle`）。位置存 `localStorage['dsh-remote-window.rail-dock']`，未手动拖动前 portal 打开时
  自动靠右；展开/收起 200ms 过渡，`prefers-reduced-motion` 下关闭动画。
- rail 收起态在连接数 > 1 时末尾多一个折叠按钮（左右吸附在最后一个图标下方，上下吸附在图标条右端），
  点击最小化为单个 `+N` 图标（N = 连接数），最小化期间 hover 不展开；再点 `+N` 一步进入展开态，指针
  移开后回到收起条。最小化是会话内状态（不持久化），连接数降到 1 自动恢复。按钮在 rail 卡片内部但不
  属于负责 hover 展开的 `.dsh-rw-rail-hover` 组（否则会出现「hover 按钮 → rail 展开 → 按钮消失 →
  闪烁」）；图标指向收起方向（竖排向下、横排向左折回），hover 展开/最小化/单连接/拖拽期间隐藏
  （`railShowsToggle` 只看 expanded/minimized/count）。
- `dshRwFull=1` 只控制 server 插件不注入隐藏 CSS；client 不用自定义 CSS 覆盖官方视觉。
- 官方 iframe 的滚动、下载、弹窗、剪贴板要在 sandbox 内可用；新增权限时同步更新本文与
  `doc/refactor-v3-full-ui.md`。
- 官方行是 vendor 组件（`ProjectRowItem`/`SessionNodeItem`）：不重写行样式、不加缩进；改动前重跑
  `scripts/vendor-workspace-rows.mjs` 并保留 NOTICE 来源。复用边界见 `doc/official-workspace-reuse.md`。
- 对话框/toast 挂在浮动 target rail 的树上；同一类浮层用 `useSingleHost`。
- 隐藏 shell 官方行用带 `[data-slot="sidebar.workspaces"]` 前缀的选择器，只改 `display`。
- 远程段不写 client 共享 `workspace.json`/`sessions`；会话日志只写 server。
- embed/portal 是 v3 主路径：server 插件 `tapIndex` 注入 bootstrap/CSS，portal 保持纯字节代理、不解析
  HTML；`full=1`/`dshRwFull=1` 只关隐藏 CSS，不改官方行为。storage shim 前缀只影响 iframe realm；
  深链/切换遵守 protocol §9/§16.2。
- 重新安装插件后让批量 URL 的 rev 变化，避免浏览器用旧代码缓存。

## 数据位置与清理

| 位置 | 内容 |
|---|---|
| client `~/.dsh/storages/dsh_remote_window.json` | target 记录（含 `modelSource`/`packageSource`）、`localLlm` 模式与超时、全局包策略 |
| client `~/.dsh/.credentials.yaml` | SSH/凭据引用与 manual 模式的本地模型 key（官方 store，0600）；auto 模式不存 key |
| client `~/.dsh/remote-windows/<clientId>/…` | local 模式私有 anchors（非权威，可删可重建） |
| client `~/.dsh/remote-assets/` | 本地 runtime/旧包缓存 |
| server `~/.dsh/sessions/**` | 官方会话日志（权威） |
| server `~/.dsh/storages/workspace.json` | 官方 workspace registry（权威，single layout） |
| server `~/.dsh/profiles/graydovee-remote-window-<clientId>/` | 专用 profile + 插件 + lease/log/pid |
| server `~/.dsh/remote-window/<clientId>/runtime/` | 独立 runtime（固定目录） |
| server `~/.dsh/remote-window/state/`、`locks/` | executor 记录、registry/bootstrap 锁 |
| server `~/.dsh/remote-server-sessions/**`（旧） | 原样保留，不展示、不迁移 |

- 卸载/禁用插件：清 client 本地锚点、旧 shell 条目与本地缓存；server 官方 sessions/workspace/凭据保持
  原样。
- 清理调试实例：先 kill，确认端口关闭，`realpath` 后删临时目录；其它 tarball 保持原样。

## 空调试实例（本地 UI 验收）

用独立 `DSH_HOME` 起干净 web profile，不碰真实 `~/.dsh`。`<dsh>` 是桌面版
`<应用目录>/Contents/Resources/runtime/cli/bin/dsh`、PATH 里的 `dsh`，或 `npm install -g
@deepseek-ai/dsh@<compat 区间内版本>` 装的 CLI——版本要与 `compat/runtimes.json` 一致（桌面版自带版本
可能更新）。

    tmp=$(mktemp -d /tmp/dsh-empty.XXXXXX)
    export DSH_HOME="$tmp/home"
    <dsh> --profile web --dump-config >/dev/null          # 生成出厂 profile
    pnpm build && pnpm pack --pack-destination "$tmp"
    <dsh> plugin --profile web add "$tmp"/dsh-remote-window-*.tgz
    # pnpm 报 ERR_PNPM_IGNORED_BUILDS 并非 0 退出时：依赖已装好，手工把
    # dsh-remote-window 追加进 $DSH_HOME/profiles/web/package.json 的 dsh.profile.bundles。
    mkdir -p "$tmp/work" && cd "$tmp/work"
    DSH_HOME="$tmp/home" <dsh> web --host 127.0.0.1 --port <port> --no-open   # 后台任务

把打印的 token URL 给用户。改代码后：重打包，解到
`$DSH_HOME/profiles/web/node_modules/dsh-remote-window`（`--strip-components=1`），重启实例。

清理：`job_kill <job>` → `pgrep -fl "<tmp>"` 应为空 → `curl` 端口失败 → `realpath "<tmp>"` → 删除；
只在装插件时生成过 `/private/tmp/.pnpm-store` 的情况下删它。

约束：不动真实 `~/.dsh`/正式 profile；不复制真实凭据；不连真实主机；不跑 `pnpm approve-builds`；不删
其它 tarball。全新 home 出现官方默认工作区/会话属正常，不当脏数据。

## 测试与发布

- 提交前至少跑 `pnpm typecheck`、`pnpm test`、`pnpm build`，并 `cmp` 三个共享文件。
- 改动涉及 portal/embed/registry guard/executor/mode switch 时补对应集成测试；QA 按
  `doc/refactor-v1-requirements.md` §7 A–J 验收，证据放 `/tmp/dsh-qa`（不含 secret/真实路径）。
- 两个仓库同版本发布：server 仓产出 `dsh-remote-window-server-<version>.tgz` + `.sha256` +
  `.manifest.json`；client 仓用 `scripts/bundle-server-plugin.mjs` 内置并写 `checksums.json`，`pnpm pack`
  必须带 `assets/server-plugin/`。
- npm 发布由 tag 触发的 Actions 完成：client 的 `.github/workflows/release.yml` 在 GitHub Release 之后
  把同一个 `pnpm pack` tarball 发到 npm（`dsh-remote-window`）；server 的
  `.github/workflows/npm-release.yml` 在 `v*` tag 发 `dsh-remote-window-server`。两仓 workflow 都需要
  `id-token: write`（provenance）；版本必须等于 tag（去掉 `v`），已存在的版本不覆盖。`NPM_TOKEN` 是
  可选 secret：不配置时走 npm Trusted Publishing（OIDC，需在 npmjs.com 两个包的 “Trusted publishers”
  里登记仓库 + workflow 文件）；配置了 token 仍可发布（npm 正逐步废弃 granular bypass-2FA token 用于
  direct publish）。
- client release 在发布前跑 `node scripts/sync-compat.mjs --check`，并上传 `runtime-compat.json` 快照。
- runtime 包（node+dsh）在 server 仓按 `runtime-compat.json` 的矩阵发布（当前 linux-x64-gnu、
  linux-arm64-gnu、darwin-x64、darwin-arm64；win32-x64/arm64 尚未进 CI 矩阵，但客户端可用
  `DSH_RW_RUNTIME_ARTIFACT` 注入本地构建的产物）。文件名按内含的 dsh 版本命名
  （`dsh-runtime-<dsh>-<platform>.tar.gz`），与插件版本无关，多个插件版本复用同一份。发布正文由
  `scripts/render-release-notes.mjs` 从快照生成「支持的 dsh 区间 + 资产表」，并附 `runtime-compat.json`
  快照；client 下载后校验同源 sha256。全局 runtime 只检测复用。
- README 只写用户可操作内容；开发约束只更新本文件。
