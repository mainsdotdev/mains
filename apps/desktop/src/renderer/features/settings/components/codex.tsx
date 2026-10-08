import { useEffect, useState } from "react";
import { appEvents } from "@/lib/transport";
import { Alert, Button, FullAccessConfirmationModal, Select, Text, Toggle, toast } from "@/components/ui";
import {
  SettingsSection,
  SettingsRow,
  SettingsDivider,
} from "./settings-layout";
import {
  useGetProviderRateLimitsQuery,
  useGetProviderAccountInfoQuery,
  useConsumeProviderRateLimitResetCreditMutation,
  useGetProviderRealtimeVoicesQuery,
  useGetCodexMemorySettingsQuery,
  useSetCodexMemorySettingMutation,
  useResetCodexMemoriesMutation,
} from "@/lib/redux/api";
import { providersApi } from "@/lib/redux/api/providersApi";
import { useAppDispatch } from "@/lib/redux/hooks";
import type { RateLimitInfo } from "../../../../shared/adapter.types";
import { StructuredOutputsModal } from "./structured-outputs-modal";
import { CodexVoiceSettings } from "./codex-voice-settings";
import type { CodexAdapterConfig } from "../../../../shared/adapter.types";
import type { CodexMemorySetting } from "../../../../shared/adapter.types";

type CodexApprovalMode = NonNullable<CodexAdapterConfig["approvalMode"]>;
import {
  ProviderAccountSection,
  ProviderCliSection,
  ProviderSettingsLayout,
  ProviderUsageSection,
  selectedSchemaLabel,
  useProviderSettings,
  type ProviderUsageRow,
} from "./provider-settings-shared";
import { CODEX_SANDBOX_MODES } from "@/lib/provider-modes";
import { PROVIDER_IDS } from "../../../../shared/provider-ids";
import { getProviderVariant } from "@/lib/provider-variants";
import { extractErrorMessage } from "@/lib/extract-error-message";
import {
  buildCodexResetCreditSummary,
  buildCodexUsageRows,
  mergeCodexRateLimitUpdate,
} from "../lib/codex-usage";

const APPROVAL_OPTIONS: Array<{
  value: CodexApprovalMode;
  label: string;
  description: string;
}> = [
  {
    value: "on-request",
    label: "On Request",
    description: "Ask when escalation is requested",
  },
  {
    value: "untrusted",
    label: "Untrusted",
    description: "Always ask before taking action",
  },
  {
    value: "never",
    label: "Never",
    description: "Run without asking for approval",
  },
];

const SANDBOX_OPTIONS = CODEX_SANDBOX_MODES.map((m) => ({
  value: m.value,
  label: m.label,
  description: m.description,
}));

