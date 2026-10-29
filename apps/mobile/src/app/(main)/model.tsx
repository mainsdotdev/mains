import { useLocalSearchParams } from "expo-router";
import { useState } from "react";

import { useSession } from "@/backend/backend-session";
import { Card, Row, SheetHeader, SheetHint, SheetScrollView, ThemedText } from "@/components/ui";
import {
  effortOffAllowed,
  formatEffortLevel,
  modelPrettyName,
} from "@/lib/models";
import { useModelSelection } from "@/lib/use-model-selection";
import { modelSelectionPatch } from "@/lib/conversation-settings";
import { spacing } from "@/theme";

/**
 * The model sheet, in the shape of the Claude app's: the provider's models
 * with a line each and the one in effect checked, and under them Effort,
 * which unfolds into the levels the chosen model offers. Model and effort
 * belong to this conversation. How the agent may act — permissions and
 * the fast / goal / plan switches — is the run options sheet's, next door,
 * so that its chip lands on those rows rather than under a list of models.
 */
export default function ModelSheet() {
  const { providerId: param, runId: runParam } = useLocalSearchParams<{ providerId: string; runId?: string }>();
  const providerId = typeof param === "string" ? param : "";
  const runId = typeof runParam === "string" ? runParam : null;
  const session = useSession();
  const backendId = session.backend?.backendId ?? "";
  const selection = useModelSelection(backendId, providerId, runId);
  const { hint, apply } = selection;
  const [effortOpen, setEffortOpen] = useState(false);

  const chooseModel = (model: (typeof selection.models)[number]) => {
    void apply(modelSelectionPatch(providerId, selection.settings, model));
  };

  const effortOptions = [...(effortOffAllowed(providerId) ? [""] : []), ...selection.supportedLevels];
  const shownEffort = selection.effortLevel;

  return (
    <SheetScrollView>
      <SheetHeader title="Model" />

      <Card surface="sheet">
        {selection.models.length === 0 ? (
          <ThemedText variant="subhead" style={{ padding: spacing.md }}>
            {session.connection.kind === "connected"
              ? "No models reported by this provider yet."
              : "Connect to Mains on your computer to load its models."}
          </ThemedText>
        ) : (
          selection.models.map((model, index) => (
            <Row
              key={model.id}
              first={index === 0}
              title={modelPrettyName(model, providerId)}
              subtitle={model.description ?? undefined}
              selected={selection.selected?.id === model.id}
              disabled={!selection.ready}
              onPress={() => chooseModel(model)}
            />
          ))
        )}
      </Card>

      <Card surface="sheet">
        <Row
          first
          title="Effort"
          value={selection.supportedLevels.length > 0 || shownEffort ? formatEffortLevel(shownEffort) : "—"}
          chevron={effortOpen ? "chevron.down" : "chevron.right"}
          disabled={!selection.ready || effortOptions.length === 0}
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
    </SheetScrollView>
  );
}
