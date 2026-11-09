# Pairing and browser authentication lifecycle

Inventory **50 + 51** shares the portable rules in
`packages/contracts/src/auth-lifecycle.ts`. `createAuthGrants` owns bounded,
expiring grants; `createAuthEpoch` retires a whole preparation generation;
`createAuthFence` retires earlier proofs for a particular device. Backend code
continues to mint cryptographic tokens and keep only hashed lookup keys.
No database migration or new runtime dependency is required.

| Owner | Transition and rule |
| --- | --- |
| Pairing code | Preparing → issued → consumed / expired / retired. Prepare the descriptor before publishing a code, then start its five-minute lifetime. At most 32 outstanding codes; issuing another retires the oldest. Deadline equality is expired. Validate the request body before spending; spend synchronously before any database await. A failed exchange does not restore the code. |
| Device registration | Consumed code → descriptor ready → inserted → published. Check the host generation before inserting and after awaiting insertion. Retirement during insertion revokes only that candidate, then refuses publication. A retry needs a fresh code. |
| Host authority | Desktop exposure rebind, owner-token rotation, host close/start failure and backend unregister clear pending codes and retire preparation. Close fences authority before draining admitted operations. Persisted device tokens survive a host restart; every new handshake verifies the active database record. |
| Device revocation | Active → revoked. Retire earlier verification proofs before the database await; the host also fences pending upgrades before terminating that device's live sockets. Other devices remain authorized. A later handshake must obtain a fresh database proof. |
| Mobile confirmation | Scanning → invalid / detected → pairing → paired / failed. One mounted confirmation owns redemption and persistence. Duplicate activation joins the same promise; a different link, reset or detached screen aborts preparation. Old results cannot write credentials, publish an error or navigate. Clipboard completion cannot overwrite a later selection. |
| Endpoint attempt | Contact endpoints in their displayed order. Connection failure/timeout can try the next; an HTTP rejection or malformed successful reply is final. Parent cancellation prevents fallback even if native fetch finishes late. Accept only complete, nonempty device credentials and a valid descriptor. Remember the reachable endpoint first. |
| Native credential persistence | Queued → writing → committed / restoring. SecureStore writes cannot be canceled. Serialize save, load, restoration and forget; cancellation or a newer save retires the earlier write and restores its previous value before subsequent work. Restore only while storage still contains that candidate. Failed restoration retains its checkpoint and blocks reads until recovery succeeds. Forget removes credentials after earlier work drains. Successful persistence is the commit point; session startup/navigation runs once afterward. |
| Browser login code | Issued → exchanged / expired / retired. Five minutes, one exchange, exact origin match. Wrong-origin attempts leave the code available. At most 32 pending codes. Spend before minting session credentials. |
| Browser session | Exchange → live session + image credential → expired / evicted / cleared. Eight hours from exchange, independent of socket activity; at most 128 live sessions. Both credentials belong to the same session lease but have separate scopes. Deadline, eviction and clear revoke existing leases and image lookup together. Restart/owner rotation clears memory-only state. |
| Browser socket | Handshake proof → connected → closed. Recheck proof after asynchronous admission and before connection setup. Session retirement immediately terminates every attached socket; an expiry timer closes idle sockets. Inbound frames and outbound replies/pushes also check authority, so timer delay cannot extend access. Closed hosts cannot mint new browser logins. |

`apps/mobile/src/features/pairing/pairing-flow.ts` owns screen transitions;
`backend/pair-device.ts` owns HTTP attempts;
`backend/credential-persistence.ts` owns the native commit boundary. The route
composes those owners. Native networking and storage remain adapters.

`packages/backend/src/modules/backend/backend.service.ts` owns pairing and
device records; `ipc-kit/web-session.ts` owns browser grants;
`ipc-kit/ws-server-host.ts` binds their proof lifetime to HTTP/WS admission.
Cookie origin, HttpOnly/SameSite/Secure settings and per-host cookie names stay
at the existing HTTP seam. Device channel/event allowlists and command receipts
retain their existing enforcement.

Regression tests use disposable SQLite and loopback HTTP/WS hosts, controlled
network responses and fake native storage. They cover concurrent redemption,
database failure, exact expiry/capacity, retirement before and during insertion,
revocation racing verification, shutdown, live session eviction, scoped image
access, canceled/duplicate mobile confirmation, late clipboard/network/native
writes, rollback failure and confirmed-read ordering. No real keychain or app
profile is accessed.
