import { describe, expect, it } from "vitest";
import { ASSISTANT_AVATAR_COLORS, ASSISTANT_AVATAR_SHAPES, ASSISTANT_AVATAR_SHAPES_BY_FAMILY, normalizeAssistantAvatar } from "@mains/contracts/assistants";
import { MOSAIC_SHAPES, avatarPhase } from "./assistant-mosaic";

describe("assistant mosaic geometry", () => {
  it.each(ASSISTANT_AVATAR_SHAPES_BY_FAMILY.mosaic)("keeps the eyes and activity accents within the %s tiles", shape => {
    const { tiles, eyes: [left, right, y], accents } = MOSAIC_SHAPES[shape];
    expect(tiles.length).toBeLessThanOrEqual(8);
    expect(left).toBeLessThan(right);
    for (const x of [left, right]) {
      // Include the full eye and the extra 2% offset used for a sideways or vertical gaze.
      expect(tiles.some(([tileX, tileY, width, height]) =>
        x - 7.25 >= tileX && x + 7.25 <= tileX + width &&
        y - 8.5 >= tileY && y + 8.5 <= tileY + height)).toBe(true);
    }
    expect(new Set(accents).size).toBe(accents.length);
    expect(accents.length).toBeGreaterThan(0);
    expect(accents.every(index => tiles[index])).toBe(true);
  });
  it("normalizes stored shapes without losing their selected color", () => {
    expect(normalizeAssistantAvatar({ shape: "circle", color: "mint" })).toEqual({ shape: "sphere", color: "mint" });
    expect(normalizeAssistantAvatar({ shape: "square", color: "violet" })).toEqual({ shape: "cube", color: "violet" });
    expect(normalizeAssistantAvatar({ shape: "cross", color: "coral" })).toEqual({ shape: "arch", color: "coral" });
    for (const color of ASSISTANT_AVATAR_COLORS) expect(normalizeAssistantAvatar({ shape: "cube", color }).color).toBe(color);
    expect(ASSISTANT_AVATAR_COLORS).toHaveLength(8);
    for (const shape of ASSISTANT_AVATAR_SHAPES) expect(normalizeAssistantAvatar({ shape, color: "mint" })).toEqual({ shape, color: "mint" });
    expect(normalizeAssistantAvatar(null)).toEqual({ shape: "sphere", color: "blue" });
    expect(avatarPhase("release")).toBe(avatarPhase("release"));
    expect(avatarPhase("release")).not.toBe(avatarPhase("website"));
  });
});
