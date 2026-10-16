# Bridge hub

Production/staging error tracking, verified backup commands, local restore drills
and code/data rollback procedures: [Operations runbook](OPERATIONS.md).
Daily encrypted backups, incremental file retention and scheduler activation:
[Automatic backups](AUTOMATIC-BACKUP.md).

B3–B9's Cloudflare Worker, account-scoped SQLite Durable Object, D1 identity store and private R2 bucket. Desktop and
standalone backends seal records before sending them over WebSocket. The hub
stores routing headers and ciphertext; it never receives an account key or a
plaintext record body. Desktop and standalone startup activate background sync
after account sign-in and backend approval, or with explicit development configuration. Without either, local execution and iPad remote control continue unchanged.

## Claude session mirror (B9)

Once Bridge tracking has been enabled, Claude turn cleanup imports the native
SDK session into `provider_session_entries`: exact main/subagent entries and
agent metadata, including signed thinking and tool results. Re-imports deduplicate
UUIDs and preserve repeated UUID-less lines without growing on each turn. The
live query keeps using the native Claude session files; this does not yet enable
continuing a run on another backend.

Entries travel in the owner's lazy run stream under E2EE and the same project
Local only rules. Entries above 256 KiB use the existing encrypted R2 blob/cache
path; the 50 MiB per-entry blob limit applies. Failed import leaves the Claude
turn's outcome unchanged and is retried after the next turn. Refused uploads stay
queued locally.

The hub sees an authenticated `30d-idle` storage policy, never a table name or
session content. Any accepted run activity refreshes retention; compaction and
scheduled alarms expire idle mirror records after 30 days. Visible chat records,
writer bindings and permanent tombstones survive. Locally active owners whose
old mirror may have expired requeue original clocks before backfill. Expired
record ciphertext stops counting toward record quota; unreferenced R2 chunks
enter the blob collection grace period described below.

Upgrade the hub and backends together for B9's new authenticated retention
header. Clients that understand the header but use an older record schema park
schema-3 entries until their record support is upgraded.

`test:replication` includes real SDK import fixtures and a large opaque entry
through workerd/R2 between independent SQLite databases. `test:hosts` includes
two actual server processes: import A's temporary native session, sync to B,
remove the source, then verify exact main/subagent entries across B's restart.
These tests invoke no model and never read the user's Claude profile.

## Large database values

Every synced register now supports automatic encrypted value blobs, independently
of its table's file columns. JSON-encoded strings above 128 KiB, and additional
strings needed to keep the remaining register values below 256 KiB, are published
through the existing immutable R2 chunk/quota pipeline. Captured clock images
supply the bytes, so a local edit during upload cannot acquire an older manifest.

The encrypted record replaces those fields with null and carries `kind: "value"`
manifests using record schema 4. Ordinary records retain schema 3 compatibility;
older backends durably park schema-4 records until upgraded. The hub wire and
storage format stay unchanged, and no plaintext field names or values reach R2.

Receivers authenticate manifests and download/verify/decode their JSON strings
before entering the SQLite apply transaction. Full field values are persisted in
SQLite and capture clocks, surviving cache eviction, restart and the source going
offline. A failed download leaves the page/cursor unapplied. Restored values are
capped at 50 MiB per record; pull pages exceeding a 16 MiB restoration budget are
retried one record at a time. Existing file manifests remain lazy.

`test/value-hosts.test.ts` exercises Read/Read/Grep records through two actual
backend processes, with A offline during B's download and B restarted without
its cache. The regular fixtures are synthetic. For a private acceptance run,
set `MAINS_BRIDGE_REAL_TOOL_RECORDS` to an external, owner-readable JSON array of
the three captured tool rows. Private payloads stay outside the repository and
assertions compare field equality without printing document contents.

## Try the existing UI quickly

Install dependencies in `packages/backend`, `apps/desktop`, `apps/server` and
`apps/bridge` separately. Build the two consumers, then run the disposable demo:

```sh
cd apps/desktop
npm run build:web
cd ../server
npm run build
cd ../bridge
npm run dev:demo
```

This starts the real Worker and two actual Mains server processes, with separate
temporary SQLite databases and generated demo credentials. Open the printed A
and B browser login links. On B, select **Source workspace** under **Computer A**.
Type a line in the demo terminal: it is persisted on A and appears in B's open
transcript. `offline` stops A; B retains downloaded history and shows its last
seen time. `online` restarts A. `quit` closes the processes and removes their
temporary profiles. No agent/provider request is executed by the demo.

For an iPad or another computer on the same trusted Wi-Fi/LAN, start with
`npm run dev:demo -- --lan`. Only B listens on the LAN; A and the hub stay on
loopback. Open the printed **A** link on this Mac and the **B** LAN link on the
iPad. Browser links are single-use and expire after five minutes; type `links`
in the demo terminal to mint fresh ones (including while A is offline).
The Mac must remain awake and B must stay running for the iPad to use it.
If macOS asks, allow Node's incoming local-network connections. No cloud
deployment or provider account is needed for this initial test. `quit` removes
both temporary profiles.

