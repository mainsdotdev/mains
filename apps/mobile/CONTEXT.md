# Mains Mobile

Domain vocabulary for the native control surface that follows a run on a paired Mains backend.

## Language

**Connection recovery**:
Each WebSocket handshake has a 10-second deadline. The supervisor allows at most 30 seconds of visible recovery, including initial snapshot sync, then holds `unreachable` without a spinner while probing saved endpoints after 30-second waits. A previously successful address rotates after repeated failed opens too; address rotation does not restart the recovery budget. Manual retry, a network recovery/change signal, or returning to the foreground bypasses the wait. Offline/background states cancel sockets and retry timers; foreground restarts them. Authorization and protocol failures remain terminal until re-pairing or an update. Late socket callbacks and superseded sync attempts cannot change the replacement connection or acknowledge its pending commands.
_Avoid_: An unlimited Reconnecting spinner, retrying only a previously reachable IP forever, reporting Live before sync completes, retry timers while offline/backgrounded, reviving a disposed socket through late native events.

**History window**:
A disposable, bounded page of chronological artifacts and tool calls for the
conversation being viewed. Phone windows are bounded by row count and encoded
bytes, including a single prompt with many tools. Large bodies use previews and
an explicit chunk reader; full history remains on the backend. Startup and
background status events synchronize conversation metadata rather than history.
_Avoid_: Downloading all history, treating a prompt-count limit as a data-size
limit, accumulating full tool output while reading chunks.

**Transcript scroll**:
Touching the transcript pauses native chasing without freezing its history window. Only an upward departure beyond 80pt from the inset-aware end leaves following mode; returning near the actual end restores it when no newer page is missing. A single floating arrow is offered beyond 220pt or when a historical window has newer messages. Streaming growth and programmatic jumps do not flash the arrow. Drag/momentum intent gates automatic paging by direction, while anchor corrections reset motion tracking. Pages that fit the viewport use the explicit earlier/newer load controls, so rubber-band bounces cannot replace them. `features/runs/lib/transcript-scroll.ts` owns these decisions independently of native rendering.
_Avoid_: Freezing history at touch-down, inserting a Jump to latest row into the transcript, treating programmatic offsets as user gestures, chasing the end during deceleration.

**Execution progress**:
The active turn's saved `metadata.codexPlan` checklist, read from the bounded history window. Structural progress takes precedence over legacy TodoWrite/UpdateTodos or TaskCreate/TaskUpdate calls. A completed checklist, an older turn, a child agent and a historical reading window never supply live progress. The shared parser lives in `@mains/contracts/run-progress`.
_Avoid_: Fake plan tool calls, carrying a prior turn's plan into a continuation, interpreting a plan proposal as execution progress.

**Turn changes**:
A completed turn's stored working-tree change summary, attached below its own final visible transcript row and outside collapsed execution details. Persisted turn ids determine ownership; legacy chronological fallback is used only when unambiguous. Code and Work show these summaries; Chat does not. Compact rows show desktop file-type icons from `@mains/icons/file-icons`, the filename, its nearest two folders, and green/red addition/deletion counts. Full paths and rename/shared status remain available to accessibility. Tapping a row opens `/file-diff` for that backend, run, turn and exact file path, with line numbers, colored rows and word emphasis from the shared native `DiffBody`. The generic Review diff action stays hidden. File previews may be omitted to keep a page bounded, while `fileCount` retains the total and directs users to desktop. The viewer scans `runs:readHistoryContent` (`source: "turn-diff"`) in 8192-character chunks, retaining only a bounded line and the selected file's visible page (160 rows or about 32K characters). Bookmarks preserve Unicode offsets and hunk numbering; previous pages are reread instead of accumulating text. Lines above 16K characters are visibly shortened. Binary changes direct users to desktop; pure renames/mode changes show an empty-line-change message. Leaving the screen or switching backends cancels further chunk reads. No live file reads or filesystem/git mutation access are needed.
_Avoid_: Fetching full patches in background history sync, showing a partially viewed historical turn as complete, mixing changes from adjacent turns, duplicating bodies in the turn cache.

**Conversation settings**:
The model, reasoning effort, permissions, speed, Plan and Goal selected for the
next message in one conversation. Existing chats read and write the backend's
`runs.configSnapshot.conversationSettings`; editing them leaves the active turn
and provider defaults untouched. A new chat has phone-owned draft preferences.
New drafts inherit the last accepted preferences for their backend/provider,
with Plan and Goal off. Opening an older chat does not replace those defaults. Composer permission, Plan and Goal controls follow the conversation mode using the shared `MODE_COMPOSER_CONTROLS`; changing the selected space does not change an existing chat's mode. Speed stays available through Run options in Work/Chat.
_Avoid_: Provider-wide composer settings, using a new-chat model when resuming a
chat, caching credentials as conversation preferences.

