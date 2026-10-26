# DSH 0.2.1-rc.3 兼容性记录

> 日期：2026-10-26  
> 目标：把当前 v2 插件从 DSH `0.2.1-rc.2` 迁到 `0.2.1-rc.3`，并确认消费到的 host /
> 官方 UI / server API 没有破坏性变化。  
> 结论：**核心路径通过 rc.3 冒烟**；完整 SSH 端到端与全量视觉回归仍需在目标机重跑。

## 1. 变更点

| 位置 | 变更 |
|---|---|
| `package.json` | `engines.dsh`、全部 `@deepseek-ai/dsh-*` peer/dependency 从 rc.2 精确改为 `0.2.1-rc.3`；zod 仍 `4.4.3` |
| `src/provision/version-range.ts` | `DSH_VERIFIED_RUNTIMES` 改为只接受 `['0.2.1-rc.3']`，不保留 rc.2 区间 |
| `README.md` / `README-zh.md` | 兼容表与徽章改为 rc.3，并写明 rc.2 已不在默认已验证集合 |
| server 仓库 `package.json` | `engines.dsh` 与全部 dsh peer/dependency 精确改为 rc.3 |
| server 仓库 `src/server-plugin/index.ts` | `DSH_VERIFIED_RUNTIME = '0.2.1-rc.3'`，handshake 回报 rc.3 |
| `AGENTS.md` / `doc/refactor-v1-*.md` / `doc/official-workspace-reuse.md` | 权威基线改为 rc.3；标注 rc.2 的历史实测记录保留为升级前证据 |

`src/client/vendor/workspace-rows/**` 仍 vendor 自 rc.2（commit `687f282e86`）。本次没有重新 vendor：
rc.3 的官方行 DOM/slot 在本轮 UI 冒烟中仍匹配；vendor 内部不读取运行时版本号。重新 vendor 的触发条件
是行 API、`data-slot` 或生成样式变化，而不是 DSH 版本号本身。

## 2. 验证证据

环境：macOS 桌面版 DSH `0.2.1-rc.3`（asar 内 CLI），隔离 `DSH_HOME=/tmp/dsh-rc3-.../home`，不触真实
`~/.dsh`。命令均在 client 仓库根目录执行；server 命令在 sibling 仓库执行。

| 检查 | 命令 | 结果 |
|---|---|---|
| client 类型 | `pnpm typecheck` | 通过 |
| client 单测 | `pnpm test` | 491 passed / 1 skipped，0 failed |
| client 构建 | `pnpm build` | 通过 |
| server 类型 | `pnpm typecheck`（server 仓库） | 通过 |
| server 单测 | `pnpm test`（server 仓库） | 59 passed / 0 failed |
| server 插件包 | `pnpm pack:server-plugin` | `dsh-remote-workspace-server-0.1.0-alpha.3.tgz`，sha256 `76042554e2059ef5fa1b9ac51de5ff09e1426603036fd5dcb3d3bf3179cb3cf1`，manifest `dshVersion=0.2.1-rc.3` |
| client 内置 server tarball | `scripts/bundle-server-plugin.mjs` | 内置 tarball 与 `checksums.json` 的 sha256 一致（当前 `76042554…`） |
| 干净 profile 安装 | `dsh plugin --profile web add <client tgz>` | 依赖安装成功；pnpm 11 报 `ERR_PNPM_IGNORED_BUILDS` 非 0 退出，属已知行为，手工把 `dsh-remote-workspace` 追加进 profile `dsh.profile.bundles` 后启动 |
| host 启动 | `dsh --profile web --host 127.0.0.1 --port <port> --no-open` | 打印 token URL；插件 client bundle 注入，sidebar「远程工作区」渲染 |
| host API | `POST /dsh-remote-workspace/api/state` | `ok:true`，`protocol:1`，`pluginVersion:0.1.0-alpha.3`，`verifiedRuntimes:["0.2.1-rc.3"]` |
| 官方 UI 冒烟 | headless Chrome 打开 token URL | 官方 sidebar/主区正常；点击「新建连接」打开三步向导，SSH 方式卡片、步骤栏、底部按钮均正常；无 iframe |
| client console | Chrome DevTools Protocol 记录 | 无 JS 异常；仅有既有 `/dsh-remote-workspace/stream/state` 404 与对应 warning（见 §4） |