function CodexMemorySection({ providerEnabled }: { providerEnabled: boolean }) {
  const settings = useGetCodexMemorySettingsQuery(PROVIDER_IDS.codex, {
    skip: !providerEnabled,
  });
  const [setSetting, { isLoading: isUpdating }] =
    useSetCodexMemorySettingMutation();
  const [resetMemories, { isLoading: isResetting }] =
    useResetCodexMemoriesMutation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const memory = settings.data;
  const busy = isUpdating || settings.isFetching;
  const canEdit = providerEnabled && memory?.supported === true;

  const update = async (setting: CodexMemorySetting, enabled: boolean) => {
    try {
      await setSetting({ providerId: PROVIDER_IDS.codex, setting, enabled }).unwrap();
      toast.success("Memory preference saved.");
    } catch (error) {
      toast.error(extractErrorMessage(error, "Could not save memory preference"));
    }
  };

  const deleteMemories = async () => {
    try {
      await resetMemories(PROVIDER_IDS.codex).unwrap();
      setConfirmDelete(false);
      toast.success("Saved memories cleared.");
    } catch (error) {
      toast.error(extractErrorMessage(error, "Could not clear saved memories"));
    }
  };

  return (
    <SettingsSection
      title="Conversation memory"
      titleActions={<Text as="span" size="xs" tone="subtle" className="self-end">Local</Text>}
    >
      {!providerEnabled ? (
        <div className="py-4">
          <Text tone="subtle">Turn on Codex to manage its saved memories.</Text>
        </div>
      ) : settings.isLoading ? (
        <div className="py-4">
          <Text tone="subtle">Loading memory preferences…</Text>
        </div>
      ) : settings.error ? (
        <div className="flex items-center justify-between gap-4 py-4">
          <Text tone="subtle">{extractErrorMessage(settings.error, "Could not load memory preferences")}</Text>
          <Button variant="secondary" onClick={() => { void settings.refetch(); }}>
            Retry
          </Button>
        </div>
      ) : !memory?.supported ? (
        <div className="py-4">
          <Text tone="subtle">This Codex version cannot manage memory preferences here.</Text>
        </div>
      ) : (
        <>
          <SettingsRow
            title="Use saved memories"
            description="Save useful details from your chats for Codex to use in future conversations"
          >
            {memory.memoriesEnabled === null ? (
              <div className="flex flex-wrap items-center gap-2">
                <Text as="span" size="xs" tone="subtle">Not reported by Codex</Text>
                <Button variant="secondary" disabled={busy} onClick={() => { void update("memoriesEnabled", true); }}>
                  Enable
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => { void update("memoriesEnabled", false); }}>
                  Disable
                </Button>
              </div>
            ) : (
              <Toggle
                enabled={memory.memoriesEnabled}
                aria-label="Use saved memories"
                disabled={busy}
                onChange={(enabled) => { void update("memoriesEnabled", enabled); }}
              />
            )}
          </SettingsRow>
          <SettingsDivider />
          <SettingsRow
            title="Include chats that use tools"
            description="Let Codex remember details from chats that used MCP tools or web search"
          >
            {memory.allowToolAssistedChats === null ? (
              <div className="flex flex-wrap items-center gap-2">
                <Text as="span" size="xs" tone="subtle">Using Codex default</Text>
                <Button
                  variant="secondary"
                  disabled={busy || !memory.memoriesEnabled}
                  onClick={() => { void update("allowToolAssistedChats", true); }}
                >
                  Allow
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || !memory.memoriesEnabled}
                  onClick={() => { void update("allowToolAssistedChats", false); }}
                >
                  Block
                </Button>
              </div>
            ) : (
              <Toggle
                enabled={memory.allowToolAssistedChats}
                aria-label="Include chats that use tools"
                disabled={busy || !memory.memoriesEnabled}
                onChange={(enabled) => { void update("allowToolAssistedChats", enabled); }}
              />
            )}
          </SettingsRow>
          <SettingsDivider />
          <SettingsRow
            title="Clear saved memories"
            description="Remove every memory Codex has stored on this device"
          >
            <Button
              variant="danger"
              disabled={!canEdit || isResetting}
              onClick={() => setConfirmDelete(true)}
            >
              Clear
            </Button>
          </SettingsRow>
        </>
      )}
      <Alert
        isOpen={confirmDelete}
        title="Clear saved memories?"
        description="Codex will forget the memories saved on this device. You can't undo this."
        primaryButtonText="Clear memories"
        primaryButtonVariant="danger"
        secondaryButtonText="Cancel"
        onPrimary={() => { void deleteMemories(); }}
        onSecondary={() => setConfirmDelete(false)}
        isPrimaryLoading={isResetting}
      />
    </SettingsSection>
  );
}

