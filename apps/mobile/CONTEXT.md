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

**Conversation settings**:
The model, reasoning effort, permissions, speed, Plan and Goal selected for the
next message in one conversation. Existing chats read and write the backend's
`runs.configSnapshot.conversationSettings`; editing them leaves the active turn
and provider defaults untouched. A new chat has phone-owned draft preferences.
New drafts inherit the last accepted preferences for their backend/provider,
with Plan and Goal off. Opening an older chat does not replace those defaults.
_Avoid_: Provider-wide composer settings, using a new-chat model when resuming a
chat, caching credentials as conversation preferences.

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
