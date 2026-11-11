# Turn boundaries and native input acceptance

Inventory **3 + 13 + 14** has two distinct owners:
`packages/backend/src/modules/runs/run-turn-lifecycle.ts` owns numeric Mains
turns and their Git boundaries; `providers/adapters/input-receipt-lifecycle.ts`
owns one native input's acceptance/projection barrier, shared by Claude and Codex.
Provider modules retain protocol decoding, capabilities, deadlines and transport
effects. `RunSession` supplies database and Git effects and serializes admitted
events before finalization. No schema, wire channel or dependency changes.

| Owner | Transition and rule |
| --- | --- |
| Initial turn | Capture the first working-tree baseline synchronously before the adapter starts. Install the initial readiness barrier before publishing the session. Tool/report/plan/input projections wait for initial acquisition. Continued runs seed their numeric index from persisted history. |
| Turn boundary | Open → closing → between turns → open. A single tree snapshot is the old turn's end and the next turn's start. Do not advance the index or acknowledge input before the new turn row exists. Failed close retains its id, baseline and boundary for retry; failed open retains the next baseline and index. |
| Accepted input | A queued input opens one boundary; steering stays in its current turn. The client message id retains its numeric turn for this live session, including when artifact insertion fails. Retry reuses that turn even after another continuation; model attribution follows the recovered input's turn. Existing artifact deduplication runs before boundary creation. Legacy prompt markers are stamped after preparing their new boundary. |
| Completion | Drain admitted projections and initial acquisition before closing the final turn and recording usage. Failure of initial model/native metadata does not abandon an already acquired turn. A failed final turn close still settles unfinished tool/task rows. Existing changes-card/Bridge-output policies remain best-effort after the turn row closes. |
| Native receipt | Pending → natively accepted/projecting → projected or projection failed. Acceptance is an independent native fact and survives a persistence error. Claim the immutable first receipt and its promise before invoking effects, including synchronous exceptions/reentrant callbacks. ACK, echo and recovery join that one promise. Retiring an owner refuses new acceptance but preserves already accepted persistence for draining. |
| Claude stream | Open → ending at the first parent result → closed; Stop is terminal. Capability discovery gates steering separately. Queue admission/stdin writes, tool results and child messages never acknowledge delivery. Parent lifecycle-start, consumed user replay and response UUID markers can acknowledge it. |
| Claude cancellation | Result closes new sends before awaiting receipt projection/cancellation. Unsent local input is withdrawn; a dequeued send with no confirmed cancellation stays uncertain. A positive control response cannot delete a native acceptance received while cancellation was pending. A later accepted input after the old result becomes its own queued continuation. Stop ignores later receipts; accepted projections still drain. |
| Claude timeout | Receipt timeout and bounded cancellation waits do not imply rejection or acceptance. Keep uncertain input for later native receipt/history confirmation. Finish clears receipt timers and rejects unconfirmed waiters; never resend automatically. |
| Codex input | Capture parent thread/turn before preparing a steer. Initial turn/start input binds synchronously to its parent turn/started notification. Accept a native userMessage echo only for that input's owning parent turn. Child/other-turn echoes cannot acknowledge it. |
| Codex ACK | A steer ACK must name the captured turn. Missing/mismatched identity remains uncertain, retaining its input id and refusing another send. A valid native echo can prove acceptance after a lost RPC response. Known native rejection remains distinguishable from timeout/connection uncertainty. Normal completion waits for admitted RPC/receipt projection; execution retirement fences later unaccepted ACKs. |

Receipts and client-id-to-turn mappings are memory-only, scoped to their query/
execution. Persisted artifacts and native history continue to drive recovery
after restart. These rules do not promise exactly-once native execution across
process loss. Provider turn ids remain separate from numeric Mains turn ids.

Regression coverage exercises mounted run sessions with disposable SQLite,
controlled Git boundaries, Claude's actual async input stream and the Codex
coordinator/driver with controlled native RPC/notification boundaries. It covers
failed turn/artifact writes, recovery after later turns, initial acquisition
failure, legacy boundaries, duplicate/reentrant receipts, synchronous persistence
failure, cancellation/acceptance races, result/Stop draining, wrong-turn echoes/
ACKs and late responses after retirement. No real provider credentials or CLI
queries are used.
