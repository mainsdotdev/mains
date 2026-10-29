import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { backendSession, useSession } from "@/backend/backend-session";
import { ThemedText } from "@/components/ui";
import { readTurnFileDiff, type FileDiffCursor, type FileDiffPage } from "@/lib/turn-file-diff";
import { useThemeColors, type ThemeColors, spacing } from "@/theme";
import { DiffBody } from "./diff-body";

/** A selected file from one stored turn; only the visible diff page stays in memory. */
export function TurnFileDiffView({ backendId, runId, turnId, filePath, oldPath }: {
  backendId: string; runId: string; turnId: number; filePath: string; oldPath?: string;
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const session = useSession();
  const currentBackend = session.backend?.backendId;
  const [part, setPart] = useState(0);
  const [bookmarks, setBookmarks] = useState<(FileDiffCursor | undefined)[]>([undefined]);
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{ key: string; page?: FileDiffPage; error?: string } | null>(null);
  const scroll = useRef<ScrollView>(null);
  const key = `${backendId}:${currentBackend}:${runId}:${turnId}:${filePath}:${oldPath}:${part}:${attempt}`;
  const cursor = bookmarks[part];
  useEffect(() => {
    let active = true;
    const sameBackend = () => backendSession.getSnapshot().backend?.backendId === backendId;
    const load = async () => {
      if (!backendId || !sameBackend()) throw new Error("Return to this file’s conversation on its computer to view the diff.");
      if (!runId || !filePath || !Number.isSafeInteger(turnId) || turnId <= 0) throw new Error("This file change is unavailable.");
      return readTurnFileDiff({ path: filePath, oldPath, cursor, active: () => active && sameBackend(), read: async (offset) => {
        if (!sameBackend()) throw new Error("The connected computer changed. Reopen the file from its conversation.");
        return backendSession.readHistoryContent({ runId, id: turnId, source: "turn-diff", offset });
      } });
    };
    void load().then((page) => {
      if (!active || !sameBackend()) return;
      setAnswer({ key, page });
      scroll.current?.scrollTo({ y: 0, animated: false });
    }, (error: unknown) => {
      if (active) setAnswer({ key, error: error instanceof Error ? error.message : "Could not load this file’s diff" });
    });
    return () => { active = false; };
  }, [backendId, currentBackend, runId, turnId, filePath, oldPath, cursor, key]);
  const current = answer?.key === key ? answer : null;
  const page = current?.page;
  return (
    <View style={styles.screen}>
      <ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        {page ? (
          page.binary ? <ThemedText>Binary file changes can be viewed on desktop.</ThemedText>
            : !page.found ? <ThemedText>This file’s diff is not included in the stored changes. Check it on desktop.</ThemedText>
              : page.diff.hunks.length === 0 ? <ThemedText>No line changes. The file was renamed or its metadata changed.</ThemedText>
                : <DiffBody diff={page.diff} />
        ) : current?.error ? (
          <View style={styles.message}>
            <ThemedText variant="footnote" selectable>{current.error}</ThemedText>
            <Pressable accessibilityRole="button" onPress={() => setAttempt((value) => value + 1)} style={styles.control}>
              <ThemedText style={styles.action}>Try again</ThemedText>
            </Pressable>
          </View>
        ) : <ActivityIndicator accessibilityLabel="Loading file diff" />}
        {page?.shortened ? <ThemedText variant="caption">Very long lines were shortened. View the full lines on desktop.</ThemedText> : null}
      </ScrollView>
      {part > 0 || page?.next ? (
        <View style={styles.navigation}>
          <Pressable accessibilityRole="button" disabled={part === 0} onPress={() => setPart((value) => value - 1)} style={styles.control}>
            <ThemedText style={[styles.action, part === 0 && styles.disabled]}>Previous</ThemedText>
          </Pressable>
          <ThemedText variant="caption">Part {part + 1}</ThemedText>
          <Pressable accessibilityRole="button" disabled={!page?.next} onPress={() => {
            const next = page?.next;
            if (!next) return;
            setBookmarks((previous) => [...previous.slice(0, part + 1), next]);
            setPart((value) => value + 1);
          }} style={styles.control}>
            <ThemedText style={[styles.action, !page?.next && styles.disabled]}>Next</ThemedText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.systemBackground },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  message: { gap: spacing.sm },
  navigation: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingBottom: spacing.ml, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  control: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm },
  action: { color: colors.systemBlue },
  disabled: { opacity: 0.35 },
});
