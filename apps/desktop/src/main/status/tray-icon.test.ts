import { describe, expect, it } from "vitest";
import { drawBadge } from "./tray-icon";

const alphaAt = (bitmap: Buffer, width: number, x: number, y: number) =>
  bitmap[(y * width + x) * 4 + 3];

describe("drawBadge", () => {
  it("stamps an opaque dot into the bottom-right corner", () => {
    const empty = Buffer.alloc(16 * 16 * 4);
    const badged = drawBadge(empty, 16, 16);
    expect(alphaAt(badged, 16, 13, 13)).toBe(255);
    expect(alphaAt(badged, 16, 2, 2)).toBe(0);
    expect(alphaAt(badged, 16, 13, 2)).toBe(0);
  });

  it("cuts a gap between the dot and the glyph, and leaves the rest alone", () => {
    const solid = Buffer.alloc(32 * 32 * 4, 255);
    const badged = drawBadge(solid, 32, 32);
    // Dot centre at (32 - r, 32 - r) with r ≈ 6; the gap ring sits just outside it.
    expect(alphaAt(badged, 32, 26, 26)).toBe(255);
    expect(alphaAt(badged, 32, 18, 26)).toBe(0);
    expect(alphaAt(badged, 32, 4, 4)).toBe(255);
    expect(alphaAt(badged, 32, 26, 4)).toBe(255);
  });

  it("does not touch the source bitmap", () => {
    const source = Buffer.alloc(16 * 16 * 4);
    drawBadge(source, 16, 16);
    expect(source.every((byte) => byte === 0)).toBe(true);
  });
});
