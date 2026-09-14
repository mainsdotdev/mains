// ─────────────────────────────────────────────────────────────
// Work Run Adapter Factory
// Creates appropriate adapter based on provider configuration
// ─────────────────────────────────────────────────────────────

import type { ProviderResponse } from "../providers.dto";
import type { WorkRunAdapter, AdapterConfig, CopilotAdapterConfig, ClaudeCodeAdapterConfig, CodexAdapterConfig, CursorAdapterConfig, ModelInfo, CommandInfo, SkillInfo, PluginListResponse, PluginDetail, PluginScope, AccountInfo } from "../../../../shared/adapter.types";
import { createClaudeDriver } from "./claude.driver";
import { createCodexDriver } from "./codex.driver";
import { createCopilotDriver } from "./copilot.driver";
import { createCursorDriver } from "./cursor.driver";
import { createWorkRunAdapter } from "./work-run-core";
import { findCopilotCliPath } from "../providers.utils";
import {
  PROVIDER_IDS,
  SUPPORTED_PROVIDER_IDS,
  type ProviderId,
  isProviderId,
} from "../../../../shared/provider-ids";

/**
 * Known provider IDs that support work runs.
 * Re-exported from the canonical provider-ids registry for legacy call sites
 * that still import from this module.
 */
export const SUPPORTED_WORK_PROVIDERS = SUPPORTED_PROVIDER_IDS;
export type SupportedWorkProvider = ProviderId;

export const isSupportedWorkProvider = isProviderId as (
  providerId: string,
) => providerId is SupportedWorkProvider;

/**
 * Cache of adapter instances by provider ID
 * We reuse adapters to maintain connection state
 */
const adapterCache = new Map<string, WorkRunAdapter>();

/**
 * Resolved Copilot CLI entry point, memoized: `createWorkAdapter` runs on every
 * provider-touching IPC, and the resolution walks the filesystem.
 */
let copilotBinaryPath: string | null | undefined;

function resolveCopilotBinary(): string | null {
  if (copilotBinaryPath === undefined) {
    copilotBinaryPath = findCopilotCliPath() ?? null;
  }
  return copilotBinaryPath;
}

/**
 * The adapter config for a provider: its stored `config` blob plus the
 * `defaultModel` column, which lives outside it.
 */
function buildAdapterConfig(provider: ProviderResponse): AdapterConfig {
  switch (provider.id) {
    case PROVIDER_IDS.copilot: {
      const config: CopilotAdapterConfig = {
        ...(provider.config as CopilotAdapterConfig | null),
        defaultModel: provider.defaultModel ?? undefined,
      };
      // Resolve the Copilot CLI entry point if not explicitly configured.
      // The SDK's internal resolution uses import.meta.resolve() which
      // breaks in bundled CJS / packaged Electron contexts.
      if (!config.binary) {
        const resolvedPath = resolveCopilotBinary();
        if (resolvedPath) {
          config.binary = resolvedPath;
        }
      }
      return config;
    }

    case PROVIDER_IDS.claude:
      return {
        ...(provider.config as ClaudeCodeAdapterConfig | null),
        defaultModel: provider.defaultModel ?? undefined,
      } satisfies ClaudeCodeAdapterConfig;

    case PROVIDER_IDS.codex:
      return {
        ...(provider.config as CodexAdapterConfig | null),
        defaultModel: provider.defaultModel ?? undefined,
      } satisfies CodexAdapterConfig;

    case PROVIDER_IDS.cursor:
      return {
        ...(provider.config as CursorAdapterConfig | null),
        defaultModel: provider.defaultModel ?? undefined,
      } satisfies CursorAdapterConfig;

    default:
      throw new Error(
        `Provider "${provider.id}" is not supported for work runs. ` +
          `Supported providers: ${SUPPORTED_WORK_PROVIDERS.join(", ")}`,
      );
  }
}

