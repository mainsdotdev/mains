import { MenuView } from "@expo/ui/community/menu";
import { View } from "react-native";

import { GlassSurface, SFSymbol, ThemedText } from "@/components/ui";
import { modeLabel, type ModeId } from "@mains/contracts/runs";
import { useThemeColors, radius, spacing } from "@/theme";

/** The native popup fits the home pill without clipping a Material text-field anchor. */
export function ModeMenu({ modes, value, pending = false, onChange }: {
  modes: readonly ModeId[]; value: ModeId; pending?: boolean; onChange: (mode: ModeId) => void;
}) {
  const colors = useThemeColors();
  return <MenuView actions={modes.map((mode) => ({
    id: mode, title: modeLabel(mode), state: mode === value ? "on" : "off",
    attributes: { disabled: pending },
  }))} onPressAction={({ nativeEvent }) => {
    const next = nativeEvent.event as ModeId;
    if (!pending && modes.includes(next)) onChange(next);
  }}>
    <View collapsable={false} accessibilityRole="button" accessibilityLabel="Conversation mode"
      accessibilityValue={{ text: modeLabel(value) }} accessibilityState={{ disabled: pending }}>
    <GlassSurface interactive
      style={{ height: 46, paddingHorizontal: spacing.ml, borderRadius: radius.full,
        flexDirection: "row", gap: spacing.xs, alignItems: "center", opacity: pending ? 0.6 : 1 }}>
      <ThemedText variant="callout" style={{ fontWeight: "600" }}>{modeLabel(value)}</ThemedText>
      {modes.length > 1 ? <SFSymbol name="chevron.down" size={13} tint={colors.secondaryLabel} /> : null}
    </GlassSurface>
    </View>
  </MenuView>;
}
