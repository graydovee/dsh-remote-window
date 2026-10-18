# 接口契约（api-contract）

> 本轮（三步向导 + 连接方式三选一 + 行级添加工作区 / 工作区重命名）要**新增或变更**的全部契约。
> 目标是让 **Developer A（host / provisioning）** 与 **Developer B（client / UI）**
> 拿到本文档即可并行开工，不需要互相等待。
>
> 权威性：与 `doc/architecture.md` 配套；冲突时以本文档的 JSON 形状 / 类型 / 脚本为准，
> 并在改动前找架构师确认。
>
> **修订 v2（2026-10-18，Leader 过闸 gate 3）的落点**：
> §5 `DshCandidate` 字段 / §2.3 nodePath 三级判定与排序 / §7.1 LF 行尾 + PATH 前缀 /
> §7.2 脚本（`$DSHHOME/server/node/bin` 前缀、包装脚本识别、`TOOL` 记录）/ §9.2 实测落地形状 /
> §13 自测清单（复用已部署实例的回归点、reuse 失败按钮、sshd 夹具）。
> Leader 裁决 1/3/5 的用户可见行为在 `architecture.md` §3.4/§3.5/§3.6 与 §5，
> 其接口影响分别是：`done` 帧客户端落点（§6）、`forget-target` 措辞（路由不变）、
> `workspace-rename` 只改 `title`（§4）。
>
> **修订 v3（2026-10-18，Developer A/B 契约偏差裁决）**：
> ① §9.2 启动命令字面 = `PATH=… exec <launcher>`（**不是** `node <launcher>`，实测部署 launcher 是
> `/bin/sh` 包装脚本）+ 两条 marker 并存与 `decidePlugin` 权威；
> ② §8 显式声明 `0.3.0-rc.1` 兼容；③ §7.2 补 `TOOL` 记录与 `probe.tools` 映射、nodePath 三级判定、
> `truncated`；④ §2.2 补客户端 host-key 责任与「已确认未 pin」；⑤ §6 明确
> `ConnectDraft.packageSource` 退役（`connectionMode` 独占）；⑥ §12/§13 命名改 `assembleCandidates()`、
> 删掉 sshd 夹具、验收 SSH 目标改真实主机；⑦ 新增 §12「已知契约偏差」。
>
> **修订 v4（2026-10-18，D-1 裁决 (b) + 路由层口径）**：
> ⑧ **撤销** `DshCandidate.origin` 与「部署实例排在 PATH 命中之后」——排序回落到
> `compatible && upToDate` → `compatible` → `path`（与现实现一致，A 无需改动）；
> ⑨ §10/§3.1 明确缺参**在路由层**就拒（HTTP `400`；实现 code 为 `bad-request`，
> `reuse-launcher-missing` 只作执行期兜底 —— 见 §10 的「实现对齐说明」）；
> ⑩ D-2 不开条目，改为「README 待清理」（本轮不改 README）。
>
> **修订 v5（2026-10-18，冻结前最后一批实现回写）**：
> ⑪ §10 补 `realm-unavailable`（同步 HTTP 500，realm 守卫拒绝）与 sandbox facts 附注；
> ⑫ §11 补三个记录字段的生产约束（`provisionedHints()` 唯一生产、`publicTarget` 全部带出、不含凭据）；
> ⑬ §3.1/§10 的记录改成**现实现**：路由层缺参 = HTTP 400 + code `bad-request`，
> `reuse-launcher-missing` 只作执行期兜底（差异见 §10「实现对齐说明」）。
>
> **修订 v6（2026-10-18，阶段 P0：server 权威重构）**：
> ⑭ 新增 **§14 协议 v3**（`reg.list` 扩展 / `reg.rename` / `reg.delete` / 握手矩阵，逐字可照抄）；
> ⑮ 新增 **§15 本地数据模型**（`WorkspaceRef`、`/api/state` 新形状、迁移算法、`api.ts` 增补）；
> ⑯ §1 路由表：`state` 改形状、`workspace-rename` 改语义、新增 `workspace-delete` 与
> `cleanup-shell-workspaces`、`forget-workspace` 退役；
> ⑰ §4 重写为「工作区写操作」；§10 增 `workspace-not-empty`(409)/`server-protocol-mismatch`/
> `cleanup-failed`/`invalid-workspace-id`。
>
> **修订 v7（2026-10-18，P0 契约修订：join 改为 server 清单驱动）**：
> ⑱ §15.1 `WorkspaceRef` 注释改为「自动登记，材料化前 `stubPath` 为空」；
> ⑲ §15.2 `workspaceRefs` 语义改写 + **新不变量**「已连接 target 上 `workspaceRefs` 的
> `remoteWorkspaceId` 集合 ⊇ `serverWorkspaces` 的 id 集合」+ `remote-workspaces` 路由降为内部/QA 用；
> ⑳ §15.3 迁移**无收尾步骤**、并入自动登记流程；§12 客户端表：弹窗回单页签、删 `unaddedServerWorkspaces()`；
> ㉑ §4.1 明确「移除 = 所有客户端都消失」。

---

## 0. 通用约定（全部路由适用）

| 项 | 约定 |
|---|---|
| 前缀 | `/dsh-remote-workspace` |
| 命令路由 | `POST /dsh-remote-workspace/api/<name>`，body 必须是 JSON 对象；`<name>` **允许含斜杠**（`connect/start`），不要加斜杠守卫 |
| 成功信封 | `200 { "ok": true, "value": <T> }` |
| 失败信封 | `<status> { "ok": false, "error": { "code": "<code>", "message": "<scrubbed text>" } }` |
| 信任栅栏 | 每个请求先过 `trustedRequest(ctx, req)`（`src/index.ts:128`）；不通过 = `403 forbidden` |
| body 上限 | 1 MiB（`MAX_BODY_BYTES`，`src/index.ts:63`），超出 = `400 bad-request` |
| 错误文本 | 一律 `scrubSecrets()`（`src/targets/types.ts:336`）；凭据只可能出现在两个 body 字段里：`secret`（`connect/start`、`dsh-scan`） |
| 凭据 | `secret` 永不进 URL、永不进记录、永不进日志、永不回显（客户端提交后立即从快照里清空，见 `store.ts:992`） |
| host-key | 未知指纹必须显式确认；**WSL 目标指纹恒为 `''`**，不确认、不存凭据 |
| 进度 | 连接进度走 SSE `GET /dsh-remote-workspace/stream/connect?ticket=<id>`（帧形状本轮**不变**） |
| 可选字段 | wire 上沿用条件展开惯用法 `...(x === undefined ? {} : { x })`；缺省 ≠ null |

## 1. 路由清单

| 路由 | 状态 | 说明 |
|---|---|---|
| `state` | **变更（P0）** | 响应改为 `targets` / **`workspaceRefs`** / **`serverWorkspaces`** / `pluginVersion` / `defaultProfile` / `platform`（§15） |
| `wsl-distros` | 不变 | 非 win32 = `400 unsupported` |
| `ssh-aliases` / `alias-prefill` | 不变 | `~/.ssh/config` |
| `dsh-scan` | 新增 | 连接前只读扫描：架构探测 + 远端已装 dsh 候选 + 本地包缓存状态（§2） |
| `connect/start` | 变更（additive） | body 增 `packageSource: 'reuse'` 与 `reuseLauncherPath`（§3） |
| `hostkey-confirm` | 不变 | |
| `connect` / `stop-target` | 不变 | 树里「连接 / 断开」 |
| `list-dir` / `mkdir` | 不变 | 目录浏览 |
| `open-workspace` / `open-session` | 不变 | 目录→工作区、续聊（内部改为先读/登记 server 清单） |
| `remote-workspaces` | **变更（P0）** | 服务端权威清单 `reg.list`，项内补 `updatedAt?`（§14.1）；`/api/state` 也会带回同一份 |
| `sessions` | 不变 | 会话列表（含 `persist.titles`） |
| `session-rename` / `session-flag` | 不变 | 会话重命名 / 置顶归档（视图状态） |
| `workspace-rename` | **语义变更（P0）** | 改为 server `reg.rename`；body 变 `{ targetId, remoteWorkspaceId, title }`（§4） |
| `workspace-delete` | **新增（P0）** | server `reg.delete`；有会话默认 409，`force: true` 才删清单（§4.1） |
| `forget-workspace` | **退役（P0）** | 被 `workspace-delete` 取代：清单在 server，没有「只在本机忘记」这种东西 |
| `forget-target` | 不变（只改 UI 措辞） | 语义 = 「删除连接」；**不动 server 清单**（架构 A41） |
| `cleanup-shell-workspaces` | **新增（P0）** | 清扫共享 registry 里本插件的 stub 条目（§4.2） |
| `package-policy-get` / `package-policy-set` | 不变 | 全局策略（`auto｜download｜upload｜ask`，**不含 reuse**） |
| `stream/connect`（SSE） | 不变 | 帧 `step｜host-key｜done｜error` |

**P0 新增的远端 RPC**（不是 HTTP 路由，走协议通道）：
`reg.rename`、`reg.delete`，以及 `reg.list` 的字段扩展 —— 逐字契约见 **§14**。
它们要求改 `src/protocol.ts` 与 `src/server/**`，**必须两仓同步**（架构 §7.2）。

> 上一版写的「本轮明确不新增 `reg.delete`/`reg.rename`」**已作废**（P0 明确要它们）。

---

## 2. `dsh-scan`（新增）

用途：向导第 3 步在**真正连接之前**拿到三件事——远端要什么架构的包、远端装了哪些 dsh、本地缓存是否命中。
实现方式：用**一次性** transport（照 `service.ts:629-647` `runCommand` 的写法）执行 §7 的只读脚本后立即关闭，
**不建通道、不落记录、不写远端任何文件**。

### 2.1 请求

`POST /dsh-remote-workspace/api/dsh-scan`

```jsonc
{
  "kind": "ssh",                       // 可选，默认 "ssh"；"wsl" 仅 Windows
  "host": "10.0.0.12",                 // ssh 必填
  "port": 22,                          // ssh 必填（1..65535）
  "username": "graydove",              // ssh 必填
  "authKind": "password",              // "password" | "privateKey" | "agent"
  "secret": "…",                       // password 或私钥口令；可省略（agent / 已确认指纹的前提）
  "privateKeyPath": "~/.ssh/id_ed25519",
  "sshConfigAlias": "dev-box",
  "hostKeyFingerprint": "SHA256:…",    // 首次接触省略
  "wslDistro": "Ubuntu-22.04",         // wsl 必填
  "wslUser": "graydove",               // wsl 可选
  "profile": "dsh-remote-server",      // 可选，默认取 target.remote.profile
  "dshHome": "~/.dsh"                  // 可选，默认取 target.remote.dshHome（扫描插件时用它展开）
}
```

