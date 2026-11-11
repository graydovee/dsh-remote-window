# dsh-remote-workspace v2 QA 报告（原生对话主区）

> 状态：**PREPARED / NOT RUN**（2026-10-23）。环境已就绪，等待 dev 可运行 client/server 包 sha；
> 未运行任何 v2 验收前不填 PASS。v1 报告见 `doc/qa-v1-report.md`。
>
> **2026-10-26 兼容性备注：** 本报告的运行环境与结果记录在 DSH `0.2.1-rc.2` 上；rc.3 的包/API/UI
> 冒烟与剩余端到端范围见 `doc/dsh-rc3-compatibility.md`。不要用本报告的 rc.2 证据直接宣称 rc.3 端到端通过。

## 1. 环境与隔离

- server target：Docker `dsh-qa-server`（linux/arm64，Node 22 + 全局 `@deepseek-ai/dsh@0.2.1-rc.2`），
  仅发布 `127.0.0.1:22022` SSH；web 只经 SSH local forward（`scripts/qa/`）。
- server 数据：命名卷 `dsh-qa-server-dsh-home`（隔离），workspace/run/mock 在 `/tmp/dsh-qa/server`。
- client：独立 `DSH_HOME=/tmp/dsh-qa/clients/v2a|v2b`（两个 client 用于 writer-held），
  `dsh web 127.0.0.1:26201|26202`；**绝不使用真实 `~/.dsh`**。
- 模型：官方 `@deepseek-ai/dsh-llm-mock-server`（`scripts/qa/mock-llm.mjs`，QA fixture，只替换模型端点），
  host mock `127.0.0.1:28082`，`DEEPSEEK_BASE_URL=http://127.0.0.1:28082/v1`、`DEEPSEEK_API_KEY=qa-mock-key`。
- 证据目录：`/tmp/dsh-qa/v2/<case>-<ts>/`（DOM 文本、API 响应、server JSONL 摘录、命令输出）。
  browser screenshot 若被 “window not focused” 拒绝，用 DOM/`browser_get_text` + API/文件证据并注明。

## 2. 待确认输入（阻塞启动）

1. v2 client tarball path + sha256（应内置 v2 server 插件 assets 与 checksums）。
2. v2 server 插件 tarball sha256（若 client 包未内置或需覆盖安装）。
3. v2 P3 路由/协议最终形态（task-13 草案：`POST /api/session/timeline`、`GET /api/session/events?targetId&sessionId&afterSeq`、
   `POST /api/session/prompt`、`POST /api/session/cancel`、`POST /api/session/approval`、`POST /api/session/status`；
   P1 方法 `session/timeline|events|prompt|cancel|approval|status`）。
4. approval 协议是否支持 + mock 如何触发审批（当前 repo 无 v2 实现；若 dev 未接 approval，本项记 NOT RUN）。
5. mock sequence 是否支持“流式文本 + tool_call + 审批/慢流”组合（需要可重复 fixture）。

## 3. 验收矩阵（执行时逐项填）

