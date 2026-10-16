import { RemotePersistence } from "./rsession.js";
import JsonlSessionPersistence from "@deepseek-ai/dsh-session-persistence-jsonl";
import { SessionPersistence } from "@deepseek-ai/dsh-session-persistence";
//#region src/session-persistence/routing.ts
/** A context stub that absorbs the base class' self-registration. */
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
const ROUTING_MARKER = Symbol.for("dsh-remote-workspace.routing-persistence");
var RoutingSessionPersistence = class extends SessionPersistence {
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
	local;
	remotes = /* @__PURE__ */ new Map();
	constructor(ctx, config) {
		super(ctx);
		this.local = Reflect.construct(JsonlSessionPersistence, [registrationAbsorbingContext(), {
			root: config.root,
			...config.compression === void 0 ? {} : { compression: config.compression }
		}]);
		this.local.ctx = ctx;
	}
	remotesService() {
		return this.ctx.get("remoteWorkspaces");
	}
	remoteFor(route) {
		const service = this.remotesService();
		if (service === void 0) return void 0;
		let remote = this.remotes.get(route.workspaceId);
		if (remote === void 0) {
			const created = Reflect.construct(RemotePersistence, [
				registrationAbsorbingContext(),
				{ request: (method, params, signal) => service.sessionRequest(route.targetId, method, params, signal) },
				route.workspaceId
			]);
			created.ctx = this.ctx;
			remote = created;
			this.remotes.set(route.workspaceId, remote);
		}
		return remote;
	}
	async create(header, options) {
		const route = this.remotesService()?.routeForCwd(header.cwd);
		if (route !== void 0) {
			const remote = this.remoteFor(route);
			if (remote !== void 0) return await remote.create({
				...header,
				cwd: header.cwd ?? ""
			}, options);
		}
		return await this.local.create(header, options);
	}
	async open(id, access, options) {
		const route = await this.remotesService()?.locateRemoteSession(id);
		if (route !== void 0) {
			const remote = this.remoteFor(route);
			if (remote !== void 0) return await remote.open(id, access, options);
		}
		return await this.local.open(id, access, options);
	}
	async stat(id, options) {
		const route = await this.remotesService()?.locateRemoteSession(id);
		if (route !== void 0) {
			const remote = this.remoteFor(route);
			if (remote !== void 0) return await remote.stat(id, options);
		}
		return await this.local.stat(id, options);
	}
	async list(options) {
		return await this.local.list(options);
	}
	async flush() {
		await this.local.flush();
		for (const remote of this.remotes.values()) await remote.flush().catch(() => {});
	}
};
//#endregion
export { RoutingSessionPersistence as default };
