# Bridge local hub

B3–B5's Cloudflare Worker, account-scoped SQLite Durable Object and private R2 bucket. Desktop and
standalone backends seal records before sending them over WebSocket. The hub
stores routing headers and ciphertext; it never receives an account key or a
plaintext record body. Desktop and standalone startup activate background sync
only when an explicit development configuration exists. Without it, today's
local execution and iPad remote control continue unchanged.

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
signing secret. App sign-in, registration, device approval, key persistence and
recovery are B7. The dev token and the E2EE account key are separate credentials.

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

`test:replication` runs all 53 core integration scenarios against the actual Worker
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
never reach the hub. Production identity/key ceremonies remain B7.

Attachment membership is checked before resolving bytes. Inline artifact blobs
are externalized, and explicit file artifacts and selected turn outputs use the
same transport. Turn-end output snapshots stay in `bridge/uploads` until ACK;
the selected-output manifest lives on its existing reply anchor. Replica views
rebuild that projection and open cached images/documents without touching A's
paths. Collection source files also resolve lazily. Atlas's file adapter is
tested behind the existing gate; normal Atlas replication remains disabled.
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
