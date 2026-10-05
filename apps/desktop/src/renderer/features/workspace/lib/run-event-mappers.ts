import type { RunEvent } from "../types";
import { previewParams } from "./parse-tool-content";

function parseMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  if (typeof metadata === "string") {
    try {
      return JSON.parse(metadata);
    } catch {
      return undefined;
    }
  }
  return metadata as Record<string, unknown>;
}

function parseRawInput(input: unknown): Record<string, unknown> | undefined {
  if (!input) return undefined;
  try {
    return typeof input === "string"
      ? JSON.parse(input)
      : (input as Record<string, unknown>);
  } catch {
    return undefined;
  }
}

interface MappableArtifact {
  id: number;
  runId: string;
  kind: string;
  path?: string | null;
  content?: string | null;
  contentHash?: string | null;
  metadata?: unknown;
  createdAt?: Date | string | number;
}

/** Convert a RunArtifact to a displayable RunEvent. Always returns an event (fallback on parse error). */
export function mapArtifactToEvent(artifact: MappableArtifact): RunEvent {
  try {
    const metadata = parseMetadata(artifact.metadata);
    const voiceStreamId = metadata?.voice === true && typeof metadata.streamId === "string" ? metadata.streamId : undefined;
    const voiceStartedAt = metadata?.voice === true && typeof metadata.voiceStartedAt === "number" && Number.isFinite(metadata.voiceStartedAt)
      ? metadata.voiceStartedAt : undefined;
    return {
      id: voiceStreamId ? `stream-${voiceStreamId}` : `artifact-${artifact.id}`,
      type: artifact.kind === "log" ? "log" : "artifact",
      content: artifact.content ?? artifact.path ?? JSON.stringify(artifact),
      timestamp: voiceStartedAt !== undefined ? new Date(voiceStartedAt)
        : artifact.createdAt ? new Date(artifact.createdAt) : new Date(),
      metadata: {
        ...metadata,
        kind: metadata?.source === "voice-coordinator" && metadata?.voiceTask ? "voice-task" : artifact.kind,
        ...(artifact.kind === "image" && artifact.contentHash
          ? { imageContentHash: artifact.contentHash }
          : {}),
      },
    };
  } catch {
    return {
      id: `artifact-${artifact.id}`,
      type: artifact.kind === "log" ? "log" : "artifact",
      content: artifact.content ?? artifact.path ?? String(artifact),
      timestamp: new Date(),
      metadata: { kind: artifact.kind },
    };
  }
}

/** Artifacts sort before tool calls on a timestamp tie — matches the prior
 *  full-fetch order, where artifacts were pushed into the list before tool calls. */
function eventTieRank(e: RunEvent): number {
  return e.type === "tool_call" ? 1 : 0;
}

/** Numeric source-row id embedded in an event id (`"tool-42"` → 42) for stable
 *  within-type ordering when timestamps tie (second-grained `createdAt`). */
function eventNumericId(e: RunEvent): number {
  const dash = e.id.lastIndexOf("-");
  const n = dash >= 0 ? Number(e.id.slice(dash + 1)) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** Compare JSON-like payloads without allocating two full serialized copies. */
function stableEqual(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || depth > 100) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
      a.every((value, index) => stableEqual(value, b[index], depth + 1));
  }
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(right, key) && stableEqual(left[key], right[key], depth + 1));
}

/**
 * Value-equality of two run events, used to decide whether a freshly-mapped
 * delta is actually different from the event already in the list. Tool-call
 * metadata (`input` / `output`) can be decoded into new objects on every fetch,
 * so comparing those by reference would mark every re-fetched-but-
 * unchanged row as "changed" — defeating memoization. Object values are
 * compared structurally instead.
 */
export function eventsValueEqual(a: RunEvent, b: RunEvent): boolean {
  if (a === b) return true;
  if (a.id !== b.id || a.type !== b.type || a.content !== b.content) return false;
  const am = (a.metadata ?? {}) as Record<string, unknown>;
  const bm = (b.metadata ?? {}) as Record<string, unknown>;
  const ak = Object.keys(am);
  if (ak.length !== Object.keys(bm).length) return false;
  for (const k of ak) {
    const av = am[k];
    const bv = bm[k];
    if (av === bv) continue; // primitives (status, toolName, string output) and identical refs
    if (av && bv && typeof av === "object" && typeof bv === "object") {
      if (!stableEqual(av, bv)) return false;
    } else {
      return false;
    }
  }
  return true;
}

