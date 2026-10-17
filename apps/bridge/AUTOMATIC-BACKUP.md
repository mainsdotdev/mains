# Automatic operational backups

Run commands in `apps/bridge`. This is service disaster recovery, not the deferred
30-day user history feature. Payments and client databases are unchanged.

## Implementation and activation

The implementation and local workerd recovery tests are in this repository.
**A workflow file is not an active scheduler until it is published on GitHub's
default branch and its credentials, key and enable flag are configured.** Do not
mark backup coverage active before the first successful remote run and download/
local restore drill. Existing production/staging data must never be reset for setup.

### Rollout verified on 2026-10-16

Both private backup buckets exist in their respective source accounts. Both
GitHub environments have their own `CLOUDFLARE_API_TOKEN` secret, matching
`BRIDGE_BACKUP_PUBLIC_KEY` variable and a deployment branch policy allowing only
`main`. The operator confirmed independent copies of both private recovery keys.
Repository variable `BRIDGE_BACKUPS_ENABLED` is `true`.

Activation is deliberately deferred until the **v0.20 changes reach `main`**.
The workflows have not been pushed from the local branch. There is no active
GitHub schedule before that merge. Review the first Actions run after merging:
the remote drills below used the saved Wrangler OAuth profiles, so they do not
claim an end-to-end execution with GitHub's separately stored API tokens.

| Remote capture, download and empty local restore | Staging | Production |
| --- | --- | --- |
| D1 users / account hubs | 1 / 1 | 1 / 1 |
| Restored hub SQL rows | 3,097 | 57 |
| Original ciphertext objects preserved and restored | 11 | 3 |
| Auth tables equal to the pre-rollout copy | 15 / 15 | 15 / 15 |

No live restore, account reset, source bucket deletion or client database change
was performed. Local tests passed (72 tests; 17 opt-in host tests skipped), as
did typechecking/lint and the backend replication suite (122 passed; 1 skipped).
Private receipts, checksums and local recovery reports are under the ignored
directory referenced by `.wrangler/automatic-rollout/current.txt`; they are not
repository or CI artifacts. Configure/test the operator's GitHub Actions failure
notifications separately; no email or Slack destination was added by this rollout.

The pinned Wrangler remote-binding transport emitted RPC-disposal/internal
reference diagnostics during the larger staging capture. The command exited
successfully, and the independent download/checksum/local recovery checks above
passed. Keep provider diagnostics private; a printed success line alone is never
the acceptance signal. Investigate any failed command or missing verified
completion index before considering a run covered.

| Environment | Private destination (same account as source) | GitHub environment |
| --- | --- | --- |
| Production | `mains-bridge-production-backups` | `bridge-backup-production` |
| Staging | `mains-bridge-staging-backups` | `bridge-backup-staging` |

Names are pinned in `backup-targets.json`; the destinations are not bound to the
live Worker. The normal production/staging resource-isolation guard also runs
before operations. Saved Wrangler profiles are preserved. CI uses an API token
from its environment instead of a developer's OAuth refresh credentials.

## Daily flow

`.github/workflows/bridge-backup.yml` runs daily at **03:17 UTC** (06:17 Istanbul)
and supports manual dispatch. Each environment has its own concurrency group and
an R2 conditional lease, which also excludes a simultaneous manual job. A job is
limited to 90 minutes; its lease expires after two hours. An interrupted job can
be retried after release/expiry; no incomplete capture is listed as successful.

1. Export D1, capturing identities, device credentials/key wraps and entitlements.
   Enumerate accounts from that exported point, not a later live account listing.
2. Capture every account hub's SQL schema and rows, including log, latest
   registers, permanent tombstones, writer/run ownership, stream positions,
   quotas and pending blob-deletion intents. Pages are bounded by rows and bytes;
   they are read synchronously, then spooled to private runner disk. A per-object
   session nonce plus SQLite `total_changes()` rejects intervening SQL writes or
   object restarts on each page. Cloudflare's native PITR commit bookmark fences
   the **whole capture**, from before its first page to after its last page.
   A read-only hibernation can resume at the unread page with a fresh session
   token only while the original bookmark and schema remain unchanged. The
   final bookmark check also rejects a write racing that resumption. Repeated
   restarts without page progress are bounded; actual storage changes retry the
   whole capture up to three times. A missing/failed native checkpoint stops the
   job. Local workerd, which has no PITR log, keeps the stricter session fence.
   Connected, idle devices do not count as writers: presence timestamps are
   persisted on connect/disconnect, not on pull messages or keepalives. An
   initialized quota read reuses its durable account prefix without a no-op
   UPDATE and leaves an already armed maintenance alarm unchanged. Initial
   inventory/GC setup, connection transitions and actual maintenance remain
   writes; a capture crossing them must still retry.
   A continuously busy account fails the run visibly; it never produces a mixed
   snapshot. Source tables are not copied, locked across network I/O or written
   just to take a backup. Future unknown tables, KV or column types fail closed.
   Cloudflare's platform-owned `_cf_METADATA` is excluded; a destination runtime
   creates its own replication metadata. Tests cover that production/local
   catalog difference without treating unknown application tables as optional.
   Release verification on staging must also exercise native PITR: keep two
   initialized clients idle and connected, pause the account reader for longer
   than a five-minute safety pull, then finish all pages behind the same native
   bookmark. Check transport closures directly; periodic status samples can miss
   a quick reconnect, which correctly invalidates a capture. Verify a completed
   encrypted backup by downloading it and comparing every restored SQL row in
   an isolated local recovery environment. Local workerd alone cannot prove
   native bookmark or edge keepalive behavior.
