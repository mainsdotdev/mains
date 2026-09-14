import { describe, it, expect } from "vitest";
import { buildTurnMarkers } from "./turn-markers";
import { groupEvents } from "./group-events";
import type { RunEvent } from "../types";

let seq = 0;
function ev(partial: Partial<RunEvent> & { id: string }): RunEvent {
  return {
    type: "artifact",
    content: "",
    timestamp: new Date(++seq * 1000),
    ...partial,
  };
}

const prompt = (id: string, content: string) =>
  ev({ id, content, metadata: { kind: "user-prompt" } });
const reply = (id: string, content: string) =>
  ev({ id, content, metadata: { kind: "report" } });
const tool = (id: string, content: string) =>
  ev({ id, type: "tool_call", content, metadata: { status: "done" } });

describe("buildTurnMarkers", () => {
  it("pairs each user message with the reply it got", () => {
    const markers = buildTurnMarkers(
      groupEvents([
        prompt("u1", "first question"),
        reply("r1", "first answer"),
        prompt("u2", "second question"),
        reply("r2", "second answer"),
      ]),
    );

    expect(markers.map((m) => [m.prompt, m.reply])).toEqual([
      ["first question", "first answer"],
      ["second question", "second answer"],
    ]);
  });

  // The tool calls between a prompt and its answer belong to the transcript,
  // not to a two-line preview card.
  it("skips tool calls when collecting the reply", () => {
    const [marker] = buildTurnMarkers(
      groupEvents([
        prompt("u1", "do it"),
        tool("t1", "Read: a.ts"),
        reply("r1", "done"),
      ]),
    );

    expect(marker.reply).toBe("done");
  });

  it("leaves the reply empty while the agent is still working", () => {
    const [marker] = buildTurnMarkers(
      groupEvents([prompt("u1", "waiting on you"), tool("t1", "Read: a.ts")]),
    );

    expect(marker.prompt).toBe("waiting on you");
    expect(marker.reply).toBe("");
  });

  it("does not read the next turn's reply", () => {
    const markers = buildTurnMarkers(
      groupEvents([
        prompt("u1", "first"),
        prompt("u2", "second"),
        reply("r1", "answer to the second"),
      ]),
    );

    expect(markers[0].reply).toBe("");
    expect(markers[1].reply).toBe("answer to the second");
  });

  it("flattens whitespace and truncates long text", () => {
    const [marker] = buildTurnMarkers(
      groupEvents([
        prompt("u1", `line one\n\n   line two`),
        reply("r1", "x".repeat(400)),
      ]),
    );

    expect(marker.prompt).toBe("line one line two");
    expect(marker.reply.endsWith("…")).toBe(true);
    expect(marker.reply.length).toBeLessThanOrEqual(321);
  });

  it("returns nothing for a transcript with no user messages", () => {
    expect(buildTurnMarkers(groupEvents([reply("r1", "hi")]))).toEqual([]);
  });

  // The rail scrolls to the marker's group, so the index has to address the
  // prompt itself rather than its position among the prompts.
  it("indexes the prompt's own group", () => {
    const groups = groupEvents([
      reply("r0", "preamble"),
      prompt("u1", "first"),
      reply("r1", "answer"),
      prompt("u2", "second"),
    ]);
    const markers = buildTurnMarkers(groups);

    expect(groups[markers[0].index].events[0].content).toBe("first");
    expect(groups[markers[1].index].events[0].content).toBe("second");
    expect(markers[0].groupId).toBe(groups[markers[0].index].id);
  });
});