| ID | 验收项 | 步骤 | PASS 判据 | 证据 |
|---|---|---|---|---|
| V2-A | server 模式已有会话：**无 iframe** | 连接→展开 server workspace→打开已有 server 会话 | DOM 中无 `iframe[src*="portal"]`；主区为原生 timeline；composer/header 可见 | DOM 快照/文本、screenshot（如可用） |
| V2-A2 | timeline 与 server JSONL 一致 | 读 server `~/.dsh/sessions/**/<sid>/session.v4.jsonl.zstd`，按 seq 与 timeline 条目逐项比对 | 顺序一致；user/assistant/reasoning/tool-call/tool-result/turn/error 映射正确；长 tool output 截断有提示；分页 `beforeSeq` 无重复/丢失 | JSONL 摘录 + timeline DOM 文本；seq 集合 diff 文件 |
| V2-B | 新 blank + prompt：真实流式/tool | 树→server 新会话（blank）→composer 发送 prompt（mock sequence: 流式文本→tool_call→result→结束） | 文本逐步出现（非一次性）；tool call/result 渲染；目标文件写入 server；JSONL 增长（turn/start→message→tool→turn/end）；无 iframe；无重复 user 气泡 | DOM 多次快照时间差、mock `requests.jsonl`、server JSONL 行、marker 文件 |
| V2-C | stop 取消 | mock `slow_success`（长流）发送 prompt→点击停止 | 停止后流终止；已显示部分保留；composer 恢复可输入；JSONL `turn/end` 为取消/中止语义且无继续事件；无幽灵 turn | 停止前后 DOM、JSONL turn 事件、mock evidence |
| V2-D | 审批 allow/deny（若支持） | 触发需要审批的工具调用→deny→再次触发→allow | deny 不执行、显示可操作状态；allow 执行并进 timeline；JSONL/审批记录一致；无卡死 | DOM 审批卡片、server JSONL、工具执行结果/marker |
| V2-E | server↔local 切换 | 已有 server 会话→`mode/preview`+`mode/apply` local→切回 server | 同 session id/历史；local 使用 client 官方 UI；切回后 native timeline 无重复/丢失；运行中切换按 D20 取消语义 | API 响应、DOM、JSONL |
| V2-F | 断开/重连 + **afterSeq 去重** | 流式中切断 SSE（例如 `v1/stop`/重启 client web）→重连→events?afterSeq=最后 seq | 无重复 timeline 条目；缺失事件补齐；seq 连续/无空洞断言通过；JSONL 不产生重复记录；重连后 composer 可用 | 重连前后 seq 列表 diff、JSONL、DOM |
| V2-G | 两 client writer-held | A 持 writer（真实 prompt 中）→B `session/rename`/`session/prompt` | B 返回 **409 `session/writer-held`**（可操作文案）；A 结束后 B 接管 200；JSONL 未损坏 | A/B API 响应、server JSONL |
| V2-H | 清理/无泄漏 | cleanup 后检查 | 无 QA 容器/端口/`/tmp/dsh-qa`；真实 `~/.dsh` 未被使用；证据无 secret/真实凭据 | `docker ps`/`lsof`/目录检查、真实 `~/.dsh` 只读核对 |

## 3a. V2-P3 host 错误路径预验（QA 临时包；server v2 methods pending）

包：`/tmp/dev-core-tarballs/…tgz` sha `a66867ae6e6f15a9cd33f8fadb27c9fd0e94cc225f0acc0152f425540f16ab26`
（dev-core 临时 QA 包 v2，声称补 `beforeSeq`；内置 server assets 仍是 v1 `c10e…`，server v2 方法未上）。
前一轮包 `8ca27b8e…` 证据保留在 `/tmp/dsh-qa/v2/p3-error-paths/`。
环境：Docker+SSH target + client `/tmp/dsh-qa/clients/v2a`（26201），target `rt-ff50a5ac`。证据：`/tmp/dsh-qa/v2/p3-error-paths/evidence.txt`。

| 用例 | 实测 | 判定 |
|---|---|---|
| timeline `{}`（缺 targetId/sessionId） | 400 `bad-request` `"sessionId" is required` | **PASS**（缺参拒绝） |
| timeline 缺 sessionId | 400 `"sessionId" is required` | **PASS** |
| timeline 未知 target | **404 `target-not-connected`** | **PASS** |
| timeline 合法 target + 不存在 session | 500 `method session/timeline is not implemented in this Phase A skeleton` | **PENDING**（server v2 未上，预期） |
| timeline `beforeSeq:"abc"` / `-1` | 未在 host 校验，透传后 500 skeleton | **FAIL/PENDING**（host 应对 beforeSeq 做非负整数校验，交 dev-core） |
| prompt 缺 targetId/text | 400 `"targetId" is required` | **PASS** |
| prompt 合法 target+session | 500 `method session/prompt is not implemented …` | **PENDING**（server v2 未上） |
| cancel 缺 targetId/sessionId | 400 | **PASS** |
| approval 缺 targetId | 400 | **PASS** |
| approval 非法 decision（"maybe"） | 未在 host 校验枚举，透传 500 skeleton | **FAIL/PENDING**（host 应校验 decision ∈ allowed-once/rejected/cancelled/allow/deny，交 dev-core） |
| status 缺 targetId/sessionId | 400 | **PASS** |
| SSE `events` 缺 targetId | 400 `bad-request` | **PASS** |
| SSE 未知 target | **404 `target-not-connected`**（JSON，非流） | **PASS** |
| SSE `afterSeq=abc` | 400 `"afterSeq" must be a non-negative integer` | **PASS** |
| SSE 错误后 client 存活 | `/api/state` 200（无崩溃） | **PASS** |
| SSE 客户端断开 abort | server v1 skeleton 直接 JSON 非 SSE，无法构造长连接 | **NOT RUN**（待 server v2 后测） |
| 完整 timeline/prompt/cancel/approval/status 全链路 | 依赖 server v2 方法 | **NOT RUN** |

