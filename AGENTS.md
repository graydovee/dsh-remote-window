# AGENTS.md — dsh-remote-workspace

本文件是给维护者和代码 agent 的开发契约。用户如何安装和使用请看 README.md；这里记录源码边界、
跨仓库契约、实测限制、测试和发布流程。代码、测试与本文件冲突时，先以可复现的当前实现为准，
再补充本文件。

## 项目边界

本仓库是 Remote Session 架构的 client 半边：

- 本机运行 agent loop、模型请求、凭据和 web UI。
- SSH 目标或 Windows 的 WSL 发行版运行 server 半边、文件系统、进程、终端、沙箱桥接和会话日志。
- 目标机没有监听端口；client 通过 SSH/WSL stdio 建立一条分帧 RPC 通道。
- server 仓库为 https://github.com/graydovee/dsh-remote-workspace-server。

公开仓库不得写入真实主机、用户名、内网地址、本机绝对路径、密码、token 或私人部署信息。示例使用
tester@203.0.113.10、/home/user 等占位值。Git 身份和 push 凭据使用开发者自己的本地配置，不在文档、
脚本或提交中固化。

## 本地命令

Node 使用 22.19 以上或 24 以上；依赖管理只用 pnpm。

    pnpm install
    pnpm typecheck
    pnpm test
    pnpm build
    pnpm pack --pack-destination ~/.dsh/tarballs

额外检查：

    node scripts/vendor-workspace-rows.mjs --dsh <dsh 源码 checkout>
    DSH_SMOKE_CLI=<dsh 启动器> npx vitest run tests/profile.smoke.test.ts
    node scripts/build-server-package.mjs --all --dsh-version 0.2.1-rc.2

pnpm typecheck 是 tsc --noEmit，仓库没有 lint 脚本。pnpm build 生成 host、server、client 三类
lib 产物；lib/ 已入库但绝不能手改，必须改 src 后重新构建。macOS 上
tests/workspace-refs.test.ts 的四条 realpath 失败是 /var 与 /private/var 的既有环境差异；报告测试
结果时要单独标注，不要改代码迎合它。

## 两仓库逐字节同步契约

以下文件在两个仓库中必须逐字节相同：

    src/protocol.ts
    src/server/controller.ts
    src/server/index.ts
    src/server/processes.ts
    src/server/session-store.ts
    src/frame/codec.ts
    src/frame/mux.ts
    src/frame/psk.ts
    src/provision/package-build.ts

这些文件被 client 构建成远端 server bundle，也被 server 仓库用于 release 和 conformance。改动任意一处时，
必须在两个 checkout 同一次变更中修改、构建、测试，并在提交前比较：

    for f in protocol.ts server/controller.ts server/index.ts server/processes.ts server/session-store.ts frame/codec.ts frame/mux.ts frame/psk.ts provision/package-build.ts; do
      cmp -s "src/$f" "../dsh-remote-workspace-server/src/$f" || echo "DIFF: $f"
    done

协议当前为 REMOTE_SESSION_PROTOCOL = 3；官方执行世界 RPC 仍为 v1。方法集合是
server.hello、reg.list/create/rename/delete、persist.list/titles/rename/create/open/append/flush/close/locate。
协议变化必须同时更新两仓、status.json、server.hello、测试和发布说明。

## 架构与依赖方向

tsdown 有三个 target：

1. host：Node ESM，入口为 index、connection、rsession、session-persistence、protocol。
2. server：src/server/index.ts 的远端 bundle。只 external Cordis 和 schemastery；DSH 运行时不能解析的
   dsh-ssh 子路径、schema 和 zod 必须内联。
3. client：浏览器 CJS 工厂，由 window.__ModuleLoader__.load 注册。只 external 平台模块；Node 内置模块
   和非 inline-safe 的跨插件值导入会触发纯度门禁，跨插件协作必须走 Cordis service。

主要目录：

    src/index.ts                    插件主行、HTTP 路由、存储域和 sessionPersistence 路由
    src/provision/                  探测、运行时包、profile、上传、启动和缓存
    src/provision/transport.ts      SSH/WSL 共享的 RemoteTransport 抽象
    src/targets/                    目标记录、凭据引用、脱敏和平台谓词
    src/ssh/                        ssh2、host key、SSH config、WSL transport
    src/preset/world.ts             每个 target 的 isolate realm
    src/connection/                 realm 内 ctx.ssh 适配器
    src/rsession/                   persist.* 的 SessionPersistence 门面
    src/session-persistence/        本地 JSONL 与远端 stub 的路由层
    src/client/                     sidebar、三层树、向导、store、动词和样式
    src/client/vendor/workspace-rows 官方行组件的内置副本，不得手写替换

