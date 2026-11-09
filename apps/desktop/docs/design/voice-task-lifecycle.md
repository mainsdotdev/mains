# Voice delegated-work coordination (18)

`packages/backend/src/modules/runs/voice-task-lifecycle.ts` owns the session
phase, task-key claims, link checkpoints, per-worker delivery queues, Stop
barriers, notification receipts, waits and timers. `voice-task-coordinator.ts`
adapts existing run operations, account/link validation and report assembly.
`runs.service.ts` supplies provider execution and durable artifact effects.
Desktop and standalone server use the same owner; mobile is outside this change.

## Admission and delegated workers

| Event | Transition / effect |
| --- | --- |
| Start with a new task key | Claim the key before invoking creation. Only one creation runs for that key. |
| Repeated Start while creation or saving is pending | Join the original result, including its durable checkpoint. |
| Recovered, saved task key | Read the existing linked worker; never resubmit its original prompt. |
| Creation fails before returning a worker | Release the claim; a later explicit Start can retry. |
| Worker created | Retain its identity before saving its title and parent navigation artifact. |
| Title/link checkpoint fails | Retain the worker and retry the checkpoint on the next explicit Start. Do not execute the task again. |
| Voice retires during admitted creation | Finish saving the worker's link so a later call can recover it. Do not cancel the worker or announce into the retired call. |
| Independent task key | Create a separate visible working chat. |

Workers retain the parent's account, Space, workspace, collection, mode, model,
permissions and turn lineage. Restored links still require current account,
availability and archive checks before reads or mutations. The parent run itself
cannot be used as a worker. Worker prompts retain their existing delegation
metadata; no new table, migration or wire contract is introduced.

## Follow-ups and Stop

Admission claims a delivery before any asynchronous ownership/acceptance reads.
Each worker serializes its follow-ups in call order; different workers remain
independent. Dispatch rereads the worker status after the preceding operation:
running/queued work is steered, and idle work is continued.

The existing stable message id derives from the parent run and client message id,
with a worker-scoped receipt. Identical repeats join the original delivery;
different text with that same identity is rejected. An existing provider receipt
prevents dispatch. A preparation failure permits an explicit retry. Once native
send has been invoked, an error has an uncertain outcome: return `unconfirmed`,
retain the identity and only inspect receipts on repeats. Never automatically
resend or manufacture a new message id to bypass uncertainty.

Stop retires previously admitted, undispatched follow-ups immediately, before its
asynchronous ownership read. Concurrent Stops join one native cancellation. A
later explicit follow-up waits for that cancellation and rereads status before
dispatch. A failed Stop blocks that waiting delivery; an explicit later operation
can retry. Stop cannot retract a native send already dispatched.

## Reports, notifications and waits

Reports read status/turn identity before and after the parallel history reads.
A transition retries once; another transition rejects the mixed report and asks
for a fresh read. Report content belongs to the latest turn, excludes user-prompt
artifacts and remains bounded. `succeeded` describes the latest turn, not proof
that the user's entire task is finished.

Worker status, persisted events and approval changes wake waits and coalesce
inspection over 1.5 seconds. Ordinary progress is quiet; terminal/attention updates
request speech. Cursor and turn/status/approval receipts suppress repeats only
after successful local publication. Failed publication remains eligible on a
later event. This receipt confirms local dispatch, not audible playback or an
end-to-end transport acknowledgment. A changed report arriving after the turn-end
announcement still updates context quietly; it does not repeat that spoken
announcement. Retired inspections cannot publish.

Wait subscribes before rechecking to cover changes between its first read and
subscription. Its deadline is bounded to 0–30 seconds. Completion, attention or a
different cursor returns immediately. Ending/disposal releases every wait and
clears its deadline. There is no background polling of unchanged workers.

## Ending and disposal

The session transitions `open → ending → closed`. End immediately closes command
admission, retires undispatched follow-ups and releases observers, then delays the
native effect 250 ms so the management tool can return before its MCP transport
closes. Repeated End joins the attempt; dispatch rechecks host ownership. A native
failure reopens admission only if that same host still owns an active connection.
Previously retired instructions stay retired after reopening. The real run
service retires coordination when native stop begins; its existing connection-
scoped closure retry remains authoritative.

Disposal is permanent and idempotent. It removes the event sink, fences pending
inspection/delivery, clears notification/closure timers and releases waits.
Neither End nor disposal cancels delegated workers. Only an explicit user Stop
requests worker cancellation. Worker reports and tool output cannot authorize
additional work or closing the voice call.

## Verification

`voice-task-coordinator.test.ts` exercises these rules through the public voice
tools with deferred effects, fake deadlines and real event-bus subscriptions.
`runs.service.test.ts` uses disposable SQLite databases to check inherited
settings, title-checkpoint retry, durable links, late creation after closure and
recovery by a later voice call. Providers and audio devices are not contacted.