结论：P3 host 的 404/400/错误映射/SSE 错误路径按预期；server v2 方法将全链路由 500 skeleton 变为可测。

### 3a-bis 临时包 `a66867ae` 复核（历史，已被 3b04b9ec 取代）——当时 host 仍是旧 bundle

> **2026-10-23 更新（Lead 要求）**：a668 的 FAIL 结论**作废**（同路径 pnpm 缓存导致安装旧 rev）。
> 当前已用 dev-core QA 包 `3b04b9ec…`（内置 M2n `e0de3b0f…`）手工重装（`rm node_modules + 解包`，
> 确认安装后 lib/index.js 有 3 处 `beforeSeq`；profile marker = M2n）。复核 PASS：
> - `beforeSeq:"x"` → 400 `"beforeSeq" must be a non-negative integer`；
> - `beforeSeq:0` → 200（entries [] / beforeSeq 0）；
> - `beforeSeq+afterSeq` 同时 → 400 `"timeline accepts afterSeq or beforeSeq, not both"`；
> - approval `decision:"maybe"` → 400 白名单；approval 不存在的 approvalId → 400 `"approval ... is not pending"`。
> 证据：`/tmp/dsh-qa/v2/p3-recheck-3b04/evidence.txt`。以下 a668 历史记录保留仅作过程说明。

### 3a-bis-old 临时包 `a66867ae` 复核（历史）——**当时 host 仍用 afterSeq，beforeSeq 未实现**

证据：`/tmp/dsh-qa/v2/p3-beforeSeq/evidence.txt`。安装包 sha 已核 `a66867ae…`，client 26201 重连 200。

| 请求 | 实测 |
|---|---|
| timeline `{beforeSeq:0}` | 透传到 P1 → 500 skeleton（未校验） |
| timeline `{beforeSeq:-1}` / `{"x"}` / `{1.5}` | 全部透传 → 500 skeleton（未校验） |
| timeline `{afterSeq:0}` | 透传 → 500 skeleton（被接受） |
| timeline `{afterSeq:-1}` | 400 `"afterSeq" must be a non-negative integer` |
| timeline `{limit:0}` | 400 `"limit" must be a positive integer` |
| approval `decision:"maybe"` | 透传 P1 → 500 skeleton（host 未校验枚举） |

代码核对（安装后 `lib/index.js` `case "session/timeline"`）：实际解析的是 **`body.afterSeq`**，只把
`{sessionId, afterSeq?, limit?}` 传给 `profiles.sessionTimeline`；`beforeSeq` 没有读取/校验/透传。
而 `src/protocol.ts` 的 `RwTimelineRequest` 使用 **`beforeSeq`**（exclusive upper cursor），v2 P3 文档
也写 `beforeSeq`。→ **host 路由字段与协议不一致（FAIL/PENDING，交 dev-core）**，且 approval decision
枚举未在 host 校验（建议补）。



## 4. 证据采集命令（执行时用）

```bash
# client host API（cookie 由 token URL 换取）
J=/tmp/dsh-qa/clients/v2a/cookies.txt
curl -sS -b "$J" -X POST http://127.0.0.1:26201/dsh-remote-workspace/api/state -H 'content-type: application/json' -d '{}'
# timeline / prompt / cancel / approval（路径以最终包为准）
curl -sS -b "$J" -X POST .../api/session/timeline -d '{"targetId":"...","sessionId":"...","beforeSeq":...}'
curl -sS -b "$J" -X POST .../api/session/prompt -d '{"targetId":"...","sessionId":"...","text":"..."}'
# SSE：curl -N '.../api/session/events?targetId=...&sessionId=...&afterSeq=...'
# server JSONL
docker exec dsh-qa-server bash -lc "zstd -dc /home/tester/.dsh/sessions/**/session.v4.jsonl.zstd"
```

### 3a-ter M2n 预验：host 修复 PASS，但发现 SSE afterSeq/entryId 问题

包：dev-core v2 临时包 sha `3b04b9ec…`（手工 `rm node_modules + 解包` 安装，绕开 pnpm 同路径缓存；
`plugin-add` 对同 file: 路径/同版本不会刷新——记录给 dev/Lead）。内置 server M2n `e0de3b0f…`
（profile marker 已核）。

