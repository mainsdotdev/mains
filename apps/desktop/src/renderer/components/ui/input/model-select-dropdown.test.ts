import { describe, it, expect } from "vitest";
import { isPointerHeadingToSubmenu } from "./model-select-dropdown";

// The effort submenu is anchored to its model row and opens to the right of the
// model menu, so the normal travel path is short and roughly horizontal. It
// only turns diagonal when a tall submenu gets clamped into the viewport — the
// case these tests pin down, using the geometry from a real Claude picker
// (model menu x 293–673 with ~72px rows; submenu x 687–969, clamped to
// y 225–670 because it is taller than the space below its row).
const SUBMENU = { left: 687, right: 969, top: 225, bottom: 670 };
const SONNET_ROW = { x: 480, y: 569 };

describe("isPointerHeadingToSubmenu", () => {
  it("treats the diagonal sweep toward the submenu as travel", () => {
    // Aiming for "Low" (y≈326) from the Sonnet row crosses the Fable 5 and
    // Opus 5 rows. Both crossings must read as travel, not as intent.
    const overFable = { x: 560, y: 497 };
    const overOpus = { x: 640, y: 425 };

    expect(isPointerHeadingToSubmenu(overFable, SONNET_ROW, SUBMENU)).toBe(true);
    expect(isPointerHeadingToSubmenu(overOpus, SONNET_ROW, SUBMENU)).toBe(true);
  });

  it("covers the row-anchored path, which is nearly horizontal", () => {
    // The normal case after row anchoring: Cursor's short low/medium/high
    // submenu opens level with its own row, so the corridor is wide and flat.
    const topRow = { x: 330, y: 320 };
    const alongside = { left: 540, right: 870, top: 300, bottom: 480 };

    expect(isPointerHeadingToSubmenu({ x: 450, y: 350 }, topRow, alongside)).toBe(
      true,
    );
    expect(isPointerHeadingToSubmenu({ x: 520, y: 420 }, topRow, alongside)).toBe(
      true,
    );
  });

  it("narrows toward the anchor, so a down-first detour is browsing", () => {
    // The corridor is a triangle, not a box: leaving the row straight down and
    // only then turning right is not travel — it is the user reading the list,
    // and the row under the pointer should take over. Row anchoring is what
    // keeps this from being the common path.
    const topRow = { x: 330, y: 320 };
    const alongside = { left: 540, right: 870, top: 300, bottom: 480 };

    expect(isPointerHeadingToSubmenu({ x: 350, y: 470 }, topRow, alongside)).toBe(
      false,
    );
  });

  it("does not swallow a deliberate move up the model list", () => {
    // Straight up the rows, nowhere near the corridor: the pointer stays left
    // of the anchor, so browsing still switches instantly.
    expect(isPointerHeadingToSubmenu({ x: 330, y: 497 }, SONNET_ROW, SUBMENU)).toBe(
      false,
    );
    expect(isPointerHeadingToSubmenu({ x: 330, y: 425 }, SONNET_ROW, SUBMENU)).toBe(
      false,
    );
  });

  it("ends the corridor at the submenu's near edge", () => {
    // Past the edge the pointer is inside the submenu itself, not travelling.
    expect(isPointerHeadingToSubmenu({ x: 800, y: 400 }, SONNET_ROW, SUBMENU)).toBe(
      false,
    );
  });

  it("keeps the anchor row itself inside the corridor", () => {
    expect(isPointerHeadingToSubmenu(SONNET_ROW, SONNET_ROW, SUBMENU)).toBe(true);
  });

  it("mirrors the corridor when the submenu flips to the left", () => {
    // Submenu on the left (no room on the right): the near edge is its right.
    const leftSubmenu = { left: 8, right: 290, top: 225, bottom: 670 };
    const anchor = { x: 480, y: 569 };

    expect(isPointerHeadingToSubmenu({ x: 400, y: 497 }, anchor, leftSubmenu)).toBe(
      true,
    );
    // Same vertical move, but away from the submenu — genuine browsing.
    expect(isPointerHeadingToSubmenu({ x: 640, y: 497 }, anchor, leftSubmenu)).toBe(
      false,
    );
  });

  it("widens the corridor by the padding at the base", () => {
    const justBelow = { x: 686, y: SUBMENU.bottom + 6 };
    expect(isPointerHeadingToSubmenu(justBelow, SONNET_ROW, SUBMENU, 12)).toBe(true);
    expect(isPointerHeadingToSubmenu(justBelow, SONNET_ROW, SUBMENU, 0)).toBe(false);
  });
});
