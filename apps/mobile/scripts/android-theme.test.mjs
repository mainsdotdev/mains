import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { semanticPalette } from "../src/theme/semantic-palette.ts";

const mocks = {
  "react-native": `const platform = () => process.env.MAINS_THEME_TEST_PLATFORM || "android";
    export const Platform = { get OS() { return platform(); } };
    export const useColorScheme = () => process.env.MAINS_THEME_TEST_SCHEME || "light";
    export function DynamicColorIOS(value) {
      if (platform() !== "ios") throw new Error("DynamicColorIOS evaluated on Android");
      return { dynamic: value };
    }`,
  "expo-router": `export const Color = {
    ios: new Proxy({}, { get(_, name) {
      if (process.env.MAINS_THEME_TEST_PLATFORM !== "ios") throw new Error("iOS semantic color evaluated on Android");
      return "ios:" + String(name);
    } }),
    get android() { throw new Error("Android colors must come from the reactive palette"); }
  };`,
};
registerHooks({ resolve(specifier, context, nextResolve) {
  if (Object.hasOwn(mocks, specifier)) return {
    url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true,
  };
  return nextResolve(specifier, context);
} });

test("Android initializes without iOS APIs and reads the current appearance on each render", async () => {
  const { useThemeColors } = await import("../src/theme/colors.ts");
  assert.deepEqual(useThemeColors(), semanticPalette.light);
  process.env.MAINS_THEME_TEST_SCHEME = "dark";
  try {
    assert.deepEqual(useThemeColors(), semanticPalette.dark);
  } finally { delete process.env.MAINS_THEME_TEST_SCHEME; }
});

test("iOS keeps its semantic colors and dynamic card fill without evaluating Android APIs", async () => {
  process.env.MAINS_THEME_TEST_PLATFORM = "ios";
  try {
    const { useThemeColors } = await import("../src/theme/colors.ts?platform=ios");
    const colors = useThemeColors();
    assert.equal(colors.label, "ios:label");
    assert.equal(colors.systemBackground, "ios:systemBackground");
    assert.deepEqual(colors.cardSurface, { dynamic: { light: "#F7F7F8", dark: "#1C1C1E" } });
  } finally { delete process.env.MAINS_THEME_TEST_PLATFORM; }
});

test("both Android palettes cover the same tokens and retain readable body and secondary text", () => {
  assert.deepEqual(Object.keys(semanticPalette.light), Object.keys(semanticPalette.dark));
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/../g).map((channel) => parseInt(channel, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  for (const palette of Object.values(semanticPalette)) {
    for (const color of Object.values(palette)) assert.match(color, /^#[0-9a-f]{6}$/i);
    for (const text of [palette.label, palette.secondaryLabel]) {
      for (const background of [palette.systemBackground, palette.cardSurface]) {
        const [dark, light] = [luminance(text), luminance(background)].sort((a, b) => a - b);
        assert.ok((light + 0.05) / (dark + 0.05) >= 4.5);
      }
    }
  }
});
