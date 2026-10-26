# dsh-remote-workspace v1 重构需求与验收契约

> 状态：产品/验收契约，2026-10-22 由用户逐项确认。  
> 架构细节由 architect 在 `doc/refactor-v1-architecture.md` 中细化；两者冲突时，本文件的产品决定优先，
> 架构可行性问题必须回到本文件补一条明确决定，不能静默改需求。  
> 2026-10-26：运行时基线更新为 DSH `0.2.1-rc.3`；复核记录见 `doc/dsh-rc3-compatibility.md`。
> 本文件只写占位主机/路径，不记录真实凭据、内网地址或本机绝对路径。

## 0. 一句话目标

把旧架构“client 跑 agent、server 只做执行世界”重构成：

> **server 是一台能独立工作的普通 DSH；client 是它的远程入口。**
> client 保留现有两段式 sidebar（「远程工作区」+「工作区」），远程工作区下按
> **连接 → server 工作区 → server 会话** 展示，行样式和功能对齐本地工作区；
> 每个连接可选择执行端：server 完整执行，或 client 本地 agent + 本地凭据；
> 两种模式都以 server 的工作区、会话日志和共享视图状态为权威。

v1 的 server 模式主区复用 **server 官方对话区**（嵌入 client 主区）；v2 才把主区换成
client 自己的官方 UI。v2 不作为本轮验收阻塞项。

---

## 1. 已确认的产品决定

| # | 决定 | 结论 |
|---|---|---|
| D1 | 执行端 | 每个连接一个设置项，可在 **server 执行** 与 **client 本地执行** 之间切换；两种都支持。 |
| D2 | 执行端切换时机 | 切换会**自动取消当前 turn**；已产生内容保留；会话 ID 与历史不变，下一轮由新模式执行，仍写同一份 server 日志。 |
| D3 | 数据权威 | 两种模式下，工作区清单、会话日志（含聊天记录/标题）、持久视图状态都以 **server** 为权威；client 只缓存/显示。 |
| D4 | 布局 | client 布局保持现状：左栏「远程工作区」+ 本地「工作区」两段；远程段是连接 → server 工作区 → server 会话。 |
| D5 | 远程行 | server 工作区/会话行复用官方行样式与交互；功能对齐本地工作区（见 §4.3）。 |
| D6 | server 侧形态 | server 运行普通 `dsh web` + `dsh-remote-workspace-server` 插件；server 的全局 DSH 不依赖 client 也能独立工作。 |
| D7 | per-client 隔离 | client 生成稳定 `clientId`；每个 client 在 server 上有独立 profile：`graydovee-remote-workspace-<clientId>`；**一个 profile 只允许一个 client 连接**；不同 client 可有不同插件/运行时版本，但共享 server 的 `~/.dsh` 工作区与会话。 |
| D8 | profile 模式 | 本地模式和 server 模式**共用同一个 per-client profile**；模式只改执行端，不换 profile。 |
| D9 | profile 生命周期 | client 负责启动和停止该 profile 的 `dsh web`；断开时停止并取消当前 turn；重连时重启。server 的全局 DSH 不受影响。 |
| D10 | 运行时 | 独立运行时按 client 隔离（每个 client 一个固定目录）；独立运行时自动安装/升级，连接时无需用户确认；全局运行时也可安装/升级，但**每次必须按钮确认**。运行时来源：client 缓存上传优先，server 在线下载兜底。 |
| D11 | 插件安装 | 专用 profile 的 `dsh-remote-workspace-server` 可自动安装/重装/升级/覆盖并重启；安装到其他 profile 时，安装/重启都需要按钮确认。 |
| D12 | 视图状态 | 置顶/归档/排序/拖拽顺序存 server、跨 client 共享；搜索是本地瞬时过滤，不落盘、不同步。 |
| D13 | 多连接/多客户端 | client 可同时连多台 server；同一 server 可被多个 client 连接；每个 client 用自己的 profile/runtime，共享工作区/会话/视图状态。 |
| D14 | 传输 | 产品只做 SSH；WSL 和 Docker 连接方式本轮移除。Docker 只用于 QA 目标环境。 |
| D15 | 旧架构 | 彻底替换，不迁移旧远程会话；旧 `~/.dsh/remote-server-sessions` 保留但不显示；清理旧本地 stub/refs；本地工作区不受影响。 |
| D16 | v1 / v2 | v1 验收：server 官方对话区 + client sidebar；v2：把 server 模式主区换成 client 官方 UI，单独排期，不阻塞 v1。 |
| D17 | 会话占用 | 同一会话不能被多个实例同时对话。具体 UI 行为（报错/只读/接管）由 architect 按 DSH 官方能力验证后定；底线是**不得静默并发写**。 |
| D18 | QA 环境 | Docker + SSH 容器；client 用独立 `DSH_HOME` 调试实例；QA 在浏览器完成“连接 → 工作区 → 会话 → 对话”的验收。 |
| D19 | 全局 DSH 实时同步 | v1 只要求 client ↔ **server 模式嵌入的 profile 官方 UI** 双向实时；server 全局 DSH 独立可用，但 client 的 workspace/view 改动可能需要重启/重开全局 DSH 才可见（上游 registry 进程内缓存限制）。全局实时同步作为后续任务（插件装全局 profile 或 server-wide coordinator），不阻塞 v1。 |
| D20 | 切换影响范围 | 切换执行端时当前 turn 自动取消；若该 profile 还有**其它 active turn**，UI 必须列出并二次确认，确认后一起取消；不得静默打断。 |

