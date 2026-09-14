import { useColorScheme, type ColorValue } from "react-native";

import { iconTint, parseIcon } from "@mains/icons/registry";
import { colors, mixToward } from "@/theme";

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

/**
 * How far a project's name is pulled toward the page's own extreme — almost
 * all the way. The name is the loudest thing in its row, and in the tint at
 * full strength it stops reading as a title and starts reading as a status;
 * this leaves it a label in the text colour that merely carries the project's
 * hue, the way the icon beside it says the same thing out loud.
 *
 * Raise it to whisper, lower it to shout.
 */
const NAME_SOFTNESS = 0;

/**
 * The colour a project's name is set in: its picked tint, softened almost to
 * the text colour. Pulls toward white in dark and toward black in light, so
 * the hue survives in both and the contrast does too.
 *
 * A project with no icon, or one whose icon carries no colour, keeps the plain
 * label colour — a name with nothing to tint should not read as a washed-out
 * version of one that has.
 */
export function useProjectNameColor(icon: string | null): ColorValue {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const parsed = parseIcon(icon);
  const tint = parsed?.type === "icon" ? iconTint(parsed.color, scheme) : undefined;
  if (!tint) return colors.label;
  return mixToward(tint, scheme === "dark" ? "#ffffff" : "#000000", NAME_SOFTNESS);
}
