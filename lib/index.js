import RoutingSessionPersistence from "./session-persistence.js";
import "./protocol.js";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, join as join$1, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Schema from "@deepseek-ai/schemastery";
import { execFile, spawn } from "node:child_process";
import { access, glob, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { z } from "zod";
import { credentialKey } from "@deepseek-ai/dsh-credentials";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { createHash, randomUUID } from "node:crypto";
import { SSH_PROTOCOL_VERSION, SshRpcPeer } from "@deepseek-ai/dsh-ssh/protocol";
import { entriesSchema, helloSchema, targetSchema } from "@deepseek-ai/dsh-ssh/schemas";
import { Duplex, PassThrough } from "node:stream";
import { normalizeSessionTitle } from "@deepseek-ai/dsh-session-title";
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
	"upload",
	"reuse"
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
* Remove values that look like credentials from free text.
*
* Applied to every error string, log line and HTTP/SSE payload the plugin emits,
* so a rejected SSH attempt cannot echo a password into the UI or a session log.
*/
function scrubSecrets(text) {
	return text.replace(/(password|passphrase|secret|token)(\s*[=:]\s*)\S+/gi, "$1$2***").replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted private key]").replace(/(?:^|\s)(?:ssh-rsa|ssh-ed25519|ecdsa-sha2-\S+)\s+[A-Za-z0-9+/=]{16,}/g, " [redacted public key]");
}
//#endregion
//#region src/ssh/wsl.ts
/**
* WSL transport: a local distro driven through `wsl.exe`.
*
* The host-side counterpart of `connect.ts` (ssh2). Everything the deployment
* needs from "the remote" is a POSIX shell, so the connection is
* `wsl.exe -d <distro> -- /bin/sh -c <body>` plus a long-lived child process
* whose stdio carries the protocol channel.
*
* Two measured facts shape this module:
*
* - `wsl.exe`'s own management output (`-l`, `--version`, `--status`) is
*   **UTF-16LE**, even for its errors; a command run *inside* the distro prints
*   UTF-8. Decoding both as UTF-8 yields NUL-interleaved garbage.
* - Distro names may contain spaces (`Ubuntu 22.04.3 LTS` comes from the Store),
*   so `-l -v` rows are parsed from the END of the line (STATE, VERSION) instead
*   of by column offsets.
*
* Discovered distros are read with `-l -v` only: that subcommand never starts a
* distribution, which is why opening a config panel cannot have the side effect
* of booting one.
*/
/**
* Transport timeline logging, enabled with `DSH_RW_DEBUG=1`.
*
* Off by default: it prints on every channel, and the questions it answers
* ("who closed the distro process", "did the command line survive") only come up
* when something breaks.
* @param message - line to print.
*/
function debug(message) {
	if (process.env.DSH_RW_DEBUG === "1") console.error(`[dsh-rw] ${message}`);
}
/** The Windows executable that owns every distro. */
const WSL_EXE = "wsl.exe";
/** Byte ceiling for one management/command result. */
const DEFAULT_MAX_BYTES = 262144;
/** Quote one value for the POSIX shell that runs inside the distro. */
function shellQuote$1(value) {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
/**
* Base argv that hands one distro a POSIX shell.
*
* `wsl.exe` re-parses the Windows command line, so a **multi-line** script
* passed through `-c` is silently mangled (measured: a 7-line body lost two of
* its commands, and the real failure surfaced as `zsh:12: unmatched "` — the
* distro's default shell had parsed half a script). Scripts therefore travel on
* stdin via `sh -s`; only short, single-line commands use `-c`.
* @param distro - distribution name.
* @param user - optional distro user.
*/
function wslShellArgs(distro, user) {
	return [
		"-d",
		distro,
		...user === void 0 || user === "" ? [] : ["--user", user],
		"--",
		"/bin/sh"
	];
}
/** argv for one script fed on stdin (`sh -s`), which is argv-safe for any body. */
function wslScriptArgs(distro, user) {
	return [...wslShellArgs(distro, user), "-s"];
}
/** argv for one single-line command (`sh -c`). */
function wslCommandArgs(distro, body, user) {
	return [
		...wslShellArgs(distro, user),
		"-c",
		body
	];
}
/**
* Parse `wsl.exe -l -v` output.
*
* The input is already decoded from UTF-16LE. Rows are `[*] <name> <STATE> <VER>`;
* the name is everything before the last two whitespace-separated tokens, and a
* row whose last token is not a number (a distro in `Installing`) carries only
* `[*] <name> <STATE>`.
* @param decoded - UTF-16LE-decoded stdout of `wsl.exe -l -v`.
* @returns the parsed distros, in wsl.exe's order (the default one first).
*/
function parseWslDistroList(decoded) {
	const distros = [];
	const lines = decoded.replaceAll("﻿", "").split(/\r?\n/);
	for (const rawLine of lines) {
		const line = rawLine.replaceAll("\0", "").trim();
		if (line === "") continue;
		if (/^NAME\s+STATE\b/i.test(line)) continue;
		const isDefault = line.startsWith("*");
		const body = (isDefault ? line.slice(1) : line).trim();
		if (body === "") continue;
		const tokens = body.split(/\s+/);
		if (tokens.length < 2) continue;
		const last = tokens[tokens.length - 1];
		const secondLast = tokens[tokens.length - 2];
		const version = /^\d+$/.test(last) ? Number(last) : void 0;
		const state = version === void 0 ? last : secondLast;
		const name = tokens.slice(0, version === void 0 ? -1 : -2).join(" ").trim();
		if (name === "") continue;
		distros.push({
			name,
			state,
			...version === void 0 ? {} : { version },
			default: isDefault
		});
	}
	return distros;
}
/** Spawn `wsl.exe` and collect bounded output, decoded per the caller's choice. */
function runWslManagement(args, options) {
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn(WSL_EXE, [...args], {
				windowsHide: true,
				stdio: [
					"ignore",
					"pipe",
					"pipe"
				]
			});
		} catch (error) {
			resolve({
				code: null,
				stdout: "",
				stderr: "",
				failed: `cannot start wsl.exe: ${String(error)}`
			});
			return;
		}
		const out = [];
		const err = [];
		let total = 0;
		const collect = (sink) => (chunk) => {
			total += chunk.length;
			if (total <= DEFAULT_MAX_BYTES) sink.push(chunk);
		};
		let settled = false;
		const settle = (value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(value);
		};
		const timer = setTimeout(() => {
			child?.kill();
			settle({
				code: null,
				stdout: "",
				stderr: "",
				failed: "wsl.exe did not answer in time"
			});
		}, options.timeoutMs);
		timer.unref?.();
		child.stdout?.on("data", collect(out));
		child.stderr?.on("data", collect(err));
		child.once("error", (error) => {
			settle({
				code: null,
				stdout: "",
				stderr: "",
				failed: error.code === "ENOENT" ? "wsl.exe was not found on this host" : `wsl.exe failed to start: ${error.message}`
			});
		});
		child.once("close", (code) => {
			settle({
				code,
				stdout: Buffer.concat(out).toString(options.encoding),
				stderr: Buffer.concat(err).toString(options.encoding)
			});
		});
	});
}
/** First non-empty line, trimmed — the actionable part of a wsl.exe error. */
function firstLine(text) {
	for (const line of text.replaceAll("\0", "").split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed !== "") return trimmed;
	}
	return "";
}
/**
* Discover installed distributions.
*
* Never starts a distro and never throws: an absent or disabled WSL reports
* `available: false` with a scrubbed reason so the wizard can show it inline.
* @returns the probe result.
*/
async function listWslDistros() {
	const result = await runWslManagement(["-l", "-v"], {
		timeoutMs: 1e4,
		encoding: "utf16le"
	});
	if (result.failed !== void 0) return {
		available: false,
		distros: [],
		error: scrubSecrets(result.failed)
	};
	if (result.code !== 0) {
		const detail = firstLine(result.stderr) || firstLine(result.stdout);
		return {
			available: false,
			distros: [],
			error: scrubSecrets(detail !== "" ? detail : `wsl.exe exited with code ${String(result.code)}`)
		};
	}
	return {
		available: true,
		distros: parseWslDistroList(result.stdout)
	};
}
/**
* Run one script inside a distro and collect bounded output.
*
* The script is written to the process's stdin (`sh -s`) instead of being passed
* through `-c`: `wsl.exe` re-parses the Windows command line, and a multi-line
* body loses lines (and can end up parsed by the distro's own default shell).
* @param distro - distribution name.
* @param body - POSIX shell script; callers must quote every interpolation.
* @param options - byte ceiling, deadline and optional distro user.
* @returns exit facts and captured output (UTF-8, as the distro prints it).
*/
async function wslExec(distro, body, options = {}) {
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	return await new Promise((resolve, reject) => {
		let child;
		try {
			child = spawn(WSL_EXE, wslScriptArgs(distro, options.user), {
				windowsHide: true,
				stdio: [
					"pipe",
					"pipe",
					"pipe"
				]
			});
		} catch (error) {
			reject(/* @__PURE__ */ new Error(`cannot start wsl.exe: ${scrubSecrets(String(error))}`));
			return;
		}
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
		let settled = false;
		const finish = (error, result) => {
			if (settled) return;
			settled = true;
			if (timer !== void 0) clearTimeout(timer);
			if (error !== void 0) reject(error);
			else resolve(result);
		};
		const timer = options.timeoutMs === void 0 ? void 0 : setTimeout(() => {
			child?.kill();
			finish(/* @__PURE__ */ new Error(`remote command timed out in distro "${distro}"`));
		}, options.timeoutMs);
		timer?.unref?.();
		child.stdout?.on("data", collect(stdout));
		child.stderr?.on("data", collect(stderr));
		child.once("error", (error) => {
			finish(/* @__PURE__ */ new Error(error.code === "ENOENT" ? "wsl.exe was not found on this host" : `the command inside distro "${distro}" failed to start: ${scrubSecrets(error.message)}`));
		});
		child.once("close", (code, signal) => {
			finish(void 0, {
				code,
				signal,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
				truncated
			});
		});
		child.stdin?.on("error", () => {});
		child.stdin?.end(body);
	});
}
/**
* Start one long-lived process inside a distro whose stdio is the protocol channel.
* @param distro - distribution name.
* @param body - the server command (a POSIX shell body).
* @param user - optional distro user.
* @returns the channel plus a diagnostics reader.
*/
function spawnWslChannel(distro, body, user) {
	const args = wslCommandArgs(distro, body, user);
	const child = spawn(WSL_EXE, args, {
		windowsHide: true,
		stdio: [
			"pipe",
			"pipe",
			"pipe"
		]
	});
	const t0 = Date.now();
	debug(`wsl spawn distro=${distro} pid=${String(child.pid)} argv=${JSON.stringify(args.slice(0, 4))} body=${JSON.stringify(body.slice(0, 300))}`);
	let tail = "";
	child.stderr?.on("data", (chunk) => {
		tail = `${tail}${chunk.toString("utf8")}`.slice(-8192);
	});
	child.stdin?.on("error", () => {});
	child.stdout?.on("error", () => {});
	child.stderr?.on("error", () => {});
	child.on("error", () => {});
	child.once("exit", (code, signal) => {
		debug(`wsl exit +${Date.now() - t0}ms code=${String(code)} signal=${String(signal)} tail=${JSON.stringify(tail.slice(-300))}`);
	});
	let closed = false;
	let ended = false;
	const exited = new Promise((resolveExit) => {
		child.once("close", (code, signal) => {
			ended = true;
			debug(`wsl close +${Date.now() - t0}ms code=${String(code)} signal=${String(signal)}`);
			resolveExit(code);
		});
	});
	return {
		channel: {
			input: child.stdout,
			output: child.stdin,
			get closed() {
				return ended || child.exitCode !== null || child.signalCode !== null;
			},
			close: async () => {
				if (!child.stdin?.destroyed && child.stdin?.writable) child.stdin.end();
				if (!closed) {
					closed = true;
					debug(`wsl channel.close() distro=${distro} code=${String(child.exitCode)} at=${(/* @__PURE__ */ new Error()).stack?.split("\n").slice(2, 5).join(" | ")}`);
					child.kill();
				}
			}
		},
		diagnostics: () => scrubSecrets(tail.trim()),
		exited
	};
}
/**
* Write one file into a distro by streaming bytes into the process's stdin.
*
* Deliberately not the ssh path's base64 heredoc: the Node distribution tarball
* is tens of megabytes, and a single base64 argument would exceed the kernel's
* `ARG_MAX`. A locally spawned child has stdin, so the bytes travel as a stream.
* @param distro - distribution name.
* @param path - absolute POSIX path inside the distro.
* @param content - file bytes.
* @param onProgress - byte progress sink.
* @param user - optional distro user.
*/
async function writeWslFile(distro, path, content, onProgress, user) {
	const body = `umask 022; command mkdir -p ${shellQuote$1(path.slice(0, path.lastIndexOf("/")) || "/")} && cat > ${shellQuote$1(path)}`;
	await new Promise((resolve, reject) => {
		const child = spawn(WSL_EXE, wslCommandArgs(distro, body, user), {
			windowsHide: true,
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			]
		});
		const errors = [];
		let settled = false;
		const finish = (error) => {
			if (settled) return;
			settled = true;
			if (error === void 0) resolve();
			else reject(error);
		};
		child.stderr?.on("data", (chunk) => {
			if (errors.length < 64) errors.push(chunk);
		});
		child.stdout?.on("data", () => {});
		child.once("error", (error) => {
			finish(/* @__PURE__ */ new Error(error.code === "ENOENT" ? "wsl.exe was not found on this host" : `cannot upload: ${scrubSecrets(error.message)}`));
		});
		child.once("close", (code) => {
			if (code === 0) {
				finish();
				return;
			}
			const detail = scrubSecrets(Buffer.concat(errors).toString("utf8").trim().slice(-2e3));
			finish(/* @__PURE__ */ new Error(`cannot write "${path}" in distro "${distro}" (exit ${String(code)}): ${detail !== "" ? detail : "no stderr output"}`));
		});
		const CHUNK = 262144;
		let offset = 0;
		const pump = () => {
			while (offset < content.length) {
				const end = Math.min(offset + CHUNK, content.length);
				const chunk = content.subarray(offset, end);
				offset = end;
				onProgress?.(offset, content.length);
				if (!child.stdin?.write(chunk)) {
					child.stdin?.once("drain", pump);
					return;
				}
			}
			child.stdin?.end();
		};
		child.stdin?.on("error", () => {});
		pump();
	});
}
//#endregion
//#region src/targets/methods.ts
/**
* Whether one method exists on a host platform.
* @param method - wizard method id.
* @param platform - `process.platform` of the harness host (`'win32'`, `'darwin'`, `'linux'`).
* @returns true when the method may be offered on that platform.
*/
function methodAvailable(method, platform) {
	if (method === "ssh") return true;
	if (method === "docker") return false;
	return platform === "win32";
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
	if (!isAbsolute(options.path)) throw new Error(`remote working directory must be absolute, received "${options.path}"`);
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
/**
* The package files the remote needs at run time.
*
* The returned `path` is the **remote** (POSIX) path, never a host one: on
* Windows `join('lib', 'server.js')` is `lib\server.js`, and using that as a
* remote path wrote the bundle to a file literally named `libserver.js` in the
* package root while the real `lib/server.js` kept an old build — which surfaced
* only as a protocol mismatch (`expected 1`) when the stale server answered.
*/
async function packageFiles(packageRoot) {
	const files = [];
	/** Read one file by its host path but record its POSIX remote path. */
	const push = async (hostRelative, remotePath = hostRelative) => {
		files.push({
			path: remotePath,
			content: await readFile(join(packageRoot, hostRelative))
		});
	};
	await push("package.json");
	await push("cordis.patch.yml");
	for (const name of await readdir(join(packageRoot, "lib"))) if (name.endsWith(".js") || name.endsWith(".mjs") || name.endsWith(".cjs")) await push(join("lib", name), `lib/${name}`);
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
/**
* The command that starts a **reused** dsh on its stdio.
*
* Why a PATH prefix rather than `node <launcher>`: the launcher we measured on
* Ubuntu 22.04 (the deployed `.bin/dsh`) is a `/bin/sh` wrapper whose last line
* is `exec node …`, so handing it to `node` as a script is not possible. Putting
* the interpreter's directory **first on `PATH`** starts both shapes — a JS
* launcher with `#!/usr/bin/env node` and that `/bin/sh` shim — with exactly the
* same command, and it is also what makes `candidates[].nodePath` meaningful
* (`doc/api-contract.md` §9.2's intent; the invocation differs only in form).
*
* `nodePath` is omitted for a self-contained (native) launcher: nothing needs to
* be on PATH, and the remote's own PATH must not be relied on.
* @param options - `DSH_HOME`, the launcher, the profile and the interpreter.
*/
function reuseServerCommand(options) {
	const dirs = [];
	if (options.nodePath !== void 0) {
		const nodeDir = options.nodePath.slice(0, options.nodePath.lastIndexOf("/"));
		if (nodeDir !== "") dirs.push(nodeDir);
		const launcherDir = options.launcher.includes("/") ? options.launcher.slice(0, options.launcher.lastIndexOf("/")) : "";
		if (launcherDir !== "" && !dirs.includes(launcherDir)) dirs.push(launcherDir);
	}
	return [
		`DSH_HOME=${shellQuote(options.dshHome)}`,
		...dirs.length === 0 ? [] : [pathAssignment(dirs)],
		`exec ${shellQuote(options.launcher)} --profile ${shellQuote(options.profile)}`
	].join(" ");
}
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
//#region src/provision/transport.ts
/**
* Connect over ssh2.
* @param options - host, credentials and the pinned host-key fingerprint.
* @returns a transport whose SFTP subsystem is opened lazily on first upload.
* @throws HostKeyUnknownError on first contact, HostKeyMismatchError on a changed key.
*/
async function connectSshTransport(options) {
	const client = await connectSsh(options);
	let sftp;
	let sftpTried = false;
	const sftpOrUndefined = async () => {
		if (sftpTried) return sftp;
		sftpTried = true;
		try {
			sftp = await openSftp(client);
		} catch {
			sftp = void 0;
		}
		return sftp;
	};
	let closed = false;
	return {
		kind: "ssh",
		exec: async (body, execOptions) => await execRemote(client, body, execOptions ?? {}),
		writeFile: async (path, content, onProgress) => {
			const session = await sftpOrUndefined();
			if (session !== void 0) {
				await uploadRemoteFile(session, {
					path,
					content
				}, onProgress);
				return;
			}
			await writeRemoteFileViaExec(client, {
				path,
				content
			});
			onProgress?.(content.length, content.length);
		},
		openChannel: async (body) => {
			const stream = await openExecChannel(client, body);
			let tail = "";
			stream.stderr.on("data", (chunk) => {
				tail = `${tail}${chunk.toString("utf8")}`.slice(-8192);
			});
			let ended = false;
			stream.once("close", () => {
				ended = true;
			});
			stream.once("error", () => {
				ended = true;
			});
			const exited = new Promise((resolveExit) => {
				let settled = false;
				const settle = (code) => {
					if (settled) return;
					settled = true;
					resolveExit(code);
				};
				stream.once("exit", (code) => {
					settle(code);
				});
				stream.once("close", () => {
					settle(null);
				});
			});
			return {
				channel: {
					input: stream.stdout,
					output: stream,
					get closed() {
						return ended || stream.destroyed;
					},
					close: async () => {
						ended = true;
						if (!stream.destroyed) stream.end();
						closed = true;
						client.end();
					}
				},
				diagnostics: () => scrubSecrets(tail.trim()),
				exited
			};
		},
		close: async () => {
			if (closed) return;
			closed = true;
			try {
				sftp?.end();
			} catch {}
			client.end();
		}
	};
}
/**
* Connect to one local WSL distribution.
*
* There is no handshake to verify: the transport is a process started on this
* machine, so the caller treats the target as trusted and never asks for a host
* key. Reachability is proven by the provisioning `connect` step, which runs a
* trivial command inside the distro.
* @param options - distribution name and optional distro user.
* @returns the transport; `close()` is a no-op because each channel owns its process.
*/
function connectWslTransport(options) {
	const { distro, user } = options;
	return {
		kind: "wsl",
		exec: async (body, execOptions) => await wslExec(distro, body, {
			...execOptions,
			...user === void 0 ? {} : { user }
		}),
		writeFile: async (path, content, onProgress) => {
			await writeWslFile(distro, path, content, onProgress, user);
		},
		openChannel: async (body) => spawnWslChannel(distro, body, user),
		close: async () => {}
	};
}
//#endregion
//#region src/provision/deploy.ts
/** The fixed remote installation root. */
const SERVER_ROOT = ".dsh/server";
/** Packaging mode's deployment lock, under {@link SERVER_ROOT}. */
const DEPLOY_LOCK_DIR = ".deploy.lock";
/**
* Reuse mode's marker file, **inside the profile directory**.
*
* Two marker locations exist because two install layouts do: a packaged
* deployment records `.components/plugin.json` under its own root, while a
* reused dsh keeps nothing but its profile — and both share the same
* `$DSH_HOME/profiles/<profile>`. The scan reads both (see `dsh-scan.ts`), so
* switching a target between the two modes never makes an installed plugin look
* missing. The relative layout is frozen by `doc/api-contract.md` §9.2.
*/
const PROFILE_MARKER_FILE = ".dsh-rw-plugin.json";
/** Reuse mode's deployment lock, inside the profile directory (same semantics as {@link DEPLOY_LOCK_DIR}). */
const PROFILE_LOCK_DIR = ".dsh-rw.lock";
/** How long a stale lock may sit before a new deploy reclaims it. */
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
* The platform/arch/libc rule, in one place.
*
* Both the pipeline probe (`parseProbeOutput`) and the read-only `dsh-scan`
* need it — the scan reports `uname`/`ostype`/`ldd` as separate records instead
* of the probe's framed segments — and two copies of "a Linux container may
* fake `uname -s`, `/proc/sys/kernel/ostype` tells the truth" would drift.
* @param options - the four raw facts.
* @returns the artifact-relevant platform classification.
*/
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
/**
* Fold the probe's separator-framed output into a {@link RemoteEnvironment}.
* Pure so the decision layer is unit-testable without a host.
*/
function parseProbeOutput(stdout) {
	const segments = stdout.split("@@RW@@").map((segment) => segment.trim());
	const home = (segments[0] ?? "").split("\n")[0] ?? "";
	const uname = (segments[1] ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
	const tools = (segments[3] ?? "").split("\n").map((line) => line.trim().split("/").pop() ?? "").filter(Boolean);
	const facts = probeFactsFrom({
		uname: uname[0] ?? "",
		machine: uname[1] ?? "",
		ostype: (segments[2] ?? "").split("\n")[0] ?? "",
		ldd: (segments[7] ?? "").split("\n")[0] ?? ""
	});
	return {
		home,
		platform: facts.platform,
		arch: facts.arch,
		libc: facts.libc,
		tools: {
			tar: tools.includes("tar"),
			sha256sum: tools.includes("sha256sum") || tools.includes("shasum"),
			curl: tools.includes("curl"),
			wget: tools.includes("wget")
		},
		node: parseMarker(segments[4]),
		dsh: parseMarker(segments[5]),
		plugin: parseMarker(segments[6]),
		profilePlugin: parseMarker(segments[8])
	};
}
/**
* The one-shot environment probe: facts only, framed by `@@RW@@` separators.
*
* The last segment is additive (reuse mode's profile marker). A profile name is
* schema-validated to `[a-z0-9-]`, but the script is built from it, so anything
* else simply omits the segment instead of interpolating.
* @param options - the profile whose reuse marker should be read, if any.
*/
function probeScript(options = {}) {
	const profile = options.profile ?? "";
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
		"ldd --version 2>&1 | head -1 || true",
		"printf '@@RW@@\\n'",
		.../^[a-z0-9][a-z0-9-]*$/.test(profile) ? [`cat ~/.dsh/profiles/${profile}/${PROFILE_MARKER_FILE} 2>/dev/null || true`] : []
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
	const launcher = `${target}/node_modules/.bin/dsh`;
	return [
		"set -eu",
		`echo '${options.sha256}  ${tarball}' | sha256sum -c - >/dev/null 2>&1 || { echo 'dsh package sha256 mismatch' >&2; exit 3; }`,
		`rm -rf ${q(extract)}`,
		`command mkdir -p ${q(extract)}`,
		`tar -xzf ${q(tarball)} -C ${q(extract)}`,
		`test -e ${q(`${extract}/node_modules/.bin/dsh`)} || { echo 'the dsh package has no launcher' >&2; exit 5; }`,
		`command chmod +x ${q(`${extract}/node_modules/.bin/dsh`)} 2>/dev/null || true`,
		`got=$(${pathAssignment([`${root}/node/bin`, `${extract}/node_modules/.bin`])} ${q(`${extract}/node_modules/.bin/dsh`)} --version | head -1)`,
		`[ -n "$got" ] || { echo 'the staged dsh launcher printed nothing (node too old for import.meta.main?)' >&2; exit 6; }`,
		`rm -rf ${q(target)} ${q(`${root}/prefix`)}`,
		`command mv -f ${q(extract)} ${q(target)}`,
		`command chmod +x ${q(launcher)} 2>/dev/null || true`,
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
		"test -e \"$d\" || exit 9",
		"command chmod +x \"$d\" 2>/dev/null || true",
		`${pathAssignment([`${root}/node/bin`, `${root}/dsh/node_modules/.bin`])} "$d" --version | head -1`
	].join("\n");
}
/**
* The lock-acquire body for one absolute lock directory.
*
* `mkdir` is the atomic test-and-set; a lock older than ten minutes is a crashed
* client and is reclaimed once. Shared by both layouts (packaging keeps its lock
* under the server root, reuse keeps one inside the profile directory) so the
* semantics can never diverge.
*/
function lockAcquireBody(lockDir, token) {
	const parent = lockDir.slice(0, lockDir.lastIndexOf("/"));
	return [
		"set -eu",
		`command mkdir -p ${q(parent)}`,
		`if command mkdir ${q(lockDir)} 2>/dev/null; then printf %s ${q(token)} > ${q(`${lockDir}/owner`)}; exit 0; fi`,
		`owner=$(cat ${q(`${lockDir}/owner`)} 2>/dev/null || true)`,
		`[ "$owner" = ${q(token)} ] && exit 0`,
		`age=$(( $(date +%s) - $(stat -c %Y ${q(lockDir)} 2>/dev/null || stat -f %m ${q(lockDir)} 2>/dev/null || echo 0) ))`,
		`if [ "$age" -gt ${Math.floor(LOCK_STALE_MS / 1e3)} ]; then`,
		`  rm -rf ${q(lockDir)}`,
		`  command mkdir ${q(lockDir)} && printf %s ${q(token)} > ${q(`${lockDir}/owner`)} && exit 0`,
		"fi",
		`echo "another deployment holds ${lockDir} (owner \${owner:-unknown}, \$age s old)" >&2`,
		"exit 8"
	].join("\n");
}
/** The lock-release body for one absolute lock directory (best effort). */
function lockReleaseBody(lockDir, token) {
	return [
		`[ -f ${q(`${lockDir}/owner`)} ] || exit 0`,
		`owner=$(cat ${q(`${lockDir}/owner`)})`,
		`[ "$owner" = ${q(token)} ] || exit 0`,
		`rm -rf ${q(lockDir)}`
	].join("\n");
}
/**
* Acquire the deployment lock. `mkdir` is the atomic test-and-set; a lock
* older than ten minutes is a crashed client and is reclaimed once.
*/
async function acquireDeployLock(transport, home, token) {
	const lockDir = `${home}/${SERVER_ROOT}/${DEPLOY_LOCK_DIR}`;
	const result = await transport.exec(sh(lockAcquireBody(lockDir, token)), {
		maxBytes: 4096,
		timeoutMs: 3e4
	});
	if (result.code !== 0) throw new Error(`cannot acquire the remote deploy lock: ${result.stderr.trim() || `exit ${result.code}`}`);
}
/** Release the deployment lock (best effort). */
async function releaseDeployLock(transport, home, token) {
	const lockDir = `${home}/${SERVER_ROOT}/${DEPLOY_LOCK_DIR}`;
	await transport.exec(sh(lockReleaseBody(lockDir, token)), {
		maxBytes: 4096,
		timeoutMs: 15e3
	}).catch(() => {});
}
/** The reuse-mode lock directory for one profile. */
function profileLockDir(profileDir) {
	return `${profileDir}/${PROFILE_LOCK_DIR}`;
}
/**
* The reuse-mode lock body, for callers that batch scripts themselves.
* @param options - the profile directory and this attempt's owner token.
*/
function profileLockScript(options) {
	return lockAcquireBody(profileLockDir(options.profileDir), options.token);
}
/** The reuse-mode unlock body. */
function profileUnlockScript(options) {
	return lockReleaseBody(profileLockDir(options.profileDir), options.token);
}
/**
* Acquire the reuse-mode lock.
*
* Same `mkdir` test-and-set, different scope: a reused dsh's profile is shared by
* every device that points at this host, so two connects can race the plugin
* file set. The lock lives **inside the profile directory** because that, not
* `~/.dsh/server`, is the only path a reuse deployment owns.
* @param transport - open transport.
* @param profileDir - absolute remote profile directory.
* @param token - this attempt's owner token.
*/
async function acquireProfileLock(transport, profileDir, token) {
	const result = await transport.exec(sh(profileLockScript({
		profileDir,
		token
	})), {
		maxBytes: 4096,
		timeoutMs: 3e4
	});
	if (result.code !== 0) throw new Error(`cannot acquire the remote profile lock: ${result.stderr.trim() || `exit ${result.code}`}`);
}
/** Release the reuse-mode lock (best effort). */
async function releaseProfileLock(transport, profileDir, token) {
	await transport.exec(sh(profileUnlockScript({
		profileDir,
		token
	})), {
		maxBytes: 4096,
		timeoutMs: 15e3
	}).catch(() => {});
}
/**
* The script that writes the reuse-mode plugin marker.
*
* Written **after** the file set is on disk, so a failed upload can never look
* current (same rule as every other marker in this module).
* @param options - profile directory, file-set digest, plugin version and profile name.
*/
function profilePluginScript(options) {
	const marker = {
		id: "plugin",
		sha256: options.sha256,
		version: options.version,
		profile: options.profile
	};
	return [
		"set -eu",
		`command mkdir -p ${q(options.profileDir)}`,
		`printf %s ${q(`${JSON.stringify(marker)}\n`)} > ${q(`${options.profileDir}/${PROFILE_MARKER_FILE}`)}`
	].join("\n");
}
/**
* The read-only script that measures one reuse launcher.
*
* Everything it needs is measured here rather than assumed, because the wizard's
* scan may be minutes old and the user may have picked a path that has since
* changed. `$DSHHOME/server/node/bin` leads `PATH` for the same measured reason
* the scan needs it: the uploaded dsh is a `/bin/sh` shim around `exec node`, and
* without that prefix its `--version` answers `exec: node: not found` (exit 127).
* @param options - the selected launcher and the deployment root that may hold a Node.
*/
function reuseLauncherScript(options) {
	const deployedNode = serverPath(options.installHome, "node/bin/node");
	return [
		"set -u",
		"export LC_ALL=C",
		`export ${pathAssignment([serverPath(options.installHome, "node/bin")])}`,
		`L=${q(options.launcherPath)}`,
		"printf '%s\\n' '@@RW@@REUSE@@1'",
		"if [ -e \"$L\" ]; then printf 'EXISTS\\t1\\n'; else printf 'EXISTS\\t0\\n'; fi",
		"if [ -x \"$L\" ]; then printf 'EXEC\\t1\\n'; else printf 'EXEC\\t0\\n'; fi",
		"real=$(readlink -f \"$L\" 2>/dev/null || printf '%s' \"$L\")",
		"  [ -n \"$real\" ] || real=$L",
		"printf 'REAL\\t%s\\n' \"$real\"",
		"sb=$(head -1 \"$real\" 2>/dev/null)",
		"case \"$sb\" in '#!'*) printf 'SHEBANG\\t1\\n' ;; *) printf 'SHEBANG\\t0\\n' ;; esac",
		"node=''",
		"case \"$sb\" in",
		"  '#!'*'/env node'*) node=$(command -v node 2>/dev/null || true) ;;",
		"  '#!'*'/env '*node*) node=$(command -v node 2>/dev/null || true) ;;",
		"  '#!'*node*) node=$(printf '%s' \"$sb\" | sed -e 's/^#![[:space:]]*//' -e 's/[[:space:]].*$//') ;;",
		"esac",
		"case \"$node\" in /*) ;; *) node='' ;; esac",
		"  [ -x \"$node\" ] || node=''",
		"printf 'NODE\\t%s\\n' \"$node\"",
		`if [ -x ${q(deployedNode)} ]; then printf 'DEPLOYED\\t%s\\n' ${q(deployedNode)}; else printf 'DEPLOYED\\t\\n'; fi`,
		"if [ -x \"$L\" ]; then",
		"  out=$(\"$L\" --version 2>/dev/null); code=$?",
		"  printf 'VERSION\\t%s\\n' \"$(printf '%s' \"$out\" | head -1)\"",
		"  printf 'CODE\\t%s\\n' \"$code\"",
		"else",
		"  printf 'VERSION\\t\\n'",
		"  printf 'CODE\\t127\\n'",
		"fi",
		"printf '%s\\n' 'END'"
	].join("\n");
}
/**
* Parse {@link reuseLauncherScript}'s records.
*
* Structural twin of `plan.ReuseLauncherFacts`: this module owns the shell side,
* `plan.ts` owns the decision, and neither imports the other's values.
* @param stdout - the script's stdout.
* @param launcherPath - the path that was probed (echoed back into the facts).
* @returns the facts, with conservative defaults for records that never arrived.
*/
function parseReuseLauncherOutput(stdout, launcherPath) {
	const values = /* @__PURE__ */ new Map();
	for (const line of stdout.split("\n").map((entry) => entry.replace(/\r$/u, ""))) {
		if (line === "" || line === "END") continue;
		const index = line.indexOf("	");
		if (index <= 0) continue;
		values.set(line.slice(0, index), line.slice(index + 1));
	}
	const codeText = values.get("CODE") ?? "";
	const exitCode = /^\d+$/.test(codeText) ? Number.parseInt(codeText, 10) : null;
	const node = values.get("NODE") ?? "";
	const deployed = values.get("DEPLOYED") ?? "";
	return {
		path: launcherPath,
		realPath: values.get("REAL") || launcherPath,
		exists: values.get("EXISTS") === "1",
		executable: values.get("EXEC") === "1",
		hasShebang: values.get("SHEBANG") === "1",
		version: values.get("VERSION") ?? "",
		exitCode,
		...node === "" ? {} : { nodePath: node },
		...deployed === "" ? {} : { deployedNode: deployed }
	};
}
/** Write small files (profile text, lib bundles) through the transport. */
async function writeFiles(transport, files) {
	for (const file of files) await transport.writeFile(file.path, file.content);
}
/** Upload the node tarball with progress, then run the extraction script. */
async function uploadNodeTarball(transport, options, onProgress) {
	const distDir = `node-${options.version}-${options.platformArch}`;
	const tarballName = `${distDir}.tar.gz`;
	const tarballPath = serverPath(options.home, `staging/${tarballName}`);
	await transport.writeFile(tarballPath, options.content, onProgress);
	return {
		tarballPath,
		tarballName,
		distDir
	};
}
/** Run one deployment step's script, surfacing the remote stderr verbatim. */
async function runDeployScript(transport, script, options) {
	const result = await transport.exec(sh(script), {
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
/**
* A usable `tar` for packing the staged tree.
*
* `/usr/bin/tar` is the POSIX default, but this build also has to run on a
* **Windows** host — WSL targets are Windows-only, so their server package is
* staged here too. Windows 10+ ships bsdtar as `tar.exe` on PATH, and it accepts
* the same `-czf … -C … .` invocation; without this fallback every Windows
* build died with ENOENT on `/usr/bin/tar`.
*/
function tarExecutable() {
	return existsSync("/usr/bin/tar") ? "/usr/bin/tar" : "tar";
}
/**
* How long one `tar` pass may take.
*
* Measured on a Windows host (bsdtar, alpha51): packing the staged dsh tree —
* ~31k entries, ~144 MB — needs **5–6 minutes**, and the old 300 s cap killed
* tar mid-stream. Because the archive used to be written *in place*, the result
* was a 135,659,520-byte `.tar.gz` that looked like an artifact but answered
* `tar -tzf: Truncated input file`, with empty stderr and no `.sha256` /
* `.manifest.json` next to it. 15 minutes keeps headroom for a slow disk while
* still bounding a hang.
*/
const PACK_TIMEOUT_MS = 9e5;
/** The production runner: `execFile` with {@link PACK_TIMEOUT_MS}. */
function runTar(options) {
	return new Promise((resolve) => {
		execFile(options.executable, [...options.args], {
			env: options.env,
			timeout: options.timeoutMs,
			maxBuffer: 1048576
		}, (error, _stdout, stderr) => {
			const failure = error;
			resolve({
				code: failure === null ? 0 : typeof failure.code === "number" ? failure.code : null,
				signal: failure?.signal ?? null,
				stderr: stderr?.toString() ?? ""
			});
		});
	});
}
/**
* Pack one staged tree into `outFile` (macOS AppleDouble files excluded).
*
* Two measured constraints:
*
* 1. **Pack into a per-run `<outFile>.<pid>-<rand>.partial`, publish with
*    `rename`.** A killed tar must not leave bytes at the final name:
*    `assets.cachedAssetIfReady` trusts file-size + the `.ready` digest and a
*    release upload trusts the file name, so a truncated archive at the final
*    path is a *silent* bad deployment. A failed run therefore leaves the
*    previous artifact untouched and removes only its own partial. The suffix is
*    unique per run because two connects can resolve the same artifact at the
*    same time (`assets.resolveServerPackage`): with a fixed `.partial` name each
*    would delete the other's in-progress archive. A crashed run can leave one
*    such file behind; it is never published, and `assets.pruneCache` reaps it.
* 2. **Name the reason on failure.** A timeout kills tar with empty stderr,
*    which is why the alpha51 failure read `tar failed: ` and had to be
*    diagnosed by measuring the output file. The signal and the pack budget are
*    now part of the message.
* @param stage - absolute path of the staged package tree.
* @param outFile - absolute path of the final archive.
* @param runner - tar invoker; tests inject a scripted one.
*/
async function packStage(stage, outFile, runner = runTar) {
	const partial = `${outFile}.${process.pid}-${randomUUID().slice(0, 8)}.partial`;
	let result;
	try {
		result = await runner({
			executable: tarExecutable(),
			args: [
				"-czf",
				partial,
				"-C",
				stage,
				"."
			],
			timeoutMs: PACK_TIMEOUT_MS,
			env: {
				...process.env,
				COPYFILE_DISABLE: "1"
			}
		});
	} catch (error) {
		await rm(partial, { force: true }).catch(() => {});
		throw error;
	}
	if (result.code !== 0) {
		await rm(partial, { force: true }).catch(() => {});
		const detail = result.stderr.trim();
		const cause = result.signal === null ? `exit ${result.code === null ? "unknown" : String(result.code)}` : `signal ${result.signal}`;
		throw new Error(`tar failed (${cause}; pack budget ${PACK_TIMEOUT_MS} ms): ${detail !== "" ? detail : "no stderr output"}`);
	}
	await rename(partial, outFile);
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
/**
* The most informative single line an error can give — never empty.
*
* `error.message` is empty for several `fs`/stream failures, and those were
* exactly the ones this module reported as `cannot hash <path>: ` (alpha52, on a
* Windows host): a diagnostic dead end. Fall back to the code, then the name.
*/
function errorReason$1(error) {
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
		throw new Error(`cannot hash ${path}: ${errorReason$1(error)}`);
	}
	return hash.digest("hex");
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
/**
* Budget for the REST transport: it is the one that really moves 121 MB.
*
* One hour, because the download has to survive a slow link: measured 12–45 KB/s
* to `api.github.com` from the QA host, i.e. ~45–170 minutes for a 121 MB package,
* so the earlier 15-minute cap made the download impossible there. Nothing can
* hang forever from this: `--speed-limit`/`--speed-time` is what detects a dead
* transfer, so a generous *total* budget costs nothing.
*/
const API_TIMEOUT_S = 3600;
/**
* The argv one `curl` fetch runs with.
*
* - `--retry 3 --retry-connrefused` — the reset/refused cases are transient here;
*   a retried request does succeed.
* - `--speed-limit 1024 --speed-time 30` — measured: a blocked `github.com:443`
*   does **not** fail fast, it sits at 0 bytes, and only this makes it give up in
*   half a minute so the API fallback runs.
* - `-m <budget>` — per transport (`RELEASE_PAGE_TIMEOUT_S` vs `API_TIMEOUT_S`).
* Exported so the flags are asserted instead of assumed.
* @param options - target url, optional output file, headers and time budget.
*/
function curlArgs(options) {
	return [
		"-fL",
		"--retry",
		"3",
		"--retry-connrefused",
		"--connect-timeout",
		"20",
		"--speed-limit",
		"1024",
		"--speed-time",
		"30",
		"-m",
		String(options.maxTimeSeconds ?? 180),
		...options.resume === true ? ["-C", "-"] : [],
		...(options.headers ?? []).flatMap((header) => ["-H", header]),
		...options.output === void 0 ? [] : ["-o", options.output],
		options.url
	];
}
/** The production runner: `curl -fL` into a file (or stdout), bounded by a timeout. */
const runCurl = async (options) => {
	const budgetMs = ((options.maxTimeSeconds ?? 180) + 60) * 1e3;
	const result = await execLocal("curl", curlArgs(options), budgetMs);
	return {
		code: result.code,
		stderr: result.stderr,
		stdout: result.stdout
	};
};
/**
* GitHub coordinates of the release that carries the server packages.
*
* The **server** repository, not this one: these tarballs are a dsh runtime
* world built by `dsh-remote-workspace-server`'s own CI
* (`.github/workflows/server-release.yml`), and that is where they are
* released. Publishing them from the client repository was wrong — it put the
* server project's artifacts behind the plugin's release page.
*/
const RELEASE_OWNER = "graydovee";
const RELEASE_REPO = "dsh-remote-workspace-server";
/** Browser-style release asset URL for one tag (the official, documented path). */
const HTML_BASE = "https://github.com";
/** REST base: reachable even where `github.com:443` is blocked (measured). */
const API_BASE = "https://api.github.com";
/**
* The release tags a server package may live under, in the order to try.
*
* Two names are legitimate, and neither is wrong:
*
* 1. `server-v<dshVersion>` — the long-term convention: the artifact is built for
*    one dsh release train, so the tag names that version.
* 2. `v<pluginVersion>` — releases cut with the plugin itself (the user tags
*    `v0.1.0-alphaN` and hangs the CI matrix on it). Without this candidate a
*    published release would be invisible to every client, because the client
*    looks up the *dsh* version, not the plugin's.
*
* The first candidate that answers wins; `.sha256` is fetched from the same tag as
* the artifact, never from a different one.
* @param dshVersion - the dsh release the package is built for.
* @param pluginVersion - this plugin's own version, when known.
*/
function releaseTagsFor(dshVersion, pluginVersion) {
	const tags = [`server-v${dshVersion}`];
	const plugin = pluginVersion?.trim() ?? "";
	if (plugin !== "" && !tags.includes(`v${plugin}`)) tags.push(`v${plugin}`);
	return tags;
}
/** The GitHub release asset base for one tag under a given host. */
function releaseAssetBase(host, tag) {
	return `${host}/${RELEASE_OWNER}/${RELEASE_REPO}/releases/download/${tag}`;
}
/** One transport's failure, kept short for the aggregated error message. */
function reasonOf(result) {
	return (result.stderr || `curl exit ${result.code}`).trim().split("\n").at(-1)?.slice(-160) ?? `curl exit ${result.code}`;
}
/** Hosts whose release page transport recently failed at the network level. */
const unreachableHosts = /* @__PURE__ */ new Map();
/**
* Whether a failure means "this host is unreachable" rather than "this asset/tag
* is missing".
*
* The distinction is the whole point: a 404 (`--fail` exit 22) proves the host
* answered, so the next tag must be tried normally; a blocked host instead hangs
* or resets. curl codes here: 6/7 resolution/connect, 28 timeout (also what
* `--speed-time` aborts with), 35 TLS handshake, 55/56 send/recv failure, 18
* partial transfer, 92 HTTP/2 stream error.
* @param result - the failed curl result.
*/
function isReleasePageUnreachable(result) {
	if (result.code === 22 || result.code === 0) return false;
	if ([
		6,
		7,
		18,
		28,
		35,
		55,
		56,
		92
	].includes(result.code)) return true;
	return /\(6\)|\(7\)|\(18\)|\(28\)|\(35\)|\(55\)|\(56\)|\(92\)|timed out|Recv failure|Connection (refused|reset)/i.test(result.stderr);
}
/** Remember that one host's release page is not usable right now. */
function markReleasePageUnreachable(host, now = Date.now()) {
	unreachableHosts.set(host, now);
}
/** Whether one host is still inside its "skip the release page" window. */
function releasePageMarkedUnreachable(host, now = Date.now()) {
	const markedAt = unreachableHosts.get(host);
	if (markedAt === void 0) return false;
	if (now - markedAt >= 6e5) {
		unreachableHosts.delete(host);
		return false;
	}
	return true;
}
/**
* When a download reports its size, and how often at most.
*
* A 121 MB package can take an hour on a slow link, so a silent progress line is
* indistinguishable from a hang (alpha65). The poller reads the `-o` target's size
* — curl's own stderr meter is not portable across versions — and reports at most
* twice a minute or every 20 MB, whichever comes first.
*/
const DOWNLOAD_PROGRESS_TICK_MS = 5e3;
const DOWNLOAD_PROGRESS_REPORT_MS = 15e3;
const DOWNLOAD_PROGRESS_STEP_BYTES = 20971520;
/** `12.3` for byte counts, in MB. */
function megabytes(bytes) {
	return (bytes / 1024 / 1024).toFixed(1);
}
/**
* Download one file and report success/failure without throwing.
*
* `onProgress` is invoked while the transfer runs (see
* {@link DOWNLOAD_PROGRESS_STEP_BYTES}); failures delete the target so a partial
* file can never be mistaken for a cached artifact.
*/
async function fetchTo(runner, url, output, options = {}) {
	let finished = false;
	/** Wakes the poller's sleep when the transfer ends, so it never adds latency. */
	let wake;
	let poller;
	if (options.onProgress !== void 0) {
		const onProgress = options.onProgress;
		const tickMs = options.progressIntervalMs ?? DOWNLOAD_PROGRESS_TICK_MS;
		poller = (async () => {
			let lastBytes = 0;
			let lastReportAt = Date.now();
			while (!finished) {
				await new Promise((resolve) => {
					const timer = setTimeout(resolve, tickMs);
					timer.unref?.();
					wake = () => {
						clearTimeout(timer);
						resolve();
					};
				});
				wake = void 0;
				if (finished) return;
				const size = await stat(output).then((info) => info.size, () => 0);
				const now = Date.now();
				if (size <= lastBytes) continue;
				if (size - lastBytes < DOWNLOAD_PROGRESS_STEP_BYTES && now - lastReportAt < DOWNLOAD_PROGRESS_REPORT_MS) continue;
				lastBytes = size;
				lastReportAt = now;
				onProgress(size, options.totalBytes);
			}
		})();
	}
	try {
		const result = await runner({
			url,
			output,
			...options.headers === void 0 ? {} : { headers: options.headers },
			...options.maxTimeSeconds === void 0 ? {} : { maxTimeSeconds: options.maxTimeSeconds },
			...options.resume === true ? { resume: true } : {}
		});
		if (result.code === 0) return {
			ok: true,
			result
		};
		if (options.keepPartial !== true) await rm(output, { force: true });
		return {
			ok: false,
			result
		};
	} finally {
		finished = true;
		wake?.();
		await poller?.catch(() => {});
	}
}
/**
* Verify a downloaded artifact against its companion and mark the cache ready.
*
* A body that does not match its own `.sha256` is a **hard failure**: the tag
* exists and its companion disagrees, so trying another transport (or tag) would
* only hide a bad publish.
*/
async function verifyDownload(cached, shaFile, releaseTag, transport) {
	const expected = (await readFile(shaFile, "utf8")).trim().split(/\s+/)[0] ?? "";
	await rm(shaFile, { force: true });
	const actual = await sha256File(cached);
	if (expected.length !== 64 || expected !== actual) {
		await rm(cached, { force: true });
		throw new Error(`downloaded server package sha256 mismatch for release ${releaseTag} via ${transport} (expected ${expected || "none"}, got ${actual})`);
	}
	const info = await stat(cached);
	await writeFile(`${cached}.ready`, `${actual}\n`);
	return {
		path: cached,
		sha256: actual,
		size: info.size,
		version: ""
	};
}
/** The subset of the release JSON this module reads. */
function assetsOf(json) {
	try {
		const parsed = JSON.parse(json);
		if (!Array.isArray(parsed.assets)) return void 0;
		return parsed.assets.filter((asset) => typeof asset === "object" && asset !== null && typeof asset.id === "number" && typeof asset.name === "string").map((asset) => ({
			id: asset.id,
			name: asset.name,
			...typeof asset.size === "number" ? { size: asset.size } : {}
		}));
	} catch {
		return;
	}
}
/**
* Download the release-built server package and verify it against its `.sha256`.
*
* Two transports are tried **per candidate tag**, because a published release is
* only useful if the client can actually reach it:
*
* 1. the browser-style release URL on `github.com` (the documented path);
* 2. the REST API (`/releases/tags/<tag>` → `assets[].id` → `/releases/assets/<id>`
*    with `Accept: application/octet-stream`). Measured on the QA host:
*    `github.com:443` times out there while `api.github.com` answers 200
*    unauthenticated.
*
* A configured `mirror` disables the API transport: a mirror is not necessarily
* GitHub, so only the mirror URL is tried.
* @param options - release/arch, mirror, tag candidates and test seams.
*/
async function downloadServerPackage(options) {
	const notify = options.onProgress ?? (() => {});
	const runner = options.runner ?? runCurl;
	const now = options.now ?? Date.now;
	const tag = artifactTag(options.platform, options.arch, options.libc);
	const name = artifactName(options.version, tag);
	const dir = options.cacheDir ?? remoteAssetsCacheDir();
	await mkdir(dir, { recursive: true });
	const cached = join(dir, name);
	const shaFile = `${cached}.dsh-sha`;
	const tags = options.releaseTags ?? releaseTagsFor(options.version, options.pluginVersion);
	const mirror = options.mirror.replace(/\/+$/, "");
	const failures = [];
	const skipHtml = mirror === "" && releasePageMarkedUnreachable(HTML_BASE, now());
	if (skipHtml) notify("release page marked unreachable for 10 minutes; using the GitHub API");
	const progress = (transferred, totalBytes) => {
		notify(`server package download progress: ${megabytes(transferred)}${totalBytes === void 0 ? "" : ` / ${megabytes(totalBytes)}`} MB`);
	};
	const progressOptions = {
		onProgress: progress,
		...options.progressIntervalMs === void 0 ? {} : { progressIntervalMs: options.progressIntervalMs }
	};
	/**
	* Fetch the artifact body, resuming a partial file when there is one.
	*
	* `curl -C -` is what turns a hiccup at 99.8% into a retry instead of a lost
	* 40-minute download (alpha66). A failed transfer KEEPS the partial: the next
	* transport or tag continues it. A 404 deletes it (that tag does not exist),
	* and so does a size/sha mismatch (the bytes are not the published ones).
	*/
	const fetchArtifact = async (url, options) => {
		const existing = await stat(cached).then((info) => info.size, () => 0);
		const total = options.totalBytes;
		if (total !== void 0 && existing === total) return { ok: true };
		if (total !== void 0 && existing > total) await rm(cached, { force: true });
		const resume = existing > 0 && (total === void 0 || existing < total);
		if (resume) notify(`resuming the server package download at ${megabytes(existing)}${total === void 0 ? "" : ` / ${megabytes(total)}`} MB`);
		const result = await fetchTo(runner, url, cached, {
			...options.headers === void 0 ? {} : { headers: options.headers },
			maxTimeSeconds: options.maxTimeSeconds,
			...total === void 0 ? {} : { totalBytes: total },
			...progressOptions,
			...resume ? { resume: true } : {},
			keepPartial: true
		});
		if (!result.ok) {
			if (result.result.code === 22) await rm(cached, { force: true });
			return {
				ok: false,
				reason: reasonOf(result.result),
				code: result.result.code,
				stderr: result.result.stderr
			};
		}
		if (total !== void 0) {
			const size = await stat(cached).then((info) => info.size, () => 0);
			if (size !== total) {
				await rm(cached, { force: true });
				return {
					ok: false,
					reason: `incomplete (${size} / ${total} bytes)`,
					code: 0,
					stderr: ""
				};
			}
		}
		return { ok: true };
	};
	for (const releaseTag of tags) {
		const attempts = [];
		const hosts = skipHtml ? [] : mirror === "" ? [HTML_BASE] : [mirror];
		let assetSizes;
		for (const host of hosts) {
			const base = releaseAssetBase(host, releaseTag);
			const total = assetSizes?.get(name);
			notify(`downloading server package ${name} from ${host} (release ${releaseTag})`);
			const artifact = await fetchArtifact(`${base}/${name}`, {
				maxTimeSeconds: 180,
				...total === void 0 ? {} : { totalBytes: total }
			});
			if (!artifact.ok) {
				attempts.push(`html: ${artifact.reason}`);
				if (host === HTML_BASE && isReleasePageUnreachable({
					code: artifact.code,
					stderr: artifact.stderr
				})) markReleasePageUnreachable(HTML_BASE, now());
				continue;
			}
			if (!(await fetchTo(runner, `${base}/${name}.sha256`, shaFile, { maxTimeSeconds: 180 })).ok) {
				attempts.push(`html: .sha256 companion missing`);
				continue;
			}
			const verified = await verifyDownload(cached, shaFile, releaseTag, "html");
			notify(`server package downloaded from release ${releaseTag} (${megabytes(verified.size)} MB)`);
			return {
				...verified,
				version: options.version
			};
		}
		if (mirror === "") {
			if (!skipHtml) notify(`release page unreachable for ${releaseTag}; trying the GitHub API`);
			const listing = await runner({
				url: `${API_BASE}/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases/tags/${encodeURIComponent(releaseTag)}`,
				headers: ["Accept: application/vnd.github+json"],
				maxTimeSeconds: API_TIMEOUT_S
			});
			if (listing.code !== 0) attempts.push(`api: ${reasonOf(listing)}`);
			else {
				const assets = assetsOf(listing.stdout);
				assetSizes = new Map((assets ?? []).filter((asset) => asset.size !== void 0).map((asset) => [asset.name, asset.size]));
				const artifactAsset = assets?.find((asset) => asset.name === name);
				const shaAsset = assets?.find((asset) => asset.name === `${name}.sha256`);
				if (artifactAsset === void 0 || shaAsset === void 0) attempts.push(`api: asset ${name} not in release`);
				else {
					const artifact = await fetchArtifact(`${API_BASE}/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases/assets/${artifactAsset.id}`, {
						headers: ["Accept: application/octet-stream"],
						maxTimeSeconds: API_TIMEOUT_S,
						...artifactAsset.size === void 0 ? {} : { totalBytes: artifactAsset.size }
					});
					if (!artifact.ok) attempts.push(`api: ${artifact.reason}`);
					else if (!(await fetchTo(runner, `${API_BASE}/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases/assets/${shaAsset.id}`, shaFile, {
						headers: ["Accept: application/octet-stream"],
						maxTimeSeconds: 3600
					})).ok) attempts.push(`api: .sha256 asset download failed`);
					else {
						const verified = await verifyDownload(cached, shaFile, releaseTag, "api");
						notify(`server package downloaded from release ${releaseTag} via the GitHub API (${megabytes(verified.size)} MB)`);
						return {
							...verified,
							version: options.version
						};
					}
				}
			}
		}
		failures.push(`${releaseTag} (${attempts.join("; ") || "not found"})`);
	}
	throw new Error(`release download failed: no server package found for ${failures.join(", ")}; publish a release (tag ${tags.at(-1) ?? ""}) or switch the package source to upload`);
}
/** The package-source resolution order for one policy. */
function sourceOrder(policy) {
	if (policy === "download") return ["cache", "download"];
	if (policy === "upload") return ["cache", "build"];
	return [
		"cache",
		"download",
		"build"
	];
}
/**
* What the local cache holds for one target architecture, without touching the
* network or the packer.
*
* Used by `dsh-scan` to tell the wizard "already cached, upload directly" before
* the user commits to the upload path. Deliberately the *same* validation the
* resolver applies on a hit (`cachedAssetIfReady` + the 1 MiB floor from
* api-contract §9.1), so a "cached" badge and a real cache hit cannot disagree.
* @param options - the dsh release and the target platform.
* @returns the artifact name plus, on a hit, its digest and size.
*/
async function describeLocalPackage(options) {
	const tag = artifactTag(options.platform, options.arch, options.libc);
	const artifact = artifactName(options.version, tag);
	const hit = await cachedAssetIfReady(join(remoteAssetsCacheDir(), artifact));
	if (hit === void 0 || hit.size <= 1048576) return {
		artifact,
		version: options.version,
		cached: false
	};
	return {
		artifact,
		version: options.version,
		cached: true,
		sha256: hit.sha256,
		sizeBytes: hit.size
	};
}
/**
* Resolve the server package per policy. Every source lands in the same local
* cache, so a policy change or a retry after a partial download never
* re-fetches what is already on disk.
*
* `'reuse'` is accepted by the *type* only so the caller can pass the target's
* effective source straight through: reuse never produces an artifact, so it is
* refused loudly here instead of quietly building one (architecture §3.3/A11 —
* a reuse failure must never become a silent 40 MB upload).
*/
async function resolveServerPackage(options) {
	if (options.policy === "reuse") throw new Error("the \"reuse\" package source produces no server package; reuse is a provisioning mode, not an artifact source");
	const notify = options.onProgress ?? (() => {});
	const tag = artifactTag(options.platform, options.arch, options.libc);
	const dir = options.cacheDir ?? remoteAssetsCacheDir();
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
				asset: await buildDshRuntimePackage({
					...options,
					onProgress: notify
				}),
				via: "build"
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errors.push(`${source}: ${message}`);
			notify(source === "download" ? `release download failed: ${message}; falling back to a local build` : `local build failed; trying the next source`, message);
		}
	}
	throw new Error(`could not obtain the server package ${artifactName(options.version, tag)}; attempts: ${errors.join(" ;; ")}`);
}
//#endregion
//#region src/provision/version-range.ts
/**
* The dsh version window this plugin supports, and the comparison enforcing it.
*
* The window mirrors `package.json`'s peer range (`>=0.2.1-rc.2 <0.3.0`). The
* floor is a *measured* baseline rather than a policy choice: 0.2.1-rc.2 is the
* first release whose JSONL persistence backend is an `apply()`-mounted row and
* whose `hello` carries `kind`/`executable` — on 0.2.0-rc.x the remote world
* never starts. Keep the two in sync by hand when the peers move.
*
* Why not `semver`: the window is one constant, and a second, *mutable* parser
* in the dependency tree has already cost this repo real pain (`zod` had to be
* pinned to an exact version because a duplicate copy made `tsc` OOM, see
* AGENTS.md). The ~70 lines below cover exactly the semantics we need — and the
* prerelease ordering is unit-tested, which is the part a naive
* `localeCompare` would get wrong (`rc.10` vs `rc.2`).
*/
/** Lowest dsh release the remote world runs on (inclusive). */
const DSH_MIN_VERSION = "0.2.1-rc.2";
/** First dsh release the remote world is *not* known to work on (exclusive). */
const DSH_MAX_VERSION = "0.3.0";
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
*    (`rc.2 < rc.2.1`) — the case that decided the floor of the supported window.
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
/** The parsed floor, computed once. */
const MIN = parseDshVersion(DSH_MIN_VERSION);
/** The parsed ceiling, computed once. */
const MAX = parseDshVersion(DSH_MAX_VERSION);
/**
* Whether a version line names a dsh release this plugin can drive remotely.
* @param text - whatever `dsh --version` (or a scan record) printed.
* @returns false for unparseable text as well as out-of-window versions.
*/
function isCompatibleDsh(text) {
	const version = parseDshVersion(text);
	if (version === void 0) return false;
	return compareDshVersion(version, MIN) >= 0 && compareDshVersion(version, MAX) < 0;
}
/**
* A human-readable reason for rejecting a version line.
*
* Shown verbatim in the wizard's candidate list and in `reuse`-mode failures,
* so it names the actual floor/ceiling instead of saying "unsupported".
* @param text - the version line that failed {@link isCompatibleDsh}.
* @returns one sentence; never empty.
*/
function describeIncompatibility(text) {
	const trimmed = text.trim();
	const version = parseDshVersion(trimmed);
	if (version === void 0) return trimmed === "" ? "the launcher printed no version" : `"${trimmed}" is not a dsh version`;
	if (compareDshVersion(version, MIN) < 0) return `version ${trimmed} is below the supported floor ${DSH_MIN_VERSION}`;
	return `version ${trimmed} is at or above the unsupported ceiling ${DSH_MAX_VERSION}`;
}
//#endregion
//#region src/provision/plan.ts
/**
* The provisioning decision: reuse a dsh the host already has, or package one.
*
* `channel.ts` used to hold this inline and it grew an `if` forest; more
* importantly the decision is the thing QA has to *explain* ("why did this
* connect upload 40 MB?"), so it lives in one pure function with unit tests and
* a message that names the failing fact.
*
* Two rules are load-bearing and are asserted by `tests/plan.test.ts`:
*
* 1. **A failed reuse never falls back to packaging.** The connect that follows
*    would silently push a 25–50 MB archive over the user's link; the failure is
*    reported instead, with the plain advice to pick 「上传 server 包」.
* 2. **A launcher that needs Node does not fail the plan.** If neither the host
*    nor a previous deployment offers an interpreter, the plan asks the pipeline
*    to deploy our own Node (`deployRuntime`) and start the launcher through it —
*    measured on Ubuntu 22.04, where the uploaded `.bin/dsh` is a `/bin/sh`
*    wrapper whose `exec node` needs the deployed runtime on `PATH`.
*/
/**
* Decide how this connect will start the remote world.
* @param input - the effective package source (already resolved against the
*   target record and the global policy), the launcher path the user picked and
*   the facts measured for it.
* @returns the plan, or a coded refusal whose message is safe to show.
*/
function planProvision(input) {
	if (input.packageSource !== "reuse") return {
		ok: true,
		plan: { mode: "package" }
	};
	const selected = (input.reuseLauncherPath ?? "").trim();
	if (selected === "") return {
		ok: false,
		code: "reuse-launcher-missing",
		message: "no dsh launcher was selected for the reuse connection; scan the host and pick one"
	};
	const facts = input.reuse;
	if (facts === void 0 || facts.path !== selected) return {
		ok: false,
		code: "reuse-launcher-missing",
		message: `the selected launcher ${selected} could not be inspected on the remote host`
	};
	if (!facts.exists) return {
		ok: false,
		code: "reuse-launcher-missing",
		message: `the selected launcher ${selected} does not exist on the remote host; scan again`
	};
	if (!facts.executable) return {
		ok: false,
		code: "reuse-launcher-missing",
		message: `the selected launcher ${selected} is not executable on the remote host`
	};
	if (facts.exitCode !== 0 || facts.version.trim() === "") {
		const detail = facts.version.trim() === "" ? "the launcher printed no version" : describeIncompatibility(facts.version);
		return {
			ok: false,
			code: "dsh-incompatible",
			message: `the selected launcher ${selected} failed its version check (exit ${facts.exitCode === null ? "unknown" : String(facts.exitCode)}): ${detail}`
		};
	}
	if (!isCompatibleDsh(facts.version)) return {
		ok: false,
		code: "dsh-incompatible",
		message: `the selected launcher ${selected} cannot be used: ${describeIncompatibility(facts.version)}; use 「上传 server 包」 instead`
	};
	const version = facts.version.trim();
	if (!facts.hasShebang) return {
		ok: true,
		plan: {
			mode: "reuse",
			launcher: {
				path: facts.path,
				realPath: facts.realPath,
				version,
				selfContained: true
			},
			deployRuntime: false
		}
	};
	const nodePath = facts.nodePath ?? facts.deployedNode;
	if (nodePath === void 0 || nodePath === "") return {
		ok: true,
		plan: {
			mode: "reuse",
			launcher: {
				path: facts.path,
				realPath: facts.realPath,
				version,
				selfContained: false
			},
			deployRuntime: true
		}
	};
	return {
		ok: true,
		plan: {
			mode: "reuse",
			launcher: {
				path: facts.path,
				realPath: facts.realPath,
				version,
				selfContained: false,
				nodePath
			},
			deployRuntime: false
		}
	};
}
//#endregion
//#region src/provision/channel.ts
/**
* Provisioning one remote execution world.
*
* ZCode-shaped, and **transport-agnostic** since WSL targets arrived: every
* stage runs under `/bin/sh -c` with absolute paths against a `RemoteTransport`
* (an ssh2 session, or a locally spawned `wsl.exe` in a Windows distribution),
* and the far side never depends on its own PATH, login shell or package
* manager for Node. The stages, each reported to the wizard:
*
* 1. **connect** — ssh2 with host-key verification (an unconfirmed key aborts
*    with the fingerprint so the user can decide, a *changed* key always
*    aborts). A WSL distro is a local process with no host key: it is proven
*    reachable by running a command instead.
* 2. **probe**   — one framed shell probe: `$HOME`, `uname` (+ostype
*    correction), download tools, and the per-component markers.
* 3. **runtime** — the Node *component*: skipped when the marker matches and
*    the deployed binary verifies; otherwise the host-side cached tarball is
*    uploaded with live progress, sha-checked, extracted in staging and
*    atomically swapped in.
* 4. **upload**  — the `dsh` component (installed from the host-staged package)
*    plus this plugin's lib and the profile files, all marker-gated.
* 5. **start**   — run the deployed `dsh --profile` on its stdio, which becomes
*    the protocol channel.
*/
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
*
* Exported because `dsh-scan` reports which artifact *would* be uploaded for
* this target's architecture, and that name has to match the one a real
* deployment would resolve (`doc/api-contract.md` §9).
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
* Open the transport for one target, reporting the `connect` stage.
*
* The only place that knows how a target is reached: `wsl` spawns a local
* distribution (no host key to verify), everything else is ssh2 with the pinned
* fingerprint (an unconfirmed key throws `HostKeyUnknownError` from here).
* @param request - target plus the credential material for this attempt.
* @returns an open transport; the caller owns `close()`.
*/
async function openTransport(request) {
	const { target } = request;
	const emit = (event) => {
		request.onEvent?.(event);
	};
	request.signal?.throwIfAborted();
	if (target.kind === "wsl") {
		const distro = target.wslDistro ?? "";
		if (distro === "") throw new Error(`remote target "${target.label}" has no WSL distribution`);
		emit({
			type: "step",
			step: "connect",
			status: "running",
			message: `starting WSL distribution ${distro}`
		});
		const transport = connectWslTransport({
			distro,
			...target.wslUser === void 0 ? {} : { user: target.wslUser }
		});
		const check = await transport.exec("true", {
			maxBytes: 4096,
			timeoutMs: 3e4
		});
		if (check.code !== 0) {
			await transport.close().catch(() => {});
			const detail = scrubSecrets(check.stderr.trim().slice(-2e3));
			throw new Error(`cannot enter WSL distribution "${distro}" (exit ${check.code ?? "signal"}): ${detail !== "" ? detail : "no stderr output"}`);
		}
		emit({
			type: "step",
			step: "connect",
			status: "ok",
			message: `WSL ${distro}`
		});
		return transport;
	}
	emit({
		type: "step",
		step: "connect",
		status: "running",
		message: `connecting to ${target.host}:${target.port}`
	});
	const auth = authFor(target, request.secret, request.privateKey);
	const pinned = request.hostKeyFingerprint ?? target.hostKeyFingerprint;
	const transport = await connectSshTransport({
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
	return transport;
}
/**
* The package source actually in force for one target: the record's own choice
* wins, otherwise the plugin-wide policy (`ask` behaves like `auto`, which is
* what the store's schema documents).
* @param target - stored target record.
* @param policy - plugin-wide policy and mirror, when the caller passed one.
*/
function effectivePackageSource(target, policy) {
	if (target.packageSource !== void 0 && target.packageSource !== "auto") return target.packageSource;
	const global = policy?.policy ?? "auto";
	return global === "ask" ? "auto" : global;
}
/**
* An error carrying the code the SSE `error` frame reports (api-contract §10).
* Message is scrubbed here so no call site can forget it.
*/
function codedError$1(code, message) {
	const error = new Error(scrubSecrets(message));
	error.code = code;
	return error;
}
/** This plugin's own version, read from the package root it deploys from. */
async function pluginVersionOf(packageRoot) {
	try {
		const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
		return typeof manifest.version === "string" ? manifest.version : "";
	} catch {
		return "";
	}
}
/**
* The remote profile + plugin file set for one profile directory.
*
* Shared by the pipeline and by `dsh-scan` (which has to compare its digest against
* the installed marker before the user commits to anything), so "is the plugin
* current" is answered by exactly one construction of the file set — the digest
* covers the absolute remote paths, so the two callers must build it identically.
* @param packageRoot - local plugin package root.
* @param profileDir - absolute remote profile directory.
* @param profile - profile name (it is written into the profile's package.json).
*/
async function profileFileSet(packageRoot, profileDir, profile) {
	const files = [];
	for (const [name, content] of remoteProfileFiles({ profile })) files.push({
		path: `${profileDir}/${name}`,
		content: Buffer.from(content, "utf8")
	});
	for (const file of await packageFiles(packageRoot)) files.push({
		path: `${profileDir}/${PROFILE_PACKAGE_DIR}/${file.path}`,
		content: file.content
	});
	return files;
}
/**
* The absolute remote profile directory for one target.
*
* Both layouts keep the profile in the same directory: the packaged server also
* runs with `DSH_HOME=<dshHome>`, so 打包 ↔ 复用 can be swapped without losing the
* installed plugin — or the remote sessions, which live under
* `DSH_HOME/remote-server-sessions` regardless of how dsh was installed.
* @param dshHome - absolute remote `DSH_HOME`.
* @param home - absolute remote home (used when `dshHome` is relative).
* @param profile - profile name.
*/
function profileDirFor(dshHome, home, profile) {
	return isAbsolute(dshHome) ? `${dshHome}/profiles/${profile}` : `${join(home, dshHome)}/profiles/${profile}`;
}
/**
* Probe, deploy and start the remote server over an already-open transport.
* @param transport - an open transport (ownership stays with the caller).
* @param request - target, package policy and progress sink.
* @returns the live channel and the deployment facts.
*/
async function provisionOver(transport, request) {
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
		step: "probe",
		status: "running",
		message: "checking the remote host"
	});
	const probeResult = await transport.exec(sh(probeScript({ profile: target.remote.profile })), {
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
	const installHome = home;
	const dshHome = expandRemoteHome(target.remote.dshHome, home);
	const profileName = target.remote.profile;
	const platform = env.platform === "darwin" ? "darwin" : "linux";
	const arch = env.arch === "arm64" ? "arm64" : "x64";
	const tag = artifactTag(platform, arch, env.libc);
	const profileDir = profileDirFor(dshHome, home, profileName);
	const effective = effectivePackageSource(target, request.packagePolicy);
	const reuseLauncherPath = (request.reuseLauncherPath ?? "").trim();
	const reuseFacts = effective === "reuse" && reuseLauncherPath !== "" ? parseReuseLauncherOutput((await transport.exec(sh(reuseLauncherScript({
		launcherPath: reuseLauncherPath,
		installHome
	})), {
		maxBytes: 16384,
		timeoutMs: 4e4
	})).stdout, reuseLauncherPath) : void 0;
	const decision = planProvision({
		packageSource: effective,
		reuseLauncherPath,
		...reuseFacts === void 0 ? {} : { reuse: reuseFacts }
	});
	if (!decision.ok) throw codedError$1(decision.code, decision.message);
	const plan = decision.plan;
	const lockToken = randomUUID();
	const pluginVersion = await pluginVersionOf(request.packageRoot);
	/**
	* The Node component, shared by both modes.
	*
	* A configured `remote.nodePath` wins and is not deployed at all; otherwise a
	* marker hit must still prove the binary runs, and only then is the
	* host-cached tarball uploaded.
	*/
	const ensureNode = async () => {
		const override = target.remote.nodePath;
		if (override !== "" && override !== "node") {
			const overridePath = expandRemoteHome(override, home);
			const check = await transport.exec(sh(`p=${shellQuote(overridePath)}; if [ -x "$p" ]; then "$p" -v; else echo MISSING; fi`), {
				maxBytes: 256,
				timeoutMs: 2e4
			});
			const version = check.stdout.trim();
			if (check.code === 0 && version.startsWith("v2")) {
				notify("runtime", `using the configured Node ${version} at ${overridePath}`);
				return {
					binDir: overridePath.slice(0, overridePath.lastIndexOf("/")),
					version,
					external: true
				};
			}
			notify("runtime", `the configured Node at ${overridePath} is not usable (${version || "not executable"}); deploying a local one`);
		}
		const marker = env.node;
		if (marker !== void 0 && NODE_VERSION_CANDIDATES.includes(marker.version) && marker.platformArch === env.platformArch) {
			const verify = await transport.exec(sh(`${shellQuote(serverPath(installHome, "node/bin/node"))} -v`), {
				maxBytes: 64,
				timeoutMs: 2e4
			});
			if (verify.code === 0 && verify.stdout.trim() === marker.version) {
				notify("runtime", `node ${marker.version} already deployed (marker match)`);
				return {
					binDir: serverPath(installHome, "node/bin"),
					version: marker.version,
					external: false
				};
			}
			notify("runtime", `the deployed node does not verify (${verify.stdout.trim() || "missing"}); redeploying`);
		}
		await acquireDeployLock(transport, installHome, lockToken);
		try {
			const asset = await ensureNodeTarball({
				platform,
				arch,
				onProgress: (message, detail) => notify("runtime", message, detail)
			});
			notify("runtime", `uploading node ${asset.version} (${(asset.size / 1024 / 1024).toFixed(1)} MB)`);
			const upload = await uploadNodeTarball(transport, {
				home: installHome,
				content: await readFile(asset.path),
				version: asset.version,
				platformArch: env.platformArch
			}, progressReporter("node", (message) => notify("runtime", message)));
			await runDeployScript(transport, extractNodeScript({
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
			notify("runtime", `node ${asset.version} deployed to ${serverPath(installHome, "node")}`);
			return {
				binDir: serverPath(installHome, "node/bin"),
				version: asset.version,
				external: false
			};
		} finally {
			await releaseDeployLock(transport, installHome, lockToken);
		}
	};
	let dshPath = "";
	let startNode = "";
	let startCommand = "";
	let startMessage = "";
	/**
	* The artifact this run resolved and deployed, for the record's `serverPackage`.
	*
	* Only the packaging branch has one: reuse ships no archive at all, so the field
	* stays absent there instead of recording a hollow artifact name.
	*/
	let deployedPackage;
	if (plan.mode === "package") {
		signal?.throwIfAborted();
		emit({
			type: "step",
			step: "runtime",
			status: "running",
			message: "checking the deployed runtime"
		});
		const node = await ensureNode();
		startNode = node.external ? expandRemoteHome(target.remote.nodePath, home) : serverPath(installHome, "node/bin/node");
		emit({
			type: "step",
			step: "runtime",
			status: "ok",
			message: node.external ? "runtime ready (configured node)" : `node ${node.version} ready`
		});
		signal?.throwIfAborted();
		emit({
			type: "step",
			step: "upload",
			status: "running",
			message: "preparing the dsh runtime package"
		});
		const release = dshReleaseVersion(request.packageRoot);
		const policy = request.packagePolicy ?? {
			policy: "auto",
			mirror: ""
		};
		notify("upload", `server package required: ${artifactName(release, tag)}`);
		const { asset: pkg, via: pkgVia } = await resolveServerPackage({
			version: release,
			platform,
			arch,
			libc: env.libc,
			policy: effective,
			mirror: policy.mirror,
			...pluginVersion === "" ? {} : { pluginVersion },
			onProgress: (message, detail) => notify("upload", message, detail)
		});
		notify("upload", `server package ready via ${pkgVia}`);
		deployedPackage = {
			artifact: artifactName(release, tag),
			sha256: pkg.sha256,
			version: release
		};
		let needDshInstall = decideDsh(env.dsh, release, pkg.sha256) !== "skip";
		if (!needDshInstall) {
			const check = await transport.exec(sh(checkDshScript({ home: installHome })), {
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
			await acquireDeployLock(transport, installHome, lockToken);
			try {
				notify("upload", `uploading dsh ${release} package (${(pkg.size / 1024 / 1024).toFixed(1)} MB)`);
				const tarballName = `dsh-runtime-${release}-${env.platformArch}.tar.gz`;
				const tarballPath = serverPath(installHome, `staging/${tarballName}`);
				await transport.writeFile(tarballPath, await readFile(pkg.path), progressReporter("dsh", (message) => notify("upload", message)));
				await runDeployScript(transport, installDshPackageScript({
					home: installHome,
					version: release,
					sha256: pkg.sha256,
					tarballName
				}), {
					what: "dsh package deployment",
					timeoutMs: 3e5
				});
				notify("upload", `dsh ${release} deployed`, serverPath(installHome, "dsh/node_modules/.bin/dsh"));
			} finally {
				await releaseDeployLock(transport, installHome, lockToken);
			}
		}
		dshPath = serverPath(installHome, "dsh/node_modules/.bin/dsh");
		startCommand = serverCommand({
			home: dshHome,
			installHome,
			profile: profileName
		});
		startMessage = `starting profile ${profileName}`;
	} else {
		signal?.throwIfAborted();
		emit({
			type: "step",
			step: "runtime",
			status: "running",
			message: `checking the selected launcher ${plan.launcher.path}`
		});
		let nodePath = plan.launcher.nodePath;
		let ownNodeVersion = "";
		if (plan.deployRuntime) try {
			const node = await ensureNode();
			nodePath = `${node.binDir}/node`;
			ownNodeVersion = node.version;
		} catch (error) {
			throw codedError$1("reuse-node-missing", `the selected dsh ${plan.launcher.path} needs Node and none could be deployed: ${scrubSecrets(error instanceof Error ? error.message : String(error))}`);
		}
		startNode = nodePath ?? "";
		emit({
			type: "step",
			step: "runtime",
			status: "ok",
			message: ownNodeVersion === "" ? `复用远端 dsh ${plan.launcher.version}（跳过 Node 与 dsh 部署）` : `复用远端 dsh ${plan.launcher.version}（自带 Node ${ownNodeVersion}）`
		});
		emit({
			type: "step",
			step: "upload",
			status: "running",
			message: `preparing the server profile at ${profileDir}`
		});
		dshPath = plan.launcher.path;
		startCommand = reuseServerCommand({
			dshHome,
			launcher: plan.launcher.path,
			profile: profileName,
			...nodePath === void 0 ? {} : { nodePath }
		});
		startMessage = `复用启动器 ${plan.launcher.path}`;
	}
	signal?.throwIfAborted();
	const profileFiles = await profileFileSet(request.packageRoot, profileDir, profileName);
	const pluginSha = await sha256OfFiles(profileFiles);
	const profileMarker = plan.mode === "reuse" ? parseMarker((await transport.exec(sh(`cat ${shellQuote(`${profileDir}/${PROFILE_MARKER_FILE}`)} 2>/dev/null || true`), {
		maxBytes: 4096,
		timeoutMs: 15e3
	})).stdout) : void 0;
	const installedMarker = plan.mode === "reuse" ? profileMarker === void 0 ? env.plugin : {
		id: "plugin",
		sha256: profileMarker.sha256
	} : env.plugin;
	let pluginOutcome = "";
	if (decidePlugin(installedMarker, pluginSha) === "skip") {
		pluginOutcome = "server 插件已是最新（marker 命中）";
		notify("upload", pluginOutcome);
	} else {
		notify("upload", plan.mode === "reuse" ? `远端 dsh 未安装 server 插件，正在安装（${profileFiles.length} 个文件）` : `uploading profile and plugin (${profileFiles.length} files)`);
		if (plan.mode === "reuse") await acquireProfileLock(transport, profileDir, lockToken);
		try {
			await writeFiles(transport, profileFiles);
			if (plan.mode === "package") {
				const markerScript = ["set -eu", `printf %s ${shellQuote(`${JSON.stringify({
					id: "plugin",
					sha256: pluginSha
				})}\n`)} > ${shellQuote(serverPath(installHome, ".components/plugin.json"))}`].join("\n");
				await transport.exec(sh(markerScript), {
					maxBytes: 4096,
					timeoutMs: 15e3
				});
			}
			await transport.exec(sh(profilePluginScript({
				profileDir,
				sha256: pluginSha,
				version: pluginVersion,
				profile: profileName
			})), {
				maxBytes: 4096,
				timeoutMs: 15e3
			});
			notify("upload", `profile written to ${profileDir}`);
		} finally {
			if (plan.mode === "reuse") await releaseProfileLock(transport, profileDir, lockToken);
		}
		pluginOutcome = `server 插件 ${pluginVersion} 已安装（profile ${profileName}）`;
		notify("upload", pluginOutcome);
	}
	emit({
		type: "step",
		step: "upload",
		status: "ok",
		message: `${pluginOutcome}；dsh at ${dshPath}`
	});
	signal?.throwIfAborted();
	emit({
		type: "step",
		step: "start",
		status: "running",
		message: startMessage
	});
	const handle = await transport.openChannel(startCommand);
	const survivor = await Promise.race([handle.exited.then((code) => ({
		alive: false,
		code
	})), new Promise((resolveAlive) => setTimeout(() => resolveAlive({ alive: true }), 8e3))]);
	if (!survivor.alive) {
		const tail = handle.diagnostics();
		if (plan.mode === "reuse") throw codedError$1("reuse-boot-failed", `the reused dsh exited during startup (code ${survivor.code}): ${tail !== "" ? tail : "no stderr captured"}; use 「上传 server 包」 instead`);
		throw new Error(`the remote server exited during startup (code ${survivor.code}): ${tail !== "" ? tail : "no stderr captured"}`);
	}
	emit({
		type: "step",
		step: "start",
		status: "ok"
	});
	return {
		channel: handle.channel,
		fingerprint: request.hostKeyFingerprint ?? target.hostKeyFingerprint,
		nodePath: startNode,
		dshPath,
		home,
		kind: target.kind,
		probe: {
			platform,
			arch,
			libc: env.libc,
			tag
		},
		...deployedPackage === void 0 ? {} : { package: deployedPackage },
		...plan.mode === "reuse" ? { reuse: {
			path: plan.launcher.path,
			version: plan.launcher.version,
			...startNode === "" ? {} : { nodePath: startNode }
		} } : {}
	};
}
/**
* Connect, probe, deploy and start the remote server.
* @param request - target, credentials and progress sink.
* @returns the channel and the verified host-key fingerprint (`''` for WSL).
* @throws HostKeyUnknownError on first contact, HostKeyMismatchError on a changed key.
*/
async function provisionTarget(request) {
	const transport = await openTransport(request);
	try {
		return await provisionOver(transport, request);
	} catch (error) {
		await transport.close().catch(() => {});
		throw error;
	}
}
/** Read a local private key file for a target, expanding `~`. */
async function readPrivateKey(path) {
	const expanded = path.startsWith("~/") ? join(homedir(), path.slice(2)) : resolve(path);
	return await readFile(expanded);
}
//#endregion
//#region src/provision/dsh-scan.ts
/**
* The read-only "what dsh does this host already have" scan.
*
* The wizard's 复用机器上的 dsh path needs three facts *before* connecting: which
* dsh launchers exist, which of them this plugin can drive, and whether the
* target's profile already carries a current copy of the server plugin. All
* three are gathered by one POSIX script over a throwaway transport and parsed
* here — this module is the script plus its parser, with no I/O, so the parsing
* rules are unit-testable exactly like `deploy.parseProbeOutput`.
*
* Hard constraints, because this script runs on a machine we do not own:
*
* - **Read-only.** Only `command -v`, `ls`, `test`, `readlink -f`, `head`, `sed`,
*   `tr`, `cat`, `uname`, `ldd --version` and `<launcher> --version` appear. No
*   `mkdir`/`rm`/`mv`/`cp`/`touch`, no package manager, no network. In
*   particular the pipeline's own probe script is *not* a template: it does
*   `mkdir -p ~/.dsh/server/.components` (`deploy.ts`), which is a write.
* - **`$DSHHOME/server/node/bin` leads `PATH`.** The dsh this plugin deploys is a
*   `/bin/sh` shim around `exec node` and its interpreter is *not* on the login
*   PATH. Measured on Ubuntu 22.04: without that prefix, `--version` on a
*   deployed launcher answers `exec: node: not found` (exit 127), the candidate
*   is judged incompatible, and 复用 fails against the very instance this plugin
*   installed a minute earlier. With it the same shim prints `0.2.1-rc.2`.
* - **`readlink -f` on that shim returns the shim itself**, first line
*   `#!/bin/sh`, so the shebang cannot name the interpreter. When a shebang is
*   present but no node could be derived, the deployed
*   `<DSHHOME>/server/node/bin/node` is used instead — that is what makes the
*   shim runnable (`selfContained: false`).
* - Multi-line scripts travel on stdin on the WSL side (`/bin/sh -s`, see
*   `ssh/wsl.ts`); this text is plain LF, never CRLF (a CRLF body answers
*   `/bin/sh: echo: not found` inside a distro).
*/
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
/**
* Turn the raw scan into the wizard's candidate list.
*
* The profile block is *not* per launcher: every launcher on one host shares the
* same `DSH_HOME`, so "is our server plugin installed and current" is a property
* of the profile, and the answer is attached to each candidate for rendering.
*
* @param scan - parsed scan output.
* @param options - the profile this connection will use and the digest of the
*   file set this host would upload (`sha256OfFiles(profile + plugin files)`).
* @returns candidates ordered for the picker: usable-and-current first, then
*   merely compatible, then the rest by path; already limited to
*   {@link MAX_CANDIDATES}.
*/
function assembleCandidates(scan, options) {
	const scanned = scan.profiles.find((entry) => entry.name === options.profile);
	const upToDate = scanned?.pluginSha256 !== void 0 && options.expectedPluginSha !== void 0 && scanned.pluginSha256 === options.expectedPluginSha;
	const profile = scanned === void 0 ? void 0 : {
		name: scanned.name,
		...scanned.pluginVersion === void 0 ? {} : { pluginVersion: scanned.pluginVersion },
		...scanned.pluginSha256 === void 0 ? {} : { pluginSha256: scanned.pluginSha256 },
		upToDate
	};
	const candidates = scan.launchers.map((launcher) => {
		const executable = launcher.exitCode === 0 && launcher.version.trim() !== "";
		const compatible = isCompatibleDsh(launcher.version);
		return {
			path: launcher.path,
			realPath: launcher.realPath,
			version: launcher.version.trim(),
			compatible,
			executable,
			...launcher.nodePath === void 0 ? {} : { nodePath: launcher.nodePath },
			selfContained: launcher.nodePath === void 0,
			...profile === void 0 ? {} : { profile },
			...compatible ? {} : { reason: executable ? describeIncompatibility(launcher.version) : launcher.exitCode === 0 ? describeIncompatibility(launcher.version) : `the launcher did not report a version (exit ${launcher.exitCode})` }
		};
	});
	const rank = (candidate) => candidate.compatible && candidate.profile?.upToDate === true ? 0 : candidate.compatible ? 1 : 2;
	return candidates.sort((left, right) => rank(left) - rank(right) || left.path.localeCompare(right.path)).slice(0, 12);
}
/**
* Fold the scan's `TOOL` records into the probe's tool flags.
*
* `shasum` counts as `sha256sum`: macOS ships `shasum` and not `sha256sum`, and
* the pipeline asks the same question of its own probe (`parseProbeOutput`), so
* "can I verify a downloaded artifact here" must not answer differently
* depending on which script asked.
* @param tools - the resolved tool records.
*/
function scanTools(tools) {
	const has = (name) => tools.some((tool) => tool.name === name);
	return {
		tar: has("tar"),
		sha256sum: has("sha256sum") || has("shasum"),
		curl: has("curl"),
		wget: has("wget")
	};
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
/**
* How long a browsing client may sit idle before it is retired.
*
* The wizard's directory picker issues several RPCs per navigation, so the
* client has to survive between them — but a dedicated in-distro `dsh` process
* must not linger after the user stops browsing (a WSL child keeps the
* distribution running and holds its own lease). 120s covers a slow browse
* session and still returns the target to its idle state.
*/
const BROWSE_IDLE_MS = 12e4;
/**
* Largest log worth reading to decide whether a session is still a draft.
*
* A freshly opened draft is a handful of events: `session`, `permission/preset`,
* `sandbox/mode`, `approval/policy` — about 324 B, and it carries no `turn/start`.
* Once a turn starts the title service writes a title with it, so the session stops
* being a scan candidate anyway; this ceiling only keeps a pathological
* untitled-but-huge log from being read over SSH. Past it the answer is
* `draft = false`, which only ever shows a row we would otherwise hide.
*/
const DRAFT_SCAN_MAX_BYTES = 262144;
/**
* One `reg.list` / `reg.create` item, parsed tolerantly (contract §14.1).
*
* `createdAt`/`sessionCount` are optional in the wire contract, and `updatedAt`
* exists only with `includeActivity: true` — so a row must never be dropped (or
* the whole call failed) just because a server of another version left one out.
*/
const workspaceSummarySchema = z.object({
	id: z.string().length(16),
	path: z.string(),
	title: z.string(),
	createdAt: z.string().optional(),
	sessionCount: z.number().optional(),
	updatedAt: z.string().optional()
});
/**
* The one RPC client a target has.
*
* Exactly **one** multiplexer/peer pair may own a channel: the remote server is
* a single process holding the session handles and the workspace index in
* memory, so two peers on one stream would (a) hand `persist.*` calls to a
* server that cannot see them and (b) steal each other's responses — the realm's
* `hello` answer landing in this peer's decoder is what killed an idle session
* (`SSH connection lost` after the lease lapsed). Browsing and the realm both go
* through the cached instance below.
*/
var RemoteClient = class RemoteClient {
	mux;
	peer;
	channel;
	home;
	serverInfo;
	heartbeat;
	hello;
	constructor(mux, peer, channel, home, serverInfo, heartbeat, hello) {
		this.mux = mux;
		this.peer = peer;
		this.channel = channel;
		this.home = home;
		this.serverInfo = serverInfo;
		this.heartbeat = heartbeat;
		this.hello = hello;
	}
	/**
	* Pin the client while a realm (a live session) is attached.
	*
	* The idle retirement below must not close the peer out from under a running
	* agent: the heartbeat it owns is what keeps the remote server's lease alive
	* between turns.
	*/
	pin() {
		this.held += 1;
	}
	/** Release one pin; idle retirement may resume when the last one is gone. */
	unpin() {
		if (this.held > 0) this.held -= 1;
	}
	/** Whether an attached realm still needs this client. */
	get pinned() {
		return this.held > 0;
	}
	held = 0;
	/** Attach one authenticated logical stream (official `ctx.ssh.connectStream`). */
	async openStream(endpoint, signal) {
		const remote = endpoint.path;
		if (!remote.startsWith(`${this.hello.root}/`) || /[:\r\n\0]/u.test(remote)) throw new Error("the remote server returned an invalid stream path");
		return await this.mux.open(endpoint, signal);
	}
	static async open(channel, workspace, leaseMs = 3e4) {
		const startedAt = Date.now();
		if (process.env.DSH_RW_DEBUG === "1") console.error(`[dsh-rw] browse attach begin closed=${String(channel.closed)}`);
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
			if (process.env.DSH_RW_DEBUG === "1") console.error(`[dsh-rw] browse attach hello in +${Date.now() - startedAt}ms`);
			const serverInfo = await peer.request("server.hello", {
				protocol: 3,
				clientVersion: "0.1.0-alpha50"
			}, z.object({
				protocol: z.literal(3),
				serverId: z.string(),
				installationId: z.string(),
				version: z.string(),
				workspacesRoot: z.string(),
				home: z.string().optional()
			}), AbortSignal.timeout(2e4)).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				if (/unsupported remote session protocol/i.test(message)) throw codedError("server-protocol-mismatch", `${message}; the remote server plugin is older than this client — reconnect the target (the plugin is redeployed automatically) or use 「上传 server 包」`);
			});
			return new RemoteClient(mux, peer, channel, serverInfo?.home ?? hello.workspace, serverInfo, startHeartbeat(), {
				hash: hello.hash,
				root: hello.root,
				workspace: hello.workspace
			});
		} catch (error) {
			console.error(`[dsh-rw] browse client open failed +${Date.now() - startedAt}ms`, error instanceof Error ? `${error.name}: ${error.message}` : String(error), `cause=${String(error.cause)}`, `in:ended=${String(channel.input.readableEnded)} destroyed=${String(channel.input.destroyed)}`, `out:destroyed=${String(channel.output.destroyed)} ended=${String(channel.output.writableEnded)}`, String(error.stack).split("\n").slice(1, 4).join(" | "));
			peer.close();
			mux.close();
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
	/**
	* Release this client's own peer.
	*
	* The browsing client deliberately does **not** own the channel: the channel
	* is the target's single server process (its in-memory handles and workspace
	* index are the source of truth for `persist.*`, and a second server process
	* cannot see a session whose log is not flushed yet).
	*
	* `mux.close()` is a *transport* teardown — it destroys the child's stdio — so
	* calling it here killed the very stream the realm and the next browse call
	* needed. That surfaced as `SSH connection lost` at the next attach; the
	* failure diagnostics measured `in.destroyed=true out.destroyed=true`. Only the
	* peer is dropped; the mux dies with the channel.
	*/
	async close() {
		clearInterval(this.heartbeat);
		this.peer.close();
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
	/**
	* Draft verdicts by `targetId \0 workspaceId \0 sessionId`, keyed on log size.
	*
	* Same idea as a title memo: a session's log only ever grows, so the stored
	* `sizeBytes` is the version stamp — the first message changes it and the entry
	* is recomputed on the next list. Only *successful* reads are stored, so a
	* transient channel failure is retried rather than remembered as "not a draft".
	*/
	draftCache = /* @__PURE__ */ new Map();
	/** Per-target `reg.list` cache (memory only, ≤ SERVER_LIST_TTL_MS; architecture A38). */
	serverWorkspaceCache = /* @__PURE__ */ new Map();
	/** Remote path per `${targetId}\0${remoteWorkspaceId}`, for the realm's stub→remote alias. */
	workspacePaths = /* @__PURE__ */ new Map();
	options;
	bootstrap;
	/** Set once a shell-row sweep actually ran in this process (see `scrubShellWorkspacesOnce`). */
	sweptShellWorkspaces = false;
	/** The in-flight sweep, shared by concurrent callers. */
	sweepingShellWorkspaces;
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
		if (target.kind === "ssh" && target.hostKeyFingerprint === "") throw new Error(`remote target "${target.label}" has no confirmed host key; connect it from the wizard first`);
		const secret = await this.store.secretOf(target);
		const privateKey = target.privateKeyPath === void 0 ? void 0 : await readPrivateKey(target.privateKeyPath);
		const reuseLauncherPath = target.packageSource === "reuse" ? target.reuseDsh?.path : void 0;
		const result = await provisionTarget({
			target,
			...secret === void 0 ? {} : { secret },
			...privateKey === void 0 ? {} : { privateKey },
			packageRoot: this.options.packageRoot,
			packagePolicy: this.store.packagePolicy(),
			...reuseLauncherPath === void 0 ? {} : { reuseLauncherPath },
			...signal === void 0 ? {} : { signal }
		});
		const provisionedAt = (/* @__PURE__ */ new Date()).toISOString();
		const hints = provisionedHints(result, provisionedAt);
		if (result.fingerprint !== target.hostKeyFingerprint) await this.store.updateTarget(targetId, (current) => ({
			...current,
			hostKeyFingerprint: result.fingerprint,
			status: "ready",
			lastConnectedAt: provisionedAt,
			...hints
		}));
		else await this.store.updateTarget(targetId, (current) => ({
			...current,
			status: "ready",
			lastConnectedAt: provisionedAt,
			...hints,
			...current.lastError === void 0 ? {} : { lastError: void 0 }
		})).catch(() => {});
		this.channels.set(targetId, result.channel);
		this.invalidateServerWorkspaces(targetId);
		await this.browserFor(targetId).catch(() => {});
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
		await this.retireBrowser(targetId);
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
		if (this.browsers.has(targetId)) {
			await this.retireBrowser(targetId);
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
	/**
	* Every local workspace reference (P0 model, architecture §15.1).
	*
	* A ref carries only this client's materialization and view state; the path and
	* title come from the server list (`serverWorkspaceLists`).
	*/
	listWorkspaceRefs() {
		return this.store.listWorkspaces();
	}
	/** @deprecated P0: use {@link listWorkspaceRefs}; kept for internal call sites. */
	listWorkspaces() {
		return this.store.listWorkspaces();
	}
	/**
	* The server-authoritative workspace list for every **connected** target.
	*
	* Keys are present only when the list could actually be read: a missing key
	* means "unknown", which the UI must not render as "server has no workspaces"
	* (contract §15.2).
	*/
	async serverWorkspaceLists() {
		const out = {};
		for (const targetId of [...this.channels.keys()]) try {
			out[targetId] = await Promise.race([this.serverWorkspacesOf(targetId), new Promise((_resolve, reject) => {
				setTimeout(() => reject(/* @__PURE__ */ new Error("reg.list timed out")), STATE_LIST_TIMEOUT_MS).unref?.();
			})]);
		} catch (error) {
			console.error(`[dsh-remote-workspace] reg.list failed for "${targetId}": ${scrubSecrets(error instanceof Error ? error.message : String(error))}`);
		}
		return out;
	}
	/**
	* One target's `reg.list`, memoized for {@link SERVER_LIST_TTL_MS}.
	*
	* Never persisted: the server is the authority, this is a short-lived copy so
	* `/api/state` polling does not issue one RPC per target per frame (A38). Every
	* workspace write invalidates it explicitly.
	*/
	async serverWorkspacesOf(targetId, options = {}) {
		const cached = this.serverWorkspaceCache.get(targetId);
		if (options.refresh !== true && cached !== void 0 && Date.now() - cached.at < SERVER_LIST_TTL_MS) return [...cached.items];
		const items = await this.listRemoteWorkspaces(targetId);
		this.serverWorkspaceCache.set(targetId, {
			items,
			at: Date.now()
		});
		for (const item of items) this.workspacePaths.set(`${targetId}\u0000${String(item.id)}`, item.path);
		await this.reconcileWorkspaceRefs(targetId, items).catch((error) => {
			console.error(`[dsh-remote-workspace] reconciling workspace refs for "${targetId}" failed: ${scrubSecrets(error instanceof Error ? error.message : String(error))}`);
		});
		return [...items];
	}
	/**
	* One local ref by **local id or server workspace id**.
	*
	* Since P0 the visible identity of a workspace is the server's 16-hex id, while
	* the ref keeps its own `wr-…` id for the tree, so both are legal keys on the
	* wire — resolving here keeps every caller (sessions, flags, delete) honest
	* without depending on which one the client happened to send.
	*/
	refOf(key) {
		const direct = this.store.workspace(key);
		if (direct !== void 0) return direct;
		return this.store.listWorkspaces().find((record) => record.remoteWorkspaceId === key);
	}
	/** Drop one target's cached server list after any workspace write. */
	invalidateServerWorkspaces(targetId) {
		this.serverWorkspaceCache.delete(targetId);
	}
	/**
	* Align this client's refs with one target's server list.
	*
	* Three cases, all required by "two clients see each other's workspaces":
	*
	* 1. **server has it, this client does not** → create a bare ref
	*    (`targetId` + `remoteWorkspaceId` only): no stub, no shell row, nothing
	*    fetched — opening it later materializes those.
	* 2. **this client has it, the server does not** → the workspace was deleted
	*    elsewhere; drop the ref and its stub directory (the session logs on the
	*    server are untouched by design).
	* 3. **legacy ref** (`remoteWorkspaceId` absent but `path` present) → adopt the
	*    server's id for that path, or `reg.create` it once, then clear the legacy
	*    fields. This is the P0 migration; it runs only when a connection exists, so
	*    startup never dials a host just to migrate.
	* @param targetId - connected target.
	* @param items - its freshly read `reg.list`.
	*/
	async reconcileWorkspaceRefs(targetId, items) {
		const refs = this.store.listWorkspaces(targetId);
		const idByPath = new Map(items.map((item) => [item.path, String(item.id)]));
		const serverIds = new Set(items.map((item) => String(item.id)));
		for (const ref of refs) {
			let remoteWorkspaceId = ref.remoteWorkspaceId;
			if (remoteWorkspaceId === void 0 && ref.path !== void 0) {
				let id = idByPath.get(ref.path);
				if (id === void 0) {
					const created = await this.ensureRemoteWorkspace(targetId, ref.path, ref.title);
					id = String(created.id);
					idByPath.set(ref.path, id);
					serverIds.add(id);
					this.workspacePaths.set(`${targetId}\u0000${id}`, ref.path);
				}
				remoteWorkspaceId = id;
			}
			if (remoteWorkspaceId === void 0) {
				await this.store.deleteWorkspace(ref.id);
				continue;
			}
			const cleaned = stripLegacyRefFields(ref, remoteWorkspaceId);
			if (cleaned !== void 0) await this.store.putWorkspace(cleaned);
			if (serverIds.has(String(remoteWorkspaceId))) continue;
			await this.store.deleteWorkspace(ref.id);
			this.workspacePaths.delete(`${targetId}\u0000${String(remoteWorkspaceId)}`);
			if (ref.stubPath !== void 0) await rm(ref.stubPath, {
				recursive: true,
				force: true
			}).catch(() => {});
		}
		const known = new Set(this.store.listWorkspaces(targetId).map((ref) => String(ref.remoteWorkspaceId ?? "")));
		for (const item of items) {
			if (known.has(String(item.id))) continue;
			await this.store.putWorkspace({
				id: `wr-${randomUUID().slice(0, 8)}`,
				targetId,
				remoteWorkspaceId: String(item.id)
			});
		}
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
		const kind = request.kind ?? "ssh";
		const wsl = kind === "wsl";
		if (!methodAvailable(wsl ? "wsl" : "ssh", process.platform)) throw new Error(`the "${kind}" connection method is not available on ${process.platform}`);
		const distro = (request.wslDistro ?? "").trim();
		if (wsl && distro === "") throw new Error("a WSL target needs a distribution name");
		const existing = this.store.listTargets().find((record) => record.label.toLowerCase() === request.label.toLowerCase());
		let draft = targetDraftFrom({
			request,
			existing
		});
		const privateKey = !wsl && draft.privateKeyPath !== void 0 ? await readPrivateKey(draft.privateKeyPath) : void 0;
		let fingerprint = draft.hostKeyFingerprint;
		let provisioned;
		for (let attempt = 0; attempt < 2; attempt++) try {
			provisioned = await provisionTarget({
				target: draft,
				...wsl || request.secret === void 0 ? {} : { secret: request.secret },
				...privateKey === void 0 ? {} : { privateKey },
				packageRoot: this.options.packageRoot,
				packagePolicy: this.store.packagePolicy(),
				...fingerprint === "" ? {} : { hostKeyFingerprint: fingerprint },
				...request.reuseLauncherPath === void 0 || request.reuseLauncherPath.trim() === "" ? {} : { reuseLauncherPath: request.reuseLauncherPath.trim() },
				onEvent: (event) => {
					ticket.events.push(event);
					emit(event);
				}
			});
			break;
		} catch (error) {
			if (!wsl && error instanceof HostKeyUnknownError && attempt === 0) {
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
		const provisionedAt = (/* @__PURE__ */ new Date()).toISOString();
		draft = {
			...draft,
			...wsl ? {} : { hostKeyFingerprint: provisioned.fingerprint === "" ? fingerprint : provisioned.fingerprint },
			status: "ready",
			lastConnectedAt: provisionedAt,
			...provisionedHints(provisioned, provisionedAt)
		};
		if (!wsl) {
			if (request.secret !== void 0) draft = await this.store.storeSecret(draft, request.secret);
			else if (existing !== void 0) draft = await this.store.storeSecret(draft, "");
		}
		await this.store.putTarget(draft);
		this.channels.set(draft.id, provisioned.channel);
		this.invalidateServerWorkspaces(draft.id);
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
		const transport = await openTransport({
			target,
			...secret === void 0 ? {} : { secret },
			...privateKey === void 0 ? {} : { privateKey },
			packageRoot: this.options.packageRoot
		});
		try {
			return await transport.exec(command, {
				maxBytes: 262144,
				timeoutMs: 2e4
			});
		} finally {
			await transport.close().catch(() => {});
		}
	}
	/**
	* The stored target that already stands for the host a scan was asked about.
	*
	* Only used to reuse its pinned host-key fingerprint, so rescanning a known
	* host does not ask the user to trust it again. `undefined` = first contact
	* with this host, and the scan answers `stage: 'host-key'`.
	*/
	storedTargetFor(kind, request) {
		const targets = this.store.listTargets();
		if (kind === "wsl") {
			const distro = (request.wslDistro ?? "").trim();
			return targets.find((record) => record.kind === "wsl" && record.wslDistro === distro);
		}
		const host = (request.host ?? "").trim().toLowerCase();
		const port = request.port ?? 22;
		const username = (request.username ?? "").trim();
		return targets.find((record) => record.kind === "ssh" && record.host.toLowerCase() === host && record.port === port && record.username === username);
	}
	/**
	* Scan one host/distro **before** connecting (api-contract §2).
	*
	* Answer two wizard questions with one throwaway transport and one read-only
	* script: which architecture a server package would have to target (plus
	* whether the local cache already holds it), and which dsh launchers exist
	* (plus whether this plugin is installed and current in the target profile).
	*
	* Like {@link runCommand}, nothing here is stored or kept: no channel, no
	* record, no file written on the far side. The host key is *not* pinned —
	* that happens on the first successful connect (`runConnect`); an unconfirmed
	* key answers `stage: 'host-key'` so the wizard shows the same trust panel.
	* @param request - host/distro plus transient credentials.
	* @returns the architecture/package/candidate report, or the fingerprint to confirm.
	*/
	async scanDsh(request) {
		const kind = request.kind ?? "ssh";
		const wsl = kind === "wsl";
		if (!methodAvailable(wsl ? "wsl" : "ssh", process.platform)) throw codedError("unsupported", `the "${kind}" connection method is not available on ${process.platform}`);
		const draft = scanDraft(request);
		const where = wsl ? `WSL ${draft.wslDistro ?? ""}` : `${draft.host}:${draft.port}`;
		const privateKey = draft.privateKeyPath === void 0 ? void 0 : await readPrivateKey(draft.privateKeyPath).catch((error) => {
			throw codedError("scan-failed", `cannot read the private key ${draft.privateKeyPath ?? ""}: ${error instanceof Error ? error.message : String(error)}`);
		});
		const stored = this.storedTargetFor(kind, request);
		const pinned = request.hostKeyFingerprint ?? stored?.hostKeyFingerprint ?? "";
		let transport;
		try {
			transport = await openTransport({
				target: draft,
				...wsl || request.secret === void 0 ? {} : { secret: request.secret },
				...privateKey === void 0 ? {} : { privateKey },
				packageRoot: this.options.packageRoot,
				...pinned === "" ? {} : { hostKeyFingerprint: pinned }
			});
		} catch (error) {
			if (!wsl && error instanceof HostKeyUnknownError) return {
				stage: "host-key",
				fingerprint: error.fingerprint
			};
			throw codedError("scan-failed", `cannot reach ${where}: ${scrubSecrets(error instanceof Error ? error.message : String(error))}`);
		}
		try {
			const configuredHome = (request.dshHome ?? draft.remote.dshHome ?? "").trim();
			const result = await withScanDeadline(transport.exec(sh(scanDshScript(configuredHome === "" ? {} : { dshHome: configuredHome })), {
				maxBytes: 65536,
				timeoutMs: 55e3
			}), SCAN_TIMEOUT_MS);
			if (result.code !== 0) {
				const tail = scrubSecrets(result.stderr.trim().slice(-2e3));
				throw codedError("scan-failed", `the dsh scan on ${where} failed (exit ${result.code ?? "signal"}): ${tail !== "" ? tail : "no stderr output"}`);
			}
			let scan;
			try {
				scan = parseDshScanOutput(result.stdout);
			} catch (error) {
				throw codedError("scan-failed", `the dsh scan on ${where} produced unreadable output: ${error instanceof Error ? error.message : String(error)}`);
			}
			const home = scan.home ?? "";
			if (home === "" || !home.startsWith("/")) throw codedError("scan-failed", `cannot determine the remote home directory on ${where}`);
			const { platform, arch, libc } = probeFactsFrom({
				uname: scan.platform ?? "",
				machine: scan.machine ?? "",
				ostype: scan.ostype ?? "",
				ldd: scan.ldd ?? ""
			});
			const tag = artifactTag(platform, arch, libc);
			const dshHome = expandRemoteHome(scan.dshHome ?? configuredHome, home);
			const profile = (request.profile ?? draft.remote.profile).trim();
			const profileDir = profileDirFor(dshHome, home, profile);
			let expectedPluginSha;
			try {
				expectedPluginSha = await sha256OfFiles(await profileFileSet(this.options.packageRoot, profileDir, profile));
			} catch {
				expectedPluginSha = void 0;
			}
			return {
				stage: "done",
				probe: {
					platform,
					arch,
					libc,
					platformArch: platformArch(platform, arch),
					tag,
					home,
					tools: scanTools(scan.tools)
				},
				package: await describeLocalPackage({
					version: dshReleaseVersion(this.options.packageRoot),
					platform,
					arch,
					libc
				}),
				dshHome,
				profiles: scan.profiles.map((entry) => entry.name),
				candidates: assembleCandidates(scan, {
					profile,
					...expectedPluginSha === void 0 ? {} : { expectedPluginSha }
				})
			};
		} finally {
			await transport.close().catch(() => {});
		}
	}
	/**
	* Rename one workspace **on the server** (`reg.rename`, contract §14.2).
	*
	* P0 reversal (A34): the title is server-authoritative, so another client sees
	* the new name, and the id/path never change. Nothing is moved on disk — the
	* remote directory keeps its name and the session logs keep their cwd, so
	* history stays reachable.
	* @param targetId - stored target (must be connected).
	* @param remoteWorkspaceId - server workspace id (16 hex).
	* @param title - raw user input; normalized with the official rules.
	*/
	async renameWorkspace(targetId, remoteWorkspaceId, title) {
		const normalized = this.normalizeTitle(title);
		if (normalized === "") throw codedError("bad-request", "workspace title must contain visible characters");
		this.requireConnectedForWrite(targetId, "renaming a workspace");
		const renamed = await this.withBrowser(targetId, async (client) => await client.request("reg.rename", {
			id: remoteWorkspaceId,
			title: normalized
		}, z.object({
			id: z.string().length(16),
			title: z.string()
		}), AbortSignal.timeout(2e4)));
		this.invalidateServerWorkspaces(targetId);
		return { workspace: (await this.serverWorkspacesOf(targetId, { refresh: true })).find((item) => String(item.id) === String(remoteWorkspaceId)) ?? {
			id: renamed.id,
			path: this.workspacePaths.get(`${targetId}\u0000${String(remoteWorkspaceId)}`) ?? "",
			title: renamed.title,
			createdAt: "",
			sessionCount: 0
		} };
	}
	/**
	* Remove one workspace **from the server registry** (`reg.delete`, A35).
	*
	* `force: false` refuses a workspace that still has sessions
	* (`workspace-not-empty <n>`, mapped to HTTP 409); `force: true` removes the
	* entry only — the session logs stay on the server, so re-adding the path
	* brings its history back. This client's ref and stub directory go away either
	* way.
	* @param targetId - stored target (must be connected).
	* @param remoteWorkspaceId - server workspace id (16 hex).
	* @param force - delete even when the workspace still has sessions.
	*/
	async deleteWorkspace(targetId, remoteWorkspaceId, force = false) {
		this.requireConnectedForWrite(targetId, "removing a workspace");
		let result;
		try {
			result = await this.withBrowser(targetId, async (client) => await client.request("reg.delete", {
				id: remoteWorkspaceId,
				...force ? { force: true } : {}
			}, z.object({
				removed: z.boolean(),
				sessionCount: z.number()
			}), AbortSignal.timeout(2e4)));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const notEmpty = /workspace-not-empty (\d+)/.exec(message);
			if (notEmpty !== null) throw codedError("workspace-not-empty", `workspace-not-empty ${notEmpty[1] ?? "0"}`);
			throw error;
		}
		this.invalidateServerWorkspaces(targetId);
		this.workspacePaths.delete(`${targetId}\u0000${String(remoteWorkspaceId)}`);
		const refsDropped = [];
		for (const ref of this.store.listWorkspaces(targetId)) {
			if (String(ref.remoteWorkspaceId ?? "") !== String(remoteWorkspaceId)) continue;
			await this.dropRefLocally(ref);
			refsDropped.push(ref.id);
		}
		return {
			...result,
			refsDropped
		};
	}
	/** Drop one local ref and its stub directory (never the server's session logs). */
	async dropRefLocally(ref) {
		const registry = this.ctx.get("workspaceRegistry");
		if (ref.officialWorkspaceId !== void 0) await Promise.resolve(registry?.delete?.(ref.officialWorkspaceId)).catch(() => {});
		if (ref.stubPath !== void 0) await rm(ref.stubPath, {
			recursive: true,
			force: true
		}).catch(() => {});
		await this.store.deleteWorkspace(ref.id);
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
			return {
				id: ((await client.request("reg.list", {}, z.array(workspaceSummarySchema), AbortSignal.timeout(2e4))).find((item) => item.path === path) ?? await client.request("reg.create", {
					path,
					...title === void 0 ? {} : { title }
				}, workspaceSummarySchema, AbortSignal.timeout(2e4))).id,
				...client.serverInfo === void 0 ? {} : { serverId: client.serverInfo.serverId }
			};
		});
	}
	/**
	* Run one browse operation on a **dedicated, cached** channel.
	*
	* One `FrameMux`/`SshRpcPeer` pair owns a byte stream, and the realm's
	* `RemoteConnection` installs its own pair on the target's cached channel the
	* moment a session opens. Sharing that channel here therefore put two
	* independent de-multiplexers on one stream — an RPC id collision either side
	* corrupts the other, and the old retry closed the *shared* channel, which on
	* a WSL target kills the in-distro process an agent is using ("SSH connection
	* lost; remote operation outcome and cleanup are unknown").
	*
	* So browsing keeps its **own** client per target: the first operation pays
	* one marker-fast provisioning pass, every later one is a single RPC. It is
	* retired after {@link BROWSE_IDLE_MS} of silence (the remote server also has
	* its own lease), on a failure, on 停止/忘记 and on dispose.
	*/
	async withBrowser(targetId, operation) {
		const attempt = (this.browserQueue.get(targetId) ?? Promise.resolve()).then(async () => {
			const client = await this.browserFor(targetId);
			try {
				return await operation(client);
			} catch (error) {
				await this.retireBrowser(targetId);
				const retried = await this.browserFor(targetId);
				try {
					return await operation(retried);
				} catch (second) {
					await this.retireBrowser(targetId);
					throw second;
				}
			} finally {
				this.touchBrowser(targetId);
			}
		});
		this.browserQueue.set(targetId, attempt.then(() => void 0, () => void 0));
		return await attempt;
	}
	/** Reuse the target's client (browsing and the realm share it). */
	async browserFor(targetId) {
		const cached = this.browsers.get(targetId);
		if (cached !== void 0) {
			this.touchBrowser(targetId);
			return cached.client;
		}
		const client = await this.openBrowser(targetId);
		const timer = setTimeout(() => {
			this.retireBrowser(targetId);
		}, BROWSE_IDLE_MS);
		timer.unref();
		this.browsers.set(targetId, {
			client,
			idle: timer
		});
		return client;
	}
	/**
	* The target's shared client, for the realm-scoped `ctx.ssh` adapter.
	*
	* Pinned for the caller so idle retirement cannot pull the peer out from under
	* a live session; the adapter releases it in `dispose()`.
	* @param targetId - stored target.
	* @returns the one RPC client of this target.
	*/
	async remoteClient(targetId) {
		const client = await this.browserFor(targetId);
		client.pin();
		return client;
	}
	/** Drop one pin taken by {@link remoteClient} and restart the idle clock. */
	releaseRemoteClient(targetId) {
		const entry = this.browsers.get(targetId);
		if (entry === void 0) return;
		entry.client.unpin();
		this.touchBrowser(targetId);
	}
	/** Restart the idle countdown for one browsing client. */
	touchBrowser(targetId) {
		const entry = this.browsers.get(targetId);
		if (entry === void 0) return;
		clearTimeout(entry.idle);
		const timer = setTimeout(() => {
			this.retireBrowser(targetId);
		}, BROWSE_IDLE_MS);
		timer.unref();
		this.browsers.set(targetId, {
			client: entry.client,
			idle: timer
		});
	}
	/** Close and forget one browsing client; safe when none is cached. */
	async retireBrowser(targetId) {
		const entry = this.browsers.get(targetId);
		if (entry === void 0) return;
		if (entry.client.pinned) {
			this.touchBrowser(targetId);
			return;
		}
		this.browsers.delete(targetId);
		clearTimeout(entry.idle);
		await entry.client.close().catch(() => {});
	}
	/**
	* Attach a browsing client to the target's **single** server channel.
	*
	* One remote server process per target is a hard requirement, not a
	* preference: `persist.create` answers with an in-memory handle and the log
	* stays off disk until it is flushed (`session.lock` only), so a `persist.*`
	* call that lands on a *second* server process answers `session "…" not
	* found`. That is exactly what happened when browsing was given its own
	* transport — `sessionRequest()` goes through this client, so it must reach
	* the same process the realm talks to (`connectChannel`).
	*
	* Consequence: the browsing client never closes the channel (see
	* `RemoteClient.close`); 停止/忘记 close it explicitly.
	* @param targetId - stored target.
	* @returns an open browsing client; owned by {@link browsers} afterwards.
	*/
	async openBrowser(targetId) {
		const channel = await this.connectChannel(targetId);
		return await RemoteClient.open(channel, "/", this.options.leaseMs);
	}
	/**
	* stub → remote aliases for every materialized workspace of one target.
	*
	* The remote path is **not** stored on the ref any more (the server owns it), so
	* it comes from the path this process learned — `reg.list`, or the
	* `openWorkspace`/session call that carried it. A ref with an unknown path is
	* absent from the alias list on purpose: rewriting a stub path into a path that
	* does not exist on the remote would run tools in the wrong directory.
	*/
	pathAliases(targetId) {
		const aliases = [];
		for (const record of this.store.listWorkspaces(targetId)) {
			if (record.stubPath === void 0) continue;
			const remote = this.remotePathOf(targetId, record);
			if (remote === void 0) continue;
			aliases.push({
				stub: record.stubPath,
				remote
			});
		}
		return aliases;
	}
	/** The remote path of one ref: learned this process, or the legacy field. */
	remotePathOf(targetId, record) {
		if (record.remoteWorkspaceId !== void 0) {
			const known = this.workspacePaths.get(`${targetId}\u0000${String(record.remoteWorkspaceId)}`);
			if (known !== void 0) return known;
		}
		return record.path;
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
	async listRemoteWorkspaces(targetId, includeActivity = true) {
		return await this.withBrowser(targetId, async (client) => {
			return (await client.request("reg.list", includeActivity ? { includeActivity: true } : {}, z.array(workspaceSummarySchema), AbortSignal.timeout(2e4))).map((row) => ({
				id: row.id,
				path: row.path,
				title: row.title,
				createdAt: row.createdAt ?? "",
				sessionCount: row.sessionCount ?? 0,
				...row.updatedAt === void 0 ? {} : { updatedAt: row.updatedAt }
			}));
		});
	}
	/**
	* Sessions stored on the remote server for one workspace (`persist.list`).
	* @param targetId - stored target.
	* @param workspaceRecordId - the plugin's own workspace record id.
	*/
	async listRemoteSessions(targetId, workspaceRecordId) {
		const record = this.refOf(workspaceRecordId);
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
		const drafts = /* @__PURE__ */ new Map();
		for (const summary of summaries) {
			const meta = titles.get(String(summary.id));
			if (meta !== void 0 && meta.title !== "") continue;
			drafts.set(String(summary.id), await this.draftOf(targetId, workspaceId, String(summary.id), summary.sizeBytes));
		}
		return summaries.map((summary) => {
			const meta = titles.get(String(summary.id));
			return {
				id: String(summary.id),
				...summary.createdAt === void 0 ? {} : { createdAt: summary.createdAt },
				...summary.sizeBytes === void 0 ? {} : { sizeBytes: summary.sizeBytes },
				...meta === void 0 || meta.title === "" ? {} : { title: meta.title },
				...meta?.updatedAt === void 0 ? {} : { updatedAt: meta.updatedAt },
				...drafts.get(String(summary.id)) === true ? { draft: true } : {}
			};
		}).sort((left, right) => (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0));
	}
	/**
	* Whether one stored session is still a **draft** — its log has no `turn/start`.
	*
	* The verdict comes from the session's own log, never from its title or size: the
	* routing/session planes already treat "no turn" as blank, and this is the same
	* fact read through `persist.open(mode: 'read')`.
	*
	* The read open is deliberately used instead of a write open: the official backend
	* only claims write ownership on a write open (`session-persistence-jsonl`
	* `open()` — the read branch adopts a handle without a lease), so a draft the
	* shell is holding open right now can still be inspected, and this check can never
	* steal the shell's handle. The handle is closed in `finally` because the server
	* keeps its handle table in memory until then.
	*
	* **Fails open**: any error (unreadable log, an unexpected payload, a server that
	* predates the plane) answers `false` with a warning. Showing one extra row is
	* recoverable; hiding a real conversation is not.
	* @param targetId - connected target holding the log.
	* @param workspaceId - the server workspace the session belongs to; the server
	*   verifies the log's cwd against it, so it must be the id `persist.list` used.
	* @param sessionId - stored session id.
	* @param sizeBytes - log size from `persist.list`, the memo's version stamp.
	* @returns true only when the log was read and contains no `turn/start`.
	*/
	async draftOf(targetId, workspaceId, sessionId, sizeBytes) {
		if (sizeBytes !== void 0 && sizeBytes > DRAFT_SCAN_MAX_BYTES) return false;
		const key = `${targetId}\u0000${workspaceId}\u0000${sessionId}`;
		const cached = this.draftCache.get(key);
		if (cached !== void 0 && cached.sizeBytes === sizeBytes) return cached.draft;
		let handleId;
		try {
			const payload = await this.sessionRequest(targetId, "persist.open", {
				workspaceId,
				sessionId,
				mode: "read"
			});
			if (typeof payload.handleId !== "string") throw new Error("persist.open did not return a handle id");
			handleId = payload.handleId;
			if (!Array.isArray(payload.events)) throw new Error("persist.open did not return the session events");
			const draft = !payload.events.some((event) => event.type === "turn/start");
			this.draftCache.set(key, {
				sizeBytes,
				draft
			});
			return draft;
		} catch (error) {
			console.warn(`[dsh-remote-workspace] draft check for session "${sessionId}" failed (treated as a conversation): ` + scrubSecrets(error instanceof Error ? error.message : String(error)));
			return false;
		} finally {
			if (handleId !== void 0) await this.sessionRequest(targetId, "persist.close", { handleId }).catch((error) => {
				console.warn(`[dsh-remote-workspace] closing the draft-check handle for "${sessionId}" failed: ${scrubSecrets(error instanceof Error ? error.message : String(error))}`);
			});
		}
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
			const path = this.remotePathOf(targetId, record);
			if (path === void 0) throw error;
			await this.ensureRemoteWorkspace(targetId, path, record.title).catch(() => {});
			this.invalidateServerWorkspaces(targetId);
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
		await assertRemoteRealm(this.ctx, targetId);
		const target = this.requireConnectedTarget(targetId, "creating a session");
		const listing = await this.listDirectory(targetId, path);
		const remote = await this.ensureRemoteWorkspace(targetId, listing.path, title);
		this.workspacePaths.set(`${targetId}\u0000${String(remote.id)}`, listing.path);
		this.invalidateServerWorkspaces(targetId);
		const materialized = await this.materializeWorkspace(target, {
			path: listing.path,
			remoteWorkspaceId: String(remote.id)
		});
		const opened = await openSessionInRealm("create", targetId, () => openRemoteSession(this.ctx, {
			targetId,
			path: materialized.stub
		}));
		assertRealmComposed(this.ctx, targetId, opened.sessionId);
		return await this.finishOpen(materialized, opened.sessionId);
	}
	/**
	* Prepare one remote directory for the **official new-conversation draft**.
	*
	* This is {@link openWorkspace} minus the session. The shell's draft page binds
	* itself to a workspace and only creates the session when the first message is
	* sent (client `uiWorkspace.startSession(workspaceId)` → host `sessions.create`
	* → `sessionPersistence.create`), so everything a session needs must already
	* exist *before* any session does:
	*
	* - the server-side workspace entry (`reg.create`, idempotent): the routing
	*   persistence sends `create(header.cwd = <stub>)` to that workspace, and the
	*   server rewrites the header cwd to the remote path;
	* - the local stub directory **and** the record carrying `stubPath` +
	*   `remoteWorkspaceId`: without them `routeForCwd` misses and the shell's
	*   session would be written to this machine's JSONL store instead of the
	*   remote host — silently, which is the one outcome that must not happen;
	* - the official **shell workspace row**: the draft page resolves its workspace
	*   from the shell's own list, so the row is what makes the draft bindable. That
	*   is why this path forces registration while Gate 0 keeps it off elsewhere
	*   (see `officialWorkspaceFor`). The row stays invisible: the client hides
	*   `[data-slot="sidebar.workspaces"]` stub rows and `watchShellRows` drops the
	*   sessions that belong to this plugin.
	*
	* Nothing here creates, resumes or references a session: `ctx.agents` is never
	* touched and no new session id is written (`record.sessionId` keeps whatever
	* pointer it already had — a prepared workspace is still "the same row"). The
	* session appears later, through the shell's own create, and the server assigns
	* it to this workspace by `header.cwd`.
	*
	* **Idempotent by contract** — the client calls it right before *every* draft,
	* which also re-creates a shell row the sweep removed (see the risk note below):
	* an existing server entry is reused, an existing record keeps its id and stub,
	* an existing shell row is resolved by path, and no session appears.
	*
	* Risk the caller must handle: `POST /api/cleanup-shell-workspaces` (the tree's
	* 刷新) and the startup sweep delete every registry row under the stub root, so a
	* row prepared earlier can be gone. Calling this again restores it; a draft
	* opened with a stale `officialWorkspaceId` fails in the shell, not here.
	* @param targetId - stored target; must already be connected.
	* @param path - absolute remote directory.
	* @param title - display title; defaults to the last path segment.
	* @returns the materialized record (with its shell row id) and the stub path.
	*/
	async prepareWorkspace(targetId, path, title) {
		const target = this.requireConnectedForWrite(targetId, "preparing a workspace");
		await assertRemoteRealm(this.ctx, targetId);
		const listing = await this.listDirectory(targetId, path);
		const remote = await this.ensureRemoteWorkspace(targetId, listing.path, title);
		this.workspacePaths.set(`${targetId}\u0000${String(remote.id)}`, listing.path);
		this.invalidateServerWorkspaces(targetId);
		const materialized = await this.materializeWorkspace(target, {
			path: listing.path,
			remoteWorkspaceId: String(remote.id),
			forceShellWorkspace: true
		});
		const officialWorkspaceId = materialized.record.officialWorkspaceId;
		if (officialWorkspaceId === void 0) throw codedError("shell-workspace-unavailable", `remote workspace "${targetId}": the shell workspace row for "${materialized.stub}" could not be registered, so the new-conversation draft cannot be bound to it; this needs the dsh workspace registry`);
		const record = {
			...materialized.record,
			lastOpenedAt: materialized.now
		};
		await this.store.putWorkspace(record);
		return {
			workspace: record,
			stubPath: record.stubPath ?? materialized.stub,
			officialWorkspaceId
		};
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
		await assertRemoteRealm(this.ctx, targetId);
		assertLiveSessionInRealm(this.ctx, targetId, sessionId);
		const target = this.requireConnectedTarget(targetId, "continuing a session");
		const listing = await this.listDirectory(targetId, path);
		const remote = await this.ensureRemoteWorkspace(targetId, listing.path, title);
		this.workspacePaths.set(`${targetId}\u0000${String(remote.id)}`, listing.path);
		this.invalidateServerWorkspaces(targetId);
		const materialized = await this.materializeWorkspace(target, {
			path: listing.path,
			remoteWorkspaceId: String(remote.id)
		});
		const opened = await openSessionInRealm("resume", targetId, () => resumeRemoteSession(this.ctx, {
			targetId,
			sessionId
		}));
		assertRealmComposed(this.ctx, targetId, opened.sessionId);
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
	* Same gate for a **workspace write** (`reg.rename` / `reg.delete`).
	*
	* These go to the server, so a stopped target cannot serve them; answering a
	* bare 500 ("internal") gave the user nothing to act on (alpha58). The client
	* gets `409 target-not-connected` and can say "connect this host first".
	* @param targetId - stored target.
	* @param action - what was refused, for the message.
	*/
	requireConnectedForWrite(targetId, action) {
		try {
			return this.requireConnectedTarget(targetId, action);
		} catch (error) {
			if (error.code !== "not-connected") throw error;
			throw codedError("target-not-connected", `remote target "${targetId}" is not connected; connect the host first (请先连接该主机) before ${action}`);
		}
	}
	/**
	* Everything a session needs to exist for a remote directory: the server-side
	* workspace entry, the local stub directory, the shell-tree workspace and the
	* plugin's own record — in that order, and **persisted before any session is
	* created** (the routing persistence resolves `create(header.cwd)` and
	* re-anchors `open()` headers through this record, so an unmaterialized stub
	* would leave the session unroutable).
	*/
	async materializeWorkspace(target, options) {
		const { path, remoteWorkspaceId } = options;
		const existing = this.store.listWorkspaces(target.id).find((record) => record.remoteWorkspaceId === remoteWorkspaceId);
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const displayTitle = path === "/" ? target.label : path.split("/").filter(Boolean).at(-1) ?? target.label;
		const registry = this.ctx.get("workspaceRegistry");
		const key = createHash("sha1").update(`${target.id}\u0000${path}`).digest("hex").slice(0, 8);
		const stubRoot = join$1(homedir(), ".dsh", "remote-workspaces", target.id);
		const stub = join$1(stubRoot, key);
		await mkdir(stub, { recursive: true });
		const canonicalStub = await realpath(stub);
		const official = await officialWorkspaceFor({
			registry,
			canonicalStub,
			shellTitle: `${displayTitle} · ${target.label}`,
			...options.forceShellWorkspace === true ? { force: true } : {}
		});
		const record = {
			id: existing?.id ?? `wr-${randomUUID().slice(0, 8)}`,
			targetId: target.id,
			remoteWorkspaceId,
			stubPath: official?.path ?? canonicalStub,
			...official === void 0 ? {} : { officialWorkspaceId: official.id },
			...existing?.pinnedSessions === void 0 ? {} : { pinnedSessions: existing.pinnedSessions },
			...existing?.archivedSessions === void 0 ? {} : { archivedSessions: existing.archivedSessions },
			...existing?.lastOpenedAt === void 0 ? {} : { lastOpenedAt: existing.lastOpenedAt },
			...existing?.sessionId === void 0 ? {} : { sessionId: existing.sessionId }
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
	/**
	* Rename one stored remote session.
	*
	* **No session is opened.** The official rename is one `session/title` append
	* with `source: {kind:'user'}`; the shell's title service is session-scoped, so
	* it needs a live session, but on the remote plane the log is appendable
	* directly — so this normalizes the text with the official normalizer and asks
	* the target's server to append the event (`persist.rename`). Nothing is
	* resumed, no agent is created, and no conversation is revealed.
	*
	* The one case that does go through the title service is a session that is
	* *already live in this process*: it holds the log's write lease, so the
	* server would refuse the open, and the in-memory session is the right place
	* to append anyway.
	*
	* @param targetId - stored target.
	* @param path - absolute remote workspace directory.
	* @param sessionId - stored remote session id.
	* @param title - raw user input; normalized here.
	*/
	async renameSession(targetId, path, sessionId, title) {
		const normalized = this.normalizeTitle(title);
		if (normalized === "") throw new Error("session title must contain visible characters");
		const liveSessions = this.ctx.get("sessions");
		const live = liveSessions?.get(sessionId);
		if (live !== void 0) {
			const titles = this.ctx.get("sessionTitle");
			if (titles === void 0) throw new Error("the session title service is unavailable");
			titles.rename(live, normalized);
			await liveSessions?.flush?.(live).catch(() => {});
			return;
		}
		this.requireConnectedTarget(targetId, "renaming a session");
		const workspaceId = await this.remoteWorkspaceIdFor(targetId, path);
		await this.sessionRequest(targetId, "persist.rename", {
			workspaceId,
			sessionId,
			title: normalized
		});
	}
	/** Normalize user title text with the official normalizer (same rules, same cap). */
	normalizeTitle(title) {
		const maxBytes = this.ctx.get("sessionTitle")?.config?.maxTitleBytes ?? 200;
		return normalizeSessionTitle(title, maxBytes);
	}
	/**
	* The server-side workspace id for one remote directory, discovering the
	* workspace when this machine has never opened it (no stub, no session).
	*/
	async remoteWorkspaceIdFor(targetId, path) {
		const record = this.store.listWorkspaces(targetId).find((candidate) => candidate.path === path);
		if (record?.remoteWorkspaceId !== void 0) return record.remoteWorkspaceId;
		const listing = await this.listDirectory(targetId, path);
		return (await this.ensureRemoteWorkspace(targetId, listing.path)).id;
	}
	/**
	* Pin/unpin or archive/unarchive one stored session of a remote workspace.
	*
	* Both sets live on the plugin's own workspace record (see
	* `RemoteWorkspaceRecord.pinnedSessions`): the shell's registry-global sets
	* cannot hold a remote session, because its pin/archive APIs resolve the id
	* against the local session index and answer `session/not-found`.
	*
	* @param workspaceId - the plugin's workspace record id.
	* @param sessionId - the stored remote session id.
	* @param flag - which set to change.
	* @param on - add (`true`) or drop (`false`) the id.
	* @returns the updated record.
	*/
	async setSessionFlag(workspaceId, sessionId, flag, on) {
		const record = this.refOf(workspaceId);
		if (record === void 0) throw new Error(`unknown remote workspace "${workspaceId}"`);
		const key = flag === "pinned" ? "pinnedSessions" : "archivedSessions";
		const current = record[key] ?? [];
		const next = on ? flag === "pinned" ? [sessionId, ...current.filter((id) => id !== sessionId)] : [...current.filter((id) => id !== sessionId), sessionId] : current.filter((id) => id !== sessionId);
		const otherKey = flag === "pinned" ? "archivedSessions" : "pinnedSessions";
		const other = (record[otherKey] ?? []).filter((id) => id !== sessionId);
		const updated = {
			...record,
			[key]: next.length === 0 ? void 0 : next,
			[otherKey]: other.length === 0 ? void 0 : other
		};
		await this.store.putWorkspace(updated);
		return updated;
	}
	/**
	* Forget one workspace **locally only**.
	*
	* P2: the `forget-workspace` route is an alias of `workspace-delete`, so this
	* method is the fallback used when the server cannot be asked (offline target,
	* or a legacy ref with no server id): drop the ref and its stub, never the
	* server's session logs.
	*/
	async forgetWorkspace(workspaceId) {
		const record = this.refOf(workspaceId);
		if (record === void 0) return false;
		await this.dropRefLocally(record);
		return true;
	}
	/** Close every channel and browsing session, then scrub leaked shell rows. */
	async dispose() {
		for (const targetId of [...this.browsers.keys()]) await this.retireBrowser(targetId);
		for (const channel of this.channels.values()) await channel.close().catch(() => {});
		this.channels.clear();
		for (const ticket of this.tickets.values()) ticket.confirm?.("");
		this.tickets.clear();
		await scrubShellWorkspaces(this.ctx).catch(() => {});
	}
	/**
	* Run the shell-row sweep on demand (`POST /api/cleanup-shell-workspaces`).
	*
	* Always runs: it is the operator's explicit repair action, so the
	* once-per-process flag must not suppress it.
	*/
	async scrubShellWorkspaces(options = {}) {
		return await scrubShellWorkspaces(this.ctx, options);
	}
	/**
	* Sweep **at most once per process**, and only when the shell registry exists.
	*
	* This is the startup / first-`/api/state` safety net (alpha59).
	* `workspaceRegistry` is deliberately not injected (AGENTS 3: that edge
	* deadlocks against `sessionPersistence`), so at `storageReady` time it can still
	* be `undefined` — alpha58's startup sweep silently took the no-op branch and the
	* leaked rows survived until someone hit the route. The flag is set only after a
	* sweep actually ran, so a missing registry leaves the work for a later caller
	* (and a second caller in the same process never re-scans).
	*/
	async scrubShellWorkspacesOnce(options = {}) {
		if (this.sweptShellWorkspaces) return {
			removed: [],
			kept: []
		};
		if (this.ctx.get("workspaceRegistry") === void 0) return {
			removed: [],
			kept: []
		};
		const run = this.sweepingShellWorkspaces ?? (async () => {
			try {
				const result = await scrubShellWorkspaces(this.ctx, options);
				this.sweptShellWorkspaces = true;
				return result;
			} finally {
				this.sweepingShellWorkspaces = void 0;
			}
		})();
		this.sweepingShellWorkspaces = run;
		return await run;
	}
	/**
	* Wait (bounded) for the shell registry, then sweep once.
	*
	* The registry service finishes activating *after* this row, so the startup
	* sweep has to wait for it rather than give up on the first look. Polling beats
	* `inject`: declaring that edge deadlocks the boot tree (AGENTS 3).
	* @param options - poll budget; tests shrink both numbers.
	* @returns the sweep result, or undefined when the registry never appeared.
	*/
	async scrubWhenRegistryReady(options = {}) {
		const timeoutMs = options.timeoutMs ?? 2e4;
		const intervalMs = options.intervalMs ?? 500;
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			if (this.ctx.get("workspaceRegistry") !== void 0) return await this.scrubShellWorkspacesOnce(options);
			if (Date.now() >= deadline) return void 0;
			await new Promise((resolve) => {
				setTimeout(resolve, intervalMs).unref?.();
			});
		}
	}
};
/**
* Build (or rebuild) the target record a connect attempt runs against.
*
* Extracted from `runConnect` and exported so its precedence rules are unit-tested
* instead of only observable through a live connect. The rule that matters:
*
* **an absent request field never resets what the record already holds.** The
* record is rebuilt from the wizard payload on every connect, so
* `request.remote?.x ?? default` silently threw away a configured `dshHome`
* (`DSH_HOME` decides where remote sessions live, so a reset makes history look
* lost) along with `profile`/`nodePath`/`dshCommand`/`plugins`. The order is
* request → existing record → default, and an explicitly sent value still wins.
* @param options - the wire request, the record found by label (if any) and the clock/id seams.
*/
function targetDraftFrom(options) {
	const { request, existing } = options;
	const kind = request.kind ?? "ssh";
	const wsl = kind === "wsl";
	const distro = (request.wslDistro ?? "").trim();
	if (wsl && distro === "") throw new Error("a WSL target needs a distribution name");
	const remote = {
		nodePath: request.remote?.nodePath ?? existing?.remote.nodePath ?? "node",
		dshCommand: request.remote?.dshCommand ?? existing?.remote.dshCommand ?? "dsh",
		profile: request.remote?.profile ?? existing?.remote.profile ?? "dsh-remote-server",
		dshHome: request.remote?.dshHome ?? existing?.remote.dshHome ?? "~/.dsh",
		plugins: request.remote?.plugins ?? existing?.remote.plugins ?? []
	};
	return {
		id: existing?.id ?? options.id ?? `rt-${randomUUID().slice(0, 8)}`,
		label: request.label,
		kind,
		host: wsl ? distro : request.host,
		port: wsl ? 22 : request.port,
		username: wsl ? request.wslUser ?? "default" : request.username,
		authKind: wsl ? "agent" : request.authKind,
		...wsl ? {
			wslDistro: distro,
			...request.wslUser === void 0 ? {} : { wslUser: request.wslUser }
		} : {
			...request.privateKeyPath === void 0 ? {} : { privateKeyPath: request.privateKeyPath },
			...request.sshConfigAlias === void 0 ? {} : { sshConfigAlias: request.sshConfigAlias }
		},
		...request.packageSource === void 0 ? {} : { packageSource: request.packageSource },
		...existing?.reuseDsh === void 0 ? {} : { reuseDsh: existing.reuseDsh },
		...existing?.platformProbe === void 0 ? {} : { platformProbe: existing.platformProbe },
		...existing?.serverPackage === void 0 ? {} : { serverPackage: existing.serverPackage },
		hostKeyFingerprint: wsl ? "" : request.hostKeyFingerprint ?? existing?.hostKeyFingerprint ?? "",
		remote,
		status: "unknown",
		createdAt: existing?.createdAt ?? options.now ?? (/* @__PURE__ */ new Date()).toISOString()
	};
}
/**
* The record fields one successful provisioning pass produces.
*
* Pure, and shared by both connect paths (`runConnect` from the wizard,
* `connectOnce` from the tree) so a hint can never be written by one and
* forgotten by the other. `serverPackage` has a producer *here* specifically:
* it sat in the schema with nobody ever writing it (F1).
* @param result - the provisioning outcome.
* @param connectedAt - ISO timestamp of this connection.
*/
function provisionedHints(result, connectedAt) {
	return {
		platformProbe: {
			...result.probe,
			probedAt: connectedAt
		},
		...result.reuse === void 0 ? {} : { reuseDsh: {
			path: result.reuse.path,
			version: result.reuse.version,
			...result.reuse.nodePath === void 0 ? {} : { nodePath: result.reuse.nodePath },
			scannedAt: connectedAt
		} },
		...result.package === void 0 ? {} : { serverPackage: result.package }
	};
}
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
		...record.wslDistro === void 0 ? {} : { wslDistro: record.wslDistro },
		...record.wslUser === void 0 ? {} : { wslUser: record.wslUser },
		...record.packageSource === void 0 ? {} : { packageSource: record.packageSource },
		...record.reuseDsh === void 0 ? {} : { reuseDsh: record.reuseDsh },
		...record.platformProbe === void 0 ? {} : { platformProbe: record.platformProbe },
		...record.serverPackage === void 0 ? {} : { serverPackage: record.serverPackage },
		remote: record.remote,
		status: record.status,
		...record.lastError === void 0 ? {} : { lastError: scrubSecrets(record.lastError) },
		...record.lastConnectedAt === void 0 ? {} : { lastConnectedAt: record.lastConnectedAt }
	};
}
/** How long /api/state waits for one target's `reg.list` before omitting its key. */
const STATE_LIST_TIMEOUT_MS = 3e3;
/** How long one target's `reg.list` answer is reused by `/api/state` (A38: memory only). */
const SERVER_LIST_TTL_MS = 2e3;
/**
* Delete the official shell workspace rows this plugin's stubs created.
*
* Gate 0 left them in the **shared** `~/.dsh/storages/workspace.json` (every dsh on
* the machine reads that file, so an unpatched desktop displayed rows like
* `…\.dsh\remote-workspaces\rt-…\…`). Branch A stopped creating them; this removes
* the historical ones and any a forced run left behind.
*
* Scope is deliberately narrow: only the entries whose path is a stub under
* `<root>/<targetId>/<key>` are touched. Other workspaces, the stub directories
* and our own refs are never modified; a failure on one entry never stops the
* rest (best effort, startup and unload both call it).
* @param ctx - host context (only `workspaceRegistry` is used).
* @param options - stub root override (tests); defaults to `~/.dsh/remote-workspaces`.
* @returns the removed entry ids and the stub paths that had no entry.
*/
async function scrubShellWorkspaces(ctx, options = {}) {
	const removed = [];
	const kept = [];
	const registry = ctx.get("workspaceRegistry");
	if (registry === void 0) return {
		removed,
		kept
	};
	const root = options.root ?? join$1(homedir(), ".dsh", "remote-workspaces");
	const targets = await readdir(root, { withFileTypes: true }).catch(() => []);
	for (const target of targets) {
		if (!target.isDirectory()) continue;
		const targetDir = join$1(root, target.name);
		const stubs = await readdir(targetDir, { withFileTypes: true }).catch(() => []);
		for (const stub of stubs) {
			if (!stub.isDirectory()) continue;
			let canonical;
			try {
				canonical = await realpath(join$1(targetDir, stub.name));
			} catch {
				continue;
			}
			const entry = await registry.resolveByPath(canonical);
			if (entry === void 0) {
				kept.push(canonical);
				continue;
			}
			try {
				await registry.delete(entry.id);
				removed.push(entry.id);
			} catch (error) {
				console.error("[dsh-remote-workspace] removing a leaked shell workspace failed", scrubSecrets(error instanceof Error ? error.message : String(error)));
				kept.push(canonical);
			}
		}
	}
	return {
		removed,
		kept
	};
}
/** The scan's overall budget (api-contract §2.4: `scan-timeout` past 60 s). */
const SCAN_TIMEOUT_MS = 6e4;
/**
* Drop the pre-P0 copies of server-owned fields from one ref.
*
* `path`/`title`/`createdAt`/`serverId` are legacy: as soon as a ref carries a
* `remoteWorkspaceId`, the server owns those values and a stale local copy is
* worse than none — one migrated row (`rw-1a2b3c4d`) kept reporting
* `path: "/home/user"` in `/api/state` (alpha59). Materialization and view
* state (`stubPath`, `officialWorkspaceId`, `sessionId`, pins, `lastOpenedAt`)
* are kept.
* @param ref - the stored ref.
* @param remoteWorkspaceId - the server id it must carry.
* @returns the cleaned record, or undefined when there was nothing to clean (so
*   the caller does not rewrite an untouched row on every refresh).
*/
function stripLegacyRefFields(ref, remoteWorkspaceId) {
	if (!(ref.path !== void 0 || ref.title !== void 0 || ref.createdAt !== void 0 || ref.serverId !== void 0 || ref.remoteWorkspaceId !== remoteWorkspaceId)) return void 0;
	const { path: _path, title: _title, createdAt: _createdAt, serverId: _serverId, ...rest } = ref;
	return {
		...rest,
		remoteWorkspaceId
	};
}
/**
* Whether this process may register official **shell** workspace rows for remote
* stubs.
*
* **Default: off (Gate 0 branch A).** `DSH_RW_FORCE_SHELL_WORKSPACES=1` restores
* the old behaviour (register the stub in the shell registry and attach sessions
* to it).
*
* Why off by default:
*
* 1. **Nothing needs the row.** `attachSession` is the only official call on our
*    open path and it is skipped when the row is absent; registry membership is a
*    *filter* (`candidateMatches` warns and drops a session, it never throws);
*    `ctx.agents.create`/`resume` never read `workspaceRegistry` (grep of the
*    shipped tree: `dsh-api-workspace-controller`, `dsh-workspace`,
*    `dsh-api-session-controller` — none of which is on our path, since
*    `openRemoteSession` composes through `ctx.agents.create` directly). The row
*    buys exactly one thing: a row in the shell's own workspace tree.
* 2. **The row leaks.** The registry is one shared file
*    (`~/.dsh/storages/workspace.json`) that every dsh on the machine reads —
*    including a desktop install with no plugin, which then shows
*    `…\.dsh\remote-workspaces\rt-…\…` rows that nothing ever removes. The
*    server-authoritative refactor makes the remote the workspace authority, so
*    these stub rows must not be created at all.
*
* Why the escape hatch stays: the shell could start treating registry membership
* as enforcement (or a machine could carry a registry that demands the row). The
* variable flips all of it back in one restart without a code change.
*
* Cost when off: only the shell's own tree row. Sessions, remote logs, routing,
* rename/pin/archive and resume are unaffected — see
* `tests/gate0-shell-workspaces.test.ts`.
* @param env - environment to read (injectable for tests).
*/
function shouldRegisterShellWorkspaces(env = process.env) {
	const raw = (env.DSH_RW_FORCE_SHELL_WORKSPACES ?? "").trim().toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
/**
* The official shell workspace standing for one stub, when shell rows are enabled
* (`DSH_RW_FORCE_SHELL_WORKSPACES=1`; off by default — see
* `shouldRegisterShellWorkspaces`) **or the caller forces it**.
*
* Gate 0 finding: nothing in the **open** path needs it. `attachSession` is the
* only official call we make, it validates `realpath(header.cwd) === path` and is
* skipped entirely when absent; membership is a *filter* on the registry side
* (`candidateMatches` warns and drops a session, never throws); and the
* thin-client session-controller — the only other `workspaceRegistry` consumer —
* is not on our path because `openRemoteSession` composes through
* `ctx.agents.create` directly. So the entry buys exactly one thing: a row in the
* shell's workspace tree (which is also the thing that leaks into unrelated
* clients through the shared `storages/workspace.json`).
* **One caller overrides the switch: `prepareWorkspace` passes `force: true`.**
* The official new-conversation draft resolves its workspace from the shell's own
* list (`uiWorkspace.startSession(workspaceId)`), so a prepared workspace has to
* own a registry row or there is no id to bind the draft to — on that path the row
* is a *functional* requirement, not a tree entry. Gate 0 is therefore unchanged
* everywhere else: `openWorkspace`/`resumeSessionOnce` still pass no `force` and
* still skip the row, and even a forced row stays invisible in the UI (the client
* hides `[data-slot="sidebar.workspaces"]` stub rows and `watchShellRows` drops
* their sessions).
* @param options - registry (may be absent), the canonical stub, its row title and
*   an explicit override of the process-wide switch.
* @returns the entry, or undefined when rows are disabled or registration failed.
*/
async function officialWorkspaceFor(options) {
	if (options.force !== true && !shouldRegisterShellWorkspaces()) return void 0;
	const { registry } = options;
	if (registry === void 0) return void 0;
	const existing = await registry.resolveByPath(options.canonicalStub);
	if (existing !== void 0) return existing;
	return await registry.create(options.canonicalStub, options.shellTitle).catch((error) => {
		console.error("[dsh-remote-workspace] registering the workspace in the shell tree failed", error);
	});
}
/** `ctx.get` a service by name, typed loosely. */
function serviceOf(ctx, name) {
	return ctx.get(name);
}
/**
* Refuse to open a remote session unless the target's realm preset is registered
* and usable.
*
* Alpha54, defect B: an older connection's session ended up composed with the
* **shipped** preset — the model got the local `pwsh` tool, `pwd` answered the
* local stub directory and the proof file was written on *this* machine while the
* remote never saw it. A remote workspace whose realm is missing must fail
* loudly; silently running on the local world is the one outcome that must not
* happen, because it looks like success.
* @param ctx - host context.
* @param targetId - stored target; its preset id is derived, never guessed.
* @returns the preset id that was verified.
*/
async function assertRemoteRealm(ctx, targetId) {
	const presetId = remotePresetId(targetId);
	const presets = serviceOf(ctx, "agentPresets");
	if (presets === void 0) throw codedError("realm-unavailable", `remote workspace "${targetId}": the agent preset registry is not available, so preset "${presetId}" cannot be mounted; refusing to open a session that would run on this machine`);
	let resolved;
	try {
		resolved = await presets.resolve(presetId);
	} catch (error) {
		throw codedError("realm-unavailable", `remote workspace "${targetId}": preset "${presetId}" is not registered (${errorReason(error)}); reconnect the target so its execution world is restored`);
	}
	if (resolved.id !== presetId) throw codedError("realm-unavailable", `remote workspace "${targetId}": preset "${presetId}" resolved to "${resolved.id}"; refusing to open a session in a different execution world`);
	if (resolved.broken !== void 0) throw codedError("realm-unavailable", `remote workspace "${targetId}": preset "${presetId}" failed to activate: ${resolved.broken}; reconnect the target and try again`);
	return presetId;
}
/**
* Refuse to *resume* a session that is already live in this process but composed
* with another preset.
*
* This is the second half of defect B: `resumeRemoteSession` returns a live agent
* as-is (it must — resuming twice collides on the write lease), so a session the
* shell opened locally through its own row would be handed back as if it were a
* remote session.
* @param ctx - host context.
* @param targetId - stored target.
* @param sessionId - the session about to be resumed.
*/
function assertLiveSessionInRealm(ctx, targetId, sessionId) {
	const live = serviceOf(ctx, "agents")?.get(sessionId);
	if (live === void 0 || live.ctx === void 0) return;
	const composed = serviceOf(ctx, "agentPresets")?.composedPreset(live.ctx);
	const expected = remotePresetId(targetId);
	if (composed !== expected) throw codedError("realm-unavailable", `remote workspace "${targetId}": session "${sessionId}" is already live with preset "${composed ?? "(none)"}" instead of "${expected}", so its tools run on this machine instead of the remote host; close that session and reconnect the target`);
}
/**
* Verify a just-created/resumed session really runs in the remote realm.
* @param ctx - host context.
* @param targetId - stored target.
* @param sessionId - the session that was just composed.
*/
function assertRealmComposed(ctx, targetId, sessionId) {
	const presets = serviceOf(ctx, "agentPresets");
	const live = serviceOf(ctx, "agents")?.get(sessionId);
	if (presets === void 0 || live?.ctx === void 0) return;
	const expected = remotePresetId(targetId);
	const composed = presets.composedPreset(live.ctx);
	const realmSsh = presets.serviceFor({ ctx: live.ctx }, "ssh");
	if (composed !== expected || realmSsh === void 0) throw codedError("realm-unavailable", `remote workspace "${targetId}": session "${sessionId}" was composed with preset "${composed ?? "(none)"}" and no realm ssh service, so it would run on this machine; refusing to use it`);
}
/**
* Run one session open/resume, adding the target, the preset id and the original
* cause to a mount failure.
*
* `presets.mount()` failures surface from `agents.create/resume` as whatever the
* preset loader threw; without this wrapper the user sees an error that names
* neither the target nor the preset (alpha54, defect B).
* @param action - which flow failed, for the message.
* @param targetId - stored target.
* @param work - the open/resume call.
*/
async function openSessionInRealm(action, targetId, work) {
	try {
		return await work();
	} catch (error) {
		throw codedError("realm-unavailable", `remote workspace "${targetId}": mounting preset "${remotePresetId(targetId)}" failed while ${action === "create" ? "creating" : "resuming"} the session: ${errorReason(error)}`);
	}
}
/** The most informative line an unknown error can give (never empty). */
function errorReason(error) {
	if (error instanceof Error) return error.message !== "" ? error.message : error.name;
	return String(error);
}
/** An error carrying the code the route maps to an HTTP status (api-contract §10). */
function codedError(code, message) {
	const error = new Error(scrubSecrets(message));
	error.code = code;
	return error;
}
/** Reject with `scan-timeout` when one scan pass outlives its budget. */
async function withScanDeadline(work, ms) {
	let timer;
	try {
		return await Promise.race([work, new Promise((_resolve, reject) => {
			timer = setTimeout(() => reject(codedError("scan-timeout", "the dsh scan did not finish within 60 s")), Math.max(1e3, ms));
			timer.unref();
		})]);
	} finally {
		if (timer !== void 0) clearTimeout(timer);
	}
}
/**
* The transient target record a scan runs against.
*
* A scan happens *before* any record exists (that is the point of the wizard
* step), so the transport is handed a draft that is never stored — and it carries
* nothing but addressing: no credential reference, no secret.
*/
function scanDraft(request) {
	const kind = request.kind ?? "ssh";
	const wsl = kind === "wsl";
	const distro = (request.wslDistro ?? "").trim();
	const profile = (request.profile ?? "").trim();
	const dshHome = (request.dshHome ?? "").trim();
	return {
		id: `scan-${randomUUID().slice(0, 8)}`,
		label: wsl ? distro : (request.host ?? "").trim(),
		kind,
		host: wsl ? distro : (request.host ?? "").trim(),
		port: wsl ? 22 : request.port ?? 22,
		username: wsl ? request.wslUser ?? "default" : request.username ?? "",
		authKind: wsl ? "agent" : request.authKind ?? "agent",
		...wsl ? {
			wslDistro: distro,
			...request.wslUser === void 0 ? {} : { wslUser: request.wslUser }
		} : {
			...request.privateKeyPath === void 0 ? {} : { privateKeyPath: request.privateKeyPath },
			...request.sshConfigAlias === void 0 ? {} : { sshConfigAlias: request.sshConfigAlias }
		},
		hostKeyFingerprint: wsl ? "" : request.hostKeyFingerprint ?? "",
		remote: {
			nodePath: "node",
			dshCommand: "dsh",
			profile: profile === "" ? "dsh-remote-server" : profile,
			dshHome: dshHome === "" ? "~/.dsh" : dshHome,
			plugins: []
		},
		status: "unknown",
		createdAt: (/* @__PURE__ */ new Date()).toISOString()
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
/**
* Service-layer error codes and the HTTP status the client expects.
*
* `RemoteWorkspaces` throws plain `Error`s with a `code` for the cases the
* browser has to distinguish (a vanished workspace vs a failed scan), and the
* envelope's status has to follow the code — everything unmapped stays 500.
*/
const STATUS_BY_CODE = {
	"bad-request": 400,
	unsupported: 400,
	"not-found": 404,
	"scan-failed": 500,
	"scan-timeout": 500,
	"workspace-not-empty": 409,
	"target-not-connected": 409,
	"server-protocol-mismatch": 500
};
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
/** Package sources a `connect/start` body may name (`auto` follows the global policy). */
const PACKAGE_SOURCES = [
	"auto",
	"download",
	"upload",
	"reuse"
];
/** The fields `remote` may carry; anything else is a 400 here, not a zod 500 later. */
const REMOTE_FIELDS = [
	"nodePath",
	"dshCommand",
	"profile",
	"dshHome",
	"plugins"
];
/** Profile names the remote profile directory can safely be built from. */
const PROFILE_NAME = /^[a-z0-9][a-z0-9-]*$/u;
/**
* The optional `remote` object, validated field by field.
*
* It used to be passed through as `body.remote as ConnectRequest['remote']`, so a
* bad `profile` only failed much later, at `store.putTarget`'s zod parse — a 500
* `internal` in the middle of a connect instead of a 400 naming the field. The
* rules are exactly `targetRecordSchema`'s `runtimeSchema`, checked at the wire.
*/
function remoteFrom(body) {
	const raw = body.remote;
	if (raw === void 0 || raw === null) return void 0;
	if (typeof raw !== "object" || Array.isArray(raw)) throw new RouteError("bad-request", "\"remote\" must be an object", 400);
	const value = raw;
	for (const key of Object.keys(value)) if (!REMOTE_FIELDS.includes(key)) throw new RouteError("bad-request", `"remote.${key}" is not a known field (allowed: ${REMOTE_FIELDS.join(", ")})`, 400);
	const text = (field, hint) => {
		const candidate = value[field];
		if (candidate === void 0) return void 0;
		if (typeof candidate !== "string" || candidate.trim() === "") throw new RouteError("bad-request", `"remote.${field}" must be a non-empty string${hint === void 0 ? "" : ` ${hint}`}`, 400);
		return candidate.trim();
	};
	const profile = text("profile", `matching ${PROFILE_NAME.source}`);
	if (profile !== void 0 && !PROFILE_NAME.test(profile)) throw new RouteError("bad-request", `"remote.profile" must match ${PROFILE_NAME.source}`, 400);
	const plugins = value.plugins;
	if (plugins !== void 0 && (!Array.isArray(plugins) || plugins.some((entry) => typeof entry !== "string"))) throw new RouteError("bad-request", "\"remote.plugins\" must be an array of strings", 400);
	const nodePath = text("nodePath");
	const dshCommand = text("dshCommand");
	const dshHome = text("dshHome");
	return {
		...nodePath === void 0 ? {} : { nodePath },
		...dshCommand === void 0 ? {} : { dshCommand },
		...profile === void 0 ? {} : { profile },
		...dshHome === void 0 ? {} : { dshHome },
		...plugins === void 0 ? {} : { plugins }
	};
}
/**
* The wizard's `connect/start` body → {@link ConnectRequest}.
*
* Exported and pure **because this is the only place a new wire field is read
* off the JSON**: everything downstream (the ticket, `runConnect`, `planProvision`)
* sees the typed request and nothing else, so a field that the contract accepts
* but that is never copied here is invisible in three layers — which is exactly
* how `reuseLauncherPath` reached QA as
* `reuse-launcher-missing: no dsh launcher was selected` on alpha51. Keep the
* regression test (`tests/connect-request.test.ts`) in step with this function.
*/
function connectRequestFrom(body) {
	const kindRaw = optionalString(body, "kind") ?? "ssh";
	if (kindRaw !== "ssh" && kindRaw !== "wsl") throw new RouteError("bad-request", "\"kind\" must be \"ssh\" or \"wsl\"", 400);
	const wslDistro = optionalString(body, "wslDistro");
	const wslUser = optionalString(body, "wslUser");
	if (kindRaw === "wsl" && wslDistro === void 0) throw new RouteError("bad-request", "\"wslDistro\" is required for a WSL connection", 400);
	const packageSource = optionalString(body, "packageSource");
	if (packageSource !== void 0 && !PACKAGE_SOURCES.includes(packageSource)) throw new RouteError("bad-request", `"packageSource" must be ${PACKAGE_SOURCES.join("|")}`, 400);
	const reuseLauncherPath = optionalString(body, "reuseLauncherPath");
	if (packageSource === "reuse" && reuseLauncherPath === void 0) throw new RouteError("bad-request", "\"reuseLauncherPath\" is required when \"packageSource\" is \"reuse\"", 400);
	const remote = remoteFrom(body);
	const shared = {
		label: requireString(body, "label"),
		...packageSource === void 0 ? {} : { packageSource },
		...reuseLauncherPath === void 0 ? {} : { reuseLauncherPath },
		...remote === void 0 ? {} : { remote }
	};
	const request = kindRaw === "wsl" ? {
		...shared,
		kind: "wsl",
		host: wslDistro,
		port: 22,
		username: wslUser ?? "default",
		authKind: "agent",
		wslDistro,
		...wslUser === void 0 ? {} : { wslUser }
	} : {
		...shared,
		kind: "ssh",
		host: requireString(body, "host"),
		port: typeof body.port === "number" ? body.port : Number.parseInt(requireString(body, "port"), 10),
		username: requireString(body, "username"),
		authKind: optionalString(body, "authKind") ?? "agent",
		...optionalString(body, "secret") === void 0 ? {} : { secret: optionalString(body, "secret") },
		...optionalString(body, "privateKeyPath") === void 0 ? {} : { privateKeyPath: optionalString(body, "privateKeyPath") },
		...optionalString(body, "sshConfigAlias") === void 0 ? {} : { sshConfigAlias: optionalString(body, "sshConfigAlias") },
		...optionalString(body, "hostKeyFingerprint") === void 0 ? {} : { hostKeyFingerprint: optionalString(body, "hostKeyFingerprint") }
	};
	if (!Number.isInteger(request.port) || request.port < 1 || request.port > 65535) throw new RouteError("bad-request", "\"port\" must be between 1 and 65535", 400);
	return request;
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
/**
* The `remoteWorkspaces` service object the realm resolves: a typed facade over
* one {@link RemoteWorkspaces}.
*
* The **return type is load-bearing**, not documentation. `ctx.provide` takes an
* untyped object, so an object literal here silently drifts from
* `RemoteWorkspaceService`: on alpha52 `remoteClient`/`releaseRemoteClient` were
* missing from the literal, the realm's `start()` blew up with
* `workspaces.remoteClient is not a function`, and *every tool call in a remote
* session* failed while the session itself looked healthy (D4). Typing the
* factory's return makes a missing member a `tsc` error at the assembly point;
* `tests/remote-workspace-service.test.ts` additionally asserts
* "interface member ⊆ facade key" at runtime and that each key forwards.
* @param workspaces - the host-plane service instance owned by this row.
*/
function remoteWorkspaceService(workspaces) {
	return {
		connectChannel: (targetId, signal) => workspaces.connectChannel(targetId, signal),
		remoteClient: (targetId) => workspaces.remoteClient(targetId),
		releaseRemoteClient: (targetId) => workspaces.releaseRemoteClient(targetId),
		expectedDigest: (targetId) => workspaces.expectedDigest(targetId),
		getPackagePolicy: () => workspaces.getPackagePolicy(),
		pathAliases: (targetId) => workspaces.pathAliases(targetId),
		setPackagePolicy: (settings) => workspaces.setPackagePolicy(settings),
		routeForCwd: (cwd) => workspaces.routeForCwd(cwd),
		stubForWorkspace: (workspaceId) => workspaces.stubForWorkspace(workspaceId),
		locateRemoteSession: (sessionId) => workspaces.locateRemoteSession(sessionId),
		sessionRequest: (targetId, method, params, signal) => workspaces.sessionRequest(targetId, method, params, signal)
	};
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
		writeJson(res, (typeof code === "string" ? STATUS_BY_CODE[code] : void 0) ?? 500, {
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
			await workspaces.scrubShellWorkspacesOnce().catch(() => void 0);
			return {
				targets: workspaces.listTargets(),
				workspaceRefs: workspaces.listWorkspaceRefs(),
				serverWorkspaces: await workspaces.serverWorkspaceLists(),
				pluginVersion: pluginVersion(),
				defaultProfile: "dsh-remote-server",
				platform: process.platform
			};
		case "wsl-distros":
			if (!methodAvailable("wsl", process.platform)) throw new RouteError("unsupported", `WSL targets are only available on Windows (this host is ${process.platform})`, 400);
			return await listWslDistros();
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
			const kindRaw = optionalString(body, "kind") ?? "ssh";
			if (kindRaw !== "ssh" && kindRaw !== "wsl") throw new RouteError("bad-request", "\"kind\" must be \"ssh\" or \"wsl\"", 400);
			if (!methodAvailable(kindRaw, process.platform)) throw new RouteError("unsupported", `the "${kindRaw}" connection method is not available on ${process.platform}`, 400);
			return { ticket: workspaces.beginConnect(connectRequestFrom(body)) };
		}
		case "hostkey-confirm": {
			const ticket = requireString(body, "ticket");
			const fingerprint = requireString(body, "fingerprint");
			return { accepted: workspaces.confirmHostKey(ticket, fingerprint) };
		}
		case "dsh-scan": {
			const kindRaw = optionalString(body, "kind") ?? "ssh";
			if (kindRaw !== "ssh" && kindRaw !== "wsl") throw new RouteError("bad-request", "\"kind\" must be \"ssh\" or \"wsl\"", 400);
			if (!methodAvailable(kindRaw, process.platform)) throw new RouteError("unsupported", `the "${kindRaw}" connection method is not available on ${process.platform}`, 400);
			const wsl = kindRaw === "wsl";
			const wslDistro = optionalString(body, "wslDistro");
			if (wsl && wslDistro === void 0) throw new RouteError("bad-request", "\"wslDistro\" is required for a WSL scan", 400);
			const host = wsl ? optionalString(body, "host") : requireString(body, "host");
			const username = wsl ? optionalString(body, "username") : requireString(body, "username");
			const port = wsl ? 22 : typeof body.port === "number" ? body.port : Number.parseInt(requireString(body, "port"), 10);
			if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RouteError("bad-request", "\"port\" must be between 1 and 65535", 400);
			const authKind = optionalString(body, "authKind") ?? "agent";
			if (authKind !== "password" && authKind !== "privateKey" && authKind !== "agent") throw new RouteError("bad-request", "\"authKind\" must be password|privateKey|agent", 400);
			const secret = optionalString(body, "secret");
			const privateKeyPath = optionalString(body, "privateKeyPath");
			const sshConfigAlias = optionalString(body, "sshConfigAlias");
			const hostKeyFingerprint = optionalString(body, "hostKeyFingerprint");
			const profile = optionalString(body, "profile");
			const dshHome = optionalString(body, "dshHome");
			const wslUser = optionalString(body, "wslUser");
			return await workspaces.scanDsh({
				kind: wsl ? "wsl" : "ssh",
				port,
				authKind,
				...host === void 0 ? {} : { host },
				...username === void 0 ? {} : { username },
				...secret === void 0 ? {} : { secret },
				...privateKeyPath === void 0 ? {} : { privateKeyPath },
				...sshConfigAlias === void 0 ? {} : { sshConfigAlias },
				...hostKeyFingerprint === void 0 ? {} : { hostKeyFingerprint },
				...wslDistro === void 0 ? {} : { wslDistro },
				...wslUser === void 0 ? {} : { wslUser },
				...profile === void 0 ? {} : { profile },
				...dshHome === void 0 ? {} : { dshHome }
			});
		}
		case "workspace-rename": return await workspaces.renameWorkspace(requireString(body, "targetId"), requireString(body, "remoteWorkspaceId"), requireString(body, "title"));
		case "workspace-delete": return await workspaces.deleteWorkspace(requireString(body, "targetId"), requireString(body, "remoteWorkspaceId"), body.force === true);
		case "cleanup-shell-workspaces": return await workspaces.scrubShellWorkspaces();
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
		case "prepare-workspace": {
			const prepared = await workspaces.prepareWorkspace(requireString(body, "targetId"), requireString(body, "path"), optionalString(body, "title"));
			const { workspace } = prepared;
			return {
				workspaceId: workspace.id,
				remoteWorkspaceId: workspace.remoteWorkspaceId ?? "",
				stubPath: prepared.stubPath,
				officialWorkspaceId: prepared.officialWorkspaceId,
				targetId: workspace.targetId
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
		case "session-rename":
			await workspaces.renameSession(requireString(body, "targetId"), requireString(body, "path"), requireString(body, "sessionId"), requireString(body, "title"));
			return { renamed: true };
		case "session-flag": {
			const flag = requireString(body, "flag");
			if (flag !== "pinned" && flag !== "archived") throw new RouteError("bad-request", "\"flag\" must be pinned|archived", 400);
			const on = body.on;
			if (typeof on !== "boolean") throw new RouteError("bad-request", "\"on\" must be a boolean", 400);
			return { workspace: await workspaces.setSessionFlag(requireString(body, "workspaceId"), requireString(body, "sessionId"), flag, on) };
		}
		case "forget-workspace": {
			const id = requireString(body, "workspaceId");
			const ref = workspaces.listWorkspaceRefs().find((candidate) => candidate.id === id || candidate.remoteWorkspaceId === id);
			if (ref?.remoteWorkspaceId !== void 0) return {
				forgotten: true,
				...await workspaces.deleteWorkspace(ref.targetId, ref.remoteWorkspaceId, false)
			};
			return {
				forgotten: await workspaces.forgetWorkspace(id),
				removed: false,
				sessionCount: 0,
				refsDropped: ref === void 0 ? [] : [ref.id]
			};
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
	ctx.provide("remoteWorkspaces", remoteWorkspaceService(workspaces));
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
	storageReady.then(async () => {
		const swept = await workspaces.scrubWhenRegistryReady().catch(() => void 0);
		if (swept !== void 0 && swept.removed.length > 0) ctx.logger.info(`dsh-remote-workspace: removed ${swept.removed.length} leaked shell workspace row(s)`);
		if (config.restoreTargets) await workspaces.ensureWorlds();
	}).catch((error) => {
		ctx.logger.error(`dsh-remote-workspace: target restore failed: ${scrubSecrets(error instanceof Error ? error.message : String(error))}`);
	});
	ctx.logger.debug(`dsh-remote-workspace: home=${homedir()} routes=${join(ROUTE_PREFIX, "api")}`);
}
//#endregion
export { Config, ROUTE_PREFIX, apply, connectRequestFrom, inject, name, remoteWorkspaceService };