校验（全部 `400 bad-request`，除非注明）：
- `kind` 只能是 `ssh`/`wsl`；非 win32 上 `wsl` = `400 unsupported`（与 `connect/start` 同款，`methodAvailable`）。
- `ssh` 缺 `host`/`port`/`username`；`wsl` 缺 `wslDistro`。
- `authKind=privateKey` 且给了 `privateKeyPath` 但文件读不出 = `500`，message 里**只有路径**，不含内容。

### 2.2 响应

**A. 已确认 host key（或 WSL）→ 扫描结果**

```jsonc
{
  "ok": true,
  "value": {
    "stage": "done",
    "probe": {
      "platform": "linux",             // linux | darwin
      "arch": "arm64",                 // x64 | arm64
      "libc": "gnu",                   // "" | gnu | musl（非 linux 恒 ""）
      "platformArch": "linux-arm64",
      "tag": "linux-arm64-gnu",        // artifactTag(platform, arch, libc)
      "home": "/home/graydove",
      "tools": { "tar": true, "sha256sum": true, "curl": false, "wget": true }
    },
    "package": {
      "artifact": "dsh-remote-server-0.2.1-rc.2-linux-arm64-gnu.tar.gz",
      "version": "0.2.1-rc.2",         // 与远端 dsh 目标版本一致的 host 版本（见 §9 dshReleaseVersion）
      "cached": true,                  // 本地 ~/.dsh/remote-assets 命中且 sha256 校验通过
      "sha256": "…",                   // cached=true 时给
      "sizeBytes": 41943040            // cached=true 时给
    },
    "dshHome": "/home/graydove/.dsh",
    "profiles": ["dsh-remote-server", "web"],
    "candidates": [
      {
        "path": "/home/graydove/.nvm/versions/node/v24.4.0/bin/dsh",
        "realPath": "/home/graydove/.nvm/versions/node/v24.4.0/lib/node_modules/@deepseek-ai/dsh/bin/dsh.js",
        "version": "0.2.1-rc.2",
        "compatible": true,
        "executable": true,
        "nodePath": "/home/graydove/.nvm/versions/node/v24.4.0/bin/node",
        "selfContained": false,
        "profile": {
          "name": "dsh-remote-server",
          "pluginVersion": "0.1.0-alpha50",
          "pluginSha256": "…",
          "upToDate": true               // 与本机 profile 文件集的 sha256 相同
        },
        "reason": ""                     // compatible=false 时给人类可读原因（已 scrub）
      }
    ]
  }
}
```

**B. host key 未确认（仅 ssh）→ 与连接流程同款的确认提示**

```jsonc
{ "ok": true, "value": { "stage": "host-key", "fingerprint": "SHA256:…" } }
```

客户端拿到 B 就展示**同一个** host-key 面板，用户确认后带 `hostKeyFingerprint` 重发 `dsh-scan`。
**不落记录、不存凭据、不 pin 指纹**（这与 `connect/start` 的「确认即 pin」不同：扫描是只读探路，
真正 pin 发生在连接成功时，`service.ts:606-616`）。

**客户端责任（Leader 裁决 2026-10-18 第 6 条）**：
1. `dsh-scan` 拿到 `stage:'host-key'` 后，向导必须走**同一个** host-key 确认面板（复用
   `connect/start` 的确认 UI 与 `pendingSecret`），确认后把指纹写进**内存** `state.trusted`
   （`store.ts:1367` `confirmHostKey`）+ 带 `hostKeyFingerprint` 重发扫描
   （`store.ts:1123` 已把 `dshScan.fingerprint` 放进扫描请求）。
2. `connect/start` 复用 `state.trusted` 里的指纹（`store.ts:1046` / `1231`），**不二次弹窗**；
   已确认但**未 pin** —— pin 仍只发生在**连接成功**那一刻（`runConnect` 成功后写记录）。
3. 扫描本身不产生记录/通道/凭据，因此**取消扫描不需要清理**。

### 2.3 字段语义

| 字段 | 规则 |
|---|---|
| `candidates[].path` | 用户可见的启动器路径（可能就是 PATH 命中的那个） |
| `candidates[].realPath` | `readlink -f` 后的真实文件；去重键。**注意**：部署实例的 `.bin/dsh` 是 `/bin/sh` 包装脚本，`readlink -f` 返回它自身（不是 `dsh.js`） |
| `candidates[].version` | `<launcher> --version` 首行（trim）；失败时 `""` |
| `candidates[].compatible` | host 侧用 `isCompatibleDsh(version)`（§8）判定；`""`/不可解析 = `false` |
| `candidates[].executable` | `--version` 是否 exit 0 且输出非空 |
| `candidates[].nodePath` | 见下方「nodePath 判定顺序」（**实测有坑，不要简化**） |
| `candidates[].selfContained` | `nodePath === undefined`：启动器不需要解释器（无 shebang 的原生二进制）；**或**是需要 node 但远端一个都没找到（此时 `planProvision` 会部署我们自己的 Node） |
| `candidates[].profile` | 该 dsh 的 `DSH_HOME/profiles/<name>/node_modules/dsh-remote-workspace/package.json` 的 `version` + `.dsh-rw-plugin.json` 的 `sha256`；`upToDate` 由 host 用 `sha256OfFiles()` 比对。**profile 级、不是每个 launcher 一份** |
| `candidates[].reason` | 例如 `version 0.1.9 is below the supported floor 0.2.1-rc.2`；`--version` 没输出时是 `the launcher did not report a version (exit 127)` |
| **排序** | 见下方「排序规则」；最多返回 12 条 |

**nodePath 判定顺序（Leader 2026-10-18 在 `Ubuntu-22.04` 实测后纠正）**

部署出来的实例长这样（上传路径的产物）：

```
$HOME/.dsh/server/dsh/node_modules/.bin/dsh     ← /bin/sh 包装脚本，内部 exec node
$HOME/.dsh/server/node/bin/node                  ← v24.21.0，**不在 PATH 上**
```

后果：`readlink -f` 对包装脚本返回它自身，`head -1` 是 `#!/bin/sh`，因此「只看 shebang」的规则
**给不出 node**；而 `--version` 又必须靠 `exec node` 成功才能打印版本，脚本不把
`$DSHHOME/server/node/bin` 放进 PATH 就会得到 `exec: node: not found`（exit 127）→
`version=''` → 被判不兼容 → **复用我们自己刚部署的实例会失败**。

所以 `nodePath` 按以下顺序判定（全部在扫描脚本内完成，host 不再改判）：

1. shebang 命中 `#!.../env node` → 取 `command -v node`；命中 `#!<abs>/node` → 取该绝对路径；
   两者都要 `[ -x ]` 才保留（脚本的 PATH 第一位就是 `$DSHHOME/server/node/bin`，所以
   `command -v node` 通常已经命中部署自带的 node）。
2. shebang 是脚本但**不点名 node**（`#!/bin/sh`、`#!/bin/bash` 的包装脚本）→
   若 `$DSHHOME/server/node/bin/node` 存在且可执行，取它。
3. 其余情况（无 shebang 的原生二进制、或没有可用 node）→ `nodePath` 字段**省略**，
   即 `selfContained: true`；后者由 `planProvision` 转成「部署我们自己的 Node」
   （见 architecture §3.2）。
4. host 侧兜底：`nodePath` 给了但不可执行 = 当作省略处理。

**排序规则（Leader 裁决 2026-10-18：撤销 `origin` 降权，采纳现实现）**

`assembleCandidates()`（`dsh-scan.ts:400`）的排序键，依次：

1. `compatible && profile.upToDate`（兼容且已装当前版本插件）→ 0；
2. 仅 `compatible` → 1；
3. 其余（不兼容 / 不可执行）→ 2；
4. 同档内按 `path` 字典序；截断到 12 条（`MAX_CANDIDATES`）。

> **裁决记录（D-1，已撤销）**：早前要求「部署实例（`~/.dsh/server/dsh/…`）排在 PATH 命中之后」，
> 现按 Leader 裁决 (b) **撤销**：部署实例本身就是最可靠的复用候选（自带 node、插件状态可判），
> 降权没有用户价值；`origin` 是纯展示维度的多余字段，会让 wire 契约变宽而无收益。
> 因此 `DshCandidate` **没有** `origin`，排序也**不**按部署路径降权。

### 2.4 错误

| code | status | 何时 |
|---|---|---|
| `forbidden` | 403 | 信任栅栏 |
| `bad-request` | 400 | 字段缺失/非法、body 非对象、> 1 MiB |
| `unsupported` | 400 | 非 win32 的 `wsl` |
| `scan-failed` | 500 | 传输建立失败 / 脚本非零退出（message 含 stderr 尾巴，已 scrub） |
| `scan-timeout` | 500 | 单次扫描超过 60 s |

---

## 3. `connect/start`（变更：additive）

### 3.1 请求增量

```jsonc
{
  // ……既有字段全部不变……
  "packageSource": "reuse",                 // 新增枚举值 'reuse'（既有 'auto'|'download'|'upload' 仍接受）
  "reuseLauncherPath": "/home/u/.nvm/versions/node/v24.4.0/bin/dsh"   // packageSource='reuse' 时必填
}
```

- 既有目标记录里的 `packageSource` 仍按 `service.ts:323-325` 的优先级生效
  （target 覆盖 > 全局策略；`ask` → `auto`）。
- **路由层必校验**（`connectRequestFrom`，`index.ts:200`，纯函数 + `tests/connect-request.test.ts`）：
  `packageSource === 'reuse'` 且 `reuseLauncherPath` 缺失/为空
  → **HTTP `400`**，`error.code = 'bad-request'`，message
  `"reuseLauncherPath" is required when "packageSource" is "reuse"`（**同步拒**，不进任何传输）。
  执行期若启动器仍消失，再由 plan 阶段报 `reuse-launcher-missing`（兜底，见 §10）。
- **不做**服务端回退：reuse 执行期失败就报错（见 §10 错误码），客户端提示改用「上传 server 包」。

### 3.2 响应

不变：`{ "ok": true, "value": { "ticket": "<uuid>" } }`。

### 3.3 SSE 帧（形状不变，新增的只有 message 文本）

```
data: {"type":"step","step":"connect","status":"running","message":"connecting to 10.0.0.12:22"}
data: {"type":"step","step":"probe","status":"ok","message":"linux-arm64 at /home/u (tools: tar, sha256sum)"}
data: {"type":"host-key","fingerprint":"SHA256:…"}
data: {"type":"step","step":"runtime","status":"ok","message":"复用远端 dsh 0.2.1-rc.2（跳过 Node 与 dsh 部署）"}
data: {"type":"step","step":"upload","status":"running","message":"远端 dsh 未安装 server 插件，正在安装（12 个文件）"}
data: {"type":"step","step":"upload","status":"ok","message":"server 插件 0.1.0-alpha50 已安装（profile dsh-remote-server）"}
data: {"type":"step","step":"start","status":"running","message":"复用启动器 /home/u/.nvm/versions/node/v24.4.0/bin/dsh"}
data: {"type":"step","step":"start","status":"ok"}
data: {"type":"done","target":{ …PublicTarget… }}
```

