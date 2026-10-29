window.__ModuleLoader__.load({
	id: "dsh-remote-workspace",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom = require("react-dom");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
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
			"list.stopped": "已停止主机「{label}」",
			"list.stopUnsupported": "主机「{label}」当前没有可停止的会话",
			"list.meta": "插件 v{version} · 默认 profile：{profile}",
			"list.meta.unknown": "插件版本未知",
			"list.loading": "正在读取已保存的远程项…",
			"list.loadFailed": "读取已保存的远程项失败",
			"tree.title": "远程工作区",
			"portal.title": "server 主区：{label}",
			"portal.main.aria": "远程官方界面",
			"portal.timeout": "{label} 的官方界面没有在预期时间内就绪。",
			"portal.failedHint": "可重试；若仍失败，请在目标栏断开后重新连接。",
			"rail.aria": "远程连接目标",
			"rail.title": "远程目标",
			"rail.activate": "切换到 {label}",
			"rail.connect": "连接 {label}",
			"rail.connectShort": "连接",
			"rail.disconnect": "断开",
			"rail.forget": "删除",
			"rail.empty": "新建连接",
			"rail.empty.hint": "连接一台远端主机开始",
			"rail.loadFailed": "读取连接失败，点击重试",
			"rail.dragHint": "拖动可吸附到屏幕四边（左右为竖排，上下为横排）",
			"rail.collapseList": "收起连接列表",
			"rail.expandList": "展开 {count} 个连接",
			"remote.loading": "正在读取 server 工作区…",
			"remote.panel.title": "远程连接",
			"remote.panel.empty": "还没有远程连接。点击「新建连接」开始，或从左侧「远程工作区」操作。",
			"remote.panel.profile": "profile",
			"remote.panel.runtime": "运行时",
			"remote.panel.plugin": "server 插件",
			"remote.panel.pluginMissing": "未安装",
			"remote.phase.disconnected": "未连接",
			"remote.phase.connecting": "连接中",
			"remote.phase.ready": "已连接",
			"remote.phase.degraded": "已连接（受限）",
			"remote.phase.failed": "连接失败",
			"remote.phase.stopped": "已停止",
			"remote.connect.title": "新建远程连接",
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
			"remote.connect.privateKeyHint": "本机路径，凭据只留在本机。",
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
			"remote.connect.runtime": "运行时",
			"remote.connect.runtime.hint": "选择 server 端使用哪种 DSH 运行时。",
			"remote.connect.runtime.auto": "自动（优先复用全局 DSH）",
			"connect.local.title": "模型来源",
			"connect.local.hint": "默认使用本机模型：agent 仍在 server 运行，模型请求经 SSH 反向隧道转发到本机。本机 DSH 的所有 provider/模型会自动加载，可在此勾选要暴露的模型。",
			"connect.local.source.local": "本地模型",
			"connect.local.source.server": "server 模型",
			"connect.local.serverHint": "使用 server profile 自己的模型配置；需要 server 已配置可用的 API key。",
			"connect.local.auto.hint": "自动发现本机 DSH 的全部 provider 与模型；只有勾选的模型会经 SSH 反向隧道暴露给 server 侧，无需 endpoint 或 API key。",
			"connect.local.auto.refresh": "刷新",
			"connect.local.auto.refreshing": "正在读取本机模型…",
			"connect.local.auto.summary": "{providers} 个 provider · 已选 {selected}/{models} 个模型",
			"connect.local.auto.providerCount": "已选 {selected}/{total}",
			"connect.local.auto.selectAll": "全选",
			"connect.local.auto.clear": "清空",
			"connect.local.auto.providers": "本机 provider",
			"connect.local.auto.empty": "当前 DSH 没有可用的模型 provider；请先在 client 端 DSH 里配置一个模型 provider。",
			"connect.local.autoFailed": "保存本机模型设置失败。",
			"connect.local.discoverFailed": "读取本机模型失败：{message}",
			"connect.local.failed": "本地模型请求失败：{message}",
			"connect.progress.elapsed": "已用 {seconds}s",
			"connect.progress.waiting": "正在连接…首次进入或部署运行时时可能需要 1–2 分钟",
			"connect.progress.readFailed": "无法读取连接进度（{message}），仍在重试…",
			"remote.connect.runtime.auto.hint": "server 有兼容的全局 DSH 时复用；不兼容时安装隔离 runtime。",
			"remote.connect.runtime.isolated": "只使用隔离 runtime",
			"remote.connect.runtime.isolated.hint": "不修改 server 共享的全局 DSH，为这个 client 独立安装。",
			"remote.connect.plan.hostkey": "探测主机并确认 host key",
			"remote.connect.plan.auto": "复用兼容的全局 DSH，或安装隔离 runtime",
			"remote.connect.plan.isolated": "安装/复用隔离 runtime",
			"remote.connect.plan.plugin": "安装 server 插件到专用 profile",
			"remote.connect.plan.start": "启动专用 profile 并建立 SSH 隧道",
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
			"remote.connect.hostkeyTitle": "确认 server 主机指纹",
			"remote.connect.hostkeyMessage": "首次连接需要确认主机指纹（SHA-256）：",
			"remote.connect.hostkeyHint": "确认这是目标主机的指纹后再继续；已 pin 的指纹发生变化会中止连接。",
			"remote.connect.hostkeyTrust": "信任并连接",
			"remote.noConnections": "还没有远程连接，点击「+」新建连接。",
			"remote.empty": "该连接还没有工作区。",
			"remote.empty.unavailable": "无法读取 server 工作区清单，请刷新或重连。",
			"remote.search.placeholder": "搜索远程工作区/会话",
			"remote.search.clear": "清除搜索",
			"remote.draft.opening": "正在创建新会话…",
			"remote.search.empty": "没有匹配的工作区或会话。",
			"remote.refresh": "刷新",
			"remote.registry.load": "加载 server 工作区变更",
			"remote.registry.stale": "server 端工作区有更新，加载后可见（不会取消正在运行的 turn）。",
			"remote.registry.reloadFailed": "加载 server 工作区变更失败：{message}",
			"remote.registry.restart": "重启 profile 以加载（会取消运行中的 turn）",
			"remote.registry.loaded": "已请求 server 重新加载工作区",
			"remote.loading.sessions": "正在读取 server 会话…",
			"remote.sessions.failed": "读取 server 会话失败：{message}",
			"remote.verb.failed": "{action}失败：{message}",
			"remote.prepare.unmanaged": "该会话已由官方 UI 先打开；切换执行端时需要重启 profile。",
			"remote.draft.failed": "打开新会话失败：{message}",
			"remote.session.openFailed": "打开会话失败：{message}",
			"remote.session.open": "打开会话",
			"remote.session.new": "新会话",
			"remote.session.renamed": "已重命名会话",
			"remote.session.renameFailed": "重命名会话失败：{message}",
			"remote.session.pinned": "已置顶会话",
			"remote.session.unpinned": "已取消置顶",
			"remote.session.archived": "已归档会话",
			"remote.session.unarchived": "已取消归档",
			"remote.session.pin": "置顶会话",
			"remote.session.archive": "归档会话",
			"remote.session.archiveBlocked": "该会话还有运行中的工作，需先停止再归档。",
			"remote.session.archiveStop": "停止并归档",
			"remote.session.archiveActivities": "运行中的工作：{activities}",
			"remote.session.fork": "分叉会话",
			"remote.session.forked": "已分叉会话",
			"remote.session.forkNeedsOpen": "该会话需要先在官方 UI 打开完成迁移，再创建分支。",
			"remote.session.reorder": "调整会话顺序",
			"remote.session.revealTimeout": "会话已在 server 创建，但本机界面暂时没有显示它；请稍后重试。",
			"remote.session.shellUnavailable": "当前界面不提供官方会话打开能力，无法显示该会话。",
			"remote.workspace.add": "添加工作区",
			"remote.workspace.addTitle": "添加 server 工作区",
			"remote.workspace.addDescription": "在「{label}」上选择一个 server 目录，登记为官方工作区。",
			"remote.workspace.added": "已添加工作区「{title}」",
			"remote.workspace.path": "server 路径",
			"remote.workspace.browse": "浏览目录",
			"remote.workspace.rename": "重命名工作区",
			"remote.workspace.renamed": "已重命名工作区「{title}」",
			"remote.workspace.renameFailed": "重命名工作区失败：{message}",
			"remote.workspace.remove": "移除工作区",
			"remote.workspace.removeTitle": "移除这个 server 工作区？",
			"remote.workspace.removeMessage": "将从 server 的工作区清单移除「{title}」（{path}）。远端会话日志会保留，重新登记同一目录即可再次看到。",
			"remote.workspace.removeForceTitle": "该工作区还有 {count} 个会话，仍要移除？",
			"remote.workspace.removeForceMessage": "移除只删除 server 的工作区登记，不会删除会话日志。",
			"remote.workspace.removeForce": "仍然移除",
			"remote.workspace.deleted": "已移除工作区「{title}」",
			"remote.workspace.deleteFailed": "移除工作区失败：{message}",
			"remote.workspace.reorder": "调整工作区顺序",
			"remote.mode.server": "server 执行",
			"remote.mode.local": "本地执行",
			"remote.mode.current": "当前执行端：{mode}",
			"remote.mode.switch": "切换执行端…",
			"remote.mode.switchMenu": "切换执行端",
			"remote.mode.switching": "正在切换执行端…",
			"remote.mode.switched": "已切换为「{mode}」",
			"remote.mode.confirmTitle": "切换执行端会取消正在运行的 turn",
			"remote.mode.confirmCurrent": "当前会话的 turn 将被取消（已产生内容保留）。",
			"remote.mode.confirmOthers": "该 profile 还有 {count} 个其它运行中的 turn，确认后会一起取消：",
			"remote.mode.confirmItem": "{title}（{id}）",
			"remote.mode.confirmUntitled": "未命名会话",
			"remote.mode.confirm": "仍要切换并全部取消",
			"remote.mode.apply": "切换执行端",
			"remote.mode.retry": "重新尝试切换",
			"remote.mode.pending": "本地模式切换即将可用（host 运行时接线中）；当前仅支持 server 执行。",
			"remote.mode.selectSessionFirst": "请先打开该连接的一个会话，再切换执行端。",
			"remote.mode.previewFailed": "无法读取运行中的 turn 清单，执行端未切换：{message}",
			"remote.mode.credentials.server": "模型凭据：server",
			"remote.mode.credentials.local": "模型凭据：本机",
			"remote.restart.title": "重启 profile server？",
			"remote.restart.message": "重启会取消该 profile 下 {count} 个运行中的 turn（已产生内容保留）。",
			"remote.restart.none": "当前没有运行中的 turn。",
			"remote.restart.confirm": "重启 profile",
			"remote.restart.done": "profile 已重启",
			"remote.restart.failed": "重启 profile 失败：{message}",
			"remote.restart.preview": "重启 profile 以加载 server 变更",
			"remote.error.retry": "重试",
			"remote.deploy.title": "部署",
			"remote.deploy.runtime": "运行时",
			"remote.deploy.plugin": "server 插件",
			"remote.deploy.auto": "自动",
			"remote.deploy.confirm": "需确认",
			"remote.deploy.reuse": "复用",
			"remote.deploy.install": "安装",
			"remote.deploy.upgrade": "升级",
			"remote.deploy.runtimeButton": "安装/升级运行时（需确认）",
			"remote.deploy.pluginButton": "安装/升级插件（需确认）",
			"remote.deploy.done": "部署已应用",
			"remote.deploy.doneRestarted": "部署已应用，profile 已重启",
			"remote.deploy.failed": "部署失败：{message}",
			"remote.deploy.previewFailed": "读取部署状态失败：{message}",
			"remote.deploy.pluginConfirmRequired": "在非专用 profile 安装插件需要按钮确认。",
			"remote.deploy.pluginNotManaged": "v1 只管理本 client 的专用 profile，拒绝修改其他 profile；请手工安装或等待后续版本。",
			"remote.deploy.globalUnsupported": "v1 不会修改 server 全局 DSH（避免影响其他 profile）；请手工安装/升级，或改用独立/专用运行时。",
			"remote.deploy.runtimeConfirmRequired": "全局运行时安装/升级会改动其他 profile，需要显式确认。",
			"remote.deploy.pluginConfirmRequiredShort": "需要你确认后才会改其他 profile。",
			"remote.error.registryStale": "server 端工作区已被其他实例修改，请刷新/重连后再试。",
			"remote.error.writerHeld": "该会话正被另一个实例使用；请等待对方结束或刷新/重连。",
			"remote.error.agentBusy": "该会话的 agent 正忙，请稍后重试。",
			"remote.error.archivedPin": "该会话已归档，请先取消归档再置顶。",
			"remote.error.profileLocked": "该 profile 正被另一个 client 实例占用；不能并发驱动。",
			"remote.error.tunnel": "与 server 的连接不可用；请检查连接并重试。",
			"remote.error.sessionMissing": "该会话已不存在，请刷新列表。",
			"remote.error.agentCompose": "该会话已被官方 UI 先打开；切换 local 需要重启 profile（会取消其它 turn）。",
			"remote.error.localPending": "本地模式尚未接线完成；当前请使用 server 执行端。",
			"remote.error.runtimeConfirmRequired": "安装/升级 server 全局运行时会改动其他 profile；需要显式确认后才能继续。",
			"remote.error.runtimeIncompatible": "server 运行时版本与当前 client 不兼容；请安装/升级匹配的运行时。",
			"remote.error.pluginMissing": "server 插件缺失；专用 profile 会自动安装，其他 profile 需确认。",
			"remote.error.pluginProtocol": "server 插件协议不匹配；请重装/升级 server 插件。",
			"remote.error.profileStart": "profile server 启动失败；请查看 server 日志尾部后重试。",
			"remote.error.bootstrap": "server 数据目录首次初始化超时；请检查 server ~/.dsh 权限后重试。",
			"remote.error.workspaceMissing": "该工作区已不存在，请刷新列表。",
			"remote.conn.pluginMissing": "server 插件尚未就绪；连接状态可能受限。",
			"remote.conn.embedMissing": "server 未提供 embed 能力，无法打开官方对话区。",
			"remote.conn.retry": "重新连接",
			"remote.dialog.cancel": "取消",
			"remote.dialog.confirm": "确认",
			"remote.dialog.rename": "重命名",
			"remote.rename.session.title": "重命名会话",
			"remote.rename.workspace.title": "重命名工作区",
			"remote.rename.placeholder": "名称",
			"remote.rename.required": "名称不能为空",
			"remote.addWorkspace.title": "添加 server 工作区",
			"remote.addWorkspace.dirName": "新建目录名称",
			"remote.addWorkspace.dirNamePlaceholder": "新建目录名称",
			"remote.addWorkspace.dirNameInvalid": "目录名不能包含 /",
			"remote.addWorkspace.dirCreate": "新建目录",
			"remote.addWorkspace.dirCreating": "创建中…",
			"remote.addWorkspace.description": "在「{label}」上选择一个 server 目录。",
			"remote.addWorkspace.create": "添加",
			"remote.addWorkspace.creating": "正在添加…",
			"remote.addWorkspace.close": "关闭",
			"remote.addWorkspace.parent": "上一级",
			"remote.addWorkspace.empty": "这个目录是空的。",
			"remote.addWorkspace.loading": "正在读取目录…",
			"remote.addWorkspace.failed": "读取目录失败：{message}",
			"remote.addWorkspace.pathLabel": "server 路径",
			"remote.addWorkspace.pathHint": "可直接输入 server 绝对路径；目录浏览暂不可用时也能添加。",
			"remote.addWorkspace.titleLabel": "工作区名称",
			"remote.addWorkspace.titleHint": "默认使用目录名，可在添加前修改。",
			"portal.loading": "正在加载 {label} 的官方对话区…",
			"portal.failed": "无法加载 {label} 的官方对话区",
			"portal.failedUnknown": "连接或代理暂时不可用；可重试，或检查连接状态。",
			"tree.sidebar.title": "远程工作区",
			"tree.hint": "连接 → 工作区 → 会话；会话日志保存在远端，换设备也能继续。",
			"tree.remotePreset.label": "远程执行 · {label}",
			"tree.remotePreset.hint": "远程工作区固定使用该主机的执行世界；标准/PTC 模式暂不支持远程。",
			"tree.expand": "展开",
			"tree.collapse": "收起",
			"tree.conn.connected": "已连接",
			"tree.conn.connectedNotice": "已连接主机「{label}」",
			"tree.conn.disconnected": "未连接",
			"tree.conn.failed": "连接失败",
			"tree.conn.connect": "连接",
			"tree.conn.connecting": "正在连接…",
			"tree.conn.failedReason": "连接失败：{message}",
			"tree.conn.reconnect": "重新连接",
			"tree.conn.disconnect": "断开",
			"tree.conn.addWorkspace": "添加工作区",
			"tree.conn.noWorkspace": "该 server 上还没有工作区，点击「添加工作区」。",
			"tree.conn.noWorkspace.unavailable": "无法读取远端工作区清单，点击刷新重试。",
			"tree.conn.secretMissing": "连接「{label}」没有保存密码，请删除后重新添加。",
			"panel.crashed": "界面渲染出错，请刷新页面后重试。",
			"tree.workspace.open": "打开",
			"tree.workspace.newSession": "新会话",
			"tree.workspace.forget": "移除工作区",
			"tree.workspace.sessions": "{count} 个会话",
			"tree.workspace.deleted": "已从远端清单移除工作区「{title}」，远端会话日志保留",
			"tree.workspace.deletedWithSessions": "已从远端清单移除工作区「{title}」，{count} 个会话的日志仍保留在远端",
			"tree.workspace.deleteFailed": "移除工作区失败：{message}",
			"tree.workspace.delete.force.title": "该工作区还有会话，仍要移除？",
			"tree.workspace.delete.force.message": "「{title}」在 server 上还有 {count} 个会话。移除只删除 server 的清单条目，远端会话日志会保留 —— 重新登记同一个目录即可再次看到这些会话。",
			"tree.workspace.delete.force.confirm": "仍然移除清单条目",
			"tree.cleanup.removed": "已清理 {count} 个残留的本地工作区条目",
			"tree.sessions.loading": "正在读取远端会话…",
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
			"tree.draft.failed": "打开新对话失败：{message}",
			"tree.draft.openAria": "打开未发送的「新会话」草稿",
			"tree.draft.shellUnavailable": "当前界面不提供官方「新会话」能力（uiWorkspace 服务不可用），无法打开新对话",
			"tree.draft.workspaceUnavailable": "工作区还没有出现在侧边栏的工作区列表里，暂时无法打开新对话；请稍后重试或点「刷新」",
			"tree.forgetConnection": "删除连接",
			"tree.forget.confirm.title": "删除这个连接？",
			"tree.forget.confirm.message": "将删除「{label}」的本机记录、已保存的凭据、{count} 个远程工作区及其本地锚点目录。远端已部署的运行时与远端会话日志不会被删除。",
			"tree.forget.workspace.title": "移除这个远程工作区？",
			"tree.forget.workspace.message": "将从 server 的工作区清单里移除「{title}」（{path}），并删除本机的引用与本地锚点目录。**远端会话日志会保留**，重新登记同一个目录即可再次看到这些会话。",
			"tree.workspace.rename": "重命名工作区",
			"tree.workspace.rename.title": "重命名工作区",
			"tree.workspace.rename.description": "只改这里显示的名称，不改远端目录名，也不影响已保存的会话。",
			"tree.workspace.renamed": "已重命名工作区「{title}」",
			"tree.workspace.renameFailed": "重命名工作区失败：{message}",
			"tree.workspace.aria": "工作区「{name}」的操作",
			"tree.session.aria": "会话「{name}」的操作",
			"tree.session.more": "更多操作",
			"tree.session.copyId": "复制会话 ID",
			"tree.session.copied": "已复制会话 ID",
			"tree.session.copyFailed": "复制失败",
			"tree.addWorkspace.title": "添加工作区",
			"tree.addWorkspace.description": "在「{label}」上选一个远端目录作为工作区。",
			"tree.addWorkspace.close": "关闭",
			"method.title": "选择连接方式",
			"method.description": "agent 在远端 server 运行；模型默认仍由本机转发，可在下一步切换。",
			"method.ssh.name": "SSH",
			"method.ssh.description": "通过 SSH 连接主机，在远端启动 DSH 并运行执行世界。",
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
			"connect.scan.connecting": "正在连接 {endpoint}…",
			"connect.runtime.title": "运行时",
			"connect.runtime.hint": "选择远端已有的 dsh 复用，或部署一份新的运行时。",
			"connect.runtime.empty": "远端没有可直接复用的 dsh，请部署新运行时。",
			"connect.runtime.deploy": "部署新运行时",
			"connect.runtime.deploy.hint": "上传本机打包的运行时，或从 Release 下载对应架构的包。",
			"connect.runtime.expand": "展开",
			"connect.runtime.collapse": "收起",
			"connect.runtime.required": "请先选择运行时",
			"connect.runtime.reuse.required": "请选择一个可复用的远端 dsh",
			"connect.mode.upload.name": "上传 server 包",
			"connect.mode.upload.description": "按远端架构上传自带的 Node 与 dsh；本机已缓存的包直接上传。",
			"connect.mode.download.name": "远程下载",
			"connect.mode.download.description": "按远端架构从 GitHub Release 下载 server 包；找不到对应 Release 时回退到本机构建。",
			"connect.mode.selected": "已选择",
			"connect.scan.ready": "扫描到 {count} 个可复用的 dsh",
			"connect.scan.empty": "远端没有扫描到可用的 dsh，可以改用「上传 server 包」。",
			"connect.scan.verified": "已验证的 DSH 运行时：{version}",
			"connect.scan.failed": "扫描失败：{message}",
			"connect.scan.retry": "重新扫描",
			"connect.scan.hostKey.pending": "首次扫描该主机：请先确认主机指纹，确认后会带指纹重新扫描。",
			"connect.package.checking": "正在探测远端架构…",
			"connect.package.probe": "远端架构：{tag}",
			"connect.package.artifact": "server 包：{artifact}",
			"connect.package.unknown": "尚未探测远端架构，可先点「重新扫描」",
			"connect.upload.cached": "本地已缓存 {size}，直接上传",
			"connect.upload.build": "本地无此架构包，将本地打包（可能数分钟）",
			"connect.download.cached": "本地已缓存 {size}，将直接使用",
			"connect.download.fetch": "将从 GitHub Release 下载 {artifact}（找不到时回退本机构建）",
			"connect.download.button": "连接（下载 server 包）",
			"dsh.version.unknown": "版本未知",
			"dsh.compatible": "版本兼容",
			"dsh.incompatible": "版本不兼容",
			"dsh.notExecutable": "无法执行",
			"dsh.selfContained": "自带 Node",
			"dsh.nodePath": "Node：{path}",
			"dsh.plugin.none": "未安装 server 插件",
			"dsh.plugin.installed": "已装 server 插件 {version}",
			"dsh.plugin.outdated": "server 插件待更新（{version}）",
			"dsh.origin.deployed": "本插件部署的运行时",
			"dsh.origin.nvm": "nvm 安装",
			"dsh.origin.fnm": "fnm 安装",
			"dsh.origin.volta": "Volta 安装",
			"dsh.origin.bun": "Bun 安装",
			"dsh.origin.user-local": "用户目录安装",
			"dsh.origin.system": "系统安装",
			"dsh.origin.other": "其他位置",
			"dsh.profile.installed": "profile {profile} · 插件已安装 {version}",
			"dsh.profile.outdated": "profile {profile} · 插件待更新（{version}）",
			"dsh.profile.none": "profile {profile} · 未安装插件",
			"dsh.scan.home": "DSH_HOME：{home}",
			"dsh.scan.profiles": "已有 profile：{profiles}",
			"dsh.scan.noProfiles": "尚无 profile",
			"dsh.candidate.path": "路径：{path}",
			"dsh.select": "选用",
			"dsh.selected": "已选用",
			"connect.reuse.failed": "复用远端 dsh 失败：{message}",
			"connect.reuse.switchUpload": "改用上传 server 包并重试",
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
			"directory.draftFailed": "打开工作区的新对话失败：{message}",
			"directory.backToList": "返回列表",
			"directory.noTarget": "没有正在浏览的主机，请先完成一次连接。",
			"error.title": "出错了",
			"error.code": "错误码：{code}",
			"error.network": "网络请求失败：{message}",
			"error.invalidResponse": "服务端返回了无法解析的数据",
			"error.streamUnsupported": "当前环境不支持 SSE（EventSource）",
			"error.dismiss": "知道了",
			"session.block.code": "代码",
			"session.block.copy": "复制",
			"session.block.copied": "已复制",
			"session.block.wrap": "自动换行",
			"session.block.unwrap": "保持原样",
			"session.block.collapse": "收起",
			"session.block.expand": "展开",
			"session.block.expandAria": "展开剩余 {hidden} 行",
			"session.block.jsonTruncated": "已截断，共 {total} 字符",
			"session.block.terminal.commandLine": "第 {line} 行命令",
			"session.block.terminal.signal": "信号 {signal} 结束",
			"session.block.terminal.exitCode": "退出码 {code}",
			"session.block.terminal.noExitCode": "无退出码",
			"session.block.terminal.noOutput": "没有输出",
			"session.block.read.window": "显示 {shown}/{total} 行",
			"session.block.search.paths": "显示 {shown}/{total} 个路径",
			"session.block.search.pathsTruncated": "显示 {shown}/{total} 个路径（结果被截断）",
			"session.block.search.matches": "显示 {shown}/{total} 处匹配 · {files} 个文件",
			"session.block.search.matchesTruncated": "显示 {shown}/{total} 处匹配 · {files} 个文件（结果被截断）",
			"session.block.search.noResults": "没有匹配",
			"session.tool.arguments": "参数",
			"session.hero.title": "探索未至之境",
			"session.hero.preview": "预览版",
			"session.hero.workspace": "选择工作区",
			"session.hero.preset": "标准模式",
			"session.hero.unsupported": "当前 server 会话暂不支持该设置",
			"session.hero.permission": "工作区内修改",
			"session.hero.model": "DeepSeek Flash",
			"session.hero.effort": "Default",
			"session.composer.add": "添加文件或调用指令",
			"session.composer.permissionAria": "访问模式，当前：{mode}",
			"session.composer.modelAria": "选择模型，当前 {model}，推理等级 {effort}",
			"session.main.aria": "server 模式对话",
			"session.header.executor": "server 执行",
			"session.view.conversation": "对话",
			"session.view.trace": "轨迹",
			"session.trace.user": "用户",
			"session.trace.assistant": "助手",
			"session.trace.reasoning": "思考",
			"session.trace.tool": "工具",
			"session.trace.result": "结果",
			"session.trace.error": "错误",
			"session.status.loading": "加载中…",
			"session.status.idle": "就绪",
			"session.status.running": "运行中",
			"session.status.approval": "等待审批",
			"session.status.error": "出错",
			"session.status.reconnecting": "重连中…",
			"session.banner.reconnecting": "与 server 的事件流已断开，正在按 afterSeq 续传。",
			"session.history.load": "加载更早的消息",
			"session.history.loading": "正在加载…",
			"session.empty": "还没有消息。输入内容开始这一轮对话。",
			"session.jumpBottom": "回到最新",
			"session.message.sending": "正在发送",
			"session.message.interrupted": "这条回复被中断了。",
			"session.reasoning.live": "思考中…",
			"session.reasoning.title": "思考过程",
			"session.turn.done": "本轮完成",
			"session.turn.cancelled": "本轮已取消",
			"session.turn.error": "本轮出错",
			"session.markdown.copy": "复制",
			"session.markdown.copied": "已复制",
			"session.markdown.footnotes": "脚注",
			"session.image.loading": "正在加载图片…",
			"session.image.failed": "图片加载失败",
			"session.composer.placeholder": "描述你想要构建的内容, / 调用指令, @ 文件或对话",
			"session.composer.placeholderComposer": "发消息或创建任务, / 调用指令, @ 文件或对话",
			"session.composer.attachments": "附件",
			"session.composer.removeAttachment": "移除附件 {name}",
			"session.composer.attachmentTooLarge": "附件 {name} 超过 600 KB，请压缩后重试。",
			"session.composer.commands": "调用指令",
			"session.composer.files": "文件引用",
			"session.composer.loadingFiles": "正在读取目录…",
			"session.composer.permission.readOnly": "仅可查看",
			"session.composer.permission.workspaceWrite": "工作区内修改",
			"session.composer.permission.fullAccess": "完全权限",
			"session.composer.modelHint": "模型由 server profile 提供，可用 /model 切换。",
			"session.composer.modelChange": "请选择模型",
			"session.composer.attachmentsDisabled": "v2 native 主区暂不支持附件；请在 server 官方 UI 中添加。",
			"session.composer.send": "发送",
			"session.composer.stop": "停止",
			"session.composer.hint": "Enter 发送 · Shift+Enter 换行",
			"session.composer.disabled": "当前不可发送",
			"session.tool.call": "工具调用",
			"session.tool.result": "工具结果",
			"session.tool.resultError": "工具失败",
			"session.tool.status.running": "运行中",
			"session.tool.status.done": "完成",
			"session.tool.status.error": "失败",
			"session.tool.truncated": "已截断",
			"session.tool.expand": "展开",
			"session.approval.title": "需要你的批准",
			"session.approval.status.pending": "等待决定",
			"session.approval.status.allowed": "已允许",
			"session.approval.status.denied": "已拒绝",
			"session.approval.status.expired": "已过期",
			"session.approval.allow": "允许",
			"session.approval.deny": "拒绝"
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
				"list.stopped": "Stopped host \"{label}\"",
				"list.stopUnsupported": "Host \"{label}\" has no running session to stop",
				"list.meta": "Plugin v{version} · default profile: {profile}",
				"list.meta.unknown": "Plugin version unknown",
				"list.loading": "Reading saved remote items…",
				"list.loadFailed": "Reading saved remote items failed",
				"tree.title": "Remote workspaces",
				"portal.title": "Server conversation: {label}",
				"portal.main.aria": "Remote official UI",
				"portal.timeout": "{label}’s official UI did not become ready in time.",
				"portal.failedHint": "Retry; if it keeps failing, disconnect and reconnect from the target rail.",
				"rail.aria": "Remote connection targets",
				"rail.title": "Remote targets",
				"rail.activate": "Switch to {label}",
				"rail.connect": "Connect {label}",
				"rail.connectShort": "Connect",
				"rail.disconnect": "Disconnect",
				"rail.forget": "Delete",
				"rail.empty": "New connection",
				"rail.empty.hint": "Connect a remote host to start",
				"rail.loadFailed": "Reading connections failed; click to retry",
				"rail.dragHint": "Drag to snap to any screen edge (left/right = column, top/bottom = bar)",
				"rail.collapseList": "Collapse connections",
				"rail.expandList": "Expand {count} connections",
				"remote.loading": "Loading server workspaces…",
				"remote.panel.title": "Remote connections",
				"remote.panel.empty": "No remote connections yet. Use “New connection”, or the sidebar’s 远程工作区 section.",
				"remote.panel.profile": "Profile",
				"remote.panel.runtime": "Runtime",
				"remote.panel.plugin": "Server plugin",
				"remote.panel.pluginMissing": "Not installed",
				"remote.phase.disconnected": "Disconnected",
				"remote.phase.connecting": "Connecting",
				"remote.phase.ready": "Connected",
				"remote.phase.degraded": "Connected (limited)",
				"remote.phase.failed": "Connection failed",
				"remote.phase.stopped": "Stopped",
				"remote.connect.title": "New remote connection",
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
				"remote.connect.privateKeyHint": "A local path; credentials never leave this machine.",
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
				"remote.connect.runtime": "Runtime",
				"remote.connect.runtime.hint": "Choose which DSH runtime the server uses.",
				"remote.connect.runtime.auto": "Automatic (prefer global DSH)",
				"connect.local.title": "Model source",
				"connect.local.hint": "Local model is the default: the agent still runs on the server, while model requests are forwarded to this machine through an SSH reverse tunnel. Every provider/model of this DSH is discovered automatically; check the ones to expose.",
				"connect.local.source.local": "Local model",
				"connect.local.source.server": "Server model",
				"connect.local.serverHint": "Use the server profile’s own model configuration; the server must already have a working API key.",
				"connect.local.auto.hint": "Discover every provider and model of the current DSH automatically. Only the checked models are exposed to the server through the SSH reverse tunnel; no endpoint or API key needed.",
				"connect.local.auto.refresh": "Refresh",
				"connect.local.auto.refreshing": "Reading local models…",
				"connect.local.auto.summary": "{providers} provider(s) · {selected}/{models} model(s) selected",
				"connect.local.auto.providerCount": "{selected}/{total} selected",
				"connect.local.auto.selectAll": "Select all",
				"connect.local.auto.clear": "Clear",
				"connect.local.auto.providers": "Local providers",
				"connect.local.auto.empty": "The current DSH exposes no usable model provider yet. Configure a model provider in the client DSH first.",
				"connect.local.autoFailed": "Saving the local-model settings failed.",
				"connect.local.discoverFailed": "Reading local models failed: {message}",
				"connect.local.failed": "Local model request failed: {message}",
				"connect.progress.elapsed": "Elapsed {seconds}s",
				"connect.progress.waiting": "Connecting… the first connection or a runtime deploy can take 1–2 minutes",
				"connect.progress.readFailed": "Cannot read connect progress ({message}); still retrying…",
				"remote.connect.runtime.auto.hint": "Reuse a compatible global DSH; otherwise install an isolated runtime.",
				"remote.connect.runtime.isolated": "Isolated runtime only",
				"remote.connect.runtime.isolated.hint": "Never modify the shared global DSH; install per client.",
				"remote.connect.plan.hostkey": "Probe the host and confirm the host key",
				"remote.connect.plan.auto": "Reuse a compatible global DSH, or install an isolated runtime",
				"remote.connect.plan.isolated": "Install or reuse an isolated runtime",
				"remote.connect.plan.plugin": "Install the server plugin into the dedicated profile",
				"remote.connect.plan.start": "Start the dedicated profile and open the SSH tunnel",
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
				"remote.connect.hostkeyTitle": "Confirm the server host key",
				"remote.connect.hostkeyMessage": "First connection: confirm this host key (SHA-256):",
				"remote.connect.hostkeyHint": "Continue only if this is the target host. A changed pinned key aborts the connection.",
				"remote.connect.hostkeyTrust": "Trust and connect",
				"remote.noConnections": "No remote connections yet. Use “+” to create one.",
				"remote.empty": "This connection has no workspaces yet.",
				"remote.empty.unavailable": "Could not read the server workspace list. Refresh or reconnect.",
				"remote.search.placeholder": "Search remote workspaces/sessions",
				"remote.search.clear": "Clear search",
				"remote.draft.opening": "Creating a new session…",
				"remote.search.empty": "No matching workspace or session.",
				"remote.refresh": "Refresh",
				"remote.registry.load": "Load server workspace changes",
				"remote.registry.stale": "The server has workspace changes. Load them without cancelling running turns.",
				"remote.registry.reloadFailed": "Could not load server workspace changes: {message}",
				"remote.registry.restart": "Restart profile to load (cancels running turns)",
				"remote.registry.loaded": "Asked the server to reload workspaces",
				"remote.loading.sessions": "Loading server sessions…",
				"remote.sessions.failed": "Could not read server sessions: {message}",
				"remote.verb.failed": "{action} failed: {message}",
				"remote.prepare.unmanaged": "The official UI opened this session first; switching the execution end requires a profile restart.",
				"remote.draft.failed": "Could not open a new session: {message}",
				"remote.session.openFailed": "Could not open the session: {message}",
				"remote.session.open": "Open session",
				"remote.session.new": "New session",
				"remote.session.renamed": "Session renamed",
				"remote.session.renameFailed": "Could not rename the session: {message}",
				"remote.session.pinned": "Session pinned",
				"remote.session.unpinned": "Session unpinned",
				"remote.session.archived": "Session archived",
				"remote.session.unarchived": "Session unarchived",
				"remote.session.pin": "Pin session",
				"remote.session.archive": "Archive session",
				"remote.session.archiveBlocked": "This session still has running work; stop it before archiving.",
				"remote.session.archiveStop": "Stop and archive",
				"remote.session.archiveActivities": "Running work: {activities}",
				"remote.session.fork": "Fork session",
				"remote.session.forked": "Session forked",
				"remote.session.forkNeedsOpen": "Open this session in the official UI to complete migration before forking.",
				"remote.session.reorder": "Reorder sessions",
				"remote.session.revealTimeout": "The session exists on the server, but this UI has not shown it yet. Try again shortly.",
				"remote.session.shellUnavailable": "This UI cannot open official sessions, so it cannot show this session.",
				"remote.workspace.add": "Add workspace",
				"remote.workspace.addTitle": "Add server workspace",
				"remote.workspace.addDescription": "Choose a server directory on “{label}” to register as an official workspace.",
				"remote.workspace.added": "Workspace “{title}” added",
				"remote.workspace.path": "Server path",
				"remote.workspace.browse": "Browse directories",
				"remote.workspace.rename": "Rename workspace",
				"remote.workspace.renamed": "Workspace “{title}” renamed",
				"remote.workspace.renameFailed": "Could not rename the workspace: {message}",
				"remote.workspace.remove": "Remove workspace",
				"remote.workspace.removeTitle": "Remove this server workspace?",
				"remote.workspace.removeMessage": "Removes “{title}” ({path}) from the server workspace list. Session logs stay on the server; register the same directory again to see them.",
				"remote.workspace.removeForceTitle": "This workspace still has {count} sessions. Remove it anyway?",
				"remote.workspace.removeForceMessage": "Removing deletes only the server registration; session logs are kept.",
				"remote.workspace.removeForce": "Remove anyway",
				"remote.workspace.deleted": "Workspace “{title}” removed",
				"remote.workspace.deleteFailed": "Could not remove the workspace: {message}",
				"remote.workspace.reorder": "Reorder workspaces",
				"remote.mode.server": "server execution",
				"remote.mode.local": "local execution",
				"remote.mode.current": "Execution end: {mode}",
				"remote.mode.switch": "Switch execution end…",
				"remote.mode.switchMenu": "Switch execution end",
				"remote.mode.switching": "Switching execution end…",
				"remote.mode.switched": "Switched to “{mode}”",
				"remote.mode.confirmTitle": "Switching the execution end cancels running turns",
				"remote.mode.confirmCurrent": "The current session’s turn will be cancelled (completed output is kept).",
				"remote.mode.confirmOthers": "This profile has {count} other running turns; confirming cancels all of them:",
				"remote.mode.confirmItem": "{title} ({id})",
				"remote.mode.confirmUntitled": "Untitled session",
				"remote.mode.confirm": "Switch and cancel all",
				"remote.mode.apply": "Switch execution end",
				"remote.mode.retry": "Retry the switch",
				"remote.mode.pending": "Local-mode switching is coming soon (host runtime wiring in progress); only server execution is available for now.",
				"remote.mode.selectSessionFirst": "Open one session of this connection before switching the execution end.",
				"remote.mode.previewFailed": "Could not read the running-turn list; the execution end was not switched: {message}",
				"remote.mode.credentials.server": "Model credentials: server",
				"remote.mode.credentials.local": "Model credentials: this machine",
				"remote.restart.title": "Restart the profile server?",
				"remote.restart.message": "Restarting cancels {count} running turns in this profile (completed output is kept).",
				"remote.restart.none": "No turn is running right now.",
				"remote.restart.confirm": "Restart profile",
				"remote.restart.done": "Profile restarted",
				"remote.restart.failed": "Could not restart the profile: {message}",
				"remote.restart.preview": "Restart profile to load server changes",
				"remote.error.retry": "Retry",
				"remote.deploy.title": "Deployment",
				"remote.deploy.runtime": "Runtime",
				"remote.deploy.plugin": "Server plugin",
				"remote.deploy.auto": "Auto",
				"remote.deploy.confirm": "Needs confirmation",
				"remote.deploy.reuse": "Reuse",
				"remote.deploy.install": "Install",
				"remote.deploy.upgrade": "Upgrade",
				"remote.deploy.runtimeButton": "Install/upgrade runtime (confirm)",
				"remote.deploy.pluginButton": "Install/upgrade plugin (confirm)",
				"remote.deploy.done": "Deployment applied",
				"remote.deploy.doneRestarted": "Deployment applied; profile restarted",
				"remote.deploy.failed": "Deployment failed: {message}",
				"remote.deploy.previewFailed": "Could not read deployment state: {message}",
				"remote.deploy.pluginConfirmRequired": "Installing the plugin into a non-dedicated profile requires confirmation.",
				"remote.deploy.pluginNotManaged": "v1 only manages this client’s dedicated profile and refuses to modify other profiles; install manually or wait for a later version.",
				"remote.deploy.globalUnsupported": "v1 never mutates the server global DSH (to avoid affecting other profiles); install/upgrade it manually or use the isolated/dedicated runtime.",
				"remote.deploy.runtimeConfirmRequired": "Installing/upgrading the global runtime affects other profiles and needs explicit confirmation.",
				"remote.deploy.pluginConfirmRequiredShort": "Nothing changes until you confirm.",
				"remote.error.registryStale": "Another instance changed the server workspaces. Refresh/reconnect and retry.",
				"remote.error.writerHeld": "This session is in use by another instance; wait for it to finish or refresh/reconnect.",
				"remote.error.agentBusy": "This session’s agent is busy. Try again shortly.",
				"remote.error.archivedPin": "This session is archived; unarchive it before pinning.",
				"remote.error.profileLocked": "This profile is in use by another client instance; it cannot be driven concurrently.",
				"remote.error.tunnel": "The server connection is unavailable. Check the connection and retry.",
				"remote.error.sessionMissing": "This session no longer exists. Refresh the list.",
				"remote.error.agentCompose": "The official UI opened this session first; switching to local requires a profile restart (cancelling other turns).",
				"remote.error.localPending": "Local mode is not wired yet; use the server execution end for now.",
				"remote.error.runtimeConfirmRequired": "Installing/upgrading the server global runtime affects other profiles; explicit confirmation is required.",
				"remote.error.runtimeIncompatible": "The server runtime version is incompatible with this client; install/upgrade a matching runtime.",
				"remote.error.pluginMissing": "The server plugin is missing; the dedicated profile installs it automatically, other profiles require confirmation.",
				"remote.error.pluginProtocol": "The server plugin protocol does not match; reinstall/upgrade the server plugin.",
				"remote.error.profileStart": "The profile server failed to start; check the server log tail and retry.",
				"remote.error.bootstrap": "First-time server data initialization timed out; check server ~/.dsh permissions and retry.",
				"remote.error.workspaceMissing": "This workspace no longer exists. Refresh the list.",
				"remote.conn.pluginMissing": "The server plugin is not ready yet; connection features may be limited.",
				"remote.conn.embedMissing": "The server did not advertise embed support, so the official conversation area cannot open.",
				"remote.conn.retry": "Reconnect",
				"remote.dialog.cancel": "Cancel",
				"remote.dialog.confirm": "Confirm",
				"remote.dialog.rename": "Rename",
				"remote.rename.session.title": "Rename session",
				"remote.rename.workspace.title": "Rename workspace",
				"remote.rename.placeholder": "Name",
				"remote.rename.required": "Name is required",
				"remote.addWorkspace.title": "Add server workspace",
				"remote.addWorkspace.dirName": "New directory name",
				"remote.addWorkspace.dirNamePlaceholder": "New directory name",
				"remote.addWorkspace.dirNameInvalid": "Directory name cannot contain /",
				"remote.addWorkspace.dirCreate": "New directory",
				"remote.addWorkspace.dirCreating": "Creating…",
				"remote.addWorkspace.description": "Choose a server directory on “{label}”.",
				"remote.addWorkspace.create": "Add",
				"remote.addWorkspace.creating": "Adding…",
				"remote.addWorkspace.close": "Close",
				"remote.addWorkspace.parent": "Up",
				"remote.addWorkspace.empty": "This directory is empty.",
				"remote.addWorkspace.loading": "Loading directory…",
				"remote.addWorkspace.failed": "Could not read the directory: {message}",
				"remote.addWorkspace.pathLabel": "Server path",
				"remote.addWorkspace.pathHint": "Type an absolute server path; adding works even while directory browsing is unavailable.",
				"remote.addWorkspace.titleLabel": "Workspace name",
				"remote.addWorkspace.titleHint": "Defaults to the directory name; edit it before adding.",
				"portal.loading": "Loading {label}’s official conversation…",
				"portal.failed": "Could not load {label}’s official conversation",
				"portal.failedUnknown": "The connection or proxy is unavailable. Retry or check the connection.",
				"tree.sidebar.title": "Remote workspaces",
				"tree.hint": "Connection → workspace → session; session logs live on the remote host, so another device can continue them.",
				"tree.remotePreset.label": "Remote execution · {label}",
				"tree.remotePreset.hint": "A remote workspace always uses this host's execution world; Standard/PTC modes are not supported remotely yet.",
				"tree.expand": "Expand",
				"tree.collapse": "Collapse",
				"tree.conn.connected": "Connected",
				"tree.conn.connectedNotice": "Connected to \"{label}\"",
				"tree.conn.disconnected": "Not connected",
				"tree.conn.failed": "Connection failed",
				"tree.conn.connect": "Connect",
				"tree.conn.connecting": "Connecting…",
				"tree.conn.failedReason": "Connection failed: {message}",
				"tree.conn.reconnect": "Reconnect",
				"tree.conn.disconnect": "Disconnect",
				"tree.conn.addWorkspace": "Add workspace",
				"tree.conn.noWorkspace": "This server has no workspace yet — use \"Add workspace\".",
				"tree.conn.noWorkspace.unavailable": "Could not read the workspace list from the server — click refresh to retry.",
				"tree.conn.secretMissing": "The connection \"{label}\" has no stored password — delete it and add it again.",
				"panel.crashed": "Something went wrong while rendering this page — reload to try again.",
				"tree.workspace.open": "Open",
				"tree.workspace.newSession": "New session",
				"tree.workspace.forget": "Remove workspace",
				"tree.workspace.sessions": "{count} session(s)",
				"tree.workspace.deleted": "Removed workspace \"{title}\" from the server list; its session logs stay on the remote",
				"tree.workspace.deletedWithSessions": "Removed workspace \"{title}\" from the server list; the logs of {count} session(s) stay on the remote",
				"tree.workspace.deleteFailed": "Removing the workspace failed: {message}",
				"tree.workspace.delete.force.title": "This workspace still has sessions — remove it anyway?",
				"tree.workspace.delete.force.message": "\"{title}\" still has {count} session(s) on the server. Removing deletes only the list entry — the remote session logs stay, and registering the same directory again brings those sessions back.",
				"tree.workspace.delete.force.confirm": "Remove the list entry anyway",
				"tree.cleanup.removed": "Cleaned up {count} leftover local workspace entry(ies)",
				"tree.sessions.loading": "Reading remote sessions…",
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
				"tree.draft.failed": "Opening a new conversation failed: {message}",
				"tree.draft.openAria": "Open the unsent new-conversation draft",
				"tree.draft.shellUnavailable": "This shell does not provide the official new-session surface (no uiWorkspace service), so a new conversation cannot be opened",
				"tree.draft.workspaceUnavailable": "The workspace has not reached the sidebar list yet, so a new conversation cannot be bound to it; retry shortly or press Refresh",
				"tree.forgetConnection": "Delete connection",
				"tree.forget.confirm.title": "Delete this connection?",
				"tree.forget.confirm.message": "Removes the local record for \"{label}\", its stored credential, {count} remote workspace(s) and their local anchor directories. The runtime deployed on the remote host and the remote session logs are NOT deleted.",
				"tree.forget.workspace.title": "Remove this remote workspace?",
				"tree.forget.workspace.message": "Removes \"{title}\" ({path}) from the workspace list on the server, plus the local reference and anchor directory on this machine. The remote session logs are KEPT — registering the same directory again brings those sessions back.",
				"tree.workspace.rename": "Rename workspace",
				"tree.workspace.rename.title": "Rename workspace",
				"tree.workspace.rename.description": "Renames the workspace on the server; the remote directory name and every saved session stay as they are.",
				"tree.workspace.renamed": "Renamed workspace \"{title}\"",
				"tree.workspace.renameFailed": "Renaming the workspace failed: {message}",
				"tree.workspace.aria": "Actions for workspace \"{name}\"",
				"tree.session.aria": "Actions for session \"{name}\"",
				"tree.session.more": "More actions",
				"tree.session.copyId": "Copy session ID",
				"tree.session.copied": "Session ID copied",
				"tree.session.copyFailed": "Copy failed",
				"tree.addWorkspace.title": "Add workspace",
				"tree.addWorkspace.description": "Pick a remote directory on \"{label}\" as a workspace.",
				"tree.addWorkspace.close": "Close",
				"method.title": "Choose a connection method",
				"method.description": "The agent runs on the remote server. Model requests are bridged from this machine by default; you can switch to the server model.",
				"method.ssh.name": "SSH",
				"method.ssh.description": "Connect over SSH and start DSH with the execution world on the host.",
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
				"connect.scan.connecting": "Connecting to {endpoint}…",
				"connect.runtime.title": "Runtime",
				"connect.runtime.hint": "Reuse a dsh that is already on the host, or deploy a new runtime.",
				"connect.runtime.empty": "No reusable dsh on the host — deploy a new runtime.",
				"connect.runtime.deploy": "Deploy a new runtime",
				"connect.runtime.deploy.hint": "Upload this machine's package, or download the release built for the remote architecture.",
				"connect.runtime.expand": "Expand",
				"connect.runtime.collapse": "Collapse",
				"connect.runtime.required": "Choose a runtime first",
				"connect.runtime.reuse.required": "Pick a reusable remote dsh first",
				"connect.mode.upload.name": "Upload the server package",
				"connect.mode.upload.description": "Uploads the bundled Node and dsh for the remote architecture; a locally cached package is uploaded as is.",
				"connect.mode.download.name": "Download remotely",
				"connect.mode.download.description": "Downloads the server package for the remote architecture from the GitHub release; falls back to building it locally when no release matches.",
				"connect.mode.selected": "Selected",
				"connect.scan.ready": "{count} reusable dsh install(s) found",
				"connect.scan.empty": "No usable dsh found on the host — switch to \"Upload the server package\".",
				"connect.scan.verified": "Verified DSH runtime: {version}",
				"connect.scan.failed": "Scan failed: {message}",
				"connect.scan.retry": "Scan again",
				"connect.scan.hostKey.pending": "First scan of this host: confirm the host key, then the scan runs again with the confirmed fingerprint.",
				"connect.package.checking": "Probing the remote architecture…",
				"connect.package.probe": "Remote architecture: {tag}",
				"connect.package.artifact": "Server package: {artifact}",
				"connect.package.unknown": "Remote architecture not probed yet — use \"Scan again\"",
				"connect.upload.cached": "{size} already cached locally — uploading as is",
				"connect.upload.build": "No package for this architecture locally — it will be built here (may take minutes)",
				"connect.download.cached": "{size} already cached locally — using it as is",
				"connect.download.fetch": "Downloading {artifact} from the GitHub release (falls back to a local build when no release matches)",
				"connect.download.button": "Connect (download server package)",
				"dsh.version.unknown": "unknown version",
				"dsh.compatible": "compatible",
				"dsh.incompatible": "incompatible",
				"dsh.notExecutable": "not executable",
				"dsh.selfContained": "bundles Node",
				"dsh.nodePath": "Node: {path}",
				"dsh.plugin.none": "server plugin not installed",
				"dsh.plugin.installed": "server plugin {version} installed",
				"dsh.plugin.outdated": "server plugin needs an update ({version})",
				"dsh.origin.deployed": "Runtime deployed by this plugin",
				"dsh.origin.nvm": "nvm install",
				"dsh.origin.fnm": "fnm install",
				"dsh.origin.volta": "Volta install",
				"dsh.origin.bun": "Bun install",
				"dsh.origin.user-local": "User-local install",
				"dsh.origin.system": "System install",
				"dsh.origin.other": "Other location",
				"dsh.profile.installed": "profile {profile} · plugin installed {version}",
				"dsh.profile.outdated": "profile {profile} · plugin update needed ({version})",
				"dsh.profile.none": "profile {profile} · plugin not installed",
				"dsh.scan.home": "DSH_HOME: {home}",
				"dsh.scan.profiles": "Profiles: {profiles}",
				"dsh.scan.noProfiles": "No profiles yet",
				"dsh.candidate.path": "Path: {path}",
				"dsh.select": "Use",
				"dsh.selected": "In use",
				"connect.reuse.failed": "Reusing the remote dsh failed: {message}",
				"connect.reuse.switchUpload": "Switch to uploading the server package and retry",
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
				"directory.draftFailed": "Opening a new conversation for the workspace failed: {message}",
				"directory.backToList": "Back to list",
				"directory.noTarget": "No host is being browsed — finish a connection first.",
				"error.title": "Something went wrong",
				"error.code": "Code: {code}",
				"error.network": "The request failed: {message}",
				"error.invalidResponse": "The server returned an unreadable response",
				"error.streamUnsupported": "This environment has no SSE support (EventSource)",
				"error.dismiss": "Dismiss",
				"session.block.code": "Code",
				"session.block.copy": "Copy",
				"session.block.copied": "Copied",
				"session.block.wrap": "Wrap lines",
				"session.block.unwrap": "Keep original columns",
				"session.block.collapse": "Collapse",
				"session.block.expand": "Expand",
				"session.block.expandAria": "Show {hidden} more lines",
				"session.block.jsonTruncated": "truncated at {total} chars",
				"session.block.terminal.commandLine": "command line {line}",
				"session.block.terminal.signal": "signal {signal}",
				"session.block.terminal.exitCode": "exit code {code}",
				"session.block.terminal.noExitCode": "no exit code",
				"session.block.terminal.noOutput": "no output",
				"session.block.read.window": "showing {shown} of {total} lines",
				"session.block.search.paths": "{shown} of {total} paths",
				"session.block.search.pathsTruncated": "{shown} of {total} paths (truncated)",
				"session.block.search.matches": "{shown} of {total} matches · {files} files",
				"session.block.search.matchesTruncated": "{shown} of {total} matches · {files} files (truncated)",
				"session.block.search.noResults": "No matches",
				"session.tool.arguments": "Arguments",
				"session.hero.title": "Explore the Unknown",
				"session.hero.preview": "Preview",
				"session.hero.workspace": "Choose workspace",
				"session.hero.preset": "Standard mode",
				"session.hero.unsupported": "This setting is not available for server sessions yet",
				"session.hero.permission": "Workspace write",
				"session.hero.model": "DeepSeek Flash",
				"session.hero.effort": "Default",
				"session.composer.add": "Add files or invoke a command",
				"session.composer.permissionAria": "Access mode, current: {mode}",
				"session.composer.modelAria": "Choose model, current {model}, reasoning effort {effort}",
				"session.main.aria": "Server conversation",
				"session.header.executor": "Server execution",
				"session.view.conversation": "Conversation",
				"session.view.trace": "Trace",
				"session.trace.user": "User",
				"session.trace.assistant": "Assistant",
				"session.trace.reasoning": "Reasoning",
				"session.trace.tool": "Tool",
				"session.trace.result": "Result",
				"session.trace.error": "Error",
				"session.status.loading": "Loading…",
				"session.status.idle": "Ready",
				"session.status.running": "Running",
				"session.status.approval": "Waiting for approval",
				"session.status.error": "Error",
				"session.status.reconnecting": "Reconnecting…",
				"session.banner.reconnecting": "The server event stream is disconnected; resuming from afterSeq.",
				"session.history.load": "Load earlier messages",
				"session.history.loading": "Loading…",
				"session.empty": "No messages yet. Type below to start this turn.",
				"session.jumpBottom": "Jump to latest",
				"session.message.sending": "Sending",
				"session.message.interrupted": "This reply was interrupted.",
				"session.reasoning.live": "Thinking…",
				"session.reasoning.title": "Reasoning",
				"session.turn.done": "Turn complete",
				"session.turn.cancelled": "Turn cancelled",
				"session.turn.error": "Turn failed",
				"session.markdown.copy": "Copy",
				"session.markdown.copied": "Copied",
				"session.markdown.footnotes": "Footnotes",
				"session.image.loading": "Loading image…",
				"session.image.failed": "Image failed to load",
				"session.composer.placeholder": "Describe what you want to build, / commands, @ files or chats",
				"session.composer.placeholderComposer": "Send a message or create a task, / commands, @ files or chats",
				"session.composer.attachments": "Attachments",
				"session.composer.removeAttachment": "Remove attachment {name}",
				"session.composer.attachmentTooLarge": "Attachment {name} exceeds 600 KB; compress it and retry.",
				"session.composer.commands": "Commands",
				"session.composer.files": "File references",
				"session.composer.loadingFiles": "Reading directory…",
				"session.composer.permission.readOnly": "Read Only",
				"session.composer.permission.workspaceWrite": "Workspace write",
				"session.composer.permission.fullAccess": "Full access",
				"session.composer.modelHint": "The server profile supplies models; use /model to switch.",
				"session.composer.modelChange": "Choose model",
				"session.composer.attachmentsDisabled": "The v2 native main area does not support attachments yet; use the server official UI.",
				"session.composer.send": "Send",
				"session.composer.stop": "Stop",
				"session.composer.hint": "Enter to send · Shift+Enter for a new line",
				"session.composer.disabled": "Cannot send right now",
				"session.tool.call": "Tool call",
				"session.tool.result": "Tool result",
				"session.tool.resultError": "Tool failed",
				"session.tool.status.running": "running",
				"session.tool.status.done": "done",
				"session.tool.status.error": "failed",
				"session.tool.truncated": "truncated",
				"session.tool.expand": "Expand",
				"session.approval.title": "Approval required",
				"session.approval.status.pending": "Waiting for you",
				"session.approval.status.allowed": "Allowed",
				"session.approval.status.denied": "Denied",
				"session.approval.status.expired": "Expired",
				"session.approval.allow": "Allow",
				"session.approval.deny": "Deny"
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
			if (input.sessionId !== void 0 && input.sessionId !== "") params.set(EMBED_SESSION_PARAM, input.sessionId);
			if (input.workspaceId !== void 0 && input.workspaceId !== "") params.set(EMBED_WORKSPACE_PARAM, input.workspaceId);
			if (input.theme !== void 0) params.set(EMBED_THEME_PARAM, input.theme);
			if (input.lang !== void 0) params.set(EMBED_LANG_PARAM, input.lang);
			if (input.parentOrigin !== void 0 && input.parentOrigin !== "") params.set(EMBED_PARENT_PARAM, input.parentOrigin);
			if (input.full === true) params.set(EMBED_FULL_PARAM, "1");
			const query = params.toString();
			return query === "" ? portalPath(input.targetId) : `${portalPath(input.targetId)}?${query}`;
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
		/**
		* Parent-side gate for one iframe message.
		*
		* Both facts must hold before the payload is trusted: the event came from this
		* main area's only iframe (`sourceMatches`, checked by the caller against
		* `iframe.contentWindow`), and its origin equals the client GUI origin.
		* @param event - origin and decoded data from the DOM listener.
		* @param expectedOrigin - the client GUI origin recorded when the iframe opened.
		* @param sourceMatches - whether `event.source` is the current iframe window.
		* @returns the typed message, or undefined.
		*/
		function acceptChildMessage(event, expectedOrigin, sourceMatches) {
			return sourceMatches && isTrustedMessageOrigin(event.origin, expectedOrigin) ? parseChildMessage(event.data) : void 0;
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
		* The client keeps exactly two chrome surfaces: the floating target rail
		* (`rail.tsx`) and the connection dialogs. Both live outside the frame.
		*
		* Parent → iframe messages are kept for compatibility with the v1 deep-link
		* contract, but full mode relies on the embedded official UI's own navigation;
		* the only message the parent still needs is the child's readiness.
		*/
		/** Main-slot key for the full-screen official UI area. */
		const SERVER_MAIN_ID = "dsh-remote-workspace-server";
		/** Attribute placed on `<html>` while a portal frame is mounted. */
		const PORTAL_ACTIVE_ATTR = "data-dsh-rw-portal";
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
					if (acceptChildMessage({
						origin: event.origin,
						data: event.data
					}, expectedOrigin, iframe !== null && event.source === iframe.contentWindow)?.type === "dsh-rw/ready") setFrame((previous) => portalFrameReducer(previous, { type: "loaded" }));
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
		/**
		* Transient notice rendered as the shell's official `Toast` (top-center,
		* self-timed hold+fade; `onDone` is the only dismissal signal). The store no
		* longer runs its own auto-dismiss timer — the component owns the lifecycle.
		*
		* Success uses the built-in green check; errors keep the default dark
		* surface with a warning icon and a longer hold (official pattern: no error
		* tone exists). `key` replays the slide-in when a **new notice** arrives,
		* matching the official seq-keyed usage (ui-open-in-app/open-failure-toast).
		*
		* The identity compared is the store's notice object, not this component's
		* props: React builds a fresh props object on every render, so comparing props
		* re-keyed the `Toast` on *every* store commit — the toast then remounted,
		* replayed its slide-in and restarted its hold, which is why 已连接/已断开
		* repeated whenever a row was clicked. The notice object is stable until the
		* next commit that replaces it, so only a real new notice bumps the key.
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
		* show every notice twice when both are mounted. Ownership goes through
		* {@link useSingleHost}, so it also **passes on** when the owning tree unmounts
		* (the panel closing, say) — the old mount-order counter never handed the
		* surface to the survivor, which could leave the plugin with no toast at all.
		*/
		function NoticeToastHost(props) {
			if (!useSingleHost("notice-toast") || props.notice === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoticeToast, {
				notice: props.notice,
				onDismiss: props.onDismiss
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
			* Materialize one remote directory as a workspace **without creating a
			* session** (the official new-conversation draft).
			*
			* The row must exist before the shell can bind a draft to it — the official
			* `uiWorkspace.startSession(workspaceId)` resolves its workspace from the
			* shell's own list — but this call must not create the remote session: the
			* shell's own `sessions.create` does that lazily, and the plugin's routing
			* turns that into `persist.create` on the target (`header.cwd` is the stub
			* returned here).
			* @param targetId - the connected host owning the directory.
			* @param path - absolute remote directory.
			* @param title - display title; the server normalizes it and defaults to the
			*   last path segment.
			*/
			prepareWorkspace(targetId, path, title) {
				return call("prepare-workspace", title === void 0 ? {
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
			/**
			* Rename one remote workspace **on the server** (api-contract §4.1).
			*
			* The id and the remote directory name never change; the server persists the
			* title in its own index and the host re-reads `reg.list` afterwards.
			* @param targetId - the connection owning the workspace.
			* @param remoteWorkspaceId - server workspace id (16 hex).
			* @param title - normalized new title.
			*/
			workspaceRename(targetId, remoteWorkspaceId, title) {
				return call("workspace-rename", {
					targetId,
					remoteWorkspaceId,
					title
				});
			},
			/**
			* Delete one workspace **from the server's list** (api-contract §4.1).
			*
			* Without `force` a workspace that still has sessions answers HTTP 409
			* `workspace-not-empty`; the UI then asks again and retries with `force: true`.
			* Session logs on the remote are never deleted — only the list entry and this
			* machine's ref.
			* @param targetId - the connection owning the workspace.
			* @param remoteWorkspaceId - server workspace id (16 hex).
			* @param force - delete even when sessions remain.
			*/
			workspaceDelete(targetId, remoteWorkspaceId, force) {
				return call("workspace-delete", force === void 0 ? {
					targetId,
					remoteWorkspaceId
				} : {
					targetId,
					remoteWorkspaceId,
					force
				});
			},
			/**
			* Sweep this plugin's leftover stub entries out of the **shared** shell
			* workspace registry (api-contract §4.2). Idempotent.
			*
			* `kept` lists entries that still have an active session and therefore stay.
			*/
			cleanupShellWorkspaces() {
				return call("cleanup-shell-workspaces", {});
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
			/** Open (or reuse) the execution channel of a saved host, without a session. */
			connect(targetId) {
				return call("connect", { targetId });
			},
			/** Stop the target's remote execution-world session. */
			stopTarget(targetId) {
				return call("stop-target", { targetId });
			}
		};
		//#endregion
		//#region src/client/executor.ts
		/** Narrow a wire value to {@link ExecutorMode}. */
		function isExecutorMode(value) {
			return value === "server" || value === "local";
		}
		/** Narrow one unknown array item to {@link ActiveTurn}. */
		function asActiveTurn(value) {
			if (value === null || typeof value !== "object") return void 0;
			const row = value;
			if (typeof row.sessionId !== "string" || row.sessionId === "") return void 0;
			return {
				sessionId: row.sessionId,
				...typeof row.title === "string" && row.title !== "" ? { title: row.title } : {},
				running: row.running === true,
				status: typeof row.status === "string" ? row.status : "unknown"
			};
		}
		/** Narrow the `activeTurns` detail list, dropping malformed entries. */
		function parseActiveTurns(value) {
			if (!Array.isArray(value)) return [];
			return value.flatMap((item) => {
				const turn = asActiveTurn(item);
				return turn === void 0 ? [] : [turn];
			});
		}
		/** Narrow `executor-held` details into the lock owner. */
		function parseExecutorOwner(value) {
			if (value === null || typeof value !== "object") return void 0;
			const details = value;
			if (typeof details.ownerClientId !== "string" || details.ownerClientId === "") return void 0;
			return {
				clientId: details.ownerClientId,
				...typeof details.ownerInstanceId === "string" ? { instanceId: details.ownerInstanceId } : {},
				...typeof details.heartbeatAt === "string" ? { heartbeatAt: details.heartbeatAt } : {}
			};
		}
		/**
		* Map one P1/P3 failure to the settings surface.
		*
		* Codes come from protocol §12; the message is already scrubbed by the host.
		* `details` is only read for the stable, public fields the contract names.
		* @param error - wire failure shape; extra fields are ignored.
		* @returns the view the dialog renders.
		*/
		function executorErrorView(error) {
			const details = error.details;
			switch (error.code) {
				case "executor-switch-confirm-required":
				case "mode-switch/other-turns-cancelled-required": return {
					kind: "confirm-required",
					code: error.code,
					message: error.message,
					retryable: false,
					activeTurns: parseActiveTurns(details?.activeTurns ?? details?.otherActiveTurns)
				};
				case "executor-switch-busy": return {
					kind: "busy",
					code: error.code,
					message: error.message,
					retryable: true
				};
				case "executor-held": {
					const owner = parseExecutorOwner(details);
					return {
						kind: "held",
						code: error.code,
						message: error.message,
						retryable: owner !== void 0 && owner.heartbeatAt !== void 0,
						...owner === void 0 ? {} : { owner }
					};
				}
				case "session/writer-held": return {
					kind: "writer-held",
					code: error.code,
					message: error.message,
					retryable: false
				};
				case "profile-in-use": return {
					kind: "profile-in-use",
					code: error.code,
					message: error.message,
					retryable: true
				};
				case "profile-locked": return {
					kind: "profile-locked",
					code: error.code,
					message: error.message,
					retryable: true
				};
				case "mode-switch/preview-stale": return {
					kind: "preview-stale",
					code: error.code,
					message: error.message,
					retryable: true
				};
				case "mode-switch/preview-failed": return {
					kind: "failed",
					code: error.code,
					message: error.message,
					retryable: true
				};
				case "mode-switch/cancel-failed": return {
					kind: "failed",
					code: error.code,
					message: error.message,
					retryable: true,
					failedCancellations: parseFailedCancellations(details)
				};
				case "executor-mode-conflict": return {
					kind: "mode-conflict",
					code: error.code,
					message: error.message,
					retryable: false
				};
				case "registry-stale": return {
					kind: "registry-stale",
					code: error.code,
					message: error.message,
					retryable: true
				};
				default: return {
					kind: "failed",
					code: error.code,
					message: error.message,
					retryable: true
				};
			}
		}
		/**
		* Validate the preview's two safety preconditions.
		*
		* D20 requires the preview to carry the complete set of turns that will be
		* cancelled; an apply based on a missing list is refused rather than treated as
		* "nothing else was running".
		* @param preview - server preview.
		* @returns the problem, or undefined when the preview is actionable.
		*/
		function modeSwitchPreviewProblem(preview) {
			if (preview.previewRevision.trim() === "") return "missing-revision";
			if (preview.requiresConfirm && preview.otherActiveTurns.length === 0) return "active-turns-missing";
		}
		/** Initial state: no switch requested. */
		const IDLE_MODE_SWITCH = {
			phase: "idle",
			confirmed: false
		};
		/**
		* Reduce a preview to the dialog's facts.
		* @param preview - server preview.
		* @returns the turn lists and the confirmation requirement.
		*/
		function summarizeModeSwitch(preview) {
			const problem = modeSwitchPreviewProblem(preview);
			return {
				otherActiveTurns: preview.otherActiveTurns,
				...preview.currentTurn === void 0 ? {} : { currentTurn: preview.currentTurn },
				needsConfirmation: preview.requiresConfirm || preview.otherActiveTurns.length > 0,
				...problem === void 0 ? {} : { previewProblem: problem }
			};
		}
		/**
		* Reduce the connection-level switch state.
		*
		* A preview that violates the D20 completeness rule lands in `failed` with a
		* `mode-switch/preview-failed` view; it never reaches `applying`. `progress`
		* only annotates a running apply.
		* @param state - current state.
		* @param action - dialog action.
		* @returns the next state.
		*/
		function modeSwitchReducer(state, action) {
			switch (action.type) {
				case "preview":
					if (state.phase === "applying") return state;
					return {
						phase: "previewing",
						nextMode: action.nextMode,
						...action.targetSessionId === void 0 ? {} : { targetSessionId: action.targetSessionId },
						confirmed: false
					};
				case "planned": {
					if (state.phase !== "previewing" && state.phase !== "failed" && state.phase !== "confirming") return state;
					const summary = summarizeModeSwitch(action.preview);
					if (summary.previewProblem !== void 0) {
						const problem = summary.previewProblem;
						return {
							phase: "failed",
							...state.nextMode === void 0 ? {} : { nextMode: state.nextMode },
							...state.targetSessionId === void 0 ? {} : { targetSessionId: state.targetSessionId },
							preview: action.preview,
							confirmed: false,
							error: {
								kind: "failed",
								code: "mode-switch/preview-failed",
								message: problem === "active-turns-missing" ? "The switch preview did not list the other running turns" : "The switch preview carries no revision",
								retryable: true
							}
						};
					}
					return {
						phase: summary.needsConfirmation ? "confirming" : "ready",
						...state.nextMode === void 0 ? {} : { nextMode: state.nextMode },
						...state.targetSessionId === void 0 ? {} : { targetSessionId: state.targetSessionId },
						preview: action.preview,
						confirmed: false
					};
				}
				case "confirm":
					if (state.phase !== "confirming" || state.preview === void 0) return state;
					if (modeSwitchPreviewProblem(state.preview) !== void 0) return state;
					return {
						...state,
						phase: "applying",
						confirmed: true
					};
				case "begin-apply":
					if (state.phase !== "ready" || state.preview === void 0) return state;
					if (modeSwitchPreviewProblem(state.preview) !== void 0) return state;
					if (state.preview.requiresConfirm || state.preview.otherActiveTurns.length > 0) return state;
					return {
						...state,
						phase: "applying"
					};
				case "progress":
					if (state.phase !== "applying") return state;
					return {
						...state,
						progressPhase: action.phase
					};
				case "applied": {
					if (state.phase !== "applying") return state;
					const failed = action.failedCancellations ?? [];
					if (failed.length > 0) return {
						...state,
						phase: "failed",
						...action.cancelledTurnIds === void 0 ? {} : { cancelledTurnIds: action.cancelledTurnIds },
						failedCancellations: failed,
						error: {
							kind: "failed",
							code: "mode-switch/cancel-failed",
							message: "Some turns could not be cancelled; the switch did not complete",
							retryable: true,
							failedCancellations: failed
						}
					};
					return {
						...state,
						phase: "done",
						...action.cancelledTurnIds === void 0 ? {} : { cancelledTurnIds: action.cancelledTurnIds }
					};
				}
				case "failed":
					if (state.phase === "done") return state;
					return {
						...state,
						phase: "failed",
						error: action.error
					};
				case "cancel":
				case "reset": return IDLE_MODE_SWITCH;
				default: return state;
			}
		}
		/**
		* Build the apply request from the dialog state.
		*
		* This is the last guard before the critical write: no revision, no complete
		* preview list, or an unconfirmed D20 list all fail closed here.
		* @param state - switch state after `confirm`/`begin-apply`.
		* @returns the request fields, or the blocking reason.
		*/
		function modeSwitchApplyRequest(state) {
			if (state.phase !== "applying") return {
				ok: false,
				reason: "not-ready"
			};
			if (state.preview === void 0 || state.nextMode === void 0) return {
				ok: false,
				reason: "missing-preview"
			};
			if (modeSwitchPreviewProblem(state.preview) !== void 0) return {
				ok: false,
				reason: "preview-incomplete"
			};
			if (summarizeModeSwitch(state.preview).needsConfirmation && !state.confirmed) return {
				ok: false,
				reason: "confirmation-required"
			};
			return {
				ok: true,
				nextMode: state.nextMode,
				...state.targetSessionId === void 0 ? {} : { targetSessionId: state.targetSessionId },
				previewRevision: state.preview.previewRevision,
				cancelActiveTurns: true
			};
		}
		/** Narrow the P3 SSE payload to one mode-switch event. */
		function parseModeSwitchEvent(data) {
			if (data === null || typeof data !== "object") return void 0;
			const event = data;
			if (typeof event.targetId !== "string" || event.targetId === "") return void 0;
			switch (event.type) {
				case "mode-switch/progress": return typeof event.phase === "string" && isModeSwitchProgressPhase(event.phase) ? {
					type: "mode-switch/progress",
					targetId: event.targetId,
					phase: event.phase
				} : void 0;
				case "turn/cancelled": return typeof event.sessionId === "string" && event.sessionId !== "" ? {
					type: "turn/cancelled",
					targetId: event.targetId,
					sessionId: event.sessionId
				} : void 0;
				case "mode/changed":
					if (!isExecutorMode(event.mode)) return void 0;
					return {
						type: "mode/changed",
						targetId: event.targetId,
						mode: event.mode,
						...typeof event.sessionId === "string" && event.sessionId !== "" ? { sessionId: event.sessionId } : {}
					};
				default: return;
			}
		}
		/** Narrow one progress phase. */
		function isModeSwitchProgressPhase(value) {
			switch (value) {
				case "preview":
				case "cancelling":
				case "disposing":
				case "stopping":
				case "starting":
				case "handshake":
				case "ready":
				case "failed": return true;
				default: return false;
			}
		}
		/** Narrow `mode-switch/cancel-failed` details into the failed list. */
		function parseFailedCancellations(value) {
			if (value === null || typeof value !== "object") return [];
			const details = value;
			const list = details.failedCancellations ?? details.failures;
			if (!Array.isArray(list)) return [];
			return list.flatMap((item) => {
				if (item === null || typeof item !== "object") return [];
				const row = item;
				if (typeof row.sessionId !== "string" || row.sessionId === "") return [];
				return [{
					sessionId: row.sessionId,
					...typeof row.message === "string" ? { message: row.message } : {}
				}];
			});
		}
		//#endregion
		//#region src/client/remote-api.ts
		/**
		* The v1 P3 client API (protocol §16), separate from the legacy connection
		* wizard calls still living in `api.ts`.
		*
		* Every route here is the browser → client-host face; it never talks to the
		* profile server directly. The envelope, error normalizer and trust fence are
		* the same as `api.ts` (`call`), so a failed request still arrives as a
		* {@link RemoteApiError} with a stable code.
		*/
		/** POSIX join used for one listed child (server paths only). */
		function joinServerPath(base, name) {
			return base === "" || base === "/" ? `/${name}` : `${base.replace(/\/+$/, "")}/${name}`;
		}
		/** Normalize the P1 listing to the dialog's `ListDirResult` shape. */
		function normalizeFsList(value) {
			return {
				home: value.home,
				path: value.path,
				...value.parent === null ? {} : { parent: value.parent },
				entries: value.entries.map((entry) => ({
					name: entry.name,
					type: entry.type,
					path: joinServerPath(value.path, entry.name)
				}))
			};
		}
		/** Narrow one `/stream/state` payload. */
		function parseRemoteStateEvent(data) {
			if (data === null || typeof data !== "object") return void 0;
			const raw = data;
			if (raw.v !== 1) return void 0;
			if (raw.type === "change") {
				const event = data;
				if (typeof event.targetId !== "string" || event.targetId === "") return void 0;
				if (event.kind !== "workspace" && event.kind !== "session" && event.kind !== "executor") return void 0;
				return {
					v: 1,
					type: "change",
					targetId: event.targetId,
					kind: event.kind,
					...event.reason === "local" || event.reason === "external" ? { reason: event.reason } : {},
					...typeof event.revision === "string" ? { revision: event.revision } : {},
					...typeof event.workspaceId === "string" ? { workspaceId: event.workspaceId } : {},
					...typeof event.sessionId === "string" ? { sessionId: event.sessionId } : {}
				};
			}
			if (raw.type === "session/revealed") {
				const event = data;
				if (typeof event.targetId !== "string" || event.targetId === "") return void 0;
				if (typeof event.sessionId !== "string" || event.sessionId === "") return void 0;
				return {
					v: 1,
					type: "session/revealed",
					targetId: event.targetId,
					sessionId: event.sessionId
				};
			}
			const modeEvent = parseModeSwitchEvent(data);
			return modeEvent === void 0 ? void 0 : {
				...modeEvent,
				v: 1
			};
		}
		/** Open the single P3 state stream (no target query; frames carry targetId). */
		function openRemoteStateStream(handlers) {
			if (typeof EventSource === "undefined") throw new Error("EventSource is unavailable in this browser");
			const source = new EventSource(`${API_PREFIX}/stream/state`);
			let closed = false;
			let failed = false;
			const close = () => {
				if (closed) return;
				closed = true;
				source.close();
			};
			source.onmessage = (event) => {
				if (closed) return;
				let parsed;
				try {
					parsed = JSON.parse(String(event.data));
				} catch {
					return;
				}
				const remoteEvent = parseRemoteStateEvent(parsed);
				if (remoteEvent !== void 0) handlers.onEvent(remoteEvent);
			};
			source.onerror = () => {
				if (closed || failed) return;
				failed = true;
				handlers.onTransportError("state stream closed");
			};
			return close;
		}
		/** Same-origin URL for one v2 session event stream (EventSource). */
		function sessionEventsUrl(options) {
			const query = new URLSearchParams({
				targetId: options.targetId,
				sessionId: options.sessionId
			});
			if (options.afterSeq !== void 0 && Number.isFinite(options.afterSeq)) query.set("afterSeq", String(Math.trunc(options.afterSeq)));
			return `${API_PREFIX}/api/session/events?${query.toString()}`;
		}
		/**
		* Bridge one server session's SSE stream to the browser.
		*
		* The host re-emits P1 frames with their original event names, so we listen to
		* the common names explicitly (EventSource has no wildcard) plus the default
		* `message`; unknown named frames are still delivered through `message` only if
		* the host omitted the name.
		*/
		function openSessionEvents(options, handlers) {
			if (typeof EventSource === "undefined") throw new Error("EventSource is unavailable in this browser");
			const source = new EventSource(sessionEventsUrl(options));
			let closed = false;
			const close = () => {
				if (closed) return;
				closed = true;
				source.close();
			};
			const dispatch = (event) => {
				if (closed) return;
				const name = event.type === "message" ? "message" : event.type;
				handlers.onEvent({
					event: name,
					data: String(event.data)
				});
			};
			for (const name of [
				"message",
				"ready",
				"timeline",
				"status",
				"approval",
				"error"
			]) source.addEventListener(name, dispatch);
			source.onerror = () => {
				if (closed) return;
				handlers.onTransportError?.("session event stream closed");
			};
			return close;
		}
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
			/** Connect one identity through the v1 host route (the minimal M1 entry). */
			connectV1(request) {
				return call("v1/connect", request);
			},
			/** Read the saved local-model settings (never the API key; only `hasApiKey`). */
			localLlmRead(targetId) {
				return call("local-llm/read", targetId === void 0 ? {} : { targetId });
			},
			/** Save the local-model mode and (auto) selected models; optionally an API key. */
			localLlmSave(request) {
				return call("local-llm/save", request);
			},
			/**
			* Discover the model providers the client DSH exposes (`local-llm/discover`).
			* The host answers `local-llm-providers-unavailable` when none is usable.
			*/
			localLlmDiscover() {
				return call("local-llm/discover", {});
			},
			/** Probe the local OpenAI-compatible endpoint and return its model ids. */
			localLlmProbe(request) {
				return call("local-llm/probe", request);
			},
			/** Remove the stored local-model API key. */
			localLlmClearKey() {
				return call("local-llm/clear-key", {});
			},
			/** Read the progress buffer for one connect attempt. */
			connectProgress(attemptId) {
				return call("v1/connect/progress", { attemptId });
			},
			/** Aliases parsed from the client host's `~/.ssh/config`. */
			sshAliases() {
				return call("ssh-aliases", {});
			},
			/** Reconnect one saved target using the host-side pinned record and secret. */
			reconnect(targetId) {
				return call("v1/connect", { targetId });
			},
			/** Delete one saved target (profile stopped, local record and secret removed). */
			forget(targetId) {
				return call("forget-target", { targetId });
			},
			/** Stop one profile server through the v1 host route. */
			stop(targetId) {
				return call("v1/stop", { targetId });
			},
			/** Register one server directory as an official workspace. */
			workspaceCreate(targetId, path, title) {
				return call("workspace/create", {
					targetId,
					path,
					...title === void 0 ? {} : { title }
				});
			},
			/** Rename a server workspace (title only; never the directory). */
			workspaceRename(targetId, workspaceId, title) {
				return call("workspace/rename", {
					targetId,
					workspaceId,
					title
				});
			},
			/** Remove one workspace registration; 409 when sessions remain and no force. */
			workspaceDelete(targetId, workspaceId, force) {
				return call("workspace/delete", {
					targetId,
					workspaceId,
					...force === void 0 ? {} : { force }
				});
			},
			/** Persist the official workspace order (`beforeWorkspaceId` omitted = append). */
			workspaceReorder(targetId, workspaceId, beforeWorkspaceId) {
				return call("workspace/reorder", {
					targetId,
					workspaceId,
					...beforeWorkspaceId === void 0 ? {} : { beforeWorkspaceId }
				});
			},
			/** Server-mode new session: create/reuse a blank, then prepare the managed agent. */
			sessionCreate(params) {
				return call("session/create", {
					targetId: params.targetId,
					workspaceId: params.workspaceId,
					executor: params.executor,
					...params.sessionId === void 0 ? {} : { sessionId: params.sessionId }
				});
			},
			/** Open/resume one session through the host bridge (local mode reveal). */
			sessionOpen(params) {
				return call("session/open", {
					targetId: params.targetId,
					...params.workspaceId === void 0 ? {} : { workspaceId: params.workspaceId },
					sessionId: params.sessionId,
					...params.executor === void 0 ? {} : { executor: params.executor }
				});
			},
			/** Ensure the profile server holds the managed agent handle (server mode). */
			sessionPrepareServer(targetId, sessionId) {
				return call("session/prepare-server", {
					targetId,
					sessionId
				});
			},
			/** Rename a session (server-authoritative title). */
			sessionRename(targetId, sessionId, title) {
				return call("session/rename", {
					targetId,
					sessionId,
					title
				});
			},
			/** Fork a session (source must be opened/migrated when the server says so). */
			sessionFork(targetId, sessionId, options = {}) {
				return call("session/fork", {
					targetId,
					sessionId,
					...options.atSeq === void 0 ? {} : { atSeq: options.atSeq },
					...options.increaseTitle === void 0 ? {} : { increaseTitle: options.increaseTitle }
				});
			},
			/** Pin/unpin through the official registry set. */
			sessionPin(targetId, sessionId, pinned) {
				return call("session/pin", {
					targetId,
					sessionId,
					pinned
				});
			},
			/** Archive/unarchive; `stopActivity` is the official "stop and archive" retry. */
			sessionArchive(targetId, sessionId, archived, stopActivity) {
				return call("session/archive", {
					targetId,
					sessionId,
					archived,
					...stopActivity === void 0 ? {} : { stopActivity }
				});
			},
			/** Persist the official session order inside one workspace. */
			sessionReorder(targetId, workspaceId, sessionId, beforeSessionId) {
				return call("session/reorder", {
					targetId,
					workspaceId,
					sessionId,
					...beforeSessionId === void 0 ? {} : { beforeSessionId }
				});
			},
			/** Read-only server directory listing for the add-workspace dialog. */
			/** Create one directory below a connected target. */
			mkdir(targetId, path) {
				return call("mkdir", {
					targetId,
					path
				});
			},
			async fsList(targetId, path) {
				return normalizeFsList(await call("fs/list", {
					targetId,
					...path === void 0 ? {} : { path }
				}));
			},
			/** v2 server timeline for one session (P1 session/timeline adapter). */
			sessionTimeline(targetId, sessionId, options = {}) {
				return call("session/timeline", {
					targetId,
					sessionId,
					...options.afterSeq === void 0 ? {} : { afterSeq: options.afterSeq },
					...options.beforeSeq === void 0 ? {} : { beforeSeq: options.beforeSeq },
					...options.limit === void 0 ? {} : { limit: options.limit }
				});
			},
			/** Send one prompt to the server-side agent (server execution mode). */
			sessionPrompt(targetId, sessionId, text, extra = {}) {
				return call("session/prompt", {
					targetId,
					sessionId,
					text,
					...extra
				});
			},
			/** List the official slash commands available in a server session. */
			sessionCommands(targetId, sessionId) {
				return call("session/commands", {
					targetId,
					sessionId
				});
			},
			/** Execute one official slash command against a server session. */
			sessionCommand(targetId, sessionId, line) {
				return call("session/command", {
					targetId,
					sessionId,
					line
				});
			},
			/** List routable server models for the model seat. */
			sessionModelCatalog(targetId, sessionId) {
				return call("session/modelCatalog", {
					targetId,
					sessionId
				});
			},
			/** Persist one model selection on the server session. */
			sessionSelectModel(targetId, sessionId, provider, model, reasoningEffort) {
				return call("session/selectModel", {
					targetId,
					sessionId,
					provider,
					model,
					...reasoningEffort === void 0 ? {} : { reasoningEffort }
				});
			},
			/** Cancel the session's current turn. */
			sessionCancel(targetId, sessionId) {
				return call("session/cancel", {
					targetId,
					sessionId
				});
			},
			/** Allow/deny one pending approval (server-side agent). */
			sessionApproval(request) {
				const { targetId, ...body } = request;
				return call("session/approval", {
					targetId,
					...body
				});
			},
			/** Running/approval/status snapshot; polls the same authoritative server. */
			sessionStatus(targetId, sessionId) {
				return call("session/status", {
					targetId,
					sessionId
				});
			},
			/** Light refresh: reread workspace/session data; never restarts the profile. */
			stateRefresh(targetId) {
				return call("state/refresh", { targetId });
			},
			/** Reload the official workspace registry rows without stopping the process. */
			registryRefresh(targetId) {
				return call("registry/refresh", { targetId });
			},
			/** D20 preview for a profile restart (active turns + revision). */
			profileRestartPreview(targetId) {
				return call("profile/restart-preview", { targetId });
			},
			/** Restart the profile server after the preview was confirmed. */
			profileRestart(targetId, previewRevision) {
				return call("profile/restart", {
					targetId,
					confirmActiveTurns: true,
					previewRevision
				});
			},
			/** What would auto-install vs require a button for one connection (M3). */
			deploymentPreview(targetId) {
				return call("deployment/preview", { targetId });
			},
			/** Apply a deployment change; `confirm` is only ever set by the button. */
			deploymentApply(targetId, kind, confirm) {
				return call("deployment/apply", {
					targetId,
					kind,
					...confirm === void 0 ? {} : { confirm }
				});
			},
			/** D20 preview for an execution-end switch. */
			modePreview(targetId, nextMode, targetSessionId) {
				return call("mode/preview", {
					targetId,
					nextMode,
					...targetSessionId === void 0 ? {} : { targetSessionId }
				});
			},
			/** Apply a execution-end switch; must echo the preview revision. */
			modeApply(request) {
				return call("mode/apply", request);
			}
		};
		//#endregion
		//#region src/client/remote-data.ts
		/** Whether one server row is a visible conversation (not a draft/subagent). */
		function isConversation(session, options) {
			if (session.origin === "subagent") return false;
			if (session.blank) return false;
			if (session.archived && options.includeArchived === false) return false;
			return true;
		}
		/** Build the vendored-row model from one server session row. */
		function sessionNode(session) {
			return {
				id: session.sessionId,
				title: session.title ?? "",
				blank: session.blank,
				running: session.running,
				runningSubagentCount: 0,
				completed: false,
				pinned: session.pinned && !session.archived,
				archived: session.archived,
				updatedAt: session.updatedAt,
				...session.formatStatus === void 0 ? {} : { formatStatus: session.formatStatus },
				...session.titleSource === void 0 ? {} : { titleSource: session.titleSource },
				...session.executor === void 0 ? {} : { executor: session.executor },
				agentAvailable: session.agentAvailable
			};
		}
		/**
		* The one blank session a workspace may show as the temporary 「新会话」 row.
		*
		* Returns nothing for a blank session the client is not currently showing, so
		* the row only exists while its conversation is on screen; a stored blank that
		* is not selected is not a row.
		* @param workspace - the workspace whose members are inspected.
		* @param sessionsById - the loaded session list, keyed by id.
		* @param currentSessionId - the session the client currently shows.
		* @returns the draft row, or undefined when no selected blank belongs here.
		*/
		function currentBlankSession(workspace, sessionsById, currentSessionId) {
			if (currentSessionId === void 0 || currentSessionId === "") return void 0;
			if (!workspace.sessionIds.includes(currentSessionId)) return void 0;
			const session = sessionsById.get(currentSessionId);
			return session?.blank === true ? sessionNode(session) : void 0;
		}
		/**
		* Derive one workspace's session rows in official order.
		*
		* Membership comes from `workspace.sessionIds` (not from the global session
		* list order). Missing summaries are skipped: the account list is allowed to
		* lead the per-workspace pull. Pinned, non-archived rows lead in their member
		* order; every other row (including archived rows when shown) follows in member
		* order. The current blank is not part of this list; see
		* {@link currentBlankSession}.
		* @param workspace - the server workspace row.
		* @param sessionsById - the loaded sessions, keyed by id.
		* @param options - archived visibility.
		* @returns the derived conversation rows.
		*/
		function deriveSessionNodes(workspace, sessionsById, options = {}) {
			const members = [];
			for (const id of workspace.sessionIds) {
				const session = sessionsById.get(id);
				if (session !== void 0 && isConversation(session, options)) members.push(session);
			}
			const leading = members.filter((session) => session.pinned && !session.archived);
			const rest = members.filter((session) => !(session.pinned && !session.archived));
			return [...leading, ...rest].map(sessionNode);
		}
		/**
		* Group a full session list by workspace membership.
		* @param sessionList - the loaded sessions.
		* @returns every session indexed by its id, for the derivation helpers.
		*/
		function sessionsById(list) {
			const rows = Array.isArray(list) ? list : list.sessions;
			const map = /* @__PURE__ */ new Map();
			for (const session of rows) map.set(session.sessionId, session);
			return map;
		}
		/**
		* Derive every workspace row and its sessions for one connection.
		*
		* Workspaces keep the server's display order. A workspace with no loaded
		* session list still renders: its count falls back to the authoritative
		* membership size, which is the only fact the workspace row itself needs.
		* @param list - `workspace/list` value.
		* @param sessionList - `session/list` value, when the client has loaded it.
		* @param options - archived visibility and the currently shown session.
		* @returns the groups in server order.
		*/
		function deriveWorkspaceGroups(list, sessionList, options = {}) {
			const byId = sessionList === void 0 ? void 0 : sessionsById(sessionList);
			const groups = [];
			const workspaces = list?.workspaces;
			if (!Array.isArray(workspaces)) return groups;
			for (const workspace of workspaces) {
				const sessions = byId === void 0 ? [] : deriveSessionNodes(workspace, byId, options);
				const count = byId === void 0 ? workspace.sessionIds.length : sessions.length;
				const draft = byId === void 0 ? void 0 : currentBlankSession(workspace, byId, options.currentSessionId);
				groups.push({
					workspace: {
						workspaceId: workspace.workspaceId,
						path: workspace.path,
						title: workspace.title,
						createdAt: workspace.createdAt,
						updatedAt: workspace.updatedAt,
						sessionIds: workspace.sessionIds,
						sessionCount: count
					},
					sessions,
					...draft === void 0 ? {} : { draft }
				});
			}
			return groups;
		}
		//#endregion
		//#region src/client/session-approval.tsx
		/**
		* Tool-approval card for the v2 native timeline.
		*
		* One pending approval renders the tool name, the server's reason and the
		* public details, plus allow/deny buttons. Decisions are reported upward; this
		* component never talks to the host itself and never invents a default.
		*/
		//#endregion
		//#region src/client/session-composer.tsx
		/**
		* v2 conversation composer, rendered with the official 0.2.1-rc.3 DOM/CSS.
		*
		* The card, plus button, permission/model chips and circular send button are
		* the official DOM/CSS. The editable text is a contenteditable div because the
		* official Lexical instance is internal; slash commands, @ references,
		* attachments and clipboard images are implemented here against P1 callbacks.
		*/
		//#endregion
		//#region src/client/session-composer-official.tsx
		/**
		* Adapter that renders the real official rc.3 composer component.
		*
		* The component code and its CSS are loaded from the vendored official bundle
		* (`assets/official-ui`) instead of being reimplemented. This file supplies the
		* remote session's data, draft attachments, and the named control slots; the
		* editor, chips, buttons, menus, and DOM remain the upstream implementation.
		*/
		//#endregion
		//#region src/client/vendor/official-ui/styles.ts
		/**
		* GENERATED by scripts/vendor-official-ui.mjs — do not edit by hand.
		* Source: official Conversation/Chat CSS modules
		* Re-run the script after a DSH upgrade; see ../NOTICE.md.
		*/
		const OFFICIAL_UI_STYLES = String.raw`
/* ui-conversation/src/client/skeleton/ConversationRoot.module.css */
.dsh-rwv-conv-root {
  position: relative; /* positioning context for slot-owned absolute chrome */
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--dsw-alias-bg-base);
}

/* 76px with its rule: the height of the Sidebar's tab strip and header row
   (ui-dockkit \`.tabStrip\` 38px + the pane header's 38px), so the two rules
   meet at the column edge. The rows add up to it — 10px top inset, the 30px
   title row, the tab strip's 10px margin, and a 25px view row. When the views
   and the More launcher do not fit on one row, the row wraps and the header
   grows past 76px. */
.dsh-rwv-conv-header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  flex: none;
  box-sizing: border-box;
  min-height: 76px;
  padding: 10px 28px 0 20px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}

.dsh-rwv-conv-header:where(:not(:has(.dsh-rwv-conv-tabs))) {
  min-height: 0;
  padding-bottom: 10px;
}

/* Blank Sessions retain navigation controls without conversation title or tabs. */
.dsh-rwv-conv-headerBlank {
  min-height: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.dsh-rwv-conv-headerBlank .dsh-rwv-conv-headerCorner {
  margin-left: auto;
}

/* Only the macOS titlebar needs reserved drag space before a Session exists. */
:global(html:not([data-platform='darwin'])) .dsh-rwv-conv-headerSessionless {
  padding-top: 0;
}

:global(html:not([data-platform='darwin'])) .dsh-rwv-conv-headerSessionless .dsh-rwv-conv-titleRow {
  min-height: 0;
}

/* macOS hiddenInset titlebar: the header block owns the window drag over its
   own box — title row plus the view tab strip, so the draggable geometry is the
   header's geometry and no frame band has to match its height. The header marks
   itself \`data-window-drag\` (ConversationHeader); below it the title-row clusters
   subtract their whole boxes, and individual controls are covered by the base.css
   interactive-element rule. A covering overlay lives beside #root
   (ui-settings-general), which puts it after this row in document order. */
:global([data-platform='darwin']) .dsh-rwv-conv-headerLeading,
:global([data-platform='darwin']) .dsh-rwv-conv-headerActions,
:global([data-platform='darwin']) .dsh-rwv-conv-headerUtilities,
:global([data-platform='darwin']) .dsh-rwv-conv-headerCorner {
  -webkit-app-region: no-drag;
}

.dsh-rwv-conv-titleRow {
  grid-column: 2;
  /* Anonymous inline-size container (CSS modules hash container-names per
     module, so occupants match the nearest container): header occupants such
     as the preset label and slot actions shed their text at row-width
     breakpoints. The minmax(0, 1fr) column sizes the row, so inline-size
     containment cannot collapse it. */
  container-type: inline-size;
  display: flex;
  align-items: center;
  gap: 0;
  min-height: 30px;
  /* Clears the frame's window-chrome band (traffic lights + shell.leading
     controls, ui-layout AppFrame) when it is published; the header already
     pads 20px of it. Zero everywhere else (the fallback makes the max
     negative). */
  padding-inline-start: max(0px, calc(var(--dsh-frame-leading-clearance, 0px) - 20px));
}

.dsh-rwv-conv-titleCluster {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

/* The auto grid column collapses with an empty or CSS-hidden occupant.
   The occupant owns its trailing gap so hidden controls reserve no space. */
.dsh-rwv-conv-headerLeading {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
}

.dsh-rwv-conv-crumbs {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.dsh-rwv-conv-crumbSeg {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.dsh-rwv-conv-crumbSep {
  /* figma: "/" separators are 14px caption gray (75:7903), one tint lighter than crumb text. */
  color: var(--dsw-alias-label-caption);
  font-size: 14px;
  line-height: 20px;
}

.dsh-rwv-conv-crumb {
  display: inline-block;
  max-width: 220px;
  overflow: hidden;
  padding: 4px 8px;
  border: none;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  font-size: 14px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.dsh-rwv-conv-crumbSubagent {
  font-size: 12px;
  line-height: 18px;
}

button.dsh-rwv-conv-crumb:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-rwv-conv-crumbCurrent {
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  cursor: default;
}

.dsh-rwv-conv-headerActions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
}

.dsh-rwv-conv-headerUtilities {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  margin-left: 20px;
}

.dsh-rwv-conv-headerUtilities:empty {
  display: none;
}

/* The far-right corner seat reaches 16px into the header's 28px right padding,
   so its control sits past the utilities' edge; it is laid out only while its
   occupant renders something. Its left margin equals the utilities' 8px gap so
   the header's trailing controls space evenly. */
.dsh-rwv-conv-headerCorner {
  display: flex;
  flex: none;
  align-items: center;
  margin-left: 8px;
  margin-right: -16px;
}

.dsh-rwv-conv-headerCorner:empty {
  display: none;
}

/* The tab row sits above the header paint so the active bar covers its rule. */
.dsh-rwv-conv-tabs {
  grid-column: 1 / -1;
  position: relative;
  z-index: 1;
  display: flex;
  gap: 16px 20px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  align-items: flex-start;
  flex-wrap: wrap;
  margin-top: 10px;
  padding-left: 8px;
}

.dsh-rwv-conv-viewTabs {
  display: flex;
  flex-wrap: wrap;
  gap: 32px;
  min-width: 0;
  min-height: 25px;
}

/* The 16px text line retains 9px below it. The active bar reaches 1px past
   the tab box to sit over the header rule. */
.dsh-rwv-conv-tab {
  position: relative;
  min-height: 25px;
  padding: 0 0 9px;
  border: none;
  background: transparent;
  font-size: 13px;
  line-height: 16px;
  font-weight: 500;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

.dsh-rwv-conv-tab::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  border-radius: 2px;
  background: transparent;
}

/* Selected tab is blue, not ink: brand-primary resolves to neutral black in
   this token sheet, so the selected state rides the business blue — the
   nearest semantic token that stays blue in both themes. */
.dsh-rwv-conv-tabActive {
  color: var(--dsw-alias-state-business-primary);
}

.dsh-rwv-conv-tabActive::after {
  background: var(--dsw-alias-state-business-primary);
}

/* The More launcher centers its 22px box on the tab's 16px text line. */
.dsh-rwv-conv-viewsMoreAnchor {
  flex: none;
}

.dsh-rwv-conv-viewsMore {
  width: 22px;
  height: 22px;
  margin-top: -3px;
  padding: 0;
  color: var(--dsw-alias-label-secondary);
}

.dsh-rwv-conv-viewsMoreActive { color: var(--dsw-alias-state-business-primary); }

.dsh-rwv-conv-tabLabel { display: block; max-width: 88px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dsh-rwv-conv-viewsMore[aria-expanded='true'] {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-rwv-conv-viewsMoreMenu {
  width: 288px;
  max-width: calc(100vw - 24px);
}

.dsh-rwv-conv-viewArea {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

/* Width handles: 10px col-resize strips beside the transcript, absolute in
   .body (NOT the scrollport: an absolute strip there would extend the
   scrollable range; NOT .root: a strip from the column top would paint its
   glow through the header's transparent background). The inner edge sits
   24px outside the content column and the strip extends 10px outward; the
   outer edge is clamped to keep a 24px safe zone against the
   column edges (sidebar side and scrollbar side stay drag-free). When the
   margin cannot fit inset + strip + safe zone the computed width goes
   negative and the strip resolves to zero — no mispositioned hit area on
   narrow columns. Known half-scrollbar (~4px) centering offset vs the
   gutter-reserved content box is accepted: it consumes part of the 10px
   strip but remains within it. */
.dsh-rwv-conv-widthHandle {
  position: absolute;
  top: 0;
  bottom: 0;
  /* Concrete overflow content establishes z-index 1, while the sticky
     composer remains above both layers. */
  z-index: 0;
  width: min(
    10px,
    calc((100% - var(--dsh-chat-content-width)) / 2 - 24px - 24px)
  );
  cursor: col-resize;
}

.dsh-rwv-conv-widthHandle[data-side='left'] {
  right: calc(50% + var(--dsh-chat-content-width) / 2 + 24px);
}

.dsh-rwv-conv-widthHandle[data-side='right'] {
  left: calc(50% + var(--dsh-chat-content-width) / 2 + 24px);
}

/* The glow: a short 2px bar following the captured pointer's Y, centered in the strip
   (29px from the content column), not a full-height rule — a 16px solid core
   centered on the pointer
   (published during drag as --dsh-width-handle-pointer-y), fading to
   transparent over 28px each side (72px total). A solid CORE, not a single
   solid stop: a lone peak washes out over the fade. The resting scrollbar
   tint keeps this secondary affordance quiet in both themes. Before the first
   drag move the fallback centers the glow at 50% height; hover leaves its position unchanged. */
.dsh-rwv-conv-widthHandle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  border-radius: 2px;
  background: linear-gradient(
    to bottom,
    transparent calc(var(--dsh-width-handle-pointer-y, 50%) - 36px),
    var(--dsw-alias-scrollbar-bg-l1) calc(var(--dsh-width-handle-pointer-y, 50%) - 8px),
    var(--dsw-alias-scrollbar-bg-l1) calc(var(--dsh-width-handle-pointer-y, 50%) + 8px),
    transparent calc(var(--dsh-width-handle-pointer-y, 50%) + 36px)
  );
  opacity: 0;
  pointer-events: none;
}

.dsh-rwv-conv-widthHandle[data-side='left']::after {
  right: 4px;
}

.dsh-rwv-conv-widthHandle[data-side='right']::after {
  left: 4px;
}

.dsh-rwv-conv-widthHandle:hover::after,
.dsh-rwv-conv-widthHandle[data-dragging]::after {
  opacity: 1;
}

/* A drag starts above the composer band. Pointer capture keeps it active when
   crossing the footer; lift only the active handle so its indicator remains
   visible without making the resting footer gutter draggable. */
.dsh-rwv-conv-widthHandle[data-dragging] {
  z-index: 8;
}

/* Views that elect a composer overlay (trajectory etc.) own their full-bleed
   scrollers; the strips would sit over their content and steal clicks. */
.dsh-rwv-conv-root:has([data-conversation-composer-overlay]) .dsh-rwv-conv-widthHandle {
  display: none;
}

/* Composer context stack (Figma 9:937): standalone dock cards share one
   rhythm above the input card. */
.dsh-rwv-conv-composerStack {
  /* Horizontal geometry (card width, clearance, dock inset) rides the shared
     .root variables above so takeover siblings match the stack. */
  --dsh-composer-stack-gap: 6px;

  display: flex;
  flex-direction: column;
  gap: var(--dsh-composer-stack-gap);
}

/* Common seat for the composer chain (fallback + elected overlay siblings). */
.dsh-rwv-conv-composerSeat {
  display: flex;
  flex: none;
  flex-direction: column;
  /* One cap for every scrolling text region a composer seat can hold: the
     InputBar draft (figma Input 75:8208 max 14 lines × 24px line) and the
     takeover panels' bodies top out at the same height, so electing a
     takeover never grows the footer past the card it replaces. Declared on
     the seat because it is the chain's only shared ancestor — fallback and
     elected overlay are siblings — and custom properties inherit down to
     whichever entry is mounted. */
  --dsh-composer-text-max-height: 336px;
}

/* Active phase: header is ordinary column chrome above the scrollport (not
   sticky). The scroll body holds the transcript and the sticky composer seat
   so wheel over the footer moves the flow. */
.dsh-rwv-conv-root[data-phase='active'] {
  overflow: hidden;
}

.dsh-rwv-conv-root[data-phase='active'] .dsh-rwv-conv-header {
  flex: none;
}

/* Band below the header: the scrollport plus the width handles. Anchoring the
   handles here keeps their full-height strips and glow under the header's
   bottom edge at every header height. */
.dsh-rwv-conv-body {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;

  /* Shared width axis for the transcript, dock cards, composer, and takeover
     cards. Main width controls publish the live body width and optional user
     preference; embedded occurrences override this adaptive axis below. */
  --dsh-chat-content-width: var(
    --dsh-chat-user-width,
    clamp(680px, calc(var(--dsh-conversation-column-width, 0px) * 0.64), 920px)
  );
  --dsh-composer-card-max-width: calc(var(--dsh-chat-content-width) + 32px);
  --dsh-composer-side-clearance: 16px;
  --dsh-composer-dock-inset: 8px;
}

.dsh-rwv-conv-embeddedBody {
  overflow: hidden;
  --dsh-chat-content-width: min(calc(100% - 32px), 920px);
  --dsh-composer-card-max-width: min(calc(100% - 16px), 952px);
  --dsh-composer-side-clearance: 8px;
  --dsh-composer-dock-inset: 8px;
}

.dsh-rwv-conv-scrollBody {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  /* The product-wide 2px scrollbar offset (ui-workspace WorkspaceBrowser
     \`.list\`, ui-sidebar-files FilesBody \`.body\`): the bar sits 2px clear of
     the column's edge instead of flush against it. */
  margin-right: 2px;
  overflow-y: auto;
  /* Reserved unconditionally: the composer seat rides this box's content box in
     Chat and its padding box under a view's composer overlay, so an \`auto\`
     gutter moves the input card sideways by the bar's width whenever the two
     differ ([decision](../../../../../../.agents/notes/archived/bug-fix/2026-08-04-composer-tab-gutter-reservation.md)). */
  scrollbar-gutter: stable;
}

/* The bar also stops 2px short of the scroller's ends, matching its 2px edge
   offset. WebKit-only: the Firefox path has no track to inset. */
.dsh-rwv-conv-scrollBody::-webkit-scrollbar-track {
  margin: 2px;
}

.dsh-rwv-conv-root[data-phase='active'] .dsh-rwv-conv-viewArea,
.dsh-rwv-conv-embeddedBody[data-content-phase='active'] .dsh-rwv-conv-viewArea {
  flex: 1 0 auto;
  min-height: auto;
}

.dsh-rwv-conv-root[data-phase='active'] .dsh-rwv-conv-composerSeat,
.dsh-rwv-conv-embeddedBody[data-content-phase='active'] .dsh-rwv-conv-composerSeat {
  position: sticky;
  bottom: 0;
  /* Above markdown CodeBlock sticky banners (z-index 6) so the footer never
     paints under a sticking code header while scrolling. The pinned compaction
     header (MessageItem.module.css, ui-chat) and the turn-navigation rail slot
     (TurnNavigator.module.css, ui-chat) also take 7 to clear the same banners.
     Among elements of equal rank the later one in DOM order wins, so the
     composer stays above the pinned header on the extreme small-viewport
     overlap and the pinned header stays above the rail. */
  z-index: 7;
  /* Input mask (figma 1205:27463): transcript fades out under a FIXED 36px
     band at the seat's top (the figma 24% of the resting ~150px composer),
     solid below — px stops, not %, so a growing draft only widens the solid
     region and the fade band never stretches. The 0px stop is bg-base at
     zero alpha (not white, which the figma export hardcodes) so both themes
     fade from their own base. */
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0px,
    var(--dsw-alias-bg-base) 36px
  );
}

/* An open @/slash menu (data-trigger-menu, ui-input-trigger) renders inside
   the input card, so the seat's stacking context caps its z-index; lift the
   seat above the back-to-bottom control (z-index 8, ui-chat ChatView) while
   the menu is open. The steady state stays 7 so the control keeps painting
   over the card. */
.dsh-rwv-conv-root[data-phase='active'] .dsh-rwv-conv-composerSeat:has([data-trigger-menu]) {
  z-index: 9;
}

/* Views may opt into a composer overlay while ConversationRoot retains
   ownership of the seat geometry and its active-phase precedence. */
.dsh-rwv-conv-scrollBody:has([data-conversation-composer-overlay]) {
  position: relative;
  /* A clipping box nothing scrolls out of, stated as a scroll container on both
     axes rather than \`overflow: hidden\`: a single-axis scroller computes the
     other axis to \`auto\`, and the seat's absolute positioning below needs the
     box to stay a containing block in every engine. */
  overflow-x: hidden;
  overflow-y: auto;
  /* The view owns its own scrollers (the trajectory ledger scrolls inside the
     view), so this box never scrolls here; reserving a gutter would only
     narrow the view's content by the bar's width. Chat keeps the reservation
     on the same element, so the seat below compensates with the bar's width
     ([decision](../../../../../../.agents/notes/archived/bug-fix/2026-08-04-composer-tab-gutter-reservation.md)). */
  scrollbar-gutter: auto;
}

.dsh-rwv-conv-scrollBody:has([data-conversation-composer-overlay]) > :global([data-slot='conversation.session']) > .dsh-rwv-conv-viewArea {
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}

.dsh-rwv-conv-scrollBody:has([data-conversation-composer-overlay]) > .dsh-rwv-conv-composerSeat {
  position: absolute;
  /* Chat's seat rides this box's content box, which its own scrolling shortens
     by the bar's width; the overlay seat is against the padding box, so it
     must give back the same width to keep the input card in place across
     tabs. Reads ui-theme's --dsh-scrollbar-width, which mirrors the WebKit
     bar's layout width. Chat reserves the engine-resolved width, so on an
     engine where the resolved width differs from this fixed 8px the card
     drifts by half the difference — accepted residual risk, recorded in
     ([decision](../../../../../../.agents/notes/archived/bug-fix/2026-08-12-composer-overlay-seat-width-compensation.md)). */
  right: var(--dsh-scrollbar-width);
  bottom: 0;
  left: 0;
}

/* Hero phase: the composer stack (hero chrome + workspace row + card) is
   flex-centered in the column; composer phase docks it at the bottom. Flex,
   NOT absolute+transform: a transform would make this box the containing
   block for position:fixed descendants (pickers/modals), shrinking them. */
.dsh-rwv-conv-composerHero {
  align-self: center;
  /* figma 75:8208 drew 12 between all three rows; the workspace row now sits
     8 above the card (its margin-top restores 12 under the hero chrome). */
  gap: 8px;
  /* Foot inside the centered box floats the stack a bit above true center. */
  padding-bottom: 32px;
  /* Card cap + both clearances: the hero input card lands at exactly the same
     width as the docked composer at every viewport. */
  width: min(calc(var(--dsh-composer-card-max-width) + 2 * var(--dsh-composer-side-clearance)), 100%);
  z-index: 1;
}

.dsh-rwv-conv-heroWorkspaceRow {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  margin-top: 4px;
  /* figma drew px 8; left nudged +12 so the chip's folder glyph lines up
     closer to the card's inner controls below; right keeps the trailing
     preset seat off the card edge. */
  padding: 0 16px 0 20px;
}

/* Plugin options share the row, pushed to its right edge. */
.dsh-rwv-conv-heroOptions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  min-width: 0;
  margin-left: auto;
}

.dsh-rwv-conv-heroOptions:empty {
  display: none;
}

/* Hero: the composer sits inside the session scroll body; center there so
   the tree seat matches active (sticky footer) without a Root remount. */
.dsh-rwv-conv-root[data-phase='hero'] .dsh-rwv-conv-scrollBody,
.dsh-rwv-conv-embeddedBody[data-content-phase='hero'] .dsh-rwv-conv-scrollBody {
  justify-content: center;
  overflow-y: auto;
}

/* Settling (session replaying, hero/docked unknown): keep the composer seat
   mounted but invisible so no wrong layout flashes before the phase lands. */
.dsh-rwv-conv-root[data-phase='settling'] .dsh-rwv-conv-composerSeat,
.dsh-rwv-conv-embeddedBody[data-content-phase='settling'] .dsh-rwv-conv-composerSeat {
  visibility: hidden;
}


/* ui-conversation/src/client/skeleton/HeroShell.module.css */
/* NEW SESSION hero (figma Input_Bottom 75:8208): fish + title, workspace chip
   above the shared InputBar card. The input itself is InputBar — only stack
   geometry and the chip live here. */

.dsh-rwv-hero-root {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-width: 0;
  padding: 0 24px;
}

/* Cap matches the InputBar card. Glow may paint past the sides. */
.dsh-rwv-hero-stack {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  /* figma 75:8208: 12 between title block / workspace / card. */
  gap: 12px;
  width: 100%;
  max-width: var(--dsh-composer-card-max-width);
  overflow: visible;
}

/* figma 34:10411: fish + title, gap 10, centered; 26/32 wt500. The preview
   badge is a product addition outside that source: a mono superscript pill
   riding the title's top-right. */
.dsh-rwv-hero-headline {
  display: flex;
  /* Overflow-driven: the fish and the title group are two wrap units sharing
     one centered line while they fit; squeezed, the fish takes its own line
     above the group. No breakpoint. */
  flex-wrap: wrap;
  column-gap: 10px;
  /* Wrapped, the fish sits on its own line; more air than the 10px side gap
     keeps it reading as a mark above the title, not a squeezed inline glyph. */
  row-gap: 12px;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  line-height: 32px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}

/* Title text + badge as one wrap unit so the title never breaks mid-text with
   the badge stranded beside a fragment. When the badge no longer fits beside
   the title it wraps to its own centered line below; while both fit, the group
   is content-sized and centering is a no-op, keeping the superscript snug. */
.dsh-rwv-hero-titleGroup {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  /* Superscript sits 7 from the title. */
  column-gap: 7px;
  row-gap: 4px;
  min-width: 0;
}

.dsh-rwv-hero-previewBadge {
  align-self: flex-start;
  margin-top: 2px;
  padding: 1px 7px 0;
  border: 0.5px solid var(--dsw-alias-interactive-bg-hover);
  border-radius: 999px;
  corner-shape: round;
  background: var(--dsw-alias-state-business-tertiary);
  color: var(--dsw-alias-label-primary-bluish);
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  white-space: nowrap;
}

/* Keep hover detection on a stationary box while the mark moves within it;
   hover rules target the hitbox so a slot-occupant mark swims too. */
.dsh-rwv-hero-fishHitbox {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
}

/* The swim morph's curves poke slightly past the viewBox edges, so clipping
   would slice the tail mid-wag. The hero mark stays in the same primary ink
   as its headline. */
.dsh-rwv-hero-fish {
  display: block;
  overflow: visible;
  transform-origin: 50% 60%;
  color: var(--dsw-alias-label-primary);
}

/* Hover swim: a slow continuous sway about the body center — the head
   (left) lifts as the whale rises, then settles back with a small
   counter-tilt, like treading water. Negative rotation = head up (the head
   is the left half; origin 50% 60%). */
@keyframes hero-fish-swim {
  0%,
  100% {
    transform: none;
  }

  35% {
    transform: rotate(-4deg) translate(-0.4px, -0.9px);
  }

  70% {
    transform: rotate(1.6deg) translate(0.3px, 0.2px);
  }
}

@media (hover: hover) and (prefers-reduced-motion: no-preference) {
  .dsh-rwv-hero-fishHitbox:hover .dsh-rwv-hero-fish {
    animation: hero-fish-swim 1.6s ease-in-out infinite;
  }
}

/* Workspace row sits 12px above the input card (figma y80 → y112). */
.dsh-rwv-hero-body {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  overflow: visible;
}

.dsh-rwv-hero-body > * {
  position: relative;
  z-index: 1;
}

/* Must beat \`.body > :not(.glow)\` specificity so the open Menu (and its
   right-hand submenu) paints above the InputBar card. */
.dsh-rwv-hero-body > .dsh-rwv-hero-workspaceRow {
  z-index: 10;
  display: flex;
  align-items: center;
  min-width: 0;
  /* figma 75:8208 workspace row: px 8 above the card. */
  padding-left: 8px;
}

/* Folder + label + chevron — transparent at rest; fill only on hover / open.
   Overflow-driven degradation, no breakpoint: the label shrinks with an
   ellipsis down to nothing, so folder and chevron always sit snug against
   whatever text remains — full text, ellipsized text, or none. */
.dsh-rwv-hero-workspace {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: min(100%, 360px);
  min-height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  cursor: pointer;
}

.dsh-rwv-hero-workspace:not(:disabled):hover,
.dsh-rwv-hero-workspace[aria-expanded='true'] {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* Locked form (bound guidance state): a static echo — no hover feedback, no
   pointer affordance; label keeps full contrast. */
.dsh-rwv-hero-workspace:disabled {
  cursor: default;
}

.dsh-rwv-hero-folder {
  flex: none;
  color: var(--dsw-alias-label-primary);
}

.dsh-rwv-hero-workspaceLabel {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-rwv-hero-chevron {
  flex: none;
  color: var(--dsw-alias-label-caption);
}

/* Dialog field: 44 tall on the modal's 332 content column, hairline
   border, pad 14/7, 14/22 wt400 primary text, caption placeholder. Focus
   keeps the resting border (design shows no focus ring). */
.dsh-rwv-hero-modalInput {
  box-sizing: border-box;
  width: 100%;
  height: 44px;
  padding: 7px 14px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-lg);
  outline: none;
  background: transparent;
  font-size: 14px;
  font-weight: 400;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
}

.dsh-rwv-hero-modalInput::placeholder {
  color: var(--dsw-alias-label-caption);
}

.dsh-rwv-hero-modalInput:disabled {
  color: var(--dsw-alias-label-dimmed);
}

.dsh-rwv-hero-modalAction {
  min-width: 72px;
}

.dsh-rwv-hero-modalError {
  margin-top: 8px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
}


/* ui-conversation/src/client/skeleton/InputBar.module.css */

.dsh-rwv-input-root {
  display: flex;
  flex-direction: column;
  align-items: center;
  /* Side pads ride the shared clearance (figma Input_Bottom drew L32/R32/B8;
     the sides narrow with the shared width axis); the bottom gradient mask
     is owned by the chat scroller. No top pad: the composer stack's gap owns
     the space above; the status strip still carries its own margin. */
  padding: 0 var(--dsh-composer-side-clearance) 4px;
}

.dsh-rwv-input-dock {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  max-width: 100%;
  padding-top: 4px;
}

.dsh-rwv-input-hero .dsh-rwv-input-dock:empty {
  display: none;
}

.dsh-rwv-input-hero {
  /* No bottom pad in the centered hero, but the side clearance must survive:
     the hero wrapper is full-width on narrow viewports, so this padding is
     the only thing keeping the card off the edges there. */
  padding: 0 var(--dsh-composer-side-clearance);
}

.dsh-rwv-input-notice {
  width: 100%;
  max-width: var(--dsh-composer-card-max-width);
  margin-bottom: 6px;
  padding: 4px 8px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}

.dsh-rwv-input-card {
  box-sizing: border-box;
  position: relative; /* overlay anchor positioning context */
  display: flex;
  flex-direction: column;
  /* figma Input 75:8208: 12px between the text area and the button row; the
     card's top pad before .InputText tightened from the drawn 10 to 8. */
  gap: 12px;
  width: 100%;
  max-width: var(--dsh-composer-card-max-width);
  padding-top: 8px;
  /* Input stroke: the light neutral (l2, one step above the menus' l1),
     drawn as the elevation hairline so it costs no layout; the shadow is the
     soft elevation tier. Fill: the input surface token (elevated in dark). */
  border: 0;
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-panel);
  background: var(--dsw-specific-input-major);
  box-shadow: var(--dsw-elevation-soft);
  /* The draft text follows the Settings font-size preference (the textarea,
     mirror, and backdrop all inherit from here, so the three layers stay in
     step); the line height keeps the default 10px leading via the shared px
     delta. */
  font-size: var(--dsh-content-font-size, 14px);
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));
  /* Elevated surface in dark, same as the menus: the draft scrollport inside
     scrolls once the composer hits its height cap, so the thumb takes the l2
     pair. Declared on the card because the elevation belongs to the surface,
     and the custom properties inherit down to the box that actually scrolls
     (see ui-theme styles/scrollbar.css for the rebinding contract). */
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

/* No-workspace trigger state: an inset 1px dashed outline marks the card as a
   workspace picker rather than a live composer. Keeping the complete stroke
   inside the rounded box prevents clipped corner pixels from reading heavier. */
.dsh-rwv-input-cardWorkspaceTrigger {
  --dsw-elevation-stroke-color: transparent;
  cursor: pointer;
}

.dsh-rwv-input-cardWorkspaceTrigger::after {
  content: '';
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  border: 1px dashed currentColor;
  border-radius: var(--dsw-radius-panel);
  color: var(--dsw-alias-border-l4);
  transition: color 100ms ease;
  pointer-events: none;
}

/* Disabled toolbar controls neither receive nor swallow clicks in the trigger
   state: pointer events fall through to the card's own click handler, making
   the whole card one pick target. */
.dsh-rwv-input-cardWorkspaceTrigger :disabled {
  pointer-events: none;
}

.dsh-rwv-input-cardWorkspaceTrigger:hover::after {
  color: var(--dsw-alias-state-business-primary);
}

.dsh-rwv-input-accessory {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 0;
}

/* Floating overlay anchor (menu / popupSelect shell): entries position
   themselves against the card (bottom: 100% + gap); closed entries render null. */
.dsh-rwv-input-overlayAnchor {
  position: absolute;
  inset: 0 0 auto;
  height: 0;
}

/* The draft's scrollport, and the ONLY scrolling box in the composer. The
   contenteditable grows with its content inside; the 14-line cap lives here
   because this is the box the cap describes. */
.dsh-rwv-input-scroll {
  max-height: var(--dsh-composer-text-max-height);
  overflow-y: auto;
  /* Keeps the bar off the card's right border; .input's right pad gives the
     4px back so the text column is unchanged. */
  margin-right: 4px;
}

/* The card's corner arc still overlaps the scrollport's top (8px top
   pad reaches only y=8): start the thumb's travel below the arc so it never
   pokes outside the capsule. WebKit-path only; Firefox's thin bar has no
   track margin, an accepted remainder. */
.dsh-rwv-input-scroll::-webkit-scrollbar-track {
  margin-top: 8px;
}

/* Auto-grow anchor: the contenteditable is in normal flow and sets the
   draft's height; the placeholder rides it absolutely. */
.dsh-rwv-input-grow {
  position: relative;
}

/* Machine pending dot (adjudicating / submitting). */
.dsh-rwv-input-pending {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  corner-shape: round;
  background: var(--dsw-alias-state-business-primary);
  animation: input-pending 1s ease-in-out infinite alternate;
}

@keyframes input-pending {
  from { opacity: 0.35; }
  to { opacity: 1; }
}

/* The contenteditable draft surface (grows with its content; .scroll caps
   and scrolls it). figma .InputText 34:10434 drew pl 16 / pr 12 / pt 4; the
   left pad tightened to 14, and the right pad is 8 here plus .scroll's 4px
   bar inset. */
.dsh-rwv-input-input {
  box-sizing: border-box;
  /* Docked floor: one 24px line + 4px top pad = 28 content height; 36 leaves
     an 8px breath below the line (the hero keeps its own 52px floor below). */
  min-height: 36px;
  padding: 4px 8px 0 14px;
  font-family: var(--dsw-font-family);
  font-size: inherit;
  line-height: inherit;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  outline: none;
  color: var(--dsw-alias-label-primary);
  /* Business blue, not brand-primary: that token resolves to ink in this sheet. */
  caret-color: var(--dsw-alias-state-business-primary);
}

/* Lexical paragraphs are <p> blocks: strip the UA margins so the surface
   keeps the textarea's line rhythm. */
.dsh-rwv-input-input p {
  margin: 0;
}

/* Claim ghost hint as generated content after the last paragraph: the bar
   sets --dsh-composer-hint (a quoted string) while the claim's args are
   blank; without the variable the declaration is invalid and nothing shows. */
.dsh-rwv-input-input p:last-child::after {
  content: var(--dsh-composer-hint);
  color: var(--dsw-alias-label-caption);
}

.dsh-rwv-input-input[data-composer-composing] p:last-child::after {
  content: none;
}

/* A selected command chip stands in for the caret until the next key. */
.dsh-rwv-input-input[data-composer-chip-selected] {
  caret-color: transparent;
}

.dsh-rwv-input-input[data-composer-composing] + .dsh-rwv-input-placeholder {
  visibility: hidden;
}

/* figma 34:10434: #ADB2B8 light / #81858C dark — the caption pair exactly.
   Insets mirror .input's pads (the other right 4px sits on .scroll). One
   ellipsized line: a wrapped second line would clip against the docked
   36px floor. */
.dsh-rwv-input-placeholder {
  position: absolute;
  inset: 4px 8px auto 14px;
  color: var(--dsw-alias-label-caption);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  user-select: none;
}

.dsh-rwv-input-inputDisabled {
  color: var(--dsw-alias-label-tertiary);
  cursor: not-allowed;
}

.dsh-rwv-input-input[aria-haspopup='menu'] {
  cursor: pointer;
}

/* Hero (centered empty-state) keeps the 2-line floor (figma min-h 52 = ~2 × 24
   line + 4pt); the docked composer collapses to the content height. */
.dsh-rwv-input-hero .dsh-rwv-input-input {
  min-height: 52px;
}

/* The hero's 52px floor fits two lines, so its placeholder clamps at two
   instead of the docked single line. */
.dsh-rwv-input-hero .dsh-rwv-input-placeholder {
  white-space: normal;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

/* Toolbar: attach + Plan + Read-only on the left; model + send on the right
   (figma Input_Bottom chrome). */
.dsh-rwv-input-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  /* 2px moved from the bottom pad to the top: the whole control row sits 2px
     lower in the card (it read too high against the textarea) while the
     controls' own centering stays untouched. */
  padding: 2px 8px 6px;
  min-width: 0;
  /* Size container so the chips inside can collapse to icon-only when the
     card runs out of row width (PermissionSelect @container rule). Anonymous
     on purpose: CSS modules hash container-name per module, so a name declared
     here can never match a query in another module's sheet. */
  container-type: inline-size;
}

.dsh-rwv-input-row[data-model-compact] {
  --dsh-composer-model-text-display: none;
  --dsh-composer-model-icon-display: block;
}

.dsh-rwv-input-tools,
.dsh-rwv-input-modes,
.dsh-rwv-input-trailing {
  display: flex;
  align-items: center;
  min-width: 0;
}

/* figma 75:8208 drew 16 between + and the mode chips and 4 between Plan /
   Read-only; both gaps settled on 12 so the pill chips read as separate
   controls without drifting from the + control. */
.dsh-rwv-input-tools {
  gap: 12px;
}

.dsh-rwv-input-modes {
  gap: 12px;
}

.dsh-rwv-input-trailing {
  flex: none;
  /* Wrap keeps the left mode chips and the right controls apart when the card
     runs out of row width: the trailing group (model + send) moves to its own
     line instead of the left group shrinking until its chip overlaps the
     model trigger (external:107). The auto margin re-anchors it right on the
     wrapped line; on a single line space-between already pins it right. */
  margin-left: auto;
  gap: 12px;
}

/* Compact spacing preserves room for the fixed-width controls in narrow cards. */
@container (max-width: 560px) {
  .dsh-rwv-input-tools,
  .dsh-rwv-input-modes,
  .dsh-rwv-input-trailing {
    gap: 8px;
  }
}

/* Attach circle (figma + control): 28px, selector fill, primary glyph. */
.dsh-rwv-input-add {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 999px;
  corner-shape: round;
  background: var(--dsw-specific-selector);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.dsh-rwv-input-add:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-solid);
}

.dsh-rwv-input-add:disabled {
  opacity: 0.5;
  cursor: default;
}

/* Plan / Read-only / model — native <select>, chip-like closed chrome
   (figma ToggleButton: 13/20 medium secondary, 12px chevron). */
.dsh-rwv-input-select {
  max-width: 220px;
  height: 28px;
  padding: 0 20px 0 8px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  outline: none;
  background-color: transparent;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 4px center;
  background-size: 12px 12px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  appearance: none;
}

.dsh-rwv-input-select:hover:not(:disabled) {
  background-color: var(--dsw-alias-interactive-bg-hover);
}

.dsh-rwv-input-select:disabled {
  opacity: 0.5;
  cursor: default;
}

/* Primary send (figma IconButton 34:10465): 34px circle, #3964FE light /
   #679EFE dark — the info-fill pair (500→400), NOT button-primary (ink);
   white glyph; empty text = 0.4 opacity. */
.dsh-rwv-input-primary {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 999px;
  corner-shape: round;
  background: var(--dsw-alias-button-info-fill);
  /* Static white, not the foreground token: the arrow stays white on the blue
     fill in both themes (design 34:10465). */
  color: #fff;
  cursor: pointer;
  transition: background-color 100ms ease;
  /* Opts out of the row's 2px downward shift (.row top pad): the send circle
     keeps its original seat while the smaller chips sit lower. Transform, not
     margin, so flex centering math is untouched. */
  transform: translateY(-2px);
}

.dsh-rwv-input-primary:hover:not(:disabled) {
  background: var(--dsw-alias-button-info-hover);
}

.dsh-rwv-input-primary:disabled {
  opacity: 0.4;
  cursor: default;
}

.dsh-rwv-input-retry {
  margin-left: 8px;
  padding: 1px 8px;
  border: 1px solid currentColor;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}

.dsh-rwv-input-standardControls { display: flex; align-items: center; gap: 12px; min-width: 0; }
.dsh-rwv-input-tools[hidden], .dsh-rwv-input-standardControls[hidden] { display: none; }
.dsh-rwv-input-trailingActive { flex: 1; margin-left: 0; }
.dsh-rwv-input-activity { display: flex; align-items: center; flex: none; }
.dsh-rwv-input-activity:empty { display: none; }
.dsh-rwv-input-activityExpanded { flex: 1; min-width: 0; }


/* ui-chat/src/client/chat/ChatView.module.css */
.dsh-rwv-chat-frame {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
  /* Floating controls query this frame outside the clipped transcript. */
  container-type: inline-size;
}

.dsh-rwv-chat-root {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;

  overflow-x: visible;
  overflow-y: clip;
}

.dsh-rwv-chat-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  /* Sides = composer clearance + 16px: on narrow viewports the transcript
     stays exactly 32px narrower than the input card (the shared width rule). */
  padding: 16px calc(var(--dsh-composer-side-clearance) + 16px);
  /* Inline-size query container: wide markdown tables size their breakout
     against this box's content width (100cqw in AssistantMarkdown's
     md-table-wide rule) — the CSS stand-in for deepsuite chat's JS-measured
     --dsl-virtual-list-width. */
  container-type: inline-size;
}

.dsh-rwv-chat-root[data-chat-following-tail] .dsh-rwv-chat-scroll,
:global([data-conversation-scroll]):has(.dsh-rwv-chat-root[data-chat-following-tail]) {
  overflow-anchor: none;
}

:global([data-conversation-scroll]) .dsh-rwv-chat-frame,
:global([data-conversation-scroll]) .dsh-rwv-chat-root {
  flex: 0 0 auto;
  min-height: auto;
  height: auto;
}

:global([data-conversation-scroll]) .dsh-rwv-chat-scroll {
  overflow: visible;
  flex: 0 0 auto;
  min-height: auto;
}

/* Message column: shared chat width (ConversationRoot --dsh-chat-content-width),
   centered on the same axis as the input box (which caps at chat + 16px); the
   scroller itself stays full-bleed. */
.dsh-rwv-chat-column {
  max-width: var(--dsh-chat-content-width);
  width: 100%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
}

/* The flow slot's display:contents anchor preserves layout but not selector ancestry.
   \`hidden="until-found"\` retains a searchable zero-height box; hidden and empty
   Seats do not contribute spacing. */
:is(.dsh-rwv-chat-column, :global([data-slot="conversation.chat.flow"])) > :not([hidden]):not(.dsh-rwv-chat-flowItem:is(:empty, :has(> [data-slot="conversation.chat.node"]:empty)))
  ~ :not([hidden]):not(.dsh-rwv-chat-flowItem:is(:empty, :has(> [data-slot="conversation.chat.node"]:empty))),
.dsh-rwv-chat-column:has(> .dsh-rwv-chat-older) > :global([data-slot="conversation.chat.flow"])
  > :not([hidden]):not(.dsh-rwv-chat-flowItem:is(:empty, :has(> [data-slot="conversation.chat.node"]:empty))) {
  margin-top: var(--dsh-chat-flow-gap, 6px);
}

/* Process rows sit 6px apart; an Assistant response is separated from its
   neighbours by 12px. */
.dsh-rwv-chat-flowItem[data-chat-group-part="response"] {
  --dsh-chat-flow-gap: 12px;
}

:is(.dsh-rwv-chat-column, :global([data-slot="conversation.chat.flow"])) > [data-chat-group-part="response"]:not([hidden]):not(:empty)
  + :not([hidden]):not(.dsh-rwv-chat-flowItem:is(:empty, :has(> [data-slot="conversation.chat.node"]:empty))):not(.dsh-rwv-chat-running) {
  --dsh-chat-flow-gap: 12px;
}

/* Settled-flow identity boundary. It is neutral until it becomes the natural
   measurement/mount unit for a virtualizer without changing the column gap. */
.dsh-rwv-chat-flowItem {
  min-width: 0;
}

/* Bottom room: sized by the viewport owner while rows above the reader close,
   given back only as later content grows into it. */
.dsh-rwv-chat-turnSpacer {
  height: 0;
}

/* While a Turn folds, spacing changes share the closing rows' timing. */
.dsh-rwv-chat-column[data-chat-motion] > :not([data-chat-motion]),
.dsh-rwv-chat-column[data-chat-motion] > :global([data-slot="conversation.chat.flow"]) > :not([data-chat-motion]) {
  transition: margin-top 160ms cubic-bezier(0.4, 0, 0.2, 1);
}

.dsh-rwv-chat-column[data-input-fold] > :not([data-chat-motion]),
.dsh-rwv-chat-column[data-input-fold] > :global([data-slot="conversation.chat.flow"]) > :not([data-chat-motion]) {
  transition: none;
}

@media (prefers-reduced-motion: reduce) {
  .dsh-rwv-chat-column[data-chat-motion] > :not([data-chat-motion]),
  .dsh-rwv-chat-column[data-chat-motion] > :global([data-slot="conversation.chat.flow"]) > :not([data-chat-motion]) {
    transition: none;
  }
}

/* The Turn header has 16px clearance from its input and following content. */
.dsh-rwv-chat-flowItem[data-chat-flow-kind="turn-process"],
.dsh-rwv-chat-flowItem[data-turn-process-answer],
:is(.dsh-rwv-chat-column, :global([data-slot="conversation.chat.flow"])) > [data-chat-flow-kind="turn-process"] + :not([hidden]):not(.dsh-rwv-chat-flowItem:is(:empty, :has(> [data-slot="conversation.chat.node"]:empty))):not(.dsh-rwv-chat-running) {
  --dsh-chat-flow-gap: 16px;
}

/* Empty Seats, including retained empty slot anchors, preserve Turn lookup
   without contributing height or the sibling gap. */
.dsh-rwv-chat-flowItem:is(:empty, :has(> [data-slot="conversation.chat.node"]:empty)) {
  height: 0;
}

.dsh-rwv-chat-callRow {
  border-radius: var(--dsw-radius-sm);
}

/* Selection still sets data-selected for details linkage; no outline —
   tool rows match Think chrome (no selected ring). */

.dsh-rwv-chat-hint {
  color: var(--dsw-alias-label-tertiary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(18px + var(--dsh-content-font-delta-secondary, 0px));
}

.dsh-rwv-chat-running {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  --dsh-chat-flow-gap: 12px;
  --dsw-alias-label-shimmer: var(--dsw-alias-label-deep-diving-shimmer);
  color: var(--dsw-alias-label-deep-diving);
  font-size: calc(var(--dsh-content-font-size, 14px) - 2px);
  line-height: calc(22px + var(--dsh-content-font-delta, 0px));
}

/* The last visible row before the status must contain output, not an input.
   Hidden and empty seats do not separate a user message from the status. */
:is(.dsh-rwv-chat-column, :global([data-slot="conversation.chat.flow"])) > :nth-last-child(2 of :not([hidden]):not(.dsh-rwv-chat-flowItem:is(:empty, :has(> [data-slot="conversation.chat.node"]:empty)))):is(
  .dsh-rwv-chat-flowItem:not([data-chat-flow-kind="user"]):not([data-chat-flow-kind="steering"]):not([data-chat-flow-kind="turn-trigger"]),
  [data-chat-group-key]
) ~ .dsh-rwv-chat-running > .dsh-rwv-chat-runningDivider {
  display: block;
}

.dsh-rwv-chat-runningDivider {
  display: none;
  width: 100%;
  height: 0.5px;
  margin: 8px 0 10px;
  background: color-mix(in srgb, var(--dsw-alias-border-l1) 75%, var(--dsw-alias-border-l2));
  pointer-events: none;
}

.dsh-rwv-chat-runningContent {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 6px;
}

.dsh-rwv-chat-runningText {
  min-width: 0;
  font-variant-numeric: tabular-nums;
}

.dsh-rwv-chat-runningIcon {
  position: relative;
  display: inline-flex;
  flex: none;
  width: calc(14px + var(--dsh-content-font-delta, 0px));
  height: calc(14px + var(--dsh-content-font-delta, 0px));
  /* The fixed footprint contains the animation's layout and paint. */
  contain: strict;
  overflow: hidden;
}

.dsh-rwv-chat-runningWhaleAnimated {
  display: none;
  position: absolute;
  inset: 0;
}

.dsh-rwv-chat-runningWhaleStill {
  display: initial;
}

@supports (mask-mode: alpha) and (mask-image: url('')) {
  @media (prefers-reduced-motion: no-preference) and (forced-colors: none) {
    .dsh-rwv-chat-runningWhaleAnimated {
      display: block;
      background: currentColor;
      mask: url('./running-whale@2x.png') center / 100% 100% no-repeat;
      mask-mode: alpha;
      /* Keep animated-mask repaints on an icon-sized composited layer. */
      will-change: transform;
    }

    .dsh-rwv-chat-runningWhaleStill {
      display: none;
    }
  }
}

.dsh-rwv-chat-openError {
  color: var(--dsw-alias-state-error-primary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(18px + var(--dsh-content-font-delta-secondary, 0px));
}

.dsh-rwv-chat-older {
  display: flex;
  justify-content: center;
}

.dsh-rwv-chat-older button {
  border: none;
  border-radius: var(--dsw-radius-sm);
  padding: 4px 12px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-interactive-bg-hover-solid);
  cursor: pointer;
}

.dsh-rwv-chat-older button:disabled {
  cursor: default;
  opacity: 0.6;
}

/* Floating controls sit outside the clipped transcript. A standalone Chat
   anchors them to its frame; the shared host supplies the sticky scrollport. */
.dsh-rwv-chat-toBottomSlot {
  position: absolute;
  right: 0;
  bottom: 16px;
  left: 0;
  /* Above the sticky composer (z-index 7) so the control stays clickable and
     visible over the input card. Exception: while an @/slash menu is open the
     seat lifts to 9 (ui-conversation ConversationRoot) so the menu is never
     covered by this control. */
  z-index: 8;
  height: 0;
  display: flex;
  justify-content: flex-end;
  padding-right: max(
    calc(var(--dsh-composer-side-clearance) + 16px),
    calc((100% - var(--dsh-chat-content-width)) / 2)
  );
  pointer-events: none;
}

:global([data-conversation-scroll]) .dsh-rwv-chat-toBottomSlot {
  position: sticky;
  /* Clears the sticky composer stack (docks + input card + stats): the live
     height rides --dsh-composer-height (ConversationRoot's seat observer) so
     the control follows a growing textarea; the fallback covers the first
     paint before the observer fires. */
  bottom: calc(var(--dsh-composer-height, 152px) + 16px);
}

.dsh-rwv-chat-toBottom {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  margin-top: -34px;
  padding: 0;
  border: 0;
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l3);
  border-radius: 100px;
  corner-shape: round;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-button-floating-fill);
  box-shadow: var(--dsw-elevation-panel);
  cursor: pointer;
  pointer-events: auto;
}

.dsh-rwv-chat-toBottom:hover {
  background: var(--dsw-alias-button-floating-hover);
}

/* Host open-path refusal: same dialog family as the workspace folder error. */
.dsh-rwv-chat-modalAction {
  min-width: 72px;
}


/* ui-chat/src/client/chat/MessageItem.module.css */
/* User messages align their bubble and action row to the right. */

.dsh-rwv-msg-userRow {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.dsh-rwv-msg-userStack {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  min-width: 0;
  /* The figma 525px cap held as a share of the width axis (525/748 ≈ 0.702):
     resolves to the original 525px on the default column and widens with a
     dragged or adaptive column. The 748px fallback covers mounts outside the
     conversation column, where the axis variable is absent. */
  max-width: min(calc(var(--dsh-chat-content-width, 748px) * 0.702), 82%);
}
.dsh-rwv-msg-bubble {
  /* Figma's 525px cap held as a share of the width axis (525/748 ≈ 0.702) so
     the bubble widens with a user-dragged or adaptive column; percentage
     keeps narrow windows sane. */
  max-width: 100%;
  background: var(--dsw-specific-bubble);
  border-radius: var(--dsw-radius-xl);
  /* 42px single-line bubble at the default size: 22 line + 10 vertical
     padding each side; the Settings font-size preference moves size and line
     height together through the body-published axis. */
  padding: 10px 16px;
  font-size: var(--dsh-content-font-size, 14px);
  line-height: calc(22px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-label-primary);
  /* The projected user text is inline runs; the bubble owns wrapping so a
     decorated single-line message stays one line. */
  white-space: pre-wrap;
  word-break: break-word;
}

.dsh-rwv-msg-referenceSummary {
  color: var(--dsw-alias-label-tertiary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(18px + var(--dsh-content-font-delta-secondary, 0px));
}
.dsh-rwv-msg-contextRow {
  padding: 2px 0;
}

/* Compaction marker: one 24px row with a context icon at rest and a
   hover/focus disclosure for the summary body. */
.dsh-rwv-msg-compactionRow {
  /* The toggle's line, and the band a pinned toggle occupies. The button's
     height and the offset that holds a summary's code banner below that band
     are the same measurement, so both read it from here. */
  --dsh-compaction-header-height: calc(24px + var(--dsh-content-font-delta, 0px));
  padding: 2px 0;
}

.dsh-rwv-msg-compactionButton {
  display: flex;
  align-items: center;
  width: 100%;
  height: var(--dsh-compaction-header-height);
  min-width: 0;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: none;
  color: var(--dsw-alias-label-tertiary);
  transition: color 100ms ease;
  font: inherit;
  text-align: left;
}

/* The summary body flows uncapped with the page, so a long checkpoint summary
   carries this toggle off the top of the viewport. Pin it to the conversation
   scroll container's top while the row is open (the body is a sibling rendered
   only when expanded); the base background masks the prose scrolling under it.
   The square corners apply for as long as the row is open, pinned or not: the
   fill is what masks the prose, and rounded corners would leave that prose visible
   in the corners. z-index outranks the markdown code block's own sticky banner
   (z-index 6 in CodeBlock.module.css); that banner itself stops below this
   toggle (rule below), so a summary's fenced code block never puts a control
   inside the toggle's band. */
.dsh-rwv-msg-compactionRow:has(.dsh-rwv-msg-compactionBody) .dsh-rwv-msg-compactionButton {
  position: sticky;
  top: 0;
  z-index: 7;
  border-radius: 0;
  background: var(--dsw-alias-bg-base);
}

/* A fenced code block in the summary pins its banner at the scrollport top,
   where this pinned toggle already sits, and the toggle's band covers the
   banner's Copy control. Stop the banner below the toggle instead, on the same
   measurement the toggle's own height uses. This rule beats CodeBlock's
   \`.bannerWrap { top: 0 }\` by specificity (0,2,0 against 0,1,0), not by
   declaration order: the two sheets load in their own packages. */
.dsh-rwv-msg-compactionBody :has(> [data-code-block-banner]) {
  top: var(--dsh-compaction-header-height);
}

/* Pinned, the toggle needs an opaque hover fill: the default translucent hover
   token below would let the scrolling prose show through the moment the pointer
   lands on the toggle to collapse it. */
.dsh-rwv-msg-compactionRow:has(.dsh-rwv-msg-compactionBody) .dsh-rwv-msg-compactionButton:hover {
  background: var(--dsw-alias-interactive-bg-hover-solid);
}

.dsh-rwv-msg-compactionButton:not(:disabled) {
  cursor: pointer;
}

.dsh-rwv-msg-compactionButton:hover {
  color: var(--dsw-alias-label-secondary);
}

.dsh-rwv-msg-compactionButton:not(:disabled):hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-rwv-msg-compactionLeading {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: calc(16px + var(--dsh-content-font-delta, 0px));
  height: calc(16px + var(--dsh-content-font-delta, 0px));
  margin-right: 6px;
  color: inherit;
}

/* Same glyph-scaling rule as DisclosureRow's leading: the CSS edge overrides
   the svg attributes so the 14px glyphs follow the font-size delta. */
.dsh-rwv-msg-compactionLeading svg {
  width: calc(14px + var(--dsh-content-font-delta, 0px));
  height: calc(14px + var(--dsh-content-font-delta, 0px));
}

.dsh-rwv-msg-compactionContextIcon,
.dsh-rwv-msg-compactionDisclosureIcon {
  display: inline-flex;
  grid-area: 1 / 1;
  align-items: center;
  justify-content: center;
}

.dsh-rwv-msg-compactionDisclosureIcon {
  opacity: 0;
}

.dsh-rwv-msg-compactionButton:not(:disabled):hover .dsh-rwv-msg-compactionContextIcon,
.dsh-rwv-msg-compactionButton:not(:disabled):focus-visible .dsh-rwv-msg-compactionContextIcon {
  opacity: 0;
}

.dsh-rwv-msg-compactionButton:not(:disabled):hover .dsh-rwv-msg-compactionDisclosureIcon,
.dsh-rwv-msg-compactionButton:not(:disabled):focus-visible .dsh-rwv-msg-compactionDisclosureIcon {
  opacity: 1;
}

.dsh-rwv-msg-compactionTitle {
  flex: none;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));
  color: inherit;
}

.dsh-rwv-msg-compactionSep {
  flex: none;
  width: 2px;
  height: 2px;
  margin: 0 8px;
  border-radius: 1px;
  background: var(--dsw-alias-label-caption);
}

.dsh-rwv-msg-compactionSummary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: inherit;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-rwv-msg-compactionBody {
  /* Indent under the title, which starts at leading (16 + delta) + gap 6. */
  padding: 4px 0 4px calc(22px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-label-tertiary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));
}

.dsh-rwv-msg-retryRow {
  color: var(--dsw-alias-label-tertiary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
}

.dsh-rwv-msg-retrySummary {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  max-width: 100%;
  padding: 2px 0;
  gap: 7px;
  border-radius: var(--dsw-radius-sm);
  color: inherit;
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.dsh-rwv-msg-retrySummary::-webkit-details-marker {
  display: none;
}

.dsh-rwv-msg-retrySummary::after {
  flex: none;
  width: 6px;
  height: 6px;
  margin-right: 2px;
  border-right: 1.5px solid currentcolor;
  border-bottom: 1.5px solid currentcolor;
  content: '';
  transform: rotate(-45deg);
  transition: transform 120ms ease;
}

.dsh-rwv-msg-retrySummary:hover {
  color: var(--dsw-alias-label-secondary);
}

@media (prefers-reduced-motion: reduce) {
  .dsh-rwv-msg-compactionButton {
    transition: none;
  }
}

.dsh-rwv-msg-retrySummary:focus-visible {
  outline: 1.5px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}

.dsh-rwv-msg-retryText {
  min-width: 0;
  overflow-wrap: anywhere;
}

.dsh-rwv-msg-retryRow[open] .dsh-rwv-msg-retrySummary::after {
  transform: rotate(45deg);
}

.dsh-rwv-msg-retryDetails {
  display: grid;
  gap: 2px;
  margin-top: 3px;
  padding-left: 14px;
  overflow-wrap: anywhere;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(18px + var(--dsh-content-font-delta-secondary, 0px));
}

.dsh-rwv-msg-retryDetailLabel {
  color: var(--dsw-alias-label-secondary);
}

.dsh-rwv-msg-turnErrorRow {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
  padding: 2px 0;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
}

.dsh-rwv-msg-turnErrorDot {
  margin-top: 5px;
}

.dsh-rwv-msg-turnErrorCopy {
  min-width: 0;
  overflow-wrap: anywhere;
}

.dsh-rwv-msg-turnErrorTitle {
  margin-right: 6px;
  color: var(--dsw-alias-state-error-primary);
  font-weight: 600;
}

.dsh-rwv-msg-turnErrorMessage {
  color: var(--dsw-alias-label-secondary);
}

.dsh-rwv-msg-turnErrorCode {
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-markdown-code-block-small);
}

.dsh-rwv-msg-maxTokensTitle {
  margin-right: 6px;
  color: var(--dsw-alias-state-warn-primary);
  font-weight: 600;
}

.dsh-rwv-msg-attachmentRow {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 100%;
  gap: 8px;
}

.dsh-rwv-msg-fileCard {
  display: inline-flex;
  flex: 0 0 240px;
  align-items: center;
  gap: 10px;
  width: 240px;
  min-height: 64px;
  padding: 8px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-specific-input-major, transparent);
  box-sizing: border-box;
}

.dsh-rwv-msg-fileIcon {
  flex: none;
  width: 28px;
  height: 28px;
}

.dsh-rwv-msg-fileContent {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.dsh-rwv-msg-fileName {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
}

.dsh-rwv-msg-fileMeta {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--dsw-alias-label-tertiary, rgba(0, 0, 0, 0.45));
  font-size: 12px;
  line-height: 15px;
}


/* ui-chat/src/client/chat/AssistantMarkdown.module.css */
/* Assistant flow body: full-width narration (figma 16/28 scaled 0.875 → 14/24
   with the markdown token ladder), block gap 16. The Settings font-size
   preference rides the body-published axis: size follows
   --dsh-content-font-size and the line height keeps the 10px leading via the
   shared px delta. IconActions sit below the body with an explicit 16px top
   margin (figma 43:32997) — separate from the body's internal gap so the
   footer spacing stays fixed when the body is a single block. */

.dsh-rwv-assistant-root {
  display: flex;
  flex-direction: column;
  font-size: var(--dsh-content-font-size, 14px);
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-label-primary);
}

.dsh-rwv-assistant-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Wide markdown tables (the renderer's ≥4-column md-table-wide hook) span
   the whole transcript width instead of clipping at the 748px message
   column, while the table content keeps starting at its normal x (the lead
   padding compensates the negative margin) — deepsuite chat TableWrapper
   parity, with 100cqw (the ChatView scroll container) standing in for its
   JS-measured --dsl-virtual-list-width. \`--dsh-table-spare\` clamps to zero
   when the transcript is narrower than the message column, so narrow
   viewports keep the plain in-column scroll with no sideways shift.
   Percentages resolve against the wrapper's containing block, so a table
   indented inside a list still reaches the same transcript edges. */
.dsh-rwv-assistant-body :global(.md-table-wide) {
  --dsh-table-spare: max(0px, calc((100cqw - var(--dsh-chat-content-width)) / 2));
  --dsh-table-lead: calc(var(--dsh-table-spare) + min(var(--dsh-chat-content-width), 100cqw) - 100%);
  box-sizing: border-box;
  width: calc(100% + var(--dsh-table-lead) + var(--dsh-table-spare));
  /* The base .tableScroll caps at the column (max-width: 100%); the breakout
     is exactly the case that must exceed it. */
  max-width: none;
  margin-left: calc(-1 * var(--dsh-table-lead));
  padding-left: var(--dsh-table-lead);
}

/* Only the painted table outranks Conversation's z-index 0 width handle. The
   full-width scroll wrapper and its transparent alignment padding stay below,
   so a fitting four-column table does not disable the surrounding gutter. */
.dsh-rwv-assistant-body :global(.md-table-wide) > table {
  position: relative;
  z-index: 1;
}

/* hidden="until-found" keeps a zero-height reasoning box in flex layout.
   Cancel the one gap that box would otherwise leave before the visible reply;
   visible Assistant blocks retain the ordinary 16px rhythm. */
.dsh-rwv-assistant-body > [data-turn-process-inline][hidden] {
  margin-bottom: -16px;
}

/* Interrupted-turn terminal marker: quiet inline tag, no animation. Fixed
   size like the small/code token variants — 11px is dense secondary text
   that would fall to an illegible 9px at the 12px floor. */
.dsh-rwv-assistant-stopped {
  align-self: flex-start;
  padding: 0 6px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 18px;
}

/* Finalized footer offset (figma 43:32997); chrome lives in MessageIconActions. */
.dsh-rwv-assistant-actions {
  margin-top: 16px;
  /* Optical align with the 28px action hit targets. */
  margin-left: -6px;
}


/* ui-chat/src/client/chat/ReasoningRow.module.css */
.dsh-rwv-reasoning-root {
  display: flex;
  flex-direction: column;
}

.dsh-rwv-reasoning-root:not([data-expanded]) {
  contain: size layout;
  height: calc(24px + var(--dsh-content-font-delta, 0px));
}

.dsh-rwv-reasoning-row {
  overflow: hidden;
}

/* The uncapped body scrolls with the conversation; keep its collapse toggle
   reachable. Compact Markdown code banners stay in flow below this header. */
.dsh-rwv-reasoning-root[data-expanded] [data-open] [data-disclosure-header] {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--dsw-alias-bg-base);
}

.dsh-rwv-reasoning-leading {
  flex-shrink: 0;
}

.dsh-rwv-reasoning-title {
  font-weight: 400;
}

.dsh-rwv-reasoning-separator {
  flex: none;
  width: 2px;
  height: 2px;
  margin: 0 8px;
  border-radius: 1px;
  background: var(--dsw-alias-label-caption);
}

/* Think text reads the secondary tier — one step under the body size
   (setting −1 at ≤14, setting −2 above), shared with every flow-row title
   and summary. */
.dsh-rwv-reasoning-summary {
  min-width: 0;
  overflow: hidden;
  flex: 1 1 auto;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
  white-space: nowrap;
}

.dsh-rwv-reasoning-summaryText {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dsh-rwv-reasoning-summary[data-streaming] {
  mask-image: linear-gradient(to right, black calc(100% - 48px), transparent);
}

.dsh-rwv-reasoning-summary[data-streaming] .dsh-rwv-reasoning-summaryText {
  overflow: visible;
  text-overflow: clip;
}

.dsh-rwv-reasoning-root:not([data-preview]) .dsh-rwv-reasoning-separator,
.dsh-rwv-reasoning-root:not([data-preview]) .dsh-rwv-reasoning-summary {
  display: none;
}

.dsh-rwv-reasoning-thinkBody {
  /* Indent under the title, which starts at leading (16 + delta) + gap 6. */
  padding: 4px 0 4px calc(22px + var(--dsh-content-font-delta, 0px));
  min-width: 0;
}

`;
		//#endregion
		//#region src/client/session-header-official.tsx
		/**
		* Official DSH session header adapter.
		*
		* The vendored rc.3 conversation bundle exports its real
		* `ConversationSessionHeader`; this adapter supplies the remote session's
		* stores/slots and lets the official component own the header DOM. Its CSS is
		* the vendored ConversationRoot stylesheet rewritten to the official hashed
		* class names that the component references.
		*/
		//#endregion
		//#region src/client/session-tools.tsx
		/**
		* Official-block adapters for tool calls/results in the v2 timeline.
		*
		* Reused DSH primitives: `TerminalBlock`, `ReadBlock`, `SearchBlock`,
		* `DiffBlock`, `CodeBlock`, `JsonBlock`. The only self-drawn shell is the
		* per-result status line (running/error/truncated) because those blocks draw
		* only their own body. Tool payloads arrive as model-facing text, so the
		* adapters below parse the small set of shapes the official tool renderers
		* understand and fall back to `CodeBlock` when a shape is unknown.
		*/
		/** Reusable localized chrome for the official code-card family. */
		const CODE_LABELS = {
			codeLabel: t("session.block.code"),
			wrapLabel: t("session.block.wrap"),
			unwrapLabel: t("session.block.unwrap")
		};
		t("session.block.copy"), t("session.block.copied");
		t("session.block.terminal.noExitCode"), t("session.tool.status.running"), t("session.tool.status.error"), t("session.tool.status.done"), t("session.block.copy"), t("session.block.copied"), t("session.block.terminal.noOutput"), t("session.block.collapse"), t("session.block.collapse");
		({ ...CODE_LABELS }), t("session.block.copy"), t("session.block.copied"), t("session.block.collapse"), t("session.block.collapse");
		t("session.block.copy"), t("session.block.copied"), t("session.block.search.noResults"), t("session.block.collapse"), t("session.block.collapse");
		({ ...CODE_LABELS }), t("session.block.copy"), t("session.block.copied"), t("session.block.collapse"), t("session.block.collapse");
		//#endregion
		//#region src/client/session-main.tsx
		/**
		* v2 native server conversation main area.
		*
		* This is the replacement for the server-mode iframe: it never touches the
		* portal, the iframe DOM or the profile's official UI. The official reusable
		* pieces we can actually reach from a client plugin are the **primitives**
		* (`MarkdownText`, buttons, tooltips, state dots); the official Conversation
		* shell/composer/tool/approval components are registered internally by
		* `ui-conversation`/`ui-chat` and are not exported, so this file owns the
		* shell layout and the timeline adapters around those primitives. See
		* `doc/official-workspace-reuse.md` §13 for the reuse gap.
		*
		* The component is presentational + controlled: the integration layer
		* (remote-store/tree, task-15) owns the P3 timeline/SSE state and passes rows
		* through the pure `session-timeline.ts` merge helpers.
		*/
		/** Main-slot key for the native server conversation (task-15 registers it). */
		const NATIVE_MAIN_ID = "dsh-remote-workspace-native";
		let nativeRequest;
		const nativeListeners = /* @__PURE__ */ new Set();
		function commitNative(request) {
			nativeRequest = request;
			for (const listener of nativeListeners) listener();
		}
		/** Open (or re-point) the native main area. */
		function openNativeSession(request) {
			commitNative(request);
		}
		/** Clear the native main-area request (integration owns selection/SSE abort). */
		function closeNativeSession() {
			if (nativeRequest === void 0) return;
			commitNative(void 0);
		}
		t("session.markdown.copy"), t("session.markdown.copied"), t("session.markdown.footnotes");
		(0, react.createContext)(void 0);
		//#endregion
		//#region src/client/session-timeline.ts
		/** Newest known server sequence; used as `afterSeq` on reconnect. */
		function timelineAfterSeq(entries) {
			let max = 0;
			for (const entry of entries) if (entry.seq !== void 0 && entry.seq > max) max = entry.seq;
			return max;
		}
		/** Sort by sequence; rows without a sequence (optimistic) trail in input order. */
		function sortEntries(entries) {
			return entries.map((entry, index) => ({
				entry,
				index
			})).sort((left, right) => {
				const leftSeq = left.entry.seq;
				const rightSeq = right.entry.seq;
				if (leftSeq === void 0 && rightSeq === void 0) return left.index - right.index;
				if (leftSeq === void 0) return 1;
				if (rightSeq === void 0) return -1;
				if (leftSeq !== rightSeq) return leftSeq - rightSeq;
				return left.index - right.index;
			}).map((item) => item.entry);
		}
		/** Whether `entry` is the server echo of an optimistic row. */
		function isEchoOf(previous, incoming) {
			if (previous.kind !== "user" || previous.clientId === void 0) return false;
			if (incoming.kind !== "user") return false;
			return previous.clientId === incoming.clientId;
		}
		/**
		* Upsert one server row.
		*
		* Identity order: `clientId` echo (drops the optimistic row), exact `id`, then
		* `seq`. A replaced row keeps its position after the sequence sort, so a
		* streaming assistant/reasoning update does not jump the timeline.
		* @param entries - current rows.
		* @param incoming - server row.
		* @returns a new, deduplicated, sequence-sorted array.
		*/
		function upsertTimelineEntry(entries, incoming) {
			const next = [];
			let replaced = false;
			for (const entry of entries) {
				if (isEchoOf(entry, incoming)) {
					next.push(incoming);
					replaced = true;
					continue;
				}
				if (entry.id === incoming.id) {
					next.push(incoming);
					replaced = true;
					continue;
				}
				if (incoming.seq !== void 0 && entry.seq === incoming.seq) {
					next.push(incoming);
					replaced = true;
					continue;
				}
				next.push(entry);
			}
			if (!replaced) next.push(incoming);
			return sortEntries(next);
		}
		/** Merge one page of server rows (deduplicating and sorting). */
		function mergeTimelineEntries(current, incoming) {
			let next = [...current];
			for (const entry of incoming) next = upsertTimelineEntry(next, entry);
			return next;
		}
		/** Apply one incremental timeline event. */
		function applyTimelineEvent(state, event) {
			switch (event.type) {
				case "entry": return {
					...state,
					entries: upsertTimelineEntry(state.entries, event.entry)
				};
				case "replace-user": {
					const withoutPending = state.entries.filter((entry) => !(entry.kind === "user" && entry.clientId === event.clientId && entry.pending === true));
					return {
						...state,
						entries: upsertTimelineEntry(withoutPending, event.entry)
					};
				}
				case "snapshot": return {
					entries: mergeTimelineEntries([], event.entries),
					hasMoreBefore: event.hasMoreBefore
				};
			}
		}
		/** Adapt one server row to the client's normalized union. */
		function adaptServerTimelineEntry(raw) {
			const id = typeof raw.entryId === "string" && raw.entryId !== "" ? raw.entryId : typeof raw.id === "string" && raw.id !== "" ? raw.id : `seq:${raw.seq ?? "unknown"}`;
			const createdAt = raw.time ?? raw.createdAt;
			const base = {
				id,
				...typeof raw.seq === "number" ? { seq: raw.seq } : {},
				...createdAt === void 0 ? {} : { createdAt }
			};
			const text = typeof raw.text === "string" ? raw.text : typeof raw.content === "string" ? raw.content : typeof raw.message === "string" ? raw.message : "";
			switch (raw.kind) {
				case "user": return {
					...base,
					kind: "user",
					text,
					...typeof raw.clientId === "string" ? { clientId: raw.clientId } : {},
					...raw.pending === true ? { pending: true } : {}
				};
				case "assistant": return {
					...base,
					kind: "assistant",
					text,
					...raw.streaming === true ? { streaming: true } : {},
					...raw.interrupted === true ? { interrupted: true } : {}
				};
				case "reasoning": return {
					...base,
					kind: "reasoning",
					text,
					...raw.streaming === true ? { streaming: true } : {}
				};
				case "tool-call": return {
					...base,
					kind: "tool-call",
					callId: typeof raw.callId === "string" ? raw.callId : id,
					name: typeof raw.name === "string" ? raw.name : "tool",
					...raw.arguments !== void 0 ? { arguments: raw.arguments } : raw.args !== void 0 ? { arguments: raw.args } : {},
					...raw.status === "running" || raw.status === "done" || raw.status === "error" ? { status: raw.status } : {}
				};
				case "tool-result": return {
					...base,
					kind: "tool-result",
					callId: typeof raw.callId === "string" ? raw.callId : id,
					...typeof raw.name === "string" ? { name: raw.name } : {},
					output: typeof raw.output === "string" ? raw.output : typeof raw.result === "string" ? raw.result : text,
					...raw.isError === true ? { isError: true } : {},
					...raw.truncated === true ? { truncated: true } : {}
				};
				case "approval": {
					const status = (raw.status === "pending" || raw.status === "allowed" || raw.status === "denied" || raw.status === "expired" ? raw.status : void 0) ?? (raw.state === "decided" ? raw.outcome === "allowed-once" ? "allowed" : raw.outcome === "rejected" ? "denied" : "expired" : "pending");
					return {
						...base,
						kind: "approval",
						approvalId: typeof raw.approvalId === "string" && raw.approvalId !== "" ? raw.approvalId : id,
						...typeof raw.callId === "string" ? { callId: raw.callId } : {},
						...typeof raw.toolName === "string" ? { toolName: raw.toolName } : raw.name !== void 0 ? { toolName: String(raw.name) } : {},
						...typeof raw.reason === "string" ? { reason: raw.reason } : {},
						...raw.state === "asked" || raw.state === "decided" ? { state: raw.state } : {},
						...raw.outcome === "allowed-once" || raw.outcome === "rejected" || raw.outcome === "cancelled" || raw.outcome === "unavailable" ? { outcome: raw.outcome } : {},
						status,
						...raw.details === void 0 ? {} : { details: raw.details }
					};
				}
				case "error": return {
					...base,
					kind: "error",
					...typeof raw.code === "string" ? { code: raw.code } : {},
					message: text === "" ? "server reported an error" : text,
					...raw.retryable === true ? { retryable: true } : {}
				};
				case "turn": return {
					...base,
					kind: "turn",
					turn: typeof raw.turn === "number" ? raw.turn : 0,
					phase: raw.phase === "end" ? "end" : "start",
					...raw.status === "running" || raw.status === "completed" || raw.status === "cancelled" || raw.status === "error" ? { status: raw.status } : {}
				};
				default: return {
					...base,
					kind: "unknown",
					text: text === "" ? JSON.stringify(raw) : text,
					...typeof raw.type === "string" ? { label: raw.type } : typeof raw.kind === "string" ? { label: raw.kind } : {},
					...raw.ignorable === true ? { ignorable: true } : {}
				};
			}
		}
		//#endregion
		//#region src/client/remote-store.ts
		/**
		* The v1 remote sidebar's app model (P3-facing).
		*
		* This is the successor to `store.ts`'s remote-tree half: server-authoritative
		* workspace/session data comes from `/api/state` + `/api/sessions`, every verb
		* is one P3 command, and view state (pin/archive/order) is written through the
		* official registry contract rather than a local copy. The legacy connection
		* wizard still uses `store.ts`; the two stores only share the client context.
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
				search: "",
				pending: false
			};
		}
		let state = initialState();
		const listeners = /* @__PURE__ */ new Set();
		let clientContext;
		let stopStateStream;
		let stopPortalSelection;
		let stopOfficialSelection;
		/** Local-mode sessions this device revealed to the official client catalog. */
		const revealedLocal = /* @__PURE__ */ new Map();
		/** Coalesced per-target refreshes driven by the state stream. */
		const refreshTimers = /* @__PURE__ */ new Map();
		/** Pending local-mode reveal after a host create/resume (`session/revealed`). */
		let pendingReveal;
		function commit(patch) {
			const changes = typeof patch === "function" ? patch(state) : patch;
			if (changes === void 0 || Object.keys(changes).length === 0) return;
			const merged = {
				...state,
				...changes
			};
			state = {
				...merged,
				connections: deriveConnections(merged)
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
		/** Snapshot hook for the tree/sidebar. */
		function useRemoteAppState() {
			return (0, react.useSyncExternalStore)(subscribe, snapshot, snapshot);
		}
		/** Recompute every connection's server-order groups from its two lists. */
		function deriveConnections(next) {
			const out = {};
			for (const [targetId, view] of Object.entries(next.connections)) {
				const selected = next.selection?.targetId === targetId ? next.selection.sessionId : void 0;
				const groups = view.workspaces === void 0 ? [] : deriveWorkspaceGroups(view.workspaces, view.sessions, { currentSessionId: selected });
				out[targetId] = {
					...view,
					groups
				};
			}
			return out;
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
				groups: [],
				stateLoad: {
					loading: false,
					loaded: connection !== void 0
				},
				sessionsLoad: sessions === void 0 ? emptyLoad() : {
					loading: false,
					loaded: true
				},
				expanded: {},
				mode: target.executor ?? "local",
				modeSwitch: IDLE_MODE_SWITCH,
				restart: { phase: "idle" },
				stale: connection?.registry?.stale ?? false,
				...connection?.error === void 0 ? {} : { error: connection.error }
			};
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
				stale: value.stale || value.workspaces.registry.stale === true || value.registry?.stale === true,
				...value.connection?.error === void 0 ? {} : { error: value.connection.error }
			});
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
		* message. Occupancy/stale/lock codes get product copy that says what the user
		* can do next (protocol §12).
		*/
		function describeFailure(error) {
			const wire = describe(error);
			switch (wire.code) {
				case "registry-stale": return t("remote.error.registryStale");
				case "session/writer-held": return t("remote.error.writerHeld");
				case "session/agent-busy": return t("remote.error.agentBusy");
				case "session/archived-pin": return t("remote.error.archivedPin");
				case "profile-locked":
				case "profile-in-use": return t("remote.error.profileLocked");
				case "tunnel-unavailable":
				case "target-not-connected": return t("remote.error.tunnel");
				case "session-not-found": return t("remote.error.sessionMissing");
				case "agent-compose-failed": return t("remote.error.agentCompose");
				case "workspace-unknown": return t("remote.error.workspaceMissing");
				case "session-reveal-timeout": return t("remote.session.revealTimeout");
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
		* A `registry-stale` write failure means another process changed the shared
		* workspace file since this profile loaded it. Surface the reload affordance
		* immediately; otherwise the user sees only a toast and has no banner button.
		*/
		function markStaleOnError(targetId, error) {
			if (describe(error).code !== "registry-stale") return;
			if (state.connections[targetId] === void 0) return;
			patchConnection(targetId, { stale: true });
		}
		/** Map any thrown value to the executor error surface (keeps public details). */
		function executorWireError(error) {
			if (error instanceof RemoteApiError) return executorErrorView({
				code: error.code,
				message: error.message,
				details: error.details
			});
			return executorErrorView({
				code: "internal",
				message: error instanceof Error ? error.message : String(error)
			});
		}
		/**
		* A per-target list value; the host substitutes `{ error }` for a failed read.
		* The rest of the client consumes only real lists, so failures degrade to
		* "nothing loaded" and the connection's own error stays visible.
		* @param value - list or the host's `{ error }` substitute.
		* @returns the list, or undefined when the entry is not a readable list.
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
					const sessions = readableList(value.sessions?.[target.id]);
					connections[target.id] = viewFor(target, value.connections[target.id], readableList(value.workspaces[target.id]), sessions);
				}
				const expanded = {};
				for (const target of value.targets) {
					const connectionPhase = value.connections[target.id]?.phase;
					if (connectionPhase === "ready" || connectionPhase === "degraded") expanded[targetNodeKey(target.id)] = true;
				}
				const mappedConnections = Object.fromEntries(Object.entries(connections).map(([id, view]) => [id, {
					...view,
					expanded: expanded[targetNodeKey(id)] === true ? { [targetNodeKey(id)]: true } : {}
				}]));
				commit({
					loaded: true,
					loading: false,
					clientId: value.clientId,
					pluginVersion: value.pluginVersion,
					order,
					connections: mappedConnections
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
		/** Read every connected target again (the toolbar's lightweight refresh). */
		async function refreshAllRemote() {
			const targets = state.order.filter((targetId) => {
				const view = state.connections[targetId];
				return view?.connection?.phase === "ready" || view?.connection?.phase === "degraded";
			});
			await Promise.all(targets.map((targetId) => refreshTargetComplete(targetId)));
		}
		/**
		* One user refresh: light reread, then load external registry changes when the
		* first read reports stale. `registry/refresh` does not cancel turns, so this
		* keeps the single-click refresh honest (D12) without changing the protocol's
		* lightweight `state/refresh` semantics.
		*/
		async function refreshTargetComplete(targetId) {
			await refreshRemoteTarget(targetId);
			if (state.connections[targetId]?.stale === true) await loadRegistryChanges(targetId);
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
				const value = await remoteApi.stateRefresh(targetId);
				mergeRefresh(targetId, value);
				if (value.stale) commit((previous) => ({ connections: {
					...previous.connections,
					[targetId]: {
						...previous.connections[targetId],
						stale: true
					}
				} }));
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
		/** Tree node keys; the tree keeps expansion local to the client. */
		function targetNodeKey(targetId) {
			return `target:${targetId}`;
		}
		/** @see targetNodeKey */
		function workspaceNodeKey(workspaceId) {
			return `workspace:${workspaceId}`;
		}
		/** Collapse one connection's whole subtree (disconnect/refresh). */
		function collapseRemoteTarget(targetId) {
			if (state.connections[targetId] === void 0) return;
			patchConnection(targetId, { expanded: {} });
		}
		/**
		* A user-initiated connect must not hang the row forever. Reconnect can also
		* trigger the one-time isolated-runtime build/upload, which is much slower than
		* an ordinary profile start, so the safety net is generous.
		*/
		const CONNECT_TIMEOUT_MS = 6e5;
		/** Settle with the connect promise, or reject with a readable timeout. */
		async function reconnectWithTimeout(targetId) {
			let timer;
			try {
				await Promise.race([remoteApi.reconnect(targetId), new Promise((_resolve, reject) => {
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
		* Close the full-screen official UI when it currently shows one target.
		*
		* Called from every path that makes a target unusable (disconnect, forget,
		* profile restart, connection lost): the frame must never keep showing a
		* profile the host has already stopped.
		* @param targetId - target whose frame must be torn down.
		*/
		function closePortalFor(targetId) {
			if (serverMainRequest()?.targetId !== targetId) return;
			closeServerMain();
			selectPanel(null);
		}
		/**
		* The session the full-screen official UI should open on its first load.
		*
		* A bare portal boot lands on the official first-run composer seat ("选择一个
		* 工作区开始"), which inside an iframe cannot recover, so the client always
		* deep-links one session (`dshRwSession`). The most recent conversation wins;
		* when the profile has none yet the client creates the workspace's blank
		* session through the host bridge, exactly like the tree's New Session verb.
		* @param targetId - connected target.
		* @param view - that target's loaded connection view.
		* @returns the session id to embed, or undefined when none can be resolved.
		*/
		async function portalSessionFor(targetId, view) {
			const conversation = [...view.sessions?.sessions ?? []].filter((row) => !row.blank && row.archived !== true && row.origin !== "subagent").sort((left, right) => right.updatedAt - left.updatedAt)[0];
			if (conversation !== void 0) return conversation.sessionId;
			const workspaceId = view.groups[0]?.workspace.workspaceId;
			if (workspaceId === void 0) return void 0;
			try {
				return (await remoteApi.sessionCreate({
					targetId,
					workspaceId,
					executor: "server"
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
			closeNativeView();
			closePortalFor(targetId);
			openServerMain({
				targetId,
				targetLabel: view.target.label,
				...sessionId === void 0 ? {} : { sessionId },
				...view.connection?.embed?.storagePrefix === void 0 ? {} : { storagePrefix: view.connection.embed.storagePrefix },
				...view.connection?.embed?.mode === void 0 ? {} : { embedMode: view.connection.embed.mode }
			});
			selectPanel(SERVER_MAIN_ID);
			commit({ selection: { targetId } });
		}
		/** Connect one saved target through the v1 route, then reread it. */
		async function connectRemoteTarget(targetId) {
			const view = state.connections[targetId];
			if (view === void 0 || view.connecting === true) return;
			patchConnection(targetId, {
				connecting: true,
				connectFailed: false,
				error: void 0
			});
			commit({ pending: true });
			try {
				await reconnectWithTimeout(targetId);
				patchConnection(targetId, { connecting: false });
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
				notify("error", t("remote.connect.failed", { message: describeFailure(error) }));
			} finally {
				patchConnection(targetId, { connecting: false });
				commit({ pending: false });
			}
		}
		/** Stop one target's profile and fold its subtree away. */
		async function disconnectRemoteTarget(targetId) {
			commit({ pending: true });
			try {
				await remoteApi.stop(targetId);
				const view = state.connections[targetId];
				if (view !== void 0) patchConnection(targetId, {
					connection: view.connection === void 0 ? void 0 : {
						...view.connection,
						phase: "stopped",
						error: void 0
					},
					connecting: false,
					connectFailed: false,
					error: void 0,
					sessions: void 0,
					sessionsLoad: {
						loading: false,
						loaded: false
					},
					expanded: {}
				});
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
		/** Find a session row in the snapshot. */
		function findSession(targetId, sessionId) {
			return state.connections[targetId]?.sessions?.sessions.find((row) => row.sessionId === sessionId);
		}
		function selectPanel(id) {
			try {
				(clientContext?.get("layout"))?.selectPanel?.(id);
			} catch (error) {
				console.error("[dsh-remote-workspace] layout.selectPanel failed", error);
			}
		}
		/**
		* Prepare the profile server's managed agent for one session.
		*
		* M1 fallback: while the P3 prepare route is not deployed yet, opening the
		* configured session must still reach the native main area (the server agent
		* resumes lazily; the later switch falls back to a restart). A real composition
		* failure (`agent-compose-failed`) is still fatal: the conversation must not
		* open onto a broken agent.
		* @returns `managed` when the plugin holds the handle, `unmanaged` when the
		*   server explicitly says it could not, and `unavailable` when the route is
		*   missing on the current host.
		*/
		async function prepareServerSession(targetId, sessionId) {
			try {
				return (await remoteApi.sessionPrepareServer(targetId, sessionId)).managed ? "managed" : "unmanaged";
			} catch (error) {
				const wire = describe(error);
				if (wire.code === "agent-compose-failed") throw error;
				console.warn("[dsh-remote-workspace] session/prepare-server unavailable; opening the native main without a managed handle", wire);
				return "unavailable";
			}
		}
		/** Tear down the native conversation's SSE stream and retry timer. */
		let stopNativeEvents;
		let nativeReconnectTimer;
		let nativeReconnectAttempt = 0;
		/** Monotonic generation: stale async callbacks must not patch a newer session. */
		let nativeGeneration = 0;
		/** Map one timeline page payload; both v2 fields and loose aliases are accepted. */
		function parseTimelinePage(value) {
			if (value === null || typeof value !== "object") return {
				entries: [],
				nextBeforeSeq: null
			};
			const row = value;
			const entries = (Array.isArray(row.entries) ? row.entries : Array.isArray(row.events) ? row.events : []).map((item) => adaptServerTimelineEntry(item));
			const next = row.nextBeforeSeq;
			return {
				entries,
				nextBeforeSeq: typeof next === "number" ? next : typeof row.beforeSeq === "number" && entries.length > 0 ? null : null
			};
		}
		/** Read one page of the server timeline. */
		async function fetchNativePage(targetId, sessionId, options = {}) {
			const page = parseTimelinePage(await remoteApi.sessionTimeline(targetId, sessionId, options));
			return {
				entries: page.entries,
				hasMoreBefore: page.nextBeforeSeq !== null && page.nextBeforeSeq !== void 0
			};
		}
		/** Map a `session/status` result to the native header/composer state. */
		function nativeStatusOf(result) {
			if (result === void 0) return "idle";
			const approvals = result["pendingApprovals"];
			if (Array.isArray(approvals) && approvals.length > 0) return "waiting-approval";
			return result.running === true ? "running" : "idle";
		}
		/** Pending approvals as timeline rows (so the approval card renders immediately). */
		function nativeApprovalEntries(result) {
			const approvals = result?.["pendingApprovals"];
			if (!Array.isArray(approvals)) return [];
			const entries = [];
			for (const raw of approvals) {
				if (raw === null || typeof raw !== "object") continue;
				const approval = raw;
				if (typeof approval.approvalId !== "string" || approval.approvalId === "") continue;
				entries.push({
					id: `approval:${approval.approvalId}`,
					kind: "approval",
					approvalId: approval.approvalId,
					status: "pending",
					...typeof approval.toolName === "string" ? { toolName: approval.toolName } : {},
					...typeof approval.callId === "string" ? { callId: approval.callId } : {},
					...typeof approval.reason === "string" ? { reason: approval.reason } : {}
				});
			}
			return entries;
		}
		/** First pending approval's human reason, when the server exposes one. */
		function nativeApprovalPrompt(result) {
			const approvals = result?.["pendingApprovals"];
			if (!Array.isArray(approvals) || approvals.length === 0) return void 0;
			const first = approvals[0];
			if (typeof first.reason === "string" && first.reason !== "") return first.reason;
			if (first.displayReason !== null && typeof first.displayReason === "object") {
				const label = Object.values(first.displayReason).find((value) => typeof value === "string");
				if (typeof label === "string") return label;
			}
			return typeof first.toolName === "string" ? first.toolName : void 0;
		}
		/** Patch the open native state (no-op after the conversation was closed). */
		function patchNative(patch) {
			const previous = state.native;
			if (previous === void 0) return;
			const changes = typeof patch === "function" ? patch(previous) : patch;
			if (Object.keys(changes).length === 0) return;
			commit({ native: {
				...previous,
				...changes
			} });
		}
		/** Stop the SSE stream and schedule no further reconnects. */
		function stopNativeStream() {
			if (nativeReconnectTimer !== void 0) {
				clearTimeout(nativeReconnectTimer);
				nativeReconnectTimer = void 0;
			}
			stopNativeEvents?.();
			stopNativeEvents = void 0;
			nativeReconnectAttempt = 0;
		}
		/** Close the native conversation (SSE + request + state). */
		function closeNativeView() {
			nativeGeneration += 1;
			stopNativeStream();
			closeNativeSession();
			if (state.native !== void 0) commit({ native: void 0 });
		}
		/** Merge server timeline rows, dropping an optimistic user row when its echo lands. */
		function mergeNativeEntries(current, incoming) {
			let next = [...current];
			for (const entry of incoming) {
				if (entry.kind === "user") {
					const text = entry.text.trim();
					const pending = next.find((candidate) => candidate.kind === "user" && candidate.clientId !== void 0 && candidate.pending === true && candidate.text.trim() === text);
					if (pending !== void 0 && pending.kind === "user" && pending.clientId !== void 0) {
						next = applyTimelineEvent({
							entries: next,
							hasMoreBefore: state.native?.hasMoreBefore ?? false
						}, {
							type: "replace-user",
							clientId: pending.clientId,
							entry
						}).entries;
						continue;
					}
				}
				next = upsertTimelineEntry(next, entry);
			}
			return next;
		}
		/** Handle one decoded P1 SSE frame for the open native conversation. */
		function handleNativeFrame(generation, frame) {
			if (generation !== nativeGeneration || state.native === void 0) return;
			let parsed;
			try {
				parsed = JSON.parse(frame.data);
			} catch {
				return;
			}
			let name = frame.event;
			if (parsed !== null && typeof parsed === "object" && typeof parsed.event === "string") name = parsed.event;
			const payload = parsed !== null && typeof parsed === "object" && "data" in parsed && typeof parsed.data === "object" ? parsed.data : parsed;
			if (payload === null || typeof payload !== "object") return;
			const value = payload;
			switch (name) {
				case "timeline": {
					const entries = Array.isArray(value["entries"]) ? value["entries"].map((item) => adaptServerTimelineEntry(item)) : [];
					if (entries.length > 0) patchNative((previous) => ({ entries: mergeNativeEntries(previous.entries, entries) }));
					return;
				}
				case "status": {
					const statusValue = value;
					const status = nativeStatusOf(statusValue);
					const prompt = nativeApprovalPrompt(statusValue);
					patchNative((previous) => ({
						entries: mergeNativeEntries(previous.entries, nativeApprovalEntries(statusValue)),
						status,
						...prompt === void 0 ? { approvalPrompt: void 0 } : { approvalPrompt: prompt }
					}));
					return;
				}
				case "approval": {
					const summary = value;
					if (typeof summary.approvalId !== "string") return;
					const entry = {
						id: `approval:${summary.approvalId}`,
						kind: "approval",
						approvalId: summary.approvalId,
						status: "pending",
						...typeof summary.toolName === "string" ? { toolName: summary.toolName } : {},
						...typeof summary.reason === "string" ? { reason: summary.reason } : {}
					};
					patchNative((previous) => ({
						entries: upsertTimelineEntry(previous.entries, entry),
						status: "waiting-approval",
						...typeof summary.reason === "string" ? { approvalPrompt: summary.reason } : {}
					}));
					return;
				}
				case "error": {
					const code = typeof value["code"] === "string" ? value["code"] : void 0;
					patchNative({
						status: "error",
						error: {
							message: typeof value["message"] === "string" ? value["message"] : t("remote.connect.failed", { message: "" }),
							...code === void 0 ? {} : { code }
						}
					});
					return;
				}
				case "ready":
					patchNative({ reconnecting: false });
					return;
				default: return;
			}
		}
		/** Open (or re-open) the session SSE stream at the newest known cursor. */
		function openNativeStream(generation) {
			const native = state.native;
			if (native === void 0 || generation !== nativeGeneration) return;
			stopNativeStream();
			try {
				stopNativeEvents = openSessionEvents({
					targetId: native.request.targetId,
					sessionId: native.request.sessionId,
					afterSeq: timelineAfterSeq(native.entries)
				}, {
					onEvent: (frame) => handleNativeFrame(generation, frame),
					onTransportError: () => {
						if (generation !== nativeGeneration || state.native === void 0) return;
						patchNative({ reconnecting: true });
						const delay = Math.min(5e3, 500 * 2 ** Math.min(nativeReconnectAttempt, 4));
						nativeReconnectAttempt += 1;
						nativeReconnectTimer = setTimeout(() => {
							nativeReconnectTimer = void 0;
							openNativeStream(generation);
						}, delay);
					}
				});
				patchNative({ reconnecting: false });
			} catch (error) {
				patchNative({
					reconnecting: true,
					error: { message: describeFailure(error) }
				});
			}
		}
		/** Load the newest page and the live status, then attach the SSE stream. */
		async function hydrateNative(generation) {
			const native = state.native;
			if (native === void 0 || generation !== nativeGeneration) return;
			patchNative({
				status: "loading",
				error: void 0
			});
			try {
				const [page, status] = await Promise.all([fetchNativePage(native.request.targetId, native.request.sessionId, { limit: 80 }), remoteApi.sessionStatus(native.request.targetId, native.request.sessionId).catch(() => void 0)]);
				if (generation !== nativeGeneration || state.native === void 0) return;
				const prompt = nativeApprovalPrompt(status);
				patchNative({
					entries: mergeNativeEntries(page.entries, nativeApprovalEntries(status)),
					hasMoreBefore: page.hasMoreBefore,
					status: nativeStatusOf(status),
					...prompt === void 0 ? { approvalPrompt: void 0 } : { approvalPrompt: prompt }
				});
			} catch (error) {
				if (generation !== nativeGeneration) return;
				patchNative({
					status: "error",
					error: {
						code: describe(error).code,
						message: describeFailure(error)
					}
				});
			}
			openNativeStream(generation);
		}
		/** Open one server-mode session in the native main area. */
		async function openNativeSessionView(targetId, workspaceId, sessionId) {
			const view = state.connections[targetId];
			if (view === void 0) return;
			const group = workspaceId === void 0 ? view.groups.find((candidate) => candidate.sessions.some((session) => session.id === sessionId)) : view.groups.find((candidate) => candidate.workspace.workspaceId === workspaceId);
			const session = view.sessions?.sessions.find((row) => row.sessionId === sessionId);
			const request = {
				targetId,
				targetLabel: view.target.label,
				sessionId,
				...group === void 0 ? {} : {
					workspaceId: group.workspace.workspaceId,
					workspaceTitle: group.workspace.title
				},
				...session?.title === void 0 ? {} : { title: session.title },
				...session?.cwd === void 0 ? {} : { cwd: session.cwd }
			};
			closeNativeView();
			const generation = nativeGeneration;
			openNativeSession(request);
			ensureExpanded(targetId, request.workspaceId);
			selectPanel(NATIVE_MAIN_ID);
			commit({
				selection: {
					targetId,
					...request.workspaceId === void 0 ? {} : { workspaceId: request.workspaceId },
					sessionId
				},
				native: {
					request,
					entries: [],
					status: "loading",
					hasMoreBefore: false,
					loadingBefore: false,
					reconnecting: false
				}
			});
			await hydrateNative(generation);
		}
		/** Close the remote main area and return to the official conversation. */
		function clearRemoteSelection(closeLocal = false) {
			if (closeLocal) releaseLocalSelection();
			closeServerMain();
			closeNativeView();
			commit({ selection: void 0 });
			selectPanel(null);
		}
		/** Open the connection/workspace nodes around one row (tree selection). */
		function ensureExpanded(targetId, workspaceId) {
			const view = state.connections[targetId];
			if (view === void 0) return;
			patchConnection(targetId, { expanded: {
				...view.expanded,
				[targetNodeKey(targetId)]: true,
				...workspaceId === void 0 ? {} : { [workspaceNodeKey(workspaceId)]: true }
			} });
		}
		/** Open one server-mode session in the native main area (prepared agent first). */
		async function openServerSession(targetId, workspaceId, sessionId) {
			if (state.connections[targetId] === void 0) return;
			if (await prepareServerSession(targetId, sessionId) === "unmanaged") notify("error", t("remote.prepare.unmanaged"));
			await openNativeSessionView(targetId, workspaceId, sessionId);
		}
		/** Open one stored session in the mode-appropriate main area. */
		async function openRemoteSession(targetId, sessionId) {
			const view = state.connections[targetId];
			if (view === void 0) return;
			if (view.mode === "local" && false);
			const workspaceId = view.groups.find((group) => group.sessions.some((session) => session.id === sessionId))?.workspace.workspaceId ?? (state.selection?.targetId === targetId ? state.selection.workspaceId : void 0);
			const sessionExecutor = view.sessions?.sessions.find((row) => row.sessionId === sessionId)?.executor ?? view.mode;
			commit({ pending: true });
			try {
				if (sessionExecutor === "server") await openServerSession(targetId, workspaceId, sessionId);
				else await openLocalSession(targetId, sessionId, workspaceId);
			} catch (error) {
				notify("error", t("remote.connect.failed", { message: describeFailure(error) }));
			} finally {
				commit({ pending: false });
			}
		}
		/** Reload and re-open the remote session after a mode switch (best effort). */
		async function reopenAfterModeSwitch(targetId) {
			const selection = state.selection;
			if (selection === void 0 || selection.targetId !== targetId || selection.sessionId === void 0) return;
			await openRemoteSession(targetId, selection.sessionId);
		}
		function setRenameSessionValue(value) {
			if (state.renameSession === void 0) return;
			commit({ renameSession: {
				...state.renameSession,
				value
			} });
		}
		function closeRenameSession() {
			commit({ renameSession: void 0 });
		}
		/** Rename one session through P1 (server-authoritative title). */
		async function submitRenameSession() {
			const request = state.renameSession;
			if (request === void 0) return;
			const title = request.value.trim();
			if (title === "") return;
			commit({ pending: true });
			try {
				await remoteApi.sessionRename(request.targetId, request.sessionId, title);
				commit({
					renameSession: void 0,
					pending: false
				});
				notify("success", t("remote.session.renamed"));
				await refreshRemoteTarget(request.targetId);
				await loadRemoteSessions(request.targetId, true);
			} catch (error) {
				markStaleOnError(request.targetId, error);
				notify("error", t("remote.session.renameFailed", { message: describeFailure(error) }));
				commit({ pending: false });
			}
		}
		/** Archive/unarchive; a running turn moves to the official confirm-retry. */
		async function toggleSessionArchive(targetId, sessionId, stopActivity = false) {
			const session = findSession(targetId, sessionId);
			if (session === void 0) return;
			const archived = !session.archived;
			commit({ pending: true });
			try {
				await remoteApi.sessionArchive(targetId, sessionId, archived, stopActivity || void 0);
				commit({ archiveActivity: void 0 });
				if (archived && state.selection?.targetId === targetId && state.selection.sessionId === sessionId) clearRemoteSelection();
				notify("success", t(archived ? "remote.session.archived" : "remote.session.unarchived"));
				await refreshRemoteTarget(targetId);
				await loadRemoteSessions(targetId, true);
			} catch (error) {
				markStaleOnError(targetId, error);
				const wire = describe(error);
				if (archived && wire.code === "session/archive-activity") {
					const details = error instanceof RemoteApiError ? error.details : void 0;
					const raw = details !== null && typeof details === "object" ? details.activities ?? details.activity : void 0;
					const activities = Array.isArray(raw) ? raw.filter((item) => typeof item === "string") : typeof raw === "string" ? [raw] : void 0;
					commit({ archiveActivity: {
						targetId,
						sessionId,
						title: session.title ?? sessionId,
						...activities === void 0 ? {} : { activities }
					} });
				} else notify("error", t("remote.verb.failed", {
					action: t("remote.session.archive"),
					message: describeFailure(error)
				}));
			} finally {
				commit({ pending: false });
			}
		}
		/** Navigate the add-workspace browser. */
		async function browseAddWorkspace(path, options = {}) {
			const request = state.addWorkspace;
			if (request === void 0 || request.loading) return;
			commit({ addWorkspace: {
				...request,
				loading: true,
				error: void 0
			} });
			try {
				const listing = await remoteApi.fsList(request.targetId, path);
				commit((previous) => previous.addWorkspace === void 0 ? {} : { addWorkspace: {
					...previous.addWorkspace,
					listing,
					...options.preservePath === true ? {} : {
						path: listing.path,
						title: basename(listing.path)
					},
					loading: false
				} });
			} catch (error) {
				commit((previous) => previous.addWorkspace === void 0 ? {} : { addWorkspace: {
					...previous.addWorkspace,
					loading: false,
					error: describe(error)
				} });
			}
		}
		/** Manually set the server path (fs/list may not be deployed yet). */
		function setAddWorkspacePath(path) {
			const request = state.addWorkspace;
			if (request === void 0) return;
			commit({ addWorkspace: {
				...request,
				path,
				error: void 0
			} });
		}
		function setAddWorkspaceTitle(title) {
			const request = state.addWorkspace;
			if (request === void 0) return;
			commit({ addWorkspace: {
				...request,
				title
			} });
		}
		function closeAddWorkspace() {
			commit({ addWorkspace: void 0 });
		}
		/** Register the browsed directory as an official workspace. */
		async function submitAddWorkspace() {
			const request = state.addWorkspace;
			if (request === void 0 || request.path === void 0) return;
			commit({ addWorkspace: {
				...request,
				creating: true
			} });
			try {
				await remoteApi.workspaceCreate(request.targetId, request.path, request.title.trim() === "" ? void 0 : request.title.trim());
				commit({ addWorkspace: void 0 });
				notify("success", t("remote.workspace.added", { title: request.title || basename(request.path) }));
				await refreshRemoteTarget(request.targetId);
				await loadRemoteSessions(request.targetId, true);
			} catch (error) {
				markStaleOnError(request.targetId, error);
				commit((previous) => previous.addWorkspace === void 0 ? {} : { addWorkspace: {
					...previous.addWorkspace,
					creating: false,
					error: describe(error)
				} });
			}
		}
		function setRenameWorkspaceValue(value) {
			if (state.renameWorkspace === void 0) return;
			commit({ renameWorkspace: {
				...state.renameWorkspace,
				value
			} });
		}
		function closeRenameWorkspace() {
			commit({ renameWorkspace: void 0 });
		}
		async function submitRenameWorkspace() {
			const request = state.renameWorkspace;
			if (request === void 0) return;
			const title = request.value.trim();
			if (title === "") return;
			commit({ pending: true });
			try {
				await remoteApi.workspaceRename(request.targetId, request.workspaceId, title);
				commit({
					renameWorkspace: void 0,
					pending: false
				});
				notify("success", t("remote.workspace.renamed", { title }));
				await refreshRemoteTarget(request.targetId);
			} catch (error) {
				markStaleOnError(request.targetId, error);
				notify("error", t("remote.workspace.renameFailed", { message: describeFailure(error) }));
				commit({ pending: false });
			}
		}
		function closeDeleteWorkspace() {
			commit({ deleteWorkspace: void 0 });
		}
		/** Delete (or force-delete after the 409 confirmation) one workspace. */
		async function submitDeleteWorkspace() {
			const request = state.deleteWorkspace;
			if (request === void 0) return;
			commit({ pending: true });
			try {
				await remoteApi.workspaceDelete(request.targetId, request.workspaceId, request.force || void 0);
				commit({
					deleteWorkspace: void 0,
					pending: false
				});
				if (state.selection?.targetId === request.targetId && state.selection.workspaceId === request.workspaceId) clearRemoteSelection();
				notify("success", t("remote.workspace.deleted", { title: request.title }));
				await refreshRemoteTarget(request.targetId);
			} catch (error) {
				const wire = describe(error);
				markStaleOnError(request.targetId, error);
				if (!request.force && wire.code === "workspace-not-empty") {
					const details = error instanceof RemoteApiError ? error.details : void 0;
					const detailCount = details !== null && typeof details === "object" ? details.sessionCount : void 0;
					const count = typeof detailCount === "number" ? detailCount : sessionCountOf(wire.message);
					commit({
						deleteWorkspace: {
							...request,
							force: true,
							...count === void 0 ? {} : { sessionCount: count }
						},
						pending: false
					});
					return;
				}
				notify("error", t("remote.workspace.deleteFailed", { message: describeFailure(error) }));
				commit({ pending: false });
			}
		}
		/** Confirm the official "stop activity and archive" retry. */
		async function confirmArchiveActivity() {
			const request = state.archiveActivity;
			if (request === void 0) return;
			await toggleSessionArchive(request.targetId, request.sessionId, true);
		}
		function closeArchiveActivity() {
			commit({ archiveActivity: void 0 });
		}
		/** Open (or reset) the minimal v1 connection dialog. */
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
				modelSource: "local",
				localProviders: [],
				localProvidersLoading: false,
				localProvidersLoaded: false,
				localSelection: {},
				localSettingsLoading: false
			} });
			hydrateLocalLlmSettings();
		}
		/** Fold a `local-llm/read` selection list into the dialog's per-provider map. */
		function selectionRecord(selection) {
			const record = {};
			for (const entry of selection) record[entry.providerId] = [...entry.models];
			return record;
		}
		/**
		* Fold a fresh catalog into the current selection.
		*
		* - a provider the user has never seen is fully selected;
		* - a provider whose saved selection exists keeps exactly those models
		*   (first discovery after hydration — the saved selection is authoritative);
		* - on a later discovery, models that appeared since the previous catalog are
		*   selected by default unless the user had explicitly deselected them, while
		*   previously deselected models stay deselected.
		*/
		function mergeLocalSelection(providers, previousSelection, previousProviders) {
			const previousCatalog = new Map(previousProviders.map((provider) => [provider.id, new Set(provider.models.map((model) => model.id))]));
			const selection = {};
			for (const provider of providers) {
				const chosen = previousSelection[provider.id];
				if (chosen === void 0) {
					selection[provider.id] = provider.models.map((model) => model.id);
					continue;
				}
				const selected = new Set(chosen);
				const known = previousCatalog.get(provider.id);
				selection[provider.id] = provider.models.map((model) => model.id).filter((id) => selected.has(id) || known !== void 0 && !known.has(id));
			}
			return selection;
		}
		/** The save payload's selection: catalog order, only models still offered. */
		function localSelectionPayload(dialog) {
			if (dialog.localProviders.length > 0) return dialog.localProviders.map((provider) => {
				const selected = new Set(dialog.localSelection[provider.id] ?? []);
				return {
					providerId: provider.id,
					models: provider.models.map((model) => model.id).filter((id) => selected.has(id))
				};
			});
			const entries = Object.entries(dialog.localSelection);
			if (entries.length === 0) return void 0;
			return entries.map(([providerId, models]) => ({
				providerId,
				models: [...models]
			}));
		}
		/**
		* Patch local-model fields without clearing a connect error.
		*
		* Hydration/discovery run in the background while a submit may be failing; the
		* user-visible `error` belongs to the submit and must survive those patches.
		*/
		function patchLocalDialog(patch) {
			const current = state.connectDialog;
			if (current === void 0) return;
			commit({ connectDialog: {
				...current,
				...patch
			} });
		}
		/**
		* Read the saved local-model settings into the open connect dialog.
		*
		* The local source is always "auto" now: the discovery catalog is the only
		* model list, and a saved `selection` decides which discovered models start
		* checked. `undefined` selection means "everything selected", which the first
		* discovery then materializes. An older host may not serve `local-llm/read`;
		* the dialog then starts with an all-selected catalog and the host resolves
		* the source at connect time (no fallback to server models).
		*/
		async function hydrateLocalLlmSettings() {
			if (state.connectDialog === void 0) return;
			patchLocalDialog({ localSettingsLoading: true });
			try {
				const read = await remoteApi.localLlmRead();
				if (state.connectDialog === void 0) return;
				patchLocalDialog({
					localSettingsLoading: false,
					...read.selection === void 0 ? {} : { localSelection: selectionRecord(read.selection) }
				});
			} catch {
				if (state.connectDialog === void 0) return;
				patchLocalDialog({ localSettingsLoading: false });
			}
			discoverLocalProviders();
		}
		/**
		* Discover the model providers the client DSH exposes (`local-llm/discover`).
		*
		* The grouped checklist is driven by this catalog; an empty result is a
		* successful discovery, not an error — the UI then tells the user to configure
		* a provider in this DSH installation. A re-discovery keeps the user's
		* deselections and selects newly appeared providers/models by default.
		*/
		async function discoverLocalProviders() {
			const dialog = state.connectDialog;
			if (dialog === void 0 || dialog.localProvidersLoading) return;
			patchLocalDialog({
				localProvidersLoading: true,
				localError: void 0
			});
			try {
				const result = await remoteApi.localLlmDiscover();
				const current = state.connectDialog;
				if (current === void 0) return;
				patchLocalDialog({
					localProvidersLoading: false,
					localProvidersLoaded: true,
					localProviders: result.providers,
					localSelection: mergeLocalSelection(result.providers, current.localSelection, current.localProviders)
				});
			} catch (error) {
				if (state.connectDialog === void 0) return;
				patchLocalDialog({
					localProvidersLoading: false,
					localProvidersLoaded: true,
					localError: t("connect.local.discoverFailed", { message: describeFailure(error) })
				});
			}
		}
		/** Toggle one discovered model in the local-source selection. */
		function toggleLocalModel(providerId, modelId) {
			const dialog = state.connectDialog;
			if (dialog === void 0) return;
			const current = dialog.localSelection[providerId] ?? [];
			const next = current.includes(modelId) ? current.filter((id) => id !== modelId) : [...current, modelId];
			const provider = dialog.localProviders.find((candidate) => candidate.id === providerId);
			const ordered = provider === void 0 ? next : provider.models.map((model) => model.id).filter((id) => next.includes(id));
			commit({ connectDialog: {
				...dialog,
				localSelection: {
					...dialog.localSelection,
					[providerId]: ordered
				}
			} });
		}
		/** Select every discovered model of one provider, or clear it. */
		function setLocalProviderSelected(providerId, selected) {
			const dialog = state.connectDialog;
			if (dialog === void 0) return;
			const provider = dialog.localProviders.find((candidate) => candidate.id === providerId);
			const models = selected ? provider?.models.map((model) => model.id) ?? [...dialog.localSelection[providerId] ?? []] : [];
			commit({ connectDialog: {
				...dialog,
				localSelection: {
					...dialog.localSelection,
					[providerId]: models
				}
			} });
		}
		/** Fold a local-model route failure into the dialog without leaking a URL secret. */
		function patchLocalError(message) {
			const dialog = state.connectDialog;
			if (dialog === void 0) return;
			commit({ connectDialog: {
				...dialog,
				localSettingsLoading: false,
				...message === void 0 ? { localError: void 0 } : { localError: message }
			} });
		}
		/**
		* Persist the local source before connecting: always `auto` (the only UI mode)
		* plus the selected models. An unhydrated/empty catalog sends no `selection`,
		* which the host reads as "all discovered models".
		* @returns true when the host accepted the settings.
		*/
		async function saveLocalLlmSettings() {
			const dialog = state.connectDialog;
			if (dialog === void 0) return false;
			patchLocalError(void 0);
			patchLocalDialog({ localSettingsLoading: true });
			const selection = localSelectionPayload(dialog);
			try {
				const read = await remoteApi.localLlmSave({
					mode: "auto",
					...selection === void 0 ? {} : { selection }
				});
				if (state.connectDialog === void 0) return true;
				patchLocalDialog({
					localSettingsLoading: false,
					...read.selection === void 0 ? {} : { localSelection: selectionRecord(read.selection) }
				});
				return true;
			} catch (error) {
				patchLocalError(t("connect.local.failed", { message: describeFailure(error) }));
				return false;
			}
		}
		/** Close the v1 connect dialog and drop its secret. */
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
		* Submit the minimal connection request.
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
			if (dialog.modelSource === "local") {
				if (dialog.localProvidersLoaded && !dialog.localProvidersLoading && dialog.localProviders.length === 0 && dialog.localError === void 0) {
					commit({ connectDialog: {
						...dialog,
						phase: "failed",
						error: {
							code: "local-llm-unconfigured",
							message: t("connect.local.auto.empty")
						}
					} });
					return;
				}
				if (!await saveLocalLlmSettings()) {
					const message = state.connectDialog?.localError ?? t("connect.local.autoFailed");
					const current = state.connectDialog;
					if (current !== void 0) commit({ connectDialog: {
						...current,
						phase: "failed",
						error: {
							code: "local-llm-save-failed",
							message
						}
					} });
					return;
				}
			}
			const attemptId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `connect-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
		/** The connection whose execution-end dialog is open, if any. */
		function modeDialogFor(snapshot) {
			return snapshot.modeDialog === void 0 ? void 0 : snapshot.connections[snapshot.modeDialog.targetId];
		}
		/** Close the execution-end settings dialog (and discard a pending preview). */
		function closeModeDialog(targetId) {
			if (state.connections[targetId]?.modeSwitch.phase === "applying") return;
			cancelModeSwitch(targetId);
			commit({ modeDialog: void 0 });
		}
		/** D20 preview for one connection's execution-end switch. */
		async function previewModeSwitch(targetId, nextMode) {
			const view = state.connections[targetId];
			if (view === void 0 || view.mode === nextMode) return;
			const targetSessionId = state.selection?.targetId === targetId ? state.selection.sessionId : void 0;
			patchConnection(targetId, { modeSwitch: modeSwitchReducer(view.modeSwitch, {
				type: "preview",
				nextMode,
				...targetSessionId === void 0 ? {} : { targetSessionId }
			}) });
			try {
				const preview = await remoteApi.modePreview(targetId, nextMode, targetSessionId);
				const current = state.connections[targetId];
				if (current === void 0) return;
				patchConnection(targetId, { modeSwitch: modeSwitchReducer({
					...current.modeSwitch,
					nextMode
				}, {
					type: "planned",
					preview
				}) });
			} catch (error) {
				markStaleOnError(targetId, error);
				const current = state.connections[targetId];
				if (current === void 0) return;
				patchConnection(targetId, { modeSwitch: modeSwitchReducer(current.modeSwitch, {
					type: "failed",
					error: executorWireError(error)
				}) });
			}
		}
		/** Confirm the D20 list and apply the switch. */
		async function applyModeSwitch(targetId) {
			const view = state.connections[targetId];
			if (view === void 0) return;
			const selected = state.selection?.targetId === targetId ? state.selection.sessionId : void 0;
			if (selected === void 0) {
				patchConnection(targetId, { modeSwitch: modeSwitchReducer(view.modeSwitch, {
					type: "failed",
					error: executorErrorView({
						code: "mode-switch/preview-failed",
						message: t("remote.mode.selectSessionFirst")
					})
				}) });
				return;
			}
			const confirmed = view.modeSwitch.phase === "ready" ? modeSwitchReducer(view.modeSwitch, { type: "begin-apply" }) : modeSwitchReducer(view.modeSwitch, { type: "confirm" });
			patchConnection(targetId, { modeSwitch: confirmed });
			const request = modeSwitchApplyRequest(confirmed);
			if (!request.ok) {
				patchConnection(targetId, { modeSwitch: modeSwitchReducer(confirmed, {
					type: "failed",
					error: executorErrorView({
						code: "mode-switch/preview-failed",
						message: request.reason
					})
				}) });
				return;
			}
			try {
				const result = await remoteApi.modeApply({
					targetId,
					nextMode: request.nextMode,
					cancelActiveTurns: true,
					previewRevision: request.previewRevision,
					targetSessionId: selected
				});
				if (result.switched !== true) throw new RemoteApiError("mode-switch/preview-failed", t("remote.mode.previewFailed", { message: "" }), 500);
				const afterApply = modeSwitchReducer(confirmed, {
					type: "applied",
					cancelledTurnIds: result.cancelledTurnIds,
					failedCancellations: result.failedCancellations
				});
				patchConnection(targetId, { modeSwitch: afterApply });
				if (afterApply.phase === "done") {
					patchConnection(targetId, {
						mode: request.nextMode,
						modeSwitch: IDLE_MODE_SWITCH
					});
					commit({ modeDialog: void 0 });
					notify("success", t("remote.mode.switched", { mode: t(request.nextMode === "server" ? "remote.mode.server" : "remote.mode.local") }));
					await refreshRemoteTarget(targetId);
					await reopenAfterModeSwitch(targetId);
				}
			} catch (error) {
				markStaleOnError(targetId, error);
				const current = state.connections[targetId];
				if (current === void 0) return;
				patchConnection(targetId, { modeSwitch: modeSwitchReducer(current.modeSwitch, {
					type: "failed",
					error: executorWireError(error)
				}) });
			}
		}
		/** Cancel the switch dialog without a write. */
		function cancelModeSwitch(targetId) {
			const view = state.connections[targetId];
			if (view === void 0) return;
			patchConnection(targetId, { modeSwitch: modeSwitchReducer(view.modeSwitch, { type: "cancel" }) });
		}
		/** Confirm and perform the restart after its preview. */
		async function confirmProfileRestart(targetId) {
			const view = state.connections[targetId];
			const preview = view?.restart.preview;
			if (view === void 0 || preview === void 0) return;
			patchConnection(targetId, { restart: {
				...view.restart,
				phase: "restarting"
			} });
			try {
				await remoteApi.profileRestart(targetId, preview.previewRevision);
				patchConnection(targetId, { restart: { phase: "done" } });
				notify("success", t("remote.restart.done"));
				const selection = state.selection;
				await loadRemoteState();
				if (selection?.targetId === targetId && selection.sessionId !== void 0) {
					closeNativeView();
					await openRemoteSession(targetId, selection.sessionId);
				}
			} catch (error) {
				patchConnection(targetId, { restart: {
					phase: "failed",
					error: executorWireError(error)
				} });
			}
		}
		function cancelProfileRestart(targetId) {
			patchConnection(targetId, { restart: { phase: "idle" } });
		}
		/** Load external registry changes without a process restart. */
		async function loadRegistryChanges(targetId) {
			if (state.connections[targetId] === void 0) return;
			try {
				await remoteApi.registryRefresh(targetId);
				patchConnection(targetId, {
					stale: false,
					reloadError: void 0
				});
				await refreshRemoteTarget(targetId);
				notify("success", t("remote.registry.loaded"));
			} catch (error) {
				patchConnection(targetId, { reloadError: executorErrorView({
					code: "registry-reload-failed",
					message: describe(error).message
				}) });
			}
		}
		function dismissRemoteNotice() {
			commit({ notice: void 0 });
		}
		function sessionCountOf(message) {
			const match = /(\d+)/.exec(message);
			return match === null ? void 0 : Number.parseInt(match[1] ?? "", 10);
		}
		function basename(path) {
			const trimmed = path.replace(/\/+$/, "");
			const index = trimmed.lastIndexOf("/");
			return index === -1 ? trimmed : trimmed.slice(index + 1) || "/";
		}
		function shellSessions() {
			try {
				return clientContext?.get("sessions");
			} catch {
				return;
			}
		}
		/** Wait until the host's create/resume summary reaches the client catalog. */
		async function waitForCatalog(sessionId) {
			const sessions = shellSessions();
			const known = () => sessions?.list?.getSnapshot?.()?.byId?.[sessionId] !== void 0;
			if (known()) return true;
			try {
				if (typeof sessions?.refresh === "function") Promise.resolve(sessions.refresh()).catch(() => {});
			} catch {}
			const deadline = Date.now() + 4e3;
			while (!known() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
			return known();
		}
		/** Reveal one already-created/resumed local-mode session in the official UI. */
		async function revealLocalSession(targetId, sessionId, workspaceId) {
			if (!await waitForCatalog(sessionId)) throw new RemoteApiError("session-reveal-timeout", t("remote.session.revealTimeout"), 0);
			const workspace = clientContext?.get("uiWorkspace");
			if (workspace?.openSession === void 0) throw new RemoteApiError("ui-workspace-unavailable", t("remote.session.shellUnavailable"), 0);
			closeNativeView();
			workspace.openSession(sessionId);
			revealedLocal.set(sessionId, targetId);
			ensureExpanded(targetId, workspaceId);
			commit({ selection: {
				targetId,
				...workspaceId === void 0 ? {} : { workspaceId },
				sessionId
			} });
		}
		/** Open one existing local-mode session through the host bridge, then reveal it. */
		async function openLocalSession(targetId, sessionId, workspaceId) {
			const result = await remoteApi.sessionOpen({
				targetId,
				...workspaceId === void 0 ? {} : { workspaceId },
				sessionId
			});
			if (result.executor === "server") {
				await openServerSession(targetId, workspaceId, result.sessionId);
				return;
			}
			await revealLocalSession(targetId, result.sessionId, workspaceId);
		}
		/** Official deselect for a local remote session (protocol §16.11, guarded). */
		function releaseLocalSelection() {
			const selected = state.selection;
			if (selected === void 0 || selected.sessionId === void 0) return;
			if (revealedLocal.get(selected.sessionId) !== selected.targetId) return;
			try {
				const workspace = clientContext?.get("uiWorkspace");
				if (typeof workspace?.clearMain === "function") workspace.clearMain();
			} catch (error) {
				console.error("[dsh-remote-workspace] clearMain failed; falling back to layout.selectPanel(null)", error);
				selectPanel(null);
			}
			revealedLocal.delete(selected.sessionId);
		}
		/** Called when a connection leaves ready: drop its local selection/iframe. */
		function releaseTarget(targetId) {
			closePortalFor(targetId);
			if (state.selection?.targetId === targetId) {
				releaseLocalSelection();
				closeNativeView();
				commit({ selection: void 0 });
				selectPanel(null);
			}
			collapseRemoteTarget(targetId);
		}
		/** Start the single P3 state stream and coalesce refreshes per target. */
		function startStateStream() {
			if (stopStateStream !== void 0) return;
			try {
				stopStateStream = openRemoteStateStream({
					onEvent: (event) => handleStateEvent(event),
					onTransportError: (message) => {
						console.warn("[dsh-remote-workspace] state stream closed", message);
					}
				});
			} catch (error) {
				console.error("[dsh-remote-workspace] state stream failed to open", error);
			}
		}
		function scheduleRefresh(targetId) {
			if (refreshTimers.has(targetId)) return;
			refreshTimers.set(targetId, setTimeout(() => {
				refreshTimers.delete(targetId);
				refreshRemoteTarget(targetId).then(() => {
					const view = state.connections[targetId];
					if (view?.connection?.phase === "ready" || view?.connection?.phase === "degraded") loadRemoteSessions(targetId, true);
				});
			}, 250));
		}
		function handleStateEvent(event) {
			switch (event.type) {
				case "change":
					if (event.reason === "external") {
						patchConnection(event.targetId, { stale: true });
						return;
					}
					scheduleRefresh(event.targetId);
					return;
				case "session/revealed":
					if (pendingReveal?.targetId === event.targetId && pendingReveal.sessionId === event.sessionId) {
						pendingReveal = void 0;
						refreshRemoteTarget(event.targetId);
					}
					return;
				case "mode-switch/progress": {
					const view = state.connections[event.targetId];
					if (view === void 0) return;
					patchConnection(event.targetId, { modeSwitch: modeSwitchReducer(view.modeSwitch, {
						type: "progress",
						phase: event.phase
					}) });
					return;
				}
				case "turn/cancelled":
					scheduleRefresh(event.targetId);
					return;
				case "mode/changed":
					if (state.connections[event.targetId] === void 0) return;
					patchConnection(event.targetId, { mode: event.mode });
					scheduleRefresh(event.targetId);
					return;
			}
		}
		/** Bind the client context and start the stream; called once from `apply`. */
		function bindRemoteStoreContext(ctx) {
			clientContext = ctx;
			startStateStream();
			startOfficialSelectionWatch();
		}
		/** The layout's active panel id: null means the official conversation. */
		function activePanelId() {
			try {
				return (clientContext?.get("layout"))?.panelInfo?.getSnapshot?.().activePanelId;
			} catch {
				return;
			}
		}
		/** The official UI's selected session id (public retention fallback included). */
		function officialSelectedSessionId() {
			try {
				const selected = (clientContext?.get("uiWorkspace"))?.selection?.getSnapshot?.()?.sessionId;
				if (typeof selected === "string" && selected !== "") return selected;
			} catch {}
			try {
				const byId = (clientContext?.get("sessions"))?.list?.getSnapshot?.()?.byId;
				if (byId !== void 0) {
					for (const [id, row] of Object.entries(byId)) if ((row?.retainedBy?.mainView ?? 0) > 0) return id;
				}
			} catch {}
		}
		/**
		* Keep the remote highlight from surviving a switch to a **local** conversation.
		*
		* When the official conversation panel is active and its selected session is
		* not one this plugin revealed (local mode), the remote tree must not keep a
		* second, stale highlight (requirement: the two highlight sources never show
		* together). A selected remote/local-mode session stays highlighted because it
		* is in `revealedLocal`.
		*/
		function syncOfficialSelection() {
			if (activePanelId() !== null) return;
			const selected = officialSelectedSessionId();
			if (selected === void 0) return;
			if (revealedLocal.get(selected) !== void 0) return;
			if (state.selection === void 0) return;
			closeNativeView();
			commit({ selection: void 0 });
		}
		/** Subscribe to the shell selection signals once; cheap and idempotent. */
		function startOfficialSelectionWatch() {
			if (stopOfficialSelection !== void 0) return;
			const disposers = [];
			try {
				const layout = clientContext?.get("layout");
				if (typeof layout?.panelInfo?.subscribe === "function") disposers.push(layout.panelInfo.subscribe(syncOfficialSelection));
			} catch {}
			try {
				const workspace = clientContext?.get("uiWorkspace");
				if (typeof workspace?.selection?.subscribe === "function") disposers.push(workspace.selection.subscribe(syncOfficialSelection));
			} catch {}
			try {
				const sessions = clientContext?.get("sessions");
				if (typeof sessions?.list?.subscribe === "function") disposers.push(sessions.list.subscribe(syncOfficialSelection));
			} catch {}
			if (disposers.length === 0) return;
			stopOfficialSelection = () => {
				for (const dispose of disposers) dispose();
			};
		}
		/** Dispose the stream subscription and timers (hot reload). */
		function disposeRemoteStore() {
			closeNativeView();
			stopStateStream?.();
			stopStateStream = void 0;
			stopPortalSelection?.();
			stopPortalSelection = void 0;
			stopOfficialSelection?.();
			stopOfficialSelection = void 0;
			pendingReveal = void 0;
			for (const timer of refreshTimers.values()) clearTimeout(timer);
			refreshTimers.clear();
			revealedLocal.clear();
		}
		//#endregion
		//#region src/client/remote-dialogs.tsx
		/**
		* v1 remote dialogs: add/remove/rename, archive confirmation, execution-end
		* settings (D20) and profile-restart confirmation.
		*
		* They are rendered by the remote tree (the sidebar section is the primary
		* host), using the same primitives as the shell's own dialogs. Every dialog is
		* driven by `remote-store` state and performs one P3 command; none of them
		* keeps a second copy of server data.
		*/
		/** Sort a directory listing: directories first, then names. */
		function sortedEntries(entries) {
			return [...entries].sort((left, right) => {
				const leftDirectory = left.type === "directory" ? 0 : 1;
				const rightDirectory = right.type === "directory" ? 0 : 1;
				if (leftDirectory !== rightDirectory) return leftDirectory - rightDirectory;
				return left.name.localeCompare(right.name, "zh-Hans-CN");
			});
		}
		/** Three-step v1 connection wizard: method → SSH identity → connect/deploy. */
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
		/** Checked model count per provider (missing key = none checked yet). */
		function selectedModelCount(provider, selection) {
			const checked = new Set(selection[provider.id] ?? []);
			return provider.models.reduce((total, model) => total + (checked.has(model.id) ? 1 : 0), 0);
		}
		/** Total number of discovered models across every provider. */
		function totalModelCount(providers) {
			return providers.reduce((total, provider) => total + provider.models.length, 0);
		}
		function ConnectDialog(props) {
			const dialog = props.state.connectDialog;
			const [step, setStep] = (0, react.useState)("method");
			const [aliases, setAliases] = (0, react.useState)([]);
			const [aliasWarnings, setAliasWarnings] = (0, react.useState)([]);
			const [aliasesLoading, setAliasesLoading] = (0, react.useState)(false);
			const [aliasesLoaded, setAliasesLoaded] = (0, react.useState)(false);
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
			const current = dialog.phase === "hostkey" ? "connect" : step;
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
				title: t("remote.connect.title"),
				className: "dsh-rw-connect-modal",
				closeLabel: t("remote.dialog.cancel"),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("nav", {
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
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: "dsh-rw-method",
												"data-selected": "true",
												"aria-pressed": true,
												"aria-label": t("method.ssh.aria"),
												onClick: () => {
													setStep("config");
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dsh-rw-method-name",
													children: t("method.ssh.name")
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dsh-rw-method-description",
													children: t("method.ssh.description")
												})]
											})
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
										dialog.authKind === "privateKey" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
											label: t("remote.connect.privateKeyPath"),
											hint: t("remote.connect.privateKeyHint"),
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												className: "dsh-rw-rename-input",
												value: dialog.privateKeyPath,
												disabled: submitting,
												placeholder: "~/.ssh/id_ed25519",
												onChange: (event) => patch({ privateKeyPath: event.target.value })
											})
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
												const next = !advancedOpen;
												setAdvancedOpen(next);
												if (next && dialog.modelSource === "local" && !dialog.localProvidersLoaded && !dialog.localProvidersLoading) discoverLocalProviders();
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
															hint: t("connect.local.hint"),
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
																onChange: (next) => patch({
																	modelSource: next,
																	localError: void 0
																})
															})
														}), dialog.modelSource === "server" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
															className: "dsh-rw-hint",
															children: t("connect.local.serverHint")
														}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
															className: "dsh-rw-local-auto",
															children: [
																/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
																	className: "dsh-rw-hint",
																	children: t("connect.local.auto.hint")
																}),
																/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																	className: "dsh-rw-inline dsh-rw-local-models-row",
																	children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
																		variant: "outline",
																		size: "sm",
																		disabled: submitting || dialog.localProvidersLoading || dialog.localSettingsLoading,
																		onClick: () => {
																			discoverLocalProviders();
																		},
																		children: dialog.localProvidersLoading ? t("connect.local.auto.refreshing") : t("connect.local.auto.refresh")
																	}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																		className: "dsh-rw-hint",
																		"data-testid": "dsh-rw-local-summary",
																		children: t("connect.local.auto.summary", {
																			providers: dialog.localProviders.length,
																			selected: dialog.localProviders.reduce((total, provider) => total + selectedModelCount(provider, dialog.localSelection), 0),
																			models: totalModelCount(dialog.localProviders)
																		})
																	})]
																}),
																dialog.localProvidersLoaded && dialog.localProviders.length === 0 && !dialog.localProvidersLoading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
																	className: "dsh-rw-hint",
																	"data-testid": "dsh-rw-local-empty",
																	children: t("connect.local.auto.empty")
																}),
																dialog.localProviders.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																	className: "dsh-rw-local-catalog",
																	"aria-label": t("connect.local.auto.providers"),
																	children: dialog.localProviders.map((provider) => {
																		const checked = new Set(dialog.localSelection[provider.id] ?? []);
																		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																			className: "dsh-rw-local-provider",
																			"data-testid": `dsh-rw-local-provider-${provider.id}`,
																			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																				className: "dsh-rw-local-provider-head",
																				children: [
																					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																						className: "dsh-rw-local-provider-name",
																						children: provider.name
																					}),
																					provider.name !== provider.id && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																						className: "dsh-rw-local-provider-id",
																						children: provider.id
																					}),
																					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																						className: "dsh-rw-local-provider-count",
																						children: t("connect.local.auto.providerCount", {
																							selected: selectedModelCount(provider, dialog.localSelection),
																							total: provider.models.length
																						})
																					}),
																					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																						className: "dsh-rw-local-provider-actions",
																						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
																							variant: "ghost",
																							size: "sm",
																							disabled: submitting,
																							onClick: () => {
																								setLocalProviderSelected(provider.id, true);
																							},
																							children: t("connect.local.auto.selectAll")
																						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
																							variant: "ghost",
																							size: "sm",
																							disabled: submitting,
																							onClick: () => {
																								setLocalProviderSelected(provider.id, false);
																							},
																							children: t("connect.local.auto.clear")
																						})]
																					})
																				]
																			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																				className: "dsh-rw-local-model-list",
																				children: provider.models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
																					className: "dsh-rw-local-model-option",
																					children: [
																						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																							type: "checkbox",
																							checked: checked.has(model.id),
																							disabled: submitting,
																							"data-testid": `dsh-rw-local-model-${provider.id}-${model.id}`,
																							onChange: () => {
																								toggleLocalModel(provider.id, model.id);
																							}
																						}),
																						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																							className: "dsh-rw-local-model-name",
																							children: model.name
																						}),
																						model.name !== model.id && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																							className: "dsh-rw-local-model-id",
																							children: model.id
																						})
																					]
																				}, model.id))
																			})]
																		}, provider.id);
																	})
																}),
																dialog.localError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
																	className: "dsh-rw-side-error",
																	children: dialog.localError
																})
															]
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
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dsh-rw-connect-identity-item",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("remote.connect.authKind") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: dialog.authKind === "password" ? t("remote.connect.auth.password") : dialog.authKind === "privateKey" ? t("remote.connect.auth.privateKey") : t("remote.connect.auth.agent") })]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
															}), event !== void 0 && event.message !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: "dsh-rw-progress-message",
																children: event.message
															})]
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
										}),
										dialog.error === void 0 && dialog.localError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "dsh-rw-side-error",
											children: dialog.localError
										})
									]
								})
							]
						})]
					})
				})
			});
		}
		/** The add-workspace directory browser. */
		function AddWorkspaceDialog(props) {
			const dialog = props.state.addWorkspace;
			const [newDirName, setNewDirName] = (0, react.useState)("");
			const [mkdirPending, setMkdirPending] = (0, react.useState)(false);
			const [mkdirError, setMkdirError] = (0, react.useState)(void 0);
			if (dialog === void 0) return null;
			const createDirectory = async () => {
				const name = newDirName.trim();
				if (name === "" || dialog.listing === void 0) return;
				if (name.includes("/")) {
					setMkdirError(t("remote.addWorkspace.dirNameInvalid"));
					return;
				}
				setMkdirPending(true);
				setMkdirError(void 0);
				try {
					const base = dialog.listing.path.replace(/\/+$/u, "");
					await remoteApi.mkdir(dialog.targetId, `${base}/${name}`);
					setNewDirName("");
					await browseAddWorkspace(dialog.listing.path, { preservePath: true });
				} catch (error) {
					setMkdirError(error instanceof Error ? error.message : String(error));
				} finally {
					setMkdirPending(false);
				}
			};
			const entries = dialog.listing === void 0 ? [] : sortedEntries(dialog.listing.entries);
			const parent = dialog.listing?.parent;
			const typedPath = dialog.path ?? "";
			const slash = typedPath.lastIndexOf("/");
			const typedBase = slash >= 0 ? typedPath.slice(0, slash + 1) : "";
			const typedPrefix = slash >= 0 ? typedPath.slice(slash + 1) : typedPath;
			const visibleEntries = dialog.listing !== void 0 && typedBase.replace(/\/+$/u, "") === dialog.listing.path.replace(/\/+$/u, "") && typedPrefix !== "" ? entries.filter((entry) => entry.name.toLowerCase().startsWith(typedPrefix.toLowerCase())) : entries;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: closeAddWorkspace,
				className: "dsh-rw-addworkspace-modal",
				contentClassName: "dsh-rw-addworkspace-content",
				title: t("remote.addWorkspace.title"),
				description: t("remote.addWorkspace.description", { label: dialog.targetLabel }),
				closeLabel: t("remote.addWorkspace.close"),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-rw-footer-actions",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-rw-footer-group",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "ghost",
							onClick: closeAddWorkspace,
							disabled: dialog.creating,
							children: t("remote.addWorkspace.close")
						})
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-rw-footer-group",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							disabled: dialog.creating || dialog.loading || dialog.path === void 0,
							onClick: () => {
								submitAddWorkspace();
							},
							children: dialog.creating ? t("remote.addWorkspace.creating") : t("remote.addWorkspace.create")
						})
					})]
				}),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-rw-add-workspace",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
							label: t("remote.addWorkspace.pathLabel"),
							hint: t("remote.addWorkspace.pathHint"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "dsh-rw-rename-input",
								value: dialog.path ?? "",
								disabled: dialog.creating,
								placeholder: "/home/tester/projects",
								onChange: (event) => {
									const next = event.target.value;
									setAddWorkspacePath(next);
									if (next.endsWith("/")) browseAddWorkspace(next, { preservePath: true });
								},
								onKeyDown: (event) => {
									if (event.key !== "Enter") return;
									event.preventDefault();
									if (dialog.path !== void 0 && dialog.path !== "") browseAddWorkspace(dialog.path);
								}
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-rw-add-path",
							children: dialog.path ?? "…"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-rw-mkdir",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "dsh-rw-rename-input",
								value: newDirName,
								disabled: mkdirPending,
								placeholder: t("remote.addWorkspace.dirNamePlaceholder"),
								"aria-label": t("remote.addWorkspace.dirName"),
								onChange: (event) => {
									setNewDirName(event.target.value);
									setMkdirError(void 0);
								},
								onKeyDown: (event) => {
									if (event.key !== "Enter") return;
									event.preventDefault();
									createDirectory();
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								size: "sm",
								disabled: mkdirPending || newDirName.trim() === "" || dialog.listing === void 0,
								onClick: () => {
									createDirectory();
								},
								children: mkdirPending ? t("remote.addWorkspace.dirCreating") : t("remote.addWorkspace.dirCreate")
							})]
						}),
						mkdirError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-rw-side-error",
							children: mkdirError
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-rw-dir-list",
							children: [
								parent !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-rw-dir-row",
									onClick: () => {
										browseAddWorkspace(parent);
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsh-rw-dir-name",
										children: t("remote.addWorkspace.parent")
									})
								}),
								visibleEntries.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "dsh-rw-dir-row",
									"data-type": entry.type,
									disabled: entry.type !== "directory",
									onClick: () => {
										browseAddWorkspace(entry.path);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsh-rw-dir-name",
										children: entry.name
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsh-rw-dir-kind",
										children: entry.type
									})]
								}, entry.path)),
								dialog.loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsh-rw-hint",
									children: t("remote.addWorkspace.loading")
								}),
								!dialog.loading && visibleEntries.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsh-rw-hint",
									children: t("remote.addWorkspace.empty")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-rw-field",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-rw-field-label",
									children: t("remote.addWorkspace.titleLabel")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "dsh-rw-rename-input",
									value: dialog.title,
									disabled: dialog.creating,
									"aria-label": t("remote.addWorkspace.titleLabel"),
									onChange: (event) => setAddWorkspaceTitle(event.target.value)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-rw-field-hint",
									children: t("remote.addWorkspace.titleHint")
								})
							]
						}),
						dialog.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-rw-side-error",
							children: t("remote.addWorkspace.failed", { message: dialog.error.message })
						})
					]
				})
			});
		}
		/** Shared one-line input form body. */
		function RenameForm(props) {
			const input = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				input.current?.focus();
			}, []);
			const submit = () => {
				if (props.value.trim() === "" || props.pending) return;
				props.onSubmit();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: props.onCancel,
				title: props.label,
				closeLabel: t("remote.dialog.cancel"),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					onClick: props.onCancel,
					disabled: props.pending,
					children: t("remote.dialog.cancel")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					onClick: submit,
					disabled: props.pending || props.value.trim() === "",
					children: t("remote.dialog.rename")
				})] }),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					ref: input,
					className: "dsh-rw-rename-input",
					value: props.value,
					disabled: props.pending,
					placeholder: t("remote.rename.placeholder"),
					"aria-label": props.label,
					onChange: (event) => props.onChange(event.target.value),
					onKeyDown: (event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							submit();
						}
					}
				})
			});
		}
		/** Every dialog the remote tree owns. */
		function RemoteDialogs() {
			const state = useRemoteAppState();
			const view = modeDialogFor(state);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConnectDialog, { state }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AddWorkspaceDialog, { state }),
				state.renameWorkspace !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RenameForm, {
					label: t("remote.rename.workspace.title"),
					value: state.renameWorkspace.value,
					pending: state.pending,
					onChange: setRenameWorkspaceValue,
					onSubmit: () => {
						submitRenameWorkspace();
					},
					onCancel: closeRenameWorkspace
				}),
				state.renameSession !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RenameForm, {
					label: t("remote.rename.session.title"),
					value: state.renameSession.value,
					pending: state.pending,
					onChange: setRenameSessionValue,
					onSubmit: () => {
						submitRenameSession();
					},
					onCancel: closeRenameSession
				}),
				state.deleteWorkspace !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
					open: true,
					onClose: closeDeleteWorkspace,
					title: state.deleteWorkspace.force ? t("remote.workspace.removeForceTitle", { count: state.deleteWorkspace.sessionCount ?? "?" }) : t("remote.workspace.removeTitle"),
					description: state.deleteWorkspace.force ? t("remote.workspace.removeForceMessage") : t("remote.workspace.removeMessage", {
						title: state.deleteWorkspace.title,
						path: state.deleteWorkspace.path
					}),
					closeLabel: t("remote.dialog.cancel"),
					footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						onClick: closeDeleteWorkspace,
						disabled: state.pending,
						children: t("remote.dialog.cancel")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "primary",
						onClick: () => {
							submitDeleteWorkspace();
						},
						disabled: state.pending,
						children: state.deleteWorkspace.force ? t("remote.workspace.removeForce") : t("remote.workspace.remove")
					})] }),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {})
				}),
				state.archiveActivity !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
					open: true,
					onClose: closeArchiveActivity,
					title: t("remote.session.archiveBlocked"),
					closeLabel: t("remote.dialog.cancel"),
					footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						onClick: closeArchiveActivity,
						disabled: state.pending,
						children: t("remote.dialog.cancel")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "primary",
						onClick: () => {
							confirmArchiveActivity();
						},
						disabled: state.pending,
						children: t("remote.session.archiveStop")
					})] }),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-rw-hint",
						children: t("remote.session.archiveActivities", { activities: state.archiveActivity.activities === void 0 ? state.archiveActivity.title : state.archiveActivity.activities.join(" · ") })
					})
				}),
				state.forgetTarget !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
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
				}),
				view !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModeDialog, {
					state,
					view
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RestartDialog, { state })
			] });
		}
		/** The execution-end settings + D20 confirmation dialog. */
		function ModeDialog(props) {
			const { state, view } = props;
			const targetId = view.target.id;
			const modeSwitch = view.modeSwitch;
			const preview = modeSwitch.preview;
			const summary = preview === void 0 ? void 0 : summarizeModeSwitch(preview);
			if (modeSwitch.phase === "confirming" && summary !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: () => cancelModeSwitch(targetId),
				title: t("remote.mode.confirmTitle"),
				closeLabel: t("remote.dialog.cancel"),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					onClick: () => cancelModeSwitch(targetId),
					children: t("remote.dialog.cancel")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					onClick: () => {
						applyModeSwitch(targetId);
					},
					children: t("remote.mode.confirm")
				})] }),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-rw-mode-confirm",
					children: [summary.currentTurn !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("remote.mode.confirmCurrent") }), summary.otherActiveTurns.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("remote.mode.confirmOthers", { count: summary.otherActiveTurns.length }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: summary.otherActiveTurns.map((turn) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: t("remote.mode.confirmItem", {
						title: turn.title ?? t("remote.mode.confirmUntitled"),
						id: turn.sessionId
					}) }, turn.sessionId)) })] })]
				})
			});
			const failed = modeSwitch.phase === "failed";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: () => closeModeDialog(targetId),
				title: t("remote.mode.switchMenu"),
				closeLabel: t("remote.dialog.cancel"),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					onClick: () => closeModeDialog(targetId),
					disabled: modeSwitch.phase === "applying",
					children: t("remote.dialog.cancel")
				}),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-rw-mode-dialog",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-rw-hint",
							children: t("remote.mode.current", { mode: t(view.mode === "server" ? "remote.mode.server" : "remote.mode.local") })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-rw-hint",
							children: t(view.mode === "server" ? "remote.mode.credentials.server" : "remote.mode.credentials.local")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-rw-mode-actions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: view.mode === "server" ? "primary" : "outline",
								disabled: view.mode === "server" || modeSwitch.phase === "previewing" || modeSwitch.phase === "applying",
								onClick: () => {
									previewModeSwitch(targetId, "server");
								},
								children: t("remote.mode.server")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: view.mode === "local" ? "primary" : "outline",
								disabled: view.mode === "local" || modeSwitch.phase === "previewing" || modeSwitch.phase === "applying",
								onClick: () => {
									previewModeSwitch(targetId, "local");
								},
								children: t("remote.mode.local")
							})]
						}),
						false,
						state.selection?.targetId !== targetId && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-rw-hint",
							children: t("remote.mode.selectSessionFirst")
						}),
						modeSwitch.phase === "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							onClick: () => {
								applyModeSwitch(targetId);
							},
							children: t("remote.mode.apply")
						}),
						modeSwitch.phase === "previewing" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-rw-hint",
							children: t("remote.mode.switching")
						}),
						modeSwitch.phase === "applying" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "dsh-rw-hint",
							children: [t("remote.mode.switching"), modeSwitch.progressPhase === void 0 ? "" : ` (${modeSwitch.progressPhase})`]
						}),
						modeSwitch.phase === "done" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-rw-hint",
							children: t("remote.mode.switched", { mode: t(modeSwitch.nextMode === "local" ? "remote.mode.local" : "remote.mode.server") })
						}),
						failed && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-rw-side-error",
							children: t("remote.mode.previewFailed", { message: modeSwitch.error?.message ?? "" })
						}), modeSwitch.nextMode !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							onClick: () => {
								previewModeSwitch(targetId, modeSwitch.nextMode);
							},
							children: t("remote.mode.retry")
						})] })
					]
				})
			});
		}
		/** Profile-restart confirmation (D20), shown when a preview is pending. */
		function RestartDialog(props) {
			const entry = Object.values(props.state.connections).find((view) => view.restart.phase === "confirming");
			if (entry === void 0 || entry.restart.preview === void 0) return null;
			const preview = entry.restart.preview;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: () => cancelProfileRestart(entry.target.id),
				title: t("remote.restart.title"),
				closeLabel: t("remote.dialog.cancel"),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					onClick: () => cancelProfileRestart(entry.target.id),
					children: t("remote.dialog.cancel")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					onClick: () => {
						confirmProfileRestart(entry.target.id);
					},
					children: t("remote.restart.confirm")
				})] }),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-rw-mode-confirm",
					children: [preview.activeTurns.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("remote.restart.none") }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("remote.restart.message", { count: preview.activeTurns.length }) }), preview.activeTurns.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: preview.activeTurns.map((turn) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: turn.title ?? turn.sessionId }, turn.sessionId)) })]
				})
			});
		}
		//#endregion
		//#region src/client/rail.tsx
		/**
		* The floating **target rail** — the only client chrome beside the dialogs.
		*
		* The v3 main area is the server's complete official UI, so the client stops
		* duplicating its sidebar workspace/session tree. What remains is a narrow,
		* collapsed-by-default rail that lists saved targets, shows their live phase
		* and switches the full-screen frame between them. Hover or `Alt+R` expands it
		* (the official rail rule in the refactor plan); every action still goes
		* through `remote-store` and the existing connection dialogs.
		*/
		/** Marker attribute for the body-level rail host (idempotent mounting). */
		const TARGET_RAIL_ATTR = "data-dsh-remote-workspace-rail";
		/** `localStorage` key that remembers the user's chosen dock across remounts. */
		const RAIL_DOCK_STORAGE_KEY = "dsh-remote-workspace.rail-dock";
		/** Pointer travel that turns a press into a drag instead of a click. */
		const RAIL_DRAG_THRESHOLD = 4;
		/** Collapsed width of one bar chip, used to size the horizontal rail. */
		const RAIL_BAR_CHIP_WIDTH = 34;
		const RAIL_DOCKS = [
			"left",
			"right",
			"top",
			"bottom"
		];
		/** Clamp a value into `[min, max]` (max may fall below min on tiny viewports). */
		function clamp(value, min, max) {
			return Math.max(min, Math.min(value, Math.max(min, max)));
		}
		/** Width of a collapsed horizontal rail: one 34px chip per target plus padding. */
		function railBarWidth(targetCount) {
			return Math.max(44, targetCount * RAIL_BAR_CHIP_WIDTH + 12);
		}
		/**
		* The collapse toggle only exists on a collapsed rail that actually has
		* something to fold: two or more connections and no active expansion.
		*/
		/**
		* The collapse toggle is offered whenever there is more than one connection to
		* fold away. It stays mounted while the rail is hover-expanded too: the pointer
		* has to cross the strip to reach it, and hiding it on hover would make the
		* control impossible to click.
		*/
		function railShowsToggle(expanded, minimized, targetCount) {
			return !expanded && !minimized && targetCount > 1;
		}
		/**
		* Position the fold button *outside* the rail box so reaching it never triggers
		* the hover-expand of the rail. It sits in the gutter the strip reserves for it:
		* below the last glyph on the left/right edges, after the last chip on the
		* top/bottom bars.
		* @returns absolute style inside the fixed rail host, or undefined when hidden.
		*/
		function railToggleStyle(placement, expanded, minimized, targetCount, viewport) {
			if (!railShowsToggle(expanded, minimized, targetCount)) return void 0;
			const edge = 6 + targetCount * RAIL_BAR_CHIP_WIDTH + 2;
			if (placement.dock === "left") return {
				left: 16,
				top: placement.offset + edge
			};
			if (placement.dock === "right") return {
				left: Math.max(10, viewport.width - 10 - 44 + 6),
				top: placement.offset + edge
			};
			const barWidth = railBarWidth(targetCount + 1);
			const barLeft = clamp(placement.offset, 10, viewport.width - 10 - barWidth);
			const left = Math.max(10, Math.min(barLeft + edge, viewport.width - 10 - 44 + 2));
			return placement.dock === "top" ? {
				left,
				top: 16
			} : {
				left,
				top: Math.max(10, viewport.height - 10 - 44 + 6)
			};
		}
		/**
		* Inline box style for the rail at a dock.
		*
		* Collapsed: a compact strip along the docked edge (top/bottom bars are wide
		* enough for one glyph per target). Expanded: always the same vertical list
		* (CSS sets the 280px width), anchored to the same edge and limited to the
		* viewport height so the list scrolls instead of running off screen.
		*/
		function railBoxStyle(placement, expanded, targetCount, viewport, minimized = false) {
			if (placement.dock === "left") return {
				left: 10,
				top: placement.offset
			};
			if (placement.dock === "right") return {
				right: 10,
				top: placement.offset
			};
			if (expanded) {
				const left = clamp(placement.offset, 10, viewport.width - 10 - 280);
				const maxHeight = Math.max(44, viewport.height - 20);
				return placement.dock === "top" ? {
					top: 10,
					left,
					maxHeight
				} : {
					bottom: 10,
					left,
					maxHeight
				};
			}
			const width = minimized ? 44 : railBarWidth(targetCount + (targetCount > 1 ? 1 : 0));
			const left = clamp(placement.offset, 10, viewport.width - 10 - width);
			return placement.dock === "top" ? {
				top: 10,
				left,
				width
			} : {
				bottom: 10,
				left,
				width
			};
		}
		/** Pick the screen edge closest to the pointer. */
		function nearestRailDock(pointer, viewport) {
			const distances = [
				["left", pointer.x],
				["right", viewport.width - pointer.x],
				["top", pointer.y],
				["bottom", viewport.height - pointer.y]
			];
			let best = distances[0];
			for (const candidate of distances.slice(1)) if (candidate[1] < best[1]) best = candidate;
			return best[0];
		}
		/**
		* Snap a free position to the nearest edge.
		*
		* Left/right docks keep the collapsed vertical column and offset along Y;
		* top/bottom docks become the horizontal bar and offset along X.
		* @param pointer - final pointer position in viewport coordinates.
		* @param viewport - current viewport size in CSS pixels.
		* @returns the dock and the clamped edge offset.
		*/
		function snapRailPlacement(pointer, viewport) {
			const dock = nearestRailDock(pointer, viewport);
			if (dock === "left" || dock === "right") return {
				dock,
				offset: clamp(pointer.y - 22, 10, viewport.height - 44 - 10)
			};
			return {
				dock,
				offset: clamp(pointer.x - 22, 10, viewport.width - 44 - 10)
			};
		}
		/** Keep an already-snapped placement inside the current viewport. */
		function clampRailPlacement(placement, viewport) {
			if (viewport.width <= 0 || viewport.height <= 0) return placement;
			if (placement.dock === "left" || placement.dock === "right") return {
				dock: placement.dock,
				offset: clamp(placement.offset, 10, viewport.height - 44 - 10)
			};
			return {
				dock: placement.dock,
				offset: clamp(placement.offset, 10, viewport.width - 44 - 10)
			};
		}
		function isRailDock(value) {
			return typeof value === "string" && RAIL_DOCKS.includes(value);
		}
		function readStoredPlacement() {
			if (typeof window === "undefined") return void 0;
			try {
				const raw = window.localStorage.getItem(RAIL_DOCK_STORAGE_KEY);
				if (raw === null) return void 0;
				const value = JSON.parse(raw);
				if (isRailDock(value.dock) && typeof value.offset === "number" && Number.isFinite(value.offset)) return {
					dock: value.dock,
					offset: Math.max(10, value.offset)
				};
			} catch {}
		}
		function storePlacement(placement) {
			if (typeof window === "undefined") return;
			try {
				window.localStorage.setItem(RAIL_DOCK_STORAGE_KEY, JSON.stringify(placement));
			} catch {}
		}
		function viewportSize() {
			if (typeof window === "undefined") return {
				width: 0,
				height: 0
			};
			return {
				width: window.innerWidth,
				height: window.innerHeight
			};
		}
		/** Default dock: a tall-centred column on the left edge. */
		const DEFAULT_PLACEMENT = {
			dock: "left",
			offset: 96
		};
		/** Live viewport size, re-read on window resizes (0×0 outside a document). */
		function useViewport() {
			const [size, setSize] = (0, react.useState)(viewportSize);
			(0, react.useEffect)(() => {
				if (typeof window === "undefined") return;
				const onResize = () => {
					setSize(viewportSize());
				};
				window.addEventListener("resize", onResize);
				return () => window.removeEventListener("resize", onResize);
			}, []);
			return size;
		}
		/** Short label shown in collapsed mode: first visible character of the name. */
		function initialOf(label) {
			const first = [...label.trim()][0];
			return first === void 0 ? "?" : first.toUpperCase();
		}
		/** Connected when the host reports a ready/degraded profile. */
		function isConnected(view) {
			const phase = view.connection?.phase;
			return phase === "ready" || phase === "degraded";
		}
		/** One target chip: compact glyph + expanded label/actions. */
		function TargetChip(props) {
			const { view, active, pinned } = props;
			const connected = isConnected(view);
			const phase = view.connection?.phase ?? (view.target.status === "ready" ? "ready" : "stopped");
			const failed = view.connection?.error !== void 0 || view.error !== void 0;
			const endpoint = view.target.kind === "wsl" ? view.target.wslDistro ?? view.target.host : `${view.target.username}@${view.target.host}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-rail-target",
				"data-active": active ? "true" : void 0,
				"data-connected": connected ? "true" : void 0,
				"data-phase": phase,
				"data-pinned": pinned ? "true" : void 0,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "dsh-rw-rail-main",
					"aria-label": t("rail.activate", { label: view.target.label }),
					title: connected ? t("rail.activate", { label: view.target.label }) : t("rail.connect", { label: view.target.label }),
					onClick: () => {
						activateRemoteTarget(view.target.id);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-rw-rail-glyph",
						"aria-hidden": "true",
						children: view.connecting ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-rw-rail-spinner" }) : initialOf(view.target.label)
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsh-rw-rail-label",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-rw-rail-name",
							children: view.target.label
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsh-rw-rail-meta",
							children: [failed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningTriangleOutlineRegular, { size: 11 }), `${endpoint} · ${t(`remote.phase.${phase}`)}`]
						})]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsh-rw-rail-actions",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsh-rw-rail-action",
						disabled: view.connecting,
						title: connected ? t("list.stop") : t("list.reconnect"),
						"aria-label": connected ? t("list.stop") : t("list.reconnect"),
						onClick: () => {
							connected ? disconnectRemoteTarget(view.target.id) : connectRemoteTarget(view.target.id);
						},
						children: t(connected ? "rail.disconnect" : "rail.connectShort")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsh-rw-rail-action",
						title: t("tree.forgetConnection"),
						"aria-label": t("tree.forgetConnection"),
						onClick: () => requestForgetTarget(view.target.id),
						children: t("rail.forget")
					})]
				})]
			});
		}
		/** The rail surface, including the dialogs it owns. */
		function TargetRail() {
			const state = useRemoteAppState();
			const active = useServerMainRequest();
			const [hovered, setHovered] = (0, react.useState)(false);
			const [pinned, setPinned] = (0, react.useState)(false);
			const [minimized, setMinimized] = (0, react.useState)(false);
			const expanded = !minimized && (pinned || hovered);
			const portalActive = active !== void 0;
			const [placement, setPlacement] = (0, react.useState)(() => clampRailPlacement(readStoredPlacement() ?? DEFAULT_PLACEMENT, viewportSize()));
			const [userDocked, setUserDocked] = (0, react.useState)(() => readStoredPlacement() !== void 0);
			const [drag, setDrag] = (0, react.useState)(null);
			const viewport = useViewport();
			const dragSession = (0, react.useState)(() => ({
				startX: 0,
				startY: 0,
				pointerId: void 0,
				moved: false,
				suppressClick: false
			}))[0];
			(0, react.useEffect)(() => {
				if (typeof document === "undefined") return;
				const host = document.querySelector(`[${TARGET_RAIL_ATTR}]`);
				if (host === null) return;
				if (portalActive) host.setAttribute("data-portal", "true");
				else host.removeAttribute("data-portal");
			}, [portalActive]);
			(0, react.useEffect)(() => {
				if (!portalActive || userDocked) return;
				const size = viewportSize();
				if (size.width <= 0 || size.height <= 0) return;
				setPlacement((current) => current.dock === "right" ? current : {
					dock: "right",
					offset: Math.max(10, Math.round((size.height - 44) / 2))
				});
			}, [portalActive, userDocked]);
			(0, react.useEffect)(() => {
				if (viewport.width <= 0 || viewport.height <= 0) return;
				setPlacement((current) => clampRailPlacement(current, viewport));
			}, [viewport.width, viewport.height]);
			(0, react.useEffect)(() => {
				if (typeof window === "undefined") return;
				const onKeyDown = (event) => {
					if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "r") {
						event.preventDefault();
						setMinimized(false);
						setPinned((value) => !value);
					} else if (event.key === "Escape") setPinned(false);
				};
				window.addEventListener("keydown", onKeyDown);
				return () => window.removeEventListener("keydown", onKeyDown);
			}, []);
			/**
			* Start a pointer drag.
			*
			* A press only becomes a drag after `RAIL_DRAG_THRESHOLD` pixels, so every
			* chip/button inside the rail still behaves as a normal click; once the drag
			* ends the rail snaps to the nearest edge and the trailing click is eaten.
			*/
			const startDrag = (event) => {
				if (event.button !== 0 || typeof window === "undefined") return;
				dragSession.startX = event.clientX;
				dragSession.startY = event.clientY;
				dragSession.pointerId = event.pointerId;
				dragSession.moved = false;
				const onMove = (moveEvent) => {
					if (moveEvent.pointerId !== dragSession.pointerId) return;
					const dx = moveEvent.clientX - dragSession.startX;
					const dy = moveEvent.clientY - dragSession.startY;
					if (!dragSession.moved && Math.hypot(dx, dy) < RAIL_DRAG_THRESHOLD) return;
					dragSession.moved = true;
					setDrag({
						x: moveEvent.clientX - 22,
						y: moveEvent.clientY - 22
					});
				};
				const finish = (upEvent) => {
					if (upEvent.pointerId !== dragSession.pointerId) return;
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", finish);
					window.removeEventListener("pointercancel", finish);
					dragSession.pointerId = void 0;
					if (!dragSession.moved) return;
					dragSession.suppressClick = true;
					setDrag(null);
					const snapped = snapRailPlacement({
						x: upEvent.clientX,
						y: upEvent.clientY
					}, {
						width: window.innerWidth,
						height: window.innerHeight
					});
					setPlacement(snapped);
					setUserDocked(true);
					storePlacement(snapped);
				};
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", finish);
				window.addEventListener("pointercancel", finish);
			};
			const suppressDraggedClick = (event) => {
				if (!dragSession.suppressClick) return;
				dragSession.suppressClick = false;
				event.stopPropagation();
				event.preventDefault();
			};
			const views = state.order.map((targetId) => state.connections[targetId]).filter((view) => view !== void 0);
			(0, react.useEffect)(() => {
				if (views.length <= 1) setMinimized(false);
			}, [views.length]);
			const railStyle = drag !== null ? {
				left: drag.x,
				top: drag.y
			} : railBoxStyle(placement, expanded, views.length, viewport, minimized);
			const toggleStyle = drag === null ? railToggleStyle(placement, expanded, minimized, views.length, viewport) : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [toggleStyle !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "dsh-rw-rail-toggle",
				style: toggleStyle,
				"data-testid": "dsh-rw-rail-toggle",
				title: t("rail.collapseList"),
				"aria-label": t("rail.collapseList"),
				onClick: () => {
					setMinimized(true);
				},
				children: placement.dock === "top" || placement.dock === "bottom" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { size: 12 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 12 })
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-rw-rail",
				style: railStyle,
				"data-expanded": expanded ? "true" : void 0,
				"data-portal": portalActive ? "true" : void 0,
				"data-pinned": pinned ? "true" : void 0,
				"data-dock": placement.dock,
				"data-dragging": drag !== null ? "true" : void 0,
				"data-user-docked": userDocked ? "true" : void 0,
				"data-minimized": minimized ? "true" : void 0,
				role: "navigation",
				"aria-label": t("rail.aria"),
				title: t("rail.dragHint"),
				onPointerDown: startDrag,
				onClickCapture: suppressDraggedClick,
				onMouseEnter: () => {
					if (!minimized) setHovered(true);
				},
				onMouseLeave: () => {
					setHovered(false);
				},
				onFocus: () => {
					if (!minimized) setHovered(true);
				},
				onBlur: (event) => {
					const current = event.currentTarget;
					const next = event.relatedTarget;
					if (current === null || !current.contains(next)) setHovered(false);
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-rw-rail-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-rw-rail-title",
							children: t("rail.title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsh-rw-rail-head-actions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-rw-rail-icon",
								title: t("remote.refresh"),
								"aria-label": t("remote.refresh"),
								disabled: state.loading,
								onClick: () => {
									refreshAllRemote();
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 12 })
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-rw-rail-icon",
								title: t("list.newConnection"),
								"aria-label": t("list.newConnection"),
								onClick: openConnectDialog,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 12 })
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-rw-rail-list",
						children: minimized ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "dsh-rw-rail-minimized",
							"data-testid": "dsh-rw-rail-minimized",
							title: t("rail.expandList", { count: views.length }),
							"aria-label": t("rail.expandList", { count: views.length }),
							onClick: () => {
								setMinimized(false);
							},
							children: ["+", views.length]
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [views.map((view) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TargetChip, {
							view,
							active: active?.targetId === view.target.id,
							pinned
						}, view.target.id)), views.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "dsh-rw-rail-empty",
							onClick: openConnectDialog,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-rw-rail-glyph",
								"aria-hidden": "true",
								children: "+"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsh-rw-rail-label",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-rw-rail-name",
									children: t("rail.empty")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-rw-rail-meta",
									children: t("rail.empty.hint")
								})]
							})]
						})] })
					}),
					state.loading && !state.loaded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-rw-rail-status",
						children: t("common.loading")
					}),
					state.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsh-rw-rail-status",
						onClick: () => {
							loadRemoteState();
						},
						children: t("rail.loadFailed")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RemoteDialogs, {}),
					state.notice !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoticeToastHost, {
						notice: state.notice,
						onDismiss: dismissRemoteNotice
					})
				]
			})] });
		}
		/**
		* Mount the rail into a body-level host.
		*
		* The shell sidebar is hidden while the official UI owns navigation, so the
		* rail cannot live inside the sidebar; a fixed host keeps it available in both
		* states (portal active or not) and survives sidebar re-renders.
		* @returns a disposer that unmounts the React root and removes the host.
		*/
		function mountTargetRail() {
			if (typeof document === "undefined" || document.body === null) return void 0;
			let disposed = false;
			document.querySelector(`[${TARGET_RAIL_ATTR}]`)?.remove();
			const container = document.createElement("div");
			container.setAttribute(TARGET_RAIL_ATTR, "");
			container.className = "dsh-rw-rail-host";
			const root = (0, react_dom_client.createRoot)(container);
			root.render(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TargetRail, {}));
			document.body.appendChild(container);
			return () => {
				if (disposed) return;
				disposed = true;
				root.unmount();
				container.remove();
			};
		}
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