**Conversation output**:
Both conversation toolbars show Outputs only when an available output is known. The shared `useRunHasOutputs` hook checks bounded descriptor pages on focus, reconnect, status changes and delivered-file changes; it stops at the first available file. Prompt attachments do not count. Cached metadata supplies the offline fallback, while a successful empty response hides stale entries. The home toolbar shrinks when the action is absent.

A file selected by the backend's canonical completed-turn deliverable rules, addressed by run and artifact id. Outputs opens a paged list; transcript file cards and local document links open the same viewer. `runs:listOutputs` returns path-free descriptors, and `runs:readOutputFile` transfers at most 128 KiB per call under a stable file version. Selected regular files are limited to 100 MiB. PDF and Office formats use the local iOS Quick Look module; images, Markdown and text render in the app. Other formats can be shared. Downloads stream into temporary files, commit only after full verification, and live in a 200 MiB filesystem cache isolated by backend, run and version; SQLite stores metadata and cache references only. Downloaded files remain available offline, subject to OS cache eviction. Forgetting a backend cancels its downloads and removes its files. A conversation the Mac reports deleted loses its rows, cached copies and running downloads; one that is archived or only ages out of the phone's run list keeps them. Duplicate document-link names require choosing an output explicitly.
_Avoid_: Exposing arbitrary host paths, syncing file bytes with transcript history, accumulating a whole binary in JavaScript, caching partial downloads, using a different run's output to resolve a link.

HTML files (`.html`, `.htm`, `.xhtml` or an HTML MIME type) and `visualization` artifacts currently show a static **See on desktop** notice. They have no mobile preview, download, share or offline-open action. This applies to transcript cards, the output list, local document links and direct file routes, including previously cached HTML files. Ordinary external web links keep their existing behavior.

**Prompt document attachment**:
A document sent with a user message, identified by its durable `attachmentId` and owning run. Prompt cards retain filenames, MIME types and sizes; no document bytes or host paths enter the history projection. Document-only messages remain visible, and optimistic cards say Sending until the stored prompt replaces them. Tapping a durable card opens the common file viewer through `runArtifacts:describeAttachmentFile` and `runArtifacts:readAttachmentChunk`. The same bounded downloader, 200 MiB cache and native preview/share UI serve uploads and generated outputs, while attachment cache keys and SQLite metadata stay distinct. Forgetting a backend or deleting its run removes both kinds of copies. Legacy documents without an attachment id show Preview unavailable; they never become arbitrary filesystem reads. HTML attachments retain See on desktop.
_Avoid_: Resolving attachments by filename, mixing uploads into generated outputs, reading whole originals with history, making a document disappear when its message has no text.

Older paired backends may permit `runArtifacts:readAttachmentFile` but lack the chunk endpoints. On an explicit open, the phone can use that existing original-file reader only for a cached descriptor with a known size up to 2 MiB. A bounded, short-lived in-memory copy feeds the same chunked disk writer and is released when complete; it never enters history or SQLite. Larger/unknown-size originals require updating and restarting the desktop. Real lookup/permission errors do not trigger compatibility reads. New backends keep the chunk protocol.

**MCP form**:
A pending elicitation request with a flat field schema. The phone caches the request schema with its approval, while entered values stay local to that request. Desktop, mobile and backend share `@mains/contracts/mcp-elicitation` for defaults, typed input conversion and validation. Unsupported or unavailable schemas block submission. Submit sends typed JSON in the existing approval answer; Cancel sends `approved: false, answer: "cancel"`, and Decline sends `approved: false`.
_Avoid_: Caching form answers, treating an unreadable schema as an empty confirmation, offering a session grant when the request forbids one.

**Optimistic prompt**:
A phone-local prompt shown from send until the backend's durable copy can replace it without a visible jump.
_Avoid_: Temporary message, fake prompt

**Durable prompt**:
The backend-owned prompt persisted into the phone's synchronized run transcript.
_Avoid_: Server message, real prompt

**Prompt handoff**:
The acknowledgement protocol that moves an **Optimistic prompt** from the composer into the transcript and swaps in its **Durable prompt** twin.
_Avoid_: Send animation, bubble animation

## Relationships

- A **Prompt handoff** begins with exactly one **Optimistic prompt**.
- A successful **Prompt handoff** ends when one **Durable prompt** replaces its local twin.
- A failed continuation rolls back its **Optimistic prompt** and restores the composer source.

## Example dialogue

> **Dev:** "What if the Durable prompt syncs while the Prompt handoff is still flying?"
> **Domain expert:** "Hold the Durable prompt out of the transcript until the Optimistic prompt lands, then swap the twins."

## Flagged ambiguities

- "Prompt flight" names only the optional visual motion inside a **Prompt handoff**, not the full acknowledgement protocol.
