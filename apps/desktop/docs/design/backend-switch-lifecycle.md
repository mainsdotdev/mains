# Backend selection and SSH tunnel ownership

Inventory families **46 + 54** have two owners: a renderer connection intent
and a native SSH process. A candidate's HTTP reachability is distinct from a
verified Mains backend, and requesting process termination is distinct from
observing its close.

| Owner | Transitions and rules | Implementation |
| --- | --- | --- |
| Selection intent | Preparing → verifying → active; preparing/verifying → retired. A new intent retires the previous candidate immediately, before tunnel or credential awaits. The current backend stays active until verification succeeds. A retired continuation cannot start another transport or publish a result. | `renderer/lib/transport/backend-switch-lifecycle.ts` |
| Resource lease | Candidates retain their own disposers. Late acquired resources are disposed immediately when their lease has retired. Promotion transfers the candidate's transport/tunnel resources to active ownership and then releases the previous active lease. Cleanup failure is logged independently and does not roll back a promoted backend. | Backend switch lifecycle |
| Verification | A candidate uses no reconnect while checking `backend:describe`. Valid descriptor shape, compatible protocol and a still-connected socket are required at promotion. Verification has a ten-second budget. Cancellation also disposes the candidate, including a response that was already queued before a newer intent. | `renderer/lib/transport/backend.ts` |
| Publication | The transport pointer changes before the saved-selection callback; that callback runs before transport observers are notified. Both Redux subscribers and transport observers therefore read the new transport with its matching selected backend. Local selection uses the same publication order. Registry changes outside the current promotion retire old connection ownership. | Transport registry and backend activation |
| View lifetime | Native tunnel results and stored credentials are rechecked after awaits. Removing the candidate's saved backend or unmounting its initiating view retires its preparation; a committed connection survives Settings navigation. Multiple hook instances share the connection owner. | `use-backend-connection.ts` |
| Native admission | Absent → preparing → probing → ready → closing → closed. Admission precedes port allocation. An optional request nonce identifies one attempt: identical requests join, conflicting reuse rejects, and cancellation can arrive before admission. Closing request ids cannot return another ready handle. Legacy callers without a nonce still use handle-based close. | `main/modules/ssh/ssh-tunnel-lifecycle.ts` |
| Port and spawn | A canceled port allocation finishes releasing its server before the opening job drains. Its late callback cannot spawn SSH. Only the OS spawn event admits readiness probing. Spawn/process failures retain their original error; canceled or retired jobs cannot publish readiness. | SSH tunnel lifecycle |
| HTTP probe | Any HTTP response proves reachability only; renderer descriptor verification establishes Mains identity. The probe allows 15 seconds for a running backend or 45 seconds for auto-launch. One timeout/error pair schedules one retry. Settlement destroys the active request and clears deadline/retry timers and subscriptions. Old responses cannot reopen a settled probe. Stderr is bounded and generated launch tokens are redacted from readiness errors. | SSH tunnel lifecycle |
| Native close | Close/cancel retires readiness, requests termination once, and escalates after 1.5 seconds if the process has not exited. Neither a successful kill call, the force deadline nor an exit event confirms close. Ownership ends after the opening job settles and the child emits close. Repeated close calls await the same drain. An exit between HTTP response and handle publication rejects readiness. | SSH tunnel lifecycle |
| Host shutdown | Fence new opens before the host's first cleanup await, retire all admitted jobs, then await every drain. Reopening requires completed cleanup and starts fresh cancellation receipts. One tunnel's closure cannot remove another tunnel's ownership. | SSH lifecycle, IPC registration and main composition root |

`ssh.utils.ts` retains the pure host/known-host parsing, argv and launch-command
helpers. No remote credentials, selection attempts or cancellation receipts are
newly persisted. The additional `ssh:cancelTunnelOpen` channel and optional nonce
are additive; paired-device permissions and protocol version are unchanged.

Termination remains a request until the operating system confirms process
close. A process that has not closed stays owned, including after escalation.
This is an in-process lifecycle, not a guarantee that an arbitrary user-supplied
remote launch command has terminated a remote daemon.

Tests exercise real transport verification with fake sockets, the hook with a
real Redux store, and the public SSH service with controlled process/network
boundaries. They cover cancellation, queued old responses, atomic publication,
late credentials/handles, failed replacement, removal/unmount, request joining,
port allocation, spawn failure, probe retry/deadlines, process exit/close and
forced termination. No SSH connection, remote command or user profile is used.
