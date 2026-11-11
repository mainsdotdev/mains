# Application updates (83)

`src/shared/update-lifecycle.ts` owns transition/admission rules, native binding
lifetimes and renderer read receipts. The Electron adapter owns feed setup,
native events and scheduling. DTO and renderer API paths re-export the shared
types without changing channels or wire shapes. No mobile code changes.

## Native state and admission

| Input | Allowed state / effect |
| --- | --- |
| Check | From Idle, Not Available or Error, claim Checking before native effects. Reentrant closure retires the effect before invocation. |
| Checking event | Start a native check from those same states. Duplicate Checking does not republish. |
| Available event | Checking → Available. Electron downloads automatically. |
| No-update event | Checking → Not Available. |
| Downloaded event | Checking / Available / Downloading → Downloaded with confirmed version metadata. |
| Error | Move an unfinished attempt to Error. A native busy refusal remains nonterminal. |
| Error after Downloaded | Keep Downloaded and its package metadata, record the error, and release a failed install claim for explicit retry. |
| Delayed events after Downloaded | Preserve the confirmed package. Another check cannot clear or replace it. |
| Install | Require Downloaded and claim installation before native invocation. Duplicate/reentrant calls join the accepted action. |
| Synchronous install failure | Retain the package and error, release the claim and report failure to the caller. |
| Shutdown | Permanently close command/event admission before releasing native listeners and the timer. |

Late Available/Downloaded events cannot reopen a completed no-update or failed
attempt. Native events contain no request identifier: once a new check starts,
an event cannot be attributed to an earlier check with certainty. The owner
prevents overlapping app-issued checks and validates the state graph; it does
not invent per-check native correlation.

`downloading` remains part of the compatible DTO vocabulary. This Electron
adapter uses Available for automatic downloading and does not synthesize
progress events or a separate download command. `downloadUpdate` returns a
snapshot. All returned state and metadata are copied.

## Startup, feed and timer ownership

Automatic updates remain limited to packaged stable macOS builds. Development,
prerelease, Windows and unsupported platforms keep manual installer upgrades.
The existing Electron public update service, repository, architecture-specific
feed and one-hour cadence are preserved. No automatic update is installed by
these tests or builds.

The adapter configures Electron directly so its initial, periodic and explicit
checks all use the same admission rule. `update-electron-app` previously owned
an independent initial check and interval, which could overlap manual checks.
The package/dependency files are unchanged.

Before app readiness, one pending ready callback owns startup. Repeated
initialization/check requests join it. Feed setup precedes native checking.
Failed configuration detaches and retires its binding before an explicit
retry; callbacks already queued from that binding cannot affect its successor.
Failed checks retain the configured feed and may retry explicitly or at the
next hourly tick. Checking, downloading, ready and installing states admit
no additional check.

Update IPC unregistration invokes shutdown through the existing application
cleanup path. Shutdown clears the ready callback and hourly timer and removes
only its own projection listeners. Queued native callbacks remain fenced by
the retired controller. Native work has no cancellation API; one passive error
drain remains until `will-quit` so a late EventEmitter error cannot crash the
closing process. It neither publishes nor retains a retry loop. Other native
listeners are preserved. Shutdown does not permit reinitialization.

## Renderer projection

The hook subscribes to the local shell before its initial read. Every push and
new read retires older read receipts. A delayed initial/check response cannot
overwrite a newer push, including a push emitted synchronously during the
status invocation. Strict Mode cleanup and unmount retire receipts and captured
callbacks permanently; a new view owns its own projection.

Rejected status/check/install requests and failed IPC envelopes become current
view errors, without unhandled rejections or stale publication. A ready package
survives such failures. An accepted native install belongs to the application,
independently of the requesting view. Backend selection does not redirect
local update reads, commands or notifications.

## Validation

Tests exercise the public service, its real event bus and IPC teardown with
controlled Electron feed/check/install methods, native EventEmitters and fake
time. They cover duplicate controls, scheduling, platform policy, pre-ready
startup, failed configuration, late bindings, native errors, install retry,
confirmed metadata, reentrant closure and cleanup. Hook tests use the local
preload boundary and real React effects/Strict Mode. Existing menu/status-feed
tests remain in the targeted suite.

Electron's [autoUpdater documentation](https://www.electronjs.org/docs/latest/api/auto-updater)
defines automatic downloading, the requirement to wait for Downloaded before
installation and the duplicate-download behavior of repeated checks. Actual
OS download, signature verification and restart remain native responsibilities;
bundle validation is not an installed-app update acceptance test.
