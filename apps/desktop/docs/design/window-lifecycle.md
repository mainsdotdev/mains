# Window recovery, request delivery and onboarding handoff (84 + 85 + 96)

`src/shared/window-lifecycle.ts` owns the platform-free transition rules.
Electron adapters own dialogs, window geometry and IPC; renderer hooks own
navigation and settings effects. Each window/collector/onboarding attempt has
its own lifetime. No mobile, wire-contract, database or dependency changes are
introduced.

## Renderer recovery

The crash guard retains timestamps in a sixty-second window and reloads
automatically until the third crash. Crash-loop dialogs retain the same guard
until an accepted Reload resets it. A custom guard can use another limit.

| Event | Transition / effect |
| --- | --- |
| Crash below the limit | Retire any hang prompt and reload. |
| Crash at the limit | Own one crash-loop prompt; repeated crash events do not open more dialogs. |
| Unresponsive | Own one hang prompt while no other prompt is pending. |
| Responsive | Retire and abort the hang prompt. Its late response cannot kill the recovered renderer. |
| Accepted hang Reload | Claim the intentional restart before forcing a renderer crash, then reload once. The matching killed event does not count as a second crash. |
| Accepted crash-loop Reload / Quit | Reset the guard and reload, or close recovery admission and quit. |
| Native dialog failure | Release only that prompt; a later event may retry. |
| Window close / app before-quit / explicit release | Permanently retire callbacks, abort prompts and remove recovery listeners. |

Recovery attaches once per window. A prompt response requires its exact live
ticket; an older dialog cannot affect a replacement prompt, recovered renderer
or closed window. Dialog rejections, including synchronous native throws, are
consumed at the adapter boundary.

## Window requests

Main snapshots and parks an intent **before** opening or pinging the window,
because those effects may synchronously reenter collection. The newest intent
replaces an uncollected predecessor. Failed/no-window acquisition cancels only
its own ticket, so an older failure cannot erase a newer reentrant request.
A failed renderer ping retains the intent for collection after mount.

Taking a request clears it before returning. An intent is valid through the
exact sixty-second boundary and expires after it. It survives renderer
recreation in main memory, but is not a durable replay log. IPC collection is
local-only and checks that the caller is the current main window; another
local renderer cannot consume its intent.

The renderer subscribes before its catch-up collection, after native window
capability and space readiness are available. One collector serializes reads
and delivery; pings while busy coalesce into one further read. A failed read
can retry on a later ping. Callback changes retain the collector and use its
latest navigation actions. Cleanup retires late receipts and unsubscribes.
An already consumed request is not automatically replayed after collector
disposal; the protocol has no separate delivery acknowledgement.

## Onboarding save and shell handoff

Choices remain local until Finish. Its synchronous admission moves
`idle → saving → presenting → complete`, staying closed until the actual
view-transition callback commits, even after the save promise settles.
Duplicate clicks, stale callbacks and repeated transition callbacks cannot
start another save or commit twice.

Only a successful current save updates the settings projection and starts
native workspace presentation. Only its current handoff may navigate, publish
theme choices and mark onboarding complete. Save/presentation failures return
the live attempt to Idle with choices retained for retry. Unmount, StrictMode
cleanup or a transport swap retires the attempt permanently, including a swap
away and back. A completed backend write remains completed; retirement fences
subsequent UI effects rather than undoing accepted persistence.

## Startup and native presentation

This launch starts with onboarding required until its own renderer announces
rehydrated state. Mounted content takes precedence over late boot hints.
A completed boot hint can request one startup splash. Mounted content alone
does not dismiss it: main first waits for the native window's presentation and
shows it, then finishes the splash handoff. Readiness fallback and close share
the same one-time finish, so late cleanup cannot repeat splash dismissal.

Native presentation moves through New, Entering, Onboarding, Restoring and
Workspace; closing retires queued effects. Geometry operations serialize in
admission order. Temporary bounds never replace the persisted workspace
snapshot. Repeated successful entry retains that snapshot; failed entry
remains retryable. Restore drops the snapshot only after bounds, maximization
and fullscreen succeed. Failures preserve it for retry.

Fullscreen and animated-resize waiters release listeners on success, close or
native failure. The resize fallback also releases its timer. Actual OS bounds,
display fitting, reduced motion and fullscreen effects stay in the Electron
adapter.

## Validation

Public native adapters and renderer hooks are exercised with controlled
Electron/transport receipts, isolated window-state files, real Redux/router
state where relevant, and fake time for request expiry. Tests cover stale
dialogs, crash-loop coalescing, shutdown, failed dialog retry, reentrant window
creation, caller ownership, failed pings, snapshots, receipt disposal,
notification bursts, save/handoff retirement, deferred commits, native
presentation retry and listener cleanup. Existing onboarding/provider-choice,
motion, bounds and startup tests remain in the targeted suite.
