# MCP App ownership and review lifecycle (inventory 77 + 78 + 87)

`src/shared/mcp-app-lifecycle.ts` owns launch/resource tickets, iframe connection
states, native session admission/cleanup and user message reviews. It is shared
by the Electron service and renderer without importing either platform. React
holds the presentation snapshots; provider and protocol effects stay at their
existing boundaries. No mobile, wire-contract, database or dependency changes
are introduced.

## Launch and resource acquisition

A launch ticket belongs to its backend, space, provider, mode, workspace or
collection, and route. A new launch supersedes the previous ticket. Leaving its
context or route retires it permanently; returning to the same values cannot
revive it. A late native session is closed through its original owner. Changing
the selected collection during a Work/Chat launch cannot switch selection back
when that launch finishes. Existing app documents keep their captured scope.

Resource reads use the same ticket rule. Late success/failure from an obsolete
read cannot mount or fail the replacement document. Reload, unmount and
StrictMode cleanup retire old callbacks. Merely changing the conversation,
display mode, callback identities or model context retains the app connection.

## Iframe connection

| State / event | Transition |
| --- | --- |
| Waiting for frame / no browsing context | Retry after 50 ms, bounded by a ten-second deadline. |
| Waiting for frame / context available | Claim Connecting before calling the bridge, so repeated load events cannot connect twice. |
| Connecting / transport attached | Enter Connected and navigate the inert `about:blank` frame to its registered resource. |
| Live / standard initialization | Enter Initialized and deliver current input/result/context. |
| Live / compatibility ready | Enable that channel independently; it does not authorize standard notifications or teardown. |
| Actual resource load / no standard initialization | After 750 ms, send the compatibility fallback using the latest input/result. |
| Connection failure or frame deadline | Retire callbacks and timers; expose the current document's error. |
| Replacement or disposal | Abort this document's pending review, clear timers/listeners and close its bridge. Late receipts cannot alter the replacement. |

Native teardown/save barriers remain in the existing tab resource lifecycle.
They require an initialized standard bridge, tolerate only MethodNotFound for
the optional teardown method, and retain a failed save for retry.

## Native extension sessions

Opening is claimed before provider lookup/acquisition. Each acquired session
retains its exact adapter, app and resource. Tools still check whether the
provider is enabled, then recheck the session's identity after that await.
Provider configuration changes cannot retarget a call to a replacement adapter.

Close moves the session from Active to Closing before asynchronous cleanup.
Resource/tool admission stops immediately; HTML is revoked once and concurrent
close requests share native teardown. Success removes the entry. Failure keeps
it Closing for retry, including cleanup of acquisitions whose HTML could not be
hosted. Cleanup does not require the provider to remain enabled.

Close-all retires the opening generation, refuses new opens during its drain,
waits for admitted opens and releases late acquisitions before joining native
cleanup. A later open can start a fresh generation after the drain completes.
Failed cleanup entries remain available to subsequent cleanup attempts.

## Message review and conversation ownership

A pending review has a unique request id and the original resource/conversation
owner. Only that request's Send action can settle edited, trimmed text within
32,000 characters. Duplicate requests are refused. Cancel, RPC abort, document
disposal, hidden presentation, owner change and unmount settle without sending.
Hidden apps cannot open another review. Old confirmation/dismissal callbacks or
abort signals cannot settle a replacement request.

Approval is rechecked against the conversation owner immediately before send.
Changing conversations between confirmation and dispatch cannot retarget the
message. Late model-context receipts also cannot replace a new conversation's
context. The existing normal composer sender retains in-flight send ownership;
no separate run-start path is added.

Public service, hook and mounted-component tests exercise these transitions.
They use deferred provider/protocol receipts and real React/router/review state,
without provider login or a running installed-app profile.
