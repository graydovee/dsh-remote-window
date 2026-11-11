# dsh-remote-workspace v1 QA 计划与证据口径

> 状态：QA 环境已建立（2026-10-22），新架构/新插件尚未实现；本文件先固定
> **环境、步骤、命令、期望结果和证据口径**。实现落地后按此逐条执行并写
> `doc/qa-v1-report.md`。任何一条在报告里写 PASS 之前，必须有本文件对应条目
> 要求的可复现证据；没有证据一律记为 BLOCKED / NOT RUN。
>
> 验收基线：`doc/refactor-v1-requirements.md` §7（A–J）与 §8（QA 环境与证据口径）。
> 环境约束：`AGENTS.md` 的「空调试实例」与「清理」规则。
> 占位约定：主机/路径一律用 `tester@203.0.113.10`、`/home/user`、`/tmp/dsh-qa/...`
> 这类占位值，不记录真实主机、内网地址、本机绝对路径或凭据。

---

## 1. 范围与结论口径

本计划覆盖 `doc/refactor-v1-requirements.md` §7 的 A–J 十条验收，以及：

- server 全局 DSH 不依赖 client 的独立基线（A1–A3）；
- 两个独立 client 调试实例（B/H）；
- server 模式 / local 模式 / 模式切换（E/F/G）；
- 断线重连、多客户端、profile 占用（B5/B6/H）；
- 错误路径与凭据不泄漏（I）；
- 清理与真实 `~/.dsh` 未被触碰（§8.7）。

判定规则：

1. 每条验收必须有「现象 + 复现命令 + 期望/实际 + 证据文件或截图/DOM」。
2. 失败不降级、不解释成 PASS；记录实际行为、可操作错误文本、影响范围，通知 Lead 和对应 dev。
3. 依赖新插件/新架构的条目在实现完成前只能是 `BLOCKED`，不得用「环境能跑」代替。
4. server 全局 DSH 的独立基线（A1/A2）用普通 DSH + mock provider 夹具即可验收；
   **mock 只替代模型 HTTP 端点**，agent loop、工具执行、会话日志必须真实。

状态取值：`PASS` / `FAIL` / `BLOCKED`（依赖未实现）/ `NOT RUN`（可运行但未执行）。

---

## 2. 环境拓扑

```
                 host loopback only                     Docker network (isolated)
┌──────────────────────────────────────┐      ┌────────────────────────────────────────┐
│ Browser (browser 工具)                │      │ 容器 dsh-qa-<name>                     │
│   │                                   │      │  user tester (uid 1000, 非 root)       │
│   ├─ client A: dsh web :<portA>      │      │  sshd :22  ← 宿主发布 127.0.0.1:<ssh>  │
│   └─ client B: dsh web :<portB>      │      │  global DSH 0.2.1-rc.2 (npm -g)        │
│                                       │      │  dsh web :<web> ← 宿主发布 127.0.0.1   │
│   client A/B DSH_HOME=/tmp/dsh-qa/clients/<c>│  ~/.dsh → /tmp/dsh-qa/<name>/home      │
│   独立 DSH_HOME、独立 clientId、独立插件版本 │  work   → /tmp/dsh-qa/<name>/work      │
│                                       │      │  QA mock LLM :28080 (仅容器内 127.0.0.1)│
│   host QA mock LLM :<portC>（local 模式）│      │  per-client profiles 在 ~/.dsh/profiles│
└──────────────────────────────────────┘      └────────────────────────────────────────┘
```

- server 目标：Linux Docker（Docker Desktop aarch64 → `linux/arm64`），Node 22 与 24 各一个实例；
  全局 `@deepseek-ai/dsh@0.2.1-rc.2` 由公开 npm 安装（`npm i -g`），不使用 asar 提取、不复制真实凭据。
- SSH：只发布到宿主 `127.0.0.1:<ssh port>`；sshd 仅公钥认证、禁止 root 登录。
- server 数据隔离：容器内 `/home/tester/.dsh` 绑定到宿主 `/tmp/dsh-qa/<name>/home`；
  工作区绑定到 `/tmp/dsh-qa/<name>/work`。真实 `~/.dsh` 不参与任何步骤。
- client 调试实例：按 AGENTS.md「空调试实例」起独立 `DSH_HOME` 的 `dsh web`，
  `DSH_HOME=/tmp/dsh-qa/clients/<client>`；两个 client 用不同 DSH_HOME/端口/插件版本。
- 模型：server 模式用容器内 mock（`scripts/qa/mock-start.sh`），local 模式用宿主 mock；
  两处都只替换模型端点。mock key 固定为夹具字符串 `qa-mock-key`，不是凭据。

### 2.1 端口与命名

| 用途 | 默认端口 | 说明 |
|---|---|---|
| server node22 ssh | 22022 | 只绑 127.0.0.1 |
| server node22 dsh web | 24022 | 只绑 127.0.0.1；容器内监听 0.0.0.0 由 Docker 端口映射收口 |
| server node24 ssh/web | 22024 / 24024 | `--name server24 --node 24` |
| server mock LLM | 28080 | 容器内 127.0.0.1，不发布到宿主 |
| client A dsh web | 对齐 D18 自选，如 25022 | 独立 DSH_HOME |
| client B dsh web | 25023 | 独立 DSH_HOME |
| host mock LLM（local 模式） | 28081 | 宿主 127.0.0.1 |

容器/镜像/数据目录命名：容器 `dsh-qa-<name>`（label `dsh.qa=1`）、
镜像 `dsh-qa-server:node<22|24>-0.2.1-rc.2`、数据 `/tmp/dsh-qa/<name>/`。
清理脚本按 label 与数据目录前缀识别，不会误删非 QA 容器/目录。

---

## 3. 安全与隔离红线

1. 不读写真实 `~/.dsh`，不复制真实凭据、token、模型 key；evidence 中不出现 token
   （`dsh web` 打印的 `?token=...` 一律截断，截图前确认）。
2. 不连接真实主机；SSH 目标只有 `127.0.0.1:<QA port>`。
3. 容器内只有测试用户 `tester`；不要 `docker exec` 到宿主或挂载宿主 home。
4. mock provider 是 QA 夹具，报告必须写「QA fixture，不是产品能力」；
   不得把 mock 的回复当作「模型链路已验收」。
5. 清理时先 `realpath` 确认路径再删除；只允许删 `/tmp/dsh-qa/**` 与
   `docker rm` 掉 `dsh.qa=1` 的容器。真实 `~/.dsh` 前后快照对比见 §11。
6. 证据里的服务器地址、token、key 用占位值；不把 QA 临时 token 写进文档。

---

## 4. 环境准备（一次性）

```sh
# 依赖：Docker daemon（本次 24.0.5）、ssh/ssh-keygen、nc 或 lsof
scripts/qa/start.sh                          # node 22
scripts/qa/start.sh --name server24 --node 24 --ssh-port 22024 --web-port 24024
scripts/qa/status.sh                         # 记录 node/dsh/ssh 版本与端口
scripts/qa/status.sh --name server24
```