/**
 * Merge incremental artifact + tool-call deltas into the existing event list.
 *
 * - Keyed by stable event id (artifact/tool row ids, or native voice stream ids): a delta replaces an
 *   existing event (tool-call status/output update) or appends a new one.
 * - A delta that is value-identical to the event already present keeps the
 *   existing object reference, so the downstream group reconcile + memoized rows
 *   can skip re-rendering.
 * - Returns the SAME `existing` array reference when no event actually changed —
 *   not only when there are zero deltas, but also when the `>=` tool cursor
 *   re-fetched the boundary second and every row came back identical. That keeps
 *   an idle poll a true no-op (no React state change) for tool-bearing runs.
 * - Result is timestamp-sorted with a deterministic tie-break, matching the
 *   prior full-fetch ordering.
 */
export function mergeRunEvents(
  existing: RunEvent[],
  artifactDeltas: readonly MappableArtifact[],
  toolCallDeltas: readonly MappableToolCall[],
): RunEvent[] {
  return mergeMappedRunEvents(existing, [
    ...artifactDeltas.map(mapArtifactToEvent),
    ...toolCallDeltas.map(mapToolCallToEvent).filter((event): event is RunEvent => event !== null),
  ]);
}

/** Reconcile an already mapped page without building its payloads a second time. */
export function mergeMappedRunEvents(existing: RunEvent[], incoming: readonly RunEvent[]): RunEvent[] {
  if (!incoming.length) return existing;
  const byId = new Map<string, RunEvent>();
  for (const e of existing) byId.set(e.id, e);

  let changed = false;
  const upsert = (ev: RunEvent) => {
    const prev = byId.get(ev.id);
    if (prev && eventsValueEqual(prev, ev)) return; // unchanged → keep prev reference
    byId.set(ev.id, ev);
    changed = true;
  };
  for (const event of incoming) upsert(event);
  // Re-fetched rows were all value-identical (e.g. a `>=` overlap on an idle
  // poll): nothing to render, so hand back the original reference.
  if (!changed) return existing;

  const merged = Array.from(byId.values());
  merged.sort((a, b) => {
    const dt = a.timestamp.getTime() - b.timestamp.getTime();
    if (dt !== 0) return dt;
    const dr = eventTieRank(a) - eventTieRank(b);
    if (dr !== 0) return dr;
    return eventNumericId(a) - eventNumericId(b);
  });
  return merged;
}

/**
 * Structural superset of the two tool-call row representations this app has —
 * the transcript wire rows (`../types` ToolCall) and the redux tools-API rows.
 * Accepting the union shape here is what lets every consumer pass its own
 * rows without casting between the models.
 */
export interface MappableToolCall {
  id: number;
  runId?: string | null;
  toolName: string;
  status: string;
  toolCallId?: string | null;
  parentToolCallId?: string | null;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown> | string | null;
  createdAt?: unknown;
}

/** Convert a ToolCall to a displayable RunEvent. Returns null on parse error. */
export function mapToolCallToEvent(tc: MappableToolCall): RunEvent | null {
  try {
    const input = parseRawInput(tc.input);
    const persistedMetadata = parseMetadata(tc.metadata);
    // Raw input/output have a single home. The content field is only a bounded
    // header preview, never a second serialized copy of the tool payload.
    const summary = previewParams(input);
    const content = `${tc.toolName}: ${summary}`;

    return {
      id: `tool-${tc.id}`,
      type: "tool_call",
      content,
      timestamp: tc.createdAt ? new Date(tc.createdAt as string | number | Date) : new Date(),
      metadata: {
        ...persistedMetadata,
        runId: tc.runId ?? undefined,
        status: tc.status,
        toolName: tc.toolName,
        // Set from the row's column (present from insert), unlike the
        // persisted metadata's parentToolUseId which only lands on completion.
        // The transcript grouping keys on it to keep subagent children out.
        parentToolCallId: tc.parentToolCallId ?? undefined,
        input: input ?? (typeof tc.input === "string" ? tc.input : undefined),
        output: tc.output,
      },
    };
  } catch (err) {
    console.error("Error parsing tool call:", tc, err);
    // Degraded fallback instead of dropping the row. The incremental tool cursor
    // has already advanced past this row's `updatedAt`, so returning null would
    // make it permanently invisible (a `>=` fetch never re-selects it). Render
    // what we can trust; a later in-place update re-fetches and replaces this
    // with the full event. Only plain property reads here, so it cannot throw.
    return {
      id: `tool-${tc.id}`,
      type: "tool_call",
      content: `${tc.toolName ?? "tool"}`,
      timestamp: tc.createdAt ? new Date(tc.createdAt as string | number | Date) : new Date(),
      metadata: {
        ...parseMetadata(tc.metadata),
        runId: tc.runId ?? undefined,
        status: tc.status,
        toolName: tc.toolName,
        parentToolCallId: tc.parentToolCallId ?? undefined,
      },
    };
  }
}
