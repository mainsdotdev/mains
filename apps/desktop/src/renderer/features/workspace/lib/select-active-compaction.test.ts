import { describe, expect, it } from "vitest";
import type { RunEvent } from "../types";
import { selectActiveCompaction } from "./select-active-compaction";

function compaction(phase?: string): RunEvent {
  return { id: phase ?? "legacy", type: "log", content: "", timestamp: new Date(),
    metadata: { source: "context_compaction", itemId: "compact-1", phase } };
}

describe("selectActiveCompaction", () => {
  it("tracks started compaction until its completed notification, including legacy completion logs", () => {
    const start = compaction("start");
    expect(selectActiveCompaction([start])).toBe(start);
    expect(selectActiveCompaction([start, compaction("complete")])).toBeUndefined();
    expect(selectActiveCompaction([compaction()])).toBeUndefined();
  });

  it("does not carry an unfinished compaction into the next typed turn", () => {
    const prompt: RunEvent = { id: "prompt", type: "artifact", content: "Next request", timestamp: new Date(), metadata: { kind: "user-prompt" } };
    const start = compaction("start");
    expect(selectActiveCompaction([start, prompt])).toBeUndefined();
    expect(selectActiveCompaction([start, { ...prompt, type: "log", metadata: { level: "sdk-user" } }])).toBeUndefined();
    expect(selectActiveCompaction([start, { ...prompt, metadata: { ...prompt.metadata, streaming: true } }])).toBe(start);
  });

  it("ignores subagent progress and unrelated assistant streams", () => {
    const start = compaction("start");
    expect(selectActiveCompaction([start,
      { ...compaction("complete"), metadata: { ...compaction("complete").metadata, isFromSubagent: true } },
      { id: "stream", type: "artifact", content: "reply", timestamp: new Date(), metadata: { kind: "report", streaming: true } },
    ])).toBe(start);
  });
});
