import { useLocalSearchParams } from "expo-router";
import { ScrollView } from "react-native";

import { useSession } from "@/backend/backend-session";
import {
  Card,
  Row,
  SectionTitle,
  SheetHeader,
  SheetHint,
  ThemedText,
  Toggle,
  sheetContentStyle,
} from "@/components/ui";
import { useModelSelection } from "@/lib/use-model-selection";
import { useRunSettings } from "@/lib/use-run-settings";
import { spacing } from "@/theme";

type ModeKey = "fastMode" | "goalMode" | "planMode";

/**
 * The run options sheet: how the agent may act. The permission modes, laid
 * out in full with what each allows, and the fast / goal / plan switches —
 * each shown only where the provider and model support it. All of it is the
 * Mac's provider setting, shared with the desktop. The model and its effort
 * are the model sheet's; this one opens from the permission chip, so what
 * that chip names is the first thing on it.
 */
export default function RunOptionsSheet() {
  const { providerId: param } = useLocalSearchParams<{ providerId: string }>();
  const providerId = typeof param === "string" ? param : "";
  const session = useSession();
  const backendId = session.backend?.backendId ?? "";
  const selection = useModelSelection(backendId, providerId);
  const { pending, hint, apply } = useRunSettings(providerId);

  const shownPermission = pending.permissionMode ?? selection.permissionMode;
  const toggle = (key: ModeKey, value: boolean) => {
    if (pending[key] !== undefined) return;
    void apply({ [key]: value });
  };
  const toggleValue = (key: ModeKey) => pending[key] ?? selection[key];
  const anyMode = selection.supportsFastMode || selection.supportsGoalMode || selection.supportsPlanMode;

  return (
    <ScrollView contentContainerStyle={sheetContentStyle}>
      <SheetHeader title="Run options" />

      {selection.permissionOptions.length > 0 && (
        <>
          <SectionTitle>Permissions</SectionTitle>
          <Card>
            {selection.permissionOptions.map((option, index) => (
              <Row
                key={option.value}
                first={index === 0}
                title={option.label}
                subtitle={option.description}
                selected={shownPermission === option.value}
                onPress={() => {
                  if (option.value !== shownPermission) void apply({ permissionMode: option.value });
                }}
              />
            ))}
          </Card>
        </>
      )}

      {anyMode && (
        <>
          <SectionTitle>Modes</SectionTitle>
          <Card>
            {selection.supportsFastMode && (
              <Row
                first
                title="Fast mode"
                trailing={<Toggle value={toggleValue("fastMode")} onChange={(v) => toggle("fastMode", v)} />}
              />
            )}
            {selection.supportsGoalMode && (
              <Row
                first={!selection.supportsFastMode}
                title="Goal mode"
                subtitle="Track this prompt as the thread's goal"
                trailing={<Toggle value={toggleValue("goalMode")} onChange={(v) => toggle("goalMode", v)} />}
              />
            )}
            {selection.supportsPlanMode && (
              <Row
                first={!selection.supportsFastMode && !selection.supportsGoalMode}
                title="Plan mode"
                subtitle="Plan before executing"
                trailing={<Toggle value={toggleValue("planMode")} onChange={(v) => toggle("planMode", v)} />}
              />
            )}
          </Card>
        </>
      )}

      {selection.permissionOptions.length === 0 && !anyMode && (
        <ThemedText variant="subhead" style={{ padding: spacing.md, textAlign: "center" }}>
          {session.connection.kind === "connected"
            ? "This provider has no run options."
            : "Connect to your Mac to load its run options."}
        </ThemedText>
      )}

      <SheetHint text={hint} />
    </ScrollView>
  );
}
