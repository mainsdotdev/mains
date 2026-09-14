import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AccountInfo,
  ModelInfo,
  PluginDetail,
  PluginInfo,
  PluginListResponse,
  PluginScope,
  RateLimitInfo,
  SkillInfo,
} from "../../../../shared/adapter.types";
import { getPluginInstallBlockReason } from "../../../../shared/plugin-install-availability";
import {
  createLogger,
  type AdapterLogger,
} from "./adapter.shared";
import type { CodexAppServer } from "./codex-app-server.client";

interface CodexCapabilitiesOptions {
  /**
   * Getter, not a value: the driver refreshes its config object in place when
   * provider settings change, so a snapshot taken here would go stale.
   */
  getDefaultModel?: () => string | undefined;
  ensureServer: (cwd?: string) => Promise<CodexAppServer>;
  getRunningServer: () => CodexAppServer | null;
  getCliHealth: () => Promise<NonNullable<AccountInfo["cli"]>>;
  logger?: AdapterLogger;
}

interface AppDirectoryEntry {
  name?: string;
  description?: string;
  logoUrl?: string;
  installUrl?: string;
  isAccessible?: boolean;
  isEnabled?: boolean;
}

interface RemotePluginReference {
  remotePluginId: string;
  marketplaceName: string;
}

const PLUGIN_CATALOG_TTL_MS = 15 * 60 * 1000;
const INSTALLED_PLUGINS_TTL_MS = 5 * 60 * 1000;

let appDirectoryMemo: {
  mtimeMs: number;
  map: Map<string, AppDirectoryEntry>;
} | null = null;

/** Map one Codex rate-limit snapshot into Mains' provider shape. */
export function mapRateLimitSnapshot(
  rateLimit: Record<string, unknown> | undefined,
): RateLimitInfo | null {
  if (!rateLimit) return null;
  const primary = rateLimit.primary as Record<string, unknown> | undefined;
  const secondary = rateLimit.secondary as
    | Record<string, unknown>
    | undefined;
  const credits = rateLimit.credits as Record<string, unknown> | undefined;
  const individualLimit = rateLimit.individualLimit as
    | Record<string, unknown>
    | undefined;

  return {
    ...(typeof rateLimit.limitId === "string"
      ? { limitId: rateLimit.limitId }
      : {}),
    ...(typeof rateLimit.limitName === "string"
      ? { limitName: rateLimit.limitName }
      : {}),
    planType:
      typeof rateLimit.planType === "string"
        ? rateLimit.planType
        : undefined,
    primary: primary
      ? {
          usedPercent: primary.usedPercent as number,
          windowDurationMins:
            typeof primary.windowDurationMins === "number"
              ? primary.windowDurationMins
              : undefined,
          resetsAt:
            typeof primary.resetsAt === "number"
              ? primary.resetsAt
              : undefined,
        }
      : undefined,
    secondary: secondary
      ? {
          usedPercent: secondary.usedPercent as number,
          windowDurationMins:
            typeof secondary.windowDurationMins === "number"
              ? secondary.windowDurationMins
              : undefined,
          resetsAt:
            typeof secondary.resetsAt === "number"
              ? secondary.resetsAt
              : undefined,
        }
      : undefined,
    credits: credits
      ? {
          hasCredits: credits.hasCredits as boolean,
          balance:
            typeof credits.balance === "string"
              ? credits.balance
              : undefined,
          unlimited: credits.unlimited as boolean,
        }
      : undefined,
    ...(individualLimit
      ? {
          individualLimit: {
            limit: individualLimit.limit as string,
            used: individualLimit.used as string,
            remainingPercent: individualLimit.remainingPercent as number,
            resetsAt: individualLimit.resetsAt as number,
          },
        }
      : {}),
    ...(typeof rateLimit.spendControlReached === "boolean"
      ? { spendControlReached: rateLimit.spendControlReached }
      : {}),
    ...(typeof rateLimit.rateLimitReachedType === "string"
      ? { rateLimitReachedType: rateLimit.rateLimitReachedType }
      : {}),
  };
}

