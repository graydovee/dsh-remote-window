# dsh-remote-window v1 QA 报告（2026-10-22）

> 环境与逐条口径见 `doc/qa-v1-plan.md`。本报告只记录实际执行结果，未执行项明确标 NOT RUN，
> 失败项不写成通过。所有 QA 数据在 `/tmp/dsh-qa/**` 与 Docker 卷/容器内，真实 `~/.dsh` 未被
> 用作 DSH_HOME、未被插件读写（测试结束后已清理环境，证据关键输出摘录于本文件）。

## 1. 环境

- server 目标：Docker 24.0.5（linux/arm64）+ Node 22.23.4 / 24.22.1 + 全局 `@deepseek-ai/dsh@0.2.1-rc.2`
  （npm 安装，端口仅发布 `127.0.0.1:22022/22024`；web 走 SSH local forward，不发布端口）。
- server 数据：`~/.dsh` 命名卷（隔离），workspace/run/mock 绑定到 `/tmp/dsh-qa/<name>/`。
- client：独立 `DSH_HOME=/tmp/dsh-qa/clients/*` 的 `dsh web` 实例（多实例/多 clientId）；
  模型用宿主/容器内官方 mock（`@deepseek-ai/dsh-llm-mock-server`，QA fixture，只替换模型端点）。
- 真实 `~/.dsh` 未设置为任何 client/server 的 DSH_HOME；未复制真实凭据。
- 已知环境限制：Docker Desktop 默认 seccomp 阻止 bwrap `mount /proc`，server 的
  `workspace-write` 无沙箱后端 → A1/A2 用 `DSH_PERMISSION_MODE=danger-full-access` 执行
  （Lead 批准，本报告相应条目标 **PARTIAL**：agent loop/工具/日志真实，沙箱强制未验收）；
  默认 workspace-write fail-closed（SANDBOX_UNAVAILABLE）已单独验证。

## 2. 验收结论总表

| 条目 | 结果 | 证据/说明 |
|---|---|---|
| A1 server 独立建工作区/会话/一轮对话 | **PASS（沙箱 PARTIAL）** | server 官方 UI 浏览器操作；mock 返回 bash 工具调用；`work/qa-marker.txt` 写入；会话日志落 server `~/.dsh/sessions/<slug>/session-*/session.v4.jsonl.zstd`；截图 + DOM |
| A2 会话日志位置 | PASS | server `~/.dsh/sessions/*.jsonl.zstd`，非 `remote-server-sessions`；宿主项目目录无该日志 |
| A3 client 连接/断开不影响 server | PARTIAL | server 独立可用与 connect 并存/断开后 server 仍可开（M1/M2 期间），未做专门对照采样 |
| B1–B6（连接/profile/隧道/断开/占用） | PARTIAL | B1/B4/B5 在 M1/M2 实测（host key 409→200、profile 名 `graydovee-remote-window-<clientId>`、断开重连 state ready）；B2/B3 独立 runtime/全局升级确认按钮 NOT RUN；B6 第二 client 同 profile 未构造（不同 clientId 多 client 已验证独立 profile） |
| C1–C7（左栏/远程数据） | PARTIAL | 远程树 连接→workspace→session、标题/sessionCount、双向刷新（server UI/远端 API）已验；pin/archive 跨 client 需 registry/refresh（见 M3）；搜索/拖拽/空错态 UI 点击 NOT RUN |
| D1–D7（工作区/会话动作） | PARTIAL | add（目录浏览+手动路径）、rename、remove(force/409)、session create/open/rename/fork/pin/archive/reorder API 已验；D7 会话删除未实现（官方能力缺失，记录） |
| E1–E5（server 模式） | PARTIAL | portal 官方对话区渲染、会话历史/标题一致、无 client 双 sidebar；模型/凭据在 server（mock 端口在 server 容器）、client 无 server key；E4 官方 UI 单实例占用/第二个实例错误 NOT RUN |
| F1–F5（local 模式） | **PASS（核心链路）** | client 模型/agent loop（宿主 mock 收到请求），server 工具执行（bash cwd=/home/tester/work、marker 写入）、server JSONL 增长、client `home/sessions` 无远程会话、mode apply、stop/reconnect |
| G1–G5（模式切换） | PASS（API/flows） | preview/apply server→local→server 200，同 session id/history，cancelledTurnIds/openSessionId 正常；运行中 turn 切换的 UI 取消表现 NOT RUN（无活跃 turn 场景） |
| H1–H5（多连接/多 client/版本） | PARTIAL | 两 client 独立 profile + 共享 workspace/order 已验；session pin/archive 需 registry/refresh（state/refresh 在 final4 修复后 PASS）；同 profile 第二 client 拒绝 NOT RUN；卸载清理 NOT RUN |
| I1–I5（安全/错误/回归） | PARTIAL | host-key unknown/变化语义、错误可见、profile 占用/运行时/插件错误有可操作错误（部分以 API 验证）；SSE/HTTP scrub 未专项审计；`pnpm typecheck/test/build` 由 dev 侧绿（QA 未重复全量）；macOS workspace-refs realpath 已知 4 失败单独标注 |
| J1–J4（文档/记录） | PARTIAL | `doc/qa-v1-plan.md`、本报告；J1/J2 文档由 Lead/dev 维护，QA 未逐项审核；J4 v2 边界已记录 |