/* Trailing action buttons surface on hover with bare 16px glyphs. */
.dsh-rwv-rows-rowActions {
  flex: none;
  display: none;
  align-items: center;
  gap: 15px;
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
		//#region src/client/vendor/official-ui/model-css.ts
		const MODEL_SELECT_CSS = "._7KE1Ra_root{min-width:0;position:relative}._7KE1Ra_trigger{border-radius:var(--dsw-radius-sm);min-width:0;max-width:min(360px,45cqw);height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:400;line-height:20px;display:flex}._7KE1Ra_trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}._7KE1Ra_trigger:focus-visible:not([data-selection-focus]){box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}._7KE1Ra_trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}._7KE1Ra_triggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}._7KE1Ra_triggerEffort{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-caption);flex-shrink:1000;overflow:hidden}._7KE1Ra_triggerIcon{display:var(--dsh-composer-model-icon-display,none);flex:none}._7KE1Ra_triggerLabel,._7KE1Ra_triggerEffort{display:var(--dsh-composer-model-text-display,block)}._7KE1Ra_chevron{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s}._7KE1Ra_chevronOpen{transform:rotate(180deg)}._7KE1Ra_menu{z-index:1100;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:max-content;min-width:min(240px,100vw - 32px);max-width:min(420px,100vw - 32px);max-height:min(360px,100vh - 96px);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border:0;flex-direction:column;padding:4px;display:flex;position:fixed;overflow:hidden}._7KE1Ra_status,._7KE1Ra_empty{color:var(--dsw-alias-label-tertiary);padding:8px;font-size:12px;line-height:18px}._7KE1Ra_error,._7KE1Ra_warning{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:3px;padding:6px 7px;font-size:11px;line-height:16px;display:flex}._7KE1Ra_warning{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label)}._7KE1Ra_retry{color:inherit;font:inherit;cursor:pointer;background:0 0;border:none;flex:none;padding:0;font-weight:600}._7KE1Ra_searchRow{flex-shrink:0;margin:2px 0 3px;position:relative}._7KE1Ra_searchRow ._7KE1Ra_search{border-radius:var(--dsw-radius-md);background:0 0;border:0 solid #0000;height:auto;padding:5px 7px;display:flex}._7KE1Ra_searchRow ._7KE1Ra_searchWithQuery{padding-right:34px}._7KE1Ra_searchClear{corner-shape:round;width:24px;height:24px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:50%;justify-content:center;align-items:center;padding:0;display:inline-flex;position:absolute;top:50%;right:4px;transform:translateY(-50%)}._7KE1Ra_searchClear:hover,._7KE1Ra_searchClear:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}._7KE1Ra_searchRow ._7KE1Ra_search:focus-within{border-color:#0000}._7KE1Ra_searchRow ._7KE1Ra_search input{padding:0;font-size:12px;line-height:normal}._7KE1Ra_searchRow ._7KE1Ra_search input::placeholder{color:var(--dsw-alias-label-caption)}._7KE1Ra_groups{min-height:0;overflow-y:auto}._7KE1Ra_option{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:auto;min-width:100%;min-height:34px;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:6px;padding:5px 7px;display:flex}._7KE1Ra_option:not(._7KE1Ra_modelOption):hover:not(:disabled),._7KE1Ra_option:focus-visible,._7KE1Ra_optionActive:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}._7KE1Ra_selected{background:0 0}._7KE1Ra_option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}._7KE1Ra_optionCopy{flex-direction:column;flex:1;min-width:0;display:flex}._7KE1Ra_modelName{color:inherit;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:400;line-height:18px;overflow:hidden}._7KE1Ra_check{color:var(--dsw-alias-label-primary);flex:0 0 14px;place-items:center;display:grid}._7KE1Ra_check svg{width:14px;height:14px}._7KE1Ra_cell{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:auto;min-width:100%;height:34px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;background:0 0;border:none;outline:none;align-items:center;gap:6px;padding:0 8px;font-size:13px;line-height:20px;display:flex}._7KE1Ra_cell:hover,._7KE1Ra_cell:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}._7KE1Ra_cellLabel{white-space:nowrap;flex:none}._7KE1Ra_cellValue{text-overflow:ellipsis;white-space:nowrap;text-align:right;min-width:0;color:var(--dsw-alias-label-tertiary);flex:auto;overflow:hidden}._7KE1Ra_cellChevron{width:12px;height:12px;color:var(--dsw-alias-menu-icon);flex:none}";
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

/* The official Conversation/Chat CSS modules vendored from the installed DSH
   release. Class selectors are prefixed; everything else is upstream. */
${OFFICIAL_UI_STYLES}
${OFFICIAL_UI_STYLES.replace(/\.dsh-rwv-input-([A-Za-z0-9_-]+)/gu, ".uV2eYG_$1")}

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

.dsh-rw-runtime-choices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.dsh-rw-connect-plan {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 20px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-connect-plan li::marker {
  color: var(--dsw-alias-label-caption);
}

.dsh-rw-connect-summary {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-rw-connect-summary-row {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  min-width: 0;
  font-size: 12px;
  line-height: 18px;
}

.dsh-rw-connect-summary-row dt {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-connect-summary-row dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  text-align: right;
  color: var(--dsw-alias-label-primary);
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

.dsh-rw-progress-row[data-progress="skipped"] .dsh-rw-progress-status {
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-progress-message {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  word-break: break-word;
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

/* While connecting, the connect control itself becomes a spinner. The globe
   stays still: it reports the link state, the button reports the attempt. */
.dsh-rw-conn[data-connect="connecting"] .dsh-rwv-rows-rowActions {
  opacity: 1;
  pointer-events: none;
}

.dsh-rw-conn[data-connect="connecting"] .dsh-rwv-rows-rowActions > button:last-child::before {
  content: '';
  width: 13px;
  height: 13px;
  flex: none;
  background: transparent;
  -webkit-mask: none;
  mask: none;
  border: 1.5px solid var(--dsw-alias-border-l2);
  border-top-color: var(--dsw-alias-label-secondary);
  border-radius: 50%;
  animation: dsh-rw-conn-spin 0.8s linear infinite;
}

/* A disconnected/failed row still needs its ⋮ menu (delete/refresh/mode); the
   connect control stays available beside it. */
.dsh-rw-conn[data-state="stopped"] .dsh-rwv-rows-rowActions > *:first-child,
.dsh-rw-conn[data-state="unknown"] .dsh-rwv-rows-rowActions > *:first-child,
.dsh-rw-conn[data-state="failed"] .dsh-rwv-rows-rowActions > *:first-child {
  display: inline-flex;
}

/* With the menu visible, keep the failure warning left of the whole action
   group rather than on top of the ⋮ button. */
.dsh-rw-conn[data-state="failed"] .dsh-rw-conn-status {
  inset-inline-end: 56px;
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

/* The connect attempt reports **on its own row**: a spinner while it runs, a
   warning glyph whose tooltip is the reason once it failed. Both ride in the
   free slot immediately left of the 连接 seat (8px row padding + 16px button +
   8px gap = 32px from the row's inline end); nothing is added to the row's
   layout, only one glyph's worth of padding on the title cell so a long label
   cannot run underneath it. */
.dsh-rw-conn {
  position: relative;
}
.dsh-rw-conn-status {
  position: absolute;
  inset-inline-end: 32px;
  top: 50%;
  translate: 0 -50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  z-index: 1;
}
.dsh-rw-conn[data-connect] .dsh-rwv-rows-projectText {
  padding-inline-end: 20px;
}
.dsh-rw-conn-spinner {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 1.5px solid var(--dsw-alias-border-l2);
  border-top-color: var(--dsw-alias-label-secondary);
  animation: dsh-rw-conn-spin 0.8s linear infinite;
}
.dsh-rw-conn-warning {
  display: inline-flex;
  align-items: center;
  color: var(--dsw-alias-state-error-primary);
  cursor: help;
}
/* A spinner already says "wait": the 连接 seat behind it must not invite a
   second click that the pending guard would swallow. */
.dsh-rw-conn[data-connect="connecting"] .dsh-rwv-rows-rowActions {
  opacity: 0.45;
  pointer-events: none;
}
.dsh-rw-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
@keyframes dsh-rw-conn-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-rw-conn-spinner {
    animation-duration: 2.4s;
  }
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

/* --------------------------------------------- add-workspace (browse only) */

/* One tab since P0: the server list is what the tree renders, so the dialog is
   just the directory browser in a scrolling box. The per-row picker styles that
   the old "registered remotely" tab needed are gone with that tab. */
.dsh-rw-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 120px;
  max-height: 52vh;
  overflow: auto;
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

/* Exactly the shell's own section header metrics, measured from the deployed
   WorkspaceBrowser stylesheet (.sectionHeader / .sectionLabel): 36px row,
   a 4px inline start, a 20px line box, and the sidebar's inherited 14px base
   font in the tertiary tone at normal weight. Visually the two section titles
   (远程工作区 / 工作区) have to read as peers — same indent, size and colour. */
.dsh-rw-side-head {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 36px;
  /* 4px matches the shell's section label; 8px on the inline end keeps the row
     controls where the official header's actions sit (its root adds 12px of
     inline-end padding and the header pulls 4px back). */
  padding: 0 8px 0 4px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-rw-side-title {
  flex: 1 1 auto;
  /* Inherit the sidebar's 14px base, exactly like the shell's section label
     (it declares no font-size of its own). */
  font-size: inherit;
  font-weight: 400;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
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

/* Fixed execution-world chip shown in place of the official agent-preset
   picker while a remote draft is open. It is status, not a mode menu: the
   target is a property of the workspace, and the host guard rejects any
   other preset for the same stub. */
.dsh-rw-remote-preset {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border);
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
}
.dsh-rw-remote-preset-dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--dsw-alias-state-success-primary);
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

/* -------------------------------------- v2 native server conversation area */

/* Layout mirrors the official conversation: one full-height column with a
   compact header, a centered reading column and a bottom composer. Colors and
   spacing use the shell's design tokens so it reads as the same product. */
.dsh-rw-session {
  container-type: inline-size;
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  /* Official conversation geometry: 64% of the column, clamped 680-920px. */
  --dsh-conversation-column-width: 100%;
  --dsh-chat-content-width: clamp(680px, calc(var(--dsh-conversation-column-width) * 0.64), 920px);
  --dsh-composer-card-max-width: calc(var(--dsh-chat-content-width) + 32px);
  --dsh-composer-side-clearance: 16px;
  --dsh-composer-dock-inset: 8px;
  --dsh-composer-text-max-height: 336px;
}

.dsh-rw-session-hero { overflow: hidden; }

.dsh-rw-session-hero-center {
  --dsh-chat-content-width: clamp(680px, calc(100cqw * 0.64), 920px);
  --dsh-composer-card-max-width: calc(var(--dsh-chat-content-width) + 32px);
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  width: 100%;
  padding: 24px 0 32px;
  overflow-y: auto;
}

.dsh-rw-session .dsh-rw-session-hero-center > .dsh-rwv-conv-composerStack {
  width: clamp(712px, calc(64cqw + 64px), 952px) !important;
  min-width: 0 !important;
  max-width: 100% !important;
  margin: 0 auto;
  transform: translateX(-3.5px);
}

.dsh-rw-session .dsh-rwv-hero-root {
  padding-left: 0 !important;
  padding-right: 0 !important;
}

.dsh-rw-session .dsh-rwv-official-composer .uV2eYG_root {
  padding-left: 0 !important;
  padding-right: 0 !important;
}

.dsh-rw-session-hero-center .dsh-rwv-conv-heroWorkspaceRow {
  align-items: center;
}

.dsh-rw-session-hero-center button:disabled {
  cursor: default;
  opacity: 0.55;
}


/* Official InputBar slots: the permission and model triggers live in separate
 * CSS modules on the server; mirror their compact official geometry here. */
.dsh-rw-session-dock :where(.wXeviG_trigger, .cl2Rlq_trigger) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}

.dsh-rw-session-dock :where(.wXeviG_trigger, .cl2Rlq_trigger):hover {
  background: var(--dsw-alias-bg-l2);
  color: var(--dsw-alias-label-primary);
}

.dsh-rw-session-dock :where(.wXeviG_triggerIcon, .cl2Rlq_triggerIcon, .wXeviG_chevron, .cl2Rlq_chevron) {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-session-dock .wXeviG_triggerLabel,
.dsh-rw-session-dock .cl2Rlq_triggerLabel {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  color: var(--dsw-alias-label-secondary);
}

.dsh-rw-session-dock .cl2Rlq_triggerLabel > span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.dsh-rw-session-dock .cl2Rlq_triggerEffort {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
}

.dsh-rw-session-dock .cl2Rlq_root,
.dsh-rw-session-dock ._root_4ub78_1 {
  display: inline-flex;
  min-width: 0;
}

.dsh-rw-session-dock .dsh-rwv-input-standardControls {
  gap: 4px;
}
.dsh-rw-session-status {
  display: inline-flex;
  align-items: center;
  padding: 0 4px;
}

.dsh-rw-trace {
  width: min(calc(100% - 48px), 920px);
  margin: 0 auto;
  padding: 18px 0 40px;
}

.dsh-rw-trace-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 12px;
  padding: 9px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
  font-size: 13px;
  line-height: 1.6;
}

.dsh-rw-trace-label {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.dsh-rw-trace-text {
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.dsh-rw-trace-row[data-kind='error'] .dsh-rw-trace-text {
  color: var(--dsw-alias-state-error-primary);
}

.dsh-rw-session-dock {
  --dsh-chat-content-width: clamp(680px, calc(100cqw * 0.64), 920px);
  --dsh-composer-card-max-width: calc(var(--dsh-chat-content-width) + 32px);
  flex: none;
  width: 100%;
  padding: 8px 0 14px;
  background: linear-gradient(to bottom, transparent 0, var(--dsw-alias-bg-base) 14px);
  transform: translateX(-3.5px);
}

.dsh-rw-session-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 46px;
  padding: 0 18px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}

.dsh-rw-session-head-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
}

.dsh-rw-session-head-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
}

.dsh-rw-session-head-route {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}

.dsh-rw-session-head-executor {
  flex: none;
  padding: 1px 8px;
  border-radius: 999px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
}

.dsh-rw-session-head-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}

.dsh-rw-session-head-status[data-status="running"] { color: var(--dsw-alias-state-success-primary); }
.dsh-rw-session-head-status[data-status="error"] { color: var(--dsw-alias-state-error-primary); }
.dsh-rw-session-head-menu-wrap { position: relative; display: inline-flex; }

.dsh-rw-session-head-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  min-width: 168px;
  padding: 4px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md, 10px);
  background: var(--dsw-alias-bg-base);
  box-shadow: var(--dsw-shadow-popover, 0 8px 24px rgba(15, 17, 21, .12));
}

.dsh-rw-session-head-menu button {
  display: flex;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.dsh-rw-session-head-menu button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-rw-session-head-reconnect { color: var(--dsw-alias-state-warning-primary, var(--dsw-alias-label-secondary)); }

.dsh-rw-session-banner {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 12px 0;
  padding: 6px 10px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}

.dsh-rw-session-banner code {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}

.dsh-rw-session-banner-error {
  color: var(--dsw-alias-state-error-primary);
  border: 0.5px solid var(--dsw-alias-state-error-primary);
}

.dsh-rw-session-banner-approval {
  color: var(--dsw-alias-state-warning-primary, var(--dsw-alias-label-primary));
}

.dsh-rw-session-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.dsh-rw-session-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: var(--dsh-chat-content-width);
  max-width: 920px;
  margin: 0 auto;
  padding: 18px 0 24px;
}

.dsh-rw-session-more {
  display: flex;
  justify-content: center;
  padding: 4px 0 10px;
}

.dsh-rw-session-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 64px 16px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
  text-align: center;
}

.dsh-rw-session-empty p { margin: 0; }

.dsh-rw-session-row {
  display: flex;
  width: 100%;
  min-width: 0;
}

.dsh-rw-session-row[data-role="user"] {
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  padding: 10px 0 4px;
}

.dsh-rw-session-user {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  max-width: min(calc(var(--dsh-chat-content-width, 748px) * 0.702), 82%);
  padding: 10px 16px;
  border-radius: var(--dsw-radius-xl, 20px);
  background: var(--dsw-specific-bubble);
  font-size: var(--dsh-content-font-size, 14px);
  line-height: calc(22px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-label-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.dsh-rw-session-user p { margin: 0; }
.dsh-rw-session-user p + p { margin-top: 8px; }

.dsh-rw-session-pending { padding-top: 5px; flex: none; }

.dsh-rw-session-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  opacity: 0;
  transition: opacity 80ms ease;
}

.dsh-rw-session-row:hover .dsh-rw-session-actions,
.dsh-rw-session-row:focus-within .dsh-rw-session-actions { opacity: 1; }

@media (hover: none) {
  .dsh-rw-session-actions { opacity: 1; }
}

.dsh-rw-session-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 6px;
  border: none;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

.dsh-rw-session-action svg { width: 15px; height: 15px; }
.dsh-rw-session-action:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}

.dsh-rw-session-row[data-role="assistant"] { padding: 6px 0; }

.dsh-rw-session-assistant {
  width: 100%;
  min-width: 0;
  font-size: 14px;
  line-height: 22px;
  overflow-wrap: anywhere;
}

.dsh-rw-session-reasoning { width: 100%; }

.dsh-rw-session-reasoning-head {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}

.dsh-rw-session-reasoning-toggle { display: inline-flex; }

.dsh-rw-session-reasoning-body {
  margin: 2px 0 6px 16px;
  padding-left: 10px;
  border-left: 2px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
}

.dsh-rw-session-turn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 8px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  line-height: 14px;
}

