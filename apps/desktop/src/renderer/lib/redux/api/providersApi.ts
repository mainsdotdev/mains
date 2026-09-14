import { baseApi } from "./baseApi";
import { CHANNELS } from "../../../../shared/ipc-kit/channels";
import type {
  PluginAvailability,
  PluginDisabledReason,
} from "../../../../shared/plugin-install-availability";

export interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins?: number;
  resetsAt?: number;
  /** Optional human label for the window (e.g. Copilot quota type). */
  label?: string;
  /** Optional raw counts (e.g. Copilot requests used / entitlement). */
  used?: number;
  total?: number;
}

export interface SpendControlLimitInfo {
  limit: string;
  used: string;
  remainingPercent: number;
  resetsAt: number;
}

export interface RateLimitSnapshotInfo {
  limitId?: string;
  limitName?: string;
  planType?: string;
  primary?: RateLimitWindow;
  secondary?: RateLimitWindow;
  credits?: { hasCredits: boolean; balance?: string; unlimited: boolean };
  individualLimit?: SpendControlLimitInfo;
  spendControlReached?: boolean;
  rateLimitReachedType?: string;
}

export interface RateLimitInfo extends RateLimitSnapshotInfo {
  rateLimitsByLimitId?: Record<string, RateLimitSnapshotInfo>;
  rateLimitResetCredits?: {
    availableCount: number;
    credits?: Array<{
      id: string;
      resetType: string;
      status: string;
      grantedAt: number;
      expiresAt?: number;
      title?: string;
      description?: string;
    }>;
  };
}

