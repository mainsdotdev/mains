import type { AccountInfo } from "./adapter.types";

// Execution preferences (model, effort, permissions, voice artwork, etc.) do
// not change discovery. Keep this boundary shared by backend and renderer.
const CATALOG_CONFIG_KEYS = [
  "binary", "apiKey", "baseUrl", "cliUrl", "useStdio", "port",
  "githubToken", "useLoggedInUser", "settingSources", "plugins", "mcpServers",
] as const;

export function providerCatalogConfigKey(config: object | null | undefined): string {
  const values = config as Record<string, unknown> | null | undefined;
  return JSON.stringify(CATALOG_CONFIG_KEYS.map((key) => values?.[key]));
}

/** Account, plan and CLI changes can alter models, commands and plugin eligibility. */
export function providerAccountCacheKey(info: AccountInfo): string {
  return JSON.stringify([
    info.account === null ? null : Object.entries(info.account).sort(([a], [b]) => a.localeCompare(b)),
    info.requiresOpenaiAuth,
    info.cli?.version ?? null,
    info.cli?.channel ?? null,
    info.cli?.source ?? null,
  ]);
}