/** Map the complete account/rateLimits/read response, including new buckets. */
export function mapRateLimitResponse(
  response: Record<string, unknown> | undefined,
): RateLimitInfo | null {
  if (!response) return null;
  const rateLimits = mapRateLimitSnapshot(
    response.rateLimits as Record<string, unknown> | undefined,
  );
  if (!rateLimits) return null;

  const rawBuckets = response.rateLimitsByLimitId as
    | Record<string, unknown>
    | null
    | undefined;
  const rateLimitsByLimitId: NonNullable<
    RateLimitInfo["rateLimitsByLimitId"]
  > = {};
  for (const [limitId, rawSnapshot] of Object.entries(rawBuckets ?? {})) {
    const snapshot = mapRateLimitSnapshot(
      rawSnapshot as Record<string, unknown> | undefined,
    );
    if (snapshot) rateLimitsByLimitId[limitId] = snapshot;
  }

  const rawResetCredits = response.rateLimitResetCredits as
    | Record<string, unknown>
    | null
    | undefined;
  const rawCredits = rawResetCredits?.credits;
  const resetCredits = Array.isArray(rawCredits)
    ? rawCredits.map((rawCredit) => {
        const credit = rawCredit as Record<string, unknown>;
        return {
          id: credit.id as string,
          resetType: credit.resetType as string,
          status: credit.status as string,
          grantedAt: credit.grantedAt as number,
          ...(typeof credit.expiresAt === "number"
            ? { expiresAt: credit.expiresAt }
            : {}),
          ...(typeof credit.title === "string"
            ? { title: credit.title }
            : {}),
          ...(typeof credit.description === "string"
            ? { description: credit.description }
            : {}),
        };
      })
    : undefined;

  return {
    ...rateLimits,
    ...(Object.keys(rateLimitsByLimitId).length > 0
      ? { rateLimitsByLimitId }
      : {}),
    ...(rawResetCredits
      ? {
          rateLimitResetCredits: {
            availableCount: Number(rawResetCredits.availableCount ?? 0),
            ...(resetCredits ? { credits: resetCredits } : {}),
          },
        }
      : {}),
  };
}

function fileToDataUrl(
  filePath: string | undefined | null,
): string | undefined {
  if (!filePath) return undefined;
  try {
    const data = fs.readFileSync(filePath);
    const extension = path.extname(filePath).toLowerCase().slice(1);
    const mime =
      extension === "svg"
        ? "image/svg+xml"
        : extension === "png"
          ? "image/png"
          : extension === "jpg" || extension === "jpeg"
            ? "image/jpeg"
            : extension === "gif"
              ? "image/gif"
              : extension === "webp"
                ? "image/webp"
                : "application/octet-stream";
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch {
    return undefined;
  }
}

function loadAppDirectory(): Map<string, AppDirectoryEntry> {
  try {
    const directory = path.join(
      os.homedir(),
      ".codex",
      "cache",
      "codex_app_directory",
    );
    let newestPath: string | null = null;
    let newestMtime = 0;
    for (const fileName of fs.readdirSync(directory)) {
      if (!fileName.endsWith(".json")) continue;
      const filePath = path.join(directory, fileName);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs > newestMtime) {
        newestMtime = stat.mtimeMs;
        newestPath = filePath;
      }
    }
    if (!newestPath) return new Map();
    if (appDirectoryMemo?.mtimeMs === newestMtime) {
      return appDirectoryMemo.map;
    }

    const data = JSON.parse(fs.readFileSync(newestPath, "utf8")) as {
      connectors?: Array<Record<string, unknown>>;
    };
    const map = new Map<string, AppDirectoryEntry>();
    for (const connector of data.connectors ?? []) {
      const id = connector.id as string | undefined;
      if (!id) continue;
      map.set(id, {
        name: (connector.name as string) ?? undefined,
        description: (connector.description as string) ?? undefined,
        logoUrl: (connector.logoUrl as string) ?? undefined,
        installUrl: (connector.installUrl as string) ?? undefined,
        isAccessible: (connector.isAccessible as boolean) ?? undefined,
        isEnabled: (connector.isEnabled as boolean) ?? undefined,
      });
    }
    appDirectoryMemo = { mtimeMs: newestMtime, map };
    return map;
  } catch {
    return new Map();
  }
}

function pluginAssetUrl(
  ...candidates: Array<string | undefined | null>
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (/^(https?:|data:)/i.test(candidate)) return candidate;
    const dataUrl = fileToDataUrl(candidate);
    if (dataUrl) return dataUrl;
  }
  return undefined;
}

function mapPluginAvailability(
  value: unknown,
): PluginInfo["availability"] {
  if (value === "AVAILABLE" || value === "DISABLED_BY_ADMIN") {
    return value;
  }
  // Older experimental plugin payloads wrapped availability in an object.
  if (value && typeof value === "object") {
    const legacyType = (value as { type?: unknown }).type;
    if (legacyType === "available") return "AVAILABLE";
    if (legacyType === "disabledByAdmin") return "DISABLED_BY_ADMIN";
  }
  return undefined;
}

function mapPluginDisabledReason(
  value: unknown,
): PluginInfo["disabledReason"] {
  switch (value) {
    case "disabled_by_admin":
    case "plan_not_eligible":
    case "required_app_unavailable":
    case "unknown":
      return value;
    default:
      return typeof value === "string" ? "unknown" : null;
  }
}

