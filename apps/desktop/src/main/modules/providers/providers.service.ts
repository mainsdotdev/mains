import { providersRepo } from "./providers.repo";
import { detectInstalledClis } from "./providers.utils";
import type {
  CreateProviderPayload,
  UpdateProviderPayload,
  UpdateRunSettingsPayload,
  ProviderResponse,
  DetectedClisResponse,
} from "./providers.dto";
import { isEffortLevel } from "../../../shared/effort-levels";
import { PROVIDER_IDS } from "../../../shared/provider-ids";
import {
  permissionConfigKeyFor,
  permissionModeIdsFor,
  RUN_SETTING_CONFIG_KEYS,
} from "../../../shared/run-settings";
import {
  listModelsForProvider,
  listCommandsForProvider,
  listSkillsForProvider,
  getAccountInfoForProvider,
  updateCliForProvider,
  listPluginsForProvider,
  listInstalledPluginsForProvider,
  readPluginForProvider,
  installPluginForProvider,
  uninstallPluginForProvider,
  setPluginEnabledForProvider,
  updatePluginForProvider,
  getRateLimitsForProvider,
  setGoalForProvider,
  getGoalForProvider,
  clearGoalForProvider,
  refreshWorkAdapterConfig,
  type ModelInfo,
  type CommandInfo,
  type SkillInfo,
  type PluginListResponse,
  type PluginDetail,
  type AccountInfo,
  type CliUpdateResult,
} from "./adapters";
import type { PluginScope } from "../../../shared/adapter.types";
import type {
  RateLimitInfo,
  GoalInfo,
  GoalSetParams,
} from "../../../shared/adapter.types";

/** Resolve a provider and require it to be enabled — the shared preamble of
 * every adapter-backed operation. */
async function requireEnabledProvider(id: string): Promise<ProviderResponse> {
  const provider = await providersRepo.findById(id);
  if (!provider) throw new Error("Provider not found");
  if (!provider.isEnabled) throw new Error("Provider is not enabled");
  return provider;
}

