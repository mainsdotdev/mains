import { describe, expect, it } from "vitest";
import { ASSISTANT_AVATAR_COLORS, ASSISTANT_AVATAR_SHAPES, normalizeAssistantAvatar } from "@mains/contracts/assistants";
import { AVATAR_PARTICLES, avatarPhase } from "./assistant-particles";

describe("assistant particle geometry", () => {
  it.each(ASSISTANT_AVATAR_SHAPES)("keeps exactly two eyes inside both densities of the %s cloud", shape => {
    for (const detail of ["compact", "full"] as const) {
      const particles = AVATAR_PARTICLES[shape][detail];
      expect(particles.filter(p => p.eye).map(p => p.eye).sort()).toEqual(["left", "right"]);
      expect(new Set(particles.map(p => p.id)).size).toBe(particles.length);
      expect(particles.length).toBeLessThan(200);
      expect(particles.filter(p => Math.hypot(p.x - 32, p.y - 32) < 10).length).toBeGreaterThan(4);
      for (const p of particles) {
        expect(p.x - p.halfSize).toBeGreaterThan(3);
        expect(p.x + p.halfSize).toBeLessThan(61);
        expect(p.y - p.halfSize).toBeGreaterThan(3);
        expect(p.y + p.halfSize).toBeLessThan(61);
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      }
    }
    expect(AVATAR_PARTICLES[shape].compact.length).toBeLessThan(AVATAR_PARTICLES[shape].full.length);
    expect(AVATAR_PARTICLES[shape].compact.filter(p => p.eye).map(p => p.id)).toEqual(AVATAR_PARTICLES[shape].full.filter(p => p.eye).map(p => p.id));
  });
  it("normalizes stored shapes without losing their selected color", () => {
    expect(normalizeAssistantAvatar({ shape: "circle", color: "mint" })).toEqual({ shape: "sphere", color: "mint" });
    expect(normalizeAssistantAvatar({ shape: "square", color: "violet" })).toEqual({ shape: "cube", color: "violet" });
    for (const color of ASSISTANT_AVATAR_COLORS) expect(normalizeAssistantAvatar({ shape: "cube", color }).color).toBe(color);
    expect(ASSISTANT_AVATAR_COLORS).toHaveLength(8);
    expect(normalizeAssistantAvatar(null)).toEqual({ shape: "sphere", color: "blue" });
    expect(avatarPhase("release")).toBe(avatarPhase("release"));
    expect(avatarPhase("release")).not.toBe(avatarPhase("website"));
  });
});