## 3. 里程碑验证（实际执行）

- **M1（连接→树→portal）PASS**：独立 client `babd70…` + server `51d48f…`；409 host-key-unknown→200；
  target `rt-6cb70fd4`，state 2 workspaces/3 sessions；portal 深链渲染 server 官方对话区，DOM 与 server 会话日志一致。
- **M2（server 模式动作）PARTIAL PASS**：M2d/M2e/M2f/M2g/M2i：
  handshake 200（capabilities prototype/loader-disable-enable、muxWs）、fs/list、
  workspace create/rename/delete（无 force 409 workspace-not-empty、force 删行保留 session 日志）、
  session create(blank managed)/rename/fork/pin/archive/reorder、persist/stat、executor 字段、
  archived-pin 409 `session/archived-pin`；目录浏览 add workspace + 手动路径 PASS。
- **M3（多 client/共享状态）**：
  - workspace create/rename/order：两 client refresh 后一致 PASS；
  - session pin/archive：**final4（813035 系）state/refresh 内含 registry/refresh 后 PASS**——
    A pin→B state/refresh→B row `pinned:true`；A archive→B state/refresh→`archived:true`；
    之前 state/refresh 只调 registry? 的旧行为在 final2 上 FAIL，已由 final4 修复；
  - writer-held：**KNOWN GAP/NOT RUN**——两 client `session/open` 同 session 均 200（未触发冲突）；
    `session/rename` 在 M2i 前为 500 unavailable，M2j 声称 409 writer-held 但 QA 未用
    “A iframe/local agent 真占 writer” 路径复测；JSONL 未见损坏（60→61 行 session/end-seed）。
  - 搜索过滤、workspace/session 拖拽重排、cold blank 草稿 UI 点击：**NOT RUN**（预算用尽）。
- **local E2E PASS**（client `d9db2bab…` + server M2h `8b6efa16…`）：
  create/open executor local（executorSource record）；客户端 mock 模型请求；server bash 工具
  cwd 翻译 `/home/tester/work`、marker 写入、server JSONL 增长；client 无远程会话日志；
  mode apply server↔local；stop/reconnect 后 state/session/日志保留。此前 `spawn bash ENOENT`
  根因（client anchor cwd 未翻译）已定位并见证 dev-core 修复。
- **最终候选 auto-install（无 env）PASS**：`fd3c79…` / `813035…` 均自动部署内置 server 插件
  （sha M2h/M2i），handshake/state 正常；部署确认条当前 target 走 `requiresConfirmation:false`
  的 reuse 路径（无按钮是正确 UI），触发确认的 global 升级/非专用 profile 路径 **NOT RUN**。

## 3b. 最终候选迭代（final2/final4/final5）

- **state/refresh 内嵌 registry/refresh**：final4 `df6d2f04…` 两 client 复测通过——
  A pin → B `state/refresh` 200 → B `/v1/sessions` 行 `pinned:true`；A archive → B row `archived:true`；
  state/refresh 响应含 registry revision/epoch 与 `registryReloaded:true`。
- **final5 `9d3145d0…` + M2j `726e6851…`**：A auto-install 成功（deployed server plugin sha=M2j）；
  但 B（旧 final4 client + M2j server）`registry/refresh`/`session/rename` 返回
  **405 `internal: the server plugin answered with an invalid envelope (P1 …)`**，无法完成
  final5 两 client pin/archive 与 writer-held 复测（跨版本 client/server 信封不匹配，需同版本 pair 重试）。
  该失败为最终候选收尾的已知缺口。