// ─────────────────────────────────────────────────────────────
// Providers Service
//
// Throw-style: methods return plain values and throw on failure; the
// ServiceResponse envelope is applied by handle() at the IPC seam.
// Single-item reads return null for absence (see CONTEXT.md
// "absence rule").
// ─────────────────────────────────────────────────────────────
export const providersService = {
  async getAll(): Promise<ProviderResponse[]> {
    return providersRepo.findAll();
  },

  async getById(id: string): Promise<ProviderResponse | null> {
    return providersRepo.findById(id);
  },

  async getByKind(
    kind: "llm_runtime" | "agent_runtime",
  ): Promise<ProviderResponse[]> {
    return providersRepo.findByKind(kind);
  },

  async getEnabled(): Promise<ProviderResponse[]> {
    return providersRepo.findEnabled();
  },

  async create(payload: CreateProviderPayload): Promise<string> {
    const existing = await providersRepo.findById(payload.id);
    if (existing) {
      throw new Error("Provider with this ID already exists");
    }

    return providersRepo.insert(payload);
  },

  async update(
    id: string,
    payload: UpdateProviderPayload,
  ): Promise<ProviderResponse> {
    const updated = await providersRepo.update(id, payload);
    if (!updated) {
      throw new Error("Provider not found");
    }

    // Push the new config into the live adapter. Dropping it from the cache
    // instead would strand the driver's long-lived processes: the replacement
    // Codex app-server can't resume a thread the orphan still has open
    // ("already has an active writer").
    refreshWorkAdapterConfig(updated);

    return updated;
  },

  /**
   * Edit the settings the composer's toolbar changes — effort, permission /
   * sandbox mode, fast mode, Codex's goal and plan modes — as one narrow,
   * patch-shaped write. The desktop toolbar still goes through `update` with
   * the whole config; this exists for paired devices, which must neither
   * round-trip credentials nor reach the rest of the config. Mirrors the
   * renderer's `use-provider-models.ts` handlers: Codex and Copilot store
   * effort as `modelReasoningEffort` and infer thinking from it, Claude and
   * Cursor keep `thinkingMode` + `effortLevel` (an explicit level turns
   * ultracode off); fast mode is Codex's "fast" service tier and a boolean
   * elsewhere; goal and plan are Codex-only and mutually exclusive.
   */
  async updateRunSettings(
    id: string,
    patch: UpdateRunSettingsPayload,
  ): Promise<ProviderResponse> {
    const provider = await providersRepo.findById(id);
    if (!provider) throw new Error("Provider not found");
    const config: Record<string, unknown> = { ...(provider.config ?? {}) };

    if (patch.effortLevel !== undefined) {
      const level = String(patch.effortLevel).trim().toLowerCase();
      if (level && !isEffortLevel(level)) {
        throw new Error(`Unknown effort level "${patch.effortLevel}"`);
      }
      if (id === PROVIDER_IDS.codex || id === PROVIDER_IDS.copilot) {
        if (level) config.modelReasoningEffort = level;
        else delete config.modelReasoningEffort;
        config.thinkingMode = !!level;
      } else {
        if (level) config.effortLevel = level;
        else delete config.effortLevel;
        config.thinkingMode = !!level;
        config.ultracode = false;
      }
    }

    if (patch.permissionMode !== undefined) {
      const mode = String(patch.permissionMode);
      const key = permissionConfigKeyFor(id);
      if (!key || !permissionModeIdsFor(id).includes(mode)) {
        throw new Error(`Unknown permission mode "${mode}" for ${id}`);
      }
      config[key] = mode;
    }

    if (patch.fastMode !== undefined) {
      const on = patch.fastMode === true;
      if (id === PROVIDER_IDS.codex) {
        if (on) config.serviceTier = "fast";
        else delete config.serviceTier;
      } else {
        config.fastMode = on;
      }
    }

    if (patch.goalMode !== undefined) {
      if (id !== PROVIDER_IDS.codex) throw new Error("Goal mode is a Codex setting");
      config.goalMode = patch.goalMode === true;
      if (config.goalMode) config.planMode = false;
    }

    if (patch.planMode !== undefined) {
      if (id !== PROVIDER_IDS.codex) {
        throw new Error('Plan mode is a Codex toggle; elsewhere it is the "plan" permission mode');
      }
      config.planMode = patch.planMode === true;
      if (config.planMode) config.goalMode = false;
    }

    return providersService.update(id, { config });
  },

  async delete(id: string): Promise<void> {
    await providersRepo.delete(id);
  },

  async enable(id: string): Promise<void> {
    await providersRepo.setEnabled(id, true);
  },

  async disable(id: string): Promise<void> {
    await providersRepo.setEnabled(id, false);
  },

  async getModels(id: string): Promise<ModelInfo[]> {
    const provider = await requireEnabledProvider(id);
    return listModelsForProvider(provider);
  },

  async getCommands(
    id: string,
    workspacePath?: string,
  ): Promise<CommandInfo[]> {
    const provider = await requireEnabledProvider(id);
    return listCommandsForProvider(provider, workspacePath);
  },

  async getSkills(id: string, workspacePath?: string): Promise<SkillInfo[]> {
    const provider = await requireEnabledProvider(id);
    return listSkillsForProvider(provider, workspacePath);
  },

  async getRateLimits(id: string): Promise<RateLimitInfo | null> {
    const provider = await requireEnabledProvider(id);
    return getRateLimitsForProvider(provider);
  },

  async setGoal(
    id: string,
    runId: string,
    params: GoalSetParams,
  ): Promise<GoalInfo | null> {
    const provider = await requireEnabledProvider(id);
    return setGoalForProvider(provider, runId, params);
  },

  async getGoal(id: string, runId: string): Promise<GoalInfo | null> {
    const provider = await requireEnabledProvider(id);
    return getGoalForProvider(provider, runId);
  },

  async clearGoal(id: string, runId: string): Promise<boolean> {
    const provider = await requireEnabledProvider(id);
    return clearGoalForProvider(provider, runId);
  },

  async getAccountInfo(id: string): Promise<AccountInfo> {
    const provider = await requireEnabledProvider(id);
    return getAccountInfoForProvider(provider);
  },

  async updateCli(id: string): Promise<CliUpdateResult> {
    const provider = await requireEnabledProvider(id);
    return updateCliForProvider(provider);
  },

  async getPlugins(id: string): Promise<PluginListResponse> {
    const provider = await requireEnabledProvider(id);
    return listPluginsForProvider(provider);
  },

  async getInstalledPlugins(id: string): Promise<PluginListResponse> {
    const provider = await requireEnabledProvider(id);
    return listInstalledPluginsForProvider(provider);
  },

  async readPlugin(
    id: string,
    pluginName: string,
    marketplacePath: string,
  ): Promise<PluginDetail> {
    const provider = await requireEnabledProvider(id);
    return readPluginForProvider(provider, pluginName, marketplacePath);
  },

  async installPlugin(
    id: string,
    pluginId: string,
    scope?: PluginScope,
  ): Promise<void> {
    const provider = await requireEnabledProvider(id);
    await installPluginForProvider(provider, pluginId, scope);
  },

  async uninstallPlugin(id: string, pluginId: string): Promise<void> {
    const provider = await requireEnabledProvider(id);
    await uninstallPluginForProvider(provider, pluginId);
  },

  async setPluginEnabled(
    id: string,
    pluginId: string,
    enabled: boolean,
  ): Promise<void> {
    const provider = await requireEnabledProvider(id);
    await setPluginEnabledForProvider(provider, pluginId, enabled);
  },

  async updatePlugin(id: string, pluginId: string): Promise<void> {
    const provider = await requireEnabledProvider(id);
    await updatePluginForProvider(provider, pluginId);
  },

  async detectInstalled(): Promise<DetectedClisResponse> {
    return detectInstalledClis();
  },
};

/**
 * The provider row a paired device may see. `config` is the Mac's settings
 * blob, credentials included — a device gets only the run-settings keys the
 * composer reads (`RUN_SETTING_CONFIG_KEYS`); everything else, apiKey and
 * baseUrl first of all, never leaves the machine.
 */
export function providerForPairedDevice(provider: ProviderResponse): ProviderResponse {
  if (!provider.config) return provider;
  const config: Record<string, unknown> = {};
  for (const key of RUN_SETTING_CONFIG_KEYS) {
    if (key in provider.config) config[key] = provider.config[key];
  }
  return { ...provider, config };
}
