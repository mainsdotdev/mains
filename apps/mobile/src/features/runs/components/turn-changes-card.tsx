import { useState } from "react";
import { Pressable, View } from "react-native";
import type { RunTurnChangesSummary } from "@mains/contracts/runs";

import { SFSymbol, ThemedText } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";
import { HistoryContentLink } from "./history-content-link";

/** Read the stored turn patch; the phone never needs filesystem or git mutation access. */
export function TurnChangesCard({ runId, turnId, turnIndex, changes }: {
  runId: string; turnId: number; turnIndex: number; changes: RunTurnChangesSummary;
}) {
  const [expanded, setExpanded] = useState(false);
  const count = changes.fileCount ?? changes.files.length;
  const files = expanded ? changes.files : changes.files.slice(0, 2);
  return (
    <View style={{ marginTop: spacing.sm, padding: spacing.ms, gap: spacing.sm, backgroundColor: colors.fill, borderRadius: radius.lg, borderCurve: "continuous" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <SFSymbol name="doc.text" size={15} tint={colors.secondaryLabel} />
        <ThemedText variant="footnote" style={{ flex: 1, color: colors.label, fontWeight: "600" }}>
          {changes.undoneAt ? "Changes undone" : `Edited ${count} file${count === 1 ? "" : "s"}`}
        </ThemedText>
        <ThemedText variant="caption" style={{ color: colors.systemGreen }}>+{changes.additions}</ThemedText>
        <ThemedText variant="caption" style={{ color: colors.systemRed }}>−{changes.deletions}</ThemedText>
      </View>
      <ThemedText variant="caption2">Turn {turnIndex + 1}</ThemedText>
      {files.map((file) => (
        <View key={file.path} style={{ gap: spacing.xxs }}>
          <ThemedText variant="monoCaption" numberOfLines={2}>
            {file.oldPath ? `${file.oldPath} → ` : ""}{file.path}
          </ThemedText>
          <ThemedText variant="caption2">
            {file.status}{file.binary ? " · binary" : ` · +${file.additions} −${file.deletions}`}{file.shared ? " · also edited by another run" : ""}
          </ThemedText>
        </View>
      ))}
      {changes.files.length > 2 ? (
        <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={{ paddingVertical: spacing.xs }}>
          <ThemedText variant="caption">{expanded ? "Show fewer files" : `Show ${changes.files.length - 2} more files`}</ThemedText>
        </Pressable>
      ) : null}
      {count > changes.files.length ? <ThemedText variant="caption">The file list is too large to preview. Open the diff to read it.</ThemedText> : null}
      {changes.truncated ? <ThemedText variant="caption">Only part of this turn’s diff was stored.</ThemedText> : null}
      <HistoryContentLink runId={runId} source="turn-diff" id={turnId} label="Review diff" />
    </View>
  );
}