/** A Codex thread goal (mirrors `GoalInfo` in shared/adapter.types). */
export interface GoalInfo {
  threadId: string;
  objective: string;
  status: string;
  tokenBudget?: number;
  tokensUsed?: number;
  timeUsedSeconds?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface GoalSetParams {
  objective?: string;
  status?: string;
  tokenBudget?: number;
}

export type ProviderKind = "llm_runtime" | "agent_runtime";

export interface ProviderConfig {
  baseUrl?: string;
  apiKey?: string;
  timeout?: number;
  maxRetries?: number;
  [key: string]: unknown;
}

export interface ProviderCapabilities {
  streaming?: boolean;
  functionCalling?: boolean;
  vision?: boolean;
  embeddings?: boolean;
  [key: string]: unknown;
}

export interface Provider {
  id: string;
  kind: ProviderKind;
  displayName: string;
  isEnabled: boolean;
  config: ProviderConfig | null;
  capabilities: ProviderCapabilities | null;
  defaultModel: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateProviderPayload {
  id: string;
  kind: ProviderKind;
  displayName: string;
  isEnabled?: boolean;
  config?: ProviderConfig;
  capabilities?: ProviderCapabilities;
  defaultModel?: string;
}

export interface UpdateProviderPayload {
  displayName?: string;
  isEnabled?: boolean;
  config?: ProviderConfig;
  capabilities?: ProviderCapabilities;
  defaultModel?: string;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  version?: string;
  isDefault?: boolean;
  capabilities?: {
    streaming?: boolean;
    vision?: boolean;
    functionCalling?: boolean;
    reasoning?: boolean;
  };
  contextWindow?: number;
  supportsFastMode?: boolean;
  supportsEffort?: boolean;
  supportedEffortLevels?: (
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'max'
    | 'xhigh'
  )[];
  /**
   * Provider-specific service tiers (e.g. Codex: priority/flex/default).
   * Mirrors the field on the main-process `ModelInfo`; populated from
   * `model/list` responses so the settings UI can offer a tier picker.
   */
  serviceTiers?: Array<{ id: string; name: string; description?: string }>;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface CommandInfo {
  name: string;
  description?: string;
  argumentHint?: string;
  userFacing?: boolean;
}

export interface SkillInfo {
  name: string;
  description?: string;
  argumentHint?: string;
  userInvokable?: boolean;
  modelInvocable?: boolean;
  source?: "user" | "project";
  model?: string;
  forked?: boolean;
  agent?: string;
  path?: string;
  displayName?: string;
  shortDescription?: string;
  iconSmall?: string;
  iconLarge?: string;
  brandColor?: string;
  defaultPrompt?: string;
  scope?: "user" | "project" | "system" | string;
  enabled?: boolean;
}

export interface PluginInterfaceInfo {
  displayName?: string;
  shortDescription?: string;
  longDescription?: string;
  developerName?: string;
  category?: string;
  capabilities: string[];
  websiteUrl?: string;
  defaultPrompt?: string[];
  brandColor?: string;
  composerIcon?: string;
  logo?: string;
  screenshots: string[];
  privacyPolicyUrl?: string;
  termsOfServiceUrl?: string;
}

export interface PluginInfo {
  id: string;
  name: string;
  source: { type: string; path: string };
  installed: boolean;
  enabled: boolean;
  installPolicy: "NOT_AVAILABLE" | "AVAILABLE" | "INSTALLED_BY_DEFAULT";
  availability?: PluginAvailability;
  disabledReason?: PluginDisabledReason | null;
  eligiblePlanTypes?: string[] | null;
  installedAt?: number | null;
  authPolicy: "ON_INSTALL" | "ON_USE";
  interface: PluginInterfaceInfo | null;
  /** Marketplace install count (popularity), when known. */
  installs?: number;
  /** True when an installed plugin has a newer version available. */
  updateAvailable?: boolean;
}

/** Plugin install scope (maps to the CLI `--scope` flag). */
export type PluginScope = "user" | "project" | "local";

export interface MarketplaceInfo {
  name: string;
  path: string;
  interface: { displayName?: string } | null;
  plugins: PluginInfo[];
}

export interface PluginListResponse {
  marketplaces: MarketplaceInfo[];
  marketplaceLoadErrors: Array<{ marketplacePath: string; message: string }>;
  remoteSyncError: string | null;
  featuredPluginIds: string[];
}

export interface PluginSkillSummary {
  name: string;
  displayName?: string;
  path?: string;
  description?: string;
  shortDescription?: string;
  enabled: boolean;
}

export interface PluginAppSummary {
  id: string;
  name: string;
  needsAuth: boolean;
  description?: string;
  installUrl?: string;
  isAccessible?: boolean;
  isEnabled?: boolean;
  /** Grouping label from the marketplace, e.g. "Team communication". */
  category?: string;
  /** Remote logo URL resolved from the codex connector directory cache. */
  iconUrl?: string;
}

export interface PluginDetailResponse {
  marketplaceName: string;
  marketplacePath: string;
  summary: PluginInfo;
  description: string | null;
  skills: PluginSkillSummary[];
  apps: PluginAppSummary[];
  mcpServers: string[];
  /** Marketplace-reported install count — only known for catalog-indexed plugins. */
  uniqueInstalls?: number | null;
  /** ISO timestamp of the plugin's last marketplace update, if known. */
  lastUpdated?: string | null;
}

export interface AccountInfo {
  account: {
    type: "apiKey";
  } | {
    type: "chatgpt";
    email: string | null;
    planType: string;
  } | {
    type: "amazonBedrock";
    usesCodexManagedCredentials: boolean;
  } | {
    type: "cursor";
    email: string;
    planType: string;
  } | {
    type: "claude";
    email: string;
    planType: string;
  } | null;
  requiresOpenaiAuth: boolean;
  cli?: {
    version: string | null;
    channel: string | null;
    outdated: boolean;
    compatibility?: "supported" | "newer" | "unsupported" | "unknown";
    minimumVersion?: string;
    testedProtocolVersion?: string;
  };
}

export interface CliUpdateResult {
  success: boolean;
  output: string;
}

export interface DetectedClis {
  claude: boolean;
  copilot: boolean;
  codex: boolean;
  cursor: boolean;
}

export const providersApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getProviders: builder.query<Provider[], void>({
      query: () => ({
        handler: CHANNELS.providers.getAll,
      }),
      providesTags: ["Providers"],
    }),

    getProviderById: builder.query<Provider, string>({
      query: (id) => ({
        handler: CHANNELS.providers.getById,
        args: [id],
      }),
      providesTags: (_result, _error, id) => [{ type: "Providers", id }],
    }),

    getProvidersByKind: builder.query<Provider[], ProviderKind>({
      query: (kind) => ({
        handler: CHANNELS.providers.getByKind,
        args: [kind],
      }),
      providesTags: ["Providers"],
    }),

    getEnabledProviders: builder.query<Provider[], void>({
      query: () => ({
        handler: CHANNELS.providers.getEnabled,
      }),
      providesTags: ["Providers"],
    }),