**约定的可 grep 文案**（QA 与 Developer 都用它判定走的是哪条路）：

| 场景 | `step` | `message` 里必须出现 |
|---|---|---|
| 复用命中 | `runtime` / `status:ok` | `复用远端 dsh <version>` |
| 复用但需补 Node | `runtime` / `status:ok` | `复用远端 dsh <version>（自带 Node <v>）` |
| 插件已最新 | `upload` / `status:ok` | `server 插件已是最新（marker 命中）` |
| 插件新装 | `upload` / `status:ok` | `server 插件 <version> 已安装` |
| 打包路径（未变） | `upload` | `server package ready via build\|cache` |

> 为什么**不加** `ProvisionStep`：它是 wire 枚举（`channel.ts:56` + `api.ts:205` + `api.ts:418` 白名单），
> 多一行 UI 不值得一次协议变更；跳过本来就有 marker 命中这个先例（`channel.ts:276`）。

---

## 4. 工作区写操作（P0 改为 server 权威）

工作区的 `path`/`title`/`createdAt`/`sessionCount` 都在 server（架构 §7.1），因此「改名 / 移除」
必须走远端 RPC（§14）。host 侧这三个路由只做「转成 RPC + 刷新」；**本地不再写 title/path**。

### 4.1 `workspace-rename`（语义变更）与 `workspace-delete`（新增）

**`POST /dsh-remote-workspace/api/workspace-rename`**

```jsonc
// request
{ "targetId": "rt-1a2b3c4d", "remoteWorkspaceId": "3f9a1c0b7e2d4a68", "title": "后端服务" }
// response
{ "ok": true, "value": { "workspace": { /* ServerWorkspace，见 §14.1 */ } } }
```

- `title` 用官方 `normalizeSessionTitle` 同款归一化（`service.ts::normalizeTitle`）；归一化后为空 =
  `400 bad-request`（`code: 'bad-request'`，message 点名 `title`）。
- 转发为 `reg.rename { id: remoteWorkspaceId, title }`；**id 与远端目录名都不变**（架构 A34）。
- 成功后 host 重读 `reg.list` 并回填 `/api/state` 的 `serverWorkspaces`。
- 未知 target = `404 not-found`；target 未连接 = `400 not-connected`；server 说没有该 id =
  `404 not-found`（把 RPC 的 `unknown remote workspace "<id>"` 映射成 404）。

**`POST /dsh-remote-workspace/api/workspace-delete`（新增）**

```jsonc
// request
{ "targetId": "rt-1a2b3c4d", "remoteWorkspaceId": "3f9a1c0b7e2d4a68" }
{ "targetId": "rt-1a2b3c4d", "remoteWorkspaceId": "3f9a1c0b7e2d4a68", "force": true }
// response
{ "ok": true, "value": { "removed": true, "sessionCount": 5, "refsDropped": ["wr-1a2b3c4d"] } }
```

- 转发为 `reg.delete { id, force? }`（§14.2）。
- **`force` 省略/false 且 `sessionCount > 0`** → **HTTP `409`**，
  `error.code = 'workspace-not-empty'`，`error.message` 里带数字（便于 UI 直接展示「还有 N 个会话」）。
- `force: true` → 删 server 清单条目；**远端会话日志一律保留**（架构 A35）。**所有客户端**都会
  看不到该工作区（清单是共享权威，A44）。响应 `sessionCount` 是删除前统计，用于提示与 QA 取证。
- 成功（或幂等：本来就没有）后，host 删掉本地 `WorkspaceRef`（含 stub 目录与官方 shell 条目，
  走 `forgetWorkspace` 的清理路径），`refsDropped` 列出被删的本地 ref id。
- `forget-workspace` 路由**退役**：清单在 server，不存在「只在本机忘记」；旧的 `forget-workspace`
  可保留一版作为别名（转调 `workspace-delete`，`force: false`），但 UI 不得再用它。

### 4.2 `cleanup-shell-workspaces`（新增，P0）

`POST /dsh-remote-workspace/api/cleanup-shell-workspaces`，body `{}`。

```jsonc
{ "ok": true, "value": { "removed": ["ws-official-1", "ws-official-2"], "kept": ["ws-official-3"] } }
```

- 清扫**共享** `~/.dsh/storages/workspace.json` 里本插件的残留：官方 registry 中 `path` 落在
  `~/.dsh/remote-workspaces/`（stub 根）下的条目。
- **默认（Gate 0 分支 A）我们不写共享 registry**，所以这条路由的日常用途是**清历史遗留**
  （P0 之前版本留下的条目）；只有设了逃生口 `DSH_RW_FORCE_SHELL_WORKSPACES=1` 时才会清到
  「我们自己刚写的」。见 architecture §7.4。
- `removed` = 已删；`kept` = 因为有活跃会话/正在使用而保留（架构 §7.4 第 2 条）。
- 同时删除对应 stub 目录（空目录也删）。
- 失败（registry 不可用）→ `500 cleanup-failed`，message 过 `scrubSecrets`。
- 幂等：没有可删条目时返回 `{ removed: [], kept: [] }`。
- 这是 QA 证明「desktop 零污染」的操作入口；启动与 `dispose()` 会自动跑同一逻辑。

---

## 5. 客户端 `api.ts` 类型（Developer B 照抄）

```ts
// ── 连接方式 ────────────────────────────────────────────────────────────────
/** 第 3 步的三选一。`download` 本轮只渲染不可用卡片。 */
export type ConnectionMode = 'reuse' | 'upload' | 'download'

/** 每个目标记住的包来源；'' = 跟随全局策略。 */
export type PackageSourceInput = '' | 'upload' | 'reuse'

// ── dsh 扫描 ────────────────────────────────────────────────────────────────
export interface DshScanRequest {
  kind?: 'ssh' | 'wsl'
  host?: string
  port?: number
  username?: string
  authKind?: AuthKind
  /** 只在本次请求体里出现，永不回显。 */
  secret?: string
  privateKeyPath?: string
  sshConfigAlias?: string
  hostKeyFingerprint?: string
  wslDistro?: string
  wslUser?: string
  profile?: string
  dshHome?: string
}

export interface ScannedDshProfile {
  name: string
  pluginVersion?: string
  pluginSha256?: string
  upToDate: boolean
}

export interface DshCandidate {
  path: string
  realPath: string
  /** `dsh --version` 首行；失败时 ''。 */
  version: string
  compatible: boolean
  executable: boolean
  nodePath?: string
  selfContained: boolean
  profile?: ScannedDshProfile
  reason?: string
}

export interface RemoteRuntimeProbe {
  platform: 'linux' | 'darwin'
  arch: 'x64' | 'arm64'
  libc: '' | 'gnu' | 'musl'
  platformArch: string
  tag: string
  home: string
  tools: { tar: boolean; sha256sum: boolean; curl: boolean; wget: boolean }
}

export interface ServerPackageState {
  artifact: string
  version: string
  cached: boolean
  sha256?: string
  sizeBytes?: number
}

/** `/api/dsh-scan` 的两种结局：等确认 / 有结果。 */
export type DshScanResult =
  | { stage: 'host-key'; fingerprint: string }
  | {
      stage: 'done'
      probe: RemoteRuntimeProbe
      package: ServerPackageState
      dshHome: string
      profiles: string[]
      candidates: DshCandidate[]
    }

// ── 既有类型的两处变更 ──────────────────────────────────────────────────────
export interface ConnectStartRequest {
  // ……既有字段不变……
  /** 新增 'reuse'。 */
  packageSource?: 'auto' | 'download' | 'upload' | 'reuse'
  /** `packageSource: 'reuse'` 时必填。 */
  reuseLauncherPath?: string
}

export interface PublicTarget {
  // ……既有字段不变……
  packageSource?: 'auto' | 'download' | 'upload' | 'reuse'
  /** 上次选中的复用启动器（用于预选）。 */
  reuseDsh?: { path: string; version: string; nodePath?: string; scannedAt: string }
  /** 上次探测到的架构（提示，不参与正确性）。 */
  platformProbe?: { platform: 'linux' | 'darwin'; arch: 'x64' | 'arm64'; libc: '' | 'gnu' | 'musl'; tag: string; probedAt: string }
}
```

`api` 对象新增两个方法：

```ts
/** 连接前只读扫描（架构 + 候选 dsh + 本地缓存状态）。 */
dshScan(request: DshScanRequest): Promise<DshScanResult>

/** 重命名远端工作区（只改本地记录 title）。 */
workspaceRename(workspaceId: string, title: string): Promise<{ workspace: RemoteWorkspace }>
```

---

## 6. `client/store.ts` 类型与动作（Developer B 照抄）

```ts
/** 三步向导。`directory` 已经移出（见 architecture §3.4）。 */
export type WizardStep = 'method' | 'config' | 'connect'

/** 进度行（服务端五步，不变）。 */
export const CONNECT_STEPS: readonly ConnectStep[] = ['connect', 'probe', 'runtime', 'upload', 'start']

export interface ConnectDraft {
  // ……既有字段不变……
  /** 第 3 步的选择；'' = 未选（按钮禁用）。 */
  connectionMode: '' | 'reuse' | 'upload' | 'download'
  /** 被选中的复用启动器绝对路径（connectionMode='reuse' 时必填）。 */
  reuseLauncherPath: string
}

/** dsh 扫描状态（与既有 wslProbe 同构）。 */
export interface DshScanState {
  status: 'idle' | 'scanning' | 'ready' | 'unavailable'
  candidates: DshCandidate[]
  probe?: RemoteRuntimeProbe
  package?: ServerPackageState
  /** host-key 未确认时的指纹：展示同一个确认面板，确认后重扫。 */
  fingerprint?: string
  error?: string
}

export interface DirectoryState {
  // ……既有字段不变……
  /** 浏览弹窗是否打开（原本由向导 step 表达）。 */
  open: boolean
}

export interface ConfirmState {
  /** 'forget-connection' 的用户可见语义现在是「删除连接」。 */
  readonly kind: 'forget-connection' | 'forget-workspace'
  // ……其余不变……
}

/** 工作区重命名弹窗的挂载状态。 */
export interface WorkspaceRenameState {
  readonly workspace: RemoteWorkspace
  readonly title: string
}

export interface AppState {
  // ……既有字段不变……
  dshScan: DshScanState
  renameWorkspace?: WorkspaceRenameState
  /** directory.open 取代了原来的 step='directory'。 */
}
```

**退役**（连同引用一起删，避免死代码）：
- `ConnectState.origin`（`store.ts:102`）、`store.openTargetDirectory`、`store.retryDirectoryConnect`、
  `wizard.tsx` 的 `DirectoryStep`（搬去 `directory-picker.tsx`）、`STEP_ORDER` 里的 `directory`。
