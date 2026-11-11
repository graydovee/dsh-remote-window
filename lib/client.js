window.__ModuleLoader__.load({
	id: "dsh-remote-workspace",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_dom_client = require("react-dom/client");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react_dom = require("react-dom");
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
		/**
		* Whether this component is **the** live instance of its kind.
		*
		* The toast host is mounted in one place in v3, but hot reload can briefly keep
		* two trees alive; the first host owns the surface so a notice never renders
		* twice.
		* @param kind - a stable name per surface, e.g. `'notice-toast'`.
		* @returns true while this instance owns the surface.
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
		/** Current owner token per surface kind. */
		const owners = /* @__PURE__ */ new Map();
		/** Claim functions of every mounted instance, per surface kind. */
		const waiters = /* @__PURE__ */ new Map();
		/**
		* Transient notice rendered as the shell's official `Toast` (top-center,
		* self-timed hold+fade; `onDone` is the only dismissal signal).
		*
		* Success uses the built-in green check; errors keep the default dark surface
		* with a warning icon and a longer hold. `key` replays the slide-in when a
		* **new notice** arrives: the notice object is stable until the next commit
		* that replaces it, so only a real new notice bumps the key.
		*/
		function NoticeToast(props) {
			const seq = (0, react.useRef)(0);
			const seen = (0, react.useRef)(void 0);
			if (props.notice !== seen.current) {
				seen.current = props.notice;
				seq.current += 1;
			}
			const { kind, text } = props.notice;
			return kind === "success" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
				text,
				tone: "success",
				holdMs: 3e3,
				onDone: props.onDismiss
			}, seq.current) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
				text,
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 18 }),
				holdMs: 5e3,
				onDone: props.onDismiss
			}, seq.current);
		}
		/** The single toast host for this plugin. */
		function NoticeToastHost(props) {
			if (!useSingleHost("notice-toast") || props.notice === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoticeToast, {
				notice: props.notice,
				onDismiss: props.onDismiss
			});
		}
		//#endregion
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
			"common.retry": "重试",
			"common.loading": "加载中…",
			"step.label.method": "选择方式",
			"step.label.config": "填写配置",
			"step.label.connect": "连接",
			"step.goBackTo": "返回「{label}」",
			"wizard.steps.aria": "连接步骤",
			"list.newConnection": "新建连接",
			"list.reconnect": "重新连接",
			"list.stop": "停止",
			"list.forget": "删除",
			"list.forgotTarget": "已删除连接「{label}」",
			"portal.title": "server 主区：{label}",
			"portal.main.aria": "远程官方界面",
			"portal.timeout": "{label} 的官方界面没有在预期时间内就绪。",
			"portal.failedHint": "可重试；若仍失败，请在「远程连接」里断开后重新连接。",
			"connections.sidebar.label": "远程连接",
			"connections.title": "远程连接",
			"connections.subtitle": "这些连接由这台 client 管理；点击即可打开对应 server 的界面。",
			"connections.active": "当前",
			"connections.reconnect": "重新连接",
			"connections.empty": "还没有远程连接",
			"connections.empty.hint": "点击「新建连接」添加一台远程主机。",
			"connections.loadFailed": "读取连接失败",
			"connections.activate": "切换到 {label}",
			"connections.connect": "连接",
			"connections.disconnect": "断开",
			"connections.endpoint": "{username}@{host}:{port}",
			"connections.endpoint.wsl": "WSL",
			"connections.endpoint.wslDistro": "WSL · {distro}",
			"remote.phase.disconnected": "未连接",
			"remote.phase.connecting": "连接中",
			"remote.phase.ready": "已连接",
			"remote.phase.degraded": "已连接（受限）",
			"remote.phase.failed": "连接失败",
			"remote.phase.stopped": "已停止",
			"remote.connect.title": "新建远程连接",
			"remote.connect.reconnectTitle": "重新连接「{label}」",
			"remote.connect.reconnectHint": "复用已保存的凭据与主机指纹；连接完成后会自动打开该 server 的界面。",
			"remote.connect.label": "别名",
			"remote.connect.labelPlaceholder": "例如 dev-box",
			"remote.connect.host": "主机",
			"remote.connect.port": "端口",
			"remote.connect.username": "用户名",
			"remote.connect.authKind": "认证方式",
			"remote.connect.auth.password": "密码",
			"remote.connect.auth.privateKey": "私钥",
			"remote.connect.auth.agent": "SSH Agent",
			"remote.connect.secret": "密码",
			"remote.connect.privateKeyPath": "私钥路径",
			"remote.connect.privateKeyHint": "从 `~/.ssh` 下发现的私钥里选择，或手动填写本机路径；凭据只留在本机。",
			"remote.connect.privateKeyFound": "已发现 {count} 个私钥",
			"remote.connect.privateKeyNone": "`~/.ssh` 下没有发现可用私钥，请手动填写路径。",
			"remote.connect.passphrase": "私钥口令（可选）",
			"remote.connect.passphraseHint": "有口令时填写，只留在本机。",
			"remote.connect.dshHome": "server DSH_HOME（可选）",
			"remote.connect.dshHomeHint": "留空使用 server 默认 ~/.dsh。",
			"remote.connect.submit": "连接",
			"remote.connect.timeout": "连接超时（10 分钟）；首次连接可能正在构建独立运行时",
			"remote.connect.failed": "连接失败：{message}",
			"remote.connect.next": "下一步",
			"remote.connect.back": "上一步",
			"remote.connect.retry": "重试连接",
			"remote.connect.dshHomeDefault": "server 默认 ~/.dsh",
			"remote.connect.deploying": "正在连接主机、部署运行时与 server 插件，并启动 profile…",
			"remote.connect.identity": "当前连接",
			"remote.connect.advanced": "高级选项",
			"remote.connect.advanced.hint": "一般不需要修改；server DSH_HOME 留空则使用远端默认 ~/.dsh。",
			"remote.connect.sshAlias": "从 ~/.ssh/config 选择",
			"remote.connect.sshAlias.hint": "选择 alias 自动填充主机、端口、用户与私钥路径；认证方式不会被覆盖。",
			"remote.connect.sshAlias.loading": "正在读取 ~/.ssh/config…",
			"remote.connect.sshAlias.empty": "没有可用的 SSH alias，手动填写即可。",
			"remote.connect.sshAlias.manual": "手动填写",
			"remote.connect.sshAlias.refresh": "刷新",
			"remote.connect.sshAlias.warning": "有 {count} 条 SSH config 解析警告",
			"connect.local.title": "模型来源",
			"connect.local.source.local": "本地模型",
			"connect.local.source.server": "server 模型",
			"connect.local.serverHint": "使用 server profile 自己的模型配置；需要 server 已配置可用的 API key。",
			"connect.local.auto.forwardAll": "使用本机的模型。",
			"connect.progress.elapsed": "已用 {seconds}s",
			"connect.progress.waiting": "正在连接…首次进入或部署运行时时可能需要 1–2 分钟",
			"connect.progress.readFailed": "无法读取连接进度（{message}），仍在重试…",
			"connect.config.title": "填写 SSH 配置",
			"connect.deploy.title": "连接与部署",
			"connect.deploy.hint": "进入此步骤后会自动探测主机环境、复用或安装独立 runtime、安装 server 插件并启动专用 profile；首次主机指纹需要确认。",
			"remote.connect.submitting": "正在连接…",
			"remote.connect.done": "已连接「{label}」",
			"remote.connect.labelRequired": "请填写别名",
			"remote.connect.hostRequired": "请填写主机",
			"remote.connect.portInvalid": "端口必须是 1–65535",
			"remote.connect.userRequired": "请填写用户名",
			"remote.connect.secretRequired": "请填写密码",
			"remote.connect.keyRequired": "请填写私钥路径",
			"remote.connect.hostkeyMessage": "首次连接需要确认主机指纹（SHA-256）：",
			"remote.connect.hostkeyHint": "确认这是目标主机的指纹后再继续；已 pin 的指纹发生变化会中止连接。",
			"remote.connect.hostkeyTrust": "信任并连接",
			"remote.refresh": "刷新",
			"remote.verb.failed": "{action}失败：{message}",
			"remote.deploy.pluginConfirmRequired": "在非专用 profile 安装插件需要按钮确认。",
			"remote.deploy.pluginNotManaged": "v1 只管理本 client 的专用 profile，拒绝修改其他 profile；请手工安装或等待后续版本。",
			"remote.deploy.globalUnsupported": "v1 不会修改 server 全局 DSH（避免影响其他 profile）；请手工安装/升级，或改用独立/专用运行时。",
			"remote.error.profileLocked": "该 profile 正被另一个 client 实例占用；不能并发驱动。",
			"remote.error.tunnel": "与 server 的连接不可用；请检查连接并重试。",
			"remote.error.runtimeConfirmRequired": "安装/升级 server 全局运行时会改动其他 profile；需要显式确认后才能继续。",
			"remote.error.runtimeIncompatible": "server 运行时版本与当前 client 不兼容；请安装/升级匹配的运行时。",
			"remote.error.pluginMissing": "server 插件缺失；专用 profile 会自动安装，其他 profile 需确认。",
			"remote.error.pluginProtocol": "server 插件协议不匹配；请重装/升级 server 插件。",
			"remote.error.profileStart": "profile server 启动失败；请查看 server 日志尾部后重试。",
			"remote.error.bootstrap": "server 数据目录首次初始化超时；请检查 server ~/.dsh 权限后重试。",
			"remote.dialog.cancel": "取消",
			"portal.loading": "正在加载 {label} 的官方对话区…",
			"portal.failed": "无法加载 {label} 的官方对话区",
			"portal.failedUnknown": "连接或代理暂时不可用；可重试，或检查连接状态。",
			"tree.forgetConnection": "删除连接",
			"tree.forget.confirm.title": "删除这个连接？",
			"tree.forget.confirm.message": "将删除「{label}」的本机记录、已保存的凭据与 {count} 个远程工作区。远端已部署的运行时与远端会话日志不会被删除。",
			"method.title": "选择连接方式",
			"method.description": "agent 在远端 server 运行；模型默认仍由本机转发，可在下一步切换。",
			"method.ssh.name": "SSH",
			"method.ssh.description": "通过 SSH 连接主机，在远端启动 DSH 并运行执行世界。",
			"method.wsl.name": "WSL",
			"method.wsl.description": "连接 Windows 子系统中的 Linux。",
			"method.ssh.aria": "使用 SSH 连接",
			"method.wsl.aria": "进入本机的 WSL 发行版",
			"connect.step.connect": "连接主机",
			"connect.step.probe": "探测远端环境",
			"connect.step.runtime": "部署运行时(Node)",
			"connect.step.upload": "准备 server 插件",
			"connect.step.start": "建立执行通道",
			"connect.status.pending": "等待中",
			"connect.status.running": "进行中",
			"connect.status.ok": "完成",
			"connect.status.skipped": "跳过",
			"connect.status.failed": "失败",
			"connect.log.title": "连接日志",
			"error.network": "网络请求失败：{message}"
		};
		const dictionaries = {
			zh,
			en: {
				"common.retry": "Retry",
				"common.loading": "Loading…",
				"step.label.method": "Method",
				"step.label.config": "Configure",
				"step.label.connect": "Connect",
				"step.goBackTo": "Back to \"{label}\"",
				"wizard.steps.aria": "Connection steps",
				"list.newConnection": "New connection",
				"list.reconnect": "Reconnect",
				"list.stop": "Stop",
				"list.forget": "Delete",
				"list.forgotTarget": "Deleted connection \"{label}\"",
				"portal.title": "Server conversation: {label}",
				"portal.main.aria": "Remote official UI",
				"portal.timeout": "{label}’s official UI did not become ready in time.",
				"portal.failedHint": "Retry; if it keeps failing, disconnect and reconnect from the Remote connections panel.",
				"connections.sidebar.label": "Remote connections",
				"connections.title": "Remote connections",
				"connections.subtitle": "These connections belong to this client; click one to open its server UI.",
				"connections.active": "Current",
				"connections.reconnect": "Reconnect",
				"connections.empty": "No remote connections yet",
				"connections.empty.hint": "Use “New connection” to add a remote host.",
				"connections.loadFailed": "Reading connections failed",
				"connections.activate": "Switch to {label}",
				"connections.connect": "Connect",
				"connections.disconnect": "Disconnect",
				"connections.endpoint": "{username}@{host}:{port}",
				"connections.endpoint.wsl": "WSL",
				"connections.endpoint.wslDistro": "WSL · {distro}",
				"remote.phase.disconnected": "Disconnected",
				"remote.phase.connecting": "Connecting",
				"remote.phase.ready": "Connected",
				"remote.phase.degraded": "Connected (limited)",
				"remote.phase.failed": "Connection failed",
				"remote.phase.stopped": "Stopped",
				"remote.connect.title": "New remote connection",
				"remote.connect.reconnectTitle": "Reconnect “{label}”",
				"remote.connect.reconnectHint": "Reuses the saved credentials and pinned host key; the server UI opens once it is ready.",
				"remote.connect.label": "Label",
				"remote.connect.labelPlaceholder": "e.g. dev-box",
				"remote.connect.host": "Host",
				"remote.connect.port": "Port",
				"remote.connect.username": "User",
				"remote.connect.authKind": "Authentication",
				"remote.connect.auth.password": "Password",
				"remote.connect.auth.privateKey": "Private key",
				"remote.connect.auth.agent": "SSH agent",
				"remote.connect.secret": "Password",
				"remote.connect.privateKeyPath": "Private key path",
				"remote.connect.privateKeyHint": "Pick a key discovered under `~/.ssh`, or type a local path; credentials never leave this machine.",
				"remote.connect.privateKeyFound": "{count} private keys found",
				"remote.connect.privateKeyNone": "No usable private key under `~/.ssh`; type a path.",
				"remote.connect.passphrase": "Key passphrase (optional)",
				"remote.connect.passphraseHint": "Only when the key has one; kept on this machine.",
				"remote.connect.dshHome": "Server DSH_HOME (optional)",
				"remote.connect.dshHomeHint": "Defaults to the server’s ~/.dsh.",
				"remote.connect.submit": "Connect",
				"remote.connect.timeout": "Connection timed out after 10 minutes; the first connection may still be building the isolated runtime",
				"remote.connect.failed": "Connection failed: {message}",
				"remote.connect.next": "Next",
				"remote.connect.back": "Back",
				"remote.connect.retry": "Retry connection",
				"remote.connect.dshHomeDefault": "server default ~/.dsh",
				"remote.connect.deploying": "Connecting, deploying the runtime and server plugin, and starting the profile…",
				"remote.connect.identity": "Current connection",
				"remote.connect.advanced": "Advanced",
				"remote.connect.advanced.hint": "Usually not needed; leave server DSH_HOME empty to use the remote default ~/.dsh.",
				"remote.connect.sshAlias": "From ~/.ssh/config",
				"remote.connect.sshAlias.hint": "Pick an alias to fill host, port, user and identity path; the auth kind is not overridden.",
				"remote.connect.sshAlias.loading": "Reading ~/.ssh/config…",
				"remote.connect.sshAlias.empty": "No SSH alias found; fill the fields manually.",
				"remote.connect.sshAlias.manual": "Manual",
				"remote.connect.sshAlias.refresh": "Refresh",
				"remote.connect.sshAlias.warning": "{count} SSH config parsing warning(s)",
				"connect.local.title": "Model source",
				"connect.local.source.local": "Local model",
				"connect.local.source.server": "Server model",
				"connect.local.serverHint": "Use the server profile’s own model configuration; the server must already have a working API key.",
				"connect.local.auto.forwardAll": "This machine's models are used.",
				"connect.progress.elapsed": "Elapsed {seconds}s",
				"connect.progress.waiting": "Connecting… the first connection or a runtime deploy can take 1–2 minutes",
				"connect.progress.readFailed": "Cannot read connect progress ({message}); still retrying…",
				"connect.config.title": "SSH configuration",
				"connect.deploy.title": "Connect and deploy",
				"connect.deploy.hint": "Entering this step automatically probes the host, reuses or installs an isolated runtime, installs the server plugin, and starts the dedicated profile. The first host key needs confirmation.",
				"remote.connect.submitting": "Connecting…",
				"remote.connect.done": "Connected to “{label}”",
				"remote.connect.labelRequired": "A label is required",
				"remote.connect.hostRequired": "A host is required",
				"remote.connect.portInvalid": "The port must be 1–65535",
				"remote.connect.userRequired": "A user is required",
				"remote.connect.secretRequired": "A password is required",
				"remote.connect.keyRequired": "A private key path is required",
				"remote.connect.hostkeyMessage": "First connection: confirm this host key (SHA-256):",
				"remote.connect.hostkeyHint": "Continue only if this is the target host. A changed pinned key aborts the connection.",
				"remote.connect.hostkeyTrust": "Trust and connect",
				"remote.refresh": "Refresh",
				"remote.verb.failed": "{action} failed: {message}",
				"remote.deploy.pluginConfirmRequired": "Installing the plugin into a non-dedicated profile requires confirmation.",
				"remote.deploy.pluginNotManaged": "v1 only manages this client’s dedicated profile and refuses to modify other profiles; install manually or wait for a later version.",
				"remote.deploy.globalUnsupported": "v1 never mutates the server global DSH (to avoid affecting other profiles); install/upgrade it manually or use the isolated/dedicated runtime.",
				"remote.error.profileLocked": "This profile is in use by another client instance; it cannot be driven concurrently.",
				"remote.error.tunnel": "The server connection is unavailable. Check the connection and retry.",
				"remote.error.runtimeConfirmRequired": "Installing/upgrading the server global runtime affects other profiles; explicit confirmation is required.",
				"remote.error.runtimeIncompatible": "The server runtime version is incompatible with this client; install/upgrade a matching runtime.",
				"remote.error.pluginMissing": "The server plugin is missing; the dedicated profile installs it automatically, other profiles require confirmation.",
				"remote.error.pluginProtocol": "The server plugin protocol does not match; reinstall/upgrade the server plugin.",
				"remote.error.profileStart": "The profile server failed to start; check the server log tail and retry.",
				"remote.error.bootstrap": "First-time server data initialization timed out; check server ~/.dsh permissions and retry.",
				"remote.dialog.cancel": "Cancel",
				"portal.loading": "Loading {label}’s official conversation…",
				"portal.failed": "Could not load {label}’s official conversation",
				"portal.failedUnknown": "The connection or proxy is unavailable. Retry or check the connection.",
				"tree.forgetConnection": "Delete connection",
				"tree.forget.confirm.title": "Delete this connection?",
				"tree.forget.confirm.message": "Removes the local record for \"{label}\", its stored credential and {count} remote workspace(s). The runtime deployed on the remote host and the remote session logs are NOT deleted.",
				"method.title": "Choose a connection method",
				"method.description": "The agent runs on the remote server. Model requests are bridged from this machine by default; you can switch to the server model.",
				"method.ssh.name": "SSH",
				"method.ssh.description": "Connect over SSH and start DSH with the execution world on the host.",
				"method.wsl.name": "WSL",
				"method.wsl.description": "Connect to Linux inside the Windows subsystem.",
				"method.ssh.aria": "Connect over SSH",
				"method.wsl.aria": "Enter a local WSL distribution",
				"connect.step.connect": "Connect to the host",
				"connect.step.probe": "Probe the remote host",
				"connect.step.runtime": "Deploy the runtime (Node)",
				"connect.step.upload": "Prepare the server plugin",
				"connect.step.start": "Open the execution channel",
				"connect.status.pending": "Pending",
				"connect.status.running": "Running",
				"connect.status.ok": "Done",
				"connect.status.skipped": "Skipped",
				"connect.status.failed": "Failed",
				"connect.log.title": "Connection log",
				"error.network": "The request failed: {message}"
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
		//#region src/client/api.ts
		/**
		* Shared browser → client-host transport (v3).
		*
		* The envelope, error normalizer and trust fence are the same for every call:
		* a failed request arrives as a {@link RemoteApiError} with a stable code, and
		* the UI renders {@link WireError} inline instead of a bare exception.
		*
		* What remains here is the connection-dialog surface: saved SSH aliases and
		* discoverable private keys. Every other route lives in `remote-api.ts`.
		*/
		/** Route prefix owned by the plugin's host half. */
		const API_PREFIX = "/dsh-remote-workspace";
		/** One failed call, with the host's error code and the HTTP status. */
		var RemoteApiError = class extends Error {
			code;
			status;
			/** Structured public details from the envelope (never secrets). */
			details;
			/**
			* @param code - the host's error code (`network` and `invalid-response` are client-side).
			* @param message - human-readable message, already localized where the client produced it.
			* @param status - HTTP status, 0 for a transport failure.
			*/
			constructor(code, message, status, details) {
				super(message);
				this.name = "RemoteApiError";
				this.code = code;
				this.status = status;
				this.details = details;
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
			throw new RemoteApiError(code, envelopeMessage ?? fallback, response.status, parsed?.error?.details);
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
		/** The connection-dialog data routes. */
		const api = {
			/** Aliases parsed from the local `~/.ssh/config`, plus parser warnings. */
			sshAliases() {
				return call("ssh-aliases", {});
			},
			/**
			* Private keys discoverable under `~/.ssh` on this host.
			*
			* Only paths cross the wire; the dialog offers them as datalist options and
			* still lets the user type a path that is not listed.
			*/
			sshKeys() {
				return call("ssh-keys", {});
			}
		};
		/**
		* Whether one method exists on a host platform.
		* @param method - wizard method id.
		* @param platform - `process.platform` of the harness host (`'win32'`, `'darwin'`, `'linux'`).
		* @returns true when the method may be offered on that platform.
		*/
		function methodAvailable(method, platform) {
			if (method === "ssh") return true;
			if (method === "docker") return false;
			return false;
		}
		//#endregion
		//#region src/client/method-cards.ts
		/**
		* The connection methods the v3 connect dialog's step 1 presents.
		*
		* Kept as a **pure module** (no React, no shell services) for two reasons:
		*
		*  - the acceptance criterion for step 1 is "ssh only, and no reserved/teaser
		*    card" — a list that can be asserted directly in a test, which a component
		*    table inside `remote-dialogs.tsx` cannot be (that file imports the shell's
		*    runtime module table, which this repository does not install);
		*  - visibility must be decided by the *shared* predicate the host validates
		*    `connect/start` with ({@link methodAvailable}), so "hidden on the client"
		*    and "refused on the host" cannot drift.
		*/
		/** Offered methods, in display order. */
		const OFFERED_METHODS = ["ssh"];
		/**
		* The offered methods this host platform can actually run.
		*
		* Today that is `['ssh']` everywhere: `methodAvailable` returns false for WSL
		* until its transport exists, and for the reserved container method on every
		* platform. Keeping the filter means the dialog never needs a second gate when
		* a method becomes available.
		* @param platform - the harness host's `process.platform` (`'win32'`, `'darwin'`, …).
		* @returns the methods to render as cards, in display order.
		*/
		function offeredMethods(platform) {
			return OFFERED_METHODS.filter((method) => methodAvailable(method, platform));
		}
		//#endregion
		//#region src/client/remote-api.ts
		/**
		* The browser → client-host API used by the v3 rail, dialogs and portal.
		*
		* Every route here is the host face; none talks to the profile server
		* directly. The envelope, error normalizer and trust fence live in `api.ts`.
		*/
		/** The host routes the v3 client uses. */
		const remoteApi = {
			/** Full first-paint snapshot (targets + connection states + workspace lists). */
			state() {
				return call("state", {});
			},
			/** Session list for one target; `workspaceId` omitted returns the whole account. */
			async sessions(targetId, workspaceId) {
				const value = await call("v1/sessions", {
					targetId,
					...workspaceId === void 0 ? {} : { workspaceId }
				});
				const raw = value;
				const wrapped = value;
				return Array.isArray(raw.sessions) ? raw : wrapped.sessions;
			},
			/** The server's authoritative workspace list (host wraps the P1 value). */
			async workspaces(targetId) {
				const value = await call("v1/workspaces", { targetId });
				const raw = value;
				const wrapped = value;
				return Array.isArray(raw.workspaces) ? raw : wrapped.workspaces;
			},
			/** Connect one identity through the v1 host route. */
			connectV1(request) {
				return call("v1/connect", request);
			},
			/** Read the progress buffer for one connect attempt. */
			connectProgress(attemptId) {
				return call("v1/connect/progress", { attemptId });
			},
			/**
			* Reconnect one saved target using the host-side pinned record and secret.
			*
			* `attemptId` opts the attempt into the host's progress buffer, so the dialog
			* can show the same step-by-step progress a first connection shows.
			*/
			reconnect(targetId, options = {}) {
				return call("v1/connect", {
					targetId,
					...options.attemptId === void 0 ? {} : { attemptId: options.attemptId }
				});
			},
			/** Delete one saved target (profile stopped, local record and secret removed). */
			forget(targetId) {
				return call("forget-target", { targetId });
			},
			/** Stop one profile server through the v1 host route. */
			stop(targetId) {
				return call("v1/stop", { targetId });
			},
			/** Server-mode new session: create/reuse a blank. */
			sessionCreate(params) {
				return call("session/create", {
					targetId: params.targetId,
					workspaceId: params.workspaceId,
					executor: "server"
				});
			},
			/** Light refresh of one target; never restarts the profile (protocol §16.3). */
			stateRefresh(targetId) {
				return call("state/refresh", { targetId });
			}
		};
		/** Query parameter naming the target currently mounted in the frame (protocol §9.3). */
		const RW_EMBED_TARGET_PARAM = "dshRwTarget";
		/** Longest accepted `targetId` in a portal command (target ids are opaque). */
		const RW_PORTAL_TARGET_ID_MAX = 200;
		/**
		* Build the command a server-side list row sends when it is clicked.
		* @param targetId - the target the client page should activate.
		* @returns the versioned command payload.
		*/
		function rwPortalSwitchTarget(targetId) {
			return {
				v: 1,
				type: "dsh-rw/switch-target",
				targetId
			};
		}
		/** @returns the command asking the client page to open its connect dialog. */
		function rwPortalOpenConnectDialog() {
			return {
				v: 1,
				type: "dsh-rw/open-connect-dialog"
			};
		}
		/** @returns the command asking the client page to drop the frame. */
		function rwPortalClosePortal() {
			return {
				v: 1,
				type: "dsh-rw/close-portal"
			};
		}
		/**
		* Validate one iframe→parent message body.
		*
		* Accepts only the versioned command vocabulary; the caller still checks that
		* the event origin matches and the source is the mounted frame.
		* @param data - raw `MessageEvent.data`.
		* @returns the command, or undefined for anything unrecognized.
		*/
		function parseRwPortalCommand(data) {
			if (data === null || typeof data !== "object") return void 0;
			const frame = data;
			if (frame["v"] !== 1) return void 0;
			switch (frame["type"]) {
				case "dsh-rw/switch-target": {
					const targetId = frame["targetId"];
					if (typeof targetId !== "string" || targetId.length === 0 || targetId.length > RW_PORTAL_TARGET_ID_MAX) return void 0;
					return rwPortalSwitchTarget(targetId);
				}
				case "dsh-rw/open-connect-dialog": return rwPortalOpenConnectDialog();
				case "dsh-rw/close-portal": return rwPortalClosePortal();
				default: return;
			}
		}
		//#endregion
		//#region src/client/portal-url.ts
		/**
		* Pure plumbing for the v1 server-mode main area (`portal` + `embed`).
		*
		* Mirrors `doc/refactor-v1-protocol.md` §8 (same-origin portal) and §9 (official
		* UI embed). The iframe lifecycle belongs to `portal-main.tsx` (task-5); this
		* module owns the parts that must be exact and testable without a DOM:
		*
		*  - the portal URL/query the client constructs for one target (`dshRwSession`,
		*    theme, language and the parent-origin check);
		*  - the `postMessage` vocabulary (parent → iframe navigation and iframe →
		*    parent readiness), including strict version/origin validation;
		*  - the storage-event bridge the iframe uses to report its selected session
		*    (the official UI persists `dsh.sessions.current`, and the embed shim
		*    prefixes that key — no private API);
		*  - the small frame state machine (loading / ready / error / reload) the
		*    React container renders.
		*/
		/** Client-host portal prefix (protocol §8.1). */
		const PORTAL_PREFIX = "/dsh-remote-workspace/portal";
		/** Target the frame currently shows (shared protocol constant). */
		const EMBED_TARGET_PARAM = RW_EMBED_TARGET_PARAM;
		/** Embed query keys (protocol §9.3, plus the §16.2 fallback). */
		const EMBED_SESSION_PARAM = "dshRwSession";
		/** Fallback deep link (protocol §16.2): open the workspace's own draft. */
		const EMBED_WORKSPACE_PARAM = "dshRwWorkspace";
		const EMBED_THEME_PARAM = "dshRwTheme";
		const EMBED_LANG_PARAM = "dshRwLang";
		const EMBED_PARENT_PARAM = "dshRwParent";
		/** Full official shell (no client-embed sidebar hiding). */
		const EMBED_FULL_PARAM = "dshRwFull";
		/**
		* The portal path for one target, with a trailing slash.
		*
		* The path is relative on purpose: the iframe is same-origin with the client
		* GUI, so a relative `src` keeps the browser on the client origin (and avoids
		* ever exposing profile-server authority).
		* @param targetId - connected target id.
		* @returns `/dsh-remote-workspace/portal/<encoded targetId>/`.
		*/
		function portalPath(targetId) {
			if (targetId === "") throw new TypeError("portalPath: targetId must not be empty");
			return `${PORTAL_PREFIX}/${encodeURIComponent(targetId)}/`;
		}
		/**
		* Build the iframe's initial URL (protocol §9.3).
		*
		* Query parameters are ordered deterministically (session, theme, lang, parent)
		* so tests and diagnostics compare one stable string.
		* @param input - target and optional embed hints.
		* @returns the relative portal URL.
		*/
		function portalUrl(input) {
			const params = new URLSearchParams();
			params.set(EMBED_TARGET_PARAM, input.targetId);
			if (input.sessionId !== void 0 && input.sessionId !== "") params.set(EMBED_SESSION_PARAM, input.sessionId);
			if (input.workspaceId !== void 0 && input.workspaceId !== "") params.set(EMBED_WORKSPACE_PARAM, input.workspaceId);
			if (input.theme !== void 0) params.set(EMBED_THEME_PARAM, input.theme);
			if (input.lang !== void 0) params.set(EMBED_LANG_PARAM, input.lang);
			if (input.parentOrigin !== void 0 && input.parentOrigin !== "") params.set(EMBED_PARENT_PARAM, input.parentOrigin);
			if (input.full === true) params.set(EMBED_FULL_PARAM, "1");
			return `${portalPath(input.targetId)}?${params.toString()}`;
		}
		/**
		* Whether one absolute URL belongs to a target's portal document.
		*
		* Used to validate `StorageEvent.url`: a same-origin storage event fires for
		* every iframe, so the parent must only accept the one it owns (protocol §9.3).
		* @param candidate - event URL or iframe URL.
		* @param targetId - the target whose iframe is the only accepted source.
		* @returns true when the path is exactly inside that target's portal.
		*/
		function portalUrlMatches(candidate, targetId) {
			if (targetId === "" || candidate === "") return false;
			let parsed;
			try {
				parsed = new URL(candidate, "http://portal.local");
			} catch {
				return false;
			}
			const prefix = portalPath(targetId);
			return parsed.pathname === prefix || parsed.pathname.startsWith(prefix);
		}
		/** Whether a message event came from the origin this main area expects. */
		function isTrustedMessageOrigin(origin, expectedOrigin) {
			return origin !== "" && expectedOrigin !== "" && origin === expectedOrigin;
		}
		/**
		* Validate one iframe → parent message (runs in the client GUI).
		* @param data - `MessageEvent.data`.
		* @returns the typed message, or undefined when the shape/version is wrong.
		*/
		function parseChildMessage(data) {
			if (data === null || typeof data !== "object") return void 0;
			const message = data;
			return message.v === 1 && message.type === "dsh-rw/ready" ? {
				v: 1,
				type: "dsh-rw/ready"
			} : void 0;
		}
		/** Official persisted selection key (ui-workspace writes this store). */
		const SELECTION_STORAGE_KEY = "dsh.sessions.current";
		/**
		* The prefixed key the embed shim exposes for the official selection store.
		* @param storagePrefix - `capabilities.embed.storagePrefix` from the handshake.
		* @returns the key a `StorageEvent` must carry.
		*/
		function selectionStorageKey(storagePrefix) {
			if (storagePrefix === "") throw new TypeError("selectionStorageKey: prefix must not be empty");
			return `${storagePrefix}${SELECTION_STORAGE_KEY}`;
		}
		/**
		* Parse one persisted selection value.
		* @param value - raw `newValue`; `null` means the key was removed (cleared).
		* @returns the snapshot, or undefined when the bytes are not the contract.
		*/
		function parseSelectionValue(value) {
			if (value === null || value === "") return {};
			let parsed;
			try {
				parsed = JSON.parse(value);
			} catch {
				return;
			}
			if (parsed === null || typeof parsed !== "object") return void 0;
			const sessionId = parsed.sessionId;
			if (sessionId === void 0) return {};
			if (typeof sessionId !== "string" || sessionId === "") return {};
			return { sessionId };
		}
		/**
		* Parent-side filter for one same-origin `storage` event.
		*
		* The official UI reports its selection by writing the prefixed
		* `dsh.sessions.current`; only that key, from this target's iframe URL, is
		* accepted. Every other storage event is another surface's business.
		* @param event - `key`, `newValue`, `url`, `storageArea` is `localStorage`.
		* @param input - target id and the handshake's storage prefix.
		* @returns the selected session, or undefined when the event is not ours.
		*/
		function parseSelectionStorageEvent(event, input) {
			if (input.storagePrefix === "") return void 0;
			if (event.key !== selectionStorageKey(input.storagePrefix)) return void 0;
			if (!portalUrlMatches(event.url, input.targetId)) return void 0;
			return parseSelectionValue(event.newValue);
		}
		/** Initial state: no frame mounted. */
		const IDLE_PORTAL_FRAME = {
			phase: "idle",
			reloadCount: 0
		};
		/**
		* Reduce the iframe lifecycle.
		*
		* v1 navigates by having the embedded page reload itself (protocol §9.3), so a
		* requested session change moves the frame back to `loading` and bumps
		* `reloadCount`; `ready`/`selection` during that window are ignored until the
		* document reports itself loaded again. A failure keeps the target identity so
		* the retry can reuse it.
		* @param state - current state.
		* @param action - UI action.
		* @returns the next state.
		*/
		function portalFrameReducer(state, action) {
			switch (action.type) {
				case "open": return {
					phase: "loading",
					targetId: action.targetId,
					...action.sessionId === void 0 ? {} : { requestedSessionId: action.sessionId },
					reloadCount: state.targetId === action.targetId ? state.reloadCount : state.reloadCount + 1
				};
				case "navigate":
					if (state.phase === "idle" || state.targetId === void 0) return state;
					return {
						...state,
						phase: "loading",
						requestedSessionId: action.sessionId,
						reloadCount: state.reloadCount + 1,
						error: void 0
					};
				case "loaded":
					if (state.phase !== "loading") return state;
					return {
						...state,
						phase: "ready"
					};
				case "selection":
					if (state.phase === "idle" || state.targetId === void 0) return state;
					return {
						...state,
						reportedSessionId: action.sessionId,
						...state.phase === "loading" ? { phase: "ready" } : {}
					};
				case "failed":
					if (state.phase === "idle") return state;
					return {
						...state,
						phase: "error",
						error: action.error
					};
				case "retry":
					if (state.targetId === void 0) return state;
					return {
						...state,
						phase: "loading",
						reloadCount: state.reloadCount + 1,
						error: void 0
					};
				case "clear": return IDLE_PORTAL_FRAME;
			}
		}
		//#endregion
		//#region src/client/portal-main.tsx
		/**
		* The v3 **remote main area**: one same-origin iframe showing the profile
		* server's complete official DSH UI (protocol §8/§9).
		*
		* The client no longer redraws the conversation. The frame is full-screen in
		* the shell's main region and the server plugin's embed layer is asked for
		* `full` mode (`dshRwFull=1`), so the official sidebar, header, conversation
		* and right sidebar are all present and owned by the server.
		*
		* The client's own chrome lives outside the frame: the 「远程连接」 sidebar row
		* and connection list panel (`connections-panel.tsx`), plus the dialogs/toast
		* body host (`chrome.tsx`).
		*
		* iframe → parent messages carry two vocabularies: the child's readiness
		* (`dsh-rw/ready`, the frame lifecycle signal) and the portal commands the
		* mirrored server-side connection list sends back (`dsh-rw/switch-target`,
		* `dsh-rw/open-connect-dialog`, `dsh-rw/close-portal`, protocol §9.3). Both are
		* accepted only from this frame's window and the client GUI origin.
		*/
		/** Main-slot key for the full-screen official UI area. */
		const SERVER_MAIN_ID = "dsh-remote-workspace-server";
		/** Attribute placed on `<html>` while a portal frame is mounted. */
		const PORTAL_ACTIVE_ATTR = "data-dsh-rw-portal";
		/** The bound handlers; absent until `apply` runs. */
		let commandHandlers;
		/**
		* Bind the client-page command handlers.
		* @param handlers - the actions one accepted portal command dispatches.
		*/
		function bindPortalCommandHandlers(handlers) {
			commandHandlers = handlers;
		}
		let state$1 = { revision: 0 };
		const listeners$1 = /* @__PURE__ */ new Set();
		function commit$1(patch) {
			state$1 = {
				...state$1,
				...patch
			};
			for (const listener of listeners$1) listener();
		}
		function subscribe$1(listener) {
			listeners$1.add(listener);
			return () => {
				listeners$1.delete(listener);
			};
		}
		function snapshot$1() {
			return state$1;
		}
		/**
		* Open (or re-point) the full-screen official UI.
		*
		* Every call bumps {@link ServerMainState.revision}: a reconnect, a target
		* switch or an explicit retry must remount the iframe so the browser cannot
		* serve the previous profile's cached document.
		*/
		function openServerMain(request) {
			commit$1({
				request,
				revision: state$1.revision + 1,
				reportedSessionId: request.sessionId
			});
		}
		/** Tear the main area down (disconnect / target switch / plugin disposal). */
		function closeServerMain() {
			if (state$1.request === void 0) return;
			commit$1({
				request: void 0,
				reportedSessionId: void 0
			});
		}
		/** Read the panel request outside React. */
		function serverMainRequest() {
			return state$1.request;
		}
		/** Read the document's theme into the embed hint (best-effort, §9.3). */
		function documentTheme() {
			if (typeof document === "undefined") return "system";
			const root = document.documentElement;
			if (root.hasAttribute("data-ds-dark-theme")) return "dark";
			if (root.getAttribute("data-ds-theme") === "light") return "light";
			return "system";
		}
		/** Current UI language as the embed hint. */
		function documentLang() {
			if (typeof document !== "undefined" && document.documentElement.lang.startsWith("en")) return "en-US";
			return "zh-CN";
		}
		/** Hook: the panel request/snapshot. */
		function useServerMain() {
			return (0, react.useSyncExternalStore)(subscribe$1, snapshot$1, snapshot$1);
		}
		/** Hook: the current request, for the target rail's active highlight. */
		function useServerMainRequest() {
			return useServerMain().request;
		}
		/**
		* One iframe's lifecycle, kept as a thin adapter over the pure reducer.
		* @param request - current target/session request.
		* @returns frame state and the two user-recovery actions.
		*/
		function usePortalFrame(request) {
			const [frame, setFrame] = (0, react.useState)(IDLE_PORTAL_FRAME);
			const dispatch = (0, react.useCallback)((action) => {
				setFrame((previous) => portalFrameReducer(previous, action));
			}, []);
			(0, react.useEffect)(() => {
				if (request === void 0) {
					dispatch({ type: "clear" });
					return;
				}
				setFrame((previous) => portalFrameReducer(previous, {
					type: "open",
					targetId: request.targetId,
					...request.sessionId === void 0 ? {} : { sessionId: request.sessionId }
				}));
			}, [request?.targetId, dispatch]);
			return {
				frame,
				setFrame,
				retry: () => dispatch({ type: "retry" })
			};
		}
		/** How long the official UI may take to report readiness before we show an error. */
		const PORTAL_READY_TIMEOUT_MS = 2e4;
		/** The iframe + its loading/error chrome. */
		function ServerMainArea(props) {
			const { request } = props;
			const current = useServerMain();
			const { frame, setFrame, retry } = usePortalFrame(request);
			const iframeRef = (0, react.useRef)(null);
			const dispatchSelection = (0, react.useCallback)((sessionId) => {
				commit$1({ reportedSessionId: sessionId });
				setFrame((previous) => portalFrameReducer(previous, {
					type: "selection",
					...sessionId === void 0 ? {} : { sessionId }
				}));
			}, []);
			const expectedOrigin = typeof window === "undefined" ? "" : window.location.origin;
			const src = portalUrl({
				targetId: request.targetId,
				...request.sessionId === void 0 ? {} : { sessionId: request.sessionId },
				...request.workspaceId === void 0 ? {} : { workspaceId: request.workspaceId },
				theme: request.theme ?? documentTheme(),
				lang: request.lang ?? documentLang(),
				...expectedOrigin === "" ? {} : { parentOrigin: expectedOrigin },
				full: true
			});
			const storagePrefix = request.storagePrefix;
			(0, react.useEffect)(() => {
				if (typeof document === "undefined") return;
				document.documentElement.setAttribute(PORTAL_ACTIVE_ATTR, request.targetId);
				return () => {
					document.documentElement.removeAttribute(PORTAL_ACTIVE_ATTR);
				};
			}, [request.targetId]);
			(0, react.useEffect)(() => {
				if (typeof window === "undefined") return;
				const onMessage = (event) => {
					const iframe = iframeRef.current;
					if (iframe === null || event.source !== iframe.contentWindow) return;
					if (!isTrustedMessageOrigin(event.origin, expectedOrigin)) return;
					if (parseChildMessage(event.data) !== void 0) {
						setFrame((previous) => portalFrameReducer(previous, { type: "loaded" }));
						return;
					}
					const command = parseRwPortalCommand(event.data);
					if (command === void 0 || commandHandlers === void 0) return;
					switch (command.type) {
						case "dsh-rw/switch-target":
							commandHandlers.switchTarget(command.targetId);
							return;
						case "dsh-rw/open-connect-dialog":
							commandHandlers.openConnectDialog();
							return;
						case "dsh-rw/close-portal":
							commandHandlers.closePortal();
							return;
					}
				};
				window.addEventListener("message", onMessage);
				return () => window.removeEventListener("message", onMessage);
			}, [expectedOrigin]);
			(0, react.useEffect)(() => {
				if (frame.phase !== "loading") return;
				const timer = setTimeout(() => {
					setFrame((previous) => previous.phase === "loading" ? portalFrameReducer(previous, {
						type: "failed",
						error: {
							code: "portal-not-ready",
							message: t("portal.timeout", { label: request.targetLabel })
						}
					}) : previous);
				}, PORTAL_READY_TIMEOUT_MS);
				return () => clearTimeout(timer);
			}, [
				frame.phase,
				frame.reloadCount,
				current.revision,
				request.targetLabel,
				setFrame
			]);
			(0, react.useEffect)(() => {
				if (typeof window === "undefined" || storagePrefix === void 0 || storagePrefix === "") return;
				const onStorage = (event) => {
					if (event.storageArea !== window.localStorage) return;
					const selection = parseSelectionStorageEvent({
						key: event.key,
						newValue: event.newValue,
						url: event.url
					}, {
						targetId: request.targetId,
						storagePrefix
					});
					if (selection === void 0) return;
					dispatchSelection(selection.sessionId);
				};
				window.addEventListener("storage", onStorage);
				return () => window.removeEventListener("storage", onStorage);
			}, [
				request.targetId,
				storagePrefix,
				dispatchSelection
			]);
			const failed = frame.phase === "error";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-portal",
				"data-target": request.targetId,
				"data-phase": frame.phase,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
						ref: iframeRef,
						className: "dsh-rw-portal-frame",
						title: t("portal.title", { label: request.targetLabel }),
						src,
						sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads",
						allow: "clipboard-read; clipboard-write",
						referrerPolicy: "no-referrer",
						onLoad: () => setFrame((previous) => portalFrameReducer(previous, { type: "loaded" }))
					}, `${request.targetId}:${current.revision}:${frame.reloadCount}`),
					frame.phase === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-rw-portal-status",
						role: "status",
						"aria-live": "polite",
						children: t("portal.loading", { label: request.targetLabel })
					}),
					failed && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-rw-portal-error",
						role: "alert",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningTriangleOutlineRegular, { size: 18 }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-rw-portal-error-text",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("portal.failed", { label: request.targetLabel }) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: frame.error?.message ?? t("portal.failedUnknown") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("portal.failedHint") })
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 12 }),
								onClick: retry,
								children: t("common.retry")
							})
						]
					})
				]
			});
		}
		/**
		* The main-slot entry: renders the current request, or nothing.
		*
		* The frame is portalled to `document.body` so the official UI covers the
		* whole client window (the shell sidebar included) — v3 is "the client becomes
		* the server UI", not a panel inside the client's own layout.
		*/
		function ServerMainPanel() {
			const current = useServerMain();
			if (current.request === void 0) return null;
			const area = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ServerMainArea, { request: current.request });
			if (typeof document === "undefined") return area;
			return (0, react_dom.createPortal)(area, document.body);
		}
		/** Public action for the rail: close the server area and return to chat. */
		function closeServerMainPanel() {
			closeServerMain();
		}
		//#endregion
		//#region src/client/remote-store.ts
		/**
		* The v3 client's connection model: targets, their live phase, the connect /
		* stop / forget verbs and the full-screen portal deep link.
		*
		* The official UI owns every workspace and session surface now, so this store
		* keeps only what the connection panel and the dialogs need: the target order,
		* one view per target, the connect dialog, the forget confirmation and the
		* notice toast. Every verb is one host route; nothing here caches server data
		* beyond the snapshot the portal deep link and the panel rows read.
		*/
		function emptyLoad() {
			return {
				loading: false,
				loaded: false
			};
		}
		function initialState() {
			return {
				loaded: false,
				loading: false,
				pluginVersion: "",
				order: [],
				connections: {},
				pending: false
			};
		}
		let state = initialState();
		const listeners = /* @__PURE__ */ new Set();
		let clientContext;
		function commit(patch) {
			state = {
				...state,
				...patch
			};
			for (const listener of listeners) listener();
		}
		function subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
		function snapshot() {
			return state;
		}
		/** Snapshot hook for the connection panel and the dialogs. */
		function useRemoteAppState() {
			return (0, react.useSyncExternalStore)(subscribe, snapshot, snapshot);
		}
		/** One writable view (the snapshot's entries are readonly). */
		function patchConnection(targetId, patch) {
			const current = state.connections[targetId];
			if (current === void 0) return;
			commit({ connections: {
				...state.connections,
				[targetId]: {
					...current,
					...patch
				}
			} });
		}
		/** Build the initial view for one target. */
		function viewFor(target, connection, workspaces, sessions) {
			return {
				target,
				...connection === void 0 ? {} : { connection },
				...workspaces === void 0 ? {} : { workspaces },
				...sessions === void 0 ? {} : { sessions },
				stateLoad: {
					loading: false,
					loaded: connection !== void 0
				},
				sessionsLoad: sessions === void 0 ? emptyLoad() : {
					loading: false,
					loaded: true
				},
				...connection?.error === void 0 ? {} : { error: connection.error }
			};
		}
		function notify(kind, text) {
			commit({ notice: {
				kind,
				text
			} });
		}
		function describe(error) {
			return toWireError(error);
		}
		/**
		* One actionable sentence for a failed verb.
		*
		* The host sends stable codes; the generic fallback keeps the scrubbed server
		* message.
		*/
		function describeFailure(error) {
			const wire = describe(error);
			switch (wire.code) {
				case "profile-locked":
				case "profile-in-use": return t("remote.error.profileLocked");
				case "tunnel-unavailable":
				case "target-not-connected": return t("remote.error.tunnel");
				case "runtime-confirmation-required": return t("remote.error.runtimeConfirmRequired");
				case "runtime-incompatible": return t("remote.error.runtimeIncompatible");
				case "plugin-missing": return t("remote.error.pluginMissing");
				case "plugin-protocol-mismatch": return t("remote.error.pluginProtocol");
				case "profile-start-failed":
				case "profile-start-timeout": return t("remote.error.profileStart");
				case "bootstrap-timeout": return t("remote.error.bootstrap");
				case "plugin-install-confirmation-required": return t("remote.deploy.pluginConfirmRequired");
				case "plugin-profile-not-managed": return t("remote.deploy.pluginNotManaged");
				case "runtime-global-unsupported": return t("remote.deploy.globalUnsupported");
				case "deployment-confirmation-required": return t("remote.error.runtimeConfirmRequired");
				default: return wire.message;
			}
		}
		/**
		* A per-target list value; the host substitutes `{ error }` for a failed read.
		* The rest of the client consumes only real lists, so failures degrade to
		* "nothing loaded" and the connection's own error stays visible.
		*/
		function readableList(value) {
			if (value === void 0 || value === null || typeof value !== "object") return void 0;
			return "error" in value ? void 0 : value;
		}
		/** First-paint load: targets, connection states and workspace lists. */
		async function loadRemoteState() {
			if (state.loading) return;
			commit({
				loading: true,
				error: void 0
			});
			try {
				const value = await remoteApi.state();
				const connections = {};
				const order = [];
				for (const target of value.targets) {
					order.push(target.id);
					connections[target.id] = viewFor(target, value.connections[target.id], readableList(value.workspaces[target.id]), readableList(value.sessions?.[target.id]));
				}
				commit({
					loaded: true,
					loading: false,
					pluginVersion: value.pluginVersion,
					platform: value.platform,
					order,
					connections
				});
				for (const target of value.targets) {
					const phase = value.connections[target.id]?.phase;
					if ((phase === "ready" || phase === "degraded") && readableList(value.sessions?.[target.id]) === void 0) loadRemoteSessions(target.id);
				}
			} catch (error) {
				commit({
					loading: false,
					loaded: true,
					error: describe(error)
				});
			}
		}
		/** Read every connected target again (the rail's refresh button). */
		async function refreshAllRemote() {
			const targets = state.order.filter((targetId) => {
				const view = state.connections[targetId];
				return view?.connection?.phase === "ready" || view?.connection?.phase === "degraded";
			});
			await Promise.all(targets.map((targetId) => refreshRemoteTarget(targetId)));
		}
		/** Merge one `state/refresh` value into a connection view. */
		function mergeRefresh(targetId, value) {
			const current = state.connections[targetId];
			if (current === void 0) return;
			if (value.connection !== void 0 && value.connection.phase !== "ready" && current.connection?.phase === "ready") releaseTarget(targetId);
			patchConnection(targetId, {
				...value.connection === void 0 ? {} : { connection: value.connection },
				workspaces: value.workspaces,
				sessions: value.sessions,
				stateLoad: {
					loading: false,
					loaded: true
				},
				...value.connection?.error === void 0 ? {} : { error: value.connection.error }
			});
		}
		/** Light refresh of one target; never restarts the profile (protocol §16.3). */
		async function refreshRemoteTarget(targetId) {
			const current = state.connections[targetId];
			if (current === void 0 || current.stateLoad.loading) return;
			if (current.connection?.phase !== "ready" && current.connection?.phase !== "degraded") return;
			patchConnection(targetId, { stateLoad: {
				...current.stateLoad,
				loading: true
			} });
			try {
				mergeRefresh(targetId, await remoteApi.stateRefresh(targetId));
			} catch (error) {
				patchConnection(targetId, {
					stateLoad: {
						loading: false,
						loaded: true,
						error: describe(error)
					},
					error: describe(error)
				});
			}
		}
		/** Load the full session list for one target on demand. */
		async function loadRemoteSessions(targetId, force = false) {
			const current = state.connections[targetId];
			if (current === void 0) return;
			if (current.connection?.phase !== "ready" && current.connection?.phase !== "degraded") return;
			if (current.sessionsLoad.loading || current.sessionsLoad.loaded && !force) return;
			patchConnection(targetId, { sessionsLoad: {
				...current.sessionsLoad,
				loading: true
			} });
			try {
				patchConnection(targetId, {
					sessions: await remoteApi.sessions(targetId),
					sessionsLoad: {
						loading: false,
						loaded: true
					}
				});
			} catch (error) {
				patchConnection(targetId, { sessionsLoad: {
					loading: false,
					loaded: true,
					error: describe(error)
				} });
			}
		}
		/**
		* A user-initiated connect must not hang the row forever. Reconnect can also
		* trigger the one-time isolated-runtime build/upload, which is much slower than
		* an ordinary profile start, so the safety net is generous.
		*/
		const CONNECT_TIMEOUT_MS = 6e5;
		/** Settle with the connect promise, or reject with a readable timeout. */
		async function reconnectWithTimeout(targetId, attemptId) {
			let timer;
			try {
				await Promise.race([remoteApi.reconnect(targetId, attemptId === void 0 ? {} : { attemptId }), new Promise((_resolve, reject) => {
					timer = setTimeout(() => {
						reject(new Error(t("remote.connect.timeout")));
					}, CONNECT_TIMEOUT_MS);
				})]);
			} finally {
				if (timer !== void 0) clearTimeout(timer);
			}
		}
		/** Whether the host reports a live profile for a view (ready or degraded). */
		function connectionIsLive(view) {
			const phase = view.connection?.phase;
			return phase === "ready" || phase === "degraded";
		}
		/**
		* Ask the official layout to show one panel id (`null` = the conversation).
		* @param id - a `main` slot key, or `null` for the shell's own conversation.
		*/
		function selectPanel(id) {
			try {
				(clientContext?.get("layout"))?.selectPanel?.(id);
			} catch (error) {
				console.error("[dsh-remote-workspace] layout.selectPanel failed", error);
			}
		}
		/**
		* Close the full-screen official UI when it currently shows one target.
		*
		* Called from every path that makes a target unusable (disconnect, forget,
		* connection lost): the frame must never keep showing a profile the host has
		* already stopped.
		* @param targetId - target whose frame must be torn down.
		*/
		function closePortalFor(targetId) {
			if (serverMainRequest()?.targetId !== targetId) return;
			closeServerMainPanel();
		}
		/**
		* The session the full-screen official UI should open on its first load.
		*
		* A bare portal boot lands on the official first-run composer seat ("选择一个
		* 工作区开始"), which inside an iframe cannot recover, so the client always
		* deep-links one session (`dshRwSession`). The most recent conversation wins;
		* when the profile has none yet the client creates the workspace's blank
		* session through the host bridge.
		* @param targetId - connected target.
		* @param view - that target's loaded connection view.
		* @returns the session id to embed, or undefined when none can be resolved.
		*/
		async function portalSessionFor(targetId, view) {
			const conversation = [...view.sessions?.sessions ?? []].filter((row) => !row.blank && row.archived !== true && row.origin !== "subagent").sort((left, right) => right.updatedAt - left.updatedAt)[0];
			if (conversation !== void 0) return conversation.sessionId;
			const workspaceId = view.workspaces?.workspaces[0]?.workspaceId;
			if (workspaceId === void 0) return void 0;
			try {
				return (await remoteApi.sessionCreate({
					targetId,
					workspaceId
				})).sessionId;
			} catch {
				return;
			}
		}
		/**
		* Activate one saved target.
		*
		* The rail's single verb: a stopped target starts its profile and opens the
		* full-screen official UI once it is ready; a live target just (re)mounts the
		* frame. Re-activating the already active target is a no-op so a stray click
		* cannot reload the conversation under the user.
		* @param targetId - saved target id.
		*/
		async function activateRemoteTarget(targetId) {
			const view = state.connections[targetId];
			if (view === void 0 || view.connecting === true) return;
			if (!connectionIsLive(view)) {
				await connectRemoteTarget(targetId);
				return;
			}
			if (serverMainRequest()?.targetId === targetId) return;
			const sessionId = await portalSessionFor(targetId, view);
			if (serverMainRequest()?.targetId === targetId) return;
			closePortalFor(targetId);
			openServerMain({
				targetId,
				targetLabel: view.target.label,
				...sessionId === void 0 ? {} : { sessionId },
				...view.connection?.embed?.storagePrefix === void 0 ? {} : { storagePrefix: view.connection.embed.storagePrefix },
				...view.connection?.embed?.mode === void 0 ? {} : { embedMode: view.connection.embed.mode }
			});
			selectPanel(SERVER_MAIN_ID);
		}
		/**
		* Switch the full-screen official UI to another saved target.
		*
		* This is the `dsh-rw/switch-target` handler used by the mirrored server-side
		* connection list. An unknown target, the already active target, and a pending
		* verb are no-ops; a failed switch leaves the current frame mounted and only
		* reports the failure, so the user keeps the conversation they were reading.
		* @param targetId - the target the embedded UI asked for.
		*/
		async function switchRemoteTarget(targetId) {
			const view = state.connections[targetId];
			if (view === void 0 || state.pending || view.connecting === true) return;
			if (serverMainRequest()?.targetId === targetId) return;
			try {
				await activateRemoteTarget(targetId);
			} catch (error) {
				notify("error", t("remote.connect.failed", { message: describeFailure(error) }));
			}
		}
		/** A fresh id for one connect attempt (progress polling keys on it). */
		function newAttemptId() {
			return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `connect-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
		}
		/**
		* Connect one saved target and show the progress dialog for the attempt.
		*
		* A connect is slow (runtime/plugin deployment on a cold host), so it must not
		* be a silent row spinner: the dialog opens on its progress step with the same
		* step rows a first connection shows, and closes itself once the official UI
		* opens. Failures stay in the dialog with a retry button.
		* @param targetId - saved target id.
		*/
		async function connectRemoteTarget(targetId) {
			const view = state.connections[targetId];
			if (view === void 0 || view.connecting === true) return;
			const attemptId = newAttemptId();
			commit({ connectDialog: {
				phase: "submitting",
				reconnectTargetId: targetId,
				attemptId,
				label: view.target.label,
				host: view.target.host,
				port: String(view.target.port),
				username: view.target.username,
				authKind: "agent",
				secret: "",
				privateKeyPath: "",
				dshHome: "",
				runtimePolicy: "auto",
				modelSource: "local"
			} });
			await runReconnectAttempt(targetId, attemptId);
		}
		/**
		* Retry the reconnect the progress dialog is currently showing.
		*
		* Failed attempts keep the dialog open; retrying starts a fresh host attempt
		* with a new id so the progress buffer starts empty.
		*/
		async function retryReconnectTarget() {
			const dialog = state.connectDialog;
			const targetId = dialog?.reconnectTargetId;
			if (dialog === void 0 || targetId === void 0 || dialog.phase === "submitting") return;
			const attemptId = newAttemptId();
			commit({ connectDialog: {
				...dialog,
				phase: "submitting",
				attemptId,
				error: void 0
			} });
			await runReconnectAttempt(targetId, attemptId);
		}
		/** One reconnect attempt: host call, progress dialog lifecycle, activation. */
		async function runReconnectAttempt(targetId, attemptId) {
			const view = state.connections[targetId];
			if (view === void 0) return;
			patchConnection(targetId, {
				connecting: true,
				connectFailed: false,
				error: void 0
			});
			commit({ pending: true });
			try {
				await reconnectWithTimeout(targetId, attemptId);
				patchConnection(targetId, { connecting: false });
				if (state.connectDialog?.attemptId === attemptId) commit({ connectDialog: void 0 });
				notify("success", t("remote.connect.done", { label: view.target.label }));
				await loadRemoteState();
				await loadRemoteSessions(targetId, true);
				await activateRemoteTarget(targetId);
			} catch (error) {
				await refreshRemoteTarget(targetId).catch(() => void 0);
				patchConnection(targetId, {
					connecting: false,
					connectFailed: true,
					error: describe(error)
				});
				const wire = describe(error);
				const dialog = state.connectDialog;
				if (dialog?.attemptId === attemptId) commit({ connectDialog: {
					...dialog,
					phase: "failed",
					error: {
						code: wire.code,
						message: describeFailure(error)
					}
				} });
				notify("error", t("remote.connect.failed", { message: describeFailure(error) }));
			} finally {
				patchConnection(targetId, { connecting: false });
				commit({ pending: false });
			}
		}
		/** Stop one target's profile and drop its portal. */
		async function disconnectRemoteTarget(targetId) {
			commit({ pending: true });
			try {
				await remoteApi.stop(targetId);
				releaseTarget(targetId);
				await loadRemoteState();
			} catch (error) {
				patchConnection(targetId, { error: describe(error) });
			} finally {
				commit({ pending: false });
			}
		}
		/** Ask before forgetting a connection (destructive). */
		function requestForgetTarget(targetId) {
			const view = state.connections[targetId];
			if (view === void 0) return;
			commit({ forgetTarget: {
				targetId,
				label: view.target.label
			} });
		}
		function closeForgetTarget() {
			commit({ forgetTarget: void 0 });
		}
		/** Forget one connection after the dialog. */
		async function submitForgetTarget() {
			const request = state.forgetTarget;
			if (request === void 0) return;
			commit({ pending: true });
			try {
				await remoteApi.forget(request.targetId);
				releaseTarget(request.targetId);
				commit({ forgetTarget: void 0 });
				notify("success", t("list.forgotTarget", { label: request.label }));
				await loadRemoteState();
			} catch (error) {
				notify("error", t("remote.verb.failed", {
					action: t("tree.forgetConnection"),
					message: describeFailure(error)
				}));
			} finally {
				commit({ pending: false });
			}
		}
		/** Open (or reset) the connection dialog. */
		function openConnectDialog() {
			commit({ connectDialog: {
				phase: "idle",
				label: "",
				host: "",
				port: "22",
				username: "",
				authKind: "password",
				secret: "",
				privateKeyPath: "",
				dshHome: "",
				runtimePolicy: "auto",
				modelSource: "local"
			} });
		}
		/** Close the connection dialog and drop its secret. */
		function closeConnectDialog() {
			commit({ connectDialog: void 0 });
		}
		/** Patch one field of the connect dialog. */
		function patchConnectDialog(patch) {
			const current = state.connectDialog;
			if (current === void 0) return;
			commit({ connectDialog: {
				...current,
				...patch,
				error: void 0
			} });
		}
		/**
		* Submit the connection request.
		*
		* A first unknown host key returns `host-key-unknown` with a fingerprint; the
		* dialog shows the SHA-256 and only a second submit (with that fingerprint)
		* trusts it. `host-key-changed` is terminal: the pinned identity no longer
		* matches and there is no retry.
		*/
		async function submitConnectDialog() {
			const dialog = state.connectDialog;
			if (dialog === void 0 || dialog.phase === "submitting") return;
			const label = dialog.label.trim();
			const host = dialog.host.trim();
			const username = dialog.username.trim();
			const port = Number(dialog.port.trim());
			const invalid = label === "" ? {
				code: "invalid",
				message: t("remote.connect.labelRequired")
			} : host === "" ? {
				code: "invalid",
				message: t("remote.connect.hostRequired")
			} : !Number.isInteger(port) || port < 1 || port > 65535 ? {
				code: "invalid",
				message: t("remote.connect.portInvalid")
			} : username === "" ? {
				code: "invalid",
				message: t("remote.connect.userRequired")
			} : dialog.authKind === "password" && dialog.secret === "" && dialog.fingerprint === void 0 ? {
				code: "invalid",
				message: t("remote.connect.secretRequired")
			} : dialog.authKind === "privateKey" && dialog.privateKeyPath.trim() === "" ? {
				code: "invalid",
				message: t("remote.connect.keyRequired")
			} : void 0;
			if (invalid !== void 0) {
				commit({ connectDialog: {
					...dialog,
					error: invalid
				} });
				return;
			}
			const attemptId = newAttemptId();
			commit({ connectDialog: {
				...dialog,
				phase: "submitting",
				attemptId,
				error: void 0
			} });
			try {
				const connected = await remoteApi.connectV1({
					label,
					host,
					port,
					username,
					authKind: dialog.authKind,
					...dialog.secret === "" ? {} : { secret: dialog.secret },
					...dialog.authKind === "privateKey" && dialog.privateKeyPath.trim() !== "" ? { privateKeyPath: dialog.privateKeyPath.trim() } : {},
					...dialog.dshHome.trim() === "" ? {} : { dshHome: dialog.dshHome.trim() },
					runtimePolicy: dialog.runtimePolicy,
					modelSource: dialog.modelSource,
					attemptId,
					...dialog.fingerprint === void 0 ? {} : { hostKeyFingerprint: dialog.fingerprint }
				});
				commit({ connectDialog: void 0 });
				notify("success", t("remote.connect.done", { label }));
				await loadRemoteState();
				await activateRemoteTarget(connected.target.id);
			} catch (error) {
				const wire = describe(error);
				if (error instanceof RemoteApiError && error.code === "host-key-unknown") {
					const details = error.details;
					const fingerprint = details !== null && typeof details === "object" ? details.fingerprint : void 0;
					commit({ connectDialog: {
						...dialog,
						phase: "hostkey",
						attemptId,
						secret: dialog.authKind === "password" ? dialog.secret : "",
						...typeof fingerprint === "string" ? { fingerprint } : {},
						error: void 0
					} });
					return;
				}
				commit({ connectDialog: {
					...dialog,
					phase: "failed",
					attemptId,
					error: {
						code: wire.code,
						message: describeFailure(error)
					}
				} });
			}
		}
		function dismissRemoteNotice() {
			commit({ notice: void 0 });
		}
		/** Called when a connection leaves ready: drop its portal and cached rows. */
		function releaseTarget(targetId) {
			closePortalFor(targetId);
			patchConnection(targetId, {
				...state.connections[targetId]?.connection === void 0 ? {} : { connection: {
					...state.connections[targetId].connection,
					phase: "stopped",
					error: void 0
				} },
				connecting: false,
				connectFailed: false,
				error: void 0,
				sessions: void 0,
				sessionsLoad: {
					loading: false,
					loaded: false
				}
			});
		}
		/** Bind the client context; called once from `apply`. */
		function bindRemoteStoreContext(ctx) {
			clientContext = ctx;
		}
		/** Dispose the store's context binding (hot reload). */
		function disposeRemoteStore() {
			clientContext = void 0;
		}
		//#endregion
		//#region src/client/remote-dialogs.tsx
		/**
		* The v3 connection dialogs, hosted by the floating target rail.
		*
		* Two surfaces remain: the three-step SSH connect form (method → config →
		* connect, with the host-key confirmation on the last step) and the forget
		* confirmation. Everything else — workspaces, sessions, mode switching — is
		* owned by the server's official UI inside the portal iframe.
		*/
		const CONNECT_STEPS = [
			"method",
			"config",
			"connect"
		];
		const CONNECT_STEP_LABELS = {
			method: "step.label.method",
			config: "step.label.config",
			connect: "step.label.connect"
		};
		const PROGRESS_STEPS = [
			"connect",
			"probe",
			"runtime",
			"upload",
			"start"
		];
		const PROGRESS_LABELS = {
			connect: "connect.step.connect",
			probe: "connect.step.probe",
			runtime: "connect.step.runtime",
			upload: "connect.step.upload",
			start: "connect.step.start"
		};
		const PROGRESS_STATUS = {
			pending: "connect.status.pending",
			running: "connect.status.running",
			ok: "connect.status.ok",
			skipped: "connect.status.skipped",
			failed: "connect.status.failed"
		};
		/**
		* The body of one progress row.
		*
		* A host event may carry pre-split `details` (the probe reports six separate
		* observations: environment, Node, global DSH, DSH_HOME, runtime, plugin).
		* Rendering them as one span per fact keeps the row readable instead of letting
		* one long sentence wrap wherever the dialog's width happens to land.
		* @param props - the progress event to render.
		* @returns the detail list, the single message line, or nothing.
		*/
		function ProgressDetail(props) {
			const { event } = props;
			const details = event.details ?? [];
			if (details.length > 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dsh-rw-progress-lines",
				"data-testid": "dsh-rw-progress-details",
				children: details.map((line, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-rw-progress-line",
					children: line
				}, `${index}:${line}`))
			});
			return event.message === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dsh-rw-progress-message",
				children: event.message
			});
		}
		/**
		* Method-card copy, keyed by the pure module's offered-method ids.
		*
		* The card list itself comes from {@link offeredMethods} — the same predicate
		* the host validates — so a method only appears when its transport exists
		* (`methodAvailable`). WSL keeps its translated copy here so the day
		* `WSL_TRANSPORT_ENABLED` flips the card renders a real label instead of a raw
		* key; the config step below is SSH-only and must grow WSL fields before that
		* flip adds it to `OFFERED_METHODS`.
		*/
		const METHOD_CARD_COPY = {
			ssh: {
				name: "method.ssh.name",
				description: "method.ssh.description",
				aria: "method.ssh.aria"
			},
			wsl: {
				name: "method.wsl.name",
				description: "method.wsl.description",
				aria: "method.wsl.aria"
			}
		};
		/** Id of the datalist that offers the private keys found under `~/.ssh`. */
		const SSH_KEY_LIST_ID = "dsh-rw-ssh-key-options";
		function ConnectDialog(props) {
			const dialog = props.state.connectDialog;
			const [step, setStep] = (0, react.useState)("method");
			const [aliases, setAliases] = (0, react.useState)([]);
			const [aliasWarnings, setAliasWarnings] = (0, react.useState)([]);
			const [aliasesLoading, setAliasesLoading] = (0, react.useState)(false);
			const [aliasesLoaded, setAliasesLoaded] = (0, react.useState)(false);
			const [sshKeyOptions, setSshKeyOptions] = (0, react.useState)([]);
			const [sshKeysLoaded, setSshKeysLoaded] = (0, react.useState)(false);
			const [aliasChoice, setAliasChoice] = (0, react.useState)("");
			const [configError, setConfigError] = (0, react.useState)(void 0);
			const [advancedOpen, setAdvancedOpen] = (0, react.useState)(false);
			const [progress, setProgress] = (0, react.useState)([]);
			/** Re-render once a second while the connect attempt is running. */
			const [elapsedSeconds, setElapsedSeconds] = (0, react.useState)(0);
			const [progressReadError, setProgressReadError] = (0, react.useState)(void 0);
			const startedAt = (0, react.useRef)(void 0);
			const progressFailures = (0, react.useRef)(0);
			(0, react.useEffect)(() => {
				if (props.state.connectDialog?.phase === "hostkey") setStep("connect");
			}, [props.state.connectDialog?.phase]);
			(0, react.useEffect)(() => {
				if (step !== "config" || aliasesLoaded || aliasesLoading) return;
				setAliasesLoading(true);
				api.sshAliases().then((result) => {
					setAliases(result.aliases);
					setAliasWarnings(result.warnings);
					setAliasesLoaded(true);
				}).catch(() => {
					setAliasesLoaded(true);
				}).finally(() => {
					setAliasesLoading(false);
				});
			}, [
				step,
				aliasesLoaded,
				aliasesLoading
			]);
			(0, react.useEffect)(() => {
				if (step !== "config" || dialog?.authKind !== "privateKey" || sshKeysLoaded) return;
				api.sshKeys().then((result) => {
					setSshKeyOptions(result.keys);
					setSshKeysLoaded(true);
				}).catch(() => {
					setSshKeysLoaded(true);
				});
			}, [
				step,
				dialog?.authKind,
				sshKeysLoaded
			]);
			(0, react.useEffect)(() => {
				if (step !== "connect") return;
				if (props.state.connectDialog?.phase !== "idle") return;
				submitConnectDialog();
			}, [step, props.state.connectDialog?.phase]);
			const attemptId = props.state.connectDialog?.attemptId;
			const submitting = props.state.connectDialog?.phase === "submitting";
			(0, react.useEffect)(() => {
				progressFailures.current = 0;
				setProgressReadError(void 0);
				setElapsedSeconds(0);
				if (attemptId === void 0) {
					startedAt.current = void 0;
					setProgress([]);
					return;
				}
				startedAt.current = Date.now();
				let stopped = false;
				const tick = async () => {
					try {
						const result = await remoteApi.connectProgress(attemptId);
						if (stopped) return;
						progressFailures.current = 0;
						setProgressReadError(void 0);
						setProgress(result.events);
					} catch (error) {
						if (stopped) return;
						progressFailures.current += 1;
						if (progressFailures.current >= 3) setProgressReadError(t("connect.progress.readFailed", { message: error instanceof Error ? error.message : String(error) }));
					}
				};
				setProgress([]);
				tick();
				const timer = setInterval(() => {
					tick();
				}, 300);
				return () => {
					stopped = true;
					clearInterval(timer);
				};
			}, [attemptId]);
			(0, react.useEffect)(() => {
				if (!submitting || attemptId === void 0) {
					setElapsedSeconds(0);
					return;
				}
				const timer = setInterval(() => {
					if (startedAt.current === void 0) return;
					setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt.current) / 1e3)));
				}, 1e3);
				return () => clearInterval(timer);
			}, [submitting, attemptId]);
			if (dialog === void 0) return null;
			const reconnect = dialog.reconnectTargetId !== void 0;
			const current = reconnect || dialog.phase === "hostkey" ? "connect" : step;
			const currentIndex = CONNECT_STEPS.indexOf(current);
			const hostKey = dialog.phase === "hostkey" && dialog.fingerprint !== void 0;
			const patch = (value) => {
				setConfigError(void 0);
				patchConnectDialog(value);
			};
			const validateConfig = () => {
				if (dialog.label.trim() === "") return t("remote.connect.labelRequired");
				if (dialog.host.trim() === "") return t("remote.connect.hostRequired");
				const port = Number(dialog.port.trim());
				if (!Number.isInteger(port) || port < 1 || port > 65535) return t("remote.connect.portInvalid");
				if (dialog.username.trim() === "") return t("remote.connect.userRequired");
				if (dialog.authKind === "password" && dialog.secret === "") return t("remote.connect.secretRequired");
				if (dialog.authKind === "privateKey" && dialog.privateKeyPath.trim() === "") return t("remote.connect.keyRequired");
			};
			const primaryLabel = current !== "connect" ? t("remote.connect.next") : submitting ? t("remote.connect.submitting") : hostKey ? t("remote.connect.hostkeyTrust") : dialog.phase === "failed" ? t("remote.connect.retry") : t("remote.connect.submit");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: closeConnectDialog,
				title: reconnect ? t("remote.connect.reconnectTitle", { label: dialog.label }) : t("remote.connect.title"),
				className: "dsh-rw-connect-modal",
				closeLabel: t("remote.dialog.cancel"),
				footer: reconnect ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-rw-footer-actions",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-rw-footer-group",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "ghost",
							onClick: closeConnectDialog,
							disabled: submitting,
							children: t("remote.dialog.cancel")
						})
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsh-rw-footer-group",
						children: [submitting && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-rw-connect-elapsed",
							"data-testid": "dsh-rw-connect-elapsed",
							role: "status",
							children: t("connect.progress.elapsed", { seconds: elapsedSeconds })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							onClick: () => {
								retryReconnectTarget();
							},
							disabled: submitting || dialog.phase !== "failed",
							children: dialog.phase === "failed" ? t("remote.connect.retry") : t("remote.connect.submitting")
						})]
					})]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-rw-footer-actions",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsh-rw-footer-group",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "ghost",
							onClick: closeConnectDialog,
							disabled: submitting,
							children: t("remote.dialog.cancel")
						}), current !== "method" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							onClick: () => {
								setStep(CONNECT_STEPS[currentIndex - 1]);
							},
							disabled: submitting,
							children: t("remote.connect.back")
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsh-rw-footer-group",
						children: [submitting && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-rw-connect-elapsed",
							"data-testid": "dsh-rw-connect-elapsed",
							role: "status",
							children: t("connect.progress.elapsed", { seconds: elapsedSeconds })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							onClick: () => {
								if (current === "connect") {
									submitConnectDialog();
									return;
								}
								if (current === "config") {
									const invalid = validateConfig();
									if (invalid !== void 0) {
										setConfigError(invalid);
										return;
									}
								}
								setStep(CONNECT_STEPS[currentIndex + 1]);
							},
							disabled: submitting || current === "connect" && dialog.phase === "idle",
							children: primaryLabel
						})]
					})]
				}),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsh-rw-connect-dialog",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-rw-connect-layout",
						"data-reconnect": reconnect ? "true" : void 0,
						children: [!reconnect && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("nav", {
							className: "dsh-rw-connect-stepnav",
							"aria-label": t("wizard.steps.aria"),
							children: CONNECT_STEPS.map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "dsh-rw-connect-stepnav-item",
								"data-active": item === current ? "true" : void 0,
								"data-done": index < currentIndex ? "true" : void 0,
								disabled: submitting || index > currentIndex,
								onClick: () => {
									setStep(item);
								},
								title: index < currentIndex ? t("step.goBackTo", { label: t(CONNECT_STEP_LABELS[item]) }) : void 0,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-rw-connect-stepnav-index",
									children: index + 1
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-rw-connect-stepnav-label",
									children: t(CONNECT_STEP_LABELS[item])
								})]
							}, item))
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-rw-connect-stepbody",
							children: [
								current === "method" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
											children: offeredMethods(props.state.platform ?? "").map((method) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: "dsh-rw-method",
												"data-selected": method === "ssh" ? "true" : void 0,
												"aria-pressed": method === "ssh",
												"aria-label": t(METHOD_CARD_COPY[method].aria),
												onClick: () => {
													setStep("config");
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dsh-rw-method-name",
													children: t(METHOD_CARD_COPY[method].name)
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dsh-rw-method-description",
													children: t(METHOD_CARD_COPY[method].description)
												})]
											}, method))
										})
									]
								}),
								current === "config" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-rw-section",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
											className: "dsh-rw-section-title",
											children: t("connect.config.title")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Field, {
											label: t("remote.connect.sshAlias"),
											hint: aliasesLoading ? t("remote.connect.sshAlias.loading") : aliasesLoaded && aliases.length === 0 ? t("remote.connect.sshAlias.empty") : t("remote.connect.sshAlias.hint"),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsh-rw-inline dsh-rw-ssh-alias-row",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
													className: "dsh-rw-rename-input",
													value: aliasChoice,
													disabled: submitting || aliasesLoading,
													onChange: (event) => {
														const value = event.target.value;
														setAliasChoice(value);
														const alias = aliases.find((candidate) => candidate.alias === value);
														if (alias === void 0) return;
														patch({
															label: dialog.label.trim() === "" ? alias.alias : dialog.label,
															host: alias.hostName ?? "",
															port: String(alias.port ?? 22),
															...alias.user === void 0 ? {} : { username: alias.user },
															...alias.identityFile === void 0 ? {} : { privateKeyPath: alias.identityFile }
														});
													},
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
														value: "",
														children: t("remote.connect.sshAlias.manual")
													}), aliases.map((alias) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
														value: alias.alias,
														children: `${alias.alias}${alias.hostName === void 0 ? "" : ` — ${alias.user === void 0 ? "" : `${alias.user}@`}${alias.hostName}${alias.port === void 0 ? "" : `:${alias.port}`}`}`
													}, alias.alias))]
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
													variant: "outline",
													size: "sm",
													disabled: aliasesLoading,
													onClick: () => {
														setAliasesLoaded(false);
														setAliasesLoading(true);
														api.sshAliases().then((result) => {
															setAliases(result.aliases);
															setAliasWarnings(result.warnings);
														}).catch(() => {}).finally(() => {
															setAliasesLoaded(true);
															setAliasesLoading(false);
														});
													},
													children: t("remote.connect.sshAlias.refresh")
												})]
											}), aliasWarnings.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsh-rw-hint",
												children: t("remote.connect.sshAlias.warning", { count: aliasWarnings.length })
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
											label: t("remote.connect.label"),
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												className: "dsh-rw-rename-input",
												value: dialog.label,
												disabled: submitting,
												placeholder: t("remote.connect.labelPlaceholder"),
												onChange: (event) => patch({ label: event.target.value })
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-rw-connect-grid",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
													label: t("remote.connect.host"),
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														className: "dsh-rw-rename-input",
														value: dialog.host,
														disabled: submitting,
														placeholder: "203.0.113.10",
														onChange: (event) => patch({ host: event.target.value })
													})
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
													label: t("remote.connect.port"),
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														className: "dsh-rw-rename-input",
														value: dialog.port,
														disabled: submitting,
														inputMode: "numeric",
														onChange: (event) => patch({ port: event.target.value })
													})
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
													label: t("remote.connect.username"),
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														className: "dsh-rw-rename-input",
														value: dialog.username,
														disabled: submitting,
														placeholder: "tester",
														onChange: (event) => patch({ username: event.target.value })
													})
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
											label: t("remote.connect.authKind"),
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SegmentedControl, {
												id: "dsh-rw-connect-auth",
												value: dialog.authKind,
												disabled: submitting,
												label: t("remote.connect.authKind"),
												options: [
													{
														value: "password",
														label: t("remote.connect.auth.password")
													},
													{
														value: "privateKey",
														label: t("remote.connect.auth.privateKey")
													},
													{
														value: "agent",
														label: t("remote.connect.auth.agent")
													}
												],
												onChange: (next) => patch({ authKind: next })
											})
										}),
										dialog.authKind === "password" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
											label: t("remote.connect.secret"),
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												className: "dsh-rw-rename-input",
												type: "password",
												value: dialog.secret,
												disabled: submitting,
												autoComplete: "off",
												onChange: (event) => patch({ secret: event.target.value })
											})
										}),
										dialog.authKind === "privateKey" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Field, {
											label: t("remote.connect.privateKeyPath"),
											hint: t("remote.connect.privateKeyHint"),
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													className: "dsh-rw-rename-input",
													value: dialog.privateKeyPath,
													disabled: submitting,
													placeholder: "~/.ssh/id_ed25519",
													list: SSH_KEY_LIST_ID,
													onChange: (event) => patch({ privateKeyPath: event.target.value })
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("datalist", {
													id: SSH_KEY_LIST_ID,
													children: sshKeyOptions.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
														value: option.path,
														label: option.label
													}, option.path))
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
													className: "dsh-rw-hint",
													"data-testid": "dsh-rw-ssh-keys",
													children: sshKeyOptions.length === 0 ? t("remote.connect.privateKeyNone") : t("remote.connect.privateKeyFound", { count: String(sshKeyOptions.length) })
												})
											]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
											label: t("remote.connect.passphrase"),
											hint: t("remote.connect.passphraseHint"),
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												className: "dsh-rw-rename-input",
												type: "password",
												value: dialog.secret,
												disabled: submitting,
												autoComplete: "off",
												onChange: (event) => patch({ secret: event.target.value })
											})
										})] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
											icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconGlobeOutlineRegular, { size: 14 }),
											title: t("remote.connect.advanced"),
											open: advancedOpen,
											expandable: true,
											onToggle: () => {
												setAdvancedOpen(!advancedOpen);
											},
											expandOnRowClick: true,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsh-rw-fields",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
														className: "dsh-rw-hint",
														children: t("remote.connect.advanced.hint")
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
														label: t("remote.connect.dshHome"),
														hint: t("remote.connect.dshHomeHint"),
														children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
															className: "dsh-rw-rename-input",
															value: dialog.dshHome,
															disabled: submitting,
															placeholder: "/home/tester/.dsh",
															onChange: (event) => patch({ dshHome: event.target.value })
														})
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "dsh-rw-local-model dsh-rw-local-source",
														"data-testid": "dsh-rw-model-source",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
															label: t("connect.local.title"),
															children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SegmentedControl, {
																id: "dsh-rw-connect-model-source",
																value: dialog.modelSource,
																disabled: submitting,
																label: t("connect.local.title"),
																options: [{
																	value: "local",
																	label: t("connect.local.source.local")
																}, {
																	value: "server",
																	label: t("connect.local.source.server")
																}],
																onChange: (next) => patch({ modelSource: next })
															})
														}), dialog.modelSource === "server" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
															className: "dsh-rw-hint",
															children: t("connect.local.serverHint")
														}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
															className: "dsh-rw-hint",
															"data-testid": "dsh-rw-local-auto-hint",
															children: t("connect.local.auto.forwardAll")
														})]
													})
												]
											})
										}),
										configError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "dsh-rw-side-error",
											children: configError
										})
									]
								}),
								current === "connect" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-rw-section",
									children: [
										reconnect && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "dsh-rw-hint",
											children: t("remote.connect.reconnectHint")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-rw-connect-identity",
											"aria-label": t("remote.connect.identity"),
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dsh-rw-connect-identity-item",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("remote.connect.label") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: dialog.label.trim() === "" ? "—" : dialog.label })]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dsh-rw-connect-identity-item",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("remote.connect.host") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: dialog.host.trim() === "" ? "—" : `${dialog.host}:${dialog.port || "22"}` })]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dsh-rw-connect-identity-item",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("remote.connect.username") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: dialog.username.trim() === "" ? "—" : dialog.username })]
												}),
												!reconnect && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dsh-rw-connect-identity-item",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("remote.connect.authKind") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: dialog.authKind === "password" ? t("remote.connect.auth.password") : dialog.authKind === "privateKey" ? t("remote.connect.auth.privateKey") : t("remote.connect.auth.agent") })]
												}),
												!reconnect && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dsh-rw-connect-identity-item dsh-rw-connect-identity-wide",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("remote.connect.dshHome") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: dialog.dshHome || t("remote.connect.dshHomeDefault") })]
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
											className: "dsh-rw-section-title",
											children: t("connect.deploy.title")
										}),
										progressReadError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "dsh-rw-side-error",
											role: "alert",
											"data-testid": "dsh-rw-progress-error",
											children: progressReadError
										}),
										submitting && progress.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "dsh-rw-hint",
											"data-testid": "dsh-rw-progress-waiting",
											children: t("connect.progress.waiting")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dsh-rw-progress",
											children: PROGRESS_STEPS.map((item) => {
												const event = [...progress].reverse().find((candidate) => candidate.step === item);
												const status = event?.status ?? "pending";
												return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dsh-rw-progress-entry",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "dsh-rw-progress-row",
														"data-progress": status,
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsh-rw-progress-dot",
															children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: status === "running" ? "ongoing" : status === "ok" || status === "skipped" ? "done" : status === "failed" ? "error" : "idle" })
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
															className: "dsh-rw-progress-text",
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																className: "dsh-rw-progress-title",
																children: [t(PROGRESS_LABELS[item]), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																	className: "dsh-rw-progress-status",
																	children: t(PROGRESS_STATUS[status])
																})]
															}), event !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProgressDetail, { event })]
														})]
													}), item === "connect" && hostKey && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "dsh-rw-hostkey-inline",
														role: "alert",
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("remote.connect.hostkeyMessage") }),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
																className: "dsh-rw-mono",
																children: dialog.fingerprint
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
																className: "dsh-rw-hint",
																children: t("remote.connect.hostkeyHint")
															})
														]
													})]
												}, item);
											})
										}),
										progress.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-rw-log",
											"data-testid": "dsh-rw-connect-log",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsh-rw-log-head",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("connect.log.title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dsh-rw-log-count",
													children: progress.length
												})]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "dsh-rw-log-body",
												children: progress.map((event, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dsh-rw-log-line",
													"data-level": event.status === "failed" ? "error" : event.status === "ok" ? "ok" : void 0,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsh-rw-log-time",
														children: new Date(event.at).toLocaleTimeString()
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsh-rw-log-text",
														children: event.message
													})]
												}, `${event.at}-${index}`))
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "dsh-rw-hint",
											children: t("connect.deploy.hint")
										}),
										submitting && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "dsh-rw-hint",
											role: "status",
											children: t("remote.connect.deploying")
										}),
										dialog.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "dsh-rw-side-error",
											children: dialog.error.message
										})
									]
								})
							]
						})]
					})
				})
			});
		}
		/** Every dialog the rail owns (all portalled by the shell's Modal). */
		function RemoteDialogs() {
			const state = useRemoteAppState();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConnectDialog, { state }), state.forgetTarget !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: closeForgetTarget,
				title: t("tree.forget.confirm.title"),
				description: t("tree.forget.confirm.message", {
					label: state.forgetTarget.label,
					count: 0
				}),
				closeLabel: t("remote.dialog.cancel"),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					onClick: closeForgetTarget,
					disabled: state.pending,
					children: t("remote.dialog.cancel")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					onClick: () => {
						submitForgetTarget();
					},
					disabled: state.pending,
					children: t("list.forget")
				})] }),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {})
			})] });
		}
		//#endregion
		//#region src/client/chrome.tsx
		/** Marker attribute for the body-level chrome host (idempotent mounting). */
		const CHROME_HOST_ATTR = "data-dsh-remote-workspace-chrome";
		/** Every floating surface the plugin owns outside the slots. */
		function RemoteChrome() {
			const state = useRemoteAppState();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RemoteDialogs, {}), state.notice !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoticeToastHost, {
				notice: state.notice,
				onDismiss: dismissRemoteNotice
			})] });
		}
		/**
		* Mount the chrome host into `<body>`.
		*
		* Re-running replaces the previous host so a hot reload cannot leave two sets
		* of dialogs behind.
		* @returns a disposer that unmounts the React root and removes the host.
		*/
		function mountRemoteChrome() {
			if (typeof document === "undefined" || document.body === null) return void 0;
			let disposed = false;
			document.querySelector(`[${CHROME_HOST_ATTR}]`)?.remove();
			const container = document.createElement("div");
			container.setAttribute(CHROME_HOST_ATTR, "");
			container.className = "dsh-rw-chrome";
			const root = (0, react_dom_client.createRoot)(container);
			root.render(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RemoteChrome, {}));
			document.body.appendChild(container);
			return () => {
				if (disposed) return;
				disposed = true;
				root.unmount();
				container.remove();
			};
		}
		//#endregion
		//#region src/client/connections-panel.tsx
		/** The panel id shared by the `sidebar.panellist` row and the `main` entry. */
		const CONNECTIONS_PANEL_ID = "dsh-remote-workspace";
		/** Sidebar row icon; the shell passes the edge size and the selection state. */
		function RemoteConnectionsIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconGlobeOutlineRegular, { size: props.size });
		}
		/** Phase label keys; every `remote.phase.*` value already exists. */
		const PHASE_LABELS = {
			disconnected: "remote.phase.disconnected",
			connecting: "remote.phase.connecting",
			ready: "remote.phase.ready",
			degraded: "remote.phase.degraded",
			failed: "remote.phase.failed",
			stopped: "remote.phase.stopped"
		};
		/** Dot appearance per phase: live = green, degraded = warning, gone = idle. */
		const PHASE_DOTS = {
			disconnected: "idle",
			connecting: "ongoing",
			ready: "done",
			degraded: "warning",
			failed: "error",
			stopped: "idle"
		};
		/**
		* The phase one row shows.
		*
		* A connection state is authoritative when it exists; a saved target that never
		* reported one falls back to its persisted status (`ready` or `stopped`).
		*/
		function phaseOf(view) {
			return view.connection?.phase ?? (view.target.status === "ready" ? "ready" : "stopped");
		}
		/** A live profile: the row offers 断开 instead of 连接/重新连接. */
		function isConnected(phase) {
			return phase === "ready" || phase === "degraded";
		}
		/**
		* Row endpoint copy.
		*
		* SSH shows `user@host:port`; a WSL target has no host to reach, so it shows the
		* local distribution instead.
		* @param target - one saved target.
		* @returns the localized endpoint line.
		*/
		function endpointOf(target) {
			if (target.kind === "wsl") {
				const distro = target.wslDistro ?? (target.host === "" ? void 0 : target.host);
				return distro === void 0 ? t("connections.endpoint.wsl") : t("connections.endpoint.wslDistro", { distro });
			}
			return t("connections.endpoint", {
				username: target.username,
				host: target.host,
				port: target.port
			});
		}
		/** One saved connection: state glyph, name/endpoint/phase, and its verbs. */
		function ConnectionRow(props) {
			const { view, active, pending } = props;
			const { target } = view;
			const phase = phaseOf(view);
			const connected = isConnected(phase);
			const busy = view.connecting === true || pending;
			const action = connected ? t("connections.disconnect") : target.status === "unknown" ? t("connections.connect") : t("list.reconnect");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: "dsh-rw-conn-row",
				"data-testid": "dsh-rw-conn-row",
				"data-target-id": target.id,
				"data-active": active ? "true" : void 0,
				"data-connected": connected ? "true" : void 0,
				"data-phase": phase,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "dsh-rw-conn-open",
						"data-testid": "dsh-rw-conn-open",
						"aria-label": t("connections.activate", { label: target.label }),
						"aria-current": active ? "true" : void 0,
						title: t("connections.activate", { label: target.label }),
						onClick: () => {
							activateRemoteTarget(target.id);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-rw-conn-dot",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: PHASE_DOTS[phase],
								size: 8
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsh-rw-conn-label",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-rw-conn-name",
								children: target.label
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-rw-conn-meta",
								children: `${endpointOf(target)} · ${t(PHASE_LABELS[phase])}`
							})]
						})]
					}),
					active && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-rw-conn-badge",
						children: t("connections.active")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsh-rw-conn-actions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							"data-testid": "dsh-rw-conn-toggle",
							variant: "ghost",
							size: "sm",
							disabled: busy,
							onClick: () => {
								connected ? disconnectRemoteTarget(target.id) : connectRemoteTarget(target.id);
							},
							children: action
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							"data-testid": "dsh-rw-conn-forget",
							variant: "ghost",
							size: "sm",
							disabled: pending,
							onClick: () => {
								requestForgetTarget(target.id);
							},
							children: t("list.forget")
						})]
					})
				]
			});
		}
		/**
		* The connection list page.
		*
		* A failed initial read is rendered as its own error surface, never as the
		* empty state: "no saved connections" and "the host did not answer" lead the
		* user to different actions.
		*/
		function RemoteConnectionsPanel() {
			const state = useRemoteAppState();
			const active = useServerMainRequest();
			const views = state.order.map((targetId) => state.connections[targetId]).filter((view) => view !== void 0);
			const firstLoad = state.loading && !state.loaded;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-page",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-rw-page-head",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-rw-page-heading",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
							className: "dsh-rw-page-title",
							children: t("connections.title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-rw-page-intro",
							children: t("connections.subtitle")
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-rw-page-actions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							"data-testid": "dsh-rw-conn-new",
							variant: "primary",
							size: "sm",
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 12 }),
							onClick: openConnectDialog,
							children: t("list.newConnection")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							"data-testid": "dsh-rw-conn-refresh",
							variant: "outline",
							size: "sm",
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 12 }),
							disabled: state.loading,
							onClick: () => {
								refreshAllRemote();
							},
							children: t("remote.refresh")
						})]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-rw-page-body",
					children: [state.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-rw-banner",
						"data-kind": "error",
						"data-testid": "dsh-rw-conn-error",
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-rw-banner-text",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("connections.loadFailed") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-rw-banner-code",
								children: state.error.message
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							"data-testid": "dsh-rw-conn-retry",
							variant: "outline",
							onClick: () => {
								loadRemoteState();
							},
							children: t("common.retry")
						})]
					}), firstLoad ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-rw-hint",
						"data-testid": "dsh-rw-conn-loading",
						role: "status",
						children: t("common.loading")
					}) : views.length === 0 ? state.error === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "dsh-rw-empty",
						"data-testid": "dsh-rw-conn-empty",
						onClick: openConnectDialog,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-rw-empty-title",
							children: t("connections.empty")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-rw-hint",
							children: t("connections.empty.hint")
						})]
					}) : null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: "dsh-rw-conn-list",
						"data-testid": "dsh-rw-conn-list",
						children: views.map((view) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConnectionRow, {
							view,
							active: active?.targetId === view.target.id,
							pending: state.pending
						}, view.target.id))
					})]
				})]
			});
		}
		//#endregion
		//#region src/client/styles.ts
		/**
		* Plugin-owned stylesheet (v3: connection panel, dialogs, portal frame).
		*
		* The build pipeline does not process CSS for this plugin, so the browser half
		* ships ONE CSS string injected as a single `<style data-plugin="dsh-remote-workspace">`
		* element from `apply` — the simplest correct approach under that build, and an
		* effect so hot reload disposes the tag with the rest of the contribution.
		*
		* Colors/spacing come from the shell's `--dsw-*` tokens so the surface follows
		* the active theme.
		*/
		/** Marker attribute value for the injected `<style>` element. */
		const STYLE_PLUGIN_ID = "dsh-remote-workspace";
		/** The complete stylesheet. */
		const STYLE_TEXT = `
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
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: 32px 16px;
  border: 1px dashed var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-lg);
  background: transparent;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-secondary);
  text-align: center;
  cursor: pointer;
}
.dsh-rw-empty:hover {
  background: var(--dsw-alias-bg-secondary, rgb(127 127 127 / 6%));
}
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
.dsh-rw-fields {
  display: flex;
  flex-direction: column;
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
.dsh-rw-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  word-break: break-all;
}
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
.dsh-rw-progress-row[data-progress="skipped"] .dsh-rw-progress-status {
  color: var(--dsw-alias-label-tertiary);
}
.dsh-rw-progress-message {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  word-break: break-word;
}
/* The probe row reports several observations: one line each, no joined sentence. */
.dsh-rw-progress-lines {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  word-break: break-word;
}
.dsh-rw-progress-line {
  display: block;
}
.dsh-rw-progress-entry {
  display: flex;
  flex-direction: column;
}
.dsh-rw-progress-entry .dsh-rw-progress-row {
  border-bottom: 0;
}
.dsh-rw-progress-entry + .dsh-rw-progress-entry {
  border-top: 0.5px solid var(--dsw-alias-border-l1);
}
.dsh-rw-hostkey-inline {
  margin: 2px 0 10px 25px;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  font-size: 12px;
  line-height: 18px;
}
.dsh-rw-hostkey-inline p {
  margin: 0 0 6px;
}
.dsh-rw-hostkey-inline code {
  display: block;
  margin: 4px 0 6px;
  padding: 6px 8px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-secondary);
  overflow-wrap: anywhere;
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
.dsh-rw-side-error {
  margin: 2px 8px 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
  word-break: break-word;
}
.dsh-rw-dir-list > .dsh-rw-hint {
  margin: 0;
  padding: 8px 10px;
}
.dsh-rw-connect-modal {
  width: min(820px, calc(100vw - 48px)) !important;
  max-width: min(820px, calc(100vw - 48px)) !important;
  max-height: min(780px, calc(100vh - 48px)) !important;
}
.dsh-rw-connect-modal .dsh-rw-connect-identity {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-rw-connect-identity-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 12px;
  line-height: 18px;
}
.dsh-rw-connect-identity-item span {
  color: var(--dsw-alias-label-tertiary);
}
.dsh-rw-connect-identity-wide {
  grid-column: span 2;
}
.dsh-rw-connect-identity-item strong {
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-rw-ssh-alias-row {
  flex-wrap: nowrap;
}
.dsh-rw-ssh-alias-row > select {
  flex: 1 1 auto;
  min-width: 0;
}
.dsh-rw-ssh-alias-row > button {
  flex: 0 0 auto;
}
.dsh-rw-connect-layout {
  display: grid;
  grid-template-columns: 178px minmax(0, 1fr);
  gap: 22px;
  min-height: 420px;
}
/* Reconnect mode: no wizard navigation, just the attempt's progress. */
.dsh-rw-connect-layout[data-reconnect="true"] {
  grid-template-columns: minmax(0, 1fr);
}
.dsh-rw-connect-stepnav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 16px;
  border-right: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-rw-connect-stepnav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
}
.dsh-rw-connect-stepnav-item:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh-rw-connect-stepnav-item[data-active="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}
.dsh-rw-connect-stepnav-item[data-done="true"] {
  color: var(--dsw-alias-label-primary);
}
.dsh-rw-connect-stepnav-item:disabled {
  cursor: default;
  opacity: 0.55;
}
.dsh-rw-connect-stepnav-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: none;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 999px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.dsh-rw-connect-stepnav-item[data-active="true"] .dsh-rw-connect-stepnav-index {
  border-color: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-state-business-primary);
}
.dsh-rw-connect-stepbody {
  min-width: 0;
}
@media (max-width: 720px) {
  .dsh-rw-connect-layout {
    grid-template-columns: 1fr;
    gap: 14px;
    min-height: 0;
  }

  .dsh-rw-connect-stepnav {
    flex-direction: row;
    padding: 0 0 12px;
    border-right: 0;
    border-bottom: 0.5px solid var(--dsw-alias-border-l2);
    overflow: auto;
  }

  .dsh-rw-connect-stepnav-item {
    width: auto;
    flex: none;
  }
}
.dsh-rw-connect-dialog {
  max-height: calc(100vh - 220px);
  overflow: auto;
}
@media (max-width: 720px) {
  .dsh-rw-connect-modal {
    width: calc(100vw - 24px);
    max-width: calc(100vw - 24px);
  }
}
.dsh-rw-connect-dialog {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 260px;
}
.dsh-rw-connect-grid {
  display: grid;
  grid-template-columns: 1.6fr 0.6fr 1fr;
  gap: 8px;
}
.dsh-rw-local-model {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--dsw-alias-border-secondary, rgb(127 127 127 / 18%));
}
.dsh-rw-local-source,
.dsh-rw-local-auto {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dsh-rw-connect-elapsed {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}
html[data-dsh-rw-portal] [data-slot="sidebar"] {
  display: none !important;
}
html[data-dsh-rw-portal] [data-slot="root"] > div > div {
  grid-template-columns: minmax(0, 1fr) !important;
}
.dsh-rw-chrome {
  position: relative;
  z-index: 60;
}
/* Page skeleton mirrors the shell's own pages: 48px gutters, an 80px header
   bar with the 960px content column, and the body as the only scroller. */
.dsh-rw-page {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0 48px;
}
.dsh-rw-page-head {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  max-width: 960px;
  padding: 28px 0 20px;
}
.dsh-rw-page-heading {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.dsh-rw-page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 500;
  line-height: 28px;
  color: var(--dsw-alias-label-primary);
}
.dsh-rw-page-intro {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-rw-page-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  padding-top: 2px;
}
.dsh-rw-page-body {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1 1 auto;
  align-self: stretch;
  min-height: 0;
  overflow-y: auto;
  margin: 0 -48px;
  padding: 0 48px 48px;
}
.dsh-rw-page-body > * {
  width: 100%;
  max-width: 960px;
  margin-right: auto;
  margin-left: auto;
}
.dsh-rw-empty-title {
  display: block;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
}
.dsh-rw-empty .dsh-rw-hint {
  display: block;
  margin-top: 6px;
}
.dsh-rw-conn-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
  list-style: none;
}
.dsh-rw-conn-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 14px 16px;
}
.dsh-rw-conn-row + .dsh-rw-conn-row {
  border-top: 0.5px solid var(--dsw-alias-border-l1);
}
.dsh-rw-conn-row:hover {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-secondary));
}
.dsh-rw-conn-row[data-active="true"] {
  background: var(--dsw-alias-bg-secondary);
}
.dsh-rw-conn-badge {
  flex: none;
  padding: 1px 8px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-rw-conn-open {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dsh-rw-conn-dot {
  display: flex;
  flex: none;
  align-items: center;
}
.dsh-rw-conn-label {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}
.dsh-rw-conn-name {
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-rw-conn-meta {
  display: flex;
  gap: 4px;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-rw-conn-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
}
.dsh-rw-conn-row[data-phase="failed"] .dsh-rw-conn-name {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-rw-portal {
  position: fixed;
  inset: 0;
  z-index: 55;
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
}
.dsh-rw-portal-frame {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-height: 0;
  border: 0;
  background: var(--dsw-alias-bg-base);
}
.dsh-rw-portal-status {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
  pointer-events: none;
}
.dsh-rw-portal-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px;
  text-align: center;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
}
.dsh-rw-portal-error-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 420px;
  font-size: 13px;
  line-height: 20px;
}
.dsh-rw-portal-error-text > span {
  color: var(--dsw-alias-label-tertiary);
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
		//#endregion
		//#region src/client/index.tsx
		/**
		* Row order in the shell's sidebar panellist.
		*
		* Ascending, after the shipped rows (插件 0, 自动化任务 10) so 远程连接 sits at the
		* bottom of the navigation list, directly above the trailing 更多 menu. This is a
		* plugin constant: the shell's panellist exposes no user reordering.
		*/
		const SIDEBAR_ORDER = 100;
		/** Client services this plugin needs: `slots` only. */
		const inject = ["slots"];
		/**
		* Plugin body: stylesheet, the floating chrome host, the connection snapshot
		* and the slot contributions.
		* @param ctx - the client context.
		*/
		function apply(ctx) {
			bindRemoteStoreContext(ctx);
			ctx.effect(() => ensureStyles(), "dsh-remote-workspace: stylesheet");
			ctx.effect(() => mountRemoteChrome(), "dsh-remote-workspace: dialogs host");
			loadRemoteState();
			ctx.effect(() => () => {
				disposeRemoteStore();
			}, "dsh-remote-workspace: remote store lifetime");
			bindPortalCommandHandlers({
				switchTarget: (targetId) => {
					switchRemoteTarget(targetId);
				},
				openConnectDialog,
				closePortal: () => {
					closeServerMain();
					selectPanel(CONNECTIONS_PANEL_ID);
				}
			});
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: CONNECTIONS_PANEL_ID,
				order: SIDEBAR_ORDER,
				label: () => t("connections.sidebar.label"),
				registrant: "dsh-remote-workspace"
			}, RemoteConnectionsIcon));
			try {
				ctx.slots.inject("main", () => ctx.slots.register({
					name: "main",
					key: CONNECTIONS_PANEL_ID,
					label: () => t("connections.title")
				}, RemoteConnectionsPanel));
			} catch (error) {
				console.error("[dsh-remote-workspace] connections panel registration failed", error);
			}
			try {
				ctx.slots.inject("main", () => ctx.slots.register({
					name: "main",
					key: SERVER_MAIN_ID,
					label: () => t("portal.main.aria")
				}, ServerMainPanel));
			} catch (error) {
				console.error("[dsh-remote-workspace] official-ui main panel registration failed", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map