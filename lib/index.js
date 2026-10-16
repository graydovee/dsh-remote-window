import RoutingSessionPersistence from "./session-persistence.js";
import { n as streamTransport, r as DEFAULT_MAX_FRAME_BYTES, t as FrameMux } from "./mux-B0gYN8cY.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, join as join$1, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Schema from "@deepseek-ai/schemastery";
import { execFile } from "node:child_process";
import { access, glob, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { credentialKey } from "@deepseek-ai/dsh-credentials";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { SSH_PROTOCOL_VERSION, SshRpcPeer } from "@deepseek-ai/dsh-ssh/protocol";
import { entriesSchema, helloSchema, targetSchema } from "@deepseek-ai/dsh-ssh/schemas";
import { Client } from "ssh2";
//#region src/ssh-config.ts
/**
* Reading of the local OpenSSH client configuration for the wizard's step 2
* (pick an alias, prefill the connection form).
*
* Scope and guarantees:
*
* - Dependency-free: `node:` builtins only, no I/O besides reading the config
*   file(s) and, optionally, asking the local `ssh` binary for its resolved
*   view with `ssh -G`. Nothing here touches a network.
* - Non-interactive by construction: `ssh -G` prints the effective
*   configuration and exits without opening a connection, so it can never
*   prompt; the argv is passed as an array (never shell-interpolated) and no
*   `-o` option is ever added, so host-key checking can never be weakened.
* - Secret-free by construction: the only file path this module reports is an
*   `IdentityFile` path. Passwords, passphrases, key material and agent sockets
*   are never read, never returned and never logged.
* - `process.env` is never consulted; the only environment-ish input is the
*   user's home directory, used solely to expand a leading `~`.
*
* OpenSSH semantics implemented here:
*
* - Per option, the FIRST obtained value wins (OpenSSH keeps the first value it
*   obtains for a keyword while walking the configuration). That is why every
*   option in {@link SshConfigHost} is assigned only when still `undefined`.
* - `Host` matching is case-insensitive, and a pattern containing `*`, `?` or a
*   leading `!` is not a literal alias and is therefore never offered in the
*   alias list (see {@link listSshAliases}).
* - A `Match` block applies conditionally at connection time, so its keywords
*   belong to no {@link SshConfigHost} entry: the parser drops them instead of
*   leaking them into the preceding literal block.
* - An `Include` is expanded in place, at the position where it appears, which
*   is what makes "first value wins" observable across file boundaries.
*/
/** A pattern with any of these characters is a matcher or a negation, not a literal alias. */
const NON_LITERAL_PATTERN = /[*?!]/;
/** Characters that make an `Include` argument a glob rather than a plain path. */
const GLOB_CHARACTERS = /[*?[\]{}]/;
/** Default `ssh -G` budget; the command only prints configuration and returns immediately. */
const DEFAULT_SSH_G_TIMEOUT_MS = 5e3;
/** `ssh -G` output is a few dozen KiB at most. */
const SSH_G_MAX_BUFFER = 1 << 20;
/** OpenSSH's default port when neither the config file nor `ssh -G` supplies one. */
const DEFAULT_SSH_PORT = 22;
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
/** True when the string is safe to hand to `execFile` as a positional host argument. */
function isSafeAlias(alias) {
	if (alias.length === 0) return false;
	if (alias.startsWith("-")) return false;
	if (/\s/.test(alias)) return false;
	if (alias.includes("\0")) return false;
	return true;
}
/** Short, path-safe description of an fs error for a warning string. */
function errorMessage(error) {
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
		state.warnings.push(`Cannot read SSH config file ${absolute}: ${errorMessage(error)}`);
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
		state.warnings.push(`Cannot expand Include "${pattern}" from ${fromFile}: ${errorMessage(error)}`);
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
/** Run `ssh -G` and collect stdout; any failure (missing binary, nonzero exit, timeout) resolves to `undefined`. */
function runSshG(sshBinary, alias, configPath, timeoutMs) {
	const args = configPath === void 0 ? [
		"-G",
		"-T",
		alias
	] : [
		"-F",
		configPath,
		"-G",
		"-T",
		alias
	];
	return new Promise((settle) => {
		try {
			execFile(sshBinary, args, {
				timeout: timeoutMs,
				maxBuffer: SSH_G_MAX_BUFFER,
				encoding: "utf8"
			}, (error, stdout) => {
				if (error !== null) {
					settle(void 0);
					return;
				}
				settle(typeof stdout === "string" ? stdout : String(stdout));
			});
		} catch {
			settle(void 0);
		}
	});
}
/** Parse the `key value` lines of `ssh -G` output; `value` keeps embedded spaces. */
function parseSshG(stdout) {
	const values = { identityFiles: [] };
	for (const raw of stdout.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.length === 0) continue;
		const space = line.indexOf(" ");
		if (space < 0) continue;
		const key = line.slice(0, space).toLowerCase();
		let value = line.slice(space + 1).trim();
		if (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2) value = value.slice(1, -1).replace(/\\"/g, "\"");
		if (value.length === 0 || value === "none") continue;
		switch (key) {
			case "hostname":
				if (values.hostName === void 0) values.hostName = value;
				break;
			case "user":
				if (values.user === void 0) values.user = value;
				break;
			case "port": {
				if (values.port !== void 0) break;
				const port = Number.parseInt(value, 10);
				if (Number.isInteger(port) && port >= 1 && port <= 65535) values.port = port;
				break;
			}
			case "identityfile":
				values.identityFiles.push(value);
				break;
			case "proxyjump":
				if (values.proxyJump === void 0) values.proxyJump = value;
				break;
			case "proxycommand": if (values.proxyCommand === void 0) values.proxyCommand = value;
		}
	}
	return values;
}
/**
* Pick the `IdentityFile` to prefill: the first candidate that exists on disk,
* falling back to the first candidate when none does.
*/
async function pickIdentityFile(candidates) {
	const first = candidates[0];
	if (first === void 0) return void 0;
	for (const candidate of candidates) {
		const expanded = expandTilde(candidate);
		try {
			await access(expanded);
			return expanded;
		} catch {}
	}
	return expandTilde(first);
}
/** True when some literal Host pattern names this alias (case-insensitively). */
async function isConfiguredAlias(alias, configPath) {
	const { hosts } = await readSshConfig(configPath ?? defaultConfigPath());
	const needle = alias.toLowerCase();
	return hosts.some((host) => host.patterns.some((pattern) => isLiteralPattern(pattern) && pattern.toLowerCase() === needle));
}
/** Resolve straight from the config file: first literal match, case-insensitively. */
async function resolveFromConfigFile(alias, configPath) {
	const { hosts } = await readSshConfig(configPath ?? defaultConfigPath());
	const needle = alias.toLowerCase();
	for (const host of hosts) {
		if (!host.patterns.some((pattern) => isLiteralPattern(pattern) && pattern.toLowerCase() === needle)) continue;
		return {
			alias,
			hostName: host.hostName ?? alias,
			port: host.port ?? DEFAULT_SSH_PORT,
			user: host.user,
			identityFile: host.identityFile,
			proxyJump: host.proxyJump,
			proxyCommand: host.proxyCommand,
			origin: "config-file"
		};
	}
}
/**
* Resolve one alias through `ssh -G <alias>` (non-interactive), falling back to the config file when the ssh binary is missing or fails. Returns undefined when the alias is unknown.
*
* Hostile spellings (empty, whitespace, newline, NUL, or a `-` prefix) are
* rejected before any process is spawned, so an alias can never be read as an
* ssh option. `options.configPath` is passed as `-F`, which keeps the probe
* independent of the developer's real `~/.ssh/config`; when it is omitted a
* successful `ssh -G` result is still cross-checked against the default config
* file, because `ssh -G` exits successfully even for an unknown alias (it then
* reports the alias as its own hostname).
*/
async function resolveSshAlias(alias, options) {
	if (!isSafeAlias(alias)) return void 0;
	const configPath = options?.configPath;
	const stdout = await runSshG(options?.sshBinary ?? "ssh", alias, configPath, options?.timeoutMs ?? DEFAULT_SSH_G_TIMEOUT_MS);
	if (stdout !== void 0) {
		const values = parseSshG(stdout);
		const hostName = values.hostName;
		if (hostName !== void 0) {
			if (await isConfiguredAlias(alias, configPath) || hostName.toLowerCase() !== alias.toLowerCase()) return {
				alias,
				hostName,
				port: values.port ?? DEFAULT_SSH_PORT,
				user: values.user,
				identityFile: await pickIdentityFile(values.identityFiles),
				proxyJump: values.proxyJump,
				proxyCommand: values.proxyCommand,
				origin: "ssh -G"
			};
		}
	}
	return resolveFromConfigFile(alias, configPath);
}
/**
* Prefill for the wizard form: the resolution plus the literal table values.
*
* The resolution wins wherever it has a value (it is what ssh would actually
* use), and any gap it leaves is filled from the literal block; with no
* resolution at all the block's own values are returned.
*/
function prefillFromResolution(host, resolution) {
	return {
		alias: host.alias,
		host: resolution?.hostName ?? host.hostName ?? host.alias,
		port: resolution?.port ?? host.port ?? DEFAULT_SSH_PORT,
		username: resolution?.user ?? host.user,
		identityFile: resolution?.identityFile ?? host.identityFile,
		source: resolution?.origin ?? "config-file"
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
	"upload"
]);
/** The domain global slot's schema (global default policy + release mirror). */
const packagePolicySettingsSchema = z.object({
	policy: z.enum([
		"auto",
		"download",
		"upload",
		"ask"
	]),
	mirror: z.string()
}).strict();
/** Stored target record; unknown fields from a newer version are dropped loudly. */
const targetRecordSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	kind: z.literal("ssh"),
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
	packageSource: packageSourceSchema.optional(),
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
const workspaceRecordSchema = z.object({
	id: z.string().min(1),
	targetId: z.string().min(1),
	path: z.string().startsWith("/"),
	stubPath: z.string().min(1).optional(),
	officialWorkspaceId: z.string().min(1).optional(),
	title: z.string().min(1),
	createdAt: z.string().min(1),
	lastOpenedAt: z.string().optional(),
	sessionId: z.string().min(1).optional(),
	remoteWorkspaceId: z.string().length(16).optional(),
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
* Remove values that look like credentials from free text.
*
* Applied to every error string, log line and HTTP/SSE payload the plugin emits,
* so a rejected SSH attempt cannot echo a password into the UI or a session log.
*/
function scrubSecrets(text) {
	return text.replace(/(password|passphrase|secret|token)(\s*[=:]\s*)\S+/gi, "$1$2***").replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted private key]").replace(/(?:^|\s)(?:ssh-rsa|ssh-ed25519|ecdsa-sha2-\S+)\s+[A-Za-z0-9+/=]{16,}/g, " [redacted public key]");
}
//#endregion
//#region src/targets/store.ts
/** Smallest credential scope/id segments `ctx.credentials` accepts. */
const CREDENTIAL_SCOPE = "remote-workspace";
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
	name: "dsh_remote_workspace",
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
	/** Replace the global package-source policy. */
	async setPackagePolicy(settings) {
		await this.require().global.set(packagePolicySettingsSchema.parse(settings));
	}
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
	/** Every stored remote workspace, optionally for one target. */
	listWorkspaces(targetId) {
		return [...this.workspaces().entries()].map(([, value]) => value).filter((record) => targetId === void 0 || record.targetId === targetId).sort((left, right) => (right.lastOpenedAt ?? right.createdAt).localeCompare(left.lastOpenedAt ?? left.createdAt));
	}
	/** One workspace, or undefined. */
	workspace(id) {
		return this.workspaces().get(id);
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
		hostVerifier: (key) => {
			const actual = fingerprintOf(key);
			if (options.hostKeyFingerprint === void 0) {
				hostKeyError = new HostKeyUnknownError(actual);
				return false;
			}
			if (options.hostKeyFingerprint !== actual) {
				hostKeyError = new HostKeyMismatchError(options.hostKeyFingerprint, actual);
				return false;
			}
			return true;
		}
	};
	await new Promise((resolve, reject) => {
		client.once("ready", () => {
			resolve();
		});
		client.once("error", (error) => {
			reject(hostKeyError ?? error);
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
/** Open an interactive exec channel for the server's stdio. */
async function openExecChannel(client, command) {
	return await new Promise((resolve, reject) => {
		client.exec(command, (error, stream) => {
			if (error !== void 0) {
				reject(new RemoteCommandError(`remote server failed to start: ${scrubSecrets(error.message)}`, scrubSecrets(command)));
				return;
			}
			resolve(stream);
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
/** Write one file, creating parents first. */
async function writeRemoteFile(sftp, file) {
	await mkdirp(sftp, file.path.slice(0, file.path.lastIndexOf("/")));
	await new Promise((resolve, reject) => {
		sftp.writeFile(file.path, file.content, { mode: 420 }, (error) => {
			if (error != null) reject(new RemoteCommandError(`cannot write remote file "${file.path}"`, scrubSecrets(String(error.message))));
			else resolve();
		});
	});
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
/**
* Write one file through an exec pipe (`cat > path`) — the fallback for
* gateways that do not expose the SFTP subsystem. Remembers nothing: the
* caller decides once per session which transport to use.
*/
async function writeRemoteFileViaExec(client, file) {
	const quotedPath = file.path.replaceAll("'", "'\\''");
	const escaped = file.content.toString("base64");
	const result = await new Promise((resolve, reject) => {
		execRemote(client, `umask 022; cat > '${quotedPath}.b64' << 'DSH_RW_EOF'\n${escaped}\nDSH_RW_EOF\n(base64 -d '${quotedPath}.b64' 2>/dev/null || openssl base64 -d -in '${quotedPath}.b64') > '${quotedPath}' && rm -f '${quotedPath}.b64'`, {
			maxBytes: 4096,
			timeoutMs: 3e5
		}).then(resolve, reject);
	});
	if (result.code !== 0) throw new RemoteCommandError(`cannot write remote file "${file.path}" through the exec pipe`, scrubSecrets(result.stderr.slice(-2e3)));
}
//#endregion
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
					name: "dsh-remote-workspace/connection",
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
* The creation-time seed: one *complete* turn (open → system head → close).
*
* Why a whole turn: the restore layer (DSH `session-format-v3-to-v4`
* relationships.ts) requires every `system/message` to sit inside an open
* `turn/start` + `step/start` pair — a bare system event loads fine in memory
* but is rejected as `… does not match an open turn and step` on the next
* process restart. The turn must also be *closed* (`step/end` + `turn/end`,
* reason `completed`): an open tail survives one reload, but the agent loop
* derives the next turn number from the last seen `data.turn` and its new
* `turn/start` would then collide with the still-open turn and corrupt the
* log again.
*/
function workspaceSeedEvents() {
	const time = Date.now();
	return [
		{
			type: "turn/start",
			seq: 0,
			time,
			data: { turn: 1 }
		},
		{
			type: "step/start",
			seq: 1,
			time,
			data: {
				turn: 1,
				step: 1
			}
		},
		{
			type: "system/message",
			seq: 2,
			time,
			surfaceOp: "append",
			data: {
				turn: 1,
				step: 1,
				message: {
					id: randomUUID(),
					role: "system",
					content: [],
					source: { kind: "system-prompt" }
				}
			}
		},
		{
			type: "step/end",
			seq: 3,
			time,
			data: {
				turn: 1,
				step: 1
			}
		},
		{
			type: "turn/end",
			seq: 4,
			time,
			data: {
				turn: 1,
				reason: { kind: "completed" }
			}
		}
	];
}
/**
* Create (or adopt) the session for a remote workspace.
* @param ctx - the plugin's host context.
* @param options - target, stub path and optional existing session id.
* @returns the session identity and the preset it was composed with.
*/
async function openRemoteSession(ctx, options) {
	if (!options.path.startsWith("/")) throw new Error(`remote working directory must be absolute, received "${options.path}"`);
	const presets = ctx.agentPresets;
	const presetId = remotePresetId(options.targetId);
	const resolved = await presets.resolve(presetId);
	if (resolved.broken !== void 0) throw new Error(`remote preset "${presetId}" is unusable: ${resolved.broken}`);
	const sessionId = options.sessionId ?? `session-${randomUUID()}`;
	const agents = ctx.agents;
	if (agents.get(sessionId) !== void 0) return {
		sessionId,
		agentPreset: resolved.id
	};
	const selection = ctx.get("agentDefaultModel")?.currentSelection() ?? {};
	const buildCreate = (id) => ({
		sessionId: id,
		seed: workspaceSeedEvents(),
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
		}
	});
	try {
		await agents.create(buildCreate(sessionId));
		return {
			sessionId,
			agentPreset: resolved.id
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (options.sessionId === void 0 || !/already exists|corrupt|does not match an open turn/i.test(message)) throw error;
		const fresh = `session-${randomUUID()}`;
		await agents.create(buildCreate(fresh));
		return {
			sessionId: fresh,
			agentPreset: resolved.id
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
	const presetId = remotePresetId(options.targetId);
	const resolved = await presets.resolve(presetId);
	if (resolved.broken !== void 0) throw new Error(`remote preset "${presetId}" is unusable: ${resolved.broken}`);
	const sessionId = options.sessionId;
	const agents = ctx.agents;
	if (agents.get(sessionId) !== void 0) return {
		sessionId,
		agentPreset: resolved.id
	};
	const selection = ctx.get("agentDefaultModel")?.currentSelection() ?? {};
	await agents.resume({
		resumeSessionId: sessionId,
		agentOptions: {
			...selection.provider === void 0 ? {} : { provider: selection.provider },
			...selection.model === void 0 ? {} : { model: selection.model }
		},
		...options.signal === void 0 ? {} : { signal: options.signal },
		setup: async (agentCtx) => {
			await presets.mount(agentCtx, resolved.id);
		}
	});
	return {
		sessionId,
		agentPreset: resolved.id
	};
}
//#endregion
//#region src/provision/profile.ts
/**
* Remote profile generation.
*
* The remote end is a *profile*, not an uploaded binary: a directory with an
* empty-bundle `package.json`, the standard empty root list, and a patch layer
* that mounts exactly the execution providers plus this plugin's server row.
* No agent loop, no session store, no model client and no credential provider is
* mounted there, so nothing on the remote can reach the user's models.
*
* The plugin package itself is placed in the profile's `node_modules` instead of
* being installed with a package manager: DSH resolves a profile-local package's
* own peers (cordis, schemastery) from the dsh installation, so a plain
* directory copy is a complete, offline install.
*/
/** Directory inside the profile that holds this plugin. */
const PROFILE_PACKAGE_DIR = "node_modules/dsh-remote-workspace";
const ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`;
/**
* The provider rows a remote execution world needs.
*
* `session-projection` is required because `sandbox-policy` injects
* `sessionProjections`; without it the policy service never activates and every
* write is denied. `fs-sandbox` (not `fs-local`) is the provider that enforces
* the per-call policy the client sends.
*/
function providerRows(options) {
	return `- insert:
    - id: remote-session-persistence
      name: '@deepseek-ai/dsh-session-persistence-jsonl'
      disabled: !!js ctx.get('sessionPersistence') !== undefined
      config:
        root: !!js dshHomePath('remote-server-sessions')
        compression: zstd
    - id: session-projection
      name: '@deepseek-ai/dsh-session-projection'
    - id: subprocess
      name: '@deepseek-ai/dsh-subprocess-local'
    - id: sandbox
      name: '@deepseek-ai/dsh-sandbox-local'
    - id: sandbox-policy
      name: '@deepseek-ai/dsh-sandbox-policy'
      config:
        mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'
        workspaceRoot: !!js process.cwd()
    - id: fs-sandbox
      name: '@deepseek-ai/dsh-fs-sandbox'
    - id: remote-workspace-server
      name: dsh-remote-workspace/server
      config:
        workspace: !!js process.cwd()
        identityFile: !!js dshHomePath('remote-server/server-id')
        workspaceIndex: !!js dshHomePath('remote-server/workspaces.json')
        statusFile: !!js dshHomePath('remote-server/status.json')
        leaseMs: ${options.leaseMs}
        maxProcesses: ${options.maxProcesses}
        exitOnClose: true
`;
}
/** The remote profile's own files, keyed by path relative to the profile directory. */
function remoteProfileFiles(options) {
	return /* @__PURE__ */ new Map([
		["package.json", `${JSON.stringify({
			name: `dsh-profile-${options.profile}`,
			private: true,
			dependencies: {},
			dsh: { profile: { bundles: [] } }
		}, null, 2)}\n`],
		["cordis.yml", ROOT_CONFIG],
		["cordis.patch.yml", providerRows({
			leaseMs: options.leaseMs ?? 3e4,
			maxProcesses: options.maxProcesses ?? 128
		})],
		["pnpm-workspace.yaml", "packages:\n  - .\n"]
	]);
}
/** The package files the remote needs at run time. */
async function packageFiles(packageRoot) {
	const files = [];
	const push = async (relative) => {
		files.push({
			path: relative,
			content: await readFile(join(packageRoot, relative))
		});
	};
	await push("package.json");
	await push("cordis.patch.yml");
	for (const name of await readdir(join(packageRoot, "lib"))) if (name.endsWith(".js") || name.endsWith(".mjs") || name.endsWith(".cjs")) await push(join("lib", name));
	return files;
}
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
/**
* The command that starts the remote server on its stdio.
*
* Everything is an absolute path inside the deployment root and the explicit
* `PATH` only exists so the `dsh` launcher's `#!/usr/bin/env node` shebang
* resolves to the *deployed* node — the remote's own PATH is never consulted.
*/
function serverCommand(options) {
	const root = `${options.installHome}/.dsh/server`;
	return [
		`DSH_HOME=${shellQuote(options.home)}`,
		pathAssignment([`${root}/node/bin`, `${root}/dsh/node_modules/.bin`]),
		`exec ${shellQuote(`${root}/dsh/node_modules/.bin/dsh`)} --profile ${shellQuote(options.profile)}`
	].join(" ");
}
//#endregion
//#region src/provision/deploy.ts
/** The fixed remote installation root. */
const SERVER_ROOT = ".dsh/server";
/** How long a stale `.deploy.lock` may sit before a new deploy reclaims it. */
const LOCK_STALE_MS = 6e5;
/** Quote one argv element for the remote POSIX shell. */
const q = shellQuote;
/** Wrap a command body so it always runs under `/bin/sh` — never the user's login shell. */
function sh(body) {
	return `/bin/sh -c ${q(body)}`;
}
/** A remote path inside the server root, rooted at the detected home. */
function serverPath(home, relative) {
	return `${home}/${SERVER_ROOT}/${relative}`;
}
/** Parse one component marker JSON, tolerating absence or corruption. */
function parseMarker(raw) {
	const text = raw?.trim() ?? "";
	if (text === "") return void 0;
	try {
		return JSON.parse(text);
	} catch {
		return;
	}
}
/**
* Fold the probe's separator-framed output into a {@link RemoteEnvironment}.
* Pure so the decision layer is unit-testable without a host.
*/
function parseProbeOutput(stdout) {
	const segments = stdout.split("@@RW@@").map((segment) => segment.trim());
	const home = (segments[0] ?? "").split("\n")[0] ?? "";
	const uname = (segments[1] ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
	const ostype = ((segments[2] ?? "").split("\n")[0] ?? "").trim().toLowerCase();
	const tools = (segments[3] ?? "").split("\n").map((line) => line.trim().split("/").pop() ?? "").filter(Boolean);
	const platform = ostype.includes("linux") || uname[0] === "Darwin" && ostype === "linux" ? "linux" : uname[0] === "Darwin" ? "darwin" : "linux";
	const rawArch = uname[1] ?? "";
	const arch = rawArch === "arm64" || rawArch === "aarch64" ? "arm64" : "x64";
	const ldd = ((segments[7] ?? "").split("\n")[0] ?? "").toLowerCase();
	return {
		home,
		platform,
		arch,
		libc: platform !== "linux" ? "" : ldd.includes("musl") ? "musl" : "gnu",
		tools: {
			tar: tools.includes("tar"),
			sha256sum: tools.includes("sha256sum") || tools.includes("shasum"),
			curl: tools.includes("curl"),
			wget: tools.includes("wget")
		},
		node: parseMarker(segments[4]),
		dsh: parseMarker(segments[5]),
		plugin: parseMarker(segments[6])
	};
}
/** The one-shot environment probe: facts only, framed by `@@RW@@` separators. */
function probeScript() {
	return [
		"printf '%s\\n' \"$HOME\"",
		"printf '@@RW@@\\n'",
		"uname -s; uname -m",
		"printf '@@RW@@\\n'",
		"cat /proc/sys/kernel/ostype 2>/dev/null || true",
		"printf '@@RW@@\\n'",
		"for t in tar sha256sum shasum curl wget; do command -v \"$t\" 2>/dev/null || true; done",
		"printf '@@RW@@\\n'",
		"mkdir -p ~/.dsh/server/.components",
		"cat ~/.dsh/server/.components/node.json 2>/dev/null || true",
		"printf '@@RW@@\\n'",
		"cat ~/.dsh/server/.components/dsh.json 2>/dev/null || true",
		"printf '@@RW@@\\n'",
		"cat ~/.dsh/server/.components/plugin.json 2>/dev/null || true",
		"printf '@@RW@@\\n'",
		"ldd --version 2>&1 | head -1 || true"
	].join("\n");
}
/** Decide whether the deployed dsh component is current (content-addressed). */
function decideDsh(marker, version, sha256) {
	return marker !== void 0 && marker.version === version && marker.sha256 === sha256 ? "skip" : "deploy";
}
/** Decide whether the uploaded plugin/profile file set is current. */
function decidePlugin(marker, sha256) {
	return marker !== void 0 && marker.sha256 === sha256 ? "skip" : "deploy";
}
/** One component marker as JSON, suitable for `printf %s`. */
function markerJson(marker) {
	return `${JSON.stringify(marker)}\n`;
}
/**
* The remote script that turns one uploaded tarball into `<root>/node`.
*
* Everything is absolute, staging-first and verified before the swap, so an
* interrupted run leaves the previous deployment untouched.
*/
function extractNodeScript(options) {
	const root = `${options.home}/${SERVER_ROOT}`;
	const tarball = `${root}/staging/${options.tarballName}`;
	const extract = `${root}/staging/node-x`;
	return [
		"set -eu",
		`cd ${q(options.home)}`,
		`command mkdir -p ${q(`${root}/staging`)} ${q(`${root}/.components`)}`,
		`find ${q(`${root}/staging`)} -maxdepth 1 -depth 1 -mtime +1 -exec rm -rf {} + 2>/dev/null || true`,
		...options.shaTool === "" ? [] : [`echo '${options.sha256}  ${tarball}' | ${options.shaTool} -c - >/dev/null 2>&1 || { echo 'node tarball sha256 mismatch' >&2; exit 3; }`],
		`rm -rf ${q(extract)}`,
		`command mkdir -p ${q(extract)}`,
		`tar -xzf ${q(tarball)} -C ${q(extract)}`,
		`test -x ${q(`${extract}/${options.distDir}/bin/node`)}`,
		`rm -rf ${q(`${root}/node.new`)}`,
		`command mv -f ${q(`${extract}/${options.distDir}`)} ${q(`${root}/node.new`)}`,
		`got=$(${q(`${root}/node.new/bin/node`)} -v)`,
		`[ "$got" = ${q(options.version)} ] || { echo "extracted node reports $got, expected ${options.version}" >&2; exit 4; }`,
		`rm -rf ${q(`${root}/node`)}`,
		`command mv -f ${q(`${root}/node.new`)} ${q(`${root}/node`)}`,
		`rm -rf ${q(extract)} ${q(tarball)}`,
		`printf %s ${q(markerJson({
			id: "node",
			version: options.version,
			platformArch: options.platformArch,
			sha256: options.sha256
		}))} > ${q(`${root}/.components/node.json`)}`
	].join("\n");
}
/**
* Turn one uploaded dsh runtime package (built host-side by
* `assets.buildDshRuntimePackage`) into `<root>/dsh`, verify the launcher
* answers, then write the content-addressed marker. Nothing on the remote
* talks to a registry; the package already contains the whole dependency
* closure for the target platform.
*/
function installDshPackageScript(options) {
	const root = `${options.home}/${SERVER_ROOT}`;
	const tarball = `${root}/staging/${options.tarballName}`;
	const extract = `${root}/staging/dsh-x`;
	const target = `${root}/dsh`;
	`${target}`;
	return [
		"set -eu",
		`echo '${options.sha256}  ${tarball}' | sha256sum -c - >/dev/null 2>&1 || { echo 'dsh package sha256 mismatch' >&2; exit 3; }`,
		`rm -rf ${q(extract)}`,
		`command mkdir -p ${q(extract)}`,
		`tar -xzf ${q(tarball)} -C ${q(extract)}`,
		`test -x ${q(`${extract}/node_modules/.bin/dsh`)} || { echo 'the dsh package has no launcher' >&2; exit 5; }`,
		`got=$(${pathAssignment([`${root}/node/bin`, `${extract}/node_modules/.bin`])} ${q(`${extract}/node_modules/.bin/dsh`)} --version | head -1)`,
		`[ -n "$got" ] || { echo 'the staged dsh launcher printed nothing (node too old for import.meta.main?)' >&2; exit 6; }`,
		`rm -rf ${q(target)} ${q(`${root}/prefix`)}`,
		`command mv -f ${q(extract)} ${q(target)}`,
		`rm -f ${q(tarball)}`,
		`printf %s ${q(markerJson({
			id: "dsh",
			version: options.version,
			sha256: options.sha256
		}))} > ${q(`${root}/.components/dsh.json`)}`
	].join("\n");
}
/** Reveal an installed dsh version without reinstalling (marker hit path). */
function checkDshScript(options) {
	const root = `${options.home}/${SERVER_ROOT}`;
	return [
		"set -eu",
		`d=${q(`${root}/dsh/node_modules/.bin/dsh`)}`,
		"test -x \"$d\" || exit 9",
		`${pathAssignment([`${root}/node/bin`, `${root}/dsh/node_modules/.bin`])} "$d" --version | head -1`
	].join("\n");
}
/**
* Acquire the deployment lock. `mkdir` is the atomic test-and-set; a lock
* older than ten minutes is a crashed client and is reclaimed once.
*/
async function acquireDeployLock(client, home, token) {
	const root = `${home}/${SERVER_ROOT}`;
	const result = await execRemote(client, sh([
		"set -eu",
		`command mkdir -p ${q(root)}`,
		`if command mkdir ${q(`${root}/.deploy.lock`)} 2>/dev/null; then printf %s ${q(token)} > ${q(`${root}/.deploy.lock/owner`)}; exit 0; fi`,
		`owner=$(cat ${q(`${root}/.deploy.lock/owner`)} 2>/dev/null || true)`,
		`[ "$owner" = ${q(token)} ] && exit 0`,
		`age=$(( $(date +%s) - $(stat -c %Y ${q(`${root}/.deploy.lock`)} 2>/dev/null || stat -f %m ${q(`${root}/.deploy.lock`)} 2>/dev/null || echo 0) ))`,
		`if [ "$age" -gt ${Math.floor(LOCK_STALE_MS / 1e3)} ]; then`,
		`  rm -rf ${q(`${root}/.deploy.lock`)}`,
		`  command mkdir ${q(`${root}/.deploy.lock`)} && printf %s ${q(token)} > ${q(`${root}/.deploy.lock/owner`)} && exit 0`,
		"fi",
		`echo "another deployment holds ${root}/.deploy.lock (owner \${owner:-unknown}, \$age s old)" >&2`,
		"exit 8"
	].join("\n")), {
		maxBytes: 4096,
		timeoutMs: 3e4
	});
	if (result.code !== 0) throw new Error(`cannot acquire the remote deploy lock: ${result.stderr.trim() || `exit ${result.code}`}`);
}
/** Release the deployment lock (best effort). */
async function releaseDeployLock(client, home, token) {
	const root = `${home}/${SERVER_ROOT}`;
	await execRemote(client, sh([
		`[ -f ${q(`${root}/.deploy.lock/owner`)} ] || exit 0`,
		`owner=$(cat ${q(`${root}/.deploy.lock/owner`)})`,
		`[ "$owner" = ${q(token)} ] || exit 0`,
		`rm -rf ${q(`${root}/.deploy.lock`)}`
	].join("\n")), {
		maxBytes: 4096,
		timeoutMs: 15e3
	}).catch(() => {});
}
/** Write small files (profile text, lib bundles) over the session's transport. */
async function writeFiles(transport, files) {
	if (transport.sftp !== void 0) {
		for (const file of files) await writeRemoteFile(transport.sftp, file);
		return;
	}
	for (const file of files) await writeRemoteFileViaExec(transport.client, file);
}
/** Upload the node tarball with progress, then run the extraction script. */
async function uploadNodeTarball(transport, options, onProgress) {
	const distDir = `node-${options.version}-${options.platformArch}`;
	const tarballName = `${distDir}.tar.gz`;
	const tarballPath = serverPath(options.home, `staging/${tarballName}`);
	const file = {
		path: tarballPath,
		content: options.content
	};
	if (transport.sftp !== void 0) await uploadRemoteFile(transport.sftp, file, onProgress);
	else {
		await writeRemoteFileViaExec(transport.client, file);
		onProgress?.(file.content.length, file.content.length);
	}
	return {
		tarballPath,
		tarballName,
		distDir
	};
}
/** Ensure remote parent directories exist (SFTP mode only; scripts mkdir theirs). */
async function ensureRemoteDirs(transport, home) {
	if (transport.sftp === void 0) return;
	await mkdirp(transport.sftp, serverPath(home, "staging"));
	await mkdirp(transport.sftp, serverPath(home, ".components"));
}
/** Run one deployment step's script, surfacing the remote stderr verbatim. */
async function runDeployScript(client, script, options) {
	const result = await execRemote(client, sh(script), {
		maxBytes: options.maxBytes ?? 262144,
		timeoutMs: options.timeoutMs
	});
	if (result.code !== 0) {
		const detail = result.stderr.trim().slice(-2e3);
		throw new Error(`remote ${options.what} failed (exit ${result.code ?? "signal"}): ${detail !== "" ? detail : "no stderr output"}`);
	}
	return result.stdout;
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
/** The `<platform>-<arch>[-libc]` artifact tag. */
function artifactTag(platform, arch, libc) {
	return libc === "" ? `${platform}-${arch}` : `${platform}-${arch}-${libc}`;
}
/** The server-package artifact name for one target. */
function artifactName(version, tag) {
	return `dsh-remote-server-${version}-${tag}.tar.gz`;
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
function isForeignBindingDir(dirName, suffix) {
	const binding = bindingOf(dirName);
	return binding !== void 0 && binding.flavour !== suffix;
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
		const launcher = join(options.stage, "node_modules", ".bin", "dsh");
		if (!await stat(launcher).then((i) => i.isFile(), () => false)) {
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
		const probe = await execLocal$1("/usr/bin/env", [
			`PATH=/usr/bin:/bin:${join(options.nodeBin, "..")}`,
			launcher,
			"--version"
		], 12e4);
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
	const entries = await readdir(pnpmDir).catch(() => []);
	let bindingVersion = "";
	for (const entry of entries) {
		const match = /^node-addon-require-builtin(?:-.+)?@(\d[^/]*)$/.exec(entry);
		if (match !== null) {
			bindingVersion = match[1] ?? "";
			break;
		}
	}
	if (bindingVersion === "") return;
	const suffix = bindingPackageSuffix(options.platform, options.arch, options.libc);
	const binding = `node-addon-require-builtin-${suffix}`;
	if (!entries.some((entry) => entry.startsWith(`${binding}@`))) {
		notify(`adding native binding ${binding}@${bindingVersion}`);
		const add = await execLocal$1(options.nodeBin, [
			options.pnpmCjs,
			"-C",
			options.stage,
			"add",
			`${binding}@${bindingVersion}`,
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
	const pnpmDir = join(stage, "node_modules", ".pnpm");
	const entries = await readdir(pnpmDir).catch(() => []);
	const foreign = entries.filter((entry) => isForeignBindingDir(entry, suffix));
	if (foreign.length > 0) throw new Error(`staged package contains foreign native bindings for ${platform}-${arch}${libc === "" ? "" : `-${libc}`}: ${foreign.join(", ")}`);
	if (!entries.some((entry) => entry.startsWith(`node-addon-require-builtin-${suffix}@`))) throw new Error(`staged package is missing the native binding node-addon-require-builtin-${suffix}`);
}
/** Pack one staged tree into `outFile` (macOS AppleDouble files excluded). */
async function packStage(stage, outFile) {
	await rm(outFile, { force: true });
	const env = {
		...process.env,
		COPYFILE_DISABLE: "1"
	};
	await new Promise((resolve, reject) => {
		execFile("/usr/bin/tar", [
			"-czf",
			outFile,
			"-C",
			stage,
			"."
		], {
			env,
			timeout: 3e5,
			maxBuffer: 1048576
		}, (error, _stdout, stderr) => {
			if (error != null) reject(/* @__PURE__ */ new Error(`tar failed: ${stderr.toString().trim()}`));
			else resolve();
		});
	});
}
/** CLI entry for the release build script (see scripts/build-server-package.mjs). */
async function buildServerPackage(options) {
	const { createHash } = await import("node:crypto");
	const stage = join(options.outDir, `stage-${randomUUID().slice(0, 8)}`);
	try {
		const dshVersion = await stageDshPackage({
			...options,
			stage
		});
		await assertTargetOnly(stage, options.platform, options.arch, options.libc);
		const tag = artifactTag(options.platform, options.arch, options.libc);
		const file = join(options.outDir, artifactName(dshVersion, tag));
		await packStage(stage, file);
		const info = await stat(file);
		const sha256 = createHash("sha256").update(await readFile(file)).digest("hex");
		const manifest = {
			dshVersion,
			platformArch: artifactTag(options.platform, options.arch, options.libc),
			sha256,
			size: info.size,
			minNode: "v24.21.0"
		};
		await writeFile(`${file}.sha256`, `${sha256}  ${file.split("/").pop()}\n`);
		await writeFile(join(options.outDir, artifactName(dshVersion, tag).replace(/\.tar\.gz$/, ".manifest.json")), `${JSON.stringify(manifest, null, 2)}\n`);
		return {
			file,
			sha256,
			size: info.size,
			manifest
		};
	} finally {
		await rm(stage, {
			recursive: true,
			force: true
		}).catch(() => {});
	}
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
function sha256File(path) {
	return execLocal("shasum", [
		"-a",
		"256",
		path
	], 6e4).then((r) => {
		const line = r.stdout.split("\n")[0] ?? "";
		const hash = line.trim().split(/\s+/)[0] ?? "";
		if (r.code !== 0 || hash.length !== 64) throw new Error(`cannot hash ${path}: ${r.stderr || line}`);
		return hash;
	});
}
/** Machine architecture in Node tarball spelling. */
function nodeArchKey(machine) {
	return machine === "aarch64" || machine === "arm64" ? "arm64" : "x64";
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
/** Read one cached asset back by exact path (after a marker hit). */
async function cachedAssetIfReady(path) {
	try {
		const [info, ready] = await Promise.all([stat(path), readFile(`${path}.ready`, "utf8")]);
		const sha256 = ready.trim();
		if (!info.isFile() || sha256.length !== 64) return void 0;
		return {
			path,
			sha256,
			size: info.size,
			version: ""
		};
	} catch {
		return;
	}
}
/** The server bundle's content hash — the `server` component's idempotency key. */
async function sha256OfFiles(files) {
	const hash = createHash("sha256");
	for (const file of files) {
		hash.update(file.path);
		hash.update("\0");
		hash.update(file.content);
	}
	return hash.digest("hex");
}
/**
* Locate a host-side pnpm launcher.
*
* The harness ships one under `~/.dsh/dsh-runtimes/<runtime>/dependencies/pnpm`
* with a matching Node; a PATH pnpm/node pair is the fallback.
*/
async function findHostPnpm() {
	const env = process.env;
	if (env.DSH_HOST_PNPM !== void 0 && env.DSH_HOST_NODE !== void 0) return {
		node: env.DSH_HOST_NODE,
		pnpm: env.DSH_HOST_PNPM
	};
	const runtimes = join(homedir(), ".dsh", "dsh-runtimes");
	for (const entry of await readdir(runtimes).catch(() => [])) {
		const pnpm = join(runtimes, entry, "dependencies", "pnpm", "bin", "pnpm.cjs");
		const node = join(runtimes, entry, "dependencies", "node", "bin", "node");
		const [pnpmOk, nodeOk] = await Promise.all([stat(pnpm).then((i) => i.isFile(), () => false), stat(node).then((i) => i.isFile(), () => false)]);
		if (pnpmOk && nodeOk) return {
			node,
			pnpm
		};
	}
	throw new Error("cannot find a host pnpm to stage the dsh runtime package");
}
/**
* Build (or fetch from the local cache) the server package for one target.
*
* Staging runs on the host with the exact harness version — the remote never
* talks to a registry, and the deployed bytes can never drift from the host
* version. The staging/packing implementation lives in `package-build.ts` and
* is shared with the release CI script; a GitHub Release download can replace
* the local staging per the target's package-source policy.
*/
async function buildDshRuntimePackage(options) {
	const notify = options.onProgress ?? (() => {});
	const tag = artifactTag(options.platform, options.arch, options.libc);
	const dir = remoteAssetsCacheDir();
	await mkdir(dir, { recursive: true });
	const cached = join(dir, artifactName(options.version, tag));
	const ready = `${cached}.ready`;
	try {
		const [info, marker] = await Promise.all([stat(cached), readFile(ready, "utf8").catch(() => "")]);
		if (info.isFile() && info.size > 1048576) {
			const sha256 = await sha256File(cached);
			if (marker.trim() === sha256) {
				notify(`dsh server package ${options.version} cached (${(info.size / 1024 / 1024).toFixed(1)} MB)`);
				return {
					path: cached,
					sha256,
					size: info.size,
					version: options.version
				};
			}
		}
	} catch {}
	const tool = await findHostPnpm();
	const built = await buildServerPackage({
		version: options.version,
		platform: options.platform,
		arch: options.arch,
		libc: options.libc,
		outDir: dir,
		nodeBin: tool.node,
		pnpmCjs: tool.pnpm,
		onProgress: notify
	});
	const sha256 = await sha256File(built.file);
	await writeFile(ready, `${sha256}\n`);
	return {
		path: built.file,
		sha256,
		size: built.size,
		version: options.version
	};
}
/** The GitHub release asset base for one version. */
function releaseAssetBase(mirror, version) {
	return `${mirror.replace(/\/+$/, "") || "https://github.com"}/graydove/dsh-remote-worspace/releases/download/server-v${version}`;
}
/** Download the release-built server package and verify it against its .sha256. */
async function downloadServerPackage(options) {
	const notify = options.onProgress ?? (() => {});
	const tag = artifactTag(options.platform, options.arch, options.libc);
	const name = artifactName(options.version, tag);
	const dir = remoteAssetsCacheDir();
	await mkdir(dir, { recursive: true });
	const cached = join(dir, name);
	const base = releaseAssetBase(options.mirror, options.version);
	notify(`downloading server package ${name} from ${new URL(`${base}/${name}`).host}`);
	const download = await execLocal("curl", [
		"-fL",
		"--retry",
		"2",
		"--connect-timeout",
		"20",
		"-m",
		"900",
		"-o",
		cached,
		`${base}/${name}`
	], 92e4);
	if (download.code !== 0) {
		await rm(cached, { force: true });
		throw new Error(`release download failed: ${(download.stderr || `curl exit ${download.code}`).trim().slice(-300)}`);
	}
	const shaFile = `${cached}.dsh-sha`;
	if ((await execLocal("curl", [
		"-fL",
		"--retry",
		"2",
		"--connect-timeout",
		"20",
		"-m",
		"60",
		"-o",
		shaFile,
		`${base}/${name}.sha256`
	], 8e4)).code !== 0) {
		await rm(cached, { force: true });
		throw new Error("release download succeeded but its .sha256 companion is missing; refusing an unverifiable package");
	}
	const expected = (await readFile(shaFile, "utf8")).trim().split(/\s+/)[0] ?? "";
	await rm(shaFile, { force: true });
	const actual = await sha256File(cached);
	if (expected.length !== 64 || expected !== actual) {
		await rm(cached, { force: true });
		throw new Error(`downloaded server package sha256 mismatch (expected ${expected || "none"}, got ${actual})`);
	}
	const info = await stat(cached);
	await writeFile(`${cached}.ready`, `${actual}\n`);
	notify(`server package downloaded (${(info.size / 1024 / 1024).toFixed(1)} MB)`);
	return {
		path: cached,
		sha256: actual,
		size: info.size,
		version: options.version
	};
}
/** The package-source resolution order for one policy. */
function sourceOrder(policy) {
	if (policy === "download") return [
		"cache",
		"download",
		"build"
	];
	if (policy === "upload") return ["cache", "build"];
	return [
		"cache",
		"download",
		"build"
	];
}
/**
* Resolve the server package per policy. Every source lands in the same local
* cache, so a policy change or a retry after a partial download never
* re-fetches what is already on disk.
*/
async function resolveServerPackage(options) {
	const notify = options.onProgress ?? (() => {});
	const tag = artifactTag(options.platform, options.arch, options.libc);
	const dir = remoteAssetsCacheDir();
	const hit = await cachedAssetIfReady(join(dir, artifactName(options.version, tag)));
	if (hit !== void 0) {
		notify(`server package ${options.version} cached (${(hit.size / 1024 / 1024).toFixed(1)} MB)`);
		return {
			asset: hit,
			via: "cache"
		};
	}
	const errors = [];
	for (const source of sourceOrder(options.policy)) {
		if (source === "cache") continue;
		try {
			if (source === "download") return {
				asset: await downloadServerPackage({ ...options }),
				via: "download"
			};
			return {
				asset: await buildDshRuntimePackage({ ...options }),
				via: "build"
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errors.push(`${source}: ${message}`);
			notify(`${source === "download" ? "release download" : "local build"} failed; trying the next source`, message);
		}
	}
	throw new Error(`could not obtain the server package ${artifactName(options.version, tag)}; attempts: ${errors.join(" ;; ")}`);
}
//#endregion
//#region src/provision/channel.ts
/**
* Provisioning one remote execution world.
*
* ZCode-shaped: every stage runs under `/bin/sh -c` with absolute paths, and
* the remote never depends on its own PATH, login shell or package manager
* for Node. The stages, each reported to the wizard:
*
* 1. **connect** — ssh2 with host-key verification; an unconfirmed key aborts
*    with the fingerprint so the user can decide, a *changed* key always aborts.
* 2. **probe**   — one framed shell probe: `$HOME`, `uname` (+ostype
*    correction), download tools, and the per-component markers.
* 3. **runtime** — the Node *component*: skipped when the marker matches and
*    the deployed binary verifies; otherwise the host-side cached tarball is
*    uploaded with live progress, sha-checked, extracted in staging and
*    atomically swapped in.
* 4. **upload**  — the `dsh` component (installed with the deployed node's own
*    npm) plus this plugin's lib and the profile files, all marker-gated.
* 5. **start**   — exec the deployed `dsh --profile` on its stdio, which
*    becomes the protocol channel.
*/
/** Remote stdio as a protocol channel, with a bounded stderr tail for diagnostics. */
var ServerChannel = class {
	stream;
	client;
	input;
	output;
	closed = false;
	tail = "";
	constructor(stream, client) {
		this.stream = stream;
		this.client = client;
		this.input = stream.stdout;
		this.output = stream;
		stream.stderr.on("data", (chunk) => {
			this.tail = `${this.tail}${chunk.toString("utf8")}`.slice(-8192);
		});
		stream.on("close", () => {
			this.closed = true;
		});
		stream.on("error", () => {
			this.closed = true;
		});
	}
	/** What the remote printed on stderr, scrubbed, for a failed startup report. */
	get diagnostics() {
		return scrubSecrets(this.tail.trim());
	}
	async close() {
		this.closed = true;
		if (!this.stream.destroyed) this.stream.end();
		this.client.end();
	}
};
/** Resolve a remote path that may start with `~`. */
function expandRemoteHome(path, home) {
	if (path === "~") return home;
	if (path.startsWith("~/")) return `${home}/${path.slice(2)}`;
	return path;
}
/** Build the ssh2 authentication material for a target. */
function authFor(target, secret, privateKey) {
	if (target.authKind === "password") {
		if (secret === void 0 || secret === "") throw new Error(`remote target "${target.label}" has no stored password`);
		return {
			kind: "password",
			password: secret
		};
	}
	if (target.authKind === "privateKey") {
		if (privateKey === void 0) throw new Error(`remote target "${target.label}" has no readable private key`);
		return {
			kind: "privateKey",
			privateKey,
			...secret === void 0 ? {} : { passphrase: secret }
		};
	}
	return { kind: "agent" };
}
/**
* The dsh release the remote must run: the harness's own version when known,
* else the installed dsh-ssh helper version (same release train), else latest.
*/
function dshReleaseVersion(packageRoot) {
	const env = process.env.DSH_CLIENT_VERSION;
	if (env !== void 0 && env !== "") return env;
	const candidates = [join(packageRoot, "node_modules", "@deepseek-ai", "dsh-ssh", "package.json"), join(packageRoot, "..", "@deepseek-ai", "dsh-ssh", "package.json")];
	for (const candidate of candidates) try {
		const helper = JSON.parse(readFileSync(candidate, "utf8"));
		if (typeof helper.version === "string" && helper.version !== "") return helper.version;
	} catch {}
	return "latest";
}
/** Throttled percentage reporter: at most one line per second or 5% jump. */
function progressReporter(label, emit) {
	let lastAt = 0;
	let lastPercent = -100;
	return (sent, total) => {
		const percent = total === 0 ? 100 : Math.floor(sent / total * 100);
		const now = Date.now();
		if (now - lastAt < 1e3 && percent - lastPercent < 5 && percent !== 100) return;
		lastAt = now;
		lastPercent = percent;
		const mb = (sent / 1024 / 1024).toFixed(1);
		const totalMb = (total / 1024 / 1024).toFixed(1);
		emit(`upload progress (${label}): ${percent.toFixed(1)}% (${mb}/${totalMb} MB)`);
	};
}
/**
* Connect, probe, deploy and start the remote server.
* @param request - target, credentials and progress sink.
* @returns the channel and the verified host-key fingerprint.
* @throws HostKeyUnknownError on first contact, HostKeyMismatchError on a changed key.
*/
async function provisionTarget(request) {
	const { target, onEvent } = request;
	const emit = (event) => {
		onEvent?.(event);
	};
	const notify = (step, message, detail) => {
		emit({
			type: "step",
			step,
			status: "running",
			message,
			...detail === void 0 ? {} : { detail }
		});
	};
	const signal = request.signal;
	signal?.throwIfAborted();
	emit({
		type: "step",
		step: "connect",
		status: "running",
		message: `connecting to ${target.host}:${target.port}`
	});
	const auth = authFor(target, request.secret, request.privateKey);
	const pinned = request.hostKeyFingerprint ?? target.hostKeyFingerprint;
	const client = await connectSsh({
		host: target.host,
		port: target.port,
		username: target.username,
		auth,
		...pinned === "" ? {} : { hostKeyFingerprint: pinned }
	});
	emit({
		type: "step",
		step: "connect",
		status: "ok"
	});
	let sftp = void 0;
	try {
		signal?.throwIfAborted();
		emit({
			type: "step",
			step: "probe",
			status: "running",
			message: "checking the remote host"
		});
		const probeResult = await execRemote(client, sh(probeScript()), {
			maxBytes: 65536,
			timeoutMs: 3e4
		});
		if (probeResult.code !== 0) throw new Error(`remote probe failed (exit ${probeResult.code ?? "signal"}): ${scrubSecrets(probeResult.stderr.slice(-2e3))}`);
		const facts = parseProbeOutput(probeResult.stdout);
		const home = facts.home;
		if (home === "" || !home.startsWith("/")) throw new Error(`cannot determine the remote home directory on ${target.host}`);
		const env = {
			...facts,
			platformArch: platformArch(facts.platform === "darwin" ? "darwin" : "linux", nodeArchKey(facts.arch))
		};
		const toolList = Object.entries(env.tools).filter(([, ok]) => ok).map(([name]) => name).join(", ");
		emit({
			type: "step",
			step: "probe",
			status: "ok",
			message: `${env.platform}-${env.arch} at ${home}${toolList === "" ? "" : ` (tools: ${toolList})`}`
		});
		let sftpTried = false;
		const ensureSftp = async () => {
			if (sftpTried) return sftp;
			sftpTried = true;
			try {
				sftp = await openSftp(client);
			} catch (error) {
				notify("runtime", "the remote SFTP subsystem is unavailable; falling back to exec-pipe uploads", String(error instanceof Error ? error.message : error));
			}
			if (sftp !== void 0) await ensureRemoteDirs({
				client,
				sftp
			}, home).catch(() => {});
			return sftp;
		};
		const installHome = home;
		const dshHome = expandRemoteHome(target.remote.dshHome, home);
		const profileName = target.remote.profile;
		signal?.throwIfAborted();
		emit({
			type: "step",
			step: "runtime",
			status: "running",
			message: "checking the deployed runtime"
		});
		const lockToken = randomUUID();
		let externalNode = false;
		const override = target.remote.nodePath;
		if (override !== "" && override !== "node") {
			const overridePath = expandRemoteHome(override, home);
			const check = await execRemote(client, sh(`p=${shellQuote(overridePath)}; if [ -x "$p" ]; then "$p" -v; else echo MISSING; fi`), {
				maxBytes: 256,
				timeoutMs: 2e4
			});
			const version = check.stdout.trim();
			if (check.code === 0 && version.startsWith("v2")) {
				externalNode = true;
				overridePath.slice(0, overridePath.lastIndexOf("/"));
				notify("runtime", `using the configured Node ${version} at ${overridePath}`);
			} else notify("runtime", `the configured Node at ${overridePath} is not usable (${version || "not executable"}); deploying a local one`);
		}
		let deployedNodeVersion = "";
		if (!externalNode) {
			const marker = env.node;
			let skip = false;
			if (marker !== void 0 && NODE_VERSION_CANDIDATES.includes(marker.version) && marker.platformArch === env.platformArch) {
				const verify = await execRemote(client, sh(`${shellQuote(serverPath(installHome, "node/bin/node"))} -v`), {
					maxBytes: 64,
					timeoutMs: 2e4
				});
				if (verify.code === 0 && verify.stdout.trim() === marker.version) {
					skip = true;
					deployedNodeVersion = marker.version;
					notify("runtime", `node ${marker.version} already deployed (marker match)`);
				} else notify("runtime", `the deployed node does not verify (${verify.stdout.trim() || "missing"}); redeploying`);
			}
			if (!skip) {
				await acquireDeployLock(client, installHome, lockToken);
				try {
					const asset = await ensureNodeTarball({
						platform: env.platform === "darwin" ? "darwin" : "linux",
						arch: env.arch === "arm64" ? "arm64" : "x64",
						onProgress: (message, detail) => notify("runtime", message, detail)
					});
					notify("runtime", `uploading node ${asset.version} (${(asset.size / 1024 / 1024).toFixed(1)} MB)`);
					const upload = await uploadNodeTarball({
						client,
						sftp: await ensureSftp()
					}, {
						home: installHome,
						content: await readFile(asset.path),
						version: asset.version,
						platformArch: env.platformArch
					}, progressReporter("node", (message) => notify("runtime", message)));
					await runDeployScript(client, extractNodeScript({
						home: installHome,
						version: asset.version,
						tarballName: upload.tarballName,
						distDir: upload.distDir,
						sha256: asset.sha256,
						platformArch: env.platformArch,
						shaTool: env.tools.sha256sum ? "sha256sum" : ""
					}), {
						what: "node deployment",
						timeoutMs: 3e5
					});
					deployedNodeVersion = asset.version;
					notify("runtime", `node ${asset.version} deployed to ${serverPath(installHome, "node")}`);
				} finally {
					await releaseDeployLock(client, installHome, lockToken);
				}
			}
			serverPath(installHome, "node/bin");
		}
		emit({
			type: "step",
			step: "runtime",
			status: "ok",
			message: externalNode ? "runtime ready (configured node)" : `node ${deployedNodeVersion} ready`
		});
		signal?.throwIfAborted();
		emit({
			type: "step",
			step: "upload",
			status: "running",
			message: "preparing the dsh runtime package"
		});
		const dshPath = serverPath(installHome, "dsh/node_modules/.bin/dsh");
		const release = dshReleaseVersion(request.packageRoot);
		const policy = request.packagePolicy ?? {
			policy: "auto",
			mirror: ""
		};
		const effective = target.packageSource !== void 0 && target.packageSource !== "auto" ? target.packageSource : policy.policy === "ask" ? "auto" : policy.policy;
		notify("upload", `server package required: dsh-remote-server-${release}-${artifactTag(env.platform === "darwin" ? "darwin" : "linux", env.arch === "arm64" ? "arm64" : "x64", env.libc)}.tar.gz`);
		const { asset: pkg, via: pkgVia } = await resolveServerPackage({
			version: release,
			platform: env.platform === "darwin" ? "darwin" : "linux",
			arch: env.arch === "arm64" ? "arm64" : "x64",
			libc: env.libc,
			policy: effective,
			mirror: policy.mirror,
			onProgress: (message, detail) => notify("upload", message, detail)
		});
		notify("upload", `server package ready via ${pkgVia}`);
		let needDshInstall = decideDsh(env.dsh, release, pkg.sha256) !== "skip";
		if (!needDshInstall) {
			const check = await execRemote(client, sh(checkDshScript({ home: installHome })), {
				maxBytes: 256,
				timeoutMs: 6e4
			});
			const version = check.stdout.trim();
			if (check.code === 0 && version !== "") notify("upload", `dsh ${version} already deployed (marker match)`);
			else {
				notify("upload", "the deployed dsh does not verify; redeploying");
				needDshInstall = true;
			}
		}
		if (needDshInstall) {
			await acquireDeployLock(client, installHome, lockToken);
			try {
				notify("upload", `uploading dsh ${release} package (${(pkg.size / 1024 / 1024).toFixed(1)} MB)`);
				const tarballName = `dsh-runtime-${release}-${env.platformArch}.tar.gz`;
				const file = {
					path: serverPath(installHome, `staging/${tarballName}`),
					content: await readFile(pkg.path)
				};
				const upSftp = await ensureSftp();
				if (upSftp !== void 0) await uploadRemoteFile(upSftp, file, progressReporter("dsh", (message) => notify("upload", message)));
				else {
					await writeRemoteFileViaExec(client, file);
					notify("upload", "dsh package uploaded (exec pipe)");
				}
				await runDeployScript(client, installDshPackageScript({
					home: installHome,
					version: release,
					sha256: pkg.sha256,
					tarballName
				}), {
					what: "dsh package deployment",
					timeoutMs: 3e5
				});
				notify("upload", `dsh ${release} deployed`, dshPath);
			} finally {
				await releaseDeployLock(client, installHome, lockToken);
			}
		}
		signal?.throwIfAborted();
		const profileFiles = [];
		const absoluteProfile = isAbsolute(dshHome) ? `${dshHome}/profiles/${profileName}` : join(home, `${dshHome}/profiles/${profileName}`);
		for (const [name, content] of remoteProfileFiles({ profile: profileName })) profileFiles.push({
			path: `${absoluteProfile}/${name}`,
			content: Buffer.from(content, "utf8")
		});
		const libFiles = await packageFiles(request.packageRoot);
		for (const file of libFiles) profileFiles.push({
			path: `${absoluteProfile}/${PROFILE_PACKAGE_DIR}/${file.path}`,
			content: file.content
		});
		const pluginSha = await sha256OfFiles(profileFiles);
		if (decidePlugin(env.plugin, pluginSha) === "skip") notify("upload", `profile and plugin already current (${profileFiles.length} files, marker match)`);
		else {
			notify("upload", `uploading profile and plugin (${profileFiles.length} files)`);
			await ensureSftp();
			await writeFiles({
				client,
				sftp
			}, profileFiles);
			await execRemote(client, sh(["set -eu", `printf %s ${shellQuote(`${JSON.stringify({
				id: "plugin",
				sha256: pluginSha
			})}\n`)} > ${shellQuote(serverPath(installHome, ".components/plugin.json"))}`].join("\n")), {
				maxBytes: 4096,
				timeoutMs: 15e3
			});
			notify("upload", `profile written to ${absoluteProfile}`);
		}
		emit({
			type: "step",
			step: "upload",
			status: "ok",
			message: `dsh at ${dshPath}`
		});
		signal?.throwIfAborted();
		emit({
			type: "step",
			step: "start",
			status: "running",
			message: `starting profile ${profileName}`
		});
		const stream = await openExecChannel(client, serverCommand({
			home: dshHome,
			installHome,
			profile: profileName
		}));
		const exited = new Promise((resolve) => {
			stream.once("exit", (code) => resolve({ code }));
			stream.once("close", () => resolve({ code: null }));
		});
		const survivor = await Promise.race([exited.then((result) => ({
			alive: false,
			...result
		})), new Promise((resolve) => setTimeout(() => resolve({ alive: true }), 8e3))]);
		if (!survivor.alive) {
			const tail = scrubSecrets(stream.stderr.read()?.toString() ?? "");
			throw new Error(`the remote server exited during startup (code ${survivor.code}): ${tail !== "" ? tail : "no stderr captured"}`);
		}
		const channel = new ServerChannel(stream, client);
		emit({
			type: "step",
			step: "start",
			status: "ok"
		});
		return {
			channel,
			fingerprint: request.hostKeyFingerprint ?? target.hostKeyFingerprint,
			nodePath: externalNode ? expandRemoteHome(target.remote.nodePath, home) : serverPath(installHome, "node/bin/node"),
			dshPath,
			home
		};
	} catch (error) {
		client.end();
		throw error;
	} finally {
		sftp?.end();
	}
}
/** Read a local private key file for a target, expanding `~`. */
async function readPrivateKey(path) {
	const expanded = path.startsWith("~/") ? join(homedir(), path.slice(2)) : resolve(path);
	return await readFile(expanded);
}
//#endregion
//#region src/provision/service.ts
/**
* The host-plane `remoteWorkspaces` service.
*
* It owns everything the realm must not see: `ssh2`, host-key decisions, profile
* provisioning, the wizard's progress stream, the target and workspace records,
* preset registration, and session creation with a remote working directory.
*/
/** A one-shot RPC client over a provisioned channel, used for browsing. */
var RemoteClient = class RemoteClient {
	mux;
	peer;
	channel;
	home;
	serverInfo;
	heartbeat;
	constructor(mux, peer, channel, home, serverInfo, heartbeat) {
		this.mux = mux;
		this.peer = peer;
		this.channel = channel;
		this.home = home;
		this.serverInfo = serverInfo;
		this.heartbeat = heartbeat;
	}
	static async open(channel, workspace, leaseMs = 3e4) {
		const mux = new FrameMux({
			transport: streamTransport(channel.input, channel.output),
			role: "client",
			label: "remote-browser"
		});
		const peer = new SshRpcPeer(mux.jsonInput(), mux.jsonOutput(), DEFAULT_MAX_FRAME_BYTES, 128);
		try {
			const hello = await peer.request("hello", {
				protocol: SSH_PROTOCOL_VERSION,
				workspace,
				leaseMs
			}, helloSchema, AbortSignal.timeout(2e4));
			const serverInfo = await peer.request("server.hello", {
				protocol: 2,
				clientVersion: "0.1.0-alpha11"
			}, z.object({
				protocol: z.literal(2),
				serverId: z.string(),
				installationId: z.string(),
				version: z.string(),
				workspacesRoot: z.string(),
				home: z.string().optional()
			}), AbortSignal.timeout(2e4)).catch(() => void 0);
			return new RemoteClient(mux, peer, channel, serverInfo?.home ?? hello.workspace, serverInfo, startHeartbeat());
		} catch (error) {
			peer.close();
			mux.close();
			await channel.close().catch(() => {});
			throw error;
		}
		/** Refresh the server lease periodically so an idle panel never triggers a full reprovision. */
		function startHeartbeat() {
			const timer = setInterval(() => {
				peer.request("heartbeat", {}, z.null(), AbortSignal.timeout(5e3)).catch(() => {});
			}, 1e4);
			timer.unref();
			return timer;
		}
	}
	request(method, params, schema, signal) {
		return this.peer.request(method, params, schema, signal);
	}
	async close() {
		clearInterval(this.heartbeat);
		await this.peer.request("close", {}, z.null(), AbortSignal.timeout(5e3)).catch(() => {});
		this.peer.close();
		this.mux.close();
		await this.channel.close().catch(() => {});
	}
};
var RemoteWorkspaces = class {
	ctx;
	store;
	tickets = /* @__PURE__ */ new Map();
	channels = /* @__PURE__ */ new Map();
	connecting = /* @__PURE__ */ new Map();
	browsers = /* @__PURE__ */ new Map();
	/** Serializes browsing operations per target; see {@link withBrowser}. */
	browserQueue = /* @__PURE__ */ new Map();
	/** Serializes resumes per session id; see {@link resumeSession}. */
	resumeQueue = /* @__PURE__ */ new Map();
	presetDisposers = /* @__PURE__ */ new Map();
	options;
	bootstrap;
	constructor(ctx, store, options) {
		this.ctx = ctx;
		this.store = store;
		this.options = {
			browseIdleMs: 0,
			...options
		};
	}
	/** Register presets for every stored target; safe to call more than once. */
	ensureWorlds() {
		this.bootstrap ??= (async () => {
			for (const target of this.store.listTargets()) await this.registerPreset(target).catch(() => {});
		})();
		return this.bootstrap;
	}
	/** Register (or re-register) one target's preset so a session can be composed. */
	async registerPreset(target) {
		const id = remotePresetId(target.id);
		const existing = this.presetDisposers.get(id);
		if (existing !== void 0) {
			await existing().catch(() => {});
			this.presetDisposers.delete(id);
		}
		const dispose = await this.ctx.agentPresets.register(remotePresetDefinition(target));
		this.presetDisposers.set(id, dispose);
	}
	/** Open a protocol channel to a target, starting its server when needed. */
	async connectChannel(targetId, signal) {
		const live = this.channels.get(targetId);
		if (live !== void 0 && !isClosed(live)) return live;
		const pending = this.connecting.get(targetId);
		if (pending !== void 0) return await pending;
		const attempt = this.connectOnce(targetId, signal);
		this.connecting.set(targetId, attempt);
		try {
			return await attempt;
		} finally {
			this.connecting.delete(targetId);
		}
	}
	async connectOnce(targetId, signal) {
		const target = this.store.target(targetId);
		if (target === void 0) throw new Error(`unknown remote target "${targetId}"`);
		if (target.hostKeyFingerprint === "") throw new Error(`remote target "${target.label}" has no confirmed host key; connect it from the wizard first`);
		const secret = await this.store.secretOf(target);
		const privateKey = target.privateKeyPath === void 0 ? void 0 : await readPrivateKey(target.privateKeyPath);
		const result = await provisionTarget({
			target,
			...secret === void 0 ? {} : { secret },
			...privateKey === void 0 ? {} : { privateKey },
			packageRoot: this.options.packageRoot,
			packagePolicy: this.store.packagePolicy(),
			...signal === void 0 ? {} : { signal }
		});
		if (result.fingerprint !== target.hostKeyFingerprint) await this.store.updateTarget(targetId, (current) => ({
			...current,
			hostKeyFingerprint: result.fingerprint,
			status: "ready",
			lastConnectedAt: (/* @__PURE__ */ new Date()).toISOString()
		}));
		else await this.store.updateTarget(targetId, (current) => ({
			...current,
			status: "ready",
			lastConnectedAt: (/* @__PURE__ */ new Date()).toISOString(),
			...current.lastError === void 0 ? {} : { lastError: void 0 }
		})).catch(() => {});
		this.channels.set(targetId, result.channel);
		await this.store.updateTarget(targetId, (record) => ({
			...record,
			status: "ready",
			lastConnectedAt: (/* @__PURE__ */ new Date()).toISOString()
		})).catch(() => {});
		return result.channel;
	}
	/** SHA-256 of the local server entry, compared with the remote handshake digest. */
	async expectedDigest(_targetId) {
		try {
			return createHash("sha256").update(await readFile(join$1(this.options.packageRoot, "lib", "server.js"))).digest("hex");
		} catch {
			return;
		}
	}
	/** Forget a target, its secret, its preset and any live channel. */
	async forgetTarget(targetId) {
		const live = this.channels.get(targetId);
		if (live !== void 0) {
			this.channels.delete(targetId);
			await live.close().catch(() => {});
		}
		const browser = this.browsers.get(targetId);
		if (browser !== void 0) {
			this.browsers.delete(targetId);
			await browser.client.close().catch(() => {});
		}
		const dispose = this.presetDisposers.get(remotePresetId(targetId));
		if (dispose !== void 0) {
			this.presetDisposers.delete(remotePresetId(targetId));
			await dispose().catch(() => {});
		}
		for (const workspace of this.store.listWorkspaces(targetId)) await this.forgetWorkspace(workspace.id);
		await this.store.deleteTarget(targetId);
	}
	/** Close any live channel for a target, leaving its records in place. */
	async stopTarget(targetId) {
		let stopped = false;
		const live = this.channels.get(targetId);
		if (live !== void 0) {
			this.channels.delete(targetId);
			await live.close().catch(() => {});
			stopped = true;
		}
		const browser = this.browsers.get(targetId);
		if (browser !== void 0) {
			this.browsers.delete(targetId);
			await browser.client.close().catch(() => {});
			stopped = true;
		}
		if (stopped) await this.store.updateTarget(targetId, (record) => ({
			...record,
			status: "stopped"
		})).catch(() => {});
		return stopped;
	}
	/** Every public target, newest state first. */
	listTargets() {
		return this.store.listTargets().map((record) => {
			const live = this.channels.get(record.id);
			const status = live !== void 0 && !isClosed(live) ? "ready" : record.status === "ready" ? "stopped" : record.status;
			return publicTarget({
				...record,
				status
			}, this.store);
		});
	}
	/** Every stored remote workspace. */
	listWorkspaces() {
		return this.store.listWorkspaces();
	}
	/** The plugin-wide package-source policy and release mirror. */
	getPackagePolicy() {
		return this.store.packagePolicy();
	}
	/** Replace the plugin-wide package-source policy. */
	async setPackagePolicy(settings) {
		await this.store.setPackagePolicy(settings);
	}
	beginConnect(request) {
		const id = randomUUID();
		this.tickets.set(id, {
			id,
			request,
			events: [],
			confirm: void 0,
			fingerprint: void 0,
			closed: false
		});
		return id;
	}
	/** Read a ticket for the SSE stream, or undefined when it expired. */
	ticket(id) {
		return this.tickets.get(id);
	}
	/** Drop a ticket; an open SSE stream observes `closed`. */
	releaseTicket(id) {
		const ticket = this.tickets.get(id);
		if (ticket === void 0) return;
		ticket.closed = true;
		ticket.confirm?.(ticket.fingerprint ?? "");
		this.tickets.delete(id);
	}
	/** Resolve a pending host-key confirmation. */
	confirmHostKey(id, fingerprint) {
		const ticket = this.tickets.get(id);
		if (ticket === void 0 || ticket.confirm === void 0) return false;
		if (ticket.fingerprint !== fingerprint) return false;
		const confirm = ticket.confirm;
		ticket.confirm = void 0;
		confirm(fingerprint);
		return true;
	}
	/**
	* Run one connection attempt, reporting progress.
	* @param id - ticket id.
	* @param emit - sink for progress events (an SSE writer).
	* @returns the stored target on success.
	*/
	async runConnect(id, emit) {
		const ticket = this.tickets.get(id);
		if (ticket === void 0) throw new Error("the connection attempt has expired");
		const request = ticket.request;
		const existing = this.store.listTargets().find((record) => record.label.toLowerCase() === request.label.toLowerCase());
		const remote = {
			nodePath: request.remote?.nodePath ?? "node",
			dshCommand: request.remote?.dshCommand ?? "dsh",
			profile: request.remote?.profile ?? "dsh-remote-server",
			dshHome: request.remote?.dshHome ?? "~/.dsh",
			plugins: request.remote?.plugins ?? []
		};
		let draft = {
			id: existing?.id ?? `rt-${randomUUID().slice(0, 8)}`,
			label: request.label,
			kind: "ssh",
			host: request.host,
			port: request.port,
			username: request.username,
			authKind: request.authKind,
			...request.privateKeyPath === void 0 ? {} : { privateKeyPath: request.privateKeyPath },
			...request.sshConfigAlias === void 0 ? {} : { sshConfigAlias: request.sshConfigAlias },
			...request.packageSource === void 0 ? {} : { packageSource: request.packageSource },
			hostKeyFingerprint: request.hostKeyFingerprint ?? existing?.hostKeyFingerprint ?? "",
			remote,
			status: "unknown",
			createdAt: existing?.createdAt ?? (/* @__PURE__ */ new Date()).toISOString()
		};
		const privateKey = draft.privateKeyPath === void 0 ? void 0 : await readPrivateKey(draft.privateKeyPath);
		let fingerprint = draft.hostKeyFingerprint;
		let provisioned;
		for (let attempt = 0; attempt < 2; attempt++) try {
			provisioned = await provisionTarget({
				target: draft,
				...request.secret === void 0 ? {} : { secret: request.secret },
				...privateKey === void 0 ? {} : { privateKey },
				packageRoot: this.options.packageRoot,
				packagePolicy: this.store.packagePolicy(),
				...fingerprint === "" ? {} : { hostKeyFingerprint: fingerprint },
				onEvent: (event) => {
					ticket.events.push(event);
					emit(event);
				}
			});
			break;
		} catch (error) {
			if (error instanceof HostKeyUnknownError && attempt === 0) {
				ticket.fingerprint = error.fingerprint;
				emit({
					type: "host-key",
					fingerprint: error.fingerprint
				});
				const confirmed = await new Promise((resolve) => {
					ticket.confirm = resolve;
					if (ticket.closed) resolve("");
				});
				if (ticket.closed || confirmed === "") throw new Error("host key was not confirmed");
				fingerprint = confirmed;
				draft = {
					...draft,
					hostKeyFingerprint: fingerprint
				};
				await this.store.putTarget(draft);
				continue;
			}
			throw error;
		}
		if (provisioned === void 0) throw new Error("the remote server could not be started");
		draft = {
			...draft,
			hostKeyFingerprint: provisioned.fingerprint === "" ? fingerprint : provisioned.fingerprint,
			status: "ready",
			lastConnectedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		if (request.secret !== void 0) draft = await this.store.storeSecret(draft, request.secret);
		else if (existing !== void 0) draft = await this.store.storeSecret(draft, "");
		await this.store.putTarget(draft);
		this.channels.set(draft.id, provisioned.channel);
		await this.registerPreset(draft);
		return publicTarget(draft, this.store);
	}
	/**
	* Run a command on a target over a dedicated SSH connection.
	* @param targetId - stored target.
	* @param command - POSIX command; interpolations must already be quoted.
	* @returns the exit facts and bounded output.
	*/
	async runCommand(targetId, command) {
		const target = this.store.target(targetId);
		if (target === void 0) throw new Error(`unknown remote target "${targetId}"`);
		const secret = await this.store.secretOf(target);
		const privateKey = target.privateKeyPath === void 0 ? void 0 : await readPrivateKey(target.privateKeyPath);
		const client = await connectSsh({
			host: target.host,
			port: target.port,
			username: target.username,
			auth: authFor(target, secret, privateKey),
			...target.hostKeyFingerprint === "" ? {} : { hostKeyFingerprint: target.hostKeyFingerprint }
		});
		try {
			return await execRemote(client, command, {
				maxBytes: 262144,
				timeoutMs: 2e4
			});
		} finally {
			client.end();
		}
	}
	/** Create a directory on a target, for step 4's "new folder". */
	async createDirectory(targetId, path) {
		if (!path.startsWith("/")) throw new Error("remote directories need an absolute path");
		const result = await this.runCommand(targetId, `mkdir -p ${shellQuote(path)}`);
		if (result.code !== 0) throw new Error(scrubSecrets(result.stderr.trim() || `mkdir failed with exit code ${result.code}`));
	}
	/**
	* List one remote directory through a browsing session.
	* @param targetId - stored target.
	* @param path - absolute remote path.
	* @returns the listing with its parent.
	*/
	async listDirectory(targetId, path) {
		return await this.withBrowser(targetId, async (client) => {
			const directory = await client.request("fs.resolve", { path: path === "" ? client.home : path }, targetSchema, AbortSignal.timeout(2e4));
			const listing = (await client.request("fs.list", { target: directory }, entriesSchema, AbortSignal.timeout(2e4))).map((entry) => ({
				name: entry.name,
				type: entry.type,
				path: entry.target.targetKey
			})).sort((left, right) => left.type === right.type ? left.name.localeCompare(right.name) : left.type === "directory" ? -1 : 1);
			const parent = path === "/" ? void 0 : leafParent(path);
			return {
				home: client.home,
				path: directory.targetKey,
				...parent === void 0 ? {} : { parent },
				entries: listing
			};
		});
	}
	/** Discover or create the official remote workspace record for a path. */
	async ensureRemoteWorkspace(targetId, path, title) {
		return await this.withBrowser(targetId, async (client) => {
			const schema = z.array(z.object({
				id: z.string().length(16),
				path: z.string(),
				title: z.string(),
				sessionCount: z.number(),
				createdAt: z.string()
			}));
			return {
				id: ((await client.request("reg.list", {}, schema, AbortSignal.timeout(2e4))).find((item) => item.path === path) ?? await client.request("reg.create", {
					path,
					...title === void 0 ? {} : { title }
				}, schema.element, AbortSignal.timeout(2e4))).id,
				...client.serverInfo === void 0 ? {} : { serverId: client.serverInfo.serverId }
			};
		});
	}
	/**
	* Run one browse operation on the cached session, retrying once on a
	* channel that died while idle: the remote server's lease outlives nothing,
	* so a >leaseMs pause can invalidate the cached client between calls. The
	* retry rebuilds the channel (marker-fast) and the user sees one slow
	* operation instead of an error toast.
	*/
	async withBrowser(targetId, operation) {
		const attempt = (this.browserQueue.get(targetId) ?? Promise.resolve()).then(async () => {
			try {
				return await operation(await this.browserFor(targetId));
			} catch (first) {
				const entry = this.browsers.get(targetId);
				if (entry === void 0) throw first;
				this.browsers.delete(targetId);
				await entry.client.close().catch(() => {});
				return await operation(await this.browserFor(targetId));
			}
		});
		this.browserQueue.set(targetId, attempt.then(() => void 0, () => void 0));
		return await attempt;
	}
	/**
	* Reuse or open the wizard's browsing session for one target.
	*
	* Deliberately NO idle teardown (ZCode parity: `windowRemoteConnectionRegistry`
	* never idle-disposes SSH entries — only its WSL flavour had one). The
	* channel and its remote server live until 停止/忘记/host exit/channel
	* failure; the client heartbeat only renews the process lease.
	*/
	async browserFor(targetId) {
		const cached = this.browsers.get(targetId);
		if (cached !== void 0) return cached.client;
		const channel = await this.connectChannel(targetId);
		const client = await RemoteClient.open(channel, "/", this.options.leaseMs);
		this.browsers.set(targetId, { client });
		return client;
	}
	/** stub → remote aliases for every opened workspace of one target. */
	pathAliases(targetId) {
		return this.store.listWorkspaces(targetId).filter((record) => record.stubPath !== void 0).map((record) => ({
			stub: record.stubPath,
			remote: record.path
		}));
	}
	/**
	* The local stub a remote workspace is represented by.
	*
	* The routing persistence re-anchors every header it hands out on this path
	* (see `RemotePersistence`): consumers realpath/`stat` a session's cwd, so a
	* remote path would make the session unattachable and unreopenable locally.
	*/
	stubForWorkspace(workspaceId) {
		return this.store.listWorkspaces().find((candidate) => candidate.remoteWorkspaceId === workspaceId)?.stubPath;
	}
	/**
	* Workspaces the *remote* dsh already has registered (`reg.list`).
	*
	* This is the 添加工作区 source for a host whose dsh installation carries the
	* server plugin: every workspace that dsh knows about can be adopted here
	* without browsing the filesystem.
	*/
	async listRemoteWorkspaces(targetId) {
		return await this.withBrowser(targetId, async (client) => await client.request("reg.list", {}, z.array(z.object({
			id: z.string().length(16),
			path: z.string(),
			title: z.string(),
			sessionCount: z.number(),
			createdAt: z.string()
		})), AbortSignal.timeout(2e4)));
	}
	/**
	* Sessions stored on the remote server for one workspace (`persist.list`).
	* @param targetId - stored target.
	* @param workspaceRecordId - the plugin's own workspace record id.
	*/
	async listRemoteSessions(targetId, workspaceRecordId) {
		const record = this.store.workspace(workspaceRecordId);
		if (record === void 0) throw new Error(`unknown remote workspace "${workspaceRecordId}"`);
		const workspaceId = record.remoteWorkspaceId;
		if (workspaceId === void 0) return [];
		const summaries = await this.sessionRequest(targetId, "persist.list", { workspaceId });
		const titles = /* @__PURE__ */ new Map();
		try {
			const rows = await this.sessionRequest(targetId, "persist.titles", { workspaceId });
			for (const row of rows) titles.set(String(row.id), {
				title: row.title,
				...row.updatedAt === void 0 ? {} : { updatedAt: row.updatedAt }
			});
		} catch {}
		return summaries.map((summary) => {
			const meta = titles.get(String(summary.id));
			return {
				id: String(summary.id),
				...summary.createdAt === void 0 ? {} : { createdAt: summary.createdAt },
				...summary.sizeBytes === void 0 ? {} : { sizeBytes: summary.sizeBytes },
				...meta === void 0 || meta.title === "" ? {} : { title: meta.title },
				...meta?.updatedAt === void 0 ? {} : { updatedAt: meta.updatedAt }
			};
		}).sort((left, right) => (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0));
	}
	/** The remote workspace a stub-cwd session belongs to (routing persistence). */
	routeForCwd(cwd) {
		if (cwd === void 0) return void 0;
		const record = this.store.listWorkspaces().find((candidate) => candidate.stubPath === cwd);
		const workspaceId = record?.remoteWorkspaceId;
		if (record === void 0 || workspaceId === void 0) return void 0;
		return {
			targetId: record.targetId,
			workspaceId
		};
	}
	/**
	* Which remote workspace owns one stored session. Only targets with a live
	* channel are probed: an offline server must not be spun up by a read.
	*/
	async locateRemoteSession(sessionId) {
		for (const targetId of this.channels.keys()) try {
			const result = await this.withBrowser(targetId, (client) => client.request("persist.locate", { sessionId }, z.object({ workspaceId: z.string().nullable() }), AbortSignal.timeout(2e4)));
			if (result.workspaceId !== null && result.workspaceId !== "") return {
				targetId,
				workspaceId: result.workspaceId
			};
		} catch {}
	}
	/** One administrative RPC to the target's server (persist.* plane). */
	async sessionRequest(targetId, method, params, signal) {
		const call = async () => await this.withBrowser(targetId, async (client) => await client.request(method, params, z.unknown(), signal));
		try {
			return await call();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const workspaceId = params.workspaceId;
			if (!/unknown remote workspace/i.test(message) || typeof workspaceId !== "string") throw error;
			const record = this.store.listWorkspaces(targetId).find((candidate) => candidate.remoteWorkspaceId === workspaceId);
			if (record === void 0) throw error;
			await this.ensureRemoteWorkspace(targetId, record.path, record.title).catch(() => {});
			return await call();
		}
	}
	/**
	* Create a fresh session in a remote directory.
	* @param targetId - stored target.
	* @param path - absolute remote directory.
	* @param title - display title; defaults to the last path segment.
	* @returns the workspace record and the session that now runs in it.
	*/
	async openWorkspace(targetId, path, title) {
		const target = this.requireConnectedTarget(targetId, "creating a session");
		const listing = await this.listDirectory(targetId, path);
		const materialized = await this.materializeWorkspace(target, listing.path, title);
		const opened = await openRemoteSession(this.ctx, {
			targetId,
			path: materialized.stub
		});
		return await this.finishOpen(materialized, opened.sessionId);
	}
	/**
	* Adopt one *stored* remote session — the 换设备续聊 path.
	*
	* Nothing is seeded: the authoritative log lives on the remote server and the
	* official resume flow reads it back through the routing persistence. The
	* workspace record (and its stub) must exist first, because the resumed
	* header is re-anchored on that stub and the official workspace validates it
	* against its own path.
	*
	* @param targetId - stored target.
	* @param path - absolute remote workspace directory.
	* @param sessionId - stored remote session id.
	* @param title - display title; defaults to the last path segment.
	*/
	async resumeSession(targetId, path, sessionId, title) {
		const attempt = (this.resumeQueue.get(sessionId) ?? Promise.resolve()).then(async () => await this.resumeSessionOnce(targetId, path, sessionId, title), async () => await this.resumeSessionOnce(targetId, path, sessionId, title));
		const tail = attempt.then(() => void 0, () => void 0);
		this.resumeQueue.set(sessionId, tail);
		try {
			return await attempt;
		} finally {
			if (this.resumeQueue.get(sessionId) === tail) this.resumeQueue.delete(sessionId);
		}
	}
	async resumeSessionOnce(targetId, path, sessionId, title) {
		const target = this.requireConnectedTarget(targetId, "continuing a session");
		const listing = await this.listDirectory(targetId, path);
		const materialized = await this.materializeWorkspace(target, listing.path, title);
		const opened = await resumeRemoteSession(this.ctx, {
			targetId,
			sessionId
		});
		return await this.finishOpen(materialized, opened.sessionId);
	}
	/** A target that must already have a live channel before a session can exist. */
	requireConnectedTarget(targetId, action) {
		const target = this.store.target(targetId);
		if (target === void 0) throw new Error(`unknown remote target "${targetId}"`);
		if (!this.channels.has(targetId)) {
			const error = /* @__PURE__ */ new Error(`remote target "${targetId}" is not connected; connect before ${action}`);
			error.code = "not-connected";
			throw error;
		}
		return target;
	}
	/**
	* Everything a session needs to exist for a remote directory: the server-side
	* workspace entry, the local stub directory, the shell-tree workspace and the
	* plugin's own record — in that order, and **persisted before any session is
	* created** (the routing persistence resolves `create(header.cwd)` and
	* re-anchors `open()` headers through this record, so an unmaterialized stub
	* would leave the session unroutable).
	*/
	async materializeWorkspace(target, path, title) {
		const existing = this.store.listWorkspaces(target.id).find((record) => record.path === path);
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const displayTitle = title ?? (path === "/" ? target.label : path.split("/").filter(Boolean).at(-1) ?? target.label);
		const remoteWorkspace = await this.ensureRemoteWorkspace(target.id, path, displayTitle);
		const registry = this.ctx.get("workspaceRegistry");
		const key = createHash("sha1").update(`${target.id}\u0000${path}`).digest("hex").slice(0, 8);
		const stubRoot = join$1(homedir(), ".dsh", "remote-workspaces", target.id);
		const stub = join$1(stubRoot, key);
		await mkdir(stub, { recursive: true });
		const canonicalStub = await realpath(stub);
		let official = await registry?.resolveByPath(canonicalStub);
		official ??= registry === void 0 ? void 0 : await registry.create(canonicalStub, `${displayTitle} · ${target.label}`).catch((error) => {
			console.error("[dsh-remote-workspace] registering the workspace in the shell tree failed", error);
		});
		const record = {
			...existing === void 0 ? {
				id: `rw-${randomUUID().slice(0, 8)}`,
				targetId: target.id,
				path,
				title: displayTitle,
				createdAt: now
			} : existing,
			...official === void 0 ? {} : {
				stubPath: official.path,
				officialWorkspaceId: official.id
			},
			remoteWorkspaceId: remoteWorkspace.id,
			...remoteWorkspace.serverId === void 0 ? {} : { serverId: remoteWorkspace.serverId }
		};
		await this.store.putWorkspace(record);
		return {
			record,
			official,
			stub: canonicalStub,
			now
		};
	}
	/** Attach the session to the shell workspace, remember it, and report it back. */
	async finishOpen(materialized, sessionId) {
		await materialized.official?.attachSession(sessionId).catch((error) => {
			console.error("[dsh-remote-workspace] attaching the session to the shell workspace failed", error);
		});
		const stored = {
			...materialized.record,
			lastOpenedAt: materialized.now,
			sessionId
		};
		await this.store.putWorkspace(stored);
		return {
			workspace: stored,
			sessionId
		};
	}
	/** Forget one stored remote workspace record (and its shell-tree entry). */
	async forgetWorkspace(workspaceId) {
		const record = this.store.workspace(workspaceId);
		const registry = this.ctx.get("workspaceRegistry");
		if (record?.officialWorkspaceId !== void 0) await registry?.delete(record.officialWorkspaceId).catch(() => {});
		if (record?.stubPath !== void 0) await rm(record.stubPath, {
			recursive: true,
			force: true
		}).catch(() => {});
		return await this.store.deleteWorkspace(workspaceId);
	}
	/** Close every channel and browsing session. */
	async dispose() {
		for (const browser of this.browsers.values()) await browser.client.close().catch(() => {});
		this.browsers.clear();
		for (const channel of this.channels.values()) await channel.close().catch(() => {});
		this.channels.clear();
		for (const ticket of this.tickets.values()) ticket.confirm?.("");
		this.tickets.clear();
	}
};
/** Public projection of a target record, with the stored-secret flag resolved. */
function publicTarget(record, store) {
	return {
		id: record.id,
		label: record.label,
		kind: record.kind,
		host: record.host,
		port: record.port,
		username: record.username,
		authKind: record.authKind,
		hasStoredSecret: store.credentialKeyOf(record) !== void 0,
		hostKeyFingerprint: record.hostKeyFingerprint,
		...record.sshConfigAlias === void 0 ? {} : { sshConfigAlias: record.sshConfigAlias },
		remote: record.remote,
		status: record.status,
		...record.lastError === void 0 ? {} : { lastError: scrubSecrets(record.lastError) },
		...record.lastConnectedAt === void 0 ? {} : { lastConnectedAt: record.lastConnectedAt }
	};
}
/** Parent directory of an absolute POSIX path. */
function leafParent(path) {
	const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
	const index = trimmed.lastIndexOf("/");
	return index <= 0 ? "/" : trimmed.slice(0, index);
}
/** A channel that already reported itself closed. */
function isClosed(channel) {
	return channel.closed === true;
}
/** Absolute local plugin package root, derived from this module's location. */
function packageRootFrom(moduleUrl) {
	return resolve(dirname(fileURLToPath(moduleUrl)), "..");
}
//#endregion
//#region src/index.ts
/**
* `dsh-remote-workspace` host row.
*
* It owns the target store, the per-target agent presets, the provisioning
* service and the wizard's HTTP surface. Nothing official is patched: the
* workspace button in the sidebar keeps its behaviour, and the remote-connection
* button is added as a new occupant of the declared `sidebar.footer.action` list
* slot (client half, `./client`).
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
	"agentDefaultModel",
	"webServer"
];
/** Validated configuration. */
const Config = Schema.object({
	serverProfile: Schema.string().default("dsh-remote-server").description("Remote profile name generated on the target host."),
	leaseMs: Schema.number().default(3e4).description("Remote server lease in milliseconds."),
	maxProcesses: Schema.number().default(128).description("Maximum remote process handles."),
	restoreTargets: Schema.boolean().default(true).description("Register presets for stored targets during startup.")
});
/** JSON request body, bounded like every other plugin route in this app. */
const MAX_BODY_BYTES = 1 << 20;
/** One JSON response. */
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(payload);
}
/** A refusal the browser can act on. */
var RouteError = class extends Error {
	code;
	status;
	constructor(code, message, status = 500) {
		super(message);
		this.code = code;
		this.status = status;
		this.name = "RouteError";
	}
};
/** Read and parse a bounded JSON body. */
async function readJsonBody(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = Buffer.from(chunk);
		total += buffer.length;
		if (total > MAX_BODY_BYTES) throw new RouteError("bad-request", "request body too large", 400);
		chunks.push(buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8").trim();
	if (text === "") return {};
	try {
		const parsed = JSON.parse(text);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new RouteError("bad-request", "request body must be a JSON object", 400);
		return parsed;
	} catch (error) {
		if (error instanceof RouteError) throw error;
		throw new RouteError("bad-request", "request body is not valid JSON", 400);
	}
}
/** Required string field. */
function requireString(body, field) {
	const value = body[field];
	if (typeof value !== "string" || value.trim() === "") throw new RouteError("bad-request", `"${field}" is required`, 400);
	return value.trim();
}
/** Optional string field. */
function optionalString(body, field) {
	const value = body[field];
	if (value === void 0 || value === null) return void 0;
	if (typeof value !== "string") throw new RouteError("bad-request", `"${field}" must be a string`, 400);
	return value.trim() === "" ? void 0 : value.trim();
}
/**
* Local trust fence.
*
* The webserver service itself enforces nothing, so a plugin route must repeat
* the `/api` gateway's DNS-rebinding and cross-site checks (see DSH
* `packages/client/connection/src/api-request-trust.ts`). This is not
* authentication: it keeps a hostile page on another origin from driving the
* plugin's privileged routes through the loopback interface.
*/
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
/** Register the plugin's routes and return a disposer. */
function registerRoutes(ctx, workspaces) {
	const disposers = [];
	disposers.push(ctx.webServer.register({
		kind: "prefix",
		path: `${ROUTE_PREFIX}/api`,
		handler: (req, res) => {
			handleApi(ctx, workspaces, req, res);
		}
	}));
	disposers.push(ctx.webServer.register({
		kind: "exact",
		path: `${ROUTE_PREFIX}/stream/connect`,
		handler: (req, res) => {
			handleConnectStream(workspaces, req, res);
		}
	}));
	return () => {
		for (const dispose of disposers.reverse()) dispose();
	};
}
/** Dispatch one API call. */
async function handleApi(ctx, workspaces, req, res) {
	try {
		if (!trustedRequest(ctx, req)) throw new RouteError("forbidden", "forbidden", 403);
		if (req.method !== "POST") throw new RouteError("method-error", "method not allowed", 405);
		const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
		const method = pathname.startsWith(`/dsh-remote-workspace/api/`) ? pathname.slice(`${ROUTE_PREFIX}/api/`.length) : void 0;
		if (method === void 0 || method === "") throw new RouteError("not-found", "unknown remote workspace method", 404);
		writeJson(res, 200, {
			ok: true,
			value: await dispatchApi(ctx, workspaces, method, await readJsonBody(req))
		});
	} catch (error) {
		if (error instanceof RouteError) {
			writeJson(res, error.status, {
				ok: false,
				error: {
					code: error.code,
					message: scrubSecrets(error.message)
				}
			});
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		const code = error.code;
		writeJson(res, 500, {
			ok: false,
			error: {
				code: typeof code === "string" ? code : "internal",
				message: scrubSecrets(message)
			}
		});
	}
}
/** The API surface the browser calls. */
/** This plugin's own package version, read once. */
let cachedPluginVersion = "";
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
/** Set when the storage domain failed to open at startup; /api/state reports it. */
let storageFailure = "";
/** Resolves once the storage domain is open (or failed); every API call awaits it
*  so a first-frame request can never race the plugin's own startup. */
let storageReady = Promise.resolve();
async function dispatchApi(ctx, workspaces, method, body) {
	await storageReady;
	switch (method) {
		case "state":
			if (storageFailure !== "") throw new RouteError("storage-unavailable", `plugin storage failed to open: ${storageFailure}`, 500);
			return {
				targets: workspaces.listTargets(),
				workspaces: workspaces.listWorkspaces(),
				pluginVersion: pluginVersion(),
				defaultProfile: "dsh-remote-server"
			};
		case "ssh-aliases": {
			const { aliases, warnings } = await listSshAliases();
			return {
				aliases,
				warnings: warnings.map(scrubSecrets)
			};
		}
		case "alias-prefill": {
			const alias = requireString(body, "alias");
			const { aliases } = await listSshAliases();
			const host = aliases.find((entry) => entry.alias.toLowerCase() === alias.toLowerCase());
			const resolution = await resolveSshAlias(alias);
			if (host === void 0 && resolution === void 0) throw new RouteError("not-found", `no ssh alias named "${alias}"`, 404);
			if (host === void 0) return {
				alias,
				host: resolution?.hostName ?? alias,
				port: resolution?.port ?? 22,
				...resolution?.user === void 0 ? {} : { username: resolution.user },
				...resolution?.identityFile === void 0 ? {} : { identityFile: resolution.identityFile },
				source: resolution?.origin ?? "config-file"
			};
			return prefillFromResolution(host, resolution);
		}
		case "connect/start": {
			const request = {
				label: requireString(body, "label"),
				host: requireString(body, "host"),
				port: typeof body.port === "number" ? body.port : Number.parseInt(requireString(body, "port"), 10),
				username: requireString(body, "username"),
				authKind: optionalString(body, "authKind") ?? "agent",
				...optionalString(body, "secret") === void 0 ? {} : { secret: optionalString(body, "secret") },
				...optionalString(body, "privateKeyPath") === void 0 ? {} : { privateKeyPath: optionalString(body, "privateKeyPath") },
				...optionalString(body, "sshConfigAlias") === void 0 ? {} : { sshConfigAlias: optionalString(body, "sshConfigAlias") },
				...optionalString(body, "hostKeyFingerprint") === void 0 ? {} : { hostKeyFingerprint: optionalString(body, "hostKeyFingerprint") },
				...optionalString(body, "packageSource") === void 0 ? {} : { packageSource: optionalString(body, "packageSource") },
				...body.remote === void 0 || typeof body.remote !== "object" ? {} : { remote: body.remote }
			};
			if (!Number.isInteger(request.port) || request.port < 1 || request.port > 65535) throw new RouteError("bad-request", "\"port\" must be between 1 and 65535", 400);
			return { ticket: workspaces.beginConnect(request) };
		}
		case "hostkey-confirm": {
			const ticket = requireString(body, "ticket");
			const fingerprint = requireString(body, "fingerprint");
			return { accepted: workspaces.confirmHostKey(ticket, fingerprint) };
		}
		case "package-policy-get": return { policy: workspaces.getPackagePolicy() };
		case "package-policy-set": {
			const raw = body.policy;
			if (raw === null || typeof raw !== "object") throw new RouteError("bad-request", "\"policy\" object is required", 400);
			const policy = raw;
			if (policy.policy !== void 0 && ![
				"auto",
				"download",
				"upload",
				"ask"
			].includes(policy.policy)) throw new RouteError("bad-request", "\"policy.policy\" must be auto|download|upload|ask", 400);
			if (policy.mirror !== void 0 && typeof policy.mirror !== "string") throw new RouteError("bad-request", "\"policy.mirror\" must be a string", 400);
			const current = workspaces.getPackagePolicy();
			const next = {
				policy: policy.policy ?? current.policy,
				mirror: typeof policy.mirror === "string" ? policy.mirror : current.mirror
			};
			await workspaces.setPackagePolicy(next);
			return { policy: next };
		}
		case "list-dir": return await workspaces.listDirectory(requireString(body, "targetId"), typeof body.path === "string" ? body.path : "");
		case "mkdir": {
			const path = requireString(body, "path");
			await workspaces.createDirectory(requireString(body, "targetId"), path);
			return { path };
		}
		case "open-workspace": {
			const opened = await workspaces.openWorkspace(requireString(body, "targetId"), requireString(body, "path"), optionalString(body, "title"));
			return {
				workspace: opened.workspace,
				sessionId: opened.sessionId
			};
		}
		case "open-session": {
			const opened = await workspaces.resumeSession(requireString(body, "targetId"), requireString(body, "path"), requireString(body, "sessionId"), optionalString(body, "title"));
			return {
				workspace: opened.workspace,
				sessionId: opened.sessionId
			};
		}
		case "remote-workspaces": return { workspaces: await workspaces.listRemoteWorkspaces(requireString(body, "targetId")) };
		case "sessions": return { sessions: await workspaces.listRemoteSessions(requireString(body, "targetId"), requireString(body, "workspaceId")) };
		case "forget-target":
			await workspaces.forgetTarget(requireString(body, "targetId"));
			return { forgotten: true };
		case "forget-workspace": {
			const id = requireString(body, "workspaceId");
			return { forgotten: await workspaces.forgetWorkspace(id) };
		}
		case "connect": {
			const targetId = requireString(body, "targetId");
			await workspaces.connectChannel(targetId);
			const target = workspaces.listTargets().find((candidate) => candidate.id === targetId);
			if (target === void 0) throw new RouteError("not-found", `unknown remote target "${targetId}"`, 404);
			return { target };
		}
		case "stop-target": return { stopped: await workspaces.stopTarget(requireString(body, "targetId")) };
		default: throw new RouteError("not-found", `unknown remote workspace method "${method}"`, 404);
	}
}
/** Server-sent events for one connection attempt. */
function handleConnectStream(workspaces, req, res) {
	const ticketId = new URL(req.url ?? "/", "http://dsh.internal").searchParams.get("ticket");
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.writeHead(405);
		res.end();
		return;
	}
	if (ticketId === null || ticketId === "") {
		res.writeHead(400, { "content-type": "application/json" });
		res.end(JSON.stringify({
			ok: false,
			error: {
				code: "bad-request",
				message: "ticket is required"
			}
		}));
		return;
	}
	const ticket = workspaces.ticket(ticketId);
	if (ticket === void 0) {
		res.writeHead(404, { "content-type": "application/json" });
		res.end(JSON.stringify({
			ok: false,
			error: {
				code: "not-found",
				message: "the connection attempt expired"
			}
		}));
		return;
	}
	res.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive"
	});
	res.write(": connected\n\n");
	const send = (event) => {
		if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
	};
	for (const event of ticket.events) send(event);
	const keepAlive = setInterval(() => {
		if (!res.writableEnded) res.write(": keep-alive\n\n");
	}, 15e3);
	keepAlive.unref();
	let finished = false;
	const finish = () => {
		if (finished) return;
		finished = true;
		clearInterval(keepAlive);
		if (!res.writableEnded) res.end();
	};
	res.on("close", () => {
		finish();
	});
	workspaces.runConnect(ticketId, (event) => {
		send(event);
	}).then((target) => {
		send({
			type: "done",
			target
		});
		finish();
	}, (error) => {
		const code = error.code;
		send({
			type: "error",
			code: typeof code === "string" ? code : "connect-failed",
			message: scrubSecrets(error instanceof Error ? error.message : String(error))
		});
		finish();
	}).finally(() => {
		workspaces.releaseTicket(ticketId);
	});
}
/**
* Wire the plugin.
* @param ctx - host context with `webServer`, storage and preset registry.
* @param config - tunables.
*/
function apply(ctx, config) {
	const store = new TargetStore(ctx);
	const workspaces = new RemoteWorkspaces(ctx, store, {
		packageRoot: packageRootFrom(import.meta.url),
		leaseMs: config.leaseMs,
		maxProcesses: config.maxProcesses
	});
	ctx.provide("remoteWorkspaces", {
		connectChannel: (targetId, signal) => workspaces.connectChannel(targetId, signal),
		expectedDigest: (targetId) => workspaces.expectedDigest(targetId),
		getPackagePolicy: () => workspaces.getPackagePolicy(),
		pathAliases: (targetId) => workspaces.pathAliases(targetId),
		setPackagePolicy: (settings) => workspaces.setPackagePolicy(settings),
		routeForCwd: (cwd) => workspaces.routeForCwd(cwd),
		stubForWorkspace: (workspaceId) => workspaces.stubForWorkspace(workspaceId),
		locateRemoteSession: (sessionId) => workspaces.locateRemoteSession(sessionId),
		sessionRequest: (targetId, method, params, signal) => workspaces.sessionRequest(targetId, method, params, signal)
	});
	new RoutingSessionPersistence(ctx, { root: join(homedir(), "sessions") });
	ctx.effect(() => () => {
		workspaces.dispose();
	}, "dsh-remote-workspace: provisioning");
	ctx.effect(() => () => {
		store.close();
	}, "dsh-remote-workspace: storage");
	ctx.effect(() => registerRoutes(ctx, workspaces), "dsh-remote-workspace: routes");
	storageReady = store.open().then(async () => {
		if (ctx.get("sessionPersistence")?.routingMarker !== Symbol.for("dsh-remote-workspace.routing-persistence")) ctx.logger.error("dsh-remote-workspace: the `session-persistence-jsonl` row override did not apply; remote sessions would be stored locally (see cordis.patch.yml deviation d13)");
	}).catch((error) => {
		storageFailure = scrubSecrets(error instanceof Error ? error.message : String(error));
		ctx.logger.error(`dsh-remote-workspace: startup failed: ${storageFailure}`);
	});
	storageReady.then(() => {
		if (config.restoreTargets) return workspaces.ensureWorlds();
	}).catch((error) => {
		ctx.logger.error(`dsh-remote-workspace: target restore failed: ${scrubSecrets(error instanceof Error ? error.message : String(error))}`);
	});
	ctx.logger.debug(`dsh-remote-workspace: home=${homedir()} routes=${join(ROUTE_PREFIX, "api")}`);
}
//#endregion
export { Config, ROUTE_PREFIX, apply, inject, name };
