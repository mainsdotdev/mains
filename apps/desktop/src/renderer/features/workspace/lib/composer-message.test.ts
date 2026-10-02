import { describe, expect, it } from "vitest";
import { hasComposerMessage } from "./composer-message";

describe("composer message content", () => {
  it("distinguishes empty/ambient input from text, attachments and explicit context", () => {
    expect(hasComposerMessage(" \n ", 0, [])).toBe(false);
    expect(hasComposerMessage("", 0, [{ kind: "mcp-app", id: "app", sessionId: "s", appName: "App", updateId: "1", label: "App", hidden: true }])).toBe(false);
    expect(hasComposerMessage("continue", 0, [])).toBe(true);
    expect(hasComposerMessage("", 1, [])).toBe(true);
    expect(hasComposerMessage("", 0, [{ kind: "skill", name: "skill" }])).toBe(true);
  });
});
