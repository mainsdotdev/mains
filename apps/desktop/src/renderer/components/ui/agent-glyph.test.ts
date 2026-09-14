import { describe, it, expect } from "vitest";
import { glyphCells, glyphHue } from "./agent-glyph";

describe("glyphCells", () => {
  it("is deterministic for the same seed", () => {
    expect(glyphCells("Security review")).toEqual(glyphCells("Security review"));
  });

  it("differs between typical sibling agents", () => {
    expect(glyphCells("Security review")).not.toEqual(glyphCells("Test gaps review"));
    expect(glyphCells("Security review")).not.toEqual(glyphCells("Maintainability review"));
  });

  it("mirrors vertically so the mark reads as deliberate", () => {
    const cells = glyphCells("Security review");
    // Derive the side from the pattern itself so grid-size tweaks don't
    // silently turn this into an out-of-bounds no-op.
    const grid = Math.sqrt(cells.length);
    expect(Number.isInteger(grid)).toBe(true);
    for (let row = 0; row < grid; row++) {
      for (let col = 0; col < grid; col++) {
        expect(cells[row * grid + col]).toBe(cells[row * grid + (grid - 1 - col)]);
      }
    }
  });

  it("is never empty, even for degenerate seeds", () => {
    for (const seed of ["", "a", "  "]) {
      expect(glyphCells(seed).some(Boolean)).toBe(true);
    }
  });
});

describe("glyphHue", () => {
  it("is deterministic and stays a legal hue angle", () => {
    for (const seed of ["Security review", "a", ""]) {
      const hue = glyphHue(seed);
      expect(hue).toBe(glyphHue(seed));
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("uses the whole wheel in even steps — every bucket is reachable", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(glyphHue(`Agent ${i}`));
    expect(seen.size).toBe(24);
    // Even spacing is what keeps neighbouring hues equally far apart.
    expect([...seen].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 24 }, (_, i) => i * 15),
    );
  });

  it("draws independently of the pattern, so a hue clash is not a full clash", () => {
    // Same hue bucket, different marks — the pair a single-axis identity
    // would collapse into one.
    const clash = ["Security review", "General purpose"];
    expect(glyphHue(clash[0])).toBe(glyphHue(clash[1]));
    expect(glyphCells(clash[0])).not.toEqual(glyphCells(clash[1]));
  });
});
