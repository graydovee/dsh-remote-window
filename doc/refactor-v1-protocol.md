# dsh-remote-window v1 协议与接口契约

> 状态：**v1 可实现契约**（architect 产出；产品决定以 `doc/refactor-v1-requirements.md` 为准，
> 两者冲突时产品决定优先）。本文档先于实现冻结，开发据它开工；变更必须同时更新
> `doc/refactor-v1-architecture.md`、验收口径和两仓共享文件。
>
> 基线：DSH **0.2.1-rc.3**（精确钉住，不做语义化范围兼容）。旧 `REMOTE_SESSION_PROTOCOL = 3`
> 与 stdio 分帧通道随旧架构退役；v1 使用本文的 **`REMOTE_WORKSPACE_PLUGIN_PROTOCOL = 1`**。
> 文中 `0.2.1-rc.2` 的实测/示例是升级前记录；rc.3 复核见 `doc/dsh-rc3-compatibility.md`。
>
> 文档只写占位主机/路径（`tester@203.0.113.10`、`/home/user`、`/tmp/...`），不记录真实凭据、内网
> 地址或本机绝对路径。

---

## 0. 术语与角色

| 术语 | 含义 |
|---|---|
| **client** | 本机 DSH + `dsh-remote-window` 插件；负责 SSH、部署、profile 生命周期、portal、客户端 UI。 |
| **server** | SSH 目标机；运行普通 DSH + `dsh-remote-window-server` 插件（装在 per-client profile 里）。 |
| **profile server** | 用 `graydovee-remote-window-<clientId>` profile 启动的 `dsh` web 进程；每 client 一个。 |
| **server 插件** | profile server 进程里的 `dsh-remote-window-server` Cordis 插件；提供 RPC/SSE/mux/embed，并调用官方 host service。 |
| **client 插件** | client 本机 DSH 里的 `dsh-remote-window` 插件；提供 client host 路由与浏览器 UI。 |
| **portal** | client host 上的同源反向代理 `/dsh-remote-window/portal/<targetId>/`，把浏览器请求经 SSH `forwardOut` 转给 profile server。 |
| **官方 UI** | profile server 自己服务的 DSH Web GUI（v1 server 模式主区）。 |
| **客户端 UI** | client 本机 DSH 的官方 Web GUI（v1 local 模式主区 + 全部 sidebar）。 |
| **官方 cookie** | `dsh web` 的 `dsh-auth-<authorityHash>` 浏览器 cookie；authority 由请求 Host 决定。 |
| **clientId** | client 首次安装生成、持久化的稳定短 ID（小写字母/数字/短横线；v1 约定 12 位 hex）。 |
| **instanceId** | client 每个 `dsh` 进程实例启动时生成的随机 ID（每次插件激活一个新的）。 |

### 0.1 角色边界（不可越线）

- SSH 密码/私钥/口令只在 client；不进入任何 server 请求体、日志或记录。
- 模型凭据：server 模式只在 server（client 不接收、不发送）；local 模式只在 client（server 不接收）。
- server 模型 key 不会出现在 client 插件 API、SSE 或 UI 中。
- server 端只有 per-client profile 的插件对外提供路由；**server 不监听公网端口**；profile server 只绑
  `127.0.0.1`，由 SSH 隧道访问。
- 任何错误文本、日志、SSE detail 都必须经过 `scrubSecrets` 等价处理（client 侧沿用
  `src/targets/types.ts::scrubSecrets`；server 侧对已知 secret 形状做同样处理）。

---

## 1. 三个传输平面

v1 只用一条 SSH 连接，同时承载三类流量。**每 target 只启动一个 profile server、只用一条 SSH 连接**；
不为 server 模式 / local 模式 / 浏览器各自开第二条通道。

| 平面 | 发起方 | 路径 | 承载 |
|---|---|---|---|
| **P1 client host → server 插件 API** | client host（Node） | SSH `forwardOut` → `http://127.0.0.1:<profilePort>/dsh-remote-window-server/...` | 握手/租约、workspace/session/executor RPC、local 模式 persist RPC、SSE 事件、执行世界 mux WS |
| **P2 浏览器 → portal → 官方 UI** | client 浏览器（同源 iframe / 资产） | client host `http://<clientOrigin>/dsh-remote-window/portal/<targetId>/...` → 剥前缀 → SSH `forwardOut` → `http://127.0.0.1:<profilePort>/...` | 官方 UI HTML/asset、`/api` HTTP、`/api/remote.mux` WS |
| **P3 client host → client 浏览器** | client host（client 自己的 DSH host 路由） | `/dsh-remote-window/api/<name>`、`/dsh-remote-window/stream/state`（SSE） | sidebar 数据/动作、连接/部署进度、模式设置、portal 配置、错误 |

P1/P3 都是 client 插件自己的 HTTP 面：两者都先过 client 侧 `trustedRequest`（loopback/trustedHost +
`sec-fetch-site` + 同源 Origin），body ≤ 1 MiB。P1 的 server 侧再额外过官方 cookie 鉴权（§2.2）。

---

## 2. 通用约定

### 2.1 信封

所有插件 JSON 路由（P1、P3）统一：

```
成功: 200 { "ok": true, "value": <T> }
失败: <status> { "ok": false, "error": { "code": "<stable-code>", "message": "<scrubbed>",
                                         "details"?: <JSON> } }
```

- 方法名允许含斜杠（`workspace/create`），**不要**在路由层加“禁止斜杠”的守卫。
- 请求 body 必须是 JSON 对象；空 body 视为 `{}`；上限 1 MiB；超出 `400 bad-request`。
- 可选字段用条件展开 `...(x === undefined ? {} : { x })`；缺省 ≠ null。
- 时间一律 ISO-8601 字符串或 Unix ms（字段名以契约表为准）；id 一律字符串。
- 错误 `details` 只放可公开的结构化信息（id、计数、版本号、阶段），绝不放 secret。

### 2.2 鉴权

| 平面 | 鉴权 |
|---|---|
| P1 server 插件路由 | 每个请求（含 WS upgrade、embed 静态资源除外）调用 `ctx.connection.admit(req)`；`{rejection}` → 原样 `401/403`；`{peer}` → 继续。再由插件校验 `x-dsh-rw-client` / `x-dsh-rw-instance` 头与当前 lease 一致，不一致 → `403 lease-mismatch`。 |
| P1 执行世界 WS | `ctx.webServer.registerUpgrade` + `ctx.connection.admit(req)`；401/403 直接销毁 socket；然后校验 lease 头与 target 会话。 |
| P1 handshake | `POST .../api/handshake`：cookie 鉴权 + body 内 clientId/instanceId；不要求既有 lease（它就是来取/换 lease 的）。 |
| P2 portal | client host 先过 `trustedRequest`（浏览器同源）；上游由 client host 注入官方 cookie。**浏览器永远拿不到 profile server 的 token/cookie。** |
| P3 client 路由 | `trustedRequest` +（写操作）client 自己的 DSH 会话安全模型；body ≤ 1 MiB。 |

`profile server` 的启动 token 只出现在：client host 内存、server 侧 `server.log`（0600）。绝不进
client 浏览器、client 记录、错误文本。

### 2.3 版本与能力握手

```
REMOTE_WORKSPACE_PLUGIN_PROTOCOL = 1
```

- client 在 `handshake` 里发 `protocol: 1`；server 只接受精确相等，返回
  `{ protocol: 1, pluginVersion, dshVersion, capabilities }`。
- 不等 → `409 plugin-protocol-mismatch`，`details: { clientProtocol, serverProtocol }`；**禁止静默降级**。
- `pluginVersion` 只用于诊断/显示；运行兼容性由 `protocol` + DSH 精确版本决定。
- 能力位（server 插件声明，client 必须容忍缺省）：
  ```ts
  interface ServerCapabilities {
    readonly workspaceApi: 1
    readonly sessionApi: 1
    readonly persistRpc: 1
    readonly executor: 1
    readonly eventsSse: 1
    readonly muxWs: 1
    readonly embed: { readonly storagePrefix: string; readonly mode: 'reload' | 'client-half' }
    readonly registryReload: 'process-restart' // v1 唯一值；见架构 §10
  }
  ```
- 缺插件：P1 `handshake` 得到官方 UI 的 404/HTML（非 JSON）→ client 归类 `plugin-missing`。
- 插件旧/新版本不匹配安装清单 → client 重装专用 profile 插件后重启 profile server（§3）。

---

## 3. profile server 生命周期与单 client 租约

### 3.1 启动命令（唯一权威文本）

在 SSH 目标机上，client host 用 sh 执行（LF、PATH 前缀顺序固定）：

```sh
DSH_HOME="<serverDshHome>" \
PATH="<runtimeRoot>/node/bin:<runtimeRoot>/dsh/node_modules/.bin:$PATH" \
exec "<runtimeDshLauncher>" --profile "graydovee-remote-window-<clientId>" \
  --host 127.0.0.1 --port 0 --no-open
```

- **CLI 顺序**：`--profile` 是 dsh 启动器参数，必须放在 app 参数前；**不是** `dsh web --profile`。
  实测 `dsh web --profile p` 报 `select a profile only once` / `too many arguments`。
- `runtimeDshLauncher` 是独立 runtime 的 `.../node_modules/.bin/dsh`（或复用全局 `dsh`）。
- `runtimeRoot`：独立 runtime `$DSH_HOME/remote-window/<clientId>/runtime`（固定）；全局运行时用 server
  现有 dsh（`PATH` 前缀可省）。
- 不以网络/包管理器安装 profile：专用 profile 由 client 离线写入 4 个文件 +
  `node_modules/dsh-remote-window-server/**`（见架构 §12），再启动。
- 进程形态：`setsid nohup ... > "$DSH_HOME/remote-window/profiles/<profile>/server.log" 2>&1 &`
  （日志目录 0700、文件 0600）；写 `.pid`。client host 只持有 profile 名/端口/pid 的内存态。

### 3.2 stdout 解析与就绪

profile server 启动后只打印一行（实测）：

```
dsh web: http://127.0.0.1:<port>/?token=<43位base64url>
```

正则（单行、锚定，禁止贪婪跨行）：

```
^dsh web: http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+)$
```

就绪判定：解析成功 + 15 s 内 `GET /` 带 token 得到 `303`（或带 cookie `200`）。超时 →
`profile-start-timeout`，保留 log 尾部（scrub 后）供诊断。

### 3.3 官方 cookie 获取

client host 经 P1 通道请求（不要在浏览器里做）：

