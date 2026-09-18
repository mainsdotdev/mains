import { describe, it, expect } from "vitest";
import { groupEvents } from "./group-events";
import {
  buildTurnRenderRows,
  matchModelChangesToPromptGroups,
} from "./transcript-rows";
import type { RunEvent } from "../types";
import type { RunTurn } from "@/lib/redux/api";

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

function turn(turnIndex: number, model: string | null): RunTurn {
  return {
    id: turnIndex + 1,
    runId: "run-1",
    turnIndex,
    promptContent: null,
    responseContent: null,
    startedAt: null,
    endedAt: null,
    elapsedMs: null,
    status: "completed",
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    costMicros: null,
    model,
    modelUsage: null,
    metadata: null,
    changes: null,
    createdAt: turnIndex,
  };
}

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

  it("keeps an interactive visualization outside the collapsed accordion", () => {
    const events = turnWithFileWrite();
    events[2] = ev({
      id: "viz1",
      metadata: { kind: "visualization", path: "/tmp/chart.html" },
    });
    const groups = groupEvents(events);
    const visualizationIndex = groups.findIndex((group) =>
      group.events.some((event) => event.id === "viz1"),
    );
    const rows = buildTurnRenderRows(groups);
    const accordion = rows.find((row) => row.kind === "accordion");

    expect(accordion).toBeDefined();
    if (accordion?.kind !== "accordion") return;
    expect(accordion.messageBreakoutIndices).toContain(visualizationIndex);
    expect(accordion.previousSegments.flat()).not.toContain(
      visualizationIndex,
    );
  });

  it("keeps only the latest version of the same document visible", () => {
    const events = [
      ev({
        id: "u1",
        content: "create a pitch deck",
        metadata: { kind: "user-prompt" },
      }),
      ev({
        id: "d1",
        metadata: {
          kind: "document",
          path: "/work/build/preview/mains_pitch_deck.pptx",
          fileName: "mains_pitch_deck.pptx",
        },
      }),
      ev({
        id: "t1",
        type: "tool_call",
        content: "Bash: refine deck",
        metadata: { status: "done", toolName: "Bash" },
      }),
      ev({
        id: "d2",
        metadata: {
          kind: "document",
          path: "/work/final/mains-pitch-deck.pptx",
          fileName: "mains-pitch-deck.pptx",
        },
      }),
      ev({
        id: "r1",
        content: "The presentation is ready.",
        metadata: { kind: "report" },
      }),
    ];
    const groups = groupEvents(events);
    const firstDocument = groups.findIndex((group) =>
      group.events.some((event) => event.id === "d1"),
    );
    const finalDocument = groups.findIndex((group) =>
      group.events.some((event) => event.id === "d2"),
    );
    const rows = buildTurnRenderRows(groups);
    const accordion = rows.find((row) => row.kind === "accordion");

    expect(accordion).toBeDefined();
    if (accordion?.kind !== "accordion") return;
    expect(accordion.messageBreakoutIndices).toEqual([finalDocument]);
    expect(accordion.previousSegments.flat()).toContain(firstDocument);
  });
});

describe("matchModelChangesToPromptGroups", () => {
  const events = [
    ev({ id: "u1", content: "first", metadata: { kind: "user-prompt" } }),
    ev({ id: "r1", content: "one", metadata: { kind: "report" } }),
    ev({ id: "u2", content: "second", metadata: { kind: "user-prompt" } }),
    ev({ id: "r2", content: "two", metadata: { kind: "report" } }),
    ev({ id: "u3", content: "third", metadata: { kind: "user-prompt" } }),
  ];

  it("places a change marker on the prompt that starts the new model turn", () => {
    const groups = groupEvents(events);
    const secondPrompt = groups.findIndex((group) =>
      group.events.some((event) => event.id === "u2"),
    );

    const changes = matchModelChangesToPromptGroups(groups, [
      turn(0, "gpt-5.6-sol"),
      turn(1, "gpt-5.6-terra"),
      turn(2, "gpt-5.6-terra"),
    ]);

    expect([...changes.entries()]).toEqual([
      [
        secondPrompt,
        { fromModel: "gpt-5.6-sol", toModel: "gpt-5.6-terra" },
      ],
    ]);
  });

  it("does not guess across missing historical model data", () => {
    const groups = groupEvents(events);
    const changes = matchModelChangesToPromptGroups(groups, [
      turn(0, "gpt-5.6-sol"),
      turn(1, null),
      turn(2, "gpt-5.6-terra"),
    ]);

    expect(changes.size).toBe(0);
  });
});