期望：`start.sh` 输出 `ssh/dsh/node` 版本与 `docker port` 仅 `127.0.0.1:<port>`；
`status.sh` 显示 `dsh` 版本含 `0.2.1-rc.2`、`~/.dsh` 在容器内、`tester` 非 root。

### 4.1 server 独立基线（不依赖插件、不连 client）

```sh
scripts/qa/web-start.sh                 # 会先启动 mock（默认 sequence: tool_call_success,success）
# 记录输出的 token URL；浏览器打开：
#   http://127.0.0.1:24022/?token=<截断后不写文档>
# 在 server 官方 UI：添加工作区 /home/tester/work → 新建会话 → 发一条消息
```

> `dsh web --host` 拒绝通配地址，所以容器内只监听 `127.0.0.1:<port>`；宿主用
> `web-start.sh` 建立的 SSH local forward 访问（与真实 client 的隧道同构），
> 容器不发布 web 端口。`docker port <container>` 只应出现 22/tcp。
>
> QA 容器以 `DSH_PERMISSION_MODE=danger-full-access` 启动（DSH 官方配置项
> `mode: process.env.DSH_PERMISSION_MODE ?? 'workspace-write'`）。原因见 §9：
> Docker Desktop 默认 seccomp 下 bubblewrap 无法 mount `/proc`，`workspace-write`
> 会 fail-closed；这是环境限制，不是「沙箱已验收」。

期望（A1/A2）：

- server `dsh web` 在 client 不连接时独立可用；
- 新建会话后 `docker exec ... ls ~/.dsh/sessions` 出现该会话 JSONL；
- 一轮对话后会话日志新增 user/assistant/tool 事件；mock 的 `attempt-1.json`
  是真实 agent 请求（含 tool schema 与用户消息）；
- 工作区目录出现 `qa-marker.txt`（由真实 bash 工具写入），内容为基线标记；
- 会话头 `cwd` 指向 server 工作区（不是宿主路径）。

证据：

```sh
# 会话日志实际布局：~/.dsh/sessions/<cwd-slug>/session-<id>/session.v4.jsonl.zstd
docker exec dsh-qa-server bash -lc 'find ~/.dsh/sessions -type f | sort'
docker exec dsh-qa-server bash -lc 'zstd -dc <上面的 .zstd 路径>' | head -40
ls -l /tmp/dsh-qa/server/work/qa-marker.txt
cat /tmp/dsh-qa/server/mock/attempt-1.json     # 请求体：model/messages/tools
cat /tmp/dsh-qa/server/mock/requests.jsonl     # 请求/结果事件
```

### 4.2 两个 client 调试实例（需要新插件后执行）

```sh
# 每个 client 独立 DSH_HOME（不碰真实 ~/.dsh）
CLIENT_HOME=/tmp/dsh-qa/clients/client-a
DSH_HOME="$CLIENT_HOME/home" <dsh> --profile web --dump-config >/dev/null
pnpm build && pnpm pack --pack-destination "$CLIENT_HOME"
DSH_HOME="$CLIENT_HOME/home" <dsh> plugin --profile web add "$CLIENT_HOME"/dsh-remote-workspace-*.tgz
mkdir -p "$CLIENT_HOME/work" && cd "$CLIENT_HOME/work"
DSH_HOME="$CLIENT_HOME/home" <dsh> web --host 127.0.0.1 --port 25022 --no-open
# client B 同理：DSH_HOME=/tmp/dsh-qa/clients/client-b，端口 25023，可用另一份 tarball/版本
```

期望：两个 client 各自的插件存储生成不同 `clientId`；server 上出现两个
`graydovee-remote-workspace-<clientId>` profile；一个 profile 只被一个 client 驱动。

证据：两个 client 的 `DSH_HOME`/profile 目录、`clientId` 脱敏值、server
`~/.dsh/profiles` 列表、两个 `dsh web` 进程/端口、浏览器截图。

---

## 5. A–J 逐条验收步骤与证据口径

> 实现完成前，每条先标 `BLOCKED(<依赖任务>)`；实现后按步骤执行，把实际输出贴进报告。
> 命令中的 `<ctl>` 表示现有 client 控制台/插件的操作，`<browser>` 表示浏览器工具操作。

### A. server 独立可用

| ID | 步骤 | 期望 | 证据 / 当前状态 |
|---|---|---|---|
| A1 | `web-start.sh` → 浏览器打开 server UI → 添加工作区 `/home/tester/work` → 新建会话 → 发一轮消息（mock 夹具返回 tool call + 完成文本） | `dsh web` 独立启动；工作区注册成功；会话建立；真实 agent loop 发出模型请求并执行 bash 工具；`work/qa-marker.txt` 写入 | server UI screenshot/DOM；`~/.dsh/sessions/*.jsonl`；`mock/attempt-1.json`；`work/qa-marker.txt`。**环境已验证；等待补截图/DOM** |
| A2 | 会话日志位置检查 | 会话日志在 server `~/.dsh/sessions/<cwd-slug>/session-<id>/session.v4.jsonl.zstd`，**不在** `remote-server-sessions`，不在宿主项目目录 | `docker exec ... find ~/.dsh/sessions -type f`；宿主 `find /tmp/dsh-qa/server/home/sessions -type f` 同源（bind mount）；宿主任意路径无该会话 | **环境已验证**（见报告/§4.1） |
| A3 | client 连接/断开期间，server 官方 UI 反复打开同一工作区/会话 | server 全局 DSH 可用性不受 client 影响；按官方单实例语义打开/占用 | client 连接/断开前后 server UI 截图；server 进程/端口无变化；会话可打开 | BLOCKED(task-3/4/5) |

### B. 连接与 profile

| ID | 步骤 | 期望 | 证据 |
|---|---|---|---|
| B1 | client A 首次连接 server；检查 client 存储与 server `~/.dsh/profiles` | 稳定 clientId（重启 client 不变，且只含安全字符）；server 只出现 `graydovee-remote-workspace-<clientId>` 一个 profile | client 存储文件（脱敏）；server profiles 列表两次采样；重启 client 后 clientId 不变 |
| B2 | 全新 client 连全新 server，观察是否需要确认 | 自动安装/升级独立运行时 + 专用 profile 插件，无按钮确认 | client 网络/部署日志；server `~/remote-workspace/<clientId>/runtime` 内容；插件安装记录；浏览器无确认弹窗截图 |
| B3 | 让全局运行时缺失/版本不兼容，再连接 | 出现按钮确认；未确认前全局目录不写入 | 确认弹窗截图/DOM；确认前后 `which dsh`/全局目录 mtime；取消后无写入 |
| B4 | 连接成功后检查端口与 handshake | client↔server 走 SSH 隧道 + token + plugin handshake；server 无公网监听 | 宿主 `lsof -iTCP -sTCP:LISTEN`（只有 client 本地端口）；server `ss -ltnp`（只有 127.0.0.1/profile 端口或无公网）；handshake 日志 |
| B5 | 断开 → 检查进程/端口 → 重连 | profile server 停止、隧道关闭、当前 turn 取消；重连恢复工作区/会话、无孤儿进程/端口 | 断开前后 `pgrep -af dsh`、`ss -ltnp`、`docker exec ps`；重连后 sidebar 截图；会话历史仍在 |
| B6 | 复制 client A 的 clientId 到 client B（模拟两个 client 同 profile）连接 | 第二连接被拒绝，错误可操作（指明 profile 被占用）；日志不损坏 | B 的 UI 错误截图/DOM + body/SSE（脱敏）；server profile 锁/租约文件或日志；会话日志无并发写 |

