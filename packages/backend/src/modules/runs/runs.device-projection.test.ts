import { describe, expect, it } from "vitest";
import type { RunResponse } from "./runs.dto";
import { runForPairedDevice } from "./runs.device-projection";

describe("phone conversation metadata", () => {
  it("keeps per-conversation preferences while omitting large execution bodies", () => {
    const conversationSettings = { model: "gpt-6-luna", config: { modelReasoningEffort: "low", sandboxMode: "read-only", serviceTier: "priority", planMode: false, goalMode: true } };
    const run = { id: "chat", title: "Chat", model: "historical-model", goal: "x".repeat(1024 * 1024),
      systemPrompt: "x".repeat(1024 * 1024), toolPolicySnapshot: { tools: "x".repeat(1024 * 1024) },
      configSnapshot: { modelReasoningEffort: "high", credential: "private", context: "x".repeat(1024 * 1024), conversationSettings },
    } as unknown as RunResponse;
    const projected = runForPairedDevice(run);
    expect(projected.configSnapshot).toEqual({ modelReasoningEffort: "high", conversationSettings });
    expect(projected).toMatchObject({ id: "chat", title: "Chat", model: "historical-model", goal: null, systemPrompt: null, toolPolicySnapshot: null });
    expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThan(1024);
    expect(run.goal).toHaveLength(1024 * 1024);
    expect(run.configSnapshot?.credential).toBe("private");
  });
});