function mapEligiblePlanTypes(value: unknown): string[] | null {
  return Array.isArray(value)
    ? value.filter((plan): plan is string => typeof plan === "string")
    : null;
}

export function mapCodexPluginList(
  result: Record<string, unknown> | null | undefined,
): PluginListResponse {
  const rawMarketplaces = Array.isArray(result?.marketplaces)
    ? (result.marketplaces as Array<Record<string, unknown>>)
    : [];

  return {
    marketplaces: rawMarketplaces.map((marketplace) => {
      const rawPlugins = Array.isArray(marketplace.plugins)
        ? (marketplace.plugins as Array<Record<string, unknown>>)
        : [];

      return {
        name: (marketplace.name as string) ?? "",
        path: (marketplace.path as string | null | undefined) ?? "",
        interface:
          (marketplace.interface as {
            displayName?: string;
          } | null | undefined) ?? null,
        plugins: rawPlugins.map((plugin): PluginInfo => {
          const pluginInterface = plugin.interface as
            | Record<string, unknown>
            | null
            | undefined;
          return {
            id: (plugin.id as string) ?? "",
            name: (plugin.name as string) ?? "",
            source:
              (plugin.source as {
                type: string;
                path: string;
              } | undefined) ?? { type: "local", path: "" },
            installed: (plugin.installed as boolean) ?? false,
            enabled: (plugin.enabled as boolean) ?? false,
            installPolicy:
              (plugin.installPolicy as PluginInfo["installPolicy"]) ??
              "AVAILABLE",
            availability: mapPluginAvailability(plugin.availability),
            disabledReason: mapPluginDisabledReason(plugin.disabledReason),
            eligiblePlanTypes: mapEligiblePlanTypes(
              plugin.eligiblePlanTypes,
            ),
            installedAt:
              typeof plugin.installedAt === "number"
                ? plugin.installedAt
                : null,
            authPolicy:
              (plugin.authPolicy as PluginInfo["authPolicy"]) ?? "ON_INSTALL",
            interface: pluginInterface
              ? {
                  displayName:
                    (pluginInterface.displayName as string | undefined) ??
                    undefined,
                  shortDescription:
                    (pluginInterface.shortDescription as string | undefined) ??
                    undefined,
                  longDescription:
                    (pluginInterface.longDescription as string | undefined) ??
                    undefined,
                  developerName:
                    (pluginInterface.developerName as string | undefined) ??
                    undefined,
                  category:
                    (pluginInterface.category as string | undefined) ??
                    undefined,
                  capabilities:
                    (pluginInterface.capabilities as string[] | undefined) ??
                    [],
                  websiteUrl:
                    (pluginInterface.websiteUrl as string | undefined) ??
                    undefined,
                  defaultPrompt:
                    (pluginInterface.defaultPrompt as string[] | undefined) ??
                    undefined,
                  brandColor:
                    (pluginInterface.brandColor as string | undefined) ??
                    undefined,
                  composerIcon: pluginAssetUrl(
                    pluginInterface.composerIcon as string | undefined,
                    pluginInterface.composerIconUrl as string | undefined,
                  ),
                  logo: pluginAssetUrl(
                    pluginInterface.logo as string | undefined,
                    pluginInterface.logoUrl as string | undefined,
                  ),
                  screenshots: [
                    ...((pluginInterface.screenshots as
                      | string[]
                      | undefined) ?? []),
                    ...((pluginInterface.screenshotUrls as
                      | string[]
                      | undefined) ?? []),
                  ]
                    .map((screenshot) => pluginAssetUrl(screenshot))
                    .filter(Boolean) as string[],
                  privacyPolicyUrl:
                    (pluginInterface.privacyPolicyUrl as string | undefined) ??
                    undefined,
                  termsOfServiceUrl:
                    (pluginInterface.termsOfServiceUrl as string | undefined) ??
                    undefined,
                }
              : null,
          };
        }),
      };
    }),
    marketplaceLoadErrors:
      (result?.marketplaceLoadErrors as
        | PluginListResponse["marketplaceLoadErrors"]
        | undefined) ?? [],
    remoteSyncError:
      (result?.remoteSyncError as string | null | undefined) ?? null,
    featuredPluginIds:
      (result?.featuredPluginIds as string[] | undefined) ?? [],
  };
}

