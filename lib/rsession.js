import { RW_METHODS } from "./protocol.js";
import { SessionPersistence } from "@deepseek-ai/dsh-session-persistence";
//#region src/rsession/remote-persistence.ts
/** Stable error code of a typed P1 failure, when present. */
function errorCodeOf(error) {
	if (error === null || typeof error !== "object") return void 0;
	const code = error.code;
	return typeof code === "string" ? code : void 0;
}
/** HTTP status of a typed P1 failure, when present. */
function errorStatusOf(error) {
	if (error === null || typeof error !== "object") return void 0;
	const status = error.status;
	return typeof status === "number" ? status : void 0;
}
/**
* Whether a handle-scoped RPC failed because the server no longer knows the
* handle (profile restart, plugin redeploy). P1 fixes the code
* `handle-not-found` / status 410; self-heal is allowed exactly once.
*/
function isHandleLost(error) {
	return errorCodeOf(error) === "handle-not-found" || errorStatusOf(error) === 410;
}
/** Normalize one raw server snapshot; `undefined` for a malformed row. */
function snapshotOf(raw) {
	if (raw === null || typeof raw !== "object") return void 0;
	const value = raw;
	const header = value.header;
	if (header === void 0 || typeof header !== "object" || typeof header.id !== "string") return void 0;
	return {
		header,
		revision: typeof value.revision === "string" ? value.revision : `remote:${header.id}`,
		...typeof value.sizeBytes === "number" ? { sizeBytes: value.sizeBytes } : {}
	};
}
/**
* SessionPersistence provider that stores the authoritative log through the
* profile server's P1 `persist/*` API.
*
* The server's official JSONL backend owns format, contiguity, durability and
* the single-writer flock; this adapter only translates:
*
* - `create`: the live header cwd is the local anchor, while the durable header
*   carries the server-real `remoteCwd` (`persist/create` validates it against
*   the official workspace path);
* - every returned header is re-anchored on the local anchor + this
*   connection's preset so official consumers can stat/attach it;
* - `read` is paged, and a lost server handle (`handle-not-found` 410) is
*   re-opened exactly once.
*/
var RemotePersistence = class extends SessionPersistence {
	rpc;
	anchorOf;
	handles = /* @__PURE__ */ new Set();
	remoteCwdOf;
	agentPresetOf;
	constructor(ctx, rpc, anchorOf, options = {}) {
		super(ctx);
		this.rpc = rpc;
		this.anchorOf = anchorOf;
		this.remoteCwdOf = options.remoteCwdOf;
		this.agentPresetOf = options.agentPresetOf;
	}
	/** Re-anchor one server-side header on the local anchor and preset. */
	reanchor(value) {
		const localCwd = this.anchorOf?.();
		const preset = this.agentPresetOf?.();
		if ((localCwd === void 0 || value.header.cwd === localCwd) && (preset === void 0 || value.header.agentPreset === preset)) return value;
		return {
			...value,
			header: {
				...value.header,
				...localCwd === void 0 ? {} : { cwd: localCwd },
				...preset === void 0 ? {} : { agentPreset: preset }
			}
		};
	}
	/** The server-real cwd required by `persist/create`. */
	requireRemoteCwd() {
		const remote = this.remoteCwdOf?.();
		if (remote === void 0 || remote === "") throw new Error("remote workspace has no known server cwd; cannot create its session log");
		return remote;
	}
	async create(header, options) {
		const inheritedEventCount = options?.inheritedEventCount;
		const remoteCwd = this.requireRemoteCwd();
		const params = {
			header: {
				...header,
				cwd: remoteCwd
			},
			remoteCwd,
			executor: "local"
		};
		if (inheritedEventCount !== void 0) params["inheritedEventCount"] = Number(inheritedEventCount);
		const payload = await this.rpc.request(RW_METHODS.persistCreate, params, options?.signal);
		return this.adopt("write", payload, inheritedEventCount === void 0 ? void 0 : Number(inheritedEventCount));
	}
	async open(id, access, options) {
		const payload = await this.rpc.request(RW_METHODS.persistOpen, {
			sessionId: String(id),
			access
		}, options?.signal);
		return this.adopt(access, payload);
	}
	/** Store one official handle behind the re-anchored façade. */
	adopt(access, payload, inheritedFallback) {
		const anchored = this.reanchor(payload);
		const handle = new RemoteHandle(this.rpc, anchored.handleId, access, anchored.header, () => {
			this.handles.delete(handle);
		}, anchored.inheritedEventCount ?? inheritedFallback, anchored.eventCount ?? anchored.nextSeq);
		this.handles.add(handle);
		return handle;
	}
	async flush() {
		await Promise.all([...this.handles].map((handle) => handle.flush()));
	}
	async stat(id, options) {
		const raw = await this.rpc.request(RW_METHODS.persistStat, { sessionId: String(id) }, options?.signal);
		if (raw === null || raw === void 0) return void 0;
		const snapshot = snapshotOf(raw);
		return snapshot === void 0 ? void 0 : {
			...snapshot,
			header: this.reanchor(snapshot).header
		};
	}
	async list(options) {
		const raw = await this.rpc.request(RW_METHODS.persistList, {}, options?.signal);
		const rows = raw !== null && typeof raw === "object" && Array.isArray(raw.snapshots) ? raw.snapshots : [];
		const snapshots = [];
		for (const row of rows) {
			const snapshot = snapshotOf(row);
			if (snapshot === void 0) continue;
			snapshots.push({
				...snapshot,
				header: this.reanchor(snapshot).header
			});
		}
		return snapshots;
	}
};
var RemoteHandle = class {
	rpc;
	access;
	header;
	onClose;
	inheritedCount;
	[Symbol.asyncDispose] = async () => {
		await this.close();
	};
	closed = false;
	events;
	/** The live server-side handle id; replaced when the server forgot the old one. */
	handleId;
	/** Official cursor reported by `persist/open`; a re-attach continues here. */
	eventCount;
	/** Serializes concurrent re-attach attempts for this handle. */
	reattaching;
	constructor(rpc, handleId, access, header, onClose, inheritedCount, eventCount) {
		this.rpc = rpc;
		this.access = access;
		this.header = header;
		this.onClose = onClose;
		this.inheritedCount = inheritedCount;
		this.handleId = handleId;
		this.events = [];
		this.eventCount = eventCount ?? 0;
	}
	get id() {
		return this.header.id;
	}
	get inheritedEventCount() {
		return this.inheritedCount ?? 0;
	}
	async read(offset = 0, length) {
		this.ensureOpen();
		const params = { offset };
		if (length !== void 0) params["length"] = length;
		const payload = await this.call(RW_METHODS.persistRead, params);
		const events = Array.isArray(payload?.events) ? payload.events : [];
		if (offset === 0 && length === void 0) this.events = [...events];
		if (typeof payload?.nextOffset === "number") this.eventCount = Math.max(this.eventCount, payload.nextOffset);
		return {
			eventState: payload?.eventState ?? "detached",
			events
		};
	}
	async append(events) {
		this.ensureOpen();
		if (this.access !== "write") throw new Error("remote session handle is read-only");
		await this.call(RW_METHODS.persistAppend, { events });
		this.events.push(...events);
		this.eventCount += events.length;
	}
	async flush() {
		this.ensureOpen();
		await this.call(RW_METHODS.persistFlush, {});
	}
	async close() {
		if (this.closed) return;
		this.closed = true;
		await this.rpc.request(RW_METHODS.persistClose, { handleId: this.handleId }).catch(() => {});
		this.onClose();
	}
	/**
	* Run one handle-scoped RPC, surviving a server that lost this handle.
	*
	* The server keeps handles in memory; a profile restart (or lease expiry)
	* loses the table while this client keeps the handle id. Without this the
	* failure surfaces as a broken live turn. Re-attaching re-reads the durable
	* cursor; exactly one retry is allowed and an already-stored batch is then
	* rejected by the official contiguity check instead of being written twice.
	*/
	async call(method, params) {
		try {
			return await this.rpc.request(method, {
				...params,
				handleId: this.handleId
			});
		} catch (error) {
			if (this.closed || !isHandleLost(error)) throw error;
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
			const payload = await this.rpc.request(RW_METHODS.persistOpen, {
				sessionId: String(this.header.id),
				access: this.access
			});
			this.handleId = payload.handleId;
			this.eventCount = payload.eventCount ?? payload.events?.length ?? this.eventCount;
			this.events = payload.events === void 0 ? this.events.slice(0, this.eventCount) : [...payload.events];
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
