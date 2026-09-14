import { useState } from "react";
import { Toggle, Textarea, toast } from "@/components/ui";
import { extractErrorMessage } from "@/lib/extract-error-message";
import {
  SettingsPageShell,
  SettingsSection,
  SettingsRow,
  SettingsDivider,
} from "./settings-layout";
import {
  useGetAppSettingsQuery,
  useSetEnableWorktreesMutation,
  useSetCommitInstructionsMutation,
  useSetPrInstructionsMutation,
} from "@/lib/redux/api";

export default function GitSettings() {
  const { data: settings, isLoading } = useGetAppSettingsQuery();
  const [setEnableWorktrees, { isLoading: updating }] =
    useSetEnableWorktreesMutation();
  const [setCommitInstructions] = useSetCommitInstructionsMutation();
  const [setPrInstructions] = useSetPrInstructionsMutation();
  const [localInstructions, setLocalInstructions] = useState<string | null>(null);
  const [localPrInstructions, setLocalPrInstructions] = useState<string | null>(null);

  const enableWorktrees = settings?.enableWorktrees ?? false;
  const commitInstructions = localInstructions ?? settings?.commitInstructions ?? "";
  const prInstructions = localPrInstructions ?? settings?.prInstructions ?? "";

  const handleWorktreeToggle = async (enabled: boolean) => {
    if (updating) return;
    try {
      await setEnableWorktrees(enabled).unwrap();
      toast.success(
        enabled
          ? "Worktrees enabled — new projects will use isolated copies"
          : "Worktrees disabled — new projects will use the repo directly",
      );
    } catch (err: any) {
      toast.error(extractErrorMessage(err, "Failed to update worktree setting"));
    }
  };

  const handleCommitInstructionsBlur = async () => {
    if (localInstructions === null) return;
    try {
      await setCommitInstructions(localInstructions).unwrap();
      setLocalInstructions(null);
    } catch (err: any) {
      toast.error(extractErrorMessage(err, "Failed to update commit instructions"));
    }
  };

  const handlePrInstructionsBlur = async () => {
    if (localPrInstructions === null) return;
    try {
      await setPrInstructions(localPrInstructions).unwrap();
      setLocalPrInstructions(null);
    } catch (err: any) {
      toast.error(extractErrorMessage(err, "Failed to update PR instructions"));
    }
  };

  return (
    <SettingsPageShell title="Git" isLoading={isLoading}>
      <SettingsSection>
        <SettingsRow
          title="Worktrees"
          description="Work in an isolated copy of your repo, so you can work on multiple tasks at the same time. When disabled, Mains uses the active branch directly."
        >
          <Toggle
            enabled={enableWorktrees}
            aria-label="Enable worktrees"
            onChange={handleWorktreeToggle}
          />
        </SettingsRow>

        <SettingsDivider />

        <SettingsRow
          variant="detail"
          title="Commit Instructions"
          description="Added to commit message generation prompts"
        >
          <Textarea
            value={commitInstructions}
            onChange={(e) => setLocalInstructions(e.target.value)}
            onBlur={handleCommitInstructionsBlur}
            placeholder="e.g., use conventional commits, keep under 72 chars"
            rows={2}
            className="min-w-0"
          />
        </SettingsRow>

        <SettingsDivider />

        <SettingsRow
          variant="detail"
          title="PR Template Instructions"
          description="Added to pull request creation prompts"
        >
          <Textarea
            value={prInstructions}
            onChange={(e) => setLocalPrInstructions(e.target.value)}
            onBlur={handlePrInstructionsBlur}
            placeholder="e.g., include test plan, link related issues"
            rows={2}
            className="min-w-0"
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsPageShell>
  );
}

