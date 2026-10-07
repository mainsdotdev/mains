import { describe, expect, it } from "vitest";
import type { RunEvent } from "../types";
import { selectActiveTool } from "./select-active-tool";

function tool(id: string, status = "running", metadata: Record<string, unknown> = {}): RunEvent {
  return { id, type: "tool_call", content: "Read: AGENTS.md", timestamp: new Date(),
    metadata: { toolName: "Read", status, ...metadata } };
}

function artifact(kind: string, content = "Text"): RunEvent {
  return { id: kind, type: "artifact", content, timestamp: new Date(), metadata: { kind } };
}

describe("selectActiveTool", () => {
  it("tracks the latest active call and returns to an unfinished parallel call when it completes", () => {
    const first = tool("first");
    const second = tool("second");
    expect(selectActiveTool([first, second])).toBe(second);
    expect(selectActiveTool([first, tool("second", "done")])).toBe(first);
    expect(selectActiveTool([tool("first", "done"), tool("second", "error")])).toBeUndefined();
    expect(selectActiveTool([tool("first", "canceled")])).toBeUndefined();
    const queued = tool("queued", "queued");
    expect(selectActiveTool([queued])).toBe(queued);
  });

  it("keeps the foreground activity while thinking and command progress arrive", () => {
    const active = tool("read");
    expect(selectActiveTool([active, artifact("thinking", "Read 100 lines")])).toBe(active);
  });

  it("does not surface a subagent's tools or let its response replace the foreground activity", () => {
    const active = tool("parent");
    const response = artifact("report");
    response.metadata = { ...response.metadata, isFromSubagent: true };
    expect(selectActiveTool([active, tool("child", "running", { parentToolCallId: "spawn" }),
      tool("child-legacy", "running", { isFromSubagent: true }), response])).toBe(active);
  });

  it("keeps explicitly running tools when an assistant stream is appended after database events", () => {
    const active = tool("active");
    const stream = artifact("report", "I'll inspect the file.");
    stream.timestamp = new Date(active.timestamp.getTime() - 1000);
    stream.metadata = { ...stream.metadata, streaming: true };
    expect(selectActiveTool([active, stream])).toBe(active);
    expect(selectActiveTool([active, artifact("report")])).toBe(active);
    expect(selectActiveTool([active, artifact("result")])).toBe(active);
    expect(selectActiveTool([{ ...active, metadata: { ...active.metadata, status: "done" } }, stream])).toBeUndefined();
  });

  it("does not let an earlier transient prompt hide its running tool", () => {
    const active = tool("active");
    const prompt = artifact("user-prompt");
    prompt.timestamp = new Date(active.timestamp.getTime() - 1000);
    prompt.metadata = { ...prompt.metadata, streaming: true };
    expect(selectActiveTool([active, prompt])).toBe(active);
  });

  it("drops old activity after a new persisted prompt", () => {
    expect(selectActiveTool([tool("old"), artifact("user-prompt"), artifact("thinking")])).toBeUndefined();
    const active = tool("new");
    expect(selectActiveTool([tool("old"), artifact("user-prompt"), active])).toBe(active);
  });
});
