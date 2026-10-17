import Schema from "@deepseek-ai/schemastery";
import { z } from "zod";
import "@deepseek-ai/dsh-ssh/schemas";
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
	static inject = ["remoteWorkspaces"];
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
	/** The target's single RPC client, shared with the plugin's browse plane. */
	link;
	remote;
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
		if (!this.ctx.get("remoteWorkspaces")) throw new Error(`remote target "${this.config.targetId}" has no workspace service`);
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
		if (this.remote === void 0) throw new Error("the remote workspace is not connected yet");
		throw new Error("remote PTC is not supported by dsh-remote-workspace v1");
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
		return (await this.shared()).request(method, outgoing, result, bounded);
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
		return await (await this.shared()).openStream(endpoint, combined);
	}
	/** Close the remote server channel and release every stream. */
	dispose() {
		this.disposal ??= this.disposeOnce();
		return this.disposal;
	}
	async disposeOnce() {
		this.closing = true;
		this.lifetime.abort(/* @__PURE__ */ new Error("remote workspace connection is closing"));
		this.link = void 0;
		this.ctx.get("remoteWorkspaces")?.releaseRemoteClient?.(this.config.targetId);
	}
	assertOpen() {
		if (this.closing) throw new Error("remote workspace connection is closed");
		if (this.failure !== void 0) throw this.failure;
	}
	fail(error) {
		if (this.failure !== void 0) return;
		this.failure = error;
		this.lifetime.abort(error);
		this.link = void 0;
	}
	/** The shared client of this target, waiting for startup when needed. */
	async shared() {
		await this.ready;
		this.assertOpen();
		if (this.link === void 0) throw new Error("remote workspace connection is not attached");
		return this.link;
	}
	async start() {
		const workspaces = this.ctx.get("remoteWorkspaces");
		if (workspaces === void 0) throw new Error(`remote target "${this.config.targetId}" has no workspace service`);
		const client = await workspaces.remoteClient(this.config.targetId);
		if (this.closing) {
			workspaces.releaseRemoteClient?.(this.config.targetId);
			throw new Error("remote workspace connection closed before startup");
		}
		this.link = client;
		const hello = client.hello;
		const expected = await workspaces.expectedDigest(this.config.targetId).catch(() => void 0);
		if (expected !== void 0 && expected !== hello.hash) {
			const detail = `remote server digest ${hello.hash.slice(0, 16)}… differs from the installed plugin ${expected.slice(0, 16)}…`;
			this.dispose();
			throw new Error(`${detail}; install the same dsh-remote-workspace version on the remote host`);
		}
		this.remote = hello;
		return hello;
	}
};
//#endregion
export { RemoteConnection as default };