Try writing in the demo terminal, opening the synced image, creating/editing an
Atlas Page from either browser, then `offline` and `online`. On B, open the
conversation before stopping A to download its lazy history; open the image
after stopping A to verify the blob comes from the hub. Atlas is editable on B;
A's run replicas are read-only.

To use Electron as A, type `desktop`. This stops the Node source first and
prints a command to run from `apps/desktop` with `MAINS_DEV_USER_DATA` and
`MAINS_BRIDGE_CONFIG` pointing at A's temporary profile. Run that command, then
open its **Bridge demo** space and **Source workspace**. Close Electron before
`online` or `quit`; one process owns each database. A remaining ownership lock
causes cleanup to preserve the profile. `MAINS_DEV_USER_DATA` affects unpackaged
development only and isolates both Chromium state and SQLite without changing
HOME or the installed app's profile. Forge rebuilds SQLite for Electron; run
`npm rebuild better-sqlite3` in `apps/desktop` before subsequent Node tests.

The browser remains a client of its selected backend: iPad → B → B's SQLite.
It does not open SQLite in Safari. B can show A's downloaded history while A is
offline; the browser still needs B running and reachable. A browser or paired
iPad attached directly to A keeps normal control of A's own conversations.
Bridge replicas on B are read-only; connecting to A through the existing backend
selector restores control there. Replica views never mount a composer,
provider/auth controller, filesystem panel or terminal.

## Run locally

Use the repository's Node version (22.12 or later). Install each package in its
own directory; there is no root install.

```sh
cd packages/backend
npm install
cd ../../apps/bridge
npm install
npm run dev:setup
npm run dev
```

The listener is `ws://127.0.0.1:8790/v1/log`; health is
`http://127.0.0.1:8790/health`. Wrangler persists the account stores under
`.wrangler/state`. `dev:setup` creates an ignored, mode-0600 `.dev.vars` with a
random signing secret and refuses to replace an existing one.

In another terminal, generate a token for each backend in the same demo account:

```sh
cd apps/bridge
npm run dev:token -- --account demo --backend A
npm run dev:token -- --account demo --backend B
```

Clients send the token in `Authorization: Bearer <token>` during the WebSocket
handshake. These development JWTs bind `accountId` and backend id, expire after
24 hours, and are accepted only with `BRIDGE_DEV_AUTH=true` and a configured
signing secret. These are development credentials only; normal sign-in and approval are described below. The dev token and the E2EE account key are separate credentials.

## Sign-in and key management (B7)

Settings › **Bridge** (`/settings?section=bridge`) signs the selected backend into
an account. Desktop opens the system browser and receives a one-use, 60-second
authorization code on an ephemeral loopback listener, bound with state and PKCE
S256. A Node backend uses Better Auth’s device authorization flow: the browser
shows the account login, then explicitly authorizes the displayed sign-in code.
GitHub and verified email magic links use the same Better Auth account. Signing
in does not grant an existing account’s decryption key.

The first backend creates the random 256-bit account key. It uploads an X25519
wrap for its own public key plus an Argon2id recovery wrap. The recovery code
has 160 random bits, is shown once, and is never sent to the hub. Save it before
closing Mains; if the setup code was not saved, an approved backend can generate
a replacement in Settings. Replacing it invalidates the previous recovery code.
The fixed recovery KDF uses 64 MiB, three iterations and one lane.

A later backend remains **pending** with no log or R2 access until either:

- An approved backend compares the six-character public-key code on both screens
  and approves that exact request and public key. Desktop also posts an OS
  notification when a request arrives.
- The new backend decrypts the recovery wrap locally and proves possession of
  the recovered key using a fresh, signed challenge. The proof binds the account,
  backend, public key and exact device wrap; it cannot be replayed or transferred
  to another recipient. Other backends can be offline.

The hub stores verified-account metadata, hashed 90-day backend credentials,
public keys, encrypted key wraps and expiring approval requests. Backends renew
credentials before expiry. Private device keys, account keys and backend tokens
live only in an encrypted `bridge/identity.json` (mode 0600). Electron uses
`safeStorage`; standalone uses its protected `server-secret.key` storage adapter.
The host adapters’ formats are intentionally incompatible and fail closed; use
separate profiles for simultaneous Desktop/Server backends. Public status and
notifications contain no credentials. Recovery values bypass Redux and durable
command receipts.

