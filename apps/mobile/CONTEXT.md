# Mains Mobile

Domain vocabulary for the native control surface that follows a run on a paired Mains backend.

## Language

**History window**:
A disposable, bounded page of chronological artifacts and tool calls for the
conversation being viewed. Phone windows are bounded by row count and encoded
bytes, including a single prompt with many tools. Large bodies use previews and
an explicit chunk reader; full history remains on the backend. Startup and
background status events synchronize conversation metadata rather than history.
_Avoid_: Downloading all history, treating a prompt-count limit as a data-size
limit, accumulating full tool output while reading chunks.

**Execution progress**:
The active turn's saved `metadata.codexPlan` checklist, read from the bounded history window. Structural progress takes precedence over legacy TodoWrite/UpdateTodos or TaskCreate/TaskUpdate calls. A completed checklist, an older turn, a child agent and a historical reading window never supply live progress. The shared parser lives in `@mains/contracts/run-progress`.
_Avoid_: Fake plan tool calls, carrying a prior turn's plan into a continuation, interpreting a plan proposal as execution progress.

**Turn changes**:
A completed turn's stored working-tree change summary, attached below its own final visible transcript row and outside collapsed execution details. Persisted turn ids determine ownership; legacy chronological fallback is used only when unambiguous. Code and Work show these summaries; Chat does not. File previews may be omitted to keep a page bounded, while `fileCount` retains the total. Review reads the stored patch using `runs:readHistoryContent` with `source: "turn-diff"` in 8192-character chunks, scoped by run and turn, without accumulating the whole patch or granting filesystem/git mutation access.
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
A file selected by the backend's canonical completed-turn deliverable rules, addressed by run and artifact id. Outputs opens a paged list; transcript file cards and local document links open the same viewer. `runs:listOutputs` returns path-free descriptors, and `runs:readOutputFile` transfers at most 128 KiB per call under a stable file version. Selected regular files are limited to 100 MiB. PDF and Office formats use the local iOS Quick Look module; images, Markdown and text render in the app. Other formats can be shared. Downloads stream into temporary files, commit only after full verification, and live in a 200 MiB filesystem cache isolated by backend, run and version; SQLite stores metadata and cache references only. Downloaded files remain available offline, subject to OS cache eviction. Forgetting a backend cancels its downloads and removes its files. Duplicate document-link names require choosing an output explicitly.
_Avoid_: Exposing arbitrary host paths, syncing file bytes with transcript history, accumulating a whole binary in JavaScript, caching partial downloads, using a different run's output to resolve a link.

HTML files (`.html`, `.htm`, `.xhtml` or an HTML MIME type) and `visualization` artifacts currently show a static **See on desktop** notice. They have no mobile preview, download, share or offline-open action. This applies to transcript cards, the output list, local document links and direct file routes, including previously cached HTML files. Ordinary external web links keep their existing behavior.

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
