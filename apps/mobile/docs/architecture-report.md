# Mains mobile architecture report

Reviewed on 2026-08-23 against:

- T3 Code `main` at `09df91f729c1c61e637e7dd0ef22827cfc8a6cb1`
- Mains at local commit `42e7618e4ebe1a8f9cf43aff9884324d1ae0c4af`

## Recommendation

Build a native mobile control surface, not a port of the Electron renderer. Share a
versioned network contract and domain projections with desktop; keep navigation,
composition, lists, camera, notifications, and secure persistence native to Expo.

The first useful release should do four things well: pair with one Mac, show live
runs, let the user answer an approval, and send/continue a turn. File editing,
terminal emulation, full diff review, provider settings, and desktop administration
can follow after that vertical slice is reliable.

## What T3 Code actually shares

T3 Code does not render one UI unchanged in Electron, web, and mobile. Its mobile
app is a dedicated Expo/React Native application. Reuse happens below the view
layer:

- shared schema/contracts packages define typed HTTP and WebSocket RPC;
- a shared client runtime owns environment discovery, session setup, snapshots,
  commands, subscriptions, reconnect behavior, and state projections;
- mobile supplies platform adapters for network state, app state, secure storage,
  SQLite, background activity, and native presentation;
- mobile screens and navigation are purpose-built for small screens.

Its connection model is an environment catalog rather than a single socket. A
connection supervisor progresses through preparing, opening, and synchronizing,
reacts to network/app-state wakeups, retries with backoff, and loads a durable
snapshot before following streams. Credentials are separated from display
metadata and stored through secure platform storage. It also has an offline
outbox for user actions.

T3 Code uses Expo Dev Client because it includes substantial native code: custom
composer controls, native markdown, diff rendering, terminal rendering, widgets,
share extensions, and platform plugins. These are later-stage optimizations, not
a sensible Mains MVP baseline.

On releases, T3 Code uses development/preview/production variants, CNG, EAS
profiles and update channels. Its default OTA runtime policy is `fingerprint`, so
an update cannot reach a binary whose native dependencies or config plugins are
incompatible. That is the important pattern to copy.

## What Mains already has

Mains is much closer to mobile-ready than a normal Electron app:

- Electron handlers are registered in a transport-independent handler registry.
- The WebSocket host mirrors IPC with `invoke`, `response`, and `event` frames.
- `ServiceResponse` crosses the socket unchanged.
- A central event bus fans main-process events to Electron or WebSocket sinks.
- The local backend can bind to loopback/LAN and can expose `wss://` through
  Tailscale HTTPS.
- The WebSocket handshake accepts `mains.v1` plus a pairing token subprotocol.
- Durable run state already lives in SQLite, so a reconnect can refetch history;
  the mobile client does not need to reconstruct a run from missed transient
  frames.

This means the backend transport does not need to be redesigned. The missing work
is a safe, versioned mobile contract and a resilient mobile client around it.

## Gaps to close in Mains

### P0 — versioned mobile contract

The socket currently routes generic `domain:action` channel strings. A client in a
separate repository has no compile-time source for channel arguments, responses,
events, or compatibility.

Add a network-safe contract package with no Electron, Node, Drizzle, or renderer
dependencies. It should contain:

- protocol version and a `server:probe`/`server:getCapabilities` call;
- mobile-approved channel names;
- argument, response, and event types;
- serialization rules for `Date` and `undefined`;
- a compatibility range so old app-store clients fail clearly rather than calling
  a changed handler.

The clean long-term distribution is a small private package such as
`@mains/contracts`. Until publishing is justified, generate a checked artifact in
this repository and verify drift in CI. Do not maintain two handwritten copies.

### P0 — real device pairing and authorization

The desktop currently exposes a browser URL containing a bearer token, but it does
not present a versioned mobile QR payload or manage paired devices. The token grants
broad access to the registered handler surface and lives for the backend session.

Add a desktop pairing panel that emits a payload similar to:

```text
mains://pair?v=1&endpoint=wss%3A%2F%2Fhost&code=<short-lived-one-time-code>
```

Exchange that code for a device credential. Store only the credential in Expo
SecureStore. Desktop should support expiry, rotation, revocation, a visible device
list, and least-privilege scopes. Never put a long-lived full-control token in
logs, Redux, SQLite, crash reports, analytics, or route state.

Development and preview may connect over LAN `ws://`; store production should
require `wss://`. Tailscale HTTPS is the quickest production-grade path before a
hosted relay exists.

### P0 — connection lifecycle

