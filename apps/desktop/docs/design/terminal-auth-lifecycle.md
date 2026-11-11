# Terminal process, view and provider sign-in lifecycle

Inventory **80 + 98** separates three owners:
`packages/backend/src/modules/terminal/terminal-lifecycle.ts` for native processes,
input receipts and discovery; renderer `features/workspace/lib/terminal-view-lifecycle.ts`
for attachments and temporary leases; `provider-auth-terminal.ts` for sign-in
identity. The service, xterm component and Redux slice supply native effects and
presentation. No database migration or new dependency is required.

| Owner | Transition and rule |
| --- | --- |
| Native process | Running → exited / stopping → destroyed. A native exit settles once; retain its bounded output until explicit removal. Stop first claims its transition, then calls native kill. A thrown stop retains ownership for retry, unless a native exit has already confirmed termination. A successful kill request permits logical removal; it is not treated as a separate OS-exit event. |
| Partial acquisition | Spawned → listeners installed → owned. Listener setup failure requests native cleanup. If cleanup also fails, retain the failed process for Stop/shutdown retry and refuse attachment/input. One listener's disposal failure cannot prevent the other disposal. |
| Process identity | A stable terminal id may be reused after removal; every new process gets a fresh `instanceId`. Input, resize and view cleanup carry that incarnation when available. A stale native target cannot mutate the replacement. Optional fields/arguments preserve older clients and servers. |
| Input receipt | Unseen → admitted → sent / unconfirmed, keyed by command id within one native process. Reserve before native write, which may partially succeed before throwing. Equal confirmed retries acknowledge without another write, including after native exit; conflicting text or unconfirmed delivery refuses replay. Missing processes and new input to exited processes refuse delivery. Receipts are bounded to 32 per process and remain memory-only until removal. Ordinary keyboard input keeps its existing semantics. |
| Catalog discovery | Unwatched / waiting → scanning → waiting. One timer and one scan per watcher generation. Replacing/unregistering the watcher retires old publication and allows a fresh query immediately; an old finally cannot clear the new query. Process identity/running checks gate result application. Empty catalogs stop timers; failed native inspection remains unknown. Windows retains the existing no-POSIX-probe policy. |
| Workspace attachment | Attaching → ready / exited / disconnected → reattaching; disposal is terminal for that view. Attempt generations fence late snapshots and errors. An exit racing attachment wins over a running snapshot. Fit before replay; replay sequences reconcile buffered live output once. Exited, disconnected and disposed views refuse native input. View cleanup releases xterm/listeners without killing persistent PTYs. |
| Temporary PTY | Acquire → one shared pending creation → referenced → retiring → cleanup. Views of the same terminal and transport share ownership. Immediate effect replay reacquires before retirement. Last release waits for all pending acquisitions before cleanup, including late successful creation. A replacement waits for its predecessor's cleanup; native incarnation checks protect cleanup after id reuse. Failed cleanup remains retryable. |
| Sign-in session | Closed → opened with a fresh id and pending command → acknowledged → closed. Duplicate opens for the same provider/command retain the existing id and acknowledgement. Close/reopen creates a new id. Onboarding and workspace surfaces use that same identity. Provider/backend replacement retires the old login; old acknowledgement and Close callbacks cannot clear a replacement. |
| Sign-in delivery | Ready PTY → one admitted command promise → acknowledged / error / unconfirmed. Readiness belongs to the current terminal id, transport and attachment; switching terminals cannot reuse the previous view's readiness. Rerenders, additional views and reconnects join the attempt. Only confirmed success clears the pending command. Uncertainty is visible and is never automatically resent; restarting sign-in is an explicit new session. Latest callbacks can observe the shared outcome without submitting another input. |
| Host cleanup | Attempt every terminal even if one stop fails. The standalone host drains provider cleanup too and retains its database lease when native cleanup fails, allowing Close retry. Desktop quit reports a terminal cleanup failure and continues its other shutdown work. |

Identity/receipt fields are additive to the existing terminal contract. No new
IPC channel or paired-device terminal permission is introduced. The backend
continues to own environment filtering, cwd/workspace checks, shell integration,
output bounds and native discovery. Credentials and output are not persisted by
these owners. Input receipts do not promise exactly-once execution across backend
restart, process replacement or a newly opened sign-in session.

Regression tests exercise real terminal service/IPC boundaries, host ownership,
Redux/hooks and mounted xterm views with controlled native boundaries. Existing
real-PTY tests use disposable directories and owned loopback servers to verify
detach/reattach, explicit destruction and conservative idle cleanup. New coverage
includes partial acquisition, failed stop/retry, discovery handoff, stale process
targets, one-shot/uncertain input, late creation, Strict Mode/shared views,
reconnect races and sign-in incarnation callbacks. No real provider login is run.
