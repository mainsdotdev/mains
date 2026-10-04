import { describe, expect, it } from "vitest";
import type { RunTurn } from "@/lib/redux/api";
import type { RunEvent } from "../types";
import { projectVoiceTranscriptEvents } from "./voice-transcript-view";
import { groupEvents } from "./group-events";
import { buildTurnRenderRows, matchTurnsToGroups } from "./transcript-rows";

const scope = { inputSource: "voice", realtimeSessionId: "call", providerTurnId: "native" };
const turn: RunTurn = {
  id: 1, runId: "run", turnIndex: 0, metadata: scope, status: "active", startedAt: 10_000, endedAt: null,
  promptContent: null, responseContent: null, elapsedMs: null, createdAt: 10_000,
  inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
  costMicros: null, model: null, modelUsage: null,
};
function event(id: string, time: number, metadata: Record<string, unknown> = {}): RunEvent {
  return { id, type: "artifact", content: id, timestamp: new Date(time), metadata: { kind: "report", ...metadata } };
}
function plan(events: RunEvent[], turns = [turn]) {
  const groups = groupEvents(projectVoiceTranscriptEvents(events, turns));
  return { groups, rows: buildTurnRenderRows(groups) };
}

describe("voice conversation timeline", () => {
  it("keeps consecutive spoken replies visible as flat messages", () => {
    const { rows } = plan([event("hello", 12_000, { voice: true }), event("answer", 13_000, { voice: true })], []);
    expect(rows.map((row) => row.kind)).toEqual(["flat", "flat"]);
  });
  it("keeps speech and tools in chronological order without a work block or written duplicate", () => {
    const { groups, rows } = plan([event("user", 9_000, { voice: true, kind: "user-prompt" }),
      event("work", 11_000, scope), event("speech", 12_000, { voice: true }),
      { ...event("tool", 13_000, scope), type: "tool_call" },
      event("other-user", 14_000, { voice: true, kind: "user-prompt" }), event("last-work", 15_000, scope)]);
    expect(groups.flatMap((group) => group.events.map((item) => item.id))).toEqual(["user", "speech", "tool", "other-user"]);
    expect(rows).toEqual([0, 1, 2, 3].map((index) => ({ kind: "flat", indices: [index] })));
  });
  it("preserves the next typed turn's existing accordion layout", () => {
    const typedTurn = { ...turn, id: 2, turnIndex: 1, startedAt: 35_000, metadata: { providerTurnId: "typed-turn" } };
    const events = [event("typed-user", 35_000, { kind: "user-prompt" }), event("revision", 36_000), event("final", 37_000)];
    expect(plan(events, [turn, typedTurn]).rows).toEqual(buildTurnRenderRows(groupEvents(events)));
  });
  it("keeps generated files, interactive apps and plans visible in the ordinary flow", () => {
    const { groups, rows } = plan([event("work", 11_000, scope),
      event("file", 12_000, { ...scope, kind: "document", path: "/tmp/report.md" }),
      { ...event("plan", 13_000, scope), type: "tool_call", content: "Plan: next step" },
      { ...event("app", 14_000, { ...scope, mcpApp: {} }), type: "tool_call" }]);
    expect(groups.map((group) => group.events[0].id)).toEqual(["file", "plan", "app"]);
    expect(rows.every((row) => row.kind === "flat")).toBe(true);
  });
  it("does not add an empty block when delegation starts before a work event", () => {
    expect(plan([event("user", 9_000, { voice: true, kind: "user-prompt" })]).rows).toEqual([{ kind: "flat", indices: [0] }]);
    expect(plan([]).rows).toEqual([]);
  });
  it("anchors native usage to visible tools instead of hidden agent prose or spoken narration", () => {
    const completed = { ...turn, status: "completed", elapsedMs: 20_000, endedAt: 30_000 } as RunTurn;
    const { groups } = plan([event("work", 11_000, scope),
      { ...event("tool", 12_000, scope), type: "tool_call" }, event("narration", 29_000, { voice: true })], [completed]);
    expect([...matchTurnsToGroups(groups, [completed]).keys()]).toEqual([0]);
    const onlySpeech = plan([event("work", 11_000, scope), event("narration", 29_000, { voice: true })], [completed]);
    expect(matchTurnsToGroups(onlySpeech.groups, [completed]).size).toBe(0);
  });
  it("does not copy old voice narration into a later typed response", () => {
    const completed = { ...turn, status: "completed", elapsedMs: 20_000, endedAt: 30_000 } as RunTurn;
    const typed = { ...completed, id: 2, turnIndex: 1, startedAt: 40_000, endedAt: 50_000, metadata: { providerTurnId: "typed" } };
    const { groups } = plan([event("work", 11_000, scope), event("narration", 20_000, { voice: true }),
      { ...event("tool", 29_000, scope), type: "tool_call" }, event("last voice reply", 35_000, { voice: true }),
      event("typed-user", 40_000, { kind: "user-prompt" }), event("typed-reply", 45_000)], [completed, typed]);
    expect(matchTurnsToGroups(groups, [completed, typed]).get(4)?.responseContent).toBe("typed-reply");
  });
});