function mapPluginDetail(
  rawPlugin: Record<string, unknown>,
): PluginDetail {
  const summary = rawPlugin.summary as Record<string, unknown>;
  const pluginInterface = summary.interface as
    | Record<string, unknown>
    | undefined;
  const skills =
    (rawPlugin.skills as Array<Record<string, unknown>>) ?? [];
  const apps = (rawPlugin.apps as Array<Record<string, unknown>>) ?? [];
  const appDirectory = loadAppDirectory();

  return {
    marketplaceName: rawPlugin.marketplaceName as string,
    marketplacePath: rawPlugin.marketplacePath as string,
    summary: {
      id: summary.id as string,
      name: summary.name as string,
      source:
        (summary.source as { type: string; path: string }) ?? {
          type: "local",
          path: "",
        },
      installed: (summary.installed as boolean) ?? false,
      enabled: (summary.enabled as boolean) ?? false,
      installPolicy:
        (summary.installPolicy as PluginInfo["installPolicy"]) ?? "AVAILABLE",
      availability: mapPluginAvailability(summary.availability),
      disabledReason: mapPluginDisabledReason(summary.disabledReason),
      eligiblePlanTypes: mapEligiblePlanTypes(summary.eligiblePlanTypes),
      installedAt:
        typeof summary.installedAt === "number"
          ? summary.installedAt
          : null,
      authPolicy:
        (summary.authPolicy as PluginInfo["authPolicy"]) ?? "ON_INSTALL",
      interface: pluginInterface
        ? {
            displayName:
              pluginInterface.displayName as string | undefined,
            shortDescription:
              pluginInterface.shortDescription as string | undefined,
            longDescription:
              pluginInterface.longDescription as string | undefined,
            developerName:
              pluginInterface.developerName as string | undefined,
            category: pluginInterface.category as string | undefined,
            capabilities:
              (pluginInterface.capabilities as string[]) ?? [],
            websiteUrl:
              pluginInterface.websiteUrl as string | undefined,
            defaultPrompt:
              pluginInterface.defaultPrompt as string[] | undefined,
            brandColor:
              pluginInterface.brandColor as string | undefined,
            composerIcon: pluginAssetUrl(
              pluginInterface.composerIcon as string | undefined,
              pluginInterface.composerIconUrl as string | undefined,
            ),
            logo: pluginAssetUrl(
              pluginInterface.logo as string | undefined,
              pluginInterface.logoUrl as string | undefined,
            ),
            screenshots: [
              ...((pluginInterface.screenshots as string[]) ?? []),
              ...((pluginInterface.screenshotUrls as string[]) ?? []),
            ]
              .map((screenshot) => pluginAssetUrl(screenshot))
              .filter(Boolean) as string[],
            privacyPolicyUrl:
              pluginInterface.privacyPolicyUrl as string | undefined,
            termsOfServiceUrl:
              pluginInterface.termsOfServiceUrl as string | undefined,
          }
        : null,
    },
    description: (rawPlugin.description as string) ?? null,
    skills: skills.map((skill) => {
      const skillInterface = skill.interface as
        | Record<string, unknown>
        | undefined;
      return {
        name: skill.name as string,
        displayName:
          (skillInterface?.displayName as string | undefined) ?? undefined,
        path: skill.path as string | undefined,
        description:
          (skillInterface?.longDescription as string | undefined) ??
          (skill.description as string | undefined),
        shortDescription:
          (skillInterface?.shortDescription as string | undefined) ??
          (skill.shortDescription as string | undefined),
        enabled: (skill.enabled as boolean) ?? false,
      };
    }),
    apps: apps.map((app) => {
      const directoryEntry = appDirectory.get(app.id as string);
      return {
        id: app.id as string,
        name:
          (app.name as string) ||
          directoryEntry?.name ||
          (app.id as string),
        needsAuth: (app.needsAuth as boolean) ?? false,
        description:
          (app.description as string | undefined) ??
          directoryEntry?.description,
        installUrl:
          (app.installUrl as string | undefined) ??
          directoryEntry?.installUrl,
        isAccessible:
          (app.isAccessible as boolean | undefined) ??
          directoryEntry?.isAccessible,
        isEnabled:
          (app.isEnabled as boolean | undefined) ??
          directoryEntry?.isEnabled,
        category: app.category as string | undefined,
        iconUrl: directoryEntry?.logoUrl,
      };
    }),
    mcpServers: (rawPlugin.mcpServers as string[]) ?? [],
  };
}