Revocation closes open Bridge sockets and blocks later frames and existing blob
URLs. It cannot remove plaintext already downloaded by the revoked backend.
Account-key rotation is a later feature. Sign-out revokes this backend before
removing its keys and replicas; it therefore needs the hub reachable (an already
revoked credential can be cleared offline). Own chats and account objects stay
local by default. The Settings confirmation can also remove synced account
objects. Existing paired-phone remote control and backend switching keep their
current permissions; paired phones cannot manage account keys.

With a server already running, use its owner connection instead of opening a
second SQLite owner:

```sh
mains bridge login --hub https://bridge.example.com --data-dir /path/to/profile
mains bridge status --data-dir /path/to/profile
mains bridge approve <backend-id> --code <matching-six-character-code>
mains bridge recover
mains bridge revoke <backend-id>
mains bridge recovery --replace
mains bridge logout
```

`recover` reads the secret from stdin with terminal echo suppressed; do not pass
it as an argument. All commands accept `--data-dir`, `--server-url`, and `--token`
like the existing server admin commands. `login` prints the verification URL and
sign-in code, then the public-key comparison code if approval is still required.
Settings in a browser manages the backend that browser is connected to; Safari
never receives a private account key or stores an independent SQLite database.

### Configure an authentication hub

The development demo remains available without an identity service. For normal
sign-in, create a Cloudflare D1 database and private R2 bucket, put the returned
D1 id into `wrangler.jsonc`, then apply all migrations (including account entitlements):

```sh
npx wrangler d1 create mains-bridge-auth
npx wrangler d1 migrations apply AUTH_DB --local
# Use --remote for the deployed D1 database.
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put RESEND_API_KEY
```

Set `BRIDGE_AUTH_URL` to the HTTPS hub origin and `GITHUB_CLIENT_ID` in Worker
vars (or use `.dev.vars` locally). Configure the GitHub OAuth callback as
`<BRIDGE_AUTH_URL>/api/auth/callback/github`. Set `MAIL_FROM` to a verified sending
address for email links. `BETTER_AUTH_SECRET` must be at least 32 random
characters. The mail implementation uses Resend, or an `AUTH_MAILER` service
binding; local tests replace only delivery and consume real Better Auth links.
Choose the OAuth and mail methods you configure; unavailable buttons are hidden.
Disable `BRIDGE_DEV_AUTH` on a normal hub. No production deployment or provider
credentials are required for the automated tests.

`npm test` includes approval/recovery isolation, challenge replay and tampering,
bootstrap races, revoked initializer re-enrollment, PKCE/state/redirect checks,
callback cancellation, credential renewal and immediate socket/R2 revocation.
`npm run test:hosts` also signs two real backend processes into Better Auth,
checks pending isolation, approves B on A, restarts B with its saved encrypted
identity, revokes B, and joins B by recovery with A offline. These fixtures use
real Worker/D1/DO/R2 runtimes and disposable profiles. No external email is sent.

## Cloudflare staging

`wrangler.staging.jsonc` targets the Mains Cloudflare account and separate
`mains-bridge-staging` resources. It enables the Worker URL and disables preview
URLs and development-token authentication. The local Wrangler config stays
separate. The D1 id/account id in this config are resource identifiers, not keys.

- Worker: `mains-bridge-staging`
- D1 (`AUTH_DB`): `mains-bridge-staging-auth`
- Private R2 (`BLOBS`): `mains-bridge-staging-blobs`
- SQLite Durable Object binding: `ACCOUNT_HUB` / `AccountHub`

For a new Cloudflare account, open **Workers & Pages** in the Dashboard once to
initialize its `workers.dev` subdomain. The deployed address is
`https://mains-bridge-staging.team-68e.workers.dev`, also configured as
`BRIDGE_AUTH_URL`.

Run these commands from `apps/bridge`:

```sh
npm run staging:build       # Local compile/dry run; creates no remote resources
npm run staging:migrate     # Apply pending migrations to staging D1
npm run staging:deploy      # Publish this checkout to the staging Worker
```

R2 must first be enabled for the account in **Storage & databases → R2 →
Overview**. Its activation/checkout is completed by the account owner. Then
create the private bucket once:

```sh
npx wrangler r2 bucket create mains-bridge-staging-blobs --location weur --update-config=false --config wrangler.staging.jsonc
```

`BETTER_AUTH_SECRET` is provisioned in the staging Worker's secrets. Subsequent
deployments preserve it; it is not kept in the repository. Create a staging
GitHub OAuth App with homepage
`https://mains-bridge-staging.team-68e.workers.dev/sign-in`, or reuse an existing
Mains OAuth App. Add callback
`https://mains-bridge-staging.team-68e.workers.dev/api/auth/callback/github`;
when reusing an app, keep its existing callbacks and add this as another entry.
GitHub.com supports multiple callback URLs for OAuth Apps. Set its public
`GITHUB_CLIENT_ID` in the staging config, then enter its secret interactively:

