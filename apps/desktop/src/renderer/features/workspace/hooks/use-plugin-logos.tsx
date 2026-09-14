import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  useGetProviderInstalledPluginsQuery,
  type PluginListResponse,
} from "@/lib/redux/api";
import { proxiedImageSrc } from "@/lib/proxied-image-src";
import { PROVIDER_IDS } from "../../../../shared/provider-ids";

/**
 * Visual identity for a codex plugin, keyed by the slug that shows up in tool
 * names (`mcp__<slug>__<tool>`) and skill names (`<slug>:<skill>`).
 */
export interface PluginLogo {
  slug: string;
  name: string;
  displayName?: string;
  /** Remote logo URL from `interface.logo`. */
  logo?: string;
  /** Hex brand color from `interface.brandColor`, used for the monogram fallback. */
  brandColor?: string;
}

/**
 * Collapse a slug to a separator-agnostic key so the spelling on the tool name
 * (`google calendar`, from the `codex_apps` sub-provider) matches the plugin's
 * own name (`google-calendar`). Both fold to `googlecalendar`.
 */
export function normalizeSlug(raw: string): string {
  return raw.toLowerCase().replace(/[\s._-]+/g, "");
}

const EMPTY_MAP: ReadonlyMap<string, PluginLogo> = new Map();

const PluginLogoContext =
  createContext<ReadonlyMap<string, PluginLogo>>(EMPTY_MAP);

export function buildPluginLogoMap(
  data: PluginListResponse | undefined,
): Map<string, PluginLogo> {
  const map = new Map<string, PluginLogo>();
  if (!data) return map;

  for (const marketplace of data.marketplaces) {
    for (const plugin of marketplace.plugins) {
      const logo = plugin.interface?.logo;
      const brandColor = plugin.interface?.brandColor;
      // Nothing to render → don't shadow the static icon with a blank entry.
      if (!logo && !brandColor) continue;

      const displayName = plugin.interface?.displayName;
      // Remote app plugins use opaque names (`app-6945…`) while codex_apps
      // tool names use the human slug (`skyscanner.…`). Index both forms,
      // plus the id-base used by ordinary marketplace plugins.
      const keys = new Set<string>();
      if (plugin.name) keys.add(normalizeSlug(plugin.name));
      const idBase = plugin.id?.split("@")[0];
      if (idBase) keys.add(normalizeSlug(idBase));
      if (displayName) keys.add(normalizeSlug(displayName));

      for (const slug of keys) {
        if (slug && !map.has(slug)) {
          map.set(slug, {
            slug,
            name: plugin.name,
            displayName,
            logo,
            brandColor,
          });
        }
      }
    }
  }

  return map;
}

/**
 * Builds a `slug → PluginLogo` map from installed codex plugins so tool /
 * skill renderers can swap the generic MCP icon for the plugin's real logo.
 *
 * Only fetches when the active run is codex (the only provider with a plugin
 * marketplace); for every other provider the query is skipped and consumers
 * fall back to their static icons via the empty default context. Using
 * `plugin/installed` here avoids loading the multi-megabyte marketplace
 * catalog in every workspace.
 */
export function PluginLogoProvider({
  providerId,
  children,
}: {
  providerId: string;
  children: ReactNode;
}) {
  const isCodex = providerId === PROVIDER_IDS.codex;
  const { data } = useGetProviderInstalledPluginsQuery(PROVIDER_IDS.codex, {
    skip: !isCodex,
    refetchOnFocus: false,
    refetchOnReconnect: false,
  });

  const map = useMemo(() => buildPluginLogoMap(data), [data]);

  return (
    <PluginLogoContext.Provider value={map}>
      {children}
    </PluginLogoContext.Provider>
  );
}

/** Lookup map of codex plugin logos; empty when no `PluginLogoProvider` is mounted. */
export function usePluginLogoMap(): ReadonlyMap<string, PluginLogo> {
  return useContext(PluginLogoContext);
}

/**
 * Render a plugin's icon: the remote logo when present, otherwise a brand-color
 * monogram. Returns `null` when there's nothing to show so callers can fall
 * back to their static icon.
 */
export function renderPluginIcon(
  plugin: PluginLogo | undefined,
  sizeClass = "size-4",
): ReactNode | null {
  if (!plugin) return null;
  return <PluginIcon plugin={plugin} sizeClass={sizeClass} />;
}

function PluginIcon({ plugin, sizeClass }: { plugin: PluginLogo; sizeClass: string }) {
  const [failed, setFailed] = useState(false);
  const label = plugin.displayName || plugin.name;
  if (plugin.logo && !failed) {
    return (
      <img
        src={proxiedImageSrc(plugin.logo)}
        alt={label}
        loading="lazy"
        decoding="async"
        className={`${sizeClass} rounded object-cover shrink-0`}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      className={`${sizeClass} rounded flex items-center justify-center text-xt font-semibold text-white shrink-0`}
      style={{ backgroundColor: plugin.brandColor }}
    >
      {label.charAt(0).toUpperCase()}
    </span>
  );
}
