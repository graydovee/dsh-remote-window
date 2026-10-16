# AGENTS.md — dsh-remote-workspace（client 半边）

DSH（DeepSeek Harness）客户端插件：把一台 SSH 主机接入为远程工作区。
**会话权威存储在远端**（官方 JSONL 格式），本地只保留 agent loop、模型请求与凭据。
本插件拥有：SSH 连接与 host-key 校验、目标凭据、连接状态、远端工作区发现、
`RemotePersistence`、远端部署（provisioning）以及浏览器侧树形/对话 UI。

## 必读文档

- `../backup/legacy-project/REFACTOR-BRIEF.md` — 重构唯一权威交底（Remote Session
  架构 v6）：目标形态、协议规范、里程碑 P0–P5、官方 API 文件:行号索引。
- `../backup/legacy-project/PLAN.md` — 旧单仓库的 d1–d12 偏差记录（实测机制：
  server bundle 为何自包含、为何要 keep-alive、mux 宽容规则等），仍然全部有效。
- `docs/remote-session-agent-note.md` — Remote Session 设计要点。
- 兄弟项目：`../dsh-remote-workspace-server`（远端 server 插件，见其 AGENTS.md）。

## 命令

```bash
pnpm install
pnpm typecheck    # tsc --noEmit（无 lint 配置）
pnpm test         # vitest run
pnpm build        # tsdown → lib/（三个 target，见下）
# 真实 profile 冒烟（需要已安装的 dsh 启动器）：
DSH_SMOKE_CLI=<path-to-dsh> npx vitest run tests/profile.smoke.test.ts
# 预打包 server 发行物（矩阵：自带 Node + dsh + 插件，CI 同款）：
node scripts/build-server-package.mjs --all --dsh-version <ver>
```

Node ≥ 22.19（或 ≥ 24）；只用 pnpm。`lib/` 是构建产物，不要手改。

## 与 server 项目的同步契约（最重要的规则）

`src/protocol.ts`、`src/server/`、`src/frame/` 三处与
`../dsh-remote-workspace-server` 里的同名文件**逐字节相同**（已验证）。改任何一处
必须两边同步改。原因：client 的 provisioner 部署的是**自己构建的**
`lib/server.js`（来自 `src/server/` 副本），而 conformance 测试也用副本在内存里
跑；server 项目是这段代码的正式归宿与发行包来源。`src/protocol.ts` 头部注释即此
约定：协议版本 2（`REMOTE_SESSION_PROTOCOL = 2`；官方执行世界 RPC 仍是 v1）。

## 架构：tsdown 三个 target（`tsdown.config.mjs`）

1. **host**（ESM/node）：`index`（插件主行）、`connection`（preset realm 内的
   `ctx.ssh` 实现）、`rsession`（`RemotePersistence`）、`protocol`。
2. **server**（`src/server/index.ts`）：远端执行世界 bundle。**自包含**——只
   external `@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery`；DSH 运行时模块
   拦截只解析裸包名、不解析子路径导出，故 `@deepseek-ai/dsh-ssh/protocol|/schemas`
   与 zod 全部内联（PLAN d2）。
3. **client**（浏览器，CJS 工厂，经 `window.__ModuleLoader__.load` 注册）：只允许
   平台模块表 external；**纯度门禁**会让 Node 内置物或跨插件值导入直接构建失败
   ——跨插件协作走 cordis 服务，不走值导入。CSS 运行时注入单个
   `<style data-plugin="dsh-remote-workspace">`（`src/client/styles.ts`）；文案走
   插件自带字典 `src/client/locales.ts`。

目录速览：`src/rsession/`（`RemotePersistence extends` 官方 `SessionPersistence`，
把 create/open/flush/stat/list 映射到 `persist.*` RPC，写路径缓冲、close/turn 边界
flush）；`src/preset/world.ts`（每目标 `isolate` realm preset——realm 覆盖
`ssh/fs/subprocess/sandbox/shell`）；`src/provision/`（profile 生成 + 部署：远端
profile patch 挂官方执行 provider、`remote-session-persistence`（官方 JSONL 后端）
与 `dsh-remote-workspace/server` 行；远端固定安装根 `~/.dsh/server`，一律
`/bin/sh -c` + 绝对路径，不依赖远端 PATH/登录 shell/系统 npm，PLAN d11）；
`src/ssh/` + `src/ssh-config.ts`（ssh2 连接、host-key 校验、`~/.ssh/config` 解析）；
`src/targets/`（目标存储与 `scrubSecrets`）。

## 不变量 — 不要破坏

- **凭据不过线**：SSH 凭据、模型 API key 只在本地；错误与日志一律过
  `scrubSecrets`（`src/targets/types.ts`）。
- **host key**：未知指纹必须显式确认（SHA-256 展示），已变更的 key 一律中止
  （`src/ssh/hostkey.ts`）。
- **信任栅栏**：所有插件 HTTP 路由必须过 `trustedRequest`（`src/index.ts`，DNS
  rebinding + 跨站防护）；JSON body 1 MiB 上限；API 方法名允许含斜杠
  （`connect/start`），不要加斜杠守卫。
