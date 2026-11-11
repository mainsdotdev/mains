import { useState } from "react";
import type { AtlasAutoTagging } from "@mains/contracts/atlas";
import { Button, Muted, Select, Text, Toggle, toast } from "@/components/ui";
import { useGetAccountQuery, useGetProviderModelsQuery, useGetProvidersQuery } from "@/lib/redux/api";
import { useAtlasAutoTaggingQuery, useSetAtlasAutoTaggingMutation } from "@/lib/redux/api/atlasApi";
import { useAppSelector } from "@/lib/redux/hooks";
import { getTransport } from "@/lib/transport";
import { getProviderVariantById } from "@/lib/provider-variants";
import { atlasError } from "@/features/atlas/hooks/use-save-to-atlas";
import { SettingsDivider, SettingsPageShell, SettingsRow, SettingsSection } from "./settings-layout";

export default function AtlasSettings() {
  const account = useGetAccountQuery();
  const accountId = account.data?.id ?? "";
  const backendId = useAppSelector((state) => state.backends.activeBackendId);
  const preferences = useAtlasAutoTaggingQuery({ accountId }, { skip: !accountId });
  const config = preferences.currentData;
  const error = account.error ?? preferences.error;
  const loading = !error && (account.isLoading || !accountId || preferences.isLoading || !config);

  return (
    <SettingsPageShell title="Atlas" isLoading={loading} loadingMessage="Loading Atlas settings…"
      error={error} errorMessage={atlasError(error)}
      headerActions={error ? <Button variant="ghost" onClick={() => { void account.refetch(); if (accountId) void preferences.refetch(); }}>Retry</Button> : undefined}>
      {accountId && config && (
        <AtlasSettingsForm key={JSON.stringify([backendId, accountId, config])} accountId={accountId} initial={config} />
      )}
    </SettingsPageShell>
  );
}

function AtlasSettingsForm({ accountId, initial }: { accountId: string; initial: AtlasAutoTagging }) {
  const [config, setConfig] = useState(initial);
  const [savedConfig, setSavedConfig] = useState(initial);
  const [error, setError] = useState("");
  const providers = useGetProvidersQuery();
  const models = useGetProviderModelsQuery(config.providerId, { skip: !config.providerId });
  const [save, saving] = useSetAtlasAutoTaggingMutation();
  const enabledProviders = (providers.data ?? []).filter((provider) => provider.isEnabled);
  const modelOptions = (models.currentData ?? []).map((model) => ({ value: model.id, label: model.displayName }));
  const missingChoice = config.enabled && (!config.providerId || !config.model);
  const isDirty = config.enabled !== savedConfig.enabled || config.providerId !== savedConfig.providerId || config.model !== savedConfig.model;

  const submit = async () => {
    if (saving.isLoading || missingChoice || !isDirty) return;
    const transport = getTransport();
    setError("");
    try {
      await save({ accountId, config }).unwrap();
      if (getTransport() === transport) {
        setSavedConfig(config);
        toast.success("Atlas settings saved");
      }
    } catch (error) {
      if (getTransport() === transport) setError(atlasError(error));
    }
  };

  return (
    <form aria-label="Atlas settings" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <SettingsSection title="Bookmarks">
        <SettingsRow title="Automatic tagging"
          description="Use AI to add relevant tags and recognize the type of each new bookmark.">
          <Toggle aria-label="Automatically tag bookmarks" enabled={config.enabled} disabled={saving.isLoading}
            onChange={(enabled) => setConfig({ ...config, enabled })} />
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow title="Provider" description="Choose the provider Atlas uses to organize your bookmarks.">
          <div className="w-full md:w-64">
            <Select aria-label="Atlas provider" value={config.providerId}
              options={enabledProviders.map((provider) => ({ value: provider.id, label: getProviderVariantById(provider.id)?.label ?? provider.displayName }))}
              placeholder={providers.isFetching ? "Loading providers…" : "Choose a provider"}
              disabled={saving.isLoading || providers.isFetching}
              onChange={(providerId) => setConfig({ ...config, providerId, model: "" })} />
          </div>
        </SettingsRow>
        {!!providers.error && <div className="flex items-center justify-between gap-3 pb-3">
          <Text role="alert" size="xs">Could not load providers.</Text>
          <Button type="button" variant="ghost" onClick={() => void providers.refetch()}>Retry providers</Button>
        </div>}
        <SettingsDivider />
        <SettingsRow title="Model" description="A small, economical model is enough. This is independent of your chat model.">
          <div className="w-full md:w-64">
            <Select aria-label="Atlas model" value={config.model} options={modelOptions}
              placeholder={models.isFetching ? "Loading models…" : "Choose a model"}
              disabled={saving.isLoading || !config.providerId || models.isFetching}
              onChange={(model) => setConfig({ ...config, model })} />
          </div>
        </SettingsRow>
        {!!models.error && <div className="flex items-center justify-between gap-3 pb-3">
          <Text role="alert" size="xs">Could not load models.</Text>
          <Button type="button" variant="ghost" onClick={() => void models.refetch()}>Retry models</Button>
        </div>}
      </SettingsSection>
      <Muted className="text-xs leading-relaxed">When enabled, a short page excerpt is sent to the selected provider after saving.
        To tag an existing bookmark, choose “Refresh details and tags” from its menu.</Muted>
      {error && <Text role="alert" className="mt-4 text-danger">{error}</Text>}
      <div className="mt-5 flex justify-end">
        <Button type="submit" variant="submit" disabled={!isDirty || saving.isLoading || missingChoice} isLoading={saving.isLoading}>
          Save
        </Button>
      </div>
    </form>
  );
}