### C. 左栏与远程数据

| ID | 步骤 | 期望 | 证据 |
|---|---|---|---|
| C1 | 打开 client 主界面 | 仍是「远程工作区」+「工作区」两段；远程段为 连接 → server 工作区 → server 会话 | 截图 + DOM（`[data-slot="sidebar.workspaces"]`） |
| C2 | 对照 server 官方 `workspace.json`/会话数据与 client 显示 | id/path/title/sessionCount 一致；两个 client 一致 | server 官方数据文件；两个 client 截图；DOM 文本 |
| C3 | server UI 新建/重命名/删除工作区或会话；client 刷新/重连；再反向 | 双向可见 | 两侧操作前后截图/数据文件；DOM |
| C4 | 检查远程行 DOM/样式 | 复用官方 `ProjectRowItem`/`SessionNodeItem`；无自绘替代行样式 | DOM 类名/结构；与本地工作区行对比截图 |
| C5 | 断开/阻塞 server 数据接口，展开连接/工作区 | 加载/空/错误态可见；失败不伪装成空列表 | 失败态截图/DOM；对应网络请求响应（4xx/5xx/超时） |
| C6 | 连接并操作后检查 client 本地 | 远程段不写 client 可见「工作区」；client `workspace.json` 无远程 stub；client `~/.dsh/sessions` 无远程会话日志 | client `~/.dsh` 快照（sessions/workspace.json）；server 会话文件对比 |
| C7 | 搜索；pin/archive/拖拽排序；重连；另一 client 查看 | 搜索仅本地过滤；pin/archive/顺序存 server、跨 client 共享、重连保持 | 两侧截图；server 插件视图状态文件；断网搜索仍可用（本地过滤） |

### D. 工作区/会话功能

| ID | 步骤 | 期望 | 证据 |
|---|---|---|---|
| D1 | client 添加工作区（浏览 server 目录） | server registry 出现；server 官方 UI 可见 | client 截图；server `workspace.json`/官方 UI 截图 |
| D2 | 移除有会话的工作区 | 按官方/既定确认语义；server 清单删除、会话日志不丢 | 确认弹窗截图；server registry 删除前后；sessions 文件仍在 |
| D3 | 重命名工作区 | 只改标题不改目录；server 官方 UI 同步 | 前后数据文件；server UI 截图 |
| D4 | 新建/打开会话 | 会话进入 server 官方数据；两侧一致 | 会话 JSONL；两侧截图 |
| D5 | 会话重命名/分叉/置顶/归档 | server 数据/共享视图状态生效；多 client 一致 | 操作前后 server 数据；两 client 截图 |
| D6 | 排序/拖拽 | 顺序存 server；另一 client 刷新一致；搜索不改变持久顺序 | 视图状态文件；两 client 截图 |
| D7 | 删除会话 | 官方无能力则记录「不实现」；实现则 server 权威删除且不误删 | 官方能力证据（UI/CLI/文档）+ 记录 |

### E. server 模式

| ID | 步骤 | 期望 | 证据 |
|---|---|---|---|
| E1 | 连接设置选 server 模式，打开 server 会话发消息 | agent loop/模型/凭据/工具执行都在 server：server 进程发起模型请求、执行工具并写会话 | server mock 请求（model/messages）；server 会话 JSONL；server 进程/网络（`ss`/mock log）；client 侧无该会话日志 |
| E2 | 检查 client 侧数据与网络 | client 侧不出现 server 模型 key；client 本地不新增该会话日志 | client `~/.dsh` 快照；client 配置/日志 grep（不打印值）；浏览器 devtools 网络不含 key |
| E3 | v1 主区操作 | 嵌入 server 官方对话区；流式输出/取消/审批可用；无双 sidebar/双导航 | 主区截图；DOM 无双 `sidebar`；流式过程截图/网络 SSE |
| E4 | server 官方 UI 另开同一会话 | 符合官方单实例语义；被占用时明确错误，不损坏日志 | 两侧截图/错误文本；会话日志前后行数与完整性 |
| E5 | client 断开重连 | 会话历史仍在；重连可继续 | 断开前后会话文件；重连后继续一轮的日志增量 |

### F. 本地模式

| ID | 步骤 | 期望 | 证据 |
|---|---|---|---|
| F1 | 切到 local 模式发消息 | agent loop/模型/凭据在 client；文件/进程/沙箱/终端在 server | 宿主 mock 收到请求；server 会话 JSONL/工具执行；client 进程日志 |
| F2 | 检查会话日志位置 | 日志/标题/工作区在 server；client 本地无该会话日志 | server 会话文件；client `~/.dsh/sessions` 对比 |
| F3 | 检查凭据归属 | server 不需要 client 模型 key；client key 不写 server | 两端配置/进程环境（只证明不打印值）；server 无 client key 痕迹 |
| F4 | 停掉 server 执行世界（停容器/断 SSH）后发消息 | fail-closed；不得本地执行并假装成功 | 错误截图/DOM；client 日志；工具调用无本地回退 |
| F5 | 另一 client 打开/继续该会话 | 官方占用语义下可见可继续，或明确占用错误 | 第二 client 截图/错误；日志无并发损坏 |

### G. 模式切换

| ID | 步骤 | 期望 | 证据 |
|---|---|---|---|
| G1 | server→local、local→server 各一次；其中一次在 turn 运行中切换 | 自动取消当前 turn；已产生内容保留；UI 显示当前执行端 | 切换前后截图；取消事件；部分输出仍可见 |
| G2 | 比较切换前后会话 | 会话 ID/历史/标题不变；下一轮由新模式执行；同一 server 日志 | 会话文件 id/内容；下一轮模型请求归属（server/client mock 各自请求） |
| G3 | 数日志行与 turn 数 | 无重复/丢失 turn；第二个 client 不受静默并发写影响 | 会话 JSONL 行级对照（前后 diff）；并发写测试（B6/F5） |
| G4 | 方向各测一次（含运行中 turn） | 同 G1/G2 | 两方向各一组证据 |
| G5 | 切换后 UI 状态 | 明确显示执行端与凭据归属；主区/状态正确 | 截图/DOM；连接设置项 |