PASS（host/协议校验）：
- `beforeSeq:"x"` → 400 `"beforeSeq" must be a non-negative integer`；`beforeSeq:0` → 不再 400（到 P1，
  返回 404 `session-not-found` 或 200，视 session 存在）；
- `beforeSeq+afterSeq` 同时传 → 400 `"timeline accepts afterSeq or beforeSeq, not both"`；
- approval `decision:"maybe"` → 400 白名单错误；prompt `text:""` → 400；`mode:"weird"` → 400；
- timeline 已存在 blank session → 200（`entries:[]`, `eventCount:3`，`beforeSeq/afterSeq:3`）；
- SSE `ready` + `timeline` 帧可收到（blank session `eventCount:3`）。

FAIL（V2-F 目标：afterSeq 续传/去重）：
- **SSE 初始 replay 忽略 afterSeq**：同一 session 用 `afterSeq=0/2/3` 重连，均返回全部 timeline entries
  （seq 5,9,16,18），`ready/timeline` 帧里的 `afterSeq` 只是回显请求值（2/3），entries 未过滤 → 断线重连会重复。
- **entryId 跨连接不稳定**：同一事件 seq 5 的 entryId 在不同连接里为 `5:turn:4:start` / `5:turn:2:start` /
  `5:turn:1:start`（计数器随连接变化），无法用 entryId 做幂等去重；建议改为 seq+event 稳定 id。
- **timeline 分页方向/计数也不稳定**（同一 blank session，seq 5/9/16/18）：
  - `{limit:2}`（无 cursor）→ entries 只有 `[(18,turn)]`（不是最后 2 条）；
  - `{beforeSeq:19,limit:10}` → `[9(user),16(unknown),18(turn)]`，丢了 seq 5 turn start；
  - `{beforeSeq:18,limit:10}` → `[9,16]`；`{beforeSeq:18}`（无 limit）→ `[5,9,16]`；
  - **`{afterSeq:14,limit:10}` → 返回 `[5(turn),9(user)]`（比 afterSeq 更旧，方向反了）**；
  - `nextBeforeSeq` 为原始事件 seq（17/9/8…）与返回 entries 的 seq 不一致。
- 另：`assistant/attempt` 错误事件被映射为 `kind:"unknown"` 而非 `kind:"error"`；timeline `eventCount`
  = 19 但 server JSONL 行数 = 20（需确认是否排除 header/seq 0）。
- 其它 API 观察：`session/status` 未知 session 返回 200 `{agentAvailable:false,...}`（是否应 404 待定）；
  `session/cancel` idle 返回 200 `{canceled:true}`；`session/prompt` 未知 session → 409 `agent-unavailable`（可接受）。
- 证据：`/tmp/dsh-qa/v2/m2n-preflight/dedupe.txt`、`evidence.txt`、`pagination.txt`、`extra.txt`。

阻塞（V2-B prompt/tool、V2-D approval 全链路）：server profile 启动脚本只传 `DSH_HOME/PATH`
（`profile-lifecycle.ts` `env DSH_HOME=...`），不继承 client 的 `DEEPSEEK_BASE_URL/API_KEY`，导致
server agent `MISSING_CREDENTIAL`（timeline turn/end reason 可见）。需 QA 约定 server profile 的
mock 模型配置方式（见 §4a 变更），否则 V2-B/V2-D 只能 NOT RUN。

### 3a-quater server profile 模型环境 + M2n 审批链路预验（API 级）

**模型凭据配置（已解决）**：server profile 由 client profile-start 脚本以 `env DSH_HOME=… PATH=…` 启动，
不继承 client 进程的 `DEEPSEEK_*`。在 QA target 的 sshd 配置追加
`SetEnv DEEPSEEK_BASE_URL=http://127.0.0.1:28080 DEEPSEEK_API_KEY=qa-mock-key` 后 HUP sshd，
client `v1/stop -> connect` 重启 profile；profile 的 SSH session 继承该 env，agent 成功请求容器内 mock
（`/home/tester/qa-mock/requests.jsonl` 收到 attempt 1 = tool_call_success）。**该配置仅限 QA target**。

**M2n prompt/tool（API 级，部分 PASS）**：
- `session/prompt` 200 accepted；mock 收到请求；turn 2 流式 `assistant/message`（tool-call bash）写入 JSONL；
- JSONL 顺序：`assistant/message(seq28) -> tool/call(29) -> approval/asked(30)`；timeline 同步出现
  `assistant`(28)、`tool-call`(29)、`approval asked`(30)；`session/status` `running:true`。