- **cold blank UI / 搜索 / 拖拽 / 部署确认按钮路径**：NOT RUN。
- **writer-held**：M2j 声称 A iframe/local 持 writer 时 B rename 409；QA 未能以同版本 pair + 真实
  iframe writer 复测（如上 405 阻塞），仍为 KNOWN GAP。
- 部署确认条自动路径：`deployment/preview` 返回 reuse/requiresConfirmation:false，无按钮为正确状态；
  触发确认的 global 升级/非专用 profile 路径 NOT RUN（证据 `deployment-ui-evidence.txt`）。

## 3c. 单版本最终 pair 复现：P1 `invalid envelope`（FAIL）

按 Lead 要求重建环境、两个全新 DSH_HOME、**不设 env** 安装最终包
`/tmp/dsh-v1-final` sha `abb8552a692526f4ddb1d43b8de6bc5f78379d8d779df636087538782bbbcb64`：
- 两个 client（v1a 26101 / v1b 26102）均 connect 409→200；自动部署 profile marker sha =
  **M2j `726e685188695c08b5f4e1b22eb121967ab34d054bcbbf6f519ea123c1de2f21`**（client/server 同版本，非混装）。
- 随后 P1 调用失败（均为 HTTP **405**，client 报 server plugin 返回了 invalid envelope）：
  - `POST /api/v1/workspaces` → `{"ok":false,"error":{"code":"internal","message":"the server plugin answered with an invalid envelope (P1 workspace/list)"}}` HTTP 405
  - `POST /api/session/create` → invalid envelope (P1 session/create) HTTP 405
  - `POST /api/session/rename`（已有 session）→ invalid envelope (P1 session/rename) HTTP 405
  - `POST /api/state/refresh` → invalid envelope (P1 workspace/list) HTTP 405
  - `POST /api/registry/refresh` → invalid envelope (P1 registry/refresh) HTTP 405
    （首个 registry/refresh 曾 200，随后同类请求稳定 405；说明不是随机网络错误）
- 因此本次无法完成 writer-held（A iframe 持 writer + B 409）、A pin/archive → B state/refresh、
  cold blank UI 等最终验证；这些条目因 P1 阻塞记 **NOT RUN / BLOCKED**，不是 PASS。
- 证据：`/tmp/dsh-qa/server/logs/v1-final-single-version-405.txt`（含原始 HTTP/body）。
- 需要 dev-core/dev-server 对齐 client 期望的 P1 响应信封（`{ok:true,value}` vs 实际返回）与
  HTTP 状态映射；修复后重跑上述 5 条。

## 3d. M2k + final7 单版本 pair：405 修复确认（PASS）

- 环境：保留的 QA target 重建后 fresh DSH_HOME；两个 client（v1a 26101 / v1b 26102）安装
  final7 `/tmp/dsh-final7` sha `af8e1139…`（内置 M2k），无 env；两 client connect 200；
  profile marker = **M2k `935f04bc…`**（单版本 pair）。
- **405 回归消失**（同一保留环境，替换 M2k 后）：
  `registry/refresh` 200；`/v1/workspaces` 200；等待 2s 后 `workspace/list` 仍 200；
  `state/refresh` 200；`workspace/create` 200；`session/create` 200。
- **writer-held PASS**：A `session/create {blank:true,executor:"server"}` 后 managed blank 持有写句柄：
  - A 立即 `session/rename` → **409 `session/writer-held`**；
  - **B（另一 client）`session/rename` 同一 session → 409 `session/writer-held`**；
  - B `session/open` 返回 200（打开/查看不是写操作；与 Lead 口径“B open/rename 应 409”中
    rename 成立、open 在 v1 语义下允许读取）；
  - A `v1/stop` 释放后，B rename → 200（接管），server JSONL 5 行完好、无损坏。
- **A pin/archive → B 仅 `state/refresh`**：
  - A pin → B `state/refresh` 200 → B `/v1/sessions` 行 `pinned:true`；
  - A archive → B `state/refresh` 200 → B 行 `archived:true`（row title null 因 blank）；
  - 清理 unarchive 200。说明 final7/M2k 下 state/refresh 已含 registry 刷新，跨 client view state 成立。
