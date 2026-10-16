import { SessionPersistence } from "@deepseek-ai/dsh-session-persistence";
//#region src/rsession/remote-persistence.ts
const asRemoteSessionId = (id) => id;
/**
* SessionPersistence provider that stores the authoritative log through the
* remote server. It deliberately delegates ownership, format validation and
* lease renewal to the official backend running on that server.
*/
var RemotePersistence = class extends SessionPersistence {
	rpc;
	workspaceId;
	handles = /* @__PURE__ */ new Set();
	constructor(ctx, rpc, workspaceId) {
		super(ctx);
		this.rpc = rpc;
		this.workspaceId = workspaceId;
	}
	async create(header, options) {
		console.error(`[rw] persist.create via remote: ws=${this.workspaceId} session=${header.id}`);
		const payload = await this.rpc.request("persist.create", {
			workspaceId: this.workspaceId,
			header
		}, options?.signal);
		const handle = new RemoteHandle(this.rpc, payload.handleId, "write", payload.header, payload.events ?? [], () => {
			this.handles.delete(handle);
		});
		this.handles.add(handle);
		return handle;
	}
	async open(id, access, options) {
		const payload = await this.rpc.request("persist.open", {
			workspaceId: this.workspaceId,
			sessionId: asRemoteSessionId(id),
			mode: access
		}, options?.signal);
		const handle = new RemoteHandle(this.rpc, payload.handleId, access, payload.header, payload.events ?? [], () => {
			this.handles.delete(handle);
		});
		this.handles.add(handle);
		return handle;
	}
	async flush() {
		await Promise.all([...this.handles].map((handle) => handle.flush()));
	}
	async stat(id, options) {
		return (await this.list({ signal: options?.signal })).find((snapshot) => snapshot.header.id === id);
	}
	async list(options) {
		return (await this.rpc.request("persist.list", { workspaceId: this.workspaceId }, options?.signal)).map((snapshot) => ({
			header: snapshot.header,
			revision: `remote:${snapshot.id}:${snapshot.sizeBytes ?? 0}`,
			...snapshot.sizeBytes === void 0 ? {} : { sizeBytes: snapshot.sizeBytes }
		}));
	}
	async closeHandle(handle) {
		this.handles.delete(handle);
	}
};
var RemoteHandle = class {
	rpc;
	handleId;
	access;
	header;
	onClose;
	[Symbol.asyncDispose] = async () => {
		await this.close();
	};
	closed = false;
	events;
	constructor(rpc, handleId, access, header, events, onClose) {
		this.rpc = rpc;
		this.handleId = handleId;
		this.access = access;
		this.header = header;
		this.onClose = onClose;
		this.events = [...events];
	}
	get id() {
		return this.header.id;
	}
	get inheritedEventCount() {
		return 0;
	}
	async read(offset = 0, length) {
		this.ensureOpen();
		const end = length === void 0 ? void 0 : offset + length;
		return {
			eventState: "detached",
			events: this.events.slice(offset, end)
		};
	}
	async append(events) {
		this.ensureOpen();
		if (this.access !== "write") throw new Error("remote session handle is read-only");
		await this.rpc.request("persist.append", {
			handleId: this.handleId,
			events
		});
		this.events.push(...events);
	}
	async flush() {
		this.ensureOpen();
		await this.rpc.request("persist.flush", { handleId: this.handleId });
	}
	async close() {
		if (this.closed) return;
		this.closed = true;
		await this.rpc.request("persist.close", { handleId: this.handleId });
		this.onClose();
	}
	ensureOpen() {
		if (this.closed) throw new Error("remote session handle is closed");
	}
};
/**
* Preset-row entry (`dsh-remote-workspace/rsession`): provides the realm's
* `sessionPersistence`. As a loader row inside the preset's isolate realm it
* reaches the agent loop through exactly the same resolution path as the
* official `fs`/`subprocess` providers; the base-class `provide` is legal here
* because the realm isolates the service name.
*/
const inject = ["ssh"];
function apply(ctx, config) {
	const connection = ctx.get("ssh");
	console.error(`[rw] persistence row active: workspaceId=${config.workspaceId}`);
	new RemotePersistence(ctx, { request: (method, params, signal) => connection.remoteSessionRequest(method, params, signal) }, config.workspaceId);
}
//#endregion
export { RemotePersistence, apply, inject };
