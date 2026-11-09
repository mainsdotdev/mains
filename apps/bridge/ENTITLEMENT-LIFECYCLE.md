# Bridge subscription and beta entitlement (70)

`src/entitlement-lifecycle.ts` owns grant projection, source selection, cache
receipt lifetimes, enrollment decisions and conditional grant/activation SQL.
`subscriptions.ts` supplies D1 reads. `beta.ts` supplies verified identity and
database effects. Operator adapters preserve their existing CLI/export paths.
Wire DTOs, migrations and mobile code remain unchanged.

## Grant projection

An authoritative grant requires a recognized plan, a supported billing interval
(or beta source), valid integral timestamps and `active` storage status.

| Input / boundary | Projected state | New uploads |
| --- | --- | --- |
| No grant | None | Denied |
| Invalid plan, status or period | Unavailable | Denied |
| Revoked valid grant | Revoked | Denied |
| Before start | Scheduled | Denied |
| At start through just before expiry | Active | Allowed |
| At expiry or later | Expired | Denied |
| Explicit development flag in local/legacy development environment | Development | Allowed |
| Development flag in staging/production | Ordinary grant rules | Never bypassed |

One captured time evaluates both sources. Active paid access takes precedence
over beta; otherwise active beta supplies rights. Revoking one source does not
revoke the independent active source. With no active source, the existing beta
then paid display precedence is preserved. Exact start/expiry and beta-to-paid
handoff are re-evaluated from cached rows, without waiting for another D1 read.

## Cache and operation boundaries

The account-keyed cache holds up to 256 entries with a sixty-second lifetime
measured from lookup admission. Concurrent callers share one query. Negative
results are cached too. Successful reads must still own their exact cache entry
and be within its lifetime before publication. Explicit invalidation or elapsed
lifetime retires an unresolved receipt; its callers join a current replacement.
An obsolete failure cannot delete a newer entry. A current D1 failure removes
its entry and fails closed, allowing a later retry.

Current readers retain a separate transient owner until their last waiter
settles. Evicting an entry from the bounded cache does not replay its pending
query, and invalidation still reaches that account's unresolved read after
eviction. Completed reads retain only the bounded cache entry.

Direct operator D1 changes still become visible within the existing sixty-second
cache bound. A trusted `subscriptionChanged` notification retires the cached
entry immediately after a committed change. Beta activation uses that path.
There is no public entitlement mutation endpoint or payment integration.

Quota lookup can await policy I/O after reading subscription state. It reacquires
the subscription afterwards and retries policy selection if the plan changed.
Expiry or notified revocation during policy I/O therefore cannot return the
earlier upload permission. Current usage remains live under the existing account
gate. R2 admission/commit and existing sockets retain their permission checks.

## Beta and operator mutations

| Action | Guard / result |
| --- | --- |
| Invite | Create an unstarted invitation, or reopen a revoked unactivated invitation. Never reset an activated period. |
| Activate | Require the verified exact mailbox. One conditional D1 UPDATE binds the unclaimed invitation/account and starts exactly thirty days. |
| Repeat activation | Return the same active stored grant, including unchanged timestamps. Expired time is never renewed by a retry. |
| Revoke beta | Change stored status only; preserve account binding and period. Repeated revoke is a no-op. |
| Extend beta | Require an activated grant and a strictly later future expiry. Preserve its start and permit restoration of revoked access through that extension. |
| Grant paid period | Replace the explicit monthly/yearly calendar period. Identical retries do not extend or rewrite it. |
| Revoke paid period | Change stored status only; preserve its period and avoid repeated writes. |

The statements keep their guards inside SQL. Separating a read from an
unconditional write would permit concurrent activations or retries to restart
the period. Email normalization preserves plus aliases and dots. Verified
identity, membership, backend approval and encryption recovery remain separate
from upload entitlement. An invitation follows the existing activation/enrollment
path; known historical grants and initialized accounts retain the existing
recovery path.

## Local data and validation

Inactive access pauses new encrypted upserts and uploads, while reads, lazy file
downloads and permanent tombstones continue. Entitlement transitions remove no
local rows, encryption keys or outbox entries. Renewal resumes the same queue;
the inactive client checks at the existing bounded interval instead of repeatedly
attempting uploads.

Controlled D1 boundary tests cover pending-read invalidation, elapsed lookup
lifetime, replacement sharing, obsolete failure, account isolation, missing and
invalid grants, exact boundaries, independent sources and development gating.
Real workerd/Durable Object probes advance or revoke access while quota policy
lookup is unresolved. Existing authenticated Worker tests verify activation
concurrency, verified mailboxes, operator retries, old sockets/PUT capabilities,
read/delete access and lookup failure. Backend WebSocket/E2EE scenarios cover
durable queue preservation and renewal for all inactive states.

Tests use temporary local stores and loopback services. No production database,
account grant, operator notification, deployment or mobile test is involved.