- 因审批无法应答（见下），turn 停在等待审批，无法完成 tool/result/assistant 收尾 → V2-B 全链路 **BLOCKED**。

**M2n 审批应答 FAIL（V2-D，交 dev-server）**：
- `session/approval {approvalId:85496526-…, decision:"allow"}` → **400 `approval ... is not pending`**；
- 同一时刻 `session/status.pendingApprovals` 为 **[]**（approval/asked 已在 JSONL/timeline）；
- 即 pending 审批能在 timeline/JSONL 看到，但 `session/status` 与 `session/approval` 未接上（M2n 未完成
  pending registry / 应答映射）。M2o 只修 timeline/SSE，需确认是否包含 approval 应答；未包含则 V2-D
  在最终包仍未通。
- 证据：`/tmp/dsh-qa/v2/m2n-approval/evidence2.txt`。

**待 M2o**：timeline pagination / SSE afterSeq 去重（§3a-ter）在 M2o 上复测；本地 dist 仍是 M2n
（sha e0de3b0f…），M2o tarball 到手后安装复测。

### 3b. 统一最终候选（c6bd1dd0 + M2o）API 级结果

包：client `/tmp/dsh-v2-final` sha `c6bd1dd04fde1645695a0564b7cf5a40351f6cf44fae0f78584503ac040a69b1`，
内置 server M2o `6a090808…`（profile marker 已核）；fresh client `/tmp/dsh-qa/clients/v2f`（26211）。
结论：**M2o 的 timeline/SSE 修复 PASS；approval pending 仍 FAIL；native UI 尚未点击验证**。

PASS（API 级，证据 `/tmp/dsh-qa/v2/final-v2/api-evidence.txt`）：
- **timeline 分页**：无 cursor `limit:2` → 最后 2 条（32 tool-result、34 turn end）；`beforeSeq:19,limit:10`
  → 含 seq5（5/9/16/18）；`afterSeq:14,limit:10` → 更新条目（16…32），方向正确；`nextBeforeSeq` = 最旧返回 entry seq；
  entryId 稳定 `seq:kind`（`16:error`、`18:turn:end`、`28:assistant`、`30:approval:asked`…）。
- **错误映射**：`assistant/attempt` 错误 → `kind:"error"`（M2n 时是 unknown）；eventCount=35 = 逻辑事件数。
- **SSE afterSeq**：`afterSeq=9` 只回 seq>9（16,18,21…）；`afterSeq=16` 同理；ready/timeline 帧 afterSeq 正确，
  entryId 稳定，不再重复。
- `session/status` 未知 session → 404（M2n 时 200）。

FAIL / BLOCKED：
- **V2-D 审批 FAIL（M2o 仍未接上 pending/allow）**：v2f clientId `44e9fbd83993`，QA gate marker 已建
  （`~/.dsh/remote-workspace/44e9fbd83993/qa-approval-tool`=bash），profile 已重启，prompt 后 JSONL 出现
  `assistant/message(45) → tool/call(46) → approval/asked(47, id a9b8b7da-…)`、timeline approval asked 可见，
  但 `session/status.pendingApprovals` 始终 `[]`（带 SSE 订阅后仍 []），`session/approval allow` 无法执行。
  与 M2o 声称“marker 存在或 SSE 订阅时先建 pending”不符；需 dev-server 复核 marker 读取时机/pending registry。
- **V2-B 工具执行受 sandbox 限制**：danger-full-access 未生效（SSH SetEnv 追加被会话策略拒），workspace-write
  在 Docker 无 sandbox → tool-result `sandbox mode "workspace-write" is requested`；prompt/assistant 流式文本 PASS，
  tool 执行 PARTIAL。
- **V2-A native UI / V2-C stop / V2-E 模式切换 / V2-G 两 client / V2-H cleanup**：本轮未完成点击/全面验证
  （session 预算耗尽）；native UI 代码在包内（host 路由已验），但 **NOT RUN**，不写 PASS。

### 3c. v2 最终候选 2（6f4f2322 + M2p）结果

包：client `/tmp/dsh-v2-final2` sha `6f4f232264b3d9b34a91e65dae79c1af66d6868c7e742479861cd81f43df22cd`，
内置 M2p `793824e6…`（profile marker 已核）；fresh target + client 26221。

