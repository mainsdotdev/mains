import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import type { StructuralPlanSnapshot } from "@mains/contracts/run-progress";

import { GlassSurface, SFSymbol, ThemedText } from "@/components/ui";
import { colors, radius, spacing, useProviderAccent } from "@/theme";

/** A compact live checklist above the composer, expanded only when the reader asks. */
export function PlanProgress({ plan, providerId }: { plan: StructuralPlanSnapshot; providerId: string }) {
  const [expanded, setExpanded] = useState(false);
  const accent = useProviderAccent(providerId);
  const completed = plan.steps.filter((step) => step.status === "completed").length;
  const current = plan.steps.find((step) => step.status === "in_progress") ?? plan.steps.find((step) => step.status === "pending");
  return (
    <View style={{ paddingHorizontal: spacing.ms, paddingBottom: spacing.sm }}>
      <GlassSurface style={{ borderRadius: radius.lg, overflow: "hidden" }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Plan: ${completed} of ${plan.steps.length} completed. ${current?.step ?? ""}`}
          accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)}
          style={({ pressed }) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.ms, opacity: pressed ? 0.65 : 1 })}>
          <SFSymbol name="list.bullet.rectangle" size={17} tint={accent} />
          <ThemedText variant="caption" style={{ color: accent, fontVariant: ["tabular-nums"], fontWeight: "600" }}>
            Plan {completed}/{plan.steps.length}
          </ThemedText>
          <ThemedText variant="footnote" numberOfLines={1} style={{ flex: 1, color: colors.label }}>{current?.step}</ThemedText>
          <SFSymbol name={expanded ? "chevron.up" : "chevron.down"} size={11} tint={colors.tertiaryLabel} />
        </Pressable>
        {expanded ? (
          <ScrollView style={{ maxHeight: 200 }} contentContainerStyle={{ paddingHorizontal: spacing.ms, paddingBottom: spacing.ms, gap: spacing.sm }}>
            {plan.explanation ? <ThemedText variant="footnote">{plan.explanation}</ThemedText> : null}
            {plan.steps.map((step, index) => (
              <View key={index} style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
                <SFSymbol name={step.status === "completed" ? "checkmark.circle.fill" : step.status === "in_progress" ? "circle.lefthalf.filled" : "circle"}
                  size={14} tint={step.status === "pending" ? colors.tertiaryLabel : accent} />
                <ThemedText variant="footnote" style={{ flex: 1, color: step.status === "completed" ? colors.tertiaryLabel : colors.label }}>
                  {step.step}
                </ThemedText>
              </View>
            ))}
          </ScrollView>
        ) : null}
      </GlassSurface>
    </View>
  );
}
