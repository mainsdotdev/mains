import { useColorScheme, View } from "react-native";

import { iconTint, parseIcon } from "@mains/icons/registry";
import { colors, useProviderAccent } from "@/theme";

import { GlassSurface, RegistryIcon, ThemedText } from "@/components/ui";

/** The ring around the selected space. */
const RING = 1;

/**
 * The wash under the selected disc: the ring's colour at the weight glass can
 * carry — the same 12% / 18% the brand's own soft accent uses. Every source
 * here is a 6-digit hex (the icon registry's tints and the brand accent), so
 * the alpha is appended rather than parsed; anything else passes through.
 */
function soften(color: string, scheme: "light" | "dark"): string {
  if (!color.startsWith("#") || color.length !== 7) return color;
  return `${color}${scheme === "dark" ? "2E" : "1F"}`;
}

/**
 * A space as a round glass disc, drawn with the same icon the desktop shows
 * for it: a registry icon (in its picked tint, if any), an emoji, or — with
 * no icon set — the space's initial.
 *
 * The selected one is ringed in its provider's colour — the same source the
 * prompt bubbles and the send button draw from, so a space, its composer and
 * its answers all read as one agent.
 */
export function SpaceGlyph({
  space,
  size = 40,
  selected = false,
}: {
  space: { name: string; icon: string | null; providerId: string };
  size?: number;
  selected?: boolean;
}) {
  const selection = useProviderAccent(space.providerId);
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const icon = parseIcon(space.icon);
  const chosen = icon?.type === "icon" ? iconTint(icon.color, scheme) : undefined;
  const neutral = selected ? selection : colors.label;
  // A user-picked tint wins over the selection color, as on the desktop.
  const tint = chosen ?? neutral;
  const inner = size - RING * 2;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: RING,
        borderColor: selected ? selection : "transparent",
        // The interactive glass highlight paints past its own bounds on press;
        // without this it spills out of the disc as a square.
        overflow: "hidden",
      }}
    >
      <GlassSurface
        interactive
        tintColor={selected ? soften(selection, scheme) : undefined}
        style={{
          width: inner,
          height: inner,
          borderRadius: inner / 2,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon?.type === "icon" ? (
          <RegistryIcon shape={icon.shape} size={size * 0.5} color={tint} />
        ) : icon?.type === "emoji" ? (
          <ThemedText variant="callout">{icon.value}</ThemedText>
        ) : (
          <ThemedText variant="headline" style={{ color: neutral }}>
            {(space.name.trim()[0] ?? "?").toUpperCase()}
          </ThemedText>
        )}
      </GlassSurface>
    </View>
  );
}