PASS（API 级）：
- timeline 分页：`limit:2` → 最后 2 条（27 assistant、29 turn end）；`beforeSeq:19,limit:10` →
  5/9/16/17/18（含 seq5）；`afterSeq:14` → 16…29 更新条目，方向正确；nextBeforeSeq=最旧返回 seq。
- entryId 稳定 `seq:kind`；SSE `afterSeq=19` 仅回 seq>19（20/21/23/26/27/29），不重复。
- approval 事件进入 timeline（asked/decided/tool-result），JSONL 有 asked/decided。
- `assistant/attempt`→error、status 404 在 M2o 已验证（M2p 未改该路径）。

FAIL（V2-D）：
- QA gate marker（clientId `9381d4cea293`，`~/.dsh/remote-workspace/…/qa-approval-tool`=bash）已建并
  `v1/stop→connect` 重启 profile；prompt 后 **approval asked 与 decided 同一毫秒自动 rejected**
  （`19:approval:asked` → `20:approval:decided outcome:"rejected"`），`session/status.pendingApprovals=[]`，
  没有机会调用 `session/approval allow`；tool-result = `Error: the user rejected tool "bash"`，无 marker 文件。
  → M2p 的 agent-scoped pending 仍被官方 answerer 自动拒绝（或 marker 未 preempt），V2-D **FAIL**。
- V2-B 工具执行：同因审批自动拒绝，无真实 tool 执行；V2-A native UI 点击 / V2-C stop / V2-E 模式切换 /
  V2-G 两 client / V2-H UI 清理未跑（NOT RUN）。

### 3d. v2 最终候选 3（M2q）approval 复测——仍 auto-reject

包：client 6f4f2322（M2q override `e712ff16…`，profile marker 已核）；target + client 26231；
server profile mock env（sshd SetEnv DEEPSEEK_* + DSH_PERMISSION_MODE=danger-full-access）与 QA gate marker
（clientId `70169501db3c`，`qa-approval-tool`=bash）已配置。

结果：
- `session/status` **`approvalGate:"qa"`**（marker 已识别），server.log 有
  `approval gate: qa(bash) marker=/home/tester/.dsh/remote-workspace/70169501db3c/qa-approval-tool`。
- prompt（mock bash）后 timeline/JSONL：`approval/asked seq19` → **同一毫秒 `approval/decided outcome:"rejected" seq20`**
  → `tool-result Error: the user rejected tool "bash"`；`session/status.pendingApprovals=[]`；无 marker 文件。
- server.log **没有** `approval request ... preempt=... subscribers=... pending=...` 行（M2q 声称的诊断未出现）
  → agent-scoped preempt listener 未进入审批瀑布，官方 answerer 仍先 reject。

结论：M2q 的 marker 识别 PASS，但 pending/preempt 仍 FAIL；V2-D 仍 **FAIL**。需 dev-server 检查
agentCtx.setup 注册是否被官方 ManagedAgents 调用、listener prepend 是否生效、以及为何无 approval request 日志。
证据：`/tmp/dsh-qa/v2/m2q-approval/evidence.txt`（cleanup 前）。

### 3e. v2 最终候选 3（M2q）V2-D 审批 **PASS**（allow/deny），V2-B 工具 PARTIAL

- 关键：**不能同时设置 `DSH_PERMISSION_MODE=danger-full-access`**（会让官方 ApprovalService policy=never，
  waterfall 前直接 rejected，与 M2q 无关）。V2-D 只配 DEEPSEEK mock env + QA gate marker（bash）。
- **allow**：`session/status` → `approvalGate:"qa"`；prompt mock bash 后 `pendingApprovals` 非空
  （approvalId、toolName、displayReason）；server.log：
  `approval gate: qa(bash) marker=…` 与
  `approval request session=… preempt=true subscribers=false pending=0`；
  `session/approval allow` → **200 decision allowed-once**；JSONL `approval/asked→approval/decided(allowed-once)`
  → tool/result（sandbox 错误；Docker 无 bwrap，属 V2-B 环境限制）→ assistant 回复 → turn end；timeline 对齐。
- **deny**：第二次 prompt → pending 非空 → `session/approval deny` → **200 decision rejected**；
  JSONL `approval/asked→approval/decided(rejected)` → tool-result `Error: the user rejected tool "bash"`；
  无 marker 文件；timeline 同步；`approvalGate:"off"` 当 marker 删除后（V2-B 轮）。