### H. 多连接/多客户端/版本

| ID | 步骤 | 期望 | 证据 |
|---|---|---|---|
| H1 | client A 同时连 server（node22）与 server24（node24） | 各自独立 profile/隧道，互不影响 | 两个 server 的 profiles/端口；client sidebar 截图 |
| H2 | client A、B（不同 clientId，最好不同插件/运行时版本）连同一 server | 各自 profile/runtime，不互相升级/覆盖；共享工作区/会话/视图状态 | 两 server profiles/runtime 目录；两 client 截图；版本文件 |
| H3 | 同一 client 断开重连 | 复用/重启自己的 profile；不误用其他 profile | 重连前后 profile 列表与进程；client 日志 |
| H4 | 两个 client 抢同一 profile（B6 延伸） | 第二个被拒 | 错误截图；锁/租约证据 |
| H5 | 断开、卸载/禁用插件 | profile server 停止、隧道关闭、无孤儿；server 共享数据与会话保留 | 前后 `pgrep`/`ss`；server profiles/sessions 仍在；client 无可见远程行 |

### I. 安全、错误与回归

| ID | 步骤 | 期望 | 证据 |
|---|---|---|---|
| I1 | 逐项制造：未知 host key / host key 变化 / 密码错误 / 运行时下载失败 / 插件安装失败 / 端口冲突 / profile 锁冲突 | 每项都有可操作错误；无静默回退 | 每项错误截图/DOM + 触发命令；失败后无 target 落盘（未成功连接不得写 target）；host key 变化中止 |
| I2 | 在所有错误/日志/SSE/HTTP body 中检索密码/token/key | 不出现真实凭据；SSE/HTTP body 过 scrub | `grep -R` 证据（只报计数/占位）；浏览器网络响应片段（脱敏）；日志样本 |
| I3 | client 本地工作区/会话/官方行为回归；禁用/卸载插件 | 本地不受影响 | 本地截图；禁用前后对比；`pnpm typecheck/test/build` 输出 |
| I4 | 检查旧 remote stub/refs/agent preset 清理与 `remote-server-sessions` | 旧数据清理；`remote-server-sessions` 保留但不显示；不迁移 | 新旧目录快照；sidebar 无旧行；server sessions 未被删 |
| I5 | 仓库检查 | `pnpm typecheck`、`pnpm test`、`pnpm build` 通过；macOS `workspace-refs` realpath 既有失败单独标注 | 命令输出与失败条目标注 |

### J. 文档与验收记录

| ID | 步骤 | 期望 | 证据 |
|---|---|---|---|
| J1 | 检查 `doc/official-workspace-reuse.md` | UI 复用、对官方 UI 改动、功能复用、自实现清单、v1/v2 边界齐全 | 文件链接与评审记录 |
| J2 | 检查架构/协议/AGENTS/README | 记录 per-client profile、runtime、模式切换、占用语义、部署流程 | 文件链接与评审记录 |
| J3 | 本 QA 报告 | 包含 Docker 目标、两个 client、server 独立、server/local、切换、重连、多客户端、错误路径证据 | `doc/qa-v1-report.md` 与证据索引 |
| J4 | v2 边界 | client 官方 UI 主区明确不在本轮验收，记录为后续任务 | 文档条目 |

---

## 6. 两个 client 的调试实例细则

1. 两个实例分别用不同 `DSH_HOME`（`/tmp/dsh-qa/clients/client-a/home`、
   `/tmp/dsh-qa/clients/client-b/home`）和不同 `dsh web` 端口，绝不共用。
2. 每个实例按 AGENTS.md 流程：`--dump-config` 生成 profile → `pnpm pack` →
   `dsh plugin --profile web add <tgz>` → 必要时把插件追加进 profile 的
   `dsh.profile.bundles` → `dsh web --host 127.0.0.1 --port <port> --no-open`。
3. clientId 应自动生成且稳定；为验证多客户端，记录两个 client 的 clientId
   （脱敏），并确认 server 端 profile 名不同。
4. 版本差异：client B 用另一个插件 tarball 版本（或修改后的 tarball），验证
   server 上两个 profile 的插件版本互不覆盖。
5. 浏览器：用 browser 工具分别操作两个 client 的 UI；每个关键步骤截图 + DOM；
   操作前确认当前 tab 的 URL 是哪个 client，避免串台。
6. local 模式模型：宿主 mock（`node scripts/qa/mock-llm.mjs` 或复用官方 mock 包）
   监听 `127.0.0.1:<portC>`，client 以 `DEEPSEEK_BASE_URL=http://127.0.0.1:<portC>/v1` 启动；
   同样只替换模型端点，并在报告中标注 QA fixture。

---

## 7. 断线/重连/占用/错误路径用例清单

| 用例 | 触发方式 | 期望 | 收集证据 |
|---|---|---|---|
| 正常断开 | 关闭 client tab / 断开连接按钮 | profile server 停、隧道关、turn 取消 | 断开前后进程/端口；turn 取消事件 |
| 崩溃断开 | client 进程 `SIGKILL` | 下次连接清理 stale 锁/进程；server 数据不受影响 | 残留进程/锁；重连日志；会话可开 |
| 重连 | 重新连接同一 server | resume 工作区/会话；无重复 server 进程 | profile 进程表；会话历史 |
| profile 占用 | 复制 clientId 到第二个实例 | 第二连接明确被拒 | 错误截图/响应；锁文件 |
| host key 变化 | 换服务器 host key（重建容器或改 known_hosts）后连接 | 中止连接并提示指纹变化 | 错误 UI；`known_hosts` 前后 |
| 未知 host key | 删除 client 的 known_hosts 后连接 | 展示 SHA-256 并等待显式确认 | 确认 UI 截图；确认前无 target 落盘 |
| 密码错误 | 用错误密码/禁用密码认证 | 可操作错误；不落 target | 错误截图；target 存储无记录 |
| 运行时下载失败 | 让 server 无外网/指向错误源 | 可操作错误；不影响已有会话 | 错误 UI；server 日志；无半成品运行时 |
| 插件安装失败 | 用损坏 tarball/版本不兼容 | 可操作错误；profile 不被破坏 | 错误 UI；profile package.json 前后 |
| 端口冲突 | 先占用 profile server 端口 | 明确错误或自动换端口（按实现） | 错误 UI；端口占用命令 |
| 清理 | 断开后按 §11 清理 | 无残留容器/端口/进程/临时目录 | `pgrep`/`ss`/`docker ps`/`lsof` 输出 |

---

## 8. mock provider 口径（QA fixture）

- 组件：官方 `@deepseek-ai/dsh-llm-mock-server`（Messages 协议，`/v1/messages`），
  由 `scripts/qa/mock-llm.mjs` 启动；只作为模型 HTTP 端点。
