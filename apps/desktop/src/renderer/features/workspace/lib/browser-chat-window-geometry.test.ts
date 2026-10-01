import { describe, expect, it } from "vitest";
import { browserChatWindowGeometry } from "./browser-chat-window-geometry";

describe("native browser chat geometry", () => {
  it("stays fixed while the right-anchored browser panel expands leftward", () => {
    const narrow = { x: 900, y: 100, right: 1400, bottom: 900, width: 500, height: 800 };
    const wide = { x: 300, y: 100, right: 1400, bottom: 900, width: 1100, height: 800 };

    expect(browserChatWindowGeometry(narrow, "details"))
      .toEqual(browserChatWindowGeometry(wide, "details"));
  });

  it("moves the input card's top edge upward as the composer wraps", () => {
    const stage = { y: 100, right: 1400, height: 800 };
    const singleLine = browserChatWindowGeometry(stage, "input", 48).card;
    const wrapped = browserChatWindowGeometry(stage, "input", 76).card;

    expect(wrapped.height).toBe(76);
    expect(wrapped.y).toBe(singleLine.y - 28);
    expect(wrapped.y + wrapped.height).toBe(singleLine.y + singleLine.height);
  });

  it("grows the details card so wrapped input does not reduce transcript space", () => {
    const stage = { y: 100, right: 1400, height: 800 };
    const singleLine = browserChatWindowGeometry(stage, "details", 48).card;
    const wrapped = browserChatWindowGeometry(stage, "details", 76).card;

    expect(wrapped.height - singleLine.height).toBe(28);
    expect(wrapped.y + wrapped.height).toBe(singleLine.y + singleLine.height);
  });
});
