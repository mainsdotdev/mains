# Remote access, awake ownership and web login handoff (53 + 55)

`src/shared/remote-access-lifecycle.ts` owns the platform-free transition rules.
The desktop `localBackend` adapter owns native WebSocket hosts, Tailscale Serve,
power events and settings persistence. The web bootstrap owns its transport
and delegates socket generations and RPC delivery to the existing transport.

## Command admission and startup

The command owner moves `running → stopping → stopped`. Remote access, LAN
binding, Tailscale HTTPS, awake preference and token rotation enter one queue.
Mutation and native effects both run inside that queue. Commands retain their
admission order; duplicate successful enables reuse the acquired host. A slow
earlier preference write finishes before a later command writes its snapshot.
Storage writes remain best-effort, as before.

Startup captures a restoration ticket before reading saved settings. Admission
of any explicit command invalidates that ticket immediately. A stale read
cannot overwrite a manual choice or start exposure after shutdown. A valid
restore joins the native queue; its optional Tailscale continuation remains
background work and rechecks the original ticket before admission.

| Event | Transition / effect |
| --- | --- |
| Enable direct access | Acquire one loopback host, or reuse the ready binding. |
| Change LAN binding | Confirm old host closure before opening its replacement. LAN requires direct access. |
| Disable while acquisition is pending | Finish the earlier acquisition, then close/rebind it according to the queued disable. |
| Failed initial acquisition | Restore the prior direct-access choices; permit an explicit retry. |
| Rotate token | Close the old host before acquiring a replacement on the same port. Publish only its confirmed token. |
| Enable Tailscale HTTPS | Own the prospective Serve resource, acquire its target, then start Serve and resolve its status. |
| Disable an exposure path | Preserve the host when the independent direct/Tailscale path still needs it. |
| Native release failure | Retain the exact resource and cleanup claim; a later command can retry. |
| Shutdown admission | Immediately reject new commands and retire pending acquisition continuations. |
| Shutdown drain | Share one cleanup attempt, stop Serve before closing its target, release awake ownership and remove power listeners. |
| Failed shutdown | Keep admission closed. A repeated shutdown retries the retained resources. |

Cleanup claims precede native effects. A failed host close cannot be treated
as a free port; a failed Serve stop cannot release its still-proxied target.
Late acquisitions during shutdown are owned and released before shutdown
completes. A successful native acquisition remains represented if a later
awake request fails; callers can still inspect and disable the acquired host.

## Ready host and browser grants

Requested preferences are distinct from actual host ownership. Binding and
host token are recorded only after native acquisition. Advertised addresses,
the exposed session token and new browser/pairing grants require a ready host
with the current token, no pending/failed host cleanup and a live exposure
path. Tailscale URLs additionally require resolved status and no Serve cleanup.
LAN addresses follow the actual binding. Rotation and shutdown cannot mint a
new grant for an obsolete or retiring host.

The owner token remains outside browser JavaScript. Existing one-use login
codes, cookie exchange, advertised-origin validation and wire DTOs retain
their formats.

## Awake lease

The effective condition is explicit preference **and** a ready exposed host
**and** AC power. An opening, failed or closing host cannot acquire a sleep
blocker from its preference alone. One numeric native lease is reused while
active. Battery, disable, lost-host failure and shutdown release it. A failed
native stop keeps the handle for retry; an externally stopped lease can be
reacquired. Power-event errors are consumed at the Electron boundary. Only one
listener pair is installed, and shutdown removes both even when cleanup fails.

## Browser login and socket handoff

Bootstrap installs the API shim and transport before asynchronous login work,
so early invokes wait in that transport's existing outbox. It takes and scrubs
the fragment login code and old owner-token locations before router startup.

The handoff moves `idle → exchanging → released`, or to permanent `retired`.
One pending exchange is shared. An existing cookie session skips fetch. An
exchange settles on success, HTTP/fetch failure, cancellation or an eight-second
deadline. The deadline owns promise settlement even if fetch ignores abort;
every settled attempt clears its timer and parent abort listener. Late fetch
settlement cannot release a second connection.

A current exchange releases socket connection once on either success or
failure, allowing the normal transport authentication/offline path to handle
the result. Transport replacement or `beforeunload` retires the bootstrap,
aborts login, removes its observers and disposes only its own transport.
Queued invokes then reject. Retirement survives replacement away and back;
an old login receipt cannot reconnect or send the abandoned queue.

## Regression coverage

The public native service is exercised with controlled Electron power events,
host/Tailscale acquisition and cleanup, and settings receipts. Cases cover
competing toggles, late startup reads, late shutdown acquisition, preference
write order, failed start/close/Serve stop, token publication, independent
exposure paths, awake failure/retry and listener disposal.

The web tests use the real API shim, transport registry and WebSocket transport
with controlled fetch/socket boundaries and fake time. They cover early RPC
delivery after cookie exchange, failed/timed-out login, late fetch success,
permanent transport retirement, unload cancellation, existing sessions and the
Electron preload path. They open no real server, account login or installed
application. This packet changes no mobile code or wire contracts.