```
GET /?token=<token>
→ 303 location: ./
→ Set-Cookie: dsh-auth-<authorityHash>=v1.<payload>...; Max-Age=2592000; Path=/; HttpOnly; SameSite=Strict
```

- 记下 `Set-Cookie` 的名字与值（内存），后续所有 P1/P2 上游请求注入 `Cookie: <name>=<value>`。
- `authority` = 请求 Host（`127.0.0.1:<profilePort>`）。每次 profile server 重启换端口 → 重新取 cookie。
- 这个 cookie 是**进程 token 换来的持久浏览器会话**；client host 每次启动 profile server 后重新获取，
  不落 client 磁盘。server 侧 `.credentials.yaml` 的签名 secret 仍由 DSH 自己持久化。
- 不把 token 或 cookie 交给浏览器；不把 Set-Cookie 转发给浏览器（§8）。

### 3.4 单 client 租约（profile lock）

落点：`<profileDir>/.dsh-rw/lease.json`（profileDir =
`$DSH_HOME/profiles/graydovee-remote-window-<clientId>`），由 **server 插件**写入（同一 profile server
进程是唯一写者；原子 rename；0600）。

```ts
interface ProfileLease {
  readonly version: 1
  readonly profile: string              // graydovee-remote-window-<clientId>
  readonly clientId: string
  readonly instanceId: string
  readonly pid: number                  // profile server 进程 pid
  readonly port: number                 // 本进程监听端口
  readonly startedAt: string            // ISO
  readonly heartbeatAt: string          // ISO，插件每 5s 更新
  readonly tokenFingerprint: string     // sha256(token) 前 16 hex；只用于诊断，不参与鉴权
}
```

规则：

| 情况 | 结果 |
|---|---|
| 无 lease | 写入，`handshake` 成功，`staleTakeover: false`。 |
| lease.clientId !== 请求 clientId | `409 profile-foreign-client`（每个 profile 只属于一个 client）。 |
| lease.clientId 相同、instanceId 相同 | 视为同一实例重试：刷新 heartbeat，成功。 |
| instanceId 不同且 heartbeat 新鲜（age ≤ 20 s） | `409 profile-in-use`，`details: { ownerInstanceId, ownerPid, startedAt }`。 |
| instanceId 不同且 heartbeat 过期（age > 20 s）或 pid 不存在 | 接管：覆盖 lease，`staleTakeover: true`；旧 profile server 进程由 client host 先 stop（§3.6）。 |

- 客户端崩溃后，最多 20 s 后下一个连接可接管；client host 侧另有 pid/端口存活检查。
- lease 只防“两个 client 同时驱动一个 profile”；**会话级单写者仍由官方 JSONL flock 裁决**（§11）。
- 租约心跳与 P1 的 `profile/heartbeat` 一致；heartbeat 失败 3 次 → client 显示 `lease-lost` 并要求重连。

### 3.5 handshake

`POST /dsh-remote-window-server/api/handshake`

请求：

```ts
interface HandshakeRequest {
  readonly protocol: 1
  readonly pluginVersion: string          // client 侧插件版本，诊断用
  readonly clientId: string
  readonly instanceId: string
  readonly profile: string                // 期望 profile 名；不符 → profile-mismatch
  readonly capabilities?: readonly string[] // 可选，client 支持的能力（前向兼容）
}
```

响应：

```ts
interface HandshakeResponse {
  readonly protocol: 1
  readonly pluginVersion: string
  readonly dshVersion: string             // 0.2.1-rc.3
  readonly profile: string
  readonly clientId: string
  readonly lease: { readonly instanceId: string; readonly expiresAt: string }
  readonly staleTakeover: boolean
  readonly registry: {
    readonly initialized: boolean
    readonly revision: string             // sha256(workspace.json) 或 'absent'
    readonly epoch: string                // 本进程 registry 载入代次（诊断）
  }
  readonly capabilities: ServerCapabilities
  readonly activeAgents: readonly ActiveAgent[] // 仅诊断/切换预检
}
```

错误码：`plugin-protocol-mismatch`、`plugin-version-mismatch`（可选，仅诊断）、`profile-mismatch`、
`profile-foreign-client`、`profile-in-use`、`bad-request`、`unauthorized`、`forbidden`。

`expiresAt` 是建议值（heartbeatAt + 20 s）；client 应在 5 s 周期内调用 `profile/heartbeat`。

### 3.6 停止 / 断开 / 崩溃清理

**正常断开**（用户点断开、client 关闭、切换执行端）：

1. client host 先 `POST /api/rpc { method: 'profile/cancel-all' }`：server 插件对每个 live agent 调
   官方 `sessionController.cancel({ sessionId })`，等待取消请求发出并 `sessionPersistence.flush()`；
   返回 `{ canceled: SessionId[] }`。失败不阻塞后续停止，但要记录（scrub）。
2. client host `SIGTERM` pid；等 ≤ 5 s；仍存活则 `SIGKILL`；确认端口关闭、pid 文件移除、lease 标记
   `releasedAt`（可选字段；缺失不影响）。
3. 关闭该 target 的所有 SSH `forwardOut` 通道；清 target 的展开态与 tunnel 句柄。
4. 不删除 profile/server 数据；不删除共享会话日志。

**崩溃**：client host 不保证发送 cancel；profile server 进程退出本身释放所有 flock；下次连接按 §3.4
接管 stale lease 并重新启动 profile server。server 日志中的半截 turn 由官方 JSONL 恢复语义处理。

### 3.7 第二 client 拒绝的 UI 语义

- `profile-in-use` → client 树里该连接显示“该 profile 正被另一个 client 实例使用”，提供“重试/
  使用我的 profile”说明；**不得**转向本地执行或另一个 profile。
- `profile-foreign-client` → 说明 clientId 冲突（典型：复制了凭据/存储域），提供“删除本机连接记录并
  重新生成 clientId”的显式动作（不自动删 server 数据）。

---

## 4. P1 RPC：client host → server 插件

### 4.1 路由

| 路由 | 方法 | 说明 |
|---|---|---|
| `/dsh-remote-window-server/api/handshake` | POST | 见 §3.5。 |
| `/dsh-remote-window-server/api/rpc` | POST | body `{ protocol:1, method, params }`；统一信封。 |
| `/dsh-remote-window-server/api/events` | GET (SSE) | `text/event-stream`；见 §6。 |
| `/dsh-remote-window-server/api/mux` | GET upgrade | 执行世界 WS；见 §7。 |
| `/dsh-remote-window-server/embed/bootstrap.js` | GET | embed 注入脚本（公开静态，无 secret）。 |
| `/dsh-remote-window-server/embed/embed.css` | GET | embed 隐藏样式（可内联进注入脚本）。 |

`api/rpc` 请求头（除 cookie 外）：

```
x-dsh-rw-client: <clientId>
x-dsh-rw-instance: <instanceId>
x-dsh-rw-protocol: 1
```

server 对每个 RPC 校验 lease（clientId+instanceId 与 lease 一致），否则 `403 lease-mismatch`。

### 4.2 方法总表

| method | params（关键字段） | result | 官方来源 |
|---|---|---|---|
| `profile/heartbeat` | `{}` | `{ expiresAt, registry:{revision,stale,epoch} }` | 插件 lease |
| `profile/release` | `{}` | `{}` | 插件 lease |
| `profile/status` | `{}` | `{ lease, registry, activeAgents[] }` | `ctx.agents` |
| `profile/cancel-all` | `{}` | `{ canceled: SessionId[] }` | `ctx.sessionController.cancel` |
| `workspace/list` | `{}` | `WorkspaceListValue`（§5.1） | `ctx.workspaceRegistry` |
| `workspace/create` | `{ path, title? }` | `WorkspaceRow` | `registry.create` |
| `workspace/rename` | `{ workspaceId, title }` | `WorkspaceRow` | `workspace.setTitle` |
| `workspace/delete` | `{ workspaceId, force? }` | `{ deleted: boolean }` | `registry.delete`（§5.1 非空语义） |
| `workspace/reorder` | `{ workspaceId, beforeWorkspaceId? }` | `{ order: WorkspaceId[] }` | `registry.insertBefore` |
| `session/list` | `{ workspaceId? }` | `SessionListValue`（§5.2） | `ctx.sessionController.list` + registry |
| `session/create` | `{ workspaceId?, cwd?, sessionId?, agentPreset?, executor }` | `{ sessionId, agentPreset?, executor }` | `sessionController.create` |
| `session/rename` | `{ sessionId, title }` | `{ title, seq }` | `sessionController.rename` |
| `session/fork` | `{ sessionId, atSeq?, increaseTitle? }` | `{ sessionId }` | `sessionController.fork` |
| `session/pin` | `{ sessionId, pinned }` | `{ pinned: SessionId[] }` | `registry.pinSession` / `unpinSession` |
| `session/archive` | `{ sessionId, archived, stopActivity? }` | `{ archived: SessionId[] }` | `registry.archiveSession` / `unarchiveSession` |
| `session/cancel` | `{ sessionId }` | `{ canceled: boolean }` | `sessionController.cancel` |
| `session/reorder` | `{ workspaceId, sessionId, beforeSessionId? }` | `{ order: SessionId[] }` | `workspace.insertSessionBefore` |
| `persist/list` | `{}` | `{ snapshots: PersistSnapshot[] }` | `ctx.sessionPersistence.list` |
| `persist/stat` | `{ sessionId }` | `PersistSnapshot \| null` | `sessionPersistence.stat` |
| `persist/create` | `{ header, inheritedEventCount? }` | `{ handleId, header }` | `sessionPersistence.create` |
| `persist/open` | `{ sessionId, access }` | `{ handleId, header, inheritedEventCount }` | `sessionPersistence.open` |
| `persist/read` | `{ handleId, offset?, length? }` | `{ events, eventState }` | `SessionHandle.read` |
| `persist/append` | `{ handleId, events }` | `{}` | `SessionHandle.append` |
| `persist/flush` | `{ handleId? }` | `{}` | `SessionHandle.flush` / service flush |
| `persist/close` | `{ handleId }` | `{}` | `SessionHandle.close` |
| `persist/locate` | `{ sessionId }` | `{ remoteCwd: string } \| null` | 插件（从持久化 header 读 cwd） |
| `executor/get` | `{ sessionId }` | `ExecutorRecord \| null` | 插件状态文件 |
| `executor/plan-switch` | `{ sessionId, to }` | `ExecutorSwitchPlan`（§5.4） | `ctx.agents` + 记录 |
| `executor/switch` | `{ sessionId, to, confirmOtherTurns? }` | `{ mode, restartRequired }` | 插件 + cancel |
| `executor/release` | `{ sessionId }` | `{}` | 插件状态文件 |
| `registry/status` | `{}` | `{ revision, loadedRevision, stale, epoch }` | 插件 |
| `registry/refresh` | `{}` | `{ revision, stale, serviceReplaced }` | 官方 workspace 行重载；实现/守卫见 §16.4 |