---

## 2. 术语

| 术语 | 含义 |
|---|---|
| **server 全局 DSH** | server 用户原本的 DSH 安装/运行实例，不依赖本插件，可独立工作。 |
| **per-client profile** | `~/.dsh/profiles/graydovee-remote-workspace-<clientId>`，一个 client 一个，独立 `dsh web` 进程/端口，共享 `~/.dsh` 数据。 |
| **profile server** | 用 per-client profile 启动的 `dsh web` 进程；client 通过 SSH 隧道访问。 |
| **server 模式** | agent loop、模型调用、模型凭据、工具执行、会话日志都在 server；client 是远程 UI/入口。 |
| **本地模式** | agent loop、模型调用、模型凭据在 client；文件/进程/沙箱/终端、工作区/会话日志在 server。 |
| **共享视图状态** | pin/archive/排序/拖拽顺序，存 server，跨 client 共享。 |
| **远程工作区** | server 的官方 DSH 工作区，在 client 远程段展示；不是 client 本地目录。 |
| **v1 主区** | server 模式下嵌入的 server 官方对话区；本地模式下 client 自己的官方对话 UI。 |
| **clientId** | client 首次安装生成并持久化的稳定短 ID；用作 profile 名和独立运行时目录名。 |

---

## 3. 角色与边界

### 3.1 server 侧

- 运行普通 DSH（全局或 per-client 独立运行时），安装 `dsh-remote-workspace-server` 到 per-client profile。
- profile server 共享 server 的 `~/.dsh`：工作区注册表、会话日志、模型凭据（server 模式）。
- server 全局 DSH 必须能在 client 不连接时独立创建/打开工作区、会话和对话。
- 插件只增加远程入口能力，不改变 server 官方 UI 的既有行为；server 官方 UI 仍可直接使用。
- 一个 profile 只接受一个 client；需要锁/租约，防止同一 profile 被两个 client 同时驱动。

### 3.2 client 侧

- 运行本机 DSH + 本插件；负责连接、host key、运行时/插件部署、profile 启动/停止、SSH 隧道、UI。
- client 本地「工作区」段保持官方行为；远程段只展示 server 工作区。
- 不把远程工作区写成 client 共享 `workspace.json` 的可见条目；不把远程会话日志写进 client `~/.dsh/sessions`。
- 若官方草稿页必须本地锚点，只能是插件私有、不可见、退出即清理的临时材料；architect 必须证明不会污染本地工作区列表。
- 凭据只在需要的一端：server 模式用 server 模型凭据，本地模式用 client 模型凭据；SSH 凭据始终只在 client。

### 3.3 非目标（v1）

- 不做 WSL、Docker 连接方式（Docker 只作 QA）。
- 不做旧 `remote-server-sessions` 迁移。
- 不做 v2 的“server 模式主区 = client 官方 UI”。
- 不做本地 DSH 不支持的会话删除（若官方没有，远程也不新增）。
- 不做跨用户账号/多租户；SSH 用户就是 server 数据边界。
- 不做远程会话的只读/接管 UI，除非 architect 验证官方能力后明确纳入（见 D17）。

