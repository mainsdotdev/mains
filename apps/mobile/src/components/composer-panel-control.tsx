import { Pressable, View } from "react-native";

import { colors, radius } from "@/theme";

import { GlassSurface } from "./glass-surface";
import { SFSymbol } from "./sf-symbol";

/**
 * A round control that floats over one of the composer's expanded panels —
 * the camera preview, the photo grid. Both panels put their own content edge
 * to edge and let these sit on top of it, so the control carries its own dark
 * scrim rather than relying on whatever it happens to cover.
 */
export function ComposerPanelControl({
  label,
  icon,
  size = 56,
  onPress,
  style,
}: {
  label: string;
  icon: string;
  size?: number;
  onPress: () => void;
  style: { left?: number; right?: number; top?: number; bottom?: number };
}) {
  return (
    <GlassSurface
      effect="clear"
      interactive
      style={{
        position: "absolute",
        ...style,
        width: size,
        height: size,
        borderRadius: radius.full,
        overflow: "hidden",
        backgroundColor: "rgba(0, 0, 0, 0.28)",
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.65 : 1,
        })}
      >
        <SFSymbol name={icon} size={Math.round(size * 0.41)} tint={colors.onTint} />
      </Pressable>
    </GlassSurface>
  );
}

/** The same control with a label beside the glyph, for a wider affordance. */
export function ComposerPanelPill({
  label,
  icon,
  onPress,
  style,
  children,
}: {
  label: string;
  icon?: string;
  onPress: () => void;
  style: { left?: number; right?: number; top?: number; bottom?: number };
  children: React.ReactNode;
}) {
  return (
    <GlassSurface
      effect="clear"
      interactive
      style={{
        position: "absolute",
        ...style,
        height: 44,
        borderRadius: radius.full,
        overflow: "hidden",
        backgroundColor: "rgba(0, 0, 0, 0.28)",
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 14,
          opacity: pressed ? 0.65 : 1,
        })}
      >
        {icon ? <SFSymbol name={icon} size={15} tint={colors.onTint} /> : null}
        <View>{children}</View>
      </Pressable>
    </GlassSurface>
  );
}
