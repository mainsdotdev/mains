import { RunPermissionOptions } from "@/features/runs/components/run-permission-options";
import { useLocalSearchParams } from "expo-router";

import { useSession } from "@/backend/backend-session";
import {
  Card,
  Row,
  SectionTitle,
  SheetHeader,
  SheetHint,
  SheetScrollView,
  ThemedText,
  Toggle,
} from "@/components/ui";
import { useModelSelection } from "@/lib/use-model-selection";
import { spacing } from "@/theme";

type ModeKey = "fastMode" | "goalMode" | "planMode";

/**
 * The run options sheet: how the agent may act. The permission modes, laid
 * out in full with what each allows, and the fast / goal / plan switches —
 * each shown only where the provider and model support it. These are the
 * conversation's next-message preferences, filtered by its mode. The model and its effort
 * are the model sheet's; this one opens from the permission chip, so what
 * that chip names is the first thing on it.
 */
export default function RunOptionsSheet() {
  const { providerId: param, runId: runParam, workspacePath } = useLocalSearchParams<{ providerId: string; runId?: string; workspacePath?: string }>();
  const providerId = typeof param === "string" ? param : "";
  const runId = typeof runParam === "string" ? runParam : null;
  const session = useSession();
  const backendId = session.backend?.backendId ?? "";
  const selection = useModelSelection(backendId, providerId, runId);
  const { hint, apply } = selection;

  const shownPermission = selection.permissionMode;
  const toggle = (key: ModeKey, value: boolean) => {
    if (!selection.ready) return;
    void apply({ [key]: value });
  };
  const toggleValue = (key: ModeKey) => selection[key];
  const hasServiceTiers = selection.serviceTiers.length > 0;
  const showFastToggle = selection.supportsFastMode && !hasServiceTiers;
  const anyMode = showFastToggle || selection.supportsGoalMode || selection.supportsPlanMode;

  return (
    <SheetScrollView>
      <SheetHeader title="Run options" />

      {selection.permissionOptions.length > 0 && (
        <RunPermissionOptions key={JSON.stringify([backendId, providerId, workspacePath])} backendId={backendId} providerId={providerId} workspacePath={typeof workspacePath === "string" ? workspacePath : undefined}
          options={selection.permissionOptions} value={shownPermission} ready={selection.ready}
          onChange={(permissionMode) => { void apply({ permissionMode }); }} />
      )}

      {hasServiceTiers && (
        <>
          <SectionTitle>Speed</SectionTitle>
          <Card surface="sheet">
            <Row first title="Standard" selected={!selection.serviceTier || selection.serviceTier === "default"} disabled={!selection.ready}
              onPress={() => { void apply({ serviceTier: "default" }); }} />
            {selection.serviceTiers.map((tier) => (
              <Row key={tier.id} first={false} title={tier.name} subtitle={tier.description}
                selected={selection.serviceTier === tier.id} disabled={!selection.ready}
                onPress={() => { void apply({ serviceTier: tier.id }); }} />
            ))}
          </Card>
        </>
      )}

      {anyMode && (
        <>
          <SectionTitle>Modes</SectionTitle>
          <Card surface="sheet">
            {showFastToggle && (
              <Row
                first
                title="Fast mode"
                trailing={<Toggle label="Fast mode" disabled={!selection.ready} value={toggleValue("fastMode")} onChange={(v) => toggle("fastMode", v)} />}
              />
            )}
            {selection.supportsGoalMode && (
              <Row
                first={!showFastToggle}
                title="Goal mode"
                subtitle="Track this prompt as the thread's goal"
                trailing={<Toggle label="Goal mode" disabled={!selection.ready} value={toggleValue("goalMode")} onChange={(v) => toggle("goalMode", v)} />}
              />
            )}
            {selection.supportsPlanMode && (
              <Row
                first={!showFastToggle && !selection.supportsGoalMode}
                title="Plan mode"
                subtitle="Plan before executing"
                trailing={<Toggle label="Plan mode" disabled={!selection.ready} value={toggleValue("planMode")} onChange={(v) => toggle("planMode", v)} />}
              />
            )}
          </Card>
        </>
      )}

      {selection.permissionOptions.length === 0 && !anyMode && !hasServiceTiers && (
        <ThemedText variant="subhead" style={{ padding: spacing.md, textAlign: "center" }}>
          {session.connection.kind === "connected"
            ? "This provider has no run options."
            : "Connect to Mains on your computer to load its run options."}
        </ThemedText>
      )}

      <SheetHint text={hint} />
    </SheetScrollView>
  );
}
