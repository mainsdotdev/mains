import { describe, it, expect } from "vitest";
import { mergeRunEvents, mapArtifactToEvent, mapToolCallToEvent } from "./run-event-mappers";
import type { RunArtifact, ToolCall } from "../types";

function artifact(id: number, content: string, sec: number): RunArtifact {
  return {
    id,
    runId: "r1",
    kind: "report",
    content,
    createdAt: new Date(sec * 1000),
  } as RunArtifact;
}

function toolCall(
  id: number,
  status: string,
  sec: number,
  updatedSec: number,
  output?: string,
): ToolCall {
  return {
    id,
    runId: "r1",
    toolName: "Read",
    status,
    output,
    createdAt: new Date(sec * 1000),
    updatedAt: new Date(updatedSec * 1000),
  } as ToolCall;
}

describe("mergeRunEvents", () => {
  it("returns the same array reference when there are no deltas", () => {
    const existing = [mapArtifactToEvent(artifact(1, "hi", 10))];
    expect(mergeRunEvents(existing, [], [])).toBe(existing);
  });

  it("appends a new artifact and preserves unchanged references", () => {
    const e1 = mapArtifactToEvent(artifact(1, "hi", 10));
    const existing = [e1];
    const result = mergeRunEvents(existing, [artifact(2, "yo", 11)], []);
    expect(result).not.toBe(existing);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(e1); // unchanged event keeps its reference
    expect(result[1].id).toBe("artifact-2");
  });

  it("replaces a tool call in place when it updates (no duplicate, fresh ref)", () => {
    const t1 = mapToolCallToEvent(toolCall(1, "running", 10, 10))!;
    const existing = [t1];
    const result = mergeRunEvents(existing, [], [toolCall(1, "done", 10, 12, "result")]);
    expect(result).toHaveLength(1); // replaced by id, not appended
    expect(result[0]).not.toBe(t1); // changed → new reference
    expect(result[0].metadata?.status).toBe("done");
  });

  it("is a no-op when the >= cursor re-fetches a value-identical tool call", () => {
    // The second-grained `gte` cursor re-returns the boundary second every poll.
    // A re-mapped row is a fresh object with fresh `parsed`/`input` metadata, but
    // its VALUE is unchanged — so the merge must keep the existing reference and
    // hand back the same array, or every idle poll would re-render the live tail.
    const t1 = mapToolCallToEvent(toolCall(1, "running", 10, 10))!;
    const existing = [t1];
    const result = mergeRunEvents(existing, [], [toolCall(1, "running", 10, 10)]);
    expect(result).toBe(existing); // same array reference → React bails
    expect(result[0]).toBe(t1); // same event reference → memoized row bails
  });

  it("orders by timestamp with artifact-before-tool tie-break", () => {
    const result = mergeRunEvents([], [artifact(5, "a", 100)], [toolCall(3, "done", 100, 100)]);
    expect(result.map((e) => e.id)).toEqual(["artifact-5", "tool-3"]);
  });

  it("interleaves deltas into the existing list in timestamp order", () => {
    const eOld = mapArtifactToEvent(artifact(1, "old", 10));
    const result = mergeRunEvents(
      [eOld],
      [artifact(2, "mid", 5)],
      [toolCall(3, "done", 20, 20)],
    );
    expect(result.map((e) => e.id)).toEqual(["artifact-2", "artifact-1", "tool-3"]);
    expect(result[1]).toBe(eOld); // existing event still reused
  });

  it("keeps (does not drop) a tool delta whose full mapping throws", () => {
    // A row whose output/input can't be formatted must still surface — the
    // cursor has advanced past it, so dropping it would lose it forever.
    const exploding = { get content(): string { throw new Error("boom"); } };
    const tc = {
      id: 9,
      runId: "r1",
      toolName: "Read",
      status: "done",
      output: exploding,
      createdAt: new Date(30 * 1000),
      updatedAt: new Date(30 * 1000),
    } as unknown as ToolCall;
    const result = mergeRunEvents([], [], [tc]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("tool-9");
  });
});

describe("mapToolCallToEvent", () => {
  it("carries persisted plan status metadata into the rendered event", () => {
    const tc = {
      ...toolCall(7, "done", 10, 12),
      toolName: "ExitPlanMode",
      metadata: { planStatus: "applied", phase: "complete" },
    } as ToolCall;

    const ev = mapToolCallToEvent(tc);

    expect(ev?.metadata).toMatchObject({
      planStatus: "applied",
      phase: "complete",
      status: "done",
      toolName: "ExitPlanMode",
    });
  });

  it("returns a degraded fallback event (never null) when mapping throws", () => {
    const exploding = { get content(): string { throw new Error("boom"); } };
    const tc = {
      id: 9,
      runId: "r1",
      toolName: "Read",
      status: "done",
      output: exploding,
      createdAt: new Date(30 * 1000),
      updatedAt: new Date(30 * 1000),
    } as unknown as ToolCall;
    const ev = mapToolCallToEvent(tc);
    expect(ev).not.toBeNull();
    expect(ev!.id).toBe("tool-9");
    expect(ev!.type).toBe("tool_call");
    expect(ev!.metadata?.status).toBe("done");
  });
});

describe("mapToolCallToEvent parent linkage", () => {
  it("exposes the row's parentToolCallId on event metadata", () => {
    const call = {
      ...toolCall(7, "done", 10, 10),
      toolCallId: "toolu_child",
      parentToolCallId: "toolu_parent",
    } as ToolCall;

    const event = mapToolCallToEvent(call);
    expect(event?.metadata?.parentToolCallId).toBe("toolu_parent");
  });

  it("leaves parentToolCallId undefined for top-level calls", () => {
    const event = mapToolCallToEvent(toolCall(8, "done", 10, 10));
    expect(event?.metadata?.parentToolCallId).toBeUndefined();
  });
});

