import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { backendSession, useSession } from "@/backend/backend-session";
import { waitForComposerSettings } from "@/backend/composer-settings";
import { Button, ThemedText } from "@/components/ui";
import { useAiDataConsent } from "@/features/ai-data-consent";
import type { PendingAsyncQuestions } from "@/lib/async-questions";
import { useThemeColors, radius, shadows, spacing, type, useProviderAccentPair } from "@/theme";

/**
 * Outcomes where the answer may have reached the Mac without a reply: the Mac's
 * own "unknown delivery" refusals, and a socket that went away mid-command.
 */
const UNCERTAIN = /delivery is unknown|still being delivered|timed out|connection closed|disposed/i;

type Status = "editing" | "sending" | "unknown" | "done";

function notify(type: Haptics.NotificationFeedbackType) {
  if (process.env.EXPO_OS === "ios") void Haptics.notificationAsync(type);
}

/**
 * Questions Codex asked at the end of a turn, one at a time — the desktop's
 * async question dialog. The Mac turns the answers into one message and steers
 * or continues the run with it. When a send's outcome is unknown the card only
 * offers to check, never to send again, so an answer can't arrive twice.
 */
export function AsyncQuestionCard({
  runId,
  providerId,
  pending,
}: {
  runId: string;
  providerId: string;
  pending: PendingAsyncQuestions;
}) {
  const colors = useThemeColors();
  const session = useSession();
  const backendId = session.backend?.backendId ?? "";
  const connected = session.connection.kind === "connected";
  const { requestConsent } = useAiDataConsent();
  const provider = useProviderAccentPair(providerId);
  const { artifactId, questions } = pending;
  const [answers, setAnswers] = useState(() => questions.map(() => ""));
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<Status>("editing");
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Answered or dismissed: the refetch retires the questions; until it lands
  // there is nothing left to do here.
  if (status === "done") return null;

  const question = questions[Math.min(index, questions.length - 1)];
  const options = question.options ?? [];
  const value = answers[index] ?? "";
  const last = index === questions.length - 1;
  const sending = status === "sending";
  const unknown = status === "unknown";
  const locked = sending || unknown || dismissing;

  const setAnswer = (next: string) => {
    setError(null);
    setAnswers((current) => current.map((answer, i) => (i === index ? next : answer)));
  };

  const submit = async (checkOnly: boolean) => {
    setStatus("sending");
    setError(null);
    try {
      if (!checkOnly) {
        if (!(await requestConsent(backendId, providerId))) {
          setStatus("editing");
          return;
        }
        // The answer goes out under the conversation's saved settings.
        await waitForComposerSettings(backendId, providerId, runId);
      }
      const result = await backendSession.answerAsyncQuestions(
        runId,
        artifactId,
        answers.map((answer) => answer.trim()),
        checkOnly,
      );
      if (result.success && result.data.accepted) {
        setStatus("done");
        notify(Haptics.NotificationFeedbackType.Success);
        return;
      }
      if (result.success) {
        setStatus("unknown");
        setError("Delivery has not been confirmed yet. Check again.");
        return;
      }
      setStatus(checkOnly || UNCERTAIN.test(result.error) ? "unknown" : "editing");
      setError(result.error);
      notify(Haptics.NotificationFeedbackType.Error);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not send the answers";
      const uncertain = checkOnly || UNCERTAIN.test(message);
      setStatus(uncertain ? "unknown" : "editing");
      setError(uncertain ? "Delivery is unknown. Check delivery before sending again." : message);
      notify(Haptics.NotificationFeedbackType.Error);
    }
  };

  const dismiss = async () => {
    setDismissing(true);
    setError(null);
    try {
      const result = await backendSession.dismissAsyncQuestions(runId, artifactId);
      if (result.success) setStatus("done");
      else setError(result.error);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not dismiss the questions");
    } finally {
      setDismissing(false);
    }
  };

  const primary = () => {
    if (unknown) void submit(true);
    else if (!last) setIndex(index + 1);
    else void submit(false);
  };

  return (
    <View
      style={{
        backgroundColor: colors.cardSurface,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        boxShadow: shadows.card,
        padding: spacing.md,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View
          style={{
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xxs + 1,
            borderRadius: radius.full,
            backgroundColor: provider.soft,
          }}
        >
          <ThemedText variant="caption" style={{ color: provider.accent, fontWeight: "600" }}>
            Question
          </ThemedText>
        </View>
        {questions.length > 1 ? (
          <ThemedText variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
            {index + 1} of {questions.length}
          </ThemedText>
        ) : null}
      </View>

      <ThemedText variant="headline">{question.title}</ThemedText>

      {options.length > 0 ? (
        <View style={{ gap: spacing.xs + 2 }}>
          {options.map((option) => {
            const active = value === option;
            return (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled: locked }}
                disabled={locked}
                onPress={() => setAnswer(active ? "" : option)}
                style={({ pressed }) => ({
                  paddingHorizontal: spacing.ms,
                  paddingVertical: spacing.sm + 2,
                  borderRadius: radius.md,
                  borderCurve: "continuous",
                  backgroundColor: active ? provider.soft : colors.fill,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <ThemedText
                  variant="callout"
                  style={{ fontWeight: "500", color: active ? provider.accent : colors.label }}
                >
                  {option}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <TextInput
        accessibilityLabel="Your answer"
        editable={!locked}
        multiline
        onChangeText={setAnswer}
        placeholder={options.length > 0 ? "Or type your own answer…" : "Type your answer…"}
        placeholderTextColor={colors.tertiaryLabel as string}
        style={[
          type.callout,
          {
            minHeight: 44,
            paddingHorizontal: spacing.ms,
            paddingVertical: spacing.sm + 2,
            borderRadius: radius.md,
            borderCurve: "continuous",
            backgroundColor: colors.fill,
            color: colors.label,
            textAlignVertical: "top",
          },
        ]}
        // A picked option shows as the selected row, not as typed text.
        value={options.includes(value) ? "" : value}
      />

      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        {index > 0 && !unknown ? (
          <Button
            title="Back"
            variant="ghost"
            size="sm"
            disabled={locked}
            onPress={() => setIndex(index - 1)}
          />
        ) : null}
        <View style={{ flex: 1 }} />
        <Button
          title="Dismiss"
          variant="ghost"
          size="sm"
          loading={dismissing}
          disabled={sending || dismissing || !connected}
          onPress={() => void dismiss()}
        />
        <Button
          title={unknown ? "Check delivery" : last ? "Send" : "Next"}
          size="sm"
          style={{ backgroundColor: provider.accent }}
          loading={sending}
          disabled={
            sending || dismissing || (!unknown && !value.trim()) || (!connected && (unknown || last))
          }
          onPress={primary}
        />
      </View>

      {error ? (
        <ThemedText variant="footnote" style={{ color: colors.systemRed }} selectable>
          {error}
        </ThemedText>
      ) : null}
      <ThemedText variant="caption2">
        {connected
          ? "A regular message instead moves on without answering."
          : "Connect to Mains on your computer to answer."}
      </ThemedText>
    </View>
  );
}