---

## 4. 功能需求

### 4.1 连接与部署

1. client 首次使用生成稳定 `clientId`，持久化在本机插件存储；profile 名为
   `graydovee-remote-workspace-<clientId>`；一个 client 对应一个 profile。
2. SSH 连接沿用现有 host-key 语义：未知 host key 展示 SHA-256 等确认；已 pin 变化中止；
   密码/私钥/口令只在本机；错误、日志、SSE 必须 scrub。
3. 连接流程自动检测 server 运行时：
   - 无独立运行时或版本不兼容 → 安装/升级到该 client 的独立运行时目录；
   - 独立运行时自动升级，无需用户确认；
   - 全局运行时可用但缺失/不兼容 → 安装/升级必须按钮确认，不得静默写全局目录。
4. 插件安装/升级：
   - 专用 profile：自动创建/安装/重装/升级/覆盖，并自动重启 profile server；
   - 其他 profile：安装、重启均需按钮确认，client 不得静默改。
5. client 启动 profile server（`dsh web --profile <profile> --host 127.0.0.1 --port <free>`），
   建立 SSH 本地隧道、取得访问 token、验证 plugin handshake；断开时停止并取消当前 turn。
6. 同一 profile 已有一个 client 时，第二个 client 连接必须得到明确错误，不得并发驱动。
7. 连接失败/版本不兼容/插件缺失/profile 被占用/端口冲突/权限不足，都必须有可操作错误；
   不得回退到“悄悄在本地跑”。

### 4.2 左栏与数据

1. 左栏保持两段：
   - 「远程工作区」：连接列表；连接下是 server 工作区；工作区下是 server 会话。
   - 「工作区」：client 本地官方工作区，行为不变。
2. 远程段的连接行是插件行；工作区行/会话行复用官方 `ProjectRowItem` / `SessionNodeItem` 的
   样式、菜单壳、hover、选中态和文案；不得另画一套行样式。
3. 远程工作区清单来自 server 官方工作区注册表；会话清单来自 server 官方会话存储/插件；
   client 不维护第二份“远程工作区记录”。
4. 多个 client 连接同一 server 时，看到相同 workspace id/path/title/sessionCount；
   任一 client 或 server 官方 UI 修改后，刷新/重连可见。
5. 展开连接/工作区时按需加载；加载中、空态、失败态可见；失败不能伪装成空列表。
6. 远程工作区/会话的持久视图状态（pin/archive/排序/拖拽）存 server 并共享；
   搜索框只过滤当前 client 视图，不写 server。
7. 远程段不得把 server 工作区写进 client 本地「工作区」段，也不得在 client 共享
   `workspace.json` 留下可见 stub。

### 4.3 工作区/会话功能（v1 验收范围）

远程工作区行/会话行至少支持：

1. 添加工作区（浏览 server 目录并注册官方 server 工作区）；
2. 移除工作区（server 清单删除；有会话时的确认/force 语义按官方或插件既有约定）；
3. 重命名工作区（改 server 标题，不改目录）；
4. 新建会话（进入官方草稿/会话流程）；
5. 打开会话/继续会话；
6. 会话重命名、分叉；
7. 置顶/归档（server 共享）；
8. 搜索（本地过滤）、排序/拖拽（server 共享顺序）；
9. 删除会话：仅当本地 DSH 官方支持；否则明确不做并记录。

所有动作必须反映到 server 官方数据；成功/失败必须有明确反馈；不得只在 client 本地改一个副本。

### 4.4 执行端与切换

1. 连接设置增加执行端选项：`server` / `local`（文案可再定）；默认值由产品/架构定，必须可见。
2. `server` 模式：
   - agent loop、模型调用、模型凭据、工具执行、会话日志都在 server；
   - client 不接收/不发送 server 模型 key；client 只发送用户输入和 UI 操作；
   - 主区显示 server 官方对话区（v1）。
3. `local` 模式：
   - agent loop、模型调用、模型凭据在 client；
   - 文件/进程/沙箱/终端、工作区、会话日志在 server；
   - 主区显示 client 官方对话 UI（沿用现有布局/组件）；
   - 不得静默回退到 client 本地文件系统执行。
