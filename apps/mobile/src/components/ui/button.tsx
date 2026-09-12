import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { colors, radius, spacing, useBrandColors } from "@/theme";

import { ThemedText } from "./themed-text";

type Variant = "primary" | "secondary" | "destructive" | "ghost";
type Size = "sm" | "md";

const sizes = {
  sm: { paddingVertical: spacing.sm, paddingHorizontal: spacing.ms, minHeight: 36 },
  md: { paddingVertical: spacing.ms, paddingHorizontal: spacing.md, minHeight: 46 },
} as const;

export function Button({
  title,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  style,
  onPress,
}: {
  title: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const brand = useBrandColors();
  const palette = {
    primary: { background: brand.accent, text: brand.accentContrast },
    secondary: { background: colors.fill, text: colors.label },
    destructive: { background: colors.fill, text: colors.systemRed },
    ghost: { background: "transparent", text: brand.accent },
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: palette.background,
          borderRadius: radius.md,
          borderCurve: "continuous",
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
          ...sizes[size],
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.text as string} />
      ) : (
        <ThemedText
          variant={size === "sm" ? "subhead" : "headline"}
          style={{ color: palette.text, fontWeight: "600" }}
        >
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}
