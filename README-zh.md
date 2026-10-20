# dsh-remote-workspace

[English](README.md) | 中文

`dsh-remote-workspace` 为 DeepSeek Harness 的 **web profile** 增加远程工作区。agent loop、模型
请求和凭据留在本机，文件、命令与会话日志由远端主机负责，因此换一台电脑也能继续同一个会话。

本项目由两个仓库组成：

- [client](https://github.com/graydovee/dsh-remote-workspace)：DSH 插件、浏览器界面、SSH/WSL
  传输和部署逻辑。
- [server](https://github.com/graydovee/dsh-remote-workspace-server)：运行在目标机上的无头 DSH
  插件，提供文件、进程、沙箱桥接和远端会话存储。

通常由 client 自动部署并启动 server。目标机不监听端口，server 通过 SSH 或 WSL 的 stdio 通道
提供带分帧的 RPC 服务。

## 能做什么

- 添加 SSH 主机，或在 Windows 上添加 WSL 发行版。
- 浏览远端目录并登记为工作区。
- 新建、继续、重命名、分叉、置顶和归档会话；会话日志始终留在目标机。
- 在远端执行 DSH 的文件、进程、终端和沙箱操作。
- 复用目标机已有的兼容 `dsh`，或由本机上传/下载对应架构的运行时包。
- 多台客户端共享同一个远端工作区；工作区清单和会话日志以 server 为权威。

## 环境要求

| 位置 | 要求 |
| --- | --- |
| 本机 | DeepSeek Harness `0.2.1-rc.2`、`web` profile、Node `^22.19.0 \|\| >=24.0.0` |
| SSH 目标 | 可达的 `sshd`、POSIX `/bin/sh`、`tar`、`chmod`、可写的 home 目录 |
| WSL 目标 | Windows、`wsl.exe` 和可用的 POSIX 发行版 |
| 网络 | 本机能访问 SSH 目标；下载模式还需要访问 release 地址 |

选择上传或下载模式时，目标机不需要预装 Node、npm 或 DSH；client 会把运行时放到目标机的
`~/.dsh/server/`。Windows 只作为 **WSL 目标的 client 主机**，远端执行世界仍然是 POSIX。

## 安装到 web profile

从源码构建并打包插件：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm pack --pack-destination ~/.dsh/tarballs
dsh plugin --profile web add ~/.dsh/tarballs/dsh-remote-workspace-<version>.tgz
```

重启提供 `dsh web` 界面的进程并刷新页面。请安装到 `web` profile；desktop profile 没有本插件
依赖的浏览器模块表和 SSH 依赖。

如果通过 Git 依赖安装，需要在 profile 的 `pnpm-workspace.yaml` 中允许构建：

```yaml
allowBuilds:
  dsh-remote-workspace: true
```

## 连接目标

在侧栏打开 **远程工作区**，点击 **新建连接**。

1. 选择 `SSH`，或在 Windows 上选择 `WSL`。
2. 填写别名和目标信息。SSH 支持 agent、私钥或密码。密码/私钥口令只用于本机连接并存放在本机
   凭据存储中，不进入工作区记录，也不会交给远端 server 插件。
3. 执行只读探测，选择运行时来源，再连接：

   | 选项 | 行为 |
   | --- | --- |
   | 复用已有 DSH | 校验目标机上已有的兼容启动器，只部署本插件的 profile 文件。 |
   | 上传 server 包 | 在本机构建或复用已校验的目标架构包，上传到目标机并安装到 `~/.dsh/server/`。 |
   | 下载 server 包 | 在本机下载对应架构的 release，并用 `.sha256` 校验后上传到目标机。 |

   SSH 首次连接会显示主机 SHA-256 指纹，必须明确确认；之后指纹变化会中止连接，不会静默接受。
   WSL 是本机进程，没有 host key 确认步骤。

## 使用会话

在连接行点击加号，浏览并添加远端目录。工作区行会显示会话，并提供一个新会话空白行。

| 动作 | 结果 |
| --- | --- |
| 连接 / 重连 / 断开 | 打开或关闭该目标唯一的共享通道。 |
| 添加工作区 | 把目录登记到目标机的 server 工作区清单。 |
| 打开 / 继续 | 从目标机 JSONL 日志恢复会话。 |
| 新会话 | 创建一个事件写入目标机的会话。 |
| 重命名会话 | 不打开会话，直接向远端追加 `session/title` 事件。 |
| 分叉会话 | 使用 shell 的标准分叉操作，并保留继承事件元数据。 |
| 置顶 / 归档 | 保存本机视图状态，不改写远端日志。 |
| 重命名工作区 | 修改 server 侧显示标题，不移动物理目录。 |
| 移除工作区 | 移除清单条目，已有会话日志仍保留在目标机。 |
| 删除连接 | 忘记本机目标信息和凭据，不删除远端文件或日志。 |

每个目标只启动一个 server 进程。浏览与 agent 操作共享同一通道，避免会话句柄分裂和写租约冲突。

## 数据与安全

| 位置 | 内容 |
| --- | --- |
| 目标机 `~/.dsh/remote-server-sessions/` | 权威的远端会话日志 |
| 目标机 `~/.dsh/remote-server/` | server 身份、工作区清单和状态文件 |
| 目标机 `~/.dsh/server/` | 上传的 Node/DSH 运行时和 server bundle |
| 本机 DSH 存储 | 目标记录、工作区引用、置顶/归档视图状态 |
| 本机 `~/.dsh/remote-assets/` | 已校验的 Node 和 server 包缓存 |

模型 API key 与 SSH 凭据只留在本机。HTTP 路由经过同源/可信请求校验并限制 body 大小，错误信息会
清理敏感内容。远端沙箱能力取决于目标机的 backend；没有 backend 时会报告 partial enforcement，
并在远端执行请求的 argv。

## 兼容性与平台边界

当前版本只针对 DSH `0.2.1-rc.2` 验证。client 和 server 包都精确声明该版本，其他版本会在远端
启动前拒绝。运行时 release 目前覆盖 `linux-x64-gnu`、`linux-arm64-gnu`、`darwin-x64`、
`darwin-arm64`。Windows 主机使用 WSL，没有原生 Windows 远端包。

如果确实要测试其他 DSH 版本，请使用 profile 的风险确认命令，并视为不受支持：

```bash
dsh plugin --profile web allow-version dsh-remote-workspace@<已安装版本> \
  --dsh-version <dsh版本> --accept-risk
```

## 排障

| 症状 | 检查 |
| --- | --- |
| `incompatible-version` | 在本机 web profile 安装 DSH `0.2.1-rc.2`。 |
| 没有远程工作区区域 | 确认插件装在 `web`，重启 `dsh web` 并刷新页面。 |
| 刚打开时显示没有工作区 | 等待 server 清单加载后点击刷新。 |
| SSH 在部署前失败 | 检查账号、私钥权限、agent 和指纹；可用 `ssh -v <host>` 辅助排查。 |
| `unsupported remote session protocol` | 重连，让 client 自动部署匹配的 server bundle。 |
| 报没有可用沙箱 backend | 目标机没有隔离 backend，这是文档化的 partial enforcement 路径。 |
| 复用启动器被拒绝 | 选择 `--version` 兼容的 DSH，或改用“上传 server 包”。 |

## 开发

修改代码前请阅读 [AGENTS.md](AGENTS.md)。其中定义 client/server 的逐字节同步契约、存储与安全
不变量、构建目标、测试矩阵和发布流程。server 仓库也有自己的
[README](https://github.com/graydovee/dsh-remote-workspace-server) 和
[AGENTS.md](https://github.com/graydovee/dsh-remote-workspace-server/blob/main/AGENTS.md)。

## License

MIT
