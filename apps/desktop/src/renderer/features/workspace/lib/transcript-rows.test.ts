import { describe, it, expect } from "vitest";
import { groupEvents } from "./group-events";
import {
  buildTurnRenderRows,
  matchModelChangesToPromptGroups,
  matchTurnsToGroups,
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
  it("leaves compaction visible in chronological order between collapsed activity on both sides", () => {
    const groups = groupEvents([
      ev({ id: "u", metadata: { kind: "user-prompt" } }),
      ev({ id: "r1", content: "Before", metadata: { kind: "report" } }),
      ev({ id: "t1", type: "tool_call", metadata: { status: "done" } }),
      ev({ id: "r2", content: "Before again", metadata: { kind: "report" } }),
      ev({ id: "c", type: "log", content: "Context compacted", metadata: { source: "context_compaction", level: "info" } }),
      ev({ id: "r3", content: "After", metadata: { kind: "report" } }),
      ev({ id: "t2", type: "tool_call", metadata: { status: "done" } }),
      ev({ id: "r4", content: "After again", metadata: { kind: "report" } }),
    ]);
    const rows = buildTurnRenderRows(groups);
    expect(rows.map((row) => row.kind)).toEqual(["flat", "accordion", "flat", "accordion"]);
    expect(rows[2]).toEqual({ kind: "flat", indices: [4] });
    const before = rows[1];
    const after = rows[3];
    expect(before.kind === "accordion" && [...before.previousSegments.flat(), ...before.lastSegment]).toEqual([1, 2, 3]);
    expect(after.kind === "accordion" && [...after.previousSegments.flat(), ...after.lastSegment]).toEqual([5, 6, 7]);
  });

  // Every mode now: the file is reachable from its artifact card and from
  // the agent's own prose link, so the write row has nothing left to offer
  // that would justify a place outside the accordion.
  it("collapses a file write into the accordion", () => {
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

  it("keeps an MCP App visible outside the collapsed turn accordion", () => {
    const events = [
      ev({
        id: "u1",
        content: "find a flight",
        metadata: { kind: "user-prompt" },
      }),
      ev({
        id: "app1",
        type: "tool_call",
        content: "mcp__skyscanner__search: Tokyo to Seoul",
        metadata: {
          mcpApp: {
            server: "skyscanner",
            tool: "search",
            resourceUri: "ui://skyscanner/flights.html",
          },
        },
      }),
      ev({ id: "r1", content: "Live fares are ready.", metadata: { kind: "report" } }),
      ev({ id: "r2", content: "Here is the cheapest option.", metadata: { kind: "report" } }),
    ];
    const groups = groupEvents(events);
    const appIndex = groups.findIndex((group) => group.type === "mcp_app");
    const rows = buildTurnRenderRows(groups);
    const accordion = rows.find((row) => row.kind === "accordion");

    expect(appIndex).toBeGreaterThan(-1);
    expect(accordion).toBeDefined();
    if (accordion?.kind !== "accordion") return;
    expect(accordion.messageBreakoutIndices).toContain(appIndex);
    expect(accordion.previousSegments.flat()).not.toContain(appIndex);
    expect(accordion.previousToolSummary).toBe("");
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

  // The real shape of a presentation run: three scratch renders under a hidden
  // build directory and one file in the folder the answer points at. Before
  // this rule each of the four took a card of its own.
  it("leaves working copies inside the accordion", () => {
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
          path: "/work/.build/pptx/mains_pitch.pptx",
          fileName: "mains_pitch.pptx",
          working: true,
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
          path: "/work/deliverables/mains-pitch-deck.pptx",
          fileName: "mains-pitch-deck.pptx",
        },
      }),
      ev({
        id: "t2",
        type: "tool_call",
        content: "Bash: render the handout",
        metadata: { status: "done", toolName: "Bash" },
      }),
      ev({
        id: "d3",
        metadata: {
          kind: "document",
          path: "/work/.build/final-pdf/mains-pitch-deck.pdf",
          fileName: "mains-pitch-deck.pdf",
          working: true,
        },
      }),
      ev({
        id: "r1",
        content: "The presentation is ready.",
        metadata: { kind: "report" },
      }),
    ];
    const groups = groupEvents(events);
    const groupOf = (id: string) =>
      groups.findIndex((group) => group.events.some((event) => event.id === id));
    const rows = buildTurnRenderRows(groups);
    const accordion = rows.find((row) => row.kind === "accordion");

    expect(accordion).toBeDefined();
    if (accordion?.kind !== "accordion") return;
    expect(accordion.messageBreakoutIndices).toEqual([groupOf("d2")]);
    expect(accordion.previousSegments.flat()).toContain(groupOf("d1"));
    expect(accordion.previousSegments.flat()).toContain(groupOf("d3"));
  });

  // A late scratch render shares its key with the deliverable. If it could
  // claim that key the real card would be suppressed as "not the latest" while
  // the working copy is never shown either — the turn would end with no
  // document at all.
  it("does not let a working copy shadow the deliverable it was rendered from", () => {
    const events = [
      ev({ id: "u1", content: "deck please", metadata: { kind: "user-prompt" } }),
      ev({
        id: "d1",
        metadata: {
          kind: "document",
          path: "/work/deliverables/deck.pptx",
          fileName: "deck.pptx",
        },
      }),
      ev({
        id: "t1",
        type: "tool_call",
        content: "Bash: re-render",
        metadata: { status: "done", toolName: "Bash" },
      }),
      ev({
        id: "d2",
        metadata: {
          kind: "document",
          path: "/work/.build/deck.pptx",
          fileName: "deck.pptx",
          working: true,
        },
      }),
      ev({ id: "r1", content: "Done.", metadata: { kind: "report" } }),
    ];
    const groups = groupEvents(events);
    const deliverable = groups.findIndex((group) =>
      group.events.some((event) => event.id === "d1"),
    );
    const rows = buildTurnRenderRows(groups);
    const accordion = rows.find((row) => row.kind === "accordion");

    expect(accordion).toBeDefined();
    if (accordion?.kind !== "accordion") return;
    expect(accordion.messageBreakoutIndices).toEqual([deliverable]);
  });

  // An image the agent opened stays inside the turn; one it produced does not.
  it("keeps viewed images out of the breakout, generated ones in", () => {
    const events = [
      ev({ id: "u1", content: "make a chart", metadata: { kind: "user-prompt" } }),
      ev({
        id: "i1",
        metadata: {
          kind: "image",
          path: "/work/assets/logo.png",
          fileName: "logo.png",
          viewed: true,
        },
      }),
      ev({
        id: "t1",
        type: "tool_call",
        content: "Bash: plot",
        metadata: { status: "done", toolName: "Bash" },
      }),
      ev({
        id: "i2",
        metadata: {
          kind: "image",
          path: "/work/chart.png",
          fileName: "chart.png",
        },
      }),
      ev({ id: "r1", content: "Here it is.", metadata: { kind: "report" } }),
    ];
    const groups = groupEvents(events);
    const groupOf = (id: string) =>
      groups.findIndex((group) => group.events.some((event) => event.id === id));
    const rows = buildTurnRenderRows(groups);
    const accordion = rows.find((row) => row.kind === "accordion");

    expect(accordion).toBeDefined();
    if (accordion?.kind !== "accordion") return;
    expect(accordion.messageBreakoutIndices).toEqual([groupOf("i2")]);
    expect(accordion.previousSegments.flat()).toContain(groupOf("i1"));
  });
});

