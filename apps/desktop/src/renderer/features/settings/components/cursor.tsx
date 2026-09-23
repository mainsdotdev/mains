import { Select, Text } from "@/components/ui";
import { SettingsSection, SettingsRow } from "./settings-layout";
import {
  ProviderAccountSection,
  ProviderCliSection,
  ProviderSettingsLayout,
  useProviderSettings,
} from "./provider-settings-shared";
import type { CursorAdapterConfig } from "../../../../shared/adapter.types";
import { CURSOR_MODES } from "@/lib/provider-modes";
import { PROVIDER_IDS } from "../../../../shared/provider-ids";
import { getProviderVariant } from "@/lib/provider-variants";
import { useGetProviderAccountInfoQuery } from "@/lib/redux/api/providersApi";

export default function CursorSettings(
) {
  const {
    provider,
    isLoading,
    error,
    config,
    updateConfig,
  } = useProviderSettings<CursorAdapterConfig>(PROVIDER_IDS.cursor, "cursor");
  const mode = config.mode ?? "agent";

  const { data: accountInfo, isLoading: isLoadingAccount } =
    useGetProviderAccountInfoQuery(PROVIDER_IDS.cursor);
  const account = accountInfo?.account;
  const cli = accountInfo?.cli;

  return (
    <ProviderSettingsLayout
      title={getProviderVariant("cursor").label}
      provider={provider}
      isLoading={isLoading}
      error={error}
    >
      {/* Account info — from `agent about` */}
      <ProviderAccountSection
        isLoading={isLoadingAccount}
        signedIn={
          account?.type === "cursor"
            ? {
                title: account.email,
                description: "Signed in",
                plan: account.planType || "Cursor",
              }
            : null
        }
        notSignedInDescription="Run `agent login` in your terminal to authenticate"
      />

      {/* CLI version + self-update — `agent about` / `agent update` */}
      <ProviderCliSection
        providerId={PROVIDER_IDS.cursor}
        cliName="Cursor Agent CLI"
        shortName={getProviderVariant("cursor").label}
        cli={cli}
      >
        {cli?.outdated && (
          <SettingsRow
            title="Update recommended"
            description="This CLI is too old for model effort controls. Update to enable them."
          >
            <Text as="span" size="xs" tone="warning">
              Outdated
            </Text>
          </SettingsRow>
        )}
      </ProviderCliSection>

      <SettingsSection title="Configuration">
        <SettingsRow title="Mode" description="How Cursor operates during runs">
          <Select
            value={mode}
            aria-label="Cursor mode"
            onChange={(value) =>
              updateConfig({ mode: value as CursorAdapterConfig["mode"] })
            }
            options={CURSOR_MODES.map((m) => ({
              value: m.value,
              label: m.label,
              description: m.description,
            }))}
          />
        </SettingsRow>
      </SettingsSection>
    </ProviderSettingsLayout>
  );
}
