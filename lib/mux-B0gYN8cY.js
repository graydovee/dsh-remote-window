import { Duplex, PassThrough } from "node:stream";
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
export { streamTransport as n, DEFAULT_MAX_FRAME_BYTES as r, FrameMux as t };