describe("final-answer transcript layout", () => {
  const prompt = () => ev({ id: "prompt", metadata: { kind: "user-prompt" } });
  const report = (id: string, messagePhase?: string) => ev({ id, content: id, metadata: { kind: "report", messagePhase } });

  it("keeps the confirmed final answer outside even when commentary arrives afterward", () => {
    const rows = buildTurnRenderRows(groupEvents([prompt(), report("progress", "commentary"),
      report("final", "final_answer"), report("late", "commentary")]));
    const row = rows[1];
    expect(row.kind).toBe("accordion");
    if (row.kind !== "accordion") return;
    expect(row.lastSegment).toEqual([2]);
    expect(row.previousSegments.flat()).toEqual([1, 3]);
    expect(row.previousMessageCount).toBe(2);
  });

  it("keeps every block of a split final reply visible", () => {
    const rows = buildTurnRenderRows(groupEvents([prompt(), report("progress", "commentary"),
      report("final-1", "final_answer"), report("final-2", "final_answer"),
      ev({ id: "image", metadata: { kind: "image" }, content: "/tmp/output.png" })]));
    const row = rows[1];
    expect(row.kind).toBe("accordion");
    if (row.kind !== "accordion") return;
    expect(row.lastSegment).toEqual([2, 3]);
    expect(row.messageBreakoutIndices).toEqual([4]);
    expect(row.previousSegments.flat()).toEqual([1]);
  });

  it("folds prefix tools when the only reply is a confirmed final answer", () => {
    const rows = buildTurnRenderRows(groupEvents([prompt(),
      ev({ id: "tool", type: "tool_call", metadata: { status: "done" } }), report("final", "final_answer")]));
    const row = rows[1];
    expect(row.kind).toBe("accordion");
    if (row.kind !== "accordion") return;
    expect(row.previousToolSummary).toBe("1 tool call");
    expect(row.previousMessageCount).toBe(0);
    expect(row.lastSegment).toEqual([2]);
  });

  it.each([undefined, "commentary", "unknown"])("falls back to the latest reply without confirmed final evidence (%s)", (phase) => {
    const rows = buildTurnRenderRows(groupEvents([prompt(), report("first", phase), report("last", phase)]));
    const row = rows[1];
    expect(row.kind).toBe("accordion");
    if (row.kind !== "accordion") return;
    expect(row.lastSegment).toEqual([2]);
    expect(row.previousSegments.flat()).toEqual([1]);
  });
});

