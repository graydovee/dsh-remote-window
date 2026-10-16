# Remote Session design note

The client adapter implements the official `SessionPersistence` seam and sends opaque persistence requests over the existing SSH RPC channel. The remote server owns the authoritative JSONL backend and its single writer lease. This keeps model-visible events in the official session log, avoids a second lock protocol, and leaves the global local session service untouched.

The target workspace identity is a protocol projection (`sha256(serverId + NUL + canonical remote path)`); the physical JSONL path remains an implementation detail of the official backend.
