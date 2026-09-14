import { describe, expect, it } from "vitest";
import {
  CODE_FONT_SIZE_VAR,
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_INTERFACE_FONT_SIZE,
  MAX_CODE_FONT_SIZE,
  MAX_INTERFACE_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_INTERFACE_FONT_SIZE,
  applyAppearanceFontSizes,
  clampCodeFontSize,
  clampInterfaceFontSize,
  isFontSize,
} from "./appearance-fonts";

describe("clampInterfaceFontSize", () => {
  it("passes through in-range sizes", () => {
    expect(clampInterfaceFontSize(16)).toBe(16);
    expect(clampInterfaceFontSize(MIN_INTERFACE_FONT_SIZE)).toBe(MIN_INTERFACE_FONT_SIZE);
    expect(clampInterfaceFontSize(MAX_INTERFACE_FONT_SIZE)).toBe(MAX_INTERFACE_FONT_SIZE);
  });

  it("clamps to the bounds", () => {
    expect(clampInterfaceFontSize(2)).toBe(MIN_INTERFACE_FONT_SIZE);
    expect(clampInterfaceFontSize(96)).toBe(MAX_INTERFACE_FONT_SIZE);
  });

  it("rounds fractional sizes so text never lands on a subpixel", () => {
    expect(clampInterfaceFontSize(16.4)).toBe(16);
    expect(clampInterfaceFontSize(16.5)).toBe(17);
  });

  it("falls back for non-finite input", () => {
    expect(clampInterfaceFontSize(Number.NaN)).toBe(DEFAULT_INTERFACE_FONT_SIZE);
    expect(clampInterfaceFontSize(Number.POSITIVE_INFINITY)).toBe(DEFAULT_INTERFACE_FONT_SIZE);
  });
});

describe("clampCodeFontSize", () => {
  it("clamps to its own bounds", () => {
    expect(clampCodeFontSize(1)).toBe(MIN_CODE_FONT_SIZE);
    expect(clampCodeFontSize(40)).toBe(MAX_CODE_FONT_SIZE);
    expect(clampCodeFontSize(13.4)).toBe(13);
  });

  it("falls back for non-finite input", () => {
    expect(clampCodeFontSize(Number.NaN)).toBe(DEFAULT_CODE_FONT_SIZE);
  });
});

describe("isFontSize", () => {
  it("accepts finite numbers only", () => {
    expect(isFontSize(14)).toBe(true);
    expect(isFontSize(Number.NaN)).toBe(false);
    expect(isFontSize("14")).toBe(false);
    expect(isFontSize(null)).toBe(false);
  });
});

// The suite runs in the `node` environment (no jsdom in this repo), so the root
// element is the small stand-in below rather than a real one — the function
// only ever touches `style.fontSize` and `style.setProperty`.
function stubRoot() {
  const properties = new Map<string, string>();
  const style = {
    fontSize: "",
    setProperty: (name: string, value: string) => void properties.set(name, value),
  };
  return {
    element: { style } as unknown as HTMLElement,
    fontSize: () => style.fontSize,
    property: (name: string) => properties.get(name) ?? "",
  };
}

describe("applyAppearanceFontSizes", () => {
  it("writes the interface size as the root font size", () => {
    const root = stubRoot();
    applyAppearanceFontSizes(root.element, { interfaceFontSize: 18, codeFontSize: 14 });
    expect(root.fontSize()).toBe("18px");
  });

  it("publishes the code size on its own property, in absolute pixels", () => {
    const root = stubRoot();
    applyAppearanceFontSizes(root.element, { interfaceFontSize: 18, codeFontSize: 14 });
    expect(root.property(CODE_FONT_SIZE_VAR)).toBe("14px");
  });

  it("clamps at the seam, so a corrupt stored value cannot render unreadable text", () => {
    const root = stubRoot();
    applyAppearanceFontSizes(root.element, {
      interfaceFontSize: 400,
      codeFontSize: Number.NaN,
    });
    expect(root.fontSize()).toBe(`${MAX_INTERFACE_FONT_SIZE}px`);
    expect(root.property(CODE_FONT_SIZE_VAR)).toBe(`${DEFAULT_CODE_FONT_SIZE}px`);
  });
});
