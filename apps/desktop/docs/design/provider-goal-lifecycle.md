# Provider goal lifecycle (10)

The provider owns the native thread goal and its status graph. Mains keeps a
projection, admits explicit controls, and establishes an automatic objective
when session acquisition permits it. Run completion and goal completion are
independent: pausing or clearing a goal does not stop the run.

`packages/backend/shared/provider-goal-lifecycle.ts` owns snapshot validation,
automatic renewal/cleanup policy, partial-update validation and the mounted
view's transition rules. `codex-goal-lifecycle.ts` adapts those rules to native
thread ownership, ordered JSON-RPC operations and process retirement.
`use-codex-goal.ts` only binds the view to the current run, transport and API.

## Native goal transitions

| Event / provider fact | Rule |
| --- | --- |
| Goal mode off, blank objective or no thread | Do not perform automatic goal I/O. |
| New thread with goal mode enabled | Establish its prompt objective with `origin: automatic`; shorten workspace path mentions. |
| Continue or fork with an unfinished goal | Preserve `active`, `paused`, `blocked`, `usageLimited` and `budgetLimited`, plus unknown future statuses. |
| Continue or fork with verified absence | Establish the new objective automatically. |
| Continue or fork with verified `complete` | Renew the objective and explicitly set `active`; native updates otherwise preserve omitted status. |
| Goal lookup fails or returns malformed/mismatched data | Preserve provider ownership; failure is not evidence of absence. |
| Explicit edit, pause, resume or clear | Default to `origin: user`. Forward only supplied patch fields; omitted budget/status/objective stay omitted. |
| Automatic clear | Read the provider again and clear only a still-complete goal. Read failure, absence and unfinished status do not authorize deletion. |
| Native mutation fails, returns null, or clear returns false | Do not publish successful deletion or replace the last confirmed goal. |

Controls for the same run enter an admission queue before asynchronous saved
thread lookup. A second queue serializes all reads/writes for the same native
thread, including run aliases; independent threads can proceed concurrently.
The current run-to-thread binding is checked before dispatch and publication.
Process close retires queued work and late replies; shutdown also prevents
pending controls from starting another provider process.

Only valid, correlated notifications from the current native server publish
goal changes. A notification observed during a mutation can belong either
before or after it, even with equal native timestamps. The adapter performs a
bounded causal read to reconcile that ambiguity and protects a subsequent
notification from the resulting receipt. Its observation slots exist only
while a thread operation is pending; there is no additional durable goal store.
These local queues do not provide an atomic compare-and-clear against other
native clients; the provider remains authoritative.

## Mounted view and editor

| Event | Transition / effect |
| --- | --- |
| Initial read | Accept only while the same owner has seen no newer notification or admitted command. |
| Correlated live update | Project the validated provider fact. Ignore older native timestamps and malformed, uncorrelated or other-run/provider events. |
| Explicit control | Claim busy synchronously; another control cannot dispatch until its receipt settles. Pause requires active, resume requires paused, editing requires an unfinished existing goal. |
| Successful control receipt | Apply only if no newer live update superseded it. |
| False/null/error receipt | Preserve the last confirmed goal, release busy and permit explicit retry. |
| Provider clear | Remove the projection; retained edit controls cannot recreate the cleared goal. |
| Completed goal | Schedule one automatic clear after three seconds. Repeated usage updates do not restart the timer; a failed cleanup is attempted once for that completion cycle. A later completion cycle can schedule again. |
| New active goal, unmount, mode disable, run/provider/backend change | Retire the old owner, cancel its timer and ignore its callbacks/receipts, including A→B→A reuse. |

The editor retains rejected drafts, disables blank saves and avoids submitting
an unchanged display-shortened objective. Replacing its goal or scope resets
the editor. Provider notifications, not speculative UI changes, remain the
source of progress and usage.

## Regression boundaries

Policy tests cover authoritative absence, malformed ownership, unknown states
and finite usage values. Native owner tests cover admission order, thread
aliases, independent threads, partial updates, process retirement and live
notification reconciliation. Driver tests use a local Node subprocess and the
actual JSON-RPC protocol, including inherited fork goals, continuation read
failure, renewal, automatic-clear eligibility and mutation provenance.

Strict Mode renderer tests use the actual Redux endpoints, transport envelopes
and goal bar. They cover failed controls, stale reads/receipts, scope and backend
replacement, single admission, completion timers and editor behavior. Only the
native boundary is a fixture. No real provider, installed app profile, database
migration, new wire channel or mobile change is needed.