- **第 2 步的 `packageSource` SegmentedControl（`wizard.tsx:511-524`）与草稿字段 `ConnectDraft.packageSource`
  （`store.ts:64`）一起退役**（Leader 裁决 2026-10-18 a）：第 3 步的 `connectionMode` **独占** wire 字段
  `packageSource`，草稿里不再保留第二份真相。
  **README 待清理**：若 README 仍描述第 2 步的「服务端包来源」，记为已知文档债，本轮不改 README。
- `ConnectState.phase` 保持原样（`idle|running|awaiting-hostkey|failed|succeeded`）。

**新增动作**：

```ts
setConnectionMode(mode: '' | 'reuse' | 'upload' | 'download'): void
scanDsh(force?: boolean): Promise<void>          // POST dsh-scan；stage==='host-key' 写 dshScan.fingerprint
selectDshCandidate(path: string): void           // 纯本地选择，不走 patchConfig（它会清 pendingSecret）
requestWorkspaceRename(workspace: RemoteWorkspace): void
settleWorkspaceRename(): void
acceptWorkspaceRename(title: string): Promise<void>
openBrowseDirectory(target: PublicTarget): Promise<void>   // 打开弹窗「浏览目录」页签，未连接先 connect
```

`startConnect()` 的改动：`request.packageSource` 由 `connectionMode` 映射
（`reuse` → `'reuse'` + `reuseLauncherPath`，`upload` → `'upload'`，`''` → 省略 = 跟随全局策略），
`download` 不可选（卡片 disabled）。

SSE `done` 帧的改动（`store.ts:1072-1090`）：

```ts
case 'done':
  // 不再跳 directory：回列表、展开该连接、提示下一步
  commit(previous => ({
    view: 'list',
    step: 'method',                       // 下次新建从第 1 步开始
    connect: { ...idleConnect(), phase: 'succeeded', target: frame.target },
    expanded: { ...previous.expanded, [targetNodeKey(frame.target.id)]: true },
    notice: { kind: 'success', text: t('connect.succeeded.list') },
  }))
  void refreshState()
  return
```

---

## 7. 远端脚本与解析约定

### 7.1 通则

| 项 | 约定 |
|---|---|
| 解释器 | 一律 POSIX `sh`。ssh 侧由 `deploy.sh(body)` → `/bin/sh -c '<body>'`；WSL 侧由 `transport.exec` → `wsl -d <d> -- /bin/sh -s` + **stdin**（`wsl.ts:93`、硬约束 8） |
| 引号 | 所有插值用 `shellQuote`（`profile.ts:122`）；脚本里**不拼用户输入**（扫描脚本只用 `$HOME`、`$DSH_HOME` 与常量 glob） |
| 只读 | 扫描脚本**只允许**：`command -v`、`ls -d`、`[ -e/-f/-x ]`、`readlink -f`、`head`、`sed`、`tr`、`cat`、`uname`、`ldd --version`、`<launcher> --version`。**禁止**：任何 `mkdir/rm/mv/cp/touch`、任何包管理器、任何网络、任何 `dsh` 子命令（除 `--version`） |
| 输出格式 | 一行一条记录，字段用 **TAB** 分隔，首行魔数 `@@RW@@SCAN@@1`，末行 `END`。未知记录 kind 必须被 host 忽略（向前兼容） |
| 长度 | 输出上限 64 KiB（`transport.exec(..., { maxBytes: 64*1024 })`）；超限即被截断 → host 视为不完整，不报错、只用已有记录 |
| 超时 | 单次扫描 `timeoutMs: 60_000`；脚本内每个 `<launcher> --version` 用 `timeout 15`（没有 `timeout` 命令则直接跑） |
| 字段清洗 | 出现 `\t`/`\n` 的路径视为异常候选，host 解析时丢弃该条 |
| 秘密 | 脚本不接触任何凭据；输出里不得出现凭据（传输层也不给） |
| **行尾** | **必须是 LF**。经 stdin 交给 `sh -s` 时，CRLF 的 `\r` 会被并进命令名（Leader 实测：CRLF here-string 得到 `/bin/sh: echo: not found`）。脚本一律写在 TS 字符串字面量里（天然 LF），**禁止**从 Windows here-string / CRLF 文件读入后拼接；`tests/` 里断言脚本字符串**不含 `\r`** |
| **PATH 前缀** | 必须包含 `$DSHHOME/server/node/bin`（部署实例的 `/bin/sh` 包装脚本内部 `exec node`，那个 node 不在系统 PATH 上；实测不加 = `exec: node: not found` = exit 127 → 版本为空 → 被误判不兼容） |

> 对比：现有 `probeScript`（`deploy.ts:136-155`）里有 `mkdir -p ~/.dsh/server/.components`
> （`deploy.ts:146`），**那是流水线里的写操作，扫描脚本不许抄它**。

### 7.2 扫描脚本（`src/provision/dsh-scan.ts::scanDshScript()` 的规范文本）

```sh
# 只读扫描：远端装了哪些 dsh / node，DSH_HOME 下有哪些 profile 与本插件
# 行尾必须 LF；本文件里的脚本是规范文本，实现必须逐行对齐（见 §7.1）
set -u
export LC_ALL=C
DSHHOME=$(printf '%s' "${DSH_HOME:-$HOME/.dsh}")
# $DSHHOME/server/node/bin 必须排在最前：上传路径部署出来的 dsh 是 /bin/sh 包装脚本，
# 内部 `exec node`，而那个 node 不在系统 PATH 上。少了这一段 → exit 127 → 版本读不到
# → 复用我们自己刚部署的实例会被误判为不兼容（Leader 2026-10-18 在 Ubuntu-22.04 实测）。
PATH="$DSHHOME/server/node/bin:$HOME/.local/bin:$HOME/.bun/bin:$HOME/.volta/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
run() { if command -v timeout >/dev/null 2>&1; then timeout 15 "$@"; else "$@"; fi }

printf '%s\n' '@@RW@@SCAN@@1'
printf 'HOME\t%s\n' "$HOME"
printf 'DSHHOME\t%s\n' "$DSHHOME"
printf 'UNAME\t%s\n' "$(uname -s 2>/dev/null)"
printf 'MACHINE\t%s\n' "$(uname -m 2>/dev/null)"
printf 'OSTYPE\t%s\n' "$(cat /proc/sys/kernel/ostype 2>/dev/null | head -1)"
printf 'LDD\t%s\n' "$(ldd --version 2>&1 | head -1)"
# TOOL 记录：与 deploy.probeScript 同一组二进制；host 侧映射成 probe.tools（见下方映射表）
for t in tar sha256sum shasum curl wget; do
  p=$(command -v "$t" 2>/dev/null || true)
  [ -n "$p" ] || continue
  printf 'TOOL\t%s\t%s\n' "$t" "$p"
done

for n in "$(command -v node 2>/dev/null || true)" \
         "$HOME"/.nvm/versions/node/*/bin/node \
         "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node \
         "$HOME/.volta/bin/node" "$HOME/.bun/bin/node" \
         "/usr/local/bin/node" "/usr/bin/node"; do
  [ -n "$n" ] || continue
  [ -x "$n" ] || continue
  printf 'NODE\t%s\t%s\n' "$n" "$(run "$n" -v 2>/dev/null | head -1)"
done

SEEN='|'
# 顺序 = 优先级：PATH 命中 → 常见位置 → 我们自己部署的实例（枚举顺序即建议顺序）
for c in "$(command -v dsh 2>/dev/null || true)" \
         "$HOME/.local/bin/dsh" "$HOME/.bun/bin/dsh" "$HOME/.volta/bin/dsh" \
         "$HOME/.local/share/pnpm/dsh" \
         "$HOME"/.nvm/versions/node/*/bin/dsh \
         "$HOME"/.local/share/fnm/node-versions/*/installation/bin/dsh \
         "/usr/local/bin/dsh" "/usr/bin/dsh" "/opt/homebrew/bin/dsh" \
         "$DSHHOME/server/dsh/node_modules/.bin/dsh"; do
  [ -n "$c" ] || continue
  [ -e "$c" ] || continue
  real=$(readlink -f "$c" 2>/dev/null || printf '%s' "$c")
  case "$SEEN" in *"|$real|"*) continue ;; esac
  SEEN="$SEEN$real|"
  out=$(run "$c" --version 2>/dev/null); code=$?
  ver=$(printf '%s' "$out" | head -1)
  sb=$(head -1 "$real" 2>/dev/null)
  node=''
  case "$sb" in
    '#!'*'/env '*node*) node=$(command -v node 2>/dev/null || true) ;;
    '#!'*node*) node=$(printf '%s' "$sb" | sed -e 's/^#![[:space:]]*//' -e 's/[[:space:]].*$//') ;;
  esac
  case "$node" in /*) ;; *) node='' ;; esac
  [ -x "$node" ] || node=''
  # shebang 不点名 node（如部署实例的 `#!/bin/sh` 包装脚本）+ 部署过 node → 用部署自带的那个
  if [ -z "$node" ]; then
    case "$sb" in
      '#!'*) if [ -x "$DSHHOME/server/node/bin/node" ]; then node="$DSHHOME/server/node/bin/node"; fi ;;
    esac
  fi
  printf 'DSH\t%s\t%s\t%s\t%s\t%s\n' "$c" "$real" "$ver" "$code" "$node"
done