- **零 patch**：不改官方 cordis.patch.yml 任何已有行，不替换全局服务，不碰
  `sidebar.workspaces` 槽；官方「添加工作区」按钮行为不变。
- **连接行必须惰性**（`src/connection/index.ts`）：preset 挂载失败是粘滞且永久的，
  不可达主机不得在构造时发起连接。
- **存储域版本恒为 1**：新字段只能 additive optional，bump 即砖（单文件布局无迁移）。
- **mux 宽容规则**（PLAN d6）：未知流的 `CREDIT/END/ABORT/OPEN_OK/OPEN_FAIL`
  忽略（迟到消息），仅未知流 `DATA` 是致命帧失步。
- **client bundle 重装必须 bump `package.json` version**：插件批量 URL 带
  `&rev=<hash>`，不 bump 浏览器吃旧缓存。

## 编码规约

- TS strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` +
  `allowImportingTsExtensions`：相对导入带 `.ts` 后缀；type-only 用 `import type`。
- 可选 wire 字段沿用条件展开惯用法 `...(x === undefined ? {} : { x })`。
- 注释解释**实测约束**而非显而易见的事；适用时注明对应的 PLAN 偏差编号。
- peer 依赖区间是 `>=0.2.0-rc.1 <0.3.0`；`dsh-plugin-dev check --strict` 的
  `manifest-peers` 失败是已记录偏差，不要靠降区间去"修"。
- 浏览器 UI 验收不在本会话里自己开浏览器点：发验证简报给子代理，单标签约束。

## 测试层（tests/）

`conformance`（官方 `dsh-fs-ssh`/`dsh-subprocess-ssh`/`dsh-sandbox-ssh` provider
对着 `src/server` 副本在内存传输上跑）；`frame`（分帧/多路复用/流控/TLS-PSK）；
`ssh-config`（`~/.ssh/config` 解析与 `ssh -G` 预填）；`deploy`；`remote-persistence`
（官方 handle 生命周期 → `persist.*` RPC 映射）；`profile.smoke`（真实 profile
经 dsh CLI 于 stdio 上说协议）。

## 会话持久层的路由接线（实测，2026-10-16）

远程工作区的会话是**远端权威**：本插件在 `apply()` 里构造 `RoutingSessionPersistence`
（`src/session-persistence/routing.ts`）并 provide 为 `sessionPersistence`，按会话 cwd
路由——本地 cwd 委托内嵌的官方 JSONL 后端（root 仍是 `~/.dsh/sessions`，本地会话行为
逐字节不变），远程 stub cwd 走远端 `persist.*` 平面。

四条**实测约束**（踩过的坑，改这里之前先读）：

1. **官方行 id 是 `session-persistence-jsonl`（dsh-base 层），不是 `sessions`**
   （后者属于 dsh-sdk-minimal 层，web profile 里不存在）。覆盖 `sessions`
   会打印 `entry "sessions" not found` 并静默无效。
2. **patch 覆盖不能换 `name`**：loader 对 override 有 `name mismatch` 守卫，只允许改
   config；因此"替换类"必须写成 `disabled: true`（禁用官方行）+ 在我们自己的
   `apply()` 里 provide（不能靠 patch `insert` 一行——实测该行从不被构造）。
3. **`inject` 里不能写 `workspaceRegistry`**：`dsh-workspace` 消费
   `sessionPersistence`，而本插件提供它——声明这条边会让两边互相等待，启动时
   7 个 entry 永久 pending。注册表一律用 `ctx.get('workspaceRegistry')` 懒解析
   （注意：无 inject 时属性访问 `ctx.workspaceRegistry` 会抛
   `cannot get property "workspaceRegistry" without inject`）。
4. **任何 `extends SessionPersistence` 的内部实例都必须用 stub context 构造**
   （`Reflect.construct(Klass, [registrationAbsorbingContext(), ...])`）：基类构造函数
   会 `provide('sessionPersistence')`，在根上下文二次注册直接抛
   `service "sessionPersistence" has been registered at <...>`。

验证口径：远端 `~/.dsh/remote-server-sessions/<projectKey(远端路径)>/<sessionId>/`，
本地 `~/.dsh/sessions/` 不应出现该会话。

## 重构中间态（2026-10-15）

v6 重构尚未完成：协议 v2、server 侧 `RemoteSessionStore`、client 侧
`RemotePersistence` 与 profile patch（`remote-session-persistence` 行）已落地；
**P2 的 realm 接线**（preset 内 provide `sessionPersistence` 使 agent loop 直写
远端——含 cordis 子上下文 shadow 语义实测）、**P4/P5 的树形面板/自绘对话 UI** 还
没做，`src/index.ts` 的 API 面仍是向导时代的方法集。动手前对照 REFACTOR-BRIEF §6
与 §9 的验收标准。两个项目均已 `git init` 但尚无基线提交（P0 要求先提交再动刀）。