.dsh-rw-session-turn[data-phase="start"] { border-top: 0.5px solid var(--dsw-alias-border-l3); margin-top: 10px; }
.dsh-rw-session-turn[data-phase="end"] { margin: 6px 0 8px; }

.dsh-rw-session-running {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0 2px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.dsh-rw-session-error-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-md);
  border: 0.5px solid var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-bg-layer-1);
  font-size: 12px;
  line-height: 18px;
}

.dsh-rw-session-error-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
.dsh-rw-session-error-text code { color: var(--dsw-alias-label-tertiary); font-size: 10px; }

/* Tool cards */
.dsh-rw-session-tool {
  width: 100%;
  margin: 2px 0;
}

/* The official Code/Json/Terminal/Read/Search/Diff blocks draw their own card;
   this shell only supplies the status line, so it must not double the border. */
.dsh-rw-session-tool-body {
  width: 100%;
  margin-top: 2px;
}

.dsh-rw-session-tool-body > * { width: 100%; }

.dsh-rw-session-tool-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
  text-align: left;
  cursor: pointer;
}

.dsh-rw-session-tool-toggle,
.dsh-rw-session-tool-icon { display: inline-flex; flex: none; color: var(--dsw-alias-label-tertiary); }
.dsh-rw-session-tool[data-status="error"] .dsh-rw-session-tool-icon { color: var(--dsw-alias-state-error-primary); }
.dsh-rw-session-tool-kind { flex: none; }
.dsh-rw-session-tool-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); font-size: 11px; }
.dsh-rw-session-tool-status { margin-left: auto; flex: none; color: var(--dsw-alias-label-tertiary); }
.dsh-rw-session-tool-note { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 10px; }

