window.__ModuleLoader__.load({
	id: "dsh-remote-workspace",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react_dom_client = require("react-dom/client");
		//#region src/client/locales.ts
		/**
		* Localization for the remote-workspace browser half.
		*
		* The official `@deepseek-ai/dsh-client-locale` package is injectable but
		* NOT required for v1: this plugin owns a small `zh`/`en` dictionary and a
		* module-level {@link t} helper whose default language is `zh` (the product's
		* primary UI language). Every user-visible string in `src/client/**` goes
		* through this map — no literal copy inside components.
		*
		* `en` is typed as `Record<LocaleKey, string>`, so a missing or extra
		* translation is a compile error.
		*/
		/** Simplified Chinese dictionary — the default and source of truth for keys. */
		const zh$1 = {
			"app.name": "远程连接",
			"app.tagline": "把远端目录作为 DeepSeek Harness 工作区打开",
			"common.back": "返回",
			"common.cancel": "取消",
			"common.close": "关闭",
			"common.refresh": "刷新",
			"common.retry": "重试",
			"common.loading": "加载中…",
			"common.unknown": "未知",
			"common.file": "文件",
			"common.directory": "目录",
			"step.label.method": "选择方式",
			"step.label.config": "填写配置",
			"step.label.connect": "连接",
			"step.counter": "第 {current} / {total} 步",
			"step.goBackTo": "返回「{label}」",
			"wizard.steps.aria": "连接步骤",
			"list.title": "远程连接",
			"list.description": "已保存 {targets} 台主机、{workspaces} 个远程工作区。",
			"list.newConnection": "新建连接",
			"list.targets": "已保存的主机",
			"list.targets.empty": "还没有保存的主机。点击「新建连接」开始。",
			"list.workspaces": "远程工作区",
			"list.workspaces.empty": "还没有远程工作区。",
			"list.kind.ssh": "SSH",
			"list.endpoint": "{username}@{host}:{port}",
			"list.endpoint.wsl": "WSL · {distro}",
			"list.status.unknown": "未连接",
			"list.status.ready": "已连接",
			"list.status.failed": "连接失败",
			"list.status.stopped": "已停止",
			"list.openDirectory": "打开目录",
			"list.addWorkspace": "添加工作区",
			"list.reconnect": "重新连接",
			"list.open": "打开",
			"list.stop": "停止",
			"list.forget": "删除",
			"list.lastError": "上次错误：{message}",
			"list.lastConnectedAt": "上次连接：{time}",
			"list.workspacePath": "路径",
			"list.workspaceCreatedAt": "创建于 {time}",
			"list.workspaceTarget": "主机：{label}",
			"list.missingTarget": "（主机已删除）",
			"list.forgotTarget": "已删除连接「{label}」",
			"list.forgotWorkspace": "已忘记工作区「{title}」",
			"list.stopped": "已停止主机「{label}」",
			"list.stopUnsupported": "主机「{label}」当前没有可停止的会话",
			"list.meta": "插件 v{version} · 默认 profile：{profile}",
			"list.meta.unknown": "插件版本未知",
			"list.loading": "正在读取已保存的远程项…",
			"list.loadFailed": "读取已保存的远程项失败",
			"tree.title": "远程工作区",
			"tree.sidebar.title": "远程工作区",
			"tree.sidebar.empty": "还没有连接。点击右上角 + 新建连接。",
			"tree.empty": "还没有连接。点击「新建连接」开始。",
			"tree.hint": "连接 → 工作区 → 会话；会话日志保存在远端，换设备也能继续。",
			"tree.expand": "展开",
			"tree.collapse": "收起",
			"tree.conn.connected": "已连接",
			"tree.conn.connectedNotice": "已连接主机「{label}」",
			"tree.conn.disconnected": "未连接",
			"tree.conn.failed": "连接失败",
			"tree.conn.connect": "连接",
			"tree.conn.reconnect": "重新连接",
			"tree.conn.disconnect": "断开",
			"tree.conn.addWorkspace": "添加工作区",
			"tree.conn.noWorkspace": "还没有工作区，点击「添加工作区」。",
			"tree.workspace.open": "打开",
			"tree.workspace.newSession": "新会话",
			"tree.workspace.forget": "移除工作区",
			"tree.workspace.sessions": "{count} 个会话",
			"tree.sessions.loading": "正在读取远端会话…",
			"tree.sessions.empty": "远端还没有会话",
			"tree.sessions.failed": "读取远端会话失败：{message}",
			"tree.session.continue": "继续",
			"tree.session.opened": "已打开会话「{title}」",
			"tree.session.fallback": "无法继续上次会话（{message}），已新建会话",
			"tree.session.createdAt": "{time}",
			"tree.session.size": "{size}",
			"tree.verb.failed": "{action}失败：{message}",
			"tree.session.pinned": "已置顶会话",
			"tree.session.unpinned": "已取消置顶",
			"tree.session.archived": "已归档会话",
			"tree.session.unarchived": "已取消归档",
			"tree.session.forked": "已分叉会话",
			"tree.session.renamed": "已重命名会话",
			"tree.session.archivedNotOpenable": "该会话已归档，请先取消归档",
			"tree.session.renameFailed": "重命名失败：{message}",
			"tree.session.openFailed": "打开会话失败：{message}",
			"tree.session.revealFailed": "会话已在远端打开，但主页无法显示它：{message}",
			"tree.forgetConnection": "删除连接",
			"tree.forget.confirm.title": "删除这个连接？",
			"tree.forget.confirm.message": "将删除「{label}」的本机记录、已保存的凭据、{count} 个远程工作区及其本地锚点目录。远端已部署的运行时与远端会话日志不会被删除。",
			"tree.forget.workspace.title": "移除这个远程工作区？",
			"tree.forget.workspace.message": "将移除「{title}」（{path}）的本机记录与本地锚点目录。远端 dsh 上的会话日志不会被删除。",
			"tree.workspace.rename": "重命名工作区",
			"tree.workspace.rename.title": "重命名工作区",
			"tree.workspace.rename.description": "只改这里显示的名称，不改远端目录名，也不影响已保存的会话。",
			"tree.workspace.renamed": "已重命名工作区「{title}」",
			"tree.workspace.renameFailed": "重命名工作区失败：{message}",
			"tree.workspace.aria": "工作区「{name}」的操作",
			"tree.session.aria": "会话「{name}」的操作",
			"tree.session.copyId": "复制会话 ID",
			"tree.session.copied": "已复制会话 ID",
			"tree.session.copyFailed": "复制失败",
			"tree.addWorkspace.title": "添加工作区",
			"tree.addWorkspace.description": "在「{label}」上选一个远端目录作为工作区。",
			"tree.addWorkspace.tab.browse": "浏览目录",
			"tree.addWorkspace.tab.registry": "远端已注册",
			"tree.addWorkspace.loading": "正在读取远端工作区…",
			"tree.addWorkspace.empty": "远端 dsh 还没有注册任何工作区，可以在「浏览目录」页签里打开一个。",
			"tree.addWorkspace.failed": "读取远端工作区失败：{message}",
			"tree.addWorkspace.add": "添加",
			"tree.addWorkspace.added": "已添加",
			"tree.addWorkspace.sessions": "{count} 个会话",
			"tree.addWorkspace.close": "关闭",
			"method.title": "选择连接方式",
			"method.description": "远端只运行执行世界，模型请求与凭据始终留在本机。",
			"method.ssh.name": "SSH",
			"method.ssh.description": "通过 SSH 连接主机，在远端运行执行世界服务。",
			"method.wsl.name": "WSL",
			"method.wsl.description": "连接 Windows 子系统中的 Linux。",
			"method.selected": "已选择",
			"method.ssh.aria": "使用 SSH 连接",
			"method.wsl.aria": "进入本机的 WSL 发行版",
			"config.wslDistro": "发行版",
			"config.wslDistro.hint": "检测到的 WSL 发行版，运行在菜单里切换",
			"config.wslDistro.placeholder": "发行版名称，例如 Ubuntu-22.04",
			"config.wslDistro.pick": "选择发行版",
			"config.wslDistro.required": "请选择一个 WSL 发行版",
			"config.wslUser": "用户名（可选）",
			"config.wslUser.hint": "留空则使用该发行版的默认用户",
			"config.wslUser.placeholder": "默认用户",
			"config.wsl.note": "WSL 目标运行在本机，不需要主机密钥或密码；执行世界与工具调用都发生在该发行版内。",
			"wsl.detecting": "正在检测发行版…",
			"wsl.detected": "已检测到 {count} 个发行版",
			"wsl.empty": "未检测到发行版，可直接输入名称",
			"wsl.unavailable": "无法检测：{reason}",
			"wsl.default": "默认",
			"wsl.state.running": "运行中",
			"wsl.state.stopped": "已停止",
			"wsl.state.installing": "安装中",
			"config.title": "填写配置",
			"config.description": "别名必填，连接成功后会被保存。",
			"config.alias": "别名",
			"config.alias.placeholder": "例如 dev-box",
			"config.alias.hint": "成功后保存，用于列表与重连。",
			"config.alias.required": "请填写别名（必填）",
			"config.aliasFromSsh": "从 ~/.ssh/config 选择",
			"config.aliasFromSsh.empty": "~/.ssh/config 中没有可用别名",
			"config.aliasFromSsh.loading": "正在读取 ~/.ssh/config…",
			"config.aliasFromSsh.prefilling": "正在读取别名配置…",
			"config.aliasFromSsh.failed": "读取别名失败：{message}",
			"config.aliasFromSsh.warning": "解析 ~/.ssh/config 时出现 {count} 条警告",
			"config.host": "主机",
			"config.host.placeholder": "例如 10.0.0.12 或 example.com",
			"config.host.required": "请填写主机",
			"config.port": "端口",
			"config.port.invalid": "端口必须是 1-65535 之间的整数",
			"config.username": "用户名",
			"config.username.required": "请填写用户名",
			"config.authKind": "认证方式",
			"config.connect": "连接",
			"config.authKind.label": "认证方式",
			"config.auth.password": "密码",
			"config.auth.privateKey": "私钥",
			"config.auth.agent": "SSH Agent",
			"config.secret.password": "密码",
			"config.secret.passphrase": "私钥口令（可选）",
			"config.secret.privateKeyPath": "私钥路径",
			"config.secret.privateKeyPath.placeholder": "~/.ssh/id_ed25519",
			"config.secret.password.required": "请填写密码",
			"config.secret.privateKey.required": "请填写私钥路径",
			"config.secret.agent.note": "使用本机 ssh-agent 中已加载的密钥，无需填写密钥内容。",
			"config.secret.reEnter": "密钥已提交，出于安全考虑不会回显；如需修改请重新输入。",
			"config.secret.neverStored": "密钥只发送一次，不会写入列表或 URL。",
			"config.advanced": "高级：远端运行时",
			"config.advanced.hint": "留空则使用远端默认值。",
			"config.nodePath": "Node 路径",
			"config.dshCommand": "DSH 命令",
			"config.profile": "Profile",
			"config.dshHome": "DSH_HOME",
			"config.useDefault": "留空使用默认值（{value}）",
			"connect.title": "连接",
			"connect.description": "先选连接方式，再开始连接；进度、连接日志与主机指纹确认都在这一步。",
			"connect.mode.title": "连接方式",
			"connect.mode.description": "远端只需要一份能跑的 dsh：可以复用机器上已装的，也可以上传自带运行时的 server 包。",
			"connect.mode.reuse.name": "复用机器上的 dsh",
			"connect.mode.reuse.description": "扫描远端已安装的 dsh，并按需补装 server 插件；不上传运行时，也不需要远端网络。",
			"connect.mode.upload.name": "上传 server 包",
			"connect.mode.upload.description": "按远端架构上传自带的 Node 与 dsh；本机已缓存的包直接上传。",
			"connect.mode.download.name": "远程下载",
			"connect.mode.download.description": "由远端自行下载 server 包。",
			"connect.mode.download.disabled": "第一个 server release 之后支持",
			"connect.mode.required": "请先选择一种连接方式",
			"connect.mode.reuse.required": "请先选择一个要复用的远端 dsh",
			"connect.mode.selected": "已选择",
			"connect.scan.scanning": "正在扫描远端已安装的 dsh…",
			"connect.scan.ready": "扫描到 {count} 个可复用的 dsh",
			"connect.scan.empty": "远端没有扫描到可用的 dsh，可以改用「上传 server 包」。",
			"connect.scan.failed": "扫描失败：{message}",
			"connect.scan.retry": "重新扫描",
			"connect.scan.hostKey.pending": "首次扫描该主机：请先确认主机指纹，确认后会带指纹重新扫描。",
			"connect.upload.checking": "正在探测远端架构…",
			"connect.upload.probe": "远端架构：{tag}",
			"connect.upload.artifact": "server 包：{artifact}",
			"connect.upload.cached": "本地已缓存 {size}，直接上传",
			"connect.upload.build": "本地无此架构包，将本地打包（可能数分钟）",
			"connect.upload.unknown": "尚未探测远端架构，可先点「重新扫描」",
			"dsh.version.unknown": "版本未知",
			"dsh.compatible": "版本兼容",
			"dsh.incompatible": "版本不兼容",
			"dsh.notExecutable": "无法执行",
			"dsh.selfContained": "自带 Node",
			"dsh.nodePath": "Node：{path}",
			"dsh.plugin.none": "未安装 server 插件",
			"dsh.plugin.installed": "已装 server 插件 {version}",
			"dsh.plugin.outdated": "server 插件待更新（{version}）",
			"dsh.select": "选用",
			"dsh.selected": "已选用",
			"connect.reuse.failed": "复用远端 dsh 失败：{message}",
			"connect.reuse.switchUpload": "改用上传 server 包并重试",
			"connect.step.connect": "连接主机",
			"connect.step.probe": "探测远端环境",
			"connect.step.runtime": "部署运行时(Node)",
			"connect.step.upload": "部署 dsh 与服务端",
			"connect.step.start": "建立执行通道",
			"connect.status.pending": "等待中",
			"connect.status.running": "进行中",
			"connect.status.ok": "完成",
			"connect.status.failed": "失败",
			"connect.succeeded.list": "已连接，可点「添加工作区」",
			"connect.log.title": "连接日志",
			"connect.log.hostKey": "远端主机指纹 {fingerprint}，等待确认",
			"connect.log.done": "目标「{label}」连接成功",
			"connect.failed": "连接失败",
			"connect.retryHint": "可以重试，或返回上一步修改配置。",
			"connect.hostKey.title": "确认主机指纹",
			"connect.hostKey.description": "首次连接该主机。请核对指纹后再信任；指纹与预期不符可能意味着中间人攻击。不会自动信任。",
			"connect.hostKey.fingerprint": "指纹",
			"connect.hostKey.algorithm": "算法",
			"connect.hostKey.trust": "信任并继续",
			"connect.hostKey.trusting": "正在提交信任…",
			"connect.hostKey.trusted": "已信任，继续连接…",
			"connect.hostKey.cancel": "取消连接",
			"connect.stream.closed": "连接流已中断",
			"directory.title": "选择目录",
			"directory.description": "浏览远端目录，选择一个作为工作区。",
			"directory.loading": "正在读取目录…",
			"directory.connecting": "正在连接远端并建立工作区通道…(首次或断线重连需数秒至数十秒)",
			"directory.empty": "此目录为空",
			"directory.parent": "上一级",
			"directory.home": "主目录",
			"directory.root": "根目录",
			"directory.crumbs.aria": "目录路径",
			"directory.path.placeholder": "输入路径后回车跳转",
			"directory.path.goto": "跳转",
			"directory.newDir": "新建目录",
			"directory.newDir.placeholder": "新目录名称",
			"directory.newDir.create": "创建",
			"directory.newDir.created": "已创建 {path}",
			"directory.titleField": "工作区名称",
			"directory.titleField.placeholder": "留空使用目录名",
			"directory.open": "打开为工作区",
			"directory.opening": "正在打开…",
			"directory.opened": "已打开工作区「{title}」",
			"directory.backToList": "返回列表",
			"directory.noTarget": "没有正在浏览的主机，请先完成一次连接。",
			"error.title": "出错了",
			"error.code": "错误码：{code}",
			"error.network": "网络请求失败：{message}",
			"error.invalidResponse": "服务端返回了无法解析的数据",
			"error.streamUnsupported": "当前环境不支持 SSE（EventSource）",
			"error.dismiss": "知道了"
		};
		const dictionaries = {
			zh: zh$1,
			en: {
				"app.name": "Remote connection",
				"app.tagline": "Open a remote directory as a DeepSeek Harness workspace",
				"common.back": "Back",
				"common.cancel": "Cancel",
				"common.close": "Close",
				"common.refresh": "Refresh",
				"common.retry": "Retry",
				"common.loading": "Loading…",
				"common.unknown": "Unknown",
				"common.file": "File",
				"common.directory": "Directory",
				"step.label.method": "Method",
				"step.label.config": "Configure",
				"step.label.connect": "Connect",
				"step.counter": "Step {current} of {total}",
				"step.goBackTo": "Back to \"{label}\"",
				"wizard.steps.aria": "Connection steps",
				"list.title": "Remote connection",
				"list.description": "{targets} saved host(s), {workspaces} remote workspace(s).",
				"list.newConnection": "New connection",
				"list.targets": "Saved hosts",
				"list.targets.empty": "No saved hosts yet. Start with \"New connection\".",
				"list.workspaces": "Remote workspaces",
				"list.workspaces.empty": "No remote workspaces yet.",
				"list.kind.ssh": "SSH",
				"list.endpoint": "{username}@{host}:{port}",
				"list.endpoint.wsl": "WSL · {distro}",
				"list.status.unknown": "Not connected",
				"list.status.ready": "Connected",
				"list.status.failed": "Failed",
				"list.status.stopped": "Stopped",
				"list.openDirectory": "Open directory",
				"list.addWorkspace": "Add workspace",
				"list.reconnect": "Reconnect",
				"list.open": "Open",
				"list.stop": "Stop",
				"list.forget": "Delete",
				"list.lastError": "Last error: {message}",
				"list.lastConnectedAt": "Last connected: {time}",
				"list.workspacePath": "Path",
				"list.workspaceCreatedAt": "Created {time}",
				"list.workspaceTarget": "Host: {label}",
				"list.missingTarget": "(host removed)",
				"list.forgotTarget": "Deleted connection \"{label}\"",
				"list.forgotWorkspace": "Forgot workspace \"{title}\"",
				"list.stopped": "Stopped host \"{label}\"",
				"list.stopUnsupported": "Host \"{label}\" has no running session to stop",
				"list.meta": "Plugin v{version} · default profile: {profile}",
				"list.meta.unknown": "Plugin version unknown",
				"list.loading": "Reading saved remote items…",
				"list.loadFailed": "Reading saved remote items failed",
				"tree.title": "Remote workspaces",
				"tree.sidebar.title": "Remote workspaces",
				"tree.sidebar.empty": "No connection yet — use + above to add one.",
				"tree.empty": "No connection yet. Start with \"New connection\".",
				"tree.hint": "Connection → workspace → session; session logs live on the remote host, so another device can continue them.",
				"tree.expand": "Expand",
				"tree.collapse": "Collapse",
				"tree.conn.connected": "Connected",
				"tree.conn.connectedNotice": "Connected to \"{label}\"",
				"tree.conn.disconnected": "Not connected",
				"tree.conn.failed": "Connection failed",
				"tree.conn.connect": "Connect",
				"tree.conn.reconnect": "Reconnect",
				"tree.conn.disconnect": "Disconnect",
				"tree.conn.addWorkspace": "Add workspace",
				"tree.conn.noWorkspace": "No workspace yet — use \"Add workspace\".",
				"tree.workspace.open": "Open",
				"tree.workspace.newSession": "New session",
				"tree.workspace.forget": "Remove workspace",
				"tree.workspace.sessions": "{count} session(s)",
				"tree.sessions.loading": "Reading remote sessions…",
				"tree.sessions.empty": "No session on the remote yet",
				"tree.sessions.failed": "Reading remote sessions failed: {message}",
				"tree.session.continue": "Continue",
				"tree.session.opened": "Opened session \"{title}\"",
				"tree.session.fallback": "Could not continue the last session ({message}); started a new one",
				"tree.session.createdAt": "{time}",
				"tree.session.size": "{size}",
				"tree.verb.failed": "{action} failed: {message}",
				"tree.session.pinned": "Session pinned",
				"tree.session.unpinned": "Session unpinned",
				"tree.session.archived": "Session archived",
				"tree.session.unarchived": "Session unarchived",
				"tree.session.forked": "Session forked",
				"tree.session.renamed": "Session renamed",
				"tree.session.archivedNotOpenable": "This session is archived — unarchive it first",
				"tree.session.renameFailed": "Rename failed: {message}",
				"tree.session.openFailed": "Opening the session failed: {message}",
				"tree.session.revealFailed": "The session opened on the remote, but the main column could not show it: {message}",
				"tree.forgetConnection": "Delete connection",
				"tree.forget.confirm.title": "Delete this connection?",
				"tree.forget.confirm.message": "Removes the local record for \"{label}\", its stored credential, {count} remote workspace(s) and their local anchor directories. The runtime deployed on the remote host and the remote session logs are NOT deleted.",
				"tree.forget.workspace.title": "Remove this remote workspace?",
				"tree.forget.workspace.message": "Removes the local record and local anchor directory for \"{title}\" ({path}). Session logs on the remote dsh are NOT deleted.",
				"tree.workspace.rename": "Rename workspace",
				"tree.workspace.rename.title": "Rename workspace",
				"tree.workspace.rename.description": "Changes only the name shown here — not the remote directory name, and not any saved session.",
				"tree.workspace.renamed": "Renamed workspace \"{title}\"",
				"tree.workspace.renameFailed": "Renaming the workspace failed: {message}",
				"tree.workspace.aria": "Actions for workspace \"{name}\"",
				"tree.session.aria": "Actions for session \"{name}\"",
				"tree.session.copyId": "Copy session ID",
				"tree.session.copied": "Session ID copied",
				"tree.session.copyFailed": "Copy failed",
				"tree.addWorkspace.title": "Add workspace",
				"tree.addWorkspace.description": "Pick a remote directory on \"{label}\" as a workspace.",
				"tree.addWorkspace.tab.browse": "Browse directory",
				"tree.addWorkspace.tab.registry": "Registered remotely",
				"tree.addWorkspace.loading": "Reading remote workspaces…",
				"tree.addWorkspace.empty": "The remote dsh has no registered workspace yet — open one from the \"Browse directory\" tab.",
				"tree.addWorkspace.failed": "Reading remote workspaces failed: {message}",
				"tree.addWorkspace.add": "Add",
				"tree.addWorkspace.added": "Added",
				"tree.addWorkspace.sessions": "{count} session(s)",
				"tree.addWorkspace.close": "Close",
				"method.title": "Choose a connection method",
				"method.description": "Only the execution world is remote; model calls and credentials stay local.",
				"method.ssh.name": "SSH",
				"method.ssh.description": "Connect over SSH and run the execution-world service on the host.",
				"method.wsl.name": "WSL",
				"method.wsl.description": "Connect to Linux inside the Windows subsystem.",
				"method.selected": "Selected",
				"method.ssh.aria": "Connect over SSH",
				"method.wsl.aria": "Enter a local WSL distribution",
				"config.wslDistro": "Distribution",
				"config.wslDistro.hint": "Detected WSL distributions; pick one in the menu",
				"config.wslDistro.placeholder": "Distribution name, e.g. Ubuntu-22.04",
				"config.wslDistro.pick": "Pick a distribution",
				"config.wslDistro.required": "A WSL distribution is required",
				"config.wslUser": "User (optional)",
				"config.wslUser.hint": "Leave empty to use the distribution's default user",
				"config.wslUser.placeholder": "Default user",
				"config.wsl.note": "A WSL target runs on this machine, so there is no host key or password; the execution world and every tool call happen inside that distribution.",
				"wsl.detecting": "Detecting distributions…",
				"wsl.detected": "{count} distribution(s) detected",
				"wsl.empty": "No distribution detected — type a name instead",
				"wsl.unavailable": "Detection failed: {reason}",
				"wsl.default": "default",
				"wsl.state.running": "running",
				"wsl.state.stopped": "stopped",
				"wsl.state.installing": "installing",
				"config.title": "Configuration",
				"config.description": "The alias is required and is saved after a successful connection.",
				"config.alias": "Alias",
				"config.alias.placeholder": "e.g. dev-box",
				"config.alias.hint": "Saved on success; used by the list and by reconnects.",
				"config.alias.required": "An alias is required",
				"config.aliasFromSsh": "Pick from ~/.ssh/config",
				"config.aliasFromSsh.empty": "No alias found in ~/.ssh/config",
				"config.aliasFromSsh.loading": "Reading ~/.ssh/config…",
				"config.aliasFromSsh.prefilling": "Reading the alias…",
				"config.aliasFromSsh.failed": "Reading the alias failed: {message}",
				"config.aliasFromSsh.warning": "{count} warning(s) while parsing ~/.ssh/config",
				"config.host": "Host",
				"config.host.placeholder": "e.g. 10.0.0.12 or example.com",
				"config.host.required": "A host is required",
				"config.port": "Port",
				"config.port.invalid": "The port must be an integer between 1 and 65535",
				"config.username": "Username",
				"config.username.required": "A username is required",
				"config.authKind": "Authentication",
				"config.connect": "Connect",
				"config.authKind.label": "Authentication method",
				"config.auth.password": "Password",
				"config.auth.privateKey": "Private key",
				"config.auth.agent": "SSH agent",
				"config.secret.password": "Password",
				"config.secret.passphrase": "Key passphrase (optional)",
				"config.secret.privateKeyPath": "Private key path",
				"config.secret.privateKeyPath.placeholder": "~/.ssh/id_ed25519",
				"config.secret.password.required": "A password is required",
				"config.secret.privateKey.required": "A private key path is required",
				"config.secret.agent.note": "Uses the keys already loaded in the local ssh-agent; no key material is sent.",
				"config.secret.reEnter": "The secret was submitted and is never rendered again; type it again to change it.",
				"config.secret.neverStored": "The secret is sent once only — never into the list or a URL.",
				"config.advanced": "Advanced: remote runtime",
				"config.advanced.hint": "Leave empty to use the remote defaults.",
				"config.nodePath": "Node path",
				"config.dshCommand": "DSH command",
				"config.profile": "Profile",
				"config.dshHome": "DSH_HOME",
				"config.useDefault": "Empty uses the default ({value})",
				"connect.title": "Connect",
				"connect.description": "Pick how to provision the remote side, then connect; progress, the live log and the host-key prompt all live in this step.",
				"connect.mode.title": "Connection method",
				"connect.mode.description": "The remote side only needs a working dsh: reuse the one already installed there, or upload a server package that carries its own runtime.",
				"connect.mode.reuse.name": "Reuse the dsh on the machine",
				"connect.mode.reuse.description": "Scans the dsh installs already on the host and installs the server plugin if needed; no runtime upload and no remote network.",
				"connect.mode.upload.name": "Upload the server package",
				"connect.mode.upload.description": "Uploads the bundled Node and dsh for the remote architecture; a locally cached package is uploaded as is.",
				"connect.mode.download.name": "Download remotely",
				"connect.mode.download.description": "Lets the remote side fetch the server package itself.",
				"connect.mode.download.disabled": "Supported after the first server release",
				"connect.mode.required": "Choose a connection method first",
				"connect.mode.reuse.required": "Pick a remote dsh to reuse first",
				"connect.mode.selected": "Selected",
				"connect.scan.scanning": "Scanning the dsh installs on the host…",
				"connect.scan.ready": "{count} reusable dsh install(s) found",
				"connect.scan.empty": "No usable dsh found on the host — switch to \"Upload the server package\".",
				"connect.scan.failed": "Scan failed: {message}",
				"connect.scan.retry": "Scan again",
				"connect.scan.hostKey.pending": "First scan of this host: confirm the host key, then the scan runs again with the confirmed fingerprint.",
				"connect.upload.checking": "Probing the remote architecture…",
				"connect.upload.probe": "Remote architecture: {tag}",
				"connect.upload.artifact": "Server package: {artifact}",
				"connect.upload.cached": "{size} already cached locally — uploading as is",
				"connect.upload.build": "No package for this architecture locally — it will be built here (may take minutes)",
				"connect.upload.unknown": "Remote architecture not probed yet — use \"Scan again\"",
				"dsh.version.unknown": "unknown version",
				"dsh.compatible": "compatible",
				"dsh.incompatible": "incompatible",
				"dsh.notExecutable": "not executable",
				"dsh.selfContained": "bundles Node",
				"dsh.nodePath": "Node: {path}",
				"dsh.plugin.none": "server plugin not installed",
				"dsh.plugin.installed": "server plugin {version} installed",
				"dsh.plugin.outdated": "server plugin needs an update ({version})",
				"dsh.select": "Use",
				"dsh.selected": "In use",
				"connect.reuse.failed": "Reusing the remote dsh failed: {message}",
				"connect.reuse.switchUpload": "Switch to uploading the server package and retry",
				"connect.step.connect": "Connect to the host",
				"connect.step.probe": "Probe the remote host",
				"connect.step.runtime": "Deploy the runtime (Node)",
				"connect.step.upload": "Deploy dsh and the server",
				"connect.step.start": "Open the execution channel",
				"connect.status.pending": "Pending",
				"connect.status.running": "Running",
				"connect.status.ok": "Done",
				"connect.status.failed": "Failed",
				"connect.succeeded.list": "Connected — click \"Add workspace\" to continue",
				"connect.log.title": "Connection log",
				"connect.log.hostKey": "Remote host key {fingerprint} — awaiting confirmation",
				"connect.log.done": "Target \"{label}\" connected",
				"connect.failed": "Connection failed",
				"connect.retryHint": "Retry, or go back and fix the configuration.",
				"connect.hostKey.title": "Confirm the host key",
				"connect.hostKey.description": "First connection to this host. Verify the fingerprint before trusting it; a mismatch may mean a man-in-the-middle. It is never trusted automatically.",
				"connect.hostKey.fingerprint": "Fingerprint",
				"connect.hostKey.algorithm": "Algorithm",
				"connect.hostKey.trust": "Trust and continue",
				"connect.hostKey.trusting": "Submitting…",
				"connect.hostKey.trusted": "Trusted — continuing…",
				"connect.hostKey.cancel": "Cancel connection",
				"connect.stream.closed": "The connection stream closed",
				"directory.title": "Choose a directory",
				"directory.description": "Browse the remote filesystem and pick a workspace directory.",
				"directory.loading": "Reading the directory…",
				"directory.connecting": "Connecting to the remote host and rebuilding the workspace channel… (first connect or reconnect can take seconds)",
				"directory.empty": "This directory is empty",
				"directory.parent": "Parent",
				"directory.home": "Home",
				"directory.root": "Root",
				"directory.crumbs.aria": "Directory path",
				"directory.path.placeholder": "Type a path and press Enter",
				"directory.path.goto": "Go",
				"directory.newDir": "New directory",
				"directory.newDir.placeholder": "New directory name",
				"directory.newDir.create": "Create",
				"directory.newDir.created": "Created {path}",
				"directory.titleField": "Workspace name",
				"directory.titleField.placeholder": "Empty uses the directory name",
				"directory.open": "Open as workspace",
				"directory.opening": "Opening…",
				"directory.opened": "Opened workspace \"{title}\"",
				"directory.backToList": "Back to list",
				"directory.noTarget": "No host is being browsed — finish a connection first.",
				"error.title": "Something went wrong",
				"error.code": "Code: {code}",
				"error.network": "The request failed: {message}",
				"error.invalidResponse": "The server returned an unreadable response",
				"error.streamUnsupported": "This environment has no SSE support (EventSource)",
				"error.dismiss": "Dismiss"
			}
		};
		let activeLocale = "zh";
		/** @returns the active language. */
		function getLocale() {
			return activeLocale;
		}
		/**
		* Translate one dictionary key, interpolating `{name}` parameters.
		* @param key - dictionary key.
		* @param params - `{name}` values; an unknown name keeps its placeholder.
		* @returns the localized string (never empty: falls back to `zh`, then the key).
		*/
		function t(key, params) {
			const template = dictionaries[activeLocale][key] ?? zh$1[key] ?? key;
			if (params === void 0) return template;
			return template.replace(/\{(\w+)\}/g, (match, name) => {
				const value = params[name];
				return value === void 0 || value === null ? match : String(value);
			});
		}
		//#endregion
		//#region src/client/common.tsx
		/**
		* One labelled form control plus an optional hint line.
		*
		* A plain container, not `<label>`: the controls inside carry their own
		* `aria-label`, and a label wrapping a segmented control would hijack its
		* clicks.
		*/
		function Field(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-field",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-rw-field-label",
						children: props.label
					}),
					props.children,
					props.hint !== void 0 && props.hint !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-rw-field-hint",
						children: props.hint
					})
				]
			});
		}
		/** One inline message line. */
		function Banner(props) {
			const icon = props.kind === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningTriangleOutlineRegular, { size: 14 }) : props.kind === "success" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckCircleFillRegular, { size: 14 }) : null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-banner",
				"data-kind": props.kind,
				role: props.kind === "error" ? "alert" : "status",
				children: [
					icon,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsh-rw-banner-text",
						children: [props.text, props.code !== void 0 && props.code !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-rw-banner-code",
							children: t("error.code", { code: props.code })
						})]
					}),
					props.onDismiss !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						size: "sm",
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutlineRegular, { size: 12 }),
						"aria-label": t("error.dismiss"),
						onClick: props.onDismiss
					})
				]
			});
		}
		/** Inline error banner for one wire failure. */
		function ErrorBanner(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Banner, {
				kind: "error",
				text: props.error.message,
				code: props.error.code,
				onDismiss: props.onDismiss
			});
		}
		/**
		* Transient notice rendered as the shell's official `Toast` (top-center,
		* self-timed hold+fade; `onDone` is the only dismissal signal). The store no
		* longer runs its own auto-dismiss timer — the component owns the lifecycle.
		*
		* Success uses the built-in green check; errors keep the default dark
		* surface with a warning icon and a longer hold (official pattern: no error
		* tone exists). `key` replays the slide-in when a new notice object arrives,
		* matching the official seq-keyed usage (ui-open-in-app/open-failure-toast).
		*/
		function NoticeToast(props) {
			const seq = (0, react.useRef)(0);
			const seen = (0, react.useRef)(void 0);
			if (props !== seen.current) {
				seen.current = props;
				seq.current += 1;
			}
			return props.kind === "success" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
				text: props.text,
				tone: "success",
				holdMs: 3e3,
				onDone: props.onDismiss
			}, seq.current) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
				text: props.text,
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 18 }),
				holdMs: 5e3,
				onDone: props.onDismiss
			}, seq.current);
		}
		/** A block-level loading line. */
		function LoadingLine(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: "dsh-rw-hint",
				children: props.text ?? t("common.loading")
			});
		}
		/** An empty-state box. */
		function EmptyState(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: "dsh-rw-empty",
				children: props.text
			});
		}
		/**
		* Whether this component is **the** live instance of its kind.
		*
		* `RemoteTree` — which hosts this plugin's dialogs — is mounted twice: once by
		* the sidebar section and once by the plugin panel's list body. Both are live at
		* the same time, so an unguarded dialog would render two stacked modals for one
		* request. Same rule as {@link NoticeToastHost} (the first host owns the
		* surface), but keyed per kind so the four dialogs do not fight each other.
		*
		* Ownership is claimed in an effect rather than in a `useState` initializer:
		* a counter in an initializer double-counts under StrictMode's double-invoke and
		* would leave every instance a non-owner.
		* @param kind - a stable name per dialog, e.g. `'add-workspace'`.
		* @returns true while this instance owns the dialog surface.
		*/
		function useSingleHost(kind) {
			const [token] = (0, react.useState)(() => ({}));
			const [owned, setOwned] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				const claim = () => {
					if (owners.has(kind)) return;
					owners.set(kind, token);
					setOwned(true);
				};
				claim();
				const contenders = waiters.get(kind) ?? /* @__PURE__ */ new Set();
				waiters.set(kind, contenders);
				contenders.add(claim);
				return () => {
					contenders.delete(claim);
					if (owners.get(kind) !== token) return;
					owners.delete(kind);
					setOwned(false);
					for (const next of contenders) {
						next();
						break;
					}
				};
			}, [kind, token]);
			return owned;
		}
		/** Current owner token per dialog kind. */
		const owners = /* @__PURE__ */ new Map();
		/** Claim functions of every mounted instance, per dialog kind. */
		const waiters = /* @__PURE__ */ new Map();
		/**
		* The single toast host for this plugin.
		*
		* The sidebar section and the plugin panel are separate surface trees, and a
		* verb can be raised from either; rendering one `NoticeToast` per surface would
		* show every notice twice when both are mounted. The first host to mount owns
		* the toast, and ownership passes to the next one when it unmounts.
		*/
		function NoticeToastHost(props) {
			const [owned] = (0, react.useState)(() => {
				hosts += 1;
				return hosts === 1;
			});
			(0, react.useEffect)(() => () => {
				if (owned) hosts -= 1;
			}, [owned]);
			if (!owned || props.notice === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoticeToast, {
				kind: props.notice.kind,
				text: props.notice.text,
				onDismiss: props.onDismiss
			});
		}
		/** Mounted toast hosts, in mount order. */
		let hosts = 0;
		//#endregion
		//#region src/client/api.ts
		/**
		* Typed client for this plugin's frozen host HTTP contract.
		*
		* Every route lives under {@link API_PREFIX}: POST + JSON body for commands,
		* one GET SSE stream for connection progress (EventSource cannot POST, so the
		* one-shot `ticket` travels in the query string). Responses are always
		* `{ ok: true, value }` or `{ ok: false, error: { code, message } }`; a
		* non-envelope body (a fence rejection, a proxy error page) is surfaced as
		* {@link RemoteApiError} carrying the HTTP status.
		*
		* No secret ever enters a URL: `secret`/`privateKeyPath` ride the
		* `/api/connect/start` JSON body only, and {@link api.connectStart} is the
		* only method that takes them.
		*/
		/** Route prefix owned by the plugin's host half. */
		const API_PREFIX = "/dsh-remote-workspace";
		/** One failed call, with the host's error code and the HTTP status. */
		var RemoteApiError = class extends Error {
			code;
			status;
			/**
			* @param code - the host's error code (`network` and `invalid-response` are client-side).
			* @param message - human-readable message, already localized where the client produced it.
			* @param status - HTTP status, 0 for a transport failure.
			*/
			constructor(code, message, status) {
				super(message);
				this.name = "RemoteApiError";
				this.code = code;
				this.status = status;
			}
		};
		/** Reduce any thrown value to a {@link WireError} for inline rendering. */
		function toWireError(error) {
			if (error instanceof RemoteApiError) return {
				code: error.code,
				message: error.message
			};
			if (error instanceof Error) return {
				code: "client",
				message: error.message
			};
			return {
				code: "client",
				message: String(error)
			};
		}
		/**
		* Parse one JSON envelope, throwing {@link RemoteApiError} for anything else.
		* The body is read as text first so a non-JSON rejection (the host's trust
		* fence, a proxy) still produces a readable message.
		*/
		async function readEnvelope(response) {
			const raw = await response.text().catch(() => "");
			let parsed = null;
			if (raw !== "") try {
				parsed = JSON.parse(raw);
			} catch {
				parsed = null;
			}
			if (parsed !== null && parsed.ok === true) return parsed.value;
			const code = typeof parsed?.error?.code === "string" ? parsed.error.code : `http-${response.status}`;
			const envelopeMessage = typeof parsed?.error?.message === "string" ? parsed.error.message : void 0;
			const fallback = raw === "" ? `HTTP ${response.status}` : raw.slice(0, 300);
			throw new RemoteApiError(code, envelopeMessage ?? fallback, response.status);
		}
		/** POST one command route and unwrap its envelope. */
		async function call(route, body) {
			let response;
			try {
				response = await fetch(`${API_PREFIX}/api/${route}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body ?? {})
				});
			} catch (error) {
				throw new RemoteApiError("network", t("error.network", { message: error instanceof Error ? error.message : String(error) }), 0);
			}
			return readEnvelope(response);
		}
		/** One command per frozen host route. */
		const api = {
			/** Saved targets, saved workspaces, plugin version and the default profile. */
			state() {
				return call("state", {});
			},
			/**
			* Installed WSL distributions (`wsl.exe -l -v`).
			*
			* Windows hosts only; elsewhere the route answers 400 and the caller never
			* asks, because the WSL method is not offered there at all.
			*/
			wslDistros() {
				return call("wsl-distros", {});
			},
			/** Aliases parsed from the local `~/.ssh/config`, plus parser warnings. */
			sshAliases() {
				return call("ssh-aliases", {});
			},
			/** Resolved connection fields for one alias (host/port/user/identity). */
			aliasPrefill(alias) {
				return call("alias-prefill", { alias });
			},
			/**
			* Start a connection attempt; the returned ticket addresses the SSE stream.
			* @param request - connection fields; `secret` is sent here and nowhere else.
			*/
			connectStart(request) {
				return call("connect/start", request);
			},
			/** Accept one host-key fingerprint for a running attempt (never automatic). */
			hostkeyConfirm(ticket, fingerprint) {
				return call("hostkey-confirm", {
					ticket,
					fingerprint
				});
			},
			/** List one remote directory. */
			listDir(targetId, path) {
				return call("list-dir", {
					targetId,
					path
				});
			},
			/** Create one remote directory. */
			mkdir(targetId, path) {
				return call("mkdir", {
					targetId,
					path
				});
			},
			/** Open a remote directory as a workspace and create its session. */
			openWorkspace(targetId, path, title) {
				return call("open-workspace", title === void 0 ? {
					targetId,
					path
				} : {
					targetId,
					path,
					title
				});
			},
			/**
			* Adopt a session that already exists on the remote server (换设备续聊).
			* @param targetId - the host owning the session.
			* @param path - the remote workspace directory.
			* @param sessionId - stored remote session id.
			*/
			openSession(targetId, path, sessionId, title) {
				return call("open-session", {
					targetId,
					path,
					sessionId,
					...title === void 0 ? {} : { title }
				});
			},
			/** The workspaces the remote dsh has registered (添加工作区 source). */
			remoteWorkspaces(targetId) {
				return call("remote-workspaces", { targetId });
			},
			/** Sessions stored on the remote server for one local workspace record. */
			sessions(targetId, workspaceId) {
				return call("sessions", {
					targetId,
					workspaceId
				});
			},
			/**
			* Read-only pre-connection scan: the remote architecture, the server package
			* state and every dsh already installed there.
			*
			* Takes the same identity fields as {@link api.connectStart} (including the
			* secret, which is used once and never stored), but pins nothing and creates
			* no record — a `host-key` stage only asks for a confirmation.
			*/
			dshScan(request) {
				return call("dsh-scan", request);
			},
			/** Rename one remote workspace (the host changes its own record's title only). */
			workspaceRename(workspaceId, title) {
				return call("workspace-rename", {
					workspaceId,
					title
				});
			},
			/** Drop one saved target (and everything derived from it). */
			forgetTarget(targetId) {
				return call("forget-target", { targetId });
			},
			/** Rename one stored remote session (the plugin's own host hop). */
			sessionRename(targetId, path, sessionId, title) {
				return call("session-rename", {
					targetId,
					path,
					sessionId,
					title
				});
			},
			/** Pin/unpin or archive/unarchive one stored remote session. */
			sessionFlag(workspaceId, sessionId, flag, on) {
				return call("session-flag", {
					workspaceId,
					sessionId,
					flag,
					on
				});
			},
			/** Drop one saved remote workspace. */
			forgetWorkspace(workspaceId) {
				return call("forget-workspace", { workspaceId });
			},
			/** Open (or reuse) the execution channel of a saved host, without a session. */
			connect(targetId) {
				return call("connect", { targetId });
			},
			/** Stop the target's remote execution-world session. */
			stopTarget(targetId) {
				return call("stop-target", { targetId });
			}
		};
		/** The SSE URL for one attempt (one-shot ticket, no secret). */
		function connectStreamUrl(ticket) {
			return `${API_PREFIX}/stream/connect?ticket=${encodeURIComponent(ticket)}`;
		}
		/** Frame-name fallback: the host may name its SSE events after the frame type. */
		const FRAME_EVENT_NAMES = [
			"step",
			"host-key",
			"done",
			"error"
		];
		/** Narrow one parsed JSON value to a {@link ConnectFrame}. */
		function asConnectFrame(value) {
			if (value === null || typeof value !== "object") return void 0;
			switch (value.type) {
				case "step": {
					const step = value.step;
					const status = value.status;
					if (step !== "connect" && step !== "probe" && step !== "runtime" && step !== "upload" && step !== "start") return void 0;
					if (status !== "running" && status !== "ok" && status !== "failed") return void 0;
					const message = value.message;
					const detail = value.detail;
					return {
						type: "step",
						step,
						status,
						...typeof message === "string" ? { message } : {},
						...typeof detail === "string" ? { detail } : {}
					};
				}
				case "host-key": {
					const fingerprint = value.fingerprint;
					if (typeof fingerprint !== "string") return void 0;
					const algorithm = value.algorithm;
					return {
						type: "host-key",
						fingerprint,
						...typeof algorithm === "string" ? { algorithm } : {}
					};
				}
				case "done": {
					const target = value.target;
					if (target === null || typeof target !== "object") return void 0;
					return {
						type: "done",
						target
					};
				}
				case "error": {
					const code = value.code;
					const message = value.message;
					return {
						type: "error",
						code: typeof code === "string" ? code : "stream",
						message: typeof message === "string" ? message : t("connect.stream.closed")
					};
				}
				default: return;
			}
		}
		/**
		* Open the SSE progress stream for one attempt.
		*
		* The stream is closed by the returned disposer only: the caller closes it on
		* a terminal frame (`done`/`error`) or on a transport failure, because the
		* ticket is one-shot and the browser's automatic reconnect would re-open a
		* dead attempt. Frames are read from the default `message` event and, as a
		* fallback, from events named after the frame type.
		*
		* @param ticket - the one-shot ticket from {@link api.connectStart}.
		* @param handlers - frame and transport callbacks.
		* @returns an idempotent close function.
		*/
		function openConnectStream(ticket, handlers) {
			if (typeof EventSource === "undefined") throw new RemoteApiError("no-eventsource", t("error.streamUnsupported"), 0);
			const source = new EventSource(connectStreamUrl(ticket));
			let closed = false;
			let failed = false;
			const close = () => {
				if (closed) return;
				closed = true;
				source.close();
			};
			const deliver = (event) => {
				if (closed) return;
				let parsed;
				try {
					parsed = JSON.parse(String(event.data));
				} catch {
					return;
				}
				const frame = asConnectFrame(parsed);
				if (frame !== void 0) handlers.onFrame(frame);
			};
			source.onmessage = deliver;
			for (const name of FRAME_EVENT_NAMES) source.addEventListener(name, deliver);
			source.onerror = () => {
				if (closed || failed) return;
				failed = true;
				handlers.onTransportError(t("connect.stream.closed"));
			};
			return close;
		}
		//#endregion
		//#region src/client/alias-prefill.ts
		/**
		* Build the draft patch for one resolved alias.
		* @param prefill - the alias as `/api/alias-prefill` resolved it.
		* @param previous - the current draft (its label/username/private key are kept
		*   unless the alias provides better facts).
		* @returns the fields to merge into the draft.
		*/
		function draftFromAlias(prefill, previous) {
			const identityFile = prefill.identityFile !== void 0 && prefill.identityFile !== "" ? prefill.identityFile : void 0;
			return {
				sshConfigAlias: prefill.alias,
				host: prefill.host,
				port: String(prefill.port),
				username: prefill.username !== void 0 && prefill.username !== "" ? prefill.username : previous.username,
				...identityFile === void 0 ? {} : { privateKeyPath: identityFile },
				label: previous.label.trim() === "" ? prefill.alias : previous.label
			};
		}
		//#endregion
		//#region src/targets/methods.ts
		/**
		* Whether one method exists on a host platform.
		* @param method - wizard method id.
		* @param platform - `process.platform` of the harness host (`'win32'`, `'darwin'`, `'linux'`).
		* @returns true when the method may be offered on that platform.
		*/
		function methodAvailable(method, platform) {
			if (method === "ssh") return true;
			if (method === "docker") return false;
			return platform === "win32";
		}
		//#endregion
		//#region src/client/store.ts
		/**
		* The plugin's browser app model: one module-level `useSyncExternalStore`
		* store shared by the sidebar panel row and the inline wizard page.
		*
		* Slot entries are registered independently, so React context cannot carry
		* state between them; a module-level store can (and it survives a hot-reload
		* `apply`, while every side effect it owns is still disposed through
		* `ctx.effect` → {@link dispose}).
		*
		* Secret handling: a submitted secret lives only in the module-level
		* {@link pendingSecret} closure (never in the rendered snapshot, never in a
		* URL) so a retry can reuse it while an input can never render it back.
		*/
		/** The four progress rows, in server order. */
		const CONNECT_STEPS = [
			"connect",
			"probe",
			"runtime",
			"upload",
			"start"
		];
		/** Log lines kept per attempt; older lines fall off the head. */
		const CONNECT_LOG_LIMIT = 400;
		/** Lines that report continuous progress (`upload progress (node): 42.0% …`)
		*  collapse into one live row per key instead of flooding the log. */
		const PROGRESS_PREFIX = /^(upload progress \([^)]*\)|download progress):/;
		/**
		* Run a directory-plane operation, flipping `connecting` when it outlives
		* `delay` — the point where a plain read has become a channel (re)build, which
		* can take seconds. The UI then shows 连接中 instead of a bare reading line.
		*/
		async function withConnecting(run) {
			const timer = setTimeout(() => {
				commit((previous) => ({ directory: {
					...previous.directory,
					connecting: true
				} }));
			}, 1200);
			try {
				return await run();
			} finally {
				clearTimeout(timer);
				commit((previous) => previous.directory.connecting ? { directory: {
					...previous.directory,
					connecting: false
				} } : {});
			}
		}
		/** Append one line to the current attempt's live log. */
		function appendLog(level, text) {
			const line = {
				time: (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", { hour12: false }),
				level,
				text
			};
			const previous = state.connect.log;
			const last = previous[previous.length - 1];
			const progressKey = PROGRESS_PREFIX.exec(text)?.[0];
			if (progressKey !== void 0 && last !== void 0 && PROGRESS_PREFIX.exec(last.text)?.[0] === progressKey) {
				const log = [...previous.slice(0, -1), line];
				commit({ connect: {
					...state.connect,
					log
				} });
				return;
			}
			const log = [...previous, line];
			commit({ connect: {
				...state.connect,
				log: log.length > CONNECT_LOG_LIMIT ? log.slice(log.length - CONNECT_LOG_LIMIT) : log
			} });
		}
		function emptySteps() {
			return {
				connect: { status: "pending" },
				probe: { status: "pending" },
				runtime: { status: "pending" },
				upload: { status: "pending" },
				start: { status: "pending" }
			};
		}
		function idleConnect() {
			return {
				phase: "idle",
				steps: emptySteps(),
				log: []
			};
		}
		function emptyDshScan() {
			return {
				status: "idle",
				candidates: []
			};
		}
		function emptyDirectory() {
			return {
				open: false,
				loading: false,
				creating: false,
				newDirName: "",
				title: "",
				titleTouched: false,
				pathInput: "",
				connecting: false
			};
		}
		function emptyDraft() {
			return {
				label: "",
				host: "",
				port: "22",
				username: "",
				authKind: "password",
				secret: "",
				privateKeyPath: "",
				wslDistro: "",
				wslUser: "",
				nodePath: "",
				dshCommand: "",
				profile: "",
				dshHome: "",
				connectionMode: "",
				reuseLauncherPath: ""
			};
		}
		function initialState() {
			return {
				open: false,
				view: "list",
				step: "method",
				method: "ssh",
				config: emptyDraft(),
				aliases: [],
				aliasWarnings: [],
				aliasesLoading: false,
				aliasesLoaded: false,
				prefilling: false,
				platform: "",
				wslProbe: {
					status: "idle",
					distros: []
				},
				dshScan: emptyDshScan(),
				targets: [],
				workspaces: [],
				pluginVersion: "",
				defaultProfile: "",
				stateLoaded: false,
				stateLoading: false,
				pending: false,
				secretPending: false,
				expanded: {},
				sessions: {},
				connect: idleConnect(),
				directory: emptyDirectory()
			};
		}
		let state = initialState();
		const listeners = /* @__PURE__ */ new Set();
		/**
		* Monotonic id of the current overlay session. Every asynchronous action
		* captures it and drops its result when the session moved on (overlay closed,
		* new connection started, plugin disposed), so a late response can never
		* resurrect a dialog the user already left.
		*/
		let generation = 0;
		/** In-flight attempt's secret: deliberately outside the rendered snapshot. */
		let pendingSecret;
		/** Closer of the live SSE stream, when one is open. */
		let closeStream;
		function commit(patch) {
			const changes = typeof patch === "function" ? patch(state) : patch;
			if (changes === void 0 || Object.keys(changes).length === 0) return;
			state = {
				...state,
				...changes
			};
			for (const listener of listeners) listener();
		}
		function subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
		function getSnapshot() {
			return state;
		}
		/** Snapshot hook for the button and the overlay. */
		function useAppState() {
			return (0, react.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
		}
		/**
		* Whether the overlay refuses to close right now: a connection attempt is
		* running or waiting for a host-key decision, and closing would orphan it.
		* @param current - the snapshot to inspect.
		*/
		function isConnectBlocking(current) {
			if (current.view !== "wizard" || current.step !== "connect") return false;
			return current.connect.phase === "running" || current.connect.phase === "awaiting-hostkey";
		}
		/** Sort directories first, then files, each alphabetically. */
		function sortEntries(entries) {
			return [...entries].sort((left, right) => {
				const leftDirectory = left.type === "directory" ? 0 : 1;
				const rightDirectory = right.type === "directory" ? 0 : 1;
				if (leftDirectory !== rightDirectory) return leftDirectory - rightDirectory;
				return left.name.localeCompare(right.name, "zh-Hans-CN");
			});
		}
		/** Last path segment, for a default workspace title. */
		function basename(path) {
			const trimmed = path.replace(/\/+$/, "");
			const index = trimmed.lastIndexOf("/");
			const name = index === -1 ? trimmed : trimmed.slice(index + 1);
			return name === "" ? "/" : name;
		}
		/** Join a directory path with one child name. */
		function joinPath(base, name) {
			return base === "" || base === "/" ? `/${name}` : `${base.replace(/\/+$/, "")}/${name}`;
		}
		function validation(messageKey) {
			return {
				code: "invalid",
				message: t(messageKey)
			};
		}
		/** Validate everything but the secret; the secret is resolved separately. */
		function validateDraft(draft, method) {
			if (draft.label.trim() === "") return validation("config.alias.required");
			if (method === "wsl") {
				if (draft.wslDistro.trim() === "") return validation("config.wslDistro.required");
				return;
			}
			if (draft.host.trim() === "") return validation("config.host.required");
			const port = Number(draft.port.trim());
			if (!Number.isInteger(port) || port < 1 || port > 65535) return validation("config.port.invalid");
			if (draft.username.trim() === "") return validation("config.username.required");
		}
		/** Resolve the secret to send, reusing the in-flight one on a retry. */
		function resolveSecret(draft) {
			if (draft.authKind === "agent") return { ok: true };
			if (draft.authKind === "privateKey") {
				if (draft.privateKeyPath.trim() === "") return {
					ok: false,
					error: validation("config.secret.privateKey.required")
				};
				const passphrase = draft.secret !== "" ? draft.secret : pendingSecret;
				return passphrase === void 0 || passphrase === "" ? { ok: true } : {
					ok: true,
					secret: passphrase
				};
			}
			const password = draft.secret !== "" ? draft.secret : pendingSecret;
			if (password === void 0 || password === "") return {
				ok: false,
				error: validation("config.secret.password.required")
			};
			return {
				ok: true,
				secret: password
			};
		}
		/** Non-empty remote-runtime overrides only. */
		function buildRemote(draft) {
			const remote = {};
			if (draft.nodePath.trim() !== "") remote.nodePath = draft.nodePath.trim();
			if (draft.dshCommand.trim() !== "") remote.dshCommand = draft.dshCommand.trim();
			if (draft.profile.trim() !== "") remote.profile = draft.profile.trim();
			if (draft.dshHome.trim() !== "") remote.dshHome = draft.dshHome.trim();
			return Object.keys(remote).length === 0 ? void 0 : remote;
		}
		function stopStream() {
			const close = closeStream;
			closeStream = void 0;
			if (close !== void 0) close();
		}
		/**
		* Hold (or drop) the submitted secret outside the rendered snapshot.
		* @param value - the secret to reuse on a retry, or undefined to drop it.
		*/
		function setPendingSecret(value) {
			pendingSecret = value;
			commit({ secretPending: value !== void 0 });
		}
		/** The client context, bound in `apply`, for shell-owned services. */
		let clientContext$1;
		/** Capture the client context for {@link revealSession}. */
		function bindClientContext(ctx) {
			clientContext$1 = ctx;
		}
		/**
		* Sessions this plugin has put on the shell's screen, mapped to the target each
		* one belongs to.
		*
		* A disconnect destroys the *remote* session, and the shell has no idea: it
		* keeps the session selected (`dsh.sessions.current`), keeps a `mainView`
		* retention and keeps the right-bar view bound to it. Answering "is the shell's
		* current conversation one of ours for this target?" is what lets us deselect
		* before tearing the session down (see {@link releaseShellSelection}).
		*/
		const revealedSessions = /* @__PURE__ */ new Map();
		function shellWorkspace() {
			try {
				return clientContext$1?.get("uiWorkspace");
			} catch {
				return;
			}
		}
		/**
		* The session the shell currently shows, read through the official service.
		* @returns the session id, or undefined when nothing is selected.
		*/
		function shellSelectedSessionId() {
			try {
				const selected = shellWorkspace()?.selection?.getSnapshot?.()?.sessionId;
				if (typeof selected === "string" && selected !== "") return selected;
			} catch {}
			return mainViewRetainedSessionId();
		}
		/**
		* Fallback for {@link shellSelectedSessionId}: the row carrying a `mainView`
		* retention.
		*
		* That is the same predicate the shell's own `mainSessionId()` uses over the
		* Session list snapshot, i.e. a published `retainedBy.mainView` counter rather
		* than a private field.
		* @returns the selected session id, or undefined when there is none.
		*/
		function mainViewRetainedSessionId() {
			try {
				const byId = (clientContext$1?.get("sessions"))?.list?.getSnapshot?.()?.byId;
				if (byId !== void 0) {
					for (const [id, row] of Object.entries(byId)) if ((row?.retainedBy?.mainView ?? 0) > 0) return id;
				}
			} catch {}
		}
		/**
		* Drop the shell's selected conversation — the official deselect hop.
		*
		* `uiWorkspace.clearMain()` is exactly what the shell itself runs when the open
		* session is archived (`archiveSession` → `clearMain`): it releases the
		* `mainView` retention, clears the persisted selection and retires the right-bar
		* view bound to that session.
		*/
		function clearShellSelection() {
			try {
				const workspace = shellWorkspace();
				if (workspace !== void 0 && typeof workspace.clearMain === "function") workspace.clearMain();
			} catch (error) {
				console.error("[dsh-remote-workspace] clearing the shell selection failed", error);
			}
		}
		/**
		* Deselect the shell's conversation when it shows one of *this* target's sessions.
		*
		* **Why this exists (measured in alpha52, white-page defect):** 断开 destroys the
		* remote session, but nothing told the shell to stop showing it. The session
		* record stops being live, and the next render of a session-scoped slot runs
		* `ui-session.bindingSource(reference)` → `reference.binding`, which throws
		* `Session reference "session-…" is released`; with no error boundary React then
		* unmounts the entire app (blank `body`, no rows, only a reload recovers).
		* The same stale id also trips `uiConversation.binding: unknown session` on the
		* next locale refresh. Deselecting *before* the teardown removes both: the
		* `mainView` reference is released while it is still valid, and the right-bar
		* view for that session is pruned with the selection.
		*
		* Only a session this plugin revealed for this target is deselected — the
		* user's own local conversation is never touched.
		* @param targetId - the target whose remote sessions are about to go away.
		*/
		function releaseShellSelection(targetId) {
			const selected = shellSelectedSessionId();
			if (selected === void 0) return;
			const known = revealedSessions.get(selected);
			if (!(known === void 0 ? targetOwnsSession(targetId, selected) : known === targetId)) return;
			clearShellSelection();
			revealedSessions.delete(selected);
			if (state.currentSessionId === selected) commit({ currentSessionId: void 0 });
		}
		/**
		* Whether one session id belongs to this target according to our own records.
		*
		* The revealed map is module state and a hot reload loses it, while the shell
		* keeps its selection; the workspace records (and the cached remote session
		* lists they hang off) do not. A session id can only appear under one target,
		* so a match cannot be a false positive.
		* @param targetId - the target being torn down.
		* @param sessionId - the shell's selected session.
		* @returns true when the id is one of this target's remote sessions.
		*/
		function targetOwnsSession(targetId, sessionId) {
			for (const workspace of state.workspaces) {
				if (workspace.targetId !== targetId) continue;
				if (workspace.sessionId === sessionId) return true;
				if (state.sessions[workspace.id]?.items.some((item) => item.id === sessionId) === true) return true;
			}
			return false;
		}
		/**
		* Ask the shell to bring a just-opened session to the front. The shell owns
		* session navigation: `uiWorkspace.openSession` is how its own UI switches
		* conversations; without this the workspace opens silently and the user stays
		* on the plugin panel with only a toast.
		*
		* **Why it waits (alpha55 defect):** `uiWorkspace.openSession` → `replaceMain` →
		* `sessions.retain(id)`, and the shell's client catalog rejects an id it has not
		* seen yet with `sessions.retain: unknown session <id>` (thrown from the
		* SessionManager's `resolveTarget`). A remote session is in that catalog only
		* because the *host* forwarded its "session added" summary — a frame that is not
		* ordered before the `POST /api/open-session` response. Before the first
		* disconnect the row was already there, so the reveal happened to win; right
		* after a reconnect (our teardown had dropped the host session, so the click's
		* resume re-creates it) the reveal could beat the frame, the throw was
		* swallowed, and the click visibly did nothing at all.
		* @param sessionId - the session to show.
		* @param targetId - the target owning it, remembered so a disconnect can
		*   deselect it ({@link releaseShellSelection}).
		*/
		async function revealSession(sessionId, targetId) {
			if (targetId !== void 0) revealedSessions.set(sessionId, targetId);
			const workspace = shellWorkspace();
			if (workspace === void 0 || typeof workspace.openSession !== "function") return;
			await waitForShellSession(sessionId);
			try {
				workspace.openSession(sessionId);
			} catch (error) {
				console.error("[dsh-remote-workspace] revealSession failed", error);
				notifyError(t("tree.session.revealFailed", { message: error instanceof Error ? error.message : String(error) }));
			}
		}
		/** How long the shell's client catalog may take to learn a just-resumed session. */
		const REVEAL_WAIT_MS = 4e3;
		/** Poll interval while waiting for that catalog row. */
		const REVEAL_POLL_MS = 250;
		function shellSessions() {
			try {
				return clientContext$1?.get("sessions");
			} catch {
				return;
			}
		}
		/**
		* Whether the shell's client catalog knows this session id.
		*
		* That is exactly the observable `sessions.retain(id)` checks before throwing
		* `unknown session`, so the reveal is safe once it reads true.
		* @param sessions - the shell's sessions service.
		* @param sessionId - the session about to be revealed.
		* @returns true when the id has a row in the shell's session list snapshot.
		*/
		function shellSessionKnown(sessions, sessionId) {
			try {
				const byId = sessions.list?.getSnapshot?.()?.byId;
				return byId !== void 0 && byId[sessionId] !== void 0;
			} catch {
				return false;
			}
		}
		/**
		* Wait (bounded) until the shell can select this session.
		*
		* Returns immediately when the service is not reachable at all: the wait must
		* only ever postpone a reveal it can actually help, never delay every click by
		* the timeout.
		* @param sessionId - the session about to be revealed.
		*/
		async function waitForShellSession(sessionId) {
			const sessions = shellSessions();
			if (sessions === void 0) return;
			if (shellSessionKnown(sessions, sessionId)) return;
			try {
				if (typeof sessions.refresh === "function") Promise.resolve(sessions.refresh()).catch(() => {});
			} catch {}
			const deadline = Date.now() + REVEAL_WAIT_MS;
			while (!shellSessionKnown(sessions, sessionId) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, REVEAL_POLL_MS));
		}
		/** Open one session in the shell's main column (the official navigation hop). */
		function revealSessionId(sessionId, targetId) {
			revealSession(sessionId, targetId);
		}
		/**
		* Pin/unpin or archive/unarchive one remote session.
		*
		* The sets live on the plugin's own workspace record (the host owns them), so
		* the action is a host call followed by a state refresh; the row's pinned /
		* archived look, its ordering and its openability all read from that record.
		* @param workspace - the workspace the session belongs to.
		* @param sessionId - the stored remote session id.
		* @param flag - which set to change.
		* @param on - add or drop the id.
		*/
		async function setSessionFlag(workspace, sessionId, flag, on) {
			if (state.pending) return;
			const gen = generation;
			commit({
				pending: true,
				error: void 0
			});
			try {
				await api.sessionFlag(workspace.id, sessionId, flag, on);
				if (gen !== generation) return;
				commit({
					pending: false,
					notice: {
						kind: "success",
						text: flag === "pinned" ? t(on ? "tree.session.pinned" : "tree.session.unpinned") : t(on ? "tree.session.archived" : "tree.session.unarchived")
					}
				});
				await refreshState();
			} catch (error) {
				if (gen !== generation) return;
				commit({
					pending: false,
					error: toWireError(error)
				});
			}
		}
		/**
		* Reload one workspace's session list now, whatever its cache says.
		*
		* Used by verbs that change the list from *outside* the panel (a fork creates a
		* session that only appears on the next read).
		* @param workspace - the workspace whose list changed.
		*/
		async function refreshSessions(workspace) {
			invalidateSessions(workspace.id);
			await loadSessions(workspace, true);
		}
		/**
		* Rename one remote session through the plugin's own host hop.
		* @param workspace - the workspace the session belongs to.
		* @param sessionId - the stored remote session id.
		* @param title - the new title.
		*/
		async function renameSession(workspace, sessionId, title) {
			const gen = generation;
			commit({
				pending: true,
				error: void 0
			});
			try {
				await api.sessionRename(workspace.targetId, workspace.path, sessionId, title);
				if (gen !== generation) return;
				commit({
					pending: false,
					notice: {
						kind: "success",
						text: t("tree.session.renamed")
					}
				});
				await refreshState();
				for (const delay of [
					0,
					400,
					900,
					1800
				]) {
					if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
					if (gen !== generation) return;
					await refreshSessions(workspace);
					if ((state.sessions[workspace.id]?.items.find((item) => item.id === sessionId))?.title === title) return;
				}
			} catch (error) {
				if (gen !== generation) return;
				commit({ pending: false });
				throw error;
			}
		}
		/**
		* Ask before forgetting a connection.
		*
		* Forgetting is not undoable: the target record, its stored secret, its
		* workspaces, their shell-tree entries and the stub directories all go with it.
		* `断开` is the non-destructive verb and sits in the same row menu, so a
		* misclick that silently deleted a connection is exactly what this prevents.
		* @param target - the connection row's target.
		*/
		function requestForgetTarget(target) {
			commit({ confirm: {
				kind: "forget-connection",
				title: t("tree.forget.confirm.title"),
				message: t("tree.forget.confirm.message", {
					label: target.label,
					count: state.workspaces.filter((w) => w.targetId === target.id).length
				}),
				confirmLabel: t("list.forget"),
				targetId: target.id
			} });
		}
		/**
		* Ask before removing a remote workspace (its record, tree entry and stub).
		* @param workspace - the workspace row's record.
		*/
		function requestForgetWorkspace(workspace) {
			commit({ confirm: {
				kind: "forget-workspace",
				title: t("tree.forget.workspace.title"),
				message: t("tree.forget.workspace.message", {
					title: workspace.title,
					path: workspace.path
				}),
				confirmLabel: t("tree.workspace.forget"),
				targetId: workspace.targetId,
				workspaceId: workspace.id
			} });
		}
		/** Close the confirmation without acting. */
		function settleConfirm() {
			commit({ confirm: void 0 });
		}
		/** Run the confirmed destructive verb, then close the dialog. */
		async function acceptConfirm() {
			const pending = state.confirm;
			if (pending === void 0) return;
			commit({ confirm: void 0 });
			if (pending.kind === "forget-connection") {
				const target = state.targets.find((candidate) => candidate.id === pending.targetId);
				if (target !== void 0) await forgetTarget(target);
				return;
			}
			const workspace = state.workspaces.find((candidate) => candidate.id === pending.workspaceId);
			if (workspace !== void 0) await forgetWorkspace(workspace);
		}
		/** Open the rename dialog for one remote session. */
		function requestRename(workspace, session) {
			commit({ renameTarget: {
				workspace,
				session,
				title: session.title ?? ""
			} });
		}
		/** Close the rename dialog. */
		function settleRename() {
			commit({ renameTarget: void 0 });
		}
		/** Read saved targets/workspaces (and auto-enter the wizard on a first run). */
		async function refreshState() {
			const gen = generation;
			const firstLoad = !state.stateLoaded;
			const before = state.targets;
			commit({ stateLoading: true });
			try {
				const value = await api.state();
				if (gen !== generation) return;
				const hasSaved = value.targets.length > 0 || value.workspaces.length > 0;
				commit({
					targets: value.targets,
					workspaces: value.workspaces,
					pluginVersion: value.pluginVersion,
					defaultProfile: value.defaultProfile,
					platform: value.platform ?? "",
					stateLoaded: true,
					stateLoading: false
				});
				if (firstLoad && state.open && state.view === "list" && !hasSaved) commit({
					view: "wizard",
					step: "method"
				});
				for (const target of value.targets) if (target.status !== "ready") {
					collapseTarget(target.id);
					if (before.find((candidate) => candidate.id === target.id)?.status === "ready") releaseShellSelection(target.id);
				}
			} catch (error) {
				if (gen !== generation) return;
				if (firstLoad) for (let attempt = 1; attempt <= 4; attempt++) {
					await new Promise((resolve) => setTimeout(resolve, attempt * 750));
					if (gen !== generation) return;
					try {
						const value = await api.state();
						if (gen !== generation) return;
						commit({
							targets: value.targets,
							workspaces: value.workspaces,
							pluginVersion: value.pluginVersion,
							defaultProfile: value.defaultProfile,
							platform: value.platform ?? "",
							stateLoaded: true,
							stateLoading: false
						});
						return;
					} catch {}
				}
				commit({
					stateLoading: false,
					stateLoaded: true,
					error: toWireError(error)
				});
			}
		}
		/**
		* Leave the wizard and return to the saved-items list; refused while a
		* connection attempt owns the flow.
		*
		* Named for the overlay days: the panel's 取消/关闭 buttons land here, so
		* leaving now also rewinds the view.
		*/
		function closeOverlay() {
			if (isConnectBlocking(state)) return;
			generation += 1;
			stopStream();
			setPendingSecret(void 0);
			commit({
				open: false,
				view: "list",
				error: void 0,
				notice: void 0,
				prefilling: false,
				pending: false,
				addWorkspace: void 0,
				renameWorkspace: void 0,
				directory: emptyDirectory()
			});
		}
		/**
		* Open the connection wizard: switch the main column to this plugin's panel
		* (the wizard's home) and enter the wizard view. Called from the sidebar
		* section's 新建连接 button, which lives outside the main panel.
		* @param panelId - this plugin's main-panel key.
		*/
		function openConnectionWizard(panelId) {
			try {
				(clientContext$1?.get("layout"))?.selectPanel?.(panelId);
			} catch (error) {
				console.error("[dsh-remote-workspace] selectPanel failed", error);
			}
			newConnection();
		}
		/** Leave the list and start a fresh wizard run. */
		function newConnection() {
			generation += 1;
			stopStream();
			setPendingSecret(void 0);
			commit({
				view: "wizard",
				step: "method",
				error: void 0,
				notice: void 0,
				prefilling: false,
				pending: false,
				stateLoading: false,
				addWorkspace: void 0,
				renameWorkspace: void 0,
				connect: idleConnect(),
				dshScan: emptyDshScan(),
				directory: emptyDirectory()
			});
		}
		/** Switch the wizard to a step, loading that step's data. */
		function setStep(step) {
			commit({
				step,
				error: void 0
			});
			if (step === "config") {
				if (state.method === "wsl") loadWslDistros();
				else loadAliases();
				return;
			}
			if (step === "connect") {
				if (state.dshScan.status === "idle" && state.dshScan.fingerprint === void 0) scanDsh();
			}
		}
		function setMethod(method) {
			if (!methodAvailable(method, state.platform)) return;
			commit({
				method,
				dshScan: emptyDshScan()
			});
			if (method === "wsl") loadWslDistros();
		}
		/**
		* Detect the installed WSL distributions.
		*
		* Called when the WSL config step is entered (never at activation: it spawns
		* `wsl.exe`, and `wsl -l` is the one subcommand that does not start a distro).
		* The default distribution is preselected so the common case needs no click.
		* @param force - re-run even when a result is already cached.
		*/
		async function loadWslDistros(force = false) {
			if (state.wslProbe.status === "loading") return;
			if (state.wslProbe.status === "ready" && !force) return;
			const gen = generation;
			commit({ wslProbe: {
				status: "loading",
				distros: state.wslProbe.distros
			} });
			try {
				const value = await api.wslDistros();
				if (gen !== generation) return;
				if (!value.available) {
					commit({ wslProbe: {
						status: "unavailable",
						distros: [],
						...value.error === void 0 ? {} : { error: value.error }
					} });
					return;
				}
				commit((previous) => {
					const names = value.distros.map((distro) => distro.name);
					const current = previous.config.wslDistro;
					const preferred = (names.includes(current) ? current : void 0) ?? value.distros.find((distro) => distro.default)?.name ?? value.distros[0]?.name ?? "";
					return {
						wslProbe: {
							status: "ready",
							distros: value.distros
						},
						config: {
							...previous.config,
							wslDistro: preferred
						}
					};
				});
			} catch (error) {
				if (gen !== generation) return;
				commit({ wslProbe: {
					status: "unavailable",
					distros: [],
					error: toWireError(error).message
				} });
			}
		}
		function patchConfig(patch) {
			setPendingSecret(void 0);
			const clearsAlias = patch.host !== void 0 || patch.port !== void 0 || patch.username !== void 0;
			const clearsScan = SCAN_IDENTITY_FIELDS.some((field) => patch[field] !== void 0);
			commit((previous) => {
				const config = {
					...previous.config,
					...patch
				};
				if (clearsAlias) delete config.sshConfigAlias;
				const live = previous.connect.phase === "running" || previous.connect.phase === "awaiting-hostkey";
				return {
					config,
					...clearsScan ? { dshScan: emptyDshScan() } : {},
					...clearsScan && !live ? { connect: idleConnect() } : {}
				};
			});
		}
		/** Draft fields a scan result depends on. */
		const SCAN_IDENTITY_FIELDS = [
			"host",
			"port",
			"username",
			"authKind",
			"privateKeyPath",
			"wslDistro",
			"wslUser",
			"profile",
			"dshHome"
		];
		function dismissError() {
			commit({ error: void 0 });
		}
		/** Report one success notice (used by row verbs that own no panel chrome). */
		function notifySuccess(text) {
			commit({ notice: {
				kind: "success",
				text
			} });
		}
		/** Report one failure notice. */
		function notifyError(text) {
			commit({ notice: {
				kind: "error",
				text
			} });
		}
		function dismissNotice() {
			commit({ notice: void 0 });
		}
		/**
		* Observe the rows this plugin must keep out of the shell's own 工作区 section:
		* the official workspace ids of its stubs, plus every remote session id it knows
		* about. Fires immediately and on every change.
		* @param apply - sink for the two id lists.
		* @returns a disposer removing the subscription.
		*/
		function watchShellRows(apply) {
			const run = () => {
				const workspaceIds = state.workspaces.map((workspace) => workspace.officialWorkspaceId ?? "").filter((id) => id !== "");
				const sessionIds = /* @__PURE__ */ new Set();
				for (const workspace of state.workspaces) if (workspace.sessionId !== void 0 && workspace.sessionId !== "") sessionIds.add(workspace.sessionId);
				for (const list of Object.values(state.sessions)) for (const session of list.items) sessionIds.add(session.id);
				apply(workspaceIds, [...sessionIds]);
			};
			run();
			return subscribe(run);
		}
		/** Load `~/.ssh/config` aliases once per overlay session. */
		async function loadAliases(force = false) {
			if (state.aliasesLoading) return;
			if (state.aliasesLoaded && !force) return;
			const gen = generation;
			commit({ aliasesLoading: true });
			try {
				const value = await api.sshAliases();
				if (gen !== generation) return;
				commit({
					aliases: value.aliases,
					aliasWarnings: value.warnings,
					aliasesLoading: false,
					aliasesLoaded: true
				});
			} catch (error) {
				if (gen !== generation) return;
				commit({
					aliasesLoading: false,
					aliasesLoaded: true,
					error: toWireError(error)
				});
			}
		}
		/**
		* Prefill host/port/user/key from one `~/.ssh/config` alias.
		*
		* The patch comes from `alias-prefill.ts`, which never touches `authKind`: an
		* alias states *where* to connect and which identity file it names, not *how*
		* the user wants to authenticate. Forcing 私钥 off an `IdentityFile` made a
		* password-only host fail with "All configured authentication methods failed"
		* (alpha55 defect).
		*/
		async function chooseAlias(alias) {
			const gen = generation;
			commit({
				prefilling: true,
				error: void 0
			});
			try {
				const value = await api.aliasPrefill(alias);
				if (gen !== generation) {
					commit({ prefilling: false });
					return;
				}
				setPendingSecret(void 0);
				commit((previous) => ({
					prefilling: false,
					dshScan: emptyDshScan(),
					config: {
						...previous.config,
						...draftFromAlias(value, previous.config),
						secret: ""
					}
				}));
			} catch (error) {
				if (gen !== generation) return;
				commit({
					prefilling: false,
					error: toWireError(error)
				});
			}
		}
		/** Choose one of step 3's three connection methods. */
		function setConnectionMode(mode) {
			commit((previous) => ({
				config: {
					...previous.config,
					connectionMode: mode
				},
				error: void 0
			}));
			if ((mode === "reuse" || mode === "upload") && state.dshScan.status === "idle" && state.dshScan.fingerprint === void 0) scanDsh();
		}
		/**
		* The fingerprint this device already confirmed for the draft's identity.
		* @param host - the draft's host.
		* @param port - the draft's port.
		* @param username - the draft's user.
		* @returns the confirmed fingerprint, or undefined when this identity is new.
		*/
		function trustedFingerprint(host, port, username) {
			const trusted = state.trusted;
			if (trusted === void 0) return void 0;
			return trusted.host === host && trusted.port === port && trusted.username === username ? trusted.fingerprint : void 0;
		}
		/** Assemble the read-only scan request from the step-2 draft. */
		function buildScanRequest(draft, method, secret, fingerprint) {
			const request = {};
			if (method === "wsl") {
				request.kind = "wsl";
				request.wslDistro = draft.wslDistro.trim();
				const wslUser = draft.wslUser.trim();
				if (wslUser !== "") request.wslUser = wslUser;
			} else {
				const host = draft.host.trim();
				const port = Number(draft.port.trim());
				const username = draft.username.trim();
				request.kind = "ssh";
				request.host = host;
				request.port = port;
				request.username = username;
				request.authKind = draft.authKind;
				if (secret !== void 0) request.secret = secret;
				if (draft.authKind === "privateKey") request.privateKeyPath = draft.privateKeyPath.trim();
				if (draft.sshConfigAlias !== void 0 && draft.sshConfigAlias !== "") request.sshConfigAlias = draft.sshConfigAlias;
				const confirmed = fingerprint ?? trustedFingerprint(host, port, username);
				if (confirmed !== void 0) request.hostKeyFingerprint = confirmed;
			}
			if (draft.profile.trim() !== "") request.profile = draft.profile.trim();
			if (draft.dshHome.trim() !== "") request.dshHome = draft.dshHome.trim();
			return request;
		}
		/**
		* Pick the candidate to preselect after a scan: keep a still-present choice,
		* else the best usable one (`compatible && upToDate` first, then any
		* compatible — the host already sorts them), else nothing.
		* @param candidates - the scan's candidates.
		* @param current - the launcher currently selected in the draft.
		* @returns the path to select, or `''` when nothing is usable.
		*/
		function pickCandidate(candidates, current) {
			if (current !== "" && candidates.some((candidate) => candidate.path === current)) return current;
			return (candidates.find((candidate) => candidate.compatible && candidate.profile?.upToDate === true) ?? candidates.find((candidate) => candidate.compatible))?.path ?? "";
		}
		/**
		* Run the read-only pre-connection scan (`/api/dsh-scan`).
		*
		* Nothing is pinned or recorded: a `host-key` stage only stores the fingerprint
		* so step 3 can show the same confirmation panel the connect flow uses, and the
		* next scan carries that fingerprint.
		* @param force - scan again even when a result is already cached.
		*/
		async function scanDsh(force = false) {
			if (state.dshScan.status === "scanning") return;
			if (state.dshScan.status === "ready" && !force && state.dshScan.fingerprint === void 0) return;
			const draft = state.config;
			const method = state.method;
			const invalid = validateDraft(draft, method);
			if (invalid !== void 0) {
				commit({ error: invalid });
				return;
			}
			const resolved = method === "wsl" ? {
				ok: true,
				secret: void 0
			} : resolveSecret(draft);
			if (!resolved.ok) {
				commit({ error: resolved.error });
				return;
			}
			const request = buildScanRequest(draft, method, resolved.secret, state.dshScan.fingerprint);
			const sentFingerprint = state.dshScan.fingerprint;
			const gen = generation;
			commit((previous) => ({ dshScan: {
				...previous.dshScan,
				status: "scanning",
				error: void 0
			} }));
			try {
				const result = await api.dshScan(request);
				if (gen !== generation) return;
				if (result.stage === "host-key") {
					commit({ dshScan: {
						status: "idle",
						candidates: [],
						fingerprint: result.fingerprint
					} });
					return;
				}
				commit((previous) => ({
					dshScan: {
						status: "ready",
						candidates: result.candidates,
						probe: result.probe,
						package: result.package
					},
					config: {
						...previous.config,
						reuseLauncherPath: pickCandidate(result.candidates, previous.config.reuseLauncherPath)
					},
					...sentFingerprint === void 0 || method === "wsl" ? {} : { trusted: {
						host: draft.host.trim(),
						port: Number(draft.port.trim()),
						username: draft.username.trim(),
						fingerprint: sentFingerprint
					} }
				}));
			} catch (error) {
				if (gen !== generation) return;
				commit({ dshScan: {
					status: "unavailable",
					candidates: [],
					error: toWireError(error).message
				} });
			}
		}
		/**
		* Select one scanned dsh as the one to reuse.
		*
		* Pure local state: the path is not a `patchConfig` edit (that would clear the
		* held secret) and nothing is sent to the host until 连接.
		* @param path - the candidate's launcher path.
		*/
		function selectDshCandidate(path) {
			commit((previous) => ({ config: {
				...previous.config,
				reuseLauncherPath: path
			} }));
		}
		/** Start (or retry) the connection attempt behind `/api/connect/start`. */
		async function startConnect() {
			const draft = state.config;
			const method = state.method;
			const wsl = method === "wsl";
			const invalid = validateDraft(draft, method);
			if (invalid !== void 0) {
				commit({
					view: "wizard",
					step: "config",
					error: invalid
				});
				return;
			}
			if (draft.connectionMode === "" || draft.connectionMode === "download") {
				commit({
					view: "wizard",
					step: "connect",
					error: validation("connect.mode.required")
				});
				return;
			}
			if (draft.connectionMode === "reuse" && draft.reuseLauncherPath.trim() === "") {
				commit({
					view: "wizard",
					step: "connect",
					error: validation("connect.mode.reuse.required")
				});
				return;
			}
			const resolved = wsl ? {
				ok: true,
				secret: void 0
			} : resolveSecret(draft);
			if (!resolved.ok) {
				commit({
					view: "wizard",
					step: "config",
					error: resolved.error
				});
				return;
			}
			let request;
			let endpoint;
			if (wsl) {
				const distro = draft.wslDistro.trim();
				const wslUser = draft.wslUser.trim();
				request = {
					kind: "wsl",
					label: draft.label.trim(),
					wslDistro: distro,
					...wslUser === "" ? {} : { wslUser }
				};
				endpoint = `${distro}${wslUser === "" ? "" : ` as ${wslUser}`}`;
			} else {
				const host = draft.host.trim();
				const port = Number(draft.port.trim());
				const username = draft.username.trim();
				request = {
					label: draft.label.trim(),
					host,
					port,
					username,
					authKind: draft.authKind
				};
				if (resolved.secret !== void 0) request.secret = resolved.secret;
				if (draft.authKind === "privateKey") request.privateKeyPath = draft.privateKeyPath.trim();
				if (draft.sshConfigAlias !== void 0 && draft.sshConfigAlias !== "") request.sshConfigAlias = draft.sshConfigAlias;
				const confirmed = trustedFingerprint(host, port, username);
				if (confirmed !== void 0) request.hostKeyFingerprint = confirmed;
				endpoint = `${host}:${port} as ${username}`;
			}
			const remote = buildRemote(draft);
			if (remote !== void 0) request.remote = remote;
			if (draft.connectionMode === "reuse") {
				request.packageSource = "reuse";
				request.reuseLauncherPath = draft.reuseLauncherPath.trim();
			} else if (draft.connectionMode === "upload") request.packageSource = "upload";
			setPendingSecret(resolved.secret);
			const gen = generation;
			commit((previous) => ({
				pending: true,
				view: "wizard",
				step: "connect",
				error: void 0,
				notice: void 0,
				connect: {
					...idleConnect(),
					phase: "running",
					log: [{
						time: (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", { hour12: false }),
						level: "info",
						text: `connecting to ${endpoint}`
					}]
				},
				config: {
					...previous.config,
					secret: ""
				}
			}));
			try {
				const { ticket } = await api.connectStart(request);
				if (gen !== generation) {
					commit({ pending: false });
					return;
				}
				commit((previous) => ({
					pending: false,
					connect: {
						...previous.connect,
						phase: "running",
						ticket
					}
				}));
				startStream(ticket, gen);
			} catch (error) {
				if (gen !== generation) return;
				commit((previous) => ({
					pending: false,
					connect: {
						...previous.connect,
						phase: "failed",
						error: toWireError(error)
					}
				}));
			}
		}
		function startStream(ticket, gen) {
			stopStream();
			try {
				closeStream = openConnectStream(ticket, {
					onFrame: (frame) => {
						if (gen !== generation) return;
						handleFrame(frame);
					},
					onTransportError: (message) => {
						if (gen !== generation) return;
						stopStream();
						const phase = state.connect.phase;
						if (phase === "failed" || phase === "succeeded") return;
						commit((previous) => ({ connect: {
							...previous.connect,
							phase: "failed",
							error: {
								code: "stream",
								message
							}
						} }));
					}
				});
			} catch (error) {
				commit((previous) => ({ connect: {
					...previous.connect,
					phase: "failed",
					error: toWireError(error)
				} }));
			}
		}
		function handleFrame(frame) {
			switch (frame.type) {
				case "step":
					appendLog(frame.status === "failed" ? "error" : "info", frame.message === void 0 ? `${frame.step} ${frame.status}` : frame.message);
					commit((previous) => ({ connect: {
						...previous.connect,
						steps: {
							...previous.connect.steps,
							[frame.step]: {
								status: frame.status,
								...frame.message === void 0 ? {} : { message: frame.message },
								...frame.detail === void 0 ? {} : { detail: frame.detail }
							}
						}
					} }));
					return;
				case "host-key":
					appendLog("info", t("connect.log.hostKey", { fingerprint: frame.fingerprint }));
					commit((previous) => ({ connect: {
						...previous.connect,
						phase: "awaiting-hostkey",
						hostKey: {
							fingerprint: frame.fingerprint,
							...frame.algorithm === void 0 ? {} : { algorithm: frame.algorithm },
							answering: false,
							trusted: false
						}
					} }));
					return;
				case "done": {
					stopStream();
					setPendingSecret(void 0);
					const target = frame.target;
					appendLog("ok", t("connect.log.done", { label: target.label }));
					const trusted = target.hostKeyFingerprint === "" ? state.trusted : {
						host: target.host,
						port: target.port,
						username: target.username,
						fingerprint: target.hostKeyFingerprint
					};
					commit((previous) => ({
						view: "list",
						step: "method",
						notice: {
							kind: "success",
							text: t("connect.succeeded.list")
						},
						connect: {
							...idleConnect(),
							phase: "succeeded",
							target
						},
						directory: emptyDirectory(),
						expanded: {
							...previous.expanded,
							[targetNodeKey(target.id)]: true
						},
						trusted: trusted ?? previous.trusted
					}));
					refreshState();
					return;
				}
				case "error":
					appendLog("error", `${frame.code}: ${frame.message}`);
					stopStream();
					commit((previous) => ({ connect: {
						...previous.connect,
						phase: "failed",
						hostKey: void 0,
						error: {
							code: frame.code,
							message: frame.message
						}
					} }));
			}
		}
		/** Accept the shown host-key fingerprint (never automatic). */
		async function confirmHostKey() {
			const { ticket, hostKey } = state.connect;
			if (ticket === void 0 || hostKey === void 0 || hostKey.answering || hostKey.trusted) return;
			commit((previous) => ({
				connect: {
					...previous.connect,
					hostKey: {
						...hostKey,
						answering: true
					}
				},
				error: void 0
			}));
			try {
				await api.hostkeyConfirm(ticket, hostKey.fingerprint);
				const draft = state.config;
				commit((previous) => ({
					trusted: {
						host: draft.host.trim(),
						port: Number(draft.port.trim()),
						username: draft.username.trim(),
						fingerprint: hostKey.fingerprint
					},
					connect: {
						...previous.connect,
						phase: "running",
						hostKey: {
							...hostKey,
							answering: false,
							trusted: true
						}
					}
				}));
			} catch (error) {
				commit((previous) => ({
					error: toWireError(error),
					connect: {
						...previous.connect,
						hostKey: {
							...hostKey,
							answering: false
						}
					}
				}));
			}
		}
		/**
		* Abandon a pending attempt and stay on step 3.
		*
		* Step 3 owns the whole attempt (method choice, progress, host-key), so
		* cancelling rewinds the attempt — not the step: the user is exactly where they
		* choose another mode or retry. The held secret stays (only leaving the wizard
		* drops it), so 重试 works without typing the password again.
		*/
		function cancelConnect() {
			stopStream();
			commit({
				step: "connect",
				error: void 0,
				notice: void 0,
				connect: idleConnect(),
				directory: emptyDirectory()
			});
		}
		/** Browse one remote directory of the connected (or saved) target. */
		async function loadDirectory(targetId, path) {
			return await withConnecting(async () => {
				const gen = generation;
				commit((previous) => ({ directory: {
					...previous.directory,
					open: true,
					targetId,
					loading: true,
					error: void 0
				} }));
				try {
					const listing = await api.listDir(targetId, path);
					if (gen !== generation) return;
					commit((previous) => ({ directory: {
						...previous.directory,
						listing,
						loading: false,
						connecting: false,
						error: void 0,
						pathInput: listing.path,
						newDirName: "",
						title: previous.directory.titleTouched && previous.directory.title !== "" ? previous.directory.title : basename(listing.path)
					} }));
				} catch (error) {
					if (gen !== generation) return;
					commit((previous) => ({ directory: {
						...previous.directory,
						loading: false,
						connecting: false,
						error: toWireError(error)
					} }));
				}
			});
		}
		/**
		* Open the 添加工作区 dialog on its browse tab, connecting the target first if
		* its channel is down.
		*
		* `list-dir` runs through the host's cached browser client, which re-provisions
		* a cold target on its own — seconds to tens of seconds. The dialog therefore
		* has to show a 连接中 state while that call is in flight; the wizard used to
		* express this with an entire step, and without it the pane just sits empty.
		* @param target - the connection row's target.
		*/
		async function openBrowseDirectory(target) {
			const gen = generation;
			commit((previous) => ({
				addWorkspace: {
					targetId: target.id,
					targetLabel: target.label,
					tab: "browse",
					loading: previous.addWorkspace?.loading ?? false,
					items: previous.addWorkspace?.items ?? []
				},
				error: void 0,
				directory: {
					...emptyDirectory(),
					open: true,
					targetId: target.id
				}
			}));
			if (target.status !== "ready") {
				commit((previous) => ({ directory: {
					...previous.directory,
					connecting: true
				} }));
				try {
					await api.connect(target.id);
					if (gen !== generation) return;
					await refreshState();
					if (gen !== generation) return;
				} catch (error) {
					if (gen !== generation) return;
					commit((previous) => ({ directory: {
						...previous.directory,
						connecting: false,
						error: toWireError(error)
					} }));
					return;
				}
				commit((previous) => ({ directory: {
					...previous.directory,
					connecting: false
				} }));
			}
			await loadDirectory(target.id, "");
		}
		/** Switch the 添加工作区 dialog between its two tabs, loading what the tab needs. */
		function setAddWorkspaceTab(tab) {
			const dialog = state.addWorkspace;
			if (dialog === void 0 || dialog.tab === tab) return;
			commit((previous) => ({ addWorkspace: previous.addWorkspace === void 0 ? void 0 : {
				...previous.addWorkspace,
				tab
			} }));
			if (tab === "registry") {
				refreshAddWorkspace();
				return;
			}
			const target = state.targets.find((candidate) => candidate.id === dialog.targetId);
			if (target === void 0) return;
			if (state.directory.targetId === target.id && state.directory.listing !== void 0) return;
			openBrowseDirectory(target);
		}
		function setNewDirName(name) {
			commit((previous) => ({ directory: {
				...previous.directory,
				newDirName: name
			} }));
		}
		function setDirectoryTitle(title) {
			commit((previous) => ({ directory: {
				...previous.directory,
				title,
				titleTouched: true
			} }));
		}
		function setPathInput(path) {
			commit((previous) => ({ directory: {
				...previous.directory,
				pathInput: path
			} }));
		}
		/** Create a directory under the current one, then enter it. */
		async function createDirectory() {
			const { targetId, listing, newDirName, creating } = state.directory;
			const name = newDirName.trim();
			if (targetId === void 0 || listing === void 0 || name === "" || creating) return;
			const path = joinPath(listing.path, name);
			const gen = generation;
			commit((previous) => ({ directory: {
				...previous.directory,
				creating: true,
				error: void 0
			} }));
			try {
				await api.mkdir(targetId, path);
				if (gen !== generation) return;
				commit({
					directory: {
						...state.directory,
						creating: false,
						newDirName: ""
					},
					notice: {
						kind: "success",
						text: t("directory.newDir.created", { path })
					}
				});
				await loadDirectory(targetId, path);
			} catch (error) {
				if (gen !== generation) return;
				commit((previous) => ({ directory: {
					...previous.directory,
					creating: false,
					error: toWireError(error)
				} }));
			}
		}
		/** Open the browsed directory as a workspace; the dialog closes on success. */
		async function openWorkspace() {
			return await withConnecting(async () => {
				const { targetId, listing, title } = state.directory;
				if (targetId === void 0 || listing === void 0 || state.pending) return;
				const gen = generation;
				commit({
					pending: true,
					error: void 0
				});
				try {
					const trimmed = title.trim();
					const result = await api.openWorkspace(targetId, listing.path, trimmed === "" ? void 0 : trimmed);
					if (gen !== generation) return;
					commit((previous) => ({
						pending: false,
						view: "list",
						step: "method",
						addWorkspace: void 0,
						directory: emptyDirectory(),
						connect: idleConnect(),
						notice: {
							kind: "success",
							text: t("directory.opened", { title: result.workspace.title })
						},
						expanded: {
							...previous.expanded,
							[targetNodeKey(targetId)]: true
						}
					}));
					revealSession(result.sessionId, targetId);
					refreshState();
				} catch (error) {
					if (gen !== generation) return;
					commit({
						pending: false,
						error: toWireError(error)
					});
				}
			});
		}
		/**
		* Ask for a new title for one remote workspace.
		*
		* Only the plugin's own record changes (the host rewrites `title`), never the
		* remote directory: the directory is what every stored session's header points
		* at, and a network `mv` has no rollback (architecture A7).
		* @param workspace - the workspace row's record.
		*/
		function requestWorkspaceRename(workspace) {
			commit({ renameWorkspace: {
				workspace,
				title: workspace.title
			} });
		}
		/** Close the 重命名工作区 dialog without acting. */
		function settleWorkspaceRename() {
			commit({ renameWorkspace: void 0 });
		}
		/**
		* Apply one workspace rename through the host and refresh the tree.
		*
		* Like the session rename, the dialog owns its own lifetime: this action keeps
		* `renameWorkspace` set so the form can show a failure inline, and the caller
		* closes it on success (`settleWorkspaceRename`).
		* @param title - the new title (the host normalizes it too).
		*/
		async function acceptWorkspaceRename(title) {
			const pending = state.renameWorkspace;
			const trimmed = title.trim();
			if (pending === void 0 || trimmed === "") return;
			const gen = generation;
			commit({
				pending: true,
				error: void 0
			});
			try {
				await api.workspaceRename(pending.workspace.id, trimmed);
				if (gen !== generation) return;
				commit({
					pending: false,
					notice: {
						kind: "success",
						text: t("tree.workspace.renamed", { title: trimmed })
					}
				});
				await refreshState();
			} catch (error) {
				if (gen !== generation) return;
				commit({ pending: false });
				throw error;
			}
		}
		async function forgetTarget(target) {
			if (state.pending) return;
			const gen = generation;
			commit({
				pending: true,
				error: void 0
			});
			releaseShellSelection(target.id);
			try {
				await api.forgetTarget(target.id);
				if (gen !== generation) return;
				for (const [sessionId, owner] of revealedSessions) if (owner === target.id) revealedSessions.delete(sessionId);
				commit({
					pending: false,
					notice: {
						kind: "success",
						text: t("list.forgotTarget", { label: target.label })
					}
				});
				await refreshState();
			} catch (error) {
				if (gen !== generation) return;
				commit({
					pending: false,
					error: toWireError(error)
				});
			}
		}
		async function forgetWorkspace(workspace) {
			if (state.pending) return;
			const gen = generation;
			commit({
				pending: true,
				error: void 0
			});
			try {
				await api.forgetWorkspace(workspace.id);
				if (gen !== generation) return;
				commit({
					pending: false,
					notice: {
						kind: "success",
						text: t("list.forgotWorkspace", { title: workspace.title })
					}
				});
				await refreshState();
			} catch (error) {
				if (gen !== generation) return;
				commit({
					pending: false,
					error: toWireError(error)
				});
			}
		}
		async function stopTarget(target) {
			if (state.pending) return;
			const gen = generation;
			commit({
				pending: true,
				error: void 0
			});
			releaseShellSelection(target.id);
			try {
				const { stopped } = await api.stopTarget(target.id);
				if (gen !== generation) return;
				commit({
					pending: false,
					notice: stopped ? {
						kind: "success",
						text: t("list.stopped", { label: target.label })
					} : {
						kind: "error",
						text: t("list.stopUnsupported", { label: target.label })
					}
				});
				if (stopped) collapseTarget(target.id);
				if (stopped && state.directory.targetId === target.id) commit({
					directory: emptyDirectory(),
					addWorkspace: void 0
				});
				await refreshState();
			} catch (error) {
				if (gen !== generation) return;
				commit({
					pending: false,
					error: toWireError(error)
				});
			}
		}
		/** Re-open a saved remote workspace (the host recreates its session). */
		async function reopenWorkspace(workspace) {
			return await withConnecting(async () => {
				if (state.pending) return;
				const gen = generation;
				commit({
					pending: true,
					error: void 0
				});
				try {
					const result = await api.openWorkspace(workspace.targetId, workspace.path, workspace.title);
					if (gen !== generation) return;
					commit({
						pending: false,
						notice: {
							kind: "success",
							text: t("directory.opened", { title: result.workspace.title })
						}
					});
					revealSession(result.sessionId, workspace.targetId);
					await refreshState();
					refreshSessionsFor(result.workspace);
				} catch (error) {
					if (gen !== generation) return;
					commit({
						pending: false,
						error: toWireError(error)
					});
				}
			});
		}
		/** Tree-node key for one connection node. */
		function targetNodeKey(targetId) {
			return `target:${targetId}`;
		}
		/** Tree-node key for one workspace node. */
		function workspaceNodeKey(workspaceId) {
			return `workspace:${workspaceId}`;
		}
		/** Drop one workspace's cached session list so the next expand reloads it. */
		function invalidateSessions(workspaceId) {
			commit((previous) => {
				const sessions = { ...previous.sessions };
				delete sessions[workspaceId];
				return { sessions };
			});
		}
		/**
		* Reload one workspace's session list, but only while its node is open.
		*
		* Starting or continuing a session changes that list, so an open node must not
		* keep showing the pre-action contents; a collapsed node simply drops its cache
		* and loads again on the next expand.
		*/
		function refreshSessionsFor(workspace) {
			invalidateSessions(workspace.id);
			if (state.expanded[workspaceNodeKey(workspace.id)] === true) loadSessions(workspace, true);
		}
		/** Expand or collapse one tree node; expanding a workspace loads its sessions. */
		function toggleNode(key) {
			const expanded = {
				...state.expanded,
				[key]: !(state.expanded[key] ?? false)
			};
			commit({ expanded });
			if (!expanded[key]) return;
			const workspaceId = key.startsWith("workspace:") ? key.slice(10) : void 0;
			if (workspaceId === void 0) return;
			const workspace = state.workspaces.find((candidate) => candidate.id === workspaceId);
			if (workspace !== void 0) loadSessions(workspace);
		}
		/** Load (or reload) the remote session list of one saved workspace. */
		async function loadSessions(workspace, force = false) {
			const cached = state.sessions[workspace.id];
			if (cached !== void 0 && (cached.loading || cached.loaded && !force)) return;
			const gen = generation;
			commit((previous) => ({ sessions: {
				...previous.sessions,
				[workspace.id]: {
					loading: true,
					loaded: cached?.loaded ?? false,
					items: cached?.items ?? []
				}
			} }));
			try {
				const value = await api.sessions(workspace.targetId, workspace.id);
				if (gen !== generation) return;
				commit((previous) => ({ sessions: {
					...previous.sessions,
					[workspace.id]: {
						loading: false,
						loaded: true,
						items: value.sessions
					}
				} }));
			} catch (error) {
				if (gen !== generation) return;
				commit((previous) => ({ sessions: {
					...previous.sessions,
					[workspace.id]: {
						loading: false,
						loaded: true,
						items: cached?.items ?? [],
						error: toWireError(error)
					}
				} }));
			}
		}
		/**
		* Open one stored remote session — what a click on a session row does.
		*
		* The host resumes it through the official agent-resume path, so the history
		* comes back from the remote log; the shell then adopts the live session like
		* any local one.
		*/
		async function openSession(workspace, session) {
			return await withConnecting(async () => {
				if (state.pending) return;
				const gen = generation;
				commit({
					pending: true,
					error: void 0
				});
				try {
					const result = await api.openSession(workspace.targetId, workspace.path, session.id, workspace.title);
					if (gen !== generation) return;
					commit({
						pending: false,
						currentSessionId: result.sessionId,
						notice: {
							kind: "success",
							text: t("tree.session.opened", { title: session.title ?? shortSessionId(session.id) })
						}
					});
					revealSession(result.sessionId, workspace.targetId);
					await refreshState();
					refreshSessionsFor(workspace);
				} catch (error) {
					if (gen !== generation) return;
					const wire = toWireError(error);
					commit({
						pending: false,
						error: wire,
						notice: {
							kind: "error",
							text: t("tree.session.openFailed", { message: wire.message })
						}
					});
				}
			});
		}
		/** Short, human-scannable form of a session id. */
		function shortSessionId(id) {
			const trimmed = id.startsWith("session-") ? id.slice(8) : id;
			return trimmed.length <= 8 ? trimmed : trimmed.slice(0, 8);
		}
		/**
		* Open the 添加工作区 dialog for one connection.
		*
		* The default tab is 浏览目录 (the requirement: adding a workspace means picking
		* a remote directory), so opening the dialog is opening the browser — including
		* its connect-first step when the channel is down.
		* @param target - the connection row's target.
		*/
		async function openAddWorkspace(target) {
			await openBrowseDirectory(target);
		}
		function closeAddWorkspace() {
			commit({
				addWorkspace: void 0,
				directory: emptyDirectory()
			});
		}
		/** (Re)read the remote dsh's own workspace registry for the open picker. */
		async function refreshAddWorkspace() {
			const dialog = state.addWorkspace;
			if (dialog === void 0) return;
			const gen = generation;
			commit((previous) => ({ addWorkspace: previous.addWorkspace === void 0 ? void 0 : {
				...previous.addWorkspace,
				loading: true,
				error: void 0
			} }));
			try {
				const value = await api.remoteWorkspaces(dialog.targetId);
				if (gen !== generation) return;
				commit((previous) => ({ addWorkspace: previous.addWorkspace === void 0 ? void 0 : {
					...previous.addWorkspace,
					loading: false,
					items: value.workspaces
				} }));
			} catch (error) {
				if (gen !== generation) return;
				commit((previous) => ({ addWorkspace: previous.addWorkspace === void 0 ? void 0 : {
					...previous.addWorkspace,
					loading: false,
					error: toWireError(error)
				} }));
			}
		}
		/** Adopt one workspace the remote dsh has registered (reg.list → open). */
		async function adoptRemoteWorkspace(entry) {
			const dialog = state.addWorkspace;
			if (dialog === void 0 || state.pending) return;
			return await withConnecting(async () => {
				const gen = generation;
				commit({
					pending: true,
					error: void 0
				});
				try {
					const result = await api.openWorkspace(dialog.targetId, entry.path, entry.title);
					if (gen !== generation) return;
					commit((previous) => ({
						pending: false,
						addWorkspace: void 0,
						directory: emptyDirectory(),
						notice: {
							kind: "success",
							text: t("directory.opened", { title: result.workspace.title })
						},
						expanded: {
							...previous.expanded,
							[targetNodeKey(dialog.targetId)]: true
						}
					}));
					revealSession(result.sessionId, dialog.targetId);
					await refreshState();
				} catch (error) {
					if (gen !== generation) return;
					commit({
						pending: false,
						error: toWireError(error)
					});
				}
			});
		}
		/** Open one connected host's node, keeping its children visible. */
		function expandTarget(targetId) {
			commit((previous) => ({ expanded: {
				...previous.expanded,
				[targetNodeKey(targetId)]: true
			} }));
		}
		/**
		* Bring one connection up (or back up) without leaving the tree.
		*
		* This is the gate the product requires — a connection has a state, and only a
		* *connected* connection can have workspaces or sessions. It is deliberately
		* narrower than the 添加工作区 dialog's own connect-first step, which additionally
		* lists a directory afterwards.
		*/
		async function connectTarget(target) {
			return await withConnecting(async () => {
				if (state.pending) return;
				const gen = generation;
				commit({
					pending: true,
					error: void 0
				});
				try {
					const { target: connected } = await api.connect(target.id);
					if (gen !== generation) return;
					commit({
						pending: false,
						notice: {
							kind: "success",
							text: t("tree.conn.connectedNotice", { label: connected.label })
						},
						expanded: {
							...state.expanded,
							[targetNodeKey(target.id)]: true
						}
					});
					await refreshState();
				} catch (error) {
					if (gen !== generation) return;
					commit({
						pending: false,
						error: toWireError(error)
					});
					await refreshState();
				}
			});
		}
		/**
		* Open a saved remote workspace: continue its last session when it has one,
		* otherwise start a fresh one.
		*
		* A recorded session can be unreadable (a log written by a pre-0.1.0 build, or
		* a session another device is writing right now). That is a recoverable state,
		* not a dead end: the workspace falls back to a new session and the reason is
		* reported instead of leaving the user with a stuck row.
		*/
		async function openWorkspaceRecord(workspace) {
			const sessionId = workspace.sessionId;
			if (sessionId === void 0 || sessionId === "") {
				await reopenWorkspace(workspace);
				return;
			}
			return await withConnecting(async () => {
				if (state.pending) return;
				const gen = generation;
				commit({
					pending: true,
					error: void 0
				});
				try {
					const result = await api.openSession(workspace.targetId, workspace.path, sessionId, workspace.title);
					if (gen !== generation) return;
					commit({
						pending: false,
						currentSessionId: result.sessionId,
						notice: {
							kind: "success",
							text: t("tree.session.opened", { title: workspace.title })
						}
					});
					revealSession(result.sessionId, workspace.targetId);
					await refreshState();
					refreshSessionsFor(workspace);
				} catch (error) {
					if (gen !== generation) return;
					commit({
						pending: false,
						notice: {
							kind: "error",
							text: t("tree.session.fallback", { message: toWireError(error).message })
						}
					});
					await reopenWorkspace(workspace);
				}
			});
		}
		/**
		* Fold a connection's whole subtree away.
		*
		* A connection that is down has nothing to show: its workspace rows and their
		* session rows were reachable only through the channel that just went away, so
		* they collapse with it. The flags are cleared rather than merely hidden, so the
		* tree's own state agrees with what is rendered.
		*
		* Connecting again is a separate event and does expand the node again
		* ({@link connectTarget}): a fresh channel is exactly when its workspaces are
		* worth showing. Only the *disconnect* folds the subtree away.
		* @param targetId - the connection whose subtree collapses.
		*/
		function collapseTarget(targetId) {
			const collapsed = [];
			if (state.expanded[targetNodeKey(targetId)] === true) collapsed.push(targetNodeKey(targetId));
			for (const workspace of state.workspaces.filter((candidate) => candidate.targetId === targetId)) {
				const key = workspaceNodeKey(workspace.id);
				if (state.expanded[key] === true) collapsed.push(key);
			}
			if (collapsed.length === 0) return;
			commit((previous) => {
				const expanded = { ...previous.expanded };
				for (const key of collapsed) delete expanded[key];
				return { expanded };
			});
		}
		/** Table of the store's actions, as the components consume them. */
		const store = {
			closeOverlay,
			newConnection,
			openConnectionWizard,
			setStep,
			setMethod,
			patchConfig,
			dismissError,
			dismissNotice,
			notifySuccess,
			notifyError,
			loadAliases,
			loadWslDistros,
			chooseAlias,
			setConnectionMode,
			scanDsh,
			selectDshCandidate,
			startConnect,
			confirmHostKey,
			cancelConnect,
			loadDirectory,
			setNewDirName,
			setDirectoryTitle,
			setPathInput,
			createDirectory,
			openWorkspace,
			forgetTarget,
			forgetWorkspace,
			stopTarget,
			reopenWorkspace,
			openWorkspaceRecord,
			refreshState,
			isConnectBlocking: () => isConnectBlocking(state),
			toggleNode,
			loadSessions,
			openSession,
			setSessionFlag,
			renameSession,
			refreshSessions,
			revealSessionId,
			requestRename,
			settleRename,
			requestForgetTarget,
			requestForgetWorkspace,
			settleConfirm,
			acceptConfirm,
			openAddWorkspace,
			closeAddWorkspace,
			setAddWorkspaceTab,
			refreshAddWorkspace,
			adoptRemoteWorkspace,
			openBrowseDirectory,
			requestWorkspaceRename,
			settleWorkspaceRename,
			acceptWorkspaceRename,
			expandTarget,
			connectTarget
		};
		/**
		* Dispose every side effect the store owns: close the live SSE stream (its
		* ticket is one-shot, so a hot reload cannot resume it) and drop the
		* in-flight secret. The rendered snapshot stays, so a hot-reloaded overlay
		* shows the attempt as failed and offers a retry.
		*/
		function dispose() {
			stopStream();
			setPendingSecret(void 0);
			const phase = state.connect.phase;
			if (phase === "running" || phase === "awaiting-hostkey") commit((previous) => ({ connect: {
				...previous.connect,
				phase: "failed",
				hostKey: void 0,
				error: {
					code: "disposed",
					message: t("connect.stream.closed")
				}
			} }));
		}
		//#endregion
		//#region src/client/directory-picker.tsx
		/** Breadcrumb segments (each with its absolute path) for one remote path. */
		function crumbs(path) {
			const root = {
				label: t("directory.root"),
				path: "/"
			};
			if (path === "" || path === "/") return [root];
			const segments = [root];
			let cumulative = "";
			for (const part of path.split("/")) {
				if (part === "") continue;
				cumulative += `/${part}`;
				segments.push({
					label: part,
					path: cumulative
				});
			}
			return segments;
		}
		/** Row for one remote directory entry. */
		function EntryRow(props) {
			const isDirectory = props.entry.type === "directory";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "dsh-rw-entry",
				"data-type": props.entry.type,
				disabled: !isDirectory,
				onClick: () => {
					if (isDirectory) props.onOpen(props.entry);
				},
				title: props.entry.path,
				children: [
					isDirectory ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderCloseRegular, { size: 14 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDeliverDocRegular, { size: 14 }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-rw-entry-name",
						children: props.entry.name
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-rw-entry-kind",
						children: isDirectory ? t("common.directory") : props.entry.type === "file" ? t("common.file") : props.entry.type
					})
				]
			});
		}
		/**
		* The browser itself.
		*
		* Rendered while the dialog is open. The host re-establishes the channel on the
		* first `list-dir` of a cold target, so both loading states matter: `connecting`
		* is the multi-second channel build (opened by `store.openBrowseDirectory`) and
		* `loading` a plain read.
		*/
		function DirectoryPicker() {
			const { directory } = useAppState();
			const targetId = directory.targetId;
			const listing = directory.listing;
			const open = (path) => {
				if (targetId === void 0) return;
				store.loadDirectory(targetId, path);
			};
			if (!directory.open || targetId === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-rw-section",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyState, { text: t("directory.noTarget") })
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-section",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-rw-inline",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "ghost",
								size: "sm",
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronLeftOutlineRegular, { size: 12 }),
								disabled: listing?.parent === void 0 || directory.loading,
								onClick: () => {
									if (listing?.parent !== void 0) open(listing.parent);
								},
								children: t("directory.parent")
							}),
							listing !== void 0 && listing.home !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "ghost",
								size: "sm",
								disabled: directory.loading,
								onClick: () => {
									open(listing.home);
								},
								children: t("directory.home")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "ghost",
								size: "sm",
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 12 }),
								"aria-label": t("common.refresh"),
								disabled: directory.loading,
								onClick: () => {
									open(listing?.path ?? "");
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								className: "dsh-rw-grow",
								"data-step-focus": true,
								value: directory.pathInput,
								"aria-label": t("directory.crumbs.aria"),
								placeholder: t("directory.path.placeholder"),
								onChange: (event) => {
									store.setPathInput(event.target.value);
								},
								onKeyDown: (event) => {
									if (event.key !== "Enter") return;
									event.preventDefault();
									open(event.currentTarget.value.trim());
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								size: "sm",
								disabled: directory.loading,
								onClick: () => {
									open(directory.pathInput.trim());
								},
								children: t("directory.path.goto")
							})
						]
					}),
					listing !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("nav", {
						className: "dsh-rw-crumbs",
						"aria-label": t("directory.crumbs.aria"),
						children: crumbs(listing.path).map((crumb, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [index > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-rw-crumb-separator",
							children: "/"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsh-rw-crumb",
							"aria-current": crumb.path === listing.path ? "true" : void 0,
							disabled: directory.loading,
							onClick: () => {
								open(crumb.path);
							},
							children: crumb.label
						})] }, crumb.path))
					}),
					directory.connecting && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoadingLine, { text: t("directory.connecting") }),
					directory.loading && !directory.connecting && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoadingLine, { text: t("directory.loading") }),
					listing !== void 0 && !directory.loading && (listing.entries.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyState, { text: t("directory.empty") }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-rw-entries",
						children: sortEntries(listing.entries).map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EntryRow, {
							entry,
							onOpen: () => {
								open(entry.path);
							}
						}, entry.path))
					})),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-rw-inline",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
							className: "dsh-rw-grow",
							value: directory.newDirName,
							"aria-label": t("directory.newDir"),
							placeholder: t("directory.newDir.placeholder"),
							onChange: (event) => {
								store.setNewDirName(event.target.value);
							},
							onKeyDown: (event) => {
								if (event.key !== "Enter") return;
								event.preventDefault();
								store.createDirectory();
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							size: "sm",
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 12 }),
							disabled: directory.creating || directory.newDirName.trim() === "",
							onClick: () => {
								store.createDirectory();
							},
							children: t("directory.newDir.create")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
						label: t("directory.titleField"),
						hint: t("directory.titleField.placeholder"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
							value: directory.title,
							"aria-label": t("directory.titleField"),
							onChange: (event) => {
								store.setDirectoryTitle(event.target.value);
							}
						})
					}),
					directory.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorBanner, { error: directory.error })
				]
			});
		}
		//#endregion
		//#region src/client/confirm-dialog.tsx
		/** The dialog host: one form while a request is pending, nothing otherwise. */
		function ConfirmDialog() {
			const owned = useSingleHost("confirm");
			const state = useAppState();
			const pending = state.confirm;
			if (!owned || pending === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: store.settleConfirm,
				closeLabel: t("common.cancel"),
				title: pending.title,
				description: pending.message,
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					onClick: store.settleConfirm,
					children: t("common.cancel")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					disabled: state.pending,
					onClick: () => {
						store.acceptConfirm();
					},
					children: pending.confirmLabel
				})] }),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {})
			});
		}
		//#endregion
		//#region src/client/vendor/workspace-rows/generated/locales.ts
		/**
		* GENERATED by scripts/vendor-workspace-rows.mjs — do not edit by hand.
		* Source: packages/client/ui-workspace/src/client/locales.ts
		* Re-run the script after a DSH upgrade; see ../NOTICE.md.
		*/
		/**
		* `workspace` namespace dictionaries: the browsing region (section header,
		* search, tree rows, dialogs) and the pick/add flow. Runtime failure
		* messages (wire error strings) pass through untranslated by policy.
		*/
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"defaultWorkspace.failed": "无法创建默认工作区，请通过“选择工作区”选择文件夹",
			"group.ungrouped": "未分组",
			"session.new": "新会话",
			"session.untitled": "未命名",
			"shortcut.noSession": "请先选择一个会话",
			"shortcut.noPicker": "目录选择器不可用",
			"shortcut.directoryBusy": "正在选择或添加工作区",
			"shortcut.noCompletedTurn": "当前会话没有已结束的轮次",
			"shortcut.forkFailed": "无法分叉会话，请重试",
			"section.workspaces": "工作区",
			"section.sessions": "会话",
			"viewOptions.label": "视图选项",
			"groupBy.label": "分组方式",
			"groupBy.workspace": "按工作区",
			"groupBy.workspaceTree": "按工作区树",
			"groupBy.flat": "单列表",
			"orderBy.label": "排序方式",
			"orderBy.manual": "手动排序",
			"orderBy.updated": "最近更新",
			"filterBy.label": "筛选会话",
			"viewOptions.hideArchived": "隐藏已归档",
			"viewOptions.showArchived": "全部对话（显示已归档）",
			"viewOptions.onlyArchived": "仅显示已归档",
			"sessions.expand": "展开其余 {n} 个会话",
			"sessions.collapse": "收起",
			"empty.none": "暂无会话",
			"empty.noneArchived": "暂无已归档会话",
			"empty.viewOthers": "查看其他会话",
			"empty.noMatches": "无匹配结果",
			"workspace.add": "添加工作区",
			"search.sessions.aria": "搜索会话",
			"search.placeholder": "搜索会话名称",
			"search.clear": "清除搜索",
			"search.results.aria": "搜索结果",
			"search.pending": "正在搜索会话历史…",
			"search.noMatches": "无匹配会话",
			"search.hasMore": "仅显示前 {n} 条结果，请缩小搜索范围。",
			"menu.addWorkspace": "添加工作区…",
			"picker.loading": "正在加载工作区…",
			"conflict.named": "已存在名为“{name}”的工作区。",
			"folderError.title": "无法打开文件夹",
			"folderError.retry": "重新选择",
			"rename": "重命名",
			"rename.workspace.title": "重命名工作区",
			"rename.session.title": "重命名会话",
			"field.workspaceName": "工作区名称",
			"field.sessionName": "会话名称",
			"delete.workspace": "删除工作区",
			"delete.desc": "将把“{name}”从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在“未分组”下。",
			"delete.pending": "正在删除工作区…",
			"menu.fork": "分叉会话",
			"menu.archiveSession": "归档会话",
			"menu.unarchiveSession": "取消归档",
			"menu.pinSession": "置顶会话",
			"menu.unpinSession": "取消置顶",
			"row.archived": "已归档",
			"row.pinned": "已置顶",
			"toast.archivedNotOpenable": "已归档对话暂时无法查看，请取消归档后查看",
			"toast.archived": "会话已归档，可",
			"toast.stoppedAndArchived": "已停止并归档，可",
			"archive.confirm.title": "停止并归档此会话？",
			"archive.confirm.desc": "“{title}”仍有正在进行的工作。归档会先停止这些工作；之后可在侧栏筛选“全部对话（显示已归档）”中恢复会话，被停止的工作不会自动继续。",
			"archive.confirm.activity": "将被停止的工作",
			"archive.confirm.turn": "进行中的回合",
			"archive.confirm.subagents.one": "{n} 个运行中的子智能体：{names}",
			"archive.confirm.subagents.other": "{n} 个运行中的子智能体：{names}",
			"archive.confirm.jobs.one": "{n} 个后台任务：{names}",
			"archive.confirm.jobs.other": "{n} 个后台任务：{names}",
			"archive.confirm.schedules.one": "{n} 条定时提醒：{names}",
			"archive.confirm.schedules.other": "{n} 条定时提醒：{names}",
			"archive.confirm.other.one": "{n} 项其他工作（{kind}）",
			"archive.confirm.other.other": "{n} 项其他工作（{kind}）",
			"archive.confirm.listSeparator": "、",
			"archive.confirm.action": "停止并归档",
			"archive.confirm.pending": "正在停止并归档…",
			"toast.archivedUndo": "撤销",
			"toast.archivedOr": "或",
			"toast.archivedFilter": "筛选已归档会话",
			"toast.pinFailed": "置顶失败，请稍后重试",
			"toast.unpinFailed": "取消置顶失败，请稍后重试",
			"toast.createFailed": "新建会话失败：{message}",
			"sessions.count.one": "{n} 个会话",
			"sessions.count.other": "{n} 个会话",
			"actions.workspace.aria": "工作区“{name}”的操作",
			"actions.session.aria": "会话“{name}”的操作",
			"actions.archive": "归档会话",
			"actions.unarchive": "取消归档",
			"actions.pin": "置顶会话",
			"actions.unpin": "取消置顶",
			"actions.newSession": "新会话",
			"actions.newSession.aria": "在“{name}”中新建会话",
			"status.running": "进行中",
			"status.subagentsRunning.one": "{n} 个子智能体运行中",
			"status.subagentsRunning.other": "{n} 个子智能体运行中",
			"status.idle": "空闲",
			"status.waitingApproval": "等待审批",
			"status.planReview": "计划待审",
			"status.waitingAnswer": "等待回答",
			"status.compact.approval": "待审批",
			"status.compact.planReview": "计划待审",
			"status.compact.answer": "待回答",
			"status.completed": "已完成",
			"hover.created": "创建于 {time}",
			"hover.copied": "已复制",
			"date.ymd": "{y}年{m}月{d}日",
			"time.now": "刚刚",
			"time.minutes": "{n}分钟",
			"time.hours": "{n}小时",
			"time.days": "{n}天",
			"time.months": "{n}个月",
			"time.years": "{n}年",
			"time.ago": "{t}前"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"defaultWorkspace.failed": "Unable to create default workspace. Use Choose workspace to select a folder.",
			"group.ungrouped": "Ungrouped",
			"session.new": "New Session",
			"session.untitled": "Untitled",
			"shortcut.noSession": "Select a session first",
			"shortcut.noPicker": "Directory picker unavailable",
			"shortcut.directoryBusy": "Selecting or adding a workspace",
			"shortcut.noCompletedTurn": "This session has no completed turn",
			"shortcut.forkFailed": "Could not fork the session. Try again.",
			"section.workspaces": "Workspaces",
			"section.sessions": "Sessions",
			"viewOptions.label": "View options",
			"groupBy.label": "Group by",
			"groupBy.workspace": "WorkSpace",
			"groupBy.workspaceTree": "Workspace Tree",
			"groupBy.flat": "In one list",
			"orderBy.label": "Order by",
			"orderBy.manual": "Manual",
			"orderBy.updated": "Last updated",
			"filterBy.label": "Filter sessions",
			"viewOptions.hideArchived": "Hide archived",
			"viewOptions.showArchived": "All conversations (show archived)",
			"viewOptions.onlyArchived": "Archived only",
			"sessions.expand": "Show {n} more sessions",
			"sessions.collapse": "Show less",
			"empty.none": "No sessions yet",
			"empty.noneArchived": "No archived sessions yet",
			"empty.viewOthers": "View other sessions",
			"empty.noMatches": "No matches",
			"workspace.add": "Add workspace",
			"search.sessions.aria": "Search sessions",
			"search.placeholder": "Search session names",
			"search.clear": "Clear search",
			"search.results.aria": "Search results",
			"search.pending": "Searching session history…",
			"search.noMatches": "No matching sessions",
			"search.hasMore": "Showing the first {n} results. Narrow your search.",
			"menu.addWorkspace": "Add workspace…",
			"picker.loading": "Loading workspaces…",
			"conflict.named": "A workspace named “{name}” already exists.",
			"folderError.title": "Couldn’t open folder",
			"folderError.retry": "Choose again",
			"rename": "Rename",
			"rename.workspace.title": "Rename workspace",
			"rename.session.title": "Rename session",
			"field.workspaceName": "Workspace name",
			"field.sessionName": "Session name",
			"delete.workspace": "Delete workspace",
			"delete.desc": "This removes “{name}” from the workspace list. The folder and session logs will be kept. Its sessions will appear under Ungrouped.",
			"delete.pending": "Deleting workspace…",
			"menu.fork": "Fork session",
			"menu.archiveSession": "Archive session",
			"menu.unarchiveSession": "Unarchive session",
			"menu.pinSession": "Pin session",
			"menu.unpinSession": "Unpin session",
			"row.archived": "Archived",
			"row.pinned": "Pinned",
			"toast.archivedNotOpenable": "Archived sessions cannot be opened. Unarchive it to view.",
			"toast.archived": "Session archived. You can ",
			"toast.stoppedAndArchived": "Session stopped and archived. You can ",
			"archive.confirm.title": "Stop and archive this session?",
			"archive.confirm.desc": "“{title}” still has work in progress. Archiving stops it first; you can restore the session later from the “All conversations (show archived)” filter in the sidebar, and the stopped work will not resume on its own.",
			"archive.confirm.activity": "Work that will be stopped",
			"archive.confirm.turn": "The turn in progress",
			"archive.confirm.subagents.one": "{n} running subagent: {names}",
			"archive.confirm.subagents.other": "{n} running subagents: {names}",
			"archive.confirm.jobs.one": "{n} background job: {names}",
			"archive.confirm.jobs.other": "{n} background jobs: {names}",
			"archive.confirm.schedules.one": "{n} scheduled reminder: {names}",
			"archive.confirm.schedules.other": "{n} scheduled reminders: {names}",
			"archive.confirm.other.one": "{n} other item of work ({kind})",
			"archive.confirm.other.other": "{n} other items of work ({kind})",
			"archive.confirm.listSeparator": ", ",
			"archive.confirm.action": "Stop and archive",
			"archive.confirm.pending": "Stopping and archiving…",
			"toast.archivedUndo": "undo",
			"toast.archivedOr": " or ",
			"toast.archivedFilter": "filter archived sessions",
			"toast.pinFailed": "Pin failed. Try again later.",
			"toast.unpinFailed": "Unpin failed. Try again later.",
			"toast.createFailed": "New session failed: {message}",
			"sessions.count.one": "{n} session",
			"sessions.count.other": "{n} sessions",
			"actions.workspace.aria": "Workspace actions for {name}",
			"actions.session.aria": "Session actions for {name}",
			"actions.archive": "Archive",
			"actions.unarchive": "Unarchive",
			"actions.pin": "Pin",
			"actions.unpin": "Unpin",
			"actions.newSession": "New session",
			"actions.newSession.aria": "New session in {name}",
			"status.running": "Running",
			"status.subagentsRunning.one": "{n} subagent running",
			"status.subagentsRunning.other": "{n} subagents running",
			"status.idle": "Idle",
			"status.waitingApproval": "Waiting for approval",
			"status.planReview": "Plan awaiting review",
			"status.waitingAnswer": "Waiting for answer",
			"status.compact.approval": "Approval",
			"status.compact.planReview": "Plan review",
			"status.compact.answer": "Answer",
			"status.completed": "Completed",
			"hover.created": "Created {time}",
			"hover.copied": "Copied",
			"date.ymd": "{y}-{m}-{d}",
			"time.now": "now",
			"time.minutes": "{n}min",
			"time.hours": "{n}h",
			"time.days": "{n}d",
			"time.months": "{n}mo",
			"time.years": "{n}y",
			"time.ago": "{t} ago"
		};
		//#endregion
		//#region src/client/vendor/workspace-rows/translate.ts
		/**
		* The locale seat for the vendored rows.
		*
		* The vendored components translate through the `workspace` namespace
		* dictionaries copied from the shell (`generated/locales.ts`), so their wording
		* — 新会话 / 未命名 / 刚刚 / 重命名 … — is byte-identical to the shell's own rows
		* instead of a paraphrase. The active language follows this plugin's switch.
		*/
		/**
		* Translate one vendored row key.
		* @param key - `workspace` namespace key.
		* @param params - `{name}` values; an unknown name keeps its placeholder.
		* @returns the localized string (falls back to the key when the copy is absent).
		*/
		const rowsTranslate = (key, params) => {
			const template = (getLocale() === "en" ? en : zh)[key] ?? key;
			if (params === void 0) return template;
			return template.replace(/\{(\w+)\}/g, (match, name) => {
				const value = params[name];
				return value === void 0 || value === null ? match : String(value);
			});
		};
		//#endregion
		//#region src/client/rename-dialog.tsx
		/**
		* The rename dialog for one remote session.
		*
		* The shell's own dialog is a `shell.overlay` entry owned by ui-workspace, which
		* a plugin cannot raise; this is the same dialog built from the same primitives
		* (Modal + input + buttons) around the same hop — `sessionVerbs.renameSession`,
		* which calls the official session service exactly like the shell's dialog does.
		* The copy comes from the vendored `workspace` dictionary, so it reads
		* identically.
		*/
		/** One request's form; mounting seeds the draft from the request. */
		function RenameForm(props) {
			const [draft, setDraft] = (0, react.useState)(props.currentTitle);
			const [renaming, setRenaming] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(void 0);
			const composing = (0, react.useRef)(false);
			const trimmed = draft.trim();
			const blocked = renaming || trimmed === "";
			const close = () => {
				if (!renaming) store.settleRename();
			};
			const confirm = () => {
				if (blocked) return;
				setRenaming(true);
				setError(void 0);
				store.renameSession(props.workspace, props.sessionId, trimmed).then(() => {
					setRenaming(false);
					store.settleRename();
				}, (reason) => {
					setRenaming(false);
					setError(t("tree.session.renameFailed", { message: reason instanceof Error ? reason.message : String(reason) }));
				});
			};
			const input = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				input.current?.focus();
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: close,
				closeLabel: t("common.cancel"),
				title: rowsTranslate("rename.session.title"),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					disabled: renaming,
					onClick: close,
					children: t("common.cancel")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					disabled: blocked,
					onClick: confirm,
					children: rowsTranslate("rename")
				})] }),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					ref: input,
					className: "dsh-rw-rename-input",
					value: draft,
					disabled: renaming,
					"aria-label": rowsTranslate("rename.session.title"),
					onChange: (event) => {
						setDraft(event.target.value);
					},
					onCompositionStart: () => {
						composing.current = true;
					},
					onCompositionEnd: () => {
						composing.current = false;
					},
					onKeyDown: (event) => {
						if (event.key === "Enter" && !composing.current) {
							event.preventDefault();
							confirm();
						}
					}
				}), error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsh-rw-side-error",
					children: error
				})]
			});
		}
		/** The dialog host: renders one form per pending request, or nothing. */
		function RenameSessionDialog() {
			const owned = useSingleHost("rename-session");
			const target = useAppState().renameTarget;
			if (!owned || target === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RenameForm, {
				workspace: target.workspace,
				sessionId: target.session.id,
				currentTitle: target.title
			}, target.session.id);
		}
		//#endregion
		//#region src/client/workspace-rename-dialog.tsx
		/**
		* The rename dialog for one remote workspace.
		*
		* Same shape as `rename-dialog.tsx` (the session one): the shell's own rename
		* dialog is a `shell.overlay` entry owned by ui-workspace, which a plugin cannot
		* raise, so this is the same dialog built from the same primitives around the
		* plugin's own hop — `POST /api/workspace-rename`, which rewrites the record's
		* title and nothing else.
		*
		* Deliberately NOT a remote `mv`: the directory is what every stored session's
		* header points at, the remote registry keeps its own copy of the title, and a
		* network rename has no rollback (architecture A7). The description says so,
		* because "rename a workspace" reads like a directory rename to a user.
		*/
		/** One request's form; mounting seeds the draft from the request. */
		function WorkspaceRenameForm(props) {
			const [draft, setDraft] = (0, react.useState)(props.currentTitle);
			const [renaming, setRenaming] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(void 0);
			const composing = (0, react.useRef)(false);
			const trimmed = draft.trim();
			const blocked = renaming || trimmed === "";
			const close = () => {
				if (!renaming) store.settleWorkspaceRename();
			};
			const confirm = () => {
				if (blocked) return;
				setRenaming(true);
				setError(void 0);
				store.acceptWorkspaceRename(trimmed).then(() => {
					setRenaming(false);
					store.settleWorkspaceRename();
				}, (reason) => {
					setRenaming(false);
					setError(t("tree.workspace.renameFailed", { message: reason instanceof Error ? reason.message : String(reason) }));
				});
			};
			const input = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				input.current?.focus();
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: close,
				closeLabel: t("common.cancel"),
				title: t("tree.workspace.rename.title"),
				description: t("tree.workspace.rename.description"),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					disabled: renaming,
					onClick: close,
					children: t("common.cancel")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					disabled: blocked,
					onClick: confirm,
					children: t("tree.workspace.rename")
				})] }),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					ref: input,
					className: "dsh-rw-rename-input",
					value: draft,
					disabled: renaming,
					"aria-label": t("tree.workspace.rename.title"),
					onChange: (event) => {
						setDraft(event.target.value);
					},
					onCompositionStart: () => {
						composing.current = true;
					},
					onCompositionEnd: () => {
						composing.current = false;
					},
					onKeyDown: (event) => {
						if (event.key === "Enter" && !composing.current) {
							event.preventDefault();
							confirm();
						}
					}
				}), error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsh-rw-side-error",
					children: error
				})]
			});
		}
		/** The dialog host: renders one form per pending request, or nothing. */
		function WorkspaceRenameDialog() {
			const owned = useSingleHost("rename-workspace");
			const pending = useAppState().renameWorkspace;
			if (!owned || pending === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkspaceRenameForm, { currentTitle: pending.title }, pending.workspace.id);
		}
		//#endregion
		//#region src/client/session-verbs.ts
		/** The official services, resolved lazily from the client context. */
		let clientContext;
		/**
		* Bind the client context, as the store does, so the verbs can resolve the
		* official services without prop drilling.
		* @param ctx - the client context.
		*/
		function bindVerbContext(ctx) {
			clientContext = ctx;
		}
		function uiWorkspace() {
			return clientContext?.get("uiWorkspace");
		}
		/** No flags: a workspace whose record carries neither set. */
		const EMPTY_FLAGS = {
			pinned: /* @__PURE__ */ new Set(),
			archived: /* @__PURE__ */ new Set()
		};
		/**
		* Build one workspace's flag sets from its record.
		* @param workspace - the workspace record, or undefined.
		* @returns the pinned and archived sets.
		*/
		function workspaceFlags(workspace) {
			if (workspace === void 0) return EMPTY_FLAGS;
			return {
				pinned: new Set(workspace.pinnedSessions ?? []),
				archived: new Set(workspace.archivedSessions ?? [])
			};
		}
		/** Report one verb failure without moving any other surface. */
		function report(action, reason) {
			const message = reason instanceof Error ? reason.message : String(reason);
			store.notifyError(t("tree.verb.failed", {
				action,
				message
			}));
		}
		/**
		* Pin or unpin one session.
		*
		* NOT the shell's `uiWorkspace.pinSession`: that resolves the id against the
		* shell's *local* session index, where a remote session never appears, and
		* answers `session/not-found` (measured). The plugin owns the set for its own
		* sessions instead — the row's pinned look, ordering and the menu labels all
		* read from it, so the behaviour is the shell's even though the storage is not.
		* @param workspace - the workspace the session belongs to.
		* @param sessionId - the stored remote session id.
		* @param pinned - the state to apply.
		* @param action - the verb label, for the failure notice.
		*/
		async function setPin(workspace, sessionId, pinned, action) {
			try {
				await store.setSessionFlag(workspace, sessionId, "pinned", pinned);
			} catch (error) {
				report(action, error);
			}
		}
		/** Archive or unarchive one session (plugin-owned set, see {@link setPin}). */
		async function setArchived(workspace, sessionId, archived, action) {
			try {
				await store.setSessionFlag(workspace, sessionId, "archived", archived);
			} catch (error) {
				report(action, error);
			}
		}
		/** Fork one session, then open the child it produced. */
		async function forkSession(workspace, sessionId, action) {
			const service = uiWorkspace();
			if (service === void 0) return;
			try {
				const childId = await service.forkSession(sessionId);
				store.notifySuccess(t("tree.session.forked"));
				await store.refreshSessions(workspace);
				store.revealSessionId(childId, workspace.targetId);
			} catch (error) {
				report(action, error);
			}
		}
		/** The verbs, as the tree consumes them. */
		const sessionVerbs = {
			setPin,
			setArchived,
			forkSession
		};
		//#endregion
		//#region src/client/vendor/workspace-rows/generated/classnames.ts
		/**
		* GENERATED by scripts/vendor-workspace-rows.mjs — do not edit by hand.
		* Source: …/rows/Rows.module.css + AnimatedRows.module.css
		* Re-run the script after a DSH upgrade; see ../NOTICE.md.
		*/
		const rowsCss = {
			"projectRow": "dsh-rwv-rows-projectRow",
			"sessionRow": "dsh-rwv-rows-sessionRow",
			"selected": "dsh-rwv-rows-selected",
			"searchResultRow": "dsh-rwv-rows-searchResultRow",
			"searchResultHeading": "dsh-rwv-rows-searchResultHeading",
			"searchResultTitle": "dsh-rwv-rows-searchResultTitle",
			"searchResultMeta": "dsh-rwv-rows-searchResultMeta",
			"searchResultWorkspace": "dsh-rwv-rows-searchResultWorkspace",
			"searchResultSnippet": "dsh-rwv-rows-searchResultSnippet",
			"rowActions": "dsh-rwv-rows-rowActions",
			"title": "dsh-rwv-rows-title",
			"slot": "dsh-rwv-rows-slot",
			"visuallyHidden": "dsh-rwv-rows-visuallyHidden",
			"folderActive": "dsh-rwv-rows-folderActive",
			"chevron": "dsh-rwv-rows-chevron",
			"folder": "dsh-rwv-rows-folder",
			"arrow": "dsh-rwv-rows-arrow",
			"arrowOpen": "dsh-rwv-rows-arrowOpen",
			"projectText": "dsh-rwv-rows-projectText",
			"renameInput": "dsh-rwv-rows-renameInput",
			"tsx": "dsh-rwv-rows-tsx",
			"meta": "dsh-rwv-rows-meta",
			"time": "dsh-rwv-rows-time",
			"pinIndicator": "dsh-rwv-rows-pinIndicator",
			"archived": "dsh-rwv-rows-archived",
			"dot": "dsh-rwv-rows-dot",
			"menuOpen": "dsh-rwv-rows-menuOpen",
			"dropBefore": "dsh-rwv-rows-dropBefore",
			"dropAfter": "dsh-rwv-rows-dropAfter",
			"hoverContent": "dsh-rwv-rows-hoverContent",
			"hoverTitle": "dsh-rwv-rows-hoverTitle",
			"hoverPath": "dsh-rwv-rows-hoverPath",
			"hoverTime": "dsh-rwv-rows-hoverTime",
			"hoverStatus": "dsh-rwv-rows-hoverStatus",
			"hoverArchived": "dsh-rwv-rows-hoverArchived",
			"iconButton": "dsh-rwv-rows-iconButton"
		};
		//#endregion
		//#region src/client/session-row-parts.tsx
		/**
		* The `⋮` menu entries of one session row, in the shell's order.
		* @param props.close - the row's menu setter; every entry dismisses the menu
		*   before acting, exactly like the shell's own entries do.
		*/
		function SessionMenu(props) {
			const { session, title, pinned, archived } = props;
			const t = rowsTranslate;
			const act = (run) => {
				props.close();
				run();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				!archived && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MenuItemButton, {
					icon: pinned ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPinFillRegular, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPinOutlineRegular, {}),
					onSelect: () => {
						act(() => {
							sessionVerbs.setPin(props.workspace, session.id, !pinned, t(pinned ? "menu.unpinSession" : "menu.pinSession"));
						});
					},
					children: t(pinned ? "menu.unpinSession" : "menu.pinSession")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MenuItemButton, {
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutlineRegular, {}),
					onSelect: () => {
						act(() => {
							store.requestRename(props.workspace, {
								...session,
								title
							});
						});
					},
					children: t("rename")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MenuItemButton, {
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, {}),
					onSelect: () => {
						act(() => {
							sessionVerbs.forkSession(props.workspace, session.id, t("menu.fork"));
						});
					},
					children: t("menu.fork")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MenuItemButton, {
					danger: !archived,
					icon: archived ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconUnarchiveOutlineRegular, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutlineRegular, {}),
					onSelect: () => {
						act(() => {
							sessionVerbs.setArchived(props.workspace, session.id, !archived, t(archived ? "menu.unarchiveSession" : "menu.archiveSession"));
						});
					},
					children: t(archived ? "menu.unarchiveSession" : "menu.archiveSession")
				})
			] });
		}
		/** The hover buttons at one session row's right edge (archive, then pin). */
		function SessionRowActions(props) {
			const { session, pinned, archived } = props;
			const t = rowsTranslate;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
				label: t(archived ? "actions.unarchive" : "actions.archive"),
				side: "bottom",
				align: "end",
				delayMs: 500,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: rowsCss.iconButton,
					"aria-label": t(archived ? "actions.unarchive" : "actions.archive"),
					onClick: (event) => {
						event.stopPropagation();
						sessionVerbs.setArchived(props.workspace, session.id, !archived, t(archived ? "actions.unarchive" : "actions.archive"));
					},
					children: archived ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconUnarchiveOutlineRegular, { size: 14 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutlineRegular, { size: 14 })
				})
			}), !archived && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
				label: t(pinned ? "actions.unpin" : "actions.pin"),
				side: "bottom",
				align: "end",
				delayMs: 500,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: rowsCss.iconButton,
					"aria-label": t(pinned ? "actions.unpin" : "actions.pin"),
					onClick: (event) => {
						event.stopPropagation();
						sessionVerbs.setPin(props.workspace, session.id, !pinned, t(pinned ? "actions.unpin" : "actions.pin"));
					},
					children: pinned ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPinFillRegular, { size: 14 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPinOutlineRegular, { size: 14 })
				})
			})] });
		}
		//#endregion
		//#region node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs
		function r(e) {
			var t, f, n = "";
			if ("string" == typeof e || "number" == typeof e) n += e;
			else if ("object" == typeof e) if (Array.isArray(e)) {
				var o = e.length;
				for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
			} else for (f in e) e[f] && (n && (n += " "), n += f);
			return n;
		}
		function clsx() {
			for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
			return n;
		}
		//#endregion
		//#region src/client/vendor/workspace-rows/home-path.ts
		/**
		* Vendored from `@deepseek-ai/dsh-util-workspace-path` (MIT, DeepSeek Harness).
		*
		* Only the one helper the vendored rows call is copied: the shell's row shows a
		* workspace's cwd on its hover card, abbreviating the host account home to `~`.
		*/
		/** Whether a path uses a Windows drive or UNC prefix. */
		function isWindowsStylePath(value) {
			return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith("\\\\");
		}
		/**
		* Abbreviate a POSIX home directory for display.
		* @param path - absolute or already-short display path.
		* @param home - host account home; absent skips abbreviation.
		* @returns `~` or `~/…` for the POSIX home and its descendants, otherwise `path`.
		*/
		function abbreviateHomePath(path, home) {
			if (home === void 0 || home === "") return path;
			if (isWindowsStylePath(path) || isWindowsStylePath(home)) return path;
			const root = home.replace(/\/+$/, "");
			if (root === "" || root === "/") return path;
			if (path.replace(/\/+$/, "") === root) return "~";
			if (path.startsWith(`${root}/`)) return `~${path.slice(root.length)}`;
			return path;
		}
		//#endregion
		//#region src/client/vendor/workspace-rows/generated/Rows.tsx
		/**
		* GENERATED by scripts/vendor-workspace-rows.mjs — do not edit by hand.
		* Source: packages/client/ui-workspace/src/client/rows/Rows.tsx
		* Re-run the script after a DSH upgrade; see ../NOTICE.md.
		*/
		/**
		* Workspace browser tree row components (figma Cell set 14:3080): pure presentational —
		* all data and callbacks arrive via props. Hover swaps (folder->chevron,
		* time->ellipsis, action buttons) are CSS-only, and a session row's clipped
		* title marquees programmatically while the row is hovered. Workspace row
		* menus are visual-only except Rename/Delete. A Session row's "..." menu and
		* its hover buttons are the `sidebar.workspaces.session.menu.item` and
		* `sidebar.workspaces.session.row.action` lists, rendered through the
		* browser's `renderSlot` with the menu's open state as the occurrence's hook
		* context; this package's own actions are entries like any plugin's. The
		* session and workspace hover cards are suppressed while a menu is open.
		*/
		/** Row display title: blank rows show the localized New Session label. */
		function displayTitle(node, t) {
			return node.blank ? t("session.new") : node.title || t("session.untitled");
		}
		const MIN_TITLE_REVEAL_PX = 8;
		const TITLE_MARQUEE_PX_PER_MS = .03;
		/**
		* Place the title's scroll position and publish the stylesheet's fade-mask
		* hooks: `data-scrolled` while the title has left its start (left fade) and
		* `data-clipped` while text remains beyond the right edge (right fade).
		* @param title - the row's clipping title element.
		* @param left - scroll offset in CSS pixels.
		* @param range - the title's maximum scroll offset in CSS pixels.
		*/
		function placeTitle(title, left, range) {
			if (typeof title.scrollTo === "function") title.scrollTo({
				left,
				behavior: "instant"
			});
			else title.scrollLeft = left;
			if (left > 0) title.dataset.scrolled = "";
			else delete title.dataset.scrolled;
			if (left < range) title.dataset.clipped = "";
			else delete title.dataset.clipped;
		}
		/**
		* Return the title to its resting state: scrolled to the start with both fade
		* masks off, so the resting ellipsis renders at full strength.
		* @param title - the row's clipping title element.
		*/
		function restTitle(title) {
			if (typeof title.scrollTo === "function") title.scrollTo({
				left: 0,
				behavior: "instant"
			});
			else title.scrollLeft = 0;
			delete title.dataset.scrolled;
			delete title.dataset.clipped;
		}
		/**
		* Marquee a title wider than its one-line cell while its row is hovered: the
		* title clips its own text, so entering crawls it at a constant speed until the
		* far edge (a fork's incremented title, for example) is in view, then rests
		* there under the pointer. Overflow of at most {@link MIN_TITLE_REVEAL_PX}
		* stays put — a barely-clipped title moving a few pixels reads as jitter, not a
		* reveal. Leaving returns the title to the start in one step, because the
		* resting ellipsis and the narrowed cell would otherwise meet the text while it
		* travelled back. Reduced motion jumps to the far edge instead of crawling.
		* @param title - ref to the row's clipping title element.
		* @returns stable pointer enter/leave handlers for the row.
		*/
		function useTitleMarquee(title) {
			const frame = (0, react.useRef)(0);
			(0, react.useEffect)(() => () => {
				cancelAnimationFrame(frame.current);
			}, []);
			return (0, react.useMemo)(() => ({
				enter: () => {
					/* v8 ignore next -- defensive: the title span renders unconditionally. */
					if (title.current === null) return;
					const element = title.current;
					const range = element.scrollWidth - element.clientWidth;
					if (range <= MIN_TITLE_REVEAL_PX) return;
					if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
						placeTitle(element, range, range);
						return;
					}
					cancelAnimationFrame(frame.current);
					let previous;
					let position = 0;
					const step = (now) => {
						position += previous === void 0 ? 0 : (now - previous) * TITLE_MARQUEE_PX_PER_MS;
						previous = now;
						placeTitle(element, Math.min(position, range), range);
						if (position < range) frame.current = requestAnimationFrame(step);
					};
					frame.current = requestAnimationFrame(step);
				},
				leave: () => {
					cancelAnimationFrame(frame.current);
					/* v8 ignore next -- defensive: the title span renders unconditionally. */
					if (title.current === null) return;
					restTitle(title.current);
				}
			}), [title]);
		}
		/** Localized compact relative time ("刚刚"/"5分钟" in zh, "now"/"5min" in en). */
		function timeLabel(updatedAt, now, t) {
			const { unit, n } = (0, _deepseek_ai_dsh_client_ui_primitives.relativeTime)(updatedAt, now);
			return unit === "now" ? t("time.now") : t(`time.${unit}`, { n });
		}
		/** Hover-card variant: distances wrap in the ago template; the now bucket stays bare (no "now ago"). */
		function hoverTimeLabel(updatedAt, now, t) {
			const { unit, n } = (0, _deepseek_ai_dsh_client_ui_primitives.relativeTime)(updatedAt, now);
			return unit === "now" ? t("time.now") : t("time.ago", { t: t(`time.${unit}`, { n }) });
		}
		/**
		* Absolute creation time through the dictionary's date template (the message
		* clock pattern): `toLocaleString` would follow the browser language, not the
		* app locale, and produce mixed-language text after a switch.
		*/
		function createdLabel(createdAt, t) {
			const d = new Date(createdAt);
			const pad2 = (v) => String(v).padStart(2, "0");
			return t("hover.created", { time: `${t("date.ymd", {
				y: d.getFullYear(),
				m: d.getMonth() + 1,
				d: d.getDate()
			})} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` });
		}
		/** Hover-card body: workspace title, display directory path, absolute creation time. */
		function WorkspaceHoverContent({ label, cwd, createdAt, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: rowsCss.hoverContent,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: rowsCss.hoverTitle,
						children: label
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: rowsCss.hoverPath,
						children: cwd
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: rowsCss.hoverTime,
						children: createdLabel(createdAt, t)
					})
				]
			});
		}
		/** Pointer-position half of a row (insert line above or below). */
		function rowHalf(e) {
			const rect = e.currentTarget.getBoundingClientRect();
			return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
		}
		/**
		* Project (workspace) header row: folder + title;
		* hover reveals the chevron and create button, and dwelling on a real
		* Workspace shows its hover card (the ungrouped bucket has none).
		* `containsCurrent` arrives on the node (derivation fact, no renderer scan).
		* @param props.group - derived group node.
		* @param props.containsCurrentDescendant - highlight an ancestor even when its subtree is collapsed.
		* @param props.onToggle - expand/collapse the group.
		* @param props.onCreate - start a frontend Session inside this Workspace.
		* @param props.drag - optional workspace-row drag wiring.
		* @param props.home - host account home for POSIX hover-path abbreviation.
		* @param props.t - the browser root's locale seat.
		* @returns the row element.
		*/
		function ProjectRowItem({ group, containsCurrentDescendant = false, onToggle, onCreate, actions, drag, home, newShortcut, t }) {
			const row = group;
			const label = row.workspaceId === void 0 ? t("group.ungrouped") : row.label;
			const active = containsCurrentDescendant || group.expanded && group.containsCurrent;
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const workspaceMenuItems = [{
				id: "rename",
				label: t("rename"),
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutlineRegular, {})
			}, {
				id: "delete",
				label: t("delete.workspace"),
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineRegular, {}),
				danger: true
			}];
			const ownRow = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: clsx(rowsCss.projectRow, menuOpen && rowsCss.menuOpen),
				"data-row-key": `workspace:${group.key}`,
				role: "treeitem",
				"aria-expanded": row.expanded,
				onClick: onToggle,
				draggable: drag !== void 0,
				onDragStart: drag === void 0 ? void 0 : (e) => {
					e.dataTransfer.effectAllowed = "move";
					e.dataTransfer.setData("text/plain", row.key);
					drag.start();
				},
				onDragEnd: drag?.end,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: clsx(rowsCss.slot, rowsCss.folder, active && rowsCss.folderActive),
						children: row.expanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpenRegular, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderCloseRegular, {})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: clsx(rowsCss.slot, rowsCss.chevron),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTriangleRightFillRegular, { className: clsx(rowsCss.arrow, row.expanded && rowsCss.arrowOpen) })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: rowsCss.projectText,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: rowsCss.title,
							children: label
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: rowsCss.rowActions,
						children: [actions !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
							open: menuOpen,
							onClose: () => {
								setMenuOpen(false);
							},
							items: workspaceMenuItems,
							onSelect: (id) => {
								setMenuOpen(false);
								/* v8 ignore next -- Menu can emit only the rename and delete rows supplied above. */
								if (id !== "rename" && id !== "delete") return;
								if (id === "rename") actions.rename();
								else actions.delete();
							},
							portal: true,
							closeOnPointerLeave: true,
							anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: rowsCss.iconButton,
								"aria-label": t("actions.workspace.aria", { name: label }),
								onClick: (e) => {
									e.stopPropagation();
									setMenuOpen((v) => !v);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutlineRegular, {})
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
							label: t("actions.newSession"),
							shortcutKeys: newShortcut?.keys,
							side: "bottom",
							align: "end",
							delayMs: 500,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: rowsCss.iconButton,
								"aria-keyshortcuts": newShortcut?.aria,
								"aria-label": t("actions.newSession.aria", { name: label }),
								onClick: (e) => {
									e.stopPropagation();
									onCreate();
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconNewChatOutlineRegular, {})
							})
						})]
					})
				]
			});
			if (row.createdAt === void 0) return ownRow;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.HoverCard, {
				anchor: ownRow,
				content: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkspaceHoverContent, {
					label: row.label,
					cwd: row.cwd === void 0 ? void 0 : abbreviateHomePath(row.cwd, home),
					createdAt: row.createdAt,
					t
				}),
				openDelayMs: 800,
				disabled: menuOpen,
				copyText: row.cwd,
				copyLabel: t("copy"),
				copiedLabel: t("hover.copied")
			});
		}
		/* v8 ignore next 3 -- closed-union backstop; only reached if the status is forged */
		function assertNever(value) {
			throw new Error(`unknown pending interaction: ${String(value)}`);
		}
		/**
		* Session status presentation; pending interaction is primary and live activity
		* outranks completion reminders.
		*/
		function sessionStatuses(node, t) {
			const subagents = node.runningSubagentCount === 0 ? void 0 : {
				state: "ongoing",
				label: t(node.runningSubagentCount === 1 ? "status.subagentsRunning.one" : "status.subagentsRunning.other", { n: node.runningSubagentCount })
			};
			let pending;
			switch (node.pendingInteraction) {
				case "approval":
					pending = {
						state: "warning",
						label: t("status.waitingApproval"),
						trailingLabel: t("status.compact.approval")
					};
					break;
				case "plan-review":
					pending = {
						state: "warning",
						label: t("status.planReview"),
						trailingLabel: t("status.compact.planReview")
					};
					break;
				case "question":
					pending = {
						state: "warning",
						label: t("status.waitingAnswer"),
						trailingLabel: t("status.compact.answer")
					};
					break;
				case void 0: break;
				/* v8 ignore next -- closed PendingInteractionStatus union */
				default: return assertNever(node.pendingInteraction);
			}
			if (pending !== void 0) return subagents === void 0 ? [pending] : [pending, subagents];
			if (node.running) {
				const primary = {
					state: "ongoing",
					label: t("status.running")
				};
				return subagents === void 0 ? [primary] : [primary, subagents];
			}
			if (subagents !== void 0) return [subagents];
			if (node.completed) return [{
				state: "done",
				label: t("status.completed")
			}];
			return [{
				state: "idle",
				label: t("status.idle")
			}];
		}
		/** Primary status dot plus every status's screen-reader label, shared by the search and session rows. */
		function SessionStatusDots({ statuses }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: statuses[0].state }), statuses.map((status) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: rowsCss.visuallyHidden,
				children: status.label
			}, status.label))] });
		}
		/** Non-interactive pinned-row marker; the enclosing row remains the only action. */
		function PinnedIndicator({ t }) {
			const label = t("row.pinned");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: rowsCss.pinIndicator,
				role: "img",
				"aria-label": label,
				title: label,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPinFillRegular, { size: 14 })
			});
		}
		/**
		* Hover-card body: full title, relative time, the Session's own scheduled-task
		* section, and every relevant live status. The task section sits above the
		* status lines so they stay the card's trailing status line.
		*/
		function SessionHoverContent({ node, now, renderSlot, t }) {
			const statuses = sessionStatuses(node, t).filter((status) => !(node.archived && (status.state === "done" || status.state === "idle")));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: rowsCss.hoverContent,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: rowsCss.hoverTitle,
						children: displayTitle(node, t)
					}),
					!node.blank && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: rowsCss.hoverTime,
						children: hoverTimeLabel(node.updatedAt, now, t)
					}),
					renderSlot("sidebar.session.row.hover", { sessionId: node.id }),
					statuses.map((status) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: rowsCss.hoverStatus,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: status.state }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: status.label })]
					}, status.label)),
					node.archived && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: clsx(rowsCss.hoverStatus, rowsCss.hoverArchived),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutlineRegular, { size: 14 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("row.archived") })]
					})
				]
			});
		}
		/**
		* One top-level 32px session row: leading 16px cell (status dot, or the
		* leading seat while the row's primary state is idle), title, relative time or
		* compact pending label, and the row actions menu. A row that owns a state dot
		* keeps that cell and renders no seat, so an ambient automation mark never
		* appears beside the row's own state dot. An archived row keeps the cell blank:
		* neither marker renders there, and its live status stays on the hover card.
		* @param props.node - derived session node.
		* @param props.currentId - selected session id (row highlight).
		* @param props.now - epoch ms for relative-time formatting.
		* @param props.onOpen - open a session by id.
		* @param props.onRenameRequest - open the rename dialog from a title double-click (id + current title).
		* @param props.renderSlot - child-seat renderer for the row's action lists
		* (`sidebar.workspaces.session.menu.item` / `sidebar.workspaces.session.row.action`),
		* its leading decoration, and its hover-card section.
		* @param props.onReveal - scroll this row into view after search navigation, then acknowledge it.
		* @param props.drag - optional row-drag target wiring; blank rows cannot start a drag.
		* @param props.t - the browser root's locale seat.
		* @returns the session row.
		*/
		function SessionNodeItem({ node, currentId, now, onOpen, onRenameRequest, renderSlot, onReveal, drag, t }) {
			const row = node;
			const title = displayTitle(node, t);
			const selected = node.id === currentId;
			const statuses = sessionStatuses(node, t);
			const primaryStatus = statuses[0];
			const showStatus = primaryStatus.state !== "idle";
			const draggable = drag !== void 0 && !row.blank && !row.archived;
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const menuOpenState = (0, react.useMemo)(() => [menuOpen, setMenuOpen], [menuOpen]);
			const rowRef = (0, react.useRef)(null);
			const titleRef = (0, react.useRef)(null);
			const marquee = useTitleMarquee(titleRef);
			(0, react.useEffect)(() => {
				if (onReveal === void 0) return;
				rowRef.current?.scrollIntoView({ block: "nearest" });
				onReveal();
			}, [onReveal]);
			const ownRow = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: rowRef,
				"data-row-key": `session:${node.id}`,
				className: clsx(rowsCss.sessionRow, selected && rowsCss.selected, menuOpen && rowsCss.menuOpen, row.archived && rowsCss.archived, drag?.marker === "before" && rowsCss.dropBefore, drag?.marker === "after" && rowsCss.dropAfter),
				role: "treeitem",
				"aria-selected": selected,
				"aria-description": row.archived ? t("toast.archivedNotOpenable") : void 0,
				onClick: () => {
					onOpen(node.id);
				},
				onPointerEnter: marquee.enter,
				onPointerLeave: marquee.leave,
				draggable,
				onDragStart: !draggable ? void 0 : (e) => {
					e.dataTransfer.effectAllowed = "move";
					e.dataTransfer.setData("text/plain", node.id);
					drag.start();
				},
				onDragEnd: !draggable ? void 0 : drag.end,
				onDragOver: drag === void 0 ? void 0 : (e) => {
					if (!drag.active) return;
					e.preventDefault();
					e.dataTransfer.dropEffect = "move";
					drag.hover(rowHalf(e));
				},
				onDrop: drag === void 0 ? void 0 : (e) => {
					if (!drag.active) return;
					e.preventDefault();
					drag.drop(rowHalf(e));
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: rowsCss.slot,
						children: !row.archived && !row.blank && (showStatus ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionStatusDots, { statuses }) : renderSlot("sidebar.session.row.leading", { sessionId: node.id }))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						ref: titleRef,
						className: rowsCss.title,
						onDoubleClick: row.blank ? void 0 : (e) => {
							e.stopPropagation();
							onRenameRequest(node.id, row.title);
						},
						children: title
					}),
					!row.blank && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: rowsCss.time,
						"aria-hidden": primaryStatus.trailingLabel === void 0 ? void 0 : true,
						children: primaryStatus.trailingLabel ?? timeLabel(row.updatedAt, now, t)
					}),
					row.pinned && !row.archived && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PinnedIndicator, { t }),
					!row.blank && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: rowsCss.rowActions,
						onClick: (e) => {
							e.stopPropagation();
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
							open: menuOpen,
							onClose: () => {
								setMenuOpen(false);
							},
							portal: true,
							closeOnPointerLeave: true,
							anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: rowsCss.iconButton,
								"aria-label": t("actions.session.aria", { name: title }),
								onClick: () => {
									setMenuOpen((v) => !v);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutlineRegular, {})
							}),
							children: renderSlot("sidebar.workspaces.session.menu.item", {
								sessionId: node.id,
								displayTitle: row.title
							}, { hookContext: menuOpenState })
						}), renderSlot("sidebar.workspaces.session.row.action", {
							sessionId: node.id,
							displayTitle: row.title
						})]
					})
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.HoverCard, {
				anchor: ownRow,
				content: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionHoverContent, {
					node,
					now,
					renderSlot,
					t
				}),
				openDelayMs: 800,
				disabled: menuOpen || drag?.active === true,
				copyText: row.blank || row.title === "" ? void 0 : row.title,
				copyLabel: t("copy"),
				copiedLabel: t("hover.copied")
			});
		}
		//#endregion
		//#region src/client/vendor/workspace-rows/generated/AnimatedRows.tsx
		/**
		* GENERATED by scripts/vendor-workspace-rows.mjs — do not edit by hand.
		* Source: packages/client/ui-workspace/src/client/rows/AnimatedRows.tsx
		* Re-run the script after a DSH upgrade; see ../NOTICE.md.
		*/
		/** React-commit-driven movement and entry/exit fades for the sidebar's keyed rows. */
		//#endregion
		//#region src/client/vendor/workspace-rows/generated/row-styles.ts
		/**
		* GENERATED by scripts/vendor-workspace-rows.mjs — do not edit by hand.
		* Source: …/rows/Rows.module.css + AnimatedRows.module.css
		* Re-run the script after a DSH upgrade; see ../NOTICE.md.
		*/
		const ROW_STYLES = String.raw`
.dsh-rwv-rows-projectRow,
.dsh-rwv-rows-sessionRow {
  display: flex;
  align-items: center;
  gap: 6px;
  border-radius: var(--dsw-radius-md);
  padding: 0 8px;
  padding-inline-start: calc(8px + var(--dsh-workspace-indent, 0px));
  cursor: pointer;
  user-select: none;
  color: var(--dsw-alias-label-primary);
}

.dsh-rwv-rows-projectRow:hover,
.dsh-rwv-rows-sessionRow:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-rwv-rows-sessionRow.dsh-rwv-rows-selected {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-rwv-rows-searchResultRow {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  min-height: 48px;
  box-sizing: border-box;
  border: none;
  border-radius: var(--dsw-radius-lg);
  padding: 4px 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: var(--dsw-alias-label-primary);
}

.dsh-rwv-rows-searchResultRow:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-rwv-rows-searchResultRow.dsh-rwv-rows-selected {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-rwv-rows-searchResultHeading {
  display: flex;
  align-items: center;
  min-width: 0;
}

.dsh-rwv-rows-searchResultTitle {
  flex: 0 1 auto;
  min-width: 0;
  margin-left: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 20px;
}

.dsh-rwv-rows-searchResultMeta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-left: 20px;
}

.dsh-rwv-rows-searchResultWorkspace,
.dsh-rwv-rows-searchResultSnippet {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 17px;
}

.dsh-rwv-rows-searchResultWorkspace {
  flex: none;
  max-width: 40%;
  color: var(--dsw-alias-label-tertiary);
}

/* The 40% share only protects a snippet; a snippetless match keeps the row. */
.dsh-rwv-rows-searchResultWorkspace:only-child {
  max-width: 100%;
}

.dsh-rwv-rows-searchResultSnippet {
  flex: 1;
  min-width: 0;
  color: var(--dsw-alias-label-secondary);
}

/* Compact one-line Workspace row after removing the session-count subtitle. */
.dsh-rwv-rows-projectRow {
  height: 34px;
  align-items: center;
  box-sizing: border-box;
}

.dsh-rwv-rows-projectRow .dsh-rwv-rows-rowActions {
  height: 20px;
}

/* Session cell (figma): pad 8, a 16px status slot, then a 4px title gap. */
.dsh-rwv-rows-sessionRow {
  height: 32px;
  gap: 0;
}

.dsh-rwv-rows-sessionRow .dsh-rwv-rows-title {
  margin: 0 6px 0 4px;
}

.dsh-rwv-rows-slot {
  flex: none;
  width: 16px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rwv-rows-visuallyHidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.dsh-rwv-rows-folderActive {
  color: var(--dsw-alias-state-business-primary);
}


/* Project leading slot: folder by default, expand arrow on row hover. */
.dsh-rwv-rows-projectRow .dsh-rwv-rows-chevron { display: none; }
.dsh-rwv-rows-projectRow:hover .dsh-rwv-rows-chevron { display: inline-flex; }
.dsh-rwv-rows-projectRow:hover .dsh-rwv-rows-folder { display: none; }

/* Expand arrow (filled triangle): points right closed, rotates to point down open. */
.dsh-rwv-rows-arrow {
  transition: transform 150ms var(--ds-ease-in-out);
}

.dsh-rwv-rows-arrowOpen {
  transform: rotate(90deg);
}

.dsh-rwv-rows-projectText {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dsh-rwv-rows-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 20px;
}

.dsh-rwv-rows-renameInput {
  min-width: 0;
  font-size: 14px;
  line-height: 20px;
  padding: 0 2px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-button-elevated-fill);
  color: inherit;
  outline: none;
}

/* Hovering a session row marquees a title wider than its cell: Rows.dsh-rwv-rows-tsx crawls
   it at a constant speed to its far edge while the pointer rests on the row,
   holds it there, and returns it to the start in one step when the pointer
   leaves. The motion is scripted frame by frame (reduced motion jumps), so no
   scroll-behavior applies here. */
.dsh-rwv-rows-sessionRow .dsh-rwv-rows-title {
  flex: 1;
}

/* While the marquee travels, both clipping edges fade in over 12px instead of
   hard-cutting a character: the left once the title has moved off its start
   (data-scrolled), the right while text still remains beyond the cell
   (data-clipped) — at the far edge the right fade lifts so the final character
   reads at full strength. The mask rides the title span itself, so the status
   slot and every other leading cell keep their full color. */
.dsh-rwv-rows-sessionRow .dsh-rwv-rows-title[data-scrolled] {
  mask-image: linear-gradient(to right, transparent, #000 12px);
}

.dsh-rwv-rows-sessionRow .dsh-rwv-rows-title[data-clipped] {
  mask-image: linear-gradient(to left, transparent, #000 12px);
}

.dsh-rwv-rows-sessionRow .dsh-rwv-rows-title[data-scrolled][data-clipped] {
  mask-image: linear-gradient(to right, transparent, #000 12px, #000 calc(100% - 12px), transparent);
}

.dsh-rwv-rows-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rwv-rows-time {
  flex: none;
  font-size: 10px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rwv-rows-pinIndicator {
  display: inline-flex;
  flex: none;
  width: 16px;
  height: 20px;
  align-items: center;
  justify-content: center;
  margin-left: 6px;
  color: var(--dsw-alias-label-caption);
}

/* Archived rows stay in place but read as inactive: titles drop to
   the caption label step (one step above dimmed, which reads as too faint
   over the sidebar fill). Archived search rows drop their meta line to the
   same step so both lines read as one unit. */
.dsh-rwv-rows-sessionRow.dsh-rwv-rows-archived .dsh-rwv-rows-title,
.dsh-rwv-rows-searchResultRow.dsh-rwv-rows-archived .dsh-rwv-rows-searchResultTitle,
.dsh-rwv-rows-searchResultRow.dsh-rwv-rows-archived .dsh-rwv-rows-searchResultWorkspace,
.dsh-rwv-rows-searchResultRow.dsh-rwv-rows-archived .dsh-rwv-rows-searchResultSnippet {
  color: var(--dsw-alias-label-caption);
}

.dsh-rwv-rows-dot {
  flex: none;
}

/* Trailing action buttons surface on hover only (figma 27:4668 / 27:4656):
   bare 16px glyphs, tertiary grey; the figma gap 12 reads too airy beside
   the 16px glyphs, so the buttons sit at 10. */
.dsh-rwv-rows-rowActions {
  flex: none;
  display: none;
  align-items: center;
  gap: 10px;
}

.dsh-rwv-rows-projectRow:hover .dsh-rwv-rows-rowActions,
.dsh-rwv-rows-sessionRow:hover .dsh-rwv-rows-rowActions,
.dsh-rwv-rows-searchResultRow:hover .dsh-rwv-rows-rowActions,
.dsh-rwv-rows-projectRow.dsh-rwv-rows-menuOpen .dsh-rwv-rows-rowActions,
.dsh-rwv-rows-sessionRow.dsh-rwv-rows-menuOpen .dsh-rwv-rows-rowActions {
  display: inline-flex;
}

/* The search heading has no trailing time cell, so the unarchive action
   right-aligns itself. */
.dsh-rwv-rows-searchResultHeading .dsh-rwv-rows-rowActions {
  margin-left: auto;
}

.dsh-rwv-rows-sessionRow:hover .dsh-rwv-rows-time,
.dsh-rwv-rows-sessionRow.dsh-rwv-rows-menuOpen .dsh-rwv-rows-time {
  display: none;
}

/* Hover swaps the trailing cell to the action buttons, which already carry
   the pin/archive glyphs — hide the static markers so they do not double. */
.dsh-rwv-rows-sessionRow:hover .dsh-rwv-rows-pinIndicator,
.dsh-rwv-rows-sessionRow.dsh-rwv-rows-menuOpen .dsh-rwv-rows-pinIndicator {
  display: none;
}

/* The unclipped hover state drops the ellipsis, which would otherwise cover
   the characters the marquee reached. Guarded because a touch tap
   latches \`:hover\` on the row after the title has already returned: an
   unguarded rule would strand that row without its ellipsis. */
@media (hover: hover) {
  .dsh-rwv-rows-sessionRow:hover .dsh-rwv-rows-title,
  .dsh-rwv-rows-sessionRow.dsh-rwv-rows-menuOpen .dsh-rwv-rows-title {
    text-overflow: clip;
  }
}

/* An open row menu pins the hover affordances (figma: the row keeps its
   hover fill while its dropdown is up). */
.dsh-rwv-rows-projectRow.dsh-rwv-rows-menuOpen,
.dsh-rwv-rows-sessionRow.dsh-rwv-rows-menuOpen {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* Session drag insert marker: a leading chevron and 2px rule between rows,
   absolutely positioned so it neither resembles a row border nor changes layout. */
.dsh-rwv-rows-sessionRow.dsh-rwv-rows-dropBefore,
.dsh-rwv-rows-sessionRow.dsh-rwv-rows-dropAfter {
  position: relative;
}

.dsh-rwv-rows-sessionRow.dsh-rwv-rows-dropBefore::before,
.dsh-rwv-rows-sessionRow.dsh-rwv-rows-dropAfter::after {
  content: '';
  position: absolute;
  z-index: 1;
  left: 0;
  right: 4px;
  height: 12px;
  background:
    linear-gradient(
      55deg,
      transparent calc(50% - 1px),
      var(--dsw-alias-state-business-primary) calc(50% - 1px) calc(50% + 1px),
      transparent calc(50% + 1px)
    ) 0 0 / 5px 7px no-repeat,
    linear-gradient(
      125deg,
      transparent calc(50% - 1px),
      var(--dsw-alias-state-business-primary) calc(50% - 1px) calc(50% + 1px),
      transparent calc(50% + 1px)
    ) 0 5px / 5px 7px no-repeat,
    linear-gradient(
      var(--dsw-alias-state-business-primary) 0 0
    ) 4px 5px / calc(100% - 4px) 2px no-repeat;
  pointer-events: none;
}

.dsh-rwv-rows-sessionRow.dsh-rwv-rows-dropBefore::before {
  top: -7px;
}

.dsh-rwv-rows-sessionRow.dsh-rwv-rows-dropAfter::after {
  bottom: -7px;
}

/* Hover-card body (figma 169:16903): dark surface, fixed colors both themes. */
.dsh-rwv-rows-hoverContent {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dsh-rwv-rows-hoverTitle {
  font-size: 14px;
  line-height: 20px;
  color: #FFFFFF;
  overflow-wrap: break-word;
}

.dsh-rwv-rows-hoverPath {
  font-size: 12px;
  line-height: 16px;
  color: #CFD3D6;
  word-break: break-all;
}

.dsh-rwv-rows-hoverTime {
  font-size: 12px;
  line-height: 16px;
  color: #CFD3D6;
}

.dsh-rwv-rows-hoverStatus {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  line-height: 20px;
  color: #ADB2B8;
}

/* Archive glyph rides the status row's text color; slight inset aligns it with the 6px status dots. */
.dsh-rwv-rows-hoverArchived svg {
  flex-shrink: 0;
  margin: 0 -4px;
}

.dsh-rwv-rows-iconButton {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: var(--dsw-radius-xs);
  padding: 0;
  background: transparent;
  cursor: pointer;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rwv-rows-iconButton:hover {
  color: var(--dsw-alias-label-primary);
}

/* Chevrons ride the caption grey (#ADB2B8); the folder glyph stays one step
   darker (tertiary, #81858C) per the cell spec. */
.dsh-rwv-rows-chevron {
  color: var(--dsw-alias-label-caption);
}

@media (prefers-reduced-motion: reduce) {
  .dsh-rwv-rows-arrow {
    animation: none;
    transition: none;
  }
}

.dsh-rwv-anim-exits {
  position: absolute;
  inset: 0;
  contain: strict;
  overflow: clip;
  pointer-events: none;
}

`;
		//#endregion
		//#region src/client/vendor/workspace-rows/render-slot.tsx
		/**
		* Build the render seat for one row.
		* @param content - the leading/menu/actions share for this row.
		* @returns the seat the vendored row expects.
		*/
		function rowRenderSlots(content) {
			return ((key, _owner, options) => {
				if (key === "sidebar.session.row.leading") return content.leading;
				if (key === "sidebar.workspaces.session.row.action") return content.actions;
				if (key === "sidebar.workspaces.session.menu.item") {
					const hook = options?.hookContext;
					return content.menu?.(() => {
						hook?.[1](false);
					}) ?? null;
				}
				return null;
			});
		}
		//#endregion
		//#region src/client/tree.tsx
		/**
		* The remote tree — rendered with the **official** workspace row components.
		*
		* The rows are not drawn here: `ProjectRowItem` (a group/workspace row) and
		* `SessionNodeItem` (a session row) are vendored verbatim from the shell's
		* `ui-workspace` client into `./vendor/workspace-rows`, together with their
		* stylesheet and the `workspace` locale dictionaries. So a remote workspace and
		* a remote session look and behave exactly like the shell's own — 34px/32px
		* rows, hover swaps (folder → chevron, time → row actions), title marquee,
		* hover cards, the `⋮` menu, selected/hover backgrounds — with no row styling
		* of our own.
		*
		* What this file owns is the walk, because our hierarchy has one level the
		* shell's does not: connection → workspace → session. No level is indented —
		* the shell's own tree is flat (see {@link Level}), so ours is too.
		*
		* Row verbs are the official ones with our meanings (the menu is fixed to a
		* rename/delete pair plus the `+` button, so the *labels* are what change):
		*
		*   connection  ＋ 添加工作区   ⋮ 连接/断开 · 删除连接
		*   workspace   ＋ 新会话       ⋮ 重命名工作区 · 移除工作区
		*   session     (click the row)  ⋮ 置顶/重命名/分叉/归档
		*/
		/** Tick the clock so relative row times stay honest while the panel is open. */
		function useNow() {
			const [now, setNow] = (0, react.useState)(() => Date.now());
			(0, react.useEffect)(() => {
				const timer = window.setInterval(() => {
					setNow(Date.now());
				}, 6e4);
				return () => {
					window.clearInterval(timer);
				};
			}, []);
			return now;
		}
		/**
		* One level's wrapper.
		*
		* **No indent anywhere.** The shell's own tree is flat: a workspace row and the
		* session rows under it both carry the official row CSS's base inset
		* (`padding-inline-start: calc(8px + var(--dsh-workspace-indent, 0px))`) with
		* `--dsh-workspace-indent: 0px` on every group section — measured on the deployed
		* shell: workspace row padding 8px, session row padding 8px, first child at x=20
		* for both. So this plugin sets no indent either, and its three levels line up
		* exactly like the shell's rows (the connection row reads as the header above
		* the workspace rows).
		*/
		function Level(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: props.className,
				"data-state": props.state,
				children: props.children
			});
		}
		/** The shell's row verb for one connection, relabelled to what we actually do. */
		function connectionTranslate(target) {
			const connected = target.status === "ready";
			return (key, params) => {
				if (key === "rename") return connected ? t("tree.conn.disconnect") : t("tree.conn.connect");
				if (key === "delete.workspace") return t("tree.forgetConnection");
				if (key === "actions.newSession" || key === "actions.newSession.aria") return connected ? t("tree.conn.addWorkspace") : t("tree.conn.connect");
				return rowsTranslate(key, params);
			};
		}
		/** Row verbs for a remote workspace. */
		function workspaceTranslate(workspace) {
			return (key, params) => {
				if (key === "rename") return t("tree.workspace.rename");
				if (key === "delete.workspace") return t("tree.workspace.forget");
				if (key === "actions.newSession" || key === "actions.newSession.aria") return t("tree.workspace.newSession");
				if (key === "actions.workspace.aria") return t("tree.workspace.aria", { name: workspace.title });
				return rowsTranslate(key, params);
			};
		}
		/** Row verbs for a remote session. */
		function sessionTranslate(title) {
			return (key, params) => {
				if (key === "actions.session.aria") return t("tree.session.aria", { name: title });
				return rowsTranslate(key, params);
			};
		}
		/** One stored remote session as the official session row consumes it. */
		function sessionNode(session, flags) {
			return {
				id: session.id,
				title: session.title ?? "",
				blank: false,
				running: false,
				runningSubagentCount: 0,
				completed: false,
				pinned: flags.pinned.has(session.id),
				archived: flags.archived.has(session.id),
				updatedAt: session.updatedAt ?? session.createdAt ?? Date.now()
			};
		}
		/** The provisional New Session row: the official blank-session presentation. */
		function blankSessionNode() {
			return {
				id: "",
				title: "",
				blank: true,
				running: false,
				runningSubagentCount: 0,
				completed: false,
				pinned: false,
				archived: false,
				updatedAt: Date.now()
			};
		}
		/**
		* The row's seat: hover buttons and `⋮` menu entries.
		*
		* The leading slot stays empty on purpose. The official row uses it for *status*
		* dots (a running turn, a pending approval); this plugin does not observe a
		* remote session's status, and a dot meaning "this is the open one" is already
		* the row's selected background. An always-animating dot on every row read as a
		* stuck spinner (user report), so nothing is rendered there.
		*
		* @param workspace - the workspace the session belongs to.
		* @param session - the stored session.
		* @param flags - this workspace's pin/archive sets.
		* @returns the seat for `SessionNodeItem`.
		*/
		function sessionSeat(workspace, session, flags) {
			const verbs = {
				workspace,
				session,
				title: session.title ?? workspace.title,
				pinned: flags.pinned.has(session.id),
				archived: flags.archived.has(session.id)
			};
			return {
				leading: null,
				menu: (close) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionMenu, {
					close,
					...verbs
				}, "menu"),
				actions: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionRowActions, { ...verbs }, "actions")
			};
		}
		/**
		* Tree semantics for one vendored row.
		*
		* The vendored rows are plain `div`s whose activation lives in a JS click
		* handler, so a screen reader — and any browser automation — sees **no target at
		* all** for a connection or workspace row (measured: the a11y inventory of the
		* sidebar exposes only 刷新 / 新建连接). Wrapping the row in a `treeitem` with a
		* tab stop and Enter/Space forwarding makes the same action keyboard-reachable
		* without touching the vendored component or firing the click twice.
		*/
		function TreeRow(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				role: "button",
				"aria-label": props.label,
				...props.expanded === void 0 ? {} : { "aria-expanded": props.expanded },
				tabIndex: 0,
				className: "dsh-rw-row-a11y",
				onKeyDown: (event) => {
					if (event.key !== "Enter" && event.key !== " ") return;
					event.preventDefault();
					props.onActivate();
				},
				children: props.children
			});
		}
		/** One session row plus the trailing New Session row of an expanded workspace. */
		function SessionRows(props) {
			const state = useAppState();
			const list = state.sessions[props.workspace.id];
			const items = orderSessions(list?.items ?? [], props.flags);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				items.map((session) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionNodeItem, {
					node: sessionNode(session, props.flags),
					currentId: state.currentSessionId,
					now: props.now,
					onOpen: (id) => {
						const found = items.find((candidate) => candidate.id === id);
						if (found === void 0) return;
						if (props.flags.archived.has(found.id)) {
							store.notifyError(t("tree.session.archivedNotOpenable"));
							return;
						}
						store.openSession(props.workspace, found);
					},
					onRenameRequest: () => {},
					renderSlot: rowRenderSlots(sessionSeat(props.workspace, session, props.flags)),
					t: sessionTranslate(session.title ?? props.workspace.title)
				}, session.id)),
				list !== void 0 && list.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsh-rw-side-error",
					children: t("tree.sessions.failed", { message: list.error.message })
				}),
				list !== void 0 && list.loading && items.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsh-rw-tree-empty",
					children: t("tree.sessions.loading")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionNodeItem, {
					node: blankSessionNode(),
					currentId: state.currentSessionId,
					now: props.now,
					onOpen: () => {
						store.reopenWorkspace(props.workspace);
					},
					onRenameRequest: () => {},
					renderSlot: rowRenderSlots({
						leading: null,
						menu: null,
						actions: null
					}),
					t: sessionTranslate(props.workspace.title)
				})
			] });
		}
		/** One remote workspace row plus its session rows. */
		function WorkspaceRow(props) {
			const state = useAppState();
			const { workspace } = props;
			const key = workspaceNodeKey(workspace.id);
			const expanded = state.expanded[key] ?? false;
			const list = state.sessions[workspace.id];
			const connected = props.target.status === "ready";
			const flags = workspaceFlags(workspace);
			const translate = (0, react.useMemo)(() => workspaceTranslate(workspace), [workspace.title]);
			const group = {
				key: workspace.id,
				workspaceId: workspace.remoteWorkspaceId ?? workspace.id,
				cwd: workspace.path,
				createdAt: Date.parse(workspace.createdAt),
				label: workspace.title,
				sessionCount: list?.items.length ?? 0,
				expanded,
				containsCurrent: state.currentSessionId !== void 0 && workspace.sessionId === state.currentSessionId,
				sessions: []
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TreeRow, {
				label: props.workspace.title,
				expanded,
				onActivate: () => {
					store.toggleNode(key);
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectRowItem, {
					group,
					onToggle: () => {
						store.toggleNode(key);
					},
					onCreate: () => {
						store.reopenWorkspace(workspace);
					},
					actions: {
						rename: () => {
							store.requestWorkspaceRename(workspace);
						},
						delete: () => {
							store.requestForgetWorkspace(workspace);
						}
					},
					t: connected ? translate : ((verb, params) => rowsTranslate(verb, params))
				})
			}), expanded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionRows, {
				workspace,
				now: props.now,
				flags
			})] });
		}
		/** One connection row (the level the shell's own tree does not have) plus its workspaces. */
		function ConnectionRow(props) {
			const state = useAppState();
			const { target } = props;
			const key = targetNodeKey(target.id);
			const expanded = state.expanded[key] ?? false;
			const connected = target.status === "ready";
			const translate = (0, react.useMemo)(() => connectionTranslate(target), [target.status]);
			const sessionCount = props.workspaces.reduce((total, workspace) => total + (state.sessions[workspace.id]?.items.length ?? 0), 0);
			const lastConnectedAt = Date.parse(target.lastConnectedAt ?? "");
			const group = {
				key: `conn:${target.id}`,
				workspaceId: `conn:${target.id}`,
				cwd: target.kind === "wsl" ? t("list.endpoint.wsl", { distro: target.wslDistro ?? target.host }) : t("list.endpoint", {
					username: target.username,
					host: target.host,
					port: target.port
				}),
				createdAt: Number.isNaN(lastConnectedAt) ? void 0 : lastConnectedAt,
				label: target.label,
				sessionCount,
				expanded,
				containsCurrent: false,
				sessions: []
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Level, {
				state: target.status,
				className: "dsh-rw-conn",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TreeRow, {
					label: target.label,
					expanded: connected && expanded,
					onActivate: () => {
						if (connected) store.toggleNode(key);
						else store.connectTarget(target);
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectRowItem, {
						group,
						onToggle: () => {
							if (connected) store.toggleNode(key);
							else store.connectTarget(target);
						},
						onCreate: () => {
							connected ? store.openAddWorkspace(target) : store.connectTarget(target);
						},
						actions: {
							rename: () => {
								connected ? store.stopTarget(target) : store.connectTarget(target);
							},
							delete: () => {
								store.requestForgetTarget(target);
							}
						},
						t: translate
					}, `conn:${target.status}`)
				})
			}), connected && expanded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: props.workspaces.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: "dsh-rw-tree-empty",
				children: t("tree.conn.noWorkspace")
			}) : props.workspaces.map((workspace) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkspaceRow, {
				workspace,
				target,
				now: props.now
			}, workspace.id)) })] });
		}
		/**
		* The whole remote tree.
		* @param props.empty - text shown when no connection is saved yet.
		* @param props.compact - sidebar presentation flag (kept for the panel copy).
		*/
		function RemoteTree(props) {
			const state = useAppState();
			const now = useNow();
			if (state.targets.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: "dsh-rw-tree-empty",
				children: props.empty ?? t("tree.empty")
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AddWorkspaceDialog, {}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConfirmDialog, {}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RenameSessionDialog, {}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkspaceRenameDialog, {}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: props.compact ? "dsh-rw-tree dsh-rw-tree--compact" : "dsh-rw-tree",
					role: "tree",
					"aria-label": t("tree.sidebar.title"),
					children: state.targets.map((target) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConnectionRow, {
						target,
						workspaces: state.workspaces.filter((workspace) => workspace.targetId === target.id),
						now
					}, target.id))
				})
			] });
		}
		/**
		* Order one workspace's sessions the way the shell orders its own: pinned rows
		* lead (in the shell's pin order), then most recent activity, with archived
		* rows last — and pinned/archived membership comes from the official sets.
		* @param items - the stored sessions.
		* @param flags - the official pin/archive sets.
		* @returns the row order.
		*/
		function orderSessions(items, flags) {
			const rank = (session) => {
				if (flags.pinned.has(session.id)) return 0;
				return flags.archived.has(session.id) ? 2 : 1;
			};
			return [...items].sort((left, right) => {
				const byRank = rank(left) - rank(right);
				if (byRank !== 0) return byRank;
				return (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0);
			});
		}
		//#endregion
		//#region src/client/list.tsx
		/** One row of the 远端已注册 tab: a workspace the remote dsh registered. */
		function AddWorkspaceRow(props) {
			const { entry } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: "dsh-rw-picker-row",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-rw-tree-icon",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWorkspaceTreeOutlineRegular, { size: 13 })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsh-rw-picker-main",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-rw-picker-title",
							children: entry.title
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.PathLabel, {
							path: entry.path,
							className: "dsh-rw-tree-path"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-rw-tree-meta",
						children: t("tree.addWorkspace.sessions", { count: entry.sessionCount })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: props.added ? "ghost" : "outline",
						size: "sm",
						disabled: props.pending,
						onClick: () => {
							store.adoptRemoteWorkspace(entry);
						},
						children: props.added ? t("tree.addWorkspace.added") : t("tree.addWorkspace.add")
					})
				]
			});
		}
		/**
		* The 添加工作区 dialog: 浏览目录 (default) and 远端已注册.
		*
		* Opening it opens the browser, including its connect-first step for a target
		* whose channel is down (`store.openBrowseDirectory` shows 连接中 inside the
		* dialog rather than a blank pane).
		*/
		function AddWorkspaceDialog() {
			const owned = useSingleHost("add-workspace");
			const state = useAppState();
			const dialog = state.addWorkspace;
			if (!owned || dialog === void 0) return null;
			const added = new Set(state.workspaces.filter((workspace) => workspace.targetId === dialog.targetId).map((workspace) => workspace.path));
			const browse = dialog.tab === "browse";
			const { directory } = state;
			const canOpen = browse && !state.pending && !directory.loading && !directory.connecting && directory.listing !== void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: store.closeAddWorkspace,
				title: t("tree.addWorkspace.title"),
				closeLabel: t("tree.addWorkspace.close"),
				description: t("tree.addWorkspace.description", { label: dialog.targetLabel }),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-rw-footer-actions",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-rw-footer-group",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "ghost",
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 12 }),
							disabled: browse ? directory.loading : dialog.loading,
							onClick: () => {
								if (!browse) {
									store.refreshAddWorkspace();
									return;
								}
								const targetId = directory.targetId;
								if (targetId === void 0) return;
								store.loadDirectory(targetId, directory.listing?.path ?? "");
							},
							children: t("common.refresh")
						})
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsh-rw-footer-group",
						children: [browse && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							disabled: !canOpen,
							onClick: () => {
								store.openWorkspace();
							},
							children: state.pending ? t("directory.opening") : t("directory.open")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "ghost",
							onClick: store.closeAddWorkspace,
							children: t("tree.addWorkspace.close")
						})]
					})]
				}),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-rw-picker",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SegmentedControl, {
						id: "dsh-rw-add-workspace-tab",
						value: dialog.tab,
						label: t("tree.addWorkspace.title"),
						options: [{
							value: "browse",
							label: t("tree.addWorkspace.tab.browse")
						}, {
							value: "registry",
							label: t("tree.addWorkspace.tab.registry")
						}],
						onChange: (next) => {
							store.setAddWorkspaceTab(next);
						}
					}), browse ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DirectoryPicker, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						dialog.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorBanner, { error: dialog.error }),
						dialog.loading && dialog.items.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoadingLine, { text: t("tree.addWorkspace.loading") }),
						!dialog.loading && dialog.items.length === 0 && dialog.error === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyState, { text: t("tree.addWorkspace.empty") }),
						dialog.items.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: "dsh-rw-picker-list",
							children: dialog.items.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AddWorkspaceRow, {
								entry,
								added: added.has(entry.path),
								pending: state.pending
							}, entry.id))
						})
					] })]
				})
			});
		}
		/** The panel body: the same tree as the sidebar, at full width. */
		function ListBody() {
			const state = useAppState();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-stack",
				children: [state.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorBanner, {
					error: state.error,
					onDismiss: store.dismissError
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-rw-scroll",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-rw-hint",
							children: t("tree.hint")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-rw-hint",
							children: state.pluginVersion === "" ? t("list.meta.unknown") : t("list.meta", {
								version: state.pluginVersion,
								profile: state.defaultProfile
							})
						}),
						state.stateLoading && !state.stateLoaded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoadingLine, { text: t("list.loading") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-rw-section",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: "dsh-rw-section-title",
								children: t("tree.title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RemoteTree, { compact: false })]
						})
					]
				})]
			});
		}
		//#endregion
		//#region src/client/method-cards.ts
		/**
		* The connection methods the wizard's step 1 presents.
		*
		* Kept as a **pure module** (no React, no shell services) for two reasons:
		*
		*  - the acceptance criterion for step 1 is "ssh, plus wsl only on Windows, and
		*    no reserved/teaser card" — a list that can be asserted directly in a test,
		*    which a component table inside `wizard.tsx` cannot be (that file imports
		*    the shell's runtime module table, which this repository does not install);
		*  - visibility must be decided by the *shared* predicate the host validates
		*    `connect/start` with ({@link methodAvailable}), so "hidden on the client"
		*    and "refused on the host" cannot drift.
		*/
		/** Offered methods, in display order. */
		const OFFERED_METHODS = ["ssh", "wsl"];
		/**
		* The offered methods this host platform can actually run.
		* @param platform - the harness host's `process.platform` (`'win32'`, `'darwin'`, …).
		* @returns the methods to render as cards, in display order.
		*/
		function offeredMethods(platform) {
			return OFFERED_METHODS.filter((method) => methodAvailable(method, platform));
		}
		//#endregion
		//#region src/client/wizard.tsx
		/**
		* The **three**-step remote-connection wizard:
		*   ① choose a method → ② fill the configuration → ③ choose how the remote side
		*   is provisioned, connect, and watch it happen.
		*
		* Step 3 is deliberately one surface: the connection-method cards (reuse the
		* machine's dsh / upload the server package / download remotely-disabled), the
		* scan results that back the first two, the five progress rows, the live log and
		* the host-key confirmation all belong to the same decision. The remote-directory
		* browser that used to be step 4 is now the default tab of the 添加工作区 dialog
		* (`directory-picker.tsx`) — browsing a directory is a workspace action, not a
		* step of connecting.
		*
		* All state comes from the module store (`./store.ts`), so the wizard and the
		* sidebar-footer button share it without React context across separately
		* registered slot entries.
		*/
		/** Step order of the wizard. */
		const STEP_ORDER = [
			"method",
			"config",
			"connect"
		];
		/**
		* Method cards, in display order.
		*
		* The list itself lives in `method-cards.ts` (pure, unit-tested): step 1 offers
		* ssh everywhere and wsl on a Windows host, and a card is *rendered* only when
		* `methodAvailable` — the predicate the host validates too — says the platform
		* can host it, so off Windows the WSL card does not exist at all (not greyed
		* out — absent).
		*/
		/** Localized name/description key per method card. */
		const METHOD_NAME_KEYS = {
			ssh: "method.ssh.name",
			wsl: "method.wsl.name"
		};
		/** Localized description key per method card. */
		const METHOD_DESCRIPTION_KEYS = {
			ssh: "method.ssh.description",
			wsl: "method.wsl.description"
		};
		/**
		* Step 3's three cards.
		*
		* `download` is rendered but never selectable: it would fetch a released server
		* package, and there is no release yet (its copy says exactly that). Only the
		* *card* is unavailable — `assets.downloadServerPackage` still serves the
		* `auto` policy of pre-existing targets.
		*/
		const MODE_CARDS = [
			{ id: "reuse" },
			{ id: "upload" },
			{
				id: "download",
				disabled: true
			}
		];
		/** Localized name/description key per connection-method card. */
		const MODE_NAME_KEYS = {
			reuse: "connect.mode.reuse.name",
			upload: "connect.mode.upload.name",
			download: "connect.mode.download.name"
		};
		/** Localized description key per connection-method card. */
		const MODE_DESCRIPTION_KEYS = {
			reuse: "connect.mode.reuse.description",
			upload: "connect.mode.upload.description",
			download: "connect.mode.download.description"
		};
		/** Step label key per wizard step. */
		const STEP_LABELS = {
			method: "step.label.method",
			config: "step.label.config",
			connect: "step.label.connect"
		};
		/** Progress-row label key per server step. */
		const CONNECT_STEP_LABELS = {
			connect: "connect.step.connect",
			runtime: "connect.step.runtime",
			probe: "connect.step.probe",
			upload: "connect.step.upload",
			start: "connect.step.start"
		};
		/** Status label key per progress status. */
		const CONNECT_STATUS_LABELS = {
			pending: "connect.status.pending",
			running: "connect.status.running",
			ok: "connect.status.ok",
			failed: "connect.status.failed"
		};
		/** State-dot semantic per progress status. */
		function dotState(status) {
			switch (status) {
				case "running": return "ongoing";
				case "ok": return "done";
				case "failed": return "error";
				default: return "idle";
			}
		}
		/** Short summary of one `~/.ssh/config` alias for the dropdown. */
		function aliasLabel(alias) {
			if (alias.hostName === void 0 || alias.hostName === "") return alias.alias;
			const user = alias.user !== void 0 && alias.user !== "" ? `${alias.user}@` : "";
			const port = alias.port === void 0 ? "" : `:${alias.port}`;
			return `${alias.alias} — ${user}${alias.hostName}${port}`;
		}
		/** Human-readable package size for the "already cached" line. */
		function formatSize(bytes) {
			if (bytes === void 0 || bytes <= 0) return "—";
			return `${(bytes / 1048576).toFixed(1)} MB`;
		}
		/** Step indicator: one pill per step, earlier steps are jump targets. */
		function StepPills(props) {
			const current = STEP_ORDER.indexOf(props.state.step);
			const blocked = props.state.connect.phase === "running" || props.state.connect.phase === "awaiting-hostkey";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-rw-steps",
				role: "list",
				"aria-label": t("wizard.steps.aria"),
				children: STEP_ORDER.map((step, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-rw-step-pill",
					role: "listitem",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
						active: step === props.state.step,
						...index < current && !blocked ? {
							onClick: () => {
								store.setStep(step);
							},
							title: t("step.goBackTo", { label: t(STEP_LABELS[step]) })
						} : {},
						children: `${index + 1}. ${t(STEP_LABELS[step])}`
					})
				}, step))
			});
		}
		/** Step 1 — connection method. */
		function MethodStep(props) {
			const cards = offeredMethods(props.state.platform);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-section",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: "dsh-rw-section-title",
						children: t("method.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-rw-hint",
						children: t("method.description")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-rw-methods",
						children: cards.map((method, index) => {
							const selected = props.state.method === method;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "dsh-rw-method",
								"data-selected": selected ? "true" : void 0,
								"aria-pressed": selected,
								"aria-label": method === "ssh" ? t("method.ssh.aria") : t("method.wsl.aria"),
								...index === 0 ? { "data-step-focus": true } : {},
								onClick: () => {
									store.setMethod(method);
									store.setStep("config");
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dsh-rw-method-name",
									children: [
										method === "ssh" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconGlobeOutlineRegular, { size: 16 }),
										t(METHOD_NAME_KEYS[method]),
										selected && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
											tone: "info",
											children: t("method.selected")
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-rw-method-description",
									children: t(METHOD_DESCRIPTION_KEYS[method])
								})]
							}, method);
						})
					})
				]
			});
		}
		/** Known `wsl.exe` states rendered in the user's language; anything else verbatim. */
		function wslStateLabel(state) {
			if (state === void 0) return void 0;
			const lowered = state.toLowerCase();
			if (lowered.startsWith("running")) return t("wsl.state.running");
			if (lowered.startsWith("stopped")) return t("wsl.state.stopped");
			if (lowered.startsWith("installing")) return t("wsl.state.installing");
			return state;
		}
		/**
		* The WSL fields of step 2: distribution detection, selection and the optional
		* distro user.
		*
		* Detection runs when the step is entered (`store.loadWslDistros`); this
		* component only renders the outcome and lets the user re-run it. When nothing
		* is detected the distribution is still typeable, so a WSL install that the
		* probe cannot enumerate (or a distro the user knows by name) is not a dead end.
		*/
		function WslConfigFields(props) {
			const { config, wslProbe, pending } = props.state;
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const hasList = wslProbe.distros.length > 0;
			const selected = wslProbe.distros.find((distro) => distro.name === config.wslDistro);
			const items = wslProbe.distros.map((distro) => ({
				id: distro.name,
				label: [
					distro.name,
					wslStateLabel(distro.state),
					distro.default ? t("wsl.default") : void 0
				].filter((part) => part !== void 0 && part !== "").join(" · ")
			}));
			const trigger = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled: pending || wslProbe.status === "loading",
				"aria-haspopup": "menu",
				"aria-expanded": menuOpen,
				"aria-label": t("config.wslDistro"),
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 12 }),
				onClick: () => {
					setMenuOpen((open) => !open);
				},
				children: selected === void 0 ? config.wslDistro === "" ? t("config.wslDistro.pick") : config.wslDistro : [selected.name, wslStateLabel(selected.state)].filter((part) => part !== void 0).join(" · ")
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					label: t("config.wslDistro"),
					hint: t("config.wslDistro.hint"),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-rw-inline",
						children: [
							hasList ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
								open: menuOpen,
								onClose: () => {
									setMenuOpen(false);
								},
								items,
								selectedId: config.wslDistro,
								onSelect: (id) => {
									setMenuOpen(false);
									store.patchConfig({ wslDistro: id });
								},
								align: "start",
								portal: true,
								anchor: trigger
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								"data-step-focus": true,
								value: config.wslDistro,
								placeholder: t("config.wslDistro.placeholder"),
								"aria-label": t("config.wslDistro"),
								onChange: (event) => {
									store.patchConfig({ wslDistro: event.target.value });
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "ghost",
								size: "sm",
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 12 }),
								"aria-label": t("common.refresh"),
								disabled: wslProbe.status === "loading",
								onClick: () => {
									store.loadWslDistros(true);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-rw-field-hint",
								children: wslProbe.status === "loading" ? t("wsl.detecting") : wslProbe.status === "unavailable" ? t("wsl.unavailable", { reason: wslProbe.error ?? "" }) : hasList ? t("wsl.detected", { count: String(wslProbe.distros.length) }) : t("wsl.empty")
							})
						]
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
					label: t("config.wslUser"),
					hint: t("config.wslUser.hint"),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
						value: config.wslUser,
						placeholder: t("config.wslUser.placeholder"),
						"aria-label": t("config.wslUser"),
						onChange: (event) => {
							store.patchConfig({ wslUser: event.target.value });
						}
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsh-rw-hint",
					children: t("config.wsl.note")
				})
			] });
		}
		/** Step 2 — connection configuration. */
		function ConfigStep(props) {
			const { config, aliases, aliasesLoading, aliasesLoaded, aliasWarnings, prefilling, pending, secretPending } = props.state;
			const wsl = props.state.method === "wsl";
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const [advancedOpen, setAdvancedOpen] = (0, react.useState)(false);
			const items = aliases.map((alias) => ({
				id: alias.alias,
				label: aliasLabel(alias)
			}));
			const aliasTrigger = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled: aliasesLoading || items.length === 0,
				"aria-haspopup": "menu",
				"aria-expanded": menuOpen,
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 12 }),
				onClick: () => {
					setMenuOpen((open) => !open);
				},
				children: t("config.aliasFromSsh")
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-rw-section",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-rw-fields",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
							label: t("config.alias"),
							hint: t("config.alias.hint"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								"data-step-focus": true,
								value: config.label,
								placeholder: t("config.alias.placeholder"),
								"aria-label": t("config.alias"),
								onChange: (event) => {
									store.patchConfig({ label: event.target.value });
								}
							})
						}),
						wsl && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WslConfigFields, { state: props.state }),
						!wsl && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-rw-inline",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
										open: menuOpen,
										onClose: () => {
											setMenuOpen(false);
										},
										items,
										selectedId: config.sshConfigAlias,
										onSelect: (id) => {
											setMenuOpen(false);
											store.chooseAlias(id);
										},
										align: "start",
										portal: true,
										anchor: aliasTrigger
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "ghost",
										size: "sm",
										icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 12 }),
										"aria-label": t("common.refresh"),
										disabled: aliasesLoading,
										onClick: () => {
											store.loadAliases(true);
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsh-rw-field-hint",
										children: aliasesLoading ? t("config.aliasFromSsh.loading") : prefilling ? t("config.aliasFromSsh.prefilling") : aliasesLoaded && aliases.length === 0 ? t("config.aliasFromSsh.empty") : ""
									})
								]
							}),
							aliasWarnings.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsh-rw-hint",
								title: aliasWarnings.join("\n"),
								children: `${t("config.aliasFromSsh.warning", { count: aliasWarnings.length })}: ${aliasWarnings[0] ?? ""}`
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-rw-grid",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
										label: t("config.host"),
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
											value: config.host,
											placeholder: t("config.host.placeholder"),
											"aria-label": t("config.host"),
											onChange: (event) => {
												store.patchConfig({ host: event.target.value });
											}
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
										label: t("config.port"),
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
											value: config.port,
											inputMode: "numeric",
											"aria-label": t("config.port"),
											onChange: (event) => {
												store.patchConfig({ port: event.target.value });
											}
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
										label: t("config.username"),
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
											value: config.username,
											"aria-label": t("config.username"),
											onChange: (event) => {
												store.patchConfig({ username: event.target.value });
											}
										})
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
								label: t("config.authKind"),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SegmentedControl, {
									id: "dsh-rw-auth",
									value: config.authKind,
									disabled: prefilling || pending,
									label: t("config.authKind.label"),
									options: [
										{
											value: "password",
											label: t("config.auth.password")
										},
										{
											value: "privateKey",
											label: t("config.auth.privateKey")
										},
										{
											value: "agent",
											label: t("config.auth.agent")
										}
									],
									onChange: (next) => {
										store.patchConfig({ authKind: next });
									}
								})
							}),
							config.authKind === "password" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
								label: t("config.secret.password"),
								hint: secretPending ? t("config.secret.reEnter") : t("config.secret.neverStored"),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									type: "password",
									autoComplete: "off",
									value: config.secret,
									"aria-label": t("config.secret.password"),
									onChange: (event) => {
										store.patchConfig({ secret: event.target.value });
									}
								})
							}),
							config.authKind === "privateKey" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
								label: t("config.secret.privateKeyPath"),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									value: config.privateKeyPath,
									placeholder: t("config.secret.privateKeyPath.placeholder"),
									"aria-label": t("config.secret.privateKeyPath"),
									onChange: (event) => {
										store.patchConfig({ privateKeyPath: event.target.value });
									}
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
								label: t("config.secret.passphrase"),
								hint: secretPending ? t("config.secret.reEnter") : t("config.secret.neverStored"),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									type: "password",
									autoComplete: "off",
									value: config.secret,
									"aria-label": t("config.secret.passphrase"),
									onChange: (event) => {
										store.patchConfig({ secret: event.target.value });
									}
								})
							})] }),
							config.authKind === "agent" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsh-rw-hint",
								children: t("config.secret.agent.note")
							})
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconGlobeOutlineRegular, { size: 14 }),
							title: t("config.advanced"),
							open: advancedOpen,
							expandable: true,
							onToggle: () => {
								setAdvancedOpen((open) => !open);
							},
							expandOnRowClick: true,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-rw-fields",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsh-rw-hint",
									children: t("config.advanced.hint")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-rw-grid",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
											label: t("config.nodePath"),
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
												value: config.nodePath,
												"aria-label": t("config.nodePath"),
												onChange: (event) => {
													store.patchConfig({ nodePath: event.target.value });
												}
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
											label: t("config.dshCommand"),
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
												value: config.dshCommand,
												"aria-label": t("config.dshCommand"),
												onChange: (event) => {
													store.patchConfig({ dshCommand: event.target.value });
												}
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
											label: t("config.profile"),
											hint: props.state.defaultProfile === "" ? void 0 : t("config.useDefault", { value: props.state.defaultProfile }),
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
												value: config.profile,
												"aria-label": t("config.profile"),
												onChange: (event) => {
													store.patchConfig({ profile: event.target.value });
												}
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
											label: t("config.dshHome"),
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
												value: config.dshHome,
												"aria-label": t("config.dshHome"),
												onChange: (event) => {
													store.patchConfig({ dshHome: event.target.value });
												}
											})
										})
									]
								})]
							})
						})
					]
				})
			});
		}
		/**
		* The host-key confirmation panel.
		*
		* ONE component for both flows that can stop on an unknown fingerprint: the
		* connection attempt (frame `host-key`) and the read-only scan
		* (`stage: 'host-key'`). The requirement is that they are literally the same
		* panel — same copy, same explicit confirmation, never automatic.
		*/
		function HostKeyPanel(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-hostkey",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsh-rw-hostkey-title",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningTriangleOutlineRegular, { size: 14 }), t("connect.hostKey.title")]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-rw-hint",
						children: t("connect.hostKey.description")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-rw-field-label",
						children: t("connect.hostKey.fingerprint")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-rw-mono",
						children: props.fingerprint
					})] }),
					props.algorithm !== void 0 && props.algorithm !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-rw-field-label",
						children: t("connect.hostKey.algorithm")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-rw-mono",
						children: props.algorithm
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-rw-inline",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							"data-step-focus": true,
							disabled: props.answering || props.confirmed,
							onClick: props.onConfirm,
							children: props.confirmed ? props.confirmedLabel : props.answering ? props.answeringLabel : props.confirmLabel
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "ghost",
							disabled: props.answering,
							onClick: props.onCancel,
							children: props.cancelLabel
						})]
					})
				]
			});
		}
		/** One candidate row of the reuse list. */
		function CandidateRow(props) {
			const { candidate } = props;
			const usable = candidate.compatible && candidate.executable;
			const profile = candidate.profile;
			const pluginText = profile === void 0 ? t("dsh.plugin.none") : profile.upToDate ? t("dsh.plugin.installed", { version: profile.pluginVersion ?? t("dsh.version.unknown") }) : t("dsh.plugin.outdated", { version: profile.pluginVersion ?? t("dsh.version.unknown") });
			const versionTone = candidate.compatible ? "success" : "danger";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "dsh-rw-candidate",
				"data-selected": props.selected ? "true" : void 0,
				"data-compatible": candidate.compatible ? "true" : "false",
				"aria-pressed": props.selected,
				"aria-disabled": usable ? void 0 : "true",
				disabled: !usable,
				title: candidate.path,
				onClick: () => {
					if (usable) store.selectDshCandidate(candidate.path);
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsh-rw-candidate-main",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-rw-candidate-path",
							children: candidate.path
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsh-rw-candidate-meta",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
									tone: "neutral",
									children: candidate.version === "" ? t("dsh.version.unknown") : candidate.version
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
									tone: versionTone,
									children: candidate.compatible ? t("dsh.compatible") : t("dsh.incompatible")
								}),
								!candidate.executable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
									tone: "warning",
									children: t("dsh.notExecutable")
								}),
								candidate.selfContained && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
									tone: "quiet",
									children: t("dsh.selfContained")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-rw-candidate-note",
									children: pluginText
								}),
								candidate.nodePath !== void 0 && candidate.nodePath !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-rw-candidate-note",
									children: t("dsh.nodePath", { path: candidate.nodePath })
								})
							]
						}),
						candidate.reason !== void 0 && candidate.reason !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-rw-candidate-reason",
							children: candidate.reason
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-rw-candidate-action",
					children: props.selected ? t("dsh.selected") : t("dsh.select")
				})]
			});
		}
		/**
		* Step 3's reuse panel: the scan's four states, all with text.
		*
		*   scanning          → 扫描中
		*   host-key pending  → the shared confirmation panel; confirming re-scans with
		*                       the fingerprint (a scan pins and stores nothing)
		*   ready, no rows    → 无候选
		*   ready, rows       → the candidate list (path / version / compatibility /
		*                       whether the server plugin is already there)
		*/
		function ReusePanel(props) {
			const { dshScan, config } = props.state;
			const scanning = dshScan.status === "scanning";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-scan",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-rw-inline",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-rw-field-hint",
							children: scanning ? t("connect.scan.scanning") : dshScan.status === "ready" ? t("connect.scan.ready", { count: dshScan.candidates.length }) : ""
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "ghost",
							size: "sm",
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 12 }),
							disabled: scanning,
							onClick: () => {
								store.scanDsh(true);
							},
							children: t("connect.scan.retry")
						})]
					}),
					dshScan.fingerprint !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-rw-hint",
						children: t("connect.scan.hostKey.pending")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HostKeyPanel, {
						fingerprint: dshScan.fingerprint,
						answering: scanning,
						confirmed: false,
						confirmLabel: t("connect.hostKey.trust"),
						answeringLabel: t("connect.hostKey.trusting"),
						confirmedLabel: t("connect.hostKey.trusted"),
						cancelLabel: t("common.back"),
						onConfirm: () => {
							store.scanDsh(true);
						},
						onCancel: () => {
							store.setStep("config");
						}
					})] }),
					scanning && dshScan.fingerprint === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoadingLine, { text: t("connect.scan.scanning") }),
					dshScan.status === "unavailable" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorBanner, { error: {
						code: "scan-failed",
						message: t("connect.scan.failed", { message: dshScan.error ?? "" })
					} }),
					dshScan.status === "ready" && dshScan.candidates.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyState, { text: t("connect.scan.empty") }),
					dshScan.status === "ready" && dshScan.candidates.length > 0 && !dshScan.candidates.some((candidate) => candidate.compatible && candidate.executable) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-rw-hint",
						children: t("connect.scan.empty")
					}),
					dshScan.status === "ready" && dshScan.candidates.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-rw-candidates",
						children: dshScan.candidates.map((candidate) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CandidateRow, {
							candidate,
							selected: config.reuseLauncherPath !== "" && config.reuseLauncherPath === candidate.path
						}, candidate.realPath === "" ? candidate.path : candidate.realPath))
					})
				]
			});
		}
		/**
		* Step 3's upload panel: which package the remote architecture needs and whether
		* it is already cached locally (then it is uploaded as is) or has to be built
		* here (minutes). The facts come from the same `dsh-scan` the reuse list uses.
		*/
		function UploadPanel(props) {
			const { dshScan } = props.state;
			const scanning = dshScan.status === "scanning";
			const probe = dshScan.probe;
			const pkg = dshScan.package;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-scan",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-rw-inline",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "ghost",
							size: "sm",
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 12 }),
							disabled: scanning,
							onClick: () => {
								store.scanDsh(true);
							},
							children: t("connect.scan.retry")
						})
					}),
					scanning && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoadingLine, { text: t("connect.upload.checking") }),
					dshScan.status === "unavailable" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorBanner, { error: {
						code: "scan-failed",
						message: t("connect.scan.failed", { message: dshScan.error ?? "" })
					} }),
					!scanning && probe === void 0 && dshScan.status !== "unavailable" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-rw-hint",
						children: t("connect.upload.unknown")
					}),
					probe !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-rw-hint",
							children: t("connect.upload.probe", { tag: probe.tag })
						}),
						pkg !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-rw-hint",
							children: t("connect.upload.artifact", { artifact: pkg.artifact })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-rw-hint",
							children: pkg?.cached === true ? t("connect.upload.cached", { size: formatSize(pkg.sizeBytes) }) : t("connect.upload.build")
						})
					] })
				]
			});
		}
		/**
		* Step 3 — the provisioned-through choice, the live progress, the connection log
		* and the host-key confirmation.
		*/
		function ConnectStep(props) {
			const { connect, config, dshScan } = props.state;
			const prompt = connect.hostKey;
			const logRef = (0, react.useRef)(null);
			const busy = connect.phase === "running" || connect.phase === "awaiting-hostkey";
			(0, react.useEffect)(() => {
				const node = logRef.current;
				if (node !== null) node.scrollTop = node.scrollHeight;
			}, [connect.log.length]);
			const reuseFailed = connect.phase === "failed" && config.connectionMode === "reuse";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-section",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: "dsh-rw-section-title",
						children: t("connect.mode.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-rw-hint",
						children: t("connect.mode.description")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-rw-methods",
						role: "radiogroup",
						"aria-label": t("connect.mode.title"),
						children: MODE_CARDS.map((card, index) => {
							const selected = config.connectionMode === card.id;
							const disabled = card.disabled === true || busy;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "dsh-rw-method",
								"data-disabled": disabled ? "true" : void 0,
								"data-selected": selected ? "true" : void 0,
								"data-mode": card.id,
								disabled,
								"aria-pressed": selected,
								...disabled ? {} : { "data-step-focus": index === 0 ? true : void 0 },
								onClick: () => {
									if (disabled) return;
									store.setConnectionMode(card.id);
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "dsh-rw-method-name",
										children: [t(MODE_NAME_KEYS[card.id]), selected && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
											tone: "info",
											children: t("connect.mode.selected")
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsh-rw-method-description",
										children: t(MODE_DESCRIPTION_KEYS[card.id])
									}),
									card.disabled === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsh-rw-method-state",
										children: t("connect.mode.download.disabled")
									})
								]
							}, card.id);
						})
					}),
					config.connectionMode === "reuse" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReusePanel, { state: props.state }),
					config.connectionMode === "upload" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UploadPanel, { state: props.state }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: "dsh-rw-section-title",
						children: t("connect.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-rw-hint",
						children: dshScan.status === "ready" && dshScan.probe !== void 0 ? t("connect.upload.probe", { tag: dshScan.probe.tag }) : t("connect.description")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-rw-progress",
						children: CONNECT_STEPS.map((step) => {
							const row = connect.steps[step] ?? { status: "pending" };
							const detail = row.message ?? row.detail;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-rw-progress-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-rw-progress-dot",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: dotState(row.status) })
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dsh-rw-progress-text",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "dsh-rw-progress-title",
										children: [t(CONNECT_STEP_LABELS[step]), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsh-rw-progress-status",
											children: t(CONNECT_STATUS_LABELS[row.status])
										})]
									}), detail !== void 0 && detail !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsh-rw-progress-message",
										children: detail
									})]
								})]
							}, step);
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-rw-log",
						"data-testid": "dsh-rw-log",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-rw-log-head",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("connect.log.title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-rw-log-count",
								children: String(connect.log.length)
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-rw-log-body",
							ref: logRef,
							children: [connect.log.map((line, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-rw-log-line",
								"data-level": line.level,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-rw-log-time",
									children: line.time
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-rw-log-text",
									children: line.text
								})]
							}, index)), connect.log.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsh-rw-log-line",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-rw-log-text",
									children: t("connect.description")
								})
							})]
						})]
					}),
					prompt !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HostKeyPanel, {
						fingerprint: prompt.fingerprint,
						algorithm: prompt.algorithm,
						answering: prompt.answering,
						confirmed: prompt.trusted,
						confirmLabel: t("connect.hostKey.trust"),
						answeringLabel: t("connect.hostKey.trusting"),
						confirmedLabel: t("connect.hostKey.trusted"),
						cancelLabel: t("connect.hostKey.cancel"),
						onConfirm: () => {
							store.confirmHostKey();
						},
						onCancel: () => {
							store.cancelConnect();
						}
					}),
					connect.phase === "failed" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-rw-hint",
						children: t("connect.retryHint")
					}),
					connect.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorBanner, { error: connect.error }),
					reuseFailed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-rw-inline",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							onClick: () => {
								store.setConnectionMode("upload");
								store.startConnect();
							},
							children: t("connect.reuse.switchUpload")
						})
					})
				]
			});
		}
		/** The wizard body: step pills, banners and the current step. */
		function WizardBody() {
			const state = useAppState();
			const bodyRef = (0, react.useRef)(null);
			const fingerprint = state.connect.hostKey?.fingerprint;
			const scanFingerprint = state.dshScan.fingerprint;
			(0, react.useEffect)(() => {
				(bodyRef.current?.querySelector("[data-step-focus]"))?.focus();
			}, [
				state.step,
				state.view,
				fingerprint,
				scanFingerprint
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-stack",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StepPills, { state }),
					state.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorBanner, {
						error: state.error,
						onDismiss: store.dismissError
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-rw-scroll",
						ref: bodyRef,
						children: [
							state.step === "method" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MethodStep, { state }),
							state.step === "config" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConfigStep, { state }),
							state.step === "connect" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConnectStep, { state })
						]
					})
				]
			});
		}
		/** Wizard actions, rendered inside the dialog footer. */
		function WizardFooter() {
			const state = useAppState();
			const { pending, connect, config } = state;
			const busy = connect.phase === "running" || connect.phase === "awaiting-hostkey";
			if (state.step === "method") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-footer-actions",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-rw-footer-group",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						onClick: store.closeOverlay,
						children: t("common.cancel")
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-rw-footer-group",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "primary",
						disabled: !methodAvailable(state.method, state.platform),
						onClick: () => {
							store.setStep("config");
						},
						children: t("step.label.config")
					})
				})]
			});
			if (state.step === "config") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-footer-actions",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-rw-footer-group",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronLeftOutlineRegular, { size: 12 }),
						onClick: () => {
							store.setStep("method");
						},
						children: t("common.back")
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsh-rw-footer-group",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						onClick: store.closeOverlay,
						children: t("common.cancel")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "primary",
						disabled: pending || state.prefilling,
						onClick: () => {
							store.setStep("connect");
						},
						children: t("step.label.connect")
					})]
				})]
			});
			const chosen = config.connectionMode === "reuse" ? config.reuseLauncherPath !== "" : config.connectionMode === "upload";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-footer-actions",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-rw-footer-group",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronLeftOutlineRegular, { size: 12 }),
						disabled: busy,
						onClick: () => {
							store.setStep("config");
						},
						children: t("common.back")
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsh-rw-footer-group",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						disabled: busy,
						onClick: () => {
							const phase = connect.phase;
							if (phase === "idle" || phase === "succeeded") store.closeOverlay();
							else store.cancelConnect();
						},
						children: t("common.cancel")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "primary",
						disabled: pending || busy || !chosen,
						onClick: () => {
							store.startConnect();
						},
						children: connect.phase === "failed" ? t("common.retry") : t("config.connect")
					})]
				})]
			});
		}
		//#endregion
		//#region src/client/panel.tsx
		/**
		* The 远程连接 main panel — the page the wizard and the connection list live in.
		*
		* It has no sidebar row of its own: the 「远程工作区」 section's `+新建连接`
		* control opens it with `layout.selectPanel(PANEL_ID)`, and the same id is the
		* `main` slot key the shell renders the page under. The page hosts the whole
		* flow inline: 新建连接 sits at the top-left, and the three-step wizard renders
		* in place instead of a dialog.
		*/
		/** The panel id in the layout's main registry (`main` slot key). */
		const PANEL_ID = "dsh-remote-workspace";
		/** Main-column page: actions at the top-left, list or wizard below. */
		function RemoteWorkspacePanel() {
			const state = useAppState();
			const wizard = state.view !== "list";
			(0, react.useEffect)(() => {
				if (!state.stateLoaded && !state.stateLoading) store.refreshState();
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-page",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-rw-page-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "primary",
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 12 }),
								onClick: store.newConnection,
								children: t("list.newConnection")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "ghost",
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 12 }),
								disabled: state.stateLoading,
								onClick: () => {
									store.refreshState();
								},
								children: t("common.refresh")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-rw-page-title",
								children: t("app.name")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-rw-page-body",
						children: wizard ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WizardBody, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ListBody, {})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoticeToastHost, {
						notice: state.notice,
						onDismiss: store.dismissNotice
					}),
					wizard && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-rw-page-foot",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WizardFooter, {})
					})
				]
			});
		}
		//#endregion
		//#region src/client/sidebar.tsx
		/** Attribute carrying our section element, for idempotent remounting. */
		const SIDEBAR_SECTION_ATTR = "data-dsh-remote-workspace-section";
		/** The shell's sidebar browsing seat. */
		const WORKSPACES_SLOT = "[data-slot=\"sidebar.workspaces\"]";
		/** The section chrome: title row + the tree. */
		function SidebarSection() {
			const state = useAppState();
			const busy = state.stateLoading || state.pending;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsh-rw-side",
				"aria-label": t("tree.sidebar.title"),
				"data-plugin": "dsh-remote-workspace",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "dsh-rw-side-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-rw-side-title",
							children: t("tree.sidebar.title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsh-rw-side-actions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "ghost",
								size: "sm",
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 12 }),
								"aria-label": t("common.refresh"),
								disabled: busy,
								onClick: () => {
									store.refreshState();
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "ghost",
								size: "sm",
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 12 }),
								"aria-label": t("list.newConnection"),
								onClick: () => {
									store.openConnectionWizard(PANEL_ID);
								}
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-rw-side-body",
						children: [state.stateLoading && !state.stateLoaded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-rw-tree-empty",
							children: t("list.loading")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RemoteTree, {
							compact: true,
							empty: t("tree.sidebar.empty")
						})]
					}),
					state.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-rw-side-error",
						children: state.error.message
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoticeToastHost, {
						notice: state.notice,
						onDismiss: store.dismissNotice
					})
				]
			});
		}
		/**
		* Mount the sidebar section into the browsing region, above 工作区.
		*
		* The mount is deliberately defensive, because two timings are not ours:
		* the shell may render its sidebar *after* this plugin activates (boot order),
		* and the sidebar may be re-rendered later (theme, collapse, HMR). So the
		* section attaches when the anchor first appears and re-attaches itself if the
		* shell ever drops or reorders our node.
		*
		* @returns a disposer that unmounts the React root and removes the node.
		*/
		function mountSidebarSection() {
			if (typeof document === "undefined") return void 0;
			let disposed = false;
			let container;
			let root;
			/** Insert our (existing or fresh) node as the region's first child. */
			const attach = () => {
				if (disposed) return;
				const anchor = document.querySelector(WORKSPACES_SLOT)?.parentElement;
				if (anchor === null || anchor === void 0) return;
				if (container === void 0) {
					container = document.createElement("div");
					container.setAttribute(SIDEBAR_SECTION_ATTR, "");
					container.className = "dsh-rw-side-host";
					root = (0, react_dom_client.createRoot)(container);
					root.render(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SidebarSection, {}));
				}
				if (container.parentElement !== anchor || anchor.firstElementChild !== container) anchor.insertBefore(container, anchor.firstElementChild);
			};
			attach();
			let observer;
			if (typeof MutationObserver !== "undefined") {
				observer = new MutationObserver(attach);
				observer.observe(document.documentElement, {
					childList: true,
					subtree: true
				});
			}
			return () => {
				disposed = true;
				observer?.disconnect();
				root?.unmount();
				container?.remove();
			};
		}
		//#endregion
		//#region src/client/styles.ts
		/** The complete stylesheet. */
		/**
		* Plugin-owned stylesheet.
		*
		* The repository's `tsdown.config.mjs` does not process CSS for this plugin
		* (no CSS modules, no `?inline` loader), so the browser half ships ONE CSS
		* string injected as a single `<style data-plugin="dsh-remote-workspace">`
		* element from `apply` — the simplest correct approach under that build, and
		* an effect so hot reload disposes the tag with the rest of the contribution.
		*
		* Colors/spacing come from the shell's `--dsw-*` tokens so the surface
		* follows the active theme.
		*/
		/** A plug/link glyph: the connection row's 连接 button (the mask uses its alpha). */
		const PLUG_MASK = `url("data:image/svg+xml;utf8,${encodeURIComponent("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#000\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M9 2v6\"/><path d=\"M15 2v6\"/><path d=\"M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6z\"/><path d=\"M12 17v5\"/></svg>")}")`;
		/** A minimal single-colour globe (the mask only uses its alpha). */
		const GLOBE_MASK = `url("data:image/svg+xml;utf8,${encodeURIComponent("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#000\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20\"/><path d=\"M2 12h20\"/></svg>")}")`;
		/** Marker attribute value for the injected `<style>` element. */
		const STYLE_PLUGIN_ID = "dsh-remote-workspace";
		const STYLE_TEXT = `
/* The official workspace rows bring their own stylesheet; it is injected with
   ours so both surfaces (sidebar section and panel) share one <style> tag. */
${ROW_STYLES}

/* ---------------------------------------------------------------- footer */

.dsh-rw-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.dsh-rw-page-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px 10px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dsh-rw-page-title {
  margin-left: auto;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-rw-page-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 12px;
}
.dsh-rw-page-foot {
  flex: none;
  padding: 10px 12px;
}
.dsh-rw-log {
  margin-top: 10px;
  border: 1px solid var(--dsw-alias-border, #e5e6eb);
  border-radius: var(--dsw-radius-md, 8px);
  overflow: hidden;
  background: var(--dsw-alias-bg-secondary, #f7f8fa);
}
.dsh-rw-log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  font-weight: 600;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  border-bottom: 1px solid var(--dsw-alias-border, #e5e6eb);
}
.dsh-rw-log-count {
  color: var(--dsw-alias-label-tertiary);
  font-weight: 400;
}
.dsh-rw-log-body {
  max-height: 220px;
  overflow-y: auto;
  padding: 8px 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
}
.dsh-rw-log-line {
  display: flex;
  gap: 8px;
  white-space: pre-wrap;
  word-break: break-all;
}
.dsh-rw-log-line[data-level='error'] .dsh-rw-log-text {
  color: #d93026;
}
.dsh-rw-log-line[data-level='ok'] .dsh-rw-log-text {
  color: #1a7f37;
}
.dsh-rw-log-time {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-rw-footer {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  width: 100%;
  height: 42px;
  margin: 8px 0 0;
}

.dsh-rw-footer[data-rail="true"] {
  width: 36px;
  height: 36px;
  margin: 0;
}

.dsh-rw-footer-button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 100%;
  padding: 0 10px;
  border: 0;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}

.dsh-rw-footer-button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dsh-rw-footer-button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-rw-footer[data-rail="true"] .dsh-rw-footer-button {
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 50%;
}

.dsh-rw-footer-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dsh-rw-footer-badge {
  margin-left: auto;
  flex: none;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

/* ------------------------------------------------------------- dialog box */

.dsh-rw-dialog {
  width: min(560px, 100%);
  max-height: 100%;
}

.dsh-rw-content {
  min-height: 0;
}

.dsh-rw-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}

.dsh-rw-scroll {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 54vh;
  overflow: auto;
  padding-right: 2px;
}

.dsh-rw-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.dsh-rw-step-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.dsh-rw-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dsh-rw-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-hint {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-empty {
  margin: 0;
  padding: 12px;
  border: 1px dashed var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary);
  text-align: center;
}

/* --------------------------------------------------------------- banners */

.dsh-rw-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  font-size: 13px;
  line-height: 19px;
  color: var(--dsw-alias-label-primary);
}

.dsh-rw-banner[data-kind="error"] {
  border-color: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
}

.dsh-rw-banner-text {
  flex: 1 1 auto;
  min-width: 0;
  word-break: break-word;
}

.dsh-rw-banner-code {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--dsw-alias-label-caption);
}

/* ---------------------------------------------------------- method cards */

.dsh-rw-methods {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}

.dsh-rw-method {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.dsh-rw-method:hover:not([data-disabled="true"]) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-rw-method[data-selected="true"] {
  border-color: var(--dsw-alias-state-business-primary);
}

.dsh-rw-method[data-disabled="true"] {
  cursor: not-allowed;
  opacity: 0.55;
}

.dsh-rw-method-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
}

.dsh-rw-method-description {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-method-state {
  font-size: 11px;
  color: var(--dsw-alias-label-caption);
}

/* --------------------------- step-3 scan panels (new cards, layout only)

   These are NOT the sidebar's rows: they are the two panels step 3 shows under
   its connection-method cards (the reuse candidate list and the upload summary).
   Every colour/spacing value comes from the shell's tokens, so the cards follow
   the active theme like the rest of the plugin. */

.dsh-rw-scan {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dsh-rw-candidates {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dsh-rw-candidate {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.dsh-rw-candidate:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-rw-candidate[data-selected="true"] {
  border-color: var(--dsw-alias-state-business-primary);
}

.dsh-rw-candidate:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.dsh-rw-candidate-main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.dsh-rw-candidate-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  word-break: break-all;
}

.dsh-rw-candidate-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-candidate-note {
  font-size: 11px;
  color: var(--dsw-alias-label-caption);
}

.dsh-rw-candidate-reason {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-state-error-primary);
}

.dsh-rw-candidate-action {
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}

/* ---------------------------------------------------------------- fields */

.dsh-rw-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dsh-rw-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}

.dsh-rw-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.dsh-rw-field-label {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}

.dsh-rw-field-hint {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-caption);
}

.dsh-rw-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.dsh-rw-grow {
  flex: 1 1 auto;
  min-width: 0;
}

/* The Input primitive wraps its <input> in a span; inside a flex row the
   wrapper grows, and the native field has to fill it. */
.dsh-rw-grow input {
  width: 100%;
  box-sizing: border-box;
}

.dsh-rw-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  word-break: break-all;
}

/* -------------------------------------------------------------- progress */

.dsh-rw-progress {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dsh-rw-progress-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
}

.dsh-rw-progress-row:last-child {
  border-bottom: 0;
}

.dsh-rw-progress-dot {
  flex: none;
  margin-top: 3px;
}

.dsh-rw-progress-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.dsh-rw-progress-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
}

.dsh-rw-progress-status {
  font-size: 11px;
  color: var(--dsw-alias-label-caption);
}

.dsh-rw-progress-message {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  word-break: break-word;
}

.dsh-rw-hostkey {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 0.5px solid var(--dsw-alias-state-warn-primary);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-rw-hostkey-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-state-warn-primary);
}

/* ------------------------------------------------------------- directory */

.dsh-rw-crumbs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-height: 28px;
}

.dsh-rw-crumb {
  padding: 2px 6px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.dsh-rw-crumb:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dsh-rw-crumb[aria-current="true"] {
  color: var(--dsw-alias-label-primary);
}

.dsh-rw-crumb-separator {
  color: var(--dsw-alias-label-caption);
  font-size: 12px;
}

.dsh-rw-entries {
  display: flex;
  flex-direction: column;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  overflow: hidden;
}

.dsh-rw-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.dsh-rw-entry:last-child {
  border-bottom: 0;
}

.dsh-rw-entry:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-rw-entry[data-type="file"],
.dsh-rw-entry[data-type="other"] {
  color: var(--dsw-alias-label-tertiary);
  cursor: default;
}

.dsh-rw-entry[data-type="file"]:hover,
.dsh-rw-entry[data-type="other"]:hover {
  background: transparent;
}

.dsh-rw-entry-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dsh-rw-entry-kind {
  margin-left: auto;
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-caption);
}

/* ------------------------------------------------------------- list view */

.dsh-rw-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dsh-rw-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-rw-row-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1 1 auto;
  min-width: 0;
}

/* Connection-state globe: the icon carries the state color (green
   connected / red failed / neutral otherwise) — tri-state at a glance. */
.dsh-rw-conn-icon {
  display: inline-flex;
  align-items: center;
  color: var(--dsw-alias-label-secondary, inherit);
}
.dsh-rw-conn-icon[data-state="ready"] {
  color: var(--dsw-alias-state-success-primary);
}
.dsh-rw-conn-icon[data-state="failed"] {
  color: var(--dsw-alias-state-error-primary);
}

.dsh-rw-row-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
}

.dsh-rw-row-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-row-error {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
  word-break: break-word;
}

/* The PathLabel primitive clips from the left; give it room inside the row. */
.dsh-rw-path {
  display: inline-block;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
}

.dsh-rw-row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.dsh-rw-footer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}

.dsh-rw-footer-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* --------------------------------------------------------- remote tree shell

   The ROWS are not styled here: they are the shell's own row components and
   stylesheet (src/client/vendor/workspace-rows, injected with STYLE_TEXT). This
   block only positions the three-level tree inside the region and tints the
   official folder icon on a connection row by its state. */

.dsh-rw-tree {
  display: flex;
  flex-direction: column;
}

/* One indent level per hierarchy step; the vendored row CSS reads this. */
.dsh-rw-conn > div,
.dsh-rw-tree > div > div {
  min-width: 0;
}

/* A connection is not a folder: the official row's leading slot paints a globe
   instead, through the same mask technique this plugin already uses on the
   shell's own rows. Everything else about the row stays official — including
   the hover swap, which hides this slot and shows the chevron. */
.dsh-rw-conn .dsh-rwv-rows-folder svg {
  display: none;
}
.dsh-rw-conn .dsh-rwv-rows-folder::before {
  content: '';
  width: 16px;
  height: 16px;
  flex: none;
  background-color: currentColor;
  -webkit-mask: ${GLOBE_MASK} center / contain no-repeat;
  mask: ${GLOBE_MASK} center / contain no-repeat;
}

/* A connection that is down shows exactly ONE control: its 连接 button.
   The official project row has two action seats (the menu trigger, then the
   plus) and fixed glyphs,
   so the state is expressed by which seats are shown and by an unmistakable
   glyph:
     - the menu trigger is hidden: a menu affordance sitting on a disconnected row
       reads as a menu left open;
     - the plus seat stays visible and paints a plug instead of the new-session
       glyph, so 连接 can never be mistaken for 添加工作区.
   Once connected the strip returns to the official pair, revealed on hover like
   every other row. */
.dsh-rw-conn:not([data-state="ready"]) .dsh-rwv-rows-rowActions {
  display: inline-flex;
}
.dsh-rw-conn:not([data-state="ready"]) .dsh-rwv-rows-rowActions > *:first-child {
  display: none;
}
.dsh-rw-conn:not([data-state="ready"]) .dsh-rwv-rows-rowActions > button:last-child svg {
  display: none;
}
.dsh-rw-conn:not([data-state="ready"]) .dsh-rwv-rows-rowActions > button:last-child::before {
  content: '';
  width: 16px;
  height: 16px;
  flex: none;
  background-color: currentColor;
  -webkit-mask: ${PLUG_MASK} center / contain no-repeat;
  mask: ${PLUG_MASK} center / contain no-repeat;
}

/* Connection state colours that globe: green connected / red failed /
   neutral otherwise. Only the glyph's colour is ours. */
.dsh-rw-conn[data-state="ready"] .dsh-rwv-rows-folder {
  color: var(--dsw-alias-state-success-primary);
}
.dsh-rw-conn[data-state="failed"] .dsh-rwv-rows-folder {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-rw-conn[data-state="unknown"] .dsh-rwv-rows-folder,
.dsh-rw-conn[data-state="stopped"] .dsh-rwv-rows-folder {
  color: var(--dsw-alias-label-tertiary);
}

/* The rename dialog's input, matching the shell's dialog input metrics. */
.dsh-rw-rename-input {
  box-sizing: border-box;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-family: inherit;
}
.dsh-rw-rename-input:focus {
  outline: none;
  border-color: var(--dsw-alias-border-l1, var(--dsw-alias-border-l2));
}

/* A11y wrapper around one vendored row: no box, but a real tree item. */
.dsh-rw-row-a11y { display: contents }
.dsh-rw-row-a11y:focus-visible { outline: 2px solid var(--dsh-color-accent, #3b82f6); outline-offset: -2px; border-radius: 6px }
.dsh-rw-tree-empty {
  margin: 4px 8px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

/* ----------------------------------------------------- add-workspace list */

.dsh-rw-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 120px;
  max-height: 52vh;
  overflow: auto;
}

.dsh-rw-picker-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dsh-rw-picker-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-rw-picker-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
}

.dsh-rw-picker-title {
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
}

/* ------------------------------------------- sidebar section (远程工作区) */

/* Mounted as the first child of the sidebar's browsing region, directly above
   the shell's own 工作区 section. flex:none keeps this section at its natural
   height while the official list takes the rest of the column. */
.dsh-rw-side-host {
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 46vh;
}

.dsh-rw-side {
  display: flex;
  flex-direction: column;
  gap: 2px;
  /* No horizontal padding: each row owns its own inset (the official row CSS is
     padding-inline-start: calc(8px + var(--dsh-workspace-indent))), so the
     connection level lands flush with the section title instead of one step in. */
  padding: 4px 0 6px;
  /* The whole chain must be height-bounded, or the tree simply overflows the
     host box and the rows below get covered by the shell's 工作区 section
     (measured: host bottom 770px, tree content down to 1141px, the covered
     rows hit-tested onto the shell's rows). */
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

/* Mirrors the shell's own section header metrics so the two sections read as
   peers: same row height, same label weight, same secondary tone. */
.dsh-rw-side-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  /* Matches the rows' own inset, so the title lines up with the connection glyph. */
  padding: 0 8px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-rw-side-title {
  flex: 1 1 auto;
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-rw-side-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0.6;
  transition: opacity 120ms ease;
}
.dsh-rw-side:hover .dsh-rw-side-actions,
.dsh-rw-side:focus-within .dsh-rw-side-actions {
  opacity: 1;
}

/* While the column is collapsed the shell leaves our node in the DOM (its own
   panel unmounts instead) and only fades the region to opacity 0 — which keeps
   every control in the accessibility tree and hit-testable, so the section
   hides itself explicitly. The attribute is on the frame element, an ancestor
   of the region. */
[data-sidebar-collapsed="true"] .dsh-rw-side-host {
  visibility: hidden;
}

/* The section scrolls on its own: the official session list keeps its own
   scroller and must not be pushed out of the column by a long remote list. */
.dsh-rw-side-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.dsh-rw-side-error {
  margin: 2px 8px 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
  word-break: break-word;
}

`;
		/**
		* Inject the stylesheet once per document.
		* @returns a disposer removing exactly the injected tag.
		*/
		function ensureStyles() {
			if (typeof document === "undefined") return () => {};
			if (document.querySelector(`style[data-plugin="dsh-remote-workspace"]`) !== null) return () => {};
			const tag = document.createElement("style");
			tag.dataset.plugin = STYLE_PLUGIN_ID;
			tag.textContent = STYLE_TEXT;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}
		/**
		* Marker for the shell workspace-tree rows this plugin owns. The official
		* `ui-workspace` Rows component hard-codes a folder icon per row and keys the
		* row DOM with `data-row-key="workspace:<officialWorkspaceId>"` (its CSS
		* module classes are hashed, but that attribute and the icon-first child
		* order are stable), so the swap is done per-row from the client.
		*/
		const ICONS_STYLE_ID = "dsh-remote-workspace-icons";
		/**
		* Keep the shell's own 工作区 section free of this plugin's rows.
		*
		* The shell renders an official workspace row for a remote workspace's *stub*
		* directory, and — once a remote session is open — a session row for it as a
		* **sibling inside the same group section**, not as a child of that row:
		*
		*   div._7514NG_groupSection
		*     ├ span > div[data-row-key="workspace:61151f20-…"]   ← the stub workspace
		*     └ span > div[data-row-key="session:session-568dcb0f-…"]  ← the open session
		*
		* So hiding the workspace row alone (the earlier rule) left the session row
		* visible, and the remote session appeared as a top-level entry of 工作区 — the
		* regression this replaces. Two rules now cover both shapes:
		*
		*  - the whole group section that holds a remote stub workspace hides every
		*    session row inside it, so sessions we have not listed yet are covered too;
		*  - plus one rule per known remote session id, for a session the shell renders
		*    outside any group (its 未分组 bucket).
		*
		* Everything else about those rows stays official: they keep their ids, their
		* wiring and their behaviour; only their box is hidden, because this plugin's
		* own section is where a remote workspace and its sessions belong.
		*
		* @param workspaceIds - official shell-workspace ids of this plugin's stubs.
		* @param sessionIds - stored remote session ids this plugin knows about.
		* @returns a disposer removing the injected tag.
		*/
		function syncShellHiding(workspaceIds, sessionIds) {
			if (typeof document === "undefined") return () => {};
			let tag = document.querySelector(`style[data-plugin="${ICONS_STYLE_ID}"]`);
			if (tag === null) {
				tag = document.createElement("style");
				tag.dataset.plugin = ICONS_STYLE_ID;
				document.head.appendChild(tag);
			}
			const groups = workspaceIds.map((id) => `
[data-slot="sidebar.workspaces"] div[data-row-key="workspace:${id}"] {
  display: none;
}
[data-slot="sidebar.workspaces"] div:has(> span > div[data-row-key="workspace:${id}"]) [data-row-key^="session:"] {
  display: none;
}`).join("\n");
			const sessions = sessionIds.map((id) => `
[data-slot="sidebar.workspaces"] div[data-row-key="session:${id}"] {
  display: none;
}`).join("\n");
			tag.textContent = groups + sessions;
			return () => {
				tag.remove();
			};
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* Client services this plugin needs: `slots` only. Localization is the
		* plugin's own dictionary (`./locales.ts`), so no locale service is required.
		*/
		const inject = ["slots"];
		/**
		* Plugin body: inject the stylesheet, own the store's side-effect lifetime and
		* register the two slot contributions.
		* @param ctx - the client context.
		*/
		function apply(ctx) {
			bindClientContext(ctx);
			bindVerbContext(ctx);
			ctx.effect(() => ensureStyles(), "dsh-remote-workspace: stylesheet");
			ctx.effect(() => watchShellRows(syncShellHiding), "dsh-remote-workspace: shell row hiding");
			ctx.effect(() => mountSidebarSection(), "dsh-remote-workspace: sidebar section");
			store.refreshState();
			ctx.effect(() => () => {
				dispose();
			}, "dsh-remote-workspace: store lifetime");
			try {
				ctx.slots.inject("main", () => ctx.slots.register({
					name: "main",
					key: PANEL_ID,
					label: () => t("app.name")
				}, RemoteWorkspacePanel));
			} catch (error) {
				console.error("[dsh-remote-workspace] main panel registration failed", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map