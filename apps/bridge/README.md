# Bridge hub

Unreleased writer-authentication work is tracked in
[Authenticated writers](AUTHENTICATED-WRITERS.md).
Stage 1 requires independent X25519 encryption and Ed25519 signing identities.
Comparison codes bind the account, backend and both public keys; approval and
recovery proofs cannot substitute either recipient key. Identity vault format 2
is mandatory. The initial D1 identity schema now includes required signing keys;
use fresh disposable Bridge profiles and D1 stores for this work. No old-vault
conversion or unsigned-data migration is provided. Stage 2 requires a device
signature on every record and tombstone, a durable publication journal, and
publication-bound ACKs. Stage 3 adds the signed, hash-chained membership log,
join codes, records bound to membership, account-stream removal fences and the
replay horizon ([Membership and revocation](MEMBERSHIP.md)); run-stream fences
and revocation key epochs remain, required before release.

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
path; the 50 MiB per-entry blob limit applies. Smaller entries above the 128 KiB
field limit travel as ordinary value blobs and arrive inline. Failed import leaves the Claude
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
npm run dev:token -- --account demo --backend A --signing-public-key <A-Ed25519-public-key>
npm run dev:token -- --account demo --backend B --signing-public-key <B-Ed25519-public-key>
```

Clients send the token in `Authorization: Bearer <token>` during the WebSocket
handshake. A token alone can read; publishing also needs the backend's key in the
account's membership log, which `dev:client` (below) appends. These development
JWTs bind `accountId`, backend id and the independent Ed25519 signing public key, expire after
24 hours, and are accepted only with `BRIDGE_DEV_AUTH=true` and a configured
signing secret. These are development credentials only; normal sign-in and approval are described below. The dev token and the E2EE account key are separate credentials.

## Sign-in and key management (B7)

Settings › **Bridge** (`/settings?section=bridge`) signs the selected backend into
an account. Desktop opens the system browser and receives a one-use, 60-second
authorization code on an ephemeral loopback listener, bound with state and PKCE
S256. A Node backend uses Better Auth’s device authorization flow: the browser
shows the account login, then explicitly authorizes the displayed sign-in code.
GitHub, email/password and verified email sign-in links use the same Better Auth
account. Signing in does not grant an existing account’s decryption key, beta
access or a subscription.

When mail delivery is configured, the secure browser page offers **Sign in**,
**Create an account**, **Forgot password?** and the existing email-link option.
These pages, device authorization and the native-app handoff share Mains' mark,
default neutral palette and rounded controls, with blue submit actions and
separate secondary actions. They follow the browser's light/dark appearance,
adapt to narrow screens and need no external images, fonts or scripts.
Passwords must contain 12–128 characters and Better Auth stores only their
salted password hashes in the existing D1 credential rows. New email accounts
must verify their mailbox before password sign-in; verification does not create
a signed-in session automatically. Verification links expire after one hour.

An existing GitHub user can use **Forgot password?** with their verified account
email to add a password to that same account. Password reset links last 15 minutes
and are single-use. Reset revokes browser sessions while preserving the account
ID, subscription, device credentials and encrypted key wraps. It does not replace
the Bridge recovery code or approve a new device. Passwords are submitted only
on the hub's secure browser page, never through renderer IPC, Redux or local
storage. A reset page removes its token from the address bar after loading.

The first backend creates the random 256-bit account key. It uploads an X25519
wrap for its own public key plus an Argon2id recovery wrap. The recovery code
has 160 random bits, is shown once, and is never sent to the hub. Save it before
closing Mains; if the setup code was not saved, an approved backend can generate
a replacement in Settings. Replacing it invalidates the previous recovery code.
The fixed recovery KDF uses 64 MiB, three iterations and one lane.

A later backend remains **pending** with no log or R2 access until either:

- An approved backend derives the twelve-character (60-bit) public-key code
  locally. Its operator types the code shown on the new backend; only a match
  approves that exact request and public keys. The approving side never displays
  the expected code. Approval appends a signed membership entry admitting those
  keys; the new backend then requires that entry's join code from the approving
  backend before starting sync. Desktop also posts an OS notification, without
  the code, when a request arrives.
- The new backend decrypts the recovery wrap locally and signs its own admission
  with the recovery signing key derived from the same code. The entry binds the
  account, backend and both public keys and only appends on the current
  membership head, so it cannot be replayed or transferred to another recipient.
  Other backends can be offline.

Every account keeps an append-only, hash-chained **membership log** in its
Durable Object: a genesis entry, then signed admissions, removals and recovery
rotations. Each entry names its predecessor's hash and sequence; the hub appends
only on the current head (a moved head is a 409 the client re-signs on) and
broadcasts the new sequence to open sockets. The hub checks signatures and
authority, but every backend verifies the whole chain itself. Genesis commits to
the account key (HKDF-SHA256, `mains.bridge.v3`, `account-commitment`) and to the
recovery signing key. Only current members may admit or remove members; only the
recovery key may admit by recovery, and only a member may rotate it. Removal and
sign-out are signed removals, so a removed backend cannot re-admit itself with
the account key alone. Verified entries are cached in `bridge/membership.json`;
the latest verified head is pinned inside the encrypted identity vault. A log
that rewinds or forks past that pin stops Bridge with a membership conflict.

The hub stores verified-account metadata, hashed 90-day backend credentials,
public keys, encrypted key wraps and expiring approval requests. Backends renew
credentials before expiry. The backend generates a fresh random token, saves it
as pending in protected storage, and sends only its SHA-256 hash. Repeating the
same proposal is idempotent; a different proposal returns a visible 409 conflict.
The hub acknowledges the exact hash and expiry without returning the token or
deriving it from a server secret. The saved successor is published to replication
only after the acknowledgement is validated and persisted; its first use retires
the predecessor. Lost responses and restart retry the same saved proposal.
Private device encryption/signing keys, account keys and backend tokens
live only in an encrypted `bridge/identity.json` (mode 0600). Electron uses
`safeStorage`; standalone uses its protected `server-secret.key` storage adapter.
The host adapters’ formats are intentionally incompatible and fail closed; use
separate profiles for simultaneous Desktop/Server backends. Public status and
notifications contain no credentials. Recovery values bypass Redux and durable
command receipts.

Signing keys, this backend's own earlier ones included, come only from the
verified membership log, where every admission and removal is signed; there is
no separate writer directory. A re-enrolled backend's old records verify through
its earlier key's interval in the log. Registration refuses a key the log has
already admitted, for any backend.
An enrollment response that substitutes either public key or the backend id is
rejected and its pending registration is revoked with the issued device token.

Revocation closes open Bridge sockets and blocks later frames and existing blob
URLs. It cannot remove plaintext already downloaded by the revoked backend.
Removal is a signed `remove` entry carrying a **fence**: the remover reads the
whole account stream and commits to the signatures of every record the removed
backend wrote there; only the entry is sent. The hub derives the same list from the
records it stores and appends the removal only if it matches, and refuses later
publications from a backend that is no longer a member. Revoking a backend revokes
its registration: a registration holding a member's keys needs that signed
removal, any other one (pending, or re-enrolled with new keys) is revoked by
credential alone, and old keys no registration holds leave through
`POST /v1/membership`. After learning of a removal, other backends accept the removed writer's
account records only if their signatures are in its fence, so a hub cannot later
insert backdated ones. Its run-stream records are fenced in a later slice.
Approving a backend that re-enrolled with new keys while its old keys are still in
the log first removes the old keys the same way.
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
mains bridge approve <backend-id> --code <matching-12-character-device-code>
mains bridge confirm --code <join-code-from-approving-device>
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

Device approval uses two local comparisons. A derives B's 60-bit device code
from the account id, backend id, X25519 public key and Ed25519 signing public key;
it never displays or validates against the hub's supplied
`code` field. Codes are twelve base32 characters grouped as `ABCD-EFGH-JKLM`.
After A approves, B decrypts the offered account key into protected **pending**
storage, checks it against the genesis commitment and pins the membership entry
that admitted it. B cannot start replication (including log pulls, blob downloads
and local-history uploads) until its operator obtains B's join code from
Settings › Bridge (or the `mains bridge approve` output, or `joinCodes` in
`mains bridge status`) on A and enters it on B. B compares the input locally
without exposing its expected join code through status, UI or CLI. Likewise, A's
Settings and notification never show B's expected device code; the operator
types it from B's screen (or passes it to `mains bridge approve --code`). A typed
code for an old recipient is discarded when a request's public key changes.

A join code is derived from the account key with HKDF-SHA256 (`mains.bridge.v3`)
over the account id, B's backend id and the hash of the exact entry that admitted
B, and retains 60 bits. A hub that offers B a different key or a different
admission therefore produces a different code. Only ready backends display join
codes, one per device admitted by approval; pending backends cannot provide their
own confirmation value.
Neither a hub-supplied recovery verifier nor an HTTP approval response establishes
trust. Pending keys stay pending across restarts and cannot be silently replaced
by a different hub wrap. Recovery instead trusts the key decrypted locally by
the user-held recovery code, provided the code's signing key is the log's current
recovery authority (a replaced code is rejected). The first backend trusts its
locally generated key. Previously stored active keys remain pinned and are not
replaced by hub data; every activation checks the key against the genesis
commitment.

Update the hub and both backends together: six-character approval codes are
rejected, with no automatic downgrade. This changes the approval ceremony and
local status/API only; it does not rotate account keys or change existing
record/blob ciphertext, D1 data or R2 objects. Comparisons must use trusted Mains
clients, not two values shown by the hub's sign-in page.

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
address for verification, password-reset and sign-in emails. `BETTER_AUTH_SECRET` must be at least 32 random
characters. The mail implementation uses Resend, or an `AUTH_MAILER` service
binding; Workers `waitUntil` keeps background account emails alive. Local tests
replace only delivery and consume real Better Auth links. Password registration
is disabled when no mail service is configured; no migration or existing account
reset is needed to enable it.
Choose the OAuth and mail methods you configure; unavailable buttons are hidden.
Disable `BRIDGE_DEV_AUTH` on a normal hub. No production deployment or provider
credentials are required for the automated tests.

### Resend production setup

The production sender is `Mains <no-reply@auth.mains.dev>`, set with `MAIL_FROM`
in `wrangler.production.jsonc`. Verify `auth.mains.dev` in Resend using the exact
DNS records shown for that domain. Keep open/click tracking disabled for account
emails. This sending domain does not require moving the existing `mains.dev`
mailbox or enabling inbound mail in Resend.

Create a Resend API key named **Mains Bridge Production**, with **Sending access**
restricted to `auth.mains.dev`. From `apps/bridge`, enter the key at Wrangler's
hidden prompt, never in a command argument, source file or chat:

```sh
npx wrangler secret put RESEND_API_KEY --config wrangler.production.jsonc --profile mains-production
```

After Resend reports **Verified** and the secret is provisioned, run
`npm run production:build` locally before an authorized `npm run production:deploy`.
No new D1 migration is needed for this mail/password change. Deployment preserves
existing identities, subscriptions, encrypted data and device credentials.
Use a new test email address to check registration/verification, password sign-in
and reset; do not reset an existing user's password for a smoke test.

The production rollout was verified on **2026-10-16** with a separate test account:
registration, mailbox verification, password sign-in, reset-mail delivery and
sign-in with the new password all passed. D1 checks confirmed the same account
identity, revocation of the prior browser session and a new active session, with
no automatic entitlement grant. Original records in eight auth/Bridge tables
matched the pre-release backup. Private receipts and the code rollback plan are
kept under the ignored `.wrangler/mail-rollout/` directory.

### Resend staging setup

Staging uses the same verified `auth.mains.dev` sending domain with a separate
sender, `Mains Staging <no-reply-staging@auth.mains.dev>`, configured in
`wrangler.staging.jsonc`. Create a different Resend key named **Mains Bridge
Staging**, with **Sending access** restricted to `auth.mains.dev`. Do not copy the
production API key. From `apps/bridge`, enter the new key at the hidden prompt:

```sh
npx wrangler secret put RESEND_API_KEY --config wrangler.staging.jsonc --profile default
```

The staging configuration requires this secret before publishing. Run
`npm run staging:build`, take and verify the staging backup, and apply any pending
D1 migrations before deploying the current Worker. In particular, a staging hub
that predates closed beta needs the additive `0005_closed_beta.sql` migration.
Keep the existing GitHub and Better Auth secrets, Cloudflare account, D1, R2 and
Durable Object namespace. No production configuration or client profiles change.

After deployment, use a separate staging test identity to check verification,
password sign-in and password reset. Account creation does not grant Bridge
access; use the staging beta operator command for selected beta testers.
Automated tests use mocked delivery and disposable databases; they never send
real mail.

The staging rollout was verified on **2026-10-16** with a separate test identity:
mailbox verification, password sign-in, password reset and sign-in with the new
password passed. Both mails used the staging sender and staging links. Reset
revoked the previous session; no beta invitation or entitlement was added. The
original records in eight auth/Bridge tables and all 12 encrypted R2 objects
matched the pre-release backup. Private receipts are kept under the ignored
`.wrangler/staging-mail-rollout/` directory. Production was not changed.

`npm test` includes approval/recovery isolation, membership log signing, authority
and compare-and-swap appends,
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

Selected testers can instead activate a separate 30-day closed-beta grant. See
[Closed beta access](CLOSED-BETA.md) for the user flow, safe operator commands and
rollout order. Migration `0005` grants nothing automatically. New accounts need
an invitation/activation or an operator subscription before Bridge enrollment;
existing initialized accounts retain read/recovery access. Public login pages
and uninvited accounts receive no beta offer.

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

The account DO caches one indexed D1 query over subscription and beta grants for 60 seconds and coalesces concurrent
requests. It checks cached period expiry on every use, so the cache never extends
the end of a subscription. Direct operator grants/revocations take up to 60 seconds
to appear at the hub; client refresh does not bypass that server cache. An idle
client updates its displayed status on the next upload attempt or manual refresh;
pending inactive clients check for renewal in the background. A future trusted
billing-event consumer can call the internal `subscriptionChanged(accountId)` RPC
after committing D1 to invalidate it immediately. No payment-event handler is
implemented yet. Beta activation uses that RPC after committing its one-time
grant. Inactive clients with pending writes check for renewal at most
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
The checked-in production configuration also requires `RESEND_API_KEY` for its
configured email sender. These secrets are required for deploy;
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

Each account DO caches **policy only** (plan, byte ceiling and write rate) for
60 seconds, including missing D1 overrides, and shares an in-flight lookup.
Account/plan keys are isolated; hibernation drops the cache. The internal
`subscriptionChanged` notification invalidates both entitlement and limits
caches; direct Console SQL changes become visible within 60 seconds. An expired
lookup that fails denies publication rather than reusing stale policy. Current
usage and outstanding reservations are never cached by this policy helper.

Storage counts current encrypted registers, permanent tombstones, a conservative
256-byte charge per signed-publication replay receipt (kept until the replay
horizon passes it), stored R2
chunks and unexpired upload reservations. Retried/duplicate chunks count once.
Expired reservations reconcile R2 before releasing space, including a crash
between a PUT and its receipt. Stored chunks remain charged until physically
deleted by blob collection. Record replacements and deletes reclaim their superseded
logical register bytes. Reads and tombstones remain available at quota/rate
limits. Failed writes stay in the local outbox and retry after capacity returns.

Because tombstones are permanent and bypass quota and subscription checks, they
have their own bounds: a pushed deletion larger than 4 KiB closes the socket
before any of its batch commits (an honest one seals only `{table, pk}`), and
each backend may add **600 new tombstones per minute** in a bucket separate from
upserts (`rateLimited`, retried from the outbox). Re-sent tombstones are still
acknowledged. Every record clocked more than 10 minutes ahead of the hub is
refused with `clockSkew`: such a clock would win every later write of its
register and pull every replica's clock forward. The refusal carries the hub's
time. No replica holds a refused clock, so the device re-stamps every clock of
its own beyond that bound at the bound itself, in the original order, and sends
them once more. They still outrank every clock the hub accepted, as they already
did on that device, and a clock that ran ahead (or still does) costs one refused
round trip instead of a lockout until real time catches up.

Download capabilities are budgeted too: each backend may request **1200 per
minute** in its own bucket (HTTP 429). Honest clients cache what they download,
so the budget only bounds a looping or leaked client. Only uploads check which
chunks are already stored (an R2 HEAD per chunk); a download learns of a missing
chunk from its GET.

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

### Fair-use write budget (monitoring only)

Each account DO counts newly accepted upsert records per monthly period in
`write_budget`, with one counter write per publication. Idempotent re-ACKs,
refused writes and permanent deletes are not counted; initial history sync
counts like any other publication. Periods follow the active entitlement's
start day and time (UTC calendar months with month-end clamping, like billing
grants); without a started entitlement the UTC calendar month is used.

The default budget is **250,000 records per month**, set with
`BRIDGE_RECORDS_PER_MONTH`. It is deliberately outside the public plan
contract and is **not enforced**: nothing is refused or shown to users. When a
publication crosses 80% or 100% of the period's budget, the hub logs one
`bridge.write_budget` event with the opaque `hubId`, threshold, record count,
budget and period bounds. No account ID, record content or SQL is logged.
Filter Workers Logs for `bridge.write_budget` to find accounts above fair use.

For headless management, use `mains bridge projects`,
`mains bridge local-only <project-id> --on|--off`,
`mains bridge sync-history`, and `mains bridge sync`. `mains bridge status`
includes sync health, queued changes and account usage.

### Account SQL cost measurements

`bridge.sql_usage` structured log events measure native DO SQLite `rowsRead`,
`rowsWritten`, query count, duration and limits-cache hits/misses per operation.
`hubId` is the opaque account Durable Object id, also returned by the private
operations checkpoint; it is not an email, token or public account lookup.
SQL text, bindings and record contents are never logged. The native cursors are
measured after consumption, including lazy/partial iteration and trigger/index
work reported by workerd. Async operations have independent measurement scopes.

`BRIDGE_SQL_USAGE_SAMPLE_RATE` accepts `0`–`1`: the default is `0.1` in staging
and production and `0` locally. Set `1` for a complete local or temporary
diagnostic capture, or `0` to disable. When enabled, maintenance is always
sampled. Every event carries its actual `sampleRate`; aggregate ordinary
operations with that sampling weight and keep maintenance separate. These are
DO SQL measurements, not a monthly budget, billing ledger, or D1/R2 request
totals. Metrics do not write counters, create SQL tables or arm alarms, and a
logging failure cannot change a quota or publication decision.

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

Publication, reservations, upload admission/receipts and collection share the
account concurrency gate. R2 PUT I/O runs outside that gate: a durable
`blob_uploads` intent pins the chunk's reservation and its whole blob against
expiry reconciliation and GC until the write settles. Up to eight distinct
chunks can be in flight per account; duplicate requests for a chunk coalesce
and revalidate before acknowledgement. Conditional creation preserves immutable
bytes. Other records, quota reads and uploads can progress during a slow PUT.
The receipt atomically converts reserved bytes to stored bytes, renews GC grace
and clears the intent. Credential/capability and subscription checks run again
after I/O; a refusal still accounts for bytes physically stored. A caller
disconnect does not abandon a dispatched write. After an object reset, unresolved
intents are reconciled against R2 before their bytes/pins are released; failures
remain charged and retry on the maintenance alarm.

A durable deletion intent fences stale chunk receipts before R2 deletion;
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

The backend remembers the SQLite change/schema version and active capabilities
after checking parked records. Empty pulls with unchanged state do not scan or
decrypt them again; cursor-only advancement across compacted gaps is excluded
from that change detection. New records, local SQL dependency changes, restart,
schema/feature changes and explicit `engine.retryParked()` recheck the queue.
A failed blob restoration stays retryable. Decrypted records are never cached
across calls, and durable parking/cursor/ownership checks retain their rules.

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
first and publishes their acknowledged parents before children. Local write
events and hub `changed` hints wake it immediately. Local writes run a push-only
cycle. Change hints pull account roots and the affected watched conversation,
without re-reading unrelated transcripts; the publishing socket receives no
echoed hint. Account and watched-run streams use a five-minute safety pull for
lost hints; opening a conversation and reconnecting also pull immediately.
Publishing never postpones that safety deadline. A one-second **local-only**
outbox check catches direct SQL writers without contacting the hub. Queued
uploads keep progressing, and connection failures retain exponential retry up
to 30 seconds. A write cycle that sends nothing while changes stay queued backs
off from 2 to 60 seconds; a new local write ends that wait at the next check.
Opening a replica leases its run subscription for 90 seconds; clients renew it
every 30 seconds and release it on navigation. Renewing an existing lease sends
no RPC. Multiple viewers share the stream.
Device labels/last-seen times are cached locally; unavailable presence is shown
as unknown, rather than treating cached state as a current online signal.

Each account DO caches WebSocket identity checks for 30 seconds, bound to the
account, backend, credential hash and exact credential expiry. Concurrent
messages share one lookup. Revocation invalidates that backend's cache and
closes its sockets immediately. On first use of a replacement credential,
rotation attempts to invalidate only its predecessor's cache and sockets; new
sockets are unaffected. A DO failure is reported without failing successful
authentication. Hibernation discards the
in-memory cache; a surviving socket is revalidated on its next message. No cache
timer keeps the DO awake. R2 capabilities and HTTP credentials retain their
per-request validation. Presence writes are limited to once per 30 seconds per
backend, with immediate updates on connection and disconnection.

Ready identities and devices waiting for the user's join code confirmation
check every five minutes. An unchanged pending key is never re-written to
protected storage. Sign-in and pending approval keep their short polling
interval. WebSocket approval notifications and policy closure (1008) trigger an
immediate HTTP identity recheck, queued after any in-progress snapshot. A socket
closure alone never erases a trusted account key.

The Node transport sends WebSocket protocol pings every 25 seconds, requires a
matching pong within 10 seconds and reconnects after an unresponsive connection.
Cloudflare answers these control frames without invoking the DO message handler
or interrupting hibernation. Heartbeats add no D1 reads or presence writes.
Timers belong to the individual connection and are canceled on disconnect.

Migration `0006_backend_token_handover.sql` adds nullable successor hash/expiry
fields without changing existing credentials. Refresh stages a successor while
the current token retains its original expiry. Repeated and concurrent retries
return the same candidate and expiry, using domain-separated HMAC-SHA256 with
`BETTER_AUTH_SECRET`; D1 stores only hashes. The client validates the response
and durably saves the successor before exposing it to replication. Its first
authenticated HTTP/WebSocket use commits the handover with a conditional D1
update, then clears the candidate and invalidates the predecessor. Until that
first use, a lost/truncated response or local storage failure leaves the old
credential usable. Revocation clears both credentials and cannot be undone by
a concurrent handover. Natural token expiry still applies.

Apply migration 0006 before deploying a handover-aware Worker. During rollout,
keep `BETTER_AUTH_SECRET` stable while proposals are pending, and choose a
handover-aware rollback version. Changing the signing secret cannot replace an
already issued proposal silently: renewal returns a retryable error and keeps
the current credential. A client that already saved its successor can still
commit it, independently of that secret.

For an existing development database, start it once to create its backend id,
stop it, and generate a config against your `npm run dev` hub:

```sh
cd apps/bridge
npm run dev:client -- --database /absolute/profile-A/mains.db --output /absolute/profile-A/bridge/dev.json --key-file /absolute/demo.key --account demo --label "Computer A"
npm run dev:client -- --database /absolute/profile-B/mains.db --output /absolute/profile-B/bridge/dev.json --key-file /absolute/demo.key --account demo --label "Computer B"
```

Both configs use the same demo account and account-key file, with different
persisted backend ids and JWTs. With the hub running, each run also admits its
backend to the account's membership log. The log's authority is derived from the
account-key file (a `dev-authority` member), so any run with that file can admit
a backend, and a log created with another key file is refused. Start each backend with `MAINS_BRIDGE_CONFIG`
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
new writes. Local development and tests may also run it on demand through the
`compact` RPC; staging and production refuse it (`forbidden`).
An indexed, durable `compaction_jobs` queue tracks superseded registers, closed
runs and mirror-retention deadlines. Each pass discovers/removes at most 128
source rows and handles at most 16 jobs; remaining due work resumes on an alarm
after one second. It never scans unrelated registers. Existing stores build the
new indexes once on first open (that index construction scales with existing
data), then discover legacy log cleanup in bounded rowid batches that survive
hibernation. Completed discovery retains its marker, so a restart does not
rescan the log. Empty passes read only; stream counters and permanent tombstones
are retained. Existing blob-reference triggers release only removed log roots,
with the same reservation/read protection and GC grace rules.

Records use XChaCha20-Poly1305 with fresh 24-byte nonces. HKDF-SHA256 derives
separate body, record-id and blob-id keys from the account key. A fixed-order
encoding of the complete routing header is AEAD associated data; the receiver
also verifies the opaque HMAC record identity against the decrypted body.
Independent PyNaCl/libsodium known answers live under
`packages/backend/test/fixtures/bridge`. Only routing metadata (stream, clocks,
opaque ids, origin/owner and sizes) is visible to the hub. File bytes use the
encrypted B5 blob transport; the Atlas revision graph remains B6.

Every network envelope carries an Ed25519 signature over the account id, epoch,
random 256-bit publication id, signing public key, complete routing header, nonce
and ciphertext. Epoch 1 is mandatory until membership/key rotation is implemented.
The hub checks the entire batch against the authenticated backend's registered
key before any LWW, tombstone, ownership, quota or retention mutation. A bearer
token without that private key cannot publish a new envelope or retimestamp one.

Backends journal each exact signed envelope in migration 0039's
`bridge_publications` before sending it. A lost ACK or process restart resends the
same nonce, publication id and signature. A changed capture image is signed as a
new publication. Success and deleted ACKs identify the publication they answer;
the client checks all those identifiers before acknowledging any entry. Success
clears the journal and matching outbox generation atomically. These ACKs associate
a response with a write; they cannot prove that a compromised hub kept its bytes.

The hub retains replay receipts through compaction and mirror expiry. Replaying
an accepted signed publication neither restores expired ciphertext nor refreshes
run activity. An active source may explicitly publish a new signed envelope with
the original capture clock to restore an expired mirror. Receipts are charged to
record quota, so replacements cannot grow an uncharged replay ledger.
They are included in hub backup, restore and account reset.

Receipts do not last forever. Every publication binds a membership head, and the
**replay horizon** is the newest membership entry the hub appended at least 30 days
ago. The hub refuses a publication bound below the horizon with `membershipStale`
(carrying its current head) before any state changes, and its maintenance alarm
drops the receipts bound there, returning their quota. A device that receives
`membershipStale` forgets that write's journaled envelope (and a kept tombstone),
refreshes membership and signs it again on the newest head, once per push. So that
the horizon keeps moving while membership is quiet, a member appends a
`checkpoint { horizon: true }` entry once the newest entry is a week old; the hub's
time only triggers it, and each device tries at most once a day. Approved members
append it through `POST /v1/membership`, which accepts nothing else.

Receivers verify device signatures before decryption, blob downloads, clock
advancement or SQL projection. Every record signature (`auth` v2) binds the
writer's membership head `{seq, hash}`. A receiver accepts it only when that head
is part of the log it verified and the signing key was the origin's at that seq;
an incoming owner field cannot introduce a locally executable root without local
row/capture provenance. Before applying a page that binds a newer head, the
receiver pulls and verifies the log; a binding to another history stops sync with
a membership conflict and applies nothing. Membership is otherwise re-read at
start, after reconnects, on the hub's `membership` hint and with the safety read.
The hub refuses a push bound to a head outside its log or to a seq at which the
session's key was not the writer's, or from a backend that is no longer a member.
A removed writer's account records verify only through its removal fence; its
run-stream records are fenced in a later slice
([Membership and revocation](MEMBERSHIP.md) slice 3), and that and new
content-key epochs remain release gates.

A signed writer can still author invalid encrypted bodies. A pulled record
that fails authentication or validation is therefore never applied and never
stops its stream: it is kept in `bridge_parked` as `unverified`, its clock is
ignored, and the cursor moves on. A record that authenticates but that this
replica refuses (an ownership collision, a rewritten immutable revision, a
SQLite constraint) is undone and set aside the same way; a local failure, such
as recovery or I/O, still rolls back the whole batch to be retried. Each engine
re-checks up to 100 such records once the hub answers, fetching that sequence
again, so a newer client version or an undamaged copy still applies; one the hub
no longer serves was superseded and is dropped. Since a compromised signer can publish
such records at the write rate, one larger than 16 KiB keeps only its header and
at most 1000 are kept. Settings › Bridge reports how many were skipped.

An invalid deleted ACK leaves the local row, clock and outbox write intact and
reports a retryable error. A verified deletion clears a write only after matching
its row or run and successfully recording the deletion fence. Other valid ACKs in
that batch can still complete. A genuine tombstone may also arrive through the log.

For the same reason the hub refuses (`notOwner`) an upsert whose register key
currently holds a value of another row key. Both keys are HMACs of the same table
and primary key, so honest writers always agree; the check stops a credential
holder from replacing, and through compaction erasing, a register of a row it
does not own.

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
