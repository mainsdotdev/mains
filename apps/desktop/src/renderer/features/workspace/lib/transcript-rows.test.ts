import { describe, it, expect } from "vitest";
import { groupEvents } from "./group-events";
import { buildTurnRenderRows } from "./transcript-rows";
import type { RunEvent } from "../types";

function ev(partial: Partial<RunEvent> & { id: string }): RunEvent {
  return {
    type: "artifact",
    content: "",
    timestamp: new Date(partial.id.length * 1000),
    ...partial,
  };
}

/**
 * A turn with enough segments to collapse: prompt, a Write, a reply, then a
 * second reply. Everything before the last reply is what the accordion hides.
 */
function turnWithFileWrite(): RunEvent[] {
  return [
    ev({ id: "u1", content: "write the list", metadata: { kind: "user-prompt" } }),
    ev({
      id: "w1",
      type: "tool_call",
      content: "Write: list.md",
      metadata: { status: "done", toolName: "Write" },
    }),
    ev({ id: "r1", content: "created it", metadata: { kind: "report" } }),
    ev({ id: "r2", content: "anything else?", metadata: { kind: "report" } }),
  ];
}

const writeGroupIndex = (groups: ReturnType<typeof groupEvents>) =>
  groups.findIndex((g) => g.events.some((e) => e.id === "w1"));

describe("buildTurnRenderRows — deliverable breakout", () => {
  it("collapses a file write into the accordion by default", () => {
    const groups = groupEvents(turnWithFileWrite());
    const rows = buildTurnRenderRows(groups);
    const accordion = rows.find((r) => r.kind === "accordion");

    expect(accordion).toBeDefined();
    if (accordion?.kind !== "accordion") return;
    expect(accordion.messageBreakoutIndices).not.toContain(
      writeGroupIndex(groups),
    );
    expect(accordion.previousSegments.flat()).toContain(writeGroupIndex(groups));
  });

  it("keeps it visible when the caller calls it a deliverable", () => {
    const groups = groupEvents(turnWithFileWrite());
    const rows = buildTurnRenderRows(groups, {
      isDeliverableGroup: (g) =>
        g.events.some((e) => e.metadata?.toolName === "Write"),
    });
    const accordion = rows.find((r) => r.kind === "accordion");

    expect(accordion).toBeDefined();
    if (accordion?.kind !== "accordion") return;
    expect(accordion.messageBreakoutIndices).toContain(writeGroupIndex(groups));
    expect(accordion.previousSegments.flat()).not.toContain(
      writeGroupIndex(groups),
    );
  });
});