> 所有 workspace/session/executor 写方法在执行前都要走 §10 的 registry 写守卫（lease + revision）。
> 读方法先做 revision 检查；发现外部变更且无法在进程内 reload 时，返回 `registry-stale`（v1 语义：
> 由 client 提示“重新连接以刷新”，重连即重启 profile server）。

### 4.3 官方服务使用纪律（禁止自造）

- workspace 清单/标题/id/顺序/pin/archive：**只用官方 `ctx.workspaceRegistry`**；id 使用官方 uuid
  （`WorkspaceId`），不要再引入 `sha256(path)[0..16]`。
- 会话清单/标题/运行态/分页/取消/重命名/分叉：**只用官方 `ctx.sessionController` 的公开方法**
  （`list`/`create`/`rename`/`fork`/`cancel`/`inspect`/`page`/`follow`）。
- 会话日志读写：**只用官方 `ctx.sessionPersistence`**；单写者由官方 JSONL flock 保证。
- 目录浏览：server 模式走官方 UI 自己的 directory picker；client sidebar 的“添加工作区”走插件
  `workspace/create` + 一个**只读目录列举** RPC（P1 可加 `fs/list` 薄包装或复用官方
  `directoryPicker` service；实现不得自建远端路径协议）。v1 约定：client sidebar 添加工作区 = client
  host 调插件 `fs/list`（blocking 单页，不引入流）→ 选中目录 → `workspace/create`。
- 审批/权限/流式输出/取消：server 模式全部由嵌入的官方 UI 负责，插件不做映射；local 模式由 client
  官方 UI/agent loop 负责。

---

## 5. 数据契约

### 5.1 workspace

```ts
interface WorkspaceRow {
  readonly workspaceId: string          // 官方 uuid
  readonly path: string                 // 官方 canonical path（server 真实路径）
  readonly title: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly sessionIds: readonly string[] // 官方 header 过滤后的成员；顺序 = 官方手动序
}

interface WorkspaceListValue {
  readonly registry: { readonly revision: string; readonly epoch: string; readonly initialized: boolean }
  readonly workspaces: readonly WorkspaceRow[]   // 官方 display order
  readonly pinnedSessionIds: readonly string[]   // registry-global
  readonly archivedSessionIds: readonly string[] // registry-global
}
```

- 权威：server 进程内官方 registry，落盘 `$DSH_HOME/storages/workspace.json`（single layout）。
- `workspace/create`：`{ path, title? }`。路径必须是 server 绝对路径；官方 `create` 会 realpath；不存在/
  非目录 → `workspace-path-invalid`。重复路径返回既有 workspace（官方幂等）。
- `workspace/rename`：只改标题，不动目录/id/成员。
- `workspace/delete`：默认 `force` 省略/false 且 `sessionIds.length > 0` → `409 workspace-not-empty`，
  `details: { sessionCount, sessionIds? }`；`force: true` → 只删登记（`registry.delete`），**绝不删
  会话日志**。重新 `create` 同路径后成员会按 header cwd 恢复（官方语义）。
- `workspace/reorder`：`insertBefore(workspaceId, beforeWorkspaceId?)`；`beforeWorkspaceId` 省略 = 追加到末尾。
- 多个 client/全局 DSH 的跨进程一致性：见架构 §10（v1 = 重连一致 + last-write-wins；D19）。

### 5.2 session list / row

```ts
interface SessionRow {
  readonly sessionId: string
  readonly title?: string               // projections.values.title；缺失 = 未命名
  readonly executor: 'server' | 'local' // 从 ExecutorStore 记录读取；无记录默认 server
  readonly blank: boolean               // 官方 sessionListMetadata.blank
  readonly running: boolean             // live agent status === 'running'
  readonly agentAvailable: boolean      // 本 profile 进程有 live agent
  readonly cwd?: string                 // server 真实 cwd
  readonly updatedAt: number            // ms；官方 summary.updatedAt
  readonly parentSessionId?: string
  readonly origin?: 'subagent'
  readonly formatStatus?: 'current' | 'migration-required'
  readonly pinned: boolean
  readonly archived: boolean
  readonly workspaceId?: string         // 从 workspace.sessionIds 反查；无归属时缺省
}

interface SessionListValue {
  readonly registry: { readonly revision: string; readonly epoch: string }
  readonly sessions: readonly SessionRow[]  // workspace 成员序 = workspace.sessionIds 的官方序；
                                            // 全量列表按 updatedAt desc（与官方 list 一致）
}
```

- 来源：`ctx.sessionController.list({}, signal)` 的 `SessionSummary` + `projections.values.title`
  + `projections.values.sessionListMetadata` + registry 的 pin/archive/成员 + `ExecutorStore` 记录的
  `mode`（无记录时按 `server` 默认，兼容旧数据）。
- `blank` 的会话默认由 UI 过滤（不显示为普通行）；client 只在它正被打开时显示临时“新会话”行。
- 排序：工作区内 = 官方手动成员序（`insertSessionBefore`）；跨工作区/置顶视图由 UI 按官方 pin 顺序
  叠加；不得在 server 侧另存第二份顺序。
- **标题是 v1 硬要求（与本地工作区 1:1）**：`session/list` 的 `title` 必须尽量给出。来源优先级：
  1) live session 的 `ctx.sessionTitle.get(session)`；2) 官方 projection cache 的 `title`；
  3) **插件 JSONL title fold**（按 `stat.sizeBytes` 记忆化，从日志尾部回刷找最新 `session/title`，
  blank 用同一读取判断 `turn/start`）；4) 官方显示兜底（durable title → cwd basename → session id）。
  `title` 缺省只允许作为异常兜底，不允许成为常态。诊断字段 `titleSource` 见 §16.7。

### 5.3 视图状态

| 数据 | 权威 | 写入 | 读取 |
|---|---|---|---|
| pin（会话置顶） | 官方 registry global `pinnedSessionIds` | `session/pin` | `workspace/list` |
| archive（会话归档） | 官方 registry global `archivedSessionIds` | `session/archive`（`stopActivity` 语义同官方） | `workspace/list` |
| workspace 顺序 | 官方 `workspaceIds` | `workspace/reorder` | `workspace/list` |
| workspace 内会话顺序 | 官方 `workspace.sessionIds` | `session/reorder` | `session/list` |
| 归档过滤/展开态/搜索 | client 视图（localStorage） | client | client |
| 搜索 | **client 瞬时过滤，不落盘、不发 P1** | — | — |

- 禁止再用插件自己的 `pinnedSessions` / `archivedSessions` 存储；旧数据迁移后删除。
- `archive` 与 `pin` 互斥（官方语义）；`archive` 默认在 active session 上会被官方拒绝 →
  `session/archive-activity`（details 里列 activity kinds）；UI 提供“停止并归档”（`stopActivity: true`）。
- 删除会话：v1 **不实现**（官方无此能力），client UI 不出现该动作；契约记录为已知非目标。

### 5.4 executor：执行端与切换状态机

每个会话一个执行端记录，**存 server**（跨 client 共享）。落点：

```
$DSH_HOME/remote-window/state/executors/<encode(sessionId)>.json
```

```ts
type ExecutorMode = 'server' | 'local'

interface ExecutorRecord {
  readonly version: 1
  readonly sessionId: string
  readonly mode: ExecutorMode
  readonly updatedAt: string
  readonly owner?: {                    // 仅 local/切换中有关键意义
    readonly clientId: string
    readonly instanceId: string
    readonly heartbeatAt: string
  }
  readonly switchedBy?: 'user' | 'default' | 'handoff'
}

interface ActiveAgent {
  readonly sessionId: string
  readonly running: boolean
  readonly status: string               // 官方 agent.status
}

interface ExecutorSwitchPlan {
  readonly currentMode: ExecutorMode
  readonly to: ExecutorMode
  readonly restartRequired: boolean     // to==='local' 时为 true（见架构 §9）
  readonly activeTurns: readonly ActiveAgent[] // 该 profile 内所有 running agent（D20 列表）
  readonly requiresConfirmation: boolean // activeTurns 中有非目标会话 → true
  readonly targetTurnRunning: boolean
}
```

**初始值**：连接设置 `executor: 'server' | 'local'`（client 存储、per connection；默认 `server`，UI 必须
可见）。新会话创建时把连接设置写进会话记录（`switchedBy: 'default'`）。已有会话保留记录。

**server → local**

1. `executor/plan-switch { sessionId, to:'local' }`：
   - 该 profile 里 `ctx.agents.list()` 过滤 `status==='running'` → `activeTurns`。
   - 除目标会话外仍有 running → `requiresConfirmation: true`（D20）。
2. UI 二次确认（文案列出 activeTurns；用户取消 → 无副作用）。
3. `executor/switch { sessionId, to:'local', confirmOtherTurns:true }`：
   - 未确认且需要确认 → `409 executor-switch-confirm-required`，details `{ activeTurns }`。
   - server 插件对所有 active turn（目标 + 其他，D20 确认后）调用 `sessionController.cancel`；
     然后 **必须等待尾部落盘**：对每个被取消的 live agent `await agent.whenIdle()`（总超时 3 s），
     再 `await ctx.sessionPersistence.flush()`；超时/失败收集进 `details.flushFailures` 并按 §16.6
     的语义返回。只有落盘完成后才允许返回 `{ mode:'local', restartRequired:true }`。
   - **当前 turn 自动取消**（D2）；已产生内容保留在日志。
4. 若目标 session 的 agent 由插件 managed handle 持有（§16.1），优先 `handle.dispose()`（cancel+
   whenIdle+close，释放 flock），**不重启 profile server**；只有 unmanaged/无 handle 时才按 §6.3
   重启（此时该 profile 全部 turn 被取消，D20 确认强制）。
5. client 主区切到客户端 UI；local agent 通过 `persist/open(access:'write')` 打开同一 session
   （header cwd 仍是 server 路径；client 侧路由映射到 stub）；UI 显示执行端 + 凭据归属。
6. 失败：任一步失败 → 记录写回 `mode:'server'`（若尚未重启）或进入 `needs-refresh`；UI 显示可操作
   错误，不假装成功。

**local → server**