3. List live R2 and the deletion archive. New source key/ETag combinations are
   downloaded, encrypted, uploaded immutably, read back and checksum-verified.
   Unchanged combinations reuse their verified backup object using HEAD; they
   are not downloaded/re-uploaded daily. Every stored chunk in the hub snapshot
   must be present in the captured live/archive inventory. A disappeared/changed
   object or missing referenced chunk fails completion.
4. Encrypt the file inventory and capture times. Publish the completion index
   **last**, after checking every referenced encrypted object's ETag and size.
   The private plaintext index contains opaque object references/checksums only;
   account identities, original object keys and auth SQL stay encrypted.
5. Retain completed snapshots for **35 days**, always keeping the last success
   even after a long scheduler outage. Validate all retained references before
   pruning anything. Delete shared pool objects only when no retained snapshot
   needs them; unreferenced/interrupted uploads have a 48-hour grace. Never put
   blanket lifecycle expiration on the shared pool: a year-old unchanged file
   can still be necessary for today's snapshot.

The daily job performs real backup reads. It does not poll quota endpoints or add
per-sync/per-status SQL scans. Source and backup buckets have distinct roles:
live R2 remains the user's active storage, the existing deletion archive retains
GC'd ciphertext for 35 days, and this destination stores encrypted recovery sets.
Backup bytes are not charged to users' Bridge storage quotas.

## Encryption and key custody

Generate a **separate key pair per environment**, once, in private ignored storage:

```sh
mkdir -m 700 -p .wrangler/backup-keys
npm run backup -- keygen --output .wrangler/backup-keys/staging
npm run backup -- keygen --output .wrangler/backup-keys/production
```

Save `private-key.pem` offline/in the operator password manager and retain an
independent recovery copy. Do not paste it into chat, commit it, upload it as an
Actions artifact or install it on the runner. CI receives **only public-key.pem**.
This operator key is separate from every user's Bridge recovery code. A hub
backup still does not contain users' plaintext account keys; users need their
approved device or recovery code to decrypt synchronized content after recovery.

Each object uses an ephemeral X25519 key agreement, HKDF-SHA256 and a fresh
AES-256-GCM nonce. The object path/environment and header are authenticated. A
different private key, path or changed ciphertext is rejected. Key fingerprints
and source resource IDs isolate object pools. Retain old private keys when
rotating; old-key pools need deliberate retirement after their recovery window.
Worker secrets and Cloudflare credentials are not exported; preserve them
independently. Checksums and encryption do not defend against an operator with
permission to delete the entire destination account.

## Enable on GitHub

1. Deploy the tested normal hub entrypoint, which adds private `snapshotBegin`,
   `snapshotPage`, `snapshotValid` RPCs. No HTTP export or live restore endpoint
   is introduced; no schema migration or namespace change is needed.
2. Create the new **private, empty** destinations with the matching saved profiles:

   ```sh
   npx wrangler r2 bucket create mains-bridge-staging-backups --config wrangler.staging.jsonc --profile default
   npx wrangler r2 bucket create mains-bridge-production-backups --config wrangler.production.jsonc --profile mains-production
   ```

   Do not enable public access, object lock or automatic pool expiration. Existing
   live/archive buckets and their lifecycle rules must remain untouched.
