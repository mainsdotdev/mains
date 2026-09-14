import { Textarea } from "@/components/ui";
import { SettingsSection, SettingsRow, SettingsDivider } from "../settings-layout";

interface ProjectScriptsSectionProps {
  setupScript: string;
  archiveScript: string;
  onFieldChange: (field: "setupScript" | "archiveScript", value: string) => void;
}

export function ProjectScriptsSection({ setupScript, archiveScript, onFieldChange }: ProjectScriptsSectionProps) {
  return (
    <SettingsSection title="Scripts">
      <SettingsRow
        variant="detail"
        title="Setup"
        description="Runs after a new workspace is created, e.g. installing dependencies."
      >
        <Textarea
          value={setupScript}
          onChange={(e) => onFieldChange("setupScript", e.target.value)}
          placeholder="e.g., npm i && npm run build"
          rows={2}
          className="min-w-0"
        />
      </SettingsRow>
      <SettingsDivider />
      <SettingsRow
        variant="detail"
        title="Archive"
        description="Runs when archiving a workspace, e.g. cleaning up node_modules."
      >
        <Textarea
          value={archiveScript}
          onChange={(e) => onFieldChange("archiveScript", e.target.value)}
          placeholder="e.g., rm -rf node_modules"
          rows={2}
          className="min-w-0"
        />
      </SettingsRow>
    </SettingsSection>
  );
}