1. client 侧先取消当前 turn（client agent 的 cancel），`persist/flush` + `persist/close` 释放写者；
2. `executor/switch { sessionId, to:'server' }` → 写记录 `mode:'server'`，清 owner；
3. client 主区切到 iframe 官方 UI，导航到该 session；官方 UI 读取历史，下一轮由 server 执行；
4. 不需要重启 profile server（官方 UI 本来就活在同一 profile 进程）。

**占用表达**

- server 模式：由官方 JSONL flock 裁决；第二个写者收到官方 `session/writer-held`
  （`sessionController` 的 RemoteError，details `{sessionId}`）。UI 呈现为可操作错误
  （“该会话正被另一个实例使用；可刷新/重连，或等待对方结束”），**不做只读/接管**。
- local 模式：executor 记录 owner 控制；其他 client 调 `persist/open(write)` →
  `409 executor-held`（details `{ ownerClientId, heartbeatAt }`）。owner 心跳过期（> 20 s）才允许
  另一个 client 通过 `executor/plan-switch` 接管；接管同样要求 D20 确认。
- 两种模式都不允许两个写者同时写同一日志；任何降级都必须显式报错。

---

## 6. SSE 事件流（P1）

`GET /dsh-remote-window-server/api/events`

- 头：`content-type: text/event-stream`、`cache-control: no-store`、`x-accel-buffering: no`。
- 第一帧 `event: hello`：`{ protocol:1, profile, instance, registry:{revision,epoch,initialized}, capabilities }`。
- 变更帧：
  ```
  event: change
  data: { "kind":"workspace"|"session"|"executor", "reason":"local"|"external",
          "revision"?: string, "workspaceId"?: string, "sessionId"?: string }
  ```
- 保活：每 15 s 一行注释 `: ping`。
- 来源：
  - 本进程写操作成功 → `reason:'local'`；
  - 每 5 s `stat(workspace.json)`（只 stat/读 hash 缓存）发现 revision 变化 → `reason:'external'`
    （来自其他 profile/全局 DSH）；这一帧只表示“有外部变化”，**不自动 reload**（v1）；client 收到后
    把 sidebar 标为“需刷新”，用户刷新 → 重连/重启 profile server。
  - 官方 host 事件（`session/created|disposed|event`）→ `kind:'session'`（节流 250 ms）。
- client host 把每个 target 的事件转发为 P3 SSE `/dsh-remote-window/stream/state` 帧：
  `{ targetId, kind, revision?, workspaceId?, sessionId? }`。
- 断开：SSE 连接随 SSH 通道关闭；client host 重连后重新订阅。

---

## 7. 执行世界 mux（local 模式，WS）

### 7.1 端点

- 路由：`GET upgrade /dsh-remote-window-server/api/mux`（`ctx.webServer.registerUpgrade`，
  `ctx.connection.admit(req)` + lease 头校验）。
- 一个 target 一个 WS 连接（client host 每个 target 复用一个 mux；浏览器不直连）。
- 连接建立后 client 发送 `hello` JSON 帧（复用旧 `frame` 的 JSON frame 形状）：
  ```ts
  { kind: 'hello', protocol: 1, clientId, instanceId, capabilities: ['fs','subprocess','sandbox','terminal','process'] }
  ```
  server 回 `{ kind:'hello-ok', protocol:1, maxFrameBytes }`；版本不符 → close code 4001 + 文本原因。
- WS 消息 = 一个完整 mux frame（`src/frame/codec.ts` 的编码结果原样作为 binary message）；
  不再有 stdio 长度前缀、PSK、TLS listener、`node-script` hello。
- 端点集合与旧协议一致：`fs`、`subprocess`、`sandbox`、`terminal`、`process`；语义沿用旧
  `RemoteExecutionServer`（读/写/列目录、进程流、终端 resize/signal、sandbox confine）。
- 流控：沿用 `FrameMux` 的 CREDIT/DATA 窗口；WS 背压只作为额外门槛。
- 生命周期：WS 断开 → server 插件中止该连接上所有未完成流（等同旧 mux ABORT）；client 侧 `FrameMux`
  关闭并让 realm 进入失败态（fail-closed，**绝不本地回退**）。
- 文件 `src/frame/psk.ts` 退役（鉴权由 cookie+lease 完成）；`src/frame/codec.ts`、`src/frame/mux.ts`
  保留，继续两仓逐字节相同。

### 7.2 为什么不用官方 Gateway Remote

官方 `connection.rpc` / `/api` Gateway Remote 是“浏览器 ↔ 本进程”的 Typert RPC 面，面向已生成的
Remote 方法与 `$events`，鉴权是浏览器 cookie；本场景是 **client host ↔ server 插件** 的服务端通道，
还需要自有的执行世界流控（credit/backpressure）。v1 用插件自有 exact WS + 复用 frame/mux，少一层生成
代码和浏览器语义，也不用把 client host 伪装成浏览器 Peer。

---

## 8. portal：同源反向代理契约（client host）

### 8.1 路由与上游

| 下游（浏览器，client origin） | 上游（profile server） |
|---|---|
| `/dsh-remote-window/portal/<targetId>/` | `/` |
| `/dsh-remote-window/portal/<targetId>/<rest>?<query>` | `/<rest>?<query>`（只剥前缀，不重编码） |
| `/dsh-remote-window/portal/<targetId>/api/remote.mux`（WS） | `/api/remote.mux`（WS） |

- 只接受已连接 target；`targetId` 不存在/未连接 → `404 target-not-connected`（JSON 或空响应均可，
  不能返回另一个 target 的内容）。
- 下游先过 client 侧 `trustedRequest`；不通过 → `403`。
- 每个 target 的 portal 句柄与 SSH 通道绑定；断开即 404/410。

### 8.2 转发规则（逐条，全部实测过）

| 头/行为 | 规则 |
|---|---|
| `Host` | **改写为 `127.0.0.1:<profilePort>`**。绝不透传浏览器 Host（否则官方 cookie authority 变成 client origin，与 client GUI 自己的 `dsh-auth-*` 同名冲突）。 |
| `Origin` | **删除**（服务端 fence 只在存在 Origin 时要求同 authority；无 Origin 的服务端请求视为同源内部请求）。 |
| `Referer` | 改写为 `http://127.0.0.1:<profilePort><upstreamPath>` 或删除；不得透传 client origin。 |
| `Cookie` | 注入 §3.3 的官方 cookie；**丢弃浏览器发来的同名/其他 cookie**（避免把 client GUI cookie 带给 server）。 |
| `Set-Cookie` | **不转发给浏览器**（浏览器永远不持有 server cookie；避免同名污染）。 |
| `sec-fetch-site` | 原样转发可（浏览器同源 iframe 是 `same-origin`；server fence 只拒绝 `cross-site`）。 |
| `Accept-Encoding` | 原样；server 的 gzip 响应原样回传；不自行解压/重编码。 |
| 重定向 | `location` 只允许相对/上游 authority；若上游回 303 `./`（token 交换，正常不会发生在浏览器路径），client host 自己处理并补发干净请求。 |
| `Content-Length`/chunked | 原样；流式响应（SSE、下载）不缓冲整包。 |
| 请求体 | 流式转发，不限制到 1 MiB（官方 `/api` 自己限制 300 MiB；portal 不额外截断）；只对插件 API 限制 1 MiB。 |
| WS | 精确路径升级；client host 建 SSH `forwardOut` 后手工发 upgrade 请求（Host/Origin/Cookie 同上），双向 pipe；不缓存帧。 |

- **不要**加 `--public-url`、`--trusted-host`：profile server 只绑 loopback，Host 重写后 fence 走 loopback
  分支；`--port 0` + `--public-url` 还会让 stdout 只剩 public URL、丢失真实端口。
- 不设 `X-Frame-Options`/`CSP`：0.2.1-rc.2 官方 web 不发送二者（实测），同源 iframe 可渲染；
  若上游未来新增，portal 只对**官方 index/asset** 透传，不自行删除安全头；由架构升级复核。
- profile server 的 token 只在 §3.3 用一次；浏览器永不接触 token。

### 8.3 错误与超时

| 情况 | 行为 |
|---|---|
| SSH 通道不可用 | portal 立即 503 `tunnel-unavailable`；client 树显示连接断（不是空 iframe）。 |
| 上游连接超时（10 s） | 502 `upstream-timeout`；页面显示错误态并提供“重试/重连”。 |
| 上游 4xx/5xx | 原样状态码与 body（静态/官方 API 的诊断）；不包装成 200。 |
| WS 握手失败 | 传给浏览器失败响应；记录关闭码；main area 进入可重试错误态。 |
| profile server 死亡 | portal 返回 503；client host 标记 profile stopped，并按连接策略提示重连。 |

---

## 9. embed：官方 UI 嵌入与本地状态隔离

server 模式主区 = **同源 iframe**（`portal/<targetId>/`）。同源意味着 iframe 与 client GUI 共享
`localStorage`/`sessionStorage`/`document.cookie` 作用域，必须隔离，否则 `dsh.sessions.current`、
`dsh.workspace.view.v5`、主题等键会互相污染。

### 9.1 注入（server 插件负责，portal 不做 HTML 解析）

server 插件在 `apply()` 中注册：

```ts
ctx.webServer.tapIndex(html => // 在 <head> 后、所有 app bundle 之前插入
  html.replace('<head>', '<head>' + inlineConfig + `<script src="${BOOTSTRAP_PATH}"></script>`))
```

- `inlineConfig`：`<script>window.__DSH_RW_EMBED__ = {"protocol":1,"storagePrefix":"dshrw:<profile>:","injectedAt":...}</script>`。
  **不含 secret**。
- 顺序：inline config → `bootstrap.js`（同步、经典脚本，非 module/defer）→ 官方 app 脚本。
  这样 storage shim 在任何客户端 store 读 localStorage 之前安装。
- `bootstrap.js`/`embed.css` 是 server 插件的公开静态 exact 路由（无 cookie 要求；不含秘密）。
- CSP 兼容：v1 官方无 CSP；若未来有 `script-src 'self'`，同源路由仍合法。**不允许**用
  `unsafe-inline`（inline config 若被 CSP 拦，改为在 bootstrap.js 里读取注入的 `<meta>` 或 query，
  dev-server 需在升级复核时验证）。

### 9.2 storage shim（bootstrap.js 第一件事）

在 iframe realm 内、app 启动前 patch `Storage.prototype`（`localStorage` 与 `sessionStorage` 同规则）：