```sh
npx wrangler secret put GITHUB_CLIENT_SECRET --config wrangler.staging.jsonc
npm run staging:deploy
```

Check `/health` and `/sign-in` at the resulting Worker URL. Anonymous calls to
`/v1/log`, `/v1/quota` and `/v1/blobs/presign` must return 401. A usable sign-in
requires a configured provider; the staging infrastructure alone does not
authorize a backend.

Use persistent isolated A/B profiles without a development config. Sign in from
Settings → Bridge with the staging HTTPS origin. A creates the account key and
recovery code; B signs in to the same account and waits for A's approval or
recovery. Test run history, Atlas and files, A offline, revocation and recovery.
An iPad browser still connects to B's running backend, which connects to this
hub. It does not store the account key or an independent SQLite database.

The signed-out Bridge settings page opens device setup in a modal. A previous
hub origin is reused when available. Set `MAINS_BRIDGE_HUB_URL` in
`apps/desktop/.env.local` or the packaging environment to give fresh desktop and
web builds a default origin; the renderer bundles only that public URL. Use the
staging origin for a staging build and the production origin for a production
build. A custom origin remains available under **Advanced** in the modal. If no
default exists, Advanced opens automatically and requires an origin before sign-in.

## Subscriptions (payment integration pending)

The `standard` tier is **Bridge**: 1 GiB per account, 50 MiB per file and 600
writes per backend per minute. Monthly and yearly periods have identical rights;
the plan catalog in `src/plans.ts` is the extension point for later storage tiers.
No prices, checkout, payment provider or automatic renewal are wired yet.

Better Auth's D1 `user.id` is the account ID. Migration `0004` adds
`account_entitlements`, keyed by `(account_id, feature)` with `feature='bridge'`.
It records the plan, billing interval, active/revoked state, period start/end and
update time. This row is authoritative; local SQLite, the billing-cycle selector
and quota overrides cannot grant access. All approved backends of the account
share the entitlement. Another account cannot query or use it.

Only an active, recognized plan in `[starts_at, expires_at)` permits new encrypted
record upserts and R2 uploads. An expired, missing, scheduled or revoked subscription
leaves approved backends **Read only**: existing reads, lazy file downloads and
permanent deletions continue. Login, backend approval and recovery remain available.
Identity keys, local content and pending outbox entries are preserved. Renewal
resumes the same queue without re-enrollment. Existing PUT capabilities and open
WebSockets recheck permission; an idempotent ACK for an already committed object
does not upload new data. A D1/schema failure denies new writes.

Settings › Bridge shows the server-backed period, tier and upload state. Monthly
and Yearly are previews of the two billing options while purchases are unavailable;
choosing one makes no request and grants no access. **Refresh subscription status**
uses the existing owner-only manual sync action. Other remote-control permissions
and local agent execution are independent of a Bridge subscription.

### Grant a period for local testing

Start an authentication-enabled local hub, apply migrations locally and sign in
normally. Obtain the verified account ID from `mains bridge status` or local D1's
`user` table. The operator command defaults to **local D1**:

```sh
npx wrangler d1 migrations apply AUTH_DB --local
npm run subscription -- show --account USER_ID
npm run subscription -- grant --account USER_ID --interval monthly --starts-at 2026-10-16T00:00:00Z
npm run subscription -- grant --account USER_ID --interval yearly --starts-at 2026-11-16T00:00:00Z
npm run subscription -- revoke --account USER_ID
```

Grant replaces the current period; it does not queue a second future period.
Use the intended explicit start time when renewing. The same command is safe to
retry: it does not add another month/year or write an unchanged row. Period ends
use UTC calendar months/years with month-end clamping (January 31 → February's
last day; leap-day yearly periods → February 28). Revoking disables uploads;
it does not delete any account data.

For a separate local config pass `--config PATH`. A deployed database is changed
only with **both** `--remote` and an explicit `--config`; no remote command is part
of the automated tests. There is no public grant/revoke endpoint. GET
`/v1/subscription` accepts an approved backend credential or a verified browser
session, derives the account from authentication, and returns no credentials.

The account DO caches one indexed D1 lookup for 60 seconds and coalesces concurrent
requests. It checks cached period expiry on every use, so the cache never extends
the end of a subscription. Direct operator grants/revocations take up to 60 seconds
to appear at the hub; client refresh does not bypass that server cache. An idle
client updates its displayed status on the next upload attempt or manual refresh;
pending inactive clients check for renewal in the background. A future trusted
billing-event consumer can call the internal `subscriptionChanged(accountId)` RPC
after committing D1 to invalidate it immediately. No payment-event handler is
implemented yet. Inactive clients with pending writes check for renewal at most
once a minute in the background instead of retrying uploads every second.