export default function CodexSettings() {
  const { provider, isLoading, error, config, updateConfig, updating } =
    useProviderSettings<CodexAdapterConfig>(PROVIDER_IDS.codex, "codex");
  const voices = useGetProviderRealtimeVoicesQuery(PROVIDER_IDS.codex, { skip: !provider?.isEnabled });
  const { data: rateLimits, isLoading: isLoadingRateLimits } =
    useGetProviderRateLimitsQuery(PROVIDER_IDS.codex, {
      pollingInterval: 60000,
    });

  // Codex streams `account/rateLimits/updated` while a run is active; patch the
  // query cache so this panel reflects the fresh snapshot instead of waiting
  // for the 60s poll.
  const dispatch = useAppDispatch();
  useEffect(() => {
    const off = appEvents.providers.onRateLimitsUpdated(
      ({ providerId, rateLimits: next }) => {
        if (providerId !== PROVIDER_IDS.codex || !next) return;
        dispatch(
          providersApi.util.updateQueryData(
            "getProviderRateLimits",
            PROVIDER_IDS.codex,
            (current) =>
              mergeCodexRateLimitUpdate(current, next as RateLimitInfo),
          ),
        );
      },
    );
    return () => {
      off();
    };
  }, [dispatch]);
  const { data: accountInfo, isLoading: isLoadingAccount } =
    useGetProviderAccountInfoQuery(PROVIDER_IDS.codex);
  const cli = accountInfo?.cli;

  const [isStructuredOutputsModalOpen, setIsStructuredOutputsModalOpen] =
    useState(false);
  const [isFullAccessConfirmationOpen, setIsFullAccessConfirmationOpen] =
    useState(false);
  const [resetAttempt, setResetAttempt] = useState<{
    idempotencyKey: string;
    creditId?: string;
  } | null>(null);
  const [consumeResetCredit, { isLoading: isConsumingResetCredit }] =
    useConsumeProviderRateLimitResetCreditMutation();

  const approvalMode = config.approvalMode ?? "on-request";
  const sandboxMode = config.sandboxMode ?? "workspace-write";
  const networkAccessEnabled = config.networkAccessEnabled ?? true;
  const webSearchMode = config.webSearchMode ?? "live";
  const skipGitRepoCheck = config.skipGitRepoCheck ?? false;

  const selectedSchemaName = selectedSchemaLabel(config);

  const account = accountInfo?.account;

  const usageRows: ProviderUsageRow[] = buildCodexUsageRows(rateLimits);
  const resetCreditSummary = buildCodexResetCreditSummary(rateLimits);
  const resetCredits = rateLimits?.rateLimitResetCredits;
  const availableResetCredit = resetCredits?.credits?.find(
    (credit) => credit.status === "available",
  );
  const coreUsage = rateLimits?.rateLimitsByLimitId?.codex ?? rateLimits;
  const canResetUsage = [coreUsage?.primary, coreUsage?.secondary].some(
    (window) => window !== undefined && window.usedPercent >= 90,
  );
  const canUseResetCredit =
    (resetCredits?.availableCount ?? 0) > 0 && canResetUsage;

  const openResetConfirmation = () => {
    if (!canUseResetCredit) return;
    setResetAttempt({
      idempotencyKey: globalThis.crypto.randomUUID(),
      ...(availableResetCredit?.id
        ? { creditId: availableResetCredit.id }
        : {}),
    });
  };

  const confirmReset = async () => {
    if (!resetAttempt || isConsumingResetCredit) return;
    try {
      const outcome = await consumeResetCredit({
        providerId: PROVIDER_IDS.codex,
        params: resetAttempt,
      }).unwrap();

      setResetAttempt(null);
      if (outcome === "reset") {
        toast.success("Codex usage limit reset.");
      } else if (outcome === "alreadyRedeemed") {
        toast.success("This reset was already applied.");
      } else if (outcome === "noCredit") {
        toast.error("No reset credit is available.");
      } else {
        toast.error("No eligible usage limit can be reset yet.");
      }
    } catch (err: unknown) {
      // Keep the dialog and idempotency key alive: retrying an uncertain call
      // must not create a second redemption attempt.
      toast.error(extractErrorMessage(err, "Failed to use reset credit"));
    }
  };

  return (
    <ProviderSettingsLayout
      title={getProviderVariant("codex").label}
      provider={provider}
      isLoading={isLoading}
      error={error}
      className="pb-16"
    >
      {/* Account info */}
      <ProviderAccountSection
        isLoading={isLoadingAccount}
        signedIn={
          account?.type === "chatgpt"
            ? {
                title: account.email ?? "ChatGPT account",
                description: account.type,
                plan:
                  account.planType.charAt(0).toUpperCase() +
                  account.planType.slice(1),
              }
            : account?.type === "amazonBedrock"
              ? {
                  title: "Amazon Bedrock",
                  description: account.type,
                  plan: account.usesCodexManagedCredentials
                    ? "Managed credentials"
                    : "AWS credentials",
                }
            : null
        }
        isApiKey={account?.type === "apiKey"}
        notSignedInDescription="Sign in to Codex to view account details"
      />

      {/* CLI version + self-update — `codex --version` / `codex update` */}
      <ProviderCliSection
        providerId={PROVIDER_IDS.codex}
        cliName="Codex CLI"
        shortName={getProviderVariant("codex").label}
        cli={cli}
        buttonVariant="secondary"
      >
        {cli?.compatibility === "unsupported" && (
          <SettingsRow
            title="Update required"
            description={`Mains requires Codex CLI ${cli.minimumVersion ?? "0.153.0"} or newer.`}
          >
            <Text as="span" size="xs" tone="danger" weight="medium">
              Unsupported
            </Text>
          </SettingsRow>
        )}
        {cli?.compatibility === "newer" && (
          <SettingsRow
            title="Newer CLI detected"
            description={`This CLI is newer than the tested app-server contract (${cli.testedProtocolVersion ?? "unknown"}). Forward-compatible mode is active.`}
          >
            <Text as="span" size="xs" tone="warning" weight="medium">
              Untested
            </Text>
          </SettingsRow>
        )}
      </ProviderCliSection>

      {/* Rate limits */}
      <ProviderUsageSection
        isLoading={isLoadingRateLimits}
        rows={usageRows}
        readout="percentLeft"
        summary={resetCreditSummary}
        summaryAction={
          (resetCredits?.availableCount ?? 0) > 0 ? (
            <Button
              variant="secondary"
              onClick={openResetConfirmation}
              disabled={!canUseResetCredit}
              tooltip={
                canUseResetCredit
                  ? "Spend one earned reset credit"
                  : "A five-hour or weekly limit can be reset at 10% remaining"
              }
            >
              Use reset
            </Button>
          ) : undefined
        }
        notice={
          rateLimits?.ordinaryUsageAllowed === false
            ? "Advanced usage is temporarily unavailable for this account."
            : undefined
        }
      />

      <CodexVoiceSettings
        config={config}
        catalog={voices.data}
        loading={voices.isFetching}
        error={voices.error}
        updating={updating}
        onUpdate={updateConfig}
        onRetry={() => { void voices.refetch(); }}
      />

      <CodexMemorySection providerEnabled={provider?.isEnabled === true} />

      <SettingsSection title="Configuration">
        <SettingsRow
          title="Approval Policy"
          description="Choose when Codex asks for approval"
        >
          <Select
            value={approvalMode}
            aria-label="Approval policy"
            options={APPROVAL_OPTIONS}
            onChange={(value) => {
              updateConfig({ approvalMode: value });
              const label =
                APPROVAL_OPTIONS.find((o) => o.value === value)?.label ?? value;
              toast.success(`Approval: ${label}`);
            }}
          />
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          title="Sandbox Mode"
          description="Controls file and network isolation for the agent"
        >
          <Select
            value={sandboxMode}
            aria-label="Sandbox mode"
            options={SANDBOX_OPTIONS}
            onChange={(value) => {
              if (value === "danger-full-access") {
                setIsFullAccessConfirmationOpen(true);
                return;
              }
              updateConfig({ sandboxMode: value });
              const label =
                SANDBOX_OPTIONS.find((o) => o.value === value)?.label ?? value;
              toast.success(`Sandbox: ${label}`);
            }}
          />
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          title="Network Access"
          description="Allow network access within workspace-write sandbox mode"
        >
          <Toggle
            enabled={networkAccessEnabled}
            aria-label="Allow network access"
            onChange={(enabled) => {
              updateConfig({ networkAccessEnabled: enabled });
              toast.success(
                enabled ? "Network access enabled" : "Network access disabled",
              );
            }}
          />
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          title="Web Search"
          description="Allow the agent to search the web during runs"
        >
          <Toggle
            enabled={webSearchMode === "live"}
            aria-label="Allow web search"
            onChange={(enabled) => {
              updateConfig({ webSearchMode: enabled ? "live" : "disabled" });
              toast.success(
                enabled ? "Web search enabled" : "Web search disabled",
              );
            }}
          />
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          title="Skip Git Check"
          description="Allow running in non-git directories"
        >
          <Toggle
            enabled={skipGitRepoCheck}
            aria-label="Skip Git repository check"
            onChange={(enabled) => {
              updateConfig({ skipGitRepoCheck: enabled });
              toast.success(
                enabled ? "Git check skipped" : "Git check required",
              );
            }}
          />
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          title="Structured Output"
          description="Define JSON Schemas to constrain the agent's output format"
        >
          <div className="flex items-center gap-3">
            <Text as="span" tone="subtle">
              {selectedSchemaName}
            </Text>
            <Button
              variant="primary"
              onClick={() => setIsStructuredOutputsModalOpen(true)}
            >
              Edit
            </Button>
          </div>
        </SettingsRow>
      </SettingsSection>

      <StructuredOutputsModal
        isOpen={isStructuredOutputsModalOpen}
        onClose={() => setIsStructuredOutputsModalOpen(false)}
        providerId={PROVIDER_IDS.codex}
      />

      <FullAccessConfirmationModal
        isOpen={isFullAccessConfirmationOpen}
        onCancel={() => setIsFullAccessConfirmationOpen(false)}
        onConfirm={() => {
          setIsFullAccessConfirmationOpen(false);
          updateConfig({ sandboxMode: "danger-full-access" });
          toast.success("Sandbox: Full Access");
        }}
      />

      <Alert
        isOpen={resetAttempt !== null}
        title="Use a reset credit?"
        description="This spends one earned credit to reset an eligible Codex usage window. The credit cannot be restored."
        primaryButtonText="Use reset"
        secondaryButtonText="Cancel"
        onPrimary={confirmReset}
        onSecondary={() => setResetAttempt(null)}
        isPrimaryLoading={isConsumingResetCredit}
      />
    </ProviderSettingsLayout>
  );
}
