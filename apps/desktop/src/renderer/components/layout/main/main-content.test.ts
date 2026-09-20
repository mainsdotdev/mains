import { describe, expect, it } from "vitest";
import { getCollapsedHeaderPaddingLeft } from "./main-content";

describe("getCollapsedHeaderPaddingLeft", () => {
  it("reserves only the toggle after the mode picker moved into the sidebar", () => {
    expect(getCollapsedHeaderPaddingLeft(true, true, false)).toBe("7rem");
    expect(getCollapsedHeaderPaddingLeft(true, false, false)).toBe("3rem");
    expect(getCollapsedHeaderPaddingLeft(true, true, true)).toBe("3rem");
  });

  it("adds no header inset while the sidebar is open", () => {
    expect(getCollapsedHeaderPaddingLeft(false, true, false)).toBeUndefined();
  });
});