.dsh-rw-session-tool-code {
  margin: 0;
  max-height: 260px;
  overflow: auto;
  padding: 6px 10px 8px;
  border-top: 0.5px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-secondary);
  font-family: var(--dsw-font-family-mono, ui-monospace, monospace);
  font-size: 11px;
  line-height: 16px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* Approval */
.dsh-rw-session-approval {
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-md);
  border: 0.5px solid var(--dsw-alias-state-warning-primary, var(--dsw-alias-border-l3));
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-rw-session-approval[data-status="denied"],
.dsh-rw-session-approval[data-status="expired"] { border-color: var(--dsw-alias-border-l3); }

.dsh-rw-session-approval-head { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; line-height: 18px; }
.dsh-rw-session-approval-icon { display: inline-flex; flex: none; color: var(--dsw-alias-state-warning-primary, var(--dsw-alias-label-secondary)); }
.dsh-rw-session-approval[data-status="allowed"] .dsh-rw-session-approval-icon { color: var(--dsw-alias-state-success-primary); }
.dsh-rw-session-approval-tool { color: var(--dsw-alias-label-primary); font-size: 11px; }
.dsh-rw-session-approval-status { margin-left: auto; flex: none; color: var(--dsw-alias-label-tertiary); font-size: 10px; }
.dsh-rw-session-approval-reason { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dsh-rw-session-approval-actions { display: flex; gap: 6px; padding-top: 8px; }

/* Composer */
.dsh-rw-session-composer {
  flex: none;
  padding: 8px 24px 14px;
  background: var(--dsw-alias-bg-base);
}

.dsh-rw-session-composer-box {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  width: min(100%, 820px);
  margin: 0 auto;
  padding: 8px 8px 8px 12px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-rw-session-composer-box:focus-within { border-color: var(--dsw-alias-border-l4); }
.dsh-rw-session-composer[data-running] .dsh-rw-session-composer-box { border-color: var(--dsw-alias-state-success-primary); }

.dsh-rw-session-composer-input {
  flex: 1 1 auto;
  min-width: 0;
  max-height: 220px;
  padding: 2px 0;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  overflow-y: auto;
}

.dsh-rw-session-composer-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

.dsh-rw-session-composer-attach {
  padding: 2px 4px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary));
  font-size: 11px;
  line-height: 16px;
  cursor: not-allowed;
}

