import { describe, expect, it } from "vitest";
import { visibleTurnMarkerGroupIds } from "./turn-rail";

const positions = [
  { groupId: "first", top: 100 },
  { groupId: "second", top: 400 },
  { groupId: "third", top: 900 },
];

describe("visibleTurnMarkerGroupIds", () => {
  it("keeps the turn active while its reply occupies the viewport", () => {
    expect([...visibleTurnMarkerGroupIds(positions, 500, 800, 1_400)]).toEqual([
      "second",
    ]);
  });

  it("marks adjacent turns when the viewport crosses their boundary", () => {
    expect([...visibleTurnMarkerGroupIds(positions, 350, 450, 1_400)]).toEqual([
      "first",
      "second",
    ]);
  });

  it("uses the content end as the final turn boundary", () => {
    expect([
      ...visibleTurnMarkerGroupIds(positions, 1_100, 1_300, 1_400),
    ]).toEqual(["third"]);
  });
});
