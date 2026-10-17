# Bridge operations

For the daily encrypted, incremental backup implementation and scheduler setup,
see [AUTOMATIC-BACKUP.md](AUTOMATIC-BACKUP.md). Its v2 snapshots include actual DO
SQL data and support independent local recovery. The manual v1 commands below
remain compatible and capture DO bookmarks rather than a standalone SQL copy.

Run commands from `apps/bridge`. These procedures preserve client databases,
account keys, permanent tombstones and stream cursors. Payment collection is not
connected. Manual, finite entitlements remain the source of upload permission.

## Environments and access

| Environment | Worker | Wrangler profile | Auth D1 | Private R2 |
| --- | --- | --- | --- | --- |
| Production | `mains-bridge-production` | `mains-production` | `mains-bridge-production-auth` | `mains-bridge-production-blobs`, `mains-bridge-production-archive` |
| Staging | `mains-bridge-staging` | `default` | `mains-bridge-staging-auth` | `mains-bridge-staging-blobs`, `mains-bridge-staging-archive` |

The configurations pin different Cloudflare accounts and resource IDs. `npm run
ops` requires an explicit environment, validates isolation offline, and supplies
the profile on each Wrangler invocation. It never changes the saved default
profile. Never deploy a reset/maintenance overlay as the normal entry point.

## Error tracking

Both deployed configurations enable Workers Logs with query-string redaction,
invocation logs off, traces off and raw exception Issues off. Application events
contain only `bridge.failure`, an operation, status, environment and deployment
version. They never include exception text, SQL, account/device IDs, email,
headers, OAuth codes, recovery codes, capability URLs or ciphertext payloads.
Better Auth's logger uses the same restricted sink. HTTP 5xx, failed WebSocket
requests and maintenance failures are covered; unexpected identity/auth failures
that preserve the existing HTTP 400 contract are warning events.

In Cloudflare → Workers & Pages → the selected Worker → Observability, filter
application logs for `bridge.failure`, then group by `operation` and `version`.
Use HTTP request/error metrics for the actual failure rate: application events
are capped at 20 per isolate per minute to bound an outage's log volume. This is
not a global rate limit and not an exact error counter. Ordinary successful
traffic and quota reads add no application log events or logging SQL writes.

The `/health` endpoint checks the Worker handler/protocol only; it does not prove
D1, R2, OAuth or replication works. Diagnose an incident with a disposable account
or existing approved test profiles, checking pending writes and an already
uploaded attachment. Do not poll quotas, list every object, or repeatedly scan
DO tables to monitor availability. Cloudflare's storage metrics remain the
source for provider quotas; users' logical storage counters remain incremental.

No email/Slack alert destination or external error service is configured. Before
opening paid public signup, choose an incident recipient and notification route.
Suggested initial conditions: unexpected exceptions, repeated `maintenance`
failures, or HTTP 5xx over 1% for five minutes with enough traffic to avoid
single-request noise. A synthetic check should use `/health` at a modest cadence,
with a separate occasional authenticated end-to-end test, never a full sync scan.

## What is backed up

1. D1 SQL export, plus its Time Travel metadata. D1 contains user/login records,
   hashed backend credentials, encrypted key wraps and subscription entitlements.
2. Each initialized account DO's current PITR bookmark, object ID and timestamp.
   `BridgeOperations` is a private service-binding entry point, not a public
   HTTP route. Account enumeration uses primary-key pagination, 100 at a time;
   checkpoints do not scan log records or call the quota endpoint.
3. Actual encrypted bytes and metadata from live R2 and the deletion archive.
   Listing uses bounded pages and conditional ETags; an object changing or
   disappearing during capture fails the backup rather than claiming completion.
4. Deployment/version metadata, a file inventory, lengths and SHA-256 checksums.

The account encryption key is **not** in the hub backup. Retain approved device
keys or the user's recovery code separately. Cloudflare credentials and Worker
secrets are also not exported. Preserve access to those secrets independently.