.dsh-rw-session-composer-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  width: min(100%, 820px);
  margin: 4px auto 0;
  color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary));
  font-size: 10px;
  line-height: 14px;
}

.dsh-rw-session-jump {
  position: absolute;
  left: 50%;
  bottom: 132px;
  translate: -50% 0;
  z-index: 2;
  padding: 3px 10px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
  box-shadow: var(--dsw-shadow-sm, 0 2px 8px rgb(0 0 0 / 8%));
}

.dsh-rw-session-error-text {
  width: min(100%, 820px);
  margin: 4px auto 0;
  color: var(--dsw-alias-state-error-primary);
  font-size: 11px;
  line-height: 16px;
}

.dsh-rw-session-hidden-status { display: none; }

.dsh-rw-session-interrupted {
  margin: 4px 0 0;
  color: var(--dsw-alias-state-warning-primary, var(--dsw-alias-label-tertiary));
  font-size: 11px;
  line-height: 16px;
}

.dsh-rw-session-unknown {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
  overflow-wrap: anywhere;
}

.dsh-rw-session-unknown code { color: var(--dsw-alias-label-tertiary); font-size: 10px; }

.dsh-rw-session-plain { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }

/* --------------------------------------------------- v1 remote tree chrome */

.dsh-rw-search-row {
  display: flex;
  align-items: center;
  gap: 2px;
  margin: 2px 8px 4px;
}

