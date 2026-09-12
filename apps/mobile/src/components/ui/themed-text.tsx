import { Text, type TextProps } from "react-native";

import { type, type TypeVariant } from "@/theme";

/** The only way screens set text styles: a ramp step, never a font size. */
export function ThemedText({
  variant = "body",
  style,
  ...props
}: TextProps & { variant?: TypeVariant }) {
  return <Text style={[type[variant], style]} {...props} />;
}
