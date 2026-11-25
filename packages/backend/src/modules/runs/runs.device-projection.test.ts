import { describe, expect, it } from "vitest";
import type { RunResponse } from "./runs.dto";
import { runForPairedDevice } from "./runs.device-projection";

describe("phone conversation metadata", () => {
  it.each([
    { title: "  Named chat  ", goal: "Original prompt", expected: "Named chat" },
    { title: null, goal: "Hallo", expected: "Hallo" },
    { title: "", goal: "Hey", expected: "Hey" },
    { title: " \t ", goal: "\n  \n Hey, naber  \nprivate later prompt", expected: "Hey, naber" },
    { title: null, goal: null, expected: null },
    { title: "", goal: " \n\t", expected: null },
  ])("preserves the desktop label before removing the prompt: $expected", ({ title, goal, expected }) => {
    const run = { id: "chat", title, goal, configSnapshot: null } as RunResponse;
    const projected = runForPairedDevice(run);
    expect(projected.title).toBe(expected);
    expect(projected.goal).toBeNull();
    expect(run).toMatchObject({ title, goal });
  });

  it("bounds fallback labels without splitting Unicode or exposing later prompt lines", () => {
    const label = "a".repeat(239) + "🌍";
    const run = { id: "chat", title: null, goal: label + "extra\nprivate prompt body", configSnapshot: null } as RunResponse;
    const projected = runForPairedDevice(run);
    expect(projected.title).toBe(label);
    expect(projected.goal).toBeNull();
    expect(JSON.stringify(projected)).not.toContain("private prompt body");
  });

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