export function createCodexCapabilities(
  options: CodexCapabilitiesOptions,
) {
  const logger =
    options.logger ?? createLogger("[CodexCapabilities]");
  const marketplacePathCache = new Map<string, string>();
  const remotePluginRefCache = new Map<
    string,
    RemotePluginReference
  >();
  let pluginCatalogCache: {
    value: PluginListResponse;
    fetchedAt: number;
  } | null = null;
  let installedPluginsCache: {
    value: PluginListResponse;
    fetchedAt: number;
  } | null = null;
  let pluginCatalogInFlight: Promise<PluginListResponse> | null = null;
  let installedPluginsInFlight: Promise<PluginListResponse> | null = null;
  let pluginCapabilityPromise: Promise<void> | null = null;
  let pluginCacheGeneration = 0;

  // ── Session install overlay ──────────────────────────────────
  // `plugin/installed` is answered from an install registry the app-server
  // snapshots when it boots: a plugin installed from a *remote* marketplace
  // mid-session never appears in it, even though `plugin/list` flips the same
  // plugin to installed=true and `skills/list` starts returning its skills
  // straight away (verified against codex-cli 0.146.0). Since Mains keeps one
  // long-lived app-server per adapter, without this overlay Settings › Plugins
  // and the "@" menu's Plugins section only catch up when the app restarts.
  // Entries are dropped as soon as the server reports the plugin itself.
  const sessionInstalls = new Map<
    string,
    { marketplaceName: string; plugin: PluginInfo }
  >();
  const sessionUninstalls = new Set<string>();

  function findCatalogPlugin(pluginId: string): PluginInfo | undefined {
    for (const marketplace of pluginCatalogCache?.value.marketplaces ?? []) {
      const plugin = marketplace.plugins.find(
        (candidate) => candidate.id === pluginId,
      );
      if (plugin) return plugin;
    }
    return undefined;
  }

  function assertPluginCanInstall(pluginId: string): void {
    const plugin = findCatalogPlugin(pluginId);
    if (!plugin) return;
    const blockReason = getPluginInstallBlockReason(plugin);
    if (blockReason) throw new Error(blockReason);
  }

  /** Snapshot the catalog entry for a plugin before its caches are dropped. */
  function captureCatalogEntry(pluginId: string): {
    marketplaceName: string;
    plugin: PluginInfo;
  } {
    for (const marketplace of pluginCatalogCache?.value.marketplaces ?? []) {
      const plugin = marketplace.plugins.find(
        (candidate) => candidate.id === pluginId,
      );
      if (plugin) {
        return {
          marketplaceName: marketplace.name,
          // The catalog entry still carries the pre-install flags.
          plugin: { ...plugin, installed: true, enabled: true },
        };
      }
    }
    // The catalog is normally warm (installs are initiated from the plugin
    // browser), but fall back to an id-derived stub so the row still shows.
    const separatorIndex = pluginId.lastIndexOf("@");
    return {
      marketplaceName:
        separatorIndex !== -1 ? pluginId.slice(separatorIndex + 1) : "",
      plugin: {
        id: pluginId,
        name:
          separatorIndex !== -1 ? pluginId.slice(0, separatorIndex) : pluginId,
        source: { type: "remote", path: "" },
        installed: true,
        enabled: true,
        installPolicy: "AVAILABLE",
        authPolicy: "ON_INSTALL",
        interface: null,
      },
    };
  }

  /** Fold this session's installs/uninstalls into a `plugin/installed` reply. */
  function applySessionOverlay(
    list: PluginListResponse,
  ): PluginListResponse {
    if (sessionInstalls.size === 0 && sessionUninstalls.size === 0) {
      return list;
    }
    const marketplaces = list.marketplaces.map((marketplace) => ({
      ...marketplace,
      plugins: marketplace.plugins.filter(
        (plugin) => !sessionUninstalls.has(plugin.id),
      ),
    }));
    for (const [pluginId, entry] of sessionInstalls) {
      const alreadyReported = marketplaces.some((marketplace) =>
        marketplace.plugins.some((plugin) => plugin.id === pluginId),
      );
      if (alreadyReported) continue;
      const plugin: PluginInfo = { ...entry.plugin, installed: true };
      const marketplace = marketplaces.find(
        (candidate) => candidate.name === entry.marketplaceName,
      );
      if (marketplace) {
        marketplace.plugins = [...marketplace.plugins, plugin];
      } else {
        marketplaces.push({
          name: entry.marketplaceName,
          path: "",
          interface: null,
          plugins: [plugin],
        });
      }
    }
    return { ...list, marketplaces };
  }

  function indexPluginReferences(
    result: Record<string, unknown>,
  ): void {
    const marketplaces = Array.isArray(result.marketplaces)
      ? (result.marketplaces as Array<Record<string, unknown>>)
      : [];
    for (const marketplace of marketplaces) {
      const marketplaceName = marketplace.name as string;
      const marketplacePath = marketplace.path as
        | string
        | null
        | undefined;
      if (marketplacePath) {
        marketplacePathCache.set(marketplaceName, marketplacePath);
      }

      const plugins = Array.isArray(marketplace.plugins)
        ? (marketplace.plugins as Array<Record<string, unknown>>)
        : [];
      for (const plugin of plugins) {
        const remotePluginId = plugin.remotePluginId as
          | string
          | undefined;
        if (!remotePluginId) continue;
        const reference = {
          remotePluginId,
          marketplaceName,
        };
        remotePluginRefCache.set(plugin.id as string, reference);
        remotePluginRefCache.set(plugin.name as string, reference);
      }
    }
  }

  async function assertPluginCapability(
    server: CodexAppServer,
  ): Promise<void> {
    pluginCapabilityPromise ??= (async () => {
      let cursor: string | null = null;
      do {
        const result: {
          data: Array<{
            name: string;
            enabled: boolean;
            stage: string;
          }>;
          nextCursor: string | null;
        } = await server.sendRequest("experimentalFeature/list", {
          cursor,
          limit: 100,
        });
        const feature = result.data.find(
          ({ name }) => name === "plugins",
        );
        if (feature) {
          if (!feature.enabled || feature.stage === "removed") {
            throw new Error(
              "Codex plugins feature is disabled or unavailable.",
            );
          }
          return;
        }
        cursor = result.nextCursor;
      } while (cursor);

      throw new Error(
        "Codex plugins feature is disabled or unavailable.",
      );
    })();
    return pluginCapabilityPromise;
  }

  async function fetchPluginList(
    method: "plugin/list" | "plugin/installed",
  ): Promise<PluginListResponse> {
    const server = await options.ensureServer();
    await assertPluginCapability(server);
    const result = (await server.sendRequest(
      method,
      {},
      30000,
    )) as unknown as Record<string, unknown>;
    indexPluginReferences(result);
    return mapCodexPluginList(result);
  }

  function pluginListFailure(
    error: unknown,
    method: "plugin/list" | "plugin/installed",
    staleValue?: PluginListResponse,
  ): PluginListResponse {
    const message =
      error instanceof Error ? error.message : String(error);
    logger.error(`Failed to call ${method}:`, message);
    if (/method not found|unknown method|not supported/i.test(message)) {
      logger.warn(`${method} not supported by this Codex version`);
    }
    if (staleValue) {
      return { ...staleValue, remoteSyncError: message };
    }
    return {
      marketplaces: [],
      marketplaceLoadErrors: [],
      remoteSyncError: message,
      featuredPluginIds: [],
    };
  }

  function invalidatePluginCaches(): void {
    pluginCacheGeneration += 1;
    pluginCatalogCache = null;
    installedPluginsCache = null;
    pluginCatalogInFlight = null;
    installedPluginsInFlight = null;
  }

  async function listModels(): Promise<ModelInfo[]> {
    try {
      const server = await options.ensureServer();
      const result = await server.sendRequest("model/list", {});
      if (!Array.isArray(result.data)) {
        logger.warn("Invalid models response from app-server");
        return [];
      }

      return result.data
        .filter((model) => !model.hidden)
        .map((model): ModelInfo => {
          const effortLevels = model.supportedReasoningEfforts.map(
            (effort) => effort.reasoningEffort,
          ) as ("low" | "medium" | "high" | "xhigh")[];
          const serviceTiers =
            model.serviceTiers.length > 0
              ? model.serviceTiers.map((tier) => ({
                  id: tier.id,
                  name: tier.name || tier.id,
                  description: tier.description,
                }))
              : model.additionalSpeedTiers.length > 0
                ? model.additionalSpeedTiers.map((id) => ({
                    id,
                    name: id,
                  }))
                : undefined;
          const displayName = (model.displayName || model.id)
            .replace(/^gpt-/i, "GPT-")
            .replace(/-codex/i, " Codex")
            .replace(/-mini$/i, " Mini")
            .replace(/-max$/i, " Max")
            .replace(/-spark$/i, " Spark");

          return {
            id: model.id,
            displayName,
            isDefault:
              model.isDefault ||
              model.id === options.getDefaultModel?.(),
            description: model.description,
            capabilities: {
              vision: model.inputModalities.includes("image"),
            },
            supportsEffort: effortLevels.length > 0,
            supportedEffortLevels: effortLevels,
            supportsFastMode:
              serviceTiers?.some(
                (tier) =>
                  tier.id === "fast" || tier.id === "priority",
              ) ?? false,
            serviceTiers,
          };
        });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      if (/not authenticated/i.test(message)) throw error;
      logger.error("Failed to list models:", error);
      return [];
    }
  }

  async function getAccountInfo(): Promise<AccountInfo> {
    const cli = await options.getCliHealth();
    try {
      const server = await options.ensureServer();
      const result = await server.sendRequest("account/read", {});
      return {
        account: result.account,
        requiresOpenaiAuth: result.requiresOpenaiAuth,
        cli,
      };
    } catch (error) {
      logger.error("Failed to read account:", error);
      return { account: null, requiresOpenaiAuth: true, cli };
    }
  }

  async function getRateLimits(): Promise<RateLimitInfo | null> {
    try {
      const server = options.getRunningServer();
      if (!server) return null;
      const result = await server.sendRequest(
        "account/rateLimits/read",
        undefined,
      );
      return mapRateLimitResponse(
        result as unknown as Record<string, unknown>,
      );
    } catch (error) {
      logger.error("Failed to get rate limits:", error);
      return null;
    }
  }

  async function listSkills(
    workspacePath?: string,
  ): Promise<SkillInfo[]> {
    try {
      const server = await options.ensureServer(workspacePath);
      const result = await server.sendRequest("skills/list", {
        ...(workspacePath ? { cwds: [workspacePath] } : {}),
        forceReload: true,
      });
      const skills: SkillInfo[] = [];
      for (const entry of result.data) {
        for (const skill of entry.skills) {
          if (!skill.enabled) continue;
          const scope =
            skill.scope === "user"
              ? "user"
              : skill.scope === "repo"
                ? "project"
                : undefined;
          skills.push({
            name: skill.name,
            description:
              skill.interface?.shortDescription ||
              skill.shortDescription ||
              skill.description ||
              "",
            source: scope,
            path: skill.path,
            userInvokable: true,
            displayName: skill.interface?.displayName,
            shortDescription:
              skill.interface?.shortDescription ??
              skill.shortDescription,
            iconSmall: skill.interface?.iconSmall,
            iconLarge: skill.interface?.iconLarge,
            brandColor: skill.interface?.brandColor,
            defaultPrompt: skill.interface?.defaultPrompt,
            scope: skill.scope,
            enabled: skill.enabled,
          });
        }
      }
      return skills;
    } catch (error) {
      logger.error("Failed to list skills:", error);
      return [];
    }
  }

  async function listPlugins(): Promise<PluginListResponse> {
    if (
      pluginCatalogCache &&
      Date.now() - pluginCatalogCache.fetchedAt <
        PLUGIN_CATALOG_TTL_MS
    ) {
      return pluginCatalogCache.value;
    }
    if (pluginCatalogInFlight) return pluginCatalogInFlight;

    const staleValue = pluginCatalogCache?.value;
    const generation = pluginCacheGeneration;
    const request = fetchPluginList("plugin/list")
      .then((value) => {
        if (generation === pluginCacheGeneration) {
          pluginCatalogCache = {
            value,
            fetchedAt: Date.now(),
          };
        }
        return value;
      })
      .catch((error) =>
        pluginListFailure(error, "plugin/list", staleValue),
      )
      .finally(() => {
        if (pluginCatalogInFlight === request) {
          pluginCatalogInFlight = null;
        }
      });
    pluginCatalogInFlight = request;
    return request;
  }

  async function listInstalledPlugins(): Promise<PluginListResponse> {
    if (
      installedPluginsCache &&
      Date.now() - installedPluginsCache.fetchedAt <
        INSTALLED_PLUGINS_TTL_MS
    ) {
      return applySessionOverlay(installedPluginsCache.value);
    }
    if (installedPluginsInFlight) return installedPluginsInFlight;

    const staleValue = installedPluginsCache?.value;
    const generation = pluginCacheGeneration;
    const request = fetchPluginList("plugin/installed")
      .then((value) => {
        if (generation === pluginCacheGeneration) {
          installedPluginsCache = {
            value,
            fetchedAt: Date.now(),
          };
        }
        return value;
      })
      .catch((error) =>
        pluginListFailure(error, "plugin/installed", staleValue),
      )
      .then(applySessionOverlay)
      .finally(() => {
        if (installedPluginsInFlight === request) {
          installedPluginsInFlight = null;
        }
      });
    installedPluginsInFlight = request;
    return request;
  }

  async function readPlugin(
    pluginName: string,
    marketplacePath: string,
  ): Promise<PluginDetail> {
    const server = await options.ensureServer();
    await assertPluginCapability(server);
    const remoteReference = !marketplacePath
      ? remotePluginRefCache.get(pluginName)
      : undefined;
    if (!marketplacePath && !remoteReference) {
      throw new Error(
        `Marketplace not found for plugin "${pluginName}". Try browsing plugins first.`,
      );
    }
    const params = marketplacePath
      ? { pluginName, marketplacePath }
      : {
          pluginName: remoteReference!.remotePluginId,
          remoteMarketplaceName:
            remoteReference!.marketplaceName,
        };
    const result = await server.sendRequest(
      "plugin/read",
      params,
      30000,
    );
    return mapPluginDetail(
      result.plugin as unknown as Record<string, unknown>,
    );
  }

  async function installPlugin(
    pluginId: string,
    _scope?: PluginScope,
  ): Promise<void> {
    assertPluginCanInstall(pluginId);
    const server = await options.ensureServer();
    await assertPluginCapability(server);
    const separatorIndex = pluginId.lastIndexOf("@");
    const marketplaceName =
      separatorIndex !== -1
        ? pluginId.slice(separatorIndex + 1)
        : "";
    const pluginName =
      separatorIndex !== -1
        ? pluginId.slice(0, separatorIndex)
        : pluginId;
    const marketplacePath =
      marketplacePathCache.get(marketplaceName);
    const remoteReference = remotePluginRefCache.get(pluginId);

    if (marketplacePath) {
      await server.sendRequest(
        "plugin/install",
        { pluginName, marketplacePath },
        120000,
      );
      try {
        await server.sendRequest("config/value/write", {
          keyPath: `plugins.${pluginId}.enabled`,
          value: true,
          mergeStrategy: "replace",
        });
      } catch (error) {
        logger.warn(
          "Failed to auto-enable plugin via config:",
          error,
        );
      }
    } else if (remoteReference) {
      await server.sendRequest(
        "plugin/install",
        {
          pluginName: remoteReference.remotePluginId,
          remoteMarketplaceName:
            remoteReference.marketplaceName,
        },
        120000,
      );
    } else {
      throw new Error(
        `Marketplace not found for "${pluginId}". Try browsing plugins first.`,
      );
    }

    // Capture before invalidating — the catalog cache is the only place the
    // plugin's display metadata lives until the app-server is restarted.
    sessionUninstalls.delete(pluginId);
    sessionInstalls.set(pluginId, captureCatalogEntry(pluginId));
    invalidatePluginCaches();
    logger.info(`Plugin installed and enabled: ${pluginId}`);
  }

  async function uninstallPlugin(pluginId: string): Promise<void> {
    const server = await options.ensureServer();
    await assertPluginCapability(server);
    const separatorIndex = pluginId.lastIndexOf("@");
    const marketplaceName =
      separatorIndex !== -1
        ? pluginId.slice(separatorIndex + 1)
        : "";
    const marketplacePath =
      marketplacePathCache.get(marketplaceName);
    const remoteReference = remotePluginRefCache.get(pluginId);

    if (marketplacePath) {
      await server.sendRequest("plugin/uninstall", { pluginId });
    } else if (remoteReference) {
      await server.sendRequest("plugin/uninstall", {
        pluginId: remoteReference.remotePluginId,
      });
    } else {
      throw new Error(
        `Marketplace not found for "${pluginId}". Try browsing plugins first.`,
      );
    }
    sessionInstalls.delete(pluginId);
    sessionUninstalls.add(pluginId);
    invalidatePluginCaches();
    logger.info(`Plugin uninstalled: ${pluginId}`);
  }

  async function setPluginEnabled(
    pluginId: string,
    enabled: boolean,
  ): Promise<void> {
    const server = await options.ensureServer();
    await assertPluginCapability(server);
    const separatorIndex = pluginId.lastIndexOf("@");
    const marketplaceName =
      separatorIndex !== -1
        ? pluginId.slice(separatorIndex + 1)
        : "";
    if (
      !marketplacePathCache.get(marketplaceName) &&
      remotePluginRefCache.has(pluginId)
    ) {
      throw new Error(
        "Codex remote plugins can't be enabled/disabled — uninstall the plugin instead.",
      );
    }
    await server.sendRequest("config/value/write", {
      keyPath: `plugins.${pluginId}.enabled`,
      value: enabled,
      mergeStrategy: "replace",
    });
    invalidatePluginCaches();
    logger.info(
      `Plugin ${enabled ? "enabled" : "disabled"}: ${pluginId}`,
    );
  }

  return {
    listModels,
    getAccountInfo,
    getRateLimits,
    listSkills,
    listPlugins,
    listInstalledPlugins,
    readPlugin,
    installPlugin,
    uninstallPlugin,
    setPluginEnabled,
    onServerClosed(): void {
      pluginCapabilityPromise = null;
    },
    shutdown(): void {
      pluginCapabilityPromise = null;
      invalidatePluginCaches();
      marketplacePathCache.clear();
      remotePluginRefCache.clear();
    },
  };
}

export type CodexCapabilities = ReturnType<
  typeof createCodexCapabilities
>;
