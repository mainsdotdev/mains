import { Platform, ScrollView, type ScrollViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { spacing } from "@/theme";

import { sheetContentStyle } from "./sheet-rows";

/** Bounded content for fractional native sheets, including Android nested scroll. */
export function SheetScrollView({ style, contentContainerStyle, ...props }: ScrollViewProps) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      nestedScrollEnabled={Platform.OS === "android"}
      {...props}
      style={[Platform.OS === "android" && { flex: 1 }, style]}
      contentContainerStyle={[
        sheetContentStyle,
        { paddingBottom: Math.max(spacing.xxl, insets.bottom + spacing.md) },
        contentContainerStyle,
      ]}
    />
  );
}
