import { SessionPersistence } from "@deepseek-ai/dsh-session-persistence";
//#region src/rsession/remote-persistence.ts
const asRemoteSessionId = (id) => id;
/**
* SessionPersistence provider that stores the authoritative log through the
* remote server. It deliberately delegates ownership, format validation and
* lease renewal to the official backend running on that server.
*
* The one client-side fact it adds is the **header cwd rewrite** (`localCwd`):
* the server stores every session under the *remote* workspace path, so a
* resumed session's header would otherwise carry `/Users/remote/project`
* locally. Consumers do realpath/`stat` work on `header.cwd` — the official
* workspace registry only attaches a session whose canonical cwd equals the
* workspace path, and the session controller rejects a mismatch with
* `cwd conflict` — so a remote path is unusable on this side. Rewriting it to
* the local stub keeps one invariant for both flows: *a remote-workspace
* session always has the stub as its cwd*, and the realm's stub→remote alias
* does the translation at the tool boundary (exactly as it does for `create`).
*/
var RemotePersistence = class extends SessionPersistence {
	rpc;
	workspaceId;
	stubOf;
	handles = /* @__PURE__ */ new Set();
	constructor(ctx, rpc, workspaceId, stubOf) {
		super(ctx);
		this.rpc = rpc;
		this.workspaceId = workspaceId;
		this.stubOf = stubOf;
	}
	/** Re-anchor one server-side header on the local stub cwd. */
	reanchor(value) {
		const localCwd = this.stubOf?.();
		if (localCwd === void 0 || value.header.cwd === localCwd) return value;
		return {
			...value,
			header: {
				...value.header,
				cwd: localCwd
			}
		};
	}
	async create(header, options) {
		const inheritedEventCount = options?.inheritedEventCount;
		const payload = await this.rpc.request("persist.create", {
			workspaceId: this.workspaceId,
			header,
			...inheritedEventCount === void 0 ? {} : { inheritedEventCount: Number(inheritedEventCount) }
		}, options?.signal);
		const anchored = this.reanchor(payload);
		const handle = new RemoteHandle(this.rpc, anchored.handleId, "write", anchored.header, anchored.events ?? [], () => {
			this.handles.delete(handle);
		}, this.workspaceId, anchored.inheritedEventCount);
		this.handles.add(handle);
		return handle;
	}
	async open(id, access, options) {
		const payload = await this.rpc.request("persist.open", {
			workspaceId: this.workspaceId,
			sessionId: asRemoteSessionId(id),
			mode: access
		}, options?.signal);
		const anchored = this.reanchor(payload);
		const handle = new RemoteHandle(this.rpc, anchored.handleId, access, anchored.header, anchored.events ?? [], () => {
			this.handles.delete(handle);
		}, this.workspaceId, anchored.inheritedEventCount);
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
			header: this.reanchor(snapshot).header,
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
	access;
	header;
	onClose;
	workspaceId;
	inheritedCount;
	[Symbol.asyncDispose] = async () => {
		await this.close();
	};
	closed = false;
	events;
	/** The live server-side handle id; replaced when the server forgot the old one. */
	handleId;
	/** Serializes concurrent re-attach attempts for this handle. */
	reattaching;
	constructor(rpc, handleId, access, header, events, onClose, workspaceId, inheritedCount) {
		this.rpc = rpc;
		this.access = access;
		this.header = header;
		this.onClose = onClose;
		this.workspaceId = workspaceId;
		this.inheritedCount = inheritedCount;
		this.handleId = handleId;
		this.events = [...events];
	}
	get id() {
		return this.header.id;
	}
	get inheritedEventCount() {
		return this.inheritedCount ?? 0;
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
		await this.call("persist.append", { events });
		this.events.push(...events);
	}
	async flush() {
		this.ensureOpen();
		await this.call("persist.flush", {});
	}
	async close() {
		if (this.closed) return;
		this.closed = true;
		await this.rpc.request("persist.close", { handleId: this.handleId }).catch(() => {});
		this.onClose();
	}
	/**
	* Run one handle-scoped RPC, surviving a server that no longer knows this
	* handle.
	*
	* The server keeps handles in memory, so its handle table is lost whenever it
	* restarts — a lease expiry after an idle gap, an explicit stop, or the
	* plugin's own server-bundle redeploy, which happens on every server-side
	* release. Without this, the failure surfaces as a broken *turn* in a live
	* conversation (`unknown remote session handle "…"`), which is exactly the
	* kind of durability the remote-authoritative design promises not to have.
	*
	* Re-attaching re-reads the log from disk on the server, so `events` is
	* refreshed from the authoritative artifact rather than guessed: a batch that
	* was already stored before the loss is then rejected as non-contiguous
	* instead of being written twice.
	*/
	async call(method, params) {
		try {
			return await this.rpc.request(method, {
				...params,
				handleId: this.handleId
			});
		} catch (error) {
			if (this.closed || !/unknown remote session handle/i.test(String(error))) throw error;
			await this.reattach();
			return await this.rpc.request(method, {
				...params,
				handleId: this.handleId
			});
		}
	}
	/** Re-open this session on the server for the same access, once. */
	reattach() {
		this.reattaching ??= (async () => {
			const payload = await this.rpc.request("persist.open", {
				workspaceId: this.workspaceId,
				sessionId: asRemoteSessionId(this.header.id),
				mode: this.access
			});
			this.handleId = payload.handleId;
			this.events = [...payload.events ?? []];
			if (payload.inheritedEventCount !== void 0) this.inheritedCount = payload.inheritedEventCount;
		})().finally(() => {
			this.reattaching = void 0;
		});
		return this.reattaching;
	}
	ensureOpen() {
		if (this.closed) throw new Error("remote session handle is closed");
	}
};
//#endregion
export { RemotePersistence };