```
prefix = config.storagePrefix           // 例：dshrw:graydovee-remote-window-<clientId>:
getItem(k)      → raw.getItem(prefix + k)
setItem(k, v)   → raw.setItem(prefix + k, v)
removeItem(k)   → raw.removeItem(prefix + k)
clear()         → 只 remove 以 prefix 开头的键；其他键原样保留
key(i)          → 在所有以 prefix 开头的键中取第 i 个，返回去掉 prefix 的 key；越界返回 null
length          → 以 prefix 开头的键数量
```

- 用 `Object.defineProperty(Storage.prototype, 'length', { get })`；方法包装要保留原方法的
  `this` 语义（调用时用原始 Storage 实例）。
- 幂等（重复注入不二次前缀）；把原始方法保存在不可枚举 symbol 上供 bootstrap 内部使用。
- 覆盖不到 `document.cookie`：cookie 由 portal 控制，既不转发 Set-Cookie 也不要求浏览器持有；官方
  UI 的鉴权 cookie 由 client host 注入上游，浏览器侧的 `document.cookie` 不参与。
- 其他存储（IndexedDB）v1 不涉及；若发现官方 UI 使用，dev-core 记录并补 shim 方案（不静默泄漏）。

### 9.3 深链 / 导航 / 选中同步

**URL**（iframe 首次 src，由 client main area 构造）：

```
http://<clientOrigin>/dsh-remote-window/portal/<targetId>/?dshRwSession=<sessionId>&dshRwTheme=<light|dark|system>&dshRwLang=<zh-CN|en-US>
```

- `bootstrap.js` 在 app 启动前读取 query；若 `dshRwSession` 存在，则写
  `localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId }))`（经 shim，落到前缀键）→
  官方 `ui-workspace` 的 `restoreSelection` 在启动时自动打开该会话。**首次深链不需要 reload。**
- `dshRwTheme`/`dshRwLang`：best-effort（设置 `<html lang>`、把主题源写到官方已知键/属性；
  v1 只保证不明显冲突，不进入硬验收）。

**parent → iframe**（`postMessage`，`targetOrigin = clientOrigin`）：

```ts
{ v: 1, type: 'dsh-rw/open-session', sessionId }   // 切换会话
{ v: 1, type: 'dsh-rw/theme', theme, lang }       // 可选
{ v: 1, type: 'dsh-rw/reload' }                   // 诊断/恢复
```

- v1（无 server client half）：收到 `open-session` → shim 写前缀的 `dsh.sessions.current` →
  `location.reload()`。reload 后官方 UI 按保存的 selection 恢复；WS 重新建立，官方 journal 重新跟随
  正在进行的 attempt（流式输出恢复）。这是 v1 已知 UX 成本（每次切换会话一次 reload）。
- v1.1（可选 server client half）：`bootstrap.js` 检测到 `window.__DSH_RW_EMBED__.nav === 'client-half'`
  时由 client half 调 `ctx.get('uiWorkspace').openSession(sessionId)`，不 reload。消息形状不变。

**iframe → parent（选中同步，无私有 API）**

- iframe 内官方 store 每次写 `dsh.sessions.current`（经 shim）都会在**同源父页面**触发 `storage` 事件，
  `event.key` 为前缀键。parent 监听：
  ```ts
  window.addEventListener('storage', e => {
    if (e.key !== prefix + 'dsh.sessions.current' || e.storageArea !== localStorage) return
    // 只接受来自自己 target iframe 的 origin（同源，校验 e.url 的 portal 前缀）
    // value = JSON.parse(e.newValue)；取 { sessionId } 更新 client sidebar 选中
  })
  ```
- iframe 启动完成后发 `{ v:1, type:'dsh-rw/ready' }`（parent 校验 `event.source === iframe.contentWindow`、
  `event.origin === clientOrigin`）。
- parent 不接受来自其他 origin/其他 target iframe 的消息；子页面只处理 `event.origin === <配置的
  clientOrigin>`。配置的 parent origin 通过 query `dshRwParent` 传入并在 bootstrap 校验（缺省 = 同源）。

**隐藏官方 sidebar/topbar**（embed.css，bootstrap 先注入）：

```css
html[data-dsh-rw-embed] [data-slot="sidebar"],
html[data-dsh-rw-embed] [data-slot="sidebar"] * { display: none !important; }
html[data-dsh-rw-embed] [data-slot="rightbar"],
html[data-dsh-rw-embed] [data-slot="rightbar"] * { display: none !important; }
html[data-dsh-rw-embed] [data-slot="shell.bottom"] { display: none !important; }
/* 主区占满：隐藏 frame 的左/右 grid track（选择器以 0.2.1-rc.2 DOM 为准，dev-ui 校准） */
html[data-dsh-rw-embed] [data-slot="root"] > div > div {
  grid-template-columns: minmax(0, 1fr) !important;
}
```

- v1 主区只保留 `main`/`conversation`/`shell.overlay`（对话框/审批浮层可用）。
- 隐藏值、点击、拖拽的官方 sidebar 交互不可用；client sidebar 是唯一导航。
- 选择器若随 DSH 升级失效：QA 检查 `[data-slot="sidebar"]` 是否仍隐藏；失效 → **失败而不是双导航**。
- 也保留 `data-dsh-rw-embed` 属性供调试/测试断言。

### 9.4 同源隔离验收（I3/E3）

- client GUI 的 `localStorage` 原有键（至少 `dsh.sessions.current`、`dsh.workspace.view.v5`）在 iframe
  打开/切换会话后**值不变**；iframe 自己读到的同名键是前缀键。
- client GUI 的 `document.cookie` 不出现 profile server 的 `dsh-auth-*`。
- iframe 内 `Storage.clear()` 不清 client GUI 的本地键。
- 断开 target 后 iframe 移除；client GUI 选中态恢复/清空符合 §9.5。
- parent/child 消息只被对应 target 处理（两个 target 同时连接时交叉测试）。

### 9.5 断开 / 删除 / 模式切换时的主区清理（I3）

client 只在 **local 模式**用客户端官方 UI 显示远程会话，因此需要处理官方 selection：

1. 判定当前官方 selection（私有 `uiWorkspace.selection.getSnapshot()?.sessionId`，或公开 fallback
   `sessions.list` 的 `retainedBy.mainView`）是否属于本 target（插件的 revealed 表/workspace refs）。
2. 属于本 target → 优先调用**受运行时守卫的**私有 `uiWorkspace.clearMain()`（类型检测存在才调用，
   try/catch）；这是官方归档时自己走的路径（释放 mainView、清持久 selection、裁 rightbar view）。
3. 守卫不存在/抛错 → 公开 fallback：`ctx.layout.selectPanel(null)`；若持久 selection 仍指向本 target
   的远程会话，**只在这种情况下**把客户端自己的 `localStorage['dsh.sessions.current']` 清为 `{}`
   （不得动本地会话的 selection），并显示“重新加载界面以完成清理”按钮（用户确认后 `location.reload()`）。
4. server 模式（iframe）不需要官方 selection 清理；移除 iframe + iframe 内状态随文档销毁。
5. 验收路径：断开、删除连接、切换执行端、重连；四条路径都不得白屏/残留主区。

---

## 10. registry 写守卫（v1 的跨进程安全边界）

> 背景：官方 `storage-json` single layout 的 workspace domain 是“内存权威 + 整文件 atomic 覆盖”，
> 没有跨进程 reload/锁/通知（源码证据见架构 §3.5）。v1 不做 coordinator；用“**写前 revision 守卫 +
> 显式刷新（loader 重载；失败 fallback 重启 profile）**”把可控路径的 silent clobber 变成可操作错误。
> D19 已裁决：跨进程实时同步不属于 v1 验收。
>
> **本节由 §16.3/§16.4 补充并部分替换**：写守卫覆盖官方 UI 写（prototype 包装）；“刷新”不再是
> 重启 profile 的同义词，而是 `state/refresh`（轻量）→ `registry/refresh`（loader 重载）→
> `profile/restart`（D20 确认后的最后手段）。冲突处以 §16 为准。

路径：

```
workspaceFile   = $DSH_HOME/storages/workspace.json
registryLock    = $DSH_HOME/remote-window/locks/registry.lock
bootstrapLock   = $DSH_HOME/remote-window/locks/bootstrap.lock
```

- `revision`：`sha256(file bytes)`（文件不存在 = `absent`）；在 server 插件进程启动载入后记
  `loadedRevision`。
- **所有 workspace/session-order/view 写（含 profile 官方 UI 的写；见 §16.4 prototype 包装）**：
  1. 取 `registry.lock`（`withFileLock` 语义：单调超时 + stale 清理；锁内容 `{pid, instanceId, at}`）；
  2. 读当前文件 revision；若 ≠ `loadedRevision` → 释放锁，返回
     `409 registry-stale`，`details: { loadedRevision, currentRevision }`；
  3. 通过官方 `workspaceRegistry` 方法写（同一进程内存是最新载入的）；成功后重算 revision 更新
     `loadedRevision`；
  4. 释放锁。
- **读**（`workspace/list`、`session/list` 的成员/顺序）：先 stat revision；若变化 → 仍返回当前
  `loadedRevision` 的数据并带 `registry.stale: true`（**不假装最新**）；UI 显示“server 数据有更新”，
  并提供 §16.3 的 `registry/refresh`。`registry/refresh` = 官方 workspace 行 disable→enable 重载
  （0.2.1-rc.2 实测 serviceReplaced=true，重复 5 次不崩）；它是 loader 内部接缝，必须带 §16.4 的版本
  守卫与失败 fallback（`profile/restart`，D20 确认）。不做静默重载。
- **不变量**：插件绝不基于“比文件更旧的内存快照”写 workspace；stale 时写请求必须失败而不是 last-write-
  wins。官方 UI 的写由 §16.4 的 prototype 包装覆盖；若包装不可用（能力 `registryWriteGuard:'none'`），
  文档降级为“v1 不保证并发写”，QA 不按并发写判失败。全局 DSH（未装插件）的写不经过守卫（D19）。
- **首次 bootstrap**：client host 在启动 profile server（首次或 profile 缺失）前取 `bootstrap.lock`；
  handshake 返回 `registry.initialized === true` 后释放。第二个 client 等锁（≤30 s，超时
  `bootstrap-timeout`），保证空 `~/.dsh` 只产生一个 default workspace。