    createProvider: builder.mutation<string, CreateProviderPayload>({
      query: (payload) => ({
        handler: CHANNELS.providers.create,
        args: [payload],
      }),
      invalidatesTags: ["Providers"],
    }),

    updateProvider: builder.mutation<
      Provider,
      { id: string; payload: UpdateProviderPayload }
    >({
      query: ({ id, payload }) => ({
        handler: CHANNELS.providers.update,
        args: [id, payload],
      }),
      invalidatesTags: (_result, _error, { id }) => [
        "Providers",
        { type: "Providers", id },
      ],
    }),

    deleteProvider: builder.mutation<void, string>({
      query: (id) => ({
        handler: CHANNELS.providers.delete,
        args: [id],
      }),
      invalidatesTags: ["Providers"],
    }),

    enableProvider: builder.mutation<void, string>({
      query: (id) => ({
        handler: CHANNELS.providers.enable,
        args: [id],
      }),
      invalidatesTags: (_result, _error, id) => [
        "Providers",
        { type: "Providers", id },
      ],
    }),

    disableProvider: builder.mutation<void, string>({
      query: (id) => ({
        handler: CHANNELS.providers.disable,
        args: [id],
      }),
      invalidatesTags: (_result, _error, id) => [
        "Providers",
        { type: "Providers", id },
      ],
    }),

    getProviderModels: builder.query<ModelInfo[], string>({
      query: (id) => ({
        handler: CHANNELS.providers.getModels,
        args: [id],
      }),
      providesTags: (_result, _error, id) => [{ type: "ProviderModels", id }],
    }),

    getProviderCommands: builder.query<
      CommandInfo[],
      { id: string; workspacePath?: string }
    >({
      query: ({ id, workspacePath }) => ({
        handler: CHANNELS.providers.getCommands,
        args: [id, workspacePath],
      }),
      providesTags: (_result, _error, { id, workspacePath }) => [
        { type: "ProviderCommands", id: `${id}:${workspacePath ?? ""}` },
      ],
    }),

    getProviderSkills: builder.query<
      SkillInfo[],
      { id: string; workspacePath?: string }
    >({
      query: ({ id, workspacePath }) => ({
        handler: CHANNELS.providers.getSkills,
        args: [id, workspacePath],
      }),
      providesTags: (_result, _error, { id, workspacePath }) => [
        { type: "ProviderSkills", id: `${id}:${workspacePath ?? ""}` },
      ],
    }),

    getProviderAccountInfo: builder.query<AccountInfo, string>({
      query: (id) => ({
        handler: CHANNELS.providers.getAccountInfo,
        args: [id],
      }),
      providesTags: (_result, _error, id) => [{ type: "ProviderAccountInfo", id }],
      // Answering this spawns the provider CLI (version + auth status). The
      // composer subscribes to it as a signed-out preflight, so keep results
      // around well past the 60s default to avoid a CLI spawn per remount.
      keepUnusedDataFor: 300,
    }),

    updateProviderCli: builder.mutation<CliUpdateResult, string>({
      query: (id) => ({
        handler: CHANNELS.providers.updateCli,
        args: [id],
      }),
      // After updating, the version/account info may change — refetch it.
      invalidatesTags: (_result, _error, id) => [{ type: "ProviderAccountInfo", id }],
    }),

    getProviderPlugins: builder.query<PluginListResponse, string>({
      query: (id) => ({
        handler: CHANNELS.providers.getPlugins,
        args: [id],
      }),
      providesTags: (_result, _error, id) => [{ type: "ProviderPlugins", id }],
      keepUnusedDataFor: 900,
    }),

    getProviderInstalledPlugins: builder.query<PluginListResponse, string>({
      query: (id) => ({
        handler: CHANNELS.providers.getInstalledPlugins,
        args: [id],
      }),
      providesTags: (_result, _error, id) => [
        { type: "ProviderInstalledPlugins", id },
      ],
      keepUnusedDataFor: 300,
    }),

    readProviderPlugin: builder.query<
      PluginDetailResponse,
      { providerId: string; pluginName: string; marketplacePath: string }
    >({
      query: ({ providerId, pluginName, marketplacePath }) => ({
        handler: CHANNELS.providers.readPlugin,
        args: [providerId, pluginName, marketplacePath],
      }),
    }),

