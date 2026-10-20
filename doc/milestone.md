# 里程碑与路线图

本文件记录"接下来做什么"和"为什么不做什么"。实现细节在 `doc/architecture.md` 与
`doc/api-contract.md`，开发契约在 `AGENTS.md`，用户文档在 `README.md`。

## 1. 当前状态

已交付（细节见 README 的 Feature breakdown）：

- 远端执行世界：每个 target 一个 isolate realm，官方 fs / subprocess / terminal / sandbox provider 指向远端；
  realm 未挂载时会话拒绝运行，不静默回落本地。
- 会话与工作区以 server 为权威：JSONL 落在目标机，重命名只追加 `session/title`，分叉保留继承事件。
- 部署三条路径：复用已验证的远端 `dsh`、本机构建后上传、下载对应架构的运行时包并校验 checksum。
- Host key 首次展示 SHA-256 并显式确认，之后指纹变化即中止；WSL 目标没有 host key 环节。
- 远端沙箱遵守官方 facts 契约，无 backend 时报 partial enforcement。
- 版本契约：`engines.dsh` 与全部 dsh peer 精确钉在唯一已验证运行时；门禁是集合成员判定。

验证范围：DSH `0.2.1-rc.2`；运行时包覆盖 `linux-x64-gnu`、`linux-arm64-gnu`、`darwin-x64`、`darwin-arm64`。

## 2. 版本策略

- 仓库版本 = 发布版本；临时部署后缀只在本机，永不提交、推送、打 tag 或发布（见 AGENTS）。
- 兼容性是**已验证运行时集合**，不是区间。区间会替未发布的版本担保，也会放进集合中间的未验证预发布。
- 扩窗是一次发布动作，顺序固定：
  1. `node scripts/bump-dsh-version.mjs --to <运行时版本>`（改 `engines.dsh`、全部 dsh peer/dev、
     `DSH_VERIFIED_RUNTIMES`、两份 README 的兼容行）；
  2. `pnpm install && pnpm typecheck && pnpm test && pnpm build`；
  3. 对真实 target 跑一遍连接、工作区、会话、重启与断开重连；
  4. 两个仓库同版本提交，再发插件与运行时包。
- `scripts/bump-dsh-version.mjs --check` 在本地与 CI 中都跑；`tests/release-contract.test.ts` 守住声明、
  集合、README 与 server bundle 默认值的一致性。

## 3. 里程碑

| ID | 主题 | 交付物 | 验收 | 依赖 |
| --- | --- | --- | --- | --- |
| M1 | 版本号规范化与发布通道 | `0.1.0-alpha.1`；集合门禁；契约测试；CI；tag 触发的 release 工作流；npm 首发 | `pnpm typecheck/test/build` 绿；`bump --check` 绿；tag 与 `package.json` 一致；npm 安装后临时 profile 能加载 | — |
| M2 | 端口转发 | 每个 target 的 local forward 表；断开即关闭；字节遥测 | 远端 dev server 能在本机预览；断线后无残留监听 | M1 |
| M3 | ProxyJump | 真正使用 `~/.ssh/config` 的 `proxyJump`；跳板机同样 pin 指纹 | 两跳连接可用；跳板机指纹变更即中止（负向测试） | M1 |
| M4 | 侧栏终端面板 | xterm + PTY + resize + 每会话 shell 缓存 | 复用 server 已有 terminal 通道；断线语义与 `realm-unavailable` 一致 | M1 |
| M5 | 写后校验与原生 Windows 远端 | 写入后 sha256 比对；Windows 远端四段式探测，探测失败即拒绝 | 弱网大文件不静默损坏；Windows 拒绝时错误可读 | M1 |
| M6 | 运维面 | docker/compose、service、env、diagnose、cluster | 全部实现在远端 server 侧；不在 client 侧新增第二套 SSH 栈 | M1 |
| M7 | 社区分发 | npm 后续版本、两仓 `dsh-plugin` topic、marketplace 展示、CI 发布 provenance | 一行安装可用；release 由工作流产生 | M1 |
| M0 | 卫生项 | 旧 tag/Release 清理（见 §6）、server `AGENTS.md` 过期章节、macOS realpath 四条既有红测 | 逐项关闭 | — |