4. 切换执行端：
   - 当前会话有在跑 turn → 自动取消；已产生内容保留；
   - 会话 ID/历史/标题不变；下一轮使用新模式；
   - 同一份 server 日志只能有一个写者；切换不得产生重复/丢失 turn；
   - 切换后 UI 必须明确显示当前执行端与凭据归属。
5. 新会话使用连接当前设置；已有会话保留创建时的执行端记录（除非用户显式切换）。

### 4.5 v1 server 模式主区

1. 在 client 主区嵌入 server 官方对话区（同一 server 官方 UI，不是重画）；
2. server 官方 UI 的 sidebar/topbar 等重复导航隐藏或不可用，client 自己的 sidebar 是唯一导航；
3. 支持打开指定 workspace/session 的深链；切换会话时主区跟随；
4. 发送消息、取消、审批/权限、流式输出、历史滚动等官方交互可用；
5. 主题/语言/字体尽量与 client 一致；至少不出现明显双导航/双滚动条；
6. 该主区通过 SSH 隧道 + 同源代理访问，不要求 server 暴露公网端口，不依赖跨站 cookie/iframe。

### 4.6 本地模式

1. 复用 client 官方对话/草稿/会话 UI；执行世界指向 server；
2. agent loop、模型、凭据在 client；server 不需要模型 key；
3. 会话日志/标题/工作区在 server；client 本地不出现该远程会话日志；
4. 远端工具执行、文件读写、进程/终端、沙箱行为与 server 官方执行世界一致；
5. 远端执行世界不可用时 fail-closed，不得在 client 本地执行并假装成功；
6. PTC 等模式限制按实际能力文档化；不得承诺未实现能力。

### 4.7 会话占用与多客户端

1. 同一会话同一时间只能有一个执行实例对话；第二个 client 不得静默并发写日志。
2. 具体表现（明确错误 / 只读 / 确认接管）由 architect 验证 DSH 官方能力后定稿；
   验收底线：日志不损坏、用户能看到可操作原因。
3. 每个 client 使用自己的 profile server；共享工作区/会话/视图状态。
4. 不同 client 可使用不同运行时/插件版本；不得互相升级/覆盖。
5. client 断开后：profile server 停止、隧道关闭、当前 turn 取消；共享数据不受影响。

### 4.8 清理与旧数据

1. 旧架构的远程 workspace 记录、stub、本地 shell 条目、agent preset 等在升级/启动时清理；
2. 旧 `~/.dsh/remote-server-sessions/**` 保留，不在新 UI 展示，不做迁移；
3. 不得删除 server 官方 `~/.dsh/sessions`、工作区数据、模型凭据；
4. 本地工作区/会话不受影响；
5. 卸载/禁用插件后，client 本地不留下可见远程行/stub；server 共享数据保留。

---

## 5. 权威归属表

| 数据 | server 模式 | 本地模式 | 落盘 | client 角色 |
|---|---|---|---|---|
| 工作区清单/标题 | server 官方 registry | server 官方 registry | server `~/.dsh` | 缓存/显示 |
| 会话清单/标题/日志 | server 官方 session store | **server** 官方 session store | server `~/.dsh/sessions` | 缓存/显示；本地模式经插件读写 |
| 聊天事件/turn | server agent | client agent，写 server 日志 | server 日志 | 显示/转发 |
| 模型凭据 | server | client | 各自 credential store | 不跨线 |
| 工具执行/文件/进程 | server | server | server | 只发操作 |
| SSH 凭据 | client | client | client | 权威 |
| clientId/profile | client 生成、server 落 profile | 同左 | client 存储 + server profile | 权威 |
| pin/archive/排序/拖拽 | **server 共享** | **server 共享** | server 插件存储 | 读写 |
| 搜索 | client 瞬时 | client 瞬时 | 不落盘 | 本地 |
| 连接设置（执行端） | client | client | client 存储 | 权威 |

---

## 6. profile / 运行时生命周期

1. profile 路径：`$DSH_HOME/profiles/graydovee-remote-workspace-<clientId>`；
   `clientId` 只含安全字符（小写字母/数字/短横线），长度受 profile 名限制。
2. 独立运行时目录：`$DSH_HOME/remote-workspace/<clientId>/runtime`（最终路径 architect 可微调，
   但必须按 client 隔离且固定）；全局运行时用 server 现有 `dsh`。
