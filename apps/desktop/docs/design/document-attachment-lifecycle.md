# Document, annotation and attachment lifecycle

Inventory items **89 + 90 + 91** share the renderer's
`features/workspace/lib/document-lifecycle.ts`. Components retain presentation
state; this module owns admission, publication authority and resource release.
No schema, wire-contract change or state-machine dependency is required.

| Owner | Transition and rule |
| --- | --- |
| Document source | Path + format + transport revision selects one source. A changed source immediately hides old content and retires its read. Preview groups belonging to another backend cannot use the active backend's file API. |
| Render attempt | Loading → ready / error → disposed. Retirement aborts first, runs every cleanup once, and fences later publication/native stages. Late native controllers are disposed on arrival. Failure disposes resources immediately; cleanup exceptions cannot skip another resource. PDF, Office and Markdown/text use the same owner. |
| PDF page | Offscreen → loading canvas/text → ready. Zoom or viewport changes retire the attempt; late paint cannot replace the newer canvas. Leaving the viewport removes canvas/text DOM while retaining the page placeholder. The shared lazy PDF worker remains session-scoped. |
| Annotation editor | Source, surface, backend revision and composer select one view. Only one capture is admitted synchronously, including two events before React updates busy state. A retired view cannot clear another draft or display a stale error. Strict Mode effect replay restores view admission safely. |
| Accepted capture | Freeze source, target geometry, comment and originating composer → capture → append to that original composer. Navigation does not retarget accepted work. DOM, canvas pixels, media URLs and document styles are snapshotted before asynchronous font/decode waits. Failure keeps the draft available for retry. |
| Upload ownership | Draft / queue / backup / submission / composer view / document tab retain independent references. Replacement compares live URL references rather than wrapper-object identity. An atomic move updates both owners before release/notification; accepted-input handoff merges surviving source files with newer target files. |
| Submission | Pending → accepted / closed. Files are snapshotted and leased before preparation. Acceptance consumes only those objects from the current draft; files added during awaits remain. Automatic text-only starts consume no attachments and transfer unsent draft files to the new run. Rejection or uncertain delivery closes the temporary lease without consuming the draft/queue. Queue receipt recovery remains with its existing delivery owner. |
| Draft-document URL | Create one URL per File → retain in composer/viewer → release when the last reference ends. Removing an attachment does not revoke an open document tab's URL. Closing the tab releases its lease; hiding retains it. Effect cleanup defers view releases until replacement effects acquire theirs, including Strict Mode replay. Foreign/signed URLs are not adopted for revocation. |

File bytes, blob URLs and leases stay outside persisted Redux/SQLite. Existing
document limits, sanitization, signed reads, per-format rendering, annotation
geometry and provider input receipts remain at their current seams.

Regression tests exercise real component/store transitions with controlled
native renderer/fetch/capture boundaries: source replacement, late PDF loading,
zoom/viewport races, cleanup failures, empty Office renders, late controllers,
capture concurrency and retargeting, frozen page capture, backend isolation,
shared previews, accepted/rejected/uncertain input, newer draft files and open
preview retention after attachment removal.