function pluginListToSkillInfo(pluginList: PluginListResponse): SkillInfo[] {
  const skills: SkillInfo[] = [];

  for (const marketplace of pluginList.marketplaces) {
    for (const plugin of marketplace.plugins) {
      if (!plugin.installed) continue;

      skills.push({
        name: plugin.name,
        description:
          plugin.interface?.shortDescription ||
          plugin.interface?.longDescription ||
          undefined,
        userInvokable: true,
        displayName: plugin.interface?.displayName || plugin.name,
        shortDescription: plugin.interface?.shortDescription,
        iconSmall: plugin.interface?.composerIcon || plugin.interface?.logo,
        iconLarge: plugin.interface?.logo || plugin.interface?.composerIcon,
        brandColor: plugin.interface?.brandColor,
        defaultPrompt: plugin.interface?.defaultPrompt?.[0],
        scope: "plugin",
        enabled: plugin.enabled,
      });
    }
  }

  return skills;
}

function mergeSkillsWithInstalledPlugins(
  skills: SkillInfo[],
  pluginList: PluginListResponse,
): SkillInfo[] {
  const seenNames = new Set(skills.map((skill) => skill.name));
  const pluginSkills = pluginListToSkillInfo(pluginList).filter((pluginSkill) => {
    if (seenNames.has(pluginSkill.name)) return false;
    seenNames.add(pluginSkill.name);
    return true;
  });

  return [...skills, ...pluginSkills];
}

/**
 * Create or retrieve a work run adapter for the given provider
 *
 * @param provider - The provider configuration from the database
 * @returns WorkRunAdapter instance
 * @throws Error if provider is not supported or not enabled
 */
export function createWorkAdapter(provider: ProviderResponse): WorkRunAdapter {
  if (!provider.isEnabled) {
    throw new Error(
      `Provider "${provider.displayName}" (${provider.id}) is not enabled. ` +
        "Please enable it in settings before starting a work run."
    );
  }

  if (provider.kind !== "agent_runtime") {
    throw new Error(
      `Provider "${provider.displayName}" (${provider.id}) is of kind "${provider.kind}". ` +
        "Work runs require an agent_runtime provider."
    );
  }

  const config = buildAdapterConfig(provider);

  // A cached adapter is refreshed, never replaced. Drivers own long-lived
  // resources — Codex's `codex app-server`, Cursor's ACP server — and a second
  // instance would spawn a second process alongside the first, which still
  // holds the writer lock on every thread it opened.
  const cached = adapterCache.get(provider.id);
  if (cached) {
    cached.updateConfig?.(config);
    return cached;
  }

  let adapter: WorkRunAdapter;

  switch (provider.id) {
    case PROVIDER_IDS.copilot:
      adapter = createWorkRunAdapter(
        createCopilotDriver(config as CopilotAdapterConfig),
      );
      break;

    case PROVIDER_IDS.claude:
      adapter = createWorkRunAdapter(
        createClaudeDriver(config as ClaudeCodeAdapterConfig),
      );
      break;

    case PROVIDER_IDS.codex:
      adapter = createWorkRunAdapter(
        createCodexDriver(config as CodexAdapterConfig),
      );
      break;

    case PROVIDER_IDS.cursor:
      adapter = createWorkRunAdapter(
        createCursorDriver(config as CursorAdapterConfig),
      );
      break;

    default:
      throw new Error(
        `Provider "${provider.id}" is not supported for work runs. ` +
          `Supported providers: ${SUPPORTED_WORK_PROVIDERS.join(", ")}`
      );
  }

  // Cache the adapter
  adapterCache.set(provider.id, adapter);

  return adapter;
}

/**
 * Push a provider's latest config into its cached adapter, if one exists.
 * Called on every `providers.update` so a settings change reaches a live
 * driver immediately, without dropping the instance (and its processes).
 */
export function refreshWorkAdapterConfig(provider: ProviderResponse): void {
  const cached = adapterCache.get(provider.id);
  if (!cached?.updateConfig) return;
  if (!isProviderId(provider.id)) return;
  cached.updateConfig(buildAdapterConfig(provider));
}

/**
 * Get an existing adapter from cache without creating a new one
 */
