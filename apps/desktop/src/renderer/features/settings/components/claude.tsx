import { useState } from "react";
import { Button, Select, Text } from "@/components/ui";
import { SettingsSection, SettingsRow, SettingsDivider } from "./settings-layout";
import { useCapabilities } from "@/lib/platform";
import {
  ProviderAccountSection,
  ProviderCliSection,
  ProviderSettingsLayout,
  selectedSchemaLabel,
  useProviderSettings,
} from "./provider-settings-shared";
import { StructuredOutputsModal } from "./structured-outputs-modal";
import type { ClaudeCodeAdapterConfig } from "../../../../shared/adapter.types";
import { PROVIDER_IDS } from "../../../../shared/provider-ids";
import { getProviderVariant } from "@/lib/provider-variants";
import { useGetProviderAccountInfoQuery } from "@/lib/redux/api";
import { CLAUDE_PERMISSION_MODES } from "@/lib/provider-modes";
import {
  DEFAULT_CLAUDE_PERMISSION_MODE,
  type ClaudePermissionMode,
} from "../../../../shared/claude-permission-modes";

const SETTINGS_PERMISSION_MODES = CLAUDE_PERMISSION_MODES.map((mode) => ({
  value: mode.value,
  label: mode.label,
  description: mode.description,
}));

export default function ClaudeSettings(
) {
  const {
    provider,
    isLoading,
    error,
    updating,
    config,
    updateConfig,
  } = useProviderSettings<ClaudeCodeAdapterConfig>(PROVIDER_IDS.claude, "claude");

  const [isStructuredOutputsModalOpen, setIsStructuredOutputsModalOpen] =
    useState(false);

  const { data: accountInfo, isLoading: isLoadingAccount } =
    useGetProviderAccountInfoQuery(PROVIDER_IDS.claude);
  const account = accountInfo?.account;
  const cli = accountInfo?.cli;

  const permissionMode = config.permissionMode ?? DEFAULT_CLAUDE_PERMISSION_MODE;
  const selectedSchemaName = selectedSchemaLabel(config);

  const handlePermissionModeChange = async (mode: ClaudePermissionMode) => {
    if (!provider || updating) return;
    await updateConfig({ permissionMode: mode });
  };

  const openPath = (targetPath: string) => {
    window.api.shell.openPath(targetPath);
  };

  const homedir = window.api.platform.homedir;
  const { revealInFolder } = useCapabilities();

  return (
    <ProviderSettingsLayout
      title={getProviderVariant("claude").label}
      provider={provider}
      isLoading={isLoading}
      error={error}
    >
      {/* Account info — from the Claude Code login session */}
      <ProviderAccountSection
        isLoading={isLoadingAccount}
        signedIn={
          account?.type === "claude"
            ? {
                title: account.email,
                description: "Signed in",
                plan: account.planType || "Claude",
              }
            : null
        }
        isApiKey={account?.type === "apiKey"}
        notSignedInDescription="Run `claude auth login` in your terminal to authenticate"
      />

      {/* CLI version + self-update — `claude --version` / `claude update` */}
      <ProviderCliSection
        providerId={PROVIDER_IDS.claude}
        cliName="Claude Code CLI"
        shortName={getProviderVariant("claude").label}
        cli={cli}
      />

      <SettingsSection  title="Configuration">
        <SettingsRow
          title="Permission Mode"
          description="Controls how the agent handles tool permissions during runs."
        >
          <Select
            value={permissionMode}
            aria-label="Permission mode"
            options={SETTINGS_PERMISSION_MODES}
            onChange={handlePermissionModeChange}
          />
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          title="Structured Output"
          description={
            <>
              Define JSON Schemas to constrain the agent&apos;s output format.{" "}
              <a
                href="https://platform.claude.com/docs/en/agent-sdk/structured-outputs"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 underline"
              >
                Learn more about structured outputs
              </a>
            </>
          }
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


      {revealInFolder && (
        <SettingsSection title="Capabilities">
        <SettingsRow
          title="MCP Servers"
          description={
            <>
              Connect external tools via the Model Context Protocol. Servers
              configured here are passed to the SDK programmatically. The CLI also
              auto-loads .mcp.json from the project root.{" "}
              <a
                href="https://platform.claude.com/docs/en/agent-sdk/mcp"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 underline"
              >
                Learn more about MCP
              </a>
            </>
          }
        >
          <Button
            variant="primary"
            onClick={() => openPath(`${homedir}/.claude.json`)}
          >
            Open Config
          </Button>
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          title="Skills"
          description={
            <>
              SKILL.md files that extend Claude&apos;s capabilities. Located in
              ~/.claude/skills/ (user) and .claude/skills/ (project).{" "}
              <a
                href="https://platform.claude.com/docs/en/agent-sdk/skills"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 underline"
              >
                Learn more about skills
              </a>
            </>
          }
        >
          <Button
            variant="primary"
            onClick={() => openPath(`${homedir}/.claude/skills`)}
          >
            Open Folder
          </Button>
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          title="Agents"
          description={
            <>
              Define agents as markdown files in ~/.claude/agents/.{" "}
              <a
                href="https://platform.claude.com/docs/en/agent-sdk/subagents"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 underline"
              >
                Learn more about subagents
              </a>
            </>
          }
        >
          <Button
            variant="primary"
            onClick={() => openPath(`${homedir}/.claude/agents`)}
          >
            Open Folder
          </Button>
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          title="Slash Commands"
          description={
            <>
              Custom slash commands available during agent sessions. Discovered
              from the Claude CLI.{" "}
              <a
                href="https://platform.claude.com/docs/en/agent-sdk/slash-commands"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 underline"
              >
                Learn more about slash commands
              </a>
            </>
          }
        >
          <Button
            variant="primary"
            onClick={() => openPath(`${homedir}/.claude/commands`)}
          >
            Open Folder
          </Button>
        </SettingsRow>
        </SettingsSection>
      )}

      <StructuredOutputsModal
        isOpen={isStructuredOutputsModalOpen}
        onClose={() => setIsStructuredOutputsModalOpen(false)}
        providerId={PROVIDER_IDS.claude}
      />
    </ProviderSettingsLayout>
  );
}

