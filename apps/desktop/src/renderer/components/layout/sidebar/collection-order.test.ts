import { describe, expect, it } from "vitest";
import { moveCollectionId } from "./collection-order";

describe("moveCollectionId", () => {
  it("moves a project before the hovered project", () => {
    expect(
      moveCollectionId(["health", "history", "home"], "home", "health", "before"),
    ).toEqual(["home", "health", "history"]);
  });

  it("moves a project after the hovered project", () => {
    expect(
      moveCollectionId(["health", "history", "home"], "health", "history", "after"),
    ).toEqual(["history", "health", "home"]);
  });

  it("leaves the order unchanged for an invalid or same-row drop", () => {
    const ids = ["health", "history", "home"];
    expect(moveCollectionId(ids, "health", "health", "after")).toEqual(ids);
    expect(moveCollectionId(ids, "missing", "home", "before")).toEqual(ids);
  });
});
