import { useMemo } from "react";
import type { McpAppEntrypoint, McpAppIcon as IconMetadata } from "@mains/contracts/mcp-apps";
import { PROVIDER_IDS } from "@mains/contracts/provider-ids";
import { McpAppIcon } from "@/components/layout/sidebar/mcp-app-icon";
import { useIsDarkMode } from "@/hooks/use-is-dark-mode";
import { useGetProviderInstalledPluginsQuery } from "@/lib/redux/api/providersApi";
import { buildPluginLogoMap, normalizeSlug } from "../hooks/use-plugin-logos";

/** Chat-only apps may have no rail entrypoint carrying their plugin's icons. */
export function McpAppTabIcon({ app, providerId }: { app: McpAppEntrypoint; providerId: string }) {
  const dark = useIsDarkMode();
  const needsPluginIcon = providerId === PROVIDER_IDS.codex && !app.icons?.length;
  const { currentData } = useGetProviderInstalledPluginsQuery(providerId, { skip: !needsPluginIcon });
  const icons = useMemo(() => {
    if (!needsPluginIcon || !currentData) return app.icons;
    if (app.pluginId) {
      const owner = currentData.marketplaces.flatMap((marketplace) => marketplace.plugins)
        .find((plugin) => plugin.id === app.pluginId);
      return [owner?.interface?.composerIcon, owner?.interface?.logo]
        .filter((src): src is string => !!src).map((src) => ({ src }));
    }
    // Reuse transcript branding for tool-originated apps. This is visual
    // metadata only; the app's connector, account and resource stay unchanged.
    const logos = buildPluginLogoMap(currentData);
    const namespace = app.server === "codex_apps" ? app.tool.split(".")[0] : app.server;
    const plugin = (app.connectorId ? logos.get(normalizeSlug(app.connectorId)) : undefined)
      ?? logos.get(normalizeSlug(namespace));
    return plugin?.logo ? [{ src: plugin.logo } satisfies IconMetadata] : undefined;
  }, [app.icons, app.pluginId, app.connectorId, app.server, app.tool, needsPluginIcon, currentData]);
  return <McpAppIcon icons={icons} isDarkMode={dark} className="size-3.5" />;
}