- 依据：`@deepseek-ai/dsh-llm-deepseek` 的 `baseURL` 可被 `$DEEPSEEK_BASE_URL`
  覆盖，root 末段 `/v1` 复用后请求 `/v1/messages`（见该包 README）。
- 默认脚本 `tool_call_success,success`：第一轮返回一次 `bash` 工具调用，
  第二轮返回完成文本；`repeatLast` 打开，避免标题等附加请求耗尽脚本。
- 证据：`/tmp/dsh-qa/<name>/mock/requests.jsonl`（请求/结果事件）、
  `attempt-<n>.json`（真实 agent 请求体：model、messages、tools、system）、
  `ready.json`、`run/mock.log`。
- 限制：mock 不验证模型真实网络、流式 UI 的全部线上行为、限流/计费；
  报告中不得据此声称「模型链路生产可用」。local 模式同理使用宿主 mock。

---

## 9. 已知限制与阻塞

| 项 | 影响 | 处理 |
|---|---|---|
| 新 server 插件未实现（task-3） | B/C/D/E/F/G/H/J 大量条目不可执行 | 实现完成后按本计划执行；当前标 BLOCKED |
| client 新架构未实现（task-4/5/6） | 连接/profile/远程树/模式切换不可执行 | 同上；环境与 A1/A2 基线先交付 |
| Docker Desktop 绑定挂载将宿主文件映射为容器 root | 非 root `tester` 需目录可写 | `start.sh` 对 `/tmp/dsh-qa` 数据目录做 777 放宽（仅 QA、仅临时目录） |
| 容器内 `dsh web` 只监听 `127.0.0.1`；容器只发布 22/tcp，宿主经 SSH local forward 访问 | 无（与真实 client 隧道同构） | 证据：`docker port` 只显示 SSH；`ss -ltnp` 在容器内只显示回环 |
| Docker Desktop 默认 seccomp 阻止 bubblewrap `mount /proc`（实测 `bwrap: Can't mount proc on /newroot/proc: Operation not permitted`），Landlock 也不可用 | `workspace-write` 下 bash 工具 fail-closed（SANDBOX_UNAVAILABLE），无法用默认策略执行工具 | QA target 用 `DSH_PERMISSION_MODE=danger-full-access`（DSH 官方策略）跑 A1/A2；真正 sandbox backend 验收需在允许 userns/mount 的 Linux 主机或自定义 seccomp profile 上重跑，报告标 PARTIAL/BLOCKED |
| 真实模型不可用 | 无法验证真实模型/凭据链路 | 用 mock 夹具验收 agent loop/日志/工具；真实模型链路标记 NOT RUN |
| macOS `workspace-refs` realpath | 现有环境差异 | 报告单独标注，不改代码迎合 |

---

## 10. 清理与「真实 `~/.dsh` 未被触碰」证据

```sh
# 清理前快照（只读，不复制内容）
ls -la ~/.dsh | head
find ~/.dsh -maxdepth 1 -newer /tmp/dsh-qa/.host-dsh-marker 2>/dev/null

# 清理 QA 环境
scripts/qa/web-stop.sh
scripts/qa/stop.sh
scripts/qa/cleanup.sh --all --images --yes

# 清理后验证
docker ps -a --filter label=dsh.qa=1          # 应为空
lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(22022|22024|24022|24024|28080)' || true  # 应为空
pgrep -fl 'dsh-qa|mock-llm.mjs' || true       # 应为空
realpath /tmp/dsh-qa && rm -rf /tmp/dsh-qa    # cleanup.sh 已做；手工时先 realpath
ls -la ~/.dsh | head                          # 与清理前一致
```

期望：无 QA 容器/镜像（可选）/端口/进程/临时目录；真实 `~/.dsh` 的
文件清单、`sessions`、`workspaces` 与操作前一致（记录 `find -newer` 为空）。

---

## 11. 当前状态矩阵（2026-10-22 环境基线）

| 项 | 状态 | 说明 |
|---|---|---|
| Docker + SSH 目标（node 22/24、全局 DSH、隔离 `~/.dsh`、127.0.0.1 端口） | 进行中 | 见 `scripts/qa/`；构建/启动/清理脚本已就绪，正在跑首次验证 |
| server 全局 DSH 独立启动 | 进行中 | `dsh --version` / `dsh web` / mock 夹具验证中 |
| A1/A2（server 独立建工作区/会话/对话、日志位置） | 进行中 | 完成浏览器操作后补截图/DOM 与日志证据 |
| 插件安装入口 | 已执行（离线契约） | `install-server-plugin.sh` 装 0.1.0-alpha.3 到 `graydovee-remote-workspace-qa1`；profile smoke 27 项 |
| server 插件 P1 烟测（handshake/lease/embed/index/RPC 骨架） | 基本 PASS（26–27/27） | 证据见 §12.1；唯一历史失败为 QA 断言未跟随 P0 的“相对路径 embed” |
| M1 连接→树→portal | **PASS（独立 QA 复跑）** | 409 指纹→200；state 2 workspaces/3 sessions；portal 官方对话区渲染，见 §12.2 |
| M2 server 模式（M2d） | **PARTIAL PASS** | server 侧 fs/list、blank managed、prepare-server、persist/stat、handshake 已验；client M2 pair connect/state/portal PASS；M2 UI 动作/搜索/拖拽/冷 prepare 未跑，见 §12.2b |
| B–J（完整连接/远程树/模式/切换/多客户端/错误） | BLOCKED | 依赖 task-3/4/5/6 实现 |
| mock provider 口径 | 已完成 | §8；实现完成后复用 |

---

## 12. 阶段执行记录（2026-10-22）

### 12.1 server 插件安装与 P1 烟测（QA 环境）

- 安装：离线契约（解包 `package/` → `<profile>/node_modules/dsh-remote-workspace-server`，
  profile `dsh.profile.bundles` 追加），**不使用 npm/pnpm/网络**；
  `install-server-plugin.sh --profile graydovee-remote-workspace-qa1 --tarball ... --sha256 ...`。
- 依赖：插件 `lib/plugin.js` 按名 import `@deepseek-ai/schemastery`；离线 profile 没有该包，
  安装脚本会从全局 DSH 安装软链一份（QA 侧兜底）。client 自动部署路径目前没有这一步，
  是 dev-core/server 侧需修复的部署缺口（见 §12.2）。
- profile 启动：`dsh --profile graydovee-remote-workspace-qa1 --host 127.0.0.1 --port 0 --no-open`
  （容器内；宿主经 SSH local forward 访问，容器不发布 web 端口）。
