import type { TextStyle } from "react-native";

/** SF Pro by way of the system font, on Apple's text-style ramp. */
export const type = {
  largeTitle: { fontSize: 34, fontWeight: "700", letterSpacing: 0.4 },
  title: { fontSize: 28, fontWeight: "700", letterSpacing: 0.36 },
  title2: { fontSize: 22, fontWeight: "700", letterSpacing: 0.35 },
  title3: { fontSize: 20, fontWeight: "600", letterSpacing: 0.38 },
  headline: { fontSize: 17, fontWeight: "600", letterSpacing: -0.4 },
  body: { fontSize: 16, fontWeight: "400", letterSpacing: -0.4, lineHeight: 22 },
  callout: { fontSize: 16, fontWeight: "400", letterSpacing: -0.3, lineHeight: 21 },
  /**
   * Chat prose — `callout`'s size with the leading a wall of text needs. A
   * transcript is read in paragraphs, not glanced at like a list row, and
   * callout's 21pt line box sets them too tight to scan.
   */
  prose: { fontSize: 16, fontWeight: "400", letterSpacing: -0.3, lineHeight: 24 },
  subhead: { fontSize: 15, fontWeight: "400", letterSpacing: -0.2, lineHeight: 20 },
  footnote: { fontSize: 13, fontWeight: "400", letterSpacing: -0.08, lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: "400" },
  caption2: { fontSize: 11, fontWeight: "400" },
  /** Paths, tool names, ids — monospaced, tabular. */
  mono: {
    fontSize: 13,
    fontFamily: process.env.EXPO_OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 18,
    fontVariant: ["tabular-nums"],
  },
  monoCaption: {
    fontSize: 11,
    fontFamily: process.env.EXPO_OS === "ios" ? "Menlo" : "monospace",
    fontVariant: ["tabular-nums"],
  },
} as const satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;
