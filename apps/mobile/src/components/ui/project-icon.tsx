import { useColorScheme, type ColorValue } from "react-native";

import { iconTint, parseIcon } from "@mains/icons/registry";

import { RegistryIcon } from "./registry-icon";
import { SFSymbol } from "./sf-symbol";
import { ThemedText } from "./themed-text";

/**
 * A project's (collection's) icon as the desktop draws it: its registry icon
 * in its tint, its emoji, or a folder when none is set.
 */
export function ProjectIcon({ icon, size, color }: { icon: string | null; size: number; color: ColorValue }) {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const parsed = parseIcon(icon);
  if (parsed?.type === "icon") {
    return <RegistryIcon shape={parsed.shape} size={size} color={iconTint(parsed.color, scheme) ?? color} />;
  }
  if (parsed?.type === "emoji") {
    return <ThemedText style={{ fontSize: size, lineHeight: size * 1.2 }}>{parsed.value}</ThemedText>;
  }
  return <SFSymbol name="folder" size={size} tint={color} />;
}