.dsh-rw-search {
  box-sizing: border-box;
  flex: 1 1 auto;
  min-width: 0;
  width: auto;
  margin: 0;
  height: 26px;
  padding: 0 8px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 18px;
  outline: none;
}

.dsh-rw-search:focus {
  border-color: var(--dsw-alias-border-l4);
}

.dsh-rw-conn-mode-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin: 0 8px 4px 32px;
  padding: 4px 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}

.dsh-rw-conn-mode-label {
  color: var(--dsw-alias-label-secondary);
}

.dsh-rw-conn-mode-credentials {
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-remote-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 2px 8px 4px 32px;
  padding: 4px 6px;
  border-radius: var(--dsw-radius-sm);
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-1);
  font-size: 11px;
  line-height: 16px;
}

.dsh-rw-banner-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-link);
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
}

.dsh-rw-banner-link:hover {
  text-decoration: underline;
}

.dsh-rw-refresh-row {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: auto;
  margin: 2px 8px 4px 32px;
  border: 0;
  background: transparent;
  cursor: pointer;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}

.dsh-rw-refresh-row:hover {
  color: var(--dsw-alias-label-secondary);
}

/* Workspace drop target (official ProjectRowItem only supplies drag start/end;
   the enclosing group owns hit testing, as in the shell's own browser). */
