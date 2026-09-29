import { describe, expect, it } from "vitest";
import { moveIdByStep, reorderIds } from "./sortable-list";

const IDS = ["health", "history", "home"] as const;

describe("reorderIds", () => {
  it("moves an item up into the slot it was dropped on", () => {
    expect(reorderIds(IDS, "home", "health")).toEqual([
      "home",
      "health",
      "history",
    ]);
  });

  it("moves an item down into the slot it was dropped on", () => {
    expect(reorderIds(IDS, "health", "history")).toEqual([
      "history",
      "health",
      "home",
    ]);
  });

  it("reports no move for a drop on itself or an unknown id", () => {
    expect(reorderIds(IDS, "health", "health")).toBeNull();
    expect(reorderIds(IDS, "missing", "home")).toBeNull();
    expect(reorderIds(IDS, "home", "missing")).toBeNull();
  });
});

describe("moveIdByStep", () => {
  it("swaps an item with its neighbour", () => {
    expect(moveIdByStep(IDS, "history", "up")).toEqual([
      "history",
      "health",
      "home",
    ]);
    expect(moveIdByStep(IDS, "history", "down")).toEqual([
      "health",
      "home",
      "history",
    ]);
  });

  it("reports no move past either end or for an unknown id", () => {
    expect(moveIdByStep(IDS, "health", "up")).toBeNull();
    expect(moveIdByStep(IDS, "home", "down")).toBeNull();
    expect(moveIdByStep(IDS, "missing", "up")).toBeNull();
  });
});
