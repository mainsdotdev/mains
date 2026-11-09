# Workspace editing lifecycle

Inventory families **4, 34, 88** use separate owners for native mutation,
workspace projection and the editor view. A projection failure cannot revoke a
completed native mutation, and a view change cannot retarget an admitted save.

| Owner | Transitions and admission | Implementation |
| --- | --- | --- |
| Turn Undo | Admit run → bind checkout → validate patch → apply once → mark completed → refresh. Concurrent identical requests join. A failed marker retries from the applied checkpoint without touching subsequent user edits. Live and preparing peer runs, including aliased workspace roots, block Undo. Continue/archive/delete cannot pass the run owner. | `runs/run-turn-changes-lifecycle.ts`, `runs.service.ts`, shared Git operation owner |
| Checkout mutation | One Git/Undo/scoped-editor action owns the canonical checkout. Mutation revisions invalidate reads started earlier. Native-execution admission also checks canonical aliases. | `runtime/git-operation-lifecycle.ts` |
| Workspace diff | Idle → capture/publish → optional latest follow-up → idle. Every source shares one workspace queue. A newer request retires the older publication; requests arriving at worker handoff are retained. HEAD drift causes bounded recapture; read/capture errors keep the previous row. | `workspace/workspace-diff-lifecycle.ts`, workspace service |
| Run diff source | Debounce → request shared capture → current publication. Finalization retires that source's timer/read and joins the workspace queue for its final projection. Retiring one source cannot cancel another source's refresh. | `createWorkspaceDiffScheduler`, run session |
| File write | Admit entire API call → canonical file queue → check baseline → write → acknowledge → best-effort diff refresh. All writers to one file, including symlinks, recheck the baseline inside the queue. Scoped writes also own their workspace/checkout. | `runtime/file-write-lifecycle.ts`, file explorer service |
| Editor view | Idle/dirty → saving → saved/dirty, or paused error/conflict. Retry keeps the baseline; explicit overwrite bypasses it for one revision. Reload cannot replace edits made while it waits. Save handoff cannot lose a new explicit request. | `editor-save-lifecycle.ts` |
| Editor binding | Bind backend/account/workspace/file and transport. Normal file close flushes to the captured target. Any transport swap permanently retires queued writes and UI feedback, including A → B → A. The replacement view cannot be changed by an old acknowledgement. Failed buffers remain in a scoped recovery map; old owners cannot erase newer drafts. | `use-editor-save.ts`, CodeViewer |
| Backend generation | Fence new APIs and source timers → drain admitted file writes, captures and metadata reads → close the database. New generations reopen fresh admission. | Desktop/standalone hosts and lifecycle owners |

`@mains/contracts/file-text` owns the common text-file DTOs. New clients send
both `expectedMtimeMs` and `expectedVersion`; the latter hashes file identity,
metadata and content, detecting a changed file whose old mtime was restored.
Older mtime-only clients remain supported. A native write may still race an
out-of-process writer; no cross-process filesystem transaction is claimed.

Turn attribution treats an unnamed peer write as potentially shared even when
this run named the file explicitly, including a rename's original path. A failed
shell command may already have written and retains that uncertainty. Named tool
completions that omit input reuse their known start paths rather than becoming
opaque writes. The final stored files explicitly carry `shared: false` when the
current attribution check found no sharing and `shared: true` otherwise.

`shared/turn-change-ownership.ts` is the common Undo eligibility check used by the
backend and transcript card. A shared file or an omitted ownership flag blocks
the whole reverse patch before native Git mutation. Older records have no proof
that the attribution check excluded a peer shell's edits, so they remain
reviewable but cannot be undone automatically. No historical flags are guessed
or backfilled. New verified exclusive turns retain Undo. This uses the existing
JSON field without a schema or wire-shape change.

Undo checkpoints live in the existing backend-generation journal. They do not
make patch application and SQLite atomic across a process crash. Failed marker
recovery is automatic within that generation; after a restart an uncertain Undo
requires inspection. Recovery buffers live in renderer memory, not durable
storage, and do not survive a renderer restart.

Regression tests cover real disposable Git/SQLite/filesystem operations,
controlled failures and microtask handoffs, plus the real Redux/transport editor
binding under React Strict Mode. They use no live backend profile or Git settings.
