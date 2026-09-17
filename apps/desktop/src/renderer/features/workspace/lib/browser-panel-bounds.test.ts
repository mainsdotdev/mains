import { describe, expect, it } from "vitest";
import { browserPanelBounds } from "./browser-panel-bounds";

describe("browserPanelBounds", () => {
  it("fills the viewport without leaving a resize-handle gutter", () => {
    expect(
      browserPanelBounds({
        left: 120.4,
        top: 90.6,
        width: 640.2,
        height: 480.4,
      }),
    ).toEqual({
      x: 120,
      y: 91,
      width: 640,
      height: 480,
    });
  });
});
