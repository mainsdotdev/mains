# GitHub device authorization (52)

`src/renderer/features/settings/lib/github-device-flow-lifecycle.ts` owns the
transition rules for one mounted credential pane. `GitHubDeviceFlowPanel`
adapts React, RTK Query and native browser opening. The existing backend
`github-device-flow.ts` retains the HTTP endpoints and response mapping;
no IPC, wire DTO, credential-storage or mobile changes are introduced.

## Ownership and transitions

The pane moves through `idle → starting → waiting ↔ polling → submitting → idle`.
Terminal errors return it to Idle with an error. Retirement is permanent for
that pane. Each admitted start claims a separate attempt before asynchronous
work begins; duplicate starts cannot request additional codes.

| Event | Transition / effect |
| --- | --- |
| Start | Claim one attempt, clear prior error and request a device authorization. |
| Current code receipt | Publish the code, own its deadline and schedule the first poll after the minimum interval. Request browser opening independently. |
| Start failure | Return to Idle with an error; allow an explicit retry. |
| Poll due | Admit one poll for the same device code. Schedule no overlapping poll. |
| Pending response | Wait a full interval after settlement before another poll. |
| `slow_down` response | Increase the interval by at least five seconds and honor a larger server-advised interval. |
| Denied / expired / poll failure | Release timers and code ownership; present a terminal error and allow a new start. |
| Code deadline | Expire at the boundary even while a poll is unresolved. A late token cannot reach credential saving. |
| Success | Claim Submitting, clear polling and expiry timers, then invoke the credential tail once. |
| Credential-tail settlement | Return the surviving pane to Idle. A rejected tail displays its error. The wizard also retains its own error handling. |
| Cancel | Release this attempt and its timers. A new start owns a new identity; old results cannot consume or overwrite it. |
| Pane unmount | Permanently retire its effects and clear timers. A later mount receives a new lifecycle. |
| Transport replacement | Permanently retire and disable the pane, including replacement away and back to the original transport. |
| Wizard scope replacement | Dispose the old lifecycle and reset the displayed state before the replacement can acquire a code. |

The deadline uses the start request's admission time plus the returned
`expiresIn`, conservatively including request latency. Both timer delivery and
poll receipts check it; a suspended timer cannot authorize a late token.
Once a token is admitted to credential saving, the code deadline no longer
applies to that accepted save.

Cancel/unmount fences an already dispatched IPC request; it does not claim to
cancel GitHub's HTTP request or revoke an already accepted credential write.
No new wire cancellation protocol is needed.

## Browser opening

Browser opening is an independent effect of a live code attempt. Synchronous
throws and rejected promises become a pane error while the code and poll loop
remain usable. Open GitHub retries through the same owner. A late failure or
queued open from an obsolete attempt cannot publish into or open for a new
attempt.

## Wizard and credential handoff

The connection wizard supplies its existing live-owner predicate, including
backend/account identity and explicit closure. The pane checks it before
admission and after asynchronous receipts. Wizard closure therefore retires
late authorization even while presentation keeps the old pane mounted.
Changing authentication tabs unmounts the device pane; Strict Mode cleanup
retires the first setup without poisoning its replacement.

A successful device token passes through the existing `submitValues` path:
read the current connection/revision, save credentials with that revision,
discover repositories and move to selection. The wizard separately guards
every continuation. OAuth and manually entered PATs share storage and resource
selection; the lifecycle keeps no token in its view snapshot or timer state.
While this tail is pending, the pane presents Connecting and admits no new
authorization or poll.

## Validation

Public component tests use the actual RTK Query endpoints and transport
registry with controlled IPC receipts, native browser effects and fake time.
They cover duplicate admission, exact expiry with an unresolved poll, slow
authorization response, serial polling, repeated slowdown, cancellation and
replacement, terminal errors/retry, transport replacement, wizard guards,
browser-opening failure and pending/failed credential handoff.

GitHub modal tests use the actual credential pane, wizard steps and repository
discovery endpoints, replacing only modal presentation and minimum animation
delay. They verify revision-checked saving and repository discovery, plus
closure while a token receipt is pending and the old pane stays mounted.
No real GitHub login, browser opening, account/profile or network request is
used by these tests.

Polling and slowdown semantics follow GitHub's official
[device-flow documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow).
