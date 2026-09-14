import type { RunEvent, RunArtifact, ToolCall } from "../types";
import { formatToolData } from "./format-tool-data";
import { parseToolContent } from "./parse-tool-content";

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

/** Convert a RunArtifact to a displayable RunEvent. Always returns an event (fallback on parse error). */
export function mapArtifactToEvent(artifact: RunArtifact): RunEvent {
  try {
    return {
      id: `artifact-${artifact.id}`,
      type: artifact.kind === "log" ? "log" : "artifact",
      content: artifact.content || artifact.path || JSON.stringify(artifact),
      timestamp: artifact.createdAt ? new Date(artifact.createdAt) : new Date(),
      metadata: { ...parseMetadata(artifact.metadata), kind: artifact.kind },
    };
  } catch {
    return {
      id: `artifact-${artifact.id}`,
      type: artifact.kind === "log" ? "log" : "artifact",
      content: artifact.content || artifact.path || String(artifact),
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

/** Structural equality fallback for object-valued metadata (e.g. a tool call's
 *  `parsed` / `input`), which is rebuilt fresh on every map so reference
 *  equality always fails. Plain JSON-ish metadata only; guarded for safety. */
function stableEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Value-equality of two run events, used to decide whether a freshly-mapped
 * delta is actually different from the event already in the list. Tool-call
 * metadata (`input` / `parsed`) is a new object on every `mapToolCallToEvent`
 * call, so comparing those by reference would mark every re-fetched-but-
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
 * - Keyed by stable event id (`artifact-{id}` / `tool-{id}`): a delta replaces an
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
  artifactDeltas: RunArtifact[],
  toolCallDeltas: ToolCall[],
): RunEvent[] {
  if (artifactDeltas.length === 0 && toolCallDeltas.length === 0) {
    return existing;
  }
  const byId = new Map<string, RunEvent>();
  for (const e of existing) byId.set(e.id, e);

  let changed = false;
  const upsert = (ev: RunEvent) => {
    const prev = byId.get(ev.id);
    if (prev && eventsValueEqual(prev, ev)) return; // unchanged → keep prev reference
    byId.set(ev.id, ev);
    changed = true;
  };
  for (const a of artifactDeltas) upsert(mapArtifactToEvent(a));
  for (const tc of toolCallDeltas) {
    const ev = mapToolCallToEvent(tc);
    if (ev) upsert(ev);
  }
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
    const inputDisplay = formatToolData(tc.input);
    const outputDisplay = formatToolData(tc.output);
    const persistedMetadata = parseMetadata(tc.metadata);
    const content = `${tc.toolName}: ${inputDisplay}${outputDisplay ? `\n→ ${outputDisplay}` : ""}`;

    return {
      id: `tool-${tc.id}`,
      type: "tool_call",
      content,
      timestamp: tc.createdAt ? new Date(tc.createdAt as string | number | Date) : new Date(),
      metadata: {
        ...persistedMetadata,
        status: tc.status,
        toolName: tc.toolName,
        // Set from the row's column (present from insert), unlike the
        // persisted metadata's parentToolUseId which only lands on completion.
        // The transcript grouping keys on it to keep subagent children out.
        parentToolCallId: tc.parentToolCallId ?? undefined,
        input: parseRawInput(tc.input),
        output: tc.output,
        // Pre-parsed once at event-creation time so `ToolCallItem` doesn't
        // re-`JSON.parse` the content string on every render.
        parsed: parseToolContent(content),
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
        status: tc.status,
        toolName: tc.toolName,
        parentToolCallId: tc.parentToolCallId ?? undefined,
      },
    };
  }
}