依赖方向必须保持为 targets → ssh/provision → service → realm/session → client。client 只能依赖
平台模块和明确允许的纯模块（例如 targets/methods.ts），不得 import host service 或 Node API。

## 不能违反的行为约束

- SSH 凭据、模型 API key 和任何 secret 只在本机；错误、日志和 SSE detail 必须经过 scrubSecrets。
- 未知 SSH host key 必须展示 SHA-256 并等待显式确认；已 pin 的 key 发生变化必须中止。WSL 没有 host key。
- 每个 HTTP 路由先过 trustedRequest，body 上限 1 MiB；API 名称允许含斜杠，例如 connect/start，不要加斜杠守卫。
- 不替换官方全局服务，不改官方 patch 已有行；添加工作区动作和 sidebar.workspaces 的行为必须保持。
- 每个 target 的连接行必须惰性：构造 preset 不得连接不可达主机；preset 挂载失败是粘滞且永久的。
- 存储域 version 永远为 1。只能添加 optional 字段；没有迁移机制，bump 会让旧数据无法读取。
- mux 对未知流的 CREDIT、END、ABORT、OPEN_OK、OPEN_FAIL 忽略迟到消息；未知流的 DATA 才是致命失步。
- 重新安装后必须让插件批量 URL 的 rev 变化，否则浏览器会继续使用旧缓存。
- 官方行是 vendor 的组件。不要自己重写行样式或增加缩进；修改 vendor 前先运行生成脚本并保留来源说明。
- 对话框和 toast 挂在 RemoteTree 的树上，不能挂在 panel 上；否则 sidebar 触发器会没有宿主。
- 新会话必须先进入官方草稿页；不得自建 turn 预置，也不得用「打开工作区」顺手把会话建出来。
- 草稿是保存但仍属草稿的会话：下次在同一工作区新会话必须复用它，但它不得出现在会话列表里。
  只有它正被打开时，才在该工作区最上方显示一条「新会话」临时行，切到其它会话即消失。
  进入草稿不得产生成功提示；失败必须可见。
- engines.dsh 与全部 @deepseek-ai/dsh-* peer 依赖写精确的 0.2.1-rc.2。zod 固定为 4.4.3，禁止 ^。
- TS 保持 strict、noUncheckedIndexedAccess、verbatimModuleSyntax、allowImportingTsExtensions；相对导入带 .ts，
  类型导入使用 import type。可选 wire 字段用条件展开，注释记录现象和结论。

## SessionPersistence 的实测契约

apply() 构造 RoutingSessionPersistence 并 provide 为 sessionPersistence。按 header.cwd 路由：

- 本地 cwd 委托官方 session-persistence-jsonl，root 仍是 ~/.dsh/sessions。
- 远程 stub cwd 走 RemotePersistence 和 persist.*；远端真实路径只在 realm 的 stub→remote alias 中出现。
- 官方行名是 session-persistence-jsonl，不是 sessions。
- patch 覆盖必须保持 name；需要替换时使用 disabled: true，再在 apply() 中 provide，insert 行不会自动构造。
- inject 中不能写 workspaceRegistry；dsh-workspace 会与 sessionPersistence 互等，必须通过 ctx.get 懒解析。
- 自建 RemotePersistence 要用吸收注册的 stub context 构造，否则二次 provide 会抛错。
- 0.2.1-rc.2 的官方 JSONL 后端是 apply(ctx, config) 插件行：用 isolate 拿子 scope，await applyJsonl(scope, { root })，
  再从 scope.get 取服务；每次委托前等待 localReady。不要恢复旧版 tracker.install 补丁。
- create、open、list 三个出口都要把 header cwd 重锚到本地 stub；否则 workspace registry 会报 cwd conflict。

写入路径由 routing 管理 session/event、session/flush、session/disposed 钩子，使用 RemoteLiveWriter 和 DrainedHandle。
同一 session 的并发 write open 必须借出活跃 writer；withBrowser 重试按 target 串行；resume 按 session id 串行。
server 句柄表只在内存中，server 重启后 RemoteHandle 只允许因 unknown remote session handle 自愈一次。

