# Native browser presentation, downloads and inspection (74 + 75 + 76)

`src/shared/browser-lifecycle.ts` owns presentation eligibility, asynchronous
operation receipts, download phases/restoration and inspector capture admission.
The browser service binds those rules to its exact owner, tab, native view and
page. Electron, filesystem and renderer notifications stay in their existing
adapters. The capture controller is self-contained and serialized into the
isolated guest alongside the inspector; guest and host use the same rule source.

## Presentation and operation ownership

Native content may show only when the panel is attached, requested visible and
has no suppression leases. Blank tabs keep the renderer's new-tab surface.
Releasing an overlay's lease never overrides another lease, hides/shows a
different owner or reattaches a detached panel.

| Event | Ownership rule |
| --- | --- |
| Attach / detach / destroy | Retire the preceding presentation generation. |
| Change conversation | Retire old activation, mounting and inspection receipts, including a switch away and back. |
| Activate another tab | Validate admission before retiring prior work, then claim the latest activation before awaiting inspector teardown. A closing target cannot retire a valid pending selection; an older completion cannot change selection back. |
| Acquire/mount a native view | Check the captured host, owner, tab record and current view after acquisition. Only the latest mount can present/focus it. |
| Obsolete mount finishes | Hide its obsolete view when needed, while preserving a view already presented by its successor, including reuse of the same view. |
| Visibility/overlay-triggered acquisition fails | Consume the asynchronous failure and retain the logical tab for a later explicit retry. |

Each operation channel has its own receipt. Releasing a predecessor cannot
release its successor. The existing close/hibernation preparation in
`tab-resource-lifecycle.ts` retains ownership of native resource teardown;
this packet does not replace its veto, timeout or draft-preservation rules.

## Downloads

Download ownership is independent of the displayed tab and survives ordinary
panel detachment. The native item and logical row must still match before
an event can update that row or release its reserved destination.

The transition controller distinguishes Active, Canceling and Settled from the
public progress status. Active updates project Progressing, Paused or
Interrupted; an interruption update may resume. A native `done` receipt settles
once as Completed, Cancelled or Interrupted. Late progress and repeated terminal
events cannot reopen it or release a replacement download's path. Terminal
settlement removes its native update/done listeners and releases ownership.

Cancel claims Canceling before invoking the native item and projects Cancelled.
Repeated cancellation while pending does not invoke native cancellation again.
Progress updates cannot undo that projection. A synchronous terminal receipt
from inside `cancel()` is authoritative, including a completion that won the
race. A rejected cancellation without a terminal receipt restores the prior
projection and permits an explicit retry.

Clearing completed history retains native-owned transfers, including pending
cancellations. Path reservations remain until native settlement. Persisted
Progressing/Paused rows reload as Interrupted with zero speed and no native
cancellation handle. There is no automatic transfer replay. Existing filename
validation, Downloads-directory confinement and collision handling remain at
the filesystem boundary.

## Inspector installation and capture

Enable/disable owns the selected page and is acknowledged only by its current
receipt. Disabling retires pending capture immediately. Navigation and Escape
also retire an installation whose JavaScript acknowledgement has not returned;
its late reply cannot reactivate selection or steal focus.

Each guest inspector instance admits one pending capture. Add snapshots the
selection/comment, hides the editor and waits two paint frames. Further Add
actions coalesce while pending. Escape/teardown retires the controller so
queued paint callbacks cannot submit later.

Each attempt carries an instance-scoped capture id in the private console
protocol. Native completion/error and the fifteen-second guest timeout settle
only that id. An old receipt cannot clear a retried draft or a newly installed
inspector. Failures retain the selected elements and comment for an explicit
retry. The capture id does not change the renderer selection DTO, IPC channels
or persisted context format.

Host capture owns the originating tab record, native contents, URL, conversation
owner and selection lifetime. A retry supersedes an older capture for that tab.
Only a current receipt may acknowledge/deliver its result. Cancellation, owner
change, navigation or native-view replacement drops late results and deletes
their newly created screenshot. Successful delivery keeps the existing
annotation context, PNG attachment and capture-cache cleanup path.

## Regression coverage

Native service tests exercise competing tab activations, owner round trips,
replacement/reused views, acquisition failure, delayed installation and late
captures. Download tests drive native session/item events and observe the
public download projection, cancellation, persisted restoration and path reuse.
Guest tests execute the serialized scripts against a DOM with controlled paint
frames and timeout time, including stale acknowledgements and inspector
replacement. Existing browser, context-menu, device, preview, close and
annotation suites remain in validation.

No mobile, backend-service, database, channel or dependency changes are made.