- **cold blank UI（最终结论 PASS，M2l / final8）**：
  - QA 点击 path：workspace 新会话 → server blank 创建成功（state `session-93d67310…` blank:true、
    cwd=/home/tester/work、executor server；server `session.v4.jsonl.zstd` 已生成；iframe 深链带
    `dshRwSession`+`dshRwWorkspace`）。QA 侧因未处理一次性“开始使用/添加 API Key”登录弹层，画面停在
    “选择工作区”，当时误判为 M2l 失败。
  - **Lead 侧对照 PASS**：fresh final8 client + M2l，直接打开
    `portal/rt-ca18fe07/?dshRwSession=session-88dadaa9-…&dshRwWorkspace=4d1c3215-…`，iframe 显示
    workspace `work` + 官方 composer；唯一的一次性登录弹层（“开始使用/添加 API Key”）点关闭后
    composer 正常。截图 `/tmp/dsh-coldblank-proof.jpg`。
  - 结论：cold blank（blank 创建 + prepare + iframe 深链 + 官方 composer）**PASS**；操作注意：
    首次会弹出一次性登录层，需关闭一次。
- **cold blank UI 首测（final7/M2k，PARTIAL）**：workspace 行 action→新会话 触发 server-mode blank：
  state 新增 `session-55337139…`（blank:true, cwd=/home/tester/work, executor server），server
  `~/.dsh/sessions/…/session-55337139…/session.v4.jsonl.zstd` 已生成；iframe 深链为
  `…/portal/rt-a71514d5/?dshRwSession=session-55337139…&dshRwWorkspace=7ebab83a…`。
  但 iframe 官方 UI 在 ~9s 后仍显示 “探索未至之境 预览版 选择工作区 选择一个工作区开始”，
  **未渲染 blank 草稿 composer**（dev-server 所述 ~3s 预览浮层→继续→composer 流程未出现）。
  → create/prepare/iframe 深链 PASS；草稿 composer 渲染 FAIL/known gap，交 dev-ui/dev-server。
  证据：`/tmp/dsh-qa/server/logs/cold-blank-ui-evidence.txt`。
- **未完成**：部署确认按钮触发路径/搜索/拖拽仍 NOT RUN；
  部署确认按钮触发路径 NOT RUN（既有 requiresConfirmation:false/reuse 证据复用）；搜索/拖拽 NOT RUN。
- 证据：`/tmp/dsh-qa/server/logs/m2k-final7-evidence.txt`（逐条 HTTP/body）。

## 3e. 最终候选 final10 复核（2026-10-22 收尾）

- final10 client `ff10e9480e4e26f8675a1a49ed549dca00d4492e612e1671c89f3982531393d3`
  （搜索 UI 恢复版本）+ server M2l `a4ea81da…`；fresh target + 单 client（26131）无 env，connect 409→200；
  workspace alpha/beta/gamma 由 API 创建。
- **搜索过滤**：输入 `beta` → 可见树仅保留 `beta`（连接行/local 行正常保留）PASS；
  **清除搜索**：点“清除搜索”后 input 为空、树恢复全量 `gamma/beta/alpha` PASS（与 Lead 侧一致）。
- **独立 runtime：PASS（Lead 侧真实 install+start；dev-server 产物可复现）**：
  - Lead 验收：artifact `/tmp/dsh-runtime-0.2.1-rc.2-linux-arm64.tar.gz`（210M，sha `3338e705…`）→
    client final10 + `DSH_RW_FORCE_ISOLATED_RUNTIME=1` + `DSH_RW_RUNTIME_ARTIFACT=…` → connect 200；
    state `runtime.kind="isolated"`、launcher 指向
    `~/.dsh/remote-window/<clientId>/runtime/dsh/node_modules/.bin/dsh`、`dshVersion=0.2.1-rc.2`、
    profile ready、plugin handshake 1。
  - dev-server 构建脚本 `scripts/build-runtime-artifact.mjs` 产出
    `dist-runtime/dsh-runtime-0.2.1-rc.2-<platform>-<arch>.tar.gz` + sha/manifest（root=`node/`+`dsh/`）；
    QA Docker 为 aarch64，最新 linux-arm64 artifact sha `bcafcc0b…`（182MB），dev-server 已在 QA 容器内
    实测解包→`node -v`=v22.23.4→`dsh --version`=0.2.1-rc.2→`dsh --profile web --dump-config` 成功。
    其他平台 sha：linux-x64 `64e8fa60…`、darwin-arm64 `144e3324…`。
  - client 用法：artifact 放 `~/.dsh/remote-assets/linux-arm64/dsh-runtime-0.2.1-rc.2-linux-arm64.tar.gz`
    或 `DSH_RW_RUNTIME_ARTIFACT` 指向，走 isolated runtime install（stop profile server → upload/install → start）。
