import { RemotePersistence } from "./rsession.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { apply } from "@deepseek-ai/dsh-session-persistence-jsonl";
import { SessionPersistence } from "@deepseek-ai/dsh-session-persistence";
//#region src/preset/world.ts
/** Preset ids are namespaced so a target's world can never collide with a shipped preset. */
const REMOTE_PRESET_PREFIX = "remote:";
/** The preset id that serves one target. */
function remotePresetId(targetId) {
	return `${REMOTE_PRESET_PREFIX}${targetId}`;
}
/**
* Build the preset definition for one target.
* @param target - the stored target record.
* @returns a definition ready for `ctx.agentPresets.register`.
*/
function remotePresetDefinition(target) {
	return {
		id: remotePresetId(target.id),
		name: `Remote: ${target.label}`,
		description: `Execution world on ${target.username}@${target.host}:${target.port}; models and credentials stay local.`,
		order: 90,
		plugins: [{
			id: `remote-world`,
			name: "cordis:group",
			group: true,
			isolate: {
				ssh: true,
				fs: true,
				subprocess: true,
				sandbox: true,
				shell: true
			},
			config: [
				{
					id: "connection",
					name: "dsh-remote-window/connection",
					config: {
						targetId: target.id,
						label: target.label
					}
				},
				{
					id: "fs-ssh",
					name: "@deepseek-ai/dsh-fs-ssh"
				},
				{
					id: "subprocess-ssh",
					name: "@deepseek-ai/dsh-subprocess-ssh"
				},
				{
					id: "sandbox-ssh",
					name: "@deepseek-ai/dsh-sandbox-ssh"
				},
				{
					id: "bash-sandbox",
					name: "@deepseek-ai/dsh-bash-sandbox",
					config: { timeoutMs: 6e4 }
				},
				{
					id: "tool-bash",
					name: "@deepseek-ai/dsh-tool-bash"
				},
				{
					id: "tool-fs",
					name: "@deepseek-ai/dsh-tool-fs"
				},
				{
					id: "tool-fs-search",
					name: "@deepseek-ai/dsh-tool-fs-search",
					config: { sampleOverCapGlobResults: false }
				}
			]
		}]
	};
}
//#endregion
//#region src/session-persistence/routing.ts
/**
* Root-context session persistence routed by session cwd.
*
* This module is provided by the plugin's own `apply()` on the service name the
* bundle's cordis.patch.yml frees by disabling the official JSONL row (a patch
* row cannot swap a row's `name`, and an inserted replacement row was never
* constructed — see AGENTS.md "会话持久层的路由接线"). Routing exists because
* the agent loop resolves `sessionPersistence` on the HOST plane — a
* preset-realm provide never reaches it (measured against dsh 0.2.0-rc.1,
* 2026-10-15) — so the only way a remote-window session can persist to the
* remote server is for the host-level service itself to route.
*
* Routing rule, evaluated per call:
* - `create(header)`: the header cwd of a remote-window session is its
*   private local anchor; a registered anchor routes to that workspace's
*   profile server (P1 `persist/create`). Any other cwd delegates to the
*   embedded official JSONL backend with the same root — local sessions are
*   stored byte-for-byte as before.
* - `open`/`stat`: session ids carry no cwd, so the route comes from the
*   host facade (`persist/locate`) across the targets with live profiles; a
*   miss delegates locally.
* - `list`: local only. Remote sessions are listed by the plugin panel through
*   the server's `session/list`; they must not leak into the shell's global
*   session list.
*
* Remote write ownership is the official backend's own handle lease running on
* the server (one writer per session; a second device's write open rejects
* with the ownership error), so no client-side locking is added.
*
* v1: a remote session's cwd is a plugin-private anchor
* (`<DSH_HOME>/remote-windows/<clientId>/<targetId>/<hash>`), and the
* facade resolves it to the server workspace / `remoteCwd`. The retired
* stdio plane is gone; `list` remains local-only so the server-owned rows never
* leak into the client shell's global session list.
*/
/**
* Resolve the official local session root for the embedded JSONL backend.
*
* The base profile configures its own JSONL row with
* `dshHomePath('sessions')`, so this plugin must resolve the same directory
* (honouring an explicit `DSH_HOME`), not `homedir()/sessions`. The latter is
* `~/sessions`: the official backend then reads an empty list while every real
* log sits under `~/.dsh/sessions`, which looks exactly like "all sessions
* disappeared" to the user.
*
* @param ctx - host context; `dshHomePath` is the app-boot service when mounted.
* @param env - environment used for the fallback, injectable for tests.
* @returns the absolute directory the local backend should read and write.
*/
function localSessionRoot(ctx, env = process.env) {
	const dshHomePath = ctx.get("dshHomePath");
	if (typeof dshHomePath === "function") return dshHomePath("sessions");
	const configured = env["DSH_HOME"]?.trim();
	return join(configured !== void 0 && configured !== "" ? configured : join(homedir(), ".dsh"), "sessions");
}
/**
* A context stub that absorbs a base class' self-registration.
*
* Only the remote façade still needs it: `RemotePersistence` extends the
* official `SessionPersistence`, whose constructor registers the instance under
* `sessionPersistence`, and the routing owns that name. The embedded *local*
* backend no longer needs a stub — it is mounted into an isolated scope instead.
*/
function registrationAbsorbingContext() {
	return {
		reflect: { provide: () => () => {} },
		logger: {
			warn() {},
			info() {},
			error() {},
			debug() {}
		},
		effect: () => () => {},
		on: () => ({ dispose() {} })
	};
}
/**
* One remote session's live-event writer.
*
* Live events are **not** appended one RPC at a time: like the official JSONL
* backend, the routing buffers them per session and sends one batch at the
* official durability barriers (`session/flush`, and the handle's own
* `flush`/`close`). A failed batch is retained verbatim so the next barrier
* retries it instead of silently dropping a turn.
*/
var RemoteLiveWriter = class {
	handle;
	warn;
	onClosed;
	buffer = [];
	chain = Promise.resolve();
	closedFlag = false;
	constructor(handle, warn, onClosed = () => {}) {
		this.handle = handle;
		this.warn = warn;
		this.onClosed = onClosed;
	}
	/** Whether the underlying remote handle is still open. */
	get closed() {
		return this.closedFlag;
	}
	/** The handle the session's owner receives: `close` drains before releasing. */
	wrap() {
		return new DrainedHandle(this.handle, this, false);
	}
	/**
	* A second view of the same live handle.
	*
	* Handed to a *concurrent* write open of the same session (two resumes
	* racing, or the shell opening a session the plugin is already resuming).
	* Asking the server for a second handle would make the official backend
	* refuse the whole session with `already owned by an active write handle`,
	* so the borrower shares; it may flush but must not release the ownership
	* the first owner still holds.
	*/
	borrow() {
		return new DrainedHandle(this.handle, this, true);
	}
	enqueue(event) {
		if (!this.closedFlag) this.buffer.push(event);
	}
	/** Append everything buffered so far, in order. */
	step() {
		this.chain = this.chain.then(async () => {
			if (this.buffer.length === 0) return;
			const batch = this.buffer;
			this.buffer = [];
			try {
				await this.handle.append(batch);
			} catch (error) {
				this.buffer = [...batch, ...this.buffer];
				this.warn(`dsh-remote-window: background write for session "${String(this.handle.id)}" failed (buffered events retained): ${String(error)}`);
			}
		});
		return this.chain;
	}
	drain() {
		return this.step();
	}
	flush() {
		return this.step().then(() => this.handle.flush());
	}
	/** Drain, then release the remote write ownership. Idempotent. */
	close() {
		if (this.closedFlag) return this.chain;
		this.closedFlag = true;
		this.chain = this.step().then(() => this.handle.close(), () => this.handle.close().catch(() => {})).finally(() => {
			this.onClosed();
		});
		return this.chain;
	}
};
/**
* The handle a routed session's owner gets. It exists for one reason: the
* agent loop commits its closing events into the session *synchronously* and
* then closes the handle, relying on close to drain them durably (the official
* backend behaves that way). Buffered live events must therefore be sent
* before the close RPC, including for explicit appends, which must not
* overtake buffered live ones.
*/
var DrainedHandle = class {
	inner;
	writer;
	borrowed;
	constructor(inner, writer, borrowed) {
		this.inner = inner;
		this.writer = writer;
		this.borrowed = borrowed;
	}
	get id() {
		return this.inner.id;
	}
	get header() {
		return this.inner.header;
	}
	get access() {
		return this.inner.access;
	}
	get inheritedEventCount() {
		return this.inner.inheritedEventCount;
	}
	read(offset, length, options) {
		return this.inner.read(offset, length, options);
	}
	async append(events, options) {
		await this.writer.drain();
		await this.inner.append(events, options);
	}
	flush(_options) {
		return this.writer.flush();
	}
	async close() {
		if (this.borrowed) {
			await this.writer.drain();
			return;
		}
		await this.writer.close();
	}
	[Symbol.asyncDispose] = async () => {
		await this.close();
	};
};
const ROUTING_MARKER = Symbol.for("dsh-remote-window.routing-persistence");
/**
* Scope label for the embedded local backend's service registration.
*
* `isolate()` joins every call carrying the same label, so all routing
* instances in one process share one local backend instead of racing to register
* a second one.
*/
const LOCAL_SCOPE = Symbol.for("dsh-remote-window.local-persistence");
var RoutingSessionPersistence = class extends SessionPersistence {
	injectedRemote;
	/**
	* Deliberately NO `static inject = ['remoteWorkspaces']`: the row provides
	* `sessionPersistence`, which the workspace registry itself consumes — an
	* inject edge here makes the registry wait on us while we wait on it, and
	* nothing ever activates. `remotesService()` resolves lazily per call
	* instead; cordis activates the provider on demand.
	*
	
	/**
	* Activation self-check marker. The row module and the plugin entry are
	* separate bundle copies, so `instanceof` cannot work across them; a global
	* symbol field can.
	*/
	routingMarker = ROUTING_MARKER;
	static Config = void 0;
	/**
	* The embedded official JSONL backend, resolved asynchronously.
	*
	* dsh 0.2.1-rc.2 turned the JSONL backend into a *plugin row*
	* (`apply(ctx, config)`) with no exported class, so it can no longer be
	* constructed against a stub context. It now registers `sessionPersistence`
	* on whatever context it is mounted on and installs its live-event tracker
	* there; mounting it into a **service-isolated** child scope keeps our own
	* `sessionPersistence` name intact. Its tracker still observes every
	* `session/event` because cordis dispatches to all subscribers unless the
	* dispatcher supplies a service filter.
	*/
	localReady;
	remotes = /* @__PURE__ */ new Map();
	/** Open remote write handles by session id — the live-event routing key. */
	writers = /* @__PURE__ */ new Map();
	/** Where each session this process has seen lives; see {@link routeOf}. */
	routes = /* @__PURE__ */ new Map();
	/**
	* @param ctx - host context (the root tree every consumer resolves against).
	* @param config - the embedded official JSONL backend's root/compression.
	* @param injectedRemote - the host facade, when the caller owns its lifetime.
	*   Omitted: resolved lazily from `ctx.get('remoteWorkspaces')`.
	*/
	constructor(ctx, config, injectedRemote) {
		super(ctx);
		this.injectedRemote = injectedRemote;
		this.localReady = (async () => {
			const scope = ctx.isolate("sessionPersistence", LOCAL_SCOPE);
			await apply(scope, {
				root: config.root,
				...config.compression === void 0 ? {} : { compression: config.compression }
			});
			const local = scope.get("sessionPersistence");
			if (local === void 0) throw new Error("the embedded JSONL persistence did not register its service");
			return local;
		})();
		this.localReady.catch(() => {});
		const writers = this.writers;
		ctx.on("session/event", (session, event) => {
			writers.get(String(session.id))?.enqueue(event);
		});
		ctx.on("session/flush", (session) => {
			return writers.get(String(session.id))?.flush();
		});
		ctx.on("session/disposed", (session) => {
			const key = String(session.id);
			const writer = writers.get(key);
			if (writer === void 0) return void 0;
			writers.delete(key);
			return writer.close();
		});
	}
	/** The embedded backend, once mounted. */
	local() {
		return this.localReady;
	}
	remotesService() {
		return this.injectedRemote ?? this.ctx.get("remoteWorkspaces");
	}
	remoteFor(route) {
		const service = this.remotesService();
		if (service === void 0) return void 0;
		let remote = this.remotes.get(route.workspaceId);
		if (remote === void 0) {
			const created = Reflect.construct(RemotePersistence, [
				registrationAbsorbingContext(),
				{ request: (method, params, signal) => service.sessionRequest(route.targetId, method, params, signal) },
				() => service.stubForWorkspace(route.workspaceId),
				{
					remoteCwdOf: () => service.remotePathForWorkspace(route.workspaceId) ?? route.remoteCwd,
					agentPresetOf: () => remotePresetId(route.targetId)
				}
			]);
			created.ctx = this.ctx;
			remote = created;
			this.remotes.set(route.workspaceId, remote);
		}
		return remote;
	}
	/** Wrap one freshly opened remote write handle so its live events reach it. */
	routeLive(handle) {
		const key = String(handle.id);
		const writer = new RemoteLiveWriter(handle, (message) => {
			this.ctx.logger.warn(message);
		}, () => {
			if (this.writers.get(key) === writer) this.writers.delete(key);
		});
		this.writers.set(key, writer);
		return writer.wrap();
	}
	async create(header, options) {
		const route = this.remotesService()?.routeForCwd(header.cwd);
		if (route !== void 0) {
			const remote = this.remoteFor(route);
			if (remote !== void 0) {
				const handle = await remote.create(header, options);
				this.routes.set(String(handle.id), route);
				return this.routeLive(handle);
			}
		}
		return await (await this.local()).create(header, options);
	}
	async open(id, access, options) {
		const route = await this.routeOf(id);
		if (route !== void 0) {
			const remote = this.remoteFor(route);
			if (remote !== void 0) {
				if (access === "write") {
					const live = this.writers.get(String(id));
					if (live !== void 0 && !live.closed) return live.borrow();
				}
				const handle = await remote.open(id, access, options);
				this.routes.set(String(id), route);
				return access === "write" ? this.routeLive(handle) : handle;
			}
		}
		return await (await this.local()).open(id, access, options);
	}
	async stat(id, options) {
		const route = await this.routeOf(id);
		if (route !== void 0) {
			const remote = this.remoteFor(route);
			if (remote !== void 0) return await remote.stat(id, options);
		}
		return await (await this.local()).stat(id, options);
	}
	/**
	* Where one session lives: the process-local table first, then the server.
	*
	* `persist.locate` is only consulted for ids this process has not seen. The
	* table is authoritative for the process lifetime because a remote session
	* cannot move between workspaces (its log lives under one project key).
	*/
	async routeOf(id) {
		const known = this.routes.get(String(id));
		if (known !== void 0) return known;
		const route = await this.remotesService()?.locateRemoteSession(id);
		if (route !== void 0) this.routes.set(String(id), route);
		return route;
	}
	async list(options) {
		return await (await this.local()).list(options);
	}
	async flush() {
		await (await this.local()).flush();
		for (const remote of this.remotes.values()) await remote.flush().catch(() => {});
	}
};
/**
* Build the routing persistence against an explicit host-plane facade.
*
* dev-core's v1 `apply()` owns the facade (`remoteWorkspaces` with the P1
* methods) and must mount this same instance under the `sessionPersistence`
* service name; providing the factory here keeps the routing (and its
* re-anchoring/lease-borrowing rules) in one module.
* @param ctx - host context in the root tree.
* @param config - local JSONL root and compression.
* @param remote - the host facade (`remoteWorkspaces`).
* @returns the constructed routing persistence (self-registers under `sessionPersistence`).
*/
function createRoutingPersistence(ctx, config, remote) {
	return new RoutingSessionPersistence(ctx, config, remote);
}
//#endregion
export { remotePresetDefinition as a, REMOTE_PRESET_PREFIX as i, createRoutingPersistence as n, remotePresetId as o, localSessionRoot as r, RoutingSessionPersistence as t };