## 4. 被否决的候选

- **lite 模式（远端不装运行时，进程内路由）**：官方 `dsh-ssh` + `fs-ssh` 已覆盖单机场景；自建会分裂出
  两套路径语义与两套安全边界。
- **semver 区间兼容**：已否决两次。未发布版本无法担保；区间会放进未验证的中间版本；两层门禁
  （DSH 的精确 `engines.dsh` 与客户端的区间）会先放行再失败。
- **在 client 侧再写一套 SSH 客户端做运维工具**：会造成工具层有校验、HTTP 层没有的两套边界。
- **无 checksum 的自动更新**：更新通道必须是同源校验，否则等于远程代码执行。
- **自建凭据加密**：落盘格式属于上游凭据存储（`~/.dsh/.credentials.yaml`），本插件只引用记录、保证不泄漏。
- **`server.hello` 增加 runtime 版本字段**：要动协议 v4 与两仓逐字节同步，本轮收益不抵成本。

## 5. 竞品吸收清单

| 来源 | 吸收 | 不吸收 |
| --- | --- | --- |
| `GooDAnDReaDY/dsh-remote-workspace` | 端口转发与遥测、`~/.ssh/config` 导入、docker/service/env/diagnose/cluster 的运维面 | 工具式远端遥控（官方工具仍指本机）、client 侧第二套 SSH 栈、无 host key 校验 |
| `januory/dsh-remote-workspaces` | 写后 sha256 校验、原生 Windows 远端探测、空 anchor 思路、「路由失败必须拒绝而非回落」的断言风格 | 全局单例 provider 替换（无每 target 隔离）、远端命令默认全拒+全放行策略 |

## 6. M1 执行记录

- 版本号从 `0.1.0-alpha1` 规范为 `0.1.0-alpha.1`（两仓一致，含 `lib/` 构建产物与 `src/server/index.ts` 默认值）。
- 门禁由区间改为 `DSH_VERIFIED_RUNTIMES` 成员判定；`doc/api-contract.md §8` 记录推翻 2026-10-18 区间裁决的理由。
- client 仓首次引入 CI 与 tag 触发的 release 工作流；server 仓 release 工作流接受插件版本 tag。
- 发布后清理：client 仓 `v0.1.0-alpha1`、`server-v0.2.1-rc.2` 两个 tag；server 仓 `server-v0.2.1-rc.2`
  的 tag 与 Release（其运行时包改由 `v0.1.0-alpha.1` 提供，客户端按 `server-v<dsh>` → `v<plugin>` 回退查找）。
- npm：`dsh-remote-workspace@0.1.0-alpha.1` 发布到 registry.npmjs.org，`alpha` 与 `latest` 双 tag。
- 2026-10-20 发布结果核对：
  - client tag/Release `0.1.0-alpha.1`，资产 `dsh-remote-workspace-0.1.0-alpha.1.tgz` + `.sha256`，标记 prerelease。
  - server tag/Release `v0.1.0-alpha.1`，12 个资产（四平台 `.tar.gz` + `.sha256` + `.manifest.json`）；
    manifest 的 `sha256` 与同名 `.sha256` 逐个一致。
  - 清理后回退键实测：`server-v0.2.1-rc.2` 的资源 URL 返回 404，`v0.1.0-alpha.1` 返回 200。
  - npm 发布物 14 个文件（`lib/` + `cordis.patch.yml` + 两份 README + LICENSE + package.json），
    不含 `src/`、`tests/`、`doc/`、`node_modules/`；`npm view` 的 readme 已是新 README。
  - npm 上还留着占位版本 `0.0.0-stage`（staged publishing 给新包占名用的 stub，`latest` 已指向正式版本）；
    要清掉需在浏览器完成 2FA 的 `npm unpublish dsh-remote-workspace@0.0.0-stage --force`。
- 测试：client 353 通过、4 红（`tests/workspace-refs.test.ts` 的 macOS `/var` 与 `/private/var` realpath
  环境差异，见 AGENTS）；server 6/6。
- 尚未做：在真实 DSH web profile 里用 npm 版本替换本机 tarball 安装，并走一遍连接/会话/断线重连验收。