- 烟测结果（`profile-smoke.sh`）：
  - handshake 200：protocol=1 / pluginVersion=0.1.0-alpha.3 / dshVersion=0.2.1-rc.2 /
    profile / clientId / lease / registry{revision,epoch} /
    capabilities `registryWriteGuard:"prototype"`、`registryReload:"loader-disable-enable"`；
  - 错误路径：plugin-version-mismatch 409、profile-mismatch 409、profile-foreign-client 409、
    无 cookie 401、profile-in-use 409（错误码逐项断言）；
  - P1 写读：workspace/create → workspace/list → workspace/rename（真实 `storages/workspace.json`）；
    session/create(blank) → session/list（title/titleSource 存在）；
  - embed：`embed/bootstrap.js` 200 JS（含 storage shim）、`embed/embed.css` 200 CSS；
    index 注入 `__DSH_RW_EMBED__` 与 bootstrap `<script>`（P0 后为相对路径）；
  - 证据：`/tmp/dsh-qa/server/logs/profile-smoke-*.log`。
- 说明：`session/prepare-server`、executor/switch、mux WS 等属于后续 tarball，未纳入本次判定。

### 12.2 M1 连接 → 树 → portal（client 25022）

client 实例：`DSH_HOME=/tmp/dsh-qa/clients/client-a/home`，`dsh web --host 127.0.0.1 --port 25022`，
`DSH_RW_SERVER_PLUGIN_TARBALL=<server tarball>`；server 目标 `127.0.0.1:22022`（SSH 密码夹具）。

已通过：

- client 启动、插件 UI 的「远程工作区」区渲染（刷新/新建连接/搜索）；
- `/dsh-remote-workspace/api/state`：
  `{ok:true, clientId:"33cc71b9e138", protocol:1, portalBase:"/dsh-remote-workspace/portal",
    connections:{}, pluginVersion:"0.1.0-alpha.3", verifiedRuntimes:["0.2.1-rc.2"]}`；
- connect 第一跳 409 `host-key-unknown` + SHA-256 指纹（`SHA256:0W/OIxB7…`）；
  失败路径不写 target（state 中 connections/targets 仍为空）。

阻塞（dev-core，已附证据给 Lead/dev-core）：

1. connect 第二跳 HTTP 500 `profile-start-failed: the profile server is listening but did not
   answer its tokenized root request`。实测 profile server 已在 server 容器内启动并稳定返回
   tokenized root 303；该 303 使用 `Transfer-Encoding: chunked`（无 content-length）。client
   插件 `sendForwardedHttp` 仅按 content-length 判断响应结束 → 超时 → probe false。
2. client 自动部署的 profile 缺 `@deepseek-ai/schemastery`（`ERR_MODULE_NOT_FOUND`），
   需 client 部署随包提供运行期依赖或 server 插件 inline。
3. 「+ / 新建连接」按钮点击无 dialog；console 见 `[dsh-remote-workspace] state stream closed`
   与官方 `SlotAssemblyError: scope 'session-maybe' rendered without an installed adapter`
   等错误（dev-ui 排查中）。

M1 判定：**PASS（独立 QA 复跑，2026-10-22）**。

- 产物：client `babd70fb…`、server `51d48f8f…`（Lead 冻结组）；全新 `DSH_HOME=/tmp/dsh-qa/clients/client-qa-m1/home`，
  client web `127.0.0.1:26022`，server 目标 `127.0.0.1:22022`。
- 首次 connect 409 `host-key-unknown` → 带指纹重试 200；target `rt-6cb70fd4`，profile
  `graydovee-remote-workspace-0c3ff2957086`，port 45467，phase ready，plugin 0.1.0-alpha.3，
  capabilities `registryWriteGuard:prototype` / `registryReload:loader-disable-enable`。
- `/api/state`：workspaces 2（`QA smoke renamed` / `work`）、sessions 3（含 blank 与
  projection title），与 server 官方数据一致。
- portal 深链 `…/portal/rt-6cb70fd4/?dshRwSession=session-7cf57c8a-…`：浏览器渲染 server 官方对话区，
  历史/标题与 server 会话文件一致，无 client/server 双导航；DOM 证据见
  `/tmp/dsh-qa/server/logs/m1-independent-qa-evidence.txt`。
- 已知限制：当前 browser bridge 的 screenshot 被 “window not focused” 拒绝，QA 侧以 DOM 文本记录；
  视觉截图以 Lead 侧 M1 记录为准。

### 12.2b M2 阶段（M2d 产物，2026-10-22）

- 产物：client `7bd5aaaf…`（dev-core）、server `053eec29…`（M2d，manifest phase=M2d）。
- 独立 client 实例（`/tmp/dsh-qa/clients/client-m2d/home`，port 26025）已 PASS：
  409 指纹 → 带指纹 200；target `rt-f4a5a7b4`，profile `graydovee-remote-workspace-795a19316403`，
  phase ready，capabilities 含 `muxWs:1`；`/api/state` 返回 2 workspaces / 6 sessions；
  portal 深链渲染 server 官方对话区（无双导航）。
- server profile RPC（qa1 + M2d）已 PASS：handshake、`fs/list`（home/path/parent/entries，
  非法路径 `fs-error`）、`session/create {blank:true}`（managed blank）、`session/prepare-server`
  （live 返回 managed:true）、`persist/stat`、`session/list` title fold。
