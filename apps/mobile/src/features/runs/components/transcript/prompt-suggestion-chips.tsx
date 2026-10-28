import * as Haptics from "expo-haptics";
import { Pressable, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { ThemedText } from "@/components/ui";
import type { PromptSuggestion } from "@/lib/prompt-suggestions";
import { useThemeColors, motion, radius, spacing, useProviderAccentPair } from "@/theme";

/**
 * The follow-ups the agent offered after its answer, on the side the user
 * speaks from, as the desktop's `PromptSuggestionChips`. Every offer, not just
 * the last: Codex ends a turn with several directions. Picking one fills the
 * composer rather than sending — on a phone a stray tap must not start work.
 */
export function PromptSuggestionChips({
  suggestions,
  providerId,
  onSelect,
}: {
  suggestions: PromptSuggestion[];
  providerId: string;
  onSelect: (prompt: string) => void;
}) {
  const colors = useThemeColors();
  const { soft } = useProviderAccentPair(providerId);
  return (
    <Animated.View
      entering={FadeIn.duration(motion.fast)}
      style={{ alignItems: "flex-end", gap: spacing.xs + 2 }}
    >
      {suggestions.map((suggestion, index) => (
        <Pressable
          key={`${suggestion.prompt}-${index}`}
          accessibilityRole="button"
          accessibilityLabel={`Follow-up: ${suggestion.label ?? suggestion.prompt}`}
          accessibilityHint="Puts it in the message field"
          onPress={() => {
            void Haptics.selectionAsync();
            onSelect(suggestion.prompt);
          }}
          style={({ pressed }) => ({
            maxWidth: "85%",
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm + 2,
            borderRadius: radius.lg,
            borderCurve: "continuous",
            backgroundColor: soft,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          {/* Wraps rather than truncates: an offer you can't read is one you can't judge. */}
          <ThemedText variant="subhead" style={{ color: colors.label }}>
            {suggestion.label ?? suggestion.prompt}
          </ThemedText>
        </Pressable>
      ))}
      <View style={{ paddingHorizontal: spacing.xs }}>
        <ThemedText variant="caption2">Follow-up</ThemedText>
      </View>
    </Animated.View>
  );
}
