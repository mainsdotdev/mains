import { useState, useCallback } from "react";
import { appApi } from "@/lib/transport";
import { Textarea, Button, toast } from "@/components/ui";
import { SettingsSection, SettingsRow, SettingsDivider } from "../settings-layout";

interface ProjectInstructionsSectionProps {
  commitInstructions: string;
  prInstructions: string;
  rootPath: string | undefined;
  onFieldChange: (field: "commitInstructions" | "prInstructions", value: string) => void;
}

export function ProjectInstructionsSection({ commitInstructions, prInstructions, rootPath, onFieldChange }: ProjectInstructionsSectionProps) {
  const [importing, setImporting] = useState(false);

  const handleImportPrTemplate = useCallback(async () => {
    if (!rootPath || importing) return;
    setImporting(true);
    try {
      const paths = [
        `${rootPath}/.github/PULL_REQUEST_TEMPLATE.md`,
        `${rootPath}/.github/pull_request_template.md`,
        `${rootPath}/PULL_REQUEST_TEMPLATE.md`,
        `${rootPath}/pull_request_template.md`,
      ];
      for (const path of paths) {
        const result = await appApi.fileExplorer.readFile(path);
        if (result?.success && result.data) {
          onFieldChange("prInstructions", result.data);
          toast.success("PR template imported");
          return;
        }
      }
      toast.error("No PR template found in repository");
    } catch {
      toast.error("Failed to read PR template");
    } finally {
      setImporting(false);
    }
  }, [rootPath, importing, onFieldChange]);

  return (
    <SettingsSection title="Instructions">
      <SettingsRow
        variant="detail"
        title="Commit Instructions"
        description="Instructions prepended to commit goals. Overrides global setting if provided."
      >
        <Textarea
          value={commitInstructions}
          onChange={(e) => onFieldChange("commitInstructions", e.target.value)}
          placeholder="Overrides global setting if provided"
          rows={3}
          className="min-w-0"
        />
      </SettingsRow>
      <SettingsDivider />
      <SettingsRow
        variant="detail"
        title="PR Template Instructions"
        description="Instructions prepended to PR goals. Overrides global setting if provided."
      >
        <div className="flex flex-col gap-2 min-w-0 w-full">
          <Textarea
            value={prInstructions}
            onChange={(e) => onFieldChange("prInstructions", e.target.value)}
            placeholder="Overrides global setting if provided"
            rows={3}
            className="min-w-0"
          />
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              disabled={importing}
              isLoading={importing}
              onClick={handleImportPrTemplate}
            >
              Import from repo
            </Button>
          </div>
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