export function getWorkAdapter(providerId: string): WorkRunAdapter | undefined {
  return adapterCache.get(providerId);
}

/**
 * Shutdown and remove an adapter from cache
 */
export async function shutdownWorkAdapter(providerId: string): Promise<void> {
  const adapter = adapterCache.get(providerId);
  if (adapter) {
    adapterCache.delete(providerId);
    if (adapter.shutdown) {
      await adapter.shutdown();
    }
  }
}

/**
 * Shutdown all cached adapters
 * Should be called on app quit
 */
export async function shutdownAllWorkAdapters(): Promise<void> {
  const shutdownPromises: Promise<void>[] = [];

  for (const [providerId, adapter] of adapterCache) {
    if (adapter.shutdown) {
      shutdownPromises.push(
        adapter.shutdown().catch((err) => {
          console.error(`[AdapterFactory] Error shutting down ${providerId}:`, err);
        })
      );
    }
  }

  await Promise.all(shutdownPromises);
  adapterCache.clear();
}

/**
 * Clear adapter cache (for testing or reinitialization)
 */
export function clearAdapterCache(): void {
  adapterCache.clear();
}

/**
 * List available models for a provider
 *
 * @param provider - The provider configuration from the database
 * @returns Promise resolving to array of ModelInfo
 * @throws Error if provider doesn't support model listing
 */
export async function listModelsForProvider(provider: ProviderResponse): Promise<ModelInfo[]> {
  const adapter = createWorkAdapter(provider);

  if (!adapter.listModels) {
    throw new Error(
      `Provider "${provider.displayName}" (${provider.id}) does not support listing models.`
    );
  }

  return adapter.listModels();
}

/**
 * List available commands for a provider
 *
 * @param provider - The provider configuration from the database
 * @returns Promise resolving to array of CommandInfo
 */
export async function listCommandsForProvider(
  provider: ProviderResponse,
  workspacePath?: string,
): Promise<CommandInfo[]> {
  const adapter = createWorkAdapter(provider);

  if (!adapter.listCommands) {
    // Return empty array if provider doesn't support commands
    return [];
  }

  return adapter.listCommands(workspacePath);
}

/**
 * List available skills for a provider
 * Skills are SKILL.md files plus installed provider plugins that can be invoked from the prompt.
 *
 * @param provider - The provider configuration from the database
 * @param workspacePath - Optional workspace path for discovering project skills
 * @returns Promise resolving to array of SkillInfo
 */
export async function listSkillsForProvider(
  provider: ProviderResponse,
  workspacePath?: string,
): Promise<SkillInfo[]> {
  const adapter = createWorkAdapter(provider);

  let skills: SkillInfo[] = [];
  if (!adapter.listSkills) {
    // Return installed plugins only if the provider doesn't support native skills.
    skills = [];
  } else {
    skills = await adapter.listSkills(workspacePath);
  }

  if (!adapter.listPlugins) {
    return skills;
  }

  const plugins = adapter.listInstalledPlugins
    ? await adapter.listInstalledPlugins()
    : await adapter.listPlugins();
  return mergeSkillsWithInstalledPlugins(skills, plugins);
}

/**
 * Get rate limit info for a provider
 */
export async function getAccountInfoForProvider(provider: ProviderResponse): Promise<AccountInfo> {
  const adapter = createWorkAdapter(provider);
  if (!adapter.getAccountInfo) {
    return { account: null, requiresOpenaiAuth: false };
  }
  return adapter.getAccountInfo();
}

/**
 * Update a provider's CLI to the latest version (e.g. `agent update`).
 */
export async function updateCliForProvider(
  provider: ProviderResponse,
): Promise<import("../../../../shared/adapter.types").CliUpdateResult> {
  const adapter = createWorkAdapter(provider);
  if (!adapter.updateCli) {
    return { success: false, output: `Provider "${provider.displayName}" does not support CLI updates.` };
  }
  return adapter.updateCli();
}

