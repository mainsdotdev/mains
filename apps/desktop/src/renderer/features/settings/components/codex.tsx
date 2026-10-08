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
} from "@/lib/redux/api";
import { providersApi } from "@/lib/redux/api/providersApi";
import { useAppDispatch } from "@/lib/redux/hooks";
import type { RateLimitInfo } from "../../../../shared/adapter.types";
import { StructuredOutputsModal } from "./structured-outputs-modal";
import { CodexVoiceSettings } from "./codex-voice-settings";
import type { CodexAdapterConfig } from "../../../../shared/adapter.types";

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
