import { Image } from "expo-image";
import type { ColorValue, ImageStyle, StyleProp } from "react-native";

import { colors } from "@/theme";

/**
 * An SF Symbol (iOS). Renders nothing on platforms without symbol sources.
 * Named SFSymbol on purpose: a component called `Symbol` shadows the global,
 * and the React Compiler's memo cache calls `Symbol.for` at the top of every
 * component that imports it.
 */
export function SFSymbol({
  name,
  size = 18,
  tint = colors.label,
  style,
}: {
  name: string;
  size?: number;
  tint?: ColorValue;
  style?: StyleProp<ImageStyle>;
}) {
  return (
    <Image
      source={`sf:${name}`}
      tintColor={tint as string}
      contentFit="contain"
      style={[{ width: size, height: size }, style]}
    />
  );
}
