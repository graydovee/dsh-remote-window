import Schema from "@deepseek-ai/schemastery";
import { z } from "zod";
import { Duplex } from "node:stream";
import { Service } from "@deepseek-ai/cordis";
//#region src/connection/index.ts
/**
* The `ctx.ssh` implementation mounted inside one remote world's realm.
*
* The official SSH providers (`dsh-fs-ssh`, `dsh-subprocess-ssh`,
* `dsh-sandbox-ssh`) only ever call `request()`, `connectStream()` and
* `dispose()`, so implementing that surface is all it takes to make the whole
* official execution stack run against a remote host. Two differences from the
* official connection are deliberate:
*
* - **Lazy**: constructing the row validates configuration only. An unreachable
*   host must not break the preset (a preset mount failure is permanent), so the
*   first operation starts the remote server.
* - **Transport-agnostic**: the byte channel comes from the host-plane
*   `remoteWorkspaces` service, which owns `ssh2`, host-key verification and
*   profile provisioning. The realm never sees a credential.
*/
/** One non-reconnecting connection to a remote execution world. */
var RemoteConnection = class extends Service {
	static inject = ["remoteMux"];
	static Config = Schema.object({
		targetId: Schema.string().required().description("Remote target record id owned by the plugin store."),
		label: Schema.string().description("Human-readable target label for diagnostics."),
		requestTimeoutMs: Schema.number().default(3e4),
		maxFrameBytes: Schema.number().default(67108864),
		maxPending: Schema.number().default(128),
		leaseMs: Schema.number().default(3e4)
	});
	config;
	lifetime = new AbortController();
	connecting;
	/** v1 execution-world service provided by dev-core. */
	mux;
	failure;
	closing = false;
	disposal;
	constructor(ctx, config) {
		super(ctx, "ssh");
		this.config = z.object({
			targetId: z.string().min(1),
			label: z.string().optional(),
			requestTimeoutMs: z.number().int().positive().max(2147483647),
			maxFrameBytes: z.number().int().positive().max(67108864),
			maxPending: z.number().int().positive().max(128),
			leaseMs: z.number().int().min(3e3).max(6e5)
		}).parse(config);
		ctx.effect(() => () => this.dispose());
	}
	/**
	* Readiness is intentionally immediate: the remote server starts on the first
	* operation, so an offline host cannot make the preset permanently broken.
	*/
	async [Service.init]() {
		if (this.ctx.get("remoteMux") === void 0) throw new Error(`remote target "${this.config.targetId}" has no execution-world mux service`);
	}
	/**
	* Verified remote PTC launch coordinates.
	*
	* The official `SshConnection` surface (dsh-ssh 0.2.1-rc.2) replaced the
	* separate `nodeExecutable` / `bootstrapPath` getters with this union, and the
	* hello it validates now carries `kind` + `executable` instead of `node`. This
	* world is a `node-script` deployment whose PTC bootstrap is never
	* provisioned, so PTC stays unsupported exactly as before — no installed
	* provider reads this member, so the refusal cannot break a session.
	*/
	get ptcLaunch() {
		throw new Error("remote PTC is not supported by dsh-remote-window v1");
	}
	/** The verified remote handshake, connecting on first access. */
	get ready() {
		this.connecting ??= this.start();
		return this.connecting;
	}
	/**
	* Send one remote operation; cancellation never replays an ambiguous mutation.
	* @param method - the helper-compatible operation name.
	* @param params - JSON request fields.
	* @param result - response validation before callers see data.
	* @param signal - cancellation, which does not undo completed remote effects.
	* @param wait - allow a process observation to outlast the administrative deadline.
	* @returns the validated remote result.
	*/
	async request(method, params, result, signal, wait = false) {
		this.assertOpen();
		await this.ready;
		this.assertOpen();
		const outgoing = this.translateWorkspaceAliases(params);
		const bounded = wait ? signal : signal === void 0 ? AbortSignal.timeout(this.config.requestTimeoutMs) : AbortSignal.any([signal, AbortSignal.timeout(this.config.requestTimeoutMs)]);
		const raw = await (await this.muxService()).request(this.config.targetId, method, outgoing, bounded);
		return result.parse(raw);
	}
	/** RPC seam used by the realm-scoped RemotePersistence provider. */
	async remoteSessionRequest(method, params, signal) {
		return await this.request(method, params, z.unknown(), signal);
	}
	/**
	* Rewrite stub-workspace paths into their remote counterparts across every
	* string value in the request params.
	*
	* Workspace-anchored sessions carry the shell-side cwd — a local stub
	* directory (official workspaces are local-realpath'd) — while the remote
	* world only knows the real directory. The official SSH providers pass the
	* session cwd explicitly on every call (`fs.resolve {cwd}`, spawn `{cwd}`,
	* policy `{workspaceRoot}`, ...), and this connection is the single seam
	* all of them cross, so the alias rewrite here covers every method.
	* Command strings *inside* argv are deliberately untouched; the seeded
	* system context and error feedback push the agent toward real paths.
	*/
	translateWorkspaceAliases(params) {
		let aliases;
		const walk = (value) => {
			if (typeof value === "string") {
				for (const alias of aliases ?? []) {
					if (value === alias.stub) return alias.remote;
					if (value.startsWith(alias.stub + "/")) return alias.remote + value.slice(alias.stub.length);
				}
				return value;
			}
			if (Array.isArray(value)) return value.map((item) => walk(item));
			if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
			return value;
		};
		try {
			aliases = this.ctx.get("remoteWorkspaces")?.pathAliases?.(this.config.targetId);
		} catch {
			return params;
		}
		if (aliases === void 0 || aliases.length === 0) return params;
		return walk(params);
	}
	/**
	* Attach one authenticated logical stream.
	* @param endpoint - coordinates issued by this connection's remote server.
	* @param signal - cancellation of allocation and the resulting stream.
	* @returns a duplex; attach a consumer before writing large payloads.
	*/
	async connectStream(endpoint, signal) {
		await this.ready;
		this.assertOpen();
		const combined = signal === void 0 ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal]);
		combined.throwIfAborted();
		const stream = await (await this.muxService()).openStream(this.config.targetId, endpoint.path, { capability: endpoint.capability });
		combined.throwIfAborted();
		return muxStreamSocket(stream);
	}
	/** Close the remote server channel and release every stream. */
	dispose() {
		this.disposal ??= this.disposeOnce();
		return this.disposal;
	}
	async disposeOnce() {
		this.closing = true;
		this.lifetime.abort(/* @__PURE__ */ new Error("remote workspace connection is closing"));
		this.mux = void 0;
	}
	assertOpen() {
		if (this.closing) throw new Error("remote workspace connection is closed");
		if (this.failure !== void 0) throw this.failure;
	}
	fail(error) {
		if (this.failure !== void 0) return;
		this.failure = error;
		this.lifetime.abort(error);
		this.mux = void 0;
	}
	/** Resolve the target-bound mux on every call so an SSH reconnect is visible. */
	async muxService() {
		await this.ready;
		this.assertOpen();
		const mux = this.ctx.get("remoteMux");
		if (mux === void 0) throw new Error(`remote target "${this.config.targetId}" has no execution-world mux service`);
		this.mux = mux;
		return mux;
	}
	async start() {
		const mux = this.ctx.get("remoteMux");
		if (mux === void 0) throw new Error(`remote target "${this.config.targetId}" has no execution-world mux service`);
		if (this.closing) throw new Error("remote workspace connection closed before startup");
		this.mux = mux;
	}
};
/**
* Adapt one v1 mux stream to the paused `Duplex` the official providers use.
*
* `RemoteMuxStream` is transport-agnostic; the providers pipe it into process
* stdio, terminal output, or a `SshRpcPeer` (which only needs a
* Readable+Writable pair). No extra backpressure is invented here: the mux/WS
* layer owns flow control.
*/
function muxStreamSocket(stream) {
	let iterator;
	let pumping = false;
	const duplex = new Duplex({
		allowHalfOpen: true,
		read() {
			if (pumping) return;
			pumping = true;
			iterator ??= stream.read()[Symbol.asyncIterator]();
			(async () => {
				try {
					while (!duplex.destroyed) {
						const next = await iterator?.next();
						if (next === void 0 || next.done === true) {
							pumping = false;
							duplex.push(null);
							return;
						}
						if (!duplex.push(Buffer.from(next.value))) {
							pumping = false;
							return;
						}
					}
				} catch (error) {
					pumping = false;
					duplex.destroy(error instanceof Error ? error : new Error(String(error)));
				}
			})();
		},
		write(chunk, _encoding, callback) {
			Promise.resolve(stream.write(chunk)).then(() => callback(), (error) => callback(error instanceof Error ? error : new Error(String(error))));
		},
		final(callback) {
			try {
				stream.end();
				callback();
			} catch (error) {
				callback(error instanceof Error ? error : new Error(String(error)));
			}
		},
		destroy(error, callback) {
			stream.abort(error?.message);
			callback(error);
		}
	});
	return duplex;
}
//#endregion
export { RemoteConnection as default };