Cloudflare DO SQLite PITR covers the last **30 days** and includes SQL and KV.
D1 Time Travel retention depends on the account plan: currently 7 days on Free,
30 days on Paid. Check the actual plan/Time Travel window before choosing a point.
A saved bookmark does not extend platform retention and is not an independent
SQLite export. The manual v1 commands in this section do not provide an
off-platform restore of a DO; use the automatic v2 capture for actual SQL copies.

DO bookmarks, D1 export and R2 inventory are captured sequentially, not as a
distributed transaction. Each checkpoint records its own time. An incident that
requires a single coordinated recovery point needs clients paused and a controlled
maintenance window; ordinary online backups do not claim cross-store atomicity.

## Capture and verify a backup

Create the parent directory privately once. The output directory itself must
not exist; the tool refuses to overwrite a backup or profile.

```sh
mkdir -m 700 -p .wrangler/operations
npm run ops -- backup --environment staging --output .wrangler/operations/staging-before-release
npm run ops -- verify --environment staging --backup .wrangler/operations/staging-before-release
npm run ops -- backup --environment production --output .wrangler/operations/production-before-release
npm run ops -- verify --environment production --backup .wrangler/operations/production-before-release
```

Use fresh timestamped directory names for subsequent captures. A directory without
a verified `manifest.json` is incomplete. Keep it private for investigation and
retry into a new directory. Never restore from it. The first rollout of these
operations features may use `backup ... --bootstrap` before the private entry point
and archive buckets exist; that captures D1, live R2 and version metadata only.
Its manifest explicitly says `bootstrap`. Follow deployment with a full backup.

Directories are mode 0700; exports, receipts and ciphertext files are mode 0600.
The SQL export contains authentication material: filesystem permissions are not
backup encryption. Move a verified copy to a separately secured backup location;
do not commit, attach, email or paste the export/manifest into support chat.
Protect the backup encryption key separately if adding an off-device copy.
Checksums detect accidental corruption; they are not signatures against someone
who can replace the manifest too.

Back up before every migration/release and after entitlement administration.
For regular operation, use the daily job and separate freshness workflow in
[AUTOMATIC-BACKUP.md](AUTOMATIC-BACKUP.md), including its activation checklist and
periodic local restore drill. Manual v1 commands alone are not a scheduled backup
service; an unpublished/unconfigured workflow is not active backup coverage.

## Deletion archive

Normal GC still waits for the last reference, its 24-hour grace and outstanding
read capabilities. Before physical deletion, it copies each immutable ciphertext
chunk into the separate private `BLOB_ARCHIVE` bucket under
`deleted/YYYY-MM-DD/<opaque-live-key>/<etag>`. Source key/ETag metadata permit
recovery without filenames or plaintext hashes. One bounded chunk is buffered
before copying so a cross-bucket stream cannot deadlock the DO concurrency gate.
An archive failure leaves the original and its quota receipt intact. Retries
reuse an existing matching copy; quota falls only after live deletion succeeds.
Referenced/live files are not archived or deleted. Archive bytes are outside the
user's active quota, but still consume the operator's R2 storage.

Apply a **35-day expiration** only to the archive's `deleted/` prefix, leaving at
least the 30-day DO recovery window plus margin. Do not attach expiration or a
bucket lock to `BLOBS`; that would break normal file retention or quota reclamation.
For a newly created archive bucket:

```sh
npx wrangler r2 bucket lifecycle add mains-bridge-staging-archive deleted-ciphertext-35d deleted/ --expire-days 35 --config wrangler.staging.jsonc --profile default
npx wrangler r2 bucket lifecycle add mains-bridge-production-archive deleted-ciphertext-35d deleted/ --expire-days 35 --config wrangler.production.jsonc --profile mains-production
```