- M2 UI 动作（client 7bd5aa + M2d，client 26025，target rt-f4a5a7b4）：
  - **add workspace PASS**：连接行隐藏操作 → 添加工作区 → 目录浏览（fs/list）进入
    `/home/tester/work` 选中 `qa-m2-ui-ws` 登记；再用绝对路径 `/home/tester/work/qa-m2-ui-ws2`
    手动登记。两次都出现在 client 树与 `/api/state` workspaces（4 行，路径正确）。
  - **rename BLOCKED（registry-stale 未被刷新清除）**：行菜单 → 重命名工作区 → 提交后 UI 显示
    “重命名工作区失败：server 端工作区已被其他实例修改，请刷新/重连后再试。”；随后点击远程区
    头部「刷新」与树底部「加载 server 端工作区变更」后重试，仍报同一错误。未发生写入（无静默覆盖），
    但客户端刷新入口没有清掉 guard stale revision，阻塞后续 remove/force、session 动作、搜索/拖拽。
    需 dev-core/dev-ui 确认客户端刷新是否调用 `registry/refresh` 及 loadedRevision 更新。
  - 未跑：remove(force)、session create/open/rename/fork/pin/archive/reorder、搜索/拖拽、
    冷 prepare-server 重启回归；local 按裁决不判。
  - 证据：`/tmp/dsh-qa/server/logs/m2-ui-evidence.txt`、`/tmp/dsh-qa/clients/client-m2d/m2-state-step1.json`。
  - **隔离复测（Lead 要求，2026-10-22）**：只保留 1 个 profile server + 全新 client 实例
    （`/tmp/dsh-qa/clients/client-m2e`，port 26026，M2e client `c262037a` + server M2d `053eec`）：
    workspace/rename 直接 200；`registry/refresh` 200 revision `d064aa0e…` serviceReplaced:true；
    再次 rename 200；state workspaces 更新。结论：先前 registry-stale 是 QA 并发（9 个 profile
    共享同一 workspace.json），不是 M2 server 代码 bug。单 client 写路径通过。
    观察：该 client 构建的 `state.connections[target].registry` 为 null（未填充，交 dev-core 确认）；
    另：旧 target 上重装新 client 包后重连出现 500 `Duplicate agent preset: remote:<targetId>`
    （新 DSH_HOME 正常），疑似升级/重连幂等 bug，已记录给 dev-core。
    证据：`/tmp/dsh-qa/server/logs/m2-ui-isolation-evidence.txt`。
  - **M2e 最终 pair（client `61962e…` + server `fffc37…`，client 26027 / target `rt-fa789207`）**：
    - add workspace 目录浏览（fs/list）与手动路径：此前 PASS；remove 用例补：
      `workspace/delete`（无 force）→ HTTP 500 `workspace-not-empty`（含 sessionCount=1；
      语义上建议 409，供 dev-server 确认状态映射）；
      `workspace/delete {force:true}` → 200 `{deleted:true}`；force 前后 server session 文件数
      12→12，被删 workspace 内的 session 目录/日志仍存在（会话日志不丢 ✅）。
    - session 动作：rename → 标题更新（seq=51）；fork → 新 sessionId；pin → pinned 列表；
      archive(stopActivity) → archived 列表；`registry/refresh` → 200 revision + serviceReplaced；
      `/api/state` 反映 title/pinned/archived/blank。
    - 证据：`/tmp/dsh-qa/server/logs/m2e-actions-evidence.txt`。
    - **M2f 状态码复测（server `3ce97ed7…`）**：`workspace/delete` 无 force → **409**
      `workspace-not-empty`（details 含 sessionCount/sessionIds，M2e 为 500，已修复 ✅）；
      force → 200；`workspace-unknown` → **404**；handshake 200。按 dev-server 要求只复测该路径。
      证据：`/tmp/dsh-qa/server/logs/m2f-status-evidence.txt`。
    - 未跑：搜索过滤、拖拽/重排 UI 点击、cold blank 的 UI 表现；local 不判。
- 证据：`/tmp/dsh-qa/server/logs/m2-evidence.txt`；M2d 后 27/27 profile-smoke 回归通过。

### 12.2c local 模式 E2E（进行中，2026-10-22）

产物：client `9bb7501f…`（最终 local client，gate=true）+ server M2f `3ce97ed7…`。
实例：`/tmp/dsh-qa/clients/client-local/home`，client web 26028，target `rt-0b889cf0`，
profile `graydovee-remote-workspace-a7620da6c3e6`；客户端模型用宿主 mock `127.0.0.1:28082`（QA fixture）。

已 PASS：
- connect 409 指纹→200；`state.connections.registry` 非 null（revision/epoch/stale）。
- `session/create {executor:"local"}` → 200，返回 executor local；server 立即出现
  `~/.dsh/sessions/--home-tester-work--/session-…/session.v4.jsonl.zstd`
  （header cwd=/home/tester/work、agentPreset=`remote:rt-0b889cf0` + permission/sandbox/approval 事件）。
- client 隔离：`home/sessions` 不存在（无远程会话 JSONL）；官方 `storages/workspace.json` = `{}`
  （无远程 stub）；仅 plugin 私有 `home/remote-workspaces/<clientId>/<targetId>/…`（架构允许，退出清理）。
- `mode/preview`（server/local，previewRevision=idle）+ `mode/apply` server→local→server 均 200，
  同 session id，cancelledTurnIds/openSessionId 正常。

- 最终 local pair `e2dae5bf…`（client）+ M2f/M2g（server）复跑：**create→open 均返回
  `executor:"local"`**（open 需带 workspaceId；clientId `a7620da6c3e6`，target `rt-0b889cf0`）。
  早前 open=server 的记录来自旧 client `9bb750`，非最终包。