3. 安装顺序：确保运行时 → 确保 profile 存在 → 安装/升级插件 → 启动 profile server → handshake。
4. 独立运行时升级可自动；升级前停止该 profile server，升级后重启；不影响其他 client。
5. 全局运行时安装/升级必须按钮确认；确认文案写明会影响 server 上使用该全局运行时的其他 profile。
6. 插件安装到专用 profile 可自动重启；其他 profile 必须按钮确认。
7. 一个 profile 一个 client：server 侧锁/租约；client 断开/崩溃后，下次连接可以清理 stale 锁/进程；
   第二个 client 连接必须被拒绝并给出原因。
8. client 断开 → 停止 profile server、关闭隧道、取消当前 turn；重连重启并 resume。
9. server 全局 DSH 与 profile server 共享 `~/.dsh`，但不得互相破坏；并发写需要架构层锁/串行化。

---

## 7. v1 验收标准

> 每条都要有可复现证据（命令输出/文件/截图/DOM/网络记录），不接受“看起来对”。  
> QA 默认用 Docker + SSH 容器 + 独立 client 调试实例；不碰真实 `~/.dsh`。

### A. server 独立可用

- A1. server 只装普通 DSH + 插件、不连 client，能启动 `dsh web`，创建/打开工作区，新建会话，发送一轮对话，文件写在该 server 工作区。
- A2. 上述会话日志出现在 server `~/.dsh/sessions`（不是旧 `remote-server-sessions`）。
- A3. client 连接/断开不改变 server 全局 DSH 的可用性；server 全局 DSH 仍能打开同一工作区/会话（按官方占用语义）；client 改动在全局 DSH 的可见性受 D19 限制（可能需要重启/重开全局 DSH）。

### B. 连接与 profile

- B1. client 生成稳定 clientId；server 出现且仅出现对应 profile；profile 名符合约定。
- B2. 首次连接自动安装/升级独立运行时与专用 profile 插件；无用户确认（独立运行时/专用 profile）。
- B3. 全局运行时缺失/不兼容时，UI 出现按钮确认；未确认前不写全局目录。
- B4. 连接成功后有 SSH 隧道 + token + plugin handshake；server 不监听公网端口。
- B5. 断开后 profile server 停止、隧道关闭、当前 turn 取消；重连可恢复工作区/会话；无孤儿进程/端口。
- B6. 第二个 client 连接同一 profile 被拒绝，错误可操作。

### C. 左栏与远程数据

- C1. 左栏仍是「远程工作区」+「工作区」两段；远程段为 连接 → server 工作区 → server 会话。
- C2. 远程工作区/会话的 id/path/title/sessionCount 与 server 官方数据一致；两个 client 看到同一份。
- C3. 在 **server 模式嵌入的 profile 官方 UI** 新建/重命名/删除工作区或会话后，client 刷新/重连可见；反向亦然。server 全局 DSH 的实时同步不在 v1（D19）：只验独立可用 + 重启后同数据。
- C4. 行样式/菜单/选中态与官方行一致；没有自绘的替代行样式。
- C5. 空态/加载/错误可见；远程数据失败不被当作空列表。
- C6. 远程段不污染 client 本地「工作区」；client 共享 `workspace.json` 无可见远程 stub；client `~/.dsh/sessions` 无远程会话日志。
- C7. 搜索是本地过滤；pin/archive/排序/拖拽跨 client 共享，重连后保持。

### D. 工作区/会话功能

- D1. 添加工作区（浏览 server 目录）→ server 官方 registry 出现；server 官方 UI 也能看到。
- D2. 移除工作区：server 清单删除；有会话时按既定确认/force 语义；会话日志不丢。
- D3. 重命名工作区：只改标题，不改目录；server 官方 UI 同步。
- D4. 新建/打开会话：会话出现在 server 官方数据；client 与 server 官方 UI 一致。
- D5. 会话重命名/分叉/置顶/归档：server 数据/共享视图状态生效；多 client 一致。
- D6. 排序/拖拽：顺序存 server；另一个 client 刷新后一致；搜索不改变持久顺序。
- D7. 删除会话：若本地官方无此能力，明确记录为不实现；若实现，必须 server 权威删除且不可误删其它会话。

### E. server 模式