Migration `0004` grants **nothing automatically**, including for existing staging
users. During rollout, grant the intended period to each test account before
enabling the new write policy. Keep the current identities, encrypted keys and
data; a Bridge reset also preserves the D1 entitlement. Upgrade hub and backends
together: older clients do not understand the new `subscriptionRequired` push
result, fail closed and retain their queue until upgraded. Development bypass
requires `BRIDGE_DEV_AUTH=true` and a local (or untagged legacy development)
environment; it is refused when `BRIDGE_ENV` is staging or production.

Local acceptance covers monthly/yearly rights, account isolation, missing/expired/
revoked/scheduled plans, exact expiry on existing sockets and PUT URLs, D1 failure,
idempotent operator grants, bounded D1 reads, and two real backends resuming queued
Pages/large values/images after expiry and restart. It invokes no payment or
Cloudflare account API and uses disposable workerd/D1/DO/R2 stores.

## Production

The production origin is `https://bridge.mains.dev`.
`wrangler.production.jsonc` pins the domain owner's Cloudflare account, the
`mains-bridge-production` Worker, `mains-bridge-production-auth` D1 database and
private `mains-bridge-production-blobs` R2 bucket. They are in a separate account
from staging; the production Worker owns its own SQLite Durable Object namespace.
`wrangler.production.example.jsonc` remains an intentionally incomplete template
for provisioning a fresh environment.

Use the Cloudflare account that owns the `mains.dev` zone. Keep its login in the
`mains-production` Wrangler profile so the existing default staging login stays
available:

```sh
npx wrangler auth create mains-production
```

Production commands pass `--profile mains-production` explicitly and the config
pins the production account ID. Use command-scoped profiles in this shared
directory so staging commands keep their existing login. Provision a **separate**
D1 database, private R2 bucket and Worker in that account. The distinct Worker
owns its own SQLite Durable Object namespace. Staging data and Mac profiles stay
in their existing environments.

```sh
npm run production:check -- wrangler.production.jsonc
```

This command is entirely offline. It rejects placeholders, development auth,
staging resource reuse, unsafe origins, external DO namespaces and inline secrets.
It does not prove that resources, DNS or deployed secrets exist. The example is
expected to fail the check until configured. A blank GitHub client ID also blocks
the check until a sign-in provider is configured. The following commands all run
the offline check first:

```sh
npm run production:build     # Local dry run, no remote changes
npm run production:migrate   # Apply production D1 migrations
npm run production:deploy    # Publish the production Worker and custom domain
```

Initial resource provisioning can upload the normal Worker with no routes,
`workers_dev=false` and `preview_urls=false` while DNS and OAuth are pending.
That private bootstrap creates its Durable Object namespace without exposing a
sign-in service. A bootstrap config is a local provisioning artifact, kept under
the ignored `.wrangler` directory; public rollout uses the checked production
config above. Bootstrap never uses the staging reset entry.

The first authorized production rollout needs all D1 migrations applied **before**
the new Worker, a configured custom-domain route, a separate GitHub callback at
`<production-origin>/api/auth/callback/github`, and Worker secrets
`BETTER_AUTH_SECRET` and `GITHUB_CLIENT_SECRET` (or mail delivery credentials).
The checked-in GitHub configuration declares both secrets as required for deploy;
their values live only in Cloudflare. Enter a GitHub secret from `apps/bridge`:

```sh
npx wrangler secret put GITHUB_CLIENT_SECRET --config wrangler.production.jsonc --profile mains-production
```

Paste the secret only at the command's hidden input prompt. The production OAuth
App's homepage is `https://bridge.mains.dev/sign-in` and its callback is
`https://bridge.mains.dev/api/auth/callback/github`.

Keep development auth off, preview URLs off and secrets out of config/source.
Plan explicit initial entitlement grants until the future verified payment-event
consumer manages periods. Back up D1 before migrations, deploy compatible clients
and verify login/approval/recovery, paid uploads, expired read access and renewal
against isolated production test accounts. Creating resources, remote migrations,
secret provisioning, deployment and live checks are separate operator actions;
none are performed by local validation or tests.

Desktop/web releases select this environment with
`MAINS_BRIDGE_HUB_URL=https://bridge.mains.dev` at build time. The GitHub release
workflow sets this for both stable and preview desktop and standalone web
packages. Preview is a candidate app release using the same production Bridge
service; staging requires an explicitly selected development/test build origin.
Existing profiles keep their current hub until the user explicitly connects to
a different one;
provisioning production does not migrate the Mac's staging data or switch its
account. Payments and automatic subscription renewal remain unconfigured.

## Lost all account keys

GitHub sign-in cannot recover an account encryption key. Signing out removes
this backend's protected identity; save the recovery code before signing out of
the last approved backend. If every key is lost, preserve local data and obtain
explicit consent before resetting the inaccessible cloud copy.

