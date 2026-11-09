# Bridge service, connection and run watches

Inventory **57 + 62 + 66** has three distinct owners in the shared backend's
`modules/bridge`: `bridge.service-lifecycle.ts`, `bridge.connection-lifecycle.ts`
and `bridge.run-watch-lifecycle.ts`. Native service/transport/replicator modules
provide effects. Existing auth, record application and sync-loop owners retain
their own responsibilities. No schema, wire channel, DTO or dependency changes.

| Owner | Transition and rule |
| --- | --- |
| Service startup | Idle → starting → active, including a signed-out identity. Concurrent callers join acquisition. Startup failure rolls back acquired resources before another attempt. A malformed development config cannot retain a phantom identity that silently prevents retry. |
| Service callbacks | Identity readiness/revocation, approval/access hints and local-write sinks bind their original owner. Retirement fences callbacks before awaiting native cleanup. After waiting for a previous replicator to stop, readiness rechecks ownership before binding account state or creating its replacement. |
| Service mutation | Accepted → executing → settled. Mutations serialize. Close rejects new work, retires queued work and drains work already executing before releasing the replicator/database dependencies. Sign-in starts the service before entering that queue, so failed startup rollback cannot wait on its own caller. Retired scope edits do not resume replication. |
| Service close | Active/starting → closing → idle; failed release remains blocked and retryable. The shared resource journal retains references until release succeeds. Identity retirement can start during pending startup; repeated cleanup callers share native teardown. Native replicator cleanup failure also remains retryable without reopening sync admission. |
| Connection acquisition | Disconnected → connecting → connected. Claim the promise before status listeners/token lookup can reenter. Token/handshake failure retires that acquisition and allows a fresh attempt. Disconnect permits reconnect; Close is terminal for that transport. |
| Credential wait | Disconnect/Close rejects callers immediately, including callers waiting for a token. A credential provider may finish its own I/O later; retired acquisition cannot create a socket or affect its replacement. |
| RPC | Connected → request admitted → response/error/timeout/disconnect. Reserve identity and deadline before native send. A synchronous send throw, failed send callback or timeout retires the owning connection, rejects all its pending requests and clears deadlines. Late callbacks/replies from old sockets cannot settle or terminate replacement RPCs, even with a reused request id. |
| Socket events | Parse/validate only current-socket frames. Invalid frames retire that socket. A stale native Close cannot reject replacement requests. Current policy-close 1008 requests an HTTP identity recheck; it is not proof of revocation. Protocol ping/pong owns its nonce/deadlines and is retired with its socket, including idle half-open detection. |
| Subscriptions | Keep the deduplicated desired stream set and restore it on reconnect. The replicator's serialized cycle owns subscription updates. Renewing a view lease sends no RPC; shared views retain one stream subscription. |
| View lease | Absent → watched/renewed → released/expired. Each view leases its run for 90 seconds; expiry includes the exact deadline. Sweep before status and capacity decisions. Switching a view to a local run releases its old remote stream. Replacing a sole view at the 127-stream limit is allowed; retain the 512-view limit. |
| Stream readiness | A watch incarnation owns its readiness/error ticket. Cached cursors permit offline cached display; they do not promise a newly refreshed snapshot. A cycle captures its tickets and applies completion/error only to still-current ones. Unwatch/reopen cannot inherit the retired pull's readiness. Global pending uploads do not erase a ready cached conversation. |

Local records, cursors, publication identities, cached conversations and pending
writes remain durable under the existing Bridge rules. These lifecycle owners
remain in memory. Already admitted record application can finish durably while
its view retires; its late completion cannot publish readiness for a new view.
This package changes neither account approval nor ciphertext verification.

Tests cover actual service startup with disposable SQLite/profile directories,
controlled native cleanup/send failures, loopback WebSocket servers, timed view
leases and the real local Worker/Durable Object with E2EE. The network replicator
suite uses the repository's 15-second test/30-second hook limits. No production
Bridge account, installed-app profile or real provider login is used.
