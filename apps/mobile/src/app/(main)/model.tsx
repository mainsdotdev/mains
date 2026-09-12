import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";

import { useSession } from "@/backend/backend-session";
import { setModelChoice } from "@/backend/sync";
import { Card, Row, SheetHeader, SheetHint, ThemedText, sheetContentStyle } from "@/components/ui";
import {
  effortOffAllowed,
  formatEffortLevel,
  modelPrettyName,
  parseEffortLevels,
  pickDefaultEffort,
} from "@/lib/models";
import { useModelSelection } from "@/lib/use-model-selection";
import { useRunSettings } from "@/lib/use-run-settings";
import { spacing } from "@/theme";

/**
 * The model sheet, in the shape of the Claude app's: the provider's models
 * with a line each and the one in effect checked, and under them Effort,
 * which unfolds into the levels the chosen model offers. The model is this
 * phone's choice (it rides on the next run); the effort is the Mac's provider
 * setting, shared with the desktop. How the agent may act — permissions and
 * the fast / goal / plan switches — is the run options sheet's, next door,
 * so that its chip lands on those rows rather than under a list of models.
 */
export default function ModelSheet() {
  const { providerId: param } = useLocalSearchParams<{ providerId: string }>();
  const providerId = typeof param === "string" ? param : "";
  const session = useSession();
  const backendId = session.backend?.backendId ?? "";
  const selection = useModelSelection(backendId, providerId);
  const { pending, hint, apply } = useRunSettings(providerId);
  const [effortOpen, setEffortOpen] = useState(false);

  const chooseModel = (model: (typeof selection.models)[number]) => {
    setModelChoice(backendId, providerId, model.id);
    // Keep the effort within what the new model offers, as the desktop does.
    const levels = parseEffortLevels(model.effortLevels);
    const current = selection.effortLevel;
    if (levels.length > 0 && current && current !== "ultracode" && !levels.includes(current)) {
      void apply({ effortLevel: pickDefaultEffort(levels, current) });
    }
  };

  const effortOptions = [...(effortOffAllowed(providerId) ? [""] : []), ...selection.supportedLevels];
  const shownEffort = pending.effortLevel ?? selection.effortLevel;

  return (
    <ScrollView contentContainerStyle={sheetContentStyle}>
      <SheetHeader title="Model" />

      <Card>
        {selection.models.length === 0 ? (
          <ThemedText variant="subhead" style={{ padding: spacing.md }}>
            {session.connection.kind === "connected"
              ? "No models reported by this provider yet."
              : "Connect to your Mac to load its models."}
          </ThemedText>
        ) : (
          selection.models.map((model, index) => (
            <Row
              key={model.id}
              first={index === 0}
              title={modelPrettyName(model, providerId)}
              subtitle={model.description ?? undefined}
              selected={selection.selected?.id === model.id}
              onPress={() => chooseModel(model)}
            />
          ))
        )}
      </Card>

      <Card>
        <Row
          first
          title="Effort"
          value={selection.supportedLevels.length > 0 || shownEffort ? formatEffortLevel(shownEffort) : "—"}
          chevron={effortOpen ? "chevron.down" : "chevron.right"}
          disabled={effortOptions.length === 0}
          onPress={() => setEffortOpen((open) => !open)}
        />
        {effortOpen &&
          effortOptions.map((level) => (
            <Row
              key={level || "off"}
              first={false}
              indented
              title={formatEffortLevel(level)}
              selected={shownEffort === level}
              onPress={() => {
                if (level !== shownEffort) void apply({ effortLevel: level });
              }}
            />
          ))}
      </Card>

      <SheetHint text={hint} />
    </ScrollView>
  );
}