Inspect existing rules before changing them. This is disaster-recovery retention,
not an application undelete interface. Files physically deleted before this
feature was deployed have no retroactive archive. Future full-account deletion
must account for live objects, archives, local backups and their disclosed
retention; disconnecting a device does not delete an account's cloud history.

## Local restore drill

```sh
npm run ops -- restore-local --environment staging --backup .wrangler/operations/staging-before-release --output .wrangler/operations/staging-restore-drill
```

The command verifies every checksum and resource identity first, creates an empty
directory, imports SQL into a disposable **local** D1 database, copies ciphertext
into local R2 buckets and checks every restored object's bytes. It records auth
row counts in `restore-verification.json`. The generated config has no account
ID, remote bindings or service bindings; the JS proxy explicitly disables remote
access. Existing data and backup files are never overwritten.

This validates D1 import and R2 backup/restore, not user-key recovery or DO PITR.
Cloudflare does not support SQLite DO PITR in local development. The live
non-destructive check records actual bookmarks; no live data restore is performed.

## Code rollback — preferred first action

Take a fresh backup of the failing deployment before rollback so investigation
and subsequent undo remain possible. Use the previously captured known-good
backup to generate a **plan**, which itself deploys/restores nothing:

```sh
npm run ops -- rollback-plan --environment production --backup .wrangler/operations/production-before-release
```

Review `rollback-plan.json`, confirm the version and migration compatibility,
then execute its Wrangler arguments, equivalent to:

```sh
npx wrangler rollback KNOWN_GOOD_VERSION_UUID --config wrangler.production.jsonc --profile mains-production --message "Bridge incident: restore known-good code"
```

Use staging's config and `--profile default` for staging. The plan refuses a
cross-environment backup or a mixed/gradual deployment. The current DO namespace,
class name, D1 IDs and live bucket names must remain unchanged. Code rollback does
not rewind D1, DO or R2, so cursors, tombstones and local pending edits survive.
Cloudflare may refuse rollback across a DO class lifecycle migration or when an
old binding's resource was removed. A version using a newer schema must be read
compatible before rollback; do not roll back schema blindly. If rolling back to
code from before archival was introduced, archive protection stops with that
code: choose a compatible forward fix or control physical GC during the incident.

Migration 0006 adds nullable pending-credential fields. Apply it before deploying
the token-handover Worker; it preserves current token hashes and account keys.
Once handovers have been issued, roll back only to code that understands these
fields. Older code rejects a delivered successor before its first use and can
make a client erase its trusted identity. Do not clear pending fields to work
around an incident: the successor may already be durable on an offline client.
The client creates a random successor and durably saves it in its encrypted
identity before proposing only its SHA-256 hash. Repeating that hash returns the
same expiry; a competing hash returns 409 without replacing the proposal. The
response echoes the hash, never the token. Token renewal does not use
`BETTER_AUTH_SECRET`, including while a handover is pending. First authenticated
use still commits the successor and best-effort invalidates the predecessor.
A saved successor can acknowledge itself after the predecessor's natural expiry.

Both `npm run staging:deploy` and `npm run production:deploy` now run
`wrangler d1 migrations list AUTH_DB --remote` with the matching configuration
and authentication profile **before** deploying. Pending migrations, a failed
check or unrecognized output stops deployment. The gate never applies migrations
automatically; take a backup, review and use the matching `*:migrate` command
before retrying. Offline `*:build` dry runs remain available without cloud access.

Roll out migration 0006, then the hub, then the matching desktop/server builds.
New clients refuse to propose a token to a hub without `client-hash-v1` support.
Old clients can keep using unexpired current credentials but need the new build
before renewal. A rollback must support the client-generated-hash protocol as
well as the pending columns; server-generated-token code is not a compatible
rollback once handovers begin. Never fix a conflict by clearing pending fields:
the legitimate offline client may already have saved that successor. Investigate
the conflict and explicitly revoke/re-enroll a compromised device if needed.