`src/staging-reset-worker.ts` is an operator-only, temporary staging entry point;
the normal `src/index.ts` does not expose its maintenance route. It requires the
exact staging origin, a single `BRIDGE_RESET_ACCOUNT` and a random secret
`BRIDGE_RESET_TOKEN` of at least 43 characters. An authorized POST to
`/__maintenance/bridge-reset` with `{ accountId, confirm: false }` inspects counts;
`confirm: true` resets only that account and refuses while an approved backend
still exists. It revokes credentials first, deletes the account's R2 prefix,
clears its Durable Object, and removes its Bridge key state last so failures can
be retried. Better Auth users, provider logins, sessions, quota plans and other
accounts remain intact. It never accesses a backend's local database.

Before using this overlay, take and verify a SQLite backup. Deploy it only with
an explicit temporary config, then immediately redeploy `wrangler.staging.jsonc`,
delete the temporary secret and confirm the maintenance route returns 404.
Sign the preserved backend in normally with existing history included; its new
account key causes a fresh backfill. Save the newly generated recovery code.

## Retention, project scope and quotas (B8)

The first-sign-in checkbox takes its history boundary when sign-in starts.
Leaving it unchecked keeps existing chats and Atlas items local; items created
while approval is pending can sync after approval. **Sync existing history**
adds the excluded history later. Manual project exclusions remain in force.

Settings › Bridge lists this backend’s projects. **Local only** stops future
uploads for that project’s workspaces, chats and children, including already
queued changes. Existing copies on other backends remain there. Turning it off
queues private edits and deletions with their original clocks. Scope choices
persist through restarts and account re-entry.

Sign-out preserves own chats and shared account objects by default. Already
opened Atlas/Collection files become ordinary local files before the download
cache and keys are removed. Files never downloaded still require signing back
in. The optional synced-object cleanup keeps unsent edits, Page revisions and
their file dependencies. A durable logout journal finishes interrupted cleanup
after restart; a failed revocation pauses sync until sign-out is retried. Edits
made while signed out are tracked locally and queued on same-account re-entry.
Native sign-in/sign-out also disables automatic activation of old development
configuration, so a stale dev file cannot reconnect after logout.

The default operator policy is **1 GiB per account**, **50 MiB per file** and
**600 writes per backend per minute**. Set `BRIDGE_STORAGE_LIMIT_BYTES` and
`BRIDGE_WRITES_PER_MINUTE` to change defaults. D1 migration `0003_bridge_quotas`
adds optional `bridge_account_quotas` overrides (`account_id`, `plan`,
`storage_limit_bytes`, `writes_per_minute`). These are operator-managed limits;
there is no billing integration. Public `/v1/quota`, Settings and CLI status
report usage without exposing keys or content.

Storage counts current encrypted registers, permanent tombstones, stored R2
chunks and unexpired upload reservations. Retried/duplicate chunks count once.
Expired reservations reconcile R2 before releasing space, including a crash
between a PUT and its receipt. Stored chunks remain charged until physically
deleted by blob collection. Record replacements and deletes reclaim their superseded
logical register bytes. Reads and tombstones remain available at quota/rate
limits. Failed writes stay in the local outbox and retry after capacity returns.

Record, stored-chunk and reserved-byte totals are persistent SQLite counters,
updated by triggers in the same transaction as their source rows. Existing
Durable Objects initialize these totals and indexes once; hibernation/restart
and quota checks do not rescan the ciphertext or chunk inventory. Row/run
deletes remove their superseded current registers immediately while preserving
the permanent tombstones and log/cursor rules. Reservation expiry uses an index.

Backends sample usage after changes at most once per minute and reuse the cached
sample while idle. Entering/recovering from a quota refusal refreshes the sample;
repeated refusals and failed samples remain throttled. A failed usage request
does not interrupt replication. The hub still enforces every upload/write.

For headless management, use `mains bridge projects`,
`mains bridge local-only <project-id> --on|--off`,
`mains bridge sync-history`, and `mains bridge sync`. `mains bridge status`
includes sync health, queued changes and account usage.

## R2 garbage collection

Every new upsert authenticates a sorted, deduplicated `header.blobs` list of
`{ blobId, size }`, including an empty list for records with no blobs. The list
must exactly match the decrypted manifests. The hub can correlate opaque records
with their account-private blob identities, but filenames, paths, MIME types,
tables, columns and contents remain encrypted. Old envelope AAD still verifies.

Transactional log triggers maintain blob links and reference counts. All current
registers and not-yet-compacted log versions protect their chunks, including
shared attachments in different run streams, Atlas files retained in Trash or
history, and generic large values. Deletes, replacement compaction, run deletion
and idle mirror expiry release those links. Removing one reference never removes
another record's file. Tombstones remain whole and permanent.

