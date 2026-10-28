import { Text, type TextProps } from "react-native";

import { type, type TypeVariant, useThemeColors } from "@/theme";

/** The only way screens set text styles: a ramp step, never a font size. */
export function ThemedText({
  variant = "body",
  style,
  ...props
}: TextProps & { variant?: TypeVariant }) {
  const colors = useThemeColors();
  const color = variant === "caption2"
    ? colors.tertiaryLabel
    : ["subhead", "footnote", "caption", "mono", "monoCaption"].includes(variant)
      ? colors.secondaryLabel
      : colors.label;
  return <Text style={[type[variant], { color }, style]} {...props} />;
}
