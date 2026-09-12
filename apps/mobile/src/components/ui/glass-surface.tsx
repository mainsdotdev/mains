import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";

import { colors } from "@/theme";

/**
 * A floating layer over content: Liquid Glass on iOS 26+, system-material blur
 * on older iOS, a plain surface elsewhere. Used only for things that float —
 * the composer bar, round buttons, pills — never for content cards. On a flat
 * background it reads as the soft grey disc the ChatGPT sidebar uses.
 */
export function GlassSurface({
  children,
  style,
  interactive = false,
  effect = "regular",
  tintColor,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  interactive?: boolean;
  effect?: "regular" | "clear";
  /** A wash over the glass (a translucent color); ignored by the fallbacks. */
  tintColor?: string;
}) {
  if (process.env.EXPO_OS === "ios") {
    if (isLiquidGlassAvailable()) {
      return (
        <GlassView glassEffectStyle={effect} isInteractive={interactive} tintColor={tintColor} style={style}>
          {children}
        </GlassView>
      );
    }
    return (
      <BlurView tint="systemMaterial" intensity={90} style={[{ overflow: "hidden" }, style]}>
        {children}
      </BlurView>
    );
  }
  return (
    <View style={[{ backgroundColor: colors.secondarySystemBackground }, style]}>{children}</View>
  );
}
