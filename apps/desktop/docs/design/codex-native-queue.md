# Codex native queue migration

Status: design completed; native delivery is not enabled. Protocol baseline:
Codex CLI 0.167.0, generated with `app-server generate-ts --experimental`.

## Existing contract

`runQueueSlice.ts` owns pending messages by backend/run. Each row freezes its
client message id, model, conversation settings (including permission profile),
additional directories, context and upload identities. `run-queue-controller.ts`
and its single app-scoped consumer deliver after a normal turn finishes. The
floating renderer mirrors that owner; it never drains independently. Editing,
reordering, Stop, failure and uncertain acceptance already have explicit guards.
See [turn input lifecycle](turn-input-lifecycle.md).

Files remain in the transient upload owner until acceptance. The backend's
existing attachment preparation retains submitted originals before native input,
and accepted prompts retain those references. A queue admission is not a prompt
receipt and must not create a user transcript row or a Git turn boundary.

## Native surface and gaps

The 0.167 generated request/result types expose:

| RPC / notification | Native fields | Mapping |
| --- | --- | --- |
| `thread/queue/add` | `threadId`, `input: UserInput[]`, `clientUserMessageId` | Returns `queuedSubmission` with native `id` and the same client id. |
| `thread/queue/list` | `threadId`, pagination cursor/limit | Returns submission pages and `nextCursor`; consume every page before publishing a snapshot. |
| `thread/queue/update` | `threadId`, `queuedSubmissionId`, `input` | Content edit preserves submission and client-message identity. |
| `thread/queue/delete` | `threadId`, `queuedSubmissionId` | Remove only after confirmed acknowledgement or an authoritative list. |
| `thread/queue/reorder` | `threadId`, `queuedSubmissionIds` | Submit a complete, current permutation; never merge by array position. |
| `thread/queue/start` | `threadId`, optional `queuedSubmissionId` | Explicitly starts a queued submission; it must have a single backend execution owner. |
| `thread/queue/changed` | `threadId` | Invalidation hint: read the queue again, not an ordering or delivery receipt. |

`QueuedSubmission` contains only `id`, `input`, and `clientUserMessageId`. It has
no model, effort, service tier, permission profile, extra-directory snapshot,
Mains context descriptor, revision, status, or attachment ownership metadata.
Those missing fields prevent replacing Mains' queue transparently.

The schema alone does not establish persistence across app-server restart,
automatic-drain/pause behavior, add idempotency, or atomicity between changing
thread settings and starting a queue item. The adapter must not advertise those
guarantees before they are tested against the supported CLI versions.

## Decision

Keep the existing local queue as the production default for every provider.
Do not translate pending messages into user prompts, encode hidden settings in
prompt text, create a second Mains pending-message table, or split ownership
between a renderer drain and a native drain.

A future native implementation belongs behind an optional driver queue port,
not Codex branches in the renderer. The port returns capability limits as well
as queue rows. A Mains queue row uses backend id + run id + stable client message
id; its native submission id is an additional correlation, never the user-facing
identity. Other providers continue using the current local implementation.

Native delivery can become the default only when it preserves every row's
settings and attachments, or the product explicitly introduces a different
queue contract. Until then, a homogeneous-settings opt-in would have to state
that limit and refuse incompatible rows; it cannot silently lose a snapshot.
The phase-three active-turn settings RPC alone does not make per-message queue
settings atomic.

## Ownership and transitions for the future port

The backend acquires a single queue/execution owner for a provider thread. All
desktop, web, floating and phone actions go through that owner. Its projection
phases are `preparing → adding → queued → starting → accepted`, with
`uncertain` and `paused` exits. A failed preparation retains the draft; an
unacknowledged write is reconciled before any repeat mutation.

1. Prepare typed input through the existing context and attachment builder.
   Recheck backend/run ownership and the queue's pause revision immediately
   before native mutation. Native ids are never accepted from a different run.
2. Add with the original client id. A successful add means **queued**, not
   consumed. If the response is lost, list all pages and match the client id;
   if neither presence nor absence is established, keep `uncertain` and do not
   auto-resend.
3. Queue changes coalesce into one serial reread for that thread. Publish only
   a complete list belonging to the current owner. Reconnect subscribes before
   its catch-up read; closing a view does not create another consumer.
4. Admit edits/reorder only while queued, against the latest snapshot. A native
   change during editing invalidates the action and retains the local draft.
   Serialize Mains mutations and reread after acknowledgement; because the RPC
   has no compare-and-swap revision, external-writer races must surface as a
   refresh/conflict rather than claimed atomic protection.
5. Immediately before start, enforce the selected profile and current managed
   policy, resolve the message's exact model/effort/speed, and verify that the
   native runtime can apply those settings without another writer interleaving.
   Without that guarantee, refuse native delivery and retain the local row.
6. Only identified native consumption (`clientUserMessageId` in the accepted
   turn/history) records the ordinary user prompt, binds the Mains turn/Git
   boundary and releases submitted upload leases. Reuse existing input receipt
   and attachment identities. A missing queue row alone proves no acceptance.

Stop fences new starts first and cancels the owned active turn. It must not
allow server-side auto-drain after cancellation. Keep remaining rows paused;
do not bulk-delete native items or restart them on reconnection. Failure,
archive, backend switch and disconnect follow the same explicit-resume rule.
If the native runtime cannot pause safely, do not enable native ownership.

## Attachments and context

Before advertising restart/device-independent queueing, the native row must
refer to content retained on its backend host. Local image paths alone do not
prove that ownership survives reload, and this protocol version has no opaque
Mains metadata field to carry durable attachment ids/context. Preserve image,
document, skill, plugin, browser/code selection, issue and signal semantics
through the existing typed-input builder. Never release originals on add,
queue-list removal, a status event, or a lost start response.

Pending local File/URL leases remain local and unpersisted. Restart-safe pending
input would require an explicit change to the current queue/attachment contract;
it is not introduced by this design or by selecting a native queue capability.

## Enablement gates

- Test add/update/delete/reorder/list/start against a disposable Codex home and
  every supported CLI; no inference is required for schema/discovery checks.
  Use the fake app-server for model-start regression coverage.
- Prove start ownership, Stop/pause behavior and retention across renderer,
  transport and app-server restarts; otherwise leave the capability disabled.
- Cover different models/efforts/speeds/profiles/directories in adjacent rows,
  policy changes between add and start, deleted models/profiles, and Chat's
  read-only mode. Incompatible messages remain local without partial migration.
- Cover repeated cursors, empty pages, lost mutation acknowledgements, duplicate
  client ids, edits racing external writers, multiple clients, switching away
  and back, uncertain consumption, and per-file attachment references.
- Require one transcript prompt and one turn boundary per consumed message;
  neither add/list nor UI optimism may produce either.

Permission discovery is implemented separately through `permissionProfile/list`
and `configRequirements/read`; it does not turn on native queue delivery.
See the [official app-server reference](https://learn.chatgpt.com/docs/app-server)
and [permission profile documentation](https://learn.chatgpt.com/docs/permissions).