- V2-B 工具真实执行：即使 SSH SetEnv 加 danger-full-access，server agent 仍按 profile 配置 workspace-write；
  Docker seccomp 无 sandbox → `tool/result` sandbox 错误；**V2-B 工具执行 PARTIAL（环境限制）**；
  prompt/流式 assistant/timeline/JSONL 增长 PASS。
- V2-A native UI 点击/DOM 无 iframe / V2-C stop / V2-E 模式切换 / V2-G 两 client：本轮仍未跑（NOT RUN）。
- 证据：`/tmp/dsh-qa/v2/m2q2-approval/evidence.txt`、`m2q2-tool/evidence.txt`（cleanup 前）。

### 3f. 最终候选 4（f45d1830 + M2q）Lead 真实 target native UI 冒烟 —— **V2-A PASS**

- 包：`/tmp/dsh-v2-final4/…` sha `f45d183017c2edafc3f79a849b34c6ce0c57980128aff7ec45f66582f53a36f7`（内置 M2q）；
  真实 SSH target（QA 主机），Lead 浏览器冒烟，**非** QA Docker fixture。
- 步骤/结果（Lead 侧）：连接 → 打开该主机已有 blank 会话 → **iframe=0**（无嵌入主区）；
  主区显示 `session-4360… / <host> · <workspace> / server 执行 / 就绪`，timeline 空态与 composer 正常；
  SSE URL 修复后**不再出现“重连中”**；测试后 `v1/stop`。
- 判定：**V2-A native UI（无 iframe、header/空态/composer）PASS（真实 target）**；
  V2-A2 timeline API 一致性由 QA Docker API 证据 PASS；V2-D PASS（§3e）；V2-B PARTIAL（§3e）。
- 仍 NOT RUN：V2-C stop（真实流式中）、V2-E server↔local 切换、V2-G 两 client writer-held、V2-H UI 清理。

### 3g. v2 收尾 API 级 V2-C/E/G/H（final4 f45d1830 + M2q）

> 本轮本会话的 browser bridge 不可用（`no browser extension connected`），无法做 native composer/Stop/
> selection 的**点击**证据；以下为 API/日志级结果，UI 点击项标明 NOT RUN，不写 PASS。

- **V2-C（stop/cancel，API PASS）**：mock `stall` 起 turn → `session/status running:true`；
  `session/cancel` 200 → status idle；JSONL `turn/end reason={"kind":"aborted","reason":{"kind":"user"}}`；
  turn/start 计数 2（第二次为 stall turn，无幽灵重复 turn）。
- **V2-E（模式切换，API PARTIAL）**：`mode/preview` idle；`mode/apply` server→local 200
  （switchedSessionIds []、openSessionId=SID）；local→server 200；state session `executor:"local"`。
  native 时间线重建 / local 官方 UI 的浏览器证据 **NOT RUN**（bridge 不可用）。
- **V2-G（两 client writer-held，PASS）**：A stall turn running 时 B `session/rename` →
  **409 `session/writer-held`**；A `session/cancel` 后 B rename 仍 409（A connection 未停）；
  A `v1/stop` 后 B rename → **200**（takeover）。
- **V2-H（断开，API PARTIAL）**：A `v1/stop` 200 → state `phase:"stopped"`；
  `session/events` 返回 **404 target-not-connected**（SSE 已关闭）；iframe=0/selection 清理的 DOM 证据
  **NOT RUN**（bridge 不可用）。

## 4a. V2-D 审批 mock 方案（待 dev-server 触发方式）

协议字段已确认（`src/protocol.ts`）：`session/approval` 参数 `{sessionId, approvalId, decision}`，
decision ∈ `allowed-once|rejected|cancelled|allow|deny`；timeline entry `kind:"approval"`
（state asked/decided、outcome allowed-once/rejected/cancelled/unavailable）；SSE `approval` 事件；
`session/status.pendingApprovals` 返回待审批列表。

触发方案（按优先级）：
1. **server v2 官方审批触发（首选）**：由 task-12 `agent-control.ts` 使用 agents 服务发起真实工具审批。
   需 dev-server 提供一个可重复触发审批的 QA 场景（例如 mock tool `qa_approval_probe` 或明确的
   permission 场景 + mock sequence），QA 用 mock 工具调用触发，不依赖不可控的真实模型行为。