- UI local 发消息（客户端官方 UI，session 历史已本地打开）：
  - **client agent loop/模型在 client**：宿主 mock `127.0.0.1:28082` 记录 3 个请求（success），
    客户端 UI 显示 assistant 完成文本；
  - **server 会话 JSONL 增长**；client 官方 `home/sessions` 仅客户端自己的本地工作区目录（无远程会话 JSONL）；
  - **工具执行失败（P1，mux）**：UI 显示 `失败运行命令Error: remote mux request "process.done"`
    failed on "rt-0b889cf0": spawn ba…`；server marker `qa-marker.txt` 未被写（mtime 未变）；
    server profile log 尾部有 `[dsh-remote-workspace] no sandbox backend inside the remote world;
    running workspace-write commands unconfined there` 与 node fd 警告。
  - 结论：local 模式「模型/agent loop 在 client」已验；「工具在 server 经 mux 执行」被 mux
    spawn/process.done 阻塞。
  - **根因（已复现）**：local 模式 process.prepare 的 cwd 是 client 私有 anchor
    `/tmp/dsh-qa/clients/client-local/home/remote-workspaces/<clientId>/<targetId>/<hash>`，
    该路径只存在于 client 本机；server 容器不存在该路径。`spawnSync('bash', …, {cwd: anchor})`
    复现 `ENOENT spawnSync bash ENOENT`（容器 bash 存在且 PATH 正常，换成 `/home/tester/work`
    则 status 0）。即 cwd 未做 client anchor → server 工作区路径的翻译。修复方向：process.prepare
    前把 cwd 映射为 server workspace cwd。完整证据 `/tmp/dsh-qa/server/logs/mux-spawn-evidence.txt`。
- M2g `session/list` 行 `executor` 字段已验：local create 行 executor=local；
  `executor/get` 返回 mode local + owner；`executor/assign {mode:"server"}` 后 mode=server。
  证据：`/tmp/dsh-qa/server/logs/m2g-executor-evidence.txt`。
- **local E2E PASS（2026-10-22 最终 pair）**：client `d9db2bab…` + server M2h `8b6efa16…`。
  - create/open → executor `local`（executorSource `record`、recordedExecutor `local`）。
  - UI 本地模式发消息：client mock 28082 收到请求（模型/agent loop 在 client）；server 端
    `tool/result` = `/home/tester/work\ndsh-remote-workspace QA server baseline`（bash 在 server 执行，
    cwd 已从 client anchor 翻译为 `/home/tester/work`）；server `qa-marker.txt` mtime 10:21→12:14；
    server session JSONL 有 tool/call + 成功 tool/result；client `home/sessions` 无该远程会话文件。
  - `mode/preview` + `mode/apply` server→local→server 均 200，同 session id/历史；
    `/api/v1/stop`→ reconnect 200，state ready，session 标题/executor 持久、JSONL/marker 保留。
  - 证据：`/tmp/dsh-qa/server/logs/local-e2e-pass-evidence.txt`。
  - 限制：browser_screenshot 仍被 “window not focused” 拒绝，用 DOM/API/服务器文件留证。

### 12.2d 最终候选与 M3（2026-10-22）

- 最终候选 client `fd3c797b…`（内置 server 插件 assets，**不设 DSH_RW_SERVER_PLUGIN_TARBALL**）：
  fresh DSH_HOME，connect 409→200；自动部署的 server 插件 sha 核对 = M2h `8b6efa16…`，
  plugin installed/protocol=1；`/api/state` 输出 5 workspaces / 23 sessions、registry revision/stale=false，
  capabilities 正常 → **自动安装/握手/state PASS**。
- M3 多 client（26027 clientId 666de48…、26028 clientId a7620da…，同一 server）：
  - PASS：每 client 独立 profile；A workspace create/rename 后 B refresh 可见；A reorder 后 A/B 顺序一致。
  - **PASS（修正口径）**：session pin/archive 共享状态在第二 client 执行
    `/api/registry/refresh` 后成立：A archive 200 → B registry/refresh 200（revision fce9d5dc…，
    epoch 0→1）→ B `/v1/sessions` 行 `archived:true`、A 同行一致、server registry archivedSessionIds 含该 id、
    revision 匹配；A pin → B registry/refresh → B row `pinned:true`。
    之前 FAIL 是因为只用了 `/api/state/refresh`；D12 的刷新入口必须是 registry/refresh（UI 的
    “加载 server 端工作区变更”）。遗留 server bug：pin 一个 archived session 返回 HTTP 500
    `internal`（应为 409/明确冲突），已交 dev-server。
  - NOT RUN（最终候选）：第二写者 writer-held 冲突、搜索过滤/拖拽重排/cold blank UI 点击证据。
- 早期 pair 上已验证（有效但非最终包）：M1、M2d/M2e/M2f/M2g、local E2E（d9db2bab + M2h）。
- 未执行：卸载/清理最终 sweep、真实 `~/.dsh` 前后对比（环境仍保留，清理步骤见 §10）。
- 证据：`/tmp/dsh-qa/server/logs/final-candidate-status.txt`、`m3-multiclient-evidence.txt`。

### 12.2e M3 收尾证据（2026-10-22）

- **final 候选自动安装（无 env）**：`fd3c797b…` 与 `81303596…` 均在 fresh DSH_HOME 下 connect 200，
  部署 profile `.dsh-rw-plugin.json` sha = M2h `8b6efa16…`；state plugin installed/protocol 正常。
- **M2i archived pin**：qa1 + M2i `bd5ae203…`，`session/pin {pinned:true}` 对 archived session
  返回 **409 `session/archived-pin`**（含 details.sessionId）PASS。
- **两 client pin/archive（final2 813035）**：A pin/archive 200，B `state/refresh` 200 后
  `/v1/sessions` 行仍 `pinned:false/archived:false` → host merge 修复未让 state/refresh 足够；
  显式 `registry/refresh` 时传播 PASS（§12.2d）。结论：D12 刷新入口必须走 registry/refresh，
  否则 pin/archive 呈现旧值；建议 dev-ui/dev-core 在 state/refresh 中也触发 registry 刷新。
- **writer-held**：A/B 各自 `session/open` 同一 session 均 200（未出现冲突）；`session/rename`
  返回 500 `sessionController.rename is unavailable`（server 缺口）；JSONL 60→61 行（session/end-seed），
  未见损坏。真正 writer 占用需 A 在 iframe 官方 UI 持有 writer 或 local agent 活跃后再试 —— NOT RUN。
- **部署确认条**：当前 target 的 `deployment/preview` 200 返回 runtime `action:"reuse"`、
  `requiresConfirmation:false`（mode confirm，reason 说明共享 global DSH 影响所有 profile）、
  plugin dedicated:true + action resume、requiresConfirmation:false → **正确 UI 状态是无确认按钮**，
  已作为“无需确认路径”留证；触发按钮需 global runtime 安装/升级或非专用 profile，未模拟（NOT RUN）。
  证据 `/tmp/dsh-qa/server/logs/deployment-ui-evidence.txt`。
- **cold blank / 搜索 / 拖拽 UI 点击证据**：NOT RUN（剩余预算不足，未伪造）。
- **清理/最终报告**：未执行，环境保留。证据：`final2-m3-evidence.txt`、`m2i-archived-pin-evidence.txt`、
  `m3-viewstate-precise.txt`。

### 12.3 架构裁决 §16 高风险专项（待实现后逐条执行）

| # | 风险点 | QA 证据口径 |
|---|---|---|
| 1 | server 模式新建会话：P1 session/create(blank) → prepare-server → iframe 深链 `?dshRwSession=<id>`，官方 restoreSelection 把 blank 显示为草稿页（不新建第二个 session） | DOM：草稿 composer 出现、无第二个 session id；会话文件只有一个 header；失败时改 `dshRwWorkspace` fallback 并记录 |
| 2 | registry/refresh：另一进程改 workspace.json 后 client 触发刷新，官方 UI 无损刷新、agent 不崩、重复刷新无泄漏 | A 改名 → B refresh → B list 新标题；重复 refresh 两次后 session 列表/agent 状态一致；失败记 fallback profile/restart + 二次确认 |
| 3 | 刷新语义：state/refresh 不杀 turn；profile/restart 前列 active turns 并确认；无“静默重启” | turn 运行中 state/refresh 后 turn 仍 running；restart preview 含 currentTurn/otherActiveTurns；取消应用后无重启 |
| 4 | 切执行端 D20：preview 列 currentTurn+otherActiveTurns；apply 带 previewRevision+cancelActiveTurns；缺清单拒绝；managed 不重启、unmanaged 才重启 | 错误码断言；managed/unmanaged 各一次进程表对比 |
| 5 | 同源 iframe 隔离：client `dsh.sessions.current`/`dsh.workspace.view.v5` 不被污染；无 server cookie；`Storage.clear()` 不误清；双 target 不串 | 浏览器 storage 键前缀（`dshrw:`）、cookie jar 域、two-target 交叉检查 |
| 6 | 多 client：按“刷新/重连后一致”验收 C3/H2；并发写 last-write-wins 不作为 v1 失败项 | 两 client 操作后刷新各自 state/侧栏一致；记录 D19 已知缺口 |
| 7 | 标题：另一 client 新建会话后刷新，sidebar 必须有 title/basename（插件 JSONL fold），不接受长期“未命名” | session/list 返回 title/titleSource；UI 行文本与 server 日志 fold 一致 |

执行前提：上述条目依赖 task-3/4/5/6 的实现与新版 tarball；当前只做 server 插件 P1 可验证部分
（§12.1），不把未实现能力记 PASS。

> 后续每完成一个阶段，更新本矩阵并在 `doc/qa-v1-report.md` 记录实际结果。
> 本文件只写 QA 计划与口径；实际证据与结论在报告中逐条对应。
