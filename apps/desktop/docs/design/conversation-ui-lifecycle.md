# Conversation writes, run reconciliation and UI ownership (15 + 17 + 105)

`src/renderer/lib/conversation-lifecycle.ts` owns settings-write admission,
read receipts and execution-scoped terminal claims. The settings writer,
run-sync hook, run cache and persisted-UI reconciler perform their existing
transport/Redux/React effects through these rules. The existing
`run-status-sync.ts` owns status-event routing across open tabs.

## Settings writes

Each transport object and run id has an independent queue. Admission captures
the model and flat configuration values immediately, before the asynchronous
write starts. Later mutation of the caller's object cannot change that write.

| Event | Rule |
| --- | --- |
| Edit with no pending write | Claim the queue and schedule the captured update. |
| Edit with a pending write | Append behind it, preserving admission order. |
| Send waits for settings | Drain the current write and any successors admitted while waiting. |
| Failed write with a queued successor | Preserve the caller's rejection; let the successor run and let a waiting send drain it. |
| Failed last write while send waits | Reject the barrier. A later explicit write may retry. |
| A job settles | Remove only its own queue entry; an older job cannot remove a successor. |
| Composer unmount or backend switch | Keep admitted writes on the original transport. Another backend/run saves independently. |

This queue is module-owned rather than composer-owned. Existing send and queue
consumers still use `waitForConversationSettings`; no second persistence path
or change to provider-wide preferences is introduced.

## Run observations and terminal effects

A read receipt belongs to its exact transport and view. A view includes its
workspace/routed chat, provider and mode. The transport epoch distinguishes
even a switch away and back to the same object. Scope cleanup, unmount, abort,
transport replacement or an observed disconnect permanently retires a receipt.
Reconnect cannot revive it.

Status pushes and selected-tab metadata reads supersede an older read for the
same run. Polls skip an outstanding read instead of opening overlapping
requests. Validation happens before superseding a predecessor, so an obsolete
caller cannot retire a valid replacement. Old cleanup releases only its own
receipt. Other open runs remain independent.

Only current successful observations may update run state or finalize it. A
running/queued observation rearms completion. A running/queued push also rearms
before its lookup, covering work that finishes before that lookup returns.
The first terminal observation claims that execution's effects; duplicate
terminal observations cannot repeat notifications or invalidations.

Optional error-history diagnosis has a separate effect owner after terminal
admission. A duplicate terminal read must not suppress that pending effect.
Another execution, cache reset, scope retirement or transport retirement does
suppress it. A failed diagnostic lookup still reports the original failure.
Accepted completion invalidates runs, workspace diffs, workspaces and reviews.

Each ten-second polling interval owns its timer. A late terminal response for
the previously selected tab may settle that tab, but cannot clear the newly
selected tab's interval. The latest stream-clear callback is read without
restarting polling whenever that callback identity changes. Voice transcripts
retain their existing idle-chat subscription and catch-up behavior.

## Persisted UI ownership

Reconciliation checks only ids already referenced by local drafts, queued
messages, tabs, context, right panes, previews or browser owners. It never
infers deletion from a paginated list. The newest valid pass for a backend
supersedes its predecessor; an already-aborted or obsolete pass cannot displace
a healthy pass. Existence reads remain bounded to eight per batch.

Only a current, connected, successful get-by-id returning exactly `null`
authorizes the existing backend-scoped UI cleanup. A successful record, failed
response, thrown lookup, disconnect, abort, backend change or stale receipt
preserves local state for a later pass. Old missing-record replies cannot erase
context that a newer pass has found. Listeners are released when the pass
finishes or retires.

## Regression coverage

Public writer/hook/reconciliation tests use controlled transport receipts and
fake polling time. They cover edits arriving during a send barrier, write
failure/recovery and snapshots, independent backends, latest-observation wins,
duplicate completion during diagnosis, continued executions, abandoned scopes,
late diagnostics, optional diagnosis failure, slow polls, timer ownership,
reconnect and stale/aborted UI cleanup. Existing history, queue, plan/question
and workspace-selection suites exercise the consumers.

The implementation changes desktop renderer code only. There are no mobile,
wire-contract, database, backend-service or dependency changes.
