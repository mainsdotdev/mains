import { describe, expect, it } from "vitest";
import { ASSISTANT_AVATAR_COLORS, ASSISTANT_AVATAR_SHAPES, normalizeAssistantAvatar } from "@mains/contracts/assistants";
import { AVATAR_PARTICLES, AVATAR_GRID_SIDES, avatarPhase, type AvatarGaze } from "./assistant-particles";

describe("assistant particle geometry", () => {
  it.each(ASSISTANT_AVATAR_SHAPES)("keeps two eyes on occupied cells for every gaze of the %s silhouette", shape => {
    for (const detail of ["compact", "full"] as const) {
      const particles = AVATAR_PARTICLES[shape][detail];
      expect(particles.filter(p => p.eye).map(p => p.eye).sort()).toEqual(["left", "right"]);
      expect(new Set(particles.map(p => p.id)).size).toBe(particles.length);
      expect(particles.length).toBeLessThan(200);
      const side = AVATAR_GRID_SIDES[detail];
      for (const gaze of ["center", "left", "right", "up", "down"] as AvatarGaze[]) {
        const eyes = particles.filter(p => p.gaze[gaze]);
        expect(eyes).toHaveLength(2);
        expect(eyes[0].row).toBe(eyes[1].row);
        expect(eyes[1].col - eyes[0].col).toBe(2);
      }
      for (const p of particles) {
        expect(p.row).toBeGreaterThanOrEqual(0);
        expect(p.row).toBeLessThan(side);
        expect(p.col).toBeGreaterThanOrEqual(0);
        expect(p.col).toBeLessThan(side);
        expect(Number.isInteger(p.row) && Number.isInteger(p.col)).toBe(true);
      }
    }
    expect(AVATAR_PARTICLES[shape].compact.length).toBeLessThan(AVATAR_PARTICLES[shape].full.length);
  });
  it("softens exposed silhouette corners while leaving interior cells square", () => {
    const flower = AVATAR_PARTICLES.flower.full;
    expect(AVATAR_PARTICLES.sphere.full.some(p => p.radius.includes("75%"))).toBe(true);
    expect(flower.find(p => p.row === 4 && p.col === 4)?.radius).toBe("8% 8% 8% 8%");
  });
  it("normalizes stored shapes without losing their selected color", () => {
    expect(normalizeAssistantAvatar({ shape: "circle", color: "mint" })).toEqual({ shape: "sphere", color: "mint" });
    expect(normalizeAssistantAvatar({ shape: "square", color: "violet" })).toEqual({ shape: "cube", color: "violet" });
    for (const color of ASSISTANT_AVATAR_COLORS) expect(normalizeAssistantAvatar({ shape: "cube", color }).color).toBe(color);
    expect(ASSISTANT_AVATAR_COLORS).toHaveLength(8);
    for (const shape of ASSISTANT_AVATAR_SHAPES) expect(normalizeAssistantAvatar({ shape, color: "mint" })).toEqual({ shape, color: "mint" });
    expect(normalizeAssistantAvatar(null)).toEqual({ shape: "sphere", color: "blue" });
    expect(avatarPhase("release")).toBe(avatarPhase("release"));
    expect(avatarPhase("release")).not.toBe(avatarPhase("website"));
  });
});