首轮 `pnpm test` 曾出现 1 个失败，唯一断言是 README 必须提到当前已验证运行时；文档更新后复跑通过。
这是版本门禁测试的预期行为，不是运行时回归。

## 3. API 兼容结论

- 对 client 消费的官方 host API（`webServer`、`sessionPersistence`、`workspaceRegistry`、
  `sessionController`、agent/approval 路由）没有出现 TypeScript 断链；rc.3 类型检查、491 个单测和 host
  启动均为绿色。
- plugin protocol 仍为 `1`；host 与 server 插件的握手字段未变，server manifest 只把 `dshVersion` 升到
  rc.3。
- 官方 UI 的 CSS 类名在 rc.3 中仍为 hash/内部实现；插件不依赖这些 class 名，只依赖 `data-slot`、官方
  primitives 和 vendored 行组件，因此类名变化未影响向导/侧栏。
- 未发现 rc.3 对 model prompt/remote working-context 注入点的变化；本轮未改 prompt 内容。

## 4. 已知遗留（不阻塞 rc.3 兼容性）

1. `/dsh-remote-workspace/stream/state` 在 host 端没有注册对应路由；client 仍会打开它，浏览器控制台
   出现 404 和 `state stream closed` warning。`state` RPC、连接/工作区/会话的显式刷新不受影响。这是
   v2 既有遗留（不是 rc.3 引入），实时外部刷新未纳入本轮验收。
2. 本轮冒烟使用**隔离空 home**，没有建立真实 SSH target；连接、注入 server 插件、server/local 双执行端
   的端到端仍需在目标机按 `doc/qa-v2-report.md` 重跑。
3. 官方行的 vendored 源码仍是 rc.2；本轮的视觉冒烟只覆盖 sidebar、主区和连接向导，不代表所有官方行
   状态/菜单的逐像素回归。

## 5. 升级流程（下次 DSH 版本）

1. 用 `node scripts/bump-dsh-version.mjs --to <版本>` 或等价的机械替换更新 `engines.dsh`、全部 dsh
   peer/dependency、`DSH_VERIFIED_RUNTIMES`、两份 README 兼容行。
2. 同步 server 仓库 `package.json`、`DSH_VERIFIED_RUNTIME`、README/AGENTS 的版本声明。
3. `pnpm install`（两仓分别执行），确认 peer 解析没有把旧的精确版本留在 lockfile/node_modules。
4. 两仓 `pnpm typecheck && pnpm test && pnpm build`；server 仓库重新 `pnpm pack:server-plugin`，client
   仓库用 `scripts/bundle-server-plugin.mjs` 更新内置 tarball 与 `assets/server-plugin/checksums.json`。
5. 用隔离 `DSH_HOME` 安装 client 包，跑本文件 §2 的 host/API/UI 冒烟；再按 QA 报告跑真实 target 的
   SSH、连接、工作区、会话、server/local 切换、审批、断连重连。
6. 只有完成 1–5 才更新「已验证」表；未完成的项目在 QA 报告中明确写 PARTIAL，不得只改版本号就宣称
   verified。

## 6. 相关文档

- `doc/refactor-v1-architecture.md`：运行时版本契约、profile、server 插件安装。
- `doc/refactor-v1-protocol.md`：handshake `dshVersion`、server 插件版本要求。
- `doc/official-workspace-reuse.md`：官方行 vendor 与 rc.3 DOM 复核边界。
- `doc/qa-v2-report.md`：v2 端到端验收步骤（历史环境为 rc.2）。