- **刷新语义（最终）**：
  1. 默认“刷新” = `state/refresh`（轻量重读，不杀 turn），见 §16.3；
  2. 用户点“加载 server 端工作区变更” = `registry/refresh`（loader 重载，不杀 turn），失败才提示
     `profile/restart`；
  3. `profile/restart` = 最后手段：必须 `profile/restart-preview` + D20 二次确认 + cancel/whenIdle/
     flush（§16.6），禁止静默。v1 的 C3/H2 按“刷新/重连后一致”验收，不按实时推送。

---

## 11. 会话占用（官方 writer 语义）

- 官方 JSONL 每个 session 目录有 `session.lock`（POSIX flock / Windows kernel semaphore），由
  `sessionPersistence.open(id,'write')` 或 `create` 持有；进程退出即释放。第二个写者得到
  `SessionAlreadyOwnedError`，官方 session controller 折成 RemoteError `session/writer-held`
  （details `{ sessionId }`）。**不自造锁、不做超时抢占。**
- 打开历史（`session/page`/`follow`、`inspect`、`persist/open('read')`）不取写锁，所以第二个实例可以
  只读查看；一旦发消息/改名/分叉/改队列 → `session/writer-held`，UI 显示可操作错误。
- v1 UI 选择：**报错**（不做只读模式、不做确认接管）。错误文案至少包含：哪个会话被占用、建议
  “刷新/重连”或“等待另一个实例结束”；不得提示“切换执行端”来绕过占用（切换也需要先释放）。
- local 模式同一 session 的写者由 executor owner + 官方 flock 双重约束；`persist/open(write)` 遇到
  executor 记录不属于本实例 → `executor-held`；遇到官方 flock → `session/writer-held`。

---

## 12. 错误码总表

`status` 为 HTTP 状态（SSE `error` 帧用同一 code；WS 用 close code 4001/4002/4003）。

| code | status | 出现位置 | 客户端行为 |
|---|---|---|---|
| `bad-request` | 400 | 所有 JSON 路由 | 错误横幅（含字段名） |
| `unauthorized` | 401 | P1 无 cookie/过期 | 重新取 cookie；失败则 `profile-start-failed` |
| `forbidden` | 403 | 信任栅栏 / `admit` 拒绝 | 错误横幅 |
| `lease-mismatch` | 403 | P1 lease 头与当前 lease 不符 | 重新 handshake |
| `plugin-missing` | 404（归类） | P1 handshake 得到非 JSON/404 | 自动安装/重装专用 profile 插件后重启 |
| `plugin-protocol-mismatch` | 409 | handshake | 显示两端 protocol；重装/升级插件；**不降级** |
| `plugin-version-mismatch` | 409 | handshake（仅诊断） | 提示升级（不阻塞 protocol 相等的情况） |
| `profile-mismatch` | 409 | handshake 的 profile 与目标不符 | 重新部署 profile |
| `profile-foreign-client` | 409 | handshake | 说明 clientId 冲突；提供删除本机记录/重生成 clientId |
| `profile-in-use` | 409 | handshake | 显示占用实例 + “重试”；不并发驱动 |
| `profile-start-timeout` / `profile-start-failed` | 500（P3） | client host 启动 | 显示 log 尾部（scrub）+ 重试 |
| `bootstrap-timeout` | 500（P3） | 首次启动锁 | 重试/检查 server `~/.dsh` 权限 |
| `registry-stale` | 409 | workspace/session 写 | 提示“server 工作区已被其他实例修改”，提供刷新/重连（重启 profile server） |
| `registry-unavailable` | 500 | registry 打不开 | 错误横幅 + 重试 |
| `workspace-path-invalid` | 400 | workspace/create | 说明路径不存在/不是目录 |
| `workspace-unknown` | 404 | workspace/rename/delete/reorder | 刷新列表后重试 |
| `workspace-not-empty` | 409 | workspace/delete | 二次确认；文案写明“只删登记，会话日志保留” |
| `session-not-found` | 404 | session 操作/persist | 刷新列表 |
| `session/writer-held` | 409 | rename/prompt/resume/fork | 显示占用说明；不提供只读/接管 |
| `session/agent-busy` | 409 | session 操作 | 显示原因（来自官方 details） |
| `session/archive-activity` | 409 | session/archive | 显示 activity 列表 + “停止并归档” |
| `session/archived-pin` | 409 | session/pin | 官方 archived-pin 冲突：先取消归档再置顶；不静默取消归档 |
| `executor-held` | 409 | persist/open(write) / executor/switch | 显示 owner 与心跳；owner 过期后可接管 |
| `executor-switch-confirm-required` | 409 | executor/switch | 展示 `activeTurns` 列表并要求二次确认（D20） |
| `executor-switch-busy` | 409 | executor/switch | 有切换进行中；禁止并发切换 |
| `handle-not-found` | 410 | persist/read/append/flush/close | client 重新 `persist/open` 一次（自愈一次） |
| `persist-read-only` | 400 | persist/append | 客户端 bug；不重试 |
| `persist-create-exists` | 409 | persist/create | 已存在同名会话；按官方语义处理 |
| `fs-error` | 500 | fs/list 或 mux | 显示可操作路径错误 |
| `tunnel-unavailable` | 503 | portal / P1 | 连接断开态；不显示空数据 |
| `upstream-timeout` | 502 | portal | 重试/重连 |
| `target-not-connected` | 404 | portal | 连接树显示未连接 |
| `timeout` | 504 | P1 | 可重试（幂等方法） |
| `internal` | 500 | 兜底 | 错误横幅 + 诊断 id |

> 所有错误 message 必须 scrub；`details` 不得包含 token/cookie/密码/私钥/模型 key。

> **已知偏离（v1）**：`persist/open` 在官方 snapshot 无 `eventCount` 时允许一次日志解码以取得精确
> cursor（> 8 MiB 告警、> 128 MiB 拒绝），`persist/read` 仍分页；详见 §16.7。

---

## 13. 版本、兼容与两仓共享文件

- `REMOTE_WORKSPACE_PLUGIN_PROTOCOL = 1`；`profile server` 与 client 必须精确同版本协议。
- DSH 精确 `0.2.1-rc.3`；插件 `engine.dsh` 与 `@deepseek-ai/dsh-*` peer 精确钉该版本。
- 旧协议（`REMOTE_SESSION_PROTOCOL=3`、`reg.*`、`persist.*` over stdio、`frame/psk`）随旧 server
  bundle 删除；server 仓库不再发布“远端 bundle”，而是发布可安装到 profile 的 Cordis 插件包。
- **两仓逐字节相同文件（v1 新集合）**：
  ```
  src/protocol.ts        # 本文件对应的 wire 类型/常量/方法名
  src/frame/codec.ts
  src/frame/mux.ts
  ```
  旧集合中的 `src/server/*`、`src/frame/psk.ts` 退役；`src/provision/package-build.ts` 不再逐字节同步
  （runtime 构建归 client；server 插件归 server 仓库）。
- 任一处改动 → 两仓同一次变更、构建、测试、`cmp` 复核，并更新 status/README/AGENTS 与本文档。

---

## 14. 文件/所有权映射（开发可直接认领）

| 文件/目录 | 归属 | 说明 |
|---|---|---|
| `src/protocol.ts` | 共享（两仓逐字节） | v1 wire 类型、方法名、常量、embed/portal 常量 |
| `src/frame/codec.ts`、`src/frame/mux.ts` | 共享（两仓逐字节） | 执行世界分帧；WS 消息 = 一帧 |
| `src/frame/psk.ts` | 删除 | PSK/TLS listener 退役 |
| `src/server/**` | 删除 | 旧 server bundle；由 server 仓库插件替代 |
| `src/portal/**` | dev-core | HTTP prefix + WS exact 代理、Host/Origin/cookie 规则、错误/超时/重试 |
| `src/provision/profile-lifecycle.ts` | dev-core | 启动/停止/日志/token/pid/lease 客户端侧、stale 清理 |
| `src/remote/plugin-client.ts` | dev-core | P1 RPC/SSE/mux 客户端（含 cookie、lease 头、错误映射） |
| `src/ssh/forward.ts` | dev-core | ssh2 `forwardOut` 通道/agent（含 WSL 删除后的唯一传输） |
| `src/runtime/**`（或复用 `provision/assets.ts`） | dev-core | 独立 runtime artifact 缓存/上传/下载校验/安装 |
| `src/provision/profile.ts` | dev-core | 专用 profile 的 4 文件 + `node_modules/dsh-remote-window-server` 离线写入 |
| `src/session-persistence/routing.ts`、`src/rsession/remote-persistence.ts` | dev-session | 路由到 P1 `persist/*`；header 重锚（stub↔server path） |
| `src/preset/world.ts`、`src/connection/index.ts`、`src/session/open.ts` | dev-session | local 模式执行世界：改用 WS mux；fail-closed 守卫 |
| `src/client/portal-main.tsx`（新） | dev-ui | server 模式 iframe 容器、postMessage、storage 事件选中同步、错误/加载态 |
| `src/client/executor.ts`（新） | dev-ui | 执行端设置、切换预检/二次确认、占用错误呈现 |
| `src/client/tree.tsx`、`api.ts`、`store.ts`、`session-verbs.ts` | dev-ui | 远程段数据/动作改为 P1；pin/archive/order 走官方；搜索本地 |
| `src/client/wizard.tsx`、`directory-picker.tsx` | dev-ui | 连接/部署步骤改为 runtime/profile 生命周期；server 目录浏览 |
| `src/client/vendor/workspace-rows/**` | dev-ui | 继续 vendor 0.2.1-rc.2 行；拖拽 wrapper 不改进 vendor 内部 |
| `src/server-plugin/**`（server 仓库） | dev-server | Cordis 插件：路由/SSE/mux/embed、registry 守卫、executor 状态、profile lease |
| `src/server-plugin/embed/**`（server 仓库） | dev-server | bootstrap.js（storage shim/CSS/postMessage）、embed 静态路由 |
| `src/server-plugin/workspace-api.ts` / `session-api.ts` / `persist-api.ts` / `executor.ts` | dev-server | 官方 service 包装与状态机 |
| `src/server-plugin/registry-guard.ts` | dev-server | revision/锁/bootstrap/写守卫 |
| `src/server-plugin/mux.ts` | dev-server | WS upgrade + 复用 frame/mux + 旧执行端点 |

---

## 14bis. server 插件包交付与校验（v1）

