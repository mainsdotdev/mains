# Transcript history, viewport and refresh lifecycle

Inventory **94 + 95 + 56** uses two portable owners:
`packages/contracts/src/transcript-history.ts` for window transitions and request
ordering, and `transcript-viewport.ts` for scroll intent and page/anchor ownership.
Desktop React state and mobile SQLite remain separate adapters. No migration,
new wire field or runtime dependency is required.

| Owner | Transition and rule |
| --- | --- |
| History window | Unloaded → latest loading → confirmed latest / failed. A confirmed empty page is loaded too. Older/newer navigation replaces the bounded window; refresh reads its current bounds. Requests build cursors at dispatch, after earlier navigation commits. |
| Reading | Following → paused freezes the exclusive end after the last confirmed row, including timestamp ties. A pause made during a pending read survives completion. Paused latest remains a live window; only explicit navigation can make it historical. Returning to the loaded end clears the bound only when no newer page is missing. |
| Failed read/write | Retain the confirmed events, turns and bounds; publish error and the failed direction. Explicit Retry repeats that direction from the confirmed window. A live refresh does not silently replay failed navigation. SQLite replacement is transactional, so insertion failure rolls back deletions and retains the previous projection. |
| Per-transcript queue | Idle → queued → reading/committing → next job / idle. One writer per backend/run; different conversations proceed independently. Adjacent waiting refreshes join one promise. Directional requests form ordering barriers, so a burst of live refreshes cannot overtake navigation. Failure rejects its own waiter without discarding subsequent admitted jobs. |
| Request retirement | Forget, cache eviction, backend replacement, transport detach or component disposal retires the corresponding generation. Release pending waiters immediately; native work may finish later but its aborted signal prevents writes, errors and metadata publication. A new owner need not wait for the abandoned native request. A → B → A never revives A's earlier work. |
| Retention | Retain at most four confirmed windows and their navigation metadata. In-progress first loads remain independent of already confirmed windows. Desktop prunes event/turn maps with the same LRU; mobile keeps its existing disposable row projection. Evicted windows reopen on latest, with a fresh latest revision so an old saved viewport cannot override the landing. |
| View paging | Idle → page pending → anchor pending / idle. One page per visible view. Capture a stable row identity and its offset before preparation. View replacement/hiding/disposal retires both the page and its anchor; an old finally or landing callback cannot unlock or move the replacement view. |
| Tail landing | Requesting latest pauses automatic chasing while preparation is pending. Confirmed latest lands at the tail; failure leaves the reading position intact. Opening an already paused/historical view preserves its position. Content resize follows only a pinned visible view. |
| Physical scroll | Follow tail ↔ reader paused; native drag/momentum pauses chasing until settlement. Use the actual inset-aware end, an 80px/pt pin threshold and a 220pt mobile jump threshold. A touch alone does not freeze history. Programmatic positioning and anchor restoration rebase motion; automatic paging follows movement direction. Short pages use explicit controls rather than rubber-band paging. |

`use-run-history.ts` maps desktop pages into events/turns and observes transport
changes. `use-workspace-runs.ts` delegates refresh coalescing to that owner;
`run-cache.ts` retains LRU/loaded/finalization bookkeeping only.
`use-transcript-scroll.ts` measures DOM rows and applies viewport decisions.

On mobile, `backend/run-history.ts` owns the bounded metadata store and shares
the queue with `backend/sync.ts`. Sync checks retirement after metadata and
history reads and before projection/metadata publication. Detaching run-event
subscriptions retires that transport's pending history work; forgetting a
backend also retires jobs that have not started yet. `run-view.tsx` retains
native layout and scrolling adapters and uses the same page lease for late
completion/cleanup protection. Its Retry control carries the failed direction.

Tests exercise real desktop hooks and measured DOM rows, shared gesture
decisions, and the production mobile sync/migration/Drizzle code over disposable
SQLite. Only native Expo storage/filesystem boundaries and remote transport are
controlled. Coverage includes ordering/coalescing, failure recovery, transactional
rollback, late results, cache eviction, backend replacement, reading pauses,
stable anchors, direction-aware paging and confirmed latest landing. No live app
profile or device database is used.
