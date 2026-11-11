# Overlay and copy feedback lifecycles (101 + 102)

`src/renderer/lib/overlay-lifecycle.ts` owns overlay phases, opening identities,
interaction claims, frame/timer retirement and focus leases.
`use-overlay-lifecycle.ts` binds that owner to a mounted React scope. Select,
DropdownWrapper, DropdownMenuSub, Tooltip and `usePanelAnimation` share it;
DropdownMenu and dialog focus use its focus lease and restoration policy.
`copy-feedback-lifecycle.ts` owns clipboard feedback attempts independently.
The existing public component/hook interfaces remain intact. No mobile, backend,
wire contract, database or dependency changes belong to this packet.

## Overlay transitions

| Event | Transition / effect |
| --- | --- |
| Open from Closed | Claim an opening before scheduling effects. Delay produces Waiting; admission then mounts Opening. |
| Entry frame(s) settle | Only the current opening enters Open. Dropdowns retain their two-frame prewarm; panels/tooltips use one frame. |
| Open before app readiness | Dropdowns enter their visible state immediately and schedule no prewarm frames. |
| Close during Waiting | Retire the show timer and remain unmounted. |
| Close a dropdown/Select/submenu | Retire its callbacks and remove its controls immediately from the DOM and accessibility tree. |
| Close a panel or tooltip | Publish Closing, retaining the DOM for the existing 150 ms panel / 100 ms tooltip exit; then unmount. |
| Reopen during Closing | Retire the old exit and enter Open immediately, reversing the existing CSS transition without remounting. |
| Submenu pointer exit | Delay close for the existing 150 ms handoff. Re-entry retires that deadline. |
| Disable, external target replacement or unmount | Permanently retire that owner and its scheduled callbacks. A new scope starts fresh. |

Cancellation includes a generation check: a frame/timer already dequeued before
native cancellation cannot mutate a later opening. Individually cancelled frames
also retain their cancellation receipt. Opening does not wait for an older close
to finish. Styling, placement, animation classes and existing CSS timing stay in
their components; this module does not introduce a new animation library.

Tooltip pointer, keyboard focus and interactive-card engagement are independent
claims. Leaving one source does not close a hint still owned by another. Explicit
click/Escape dismissal and configured auto-hide release the claims. Returning to
an interactive card reverses a pending fade. Replacing an external trigger also
retires its listeners, including an already captured native callback.

## Focus ownership

Each menu/dialog opening acquires a focus lease. A later acquisition retires its
predecessor's pending entry and return-focus frames. Closing permits one deferred
return after its DOM is removed; that callback releases its own lease afterward.
Strict Mode setup replay cannot leave an older focus operation active.

Return focus requires a connected, enabled, non-inert target, and an unclaimed
focus position (body, the old surface, or that target itself). A newly focused
editor, nested dialog or other control retains focus. Select's Escape/selection
return and Tab movement belong to its opening, so reopening or unmount cancels
them. DropdownMenu defers Tab movement through the same closing focus lease.
Normal arrow navigation, selection, focus containment and dismissal opt-outs
remain component-specific keyboard behavior.

Select emits balanced `onOpenChange` receipts when disabled mid-interaction or
unmounted. A disabled control has no live portaled options, and reenabling it
does not restore the previous opening.

## Clipboard feedback

| Event | Transition / effect |
| --- | --- |
| Mount | Start Idle without accessing the clipboard. |
| Copy nonempty text | Claim the newest attempt and retire the previous feedback deadline. Invoke native `writeText` immediately in the gesture. |
| Current native success | Publish Copied, call the latest committed success callback and start one feedback deadline. |
| Current native failure / unavailable API | Publish Error, call the latest error callback and start one feedback deadline. Explicit retry remains available. |
| Superseded result | Return that native operation's actual boolean outcome without publishing status or callbacks. |
| Feedback deadline | Return only its current attempt to Idle. |
| Reset | Retire pending feedback/results and return Idle. |
| Unmount | Retire the owner and its timer; saved copy functions reject new work with `false`. |

The default deadline remains 1500 ms; callers retain their existing duration
option. A callback error is logged as feedback failure and does not change the
native copy outcome or invoke the opposite callback. Reentrant reset/copy from a
callback cannot leave an older deadline attached to the new attempt.

Native writes are neither delayed nor serialized: doing so would leave the user
gesture that grants clipboard access. Superseding/resetting feedback cannot undo
an already issued operating-system clipboard write. The owner controls UI
feedback, not the ordering guarantees of the native clipboard implementation.

## Verification

Public hook/component tests exercise late native results, callbacks already
queued before cancellation, rapid close/reopen, startup readiness, focus handoff,
keyboard/pointer overlap, external trigger replacement, Strict Mode replay,
unmount cleanup and clipboard error/retry paths. The frame fixture models native
delivery/cancellation; existing keyboard and portaled-menu tests remain in place.
No real clipboard write, user profile or native app process is used by tests.