| 项 | 契约 |
|---|---|
| 包名/版本 | `dsh-remote-window-server`，version **精确等于** client 插件发布版本；`engines.dsh`/peers 精确 `0.2.1-rc.3`。 |
| 主来源 | client npm 包内置 `assets/server-plugin/dsh-remote-window-server-<version>.tgz`；专用 profile 离线解包，不访问 server 网络/pnpm。 |
| 内容清单 | `package.json`、`lib/**`（host；可选 client half）、`cordis.patch.yml`、README/LICENSE（可选）；无 `node_modules`。 |
| 兜底来源 | npm registry / release 下载同名同版本 tarball；用 client 包内 `assets/server-plugin/checksums.json` 的 sha256 校验；仅当内置缺失时使用。 |
| 校验 | sha256 必须匹配；版本必须精确匹配；拒绝路径穿越/额外顶层文件；失败码 `server-plugin-integrity-failed` / `server-plugin-version-mismatch`。 |
| 安装 | staging 解包（strip `package/`）→ 原子 rename 到 `<profileDir>/node_modules/dsh-remote-window-server/` → 写 profile 4 文件 → marker `{version,sha256,protocol,dshVersion}` → 重启 profile server。 |
| 幂等/升级 | marker 版本+sha 匹配则跳过；不匹配（升级/降级/损坏）重装并重启专用 profile；其他 profile/全局必须按钮确认。 |
| 握手校验 | server 插件返回 `pluginVersion`；与 client 期望不一致 → `plugin-version-mismatch`（重装/升级）；protocol 不一致 → `plugin-protocol-mismatch`（禁止降级）。 |
| 失败回滚 | 安装后 handshake 失败 → 用内置 tarball 重装一次；仍失败 → `server-plugin-install-failed`，保留 scrub 后的 log，不回退本地执行。 |
| 发布 | 两仓同版本；server 仓库出 tarball+sha256+manifest；client 构建把 tarball 复制到 `assets/server-plugin/` 并生成 checksums；`pnpm build`/`pnpm pack` 校验；runtime 包（node+dsh）仍独立发布，勿混。 |

错误码补充：`server-plugin-missing`（404/归类）、`server-plugin-version-mismatch`（409）、
`server-plugin-integrity-failed`（500）、`server-plugin-install-failed`（500）。

---

## 15. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-22 | 初版：v1 协议/状态机/错误码/portal/embed/registry 守卫；采纳 D19（只要求嵌入 profile 官方 UI 实时）、D20（切换前其他 active turn 二次确认）、dev-core portal 实测（Host 重写、无 public-url）、dev-server registry 单进程证据、agent handle 重启方案、clearMain 守卫。 |

---

## 16. 补充裁决（2026-10-22，优先于前文冲突处）

> 本节关闭 dev-session 9 条 gap、dev-ui D20/深链/刷新契约、Lead 的 registry 包装与标题要求。
> 方法名/错误码在此冻结；改名前必须通知 dev-* 并更新本节。

### 16.1 managed agent（server 模式占用，A+）

- 插件在 profile server 内维护 `Map<SessionId, AgentHandle>`。`session/prepare-server`（新增 P1 方法）
  保证“官方 UI 打开该会话时不会自行 resume”：
  ```ts
  // P1
  session/prepare-server { sessionId } →
    { managed: true, agentPreset?: string }                       // 插件已 resume 并持 handle
  | { managed: false, fallback: 'restart', reason: string }       // 已被官方先开/无法接管
  ```
- 实现：若 `ctx.agents.get(sessionId)` 已存在且不在插件表中 → `managed:false`（unmanaged，切换只能
  重启兜底）；否则复刻官方公开组合（`agentPresets.resolve` + `mount` + `installModelSelection`）后
  `ctx.agents.resume({ resumeSessionId, agentOptions, setup })`，保存 handle。组合失败 →
  `agent-compose-failed`（不展示 iframe）。
- 官方 UI 随后 `session/follow` promote 时发现 live agent → 复用（不再 resume），flock 由插件持有。
- server→local：对目标 `await handle.dispose()`（包含 cancel + whenIdle + close），从表中删除；
  **不需要重启 profile**。其他 session 的 managed handle 不动（D20 的其它 active turn 按 preview
  确认后 cancel，但仍由各自 handle 持有；是否一并 dispose 由 `executor/switch` 的
  `disposeOtherHandles` 选项决定，默认 false）。
- unmanaged 检测：插件订阅 `agent/created`；若某 session 的 live agent 不在表中 → 标记
  `unmanaged`，`executor/switch` 返回 `restartRequired:true`，走 §6.3 重启（D20 确认）。
- 断开/删除：插件 `profile/shutdown` dispose 全部 handle（或进程退出）；unmanaged 随进程退出。

### 16.2 server 模式新建会话 / 草稿深链（最终选择 a）

- **选择 a**：client 先 P1 创建/复用 blank 会话，再以 `dshRwSession` 深链 iframe。
  1. `session/create { workspaceId, executor:'server', blank:true }`：
     - 官方 `sessionController.create({ workspaceId, sessionId? })`（官方 blank 复用语义）；
     - 写 executor 记录 `{ mode:'server', switchedBy:'default' }`；
     - 返回 `{ sessionId, agentPreset? }`。
  2. `session/prepare-server { sessionId }`（managed handle）。
  3. client 主区 iframe `?dshRwSession=<sessionId>`；bootstrap 预写前缀 `dsh.sessions.current`
     `{sessionId}`；官方 `restoreSelection` 对 blank+workspace 成员走 `restoreBlank` → 官方
     `session/create` 复用同一 live agent → 显示草稿页。**dev-ui/QA 必须实测“blank 恢复为草稿页而不是
     正式会话”**；若失败，本路径退回 b（见下）并记录。
- `dshRwWorkspace=<workspaceId>`（方案 b）保留为 **fallback**：bootstrap 不写 selection，官方 UI 自行
  选最近 workspace/创建 blank；缺点是 agent 不受插件管理，切 local 必须重启（§16.1 unmanaged）。
- sidebar “新会话”临时行：仅当该 workspace 的 blank 会话正被打开且 `blank===true` 时显示；切走即消失；
  blank 不出现在普通列表。点击 workspace 行的“新会话”与“新建会话”走同一条 a 路径。
- 失败：任一步失败显示可操作错误（`session-create-failed` / `agent-compose-failed`），不打开空白
  iframe、不显示 success toast。

### 16.3 刷新 / 重连（P3）

| 端点 | 请求 | 响应/行为 |
|---|---|---|
| `POST /dsh-remote-window/api/state/refresh` | `{ targetId }` | 轻量刷新：client host 重拉 P1 `workspace/list`/`session/list`（含 title fold）；返回 `{ targets?, stale: boolean, registry:{revision,loadedRevision} }`。**不取消 turn、不重启进程。** |
| `POST /dsh-remote-window/api/registry/refresh` | `{ targetId }` | 调 P1 `registry/refresh`（官方 workspace 行 disable→enable 重载，§16.4）。成功 `{ revision, serviceReplaced:true }`；失败 `registry-reload-failed`。**不取消 turn。** |
| `POST /dsh-remote-window/api/profile/restart-preview` | `{ targetId }` | `{ activeTurns: ActiveTurn[], requiresConfirmation, previewRevision }`；取不到清单 → `profile-restart-preview-failed`（禁止执行）。 |
| `POST /dsh-remote-window/api/profile/restart` | `{ targetId, confirmActiveTurns:true, previewRevision }` | 校验收据；cancel + whenIdle/flush（≤3 s）→ stop/start → handshake → `{ restarted, cancelledTurnIds, failedCancellations[] }`；有失败 → `mode-switch/cancel-failed`（保留 details）。SSE 进度事件。 |
| `POST /dsh-remote-window/api/state`（现有） | — | 保持：返回树数据/配置；不承担重载语义。 |

- UI 规则：`state/refresh` 是默认“刷新”；发现 `stale` 时显示 banner：“server 端工作区有更新，
  点此加载”（→ `registry/refresh`）；`registry/refresh` 失败 → 显示“重启 profile 以加载（会取消运行中
  turn）”并走 `profile/restart-preview` + D20 确认。
- **禁止**把“刷新”做成静默重启；没有 preview 清单不得 restart（`profile-restart-preview-failed`）。
- `profile-in-use`/`profile-locked`：profile 已被另一 client 实例占用 → 拒绝写操作并提示。

### 16.4 registry 写守卫覆盖（含官方 UI）

- 能力位：`registryWriteGuard: 'prototype' | 'none'`，`registryReload: 'loader-disable-enable' | 'none'`。
- `prototype`：server 插件在 apply 里包装官方实例 prototype 的写方法（registry 与 workspace entity，
  见架构 §4.1）。每次写：取 `registry.lock` → 比 revision → stale 则抛 `registry-stale`（不写）→
  原方法 → 更新 revision → 释放。覆盖官方 UI 与 P1；官方 UI 的错误以其 toast/error 呈现。
- `none`：无法包装（版本/冻结）→ 文档降级“v1 不保证并发写”，QA 不按并发写判失败；仍可跑其他验收。
- `registry/refresh` 实现：`[...ctx.loader.entries()].find(e => e.options.name === '@deepseek-ai/dsh-workspace')`
  → `await entry.update({disabled:true}); await entry.update({disabled:false})`。要求：
  entry 唯一存在、`entry.options.id` 以 `include:` 前缀（0.2.1-rc.2 实测 `include:workspace`）；
  操作在插件串行锁内（不与写/其它 refresh 并发）；失败 → `registry-reload-failed`，client 提示改用
  `profile/restart`。**注意**：`entry.update({}, false, true)` 不会重启（实测无效），禁止使用。
- 版本守卫：DSH 版本不在 `DSH_VERIFIED_RUNTIMES` 或 entry 形状不符 → 关闭 reload/guard 能力并在
  handshake 里显式声明；升级 DSH 必须重跑本 spike（官方 UI feed/agent/监听无泄漏）。

### 16.5 executor：assign / 模式冲突 / owner

新增/修正 P1：

```ts
executor/assign {
  sessionId,
  mode: 'server' | 'local',
  owner?: { clientId, instanceId },     // local 必填；server 可省
  switchedBy?: 'user' | 'default' | 'handoff'
} → ExecutorRecord

session/create { ..., executor?: 'server'|'local' }     // 创建时写记录
persist/create { header, remoteCwd, executor:'local' }  // 创建前 upsert 记录（owner=lease）
```

`persist/open(access:'write')` 守卫（读打开不校验）：