    installProviderPlugin: builder.mutation<
      void,
      { providerId: string; pluginId: string; scope?: PluginScope }
    >({
      query: ({ providerId, pluginId, scope }) => ({
        handler: CHANNELS.providers.installPlugin,
        args: [providerId, pluginId, scope],
      }),
      invalidatesTags: (_r, _e, { providerId }) => [
        { type: "ProviderPlugins", id: providerId },
        { type: "ProviderInstalledPlugins", id: providerId },
        "ProviderSkills",
      ],
    }),

    uninstallProviderPlugin: builder.mutation<void, { providerId: string; pluginId: string }>({
      query: ({ providerId, pluginId }) => ({
        handler: CHANNELS.providers.uninstallPlugin,
        args: [providerId, pluginId],
      }),
      invalidatesTags: (_r, _e, { providerId }) => [
        { type: "ProviderPlugins", id: providerId },
        { type: "ProviderInstalledPlugins", id: providerId },
        "ProviderSkills",
      ],
    }),

    setProviderPluginEnabled: builder.mutation<
      void,
      { providerId: string; pluginId: string; enabled: boolean }
    >({
      query: ({ providerId, pluginId, enabled }) => ({
        handler: CHANNELS.providers.setPluginEnabled,
        args: [providerId, pluginId, enabled],
      }),
      invalidatesTags: (_r, _e, { providerId }) => [
        { type: "ProviderPlugins", id: providerId },
        { type: "ProviderInstalledPlugins", id: providerId },
        "ProviderSkills",
      ],
    }),

    updateProviderPlugin: builder.mutation<void, { providerId: string; pluginId: string }>({
      query: ({ providerId, pluginId }) => ({
        handler: CHANNELS.providers.updatePlugin,
        args: [providerId, pluginId],
      }),
      invalidatesTags: (_r, _e, { providerId }) => [
        { type: "ProviderPlugins", id: providerId },
        { type: "ProviderInstalledPlugins", id: providerId },
        "ProviderSkills",
      ],
    }),

    getProviderRateLimits: builder.query<RateLimitInfo | null, string>({
      query: (id) => ({
        handler: CHANNELS.providers.getRateLimits,
        args: [id],
      }),
    }),

    getProviderGoal: builder.query<GoalInfo | null, { providerId: string; runId: string }>({
      query: ({ providerId, runId }) => ({
        handler: CHANNELS.providers.getGoal,
        args: [providerId, runId],
      }),
    }),

    setProviderGoal: builder.mutation<
      GoalInfo | null,
      { providerId: string; runId: string; params: GoalSetParams }
    >({
      query: ({ providerId, runId, params }) => ({
        handler: CHANNELS.providers.setGoal,
        args: [providerId, runId, params],
      }),
    }),

    clearProviderGoal: builder.mutation<boolean, { providerId: string; runId: string }>({
      query: ({ providerId, runId }) => ({
        handler: CHANNELS.providers.clearGoal,
        args: [providerId, runId],
      }),
    }),

    detectInstalledClis: builder.query<DetectedClis, void>({
      query: () => ({
        handler: CHANNELS.providers.detectInstalled,
      }),
    }),
  }),
});

export const {
  useGetProvidersQuery,
  useLazyGetProvidersQuery,
  useGetProviderByIdQuery,
  useLazyGetProviderByIdQuery,
  useGetProvidersByKindQuery,
  useLazyGetProvidersByKindQuery,
  useGetEnabledProvidersQuery,
  useLazyGetEnabledProvidersQuery,
  useCreateProviderMutation,
  useUpdateProviderMutation,
  useDeleteProviderMutation,
  useEnableProviderMutation,
  useDisableProviderMutation,
  useGetProviderModelsQuery,
  useLazyGetProviderModelsQuery,
  useGetProviderCommandsQuery,
  useLazyGetProviderCommandsQuery,
  useGetProviderSkillsQuery,
  useLazyGetProviderSkillsQuery,
  useGetProviderAccountInfoQuery,
  useUpdateProviderCliMutation,
  useGetProviderPluginsQuery,
  useGetProviderInstalledPluginsQuery,
  useReadProviderPluginQuery,
  useInstallProviderPluginMutation,
  useUninstallProviderPluginMutation,
  useSetProviderPluginEnabledMutation,
  useUpdateProviderPluginMutation,
  useGetProviderRateLimitsQuery,
  useGetProviderGoalQuery,
  useLazyGetProviderGoalQuery,
  useSetProviderGoalMutation,
  useClearProviderGoalMutation,
  useDetectInstalledClisQuery,
} = providersApi;