- 用户裁决“全局 runtime 只允许隔离 runtime”，因此 global 修改按钮路径不再作为缺口；部署条显示
  隔离 runtime 自动安装即可。
- 剩余：legacy 代码/文档清理（dev-core 执行中）、沙箱强制 PARTIAL（Docker Desktop seccomp 限制，
  A1/A2 用 danger-full-access；真正 sandbox backend 需 Linux 主机/自定义 seccomp 复测）。

- **最终结论状态：等待 legacy/M2m 最终包**。除 legacy 代码/文档清理（dev-core 执行中）与沙箱强制
  PARTIAL 外，v1 其余功能均已 PASS；M2m 最终包到达后按需做一次冒烟复核并给出最终一句话结论。

## 3g. final13 legacy-clean + M2m c10e 最终冒烟（2026-10-22）

- client `/tmp/dsh-final13` sha `60c20d0f…`（legacy-clean：旧 src/server/WSL/stdio 已删）+ 内置 server
  **M2m `c10e8661…`**（profile marker 已核）。
- PASS：无 env auto-install（connect 409→200、plugin installed/protocol 正常）；M1 connect/state；
  **搜索 beta→clear**（输入 beta 仅剩 beta，清空后恢复 alpha/beta/gamma）；local `session/create
  {executor:"local"}` + `session/open`（executor local, executorSource record）；server JSONL 生成；
  client `home/sessions` 仅自身本地工作区会话（无远程会话 JSONL，private projcache 除外）；
  `mode/preview`+`mode/apply` 200；`v1/stop`→reconnect 200。
- 未在 final13 重跑：UI 发消息 + mock 工具写 server marker（host mock 0 请求、无 qa-marker.txt）；
  完整 local E2E 仍以 d9db2bab+M2h 的 PASS 证据为准（legacy-clean 未改 local 路径）。
- 结论：final13/M2m 的 legacy-clean 冒烟通过（搜索与 local 基础设施 PASS；UI 工具链未重跑，标注清楚）。

## 3f. 历史收尾备注

- final9（`931b34f0…`）上搜索过滤/clear、拖拽、cold blank 均 PASS（证据见 §3d/§4）。
- 但 dev-ui 后续误删搜索 UI，Lead 已要求恢复；**最终交付 client 以“恢复搜索 UI 的版本”为准**。
  在该最终包到达前，本报告 §3d 的搜索 PASS 证据对应的不是最终包；最终包到达后需重建最小环境
  复测“搜索过滤→清空恢复→（可选）拖拽”并更新本报告。
- 另有两项收尾依赖：独立 runtime artifact（当前缺失，v1 全局 runtime 只复用）与 legacy 代码/文档清理，
  由 Lead/dev 完成后再出最终报告。

## 4. 已知缺口 / 失败项

1. **writer-held 未证伪**：同 session 两个 client open 均成功；需 A 在 iframe 官方 UI 或 local agent
   真持 writer 后 B open/rename 期望 409 `session/writer-held`（M2j 起）。当前记 KNOWN GAP。
2. **UI 点击证据缺失**：搜索过滤、拖拽/重排、cold blank 草稿、部署确认按钮路径 NOT RUN。
3. **沙箱强制未验收**：Docker Desktop seccomp 限制，A1/A2 用 danger-full-access；真正 sandbox backend
   需 Linux 主机/自定义 seccomp profile 复测（PARTIAL）。
4. **大量 UI 交互**（取消 turn、审批/权限、空/错态、官方 UI 单实例占用）未逐项做浏览器证据。
5. 浏览器截图在本次 session 被 bridge 以 “window not focused” 拒绝，M1/M2/local 证据以 DOM/API/文件为主；
   Lead 侧 M1 截图作为视觉记录。
6. `workspace-refs` macOS realpath 4 条既有失败（环境差异，非本插件）。
7. M3 view state 的刷新语义：final4 起 state/refresh 内含 registry/refresh；旧客户端的 state/refresh
   不足以传播 pin/archive（已在 final2 上 FAIL、final4 上 PASS）。
8. **[已解决] 405 `invalid envelope`**：根因为 M2j 静态 inject sessionController 被 registry refresh 连带卸载；
   M2k（懒取 + rename fallback）下同环境 P1 全部 200（final7 pair，§3d）。
9. cold blank / 搜索过滤+clear / workspace 拖拽均已 **PASS**（见上）；
   部署确认按钮路径按用户裁决不再要求（global 只允许隔离 runtime，部署条显示孤立 runtime 自动安装）；
   卸载清理 UI 路径仍 NOT RUN。