.dsh-rw-ws-group {
  position: relative;
}

.dsh-rw-ws-group[data-drop-active="before"]::before,
.dsh-rw-ws-group[data-drop-active="after"]::after {
  content: '';
  z-index: 1;
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  border-radius: 1px;
  background: var(--dsw-alias-state-business-primary);
  pointer-events: none;
}

.dsh-rw-ws-group[data-drop-active="before"]::before { top: -1px; }
.dsh-rw-ws-group[data-drop-active="after"]::after { bottom: -1px; }

/* Add-workspace dialog */
.dsh-rw-addworkspace-modal {
  width: min(900px, calc(100vw - 48px)) !important;
  max-width: min(900px, calc(100vw - 48px)) !important;
  height: min(820px, calc(100vh - 48px)) !important;
  max-height: min(820px, calc(100vh - 48px)) !important;
  display: flex;
  flex-direction: column;
}

.dsh-rw-addworkspace-content {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
}

.dsh-rw-addworkspace-content > :last-child {
  min-height: 0;
  flex: 1 1 auto;
  overflow: auto;
}

.dsh-rw-addworkspace-modal > :last-child {
  flex: none;
}

.dsh-rw-mkdir {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dsh-rw-mkdir > input {
  flex: 1 1 auto;
  min-width: 0;
}

.dsh-rw-mkdir > button {
  flex: 0 0 auto;
  white-space: nowrap;
  min-width: max-content;
}

.dsh-rw-addworkspace-modal .dsh-rw-add-workspace {
  min-height: 0;
  overflow: visible;
}

.dsh-rw-add-workspace {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 240px;
}

.dsh-rw-add-path {
  font-family: var(--dsw-font-family-mono, ui-monospace, monospace);
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  word-break: break-all;
}

.dsh-rw-dir-list {
  display: flex;
  flex-direction: column;
  height: min(300px, 34vh);
  flex: none;
  overflow-y: auto;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
}

.dsh-rw-dir-list > .dsh-rw-hint {
  margin: 0;
  padding: 8px 10px;
}

.dsh-rw-dir-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
}