The mobile transport needs an explicit state machine: unavailable, connecting,
synchronizing, connected, reconnecting, and offline. It must react to
`@react-native-community/netinfo`/Expo network state and React Native `AppState`,
use bounded exponential backoff with jitter, reject timed-out invokes, and refetch
the active snapshots after reconnect.

The current server broadcasts events. That is acceptable for a one-user MVP, but
run and terminal streams should eventually be subscription-scoped by `clientId`.

### P1 — mobile view-model endpoints

Existing handlers can bootstrap development, but the phone should not mirror every
desktop query. Add coarse, paginated projections for:

- active/recent runs and unread/attention state;
- run detail with incremental turns/events;
- pending approval and pending user input;
- continue/cancel/archive actions;
- lightweight workspace/project labels.

Prefer snapshot-plus-stream semantics. Avoid many small invokes that are cheap over
Electron IPC but expensive and battery-hungry over a mobile network.

### P1 — notifications and background behavior

WebSocket presence is not a push-notification system: iOS suspends background apps.
Approval and completion notifications require APNs/FCM device registration and a
trusted delivery service, or a Mains-hosted relay. A notification should deep-link
to a run but should not carry credentials or sensitive prompt/output text by
default.

### P2 — offline and native-heavy features

After the core flow works, add SQLite-backed snapshots and a small idempotent
outbox for messages/approval responses. Terminal, high-performance markdown, and
large diff rendering should be measured first; introduce native Expo modules only
when normal React Native rendering misses an observed performance target.

## Proposed mobile shape

Use Expo SDK 57, Expo Router, TypeScript, Continuous Native Generation, and a
custom development client. Keep native configuration in `app.config.ts` and config
plugins; do not commit generated `ios/` or `android/` projects.

Suggested layers:

```text
src/
  app/             routes and screen composition
  features/        pairing, runs, approvals, settings
  contracts/       generated/imported Mains wire contract
  transport/       socket, invoke correlation, subscriptions, reconnect
  store/           Redux Toolkit UI state and RTK Query server cache
  persistence/     SecureStore credentials and SQLite cache/outbox
  theme/           tokens and reusable primitives
```

Redux Toolkit and RTK Query are a good fit because Mains already uses them. Keep
the WebSocket lifecycle outside React components and let events invalidate or
patch RTK Query data. Never place a live socket or credential in Redux.

## Delivery slices

1. **Foundation — started here.** SDK 57 project, Dev Client, app variants, CNG,
   EAS profiles, dark shell, permission-safe QR camera, SecureStore/SQLite
   dependencies, lint/typecheck/Doctor checks.
2. **Pair and probe.** Add the desktop QR/device exchange and versioned probe;
   implement secure persistence and reconnect on mobile.
3. **Observe a run.** Recent runs, run detail, persisted transcript snapshot, and
   live status/event updates.
4. **Act on a run.** Approval/user-input response, continue/cancel, optimistic UI,
   idempotency keys, and reconnect recovery.
5. **Preview release.** Internal iOS/Android builds, crash reporting/privacy
   review, deep links, physical-device LAN/Tailscale tests.
6. **Store release.** Production `wss://` only, device revocation, store metadata,
   TestFlight/Play internal track, staged rollout.
7. **Later.** Push relay, offline outbox, widgets, share extension, terminal, full
   diff review.

Each slice should be tested on a physical iPhone and Android device. Simulators do
not reproduce camera, local-network permission, background suspension, push, or
keychain/keystore behavior faithfully.

## Release flow

The repository defines side-by-side development, preview, and production apps.
Development is a Dev Client; preview is an installable internal build; production
is store-signed. EAS owns remote build numbers and production auto-increments them.
`npm run release` can build and upload both platforms after credentials are set,
but App Store/Play metadata, TestFlight/internal testing, and review remain explicit
release gates.

Use EAS Update only for JavaScript/assets compatible with an installed binary.
The fingerprint runtime policy protects this boundary. Any native dependency,
permission, entitlement, config plugin, or native configuration change requires a
new binary build.

Cloud project linking and the first EAS build are intentionally not performed
yet. They require an authenticated Expo account and should happen only when the
local foundation and application identifiers are accepted.

## Decisions to keep

- Separate `mobile` repository; share contracts, not desktop UI.
- Production endpoint must be `wss://`.
- Credentials only in SecureStore.
- CNG and config plugins instead of committed native projects.
- Dev/preview/production apps install side-by-side.
- Fingerprint-based OTA compatibility.
- First release centers on observe + approve + continue, not terminal parity.
