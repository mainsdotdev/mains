import { useState } from "react";
import { codexBuiltinSandboxMode, codexPermissionValue } from "@mains/contracts/codex-permissions";
import { DEFAULT_CLAUDE_PERMISSION_MODE } from "@mains/contracts/claude-permission-modes";
import type { Assistant, MateCodexApprovalMode } from "@mains/contracts/assistants";
import { Button, FullAccessConfirmationModal, Select } from "@/components/ui";
import { codexPermissionLabels, codexPermissionOptions } from "@/lib/codex-permission-options";
import { CLAUDE_PERMISSION_MODES } from "@/lib/provider-modes";
import { useGetCodexPermissionsQuery, useGetProviderByIdQuery } from "@/lib/redux/api/providersApi";
import { AssistantSkillsFields } from "./assistant-skills-fields";

const approvalOptions = [
  { value: "on-request", label: "On request", description: "Ask when escalation is requested" },
  { value: "untrusted", label: "Untrusted", description: "Ask before untrusted actions" },
  { value: "never", label: "Never", description: "Run within the configured permissions without asking for escalation" },
] satisfies Array<{ value: MateCodexApprovalMode; label: string; description: string }>;

export interface AssistantRuntimeDraft {
  skillIds: string[];
  permissionMode: string;
  codexApprovalMode: MateCodexApprovalMode | null;
}

export function assistantRuntimeDraft(assistant: Assistant): AssistantRuntimeDraft {
  const config = assistant.conversationSettings.config;
  return {
    skillIds: assistant.skills?.map(skill => skill.id) ?? [],
    permissionMode: assistant.providerId === "codex" ? codexPermissionValue(config) : config.permissionMode ?? DEFAULT_CLAUDE_PERMISSION_MODE,
    codexApprovalMode: assistant.codexApprovalMode ?? null,
  };
}

export function AssistantRuntimeFields({ assistant, draft, canManageSkills, disabled, onChange }: {
  assistant: Assistant;
  draft?: AssistantRuntimeDraft;
  canManageSkills: boolean;
  disabled: boolean;
  onChange(changes: Partial<AssistantRuntimeDraft>): void;
}) {
  const codex = assistant.providerId === "codex";
  const settings = draft ?? assistantRuntimeDraft(assistant);
  const [confirmPermission, setConfirmPermission] = useState<string>();
  const permissions = useGetCodexPermissionsQuery({ id: assistant.providerId }, { skip: !codex || !draft });
  const provider = useGetProviderByIdQuery(assistant.providerId, { skip: !codex });
  const choices = codex ? codexPermissionOptions(permissions.currentData, !!permissions.error, settings.permissionMode) : CLAUDE_PERMISSION_MODES;
  const selectable = choices.filter(choice => !("disabledReason" in choice && choice.disabledReason));
  const permissionLabel = codex ? codexPermissionLabels(codexPermissionOptions(permissions.currentData))[settings.permissionMode]
    ?? settings.permissionMode.replace(/^profile:/, "") : choices.find(choice => choice.value === settings.permissionMode)?.label ?? settings.permissionMode;
  const configuredApproval = provider.currentData?.config?.approvalMode;
  const providerApproval = typeof configuredApproval === "string" ? configuredApproval : "on-request";
  const approvalLabel = approvalLabelFor(settings.codexApprovalMode ?? providerApproval);
  const allowedApprovals = permissions.currentData?.allowedApprovalPolicies;

  function selectPermission(mode: string) {
    if (codexBuiltinSandboxMode(mode) === "danger-full-access" && mode !== settings.permissionMode) setConfirmPermission(mode);
    else onChange({ permissionMode: mode });
  }

  return <>
    <AssistantSkillsFields key={draft ? "editing" : "viewing"} assistant={assistant} selectedIds={settings.skillIds}
      editingProfile={!!draft} canManage={canManageSkills} disabled={disabled} onChange={skillIds => onChange({ skillIds })} />
    <div className="space-y-3 rounded-2xl glass-card p-3.5 text-sm">
      <h3 className="font-semibold text-primary-950 dark:text-primary-50">Permissions</h3>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-primary-600 dark:text-primary-300">{codex ? "Sandbox or profile" : "Permission mode"}</span>
        {draft ? <Select size="sm" aria-label={codex ? "Mate sandbox or profile" : "Mate permission mode"}
          value={settings.permissionMode} placeholder={permissionLabel} options={selectable}
          disabled={disabled || codex && (!permissions.currentData || !!permissions.error)} onChange={selectPermission} /> : <span>{permissionLabel}</span>}
      </div>
      {codex && <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-primary-600 dark:text-primary-300">Approval policy</span>
        {draft ? <Select size="sm" aria-label="Mate approval policy" value={settings.codexApprovalMode ?? ""}
          placeholder={approvalLabel} disabled={disabled || !permissions.currentData || !!permissions.error}
          options={[
            ...(!allowedApprovals || allowedApprovals.includes(providerApproval) ? [{ value: "", label: `Use provider setting (${approvalLabelFor(providerApproval)})` }] : []),
            ...approvalOptions.filter(option => !allowedApprovals || allowedApprovals.includes(option.value)),
          ]} onChange={value => onChange({ codexApprovalMode: approvalOptions.find(option => option.value === value)?.value ?? null })} />
          : <span>{approvalLabel}{settings.codexApprovalMode === null ? " · Provider setting" : ""}</span>}
      </div>}
      {draft && !!permissions.error && <div className="flex items-center justify-between gap-2 text-xs">
        <span role="status">Couldn’t load Codex permissions.</span>
        <Button type="button" variant="ghost" disabled={permissions.isFetching} onClick={() => void permissions.refetch()}>Retry</Button>
      </div>}
    </div>
    {draft && codex && <FullAccessConfirmationModal isOpen={confirmPermission !== undefined}
      onCancel={() => setConfirmPermission(undefined)} onConfirm={() => {
        if (confirmPermission && selectable.some(choice => choice.value === confirmPermission)) onChange({ permissionMode: confirmPermission });
        setConfirmPermission(undefined);
      }} />}
  </>;
}

function approvalLabelFor(value: string) {
  return approvalOptions.find(option => option.value === value)?.label ?? value;
}