- E1. 在 client 选择 server 模式，打开一个 server 会话并发送消息；agent loop、模型请求、模型凭据、工具执行都在 server（用 server 进程/日志/网络证据）。
- E2. client 侧不出现 server 模型 key；client 本地不新增该会话日志。
- E3. v1 主区显示 server 官方对话区；能收到流式输出、取消、审批/权限等官方交互；无双 sidebar/双导航。
- E4. server 官方 UI 能打开同一会话时符合官方单实例语义；若被占用，第二个实例得到明确错误，不损坏日志。
- E5. client 断开/重连后，server 会话历史仍在；重连可继续。

### F. 本地模式

- F1. 在 client 选择本地模式，agent loop/模型请求/模型凭据在 client；文件/进程/沙箱/终端在 server。
- F2. 会话日志/标题/工作区仍在 server；client 本地无该会话日志。
- F3. server 不需要 client 的模型 key；client 的模型 key 不写 server。
- F4. 远端执行世界不可用时 fail-closed；不得在 client 本地执行并返回成功。
- F5. 另一个 client 能在官方占用语义下看到/继续该会话（或得到明确占用错误）。

### G. 模式切换

- G1. 连接设置可在 server/local 间切换；切换时当前 turn 被取消，已产生内容保留；若该 profile 还有其它 active turn，UI 必须列出并二次确认，确认后一起取消（D20）。
- G2. 会话 ID/历史/标题不变；下一轮由新模式执行，写同一个 server 日志。
- G3. 切换后无重复 turn/丢失 turn；日志行数与内容可解释；第二个 client 不受静默并发写影响。
- G4. 切换方向各测一次（server→local、local→server），包括有在跑 turn 的场景。
- G5. UI 明确显示当前执行端与凭据归属；切换后主区/状态正确。

### H. 多连接/多客户端/版本

- H1. 一个 client 连接两台不同 server；各自独立 profile/隧道；互不影响。
- H2. 两个 client（不同 clientId，最好不同插件/运行时版本）连同一 server：各自 profile/runtime，不互相升级/覆盖；共享工作区/会话/视图状态。
- H3. 同一 client 重连复用/重启自己的 profile；不误用其他 profile。
- H4. 一个 profile 同时只被一个 client 驱动；第二个连接被拒。
- H5. 断开/卸载清理：profile server 停止、隧道关闭、无孤儿；server 共享数据和会话保留。

### I. 安全、错误与回归

- I1. host key 未确认/变化、密码错误、运行时下载失败、插件安装失败、端口冲突、profile 锁冲突都有可操作错误；无静默回退。
- I2. 日志/错误/UI 不出现密码、token、模型 key；SSE/HTTP body 过 scrub。
- I3. client 本地工作区/会话/官方行为回归通过；禁用/卸载插件后本地不受影响。
- I4. 旧 remote stub/refs/agent preset 清理；旧 `remote-server-sessions` 保留但不显示；不迁移。
- I5. `pnpm typecheck`、`pnpm test`、`pnpm build` 通过；既有 macOS `workspace-refs` realpath 失败单独标注。

### J. 文档与验收记录

- J1. 更新 `doc/official-workspace-reuse.md`：UI 复用、对官方 UI 的改动、功能复用、自实现清单、v1/v2 边界。
- J2. 更新架构/协议/AGENTS/README；记录 per-client profile、runtime、模式切换、占用语义、部署流程。
- J3. QA 报告包含 Docker 目标、两个 client、server 独立、server/local 模式、切换、重连、多客户端、错误路径的证据。
- J4. v2（client 官方 UI 主区）明确不在本轮验收，记录为后续任务。

---

## 8. QA 环境与证据口径

1. **server 目标**：本机 Docker + SSH 容器（Linux），安装 Node 22/24 + DSH 0.2.1-rc.3 + 插件；
   容器内 `~/.dsh` 为隔离数据；SSH 端口只绑 127.0.0.1。
2. **client 目标**：按 `AGENTS.md` 的空调试实例起独立 `DSH_HOME` 的 `dsh web`，不碰真实 `~/.dsh`；
   浏览器用 browser 工具操作；需要两个 client 时起两个独立实例/端口。