for p in "$DSHHOME"/profiles/*; do
  [ -d "$p" ] || continue
  name=$(printf '%s' "$p" | sed -e 's|.*/profiles/||')
  pv=''; sha=''
  manifest="$p/node_modules/dsh-remote-workspace/package.json"
  if [ -f "$manifest" ]; then
    pv=$(tr -d '\n' < "$manifest" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  fi
  if [ -f "$p/.dsh-rw-plugin.json" ]; then
    sha=$(tr -d '\n' < "$p/.dsh-rw-plugin.json" | sed -n 's/.*"sha256"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  fi
  printf 'PLUGIN\t%s\t%s\t%s\n' "$name" "$pv" "$sha"
done

if [ -f "$DSHHOME/server/.components/plugin.json" ]; then
  printf 'MARKER\t%s\t%s\n' "$DSHHOME/server/.components/plugin.json" "$(tr -d '\n' < "$DSHHOME/server/.components/plugin.json" | head -c 400)"
fi
printf '%s\n' 'END'
```

**解析**（`parseDshScanOutput(stdout: string): DshScan`，纯函数、可单测）——与实现
(`src/provision/dsh-scan.ts:230`) 一一对应：

```ts
export interface DshScan {
  home?: string
  dshHome?: string
  platform?: string      // UNAME
  machine?: string       // MACHINE
  ostype?: string
  ldd?: string
  /** TOOL 记录：原样保留，装配时折成 probe.tools（见下映射表）。 */
  tools: { name: string; path: string }[]
  nodes: { path: string; version: string }[]
  /** DSH 记录（**6 字段**）：nodePath 缺省 = 自包含启动器。 */
  launchers: { path: string; realPath: string; version: string; exitCode: number; nodePath?: string }[]
  profiles: { name: string; pluginVersion?: string; pluginSha256?: string }[]
  marker?: string
  /** 没有 `END` 行（被传输层字节上限截断）→ true，结果仍可用。 */
  truncated: boolean
}
```

**TOOL → `probe.tools` 映射**（与 `deploy.parseProbeOutput` 的判定完全一致，`deploy.ts:110-128`）：

| `probe.tools` 键 | 判据 |
|---|---|
| `tar` | `TOOL` 记录里有 `tar` 且 path 非空 |
| `sha256sum` | `TOOL` 里有 `sha256sum` **或** `shasum`（BSD/macOS 只有后者） |
| `curl` | `TOOL` 里有 `curl` |
| `wget` | `TOOL` 里有 `wget` |

> 扫描脚本只为**存在的**工具发 `TOOL` 记录（`command -v` 为空就跳过），所以「没有记录」= 没有该工具。
> 这与 `probeScript` 的「每个工具打一行、空行即缺失」等价，但少一半输出。

**装配 `DshCandidate`**（`assembleCandidates(scan, { profile, expectedPluginSha })`，纯函数；Leader 2026-10-18 确认命名）：
`executable = exitCode === 0 && version.trim() !== ''`；
`compatible = isCompatibleDsh(version)`；
`selfContained = nodePath === undefined`（无解释器的原型：原生 ELF/Mach-O，或没有 node 可用的 `/bin/sh` 包装脚本）；
`profile = scan.profiles.find(name === profile)` + `upToDate = pluginSha256 === expectedPluginSha`（**profile 级、不是每个 launcher 一份**）；
`reason = compatible ? undefined : describeIncompatibility(version)`；
排序见 §2.3。

解析规则：
1. 第一行必须是 `@@RW@@SCAN@@1`，否则抛 `Error('unsupported scan output')`（**不是**返回空结果，
   否则新客户端会把老 server 的乱码当成「没有 dsh」）。
2. 按 `\t` 切；字段数不符的记录丢弃（含 TAB 的路径由此被挡在候选之外）。
3. 没有 `END` 行 = 输出被截断 → `truncated: true`（调用方在 UI 上提示「结果可能不完整」，仍可用于选择）。
4. `platform/arch/libc` 的合成**复用** `parseProbeOutput` 的同一规则（`deploy.ts:101-133`），
   不要把 `ostype`/`ldd` 的判定再写一份。

---

## 8. 版本兼容判定

常量（`src/provision/version-range.ts`，与 `package.json` 的 peer 区间**同源**）：

```ts
export const DSH_MIN_VERSION = '0.2.1-rc.2'   // 实测基线：apply() 挂载式持久后端 + hello 的 kind/executable
export const DSH_MAX_VERSION = '0.3.0'        // 开区间
export function parseDshVersion(text: string): DshVersion | undefined   // 容忍前缀 v、首行带噪声时取首个匹配
export function compareDshVersion(a: DshVersion, b: DshVersion): number
export function isCompatibleDsh(text: string): boolean
export function describeIncompatibility(text: string): string           // 给 candidates[].reason
```

算法（实现必须与这段话逐条对应，并有单测）：
1. 从文本中提取第一个 `^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?`；提取不到 = 不可解析 = 不兼容。
2. 逐段比较 `major/minor/patch`（数值）。
3. 有预发布段 < 无预发布段（`0.2.1-rc.2 < 0.2.1`）。
4. 预发布段按 `.` 切成 identifier：**两边都是数字** → 数值比较；**都是字母数字** → 字典序（ASCII）；
   **数字 < 字母数字**；前缀相同则短的小（`rc.2 < rc.2.1`）。
5. 兼容 = `compare(v, MIN) >= 0 && compare(v, 0.3.0) < 0`。

**边界显式结论（Leader 裁决 2026-10-18）**：`0.3.0-rc.1` **属于兼容**——按 npm/semver 语义
`0.3.0-rc.1 < 0.3.0`（预发布段 < 同号正式版），所以它落在 `[0.2.1-rc.2, 0.3.0)` 内。
`0.3.0` 本身、`0.3.0-rc.0` 之后的**正式** `0.3.x`、以及 `0.2.1-rc.1` 都不兼容。
单测必须钉住这几条：`0.3.0-rc.1` 兼容 / `0.3.0` 不兼容 / `0.2.1-rc.1` 不兼容。

> 为什么不用 `semver`：区间是一个固定常量，30 行足够；新增依赖会动 `dependencies` 与锁文件，
> 而 `zod` 已经被迫钉死（见 AGENTS「编码规约」），不想再引入第二个可变的解析器。

---

## 9. server 包缓存：命名与校验

### 9.1 目录与文件名（现有，**不改**）

```
~/.dsh/remote-assets/                                      ← remoteAssetsCacheDir()
  node-<ver>-<platform>-<arch>.tar.gz                      ← ensureNodeTarball（按 <platform>-<arch>/ 子目录）
  <platform>-<arch>/node-v24.21.0-linux-arm64.tar.gz
  <platform>-<arch>/node-v24.21.0-linux-arm64.tar.gz.ready ← 只放 sha256 + \n
  dsh-remote-server-<dshVersion>-<tag>.tar.gz              ← artifactName(version, tag)
  dsh-remote-server-<dshVersion>-<tag>.tar.gz.ready        ← 本插件写的 sha256
  dsh-remote-server-<dshVersion>-<tag>.tar.gz.sha256       ← release 侧伴生（下载后校验用）
  dsh-remote-server-<dshVersion>-<tag>.manifest.json       ← release/构建产物（dshVersion/platformArch/sha256/size/minNode）
```

- `<tag>` = `artifactTag(platform, arch, libc)`（`package-build.ts:71`）：`linux-arm64-gnu` / `linux-x64` / `darwin-arm64`。
- 校验（`cachedAssetIfReady`，`assets.ts:152-161`）：**文件 size > 1 MiB** 且 `.ready` 内容 = 重新计算的 sha256
  （64 hex）。任一不满足 = 未命中，走源链。
- 复用的最低保证：**同一 `<dshVersion> + <tag>` 的第二次上传永远不重新打包**（命中 `.ready` 即直接上传）。
- 记录里同步写入 `serverPackage: { artifact, sha256, version }`（additive optional），用于 UI 徽标与排障。

### 9.2 reuse 路径的远端布局与 marker

```
<DSH_HOME>/profiles/<profile>/                  ← 复用 dsh 的 profile 目录（DSH_HOME 默认 ~/.dsh）
  package.json                                  ← remoteProfileFiles()
  cordis.yml
  cordis.patch.yml
  pnpm-workspace.yaml
  node_modules/dsh-remote-workspace/**           ← packageFiles()（package.json + cordis.patch.yml + lib/*.js|cjs|mjs）
  .dsh-rw-plugin.json                            ← { "id":"plugin", "sha256":"…", "version":"0.1.0-alpha50", "profile":"dsh-remote-server" }
  .dsh-rw.lock/                                  ← 部署锁（mkdir 原子 test-and-set，语义同 deploy.acquireDeployLock）

打包路径（不变；**Leader 2026-10-18 在 Ubuntu-22.04 实测的落地形状**）：
<installHome>/.dsh/server/
  node/bin/node                                  ← v24.21.0，**不在 PATH 上**（启动时才由 pathAssignment 注入）
  dsh/node_modules/.bin/dsh                      ← /bin/sh 包装脚本，内部 exec node（readlink -f 返回它自身）
  staging/                                       ← 上传暂存（node/dsh tarball）
  profiles/<profile>/…                           ← 同上（marker **两处并存**，见下）
  .components/{node,dsh,plugin}.json
  .deploy.lock/
```

> 实测结论：打包路径**也**写 `<DSH_HOME>/profiles/<profile>/.dsh-rw-plugin.json`（与复用路径同一位置），
> 因此**打包路径部署完的机器天然就是一个「已装插件的复用候选」**，
> 扫描必须能认出它（`~/.dsh/server/dsh/node_modules/.bin/dsh` 这条候选，`nodePath = $DSHHOME/server/node/bin/node`），
> 否则「第二次连接复用第一次的部署」这条最省事的路径会第一次就失败（见 §2.3 的 PATH 坑）。

**两条 marker 并存与优先级（Leader 裁决 2026-10-18）**：

| marker | 谁写 | 谁是权威 |
|---|---|---|
| `<DSH_HOME>/profiles/<profile>/.dsh-rw-plugin.json` | **两条路径都写**（复用与上传） | 记录 profile 本地文件集的 sha256，供扫描判断 `profile.upToDate` |
| `<installHome>/.dsh/server/.components/plugin.json` | 只有上传（打包）路径写 | **`decidePlugin` 的判据**：上传路径的「是否需要重传插件」仍以它为准（`channel.ts:380`） |

- 复用路径没有 `.components/` 树，因此只用 profile-local marker 判定。
- 扫描/探测两处都读；缺失任何一处都不算失败（旧部署没有 profile-local marker）。

**启动命令（复用路径，Leader 裁决 2026-10-18）**：

```
DSH_HOME=<dshHome> PATH="<nodeDir>:<launcherDir>:$PATH" exec <launcher> --profile <profile>
```

- 一律 `PATH` 前缀 + `exec <launcher>`；**不要**写成 `node <launcher>`——实测部署出来的 launcher 是
  `/bin/sh` 包装脚本（末行 `exec node …`），把它当 JS 脚本交给 `node` 跑不起来。
  同一条命令既能启动 `#!/usr/bin/env node` 的 JS 启动器，也能启动 `/bin/sh` shim（实现：
  `profile.ts::reuseServerCommand`）。
- `nodeDir` 取 `candidates[].nodePath` 的目录；**复用部署实例时它就是 `$DSHHOME/server/node/bin`**。
  紧随其后是 launcher 自己的目录（包装脚本里若有 `exec dsh` 也要能找到）。
- `selfContained: true`（无 shebang 的原生启动器）→ **整个 `PATH=` 前缀省略**，只 `exec <launcher>`。
- launcher 依赖 node 但远端没有可用 node（`plan.deployRuntime: true`）→ 先部署我们自己的 Node，
  再照上式启动：`PATH="<installHome>/.dsh/server/node/bin:<launcherDir>:$PATH" exec <launcher> --profile <profile>`
  （**仍然不是** `node <launcher>`）。
- `hello.hash`（远端 server bundle 的 digest）仍由 `connection/index.ts:242-247` 比对，
  复用与打包两条路一致 —— 复用**不会**跳过这场校验（远端插件版本过旧会报
  `install the same dsh-remote-workspace version on the remote host`）。

---

## 10. 错误码总表

| code | status | 出现位置 | 客户端表现 |
|---|---|---|---|
| `forbidden` | 403 | 所有路由 | 错误横幅 |
| `bad-request` | 400 | 参数校验 | 错误横幅（含字段名） |
| `unsupported` | 400 | 非 win32 的 wsl、未知 kind | 卡片本不该出现；出现即报错 |
| `not-found` | 404 | 未知 method / workspaceId / targetId | 错误横幅 |
| `method-error` | 405 | 非 POST | — |
| `storage-unavailable` | 500 | `state`（存储域打不开） | 现有重试逻辑 |
| `scan-failed` | 500 | `dsh-scan` 传输/脚本失败 | 复用卡片显示失败原因 + 建议改用上传 |
| `scan-timeout` | 500 | `dsh-scan` > 60 s | 同上 |
| **`reuse-launcher-missing`（路由层）** | **400** | `connect/start` 的 `packageSource === 'reuse'` 但 `reuseLauncherPath` **缺失/为空**（`connectRequestFrom`，`index.ts:215-218`）。**这是主判据，必须在路由层就拒**，不要留到 `planProvision`。实测 code 字符串为 **`bad-request`**（message 里点名 `reuseLauncherPath`），见下方说明 | 错误横幅「请选择要复用的远端 dsh」（回到第 3 步候选列表） |
| `reuse-launcher-missing`（兜底） | 500（SSE `error` 帧 code） | plan 阶段发现启动器已消失/不可执行（扫描后被删） | 提示重扫 |
| `dsh-incompatible` | 500（SSE `error` 帧 code） | reuse 启动器版本不在区间内 | 提示「远端 dsh 版本不支持」+ 一键改用上传 |
| `reuse-node-missing` | 同上 | node 脚本启动器且我们也没能部署 Node | 提示改用上传 |
| `reuse-boot-failed` | 同上 | 复用启动器 8 s 存活窗口内退出（含插件挂载失败） | 展示 stderr 尾巴 + 建议改用上传 |
| **`realm-unavailable`** | **500** | `open-workspace` / `open-session` 的 realm 守卫（`service.ts:1611/1646/1665`）拒绝：`agentPresets` 不可用、预设未注册、解析出的 id ≠ `remote:<targetId>`、`broken` 有诊断、会话记录非 live、会话建好但 realm 未组合 | 错误横幅，消息含 targetId + 预设 id + 原始原因；**绝不允许**降级成本地执行世界 |
| **`workspace-not-empty`** | **409** | `workspace-delete`（`force` 省略/false）且 server 报 `workspace-not-empty <n>` | 二次确认弹窗：「该工作区还有 N 个会话；强制移除只会删掉清单条目，会话日志保留在远端」→ `force: true` 重试 |
| **`server-protocol-mismatch`** | 500（SSE `error` 帧 / 路由错误） | 握手时 `server.hello` 的 protocol 不是 3（两种方向都可能，见 §14.4） | 提示「远端 server 插件与本机不匹配」：重连（会自动重部署）或改用上传 server 包；**不自动降级** |
| **`cleanup-failed`** | 500 | `cleanup-shell-workspaces` 时官方 registry 不可用 | 错误横幅 + 保留原因（已 scrub） |
| **`invalid-workspace-id`** | 400 | `workspace-rename`/`workspace-delete` 的 `remoteWorkspaceId` 不是 16 hex | 错误横幅（说明「清单可能已变化，请刷新」） |
| `not-connected` | 500 | 会话/工作区操作要求已有通道（含 P0 的 `reg.*` 代理） | 现有行为 |
| `internal` | 500 | 兜底 | 错误横幅 |

> 分两层报错（Leader 2026-10-18 口径）：
> ① **路由层缺参** = HTTP `400`，`error.code = 'bad-request'`（message 点名 `reuseLauncherPath`），
> 同步、先于任何传输；QA 已实测 alpha51 的路由层**没有**透传 `reuseLauncherPath`（回归点见
> acceptance-gap 2a.9，回归测试 `tests/connect-request.test.ts`）；
> ② **执行期**失败（启动器消失 / 版本不兼容 / boot 失败 / node 缺失）= 连接是 200 + SSE 流，
> 失败在流的 `error` 帧里报（现有 `runConnect` 的 `.then(onerror)` 已经这么干），
> 其中「启动器消失」用 `reuse-launcher-missing`。
>
> **实现对齐说明（2026-10-18 冻结前复核）**：路由层的错误码字符串实现为 `bad-request`
> （沿用既有 `RouteError` 约定），`reuse-launcher-missing` 只用于执行期兜底。若 Leader 要求
> 路由层也用 `reuse-launcher-missing`，改 `index.ts:217` 一处即可；本契约以**现实现**为准记录。
>
> `realm-unavailable` 是**同步 HTTP 500**（不是 SSE 帧）：它在会话打开路径上，先于任何通道/会话副作用。
> 语义见 architecture §3.9；QA 用「断开后立刻点会话」复现，要求「报错 + 本机不产生任何文件」。
>
> **附注（远端 RPC 的返回形状，不是 HTTP 路由）**：官方 `sandbox` RPC 的兜底返回值必须是
> **facts 对象** `{ argv, enforcement: 'partial', denialSignatures: [], runnerFailureRules: [] }`，
> **不是裸 argv**；它由 `@deepseek-ai/dsh-sandbox-ssh::confine()` 的 **strict** schema 校验，
> 验证时**不许用 `z.unknown()`**（会把裸数组的 bug 放过去）。详见 architecture §2.8。

---

## 11. 记录 schema 变更（`src/targets/types.ts`）

**存储域版本保持 1**（`store.ts:35`），全部 additive optional：

```ts
/** 服务器包来源；'reuse' 本轮新增，旧记录的 'auto'|'download'|'upload' 原样有效。 */
export const packageSourceSchema = z.enum(['auto', 'download', 'upload', 'reuse'])

export const targetRecordSchema = z.object({
  // ……既有字段全部不动……
  packageSource: packageSourceSchema.optional(),
  /** 用户选中的远端 dsh（复用方式）；下次打开向导预选它。 */
  reuseDsh: z.object({
    path: z.string().min(1),
    version: z.string(),
    nodePath: z.string().min(1).optional(),
    scannedAt: z.string().min(1),
  }).strict().optional(),
  /** 上次探测到的远端架构；**仅提示**，流水线每次都会重新 probe。 */
  platformProbe: z.object({
    platform: z.enum(['linux', 'darwin']),
    arch: z.enum(['x64', 'arm64']),
    libc: z.enum(['', 'gnu', 'musl']),
    tag: z.string().min(1),
    probedAt: z.string().min(1),
  }).strict().optional(),
  /** 上次部署/复用的 server 包（调试与徽标）。 */
  serverPackage: z.object({
    artifact: z.string().min(1),
    sha256: z.string().length(64),
    version: z.string().min(1),
  }).strict().optional(),
}).strict()
```

**三个字段都是 additive optional，存储域版本仍为 1**（`store.ts:35`）。生产约束：

- `reuseDsh` / `platformProbe` / `serverPackage` 由 **`provisionedHints(result, connectedAt)`**
  （`service.ts:1525`）**唯一生产** —— 每次连接成功后一次性写入，避免多个写入点让
  「上次部署的包」与「上次 probe 的架构」互相覆盖。`plan`/`scan` 只读它们作提示。
- `publicTarget()`（`service.ts:1560-1566`）**带出全部三个字段**（`serverPackage` 也要带，
  它是 UI 徽标与排障的唯一来源），且**不含任何凭据字段**（`credentialKey` 永不出线）。
- **`RemoteWorkspaceRecord` 已被 P0 的 `WorkspaceRef` 取代**（见 §15.1）：`path`/`title`/`createdAt`
  不再由本地持有（server 权威）；存储域版本仍为 1，旧字段在 schema 里保留为 optional 供迁移读取。

---

## 12. 两个 Developer 的并行边界

契约冻结在本文档；两人不需要互相等待。

### Developer A — host / provisioning（先合入）

| 文件 | 工作 |
|---|---|
| `src/provision/version-range.ts` | **新建**：§8 的算法 + 单测 |
| `src/provision/dsh-scan.ts` | **新建**：§7.2 脚本（**PATH 前缀含 `$DSHHOME/server/node/bin`、LF 行尾、`TOOL` 记录、nodePath 三级判定**）+ `parseDshScanOutput` + **`assembleCandidates()`**（Leader 2026-10-18 确认的命名；排序见 §2.3）+ 单测 |
| `src/provision/plan.ts` | **新建**：`planProvision()` 纯判定 + 单测（reuse / package / 各种失败码） |
| `src/provision/channel.ts` | reuse 分支：校验启动器、跳过 runtime 与 dsh 包、`upload` 只写 profile+插件、`start` 用复用命令；发出 §3.3 的文案 |
| `src/provision/deploy.ts` | 抽出 `profilePluginScript()` / `profileLockScript()`（复用模式）；`probeScript` 增加读取 `.dsh-rw-plugin.json`（additive 段） |
| `src/provision/profile.ts` | `reuseServerCommand()`；`RemoteFile` 移走后 re-export |
| `src/provision/assets.ts` | `PackageSource` 类型加宽、`resolveServerPackage` 防御 `'reuse'`、`describeLocalPackage()`（读缓存状态给 `dsh-scan` 用） |
| `src/provision/service.ts` | `scanDsh()`、`renameWorkspace()`、`draftFrom(request)` 抽取、`runConnect` 透传 `reuseLauncherPath` |
| `src/index.ts` | 两条新路由（`dsh-scan`、`workspace-rename`）+ 参数校验 |
| `src/targets/types.ts` | §11 schema 增量 + `RemoteFile` 新家 |
| `tests/` | `dsh-scan.test.ts`、`version-range.test.ts`、`plan.test.ts`；扩展 `deploy.test.ts`（新脚本的 `set -eu` / 绝对路径 / 无写操作断言） |

### Developer B — client / UI（可与 A 并行）

| 文件 | 工作 |
|---|---|
| `src/client/api.ts` | §5 的类型 + `dshScan` / `workspaceRename` 两个方法（`ConnectStartRequest` 加两个字段） |
| `src/client/store.ts` | §6：`WizardStep` 三步、`ConnectDraft.connectionMode/reuseLauncherPath`（**`ConnectDraft.packageSource` 退役**）、`DshScanState`、`DirectoryState.open`、`WorkspaceRenameState`；`scanDsh/selectDshCandidate/setConnectionMode/requestWorkspaceRename/acceptWorkspaceRename/openBrowseDirectory`；`done` 帧改落点；删掉 `origin`/`openTargetDirectory`/`retryDirectoryConnect` |
| `src/client/wizard.tsx` | 第 3 步：三张方式卡片（远程下载 disabled）+ 复用候选列表 + 现有进度/日志/host-key；**reuse 失败时渲染「改用上传 server 包并重试」按钮**（只切 `connectionMode='upload'` 重跑，不自动回退）；`DirectoryStep` 搬走 |
| `src/client/directory-picker.tsx` | **新建**：从 `DirectoryStep` 搬来的浏览 UI（面包屑/上级/主目录/路径跳转/新建目录/标题/打开） |
| `src/client/list.tsx` | `AddWorkspaceDialog` **只保留「浏览目录」单页签**（P0 取消「远端已注册」页签：自动登记后它恒为空）；`client/workspace-join.ts` 的 `unaddedServerWorkspaces()` **删除** |
| `src/client/tree.tsx` | 连接行 `delete` 槽文案 → 删除连接；工作区行 `rename` 槽 → 重命名工作区（调 `requestWorkspaceRename`）；挂 `WorkspaceRenameDialog` |
| `src/client/workspace-rename-dialog.tsx` | **新建**：照 `rename-dialog.tsx` |
| `src/client/locales.ts` | 新增/改写的 key（中英都要）：`tree.forgetConnection`→删除连接、`tree.removedConnection`、`connect.mode.*`、`connect.scan.*`、`dsh.*`、`tree.workspace.rename*`、`connect.succeeded.list`、`step.label.connect` |
| `src/client/styles.ts` | 只允许给新卡片/列表加布局类；**不得**自绘行样式 |

### 冻结的契约点（两边都不许单方面改）

1. 路由名与 JSON 形状（§2–§4）。
2. SSE 帧形状（`step`/`host-key`/`done`/`error`）与 `ProvisionStep` 五值集合。
3. 记录字段名与可选性。
4. §3.3 的可 grep 文案（QA 依赖它）。
5. 错误码字符串（§10）。

### 联调顺序

1. A 先合入 `dsh-scan` + `workspace-rename` 两条路由（B 可以先用 `dshScan` 的真实返回开发 UI，
   因为形状已冻结；需要假数据时用 `DshCandidate` 常量，**不要**在 `api.ts` 里加 mock 分支）。
2. B 合入 store + 第 3 步；此时 reuse 可能还跑不通（A 的 `channel.ts` 分支未完成）→
   验收顺序是「上传路径先通，再通复用路径」。
3. 两边都完成后跑 §13 的自测清单，然后交 QA（`doc/acceptance-gap.md` B 节的口径）。

### 已知契约偏差（架构师记录）

| id | 偏差 | 状态 |
|---|---|---|
| **D-1** | 「部署实例排在 PATH 命中之后」+ `DshCandidate.origin` 字段 | **已撤销**（Leader 裁决 (b)，2026-10-18）：部署实例就是最可靠的复用候选，`origin` 是纯展示冗余。现排序 = `compatible && upToDate` → `compatible` → `path`，与现实现一致，**不需要 Developer A 改动** |
| **D-2** | `RemoteRuntimeConfig`/README 可能残留 `packageSource` 字样 | **不开条目**（Leader 2026-10-18）：客户端已核过只剩注释与 wire 字段、无重复控件。README 如仍有旧文案，记为「**README 待清理**」，本轮不改 |
| **D-3** | 新浏览弹窗与 `WorkspaceRenameDialog` 必须各自 `useSingleHost(<kind>)`（`common.tsx:134`）；`AddWorkspaceDialog` 已有（`list.tsx:57`） | 待 B 逐个确认 kind 唯一 |

---

## 13. 自测清单（Developer 提交「实现说明」时必须附）

**A（host）**
- [ ] `pnpm typecheck && pnpm test && pnpm build` 全绿（Windows 17 红为已知）
- [ ] `dsh-scan` 单测：正常输出、截断（无 `END`）、乱码首行抛错、字段数不符丢弃、含 TAB 的路径丢弃、
      **脚本字符串不含 `\r`**（LF 断言）、脚本 `PATH=` 行**含 `$DSHHOME/server/node/bin`**
- [ ] `dsh-scan` 单测：**`TOOL` → `probe.tools` 映射**（`shasum` 也算 `sha256sum`；无记录 = 没有该工具）
- [ ] `dsh-scan` 单测：`#!/bin/sh` 包装脚本 + `$DSHHOME/server/node/bin/node` 存在时
      `nodePath` = 该路径、`selfContained=false`；无 node 可找时 `nodePath` 省略、`selfContained=true`
- [ ] `assembleCandidates()` 单测：排序 = `compatible && upToDate` → `compatible` → `path` 字典序，
      截断到 12 条（**不按部署路径降权**，D-1 已撤销）
- [ ] **路由层回归**：`connect/start` 带 `packageSource: 'reuse'` 但不带/空 `reuseLauncherPath`
      → HTTP `400`（`code: 'bad-request'`，message 点名该字段），且 `connectRequestFrom`
      会把两个字段一起搬进 `ConnectRequest`（`tests/connect-request.test.ts`；QA 实测 alpha51 丢过）
- [ ] `version-range` 单测：`0.2.1-rc.2` 兼容、`0.2.1-rc.10 > 0.2.1-rc.2`、`0.2.0-rc.9` 不兼容、
      **`0.3.0-rc.1` 兼容**、`0.3.0` 不兼容、`0.2.1-rc.1` 不兼容、`0.2.1` 兼容、`garbage` 不兼容、
      `v0.2.1-rc.2`（带 v）兼容
- [ ] `plan` 单测：reuse 命中 / node 缺失需部署 Node / 版本不兼容 / selfContained
- [ ] **手工关键用例**：对一台**已用「上传 server 包」部署过**的远端跑 `dsh-scan`，
      `~/.dsh/server/dsh/node_modules/.bin/dsh` 这条候选必须 `compatible: true` 且
      `version` 非空（不是 `''` / exit 127）——这是 Leader 实测过的回归点
- [ ] 手动：对一台真远端 `POST dsh-scan`，报告候选数与文案；确认远端**没有**新增文件（`find ~ -newer` 前后对比）
- [ ] 打包路径回归：marker 命中时不重传（日志出现 `cached`/`marker 命中`）；
      **两条 marker 并存**：`<profileDir>/.dsh-rw-plugin.json` 与 `.components/plugin.json` 都写到了

**B（client）**
- [ ] 三步 pill 文本 = 1.选择方式 / 2.填写配置 / 3.连接
- [ ] 远程下载卡片 `disabled` 且文案含「第一个 server release」
- [ ] reuse 卡片：扫描中 / 无候选 / 有候选 / host-key 待确认 四种状态都能渲染出文本
- [ ] 候选行显示 路径 / 版本 / 兼容徽标 /「已有 server 插件」徽标（**没有** `origin` 维度，D-1 已撤销）
- [ ] reuse 失败：出现「改用上传 server 包并重试」按钮，点击后 `connectionMode` 变 `upload` 并**重新发起**
      （不得自动切换，也不得静默开始上传）
- [ ] 第 2 步**没有**旧的「服务端包来源」SegmentedControl（`ConnectDraft.packageSource` 已退役，
      第 3 步 `connectionMode` 是唯一入口）
- [ ] 扫描时 host-key 未确认 → 复用同一个确认面板；确认后**不**再弹第二次（`state.trusted` 复用），
      且 pin 只发生在连接成功时
- [ ] 删除连接的确认正文**同时**写明「会删」与「不会删（远端部署物/会话日志）」两块
- [ ] 连接成功后**不**出现添加工作区弹窗；连接节点已展开、toast 引导存在
- [ ] 连接行三动作文本与点击结果（DOM 实测：`data-row-key`、worktree 行数、toast 文本）
- [ ] 添加工作区弹窗两个页签都能打开，浏览页签能进目录并「打开为工作区」
- [ ] 新浏览弹窗 / `WorkspaceRenameDialog` / `AddWorkspaceDialog` 各自 `useSingleHost(<kind>)`：
      左栏 + 面板同时挂载时**只出现一个**弹窗（D-3）
- [ ] 工作区行菜单文本 = 重命名工作区 / 移除工作区；重命名后行文本变化
- [ ] 未连接时点「添加工作区」→ 弹窗里出现连接中状态并最终列出目录（不白屏、不卡死）

**QA（E2E，浏览器 + 远端）**：按 `doc/acceptance-gap.md` B 节 §1–§8 与 **F 节（P0）** 逐条取证；
WSL 目标 = 本机 `Ubuntu-22.04`，SSH 目标 = 真实主机 `graydove@192.168.10.210:22`（密码认证，
登录后是 WSL；别名由 QA 自行加进 `~/.ssh/config`），见 architecture §5 与 acceptance-gap E 节。

---

## 14. 协议 v3：`reg.*` 远端 RPC（逐字契约，P0）

> 这些 RPC 走**协议通道**（不是 HTTP）。`REMOTE_SESSION_PROTOCOL` **2 → 3**。
> 文件归属：`src/protocol.ts`（常量/类型/方法名）+ `src/server/session-store.ts`（实现）
> + `src/server/controller.ts`（分发）。三处都在「两仓逐字节相同」集合内 —— **必须两边同步**。

### 14.0 通用

- 请求/响应都是 JSON；远端 zod 一律 `.strict()`（多字段即拒）。
- **RPC 错误只有 message 字符串**（`SshRpcPeer` 的 `error` 帧没有 code 字段），因此本节用
  **message 前缀**当错误码：客户端按正则匹配，匹配不到就当普通失败。
- 所有 `id` 都是 16 位小写 hex：`sha256(serverId + "\0" + path)` 取前 16 字符
  （`session-store.ts:95-97`）。

### 14.1 `reg.list`（v3 扩展字段，向后兼容）

**Request**（对象，可空）：
```jsonc
{}                                   // 等价于 { "includeActivity": false }
{ "includeActivity": true }          // 额外计算 updatedAt（会读会话日志，按 sizeBytes 记忆化）
```

**Response**（数组，每项）：
```jsonc
[
  {
    "id": "3f9a1c0b7e2d4a68",          // 必填，16 hex
    "path": "/home/u/project",          // 必填，远端绝对路径
    "title": "project",                 // 必填，server 权威标题（reg.rename 改它）
    "createdAt": "2026-10-18T06:00:00.000Z",   // 必填，ISO
    "sessionCount": 5,                  // 必填，>= 0；按 header.cwd === path 统计
    "updatedAt": "2026-10-18T07:12:33.000Z"    // 可选；includeActivity=false 时省略
  }
]
```

- **向后解析**：客户端 zod 写成 `createdAt: z.string().optional()`、`sessionCount: z.number().optional()`、
  `updatedAt: z.string().optional()`；缺字段 → UI 用 `—` / 按 `path` 字典序排序，
  **不得**因此报错或丢弃整项。
- `updatedAt` 语义：该项目内**所有**会话日志最后一条事件的 `time` 的最大值；没有会话时省略。
- 旧 server（v2）忽略 `includeActivity` 并返回缺 `updatedAt` 的项 —— 这正是「向后可解析」的场景。

### 14.2 `reg.rename`（v3 新增）

**Request**
```jsonc
{ "id": "3f9a1c0b7e2d4a68", "title": "后端服务" }
```
- `title`：非空字符串（调用方已用官方 `normalizeSessionTitle` 归一化）。
- **id 与 path 不变**；只改标题。

**Response**
```jsonc
{ "id": "3f9a1c0b7e2d4a68", "title": "后端服务" }
```

**错误（message 前缀）**

| message | 触发 | 客户端映射 |
|---|---|---|
| `invalid-workspace-id "<raw>"` | id 不是 16 hex | 400 `bad-request` |
| `invalid-title` | 归一化后为空 / 非字符串 | 400 `bad-request` |
| `unknown remote workspace "<id>"` | id 合法但清单里没有 | 404 `not-found` |

**实现要点（server 侧）**：远端 `workspaceRegistry` 只保证 `list()`/`create()`
（`session-store.ts:22-25`），因此标题覆盖必须**由 server 自己持久化**：
在 `workspaceIndex`（默认 `~/.dsh/remote-server/workspaces.json`）里写
`{ "<id>": { "title": "...", "updatedAt": "..." } }` 覆盖层；`list()` 时 `title` 取
`覆盖层 ?? registry.title`。这样即使官方 registry 没有 rename API、或 registry 被重建，
改名结果也不丢（架构 A34）。

### 14.3 `reg.delete`（v3 新增）

**Request**
```jsonc
{ "id": "3f9a1c0b7e2d4a68" }                  // force 省略 = false
{ "id": "3f9a1c0b7e2d4a68", "force": true }
```

**Response**
```jsonc
{ "removed": true,  "sessionCount": 5 }        // 删掉了（force 或本来就没有会话）
{ "removed": false, "sessionCount": 0 }        // 幂等：本来就不在清单里
```

**错误（message 前缀）**

| message | 触发 | 客户端映射 |
|---|---|---|
| `workspace-not-empty <count>` | `force` 省略/false 且 `sessionCount > 0` | **409 `workspace-not-empty`** |
| `invalid-workspace-id "<raw>"` | id 不是 16 hex | 400 `bad-request` |

- **未知 id 不报错**：返回 `{ removed: false, sessionCount: 0 }`（删除要幂等，重试安全）。
- **连带语义（A35，本轮落地）**：
  - 只删**清单条目**（registry 条目 + server 覆盖层/索引里的该条）。
  - **绝不删除** `~/.dsh/remote-server-sessions/**` 下的任何会话日志目录。
  - 因此被删工作区的会话成为 orphan；同路径再 `reg.create` 时 `sessionCount` **立即恢复**
    （会话按 `header.cwd` 归属），这就是「删除不动会话日志」的自动化证据。
  - 本轮**不提供** `purgeSessions`；将来若要回收磁盘，必须另加 RPC 并在客户端做二次确认。
- **幂等**：重复删除同一 id 第二次返回 `removed: false`。

### 14.4 `server.hello` / 协议版本

**Request**
```jsonc
{ "protocol": 3, "clientVersion": "0.1.0-alphaNN" }
```

**Response**
```jsonc
{
  "protocol": 3,
  "serverId": "…",
  "installationId": "…",
  "version": "0.1.0-alphaNN",
  "workspacesRoot": "/home/u",
  "home": "/home/u"
}
```

**握手失败（双向，都必须是可读句子）**

| 情形 | server 侧 message | client 侧表现 |
|---|---|---|
| v3 client → v2 server | 旧 server 自己抛 `unsupported remote session protocol 3` | `server-protocol-mismatch`：提示「远端 server 插件过旧，请重连（会自动重部署）或改用上传 server 包」 |
| v2 client → v3 server | `unsupported remote session protocol 2; this server speaks 3 (upgrade the client plugin)` | 旧客户端直接把这句话显示出来 |

- v3 server **必须**先读 `raw.protocol` 的数字再比，**不要**只靠 zod `literal(3)` ——
  否则旧客户端只能看到 `Invalid input: expected 3`（不可行动）。
- 客户端 `openRemoteClient` 的 `server.hello` schema 是 `z.literal(3)`；收到 `2` 时
  **不要**重试成 v2（静默降级会让「改名成功」之类操作变成假的失败/假的成功）。

### 14.5 `reg.create`（不变，v3 语义重申）

**Request** `{ "path": "/home/u/project", "title": "可选" }` →
**Response** 与 `reg.list` 单项同形（含 `id`/`path`/`title`/`createdAt`/`sessionCount: 0`）。
- **幂等**：同 `path` 已存在时返回既有项（不重复创建、不清标题覆盖、**清除 `reg.delete` 的删除标记**）。

---

## 15. 本地数据模型（P0）：`WorkspaceRef`、`/api/state`、迁移

### 15.1 `WorkspaceRef`（替代 `RemoteWorkspaceRecord`）

**存储域版本仍是 1**（`store.ts:35`）；schema 是「旧字段 optional 保留 + 新字段 optional」的并集，
保证旧文档原样通过：

```ts
/**
 * 本地引用：只存「本机材料化 + 视图状态」，不存 path/title（那是 server 的）。
 *
 * **它不决定「有没有这一行」**（Leader 裁决 A43）：host 会在每次 `reg.list` 之后自动登记
 * （server 有、本机无 → 建一条只带 targetId + remoteWorkspaceId 的 ref）与回收
 * （本机有、server 无 → 删 ref）。因此 `stubPath`/`officialWorkspaceId` 在真正打开会话之前**为空**。
 */
export const workspaceRefSchema = z.object({
  id: z.string().min(1),                       // 本地 ref id（`wr-xxxxxxxx`），UI 节点 key
  targetId: z.string().min(1),
  remoteWorkspaceId: z.string().length(16).optional(),  // server 权威 id；迁移前可缺
  stubPath: z.string().min(1).optional(),      // 材料化后才写
  officialWorkspaceId: z.string().min(1).optional(),
  pinnedSessions: z.array(z.string()).optional(),
  archivedSessions: z.array(z.string()).optional(),
  lastOpenedAt: z.string().optional(),
  sessionId: z.string().min(1).optional(),
  // —— 以下三个是**旧记录的遗留字段**，只读不写；迁移成功后清空 ——
  path: z.string().optional(),
  title: z.string().optional(),
  createdAt: z.string().optional(),
}).strict()
```

### 15.2 `/api/state`（P0 形状）

```jsonc
{
  "targets": [ /* PublicTarget[]，见 §5 */ ],
  "workspaceRefs": [ /* WorkspaceRef[]：本机对**全部**已知工作区的材料化/视图状态（含自动登记的） */ ],
  "serverWorkspaces": {            // 只有**在线** target 才有键；离线 target 没有条目
    "rt-1a2b3c4d": [ /* ServerWorkspace[]，= reg.list 的结果，见 §14.1 */ ]
  },
  "pluginVersion": "0.1.0-alphaNN",
  "defaultProfile": "dsh-remote-server",
  "platform": "win32"
}
```

- **`workspaces` 字段退役**（改名为 `workspaceRefs`）；客户端与 host 同版本发布，不需要兼容层。
- **语义（A43）**：`workspaceRefs` **不是**「本机加过的工作区」，而是「本机对这些工作区的
  材料化与视图状态」。行是否存在由 `serverWorkspaces` 决定；ref 只提供
  `stubPath`/`officialWorkspaceId`/`sessionId`/置顶归档/`lastOpenedAt`。
- **新不变量**：对每个**已连接** target，`workspaceRefs` 里 `remoteWorkspaceId` 的集合
  **⊇** `serverWorkspaces[targetId]` 的 `id` 集合（正常情况相等；`reg.list` 失败时保留既有 ref，
  避免列表抖动）。host 在拼 `/api/state` 之前完成自动登记/回收，所以客户端**永远不需要**自己补 ref。
- `serverWorkspaces` 由 host 对每个**已连接** target 调 `reg.list` 拼出；某个 target 的读取失败时
  该键缺省（不要塞空数组——空数组意味着「server 说没有工作区」）。
- **性能约束**：`/api/state` 不得每次轮询都串行打 N 个 `reg.list`。host 侧按 target 缓存该结果
  （写操作 `workspace-rename`/`workspace-delete`/`open-workspace`/`connect` 后失效；或 TTL ≤ 2 s），
  缓存只是同一权威的短期副本，**不得**落盘。

> 旁注：`remote-workspaces` 路由（`reg.list` 直读）**保留**，但 UI 不再有入口（「远端已注册」页签已取消）；
> 它现在是 QA/排障与 host 内部取清单的实现细节。

### 15.3 迁移算法（旧 `RemoteWorkspaceRecord` → `WorkspaceRef`）

1. 启动、存储域打开后（`store.open()` 之后、`ensureWorlds()` 之内）逐条扫描 `workspaceRefs`；
2. 若 `remoteWorkspaceId === undefined` 且 `path !== undefined`：
   - target **未连接** → 跳过（**不**为了迁移去连主机），本进程不再尝试；
   - target 已连接 → 调 `reg.create(path, title)`；
     - 成功 → 写入 `remoteWorkspaceId`，删掉 `path`/`title`/`createdAt`（保留 stub/official/sessionId）；
     - 失败 → `console.warn` 一条（过 `scrubSecrets`），记录原样保留，下次连上再试；
3. **没有单独的收尾步骤**：迁移只是把旧记录翻译成 server id，随后它就和任何 ref 一样由
   §7.1/§15.2 的**自动登记/回收流程**接管（server 有则留存并对齐 id，server 无则删除 ref）；
4. `pinnedSessions`/`archivedSessions` 本来就是远端 sessionId，**不需要搬**，只是键从本地 ref id
   换成 `remoteWorkspaceId`（视图层按新键查找）；
5. 迁移**不**删除 stub 目录、**不**注册官方 shell 条目（那是 §7.4 的清扫/材料化职责）。

### 15.4 客户端 `api.ts` 增补（B 照抄）

```ts
/** server 权威的工作区清单项（= reg.list 单项）。 */
export interface ServerWorkspace {
  id: string
  path: string
  title: string
  createdAt?: string      // 旧 server 可能缺
  sessionCount?: number   // 旧 server 可能缺
  updatedAt?: string      // 仅 includeActivity=true 时存在
}

/** 本地引用（不含 path/title）。 */
export interface WorkspaceRef {
  id: string
  targetId: string
  remoteWorkspaceId?: string
  stubPath?: string
  officialWorkspaceId?: string
  pinnedSessions?: string[]
  archivedSessions?: string[]
  lastOpenedAt?: string
  sessionId?: string
}

export interface StateResult {
  targets: PublicTarget[]
  workspaceRefs: WorkspaceRef[]
  serverWorkspaces: Record<string, ServerWorkspace[]>
  pluginVersion: string
  defaultProfile: string
  platform?: string
}
```

`api` 对象增补：

```ts
workspaceRename(targetId: string, remoteWorkspaceId: string, title: string): Promise<{ workspace: ServerWorkspace }>
workspaceDelete(targetId: string, remoteWorkspaceId: string, force?: boolean):
  Promise<{ removed: boolean; sessionCount: number; refsDropped: string[] }>
cleanupShellWorkspaces(): Promise<{ removed: string[]; kept: string[] }>
remoteWorkspaces(targetId: string): Promise<{ workspaces: ServerWorkspace[] }>   // 项类型换 ServerWorkspace
```
