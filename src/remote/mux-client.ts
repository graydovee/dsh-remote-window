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
import { scrubSecrets } from '../targets/types.ts'

/** One stream returned by {@link RemoteMux.openStream}. */
export interface RemoteMuxStream {
  /** Send one outbound chunk; resolves when the transport accepted it. */
  write(chunk: Uint8Array): Promise<void> | void
  /** Half-close the outbound side. */
  end(): void
  /** Abort the stream with an optional reason (propagated to the far side). */
  abort(reason?: string): void
  /** Inbound chunks until the far side ends or the stream aborts. */
  read(): AsyncIterable<Uint8Array>
}

/** The service dev-session consumes (protocol §16.9). */
export interface RemoteMux {
  request<T>(targetId: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T>
  openStream(targetId: string, endpoint: string, payload: unknown): Promise<RemoteMuxStream>
  close(targetId: string): Promise<void>
}

/** A coded mux failure the realm can map to its fail-closed state. */
export class RemoteMuxError extends Error {
  constructor(
    readonly code: 'mux-unavailable' | 'mux-disposed' | 'mux-request-failed',
    message: string,
    readonly cause?: unknown,
    readonly details?: unknown,
  ) {
    super(scrubSecrets(message))
    this.name = 'RemoteMuxError'
  }
}

/** The per-target wire implementation (one instance = one WS/FrameMux). */
export interface RemoteMuxBackend {
  request<T>(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T>
  openStream(endpoint: string, payload: unknown): Promise<RemoteMuxStream>
  close(): Promise<void>
}

/** The lookup the router uses; the service owns the real target lifetimes. */
export interface RemoteMuxBackends {
  get(targetId: string): RemoteMuxBackend | undefined
}

/**
 * Routes the seam's calls to the per-target backend.
 *
 * Absent backend = target not connected (or its realm is disposed), which is a
 * hard `mux-unavailable`: the realm must fail closed and never fall back to the
 * client's local execution world.
 */
export class RemoteMuxRouter implements RemoteMux {
  private readonly closed = new Set<string>()

  constructor(private readonly backends: RemoteMuxBackends) {}

  /** Ask for a backend, translating absence into a coded failure. */
  private backendFor(targetId: string): RemoteMuxBackend {
    if (this.closed.has(targetId)) throw new RemoteMuxError('mux-disposed', `remote target "${targetId}" is closed`)
    const backend = this.backends.get(targetId)
    if (backend === undefined) throw new RemoteMuxError('mux-unavailable', `remote target "${targetId}" is not connected`)
    return backend
  }

  async request<T>(targetId: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    const backend = this.backendFor(targetId)
    try {
      return await backend.request<T>(endpoint, payload, signal)
    } catch (error) {
      if (error instanceof RemoteMuxError) throw error
      throw new RemoteMuxError('mux-request-failed', `remote mux request "${endpoint}" failed on "${targetId}": ${error instanceof Error ? error.message : String(error)}`, error, (error as { details?: unknown }).details)
    }
  }

  async openStream(targetId: string, endpoint: string, payload: unknown): Promise<RemoteMuxStream> {
    const backend = this.backendFor(targetId)
    try {
      return await backend.openStream(endpoint, payload)
    } catch (error) {
      if (error instanceof RemoteMuxError) throw error
      throw new RemoteMuxError('mux-request-failed', `remote mux stream "${endpoint}" failed on "${targetId}": ${error instanceof Error ? error.message : String(error)}`, error, (error as { details?: unknown }).details)
    }
  }

  /** Close one target's backend and remember it as disposed (idempotent). */
  async close(targetId: string): Promise<void> {
    if (this.closed.has(targetId)) return
    this.closed.add(targetId)
    const backend = this.backends.get(targetId)
    await backend?.close().catch(() => undefined)
  }
}
