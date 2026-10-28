import { useRouter, type Href } from "expo-router";
import { Pressable, View } from "react-native";

import type { RunRow as RunRecord } from "@/db/schema";
import { runStatusLabel } from "@/lib/format";
import { useThemeColors, radius, spacing } from "@/theme";

import { SFSymbol, ThemedText } from "@/components/ui";

/** One run in a list: status dot, title, workspace · mode, and when. */
export function RunRow({
  run,
  onNavigate,
  grouped = true,
}: {
  run: RunRecord;
  workspaceName?: string;
  /** Extra work when the row is tapped (e.g. closing the sidebar). */
  onNavigate?: () => void;
  /** Grouped cells (inside a rounded container) vs plain rows (sidebar). */
  grouped?: boolean;
}) {
  const colors = useThemeColors();
  const router = useRouter();
  // Another computer's status is only as fresh as its last sync, so a replica
  // shows where it runs instead of a "Running" that may have ended long ago.
  const live = !run.isReplica && (run.status === "running" || run.status === "queued");
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        onNavigate?.();
        router.push(`/run/${run.id}` as Href);
      }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.ms,
        paddingVertical: spacing.xs + 2,
        paddingHorizontal: spacing.md,
        borderRadius: grouped ? 0 : radius.sm,
        borderCurve: "continuous",
        backgroundColor: pressed ? colors.fill : "transparent",
      })}
    >
      <View style={{ flex: 1, gap: spacing.xxs }}>
        <ThemedText variant="body" numberOfLines={1} style={{ fontWeight: "400" }}>
          {run.title?.trim() || "Untitled run"}
        </ThemedText>

      </View>
      {run.isReplica ? (
        <View accessible accessibilityLabel="On another computer, read-only">
          <SFSymbol name="laptopcomputer" size={15} tint={colors.tertiaryLabel} />
        </View>
      ) : (
        <ThemedText variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
          {live ? runStatusLabel(run.status) : null}
        </ThemedText>
      )}
    </Pressable>
  );
}
