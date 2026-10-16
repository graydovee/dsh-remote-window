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
		const zh = {
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
			"button.label": "远程连接",
			"button.tooltip": "连接远程主机并把远端目录作为工作区打开",
			"button.badge.aria": "{count} 个已保存的远程项",
			"step.label.method": "选择方式",
			"step.label.config": "填写配置",
			"step.label.connecting": "连接中",
			"step.label.directory": "选择目录",
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
			"list.status.unknown": "未连接",
			"list.status.ready": "已连接",
			"list.status.failed": "连接失败",
			"list.status.stopped": "已停止",
			"list.openDirectory": "打开目录",
			"list.addWorkspace": "添加工作区",
			"list.reconnect": "重新连接",
			"list.open": "打开",
			"list.stop": "停止",
			"list.forget": "忘记",
			"list.lastError": "上次错误：{message}",
			"list.lastConnectedAt": "上次连接：{time}",
			"list.workspacePath": "路径",
			"list.workspaceCreatedAt": "创建于 {time}",
			"list.workspaceTarget": "主机：{label}",
			"list.missingTarget": "（主机已删除）",
			"list.forgotTarget": "已忘记主机「{label}」",
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
			"tree.workspace.forget": "移除",
			"tree.workspace.sessions": "{count} 个会话",
			"tree.sessions.loading": "正在读取远端会话…",
			"tree.sessions.empty": "远端还没有会话",
			"tree.sessions.failed": "读取远端会话失败：{message}",
			"tree.session.continue": "继续",
			"tree.session.opened": "已继续会话 {id}",
			"tree.session.fallback": "无法继续上次会话（{message}），已新建会话",
			"tree.session.createdAt": "{time}",
			"tree.session.size": "{size}",
			"tree.addWorkspace.title": "添加工作区",
			"tree.addWorkspace.description": "「{label}」上 dsh 已注册的工作区；添加后会新建一个会话。",
			"tree.addWorkspace.loading": "正在读取远端工作区…",
			"tree.addWorkspace.empty": "远端 dsh 还没有注册任何工作区，可以浏览目录后打开一个。",
			"tree.addWorkspace.failed": "读取远端工作区失败：{message}",
			"tree.addWorkspace.add": "添加",
			"tree.addWorkspace.added": "已添加",
			"tree.addWorkspace.sessions": "{count} 个会话",
			"tree.addWorkspace.browse": "浏览远端目录…",
			"tree.addWorkspace.close": "关闭",
			"method.title": "选择连接方式",
			"method.description": "远端只运行执行世界，模型请求与凭据始终留在本机。",
			"method.ssh.name": "SSH",
			"method.ssh.description": "通过 SSH 连接主机，在远端运行执行世界服务。",
			"method.docker.name": "Docker",
			"method.docker.description": "连接容器内的执行世界。",
			"method.wsl.name": "WSL",
			"method.wsl.description": "连接 Windows 子系统中的 Linux。",
			"method.disabledNote": "稍后支持",
			"method.select": "选择",
			"method.selected": "已选择",
			"method.ssh.aria": "使用 SSH 连接",
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
			"config.packageSource": "服务端包来源",
			"config.packageSource.label": "服务端包来源",
			"config.packageSource.hint": "自动：本地缓存 → Release 下载 → 本机构建；选择会记住到该目标。",
			"config.packageSource.auto": "自动",
			"config.packageSource.download": "Release 下载",
			"config.packageSource.upload": "本机构建",
			"connect.title": "正在连接",
			"connect.description": "正在远端准备执行世界，请勿关闭。",
			"connect.step.connect": "连接主机",
			"connect.step.probe": "探测远端环境",
			"connect.step.runtime": "部署运行时(Node)",
			"connect.step.upload": "部署 dsh 与服务端",
			"connect.step.start": "建立执行通道",
			"connect.status.pending": "等待中",
			"connect.status.running": "进行中",
			"connect.status.ok": "完成",
			"connect.status.failed": "失败",
			"connect.succeeded": "连接成功，正在读取远端目录…",
			"connect.log.title": "连接日志",
			"connect.log.hostKey": "远端主机指纹 {fingerprint}，等待确认",
			"connect.log.done": "目标「{label}」连接成功",
			"connect.log.directoryConnect": "主机「{label}」未连接，正在建立通道…",
			"connect.log.directoryProbe": "正在检查远端运行环境…",
			"connect.log.directoryStart": "正在启动远端执行服务…",
			"connect.log.directoryReady": "通道就绪，正在读取目录…",
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
			zh,
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
				"button.label": "Remote connection",
				"button.tooltip": "Connect to a remote host and open a directory there as a workspace",
				"button.badge.aria": "{count} saved remote item(s)",
				"step.label.method": "Method",
				"step.label.config": "Configure",
				"step.label.connecting": "Connecting",
				"step.label.directory": "Directory",
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
				"list.status.unknown": "Not connected",
				"list.status.ready": "Connected",
				"list.status.failed": "Failed",
				"list.status.stopped": "Stopped",
				"list.openDirectory": "Open directory",
				"list.addWorkspace": "Add workspace",
				"list.reconnect": "Reconnect",
				"list.open": "Open",
				"list.stop": "Stop",
				"list.forget": "Forget",
				"list.lastError": "Last error: {message}",
				"list.lastConnectedAt": "Last connected: {time}",
				"list.workspacePath": "Path",
				"list.workspaceCreatedAt": "Created {time}",
				"list.workspaceTarget": "Host: {label}",
				"list.missingTarget": "(host removed)",
				"list.forgotTarget": "Forgot host \"{label}\"",
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
				"tree.workspace.forget": "Remove",
				"tree.workspace.sessions": "{count} session(s)",
				"tree.sessions.loading": "Reading remote sessions…",
				"tree.sessions.empty": "No session on the remote yet",
				"tree.sessions.failed": "Reading remote sessions failed: {message}",
				"tree.session.continue": "Continue",
				"tree.session.opened": "Continued session {id}",
				"tree.session.fallback": "Could not continue the last session ({message}); started a new one",
				"tree.session.createdAt": "{time}",
				"tree.session.size": "{size}",
				"tree.addWorkspace.title": "Add workspace",
				"tree.addWorkspace.description": "Workspaces dsh has registered on \"{label}\"; adding one creates a fresh session.",
				"tree.addWorkspace.loading": "Reading remote workspaces…",
				"tree.addWorkspace.empty": "The remote dsh has no registered workspace yet — browse a directory and open it instead.",
				"tree.addWorkspace.failed": "Reading remote workspaces failed: {message}",
				"tree.addWorkspace.add": "Add",
				"tree.addWorkspace.added": "Added",
				"tree.addWorkspace.sessions": "{count} session(s)",
				"tree.addWorkspace.browse": "Browse remote directory…",
				"tree.addWorkspace.close": "Close",
				"method.title": "Choose a connection method",
				"method.description": "Only the execution world is remote; model calls and credentials stay local.",
				"method.ssh.name": "SSH",
				"method.ssh.description": "Connect over SSH and run the execution-world service on the host.",
				"method.docker.name": "Docker",
				"method.docker.description": "Connect to an execution world inside a container.",
				"method.wsl.name": "WSL",
				"method.wsl.description": "Connect to Linux inside the Windows subsystem.",
				"method.disabledNote": "Coming later",
				"method.select": "Select",
				"method.selected": "Selected",
				"method.ssh.aria": "Connect over SSH",
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
				"config.packageSource": "Server package source",
				"config.packageSource.label": "Server package source",
				"config.packageSource.hint": "Auto: local cache → release download → build locally; the choice is remembered per target.",
				"config.packageSource.auto": "Auto",
				"config.packageSource.download": "Release download",
				"config.packageSource.upload": "Build locally",
				"connect.title": "Connecting",
				"connect.description": "Preparing the remote execution world — keep this open.",
				"connect.step.connect": "Connect to the host",
				"connect.step.probe": "Probe the remote host",
				"connect.step.runtime": "Deploy the runtime (Node)",
				"connect.step.upload": "Deploy dsh and the server",
				"connect.step.start": "Open the execution channel",
				"connect.status.pending": "Pending",
				"connect.status.running": "Running",
				"connect.status.ok": "Done",
				"connect.status.failed": "Failed",
				"connect.succeeded": "Connected — reading the remote directory…",
				"connect.log.title": "Connection log",
				"connect.log.hostKey": "Remote host key {fingerprint} — awaiting confirmation",
				"connect.log.done": "Target \"{label}\" connected",
				"connect.log.directoryConnect": "Host \"{label}\" is not connected — establishing the channel…",
				"connect.log.directoryProbe": "Checking the remote runtime…",
				"connect.log.directoryStart": "Starting the remote execution service…",
				"connect.log.directoryReady": "Channel ready — reading the directory…",
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
		/**
		* Translate one dictionary key, interpolating `{name}` parameters.
		* @param key - dictionary key.
		* @param params - `{name}` values; an unknown name keeps its placeholder.
		* @returns the localized string (never empty: falls back to `zh`, then the key).
		*/
		function t(key, params) {
			const template = dictionaries[activeLocale][key] ?? zh[key] ?? key;
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
			/** Drop one saved target (and everything derived from it). */
			forgetTarget(targetId) {
				return call("forget-target", { targetId });
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
				origin: "wizard",
				steps: emptySteps(),
				log: []
			};
		}
		function emptyDirectory() {
			return {
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
				nodePath: "",
				dshCommand: "",
				profile: "",
				dshHome: "",
				packageSource: ""
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
			if (current.view !== "wizard" || current.step !== "connecting") return false;
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
		function validateDraft(draft) {
			if (draft.label.trim() === "") return validation("config.alias.required");
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
		/** Localized time text for a saved row, or undefined when absent/unparseable. */
		function formatTimestamp(value) {
			if (value === void 0 || value === "") return void 0;
			const parsed = new Date(value);
			return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
		}
		/** The client context, bound in `apply`, for shell-owned services. */
		let clientContext;
		/** Capture the client context for {@link revealSession}. */
		function bindClientContext(ctx) {
			clientContext = ctx;
		}
		/**
		* Ask the shell to bring a just-opened session to the front. The shell owns
		* session navigation: `uiWorkspace.openSession` is how its own UI switches
		* conversations; without this the workspace opens silently and the user stays
		* on the plugin panel with only a toast.
		*/
		function revealSession(sessionId) {
			try {
				const workspace = clientContext?.get("uiWorkspace");
				if (workspace !== void 0 && typeof workspace.openSession === "function") workspace.openSession(sessionId);
			} catch (error) {
				console.error("[dsh-remote-workspace] revealSession failed", error);
			}
		}
		/** Read saved targets/workspaces (and auto-enter the wizard on a first run). */
		async function refreshState() {
			const gen = generation;
			const firstLoad = !state.stateLoaded;
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
					stateLoaded: true,
					stateLoading: false
				});
				if (firstLoad && state.open && state.view === "list" && !hasSaved) commit({
					view: "wizard",
					step: "method"
				});
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
				addWorkspace: void 0
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
				(clientContext?.get("layout"))?.selectPanel?.(panelId);
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
				connect: idleConnect(),
				directory: emptyDirectory()
			});
		}
		/** Switch the wizard to a step, loading that step's data. */
		function setStep(step) {
			if (step === "connecting" && state.connect.phase !== "running" && state.connect.phase !== "awaiting-hostkey") return;
			commit({
				step,
				error: void 0
			});
			if (step === "config") loadAliases();
		}
		/** Return to the saved-items list from any wizard step. */
		function showList() {
			generation += 1;
			stopStream();
			commit({
				view: "list",
				step: "method",
				error: void 0,
				notice: void 0,
				prefilling: false,
				pending: false
			});
			refreshState();
		}
		function setMethod(method) {
			if (method !== "ssh") return;
			commit({ method });
		}
		function patchConfig(patch) {
			setPendingSecret(void 0);
			const clearsAlias = patch.host !== void 0 || patch.port !== void 0 || patch.username !== void 0;
			commit((previous) => {
				const config = {
					...previous.config,
					...patch
				};
				if (clearsAlias) delete config.sshConfigAlias;
				return { config };
			});
		}
		function dismissError() {
			commit({ error: void 0 });
		}
		function dismissNotice() {
			commit({ notice: void 0 });
		}
		/**
		* Observe the saved remote workspaces for the lifetime of the plugin fiber
		* (not the panel — the icon rules target sidebar rows that must survive
		* panel switches). Fires immediately and on every workspaces change.
		*/
		function watchWorkspaces(apply) {
			const run = () => {
				apply(state.workspaces.map((workspace) => workspace.officialWorkspaceId ?? "").filter((id) => id !== ""));
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
		/** Prefill host/port/user/key from one `~/.ssh/config` alias. */
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
				const identityFile = value.identityFile !== void 0 && value.identityFile !== "" ? value.identityFile : void 0;
				commit((previous) => ({
					prefilling: false,
					config: {
						...previous.config,
						sshConfigAlias: value.alias,
						host: value.host,
						port: String(value.port),
						username: value.username !== void 0 && value.username !== "" ? value.username : previous.config.username,
						privateKeyPath: identityFile ?? previous.config.privateKeyPath,
						authKind: identityFile === void 0 ? previous.config.authKind : "privateKey",
						label: previous.config.label.trim() === "" ? value.alias : previous.config.label,
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
		/** Start (or retry) the connection attempt behind `/api/connect/start`. */
		async function startConnect() {
			commit((previous) => ({ connect: {
				...previous.connect,
				origin: "wizard"
			} }));
			const draft = state.config;
			const invalid = validateDraft(draft);
			if (invalid !== void 0) {
				commit({
					view: "wizard",
					step: "config",
					error: invalid
				});
				return;
			}
			const resolved = resolveSecret(draft);
			if (!resolved.ok) {
				commit({
					view: "wizard",
					step: "config",
					error: resolved.error
				});
				return;
			}
			const host = draft.host.trim();
			const port = Number(draft.port.trim());
			const username = draft.username.trim();
			const request = {
				label: draft.label.trim(),
				host,
				port,
				username,
				authKind: draft.authKind
			};
			if (resolved.secret !== void 0) request.secret = resolved.secret;
			if (draft.authKind === "privateKey") request.privateKeyPath = draft.privateKeyPath.trim();
			if (draft.sshConfigAlias !== void 0 && draft.sshConfigAlias !== "") request.sshConfigAlias = draft.sshConfigAlias;
			const trusted = state.trusted;
			if (trusted !== void 0 && trusted.host === host && trusted.port === port && trusted.username === username) request.hostKeyFingerprint = trusted.fingerprint;
			const remote = buildRemote(draft);
			if (remote !== void 0) request.remote = remote;
			if (draft.packageSource === "download" || draft.packageSource === "upload") request.packageSource = draft.packageSource;
			setPendingSecret(resolved.secret);
			const gen = generation;
			commit((previous) => ({
				pending: true,
				view: "wizard",
				step: "connecting",
				error: void 0,
				notice: void 0,
				connect: {
					...idleConnect(),
					phase: "running",
					log: [{
						time: (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", { hour12: false }),
						level: "info",
						text: `connecting to ${host}:${port} as ${username}`
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
						step: "directory",
						notice: {
							kind: "success",
							text: t("connect.succeeded")
						},
						connect: {
							...previous.connect,
							phase: "succeeded",
							hostKey: void 0,
							target,
							error: void 0
						},
						directory: {
							...emptyDirectory(),
							targetId: target.id
						},
						trusted: trusted ?? previous.trusted
					}));
					loadDirectory(target.id, "");
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
		/** Abandon a pending host-key prompt and return to the configuration step. */
		function cancelConnect() {
			stopStream();
			if (state.connect.origin === "directory") {
				showList();
				return;
			}
			commit({
				step: "config",
				error: void 0,
				notice: void 0,
				connect: idleConnect(),
				directory: emptyDirectory()
			});
		}
		/** Retry a directory-open reconnect from the 连接中 step. */
		function retryDirectoryConnect() {
			const targetId = state.directory.targetId;
			if (targetId === void 0) return;
			commit((previous) => ({
				error: void 0,
				connect: {
					...previous.connect,
					phase: "running",
					origin: "directory",
					steps: {
						...emptySteps(),
						connect: { status: "running" }
					}
				}
			}));
			loadDirectory(targetId, "", { promoteFromConnecting: true });
		}
		/** Browse one remote directory of the connected (or saved) target. */
		async function loadDirectory(targetId, path, options) {
			const promote = options?.promoteFromConnecting === true;
			const logLine = (text) => {
				commit((previous) => ({ connect: {
					...previous.connect,
					log: [...previous.connect.log, {
						time: (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", { hour12: false }),
						level: "info",
						text
					}]
				} }));
			};
			const hints = promote ? [setTimeout(() => {
				logLine(t("connect.log.directoryProbe"));
			}, 1500), setTimeout(() => {
				logLine(t("connect.log.directoryStart"));
			}, 4e3)] : [];
			return await withConnecting(async () => {
				const gen = generation;
				commit((previous) => ({ directory: {
					...previous.directory,
					targetId,
					loading: true,
					error: void 0
				} }));
				try {
					const listing = await api.listDir(targetId, path);
					if (gen !== generation) return;
					for (const hint of hints) clearTimeout(hint);
					if (promote) {
						logLine(t("connect.log.directoryReady"));
						await new Promise((resolve) => setTimeout(resolve, 120));
						if (gen !== generation) return;
					}
					commit((previous) => ({
						...promote ? {
							step: "directory",
							connect: {
								...previous.connect,
								phase: "succeeded"
							}
						} : {},
						directory: {
							...previous.directory,
							listing,
							loading: false,
							connecting: false,
							error: void 0,
							pathInput: listing.path,
							newDirName: "",
							title: previous.directory.titleTouched && previous.directory.title !== "" ? previous.directory.title : basename(listing.path)
						}
					}));
				} catch (error) {
					if (gen !== generation) return;
					for (const hint of hints) clearTimeout(hint);
					commit((previous) => ({
						...promote ? {
							step: "directory",
							connect: {
								...previous.connect,
								phase: "failed"
							}
						} : {},
						directory: {
							...previous.directory,
							loading: false,
							connecting: false,
							error: toWireError(error)
						}
					}));
				}
			});
		}
		/** Enter the directory browser for a saved target (from the list view). */
		function openTargetDirectory(target) {
			generation += 1;
			const needsConnect = target.status !== "ready";
			const now = (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", { hour12: false });
			commit({
				view: "wizard",
				step: needsConnect ? "connecting" : "directory",
				error: void 0,
				notice: void 0,
				directory: {
					...emptyDirectory(),
					targetId: target.id
				},
				connect: needsConnect ? {
					phase: "running",
					origin: "directory",
					steps: {
						...emptySteps(),
						connect: { status: "running" }
					},
					log: [{
						time: now,
						level: "info",
						text: t("connect.log.directoryConnect", { label: target.label })
					}]
				} : idleConnect()
			});
			loadDirectory(target.id, "", { promoteFromConnecting: needsConnect });
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
		/** Open the browsed directory as a workspace; the wizard closes on success. */
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
					commit({
						pending: false,
						view: "list",
						step: "method",
						directory: emptyDirectory(),
						connect: idleConnect(),
						notice: {
							kind: "success",
							text: t("directory.opened", { title: result.workspace.title })
						}
					});
					revealSession(result.sessionId);
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
		async function forgetTarget(target) {
			if (state.pending) return;
			const gen = generation;
			commit({
				pending: true,
				error: void 0
			});
			try {
				await api.forgetTarget(target.id);
				if (gen !== generation) return;
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
				if (stopped && state.directory.targetId === target.id) commit({
					directory: emptyDirectory(),
					view: "list",
					step: "method"
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
					revealSession(result.sessionId);
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
		* Continue one stored remote session (换设备续聊).
		*
		* The host resumes it through the official agent-resume path, so the history
		* comes back from the remote log; the shell then adopts the live session like
		* any local one.
		*/
		async function continueSession(workspace, session) {
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
						notice: {
							kind: "success",
							text: t("tree.session.opened", { id: shortSessionId(session.id) })
						}
					});
					revealSession(result.sessionId);
					await refreshState();
					refreshSessionsFor(workspace);
				} catch (error) {
					if (gen !== generation) return;
					commit({
						pending: false,
						error: toWireError(error)
					});
				}
			});
		}
		/** Short, human-scannable form of a session id. */
		function shortSessionId(id) {
			const trimmed = id.startsWith("session-") ? id.slice(8) : id;
			return trimmed.length <= 8 ? trimmed : trimmed.slice(0, 8);
		}
		/** Open the 添加工作区 picker for one connected host. */
		async function openAddWorkspace(target) {
			commit({
				addWorkspace: {
					targetId: target.id,
					targetLabel: target.label,
					loading: true,
					items: []
				},
				error: void 0
			});
			await refreshAddWorkspace();
		}
		function closeAddWorkspace() {
			commit({ addWorkspace: void 0 });
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
					commit({
						pending: false,
						addWorkspace: void 0,
						notice: {
							kind: "success",
							text: t("directory.opened", { title: result.workspace.title })
						}
					});
					revealSession(result.sessionId);
					await refreshState();
					commit((previous) => ({ expanded: {
						...previous.expanded,
						[targetNodeKey(dialog.targetId)]: true
					} }));
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
		* narrower than 打开目录, which walks the whole provisioning wizard.
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
						notice: {
							kind: "success",
							text: t("tree.session.opened", { id: shortSessionId(result.sessionId) })
						}
					});
					revealSession(result.sessionId);
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
		/** Table of the store's actions, as the components consume them. */
		const store = {
			closeOverlay,
			newConnection,
			openConnectionWizard,
			showList,
			setStep,
			setMethod,
			patchConfig,
			dismissError,
			dismissNotice,
			loadAliases,
			chooseAlias,
			startConnect,
			confirmHostKey,
			cancelConnect,
			loadDirectory,
			openTargetDirectory,
			setNewDirName,
			setDirectoryTitle,
			setPathInput,
			createDirectory,
			openWorkspace,
			retryDirectoryConnect,
			forgetTarget,
			forgetWorkspace,
			stopTarget,
			reopenWorkspace,
			openWorkspaceRecord,
			refreshState,
			isConnectBlocking: () => isConnectBlocking(state),
			toggleNode,
			loadSessions,
			continueSession,
			openAddWorkspace,
			closeAddWorkspace,
			refreshAddWorkspace,
			adoptRemoteWorkspace,
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
		//#region src/client/tree.tsx
		/** Tag palette per target status. */
		const STATUS_TONES = {
			unknown: "neutral",
			ready: "success",
			stopped: "neutral",
			failed: "danger"
		};
		/**
		* The connection's tri-state indicator.
		*
		* `ready` is the only state that proves a live channel: the host computes it
		* from the channel map, so a stale persisted "ready" cannot show green.
		*/
		function connectionState(status) {
			if (status === "ready") return "done";
			if (status === "failed") return "error";
			return "idle";
		}
		/** Connection state wording (never the stored status word alone). */
		function connectionLabel(status) {
			if (status === "ready") return t("tree.conn.connected");
			if (status === "failed") return t("tree.conn.failed");
			return t("tree.conn.disconnected");
		}
		/** One expand/collapse twisty. */
		function Twisty(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "dsh-rw-twisty",
				"aria-expanded": props.open,
				"aria-label": props.label,
				onClick: props.onToggle,
				children: props.open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 12 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { size: 12 })
			});
		}
		/** One stored remote session row. */
		function SessionRow(props) {
			const { session } = props;
			const created = session.createdAt === void 0 ? void 0 : formatTimestamp(new Date(session.createdAt).toISOString());
			const isCurrent = props.workspace.sessionId === session.id;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: "dsh-rw-tree-session",
				"data-current": isCurrent ? "true" : "false",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-rw-tree-gutter" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-rw-tree-icon",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDeliverDocRegular, { size: 13 })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-rw-tree-label dsh-rw-mono",
						title: session.id,
						children: shortSessionId(session.id)
					}),
					!props.compact && created !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-rw-tree-meta",
						children: t("tree.session.createdAt", { time: created })
					}),
					isCurrent && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
						tone: "info",
						children: t("tree.workspace.open")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-rw-tree-actions",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "ghost",
							size: "sm",
							disabled: props.pending,
							onClick: () => {
								store.continueSession(props.workspace, session);
							},
							children: t("tree.session.continue")
						})
					})
				]
			});
		}
		/** One workspace node with its (lazy) session children. */
		function WorkspaceNode(props) {
			const state = useAppState();
			const { workspace } = props;
			const key = workspaceNodeKey(workspace.id);
			const open = state.expanded[key] ?? false;
			const sessions = state.sessions[workspace.id];
			const connected = props.target.status === "ready";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: "dsh-rw-tree-workspace",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-rw-tree-row",
					"data-open": open ? "true" : "false",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Twisty, {
							open,
							label: open ? t("tree.collapse") : t("tree.expand"),
							onToggle: () => {
								store.toggleNode(key);
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-rw-tree-icon",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWorkspaceTreeOutlineRegular, { size: 13 })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-rw-tree-label",
							children: workspace.title
						}),
						!props.compact && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.PathLabel, {
							path: workspace.path,
							className: "dsh-rw-tree-path"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsh-rw-tree-actions",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									size: "sm",
									disabled: !connected || props.pending,
									onClick: () => {
										store.openWorkspaceRecord(workspace);
									},
									children: t("tree.workspace.open")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "ghost",
									size: "sm",
									disabled: !connected || props.pending,
									onClick: () => {
										store.reopenWorkspace(workspace);
									},
									children: t("tree.workspace.newSession")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "ghost",
									size: "sm",
									disabled: props.pending,
									onClick: () => {
										store.forgetWorkspace(workspace);
									},
									children: props.compact ? t("tree.workspace.forget") : t("tree.workspace.forget")
								})
							]
						})
					]
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
					className: "dsh-rw-tree-children",
					children: [sessions === void 0 || sessions.loading && sessions.items.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
						className: "dsh-rw-tree-note",
						children: t("tree.sessions.loading")
					}) : sessions.error !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
						className: "dsh-rw-tree-note dsh-rw-tree-note-error",
						children: t("tree.sessions.failed", { message: sessions.error.message })
					}) : sessions.items.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
						className: "dsh-rw-tree-note",
						children: t("tree.sessions.empty")
					}) : sessions.items.map((session) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionRow, {
						workspace,
						session,
						compact: props.compact,
						pending: props.pending
					}, session.id)), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
						className: "dsh-rw-tree-note",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "ghost",
							size: "sm",
							disabled: !connected || props.pending,
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 12 }),
							onClick: () => {
								store.reopenWorkspace(workspace);
							},
							children: t("tree.workspace.newSession")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "ghost",
							size: "sm",
							disabled: sessions?.loading ?? false,
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 12 }),
							"aria-label": t("common.refresh"),
							onClick: () => {
								store.loadSessions(workspace, true);
							},
							children: props.compact ? "" : t("common.refresh")
						})]
					})]
				})]
			});
		}
		/** One connection node: the tri-state icon and its workspace children. */
		function ConnectionNode(props) {
			const state = useAppState();
			const { target } = props;
			const key = targetNodeKey(target.id);
			const open = state.expanded[key] ?? false;
			const lastConnectedAt = formatTimestamp(target.lastConnectedAt);
			const connected = target.status === "ready";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: "dsh-rw-tree-connection",
				"data-state": target.status,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-rw-tree-row",
						"data-open": open ? "true" : "false",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Twisty, {
								open,
								label: open ? t("tree.collapse") : t("tree.expand"),
								onToggle: () => {
									store.toggleNode(key);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-rw-tree-icon dsh-rw-conn-icon",
								"data-state": target.status,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconGlobeOutlineRegular, { size: 14 })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: connectionState(target.status),
								size: 8
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-rw-tree-label",
								children: target.label
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
								tone: STATUS_TONES[target.status],
								children: connectionLabel(target.status)
							}),
							!props.compact && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
									tone: "quiet",
									children: t("list.kind.ssh")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-rw-tree-meta dsh-rw-mono",
									children: t("list.endpoint", {
										username: target.username,
										host: target.host,
										port: target.port
									})
								}),
								lastConnectedAt !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-rw-tree-meta",
									children: t("list.lastConnectedAt", { time: lastConnectedAt })
								})
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsh-rw-tree-actions",
								children: [
									!connected && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "primary",
										size: "sm",
										disabled: props.pending,
										icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconLinkOutlineRegular, { size: 12 }),
										onClick: () => {
											store.connectTarget(target);
										},
										children: target.status === "unknown" ? t("tree.conn.connect") : t("tree.conn.reconnect")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "outline",
										size: "sm",
										disabled: !connected || props.pending,
										icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 12 }),
										onClick: () => {
											store.openAddWorkspace(target);
										},
										children: t("tree.conn.addWorkspace")
									}),
									connected && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "ghost",
										size: "sm",
										disabled: props.pending,
										onClick: () => {
											store.stopTarget(target);
										},
										children: t("tree.conn.disconnect")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "ghost",
										size: "sm",
										disabled: props.pending,
										"aria-label": t("list.forget"),
										onClick: () => {
											store.forgetTarget(target);
										},
										children: props.compact ? "" : t("list.forget")
									})
								]
							})
						]
					}),
					target.lastError !== void 0 && target.lastError !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-rw-tree-error",
						children: t("list.lastError", { message: target.lastError })
					}),
					open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: "dsh-rw-tree-children",
						children: props.workspaces.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
							className: "dsh-rw-tree-note",
							children: t("tree.conn.noWorkspace")
						}) : props.workspaces.map((workspace) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkspaceNode, {
							workspace,
							target,
							compact: props.compact,
							pending: props.pending
						}, workspace.id))
					})
				]
			});
		}
		/**
		* The whole remote tree.
		* @param props.compact - sidebar presentation (narrow column).
		* @param props.empty - text shown when no connection is saved yet.
		*/
		function RemoteTree(props) {
			const state = useAppState();
			if (state.targets.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: "dsh-rw-tree-empty",
				children: props.empty ?? t("tree.empty")
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
				className: props.compact ? "dsh-rw-tree dsh-rw-tree--compact" : "dsh-rw-tree",
				children: state.targets.map((target) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConnectionNode, {
					target,
					workspaces: state.workspaces.filter((workspace) => workspace.targetId === target.id),
					compact: props.compact,
					pending: state.pending
				}, target.id))
			});
		}
		//#endregion
		//#region src/client/list.tsx
		/** One row of the 添加工作区 picker: a workspace the remote dsh registered. */
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
		/** The 添加工作区 modal: the remote dsh's own registry, plus a browse escape hatch. */
		function AddWorkspaceDialog() {
			const state = useAppState();
			const dialog = state.addWorkspace;
			if (dialog === void 0) return null;
			const added = new Set(state.workspaces.filter((workspace) => workspace.targetId === dialog.targetId).map((workspace) => workspace.path));
			const target = state.targets.find((candidate) => candidate.id === dialog.targetId);
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
							disabled: dialog.loading,
							onClick: () => {
								store.refreshAddWorkspace();
							},
							children: t("common.refresh")
						})
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsh-rw-footer-group",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							disabled: target === void 0,
							onClick: () => {
								store.closeAddWorkspace();
								if (target !== void 0) store.openTargetDirectory(target);
							},
							children: t("tree.addWorkspace.browse")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							onClick: store.closeAddWorkspace,
							children: t("tree.addWorkspace.close")
						})]
					})]
				}),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-rw-picker",
					children: [
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
					]
				})
			});
		}
		/** The panel body: the same tree as the sidebar, at full width. */
		function ListBody() {
			const state = useAppState();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-stack",
				children: [
					state.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorBanner, {
						error: state.error,
						onDismiss: store.dismissError
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AddWorkspaceDialog, {})
				]
			});
		}
		//#endregion
		//#region src/client/wizard.tsx
		/**
		* The four-step remote-connection wizard: choose a method → fill the
		* configuration → watch the live progress stream → pick the remote directory.
		*
		* All state comes from the module store (`./store.ts`), so the wizard and the
		* sidebar-footer button share it without React context across separately
		* registered slot entries.
		*/
		/** Step order of the wizard. */
		const STEP_ORDER = [
			"method",
			"config",
			"connecting",
			"directory"
		];
		/** Method cards; only SSH is selectable in v1. */
		const METHOD_CARDS = [
			{
				id: "ssh",
				disabled: false
			},
			{
				id: "docker",
				disabled: true
			},
			{
				id: "wsl",
				disabled: true
			}
		];
		/** Localized name/description key per method card. */
		const METHOD_NAME_KEYS = {
			ssh: "method.ssh.name",
			docker: "method.docker.name",
			wsl: "method.wsl.name"
		};
		/** Localized description key per method card. */
		const METHOD_DESCRIPTION_KEYS = {
			ssh: "method.ssh.description",
			docker: "method.docker.description",
			wsl: "method.wsl.description"
		};
		/** Step label key per wizard step. */
		const STEP_LABELS = {
			method: "step.label.method",
			config: "step.label.config",
			connecting: "step.label.connecting",
			directory: "step.label.directory"
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
						children: METHOD_CARDS.map((card, index) => {
							const selected = props.state.method === card.id;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "dsh-rw-method",
								"data-disabled": card.disabled ? "true" : void 0,
								"data-selected": selected ? "true" : void 0,
								disabled: card.disabled,
								"aria-pressed": selected,
								"aria-label": card.id === "ssh" ? t("method.ssh.aria") : void 0,
								...card.disabled ? {} : { "data-step-focus": index === 0 ? true : void 0 },
								onClick: () => {
									if (card.disabled) return;
									store.setMethod(card.id);
									store.setStep("config");
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "dsh-rw-method-name",
										children: [
											card.id === "ssh" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconGlobeOutlineRegular, { size: 16 }),
											t(METHOD_NAME_KEYS[card.id]),
											selected && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
												tone: "info",
												children: t("method.selected")
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsh-rw-method-description",
										children: t(METHOD_DESCRIPTION_KEYS[card.id])
									}),
									card.disabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsh-rw-method-state",
										children: t("method.disabledNote")
									})
								]
							}, card.id);
						})
					})
				]
			});
		}
		/** Step 2 — connection configuration. */
		function ConfigStep(props) {
			const { config, aliases, aliasesLoading, aliasesLoaded, aliasWarnings, prefilling, pending, secretPending } = props.state;
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
						}),
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
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "dsh-rw-hint",
										children: t("config.advanced.hint")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
										label: t("config.packageSource"),
										hint: t("config.packageSource.hint"),
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SegmentedControl, {
											id: "dsh-rw-package-source",
											value: config.packageSource,
											disabled: prefilling || pending,
											label: t("config.packageSource.label"),
											options: [
												{
													value: "",
													label: t("config.packageSource.auto")
												},
												{
													value: "download",
													label: t("config.packageSource.download")
												},
												{
													value: "upload",
													label: t("config.packageSource.upload")
												}
											],
											onChange: (next) => {
												store.patchConfig({ packageSource: next });
											}
										})
									})
								]
							})
						})
					]
				})
			});
		}
		/** Step 3 — live progress, the connection log, and host-key confirmation. */
		function ConnectingStep(props) {
			const { connect } = props.state;
			const prompt = connect.hostKey;
			const logRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const node = logRef.current;
				if (node !== null) node.scrollTop = node.scrollHeight;
			}, [connect.log.length]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-section",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: "dsh-rw-section-title",
						children: t("connect.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-rw-hint",
						children: t("connect.description")
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
					prompt !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
								children: prompt.fingerprint
							})] }),
							prompt.algorithm !== void 0 && prompt.algorithm !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsh-rw-field-label",
								children: t("connect.hostKey.algorithm")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsh-rw-mono",
								children: prompt.algorithm
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-rw-inline",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "primary",
									"data-step-focus": true,
									disabled: prompt.answering || prompt.trusted,
									onClick: () => {
										store.confirmHostKey();
									},
									children: prompt.trusted ? t("connect.hostKey.trusted") : prompt.answering ? t("connect.hostKey.trusting") : t("connect.hostKey.trust")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "ghost",
									disabled: prompt.answering,
									onClick: () => {
										store.cancelConnect();
									},
									children: t("connect.hostKey.cancel")
								})]
							})
						]
					}),
					connect.phase === "succeeded" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "dsh-rw-hint",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckCircleFillRegular, { size: 12 }), ` ${t("connect.succeeded")}`]
					}),
					connect.phase === "failed" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-rw-hint",
						children: t("connect.retryHint")
					}),
					connect.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorBanner, { error: connect.error })
				]
			});
		}
		/** Step 4 — remote directory browser. */
		function DirectoryStep(props) {
			const { directory } = props.state;
			const targetId = directory.targetId;
			const listing = directory.listing;
			const open = (path) => {
				if (targetId === void 0) return;
				store.loadDirectory(targetId, path);
			};
			if (targetId === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
		/** The wizard body: step pills, banners and the current step. */
		function WizardBody() {
			const state = useAppState();
			const bodyRef = (0, react.useRef)(null);
			const fingerprint = state.connect.hostKey?.fingerprint;
			(0, react.useEffect)(() => {
				(bodyRef.current?.querySelector("[data-step-focus]"))?.focus();
			}, [
				state.step,
				state.view,
				fingerprint
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
							state.step === "connecting" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConnectingStep, { state }),
							state.step === "directory" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DirectoryStep, { state })
						]
					})
				]
			});
		}
		/** Wizard actions, rendered inside the dialog footer. */
		function WizardFooter() {
			const state = useAppState();
			const { pending, connect, directory } = state;
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
						disabled: state.method !== "ssh",
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
							store.startConnect();
						},
						children: t("config.connect")
					})]
				})]
			});
			if (state.step === "connecting") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-footer-actions",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-rw-footer-group",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						disabled: busy,
						onClick: () => {
							if (connect.origin === "directory") store.showList();
							else store.setStep("config");
						},
						children: t("common.back")
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsh-rw-footer-group",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						disabled: connect.phase === "succeeded",
						onClick: () => {
							store.cancelConnect();
						},
						children: t("common.cancel")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "primary",
						disabled: pending || busy,
						onClick: () => {
							if (connect.origin === "directory") store.retryDirectoryConnect();
							else store.startConnect();
						},
						children: t("common.retry")
					})]
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-footer-actions",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-rw-footer-group",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronLeftOutlineRegular, { size: 12 }),
						onClick: () => {
							store.showList();
						},
						children: t("directory.backToList")
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsh-rw-footer-group",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						onClick: store.closeOverlay,
						children: t("common.close")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "primary",
						disabled: pending || directory.loading || directory.listing === void 0,
						onClick: () => {
							store.openWorkspace();
						},
						children: pending ? t("directory.opening") : t("directory.open")
					})]
				})]
			});
		}
		//#endregion
		//#region src/client/panel.tsx
		/**
		* The 远程连接 main panel: the sidebar row under 插件 and the page it opens.
		*
		* The row is an ordinary `sidebar.panellist` entry (order 1, right after the
		* plugins panel), so the shell owns the button, label and selection — exactly
		* like 插件 and 任务. Selecting it switches the main column to this page via
		* the `main` slot entry with the same key. The page hosts the whole flow
		* inline: 新建连接 sits at the top-left, and the four-step wizard renders in
		* place instead of a dialog.
		*/
		/** The panel id in the layout's main registry and the `sidebar.panellist` cell. */
		const PANEL_ID = "dsh-remote-workspace";
		/** Sidebar row icon; the shell asks for the edge and the selection state. */
		function RemotePanelIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconGlobeOutlineRegular, { size: props.size });
		}
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
					state.notice !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoticeToast, {
						kind: state.notice.kind,
						text: state.notice.text,
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
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-rw-side-icon",
								"aria-hidden": "true",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconGlobeOutlineRegular, { size: 14 })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-rw-side-title",
								children: t("tree.sidebar.title")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
							})
						]
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
		/** Marker attribute value for the injected `<style>` element. */
		const STYLE_PLUGIN_ID = "dsh-remote-workspace";
		/** The complete stylesheet. */
		const STYLE_TEXT = `
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

/* ------------------------------------------------------------ remote tree */

.dsh-rw-tree,
.dsh-rw-tree-children {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* One indent step per depth level: connection → workspace → session. */
.dsh-rw-tree-children {
  margin-left: 14px;
  padding-left: 6px;
  border-left: 1px solid var(--dsw-alias-border-l2);
}

.dsh-rw-tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 3px 8px 3px 4px;
  border-radius: var(--dsw-radius-sm, 6px);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}
.dsh-rw-tree-row:hover {
  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-secondary));
}

/* The twisty is deliberately chrome-free: the row is the click target. */
.dsh-rw-twisty {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  background: transparent;
  border-radius: 4px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dsh-rw-twisty:hover {
  background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-secondary));
  color: var(--dsw-alias-label-primary);
}

.dsh-rw-tree-icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  color: var(--dsw-alias-label-secondary, inherit);
}

/* Connection globe colour follows the same tri-state as the StateDot next to
   it: green connected / red failed / neutral otherwise. */
.dsh-rw-conn-icon[data-state="ready"] {
  color: var(--dsw-alias-state-success-primary);
}
.dsh-rw-conn-icon[data-state="failed"] {
  color: var(--dsw-alias-state-error-primary);
}

.dsh-rw-tree-label {
  flex: none;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-rw-tree-path {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-tree-meta {
  flex: none;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
}

.dsh-rw-tree-actions {
  margin-left: auto;
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  /* De-emphasised, never hidden: an action that only exists on hover is
     invisible to assistive tech and impossible to discover. */
  opacity: 0.55;
  transition: opacity 120ms ease;
}
.dsh-rw-tree-row:hover .dsh-rw-tree-actions,
.dsh-rw-tree-row:focus-within .dsh-rw-tree-actions,
.dsh-rw-tree-session:hover .dsh-rw-tree-actions,
.dsh-rw-tree-session:focus-within .dsh-rw-tree-actions {
  opacity: 1;
}

.dsh-rw-tree-session {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  padding: 2px 8px 2px 4px;
  border-radius: var(--dsw-radius-sm, 6px);
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-rw-tree-session:hover {
  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-secondary));
}
.dsh-rw-tree-session[data-current="true"] .dsh-rw-tree-label {
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}

/* Sessions have no twisty, so a gutter keeps their icons aligned with rows. */
.dsh-rw-tree-gutter {
  flex: none;
  width: 18px;
}

.dsh-rw-tree-note {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 28px;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-rw-tree-note-error {
  color: var(--dsw-alias-state-error-primary);
}

.dsh-rw-tree-error {
  padding: 0 8px 4px 42px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
  word-break: break-word;
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
  padding: 4px 8px 6px;
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
  padding: 0 2px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-rw-side-icon {
  display: inline-flex;
  align-items: center;
  color: var(--dsw-alias-label-tertiary);
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
  margin: 2px 2px 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
  word-break: break-word;
}

/* Compact rows for the narrow column. The sidebar is ~270px wide and the
   region clips overflow, so a row that cannot fit its actions must WRAP them
   onto a second line rather than push them out of the column (measured: the
   connection row's actions ran 104px past the right edge and became
   unclickable). */
.dsh-rw-tree--compact .dsh-rw-tree-row {
  min-height: 28px;
  gap: 4px;
  font-size: 12px;
  flex-wrap: wrap;
}
.dsh-rw-tree--compact .dsh-rw-tree-label {
  min-width: 0;
  max-width: 100%;
}
.dsh-rw-tree--compact .dsh-rw-tree-actions {
  gap: 2px;
  margin-left: auto;
}
/* Wrapped actions start on their own line, aligned under the label. */
.dsh-rw-tree--compact .dsh-rw-tree-row > .dsh-rw-tree-actions:not(:first-child) {
  padding-left: 22px;
}
.dsh-rw-tree-empty {
  margin: 4px 2px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
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
		* Swap the folder icon for a globe on every shell-tree row that belongs to a
		* remote workspace. Safe against unknown ids: rules simply never match.
		* @param ids official shell-workspace ids currently registered.
		* @returns a disposer removing the injected tag.
		*/
		function syncWorkspaceIcons(ids) {
			if (typeof document === "undefined") return () => {};
			let tag = document.querySelector(`style[data-plugin="${ICONS_STYLE_ID}"]`);
			if (tag === null) {
				tag = document.createElement("style");
				tag.dataset.plugin = ICONS_STYLE_ID;
				document.head.appendChild(tag);
			}
			tag.textContent = ids.map((id) => `
/* The row the shell renders for a remote workspace (its stub directory).
   It keeps full behaviour — the session tree under it, clicks, menus — but is
   no longer listed under 工作区: the remote tree has its own section now, and
   the same workspace must not appear twice. */
div[data-row-key="workspace:${id}"] {
  display: none;
}`).join("\n");
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
			ctx.effect(() => ensureStyles(), "dsh-remote-workspace: stylesheet");
			ctx.effect(() => watchWorkspaces(syncWorkspaceIcons), "dsh-remote-workspace: workspace icons");
			ctx.effect(() => mountSidebarSection(), "dsh-remote-workspace: sidebar section");
			store.refreshState();
			ctx.effect(() => () => {
				dispose();
			}, "dsh-remote-workspace: store lifetime");
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: PANEL_ID,
				order: 1,
				label: () => t("button.label"),
				registrant: "dsh-remote-workspace"
			}, RemotePanelIcon));
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