import type { TextStyle } from "react-native";

import { colors } from "./colors";

/** SF Pro by way of the system font, on Apple's text-style ramp. */
export const type = {
  largeTitle: { fontSize: 34, fontWeight: "700", letterSpacing: 0.4, color: colors.label },
  title: { fontSize: 28, fontWeight: "700", letterSpacing: 0.36, color: colors.label },
  title2: { fontSize: 22, fontWeight: "700", letterSpacing: 0.35, color: colors.label },
  title3: { fontSize: 20, fontWeight: "600", letterSpacing: 0.38, color: colors.label },
  headline: { fontSize: 17, fontWeight: "600", letterSpacing: -0.4, color: colors.label },
  body: { fontSize: 16, fontWeight: "400", letterSpacing: -0.4, lineHeight: 22, color: colors.label },
  callout: { fontSize: 16, fontWeight: "400", letterSpacing: -0.3, lineHeight: 21, color: colors.label },
  /**
   * Chat prose — `callout`'s size with the leading a wall of text needs. A
   * transcript is read in paragraphs, not glanced at like a list row, and
   * callout's 21pt line box sets them too tight to scan.
   */
  prose: { fontSize: 16, fontWeight: "400", letterSpacing: -0.3, lineHeight: 24, color: colors.label },
  subhead: { fontSize: 15, fontWeight: "400", letterSpacing: -0.2, lineHeight: 20, color: colors.secondaryLabel },
  footnote: { fontSize: 13, fontWeight: "400", letterSpacing: -0.08, lineHeight: 18, color: colors.secondaryLabel },
  caption: { fontSize: 12, fontWeight: "400", color: colors.secondaryLabel },
  caption2: { fontSize: 11, fontWeight: "400", color: colors.tertiaryLabel },
  /** Paths, tool names, ids — monospaced, tabular. */
  mono: {
    fontSize: 13,
    fontFamily: "Menlo",
    lineHeight: 18,
    fontVariant: ["tabular-nums"],
    color: colors.secondaryLabel,
  },
  monoCaption: {
    fontSize: 11,
    fontFamily: "Menlo",
    fontVariant: ["tabular-nums"],
    color: colors.tertiaryLabel,
  },
} as const satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;
