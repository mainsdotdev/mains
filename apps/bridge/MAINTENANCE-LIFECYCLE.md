# Hub maintenance and snapshot consistency (inventory 71 + 72)

`src/hub-maintenance-lifecycle.ts` owns durable compaction admission, progress,
completion, pass limits, alarm deadline selection and the SQL snapshot fence.
`compaction.ts` selects/removes obsolete ciphertext; `hub-backup.ts` validates
the export schema and serializes pages. `AccountHub` retains the native alarm
and account concurrency boundary. No mobile code, database schema or public
sync protocol changes are introduced.

## Durable jobs

| Event / state | Transition |
| --- | --- |
| Register replaced or removed | SQL triggers queue obsolete register-log cleanup without replacing an existing job. |
| Run permanently deleted | Queue whole-stream cleanup. Keep permanent tombstones, writer bindings and sequence counters. |
| Idle-retained register accepted | Queue its stream's deadline at last accepted activity plus 30 days. |
| New accepted run activity | Move that stream's retention deadline forward in the same publication transaction. |
| Due job / pass | Discover or remove at most 128 source rows across at most 16 jobs. Use one time cutoff for the whole synchronous pass. |
| Legacy discovery / partial page | Persist its rowid cursor within the original upper bound; subsequent passes and object instances continue there. |
| Legacy discovery / end | Set `due_at` to null and retain the completed marker, preventing a new scan on restart. |
| Ordinary job / budget exhausted | Leave it queued, even when the batch may have removed the last row. A later pass proves completion. |
| Ordinary job / fewer rows removed than the remaining budget | Remove the completed job; triggers may have queued follow-up log cleanup. |
| SQL failure | Roll back removals, usage/blob-reference trigger effects, cursor changes and job completion together. Retry the original durable work. |

Retention removes only registers carrying `30d-idle`. Before each later pass,
the job's due time and the stream's last activity must still permit expiration.
New activity after a partial cleanup preserves the remaining mirrors. Visible
history, permanent deletes and stream positions are independent of this policy.
Receipt compaction remains governed by the membership replay horizon.

Fresh dirty work coalesces with the normal one-minute alarm. Remaining due work
resumes after one second; other deadlines are clamped to at least one second
ahead. Scheduling keeps any already earlier alarm. Empty passes are read-only;
they do not invent jobs or invalidate an otherwise stable SQL capture.

## Snapshot fence

| Event / state | Transition |
| --- | --- |
| Begin | Check the SQL-only export contract and allowlisted application schema, then return an opaque session token. |
| Page or final validation / unchanged state | Accept only this instance's current token. Synchronously read bounded rows; never retain a SQL cursor across `await`. |
| SQL row changes, including cleanup and trigger effects | A changed `total_changes()` retires the previous token, even if stream sequence numbers did not advance. |
| Export catalog changes | Compare the current application catalog too: adding an empty table/index does not increment `total_changes()`. A mismatched catalog retires the token. |
| Durable Object eviction/restart | A new random instance identity rejects previous tokens, even when the database contents match. |
| Unsupported schema, KV or column values | Reject the capture rather than silently omit recovery state. Platform `_cf_METADATA` stays outside application exports. |

The fence keeps only in-memory observations and writes no snapshot metadata to
SQL. An already invalid token never becomes valid again within that instance.
The existing automatic-backup runner retries changed local captures. Native
PITR bookmark and schema checks still fence the whole production capture; only
an unchanged durable bookmark permits resuming a read-only restart. These tests
do not claim to verify Cloudflare's native PITR service.

## Verification

`test/hub-maintenance.test.ts` uses actual workerd SQLite and real object
eviction. It covers deadline postponement, transaction rollback, native alarm
continuation, row/job limits, partial expiration followed by new activity,
closed-run cleanup and stable read-only captures.

`test/automatic-backup.test.ts` also verifies schema/KV refusal and restarts a
paginated export when compaction changes its source. Existing usage, hub,
blob-GC and replication tests cover bounded legacy discovery, exact accounting,
whole tombstones, source-offline reads and independent backend databases.