| 现有记录 | 结果 |
|---|---|
| `mode:'local'` 且 owner=调用者 lease | 允许 |
| `mode:'local'` 且 owner 心跳新鲜（≤20 s）且不同实例 | `409 executor-held`，details `{ownerClientId, heartbeatAt}` |
| `mode:'local'` 且 owner 心跳过期 | `409 executor-held`（需先 `executor/assign` 接管，接管要走 D20 preview） |
| `mode:'server'` | `409 executor-mode-conflict`，details `{mode:'server'}`（必须先显式切换） |
| 缺失 | 若本进程无该 session 的 live server agent → 插件 upsert `{mode:'local', owner:<lease>, switchedBy:'handoff'}` 后允许；有 live server agent → `409 executor-mode-conflict`（details `{mode:'server', liveAgent:true}`） |

### 16.6 切换/重启的尾部落盘（不可省）

- cancel 只表示“请求已发出”，**不代表 turn 已收尾**。任何停进程/释放 handle 之前：

```ts
for (const agent of affectedAgents) await agent.whenIdle()   // 总预算 3 s
await ctx.sessionPersistence.flush()                        // 官方 durability barrier
```

- 超时/失败：返回/抛出 `shutdown-flush-timeout`（details `{sessions, waitedMs, failures[]}`）；
  client **不得**继续静默 SIGTERM，必须显示“有 N 个 turn 未完成收尾，继续重启可能丢失尾部输出”，
  用户再次确认后才继续；已知丢失内容由官方中断恢复补齐（interruptedTurnClosers），但 QA G3 需要
  真实等待 flush 的正常路径。
- managed handle `dispose()` 自身包含 cancel→whenIdle→close；插件在 dispose 前后仍执行一次
  `sessionPersistence.flush()` 作为兜底。

### 16.7 persist 契约修正

```ts
persist/create {
  header,                    // client 侧 header.cwd = anchor/stub
  remoteCwd: string,         // 必填：server 真实路径；必须等于某个官方 workspace path（realpath）
  inheritedEventCount?,
  executor?: 'local'
} → { handleId, header, nextSeq }        // 返回的 header.cwd = remoteCwd（server 视角）

persist/open { sessionId, access } → { handleId, header, inheritedEventCount, eventCount }
persist/read { handleId, offset?, length? } →
  { events, eventState, nextOffset }     // offset 默认 0；length 省略 = 读到尾部；分页
persist/locate { sessionId } → { remoteCwd, workspaceId? } | null
```

- 插件校验 `remoteCwd` 是否等于官方 workspace 的 canonical path（`workspaceRegistry.list()`）；
  不等于 → `400 workspace-path-invalid`（details `{remoteCwd}`）。header 里其他字段原样交官方；
  client 收到返回 header 后在自身 routing 层把 cwd 重锚为 stub（协议不携带 stub→remote 的隐式映射，
  一切显式）。
- `persist/create` 的 header 若与官方已有 session id 冲突 → `persist-create-exists`（details
  `{sessionId}`）；客户端按官方语义处理（复用/换 id），不得覆盖。
- `handle-not-found` 自愈：仅 `read`/`append`/`flush`/`close` 返回 410；客户端重新 `persist/open`
  **一次**，用返回的 `eventCount` 作为续写 cursor；重复批由官方 contiguity 拒绝（`bad-request`），
  客户端保留未确认批不丢。第二次仍 410 → 失败上抛。
- `persist/read` 的事件是官方当前格式 `SessionEvent`；`eventState` 原样转发；大日志必须按需分页，
  不得在 open 时全量读（唯一例外见下方 v1 已知偏离：只为取 cursor 的一次解码，不返回给客户端）。

- **v1 已知偏离（2026-10-22 Lead 裁决）**：官方 0.2.1-rc.2 JSONL 的 `stat`/`list` 不提供
  `eventCount`（接口字段 optional；JSONL 只填 `header/formatStatus/revision/sizeBytes`），而 410
  自愈需要精确 cursor。`persist/open` 在 snapshot 没有 `eventCount` 时，允许对官方日志做**一次**
  `read(0)` 解码取 `events.length`：官方 backend 对 cold log 按 artifact revision memoize（源码
  `coldLogMemo`），插件再按 `(sessionId, sizeBytes)` 记忆化，且该解码结果与 §16.8 的 title fold
  共享同一份 `(sessionId,sizeBytes)` 缓存，避免二次解码；`persist/read` 仍严格分页，不因该解码改变
  对外语义。
  安全边界：artifact > 8 MiB 时记录一次告警（含 sessionId/sizeBytes，scrub 后）；> 128 MiB 时拒绝
  解码并返回 `internal`（details `{ sessionId, sizeBytes, ceilingBytes }`），不得静默 OOM；拒绝时
  客户端不得再试同一 open（显示可操作错误）。
  官方后端将来若在 snapshot 提供便宜的 `eventCount`，删除本偏离。

### 16.8 标题 / blank / updatedAt（v1 硬要求）

- `session/list` 实现按 §5.2 的四级来源；插件新增缓存 `titleCache: Map<sessionId,{sizeBytes,title,blank,updatedAt}>`，
  并发 4，`stat.sizeBytes` 变化即失效；`session/event`/`session/disposed` 事件到达时失效。
- `blank` 与 `turn/start` 的判断来自同一次尾部读；`updatedAt` 优先官方 metadata，缺失时用
  `header.createdAt`/日志尾部事件时间，绝不显示 0。
- 验收：另一 client 新建会话后，本 client 点“刷新”必须看到 title/basename（`titleSource != 'fallback'`
  仅作为首选要求；`fallback` 只允许 cwd 缺失的异常会话）。

### 16.9 执行世界 mux 的 client seam（dev-core 提供，dev-session 消费）

client host 提供 service（实现归 dev-core，`src/remote/mux-client.ts`）：

```ts
interface RemoteMux {
  request(targetId: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
  openStream(targetId: string, endpoint: string, payload: unknown): Promise<{
    write(chunk: Uint8Array): Promise<void> | void
    end(): void
    abort(reason?: string): void
    read(): AsyncIterable<Uint8Array>       // 或 Node Readable
  }>
  close(targetId: string): Promise<void>
}
```

`src/connection/index.ts` 只做 `ctx.ssh` 形状 → `RemoteMux` 的适配（request/stream/dispose）；不得自己
建 SSH 通道。一个 target 一个 FrameMux/WS；断开让 realm 进入 fail-closed。

### 16.10 local 模式打开顺序（dev-ui 契约）

- **host 先、UI 后**：`ctx.agents.create/resume` 先让 client catalog 出现 summary（官方 `api-session/added`
  广播）→ client 轮询 `sessions.list` 直到 `byId[id]` 存在（≤4 s，250 ms 间隔）→ 再
  `uiWorkspace.openSession(id)`。等待超时 → 显示 `session-reveal-timeout`（可重试），不得吞点击。
- 新建会话同样先 P1 `session/create` + client create/resume + `persist/create`（executor:local）→
  `flush()` materialize → 再 openSession；blank 复用官方语义。

### 16.11 clearMain（客户端本地模式）

- 只在官方 selection 指向**本 target 的远程会话**时清理：
  1. 守卫调用 `uiWorkspace.clearMain()`（`typeof === 'function'`，try/catch）；
  2. fallback：`ctx.layout.selectPanel(null)`；仅当持久 `dsh.sessions.current` 指向本 target 会话时
     清该键（值为 `{}`），然后提示用户 reload；**绝不**清本地工作区会话的 selection；
  3. 断开/删除/切换/重连四条路径都要测；失败不得白屏（I3）。
- server 模式主区是 iframe：不涉及 client 官方 selection；移除 iframe 即可。

### 16.12 新增错误码（补充 §12）

| code | status | 场景 |
|---|---|---|
| `executor-mode-conflict` | 409 | persist/open(write) 记录为 server / live server agent |
| `executor-assign-failed` | 409/500 | 状态文件写失败/锁冲突 |
| `registry-reload-failed` | 500 | loader 重载失败；UI 提示改用 profile/restart |
| `registry-write-guard-unavailable` | 500 | 能力 `registryWriteGuard:'none'` 时的写操作（可选路径） |
| `profile-restart-preview-failed` | 500 | 拿不到 active turn 清单，禁止 restart |
| `profile-locked` | 409 | profile 被另一实例租约占用 |
| `mode-switch/preview-failed` | 500 | P3 preview 失败 |
| `mode-switch/other-turns-cancelled-required` | 409 | 未带 `cancelActiveTurns:true`/确认 |
| `mode-switch/cancel-failed` | 500 | 有 turn 取消失败；details 列失败项 |
| `mode-switch/preview-stale` | 409 | previewRevision 不匹配（期间 active 集合变化） |
| `agent-compose-failed` | 500 | prepare-server 复刻官方组合失败 |
| `session-reveal-timeout` | 500 | local 模式等待 client catalog 超时 |
| `shutdown-flush-timeout` | 500 | 停进程前尾部落盘超时 |
| `title-fold-failed` | — | 仅日志；行仍返回（fallback 标题） |

### 16.13 P3 D20 端点（dev-ui 直接实现）

```ts
// preview: 不产生副作用
POST /dsh-remote-window/api/mode/preview
  { targetId, nextMode: 'server'|'local' }
→ { currentTurn?: { sessionId, running }, otherActiveTurns: [{sessionId, title?}],
    requiresConfirm: boolean, previewRevision: string }
  错误: mode-switch/preview-failed, target-not-connected, profile-locked

// apply: 必须携带 previewRevision；requiresConfirm 时必须 cancelActiveTurns:true
POST /dsh-remote-window/api/mode/apply
  { targetId, nextMode, cancelActiveTurns: true, previewRevision }
→ { switched: boolean, cancelledTurnIds: string[], failedCancellations: [{sessionId,message}] }
  错误: mode-switch/other-turns-cancelled-required, mode-switch/preview-stale,
        mode-switch/cancel-failed, executor-switch-busy, profile-locked,
        executor-mode-conflict, registry-stale

// events（P3 SSE，复用 /stream/state 通道）
{ type:'mode-switch/progress', targetId, phase:'preview'|'cancelling'|'disposing'|'stopping'|'starting'|'handshake'|'ready'|'failed' }
{ type:'turn/cancelled', targetId, sessionId }
{ type:'mode/changed', targetId, sessionId?, mode }
```

- preview 必须包含所有 running turn（目标 + 其他）；**缺清单 → 不 apply**。
- apply 先 cancel 后切换；任何 cancel 失败 → `mode-switch/cancel-failed`，把已取消/失败列表原样返回，
  并保持 executor 记录为原模式（不写半切换状态）。
- managed handle 路径：`executor/switch` 返回 `restartRequired:false` 时无需 stop/start；unmanaged →
  `restartRequired:true`，由 client 走 `profile/restart`（同 D20 确认与 flush 语义）。