After rollback check `/health`, sign-in, an approved device's connection and
pending queue, plus a known existing file from a second isolated profile. Capture
the rollback version and times in the incident record. Do not revoke/reinitialize
users or reset cloud data as a routine code rollback.

## Data restore — controlled incident procedure

There is deliberately no public data-restore route or one-command live restore.
Use code rollback for application regressions. A genuine data incident requires:

1. Stop affected clients and record their hub/cursor state. Preserve each device's
   SQLite database, outbox, unsent files and protected identity using host backup
   procedures; never copy an actively written DB without its SQLite backup API.
   Keep the preserved originals untouched during recovery.
2. Put the affected hub in controlled maintenance so new writes, capabilities,
   GC alarms and operators cannot race recovery. Prepare a reviewed temporary
   operator entry/Cloudflare-assisted procedure with the **same DO class and
   namespace**. The normal operations entry point is read-only.
3. Capture the current D1 export/bookmark, DO bookmarks and R2 backup, including
   the failing state. Select a point within both relevant retention windows.
   Prefer restoring only the damaged layer/account; do not rewind all users for
   one account's problem. Keep pre-restore bookmarks as the undo point.
4. Rehydrate missing ciphertext from verified live/archive backups to its exact
   original live key **before** exposing metadata that refers to it. Validate
   source key, size and hash; refuse overwrites of a different live object. Keep
   archived copies. Never fabricate ciphertext or a new identity for the same key.
5. For a DO restore, use Cloudflare's `getBookmarkForTime` or the recorded bookmark,
   arm `onNextSessionRestoreBookmark` on that object and restart its session with
   `ctx.abort()`. Save the returned pre-restore undo bookmark. A DO restore covers
   SQL and KV for that account, not D1/R2. Restored alarm state also needs review.
6. Restore D1 only if required, using its Time Travel bookmark or a verified SQL
   export into an empty replacement database. For Time Travel, the command is
   `wrangler d1 time-travel restore AUTH_DB --bookmark BOOKMARK` plus the explicit
   environment config/profile. Never import an old SQL export over a populated
   live auth DB. Review/reapply device revocations, session invalidations and
   entitlements: a point-in-time restore can revive old access permissions.
7. **Do not simply resume old sync cursors after DO rewind.** The current protocol
   has no hub-generation/rewind marker. A device whose cursor is ahead of the
   restored stream can miss data or stall. Start fresh, separately preserved,
   re-enrolled profiles pulling from sequence zero, with a retained recovery code
   or approved key source. Reconcile post-point offline edits from the preserved
   replicas deliberately; do not blindly republish old rows or resurrect deleted
   IDs. A seamless in-place DO restore requires a future generation/rebuild
   protocol and dedicated acceptance tests.
8. Validate login, key recovery, tombstones, pending writes, Atlas revision
   pointers, quotas and a known attachment between isolated devices. Reopen
   service only after access reconciliation and sync verification. Keep originals
   and undo bookmarks until the incident is closed.

This procedure documents the safety boundary; it is not a claim of a tested live
PITR drill, a distributed atomic restore or an independent long-term DO backup.
Perform a controlled restore exercise in a disposable Cloudflare environment
before treating full data disaster recovery as a public-service guarantee.

## Payment integration handoff

The existing standard tier has monthly/yearly periods and indexed entitlement
checks. Provider choice, company onboarding, checkout and payment webhooks remain
unconfigured. Add a verified, idempotent payment-event ledger before enabling
automatic grants/renewal; handle duplicate/out-of-order events, cancellation,
refunds and expiry. Keep provider event IDs, not card data. Include reconciliation
from the provider after a D1 restore so an old backup cannot grant refunded or
expired access. Provider setup can proceed once the owner's sole-proprietorship
details and supported country are confirmed.

References: [DO SQLite PITR](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/),
[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/),
[code rollback limits](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/),
[private service RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/),
[R2 lifecycle](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).
