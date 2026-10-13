import { useRouter } from "expo-router";
import { Pressable } from "react-native";
import type { ReadRunHistoryContentPayload } from "@mains/contracts/runs";

import { ThemedText } from "@/components/ui";
import { colors, spacing } from "@/theme";

export function HistoryContentLink({ runId, source, id, label = "Read full content" }: ReadRunHistoryContentPayload & { label?: string }) {
  const router = useRouter();
  return <Pressable accessibilityRole="button" style={{ paddingVertical: spacing.sm }}
    onPress={() => router.push({ pathname: "/history-content", params: { runId, source, id: String(id) } })}>
    <ThemedText variant="caption" style={{ color: colors.secondaryLabel }}>{label}</ThemedText>
  </Pressable>;
}
