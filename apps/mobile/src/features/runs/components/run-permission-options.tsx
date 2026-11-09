import { useEffect, useLayoutEffect, useState } from "react";
import { Alert } from "react-native";
import { codexPermissionChoices, codexBuiltinSandboxMode, type CodexPermissionCatalog } from "@mains/contracts/codex-permissions";
import { backendSession } from "@/backend/backend-session";
import { Card, Row, SectionTitle, SheetHint } from "@/components/ui";
import type { PermissionModeOption } from "@/lib/models";

/** The sheet owns one project/backend policy read; late answers never switch owners. */
export function RunPermissionOptions({ backendId, providerId, workspacePath, options, value, ready, onChange }: {
  backendId: string; providerId: string; workspacePath?: string; options: PermissionModeOption[];
  value: string; ready: boolean; onChange(value: string): void;
}) {
  const [owner] = useState(() => backendSession.captureDecisionOwner());
  useLayoutEffect(() => { owner.attach(); return () => owner.detach(); }, [owner]);
  const key = JSON.stringify([backendId, providerId, workspacePath]);
  const [answer, setAnswer] = useState<{ key: string; catalog?: CodexPermissionCatalog; error?: string }>();
  useEffect(() => {
    if (providerId !== "codex" || !backendId) return;
    let current = true;
    void backendSession.getCodexPermissions(workspacePath).then(
      (catalog) => { if (current && backendSession.getSnapshot().backend?.backendId === backendId) setAnswer({ key, catalog }); },
      (error) => { if (current && backendSession.getSnapshot().backend?.backendId === backendId) setAnswer({ key, error: error instanceof Error ? error.message : "Could not load permissions" }); },
    );
    return () => { current = false; };
  }, [backendId, providerId, workspacePath, key]);
  const result = answer?.key === key ? answer : undefined;
  const catalog = result?.catalog;
  const rows: (PermissionModeOption & { disabledReason?: string })[] = providerId === "codex" && catalog
    ? codexPermissionChoices(catalog, value).map((choice) => {
      const builtin = options.find((option) => option.value === choice.sandboxMode);
      const label = builtin?.label ?? choice.profileId ?? choice.value;
      return { value: choice.value, label, shortLabel: builtin?.shortLabel ?? label,
        description: choice.description ?? builtin?.description ?? "Named Codex permission profile", disabledReason: choice.disabledReason };
    }) : options;
  return <>
    <SectionTitle>Permissions</SectionTitle>
    <Card surface="sheet">
      {rows.map((option, index) => {
        const blocked = providerId === "codex" ? catalog ? option.disabledReason : result?.error ?? "Loading Codex permissions…" : undefined;
        return <Row key={option.value} first={index === 0} title={option.label} subtitle={blocked ?? option.description}
          selected={value === option.value} disabled={!ready || !!blocked}
          onPress={() => {
            if (!ready || blocked || option.value === value) return;
            if (codexBuiltinSandboxMode(option.value) === "danger-full-access") {
              const decision = owner.begin();
              if (!decision) return;
              Alert.alert("Allow full access?", "Codex can modify files outside the workspace and access the network.", [
                { text: "Cancel", style: "cancel", onPress: () => decision.finish() }, { text: "Allow full access", style: "destructive", onPress: () => {
                  try { if (decision.current()) onChange(option.value); } finally { decision.finish(); }
                } },
              ], { cancelable: true, onDismiss: () => decision.finish() });
            } else onChange(option.value);
          }} />;
      })}
    </Card>
    {result?.error && <SheetHint text={result.error} />}
  </>;
}