export async function listPluginsForProvider(provider: ProviderResponse): Promise<PluginListResponse> {
  const adapter = createWorkAdapter(provider);
  if (!adapter.listPlugins) {
    return { marketplaces: [], marketplaceLoadErrors: [], remoteSyncError: null, featuredPluginIds: [] };
  }
  return adapter.listPlugins();
}

export async function listInstalledPluginsForProvider(
  provider: ProviderResponse,
): Promise<PluginListResponse> {
  const adapter = createWorkAdapter(provider);
  const plugins = adapter.listInstalledPlugins
    ? await adapter.listInstalledPlugins()
    : adapter.listPlugins
      ? await adapter.listPlugins()
      : { marketplaces: [], marketplaceLoadErrors: [], remoteSyncError: null, featuredPluginIds: [] };

  return {
    ...plugins,
    featuredPluginIds: [],
    marketplaces: plugins.marketplaces
      .map((marketplace) => ({
        ...marketplace,
        plugins: marketplace.plugins.filter((plugin) => plugin.installed),
      }))
      .filter((marketplace) => marketplace.plugins.length > 0),
  };
}

export async function readPluginForProvider(provider: ProviderResponse, pluginName: string, marketplacePath: string): Promise<PluginDetail> {
  const adapter = createWorkAdapter(provider);
  if (!adapter.readPlugin) {
    throw new Error(`Provider "${provider.displayName}" does not support reading plugin details.`);
  }
  return adapter.readPlugin(pluginName, marketplacePath);
}

export async function installPluginForProvider(provider: ProviderResponse, pluginId: string, scope?: PluginScope): Promise<void> {
  const adapter = createWorkAdapter(provider);
  if (!adapter.installPlugin) {
    throw new Error(`Provider "${provider.displayName}" does not support plugin installation.`);
  }
  return adapter.installPlugin(pluginId, scope);
}

export async function uninstallPluginForProvider(provider: ProviderResponse, pluginId: string): Promise<void> {
  const adapter = createWorkAdapter(provider);
  if (!adapter.uninstallPlugin) {
    throw new Error(`Provider "${provider.displayName}" does not support plugin uninstallation.`);
  }
  return adapter.uninstallPlugin(pluginId);
}

export async function setPluginEnabledForProvider(provider: ProviderResponse, pluginId: string, enabled: boolean): Promise<void> {
  const adapter = createWorkAdapter(provider);
  if (!adapter.setPluginEnabled) {
    throw new Error(`Provider "${provider.displayName}" does not support enabling/disabling plugins.`);
  }
  return adapter.setPluginEnabled(pluginId, enabled);
}

export async function updatePluginForProvider(provider: ProviderResponse, pluginId: string): Promise<void> {
  const adapter = createWorkAdapter(provider);
  if (!adapter.updatePlugin) {
    throw new Error(`Provider "${provider.displayName}" does not support updating plugins.`);
  }
  return adapter.updatePlugin(pluginId);
}

export async function getRateLimitsForProvider(
  provider: ProviderResponse,
): Promise<import("../../../../shared/adapter.types").RateLimitInfo | null> {
  const adapter = createWorkAdapter(provider);
  if (!adapter.getRateLimits) return null;
  return adapter.getRateLimits();
}

type GoalInfo = import("../../../../shared/adapter.types").GoalInfo;
type GoalSetParams = import("../../../../shared/adapter.types").GoalSetParams;

export async function setGoalForProvider(
  provider: ProviderResponse,
  runId: string,
  params: GoalSetParams,
): Promise<GoalInfo | null> {
  const adapter = createWorkAdapter(provider);
  if (!adapter.setGoal) return null;
  return adapter.setGoal(runId, params);
}

export async function getGoalForProvider(
  provider: ProviderResponse,
  runId: string,
): Promise<GoalInfo | null> {
  const adapter = createWorkAdapter(provider);
  if (!adapter.getGoal) return null;
  return adapter.getGoal(runId);
}

export async function clearGoalForProvider(
  provider: ProviderResponse,
  runId: string,
): Promise<boolean> {
  const adapter = createWorkAdapter(provider);
  if (!adapter.clearGoal) return false;
  return adapter.clearGoal(runId);
}
