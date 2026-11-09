# Pull request detail actions and drafts (106)

`features/pull-requests/lib/pull-request-lifecycle.ts` owns write admission,
provider-confirmation barriers, owner retirement and draft acknowledgements.
`use-pull-request-actions.ts` adapts the existing RTK Query mutations and
notifications. Summary and Changes consume one detail-view owner through
context. PRs remain live provider view models; no database state is added.

## Admission and provider state

One mounted view admits one write synchronously, before a React loading state
can commit. Buttons and keyboard handlers use the same rules. All writes need
an active view, a connected current transport and successfully loaded detail
matching the canonical provider/repository/number. A summary alone, an in-flight
refresh or a failed refresh retaining old detail never authorizes a write.

| Action | Additional admission rule | Successful receipt |
| --- | --- | --- |
| Merge | Open, not draft, provider mergeability is `MERGEABLE`. | Retain a merge barrier for this view; stale open detail cannot authorize another merge or merge method. |
| Ready for review | Open draft, `viewerCanUpdate`, nonempty provider node id. | Block another ready request until fresh detail confirms it is no longer draft. A later provider conversion back to draft may be submitted again. |
| Ordinary comment | Nonempty trimmed body. Closed/merged PRs can still receive ordinary comments. | Acknowledge only the submitted local draft version. |
| New review comment | Nonempty trimmed body, file path and positive integer line. | Close only the unchanged, still-mounted line composer that submitted it. |
| Thread reply | Nonempty trimmed body and thread present in current detail. | Clear/close only the unchanged current reply editor. |
| Resolve/unresolve | Thread exists, requested state differs, and the viewer has the permission for that direction. | Block stale repetitions until fresh detail confirms the target state. Later external thread changes are actionable again. |

GitHub still owns permissions, branch protections and the final mutation
result. CI/review summaries do not substitute for those provider checks.
Unknown mergeability disables merge until refreshed. Existing endpoint argument
shapes and provider invalidation remain unchanged, including provider node ids
for ready and thread ids for reply/resolve.

## Owner transitions

| Event | Transition / effect |
| --- | --- |
| Eligible action from idle | Claim one pending ticket before invoking its mutation. |
| Another action while pending | Ignore it, including a second shortcut and a different action in the other tab. |
| Current success | Install the appropriate provider-confirmation barrier, acknowledge the matching draft and release pending admission. Existing endpoint invalidation refreshes live data. |
| Current rejection/transport error | Preserve the draft, show the existing error while visible and release admission for an explicit retry. Never replay automatically. |
| Hide preview | Preserve the owner and ordinary comment draft; stop polling/unmount Changes as before. An already accepted success can acknowledge an unchanged draft, without a hidden-view toast. |
| Change PR, close view or replace transport | Retire old publication rights. A replacement PR/backend gets a fresh owner and draft. An A→B→A transport swap cannot revive an old ticket. |
| Transport status changes | Interrupt the old ticket without replaying it or acknowledging its draft. Reconnection invalidates detail/diff for a fresh read. |
| Strict Mode cleanup/setup | Detach the previous ticket generation; attachment never revives its completion. No write starts on mount. |

Retirement and closing an editor do not cancel a write already accepted by the
provider. If delivery is uncertain, retained text is a recovery draft, not proof
that no remote comment exists. Refresh/check provider activity before an explicit
retry; this change does not add remote idempotency keys or exactly-once delivery.
The existing backend-switch path still resets RTK Query state; a regression test
checks that an old merge completion cannot refresh the replacement cache.

## Draft versions

Each mounted editor owns text, an edit revision and an attachment generation.
A receipt can clear text only when both revision and generation still match
its submitted snapshot. Editing A→B→A is a new version even though its text
matches. Failed, disconnected, canceled/reopened or replaced-editor attempts
cannot clear a newer draft. Canceling a reply preserves its text but invalidates
the pending editor acknowledgement. Line composers are keyed by file, side and
line, so selecting another target never inherits the old target's text.

The ordinary comment draft survives hiding the preview and switching Summary /
Changes. Inline drafts remain local to their mounted Changes editors; leaving
Changes or closing a line composer discards those local editors as before.
Drafts are not persisted or synchronized.

## Regression coverage

Policy tests cover reference matching, stale/missing data, mergeability,
draft/permission guards, terminal barriers, thread reversal and draft ABA.
Strict Mode component tests exercise real Redux endpoints and transport envelopes
for duplicate submissions, failures/retry, edits while pending, hidden views,
PR/backend replacement, disconnect/reconnect, ready/resolve confirmation and
late completions. Inline tests replace only third-party diff rendering and
highlighting, retaining the actual PR forms and action adapter.

No real GitHub mutation, account or installed app profile is used by these tests.
No mobile, backend, wire contract or dependency changes are part of this packet.
