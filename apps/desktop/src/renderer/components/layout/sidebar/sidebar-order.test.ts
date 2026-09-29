import { describe, expect, it } from "vitest";
import { reorderVisibleIds } from "./sidebar-order";

describe("reorderVisibleIds", () => {
  it("reorders one project or pin group without moving rows outside it", () => {
    expect(reorderVisibleIds(["a", "hidden", "b", "other", "c"], ["c", "a", "b"]))
      .toEqual(["c", "hidden", "a", "other", "b"]);
  });

  it("rejects an incomplete or duplicate displayed order", () => {
    expect(reorderVisibleIds(["a", "b", "c"], ["b", "b"])).toEqual(["a", "b", "c"]);
    expect(reorderVisibleIds(["a", "b", "c"], ["b", "missing"])).toEqual(["a", "b", "c"]);
  });
});
