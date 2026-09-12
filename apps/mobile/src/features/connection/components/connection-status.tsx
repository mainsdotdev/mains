import { View } from "react-native";

import type { ConnectionState } from "@/backend/connection-supervisor";
import { connectionLabel, connectionTone, type Tone } from "@/lib/format";
import { colors, spacing, useBrandColors, useStatusColors } from "@/theme";

import { ThemedText } from "@/components/ui";

export function useToneColor(tone: Tone) {
  const brand = useBrandColors();
  return {
    accent: brand.accent,
    muted: colors.secondaryLabel,
    warning: colors.systemOrange,
    dim: colors.tertiaryLabel,
  }[tone];
}

/** A run's or tool call's status as a 7pt dot. */
export function StatusDot({ status, size = 7 }: { status: string; size?: number }) {
  const statusColors = useStatusColors();
  const color =
    statusColors[status as keyof typeof statusColors] ?? colors.tertiaryLabel;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
  );
}

/** Dot + label for the Mac connection, sized for headers and cards. */
export function ConnectionBadge({ state }: { state: ConnectionState }) {
  const color = useToneColor(connectionTone(state));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs + 2 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <ThemedText variant="footnote" style={{ color, fontWeight: "600" }}>
        {connectionLabel(state)}
      </ThemedText>
    </View>
  );
}