2. **权限模式触发（备选）**：`DSH_PERMISSION_MODE=workspace-write` + mock 工具写 workspace 外/危险命令；
   但 Docker Desktop seccomp 阻止 bwrap `mount /proc` → sandbox unavailable（v1 已证实 fail-closed
   `SANDBOX_UNAVAILABLE`），**大概率不会出审批而是直接失败**；仅在能提供可用 sandbox 的 Linux 主机上试。
3. **协议级伪造（只测错误路径）**：对不存在的 approvalId 调 `session/approval` → 期望 404/明确错误；
   验证 host 校验/错误映射，不等同 UI 审批。

执行步骤（触发可用时）：
- allow：prompt 触发审批 → timeline 出现审批卡片（toolName/reason）→ 点“允许一次”→ 工具执行 →
  timeline `approval(decided, allowed-once)` + tool-result；`session/status.pendingApprovals` 清空；
  JSONL 出现 asked/decided；mock 请求记录完整。
- deny：同样触发 → 点“拒绝”→ 工具不执行（无 marker/无 tool-result 成功）→ timeline outcome `rejected`；
  仍可继续下一轮 prompt。
- cancel：审批未决时停止/断开 → outcome `cancelled`，无工具执行。
- 证据：DOM 审批卡片文本/按钮、`session/status`、timeline/JSONL 摘录；若协议/触发未提供，V2-D 记
  **NOT RUN**（不伪造 PASS）。

## 5. 结果记录（待填）

| 项 | 状态 | 备注/证据 |
|---|---|---|
| V2-A 无 iframe | **PASS（Lead 真实 target）** | final4 f45d1830 + M2q：iframe=0，主区 header/空态/composer 正常（§3f） |
| V2-A2 timeline↔JSONL | **PASS（API）** | M2o/M2p/M2q：`afterSeq` 只回 >cursor、entryId `seq:kind`、分页方向正确（§3b/3c/3e） |
| V2-B blank+prompt 流式/tool | NOT RUN | |
| V2-C stop | **PASS（API）** | stall turn → cancel 200 → idle；JSONL turn/end aborted(user)；无幽灵 turn；UI Stop 点击 NOT RUN（bridge 不可用） |
| V2-D 审批 | **FAIL（M2n）** | approval/asked 进 timeline/JSONL，但 status.pendingApprovals=[] 且 session/approval 400 not pending；需 dev-server 修 |
| V2-E 模式切换 | **PARTIAL（API）** | apply local/server 均 200、session executor=local；native 重建/local UI 点击 NOT RUN |
| V2-F afterSeq 去重 | **FAIL** | SSE replay 忽略 afterSeq、entryId 跨连接不稳定（§3a-ter） | |
| V2-G 两 client writer-held | **PASS（API）** | A 运行时 B rename 409 writer-held；A stop 后 B rename 200 takeover |
| V2-H 清理/隔离 | **PARTIAL** | v1/stop 200、phase stopped、SSE 404；iframe/selection DOM 证据 NOT RUN |

## 6. 已知风险 / 限制

- repo 当前无 v2 实现（task-11/12/13/14/15 进行中）；P3 路由/时间线 schema 以最终包为准，报告在包到后先核对实现再执行。
- approval 若未接协议，V2-D 只能 NOT RUN；需 dev 明确触发方式（mock sequence + permission mode）。
- Docker Desktop seccomp 限制 bwrap；server 的 `workspace-write` 沙箱不可用，A1/v2 工具执行需
  `DSH_PERMISSION_MODE=danger-full-access`（与 v1 相同），报告中注明沙箱强制未验收（PARTIAL）。
- browser screenshot 可能被 “window not focused” 拒绝；以 DOM/文本/API/文件为主证据。
- SSE 断线重连需要可控断开方式（`v1/stop`/重启 client web）；若 dev 提供 debug hook 以 hook 为准。
- writer-held 需要 A 处于真实活跃 turn（managed agent 持写句柄），不能仅用 API open。

## 7. 清理计划（执行后）

```bash
# 停止两个 client web、mock
# scripts/qa/cleanup.sh --all --images --yes
# rm -rf /tmp/dsh-qa
# docker ps -a --filter label=dsh.qa=1 ；lsof -iTCP:22022/24022/26201/26202/28082
```
真实 `~/.dsh` 不作为任何 DSH_HOME；不写入 QA 凭据/数据。