describe("matchTurnsToGroups", () => {
  // A continue that died before the provider emitted anything leaves a short
  // turn row with no prompt of its own in the transcript. Its bar must not
  // land on the previous turn's reply — that reply's own duration belongs
  // there. (Seen live: a 2m50s first turn rendered as "3s".)
  it("ignores a turn that produced no groups of its own", () => {
    // Turn timestamps arrive from the DB as epoch seconds; event timestamps
    // are Dates. Keep both on one clock so the match is the real one.
    const t0 = 1_789_913_752;
    const at = (offsetSec: number) => new Date((t0 + offsetSec) * 1000);
    const groups = groupEvents([
      ev({ id: "u1", content: "write the guide", timestamp: at(0), metadata: { kind: "user-prompt" } }),
      ev({ id: "r1", content: "here it is", timestamp: at(170), metadata: { kind: "report" } }),
      ev({ id: "u2", content: "now as a doc", timestamp: at(1_370), metadata: { kind: "user-prompt" } }),
      ev({ id: "r2", content: "done", timestamp: at(2_058), metadata: { kind: "report" } }),
    ]);
    const groupOf = (id: string) =>
      groups.findIndex((g) => g.events.some((e) => e.id === id));

    const info = matchTurnsToGroups(groups, [
      { ...turn(0, "gpt-5.6-terra"), elapsedMs: 170_461, endedAt: t0 + 170 },
      // Started and finalized between the two prompts, 3s and nothing to show.
      { ...turn(1, null), elapsedMs: 3_151, endedAt: t0 + 1_327 },
      { ...turn(2, "gpt-5.6-terra"), elapsedMs: 689_073, endedAt: t0 + 2_058 },
    ]);

    expect(info.get(groupOf("r1"))?.elapsed).toBe(170_461);
    expect(info.get(groupOf("r2"))?.elapsed).toBe(689_073);
    expect([...info.values()].map((i) => i.elapsed)).not.toContain(3_151);
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


describe("steer transcript boundaries", () => {
  it("keeps a steer inside the running turn for session timing and model markers", () => {
    const groups = groupEvents([
      ev({ id: "u1", timestamp: new Date(1000), content: "initial", metadata: { kind: "user-prompt" } }),
      ev({ id: "a1", timestamp: new Date(3000), content: "working", metadata: { kind: "report" } }),
      ev({ id: "steer", timestamp: new Date(5000), content: "guidance", metadata: { kind: "user-prompt", delivery: "steer" } }),
      ev({ id: "a2", timestamp: new Date(8000), content: "updated answer", metadata: { kind: "report" } }),
      ev({ id: "u2", timestamp: new Date(10000), content: "next turn", metadata: { kind: "user-prompt" } }),
      ev({ id: "a3", timestamp: new Date(13000), content: "done", metadata: { kind: "report" } }),
    ]);
    const at = (id: string) => groups.findIndex((group) => group.events.some((event) => event.id === id));
    const sessions = matchTurnsToGroups(groups, [], undefined, true);
    expect(sessions.size).toBe(2);
    expect(sessions.get(at("a2"))?.elapsed).toBe(7000);
    expect(sessions.has(at("a1"))).toBe(false);
    const markers = matchModelChangesToPromptGroups(groups, [turn(0, "first-model"), turn(1, "second-model")]);
    expect([...markers.keys()]).toEqual([at("u2")]);
  });
});
