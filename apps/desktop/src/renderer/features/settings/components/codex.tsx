import { useEffect, useState } from "react";
import { appEvents } from "@/lib/transport";
import { Button, Select, Text, Toggle, toast } from "@/components/ui";
import {
  SettingsSection,
  SettingsRow,
  SettingsDivider,
} from "./settings-layout";
import {
  useGetProviderRateLimitsQuery,
  useGetProviderAccountInfoQuery,
} from "@/lib/redux/api";
import { providersApi } from "@/lib/redux/api/providersApi";
import { useAppDispatch } from "@/lib/redux/hooks";
import type { RateLimitInfo } from "../../../../shared/adapter.types";
import { StructuredOutputsModal } from "./structured-outputs-modal";
import type { CodexAdapterConfig } from "../../../../shared/adapter.types";

type CodexApprovalMode = NonNullable<CodexAdapterConfig["approvalMode"]>;
type CodexPersonality = NonNullable<CodexAdapterConfig["personality"]>;
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
import { modeProviderSetting } from "../../../../shared/mode-harness";
import { useModeConfig } from "@/hooks/use-mode-config";

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

const PERSONALITY_OPTIONS: Array<{
  value: CodexPersonality;
  label: string;
  description: string;
}> = [
  {
    value: "none",
    label: "None",
    description: "No personality injected",
  },
  {
    value: "friendly",
    label: "Friendly",
    description: "Warm and conversational tone",
  },
  {
    value: "pragmatic",
    label: "Pragmatic",
    description: "Direct and practical tone",
  },
];

function personalityLabel(value: CodexPersonality): string {
  return PERSONALITY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

const SANDBOX_OPTIONS = CODEX_SANDBOX_MODES.map((m) => ({
  value: m.value,
  label: m.label,
  description: m.description,
}));

function usageLimitLabel(
  windowDurationMins: number | undefined,
  fallback: string,
): string {
  if (
    windowDurationMins === undefined ||
    !Number.isFinite(windowDurationMins) ||
    windowDurationMins <= 0
  ) {
    return fallback;
  }

  if (windowDurationMins === 7 * 24 * 60) return "Weekly usage limit";
  if (windowDurationMins === 24 * 60) return "Daily usage limit";
  if (windowDurationMins % (24 * 60) === 0) {
    return `${windowDurationMins / (24 * 60)} day usage limit`;
  }
  if (windowDurationMins % 60 === 0) {
    return `${windowDurationMins / 60} hour usage limit`;
  }
  return `${windowDurationMins} minute usage limit`;
}

export default function CodexSettings() {
  const { provider, isLoading, error, config, updateConfig } =
    useProviderSettings<CodexAdapterConfig>(PROVIDER_IDS.codex, "codex");
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
            () => next as RateLimitInfo,
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

  // Work and Chat pin the agent's tone through the mode harness, so the picker
  // would be a control that changes nothing there. Read the pin from the
  // harness itself rather than a second list of modes — this row then follows
  // the table automatically. It stays visible (read-only) instead of
  // disappearing: the stored value still governs Code spaces, and Settings has
  // no space switcher to go change it from.
  const { mode, label: modeLabel } = useModeConfig();
  const pinnedPersonality = modeProviderSetting(
    mode,
    PROVIDER_IDS.codex,
    "personality",
  ) as CodexPersonality | undefined;

  const approvalMode = config.approvalMode ?? "on-request";
  const sandboxMode = config.sandboxMode ?? "workspace-write";
  const networkAccessEnabled = config.networkAccessEnabled ?? true;
  const webSearchMode = config.webSearchMode ?? "live";
  const skipGitRepoCheck = config.skipGitRepoCheck ?? false;
  const personality = config.personality ?? "none";

  const selectedSchemaName = selectedSchemaLabel(config);

  const account = accountInfo?.account;

  const usageRows: ProviderUsageRow[] = [
    ...(rateLimits?.primary
      ? [
          {
            label: usageLimitLabel(
              rateLimits.primary.windowDurationMins,
              "5 hour usage limit",
            ),
            usedPercent: rateLimits.primary.usedPercent,
            resetsAt: rateLimits.primary.resetsAt,
          },
        ]
      : []),
    ...(rateLimits?.secondary
      ? [
          {
            label: usageLimitLabel(
              rateLimits.secondary.windowDurationMins,
              "Weekly usage limit",
            ),
            usedPercent: rateLimits.secondary.usedPercent,
            resetsAt: rateLimits.secondary.resetsAt,
          },
        ]
      : []),
  ];

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
            description={`Mains requires Codex CLI ${cli.minimumVersion ?? "0.146.0"} or newer.`}
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
          title="Personality"
          description={
            pinnedPersonality
              ? `${modeLabel} spaces set the tone themselves. Switch to a Code space to change this.`
              : "Controls the agent's conversational style"
          }
        >
          {pinnedPersonality ? (
            <Text as="span" tone="subtle">
              {personalityLabel(pinnedPersonality)}
            </Text>
          ) : (
            <Select
              value={personality}
              aria-label="Personality"
              options={PERSONALITY_OPTIONS}
              onChange={(value) => {
                updateConfig({ personality: value });
                toast.success(`Personality: ${personalityLabel(value)}`);
              }}
            />
          )}
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
      {/* Rate limits */}
      <ProviderUsageSection
        isLoading={isLoadingRateLimits}
        rows={usageRows}
        readout="percentLeft"
      />

      <StructuredOutputsModal
        isOpen={isStructuredOutputsModalOpen}
        onClose={() => setIsStructuredOutputsModalOpen(false)}
        providerId={PROVIDER_IDS.codex}
      />
    </ProviderSettingsLayout>
  );
}
