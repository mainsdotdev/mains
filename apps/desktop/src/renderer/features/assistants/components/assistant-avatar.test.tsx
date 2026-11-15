import { describe, expect, it } from "vitest";
import { ASSISTANT_AVATAR_COLORS, normalizeAssistantAvatar } from "@mains/contracts/assistants";

describe("stored assistant avatars", () => {
  it("normalizes stored shapes without losing their selected color", () => {
    expect(normalizeAssistantAvatar({ shape: "circle", color: "mint" })).toEqual({ shape: "sphere", color: "mint" });
    expect(normalizeAssistantAvatar({ shape: "square", color: "violet" })).toEqual({ shape: "cube", color: "violet" });
    for (const color of ASSISTANT_AVATAR_COLORS) expect(normalizeAssistantAvatar({ shape: "cube", color }).color).toBe(color);
    expect(ASSISTANT_AVATAR_COLORS).toHaveLength(8);
    expect(normalizeAssistantAvatar(null)).toEqual({ shape: "sphere", color: "blue" });
  });
});