## Sidebar 和行契约

- 区域插入 sidebar.workspaces 父元素的第一位，不占用该 slot；slot 使用 display: contents。
- 折叠时通过 data-sidebar-collapsed=true 移出无障碍树与命中测试；锚点不存在就不挂载。host、side、body
  的高度链都要 min-height: 0。
- 工作区行是 ProjectRowItem，会话行是 SessionNodeItem；新会话行使用 blank: true。连接行 workspaceId
  必须是 conn:<targetId>，不能传 undefined。
- 行菜单固定使用 rename 和 delete.workspace 两个 key；会话自有菜单先从 hookContext 取 close()。
- 隐藏 shell 官方行的选择器必须带 [data-slot="sidebar.workspaces"] 前缀，只改 display。
- 连接断开时清掉该 target 及其工作区展开状态；重连重新展开。不要把两个事件合并。
- 置顶/归档写插件自己的 pinnedSessions/archivedSessions；会话重命名走 POST /api/session-rename 到 persist.rename，
  不因重命名打开会话；分叉走 shell 的 uiWorkspace.forkSession；打开走 /api/open-session 和 ctx.agents.resume。
- 标题从 persist.titles 读取日志中的最后一个 session/title，按 (id,sizeBytes) 记忆化，并发上限 4。

## SSH、WSL 与部署

WSL 只在 Windows 暴露。host 和 client 都必须调用 targets/methods.ts::methodAvailable；非 Windows 的 wsl-distros
和 connect/start 返回 unsupported。wsl -l -v 是 UTF-16LE，wsl -d X -- command 是 UTF-8；发行版名可含空格，
Installing 行可能没有 VERSION 列。探测不得启动发行版，也不要为预填用户名调用 whoami。

多行 WSL 脚本必须通过 stdin 走 /bin/sh -s；上传用 cat > path，不能用 base64 heredoc。packStage 不得写死
/usr/bin/tar，必须使用 PATH 中的 tar。Windows staging 要识别 pnpm.cjs/pnpm.mjs、node/node.exe、包清单中的
bin JS；NTFS 丢可执行位时用 test -e 加 chmod +x，并以 --version 成功作为判据。packageFiles 的 path
永远是远端 POSIX 路径。

部署顺序固定为 connect → probe → runtime → upload → start。runtime 和 upload 通过 marker 幂等，失败时要
保留可诊断的进度。每个 target 只启动一个 server 进程；浏览器 client、realm 和浏览器重试共享同一通道与
RemoteClient。RemoteClient.close 只关闭自己的 peer，不能调用 mux.close 拆掉传输层。

远端 server 没有沙箱 backend 时必须返回官方 facts 对象：
{ argv, enforcement: 'partial', denialSignatures: [], runnerFailureRules: [] }。
不能返回裸 argv 数组，也不能用 z.unknown() 掩盖 schema 错误。

## 版本、测试与发布

仓库版本就是发布版本，当前为 0.1.0-alpha1；两仓必须一致。本机调试部署可以在执行 pnpm build 前追加
0.1.0-alpha1.1、0.1.0-alpha1.2 等修订后缀，部署后用 git checkout -- package.json src/server/index.ts 并
重新 build。修订号永不提交、push、打 tag 或发布。

提交前至少运行 pnpm typecheck、pnpm test、pnpm build，并完成一次 web profile 的实际安装验收：

1. 使用 pnpm pack 生成 tarball。
2. dsh plugin --profile web remove/add 该 tarball。
3. 重启 dsh web。
4. 验证新建 SSH、首次 host-key 确认、目录浏览、工作区/会话打开、重命名、分叉、断开和重连。
5. 需要时运行 profile smoke、conformance 和两仓 cmp。

server runtime 包只在 server 仓库发布：tag 为 server-v<dsh-version>，矩阵为 linux-x64-gnu、linux-arm64-gnu、
darwin-x64、darwin-arm64，并同时上传 .tar.gz、.sha256、.manifest.json。client 下载包后必须校验同源 checksum。

README 只写用户可操作的安装、使用、数据位置、兼容性和排障；不要把临时调试版本、内部测试编号、
个人路径或凭据写回 README。开发约束只更新本文件。
