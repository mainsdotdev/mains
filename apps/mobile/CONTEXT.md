# Mains Mobile

Domain vocabulary for the native control surface that follows a run on a paired Mains backend.

## Language

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