3. **server 运行时来源**：优先 `npm i -g @deepseek-ai/dsh@0.2.1-rc.3`（公开 npm 包，bin=dsh），asar 提取只作交叉验证；Node 22/24 各验一次。QA 可用官方 `@deepseek-ai/dsh-llm-mock-server` 或本地 OpenAI-compatible mock 作为模型端点夹具，但必须是真实 DSH agent loop 发起请求、真实写 server 会话日志；mock 只替代模型端点，并标注为 QA fixture。
4. **server 独立证据**：不连 client 时在 server 浏览器/CLI 建工作区、会话、发消息；贴 server 进程/日志/文件。
5. **远程证据**：client sidebar 截图/DOM；server `~/.dsh/sessions` 日志；server 进程网络；client 本地无对应日志。
6. **模式证据**：server/local 各一轮；抓 server/client 模型请求归属；切换时取消/保留；日志一致。
7. **多客户端证据**：两个 clientId/profile；同一 server 工作区/会话/视图状态；不同版本运行时不互相覆盖。
8. **清理证据**：断开后 `pgrep`/端口/隧道无残留；profile 锁释放；临时目录清理；真实 `~/.dsh` 未被触碰。
9. 所有截图/日志不得含真实凭据、token、内网地址；使用占位值。

---

## 9. 架构开放项（architect 必须在设计文档中关闭）

1. **官方能力验证**：普通 DSH 的 `workspaceRegistry`、`sessionPersistence`、`sessionController`/`agents`、
   模型/凭据服务在 0.2.1-rc.3 的可用接口；服务端模式的会话事件流/发送/取消/审批如何复用。
2. **会话单实例语义**：DSH 官方是否已锁同一会话；第二个实例的实际行为；是否需要插件侧 lease；
   验收 UI 选“报错/只读/接管”中的哪一种。
3. **同源代理**：`dsh web --public-url` 前缀代理 + `--trusted-host` + cookie/`Sec-Fetch-Site` 的可行方案；
   server 官方对话区在 client 主区的认证、WebSocket、静态资源、深链、主题同步。
4. **共享工作区注册表并发**：多个 profile server + server 全局 DSH 同时读写 `~/.dsh` 的锁/串行化；
   插件 API 如何保证 server 官方 registry 不被破坏。
5. **本地模式会话适配**：client agent 如何读写 server 官方会话日志；如何避免本地 stub 污染；
   官方草稿页绑定如何满足（允许插件私有临时材料，但不得可见/持久污染）。
6. **server 模式会话适配**：client sidebar 数据/操作如何映射到 server 官方会话；v1 主区如何只显示
   官方对话区并隐藏重复导航；模式切换如何取消/交接/加锁。
7. **协议/鉴权**：client host ↔ server plugin 的 RPC/HTTP/SSE 形状；profile 锁、token、版本握手、
   错误码；两仓库逐字节契约如何调整。
8. **部署**：独立运行时构建/缓存/校验/上传；全局运行时检测/确认；plugin 安装/重启；profile server 启停；
   stale 进程/锁清理；端口选择。
9. **clientId/profile 清理**：client 重装/换机/丢失 clientId 后的旧 profile 处理；是否提供“删除我的 profile”。
10. **DSH 升级维护**：新架构下 vendor/官方 UI 复用边界、AGENTS 维护规则、回归测试矩阵。

---

## 10. 团队与交付

- **Lead/PM**：维护本契约、验收、集成、文档、最终裁决。
- **architect**：关闭 §9 开放项，产出 `doc/refactor-v1-architecture.md`、协议/模块/生命周期/风险；
  先做只读 spike，再允许开发者写代码。
- **dev-server**：server 插件、共享数据/视图状态、server 模式会话/agent 接口、profile 锁。
- **dev-core**：client SSH/运行时/插件部署、profile 生命周期、隧道/鉴权、本地模式会话适配。
- **dev-ui**：client 左栏远程树、官方行复用、搜索/排序/拖拽、模式设置、v1 server 官方对话区容器。
- **qa**：Docker SSH 目标、两个 client 调试实例、浏览器 E2E、证据报告。
- 文件写作用域、任务依赖、验收顺序由 Lead 在共享任务板维护；架构先行，开发不得在架构文档关闭前
  大面积改 `src/`。

---

## 11. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-22 | 初版：合并用户对执行端、布局、per-client profile、运行时/插件安装、视图状态、v1/v2、QA 环境的决定。 |