After the last link is removed, collection waits **24 hours**. Upload reservations
also renew this grace period, protecting the interval between upload and metadata
publication. A read begun near the deadline protects the chunks until its
ten-minute signed capability expires. Abandoned/partial uploads are collected
after the same grace. A Durable Object alarm processes at most 32 blobs per invocation and reschedules
remaining work. Candidate/byte counters and indexes are persistent: quota queries
do not run GC, scan records or list the bucket. Existing log/chunk inventories
are indexed once when upgrading; later wakes do not rebuild them.

Publication, reservations, PUTs and collection share the account concurrency
gate. A durable deletion intent fences stale chunk receipts before R2 deletion;
quota is decremented only after the R2 delete succeeds. Failed deletion stays
charged, and a crash before the SQLite receipt retries idempotently. A new upload
finishes any pending deletion before reserving the same content again. Incomplete
or collected blobs cannot acquire new record ACKs. Backends republish exact large
values, captured/cache bytes or verified source files before retrying; unavailable
bytes leave their changes queued.

Upgrade hub and backends together: earlier validators do not recognize the new
authenticated header or `blobMissing` ACK. Backend migration `0038` runs a
resumable, one-time announcement of the original writer's acknowledged register
clocks. Only an equal-clock legacy envelope can receive a roots-only refresh;
stale records still lose LWW and permanent deletes still win. Announcements do
not create fresh conflict clocks or recovered Page copies. Any remaining legacy
upsert with unknown roots **pauses new collection for that account** until its
writer updates/rejoins, its scope resumes, or the record is deleted. Unknown
references are never guessed; this can delay reclamation on older accounts.

Local acceptance uses disposable workerd/SQLite/R2 stores and two independent
backend databases. It verifies physical deletion and exact quota reduction,
shared/history/Trash files opening on B with A offline, orphan retry, legacy
upgrade, retention, real alarms, bounded batches, account isolation and injected
R2/crash failures. No deployed Cloudflare resource is queried or changed.

## Test two independent backends

```sh
cd packages/backend
npm rebuild better-sqlite3
cd ../../apps/bridge
npm test
npm run test:replication
npm run typecheck
npm run lint
npm run build
```

`test:replication` runs all 58 core integration scenarios against the actual Worker
on a real HTTP/WebSocket listener, with the sealing codec and independently
migrated SQLite databases. Seven additional network tests check actual Durable
Object SQL for ciphertext, persistence across restart, permanent tombstones,
account and writer isolation, presence, hibernation, reconnect, batching and
tampered data. Every run uses temporary stores and generated test credentials;
it does not need a Cloudflare account or the running `npm run dev` listener.
The suite also checks B4 configuration, background scheduling, lazy conversation
subscriptions, shared viewer leases, device labels and offline copies. JSON1
`json_set`/`json_object` writes are captured as SQLite text, including retry of
older pending captures that accidentally inlined JSON objects.
`build` is a local Wrangler dry run.

After building the renderer and server as above, `npm run test:hosts` checks two
real server composition roots, authenticated RPC, lazy and live transcript
transfer, read-only enforcement, source control through an actual paired-device
connection, presence, and persistence after restart. CI runs this with the
standalone package checks. All profiles, hub stores and credentials are temporary.

## Backend integration

The host composition roots register Bridge IPC, start `bridgeService` after the
database is ready, and stop it before closing SQLite. A missing config leaves
capture disabled; connection failure leaves local writes usable and retries
from durable outbox/cursors. The serialized background loop pulls account roots
first, publishes their acknowledged parents before children, and polls watched
run streams (1 second active, 10 seconds idle, exponential retry up to 30 seconds).
Opening a replica leases its run subscription for 90 seconds; clients renew it
every 30 seconds and release it on navigation. Multiple viewers share the stream.
Device labels/last-seen times are cached locally; unavailable presence is shown
as unknown, rather than treating cached state as a current online signal.

For an existing development database, start it once to create its backend id,
stop it, and generate a config against your `npm run dev` hub:

```sh
cd apps/bridge
npm run dev:client -- --database /absolute/profile-A/mains.db --output /absolute/profile-A/bridge/dev.json --key-file /absolute/demo.key --account demo --label "Computer A"
npm run dev:client -- --database /absolute/profile-B/mains.db --output /absolute/profile-B/bridge/dev.json --key-file /absolute/demo.key --account demo --label "Computer B"
```

Both configs use the same demo account and account-key file, with different
persisted backend ids and JWTs. Start each backend with `MAINS_BRIDGE_CONFIG`
set to its own config file. The default lookup is `<userData>/bridge/dev.json`;
`{"enabled":false}` disables it after restart. Configs and keys are mode 0600;
the generator refuses to overwrite one. To renew an expired dev token, move the
old config aside and regenerate with the same database, account and key file.
The database is fingerprint-bound to that account key. These files are a local
development mechanism; production sign-in and secure key storage remain B7.