.dsh-rw-dir-row:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-rw-dir-row:disabled {
  color: var(--dsw-alias-label-caption);
  cursor: default;
}

.dsh-rw-dir-name {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-rw-dir-kind {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
}

/* Deployment confirmation strip under an expanded connection. */
.dsh-rw-deploy-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  margin: 0 8px 4px 32px;
  padding: 4px 6px;
  border-radius: var(--dsw-radius-sm);
  border: 0.5px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
}

.dsh-rw-deploy-title {
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-deploy-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* Connection overview cards (the 远程连接 main page) */
.dsh-rw-card-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dsh-rw-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-rw-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.dsh-rw-card-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
}

.dsh-rw-card-phase,
.dsh-rw-card-mode {
  flex: none;
  padding: 1px 8px;
  border-radius: 999px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
}

.dsh-rw-card[data-phase="ready"] .dsh-rw-card-phase {
  color: var(--dsw-alias-state-success-primary);
  border-color: var(--dsw-alias-state-success-primary);
}

.dsh-rw-card[data-phase="failed"] .dsh-rw-card-phase {
  color: var(--dsw-alias-state-error-primary);
  border-color: var(--dsw-alias-state-error-primary);
}

.dsh-rw-card-endpoint {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--dsw-font-family-mono, ui-monospace, monospace);
  font-size: 11px;
  line-height: 16px;
  word-break: break-all;
}

.dsh-rw-card-facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 10px;
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
}

.dsh-rw-card-facts dt {
  color: var(--dsw-alias-label-tertiary);
}

.dsh-rw-card-facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.dsh-rw-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* Minimal v1 connect dialog */
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

/* v3 model source: inside the advanced disclosure, below DSH_HOME. */
.dsh-rw-local-model {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--dsw-alias-border-secondary, rgb(127 127 127 / 18%));
}

/* Source → grouped provider/model checklist (auto discovery). */
.dsh-rw-local-source,
.dsh-rw-local-auto {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dsh-rw-local-models-row {
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.dsh-rw-local-catalog {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.dsh-rw-local-provider {
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-rw-local-provider-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.dsh-rw-local-provider-name {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-rw-local-provider-id {
  min-width: 0;
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-rw-local-provider-count {
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-caption);
  font-variant-numeric: tabular-nums;
}

.dsh-rw-local-provider-actions {
  flex: none;
  gap: 2px;
  margin-left: auto;
}

.dsh-rw-local-model-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 6px;
}

.dsh-rw-local-model-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 2px;
  border-radius: var(--dsw-radius-sm);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.dsh-rw-local-model-option:hover {
  background: var(--dsw-alias-bg-secondary, rgb(127 127 127 / 10%));
}

.dsh-rw-local-model-option input[type='checkbox'] {
  flex: none;
  margin: 0;
  accent-color: var(--dsw-alias-brand-primary, #4d6bfe);
}

.dsh-rw-local-model-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-rw-local-model-id {
  min-width: 0;
  margin-left: auto;
  padding-left: 8px;
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Elapsed time next to the primary connect action while submitting. */
.dsh-rw-connect-elapsed {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

.dsh-rw-connect-hostkey {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dsh-rw-connect-hostkey code {
  padding: 8px 10px;
  overflow-wrap: anywhere;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
}

/* Execution-end dialog */
.dsh-rw-mode-dialog,
.dsh-rw-mode-confirm {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  line-height: 20px;
}

.dsh-rw-mode-actions {
  display: flex;
  gap: 8px;
}

.dsh-rw-mode-confirm ul {
  margin: 0;
  padding-left: 18px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}

/* ------------------------------------------------------ target rail (v3) */

/* The official UI owns navigation while the frame is mounted: yield the
   client shell's sidebar and collapse its grid column so the iframe is the
   whole content area. The floating rail lives outside the grid (body-level
   host) and therefore stays reachable in both states. */
html[data-dsh-rw-portal] [data-slot="sidebar"] {
  display: none !important;
}

html[data-dsh-rw-portal] [data-slot="root"] > div > div {
  grid-template-columns: minmax(0, 1fr) !important;
}

/* Body-level host: covers the viewport but never steals input; the rail itself
   is an absolutely positioned child so it can be dragged and docked to any of
   the four screen edges (left/right = vertical column, top/bottom = bar). */
.dsh-rw-rail-host {
  position: fixed;
  inset: 0;
  z-index: 70;
  pointer-events: none;
}

.dsh-rw-rail {
  position: absolute;
  pointer-events: auto;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 44px;
  max-height: calc(100vh - 20px);
  padding: 6px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base)) 94%, transparent);
  box-shadow:
    0 8px 24px rgb(0 0 0 / 18%),
    0 0 0 1px var(--dsw-alias-border-secondary, rgb(127 127 127 / 18%));
  backdrop-filter: blur(8px);
  overflow: hidden;
  /* Expanding/collapsing animates the box on both axes; the snap transition
     reuses the same curve when the rail is dropped on another edge. */
  transition:
    left 200ms cubic-bezier(0.22, 0.8, 0.26, 1),
    top 200ms cubic-bezier(0.22, 0.8, 0.26, 1),
    right 200ms cubic-bezier(0.22, 0.8, 0.26, 1),
    bottom 200ms cubic-bezier(0.22, 0.8, 0.26, 1),
    width 200ms cubic-bezier(0.22, 0.8, 0.26, 1),
    height 200ms cubic-bezier(0.22, 0.8, 0.26, 1),
    border-radius 200ms ease;
  will-change: left, top, width;
}

/* While the user drags, position changes must be immediate. */
.dsh-rw-rail[data-dragging="true"] {
  transition: none;
  cursor: grabbing;
}

.dsh-rw-rail[data-dock="left"]:focus-within,
.dsh-rw-rail[data-dock="right"]:focus-within {
  width: 280px;
}

/* A minimized rail stays a single glyph even when focused. */
.dsh-rw-rail[data-minimized="true"]:focus-within {
  width: 44px;
}

/* Every expanded dock renders the same vertical list; only the collapsed
   strip follows its edge orientation. */
.dsh-rw-rail[data-expanded="true"] {
  width: 280px;
}

/* Collapsed top/bottom docks are horizontal bars: one glyph chip per target. */
.dsh-rw-rail[data-dock="top"]:not([data-expanded="true"]),
.dsh-rw-rail[data-dock="bottom"]:not([data-expanded="true"]) {
  flex-direction: row;
  align-items: stretch;
  height: 44px;
  max-height: 44px;
  padding: 6px;
}

.dsh-rw-rail[data-dock="top"]:not([data-expanded="true"]) .dsh-rw-rail-head,
.dsh-rw-rail[data-dock="bottom"]:not([data-expanded="true"]) .dsh-rw-rail-head {
  flex: none;
  padding: 0 6px 0 0;
  align-items: center;
}

.dsh-rw-rail[data-dock="top"]:not([data-expanded="true"]) .dsh-rw-rail-list,
.dsh-rw-rail[data-dock="bottom"]:not([data-expanded="true"]) .dsh-rw-rail-list {
  flex: none;
  flex-direction: row;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.dsh-rw-rail[data-dock="top"]:not([data-expanded="true"]) .dsh-rw-rail-target,
.dsh-rw-rail[data-dock="bottom"]:not([data-expanded="true"]) .dsh-rw-rail-target,
.dsh-rw-rail[data-dock="top"]:not([data-expanded="true"]) .dsh-rw-rail-empty,
.dsh-rw-rail[data-dock="bottom"]:not([data-expanded="true"]) .dsh-rw-rail-empty {
  flex: none;
  max-width: 200px;
}

.dsh-rw-rail[data-dock="top"]:not([data-expanded="true"]) .dsh-rw-rail-target .dsh-rw-rail-main,
.dsh-rw-rail[data-dock="bottom"]:not([data-expanded="true"]) .dsh-rw-rail-target .dsh-rw-rail-main {
  padding: 4px;
  text-align: left;
}

.dsh-rw-rail[data-dock="top"]:not([data-expanded="true"]) .dsh-rw-rail-status,
.dsh-rw-rail[data-dock="bottom"]:not([data-expanded="true"]) .dsh-rw-rail-status {
  flex: none;
  margin: 0 4px;
  white-space: nowrap;
}

/* Expanded top/bottom docks keep the vertical list anchored to their edge and
   scroll inside the viewport instead of growing past it. */
.dsh-rw-rail[data-dock="top"][data-expanded="true"],
.dsh-rw-rail[data-dock="bottom"][data-expanded="true"] {
  flex-direction: column;
  height: auto;
  overflow-y: auto;
}

@media (prefers-reduced-motion: reduce) {
  .dsh-rw-rail {
    transition: none;
  }
}

.dsh-rw-rail-head {
  display: none;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 2px 4px 6px;
}

.dsh-rw-rail[data-expanded="true"] .dsh-rw-rail-head {
  display: flex;
}

.dsh-rw-rail-title {
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-rw-rail-head-actions {
  display: flex;
  flex: none;
  gap: 2px;
}

.dsh-rw-rail-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

.dsh-rw-rail-icon:hover {
  background: var(--dsw-alias-bg-secondary, rgb(127 127 127 / 8%));
  color: var(--dsw-alias-label-primary);
}

/* Collapsed-state glyph buttons: the collapse toggle and the minimized +N. */
.dsh-rw-rail-toggle,
.dsh-rw-rail-minimized {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  min-width: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  cursor: pointer;
}

/* The fold button lives in the rail host gutter, outside the rail box, so the
   pointer never has to cross the strip (which would expand it) to reach it. */
.dsh-rw-rail-toggle {
  position: absolute;
  z-index: 71;
  pointer-events: auto;
  background: color-mix(in srgb, var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base)) 94%, transparent);
  box-shadow: 0 2px 8px rgb(0 0 0 / 12%);
}

.dsh-rw-rail-minimized {
  background: var(--dsw-alias-bg-secondary, rgb(127 127 127 / 10%));
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}

.dsh-rw-rail-toggle:hover,
.dsh-rw-rail-minimized:hover {
  background: var(--dsw-alias-bg-secondary, rgb(127 127 127 / 10%));
  color: var(--dsw-alias-label-primary);
}

/* A minimized horizontal strip is a single centered glyph. */
.dsh-rw-rail[data-minimized="true"][data-dock="top"],
.dsh-rw-rail[data-minimized="true"][data-dock="bottom"] {
  width: 44px;
}

.dsh-rw-rail[data-minimized="true"][data-dock="top"] .dsh-rw-rail-list,
.dsh-rw-rail[data-minimized="true"][data-dock="bottom"] .dsh-rw-rail-list {
  overflow: hidden;
}

.dsh-rw-rail-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.dsh-rw-rail-target,
.dsh-rw-rail-empty {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  min-width: 0;
  border-radius: 10px;
}

.dsh-rw-rail-main,
.dsh-rw-rail-empty {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 4px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.dsh-rw-rail-main:hover,
.dsh-rw-rail-empty:hover {
  background: var(--dsw-alias-bg-secondary, rgb(127 127 127 / 8%));
}

.dsh-rw-rail-glyph {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-secondary, rgb(127 127 127 / 10%));
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
}

.dsh-rw-rail-target[data-active="true"] .dsh-rw-rail-glyph {
  background: var(--dsw-alias-brand-primary, #4d6bfe);
  color: #fff;
}

.dsh-rw-rail-target[data-phase="failed"] .dsh-rw-rail-glyph,
.dsh-rw-rail-target[data-phase="error"] .dsh-rw-rail-glyph {
  box-shadow: inset 0 0 0 1px var(--dsw-alias-state-error, #e5484d);
}

.dsh-rw-rail-label {
  display: none;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}

.dsh-rw-rail[data-expanded="true"] .dsh-rw-rail-label {
  display: flex;
}

.dsh-rw-rail-name {
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-rw-rail-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-rw-rail-actions {
  display: none;
  flex: none;
  gap: 2px;
}

.dsh-rw-rail[data-expanded="true"] .dsh-rw-rail-actions {
  display: flex;
}

.dsh-rw-rail-action {
  padding: 2px 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
}

.dsh-rw-rail-action:hover {
  background: var(--dsw-alias-bg-secondary, rgb(127 127 127 / 8%));
  color: var(--dsw-alias-label-primary);
}

.dsh-rw-rail-status {
  flex: none;
  margin: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  text-align: left;
  cursor: pointer;
}

.dsh-rw-rail-spinner {
  width: 10px;
  height: 10px;
  border: 2px solid currentcolor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: dsh-rw-spin 800ms linear infinite;
}

@keyframes dsh-rw-spin {
  to { transform: rotate(360deg); }
}

/* ------------------------------------------------ server-mode main area */

/* The iframe covers the whole client window: v3 makes the client the remote
   server's UI. The frame layer sits above the client shell (which keeps its
   own state underneath) and below the floating target rail (z-index 70). */
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



/* Official DisclosureRow shell for tool calls: 24px summary, expanded body below. */
.dsh-rw-tool-sep {
  display: inline-block;
  width: 2px;
  height: 2px;
  margin: 0 8px;
  border-radius: 1px;
  background: var(--dsw-alias-label-caption);
  vertical-align: middle;
}

.dsh-rw-tool-summary {
  display: inline-block;
  max-width: min(72ch, 100%);
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));
  text-overflow: ellipsis;
  vertical-align: bottom;
  white-space: nowrap;
}

.dsh-rw-tool-summary-error { color: var(--dsw-alias-state-error-primary); }

.dsh-rw-tool-body {
  padding: 2px 0 6px 22px;
}


/** Composer attachment chips and command/file menus (rc.3 InputBar shell). */
.dsh-rw-composer-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px 0;
}
.dsh-rw-composer-attachment {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  padding: 3px 6px 3px 4px;
  border: 1px solid var(--vscode-widget-border, rgba(127, 127, 127, .25));
  border-radius: 7px;
  background: var(--vscode-editorWidget-background, rgba(127, 127, 127, .08));
  font-size: 12px;
  line-height: 16px;
}
.dsh-rw-composer-attachment img {
  width: 44px;
  height: 44px;
  border-radius: 4px;
  object-fit: cover;
}
.dsh-rw-composer-file-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: rgba(127, 127, 127, .14);
  font-size: 12px;
}
.dsh-rw-composer-attachment-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-rw-composer-attachment button {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: .65;
  font-size: 14px;
  line-height: 14px;
}
.dsh-rw-composer-menu {
  position: absolute;
  z-index: 40;
  display: flex;
  flex-direction: column;
  min-width: 240px;
  max-width: min(440px, 80vw);
  max-height: 280px;
  overflow: auto;
  margin-bottom: 8px;
  padding: 4px;
  border: 1px solid var(--vscode-widget-border, rgba(127, 127, 127, .25));
  border-radius: 8px;
  background: var(--vscode-editorWidget-background, #252526);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .28);
}
.dsh-rw-composer-menu-slash,
.dsh-rw-composer-menu-at {
  left: 10px;
  bottom: calc(100% - 2px);
}
.dsh-rw-composer-menu-permission,
.dsh-rw-composer-menu-model {
  left: 0;
  bottom: calc(100% + 4px);
}
.dsh-rw-composer-menu-model {
  right: 0;
  left: auto;
}
.dsh-rw-composer-menu > button,
.dsh-rw-composer-menu-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.dsh-rw-composer-menu > button:hover,
.dsh-rw-composer-menu-item:hover {
  background: var(--vscode-list-hoverBackground, rgba(127, 127, 127, .14));
}
.dsh-rw-composer-menu-name {
  font-size: 13px;
  line-height: 17px;
}
.dsh-rw-composer-menu-desc {
  color: var(--vscode-descriptionForeground, rgba(127, 127, 127, .9));
  font-size: 11px;
  line-height: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-rw-composer-model-group {
  padding: 2px 0;
}
.dsh-rw-composer-model-provider {
  padding: 6px 8px 2px;
  color: var(--vscode-descriptionForeground, rgba(127, 127, 127, .9));
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .04em;
  line-height: 14px;
}
.dsh-rw-composer-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.dsh-rw-composer-menu-empty {
  padding: 8px 9px;
  color: var(--vscode-descriptionForeground, rgba(127, 127, 127, .9));
  font-size: 11px;
  line-height: 15px;
}
.dsh-rw-session-dock {
  position: relative;
}
.dsh-rw-session-hero-center {
  position: relative;
}

.dsh-rwv-official-composer {
  position: relative;
  width: min(var(--dsh-composer-card-max-width), calc(100% - 16px));
  margin-inline: auto;
}
.dsh-rwv-official-composer [data-composer-card="true"] {
  width: 100%;
  max-width: var(--dsh-composer-card-max-width);
}
.dsh-rwv-official-composer-loading {
  min-height: 92px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--vscode-descriptionForeground, rgba(127, 127, 127, .9));
  font-size: 12px;
}
.dsh-rwv-official-control {
  position: relative;
  display: inline-flex;
  min-width: 0;
}
.dsh-rwv-official-chip-chevron { flex: none; color: var(--dsw-alias-label-caption); }
.dsh-rwv-official-chip-icon,
.dsh-rwv-official-option-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 16px;
  height: 16px;
}
.dsh-rwv-official-option {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dsh-rwv-official-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 220px;
  height: 28px;
  padding: 0 4px 0 8px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  outline: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.dsh-rwv-official-chip:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-rwv-official-chip:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}
.dsh-rwv-official-chip-icon svg { width: 14px; height: 14px; }
.dsh-rwv-official-popover {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 60;
  width: max-content;
  min-width: 200px;
  max-width: min(360px, 80vw);
  padding: 4px;
  border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  border-radius: 10px;
  background: var(--vscode-menu-background, var(--vscode-editorWidget-background, #fff));
  box-shadow: 0 8px 24px rgba(0, 0, 0, .18);
}
.dsh-rwv-official-popover--above {
  bottom: calc(100% + 8px);
}
.dsh-rwv-official-option {
  display: flex;
  width: 100%;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.dsh-rwv-official-option:hover {
  background: color-mix(in srgb, currentColor 8%, transparent);
}
.dsh-rwv-official-option-name {
  font-weight: 500;
  white-space: nowrap;
}
.dsh-rwv-official-option-desc {
  overflow: hidden;
  color: var(--vscode-descriptionForeground, rgba(127, 127, 127, .9));
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-rwv-official-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 4px 0;
}
.dsh-rwv-official-attachment {
  position: relative;
  display: flex;
  max-width: 180px;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, currentColor 4%, transparent);
  color: var(--vscode-descriptionForeground, rgba(127, 127, 127, .9));
  font-size: 11px;
}
.dsh-rwv-official-attachment img {
  width: 34px;
  height: 34px;
  border-radius: 5px;
  object-fit: cover;
}
.dsh-rwv-official-attachment-remove {
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 14px;
  line-height: 14px;
  cursor: pointer;
}
.dsh-rwv-official-attachment-remove:hover {
  background: color-mix(in srgb, currentColor 10%, transparent);
}
/* Official AgentPresetSeat.module.css (rc.3): the preset chip beside the
   workspace picker. The plugin loads the vendored conversation/hero CSS but
   not the agent-preset module, so these upstream class names were falling back
   to the browser's default button chrome (visible border). */
.m0vb0q_menuAnchor {
  min-width: 54px;
  max-width: 100%;
}
.m0vb0q_seat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: min(100%, 240px);
  min-height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.m0vb0q_seat:not(:disabled):hover,
.m0vb0q_seat[aria-expanded='true'] {
  background: var(--dsw-alias-interactive-bg-hover);
}
.m0vb0q_seat:disabled {
  cursor: default;
  color: var(--dsw-alias-label-quaternary);
}
.m0vb0q_seatIcon { flex: none; color: var(--dsw-alias-label-primary); }
.m0vb0q_seatLabel {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.m0vb0q_chevron { flex: none; color: var(--dsw-alias-label-caption); }
${MODEL_SELECT_CSS}
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
		/** Client services this plugin needs: `slots` only. */
		const inject = ["slots"];
		/**
		* Plugin body: stylesheet, the floating target rail, the P3 state stream and
		* the full-screen official-UI main panel.
		* @param ctx - the client context.
		*/
		function apply(ctx) {
			bindRemoteStoreContext(ctx);
			ctx.effect(() => ensureStyles(), "dsh-remote-workspace: stylesheet");
			ctx.effect(() => mountTargetRail(), "dsh-remote-workspace: target rail");
			loadRemoteState();
			ctx.effect(() => () => {
				disposeRemoteStore();
			}, "dsh-remote-workspace: remote store lifetime");
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