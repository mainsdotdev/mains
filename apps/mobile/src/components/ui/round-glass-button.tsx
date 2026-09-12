import { isValidElement, type ReactElement } from "react";
import { Pressable, View } from "react-native";

import { colors, spacing, useBrandColors } from "@/theme";

import { GlassSurface } from "./glass-surface";
import { SFSymbol } from "./sf-symbol";
import { ThemedText } from "./themed-text";

/**
 * A round glass button with an SF Symbol (or a custom glyph element) — the
 * floating controls on home and the search / settings buttons in the sidebar.
 * An optional count badge sits on its top-right corner.
 */
export function RoundGlassButton({
  icon,
  label,
  badge,
  size = 46,
  onPress,
}: {
  /** An SF Symbol name, or an already-sized glyph element. */
  icon: string | ReactElement;
  label: string;
  badge?: number;
  size?: number;
  onPress: () => void;
}) {
  const brand = useBrandColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}>
      {({ pressed }) => (
        <View style={{ opacity: pressed ? 0.7 : 1 }}>
          <GlassSurface
            interactive
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isValidElement(icon) ? (
              icon
            ) : (
              <SFSymbol name={icon} size={Math.round(size * 0.55)} tint={colors.label} />
            )}
          </GlassSurface>
          {badge !== undefined && (
            <View
              style={{
                position: "absolute",
                top: -4,
                right: -4,
                minWidth: 20,
                height: 20,
                paddingHorizontal: spacing.xs + 1,
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: brand.accent,
              }}
            >
              <ThemedText
                variant="caption2"
                style={{ color: brand.accentContrast, fontWeight: "700", fontVariant: ["tabular-nums"] }}
              >
                {badge}
              </ThemedText>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}