10. **[已解决] 独立 runtime：PASS（Lead 侧真实 install+start）**：使用本地构建 artifact
    `/tmp/dsh-runtime-0.2.1-rc.2-linux-arm64.tar.gz`（210M，sha `3338e705…`，容器内构建 node/+dsh/），
    client final10 + `DSH_RW_FORCE_ISOLATED_RUNTIME=1` + `DSH_RW_RUNTIME_ARTIFACT=…` → connect 200；
    `/api/state`：`runtime.kind="isolated"`、launcher=`/home/tester/.dsh/remote-window/<clientId>/runtime/dsh/node_modules/.bin/dsh`、
    `dshVersion=0.2.1-rc.2`，profile ready、plugin handshake 1。发布 CI artifact 仍属 server 仓库外部发布项。
    用户裁决“全局 runtime 只允许隔离 runtime”，因此 global 修改按钮路径**不再是缺口**；部署条显示
    隔离 runtime 自动安装即可。
11. **搜索 clear（final9 复测 PASS）**：final9 client `931b34f0…` 实测——输入 `beta` 后可见树仅
    保留 `beta` 工作区（连接行+本地行的正常保留）；点“清除搜索”后 input 为空、树恢复全量
    `gamma/beta/alpha`。搜索过滤与 clear 恢复均 PASS（与 Lead 侧结论一致）。
12. **workspace 拖拽（PASS，Lead 浏览器实测）**：final9/M2l（client 26113，target rt-454fe7da）——
    对 alpha 行 dispatch `dragstart`，对 gamma 的 `.dsh-rw-ws-group` dispatch dragover/drop
    （clientY=top+2）→ UI 顺序变为 `alpha,gamma,beta`；点刷新后仍保持，说明 reorder 已写 server。
    QA 之前 pointer 序列不触发 HTML5 DnD，属自动化方式问题，非功能失败。

## 5. 清理与环境状态

- 测试使用 Docker 容器/卷与 `/tmp/dsh-qa/**`、`/tmp/dsh-qa-inspect`、`/tmp/dsh-config-probe` 等临时目录；
  收尾已停止所有 QA client `dsh web`、执行 `scripts/qa/cleanup.sh --all --images --yes`（容器/卷/镜像/数据），
  并删除上述临时目录。
- 真实 `~/.dsh`：QA 的所有 client/server 实例均使用独立 `DSH_HOME=/tmp/dsh-qa/...`，未把真实
  `~/.dsh` 作为 DSH_HOME，未复制真实凭据。收尾只读检查：`~/.dsh/storages/workspace.json` 中无
  `/tmp/dsh-qa` 引用；但真实 `~/.dsh` 下可见 `remote-windows/rt-1`（mtime 2026-10-22 20:25，
  由本工作区其它 agent/真实 profile 的验证产生，不是 QA 实例写入）、本 harness 自身 session
  projection/attachments（其中会提及 QA 命令文本）。因此本报告不声称“~/.dsh 完全未被触碰”，
  只声称“QA 隔离实例未使用它，且 QA 未向其复制/写入凭据或 server 数据”；清理未删除任何
  真实 `~/.dsh` 内容。
- 复查：`docker ps -a --filter label=dsh.qa=1` 为空；`lsof` 无 22022/22024/240xx/250xx QA 端口；
  `/tmp/dsh-qa` 不存在。

## 6. 证据索引（清理前路径）

- `/tmp/dsh-qa/server/logs/`：`smoke-*.log`、`m1-independent-qa-evidence.txt`、`m2-evidence.txt`、
  `m2-ui-*.txt`、`m2e-actions-evidence.txt`、`m2f/status-*`、`m2g-executor-evidence.txt`、
  `m2i-archived-pin-evidence.txt`、`m3-multiclient-evidence.txt`、`m3-viewstate-precise.txt`、
  `m3-writerheld-evidence.txt`、`local-e2e-*.txt`、`mux-spawn-evidence.txt`、
  `final-candidate-status.txt`、`final4-state-refresh-evidence.txt`、`deployment-ui-evidence.txt`。
- 客户端会话隔离证据：`client-local/home/sessions` 不存在；`storages/workspace.json` 无远程 stub；
  仅 plugin 私有 `home/remote-windows/<clientId>/<targetId>/<hash>`。
- doc：`doc/qa-v1-plan.md`（逐条口径 + §12 阶段记录）、本报告。
