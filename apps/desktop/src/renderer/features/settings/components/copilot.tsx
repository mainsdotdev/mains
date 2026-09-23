import { Button } from "@/components/ui";
import { SettingsSection, SettingsRow, SettingsDivider } from "./settings-layout";
import { useCapabilities } from "@/lib/platform";
import {
  ProviderCliSection,
  ProviderSettingsLayout,
  ProviderUsageSection,
  useProviderSettings,
  type ProviderUsageRow,
} from "./provider-settings-shared";
import {
  useGetProviderRateLimitsQuery,
  useGetProviderAccountInfoQuery,
} from "@/lib/redux/api";
import type { CopilotAdapterConfig } from "../../../../shared/adapter.types";
import { PROVIDER_IDS } from "../../../../shared/provider-ids";
import { getProviderVariant } from "@/lib/provider-variants";

export default function CopilotSettings(
) {
  const { provider, isLoading, error } = useProviderSettings<CopilotAdapterConfig>(
    PROVIDER_IDS.copilot,
    "copilot",
  );

  const { data: rateLimits, isLoading: isLoadingRateLimits } =
    useGetProviderRateLimitsQuery(PROVIDER_IDS.copilot, {
      pollingInterval: 60000,
    });

  const { data: accountInfo } = useGetProviderAccountInfoQuery(
    PROVIDER_IDS.copilot,
  );
  const cli = accountInfo?.cli;

  const usageRows: ProviderUsageRow[] = [
    ...(rateLimits?.primary
      ? [
          {
            label: rateLimits.primary.label ?? "Primary",
            usedPercent: rateLimits.primary.usedPercent,
            resetsAt: rateLimits.primary.resetsAt,
            used: rateLimits.primary.used,
            total: rateLimits.primary.total,
          },
        ]
      : []),
    ...(rateLimits?.secondary
      ? [
          {
            label: rateLimits.secondary.label ?? "Secondary",
            usedPercent: rateLimits.secondary.usedPercent,
            resetsAt: rateLimits.secondary.resetsAt,
            used: rateLimits.secondary.used,
            total: rateLimits.secondary.total,
          },
        ]
      : []),
  ];

  const openPath = (targetPath: string) => {
    window.api.shell.openPath(targetPath);
  };

  const homedir = window.api.platform.homedir;
  const { revealInFolder } = useCapabilities();

  return (
    <ProviderSettingsLayout
      title={getProviderVariant("copilot").label}
      provider={provider}
      isLoading={isLoading}
      error={error}
    >
      {/* CLI version + self-update — `copilot --version` / `copilot update` */}
      <ProviderCliSection
        providerId={PROVIDER_IDS.copilot}
        cliName="GitHub Copilot CLI"
        shortName={getProviderVariant("copilot").label}
        cli={cli}
        buttonVariant="secondary"
      />

      {revealInFolder && (
        <SettingsSection title="Capabilities">
        <SettingsRow
          title="Agents"
          description={
            <>
              Define custom agents as markdown files in ~/.copilot/agents/ (user)
              or .github/agents/ (project).
            </>
          }
        >
          <Button
            variant="primary"
            onClick={() => openPath(`${homedir}/.copilot/agents`)}
          >
            Open Folder
          </Button>
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          title="Skills"
          description={
            <>
              SKILL.md files that extend Copilot&apos;s capabilities. Copilot
              reads from ~/.claude/skills/ (shared with Claude), ~/.copilot/skills/
              (user), and .github/skills/ (project).
            </>
          }
        >
          <Button
            variant="primary"
            onClick={() => openPath(`${homedir}/.copilot/skills`)}
          >
            Open Folder
          </Button>
        </SettingsRow>
        </SettingsSection>
      )}

      <ProviderUsageSection
        isLoading={isLoadingRateLimits}
        rows={usageRows}
        readout="counts"
      />
    </ProviderSettingsLayout>
  );
}
