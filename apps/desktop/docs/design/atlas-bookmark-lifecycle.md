# Atlas bookmark jobs and worker lifecycle

Inventory items **42 + 43**. The backend's `atlas.bookmark-lifecycle.ts` owns the
transition rules; `atlas.bookmarks.ts` supplies downloads, provider calls and
guarded repository checkpoints. The wire statuses and device-local JSON column
are unchanged. No schema migration or state-machine dependency is required.

| Owner | Transition and rule |
| --- | --- |
| Durable job | Save/manual enrichment creates a fresh pending id. Only due pending/interrupted-running jobs may start; ready/failed snapshots cannot restart a completed job. Failures return to pending with `15 seconds × attempts` backoff, then fail after three attempts. Manual enrichment starts a fresh forced attempt. |
| Recovery | A persisted running attempt resumes at its existing attempt count. An orderly interruption returns the same current job to pending without charging a failure. Replacement jobs and trashed/deleted items never receive that checkpoint. |
| Item identity | Account, item, URL and durable job id must still match before a write. Trash changes the incarnation of pending/running work, so restoring the same URL cannot revive its old download. Prepared edits/enrichment also observe the item's retirement revision, including ready jobs and synced bookmarks with no local job. After awaits they reject any changed item. |
| Worker | Stopped → polling/draining → stopping → stopped. One generation owns one timer, one joined drain and per-item claims. Stop closes admission synchronously, aborts HTTP and awaits all admitted preparation, processing and file cleanup. Start during stopping cannot reopen it. Saves may enqueue while the worker is stopped. |
| Queue | Filter deadlines before the 50-row page limit. Scan past malformed job shapes and already claimed items. Each drain processes at most 50 valid jobs; the periodic poll continues remaining work. |
| Consent | An accepted settings intent immediately retires prior analysis authority. Validate the chosen provider/model, then serialize guarded writes. A later opt-out wins over older validation or an already invoked write. Native generation and result publication both require current consent and the selected provider/model. Disable/re-enable cannot revive an older analysis. Generic app-settings patches cannot change this field. |
| AI checkpoint | Validate output, then atomically commit AI tag relationships, content type, successful fingerprint, provenance and ready status. A persistence failure rolls all of them back. User tags and exclusions retain their existing semantics. Metadata/preview enrichment may still succeed when tagging fails. |
| Preview | Each attempt writes a distinct derivative and synchronously publishes its pointer only while ownership remains current. Rejected/failed publication removes that attempt's file, without deleting another attempt's bytes. Permanent deletion clears all bookmark derivatives even when a refresh has already cleared the storage pointer. |
| Host | Atlas IPC unregistration returns its drain. Desktop and standalone shutdown await it before releasing SQLite, including preparation interrupted before the worker starts. |

Downloads retain their timeout, redirect/SSRF checks, size and MIME limits.
Provider text generation has no cancellation option, so shutdown fences its
result and waits for the accepted call to settle. Jobs and previews remain local
derivatives; Bridge does not enqueue enrichment on a receiving device.

Regression coverage lives in `atlas.bookmarks.test.ts` and
`serve.lifecycle.test.ts`: stale URL/terminal snapshots, duplicate drains,
retry bounds, opt-out during model discovery and generation, consent ABA,
out-of-order settings validation/writes, Trash/restore, rejected preparations,
HTTP cancellation, stop/start races, file cleanup, atomic AI rollback, queue
starvation and the host's database lease.