The public `@mains/backend/modules/bridge` seam also exports:

- `generateBridgeAccountKey`, `deriveBridgeKeys` and `createBridgeSealingCodec`;
- X25519 device key generation and account-key sealing/opening;
- `createBridgeWebSocketTransport` and the existing `createBridgeEngine`.

Give both demo backends the same account key through the test setup. Each uses
its own persisted backend id, own SQLite connection and own dev token. Pass
`deriveBridgeKeys(accountKey).recordKey` and
`createBridgeSealingCodec(accountKey)` into the engine, together with the
WebSocket transport. Run `bootstrap()`, drain `push()` for the account and any
run streams, and `pull()` on the receiver. `subscribe()` supplies `onChanged`
hints; the receiver pulls from its durable cursor. Presence has its own callback.
Disconnected RPCs reject and leave the engine's outbox and cursor available for
retry. Reconnect refreshes the token through the caller's token provider and
restores subscriptions. `bridge:getStatus`, `bridge:syncNow`, `bridge:watchRun`
and `bridge:unwatchRun` expose lifecycle to the renderer; status and applied-table
events refresh the existing lists and paged transcript. The Relay page shows
device sync alongside existing remote control. Keys and tokens never reach the UI.

Wire frames correlate RPCs as `{requestId, message}` and return either the same
id with `message` or `error`. Pushes are bounded by count and bytes. An encrypted
record is capped at 1 MiB, below the Durable Object SQL row limit; frames are
capped at 16 MiB. Oversized records fail before sending and stay in the outbox.
Compaction keeps the latest ciphertext per register and every whole delete envelope;
deleting a run closes its stream. A persisted alarm schedules compaction after
new writes. The `compact` RPC also makes local maintenance/tests deterministic.

Records use XChaCha20-Poly1305 with fresh 24-byte nonces. HKDF-SHA256 derives
separate body, record-id and blob-id keys from the account key. A fixed-order
encoding of the complete routing header is AEAD associated data; the receiver
also verifies the opaque HMAC record identity against the decrypted body.
Independent PyNaCl/libsodium known answers live under
`packages/backend/test/fixtures/bridge`. Only routing metadata (stream, clocks,
opaque ids, origin/owner and sizes) is visible to the hub. File bytes use the
encrypted B5 blob transport; the Atlas revision graph remains B6.

## File transfer (B5)

The demo seeds an image on A. Open B's replica, type `offline` in the demo
terminal, then open the image on B. The source backend need not stay online
once its encrypted upload completed. The browser still uses B's backend and
SQLite; verified original files are cached on B, not in browser SQLite.

Files have account-private HMAC identities and use 4 MiB XChaCha20-Poly1305
chunks with fresh nonces, a separate HKDF key per blob, and authenticated
identity/position/size. Each download verifies all chunks and the complete
file identity before exposing an atomic, read-only original. Interrupted
transfers resume per chunk. The default local LRU is 256 MiB, including partial
downloads; active transfers are pinned and downloads have two slots. Files
above 50 MiB stay source-only.

`POST /v1/blobs/presign` accepts `{blobs:[{blobId,size}],op:"put"|"get"}`.
It authenticates the backend and issues ten-minute, account/object/chunk/op
capabilities. These are Worker-signed URLs streaming the private `BLOBS` R2
binding, rather than S3 SigV4 URLs. Local development needs no S3 credentials
or deployed bucket. Chunks are immutable; filenames, MIME and plaintext hashes
never reach the hub. Production identity is checked again when each capability is used, so revoking a backend invalidates previously issued URLs too.

Attachment membership is checked before resolving bytes. Inline artifact blobs
are externalized, and explicit file artifacts and selected turn outputs use the
same transport. Turn-end output snapshots stay in `bridge/uploads` until ACK;
the selected-output manifest lives on its existing reply anchor. Replica views
rebuild that projection and open cached images/documents without touching A's
paths. Collection source files also resolve lazily. B6 enables Atlas files, Pages and revision graphs for signed-in backends and explicit development configurations.
Migration 0033 upgrades already acknowledged B4 file records with new clocks.

`npm run test:replication` covers real workerd/R2 plus independent SQLite stores,
including interrupted uploads/downloads, corruption, accounts, snapshot races,
old-record upgrades and cached reopening. `npm run test:hosts` opens A's image
on B with A stopped, through the real authenticated application protocol, and
checks the existing paired-device remote control path too.

Implementation references: [Durable Object SQLite](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[storage limits](https://developers.cloudflare.com/durable-objects/platform/limits/),
[WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/),
[R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
[noble ciphers](https://github.com/paulmillr/noble-ciphers) and
[noble curves](https://github.com/paulmillr/noble-curves).
