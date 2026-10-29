import { useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import type { RunTurnChangesSummary, TurnFileChange } from "@mains/contracts/runs";

import { FileIcon, SFSymbol, ThemedText } from "@/components/ui";
import { useThemeColors, type ThemeColors, radius, spacing } from "@/theme";
import { filePathLabel } from "../lib/file-path-label";

function DiffCounts({ additions, deletions }: { additions: number; deletions: number }) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  return (
    <View style={styles.counts}>
      <ThemedText variant="caption" numberOfLines={1} style={styles.additions}>+{additions}</ThemedText>
      <ThemedText variant="caption" numberOfLines={1} style={styles.deletions}>−{deletions}</ThemedText>
    </View>
  );
}

function ChangedFile({ file, onPress }: { file: TurnFileChange; onPress: () => void }) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const { name, directory } = filePathLabel(file.path);
  const status = file.status === "modified" ? "" : file.status;
  const context = [
    directory,
    file.oldPath ? `from ${filePathLabel(file.oldPath).name}` : status,
    file.shared ? "Shared" : "",
  ].filter(Boolean).join(" · ");
  return (
    <Pressable accessibilityRole="button" accessibilityHint="View this file’s diff" onPress={onPress} accessibilityLabel={[
      file.path, file.status, file.oldPath ? `from ${file.oldPath}` : "",
      file.binary ? "Binary file" : `${file.additions} additions, ${file.deletions} deletions`,
      file.shared ? "Also edited by another run" : "",
    ].filter(Boolean).join(", ")} style={({ pressed }) => [styles.file, pressed && styles.pressed]}>
      <FileIcon path={file.path} />
      <View style={styles.fileLabel}>
        <ThemedText variant="footnote" numberOfLines={1} ellipsizeMode="middle" style={styles.fileName}>{name}</ThemedText>
        {context ? <ThemedText variant="caption2" numberOfLines={1} ellipsizeMode="head" style={styles.fileContext}>{context}</ThemedText> : null}
      </View>
      {file.binary ? <ThemedText variant="caption2">Binary</ThemedText> : <DiffCounts additions={file.additions} deletions={file.deletions} />}
      <SFSymbol name="chevron.right" size={10} tint={colors.tertiaryLabel} />
    </Pressable>
  );
}

/** Compact, read-only summary of the files changed by this turn. */
export function TurnChangesCard({ backendId, runId, turnId, turnIndex, changes }: {
  backendId: string | null; runId: string; turnId: number; turnIndex: number; changes: RunTurnChangesSummary;
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const count = changes.fileCount ?? changes.files.length;
  const files = expanded ? changes.files : changes.files.slice(0, 2);
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <SFSymbol name="doc.badge.plus" size={18} tint={colors.secondaryLabel} />
        <ThemedText variant="footnote" accessibilityLabel={`Turn ${turnIndex + 1}. ${changes.undoneAt ? "Changes undone" : `Edited ${count} files`}`} style={styles.title}>
          {changes.undoneAt ? "Changes undone" : `Edited ${count} file${count === 1 ? "" : "s"}`}
        </ThemedText>
        <DiffCounts additions={changes.additions} deletions={changes.deletions} />
      </View>
      {files.map((file) => <ChangedFile key={file.path} file={file} onPress={() => router.push({ pathname: "/file-diff", params: {
        backendId: backendId ?? "", runId, turnId: String(turnId), filePath: file.path, ...(file.oldPath ? { oldPath: file.oldPath } : {}),
      } })} />)}
      {changes.files.length > 2 ? (
        <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={styles.footer}>
          <ThemedText variant="caption" style={styles.footerLabel}>{expanded ? "Show fewer files" : `Show ${changes.files.length - 2} more files`}</ThemedText>
          <SFSymbol name={expanded ? "chevron.up" : "chevron.down"} size={11} tint={colors.secondaryLabel} />
        </Pressable>
      ) : null}
      {count > changes.files.length ? <ThemedText variant="caption" style={styles.notice}>The full file list is available on desktop.</ThemedText> : null}
      {changes.truncated ? <ThemedText variant="caption" style={styles.notice}>Only part of this turn’s diff was stored.</ThemedText> : null}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  card: { marginTop: spacing.sm, backgroundColor: colors.fill, borderRadius: radius.lg, borderCurve: "continuous", overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.ms, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  title: { flex: 1, color: colors.label, fontWeight: "600" },
  file: { flexDirection: "row", alignItems: "center", minHeight: 44, gap: spacing.sm, paddingHorizontal: spacing.ms, paddingVertical: spacing.sm },
  pressed: { opacity: 0.6 },
  fileLabel: { flex: 1, minWidth: 0, gap: spacing.xxs },
  fileName: { color: colors.label, fontWeight: "500" },
  fileContext: { color: colors.secondaryLabel },
  counts: { flexDirection: "row", alignItems: "center", flexShrink: 0, gap: spacing.sm },
  additions: { color: colors.systemGreen, fontVariant: ["tabular-nums"] },
  deletions: { color: colors.systemRed, fontVariant: ["tabular-nums"] },
  footer: { flexDirection: "row", alignItems: "center", minHeight: 44, paddingHorizontal: spacing.ms, gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  footerLabel: { flex: 1 },
  notice: { paddingHorizontal: spacing.ms, paddingBottom: spacing.sm },
});