3. Create the GitHub environments in the table. In each, install its **own account's**
   scoped, expiring Cloudflare API token as secret `CLOUDFLARE_API_TOKEN`. The
   runner uses D1 export/Time Travel reads, deployment metadata reads, authenticated
   private service RPC and R2 reads/writes/deletes in the backup destination.
   Wrangler remote-binding preview access requires Workers script edit access;
   R2 binding access requires account R2 permissions. Limit tokens to the matching
   account and do not copy personal OAuth tokens into CI. The implementation
   only lists/reads source R2; deletion is called solely on the backup binding.
   Confirm exact token permissions during the first manual run rather than
   granting all-account global credentials.
   Start with Account → D1 → Read, Account → Workers Scripts → Edit,
   Account → Workers R2 Storage → Edit, Account → Account Settings → Read,
   scoped to the one matching account. Restrict each GitHub environment's
   deployment branch policy to `main`; do not expose these secrets to PR builds.
4. Set environment variable `BRIDGE_BACKUP_PUBLIC_KEY` to the complete matching
   **public** PEM. Publish both workflows on the repository default branch, run
   `Bridge daily backup` manually and perform the recovery drill below.
5. Set repository Actions variable `BRIDGE_BACKUPS_ENABLED=true` to enable both
   schedules. Configure GitHub Actions failure notifications for the responsible
   operator and test one failure notification. No email/Slack recipient is hardcoded.

No automatic app release, database restore, account reset or data migration is
part of activation. Roll out staging first, then production after its verified run.

## Verify freshness and recover locally

A separate workflow, `bridge-backup-watch.yml`, checks at 06:43 and 18:43 UTC.
It fails when the last completed snapshot is missing or more than **36 hours**
old. It reads completion indexes, not DO records or quotas. This detects a missed
backup job while the freshness workflow still runs; both depend on GitHub Actions.
For an independent scheduler/provider outage alert, connect an external monitor
before promising an operations SLA. GitHub cron can be delayed/dropped and only
runs on the default branch; public-repository inactivity can also disable it.

Manual capture/check use the same code and environment lease:

```sh
mkdir -m 700 -p .wrangler/automatic-backups
npm run backup -- run --environment staging --public-key .wrangler/backup-keys/staging/public-key.pem --output .wrangler/automatic-backups/staging-first
npm run backup -- check --environment staging --public-key .wrangler/backup-keys/staging/public-key.pem
```

The private local receipt contains the `index` object key. Download the chosen
completed snapshot with the offline key, then restore into a **new local directory**:

```sh
npm run backup -- download --environment staging --private-key .wrangler/backup-keys/staging/private-key.pem --index INDEX_FROM_RECEIPT --output .wrangler/automatic-backups/staging-download
npm run backup -- restore-local --environment staging --backup .wrangler/automatic-backups/staging-download --output .wrangler/automatic-backups/staging-drill
```

Download verifies encrypted and decrypted checksums. The local restore verifies
private files/paths again, imports the actual D1 SQL using `--local`, recreates
the hub's SQL rows **before** installing its indexes/triggers (to avoid double
counting), and restores ciphertext/metadata without overwriting. It checks record
usage, chunk usage and blob references and saves `restore-verification.json`.
Miniflare persists D1, hub and R2 state under the new local directory. No live
account ID, remote binding or namespace is used for the drill. These tests also
check writer ownership and permanent tombstones after restoration. If a stored
chunk was captured in the deletion archive rather than live R2, the local drill
rehydrates its original live key and checks the original ETag/size before loading
the hub. Missing or ambiguous archive candidates stop recovery.

Run a download/local restore exercise after the first remote capture, important
schema changes and at least monthly. The offline private key is intentionally
absent from CI; an automatic public-key-only job cannot decrypt its own captures.
Do not treat a successful upload alone as proof of ongoing restore capability.

## Recovery boundaries

Account snapshots are individually coherent, but D1, accounts and R2 are captured
sequentially, not in a distributed transaction. Coordinate a maintenance window
for a single cross-store point. A native D1/DO Time Travel bookmark remains useful
as an additional short-term tool; it is no substitute for these actual copies.

The hub uses SQL plus a maintenance alarm. Ephemeral WebSocket attachments and
alarm timers are not part of the independent SQL snapshot. A future live restore
must re-arm maintenance, reconcile credentials/revocations/entitlements and
rehydrate any needed archived chunks to their original live keys before serving
records. A disaster-recovery snapshot does not revive deleted IDs as new writes.
There is deliberately no automatic live restore command.

Follow [OPERATIONS.md](OPERATIONS.md) for code rollback and live incident recovery.
Old client cursors cannot safely resume after a hub rewind without a future
generation/rebuild protocol; preserve clients and use isolated re-enrolled
profiles for controlled recovery. A tested local SQL/R2 drill is not a tested live
PITR or coordinated all-device recovery. Same-account R2 backups also share that
account/provider's availability and access risk; add a second provider later if
account-loss protection is required.

References: [SQLite cursor isolation](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[GitHub schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule),
[Wrangler API tokens](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/).
