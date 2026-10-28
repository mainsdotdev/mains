import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { ColorValue, ImageStyle, StyleProp, TextStyle } from "react-native";

import { androidSymbol } from "@/lib/android-symbols";
import { useThemeColors } from "@/theme";

/** Retain call-site names while providing native Android icons. */
export function SFSymbol({ name, size = 18, tint, style }: {
  name: string; size?: number; tint?: ColorValue; style?: StyleProp<ImageStyle>;
}) {
  const colors = useThemeColors();
  return <MaterialCommunityIcons name={androidSymbol(name)} size={size} color={tint ?? colors.label}
    style={style as StyleProp<TextStyle>} />;
}
