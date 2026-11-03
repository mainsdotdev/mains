import { Select } from "@/components/ui";
import { SettingsSection, SettingsRow } from "./settings-layout";
import {
  ProviderAccountSection,
  ProviderCliSection,
  ProviderSettingsLayout,
  useProviderSettings,
} from "./provider-settings-shared";
import type { OpenCodeAdapterConfig } from "../../../../shared/adapter.types";
import { OPENCODE_AGENTS } from "@/lib/provider-modes";
import { PROVIDER_IDS } from "../../../../shared/provider-ids";
import { getProviderVariant } from "@/lib/provider-variants";
import { useGetProviderAccountInfoQuery } from "@/lib/redux/api/providersApi";

export default function OpenCodeSettings() {
  const {
    provider,
    isLoading,
    error,
    config,
    updateConfig,
  } = useProviderSettings<OpenCodeAdapterConfig>(PROVIDER_IDS.opencode, "opencode");
  const agent = config.agent ?? "build";
  const { data: accountInfo, isLoading: isLoadingAccount } =
    useGetProviderAccountInfoQuery(PROVIDER_IDS.opencode);
  const cli = accountInfo?.cli;
  const account = accountInfo?.account;

  return (
    <ProviderSettingsLayout
      title={getProviderVariant("opencode").label}
      provider={provider}
      isLoading={isLoading}
      error={error}
    >
      <ProviderAccountSection
        providerId={PROVIDER_IDS.opencode}
        isLoading={isLoadingAccount}
        signedIn={
          account?.type === "opencode"
            ? {
                title: account.providers.join(", "),
                description: "Signed in",
                plan: "OpenCode",
              }
            : null
        }
        notSignedInDescription="Run `opencode auth login` and connect a model provider."
      />
      <ProviderCliSection
        providerId={PROVIDER_IDS.opencode}
        cliName="OpenCode"
        shortName={getProviderVariant("opencode").label}
        cli={cli}
      />
      <SettingsSection title="Configuration">
        <SettingsRow title="Agent" description="Which OpenCode agent runs the session">
          <Select
            value={agent}
            aria-label="OpenCode agent"
            onChange={(value) =>
              updateConfig({ agent: value as OpenCodeAdapterConfig["agent"] })
            }
            options={OPENCODE_AGENTS.map((entry) => ({
              value: entry.value,
              label: entry.label,
              description: entry.description,
            }))}
          />
        </SettingsRow>
      </SettingsSection>
    </ProviderSettingsLayout>
  );
}
