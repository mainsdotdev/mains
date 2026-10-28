import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { ReadRunHistoryContentPayload, RunHistoryContentPage } from "@mains/contracts/runs";

import { backendSession } from "@/backend/backend-session";
import { ThemedText } from "@/components/ui";
import { useThemeColors, spacing } from "@/theme";

/** One text chunk at a time; navigating never accumulates the full large body. */
export function HistoryContentView({ runId, source, id }: ReadRunHistoryContentPayload) {
  const colors = useThemeColors();
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{ key: string; page?: RunHistoryContentPage; error?: string } | null>(null);
  const scroll = useRef<ScrollView>(null);
  const key = `${runId}:${source}:${id}:${offset}:${attempt}`;
  useEffect(() => {
    let active = true;
    void backendSession.readHistoryContent({ runId, source, id, offset }).then((page) => {
      if (!active) return;
      setAnswer({ key, page });
      scroll.current?.scrollTo({ y: 0, animated: false });
    }, (error: unknown) => {
      if (active) setAnswer({ key, error: error instanceof Error ? error.message : "Could not load content" });
    });
    return () => { active = false; };
  }, [runId, source, id, offset, key]);
  const current = answer?.key === key ? answer : null;
  const page = current?.page;
  return <View style={{ flex: 1, backgroundColor: colors.systemBackground }}>
    <ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: spacing.lg }}>
      {page ? <ThemedText variant="monoCaption" selectable>{source === "turn-diff" && page.text
        ? page.text.split(/(?<=\n)/).map((line, index) => <Text key={index} style={{ color:
          line.startsWith("+++") || line.startsWith("---") ? colors.label
            : line.startsWith("+") ? colors.systemGreen : line.startsWith("-") ? colors.systemRed : colors.secondaryLabel,
        }}>{line}</Text>) : page.text || "No content"}</ThemedText>
        : current?.error ? <><ThemedText>{current.error}</ThemedText><Pressable accessibilityRole="button" onPress={() => setAttempt((value) => value + 1)} style={{ paddingVertical: spacing.md }}><ThemedText>Retry</ThemedText></Pressable></>
          : <ActivityIndicator accessibilityLabel="Loading content" />}
    </ScrollView>
    <View style={{ flexDirection: "row", justifyContent: "space-between", padding: spacing.lg }}>
      <Pressable accessibilityRole="button" disabled={!page || offset === 0} onPress={() => setOffset(Math.max(0, offset - 8192))}>
        <ThemedText style={{ opacity: !page || offset === 0 ? 0.35 : 1 }}>Previous</ThemedText>
      </Pressable>
      <ThemedText variant="caption">Part {Math.floor(offset / 8192) + 1}</ThemedText>
      <Pressable accessibilityRole="button" disabled={!page || page.nextOffset === null} onPress={() => { if (page?.nextOffset != null) setOffset(page.nextOffset); }}>
        <ThemedText style={{ opacity: !page || page.nextOffset === null ? 0.35 : 1 }}>Next</ThemedText>
      </Pressable>
    </View>
  </View>;
}
