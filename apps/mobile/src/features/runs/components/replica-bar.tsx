import { View } from "react-native";

import { GlassSurface, SFSymbol, ThemedText } from "@/components/ui";
import { useThemeColors, radius, spacing } from "@/theme";

/**
 * Another computer's conversation, reached through Bridge: it takes the
 * composer's slot and shape without any of its controls, the way the
 * desktop's `ReplicaComposerBar` does. Only the owning computer can continue,
 * fork or stop it; this backend would refuse the request.
 */
export function ReplicaBar() {
  const colors = useThemeColors();
  return (
    <View style={{ paddingHorizontal: spacing.ms }}>
      <GlassSurface
        style={{
          borderRadius: radius.xl + 8,
          borderCurve: "continuous",
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.ms,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.ms,
        }}
      >
        <SFSymbol name="lock.fill" size={15} tint={colors.secondaryLabel} />
        <View style={{ flex: 1, gap: spacing.xxs }} accessible>
          <ThemedText variant="subhead" numberOfLines={1} style={{ fontWeight: "600" }}>
            Read-only · runs on another computer
          </ThemedText>
          <ThemedText variant="footnote" numberOfLines={2} style={{ color: colors.secondaryLabel }}>
            Synced through Bridge. Continue it in Mains on that computer.
          </ThemedText>
        </View>
      </GlassSurface>
    </View>
  );
}
