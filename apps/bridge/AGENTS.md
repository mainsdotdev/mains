# AGENTS.md

This app owns the Bridge hub: a Cloudflare Worker and one SQLite Durable Object
per account. Read `README.md`, `../../docs/design/bridge.md` and the Bridge
vocabulary in `../desktop/CONTEXT.md` before changing replication rules.

Run commands from `apps/bridge`: `npm install`, `npm run dev:setup`, `npm run dev`,
`npm test`, `npm run test:replication`, `npm run test:hosts`, `npm run typecheck`, `npm run lint` and
`npm run build` (a local dry run). Network replication tests also need the
backend dependencies installed and `better-sqlite3` built for the current Node.
`test:hosts` and `dev:demo` need `apps/server` and the desktop web renderer built.
The demo uses disposable profiles; stop its source before handing that same
profile to Electron with `MAINS_DEV_USER_DATA`. Never bypass ownership locks.

- Production code imports `@mains/contracts`, never `@mains/backend` or Electron.
- The hub reads routing headers only. Account keys, decrypted rows, table names
  and application primary keys belong on backends, outside this app.
- R2 contains immutable ciphertext chunks only. Blob capabilities bind account,
  object, chunk, operation, length and expiry; keep filenames/MIME inside E2EE.
- Preserve whole permanent tombstones, register compaction, stream cursors and
  authenticated writer ownership. Validate a complete frame before mutating SQL.
- Use plain function/object helpers. Cloudflare's required Durable Object class
  is the runtime boundary, not a domain-service pattern.
- B7 uses Better Auth, D1 backend credentials and approval/recovery ceremonies.
  Only approved, unexpired credentials can use log/R2; recheck existing sockets
  and capabilities after revocation. Keep dev-token support explicitly gated
  and all secrets/local state ignored.
- B8 quota decisions, reservations, upload admission/receipts and GC share the
  account concurrency gate. R2 PUT I/O runs outside that gate, protected by a
  durable upload intent: active uploads stay charged and cannot be collected.
  Reconcile interrupted intents before releasing reservations after restart.
  Reads and tombstones stay available; rejected writes remain queued on backends.
  D1 plan overrides require migration 0003. Keep quota responses content-free.
- Tombstones bypass quota and subscription, not every bound: keep the push-time
  size cap (`BRIDGE_MAX_DELETE_BYTES`) and their separate per-backend rate bucket.
  Refuse records clocked beyond `BRIDGE_MAX_CLOCK_SKEW_MS` with `clockSkew` and the hub's
  time; clients re-stamp their refused clocks at that bound rather than wait.
- The monthly fair-use write budget (`write_budget`, `BRIDGE_RECORDS_PER_MONTH`)
  is monitoring only: count accepted upserts once per publication, log
  `bridge.write_budget` at 80%/100%, and never refuse writes or expose it in plans.
- `test/local-hub.mjs` starts the real Worker in workerd with temporary durable
  stores. Reuse the backend's B2 scenarios for network/E2EE regression coverage.

Keep this file byte-identical to `CLAUDE.md` apart from its heading.
