# Lens capture and keyboard recording (86 + 103)

`src/shared/capture-shortcut-lifecycle.ts` owns the platform-free transition
rules. Electron adapters own registration, screen/accessibility acquisition and
PNG files. Renderer adapters own draft context, navigation, settings presentation
and native IPC. No mobile, backend package, wire DTO, channel, database schema
or dependency changes are introduced.

## Native admission, startup and shutdown

Lens moves from available to capturing and back. One in-flight acquisition is
admitted synchronously; another capture is refused. A failed attempt releases
that admission for explicit retry. Normal screen permission checks happen
before reading content. Optional accessibility permission does not block pixels.
Unsupported platforms never acquire a shortcut or capture content.

Stop is one-way for the service instance. Desktop cleanup closes Lens and
shortcut-write admission at its first asynchronous cleanup barrier. It retires
the current capture before waiting for accepted capture/configuration work.
After each native await, acquisition checks its owner before further effects.
Retired acquisition cannot notify a renderer, enqueue delivery or reopen the
main window. A PNG written before retirement remains provisional and is removed
when that acquisition drains. No native request is claimed to be canceled by
fencing alone; shutdown waits for its settlement.

A failed native unregister retains the registration flag/binding for a repeated
stop. Callbacks are retired before unregistering, so retained native ownership
cannot still capture. Failure does not skip draining the retired acquisition.

## Shortcut settings and registrations

Lens configuration and general keyboard overrides each use their own ordered
write queue. Validation, native effects, persistence and publication run inside
the queue. A failed write does not block successors. Keyboard edits validate
against the preceding confirmed overrides; clearing a binding can therefore
free it for the next queued edit. Reset is another ordered mutation.

Startup reads carry an intent revision. An explicit mutation retires the read
at admission, including a late read error. A late startup result cannot replace
a manual preference or re-register after shutdown. A current startup error
still reaches the caller.

| Event | Transition / effect |
| --- | --- |
| Lens configuration | Release the previous registration, acquire the requested one, then persist. |
| Failed acquisition or persistence | Restore the previous configuration while its command remains current. |
| Stop during persistence | Wait for the accepted write; no rollback may re-register after stop. |
| Registration replacement | Retire the old callback before native unregister. |
| Old queued key callback | Ignore it, including disable/re-enable with the same accelerator. |
| Explicit manual test capture | Remain available when the global shortcut is disabled, preserving existing behavior. |
| Native keyboard write | Persist its next override snapshot before replacing confirmed in-memory bindings. |
| Renderer keyboard write/reset | Serialize native RPCs and confirmed snapshots within the mounted provider. |
| Provider disposal | Retire late reads/results and refuse queued RPCs that have not started. An already dispatched native write keeps its native lifetime. |

## Lens delivery and files

Main retains at most eight pending captures, preserving the existing newest
eight policy. The legacy `consumePending` operation now returns a snapshot;
only a matching `acknowledge(id)` or explicit deletion removes a pending entry.
Reading through a retired renderer therefore cannot lose a capture. Unknown
acknowledgements do not consume another entry. A failed renderer notification
leaves the capture available to catch-up.

One mounted receiver owns event and catch-up callbacks. It claims capture ids
before dispatching draft context and acknowledges after attachment. Duplicate
receipts retry acknowledgement without appending, navigating or notifying
twice. A failed acknowledgement remains retryable through another delivery or
catch-up read. Cleanup retires callbacks before unsubscribing; old queued
callbacks and read results cannot touch the draft or acknowledge.

Existing file trust boundaries, explicit deletion and cache eviction remain in
the Electron adapter. Deletion removes only the named PNG and its matching
pending entry. Already delivered captures retain the existing composer/cache
lifetime; the delivery queue is in memory rather than a durable replay log.
Capture still adds context to a draft and never starts or continues agent work.

## Lens settings presentation

Focus refreshes own monotonically newer read receipts. Only the latest current
read can publish permission/configuration state. A control action claims before
native IPC and retires earlier reads; refreshes do not run while it owns the
view. Configuration, manual test capture and permission/settings actions share
this admission. Rejections release the controls for retry and are displayed
only by their surviving view. Unmount retires reads, actions and focus listeners.

## Keyboard recorder

The recorder moves `idle → recording → saving → idle`, returning to Recording
with the original selection and an error on failed persistence. Cancel and
Escape leave Recording without a write. A bare Delete/Backspace unassigns the
binding; invalid, reserved and conflicting combinations remain in Recording.
Repeat and composition events are ignored.

Saving is claimed before invoking the provider, so duplicate keys/clicks cannot
admit another write before React paints Busy. Busy blocks another recorder,
cancel, reset and mutations. Reset all shares the same admission and publishes
success only after confirmation. Disposing the page retires its callbacks;
accepted native writes can finish, while old results cannot close a replacement
recorder or display stale notifications. Existing platform-aware binding rules
and dispatch suppression for editable/recorder targets are reused.

## Regression coverage

Public native service tests control only Electron, native scripts and settings
storage, with disposable capture directories. They cover pending shutdown,
failed unregister/drain/retry, late startup data/errors, preference write order,
registration rollback and callback replacement, permission failure, acquisition
retry, provisional PNG deletion and bounded matching delivery/deletion.

Renderer tests use real Redux draft state, router, shortcut provider and settings
components with controlled native IPC and notifications. They cover retired
reads, live/catch-up deduplication, acknowledgement retry, navigation subscription
replacement, ordered preferences, stale initial/focus reads, duplicate recording,
validation, cancellation, reset/save failure and view disposal. Tests do not read
the real screen/accessibility tree, register a real global shortcut, open system
settings or use an installed-app profile.
