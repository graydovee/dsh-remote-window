import { RW_METHODS } from "./protocol.js";
import { a as remotePresetDefinition, n as createRoutingPersistence, o as remotePresetId, r as localSessionRoot } from "./routing-qoFLGH4r.js";
import { createRequire } from "node:module";
import { createReadStream, readFileSync } from "node:fs";
import { once } from "node:events";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Schema from "@deepseek-ai/schemastery";
import { execFile } from "node:child_process";
import { glob, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { credentialKey } from "@deepseek-ai/dsh-credentials";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { z } from "zod";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Agent, createServer, request } from "node:http";
import { Client } from "ssh2";
import { request as request$1 } from "node:https";
import { connect } from "node:net";
import { SSH_PROTOCOL_VERSION, SshRpcPeer } from "@deepseek-ai/dsh-ssh/protocol";
import { helloSchema } from "@deepseek-ai/dsh-ssh/schemas";
import { Duplex, PassThrough } from "node:stream";
//#region src/session/remote-guard.ts
/**
* Fail-closed guard for local-mode sessions whose cwd is a private anchor.
*
* v1 local mode binds a server session to a plugin-private anchor
* (`<DSH_HOME>/remote-workspaces/<clientId>/<targetId>/<hash>`); the anchor is
* **not** a workspace and must never be composed with an execution world other
* than that target's remote preset. This module is the synchronous
* `session/created` veto:
*
* - an anchor cwd must carry exactly `remote:<targetId>`;
* - a `remote:*` preset on any other cwd is rejected too (a remote execution
*   world mounted on a local workspace runs tools on the wrong machine).
*
* The legacy visible-stub layout (`<DSH_HOME>/remote-workspaces/<targetId>/…`)
* is retired with the old stdio architecture; those stubs are cleaned by the
* migration sweep instead of being attachable here.
*/
/**
* Root of the private local anchors.
*
* It must follow `DSH_HOME`: a profile with a non-default home (clean debug
* instance, QA client instance) keeps its anchors under that home.
* @param env - environment used for the fallback, injectable for tests.
*/
function remoteAnchorRoot(env = process.env) {
	const configured = env["DSH_HOME"]?.trim();
	return join(configured !== void 0 && configured !== "" ? configured : join(homedir(), ".dsh"), "remote-workspaces");
}
/**
* Resolve the target id from a local-mode anchor cwd.
*
* v1 anchors are `<root>/<clientId>/<targetId>/<hash>`; the target id keeps its
* `rt-` prefix. Anything shallower (the retired visible stub layout) or outside
* the root is not an anchor.
* @param cwd - session header cwd; absent/blank is never an anchor.
* @returns the target id, or undefined for a non-anchor cwd.
*/
function remoteTargetIdForCwd(cwd, env = process.env) {
	if (cwd === void 0 || cwd === "") return void 0;
	const root = remoteAnchorRoot(env);
	const rel = relative(root, cwd);
	if (rel === "" || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return void 0;
	const segments = rel.split(sep);
	if (segments.length < 3) return void 0;
	const targetId = segments[1];
	return targetId !== void 0 && targetId.startsWith("rt-") ? targetId : void 0;
}
/**
* Refuse a session under a private anchor that would compose any execution
* world other than that target's remote preset.
*
* Called from the synchronous `session/created` boundary: a throw vetoes and
* rolls back publication. It also catches a preset chosen before the UI's
* fixed remote chip mounted, a cross-target preset, or a resumed session whose
* durable header names another client's target id.
* @param header - the session header about to be published.
*/
function assertRemoteSessionPreset(header) {
	const targetId = remoteTargetIdForCwd(header.cwd);
	if (targetId === void 0) {
		if (header.agentPreset?.startsWith("remote:") === true) throw new Error(`agent preset "${header.agentPreset}" is only valid for a remote workspace anchor; got cwd "${header.cwd ?? ""}". Refusing to run a remote execution world on a local workspace.`);
		return;
	}
	const expected = remotePresetId(targetId);
	if (header.agentPreset === expected) return;
	throw new Error(`remote workspace "${targetId}" requires agent preset "${expected}"; got "${header.agentPreset ?? ""}". Refusing to create or resume a session that would run outside the remote execution world.`);
}
//#endregion
//#region src/ssh-config.ts
/** A pattern with any of these characters is a matcher or a negation, not a literal alias. */
const NON_LITERAL_PATTERN = /[*?!]/;
/** Characters that make an `Include` argument a glob rather than a plain path. */
const GLOB_CHARACTERS = /[*?[\]{}]/;
/** The path `ssh` itself would read when no explicit config file is given. */
function defaultConfigPath() {
	return join(homedir(), ".ssh", "config");
}
/** Expand a leading `~` (the only environment-derived expansion this module performs). */
function expandTilde(value) {
	if (value === "~") return homedir();
	if (value.startsWith("~/")) return join(homedir(), value.slice(2));
	return value;
}
/** True when a Host pattern can be listed and matched as a literal alias. */
function isLiteralPattern(pattern) {
	return pattern.length > 0 && !NON_LITERAL_PATTERN.test(pattern);
}
/** Short, path-safe description of an fs error for a warning string. */
function errorMessage$1(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
/**
* Split one config line into tokens.
*
* Whitespace separates tokens, `#` starts a comment outside quotes, `"` groups a
* value that may contain spaces, and a backslash escapes the next character
* inside a quoted value (so `"a\"b"` is `a"b`).
*/
function tokenizeLine(line) {
	const tokens = [];
	let token = "";
	let pending = false;
	let quoted = false;
	let escaped = false;
	for (const character of line) {
		if (escaped) {
			token += character;
			pending = true;
			escaped = false;
			continue;
		}
		if (quoted && character === "\\") {
			escaped = true;
			continue;
		}
		if (character === "\"") {
			quoted = !quoted;
			pending = true;
			continue;
		}
		if (!quoted && character === "#") break;
		if (!quoted && (character === " " || character === "	")) {
			if (pending) tokens.push(token);
			token = "";
			pending = false;
			continue;
		}
		token += character;
		pending = true;
	}
	if (escaped) {
		token += "\\";
		pending = true;
	}
	if (pending) tokens.push(token);
	return tokens;
}
/**
* Normalize a tokenized directive into `key` plus its arguments, accepting both
* `Key value` and `Key = value` (and the unspaced `Key=value` spelling).
*/
function splitDirective(tokens) {
	const first = tokens[0];
	if (first === void 0) return void 0;
	let key = first;
	let args = tokens.slice(1);
	const equals = key.indexOf("=");
	if (equals > 0) {
		args = [key.slice(equals + 1), ...args];
		key = key.slice(0, equals);
	}
	if (args[0] === "=") args = args.slice(1);
	return {
		key: key.toLowerCase(),
		args
	};
}
/** Assign a keyword to the current block, honouring OpenSSH's "first value wins". */
function applyOption(state, key, args) {
	const block = state.current;
	if (block === null) return;
	const first = args[0];
	if (first === void 0) return;
	switch (key) {
		case "hostname":
			if (block.hostName === void 0) block.hostName = first;
			return;
		case "user":
			if (block.user === void 0) block.user = first;
			return;
		case "identityfile":
			if (block.identityFile === void 0) block.identityFile = first;
			return;
		case "proxyjump":
			if (block.proxyJump === void 0) block.proxyJump = first;
			return;
		case "proxycommand":
			if (block.proxyCommand === void 0) block.proxyCommand = args.join(" ");
			return;
		case "port": {
			if (block.port !== void 0) return;
			const port = Number.parseInt(first, 10);
			if (!/^\d+$/.test(first) || !Number.isInteger(port) || port < 1 || port > 65535) {
				state.warnings.push(`Ignoring invalid Port "${first}" in ${block.source}`);
				return;
			}
			block.port = port;
			return;
		}
		default: return;
	}
}
/** Read one file into the shared state, following `Include` directives in place. */
async function readInto(state, file) {
	const absolute = resolve(file);
	if (state.visited.has(absolute)) return;
	state.visited.add(absolute);
	let text;
	try {
		text = await readFile(absolute, "utf8");
	} catch (error) {
		state.warnings.push(`Cannot read SSH config file ${absolute}: ${errorMessage$1(error)}`);
		return;
	}
	for (const line of text.split(/\r?\n/)) {
		const tokens = tokenizeLine(line);
		if (tokens.length === 0) continue;
		const directive = splitDirective(tokens);
		if (directive === void 0) continue;
		const { key, args } = directive;
		if (key === "host") {
			const alias = args[0];
			if (alias === void 0) {
				state.current = null;
				continue;
			}
			const block = {
				alias,
				patterns: [...args],
				source: absolute
			};
			state.hosts.push(block);
			state.current = block;
			continue;
		}
		if (key === "match") {
			state.current = null;
			continue;
		}
		if (key === "include") {
			for (const pattern of args) await includeInto(state, absolute, pattern);
			continue;
		}
		applyOption(state, key, args);
	}
}
/** Expand one `Include` argument (tilde, relative and glob forms) and read the result. */
async function includeInto(state, fromFile, pattern) {
	const expanded = expandTilde(pattern);
	const candidate = expanded.startsWith("/") ? resolve(expanded) : resolve(dirname(fromFile), expanded);
	if (!GLOB_CHARACTERS.test(candidate)) {
		await readInto(state, candidate);
		return;
	}
	let matches;
	try {
		matches = [];
		for await (const match of glob(candidate)) matches.push(match);
	} catch (error) {
		state.warnings.push(`Cannot expand Include "${pattern}" from ${fromFile}: ${errorMessage$1(error)}`);
		return;
	}
	matches.sort();
	for (const match of matches) await readInto(state, match);
}
/**
* Read the config file(s) at `configPath`, following `Include` directives. Never throws for a missing file.
*
* `Include` arguments may start with `~`, be absolute, be relative to the file
* that names them, or contain glob characters; a missing explicitly named
* include is reported in `warnings` instead of throwing, and a glob that matches
* nothing is silently ignored. Files reachable through `Include` are read once,
* so an include cycle cannot loop and cannot duplicate entries.
*/
async function readSshConfig(configPath) {
	const state = {
		hosts: [],
		warnings: [],
		visited: /* @__PURE__ */ new Set(),
		current: null
	};
	await readInto(state, configPath);
	return {
		hosts: state.hosts,
		warnings: state.warnings
	};
}
/**
* List the aliases a user can pick: literal (non-pattern) Host entries, sorted case-insensitively, de-duplicated (first wins). Default configPath = join(homedir(), '.ssh', 'config').
*
* Only the first pattern of a `Host` line decides list membership, so
* `Host web1 *.example.com` is offered as `web1` while `Host *.example.com` is
* not offered at all. The returned entries keep their literal table values
* (including `~` in `identityFile`, which is passed through as written).
*/
async function listSshAliases(configPath) {
	const { hosts, warnings } = await readSshConfig(configPath ?? defaultConfigPath());
	const seen = /* @__PURE__ */ new Set();
	const aliases = [];
	for (const host of hosts) {
		if (!isLiteralPattern(host.alias)) continue;
		const key = host.alias.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		aliases.push(host);
	}
	aliases.sort((left, right) => {
		const a = left.alias.toLowerCase();
		const b = right.alias.toLowerCase();
		if (a < b) return -1;
		if (a > b) return 1;
		return left.alias < right.alias ? -1 : left.alias > right.alias ? 1 : 0;
	});
	return {
		aliases,
		warnings
	};
}
//#endregion
//#region src/targets/types.ts
const runtimeSchema = z.object({
	nodePath: z.string().min(1).default("node"),
	dshCommand: z.string().min(1).default("dsh"),
	profile: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).default("dsh-remote-server"),
	dshHome: z.string().min(1).default("~/.dsh"),
	plugins: z.array(z.string()).default([])
}).strict();
/** Server-package source for one target. */
const packageSourceSchema = z.enum([
	"auto",
	"download",
	"upload",
	"reuse"
]);
/**
* The local model source's effective mode.
*
* An explicit `mode` always wins. A legacy document written before this field
* existed has no `mode`; a configured `baseUrl` then means the user chose the
* manual endpoint, while an empty base URL means "never configured" and gets
* the new automatic proxy default.
* @param settings - the stored settings, when any.
*/
function effectiveLocalLlmMode(settings) {
	if (settings?.mode === "auto" || settings?.mode === "manual") return settings.mode;
	return settings !== void 0 && settings.baseUrl.trim() !== "" ? "manual" : "auto";
}
/** Validate one local-model settings object; URL scheme + no embedded credentials. */
const localLlmSettingsSchema = z.object({
	mode: z.enum(["auto", "manual"]).optional(),
	baseUrl: z.string().max(2048).refine((value) => {
		if (value === "") return true;
		let parsed;
		try {
			parsed = new URL(value);
		} catch {
			return false;
		}
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.username === "" && parsed.password === "" && parsed.hash === "" && parsed.search === "";
	}, "must be an http(s) URL without credentials, query or fragment"),
	models: z.array(z.string().min(1).max(256)).max(256),
	timeoutMs: z.number().int().min(1e3).max(36e5),
	apiKeyRef: z.string().min(1).max(256).optional()
}).strict();
/** The domain global slot's schema (global default policy + release mirror). */
const packagePolicySettingsSchema = z.object({
	policy: z.enum([
		"auto",
		"download",
		"upload",
		"ask"
	]),
	mirror: z.string(),
	/** v1 client identity; additive optional until first ensureClientId(). */
	clientId: z.string().regex(/^[a-z0-9]{12}$/u).optional(),
	/** Additive optional local-model endpoint settings (domain stays at version 1). */
	localLlm: localLlmSettingsSchema.optional()
}).strict();
/** Stored target record; unknown fields from a newer version are dropped loudly. */
const targetRecordSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	kind: z.enum(["ssh", "wsl"]),
	host: z.string().min(1),
	port: z.number().int().min(1).max(65535),
	username: z.string().min(1),
	authKind: z.enum([
		"password",
		"privateKey",
		"agent"
	]),
	credentialKey: z.string().optional(),
	privateKeyPath: z.string().min(1).optional(),
	hostKeyFingerprint: z.string().regex(/^(?:|SHA256:[A-Za-z0-9+/=]+)$/),
	sshConfigAlias: z.string().min(1).optional(),
	wslDistro: z.string().min(1).optional(),
	wslUser: z.string().min(1).optional(),
	packageSource: packageSourceSchema.optional(),
	/** Reuse mode's launcher memory; `.strict()` like every other record object. */
	reuseDsh: z.object({
		path: z.string().min(1),
		version: z.string(),
		nodePath: z.string().min(1).optional(),
		scannedAt: z.string().min(1)
	}).strict().optional(),
	/** Last probed architecture (hint only; every connect probes again). */
	platformProbe: z.object({
		platform: z.enum(["linux", "darwin"]),
		arch: z.enum(["x64", "arm64"]),
		libc: z.enum([
			"",
			"gnu",
			"musl"
		]),
		tag: z.string().min(1),
		probedAt: z.string().min(1)
	}).strict().optional(),
	/** The server package last deployed, for the UI badge and for troubleshooting. */
	serverPackage: z.object({
		artifact: z.string().min(1),
		sha256: z.string().length(64),
		version: z.string().min(1)
	}).strict().optional(),
	clientId: z.string().regex(/^[a-z0-9]{12}$/u).optional(),
	executor: z.enum(["server", "local"]).optional(),
	/** Additive optional local-model source (storage domain stays at version 1). */
	modelSource: z.enum(["local", "server"]).optional(),
	profileName: z.string().regex(/^graydovee-remote-workspace-[a-z0-9]{12}$/u).optional(),
	profilePort: z.number().int().min(1).max(65535).optional(),
	runtimeKind: z.enum(["isolated", "global"]).optional(),
	runtimeDir: z.string().min(1).optional(),
	pluginVersion: z.string().min(1).optional(),
	serverDshVersion: z.string().min(1).optional(),
	stubPath: z.string().min(1).optional(),
	officialWorkspaceId: z.string().min(1).optional(),
	remote: runtimeSchema,
	status: z.enum([
		"unknown",
		"ready",
		"failed",
		"stopped"
	]),
	lastError: z.string().optional(),
	lastConnectedAt: z.string().optional(),
	createdAt: z.string().min(1)
}).strict();
/** Stored remote workspace record. */
/** Session ids the user pinned / archived in one remote workspace.
*
* Plugin-owned rather than the shell's registry-global sets: the shell resolves
* a pin against its *local* session index (`sessionPersistence.list()`), which
* by design holds no remote session, so `workspace/pinSession` answers
* `session/not-found` for a remote id. Additive optional fields keep the storage
* domain version at 1. */
const sessionFlagSchema = z.array(z.string()).optional();
/**
* Local workspace reference (P0, architecture §15.1).
*
* A strict **union** of the old record and the new one: `path`/`title`/
* `createdAt`/`serverId` stay accepted so old documents validate, but nothing
* writes them any more — `workspaceRefs` holds only what is genuinely local.
*/
const workspaceRecordSchema = z.object({
	id: z.string().min(1),
	targetId: z.string().min(1),
	remoteWorkspaceId: z.string().length(16).optional(),
	stubPath: z.string().min(1).optional(),
	officialWorkspaceId: z.string().min(1).optional(),
	lastOpenedAt: z.string().optional(),
	sessionId: z.string().min(1).optional(),
	/** Session ids the user pinned in this remote workspace, most recent first. */
	pinnedSessions: sessionFlagSchema,
	/** Session ids the user archived in this remote workspace. */
	archivedSessions: sessionFlagSchema,
	path: z.string().startsWith("/").optional(),
	title: z.string().min(1).optional(),
	createdAt: z.string().min(1).optional(),
	serverId: z.string().min(1).optional()
}).strict();
z.object({
	label: z.string().min(1).max(64),
	host: z.string().min(1),
	port: z.number().int().min(1).max(65535).default(22),
	username: z.string().min(1),
	authKind: z.enum([
		"password",
		"privateKey",
		"agent"
	]).default("agent"),
	/** Secret material; never persisted outside `ctx.credentials`. */
	secret: z.string().optional(),
	privateKeyPath: z.string().min(1).optional(),
	sshConfigAlias: z.string().min(1).optional(),
	packageSource: packageSourceSchema.optional(),
	remote: runtimeSchema.partial().optional()
}).strict();
/**
* The target's effective model source.
*
* An explicit `modelSource` always wins. Otherwise a server-executor target
* keeps its model on the server; every other target's models are the client's
* own (local mode runs the agent locally, so its models are local by
* definition). This is what the UI reports; the connect flow only forwards
* models when `modelSource === 'local'` is explicit or persisted.
* @param record - the stored target fields that decide the source.
*/
function effectiveModelSource(record) {
	return record.modelSource ?? (record.executor === "server" ? "server" : "local");
}
/** Strip everything the browser must not see from a stored target. */
function toPublicTarget(record) {
	return {
		id: record.id,
		label: record.label,
		kind: record.kind,
		host: record.host,
		port: record.port,
		username: record.username,
		authKind: record.authKind,
		hasStoredSecret: record.credentialKey !== void 0,
		hostKeyFingerprint: record.hostKeyFingerprint,
		...record.sshConfigAlias === void 0 ? {} : { sshConfigAlias: record.sshConfigAlias },
		...record.wslDistro === void 0 ? {} : { wslDistro: record.wslDistro },
		...record.wslUser === void 0 ? {} : { wslUser: record.wslUser },
		...record.packageSource === void 0 ? {} : { packageSource: record.packageSource },
		...record.reuseDsh === void 0 ? {} : { reuseDsh: record.reuseDsh },
		...record.platformProbe === void 0 ? {} : { platformProbe: record.platformProbe },
		...record.serverPackage === void 0 ? {} : { serverPackage: record.serverPackage },
		...record.clientId === void 0 ? {} : { clientId: record.clientId },
		...record.executor === void 0 ? {} : { executor: record.executor },
		...record.modelSource === void 0 ? {} : { modelSource: record.modelSource },
		...record.profileName === void 0 ? {} : { profileName: record.profileName },
		...record.profilePort === void 0 ? {} : { profilePort: record.profilePort },
		...record.runtimeKind === void 0 ? {} : { runtimeKind: record.runtimeKind },
		...record.runtimeDir === void 0 ? {} : { runtimeDir: record.runtimeDir },
		...record.pluginVersion === void 0 ? {} : { pluginVersion: record.pluginVersion },
		...record.serverDshVersion === void 0 ? {} : { serverDshVersion: record.serverDshVersion },
		remote: record.remote,
		status: record.status,
		...record.lastError === void 0 ? {} : { lastError: scrubSecrets(record.lastError) },
		...record.lastConnectedAt === void 0 ? {} : { lastConnectedAt: record.lastConnectedAt }
	};
}
/**
* Remove values that look like credentials from free text.
*
* Applied to every error string, log line and HTTP/SSE payload the plugin emits,
* so a rejected SSH attempt cannot echo a password into the UI or a session log.
*/
function scrubSecrets(text) {
	return text.replace(/(password|passphrase|secret|token)(\s*[=:]\s*)\S+/gi, "$1$2***").replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted private key]").replace(/(?:^|\s)(?:ssh-rsa|ssh-ed25519|ecdsa-sha2-\S+)\s+[A-Za-z0-9+/=]{16,}/g, " [redacted public key]");
}
//#endregion
//#region src/targets/client-id.ts
/**
* Stable identities for the per-client profile and the per-process instance.
*
* `clientId` is the client installation's identity: it names the server profile
* (`graydovee-remote-workspace-<clientId>`) and the isolated runtime directory,
* so it must be stable across restarts and safe in a path and a DSH profile
* name. `instanceId` is deliberately not persisted: it identifies **one client
* DSH process** and is what the server-side lease uses to tell "my retry" from
* "another process".
*/
/** Prefix DSH profile names carry; the requirements document fixes it. */
const PROFILE_PREFIX = "graydovee-remote-workspace-";
/** The profile-name and path-safe clientId shape. */
const CLIENT_ID_PATTERN = /^[a-z0-9]{12}$/u;
/**
* Generate one clientId.
* @param random - byte source; defaults to `node:crypto`.
* @returns 12 lowercase hex characters.
*/
function generateClientId(random = randomBytes) {
	const bytes = random(6);
	return Buffer.from(bytes).toString("hex");
}
/** Whether a value is a valid v1 clientId. */
function isClientId(value) {
	return CLIENT_ID_PATTERN.test(value);
}
/**
* The DSH profile name for a clientId.
* @throws Error when the clientId is not the v1 shape (never silently sanitize:
*   a wrong profile name would point at another client's profile).
*/
function profileNameFor(clientId) {
	if (!isClientId(clientId)) throw new Error(`invalid clientId ${JSON.stringify(clientId)}`);
	return `${PROFILE_PREFIX}${clientId}`;
}
/** A fresh per-process instance id (UUID v4 by default). */
function generateInstanceId(create = randomUUID) {
	return create();
}
//#endregion
//#region src/targets/store.ts
/** Smallest credential scope/id segments `ctx.credentials` accepts. */
const CREDENTIAL_SCOPE = "remote-workspace";
/** Storage domains reject hyphens; the plugin name cannot be reused here. */
const REMOTE_DOMAIN_NAME = "dsh_remote_workspace";
/**
* Credential id for the client-local model endpoint's API key.
*
* Fixed (not per target): the endpoint is a property of this client host, and
* one key serves every target whose model source is `local`.
*/
const LOCAL_LLM_CREDENTIAL_ID = "client-local-llm";
/** The credential key (`remote-workspace/client-local-llm`) of the local model key. */
function localLlmCredentialKey() {
	return credentialKey(CREDENTIAL_SCOPE, LOCAL_LLM_CREDENTIAL_ID);
}
/**
* One domain holds both tables plus the package-policy global.
*
* Version stays 1 on purpose: the backend's single-file layout has no version
* migration (a stored unit stamped 1 hard-fails to open against a spec
* declaring 2, `compatibleVersions` notwithstanding), and every field this
* plugin has ever added to the record schemas is optional — old documents
* validate under the current schemas unchanged. Additive evolution only.
*/
const REMOTE_DOMAIN = defineDomain({
	name: REMOTE_DOMAIN_NAME,
	version: 1,
	global: {
		schema: packagePolicySettingsSchema,
		initial: {
			policy: "auto",
			mirror: ""
		}
	},
	tables: {
		targets: domainTable(targetRecordSchema),
		workspaces: domainTable(workspaceRecordSchema)
	}
});
/** Thin, typed facade over the storage domain and the credential seam. */
var TargetStore = class {
	ctx;
	domain;
	constructor(ctx) {
		this.ctx = ctx;
	}
	/** Open the domain; call once during plugin startup. */
	async open() {
		if (this.domain !== void 0) return;
		this.domain = await this.ctx.storageDomain.open(REMOTE_DOMAIN);
	}
	/** Close the domain; registration and unloading are the plugin's responsibility. */
	async close() {
		const domain = this.domain;
		this.domain = void 0;
		await domain?.close();
	}
	require() {
		if (this.domain === void 0) throw new Error("remote workspace storage is not open");
		return this.domain;
	}
	/** The whole domain global slot (policy, mirror, clientId, local model settings). */
	globalSettings() {
		return this.require().global.get();
	}
	/** The stored client-local model endpoint settings, when configured. */
	localLlmSettings() {
		return this.globalSettings().localLlm;
	}
	/**
	* Persist or clear the client-local model endpoint settings.
	*
	* The global slot also carries the package policy and the clientId; a write
	* must never drop them (a lost clientId would orphan the server profile).
	* @param settings - validated settings, or undefined to clear.
	*/
	async setLocalLlmSettings(settings) {
		const { localLlm: _previous, ...rest } = this.globalSettings();
		const next = settings === void 0 ? rest : {
			...rest,
			localLlm: settings
		};
		await this.require().global.set(packagePolicySettingsSchema.parse(next));
	}
	/** Read the stored client-local model API key, if one is configured. */
	async localLlmKey() {
		try {
			const stored = await this.ctx.credentials.readRecord(localLlmCredentialKey());
			if (stored === void 0 || stored.kind !== "api-key") return void 0;
			return stored.key === void 0 || stored.key === "" ? void 0 : stored.key;
		} catch {
			return;
		}
	}
	/**
	* Store (or clear) the client-local model API key.
	* @param key - the secret; an empty value removes the stored record.
	*/
	async storeLocalLlmKey(key) {
		if (key === "") {
			await this.forgetLocalLlmKey();
			return;
		}
		await this.ctx.credentials.modifyRecord(localLlmCredentialKey(), async () => ({
			kind: "api-key",
			key
		}));
	}
	/** Remove the stored client-local model API key (absent is a no-op). */
	async forgetLocalLlmKey() {
		await this.ctx.credentials.deleteRecord(localLlmCredentialKey());
	}
	targets() {
		return this.require().table("targets");
	}
	workspaces() {
		return this.require().table("workspaces");
	}
	/** The plugin-wide package-source policy and release mirror. */
	packagePolicy() {
		return this.require().global.get();
	}
	/**
	* Replace the global package-source policy.
	*
	* The clientId lives in the same global slot (additive optional) and must not
	* be dropped by a policy write: a lost clientId would orphan the server's
	* per-client profile on the next connect.
	*/
	async setPackagePolicy(settings) {
		const current = this.globalSettings();
		await this.require().global.set(packagePolicySettingsSchema.parse({
			...settings,
			...settings.clientId === void 0 && current.clientId !== void 0 ? { clientId: current.clientId } : {},
			...settings.localLlm === void 0 && current.localLlm !== void 0 ? { localLlm: current.localLlm } : {}
		}));
	}
	/** The persisted v1 client id, when one has been generated. */
	clientId() {
		const value = this.require().global.get().clientId;
		return value !== void 0 && isClientId(value) ? value : void 0;
	}
	/**
	* Read or lazily generate the installation's client id.
	*
	* The id is stable for the life of this storage domain (and therefore this
	* client installation); every concurrent caller shares one write. A stored
	* malformed value is treated as absent and replaced rather than trusted: the
	* id names a server profile and must be path-safe.
	*/
	async ensureClientId() {
		const existing = this.clientId();
		if (existing !== void 0) return existing;
		this.clientIdAttempt ??= (async () => {
			const current = this.require().global.get();
			const generated = generateClientId();
			await this.require().global.set(packagePolicySettingsSchema.parse({
				...current,
				clientId: generated
			}));
			return generated;
		})();
		try {
			return await this.clientIdAttempt;
		} finally {
			this.clientIdAttempt = void 0;
		}
	}
	/** The in-flight clientId write, so two first-callers cannot generate two ids. */
	clientIdAttempt;
	/** Every stored target, oldest first. */
	listTargets() {
		return [...this.targets().entries()].map(([, value]) => value).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
	}
	/** One target, or undefined. */
	target(id) {
		return this.targets().get(id);
	}
	/** Insert or replace a target record. */
	async putTarget(record) {
		await this.targets().put(record.id, targetRecordSchema.parse(record));
	}
	/** Atomically update a target. */
	async updateTarget(id, mutate) {
		return await this.targets().update(id, (current) => targetRecordSchema.parse(mutate(current)));
	}
	/** Forget a target and its stored secret. */
	async deleteTarget(id) {
		const record = this.target(id);
		if (record !== void 0) await this.forgetSecret(record);
		await this.targets().delete(id);
	}
	/** Every stored remote workspace ref, newest activity first. */
	listWorkspaces(targetId) {
		return [...this.workspaces().entries()].map(([, value]) => value).filter((record) => targetId === void 0 || record.targetId === targetId).sort((left, right) => (right.lastOpenedAt ?? right.createdAt ?? right.id).localeCompare(left.lastOpenedAt ?? left.createdAt ?? left.id));
	}
	/** One workspace ref by local id, or by its server workspace id (P2: both keys are legal). */
	workspace(id) {
		const direct = this.workspaces().get(id);
		if (direct !== void 0) return direct;
		return [...this.workspaces().entries()].map(([, value]) => value).find((record) => record.remoteWorkspaceId === id);
	}
	/** Insert or replace a workspace record. */
	async putWorkspace(record) {
		await this.workspaces().put(record.id, workspaceRecordSchema.parse(record));
	}
	/** Atomically update a workspace. */
	async updateWorkspace(id, mutate) {
		return await this.workspaces().update(id, (current) => workspaceRecordSchema.parse(mutate(current)));
	}
	/** Forget a workspace record. */
	async deleteWorkspace(id) {
		return await this.workspaces().delete(id);
	}
	/** The credential key for one target's secret, or undefined when it has none. */
	credentialKeyOf(record) {
		return record.credentialKey === void 0 ? void 0 : credentialKey(CREDENTIAL_SCOPE, record.id);
	}
	/**
	* Store a target's secret.
	* @param record - target record to extend.
	* @param secret - password, key passphrase or token; an empty value clears it.
	* @returns the record with its credential reference set or cleared.
	*/
	async storeSecret(record, secret) {
		const key = credentialKey(CREDENTIAL_SCOPE, record.id);
		if (secret === "") {
			await this.ctx.credentials.deleteRecord(key);
			const { credentialKey: _cleared, ...rest } = record;
			return rest;
		}
		await this.ctx.credentials.modifyRecord(key, async () => ({
			kind: "api-key",
			key: secret
		}));
		return {
			...record,
			credentialKey: key
		};
	}
	/**
	* Read a target's secret, if one is stored and still configured.
	* @param record - target record.
	* @returns the secret value, or undefined.
	*/
	async secretOf(record) {
		const key = this.credentialKeyOf(record);
		if (key === void 0) return void 0;
		const stored = await this.ctx.credentials.readRecord(key);
		if (stored === void 0 || stored.kind !== "api-key") return void 0;
		return stored.key === void 0 || stored.key === "" ? void 0 : stored.key;
	}
	/** Remove any stored secret for a target. */
	async forgetSecret(record) {
		const key = this.credentialKeyOf(record);
		if (key !== void 0) await this.ctx.credentials.deleteRecord(key);
	}
};
//#endregion
//#region src/targets/methods.ts
/**
* Which `DSH_HOME` a reconnect of a saved target should ask for.
*
* The wizard's DSH_HOME is optional, so the value worth reusing is the one the
* previous connect resolved (remote `dshHome`, always absolute). Reusing it keeps
* the profile patch, the profile server and the reverse tunnel in the same
* directory; falling back to the remote default instead would leave the previous
* bridge port in a profile that no longer belongs to this connection.
*
* `~`-relative defaults are not reused: the host never expands them, so the
* remote scan decides what the home really is.
* @param savedRemoteDshHome - `dshHome` recorded by the last successful connect.
* @param requested - explicit DSH_HOME from the request body, when present.
* @returns the DSH_HOME to pass to the connect request, or undefined for the scan default.
*/
function reconnectDshHome(savedRemoteDshHome, requested) {
	if (requested !== void 0) return requested;
	return savedRemoteDshHome.startsWith("/") ? savedRemoteDshHome : void 0;
}
//#endregion
//#region src/ssh/hostkey.ts
/**
* Remote host-key verification.
*
* An unknown host key is never accepted silently: the wizard must show the
* fingerprint and the user must confirm it, after which it is pinned in the
* target record. A changed key is always refused. `known_hosts` is an optional
* convenience for *filling* that fingerprint, never a bypass.
*/
/** OpenSSH-style SHA-256 fingerprint of a raw host key. */
function fingerprintOf(key) {
	return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}
/** A host key differing from the pinned one; never recoverable by retrying. */
var HostKeyMismatchError = class extends Error {
	expected;
	actual;
	code = "REMOTE_HOST_KEY_CHANGED";
	constructor(expected, actual) {
		super(`remote host key changed: expected ${expected}, received ${actual}`);
		this.expected = expected;
		this.actual = actual;
		this.name = "HostKeyMismatchError";
	}
};
/** The host key is not pinned yet; the caller must confirm the fingerprint first. */
var HostKeyUnknownError = class extends Error {
	fingerprint;
	code = "REMOTE_HOST_KEY_UNKNOWN";
	constructor(fingerprint) {
		super(`unverified remote host key ${fingerprint}; confirm the fingerprint and connect again`);
		this.fingerprint = fingerprint;
		this.name = "HostKeyUnknownError";
	}
};
/**
* Build ssh2's `hostVerifier` for one target.
*
* ssh2 calls this synchronously from the key-exchange state machine and only
* understands `boolean` (or `undefined` for async verification). Throwing out
* of it aborts the packet parser while the exchange is still half finished, so
* the server's trailing NEWKEYS packet then crashes the client with
* "Received packet 21 instead of 31" — in this host that uncaught protocol
* error takes down the whole DSH process. Answer `false` instead: ssh2
* disconnects cleanly, and the typed reason travels out of band to the caller.
* @param pinned - the confirmed fingerprint, or undefined for first contact.
* @param onReject - receives the typed rejection (anonymous or changed key).
* @returns a verifier that reports the fingerprint instead of silently trusting it.
*/
function hostVerifier(pinned, onReject) {
	return (key) => {
		const actual = fingerprintOf(key);
		if (pinned === void 0) {
			onReject?.(new HostKeyUnknownError(actual));
			return false;
		}
		if (pinned !== actual) {
			onReject?.(new HostKeyMismatchError(pinned, actual));
			return false;
		}
		return true;
	};
}
/** Default OpenSSH known_hosts path. */
function knownHostsPath() {
	return join(homedir(), ".ssh", "known_hosts");
}
/**
* Find a plain-text `known_hosts` fingerprint for one host.
*
* Hashed entries (`|1|…`) cannot be matched without their host salt and are
* skipped; the caller then falls back to explicit confirmation.
* @param host - hostname or address.
* @param port - port; a non-default port matches OpenSSH's `[host]:port` form.
* @param path - known_hosts file, defaulting to the user's.
* @returns the fingerprint, or undefined when no plain-text entry matches.
*/
async function lookupKnownHost(host, port, path = knownHostsPath()) {
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch {
		return;
	}
	const names = new Set(port === 22 ? [host] : [`[${host}]:${port}`]);
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (line === "" || line.startsWith("#") || line.startsWith("|")) continue;
		const [hosts, keyType, key] = line.split(/\s+/);
		if (hosts === void 0 || keyType === void 0 || key === void 0) continue;
		if (!hosts.split(",").some((name) => names.has(name))) continue;
		const decoded = Buffer.from(key, "base64");
		if (decoded.length === 0) continue;
		return fingerprintOf(decoded);
	}
}
//#endregion
//#region src/provision/version-range.ts
/**
* The dsh runtimes this plugin has verified, and the comparison used to word a
* rejection.
*
* The contract is a *membership* test, not a version range: a remote launcher is
* usable when its version is exactly one of {@link DSH_VERIFIED_RUNTIMES}. The
* list is kept in lockstep with `package.json` (`engines.dsh` and every
* `@deepseek-ai/dsh-*` peer) by `tests/release-contract.test.ts`; widening it is
* a release action that adds an entry after that runtime has been exercised.
*
* Why not a range: an upper bound such as `<0.3.0` promises compatibility with
* releases that do not exist yet, and a range also admits unverified
* prereleases inside it (`rc.3` between `rc.2` and `rc.4`). DSH is a developer
* preview, so a breaking change can land in any release.
*
* Why not `semver`: a second, *mutable* parser in the dependency tree has
* already cost this repo real pain (`zod` had to be pinned to an exact version
* because a duplicate copy made `tsc` OOM, see AGENTS.md). The code below covers
* the semantics we need, and the prerelease ordering is unit-tested — that is
* the part a naive `localeCompare` gets wrong (`rc.10` vs `rc.2`).
*/
/** The dsh runtimes this client has verified. Membership decides; never a range. */
const DSH_VERIFIED_RUNTIMES = ["0.2.1-rc.3"];
DSH_VERIFIED_RUNTIMES.join(" / ");
/**
* The first version-looking token in a line of text.
*
* `dsh --version` prints the bare version, but a wrapper script may prefix or
* decorate it (`dsh 0.2.1-rc.2`, `v0.2.1-rc.2`), so the leading `v` is optional
* and the match is not anchored to the start of the line.
*/
const VERSION_PATTERN = /v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;
/**
* Parse one dsh version out of arbitrary text.
* @param text - a version line, possibly with noise around the number.
* @returns the parsed version, or undefined when no version-shaped token exists.
*/
function parseDshVersion(text) {
	const match = VERSION_PATTERN.exec(text);
	if (match === null) return void 0;
	const major = match[1];
	const minor = match[2];
	const patch = match[3];
	if (major === void 0 || minor === void 0 || patch === void 0) return void 0;
	const prerelease = (match[4] ?? "").split(".").filter((segment) => segment !== "");
	return {
		major: Number.parseInt(major, 10),
		minor: Number.parseInt(minor, 10),
		patch: Number.parseInt(patch, 10),
		prerelease
	};
}
/** Numeric identifier test for prerelease segments (`2` vs `rc`). */
const NUMERIC_ID = /^\d+$/;
/**
* Total order over parsed versions (semver 2.0 precedence).
*
* 1. numeric major/minor/patch;
* 2. a release outranks any prerelease of the same triple;
* 3. prerelease identifiers compare element-wise: numeric vs numeric by value,
*    both alphanumeric by ASCII order, numeric **below** alphanumeric;
* 4. a shorter identifier list that prefixes the other is smaller
*    (`rc.2 < rc.2.1`).
*
* Used only to word a rejection and to rank scan candidates; the gate itself is
* the membership test in {@link isCompatibleDsh}.
*
* @returns negative when `a < b`, 0 when equal, positive when `a > b`.
*/
function compareDshVersion(a, b) {
	for (const key of [
		"major",
		"minor",
		"patch"
	]) if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
	if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
	if (a.prerelease.length === 0) return 1;
	if (b.prerelease.length === 0) return -1;
	const shared = Math.max(a.prerelease.length, b.prerelease.length);
	for (let index = 0; index < shared; index++) {
		const left = a.prerelease[index];
		const right = b.prerelease[index];
		if (left === void 0) return -1;
		if (right === void 0) return 1;
		const numericLeft = NUMERIC_ID.test(left);
		const numericRight = NUMERIC_ID.test(right);
		if (numericLeft && numericRight) {
			const delta = Number.parseInt(left, 10) - Number.parseInt(right, 10);
			if (delta !== 0) return delta < 0 ? -1 : 1;
			continue;
		}
		if (numericLeft !== numericRight) return numericLeft ? -1 : 1;
		if (left !== right) return left < right ? -1 : 1;
	}
	return 0;
}
/**
* Canonical spelling of a parsed version: `major.minor.patch[-prerelease]`.
*
* Build metadata and a leading `v` are not part of the identity, so
* `v0.2.1-rc.2+build.7` normalizes to the string the verified list carries.
* @param version - the parsed version.
* @returns the canonical text.
*/
function formatDshVersion(version) {
	const core = `${version.major}.${version.minor}.${version.patch}`;
	return version.prerelease.length === 0 ? core : `${core}-${version.prerelease.join(".")}`;
}
/**
* Whether a version line names a dsh release this plugin can drive remotely.
*
* This is a membership test over {@link DSH_VERIFIED_RUNTIMES}; unparseable text
* is never a member.
* @param text - whatever `dsh --version` (or a scan record) printed.
* @returns true only for a verified runtime.
*/
function isCompatibleDsh(text) {
	const version = parseDshVersion(text);
	if (version === void 0) return false;
	return DSH_VERIFIED_RUNTIMES.includes(formatDshVersion(version));
}
/** The verified runtimes as parsed versions, computed once. */
const VERIFIED = DSH_VERIFIED_RUNTIMES.map((text) => parseDshVersion(text)).filter((version) => version !== void 0);
VERIFIED.reduce((low, current) => compareDshVersion(current, low) < 0 ? current : low);
VERIFIED.reduce((high, current) => compareDshVersion(current, high) > 0 ? current : high);
/** Server plugin route prefix (protocol §4.1). */
const PLUGIN_ROUTE_PREFIX = "/dsh-remote-workspace-server";
/** P1 route table. */
const PLUGIN_ROUTES = {
	handshake: `${PLUGIN_ROUTE_PREFIX}/api/handshake`,
	rpc: `${PLUGIN_ROUTE_PREFIX}/api/rpc`,
	events: `${PLUGIN_ROUTE_PREFIX}/api/events`,
	sessionEvents: `${PLUGIN_ROUTE_PREFIX}/api/session/events`,
	mux: `${PLUGIN_ROUTE_PREFIX}/api/mux`,
	bootstrap: `${PLUGIN_ROUTE_PREFIX}/embed/bootstrap.js`,
	embedCss: `${PLUGIN_ROUTE_PREFIX}/embed/embed.css`
};
/** A coded P1 failure; `code` is the stable wire code (protocol §12). */
var RemotePluginError = class extends Error {
	status;
	details;
	constructor(code, message, options = {}) {
		super(scrubSecrets(message));
		this.name = "RemotePluginError";
		this.code = code;
		this.status = options.status ?? 500;
		this.details = options.details;
	}
	/** The stable code (separate field so `instanceof` across bundles is unnecessary). */
	code;
};
/** Whether an unknown error is a coded P1 failure. */
function isRemotePluginError(error) {
	return error instanceof RemotePluginError;
}
/** Parse and validate one envelope, throwing a coded error for failures. */
function parsePluginEnvelope(status, text, context) {
	let parsed;
	try {
		parsed = text === "" ? void 0 : JSON.parse(text);
	} catch {
		if (status === 404) throw new RemotePluginError("plugin-missing", `the server plugin is not installed on the remote profile (${context})`, { status: 404 });
		throw new RemotePluginError("internal", `the server plugin answered with non-JSON (${context}, HTTP ${status})`, { status });
	}
	const envelope = parsed;
	if (envelope === void 0 || typeof envelope !== "object" || typeof envelope.ok !== "boolean") throw new RemotePluginError("internal", `the server plugin answered with an invalid envelope (${context})`, { status });
	if (envelope.ok) {
		if (!("value" in envelope)) throw new RemotePluginError("internal", `the server plugin answered ok without a value (${context})`, { status });
		return envelope.value;
	}
	const error = envelope.error ?? {};
	const code = typeof error.code === "string" && error.code !== "" ? error.code : "internal";
	throw new RemotePluginError(code, typeof error.message === "string" && error.message !== "" ? error.message : `${code} (${context})`, {
		status,
		...error.details === void 0 ? {} : { details: error.details }
	});
}
/** Map a transport failure onto the protocol's error vocabulary. */
function mapTransportFailure(error, context) {
	if (isRemotePluginError(error)) return error;
	const coded = error;
	if (coded.name === "AbortError") return new RemotePluginError("timeout", `${context} was cancelled or timed out`, { status: 504 });
	if (coded.code === "upstream-timeout") return new RemotePluginError("timeout", `${context} timed out`, { status: 504 });
	return new RemotePluginError("tunnel-unavailable", `${context} failed: ${typeof coded.message === "string" && coded.message !== "" ? coded.message : String(error)}`, { status: 503 });
}
/**
* Incremental SSE decoder (text/event-stream).
*
* Kept as a class rather than a generator so tests can feed arbitrary chunk
* boundaries; `data:` lines are joined with `\n`, comments (`: ping`) are
* ignored, and a final unterminated frame is dropped (the stream ended).
*/
var SseDecoder = class {
	buffer = "";
	/** Feed one chunk; returns every frame completed by it. */
	push(chunk) {
		this.buffer += chunk.replace(/\r\n/gu, "\n");
		const events = [];
		for (;;) {
			const boundary = this.buffer.indexOf("\n\n");
			if (boundary === -1) break;
			const raw = this.buffer.slice(0, boundary);
			this.buffer = this.buffer.slice(boundary + 2);
			const event = decodeSseFrame(raw);
			if (event !== void 0) events.push(event);
		}
		return events;
	}
	/** Whether an unterminated frame is buffered (for diagnostics/tests). */
	get pending() {
		return this.buffer;
	}
};
/** Decode one `\n`-separated SSE frame, ignoring comments/empty frames. */
function decodeSseFrame(raw) {
	let event = "message";
	const data = [];
	for (const line of raw.split("\n")) {
		if (line === "" || line.startsWith(":")) continue;
		const at = line.indexOf(":");
		const field = at === -1 ? line : line.slice(0, at);
		let value = at === -1 ? "" : line.slice(at + 1);
		if (value.startsWith(" ")) value = value.slice(1);
		if (field === "event") event = value;
		else if (field === "data") data.push(value);
	}
	if (data.length === 0) return void 0;
	return {
		event,
		data: data.join("\n")
	};
}
/** Iterate decoded SSE frames from a byte/string stream. */
async function* iterateSse(body) {
	const decoder = new SseDecoder();
	for await (const chunk of body) for (const event of decoder.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"))) yield event;
}
/** Query one v2 session event stream (afterSeq is exclusive/inclusive per server). */
function sessionEventsPath(options) {
	const query = new URLSearchParams({ sessionId: options.sessionId });
	if (options.afterSeq !== void 0 && Number.isFinite(options.afterSeq)) query.set("afterSeq", String(Math.trunc(options.afterSeq)));
	return `${PLUGIN_ROUTES.sessionEvents}?${query.toString()}`;
}
/** Headers every P1 request carries (protocol §4.1). */
function pluginRequestHeaders(options) {
	return {
		...options.cookie === void 0 || options.cookie === "" ? {} : { cookie: options.cookie },
		...options.contentType === void 0 ? {} : { "content-type": options.contentType },
		"x-dsh-rw-client": options.clientId,
		"x-dsh-rw-instance": options.instanceId,
		"x-dsh-rw-protocol": String(options.protocol ?? 1)
	};
}
/** The upgrade request headers for the execution-world mux (protocol §7.1). */
function muxUpgradeHeaders(options) {
	return {
		connection: "Upgrade",
		upgrade: "websocket",
		"sec-websocket-version": "13",
		"sec-websocket-key": options.key,
		"x-dsh-rw-client": options.clientId,
		"x-dsh-rw-instance": options.instanceId,
		"x-dsh-rw-protocol": String(1),
		...options.cookie === void 0 || options.cookie === "" ? {} : { cookie: options.cookie }
	};
}
/**
* One target's P1 client.
*
* Stateless with respect to leases: `handshake()` records the latest lease for
* diagnostics, but every call sends the identity headers and the server decides.
*/
var RemotePluginClient = class {
	options;
	cookieHeader;
	lease;
	profileName = "";
	capabilitiesValue;
	constructor(options) {
		this.options = options;
		this.cookieHeader = options.cookie;
	}
	/** Replace the official cookie (after a profile restart the port/authority changes). */
	setCookie(cookie) {
		this.cookieHeader = cookie;
	}
	/** The lease last returned by `handshake` (diagnostics only). */
	get leaseState() {
		return this.lease;
	}
	/** The capabilities advertised by the last handshake. */
	get capabilities() {
		return this.capabilitiesValue;
	}
	/** The server profile this client handshook with. */
	get profile() {
		return this.profileName;
	}
	get timeoutMs() {
		return this.options.requestTimeoutMs ?? 3e4;
	}
	headers(contentType) {
		return pluginRequestHeaders({
			clientId: this.options.clientId,
			instanceId: this.options.instanceId,
			...this.cookieHeader === void 0 ? {} : { cookie: this.cookieHeader },
			...contentType === void 0 ? {} : { contentType }
		});
	}
	/** `POST /api/handshake`; on success the lease and capabilities are recorded. */
	async handshake(request, signal) {
		const body = {
			protocol: 1,
			pluginVersion: this.options.pluginVersion ?? "",
			clientId: this.options.clientId,
			instanceId: this.options.instanceId,
			profile: request.profile,
			...request.capabilities === void 0 ? {} : { capabilities: request.capabilities }
		};
		const parsed = parseHandshakeResponse(await this.call("POST", PLUGIN_ROUTES.handshake, body, signal));
		this.profileName = parsed.profile;
		this.lease = parsed.lease;
		this.capabilitiesValue = parsed.capabilities;
		return parsed;
	}
	/** One P1 RPC (protocol §4.1/§4.2). */
	async rpc(method, params = {}, signal) {
		const response = await this.call("POST", PLUGIN_ROUTES.rpc, {
			protocol: 1,
			method,
			params
		}, signal);
		return parsePluginEnvelope(response.status, response.body.toString("utf8"), `P1 ${method}`);
	}
	/** `profile/heartbeat`; returns the lease expiry and registry revision facts. */
	async heartbeat(signal) {
		return await this.rpc("profile/heartbeat", {}, signal);
	}
	/** `profile/release`; best effort on disconnect. */
	async release(signal) {
		await this.rpc("profile/release", {}, signal);
	}
	/** `profile/cancel-all`; the disconnect path cancels every live turn (protocol §3.6). */
	async cancelAll(signal) {
		return await this.rpc("profile/cancel-all", {}, signal);
	}
	/** Subscribe to the P1 SSE stream (protocol §6). */
	async *events(signal) {
		if (this.options.transport.stream === void 0) throw new RemotePluginError("internal", "the P1 transport does not support streaming");
		let response;
		try {
			response = await this.options.transport.stream({
				method: "GET",
				path: PLUGIN_ROUTES.events,
				headers: this.headers(),
				timeoutMs: this.timeoutMs,
				...signal === void 0 ? {} : { signal }
			});
		} catch (error) {
			throw mapTransportFailure(error, "P1 events");
		}
		if (response.status !== 200) {
			const chunks = [];
			for await (const chunk of response.body) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
			parsePluginEnvelope(response.status, Buffer.concat(chunks).toString("utf8"), "P1 events");
			return;
		}
		yield* iterateSse(response.body);
	}
	/**
	* v2 session event SSE (`GET /api/session/events`).
	*
	* The host forwards these frames to its own same-origin EventSource. A
	* reconnect with `afterSeq` is the caller's job: this method only exposes the
	* exact frames the server sent, in order.
	*/
	async *sessionEvents(options) {
		if (this.options.transport.stream === void 0) throw new RemotePluginError("internal", "the P1 transport does not support streaming");
		let response;
		try {
			response = await this.options.transport.stream({
				method: "GET",
				path: sessionEventsPath(options),
				headers: this.headers(),
				timeoutMs: this.timeoutMs,
				...options.signal === void 0 ? {} : { signal: options.signal }
			});
		} catch (error) {
			throw mapTransportFailure(error, "P1 session events");
		}
		if (response.status !== 200) {
			const chunks = [];
			for await (const chunk of response.body) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
			parsePluginEnvelope(response.status, Buffer.concat(chunks).toString("utf8"), "P1 session events");
			return;
		}
		yield* iterateSse(response.body);
	}
	/** Open the raw execution-world WebSocket upgrade (protocol §7). */
	async openMux(options) {
		if (this.options.transport.upgrade === void 0) throw new RemotePluginError("internal", "the P1 transport does not support upgrades");
		try {
			const response = await this.options.transport.upgrade({
				method: "GET",
				path: PLUGIN_ROUTES.mux,
				headers: muxUpgradeHeaders({
					clientId: this.options.clientId,
					instanceId: this.options.instanceId,
					...this.cookieHeader === void 0 ? {} : { cookie: this.cookieHeader },
					key: options.key
				}),
				timeoutMs: this.timeoutMs,
				...options.signal === void 0 ? {} : { signal: options.signal }
			});
			if (response.status !== 101) throw new RemotePluginError("tunnel-unavailable", `the execution-world mux upgrade was refused (HTTP ${response.status})`, { status: response.status });
			return response;
		} catch (error) {
			throw mapTransportFailure(error, "P1 mux upgrade");
		}
	}
	/** Perform one raw HTTP call through the transport with the shared headers. */
	async call(method, path, body, signal) {
		let response;
		try {
			response = await this.options.transport.request({
				method,
				path,
				headers: this.headers("application/json"),
				body: Buffer.from(JSON.stringify(body), "utf8"),
				timeoutMs: this.timeoutMs,
				...signal === void 0 ? {} : { signal }
			});
		} catch (error) {
			throw mapTransportFailure(error, `P1 ${method} ${path}`);
		}
		return response;
	}
};
/** Validate a handshake response enough to fail closed on a wrong shape. */
function parseHandshakeResponse(response) {
	const text = response.body.toString("utf8");
	const value = parsePluginEnvelope(response.status, text, "P1 handshake");
	if (value === null || typeof value !== "object") throw new RemotePluginError("internal", "the handshake value is not an object", { status: response.status });
	const parsed = value;
	if (parsed.protocol !== 1) throw new RemotePluginError("plugin-protocol-mismatch", `the server plugin speaks protocol ${String(parsed.protocol)}, this client requires 1`, {
		status: response.status,
		details: {
			clientProtocol: 1,
			serverProtocol: parsed.protocol
		}
	});
	if (typeof parsed.pluginVersion !== "string" || typeof parsed.dshVersion !== "string" || typeof parsed.profile !== "string" || typeof parsed.clientId !== "string" || parsed.lease === void 0 || typeof parsed.lease !== "object" || typeof parsed.lease.instanceId !== "string" || typeof parsed.lease.expiresAt !== "string") throw new RemotePluginError("internal", "the handshake response is missing required fields", { status: response.status });
	return parsed;
}
//#endregion
//#region src/portal/proxy.ts
/**
* P2 portal: the client host's same-origin reverse proxy to one profile server.
*
* The browser only ever talks to the client's own origin:
*
*   /dsh-remote-workspace/portal/<targetId>/…        → 127.0.0.1:<profilePort>/…
*   /dsh-remote-workspace/portal/<targetId>/api/remote.mux (WS, exact) → /api/remote.mux
*
* The rules in protocol §8.2 are all load-bearing and live in pure helpers so
* they can be asserted without a browser or an SSH server:
*
* - the upstream `Host` is rewritten to `127.0.0.1:<profilePort>`; forwarding the
*   browser authority would make the official cookie's authority equal the client
*   origin and collide with the client GUI's own `dsh-auth-*` cookie;
* - `Origin` and `Referer` are dropped;
* - the browser's cookies are dropped and the official cookie is injected;
* - `Set-Cookie` is never sent back to the browser;
* - bodies and SSE are streamed, not buffered;
* - the upstream WebSocket upgrade is connected through the same tunnel.
*
* The SSH/HTTP transport is injected ({@link PortalUpstream}); production wires
* `SshForwarder` from `src/ssh/forward.ts`, tests use a loopback server.
*/
/** Portal route base (protocol §8.1). */
const PORTAL_BASE = "/dsh-remote-workspace/portal";
/** Where the official UI's execution-world WebSocket lives, relative to a portal mount. */
const PORTAL_MUX_PATH = "api/remote.mux";
/** A coded portal failure (protocol §8.3/§12). */
var PortalError = class extends Error {
	code;
	status;
	constructor(code, message, status) {
		super(scrubSecrets(message));
		this.code = code;
		this.status = status;
		this.name = "PortalError";
	}
};
/** The mount path for one target: always ends with `/`. */
function portalPath(targetId) {
	return `${PORTAL_BASE}/${encodeURIComponent(targetId)}/`;
}
/** The exact WebSocket upgrade path for one target. */
function portalMuxPath(targetId) {
	return `${portalPath(targetId)}${PORTAL_MUX_PATH}`;
}
/**
* Strip one mount prefix and keep the query string untouched (protocol §8.1).
* @returns the upstream request path (`/` for the mount root), or undefined when
*   the URL is not this mount.
*/
function stripPortalPrefix(rawUrl, targetId) {
	const base = `${PORTAL_BASE}/${encodeURIComponent(targetId)}`;
	const url = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
	if (url === base || url === `${base}/`) return "/";
	if (!url.startsWith(`${base}/`)) return void 0;
	return url.slice(base.length);
}
/** Hop-by-hop headers Node's HTTP client must not forward between connections. */
const HOP_BY_HOP = /* @__PURE__ */ new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade"
]);
/**
* Build the upstream request headers.
*
* `Host` is the profile server's own authority, `Origin`/`Referer` disappear, the
* browser cookie is replaced by the official one, and hop-by-hop headers are
* dropped. `sec-fetch-site` is passed through on purpose (the official fence only
* refuses `cross-site`, and the browser's same-origin value is truthful).
*/
function portalUpstreamHeaders(input, options) {
	const out = {};
	for (const [name, value] of Object.entries(input)) {
		if (value === void 0) continue;
		const lower = name.toLowerCase();
		if (lower === "host" || lower === "origin" || lower === "referer" || lower === "cookie") continue;
		if (HOP_BY_HOP.has(lower)) continue;
		out[lower] = value;
	}
	out.host = `127.0.0.1:${options.upstreamPort}`;
	if (options.cookie !== void 0 && options.cookie !== "") out.cookie = options.cookie;
	return out;
}
/**
* Build the downstream response headers: everything except `Set-Cookie`.
*
* The browser must never hold the profile server's cookie; the portal injects it
* on the upstream leg instead (§8.2).
*/
function portalResponseHeaders(input) {
	const out = {};
	for (const [name, value] of Object.entries(input)) {
		if (value === void 0) continue;
		if (name.toLowerCase() === "set-cookie") continue;
		out[name] = typeof value === "string" ? value : [...value];
	}
	return out;
}
/** Write the plugin JSON error envelope for a portal failure. */
function writePortalError(res, error) {
	if (res.headersSent) {
		res.destroy();
		return;
	}
	const body = JSON.stringify({
		ok: false,
		error: {
			code: error.code,
			message: error.message
		}
	});
	res.writeHead(error.status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(body);
}
/** One target's portal proxy. */
var PortalProxy = class {
	targetId;
	upstream;
	cookie;
	closed = false;
	timeoutMs;
	constructor(targetId, upstream, cookie, options = {}) {
		this.targetId = targetId;
		this.upstream = upstream;
		this.cookie = cookie;
		this.timeoutMs = options.timeoutMs ?? 1e4;
	}
	/** Forward one HTTP request (all methods; body and response are streamed). */
	async handleRequest(req, res) {
		if (this.closed) {
			writePortalError(res, new PortalError("target-not-connected", `remote target "${this.targetId}" is not connected`, 404));
			return;
		}
		const path = stripPortalPrefix(req.url ?? "/", this.targetId);
		if (path === void 0) {
			writePortalError(res, new PortalError("bad-request", `not a portal mount for "${this.targetId}"`, 400));
			return;
		}
		const headers = portalUpstreamHeaders(req.headers, {
			upstreamPort: this.upstream.port,
			...this.cookie === void 0 ? {} : { cookie: this.cookie }
		});
		const upstreamRequest = request({
			host: this.upstream.host,
			port: this.upstream.port,
			method: req.method ?? "GET",
			path,
			headers,
			agent: this.upstream.agent
		});
		let settled = false;
		let timer;
		const fail = (error) => {
			if (settled) return;
			settled = true;
			if (timer !== void 0) clearTimeout(timer);
			upstreamRequest.destroy();
			if (!res.headersSent) writePortalError(res, error);
			else res.destroy();
		};
		timer = setTimeout(() => {
			fail(new PortalError("upstream-timeout", `the profile server did not answer within ${this.timeoutMs} ms`, 502));
		}, this.timeoutMs);
		timer.unref?.();
		req.once("error", () => {
			fail(new PortalError("tunnel-unavailable", "the downstream request failed", 503));
		});
		req.once("aborted", () => {
			fail(new PortalError("tunnel-unavailable", "the downstream request was aborted", 503));
		});
		res.once("close", () => {
			if (!res.writableEnded) upstreamRequest.destroy();
		});
		upstreamRequest.once("error", (error) => {
			if (error.code === "upstream-timeout") fail(new PortalError("upstream-timeout", this.timeoutMsMessage(), 502));
			else fail(new PortalError("tunnel-unavailable", `the tunnel to the profile server failed: ${error.message}`, 503));
		});
		upstreamRequest.once("response", (upstreamResponse) => {
			if (settled) {
				upstreamResponse.destroy();
				return;
			}
			settled = true;
			if (timer !== void 0) clearTimeout(timer);
			res.writeHead(upstreamResponse.statusCode ?? 502, portalResponseHeaders(upstreamResponse.headers));
			upstreamResponse.once("error", () => {
				res.destroy();
			});
			upstreamResponse.pipe(res);
		});
		req.pipe(upstreamRequest);
	}
	/**
	* Forward the exact WebSocket upgrade path.
	*
	* A manual upgrade request is written to a fresh forwarded channel because the
	* official UI's WS endpoint is not an HTTP resource Node's client can upgrade
	* through an agent without buffering semantics; then the two sockets are piped
	* byte-for-byte.
	*/
	async handleUpgrade(req, socket, head) {
		const fail = (error) => {
			if (!socket.destroyed && !socket.writableEnded) socket.end(`HTTP/1.1 ${error.status} ${error.code}\r\ncontent-type: application/json; charset=utf-8\r\ncontent-length: ${Buffer.byteLength(JSON.stringify({
				ok: false,
				error: {
					code: error.code,
					message: error.message
				}
			}))}\r\nconnection: close\r\n\r\n${JSON.stringify({
				ok: false,
				error: {
					code: error.code,
					message: error.message
				}
			})}`);
			else socket.destroy();
		};
		if (this.closed) {
			fail(new PortalError("target-not-connected", `remote target "${this.targetId}" is not connected`, 404));
			return;
		}
		const rawUrl = req.url ?? "/";
		if (rawUrl !== portalMuxPath(this.targetId)) {
			fail(new PortalError("bad-request", `unknown portal upgrade path ${JSON.stringify(rawUrl)}`, 400));
			return;
		}
		let upstream;
		try {
			upstream = await this.upstream.connect();
		} catch (error) {
			fail(new PortalError("tunnel-unavailable", `the tunnel to the profile server failed: ${error instanceof Error ? error.message : String(error)}`, 503));
			return;
		}
		upstream.once("error", () => socket.destroy());
		upstream.once("close", () => socket.destroy());
		socket.once("error", () => upstream.destroy());
		socket.once("close", () => upstream.destroy());
		const headers = {
			host: `127.0.0.1:${this.upstream.port}`,
			connection: "Upgrade",
			upgrade: "websocket",
			"sec-websocket-version": "13",
			...typeof req.headers["sec-websocket-key"] === "string" ? { "sec-websocket-key": req.headers["sec-websocket-key"] } : {},
			...typeof req.headers["sec-websocket-protocol"] === "string" ? { "sec-websocket-protocol": req.headers["sec-websocket-protocol"] } : {},
			...this.cookie === void 0 || this.cookie === "" ? {} : { cookie: this.cookie }
		};
		const requestText = [
			`GET /${PORTAL_MUX_PATH} HTTP/1.1`,
			...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
			"",
			""
		].join("\r\n");
		upstream.write(requestText);
		if (head.length > 0) upstream.write(head);
		let received = Buffer.alloc(0);
		const timer = setTimeout(() => {
			fail(new PortalError("upstream-timeout", `the mux upgrade did not answer within ${this.timeoutMs} ms`, 502));
			upstream.destroy();
			socket.destroy();
		}, this.timeoutMs);
		timer.unref?.();
		const onUpstreamData = (chunk) => {
			received = Buffer.concat([received, chunk]);
			const end = received.indexOf("\r\n\r\n");
			if (end === -1) {
				if (received.length > 32768) {
					clearTimeout(timer);
					fail(new PortalError("tunnel-unavailable", "the mux upgrade response headers are too large", 503));
					upstream.destroy();
				}
				return;
			}
			clearTimeout(timer);
			upstream.off("data", onUpstreamData);
			const statusLine = received.subarray(0, received.indexOf("\r\n")).toString("utf8");
			const status = Number.parseInt(statusLine.split(" ")[1] ?? "0", 10);
			const rest = received.subarray(end + 4);
			if (status !== 101) {
				fail(new PortalError("tunnel-unavailable", `the mux upgrade was refused (HTTP ${status})`, 502));
				upstream.destroy();
				return;
			}
			socket.write(received.subarray(0, end + 4));
			if (rest.length > 0) socket.write(rest);
			upstream.pipe(socket);
			socket.pipe(upstream);
		};
		upstream.on("data", onUpstreamData);
	}
	/** Mark the portal closed; subsequent requests answer `target-not-connected`. */
	close() {
		this.closed = true;
	}
	/** Whether this proxy still forwards. */
	get live() {
		return !this.closed;
	}
	timeoutMsMessage() {
		return `the profile server did not answer within ${this.timeoutMs} ms`;
	}
};
//#endregion
//#region src/ssh/connect.ts
/**
* ssh2 transport: connection, host-key pinning, remote execution and upload.
*
* `ssh2` (pure JavaScript) is used instead of the `ssh` binary so a password or
* key can be supplied by the wizard, the host key can be pinned explicitly, and
* the protocol channel needs no ControlMaster socket or sshd stream-local
* forwarding.
*/
/** The server rejected every offered authentication method. */
var SshAuthError = class extends Error {
	host;
	username;
	code = "ssh-auth-failed";
	constructor(host, username) {
		super(`SSH authentication failed for ${username}@${host}: the server rejected the configured password/private key/agent. Check the credentials or switch the authentication method.`);
		this.host = host;
		this.username = username;
		this.name = "SshAuthError";
	}
};
/** Error carrying whatever the remote printed, with secrets scrubbed. */
var RemoteCommandError = class extends Error {
	detail;
	code = "REMOTE_COMMAND_FAILED";
	constructor(message, detail) {
		super(message);
		this.detail = detail;
		this.name = "RemoteCommandError";
	}
};
/**
* Connect and verify the host key.
* @param options - host, credentials and the pinned fingerprint.
* @returns a ready ssh2 client; the caller owns `end()`.
* @throws HostKeyUnknownError on first contact, HostKeyMismatchError on a changed key.
*/
async function connectSsh(options) {
	const client = new Client();
	let hostKeyError;
	const verifyHostKey = hostVerifier(options.hostKeyFingerprint, (error) => {
		hostKeyError = error;
	});
	const config = {
		host: options.host,
		port: options.port,
		username: options.username,
		readyTimeout: options.readyTimeoutMs ?? 2e4,
		keepaliveInterval: 1e4,
		keepaliveCountMax: 3,
		...options.auth.kind === "password" ? { password: options.auth.password } : {},
		...options.auth.kind === "privateKey" ? {
			privateKey: options.auth.privateKey,
			...options.auth.passphrase === void 0 ? {} : { passphrase: options.auth.passphrase }
		} : {},
		...options.auth.kind === "agent" ? { agent: options.auth.agent ?? process.env.SSH_AUTH_SOCK } : {},
		hostVerifier: verifyHostKey
	};
	await new Promise((resolve, reject) => {
		client.once("ready", () => {
			resolve();
		});
		client.once("error", (error) => {
			if (hostKeyError !== void 0) {
				reject(hostKeyError);
				return;
			}
			if (/all configured authentication methods failed/i.test(error.message)) {
				reject(new SshAuthError(options.host, options.username));
				return;
			}
			reject(error);
		});
		client.connect(config);
	});
	return client;
}
/**
* Run one command and collect bounded output.
* @param client - a ready client.
* @param command - POSIX shell command; callers must quote every interpolation.
* @param options - byte ceiling and deadline.
* @returns exit facts and captured output.
*/
async function execRemote(client, command, options = {}) {
	const maxBytes = options.maxBytes ?? 262144;
	return await new Promise((resolve, reject) => {
		let truncated = false;
		const stdout = [];
		const stderr = [];
		let total = 0;
		const collect = (sink) => (chunk) => {
			total += chunk.length;
			if (total > maxBytes) {
				truncated = true;
				return;
			}
			sink.push(chunk);
		};
		const timer = options.timeoutMs === void 0 ? void 0 : setTimeout(() => {
			reject(new RemoteCommandError("remote command timed out", scrubSecrets(command)));
		}, options.timeoutMs);
		const finish = (error, result) => {
			if (timer !== void 0) clearTimeout(timer);
			if (error !== void 0) reject(error);
			else resolve(result);
		};
		client.exec(command, (error, stream) => {
			if (error !== void 0) {
				finish(new RemoteCommandError(`remote command failed to start: ${scrubSecrets(error.message)}`, scrubSecrets(command)));
				return;
			}
			stream.on("data", collect(stdout));
			stream.stderr.on("data", collect(stderr));
			stream.on("error", (streamError) => {
				finish(new RemoteCommandError(`remote command failed: ${scrubSecrets(streamError.message)}`, scrubSecrets(command)));
			});
			stream.on("close", (code, signal) => {
				finish(void 0, {
					code: code ?? null,
					signal: signal ?? null,
					stdout: Buffer.concat(stdout).toString("utf8"),
					stderr: Buffer.concat(stderr).toString("utf8"),
					truncated
				});
			});
		});
	});
}
/** Open one SFTP session. */
async function openSftp(client) {
	return await new Promise((resolve, reject) => {
		client.sftp((error, sftp) => {
			if (error !== void 0) reject(new RemoteCommandError(`remote SFTP session failed: ${scrubSecrets(error.message)}`, ""));
			else resolve(sftp);
		});
	});
}
/** Create a directory and every missing parent. */
async function mkdirp(sftp, directory) {
	const segments = directory.split("/").filter((segment) => segment !== "");
	let current = directory.startsWith("/") ? "" : ".";
	for (const segment of segments) {
		current = current === "" ? `/${segment}` : `${current}/${segment}`;
		await new Promise((resolve, reject) => {
			sftp.mkdir(current, { mode: 493 }, (error) => {
				if (error == null || /failure/i.test(String(error.message ?? ""))) resolve();
				else reject(new RemoteCommandError(`cannot create remote directory "${current}"`, scrubSecrets(String(error.message))));
			});
		});
	}
}
/**
* Stream one file to the remote host with byte-level progress.
*
* The artifact (a Node distribution, ~25-50 MB) is pushed in fixed chunks so a
* throttled UI callback can show a ZCode-style percentage line instead of a
* silent wait.
*/
async function uploadRemoteFile(sftp, file, onProgress) {
	await mkdirp(sftp, file.path.slice(0, file.path.lastIndexOf("/")));
	const CHUNK = 262144;
	await new Promise((resolve, reject) => {
		const stream = sftp.createWriteStream(file.path, {
			mode: 420,
			autoClose: true
		});
		let sent = 0;
		stream.on("error", (error) => reject(new RemoteCommandError(`cannot upload remote file "${file.path}"`, scrubSecrets(error.message))));
		stream.on("close", () => resolve());
		let offset = 0;
		const pushNext = () => {
			while (offset < file.content.length) {
				const end = Math.min(offset + CHUNK, file.content.length);
				const chunk = file.content.subarray(offset, end);
				offset = end;
				sent = offset;
				onProgress?.(sent, file.content.length);
				if (!stream.write(chunk)) return false;
			}
			stream.end();
			return true;
		};
		stream.on("drain", () => {
			pushNext();
		});
		pushNext();
	});
}
//#endregion
//#region src/provision/profile.ts
/** Quote one argv element for the POSIX shell. */
function shellQuote(value) {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
/**
* Build a `PATH=…` assignment whose `$PATH` still expands.
*
* Single-quoting the value (as {@link shellQuote} would) freezes `$PATH` into
* a literal relative directory name — npm's lifecycle scripts then spawn `sh`
* through a nonexistent PATH entry and die with ENOENT. The literal directory
* segments are escaped for double quotes; the trailing `$PATH` stays live.
*/
function pathAssignment(prefixes) {
	return `PATH="${prefixes.map((segment) => segment.replace(/([$"\\`])/g, "\\$1")).join(":")}:$PATH"`;
}
/** Prefix for every route generated from the client host's own providers. */
const LOCAL_LLM_AUTO_PROVIDER_PREFIX = "remote-";
/** Display name shown by the official model picker for the manual route. */
const LOCAL_LLM_DISPLAY_NAME = "Local model";
/** Environment variable the profile server reads the route's key from. */
const LOCAL_LLM_API_KEY_ENV = "DSH_RW_LOCAL_LLM_KEY";
/**
* Value exported into the profile server for {@link LOCAL_LLM_API_KEY_ENV}.
*
* It is **not** the user's key: the bridge replaces any incoming Authorization
* header with the real one (manual) or ignores it (auto), so the profile only
* needs a non-empty placeholder (the adapter fails loudly with
* `MISSING_CREDENTIAL` when `apiKeyEnv` resolves to nothing).
*/
const LOCAL_LLM_BRIDGE_API_KEY = "local-bridge";
/** Quote one scalar as a YAML-compatible JSON string. */
function q(value) {
	return JSON.stringify(value);
}
/**
* Map one client provider id to a stable, unique `llm-pi-ai` route id.
*
* The prefix keeps auto routes from clobbering the profile's own provider
* entries (a patch replaces same-key configs); characters outside
* `[a-z0-9_-]` are folded to `-` because the config answers to a route key.
* @param providerId - client-side provider id from `ctx.llm.listProviders()`.
* @param used - ids already taken in this patch (mutated).
*/
function localModelRouteId(providerId, used) {
	const base = `${LOCAL_LLM_AUTO_PROVIDER_PREFIX}${providerId.trim().toLowerCase().replace(/[^a-z0-9_-]+/gu, "-")}`;
	let id = base;
	let suffix = 2;
	while (used.has(id) || id === "client-local") {
		id = `${base}-${suffix}`;
		suffix += 1;
	}
	used.add(id);
	return id;
}
/**
* Build the profile `cordis.patch.yml` body for the local model source.
* @param options - tunnel port and the routes to declare.
* @returns YAML text (LF only, trailing newline).
* @throws Error when no route/model id or an invalid port is supplied — a route
*   with no models is unserviceable and must fail before the profile starts.
*/
function buildLocalModelPatch(options) {
	if (!Number.isInteger(options.remotePort) || options.remotePort < 1 || options.remotePort > 65535) throw new Error(`invalid reverse-tunnel port ${String(options.remotePort)}`);
	const routes = options.routes.filter((route) => route.models.length > 0);
	if (routes.length === 0) throw new Error("the local model patch needs at least one provider route");
	const ids = /* @__PURE__ */ new Set();
	const unique = [];
	for (const route of routes) {
		const id = route.id.trim();
		if (id === "" || ids.has(id)) throw new Error(`invalid or duplicate provider route id ${JSON.stringify(route.id)}`);
		ids.add(id);
		const prefix = route.pathPrefix.trim();
		if (prefix !== "" && !prefix.startsWith("/")) throw new Error(`route ${JSON.stringify(id)} needs a "/"-prefixed bridge path`);
		const models = route.models.map((model) => ({
			id: model.id.trim(),
			name: model.name.trim() === "" ? model.id.trim() : model.name.trim()
		})).filter((model) => model.id !== "");
		if (models.length === 0) throw new Error(`provider route ${JSON.stringify(id)} advertises no models`);
		unique.push({
			id,
			displayName: route.displayName.trim() === "" ? id : route.displayName.trim(),
			pathPrefix: prefix,
			models
		});
	}
	const lines = [
		"- id: \"llm-pi-ai\"",
		"  config:",
		"    providers:"
	];
	for (const route of unique) {
		lines.push(`      ${q(route.id)}:`, `        displayName: ${q(route.displayName)}`, `        api: ${q("openai-completions")}`, `        baseURL: ${q(`http://127.0.0.1:${options.remotePort}${route.pathPrefix}/v1`)}`, `        apiKeyEnv: ${q(LOCAL_LLM_API_KEY_ENV)}`, "        models:");
		for (const model of route.models) lines.push(`          - id: ${q(model.id)}`, `            name: ${q(model.name)}`);
	}
	const first = unique[0];
	const firstModel = first.models[0];
	lines.push("- id: \"agent-default-model\"", "  config:", `    provider: ${q(first.id)}`, `    model: ${q(firstModel.id)}`, "");
	return lines.join("\n");
}
/**
* Enumerate every provider/model the client host's DSH can currently serve.
*
* A provider whose catalog lookup fails (transient network, unconfigured
* credentials) is skipped rather than failing the whole connect; the error is
* surfaced through the provider's absence. Unknown/empty ids are ignored.
* @param llm - the client host's `ctx.llm` runtime.
* @returns providers with at least one usable model, in registration order.
*/
async function discoverLocalCatalog(llm) {
	let providers;
	try {
		providers = await llm.listProviders();
	} catch (error) {
		throw new LocalCatalogError("local-llm-providers-unavailable", `the client host could not list its model providers: ${errorText(error)}`);
	}
	const out = [];
	for (const provider of providers) {
		if (out.length >= 32) break;
		const id = typeof provider.id === "string" ? provider.id.trim() : "";
		if (id === "") continue;
		let models;
		try {
			models = await llm.listModels(id);
		} catch {
			continue;
		}
		const seen = /* @__PURE__ */ new Set();
		const catalogModels = [];
		for (const model of models) {
			if (catalogModels.length >= 256) break;
			const modelId = typeof model.id === "string" ? model.id.trim() : "";
			if (modelId === "" || seen.has(modelId)) continue;
			seen.add(modelId);
			const name = typeof model.name === "string" && model.name.trim() !== "" ? model.name : modelId;
			catalogModels.push({
				id: modelId,
				name
			});
		}
		if (catalogModels.length === 0) continue;
		out.push({
			id,
			name: typeof provider.name === "string" && provider.name.trim() !== "" ? provider.name : id,
			models: catalogModels
		});
	}
	return { providers: out };
}
/** A coded catalog failure the route layer can map to an HTTP status. */
var LocalCatalogError = class extends Error {
	code;
	constructor(code, message) {
		super(scrubSecrets(message));
		this.code = code;
		this.name = "LocalCatalogError";
	}
};
function errorText(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* Scrub one error message before it crosses the tunnel.
*
* `scrubSecrets` covers URL/key-value shapes; provider SDK errors can also
* echo a raw bearer key, which must never reach the profile server logs.
*/
function scrubBridgeError(text) {
	return scrubSecrets(text).replace(/\bsk-[A-Za-z0-9_-]{4,}\b/g, "sk-***").replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1***");
}
/** Maximum accepted JSON request body (MiB) for one bridged chat call. */
const LOCAL_NATIVE_BODY_LIMIT_BYTES = 16777216;
/**
* Start the loopback bridge for one connect.
* @param options - runtime, catalog and optional timeout.
*/
async function startNativeLlmBridge(bridgeOptions) {
	const runtime = bridgeOptions.llm;
	const routes = /* @__PURE__ */ new Map();
	for (const provider of bridgeOptions.catalog.providers) routes.set(encodeURIComponent(provider.id), provider);
	const timeoutMs = bridgeOptions.timeoutMs ?? 12e4;
	const sockets = /* @__PURE__ */ new Set();
	const server = createServer((request, response) => {
		handle(request, response).catch((error) => {
			if (!response.headersSent) sendJson(response, 500, openAiError(500, "bridge-failed", scrubBridgeError(errorText(error))));
			else try {
				response.end();
			} catch {}
		});
	});
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => {
			sockets.delete(socket);
		});
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address();
	if (address === null || typeof address === "string") {
		await new Promise((resolve) => {
			server.close(() => {
				resolve();
			});
		});
		throw new Error("the native local-model bridge did not obtain a loopback port");
	}
	const url = `http://127.0.0.1:${address.port}`;
	return {
		host: "127.0.0.1",
		port: address.port,
		url,
		providerUrl(providerId) {
			return `${url}/${encodeURIComponent(providerId)}/v1`;
		},
		async close() {
			for (const socket of sockets) socket.destroy();
			await new Promise((resolve) => {
				server.close(() => {
					resolve();
				});
			});
		}
	};
	async function handle(request, response) {
		const rawUrl = request.url ?? "/";
		let parsed;
		try {
			parsed = new URL(rawUrl, url);
		} catch {
			sendJson(response, 400, openAiError(400, "bad-request", "the request URL is not a path"));
			return;
		}
		const segments = parsed.pathname.split("/").filter((segment) => segment !== "");
		const providerKey = segments[0] === void 0 ? "" : segments[0];
		const provider = routes.get(providerKey);
		if (provider === void 0) {
			sendJson(response, 404, openAiError(404, "unknown-provider", `unknown provider route ${JSON.stringify(providerKey)}`));
			return;
		}
		const rest = segments.slice(1);
		const method = (request.method ?? "GET").toUpperCase();
		if (method === "GET" && rest.length >= 2 && rest[0] === "v1" && rest[1] === "models") {
			const modelId = rest.length > 2 ? decodeURIComponent(rest.slice(2).join("/")) : void 0;
			if (modelId === void 0) {
				sendJson(response, 200, {
					object: "list",
					data: provider.models.map((model) => ({
						id: model.id,
						object: "model",
						created: 0,
						owned_by: provider.id
					}))
				});
				return;
			}
			const model = provider.models.find((entry) => entry.id === modelId);
			if (model === void 0) {
				sendJson(response, 404, openAiError(404, "model-not-found", `the provider does not advertise model ${JSON.stringify(modelId)}`));
				return;
			}
			sendJson(response, 200, {
				id: model.id,
				object: "model",
				created: 0,
				owned_by: provider.id
			});
			return;
		}
		if (method === "POST" && rest.length === 3 && rest[0] === "v1" && rest[1] === "chat" && rest[2] === "completions") {
			await handleChat(request, response, provider, timeoutMs);
			return;
		}
		sendJson(response, 404, openAiError(404, "not-found", `unknown route ${method} ${parsed.pathname}`));
	}
	async function handleChat(request, response, provider, timeout) {
		let body;
		try {
			body = parseJsonBody(await readBody(request, LOCAL_NATIVE_BODY_LIMIT_BYTES));
		} catch (error) {
			sendJson(response, 400, openAiError(400, "bad-request", scrubBridgeError(errorText(error))));
			return;
		}
		const modelId = typeof body.model === "string" ? body.model.trim() : "";
		const model = provider.models.find((entry) => entry.id === modelId);
		if (modelId === "" || model === void 0) {
			sendJson(response, 404, openAiError(404, "model-not-found", `the provider ${JSON.stringify(provider.id)} does not advertise model ${JSON.stringify(modelId)}`));
			return;
		}
		const messages = Array.isArray(body.messages) ? body.messages : void 0;
		if (messages === void 0 || messages.length === 0) {
			sendJson(response, 400, openAiError(400, "bad-request", "\"messages\" must be a non-empty array"));
			return;
		}
		const controller = new AbortController();
		const onClose = () => {
			controller.abort(/* @__PURE__ */ new Error("the profile server closed the bridge request"));
		};
		response.on("close", onClose);
		const stream = body.stream === true;
		const includeUsage = isIncludeUsage(body.stream_options);
		const id = `chatcmpl-${randomUUID()}`;
		let options;
		try {
			options = toGenerateOptions(provider, modelId, body, messages, controller.signal);
		} catch (error) {
			response.off("close", onClose);
			sendJson(response, 400, openAiError(400, "bad-request", scrubBridgeError(errorText(error))));
			return;
		}
		if (!stream) {
			const timer = setTimeout(() => {
				controller.abort(/* @__PURE__ */ new Error(`the model call exceeded ${timeout} ms`));
			}, Math.min(timeout, 2147483647));
			timer.unref?.();
			try {
				sendJson(response, 200, await collect(options, provider, modelId));
			} catch (error) {
				sendJson(response, 500, openAiError(500, "model-call-failed", scrubBridgeError(errorText(error))));
			} finally {
				clearTimeout(timer);
				response.off("close", onClose);
			}
			return;
		}
		let started = false;
		const startStream = () => {
			if (started) return;
			started = true;
			response.writeHead(200, {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache, no-transform",
				connection: "keep-alive",
				"x-accel-buffering": "no"
			});
			response.flushHeaders?.();
		};
		const emit = (payload) => {
			startStream();
			emitSse(response, payload);
		};
		let failure;
		try {
			failure = await streamChat(options, provider, modelId, emit, id, includeUsage);
		} catch (error) {
			const message = scrubBridgeError(errorText(error));
			if (!started) {
				response.off("close", onClose);
				sendJson(response, 502, openAiError(502, "model-call-failed", message));
				return;
			}
			emit({
				id,
				object: "chat.completion.chunk",
				created: 0,
				model: modelId,
				choices: [{
					index: 0,
					delta: {},
					finish_reason: "error"
				}],
				error: {
					message,
					type: "model-call-failed"
				}
			});
			failure = message;
		} finally {
			response.off("close", onClose);
		}
		if (!started && failure !== void 0) {
			sendJson(response, 502, openAiError(502, "model-call-failed", failure));
			return;
		}
		try {
			response.write("data: [DONE]\n\n");
			response.end();
		} catch {}
	}
	function toGenerateOptions(provider, modelId, body, messages, signal) {
		const systemParts = [];
		const nativeMessages = [];
		for (const raw of messages) {
			const role = typeof raw.role === "string" ? raw.role : "";
			if (role === "system" || role === "developer") {
				systemParts.push(...flattenOpenAiContent(raw.content).texts);
				continue;
			}
			if (role === "user") {
				const { texts } = flattenOpenAiContent(raw.content);
				const text = texts.join("");
				nativeMessages.push({
					role: "user",
					source: { kind: "user" },
					content: text === "" ? [] : [{
						type: "text",
						text
					}]
				});
				continue;
			}
			if (role === "assistant") {
				const { texts } = flattenOpenAiContent(raw.content);
				const content = [];
				if (texts.length > 0) content.push({
					type: "text",
					text: texts.join("")
				});
				for (const call of openAiToolCalls(raw)) content.push({
					type: "tool-call",
					id: call.id,
					name: call.name,
					arguments: call.arguments
				});
				nativeMessages.push({
					role: "assistant",
					source: {
						kind: "model",
						provider: provider.id,
						model: modelId
					},
					content
				});
				continue;
			}
			if (role === "tool") {
				const toolCallId = typeof raw.tool_call_id === "string" ? raw.tool_call_id : "";
				const { texts } = flattenOpenAiContent(raw.content);
				nativeMessages.push({
					role: "tool",
					source: {
						kind: "tool",
						callId: toolCallId
					},
					toolCallId,
					isError: false,
					content: texts.length === 0 ? [{
						type: "text",
						text: ""
					}] : [{
						type: "text",
						text: texts.join("")
					}]
				});
				continue;
			}
		}
		const options = {
			provider: provider.id,
			model: modelId,
			messages: nativeMessages,
			signal,
			...systemParts.length === 0 ? {} : { system: systemParts.join("\n\n") },
			...toTemperature(body.temperature) === void 0 ? {} : { temperature: toTemperature(body.temperature) },
			...toMaxTokens(body) === void 0 ? {} : { maxTokens: toMaxTokens(body) },
			...toStop(body.stop) === void 0 ? {} : { stop: toStop(body.stop) }
		};
		const tools = toToolSchemas(body.tools);
		return tools === void 0 ? options : {
			...options,
			tools
		};
	}
	async function collect(options, provider, modelId) {
		const text = [];
		const toolCalls = [];
		const toolIndexByBlock = /* @__PURE__ */ new Map();
		const callNameByBlock = /* @__PURE__ */ new Map();
		let usage;
		let finish;
		let reasoning = [];
		for await (const chunk of runtime.stream(options)) switch (chunk.type) {
			case "text-delta":
				text.push(chunk.text);
				break;
			case "reasoning-delta":
				reasoning.push(chunk.text);
				break;
			case "tool-call-delta": {
				const index = toolIndexByBlock.get(chunk.index);
				if (index === void 0) {
					toolIndexByBlock.set(chunk.index, toolCalls.length);
					callNameByBlock.set(chunk.index, chunk.name ?? "");
					toolCalls.push({
						id: chunk.id,
						name: chunk.name ?? "",
						arguments: chunk.argumentsDelta
					});
				} else {
					const call = toolCalls[index];
					if (call !== void 0) {
						if (call.id === "" && chunk.id !== "") call.id = chunk.id;
						if (call.name === "" && chunk.name !== void 0) call.name = chunk.name;
						call.arguments += chunk.argumentsDelta;
					}
				}
				break;
			}
			case "block-end":
				if (chunk.block.type === "tool-call") {
					const index = toolIndexByBlock.get(chunk.index);
					if (index !== void 0 && toolCalls[index] !== void 0 && chunk.block.arguments !== void 0) toolCalls[index].arguments = chunk.block.arguments;
				}
				break;
			case "usage":
				usage = chunk.usage;
				break;
			case "finish": finish = chunk.reason;
		}
		const failure = finishFailureText(finish);
		if (failure !== void 0 && text.length === 0 && toolCalls.length === 0) throw new Error(failure);
		return {
			id: `chatcmpl-${randomUUID()}`,
			object: "chat.completion",
			created: 0,
			model: modelId,
			choices: [{
				index: 0,
				message: {
					role: "assistant",
					content: text.length === 0 ? null : text.join(""),
					...toolCalls.length === 0 ? {} : { tool_calls: toolCalls.map((call) => ({
						id: call.id,
						type: "function",
						function: {
							name: call.name,
							arguments: call.arguments
						}
					})) },
					...reasoning.length === 0 ? {} : { reasoning_content: reasoning.join("") }
				},
				finish_reason: toOpenAiFinish(finish)
			}],
			...usage === void 0 ? {} : { usage: toOpenAiUsage(usage) },
			provider: provider.id
		};
	}
	async function streamChat(options, provider, modelId, emit, id, includeUsage) {
		const created = Math.floor(Date.now() / 1e3);
		const toolIndexByBlock = /* @__PURE__ */ new Map();
		let usage;
		let finish;
		const base = {
			id,
			object: "chat.completion.chunk",
			created,
			model: modelId
		};
		for await (const chunk of runtime.stream(options)) switch (chunk.type) {
			case "text-delta":
				emit({
					...base,
					choices: [{
						index: 0,
						delta: { content: chunk.text },
						finish_reason: null
					}]
				});
				break;
			case "reasoning-delta":
				emit({
					...base,
					choices: [{
						index: 0,
						delta: { reasoning_content: chunk.text },
						finish_reason: null
					}]
				});
				break;
			case "tool-call-delta": {
				let index = toolIndexByBlock.get(chunk.index);
				if (index === void 0) {
					index = toolIndexByBlock.size;
					toolIndexByBlock.set(chunk.index, index);
					emit({
						...base,
						choices: [{
							index: 0,
							delta: { tool_calls: [{
								index,
								id: chunk.id,
								type: "function",
								function: {
									name: chunk.name ?? "",
									arguments: chunk.argumentsDelta
								}
							}] },
							finish_reason: null
						}]
					});
				} else emit({
					...base,
					choices: [{
						index: 0,
						delta: { tool_calls: [{
							index,
							function: { arguments: chunk.argumentsDelta }
						}] },
						finish_reason: null
					}]
				});
				break;
			}
			case "usage":
				usage = chunk.usage;
				break;
			case "finish": finish = chunk.reason;
		}
		const failure = finishFailureText(finish);
		emit({
			...base,
			choices: [{
				index: 0,
				delta: {},
				finish_reason: toOpenAiFinish(finish)
			}],
			...failure === void 0 ? {} : { error: {
				message: failure,
				type: "model-call-failed"
			} }
		});
		if (includeUsage && usage !== void 0) emit({
			...base,
			choices: [],
			usage: toOpenAiUsage(usage)
		});
		return failure;
	}
}
/** Readable, scrubbed text for one terminal model-call failure. */
function finishFailureText(reason) {
	if (reason === void 0) return void 0;
	if (reason.kind !== "error" && reason.kind !== "aborted") return void 0;
	return scrubBridgeError(`${typeof reason.failure?.code === "string" && reason.failure.code !== "" ? `${reason.failure.code}: ` : ""}${typeof reason.failure?.message === "string" && reason.failure.message !== "" ? reason.failure.message : "the model call ended without a content block"}`);
}
/** Flatten OpenAI message content (string or text parts); images become a text note. */
function flattenOpenAiContent(content) {
	if (typeof content === "string") return { texts: content === "" ? [] : [content] };
	if (!Array.isArray(content)) return { texts: [] };
	const texts = [];
	for (const part of content) {
		if (part === null || typeof part !== "object") continue;
		const record = part;
		if (record.type === "text" && typeof record.text === "string") {
			if (record.text !== "") texts.push(record.text);
			continue;
		}
		if (record.type === "image_url") {
			texts.push("[image attachment omitted by the local model proxy]");
			continue;
		}
		if (typeof record.text === "string" && record.text !== "") texts.push(record.text);
	}
	return { texts };
}
/** Extract normalized function calls from one assistant message. */
function openAiToolCalls(message) {
	const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
	const out = [];
	for (const raw of calls) {
		if (raw === null || typeof raw !== "object") continue;
		const record = raw;
		const fn = record.function !== null && typeof record.function === "object" ? record.function : void 0;
		const id = typeof record.id === "string" ? record.id : "";
		const name = fn !== void 0 && typeof fn.name === "string" ? fn.name : "";
		const args = fn !== void 0 ? typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}) : "{}";
		if (name === "") continue;
		out.push({
			id,
			name,
			arguments: args
		});
	}
	return out;
}
/** Normalize the OpenAI `tools` field to harness `ToolSchema`s. */
function toToolSchemas(value) {
	if (!Array.isArray(value)) return void 0;
	const out = [];
	for (const raw of value) {
		if (raw === null || typeof raw !== "object") continue;
		const record = raw;
		const fn = record.function !== null && typeof record.function === "object" ? record.function : void 0;
		if (fn === void 0 || typeof fn.name !== "string" || fn.name === "") continue;
		const parameters = fn.parameters !== null && typeof fn.parameters === "object" ? fn.parameters : {
			type: "object",
			properties: {}
		};
		out.push({
			name: fn.name,
			description: typeof fn.description === "string" ? fn.description : "",
			parameters
		});
	}
	return out.length === 0 ? void 0 : out;
}
function toTemperature(value) {
	if (typeof value !== "number" || !Number.isFinite(value)) return void 0;
	return Math.max(0, Math.min(2, value));
}
function toMaxTokens(body) {
	const value = body.max_completion_tokens ?? body.max_tokens;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return void 0;
	return value;
}
function toStop(value) {
	if (typeof value === "string") return value === "" ? void 0 : [value];
	if (!Array.isArray(value)) return void 0;
	const out = value.filter((entry) => typeof entry === "string" && entry !== "");
	return out.length === 0 ? void 0 : out;
}
function toOpenAiFinish(reason) {
	switch (reason?.kind) {
		case "tool-calls": return "tool_calls";
		case "max-tokens": return "length";
		case "aborted":
		case "error": return "stop";
		default: return "stop";
	}
}
function toOpenAiUsage(usage) {
	const prompt = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
	return {
		prompt_tokens: prompt,
		completion_tokens: usage.outputTokens,
		total_tokens: usage.totalTokens ?? prompt + usage.outputTokens,
		...usage.cacheReadTokens === void 0 ? {} : { cache_read_tokens: usage.cacheReadTokens }
	};
}
function isIncludeUsage(value) {
	if (value === null || typeof value !== "object") return false;
	return value.include_usage === true;
}
/** Read one request body with a hard byte cap. */
async function readBody(request, limit) {
	const chunks = [];
	let total = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buffer.length;
		if (total > limit) throw new Error(`the request body exceeds ${limit} bytes`);
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}
function parseJsonBody(text) {
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error("the request body is not valid JSON");
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("the request body must be a JSON object");
	return value;
}
function sendJson(response, status, body) {
	if (response.headersSent) {
		try {
			response.end();
		} catch {}
		return;
	}
	const payload = JSON.stringify(body);
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(payload)
	});
	response.end(payload);
}
function openAiError(status, type, message) {
	return { error: {
		message,
		type,
		code: type,
		param: null
	} };
}
function emitSse(response, chunk) {
	response.write(`data: ${JSON.stringify(chunk)}\n\n`);
}
/** Smallest accepted timeout. */
const LOCAL_LLM_MIN_TIMEOUT_MS = 1e3;
/** Largest accepted timeout. */
const LOCAL_LLM_MAX_TIMEOUT_MS = 36e5;
/** HTTP status per coded failure (the P3 route envelope uses it verbatim). */
const STATUS_BY_LOCAL_LLM_CODE = {
	"local-llm-unconfigured": 400,
	"local-llm-bad-settings": 400,
	"local-llm-no-models": 400,
	"local-llm-unauthorized": 502,
	"local-llm-unreachable": 502,
	"local-llm-unavailable": 502,
	"local-llm-providers-unavailable": 502,
	"local-llm-forwarding-unavailable": 424
};
/** A coded local-model failure; every message is scrubbed before it escapes. */
var LocalLlmError = class extends Error {
	code;
	details;
	status;
	constructor(code, message, details) {
		super(scrubSecrets(message));
		this.code = code;
		this.details = details;
		this.name = "LocalLlmError";
		this.status = STATUS_BY_LOCAL_LLM_CODE[code];
	}
};
/**
* Validate and normalize one local endpoint base URL.
*
* Only `http(s)` without embedded credentials, query or fragment is accepted —
* the bridge injects the key in a header, and a URL carrying one would leak it
* into every error message. A trailing `/v1` is stripped so the incoming
* request path (`/v1/...`) is appended exactly once.
* @param baseUrl - the configured endpoint base.
* @returns `scheme://host[/path]` without a trailing slash or `/v1`.
*/
function normalizeLocalBaseUrl(baseUrl) {
	let parsed;
	try {
		parsed = new URL(baseUrl.trim());
	} catch {
		throw new LocalLlmError("local-llm-bad-settings", "the local model base URL is not a valid URL");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new LocalLlmError("local-llm-bad-settings", "the local model base URL must use http:// or https://");
	if (parsed.username !== "" || parsed.password !== "") throw new LocalLlmError("local-llm-bad-settings", "the local model base URL must not embed credentials");
	if (parsed.search !== "" || parsed.hash !== "") throw new LocalLlmError("local-llm-bad-settings", "the local model base URL must not carry a query or fragment");
	const path = parsed.pathname.replace(/\/+$/u, "").replace(/\/v1$/u, "").replace(/\/+$/u, "");
	return `${parsed.protocol}//${parsed.host}${path}`;
}
/**
* The URL of the endpoint's OpenAI model catalog (`GET /v1/models`).
* @param baseUrl - configured endpoint base (normalized here).
*/
function localModelsUrl(baseUrl) {
	return `${normalizeLocalBaseUrl(baseUrl)}/v1/models`;
}
/** Read the endpoint base from an endpoint's model catalog JSON. */
function modelsFromCatalog(body) {
	const rows = Array.isArray(body) ? body : body !== null && typeof body === "object" && Array.isArray(body.data) ? body.data : [];
	const models = [];
	for (const row of rows) {
		const id = typeof row === "string" ? row : row !== null && typeof row === "object" && typeof row.id === "string" ? row.id : void 0;
		if (id === void 0) continue;
		const value = id.trim();
		if (value !== "" && !models.includes(value)) models.push(value);
	}
	return models;
}
/** Deduplicate/normalize a model id list, rejecting malformed input. */
function normalizeModels(models) {
	const out = [];
	for (const entry of models) {
		if (typeof entry !== "string") throw new LocalLlmError("local-llm-bad-settings", "model ids must be strings");
		const value = entry.trim();
		if (value === "" || value.length > 256) throw new LocalLlmError("local-llm-bad-settings", "model ids must be non-empty and at most 256 characters");
		if (!out.includes(value)) out.push(value);
	}
	if (out.length > 256) throw new LocalLlmError("local-llm-bad-settings", "at most 256 model ids may be configured");
	return out;
}
/** The stored settings document, when one exists. */
function currentSettings(store) {
	return store.localLlmSettings();
}
/**
* Discover the client host's provider catalog for the `auto` source.
* @param llm - the client host's `ctx.llm` runtime, when available.
* @param timeoutMs - accepted for symmetry with the manual probe; the catalog
*   itself is local and synchronous-ish.
* @returns the discovered catalog (never empty; throws a coded error instead).
*/
async function discoverCatalog(llm, timeoutMs) {
	if (llm === void 0) throw new LocalLlmError("local-llm-unavailable", "the client host does not expose its model runtime; the automatic local model source is unavailable in this installation");
	let catalog;
	try {
		catalog = await discoverLocalCatalog(llm);
	} catch (error) {
		if (error instanceof LocalCatalogError) throw new LocalLlmError("local-llm-unreachable", error.message);
		throw new LocalLlmError("local-llm-unreachable", `the client host could not list its models: ${errorMessage(error)}`);
	}
	if (catalog.providers.length === 0) throw new LocalLlmError("local-llm-no-models", "the client host has no model providers with models; configure a model provider in DSH before connecting with the automatic local model source");
	return catalog;
}
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Flatten a catalog into `provider/model` display ids. */
function catalogDisplayModels(catalog) {
	const out = [];
	for (const provider of catalog.providers) for (const model of provider.models) out.push(`${provider.id}/${model.id}`);
	return out;
}
/** The current settings as the browser sees them (no secret). */
async function readLocalLlmState(store, targetId, llm) {
	const settings = currentSettings(store);
	const mode = effectiveLocalLlmMode(settings);
	const key = await store.localLlmKey();
	let modelSource;
	if (targetId !== void 0) {
		const record = store.target(targetId);
		if (record !== void 0) modelSource = effectiveModelSource(record);
	}
	const base = {
		mode,
		baseUrl: settings?.baseUrl ?? "",
		models: [...settings?.models ?? []],
		timeoutMs: settings?.timeoutMs ?? 12e4,
		hasApiKey: key !== void 0,
		...modelSource === void 0 ? {} : { modelSource }
	};
	if (mode === "manual") return base;
	try {
		const catalog = await discoverCatalog(llm, base.timeoutMs);
		return {
			...base,
			catalog
		};
	} catch (error) {
		const message = error instanceof LocalLlmError ? error.message : scrubSecrets(errorMessage(error));
		return {
			...base,
			catalogError: message
		};
	}
}
/**
* Validate, persist and (when a key or model list is supplied) update the
* local model settings. A key goes to `ctx.credentials`, never to the domain.
* @param store - opened target store (domain global + credential seam).
* @param input - the route body.
* @returns the same read shape `local-llm/read` answers.
*/
async function saveLocalLlmState(store, input, llm) {
	const current = currentSettings(store);
	const mode = input.mode ?? (input.baseUrl !== void 0 && input.baseUrl.trim() !== "" ? "manual" : effectiveLocalLlmMode(current));
	if (mode !== "auto" && mode !== "manual") throw new LocalLlmError("local-llm-bad-settings", "\"mode\" must be auto|manual");
	const timeoutMs = input.timeoutMs ?? current?.timeoutMs ?? 12e4;
	if (!Number.isInteger(timeoutMs) || timeoutMs < 1e3 || timeoutMs > 36e5) throw new LocalLlmError("local-llm-bad-settings", `the timeout must be an integer between ${LOCAL_LLM_MIN_TIMEOUT_MS} and ${LOCAL_LLM_MAX_TIMEOUT_MS} ms`);
	if (input.apiKey !== void 0) await store.storeLocalLlmKey(input.apiKey);
	const hasKey = await store.localLlmKey() !== void 0;
	let settings;
	if (mode === "auto") settings = {
		mode: "auto",
		baseUrl: "",
		models: [],
		timeoutMs
	};
	else settings = {
		mode: "manual",
		baseUrl: normalizeLocalBaseUrl(requireManualBaseUrl(input.baseUrl, current)),
		models: normalizeModels(input.models ?? []),
		timeoutMs,
		...hasKey ? { apiKeyRef: String(localLlmCredentialKey()) } : {}
	};
	await store.setLocalLlmSettings(localLlmSettingsSchema.parse(settings));
	return await readLocalLlmState(store, void 0, llm);
}
function requireManualBaseUrl(input, current) {
	const value = input ?? (effectiveLocalLlmMode(current) === "manual" ? current?.baseUrl : void 0);
	if (value === void 0 || value.trim() === "") throw new LocalLlmError("local-llm-unconfigured", "no local model endpoint is configured; save the client-local OpenAI-compatible base URL or switch to the automatic source");
	return value;
}
/**
* Remove the stored local model API key (settings stay).
* @param store - opened target store.
*/
async function clearLocalLlmKey(store) {
	await store.forgetLocalLlmKey();
	const current = currentSettings(store);
	if (current !== void 0) {
		const { apiKeyRef: _cleared, ...rest } = current;
		await store.setLocalLlmSettings(rest);
	}
	return await readLocalLlmState(store);
}
/**
* Probe one manual local endpoint's `/v1/models` and return its model ids.
*
* Runs from the client host (no SSH involved) so a misconfigured endpoint fails
* before any remote work starts. Coded failures:
* - 401/403 → `local-llm-unauthorized`
* - transport error/timeout/other HTTP status → `local-llm-unreachable`
* - non-JSON/empty catalog → `local-llm-no-models`
* @param options - endpoint base, optional key and timeout.
*/
async function probeLocalModels(options) {
	const url = localModelsUrl(options.baseUrl);
	const timeoutMs = options.timeoutMs ?? 12e4;
	if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new LocalLlmError("local-llm-bad-settings", "the probe timeout must be a positive integer");
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, Math.min(timeoutMs, 2147483647));
	timer.unref?.();
	let response;
	try {
		response = await fetch(url, {
			method: "GET",
			headers: {
				accept: "application/json",
				...options.apiKey === void 0 || options.apiKey === "" ? {} : { authorization: `Bearer ${options.apiKey}` }
			},
			signal: controller.signal
		});
	} catch (error) {
		throw new LocalLlmError("local-llm-unreachable", `the local model endpoint did not answer ${url} within ${timeoutMs} ms: ${error instanceof Error ? error.message : String(error)}`, {
			url,
			timeoutMs
		});
	} finally {
		clearTimeout(timer);
	}
	if (response.status === 401 || response.status === 403) throw new LocalLlmError("local-llm-unauthorized", `the local model endpoint answered HTTP ${response.status} for ${url}; check the saved API key`, {
		url,
		status: response.status
	});
	if (!response.ok) throw new LocalLlmError("local-llm-unreachable", `the local model endpoint answered HTTP ${response.status} for ${url}`, {
		url,
		status: response.status
	});
	let body;
	try {
		body = await response.json();
	} catch {
		throw new LocalLlmError("local-llm-no-models", `the local model endpoint's ${url} response is not JSON`, { url });
	}
	const models = modelsFromCatalog(body);
	if (models.length === 0) throw new LocalLlmError("local-llm-no-models", `the local model endpoint's ${url} response lists no model ids; configure the model ids manually`, { url });
	return models;
}
/**
* Produce a connect-ready plan for the current local model mode.
*
* `auto` discovers the client host's provider catalog (coded failure when the
* host exposes nothing); `manual` validates the saved endpoint, reads the key
* from the credential store and probes `/v1/models` when no models are stored
* (persisting what it discovered so the next connect is offline).
* Throws {@link LocalLlmError} — never falls back to the server's models.
* @param store - opened target store.
* @param options - host-side model runtime (required for `auto`).
*/
async function planLocalLlm(store, options) {
	const settings = currentSettings(store);
	const mode = effectiveLocalLlmMode(settings);
	if (mode === "auto") {
		const catalog = await discoverCatalog(options?.llm, settings?.timeoutMs ?? 12e4);
		return {
			mode,
			catalog,
			models: catalogDisplayModels(catalog)
		};
	}
	if (settings === void 0 || settings.baseUrl.trim() === "") throw new LocalLlmError("local-llm-unconfigured", "no local model endpoint is configured; save the client-local OpenAI-compatible base URL or switch to the automatic source");
	const baseUrl = normalizeLocalBaseUrl(settings.baseUrl);
	const apiKey = await store.localLlmKey();
	let models = [...settings.models];
	if (models.length === 0) {
		models = await probeLocalModels({
			baseUrl,
			...apiKey === void 0 ? {} : { apiKey },
			timeoutMs: settings.timeoutMs
		});
		const discovered = {
			...settings,
			mode,
			baseUrl,
			models
		};
		await store.setLocalLlmSettings(localLlmSettingsSchema.parse(discovered));
	}
	if (models.length === 0) throw new LocalLlmError("local-llm-no-models", "the local model endpoint has no models; configure at least one model id");
	return {
		mode,
		settings: {
			...settings,
			mode,
			baseUrl,
			models
		},
		models,
		...apiKey === void 0 ? {} : { apiKey }
	};
}
//#endregion
//#region src/local-llm/bridge.ts
/**
* Loopback HTTP bridge between a server profile's `client-local` model route and
* the user's OpenAI-compatible endpoint on the client host.
*
* The profile server talks to this bridge through an SSH reverse tunnel (see
* `tunnel.ts`); the bridge forwards only `/v1/...` requests to the configured
* endpoint and replaces any inbound `Authorization` header with the saved key.
* The real key therefore never leaves the client host, and the profile only
* carries a placeholder (`DSH_RW_LOCAL_LLM_KEY=local-bridge`).
*
* Everything is bound to `127.0.0.1` on an OS-assigned port; responses stream
* through unbuffered, client aborts tear the upstream request down and an
* upstream stall past the configured timeout becomes a JSON 504.
*/
/** Only request paths under this prefix are proxied to the local endpoint. */
const LOCAL_LLM_ALLOWED_PATH_PREFIX = "/v1/";
/** Headers that must not be forwarded in either direction (RFC 9110 §7.6.1, plus Host/Authorization). */
const LOCAL_LLM_HOP_BY_HOP_HEADERS = [
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"trailers",
	"transfer-encoding",
	"upgrade",
	"host"
];
/** The bridge's stream timeout is intentionally bounded; validate it once. */
function assertTimeout(timeoutMs) {
	if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) throw new Error(`invalid local model timeout ${String(timeoutMs)}`);
}
/** Copy the headers worth forwarding, dropping hop-by-hop ones (and optionally content-length). */
function forwardableHeaders(headers, options) {
	const hops = new Set(LOCAL_LLM_HOP_BY_HOP_HEADERS);
	const out = {};
	for (const [name, value] of Object.entries(headers)) {
		const lower = name.toLowerCase();
		if (value === void 0 || hops.has(lower)) continue;
		if (options.dropAuthorization && lower === "authorization") continue;
		if (options.dropContentLength && lower === "content-length") continue;
		out[name] = value;
	}
	return out;
}
/** Send a scrubbed JSON error body (or destroy the response once streaming began). */
function sendJsonError(response, status, code, message) {
	if (response.headersSent) {
		response.destroy();
		return;
	}
	const body = JSON.stringify({ error: {
		code,
		message: scrubSecrets(message)
	} });
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body),
		"cache-control": "no-store"
	});
	response.end(body);
}
/**
* Start the loopback bridge.
* @param options - endpoint base, optional key and timeout.
* @returns the running bridge (call {@link LocalLlmBridge.close} to stop it).
*/
async function startLocalLlmBridge(options) {
	assertTimeout(options.timeoutMs);
	const base = normalizeLocalBaseUrl(options.baseUrl);
	const target = new URL(base);
	const requestFn = target.protocol === "https:" ? request$1 : request;
	const sockets = /* @__PURE__ */ new Set();
	const inflight = /* @__PURE__ */ new Set();
	const server = createServer((request, response) => {
		let requestUrl;
		try {
			requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
		} catch {
			sendJsonError(response, 400, "local-llm-bad-request", "malformed request URL");
			return;
		}
		if (!requestUrl.pathname.startsWith("/v1/")) {
			sendJsonError(response, 404, "local-llm-not-found", `the local model bridge only forwards ${LOCAL_LLM_ALLOWED_PATH_PREFIX} paths`);
			return;
		}
		const headers = forwardableHeaders(request.headers, {
			dropAuthorization: true,
			dropContentLength: false
		});
		if (options.apiKey !== void 0 && options.apiKey !== "") headers.authorization = `Bearer ${options.apiKey}`;
		let upstream;
		try {
			upstream = requestFn({
				protocol: target.protocol,
				hostname: target.hostname,
				port: target.port === "" ? void 0 : Number(target.port),
				method: request.method ?? "GET",
				path: `${base.slice(`${target.protocol}//${target.host}`.length)}${requestUrl.pathname}${requestUrl.search}`,
				headers
			}, (upstreamResponse) => {
				const responseHeaders = forwardableHeaders(upstreamResponse.headers, {
					dropAuthorization: false,
					dropContentLength: true
				});
				response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
				upstreamResponse.pipe(response);
				upstreamResponse.on("error", () => {
					response.destroy();
				});
				response.on("close", () => {
					if (!upstreamResponse.complete) upstreamResponse.destroy();
				});
			});
		} catch (error) {
			sendJsonError(response, 502, "local-llm-upstream-failed", `the local model endpoint could not be reached: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		inflight.add(upstream);
		upstream.on("close", () => {
			inflight.delete(upstream);
		});
		let timedOut = false;
		upstream.setTimeout(options.timeoutMs, () => {
			timedOut = true;
			if (!response.headersSent) sendJsonError(response, 504, "local-llm-upstream-timeout", `the local model endpoint did not answer within ${options.timeoutMs} ms`);
			else response.destroy();
			upstream.destroy();
		});
		upstream.on("error", (error) => {
			if (timedOut) return;
			sendJsonError(response, 502, "local-llm-upstream-failed", `the local model endpoint request failed: ${error.message}`);
		});
		request.on("aborted", () => {
			upstream.destroy();
		});
		response.on("close", () => {
			if (!response.writableEnded) upstream.destroy();
		});
		request.on("error", () => {
			upstream.destroy();
		});
		request.pipe(upstream);
	});
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => {
			sockets.delete(socket);
		});
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address();
	if (address === null || typeof address === "string") {
		await new Promise((resolve) => {
			server.close(() => {
				resolve();
			});
		});
		throw new Error("the local model bridge failed to bind a loopback port");
	}
	let closing;
	return {
		host: "127.0.0.1",
		port: address.port,
		url: `http://127.0.0.1:${address.port}`,
		close() {
			closing ??= (async () => {
				for (const upstream of inflight) upstream.destroy();
				for (const socket of sockets) socket.destroy();
				await new Promise((resolve) => {
					server.close(() => {
						resolve();
					});
				});
			})();
			return closing;
		}
	};
}
//#endregion
//#region src/local-llm/service.ts
/**
* Per-target owner of the local model path.
*
* `prepare` is a no-op for a `server` model source; for `local` it loads the
* plan (discovering the automatic catalog or probing the manual endpoint),
* starts the matching bridge, asks the connection for the reverse tunnel and
* returns the random remote port plus the routes for the profile patch.
*/
var LocalLlmService = class {
	store;
	options;
	live = /* @__PURE__ */ new Map();
	constructor(store, options = {}) {
		this.store = store;
		this.options = options;
	}
	/** Whether a bridge + tunnel pair is currently live for `targetId`. */
	has(targetId) {
		return this.live.has(targetId);
	}
	/**
	* Bring up the local model path for one target.
	* @param targetId - target record id.
	* @param connection - an SSH connection that can open reverse tunnels.
	* @param plan - an already-loaded plan (the connect flow validates before
	*   installing profile files); loaded from storage when omitted.
	* @returns the tunnel port + routes, or `undefined` for a `server` source.
	* @throws LocalLlmError when the source is unconfigured/unreachable or the
	*   SSH server refuses the reverse tunnel; nothing stays listening then.
	*/
	async prepare(targetId, connection, plan) {
		const resolved = plan ?? await this.loadPersistedPlan(targetId);
		if (resolved === void 0) return void 0;
		await this.teardown(targetId);
		const bridge = await this.startBridge(resolved);
		try {
			if (connection.remoteForward === void 0) throw new LocalLlmError("local-llm-forwarding-unavailable", "the SSH connection for this target does not support reverse tunnels");
			const forward = await connection.remoteForward({
				listenHost: "127.0.0.1",
				targetPort: bridge.port
			});
			const routes = this.routesFor(resolved);
			this.live.set(targetId, {
				bridge,
				forward,
				models: [...resolved.models]
			});
			return {
				mode: resolved.mode,
				bridgePort: bridge.port,
				remoteHost: "127.0.0.1",
				remotePort: forward.port,
				routes,
				models: [...resolved.models]
			};
		} catch (error) {
			await bridge.close().catch(() => void 0);
			throw error;
		}
	}
	/** Stop the bridge + tunnel for one target (idempotent). */
	async teardown(targetId) {
		const entry = this.live.get(targetId);
		if (entry === void 0) return;
		this.live.delete(targetId);
		await Promise.allSettled([entry.forward.close(), entry.bridge.close()]);
	}
	/** Stop every live local model path. */
	async close() {
		await Promise.allSettled([...this.live.keys()].map(async (targetId) => await this.teardown(targetId)));
	}
	/** Start the bridge matching the plan's mode. */
	async startBridge(plan) {
		if (plan.mode === "auto") {
			const llm = this.options.llm?.();
			if (llm === void 0 || plan.catalog === void 0) throw new LocalLlmError("local-llm-unavailable", "the client host does not expose its model runtime; the automatic local model source cannot start");
			const bridge = await startNativeLlmBridge({
				llm,
				catalog: plan.catalog,
				timeoutMs: plan.settings?.timeoutMs
			});
			return {
				port: bridge.port,
				close: async () => {
					await bridge.close();
				}
			};
		}
		if (plan.settings === void 0) throw new LocalLlmError("local-llm-unconfigured", "the local model endpoint has no saved settings");
		const bridge = await startLocalLlmBridge({
			baseUrl: plan.settings.baseUrl,
			...plan.apiKey === void 0 ? {} : { apiKey: plan.apiKey },
			timeoutMs: plan.settings.timeoutMs
		});
		return {
			port: bridge.port,
			close: async () => {
				await bridge.close();
			}
		};
	}
	/** Turn one plan into the routes the profile patch declares. */
	routesFor(plan) {
		if (plan.mode === "manual") return [{
			id: "client-local",
			displayName: LOCAL_LLM_DISPLAY_NAME,
			pathPrefix: "",
			models: plan.models.map((id) => ({
				id,
				name: id
			}))
		}];
		const used = /* @__PURE__ */ new Set();
		const catalog = plan.catalog;
		if (catalog === void 0) return [];
		return catalog.providers.map((provider) => ({
			id: localModelRouteId(provider.id, used),
			displayName: provider.name,
			pathPrefix: `/${encodeURIComponent(provider.id)}`,
			models: provider.models.map((model) => ({
				id: model.id,
				name: model.name
			}))
		}));
	}
	/** Load a persisted `local` plan; `undefined` means this target uses server models. */
	async loadPersistedPlan(targetId) {
		const record = this.store.target(targetId);
		if (record === void 0 || effectiveModelSource(record) !== "local") return void 0;
		const llm = this.options.llm?.();
		return await planLocalLlm(this.store, llm === void 0 ? {} : { llm });
	}
};
//#endregion
//#region src/local-llm/tunnel.ts
/**
* SSH **reverse** tunnel (`forwardIn`) that lets a server profile reach the
* client-host bridge.
*
* Forwarding out (client → server loopback) is the module next door; this one is
* the mirror image. sshd binds an OS-assigned port on the **server's** loopback
* (`forwardIn('127.0.0.1', 0)`), and every inbound `tcp connection` event for
* that port is accepted and piped to the bridge listening on the client's
* `127.0.0.1`. Both ends stay on loopback: the tunnel is reachable only through
* the SSH connection, and sshd's `AllowTcpForwarding` gate is surfaced as the
* coded `local-llm-forwarding-unavailable` failure (no silent fallback).
*/
/** How long `unforwardIn` may take before the tunnel considers itself closed anyway. */
const CLOSE_TIMEOUT_MS = 2e3;
/**
* Ask the SSH server for a loopback reverse forward and wire accepted channels
* to the client-host bridge.
* @param client - connected ssh2 transport (or a mock implementing the subset).
* @param options - bridge port to dial.
* @returns the bound remote port plus an idempotent `close`.
* @throws LocalLlmError `local-llm-forwarding-unavailable` when sshd refuses.
*/
async function startRemoteForward(client, options) {
	const listenHost = options.listenHost ?? "127.0.0.1";
	if (listenHost !== "127.0.0.1") throw new LocalLlmError("local-llm-forwarding-unavailable", "the reverse tunnel may only bind 127.0.0.1");
	if (!Number.isInteger(options.targetPort) || options.targetPort < 1 || options.targetPort > 65535) throw new LocalLlmError("local-llm-forwarding-unavailable", `the reverse tunnel target port ${String(options.targetPort)} is invalid`);
	const port = await new Promise((resolve, reject) => {
		try {
			client.forwardIn(listenHost, 0, (error, boundPort) => {
				if (error !== void 0) {
					reject(new LocalLlmError("local-llm-forwarding-unavailable", `the SSH server refused to open a reverse tunnel (AllowTcpForwarding?): ${error.message}`));
					return;
				}
				if (boundPort === void 0 || boundPort < 1) {
					reject(new LocalLlmError("local-llm-forwarding-unavailable", "the SSH server accepted the reverse tunnel without a bind port"));
					return;
				}
				resolve(boundPort);
			});
		} catch (error) {
			reject(new LocalLlmError("local-llm-forwarding-unavailable", `the reverse tunnel could not be requested: ${error instanceof Error ? error.message : String(error)}`));
		}
	});
	const sockets = /* @__PURE__ */ new Set();
	const listener = (info, accept, reject) => {
		if (info.destPort !== port) {
			reject();
			return;
		}
		let channel;
		try {
			channel = accept();
		} catch {
			return;
		}
		const socket = connect({
			host: "127.0.0.1",
			port: options.targetPort
		});
		sockets.add(socket);
		let finished = false;
		const finish = () => {
			if (finished) return;
			finished = true;
			sockets.delete(socket);
			socket.destroy();
			channel.destroy();
		};
		socket.on("error", finish);
		socket.on("close", finish);
		channel.on("error", finish);
		channel.on("close", finish);
		channel.on("end", () => {
			socket.end();
		});
		socket.on("end", () => {
			channel.end();
		});
		channel.pipe(socket);
		socket.pipe(channel);
	};
	client.on("tcp connection", listener);
	let closing;
	return {
		port,
		close() {
			closing ??= (async () => {
				try {
					client.off("tcp connection", listener);
				} catch {}
				for (const socket of sockets) socket.destroy();
				sockets.clear();
				await new Promise((resolve) => {
					let settled = false;
					const done = () => {
						if (settled) return;
						settled = true;
						clearTimeout(timer);
						resolve();
					};
					const timer = setTimeout(done, CLOSE_TIMEOUT_MS);
					timer.unref?.();
					try {
						client.unforwardIn(listenHost, port, () => {
							done();
						});
					} catch {
						done();
					}
				});
			})();
			return closing;
		}
	};
}
/**
* Adapt a live ssh2 client into the `remoteForward` seam `ProfileConnection`
* exposes (kept as a factory so the connector owns the client lifetime).
* @param client - connected ssh2 transport.
*/
function createRemoteForward(client) {
	return async (options) => await startRemoteForward(client, options);
}
//#endregion
//#region src/ssh/forward.ts
/**
* ssh2 local forwarding (`direct-tcpip`) for the v1 client host.
*
* The v1 architecture keeps **one SSH connection per target** and carries every
* byte of both P1 (client host → server plugin API) and P2 (browser → portal →
* official UI) through `forwardOut` channels on it:
*
* - HTTP: `ForwardHttpAgent` is an `http.Agent` whose `createConnection` opens a
*   forwarded channel instead of a TCP socket, so Node's own HTTP client (with
*   its request/response, streaming and upgrade semantics) can be reused.
* - WebSocket: {@link SshForwarder.open} returns the raw duplex; the portal
*   writes the HTTP upgrade request itself and then pipes both directions.
*
* Nothing here knows about DSH, profiles or cookies: this module is the single
* place that turns "an open SSH client" into "a socket to the server's loopback".
* Errors are coded so the portal/plugin layer can map them onto the protocol's
* `tunnel-unavailable` / `upstream-timeout` responses.
*/
/** Default place the closed end of a forwarded channel lives. */
const DEFAULT_FORWARD_HOST = "127.0.0.1";
/** A coded forwarding failure (`tunnel-unavailable` / `upstream-timeout`). */
var ForwardError = class extends Error {
	code;
	cause;
	constructor(code, message, cause) {
		super(scrubSecrets(message));
		this.code = code;
		this.cause = cause;
		this.name = "ForwardError";
	}
};
/**
* Open one `direct-tcpip` channel on an already-connected ssh2 client.
*
* The ssh2 callback API is bridged onto a promise; a timeout or an abort closes
* a channel that arrives late, so a cancelled request cannot leak a forward.
* @param client - connected ssh2 client (its lifetime stays with the caller).
* @param destination - far-side host/port; host defaults to loopback.
* @param options - source address and open deadline.
* @param signal - cancellation of the open (does not undo a completed open).
* @returns the forwarded duplex.
*/
async function forwardOut(client, destination, options = {}, signal) {
	if (signal?.aborted === true) throw new ForwardError("tunnel-unavailable", "the tunnel request was cancelled");
	const timeoutMs = options.timeoutMs ?? 1e4;
	const sourceHost = options.source?.host ?? "127.0.0.1";
	const sourcePort = options.source?.port ?? 0;
	const destHost = destination.host ?? "127.0.0.1";
	return await new Promise((resolve, reject) => {
		let settled = false;
		let stream;
		const timer = setTimeout(() => {
			finish(new ForwardError("upstream-timeout", `opening a tunnel to ${destHost}:${destination.port} timed out after ${timeoutMs} ms`));
		}, timeoutMs);
		timer.unref?.();
		const onAbort = () => {
			finish(new ForwardError("tunnel-unavailable", "the tunnel request was cancelled"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		const cleanup = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		};
		const finish = (error) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (error !== void 0) {
				stream?.destroy();
				reject(error);
				return;
			}
			resolve(stream);
		};
		try {
			client.forwardOut(sourceHost, sourcePort, destHost, destination.port, (error, channel) => {
				if (error != null) {
					finish(new ForwardError("tunnel-unavailable", `cannot open a tunnel to ${destHost}:${destination.port}: ${error.message}`, error));
					return;
				}
				if (settled) {
					channel.destroy();
					return;
				}
				stream = channel;
				finish(void 0);
			});
		} catch (error) {
			finish(new ForwardError("tunnel-unavailable", `cannot open a tunnel to ${destHost}:${destination.port}: ${error instanceof Error ? error.message : String(error)}`, error));
		}
	});
}
/**
* One target's forwarding facade over a shared ssh2 client.
*
* Creating an agent per target is free; `close()` only destroys the agents this
* instance handed out. It never calls `client.end()` — the SSH connection is
* owned by the target channel, not by a proxy facade.
*/
var SshForwarder = class {
	client;
	defaults;
	agents = /* @__PURE__ */ new Set();
	constructor(client, defaults = {}) {
		this.client = client;
		this.defaults = defaults;
	}
	/** Open a raw forwarded channel (WebSocket / manual HTTP upgrade). */
	async open(destination, signal) {
		return await forwardOut(this.client, destination, {
			...this.defaults.source === void 0 ? {} : { source: this.defaults.source },
			...this.defaults.timeoutMs === void 0 ? {} : { timeoutMs: this.defaults.timeoutMs }
		}, signal);
	}
	/** An `http.Agent` whose sockets are forwarded channels to `destination`. */
	httpAgent(destination) {
		const agent = new ForwardHttpAgent(this, destination);
		this.agents.add(agent);
		return agent;
	}
	/** Destroy every agent created by this facade (its sockets die with them). */
	close() {
		for (const agent of this.agents) agent.destroy();
		this.agents.clear();
	}
};
/**
* `http.Agent` backed by {@link SshForwarder}.
*
* `keepAlive` stays off: the far side is a loopback HTTP server behind one SSH
* channel, and an idle forwarded channel would outlive the request that opened
* it while the profile server may restart underneath. WebSocket frames do not
* use this agent (they need the raw upgrade socket).
*/
var ForwardHttpAgent = class extends Agent {
	forwarder;
	destination;
	constructor(forwarder, destination) {
		super({ keepAlive: false });
		this.forwarder = forwarder;
		this.destination = destination;
	}
	createConnection(_options, callback) {
		this.forwarder.open(this.destination).then((stream) => {
			callback(null, stream);
		}, (error) => {
			callback(error instanceof Error ? error : new ForwardError("tunnel-unavailable", String(error)));
		});
	}
};
/** Decode one HTTP/1.1 chunked body (headers already stripped). */
function decodeChunkedBody(input) {
	const chunks = [];
	let offset = 0;
	for (;;) {
		const lineEnd = input.indexOf("\r\n", offset);
		if (lineEnd === -1) break;
		const sizeText = input.subarray(offset, lineEnd).toString("ascii").split(";")[0]?.trim() ?? "";
		const size = Number.parseInt(sizeText, 16);
		if (!Number.isFinite(size)) break;
		offset = lineEnd + 2;
		if (size === 0) break;
		chunks.push(input.subarray(offset, offset + size));
		offset += size + 2;
	}
	return Buffer.concat(chunks);
}
/** Whether a chunked body contains its terminating zero-size chunk. */
function chunkedBodyComplete(input) {
	let offset = 0;
	for (;;) {
		const lineEnd = input.indexOf("\r\n", offset);
		if (lineEnd === -1) return false;
		const sizeText = input.subarray(offset, lineEnd).toString("ascii").split(";")[0]?.trim() ?? "";
		const size = Number.parseInt(sizeText, 16);
		if (!Number.isFinite(size)) return false;
		offset = lineEnd + 2;
		if (size === 0) {
			const trailerEnd = input.indexOf("\r\n", offset);
			return trailerEnd !== -1 && trailerEnd === offset;
		}
		if (input.length < offset + size + 2) return false;
		offset += size + 2;
	}
}
/**
* One bounded HTTP request through a forwarded channel, without Node's HTTP stack.
*
* Used for the profile server's **startup probe** (`GET /?token=…` must answer
* 303) where a full `http.request` through the agent would be more machinery
* than needed, and by tests that assert the exact bytes on the far side.
* The caller supplies the raw forwarded stream; this helper writes a minimal
* HTTP/1.1 request and parses the status line, headers and body until the
* connection closes.
* @param stream - an open forwarded channel.
* @param request - method, path, headers and optional body.
* @param options - byte ceiling and deadline.
* @returns the parsed response.
*/
async function sendForwardedHttp(stream, request, options = {}) {
	const maxBytes = options.maxBytes ?? 65536;
	const timeoutMs = options.timeoutMs ?? 1e4;
	const headers = { ...request.headers ?? {} };
	const body = request.body;
	if (body !== void 0 && headers["content-length"] === void 0) headers["content-length"] = String(body.length);
	if (headers.host === void 0) headers.host = DEFAULT_FORWARD_HOST;
	const requestBytes = Buffer.from([
		`${request.method} ${request.path} HTTP/1.1`,
		...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
		"connection: close",
		"",
		""
	].join("\r\n"), "utf8");
	return await new Promise((resolve, reject) => {
		let settled = false;
		let received = Buffer.alloc(0);
		const timer = setTimeout(() => {
			finish(new ForwardError("upstream-timeout", `the forwarded request did not answer within ${timeoutMs} ms`));
		}, timeoutMs);
		timer.unref?.();
		const finish = (error, result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			stream.destroy();
			if (error !== void 0) reject(error);
			else resolve(result);
		};
		stream.on("data", (chunk) => {
			received = Buffer.concat([received, chunk]);
			const end = received.indexOf("\r\n\r\n");
			if (end === -1) {
				if (received.length > maxBytes) finish(new ForwardError("tunnel-unavailable", "the forwarded response headers are too large"));
				return;
			}
			const [statusLine, ...rawHeaders] = received.subarray(0, end).toString("utf8").split("\r\n");
			const status = Number.parseInt((statusLine ?? "").split(" ")[1] ?? "0", 10);
			const parsedHeaders = {};
			for (const line of rawHeaders) {
				const at = line.indexOf(":");
				if (at > 0) parsedHeaders[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
			}
			const contentLength = Number.parseInt(parsedHeaders["content-length"] ?? "", 10);
			const bodyBytes = received.subarray(end + 4);
			if (String(parsedHeaders["transfer-encoding"] ?? "").toLowerCase().includes("chunked")) {
				if (chunkedBodyComplete(bodyBytes)) {
					finish(void 0, {
						status,
						headers: parsedHeaders,
						body: decodeChunkedBody(bodyBytes)
					});
					return;
				}
				if (bodyBytes.length > maxBytes) finish(new ForwardError("tunnel-unavailable", "the forwarded response is too large"));
				return;
			}
			if (Number.isNaN(contentLength)) {
				if (bodyBytes.length > maxBytes) finish(new ForwardError("tunnel-unavailable", "the forwarded response is too large"));
				return;
			}
			if (bodyBytes.length >= contentLength) finish(void 0, {
				status,
				headers: parsedHeaders,
				body: bodyBytes.subarray(0, contentLength)
			});
		});
		stream.once("error", (error) => {
			finish(new ForwardError("tunnel-unavailable", `forwarded connection failed: ${error.message}`, error));
		});
		stream.once("close", () => {
			if (settled) return;
			const end = received.indexOf("\r\n\r\n");
			if (end === -1) {
				finish(new ForwardError("tunnel-unavailable", "the forwarded connection closed before a response arrived"));
				return;
			}
			const [statusLine, ...rawHeaders] = received.subarray(0, end).toString("utf8").split("\r\n");
			const status = Number.parseInt((statusLine ?? "").split(" ")[1] ?? "0", 10);
			const parsedHeaders = {};
			for (const line of rawHeaders) {
				const at = line.indexOf(":");
				if (at > 0) parsedHeaders[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
			}
			const bodyBytes = received.subarray(end + 4);
			finish(void 0, {
				status,
				headers: parsedHeaders,
				body: String(parsedHeaders["transfer-encoding"] ?? "").includes("chunked") ? decodeChunkedBody(bodyBytes) : bodyBytes
			});
		});
		stream.write(requestBytes);
		if (body !== void 0) stream.write(body);
	});
}
//#endregion
//#region src/provision/package-build.ts
/**
* Server-package staging: turn `@deepseek-ai/dsh@<version>` into one
* self-contained tarball for a target platform.
*
* Shared by the connect flow (`assets.buildDshRuntimePackage`, host-local
* staging as an offline fallback) and the release build script
* (`scripts/build-server-package.mjs`, CI matrix). One implementation, so the
* CI artifact and the locally staged one cannot drift.
*
* Native-module closure is the load-bearing part: packages like
* `node-addon-require-builtin` resolve their binding through *sibling* npm
* packages named `<name>-<platform>-<arch>[-gnu|msvc]`, which a plain install
* resolves for the **host** platform (a Mac staging for linux gets darwin
* bindings — the round-4 failure). We therefore explicitly install the
* target-platform sibling at the same version and strip foreign-platform
* siblings, then assert the result.
*/
/** npm registries, tried in order: CN mirror first. */
const STAGE_REGISTRIES = ["https://registry.npmmirror.com", "https://registry.npmjs.org"];
/** Pure-JS postinstall scripts allowed during staging; native builds excluded
*  (a cross-OS build would only produce host binaries, and the remote world
*  does not require a pty provider). */
const BUILD_ALLOWLIST = [
	"@google/genai",
	"protobufjs",
	"koffi"
];
/** Run a local command as a promise with a byte ceiling. */
function execLocal$1(command, args, timeoutMs) {
	return new Promise((resolve, reject) => {
		execFile(command, args, {
			timeout: timeoutMs,
			maxBuffer: 67108864
		}, (error, stdout, stderr) => {
			if (error != null) {
				resolve({
					code: typeof error.code === "number" ? error.code : 1,
					stdout: stdout.toString(),
					stderr: stderr.toString()
				});
				return;
			}
			resolve({
				code: 0,
				stdout: stdout.toString(),
				stderr: stderr.toString()
			});
		});
	});
}
/**
* The staged dsh package's own bin entry (a JS file).
*
* Resolved from the package manifest rather than `<stage>/node_modules/.bin/dsh`
* because that shim is a **shell** script: `node .bin/dsh` cannot parse it, and
* the old POSIX-only probe also hard-coded `/usr/bin/env`, which does not exist
* on Windows — a Windows host must be able to stage packages for WSL targets.
* @param stage - the staging directory.
* @returns the absolute bin script path, or undefined when the package is absent.
*/
async function resolveDshBin(stage) {
	const manifestPath = join(stage, "node_modules", "@deepseek-ai", "dsh", "package.json");
	let manifest;
	try {
		manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	} catch {
		return;
	}
	const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.dsh;
	if (typeof bin !== "string" || bin === "") return void 0;
	const script = join(dirname(manifestPath), bin);
	return await stat(script).then((entry) => entry.isFile() ? script : void 0, () => void 0);
}
/**
* The sibling-package suffix that `node-addon-require-builtin` resolves for a
* target. glibc/musl only exists on linux.
*/
function bindingPackageSuffix(platform, arch, libc) {
	const base = `${platform}-${arch}`;
	return platform === "linux" && libc !== "" ? `${base}-${libc}` : base;
}
/** Binding families that ship one sibling package per platform flavour.
*  `require-builtin` is required on the target; `system` (and any future
*  family) is stripped when foreign so shipped trees are target-only. */
const BINDING_FAMILIES = ["node-addon-require-builtin", "node-addon-system"];
const PLATFORM_FLAVOURS = [
	"darwin",
	"linux",
	"win32"
];
/** Split one `.pnpm` entry into a known binding family + flavour, if it is one. */
function bindingOf(dirName) {
	const withoutVersion = dirName.replace(/@[^@]+$/, "");
	for (const family of BINDING_FAMILIES) {
		const index = withoutVersion.lastIndexOf(family);
		if (index < 0) continue;
		const flavour = withoutVersion.slice(index + family.length + 1);
		if (PLATFORM_FLAVOURS.some((platform) => flavour === platform || flavour.startsWith(`${platform}-`))) return {
			family,
			flavour
		};
	}
}
/** Whether one `.pnpm` directory name belongs to a foreign-platform binding. */
/**
* The flavour one binding family must carry for one target.
*
* `node-addon-require-builtin` publishes `-<libc>` flavours
* (`linux-x64-gnu`); `node-addon-system` publishes plain `<platform>-<arch>`
* (`linux-x64`) and has no win32 build at all. Comparing the system family
* against the require-builtin suffix made every freshly installed system sibling
* look foreign, so the staging step deleted the binding it had just added.
*/
function targetFlavour(family, suffix) {
	return family === "node-addon-require-builtin" ? suffix : suffix.split("-").slice(0, 2).join("-");
}
/** Whether one `.pnpm` entry is a native binding for some *other* flavour. */
function isForeignBindingDir(dirName, suffix) {
	const binding = bindingOf(dirName);
	if (binding === void 0) return false;
	return binding.flavour !== targetFlavour(binding.family, suffix);
}
/**
* Stage `@deepseek-ai/dsh@<version>` for one target platform into `stage`.
* @returns the installed dsh version (from the launcher probe).
*/
async function stageDshPackage(options) {
	const notify = options.onProgress ?? (() => {});
	await mkdir(options.stage, { recursive: true });
	await writeFile(join(options.stage, "package.json"), `${JSON.stringify({
		name: "dsh-remote-server",
		private: true,
		pnpm: { onlyBuiltDependencies: BUILD_ALLOWLIST }
	}, null, 2)}\n`);
	const failures = [];
	for (const registry of STAGE_REGISTRIES) {
		await writeFile(join(options.stage, ".npmrc"), [
			`registry=${registry}`,
			`supported-architectures[]=os=${options.platform}`,
			`supported-architectures[]=cpu=${options.arch}`,
			...options.platform === "linux" && options.libc !== "" ? [`supported-architectures[]=libc=${options.libc}`] : [],
			""
		].join("\n"));
		notify(`staging @deepseek-ai/dsh@${options.version} via pnpm (${registry.replace("https://", "")}, target ${options.platform}-${options.arch}${options.libc === "" ? "" : `-${options.libc}`})`);
		const add = await execLocal$1(options.nodeBin, [
			options.pnpmCjs,
			"-C",
			options.stage,
			"add",
			`@deepseek-ai/dsh@${options.version}`,
			"--loglevel=warn"
		], 6e5);
		const launcher = await resolveDshBin(options.stage);
		if (launcher === void 0) {
			failures.push(`${registry}: pnpm produced no dsh launcher: ${(add.stderr || add.stdout || `exit ${add.code}`).trim().slice(-300)}`);
			continue;
		}
		await fixNativeClosure({
			stage: options.stage,
			platform: options.platform,
			arch: options.arch,
			libc: options.libc,
			nodeBin: options.nodeBin,
			pnpmCjs: options.pnpmCjs,
			onProgress: notify
		});
		const probe = await execLocal$1(options.nodeBin, [launcher, "--version"], 12e4);
		const version = probe.stdout.trim().split("\n")[0] ?? "";
		if (probe.code !== 0 || version === "") {
			failures.push(`${registry}: launcher probe failed: ${(probe.stderr || probe.stdout || `exit ${probe.code}`).trim().slice(-300)}`);
			continue;
		}
		return version;
	}
	throw new Error(`could not stage @deepseek-ai/dsh@${options.version}; attempts: ${failures.join(" ;; ")}`);
}
/**
* Install the target-platform native binding siblings and remove the
* host-platform ones the installer resolved by mistake.
*/
async function fixNativeClosure(options) {
	const notify = options.onProgress ?? (() => {});
	const pnpmDir = join(options.stage, "node_modules", ".pnpm");
	const suffix = bindingPackageSuffix(options.platform, options.arch, options.libc);
	const plainSuffix = `${options.platform}-${options.arch}`;
	/**
	* Native packages whose platform sibling must be installed for the *target*.
	*
	* `node-addon-require-builtin` is the PTC/`import.meta.main` addon and carries
	* `-<libc>`; `@deepseek-ai/node-addon-system` is the flock/file-lock addon and
	* publishes plain `<platform>-<arch>` siblings — and **no win32 build at all**,
	* so a Windows-hosted staging run installs none of them and the deployed server
	* dies the first time the session store takes a lock:
	* `Cannot find module '@deepseek-ai/node-addon-system-linux-x64/package.json'`.
	*/
	const families = [{
		main: /^node-addon-require-builtin(?:-.+)?@(\d[^/]*)$/,
		target: `node-addon-require-builtin-${suffix}`
	}, {
		main: /^@deepseek-ai\+node-addon-system@(\d[^/]*)$/,
		target: `@deepseek-ai/node-addon-system-${plainSuffix}`
	}];
	for (const family of families) {
		const entries = await readdir(pnpmDir).catch(() => []);
		let version = "";
		for (const entry of entries) {
			const match = family.main.exec(entry);
			if (match !== null) {
				version = match[1] ?? "";
				break;
			}
		}
		if (version === "") continue;
		const flatName = family.target.replace("/", "+");
		if (entries.some((entry) => entry.startsWith(`${flatName}@`))) continue;
		notify(`adding native binding ${family.target}@${version}`);
		const add = await execLocal$1(options.nodeBin, [
			options.pnpmCjs,
			"-C",
			options.stage,
			"add",
			`${family.target}@${version}`,
			"--loglevel=warn",
			"--save-optional=false"
		], 6e5);
		if (add.code !== 0 && add.stdout === "" && add.stderr !== "") notify(`binding install warning`, (add.stderr || add.stdout).slice(-300));
	}
	for (const entry of await readdir(pnpmDir).catch(() => [])) if (isForeignBindingDir(entry, suffix)) {
		notify(`removing foreign native binding ${entry}`);
		await rm(join(pnpmDir, entry), {
			recursive: true,
			force: true
		}).catch(() => {});
	}
}
/**
* Assert the staged tree is target-only: every shipped native binding dir
* must match the target flavour. Throws with the offending names otherwise.
*/
async function assertTargetOnly(stage, platform, arch, libc) {
	const suffix = bindingPackageSuffix(platform, arch, libc);
	const plainSuffix = `${platform}-${arch}`;
	const pnpmDir = join(stage, "node_modules", ".pnpm");
	const entries = await readdir(pnpmDir).catch(() => []);
	const foreign = entries.filter((entry) => isForeignBindingDir(entry, suffix));
	if (foreign.length > 0) throw new Error(`staged package contains foreign native bindings for ${platform}-${arch}${libc === "" ? "" : `-${libc}`}: ${foreign.join(", ")}`);
	if (!entries.some((entry) => entry.startsWith(`node-addon-require-builtin-${suffix}@`))) throw new Error(`staged package is missing the native binding node-addon-require-builtin-${suffix}`);
	if (entries.some((entry) => entry.startsWith("@deepseek-ai+node-addon-system@")) && !entries.some((entry) => entry.startsWith(`@deepseek-ai+node-addon-system-${plainSuffix}@`))) throw new Error(`staged package is missing the native binding @deepseek-ai/node-addon-system-${plainSuffix}`);
}
//#endregion
//#region src/provision/assets.ts
/**
* Host-side asset cache for the remote deployment.
*
* ZCode-style: the *local* machine fetches each component once, verifies it,
* and caches it under `~/.dsh/remote-assets/`. Deployments then upload from
* this cache (or skip entirely when the remote marker matches), so a flaky
* remote network never blocks a connect — only the first connect for a new
* platform downloads anything, and repeated connects are pure uploads.
*/
/** Node distribution versions tried in order. Node 24 is required: the dsh
*  CLI entrypoint dispatches on `import.meta.main`, which Node 22 leaves
*  undefined (the CLI then silently does nothing). The harness itself ships
*  Node 24, so the deployed runtime matches the version dsh is tested with. */
const NODE_VERSION_CANDIDATES = ["v24.21.0"];
/** Download roots, tried in order: CN mirror first, then the official one.
*  Each takes the release-relative file path (`v24.21.0/node-v24.21.0-….tar.gz`). */
const NODE_MIRRORS = [(file) => `https://registry.npmmirror.com/-/binary/node/${file}`, (file) => `https://nodejs.org/dist/${file}`];
/** Run a local command as a promise with a byte ceiling. */
function execLocal(command, args, timeoutMs) {
	return new Promise((resolve, reject) => {
		execFile(command, args, {
			timeout: timeoutMs,
			maxBuffer: 1048576
		}, (error, stdout, stderr) => {
			if (error != null) {
				resolve({
					code: typeof error.code === "number" ? error.code : 1,
					stdout: stdout.toString(),
					stderr: stderr.toString()
				});
				return;
			}
			resolve({
				code: 0,
				stdout: stdout.toString(),
				stderr: stderr.toString()
			});
		});
	});
}
/** The host-side cache root: `~/.dsh/remote-assets/`. */
function remoteAssetsCacheDir() {
	return join(homedir(), ".dsh", "remote-assets");
}
/**
* The most informative single line an error can give — never empty.
*
* `error.message` is empty for several `fs`/stream failures, and those were
* exactly the ones this module reported as `cannot hash <path>: ` (alpha52, on a
* Windows host): a diagnostic dead end. Fall back to the code, then the name.
*/
function errorReason(error) {
	if (error instanceof Error) {
		if (error.message !== "") return error.message;
		const code = error.code;
		if (code !== void 0 && String(code) !== "") return String(code);
		return error.name;
	}
	return String(error);
}
/**
* sha256 of one file, **streamed through `node:crypto`**.
*
* Was `execLocal('shasum', ['-a', '256', path])`, which is POSIX-only: on a
* Windows host `shasum`/`sha256sum` do not exist, so the very first `ensureNode`
* on any fresh remote died at `cannot hash …` (empty reason, no `.ready` marker)
* — the whole upload path was unusable from Windows. Node's own crypto is always
* present, and streaming keeps a 57 MB node tarball / 144 MB server package out
* of memory (same style as `sha256OfFiles`).
* @param path - absolute local file path.
* @returns the lowercase hex digest.
*/
async function sha256File(path) {
	const hash = createHash("sha256");
	try {
		for await (const chunk of createReadStream(path)) hash.update(chunk);
	} catch (error) {
		throw new Error(`cannot hash ${path}: ${errorReason(error)}`);
	}
	return hash.digest("hex");
}
/** The `<platformArch>` segment used in cache paths and remote markers. */
function platformArch(platform, arch) {
	return `${platform}-${arch}`;
}
/**
* The cached Node tarball for one platform, downloading it on first use.
* Every candidate (version × mirror) is probed with a short HEAD request
* before the real download; a failed download removes the partial file and
* moves to the next candidate, mirroring the remote-install fallback.
*/
async function ensureNodeTarball(options) {
	const notify = options.onProgress ?? (() => {});
	const dir = join(remoteAssetsCacheDir(), platformArch(options.platform, options.arch));
	await mkdir(dir, { recursive: true });
	const failures = [];
	for (const version of NODE_VERSION_CANDIDATES) {
		const file = `node-${version}-${options.platform}-${options.arch}.tar.gz`;
		const cached = join(dir, file);
		const ready = `${cached}.ready`;
		try {
			const [info, marker] = await Promise.all([stat(cached), readFile(ready, "utf8").catch(() => "")]);
			if (info.isFile() && info.size > 1048576) {
				const sha256 = await sha256File(cached);
				if (marker.trim() === sha256) {
					notify(`node ${version} cached locally (${(info.size / 1024 / 1024).toFixed(1)} MB)`);
					return {
						path: cached,
						sha256,
						size: info.size,
						version
					};
				}
			}
		} catch {}
		const relative = `${version}/node-${version}-${options.platform}-${options.arch}.tar.gz`;
		for (const mirror of NODE_MIRRORS) {
			const url = mirror(relative);
			notify(`downloading node ${version} from ${new URL(url).host}`);
			await rm(cached, { force: true });
			const result = await execLocal("curl", [
				"-fL",
				"--retry",
				"2",
				"--connect-timeout",
				"20",
				"-m",
				"600",
				"-o",
				cached,
				url
			], 62e4);
			if (result.code !== 0) {
				const reason = (result.stderr || result.stdout || `curl exit ${result.code}`).trim().split("\n").slice(-3).join(" | ");
				failures.push(`${new URL(url).host}: ${reason}`);
				notify(`download from ${new URL(url).host} failed; trying the next source`, reason);
				await rm(cached, { force: true });
				continue;
			}
			const info = await stat(cached);
			const sha256 = await sha256File(cached);
			await writeFile(ready, `${sha256}\n`);
			notify(`node ${version} downloaded (${(info.size / 1024 / 1024).toFixed(1)} MB)`);
			return {
				path: cached,
				sha256,
				size: info.size,
				version
			};
		}
	}
	throw new Error(`could not download a Node 22 distribution for ${options.platform}-${options.arch}; attempts: ${failures.join(" ;; ")}`);
}
/**
* Locate a host-side pnpm launcher.
*
* The harness ships one under `~/.dsh/dsh-runtimes/<runtime>/dependencies/pnpm`
* with a matching Node; a PATH pnpm/node pair is the fallback.
*
* The probe has to accept **both** layouts: the packaged runtimes ship
* `pnpm/bin/pnpm.mjs` and (on Windows) `node/bin/node.exe`, while older/POSIX
* trees use `pnpm.cjs` and `node/bin/node`. Matching only the POSIX spelling is
* what made every Windows-hosted staging attempt die with "cannot find a host
* pnpm" — and staging is unavoidable for WSL targets, which only exist on
* Windows.
*/
async function findHostPnpm() {
	const env = process.env;
	if (env.DSH_HOST_PNPM !== void 0 && env.DSH_HOST_NODE !== void 0) return {
		node: env.DSH_HOST_NODE,
		pnpm: env.DSH_HOST_PNPM
	};
	const isFile = (path) => stat(path).then((entry) => entry.isFile(), () => false);
	/** First existing candidate, or undefined. */
	const firstFile = async (candidates) => {
		for (const candidate of candidates) if (await isFile(candidate)) return candidate;
	};
	const runtimes = join(homedir(), ".dsh", "dsh-runtimes");
	for (const entry of await readdir(runtimes).catch(() => [])) {
		const deps = join(runtimes, entry, "dependencies");
		const pnpm = await firstFile([
			join(deps, "pnpm", "bin", "pnpm.cjs"),
			join(deps, "pnpm", "bin", "pnpm.mjs"),
			join(deps, "pnpm", "pnpm.cjs")
		]);
		const node = await firstFile([
			join(deps, "node", "bin", "node"),
			join(deps, "node", "bin", "node.exe"),
			join(deps, "node", "node.exe")
		]);
		if (pnpm !== void 0 && node !== void 0) return {
			node,
			pnpm
		};
	}
	throw new Error("cannot find a host pnpm to stage the dsh runtime package");
}
//#endregion
//#region src/provision/dsh-scan.ts
/** First line of the scan output; anything else means "not our script". */
const SCAN_MAGIC = "@@RW@@SCAN@@1";
/**
* The scan script.
*
* Order matters in two places: `DSHHOME` must be known before `PATH` is built
* (the deployed node lives under it), and the `--version` probes must run after
* that `PATH` is exported.
* @param options - optional `DSH_HOME` override (the target's configured value).
* @returns one POSIX shell body; the caller wraps it with `sh()`/`exec`.
*/
function scanDshScript(options = {}) {
	const dshHome = (options.dshHome ?? "").trim().replace(/\/+$/u, "");
	const homeRelative = /^~\/(?:[^"$`\\\s]+)$/u.test(dshHome) ? dshHome.slice(2) : "";
	return [
		"set -u",
		"if [ -n \"${ZSH_VERSION:-}\" ]; then setopt nonomatch 2>/dev/null || true; fi",
		"export LC_ALL=C",
		dshHome === "" || !dshHome.startsWith("/") && homeRelative === "" ? "DSHHOME=$(printf '%s' \"${DSH_HOME:-$HOME/.dsh}\")" : homeRelative !== "" ? `DSHHOME="$HOME/${homeRelative}"` : `DSHHOME=${quote(dshHome)}`,
		"export PATH=\"$DSHHOME/server/node/bin:$HOME/.local/bin:$HOME/.bun/bin:$HOME/.volta/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}\"",
		"run() { if command -v timeout >/dev/null 2>&1; then timeout 15 \"$@\"; else \"$@\"; fi }",
		"",
		`printf '%s\\n' '${SCAN_MAGIC}'`,
		"printf 'HOME\\t%s\\n' \"$HOME\"",
		"printf 'DSHHOME\\t%s\\n' \"$DSHHOME\"",
		"printf 'UNAME\\t%s\\n' \"$(uname -s 2>/dev/null)\"",
		"printf 'MACHINE\\t%s\\n' \"$(uname -m 2>/dev/null)\"",
		"printf 'OSTYPE\\t%s\\n' \"$(cat /proc/sys/kernel/ostype 2>/dev/null | head -1)\"",
		"printf 'LDD\\t%s\\n' \"$(ldd --version 2>&1 | head -1)\"",
		"for t in tar sha256sum shasum curl wget; do",
		"  p=$(command -v \"$t\" 2>/dev/null || true)",
		"  [ -n \"$p\" ] || continue",
		"  printf 'TOOL\\t%s\\t%s\\n' \"$t\" \"$p\"",
		"done",
		"",
		"for n in \"$(command -v node 2>/dev/null || true)\" \\",
		"         \"$HOME\"/.nvm/versions/node/*/bin/node \\",
		"         \"$HOME\"/.local/share/fnm/node-versions/*/installation/bin/node \\",
		"         \"$HOME/.volta/bin/node\" \"$HOME/.bun/bin/node\" \\",
		"         \"/usr/local/bin/node\" \"/usr/bin/node\"; do",
		"  [ -n \"$n\" ] || continue",
		"  [ -x \"$n\" ] || continue",
		"  printf 'NODE\\t%s\\t%s\\n' \"$n\" \"$(run \"$n\" -v 2>/dev/null | head -1)\"",
		"done",
		"",
		"SEEN='|'",
		"for c in \"$(command -v dsh 2>/dev/null || true)\" \\",
		"         \"$HOME/.local/bin/dsh\" \"$HOME/.bun/bin/dsh\" \"$HOME/.volta/bin/dsh\" \\",
		"         \"$HOME/.local/share/pnpm/dsh\" \\",
		"         \"$HOME\"/.nvm/versions/node/*/bin/dsh \\",
		"         \"$HOME\"/.local/share/fnm/node-versions/*/installation/bin/dsh \\",
		"         \"/usr/local/bin/dsh\" \"/usr/bin/dsh\" \"/opt/homebrew/bin/dsh\" \\",
		"         \"$DSHHOME/server/dsh/node_modules/.bin/dsh\"; do",
		"  [ -n \"$c\" ] || continue",
		"  [ -e \"$c\" ] || continue",
		"  real=$(readlink -f \"$c\" 2>/dev/null || printf '%s' \"$c\")",
		"  [ -n \"$real\" ] || real=$c",
		"  case \"$SEEN\" in *\"|$real|\"*) continue ;; esac",
		"  SEEN=\"$SEEN$real|\"",
		"  out=$(run \"$c\" --version 2>/dev/null); code=$?",
		"  ver=$(printf '%s' \"$out\" | head -1)",
		"  sb=$(head -1 \"$real\" 2>/dev/null)",
		"  node=''",
		"  case \"$sb\" in",
		"    '#!'*'/env node'*) node=$(command -v node 2>/dev/null || true) ;;",
		"    '#!'*'/env '*node*) node=$(command -v node 2>/dev/null || true) ;;",
		"    '#!'*node*) node=$(printf '%s' \"$sb\" | sed -e 's/^#![[:space:]]*//' -e 's/[[:space:]].*$//') ;;",
		"  esac",
		"  case \"$node\" in /*) ;; *) node='' ;; esac",
		"  [ -x \"$node\" ] || node=''",
		"  # A shebang that names no node + a deployed node = the uploaded dsh shim.",
		"  if [ -z \"$node\" ]; then",
		"    case \"$sb\" in",
		"      '#!'*) if [ -x \"$DSHHOME/server/node/bin/node\" ]; then node=\"$DSHHOME/server/node/bin/node\"; fi ;;",
		"    esac",
		"  fi",
		"  printf 'DSH\\t%s\\t%s\\t%s\\t%s\\t%s\\n' \"$c\" \"$real\" \"$ver\" \"$code\" \"$node\"",
		"done",
		"",
		"for p in \"$DSHHOME\"/profiles/*; do",
		"  [ -d \"$p\" ] || continue",
		"  name=$(printf '%s' \"$p\" | sed -e 's|.*/profiles/||')",
		"  pv=''; sha=''",
		"  manifest=\"$p/node_modules/dsh-remote-workspace/package.json\"",
		"  if [ -f \"$manifest\" ]; then",
		"    pv=$(tr -d '\\n' < \"$manifest\" | sed -n 's/.*\"version\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p')",
		"  fi",
		"  if [ -f \"$p/.dsh-rw-plugin.json\" ]; then",
		"    sha=$(tr -d '\\n' < \"$p/.dsh-rw-plugin.json\" | sed -n 's/.*\"sha256\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p')",
		"  fi",
		"  printf 'PLUGIN\\t%s\\t%s\\t%s\\n' \"$name\" \"$pv\" \"$sha\"",
		"done",
		"",
		"if [ -f \"$DSHHOME/server/.components/plugin.json\" ]; then",
		"  m=''",
		"  m=$(tr -d '\\n' < \"$DSHHOME/server/.components/plugin.json\" | head -c 400 2>/dev/null || true)",
		"  printf 'MARKER\\t%s\\t%s\\n' \"$DSHHOME/server/.components/plugin.json\" \"$m\"",
		"fi",
		`printf '%s\\n' 'END'`
	].join("\n");
}
/** Quote one value for the POSIX shell (single quotes, `'` escaped). */
function quote(value) {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
/**
* Fold the scan script's TAB records into a {@link DshScan}.
*
* Rules that matter to callers:
*
* 1. A first line other than {@link SCAN_MAGIC} **throws**: returning an empty
*    result would let a new client read an old/garbled answer as "this host has
*    no dsh" and quietly send the user down the upload path.
* 2. Records with the wrong field count are dropped. That is also how a path
*    containing a TAB (or one split across lines) is discarded, which is what
*    keeps a hostile filename out of the launcher list.
* 3. Unknown record kinds are ignored, so an older host can keep parsing a
*    newer script's output.
* 4. A missing {@link SCAN_END} means the output was truncated by the transport
*    byte cap: the records that did arrive stay usable and `truncated` is set.
*
* @param stdout - the script's stdout.
* @returns the parsed scan.
* @throws Error `unsupported scan output` when the magic line is absent.
*/
function parseDshScanOutput(stdout) {
	const lines = stdout.split("\n").map((line) => line.replace(/\r$/u, ""));
	if ((lines[0] ?? "").trim() !== "@@RW@@SCAN@@1") throw new Error("unsupported scan output");
	let home;
	let dshHome;
	let platform;
	let machine;
	let ostype;
	let ldd;
	let marker;
	const tools = [];
	const nodes = [];
	const launchers = [];
	const profiles = [];
	let truncated = true;
	for (const line of lines.slice(1)) {
		if (line === "") continue;
		if (line === "END") {
			truncated = false;
			break;
		}
		const fields = line.split("	");
		switch (fields[0]) {
			case "HOME":
				if (fields.length === 2) home = fields[1];
				break;
			case "DSHHOME":
				if (fields.length === 2) dshHome = fields[1];
				break;
			case "UNAME":
				if (fields.length === 2) platform = fields[1];
				break;
			case "MACHINE":
				if (fields.length === 2) machine = fields[1];
				break;
			case "OSTYPE":
				if (fields.length === 2) ostype = fields[1];
				break;
			case "LDD":
				if (fields.length === 2) ldd = fields[1];
				break;
			case "TOOL": {
				if (fields.length !== 3) break;
				const name = fields[1];
				const path = fields[2];
				if (name === void 0 || path === void 0 || name === "" || path === "") break;
				tools.push({
					name,
					path
				});
				break;
			}
			case "NODE": {
				if (fields.length !== 3) break;
				const path = fields[1];
				if (path === void 0 || path === "") break;
				nodes.push({
					path,
					version: fields[2] ?? ""
				});
				break;
			}
			case "DSH": {
				if (fields.length !== 6) break;
				const path = fields[1];
				const realPath = fields[2];
				const version = fields[3];
				const codeText = fields[4];
				const node = fields[5];
				if (path === void 0 || path === "" || codeText === void 0) break;
				const exitCode = Number.parseInt(codeText, 10);
				if (!Number.isFinite(exitCode)) break;
				launchers.push({
					path,
					realPath: realPath === void 0 || realPath === "" ? path : realPath,
					version: version ?? "",
					exitCode,
					...node === void 0 || node === "" ? {} : { nodePath: node }
				});
				break;
			}
			case "PLUGIN": {
				if (fields.length !== 4) break;
				const name = fields[1];
				if (name === void 0 || name === "") break;
				const pluginVersion = fields[2] ?? "";
				const pluginSha256 = fields[3] ?? "";
				profiles.push({
					name,
					...pluginVersion === "" ? {} : { pluginVersion },
					...pluginSha256 === "" ? {} : { pluginSha256 }
				});
				break;
			}
			case "MARKER": {
				if (fields.length !== 3) break;
				const text = fields[2];
				if (text !== void 0 && text !== "") marker = text;
				break;
			}
		}
	}
	return {
		...home === void 0 || home === "" ? {} : { home },
		...dshHome === void 0 || dshHome === "" ? {} : { dshHome },
		...platform === void 0 || platform === "" ? {} : { platform },
		...machine === void 0 || machine === "" ? {} : { machine },
		...ostype === void 0 || ostype === "" ? {} : { ostype },
		...ldd === void 0 || ldd === "" ? {} : { ldd },
		...marker === void 0 ? {} : { marker },
		tools,
		nodes,
		launchers,
		profiles,
		truncated
	};
}
//#endregion
//#region src/provision/platform.ts
/** Platform facts from one probe (v1 scan/connect). */
function probeFactsFrom(options) {
	const ostype = options.ostype.trim().toLowerCase();
	const unameSystem = options.uname.trim();
	const platform = ostype.includes("linux") || unameSystem === "Darwin" && ostype === "linux" ? "linux" : unameSystem === "Darwin" ? "darwin" : "linux";
	const rawArch = options.machine.trim();
	const arch = rawArch === "arm64" || rawArch === "aarch64" ? "arm64" : "x64";
	const ldd = options.ldd.trim().toLowerCase();
	return {
		platform,
		arch,
		libc: platform !== "linux" ? "" : ldd.includes("musl") ? "musl" : "gnu"
	};
}
//#endregion
//#region src/provision/runtime.ts
/**
* Independent / global DSH runtime planning for one client.
*
* The v1 start command is:
*
*   DSH_HOME=… PATH="<runtime>/node/bin:<runtime>/dsh/node_modules/.bin:$PATH"
*   exec <runtime>/dsh/node_modules/.bin/dsh --profile … --host 127.0.0.1 --port 0 --no-open
*
* so one client's isolated runtime is a fixed directory with two components, a
* Node distribution and a dsh install:
*
*   $DSH_HOME/remote-workspace/<clientId>/runtime/node/bin/node
*   $DSH_HOME/remote-workspace/<clientId>/runtime/dsh/node_modules/.bin/dsh
*
* The artifact (client cache upload first, server download only as a fallback)
* is a tarball carrying `node/` and `dsh/` at its root. The remote script below
* verifies the checksum, proves both binaries answer, and atomically swaps the
* two directories; the marker is written last.
*
* Global runtimes are only **detected** here: installing or upgrading the
* server's shared dsh affects every profile on that host and therefore requires
* an explicit confirmation (protocol D10/§6).
*/
/** A coded runtime failure. */
var RuntimeError = class extends Error {
	code;
	details;
	constructor(code, message, details) {
		super(scrubSecrets(message));
		this.code = code;
		this.details = details;
		this.name = "RuntimeError";
	}
};
/** `$DSH_HOME/remote-workspace/<clientId>/runtime` for one client. */
function runtimePaths(dshHome, clientId) {
	if (!dshHome.startsWith("/")) throw new Error(`DSH_HOME must be an absolute server path, got ${JSON.stringify(dshHome)}`);
	if (!isClientId(clientId)) throw new Error(`invalid clientId ${JSON.stringify(clientId)}`);
	const home = dshHome.replace(/\/+$/u, "");
	const stateDir = `${home}/remote-workspace/${clientId}`;
	const root = `${stateDir}/runtime`;
	return {
		dshHome: home,
		clientId,
		root,
		nodeDir: `${root}/node`,
		nodeBin: `${root}/node/bin/node`,
		dshDir: `${root}/dsh`,
		launcher: `${root}/dsh/node_modules/.bin/dsh`,
		stateDir,
		stagingDir: `${stateDir}/staging`,
		markerPath: `${root}/.dsh-rw-runtime.json`
	};
}
/** The artifact name for one dsh release + platform. */
function runtimeArtifactName(version, platformArch) {
	return `dsh-runtime-${version}-${platformArch}.tar.gz`;
}
/** The client-side cache path of one runtime artifact. */
function runtimeArtifactCachePath(cacheDir, version, platformArch) {
	return join(cacheDir, runtimeArtifactName(version, platformArch));
}
/**
* Prove the runtime's native require-builtin addon still loads.
*
* macOS hardens the signed Node binary in the runtime; npm ships the addon
* ad-hoc signed with no Team ID, so a freshly staged runtime can fail at
* `require('node-addon-require-builtin')` even though `node -v` and
* `dsh --version` answer. The artifact installer re-signs Node ad hoc with
* `disable-library-validation`, and this probe is what makes an already
* installed broken runtime eligible for repair instead of being reported as
* reusable.
*/
function runtimeAddonProbeCommand(paths) {
	const script = [
		"const fs = require('node:fs')",
		"const path = require('node:path')",
		"const { createRequire } = require('node:module')",
		"const pnpm = path.join(process.argv[1], 'node_modules', '.pnpm')",
		"const appBoot = fs.readdirSync(pnpm).filter(name => name.startsWith('@deepseek-ai+dsh-app-boot@'))",
		"if (appBoot.length === 0) process.exit(2)",
		"const req = createRequire(path.join(pnpm, appBoot[0], 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'package.json'))",
		"try { req.resolve('node-addon-require-builtin') } catch { process.exit(0) }",
		"req('node-addon-require-builtin')"
	].join("\n");
	return `${shellQuote(paths.nodeBin)} -e ${shellQuote(script)} ${shellQuote(paths.dshDir)}`;
}
/**
* Find the runtime artifact in the client cache (or an explicit env path).
*
* The artifact is client-uploaded, so the file must be local. A missing file is
* `undefined` (the caller may download it); a path is returned only when it is a
* regular non-empty file.
*/
async function resolveRuntimeArtifact(options) {
	const override = options.env?.["DSH_RW_RUNTIME_ARTIFACT"];
	const path = override !== void 0 && override !== "" ? override : runtimeArtifactCachePath(options.cacheDir, options.version, options.platformArch);
	try {
		const info = await stat(path);
		return info.isFile() && info.size > 1024 ? path : void 0;
	} catch {
		return;
	}
}
/** Parse the installed-runtime marker; a missing/corrupt marker means reinstall. */
function parseRuntimeMarker(text) {
	const trimmed = text.trim();
	if (trimmed === "") return void 0;
	try {
		const parsed = JSON.parse(trimmed);
		if (parsed.kind !== "isolated" || typeof parsed.version !== "string" || !/^[0-9a-f]{64}$/u.test(parsed.sha256 ?? "") || typeof parsed.platformArch !== "string" || typeof parsed.installedAt !== "string") return void 0;
		return parsed;
	} catch {
		return;
	}
}
/**
* Decide the isolated runtime action.
*
* Isolated runtimes are per-client and may be installed/upgraded without asking
* (D10); a marker with the same version+digest is reused. A global runtime is
* detected only; a missing/incompatible global dsh becomes a
* `requiresConfirmation: true` plan that the host must surface as a button.
*/
function planRuntime(options) {
	if (options.kind === "global") {
		const global = options.global;
		if (global !== void 0 && global.compatible && global.version === options.expectedVersion) return {
			kind: "global",
			action: "reuse",
			requiresConfirmation: false,
			reason: `reuse the server's global dsh ${global.version} at ${global.launcher}`
		};
		return {
			kind: "global",
			action: global === void 0 ? "install" : "upgrade",
			requiresConfirmation: true,
			reason: global === void 0 ? `no global dsh ${options.expectedVersion} was found; installing one changes every profile on the server` : `the server's global dsh ${global.version} is not the verified ${options.expectedVersion}; upgrading it changes every profile on the server`
		};
	}
	const marker = options.marker;
	if (marker !== void 0 && marker.version === options.expectedVersion && (options.artifact === void 0 || marker.sha256 === options.artifact.sha256)) return {
		kind: "isolated",
		action: "reuse",
		requiresConfirmation: false,
		reason: `isolated runtime ${options.expectedVersion} already installed`
	};
	return {
		kind: "isolated",
		action: marker === void 0 ? "install" : "upgrade",
		requiresConfirmation: false,
		reason: marker === void 0 ? `installing isolated runtime ${options.expectedVersion}` : `upgrading isolated runtime ${marker.version} → ${options.expectedVersion}`
	};
}
/**
* The remote install body for one isolated runtime artifact.
*
* Layout contract: the tarball contains `node/` and `dsh/` at its root. The
* script stages the extraction, checks the checksum (when a hash tool exists),
* proves `node/bin/node -v` and the dsh launcher answer, then replaces both
* directories. A failed run leaves the previous runtime untouched.
*/
function runtimeInstallScript(options) {
	const stage = `${options.paths.stagingDir}/runtime`;
	const tarball = `${options.paths.stagingDir}/${options.tarballName}`;
	const marker = {
		kind: "isolated",
		version: options.artifact.version,
		sha256: options.artifact.sha256,
		platformArch: options.artifact.platformArch,
		installedAt: options.installedAt ?? (/* @__PURE__ */ new Date()).toISOString()
	};
	return [
		"set -eu",
		"umask 022",
		`TAR=${shellQuote(tarball)}`,
		`STAGE=${shellQuote(stage)}`,
		`ROOT=${shellQuote(options.paths.root)}`,
		"test -f \"$TAR\" || { echo \"runtime artifact missing: $TAR\" >&2; exit 10; }",
		"if command -v sha256sum >/dev/null 2>&1; then",
		`  echo ${shellQuote(`${options.artifact.sha256}  ${tarball}`)} | sha256sum -c - >/dev/null 2>&1 || { echo 'runtime sha256 mismatch' >&2; exit 11; }`,
		"elif command -v shasum >/dev/null 2>&1; then",
		`  echo ${shellQuote(`${options.artifact.sha256}  ${tarball}`)} | shasum -a 256 -c - >/dev/null 2>&1 || { echo 'runtime sha256 mismatch' >&2; exit 11; }`,
		"fi",
		"rm -rf \"$STAGE\"",
		`command mkdir -p "$STAGE" "$ROOT" ${shellQuote(options.paths.stagingDir)}`,
		"tar -xzf \"$TAR\" -C \"$STAGE\"",
		"test -e \"$STAGE/node/bin/node\" || { echo \"runtime artifact has no node/bin/node\" >&2; exit 12; }",
		"test -e \"$STAGE/dsh/node_modules/.bin/dsh\" || { echo \"runtime artifact has no dsh launcher\" >&2; exit 13; }",
		`chmod +x "$STAGE/node/bin/node" "$STAGE/dsh/node_modules/.bin/dsh" 2>/dev/null || true`,
		...options.artifact.platformArch.startsWith("darwin-") ? [
			"CODESIGN=/usr/bin/codesign",
			"[ -x \"$CODESIGN\" ] || CODESIGN=codesign",
			"command -v \"$CODESIGN\" >/dev/null 2>&1 || { echo \"codesign is required to install a macOS runtime\" >&2; exit 15; }",
			"ENT=\"$STAGE/node-entitlements.plist\"",
			"cat > \"$ENT\" <<'PLIST'",
			"<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
			"<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
			"<plist version=\"1.0\"><dict>",
			"<key>com.apple.security.cs.allow-jit</key><true/>",
			"<key>com.apple.security.cs.disable-library-validation</key><true/>",
			"</dict></plist>",
			"PLIST",
			"\"$CODESIGN\" --force --sign - --options runtime --entitlements \"$ENT\" \"$STAGE/node/bin/node\" >/dev/null 2>&1 || { echo \"failed to ad-hoc sign the runtime node\" >&2; exit 16; }",
			"rm -f \"$ENT\""
		] : [],
		"got=$(\"$STAGE/node/bin/node\" -v 2>/dev/null || true)",
		"[ -n \"$got\" ] || { echo \"runtime node did not answer -v\" >&2; exit 14; }",
		`rm -rf "$ROOT/node.new" "$ROOT/dsh.new"`,
		`command mv -f "$STAGE/node" "$ROOT/node.new"`,
		`command mv -f "$STAGE/dsh" "$ROOT/dsh.new"`,
		`rm -rf "$ROOT/node" "$ROOT/dsh"`,
		`command mv -f "$ROOT/node.new" "$ROOT/node"`,
		`command mv -f "$ROOT/dsh.new" "$ROOT/dsh"`,
		`printf %s ${shellQuote(`${JSON.stringify(marker)}\n`)} > ${shellQuote(options.paths.markerPath)}`,
		"rm -rf \"$STAGE\" \"$TAR\"",
		"printf 'installed\\n'"
	].join("\n");
}
/** Read the runtime marker from the remote host. */
async function readRuntimeMarker(remote, paths) {
	return parseRuntimeMarker((await remote.exec(`cat ${shellQuote(paths.markerPath)} 2>/dev/null || true`, {
		maxBytes: 4096,
		timeoutMs: 1e4
	})).stdout);
}
/**
* Install or upgrade one isolated runtime from a local artifact (upload path).
*
* The artifact is uploaded to the client's staging directory and the pure
* {@link runtimeInstallScript} performs verification and the atomic swap. The
* caller stops the profile server first (a running process may hold files in
* the old runtime) and restarts it afterwards.
*/
async function installIsolatedRuntime(options) {
	const tarballName = options.artifact.name;
	const stagingPath = `${options.paths.stagingDir}/${tarballName}`;
	await options.remote.exec(`command mkdir -p ${shellQuote(options.paths.stagingDir)}`, {
		maxBytes: 1024,
		timeoutMs: 15e3
	});
	await options.remote.writeFile(stagingPath, options.content);
	const result = await options.remote.exec(runtimeInstallScript({
		paths: options.paths,
		artifact: options.artifact,
		tarballName,
		...options.installedAt === void 0 ? {} : { installedAt: options.installedAt.toISOString() }
	}), {
		maxBytes: 65536,
		timeoutMs: 3e5
	});
	if (result.code !== 0) throw new RuntimeError("runtime-install-failed", `installing the isolated runtime for ${options.paths.clientId} failed (exit ${result.code ?? "signal"}): ${scrubSecrets(result.stderr.trim().slice(-2e3))}`);
	return {
		installed: true,
		marker: {
			kind: "isolated",
			version: options.artifact.version,
			sha256: options.artifact.sha256,
			platformArch: options.artifact.platformArch,
			installedAt: (options.installedAt ?? /* @__PURE__ */ new Date()).toISOString()
		}
	};
}
/** The `PATH` prefixes the start command needs for one isolated runtime. */
function runtimePathPrefixes(paths) {
	return [`${paths.nodeDir}/bin`, `${paths.dshDir}/node_modules/.bin`];
}
/** The start-command `PATH` assignment for a runtime (pure; shared with tests). */
function runtimePathAssignment(paths) {
	return pathAssignment(runtimePathPrefixes(paths));
}
//#endregion
//#region src/provision/runtime-artifact.ts
/**
* Build one isolated DSH runtime artifact when the client cache has no
* platform-matched release artifact.
*
* The published artifact has two top-level directories — `node/` (a complete
* Node distribution) and `dsh/` (an installed `@deepseek-ai/dsh@<version>`) —
* because the remote profile needs both: its launcher PATH starts with
* `<node>/bin` and `<dsh>/node_modules/.bin`. This is the same layout the
* server repository's `scripts/build-runtime-artifact.mjs` publishes.
*
* This is deliberately a *fallback*: `resolveRuntime` first checks the cache
* (and `DSH_RW_RUNTIME_ARTIFACT`), and only calls this builder when neither is
* available. Building needs a host pnpm and npm/node downloads, so it is slower
* than an upload; the caller reports its progress on the connect step.
*/
/** One command that must succeed; its stderr is kept for the thrown error. */
async function run(command, args, timeoutMs) {
	const result = await execLocal$1(command, [...args], timeoutMs);
	if (result.code !== 0) throw new Error(`${command} ${args[0] ?? ""} failed (exit ${String(result.code)}): ${(result.stderr || result.stdout).trim().slice(-600)}`);
}
/**
* A cached artifact is usable when it is a regular file with real content and,
* when a `.sha256` sidecar exists, matches it. The sidecar is optional for
* backward compatibility with artifacts uploaded before this fallback existed.
*/
async function usable(path) {
	try {
		const info = await stat(path);
		if (!info.isFile() || info.size <= 1048576) return false;
		const sidecar = await readFile(`${path}.sha256`, "utf8").catch(() => void 0);
		if (sidecar === void 0) return true;
		const expected = sidecar.trim().split(/\s+/)[0]?.toLowerCase();
		if (expected === void 0 || !/^[a-f0-9]{64}$/.test(expected)) return false;
		return (await sha256File(path)).toLowerCase() === expected;
	} catch {
		return false;
	}
}
/**
* Extract a Node tarball into `<work>/node`.
*
* The official archives contain one top-level directory; renaming it avoids a
* full second copy of a ~100 MB tree. `bin/node` is required so a corrupt
* download fails before a 178 MB artifact is packed.
*/
async function extractNode(archive, work, onProgress) {
	const unpack = join(work, "node-unpack");
	await mkdir(unpack, { recursive: true });
	onProgress("正在解压 Node 运行时…");
	await run("tar", [
		"-xzf",
		resolve(archive),
		"-C",
		unpack
	], 12e4);
	const directory = (await readdir(unpack, { withFileTypes: true })).find((entry) => entry.isDirectory());
	if (directory === void 0) throw new Error("the Node archive has no top-level directory");
	const source = join(unpack, directory.name);
	const nodeBin = await stat(join(source, "bin", "node")).catch(() => void 0);
	if (nodeBin === void 0 || !nodeBin.isFile()) throw new Error("the Node archive has no bin/node");
	const target = join(work, "node");
	await rename(source, target);
	await rm(unpack, {
		recursive: true,
		force: true
	}).catch(() => void 0);
	return target;
}
/**
* Build a `node/` + `dsh/` runtime tarball for one target platform.
*
* The target platform is the *remote* one; the staging commands always use the
* host's Node/pnpm. That distinction is why `stageDshPackage` gets the host Node
* while the downloaded Node tree is only packaged for the remote.
*/
async function buildRuntimeArtifact(options) {
	const notify = options.onProgress ?? (() => {});
	const platformArch = `${options.platform}-${options.arch}`;
	const dir = options.cacheDir ?? remoteAssetsCacheDir();
	await mkdir(dir, { recursive: true });
	const path = join(dir, runtimeArtifactName(options.version, platformArch));
	if (await usable(path)) {
		const info = await stat(path);
		const sha256 = await sha256File(path);
		notify(`已复用本地构建的运行时 ${options.version} (${(info.size / 1024 / 1024).toFixed(1)} MB)`);
		return {
			path,
			sha256,
			size: info.size
		};
	}
	const node = await ensureNodeTarball({
		platform: options.platform,
		arch: options.arch,
		onProgress: notify
	});
	const host = await findHostPnpm();
	const work = join(tmpdir(), `dsh-runtime-build-${process.pid}-${Date.now()}`);
	const partial = join(dir, `.${basename(path)}.${process.pid}.partial`);
	await mkdir(work, { recursive: true });
	try {
		await extractNode(node.path, work, notify);
		const dshStage = join(work, "dsh");
		await mkdir(dshStage, { recursive: true });
		notify(`正在打包 @deepseek-ai/dsh@${options.version} (${platformArch})…`);
		await stageDshPackage({
			stage: dshStage,
			version: options.version,
			platform: options.platform,
			arch: options.arch,
			libc: options.platform === "linux" ? "gnu" : "",
			nodeBin: host.node,
			pnpmCjs: host.pnpm,
			onProgress: notify
		});
		await assertTargetOnly(dshStage, options.platform, options.arch, options.platform === "linux" ? "gnu" : "");
		notify("正在生成运行时压缩包…");
		await run("tar", [
			"-czf",
			partial,
			"-C",
			work,
			"node",
			"dsh"
		], 9e5);
		await rename(partial, path);
		const info = await stat(path);
		const sha256 = await sha256File(path);
		await writeFile(`${path}.sha256`, `${sha256}  ${runtimeArtifactName(options.version, platformArch)}\n`, "utf8");
		notify(`运行时已构建 ${(info.size / 1024 / 1024).toFixed(1)} MB`, path);
		return {
			path,
			sha256,
			size: info.size
		};
	} finally {
		await rm(partial, { force: true }).catch(() => void 0);
		await rm(work, {
			recursive: true,
			force: true
		}).catch(() => void 0);
	}
}
//#endregion
//#region src/provision/profile-lifecycle.ts
/** Startup line, anchored: `dsh web: http://127.0.0.1:<port>/?token=<43 chars>`. */
const PROFILE_STARTUP_PATTERN = /^dsh web: http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+)$/u;
/** How long a profile server may take to print its startup line. */
const PROFILE_STARTUP_TIMEOUT_MS = 15e3;
/** The server plugin package installed into the per-client profile. */
const PROFILE_SERVER_PLUGIN = "dsh-remote-workspace-server";
/** Profile lease path, relative to the profile directory (server plugin writes it). */
const PROFILE_LEASE_PATH = ".dsh-rw/lease.json";
/** Profile layer patch file rewritten by the client on every connect. */
const PROFILE_PATCH_FILE = "cordis.patch.yml";
/** Strip trailing slashes so path joins are stable. */
function normalizeDshHome(dshHome) {
	const trimmed = dshHome.trim();
	if (trimmed === "" || !trimmed.startsWith("/")) throw new Error(`DSH_HOME must be an absolute server path, got ${JSON.stringify(dshHome)}`);
	return trimmed.replace(/\/+$/u, "");
}
/**
* The fixed v1 layout for one client.
* @param dshHome - absolute server `$DSH_HOME`.
* @param clientId - the client's stable 12-hex id.
*/
function profilePaths(dshHome, clientId) {
	const home = normalizeDshHome(dshHome);
	if (!isClientId(clientId)) throw new Error(`invalid clientId ${JSON.stringify(clientId)}`);
	const profile = profileNameFor(clientId);
	const profileDir = `${home}/profiles/${profile}`;
	const stateDir = `${home}/remote-workspace/profiles/${profile}`;
	return {
		dshHome: home,
		clientId,
		profile,
		profileDir,
		stateDir,
		logPath: `${stateDir}/server.log`,
		pidPath: `${stateDir}/server.pid`,
		leasePath: `${profileDir}/${PROFILE_LEASE_PATH}`,
		pluginDir: `${profileDir}/node_modules/${PROFILE_SERVER_PLUGIN}`
	};
}
/**
* Parse one startup line.
*
* Anchored on purpose: the log is append-only and may contain unrelated dsh
* output; a greedy or unanchored match could pick a port from a diagnostic.
* @param text - one line (a trailing `\r` is tolerated for manually copied logs).
*/
function parseProfileStartupLine(text) {
	const match = PROFILE_STARTUP_PATTERN.exec(text.trim());
	if (match === null) return void 0;
	const port = Number.parseInt(match[1] ?? "", 10);
	const token = match[2] ?? "";
	if (!Number.isInteger(port) || port < 1 || port > 65535 || token === "") return void 0;
	return {
		port,
		token
	};
}
/** Find the last startup line in a log, when the log has one. */
function findProfileStartup(text) {
	const lines = text.split("\n");
	for (let index = lines.length - 1; index >= 0; index--) {
		const parsed = parseProfileStartupLine(lines[index] ?? "");
		if (parsed !== void 0) return parsed;
	}
}
/** Parse a pid file; non-numeric/garbage content is a stale marker, not a pid. */
function parsePidFile(text) {
	const value = text.trim();
	if (!/^\d+$/u.test(value)) return void 0;
	const pid = Number.parseInt(value, 10);
	return Number.isInteger(pid) && pid > 1 && pid <= 2147483647 ? pid : void 0;
}
/**
* Build shell `NAME='value'` assignments for the profile server's environment.
*
* The values are single-quoted (only `'` needs escaping), so a model bridge key
* placeholder or a path with spaces needs no further quoting. Names are
* validated because they become shell identifiers.
* @param env - extra environment entries; omitted/empty means none.
*/
function profileEnvAssignments(env) {
	if (env === void 0) return "";
	return Object.entries(env).map(([name, value]) => {
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) throw new Error(`invalid profile environment name ${name}`);
		return ` ${name}=${shellQuote(value)}`;
	}).join("");
}
/**
* The detached start body (protocol §3.1).
*
* The launcher flags are the CLI's: `--profile` comes **before** the app args
* (`dsh web --profile p` is rejected by 0.2.1-rc.2 as a second profile).
* @param paths - fixed layout for this client.
* @param options - launcher, PATH prefixes (`node/bin`, `dsh/node_modules/.bin`) and optional port.
*/
function profileStartScript(paths, options) {
	const home = shellQuote(paths.dshHome);
	const launcher = shellQuote(options.launcher);
	const prefixes = [...options.pathPrefixes ?? []];
	const path = prefixes.length === 0 ? "" : `${pathAssignment(prefixes)} `;
	const env = profileEnvAssignments(options.env);
	return [
		"set -eu",
		"umask 077",
		`command mkdir -p ${shellQuote(paths.profileDir)} ${shellQuote(paths.stateDir)}`,
		`: > ${shellQuote(paths.logPath)}`,
		`chmod 700 ${shellQuote(paths.stateDir)} 2>/dev/null || true`,
		`chmod 600 ${shellQuote(paths.logPath)} 2>/dev/null || true`,
		"if command -v setsid >/dev/null 2>&1; then",
		`  setsid nohup env DSH_HOME=${home}${env} ${path}${launcher} --profile ${shellQuote(paths.profile)} --host 127.0.0.1 --port ${options.port ?? 0} --no-open >> ${shellQuote(paths.logPath)} 2>&1 &`,
		"else",
		`  nohup env DSH_HOME=${home}${env} ${path}${launcher} --profile ${shellQuote(paths.profile)} --host 127.0.0.1 --port ${options.port ?? 0} --no-open >> ${shellQuote(paths.logPath)} 2>&1 &`,
		"fi",
		"pid=$!",
		`printf '%s\\n' "$pid" > ${shellQuote(paths.pidPath)}`,
		`chmod 600 ${shellQuote(paths.pidPath)} 2>/dev/null || true`,
		"printf '%s\\n' \"$pid\""
	].join("\n");
}
/**
* The stop body: SIGTERM, wait up to `timeoutMs`, then SIGKILL.
*
* The pid-reuse guard (`ps -p … -o args=` must mention the profile name) is what
* prevents a stale pid file from killing an unrelated process after a reboot.
* When `ps` is unavailable the plain `kill -0` liveness check remains; the
* profile name in the shell's own process table is still verified by the
* `grep` fallback below.
* @param paths - fixed layout.
* @param options - stop budget and a log line set the caller may expect.
*/
function profileStopScript(paths, options = {}) {
	const timeoutMs = Math.max(100, options.timeoutMs ?? 5e3);
	const ticks = Math.max(1, Math.ceil(timeoutMs / 100));
	const hint = options.profileHint ?? paths.profile;
	return [
		"set -u",
		`pidfile=${shellQuote(paths.pidPath)}`,
		`lease=${shellQuote(paths.leasePath)}`,
		"rm -f \"$lease\"",
		"[ -f \"$pidfile\" ] || exit 0",
		"pid=$(cat \"$pidfile\" 2>/dev/null || true)",
		"case \"$pid\" in ''|*[!0-9]*) rm -f \"$pidfile\"; exit 0;; esac",
		"if command -v ps >/dev/null 2>&1; then",
		`  args=$(ps -p "$pid" -o args= 2>/dev/null || true)`,
		`  case "$args" in *${hint.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}*) ;; *) rm -f "$pidfile"; exit 0;; esac`,
		"fi",
		"kill -TERM \"$pid\" 2>/dev/null || true",
		"i=0",
		"while kill -0 \"$pid\" 2>/dev/null; do",
		"  i=$((i+1))",
		`  if [ "$i" -ge ${ticks} ]; then kill -KILL "$pid" 2>/dev/null || true; break; fi`,
		"  sleep 0.1 2>/dev/null || sleep 1",
		"done",
		"rm -f \"$pidfile\"",
		"printf 'stopped\\n'"
	].join("\n");
}
/** A coded lifecycle failure the P3/route layer can expose. */
var ProfileLifecycleError = class extends Error {
	code;
	details;
	constructor(code, message, details) {
		super(message);
		this.code = code;
		this.details = details;
		this.name = "ProfileLifecycleError";
	}
};
/** Last N chars of a log, with secrets scrubbed. */
function scrubbedLogTail(text, max = 2e3) {
	return text.length <= max ? text : text.slice(-max);
}
/** Default sleep. */
const realSleep = async (ms) => {
	await new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
};
/** Read the pid file, or undefined when absent/garbage. */
async function readProfilePid(remote, paths) {
	return parsePidFile((await remote.exec(`cat ${shellQuote(paths.pidPath)} 2>/dev/null || true`, {
		maxBytes: 256,
		timeoutMs: 1e4
	})).stdout);
}
/** Whether a pid is alive (`kill -0`; a permission error still means a live process). */
async function isRemotePidAlive(remote, pid) {
	if (!Number.isInteger(pid) || pid <= 1) return false;
	return (await remote.exec(`kill -0 ${pid} 2>/dev/null; printf '%s' "$?"`, {
		maxBytes: 64,
		timeoutMs: 1e4
	})).stdout.trim() === "0";
}
/** Wait for the startup line, bounded by the protocol's 15 s default. */
async function waitForProfileStartup(remote, paths, options = {}) {
	const timeoutMs = options.timeoutMs ?? 15e3;
	const intervalMs = options.intervalMs ?? 250;
	const sleep = options.sleep ?? realSleep;
	const deadline = Date.now() + Math.max(1, timeoutMs);
	let lastLog = "";
	for (;;) {
		options.signal?.throwIfAborted();
		lastLog = (await remote.exec(`cat ${shellQuote(paths.logPath)} 2>/dev/null || true`, {
			maxBytes: 65536,
			timeoutMs: 1e4
		})).stdout;
		const startup = findProfileStartup(lastLog);
		if (startup !== void 0) return startup;
		const pid = await readProfilePid(remote, paths);
		if (pid !== void 0 && !await isRemotePidAlive(remote, pid)) throw new ProfileLifecycleError("profile-start-failed", `profile server exited before printing its startup line${lastLog.trim() === "" ? "" : `: ${scrubbedLogTail(lastLog)}`}`, {
			pid,
			logTail: scrubbedLogTail(lastLog)
		});
		if (Date.now() >= deadline) throw new ProfileLifecycleError("profile-start-timeout", `profile server did not print its startup line within ${timeoutMs} ms${lastLog.trim() === "" ? "" : `: ${scrubbedLogTail(lastLog)}`}`, { logTail: scrubbedLogTail(lastLog) });
		await sleep(intervalMs);
	}
}
/**
* Start one profile server and wait for its startup line.
*
* The token is returned to the caller (which immediately exchanges it for the
* official cookie and must not keep it after that). A failed start leaves the
* log on disk for diagnosis and stops a process that did come up without a
* parsable line, so a retry does not race an orphan.
* @param remote - profile remote seam.
* @param paths - fixed layout.
* @param options - launcher, PATH prefixes, optional readiness probe and timings.
*/
async function startProfileServer(remote, paths, options) {
	const start = await remote.exec(profileStartScript(paths, {
		launcher: options.launcher,
		...options.pathPrefixes === void 0 ? {} : { pathPrefixes: options.pathPrefixes },
		...options.env === void 0 ? {} : { env: options.env }
	}), {
		maxBytes: 4096,
		timeoutMs: 3e4
	});
	if (start.code !== 0) throw new ProfileLifecycleError("profile-start-failed", `the profile server could not be launched (exit ${start.code ?? "signal"}): ${scrubbedLogTail(start.stderr.trim())}`, { stderr: scrubbedLogTail(start.stderr) });
	let startup;
	try {
		startup = await waitForProfileStartup(remote, paths, {
			...options.timeoutMs === void 0 ? {} : { timeoutMs: options.timeoutMs },
			...options.intervalMs === void 0 ? {} : { intervalMs: options.intervalMs },
			...options.sleep === void 0 ? {} : { sleep: options.sleep },
			...options.signal === void 0 ? {} : { signal: options.signal }
		});
	} catch (error) {
		await stopProfileServer(remote, paths, { sleep: options.sleep }).catch(() => false);
		throw error;
	}
	const pid = await readProfilePid(remote, paths);
	if (pid === void 0) {
		await stopProfileServer(remote, paths, { sleep: options.sleep }).catch(() => false);
		throw new ProfileLifecycleError("profile-start-failed", "the profile server printed its line but no pid was written");
	}
	if (options.probe !== void 0 && !await options.probe(startup)) {
		const tail = await remote.exec(`cat ${shellQuote(paths.logPath)} 2>/dev/null || true`, {
			maxBytes: 65536,
			timeoutMs: 1e4
		}).then((result) => result.stdout).catch(() => "");
		await stopProfileServer(remote, paths, { sleep: options.sleep }).catch(() => false);
		await waitForProfileStopped(remote, paths, { sleep: options.sleep }).catch(() => false);
		throw new ProfileLifecycleError("profile-start-failed", `the profile server printed its token on port ${startup.port} (pid ${pid}) but did not answer its tokenized root request${tail.trim() === "" ? "" : `: ${scrubbedLogTail(tail)}`}`, {
			pid,
			port: startup.port,
			logTail: scrubbedLogTail(tail)
		});
	}
	return {
		paths,
		pid,
		port: startup.port,
		token: startup.token
	};
}
/**
* Stop the profile server for one client.
* @returns true when a process was signalled, false when there was no pid file.
*/
async function stopProfileServer(remote, paths, options = {}) {
	const result = await remote.exec(profileStopScript(paths, { ...options.timeoutMs === void 0 ? {} : { timeoutMs: options.timeoutMs } }), {
		maxBytes: 1024,
		timeoutMs: (options.timeoutMs ?? 5e3) + 15e3
	});
	if (result.code !== 0) throw new ProfileLifecycleError("profile-stop-failed", `the profile server could not be stopped (exit ${result.code ?? "signal"}): ${scrubbedLogTail(result.stderr.trim())}`, { stderr: scrubbedLogTail(result.stderr) });
	return result.stdout.includes("stopped");
}
/**
* Wait until a stopped profile server's pid is gone (best-effort read-back).
*
* `stopProfileServer` already polls the pid in its shell body; this host-side
* check makes the *next* start deterministic instead of racing a process that
* the shell reported gone but that is still unwinding.
*/
async function waitForProfileStopped(remote, paths, options = {}) {
	const timeoutMs = options.timeoutMs ?? 5e3;
	const intervalMs = options.intervalMs ?? 100;
	const sleep = options.sleep ?? realSleep;
	const deadline = Date.now() + Math.max(1, timeoutMs);
	for (;;) {
		const pid = await readProfilePid(remote, paths);
		if (pid === void 0) return true;
		if (!await isRemotePidAlive(remote, pid)) return true;
		if (Date.now() >= deadline) return false;
		await sleep(intervalMs);
	}
}
/**
* The profile's four root files (protocol §3.1 / architecture §12).
*
* `dsh.profile.bundles` must contain the server plugin by name: the plugin
* package supplies its own `cordis.patch.yml`, so this profile never uses a
* package manager and never needs server-side network access.
* @param options - profile name and plugin package name.
*/
function profileStartupFiles(options) {
	const plugin = options.pluginPackage ?? "dsh-remote-workspace-server";
	const packageJson = `${JSON.stringify({
		name: `dsh-profile-${options.profile}`,
		private: true,
		dependencies: { [plugin]: `file:node_modules/${plugin}` },
		dsh: { profile: { bundles: [
			"@deepseek-ai/dsh-base",
			"@deepseek-ai/dsh-web-app",
			plugin
		] } }
	}, null, 2)}\n`;
	return /* @__PURE__ */ new Map([
		["package.json", packageJson],
		["cordis.yml", "[]\n"],
		[PROFILE_PATCH_FILE, "[]\n"],
		["pnpm-workspace.yaml", "packages:\n  - .\n"]
	]);
}
/**
* Write only the profile's four root files (no plugin payload).
*
* The v1 installer uploads the server plugin as a versioned tarball and extracts
* it into `node_modules/` remotely, so the profile files and the package payload
* are installed by separate steps with separate idempotency markers.
* @param remote - profile remote seam.
* @param paths - fixed layout.
*/
async function writeProfileStartupFiles(remote, paths) {
	await remote.exec(`command mkdir -p ${shellQuote(paths.profileDir)} ${shellQuote(paths.pluginDir)}`, {
		maxBytes: 1024,
		timeoutMs: 15e3
	});
	for (const [name, content] of profileStartupFiles({ profile: paths.profile })) await remote.writeFile(`${paths.profileDir}/${name}`, Buffer.from(content, "utf8"));
}
/**
* Rewrite the profile layer patch (`cordis.patch.yml`).
*
* The local model source needs a patch carrying the **random** reverse-tunnel
* port, so it is regenerated on every connect — after the server plugin is
* installed (installation resets the file to `[]`) and before the server
* starts (it reads the patch at boot). `server` source writes `[]` so a
* reconnect under the previous local settings cannot leave a stale route.
* @param remote - profile remote seam.
* @param paths - fixed layout.
* @param content - YAML text (`[]\n` restores the official layers).
*/
async function writeProfilePatch(remote, paths, content) {
	await remote.exec(`command mkdir -p ${shellQuote(paths.profileDir)}`, {
		maxBytes: 1024,
		timeoutMs: 15e3
	});
	await remote.writeFile(`${paths.profileDir}/${PROFILE_PATCH_FILE}`, Buffer.from(content, "utf8"));
}
//#endregion
//#region src/provision/server-plugin.ts
/**
* Offline per-client profile installation of the **server plugin**.
*
* Delivery contract (architecture §12.1 / protocol §14bis):
*
* - the client package ships `assets/server-plugin/dsh-remote-workspace-server-<version>.tgz`
*   where `<version>` is this client plugin's release version (not a DSH version),
*   plus `checksums.json` (`{ "<tarball name>": "<sha256>" }`);
* - a dedicated profile installs it by unpacking (strip `package/`) into
*   `<profileDir>/node_modules/dsh-remote-workspace-server/`, writing the four
*   profile files and the marker `{version, sha256, protocol, dshVersion}`;
*   no server-side network, pnpm or registry is involved;
* - a trimmed/development package without the bundled tarball may download the
*   same name+version and must verify it against `checksums.json`; a bad digest
*   is `server-plugin-integrity-failed`, a mismatched version is
*   `server-plugin-version-mismatch` — neither is installed;
* - the marker matching the expected identity is an idempotent skip; upgrades
*   and downgrades both reinstall through the same path and restart the profile.
*
* The shell body is a pure builder; installation only needs `exec`/`writeFile`,
* so the tarball can be a fixture until the server repository starts building it.
*/
/** Package name the profile bundle list references. */
const SERVER_PLUGIN_PACKAGE = "dsh-remote-workspace-server";
/** Built-in tarball directory inside the client package. */
const SERVER_PLUGIN_ASSET_DIR = "assets/server-plugin";
/** Companion checksum index shipped next to the bundled tarball. */
const SERVER_PLUGIN_CHECKSUMS_FILE = "checksums.json";
/** Marker inside the profile (architecture §12.1 path). */
const SERVER_PLUGIN_MARKER = ".dsh-rw-plugin.json";
/** A coded installer failure. */
var ServerPluginError = class extends Error {
	code;
	constructor(code, message) {
		super(scrubSecrets(message));
		this.code = code;
		this.name = "ServerPluginError";
	}
};
/** The tarball name for one client plugin version. */
function serverPluginTarballName(version) {
	return `${SERVER_PLUGIN_PACKAGE}-${version}.tgz`;
}
/** Extract the version segment of a server-plugin tarball name. */
function versionFromServerPluginTarball(name) {
	const base = name.slice(name.lastIndexOf("/") + 1);
	return new RegExp(`^${SERVER_PLUGIN_PACKAGE}-(.+)\\.tgz$`, "u").exec(base)?.[1];
}
/** The absolute path a bundled tarball is expected at. */
function bundledServerPluginPath(packageRoot, version) {
	return join(packageRoot, SERVER_PLUGIN_ASSET_DIR, serverPluginTarballName(version));
}
/** The checksum index path inside the client package. */
function serverPluginChecksumsPath(packageRoot) {
	return join(packageRoot, SERVER_PLUGIN_ASSET_DIR, SERVER_PLUGIN_CHECKSUMS_FILE);
}
/** The marker path inside a profile. */
function serverPluginMarkerPath(paths) {
	return `${paths.profileDir}/${SERVER_PLUGIN_MARKER}`;
}
/**
* Parse `checksums.json`.
*
* The canonical shape is a flat `{ "<name>": "<sha256>" }`; a nested
* `{ "files": { … } }` object is also accepted because release tooling often
* wraps it. Invalid digests are ignored (the caller then refuses to install).
*/
function parseServerPluginChecksums(text) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return {};
	}
	const record = parsed !== null && typeof parsed === "object" ? parsed : {};
	const nested = record["files"] !== null && typeof record["files"] === "object" ? record["files"] : void 0;
	const out = {};
	for (const source of [record, nested ?? {}]) for (const [name, value] of Object.entries(source)) if (typeof value === "string" && /^[0-9a-f]{64}$/u.test(value)) out[name] = value;
	return out;
}
/** Read the bundled checksum index, if present. */
async function readServerPluginChecksums(packageRoot) {
	try {
		return parseServerPluginChecksums(await readFile(serverPluginChecksumsPath(packageRoot), "utf8"));
	} catch {
		return {};
	}
}
/** The expected digest for one tarball name, if the index has it. */
function expectedServerPluginSha(checksums, version) {
	return checksums[serverPluginTarballName(version)];
}
/**
* Find and verify the bundled tarball.
*
* A missing file is `undefined` (the caller may download it); a file whose
* `checksums.json` entry disagrees is `server-plugin-integrity-failed`; a name
* that encodes another version is `server-plugin-version-mismatch` — installing
* it would put a server plugin of a different release behind this client.
* @param packageRoot - client plugin package root.
* @param version - this client's plugin version.
* @param checksums - pre-read index; read from disk when omitted.
*/
async function findBundledServerPluginTarball(packageRoot, version, checksums) {
	const path = bundledServerPluginPath(packageRoot, version);
	let info;
	try {
		info = await stat(path);
	} catch {
		return;
	}
	if (!info.isFile() || info.size < 256) throw new ServerPluginError("server-plugin-invalid", `the bundled server plugin tarball is empty or unreadable: ${path}`);
	const sha256 = await sha256File(path);
	const expected = expectedServerPluginSha(checksums ?? await readServerPluginChecksums(packageRoot), version);
	if (expected !== void 0 && expected !== sha256) throw new ServerPluginError("server-plugin-integrity-failed", `the bundled server plugin tarball sha256 ${sha256} does not match checksums.json (${expected})`);
	return {
		path,
		name: serverPluginTarballName(version),
		version,
		size: info.size,
		sha256,
		source: "bundled"
	};
}
/**
* Verify one already-downloaded tarball before it is uploaded.
* @param path - absolute local tarball path.
* @param expectedVersion - client plugin version.
* @param expectedSha256 - digest from `checksums.json`; a mismatch is refused.
*/
async function verifyServerPluginTarball(path, expectedVersion, expectedSha256) {
	const name = path.slice(path.lastIndexOf("/") + 1);
	const version = versionFromServerPluginTarball(name);
	if (version === void 0) throw new ServerPluginError("server-plugin-invalid", `not a server plugin tarball name: ${name}`);
	if (version !== expectedVersion) throw new ServerPluginError("server-plugin-version-mismatch", `the server plugin tarball is version ${version}, this client requires ${expectedVersion}`);
	let info;
	try {
		info = await stat(path);
	} catch {
		throw new ServerPluginError("server-plugin-missing", `the server plugin tarball does not exist: ${path}`);
	}
	if (!info.isFile() || info.size < 256) throw new ServerPluginError("server-plugin-invalid", `the server plugin tarball is empty: ${path}`);
	const sha256 = await sha256File(path);
	if (expectedSha256 !== void 0 && expectedSha256 !== sha256) throw new ServerPluginError("server-plugin-integrity-failed", `the server plugin tarball sha256 ${sha256} does not match the expected ${expectedSha256}`);
	return {
		path,
		name,
		version,
		size: info.size,
		sha256,
		source: "download"
	};
}
/**
* Resolve the tarball the installer should upload.
*
* Bundled first. Only when the client package is trimmed/development does this
* fall back to the injected downloader; the resulting bytes are verified against
* the same `checksums.json` entry and the exact version before being returned.
*/
async function resolveServerPluginTarball(options) {
	const checksums = await readServerPluginChecksums(options.packageRoot);
	const bundled = await findBundledServerPluginTarball(options.packageRoot, options.version, checksums);
	if (bundled !== void 0) return bundled;
	const name = serverPluginTarballName(options.version);
	const expected = expectedServerPluginSha(checksums, options.version);
	if (options.downloader === void 0) throw new ServerPluginError("server-plugin-missing", `the client package has no bundled ${name} and no download source is configured${expected === void 0 ? "" : ` (expected sha256 ${expected})`}`);
	const destination = join(options.cacheDir, name);
	await options.downloader.download(name, destination);
	return await verifyServerPluginTarball(destination, options.version, expected);
}
/**
* Whether the installed marker already describes this tarball.
* A missing marker is always a reinstall; protocol/DSH version changes also
* force one (the server plugin must match this client's protocol).
*/
function decideServerPluginInstall(marker, expected) {
	if (marker === void 0) return "install";
	if (marker.version !== expected.version || marker.sha256 !== expected.sha256) return "install";
	if (expected.protocol !== void 0 && marker.protocol !== expected.protocol) return "install";
	if (expected.dshVersion !== void 0 && marker.dshVersion !== expected.dshVersion) return "install";
	return "skip";
}
/** Parse the marker file, tolerating absence/corruption as "reinstall". */
function parseServerPluginMarker(text) {
	const trimmed = text.trim();
	if (trimmed === "") return void 0;
	try {
		const parsed = JSON.parse(trimmed);
		if (typeof parsed.version !== "string" || !/^[0-9a-f]{64}$/u.test(parsed.sha256 ?? "") || parsed.protocol !== 1 || typeof parsed.dshVersion !== "string") return void 0;
		return parsed;
	} catch {
		return;
	}
}
/**
* The server-side install body.
*
* Everything is absolute and staged: the tarball is extracted into
* `<stateDir>/staging/server-plugin`, its manifest name/version are compared to
* the expected values, and only then is the package directory swapped in —
* that is the `package/` strip. The marker is written last, so an interrupted
* upload never looks installed. A downloaded tarball may carry a checksum; the
* caller verifies it on the host too, and this body repeats the check when given.
* @param options - tarball path on the server, profile paths and expected identity.
*/
function serverPluginInstallScript(options) {
	const stage = `${options.paths.stateDir}/staging/server-plugin`;
	const marker = {
		version: options.expectedVersion,
		sha256: options.expectedSha256 ?? "",
		protocol: 1,
		dshVersion: options.dshVersion
	};
	const checksum = options.expectedSha256 === void 0 ? [] : [
		"if command -v sha256sum >/dev/null 2>&1; then",
		`  echo ${shellQuote(`${options.expectedSha256}  ${options.tarballPath}`)} | sha256sum -c - >/dev/null 2>&1 || { echo 'server plugin tarball sha256 mismatch' >&2; exit 12; }`,
		"elif command -v shasum >/dev/null 2>&1; then",
		`  echo ${shellQuote(`${options.expectedSha256}  ${options.tarballPath}`)} | shasum -a 256 -c - >/dev/null 2>&1 || { echo 'server plugin tarball sha256 mismatch' >&2; exit 12; }`,
		"fi"
	];
	return [
		"set -eu",
		"umask 022",
		`TAR=${shellQuote(options.tarballPath)}`,
		`STAGE=${shellQuote(stage)}`,
		`DEST=${shellQuote(options.paths.pluginDir)}`,
		"test -f \"$TAR\" || { echo \"server plugin tarball missing: $TAR\" >&2; exit 10; }",
		...checksum,
		"rm -rf \"$STAGE\"",
		"command mkdir -p \"$STAGE\" \"$(dirname \"$DEST\")\"",
		"tar -xzf \"$TAR\" -C \"$STAGE\"",
		"test -f \"$STAGE/package/package.json\" || { echo \"server plugin tarball has no package/package.json\" >&2; exit 11; }",
		"if tar -tzf \"$TAR\" | grep -Ev '^package(/|$)' | grep -q .; then echo 'server plugin tarball has entries outside package/' >&2; exit 15; fi",
		"if tar -tzf \"$TAR\" | grep -qE '(^|/)\\.\\.(/|$)'; then echo 'server plugin tarball contains .. path segments' >&2; exit 15; fi",
		"name=$(tr -d '\\n' < \"$STAGE/package/package.json\" | sed -n 's/.*\"name\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p')",
		"ver=$(tr -d '\\n' < \"$STAGE/package/package.json\" | sed -n 's/.*\"version\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p')",
		`[ "$name" = ${shellQuote(SERVER_PLUGIN_PACKAGE)} ] || { echo "server plugin package name is $name" >&2; exit 13; }`,
		`[ "$ver" = ${shellQuote(options.expectedVersion)} ] || { echo "server plugin package version is $ver" >&2; exit 14; }`,
		"stage_real=$(cd \"$STAGE\" && pwd -P)",
		"[ \"$(cd \"$STAGE/package\" && pwd -P)\" = \"$stage_real/package\" ] || { echo \"server plugin tarball escaped the staging directory\" >&2; exit 15; }",
		"rm -rf \"$DEST\"",
		"command mv -f \"$STAGE/package\" \"$DEST\"",
		`printf %s ${shellQuote(`${JSON.stringify(marker)}\n`)} > ${shellQuote(serverPluginMarkerPath(options.paths))}`,
		"rm -rf \"$STAGE\"",
		"rm -f \"$TAR\"",
		"printf 'installed\\n'"
	].join("\n");
}
/** Read the installed marker. */
async function readServerPluginMarker(remote, paths) {
	return parseServerPluginMarker((await remote.exec(`cat ${shellQuote(serverPluginMarkerPath(paths))} 2>/dev/null || true`, {
		maxBytes: 4096,
		timeoutMs: 1e4
	})).stdout);
}
/**
* Read one local package directory recursively into remote file entries.
*
* Peer packages copied into the profile are source-only (no `node_modules`) and
* small; this intentionally does not follow a package manager's link layout.
*/
async function collectLocalPackageFiles(packageDir) {
	const files = [];
	const walk = async (directory) => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (entry.name === "node_modules" || entry.name === ".git") continue;
			const absolute = join(directory, entry.name);
			if (entry.isDirectory()) {
				await walk(absolute);
				continue;
			}
			if (!entry.isFile()) continue;
			files.push({
				path: relative(packageDir, absolute).split("\\").join("/"),
				content: await readFile(absolute)
			});
		}
	};
	await walk(packageDir);
	return files;
}
/**
* Copy one runtime peer package into the profile's `node_modules`.
*
* A profile-local plugin resolves its peers from the profile's own
* `node_modules` chain; a server whose global DSH installation is not an
* ancestor (the normal `npm -g` layout) cannot resolve e.g.
* `@deepseek-ai/schemastery`, and the profile server then dies at import time.
* Copying the peer is the offline equivalent of the peer install and never
* touches the shared global DSH.
* @returns the number of files written.
*/
async function installProfilePeerPackage(remote, paths, options) {
	const files = await collectLocalPackageFiles(options.packageDir);
	for (const file of files) await remote.writeFile(`${paths.profileDir}/node_modules/${options.name}/${file.path}`, file.content);
	return files.length;
}
/**
* Install (or reinstall/upgrade/downgrade) the server plugin into one profile.
*
* The profile's four root files are written first; the tarball install script
* swaps the package and marker. The caller restarts the profile server when the
* install changed anything (the running process has the old module graph).
* @returns the marker facts and whether an install actually ran.
*/
async function installServerPlugin(options) {
	if (!options.force) {
		const existing = await readServerPluginMarker(options.remote, options.paths);
		if (decideServerPluginInstall(existing, {
			version: options.tarball.version,
			sha256: options.tarball.sha256,
			protocol: 1,
			dshVersion: options.dshVersion
		}) === "skip") return {
			installed: false,
			marker: existing
		};
	}
	await writeProfileStartupFiles(options.remote, options.paths);
	const content = await readFile(options.tarball.path);
	const stagingPath = `${options.paths.stateDir}/staging/${options.tarball.name}`;
	await options.remote.exec(`command mkdir -p ${shellQuote(`${options.paths.stateDir}/staging`)}`, {
		maxBytes: 1024,
		timeoutMs: 15e3
	});
	await options.remote.writeFile(stagingPath, content);
	const result = await options.remote.exec(serverPluginInstallScript({
		tarballPath: stagingPath,
		paths: options.paths,
		expectedVersion: options.tarball.version,
		dshVersion: options.dshVersion,
		expectedSha256: options.tarball.sha256,
		...options.installedAt === void 0 ? {} : { installedAt: options.installedAt.toISOString() }
	}), {
		maxBytes: 65536,
		timeoutMs: 12e4
	});
	if (result.code !== 0) throw new ServerPluginError("server-plugin-install-failed", `installing the server plugin into ${options.paths.profile} failed (exit ${result.code ?? "signal"}): ${scrubSecrets(result.stderr.trim().slice(-2e3))}`);
	return {
		installed: true,
		marker: {
			version: options.tarball.version,
			sha256: options.tarball.sha256,
			protocol: 1,
			dshVersion: options.dshVersion
		}
	};
}
/** One target's P1 transport over its forwarded SSH channels. */
var TunnelPluginTransport = class {
	forwarder;
	port;
	agent;
	closed = false;
	constructor(forwarder, port) {
		this.forwarder = forwarder;
		this.port = port;
		this.agent = forwarder.httpAgent({ port });
	}
	/** Host header every forwarded P1 request carries. */
	get hostHeader() {
		return `127.0.0.1:${this.port}`;
	}
	headers(request) {
		return {
			...request.headers,
			host: this.hostHeader
		};
	}
	/** One bounded unary HTTP request. */
	async request(request$2) {
		if (this.closed) throw new Error("the P1 transport is closed");
		return await new Promise((resolve, reject) => {
			const timeoutMs = request$2.timeoutMs ?? 3e4;
			const controller = new AbortController();
			const onAbort = () => {
				controller.abort();
			};
			request$2.signal?.addEventListener("abort", onAbort, { once: true });
			const timer = setTimeout(() => {
				controller.abort();
			}, timeoutMs);
			timer.unref?.();
			const requestHandle = request({
				host: "127.0.0.1",
				port: this.port,
				method: request$2.method,
				path: request$2.path,
				headers: this.headers(request$2),
				agent: this.agent,
				signal: controller.signal
			}, (response) => {
				const chunks = [];
				let total = 0;
				response.on("data", (chunk) => {
					total += chunk.length;
					if (total > 67108864) {
						response.destroy();
						finish(/* @__PURE__ */ new Error("the P1 response is too large"));
						return;
					}
					chunks.push(chunk);
				});
				response.once("end", () => {
					finish(void 0, {
						status: response.statusCode ?? 0,
						headers: response.headers,
						body: Buffer.concat(chunks)
					});
				});
				response.once("error", (error) => finish(error));
			});
			const finish = (error, value) => {
				clearTimeout(timer);
				request$2.signal?.removeEventListener("abort", onAbort);
				if (error !== void 0) reject(error);
				else resolve(value);
			};
			requestHandle.once("error", (error) => finish(error));
			if (request$2.body !== void 0) requestHandle.write(request$2.body);
			requestHandle.end();
		});
	}
	/** One streaming (SSE) response: the caller consumes `body`. */
	async stream(request$3) {
		if (this.closed) throw new Error("the P1 transport is closed");
		return await new Promise((resolve, reject) => {
			const controller = new AbortController();
			const onAbort = () => {
				controller.abort();
			};
			request$3.signal?.addEventListener("abort", onAbort, { once: true });
			const timer = setTimeout(() => {
				controller.abort();
			}, request$3.timeoutMs ?? 3e4);
			timer.unref?.();
			const requestHandle = request({
				host: "127.0.0.1",
				port: this.port,
				method: request$3.method,
				path: request$3.path,
				headers: this.headers(request$3),
				agent: this.agent,
				signal: controller.signal
			}, (response) => {
				clearTimeout(timer);
				resolve({
					status: response.statusCode ?? 0,
					headers: response.headers,
					body: response
				});
			});
			requestHandle.once("error", (error) => {
				clearTimeout(timer);
				request$3.signal?.removeEventListener("abort", onAbort);
				reject(error);
			});
			requestHandle.end();
		});
	}
	/** One raw WebSocket upgrade through a fresh forwarded channel. */
	async upgrade(request) {
		if (this.closed) throw new Error("the P1 transport is closed");
		const socket = await this.forwarder.open({ port: this.port }, request.signal);
		const headers = this.headers(request);
		socket.write([
			`${request.method} ${request.path} HTTP/1.1`,
			...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
			"",
			""
		].join("\r\n"));
		const head = await new Promise((resolve, reject) => {
			let received = Buffer.alloc(0);
			const timer = setTimeout(() => {
				socket.destroy();
				reject(/* @__PURE__ */ new Error("the P1 upgrade did not answer in time"));
			}, request.timeoutMs ?? 3e4);
			timer.unref?.();
			const onData = (chunk) => {
				received = Buffer.concat([received, chunk]);
				const end = received.indexOf("\r\n\r\n");
				if (end === -1) return;
				clearTimeout(timer);
				socket.off("data", onData);
				const lines = received.subarray(0, end).toString("utf8").split("\r\n");
				const status = Number.parseInt((lines[0] ?? "").split(" ")[1] ?? "0", 10);
				const parsed = {};
				for (const line of lines.slice(1)) {
					const at = line.indexOf(":");
					if (at > 0) parsed[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
				}
				resolve({
					status,
					headers: parsed,
					rest: received.subarray(end + 4)
				});
			};
			socket.on("data", onData);
			socket.once("error", (error) => {
				clearTimeout(timer);
				reject(error);
			});
		});
		if (head.status !== 101) {
			socket.destroy();
			return {
				status: head.status,
				headers: head.headers,
				socket,
				head: head.rest
			};
		}
		return {
			status: head.status,
			headers: head.headers,
			socket,
			head: head.rest
		};
	}
	/** Destroy the agent and every forwarded channel it handed out. */
	dispose() {
		if (this.closed) return;
		this.closed = true;
		this.agent.destroy();
	}
};
//#endregion
//#region src/session/anchors.ts
/**
* Plugin-private local anchor for a server session shown in **local mode**.
*
* The client's official session/agent layer needs an absolute local `cwd`:
* it `stat`s/realpaths it, and the shell attaches sessions by their recorded
* path. The server's real path is not usable there (it does not exist on this
* machine), so local mode binds the session to an anchor directory.
*
* Requirement D3/§4.2.7: the anchor is **not** a workspace. It must never be
* registered in the official workspace registry (the shared
* `~/.dsh/storages/workspace.json`), must not appear in the client's local
* workspace list, and must be removed when the plugin/connection goes away.
*
* Layout (architecture §9, protocol §5.4):
*
* ```
* $DSH_HOME/remote-workspaces/<clientId>/<targetId>/<hash(workspaceId)>
* ```
*
* The legacy visible-stub root (`$DSH_HOME/remote-workspaces/<targetId>/…`,
* `src/session/remote-guard.ts`) is intentionally a different, shallower shape; the
* legacy guard and its stubs are retired separately (architecture §12), and
* nothing here registers a shell row for the anchor.
*/
/** Legal segment characters; everything else is replaced to keep one path segment. */
function segment(value, label) {
	const trimmed = value.trim();
	if (trimmed === "") throw new Error(`${label} must not be empty`);
	const safe = trimmed.replace(/[^a-zA-Z0-9._-]/g, "-");
	if (safe === "." || safe === ".." || safe.startsWith(".")) throw new Error(`${label} is not a usable path segment: "${value}"`);
	return safe;
}
/** The harness home the session/anchor data lives under. */
function anchorDshHome(env = process.env) {
	const configured = env["DSH_HOME"]?.trim();
	return configured !== void 0 && configured !== "" ? configured : join(homedir(), ".dsh");
}
/**
* Private anchor root for one client.
* @param options - client identity and environment.
* @returns `<DSH_HOME>/remote-workspaces/<clientId>`.
*/
function anchorRoot(options) {
	const env = options.env ?? process.env;
	return join(anchorDshHome(env), "remote-workspaces", segment(options.clientId, "clientId"));
}
/** Stable 16-hex directory name for one server workspace. */
function anchorHash(workspaceId) {
	const trimmed = workspaceId.trim();
	if (trimmed === "") throw new Error("workspaceId must not be empty");
	return createHash("sha256").update(trimmed).digest("hex").slice(0, 16);
}
/**
* Where one server workspace's local anchor lives.
* @param options - client identity and environment.
* @param targetId - stored target id (connection identity, client-local).
* @param workspaceId - server-authoritative workspace id.
* @returns the absolute anchor directory (not created here).
*/
function anchorPathFor(options, targetId, workspaceId) {
	return join(anchorRoot(options), segment(targetId, "targetId"), anchorHash(workspaceId));
}
/** Whether `path` is the root itself or a strict descendant of it. */
function isUnderRoot(root, path) {
	const rel = relative(root, path);
	if (rel === "") return true;
	if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
	return true;
}
/**
* Create one anchor directory (mode 0700) if needed.
* @param root - the client's private anchor root.
* @param path - anchor directory from {@link anchorPathFor}.
* @returns the same path.
* @throws when `path` escapes `root` (never create outside the private root).
*/
async function ensureAnchor(root, path) {
	if (!isUnderRoot(root, path)) throw new Error(`refusing to create an anchor outside "${root}": "${path}"`);
	await mkdir(path, {
		recursive: true,
		mode: 448
	});
	return path;
}
/**
* Remove every anchor of one target. Used on disconnect/delete and on plugin
* disposal; the caller does not need to enumerate workspaces.
* @param root - the client's private anchor root.
* @param targetId - stored target id.
* @returns true when the target directory was removed.
*/
async function removeTargetAnchors(root, targetId) {
	const safe = segment(targetId, "targetId");
	const path = join(root, safe);
	if (!isUnderRoot(root, path) || path === root) return false;
	if (!await stat(path).then(() => true, () => false)) return false;
	return await rm(path, {
		recursive: true,
		force: true
	}).then(() => true, () => false);
}
/**
* In-process map from a workspace's private anchor to its identity.
*
* The routing persistence resolves a session's route from `header.cwd`; in
* local mode that cwd is the private anchor, which is not a workspace-registry
* path. Every anchor this process creates must therefore be registrable here,
* so `createRoutingPersistence`'s facade can answer `routeForCwd` /
* `stubForWorkspace` without a second path algorithm.
*/
var AnchorRegistry = class {
	byWorkspace = /* @__PURE__ */ new Map();
	byPath = /* @__PURE__ */ new Map();
	/** Record one anchor (last registration of the same workspace wins). */
	register(route) {
		const previous = this.byWorkspace.get(route.workspaceId);
		if (previous !== void 0) this.byPath.delete(previous.path);
		this.byWorkspace.set(route.workspaceId, route);
		this.byPath.set(route.path, route);
	}
	/** Resolve a session cwd back to its target/workspace, if it is an anchor. */
	routeForCwd(cwd) {
		if (cwd === void 0 || cwd === "") return void 0;
		return this.byPath.get(cwd);
	}
	/** The anchor path of one workspace, if materialized in this process. */
	pathFor(workspaceId) {
		return this.byWorkspace.get(workspaceId)?.path;
	}
	/** The server-real path is not stored here (the facade's P1 state owns it). */
	entries() {
		return [...this.byWorkspace.values()];
	}
	/** Forget one workspace (disconnect/delete). */
	forget(workspaceId) {
		const route = this.byWorkspace.get(workspaceId);
		if (route === void 0) return;
		this.byWorkspace.delete(workspaceId);
		this.byPath.delete(route.path);
	}
	/** Forget every anchor of one target. */
	forgetTarget(targetId) {
		const removed = [...this.byWorkspace.values()].filter((route) => route.targetId === targetId);
		for (const route of removed) this.forget(route.workspaceId);
		return removed;
	}
};
//#endregion
//#region src/session/executor.ts
/**
* Client-side view of the per-session executor (server / local) state.
*
* The authoritative record is owned by the server plugin (protocol §5.4: one
* `ExecutorRecord` per session, stored under `$DSH_HOME/remote-workspace/state/
* executors/*.json`). This module only orchestrates the **client half** of a
* switch against that record through P1 `executor/*` RPCs, and keeps the
* ordering that makes the hand-off safe:
*
* - server → local: preview (D20) → server cancels + flushes (managed handle is
*   disposed there, or the profile is restarted) → client optionally restarts
*   the profile → local agent may take the write lock.
* - local → server: the **client** must cancel its turn, wait for idle, flush
*   and close the write handle *before* the record says `server`; otherwise two
*   writers would race for the same JSONL artifact.
*
* Ownership of the log itself is never ours: the official JSONL flock decides
* (`session/writer-held`). This module only turns the executor record into a
* predictable UI/state-machine contract.
*
* Wire contract: `doc/refactor-v1-protocol.md` §5.4, §4.3; the shared wire
* types/constants come from `src/protocol.ts` (two-repo contract).
*/
/** Typed failure with a stable P1-style code. */
var ExecutorError = class extends Error {
	code;
	status;
	details;
	constructor(code, message, status = 409, details) {
		super(message);
		this.code = code;
		this.status = status;
		this.details = details;
		this.name = "ExecutorError";
	}
};
/** A switch for the same session is already in flight in this process. */
var ExecutorSwitchBusyError = class extends ExecutorError {
	constructor(sessionId) {
		super("executor-switch-busy", `session "${sessionId}" already has an executor switch in flight`);
		this.name = "ExecutorSwitchBusyError";
	}
};
/** D20: switching would cancel another session's running turn without consent. */
var ExecutorSwitchConfirmRequiredError = class extends ExecutorError {
	activeTurns;
	constructor(activeTurns) {
		super("executor-switch-confirm-required", `switching would cancel ${activeTurns.length} running turn(s) in this profile`, 409, { activeTurns });
		this.activeTurns = activeTurns;
		this.name = "ExecutorSwitchConfirmRequiredError";
	}
};
/** The profile server still says the session runs on the other executor. */
var ExecutorModeConflictError = class extends ExecutorError {
	mode;
	constructor(mode) {
		super("executor-mode-conflict", `the session is recorded on the "${mode}" executor`, 409, { mode });
		this.mode = mode;
		this.name = "ExecutorModeConflictError";
	}
};
/** Another client owns a fresh local-mode executor record. */
var ExecutorHeldError = class extends ExecutorError {
	owner;
	constructor(owner) {
		super("executor-held", owner === void 0 ? "the session is held by another client" : `the session is held by client "${owner.clientId}" (heartbeat ${owner.heartbeatAt})`, 409, owner === void 0 ? {} : {
			ownerClientId: owner.clientId,
			instanceId: owner.instanceId,
			heartbeatAt: owner.heartbeatAt
		});
		this.owner = owner;
		this.name = "ExecutorHeldError";
	}
};
/** A local turn could not be cancelled/released; the switch did not happen. */
var ExecutorLocalReleaseError = class extends ExecutorError {
	constructor(cause) {
		super("mode-switch/cancel-failed", `could not cancel and release the local turn: ${cause instanceof Error ? cause.message : String(cause)}`, 409, { cause: cause instanceof Error ? cause.message : String(cause) });
		this.name = "ExecutorLocalReleaseError";
	}
};
/** The profile restart after recording `local` failed; the record is already local. */
var ExecutorRestartFailedError = class extends ExecutorError {
	constructor(cause) {
		super("executor-switch-restart-failed", `the executor switch was recorded but the profile restart failed: ${cause instanceof Error ? cause.message : String(cause)}`, 500, { cause: cause instanceof Error ? cause.message : String(cause) });
		this.name = "ExecutorRestartFailedError";
	}
};
/** The server plugin does not expose `executor/assign` yet. */
var ExecutorAssignUnsupportedError = class extends ExecutorError {
	constructor(sessionId) {
		super("executor-assign-unsupported", `the server plugin cannot record an executor for "${sessionId}"`);
		this.name = "ExecutorAssignUnsupportedError";
	}
};
/** How stale a local owner may be before another client may take over. */
const EXECUTOR_OWNER_TTL_MS = 2e4;
/** Read one error's stable code without assuming this repo's error class. */
function codeOf(error) {
	if (error === null || typeof error !== "object") return void 0;
	const code = error.code;
	return typeof code === "string" ? code : void 0;
}
/** A server response for `executor/get`: absent record is `null` on the wire. */
function asRecord(sessionId, raw) {
	if (raw === null || raw === void 0) return null;
	if (typeof raw !== "object") throw new ExecutorError("executor-record-invalid", `executor record for "${sessionId}" is not an object`, 500);
	const record = raw;
	if (record.mode !== "server" && record.mode !== "local") throw new ExecutorError("executor-record-invalid", `executor record for "${sessionId}" has an invalid mode`, 500);
	if (record.sessionId !== void 0 && record.sessionId !== sessionId) throw new ExecutorError("executor-record-invalid", `executor record for "${sessionId}" names "${String(record.sessionId)}"`, 500);
	return {
		version: 1,
		sessionId,
		mode: record.mode,
		updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
		...record.owner === void 0 ? {} : { owner: record.owner },
		...record.switchedBy === void 0 ? {} : { switchedBy: record.switchedBy }
	};
}
/**
* Whether a local executor record's owner is still alive.
* @param record - the last record read from the server.
* @param now - current epoch ms (injectable for tests).
* @param ttlMs - freshness window; the protocol fixes 20 s.
*/
function isOwnerFresh(record, now = Date.now(), ttlMs = EXECUTOR_OWNER_TTL_MS) {
	const heartbeat = record?.owner?.heartbeatAt;
	if (heartbeat === void 0) return false;
	const at = Date.parse(heartbeat);
	if (!Number.isFinite(at)) return false;
	return now - at <= ttlMs;
}
/** Owner hold check used by UI before offering a takeover. */
function executorHeldByOther(record, self, now = Date.now()) {
	if (record?.mode !== "local" || record.owner === void 0) return false;
	return !(record.owner.clientId === self.clientId && record.owner.instanceId === self.instanceId) && isOwnerFresh(record, now);
}
/** One serialized runner per session to reject concurrent switches. */
var SessionLocks = class {
	chains = /* @__PURE__ */ new Map();
	get busy() {
		return [...this.chains.keys()];
	}
	isBusy(sessionId) {
		return this.chains.has(sessionId);
	}
	run(sessionId, operation) {
		if (this.chains.has(sessionId)) throw new ExecutorSwitchBusyError(sessionId);
		const next = operation().finally(() => {
			if (this.chains.get(sessionId) === next) this.chains.delete(sessionId);
		});
		this.chains.set(sessionId, next);
		return next;
	}
};
/**
* Client half of the executor protocol for one target.
*
* All state lives on the server; this class adds only the client ordering,
* per-session switch serialization, and stable error codes. It never writes a
* session log itself.
*/
var ServerExecutor = class {
	rpc;
	now;
	locks = new SessionLocks();
	constructor(rpc, now = () => Date.now()) {
		this.rpc = rpc;
		this.now = now;
	}
	/** Whether a switch for this session is currently running in this process. */
	isSwitching(sessionId) {
		return this.locks.isBusy(sessionId);
	}
	/** Read the authoritative executor record, if any. */
	async get(sessionId) {
		return asRecord(sessionId, await this.rpc.request(RW_METHODS.executorGet, { sessionId }));
	}
	/**
	* Record the executor for a session that has no record yet (local-mode new
	* session / hand-off). Owner identity is filled in by the server plugin from
	* the P1 lease headers, so only the mode travels from here.
	*/
	async assign(sessionId, mode) {
		try {
			const record = asRecord(sessionId, await this.rpc.request(RW_METHODS.executorAssign, {
				sessionId,
				mode
			}));
			if (record === null) throw new ExecutorError("executor-record-invalid", `executor/assign did not return a record for "${sessionId}"`, 500);
			return record;
		} catch (error) {
			if (error instanceof ExecutorError) throw error;
			const code = codeOf(error);
			if (code === "bad-request" || code === "gateway/bad-request" || code === "not-found" || code === "handle-not-found") throw new ExecutorAssignUnsupportedError(sessionId);
			throw error;
		}
	}
	/** D20 preview; no side effects. */
	async preview(sessionId, to) {
		const raw = await this.rpc.request(RW_METHODS.executorPlanSwitch, {
			sessionId,
			to
		});
		if (raw === null || typeof raw !== "object") throw new ExecutorError("executor-plan-invalid", `executor/plan-switch returned no plan for "${sessionId}"`, 500);
		const plan = raw;
		if (plan.currentMode !== "server" && plan.currentMode !== "local") throw new ExecutorError("executor-plan-invalid", `executor plan for "${sessionId}" has an invalid current mode`, 500);
		const activeTurns = Array.isArray(plan.activeTurns) ? plan.activeTurns : [];
		return {
			currentMode: plan.currentMode,
			to,
			restartRequired: plan.restartRequired === true,
			activeTurns,
			requiresConfirmation: plan.requiresConfirmation === true,
			targetTurnRunning: plan.targetTurnRunning === true
		};
	}
	/**
	* Switch one session's executor with the ordering the protocol requires.
	*
	* local → server: `releaseLocal` first (cancel → idle → flush → close), then
	* the record flips; the server-mode UI may open the session afterwards.
	*
	* server → local: preview/confirm, then the server cancels and either hands
	* off its managed handle or asks for a profile restart; the local agent must
	* not open the log before this resolves.
	*/
	async switchTo(request) {
		return await this.locks.run(request.sessionId, async () => await this.switchLocked(request));
	}
	async switchLocked(request) {
		const { sessionId, to } = request;
		if (sessionId === "") throw new ExecutorError("bad-request", "sessionId must not be empty", 400);
		const plan = await this.preview(sessionId, to);
		if (plan.currentMode === to) return {
			mode: to,
			restartRequired: false,
			plannedCancellations: []
		};
		if (to === "server") {
			if (request.releaseLocal === void 0) throw new ExecutorError("mode-switch/release-required", `switching "${sessionId}" to server requires releasing the local turn first`, 400);
			try {
				await request.releaseLocal();
			} catch (error) {
				throw new ExecutorLocalReleaseError(error);
			}
			const result = await this.rpc.request(RW_METHODS.executorSwitch, {
				sessionId,
				to
			});
			return this.outcome(result, "server", plan.activeTurns);
		}
		if (plan.requiresConfirmation && request.confirmOtherTurns !== true) throw new ExecutorSwitchConfirmRequiredError(plan.activeTurns);
		const result = await this.rpc.request(RW_METHODS.executorSwitch, {
			sessionId,
			to,
			confirmOtherTurns: request.confirmOtherTurns === true
		});
		const outcome = this.outcome(result, "local", plan.activeTurns);
		if (outcome.restartRequired) {
			if (request.restartProfile === void 0) throw new ExecutorError("executor-switch-restart-required", `switching "${sessionId}" to local requires a profile restart, but no restart port was provided`, 500);
			try {
				await request.restartProfile();
			} catch (error) {
				throw new ExecutorRestartFailedError(error);
			}
		}
		return outcome;
	}
	/** Normalize the server's `executor/switch` answer. */
	outcome(raw, expected, activeTurns) {
		if (raw === null || typeof raw !== "object") throw new ExecutorError("executor-switch-invalid", `executor/switch returned no result for "${expected}"`, 500);
		const value = raw;
		const mode = value.mode === "server" || value.mode === "local" ? value.mode : expected;
		if (mode !== expected) throw new ExecutorError("executor-switch-invalid", `executor/switch answered mode "${mode}" while "${expected}" was requested`, 500);
		const planned = activeTurns.filter((turn) => turn.running).map((turn) => turn.sessionId);
		return {
			mode,
			restartRequired: value.restartRequired === true,
			plannedCancellations: planned
		};
	}
	/**
	* Drop a stale local-mode owner record before taking over. The official
	* flock is still the only write authority; this only clears the plugin's
	* intent record (protocol `executor/release`).
	*/
	async release(sessionId) {
		await this.rpc.request(RW_METHODS.executorRelease, { sessionId });
	}
	/** Read the record and throw the protocol's occupancy errors, for UI checks. */
	async assertLocalWritable(sessionId, self) {
		const record = await this.get(sessionId);
		if (record?.mode === "server") throw new ExecutorModeConflictError(record.mode);
		if (record !== null && executorHeldByOther(record, self, this.now())) throw new ExecutorHeldError(record.owner);
		return record;
	}
};
//#endregion
//#region src/session/local-session.ts
/** Stable failure for local-session creation. */
var LocalSessionError = class extends Error {
	code;
	details;
	constructor(code, message, details) {
		super(message);
		this.code = code;
		this.details = details;
		this.name = "LocalSessionError";
	}
};
/** Code used when the client catalog never observed the new session. */
const REVEAL_TIMEOUT_CODE = "session-reveal-timeout";
/** Mint a fresh client-side session identity. */
function mintSessionId() {
	const uuid = globalThis.crypto?.randomUUID?.();
	if (uuid === void 0) throw new LocalSessionError("session-create-failed", "no crypto.randomUUID available to mint a session id");
	return `session-${uuid}`;
}
/** Whether an error says the P1 server does not implement `session/create`. */
function isUnsupportedCreate(error) {
	if (error === null || typeof error !== "object") return false;
	const code = error.code;
	return code === "bad-request" || code === "gateway/bad-request" || code === "not-found" || code === "method-not-found";
}
/** Bound a promise, mapping a timeout to a typed error. */
async function waitFor(promise, timeoutMs, signal, sessionId) {
	let timer;
	const timeout = new Promise((_resolve, reject) => {
		timer = setTimeout(() => {
			reject(new LocalSessionError(REVEAL_TIMEOUT_CODE, `session "${sessionId}" was not visible in the client catalog within ${timeoutMs} ms`, {
				sessionId,
				timeoutMs
			}));
		}, timeoutMs);
	});
	try {
		return await (signal === void 0 ? Promise.race([promise, timeout]) : Promise.race([
			promise,
			timeout,
			aborted(signal)
		]));
	} finally {
		if (timer !== void 0) clearTimeout(timer);
		promise.catch(() => {});
	}
}
/** Reject with the signal's reason when the caller cancels. */
function aborted(signal) {
	return new Promise((_resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		signal.addEventListener("abort", () => reject(signal.reason), { once: true });
	});
}
/**
* Create a local-mode session against one connected target.
*
* @param ports - injected P1/agent/catalog capabilities.
* @param options - workspace, preset and reveal budget.
* @returns the session identity and the client agent handle.
* @throws {@link LocalSessionError} when the session could not be created or
*   revealed; in the reveal-failure case the caller still owns `handle` only
*   when the error carries one, so create failures never leak it silently.
*/
async function createLocalSession(ports, options) {
	if (options.workspaceId.trim() === "") throw new LocalSessionError("bad-request", "workspaceId must not be empty");
	if (options.agentPreset.trim() === "") throw new LocalSessionError("bad-request", "agentPreset must not be empty");
	options.signal?.throwIfAborted();
	let sessionId = options.sessionId ?? mintSessionId();
	let origin = "client";
	let durableServerBlank = false;
	try {
		const created = await ports.createBlankOnServer({
			workspaceId: options.workspaceId,
			sessionId,
			...options.signal === void 0 ? {} : { signal: options.signal }
		});
		if (typeof created.sessionId === "string" && created.sessionId !== "") sessionId = created.sessionId;
		origin = "server";
		durableServerBlank = created.durable === true;
	} catch (error) {
		if (!isUnsupportedCreate(error)) throw error;
		origin = "client";
	}
	const cwd = await ports.ensureAnchor(options.workspaceId);
	let handle;
	if (durableServerBlank) {
		if (ports.resumeAgent === void 0) throw new LocalSessionError("session-create-failed", "local session creation needs a resume port for a server-created blank session");
		handle = await ports.resumeAgent({
			sessionId,
			workspaceId: options.workspaceId,
			cwd,
			agentPreset: options.agentPreset,
			...options.signal === void 0 ? {} : { signal: options.signal }
		});
	} else {
		if (ports.createAgent === void 0) throw new LocalSessionError("session-create-failed", "local session creation needs a client agent port for the fallback path");
		if (origin === "client" && ports.assignExecutor !== void 0) await ports.assignExecutor({
			sessionId,
			...options.signal === void 0 ? {} : { signal: options.signal }
		});
		handle = await ports.createAgent({
			sessionId,
			workspaceId: options.workspaceId,
			cwd,
			agentPreset: options.agentPreset,
			blank: true,
			...options.signal === void 0 ? {} : { signal: options.signal }
		});
	}
	if (ports.waitForCatalog !== void 0) try {
		await waitFor(ports.waitForCatalog(sessionId, {
			timeoutMs: options.revealTimeoutMs ?? 4e3,
			...options.signal === void 0 ? {} : { signal: options.signal }
		}), (options.revealTimeoutMs ?? 4e3) + 250, options.signal, sessionId);
	} catch (error) {
		if (error instanceof LocalSessionError) throw Object.assign(error, { handle });
		const message = error instanceof Error ? error.message : String(error);
		throw Object.assign(new LocalSessionError(REVEAL_TIMEOUT_CODE, message, { sessionId }), { handle });
	}
	ports.reveal(sessionId);
	return {
		sessionId,
		origin,
		cwd,
		handle
	};
}
//#endregion
//#region src/session/local-turn.ts
/**
* Cancel a client-side (local-mode) turn and release its server write handle.
*
* This is the client half of a `local → server` executor switch (protocol
* §5.4): the local agent must be stopped, its loop idle, the routing writer
* flushed, and the remote `SessionHandle` closed before the executor record
* flips — otherwise the server-mode UI could open the same JSONL artifact and
* the official flock would reject it as `session/writer-held` (or, worse, a
* not-yet-flushed tail would be lost on profile restart).
*
* The official `AgentHandle.dispose()` already performs
* `cancel(disposed) → whenIdle() → handle.close()`; this helper adds the
* explicit user-cancel (so the durable turn closes with `reason: user` rather
* than a disposal reason), a bounded idle wait with a timeout that is reported
* instead of swallowed, and an explicit flush barrier (the routing persistence
* batches live events, so `close()` alone is the durability barrier, but the
* extra flush makes a slow remote channel visible before the record flips).
*
* Nothing here talks to the network: the handle and the flush port are
* injected.
*/
/** Why a local turn could not be released. */
var LocalTurnReleaseError = class extends Error {
	code;
	cause;
	constructor(code, message, cause) {
		super(message);
		this.code = code;
		this.cause = cause;
		this.name = "LocalTurnReleaseError";
	}
};
/** Handles released by this process; avoids mutating the official handle. */
const RELEASED = /* @__PURE__ */ new WeakSet();
/** Raised internally to distinguish a timeout from a failed operation. */
var TimeoutSentinel = class extends Error {};
/**
* Race a promise against a deadline.
* @param promise - the operation to bound.
* @param timeoutMs - deadline in milliseconds.
* @param label - diagnostic label used by the timeout error.
* @returns the operation's value.
* @throws {@link TimeoutSentinel} when the deadline wins.
*/
async function withTimeout(promise, timeoutMs, label) {
	let timer;
	try {
		return await Promise.race([promise, new Promise((_resolve, reject) => {
			timer = setTimeout(() => reject(new TimeoutSentinel(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
		})]);
	} finally {
		if (timer !== void 0) clearTimeout(timer);
		promise.catch(() => {});
	}
}
/**
* Stop a local turn and release its write handle.
*
* Idempotent per handle instance: a second call returns
* `{ timedOut: false, alreadyReleased: true }` instead of disposing twice.
*
* @param handle - the official `AgentHandle` the plugin owns for this session.
* @param options - flush port and idle/dispose deadline.
* @returns whether the idle wait timed out.
* @throws {@link LocalTurnReleaseError} when the turn/handle could not be
*   released; callers must not flip the executor record in that case.
*/
async function releaseLocalTurn(handle, options = {}) {
	const timeoutMs = options.timeoutMs ?? 3e3;
	if (RELEASED.has(handle)) return {
		timedOut: false,
		alreadyReleased: true
	};
	RELEASED.add(handle);
	const failures = [];
	let cancelError;
	let timedOut = false;
	try {
		handle.agent.cancel({ kind: "user" }, { keepInbox: true });
	} catch (error) {
		cancelError = error instanceof Error ? error.message : String(error);
	}
	try {
		await withTimeout(handle.agent.whenIdle(), timeoutMs, `session "${handle.agent.id}" idle wait`);
	} catch (error) {
		if (error instanceof TimeoutSentinel) timedOut = true;
		else failures.push(`idle: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (options.flush !== void 0) try {
		await options.flush();
	} catch (error) {
		failures.push(`flush: ${error instanceof Error ? error.message : String(error)}`);
	}
	try {
		await withTimeout(handle.dispose(), timeoutMs, `session "${handle.agent.id}" dispose`);
	} catch (error) {
		if (error instanceof TimeoutSentinel) throw new LocalTurnReleaseError("mode-switch/release-timeout", `session "${handle.agent.id}" dispose did not release the write handle within ${timeoutMs} ms; the session stays local`, error);
		failures.push(`dispose: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (failures.length > 0) throw new LocalTurnReleaseError("mode-switch/cancel-failed", `session "${handle.agent.id}" could not be released: ${failures.join("; ")}`, failures);
	return {
		timedOut,
		alreadyReleased: false,
		...cancelError === void 0 ? {} : { cancelError }
	};
}
//#endregion
//#region src/session/local-session-manager.ts
/**
* Own the client-side local agents of one target/profile.
*
* One instance per connected target. It never writes the server log itself;
* that stays with the routing persistence.
*/
var LocalSessionManager = class {
	executor;
	ports;
	managed = /* @__PURE__ */ new Map();
	/** Serialize open/create per session so two callers cannot double-resume. */
	opening = /* @__PURE__ */ new Map();
	constructor(executor, ports) {
		this.executor = executor;
		this.ports = ports;
	}
	/** Sessions whose agent this process currently owns. */
	list() {
		return [...this.managed.values()];
	}
	/** Whether this process owns the write handle of one session. */
	owns(sessionId) {
		return this.managed.has(sessionId);
	}
	/** Resolve the owned handle, if any. */
	get(sessionId) {
		return this.managed.get(sessionId);
	}
	/**
	* Create a new local-mode session and retain its handle.
	* @param input - workspace id and optional cancellation.
	* @returns the created session and its owned handle.
	*/
	async create(input) {
		const preset = this.ports.presetFor(input.workspaceId);
		const created = await createLocalSession(this.ports.createPorts, {
			workspaceId: input.workspaceId,
			agentPreset: preset,
			...input.signal === void 0 ? {} : { signal: input.signal }
		});
		const managed = {
			sessionId: created.sessionId,
			workspaceId: input.workspaceId,
			handle: created.handle,
			preset
		};
		this.managed.set(created.sessionId, managed);
		return managed;
	}
	/**
	* Cold-open a stored server session on the client and retain its handle.
	*
	* The caller must have selected local mode for this session (executor record
	* `local`); the guard is the server's `persist/open(write)` check, so this
	* method only adds single-flight ownership.
	* @param input - stored session id and workspace binding.
	*/
	async open(input) {
		const existing = this.managed.get(input.sessionId);
		if (existing !== void 0) return existing;
		const inflight = this.opening.get(input.sessionId);
		if (inflight !== void 0) return await inflight;
		const attempt = (async () => {
			const preset = this.ports.presetFor(input.workspaceId);
			const cwd = await this.ports.anchorForWorkspace(input.workspaceId);
			const handle = await this.ports.openAgent({
				sessionId: input.sessionId,
				workspaceId: input.workspaceId,
				cwd,
				agentPreset: preset,
				...input.signal === void 0 ? {} : { signal: input.signal }
			});
			const managed = {
				sessionId: input.sessionId,
				workspaceId: input.workspaceId,
				handle,
				preset
			};
			this.managed.set(input.sessionId, managed);
			return managed;
		})().finally(() => {
			this.opening.delete(input.sessionId);
		});
		this.opening.set(input.sessionId, attempt);
		return await attempt;
	}
	/**
	* Release one local agent: cancel its turn, wait for idle/flush, close the
	* official handle. Idempotent; a missing session is a no-op.
	* @param sessionId - stored session id.
	* @param options - optional release overrides.
	*/
	async release(sessionId, options = {}) {
		const managed = this.managed.get(sessionId);
		if (managed === void 0) return {
			timedOut: false,
			alreadyReleased: true
		};
		const flush = options.flush ?? this.ports.flush;
		const timeoutMs = options.timeoutMs ?? this.ports.releaseTimeoutMs;
		const result = await releaseLocalTurn(managed.handle, {
			...flush === void 0 ? {} : { flush },
			...timeoutMs === void 0 ? {} : { timeoutMs }
		});
		this.managed.delete(sessionId);
		return result;
	}
	/** Release every owned local agent (disconnect / plugin dispose). */
	async releaseAll(options = {}) {
		const ids = [...this.managed.keys()];
		const failures = [];
		for (const id of ids) try {
			await this.release(id, options);
		} catch {
			failures.push(id);
		}
		if (failures.length > 0) throw new Error(`could not release local session(s): ${failures.join(", ")}`);
		return ids;
	}
	/**
	* Switch one session local → server.
	*
	* The record flips only after the local handle is released; a release failure
	* aborts the switch and leaves the session local (protocol §5.4).
	*/
	async switchToServer(sessionId, options = {}) {
		return await this.executor.switchTo({
			sessionId,
			to: "server",
			...options.confirmOtherTurns === void 0 ? {} : { confirmOtherTurns: options.confirmOtherTurns },
			releaseLocal: async () => {
				await this.release(sessionId);
			}
		});
	}
	/**
	* Switch one session server → local. The server either hands off its managed
	* handle (`restartRequired:false`) or asks for a profile restart (unmanaged
	* live agent); the caller then opens the session locally with {@link open}.
	*/
	async switchToLocal(sessionId, options = {}) {
		const restartProfile = this.ports.restartProfile;
		return await this.executor.switchTo({
			sessionId,
			to: "local",
			...options.confirmOtherTurns === void 0 ? {} : { confirmOtherTurns: options.confirmOtherTurns },
			...restartProfile === void 0 ? {} : { restartProfile }
		});
	}
	/** The current executor mode as the server reports it (for UI badges). */
	async modeOf(sessionId) {
		return (await this.executor.get(sessionId))?.mode ?? "server";
	}
};
//#endregion
//#region src/session/remote-context.ts
/** Build the execution-host line (pure; exported for tests). */
function executionHostText(target) {
	return `Execution host: ${target.label} (${target.username}@${target.host}:${target.port}).`;
}
/** Build the remote working-directory line (pure; exported for tests). */
function remoteWorkingDirectoryText(remotePath) {
	return `Current working directory: ${JSON.stringify(remotePath)}.`;
}
/** Install the context contributions on one Agent scope (no-op without systemPrompt). */
function installRemoteContext(ctx, options) {
	const service = ctx.systemPrompt ?? ctx.get?.("systemPrompt");
	if (service?.context === void 0) return;
	const order = service.getContextOrder?.("WORKING_DIRECTORY") ?? 0;
	if (options.remotePath !== void 0 && options.remotePath !== "") service.context({
		name: "working-directory:current",
		order,
		required: true,
		interpolate: false,
		text: remoteWorkingDirectoryText(options.remotePath)
	});
	service.context({
		name: "remote-workspace/execution-host",
		order: order + 1,
		interpolate: false,
		text: executionHostText(options.target)
	});
}
//#endregion
//#region src/session/open.ts
/**
* Opening a session whose working directory is a *remote* path.
*
* The official session-controller layer cannot be used: `createOrAdopt` calls
* `mkdir(cwd, { recursive: true })` before composing the agent (MIT, DSH
* `packages/api/session-controller/src/agent.ts`), which would create the remote
* path locally. `ctx.agents.create` performs no filesystem access — it only
* requires `meta.cwd` to be an absolute path — so the plugin composes the same
* thing itself: resolve the preset, mount it into the unpublished agent scope,
* then publish with the remote cwd.
*
* Persistence is NOT wired here: the host-plane `sessionPersistence` is the
* routing backend (see `src/session-persistence/routing.ts`, bound via the
* bundle's `sessions` row override), which sends stub-cwd sessions to the
* remote server by themselves.
*/
/**
* Create (or adopt) the session for a remote workspace.
* @param ctx - the plugin's host context.
* @param options - target, stub path and optional existing session id.
* @returns the session identity and the preset it was composed with.
*/
async function openRemoteSession(ctx, options) {
	if (!isAbsolute(options.path)) throw new Error(`remote working directory must be absolute, received "${options.path}"`);
	const presets = ctx.agentPresets;
	const presetId = options.agentPreset ?? remotePresetId(options.targetId);
	const resolved = await presets.resolve(presetId);
	if (resolved.broken !== void 0) throw new Error(`remote preset "${presetId}" is unusable: ${resolved.broken}`);
	const sessionId = options.sessionId ?? `session-${randomUUID()}`;
	const agents = ctx.agents;
	if (agents.get(sessionId) !== void 0) return {
		sessionId,
		agentPreset: resolved.id,
		managed: false,
		unmanagedReason: "the session is already live in this process; another caller owns its AgentHandle"
	};
	const selection = ctx.get("agentDefaultModel")?.currentSelection() ?? {};
	const buildCreate = (id) => ({
		sessionId: id,
		agentOptions: {
			...selection.provider === void 0 ? {} : { provider: selection.provider },
			...selection.model === void 0 ? {} : { model: selection.model }
		},
		meta: {
			cwd: options.path,
			agentPreset: resolved.id
		},
		...options.signal === void 0 ? {} : { signal: options.signal },
		setup: async (agentCtx) => {
			await presets.mount(agentCtx, resolved.id);
			if (options.remoteContext !== void 0) installRemoteContext(agentCtx, options.remoteContext);
		}
	});
	try {
		const handle = await agents.create(buildCreate(sessionId));
		return {
			sessionId,
			agentPreset: resolved.id,
			handle,
			managed: true
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (options.sessionId === void 0 || !/already exists|corrupt|does not match an open turn/i.test(message)) throw error;
		const fresh = `session-${randomUUID()}`;
		const handle = await agents.create(buildCreate(fresh));
		return {
			sessionId: fresh,
			agentPreset: resolved.id,
			handle,
			managed: true
		};
	}
}
/**
* Resume one *stored* remote session, possibly created on another device.
*
* The write path is the official resume flow: `ctx.agents.resume` opens the
* session for write through the routing persistence, which finds its workspace
* by `persist.locate` and reads the authoritative log from the remote server.
* No seed is supplied — the stored log *is* the history — and the live session
* inherits the stub cwd from the re-anchored header (see `RemotePersistence`),
* so the official workspace can attach it like any local session.
*
* @param ctx - the plugin's host context.
* @param options - target, session id to adopt, optional cancellation.
* @returns the session identity and the preset it was composed with.
*/
async function resumeRemoteSession(ctx, options) {
	const presets = ctx.agentPresets;
	const presetId = options.agentPreset ?? remotePresetId(options.targetId);
	const resolved = await presets.resolve(presetId);
	if (resolved.broken !== void 0) throw new Error(`remote preset "${presetId}" is unusable: ${resolved.broken}`);
	const sessionId = options.sessionId;
	const agents = ctx.agents;
	if (agents.get(sessionId) !== void 0) return {
		sessionId,
		agentPreset: resolved.id,
		managed: false,
		unmanagedReason: "the session is already live in this process; another caller owns its AgentHandle"
	};
	const selection = ctx.get("agentDefaultModel")?.currentSelection() ?? {};
	const handle = await agents.resume({
		resumeSessionId: sessionId,
		agentOptions: {
			...selection.provider === void 0 ? {} : { provider: selection.provider },
			...selection.model === void 0 ? {} : { model: selection.model }
		},
		...options.signal === void 0 ? {} : { signal: options.signal },
		setup: async (agentCtx) => {
			await presets.mount(agentCtx, resolved.id);
			if (options.remoteContext !== void 0) installRemoteContext(agentCtx, options.remoteContext);
		}
	});
	return {
		sessionId,
		agentPreset: resolved.id,
		handle,
		managed: true
	};
}
//#endregion
//#region src/session/local-runtime.ts
/** Map an unmanaged official agent to the frozen `agent-compose-failed` code. */
function unmanaged(opened, sessionId) {
	return new LocalSessionError("agent-compose-failed", opened.unmanagedReason ?? `session "${sessionId}" is already live and its AgentHandle is not owned by this plugin`, {
		sessionId,
		managed: false
	});
}
/**
* Bind the generic local-session ports to host services.
* @param deps - host context, target-bound RPC, client id and optional ports.
* @returns ports for {@link createLocalSession} (or the runtime below).
*/
function createHostLocalSessionPorts(deps) {
	const anchorsRoot = anchorRoot({
		clientId: deps.clientId,
		...deps.env === void 0 ? {} : { env: deps.env }
	});
	const anchorOptions = {
		clientId: deps.clientId,
		...deps.env === void 0 ? {} : { env: deps.env }
	};
	const preset = deps.presetId ?? remotePresetId(deps.targetId);
	return {
		createBlankOnServer: async ({ workspaceId, sessionId, signal }) => {
			const created = await deps.rpc.request(RW_METHODS.sessionCreate, {
				workspaceId,
				sessionId,
				executor: "local"
			}, signal);
			return {
				sessionId: typeof created?.sessionId === "string" && created.sessionId !== "" ? created.sessionId : sessionId,
				durable: false
			};
		},
		ensureAnchor: async (workspaceId) => await ensureAnchor(anchorsRoot, anchorPathFor(anchorOptions, deps.targetId, workspaceId)),
		assignExecutor: async ({ sessionId, signal }) => {
			await deps.rpc.request(RW_METHODS.executorAssign, {
				sessionId,
				mode: "local"
			}, signal);
		},
		createAgent: async ({ sessionId, workspaceId, cwd, agentPreset, blank, signal }) => {
			const opened = await openRemoteSession(deps.ctx, {
				targetId: deps.targetId,
				path: cwd,
				sessionId,
				agentPreset: agentPreset === "" ? preset : agentPreset,
				...blank === true ? { seed: false } : {},
				...signal === void 0 ? {} : { signal },
				...deps.target === void 0 ? {} : { remoteContext: {
					target: deps.target,
					...deps.remotePathForWorkspace?.(workspaceId) === void 0 ? {} : { remotePath: deps.remotePathForWorkspace(workspaceId) }
				} }
			});
			if (!opened.managed || opened.handle === void 0) throw unmanaged(opened, sessionId);
			return opened.handle;
		},
		resumeAgent: async ({ sessionId, workspaceId, cwd, agentPreset, signal }) => {
			const opened = await resumeRemoteSession(deps.ctx, {
				targetId: deps.targetId,
				sessionId,
				agentPreset: agentPreset === "" ? preset : agentPreset,
				...signal === void 0 ? {} : { signal },
				...deps.target === void 0 ? {} : { remoteContext: {
					target: deps.target,
					...deps.remotePathForWorkspace?.(workspaceId) === void 0 ? {} : { remotePath: deps.remotePathForWorkspace(workspaceId) }
				} }
			});
			if (!opened.managed || opened.handle === void 0) throw unmanaged(opened, sessionId);
			return opened.handle;
		},
		...deps.waitForCatalog === void 0 ? {} : { waitForCatalog: deps.waitForCatalog },
		reveal: deps.reveal ?? (() => {})
	};
}
/** Default reveal wait (protocol §16.10). */
const REVEAL_BUDGET_MS = 4e3;
/** Run the optional catalog wait + reveal; returns whether a reveal ran. */
async function revealIfConfigured(deps, sessionId, signal) {
	if (deps.waitForCatalog === void 0) return false;
	const timeoutMs = deps.revealTimeoutMs ?? REVEAL_BUDGET_MS;
	let timer;
	try {
		await Promise.race([deps.waitForCatalog(sessionId, {
			timeoutMs,
			...signal === void 0 ? {} : { signal }
		}), new Promise((_resolve, reject) => {
			timer = setTimeout(() => {
				reject(new LocalSessionError("session-reveal-timeout", `session "${sessionId}" was not visible in the client catalog within ${timeoutMs} ms`, {
					sessionId,
					timeoutMs
				}));
			}, timeoutMs + 250);
		})]);
	} finally {
		if (timer !== void 0) clearTimeout(timer);
	}
	deps.reveal?.(sessionId);
	return true;
}
/**
* Prepare the session's executor record for a local write open.
*
* After a client restart the durable record still names the previous client
* instance, and the P1 `persist/open(write)` guard would reject it with
* `executor-held`. The protocol allows a stale owner (>20 s) to be taken over
* with `executor/assign`; a session still recorded on `server` must instead be
* switched, so it stays a hard conflict here.
* @param executor - target-bound executor RPC.
* @param deps - client/instance identity.
* @param sessionId - stored session id.
*/
async function ensureLocalExecutorRecord(executor, deps, sessionId) {
	let record;
	try {
		record = await executor.get(sessionId);
	} catch (error) {
		if (error?.code === "bad-request" || error?.code === "not-found") return {
			version: 1,
			sessionId,
			mode: "local",
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		throw error;
	}
	if (record?.mode === "server") throw new ExecutorModeConflictError("server");
	const owner = record?.owner;
	const sameInstance = owner !== void 0 && deps.instanceId !== void 0 && owner.instanceId === deps.instanceId;
	const sameClient = owner !== void 0 && owner.clientId === deps.clientId;
	if (record?.mode === "local" && owner !== void 0 && sameClient && (sameInstance || isOwnerFresh(record))) return record;
	if (record?.mode === "local" && owner !== void 0 && !sameClient && isOwnerFresh(record)) throw new ExecutorHeldError(owner);
	return await executor.assign(sessionId, "local");
}
/**
* Build the host-side local-mode runtime for one connected target.
* @param deps - host context, target-bound RPC, client id and optional ports.
* @returns create/open/release operations sharing one owned-handle table.
*/
function createHostLocalRuntime(deps) {
	const anchorsRoot = anchorRoot({
		clientId: deps.clientId,
		...deps.env === void 0 ? {} : { env: deps.env }
	});
	const anchors = new AnchorRegistry();
	const basePorts = createHostLocalSessionPorts({
		...deps,
		waitForCatalog: void 0,
		reveal: () => {}
	});
	const ports = {
		...basePorts,
		ensureAnchor: async (workspaceId) => {
			const path = await basePorts.ensureAnchor(workspaceId);
			anchors.register({
				targetId: deps.targetId,
				workspaceId,
				path
			});
			return path;
		}
	};
	const executor = new ServerExecutor(deps.rpc);
	const preset = deps.presetId ?? remotePresetId(deps.targetId);
	const manager = new LocalSessionManager(executor, {
		anchorForWorkspace: async (workspaceId) => await ports.ensureAnchor(workspaceId),
		createPorts: ports,
		openAgent: async ({ sessionId, workspaceId, cwd, agentPreset, signal }) => {
			if (ports.resumeAgent === void 0) throw new LocalSessionError("agent-compose-failed", "local open has no resume port");
			return await ports.resumeAgent({
				sessionId,
				workspaceId,
				cwd,
				agentPreset,
				...signal === void 0 ? {} : { signal }
			});
		},
		presetFor: () => preset,
		...deps.flush === void 0 ? {} : { flush: deps.flush },
		...deps.releaseTimeoutMs === void 0 ? {} : { releaseTimeoutMs: deps.releaseTimeoutMs },
		...deps.restartProfile === void 0 ? {} : { restartProfile: deps.restartProfile }
	});
	return {
		executor,
		manager,
		ports,
		anchorsRoot,
		anchors,
		routeForCwd: (cwd) => anchors.routeForCwd(cwd),
		anchorForWorkspace: (workspaceId) => anchors.pathFor(workspaceId),
		async create(input) {
			const session = await manager.create(input);
			const revealed = await revealIfConfigured(deps, session.sessionId, input.signal);
			return {
				sessionId: session.sessionId,
				workspaceId: session.workspaceId,
				executor: "local",
				revealed,
				session
			};
		},
		async open(input) {
			await ensureLocalExecutorRecord(executor, deps, input.sessionId);
			const session = await manager.open(input);
			const revealed = await revealIfConfigured(deps, session.sessionId, input.signal);
			return {
				sessionId: session.sessionId,
				workspaceId: session.workspaceId,
				executor: "local",
				revealed,
				session
			};
		},
		async release(sessionId) {
			await manager.release(sessionId, deps.flush === void 0 ? {} : { flush: deps.flush });
		},
		async dispose() {
			await manager.releaseAll(deps.flush === void 0 ? {} : { flush: deps.flush });
			anchors.forgetTarget(deps.targetId);
			await removeTargetAnchors(anchorsRoot, deps.targetId).catch(() => false);
		}
	};
}
/** Matches the official helper's per-frame ceiling. */
const DEFAULT_MAX_FRAME_BYTES = 67108864;
/** Stream data is chunked well below the per-frame ceiling to keep credit accounting fine-grained. */
const DEFAULT_STREAM_CHUNK_BYTES = 262144;
/** Stream ids are 32-bit; ids are allocated per transport, not per peer. */
const MAX_STREAM_ID = 4294967295;
/** Half-close directions on the wire. */
const END_DIRECTION = {
	inbound: 0,
	outbound: 1
};
/** A malformed or oversized frame. */
var FrameError = class extends Error {
	code = "FRAME_PROTOCOL";
	constructor(message) {
		super(message);
		this.name = "FrameError";
	}
};
/** Encode one frame with its 5-byte header. */
function encodeFrame(type, payload) {
	const frame = Buffer.allocUnsafe(5 + payload.length);
	frame.writeUInt8(type, 0);
	frame.writeUInt32BE(payload.length, 1);
	payload.copy(frame, 5);
	return frame;
}
/** Encode an RPC envelope payload; the bytes are already a length-prefixed helper frame. */
function encodeJsonFrame(bytes) {
	return encodeFrame(0, bytes);
}
function withId(id, tail) {
	const payload = Buffer.allocUnsafe(4 + tail.length);
	payload.writeUInt32BE(id >>> 0, 0);
	tail.copy(payload, 4);
	return payload;
}
function jsonTail(value) {
	return Buffer.from(JSON.stringify(value) ?? "null", "utf8");
}
/** `stream-open` with the caller-supplied endpoint coordinates. */
function encodeOpenFrame(id, endpoint) {
	return encodeFrame(1, withId(id, jsonTail({ endpoint })));
}
/** `stream-open` acknowledgement. */
function encodeOpenOkFrame(id) {
	return encodeFrame(5, withId(id, Buffer.alloc(0)));
}
/** `stream-open` refusal; the client rejects its `connectStream()` promise. */
function encodeOpenFailFrame(id, message) {
	return encodeFrame(6, withId(id, jsonTail({ message })));
}
/** One data frame. */
function encodeDataFrame(id, payload) {
	return encodeFrame(2, withId(id, payload));
}
/** Half-close one direction of a stream. */
function encodeEndFrame(id, direction) {
	return encodeFrame(3, withId(id, Buffer.from([direction])));
}
/** Destroy one stream on both ends. */
function encodeAbortFrame(id, message) {
	return encodeFrame(4, withId(id, jsonTail({ message })));
}
/** Replenish the peer's send window. */
function encodeCreditFrame(id, bytes) {
	const tail = Buffer.allocUnsafe(4);
	tail.writeUInt32BE(bytes >>> 0, 0);
	return encodeFrame(7, withId(id, tail));
}
function parseJson(bytes, what) {
	try {
		return JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new FrameError(`malformed ${what} JSON payload`);
	}
}
function objectField(value, field) {
	if (typeof value !== "object" || value === null) return void 0;
	return value[field];
}
/**
* Incremental frame decoder. Feed it transport chunks; it returns every
* complete frame in order. A partial frame at the tail is buffered.
*/
var FrameDecoder = class {
	maxFrameBytes;
	buffer = Buffer.alloc(0);
	constructor(maxFrameBytes = DEFAULT_MAX_FRAME_BYTES) {
		this.maxFrameBytes = maxFrameBytes;
		if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes <= 0) throw new FrameError("maxFrameBytes must be a positive integer");
	}
	/** Bytes currently held for an incomplete frame (diagnostics and tests). */
	get pendingBytes() {
		return this.buffer.length;
	}
	/**
	* Decode every complete frame available in `chunk`.
	* @param chunk - transport bytes in arrival order.
	* @returns complete frames, in order.
	* @throws FrameError if a header or payload is malformed.
	*/
	push(chunk) {
		if (chunk.length === 0) return [];
		this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
		const frames = [];
		let offset = 0;
		while (this.buffer.length - offset >= 5) {
			const type = this.buffer.readUInt8(offset);
			const length = this.buffer.readUInt32BE(offset + 1);
			if (length === 0) throw new FrameError("frame declares an empty payload");
			if (length > this.maxFrameBytes) throw new FrameError(`frame length ${length} exceeds the ${this.maxFrameBytes} byte ceiling`);
			const end = offset + 5 + length;
			if (end > this.buffer.length) break;
			frames.push(this.decode(type, this.buffer.subarray(offset + 5, end)));
			offset = end;
		}
		this.buffer = offset === 0 ? this.buffer : this.buffer.subarray(offset);
		return frames;
	}
	/**
	* Assert the transport ended exactly on a frame boundary.
	* @throws FrameError if a frame is truncated, because the peer's outcome is unknown.
	*/
	end() {
		if (this.buffer.length !== 0) throw new FrameError("transport ended inside a frame");
	}
	decode(type, payload) {
		switch (type) {
			case 0: return {
				type: 0,
				json: payload
			};
			case 1: {
				const { id, tail } = this.readId(payload, "stream-open");
				return {
					type: 1,
					id,
					endpoint: objectField(parseJson(tail, "stream-open"), "endpoint")
				};
			}
			case 5: return {
				type: 5,
				id: this.readId(payload, "stream-open acknowledgement").id
			};
			case 6: {
				const { id, tail } = this.readId(payload, "stream-open refusal");
				return {
					type: 6,
					id,
					message: this.readMessage(tail, "stream-open refusal")
				};
			}
			case 2: {
				const { id, tail } = this.readId(payload, "stream data");
				return {
					type: 2,
					id,
					payload: tail
				};
			}
			case 3: {
				const { id, tail } = this.readId(payload, "stream half-close");
				if (tail.length !== 1) throw new FrameError("stream half-close must carry exactly one direction byte");
				const direction = tail.readUInt8(0);
				if (direction !== END_DIRECTION.inbound && direction !== END_DIRECTION.outbound) throw new FrameError(`unknown stream half-close direction ${direction}`);
				return {
					type: 3,
					id,
					direction
				};
			}
			case 4: {
				const { id, tail } = this.readId(payload, "stream abort");
				return {
					type: 4,
					id,
					message: this.readMessage(tail, "stream abort")
				};
			}
			case 7: {
				const { id, tail } = this.readId(payload, "stream credit");
				if (tail.length !== 4) throw new FrameError("stream credit must carry exactly four bytes");
				return {
					type: 7,
					id,
					bytes: tail.readUInt32BE(0)
				};
			}
			default: throw new FrameError(`unknown frame type ${type}`);
		}
	}
	readId(payload, what) {
		if (payload.length < 4) throw new FrameError(`${what} frame is missing its stream id`);
		return {
			id: payload.readUInt32BE(0),
			tail: payload.subarray(4)
		};
	}
	readMessage(tail, what) {
		const message = objectField(parseJson(tail, what), "message");
		return typeof message === "string" ? message : "";
	}
};
/** How many transport bytes one logical stream may push before yielding to other streams. */
const STREAM_CHUNK_BYTES = DEFAULT_STREAM_CHUNK_BYTES;
/** One logical stream: writable half sends data, readable half receives it. */
var MuxChannel = class extends Duplex {
	mux;
	id;
	constructor(mux, id) {
		super({
			allowHalfOpen: true,
			autoDestroy: false,
			emitClose: true
		});
		this.mux = mux;
		this.id = id;
	}
	_read() {
		this.mux.pullCredit(this.id);
	}
	_write(chunk, _encoding, callback) {
		this.mux.writeChannel(this.id, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), callback);
	}
	_final(callback) {
		this.mux.endChannel(this.id);
		callback();
	}
	_destroy(error, callback) {
		this.mux.destroyChannel(this.id, error);
		callback(error);
	}
};
/**
* Adapt a readable/writable pair into a transport.
*
* Errors are contained here — a closing peer's EPIPE is a close, not a crash —
* and `destroy` stops reading and half-closes the writable side, so a shared
* stdout is never destroyed outright.
*/
function streamTransport(input, output) {
	input.on("error", () => {});
	output.on("error", () => {});
	let destroyed = false;
	return {
		write: (frame) => {
			if (destroyed) return;
			try {
				output.write(frame);
			} catch {
				destroyed = true;
			}
		},
		on: (event, listener) => {
			if (event === "data" || event === "close" || event === "end") input.on(event, listener);
			else output.on("error", listener);
		},
		destroy: () => {
			destroyed = true;
			if (!input.destroyed) input.destroy();
			if (!output.destroyed && !output.writableEnded) output.end();
		}
	};
}
/** Multiplexes logical streams and opaque RPC bytes over one transport. */
var FrameMux = class {
	options;
	decoder;
	channels = /* @__PURE__ */ new Map();
	pendingAccepts = /* @__PURE__ */ new Set();
	jsonChannel;
	jsonPump;
	settled;
	settle = () => {};
	nextId = 1;
	failure;
	closing = false;
	constructor(options) {
		this.options = options;
		if (options.role === "server" && options.accept === void 0) throw new Error("a server-role mux requires an accept hook");
		this.decoder = new FrameDecoder(options.maxFrameBytes ?? 67108864);
		this.settled = new Promise((resolve) => {
			this.settle = resolve;
		});
		this.jsonPump = new PassThrough({ highWaterMark: 65536 });
		this.jsonChannel = new PassThrough({ highWaterMark: 65536 });
		this.jsonPump.on("data", (chunk) => {
			this.sendJson(chunk);
		});
		this.jsonPump.on("error", (error) => {
			this.close(error);
		});
		this.jsonChannel.on("error", () => {});
		options.transport.on("data", (chunk) => {
			this.receive(chunk);
		});
		options.transport.on("error", (error) => {
			this.close(error);
		});
		options.transport.on("close", () => {
			this.close(this.failure ?? /* @__PURE__ */ new Error("remote workspace transport closed"));
		});
		options.transport.on("end", () => {
			this.close(/* @__PURE__ */ new Error("remote workspace transport ended"));
		});
	}
	/** RPC bytes arriving from the peer; hand this to `SshRpcPeer` as its input. */
	jsonInput() {
		return this.jsonChannel;
	}
	/** Writable that carries this side's RPC frames to the peer. */
	jsonOutput() {
		return this.jsonPump;
	}
	/** Resolves once the transport failed or closed; `undefined` after a clean close. */
	get closed() {
		return this.settled;
	}
	get openStreams() {
		return this.channels.size;
	}
	/**
	* Attach a stream and wait for the peer to accept it.
	* @param endpoint - peer-interpreted coordinates (the remote server maps the path to its stream).
	* @param signal - cancels the attempt; a late acceptance is destroyed.
	* @returns the attached duplex.
	*/
	async open(endpoint, signal) {
		if (this.failure !== void 0) throw this.failure;
		if (this.options.role !== "client") throw new Error("only a client-role mux opens streams");
		signal?.throwIfAborted();
		const id = this.allocateId();
		const channel = new MuxChannel(this, id);
		const state = this.createState(id, channel);
		const ok = Promise.withResolvers();
		this.accepts.set(id, ok);
		const abort = () => {
			this.accepts.delete(id);
			this.send(encodeAbortFrame(id, "stream allocation cancelled"));
			this.removeState(state, /* @__PURE__ */ new Error("stream allocation cancelled"));
			ok.reject(signal?.reason instanceof Error ? signal.reason : new Error(String(signal?.reason)));
		};
		signal?.addEventListener("abort", abort, { once: true });
		try {
			this.send(encodeOpenFrame(id, endpoint));
			await ok.promise;
			return channel;
		} finally {
			signal?.removeEventListener("abort", abort);
		}
	}
	/** Close the transport and fail every stream and pending open. */
	close(reason) {
		if (process.env.DSH_RW_DEBUG) console.error("[mux] CLOSE role=", this.options.role, "reason=", reason?.message);
		if (this.failure !== void 0) return;
		const error = reason ?? /* @__PURE__ */ new Error("remote workspace channel closed");
		this.failure = error;
		this.closing = true;
		for (const pending of this.accepts.values()) pending.reject(error);
		this.accepts.clear();
		for (const state of [...this.channels.values()]) this.removeState(state, error);
		this.jsonPump.destroy();
		this.jsonChannel.destroy();
		this.options.transport.destroy();
		this.settle(reason);
	}
	/** Await outstanding server-side accept hooks (tests and orderly shutdown). */
	async quiesce() {
		while (this.pendingAccepts.size > 0) await Promise.allSettled([...this.pendingAccepts]);
	}
	/** @internal */
	writeChannel(id, bytes, done) {
		const state = this.channels.get(id);
		if (state === void 0) {
			done(/* @__PURE__ */ new Error("stream is no longer open"));
			return;
		}
		state.waiting = {
			bytes,
			done
		};
		this.pump(state);
	}
	/** @internal */
	endChannel(id) {
		const state = this.channels.get(id);
		if (state === void 0 || state.sentEnd) return;
		state.sentEnd = true;
		this.send(encodeEndFrame(id, END_DIRECTION.inbound));
		this.reap(state);
	}
	/** @internal */
	destroyChannel(id, error) {
		const state = this.channels.get(id);
		if (state === void 0) return;
		if (!state.sentEnd) this.send(encodeAbortFrame(id, error?.message ?? "stream destroyed"));
		this.removeState(state, error ?? void 0);
	}
	/** @internal */
	pullCredit(id) {
		const state = this.channels.get(id);
		if (state === void 0) return;
		state.blocked = false;
		this.offerCredit(state);
	}
	accepts = /* @__PURE__ */ new Map();
	allocateId() {
		for (let attempt = 0; attempt <= MAX_STREAM_ID; attempt++) {
			const id = this.nextId;
			this.nextId = this.nextId >= 4294967295 ? 1 : this.nextId + 1;
			if (!this.channels.has(id) && !this.accepts.has(id)) return id;
		}
		throw new Error("no stream ids remain");
	}
	createState(id, channel) {
		const state = {
			id,
			channel,
			sendWindow: this.options.windowBytes ?? 1048576,
			waiting: void 0,
			pendingCredit: 0,
			blocked: false,
			sentEnd: false,
			receivedEnd: false,
			settled: false
		};
		channel.on("error", () => {});
		this.channels.set(id, state);
		return state;
	}
	removeState(state, error) {
		if (state.settled) return;
		state.settled = true;
		this.channels.delete(state.id);
		if (state.waiting !== void 0) {
			const { done } = state.waiting;
			state.waiting = void 0;
			done(error ?? /* @__PURE__ */ new Error("stream closed before the write completed"));
		}
		if (!state.channel.destroyed) state.channel.destroy(error);
	}
	/** Drop the channel once both halves are done. */
	reap(state) {
		if (!state.receivedEnd || !state.channel.writableEnded) return;
		if (!state.channel.destroyed) state.channel.destroy();
		this.channels.delete(state.id);
	}
	send(frame) {
		if (process.env.DSH_RW_DEBUG && frame.readUInt8(0) === 0) console.error("[mux] SEND json role=", this.options.role, "len=", frame.length);
		if (this.failure !== void 0) return;
		try {
			this.options.transport.write(frame);
		} catch (error) {
			this.close(error instanceof Error ? error : new Error(String(error)));
		}
	}
	sendJson(bytes) {
		for (let offset = 0; offset < bytes.length; offset += STREAM_CHUNK_BYTES) this.send(encodeJsonFrame(bytes.subarray(offset, Math.min(bytes.length, offset + STREAM_CHUNK_BYTES))));
	}
	pump(state) {
		const waiting = state.waiting;
		if (waiting === void 0 || state.settled) return;
		if (state.sendWindow <= 0) return;
		const size = Math.min(waiting.bytes.length, state.sendWindow, STREAM_CHUNK_BYTES);
		const chunk = waiting.bytes.subarray(0, size);
		const rest = waiting.bytes.subarray(size);
		state.sendWindow -= size;
		state.waiting = rest.length === 0 ? void 0 : {
			bytes: rest,
			done: waiting.done
		};
		this.send(encodeDataFrame(state.id, chunk));
		if (rest.length === 0) waiting.done();
	}
	offerCredit(state) {
		if (state.blocked || state.pendingCredit === 0) return;
		const credit = state.pendingCredit;
		state.pendingCredit = 0;
		this.send(encodeCreditFrame(state.id, credit));
	}
	receive(chunk) {
		let frames;
		try {
			frames = this.decoder.push(chunk);
		} catch (error) {
			this.close(error);
			return;
		}
		for (const frame of frames) {
			if (this.failure !== void 0) return;
			try {
				this.dispatch(frame);
			} catch (error) {
				this.close(error);
				return;
			}
		}
	}
	dispatch(frame) {
		switch (frame.type) {
			case 0:
				this.jsonChannel.write(frame.json);
				return;
			case 1:
				this.receiveOpen(frame.id, frame.endpoint);
				return;
			case 5: {
				const pending = this.accepts.get(frame.id);
				if (pending === void 0) return;
				this.accepts.delete(frame.id);
				pending.resolve();
				return;
			}
			case 6: {
				const state = this.channels.get(frame.id);
				if (state !== void 0) this.removeState(state, new Error(frame.message));
				const pending = this.accepts.get(frame.id);
				if (pending === void 0) return;
				this.accepts.delete(frame.id);
				pending.reject(new Error(frame.message === "" ? "the remote refused the stream" : frame.message));
				return;
			}
			case 2: {
				const state = this.requireState(frame.id, "data");
				const accepted = state.channel.push(frame.payload);
				state.pendingCredit += frame.payload.length;
				if (!accepted) state.blocked = true;
				this.offerCredit(state);
				return;
			}
			case 3: {
				const state = this.channels.get(frame.id);
				if (state === void 0) return;
				if (frame.direction === END_DIRECTION.inbound) {
					state.receivedEnd = true;
					if (!state.channel.readableEnded) state.channel.push(null);
					this.reap(state);
				} else {
					state.receivedEnd = true;
					if (!state.channel.destroyed) state.channel.destroy();
					this.channels.delete(state.id);
				}
				return;
			}
			case 4: {
				const state = this.channels.get(frame.id);
				if (state !== void 0) this.removeState(state, new Error(frame.message === "" ? "the remote aborted the stream" : frame.message));
				return;
			}
			case 7: {
				const state = this.channels.get(frame.id);
				if (state === void 0) return;
				state.sendWindow += frame.bytes;
				this.pump(state);
				return;
			}
			default: throw new FrameError("unknown frame type");
		}
	}
	requireState(id, what) {
		const state = this.channels.get(id);
		if (state === void 0) throw new FrameError(`received ${what} for unknown stream ${id}`);
		return state;
	}
	receiveOpen(id, endpoint) {
		if (this.options.role !== "server") throw new FrameError("a client-role mux must not receive stream-open");
		if (this.channels.has(id)) throw new FrameError(`stream ${id} is already attached`);
		const accept = this.options.accept;
		const task = Promise.resolve().then(async () => accept(endpoint, id)).then(async (binding) => {
			if (this.failure !== void 0) {
				if (binding !== void 0) destroyBinding(binding);
				return;
			}
			if (binding === void 0) {
				this.send(encodeOpenFailFrame(id, "the remote has no stream for that endpoint"));
				return;
			}
			const channel = new MuxChannel(this, id);
			this.createState(id, channel);
			channel.on("data", (chunk) => {
				if (!binding.inbound.write(chunk)) channel.pause();
			});
			binding.inbound.on("drain", () => {
				channel.resume();
			});
			binding.inbound.on("error", (error) => {
				channel.destroy(error);
			});
			channel.on("end", () => {
				binding.inbound.end();
			});
			binding.outbound.on("data", (chunk) => {
				if (!channel.write(chunk)) binding.outbound.pause();
			});
			channel.on("drain", () => {
				binding.outbound.resume();
			});
			binding.outbound.on("error", (error) => {
				channel.destroy(error);
			});
			binding.outbound.on("end", () => {
				channel.end();
			});
			channel.on("error", () => {
				destroyBinding(binding);
			});
			channel.on("close", () => {
				destroyBinding(binding);
			});
			this.send(encodeOpenOkFrame(id));
		}).catch((error) => {
			this.send(encodeOpenFailFrame(id, error instanceof Error ? error.message : String(error)));
		}).finally(() => {
			this.pendingAccepts.delete(task);
		});
		this.pendingAccepts.add(task);
	}
};
/** Release both halves of a served stream without throwing on an already-closed side. */
function destroyBinding(binding) {
	if (!binding.inbound.destroyed) binding.inbound.destroy();
	if (!binding.outbound.destroyed) binding.outbound.destroy();
}
//#endregion
//#region src/remote/ws-framing.ts
/**
* RFC 6455 WebSocket framing for the P1 execution-world mux.
*
* The transport is an SSH `forwardOut` channel, not a browser WebSocket, so the
* client has to speak the wire protocol itself: one **binary** WS message carries
* exactly one `src/frame/codec.ts` frame (§7). This module is only the framing
* layer (masking, continuation, ping/pong, close); stream/RPC semantics belong
* to `mux-client.ts`.
*/
/** WebSocket opcodes used by the mux. */
const WS_OPCODE = {
	continuation: 0,
	text: 1,
	binary: 2,
	close: 8,
	ping: 9,
	pong: 10
};
/** Encode one client-to-server frame (clients must mask). */
function encodeWebSocketFrame(opcode, payload, maskKey) {
	const length = payload.length;
	const header = length < 126 ? 2 : length <= 65535 ? 4 : 10;
	const mask = maskKey ?? Buffer.from([
		18,
		52,
		86,
		120
	]);
	const frame = Buffer.alloc(header + 4 + length);
	frame[0] = 128 | opcode & 15;
	if (length < 126) {
		frame[1] = 128 | length;
		mask.copy(frame, 2);
		for (let index = 0; index < length; index++) frame[6 + index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
	} else if (length <= 65535) {
		frame[1] = 254;
		frame.writeUInt16BE(length, 2);
		mask.copy(frame, 4);
		for (let index = 0; index < length; index++) frame[8 + index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
	} else {
		frame[1] = 255;
		frame.writeBigUInt64BE(BigInt(length), 2);
		mask.copy(frame, 10);
		for (let index = 0; index < length; index++) frame[14 + index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
	}
	return frame;
}
/** Incremental server-to-client frame decoder (server frames are unmasked). */
var WebSocketFrameDecoder = class {
	maxMessageBytes;
	buffer = Buffer.alloc(0);
	constructor(maxMessageBytes = 67108864) {
		this.maxMessageBytes = maxMessageBytes;
	}
	/** Feed bytes; returns every complete frame contained in them. */
	push(chunk) {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		const frames = [];
		for (;;) {
			if (this.buffer.length < 2) break;
			const first = this.buffer[0] ?? 0;
			const second = this.buffer[1] ?? 0;
			const fin = (first & 128) !== 0;
			const opcode = first & 15;
			const masked = (second & 128) !== 0;
			let length = second & 127;
			let offset = 2;
			if (length === 126) {
				if (this.buffer.length < 4) break;
				length = this.buffer.readUInt16BE(2);
				offset = 4;
			} else if (length === 127) {
				if (this.buffer.length < 10) break;
				const wide = this.buffer.readBigUInt64BE(2);
				if (wide > BigInt(this.maxMessageBytes)) throw new Error("websocket frame is too large");
				length = Number(wide);
				offset = 10;
			}
			if (length > this.maxMessageBytes) throw new Error("websocket frame is too large");
			const maskBytes = masked ? 4 : 0;
			if (this.buffer.length < offset + maskBytes + length) break;
			let payload = this.buffer.subarray(offset + maskBytes, offset + maskBytes + length);
			if (masked) {
				const mask = this.buffer.subarray(offset, offset + 4);
				const unmasked = Buffer.alloc(length);
				for (let index = 0; index < length; index++) unmasked[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
				payload = unmasked;
			}
			this.buffer = this.buffer.subarray(offset + maskBytes + length);
			frames.push({
				fin,
				opcode,
				payload: Buffer.from(payload)
			});
		}
		return frames;
	}
};
/**
* A `Duplex` that exposes WS binary messages as byte chunks to a `FrameMux`.
*
* `FrameMux` writes one encoded codec frame per `_write` call, which becomes one
* binary WS message; inbound binary messages are pushed as one chunk each, which
* is exactly what the mux decoder expects. Text/control frames are handled here
* (ping→pong, close→end), so the mux never sees them.
*/
var WebSocketFrameDuplex = class extends Duplex {
	socket;
	decoder;
	fragments = [];
	shut = false;
	constructor(socket, initial = Buffer.alloc(0), options = {}) {
		super({ allowHalfOpen: true });
		this.socket = socket;
		this.decoder = new WebSocketFrameDecoder(options.maxMessageBytes);
		socket.once("error", (error) => {
			this.destroy(error);
		});
		socket.once("close", () => {
			if (!this.shut) this.push(null);
		});
		socket.on("data", (chunk) => {
			let frames;
			try {
				frames = this.decoder.push(chunk);
			} catch (error) {
				this.destroy(error instanceof Error ? error : new Error(String(error)));
				return;
			}
			for (const frame of frames) this.receive(frame);
		});
		if (initial.length > 0) for (const frame of this.decoder.push(initial)) this.receive(frame);
	}
	receive(frame) {
		if (frame.opcode === WS_OPCODE.ping) {
			this.sendFrame(WS_OPCODE.pong, frame.payload);
			return;
		}
		if (frame.opcode === WS_OPCODE.pong) return;
		if (frame.opcode === WS_OPCODE.close) {
			this.sendFrame(WS_OPCODE.close, Buffer.alloc(0));
			this.shut = true;
			this.push(null);
			return;
		}
		if (frame.opcode === WS_OPCODE.text) {
			this.destroy(/* @__PURE__ */ new Error("the mux WebSocket sent a text frame; binary frames are required"));
			return;
		}
		if (frame.opcode === WS_OPCODE.binary || frame.opcode === WS_OPCODE.continuation) {
			if (!frame.fin) {
				this.fragments.push(frame.payload);
				return;
			}
			const payload = this.fragments.length === 0 ? frame.payload : Buffer.concat([...this.fragments, frame.payload]);
			this.fragments = [];
			this.push(payload);
		}
	}
	sendFrame(opcode, payload) {
		if (this.socket.destroyed || this.shut) return;
		this.socket.write(encodeWebSocketFrame(opcode, payload));
	}
	_read() {}
	_write(chunk, _encoding, callback) {
		if (this.shut || this.socket.destroyed) {
			callback(/* @__PURE__ */ new Error("the mux WebSocket is closed"));
			return;
		}
		this.sendFrame(WS_OPCODE.binary, Buffer.from(chunk));
		callback();
	}
	_final(callback) {
		this.sendFrame(WS_OPCODE.close, Buffer.alloc(0));
		this.shut = true;
		this.socket.end();
		callback();
	}
	_destroy(error, callback) {
		this.shut = true;
		if (!this.socket.destroyed) this.socket.destroy();
		callback(error);
	}
};
//#endregion
//#region src/remote/ws-mux.ts
/** Path of the server plugin's mux upgrade (protocol §4.1). */
const MUX_UPGRADE_PATH = "/dsh-remote-workspace-server/api/mux";
/** Capabilities sent in the outer hello. */
const MUX_CAPABILITIES = [
	"fs",
	"subprocess",
	"sandbox",
	"terminal",
	"process"
];
/**
* Open the HTTP upgrade through a forwarded channel.
* @returns the WS-framed duplex and the `FRAME_JSON` hello-ok payload.
*/
async function upgradeWebSocket(options) {
	const socket = await options.forwarder.open({ port: options.port });
	const key = Buffer.from(`${options.clientId}:${Date.now()}`).toString("base64").slice(0, 24);
	const headers = {
		host: `127.0.0.1:${options.port}`,
		connection: "Upgrade",
		upgrade: "websocket",
		"sec-websocket-version": "13",
		"sec-websocket-key": key,
		cookie: options.cookie,
		"x-dsh-rw-client": options.clientId,
		"x-dsh-rw-instance": options.instanceId,
		"x-dsh-rw-protocol": "1"
	};
	socket.write([
		`GET ${MUX_UPGRADE_PATH} HTTP/1.1`,
		...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
		"",
		""
	].join("\r\n"));
	const { status, head } = await new Promise((resolve, reject) => {
		let received = Buffer.alloc(0);
		const timer = setTimeout(() => {
			socket.destroy();
			reject(Object.assign(/* @__PURE__ */ new Error("the mux upgrade did not answer in time"), { code: "upstream-timeout" }));
		}, options.openTimeoutMs ?? 1e4);
		timer.unref?.();
		const onData = (chunk) => {
			received = Buffer.concat([received, chunk]);
			const end = received.indexOf("\r\n\r\n");
			if (end === -1) return;
			clearTimeout(timer);
			socket.off("data", onData);
			const text = received.subarray(0, end).toString("utf8");
			resolve({
				status: Number.parseInt((text.split("\r\n")[0] ?? "").split(" ")[1] ?? "0", 10),
				head: received.subarray(end + 4)
			});
		};
		socket.on("data", onData);
		socket.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
	if (status !== 101) {
		socket.destroy();
		throw Object.assign(/* @__PURE__ */ new Error(`the mux upgrade was refused (HTTP ${status})`), {
			code: "tunnel-unavailable",
			status
		});
	}
	return new WebSocketFrameDuplex(socket, head);
}
/** Read exactly one FRAME_JSON payload (the outer hello-ok). */
async function readHelloOk(mux, timeoutMs) {
	const input = mux.jsonInput();
	return await new Promise((resolve, reject) => {
		let buffer = Buffer.alloc(0);
		const timer = setTimeout(() => {
			cleanup();
			reject(/* @__PURE__ */ new Error("the mux hello-ok did not arrive in time"));
		}, timeoutMs);
		timer.unref?.();
		const cleanup = () => {
			clearTimeout(timer);
			input.off("data", onData);
		};
		const onData = (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);
			let parsed;
			try {
				parsed = JSON.parse(buffer.toString("utf8"));
			} catch {
				return;
			}
			cleanup();
			input.pause();
			if (parsed === null || typeof parsed !== "object" || parsed.kind !== "hello-ok") {
				reject(/* @__PURE__ */ new Error("the mux server answered an unexpected hello frame"));
				return;
			}
			resolve(parsed);
		};
		input.on("data", onData);
	});
}
/**
* Rewrite local-mode anchors to their server paths across one request payload.
*
* The official providers send the session cwd on every call (`fs.resolve
* {cwd}`, `process.prepare {cwd}`, sandbox `{workspaceRoot}`, …); local mode
* binds the session to a private anchor, which the server does not know. This is
* the single seam every mux request crosses, so one traversal covers all
* methods. Strings inside argv and arbitrary content are left untouched beyond
* exact path prefixes.
*/
function translateMuxAliases(value, aliases) {
	if (aliases.length === 0) return value;
	const walk = (item) => {
		if (typeof item === "string") {
			for (const alias of aliases) {
				if (item === alias.stub) return alias.remote;
				if (item.startsWith(`${alias.stub}/`)) return `${alias.remote}${item.slice(alias.stub.length)}`;
			}
			return item;
		}
		if (Array.isArray(item)) return item.map(walk);
		if (item !== null && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, walk(child)]));
		return item;
	};
	return walk(value);
}
/** One target's real `RemoteMuxBackend` over WS + FrameMux + SshRpcPeer. */
var WsMuxBackend = class {
	options;
	mux;
	peer;
	connecting;
	closed = false;
	constructor(options) {
		this.options = options;
	}
	/** Establish WS + outer hello + inner peer hello once. */
	async connect() {
		if (this.closed) throw Object.assign(/* @__PURE__ */ new Error("the remote mux is closed"), { code: "mux-disposed" });
		if (this.peer !== void 0) return;
		this.connecting ??= (async () => {
			const ws = await upgradeWebSocket(this.options);
			const mux = new FrameMux({
				transport: streamTransport(ws, ws),
				role: "client",
				label: "remote-mux"
			});
			this.mux = mux;
			const hello = {
				kind: "hello",
				protocol: 1,
				clientId: this.options.clientId,
				instanceId: this.options.instanceId,
				capabilities: MUX_CAPABILITIES
			};
			mux.jsonOutput().write(Buffer.from(JSON.stringify(hello), "utf8"));
			const helloOk = await readHelloOk(mux, this.options.openTimeoutMs ?? 1e4);
			const peer = new SshRpcPeer(mux.jsonInput(), mux.jsonOutput(), Math.min(DEFAULT_MAX_FRAME_BYTES, helloOk.maxFrameBytes > 0 ? helloOk.maxFrameBytes : DEFAULT_MAX_FRAME_BYTES), 128);
			await peer.request("hello", {
				protocol: SSH_PROTOCOL_VERSION,
				workspace: "/",
				leaseMs: this.options.leaseMs ?? 3e4
			}, helloSchema, AbortSignal.timeout(2e4));
			this.peer = peer;
		})();
		try {
			await this.connecting;
		} finally {
			this.connecting = void 0;
		}
	}
	/** One helper-method RPC over the mux JSON channel. */
	async request(endpoint, payload, signal) {
		await this.connect();
		const peer = this.peer;
		if (peer === void 0) throw Object.assign(/* @__PURE__ */ new Error("the remote mux is not connected"), { code: "mux-unavailable" });
		const outgoing = translateMuxAliases(payload, this.options.aliases?.() ?? []);
		try {
			return await peer.request(endpoint, outgoing, z.unknown(), signal);
		} catch (error) {
			const code = typeof error.code === "string" ? String(error.code) : "mux-request-failed";
			const message = error instanceof Error ? error.message : String(error);
			const payloadSummary = (() => {
				try {
					return scrubSecrets(JSON.stringify(payload)).slice(0, 4e3);
				} catch {
					return "[unserializable payload]";
				}
			})();
			throw Object.assign(new Error(scrubSecrets(`${endpoint} failed [${code}]: ${message}`)), {
				code,
				cause: error,
				details: {
					endpoint,
					remoteCode: code,
					remoteMessage: scrubSecrets(message),
					payload: payloadSummary
				}
			});
		}
	}
	/** Open one mux stream; `payload` carries the official `capability` token. */
	async openStream(endpoint, payload) {
		await this.connect();
		const mux = this.mux;
		if (mux === void 0) throw Object.assign(/* @__PURE__ */ new Error("the remote mux is not connected"), { code: "mux-unavailable" });
		const capability = payload?.capability;
		if (typeof capability !== "string" || capability === "") throw Object.assign(/* @__PURE__ */ new Error(`opening mux stream "${endpoint}" requires a capability token`), { code: "mux-request-failed" });
		let stream;
		try {
			stream = await mux.open({
				path: endpoint,
				capability
			});
		} catch (error) {
			const code = typeof error.code === "string" ? String(error.code) : "mux-request-failed";
			const message = error instanceof Error ? error.message : String(error);
			throw Object.assign(new Error(scrubSecrets(`opening mux stream ${endpoint} failed [${code}]: ${message}`)), {
				code,
				cause: error,
				details: {
					endpoint,
					remoteCode: code,
					remoteMessage: scrubSecrets(message),
					payload: scrubSecrets(JSON.stringify(payload)).slice(0, 2e3)
				}
			});
		}
		return {
			write: async (chunk) => {
				await new Promise((resolve, reject) => {
					stream.write(Buffer.from(chunk), (error) => error == null ? resolve() : reject(error));
				});
			},
			end: () => {
				stream.end();
			},
			abort: (reason) => {
				stream.destroy(new Error(reason ?? "stream aborted"));
			},
			read: async function* () {
				for await (const chunk of stream) yield new Uint8Array(chunk);
			}
		};
	}
	/** Close this target's mux and fail every stream. */
	async close() {
		if (this.closed) return;
		this.closed = true;
		try {
			await this.peer?.request("close", {}, z.null(), AbortSignal.timeout(3e3));
		} catch {}
		this.peer?.close();
		this.peer = void 0;
		this.mux?.close();
		this.mux = void 0;
	}
};
//#endregion
//#region src/session/mode-apply.ts
/**
* P3 `mode/apply` orchestration (protocol §16.13).
*
* dev-core's `ProfileService.modeApply` owns the HTTP route, preview/D20
* validation, target-record write and transport lifecycle; this helper adds the
* part that must stay next to the session bridge:
*
* - **server → local**: one P1 `executor/switch` for the target session (the
*   server plugin cancels that turn, disposes its managed handle or asks for a
*   restart); if `restartRequired` is true the injected profile restart runs
*   before the method resolves.
* - **local → server**: every locally-owned agent is released first
*   (cancel → idle → flush → close), then each session's executor record is
*   flipped to `server`. Releasing before flipping is what prevents a
*   server-mode writer from racing the local agent for the JSONL flock.
*
* Everything is injected; no Cordis/Node imports so dev-core can unit-test the
* state machine without a profile server.
*/
/** Turn one executor switch outcome into the route result shape. */
function resultOf(outcome, openSessionId) {
	return {
		switched: true,
		cancelledTurnIds: outcome.plannedCancellations,
		failedCancellations: [],
		restartRequired: outcome.restartRequired,
		switchedSessionIds: outcome.mode === "server" ? outcome.plannedCancellations : [],
		...openSessionId === void 0 ? {} : { openSessionId }
	};
}
/**
* Apply one connection-level executor switch.
*
* The route must already have validated the D20 preview (`cancelActiveTurns`
* consent + `previewRevision`); this helper performs the session/lease side.
* @param deps - executor RPC, local handle table and profile restart port.
* @param request - next mode, target session and D20 consent.
* @returns the route result; failures throw a coded {@link ExecutorError}.
*/
async function applyModeSwitch(deps, request) {
	if (request.nextMode === "local") {
		if (request.targetSessionId === void 0) throw new ExecutorError("bad-request", "switching to local needs the target session id (the server cancels or hands off that session)", 400);
		return resultOf(await deps.executor.switchTo({
			sessionId: request.targetSessionId,
			to: "local",
			confirmOtherTurns: request.confirmOtherTurns,
			...deps.restartProfile === void 0 ? {} : { restartProfile: deps.restartProfile }
		}), request.targetSessionId);
	}
	const local = deps.local;
	const owned = local?.list() ?? [];
	const failed = [];
	for (const sessionId of owned) try {
		await local?.release(sessionId);
	} catch (error) {
		failed.push({
			sessionId,
			message: error instanceof Error ? error.message : String(error)
		});
	}
	if (failed.length > 0) throw new ExecutorError("mode-switch/cancel-failed", "some local turns could not be cancelled and released; the executor record was not changed", 409, { failedCancellations: failed });
	const switchedSessionIds = [];
	for (const sessionId of owned) try {
		await deps.executor.switchTo({
			sessionId,
			to: "server",
			releaseLocal: async () => {}
		});
		switchedSessionIds.push(sessionId);
	} catch (error) {
		failed.push({
			sessionId,
			message: error instanceof Error ? error.message : String(error)
		});
	}
	if (failed.length > 0) throw new ExecutorError("mode-switch/cancel-failed", "local writers were released but some executor records could not be flipped to server", 409, {
		failedCancellations: failed,
		switchedSessionIds
	});
	return {
		switched: true,
		cancelledTurnIds: owned,
		failedCancellations: [],
		restartRequired: false,
		switchedSessionIds
	};
}
//#endregion
//#region src/provision/profile-service.ts
/**
* v1 profile service: connect one SSH host, install/start its per-client profile
* server, handshake the server plugin and expose the P1/portal surfaces the host
* routes need.
*
* This is the vertical slice behind `v1/connect` and `/api/state`:
*
*   SSH + host key → read-only scan → global dsh (verified runtime)
*   → offline server-plugin install (+ 4 profile files) → detached profile server
*   → token → official cookie (host memory only) → P1 handshake
*   → portal proxy + P1 client for workspace/session reads.
*
* The SSH connector is injectable (`ProfileConnector`) so host API integration
* tests can drive the whole service with a fake remote; production uses
* {@link createSshProfileConnector} over ssh2.
*/
/** Read a local private-key file (expanding `~/`) for the SSH connector. */
async function readPrivateKeyFile(path) {
	return await readFile(path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : resolve(path));
}
/** Default SSH connector: ssh2 + SFTP uploads, one connection per target. */
function createSshProfileConnector() {
	return { async connect(request) {
		const privateKey = request.privateKey ?? (request.privateKeyPath === void 0 ? void 0 : await readFile(request.privateKeyPath.startsWith("~/") ? resolve(homedir(), request.privateKeyPath.slice(2)) : resolve(request.privateKeyPath)));
		const auth = request.authKind === "password" ? {
			kind: "password",
			password: request.secret ?? ""
		} : request.authKind === "privateKey" ? {
			kind: "privateKey",
			privateKey: privateKey ?? Buffer.alloc(0),
			...request.secret === void 0 ? {} : { passphrase: request.secret }
		} : { kind: "agent" };
		const known = request.hostKeyFingerprint === void 0 || request.hostKeyFingerprint === "" ? await lookupKnownHost(request.host, request.port) : request.hostKeyFingerprint;
		const client = await connectSsh({
			host: request.host,
			port: request.port,
			username: request.username,
			auth,
			...known === void 0 || known === "" ? {} : { hostKeyFingerprint: known }
		});
		let sftp;
		let closing = false;
		const closeListeners = /* @__PURE__ */ new Set();
		client.once("close", () => {
			if (closing) return;
			for (const listener of closeListeners) try {
				listener();
			} catch {}
		});
		return {
			remote: {
				exec: async (body, options) => await execRemote(client, body, {
					maxBytes: options?.maxBytes ?? 1048576,
					timeoutMs: options?.timeoutMs ?? 6e4
				}).then((result) => ({
					code: result.code,
					stdout: result.stdout,
					stderr: result.stderr
				})),
				writeFile: async (path, content) => {
					if (sftp === void 0) sftp = await openSftp(client);
					await uploadRemoteFile(sftp, {
						path,
						content
					});
				}
			},
			forwarder: new SshForwarder(client),
			remoteForward: createRemoteForward(client),
			fingerprint: known ?? "",
			close: async () => {
				closing = true;
				try {
					sftp?.end();
				} catch {}
				client.end();
			},
			onClose: (listener) => {
				if (closing) return () => {};
				closeListeners.add(listener);
				return () => {
					closeListeners.delete(listener);
				};
			}
		};
	} };
}
/** The v1 profile lifecycle and P1/portal state for every target. */
var ProfileService = class {
	options;
	live = /* @__PURE__ */ new Map();
	failures = /* @__PURE__ */ new Map();
	/** workspaceId → server path, learned from P1 lists (local-mode header anchoring). */
	workspacePaths = /* @__PURE__ */ new Map();
	/** One local-mode runtime per target (owned handles + private anchors). */
	localRuntimes = /* @__PURE__ */ new Map();
	muxes = /* @__PURE__ */ new Map();
	reconnectClose = /* @__PURE__ */ new Map();
	reconnecting = /* @__PURE__ */ new Set();
	/** Remote execution-world presets registered for live v1 targets. */
	presetDisposers = /* @__PURE__ */ new Map();
	/** Last registry revision this host read for each target (state badge). */
	registryRevisions = /* @__PURE__ */ new Map();
	/** Shared view state read from workspace/list, merged into session rows. */
	registryViewState = /* @__PURE__ */ new Map();
	instanceId = generateInstanceId();
	/** Serializes connects: one profile server may be started at a time. */
	connectChain = Promise.resolve();
	/** Client-local model bridges + reverse tunnels, one pair per live target. */
	localLlm;
	constructor(options) {
		this.options = options;
		this.localLlm = new LocalLlmService(options.store, { llm: () => this.options.ctx?.get("llm") });
	}
	/** The client host's model runtime (`ctx.llm`), when the installation has one. */
	resolveLlm() {
		return this.options.ctx?.get("llm");
	}
	/** The installation's stable clientId (also used by the old state route). */
	async clientId() {
		return await this.options.store.ensureClientId();
	}
	/** Anchor paths of one target mapped to their server-real workspace paths. */
	pathAliasesFor(targetId) {
		const runtime = this.localRuntimes.get(targetId);
		if (runtime === void 0) return [];
		const aliases = [];
		for (const entry of runtime.anchors.entries()) {
			const remote = this.remotePathForWorkspace(entry.workspaceId);
			if (remote !== void 0 && remote !== "" && entry.path !== remote) aliases.push({
				stub: entry.path,
				remote
			});
		}
		return aliases;
	}
	/** One target's execution-world mux, created lazily from its live profile. */
	muxFor(targetId) {
		const live = this.live.get(targetId);
		if (live === void 0) return void 0;
		const existing = this.muxes.get(targetId);
		if (existing !== void 0) return existing;
		const mux = new WsMuxBackend({
			forwarder: live.connection.forwarder,
			port: live.handle.port,
			cookie: live.cookie,
			clientId: this.options.store.clientId() ?? "",
			instanceId: this.instanceId,
			aliases: () => this.pathAliasesFor(targetId)
		});
		this.muxes.set(targetId, mux);
		return mux;
	}
	/** Drop one target's mux (profile restart/disconnect invalidates it). */
	async closeMux(targetId) {
		const mux = this.muxes.get(targetId);
		if (mux === void 0) return;
		this.muxes.delete(targetId);
		await mux.close().catch(() => void 0);
	}
	/** One target's portal proxy, when its profile is live. */
	portalFor(targetId) {
		return this.live.get(targetId)?.portal;
	}
	/** One target's P1 client, when connected. */
	pluginFor(targetId) {
		return this.live.get(targetId)?.plugin;
	}
	/** All live connection states, keyed by target id. */
	connections() {
		const out = {};
		for (const target of this.options.store.listTargets()) {
			const state = this.connectionState(target.id);
			if (state !== void 0) out[target.id] = state;
		}
		for (const [targetId, error] of this.failures) {
			if (out[targetId] !== void 0) continue;
			out[targetId] = this.failedState(targetId, error);
		}
		return out;
	}
	/** Describe one target's connection/profile state (or undefined when unknown). */
	connectionState(targetId) {
		const live = this.live.get(targetId);
		if (live !== void 0) return this.readyState(live);
		const target = this.options.store.target(targetId);
		if (target === void 0) return void 0;
		if (this.reconnecting.has(targetId)) return {
			targetId,
			phase: "connecting",
			profile: null,
			runtime: null,
			plugin: null,
			portal: {
				base: portalPath(targetId),
				muxPath: portalMuxPath(targetId)
			},
			error: {
				code: "ssh-reconnecting",
				message: "the SSH connection was lost; reconnecting (up to 5 attempts)"
			}
		};
		return {
			targetId,
			phase: "stopped",
			profile: target.profileName === void 0 ? null : { name: target.profileName },
			runtime: target.runtimeKind === void 0 ? null : {
				kind: target.runtimeKind,
				...target.pluginVersion === void 0 ? {} : { version: target.pluginVersion },
				...target.serverDshVersion === void 0 ? {} : { dshVersion: target.serverDshVersion },
				...target.runtimeDir === void 0 ? {} : { launcher: target.runtimeDir }
			},
			plugin: {
				installed: target.pluginVersion !== void 0,
				...target.pluginVersion === void 0 ? {} : { version: target.pluginVersion }
			},
			portal: {
				base: portalPath(targetId),
				muxPath: portalMuxPath(targetId)
			},
			...this.deploymentState(targetId) === void 0 ? {} : { deployment: this.deploymentState(targetId) },
			...target.lastError === void 0 ? {} : { error: {
				code: "last-error",
				message: target.lastError
			} }
		};
	}
	/** Deployment status for the UI (no claim that a confirmation was obtained). */
	deploymentState(targetId) {
		const record = this.options.store.target(targetId);
		if (record === void 0) return void 0;
		const live = this.live.get(targetId);
		const expectedRuntime = DSH_VERIFIED_RUNTIMES[0] ?? "0.2.1-rc.3";
		const runtimeKind = live?.runtimeKind ?? record.runtimeKind ?? "global";
		const installedRuntime = live?.dshVersion ?? record.serverDshVersion;
		const runtimeAction = installedRuntime === void 0 ? "install" : installedRuntime === expectedRuntime ? "reuse" : "upgrade";
		const expectedPlugin = this.options.pluginVersion;
		const installedPlugin = live?.pluginVersion ?? record.pluginVersion;
		const pluginAction = installedPlugin === void 0 ? "install" : installedPlugin === expectedPlugin ? "reuse" : "upgrade";
		const dedicated = record.profileName === void 0 || record.profileName === this.profileForClient(record.clientId);
		return {
			runtime: {
				kind: runtimeKind,
				...installedRuntime === void 0 ? {} : { installedVersion: installedRuntime },
				expectedVersion: expectedRuntime,
				action: runtimeAction,
				requiresConfirmation: runtimeKind === "global" && runtimeAction !== "reuse",
				mode: runtimeKind === "global" ? "confirm" : "auto",
				reason: runtimeKind === "global" ? "changing the shared global DSH affects every profile on the server" : "per-client isolated runtime installs/upgrades automatically"
			},
			plugin: {
				profile: record.profileName ?? "",
				dedicated,
				...installedPlugin === void 0 ? {} : { installedVersion: installedPlugin },
				expectedVersion: expectedPlugin,
				action: pluginAction,
				requiresConfirmation: !dedicated
			}
		};
	}
	profileForClient(clientId) {
		return clientId === void 0 ? "" : `graydovee-remote-workspace-${clientId}`;
	}
	readyState(live) {
		const capabilities = live.plugin.capabilities;
		return {
			targetId: live.targetId,
			phase: "ready",
			profile: {
				name: live.paths.profile,
				port: live.handle.port,
				pid: live.handle.pid,
				startedAt: live.startedAt
			},
			runtime: {
				kind: live.runtimeKind,
				dshVersion: live.dshVersion,
				launcher: live.launcher,
				...live.runtimeDir === "" ? {} : { version: live.pluginVersion }
			},
			plugin: {
				installed: true,
				version: live.pluginVersion,
				protocol: 1
			},
			...capabilities === void 0 ? {} : { capabilities },
			...capabilities?.embed === void 0 ? {} : { embed: {
				storagePrefix: capabilities.embed.storagePrefix,
				mode: capabilities.embed.mode
			} },
			portal: {
				base: portalPath(live.targetId),
				muxPath: portalMuxPath(live.targetId)
			},
			...this.deploymentState(live.targetId) === void 0 ? {} : { deployment: this.deploymentState(live.targetId) },
			...this.registryRevisions.get(live.targetId) === void 0 ? {} : { registry: {
				...this.registryRevisions.get(live.targetId),
				stale: false
			} }
		};
	}
	failedState(targetId, error) {
		return {
			targetId,
			phase: "failed",
			profile: null,
			runtime: null,
			plugin: null,
			portal: {
				base: portalPath(targetId),
				muxPath: portalMuxPath(targetId)
			},
			error
		};
	}
	/**
	* Connect + install + start + handshake one target.
	*
	* Nothing becomes visible in `/api/state` until the handshake succeeds; a
	* failure stops the started process/channel and records a scrubbed error.
	*/
	async connect(request, onProgress) {
		const run = this.connectChain.then(async () => await this.connectOnce(request, onProgress), async () => await this.connectOnce(request, onProgress));
		this.connectChain = run.then(() => void 0, () => void 0);
		return await run;
	}
	async connectOnce(request, onProgress) {
		const clientId = await this.options.store.ensureClientId();
		let connection;
		let handle;
		let transport;
		const existing = this.options.store.listTargets().find((target) => target.label.toLowerCase() === request.label.toLowerCase());
		const targetId = existing?.id ?? `rt-${randomUUID().slice(0, 8)}`;
		const modelSource = request.modelSource ?? (existing === void 0 ? "local" : effectiveModelSource(existing));
		let localModelPlan;
		let localModel;
		let activeStep = "connect";
		const emit = (step, status, message) => {
			try {
				onProgress?.({
					step,
					status,
					message,
					at: (/* @__PURE__ */ new Date()).toISOString()
				});
			} catch {}
		};
		const begin = (step, message) => {
			activeStep = step;
			emit(step, "running", message);
		};
		if (this.live.has(targetId)) await this.stop(targetId).catch(() => false);
		const storedSecret = existing === void 0 || request.secret !== void 0 ? void 0 : await this.options.store.secretOf(existing);
		const effectiveRequest = {
			...request,
			...request.hostKeyFingerprint !== void 0 || existing?.hostKeyFingerprint === void 0 ? {} : { hostKeyFingerprint: existing.hostKeyFingerprint },
			...request.privateKeyPath !== void 0 || existing?.privateKeyPath === void 0 ? {} : { privateKeyPath: existing.privateKeyPath },
			...request.secret !== void 0 || storedSecret === void 0 ? {} : { secret: storedSecret }
		};
		try {
			if (modelSource === "local") {
				const llm = this.resolveLlm();
				localModelPlan = await planLocalLlm(this.options.store, llm === void 0 ? {} : { llm });
			}
			begin("connect", `正在建立 SSH 连接 ${effectiveRequest.username}@${effectiveRequest.host}:${effectiveRequest.port}…`);
			connection = await this.options.connector.connect(effectiveRequest);
			emit("connect", "ok", `SSH 已连接 ${effectiveRequest.username}@${effectiveRequest.host}`);
			begin("probe", "正在探测远端环境…");
			const scan = await this.scan(connection.remote);
			const dshHome = request.dshHome ?? scan.dshHome ?? `${scan.home ?? ""}/.dsh`;
			const paths = profilePaths(dshHome, clientId);
			const tarball = await this.resolvePluginTarball();
			const setup = await this.inspectRemoteSetup(connection, scan, dshHome, clientId, request, tarball);
			emit("probe", "ok", `远端环境 ${scan.platform ?? ""} ${scan.machine ?? ""}；${setup.summary}`.trim());
			await stopProfileServer(connection.remote, paths).catch(() => false);
			await waitForProfileStopped(connection.remote, paths).catch(() => false);
			let runtime;
			if (setup.runtime.action === "reuse") {
				activeStep = "runtime";
				runtime = await this.resolveRuntime(connection, scan, dshHome, clientId, request, (message) => {
					emit("runtime", "running", message);
				});
				if (runtime.action === "reuse") emit("runtime", "skipped", setup.runtime.detail);
				else emit("runtime", "ok", runtime.kind === "global" ? "复用 server 全局 DSH" : runtime.action === "upgrade" ? "隔离 runtime 已更新" : "隔离 runtime 已部署");
			} else {
				begin("runtime", setup.runtime.action === "install" ? "正在部署 DSH 运行时…" : "正在更新 DSH 运行时…");
				runtime = await this.resolveRuntime(connection, scan, dshHome, clientId, request, (message) => {
					emit("runtime", "running", message);
				});
				emit("runtime", "ok", runtime.kind === "global" ? "复用 server 全局 DSH" : runtime.action === "upgrade" ? "隔离 runtime 已更新" : "隔离 runtime 已部署");
			}
			activeStep = "upload";
			if ((await installServerPlugin({
				remote: connection.remote,
				paths,
				tarball,
				dshVersion: runtime.dshVersion
			})).installed) {
				const schemastery = this.resolvePeerPackage("@deepseek-ai/schemastery");
				if (schemastery !== void 0) await installProfilePeerPackage(connection.remote, paths, {
					name: "@deepseek-ai/schemastery",
					packageDir: schemastery
				});
				else console.warn("[dsh-remote-workspace] @deepseek-ai/schemastery is not resolvable on the client; skipping the offline peer copy");
				emit("upload", "ok", setup.plugin.action === "upgrade" ? "server 插件已更新" : "server 插件已安装");
			} else emit("upload", "skipped", setup.plugin.detail);
			let startEnv;
			if (modelSource === "local") {
				if (localModelPlan === void 0) throw new LocalLlmError("local-llm-unconfigured", "the local model source is selected but no endpoint plan was loaded");
				localModel = await this.localLlm.prepare(targetId, connection, localModelPlan);
				if (localModel === void 0) throw new LocalLlmError("local-llm-unconfigured", "the local model source is selected but its bridge was not started");
				await writeProfilePatch(connection.remote, paths, buildLocalModelPatch({
					remotePort: localModel.remotePort,
					routes: localModel.routes
				}));
				startEnv = { [LOCAL_LLM_API_KEY_ENV]: LOCAL_LLM_BRIDGE_API_KEY };
				emit("start", "running", localModel.mode === "auto" ? `本地模型已就绪（自动代理 ${localModel.routes.length} 个 provider、${localModel.models.length} 个模型，反向隧道端口 ${localModel.remotePort}）` : `本地模型已就绪（${localModel.models.length} 个模型，反向隧道端口 ${localModel.remotePort}）`);
			} else await writeProfilePatch(connection.remote, paths, "[]\n");
			begin("start", `正在启动 profile ${paths.profile}…`);
			handle = await startProfileServer(connection.remote, paths, {
				launcher: runtime.launcher,
				pathPrefixes: runtime.pathPrefixes,
				timeoutMs: PROFILE_STARTUP_TIMEOUT_MS,
				...startEnv === void 0 ? {} : { env: startEnv },
				probe: async (startup) => await this.probeRoot(connection, startup.port, startup.token)
			});
			const cookie = await this.exchangeToken(connection, handle.port, handle.token);
			transport = new TunnelPluginTransport(connection.forwarder, handle.port);
			const plugin = new RemotePluginClient({
				transport,
				clientId,
				instanceId: this.instanceId,
				pluginVersion: this.options.pluginVersion,
				cookie
			});
			const handshake = await plugin.handshake({ profile: paths.profile });
			emit("start", "ok", `profile ${paths.profile} 已就绪，SSH 隧道已建立`);
			if (typeof handshake.registry?.revision === "string" && handshake.registry.revision !== "") this.registryRevisions.set(targetId, {
				revision: handshake.registry.revision,
				...typeof handshake.registry.epoch === "string" ? { epoch: handshake.registry.epoch } : {}
			});
			const portal = new PortalProxy(targetId, this.portalUpstream(connection, handle.port), cookie);
			const disposeUpgrade = this.options.registerPortalUpgrade?.(targetId, portal) ?? (() => {});
			const startedAt = (this.options.now?.() ?? /* @__PURE__ */ new Date()).toISOString();
			const target = await this.persistTarget(effectiveRequest, {
				targetId,
				clientId,
				profileName: paths.profile,
				profilePort: handle.port,
				pluginVersion: handshake.pluginVersion,
				launcher: runtime.launcher,
				runtimeDir: runtime.runtimeDir,
				runtimeKind: runtime.kind,
				serverDshVersion: runtime.dshVersion,
				dshHome,
				modelSource
			});
			await this.registerTargetPreset(target);
			const live = {
				targetId,
				connection,
				paths,
				launcher: runtime.launcher,
				pathPrefixes: runtime.pathPrefixes,
				dshVersion: handshake.dshVersion,
				runtimeKind: runtime.kind,
				runtimeDir: runtime.runtimeDir,
				pluginVersion: handshake.pluginVersion,
				handle,
				cookie,
				transport,
				plugin,
				portal,
				disposeUpgrade,
				startedAt,
				modelSource,
				...startEnv === void 0 ? {} : { startEnv },
				...localModel === void 0 ? {} : { localModel }
			};
			this.live.set(targetId, live);
			this.failures.delete(targetId);
			const detachClose = connection.onClose?.(() => {
				this.reconnectLost(targetId);
			});
			if (detachClose !== void 0) this.reconnectClose.set(targetId, detachClose);
			return {
				target,
				state: this.readyState(live)
			};
		} catch (error) {
			if (error instanceof HostKeyUnknownError) emit("connect", "running", "等待确认主机指纹");
			else emit(activeStep, "failed", scrubSecrets(error instanceof Error ? error.message : String(error)));
			await this.localLlm.teardown(targetId).catch(() => void 0);
			await transport?.dispose();
			if (handle !== void 0 && connection !== void 0) {
				await stopProfileServer(connection.remote, handle.paths).catch(() => false);
				await waitForProfileStopped(connection.remote, handle.paths).catch(() => false);
			}
			await connection?.close().catch(() => void 0);
			await this.disposeTargetPreset(targetId).catch(() => void 0);
			if (existing !== void 0) await this.options.store.updateTarget(targetId, (current) => ({
				...current,
				status: "failed",
				lastError: scrubSecrets(error instanceof Error ? error.message : String(error))
			})).catch(() => void 0);
			throw error;
		}
	}
	/** Retry an unexpectedly closed SSH link five times, then leave the row failed. */
	async reconnectLost(targetId) {
		if (this.reconnecting.has(targetId)) return;
		const record = this.options.store.target(targetId);
		if (record === void 0) return;
		await this.localLlm.teardown(targetId).catch(() => void 0);
		this.reconnecting.add(targetId);
		try {
			for (let attempt = 1; attempt <= 5; attempt += 1) {
				if (attempt > 1) await new Promise((resolve) => {
					setTimeout(resolve, Math.min(8e3, 400 * 2 ** (attempt - 2)));
				});
				const secret = await this.options.store.secretOf(record).catch(() => void 0);
				try {
					const result = await this.connect({
						label: record.label,
						host: record.host,
						port: record.port,
						username: record.username,
						authKind: record.authKind,
						...record.privateKeyPath === void 0 ? {} : { privateKeyPath: record.privateKeyPath },
						...secret === void 0 || secret === "" ? {} : { secret },
						...record.hostKeyFingerprint === "" ? {} : { hostKeyFingerprint: record.hostKeyFingerprint },
						...record.remote.dshHome === "" ? {} : { dshHome: record.remote.dshHome }
					});
					if (result.state.phase === "ready" || result.state.phase === "degraded") return;
				} catch (error) {
					const code = error?.code;
					if (code === "ssh-auth-failed" || code === "hostkey-mismatch" || code === "HOST_KEY_MISMATCH") return;
				}
			}
			this.failures.set(targetId, {
				code: "ssh-reconnect-failed",
				message: "the SSH connection closed and five reconnect attempts failed"
			});
			await this.options.store.updateTarget(targetId, (current) => ({
				...current,
				status: "failed",
				lastError: "the SSH connection closed and five reconnect attempts failed"
			})).catch(() => void 0);
		} finally {
			this.reconnecting.delete(targetId);
		}
	}
	/** Stop one target: cancel turns, stop the profile server, close the tunnel. */
	async stop(targetId) {
		const live = this.live.get(targetId);
		if (live === void 0) return false;
		this.live.delete(targetId);
		this.reconnectClose.get(targetId)?.();
		this.reconnectClose.delete(targetId);
		await this.disposeTargetPreset(targetId);
		await this.closeMux(targetId);
		const local = this.localRuntimes.get(targetId);
		if (local !== void 0) {
			this.localRuntimes.delete(targetId);
			await local.dispose().catch(() => void 0);
		}
		live.disposeUpgrade();
		live.portal.close();
		live.transport.dispose();
		await live.plugin.cancelAll().catch(() => void 0);
		await stopProfileServer(live.connection.remote, live.paths).catch(() => false);
		await waitForProfileStopped(live.connection.remote, live.paths).catch(() => false);
		await this.localLlm.teardown(targetId);
		await live.connection.close().catch(() => void 0);
		this.options.onPortalClosed?.(targetId);
		await this.options.store.updateTarget(targetId, (current) => ({
			...current,
			status: "stopped"
		})).catch(() => void 0);
		return true;
	}
	/** Stop every live profile (plugin unload). */
	async dispose() {
		for (const targetId of [...this.live.keys()]) await this.stop(targetId).catch(() => false);
		for (const [targetId, runtime] of [...this.localRuntimes]) {
			this.localRuntimes.delete(targetId);
			await runtime.dispose().catch(() => void 0);
		}
		for (const targetId of [...this.muxes.keys()]) await this.closeMux(targetId);
		for (const targetId of [...this.presetDisposers.keys()]) await this.disposeTargetPreset(targetId);
		await this.localLlm.close().catch(() => void 0);
	}
	/** P1 read: workspace list. */
	async workspaceList(targetId) {
		const value = await this.pluginFor(targetId)?.rpc("workspace/list", {}) ?? { workspaces: [] };
		this.rememberWorkspacePaths(value);
		const registry = value.registry;
		if (typeof registry?.revision === "string" && registry.revision !== "") {
			const list = value;
			this.registryRevisions.set(targetId, {
				revision: registry.revision,
				...typeof registry.epoch === "string" ? { epoch: registry.epoch } : {}
			});
			this.registryViewState.set(targetId, {
				pinned: Array.isArray(list.pinnedSessionIds) ? list.pinnedSessionIds.filter((id) => typeof id === "string") : [],
				archived: Array.isArray(list.archivedSessionIds) ? list.archivedSessionIds.filter((id) => typeof id === "string") : []
			});
		}
		return value;
	}
	/** P1 read: session list for one workspace (or all). */
	async sessionList(targetId, workspaceId) {
		const value = await this.pluginFor(targetId)?.rpc("session/list", workspaceId === void 0 ? {} : { workspaceId }) ?? { sessions: [] };
		let view = this.registryViewState.get(targetId);
		if (view === void 0) {
			try {
				await this.workspaceList(targetId);
			} catch {}
			view = this.registryViewState.get(targetId);
		}
		const sessions = value.sessions;
		if (view === void 0 || !Array.isArray(sessions)) return value;
		const pinned = new Set(view.pinned);
		const archived = new Set(view.archived);
		return {
			...value,
			sessions: sessions.map((row) => {
				if (row === null || typeof row !== "object") return row;
				const record = row;
				const id = typeof record.sessionId === "string" ? record.sessionId : "";
				return {
					...record,
					pinned: pinned.has(id) || record.pinned === true,
					archived: archived.has(id) || record.archived === true
				};
			})
		};
	}
	/**
	* UI refresh (D12): reload the official workspace row first when possible,
	* then read both lists.
	*
	* A profile server keeps the registry in memory; another client's pin/archive
	* write lands in the shared `workspace.json` and is only visible to this
	* process after the loader disable/enable. Without this step a plain
	* `/api/state/refresh` shows stale pin/archive flags until the user presses the
	* separate "load server changes" action. The reload does not touch turns or
	* the process; a reload failure degrades to the read-only path and is reported.
	*/
	async refresh(targetId) {
		const plugin = this.pluginFor(targetId);
		if (plugin === void 0) throw new Error(`remote target "${targetId}" is not connected`);
		let registryReloaded = false;
		let registryReloadError;
		try {
			await plugin.rpc("registry/refresh", {});
			registryReloaded = true;
		} catch (error) {
			registryReloadError = {
				code: typeof error.code === "string" ? String(error.code) : "registry-reload-failed",
				message: error instanceof Error ? error.message : String(error)
			};
		}
		const workspaces = await this.workspaceList(targetId);
		const sessions = this.sessionFlags(targetId, await plugin.rpc("session/list", {}));
		return {
			workspaces,
			sessions: this.sessionFlags(targetId, sessions),
			stale: workspaces.registry?.stale === true || registryReloadError !== void 0,
			registryReloaded,
			...registryReloadError === void 0 ? {} : { registryReloadError }
		};
	}
	/** Merge already-cached registry pin/archive flags into one session/list value. */
	sessionFlags(targetId, value) {
		const view = this.registryViewState.get(targetId);
		const sessions = value?.sessions;
		if (view === void 0 || !Array.isArray(sessions)) return { sessions };
		const pinned = new Set(view.pinned);
		const archived = new Set(view.archived);
		return { sessions: sessions.map((row) => {
			if (row === null || typeof row !== "object") return row;
			const record = row;
			const id = typeof record.sessionId === "string" ? record.sessionId : "";
			return {
				...record,
				pinned: pinned.has(id) || record.pinned === true,
				archived: archived.has(id) || record.archived === true
			};
		}) };
	}
	/** Server path of a workspace learned from P1 (for local-mode anchors). */
	remotePathForWorkspace(workspaceId) {
		return this.workspacePaths.get(workspaceId);
	}
	/** Public alias view for the realm's `ctx.ssh` and the mux backend. */
	pathAliases(targetId) {
		return this.pathAliasesFor(targetId);
	}
	/** The private local anchor standing for one workspace (local mode). */
	anchorForWorkspace(workspaceId) {
		for (const runtime of this.localRuntimes.values()) {
			const path = runtime.anchorForWorkspace(workspaceId);
			if (path !== void 0) return path;
		}
	}
	/** Resolve a session cwd that is one of this process's private anchors. */
	routeForCwd(cwd) {
		for (const runtime of this.localRuntimes.values()) {
			const route = runtime.routeForCwd(cwd);
			if (route !== void 0) {
				const remoteCwd = this.remotePathForWorkspace(route.workspaceId);
				return {
					targetId: route.targetId,
					workspaceId: route.workspaceId,
					...remoteCwd === void 0 ? {} : { remoteCwd }
				};
			}
		}
	}
	/** Find the target/workspace owning a stored session through P1 `persist/locate`. */
	async locateRemoteSession(sessionId) {
		for (const targetId of this.live.keys()) try {
			const located = await this.rpc(targetId, "persist/locate", { sessionId });
			const remoteCwd = typeof located?.remoteCwd === "string" ? located.remoteCwd : void 0;
			const workspaceId = typeof located?.workspaceId === "string" ? located.workspaceId : remoteCwd === void 0 ? void 0 : [...this.workspacePaths].find(([, path]) => path === remoteCwd)?.[0];
			if (workspaceId !== void 0 && workspaceId !== "") return {
				targetId,
				workspaceId,
				...remoteCwd === void 0 ? {} : { remoteCwd }
			};
		} catch {}
	}
	/** One administrative P1 write/read (workspace, session, fs, executor). */
	async rpc(targetId, method, params = {}, signal) {
		const plugin = this.pluginFor(targetId);
		if (plugin === void 0) throw Object.assign(/* @__PURE__ */ new Error(`remote target "${targetId}" is not connected`), {
			code: "target-not-connected",
			status: 404
		});
		const value = await plugin.rpc(method, params, signal);
		this.rememberWorkspacePaths(value);
		return value;
	}
	rememberWorkspacePaths(value) {
		if (value === null || typeof value !== "object") return;
		const record = value;
		const rows = Array.isArray(record.workspaces) ? record.workspaces : record.workspace === void 0 ? [] : [record.workspace];
		for (const row of rows) if (typeof row.workspaceId === "string" && typeof row.path === "string") this.workspacePaths.set(row.workspaceId, row.path);
	}
	/** P3 workspace/session/fs write operations, forwarded to P1 unchanged. */
	workspaceCreate(targetId, path, title) {
		return this.rpc(targetId, "workspace/create", {
			path,
			...title === void 0 ? {} : { title }
		});
	}
	workspaceRename(targetId, workspaceId, title) {
		return this.rpc(targetId, "workspace/rename", {
			workspaceId,
			title
		});
	}
	workspaceDelete(targetId, workspaceId, force = false) {
		return this.rpc(targetId, "workspace/delete", {
			workspaceId,
			...force ? { force: true } : {}
		});
	}
	workspaceReorder(targetId, workspaceId, beforeWorkspaceId) {
		return this.rpc(targetId, "workspace/reorder", {
			workspaceId,
			...beforeWorkspaceId === void 0 ? {} : { beforeWorkspaceId }
		});
	}
	/** P3 new session: server mode forwards P1; local mode uses the host runtime. */
	async sessionCreate(targetId, params) {
		if (params.executor !== "local") {
			const result = await this.rpc(targetId, "session/create", params);
			return {
				...result,
				sessionId: typeof result.sessionId === "string" ? result.sessionId : "",
				workspaceId: params.workspaceId,
				executor: "server",
				revealed: true
			};
		}
		if (params.workspaceId === void 0 || params.workspaceId === "") throw Object.assign(/* @__PURE__ */ new Error("a local-mode session needs a workspaceId"), {
			code: "bad-request",
			status: 400
		});
		const runtime = this.localRuntimeFor(targetId);
		if (runtime === void 0) throw Object.assign(/* @__PURE__ */ new Error("local mode is not available for this target"), {
			code: "local-runtime-unavailable",
			status: 500
		});
		try {
			if (this.remotePathForWorkspace(params.workspaceId) === void 0) await this.workspaceList(targetId);
			const created = await runtime.create({ workspaceId: params.workspaceId });
			return {
				sessionId: created.sessionId,
				workspaceId: created.workspaceId,
				executor: "local",
				revealed: created.revealed
			};
		} catch (error) {
			if (error instanceof LocalSessionError) throw Object.assign(new Error(error.message), {
				code: error.code,
				status: 409,
				details: error.details
			});
			throw error;
		}
	}
	/**
	* P3 open: local mode resumes/attaches a client-owned handle; server mode is
	* iframe. When the caller omits `executor`, infer it from the server's
	* authoritative executor record: a session created in local mode must not be
	* reopened as server mode just because the UI did not repeat the choice.
	*/
	async sessionOpen(targetId, params) {
		const lookup = await this.executorModeOf(targetId, params.sessionId);
		const recorded = lookup.mode;
		const executor = recorded ?? params.executor ?? "server";
		const diagnostics = {
			executorSource: recorded === void 0 ? "fallback" : "record",
			...recorded === void 0 ? {} : { recordedExecutor: recorded },
			...lookup.error === void 0 ? {} : { executorLookupError: lookup.error }
		};
		if (executor !== "local") return {
			sessionId: params.sessionId,
			workspaceId: params.workspaceId,
			executor: "server",
			revealed: true,
			...diagnostics
		};
		if (params.workspaceId === void 0 || params.workspaceId === "") throw Object.assign(/* @__PURE__ */ new Error("a local-mode session needs a workspaceId"), {
			code: "bad-request",
			status: 400
		});
		const runtime = this.localRuntimeFor(targetId);
		if (runtime === void 0) throw Object.assign(/* @__PURE__ */ new Error("local mode is not available for this target"), {
			code: "local-runtime-unavailable",
			status: 500
		});
		if (this.remotePathForWorkspace(params.workspaceId) === void 0) await this.workspaceList(targetId).catch(() => void 0);
		try {
			const opened = await runtime.open({
				workspaceId: params.workspaceId,
				sessionId: params.sessionId
			});
			return {
				sessionId: opened.sessionId,
				workspaceId: opened.workspaceId,
				executor: "local",
				revealed: opened.revealed,
				...diagnostics
			};
		} catch (error) {
			if (error instanceof LocalSessionError) throw Object.assign(new Error(error.message), {
				code: error.code,
				status: 409,
				details: error.details
			});
			throw error;
		}
	}
	/** Planned v2 P1: the session timeline (messages/tool/status rows). */
	async sessionTimeline(targetId, params) {
		return await this.rpc(targetId, "session/timeline", params);
	}
	/** Planned v2 P1: send one user prompt to the server-side agent. */
	async sessionPrompt(targetId, params) {
		return await this.rpc(targetId, "session/prompt", params);
	}
	/** Planned v2 P1: cancel the current turn. */
	async sessionCancel(targetId, params) {
		return await this.rpc(targetId, "session/cancel", params);
	}
	/** Planned v2 P1: allow/deny one pending approval. */
	async sessionApproval(targetId, params) {
		return await this.rpc(targetId, "session/approval", params);
	}
	/** P1: list official slash commands for a server session. */
	async sessionCommands(targetId, params) {
		return await this.rpc(targetId, "session/commands", params);
	}
	/** P1: execute one official slash command in a server session. */
	async sessionCommand(targetId, params) {
		return await this.rpc(targetId, "session/command", params);
	}
	/** P1: routable model catalog for a server session. */
	async sessionModelCatalog(targetId, params) {
		return await this.rpc(targetId, "session/modelCatalog", params);
	}
	/** P1: persist one model selection on a server session. */
	async sessionSelectModel(targetId, params) {
		return await this.rpc(targetId, "session/selectModel", params);
	}
	/** Planned v2 P1: running/approval/status snapshot for one session. */
	async sessionStatus(targetId, params) {
		return await this.rpc(targetId, "session/status", params);
	}
	/**
	* v2 session event stream (SSE). The caller is the host HTTP bridge; it
	* forwards the exact frames and owns reconnect (afterSeq) and keepalive.
	*/
	async *sessionEvents(targetId, params) {
		const plugin = this.pluginFor(targetId);
		if (plugin === void 0) throw Object.assign(/* @__PURE__ */ new Error(`remote target "${targetId}" is not connected`), {
			code: "target-not-connected",
			status: 404
		});
		yield* plugin.sessionEvents(params);
	}
	/** Read the server-authoritative executor mode for one session. */
	async executorModeOf(targetId, sessionId) {
		try {
			const record = await this.rpc(targetId, "executor/get", { sessionId });
			return record?.mode === "local" || record?.mode === "server" ? { mode: record.mode } : {};
		} catch (error) {
			return { error: {
				code: typeof error.code === "string" ? String(error.code) : "executor-get-failed",
				message: error instanceof Error ? error.message : String(error)
			} };
		}
	}
	/**
	* One target's local-mode runtime, created on demand.
	*
	* `ctx` is optional so unit tests can drive the service without a Cordis tree;
	* routes that need local mode without it report `local-runtime-unavailable`.
	*/
	localRuntimeFor(targetId) {
		const cached = this.localRuntimes.get(targetId);
		if (cached !== void 0) return cached;
		const ctx = this.options.ctx;
		const clientId = this.options.store.clientId();
		if (ctx === void 0 || clientId === void 0) return void 0;
		const record = this.options.store.target(targetId);
		const runtime = createHostLocalRuntime({
			ctx,
			clientId,
			targetId,
			...record === void 0 ? {} : { target: {
				label: record.label,
				host: record.host,
				port: record.port,
				username: record.username
			} },
			remotePathForWorkspace: (workspaceId) => this.remotePathForWorkspace(workspaceId),
			rpc: { request: async (method, params, signal) => await this.rpc(targetId, method, params, signal) },
			flush: async () => {
				await ctx.get("sessionPersistence")?.flush?.();
			},
			restartProfile: async () => {
				const preview = await this.restartPreview(targetId);
				await this.restart(targetId, {
					confirmActiveTurns: true,
					previewRevision: preview.previewRevision
				});
			}
		});
		this.localRuntimes.set(targetId, runtime);
		return runtime;
	}
	sessionRename(targetId, sessionId, title) {
		return this.rpc(targetId, "session/rename", {
			sessionId,
			title
		});
	}
	sessionFork(targetId, sessionId, params = {}) {
		return this.rpc(targetId, "session/fork", {
			sessionId,
			...params
		});
	}
	sessionPin(targetId, sessionId, pinned) {
		return this.rpc(targetId, "session/pin", {
			sessionId,
			pinned
		});
	}
	sessionArchive(targetId, sessionId, archived, stopActivity = false) {
		return this.rpc(targetId, "session/archive", {
			sessionId,
			archived,
			...stopActivity ? { stopActivity: true } : {}
		});
	}
	sessionReorder(targetId, workspaceId, sessionId, beforeSessionId) {
		return this.rpc(targetId, "session/reorder", {
			workspaceId,
			sessionId,
			...beforeSessionId === void 0 ? {} : { beforeSessionId }
		});
	}
	sessionPrepareServer(targetId, sessionId) {
		return this.rpc(targetId, "session/prepare-server", { sessionId });
	}
	fsList(targetId, path) {
		return this.rpc(targetId, "fs/list", { path });
	}
	/** Create a directory through the live SSH execution world. */
	async makeDirectory(targetId, path) {
		const live = this.live.get(targetId);
		if (live === void 0) throw Object.assign(/* @__PURE__ */ new Error(`remote target "${targetId}" is not connected`), { code: "target-not-connected" });
		const result = await live.connection.remote.exec(`command mkdir -p ${shellQuote(path)}`, {
			maxBytes: 16384,
			timeoutMs: 3e4
		});
		if (result.code !== 0) throw new Error(`cannot create remote directory "${path}": ${scrubSecrets(result.stderr.trim().slice(-500))}`);
		return { path };
	}
	/** P3 mode preview (D20): all running turns in this profile's process. */
	async modePreview(targetId, _nextMode, targetSessionId) {
		const plugin = this.pluginFor(targetId);
		if (plugin === void 0) throw Object.assign(/* @__PURE__ */ new Error(`remote target "${targetId}" is not connected`), {
			code: "target-not-connected",
			status: 404
		});
		const active = ((await plugin.rpc("profile/status", {})).activeAgents ?? []).filter((agent) => agent.running);
		const current = targetSessionId === void 0 ? void 0 : active.find((agent) => agent.sessionId === targetSessionId);
		const others = active.filter((agent) => agent.sessionId !== current?.sessionId).map((agent) => ({ sessionId: agent.sessionId }));
		return {
			...current === void 0 ? {} : { currentTurn: {
				sessionId: current.sessionId,
				running: true
			} },
			otherActiveTurns: others,
			requiresConfirm: targetSessionId === void 0 ? active.length > 0 : others.length > 0,
			previewRevision: active.length === 0 ? "idle" : active.map((agent) => agent.sessionId).sort().join(",")
		};
	}
	/** P3 mode apply: cancel turns (after D20 confirmation) and persist the setting. */
	async modeApply(targetId, nextMode, options) {
		const preview = await this.modePreview(targetId, nextMode, options.targetSessionId);
		if (nextMode === "local" && options.targetSessionId === void 0) throw Object.assign(/* @__PURE__ */ new Error("switching to local needs targetSessionId (the session the user is looking at)"), {
			code: "mode-switch/target-session-required",
			status: 400,
			details: {
				targetSessionId: null,
				requires: "targetSessionId"
			}
		});
		if (preview.requiresConfirm && !options.cancelActiveTurns) throw Object.assign(/* @__PURE__ */ new Error("switching the executor cancels running turns and requires confirmation"), {
			code: "mode-switch/other-turns-cancelled-required",
			status: 409,
			details: { otherActiveTurns: preview.otherActiveTurns }
		});
		if (preview.previewRevision !== options.previewRevision) throw Object.assign(/* @__PURE__ */ new Error("the active-turn set changed; preview again"), {
			code: "mode-switch/preview-stale",
			status: 409
		});
		const runtime = this.localRuntimeFor(targetId);
		if (runtime === void 0) throw Object.assign(/* @__PURE__ */ new Error("local mode is not available for this target"), {
			code: "local-runtime-unavailable",
			status: 500
		});
		let result;
		try {
			result = await applyModeSwitch({
				executor: runtime.executor,
				local: {
					list: () => runtime.manager.list().map((session) => session.sessionId),
					release: async (sessionId) => {
						await runtime.manager.release(sessionId);
					}
				},
				restartProfile: async () => {
					const restartPreview = await this.restartPreview(targetId);
					await this.restart(targetId, {
						confirmActiveTurns: true,
						previewRevision: restartPreview.previewRevision
					});
				}
			}, {
				nextMode,
				...options.targetSessionId === void 0 ? {} : { targetSessionId: options.targetSessionId },
				confirmOtherTurns: options.cancelActiveTurns,
				previewRevision: options.previewRevision
			});
		} catch (error) {
			throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), {
				code: error.code ?? "mode-switch/cancel-failed",
				status: error.status ?? 409,
				details: error.details
			});
		}
		await this.options.store.updateTarget(targetId, (current) => ({
			...current,
			executor: nextMode
		})).catch(() => void 0);
		return result;
	}
	/** P1 registry reload (loader disable/enable). */
	async registryRefresh(targetId) {
		const plugin = this.pluginFor(targetId);
		if (plugin === void 0) throw new Error(`remote target "${targetId}" is not connected`);
		return await plugin.rpc("registry/refresh", {});
	}
	/** P3 deployment preview: what would auto-install vs require a button. */
	deploymentPreview(targetId) {
		const state = this.deploymentState(targetId);
		if (state === void 0) throw Object.assign(/* @__PURE__ */ new Error(`unknown remote target "${targetId}"`), {
			code: "not-found",
			status: 404
		});
		return state;
	}
	/**
	* P3 deployment apply.
	*
	* Dedicated profile plugin changes and isolated-runtime changes are automatic;
	* a global runtime mutation is refused without `confirm`, and is reported as
	* unsupported when confirmed because v1 has no safe shared-install mutation.
	*/
	async deploymentApply(targetId, request) {
		const state = this.deploymentPreview(targetId);
		if (request.kind === "plugin") {
			if (state.plugin.requiresConfirmation && request.confirm !== true) throw Object.assign(/* @__PURE__ */ new Error("installing the plugin outside the dedicated profile requires confirmation"), {
				code: "plugin-install-confirmation-required",
				status: 409,
				details: state.plugin
			});
			if (state.plugin.requiresConfirmation) throw Object.assign(/* @__PURE__ */ new Error("v1 only manages the per-client dedicated profile; refusing to modify another profile"), {
				code: "plugin-profile-not-managed",
				status: 501,
				details: state.plugin
			});
			const live = this.live.get(targetId);
			if (live === void 0) throw Object.assign(/* @__PURE__ */ new Error(`remote target "${targetId}" is not connected`), {
				code: "target-not-connected",
				status: 404
			});
			const tarball = await this.resolvePluginTarball();
			await installServerPlugin({
				remote: live.connection.remote,
				paths: live.paths,
				tarball,
				dshVersion: state.runtime.expectedVersion
			});
			await this.restart(targetId, {
				confirmActiveTurns: true,
				previewRevision: (await this.restartPreview(targetId)).previewRevision
			});
			return {
				applied: true,
				restarted: true,
				version: tarball.version
			};
		}
		if (state.runtime.kind === "global") {
			if (request.confirm !== true) throw Object.assign(/* @__PURE__ */ new Error("installing/upgrading the server global DSH runtime requires explicit confirmation"), {
				code: "runtime-confirmation-required",
				status: 409,
				details: state.runtime
			});
			throw Object.assign(/* @__PURE__ */ new Error("v1 does not mutate the shared global DSH runtime; install the isolated runtime artifact instead"), {
				code: "runtime-global-unsupported",
				status: 501,
				details: state.runtime
			});
		}
		const record = this.options.store.target(targetId);
		const live = this.live.get(targetId);
		if (record === void 0 || live === void 0) throw Object.assign(/* @__PURE__ */ new Error(`remote target "${targetId}" is not connected`), {
			code: "target-not-connected",
			status: 404
		});
		const platformArch = (record.platformProbe?.tag ?? "").split("-").slice(0, 2).join("-") || "linux-x64";
		const artifactPath = await resolveRuntimeArtifact({
			version: state.runtime.expectedVersion,
			platformArch,
			cacheDir: join(homedir(), ".dsh", "remote-assets"),
			env: process.env
		});
		if (artifactPath === void 0) throw Object.assign(/* @__PURE__ */ new Error(`no isolated runtime artifact for ${state.runtime.expectedVersion} ${platformArch} in the client cache; set DSH_RW_RUNTIME_ARTIFACT or seed the cache`), {
			code: "runtime-missing",
			status: 500,
			details: {
				expectedVersion: state.runtime.expectedVersion,
				platformArch
			}
		});
		const paths = runtimePaths(live.paths.dshHome, live.paths.clientId);
		const content = await readFile(artifactPath);
		const sha256 = await sha256File(artifactPath);
		const info = await stat(artifactPath);
		await installIsolatedRuntime({
			remote: live.connection.remote,
			paths,
			artifact: {
				path: artifactPath,
				name: basename(artifactPath),
				sha256,
				size: info.size,
				version: state.runtime.expectedVersion,
				platformArch
			},
			content
		});
		this.live.set(targetId, {
			...live,
			launcher: paths.launcher,
			pathPrefixes: runtimePathPrefixes(paths),
			runtimeKind: "isolated",
			runtimeDir: paths.root
		});
		const preview = await this.restartPreview(targetId);
		await this.restart(targetId, {
			confirmActiveTurns: true,
			previewRevision: preview.previewRevision
		});
		return {
			applied: true,
			restarted: true,
			version: state.runtime.expectedVersion
		};
	}
	/** Preview the turns a profile restart would cancel (D20). */
	async restartPreview(targetId) {
		const plugin = this.pluginFor(targetId);
		if (plugin === void 0) throw new Error(`remote target "${targetId}" is not connected`);
		const activeTurns = ((await plugin.rpc("profile/status", {})).activeAgents ?? []).filter((agent) => agent.running);
		return {
			activeTurns,
			requiresConfirmation: activeTurns.length > 0,
			previewRevision: `${activeTurns.length}:${activeTurns.map((agent) => agent.sessionId).join(",")}`
		};
	}
	/** Restart the profile server, keeping the SSH connection (cookie/P1 recreated). */
	async restart(targetId, options) {
		const live = this.live.get(targetId);
		if (live === void 0) throw new Error(`remote target "${targetId}" is not connected`);
		const preview = await this.restartPreview(targetId);
		if (preview.requiresConfirmation && !options.confirmActiveTurns) throw Object.assign(/* @__PURE__ */ new Error("restarting cancels running turns and requires confirmation"), {
			code: "profile-restart-preview-failed",
			status: 409
		});
		if (preview.previewRevision !== options.previewRevision) throw Object.assign(/* @__PURE__ */ new Error("the active-turn set changed; preview again"), {
			code: "mode-switch/preview-stale",
			status: 409
		});
		const cancelled = await live.plugin.cancelAll().catch(() => ({ canceled: [] }));
		this.live.delete(targetId);
		this.reconnectClose.get(targetId)?.();
		this.reconnectClose.delete(targetId);
		await this.disposeTargetPreset(targetId);
		await this.closeMux(targetId);
		const local = this.localRuntimes.get(targetId);
		if (local !== void 0) {
			this.localRuntimes.delete(targetId);
			await local.dispose().catch(() => void 0);
		}
		live.disposeUpgrade();
		live.portal.close();
		live.transport.dispose();
		await stopProfileServer(live.connection.remote, live.paths);
		const handle = await startProfileServer(live.connection.remote, live.paths, {
			launcher: live.launcher,
			pathPrefixes: live.pathPrefixes,
			...live.startEnv === void 0 ? {} : { env: live.startEnv },
			probe: async (startup) => await this.probeRoot(live.connection, startup.port, startup.token)
		});
		const cookie = await this.exchangeToken(live.connection, handle.port, handle.token);
		const transport = new TunnelPluginTransport(live.connection.forwarder, handle.port);
		const plugin = new RemotePluginClient({
			transport,
			clientId: await this.options.store.ensureClientId(),
			instanceId: this.instanceId,
			pluginVersion: this.options.pluginVersion,
			cookie
		});
		await plugin.handshake({ profile: live.paths.profile });
		const portal = new PortalProxy(targetId, this.portalUpstream(live.connection, handle.port), cookie);
		const disposeUpgrade = this.options.registerPortalUpgrade?.(targetId, portal) ?? (() => {});
		this.live.set(targetId, {
			...live,
			handle,
			cookie,
			transport,
			plugin,
			portal,
			disposeUpgrade,
			startedAt: (this.options.now?.() ?? /* @__PURE__ */ new Date()).toISOString()
		});
		const record = this.options.store.target(targetId);
		if (record !== void 0) await this.registerTargetPreset(record);
		return {
			restarted: true,
			cancelledTurnIds: cancelled.canceled
		};
	}
	/**
	* Register (or re-register) the remote execution-world preset for a v1 target.
	*
	* The realm's `connection` row resolves `ctx.remoteMux`; without the preset a
	* local-mode `ctx.agents.create/resume` fails with `agent-preset/not-found`
	* even though the profile server and P1 are healthy.
	*/
	async registerTargetPreset(target) {
		const agentPresets = this.options.ctx?.get("agentPresets");
		if (agentPresets?.register === void 0) return;
		const existing = this.presetDisposers.get(target.id);
		if (existing !== void 0) {
			this.presetDisposers.delete(target.id);
			await Promise.resolve(existing()).catch(() => void 0);
		} else {
			const listPresets = agentPresets.list;
			if (listPresets !== void 0) try {
				const listed = await listPresets.call(agentPresets);
				if (Array.isArray(listed) && listed.some((preset) => preset.id === remotePresetId(target.id))) return;
			} catch {}
		}
		const dispose = await agentPresets.register(remotePresetDefinition(target));
		this.presetDisposers.set(target.id, dispose);
	}
	/** Drop one target's preset registration (disconnect/forget). */
	async disposeTargetPreset(targetId) {
		const dispose = this.presetDisposers.get(targetId);
		if (dispose === void 0) return;
		this.presetDisposers.delete(targetId);
		await Promise.resolve(dispose()).catch(() => void 0);
	}
	portalUpstream(connection, port) {
		return {
			host: "127.0.0.1",
			port,
			agent: connection.forwarder.httpAgent({ port }),
			connect: async (signal) => await connection.forwarder.open({ port }, signal)
		};
	}
	async probeRoot(connection, port, token) {
		const deadline = Date.now() + PROFILE_STARTUP_TIMEOUT_MS;
		for (;;) {
			let stream;
			try {
				stream = await connection.forwarder.open({ port });
				const result = await sendForwardedHttp(stream, {
					method: "GET",
					path: `/?token=${encodeURIComponent(token)}`,
					headers: { host: `127.0.0.1:${port}` }
				}, {
					maxBytes: 4096,
					timeoutMs: 5e3
				});
				if (result.status === 303 || result.status === 200) return true;
			} catch {} finally {
				stream?.destroy();
			}
			if (Date.now() >= deadline) return false;
			await new Promise((resolve) => {
				setTimeout(resolve, 250);
			});
		}
	}
	async exchangeToken(connection, port, token) {
		const stream = await connection.forwarder.open({ port });
		try {
			const result = await sendForwardedHttp(stream, {
				method: "GET",
				path: `/?token=${encodeURIComponent(token)}`,
				headers: { host: `127.0.0.1:${port}` }
			}, {
				maxBytes: 8192,
				timeoutMs: 1e4
			});
			if (result.status !== 303 && result.status !== 200) throw new Error(`the profile server token exchange answered HTTP ${result.status}`);
			const setCookie = result.headers["set-cookie"];
			const line = Array.isArray(setCookie) ? setCookie[0] : setCookie;
			if (typeof line !== "string" || line === "") throw new Error("the profile server token exchange returned no cookie");
			return line.split(";")[0] ?? line;
		} finally {
			stream.destroy();
		}
	}
	async scan(remote) {
		const result = await remote.exec(scanDshScript(), {
			maxBytes: 131072,
			timeoutMs: 6e4
		});
		if (result.code !== 0) throw new Error(`the remote dsh scan failed (exit ${result.code ?? "signal"}): ${scrubSecrets(result.stderr.trim().slice(-1e3))}`);
		const scan = parseDshScanOutput(result.stdout);
		if (scan.home === void 0 || scan.home === "") throw new Error("the remote scan did not report a home directory");
		return scan;
	}
	/** The verified global dsh candidate, if the host has one. */
	pickGlobal(scan, request) {
		const override = process.env["DSH_RW_DSH_LAUNCHER"];
		if (override !== void 0 && override !== "") return { path: override };
		const chosen = scan.launchers.filter((candidate) => candidate.version !== "" && isCompatibleDsh(candidate.version))[0];
		return chosen === void 0 ? void 0 : {
			path: chosen.path,
			...chosen.nodePath === void 0 ? {} : { nodePath: chosen.nodePath }
		};
	}
	/**
	* Inspect the runtime and server-plugin markers in the probe step.
	*
	* This is deliberately read-only on the remote: it tells the following steps
	* whether they will deploy, update or skip. The isolated runtime's Node is
	* executed (still read-only) because a marker alone can describe a runtime
	* whose native addons no longer load; a failed check forces a clean redeploy.
	*/
	async inspectRemoteSetup(connection, scan, dshHome, clientId, request, tarball) {
		const expectedDsh = DSH_VERIFIED_RUNTIMES[0] ?? "0.2.1-rc.3";
		const global = request.runtimePolicy === "isolated" || process.env["DSH_RW_FORCE_ISOLATED_RUNTIME"] === "1" ? void 0 : this.pickGlobal(scan, request);
		let runtime;
		if (global !== void 0) {
			const node = global.nodePath === void 0 ? void 0 : scan.nodes.find((candidate) => candidate.path === global.nodePath);
			runtime = {
				kind: "global",
				action: "reuse",
				version: expectedDsh,
				...node?.version === void 0 || node.version === "" ? {} : { nodeVersion: node.version },
				detail: `复用 server 全局 DSH ${expectedDsh}${node?.version === void 0 || node.version === "" ? "" : `（Node ${node.version}）`}`
			};
		} else {
			const paths = runtimePaths(dshHome, clientId);
			const marker = await readRuntimeMarker(connection.remote, paths);
			const plan = planRuntime({
				kind: "isolated",
				expectedVersion: expectedDsh,
				marker
			});
			let action = plan.action;
			let nodeVersion;
			let runtimeUnhealthy = false;
			if (plan.action === "reuse") {
				const probe = await this.probeRuntimeHealth(connection.remote, paths);
				if (probe.ok) nodeVersion = probe.version;
				else {
					runtimeUnhealthy = true;
					action = marker === void 0 ? "install" : "upgrade";
				}
			}
			const installedVersion = marker?.version;
			runtime = {
				kind: "isolated",
				action,
				version: expectedDsh,
				...installedVersion === void 0 ? {} : { installedVersion },
				...nodeVersion === void 0 ? {} : { nodeVersion },
				detail: action === "reuse" ? `复用隔离运行时 ${expectedDsh}${nodeVersion === void 0 ? "" : `（Node ${nodeVersion}）`}` : action === "install" ? `部署隔离运行时 ${expectedDsh}（含 Node）` : runtimeUnhealthy ? `修复隔离运行时 ${installedVersion ?? expectedDsh}（原生模块健康检查失败）` : `更新隔离运行时 ${installedVersion ?? "旧版本"} → ${expectedDsh}`
			};
		}
		const paths = profilePaths(dshHome, clientId);
		const pluginMarker = await readServerPluginMarker(connection.remote, paths);
		const pluginAction = decideServerPluginInstall(pluginMarker, {
			version: tarball.version,
			sha256: tarball.sha256,
			protocol: 1,
			dshVersion: expectedDsh
		}) === "skip" ? "reuse" : pluginMarker === void 0 ? "install" : "upgrade";
		const installedPlugin = pluginMarker?.version;
		const plugin = {
			action: pluginAction,
			version: tarball.version,
			...installedPlugin === void 0 ? {} : { installedVersion: installedPlugin },
			detail: pluginAction === "reuse" ? `复用 server 插件 ${tarball.version}` : pluginAction === "install" ? `安装 server 插件 ${tarball.version}` : `更新 server 插件 ${installedPlugin ?? "旧版本"} → ${tarball.version}`
		};
		const actionLabel = {
			reuse: "跳过",
			install: "部署",
			upgrade: "更新"
		};
		return {
			runtime,
			plugin,
			summary: `运行时 ${actionLabel[runtime.action]}（${runtime.detail}）；server 插件 ${actionLabel[plugin.action]}（${plugin.detail}）`
		};
	}
	/**
	* Prove the isolated runtime can actually run: Node prints a version and the
	* dsh launcher answers through the runtime's own PATH. A marker alone is not
	* enough — it can describe a runtime whose files were removed or corrupted.
	*/
	async probeRuntimeHealth(remote, paths) {
		try {
			const node = await remote.exec(`${shellQuote(paths.nodeBin)} -v`, {
				maxBytes: 4096,
				timeoutMs: 1e4
			});
			const version = (node.stdout ?? "").trim().split("\n")[0] ?? "";
			if (node.code !== 0 || !/^v\d+\./u.test(version)) return { ok: false };
			if ((await remote.exec(`DSH_HOME=${shellQuote(paths.dshHome)} ${runtimePathAssignment(paths)} ${shellQuote(paths.launcher)} --version`, {
				maxBytes: 4096,
				timeoutMs: 2e4
			})).code !== 0) return {
				ok: false,
				version
			};
			return {
				ok: (await remote.exec(runtimeAddonProbeCommand(paths), {
					maxBytes: 4096,
					timeoutMs: 2e4
				})).code === 0,
				version
			};
		} catch {
			return { ok: false };
		}
	}
	/**
	* Pick the runtime before the profile install: a verified global dsh if the
	* host has one, otherwise the per-client isolated runtime (auto install or
	* upgrade from the injected artifact). Failing to find either is a coded
	* `runtime-missing`; the connect never silently falls back to a local world.
	*/
	async resolveRuntime(connection, scan, dshHome, clientId, request, onRuntimeProgress) {
		const expectedDsh = DSH_VERIFIED_RUNTIMES[0] ?? "0.2.1-rc.3";
		const global = request.runtimePolicy === "isolated" || process.env["DSH_RW_FORCE_ISOLATED_RUNTIME"] === "1" ? void 0 : this.pickGlobal(scan, request);
		if (global !== void 0) {
			const prefixes = [];
			if (global.nodePath !== void 0) prefixes.push(dirname(global.nodePath));
			if (global.path.includes("/")) prefixes.push(dirname(global.path));
			return {
				kind: "global",
				action: "reuse",
				launcher: global.path,
				pathPrefixes: prefixes,
				dshVersion: expectedDsh,
				runtimeDir: ""
			};
		}
		const paths = runtimePaths(dshHome, clientId);
		const marker = await readRuntimeMarker(connection.remote, paths);
		if (planRuntime({
			kind: "isolated",
			expectedVersion: expectedDsh,
			marker
		}).action === "reuse") {
			if ((await this.probeRuntimeHealth(connection.remote, paths)).ok) return {
				kind: "isolated",
				action: "reuse",
				launcher: paths.launcher,
				pathPrefixes: runtimePathPrefixes(paths),
				dshVersion: expectedDsh,
				runtimeDir: paths.root
			};
			onRuntimeProgress?.("隔离 runtime 不可用，正在重新部署…");
		}
		const action = marker === void 0 ? "install" : "upgrade";
		const facts0 = probeFactsFrom({
			uname: scan.platform ?? "",
			machine: scan.machine ?? "",
			ostype: scan.ostype ?? "",
			ldd: scan.ldd ?? ""
		});
		const archKey0 = `${facts0.platform}-${facts0.arch}`;
		let artifactPath = await resolveRuntimeArtifact({
			version: expectedDsh,
			platformArch: archKey0,
			cacheDir: join(homedir(), ".dsh", "remote-assets"),
			env: process.env
		});
		if (artifactPath === void 0) try {
			artifactPath = (await buildRuntimeArtifact({
				version: expectedDsh,
				platform: facts0.platform,
				arch: facts0.arch,
				onProgress: onRuntimeProgress
			})).path;
		} catch (error) {
			throw new RuntimeError("runtime-missing", `the server has no verified dsh ${expectedDsh} and the isolated runtime artifact could not be built: ${error instanceof Error ? error.message : String(error)}`);
		}
		const content = await readFile(artifactPath);
		const info = await stat(artifactPath);
		const sha256 = await sha256File(artifactPath);
		const artifact = {
			path: artifactPath,
			name: basename(artifactPath) === "" ? runtimeArtifactName(expectedDsh, archKey0) : basename(artifactPath),
			sha256,
			size: info.size,
			version: expectedDsh,
			platformArch: archKey0
		};
		await installIsolatedRuntime({
			remote: connection.remote,
			paths,
			artifact,
			content
		});
		if (!(await this.probeRuntimeHealth(connection.remote, paths)).ok) throw new RuntimeError("runtime-install-failed", `the isolated runtime for ${clientId} was installed but failed its Node/native-addon health check; the profile server would exit before its startup line`);
		return {
			kind: "isolated",
			action,
			launcher: paths.launcher,
			pathPrefixes: runtimePathPrefixes(paths),
			dshVersion: expectedDsh,
			runtimeDir: paths.root
		};
	}
	/**
	* Locate one of this plugin's own installed packages (peer fallback).
	*
	* `createRequire(import.meta.url)` resolves from the installed client plugin,
	* which is the same profile that provides the peer to this host. A package
	* whose `exports` hides `package.json` is found through its entry file and a
	* walk up to the manifest.
	*/
	resolvePeerPackage(name) {
		const override = process.env["DSH_RW_PEER_SCHEMASTERY"];
		if (name === "@deepseek-ai/schemastery" && override !== void 0 && override !== "") return override;
		let resolved;
		try {
			resolved = createRequire(import.meta.url).resolve(`${name}/package.json`);
		} catch {
			try {
				resolved = createRequire(import.meta.url).resolve(name);
			} catch {
				return;
			}
		}
		let directory = dirname(resolved);
		for (let depth = 0; depth < 8; depth++) {
			let manifest;
			try {
				manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
			} catch {
				manifest = {};
			}
			if (manifest.name === name) return directory;
			const parent = dirname(directory);
			if (parent === directory) break;
			directory = parent;
		}
	}
	async resolvePluginTarball() {
		const override = process.env["DSH_RW_SERVER_PLUGIN_TARBALL"];
		if (override !== void 0 && override !== "") return await verifyServerPluginTarball(override, this.options.pluginVersion);
		return await resolveServerPluginTarball({
			packageRoot: this.options.packageRoot,
			version: this.options.pluginVersion,
			cacheDir: this.options.cacheDir,
			downloader: { download: async () => {
				throw new Error("the server plugin tarball is not bundled in this build");
			} }
		});
	}
	async persistTarget(request, hints) {
		const existing = this.options.store.listTargets().find((target) => target.label.toLowerCase() === request.label.toLowerCase());
		const now = (this.options.now?.() ?? /* @__PURE__ */ new Date()).toISOString();
		let record = {
			id: existing?.id ?? hints.targetId,
			label: request.label,
			kind: "ssh",
			host: request.host,
			port: request.port,
			username: request.username,
			authKind: request.authKind,
			...request.privateKeyPath === void 0 ? {} : { privateKeyPath: request.privateKeyPath },
			hostKeyFingerprint: request.hostKeyFingerprint ?? existing?.hostKeyFingerprint ?? "",
			clientId: hints.clientId,
			executor: existing?.executor ?? "local",
			modelSource: hints.modelSource,
			profileName: hints.profileName,
			profilePort: hints.profilePort,
			runtimeKind: hints.runtimeKind,
			...hints.runtimeDir === "" ? {} : { runtimeDir: hints.runtimeDir },
			pluginVersion: hints.pluginVersion,
			serverDshVersion: hints.serverDshVersion,
			remote: {
				nodePath: "node",
				dshCommand: hints.launcher,
				profile: hints.profileName,
				dshHome: hints.dshHome,
				plugins: []
			},
			status: "ready",
			lastConnectedAt: now,
			createdAt: existing?.createdAt ?? now
		};
		if (request.secret !== void 0 && request.secret !== "") record = await this.options.store.storeSecret(record, request.secret);
		await this.options.store.putTarget(record);
		return {
			id: record.id,
			label: record.label,
			kind: record.kind,
			host: record.host,
			port: record.port,
			username: record.username,
			authKind: record.authKind,
			hasStoredSecret: record.credentialKey !== void 0,
			hostKeyFingerprint: record.hostKeyFingerprint,
			clientId: hints.clientId,
			executor: record.executor,
			modelSource: hints.modelSource,
			profileName: record.profileName,
			profilePort: record.profilePort,
			runtimeKind: record.runtimeKind,
			runtimeDir: record.runtimeDir,
			pluginVersion: record.pluginVersion,
			serverDshVersion: record.serverDshVersion,
			remote: record.remote,
			status: record.status,
			...record.lastConnectedAt === void 0 ? {} : { lastConnectedAt: record.lastConnectedAt }
		};
	}
};
//#endregion
//#region src/remote/mux-client.ts
/**
* Execution-world mux client seam (protocol §16.9).
*
* The server plugin exposes one WebSocket per target
* (`/dsh-remote-workspace-server/api/mux`); the bytes inside it are the existing
* `FrameMux` frames (one WS message = one complete frame, §7). This module is the
* **client-facing seam** dev-session adapts `src/connection/index.ts` to:
*
* - `request(targetId, endpoint, payload)` is one mux RPC (fs/subprocess/sandbox/…);
* - `openStream(targetId, endpoint, payload)` is one stream-oriented endpoint;
* - `close(targetId)` disposes that target's WS/FrameMux.
*
* The wire implementation lives in the transport/backend injected here: Phase A
* keeps this file free of SSH/WS details so dev-session can depend on the
* structural interface now (and use an in-memory backend in tests) while the
* service wiring lands. One target maps to exactly one backend instance, which
* is what enforces "one WS/FrameMux per target".
*/
/** A coded mux failure the realm can map to its fail-closed state. */
var RemoteMuxError = class extends Error {
	code;
	cause;
	details;
	constructor(code, message, cause, details) {
		super(scrubSecrets(message));
		this.code = code;
		this.cause = cause;
		this.details = details;
		this.name = "RemoteMuxError";
	}
};
/**
* Routes the seam's calls to the per-target backend.
*
* Absent backend = target not connected (or its realm is disposed), which is a
* hard `mux-unavailable`: the realm must fail closed and never fall back to the
* client's local execution world.
*/
var RemoteMuxRouter = class {
	backends;
	closed = /* @__PURE__ */ new Set();
	constructor(backends) {
		this.backends = backends;
	}
	/** Ask for a backend, translating absence into a coded failure. */
	backendFor(targetId) {
		if (this.closed.has(targetId)) throw new RemoteMuxError("mux-disposed", `remote target "${targetId}" is closed`);
		const backend = this.backends.get(targetId);
		if (backend === void 0) throw new RemoteMuxError("mux-unavailable", `remote target "${targetId}" is not connected`);
		return backend;
	}
	async request(targetId, endpoint, payload, signal) {
		const backend = this.backendFor(targetId);
		try {
			return await backend.request(endpoint, payload, signal);
		} catch (error) {
			if (error instanceof RemoteMuxError) throw error;
			throw new RemoteMuxError("mux-request-failed", `remote mux request "${endpoint}" failed on "${targetId}": ${error instanceof Error ? error.message : String(error)}`, error, error.details);
		}
	}
	async openStream(targetId, endpoint, payload) {
		const backend = this.backendFor(targetId);
		try {
			return await backend.openStream(endpoint, payload);
		} catch (error) {
			if (error instanceof RemoteMuxError) throw error;
			throw new RemoteMuxError("mux-request-failed", `remote mux stream "${endpoint}" failed on "${targetId}": ${error instanceof Error ? error.message : String(error)}`, error, error.details);
		}
	}
	/** Close one target's backend and remember it as disposed (idempotent). */
	async close(targetId) {
		if (this.closed.has(targetId)) return;
		this.closed.add(targetId);
		await this.backends.get(targetId)?.close().catch(() => void 0);
	}
};
//#endregion
//#region src/local-llm/routes.ts
function requireString$1(body, field) {
	const value = body[field];
	if (typeof value !== "string" || value.trim() === "") throw new LocalLlmError("local-llm-bad-settings", `"${field}" is required`);
	return value;
}
function optionalString$1(body, field) {
	const value = body[field];
	if (value === void 0 || value === null) return void 0;
	if (typeof value !== "string") throw new LocalLlmError("local-llm-bad-settings", `"${field}" must be a string`);
	return value;
}
function optionalStringArray(body, field) {
	const value = body[field];
	if (value === void 0 || value === null) return void 0;
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new LocalLlmError("local-llm-bad-settings", `"${field}" must be an array of strings`);
	return value;
}
function optionalInteger(body, field) {
	const value = body[field];
	if (value === void 0 || value === null) return void 0;
	if (typeof value !== "number" || !Number.isInteger(value)) throw new LocalLlmError("local-llm-bad-settings", `"${field}" must be an integer`);
	return value;
}
/** Parse the optional `mode` field (`auto` | `manual`). */
function optionalMode(body) {
	const value = body.mode;
	if (value === void 0 || value === null) return void 0;
	if (value !== "auto" && value !== "manual") throw new LocalLlmError("local-llm-bad-settings", "\"mode\" must be auto|manual");
	return value;
}
/**
* Parse the optional `modelSource` connect field.
* @param body - the `v1/connect` body.
* @returns the validated source, or undefined when the caller omitted it.
*/
function parseModelSource(body) {
	const value = body.modelSource;
	if (value === void 0 || value === null) return void 0;
	if (value !== "local" && value !== "server") throw new LocalLlmError("local-llm-bad-settings", "\"modelSource\" must be local|server");
	return value;
}
/**
* Dispatch one `local-llm/*` method.
* @param store - opened target store.
* @param method - `local-llm/read|save|probe|clear-key`.
* @param body - the already-parsed JSON body.
* @param llm - the client host's model runtime (auto mode discovery); may be
*   resolved lazily because the service can appear after plugin apply.
* @returns the method's value, or undefined when the method is not ours.
*/
async function dispatchLocalLlmApi(store, method, body, resolveLlm) {
	const llm = resolveLlm?.();
	switch (method) {
		case "local-llm/read": return await readLocalLlmState(store, optionalString$1(body, "targetId"), llm);
		case "local-llm/save": {
			const baseUrl = optionalString$1(body, "baseUrl");
			const mode = optionalMode(body) ?? (baseUrl !== void 0 && baseUrl.trim() !== "" ? "manual" : void 0);
			if (mode === void 0) throw new LocalLlmError("local-llm-bad-settings", "\"mode\" or \"baseUrl\" is required");
			const models = optionalStringArray(body, "models");
			const timeoutMs = optionalInteger(body, "timeoutMs");
			const apiKey = optionalString$1(body, "apiKey");
			return await saveLocalLlmState(store, {
				...mode === void 0 ? {} : { mode },
				...baseUrl === void 0 ? {} : { baseUrl },
				...models === void 0 ? {} : { models },
				...timeoutMs === void 0 ? {} : { timeoutMs },
				...apiKey === void 0 ? {} : { apiKey }
			}, llm);
		}
		case "local-llm/probe": {
			const baseUrl = requireString$1(body, "baseUrl");
			const timeoutMs = optionalInteger(body, "timeoutMs");
			const apiKey = optionalString$1(body, "apiKey") ?? await store.localLlmKey();
			return { models: await probeLocalModels({
				baseUrl,
				...apiKey === void 0 ? {} : { apiKey },
				...timeoutMs === void 0 ? {} : { timeoutMs }
			}) };
		}
		case "local-llm/discover": {
			const runtime = resolveLlm?.();
			if (runtime === void 0) throw new LocalLlmError("local-llm-unavailable", "the client host does not expose its model runtime; the automatic local model source is unavailable in this installation");
			try {
				return { providers: (await discoverLocalCatalog(runtime)).providers };
			} catch (error) {
				if (error instanceof LocalCatalogError) throw new LocalLlmError("local-llm-providers-unavailable", error.message);
				throw new LocalLlmError("local-llm-providers-unavailable", `the client host could not list its models: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		case "local-llm/clear-key": return await clearLocalLlmKey(store);
		default: return;
	}
}
//#endregion
//#region src/index.ts
/**
* `dsh-remote-workspace` host row (v1).
*
* It owns the target store, the per-client profile/runtime lifecycle, the P1
* client/portal and the browser-facing API. The browser UI lives in `./client`;
* the realm is mounted per target by `preset/world.ts`.
*/
/** Route prefix for the plugin's own API and SSE channel. */
const ROUTE_PREFIX = "/dsh-remote-workspace";
/** Plugin row name. */
const name = "dsh-remote-workspace";
/** Host-plane services this row needs before it can register anything. */
const inject = [
	"agentPresets",
	"storageDomain",
	"credentials",
	"agents",
	"webServer"
];
/** Validated configuration. */
const Config = Schema.object({
	serverProfile: Schema.string().default("dsh-remote-server").description("Legacy remote profile name; v1 uses per-client profiles."),
	leaseMs: Schema.number().default(3e4).description("Legacy remote server lease in milliseconds."),
	maxProcesses: Schema.number().default(128).description("Legacy maximum remote process handles."),
	restoreTargets: Schema.boolean().default(true).description("Legacy startup preset registration flag.")
});
/** JSON request body, bounded like every other plugin route in this app. */
const MAX_BODY_BYTES = 1 << 20;
/** Per-attempt connect progress, polled by the wizard (bounded; ephemeral). */
const CONNECT_PROGRESS = /* @__PURE__ */ new Map();
/** Error codes the browser distinguishes; everything unmapped stays 500. */
const STATUS_BY_CODE = {
	"bad-request": 400,
	"not-found": 404,
	"unsupported": 400,
	"forbidden": 403,
	"ssh-auth-failed": 401
};
/** A coded route failure whose status and details reach the browser. */
var RouteError = class extends Error {
	code;
	status;
	details;
	constructor(code, message, status = 500, details) {
		super(message);
		this.code = code;
		this.status = status;
		this.details = details;
		this.name = "RouteError";
	}
};
function writeJson(res, status, body) {
	const text = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(text);
}
async function readJsonBody(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buffer.length;
		if (total > MAX_BODY_BYTES) throw new RouteError("bad-request", "request body too large", 400);
		chunks.push(buffer);
	}
	if (total === 0) return {};
	let parsed;
	try {
		parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new RouteError("bad-request", "request body is not valid JSON", 400);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new RouteError("bad-request", "request body must be a JSON object", 400);
	return parsed;
}
function requireString(body, field) {
	const value = body[field];
	if (typeof value !== "string" || value.trim() === "") throw new RouteError("bad-request", `"${field}" is required`, 400);
	return value;
}
function optionalString(body, field) {
	const value = body[field];
	if (value === void 0 || value === null) return void 0;
	if (typeof value !== "string") throw new RouteError("bad-request", `"${field}" must be a string`, 400);
	return value;
}
function trustedRequest(ctx, req) {
	const host = req.headers.host;
	if (typeof host !== "string" || host === "") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	const trustedHosts = ctx.get("webRuntime")?.trustedHosts ?? [];
	const hostname = hostUrl.hostname;
	if (!(hostname === "localhost" || hostname === "[::1]" || hostname === "::1" || /^127\./.test(hostname) || trustedHosts.some((entry) => entry === host || entry === hostname))) return false;
	if (req.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = req.headers.origin;
	if (typeof origin === "string" && origin !== "" && origin !== "null") try {
		if (new URL(origin).host !== hostUrl.host) return false;
	} catch {
		return false;
	}
	return true;
}
function pluginVersion() {
	if (cachedPluginVersion === "") {
		const here = fileURLToPath(new URL(".", import.meta.url));
		for (const candidate of [join(here, "..", "package.json"), join(here, "package.json")]) try {
			cachedPluginVersion = JSON.parse(readFileSync(candidate, "utf8")).version ?? "";
			if (cachedPluginVersion !== "") break;
		} catch {}
	}
	return cachedPluginVersion;
}
/** Absolute local plugin package root, derived from this module's location. */
function packageRootFrom(moduleUrl) {
	return join(fileURLToPath(new URL("..", moduleUrl)));
}
/** Serve one vendored official UI bundle (static, no secrets). */
function serveOfficialUi(req, res, file = "conversation-client.js") {
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.statusCode = 405;
		res.end();
		return;
	}
	try {
		const body = readFileSync(join(packageRootFrom(import.meta.url), "assets/official-ui", file));
		res.statusCode = 200;
		res.setHeader("content-type", "text/javascript; charset=utf-8");
		res.setHeader("cache-control", "no-cache");
		res.setHeader("x-content-type-options", "nosniff");
		if (req.method === "HEAD") {
			res.end();
			return;
		}
		res.end(body);
	} catch (error) {
		res.statusCode = 500;
		res.setHeader("content-type", "text/plain; charset=utf-8");
		res.end(`official ui bundle unavailable: ${error instanceof Error ? error.message : String(error)}`);
	}
}
/** Register the plugin's routes and return a disposer. */
function registerRoutes(ctx, profiles) {
	const disposers = [];
	disposers.push(ctx.webServer.register({
		kind: "prefix",
		path: `${ROUTE_PREFIX}/api`,
		handler: (req, res) => {
			handleApi(ctx, profiles, req, res);
		}
	}));
	disposers.push(ctx.webServer.register({
		kind: "exact",
		path: `${ROUTE_PREFIX}/official-ui.js`,
		handler: (req, res) => {
			serveOfficialUi(req, res);
		}
	}));
	disposers.push(ctx.webServer.register({
		kind: "exact",
		path: `${ROUTE_PREFIX}/official-ui-chat.js`,
		handler: (req, res) => {
			serveOfficialUi(req, res, "chat-client.js");
		}
	}));
	disposers.push(ctx.webServer.register({
		kind: "exact",
		path: `${ROUTE_PREFIX}/official-ui-approval.js`,
		handler: (req, res) => {
			serveOfficialUi(req, res, "approval-client.js");
		}
	}));
	disposers.push(ctx.webServer.register({
		kind: "exact",
		path: `${ROUTE_PREFIX}/official-ui-model.js`,
		handler: (req, res) => {
			serveOfficialUi(req, res, "model-client.js");
		}
	}));
	disposers.push(ctx.webServer.register({
		kind: "exact",
		path: `${ROUTE_PREFIX}/official-ui-tool.js`,
		handler: (req, res) => {
			serveOfficialUi(req, res, "tool-client.js");
		}
	}));
	disposers.push(ctx.webServer.register({
		kind: "exact",
		path: `${ROUTE_PREFIX}/official-ui-trajectory.js`,
		handler: (req, res) => {
			serveOfficialUi(req, res, "trajectory-client.js");
		}
	}));
	disposers.push(ctx.webServer.register({
		kind: "exact",
		path: `${ROUTE_PREFIX}/api/session/events`,
		handler: (req, res) => {
			handleSessionEvents(ctx, profiles, req, res);
		}
	}));
	disposers.push(ctx.webServer.register({
		kind: "prefix",
		path: `${ROUTE_PREFIX}/portal`,
		handler: (req, res) => {
			handlePortal(ctx, profiles, req, res);
		}
	}));
	return () => {
		for (const dispose of disposers.reverse()) dispose();
	};
}
/** Extract the first targetId segment of a portal URL, when it is one. */
function portalTargetId(url) {
	const path = new URL(url ?? "/", "http://dsh.internal").pathname;
	const base = `${ROUTE_PREFIX}/portal/`;
	if (!path.startsWith(base)) return void 0;
	const segment = path.slice(base.length).split("/")[0];
	return segment === void 0 || segment === "" ? void 0 : decodeURIComponent(segment);
}
/** Answer one portal HTTP request (unmounted targets are a coded 404). */
async function handlePortal(ctx, profiles, req, res) {
	try {
		if (!trustedRequest(ctx, req)) throw new RouteError("forbidden", "forbidden", 403);
		const targetId = portalTargetId(req.url);
		const proxy = targetId === void 0 ? void 0 : profiles.portalFor(targetId);
		if (proxy === void 0) throw new RouteError("target-not-connected", `remote target ${JSON.stringify(targetId ?? "")} is not connected`, 404);
		await proxy.handleRequest(req, res);
	} catch (error) {
		if (error instanceof RouteError) {
			writeJson(res, error.status, {
				ok: false,
				error: {
					code: error.code,
					message: scrubSecrets(error.message),
					...error.details === void 0 ? {} : { details: error.details }
				}
			});
			return;
		}
		writeJson(res, 500, {
			ok: false,
			error: {
				code: "internal",
				message: scrubSecrets(error instanceof Error ? error.message : String(error))
			}
		});
	}
}
/** Query parameters of the v2 session-event SSE route. */
function sessionEventsQuery(url) {
	const query = new URL(url ?? "/", "http://dsh.internal").searchParams;
	const targetId = query.get("targetId") ?? "";
	const sessionId = query.get("sessionId") ?? "";
	if (targetId === "") throw new RouteError("bad-request", "\"targetId\" is required", 400);
	if (sessionId === "") throw new RouteError("bad-request", "\"sessionId\" is required", 400);
	const rawAfter = query.get("afterSeq");
	let afterSeq;
	if (rawAfter !== null && rawAfter !== "") {
		const parsed = Number(rawAfter);
		if (!Number.isInteger(parsed) || parsed < -1) throw new RouteError("bad-request", "\"afterSeq\" must be -1 or a non-negative integer", 400);
		afterSeq = parsed;
	}
	return {
		targetId,
		sessionId,
		...afterSeq === void 0 ? {} : { afterSeq }
	};
}
/** Official approval decisions accepted by `session/approval`. */
const APPROVAL_DECISIONS = [
	"allowed-once",
	"rejected",
	"cancelled",
	"allow",
	"deny"
];
/** Validate one approval decision (allow/deny are UI aliases). */
function approvalDecision(value) {
	if (typeof value !== "string" || !APPROVAL_DECISIONS.includes(value)) throw new RouteError("bad-request", `"decision" must be one of ${APPROVAL_DECISIONS.join("|")}`, 400);
	return value;
}
/** Long-lived same-origin SSE bridge for one v2 server session. */
async function handleSessionEvents(ctx, profiles, req, res) {
	try {
		if (!trustedRequest(ctx, req)) throw new RouteError("forbidden", "forbidden", 403);
		if (req.method !== "GET") throw new RouteError("method-error", "only GET is allowed", 405);
		const query = sessionEventsQuery(req.url);
		const state = profiles.connectionState(query.targetId);
		if (state === void 0 || state.phase !== "ready") throw new RouteError("target-not-connected", `remote target ${JSON.stringify(query.targetId)} is not connected`, 404);
		const controller = new AbortController();
		const abort = () => {
			if (!controller.signal.aborted) controller.abort(/* @__PURE__ */ new Error("SSE client disconnected"));
		};
		req.on("aborted", abort);
		res.on("close", abort);
		res.writeHead(200, {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-store, must-revalidate",
			connection: "keep-alive",
			"x-accel-buffering": "no"
		});
		res.flushHeaders?.();
		res.write(": connected\n\n");
		const keepalive = setInterval(() => {
			if (!res.writableEnded && !res.destroyed) res.write(": keepalive\n\n");
		}, 15e3);
		keepalive.unref?.();
		try {
			for await (const event of profiles.sessionEvents(query.targetId, {
				sessionId: query.sessionId,
				...query.afterSeq === void 0 ? {} : { afterSeq: query.afterSeq },
				signal: controller.signal
			})) {
				if (res.writableEnded || res.destroyed) break;
				const frame = `event: ${event.event === "" ? "message" : event.event.replace(/[\r\n]/gu, "")}\n${event.data.split("\n").map((line) => `data: ${line}`).join("\n")}\n\n`;
				if (!res.write(frame)) await Promise.race([once(res, "drain").then(() => void 0).catch(() => void 0), new Promise((resolve) => controller.signal.addEventListener("abort", () => resolve(), { once: true }))]);
			}
		} catch (error) {
			if (!controller.signal.aborted) {
				const message = scrubSecrets(error instanceof Error ? error.message : String(error));
				const code = typeof error.code === "string" ? String(error.code) : "session-events-failed";
				if (!res.writableEnded && !res.destroyed) res.write(`event: error\ndata: ${JSON.stringify({
					code,
					message
				})}\n\n`);
			}
		} finally {
			clearInterval(keepalive);
			if (!res.writableEnded) res.end();
		}
	} catch (error) {
		if (res.headersSent) {
			if (!res.writableEnded) res.end();
			return;
		}
		if (error instanceof RouteError) {
			writeJson(res, error.status, {
				ok: false,
				error: {
					code: error.code,
					message: scrubSecrets(error.message),
					...error.details === void 0 ? {} : { details: error.details }
				}
			});
			return;
		}
		writeJson(res, 500, {
			ok: false,
			error: {
				code: "internal",
				message: scrubSecrets(error instanceof Error ? error.message : String(error))
			}
		});
	}
}
async function handleApi(ctx, profiles, req, res) {
	try {
		if (!trustedRequest(ctx, req)) throw new RouteError("forbidden", "forbidden", 403);
		if (req.method !== "POST") throw new RouteError("method-error", "only POST is allowed", 405);
		writeJson(res, 200, {
			ok: true,
			value: await dispatchApi(ctx, profiles, new URL(req.url ?? "/", "http://dsh.internal").pathname.slice(`${ROUTE_PREFIX}/api/`.length), await readJsonBody(req))
		});
	} catch (error) {
		if (error instanceof RouteError) {
			writeJson(res, error.status, {
				ok: false,
				error: {
					code: error.code,
					message: scrubSecrets(error.message),
					...error.details === void 0 ? {} : { details: error.details }
				}
			});
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		const code = error.code;
		const explicitStatus = error.status;
		writeJson(res, (typeof explicitStatus === "number" ? explicitStatus : typeof code === "string" ? STATUS_BY_CODE[code] : void 0) ?? 500, {
			ok: false,
			error: {
				code: typeof code === "string" ? code : "internal",
				message: scrubSecrets(message),
				...error.details === void 0 ? {} : { details: error.details }
			}
		});
	}
}
/** One P3 call; every branch is a v1 host API over ProfileService/P1. */
async function dispatchApi(ctx, profiles, method, body) {
	switch (method) {
		case "ssh-aliases": {
			const { aliases, warnings } = await listSshAliases();
			return {
				aliases: aliases.map((alias) => ({
					alias: alias.alias,
					...alias.hostName === void 0 ? {} : { hostName: alias.hostName },
					...alias.port === void 0 ? {} : { port: alias.port },
					...alias.user === void 0 ? {} : { user: alias.user },
					...alias.identityFile === void 0 ? {} : { identityFile: alias.identityFile },
					source: alias.source
				})),
				warnings
			};
		}
		case "state": {
			if (storageFailure !== "") throw new RouteError("storage-unavailable", `plugin storage failed to open: ${storageFailure}`, 500);
			const clientId = await store.ensureClientId();
			const connections = profiles.connections();
			const v1Workspaces = {};
			const v1Sessions = {};
			for (const [targetId, state] of Object.entries(connections)) {
				if (state.phase !== "ready") continue;
				try {
					const [workspacesValue, sessionsValue] = await Promise.race([Promise.all([profiles.workspaceList(targetId), profiles.sessionList(targetId)]), new Promise((_resolve, reject) => {
						setTimeout(() => reject(/* @__PURE__ */ new Error("P1 state read timed out")), 3e3).unref?.();
					})]);
					v1Workspaces[targetId] = workspacesValue;
					v1Sessions[targetId] = sessionsValue;
					const registry = workspacesValue.registry;
					const previous = connections[targetId];
					if (previous !== void 0 && typeof registry?.revision === "string" && registry.revision !== "") connections[targetId] = {
						...previous,
						registry: {
							revision: registry.revision,
							...typeof registry.epoch === "string" ? { epoch: registry.epoch } : {},
							stale: false
						}
					};
				} catch (error) {
					const message = scrubSecrets(error instanceof Error ? error.message : String(error));
					v1Workspaces[targetId] = { error: {
						code: "p1-read-failed",
						message
					} };
					const previous = connections[targetId];
					if (previous !== void 0) connections[targetId] = {
						...previous,
						phase: "degraded",
						error: {
							code: "p1-read-failed",
							message
						}
					};
				}
			}
			return {
				clientId,
				protocol: 1,
				portalBase: PORTAL_BASE,
				connections,
				workspaces: v1Workspaces,
				sessions: v1Sessions,
				targets: store.listTargets().map(toPublicTarget),
				pluginVersion: pluginVersion(),
				verifiedRuntimes: [...DSH_VERIFIED_RUNTIMES],
				platform: process.platform
			};
		}
		case "v1/connect": {
			if ((optionalString(body, "kind") ?? "ssh") !== "ssh") throw new RouteError("unsupported", "v1 connections are SSH-only", 400);
			const requestedModelSource = parseModelSource(body);
			const targetId = optionalString(body, "targetId");
			const attemptId = optionalString(body, "attemptId");
			if (attemptId !== void 0) {
				if (CONNECT_PROGRESS.size >= 32) {
					const oldest = CONNECT_PROGRESS.keys().next().value;
					if (oldest !== void 0) CONNECT_PROGRESS.delete(oldest);
				}
				CONNECT_PROGRESS.set(attemptId, []);
			}
			const reportProgress = attemptId === void 0 ? void 0 : (event) => {
				const events = CONNECT_PROGRESS.get(attemptId);
				if (events === void 0) return;
				events.push(event);
				if (events.length > 300) events.splice(0, events.length - 300);
			};
			const saved = targetId === void 0 ? void 0 : store.target(targetId);
			if (targetId !== void 0 && saved === void 0) throw new RouteError("not-found", `remote target "${targetId}" does not exist`, 404);
			if (saved !== void 0) {
				if (saved.kind !== "ssh") throw new RouteError("unsupported", "v1 connections are SSH-only", 400);
				const secret = await store.secretOf(saved);
				const savedKey = saved.authKind === "privateKey" && saved.privateKeyPath !== void 0 ? await readPrivateKeyFile(saved.privateKeyPath) : void 0;
				const reconnectHome = reconnectDshHome(saved.remote.dshHome, optionalString(body, "dshHome"));
				try {
					return await profiles.connect({
						label: optionalString(body, "label") ?? saved.label,
						host: saved.host,
						port: saved.port,
						username: saved.username,
						authKind: saved.authKind,
						...secret === void 0 ? {} : { secret },
						...savedKey === void 0 ? {} : { privateKey: savedKey },
						...saved.privateKeyPath === void 0 ? {} : { privateKeyPath: saved.privateKeyPath },
						...saved.hostKeyFingerprint === "" ? {} : { hostKeyFingerprint: saved.hostKeyFingerprint },
						...reconnectHome === void 0 ? {} : { dshHome: reconnectHome },
						runtimePolicy: "auto",
						...requestedModelSource === void 0 ? {} : { modelSource: requestedModelSource }
					}, reportProgress);
				} catch (error) {
					if (error instanceof HostKeyUnknownError) throw new RouteError("host-key-unknown", error.message, 409, { fingerprint: error.fingerprint });
					if (error instanceof HostKeyMismatchError) throw new RouteError("host-key-changed", error.message, 409, {
						expected: error.expected,
						actual: error.actual
					});
					throw error;
				}
			}
			const label = optionalString(body, "label") ?? requireString(body, "host");
			const privateKeyPath = optionalString(body, "privateKeyPath");
			const privateKey = privateKeyPath === void 0 ? void 0 : await readPrivateKeyFile(privateKeyPath);
			const port = typeof body.port === "number" ? body.port : Number.parseInt(requireString(body, "port"), 10);
			if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RouteError("bad-request", "\"port\" must be between 1 and 65535", 400);
			try {
				return await profiles.connect({
					label,
					host: requireString(body, "host"),
					port,
					username: requireString(body, "username"),
					authKind: optionalString(body, "authKind") ?? "agent",
					...optionalString(body, "secret") === void 0 ? {} : { secret: optionalString(body, "secret") },
					...privateKey === void 0 ? {} : { privateKey },
					...privateKeyPath === void 0 ? {} : { privateKeyPath },
					...optionalString(body, "hostKeyFingerprint") === void 0 ? {} : { hostKeyFingerprint: optionalString(body, "hostKeyFingerprint") },
					...optionalString(body, "dshHome") === void 0 ? {} : { dshHome: optionalString(body, "dshHome") },
					...optionalString(body, "runtimePolicy") === "isolated" ? { runtimePolicy: "isolated" } : {},
					...requestedModelSource === void 0 ? {} : { modelSource: requestedModelSource }
				}, reportProgress);
			} catch (error) {
				if (error instanceof HostKeyUnknownError) throw new RouteError("host-key-unknown", error.message, 409, { fingerprint: error.fingerprint });
				if (error instanceof HostKeyMismatchError) throw new RouteError("host-key-changed", error.message, 409, {
					expected: error.expected,
					actual: error.actual
				});
				throw error;
			}
		}
		case "v1/connect/progress": {
			const id = requireString(body, "attemptId");
			return { events: CONNECT_PROGRESS.get(id) ?? [] };
		}
		case "local-llm/read":
		case "local-llm/save":
		case "local-llm/probe":
		case "local-llm/discover":
		case "local-llm/clear-key": {
			const value = await dispatchLocalLlmApi(store, method, body, () => ctx.get("llm"));
			if (value === void 0) throw new RouteError("not-found", `unknown method ${JSON.stringify(method)}`, 404);
			return value;
		}
		case "forget-target": {
			const id = requireString(body, "targetId");
			await profiles.stop(id).catch(() => false);
			for (const workspace of store.listWorkspaces(id)) await store.deleteWorkspace(workspace.id).catch(() => false);
			await store.deleteTarget(id);
			return { forgotten: true };
		}
		case "v1/stop": return { stopped: await profiles.stop(requireString(body, "targetId")) };
		case "v1/workspaces": return await profiles.workspaceList(requireString(body, "targetId"));
		case "v1/sessions": return await profiles.sessionList(requireString(body, "targetId"), optionalString(body, "workspaceId"));
		case "session/timeline": {
			const sessionId = requireString(body, "sessionId");
			const sequence = (field) => {
				if (body[field] === void 0) return void 0;
				const value = Number(body[field]);
				if (!Number.isInteger(value) || value < 0) throw new RouteError("bad-request", `"${field}" must be a non-negative integer`, 400);
				return value;
			};
			const afterSeq = sequence("afterSeq");
			const beforeSeq = sequence("beforeSeq");
			if (afterSeq !== void 0 && beforeSeq !== void 0) throw new RouteError("bad-request", "timeline accepts afterSeq or beforeSeq, not both", 400);
			const limit = body.limit === void 0 ? void 0 : (() => {
				const value = Number(body.limit);
				if (!Number.isInteger(value) || value < 1) throw new RouteError("bad-request", "\"limit\" must be a positive integer", 400);
				return value;
			})();
			return await profiles.sessionTimeline(requireString(body, "targetId"), {
				sessionId,
				...afterSeq === void 0 ? {} : { afterSeq },
				...beforeSeq === void 0 ? {} : { beforeSeq },
				...limit === void 0 ? {} : { limit }
			});
		}
		case "session/prompt": {
			const targetId = requireString(body, "targetId");
			requireString(body, "sessionId");
			const text = body.text;
			if (typeof text !== "string" || text.trim() === "") throw new RouteError("bad-request", "\"text\" is required", 400);
			const mode = body.mode;
			if (mode !== void 0 && mode !== "followup" && mode !== "steer") throw new RouteError("bad-request", "\"mode\" must be followup|steer", 400);
			const { targetId: _targetId, ...params } = body;
			return await profiles.sessionPrompt(targetId, params);
		}
		case "session/cancel": {
			const targetId = requireString(body, "targetId");
			requireString(body, "sessionId");
			const { targetId: _targetId, ...params } = body;
			return await profiles.sessionCancel(targetId, params);
		}
		case "session/approval": {
			const targetId = requireString(body, "targetId");
			requireString(body, "sessionId");
			requireString(body, "approvalId");
			approvalDecision(body.decision);
			const { targetId: _targetId, ...params } = body;
			return await profiles.sessionApproval(targetId, params);
		}
		case "session/commands": {
			const targetId = requireString(body, "targetId");
			requireString(body, "sessionId");
			const { targetId: _targetId, ...params } = body;
			return await profiles.sessionCommands(targetId, params);
		}
		case "session/command": {
			const targetId = requireString(body, "targetId");
			requireString(body, "sessionId");
			requireString(body, "line");
			const { targetId: _targetId, ...params } = body;
			return await profiles.sessionCommand(targetId, params);
		}
		case "session/modelCatalog": {
			const targetId = requireString(body, "targetId");
			requireString(body, "sessionId");
			const { targetId: _targetId, ...params } = body;
			return await profiles.sessionModelCatalog(targetId, params);
		}
		case "session/selectModel": {
			const targetId = requireString(body, "targetId");
			requireString(body, "sessionId");
			requireString(body, "provider");
			requireString(body, "model");
			const { targetId: _targetId, ...params } = body;
			return await profiles.sessionSelectModel(targetId, params);
		}
		case "session/status": {
			const targetId = requireString(body, "targetId");
			requireString(body, "sessionId");
			const { targetId: _targetId, ...params } = body;
			return await profiles.sessionStatus(targetId, params);
		}
		case "state/refresh": {
			const targetId = requireString(body, "targetId");
			const refreshed = await profiles.refresh(targetId);
			const workspaces = refreshed.workspaces;
			const connection = profiles.connectionState(targetId);
			const registry = workspaces?.registry;
			return {
				...refreshed,
				connection: connection === void 0 ? void 0 : {
					...connection,
					...typeof registry?.revision !== "string" ? {} : { registry: {
						revision: registry.revision,
						...typeof registry.epoch === "string" ? { epoch: registry.epoch } : {},
						stale: false
					} }
				},
				registry: workspaces?.registry ?? null
			};
		}
		case "registry/refresh": return await profiles.registryRefresh(requireString(body, "targetId"));
		case "profile/restart-preview": return await profiles.restartPreview(requireString(body, "targetId"));
		case "profile/restart": return await profiles.restart(requireString(body, "targetId"), {
			confirmActiveTurns: body.confirmActiveTurns === true,
			previewRevision: requireString(body, "previewRevision")
		});
		case "workspace/create": return await profiles.workspaceCreate(requireString(body, "targetId"), requireString(body, "path"), optionalString(body, "title"));
		case "workspace/rename": return await profiles.workspaceRename(requireString(body, "targetId"), requireString(body, "workspaceId"), requireString(body, "title"));
		case "workspace/delete": return await profiles.workspaceDelete(requireString(body, "targetId"), requireString(body, "workspaceId"), body.force === true);
		case "workspace/reorder": return await profiles.workspaceReorder(requireString(body, "targetId"), requireString(body, "workspaceId"), optionalString(body, "beforeWorkspaceId"));
		case "session/create": {
			const executor = optionalString(body, "executor");
			if (executor !== void 0 && executor !== "server" && executor !== "local") throw new RouteError("bad-request", "\"executor\" must be server|local", 400);
			return await profiles.sessionCreate(requireString(body, "targetId"), {
				...optionalString(body, "workspaceId") === void 0 ? {} : { workspaceId: optionalString(body, "workspaceId") },
				...optionalString(body, "cwd") === void 0 ? {} : { cwd: optionalString(body, "cwd") },
				...optionalString(body, "sessionId") === void 0 ? {} : { sessionId: optionalString(body, "sessionId") },
				...optionalString(body, "agentPreset") === void 0 ? {} : { agentPreset: optionalString(body, "agentPreset") },
				...executor === void 0 ? {} : { executor }
			});
		}
		case "session/rename": return await profiles.sessionRename(requireString(body, "targetId"), requireString(body, "sessionId"), requireString(body, "title"));
		case "session/fork": return await profiles.sessionFork(requireString(body, "targetId"), requireString(body, "sessionId"), {
			...typeof body.atSeq === "number" ? { atSeq: body.atSeq } : {},
			...typeof body.increaseTitle === "boolean" ? { increaseTitle: body.increaseTitle } : {}
		});
		case "session/pin": return await profiles.sessionPin(requireString(body, "targetId"), requireString(body, "sessionId"), body.pinned === true);
		case "session/archive": return await profiles.sessionArchive(requireString(body, "targetId"), requireString(body, "sessionId"), body.archived === true, body.stopActivity === true);
		case "session/reorder": return await profiles.sessionReorder(requireString(body, "targetId"), requireString(body, "workspaceId"), requireString(body, "sessionId"), optionalString(body, "beforeSessionId"));
		case "session/open": {
			const executor = optionalString(body, "executor");
			if (executor !== void 0 && executor !== "server" && executor !== "local") throw new RouteError("bad-request", "\"executor\" must be server|local", 400);
			return await profiles.sessionOpen(requireString(body, "targetId"), {
				sessionId: requireString(body, "sessionId"),
				...optionalString(body, "workspaceId") === void 0 ? {} : { workspaceId: optionalString(body, "workspaceId") },
				...executor === void 0 ? {} : { executor }
			});
		}
		case "session/prepare-server": return await profiles.sessionPrepareServer(requireString(body, "targetId"), requireString(body, "sessionId"));
		case "mkdir": return await profiles.makeDirectory(requireString(body, "targetId"), requireString(body, "path"));
		case "fs/list": return await profiles.fsList(requireString(body, "targetId"), typeof body.path === "string" ? body.path : "");
		case "deployment/preview": return profiles.deploymentPreview(requireString(body, "targetId"));
		case "deployment/apply": {
			const kind = requireString(body, "kind");
			if (kind !== "runtime" && kind !== "plugin") throw new RouteError("bad-request", "\"kind\" must be runtime|plugin", 400);
			return await profiles.deploymentApply(requireString(body, "targetId"), {
				kind,
				...typeof body.confirm === "boolean" ? { confirm: body.confirm } : {}
			});
		}
		case "mode/preview": {
			const nextMode = requireString(body, "nextMode");
			if (nextMode !== "server" && nextMode !== "local") throw new RouteError("bad-request", "\"nextMode\" must be server|local", 400);
			return await profiles.modePreview(requireString(body, "targetId"), nextMode, optionalString(body, "targetSessionId"));
		}
		case "mode/apply": {
			const nextMode = requireString(body, "nextMode");
			if (nextMode !== "server" && nextMode !== "local") throw new RouteError("bad-request", "\"nextMode\" must be server|local", 400);
			const previewRevision = typeof body.previewRevision === "string" ? body.previewRevision : requireString(body, "previewRevision");
			return await profiles.modeApply(requireString(body, "targetId"), nextMode, {
				cancelActiveTurns: body.cancelActiveTurns === true,
				previewRevision,
				...optionalString(body, "targetSessionId") === void 0 ? {} : { targetSessionId: optionalString(body, "targetSessionId") }
			});
		}
		default: throw new RouteError("not-found", `unknown method ${JSON.stringify(method)}`, 404);
	}
}
let storageReady = Promise.resolve();
let storageFailure = "";
let store;
let cachedPluginVersion = "";
function apply(ctx, config) {
	store = new TargetStore(ctx);
	const profiles = new ProfileService({
		ctx,
		store,
		packageRoot: packageRootFrom(import.meta.url),
		pluginVersion: pluginVersion(),
		connector: createSshProfileConnector(),
		cacheDir: join(homedir(), ".dsh", "remote-assets", "server-plugin"),
		registerPortalUpgrade: (targetId, proxy) => ctx.webServer.registerUpgrade({
			path: portalMuxPath(targetId),
			handler: (req, socket, head) => {
				proxy.handleUpgrade(req, socket, head);
			}
		})
	});
	ctx.provide("remoteMux", new RemoteMuxRouter({ get: (targetId) => profiles.muxFor(targetId) }));
	const sessionRoot = localSessionRoot(ctx);
	createRoutingPersistence(ctx, { root: sessionRoot }, {
		routeForCwd: (cwd) => profiles.routeForCwd(cwd),
		locateRemoteSession: async (sessionId) => await profiles.locateRemoteSession(sessionId),
		sessionRequest: async (targetId, method, params, signal) => await profiles.rpc(targetId, method, params, signal),
		stubForWorkspace: (workspaceId) => profiles.anchorForWorkspace(workspaceId),
		remotePathForWorkspace: (workspaceId) => profiles.remotePathForWorkspace(workspaceId)
	});
	ctx.logger.debug(`dsh-remote-workspace: local session root=${sessionRoot}`);
	ctx.on("session/created", (session) => {
		assertRemoteSessionPreset(session.header);
	}, { global: true });
	ctx.effect(() => () => {
		store.close();
	}, "dsh-remote-workspace: storage");
	ctx.effect(() => registerRoutes(ctx, profiles), "dsh-remote-workspace: routes");
	ctx.effect(() => () => {
		profiles.dispose();
	}, "dsh-remote-workspace: v1 profiles");
	storageReady = store.open().then(async () => {
		await store.ensureClientId();
		if (ctx.get("sessionPersistence")?.routingMarker !== Symbol.for("dsh-remote-workspace.routing-persistence")) ctx.logger.error("dsh-remote-workspace: the `session-persistence-jsonl` row override did not apply; remote sessions would be stored locally (see cordis.patch.yml deviation d13)");
	}).catch((error) => {
		storageFailure = scrubSecrets(error instanceof Error ? error.message : String(error));
		ctx.logger.error(`dsh-remote-workspace: startup failed: ${storageFailure}`);
	});
	storageReady.then(() => {
		ctx.logger.debug(`dsh-remote-workspace: home=${homedir()} routes=${join(ROUTE_PREFIX, "api")}`);
	});
}
//#endregion
export { APPROVAL_DECISIONS, Config, ROUTE_PREFIX, apply, approvalDecision, handleSessionEvents, inject, name, sessionEventsQuery };
