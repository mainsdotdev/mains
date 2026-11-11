# Atlas image creator lifecycle (44)

`features/atlas/lib/image-creator-lifecycle.ts` owns Space selection and
validation, skill readiness, submission admission, preparation cancellation,
draft acknowledgements and Stop admission. `use-image-creator-setup.ts` adapts
the existing RTK Query reads/mutation. The view retains the shared Work
composer, transcript, approvals and image-only attachment picker.

## Setup and scope

One mounted backend/account/project/run scope owns its setup. Transport changes
also replace its generation, including A→B→A changes in one React batch.
Old owners retire immediately and cannot publish a late creation, run result,
notification, draft change or navigation into the replacement view.

| Event | Transition / rule |
| --- | --- |
| Space/settings discovery pending | Wait; do not create a replacement from an incomplete list. |
| Space discovery fails | Show the existing error surface; Retry refetches discovery rather than creating a Space. Cached failed discovery does not authorize setup. |
| New image with an available Space | Prefer the active, unarchived, account-owned Codex Space, then another matching Space. Project it to Work locally. |
| No matching Space after successful discovery | Admit one creation. Strict Mode cleanup/setup reuses that pending creation. |
| Creation succeeds | Validate account, Codex provider and unarchived identity before exposing it. |
| Creation fails | Keep an error until explicit Retry. Repeated Retry clicks share one new creation. |
| Existing run | Read its saved Space; require this account, Codex and Work. Missing/wrong runs and unavailable Spaces never fall back to a new conversation. Archived Spaces may still identify historical runs. |
| Owner retires | Ignore its result. A Space creation already dispatched may still persist; do not delete it or replay it automatically. |

The app's global active Space and the saved Space mode are unchanged. Existing
conversation collection ownership takes precedence over the new-image route.
Image Gen comes from the canonical Codex skill list, with its actual name,
path, scope and mention metadata. Missing/disabled/non-invokable skills and
loading, refreshing or failed skill reads block submission.

## Submission and Stop

| Event | Transition / effect |
| --- | --- |
| Eligible Send from idle | Claim `preparing` synchronously and snapshot prompt, settings, context and image uploads. A second click cannot start another attempt. |
| Preparation finishes | Recheck current owner, readiness, run identity/status and the captured skill identity before entering `submitting`. |
| Cancel preparation | Return to idle, release that attempt's upload lease and retain its draft. Late file reads cannot submit or unlock a replacement attempt. |
| Native dispatch has started | Preparation cancellation is no longer available. Wait for the native result; use ordinary Stop once a real run is active. |
| Current accepted result | Enter `accepted`; reconcile the settings snapshot, acknowledge only unchanged draft text and consume only submitted uploads/context. A new conversation navigates to its accepted run. |
| Handoff after accepted new run | Keep acceptance as a barrier: a later handoff failure cannot authorize another new run from the same owner. |
| Rejection/read failure/uncertain delivery | Preserve the input, release admission and show the current owner's error. Retry requires an explicit user action. |
| Running/queued run | Do not submit a new image message. Stop admits one native abort synchronously. |
| Stop succeeds while status lags | Suppress another abort until a terminal status is observed. A later turn may be stopped again. |
| Stop fails | Preserve the active run and permit explicit Stop retry. |
| Cleanup/transport replacement | Retire old tickets and release temporary leases. Old completions cannot acknowledge drafts or publish UI effects. |

The image owner passes an optional `operationIsCurrent` guard through
`useWorkspaceRuns` to `useRunOperations`. It fences account lookup, settings
queue waits, native receipts and run registration. Fresh account lookup must
match the image owner's account before native submission. Other callers retain
the existing default behavior. The settings handoff also receives that ticket's
publication guard, so a late save failure cannot toast after navigation.

An accepted new run navigates through the existing Atlas route. Generated files
and sent attachments retain ordinary backend run ownership; no second output
or attachment store is introduced. Local accepted-upload reconciliation removes
only the captured entries. Files, text and context added during an await remain
under their existing composer owner. Draft edit revisions prevent an older
acceptance from clearing a newer edit, including A→B→A edits through the composer.

Canceling preparation does not cancel a provider write already dispatched.
Native failure or a lost acknowledgement does not prove the provider rejected
the message. No automatic replay, remote idempotency protocol, database,
channel, dependency or mobile change is introduced.

## Regression boundaries

Policy tests cover eligibility, attempt ownership, preparation cancellation,
lease release, draft revisions, acceptance barriers and Stop retry/confirmation.
Strict Mode component tests keep the actual composer, Redux ownership, upload
store and settings adapter. Setup and run-delivery tests use the actual Redux
endpoints, transport envelopes, account lookup and settings writer; only native
transport responses are fixtures. Shared run/settings hook regressions remain
in the validation set. Tests do not create a real Space/run, contact a provider
or use an installed app profile.
