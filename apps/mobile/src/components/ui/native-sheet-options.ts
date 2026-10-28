import { Platform } from "react-native";

import type { ThemeColors } from "@/theme";

/** iOS supplies the sheet material; Android needs an explicit opaque surface. */
export function nativeSheetOptions(sheetAllowedDetents: number[], colors: ThemeColors) {
  return {
    presentation: "formSheet" as const,
    headerShown: false,
    sheetGrabberVisible: true,
    sheetAllowedDetents,
    sheetCornerRadius: Platform.OS === "android" ? 28 : undefined,
    headerStyle: Platform.OS === "android" ? { backgroundColor: colors.sheetBackground } : undefined,
    contentStyle: {
      backgroundColor: Platform.OS === "ios" ? "transparent" : colors.sheetBackground,
    },
  };
}
