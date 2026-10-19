# dsh-remote-workspace

[English](README.md) | 中文

把一台 SSH 主机接入为 DeepSeek Harness 工作区。agent loop、模型请求与凭据留在本机；文件、
命令与**会话日志**都在远端主机上，因此换一台机器也能接着聊。

## Requirements

| 位置 | 需要 |
| --- | --- |
| 你的机器 | DeepSeek Harness **`0.2.1-rc.2`**，使用 `web` profile；Node `^22.19.0 \|\| >=24.0.0` |
| 远端主机 | 可达的 sshd 与 POSIX shell（`/bin/sh`、`tar`、`chmod`、可写 `$HOME`）。不需要 Node、npm 或 dsh |
| Windows | 只支持 WSL 目标；被选中的发行版就是远端一侧 |

请配合 `dsh web` 使用。桌面应用没有本插件依赖的 SSH 包，所以装进 `web` profile，不要装进
desktop profile。

## Install

```bash
pnpm install
pnpm build
pnpm pack --pack-destination ~/.dsh/tarballs

dsh plugin --profile web add ~/.dsh/tarballs/dsh-remote-workspace-<version>.tgz
```

然后重启提供界面的进程，刷新页面。

如果改用 git 安装，构建发生在安装时，需要在 profile 的 `pnpm-workspace.yaml` 里放行：

```yaml
allowBuilds:
  dsh-remote-workspace: true
```

## Connect a host

左侧栏 → **远程工作区** → **＋新建连接**。

1. **选择方式** —— `SSH`（远程主机），或 `WSL`（本机 Windows 上的发行版）。
2. **填写配置** —— 别名（必填）、主机、端口、用户名，以及凭据（SSH Agent / 私钥 / 密码；
   凭据只发送一次，不写入列表）。**高级：远端运行时** 只在远端默认值不适用时才需要动。
3. **连接** —— 选择远端运行时的来源，然后确认主机指纹：
   - **复用机器上的 dsh** —— 直接用远端已安装的那一份（不上传）；
   - **上传 server 包** —— 按远端架构上传运行时；
   - **远程下载** —— 从 GitHub 取对应架构的 release。

   首次连接会显示主机 SHA-256 指纹并等待 **信任并继续**；之后指纹变化会中止连接。失败时
   连接日志会留在页面上。

## Use it

在连接行点 **＋**（或 **⋮ → 添加工作区**），选一个远端目录。工作区行会列出会话；点空白行
新建，点已有会话行继续。

| 动作 | 位置 | 作用 |
| --- | --- | --- |
| 连接 / 重新连接 / 断开 | 连接行 `⋮` 或插头图标 | 打开或关闭远端通道 |
| 添加工作区 | 连接行 `＋` | 把一个远端目录登记到 server |
| 新会话 | 工作区行 `＋` 或空白行 | 新建会话 |
| 打开 / 继续 | 点会话行 | 从远端日志续聊 |
| 置顶 / 归档 / 重命名 / 分叉 | 会话行 `⋮` | 排序、视觉状态、真实的 `session/title` 事件，或一个分叉会话——都记录在远端 |
| 移除工作区 | 工作区行 `⋮` | 只删清单条目，远端会话日志保留 |
| 刷新 | 区域标题 | 重新读取工作区与会话 |
| 删除连接 | 连接行 `⋮` | 忘掉本机记录与凭据；远端运行时与日志不动 |

## Where your data lives

| 位置 | 内容 |
| --- | --- |
| 远端 `~/.dsh/remote-server-sessions/` | 会话日志——唯一权威副本 |
| 远端 `~/.dsh/server/` | 本插件部署到那里的运行时 |
| 本机目标存储 | 连接、工作区、置顶/归档状态 |
| 本机 `~/.dsh/remote-assets/` | 运行时包缓存 |

SSH 凭据与模型 API key 从不离开你的机器。未知 host key 必须确认，指纹变化即中止，报错信息
会先移除敏感内容。

## Troubleshooting

| 症状 | 处理 |
| --- | --- |
| 安装或启动被拒，报 `incompatible-version` | 你的 DSH 不是 `0.2.1-rc.2`。装回该版本，或看 [Compatibility](#compatibility) |
| 侧栏没有 **远程工作区** | 插件没有挂载：确认用的是 `web` profile，并重启提供界面的进程 |
| 刚打开就显示「该 server 上还没有工作区」 | 工作区清单还在加载，点 刷新 |
| 命令报 `no sandbox backend is usable` | 远端没有可用的沙箱后端，命令会在那里原样执行——这是设计行为 |
| 连接立刻失败 | 看向导里的连接日志；用同一账号试 `ssh -v <host>`，检查私钥口令或 agent |
| 报 `unsupported remote session protocol` | 客户端与远端运行时版本不一致；重新连接，让插件重新部署它的 server |

## Compatibility

本插件只支持**一个** DeepSeek Harness 版本：**`0.2.1-rc.2`**（`engines.dsh`）。更新的
`0.2.x` 未经验证，安装器与加载器会在执行任何东西之前拒绝它。确实想试别的版本时：

```bash
dsh plugin --profile web allow-version dsh-remote-workspace@<已安装版本> \
  --dsh-version <你的 DSH 版本> --accept-risk
```

这种组合不受支持。运行时包发布 `linux-x64`、`linux-arm64`、`darwin-x64`、`darwin-arm64`；
Windows 只能作为 WSL 目标使用。

## Contributing

要改这个仓库，请先读 [AGENTS.md](AGENTS.md)：源码结构、硬约束、发布规则与验收流程都在那里。
使用者不需要它。

## License

MIT
