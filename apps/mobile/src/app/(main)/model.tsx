import { useLocalSearchParams } from "expo-router";
import { useState } from "react";

import { useSession } from "@/backend/backend-session";
import { Card, Row, SheetHeader, SheetHint, SheetScrollView, ThemedText } from "@/components/ui";
import { EffortControl } from "@/features/runs/components/composer/effort-control";
import { modelSelectionPatch } from "@/lib/conversation-settings";
import { modelPrettyName, previewModels } from "@/lib/models";
import { useModelSelection } from "@/lib/use-model-selection";
import { spacing } from "@/theme";

/**
 * The model sheet. The provider's models, with the one in effect checked,
 * and under them that model's effort: a stepped slider, a Thinking switch
 * when the model is only on or off, and nothing when there is no choice.
 * Past five models the rest sit behind "Show more", and the selected model
 * stays in the five so the checkmark never folds away. Model and effort
 * belong to this conversation. How the agent may act is the run options sheet.
 */
export default function ModelSheet() {
  const { providerId: param, runId: runParam } = useLocalSearchParams<{ providerId: string; runId?: string }>();
  const providerId = typeof param === "string" ? param : "";
  const runId = typeof runParam === "string" ? runParam : null;
  const session = useSession();
  const backendId = session.backend?.backendId ?? "";
  const selection = useModelSelection(backendId, providerId, runId);
  const { hint, apply, ready } = selection;
  const [expandedFor, setExpandedFor] = useState(providerId);
  const [expanded, setExpanded] = useState(false);
  if (expandedFor !== providerId) {
    setExpandedFor(providerId);
    setExpanded(false);
  }

  const chooseModel = (model: (typeof selection.models)[number]) => {
    void apply(modelSelectionPatch(providerId, selection.settings, model));
  };
  const catalogue = previewModels(selection.models, selection.selected?.id, expanded);

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
          catalogue.visible.map((model, index) => (
            <Row
              key={model.id}
              first={index === 0}
              title={modelPrettyName(model, providerId)}
              subtitle={selection.selected?.id === model.id ? model.description ?? undefined : undefined}
              selected={selection.selected?.id === model.id}
              disabled={!ready}
              onPress={() => chooseModel(model)}
            />
          ))
        )}
        {catalogue.canFold && (
          <Row
            first={catalogue.visible.length === 0}
            title={expanded ? "Show less" : `Show ${catalogue.hiddenCount} more`}
            chevron={expanded ? "chevron.up" : "chevron.down"}
            onPress={() => setExpanded((open) => !open)}
          />
        )}
      </Card>

      {selection.selected && (
        <EffortControl
          modelId={selection.selected.id}
          providerId={providerId}
          supportedLevels={selection.supportedLevels}
          effortLevel={selection.effortLevel}
          thinkingMode={selection.thinkingMode}
          disabled={!ready}
          onEffort={(level) => {
            if (ready && level !== selection.effortLevel) void apply({ effortLevel: level });
          }}
          onThinking={(on) => {
            if (ready && on !== selection.thinkingMode) void apply({ thinkingMode: on });
          }}
        />
      )}

      <SheetHint text={hint} />
    </SheetScrollView>
  );
}
