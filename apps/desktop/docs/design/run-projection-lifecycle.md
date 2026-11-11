# Tool, task and transcript projection

Inventory families **5, 6, 16** distinguish a foreground tool call, its longer
running native task, and a live message waiting for its durable transcript row.
Each owner below controls its own transitions; one run status cannot replace
these lifetimes.

| Owner | Transitions and rules | Implementation |
| --- | --- | --- |
| Event admission | Admitted → ordered durable projection → committed or failed. SDK listeners may call concurrently; durable events retain their admission order. A failed live-session event rejects its caller; legacy writeback logs it. Neither poisons the next event. Ephemeral snapshots remain immediate. Stop/finalization fences new events and drains admitted writes before releasing the session. | `runs/run-session.ts`; legacy `runtime/writeback/runWriteback.ts` |
| Tool correlation | Absent → running → done/error/canceled. Hydration reads identities and lifecycle versions without historical tool bodies. Repeated stable starts and completed results are no-ops. Stable ids match only themselves, including legacy id aliases; they never close another same-named call. Without an id, correlation uses the oldest pending same-named call. | `runs/tool-call-projection.ts` |
| Tool commit | A result's database write precedes release of pending ownership. A failed result write stays retryable and retains its original turn. Start metadata and the running row are inserted together. Only a newly committed completion can trigger diff/write-attribution or PR side effects. Explicit provider cancellation stays canceled. | Tool projection, run repository and session side effects |
| Missing start | Live sessions ignore a completion whose start was never observed. Legacy writeback may receive standalone complete records and records those under their own identity. Both policies use the same owner; an unknown stable id never borrows a sibling's row. | Tool projection's `recordOrphans` policy |
| Native task | Started/progress/updated → completed/failed/stopped. The foreground tool may already be done while its task still runs. A native execution id, distinct from the stable agent/task id, fences old executions. Ordered Claude execution ids are compared in native order. A new execution clears old outcomes; task and subagent notifications may arrive in either order. | `runs/task-projection.ts` |
| Task settlement | A late running patch cannot reopen a terminal task/subagent. Background membership and ambient flags remain separate from outcome. Finalization settles unfinished work as completed after success or stopped after failure/cancellation, preserving explicit native failures. Id-less subagents may re-arm under a fresh session owner for continuation. | Task projection and tool settlement |
| Report persistence | Live native id → message-scoped preview id → final write admitted → committed. Admission freezes the final snapshot before awaiting SQLite, so a reused native id can already carry another message. Commit retires only its own snapshot. Failed final writes retain the full final text for recovery. Duplicate identified finals do not duplicate rows or retire a replacement message. | `runs/report-projection.ts` |
| Report recovery | Accepted writes drain before remaining parent prose is saved on completion. Interrupted prose is marked interrupted; thinking, tool status, child output and explicitly cleared previews are not recovered as parent replies. A preview retains its originating turn when known. Legacy writeback uses the same report owner and finish barrier. | Run session and legacy writeback finish |
| Client stream | Absent → streaming → settled preview → durable acknowledgement → retired. Cumulative snapshots replace their own message, retaining its first timestamp. Terminal previews ignore late deltas and empty clears. Acknowledged ids stay retired when their rows leave a loaded history window. | `@mains/contracts/transcript-stream` |
| Client scope | Conversation/backend replacement clears the old owner's state and cancels scheduled publication. Ordinary work completion settles parent prose while voice continues; voice closure drops only unfinished speech for that connection and retains completed speech until persistence. | Desktop streaming hook; shared client stream owner |
| Phone history | Durable stream identity acknowledges its own preview, even if final text differs from the last delta. Identical text in another identified message does not acknowledge it. Older servers without stream metadata retain a text fallback constrained by message time and SQLite timestamp precision. Terminal status settles live prose while history is loading. | Mobile streaming store, transcript mapping and run data hook |

The wire remains additive through existing metadata. No schema migration, new
stored drafts or startup rewrite is required. Correlation and acknowledgement
receipts are scoped to the current owner; this does not introduce a database
uniqueness guarantee across process crashes. Unidentified legacy final blocks
can only use best-effort live-prefix correlation, not content-based global
deduplication. A reused raw native id with ambiguous identical/prefix text does
not prove whether a final belongs to the old or new message; qualified message
ids provide the stronger correlation boundary.

Tests exercise actual run sessions, writeback/dispatcher APIs, disposable SQLite
databases, renderer hooks and the mobile streaming store. Deferred writes and
animation frames cover concurrent duplicate starts, stable-id isolation, retry
after a failed write, native task restart/old results, shutdown drain, report id
reuse during persistence, duplicate final reports, final-text recovery, history
acknowledgement and backend replacement. Live provider accounts and user data
are not used.
