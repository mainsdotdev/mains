import { describe, expect, it } from "vitest";
import { getWideVisualizationLayout } from "./visualization-artifact";

describe("getWideVisualizationLayout", () => {
  it("uses the full transcript viewport without an artificial gutter", () => {
    expect(getWideVisualizationLayout(600, 900)).toEqual({
      width: 900,
      marginLeft: -150,
    });
  });

  it("keeps very wide visualizations bounded and centered", () => {
    expect(getWideVisualizationLayout(700, 1_400)).toEqual({
      width: 1024,
      marginLeft: -162,
    });
  });
});
